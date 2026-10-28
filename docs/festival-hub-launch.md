# Festival Hub – launch record and runbook (festivals.musicscenemagazine.co.uk)

Status: **LIVE since 28 Oct 2026.** The production deployment, DNS, the
WordPress page and the calendar promotion were all done by the project owner
in the Vercel, Cloudflare and WordPress dashboards. Claude made no provider
deployments, DNS or WordPress changes, and no database, settings, ads or `main`
writes.

## Launch record (owner-reported, 28 Oct 2026)

| Item | Fact |
| --- | --- |
| Hub project | `msm-festival-hub`, project ID `prj_ez2TpZnlU8UFaG4Lk4KIov5sWOje`, team `msm-gig-calendar-s-projects`. **No environment variables, no backend, no functions.** |
| Hub production | deployment `DitwSHqgTyyfXLDvMgirdofTzaqs`, Ready, built in 11 s from `release/festival-hub` @ `1c215411aa6d1476025d55af149eaec3bbebe755` (a fast-forward from `f19ab2c`; never merged) |
| Hub build log | `verified (LAUNCH mode)`, 6 static files, no Functions |
| Hub URL | https://festivals.musicscenemagazine.co.uk/ (also served at the project's `*.vercel.app` URLs, which must send `noindex`) |
| DNS | Cloudflare **CNAME** `festivals` → `666124bca49cbb84.vercel-dns-017.com`, DNS only (proxy off); Vercel shows the domain as valid. Don't use the domain's Environment binding: the UI errored with "Invalid customEnvironmentId". |
| WordPress | page ID 6915, published at https://musicscenemagazine.co.uk/festival-hub/ (copy draft: `docs/festival-hub-wp-explainer.md`) |
| Calendar | the preview build of `calendar/festival-hub-link` @ `c49ef0552179401f6e79346b6df13ec5e6fa1e8d` was **promoted to Production**, using the Production environment variables (confirmed in the Vercel dialog): deployment `dpl_8RBzFuUgdcQ9981kM3U8xyQ6viA9`, Ready, 17 s. `main` is unchanged at `13db12b`. |

**Navigation (all same tab, no "live site" suffix):**
- the calendar's nav has **FESTIVAL HUB** right after CALENDAR / LIST VIEW, linking to the Hub;
- the Hub header has **Gig Calendar** and **About Festival Hub**, linking to the calendar and the WordPress page;
- the WordPress page links to the Hub and the Gig Calendar.

### What was checked, and by whom

**Verified after launch, by the owner in a browser:**
- the Hub shows 26 listings, 13 open, with no staging banner and no demo;
- the nav is correct;
- in the DOM, there is exactly **one canonical**, `https://festivals.musicscenemagazine.co.uk/`, and the robots meta is `index, follow`;
- `/robots.txt` is exactly `User-agent: *` / `Allow: /` / `Sitemap: https://festivals.musicscenemagazine.co.uk/sitemap.xml`;
- `/sitemap.xml` has the root `<loc>https://festivals.musicscenemagazine.co.uk/</loc>`;
- `/sw.js` and `/api/og` each return Vercel's `404 NOT_FOUND`;
- live search for "Hanwell" shows 1 of 26;
- a shortlist save persisted across a reload, and the test entry was then removed;
- Hub → WordPress → Hub, and calendar ↔ Hub, all navigate in the same tab;
- the live calendar loads (1,618 gigs) and shows the FESTIVAL HUB link;
- the build log shows the LAUNCH mode with 6 files.

**Verified after launch, from GitHub commit statuses:** the Hub project's
Ignored Build Step works. Claude's docs push of `feature/festival-hub` @
`0aeda29` was reported by `msm-festival-hub` as **"Canceled by Ignored Build
Step"**, so nothing was built or deployed there.

**NOT verified after launch: the response headers.** These are:
- the `Content-Security-Policy` header (and the other security headers);
- **no `X-Robots-Tag` on the custom hostname**;
- `X-Robots-Tag: noindex, nofollow` on the `*.vercel.app` deployment URL.

Why they weren't measured:
- the Claude dev environment's network policy refuses both hosts (no workaround was attempted);
- the owner's in-browser Vercel fetch was rejected by automated review, because it could create an authenticated share URL;
- no access changes or retries were made.

Before launch, these headers were verified **locally** on byte-identical code:
- fresh-clone end-to-end tests of `1c21541` with `VERCEL_ENV=production`: 18/18;
- the template's host rules, emulated for 8 hosts.

