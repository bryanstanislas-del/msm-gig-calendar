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
- **Without the Calendar shell (below), the app does not start.** It stays on "Loading gigs", and the console reports `public.gigs` / `public.venues` missing from the schema cache. This was observed on the shared-client preview on 2026-10-17. The startup queries do **not** tolerate the missing tables, and that is deliberately not hidden in code.

## Calendar shell fixture (staging only; separately authorised)

`05_calendar_shell_fixture.sql` creates **empty, read-only** `gigs`, `venues`, `claim_requests` and `notification_deliveries`. They carry only the columns the app's startup and synthetic admin/advertiser login paths filter and order on.

**Safeguards.**
- RLS is on, with SELECT-only policies (approved gigs public; claim requests admin-only; notifications own-only).
- There are **no client INSERT/UPDATE/DELETE grants**, and no production rows are copied.
- It is **not** a migration and must never run on production.

**Guards.**
1. An opt-in phrase.
2. The `msm_staging.bootstrap` marker for `oyakrgdmplmxmlhjfqcd` must exist.
3. Every auth user must be `@example.invalid`.
4. None of the four tables may exist already; an existing schema is never altered.

Everything runs in one transaction. Other Calendar screens (follows, notifications page, claims workflow, import, festivals data) still need their real tables and will show errors on staging.

**Manual staging apply order** (after `01` and `20261015120000`, already applied):
1. Run `00_preflight_readonly.sql` for reference.
2. Open `05_calendar_shell_fixture.sql` and replace `NOT-CONFIRMED` with `I AM APPLYING THE CALENDAR SHELL TO msm-ads-staging oyakrgdmplmxmlhjfqcd ONLY`. Run it once.
3. Apply the ads migrations in the order listed in `docs/ads/launch-checklist.md` §3.
4. Run `03_postflight_readonly.sql`. Row 5 "no admin accounts yet" is expected to be false once the synthetic admin exists; every other row should be true.

The shell does not depend on the ads migrations, and they do not depend on it.

**Local proof.** Section 8 of `npm run test:ads-staging` covers:
- refusal without the opt-in, on a production-like database, with a non-synthetic user, and with an existing `gigs` table (left untouched, nothing partially created);
- a clean apply;
- the app's startup and admin-login queries run as anon, user and admin;
- visibility rules and SELECT-only grants (`supabase/tests/staging/20_calendar_shell.sql`);
- a second run refused, and the ads regression suite still passing.

## Local validation (no hosted access)

`PGHOST=<local socket> PGPORT=… PGUSER=postgres npm run test:ads-staging` runs on a disposable local Postgres with a platform-only shim. It covers:
- guard rejections: no opt-in, re-run, production-like populated schema left untouched, each emptiness condition, non-Supabase DB;
- full rollback on an injected late error;
- bootstrap + unchanged migration + the full ads regression suite + privilege checks;
- the admin-grant guards.

## Remove staging

Simplest: pause or delete the msm-ads-staging project (it is disposable). Or run `supabase/rollbacks/20261015120000_ads_platform_phase1_down.sql` and then drop `profiles`, `user_roles`, the three helper functions and schema `msm_staging`, all on staging only.
