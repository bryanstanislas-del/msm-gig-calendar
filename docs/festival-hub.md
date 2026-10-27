# Festival Hub (demo milestone)

Status: **working demo on branch `feature/festival-hub` only.** These are
fictional example listings, not a real festival directory. Nothing in this
milestone touches the database, production settings or the WordPress site.

## What it is

`/festival-hub/` is a standalone page for grassroots bands:

- search and filter by region, genre, deadline window, status and shortlist
- per-listing detail: festival dates, location, eligibility, fees (or "Not
  known"), example application link, example source link, last-checked date
- statuses: Open / Not yet open / Closed / Unverified
- shortlist, progress stage (interested → preparing → applied → outcome) and
  an EPK / music / live video / bio / tech spec / stage plot / booking-contact
  checklist
- plain links to the existing calendar (`/`) and claim directory (`/claim`);
  MSM registration is never required to apply anywhere, and the hub never
  submits applications.

## Isolation

The live calendar's backend URL and key are hard-coded in `src/App.jsx` and
`src/supabaseClient.js`, and Vercel's default `SUPABASE_*` variables apply
to both Production and Preview. **No separate backend has been verified for
this branch**, so the hub uses no backend at all:

| Concern | How it is handled |
| --- | --- |
| Separate code | Second Vite build (`vite.festival-hub.config.js`) of `festival-hub/index.html`, output to `dist/festival-hub/`. Shares no chunks with the calendar. |
| No backend client | The hub imports only React and `src/festivalHub/*`. `isolation.test.js` walks the import graph and bans backend, `fetch`, XHR, WebSocket, beacon and service-worker code. |
| Data | `demoFixtures.js`: 8 fictional entries, all `isDemo`, links only to `https://example.org/festival-hub-demo/...`, shown with DEMO badges and a permanent banner. |
| Saved state | `localStorage` key `msm.festivalHub.v1` in the viewer's browser only. Validated on read and write (bounded slug ids, known stages/outcomes, boolean checklist ticks, max 200). No free text and no contact details. Failures show a visible notice. |
| Routing | `vercel.json` rewrites exactly `/festival-hub` and `/festival-hub/` to `/festival-hub/index.html`, before the catch-all. Assets are real files under `/festival-hub/assets/`. |
| Calendar service worker | `navigateFallbackDenylist` now includes `/^\/festival-hub(\/|$)/`, and hub files are not in its precache. |
| Calendar shell on a hub path | `src/festivalHubPathGuard.js` is the first import of `src/main.jsx`. Only on `/festival-hub` paths it redirects to `/festival-hub/index.html` and throws, so `App.jsx` (and its backend client) and the service-worker registration never evaluate. All other paths are unaffected (unit + browser tests). |
| Search engines | `<meta name="robots" content="noindex, nofollow">`; not in the sitemap. |

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
local stub (recorded, never forwarded).

## Later phases (not in this milestone)

Only after a separate, verified non-production backend exists:

- **Curated listings**: festival, edition, application-window and source
  records with moderation states (draft → verified → published → expired),
  each published window requiring an official source URL and last-checked
  date; editor-only writes.
- **Per-user saved records**: one row per (user, listing) holding stage,
  outcome and checklist booleans, readable and writable only by its owner,
  with ownership/row-level-security regression tests (owner can read/write,
  other users and anonymous callers cannot, admins cannot impersonate).
- Optional import of the browser-local shortlist after sign-in.

No schema, migration or SQL files are included until that backend is
verified. Emails, payments, advertising and calendar writes stay out of scope.
