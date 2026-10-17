/*!
 * MSM Ads - homepage adapter (phase 1) v0.2.1
 *
 * Every advert on the page (JS mode: swapped in by this script; server
 * mode: rendered by PHP) is managed by a Slot controller that:
 *   - hides the advert and restores the house advert at serve_until (hard
 *     expiry), re-checked whenever a backgrounded/suspended tab resumes
 *     (visibilitychange, pageshow), since timers may not fire while suspended;
 *   - re-asks the same-origin WordPress proxy at most every REFRESH_MS while
 *     the tab is visible (and on resume if the last check is stale), and
 *     removes the advert if it is no longer eligible (paused, refunded,
 *     kill switch, rejected replacement...);
 *   - counts a viewable impression only after the REAL creative image has
 *     loaded successfully and >= 50% of it has been visible for >= 1
 *     continuous second in a visible tab -- re-verified at the 1 s boundary
 *     (still live, not expired/revoked, image OK, still visible);
 *   - on image error, expiry, revocation or replacement restores the house
 *     advert and clears every timer, observer and listener it owns.
 * Any failure keeps or restores the house advert. DOM is built without
 * innerHTML; every URL must point at the configured MSM ads API.
 */
(function () {
  "use strict";
  var cfg = window.MSM_ADS_CONFIG;
  if (!cfg || typeof cfg.apiBase !== "string" || cfg.apiBase.indexOf("https://") !== 0) return;
  var API = cfg.apiBase.replace(/\/+$/, "");
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
  var VIEW_MS = 1000;            // continuous viewable time for an impression
  var REFRESH_MS = 120000;       // eligibility re-check while visible
  var RESUME_STALE_MS = 30000;   // on resume, re-check if last check older than this
  var FETCH_TIMEOUT_MS = 3000;
  var MAX_TIMER_MS = 6 * 3600 * 1000; // re-arm long expiry timers in chunks

  var slots = [];

  function starts(s, p) { return typeof s === "string" && s.slice(0, p.length) === p; }
  function dim(n) { n = Number(n); return n >= 1 && n <= 4000 ? Math.floor(n) : 0; }
  function now() { return Date.now(); }
  function pageVisible() { return document.visibilityState !== "hidden"; }

  function valid(ad) {
    if (!ad || !UUID.test(ad.creative_id) || !TOKEN.test(ad.impression_token || "") || String(ad.impression_token).length > 400) return false;
    if (!starts(ad.click_url, API + "/api/ads/click?t=") || ad.impression_url !== API + "/api/ads/impression") return false;
    if (!ad.desktop || !ad.mobile || !starts(ad.desktop.url, API + "/api/ads/creative?") || !starts(ad.mobile.url, API + "/api/ads/creative?")) return false;
    if (!dim(ad.desktop.width) || !dim(ad.desktop.height) || !dim(ad.mobile.width) || !dim(ad.mobile.height)) return false;
    var until = Date.parse(ad.serve_until);
    return !isNaN(until) && until > now() && typeof ad.alt === "string" && ad.alt.length > 0;
  }

  function slotUrl(placement) {
    return cfg.restUrl + (cfg.restUrl.indexOf("?") >= 0 ? "&" : "?") + "placement=" + encodeURIComponent(placement);
  }

  /** GET the proxy; resolves to {placement, ads} or null on any failure. */
  function fetchSlot(placement) {
    if (!window.fetch || typeof cfg.restUrl !== "string") return Promise.resolve(null);
    var ctrl = "AbortController" in window ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, FETCH_TIMEOUT_MS);
    return fetch(slotUrl(placement), { credentials: "same-origin", cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        clearTimeout(t);
        return data && data.placement === placement && Array.isArray(data.ads) ? data : null;
      }, function () { clearTimeout(t); return null; });
  }

  function sendImpression(url, token) {
    var body = JSON.stringify({ t: token });
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }))) return;
    } catch (e) { /* fall through */ }
    try { fetch(url, { method: "POST", body: body, mode: "no-cors", credentials: "omit", keepalive: true }); } catch (e) { /* ignore */ }
  }

  function imageOk(img) { return !!img && img.complete === true && img.naturalWidth > 0; }

  // ── Slot controller ────────────────────────────────────────────────
  function Slot(o) {
    this.el = o.el;
    this.img = o.img;
    this.placement = o.placement;
    this.creativeId = o.creativeId;
    this.serveUntil = o.serveUntil;
    this.impressionUrl = o.impressionUrl;
    this.token = o.token;
    this.restoreFn = o.restore;
    this.active = true;
    this.loaded = false;
    this.counted = false;
    this.inView = false;
    this.viewSince = null;
    this.timers = { expiry: null, refresh: null, view: null };
    this.io = null;
    this.lastCheck = now();
    this.onLoad = this.handleLoad.bind(this);
    this.onError = this.end.bind(this, "image_error");
  }

  Slot.prototype.start = function () {
    slots.push(this);
    if (!this.checkExpiry()) return;
    this.armExpiry();
    this.armRefresh();
    if (!this.img) { this.end("image_error"); return; }
    // Always listen for the whole slot lifetime: a cached/PHP-rendered image
    // that already loaded can still fail later (e.g. the responsive <source>
    // switches after a viewport change), even after an impression counted.
    this.img.addEventListener("load", this.onLoad);
    this.img.addEventListener("error", this.onError);
    if (this.img.complete === true) {
      // Cached image (or PHP-rendered and already decoded/failed).
      if (imageOk(this.img)) this.handleLoad(); else this.end("image_error");
    }
  };

  Slot.prototype.clear = function (name) {
    if (this.timers[name]) { clearTimeout(this.timers[name]); this.timers[name] = null; }
  };

  /** Returns false (and ends the slot) once serve_until has passed. */
  Slot.prototype.checkExpiry = function () {
    if (!this.active) return false;
    if (now() >= this.serveUntil) { this.end("expired"); return false; }
    return true;
  };

  Slot.prototype.armExpiry = function () {
    var self = this;
    this.clear("expiry");
    if (!this.checkExpiry()) return;
    this.timers.expiry = setTimeout(function () { self.timers.expiry = null; self.armExpiry(); },
      Math.min(Math.max(0, this.serveUntil - now()), MAX_TIMER_MS));
  };

  Slot.prototype.armRefresh = function () {
    var self = this;
    this.clear("refresh");
    if (!this.active) return;
    this.timers.refresh = setTimeout(function () {
      self.timers.refresh = null;
      if (pageVisible()) self.refresh(); else self.armRefresh(); // hidden: re-checked on resume
    }, REFRESH_MS);
  };

  Slot.prototype.refresh = function () {
    var self = this;
    if (!this.active) return;
    this.lastCheck = now();
    fetchSlot(this.placement).then(function (data) {
      if (!self.active) return;
      if (data) {
        var still = data.ads.filter(valid).filter(function (a) { return a.creative_id === self.creativeId; })[0];
        if (!still) { self.end("revoked"); return; }
        var until = Date.parse(still.serve_until);
        if (until < self.serveUntil) { self.serveUntil = until; self.armExpiry(); }
      }
      // Network failure: keep the advert, but never beyond its hard expiry.
      if (self.checkExpiry()) self.armRefresh();
    });
  };

  Slot.prototype.resume = function () {
    if (!this.checkExpiry()) return;
    this.armExpiry();
    if (now() - this.lastCheck >= RESUME_STALE_MS) this.refresh();
    if (this.inView && this.viewSince === null) this.viewSince = now();
    this.maybeStartView();
  };

  Slot.prototype.hidden = function () {
    this.viewSince = null;
    this.clear("view");
  };

  Slot.prototype.handleLoad = function () {
    if (!this.active || this.loaded) return;
    if (!imageOk(this.img)) { this.end("image_error"); return; }
    this.loaded = true;
    var self = this;
    if (!("IntersectionObserver" in window)) return; // cannot measure: never count
    this.io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var vis = e.isIntersecting && e.intersectionRatio >= 0.5;
        if (vis && !self.inView) self.viewSince = pageVisible() ? now() : null;
        if (!vis) { self.viewSince = null; self.clear("view"); }
        self.inView = vis;
        self.maybeStartView();
      });
    }, { threshold: [0, 0.5, 1] });
    this.io.observe(this.img);
  };

  Slot.prototype.maybeStartView = function () {
    var self = this;
    if (!this.active || this.counted || !this.loaded || !this.inView || !pageVisible() || this.timers.view) return;
    if (this.viewSince === null) this.viewSince = now();
    this.timers.view = setTimeout(function () { self.timers.view = null; self.viewBoundary(); },
      Math.max(0, VIEW_MS - (now() - this.viewSince)));
  };

  /** Re-verify everything at the 1-second boundary before counting. */
  Slot.prototype.viewBoundary = function () {
    if (!this.active || this.counted) return;
    if (!this.checkExpiry()) return;
    if (!imageOk(this.img)) { this.end("image_error"); return; }
    if (!this.inView || !pageVisible() || this.viewSince === null) return;
    if (now() - this.viewSince < VIEW_MS) { this.maybeStartView(); return; }
    this.counted = true;
    if (this.io) { this.io.disconnect(); this.io = null; }
    sendImpression(this.impressionUrl, this.token);
  };

  Slot.prototype.end = function (reason) {
    if (!this.active) return;
    this.active = false;
    this.endReason = reason;
    this.clear("expiry"); this.clear("refresh"); this.clear("view");
    if (this.io) { this.io.disconnect(); this.io = null; }
    if (this.img) {
      this.img.removeEventListener("load", this.onLoad);
      this.img.removeEventListener("error", this.onError);
    }
    var i = slots.indexOf(this);
    if (i >= 0) slots.splice(i, 1);
    try { this.restoreFn(); } catch (e) { /* ignore */ }
  };

  // ── Page lifecycle (one set of listeners for all slots) ────────────
  function eachSlot(fn) { slots.slice().forEach(fn); }
  document.addEventListener("visibilitychange", function () {
    eachSlot(function (s) { if (pageVisible()) s.resume(); else s.hidden(); });
  });
  window.addEventListener("pageshow", function () { eachSlot(function (s) { s.resume(); }); });

  // ── JS mode: swap a container's house advert for a live advert ─────
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
    if (!container) return;
    fetchSlot(placement).then(function (data) {
      if (!data) return;
      var ads = data.ads.filter(valid);
      if (!ads.length) return; // keep the house advert
      var ad = ads[Math.floor(Math.random() * ads.length)];
      var built = build(ad, placement);
      var house = document.createDocumentFragment();
      while (container.firstChild) house.appendChild(container.firstChild);
      container.appendChild(built.el);
      var slot = new Slot({
        el: built.el, img: built.img, placement: placement, creativeId: ad.creative_id,
        serveUntil: Date.parse(ad.serve_until), impressionUrl: ad.impression_url, token: ad.impression_token,
        restore: function () {
          if (built.el.parentNode === container) container.removeChild(built.el);
          container.appendChild(house);
        },
      });
      // src first: an <img> without src reports complete=true/naturalWidth=0.
      // load/error events are always dispatched asynchronously, so start()
      // still attaches its listeners in time (or sees a cached image).
      built.img.src = ad.desktop.url;
      slot.start();
    });
  }

  // ── Server mode: adopt PHP-rendered adverts ─────────────────────────
  function houseTemplateFor(el) {
    var p = el.parentNode;
    if (!p) return null;
    for (var i = 0; i < p.children.length; i++) {
      var c = p.children[i];
      if (c.tagName && c.tagName.toUpperCase() === "TEMPLATE" && /(^|\s)msm-ad-house(\s|$)/.test(c.className || "")) return c;
    }
    return null;
  }

  function serverRestore(el) {
    return function () {
      var p = el.parentNode;
      if (!p) return;
      var tpl = houseTemplateFor(el);
      if (tpl) {
        p.insertBefore(document.importNode(tpl.content, true), el);
        p.removeChild(tpl);
      }
      p.removeChild(el);
    };
  }

  function adopt(el) {
    if (el.getAttribute("data-msm-ad-managed")) return;
    el.setAttribute("data-msm-ad-managed", "1");
    var imp = el.getAttribute("data-msm-ad-impression");
    var tok = el.getAttribute("data-msm-ad-token");
    var id = el.getAttribute("data-msm-ad-creative");
    var placement = el.getAttribute("data-msm-ad-placement");
    var until = Date.parse(el.getAttribute("data-msm-ad-until") || "");
    var img = el.getElementsByTagName("img")[0] || null;
    var restore = serverRestore(el);
    // Anything unverifiable fails safe to the house advert.
    if (imp !== API + "/api/ads/impression" || !TOKEN.test(tok || "") || !UUID.test(id || "") || !placement || isNaN(until)) {
      restore();
      return;
    }
    new Slot({ el: el, img: img, placement: placement, creativeId: id, serveUntil: until, impressionUrl: imp, token: tok, restore: restore }).start();
  }

  function init() {
    var map = cfg.containers || {};
    Object.keys(map).forEach(function (placement) { fill(placement, map[placement]); });
    var pre = document.querySelectorAll(".msm-ad[data-msm-ad-token]");
    for (var i = 0; i < pre.length; i++) adopt(pre[i]);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
