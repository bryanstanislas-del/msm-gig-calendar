# Sprint 3.5 — Notification Delivery Architecture

Status: **design/schema only**. No push, email, or web-push delivery is
implemented or wired up in this sprint. `fanout_notification_event` is not
called from any trigger or application code path yet — it exists as a
callable, fully tested building block for a future delivery worker.

## Flow

```
notification_event → determine followers → apply preferences → create notification_deliveries → future delivery worker → delivered / failed / retry
```

1. **`notification_event` created** — unchanged from Sprint 3. A gig is
   approved/cancelled, or a festival profile is updated, and
   `recordGigNotificationEvents` / `DB.recordNotificationEvent` insert a row
   into `notification_events` (`event_type`, `entity_type`, `entity_id`,
   `metadata`, `created_by`). This insert never requests the row back
   (`.select()` is not called), so it is unaffected by that table's
   admin-only SELECT policy.
2. **Determine followers** — `fanout_notification_event(p_event_id)` looks up
   the event, then unions `band_follows` (bands/solo artists/festivals) or
   `venue_follows` (venues) for the event's `entity_id`.
3. **Apply preferences** — each follower's row in
   `user_notification_preferences` is left-joined (defaults apply if the
   user has never saved preferences: in-app on, email/web-push off, all
   alert categories on). The event's `event_type` maps to one preference
   category (`gig_added` → `new_gig_alerts`, `gig_cancelled` →
   `cancellation_alerts`, `venue_event_added` → `venue_updates`,
   `festival_updated` → `festival_updates`). A channel is only produced if
   both the category and the channel toggle are enabled.
4. **Create `notification_deliveries`** — one pending row per
   (event, recipient, channel), inserted with `ON CONFLICT DO NOTHING`
   against the `(notification_event_id, recipient_user_id,
   delivery_channel)` unique constraint, so calling fan-out twice for the
   same event is a no-op the second time.
5. **Future delivery worker** — not built in this sprint. It would poll
   `notification_deliveries where delivery_status = 'pending'` (the
   partial index `notification_deliveries_pending_idx` exists for exactly
   this query), attempt delivery per channel, and update `attempted_at`,
   `delivery_status`, `delivered_at`/`failed_at`, `failure_reason`,
   `provider_message_id`.
6. **Retry handling** — `retry_count` is reserved for the worker to
   increment on failure and re-queue (e.g. `delivery_status = 'pending'`
   again with `retry_count + 1`) up to a worker-defined cap; no retry
   scheduling logic exists yet.
7. **Failure handling** — `delivery_status = 'failed'` plus
   `failure_reason` (free text) is reserved for terminal/non-retryable
   failures. `'skipped'` is reserved for channels a worker decides not to
   attempt (e.g. no verified email on file).
8. **Read/unread state** — folded into `notification_deliveries` rather
   than a separate table, since a delivery *is* the in-app notification
   for the `in_app` channel: `read_state` (`unread`/`read`/`dismissed`),
   `opened_at`, `read_at`. `mark_notification_read(delivery_id, state)` is
   the only write path, and it's scoped to `recipient_user_id = auth.uid()`
   internally.
9. **Future email/web-push integration** — channels are already
   first-class (`delivery_channel` check constraint), and per-user
   `email_enabled`/`web_push_enabled` toggles already exist. Wiring in a
   real provider means adding a worker that reads pending
   `email`/`web_push` rows, calls the provider, and writes back
   `provider_message_id` — no schema change anticipated.

## Database objects introduced

Migration: `supabase/migrations/20260729155347_sprint3_5_notification_delivery_architecture.sql`
(+ hardening follow-up `20260729213817_sprint3_5_harden_notification_functions.sql`)

### Tables

**`user_notification_preferences`**
| column | type | default |
|---|---|---|
| id | uuid pk | `gen_random_uuid()` |
| user_id | uuid, unique, `references auth.users(id) on delete cascade` | — |
| in_app_enabled / email_enabled / web_push_enabled | boolean | `true` / `false` / `false` |
| new_gig_alerts / cancellation_alerts / artist_updates / venue_updates / festival_updates | boolean | `true` (all) |
| created_at / updated_at | timestamptz | `now()` |

Defaults are deliberately "operational alerts on, marketing off" —
`email_enabled` defaults `false` so no marketing/email consent is ever
implied by this table; it is entirely separate from the existing
newsletter opt-in system.

**`notification_deliveries`**
| column | type | default |
|---|---|---|
| id | uuid pk | `gen_random_uuid()` |
| notification_event_id | uuid, `references notification_events(id) on delete cascade` | — |
| recipient_user_id | uuid, `references auth.users(id) on delete cascade` | — |
| delivery_channel | text, check in (`in_app`,`email`,`web_push`) | — |
| delivery_status | text, check in (`pending`,`processing`,`delivered`,`failed`,`skipped`) | `'pending'` |
| attempted_at / delivered_at / failed_at | timestamptz | null |
| retry_count | integer | `0` |
| failure_reason / provider_message_id | text | null |
| read_state | text, check in (`unread`,`read`,`dismissed`) | `'unread'` |
| opened_at / read_at | timestamptz | null |
| created_at / updated_at | timestamptz | `now()` |

