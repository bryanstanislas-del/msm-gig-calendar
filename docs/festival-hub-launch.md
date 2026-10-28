# Festival Hub – launch runbook (festivals.musicscenemagazine.co.uk)

Status: **prepared and tested; final production deployment and domain
activation are held** until Bryan approves a tested candidate. Nothing in this
document has been done to the new Vercel project, its domains or DNS. All of
those steps are for the project owner.

The hub will be served by its own Vercel project, `msm-festival-hub`
(team `msm-gig-calendar-s-projects`). It is currently **empty**: it has no Git
connection, no import and no deployments. It has **no Supabase environment
variables, backend or functions**, and must not get any: the hub has no
backend.

Recorded setup facts (reported by the project owner; nothing here was done
from this repo or by Claude):

- `msm-festival-hub`, project ID `prj_ez2TpZnlU8UFaG4Lk4KIov5sWOje`: empty, no Git, no deployment.
- `festivals.musicscenemagazine.co.uk` is associated with that empty project as
  a Production domain only, and shows *Invalid Configuration*. No data or code is
  served, and no DNS record has been written.
- The record Vercel shows for it: **CNAME** `festivals` →
  `666124bca49cbb84.vercel-dns-017.com`. It goes at Cloudflare (the confirmed
  authoritative DNS) with the proxy **disabled** (DNS only). Use exactly this
  value; re-read it from Vercel if the project changes.
- Do not use the domain's Environment binding: the UI errored with
  "Invalid customEnvironmentId".

The calendar (`main`, its Vercel project, its production deployment
and calendar.musicscenemagazine.co.uk) is untouched by all of this.

## Build modes

One build (`vite.festival-hub-standalone.config.js` + `scripts/standalone/verify-output.mjs`)
has two modes, decided at build time by `scripts/standalone/mode.mjs`:

| Mode | When | Output (verified strictly) |
| --- | --- | --- |
| **staging** (default) | every other case: local builds, `npm run build:hub-standalone`, any preview, a release build that is not a production deployment | 4 files: hub HTML, one JS bundle, the logo WebP, the favicon. `noindex, nofollow` meta, title `MSM Festival Hub (Staging)`, no canonical, staging banner, demo available via `?demo=1`. |
| **launch** | `HUB_RELEASE=1` **and** `VERCEL_ENV=production` (i.e. `npm run build:hub-release` on a production deployment), or the explicit override `HUB_LAUNCH=1` | 6 files: the 4 above plus `robots.txt` and `sitemap.xml` with exact approved content. `index, follow` meta, exactly one canonical `https://festivals.musicscenemagazine.co.uk/`, matching `og:url`, launch title and description, no staging text, no staging banner, **no demo** (the demo fixtures, links, notice and `?demo=1` handling are compiled out; the verifier fails the build if any demo or staging marker is in the JS). |

`VITE_HUB_LAUNCH` is injected by the Vite config (`define`), so the mode can't
be switched at runtime. The "(live site)" labels on festival links are unchanged.

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
| `release/festival-hub` | **release** template (`npm run build:hub-release`) | the candidate for the new project's **production branch**. In any preview it builds **staging**. Only a production deployment builds **launch**. |
| `release/festival-hub-launch-check` | release template, build command `HUB_LAUNCH=1 npm run build:hub-release` | review only: a **preview** that forces the launch build so the public page, robots.txt and sitemap.xml can be checked before production. Its `*.vercel.app` URL still sends `noindex`. Never a production branch. |

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

## Steps for the project owner (held – not done)

1. **Never import `main`** into `msm-festival-hub` and never trigger a production
   deployment of it (it would be the calendar, with no Supabase env, and would
   fail). Keep Git **unconnected** until the controlled strategy is chosen.
2. Choose the strategy. For example: set the project's production branch to
   `release/festival-hub` *before* (or as) Git is connected, so `main` never
   builds there. Confirm in the project settings that
   framework = Other, no environment variables are set, and the build uses the
   repo's `vercel.json`.
3. Review the launch-check preview, and a staging preview of `release/festival-hub`.
4. Production deployment of `release/festival-hub` (launch build). Check its
   `*.vercel.app` URL: launch page, `robots.txt`, `sitemap.xml`, and `X-Robots-Tag: noindex`.
5. The domain is already associated (Production, no environment binding).
   Create the Cloudflare record Vercel shows for that project, **CNAME**
   `festivals` → `666124bca49cbb84.vercel-dns-017.com`, DNS only (proxy off).
   Do not use any generic target. Once it resolves, check that the domain
   sends **no** `X-Robots-Tag`, and that `/robots.txt` and `/sitemap.xml` are served.
6. Optionally submit the sitemap in Search Console.

## Rollback

- Bad build: Vercel *Instant Rollback* / promote the previous production deployment.
- Stop indexing quickly: remove the domain from the project, or redeploy with
  the standalone template (noindex on every host).
- Code: revert on `release/festival-hub` (cherry-pick a revert; no merges, no
  force-push), which redeploys production.
- The calendar is independent and is not affected by any of these steps.
