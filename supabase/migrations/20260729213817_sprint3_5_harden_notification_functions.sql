-- Sprint 3.5 follow-up hardening, purely additive/grant-level, no schema shape changes.
-- 1) Remove the enumeration oracle in fanout_notification_event: previously a caller could
--    distinguish "event id does not exist" from "event exists but I'm not authorized" by
--    error text, letting an anon/authenticated caller probe for valid notification_event ids.
--    Both cases now raise the same generic error.
-- 2) Tighten EXECUTE grants to match this codebase's established hardening convention
--    (see harden_execute_grants_on_security_definer_functions,
--    revoke_public_anon_execute_approve_new_entity_request, etc.): these two functions only
--    ever do useful work for an authenticated caller, so anon/public EXECUTE is revoked.
--
-- ROLLBACK:
--   grant execute on function public.fanout_notification_event(uuid) to anon, public;
--   grant execute on function public.mark_notification_read(uuid, text) to anon, public;
--   (and re-create fanout_notification_event with the previous two-error-message version,
--   see migration 20260729155347_sprint3_5_notification_delivery_architecture.sql for original body)

create or replace function public.fanout_notification_event(p_event_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_event public.notification_events;
  v_category text;
  v_inserted integer := 0;
  v_authorized boolean;
begin
  select * into v_event from public.notification_events where id = p_event_id;

  v_authorized := found and (
    public.is_admin()
    or public.manages_entity(v_event.entity_type, v_event.entity_id)
    or (
      v_event.entity_type in ('band', 'solo_artist', 'festival')
      and exists (select 1 from public.profiles where id = v_event.entity_id and user_id = auth.uid())
    )
    or (
      v_event.entity_type = 'venue'
      and exists (select 1 from public.venues where id = v_event.entity_id and user_id = auth.uid())
    )
  );

  if not v_authorized then
    raise exception 'notification_event not found or not authorized';
  end if;

  v_category := case v_event.event_type
    when 'gig_added'          then 'new_gig_alerts'
    when 'gig_cancelled'      then 'cancellation_alerts'
    when 'venue_event_added'  then 'venue_updates'
    when 'festival_updated'   then 'festival_updates'
    else null
  end;
  if v_category is null then
    raise exception 'unmapped event_type: %', v_event.event_type;
  end if;

  with followers as (
    select bf.user_id
    from public.band_follows bf
    where v_event.entity_type in ('band', 'solo_artist', 'festival')
      and bf.band_profile_id = v_event.entity_id
    union
    select vf.user_id
    from public.venue_follows vf
    where v_event.entity_type = 'venue'
      and vf.venue_id = v_event.entity_id
  ),
  prefs as (
    select
      f.user_id,
      coalesce(p.in_app_enabled, true)   as in_app_enabled,
      coalesce(p.email_enabled, false)   as email_enabled,
      coalesce(p.web_push_enabled, false) as web_push_enabled,
      coalesce(
        case v_category
          when 'new_gig_alerts'      then p.new_gig_alerts
          when 'cancellation_alerts' then p.cancellation_alerts
          when 'artist_updates'      then p.artist_updates
          when 'venue_updates'       then p.venue_updates
          when 'festival_updates'    then p.festival_updates
        end,
        true
      ) as category_enabled
    from followers f
    left join public.user_notification_preferences p on p.user_id = f.user_id
  ),
  channels as (
    select user_id, 'in_app'::text as delivery_channel from prefs where category_enabled and in_app_enabled
    union all
    select user_id, 'email'::text from prefs where category_enabled and email_enabled
    union all
    select user_id, 'web_push'::text from prefs where category_enabled and web_push_enabled
  )
  insert into public.notification_deliveries (notification_event_id, recipient_user_id, delivery_channel)
  select p_event_id, user_id, delivery_channel from channels
  on conflict (notification_event_id, recipient_user_id, delivery_channel) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke execute on function public.fanout_notification_event(uuid) from public;
revoke execute on function public.fanout_notification_event(uuid) from anon;
grant execute on function public.fanout_notification_event(uuid) to authenticated;

revoke execute on function public.mark_notification_read(uuid, text) from public;
revoke execute on function public.mark_notification_read(uuid, text) from anon;
grant execute on function public.mark_notification_read(uuid, text) to authenticated;
