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
MIG2=supabase/migrations/20261016090000_ads_standard_earliest_start.sql
SHIM=supabase/tests/ads/00_local_supabase_shim.sql
PSQL="psql -X -q -v ON_ERROR_STOP=1"

fresh_db() {
  $PSQL -d "$ADMIN_URL" -c "drop database if exists $1" -c "create database $1" >/dev/null
  $PSQL -d "$(dburl "$1")" -f "$SHIM" >/dev/null
  for m in supabase/migrations/2026101*_ads_*.sql; do $PSQL -d "$(dburl "$1")" -f "$m" >/dev/null; done
}

echo "== RLS / state machine / dates suite"
fresh_db ads_phase1_rls
$PSQL -d "$(dburl ads_phase1_rls)" -f supabase/tests/ads/10_ads_phase1_regression.sql 2>&1 | grep -E "NOTICE|ERROR|FAIL"
echo "== Review / corrections / priority suite"
$PSQL -d "$(dburl ads_phase1_rls)" -f supabase/tests/ads/20_review_corrections_priority.sql 2>&1 | grep -E "NOTICE|ERROR|FAIL"
echo "== Refunds / cancellation suite"
$PSQL -d "$(dburl ads_phase1_rls)" -f supabase/tests/ads/30_refunds_cancellation.sql 2>&1 | grep -E "NOTICE|ERROR|FAIL"
echo "== Notification outbox suite"
$PSQL -d "$(dburl ads_phase1_rls)" -f supabase/tests/ads/40_notification_outbox.sql 2>&1 | grep -E "NOTICE|ERROR|FAIL"
echo "== Booking amendments suite"
$PSQL -d "$(dburl ads_phase1_rls)" -f supabase/tests/ads/50_booking_amendments.sql 2>&1 | grep -E "NOTICE|ERROR|FAIL"

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

echo "== Concurrency: parallel refund proposals / approvals on one booking"
fresh_db ads_phase1_rconc
RC="$(dburl ads_phase1_rconc)"
$PSQL -d "$RC" -f supabase/tests/ads/31_refund_concurrency_setup.sql >/dev/null
as_admin="select set_config('request.jwt.claims', json_build_object('sub', (select admin_id from public.zz_rc), 'role', 'authenticated')::text, true); set local role authenticated;"
race() { # $1 = label, $2 = SQL run by each of $3 parallel sessions
  local pids=()
  for i in $(seq 1 "$3"); do
    ( $PSQL -d "$RC" -tA <<SQL 2>&1 | grep -Eo "RACE_OK|ADS_[A-Z_]+|already decided" | head -1 || true
begin; $as_admin
$2
select pg_sleep(0.3);
commit;
SQL
    ) > "${TMPDIR:-/tmp}/ads_rc_${1}_$i.out" &
    pids+=($!)
  done
  wait "${pids[@]}" || true
}
LOST="jsonb_build_array(jsonb_build_object('from', (select run_start from public.zz_rc) + interval '1 hour', 'until', (select run_start from public.zz_rc) + interval '7 hours', 'evidence', 'Parallel outage report ZZ-RC'))"
race prop "select 'RACE_OK:' || public.ad_admin_propose_refund((select booking_id from public.zz_rc), false, $LOST, 'Parallel proposal');" 6
P_OK=$(cat "${TMPDIR:-/tmp}"/ads_rc_prop_*.out | grep -c RACE_OK || true)
P_NONE=$(cat "${TMPDIR:-/tmp}"/ads_rc_prop_*.out | grep -c ADS_NOTHING_TO_REFUND || true)
P_SECS=$($PSQL -d "$RC" -tA -c "select coalesce(sum(lost_seconds),0) from public.ad_refund_lines")
echo "   proposals: ok=$P_OK nothing_to_refund=$P_NONE assessed_seconds=$P_SECS"
[[ "$P_OK" == "1" && "$P_NONE" == "5" && "$P_SECS" == "21600" ]] || { echo "FAIL: parallel proposals"; exit 1; }
AID=$($PSQL -d "$RC" -tA -c "select id from public.ad_refund_assessments limit 1")
race dbl "select public.ad_admin_decide_refund('$AID', 'approve', 'Parallel approve'); select 'RACE_OK';" 4
D_OK=$(cat "${TMPDIR:-/tmp}"/ads_rc_dbl_*.out | grep -c RACE_OK || true)
D_DUP=$(cat "${TMPDIR:-/tmp}"/ads_rc_dbl_*.out | grep -c "ADS_INVALID_STATE" || true)
echo "   same assessment approved in parallel: ok=$D_OK refused=$D_DUP"
[[ "$D_OK" == "1" && "$D_DUP" == "3" ]] || { echo "FAIL: parallel double approval"; exit 1; }
# Two rows that each fit but together exceed the paid amount (inserted directly, bypassing proposal checks).
$PSQL -d "$RC" -c "insert into public.ad_refund_assessments (booking_id, kind, status, total_pence, note, proposed_at)
  select booking_id, 'service_failure', 'proposed', (paid * 6 / 10), 'ZZ ceiling race ' || g, now() from public.zz_rc, generate_series(1, 2) g" >/dev/null
