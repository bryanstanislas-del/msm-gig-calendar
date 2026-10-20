-- P1 newsletter follow-up (applied 20261020160953): consent RPCs need a signed-in
-- caller; no anonymous access to subscriber data.
set lock_timeout = '3s';
revoke all on function public.record_newsletter_opt_in(text, text, uuid) from public, anon;
revoke all on function public.record_newsletter_opt_out(text) from public, anon;
grant execute on function public.record_newsletter_opt_in(text, text, uuid) to authenticated, service_role;
grant execute on function public.record_newsletter_opt_out(text) to authenticated, service_role;

revoke all on table public.newsletter_subscribers from anon;
revoke truncate, references, trigger, maintain on table public.newsletter_subscribers from authenticated;
