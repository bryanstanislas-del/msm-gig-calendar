<?php
// Standalone tests for the MSM Ads WordPress adapter. WordPress functions
// are STUBBED below (local fixtures only); this never touches a real site.
// Run: php wordpress/msm-ads/tests/run-tests.php

define('ABSPATH', __DIR__);
define('MSM_ADS_ENABLED', true);
define('MSM_ADS_API_BASE', 'https://calendar.example.test');

// ── Minimal WordPress stubs ────────────────────────────────────────────
$GLOBALS['filters'] = array();
$GLOBALS['transients'] = array();
$GLOBALS['http_calls'] = 0;
$GLOBALS['http_response'] = null;

class WP_Error {}
class WP_REST_Response { public $data; public $status; public $headers = array();
    function __construct($d, $s) { $this->data = $d; $this->status = $s; }
    function header($k, $v) { $this->headers[$k] = $v; } }
function add_filter($tag, $fn, $prio = 10, $args = 1) { $GLOBALS['filters'][$tag][] = $fn; }
function add_action($tag, $fn) {}
function apply_filters($tag, $value) {
    $args = func_get_args();
    foreach ($GLOBALS['filters'][$tag] ?? array() as $fn) { $args[1] = $value; $value = call_user_func_array($fn, array_slice($args, 1)); }
    return $value;
}
function esc_attr($s) { return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8'); }
function esc_html__($s, $d) { return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8'); }
function esc_url($s) { return preg_match('#^https?://#i', (string) $s) ? htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8') : ''; }
function esc_url_raw($s) { return $s; }
function get_transient($k) { return $GLOBALS['transients'][$k] ?? false; }
function set_transient($k, $v, $ttl) { $GLOBALS['transients'][$k] = $v; return true; }
function wp_remote_get($url, $args) {
    $GLOBALS['http_calls']++;
    $GLOBALS['last_http'] = array($url, $args);
    return $GLOBALS['http_response'];
}
function is_wp_error($x) { return $x instanceof WP_Error; }
function wp_remote_retrieve_response_code($r) { return $r['code']; }
function wp_remote_retrieve_body($r) { return $r['body']; }

require __DIR__ . '/../msm-ads.php';

// ── Tiny assertion helper ──────────────────────────────────────────────
$failures = 0; $count = 0;
function check($cond, $label) { global $failures, $count; $count++; if (!$cond) { $failures++; echo "FAIL: $label\n"; } }
function reset_state($response) { $GLOBALS['transients'] = array(); $GLOBALS['http_calls'] = 0; $GLOBALS['http_response'] = $response; }
function api_response($ads, $placement = 'wordpress-home-top', $code = 200) {
    return array('code' => $code, 'body' => json_encode(array('placement' => $placement, 'label' => 'Advertisement', 'ads' => $ads)));
}
function good_ad($over = array()) {
    $base = 'https://calendar.example.test';
    return array_merge(array(
        'creative_id' => '11111111-2222-4333-8444-555555555555',
        'alt' => 'Band "tour" <script>alert(1)</script>',
        'desktop' => array('url' => "$base/api/ads/creative?v=11111111-2222-4333-8444-555555555555&p=wordpress-home-top&s=desktop", 'width' => 1200, 'height' => 250),
        'mobile' => array('url' => "$base/api/ads/creative?v=11111111-2222-4333-8444-555555555555&p=wordpress-home-top&s=mobile", 'width' => 600, 'height' => 250),
        'click_url' => "$base/api/ads/click?t=abc.def",
        'impression_url' => "$base/api/ads/impression",
        'impression_token' => 'abc.def',
        'serve_until' => gmdate('c', time() + 3600),
    ), $over);
}

// 1. Valid ad renders escaped markup with sponsored link and both artworks.
reset_state(api_response(array(good_ad())));
$html = msm_ads_home_slot('top');
check(strpos($html, '<script>') === false, 'alt text escaped');
check(strpos($html, 'alt="Band &quot;tour&quot; &lt;script&gt;') !== false, 'alt attribute escaped');
check(strpos($html, 'href="https://calendar.example.test/api/ads/click?t=abc.def"') !== false, 'click goes via MSM redirect');
check(strpos($html, 'rel="sponsored noopener"') !== false, 'sponsored rel');
check(strpos($html, 'media="(max-width: 600px)"') !== false && strpos($html, 's=mobile') !== false, 'responsive mobile artwork');
check(strpos($html, '>Advertisement<') !== false, 'disclosure label');
check($GLOBALS['last_http'][1]['timeout'] === 2 && $GLOBALS['last_http'][1]['redirection'] === 0, 'short timeout, no redirects');

// 2. Cached: second call does not hit the network.
msm_ads_home_slot('top');
check($GLOBALS['http_calls'] === 1, 'transient cache used');

// 3. Ads pointing anywhere other than the MSM API are dropped -> house fallback.
foreach (array(
    array('click_url' => 'https://evil.example/click?t=abc.def'),
    array('click_url' => 'javascript:alert(1)'),
    array('impression_url' => 'https://evil.example/api/ads/impression'),
    array('desktop' => array('url' => 'https://evil.example/x.png', 'width' => 1200, 'height' => 250)),
    array('creative_id' => '../../etc'),
    array('impression_token' => 'a"b'),
    array('serve_until' => gmdate('c', time() - 1)),
    array('alt' => ''),
    array('desktop' => array('url' => 'https://calendar.example.test/api/ads/creative?x', 'width' => 0, 'height' => 250)),
) as $i => $over) {
    reset_state(api_response(array(good_ad($over))));
    check(msm_ads_home_slot('top') === '', "invalid ad #$i falls back to house");
}

// 4. Failures/timeouts/non-200/wrong placement -> '' (house) and negative cache.
foreach (array(new WP_Error(), array('code' => 500, 'body' => '{}'), array('code' => 200, 'body' => 'not json'),
               api_response(array(good_ad()), 'wordpress-home-middle')) as $i => $resp) {
    reset_state($resp);
    check(msm_ads_home_slot('top') === '', "failure #$i -> house fallback");
    msm_ads_home_slot('top');
    check($GLOBALS['http_calls'] === 1, "failure #$i negatively cached");
}

// 5. Empty list -> house fallback; unknown position -> ''.
reset_state(api_response(array()));
check(msm_ads_home_slot('top') === '', 'no booking -> house fallback');
check(msm_ads_home_slot('sidebar') === '', 'unknown position');
check(msm_ads_fetch('wordpress-home-top/../x') === array(), 'unknown placement never fetched');

// 6. Filter contract: false (hide) and an earlier decision are preserved.
reset_state(api_response(array(good_ad())));
check(msm_ads_home_delivery_filter(false, array('placement' => 'wordpress-home-top')) === false, 'false preserved (hide)');
check(msm_ads_home_delivery_filter('<b>x</b>', array('placement' => 'wordpress-home-top')) === '<b>x</b>', 'earlier decision preserved');
check($GLOBALS['http_calls'] === 0, 'no fetch when decided upstream');

// 7. Article contract helper (not hooked in phase 1).
check(msm_ads_article_placement(array('format' => 'review', 'position' => 'top')) === 'wordpress-article-review-top', 'article placement');
check(msm_ads_article_placement(array('format' => 'start-a-band', 'position' => 'mid-1', 'series_id' => 'start-a-band')) === 'wordpress-article-start-a-band-mid-1', 'series placement');
check(msm_ads_article_placement(array('format' => 'gig', 'position' => 'top')) === null, 'unknown format rejected');
check(msm_ads_article_placement(array('format' => 'review', 'position' => '<x>')) === null, 'bad position rejected');
check(!isset($GLOBALS['filters']['msm_article_ad_delivery']), 'article filter not hooked (theme behaviour unchanged)');

// 8. Expired cached ads are never shown even before the cache expires.
reset_state(api_response(array(good_ad(array('serve_until' => gmdate('c', time() + 2))))));
check(msm_ads_home_slot('top') !== '', 'served before end');
foreach ($GLOBALS['transients'] as $k => $v) { $v[0]['serve_until'] = time() - 1; $GLOBALS['transients'][$k] = $v; }
check(msm_ads_home_slot('top') === '', 'cached ad hidden after end instant');

echo $failures ? "$failures of $count checks FAILED\n" : "msm-ads WordPress adapter: all $count checks passed\n";
exit($failures ? 1 : 0);
