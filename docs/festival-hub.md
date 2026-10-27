# Festival Hub (staging)

Status: **staging only, on branch `feature/festival-hub`.** A small,
git-curated directory of 2027 festival application windows, checked against
official festival sources, plus a separate fictional demo behind an explicit
toggle. No backend, database, production settings or WordPress changes.

## What it is

`/festival-hub/` is a standalone page for grassroots bands:

- search and filter by region, genre, deadline window, status and shortlist
- per-listing detail: 2027 edition status, festival dates, location, genres,
  application window and deadline, eligibility, application fee, performer
  pay, how to apply, and **sources with checked dates** for both the festival
  and the application window. Unknown fields are shown as unknown.
- shortlist, progress stage (interested → preparing → applied → outcome) and
  an EPK / music / live video / bio / tech spec / stage plot / booking-contact
  checklist, saved only in the viewer's browser
- "Before you apply" preparation tips, and the MSM calendar benefits with
  links that open the **live** MSM Gig Calendar (labelled "live site").
  MSM registration is never required to apply anywhere; the hub never
  submits applications and never sends email.

## Data

| Mode | Source file | Shown |
| --- | --- | --- |
| Real (default) | `src/festivalHub/curatedListings.js` | `/festival-hub/` |
| Demo | `src/festivalHub/demoFixtures.js` (fictional, example.org links) | only `/festival-hub/?demo=1` |

The two are never mixed: each mode validates its own data (real records may
not use `demo-` ids or placeholder hosts; demo records must), resolves only
its own `#festival=<id>` links, and saves to its own browser key
(`msm.festivalHub.real.v1` / `msm.festivalHub.demo.v1`). An empty real
directory shows an honest "no verified listings yet" state, never demo data.

### Current real data (research batches A + B, checked 27 Oct 2026)

26 records. **The directory count is not the open count.** On the check
date: **13 Open, 1 Not yet open (Manorfest), 1 Not yet announced
(Wychwood), 4 Closed, 7 Unverified.** `curated.test.js` pins these numbers
at that date. Statuses then change on their own as deadlines pass and the
30-day freshness window runs out (see below), so the live count will drop
unless the records are re-checked.

