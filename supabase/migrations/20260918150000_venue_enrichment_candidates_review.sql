-- Venue Data Enrichment, Phase 3C: individual Approve/Reject of staged
-- venue_enrichment_candidates rows, with reviewer/audit metadata and a
-- server-side stale-approval guard.
--
-- SCOPE: this migration changes ONLY venue_enrichment_candidates review
-- state. Neither function this migration creates ever writes to
-- public.venues -- approving or rejecting a candidate here has zero live
-- effect on any venue listing. Actually applying an approved candidate's
-- suggested_value to public.venues remains a separate, not-yet-authorised
-- future phase (see this table's own original migration header comment,
-- 20260918120000_venue_enrichment_candidates.sql).
--
-- Builds directly on the Phase 3A/3B architecture audit and the existing
-- claim_requests review workflow (approve_claim_request/
-- reject_claim_request), which is the closest and most mature precedent
-- in this codebase for "admin reviews a staged record, server stamps
-- identity/time, writes one activity_log row".

-- ── 1. Reviewer/audit metadata ──────────────────────────────────────────
-- Nullable, no default -- reviewed_by/reviewed_at are set exactly once,
-- server-side, by the RPCs below (never a client-supplied value, never a
-- column default). review_notes is optional at every call. Typed
-- identically to claim_requests' own reviewed_by/reviewed_at/review_notes
-- columns for consistency with the existing reviewed-entity convention.
alter table public.venue_enrichment_candidates
  add column reviewed_by uuid references auth.users(id),
  add column reviewed_at timestamptz,
  add column review_notes text;

-- Pairs reviewed_by/reviewed_at with the two human-decision statuses only
-- -- 'stale_conflict' is a system-detected block, not a human decision,
-- and deliberately does NOT set these (see approve_venue_enrichment_
-- candidate() below); who attempted the blocked approval is recorded in
-- activity_log instead. The existing 46 production pilot rows are all
-- 'pending'/'skipped_no_source'/'skipped_ambiguous' with reviewed_by/
-- reviewed_at necessarily NULL (the columns did not exist before this
-- migration), so every one of them already satisfies the second branch
-- below without modification.
alter table public.venue_enrichment_candidates
  add constraint venue_enrichment_candidates_reviewed_pairing
  check (
    (status in ('approved', 'rejected') and reviewed_by is not null and reviewed_at is not null)
    or
    (status not in ('approved', 'rejected') and reviewed_by is null and reviewed_at is null)
  );

-- ── 2. RLS hardening ─────────────────────────────────────────────────────
-- Independent-review correction (Phase 3C architecture audit, section J):
-- the single broad "admin FOR ALL" policy this table shipped with in
-- Phase 1 would let an authenticated admin's browser session issue a
-- plain UPDATE directly on this table, completely bypassing the state
-- machine, stale-conflict check, and audit stamping the two RPCs below
-- exist to enforce -- exactly the "RPC exists but RLS still allows a
-- direct bypass" gap this project's own claim_requests table still has
-- today (its "Admins can update claim requests" policy coexists with
-- approve_claim_request/reject_claim_request). This migration does not
-- carry that gap forward: there is no client-facing UPDATE or DELETE
-- policy on this table at all from this point on. The two SECURITY
-- DEFINER functions below still work perfectly with no such policy --
-- SECURITY DEFINER functions run with the function owner's privileges
-- and are not subject to the calling session's RLS, exactly how
-- approve_claim_request already writes to venues/profiles/claim_requests
-- despite RLS existing on all three.
drop policy if exists venue_enrichment_candidates_admin_all on public.venue_enrichment_candidates;

-- Unchanged read access for the existing Phase 3B review screen.
create policy venue_enrichment_candidates_admin_select
  on public.venue_enrichment_candidates
  for select
  using (public.is_admin_or_above());

-- Preserves the staging/research INSERT path (Phase 2B's own actual
-- insert used a privileged SQL-editor/service context rather than an
-- RLS-gated authenticated client, so this was never actually exercised
-- via RLS -- kept anyway so a future in-app "start a new research batch"
-- admin feature doesn't need its own separate migration to get INSERT
-- access).
create policy venue_enrichment_candidates_admin_insert
  on public.venue_enrichment_candidates
  for insert
  with check (public.is_admin_or_above());

