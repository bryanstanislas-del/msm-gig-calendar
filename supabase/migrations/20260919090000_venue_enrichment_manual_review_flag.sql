-- Venue Data Enrichment, Phase 5D: persisted, explicit "this venue's
-- enrichment candidates need a human before any bulk action" signal.
--
-- SCOPE / WHY THIS EXISTS: the Phase 5C consolidated audit identified 75
-- production venues whose staged venue_enrichment_candidates rows carry an
-- identity/duplicate/location/event/capacity caution (e.g. two manifest
-- rows for the same physical pub under different names, a festival that is
-- an event rather than a fixed venue, a venue whose city field doesn't
-- match its real location). That audit's own classification lived only in
-- free-text `notes` plus one-off cross-batch analysis in a chat session --
-- NOT in any structured, queryable column. Phase 5D adds venue-level bulk
-- Approve/Apply RPCs that must never touch those 75 venues, and doing that
-- safely requires a real persisted fact to check, not fragile ILIKE/regex
-- matching against `notes` re-run inside a SECURITY DEFINER function (notes
-- is free-text research narrative, was never designed as a machine-readable
-- signal, and a future batch's phrasing could easily fail to match).
--
-- IMPORTANT -- what this flag does NOT mean: it is an ENRICHMENT REVIEW
-- SAFETY signal only. `true` means "do not let a venue-level bulk RPC touch
-- this venue's candidates without a human looking at them individually
-- first" -- nothing more. It does NOT mean the venue is invalid, is
-- definitely a duplicate, is unsuitable for publication, or is permanently
-- problematic. Many of the 75 venues below are perfectly legitimate real
-- venues that simply need a human to resolve an identity/location/event/
-- capacity question before their candidates are bulk-processed. Individual
-- candidate Approve/Reject/Apply (Phase 3C/4B, unchanged by this migration)
-- remain fully available for every one of these 75 venues regardless of
-- this flag.
--
-- This migration deliberately does NOT try to auto-detect manual-review
-- venues going forward, and does NOT clear the flag for anything -- both
-- are explicitly out of scope per the Phase 5D task. A future batch that
-- wants to flag a new venue, or an admin who wants to clear one after
-- resolving it, does so as its own separate, deliberate action (a later
-- migration, or a future admin data-quality tool) -- never automatically.

-- Explicit transaction wrapper: without this, plain autocommit execution
-- (e.g. `psql -f` with no surrounding BEGIN) would commit the ALTER TABLE
-- below as its own independent statement BEFORE the backfill DO block even
-- runs -- so a safety-check failure in the backfill would still leave the
-- new column permanently added (harmless on its own, defaulting to false
-- everywhere, but it would make a corrected re-run of this exact file fail
-- immediately with "column already exists" instead of cleanly retrying the
-- whole migration). Wrapping both steps in one explicit transaction makes
-- "fail rather than partially backfill" (this migration's own stated
-- requirement) apply to the ENTIRE migration, not just the backfill's own
-- internal checks, independent of whatever transaction behaviour the
-- migration runner itself defaults to (issuing BEGIN when a transaction is
-- already open is a harmless no-op/notice in Postgres, so this is safe
-- either way).
begin;

-- ── 1. The column ─────────────────────────────────────────────────────────
alter table public.venues
  add column venue_enrichment_manual_review boolean not null default false;

comment on column public.venues.venue_enrichment_manual_review is
  'Phase 5D: true = this venue''s venue_enrichment_candidates rows must never be processed by a venue-level bulk Approve/Apply RPC -- individual candidate review remains available. Enrichment-review-safety signal ONLY: does not mean invalid, a confirmed duplicate, unpublishable, or permanently problematic. Set explicitly by this migration''s own one-time backfill (see below) or by a future, separately-authorised admin/data-quality action -- never auto-computed from notes text, and never auto-cleared.';

-- ── 2. One-time explicit backfill ────────────────────────────────────────
-- Exactly the 75 venue UUIDs identified and independently verified by the
-- Phase 5C consolidated audit's MANUAL_REVIEW_VENUES set (duplicate pairs,
-- address-stuffed names, unidentifiable venues, event/not-fixed-venue rows,
-- city/location mismatches, co-located-but-distinct spaces, and genuinely
-- distinct venues that merely share a name). Every id below is an exact
-- UUID literal copied from that audit's own verified output -- there is no
-- name/address/notes matching, no LIKE/ILIKE, and no fuzzy logic anywhere
-- in this migration. If the exact expected set cannot be safely
-- established (wrong count, a missing venue, an unexpectedly-claimed
-- venue), every check below fails loudly and the whole migration transaction
-- aborts -- there is no partial-backfill code path.
do $$
declare
  v_target_ids uuid[] := array[
    'b89c7eb5-7e00-4489-a9c1-accfec893e9a', 'e5a7cd18-ccce-4e13-98c7-1682659afd60',
    '2a063f31-ac26-472d-94d8-f09b6df54ce0', '8dd70125-3184-417f-9d2e-bdb2b6ac9cbf',
    '6147e9f4-c21b-4a1c-a914-d426744ac091', '1b940076-7337-4652-8d3c-55a28487c0f1',
    '5937591d-fb28-42ff-8b74-abe8c0293e3a', 'd4398da9-0cf1-47ac-9a0a-4643c7c46060',
    'b97c4f5c-e4f1-4044-b3d4-753b110d0f68', '9efe6078-4972-463c-87cb-f31b33514f56',
    'ce729f59-53bb-4392-83cd-9477f5037c88', '8cc576e4-2210-43ce-9383-c53326bddd72',
    '14d84a6b-12e0-4aed-ac6e-deb224a92c61', '9d57b6d7-801d-4b31-921b-b8c95beecc47',
    'f3ef59da-69ea-4b4a-bba8-944d85a81962', '63be3304-63fc-45f9-bd42-ae2c5756bc2b',
    '72d6adb5-f5f2-4240-b401-ffe491d137de', 'a5c542fe-2917-46ed-9de4-340163badce9',
    'b93f0678-a294-4b69-9548-2d14397cd1cc', 'e020c6c1-9761-4054-b12c-2a7bbed3a195',
    '804517b6-1a3d-49ce-9f19-0e1c410fd4ea', '6249e549-f78f-4395-9fc4-f63cb65532fe',
    '3fdb72f4-5806-46ba-8934-ddc912c0b4e8', '26d52c71-62b3-4964-89f4-1027b2be18b2',
    'eef8582f-ee0b-4b8f-a581-beb763636595', 'cb293e68-9b65-4d19-aca1-c323898d5e28',
    'd95d2ee8-0a60-4c55-a573-d826425427cb', '07dae5ea-d4ab-4725-b0e1-2af4a4a05b2e',
    'd89ee0a9-e23c-4d42-acda-33c50887666b', 'd00f76a0-9383-46cc-aeb2-888fa82282ac',
    '3bbeec9a-b764-4ad8-92e5-33d56a4c8b3e', '1aaec581-aa2d-4c73-b885-feac486e306f',
    '8bf1f309-eaa9-41db-b2d4-f5e6c5e74015', '04194481-9120-4da7-bd6e-edb895927386',
    'c5b6e3a4-ce82-421d-bdee-9f25d394a4a0', '2822004a-86bf-4d21-8127-9eb92e6956f8',
    'a3c90111-f0e4-4201-b55b-d490adafe75d', '2fec341a-3cde-451c-8c9b-38bf833f1697',
    '25b7f212-272a-409f-8bb9-391d277858f3', '5eb3e126-b59e-4a7d-a7df-9d521b506d38',
    '6f32ca10-d2d5-46c2-89f4-8f255850f4f9', '9012581d-07f3-4883-bf6a-24d46eebb685',
    '18927a2f-775b-45de-8042-9b6e7a4190db', 'da437324-15ae-4015-b13a-489fd8cdd16c',
    'd0203b83-4475-4397-bf81-9d03da50d11d', '07fb5ae1-60ba-489f-93d5-0b18b2ec36d0',
    '75d7d7b9-e2fb-49c8-9920-bdc10f758f9e', '654c4167-b894-458f-b480-0f4528734510',
    '8a7b6646-4ac4-4be2-b064-c2b3e0f737ea', '6ee0cefc-2630-41e7-a221-3f8994a5112d',
    'eb7ea7cb-ab62-41cb-88b3-9fe9ba0f0084', '662cc91a-2815-4d73-85c1-46783e6f7bc3',
    '6b17917b-eee2-43ec-83eb-28c663aa15e0', '2096f8c8-4957-485a-bd44-53132531e206',
    'd10500b8-1096-4ad2-83ed-13f6649650f2', 'd3633ac8-5b6b-4441-bf6a-f5d6178d2966',
    '8477f1de-9f31-4c9c-bde6-06270458fd06', 'e33160cd-7723-4a99-9e8c-4fd9038570cc',
    '7a38b448-b4bf-47d4-a8b6-848764f9ac17', '34a419f0-a01e-4327-968c-34c49bdee871',
    '5063e994-9473-49d0-9e4b-db237bba0432', '09562c0c-a961-44c8-a4db-db8d096a33af',
    'a8ad4cee-6387-49fb-9ab6-b8ce9127fbf3', '9db13180-ae93-4c89-b3ee-4c3bc505f948',
    '3c48ee4f-ce86-4617-a2c6-adbca6271e23', '2cba0ded-bc22-4cf6-a36e-0aacd378b477',
    '20761432-fb69-4631-b799-158921758b92', '2ee142f5-6e2e-4a34-a6b6-1e2cd20ab7d2',
    'f39f91cf-0754-4fd6-bc10-41b9ce2b9aa9', 'e7d4f30b-be66-4c31-b53c-0a76dc2d4673',
    '7bce9038-9707-43e2-acee-10194aded72f', '4f6bf7da-70b7-4f08-8516-6a30c8b35205',
    'ce194e5d-8ee1-410b-9fd7-bae7c4ab4340', '21191fb0-2608-4f52-a8d6-733a2a42e2d4',
    '9c23bc96-64ce-45d4-89db-2ebfb71ac258'
  ];
  v_expected_count int := 75;
  v_distinct_count int;
  v_existing_count int;
  v_claimed_count int;
  v_already_flagged_count int;
  v_updated_count int;
  v_final_true_count int;
