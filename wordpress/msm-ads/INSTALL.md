# MSM Ads — WordPress homepage adapter v0.2.0

**Not installed anywhere.** Install on a staging WordPress first. The plugin holds no secrets and makes no payments.

## What it does

- Fills the existing homepage containers `#msm-wp-home-top` (sold in phase 1), `#msm-wp-home-middle` and `#msm-wp-home-bottom` (mapped, not sold) with an **approved, paid, in-date** advert from the MSM ads API.
- Whenever there is no advert, or the API is off, slow (2 s timeout), erroring or returns anything invalid, nothing changes and **the existing house advert stays**.
- Every URL in a response must start with the configured API base (`/api/ads/creative?`, `/api/ads/click?t=`, `/api/ads/impression`). Anything else is dropped. Output is escaped (`esc_url`, `esc_attr`, `esc_html`). The JS builds DOM nodes without `innerHTML`.
- Desktop and mobile artwork via `<picture>` (mobile ≤600 px), an "Advertisement" label, and `rel="sponsored noopener"`.
- Successful responses are cached in a transient for 60 s, and failures are negatively cached for 60 s. Adverts are hidden after their booked end even while cached.
- Viewable impressions: ≥50% visible for ≥1 s in a visible tab, sent once per page view by `navigator.sendBeacon` (no cookies).

## Install (staging)

1. Copy `wordpress/msm-ads/` to `wp-content/plugins/msm-ads/`.
2. In `wp-config.php`:
   ```php
   define('MSM_ADS_ENABLED', true);                                  // default: off
   define('MSM_ADS_API_BASE', 'https://calendar.musicscenemagazine.co.uk'); // https only
   define('MSM_ADS_MODE', 'js');                                      // 'js' (no theme edits) or 'server'
   ```
3. Activate **MSM Ads - homepage adapter (phase 1)**.

**JS mode (default, no theme changes):** on the front page the script asks the same-origin route `/wp-json/msm-ads/v1/slot?placement=…` (a server-side proxy with cache and validation) and swaps the house advert only if a valid advert exists. If the artwork fails to load, the house advert is restored.

**Server mode (optional theme edit):** render the house advert into a buffer and let the plugin decide. The house markup is kept in a `<template>` so the script can restore it at expiry, on revocation or if the image fails:

```php
<div id="msm-wp-home-top">
  <?php ob_start(); ?>
    <!-- existing house advert markup, unchanged -->
  <?php $msm_house = ob_get_clean(); ?>
  <?php echo function_exists('msm_ads_home_slot_with_fallback') ? msm_ads_home_slot_with_fallback('top', $msm_house) : $msm_house; ?>
</div>
```

It applies the filter `msm_home_ad_delivery` with `['placement' => 'wordpress-home-top', 'position' => 'top']` and mirrors the article contract: `false` hides the slot, `''` keeps the house advert, any other string is advert HTML (an earlier filter's decision is never overridden). `msm_ads_home_slot($position)` (advert HTML or `''`) still exists, but it gives the script nothing to restore, so at expiry the slot would just empty.

**Lifecycle (both modes, needs JS):** every advert is removed at its exact booked end (and immediately when a backgrounded or suspended tab resumes). Eligibility is re-checked through the WordPress proxy at most every 2 minutes while the tab is visible, so pause, refund, kill switch and rejected replacements take effect. Image failure restores the house advert. Impressions count only after the real image has loaded and ≥50% of it has been visible for ≥1 continuous second, re-verified at that boundary. See "Removal latency" in `docs/ads/README.md`.

**Page caching:** visitors without JavaScript keep whatever the cached HTML contains until the page cache expires. Keep the homepage page-cache TTL ≤ 5 minutes in server mode, and do not let a CDN cache `/wp-json/msm-ads/v1/slot` beyond 60 s.

## Article contract (unchanged)

The theme's `apply_filters('msm_article_ad_delivery', '', $context)` with `{post_id, format, position, series_id, placement}` (placement `wordpress-article-[format]-[position]`) is **not hooked** in phase 1, so article behaviour is exactly as today. `msm_ads_article_placement($context)` documents and tests the canonical placement codes for the later series extension.

## Tests

`php wordpress/msm-ads/tests/run-tests.php` (stubbed WordPress functions) and `npx vitest run wordpress` (JS in a Node vm with a stubbed DOM). Neither touches a real site.

## Uninstall / rollback

Set `MSM_ADS_ENABLED` to false, or deactivate the plugin. House adverts render exactly as before. Transients are named `msm_ads_*` and expire within 60 s.
