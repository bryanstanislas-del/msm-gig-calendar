#!/usr/bin/env bash
# LOCAL ONLY: replays every select in src/ads/adsClient.js through a REAL
# PostgREST (12.2.3, the API layer Supabase uses) against a disposable local
# database with all ads migrations + the staging Calendar shell, as admin,
# owner, other advertiser and anon. Catches PostgREST-only failures such as
# ambiguous embeds (PGRST201) that plain SQL tests cannot see.
#
#   PGHOST=<local socket|localhost> PGPORT=... PGUSER=postgres npm run test:ads-postgrest
#
# PostgREST binary: $POSTGREST_BIN, or the official v12.2.3 static Linux
# release downloaded once into ~/.cache/msm-ads/ and verified by SHA-256.
# Listens on 127.0.0.1 only; random JWT secret per run; no hosted service.
set -euo pipefail
cd "$(dirname "$0")/.."
case "${PGHOST:-}" in /*|localhost|127.0.0.1) ;; *) echo "Refusing: PGHOST must be a local socket dir or localhost" >&2; exit 2;; esac

VERSION=12.2.3
SHA256=9f71269e61ac3a940281e93ff415760f5957e430e475ba4c3889f3ede7d5527c
if [[ -z "${POSTGREST_BIN:-}" ]]; then
  CACHE="${HOME}/.cache/msm-ads/postgrest-$VERSION"
  POSTGREST_BIN="$CACHE/postgrest"
  if [[ ! -x "$POSTGREST_BIN" ]]; then
    mkdir -p "$CACHE"
    curl -fsSL -o "$CACHE/pgrst.tar.xz" "https://github.com/PostgREST/postgrest/releases/download/v$VERSION/postgrest-v$VERSION-linux-static-x64.tar.xz"
    echo "$SHA256  $CACHE/pgrst.tar.xz" | sha256sum -c --quiet - || { echo "PostgREST checksum mismatch" >&2; exit 2; }
    tar -xf "$CACHE/pgrst.tar.xz" -C "$CACHE"
  fi
fi

PSQL="psql -X -q -v ON_ERROR_STOP=1"
DB=ads_pgrst
TMP=$(mktemp -d)
cleanup() { [[ -n "${PID:-}" ]] && kill "$PID" 2>/dev/null || true; rm -rf "$TMP"; $PSQL -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
$PSQL -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
$PSQL -d $DB -f supabase/tests/ads/00_local_supabase_shim.sql >/dev/null
for m in supabase/migrations/2026101*_ads_*.sql; do $PSQL -d $DB -f "$m" >/dev/null; done
$PSQL -d $DB -f supabase/tests/postgrest/10_fixture.sql >/dev/null

PORT=$((39000 + RANDOM % 1000))
SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | head -c 48)
cat > "$TMP/pgrst.conf" <<CONF
db-uri = "postgresql://${PGUSER:-postgres}@/$DB?host=$PGHOST&port=${PGPORT:-5432}"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-host = "127.0.0.1"
server-port = $PORT
CONF
"$POSTGREST_BIN" "$TMP/pgrst.conf" > "$TMP/pgrst.log" 2>&1 &
PID=$!
for i in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.1; done
IDS=$($PSQL -d $DB -tA -F' ' -c "select admin_id, owner_id, other_id, booking_id from public.zz_pgrst_ids")
PGRST_URL="http://127.0.0.1:$PORT" PGRST_SECRET="$SECRET" PGRST_IDS="$IDS" node scripts/ads-postgrest-check.mjs
