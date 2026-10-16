#!/usr/bin/env bash
# Local validation of supabase/staging/* -- LOCAL / DISPOSABLE POSTGRES ONLY.
# Usage: PGHOST=<socket dir|localhost> PGPORT=... PGUSER=postgres bash scripts/ads-staging-bootstrap-test.sh
# Never point this at a hosted project: it refuses non-local hosts.
set -euo pipefail
cd "$(dirname "$0")/.."
case "${PGHOST:-}" in /*|localhost|127.0.0.1) ;; *) echo "Refusing: PGHOST must be a local socket dir or localhost" >&2; exit 2;; esac

PSQL="psql -X -q -v ON_ERROR_STOP=1"
PLATFORM=supabase/tests/staging/00_local_platform_only_shim.sql
FULLSHIM=supabase/tests/ads/00_local_supabase_shim.sql
BOOT=supabase/staging/01_ads_staging_bootstrap.sql
MIG=supabase/migrations/20261015120000_ads_platform_phase1.sql
MIG2=supabase/migrations/20261016090000_ads_standard_earliest_start.sql
GRANT=supabase/staging/04_grant_synthetic_admin.sql
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
PHRASE='I AM APPLYING THIS TO msm-ads-staging oyakrgdmplmxmlhjfqcd ONLY'
sed "s/v_confirm constant text := 'NOT-CONFIRMED';/v_confirm constant text := '$PHRASE';/" "$BOOT" > "$TMP/boot_confirmed.sql"
grep -q "$PHRASE';" "$TMP/boot_confirmed.sql"
fail=0
mk_grant() { sed -e "s/v_email   constant text := 'EDIT-ME+msm-staging@example.invalid';/v_email   constant text := '$1';/" -e "s/v_confirm constant text := 'NOT-CONFIRMED';/v_confirm constant text := 'GRANT STAGING ADMIN ON oyakrgdmplmxmlhjfqcd';/" "$GRANT" > "$TMP/grant.sql"; }
pass() { echo "  PASS $1"; }
bad() { echo "  FAIL $1"; fail=1; }
fresh() { $PSQL -d postgres -c "drop database if exists $1" -c "create database $1" >/dev/null; $PSQL -d "$1" -f "$2" >/dev/null; }
q() { $PSQL -d "$1" -tAc "$2"; }
expect_reject() { # db file pattern label
  local out; if out=$($PSQL -d "$1" -f "$2" 2>&1); then bad "$4 (script succeeded)"; elif grep -q "$3" <<<"$out"; then pass "$4"; else bad "$4 (wrong error: $(grep -m1 ERROR <<<"$out"))"; fi
}
fingerprint() { q "$1" "select (select count(*) from pg_namespace where nspname in ('msm_staging','ads_internal')) || '/' || (select count(*) from pg_class k where k.relnamespace='public'::regnamespace) || '/' || (select count(*) from pg_proc where pronamespace='public'::regnamespace) || '/' || (select count(*) from auth.users) || '/' || (select count(*) from storage.buckets) || '/' || coalesce((select md5(string_agg(pg_get_functiondef(oid), '' order by proname)) from pg_proc where pronamespace='public'::regnamespace), '-')"; }

echo "== 1. Guard: unedited script (no opt-in) is rejected and changes nothing"
fresh stg_a "$PLATFORM"
before=$(fingerprint stg_a)
expect_reject stg_a "$BOOT" "opt-in phrase not set" "no opt-in -> rejected"
[[ "$(fingerprint stg_a)" == "$before" ]] && pass "nothing created" || bad "state changed"

echo "== 2. Bootstrap (opted in) + UNCHANGED ads migration on an empty platform DB"
$PSQL -d stg_a -f "$TMP/boot_confirmed.sql" >/dev/null && pass "bootstrap applied" || bad "bootstrap failed"
$PSQL -d stg_a -f "$MIG" >/dev/null && pass "ads migration applied unchanged" || bad "ads migration failed"
$PSQL -d stg_a -f "$MIG2" >/dev/null && pass "forward migration (standard earliest start) applied" || bad "forward migration failed"
$PSQL -d stg_a -f supabase/migrations/20261016120000_ads_review_corrections_priority.sql >/dev/null && pass "forward migration (review/corrections/priority) applied" || bad "review migration failed"
$PSQL -d stg_a -f supabase/migrations/20261016150000_ads_refund_cancellation_assessment.sql >/dev/null && pass "forward migration (refund/cancellation assessment) applied" || bad "refund migration failed"
post=$($PSQL -d stg_a -tA -F'|' -f supabase/staging/03_postflight_readonly.sql)
echo "$post" | sed 's/^/     /'
[[ "$(echo "$post" | awk -F'|' '$2!="t"' | wc -l)" == "0" ]] && pass "postflight all ok" || bad "postflight"
out=$($PSQL -d stg_a -f supabase/tests/staging/10_bootstrap_privileges.sql 2>&1) && grep -q "ALL CHECKS PASSED" <<<"$out" && pass "privilege/semantics checks" || { bad "privileges"; echo "$out" | grep -E "ERROR|FAIL"; }
out=$($PSQL -d stg_a -f supabase/tests/ads/10_ads_phase1_regression.sql 2>&1) && grep -q "ALL CHECKS PASSED" <<<"$out" && pass "full ads regression suite on bootstrapped DB" || { bad "ads regression"; echo "$out" | grep -E "ERROR|FAIL"; }
out=$($PSQL -d stg_a -f supabase/tests/ads/20_review_corrections_priority.sql 2>&1) && grep -q "ALL CHECKS PASSED" <<<"$out" && pass "review/corrections/priority suite on bootstrapped DB" || { bad "review suite"; echo "$out" | grep -E "ERROR|FAIL"; }
out=$($PSQL -d stg_a -f supabase/tests/ads/30_refunds_cancellation.sql 2>&1) && grep -q "ALL CHECKS PASSED" <<<"$out" && pass "refunds/cancellation suite on bootstrapped DB" || { bad "refund suite"; echo "$out" | grep -E "ERROR|FAIL"; }
echo "   client grants on profiles/user_roles:"
q stg_a "select '     ' || table_name || ' ' || grantee || ' ' || string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name in ('profiles','user_roles') and grantee in ('anon','authenticated','PUBLIC') group by table_name, grantee order by 1"

echo "== 3. Re-running the bootstrap is rejected"
expect_reject stg_a "$TMP/boot_confirmed.sql" "STAGING GUARD: public schema already has" "second run -> rejected"

echo "== 4. Production-like populated schema is rejected and left untouched"
fresh stg_prod "$FULLSHIM"
$PSQL -d stg_prod >/dev/null <<'SQL'
create table public.gigs (id uuid primary key default gen_random_uuid(), status text, date date);
create table public.venues (id uuid primary key default gen_random_uuid(), name text);
insert into auth.users (email) values ('zz-prodlike-1@example.invalid'), ('zz-prodlike-2@example.invalid');
insert into public.gigs (status) values ('approved');
insert into public.venues (name) values ('ZZ venue');
insert into storage.buckets (id, name, public) values ('band-photos', 'band-photos', true);
SQL
before=$(fingerprint stg_prod)
expect_reject stg_prod "$TMP/boot_confirmed.sql" "STAGING GUARD" "production-like DB -> rejected"
[[ "$(fingerprint stg_prod)" == "$before" ]] && pass "production-like DB unchanged (schemas/relations/functions/users/buckets/function bodies)" || bad "production-like DB changed"
mk_grant "zz-prodlike-1+msm-staging@example.invalid"
q stg_prod "insert into auth.users (email) values ('zz-prodlike-1+msm-staging@example.invalid')" >/dev/null
expect_reject stg_prod "$TMP/grant.sql" "staging marker missing" "fully opted-in admin grant rejected on production-like DB (no staging marker)"

echo "== 5. Each emptiness condition rejects on its own"
fresh stg_u "$PLATFORM"; q stg_u "insert into auth.users (email) values ('zz@example.invalid')" >/dev/null
expect_reject stg_u "$TMP/boot_confirmed.sql" "auth.users has 1 user" "existing auth user -> rejected"
fresh stg_b "$PLATFORM"; q stg_b "insert into storage.buckets (id, name) values ('x', 'x')" >/dev/null
expect_reject stg_b "$TMP/boot_confirmed.sql" "storage has 1 bucket" "existing bucket -> rejected"
fresh stg_f "$PLATFORM"; q stg_f "create function public.has_role(t text) returns boolean language sql as 'select true'" >/dev/null
expect_reject stg_f "$TMP/boot_confirmed.sql" "public schema already has 1 function" "existing function -> rejected (never replaced)"
[[ "$(q stg_f "select prosrc from pg_proc where proname='has_role'")" == "select true" ]] && pass "existing function body untouched" || bad "function replaced"
$PSQL -d postgres -c "drop database if exists stg_plain" -c "create database stg_plain" >/dev/null
expect_reject stg_plain "$TMP/boot_confirmed.sql" "Supabase platform objects" "non-Supabase database -> rejected"

echo "== 6. Mid-script failure rolls back everything"
fresh stg_rb "$PLATFORM"
before=$(fingerprint stg_rb)
sed 's/^commit;$/select 1\/0;\ncommit;/' "$TMP/boot_confirmed.sql" > "$TMP/boot_fail.sql"
expect_reject stg_rb "$TMP/boot_fail.sql" "division by zero" "injected late error -> script fails"
[[ "$(fingerprint stg_rb)" == "$before" ]] && pass "rolled back completely" || bad "partial bootstrap persisted"

echo "== 7. Synthetic admin grant (separately authorised step)"
expect_reject stg_a "$GRANT" "confirmation phrase not set" "unconfirmed grant -> rejected"
mk_grant "tester+msm-staging-admin@example.invalid"
expect_reject stg_a "$TMP/grant.sql" "expected exactly 1 auth user" "account not created yet -> rejected"
# Local stand-in for Dashboard -> Authentication -> Add user (hosted: never insert into auth.users).
q stg_a "insert into auth.users (email) values ('tester+msm-staging-admin@example.invalid'), ('real.person@example.invalid')" >/dev/null
mk_grant "real.person@example.invalid"
expect_reject stg_a "$TMP/grant.sql" "must be the synthetic staging account" "non-synthetic email -> rejected"
mk_grant "tester+msm-staging-admin@example.invalid"
$PSQL -d stg_a -f "$TMP/grant.sql" >/dev/null 2>&1 && pass "synthetic admin granted" || bad "grant failed"
uid=$(q stg_a "select id from auth.users where email='tester+msm-staging-admin@example.invalid'")
[[ "$(q stg_a "begin; select set_config('request.jwt.claims', '{\"sub\":\"$uid\",\"role\":\"authenticated\"}', true); set local role authenticated; select public.is_admin_or_above()::text || '/' || (select role from public.profiles where user_id = auth.uid()); rollback;" | grep -E '^(true|false)/')" == "true/admin" ]] && pass "granted account is admin in DB and for the App's admin tab" || bad "admin semantics"
expect_reject stg_a "$TMP/grant.sql" "an admin already exists" "second admin grant -> rejected"
[[ "$(q stg_a "select count(*) from public.ad_settings where bool_value")" == "0" ]] && pass "no ads toggle was enabled by any step" || bad "toggles enabled"

for d in stg_a stg_prod stg_u stg_b stg_f stg_plain stg_rb; do $PSQL -d postgres -c "drop database if exists $d" >/dev/null; done
[[ $fail == 0 ]] && echo "ALL STAGING BOOTSTRAP TESTS PASSED" || { echo "STAGING BOOTSTRAP TESTS FAILED"; exit 1; }
