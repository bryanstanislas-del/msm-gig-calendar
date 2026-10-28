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

## Hub logo asset

The Hub shows the MSM logo from its own **derived** asset,
`src/festivalHub/assets/msm-logo-hub.webp`, imported in `theme.js` so Vite
emits a hashed `festival-hub/assets/msm-logo-hub-*.webp` in the Hub builds
only. The calendar keeps using the shared brand master
`public/brand/MSM-Logo-Master.png`, which is unchanged.

| | Shared master (calendar) | Hub derived copy |
| --- | --- | --- |
| File | `public/brand/MSM-Logo-Master.png` | `src/festivalHub/assets/msm-logo-hub.webp` |
| Format | PNG, 1254×1254 RGB | WebP **lossless** (VP8L), 1254×1254 |
| Bytes | 544,832 | 342,906 (−201,926 B, −37.1%) |
| Decoded pixels | — | identical to the master |
| Content credentials | C2PA `caBX` chunk (24,910 B) | **not carried over** |

Provenance: the WebP is a lossless format conversion of the master, made
with Pillow 12.3.0, and is **not** the original credentialled asset; for
provenance, refer to the master. To regenerate (byte-for-byte reproducible
with the same Pillow/libwebp), from the repo root:

```
python3 -c "from PIL import Image; Image.open('public/brand/MSM-Logo-Master.png').convert('RGB').save('src/festivalHub/assets/msm-logo-hub.webp', format='WEBP', lossless=True, quality=100, method=6, exact=True)"
```

Why lossless at full resolution: resampled versions (157–472 px) were much
smaller but changed how the small "MAGAZINE" line renders at 1×; the
lossless copy renders identically at 1×, 2× and 3×. Checks:
`src/festivalHub/logoAsset.test.js` (format, dimensions, size, master
unchanged) and the "Hub logo" browser checks in `scripts/e2e/festival-hub.mjs`
(the Hub loads only the WebP; decoded pixels and the rendered logo at 1×, 2×
and 3× are identical to the master). The standalone verifier allows exactly
one such lossless WebP, at most 350,000 B. Browsers without WebP support
(e.g. Safari before 14) would not show the logo; there is no PNG fallback.

Lab audit behind this change (not field Core Web Vitals): local server with
gzip, headless Chromium, throttled 150 ms RTT / 1.6 Mbps / 4× CPU — the
master was 78% of the 683.3 KB first load and arrived last (~4.2 s). The
font-loading alternatives tested (preconnect, a `<link>` in the head) were
not adopted: no gain, or a later first paint.

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

### Release-candidate security review (local, Hub runtime)

Source review plus local probes only (no live systems or external sites):

- External links: every data URL must pass `schema.js` (https only, no
  placeholder hosts in real data) or the record is not shown; 96/96 hostile
  URL cases (`javascript:` variants, `data:`, `vbscript:`, `file:`, `http:`,
  protocol-relative, relative, empty, non-strings) were rejected. Every
  `target="_blank"` link has `rel="noopener noreferrer"`.
- No `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`document.write`, no
  `fetch`/XHR/beacon/WebSocket/cookies/`postMessage`/`window.open` in the Hub
  runtime; React escapes all text (poisoned storage and malformed hashes did
  not execute anything even with the CSP removed).
- Browser storage: ids, stage/outcome and checklist booleans only, validated
  on read and write (bounded slug ids, known values, max 200, no prototype
  keys, no contact or free text).
- Malformed `#festival=` / `?demo=` values, back/forward and deep links in
  the other mode show "Listing not found" or nothing; no errors.
- Hardening (Low, latent): the demo/real toggles reuse the current path only
  if it is a known hub path (`/`, `/festival-hub`, `/festival-hub/`,
  `/festival-hub/index.html`), otherwise `/festival-hub/`, so a hub page
  served at an unexpected path such as `//host/` could not produce an
  off-site link. The current deployments serve the hub only at exact paths,
  so this was not exploitable on the current host.
- Informational: the https check accepts credentials-in-URL, punycode hosts
  and non-standard ports (curated data only); Google Fonts requests reveal
  visitor IP/UA to Google (self-hosting fonts would avoid it; not in scope);
  the CSP keeps `'unsafe-inline'` for styles (inline Hub CSS, no user CSS).

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

### Standalone preview (avoids, does not fix, the stale-worker problem)

To review the hub on an origin that has **never** served the calendar, a
separate hub-only build is deployed from the `feature/festival-hub-standalone`
branch as a Vercel **Preview** (never production, never merged, no PR).

**This does not fix the calendar origin.** A cached pre-hub service worker
on calendar.musicscenemagazine.co.uk (or any origin that served the
calendar) cannot be fixed retroactively by page code: it answers
navigations from its cache before any new page code runs. Only the
worker's own update or the user clearing site data changes that. The
standalone preview simply uses a fresh origin with no calendar worker.

How it is built and served:

