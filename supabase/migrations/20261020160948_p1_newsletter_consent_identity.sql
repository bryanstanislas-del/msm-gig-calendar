-- P1: newsletter consent RPCs bound to the caller's verified account email.
-- Only in-repo caller: registration (App.jsx) immediately after signUp, which
-- runs with an authenticated session (production auto-confirms signups).
-- Public, token-based unsubscribe is NOT implemented here (needs a server
-- secret + mail transport). Applied as 20261020160948; grants in 20261020160953.
set lock_timeout = '3s';

create or replace function public.record_newsletter_opt_in(p_email text, p_source text, p_profile_id uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid     uuid := auth.uid();
  v_account text;
  v_email   text := lower(trim(coalesce(p_email, '')));
  v_profile uuid;
  v_result  jsonb;
begin
  if v_uid is null then
    raise exception 'Sign in to subscribe to the newsletter' using errcode = '42501';
  end if;

  if p_source not in ('registration','profile_claim','gig_submission','website_signup') then
    raise exception 'Invalid newsletter_source: %. Must be one of registration, profile_claim, gig_submission, website_signup', p_source;
  end if;

  select lower(trim(u.email)) into v_account from auth.users u where u.id = v_uid;
  if v_email = '' or v_account is null or v_email <> v_account then
    raise exception 'Newsletter consent can only be recorded for your own account email' using errcode = '42501';
  end if;

  -- Only link a profile the caller owns or manages; otherwise ignore it.
  if p_profile_id is not null and exists (
       select 1 from public.profiles p
       where p.id = p_profile_id
         and (p.user_id = v_uid
              or exists (select 1 from public.user_roles r
                         where r.user_id = v_uid and r.managed_entity_id = p.id))) then
    v_profile := p_profile_id;
  end if;

  insert into public.newsletter_subscribers (email, newsletter_opt_in, newsletter_opt_in_date, newsletter_source, profile_id)
  values (v_account, true, now(), p_source, v_profile)
  on conflict (email) do update
    set newsletter_opt_in      = true,
        newsletter_opt_in_date = now(),
        newsletter_source      = p_source,
        unsubscribed_at        = null,
        profile_id             = coalesce(excluded.profile_id, public.newsletter_subscribers.profile_id),
        updated_at             = now()
  returning jsonb_build_object(
    'email', email,
    'newsletter_opt_in', newsletter_opt_in,
    'newsletter_opt_in_date', newsletter_opt_in_date,
    'newsletter_source', newsletter_source
  ) into v_result;

  return v_result;
end;
$function$;

create or replace function public.record_newsletter_opt_out(p_email text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid     uuid := auth.uid();
  v_account text;
begin
  if v_uid is null then
    raise exception 'Sign in to manage your newsletter subscription' using errcode = '42501';
  end if;

  select lower(trim(u.email)) into v_account from auth.users u where u.id = v_uid;
  if v_account is null or lower(trim(coalesce(p_email, ''))) <> v_account then
    raise exception 'You can only unsubscribe your own account email' using errcode = '42501';
  end if;

  update public.newsletter_subscribers
     set newsletter_opt_in = false,
         unsubscribed_at   = coalesce(unsubscribed_at, now()),
         updated_at        = now()
   where email = v_account;

  -- Uniform response whether or not a subscription existed (no enumeration).
  return jsonb_build_object('email', v_account, 'newsletter_opt_in', false);
end;
$function$;

