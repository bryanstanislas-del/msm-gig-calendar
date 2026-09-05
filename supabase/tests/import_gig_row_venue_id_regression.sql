-- Regression proof for the import_gig_row p_venue_id addition (see
-- migration 20260905090000_import_gig_row_venue_id.sql for the full
-- rationale). Not a migration -- never applied automatically, safe to run
-- standalone at any time: it wraps itself in BEGIN/ROLLBACK, and it
-- APPLIES THE PROPOSED FUNCTION DEFINITION ITSELF inside that same
-- transaction (so this file is self-contained -- it does not require the
-- migration to already be applied), so nothing it does ever persists,
-- regardless of pass or fail. Run against a branch/local DB (or,
-- exceptionally, directly against production inside this same
-- rolled-back transaction) with:
--   psql "$DATABASE_URL" -f supabase/tests/import_gig_row_venue_id_regression.sql
--
-- Every check RAISEs EXCEPTION with a distinct message on failure, so a
-- silent "COMMIT" (never reached -- see the final ROLLBACK) or a clean
-- "NOTICE: import_gig_row p_venue_id regression: ALL CHECKS PASSED" is
-- the signal. Uses ZZTEST-prefixed names/cities throughout so nothing
-- here can ever collide with real venue/gig data even mid-transaction.

begin;

-- ── Apply the proposed migration itself, byte-for-byte (DROP the current
--    17-arg signature, then CREATE the 18-arg replacement) -- inside this
--    transaction only, fully undone by the final ROLLBACK either way.
--    Skipping the DROP would leave BOTH signatures live for the rest of
--    this test, defeating the entire point of the overload-safety check
--    near the end of this file. ──
drop function if exists public.import_gig_row(
  uuid, text, text, text, date, text, text, text, text, uuid, text,
  jsonb, jsonb, text, text, text, uuid
);