-- ── 3. Approve RPC ────────────────────────────────────────────────────────
-- Admin-gated SECURITY DEFINER function -- the ONLY path by which a
-- candidate's status/reviewer fields can change from 'pending'. Caller
-- supplies nothing but the candidate's own id and an optional free-text
-- note: status, venue_id, field, suggested_value, existing_value,
-- provenance and reviewer identity are never caller inputs -- there is
-- no parameter for any of them, so forging one is not merely rejected,
-- it is structurally impossible. `SET search_path TO ''` with every
-- reference fully qualified (public.*) is the stricter of the two
-- search_path conventions already in use across this project's existing
-- SECURITY DEFINER functions (matching is_admin_or_above/is_admin/
-- has_role themselves) -- never rely on search_path resolution inside a
-- SECURITY DEFINER function.
create or replace function public.approve_venue_enrichment_candidate(
  p_candidate_id uuid,
  p_review_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_candidate public.venue_enrichment_candidates;
  v_venue public.venues;
  v_live_value text;
  v_existing_norm text;
  v_live_norm text;
  v_updated public.venue_enrichment_candidates;
begin
  if not public.is_admin_or_above() then
    raise exception 'Only admins can review venue enrichment candidates';
  end if;

  -- Row-locked for the remainder of this transaction: a concurrent
  -- approve/reject call on the SAME candidate blocks here until this
  -- transaction commits or rolls back, then re-reads the now-current
  -- status -- the database, not the client, is authoritative for
  -- concurrent/racing calls (Phase 3C architecture audit, section N).
  select * into v_candidate
  from public.venue_enrichment_candidates
  where id = p_candidate_id
  for update;

  if v_candidate is null then
    raise exception 'Venue enrichment candidate % not found', p_candidate_id;
  end if;

  -- Idempotent retry (e.g. a client retrying after a timed-out response
  -- to a call that actually succeeded): re-approving an already-approved
  -- row is a safe no-op, not an error, and must not write a second
  -- activity_log decision entry.
  if v_candidate.status = 'approved' then
    return jsonb_build_object(
      'outcome', 'already_in_requested_state',
      'candidate_id', v_candidate.id,
      'status', v_candidate.status
    );
  end if;

  -- Every other non-pending status (rejected, applied, stale_conflict,
  -- skipped_no_source, skipped_ambiguous) is illegal to approve from --
  -- covers both "opposite action already decided" and "no proposed
  -- value exists to approve" in one guard, naming the actual current
  -- status so the caller (a stale UI, or a genuine mistake) gets a
  -- useful, specific error rather than a generic failure.
  if v_candidate.status <> 'pending' then
    raise exception 'Candidate % cannot be approved from status % (must be pending)', p_candidate_id, v_candidate.status;
  end if;

  select * into v_venue from public.venues where id = v_candidate.venue_id;
  if v_venue is null then
    raise exception 'Venue % referenced by candidate % not found', v_candidate.venue_id, p_candidate_id;
  end if;

  -- Explicit allow-listed field resolution -- deliberately NOT dynamic
  -- SQL, even though venue_enrichment_candidates_field_check already
  -- constrains `field` to exactly these 14 values. Mirrors the exact
  -- allow-list src/venueEnrichment/researchExport.js's ENRICHMENT_FIELDS
  -- and this table's own field CHECK both already enforce -- a 15th
  -- field can never be introduced here without also touching this CASE,
  -- the CHECK constraint, and the JS constant, all three independently.
  v_live_value := case v_candidate.field
    when 'address'             then v_venue.address
    when 'postcode'            then v_venue.postcode
    when 'website'             then v_venue.website
    when 'phone'               then v_venue.phone
    when 'contact_email'       then v_venue.contact_email
    when 'facebook'            then v_venue.facebook
    when 'instagram'           then v_venue.instagram
    when 'twitter'             then v_venue.twitter
    when 'capacity'            then v_venue.capacity::text
    when 'description'        then v_venue.description
    when 'photo_url'           then v_venue.photo_url
    when 'seo_title'           then v_venue.seo_title
    when 'seo_description'     then v_venue.seo_description
    when 'seo_search_phrases'  then v_venue.seo_search_phrases
    else null
  end;

  -- Same canonical blank/whitespace semantics as Phase 3B's own
  -- normalizeCompareValue() (src/venueEnrichment/venueEnrichmentReview.js):
  -- null, empty and whitespace-only are one equivalent "unset" value on
  -- either side; both sides are trimmed; capacity is compared via its
  -- ::text cast above rather than a second numeric branch here. Case is
  -- deliberately NOT normalised -- a case-only difference is treated as a
  -- real change, the safer direction (an over-flagged stale conflict is
  -- recoverable by re-approving after a fresh look; a hidden genuine
  -- change is not).
  v_existing_norm := nullif(trim(both from coalesce(v_candidate.existing_value, '')), '');
  v_live_norm     := nullif(trim(both from coalesce(v_live_value, '')), '');

  if v_existing_norm is distinct from v_live_norm then
    -- STALE: the live venue value has moved on since this candidate was
    -- researched. Deliberately does NOT raise -- an exception here would
    -- roll back the very stale_conflict transition this branch exists to
    -- persist. This is a normal, successful return with a distinct
    -- `outcome` the caller can render specifically (Phase 3C architecture
    -- audit, section F), not a generic RPC failure.
    update public.venue_enrichment_candidates
    set status = 'stale_conflict'
    where id = v_candidate.id and status = 'pending'
    returning * into v_updated;

    insert into public.activity_log (action, entity_type, entity_id, entity_name, performed_by)
    values (
      'venue_enrichment_candidate_stale_conflict_detected',
      'venue_enrichment_candidate',
      v_candidate.id,
      v_candidate.field || ' — ' || v_candidate.batch_id,
      auth.uid()
    );

    return jsonb_build_object(
      'outcome', 'stale_conflict',
      'candidate_id', v_candidate.id,
      'field', v_candidate.field,
      'existing_value', v_candidate.existing_value,
      'live_value', v_live_value,
      'status', 'stale_conflict'
    );
  end if;

  update public.venue_enrichment_candidates
  set status = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_notes = p_review_notes
  where id = v_candidate.id and status = 'pending'
  returning * into v_updated;

  -- Unreachable under normal operation -- the FOR UPDATE lock above holds
  -- this row exclusively from the initial SELECT through this UPDATE, so
  -- no other transaction can have moved status off 'pending' in between.
  -- Kept as a defensive fallback rather than an assumption, so a future
  -- refactor that ever splits this into more than one transaction fails
  -- safely (a clean "already_reviewed" result) instead of silently
  -- double-writing.
  if v_updated is null then
    select * into v_candidate from public.venue_enrichment_candidates where id = p_candidate_id;
    return jsonb_build_object(
      'outcome', 'already_reviewed',
      'candidate_id', v_candidate.id,
      'status', v_candidate.status
    );
  end if;

  -- Never copies suggested_value/existing_value/source_url/notes into
  -- activity_log -- that table is a record of actions, not a mirror of
  -- researched content (Phase 3C architecture audit, section I).
  insert into public.activity_log (action, entity_type, entity_id, entity_name, performed_by)
  values (
    'venue_enrichment_candidate_approved',
    'venue_enrichment_candidate',
    v_updated.id,
    v_updated.field || ' — ' || v_updated.batch_id,
    auth.uid()
  );

  return jsonb_build_object(
    'outcome', 'approved',
    'candidate_id', v_updated.id,
    'status', v_updated.status,
    'reviewed_by', v_updated.reviewed_by,
    'reviewed_at', v_updated.reviewed_at
  );
end;
$function$;

-- ── 4. Reject RPC ─────────────────────────────────────────────────────────
-- Same admin-gating/row-lock/idempotency shape as approve above, but with
-- NO live-venue stale-value check: rejecting a suggestion can never later
-- be applied, so there is nothing for a staleness check to protect
-- against (Phase 3C architecture audit, section F/section 6). Never
-- writes to public.venues.
create or replace function public.reject_venue_enrichment_candidate(
  p_candidate_id uuid,
  p_review_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_candidate public.venue_enrichment_candidates;
  v_updated public.venue_enrichment_candidates;
begin
  if not public.is_admin_or_above() then
    raise exception 'Only admins can review venue enrichment candidates';
  end if;

  select * into v_candidate
  from public.venue_enrichment_candidates
  where id = p_candidate_id
  for update;

  if v_candidate is null then
    raise exception 'Venue enrichment candidate % not found', p_candidate_id;
  end if;

  if v_candidate.status = 'rejected' then
    return jsonb_build_object(
      'outcome', 'already_in_requested_state',
      'candidate_id', v_candidate.id,
      'status', v_candidate.status
    );
  end if;

  if v_candidate.status <> 'pending' then
    raise exception 'Candidate % cannot be rejected from status % (must be pending)', p_candidate_id, v_candidate.status;
  end if;

  update public.venue_enrichment_candidates
  set status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_notes = p_review_notes
  where id = v_candidate.id and status = 'pending'
  returning * into v_updated;

  -- Unreachable under normal operation -- see the identical comment in
  -- approve_venue_enrichment_candidate() above.
  if v_updated is null then
    select * into v_candidate from public.venue_enrichment_candidates where id = p_candidate_id;
    return jsonb_build_object(
      'outcome', 'already_reviewed',
      'candidate_id', v_candidate.id,
      'status', v_candidate.status
    );
  end if;

  insert into public.activity_log (action, entity_type, entity_id, entity_name, performed_by)
  values (
    'venue_enrichment_candidate_rejected',
    'venue_enrichment_candidate',
    v_updated.id,
    v_updated.field || ' — ' || v_updated.batch_id,
    auth.uid()
  );

  return jsonb_build_object(
    'outcome', 'rejected',
    'candidate_id', v_updated.id,
    'status', v_updated.status,
    'reviewed_by', v_updated.reviewed_by,
    'reviewed_at', v_updated.reviewed_at
  );
end;
$function$;

-- ── 5. Grants ─────────────────────────────────────────────────────────────
-- Matches the exact grant already present on approve_claim_request/
-- reject_claim_request: authenticated callers may invoke the function,
-- but the function's own is_admin_or_above() check -- not the grant -- is
-- the real authorization boundary, exactly as every other admin RPC in
-- this project already works.
grant execute on function public.approve_venue_enrichment_candidate(uuid, text) to authenticated;
grant execute on function public.reject_venue_enrichment_candidate(uuid, text) to authenticated;

-- CORRECTION (independent pre-merge review, PR #42): this project's own
-- default privileges (`pg_default_acl` for role postgres, object type
-- function, schema public) grant EXECUTE on every newly created public-
-- schema function to anon/authenticated/service_role automatically --
-- confirmed live against every comparable existing admin-review RPC
-- (reject_claim_request, log_claim_contact, request_more_information,
-- submit_claim_more_info), none of which retain anon in their actual
-- grants, meaning each of their own migrations explicitly revoked it.
-- Without the same revoke here, anon would keep EXECUTE by that same
-- default -- still unable to actually approve/reject anything (the
-- function's own is_admin_or_above() check independently blocks that
-- regardless of who can call it), but inconsistent with this project's
-- own established convention and with this migration's own stated
-- intent ("Grant execution only as appropriate for authenticated
-- callers"). Revoked explicitly rather than relying on the default.
revoke execute on function public.approve_venue_enrichment_candidate(uuid, text) from anon;
revoke execute on function public.reject_venue_enrichment_candidate(uuid, text) from anon;

comment on function public.approve_venue_enrichment_candidate(uuid, text) is
  'Phase 3C: admin-only approval of a pending venue_enrichment_candidates row. Never writes to public.venues. Stale live-venue values block approval and transition the row to stale_conflict instead.';
comment on function public.reject_venue_enrichment_candidate(uuid, text) is
  'Phase 3C: admin-only rejection of a pending venue_enrichment_candidates row. Never writes to public.venues. No live-venue staleness check (rejection can never be applied later).';