They remain an **open post-launch check**. Run these from any terminal:

```sh
curl -sSI https://festivals.musicscenemagazine.co.uk/ | grep -iE '^HTTP|^x-robots-tag|^content-security-policy'   # 200, NO x-robots-tag, CSP present
curl -sSI https://<project>.vercel.app/ | grep -iE '^HTTP|^x-robots-tag'   # x-robots-tag: noindex, nofollow (or 401 if protected)
```

**Known, pre-existing, not changed:** the calendar's Vercel build warns about a
duplicate `onClick` on the "GIGS" `Btn`. It's at `src/App.jsx` 4341–4342 on
`c49ef05`, the same lines as `main`'s 4339–4340 (moved down 2 lines by the
new constant). It's already on `main` and doesn't stop the build.

### ⚠ Calendar navigation persistence

The calendar's production deployment runs `c49ef05`, which is **not on
`main`**. **Any future production deployment of `main` will remove the FESTIVAL
HUB link** until the draft PR `calendar/festival-hub-link` → `main` is merged.
That includes a push or merge to `main`, a redeploy of `main`, or an Instant
Rollback to a pre-`c49ef05` deployment. Until then:
- don't deploy `main` to production; or
- deploy only a `main` that already contains `c49ef05`, which needs merge approval.

### Rollback

- **Hub:**
  - this is the first production deployment, so there is nothing to roll back to;
  - to take it offline, remove `festivals.musicscenemagazine.co.uk` from the project, or delete or disable the Cloudflare CNAME;
  - for a bad future release, use Vercel Instant Rollback to `DitwSHqgTyyfXLDvMgirdofTzaqs`;
  - to revert code, cherry-pick a revert onto `release/festival-hub` (no merges, no force-push). If Git is connected with that branch as production, the push redeploys production.
- **Calendar:** Instant Rollback to the previous production deployment (built from `main` @ `13db12b`). This removes only the nav link.
- **WordPress:** return page 6915 to Draft.
- The Hub, the calendar and WordPress roll back independently. None of them uses the live database for the Hub.

### No live database

- **The Hub** is static:
  - no backend, functions or environment variables;
  - its CSP sets `connect-src 'none'`;
  - the build verifier fails on any backend host, key or API path;
  - shortlists are kept only in each visitor's browser.
- **The calendar change** is one nav link, with no data, API or settings changes.

---

## Build modes

One build (`vite.festival-hub-standalone.config.js` + `scripts/standalone/verify-output.mjs`)
has two modes, decided at build time by `scripts/standalone/mode.mjs`:

| Mode | When | Output (verified strictly) |
| --- | --- | --- |
| **staging** (default) | every other case: local builds, `npm run build:hub-standalone`, any preview, a release build that is not a production deployment | 4 files: hub HTML, one JS bundle, the logo WebP, the favicon. `noindex, nofollow` meta, title `MSM Festival Hub (Staging)`, no canonical, staging banner, demo available via `?demo=1`. |
| **launch** | `HUB_RELEASE=1` **and** `VERCEL_ENV=production` (i.e. `npm run build:hub-release` on a production deployment), or the explicit override `HUB_LAUNCH=1` | 6 files: the 4 above plus `robots.txt` and `sitemap.xml` with exact approved content. `index, follow` meta, exactly one canonical `https://festivals.musicscenemagazine.co.uk/`, matching `og:url`, launch title and description, no staging text, no staging banner, **no demo** (the demo fixtures, links, notice and `?demo=1` handling are compiled out; the verifier fails the build if any demo or staging marker is in the JS). |

`VITE_HUB_LAUNCH` is injected by the Vite config (`define`), so the mode can't
be switched at runtime. In launch builds, links to MSM properties (calendar, WordPress page) open in the same tab with plain labels; staging builds keep the new-tab "(live site)" marking.

## Indexing: only the approved hostname

Two layers:

1. **HTML** – staging builds are always `noindex`. Launch builds are indexable.
2. **`X-Robots-Tag` header** – the release template
   (`scripts/standalone/vercel.release.json`) sends `X-Robots-Tag: noindex, nofollow`
   on every response **unless** the request's host is exactly
   `festivals.musicscenemagazine.co.uk`:

   ```json
   { "source": "/(.*)",
     "missing": [{ "type": "host", "value": "^festivals\\.musicscenemagazine\\.co\\.uk$" }],
     "headers": [{ "key": "X-Robots-Tag", "value": "noindex, nofollow" }] }
   ```

   So every `*.vercel.app` URL (production or preview), `www.` and look-alike
   hosts all get `noindex`, even for a launch build. The header overrides the
   HTML meta for search engines.

