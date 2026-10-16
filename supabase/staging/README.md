# Hosted staging bootstrap — msm-ads-staging ONLY

Target: Supabase project **msm-ads-staging**, ref **`oyakrgdmplmxmlhjfqcd`** (London, MSM Free).
**Never** production `fmlaaiolqwknowhtdeue`. **Never** apply `supabase/tests/**` (local shims) to any hosted project: hosted Supabase already provides `auth`, `storage` and the API roles.

These scripts create only what the unchanged ads migration and the existing App's auth/admin path need: minimal `profiles` and `user_roles`, plus `has_role()`, `is_admin_or_above()` and `update_updated_at()` with bodies identical to production. There are no Calendar tables, no real customer rows, no admin accounts, and every ads toggle stays OFF.

## Status (as REPORTED BY CODEX, 2026-10-16)

- Done on `oyakrgdmplmxmlhjfqcd` only: preflight EMPTY → bootstrap → `20261015120000_ads_platform_phase1.sql` unchanged → postflight.
- Synthetic `admin+msm-staging@example.invalid` and `advertiser+msm-staging@example.invalid` created via the dashboard and confirmed. The admin grant (`04`) was separately authorised and both roles verified; the advertiser has no privileged role.
- Eight postflight checks (adjusted for the granted admin) pass. Switches OFF; TEST inventory/products inactive; storage private; no bookings or payments.
- **Not yet applied:** `supabase/migrations/20261016090000_ads_standard_earliest_start.sql`. Apply it the same way (paste unchanged, run once) after review. It replaces only ads-owned functions, adds `ad_earliest_start()`, and resets `min_lead_days` from the seed value 3 to 0. It changes no toggles.
- Production `fmlaaiolqwknowhtdeue`: nothing ads-related applied.

See "Current status" in `docs/ads/README.md` for Vercel and Stripe.

## Guard and its honest limit

Postgres cannot report which Supabase project it belongs to (every project's database is named `postgres`), so no script can prove it is running on `oyakrgdmplmxmlhjfqcd`. The bootstrap therefore enforces, inside one transaction, before creating anything:

1. an **opt-in phrase** you type into the script only after checking the ref in the dashboard;
2. Supabase platform objects present (`auth.users`, `storage.*`, roles `anon`/`authenticated`/`service_role`);
3. an **empty application database**: no tables, views, sequences or functions in `public`, no `ads_internal`/`msm_staging` schema, **0 auth users**, **0 storage buckets**. Production fails every one of these.

Any failure raises before changes; any later error rolls the whole script back. Existing functions are never replaced (`create function`, not `create or replace`).

## Apply (SQL Editor of msm-ads-staging)

0. Open `https://supabase.com/dashboard/project/oyakrgdmplmxmlhjfqcd` and confirm the name is **msm-ads-staging**. Do not create any users yet.
1. Run **`00_preflight_readonly.sql`** (read-only). Expect every count to be `0` and verdict **EMPTY**. If not, stop.
2. Open **`01_ads_staging_bootstrap.sql`** and change only the line `v_confirm constant text := 'NOT-CONFIRMED';` to
   `v_confirm constant text := 'I AM APPLYING THIS TO msm-ads-staging oyakrgdmplmxmlhjfqcd ONLY';`
   Then run the whole file once. Expect success. If you see a `STAGING GUARD` error, nothing was changed.
3. Run **`supabase/migrations/20261015120000_ads_platform_phase1.sql` unchanged**: paste the whole file and run it once. A multi-statement run is one implicit transaction.
   Then, after review, run **`supabase/migrations/20261016090000_ads_standard_earliest_start.sql` unchanged**, the same way.
4. Run **`03_postflight_readonly.sql`** (read-only). Every row should show `ok = true`.
5. Recommended: in Authentication → Sign In / Providers, turn off **Allow new users to sign up** for staging, so only accounts you create exist.
6. Create **synthetic** test accounts only through **Authentication → Users → Add user** (auto-confirm). Never insert into `auth.users` with SQL. Use addresses tagged `+msm-staging` that you control, e.g. `you+msm-staging-admin@…` and `you+msm-staging-advertiser@…`.

## Assign the staging admin (separately authorised)

Only after someone authorises a specific synthetic account to be the staging admin:

1. Open **`04_grant_synthetic_admin.sql`** and edit its two marked lines (the `+msm-staging` email, and `GRANT STAGING ADMIN ON oyakrgdmplmxmlhjfqcd`).
2. Run it.

It refuses if:
- the staging marker or the ads migration is missing;
- the email isn't a `+msm-staging` address matching exactly one user;
- any admin already exists.

It sets `user_roles.role = 'admin'` (database checks) and `profiles.role = 'admin'` (the App's existing ADS-tab gate). Clients cannot grant roles or edit profiles themselves: there are no INSERT/UPDATE/DELETE grants.

Revoke (STAGING ONLY):

```sql
begin;
delete from public.user_roles where role = 'admin' and user_id = (select id from auth.users where email = 'you+msm-staging-admin@example.com');
update public.profiles set role = 'band' where user_id = (select id from auth.users where email = 'you+msm-staging-admin@example.com');
commit;
```

## What the App shows against staging

Point an isolated preview at staging as described in `docs/ads/README.md` ("Verification and deploy order").

- Sign in as the staging admin → **ADS** tab → enable TEST inventory and toggles deliberately. Nothing is enabled by these scripts.
- `/?view=advertise` shows the ADVERTISE tab once `ads_portal_enabled` is on.
- The Calendar views stay empty or on "loading", with console errors for `gigs`, `venues`, `claim_requests` and similar. Those Calendar tables are intentionally absent; the App's startup queries tolerate their absence and the ads tabs don't depend on them.

## Local validation (no hosted access)

`PGHOST=<local socket> PGPORT=… PGUSER=postgres npm run test:ads-staging` runs on a disposable local Postgres with a platform-only shim. It covers:
- guard rejections: no opt-in, re-run, production-like populated schema left untouched, each emptiness condition, non-Supabase DB;
- full rollback on an injected late error;
- bootstrap + unchanged migration + the full ads regression suite + privilege checks;
- the admin-grant guards.

## Remove staging

Simplest: pause or delete the msm-ads-staging project (it is disposable). Or run `supabase/rollbacks/20261015120000_ads_platform_phase1_down.sql` and then drop `profiles`, `user_roles`, the three helper functions and schema `msm_staging`, all on staging only.
