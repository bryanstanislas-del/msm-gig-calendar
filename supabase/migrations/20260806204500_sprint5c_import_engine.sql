-- Sprint 5C: Safe Import Engine.
-- import_runs / import_run_items give every Smart Import batch a durable
-- audit trail; gigs.import_run_id lets rollback (and any future "show this
-- run's gigs" view) filter gigs directly. All writes go through the four
-- SECURITY DEFINER RPCs below -- there is no INSERT/UPDATE/DELETE policy on
-- either new table for any role.

create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz default now(),
  completed_at timestamptz,
  performed_by uuid references auth.users(id),
  performed_by_name text,
  source_profile_id text,
  total_rows_attempted int not null default 0,
  total_rows_succeeded int not null default 0,
  total_rows_failed int not null default 0,
  status text not null default 'running' check (status in ('running','completed','completed_with_errors','rolled_back')),
  rolled_back_at timestamptz,
  rolled_back_by uuid references auth.users(id)
);

create table public.import_run_items (
  id uuid primary key default gen_random_uuid(),
  import_run_id uuid not null references public.import_runs(id),
  raw_text text,
  outcome text not null check (outcome in ('created','failed','rolled_back','rollback_skipped_edited')),
  gig_id uuid references public.gigs(id) on delete set null,
  venue_created boolean not null default false,
  error_message text,
  created_at timestamptz default now()
);

alter table public.gigs add column import_run_id uuid references public.import_runs(id);

create index import_run_items_import_run_id_idx on public.import_run_items(import_run_id);
create index gigs_import_run_id_idx on public.gigs(import_run_id);

alter table public.import_runs enable row level security;
alter table public.import_run_items enable row level security;

create policy "Admins can view import runs" on public.import_runs for select using (is_admin_or_above());
create policy "Admins can view import run items" on public.import_run_items for select using (is_admin_or_above());

create or replace function public.start_import_run(p_source_profile_id text, p_total_rows int)
returns uuid language plpgsql security definer set search_path to ''
as $function$
declare
  v_id uuid;
  v_name text;
begin
  if not public.is_admin_or_above() then
    raise exception 'Only admins can start an import run';
  end if;

  select p.band_name into v_name from public.profiles p where p.user_id = auth.uid() limit 1;

  insert into public.import_runs (performed_by, performed_by_name, source_profile_id, total_rows_attempted, status)
  values (auth.uid(), coalesce(v_name, 'Administrator'), p_source_profile_id, p_total_rows, 'running')
  returning id into v_id;

  return v_id;
end;
$function$;

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
        coalesce(nullif(p_genre, ''), 'Indie Rock'),
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

create or replace function public.complete_import_run(p_import_run_id uuid, p_succeeded int, p_failed int)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_status text;
begin
  if not public.is_admin_or_above() then
    raise exception 'Only admins can complete an import run';
  end if;

  v_status := case when p_failed > 0 then 'completed_with_errors' else 'completed' end;

  update public.import_runs
  set completed_at = now(), total_rows_succeeded = p_succeeded, total_rows_failed = p_failed, status = v_status
  where id = p_import_run_id;

  insert into public.activity_log (action, entity_type, entity_id, performed_by)
  values ('import_run_completed', 'import_run', p_import_run_id, auth.uid());

  return jsonb_build_object('import_run_id', p_import_run_id, 'status', v_status);
end;
$function$;

create or replace function public.rollback_import_run(p_import_run_id uuid)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_run record; v_item record; v_rolled_back_count int := 0; v_skipped_count int := 0;
begin
  if not public.is_admin_or_above() then raise exception 'Only admins can roll back an import run'; end if;
  select * into v_run from public.import_runs where id = p_import_run_id;
  if v_run is null then raise exception 'Import run % not found', p_import_run_id; end if;
  if v_run.status = 'rolled_back' then raise exception 'Import run % has already been rolled back', p_import_run_id; end if;
  for v_item in select id as gig_id, created_at, updated_at from public.gigs where import_run_id = p_import_run_id loop
    if v_item.updated_at is not distinct from v_item.created_at then
      delete from public.gigs where id = v_item.gig_id;
      update public.import_run_items set outcome = 'rolled_back' where import_run_id = p_import_run_id and gig_id = v_item.gig_id;
      v_rolled_back_count := v_rolled_back_count + 1;
    else
      update public.import_run_items set outcome = 'rollback_skipped_edited' where import_run_id = p_import_run_id and gig_id = v_item.gig_id;
      v_skipped_count := v_skipped_count + 1;
    end if;
  end loop;
  update public.import_runs set status = 'rolled_back', rolled_back_at = now(), rolled_back_by = auth.uid() where id = p_import_run_id;
  insert into public.activity_log (action, entity_type, entity_id, performed_by) values ('import_run_rolled_back', 'import_run', p_import_run_id, auth.uid());
  return jsonb_build_object('import_run_id', p_import_run_id, 'rolled_back_count', v_rolled_back_count, 'skipped_count', v_skipped_count);
end;
$function$;