**Verified, not guessed:** Vercel's own config validator, `@vercel/routing-utils`
6.6.0 (`dist/schemas.js`, from the npm registry), defines `headers[].has` and
`headers[].missing` with `{ "type": "host", "value": … }`, where a string
`value` is a regular expression. A scratch validator built from those schemas
accepted the release template and rejected 3 malformed variants. (The
`openapi.vercel.sh` schema host is blocked by this environment's proxy and was
not bypassed.) Tests: `scripts/standalone/mode.test.js` (exact-host regex
against 10 non-approved hosts, template structure) and
`npm run test:e2e:hub-standalone`, which serves the template's header rules
with the same `has`/`missing` host semantics and checks 8 hosts.

No HSTS header is added (not needed now).

## Branches

| Branch | Root `vercel.json` | Purpose |
| --- | --- | --- |
| `feature/festival-hub` | calendar (full tree) | development, draft PR. |
| `feature/festival-hub-standalone` | standalone template | existing staging preview. Never merged. |
| `release/festival-hub` | **release** template (`npm run build:hub-release`) | **production branch of `msm-festival-hub`; live at `1c21541`.** In any preview it builds **staging**. Only a production deployment builds **launch**. |
| `candidate/festival-hub-nav` (+ `-launch-check`) | release template (+ forced launch) | the reviewed nav candidate `1c21541` (launch-check `a9ca080`); `release/festival-hub` was fast-forwarded to it. |
| `calendar/festival-hub-link` | calendar (from `main` @ `13db12b`) | the calendar's FESTIVAL HUB link, `c49ef05`, **promoted to calendar production**. Draft PR to `main` for persistence. |
| `release/festival-hub-launch-check` | release template, build command `HUB_LAUNCH=1 npm run build:hub-release` | review only (pre-nav, `148b443`): a **preview** that forces the launch build so the public page, robots.txt and sitemap.xml can be checked before production. Its `*.vercel.app` URL still sends `noindex`. Never a production branch. |

The release branches are minimal hub-only trees, built the same way as the
standalone branch (no `api/`, `supabase/`, calendar sources or tests) and synced
by **cherry-pick only** (never `git merge`). They get no PR and are never merged
into `main`.

Before connecting anything, test from a fresh clone (run from `feature/festival-hub`;
the test uses the checkout's own root `vercel.json`):

```
git clone --branch release/festival-hub <repo> hub-release && (cd hub-release && npm ci)
STANDALONE_CHECKOUT=hub-release npm run test:e2e:hub-standalone              # preview -> staging
STANDALONE_CHECKOUT=hub-release VERCEL_ENV=production HUB_EXPECT=launch npm run test:e2e:hub-standalone

git clone --branch release/festival-hub-launch-check <repo> hub-check && (cd hub-check && npm ci)
STANDALONE_CHECKOUT=hub-check HUB_EXPECT=launch npm run test:e2e:hub-standalone
```

## Connecting the project safely (as used for launch)

- **Ignored Build Step** (Settings → Git):
  `[ "$VERCEL_GIT_COMMIT_REF" = "release/festival-hub" ] && exit 1 || exit 0`.
  Exit 1 builds and exit 0 skips, so `main` and every other branch are skipped.
- **Production branch:** `release/festival-hub`. Never import or deploy `main` in this project.
- **Build settings:** Framework Other, Root Directory blank, no build/output
  overrides (`vercel.json`: `npm run build:hub-release` → `dist-hub-standalone`),
  and no environment variables.

**Confirmed saved (owner, 28 Oct 2026):**
- Ignored Build Step: custom bash `[ "$VERCEL_GIT_COMMIT_REF" = "release/festival-hub" ] && exit 1 || exit 0`;
- Production branch: `release/festival-hub`;
- Node 22.x;
- no environment variables;
- Framework: Other.

The guard was also confirmed independently: the `0aeda29` docs push was
reported as "Canceled by Ignored Build Step".

## Updating the Hub later

Change `feature/festival-hub` and run the tests (`docs/festival-hub.md`,
"Running"). Then cherry-pick the runtime commits onto a candidate branch from
`release/festival-hub` and test a fresh clone (above). After approval,
fast-forward `release/festival-hub`.
