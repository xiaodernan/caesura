/* 止音纪元 · 止音前线埋点（KI-583）· 零网络 · 零 LLM · 只写本机 localStorage
 * The Epoch of Hush — front-line telemetry: zero network, zero LLM, device-local only.
 * What it stores: pageview / click (with coarse viewport quadrant) / rage (3 clicks inside 800ms & 40px) / error.
 * Ring buffer of 400 events. Read it back at /caesura/admin/ → 本机实况. Disable: localStorage.removeItem('caesura.telemetry.v1'). */
(function () {
  'use strict';
  try {
    var KEY = 'caesura.telemetry.v1';
    var now = Date.now();
    var doc = { v: 1, firstSeen: now, counts: { pageview: 0, click: 0, rage: 0, error: 0 }, events: [] };
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { var p = JSON.parse(raw); if (p && p.v === 1 && Array.isArray(p.events)) doc = p; }
    } catch (e) { /* 存储不可用就静默退出 */ }
    var persist = function () { try { localStorage.setItem(KEY, JSON.stringify(doc)); } catch (e) {} };
    var push = function (ev) {
      ev.t = ev.t || Date.now();
      doc.events.push(ev);
      if (doc.events.length > 400) doc.events.splice(0, doc.events.length - 400);
      persist();
    };
    var bump = function (t) { doc.counts[t] = (doc.counts[t] || 0) + 1; };
    var quadrant = function (x, y) {
      var w = Math.max(1, window.innerWidth || 1), h = Math.max(1, window.innerHeight || 1);
      return (x < w / 2 ? 0 : 1) + (y < h / 2 ? 0 : 2);
    };
    var path = (location.pathname || '/').slice(0, 96);

    bump('pageview');
    push({ type: 'pageview', path: path, ref: (document.referrer || '').slice(0, 96) });

    var recent = [];
    document.addEventListener('click', function (e) {
      var t = Date.now();
      bump('click');
      push({ type: 'click', path: path, q: quadrant(e.clientX || 0, e.clientY || 0) });
      recent.push({ t: t, x: e.clientX || 0, y: e.clientY || 0 });
      recent = recent.filter(function (r) { return t - r.t < 800; });
      if (recent.length >= 3) {
        var xs = recent.map(function (r) { return r.x; }), ys = recent.map(function (r) { return r.y; });
        if (Math.max.apply(null, xs) - Math.min.apply(null, xs) < 40 &&
            Math.max.apply(null, ys) - Math.min.apply(null, ys) < 40) {
          bump('rage');
          push({ type: 'rage', path: path, q: quadrant(e.clientX || 0, e.clientY || 0) });
          recent = [];
        }
      }
    }, { passive: true });

    window.addEventListener('error', function (ev) {
      bump('error');
      push({ type: 'error', path: path, msg: String((ev && ev.message) || 'unknown').slice(0, 80) });
    });
  } catch (e) { /* 埋点永远不许弄坏产品本体 */ }
})();
