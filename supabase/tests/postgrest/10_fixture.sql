-- LOCAL/DISPOSABLE DB ONLY. Committed synthetic fixture for
-- scripts/ads-postgrest-test.sh: an admin, two advertisers, and one paid
-- booking whose FUNDING payment is joined by a second (duplicate) payment,
-- so the payment-history embed's relationship choice is observable.
do $$
declare adm uuid; own uuid; oth uuid; adv uuid; b uuid; p uuid;
begin
  insert into auth.users (email) values ('zz-admin@example.invalid') returning id into adm;
  insert into auth.users (email) values ('zz-owner@example.invalid') returning id into own;
  insert into auth.users (email) values ('zz-other@example.invalid') returning id into oth;
  insert into public.user_roles (user_id, role) values (adm, 'admin');
  insert into public.ad_advertisers (owner_user_id, display_name, contact_email) values (own, 'ZZ Owner', 'zz-owner@example.invalid') returning id into adv;
  insert into public.ad_advertisers (owner_user_id, display_name, contact_email) values (oth, 'ZZ Other', 'zz-other@example.invalid');
  insert into public.ad_bookings (advertiser_id, product_id, start_date, end_date, status, hold_expires_at, is_test, created_by)
  select adv, id, current_date + 30, current_date + 31, 'confirmed', now() + interval '1 hour', true, own from public.ad_products where code = 'TEST-wp-home-top-daily'
  returning id into b;
  insert into public.ad_payments (booking_id, provider, checkout_session_id, amount_pence, currency, status, livemode)
  values (b, 'stripe', 'cs_test_zzfunding', 2000, 'gbp', 'paid', false) returning id into p;
  insert into public.ad_payments (booking_id, provider, checkout_session_id, amount_pence, currency, status, livemode, requires_refund)
  values (b, 'stripe', 'cs_test_zzduplicate', 2000, 'gbp', 'paid', false, true);
  update public.ad_bookings set funding_payment_id = p where id = b;
  create table public.zz_pgrst_ids as select adm as admin_id, own as owner_id, oth as other_id, b as booking_id;
  grant select on public.zz_pgrst_ids to postgres;
end $$;
