-- Venue Data Enrichment, Phase 4B: individual Apply of an already-APPROVED
-- venue_enrichment_candidates row to the live public.venues row it targets.
--
-- SCOPE: this is the first migration in the whole Venue Enrichment feature
-- that is capable of writing to public.venues. It adds exactly one new
-- SECURITY DEFINER function (apply_venue_enrichment_candidate) plus the one
-- schema change that function's correct behaviour requires (see "Reviewed-
-- pairing constraint" below). It does NOT touch either already-applied
-- Phase 3C migration file, does NOT add/loosen any RLS policy on
-- venue_enrichment_candidates or public.venues, and does NOT add a bulk/
-- automatic apply path of any kind -- see this migration's own PR
-- description (Phase 4A architecture report) for the full design reasoning.
--
-- Builds directly on approve_venue_enrichment_candidate/
-- reject_venue_enrichment_candidate (20260918150000_venue_enrichment_
-- candidates_review.sql): same admin gate, same row-lock pattern, same
-- idempotency shape, same explicit 14-field allow-list (no dynamic SQL),
-- same grant/revoke pattern (get PUBLIC/anon right in THIS migration, not a
-- follow-up -- the exact lesson Phase 3C needed two separate corrective
-- production migrations to fully close).

-- ── 1. Reviewed-pairing constraint: allow a reviewed row to move past
--       'approved'/'rejected' without losing its reviewer stamp ──────────
--
-- The Phase 3C constraint (venue_enrichment_candidates_reviewed_pairing)
-- required reviewed_by/reviewed_at to be set for status IN ('approved',
-- 'rejected') and NULL for every other status. That was correct for Phase
-- 3C, where 'stale_conflict' could only be reached FROM 'pending' (a
-- candidate that was never reviewed at all, so reviewed_by/reviewed_at
-- were always NULL going in). Phase 4B adds two new ways to reach a status
-- outside {'approved','rejected'} from a row that WAS already reviewed:
--   - approved -> applied (this migration's own new transition)
--   - approved -> stale_conflict (the apply-time staleness re-check below,
--     which deliberately does NOT null out reviewed_by/reviewed_at/
--     review_notes -- the row genuinely WAS reviewed and approved; it is
--     the live venue data that moved on, not the admin's own decision)
-- The old blanket "not in (approved,rejected) => must be null" rule would
-- reject both of those UPDATEs outright. The new rule instead:
--   - still requires reviewed_by/reviewed_at for approved/rejected/applied
--     (applied can only ever be reached via approved, so this is always
--     already true by the time the UPDATE below runs)
--   - still requires them to be NULL for pending/skipped_no_source/
--     skipped_ambiguous (a candidate that was never reviewed)
--   - places NO constraint on stale_conflict specifically, since that one
--     status can legitimately arrive via either route (never-reviewed, at
--     approval time; or previously-reviewed, at apply time) and both are
--     valid, distinguishable via activity_log (see the two distinct
--     *_detected actions already established in Phase 3C and added here).
alter table public.venue_enrichment_candidates
  drop constraint venue_enrichment_candidates_reviewed_pairing;

alter table public.venue_enrichment_candidates
  add constraint venue_enrichment_candidates_reviewed_pairing
  check (
    (status in ('approved', 'rejected', 'applied') and reviewed_by is not null and reviewed_at is not null)
    or
    (status in ('pending', 'skipped_no_source', 'skipped_ambiguous') and reviewed_by is null and reviewed_at is null)
    or
    (status = 'stale_conflict')
  );

-- ── 2. Apply RPC ──────────────────────────────────────────────────────────
-- Admin-gated SECURITY DEFINER function -- the ONLY path by which a
-- candidate's status can move to 'applied', and the ONLY place in this
-- entire feature that ever writes to public.venues. Caller supplies
-- nothing but the candidate's own id -- there is no parameter for
-- suggested_value/venue_id/field, so none of them can be forged by the
-- caller; every value written comes exclusively from the already-approved,
-- row-locked candidate. `SET search_path TO ''` with every reference fully
-- qualified (public.*), matching every other SECURITY DEFINER function in
-- this project.
create or replace function public.apply_venue_enrichment_candidate(
  p_candidate_id uuid
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
    raise exception 'Only admins can apply venue enrichment candidates';
  end if;

  -- Row-locked for the remainder of this transaction -- same "the database,
  -- not the client, is authoritative for concurrent/racing calls" reasoning
  -- as approve_venue_enrichment_candidate.
  select * into v_candidate
  from public.venue_enrichment_candidates
  where id = p_candidate_id
  for update;

  if v_candidate is null then
    raise exception 'Venue enrichment candidate % not found', p_candidate_id;
  end if;

  -- Idempotent retry: re-applying an already-applied row is a safe no-op,
  -- not an error, and must not write a second venues update or a second
  -- activity_log entry.
  if v_candidate.status = 'applied' then
    return jsonb_build_object(
      'outcome', 'already_in_requested_state',
      'candidate_id', v_candidate.id,
      'status', v_candidate.status
    );
  end if;

  -- Every non-'approved' status is illegal to apply from -- explicitly
  -- covers pending/rejected/stale_conflict/skipped_no_source/
  -- skipped_ambiguous, naming the actual current status so the caller gets
  -- a specific, useful error.
  if v_candidate.status <> 'approved' then
    raise exception 'Candidate % cannot be applied from status % (must be approved)', p_candidate_id, v_candidate.status;
  end if;

  -- Exact UUID only -- candidate.venue_id, never a name/city/slug lookup.
  -- Also row-locked: this function is the first in the feature to write to
  -- public.venues, so a concurrent write to the SAME venue (another Apply
  -- call, a claim, a manual admin edit) must wait for this transaction
  -- rather than race it.
  select * into v_venue from public.venues where id = v_candidate.venue_id for update;

  -- Defensive only -- the venue_id foreign key (ON DELETE RESTRICT) should
  -- make this unreachable in normal operation, but handled explicitly
  -- rather than assumed.
  if v_venue is null then
    raise exception 'Venue % referenced by candidate % not found', v_candidate.venue_id, p_candidate_id;
  end if;

  -- Claimed-venue protection (Phase 4A architecture report, section I):
  -- a claimed venue's own owner/manager already has independent direct
  -- write access to these same columns via public.venues' own RLS
  -- ("Venue owner can update own venue" / "Venue manager can update
  -- assigned venue") -- auto-applying a researched suggestion over a
  -- claimed venue risks silently overwriting something that owner
  -- deliberately set. No override parameter, no override path: Phase 4B
  -- blocks unconditionally here. The candidate is left exactly as it was
  -- (still 'approved', reviewer/provenance untouched) so a future,
  -- separately-authorised override phase can revisit it.
  if v_venue.claimed then
    insert into public.activity_log (action, entity_type, entity_id, entity_name, performed_by)
    values (
      'venue_enrichment_candidate_apply_blocked_claimed_venue',
      'venue_enrichment_candidate',
      v_candidate.id,
      v_candidate.field || ' — ' || v_candidate.batch_id,
      auth.uid()
    );

    return jsonb_build_object(
      'outcome', 'blocked_claimed_venue',
      'candidate_id', v_candidate.id,
      'venue_id', v_candidate.venue_id,
      'field', v_candidate.field,
      'status', 'approved'
    );
  end if;

  -- Apply-time staleness re-check (Phase 4A architecture report, section
  -- F.8): required even though this candidate already passed the
  -- identical check once at approval time, because time has passed since
  -- and the live venue value could have moved on again. Explicit
  -- allow-listed field resolution -- deliberately NOT dynamic SQL, exactly
  -- mirroring approve_venue_enrichment_candidate's own resolver.
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

  -- Same blank/whitespace-normalised, null-safe comparison as
  -- approve_venue_enrichment_candidate.
  v_existing_norm := nullif(trim(both from coalesce(v_candidate.existing_value, '')), '');
  v_live_norm     := nullif(trim(both from coalesce(v_live_value, '')), '');

  if v_existing_norm is distinct from v_live_norm then
    -- STALE AT APPLY TIME: the live venue value has moved on since
    -- research (or since approval). Deliberately does NOT raise -- an
    -- exception here would roll back the very stale_conflict transition
    -- and audit event this branch exists to persist. Reuses the existing
    -- 'stale_conflict' status rather than a new value (see the reviewed-
    -- pairing constraint comment above for why reviewed_by/reviewed_at/
    -- review_notes are deliberately left untouched here, unlike the
    -- approval-time stale branch where they were never set to begin
    -- with).
    update public.venue_enrichment_candidates
    set status = 'stale_conflict'
    where id = v_candidate.id and status = 'approved'
    returning * into v_updated;

    insert into public.activity_log (action, entity_type, entity_id, entity_name, performed_by)
    values (
      'venue_enrichment_candidate_stale_at_apply_detected',
      'venue_enrichment_candidate',
      v_candidate.id,
      v_candidate.field || ' — ' || v_candidate.batch_id,
      auth.uid()
    );

    return jsonb_build_object(
      'outcome', 'stale_conflict',
      'candidate_id', v_candidate.id,
      'venue_id', v_candidate.venue_id,
      'field', v_candidate.field,
      'existing_value', v_candidate.existing_value,
      'live_value', v_live_value,
      'status', 'stale_conflict'
    );
  end if;

  -- Exact field apply: explicit allow-listed branches, one per the 14
  -- enrichment fields -- no dynamic SQL, so a 15th field can never be
  -- written here without also touching this IF chain, the field CHECK
  -- constraint, and the JS ENRICHMENT_FIELDS constant, all three
  -- independently. `field`/`venue_id`/`suggested_value` are never caller
  -- inputs -- every value written below comes only from the locked
  -- candidate row read above.
  if v_candidate.field = 'address' then
    update public.venues set address = v_candidate.suggested_value where id = v_candidate.venue_id;
  elsif v_candidate.field = 'postcode' then
    update public.venues set postcode = v_candidate.suggested_value where id = v_candidate.venue_id;
  elsif v_candidate.field = 'website' then
    update public.venues set website = v_candidate.suggested_value where id = v_candidate.venue_id;
  elsif v_candidate.field = 'phone' then
    update public.venues set phone = v_candidate.suggested_value where id = v_candidate.venue_id;
  elsif v_candidate.field = 'contact_email' then
    update public.venues set contact_email = v_candidate.suggested_value where id = v_candidate.venue_id;
  elsif v_candidate.field = 'facebook' then
    update public.venues set facebook = v_candidate.suggested_value where id = v_candidate.venue_id;
  elsif v_candidate.field = 'instagram' then
    update public.venues set instagram = v_candidate.suggested_value where id = v_candidate.venue_id;
  elsif v_candidate.field = 'twitter' then
    update public.venues set twitter = v_candidate.suggested_value where id = v_candidate.venue_id;
  elsif v_candidate.field = 'capacity' then
    -- Explicit integer conversion -- a non-numeric suggested_value raises
    -- invalid_text_representation here, uncaught, aborting the whole
    -- function (and therefore the whole transaction): no silent
    -- coercion, no partial write. This should be unreachable in practice
    -- (suggested_value for an approved capacity candidate was already
    -- reviewed as text by an admin), but the cast is never trusted
    -- blindly.
    update public.venues set capacity = v_candidate.suggested_value::integer where id = v_candidate.venue_id;
  elsif v_candidate.field = 'description' then
    update public.venues set description = v_candidate.suggested_value where id = v_candidate.venue_id;
  elsif v_candidate.field = 'photo_url' then
    update public.venues set photo_url = v_candidate.suggested_value where id = v_candidate.venue_id;
  elsif v_candidate.field = 'seo_title' then
    update public.venues set seo_title = v_candidate.suggested_value where id = v_candidate.venue_id;
  elsif v_candidate.field = 'seo_description' then
    update public.venues set seo_description = v_candidate.suggested_value where id = v_candidate.venue_id;
  elsif v_candidate.field = 'seo_search_phrases' then
    update public.venues set seo_search_phrases = v_candidate.suggested_value where id = v_candidate.venue_id;
  else
    -- Unreachable under normal operation -- venue_enrichment_candidates_
    -- field_check already restricts `field` to exactly these 14 values.
    -- Kept as a defensive fallback rather than an assumption.
    raise exception 'Candidate % has unrecognised field %', p_candidate_id, v_candidate.field;
  end if;

  -- Candidate only becomes 'applied' AFTER the venues UPDATE above has
  -- already succeeded -- both statements run in the same function
  -- invocation/transaction, so any failure anywhere above (including the
  -- capacity cast) rolls back this UPDATE too, leaving the candidate
  -- 'approved' and public.venues untouched. reviewed_by/reviewed_at/
  -- review_notes are left exactly as they were set at approval time --
  -- never overwritten here.
  update public.venue_enrichment_candidates
  set status = 'applied'
  where id = v_candidate.id and status = 'approved'
  returning * into v_updated;

  -- Unreachable under normal operation -- the FOR UPDATE lock on the
  -- candidate row holds it exclusively from the initial SELECT through
  -- this UPDATE. Kept as a defensive fallback, same shape as
  -- approve_venue_enrichment_candidate's own.
  if v_updated is null then
    select * into v_candidate from public.venue_enrichment_candidates where id = p_candidate_id;
    return jsonb_build_object(
      'outcome', 'already_reviewed',
      'candidate_id', v_candidate.id,
      'status', v_candidate.status
    );
  end if;

  -- Never copies suggested_value/existing_value/source_url/notes into
  -- activity_log -- same convention as approve/reject.
  insert into public.activity_log (action, entity_type, entity_id, entity_name, performed_by)
  values (
    'venue_enrichment_candidate_applied',
    'venue_enrichment_candidate',
    v_updated.id,
    v_updated.field || ' — ' || v_updated.batch_id,
    auth.uid()
  );

  -- Deliberately does not include reviewed_by (or any other account/user
  -- identifier) in the success result -- the UI does not need it to
  -- refresh safely, and this function's own result should not expose
  -- unnecessary account data.
  return jsonb_build_object(
    'outcome', 'applied',
    'candidate_id', v_updated.id,
    'venue_id', v_updated.venue_id,
    'field', v_updated.field,
    'applied_value', v_updated.suggested_value,
    'status', v_updated.status
  );
end;
$function$;

-- ── 3. Grants ─────────────────────────────────────────────────────────────
-- Correct from this first migration, per the Phase 3C lesson (learned
-- across two separate corrective production migrations): a bare
-- `GRANT ... TO authenticated` is not enough by itself, because
-- PostgreSQL's own CREATE FUNCTION implicitly grants EXECUTE to PUBLIC
-- (a separate mechanism from this project's own ALTER DEFAULT PRIVILEGES,
-- which additionally grants EXECUTE to anon/authenticated/service_role on
-- every new public-schema function). All three statements below --
-- the authenticated grant, the anon revoke, AND the PUBLIC revoke -- are
-- included in this one migration, not split across a later hardening
-- follow-up. The function's own is_admin_or_above() check remains the real
-- authorization boundary regardless -- these grants are defence in depth,
-- matching this project's own established convention.
grant execute on function public.apply_venue_enrichment_candidate(uuid) to authenticated;
revoke execute on function public.apply_venue_enrichment_candidate(uuid) from anon;
revoke execute on function public.apply_venue_enrichment_candidate(uuid) from public;

comment on function public.apply_venue_enrichment_candidate(uuid) is
  'Phase 4B: admin-only application of an already-approved venue_enrichment_candidates row to the one live public.venues field it targets. Re-checks staleness at apply time (moves to stale_conflict, no venues write, if the live value has moved on) and unconditionally blocks (no override) applying against a claimed venue. The only function in this feature that writes to public.venues.';
