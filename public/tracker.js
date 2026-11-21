/* 止音纪元 · 止音前线埋点（KI-583）· 零网络 · 零 LLM · 只写本机 localStorage
 * The Epoch of Hush — front-line telemetry: zero network, zero LLM, device-local only.
 * What it stores: pageview / click (with coarse viewport quadrant) / rage (3 clicks inside 800ms & 40px) / error.
 * Ring buffer of 400 events. Read it back at /caesura/admin/ → 本机实况. Disable: localStorage.removeItem('caesura.telemetry.v1').
 * KI-653（KI-645 行动 #1）：`window.__caesuraTrack(type)` 是页面给自己打点的最小通道（首屏 Start 曝光/按下）；
 *   同样只写本机、同样进环形缓冲，不触网、不升数据包。
 * KI-720：默认仍然零网络；新增**显式 opt-in** 的真人上报通道。只有用户（或管理员页）
 * 调 `window.__caesuraLiveTelemetry(true, endpoint)` 之后才会向本地 Spring report 8082
 * 发送匿名事件；关掉后立刻停止。浏览器本地开关写 localStorage，页面刷新后保持用户的选择。
 * 上报内容与本机环形缓冲完全同源——同一条事件，只是多了一个去向。 */
(function () {
  'use strict';
  try {
    var KEY = 'caesura.telemetry.v1';
    var LIVE_KEY = 'caesura.telemetry.live';
    var ENDPOINT_KEY = 'caesura.telemetry.endpoint';
    var DEFAULT_ENDPOINT = '/report/live/events';
    var SESSION = 's-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36);
    var live = { enabled: false, endpoint: DEFAULT_ENDPOINT };
    try {
      live.enabled = localStorage.getItem(LIVE_KEY) === '1';
      live.endpoint = (localStorage.getItem(ENDPOINT_KEY) || DEFAULT_ENDPOINT).slice(0, 160);
    } catch (e) { /* noop */ }
    var now = Date.now();
    var doc = { v: 1, firstSeen: now, counts: { pageview: 0, click: 0, rage: 0, error: 0 }, events: [] };
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { var p = JSON.parse(raw); if (p && p.v === 1 && Array.isArray(p.events)) doc = p; }
    } catch (e) { /* 存储不可用就静默退出 */ }
    var persist = function () { try { localStorage.setItem(KEY, JSON.stringify(doc)); } catch (e) {} };
    /* 真人上报：只在显式开启后工作；失败静默，绝不影响产品本体。
       只送白名单字段（type/path/q/session），不送 referrer、不送身份信息。 */
    var report = function (ev) {
      if (!live.enabled || typeof window.fetch !== 'function') return;
      try {
        var body = {
          type: String(ev.type || '').slice(0, 32),
          path: String(ev.path || '').slice(0, 96),
          session: SESSION
        };
        if (typeof ev.q === 'number') body.q = ev.q;
        window.fetch(live.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          keepalive: true,
          credentials: 'omit'
        }).catch(function () { /* 上报失败不影响本机缓冲 */ });
      } catch (e) { /* noop */ }
    };
    var push = function (ev) {
      ev.t = ev.t || Date.now();
      doc.events.push(ev);
      if (doc.events.length > 400) doc.events.splice(0, doc.events.length - 400);
      persist();
      report(ev);
    };
    /* 管理员页/本机控制台显式开关；endpoint 可选，缺省走同源 /report/live/events。 */
    window.__caesuraLiveTelemetry = function (on, endpoint) {
      live.enabled = on === true;
      if (typeof endpoint === 'string' && endpoint.length > 0) live.endpoint = endpoint.slice(0, 160);
      try {
        localStorage.setItem(LIVE_KEY, live.enabled ? '1' : '0');
        localStorage.setItem(ENDPOINT_KEY, live.endpoint);
      } catch (e) { /* noop */ }
      return { enabled: live.enabled, endpoint: live.endpoint };
    };
    window.__caesuraLiveTelemetryState = function () {
      return { enabled: live.enabled, endpoint: live.endpoint, session: SESSION };
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

    /* KI-653（KI-645 行动 #1）：页面自己的埋点最小入口。白名单长度与字符收口，绝不弄坏本体。 */
    try {
      window.__caesuraTrack = function (type) {
        try {
          if (typeof type !== 'string' || type.length === 0) return;
          var k = String(type).slice(0, 32);
          bump(k);
          push({ type: k, path: path });
        } catch (e) { /* noop */ }
      };
    } catch (e) { /* noop */ }
  } catch (e) { /* 埋点永远不许弄坏产品本体 */ }
})();
