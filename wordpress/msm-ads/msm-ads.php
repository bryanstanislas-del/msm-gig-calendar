<?php
/**
 * Plugin Name: MSM Ads - homepage adapter (phase 1)
 * Description: Shows APPROVED, paid adverts from the MSM advertising platform in the existing homepage positions, falling back to the existing house adverts. Disabled until MSM_ADS_ENABLED is true.
 * Version: 0.1.0
 * Requires PHP: 7.4
 * Author: Music Scene Magazine
 *
 * NOT INSTALLED ANYWHERE. See INSTALL.md. Holds no secrets: it only calls
 * the public delivery endpoint and renders escaped markup. If anything is
 * off, slow, invalid or empty, nothing is changed and the theme's existing
 * house advert stays in place.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('MSM_ADS_VERSION', '0.1.0');

/** Positions that exist on the homepage (only "top" is sold in phase 1). */
function msm_ads_home_placements()
{
    return array(
        'top'    => array('placement' => 'wordpress-home-top',    'container' => 'msm-wp-home-top'),
        'middle' => array('placement' => 'wordpress-home-middle', 'container' => 'msm-wp-home-middle'),
        'bottom' => array('placement' => 'wordpress-home-bottom', 'container' => 'msm-wp-home-bottom'),
    );
}

function msm_ads_config()
{
    $base = defined('MSM_ADS_API_BASE') ? (string) MSM_ADS_API_BASE : 'https://calendar.musicscenemagazine.co.uk';
    $base = rtrim($base, '/');
    $mode = defined('MSM_ADS_MODE') && in_array(MSM_ADS_MODE, array('js', 'server'), true) ? MSM_ADS_MODE : 'js';
    return array(
        'enabled'   => defined('MSM_ADS_ENABLED') && MSM_ADS_ENABLED === true && strpos($base, 'https://') === 0,
        'api_base'  => $base,
        'mode'      => $mode,
        'timeout'   => 2,   // seconds; homepage must never wait longer for an advert
        'cache_ttl' => 60,  // seconds; successful delivery responses
        'fail_ttl'  => 60,  // seconds; negative cache so an outage is not hammered
    );
}

function msm_ads_starts_with($haystack, $needle)
{
    return is_string($haystack) && substr($haystack, 0, strlen($needle)) === $needle;
}

function msm_ads_is_known_placement($placement)
{
    foreach (msm_ads_home_placements() as $p) {
        if ($p['placement'] === $placement) {
            return true;
        }
    }
    return false;
}

/**
 * Article contract (preserved, not used for delivery in phase 1):
 * apply_filters('msm_article_ad_delivery', '', $context) with
 * {post_id, format, position, series_id, placement}; placement is
 * wordpress-article-[format]-[position]. Returns the canonical placement
 * code or null. This plugin does NOT hook msm_article_ad_delivery, so the
 * theme's existing behaviour (false hides, '' = house fallback) is unchanged.
 */
function msm_ads_article_placement($context)
{
    if (!is_array($context)) {
        return null;
    }
    $format = isset($context['format']) ? (string) $context['format'] : '';
    $position = isset($context['position']) ? (string) $context['position'] : '';
    if (!in_array($format, array('review', 'interview', 'start-a-band'), true)) {
        return null;
    }
    if (!preg_match('/^[a-z0-9]+(-[a-z0-9]+)*$/', $position)) {
        return null;
    }
    return 'wordpress-article-' . $format . '-' . $position;
}