IDS=($($PSQL -d "$RC" -tA -c "select id from public.ad_refund_assessments where note like 'ZZ ceiling race%' order by note"))
pids=()
for id in "${IDS[@]}"; do
  ( $PSQL -d "$RC" -tA <<SQL 2>&1 | grep -Eo "RACE_OK|ADS_[A-Z_]+" | head -1 || true
begin; $as_admin
select pg_sleep(0.2);
select public.ad_admin_decide_refund('$id', 'approve', 'Ceiling race'); select 'RACE_OK';
select pg_sleep(0.3);
commit;
SQL
  ) > "${TMPDIR:-/tmp}/ads_rc_ceil_$id.out" &
  pids+=($!)
done
wait "${pids[@]}" || true
C_OK=$(cat "${TMPDIR:-/tmp}"/ads_rc_ceil_*.out | grep -c RACE_OK || true)
C_REF=$(cat "${TMPDIR:-/tmp}"/ads_rc_ceil_*.out | grep -c ADS_REFUND_CEILING || true)
OVER=$($PSQL -d "$RC" -tA -c "select (select coalesce(sum(total_pence),0) from public.ad_refund_assessments where status='approved') > (select paid from public.zz_rc)")
rm -f "${TMPDIR:-/tmp}"/ads_rc_*.out
echo "   competing approvals: ok=$C_OK ceiling_refusals=$C_REF approved_exceeds_paid=$OVER"
[[ "$C_OK" == "1" && "$C_REF" == "1" && "$OVER" == "f" ]] || { echo "FAIL: approval ceiling race"; exit 1; }
$PSQL -d "$ADMIN_URL" -c "drop database ads_phase1_rconc" >/dev/null

echo "== Concurrency: amendment acceptance vs a competing hold for the freed hours"
fresh_db ads_phase1_amr
AMR="$(dburl ads_phase1_amr)"
$PSQL -d "$AMR" -f supabase/tests/ads/51_amendment_race_setup.sql >/dev/null
for round in 1 2; do
  AM=$($PSQL -d "$AMR" -tA -c "select amendment_id from public.zz_amr where round=$round")
  OWNER=$($PSQL -d "$AMR" -tA -c "select owner_id from public.zz_amr where round=$round")
  OTHER=$($PSQL -d "$AMR" -tA -c "select other_id from public.zz_amr where round=$round")
  PROD=$($PSQL -d "$AMR" -tA -c "select product_id from public.zz_amr where round=$round")
  DAY=$($PSQL -d "$AMR" -tA -c "select next_day from public.zz_amr where round=$round")
  # round 1: accept starts first; round 2: hold starts first
  if [[ $round == 1 ]]; then DA=0; DH=0.1; else DA=0.1; DH=0; fi
  ( $PSQL -d "$AMR" -tA <<SQL 2>&1 | grep -Eo "RACE_OK|ADS_[A-Z_]+" | head -1 || true
begin; select pg_sleep($DA);
select set_config('request.jwt.claims', json_build_object('sub', '$OWNER', 'role', 'authenticated')::text, true); set local role authenticated;
select 'RACE_OK:' || public.ad_respond_amendment('$AM', 'accept');
select pg_sleep(0.4); commit;
SQL
  ) > "${TMPDIR:-/tmp}/ads_amr_a.out" &
  pa=$!
  ( $PSQL -d "$AMR" -tA <<SQL 2>&1 | grep -Eo "RACE_OK|ADS_[A-Z_]+" | head -1 || true
begin; select pg_sleep($DH);
select set_config('request.jwt.claims', json_build_object('sub', '$OTHER', 'role', 'authenticated')::text, true); set local role authenticated;
select 'RACE_OK:' || public.ad_create_hold('$PROD', '$DAY', '$DAY');
select pg_sleep(0.4); commit;
SQL
  ) > "${TMPDIR:-/tmp}/ads_amr_h.out" &
  ph=$!
  wait $pa $ph || true
  A=$(cat "${TMPDIR:-/tmp}/ads_amr_a.out"); H=$(cat "${TMPDIR:-/tmp}/ads_amr_h.out")
  OVER=$($PSQL -d "$AMR" -tA -c "select count(*) from (select d.unit_id, d.day from public.ad_booking_inventory_days d join public.ad_bookings b on b.id = d.booking_id
    where b.status = 'confirmed' or (b.status = 'held' and b.hold_expires_at > now()) group by 1, 2 having count(*) > 1) x")
  echo "   round $round: accept=$A hold=$H days_over_capacity=$OVER"
  WINS=$(( $( [[ $A == RACE_OK ]] && echo 1 || echo 0 ) + $( [[ $H == RACE_OK ]] && echo 1 || echo 0 ) ))
  [[ "$WINS" == "1" && "$OVER" == "0" && ( "$A" == RACE_OK || "$A" == ADS_CAPACITY_UNAVAILABLE ) && ( "$H" == RACE_OK || "$H" == ADS_CAPACITY_UNAVAILABLE ) ]] || { echo "FAIL: amendment race round $round"; exit 1; }
