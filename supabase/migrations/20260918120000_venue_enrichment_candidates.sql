-- Venue Data Enrichment, Phase 1: the staging/audit table for researched
-- venue-field suggestions. See this engagement's own Phase 0 (read-only
-- architecture/data-completeness audit) and this migration's own PR
-- description for the full reasoning.
--
-- SCOPE: this is STAGING/AUDIT DATA ONLY. It never modifies public.venues
-- (no trigger, no function here touches that table), and this phase adds
-- no mechanism capable of writing to it either -- there is deliberately no
-- apply_venue_enrichment_field() (or equivalent) RPC in this migration.
-- That belongs to a later, separately-authorised phase, after the
-- research/review workflow this table supports has been proven out. This
-- table's own RLS (below) also means the ordinary admin UI cannot write to
-- public.venues via this table either -- there is no path from here to
-- there yet.
--
-- ONE ROW PER (venue, field, research batch): a single research run over a
-- batch of venues produces at most one candidate row per venue+field it
-- looked at (see the UNIQUE index below) -- including a "looked at this
-- field, found nothing reliable" row (status='skipped_no_source' or
-- 'skipped_ambiguous', suggested_value NULL), so a later resumed/retried
-- run can tell "not yet researched" apart from "researched, no answer
-- found" for the same field. A LATER, separate research batch (a fresh
-- batch_id) is free to produce its own row for the same venue+field --
-- e.g. a venue re-researched months later, or a field manually re-flagged
-- for another pass -- so history isn't destroyed by re-running research.
--
-- NOT YET APPLIED TO PRODUCTION as of this PR -- see the PR description.
-- No apply engine exists yet; nothing in this migration or the
-- accompanying application code can cause a row here to ever reach
-- 'applied' automatically (see the status CHECK constraint's own comment).

create table public.venue_enrichment_candidates (
  id uuid primary key default gen_random_uuid(),

  -- Exact identity only -- see the Phase 0 audit's own "Existing Venue
  -- Identity System" findings: venue_id is the one authoritative way to
  -- reference a venue anywhere in this system, never a name/city lookup.
  -- ON DELETE RESTRICT (independent-review correction -- see PR #40's own
  -- review, not CASCADE as originally proposed): this table is intended to
  -- become provenance/audit history -- once a candidate can reach
  -- approved/applied, it is a record of WHERE a production value came
  -- from, not disposable derived data. CASCADE would let a venue deletion
  -- silently destroy that history along with the venue. RESTRICT instead
  -- forces whoever deletes a venue to consciously deal with its
  -- enrichment history first (delete/archive its candidate rows
  -- explicitly) -- acceptable friction, since venue deletion is already a
  -- rare, admin-only, explicitly confirmed action (see AdminVenues' own
  -- "type DELETE to confirm" flow). SET NULL was considered and rejected:
  -- venue_id is this table's only identity anchor (no denormalised
  -- name/city snapshot exists here), so a nulled row would become
  -- meaningless orphan data rather than a usable audit record -- venue_id
  -- stays NOT NULL and remains the sole, authoritative identity.
  venue_id uuid not null references public.venues(id) on delete restrict,

  -- Strict allow-list -- the exact 14 enrichment fields from the Phase 0
  -- audit, and NOTHING else. This is what makes it structurally impossible
  -- for a staged candidate to ever target id/name/city/slug/user_id/
  -- claimed/claim_status/verified/admin_created, etc., regardless of what
  -- any future caller (admin UI, research tooling, a bug) tries to insert
  -- -- enforced here at the database layer, not only by application code's
  -- own discipline (mirrors src/venueEnrichment/researchExport.js's own
  -- ENRICHMENT_FIELDS constant -- see that file's header comment for why
  -- both copies must be kept in sync by hand).
  field text not null,
  constraint venue_enrichment_candidates_field_check
    check (field = any (array[
      'postcode', 'address', 'capacity', 'contact_email', 'phone',
      'description', 'website', 'facebook', 'instagram', 'twitter',
      'photo_url', 'seo_title', 'seo_description', 'seo_search_phrases'
    ])),

  -- Snapshot of the venue field's own value at RESEARCH TIME (NULL means
  -- the field was blank/missing when researched -- the normal case this
  -- whole system exists for). THIS IS NOT LIVE DATA and must never be
  -- treated as such: a future apply engine (not built in this phase) is
  -- expected to re-read the venue's actual current value immediately
  -- before writing and compare it against this snapshot, skipping with
  -- status='stale_conflict' if the two disagree (i.e. the venue changed
  -- since research ran) rather than overwriting blind. This column exists
  -- purely to make that future optimistic-concurrency check possible --
  -- Phase 1 itself performs no such check and writes nothing to
  -- public.venues at all.
  existing_value text,

  -- The researched candidate value, or NULL for a row that exists only to
  -- record "this field was considered and no reliable suggestion resulted"
  -- (status='skipped_no_source'/'skipped_ambiguous' -- see the status
  -- CHECK below, which requires exactly this pairing). Deliberately typed
  -- text even though public.venues.capacity is integer: a proposed
  -- capacity may legitimately be an ambiguous free-text description (e.g.
  -- "450 standing / 280 seated") that a future admin reviews as text
  -- before any numeric value is ever cast and written -- see this
  -- migration's own PR description for the full capacity-ambiguity
  -- reasoning. Casting/validating into the real integer column is
  -- explicitly future apply-engine work, not this phase's.
  suggested_value text,

  -- Where the fact came from. Nullable because source_url specifically is
  -- not required merely because source_type is present -- a 'generated'
  -- editorial candidate (see source_type below) legitimately has no
  -- single external source_url at all, its provenance being the batch's
  -- own verified factual candidates instead (see the `notes` column's own
  -- comment). NULL alongside a skipped_* status, same reasoning as
  -- source_type/confidence below.
  source_url text,

  -- Controlled provenance vocabulary. 'generated' is distinct from the six
  -- real external-source types: it marks an MSM editorial/SEO field
  -- (description/seo_title/seo_description/seo_search_phrases) produced
  -- from this batch's OWN verified factual candidates rather than fetched
  -- from an external page -- see the `notes` column's own comment for how
  -- that provenance is still recorded. Nullable only alongside a
  -- skipped_* status -- see
  -- venue_enrichment_candidates_found_has_provenance below, which is what
  -- actually enforces this pairing now (independent-review correction:
  -- previously only the JS validator enforced it, not the database).
  source_type text,
  constraint venue_enrichment_candidates_source_type_check
    check (source_type is null or source_type = any (array[
      'official_site', 'official_social', 'operator_site',
      'ticketing_platform', 'press', 'other', 'generated'
    ])),

  retrieved_at timestamptz,

  -- Three-tier confidence only -- deliberately no numeric score (a
  -- fabricated-precision "87% confident" would misrepresent what is
  -- actually a qualitative editorial judgement about source reliability).
  -- Nullable only alongside a skipped_* status -- same
  -- venue_enrichment_candidates_found_has_provenance enforcement as
  -- source_type above.
  confidence text,
  constraint venue_enrichment_candidates_confidence_check
    check (confidence is null or confidence = any (array['HIGH', 'MEDIUM', 'LOW'])),

  -- Free text. For a 'generated' candidate this MUST explain which of this
  -- same batch's verified factual candidates the generated text is built
  -- from (application-level contract, documented in
  -- src/venueEnrichment/RESEARCH_CONTRACT.md -- not itself machine-checked
  -- by a CHECK constraint here, since "does this prose actually only cite
  -- the facts it claims to" isn't a property SQL can verify; it IS
  -- machine-checked at the structural level -- "a non-blank explanation is
  -- present at all" -- by researchFormat.js's own validateCandidate()).
  notes text,

  -- The review/apply lifecycle. Deliberately the smallest sufficient set:
  --   pending             -- awaiting admin review (the only status a
  --                          freshly-researched, sourced candidate ever
  --                          starts in)
  --   approved            -- an admin has approved this suggestion for
  --                          eventual application (still not applied)
  --   rejected            -- an admin declined it
  --   applied             -- a (future) apply engine wrote it to
  --                          public.venues -- NOTHING in this phase can
  --                          ever produce this value; there is no INSERT
  --                          or UPDATE anywhere in this codebase yet that
  --                          sets status='applied', by design (see this
  --                          migration's PR description)
  --   stale_conflict      -- the future apply engine found existing_value
  --                          no longer matches the venue's live value
  --   skipped_no_source   -- researched, no reliable source found
  --   skipped_ambiguous   -- researched, identity/fact too ambiguous to
  --                          trust (see the Phase 0 audit's own venue-
  --                          identity safety requirements)
  status text not null default 'pending',
  constraint venue_enrichment_candidates_status_check
    check (status = any (array[
      'pending', 'approved', 'rejected', 'applied',
      'stale_conflict', 'skipped_no_source', 'skipped_ambiguous'
    ])),

  -- A skipped_* row is a "nothing to suggest" marker -- pairing it with a
  -- non-null suggested_value would misrepresent a should-be-empty result
  -- as an actual proposal, and vice versa: any other status represents a
  -- real candidate and must carry one. Encodes "no source = no factual
  -- candidate" (Phase 0/PR contract) at the database layer, not only in
  -- application code.
  constraint venue_enrichment_candidates_skip_has_no_value
    check (
      (status in ('skipped_no_source', 'skipped_ambiguous') and suggested_value is null)
      or
      (status not in ('skipped_no_source', 'skipped_ambiguous') and suggested_value is not null)
    ),

  -- Independent-review correction: the constraint above only paired
  -- status with suggested_value -- it said nothing about source_type/
  -- confidence, so a malformed row could previously claim
  -- status='pending' with a real suggested_value but source_type/
  -- confidence both NULL, which the JS validator (researchFormat.js's
  -- validateCandidate()) already rejected but the database did not.
  -- This closes that gap at the database layer, matching the same
  -- "no source = no factual candidate" invariant this table's field
  -- allow-list already enforces structurally rather than only by
  -- application discipline: a skipped_* row (nothing found/too
  -- ambiguous) must carry no source_type/confidence, and every other
  -- status (a real candidate, however far along its review lifecycle)
  -- must carry both. Deliberately does NOT also require source_url --
  -- see source_url's own column comment for why a 'generated' editorial
  -- candidate legitimately has none.
  constraint venue_enrichment_candidates_found_has_provenance
    check (
      (status in ('skipped_no_source', 'skipped_ambiguous') and source_type is null and confidence is null)
      or
      (status not in ('skipped_no_source', 'skipped_ambiguous') and source_type is not null and confidence is not null)
    ),

  -- Which research run produced this row -- see this migration's own PR
  -- description ("Batch identity") for why this is a plain text label
  -- (e.g. "VENUE-ENRICH-001") rather than a foreign key into a new,
  -- separate batch-management table: nothing in this phase needs batch-
  -- level metadata (a start time, an operator, a status) beyond grouping
  -- and ordering candidate rows, and a human-readable label is directly
  -- useful in ad-hoc admin review queries before any Review UI exists. A
  -- real batches table remains a clean, additive option later if a
  -- genuine need (e.g. per-batch progress tracking across a restart)
  -- shows up -- not manufactured speculatively now.
  --
  -- Independent-review correction: NOT NULL alone still let ''/'   '
  -- through -- a blank label defeats the whole point of grouping rows for
  -- checkpointing/review, and the JS output validator already rejected a
  -- blank batch label at the application layer without the database
  -- mirroring it. venue_enrichment_candidates_batch_id_not_blank below
  -- closes that gap the same way -- still just one CHECK, no separate
  -- batches table.
  batch_id text not null,
  constraint venue_enrichment_candidates_batch_id_not_blank
    check (trim(batch_id) <> ''),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- At most one row per (venue, field) WITHIN a single research batch --
  -- see this table's own header comment above for the full reasoning
  -- (prevents hundreds of accidental duplicate inserts from one run
  -- re-processing the same venue, while a later batch_id still gets its
  -- own row and full history is preserved across runs).
  constraint venue_enrichment_candidates_unique_per_batch
    unique (venue_id, field, batch_id)
);

comment on table public.venue_enrichment_candidates is
  'Venue Data Enrichment, Phase 1: staging/audit-only research candidates with provenance, confidence and review state. Never written to by any trigger/function; never modifies public.venues; no apply mechanism exists yet. See migration header comment.';

alter table public.venue_enrichment_candidates enable row level security;

-- Internal research/moderation data -- no public or ordinary-authenticated
-- access, and deliberately no owner/manager carve-out either: being the
-- claimed owner or an assigned manager of the venue a candidate happens to
-- reference grants no access to this table (see the Phase 0 audit's own
-- "claimed venue safety" principle -- a venue's own owner should not see,
-- let alone influence, MSM's internal research queue about their listing
-- before MSM has reviewed it). Reuses public.is_admin_or_above() exactly
-- as-is (already SECURITY DEFINER, already relied on by promo_slots'
-- equivalent admin policies) -- not redefined here -- which already covers
-- both the admin and super_admin cases the current RBAC distinguishes.
-- A single ALL policy (rather than promo_slots' own split
-- admin-select/admin-update pair) is the better match for THIS table's
-- shape: promo_slots splits because it also has a public-select policy to
-- keep separate from admin access; this table has no public access at
-- all, so one combined policy is the smaller, equally-safe design -- the
-- same single-ALL-policy shape public.venues' own "Admins can manage
-- venues" policy already uses.
create policy "venue_enrichment_candidates_admin_all" on public.venue_enrichment_candidates
  for all using (public.is_admin_or_above()) with check (public.is_admin_or_above());

-- Lookups by venue (review screen, future apply engine) and by batch
-- (checkpointing a resumed research run, per-batch review) are the two
-- access patterns Phase 1 already anticipates; status is the third (an
-- admin review screen listing pending candidates). The UNIQUE constraint
-- above already provides a composite (venue_id, field, batch_id) index --
-- these add the narrower single-column lookups it doesn't cover.
create index venue_enrichment_candidates_venue_id_idx on public.venue_enrichment_candidates (venue_id);
create index venue_enrichment_candidates_batch_id_idx on public.venue_enrichment_candidates (batch_id);
create index venue_enrichment_candidates_status_idx on public.venue_enrichment_candidates (status);

-- Reuses the existing generic update_updated_at() trigger function already
-- used by venues/featured_listings/editorial_features/promo_slots -- not
-- redefined here.
create trigger venue_enrichment_candidates_updated_at
  before update on public.venue_enrichment_candidates
  for each row execute function update_updated_at();
