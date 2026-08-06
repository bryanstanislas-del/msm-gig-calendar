-- Sprint 5C follow-up: fix rollback_import_run's outcome bookkeeping.
--
-- The original version deleted the gig before updating its import_run_items
-- row. import_run_items.gig_id has ON DELETE SET NULL, so the delete's
-- cascade nulled the very column the following UPDATE ... WHERE gig_id = ...
-- matched on -- the update silently matched zero rows, leaving rolled-back
-- items stuck at outcome = 'created' with gig_id = null forever, even though
-- the gig itself was correctly deleted. Caught during a manual end-to-end
-- rollback verification against real (disposable) test rows.
--
-- Fix: update import_run_items while gig_id still matches, then delete.

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
      -- Update import_run_items BEFORE deleting the gig: gig_id has
      -- ON DELETE SET NULL, so deleting first would null the very column
      -- this UPDATE's WHERE clause matches on, silently leaving the
      -- outcome stuck at 'created' even though the gig is gone.
      update public.import_run_items set outcome = 'rolled_back' where import_run_id = p_import_run_id and gig_id = v_item.gig_id;
      delete from public.gigs where id = v_item.gig_id;
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