Constraints:
- `unique (notification_event_id, recipient_user_id, delivery_channel)` —
  the sole duplicate-prevention mechanism; combined with
  `fanout_notification_event`'s `ON CONFLICT DO NOTHING`, re-running fan-out
  for the same event is always safe.

Indexes:
- `notification_deliveries_recipient_idx (recipient_user_id, created_at desc)` — a user's own feed.
- `notification_deliveries_status_idx (delivery_status)` — worker/ops queries by status.
- `notification_deliveries_created_at_idx (created_at desc)` — recency queries/ops.
- `notification_deliveries_pending_idx (created_at) where delivery_status = 'pending'` — the worker's hot-path polling query.

### RLS policies

| table | policy | command | rule |
|---|---|---|---|
| user_notification_preferences | notification_preferences_select_own | SELECT | `auth.uid() = user_id` |
| user_notification_preferences | notification_preferences_insert_own | INSERT | `auth.uid() = user_id` |
| user_notification_preferences | notification_preferences_update_own | UPDATE | `auth.uid() = user_id` |
| notification_deliveries | notification_deliveries_select_own | SELECT | `auth.uid() = recipient_user_id` |
| notification_deliveries | notification_deliveries_select_admin | SELECT | `is_admin()` |
| notification_deliveries | notification_deliveries_admin_write | ALL | `is_admin()` |

No non-admin INSERT/UPDATE/DELETE policy exists on `notification_deliveries`
by design — the only way a row is created is via the SECURITY DEFINER
`fanout_notification_event`, and the only way `read_state` changes is via
`mark_notification_read`. A user cannot fabricate a delivery to themselves
or another user; there is no policy that would let them.

### RPC functions

**`fanout_notification_event(p_event_id uuid) returns integer`**
`SECURITY DEFINER`, `search_path = ''`. Looks up the event; the caller must
be `is_admin()`, a manager (`manages_entity`), or the entity's owner
(`profiles.user_id` / `venues.user_id` match), else it raises a single
generic error (`notification_event not found or not authorized`) —
deliberately not distinguishing "doesn't exist" from "not yours", so the
function can't be used to enumerate event ids. Returns the number of newly
inserted delivery rows (0 on a repeat call).

**`mark_notification_read(p_delivery_id uuid, p_state text default 'read') returns void`**
`SECURITY DEFINER`, `search_path = ''`. Updates only the row matching both
`id = p_delivery_id` and `recipient_user_id = auth.uid()`; if a caller
supplies someone else's delivery id, the `WHERE` matches zero rows and the
call is a silent, harmless no-op (verified in testing — see below).

### Grants

Both functions: `EXECUTE` revoked from `anon`/`public`, granted only to
`authenticated` (tightened in the hardening follow-up migration — see
Security findings below).

## Security verification

All tests below were run as real (rolled back) Postgres transactions
against the live schema, switching `role`/`request.jwt.claim.sub` mid
transaction to simulate each caller, using real existing rows (band
"Irrelevant Elephant", its real follower, and an unrelated existing user).
Every transaction ended in `ROLLBACK` — zero persisted test data.

| # | Scenario | Expected | Result |
|---|---|---|---|
| 1 | Owner creates a `notification_events` row for their own band | insert succeeds | ✅ |
| 2 | Owner calls `fanout_notification_event` on it | 1 delivery created (in_app, default prefs) | ✅ `1` |
| 3 | Owner calls it again on the same event | 0 new deliveries (idempotent) | ✅ `0` |
| 4 | Inspect deliveries for that event as admin | exactly 1 row, in_app channel | ✅ |
| 5 | Unrelated authenticated user calls fan-out on the owner's event | rejected | ✅ blocked, `P0001` |
| 6 | Admin calls fan-out on an event for a band they don't own | succeeds (admin override) | ✅ `1` |
| 7 | Follower's `email_enabled` set true, new event fanned out by owner | 2 deliveries (in_app + email) | ✅ `2` |
| 8 | Follower selects their own delivery row | visible | ✅ `1` |
| 9 | Unrelated authenticated user selects that same delivery row | invisible | ✅ `0` |
| 10 | Anonymous (no JWT) selects that same delivery row | invisible | ✅ `0` |
| 11 | Unrelated user attempts a direct `INSERT` into `notification_deliveries` | rejected | ✅ blocked, `42501` |
| 12 | Recipient calls `mark_notification_read(id,'read')` on their own delivery | `read_state` becomes `read` | ✅ |
| 13 | Unrelated user calls `mark_notification_read(id,'dismissed')` on someone else's delivery | silent no-op, no state change | ✅ still `read` |
| 14 | Unrelated user selects/updates another user's `user_notification_preferences` row | 0 rows visible, 0 rows updated | ✅ `0` / `0` |
| 15 | Owner of the preferences row selects it | visible | ✅ `1` |

### Permission matrix

