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
      renderSystems(snap.systems || null)
      renderGuards(snap.systems ? snap.systems.guards : null)
      renderRateLimit(snap.systems ? snap.systems.rateLimit : null)
      renderFailureDetector(snap.systems ? snap.systems.failureDetector : null)
      renderBplus(snap.systems ? snap.systems.bplusIndex : null)
      renderMvcc(snap.systems ? snap.systems.mvccTxn : null)
      renderDistributedTxn(snap.systems ? snap.systems.distributedTxn : null)
      renderRaftConsensus(snap.systems ? snap.systems.raftConsensus : null)
      renderDistributedLock(snap.systems ? snap.systems.distributedLock : null)
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

  /* ---------------- 存储引擎 / 硬件适配（KI-498 前后端协同） ----------------
   * systems 是与五场景并列的独立数据块（真 Node 侧判词的结构计数）。只读不复核：
   * 缺 systems 或某一维 ⇒ 该面板显示「—」，不画假条、不编 speedup。
   */
  function renderSystems(systems) {
    renderLsm(systems && systems.lsm)
    renderHw(systems && systems.hw)
  }

  function renderLsm(lsm) {
    var gauge = $('#lsm-gauge'), kv = $('#lsm-kv'), note = $('#lsm-note'), levels = $('#lsm-levels')
    if (!lsm) {
      gauge.innerHTML = '<span class="big">—</span><span class="cap">LSM 读数缺失</span>'
      kv.innerHTML = ''
      if (levels) levels.innerHTML = '<div class="nodata">无存储引擎读数</div>'
      note.textContent = 'systems.lsm 缺失 —— 重跑 npm run console:data 采集真判词'
      return
    }
    var sp = isNum(lsm.speedup) ? lsm.speedup : null
    gauge.innerHTML =
      '<span class="big">' + esc(fmt(sp, 1)) + '</span><span class="unit">×</span>' +
      '<span class="cap">点查 <b>' + esc(fmt(lsm.comparisons)) + '</b> 次比较<br>' +
      '线性扫描 <b>' + esc(fmt(lsm.scanBaselineComparisons)) + '</b> 次</span>'
    var rows = [
      ['写入 key', fmt(lsm.keys)], ['flush 次数', fmt(lsm.flushes)],
      ['compaction 次数', fmt(lsm.compactions)], ['归并掉旧版本', fmt(lsm.mergedAway)],
      ['丢弃 tombstone', fmt(lsm.tombstonesDropped)], ['Bloom 负查', fmt(lsm.bloomRejects)],
    ]
    kv.innerHTML = rows.map(function (r) {
      return '<li><span>' + esc(r[0]) + '</span><span>' + esc(r[1]) + '</span></li>'
    }).join('')
    // 各层段数：真读数转成条宽（最多段的那层铺满），不编造。
    if (levels) {
      var ls = lsm.levels || []
      var maxSeg = ls.reduce(function (m, l) { return Math.max(m, isNum(l.segments) ? l.segments : 0) }, 0)
      levels.innerHTML = ls.length ? ls.map(function (l) {
        var w = maxSeg > 0 && isNum(l.segments) ? Math.round(l.segments / maxSeg * 100) : 0
        return '<div class="lsm-level"><span class="lv">L' + esc(fmt(l.level)) + '</span>' +
          '<span class="seg"><i style="width:' + w + '%"></i></span>' +
          '<span class="n">' + esc(fmt(l.segments)) + ' 段</span></div>'
      }).join('') : '<div class="nodata">无分层读数</div>'
    }
    note.textContent = '真跑 ' + esc(fmt(lsm.keys)) + ' key：写进 WAL→memtable、顺序 flush 成 SSTable、leveled compaction 归并去重；speedup 为点查比较数 ÷ 线性扫描比较数（算法计数，非墙钟跑分）。'
  }

  function renderHw(hw) {
    var grid = $('#hw-grid'), note = $('#hw-note')
    if (!hw) {
      grid.innerHTML = '<div class="nodata" style="grid-column:1/-1">无硬件适配读数</div>'
      note.textContent = 'systems.hw 缺失 —— 重跑 npm run console:data 采集真判词'
      return
    }
    var a = hw.allocation || {}, c = hw.cacheLine || {}, l = hw.layout || {}
    var seq = l.sequential || {}, str = l.strided || {}
    function card(title, rows, wide) {
      return '<div class="hw-card' + (wide ? ' wide' : '') + '"><div class="t">' + esc(title) + '</div>' +
        rows.map(function (r) {
          return '<div class="row"><span class="k">' + esc(r[0]) + '</span>' +
            '<span class="v' + (r[2] ? ' ' + r[2] : '') + '">' + esc(r[1]) + '</span></div>'
        }).join('') + '</div>'
    }
    grid.innerHTML =
      card('对象池 · GC 分配', [
        ['取还次数', fmt(a.accesses)], ['直接 new', fmt(a.naiveCreated)],
        ['用池新建', fmt(a.poolCreated)], ['省下分配', fmt(a.saved), 'good'],
      ]) +
      card('缓存行 · false sharing', [
        ['padded 假共享', fmt(c.paddedFalseSharing), 'good'],
        ['packed 假共享', fmt(c.packedFalseSharing), 'hot'],
        ['padding 空间开销', isNum(c.paddingOverhead) ? fmt(c.paddingOverhead, 1) + '×' : '—'],
      ]) +
      card('数据布局 · AoS→SoA（顺序扫 ' + esc(fmt(seq.speedup, 1)) + '×）', [
        ['顺序 AoS miss', fmt(seq.aosMisses)], ['顺序 SoA miss', fmt(seq.soaMisses), 'good'],
        ['顺序 speedup', isNum(seq.speedup) ? fmt(seq.speedup, 1) + '×' : '—', 'good'],
        ['跳跃 ' + fmt(str.stride) + ' speedup', isNum(str.speedup) ? fmt(str.speedup, 1) + '×' : '—'],
      ], true)
    note.textContent = '三件均为 Node 侧确定性结构计数：对象池省的是分配次数、padding 给的是同 cache line 对数、SoA 给的是 LRU 行缓存模型 miss 数 —— 非墙钟跑分，真实收益须实测调参。'
  }

  /* ---------------- 缓存防护三件套（KI-501 前后端协同） ----------------
   * systems.guards 是与 lsm/hw 并列的第三维独立读数。只读不复核：
   * 整块缺 ⇒ 三面板各自降级；单块缺 ⇒ 只降那块，不连坐、不画假条/假直方图。
   */
  function renderGuards(guards) {
    renderStampede(guards && guards.stampede)
    renderPenetration(guards && guards.penetration)
    renderAvalanche(guards && guards.avalanche)
  }

  function guardMissing(hero, bars, note, label) {
    if (hero) hero.innerHTML = '<span class="big">—</span><span class="cap">' + esc(label) + '读数缺失</span>'
    if (bars) bars.innerHTML = '<div class="nodata">无' + esc(label) + '读数</div>'
    if (note) note.textContent = 'systems.guards 缺失 —— 重跑 npm run console:data 采集真判词'
  }

  // 击穿：并发 N → 无防护 N 次回源 vs singleflight 1 次，放大倍数；XFetch 提前续期挤掉 miss。
  function renderStampede(st) {
    var hero = $('#stampede-hero'), bars = $('#stampede-bars'), note = $('#stampede-note')
    if (!st) { guardMissing(hero, bars, note, '击穿'); return }
    var amp = isNum(st.amplification) ? st.amplification : null
    hero.innerHTML =
      '<span class="big">' + esc(fmt(amp, 0)) + '</span><span class="unit">×</span>' +
      '<span class="cap">并发 <b>' + esc(fmt(st.concurrency)) + '</b> 路<br>' +
      'singleflight 只回填 <b>' + esc(fmt(st.singleflightLoads)) + '</b> 次</span>'
    var naive = isNum(st.naiveLoads) ? st.naiveLoads : 0
    var sf = isNum(st.singleflightLoads) ? st.singleflightLoads : 0
    var max = Math.max(naive, sf, 1)
    bars.innerHTML =
      guardBar('无防护', naive, max, 'bad', 'bad') +
      guardBar('singleflight', sf, max, 'safe', 'good')
    note.textContent = '真跑 ' + esc(fmt(st.concurrency)) + ' 路并发 miss 同一热点 key：无防护把后端打 ' +
      esc(fmt(naive)) + ' 次，singleflight（复用缓存层 load）合并成 ' + esc(fmt(sf)) + ' 次，省 ' +
      esc(fmt(st.savedLoads)) + ' 次；XFetch 逻辑过期另提前续期挤掉 ' + esc(fmt(st.xfetchAvoidedMisses)) +
      ' 个并发回源。回源次数是结构计数，非墙钟/QPS。'
  }

  function guardBar(label, value, max, fillCls, numCls) {
    var w = max > 0 && isNum(value) ? Math.round(value / max * 100) : 0
    return '<div class="guard-row"><span class="lab">' + esc(label) + '</span>' +
      '<span class="track"><i class="fill ' + fillCls + '" style="width:' + w + '%" data-w="' + w + '"></i></span>' +
      '<span class="num ' + numCls + '">' + esc(fmt(value)) + '</span></div>'
  }

  // 穿透：不存在的 key 三路回源（无防护 / 空值墓碑 / 布隆），布隆假阳性如实标注。
  function renderPenetration(pen) {
    var hero = $('#penetration-hero'), bars = $('#penetration-bars'), note = $('#penetration-note')
    if (!pen) { guardMissing(hero, bars, note, '穿透'); return }
    var saved = isNum(pen.bloomSavedRate) ? pen.bloomSavedRate : null
    hero.innerHTML =
      '<span class="big jade">' + esc(saved == null ? '—' : fmt(saved * 100, 0)) + '</span><span class="unit">%</span>' +
      '<span class="cap">布隆省下回源<br><b>' + esc(fmt(pen.absent)) + '</b> 个不存在 key × ' + esc(fmt(pen.rounds)) + ' 轮</span>'
    var naive = isNum(pen.naiveDbHits) ? pen.naiveDbHits : 0
    var neg = isNum(pen.negativeDbHits) ? pen.negativeDbHits : 0
    var bloom = isNum(pen.bloomDbHits) ? pen.bloomDbHits : 0
    var max = Math.max(naive, neg, bloom, 1)
    bars.innerHTML =
      guardBar('无防护', naive, max, 'bad', 'bad') +
      guardBar('空值墓碑', neg, max, 'good', 'good') +
      guardBar('布隆前置', bloom, max, 'safe', 'good')
    note.textContent = '查库里不存在的 key：' + esc(fmt(naive)) + ' 次无防护回源 → 空值墓碑只首轮 ' +
      esc(fmt(neg)) + ' 次、布隆前置挡掉 ' + esc(fmt(pen.bloomRejected)) + ' 个、只放行 ' + esc(fmt(bloom)) +
      ' 次。布隆**不零误判**：如实暴露 ' + esc(fmt(pen.bloomFalsePositives)) + ' 个假阳性（会放进少量不存在 key）。回源数是结构计数。'
  }

  // 雪崩：统一 TTL 单桶峰值 vs TTL 抖动削峰，双直方图（真 histogram 转条高，不编造）。
  function renderAvalanche(av) {
    var hero = $('#avalanche-hero'), hist = $('#avalanche-hist'), note = $('#avalanche-note')
    if (!av) { guardMissing(hero, hist, note, '雪崩'); return }
    var red = isNum(av.peakReduction) ? av.peakReduction : null
    hero.innerHTML =
      '<span class="big jade">' + esc(red == null ? '—' : fmt(red * 100, 0)) + '</span><span class="unit">%</span>' +
      '<span class="cap">单桶峰值削减<br>' + esc(fmt(av.uniformPeak)) + ' → ' + esc(fmt(av.jitterPeak)) + ' 条同刻过期</span>'
    var hg = av.histogram || {}
    hist.innerHTML =
      histRow('统一 TTL', hg.uniform, av.uniformPeak, false) +
      histRow('TTL 抖动', hg.jitter, av.jitterPeak, true)
    note.textContent = '一批 ' + esc(fmt(av.keys)) + ' 个 key 同时写入：统一 TTL 时 ' + esc(fmt(av.uniformPeak)) +
      ' 条挤在 1 个过期桶（DB 瞬时被打满），加 TTL 抖动后摊到 ' + esc(fmt(av.jitterBuckets)) + ' 个桶、峰值降 ' +
      esc(fmt(red == null ? 0 : red * 100, 0)) + '%。抖动只挪时刻、不减少总过期数；非墙钟跑分。'
  }

  function histRow(label, series, peak, jitter) {
    var arr = Array.isArray(series) ? series : []
    var max = arr.reduce(function (m, v) { return Math.max(m, isNum(v) ? v : 0) }, 1)
    var bars = arr.length
      ? arr.map(function (v) {
        var h = max > 0 && isNum(v) ? Math.max(2, Math.round(v / max * 100)) : 2
        return '<i style="height:' + h + '%"></i>'
      }).join('')
      : '<span class="nodata">无直方图读数</span>'
    return '<div class="hist-row"><span class="lab">' + esc(label) + '</span>' +
      '<div><div class="hist-bars' + (jitter ? ' jitter' : '') + '">' + bars + '</div>' +
      '<div class="peak">峰值 ' + esc(fmt(peak)) + ' · ' + esc(fmt(arr.length)) + ' 桶</div></div></div>'
  }

  /* ---------- KI-502 网关限流算法族：五算法突发对照 + Redis 原子令牌桶 ---------- */
  function renderRateLimit(rl) {
    renderRateAlgos(rl && rl.strategies, rl)
    renderRateRedis(rl && rl.redis)
  }

  function rateLimitMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">无' + esc(label) + '读数</div>'
    if (note) note.textContent = 'systems.rateLimit 缺失 —— 重跑 npm run console:data 采集真判词'
  }

  // 五算法突发放大：任意 windowMs 内最多放行 / 配额（burstRatio），1=安全、2=固定窗口翻边 2×。
  function renderRateAlgos(strategies, rl) {
    var list = $('#rl-algos'), note = $('#rl-algo-note')
    if (!strategies) { rateLimitMissing(list, note, '限流算法'); return }
    var defs = [
      ['fixedWindow', '固定窗口', '自然窗对齐 · 翻边突发'],
      ['slidingLog', '滑动日志', '精确 · O(n) 内存'],
      ['slidingCounter', '滑动计数', '加权近似 · O(1) 内存'],
      ['tokenBucket', '令牌桶', '攒桶 · 受控突发'],
      ['leakyBucket', '漏桶', '匀速漏 · 恒定整形'],
    ]
    var parts = defs.map(function (d) {
      var s = strategies[d[0]]
      if (!s) return ''
      var ratio = isNum(s.burstRatio) ? s.burstRatio : null
      var warn = ratio != null && ratio > 1.5
      // 比例轴 0..2：1× 落在 50% 中线，2× 顶格；内联宽度静态可读、可被 DOM stub 断言。
      var w = ratio != null ? Math.max(0, Math.min(100, Math.round(ratio / 2 * 100))) : 0
      var cls = warn ? 'warn' : 'safe'
      return '<div class="rl-algo"><span class="lab">' + esc(d[1]) + '<small>' + esc(d[2]) + '</small></span>' +
        '<span class="track"><i class="fill ' + cls + '" style="width:' + w + '%" data-ratio="' + esc(fmt(ratio)) + '"></i></span>' +
        '<span class="num ' + cls + '"><b>' + esc(ratio == null ? '—' : '×' + fmt(ratio, 1)) + '</b></span></div>'
    })
    list.innerHTML = parts.join('') || '<div class="nodata">无算法读数</div>'
    var fw = strategies.fixedWindow
    var sl = strategies.slidingLog
    note.textContent = '同一条 ' + esc(fmt(rl && rl.arrivals)) + ' 请求的窗口翻边突发轨迹：固定窗口按自然分钟对齐，' +
      '在翻边 1ms 内两批全放行 ⇒ 任意 1 窗内最多 ' + esc(fmt(fw && fw.maxInWindow)) + ' 条（配额 ' +
      esc(fmt(rl && rl.limit)) + '，放大 ×' + esc(fmt(fw && fw.burstRatio, 1)) + '）；滑动日志/计数、令牌桶、漏桶都把突发压在 ' +
      esc(fmt(sl && sl.maxInWindow)) + ' 条（×' + esc(fmt(sl && sl.burstRatio, 1)) +
      '）。全结构计数，非墙钟 QPS；令牌/漏桶另受 capacity 与补充/漏水速率约束。'
  }

  // Redis 令牌桶：原子（等价 Lua 串行，封顶 capacity）vs 非原子（GET-SET 竞态，并发全放行超发）。
  function renderRateRedis(rd) {
    var grid = $('#rl-redis'), note = $('#rl-redis-note')
    if (!rd) { rateLimitMissing(grid, note, 'Redis 原子性'); return }
    var cap = isNum(rd.capacity) ? rd.capacity : 0
    var atomic = isNum(rd.atomicAllowed) ? rd.atomicAllowed : 0
    var raw = isNum(rd.nonAtomicAllowed) ? rd.nonAtomicAllowed : 0
    var max = Math.max(atomic, raw, 1)
    var over = isNum(rd.overshoot) ? rd.overshoot : null
    var shared = rd.shared || {}
    grid.innerHTML =
      '<div class="rl-redis-hero"><span class="big">' + esc(fmt(over)) + '</span><span class="unit">条超发</span>' +
      '<span class="cap">' + esc(fmt(rd.concurrency)) + ' 路并发 / 桶容量 <b>' + esc(fmt(cap)) + '</b><br>' +
      '非原子放行 <b>' + esc(fmt(raw)) + '</b> vs 原子 <b>' + esc(fmt(atomic)) + '</b></span></div>' +
      '<div class="rl-redis-row"><span class="lab">原子 · Lua</span><span class="track"><i class="fill atomic" style="width:' +
      Math.round(atomic / max * 100) + '%" data-w="' + Math.round(atomic / max * 100) + '"></i></span>' +
      '<span class="num good">' + esc(fmt(atomic)) + '</span></div>' +
      '<div class="rl-redis-row"><span class="lab">非原子 · 竞态</span><span class="track"><i class="fill raw" style="width:' +
      Math.round(raw / max * 100) + '%" data-w="' + Math.round(raw / max * 100) + '"></i></span>' +
      '<span class="num bad">' + esc(fmt(raw)) + '</span></div>' +
      '<div class="rl-share"><i class="dot ' + (shared.consistent ? 'ok' : 'no') + '"></i>' +
      '跨实例共享 ' + (shared.consistent ? '一致' : '不一致') + ' · A/B 同 backend 同 key 剩余 ' +
      esc(fmt(shared.aRemaining)) + ' / ' + esc(fmt(shared.bSeenRemaining)) + '</div>'
    note.textContent = '令牌桶状态存 Redis 风格后端、时钟作命令参数传入（对齐 Spring RedisRateLimiter 把时间戳交给 Lua）。' +
      '原子路径读-补-判-写在一段不被打断的同步操作里（等价 Lua 串行），恰好放行 ' + esc(fmt(cap)) +
      ' 条；非原子路径 GET 后让出、N 路都读到同一满桶再写回 ⇒ 丢失更新、放行 ' + esc(fmt(raw)) +
      ' 条（超发 ' + esc(fmt(over)) + '）。两实例共享同 backend + key 见剩余一致。进程内模拟，' +
      '非真 Redis/EVAL、非墙钟 QPS。'
  }

  /* ---------- KI-503 服务故障检测：固定超时 vs φ 累积风险 + SWIM 三态 + 健康视图 ---------- */
  function renderFailureDetector(fd) {
    renderFdHero(fd)
    renderFdCurve(fd && fd.curve, fd)
    renderFdAdapt(fd && fd.adaptation)
    renderFdSwim(fd && fd.swim)
    renderFdHealth(fd && fd.health)
  }

  function fdMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">无' + esc(label) + '读数</div>'
    if (note) note.textContent = 'systems.failureDetector 缺失 —— 重跑 npm run console:data 采集真判词'
  }

  // 面板一主读数：抖动期误报（固定 vs φ）大数 + 两侧真故障检测延迟 + 六句判词里最要紧的一句。
  function renderFdHero(fd) {
    var hero = $('#fd-hero'), note = $('#fd-hero-note')
    if (!fd || !fd.fixed || !fd.phi) { fdMissing(hero, note, '故障检测'); return }
    var fp = isNum(fd.fixed.falsePositives) ? fd.fixed.falsePositives : 0
    var pp = isNum(fd.phi.falsePositives) ? fd.phi.falsePositives : 0
    hero.innerHTML =
      '<span class="big">' + esc(fmt(fp)) + '</span><span class="unit">次抖动误报 · 固定超时</span>' +
      '<span class="big jade">' + esc(fmt(pp)) + '</span><span class="unit">次 · φ 检测</span>' +
      '<span class="cap">真故障检出：固定 <b>' + esc(fmt(fd.fixed.detectionLatencyMs)) + 'ms</b> / φ <b>' +
      esc(fmt(fd.phi.detectionLatencyMs)) + 'ms</b><br>φ 阈值 ' + esc(fmt(fd.threshold, 1)) +
      ' · 固定窗 ' + esc(fmt(fd.fixedTimeoutMs)) + 'ms</span>'
    note.textContent = '同一条含 ' + esc(fmt((fd.curve || []).filter(function (p) { return p.label === 'jitter' }).length)) +
      ' 次 GC 长暂停与一次真故障的心跳轨迹。固定超时（' + esc(fmt(fd.fixedTimeoutMs)) + 'ms）在抖动期误剔除 ' +
      esc(fmt(fp)) + ' 次；φ 累积风险是连续量，抖动期误报 ' + esc(fmt(pp)) + ' 次、但真故障检出更慢（' +
      esc(fmt(fd.phi.detectionLatencyMs)) + 'ms vs ' + esc(fmt(fd.fixed.detectionLatencyMs)) +
      'ms）——如实保留这组权衡，不把 φ 吹成万能。全为结构计数，非墙钟/真网络。'
  }

  // φ 曲线：真 curve 逐点画折线（横=i、纵=φ），阈值虚线，固定超时误报点标酒红。
  function renderFdCurve(curve, fd) {
    var box = $('#fd-curve')
    if (!Array.isArray(curve) || !curve.length || !fd) { fdMissing(box, null, 'φ 曲线'); return }
    var W = 100, H = 90, padX = 4, padY = 8
    var thresh = isNum(fd.threshold) ? fd.threshold : 4
    var yMax = Math.max(thresh * 1.25, 5)
    var n = curve.length
    var xOf = function (i) { return padX + (n <= 1 ? 0 : i / (n - 1) * (W - 2 * padX)) }
    var yOf = function (v) { return H - padY - Math.max(0, Math.min(yMax, isNum(v) ? v : 0)) / yMax * (H - 2 * padY) }
    var pts = curve.map(function (p, i) { return xOf(i).toFixed(2) + ',' + yOf(p.phi).toFixed(2) }).join(' ')
    var threshY = yOf(thresh).toFixed(2)
    var fps = curve.filter(function (p, i) { return p.fixedSuspect && p.label !== 'fault' })
    var dots = fps.map(function (p) {
      var i = curve.indexOf(p)
      return '<circle class="fp-dot" cx="' + xOf(i).toFixed(2) + '" cy="' + yOf(p.phi).toFixed(2) + '" r="1.6"/>'
    }).join('')
    box.innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="φ 累积风险曲线">' +
      '<line class="axis" x1="0" y1="' + (H - padY) + '" x2="' + W + '" y2="' + (H - padY) + '"/>' +
      '<line class="thresh" x1="0" y1="' + threshY + '" x2="' + W + '" y2="' + threshY + '"/>' +
      '<text class="thresh-lbl" x="1" y="' + (Number(threshY) - 1.5) + '">φ=' + esc(fmt(thresh, 1)) + ' 判死线</text>' +
      '<polyline class="phi-line" points="' + esc(pts) + '"/>' + dots +
      '</svg>' +
      '<div class="fd-curve-legend"><span><i class="k-phi"></i>φ 疑难度（' + esc(fmt(n)) + ' 点真值）</span>' +
      '<span><i class="k-fp"></i>固定超时误报点 ' + esc(fmt(fps.length)) + '</span>' +
      '<span><i class="k-th"></i>φ 判死阈值</span></div>'
  }

  // 自适应对照：同一段延迟，规律历史 φ 高（严）、抖动历史 φ 低（宽容）——固定超时做不到看上下文。
  function renderFdAdapt(a) {
    var box = $('#fd-adapt')
    if (!a || !isNum(a.steadyPhi) || !isNum(a.jitteryPhi)) { fdMissing(box, null, '自适应对照'); return }
    var max = Math.max(a.steadyPhi, a.jitteryPhi, 0.01)
    var row = function (cls, label, v, hint) {
      var w = Math.round(v / max * 100)
      return '<div class="fd-adapt-row"><span class="lab">' + esc(label) + '<small style="display:block;color:var(--muted);font-size:9px">' + esc(hint) + '</small></span>' +
        '<span class="track"><i class="fill ' + cls + '" style="width:' + w + '%" data-w="' + w + '"></i></span>' +
        '<span class="num">' + esc(fmt(v, 2)) + '</span></div>'
    }
    box.innerHTML = '<div class="title">同一段 ' + esc(fmt(a.delayMs)) + 'ms 延迟 · 不同心跳历史下的 φ</div>' +
      row('steady', '规律历史', a.steadyPhi, 'σ≈' + fmt(a.steadyStddev, 0) + ' → 更警觉') +
      row('jittery', '抖动历史', a.jitteryPhi, 'σ≈' + fmt(a.jitteryStddev, 0) + ' → 更宽容')
  }

  // 面板二：SWIM 三态成员条（每节点一个色块按状态）+ 计数 + 间接探测/确认读数。
  function renderFdSwim(sw) {
    var box = $('#fd-swim')
    if (!sw || !sw.counts || !Array.isArray(sw.members)) { fdMissing(box, $('#fd-swim-note'), 'SWIM 成员'); return }
    var c = sw.counts
    var rows = sw.members.map(function (m) {
      var cls = m.state === 'alive' ? 'alive' : (m.state === 'suspected' ? 'suspected' : 'faulty')
      return '<div class="fd-swim-row"><span class="mid">' + esc(m.id) + '</span>' +
        '<span class="bar"><i class="' + cls + '" data-state="' + esc(m.state) + '"></i></span>' +
        '<span class="inc">inc ' + esc(fmt(m.incarnation)) + ' · ' + esc(m.state) + '</span></div>'
    }).join('')
    box.innerHTML = rows +
      '<div class="fd-swim-counts">' +
      '<span class="c-alive">alive <b>' + esc(fmt(c.alive)) + '</b></span>' +
      '<span class="c-suspected">suspected <b>' + esc(fmt(c.suspected)) + '</b></span>' +
      '<span class="c-faulty">faulty <b>' + esc(fmt(c.faulty)) + '</b></span>' +
      '<span>间接救回 <b>' + esc(fmt(sw.indirectRescues)) + '</b></span>' +
      '<span>确认死亡 <b>' + esc(fmt(sw.confirmations)) + '</b></span>' +
      '<span>怀疑超时 <b>' + esc(fmt(sw.suspicionTimeoutMs)) + 'ms</b></span></div>'
    var s = sw.script || {}
    var note = $('#fd-swim-note')
    if (note) note.textContent = 'SWIM 三态：直接 ping 失败后请中继代探，任一 ACK 即反证存活（间接救回 ' +
      esc(fmt(sw.indirectRescues)) + ' 次）；suspected 撑过 ' + esc(fmt(sw.suspicionTimeoutMs)) +
      'ms 疑超时才被 reap 确认死亡。脚本真跑：direct 存活 ' + (s.directAlive ? '✓' : '✗') +
      ' / 间接救回 ' + (s.indirectRescued ? '✓' : '✗') + ' / 全失败标疑 ' + (s.suspectAfterTotalFailure ? '✓' : '✗') +
      ' / incarnation 反证 ' + (s.gossipRefuted ? '✓' : '✗') + '。纯进程内、无 UDP gossip。'
  }

  // 健康视图：alive 且 φ 未越阈的实例列表 + TTL 缓存首算/命中/失效三段读数。
  function renderFdHealth(h) {
    var box = $('#fd-health')
    if (!h || !Array.isArray(h.nodes)) { fdMissing(box, null, '健康视图'); return }
    var nodes = h.nodes.map(function (x) { return '<b>' + esc(x) + '</b>' }).join(' · ') || '—'
    var excl = (h.excluded || []).map(function (x) { return '<span class="excl">' + esc(x) + '</span>' }).join(' · ') || '—'
    var dot = function (hit, cls, label) {
      return '<span><i class="dot ' + cls + '"></i>' + esc(label) + ' ' + (hit ? '命中' : '未命中') + '</span>'
    }
    box.innerHTML = '<div class="title">负载均衡可读的健康实例（φ + SWIM 收敛 · TTL 缓存）</div>' +
      '<div class="nodes">健康 ' + nodes + '　<span class="excl">剔除 ' + excl + '</span></div>' +
      '<div class="cache-row">' +
      dot(h.firstFromCache === false, 'miss', '首算') +
      dot(h.secondFromCache === true, 'hit', 'TTL 二次读') +
      '<span><i class="dot inv"></i>' + esc(fmt(h.invalidations)) + ' 次主动失效</span>' +
      '<span>命中率 ' + esc(fmt(h.hitRate == null ? null : h.hitRate * 100, 0)) + '%</span>' +
      '<span>TTL ' + esc(fmt(h.ttlMs)) + 'ms</span></div>'
  }

  /* ---------- KI-504 B+ 树索引：真 B+ 树层高/扇出/叶链 vs LSM 三笔账诚实对照 ----------
   * 只读 systems.bplusIndex（node 侧真结构计数），前端不判定、不复核、不实测。
   * 缺字段 ⇒ 诚实降级、不画假条；三笔账 favors 各按其真读数上色，不封全局赢家。 */
  function renderBplus(bp) {
    renderBpStructure(bp && bp.structure)
    renderBpLadder(bp && bp.structure && bp.structure.heightLadder)
    renderBpCompare(bp)
    renderBpAgreement(bp && bp.agreement, bp && bp.verdict)
  }

  function bpMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">无' + esc(label) + '读数</div>'
    if (note) note.textContent = 'systems.bplusIndex 缺失 —— 重跑 npm run console:data 采集真判词'
  }

  // 面板一主读数：实测层高（+ 教学估计）/ 扇出 / 叶子数 / 不变式违例数（0 = 真 B+ 树）。
  function renderBpStructure(st) {
    var box = $('#bp-structure'), note = $('#bp-structure-note')
    if (!st || !isNum(st.height) || !isNum(st.fanout)) { bpMissing(box, note, 'B+ 树结构'); return }
    var ok = st.invariants === 0
    box.innerHTML =
      '<div class="bp-hero">' +
      '<span class="big" data-h="' + esc(fmt(st.height)) + '">' + esc(fmt(st.height)) + '</span><span class="unit">层实测高</span>' +
      '<span class="big gold" data-est="' + esc(fmt(st.heightEstimate)) + '">' + esc(fmt(st.heightEstimate)) + '</span><span class="unit">层稳态估</span>' +
      '<span class="big jade" data-leaves="' + esc(fmt(st.leafCount)) + '">' + esc(fmt(st.leafCount)) + '</span><span class="unit">叶节点</span>' +
      '<span class="cap">扇出 <b>' + esc(fmt(st.fanout)) + '</b> · 阶 ' + esc(fmt(st.order)) +
      ' · 节点 <b>' + esc(fmt(st.nodeCount)) + '</b><br>不变式违例 <b class="' + (ok ? 'jade-t' : 'wine-t') + '">' +
      esc(fmt(st.invariants)) + '</b> ' + (ok ? '✓ 真 B+ 树' : '✗ 结构异常') + '</span></div>'
    note.textContent = '数据只住叶子、叶子用双向链串起；内节点只存分隔键与孩子指针，扇出 ' + esc(fmt(st.fanout)) +
      ' 决定层高（越矮胖、点查访问的节点越少）。「稳态估」按 mid 分裂半填充算，与实测并排、差 ±1 属正常；' +
      '不变式校验钉住「所有叶同深 / 分隔键=右孩最小 / 叶链双向 / 全局递增」。纯进程内、无真磁盘页与缓冲池。'
  }

  // 层高阶梯：order 越大扇出越高、层高不增（真数学估计，非画假线）。
  function renderBpLadder(ladder) {
    var box = $('#bp-ladder')
    if (!Array.isArray(ladder) || !ladder.length) { bpMissing(box, null, '层高阶梯'); return }
    var max = Math.max.apply(null, ladder.map(function (r) { return isNum(r.heightEstimate) ? r.heightEstimate : 0 }).concat([1]))
    var rows = ladder.map(function (r) {
      var w = Math.round((isNum(r.heightEstimate) ? r.heightEstimate : 0) / max * 100)
      return '<div class="bp-ladder-row" data-order="' + esc(fmt(r.order)) + '" data-h="' + esc(fmt(r.heightEstimate)) + '">' +
        '<span class="lab">阶 ' + esc(fmt(r.order)) + ' <small>扇出 ' + esc(fmt(r.fanout)) + '</small></span>' +
        '<span class="track"><i class="fill" style="width:' + w + '%" data-w="' + w + '"></i></span>' +
        '<span class="num">' + esc(fmt(r.heightEstimate)) + ' 层</span></div>'
    }).join('')
    box.innerHTML = '<div class="title">同一批 key · 阶数（扇出）越大层高不增</div>' + rows
  }

  // 三笔账：点查比较数 / 范围结构代价 / 写放大模型。只画两侧真计数 + favors 上色，不封全局赢家。
  function renderBpCompare(bp) {
    var box = $('#bp-compare'), note = $('#bp-compare-note')
    if (!bp || !bp.point || !bp.range || !bp.write) { bpMissing(box, note, '三笔账对照'); return }
    var favorsCls = function (f) { return f === 'bplus' ? 'bplus' : (f === 'lsm' ? 'lsm' : 'tie') }
    var favorsTxt = function (f) { return f === 'bplus' ? 'B+ 更省' : (f === 'lsm' ? 'LSM 更省' : '持平') }
    var pair = function (key, label, bv, lv, favors, unit) {
      var b = isNum(bv) ? bv : 0, l = isNum(lv) ? lv : 0
      var m = Math.max(b, l, 1)
      var bw = Math.round(b / m * 100), lw = Math.round(l / m * 100)
      return '<div class="bp-pair" data-key="' + esc(key) + '" data-favors="' + esc(favors) + '">' +
        '<div class="bp-pair-head"><span class="lab">' + esc(label) + '</span>' +
        '<span class="favors ' + favorsCls(favors) + '">' + esc(favorsTxt(favors)) + '</span></div>' +
        '<div class="bp-bar"><span class="tag">B+</span><span class="track"><i class="fill bplus" style="width:' + bw + '%" data-w="' + bw + '"></i></span><span class="num">' + esc(fmt(bv)) + '</span></div>' +
        '<div class="bp-bar"><span class="tag">LSM</span><span class="track"><i class="fill lsm" style="width:' + lw + '%" data-w="' + lw + '"></i></span><span class="num">' + esc(fmt(lv)) + '</span></div>' +
        (unit ? '<div class="bp-unit">' + esc(unit) + '</div>' : '') + '</div>'
    }
    var v = bp.verdict || {}
    box.innerHTML =
      pair('point', '点查 · 比较数', bp.point.bplusComparisons, bp.point.lsmComparisons, bp.point.favors,
        'B+ 层高二分 vs LSM memtable 跳表 + 多层 SSTable 稀疏索引 + Bloom 负查') +
      pair('range', '范围查 · 结构代价', bp.range.bplusCost, bp.range.lsmCost, bp.range.favors,
        'B+ 沿叶链顺序扫（叶跳 ' + fmt(bp.range.bplusLeafHops) + '）vs LSM 跨 ' + fmt(bp.range.lsmSegments) +
        ' 段收集 + 全量排序（' + fmt(bp.range.lsmSortComparisons) + ' 比较）') +
      pair('write', '写放大 · 模型', bp.write.bplusPageRewrites, bp.write.lsmSeqWriteUnits, bp.write.favors,
        'B+ 原地改页重排（分裂 ' + fmt(bp.write.bplusSplits) + ' / 并 ' + fmt(bp.write.bplusMerges) +
        ' / 借 ' + fmt(bp.write.bplusBorrows) + '）vs LSM 顺序追加 + compaction（归 ' + fmt(bp.write.lsmMergedAway) + '）') +
      '<div class="bp-verdict">' +
      '<span class="' + (v.noUniversalWinner ? 'jade-t' : 'muted-t') + '">' + (v.noUniversalWinner ? '✓ 三维未归一引擎全拿' : '本配置下三维同向（换 order/段数会翻）') + '</span>' +
      '<span>B+ 顺序扫 ' + (v.bplusRangeIsSequential ? '✓' : '✗') + ' · LSM 归并排序 ' + (v.lsmRangeNeedsMergeSort ? '✓' : '✗') + '</span></div>'
    note.textContent = '三笔账都是结构计数模型（比较数 / 叶跳 / 分裂归并次数 / 顺序写单元），非墙钟 QPS、' +
      '字节吞吐或真实引擎跑分；两件都是教学实现（LSM 范围查是收集排序非归并堆）。判词如实给「B+ 点查/范围查稳但写原地改页、' +
      'LSM 顺序写适配 SSD 但读跨层/范围全量归并/compaction 重复搬运」，不封全局赢家、结论随 key 分布/阶数/段数变。'
  }

  // 正确性对账：两引擎在同批 key 上的 get/range 逐条一致——这是性能对照成立的前提。
  function renderBpAgreement(ag, verdict) {
    var box = $('#bp-agreement')
    if (!ag || !isNum(ag.pointMismatches) || !isNum(ag.rangeMismatches)) { bpMissing(box, null, '正确性对账'); return }
    var ok = ag.bothAgree === true
    box.innerHTML = '<div class="bp-agree-row" data-agree="' + (ok ? 'true' : 'false') + '">' +
      '<i class="dot ' + (ok ? 'hit' : 'miss') + '"></i>' +
      '<span class="lab">同批 key 答案逐条对账</span>' +
      '<span class="num">点查分叉 <b>' + esc(fmt(ag.pointMismatches)) + '</b> · 范围分叉 <b>' + esc(fmt(ag.rangeMismatches)) + '</b></span>' +
      '<span class="stamp ' + (ok ? 'jade-t' : 'wine-t') + '">' + (ok ? '✓ 一致 · 对照成立' : '✗ 分叉 · 性能读数不作数') + '</span></div>'
  }

  // ---------------- KI-505 事务与并发控制：隔离矩阵 + MVCC 版本链/死锁 ----------------
  function renderMvcc(mv) {
    renderMvMatrix(mv && mv.levels, mv && mv.config, mv && mv.verdict)
    renderMvDeadlock(mv && mv.deadlock, mv && mv.twoPhaseLock)
    renderMvGc(mv && mv.gc)
  }

  function mvMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">无' + esc(label) + '读数</div>'
    if (note) note.textContent = 'systems.mvccTxn 缺失 —— 重跑 npm run console:data 采集真判词'
  }

  // 面板一：五档隔离 × 五类异常热力矩阵。挡住（prevented）染玉，异常真出现（observed）染酒红。
  function renderMvMatrix(levels, config, verdict) {
    var box = $('#mv-matrix'), note = $('#mv-matrix-note'), aborts = $('#mv-abort')
    if (!Array.isArray(levels) || !levels.length || !config || !Array.isArray(config.anomalies)) {
      mvMissing(box, note, '隔离异常矩阵'); if (aborts) aborts.innerHTML = ''; return
    }
    var anomalies = config.anomalies
    var head = '<div class="mv-matrix-head"><span class="mv-lvl">隔离级别</span>' +
      anomalies.map(function (a) { return '<span class="mv-cell">' + esc(shortAnomaly(a)) + '</span>' }).join('') +
      '<span class="mv-rowstat">中止</span></div>'
    var rows = levels.map(function (l) {
      var cells = anomalies.map(function (a) {
        var cell = l.anomalies && l.anomalies[a]
        if (!cell || typeof cell.observed !== 'boolean') {
          return '<span class="mv-cell" data-a="' + esc(a) + '" data-state="na">—</span>'
        }
        // observed=true ⇒ 该异常在本隔离档真出现 ⇒ 漏掉（酒红）；prevented ⇒ 挡住（玉）
        var leaked = cell.observed === true
        return '<span class="mv-cell ' + (leaked ? 'leaked' : 'blocked') + '" data-a="' + esc(a) +
          '" data-state="' + (leaked ? 'leaked' : 'blocked') + '" title="' + esc(cell.label || a) +
          (leaked ? '：真出现' : '：已挡住') + '">' + (leaked ? '漏' : '挡') + '</span>'
      }).join('')
      return '<div class="mv-matrix-row" data-lvl="' + esc(l.short) + '">' +
        '<span class="mv-lvl">' + esc(l.short) + '<small>' + esc(l.label || '') + '</small></span>' +
        cells +
        '<span class="mv-rowstat"><b>' + esc(fmt(l.aborted)) + '</b></span></div>'
    }).join('')
    box.innerHTML = head + rows
    // 中止率阶梯 chip：隔离越强中止越多（诚实代价），escalates 标最后两档
    var maxAbort = Math.max.apply(null, levels.map(function (l) { return isNum(l.aborted) ? l.aborted : 0 }).concat([1]))
    var chips = levels.map(function (l, i) {
      var esc3 = isNum(l.aborted) ? Math.round(l.aborted / maxAbort * 100) : 0
      var climbing = i > 0 && isNum(l.aborted) && l.aborted > levels[i - 1].aborted
      return '<span class="chip' + (climbing ? ' escalates' : '') + '" data-lvl="' + esc(l.short) +
        '" data-abort="' + esc(fmt(l.aborted)) + '">' + esc(l.short) + ' <b>' + esc(fmt(l.aborted)) +
        '</b> 止<i style="display:inline-block;width:' + esc3 + 'px;height:4px;background:var(--wine);margin-left:4px"></i></span>'
    }).join('')
    var v = verdict || {}
    var noWin = v.noUniversalWinner === true
    aborts.innerHTML = chips + '<span class="chip ' + (noWin ? 'jade-t' : 'muted-t') + '" data-verdict="noUniversalWinner">' +
      (noWin ? '✓ 不封 Serializable 全局赢家' : '本配置下归一（换调度会翻）') + '</span>'
    note.textContent = '同一组确定性并发调度（脏读/不可重复读/幻读/丢失更新/写偏斜）分喂五档隔离，' +
      '每格是「该异常在此档有没有真出现」的结构判词：玉=挡住、酒红=漏掉。关键阶梯——SI 挡住前四类' +
      '却**漏写偏斜**、Serializable 全挡但中止最多。中止数是被 first-committer-wins / SSI 反依赖检测' +
      '回滚的事务数，是确定性调度上的结构计数、非墙钟吞吐；换成别的调度结论会变，不封全局赢家。'
  }

  // 异常 id → 短标签（矩阵表头窄，用两字）。
  function shortAnomaly(id) {
    return ({ dirtyRead: '脏读', nonRepeatableRead: '不可重复', phantom: '幻读', lostUpdate: '丢失更新', writeSkew: '写偏斜' })[id] || id
  }

  // 面板二上半：wait-for graph 死锁环（节点链）+ 牺牲者 + 2PL + 无环探针。
  function renderMvDeadlock(dl, twoPhase) {
    var box = $('#mv-deadlock'), note = $('#mv-deadlock-note')
    if (!dl || typeof dl.detected !== 'boolean') { mvMissing(box, note, '死锁检测'); return }
    var cycle = Array.isArray(dl.cycle) ? dl.cycle : []
    var victim = dl.victim
    var graph = cycle.length
      ? cycle.map(function (t, i) {
          return '<span class="mv-node' + (t === victim ? ' victim' : '') + '" data-txn="' + esc(t) + '">' + esc(t) +
            (t === victim ? ' · 牺牲' : '') + '</span>' +
            '<span class="mv-arrow">→</span>' +
            '<span class="mv-node' + (cycle[(i + 1) % cycle.length] === victim ? ' victim' : '') + '">' + esc(cycle[(i + 1) % cycle.length]) + '</span>' +
            (i < cycle.length - 1 ? '<span class="mv-arrow">↔</span>' : '')
        }).join('')
      : '<span class="mv-node">无环</span>'
    var resolved = dl.resolved === true
    var probe = dl.acyclicProbeNoCycle === true
    var tpl = twoPhase && twoPhase.lateAcquireBlocked === true
    box.innerHTML =
      '<div class="mv-dl-graph" data-detected="' + (dl.detected ? 'true' : 'false') + '">' + graph + '</div>' +
      '<div class="mv-dl-line">wait-for graph DFS 找环 <b class="' + (dl.detected ? 'wine-t' : 'jade-t') + '">' +
      (dl.detected ? '检出环' : '无环') + '</b> → 牺牲 <b>' + esc(victim || '—') + '</b> → ' +
      '<b class="' + (resolved ? 'ok' : 'bad') + '">' + (resolved ? '已放锁解开' : '未解开') + '</b></div>' +
      '<div class="mv-dl-line">无环探针（非恒真） ' + (probe ? '<b class="ok">✓ 无环图如实报无环</b>' : '<b class="bad">✗ 误报环</b>') +
      ' · 两阶段锁 shrinking 后申请 ' + (tpl ? '<b class="ok">✓ 判 2PL 违规</b>' : '<b class="bad">✗ 未拦</b>') + '</div>'
    note.textContent = 'MVCC 版本链按「已提交且 commitTs≤快照读 ts、或自己未提交版本对己可见、tombstone 表删除」' +
      '取对某快照可见的最新版；本件只跑进程内 wait-for graph 的 DFS 三色环检测，检出后按 youngest/min-locks ' +
      '选牺牲者中止放锁、自动重解被阻塞的请求并复检环已破。无环探针专钉「DFS 不是恒真报有环」。' +
      '不接真分布式锁、无跨进程等待边、不实现写者优先/公平排队（写饥饿是教学边界）。'
  }

  // 面板二下半：gc 水位对照（长事务拖住 gc ⇒ 保留更多旧版本）。
  function renderMvGc(gc) {
    var box = $('#mv-gc')
    if (!gc || !isNum(gc.versions)) { mvMissing(box, null, 'gc 水位'); return }
    var long = gc.longWaterMark || {}, clean = gc.cleanWaterMark || {}
    box.innerHTML =
      '<div class="pair" data-wm="long"><div class="k">长事务 · 低水位 ' + esc(fmt(long.waterMarkTs)) + '</div>' +
      '<div class="v">' + esc(fmt(long.kept)) + '<small> 版留存 / 回收 ' + esc(fmt(long.removed)) + '</small></div></div>' +
      '<div class="pair" data-wm="clean"><div class="k">无长事务 · 高水位 ' + esc(fmt(clean.waterMarkTs)) + '</div>' +
      '<div class="v">' + esc(fmt(clean.kept)) + '<small> 版留存 / 回收 ' + esc(fmt(clean.removed)) + '</small></div></div>'
  }

  // ---------------- KI-506 分布式事务：三协议 × 六场景矩阵 + 三难不可兼得 ----------------
  function renderDistributedTxn(dt) {
    renderDtMatrix(dt && dt.rows, dt && dt.config, dt && dt.verdict)
    renderDtLadder(dt && dt.rows)
    renderDtTrilemma(dt && dt.rows, dt && dt.verdict, dt && dt.sagaOrder, dt && dt.tccRetry)
  }

  function dtMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">无' + esc(label) + '读数</div>'
    if (note) note.textContent = 'systems.distributedTxn 缺失 —— 重跑 npm run console:data 采集真判词'
  }

  // 每格读 Node 侧真判词：成=提交 / 止=中止 / 阻=阻塞 / 脏=留脏；侵入度作行尾代价。
  function dtState(s) {
    if (!s) return { cls: '', ch: '—' }
    if (s.committed) return { cls: 'ok', ch: '成' }
    if (isNum(s.blocked) && s.blocked > 0) return { cls: 'blocked', ch: '阻' }
    if (isNum(s.dirty) && s.dirty > 0) return { cls: 'dirty', ch: '脏' }
    if (s.aborted) return { cls: 'stopped', ch: '止' }
    return { cls: '', ch: '—' }
  }

  // 面板一上半：三协议 × 六场景矩阵（格内真判词，不复核）。
  function renderDtMatrix(rows, config, verdict) {
    var box = $('#dt-matrix'), note = $('#dt-matrix-note')
    if (!Array.isArray(rows) || !rows.length || !config || !Array.isArray(config.scenarios)) {
      dtMissing(box, note, '三协议场景矩阵'); return
    }
    var scenarios = config.scenarios
    var head = '<div class="dt-mat-row dt-mat-head"><span class="dt-mat-proto">协议</span>' +
      scenarios.map(function (s) { return '<span class="dt-sc" title="' + esc(s.label) + '">' + esc(s.id) + '</span>' }).join('') +
      '<span class="dt-mat-cost">侵入</span></div>'
    var body = rows.map(function (row) {
      var cells = scenarios.map(function (s) {
        var cell = Array.isArray(row.scenarios) ? row.scenarios.find(function (x) { return x.id === s.id }) : null
        var st = dtState(cell)
        return '<span class="dt-cell ' + st.cls + '" data-p="' + esc(row.protocol) + '" data-s="' + esc(s.id) +
          '" data-state="' + (st.cls || 'na') + '" title="' + esc(s.label) + '">' + st.ch + '</span>'
      }).join('')
      return '<div class="dt-mat-row" data-p="' + esc(row.protocol) + '">' +
        '<span class="dt-mat-proto">' + esc(row.protocol) + '<small>' + esc(row.label || '') + '</small></span>' +
        cells + '<span class="dt-mat-cost"><b>' + esc(fmt(row.intrusion)) + '</b></span></div>'
    }).join('')
    box.innerHTML = head + body
    if (note) note.textContent = '同一组确定性故障场景（全成功 / 单点 no / 协调者 prepare 后宕机 / 第 k 步失败 / ' +
      '补偿再失败 / Confirm 半途失败）分喂三协议，每格是 Node 侧真判词：成=全局提交、止=中止、' +
      '阻=参与者卡在 prepared 持锁阻塞、脏=补偿失败留脏。侵入度是每服务要写的接口数结构计数' +
      '（2PC XA 托管最低 / Saga 正反两套 / TCC Try·Confirm·Cancel 三套最重），非真实代码量。'
  }

  // 面板一下半：消息数横条对照（结构计数，不封谁省谁优）。
  function renderDtLadder(rows) {
    var box = $('#dt-ladder')
    if (!box || !Array.isArray(rows) || !rows.length) { if (box) box.innerHTML = ''; return }
    var max = Math.max.apply(null, rows.map(function (r) { return r.totals && isNum(r.totals.messages) ? r.totals.messages : 0 }).concat([1]))
    box.innerHTML = rows.map(function (r) {
      var t = r.totals || {}
      var w = isNum(t.messages) ? Math.round(t.messages / max * 100) : 0
      var blocked = isNum(t.blocked) ? t.blocked : 0
      var dirty = isNum(t.dirty) ? t.dirty : 0
      return '<div class="dt-line" data-p="' + esc(r.protocol) + '"><span class="tag">' + esc(r.protocol) + '</span>' +
        '<span class="dt-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="num">消息 ' + esc(fmt(t.messages)) + ' · 阻' + esc(fmt(blocked)) + ' · 脏' + esc(fmt(dirty)) + '</span></div>'
    }).join('')
  }

  // 面板二：三难向量（不阻塞/不留脏/侵入最低，玉=占、酒红=缺）+ 判词探针 + 不封赢家 dot。
  function renderDtTrilemma(rows, verdict, sagaOrder, tccRetry) {
    var box = $('#dt-trilemma'), probes = $('#dt-probes'), note = $('#dt-trilemma-note')
    if (!Array.isArray(rows) || !rows.length) { dtMissing(box, note, '三难判据'); if (probes) probes.innerHTML = ''; return }
    var flags = [['noBlock', '不阻塞'], ['noDirty', '不留脏'], ['lowIntrusion', '侵入最低']]
    var head = '<div class="dt-vec dt-vec-head"><span class="proto">协议</span>' +
      flags.map(function (f) { return '<span>' + f[1] + '</span>' }).join('') + '</div>'
    var body = rows.map(function (r) {
      var t = r.trilemma || {}
      var cells = flags.map(function (f) {
        var yes = t[f[0]] === true
        return '<span class="dt-flag ' + (yes ? 'yes' : 'no') + '" data-p="' + esc(r.protocol) + '" data-k="' + f[0] +
          '" data-v="' + (yes ? '1' : '0') + '">' + (yes ? '✓' : '✗') + '</span>'
      }).join('')
      return '<div class="dt-vec" data-p="' + esc(r.protocol) + '"><span class="proto">' + esc(r.protocol) + '</span>' + cells + '</div>'
    }).join('')
    box.innerHTML = head + body
    var v = verdict || {}
    var noWin = v.noUniversalWinner === true
    var chips = [
      '<span class="chip" data-probe="twoPcBlocks"><b>2PC</b> 协调者宕机 ' + (v.twoPcBlocksOnCoordinatorDown ? '全员阻塞' : '未阻塞') + '</span>',
      '<span class="chip" data-probe="sagaDirty"><b>Saga</b> 补偿失败 ' + (v.sagaLeaksDirtyOnCompensateFail ? '留脏' : '无脏') + '</span>',
      '<span class="chip" data-probe="tccRetry"><b>TCC</b> Confirm 幂等重试 ' + esc(fmt(tccRetry && tccRetry.retries)) + ' 次</span>',
      '<span class="chip" data-probe="sagaReverse"><b>Saga</b> 逆序补偿 ' + (sagaOrder && sagaOrder.reverseOrder ? '✓' : '✗') + '</span>',
      '<span class="chip ' + (noWin ? 'jade-t' : 'muted-t') + '" data-verdict="noUniversalWinner">' +
        (noWin ? '✓ 不封任何协议全局赢家' : '本配置下归一（换场景会翻）') + '</span>',
    ]
    if (probes) probes.innerHTML = chips.join('')
    if (note) note.textContent = '三难 = 不阻塞 ∧ 不留脏 ∧ 侵入最低。真实向量三条互不相同、没有一条三个全占：' +
      '2PC 缺「不阻塞」（协调者 prepare 后宕机、参与者不可自愈地持锁等待），Saga 缺「不留脏」且侵入非最低' +
      '（补偿是业务反向操作、可能失败甚至不可逆），TCC 缺「侵入最低」（Try/Confirm/Cancel 三套接口换无隔夜脏 + 幂等自愈）。' +
      '全为确定性故障场景上的结构计数、非墙钟/吞吐/真数据库一致性；换场景或故障点结论会变，不封赢家。'
  }

  // ---------------- KI-507 Raft 共识：三协议 × 六场景矩阵 + 三难不可兼得 ----------------
  function renderRaftConsensus(rc) {
    renderRcMatrix(rc && rc.rows, rc && rc.config)
    renderRcLadder(rc && rc.rows)
    renderRcTrilemma(rc && rc.rows, rc && rc.verdict, rc && rc.election, rc && rc.replication, rc && rc.gossip)
  }

  function rcMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">无' + esc(label) + '读数</div>'
    if (note) note.textContent = 'systems.raftConsensus 缺失 —— 重跑 npm run console:data 采集真判词'
  }

  // 每格读 Node 侧真判词：成=落地 / 阻=拒写 / 陈=读陈值 / 冲=写冲突 / 散=未收敛（不复核）。
  function rcState(s) {
    if (!s) return { cls: '', ch: '—' }
    if (isNum(s.blockedWrites) && s.blockedWrites > 0) return { cls: 'denied', ch: '阻' }
    if (s.converged === false) return { cls: 'diverged', ch: '散' }
    if (isNum(s.staleReads) && s.staleReads > 0) return { cls: 'stale', ch: '陈' }
    if (isNum(s.conflicts) && s.conflicts > 0) return { cls: 'conflict', ch: '冲' }
    if (s.committed) return { cls: 'ok', ch: '成' }
    return { cls: '', ch: '—' }
  }

  function renderRcMatrix(rows, config) {
    var box = $('#rc-matrix'), note = $('#rc-matrix-note')
    if (!Array.isArray(rows) || !rows.length || !config || !Array.isArray(config.scenarios)) {
      rcMissing(box, note, '三协议场景矩阵'); return
    }
    var scenarios = config.scenarios
    var head = '<div class="rc-mat-row rc-mat-head"><span class="rc-mat-proto">协议</span>' +
      scenarios.map(function (s) { return '<span class="rc-sc" title="' + esc(s.label) + '">' + esc(s.id) + '</span>' }).join('') +
      '<span class="rc-mat-cost">消息</span></div>'
    var body = rows.map(function (row) {
      var cells = scenarios.map(function (s) {
        var cell = Array.isArray(row.scenarios) ? row.scenarios.find(function (x) { return x.id === s.id }) : null
        var st = rcState(cell)
        return '<span class="rc-cell ' + st.cls + '" data-p="' + esc(row.protocol) + '" data-s="' + esc(s.id) +
          '" data-state="' + (st.cls || 'na') + '" title="' + esc(s.label) + '">' + st.ch + '</span>'
      }).join('')
      var t = row.totals || {}
      return '<div class="rc-mat-row" data-p="' + esc(row.protocol) + '">' +
        '<span class="rc-mat-proto">' + esc(row.protocol) + '<small>' + esc(row.label || '') + '</small></span>' +
        cells + '<span class="rc-mat-cost"><b>' + esc(fmt(t.messages)) + '</b></span></div>'
    }).join('')
    box.innerHTML = head + body
    if (note) note.textContent = '同一组确定性故障场景（全成功 / leader 宕机选主 / 网络分区少数派 / ' +
      '两主并发写冲突 / 异步复制延迟读陈值 / 反熵间隙读陈值）分喂三协议，每格是 Node 侧真判词：' +
      '成=写落地、阻=凑不齐 quorum 或选主空窗拒写、陈=复制延迟读到落后状态、冲=并发写同 key 需合并、' +
      '散=反熵间隙结束仍未收敛。消息数是结构计数、非墙钟/带宽；不封任何协议全局赢家。'
  }

  function renderRcLadder(rows) {
    var box = $('#rc-ladder')
    if (!box || !Array.isArray(rows) || !rows.length) { if (box) box.innerHTML = ''; return }
    var max = Math.max.apply(null, rows.map(function (r) { return r.totals && isNum(r.totals.messages) ? r.totals.messages : 0 }).concat([1]))
    box.innerHTML = rows.map(function (r) {
      var t = r.totals || {}
      var w = isNum(t.messages) ? Math.round(t.messages / max * 100) : 0
      var blocked = isNum(t.blockedWrites) ? t.blockedWrites : 0
      var stale = isNum(t.staleReads) ? t.staleReads : 0
      var conflicts = isNum(t.conflicts) ? t.conflicts : 0
      return '<div class="rc-line" data-p="' + esc(r.protocol) + '"><span class="tag">' + esc(r.protocol) + '</span>' +
        '<span class="rc-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="num">阻' + esc(fmt(blocked)) + ' · 陈' + esc(fmt(stale)) + ' · 冲' + esc(fmt(conflicts)) + '</span></div>'
    }).join('')
  }

  function renderRcTrilemma(rows, verdict, election, replication, gossip) {
    var box = $('#rc-trilemma'), probes = $('#rc-probes'), note = $('#rc-trilemma-note')
    if (!Array.isArray(rows) || !rows.length) { rcMissing(box, note, '三难判据'); if (probes) probes.innerHTML = ''; return }
    var flags = [['linearizable', '线性一致'], ['partitionAvailable', '分区可用'], ['boundedConvergence', '确定收敛']]
    var head = '<div class="rc-vec rc-vec-head"><span class="proto">协议</span>' +
      flags.map(function (f) { return '<span>' + f[1] + '</span>' }).join('') + '</div>'
    var body = rows.map(function (r) {
      var t = r.trilemma || {}
      var cells = flags.map(function (f) {
        var yes = t[f[0]] === true
        return '<span class="rc-flag ' + (yes ? 'yes' : 'no') + '" data-p="' + esc(r.protocol) + '" data-k="' + f[0] +
          '" data-v="' + (yes ? '1' : '0') + '">' + (yes ? '✓' : '✗') + '</span>'
      }).join('')
      return '<div class="rc-vec" data-p="' + esc(r.protocol) + '"><span class="proto">' + esc(r.protocol) + '</span>' + cells + '</div>'
    }).join('')
    box.innerHTML = head + body
    var v = verdict || {}
    var noWin = v.noUniversalWinner === true
    var chips = [
      '<span class="chip" data-probe="raftBlocks"><b>Raft</b> 选主/分区 ' + (v.raftBlocksOnPartition && v.raftBlocksOnLeaderElection ? '均拒写(CP)' : '未拒写') + '</span>',
      '<span class="chip" data-probe="raftElection"><b>Raft</b> 随机超时破平票 ' + (election && election.resolvedByTimeout ? '✓' : '✗') + ' · term 单调 ' + (election && election.termMonotonic ? '✓' : '✗') + '</span>',
      '<span class="chip" data-probe="raftSafety"><b>Raft</b> 脑裂旧主只读 ' + (replication && replication.staleLeaderRejected ? '✓' : '✗') + ' · nextIndex 回退 ' + (replication && replication.nextIndexRetried ? '✓' : '✗') + '</span>',
      '<span class="chip" data-probe="mmConflict"><b>多主</b> 并发写冲突 ' + (v.multiMasterConflictsOnWrite ? '有' : '无') + ' · 复制延迟读陈 ' + (v.multiMasterStaleOnLag ? '有' : '无') + '</span>',
      '<span class="chip" data-probe="gossipGap"><b>Gossip</b> 反熵间隙 ' + (gossip && gossip.gapNotConverged ? '未收敛' : '收敛') + ' · 读陈 ' + (gossip && gossip.gapReadStale ? '有' : '无') + ' · 无确定上界 ' + (gossip && gossip.noBound ? '✓' : '✗') + '</span>',
      '<span class="chip ' + (noWin ? 'jade-t' : 'muted-t') + '" data-verdict="noUniversalWinner">' +
        (noWin ? '✓ 不封任何协议全局赢家' : '本配置下归一（换场景会翻）') + '</span>',
    ]
    if (probes) probes.innerHTML = chips.join('')
    if (note) note.textContent = '三难 = 线性一致性 ∧ 分区可用性 ∧ 收敛确定性。真实向量三条互不相同、没有一条三个全占：' +
      'Raft 缺「分区可用」（单 leader 选主空窗 + 分区少数派凑不齐 quorum 必须拒写，CP 不冒脑裂），' +
      '但线性一致、多数派确认即确定收敛；多主缺「线性一致」（并发写冲突 + 异步复制延迟读陈），但从不阻塞、拓扑确定有界收敛；' +
      'Gossip 再缺「确定收敛」（概率反熵说不出第几轮必一致），换来回任节点可写、高可用。' +
      '全为确定性故障场景结构计数、非墙钟/吞吐/真 etcd·Consul 跑分；换场景结论会变，不封赢家。'
  }

  /* ================= KI-508 分布式锁与租约：三协议 × 六场景矩阵 + 三难不可兼得两面板 =================
   * 只读 Node 侧 dlSnapshot 真判词，前端不复核、不重算、不实测。整块缺/单块缺都诚实降级，不连坐其它维。 */
  function renderDistributedLock(dl) {
    renderDlMatrix(dl && dl.rows, dl && dl.config)
    renderDlLadder(dl && dl.rows)
    renderDlTrilemma(dl && dl.rows, dl && dl.verdict, dl && dl.setnx, dl && dl.redlock, dl && dl.fencing)
  }

  function dlMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">无' + esc(label) + '读数</div>'
    if (note) note.textContent = 'systems.distributedLock 缺失 —— 重跑 npm run console:data 采集真判词'
  }

  // 每格读 Node 侧真判词：成=加锁 / 双=双主写脏 / 护=fencing 拒旧写 / 脏=旧写落库 / 阻=单点宕机 / 拒=少数派拒锁（不复核）。
  function dlState(s, protocol) {
    if (!s) return { cls: '', ch: '—' }
    if (isNum(s.doubleOwners) && s.doubleOwners > 0) return { cls: 'double', ch: '双' }
    if (isNum(s.staleWritesRejected) && s.staleWritesRejected > 0) return { cls: 'guard', ch: '护' }
    if (isNum(s.dirtyWrites) && s.dirtyWrites > 0) return { cls: 'dirty', ch: '脏' }
    if (isNum(s.blockedAcquires) && s.blockedAcquires > 0) return { cls: 'denied', ch: protocol === 'SETNX' ? '阻' : '拒' }
    if (s.acquired) return { cls: 'ok', ch: '成' }
    return { cls: '', ch: '—' }
  }

  function renderDlMatrix(rows, config) {
    var box = $('#dl-matrix'), note = $('#dl-matrix-note')
    if (!Array.isArray(rows) || !rows.length || !config || !Array.isArray(config.scenarios)) {
      dlMissing(box, note, '三协议场景矩阵'); return
    }
    var scenarios = config.scenarios
    var head = '<div class="dl-mat-row dl-mat-head"><span class="dl-mat-proto">协议</span>' +
      scenarios.map(function (s) { return '<span class="dl-sc" title="' + esc(s.label) + '">' + esc(s.id) + '</span>' }).join('') +
      '<span class="dl-mat-cost">消息</span></div>'
    var body = rows.map(function (row) {
      var cells = scenarios.map(function (s) {
        var cell = Array.isArray(row.scenarios) ? row.scenarios.find(function (x) { return x.id === s.id }) : null
        var st = dlState(cell, row.protocol)
        return '<span class="dl-cell ' + st.cls + '" data-p="' + esc(row.protocol) + '" data-s="' + esc(s.id) +
          '" data-state="' + (st.cls || 'na') + '" title="' + esc(s.label) + '">' + st.ch + '</span>'
      }).join('')
      var t = row.totals || {}
      return '<div class="dl-mat-row" data-p="' + esc(row.protocol) + '">' +
        '<span class="dl-mat-proto">' + esc(row.protocol) + '<small>' + esc(row.label || '') + '</small></span>' +
        cells + '<span class="dl-mat-cost"><b>' + esc(fmt(t.messages)) + '</b></span></div>'
    }).join('')
    box.innerHTML = head + body
    if (note) note.textContent = '同一组确定性故障场景（全成功 / 持锁者 GC 长暂停 / 实例时钟漂移 / ' +
      '少数节点宕机 / 客户端落少数派分区 / 旧持锁者过期凭证写）分喂三协议，每格是 Node 侧真判词：' +
      '成=加锁落地、双=TTL 过期或时钟漂移致两客户端同时持锁写脏、护=fencing 用单调 token 拒绝旧写、' +
      '脏=无 fencing 兜不住旧写落库、阻=单点宕机即不可用、拒=多数派凑不齐 quorum 拒加锁（CP）。' +
      '消息数是结构计数、非墙钟/带宽；不封任何协议全局赢家。'
  }

  function renderDlLadder(rows) {
    var box = $('#dl-ladder')
    if (!box || !Array.isArray(rows) || !rows.length) { if (box) box.innerHTML = ''; return }
    var max = Math.max.apply(null, rows.map(function (r) { return r.totals && isNum(r.totals.messages) ? r.totals.messages : 0 }).concat([1]))
    box.innerHTML = rows.map(function (r) {
      var t = r.totals || {}
      var w = isNum(t.messages) ? Math.round(t.messages / max * 100) : 0
      var doubled = isNum(t.doubleOwners) ? t.doubleOwners : 0
      var dirty = isNum(t.dirtyWrites) ? t.dirtyWrites : 0
      var rejected = isNum(t.staleWritesRejected) ? t.staleWritesRejected : 0
      return '<div class="dl-line" data-p="' + esc(r.protocol) + '"><span class="tag">' + esc(r.protocol) + '</span>' +
        '<span class="dl-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="num">双' + esc(fmt(doubled)) + ' · 脏' + esc(fmt(dirty)) + ' · 护' + esc(fmt(rejected)) + '</span></div>'
    }).join('')
  }

  function renderDlTrilemma(rows, verdict, setnx, redlock, fencing) {
    var box = $('#dl-trilemma'), probes = $('#dl-probes'), note = $('#dl-trilemma-note')
    if (!Array.isArray(rows) || !rows.length) { dlMissing(box, note, '三难判据'); if (probes) probes.innerHTML = ''; return }
    var flags = [['mutualExclusion', '互斥安全'], ['partialFaultTolerance', '部分容错'], ['lowLatency', '低延迟']]
    var head = '<div class="dl-vec dl-vec-head"><span class="proto">协议</span>' +
      flags.map(function (f) { return '<span>' + f[1] + '</span>' }).join('') + '</div>'
    var body = rows.map(function (r) {
      var t = r.trilemma || {}
      var cells = flags.map(function (f) {
        var yes = t[f[0]] === true
        return '<span class="dl-flag ' + (yes ? 'yes' : 'no') + '" data-p="' + esc(r.protocol) + '" data-k="' + f[0] +
          '" data-v="' + (yes ? '1' : '0') + '">' + (yes ? '✓' : '✗') + '</span>'
      }).join('')
      return '<div class="dl-vec" data-p="' + esc(r.protocol) + '"><span class="proto">' + esc(r.protocol) + '</span>' + cells + '</div>'
    }).join('')
    box.innerHTML = head + body
    var v = verdict || {}
    var noWin = v.noUniversalWinner === true
    var chips = [
      '<span class="chip" data-probe="setnxGc"><b>SETNX</b> GC 暂停 ' + (v.setnxGcPauseDoubleOwner ? '双主写脏' : '未双主') + ' · 单点宕机 ' + (v.setnxSinglePointDown ? '不可用' : '仍可用') + '</span>',
      '<span class="chip" data-probe="setnxTtl"><b>SETNX</b> TTL 自动释放 ' + (setnx && setnx.ttlAutoRelease ? '✓' : '✗') + ' · 活着互斥 ' + (setnx && setnx.mutexWhileLive ? '✓' : '✗') + '</span>',
      '<span class="chip" data-probe="redlockDrift"><b>Redlock</b> 时钟漂移 ' + (v.redlockClockDriftDoubleOwner ? '双主写脏' : '未双主') + ' · 少数宕机 ' + (v.redlockToleratesNodeDown ? '容错' : '不可用') + '</span>',
      '<span class="chip" data-probe="redlockFence"><b>Redlock</b> 无 fencing ' + (v.redlockNoFencingDirtyWrite ? '旧写落库' : '已挡住') + ' · 少数派 ' + (v.redlockMinorityRefuses ? '拒加锁' : '仍可写') + '</span>',
      '<span class="chip jade-t" data-probe="etcdFence"><b>etcd</b> 单调 token ' + (fencing && fencing.tokenMonotonic ? '✓' : '✗') + ' · 旧 token 写 ' + (fencing && fencing.rejectsStaleWrite ? '真拒' : '未拒') + ' · 不脏写 ' + (fencing && fencing.noDirtyOnStale ? '✓' : '✗') + '</span>',
      '<span class="chip jade-t" data-probe="etcdRenew"><b>etcd</b> 续租 ' + (fencing && fencing.leaseRenewFresh ? '✓' : '✗') + ' · 过期租约不可续 ' + (fencing && fencing.expiredLeaseCannotRenew ? '✓' : '✗') + ' · 少数派 CP 拒锁 ' + (fencing && fencing.minorityRefusesCP ? '✓' : '✗') + '</span>',
      '<span class="chip ' + (noWin ? 'jade-t' : 'muted-t') + '" data-verdict="noUniversalWinner">' +
        (noWin ? '✓ 不封任何协议全局赢家' : '本配置下归一（换场景会翻）') + '</span>',
    ]
    if (probes) probes.innerHTML = chips.join('')
    if (note) note.textContent = '三难 = 互斥安全 ∧ 部分容错可用 ∧ 低延迟。真实向量三条互不相同、没有一条三个全占：' +
      'SETNX 缺「互斥 + 容错」（一次 RTT 最低延迟，但 GC 暂停 TTL 过期即双主写脏、单点宕机全盘不可用）；' +
      'Redlock 缺「互斥 + 低延迟」（quorum 抗少数宕机，但实例墙钟漂移可让两客户端各凑齐多数、且无 fencing 兜不住旧写，多数往返延迟居中）；' +
      'etcd Lease+Fencing 占「互斥 + 容错」（单调 token 让锁即使误授也拒旧写、Raft 多数复制容错），' +
      '但缺「低延迟」（每把锁都要多数派往返、续租依赖客户端活跃度）。fencing 的旧写被拒是真 token 数值比较、非布尔桩。' +
      '全为确定性故障场景结构计数、非墙钟/QPS/真 etcd·Redis 跑分；换场景结论会变，不封赢家。'
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