Records were supplied by MSM's own research. Evidence notes are short
paraphrases; only short deadline wording is quoted. Third-party directories
were not used as proof (e.g. Milford on Sea's third-party deadline and
FOCUS Wales's third-party date were deliberately not stored).

### Schema (`schema.js`, documented field by field in `curatedListings.js`)

- **Three separate verifications**: the festival (`listingVerification`),
  whether the **2027 edition** is confirmed (`editionConfirmed`), and the
  **2027 application window** (`application`), each with its own source URL,
  optional extra sources, checked date, optional source publication date and
  evidence note.
- `application.status` records what the official source said: `open`,
  `announced` (future opening date), `not-yet-announced`, `closed`, or
  `unverified`. The *displayed* status is derived (below) — dates alone
  never make a listing open.
- Deadlines: `closes` (date), `closesTime` only when the source states a
  time (UK local, e.g. Hanwell Hootie's 21:00), `closesText` with the
  source's exact wording, `yearInferred` when the page omits the year,
  `yearConflict` when official pages disagree, and `noPublishedDeadline`
  only when the official source gives no deadline.
- `applicationFee` (cost to apply) is separate from `performerPay`
  (paid / unpaid / negotiated / not stated). Unpaid slots get a warning
  shown before any outbound link.
- `application.url` is an official application page; `urlEdition` says
  which year it is for. `application.email` is the organiser's published
  address, displayed as text only (no mailto link).
- Validation rejects unknown fields (typos), wrong edition years, regions
  outside the fixed UK list, non-https or placeholder URLs, future check
  dates, deadlines on/after the festival start, apply links on unverified
  windows, and more. Records with errors are never shown.

### Status rules (`status.js`) — safest status wins

1. Festival not verified → **Unverified**
2. Official pages conflict on the year/edition → **Unverified**
3. 2027 edition not confirmed → **Unverified**
4. Window not verified, or evidence not for 2027 → **Unverified**
5. A recorded deadline has passed → **Closed** (expiry always wins, even
   over a stale "open" banner, e.g. Hastings Fat Tuesday)
6. Source says closed → **Closed**
7. Application check older than **30 days** → **Unverified** ("needs
   re-checking"), for open / announced / not-yet-announced
8. Nothing published for 2027 yet → **Not yet announced**
9. Announced future opening date → **Not yet open** (once that date
   arrives it shows Unverified until someone confirms it opened)
10. Source says open: **Open** only with a deadline or explicit
    no-published-deadline evidence; otherwise Unverified

Deadlines with a stated time close at that UK time. Date-only deadlines are
shown as "time not stated — apply earlier"; the hub never claims the
organiser accepts until 23:59 (for status only, they count as closed from
the next UK calendar day).

"Open" means the official page showed an open 2027 call on the date
checked. It is not a guarantee, and MSM has not tested external forms
(Amplead, Google Forms); the detail view says so. Only Open listings get an
"Official application page" button; everything else links to official
information.

## Isolation

The live calendar's backend URL and key are hard-coded in `src/App.jsx` and
`src/supabaseClient.js`, and Vercel's default `SUPABASE_*` variables apply
to both Production and Preview. **No separate backend has been verified for
this branch**, so the hub uses no backend at all:

| Concern | How it is handled |
| --- | --- |
| Separate code | Second Vite build (`vite.festival-hub.config.js`) of `festival-hub/index.html`, output to `dist/festival-hub/`. Shares no chunks with the calendar. |
| No backend client | The hub imports only React and `src/festivalHub/*`. `isolation.test.js` walks the import graph and bans backend, `fetch`, XHR, WebSocket, beacon and service-worker code. |
| Data | Static, git-curated files only (`curatedListings.js`, `demoFixtures.js`). No database. |
| Saved state | `localStorage` keys `msm.festivalHub.real.v1` / `msm.festivalHub.demo.v1` in the viewer's browser only. Validated on read and write (bounded slug ids, known stages/outcomes, boolean checklist ticks, max 200). No free text and no contact details. Failures show a visible notice. |
| Routing | `vercel.json` rewrites exactly `/festival-hub` and `/festival-hub/` to `/festival-hub/index.html`, before the catch-all. Assets are real files under `/festival-hub/assets/`. |
| Calendar service worker | `navigateFallbackDenylist` now includes `/^\/festival-hub(\/|$)/`, and hub files are not in its precache. |
| Calendar shell on a hub path | `src/festivalHubPathGuard.js` is the first import of `src/main.jsx`. Only on `/festival-hub` paths it redirects to `/festival-hub/index.html` and throws, so `App.jsx` (and its backend client) and the service-worker registration never evaluate. All other paths are unaffected (unit + browser tests). |
| Search engines | `<meta name="robots" content="noindex, nofollow">`; not in the sitemap. A "Staging preview" banner is always shown. |
| Calendar links | Absolute links to `https://calendar.musicscenemagazine.co.uk` (the live site), new tab, labelled "live site". Never relative links to the preview's own calendar pages. |

### Known failure: stale pre-hub service worker

A browser that already has a calendar service worker from **before** this
branch (for example the production calendar origin, or a branch preview URL
visited before this change) answers the first `/festival-hub` navigation
from its cache with the **old** calendar, which then runs and makes its
normal backend calls until the worker auto-updates and reloads into the hub.
New code cannot change what an old worker has already cached. Measured
locally (backend stubbed): 6 backend requests on that first visit, 0 after.

This means **production isolation is not met** for origins with an old
worker. Staging review must use a fresh, deployment-specific Preview URL
opened directly at `/festival-hub/`. Before any production launch this needs
its own decision (e.g. ship the service-worker change first and let it
propagate, or serve the hub from a separate origin).

### Preview caveat

On the Preview deployment, every calendar page (`/`, `/claim`, profiles,
etc.) is still the normal calendar connected to the **production** backend.
Reviewers should only use `/festival-hub/` there and must not sign in or
submit anything on the calendar pages.

## Running

```
npm run dev:hub          # hub dev server, open /festival-hub/index.html
npm run build            # calendar build, then hub build
npm test                 # unit tests (includes src/festivalHub/*)
npm run test:e2e:hub     # Playwright checks against dist/ (needs a build)
OLD_DIST=/path/to/dist-from-main npm run test:e2e:hub   # also measure the stale-worker case
```

The browser checks serve `dist/` locally with `vercel.json`-equivalent
routing, abort every non-local request, and answer backend requests with a
local stub (recorded, never forwarded). The browser clock is frozen at
27 Oct 2026 12:00 UK time so counts and deadline windows are stable;
expiry, freshness and DST boundaries are unit-tested with explicit instants.

## Updating listings

Edit `src/festivalHub/curatedListings.js` (field guide at the top), then run
`npm test`. `curated.test.js` fails on any validation error and pins the
reviewed status counts for the check date — update that test deliberately
when a new batch changes the counts. Re-check open listings at least every
30 days, or they automatically show as "needs re-checking".

## Later phases (not in this milestone)

Only after a separate, verified non-production backend exists:

- **Curated listings in a database**: the same record shape with moderation
  states (draft → verified → published → expired); editor-only writes.
- **Per-user saved records**: one row per (user, listing) holding stage,
  outcome and checklist booleans, readable and writable only by its owner,
  with ownership/row-level-security regression tests (owner can read/write,
  other users and anonymous callers cannot, admins cannot impersonate).
- Optional import of the browser-local shortlist after sign-in.

No schema, migration or SQL files are included until that backend is
verified. Emails, payments, advertising and calendar writes stay out of scope.
