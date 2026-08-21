-- Genre import fix: stop unclassified/unknown gigs from being silently
-- mislabeled as 'Indie Rock'. genre becomes a true optional field -- NULL
-- means "no genre assigned" (rendered client-side as the neutral "-"
-- marker), a distinct state from any real genre choice, including the
-- genuine "Other" bucket. Existing rows already set to 'Indie Rock' are
-- data, not schema, and are untouched by this migration.

alter table public.gigs alter column genre drop not null;
alter table public.gigs alter column genre drop default;

-- Both import_gig_row overloads defaulted a blank/omitted genre to
-- 'Indie Rock' -- now that the column is nullable, let it pass through as
-- NULL like every other optional field (time is the one field that keeps
-- a real default, 'Time TBC', since gigs.time itself still has a NOT NULL
-- constraint).

create or replace function public.import_gig_row(
  p_import_run_id uuid, p_band_name text, p_venue text, p_city text, p_date date,
  p_time text, p_genre text, p_notes text, p_tickets text, p_band_profile_id uuid, p_raw_text text
) returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_slug text;
  v_gig_id uuid;
  v_attempt int;
begin
  if not public.is_admin_or_above() then
    raise exception 'Only admins can import gig rows';
  end if;

  for v_attempt in 1..2 loop
    begin
      v_slug := public.generate_gig_slug(coalesce(p_band_name, 'unknown'), coalesce(p_venue, 'unknown'), p_date);

      insert into public.gigs (
        band_name, venue, city, date, time, genre, notes, tickets,
        band_profile_id, status, submitted_by, slug, import_run_id
      ) values (
        p_band_name, p_venue, p_city, p_date,
        coalesce(nullif(p_time, ''), 'Time TBC'),
        nullif(p_genre, ''),
        p_notes, p_tickets, p_band_profile_id, 'pending', auth.uid(), v_slug, p_import_run_id
      )
      returning id into v_gig_id;

      insert into public.import_run_items (import_run_id, raw_text, outcome, gig_id)
      values (p_import_run_id, p_raw_text, 'created', v_gig_id);

      return jsonb_build_object('outcome', 'created', 'gig_id', v_gig_id);

    exception
      when unique_violation then
        if v_attempt = 2 then
          insert into public.import_run_items (import_run_id, raw_text, outcome, error_message)
          values (p_import_run_id, p_raw_text, 'failed', 'unique_violation on retry: ' || sqlerrm);
          return jsonb_build_object('outcome', 'failed', 'gig_id', null);
        end if;
        -- fall through to the loop's second iteration and retry
      when others then
        insert into public.import_run_items (import_run_id, raw_text, outcome, error_message)
        values (p_import_run_id, p_raw_text, 'failed', sqlerrm);
        return jsonb_build_object('outcome', 'failed', 'gig_id', null);
    end;
  end loop;
end;
$function$;

create or replace function public.import_gig_row(
  p_import_run_id uuid, p_band_name text, p_venue text, p_city text, p_date date,
  p_time text, p_genre text, p_notes text, p_tickets text, p_band_profile_id uuid, p_raw_text text,
  p_parsed_fields jsonb default null, p_match_decisions jsonb default null
) returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_slug text;
  v_gig_id uuid;
  v_attempt int;
begin
  if not public.is_admin_or_above() then
    raise exception 'Only admins can import gig rows';
  end if;

  for v_attempt in 1..2 loop
    begin
      v_slug := public.generate_gig_slug(coalesce(p_band_name, 'unknown'), coalesce(p_venue, 'unknown'), p_date);

      insert into public.gigs (
        band_name, venue, city, date, time, genre, notes, tickets,
        band_profile_id, status, submitted_by, slug, import_run_id
      ) values (
        p_band_name, p_venue, p_city, p_date,
        coalesce(nullif(p_time, ''), 'Time TBC'),
        nullif(p_genre, ''),
        p_notes, p_tickets, p_band_profile_id, 'pending', auth.uid(), v_slug, p_import_run_id
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
        -- fall through to the loop's second iteration and retry
      when others then
        insert into public.import_run_items (import_run_id, raw_text, outcome, error_message, parsed_fields, match_decisions)
        values (p_import_run_id, p_raw_text, 'failed', sqlerrm, p_parsed_fields, p_match_decisions);
        return jsonb_build_object('outcome', 'failed', 'gig_id', null);
    end;
  end loop;
end;
$function$;