/** Validates one ad from the delivery API. Returns a normalised array or null. */
function msm_ads_validate_ad($ad, $placement, $api_base, $now = null)
{
    $now = $now === null ? time() : $now;
    if (!is_array($ad)) {
        return null;
    }
    $id = isset($ad['creative_id']) ? (string) $ad['creative_id'] : '';
    if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $id)) {
        return null;
    }
    $token = isset($ad['impression_token']) ? (string) $ad['impression_token'] : '';
    if (strlen($token) > 400 || !preg_match('/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/', $token)) {
        return null;
    }
    $click = isset($ad['click_url']) ? (string) $ad['click_url'] : '';
    $imp = isset($ad['impression_url']) ? (string) $ad['impression_url'] : '';
    // Every URL must point back at the MSM ads API itself -- never at an
    // arbitrary host supplied in the response.
    if (!msm_ads_starts_with($click, $api_base . '/api/ads/click?t=') || $imp !== $api_base . '/api/ads/impression') {
        return null;
    }
    $sides = array();
    foreach (array('desktop', 'mobile') as $side) {
        $s = isset($ad[$side]) && is_array($ad[$side]) ? $ad[$side] : array();
        $url = isset($s['url']) ? (string) $s['url'] : '';
        $w = isset($s['width']) ? (int) $s['width'] : 0;
        $h = isset($s['height']) ? (int) $s['height'] : 0;
        if (!msm_ads_starts_with($url, $api_base . '/api/ads/creative?') || $w < 1 || $w > 4000 || $h < 1 || $h > 4000) {
            return null;
        }
        $sides[$side] = array('url' => $url, 'width' => $w, 'height' => $h);
    }
    $until = isset($ad['serve_until']) ? strtotime((string) $ad['serve_until']) : false;
    if ($until === false || $until <= $now) {
        return null; // never show an advert after its booked end
    }
    $alt = isset($ad['alt']) ? trim((string) $ad['alt']) : '';
    if ($alt === '' || strlen($alt) > 1000) {
        return null;
    }
    return array(
        'creative_id' => $id, 'placement' => $placement, 'alt' => $alt, 'click_url' => $click,
        'impression_url' => $imp, 'impression_token' => $token, 'serve_until' => $until,
        'desktop' => $sides['desktop'], 'mobile' => $sides['mobile'],
    );
}

/** Fetches (with short timeout + transient cache) the valid ads for a placement. */
function msm_ads_fetch($placement)
{
    $cfg = msm_ads_config();
    if (!$cfg['enabled'] || !msm_ads_is_known_placement($placement)) {
        return array();
    }
    $key = 'msm_ads_' . md5($cfg['api_base'] . '|' . $placement);
    $cached = get_transient($key);
    if (!is_array($cached)) {
        $response = wp_remote_get($cfg['api_base'] . '/api/ads/delivery?placement=' . rawurlencode($placement), array(
            'timeout'     => $cfg['timeout'],
            'redirection' => 0,
            'headers'     => array('Accept' => 'application/json'),
            'user-agent'  => 'MSM-WP-Ads/' . MSM_ADS_VERSION,
        ));
        $cached = array();
        $ttl = $cfg['fail_ttl'];
        if (!is_wp_error($response) && (int) wp_remote_retrieve_response_code($response) === 200) {
            $data = json_decode((string) wp_remote_retrieve_body($response), true);
            if (is_array($data) && isset($data['ads']) && is_array($data['ads']) && ($data['placement'] ?? '') === $placement) {
                foreach (array_slice($data['ads'], 0, 20) as $ad) {
                    $valid = msm_ads_validate_ad($ad, $placement, $cfg['api_base']);
                    if ($valid) {
                        $cached[] = $valid;
                    }
                }
                $ttl = $cfg['cache_ttl'];
            }
        }
        set_transient($key, $cached, $ttl);
    }
    $now = time();
    return array_values(array_filter($cached, function ($ad) use ($now) {
        return is_array($ad) && isset($ad['serve_until']) && $ad['serve_until'] > $now;
    }));
}

