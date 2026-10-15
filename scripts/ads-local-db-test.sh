#!/usr/bin/env bash
# Advertising phase 1 -- local database tests. LOCAL / DISPOSABLE POSTGRES ONLY.
#
# Usage:  ADS_TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres scripts/ads-local-db-test.sh
#   or with PGHOST/PGPORT/PGUSER pointing at a local socket.
#
# Creates throwaway databases (ads_phase1_rls, ads_phase1_conc), applies the
# local Supabase shim + the ads migration, runs the RLS/state-machine suite
# and a real multi-session concurrency test, then drops them. Refuses to
# run against anything that is not localhost / a unix socket.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -n "${ADS_TEST_DATABASE_URL:-}" ]]; then
  case "$ADS_TEST_DATABASE_URL" in
    *@localhost*|*@127.0.0.1*|*@\[::1\]*) ;;
    *) echo "Refusing: ADS_TEST_DATABASE_URL must point at localhost" >&2; exit 2 ;;
  esac
  ADMIN_URL="$ADS_TEST_DATABASE_URL"
  dburl() { echo "${ADMIN_URL%/*}/$1"; }
else
  case "${PGHOST:-}" in
    /*|localhost|127.0.0.1) ;;
    *) echo "Refusing: set PGHOST to a local socket dir/localhost, or ADS_TEST_DATABASE_URL" >&2; exit 2 ;;
  esac
  ADMIN_URL="postgres"
  dburl() { echo "$1"; }
fi
case "${ADMIN_URL}${PGHOST:-}" in *supabase.co*|*pooler*) echo "Refusing: remote Supabase host" >&2; exit 2;; esac

MIG=supabase/migrations/20261015120000_ads_platform_phase1.sql
SHIM=supabase/tests/ads/00_local_supabase_shim.sql
PSQL="psql -X -q -v ON_ERROR_STOP=1"

fresh_db() {
  $PSQL -d "$ADMIN_URL" -c "drop database if exists $1" -c "create database $1" >/dev/null
  $PSQL -d "$(dburl "$1")" -f "$SHIM" >/dev/null
  $PSQL -d "$(dburl "$1")" -f "$MIG" >/dev/null
}

echo "== RLS / state machine / dates suite"
fresh_db ads_phase1_rls
$PSQL -d "$(dburl ads_phase1_rls)" -f supabase/tests/ads/10_ads_phase1_regression.sql 2>&1 | grep -E "NOTICE|ERROR|FAIL"

echo "== Concurrency: parallel holds on a capacity-1 unit"
fresh_db ads_phase1_conc
CONC="$(dburl ads_phase1_conc)"
$PSQL -d "$CONC" <<'SQL' >/dev/null
update public.ad_settings set bool_value = true where key in ('ads_portal_enabled','ads_checkout_enabled','ads_delivery_enabled');
update public.ad_settings set int_value = 0 where key = 'min_lead_days';
update public.ad_inventory_units set active = true where code = 'wordpress-home-top';
update public.ad_products set active = true;
create table zz_conc_users (n int primary key, user_id uuid);
insert into auth.users (id) select gen_random_uuid() from generate_series(1, 12);
insert into zz_conc_users select row_number() over (), id from auth.users;
insert into public.ad_advertisers (owner_user_id, display_name, contact_email)
  select user_id, 'ZZTEST conc ' || n, 'zz' || n || '@example.invalid' from zz_conc_users;
SQL

N=12
pids=()
for i in $(seq 1 $N); do
  # Alternate the two packages that share the same physical unit.
  if (( i % 2 )); then PRODUCT="TEST-wp-home-top-weekly"; else PRODUCT="TEST-wp-home-top-daily"; fi
  (
    $PSQL -d "$CONC" -tA <<SQL 2>&1 | grep -Eo "HOLD_OK|ADS_CAPACITY_UNAVAILABLE|ERROR.*" | head -1 || true
begin;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from zz_conc_users where n = $i), 'role', 'authenticated')::text, true);
set local role authenticated;
select 'HOLD_OK:' || public.ad_create_hold((select id from public.ad_products where code = '$PRODUCT'),
  (now() at time zone 'Europe/London')::date + 10, (now() at time zone 'Europe/London')::date + 16);
select pg_sleep(0.3);
commit;
SQL
  ) > "${TMPDIR:-/tmp}/ads_conc_$i.out" || true &
  pids+=($!)
done
wait "${pids[@]}" || true
OK=$(cat "${TMPDIR:-/tmp}"/ads_conc_*.out | grep -c HOLD_OK || true)
FULL=$(cat "${TMPDIR:-/tmp}"/ads_conc_*.out | grep -c ADS_CAPACITY_UNAVAILABLE || true)
rm -f "${TMPDIR:-/tmp}"/ads_conc_*.out
DAYS=$($PSQL -d "$CONC" -tA -c "select max(c) from (select count(*) c from public.ad_booking_inventory_days d join public.ad_bookings b on b.id=d.booking_id where b.status='held' group by d.unit_id, d.day) x")
echo "   successes=$OK capacity_refusals=$FULL max_holds_per_unit_day=$DAYS"
[[ "$OK" == "1" && "$FULL" == "$((N-1))" && "$DAYS" == "1" ]] || { echo "FAIL: concurrency"; exit 1; }

echo "== Concurrency: duplicate webhook deliveries in parallel"
BID=$($PSQL -d "$CONC" -tA -c "select id from public.ad_bookings where status='held' limit 1")
TOTAL=$($PSQL -d "$CONC" -tA -c "select total_pence from public.ad_purchase_snapshots where booking_id='$BID'")
$PSQL -d "$CONC" -c "set role service_role; select public.ad_record_checkout_session('$BID','cs_test_conc',$TOTAL,'gbp',false,now()+interval '40 minutes')" >/dev/null
pids=()
for i in $(seq 1 8); do
  ( $PSQL -d "$CONC" -tA -c "set role service_role; select public.ad_apply_stripe_event(jsonb_build_object('id','evt_conc','type','checkout.session.completed','livemode',false,'session_id','cs_test_conc','payment_intent_id','pi_test_conc','booking_id','$BID','payment_status','paid','amount_total',$TOTAL,'currency','gbp'))->>'outcome'" 2>&1 || true ) > "${TMPDIR:-/tmp}/ads_wh_$i.out" &
  pids+=($!)
done
wait "${pids[@]}" || true
CONFIRMED=$(cat "${TMPDIR:-/tmp}"/ads_wh_*.out | grep -c '^confirmed$' || true)
DUP=$(cat "${TMPDIR:-/tmp}"/ads_wh_*.out | grep -c '^duplicate$' || true)
rm -f "${TMPDIR:-/tmp}"/ads_wh_*.out
EVENTS=$($PSQL -d "$CONC" -tA -c "select count(*) from public.ad_payment_events where provider_event_id='evt_conc'")
echo "   confirmed=$CONFIRMED duplicate=$DUP stored_events=$EVENTS"
[[ "$CONFIRMED" == "1" && "$DUP" == "7" && "$EVENTS" == "1" ]] || { echo "FAIL: webhook concurrency"; exit 1; }

echo "== End-to-end handlers + local DB (Stripe/storage bytes mocked)"
fresh_db ads_phase1_int
if [[ -n "${ADS_TEST_DATABASE_URL:-}" ]]; then
  ADS_INTEGRATION_DB_URL="$(dburl ads_phase1_int)" npx vitest run api/_ads/dbIntegration.test.js 2>&1 | grep -E "Tests|FAIL|Error" 
else
  ADS_INTEGRATION_DB=ads_phase1_int npx vitest run api/_ads/dbIntegration.test.js 2>&1 | grep -E "Tests|FAIL|Error"
fi
[[ "${PIPESTATUS[0]}" == "0" ]] || { echo "FAIL: integration"; exit 1; }

$PSQL -d "$ADMIN_URL" -c "drop database ads_phase1_rls" -c "drop database ads_phase1_conc" -c "drop database ads_phase1_int" >/dev/null
echo "ALL ADS LOCAL DB TESTS PASSED"