| Piece | What it does |
| --- | --- |
| `vite.festival-hub-standalone.config.js` | Builds only `festival-hub/index.html` into `dist-hub-standalone/`: no PWA plugin, no service worker or manifest, no `public/` copy (only the favicon; the logo is the Hub's imported WebP), no source maps. Records the full module graph to `dist-hub-standalone.modules.json` (outside the output). |
| `scripts/standalone/verify-output.mjs` | Runs after that build (`npm run build:hub-standalone`) and fails it unless the output is only the hub HTML, its single JS bundle, exactly one lossless Hub-logo WebP of at most 350,000 B, and the favicon; the module graph is only `src/festivalHub/*`, React/ReactDOM/scheduler and Vite helpers; content has no backend host/ref/JWT/secret names, service worker, manifest, API path, source map or calendar code; the HTML has a single external module script; and the build mode (staging: noindex, staging title, no canonical, exactly 4 files; launch: see [the launch runbook](festival-hub-launch.md), exactly 6 files) holds. On Vercel (`VERCEL=1`) it also fails if `api/` or `supabase/` exist in the checkout. |
| `scripts/standalone/vercel.json` (template) | On the deploy branch it becomes the root `vercel.json`: build command `npm run build:hub-standalone`, output `dist-hub-standalone`, rewrites **only** `/`, `/festival-hub`, `/festival-hub/` to the hub (no catch-all, so every other path is 404), and headers on every response: strict CSP (`default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self'; connect-src 'none'; worker-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'` …), `X-Robots-Tag: noindex, nofollow`, `nosniff`, referrer and permissions policies. `'unsafe-inline'` styles are needed because the hub's CSS is an inline `<style>` and React style attributes. |
| `scripts/standalone/.vercelignore` (template) | On the deploy branch it becomes the root `.vercelignore`: ignore everything, re-include only the hub build inputs (package files, `vercel.json`, the standalone Vite config, `festival-hub/`, `src/festivalHub/` without tests (its `assets/` included), the favicon and `scripts/standalone/`). `api/` and `supabase/` are never uploaded, so no serverless functions can be detected; if they ever were, the verifier fails the build so nothing deploys. |

What remains true: the project's `SUPABASE_*` environment variables are
still present in the Vercel build environment (removing them would be a
project-settings change). The standalone build never reads them, Vite only
exposes `VITE_*` variables, and the verifier proves no key or backend host
is in the output. The calendar's own build (`npm run build`) and the
`feature/festival-hub` preview are unchanged (verified byte-identical).

Tests: `scripts/standalone/verify-output.test.js` (verifier rejects SW,
manifest, source maps, calendar bundle/App/backend client in the graph,
keys, API paths, inline scripts, missing noindex; template rules) and
`npm run test:e2e:hub-standalone`, which simulates the Vercel upload from
`.vercelignore`, builds from only those files with `VERCEL=1`, serves them
with the template's routes and headers, and checks routing, 404s, headers,
fresh rendering at `/` and `/festival-hub(/)`, no service worker (a forced
registration is blocked by CSP), no backend/API requests (forced fetches
are blocked by CSP), local saves and real/demo separation.

**The deploy branch is a minimal tracked tree.** Vercel's Git integration
did not apply `.vercelignore` (first standalone deployment
`9BcMzm9NB8nG77qgR1ChDVVpQ8wZ` failed safely: the verifier found `api/` and
`supabase/` in the build checkout). So `feature/festival-hub-standalone` is a
`feature/festival-hub` commit, plus the config commit, plus a commit that
removes every tracked file outside the hub build allowlist on that branch
only (`api/`, `supabase/`, calendar sources, entry, configs, `public/` except
the favicon, tests, docs). `feature/festival-hub` keeps the full
tree. `.vercelignore` stays as a second layer, and the verifier's
`api/`/`supabase/` check is unchanged.

Test from an actual checkout of the deploy branch:

```
git clone --branch feature/festival-hub-standalone <repo> hub-deploy
cd hub-deploy && npm ci && cd -
STANDALONE_CHECKOUT=hub-deploy npm run test:e2e:hub-standalone   # run from feature/festival-hub
```

**Syncing the deploy branch (no merges):** cherry-pick only the new
`feature/festival-hub` commits that change hub build inputs
(`src/festivalHub/`, `festival-hub/`, `scripts/standalone/`, the standalone
Vite config, package files) onto it with `git cherry-pick <sha>…` (never
`git merge`). If a pick touches a file that is not in the deploy tree, keep
it deleted (`git rm` it and continue). Then run the checkout test above and
push the deploy branch. It never gets a PR and is never merged anywhere.

### Launch (festivals.musicscenemagazine.co.uk)

Launch mode, the release template with host-conditional `noindex`, the
`release/festival-hub` and `release/festival-hub-launch-check` branches and the
held production/domain steps are in [festival-hub-launch.md](festival-hub-launch.md).

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
npm run build:hub-standalone      # hub-only build + output verifier (staging mode)
npm run build:hub-release         # same; launch mode only on a Vercel production deployment
HUB_LAUNCH=1 npm run build:hub-standalone   # force a local launch build
npm run test:e2e:hub-standalone   # standalone upload/build/routing/CSP checks
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