/** Escaped markup for one ad. All values are escaped at output. */
function msm_ads_render($ad)
{
    $d = $ad['desktop'];
    $m = $ad['mobile'];
    return '<div class="msm-ad" data-msm-ad-placement="' . esc_attr($ad['placement']) . '"'
        . ' data-msm-ad-token="' . esc_attr($ad['impression_token']) . '"'
        . ' data-msm-ad-impression="' . esc_url($ad['impression_url']) . '">'
        . '<span class="msm-ad__label">' . esc_html__('Advertisement', 'msm-ads') . '</span>'
        . '<a class="msm-ad__link" href="' . esc_url($ad['click_url']) . '" target="_blank" rel="sponsored noopener">'
        . '<picture>'
        . '<source media="(max-width: 600px)" srcset="' . esc_url($m['url']) . '" width="' . (int) $m['width'] . '" height="' . (int) $m['height'] . '">'
        . '<img src="' . esc_url($d['url']) . '" alt="' . esc_attr($ad['alt']) . '" width="' . (int) $d['width'] . '" height="' . (int) $d['height'] . '" loading="lazy" decoding="async">'
        . '</picture></a></div>';
}

/**
 * Theme helper (server mode). Returns '' when the house advert should stay.
 * Usage in the homepage template:
 *   $ad = function_exists('msm_ads_home_slot') ? msm_ads_home_slot('top') : '';
 *   if ($ad !== '') { echo $ad; } else { ...existing house advert... }
 */
function msm_ads_home_slot($position)
{
    $map = msm_ads_home_placements();
    if (!isset($map[$position])) {
        return '';
    }
    $html = apply_filters('msm_home_ad_delivery', '', array('placement' => $map[$position]['placement'], 'position' => $position));
    return is_string($html) ? $html : '';
}

/**
 * msm_home_ad_delivery filter, mirroring msm_article_ad_delivery semantics:
 * false = hide the slot, '' = house fallback, other string = advert HTML.
 * A value already decided by an earlier filter is never overridden.
 */
function msm_ads_home_delivery_filter($html, $context)
{
    if ($html === false || (is_string($html) && $html !== '')) {
        return $html;
    }
    $placement = is_array($context) && isset($context['placement']) ? (string) $context['placement'] : '';
    $ads = msm_ads_fetch($placement);
    if (!$ads) {
        return '';
    }
    $ad = $ads[count($ads) > 1 ? mt_rand(0, count($ads) - 1) : 0];
    return msm_ads_render($ad);
}
add_filter('msm_home_ad_delivery', 'msm_ads_home_delivery_filter', 10, 2);

/** Same-origin REST proxy used by the JS mode (keeps cache + validation server-side). */
function msm_ads_rest_slot($request)
{
    $placement = (string) $request->get_param('placement');
    $ads = msm_ads_is_known_placement($placement) ? msm_ads_fetch($placement) : array();
    $out = array();
    foreach ($ads as $ad) {
        $ad['serve_until'] = gmdate('c', $ad['serve_until']);
        $out[] = $ad;
    }
    $response = new WP_REST_Response(array('placement' => $placement, 'ads' => $out), 200);
    $response->header('Cache-Control', 'public, max-age=60');
    return $response;
}

add_action('rest_api_init', function () {
    register_rest_route('msm-ads/v1', '/slot', array(
        'methods'             => 'GET',
        'callback'            => 'msm_ads_rest_slot',
        'permission_callback' => '__return_true',
        'args'                => array('placement' => array('required' => true, 'type' => 'string')),
    ));
});

add_action('wp_enqueue_scripts', function () {
    $cfg = msm_ads_config();
    if (!$cfg['enabled'] || !is_front_page()) {
        return;
    }
    $url = plugins_url('assets/', __FILE__);
    wp_enqueue_style('msm-ads', $url . 'msm-ads.css', array(), MSM_ADS_VERSION);
    wp_enqueue_script('msm-ads', $url . 'msm-ads.js', array(), MSM_ADS_VERSION, true);
    $containers = array();
    if ($cfg['mode'] === 'js') {
        foreach (msm_ads_home_placements() as $p) {
            $containers[$p['placement']] = $p['container'];
        }
    }
    wp_localize_script('msm-ads', 'MSM_ADS_CONFIG', array(
        'restUrl'    => esc_url_raw(rest_url('msm-ads/v1/slot')),
        'apiBase'    => $cfg['api_base'],
        'containers' => $containers,
    ));
});