done
rm -f "${TMPDIR:-/tmp}"/ads_amr_*.out
$PSQL -d "$ADMIN_URL" -c "drop database ads_phase1_amr" >/dev/null

echo "== End-to-end handlers + local DB (Stripe/storage bytes mocked)"
fresh_db ads_phase1_int
if [[ -n "${ADS_TEST_DATABASE_URL:-}" ]]; then
  ADS_INTEGRATION_DB_URL="$(dburl ads_phase1_int)" npx vitest run api/_ads/dbIntegration.test.js 2>&1 | grep -E "Tests|FAIL|Error" 
else
  ADS_INTEGRATION_DB=ads_phase1_int npx vitest run api/_ads/dbIntegration.test.js 2>&1 | grep -E "Tests|FAIL|Error"
fi
[[ "${PIPESTATUS[0]}" == "0" ]] || { echo "FAIL: integration"; exit 1; }

echo "== Rollback script (guarded) on a fresh copy"
fresh_db ads_phase1_down
DOWN="$(dburl ads_phase1_down)"
BEFORE=$($PSQL -d "$DOWN" -tA -c "select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname not like 'ad\_%'")
$PSQL -d "$DOWN" -c "insert into storage.objects (bucket_id, name) values ('ad-creatives-private', 'x')" >/dev/null
if $PSQL -d "$DOWN" -f supabase/rollbacks/20261015120000_ads_platform_phase1_down.sql >/dev/null 2>&1; then echo "FAIL: rollback ran with objects present"; exit 1; fi
$PSQL -d "$DOWN" -c "delete from storage.objects where bucket_id = 'ad-creatives-private'" >/dev/null
PGOPTIONS="-c client_min_messages=warning" $PSQL -d "$DOWN" -f supabase/rollbacks/20261015120000_ads_platform_phase1_down.sql >/dev/null
LEFT=$($PSQL -d "$DOWN" -tA -c "select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname like 'ad\_%') + (select count(*) from pg_proc where proname like 'ad\_%') + (select count(*) from pg_namespace where nspname = 'ads_internal') + (select count(*) from storage.buckets where id = 'ad-creatives-private')")
AFTER=$($PSQL -d "$DOWN" -tA -c "select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname not like 'ad\_%'")
echo "   ads objects left=$LEFT non-ads public relations before=$BEFORE after=$AFTER"
[[ "$LEFT" == "0" && "$BEFORE" == "$AFTER" ]] || { echo "FAIL: rollback"; exit 1; }
$PSQL -d "$ADMIN_URL" -c "drop database ads_phase1_down" >/dev/null

$PSQL -d "$ADMIN_URL" -c "drop database ads_phase1_rls" -c "drop database ads_phase1_conc" -c "drop database ads_phase1_int" >/dev/null
echo "ALL ADS LOCAL DB TESTS PASSED"