begin
  -- Check 1: the literal array itself must contain exactly 75 DISTINCT ids
  -- -- catches a copy-paste duplicate before it ever touches the database.
  select count(distinct x) into v_distinct_count from unnest(v_target_ids) as x;
  if array_length(v_target_ids, 1) <> v_expected_count or v_distinct_count <> v_expected_count then
    raise exception 'Phase 5D backfill aborted: expected exactly % distinct target UUIDs, found % literals (% distinct) -- refusing to proceed with a mismatched list', v_expected_count, array_length(v_target_ids, 1), v_distinct_count;
  end if;

  -- Check 2: every target UUID must already exist in public.venues. A
  -- missing venue means the list itself is wrong (a typo, a venue since
  -- deleted) -- this must fail loudly, never silently backfill a subset.
  select count(*) into v_existing_count from public.venues where id = any(v_target_ids);
  if v_existing_count <> v_expected_count then
    raise exception 'Phase 5D backfill aborted: % of the % target UUIDs exist in public.venues, expected all %  -- refusing a partial backfill', v_existing_count, v_expected_count, v_expected_count;
  end if;

  -- Check 3: none of the 75 target venues may be claimed. Every one of
  -- them is a Phase 5A/5B production research candidate, and the Phase 5C
  -- audit independently confirmed zero claimed venues among any PROD batch
  -- candidate rows -- if one of these UUIDs resolves to a claimed venue,
  -- that is itself evidence of a wrong UUID in this list (this flag is
  -- venue-enrichment-review safety, not a claimed-venue mechanism, and a
  -- claimed venue being unexpectedly swept in here would indicate a
  -- transcription mistake, not an intended target).
  select count(*) into v_claimed_count from public.venues where id = any(v_target_ids) and claimed;
  if v_claimed_count <> 0 then
    raise exception 'Phase 5D backfill aborted: % of the target UUIDs resolve to a CLAIMED venue, expected 0 -- this indicates a wrong UUID in the list, refusing to proceed', v_claimed_count;
  end if;

  -- Check 4: the flag must be all-default (false) on every target row
  -- before this backfill -- the column was only just added above in this
  -- same migration, so this should be structurally guaranteed, but checked
  -- explicitly rather than assumed (defends against this migration ever
  -- being re-run against a database where it partially applied before).
  select count(*) into v_already_flagged_count from public.venues where id = any(v_target_ids) and venue_enrichment_manual_review;
  if v_already_flagged_count <> 0 then
    raise exception 'Phase 5D backfill aborted: % target venues already have venue_enrichment_manual_review = true before this backfill ran, expected 0 -- refusing to proceed against unexpected pre-existing state', v_already_flagged_count;
  end if;

  -- ── The only mutation in this migration: flip exactly these 75 rows,
  --    exact UUID identity only, nothing else touched. ────────────────────
  update public.venues
  set venue_enrichment_manual_review = true
  where id = any(v_target_ids);
  get diagnostics v_updated_count = row_count;

  if v_updated_count <> v_expected_count then
    raise exception 'Phase 5D backfill aborted: UPDATE affected % rows, expected exactly % -- transaction will roll back', v_updated_count, v_expected_count;
  end if;

  -- Post-check: exactly 75 rows in the whole table carry the flag now (not
  -- more, not fewer) -- catches, for example, a stray duplicate id in the
  -- literal array that Check 1 already should have caught, belt-and-braces.
  select count(*) into v_final_true_count from public.venues where venue_enrichment_manual_review;
  if v_final_true_count <> v_expected_count then
    raise exception 'Phase 5D backfill aborted: % venues carry venue_enrichment_manual_review = true after the backfill, expected exactly % -- transaction will roll back', v_final_true_count, v_expected_count;
  end if;

  raise notice 'Phase 5D manual-review backfill: exactly % venues flagged, all checks passed', v_final_true_count;
end $$;

commit;
