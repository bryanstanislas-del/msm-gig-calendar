-- notification_deliveries_admin_write (FOR ALL USING (is_admin())) already grants
-- admins SELECT with the identical predicate, since a PERMISSIVE "FOR ALL" policy's
-- USING clause applies to SELECT the same as a dedicated SELECT policy would.
-- notification_deliveries_select_admin was therefore dead-weight duplication:
-- two policies encoding the same admin-read rule, with no behavior difference.
-- Purely a policy-surface cleanup; admin SELECT access is unchanged (re-verified
-- with a rolled-back transaction after applying this).
--
-- ROLLBACK:
--   create policy "notification_deliveries_select_admin" on public.notification_deliveries
--     for select using (is_admin());

drop policy "notification_deliveries_select_admin" on public.notification_deliveries;
