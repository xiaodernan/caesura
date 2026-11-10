/* 止音纪元 · 集大成调度台 —— 前端渲染（零依赖，P8 / KI-495）。
 *
 * 铁律：只渲染后端真判词，绝不在前端编数。缺字段 ⇒ 诚实显示「无数据」。
 * 数据源：先 fetch ./snapshot.json（http 服务时是最新真跑）；失败（file:// 跨源）
 * 回退到 bootstrap.js 注入的 window.__BOOTSTRAP_SNAPSHOT__（同一份真快照的固化副本）。
 */
(function () {
  'use strict'

  var $ = function (s, r) { return (r || document).querySelector(s) }
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)) }
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }
  var isNum = function (x) { return typeof x === 'number' && isFinite(x) }
  var fmt = function (x, digits) {
    if (!isNum(x)) return '—'
    return digits == null ? String(x) : x.toFixed(digits)
  }

  var byId = {}
  function index(snap) {
    ;(snap.scenarios || []).forEach(function (s) { byId[s.id] = s })
  }
  function scenario(id) { return byId[id] || {} }

  /* ---------------- 入口 ---------------- */
  function boot() {
    loadSnapshot().then(function (result) {
      var snap = result.data
      index(snap)
      renderStamp(snap, result.source)
      renderHighlights(snap.highlights || {})
      renderTopology()
      renderEvents()
      renderResilience()
      renderGray()
      renderCache()
      renderNet()
      setLive(true, result.source)
    }).catch(function (e) {
      setLive(false, 'error')
      console.error('[console] 快照读取失败：', e)
    })
  }

  function loadSnapshot() {
    return new Promise(function (resolve, reject) {
      var fallback = function () {
        var b = window.__BOOTSTRAP_SNAPSHOT__
        if (b && b.scenarios) resolve({ data: b, source: 'BOOTSTRAP (file://)' })
        else reject(new Error('既无 snapshot.json 也无 bootstrap 快照'))
      }
      if (location.protocol === 'file:') return fallback()
      var ctl = new XMLHttpRequest()
      ctl.open('GET', './snapshot.json?t=' + Date.now(), true)
      ctl.timeout = 4000
      ctl.onreadystatechange = function () {
        if (ctl.readyState !== 4) return
        if (ctl.status >= 200 && ctl.status < 300) {
          try { resolve({ data: JSON.parse(ctl.responseText), source: 'snapshot.json (live)' }) }
          catch (e) { fallback() }
        } else fallback()
      }
      ctl.onerror = fallback
      ctl.ontimeout = fallback
      ctl.send()
    })
  }

  function renderStamp(snap, source) {
    var d = isNum(snap.generatedAt) ? new Date(snap.generatedAt) : null
    $('#generated-at').textContent = d ? d.toLocaleString('zh-CN', { hour12: false }) : '—'
    $('#src-badge').textContent = 'SOURCE · ' + source
    var okCount = (snap.scenarios || []).filter(function (s) { return s.ok }).length
    var total = (snap.scenarios || []).length
    $('#provenance').textContent = '数据源：真跑 ' + total + ' 趟端到端证据（' + okCount + '/' + total + ' 通过）· schema ' + (snap.schema || '?') + ' · 非硬编码'
  }

  function setLive(ok, source) {
    var led = $('#led')
    led.className = 'led ' + (ok ? 'on' : 'off')
    $('#live-text').textContent = ok ? ('真值已载入 · ' + (snapSourceLabel(source))) : '快照读取失败'
  }
  function snapSourceLabel(s) { return /file:\/\//.test(s) ? 'file 回退' : /live/.test(s) ? '实时快照' : s }

  /* ---------------- 大数（带 count-up） ---------------- */
  function renderHighlights(h) {
    var values = {
      services: h.services, spanCount: h.spanCount, canaryHits: h.canaryHits,
      cacheHitRate: h.cacheHitRate, cwnd: h.cwnd, timedOut: h.timedOut,
    }
    $$('[data-num]').forEach(function (el) {
      var key = el.getAttribute('data-num')
      var v = values[key]
      var pct = el.getAttribute('data-pct') === '1'
      if (!isNum(v)) { el.textContent = '—'; return }
      var target = pct ? v * 100 : v
      var digits = pct ? 0 : (key === 'cwnd' ? 1 : 0)
      countUp(el, target, digits, pct ? '%' : '')
    })
  }
  function countUp(el, target, digits, suffix) {
    var start = null, dur = 1100
    function step(ts) {
      if (start === null) start = ts
      var p = Math.min(1, (ts - start) / dur)
      var eased = 1 - Math.pow(1 - p, 3)
      el.textContent = (target * eased).toFixed(digits) + suffix
      if (p < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }

  /* ---------------- 分层拓扑（真场景数据决定高亮/告警） ---------------- */
  var LAYERS = [
    { y: 14, label: 'GAME', nodes: [{ x: 300, w: 120, t: 'caesura-game', s: 'EventBus / lifecycle' }] },
    { y: 66, label: 'FACE', nodes: [{ x: 300, w: 120, t: 'CaesuraCloud', s: 'facade + request' }] },
    { y: 118, label: 'GW', nodes: [
      { x: 150, w: 130, t: 'Gateway Matcher', s: 'predicate + filter chain' },
      { x: 470, w: 130, t: 'Gray Router', s: 'affinity / canary' },
    ] },
    { y: 170, label: 'LB', nodes: [{ x: 300, w: 120, t: 'Load Balancer', s: 'round-robin / weight' }] },
    { y: 222, label: 'MESH', nodes: [
      { x: 110, w: 110, t: 'caesura-gate', s: 'K8s discovery' },
      { x: 300, w: 110, t: 'svc-a', s: 'Eureka' },
      { x: 490, w: 110, t: 'resilience', s: 'breaker / LB' },
    ] },
    { y: 274, label: 'OBS', nodes: [
      { x: 110, w: 110, t: 'Tracer', s: 'W3C span' },
      { x: 300, w: 110, t: 'EventBus', s: 'started / stopped' },
      { x: 490, w: 110, t: 'Cache / Net', s: 'LRU · AIMD · RTO' },
    ] },
  ]
  function renderTopology() {
    var main = scenario('main'), gs = scenario('gray'), rs = scenario('resilience')
    var timeout = isNum(rs.stats && rs.stats.timedOut) ? rs.stats.timedOut : 0
    var canary = isNum(gs.stats && gs.stats.canary) ? gs.stats.canary : 0
    var W = 720, H = 320
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">'

    // 连线：一条主链路 game→face→gw(left)→lb→mesh(gate)；侧链 gw(right) 灰度、mesh→obs。
    var wires = [
      [360, 34, 360, 66], [360, 86, 360, 118],
      [360, 148, 360, 170], [360, 200, 165, 222], [360, 200, 355, 222], [360, 200, 545, 222],
      [165, 252, 165, 274], [355, 252, 355, 274], [545, 252, 545, 274],
      [360, 148, 535, 118],
    ]
    wires.forEach(function (w, i) {
      var flow = i < 4 // 主链活跃
      svg += '<path class="' + (flow ? 'wire-flow' : 'wire') + '" d="M' + w[0] + ' ' + w[1] + ' L' + w[2] + ' ' + w[3] + '"/>'
    })
    // 主链上一个流动光点
    svg += '<circle class="pulse" r="3.4"><animateMotion dur="4.2s" repeatCount="indefinite" path="M360 34 L360 66 L360 118 L360 170 L165 222"/></circle>'

    LAYERS.forEach(function (layer) {
      svg += '<text class="layer-label" x="12" y="' + (layer.y + 22) + '">' + esc(layer.label) + '</text>'
      layer.nodes.forEach(function (n) {
        var warn = /resilience|gate/.test(n.t) && timeout > 0
        svg += '<rect class="node-box" x="' + (n.x - n.w / 2) + '" y="' + layer.y + '" width="' + n.w + '" height="42" rx="2"/>'
        if (warn) svg += '<rect class="warn-ring" x="' + (n.x - n.w / 2 - 2) + '" y="' + (layer.y - 2) + '" width="' + (n.w + 4) + '" height="46" rx="3"/>'
        svg += '<text class="node-text" text-anchor="middle" x="' + n.x + '" y="' + (layer.y + 19) + '">' + esc(n.t) + '</text>'
        svg += '<text class="node-sub" text-anchor="middle" x="' + n.x + '" y="' + (layer.y + 33) + '">' + esc(n.s) + '</text>'
      })
    })
    // 灰度角标
    if (canary > 0) {
      svg += '<text class="node-sub" text-anchor="middle" x="535" y="116" style="fill:var(--gold)">✦ ' + canary + ' 次金丝雀</text>'
    }
    svg += '</svg>'
    $('#topo').innerHTML = svg

    var legend = $('.panel-topo .legend')
    if (main.callOk === true) {
      legend.insertAdjacentHTML('beforeend', '<span style="color:var(--jade)">✓ 主链 ' + esc((main.services || []).length) + ' 服务可达</span>')
    } else {
      legend.insertAdjacentHTML('beforeend', '<span class="nodata" style="padding:0">主链未通</span>')
    }
  }

  /* ---------------- 事件流 ---------------- */
  function renderEvents() {
    var ev = scenario('main').events
    var ol = $('#events')
    if (!Array.isArray(ev) || !ev.length) { ol.innerHTML = '<li class="nodata">无事件读数</li>'; return }
    var DESC = {
      'game.started': '注册游戏实例，广播 lifecycle，发 game.started',
      'game.stopped': '注销并关停，发 game.stopped',
    }
    ol.innerHTML = ev.map(function (t, i) {
      var stop = /stop/.test(t)
      return '<li class="' + (stop ? 'stop' : '') + '" style="animation:rise .5s ' + (i * .12) + 's both">' +
        '<div class="ev-type">' + esc(t) + '</div>' +
        '<div class="ev-desc">' + esc(DESC[t] || '云事件总线订阅收到') + '</div></li>'
    }).join('')
  }

  /* ---------------- 韧性条 ---------------- */
  function renderResilience() {
    var st = scenario('resilience').stats || {}
    var rows = [
      { k: 'retries', label: 'Retry 重试' },
      { k: 'rateLimited', label: 'RateLimit 限流' },
      { k: 'bulkheadHeld', label: 'Bulkhead 持票' },
      { k: 'bulkheadRejected', label: 'Bulkhead 拒入' },
      { k: 'timedOut', label: 'TimeLimiter 超时' },
    ]
    var vals = rows.map(function (r) { return isNum(st[r.k]) ? st[r.k] : 0 })
    var max = Math.max.apply(null, vals.concat([1]))
    $('#resilience').innerHTML = rows.map(function (r, i) {
      var v = vals[i]
      var pct = Math.round((v / max) * 100)
      var cls = r.k.indexOf('timedOut') === 0 || r.k.indexOf('Rejected') > 0 ? 'wine' : (v > 0 ? 'gold' : 'jade')
      return '<div class="bar-row"><span class="label">' + esc(r.label) + '</span>' +
        '<div class="bar-track"><div class="bar-fill ' + cls + '" data-w="' + pct + '"></div></div>' +
        '<span class="val">' + v + '</span></div>'
    }).join('')
    requestAnimationFrame(function () {
      $$('#resilience .bar-fill').forEach(function (b) { b.style.width = b.getAttribute('data-w') + '%' })
    })
    var rs = scenario('resilience')
    $('#resilience-note').textContent = rs.error
      ? ('末端判词：' + rs.error + '（挂起 transport ⇒ TimeLimiter 真触发，非配了没跑）')
      : '本趟未注入超时场景。'
  }

  /* ---------------- 灰度分池 ---------------- */
  function renderGray() {
    var s = scenario('gray'), st = s.stats
    if (!st || !isNum(st.canary) || !isNum(st.primary)) {
      $('#gray-split').innerHTML = '<div class="nodata">无灰度读数</div>'
      $('#gray-probes').innerHTML = ''
      return
    }
    var canary = st.canary, primary = st.primary, total = Math.max(1, canary + primary)
    var cp = Math.round((canary / total) * 100), pp = 100 - cp
    $('#gray-split').innerHTML =
      '<div class="gray-seg primary" style="flex-grow:' + pp + '">' + pp + '% 稳定</div>' +
      '<div class="gray-seg canary" style="flex-grow:' + cp + '">' + cp + '% 金丝雀</div>'
    var probes = s.probes || []
    $('#gray-probes').innerHTML = probes.length
      ? probes.map(function (p) {
        return '<div class="probe ' + (p.lane === 'canary' ? 'canary' : '') + '">' +
          '<span class="key">key=' + esc(p.key) + '</span>' +
          '<span class="lane">' + esc(p.lane || '—') + '</span>' +
          '<span class="iid">' + esc(p.instanceId || '—') + (p.fallback ? ' <span class="fal">回退</span>' : '') + '</span>' +
          '</div>'
      }).join('')
      : '<div class="nodata">无探针读数</div>'
  }

  /* ---------------- 鉴权缓存环 ---------------- */
  function renderCache() {
    var s = scenario('cache'), st = s.stats || {}
    var rate = isNum(st.hitRate) ? st.hitRate : null
    var pct = rate == null ? null : Math.round(rate * 100)
    var R = 38, C = 2 * Math.PI * R
    var off = pct == null ? C : C * (1 - rate)
    $('#cache-ring').innerHTML =
      '<svg viewBox="0 0 96 96">' +
      '<defs></defs>' +
      '<circle class="bg" cx="48" cy="48" r="' + R + '"/>' +
      '<circle class="fg" cx="48" cy="48" r="' + R + '" stroke-dasharray="' + C.toFixed(2) + '" stroke-dashoffset="' + off.toFixed(2) + '"/>' +
      '<text class="pct" x="48" y="53" text-anchor="middle">' + (pct == null ? '—' : pct + '%') + '</text>' +
      '</svg>'
    var kv = [
      ['端点首判', s.firstSource || '—'],
      ['二次判词', s.secondSource || '—'],
      ['cacheHit', s.secondCacheHit === true ? 'true' : (s.secondCacheHit === false ? 'false' : '—')],
      ['hits / misses', (isNum(st.hits) ? st.hits : '—') + ' / ' + (isNum(st.misses) ? st.misses : '—')],
      ['entries / bytes', (isNum(st.entries) ? st.entries : '—') + ' / ' + (isNum(st.bytes) ? st.bytes : '—')],
    ]
    $('#cache-kv').innerHTML = kv.map(function (p) {
      return '<li><span>' + esc(p[0]) + '</span><span>' + esc(p[1]) + '</span></li>'
    }).join('')
    $('#cache-note').textContent = (s.secondSource === 'cache' && s.secondCacheHit)
      ? '同一令牌第二次命中缓存，introspection 端点只被访问一次（TTL 内），不缓存降级态。'
      : '本趟未观测到缓存命中，或字段缺失。'
  }

  /* ---------------- 计网曲线 + 读数 ---------------- */
  function renderNet() {
    var s = scenario('net')
    var series = Array.isArray(s.series) ? s.series : []
    var svg = $('#cwnd-svg')
    if (!series.length) {
      svg.innerHTML = ''
      $('#chart-axis').innerHTML = '<span class="nodata">无 cwnd 轨迹读数</span>'
      $('#chart-legend').innerHTML = ''
    } else {
      renderChart(svg, series, s.aimd || {})
      var W = 720
      $('#chart-axis').innerHTML = '<span>step 0</span><span>AIMD 逐步读数 · 共 ' + series.length + ' 步</span><span>step ' + (series.length - 1) + '</span>'
      var kinds = uniqueEvents(series)
      $('#chart-legend').innerHTML =
        '<span><i class="dot flow"></i>cwnd</span>' +
        '<span><i class="dot ok"></i>ack 加性增</span>' +
        (kinds.timeout ? '<span><i class="dot warn"></i>timeout 乘性减</span>' : '') +
        (kinds.fast ? '<span><i class="dot warn"></i>fast-retransmit</span>' : '')
    }
    renderNetStats(s)
  }

  function uniqueEvents(series) {
    var o = {}
    series.forEach(function (p) { if (p.event) o[p.event] = true })
    return o
  }

  function renderChart(svg, series, aimd) {
    var W = 720, H = 240, padL = 34, padR = 12, padT = 16, padB = 20
    var xs = function (i) { return padL + (series.length <= 1 ? 0 : (i / (series.length - 1)) * (W - padL - padR)) }
    var maxC = Math.max.apply(null, series.map(function (p) { return isNum(p.cwnd) ? p.cwnd : 0 }).concat([1]))
    var maxV = Math.ceil(maxC * 1.1)
    var ys = function (v) { return H - padB - (v / maxV) * (H - padT - padB) }
    var pts = series.map(function (p, i) { return [xs(i), ys(isNum(p.cwnd) ? p.cwnd : 0)] })
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1) }).join(' ')
    var area = line + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (H - padB) + ' L' + pts[0][0].toFixed(1) + ' ' + (H - padB) + ' Z'

    var out = '<defs><linearGradient id="cwndGrad" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="rgba(201,180,88,.28)"/><stop offset="100%" stop-color="rgba(201,180,88,0)"/>' +
      '</linearGradient></defs>'
    // 横向网格 + y 轴刻度
    for (var g = 0; g <= 4; g++) {
      var val = Math.round((maxV / 4) * g)
      var y = ys((maxV / 4) * g)
      out += '<line class="grid-line" x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '"/>'
      out += '<text class="axis-txt" x="4" y="' + (y + 3) + '">' + val + '</text>'
    }
    // ssthresh 阈值线
    if (isNum(aimd.ssthresh) && aimd.ssthresh <= maxV) {
      var ty = ys(aimd.ssthresh)
      out += '<line class="thresh" x1="' + padL + '" y1="' + ty + '" x2="' + (W - padR) + '" y2="' + ty + '"/>'
      out += '<text class="axis-txt" x="' + (W - padR - 66) + '" y="' + (ty - 4) + '" style="fill:var(--wine)">ssthresh ' + fmt(aimd.ssthresh) + '</text>'
    }
    out += '<path class="area" d="' + area + '"/>'
    out += '<path class="line draw" d="' + line + '"/>'
    // 事件标记
    series.forEach(function (p, i) {
      if (p.event === 'timeout' || p.event === 'fast-retransmit') {
        var cls = p.event === 'timeout' ? 'timeout' : 'fast'
        out += '<line class="marker ' + cls + '" x1="' + xs(i) + '" y1="' + (H - padB) + '" x2="' + xs(i) + '" y2="' + ys(p.cwnd) + '" opacity=".5"/>'
        out += '<circle class="marker ' + cls + '" cx="' + xs(i) + '" cy="' + ys(p.cwnd) + '" r="3" fill="var(--ash-0)"/>'
      }
    })
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H)
    svg.innerHTML = out
  }

  function renderNetStats(s) {
    var aimd = s.aimd || {}, cubic = s.cubic || {}, rto = s.rto || {}, win = s.window || {}
    var items = [
      { k: '拥塞窗口 cwnd', v: fmt(aimd.cwnd, 1), u: 'MSS', hl: true },
      { k: '慢启动阈值 ssthresh', v: fmt(aimd.ssthresh), u: 'MSS' },
      { k: 'SRTT', v: fmt(rto.srtt), u: 'ms' },
      { k: 'RTO', v: fmt(rto.rto), u: 'ms', hl: true },
      { k: 'CUBIC Wmax', v: fmt(cubic.Wmax, 1), u: 'MSS' },
      { k: '滑窗 in-flight', v: fmt(win.inFlight), u: 'seg' },
      { k: '观测次数', v: fmt(s.observes), u: 'calls' },
      { k: 'Karn 忽略样本', v: fmt(rto.ignoredSamples), u: '个' },
    ]
    var mode = aimd.mode ? '<span class="mode-chip">' + esc(aimd.mode) + '</span>' : ''
    $('#netstats').innerHTML = items.map(function (it) {
      return '<div class="netstat ' + (it.hl ? 'hl' : '') + '"><div class="k">' + esc(it.k) + '</div>' +
        '<div class="v">' + esc(it.v) + (it.v === '—' ? '' : ' <small>' + esc(it.u) + '</small>') + '</div></div>'
    }).join('') + (mode ? '<div class="netstat" style="grid-column:1/-1"><div class="k">AIMD 相位</div>' + mode + '</div>' : '')
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
