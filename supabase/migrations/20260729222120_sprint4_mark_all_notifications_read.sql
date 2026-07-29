-- Sprint 4 (Notification Centre): bulk counterpart to mark_notification_read.
-- Purely additive -- one new function, no schema changes. Same security shape
-- as mark_notification_read: SECURITY DEFINER, no parameters (so there is no
-- way to target anyone but the caller), scoped internally to auth.uid().
-- Scoped to delivery_channel = 'in_app' to match exactly what the
-- Notification Centre displays -- email/web_push rows are delivery-tracking
-- only and have no "read" concept in the UI, so a bulk "mark all read" must
-- not touch them.
--
-- ROLLBACK:
--   drop function if exists public.mark_all_notifications_read();

create or replace function public.mark_all_notifications_read()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_updated integer;
begin
  update public.notification_deliveries
  set read_state = 'read',
      opened_at = coalesce(opened_at, now()),
      read_at = now(),
      updated_at = now()
  where recipient_user_id = auth.uid()
    and delivery_channel = 'in_app'
    and read_state = 'unread';
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

comment on function public.mark_all_notifications_read() is
  'Bulk version of mark_notification_read: marks every unread in_app notification_deliveries row belonging to the caller (auth.uid()) as read. Takes no parameters, so there is no way to target another user''s rows.';

revoke execute on function public.mark_all_notifications_read() from public;
revoke execute on function public.mark_all_notifications_read() from anon;
grant execute on function public.mark_all_notifications_read() to authenticated;