create or replace function public.import_gig_row(
  p_import_run_id uuid,
  p_band_name text,
  p_venue text,
  p_city text,
  p_date date,
  p_time text,
  p_genre text,
  p_notes text,
  p_tickets text,
  p_band_profile_id uuid,
  p_raw_text text,
  p_parsed_fields jsonb default null,
  p_match_decisions jsonb default null,
  p_venue_address text default null,
  p_venue_postcode text default null,
  p_venue_website text default null,
  p_festival_profile_id uuid default null,
  p_venue_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_slug text;
  v_gig_id uuid;
  v_attempt int;
  v_venue_id uuid;
  v_venue_name_norm text;
  v_venue_city_norm text;
  v_venue_slug text;
begin
  if not public.is_admin_or_above() then
    raise exception 'Only admins can import gig rows';
  end if;

  if p_venue_id is null
     and p_venue is not null and trim(p_venue) <> '' and p_city is not null and trim(p_city) <> ''
     and (p_venue_address is not null or p_venue_postcode is not null or p_venue_website is not null) then
    v_venue_name_norm := lower(trim(regexp_replace(p_venue, '\s+', ' ', 'g')));
    v_venue_city_norm := lower(trim(p_city));

    select id into v_venue_id
    from public.venues
    where name_normalised = v_venue_name_norm
    and lower(trim(city)) = v_venue_city_norm
    limit 1;

    if v_venue_id is null then
      v_venue_slug := public.generate_venue_slug(p_venue, coalesce(p_city, ''));
      insert into public.venues (name, city, slug, address, postcode, website)
      values (trim(p_venue), trim(p_city), v_venue_slug, p_venue_address, p_venue_postcode, p_venue_website);
    end if;
  end if;

  for v_attempt in 1..2 loop
    begin
      v_slug := public.generate_gig_slug(coalesce(p_band_name, 'unknown'), coalesce(p_venue, 'unknown'), p_date);

      insert into public.gigs (
        band_name, venue, city, date, time, genre, notes, tickets,
        band_profile_id, status, submitted_by, slug, import_run_id, festival_profile_id, venue_id
      ) values (
        p_band_name, p_venue, p_city, p_date,
        coalesce(nullif(p_time, ''), 'Time TBC'),
        nullif(p_genre, ''),
        p_notes, p_tickets, p_band_profile_id, 'pending', auth.uid(), v_slug, p_import_run_id, p_festival_profile_id, p_venue_id
      )
      returning id into v_gig_id;

      insert into public.import_run_items (import_run_id, raw_text, outcome, gig_id, parsed_fields, match_decisions)
      values (p_import_run_id, p_raw_text, 'created', v_gig_id, p_parsed_fields, p_match_decisions);

      return jsonb_build_object('outcome', 'created', 'gig_id', v_gig_id);

    exception
      when unique_violation then
        if v_attempt = 2 then
          insert into public.import_run_items (import_run_id, raw_text, outcome, error_message, parsed_fields, match_decisions)
          values (p_import_run_id, p_raw_text, 'failed', 'unique_violation on retry: ' || sqlerrm, p_parsed_fields, p_match_decisions);
          return jsonb_build_object('outcome', 'failed', 'gig_id', null);
        end if;
      when others then
        insert into public.import_run_items (import_run_id, raw_text, outcome, error_message, parsed_fields, match_decisions)
        values (p_import_run_id, p_raw_text, 'failed', sqlerrm, p_parsed_fields, p_match_decisions);
        return jsonb_build_object('outcome', 'failed', 'gig_id', null);
    end;
  end loop;
end;
$function$;

do $$
declare
  v_admin_user_id uuid;
  v_run_id uuid;
  v_venue_soton uuid;
  v_venue_pompey uuid;
  v_result jsonb;
  v_gig_id uuid;
  v_gig_venue_id uuid;
  v_venues_before int;
  v_venues_after int;
  v_signature_count int;
begin
  -- import_gig_row requires is_admin_or_above() (auth.uid()-based) --
  -- simulate an authenticated admin session for the lifetime of this
  -- transaction only (`set local`, undone by the final ROLLBACK either
  -- way) using a real admin's id looked up dynamically, never hardcoded,
  -- so this test stays portable and never embeds a specific production
  -- user's identifier in a committed file.
  select user_id into v_admin_user_id from public.profiles where role = 'admin' limit 1;
  if v_admin_user_id is null then
    raise exception 'SETUP FAIL: no admin profile found to simulate an authenticated session with';
  end if;
  perform set_config('request.jwt.claim.sub', v_admin_user_id::text, true);

  -- Fixtures.
  insert into public.venues (name, city, slug)
  values ('ZZTEST The Crown', 'ZZTEST Southampton', 'zztest-the-crown-soton')
  returning id into v_venue_soton;

  insert into public.venues (name, city, slug)
  values ('ZZTEST The Crown', 'ZZTEST Portsmouth', 'zztest-the-crown-pompey')
  returning id into v_venue_pompey;

  v_run_id := gen_random_uuid();
  insert into public.import_runs (id, source_profile_id, total_rows_attempted, status)
  values (v_run_id, null, 1, 'running');

  -- ── A. existing venue UUID supplied -> resulting gig uses EXACTLY that
  --      venue_id, no re-derivation, no new venue row created. ──
  v_venues_before := (select count(*) from public.venues);
  v_result := public.import_gig_row(
    v_run_id, 'ZZTEST Band A', 'ZZTEST The Crown', 'ZZTEST Southampton',
    '2027-04-01', '20:00', 'Rock', null, null, null, 'zztest-raw-a',
    null, null, null, null, null, null,
    v_venue_soton
  );
  if v_result->>'outcome' <> 'created' then
    raise exception 'FAIL A: expected outcome created, got %', v_result;
  end if;
  v_gig_id := (v_result->>'gig_id')::uuid;
  select venue_id into v_gig_venue_id from public.gigs where id = v_gig_id;
  if v_gig_venue_id is distinct from v_venue_soton then
    raise exception 'FAIL A: gig.venue_id (%) is not the supplied venue_id (%)', v_gig_venue_id, v_venue_soton;
  end if;
  v_venues_after := (select count(*) from public.venues);
  if v_venues_after <> v_venues_before then
    raise exception 'FAIL A: supplying an existing venue_id created % unexpected venue row(s)', v_venues_after - v_venues_before;
  end if;

  -- ── D. explicit venue UUID belonging to a same-name venue in ANOTHER
  --      city, sent alongside THAT VENUE'S OWN canonical city (the
  --      "preferred principle": Smart Import sends the confirmed
  --      candidate's own name+city together with its id, so there is
  --      nothing for the RPC to cross-validate) -> correctly links to the
  --      Portsmouth one, not the Southampton one, despite the identical name. ──
  v_result := public.import_gig_row(
    v_run_id, 'ZZTEST Band D', 'ZZTEST The Crown', 'ZZTEST Portsmouth',
    '2027-04-02', '20:00', 'Rock', null, null, null, 'zztest-raw-d',
    null, null, null, null, null, null,
    v_venue_pompey
  );
  v_gig_id := (v_result->>'gig_id')::uuid;
  select venue_id into v_gig_venue_id from public.gigs where id = v_gig_id;
  if v_gig_venue_id is distinct from v_venue_pompey then
    raise exception 'FAIL D: gig.venue_id (%) did not correctly resolve to the Portsmouth venue (%) despite the identical name', v_gig_venue_id, v_venue_pompey;
  end if;

  -- ── B. no venue UUID supplied (explicit NEW venue path, with address
  --      data) -> existing create-a-new-venue behaviour preserved
  --      byte-for-byte, and the newly created venue is what the gig links to
  --      (via gig_auto_venue's normal, unchanged text-based resolution --
  --      this RPC's own address block only pre-creates the row). ──
  v_venues_before := (select count(*) from public.venues);
  v_result := public.import_gig_row(
    v_run_id, 'ZZTEST Band B', 'ZZTEST Brand New Venue', 'ZZTEST Southampton',
    '2027-04-03', '20:00', 'Rock', null, null, null, 'zztest-raw-b',
    null, null, 'ZZTEST Address', 'ZZ1 1ZZ', 'https://zztest.example',
    null, null -- p_venue_id omitted/null
  );
  if v_result->>'outcome' <> 'created' then
    raise exception 'FAIL B: expected outcome created, got %', v_result;
  end if;
  v_venues_after := (select count(*) from public.venues);
  if v_venues_after <> v_venues_before + 1 then
    raise exception 'FAIL B: expected exactly one new venue row, got a change of %', v_venues_after - v_venues_before;
  end if;
  if not exists (select 1 from public.venues where name = 'ZZTEST Brand New Venue' and address = 'ZZTEST Address' and postcode = 'ZZ1 1ZZ') then
    raise exception 'FAIL B: new venue was not created with the expected address/postcode';
  end if;

  -- ── C. invalid venue UUID -> FK violation, caught by the existing
  --      `when others` handler, row recorded as failed, NO gig row
  --      persists, no unrelated venue created. ──
  v_venues_before := (select count(*) from public.venues);
  v_result := public.import_gig_row(
    v_run_id, 'ZZTEST Band C', 'ZZTEST The Crown', 'ZZTEST Southampton',
    '2027-04-04', '20:00', 'Rock', null, null, null, 'zztest-raw-c',
    null, null, null, null, null, null,
    '00000000-0000-0000-0000-000000000000'::uuid -- a syntactically valid but non-existent venue id
  );
  if v_result->>'outcome' <> 'failed' then
    raise exception 'FAIL C: expected outcome failed for a non-existent venue_id, got %', v_result;
  end if;
  if exists (select 1 from public.gigs where band_name = 'ZZTEST Band C') then
    raise exception 'FAIL C: a gig row was persisted despite the invalid venue_id';
  end if;
  v_venues_after := (select count(*) from public.venues);
  if v_venues_after <> v_venues_before then
    raise exception 'FAIL C: an invalid venue_id unexpectedly created % venue row(s)', v_venues_after - v_venues_before;
  end if;
  if not exists (select 1 from public.import_run_items where raw_text = 'zztest-raw-c' and outcome = 'failed') then
    raise exception 'FAIL C: the failed row was not recorded in import_run_items';
  end if;

  -- ── Backward compatibility: a call using only the ORIGINAL 17
  --      parameters (p_venue_id omitted) still succeeds. ──
  v_result := public.import_gig_row(
    v_run_id, 'ZZTEST Band Legacy', 'ZZTEST Legacy Venue Text', 'ZZTEST Southampton',
    '2027-04-05', '20:00', 'Rock', null, null, null, 'zztest-raw-legacy',
    null, null, null, null, null, null
    -- p_venue_id not passed at all -- exercises the DEFAULT
  );
  if v_result->>'outcome' <> 'created' then
    raise exception 'FAIL legacy-17-arg-call: expected outcome created, got %', v_result;
  end if;

  -- ── Overload safety: exactly one import_gig_row signature exists in
  --      THIS transaction after the CREATE OR REPLACE above (mirrors what
  --      the real migration's explicit DROP + CREATE guarantees against
  --      production -- this check operates on whatever this transaction's
  --      pg_proc snapshot shows, i.e. this session's own version). ──
  select count(*) into v_signature_count
  from pg_proc
  where pronamespace = 'public'::regnamespace and proname = 'import_gig_row';
  if v_signature_count <> 1 then
    raise exception 'FAIL: expected exactly 1 import_gig_row signature, found %', v_signature_count;
  end if;

  raise notice 'import_gig_row p_venue_id regression: ALL CHECKS PASSED';
end $$;

rollback;
