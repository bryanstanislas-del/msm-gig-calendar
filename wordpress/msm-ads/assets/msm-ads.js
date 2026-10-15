/*!
 * MSM Ads - homepage adapter (phase 1) v0.1.0
 *
 * JS mode: for each configured container (#msm-wp-home-top etc.) asks the
 * same-origin WordPress REST proxy for an approved advert and, only if a
 * valid one exists, swaps the existing house advert for it. Any failure
 * leaves the house advert untouched. Built with DOM APIs only (no
 * innerHTML), every URL must point at the configured MSM ads API.
 *
 * Viewable impression: >= 50% of the advert's pixels in the viewport for
 * >= 1 continuous second while the page is visible; sent at most once per
 * advert per page view via navigator.sendBeacon (text/plain, no cookies).
 */
(function () {
  "use strict";
  var cfg = window.MSM_ADS_CONFIG;
  if (!cfg || typeof cfg.apiBase !== "string" || cfg.apiBase.indexOf("https://") !== 0) return;
  var API = cfg.apiBase.replace(/\/+$/, "");
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

  function starts(s, p) { return typeof s === "string" && s.slice(0, p.length) === p; }
  function dim(n) { n = Number(n); return n >= 1 && n <= 4000 ? Math.floor(n) : 0; }

  function valid(ad) {
    if (!ad || !UUID.test(ad.creative_id) || !TOKEN.test(ad.impression_token || "") || String(ad.impression_token).length > 400) return false;
    if (!starts(ad.click_url, API + "/api/ads/click?t=") || ad.impression_url !== API + "/api/ads/impression") return false;
    if (!ad.desktop || !ad.mobile || !starts(ad.desktop.url, API + "/api/ads/creative?") || !starts(ad.mobile.url, API + "/api/ads/creative?")) return false;
    if (!dim(ad.desktop.width) || !dim(ad.desktop.height) || !dim(ad.mobile.width) || !dim(ad.mobile.height)) return false;
    var until = Date.parse(ad.serve_until);
    return !isNaN(until) && until > Date.now() && typeof ad.alt === "string" && ad.alt.length > 0;
  }

  function sendImpression(url, token) {
    var body = JSON.stringify({ t: token });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }))) return;
    } catch (e) { /* fall through */ }
    try { fetch(url, { method: "POST", body: body, mode: "no-cors", credentials: "omit", keepalive: true }); } catch (e) { /* ignore */ }
  }

  function watchViewability(el, url, token) {
    if (!("IntersectionObserver" in window) || el.getAttribute("data-msm-ad-watched")) return;
    el.setAttribute("data-msm-ad-watched", "1");
    var timer = null, done = false, visible = false;
    function stop() { if (timer) { clearTimeout(timer); timer = null; } }
    function maybeStart() {
      if (done || timer || !visible || document.visibilityState !== "visible") return;
      timer = setTimeout(function () {
        if (done) return;
        done = true;
        io.disconnect();
        sendImpression(url, token);
      }, 1000);
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        visible = e.isIntersecting && e.intersectionRatio >= 0.5;
        if (visible) maybeStart(); else stop();
      });
    }, { threshold: [0, 0.5, 1] });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") maybeStart(); else stop();
    });
    io.observe(el);
  }

  function build(ad, placement) {
    var wrap = document.createElement("div");
    wrap.className = "msm-ad";
    wrap.setAttribute("data-msm-ad-placement", placement);
    var label = document.createElement("span");
    label.className = "msm-ad__label";
    label.textContent = "Advertisement";
    var a = document.createElement("a");
    a.className = "msm-ad__link";
    a.href = ad.click_url;
    a.target = "_blank";
    a.rel = "sponsored noopener";
    var pic = document.createElement("picture");
    var src = document.createElement("source");
    src.media = "(max-width: 600px)";
    src.srcset = ad.mobile.url;
    src.width = dim(ad.mobile.width);
    src.height = dim(ad.mobile.height);
    var img = document.createElement("img");
    img.src = ad.desktop.url;
    img.alt = ad.alt;
    img.width = dim(ad.desktop.width);
    img.height = dim(ad.desktop.height);
    img.decoding = "async";
    pic.appendChild(src);
    pic.appendChild(img);
    a.appendChild(pic);
    wrap.appendChild(label);
    wrap.appendChild(a);
    return { el: wrap, img: img };
  }

  function fill(placement, containerId) {
    var container = document.getElementById(containerId);
    if (!container || !window.fetch) return;
    var url = cfg.restUrl + (cfg.restUrl.indexOf("?") >= 0 ? "&" : "?") + "placement=" + encodeURIComponent(placement);
    var ctrl = "AbortController" in window ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, 3000);
    fetch(url, { credentials: "same-origin", signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        clearTimeout(t);
        if (!data || data.placement !== placement || !Array.isArray(data.ads)) return;
        var ads = data.ads.filter(valid);
        if (!ads.length) return; // keep the house advert
        var ad = ads[Math.floor(Math.random() * ads.length)];
        var built = build(ad, placement);
        var house = document.createDocumentFragment();
        built.img.addEventListener("error", function () {
          // Artwork failed: restore the house advert.
          if (built.el.parentNode === container) {
            container.removeChild(built.el);
            container.appendChild(house);
          }
        });
        while (container.firstChild) house.appendChild(container.firstChild);
        container.appendChild(built.el);
        watchViewability(built.el, ad.impression_url, ad.impression_token);
      })
      .catch(function () { clearTimeout(t); });
  }

  function init() {
    var map = cfg.containers || {};
    Object.keys(map).forEach(function (placement) { fill(placement, map[placement]); });
    // Server mode: adverts already rendered by PHP still need viewability tracking.
    var pre = document.querySelectorAll(".msm-ad[data-msm-ad-token]");
    for (var i = 0; i < pre.length; i++) {
      var imp = pre[i].getAttribute("data-msm-ad-impression");
      var tok = pre[i].getAttribute("data-msm-ad-token");
      if (imp === API + "/api/ads/impression" && TOKEN.test(tok || "")) watchViewability(pre[i], imp, tok);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