| Actor | Read own deliveries | Read others' deliveries | Read own prefs | Read others' prefs | Call fan-out for owned/managed entity | Call fan-out for unrelated entity | Insert delivery directly | Mark own delivery read | Mark others' delivery read |
|---|---|---|---|---|---|---|---|---|---|
| Admin | ✅ (also sees all) | ✅ | ✅ | — (no admin-select policy on prefs; not required this sprint) | ✅ | ✅ (override) | ❌ (no insert policy incl. admin — only via RPC) | ✅ | no-op |
| Owner/manager | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ (rejected) | ❌ | ✅ | no-op |
| Unrelated authenticated user | ✅ (own, none exist) | ❌ | ✅ (own, none exist) | ❌ | ❌ (rejected) | ❌ | ❌ (RLS blocks) | n/a | no-op (silent) |
| Anonymous | ❌ | ❌ | ❌ | ❌ | ❌ (no EXECUTE grant) | ❌ | ❌ | n/a | n/a |

## Security findings from this sprint's review

Two Supabase advisory warnings were raised against the original migration
and were **not** dismissed as "matches existing pattern" — each was
independently assessed:

1. **`fanout_notification_event` and `mark_notification_read` callable by
   `anon`.** Investigated and found genuinely unnecessary: both functions
   require `auth.uid()` to do anything useful, and an anonymous caller
   always fails their internal authorization checks. Fixed by revoking
   `EXECUTE` from `anon`/`public` and granting only to `authenticated`
   (`20260729213817_sprint3_5_harden_notification_functions.sql`).
2. **`fanout_notification_event` callable by `authenticated`.** This warning
   remains and is *intentional* — a legitimate owner/manager/admin must be
   able to call it as themselves. This matches dozens of existing
   authenticated-gated RPCs already in this codebase
   (`approve_claim_request`, `search_entities`, etc.) that carry the same
   advisory and are accepted as normal for self-authorizing RPCs.
3. **Information-leak bug found and fixed** (not advisory-flagged, found by
   manual review): the original `fanout_notification_event` raised a
   distinct error for "event id not found" vs. "not authorized," which
   would let any authenticated caller enumerate valid `notification_event`
   ids by probing UUIDs and reading the error text. Both branches now raise
   the same generic message.

## `INSERT ... RETURNING` and `notification_events`

`notification_events` has only an admin-only SELECT policy. Postgres
requires an inserted row to pass a SELECT policy in order to be returned by
`INSERT ... RETURNING` — if it can't, Postgres raises `42501` rather than
silently omitting the row (this is documented Postgres RLS behaviour, not a
bug in this migration). This was the entire cause of this sprint's
`INSERT ... RETURNING` test failures during verification.

This does **not** affect production: `DB.recordNotificationEvent` in
`src/App.jsx` never calls `.select()` after its insert (it destructures
only `{ error }`), so PostgREST never requests row representation back and
the admin-only SELECT policy is never consulted for that call.

**If a future feature needs the new row's id back** (e.g. a delivery worker
that wants to fan out immediately without a second lookup), the
recommended design is a narrow `SECURITY DEFINER` RPC — e.g.
`create_notification_event(...) returns uuid` — that performs the insert
internally and returns the id as a plain scalar. Because the function's
internal logic isn't subject to the *caller's* SELECT RLS, this gets the id
back without ever widening who can directly query
`notification_events` via PostgREST. Weakening the SELECT policy itself
(e.g. adding "or `created_by = auth.uid()`") is explicitly **not**
recommended — it would make the event log directly browsable by any
authenticated user who has ever created one, which isn't otherwise needed.

## Migration safety

- Both migrations are additive only: 2 new tables, 2 new functions, grants
  and RLS policies scoped to the new tables/functions. No existing table,
  column, function, or policy was altered, renamed, or dropped.
- No naming collisions: `notification_deliveries`,
  `user_notification_preferences`, `fanout_notification_event`,
  `mark_notification_read` did not previously exist (checked against the
  full production schema via `list_tables` and `pg_proc` before writing the
  migration).
- Rollback SQL is included as a comment at the top of the first migration
  file, in reverse dependency order.
- Applied directly to the live Supabase project (no separate branch/schema
  diff step was available in this environment); verified immediately after
  with `get_advisors` and the full RLS test suite above, all in the same
  session, before any application code was touched.

## Remaining follow-up (out of scope for this sprint)

- A delivery worker (cron/edge function) to actually attempt in-app
  "delivery" (trivial — in-app delivery is just the row existing) and, in a
  future sprint, real email/web-push sends.
- Wiring `fanout_notification_event` to actually run — either a trigger on
  `notification_events` insert, or an explicit call from
  `recordGigNotificationEvents`/`DB.recordNotificationEvent` at the
  application layer. Neither is done yet, per this sprint's explicit scope.
- A user-facing preferences UI and an in-app notification list UI. Not
  built this sprint — the data model is verified and ready for one.
- `admin_read` policy on `user_notification_preferences` was intentionally
  left out (no current admin UI needs it); trivial to add later following
  the same pattern as `notification_deliveries_select_admin`.
