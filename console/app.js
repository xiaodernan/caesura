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
      renderIdGen(snap.systems ? snap.systems.idGen : null)
      renderDistributedRateLimit(snap.systems ? snap.systems.distributedRateLimit : null)
      renderConfigConsistency(snap.systems ? snap.systems.configConsistency : null)
      renderCacheCoherency(snap.systems ? snap.systems.cacheCoherency : null)
      renderMessageDelivery(snap.systems ? snap.systems.messageDelivery : null)
      renderDelayQueue(snap.systems ? snap.systems.delayQueue : null)
      renderRetryDlq(snap.systems ? snap.systems.retryDlq : null)
      renderConsumerGroup(snap.systems ? snap.systems.consumerGroup : null)
      renderBackpressure(snap.systems ? snap.systems.backpressure : null)
      renderLogCompaction(snap.systems ? snap.systems.logCompaction : null)
      renderBloomFilter(snap.systems ? snap.systems.bloomFilter : null)
      renderCacheReplacement(snap.systems ? snap.systems.cacheReplacement : null)
      renderStreamWindow(snap.systems ? snap.systems.streamWindow : null)
      renderCardinality(snap.systems ? snap.systems.hyperLogLog : null)
      renderCrdt(snap.systems ? snap.systems.crdt : null)
      renderSpringBatch(snap.systems ? snap.systems.springBatch : null)
      renderDistributedSession(snap.systems ? snap.systems.distributedSession : null)
      renderTransactionalOutbox(snap.systems ? snap.systems.transactionalOutbox : null)
      renderTraceSampling(snap.systems ? snap.systems.traceSampling : null)
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
    if (note) note.textContent = 'systems.guards 缺失 —— ' + esc(label) + '读数诚实降级，不画假数、不连坐其它维；跑一次 npm run console:data 补齐真读数。'
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
    // KI-506 distributedTxn 真判词 chips（读 verdict 真值；tccRetry 缺时落「—」不画 0）。
    var retryTxt = tccRetry && isNum(tccRetry.retries) ? String(tccRetry.retries) : '—'
    var chips = [
      '<span class="chip" data-probe="twoPcBlocks"><b>2PC</b> 协调者宕机持锁阻塞 ' + (v.twoPcBlocksOnCoordinatorDown ? '✓' : '✗') + '</span>',
      '<span class="chip" data-probe="sagaDirty"><b>Saga</b> 补偿失败留脏 ' + (v.sagaLeaksDirtyOnCompensateFail ? '✓' : '✗') + '</span>',
      '<span class="chip" data-probe="tccRetry"><b>TCC</b> Confirm 幂等重试 ' + esc(retryTxt) + ' 次</span>',
      '<span class="chip ' + (noWin ? 'jade-t' : 'muted-t') + '" data-verdict="noUniversalWinner">' + (noWin ? '✓ 三向量互异，不封任何协议全局赢家' : '判词塌陷') + '</span>',
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

  /* ---------- KI-509 分布式 ID 三协议（UUID / Snowflake / 号段） ---------- */
  function renderIdGen(ig) {
    renderIgMatrix(ig && ig.rows, ig && ig.config)
    renderIgLadder(ig && ig.rows)
    renderIgTrilemma(ig && ig.rows, ig && ig.verdict, ig && ig.uuid, ig && ig.snowflake, ig && ig.segment, ig && ig.btree)
  }

  function igMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">无' + esc(label) + '读数</div>'
    if (note) note.textContent = 'systems.idGen 缺失 —— 重跑 npm run console:data 采集真判词'
  }

  // 每格读 Node 侧真判词：成=正常 / 重=回拨重复 / 停=发号中断 / 裂=索引定位代价 / 隙=重启跳号 / 迟=中心 RTT（不复核）。
  function igState(s) {
    if (!s) return { cls: '', ch: '—' }
    if (isNum(s.duplicates) && s.duplicates > 0) return { cls: 'dup', ch: '重' }
    if (isNum(s.stalled) && s.stalled > 0) return { cls: 'halt', ch: '停' }
    if (s.indexFriendly === false) return { cls: 'split', ch: '裂' }
    if (isNum(s.wastedIds) && s.wastedIds > 0) return { cls: 'gap', ch: '隙' }
    if (isNum(s.centerRounds) && s.centerRounds > 0) return { cls: 'lag', ch: '迟' }
    if (isNum(s.issued) && s.issued > 0) return { cls: 'ok', ch: '成' }
    return { cls: '', ch: '—' }
  }

  function renderIgMatrix(rows, config) {
    var box = $('#ig-matrix'), note = $('#ig-matrix-note')
    if (!Array.isArray(rows) || !rows.length || !config || !Array.isArray(config.scenarios)) {
      igMissing(box, note, '三协议场景矩阵'); return
    }
    var scenarios = config.scenarios
    var head = '<div class="ig-mat-row ig-mat-head"><span class="ig-mat-proto">协议</span>' +
      scenarios.map(function (s) { return '<span class="ig-sc" title="' + esc(s.label) + '">' + esc(s.id) + '</span>' }).join('') +
      '<span class="ig-mat-cost">发号</span></div>'
    var body = rows.map(function (row) {
      var cells = scenarios.map(function (s) {
        var cell = Array.isArray(row.scenarios) ? row.scenarios.find(function (x) { return x.id === s.id }) : null
        var st = igState(cell)
        return '<span class="ig-cell ' + st.cls + '" data-p="' + esc(row.protocol) + '" data-s="' + esc(s.id) +
          '" data-state="' + (st.cls || 'na') + '" title="' + esc(s.label) + '">' + st.ch + '</span>'
      }).join('')
      var t = row.totals || {}
      return '<div class="ig-mat-row" data-p="' + esc(row.protocol) + '">' +
        '<span class="ig-mat-proto">' + esc(row.protocol) + '<small>' + esc(row.label || '') + '</small></span>' +
        cells + '<span class="ig-mat-cost"><b>' + esc(fmt(t.issued)) + '</b></span></div>'
    }).join('')
    box.innerHTML = head + body
    if (note) note.textContent = '同一组确定性故障场景（全成功 / 随机主键插 B+ 树 / 墙钟回拨 / 中心 Redis 宕机 / ' +
      '同毫秒序列溢出 / 重启段跳跃浪费）分喂三协议，每格是 Node 侧真判词：成=发号正常、裂=随机主键插真 B+ 树定位比较更高' +
      '（索引代价，mid 分裂下 splits 反而更少）、停=墙钟回拨或中心宕机致发号中断、重=回拨激进实现发重复 ID、' +
      '隙=重启段跳跃浪费 ID 不连续、迟=取新段要中心 RTT。发号数是结构计数、非墙钟/吞吐；不封任何协议全局赢家。'
  }

  function renderIgLadder(rows) {
    var box = $('#ig-ladder')
    if (!box || !Array.isArray(rows) || !rows.length) { if (box) box.innerHTML = ''; return }
    var max = Math.max.apply(null, rows.map(function (r) { return r.totals && isNum(r.totals.comparisons) ? r.totals.comparisons : 0 }).concat([1]))
    box.innerHTML = rows.map(function (r) {
      var t = r.totals || {}
      var w = isNum(t.comparisons) ? Math.round(t.comparisons / max * 100) : 0
      var dup = isNum(t.duplicates) ? t.duplicates : 0
      var halt = isNum(t.stalled) ? t.stalled : 0
      var gate = isNum(t.wastedIds) ? t.wastedIds : 0
      return '<div class="ig-line" data-p="' + esc(r.protocol) + '"><span class="tag">' + esc(r.protocol) + '</span>' +
        '<span class="ig-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="num">重' + esc(fmt(dup)) + ' · 停' + esc(fmt(halt)) + ' · 隙' + esc(fmt(gate)) + '</span></div>'
    }).join('')
  }

  function renderIgTrilemma(rows, verdict, uuid, snowflake, segment, btree) {
    var box = $('#ig-trilemma'), btreeBox = $('#ig-btree'), probes = $('#ig-probes'), note = $('#ig-trilemma-note')
    if (!Array.isArray(rows) || !rows.length) {
      igMissing(box, note, '三难判据'); if (probes) probes.innerHTML = ''; if (btreeBox) btreeBox.innerHTML = ''; return
    }
    var flags = [['indexFriendly', '索引友好'], ['decentralized', '去中心'], ['clockRobust', '抗时钟异常']]
    var head = '<div class="ig-vec ig-vec-head"><span class="proto">协议</span>' +
      flags.map(function (f) { return '<span>' + f[1] + '</span>' }).join('') + '</div>'
    var body = rows.map(function (r) {
      var t = r.trilemma || {}
      var cells = flags.map(function (f) {
        var yes = t[f[0]] === true
        return '<span class="ig-flag ' + (yes ? 'yes' : 'no') + '" data-p="' + esc(r.protocol) + '" data-k="' + f[0] +
          '" data-v="' + (yes ? '1' : '0') + '">' + (yes ? '✓' : '✗') + '</span>'
      }).join('')
      return '<div class="ig-vec" data-p="' + esc(r.protocol) + '"><span class="proto">' + esc(r.protocol) + '</span>' + cells + '</div>'
    }).join('')
    box.innerHTML = head + body
    // KI-504 真 B+ 树交叉印证：索引代价铁证 + 反直觉 splits 读数都如实呈现，不粉饰。
    if (btreeBox) {
      if (btree && isNum(btree.randomCmp)) {
        btreeBox.innerHTML = '<div>KI-504 真 B+ 树交叉印证 · 随机主键定位比较 <b>' + esc(fmt(btree.randomCmp)) + '</b>' +
          ' &gt; 顺序基线 <b>' + esc(fmt(btree.sequentialCmpBaseline)) + '</b> ' +
          (btree.randomCmpGtSequential ? '<span class="jade-t">✓ 伤索引</span>' : '<span class="wine-t">✗ 未拉开</span>') + '</div>' +
          '<div>反直觉：mid 分裂下半满稳态 ⇒ 随机主键 splits <b>' + esc(fmt(btree.randomPageSplits)) + '</b>' +
          ' &lt; 顺序 <b>' + esc(fmt(btree.sequentialPageSplits)) + '</b> ' +
          (btree.randomFewerSplits ? '<span class="jade-t">✓ 如实保留</span>' : '') +
          '（「随机伤索引」真相是定位比较更多 + 缓冲池命中更低，不是 splits 更多）</div>'
      } else {
        btreeBox.innerHTML = '<div class="nodata">无真树交叉印证读数</div>'
      }
    }
    var v = verdict || {}
    var noWin = v.noUniversalWinner === true
    var chips = [
      '<span class="chip" data-probe="uuidIndex"><b>UUID</b> 随机主键索引代价 ' + (v.uuidPaysIndexCost ? '裂' : '未裂') + ' · 本地无中心 ' + (v.uuidLocalNoCenter ? '✓' : '✗') + '</span>',
      '<span class="chip" data-probe="uuidText"><b>UUID</b> 128 位版本 4 ' + (v.uuidVersion4 ? '✓' : '✗') + ' · 全局唯一 ' + (v.uuidGloballyUnique ? '✓' : '✗') + '</span>',
      '<span class="chip" data-probe="snowBack"><b>Snowflake</b> 墙钟回拨 ' + (v.snowflakeClockBackwardFatal ? '停发/重复（致命）' : '未中') + ' · 趋势递增 ' + (v.snowflakeIndexFriendly ? '✓' : '✗') + '</span>',
      '<span class="chip" data-probe="snowBits"><b>Snowflake</b> 位布局可反解 ' + (v.snowflakeParseRoundTrip ? '✓' : '✗') + ' · 激进重复可复现 ' + (v.snowflakeForceDuplicateReveals ? '✓' : '✗') + '</span>',
      '<span class="chip" data-probe="segCenter"><b>号段</b> 中心宕机 ' + (v.segmentCenterDownStalls ? '中断' : '仍可发') + ' · 中心 RTT ' + (v.segmentPaysCenterRounds ? '✓' : '✗') + '</span>',
      '<span class="chip" data-probe="segGap"><b>号段</b> 重启跳号 ' + (v.segmentRestartGaps ? '浪费、不连续' : '未跳') + ' · 不依赖墙钟 ' + (v.segmentNoWallClock ? '✓' : '✗') + '</span>',
      '<span class="chip ' + (noWin ? 'jade-t' : 'muted-t') + '" data-verdict="noUniversalWinner">' +
        (noWin ? '✓ 不封任何协议全局赢家' : '本配置下归一（换场景会翻）') + '</span>',
    ]
    if (probes) probes.innerHTML = chips.join('')
    if (note) note.textContent = '三难 = 索引友好（趋势递增）∧ 去中心（无中心存储/协调）∧ 抗时钟异常（回拨不重复/不中断）。真实向量三条互不相同、没有一条三个全占：' +
      'UUID 缺「索引友好」（本地无中心、不依赖墙钟，但随机主键喂真 B+ 树定位比较更高、缓冲池命中更低）；' +
      'Snowflake 缺「抗时钟异常」（时间戳趋势递增且本地生成，但墙钟回拨⇒停发或重复、workerId 也需协调）；' +
      '号段缺「去中心」（段内严格递增且用中心单调 counter 不依赖本地墙钟，但中心宕机 + 双 buffer 耗尽⇒中断、重启跳号浪费）。' +
      '「随机伤索引」以 KI-504 真树定位比较结构计数为铁证、并如实保留 splits 反转读数；可证伪（rigged 抹掉三类软肋后三协议全退化为 111、三判词翻 false）。' +
      '全为确定性故障场景结构计数、非墙钟/QPS/吞吐/真 Redis·etcd 跑分；换场景结论会变，不封赢家。'
  }

  /* ---------- KI-510 分布式限流：本地桶 / Redis 中心桶 / 一致性哈希分片桶 三协议诚实权衡（前端只读 Node 快照） ---------- */
  function renderDistributedRateLimit(drl) {
    renderDrlMatrix(drl && drl.rows, drl && drl.config)
    renderDrlLadder(drl && drl.rows)
    renderDrlTrilemma(drl && drl.rows, drl && drl.verdict, drl && drl.crosscheck)
  }

  function drlMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">无' + esc(label) + '读数</div>'
    if (note) note.textContent = 'systems.distributedRateLimit 缺失 —— 重跑 npm run console:data 采集真判词'
  }

  // 每格读 Node 侧真判词：成=正常 / 超=N×C 超发 / 迟=中心 RTT / 碎=配额碎片化早拒 / 降=单片故障降级（不复核）。
  function drlState(s) {
    if (!s) return { cls: '', ch: '—' }
    if (isNum(s.degradedShard) && s.degradedShard > 0) return { cls: 'degrade', ch: '降' }
    if (isNum(s.fragmented) && s.fragmented > 0) return { cls: 'frag', ch: '碎' }
    if (isNum(s.overAllowed) && s.overAllowed > 0) return { cls: 'over', ch: '超' }
    if (isNum(s.centerRounds) && s.centerRounds > 0) return { cls: 'lag', ch: '迟' }
    if (isNum(s.allowed) && s.allowed > 0) return { cls: 'ok', ch: '成' }
    return { cls: '', ch: '?' }
  }

  function renderDrlMatrix(rows, config) {
    var box = $('#drl-matrix'), note = $('#drl-matrix-note')
    if (!Array.isArray(rows) || !rows.length || !config || !Array.isArray(config.scenarios)) {
      drlMissing(box, note, '三协议场景矩阵'); return
    }
    var scenarios = config.scenarios
    var head = '<div class="drl-mat-row drl-mat-head"><span class="drl-mat-proto">协议</span>' +
      scenarios.map(function (s) { return '<span class="drl-sc">' + esc(s) + '</span>' }).join('') +
      '<span class="drl-mat-cost">放行</span></div>'
    var body = rows.map(function (row) {
      var cells = scenarios.map(function (s) {
        var cell = Array.isArray(row.scenarios) ? row.scenarios.find(function (x) { return x.id === s }) : null
        var st = drlState(cell)
        return '<span class="drl-cell ' + st.cls + '" data-p="' + esc(row.protocol) + '" data-s="' + esc(s) +
          '" data-state="' + (st.cls || 'na') + '">' + st.ch + '</span>'
      }).join('')
      var t = row.totals || {}
      return '<div class="drl-mat-row" data-p="' + esc(row.protocol) + '">' +
        '<span class="drl-mat-proto">' + esc(row.protocol) + '</span>' +
        cells + '<span class="drl-mat-cost"><b>' + esc(fmt(t.allowed)) + '</b></span></div>'
    }).join('')
    box.innerHTML = head + body
    if (note) note.textContent = '同一组确定性故障场景（全成功 / 同 key 突发 / 80% key 倾斜 / 中心·命中片宕机 / 中途扩容 / 多副本并发）分喂三协议：' +
      'Local 每实例本地桶零中心 RTT、故障隔离，但集群上限 N×C ⇒ 六场景全超发；Central 单 Redis key 原子扣减全局精确 = C，但每请求吃中心 RTT、' +
      '中心宕机则全瘫；Sharded 复用 KI-499 真一致性哈希环分片、单片故障只降级该片且扩容最小重映射，但同 key 必落同片 ⇒ 配额碎片化早拒、' +
      '且仍吃中心 RTT —— Sharded 不是银弹（只占「单点故障不瘫痪」一维）。放行数是结构计数、非墙钟/QPS/吞吐。'
  }

  function renderDrlLadder(rows) {
    var box = $('#drl-ladder')
    if (!box || !Array.isArray(rows) || !rows.length) { if (box) box.innerHTML = ''; return }
    var max = Math.max.apply(null, rows.map(function (r) { return r.totals && isNum(r.totals.centerRounds) ? r.totals.centerRounds : 0 }).concat([1]))
    box.innerHTML = rows.map(function (r) {
      var t = r.totals || {}
      var w = isNum(t.centerRounds) ? Math.round(t.centerRounds / max * 100) : 0
      return '<div class="drl-line" data-p="' + esc(r.protocol) + '"><span class="tag">' + esc(r.protocol) + '</span>' +
        '<span class="drl-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="num">超' + esc(fmt(t.overAllowed)) + ' · 碎' + esc(fmt(t.fragmented)) + ' · RTT' + esc(fmt(t.centerRounds)) + '</span></div>'
    }).join('')
  }

  function renderDrlTrilemma(rows, verdict, crosscheck) {
    var box = $('#drl-trilemma'), cxBox = $('#drl-crosscheck'), note = $('#drl-trilemma-note')
    if (!Array.isArray(rows) || !rows.length) {
      drlMissing(box, note, '三难判据'); if (cxBox) cxBox.innerHTML = ''; return
    }
    var flags = [['globalExact', '全局配额精确'], ['partialFaultTolerance', '单点故障不瘫痪'], ['noCenterRTT', '无中心 RTT']]
    var head = '<div class="drl-vec drl-vec-head"><span class="proto">协议</span>' +
      flags.map(function (f) { return '<span>' + f[1] + '</span>' }).join('') + '</div>'
    var body = rows.map(function (r) {
      var t = r.trilemma || {}
      var cells = flags.map(function (f) {
        var yes = t[f[0]] === true
        return '<span class="drl-flag ' + (yes ? 'yes' : 'no') + '" data-p="' + esc(r.protocol) + '" data-k="' + f[0] +
          '" data-v="' + (yes ? '1' : '0') + '">' + (yes ? '✓' : '✗') + '</span>'
      }).join('')
      return '<div class="drl-vec" data-p="' + esc(r.protocol) + '"><span class="proto">' + esc(r.protocol) + '</span>' + cells + '</div>'
    }).join('')
    box.innerHTML = head + body
    // 真依赖交叉印证：真 Redis 原子桶 vs 非原子超发 + 真一致性哈希环偏斜空片 / 扩容最小重映射。
    if (cxBox) {
      var c = crosscheck && crosscheck.central, s = crosscheck && crosscheck.sharded
      if (c && s) {
        cxBox.innerHTML = '<div>真 Redis 令牌桶 · 原子放行 <b>' + esc(fmt(c.atomicAllowed)) + '</b> ≤ 配额（精确 ' + (c.atomicExact ? '✓' : '✗') +
          '）· 非原子并发放行 <b>' + esc(fmt(c.nonAtomicAllowed)) + '</b> ⇒ 丢失更新超发 <span class="wine-t">' + esc(fmt(c.nonAtomicOvershoot)) + '</span></div>' +
          '<div>真一致性哈希环 · 均匀环分布比 <b>' + esc(fmt(s.balanceRatio)) + '</b>、空片 ' + esc(fmt((s.emptyNodes || []).length)) +
          ' · 坏 hash 偏斜 ⇒ 空片 <b>' + esc(fmt(s.skewEmptyNodes)) + '</b>、命中极差 ' + esc(fmt(s.skewSpread)) + ' &gt; ' + esc(fmt(s.spread)) +
          '（配额碎片化成因铁证）</div>' +
          '<div>扩容 4→5 片 · 一致性哈希重映射 <b>' + esc(fmt(s.remapRate)) + '</b> &lt; 朴素取模 ' + esc(fmt(s.moduloRate)) + '（最小迁移）</div>'
      } else {
        cxBox.innerHTML = '<div class="nodata">无真件交叉印证读数（central / sharded 单块缺各自降级）</div>'
      }
    }
    var v = verdict || {}
    var noWin = v.noUniversalWinner === true
    var notPanacea = v.shardedNotPanacea === true
    var chips = [
      '<span class="chip" data-probe="drlLocal"><b>Local</b> 零中心 RTT · N×C 超发 ' + (v.localOvershoots ? '✓（六场景全超）' : '未超') + '</span>',
      '<span class="chip" data-probe="drlCentral"><b>Central</b> 全局精确 ' + (v.centralExact ? '✓' : '✗') + ' · 中心 RTT + 单点' + '</span>',
      '<span class="chip" data-probe="drlSharded"><b>Sharded</b> 配额碎片化 ' + (v.shardedFragmented ? '✓' : '未现') + ' · 单片降级 + 最小重映射</span>',
      '<span class="chip ' + (notPanacea ? 'jade-t' : 'muted-t') + '" data-verdict="shardedNotPanacea">' +
        (notPanacea ? '✓ 分片不是银弹（缺全局精确 + 无中心 RTT 两维）' : '分片全占（换场景会翻）') + '</span>',
      '<span class="chip ' + (noWin ? 'jade-t' : 'muted-t') + '" data-verdict="noUniversalWinner">' +
        (noWin ? '✓ 不封任何协议全局赢家' : '本配置下归一（换场景会翻）') + '</span>',
    ]
    var probes = $('#drl-probes')
    if (probes) probes.innerHTML = chips.join('')
    if (note) note.textContent = '三难 = 全局配额精确（集群放行 ≤ C）∧ 单点故障不瘫痪（一台/一片宕不全停）∧ 无中心 RTT（判定不进中心）。' +
      '真实向量 Local=011 / Central=100 / Sharded=010 三条互不相同、没有一条三个全占：Local 零 RTT 且故障隔离但 N×C 超发；' +
      'Central 原子全局精确但每请求中心 RTT、中心单点宕则全瘫；Sharded 单片故障只降级该片、扩容最小重映射，但配额按片切死 ⇒ ' +
      '环偏斜 + key 倾斜两个独立成因都致热片先耗尽冷片有余（完美均匀的环也救不了「同 key 必落同片」），且仍吃中心 RTT。' +
      '真依赖交叉印证取 createRedisTokenBucket 原子/非原子 + createHashRing 分布/重映射真读数；可证伪（rigged 单实例 + 中心在线 + ' +
      '完美均匀 + key 均衡后三协议全退化为 111、三判词翻 false）。全为确定性故障场景结构计数、非墙钟/QPS/吞吐/真 Redis 跑分；换场景结论会变，不封赢家。'
  }

  /* ---------- KI-511 分布式配置一致性：轮询 / 长轮询 / watch 推送 三协议诚实权衡（前端只读 Node 快照） ---------- */
  function renderConfigConsistency(dcc) {
    renderDccMatrix(dcc && dcc.rows, dcc && dcc.config)
    renderDccLadder(dcc && dcc.rows)
    renderDccTrilemma(dcc && dcc.rows, dcc && dcc.verdict, dcc && dcc.crosscheck)
  }

  function dccMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">无' + esc(label) + '读数</div>'
    if (note) note.textContent = 'systems.configConsistency 缺失 —— 重跑 npm run console:data 采集真判词'
  }

  // 每格读 Node 侧真判词：成=即时省连接 / 空=无变更空转 / 迟=0~T 感知延迟 / 断=中心宕全断 / 缺=广播风暴版本缺口 / 连=常驻连接（不复核）。
  function dccState(s) {
    if (!s) return { cls: '', ch: '—' }
    if (s.centerBroken === true) return { cls: 'degrade', ch: '断' }
    if (isNum(s.versionGaps) && s.versionGaps > 0) return { cls: 'frag', ch: '缺' }
    if (isNum(s.idleFetches) && s.idleFetches > 0) return { cls: 'over', ch: '空' }
    if (isNum(s.perceivedDelay) && s.perceivedDelay > 0) return { cls: 'lag', ch: '迟' }
    if (isNum(s.connections) && s.connections > 0) return { cls: 'ok', ch: '连' }
    return { cls: '', ch: '?' }
  }

  function renderDccMatrix(rows, config) {
    var box = $('#dcc-matrix'), note = $('#dcc-matrix-note')
    if (!Array.isArray(rows) || !rows.length || !config || !Array.isArray(config.scenarios)) {
      dccMissing(box, note, '三协议场景矩阵'); return
    }
    var scenarios = config.scenarios
    var head = '<div class="dcc-mat-row dcc-mat-head"><span class="dcc-mat-proto">协议</span>' +
      scenarios.map(function (s) { return '<span class="dcc-sc">' + esc(s) + '</span>' }).join('') +
      '<span class="dcc-mat-cost">连接</span></div>'
    var body = rows.map(function (row) {
      var cells = scenarios.map(function (s) {
        var cell = Array.isArray(row.scenarios) ? row.scenarios.find(function (x) { return x.id === s }) : null
        var st = dccState(cell)
        return '<span class="dcc-cell ' + st.cls + '" data-p="' + esc(row.protocol) + '" data-s="' + esc(s) +
          '" data-state="' + (st.cls || 'na') + '">' + st.ch + '</span>'
      }).join('')
      var t = row.totals || {}
      return '<div class="dcc-mat-row" data-p="' + esc(row.protocol) + '">' +
        '<span class="dcc-mat-proto">' + esc(row.protocol) + '</span>' +
        cells + '<span class="dcc-mat-cost"><b>' + esc(fmt(t.connections)) + '</b></span></div>'
    }).join('')
    box.innerHTML = head + body
    if (note) note.textContent = '同一组确定性故障场景（全成功 / 变更贴脸 / 长空闲无变更 / 中心宕机 / 密集变更风暴 / 海量客户端）分喂三协议：' +
      'Polling 每 T 秒拉全量快照、服务端无状态、中心宕持旧快照续命，但 0~T 感知延迟 + 无变更也空转；LongPolling 挂起请求、变更近零延迟 + 无变更零空转，' +
      '但每客户端常驻挂起连接、空闲超时重连、中心宕则挂起全断；WatchPush 真 bus 事件链主动广播、变更即时 + 连接按需稳态复用，' +
      '但客户端须可寻址注册（中心一挂全断）、广播风暴须削峰（合并延迟 + 版本号兜底 reorder/丢失）—— Watch 不是银弹（缺可降级 + 即时两维）。' +
      '连接/延迟/缺口均结构计数、非墙钟/QPS/字节/真 socket 跑分。'
  }

  function renderDccLadder(rows) {
    var box = $('#dcc-ladder')
    if (!box || !Array.isArray(rows) || !rows.length) { if (box) box.innerHTML = ''; return }
    var max = Math.max.apply(null, rows.map(function (r) { return r.totals && isNum(r.totals.connections) ? r.totals.connections : 0 }).concat([1]))
    box.innerHTML = rows.map(function (r) {
      var t = r.totals || {}
      var w = isNum(t.connections) ? Math.round(t.connections / max * 100) : 0
      return '<div class="dcc-line" data-p="' + esc(r.protocol) + '"><span class="tag">' + esc(r.protocol) + '</span>' +
        '<span class="dcc-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="num">空' + esc(fmt(t.idleFetches)) + ' · 迟' + esc(fmt(t.perceivedDelaySum)) + ' · 缺' + esc(fmt(t.versionGaps)) + ' · 连' + esc(fmt(t.connections)) + '</span></div>'
    }).join('')
  }

  function renderDccTrilemma(rows, verdict, crosscheck) {
    var box = $('#dcc-trilemma'), cxBox = $('#dcc-crosscheck'), note = $('#dcc-trilemma-note')
    if (!Array.isArray(rows) || !rows.length) {
      dccMissing(box, note, '三难判据'); if (cxBox) cxBox.innerHTML = ''; return
    }
    var flags = [['degradeOnCenterDown', '中心宕可降级'], ['noIdleOverhead', '无空闲轮询开销'], ['instantPerceive', '变更即时感知']]
    var head = '<div class="dcc-vec dcc-vec-head"><span class="proto">协议</span>' +
      flags.map(function (f) { return '<span>' + f[1] + '</span>' }).join('') + '</div>'
    var body = rows.map(function (r) {
      var t = r.trilemma || {}
      var cells = flags.map(function (f) {
        var yes = t[f[0]] === true
        return '<span class="dcc-flag ' + (yes ? 'yes' : 'no') + '" data-p="' + esc(r.protocol) + '" data-k="' + f[0] +
          '" data-v="' + (yes ? '1' : '0') + '">' + (yes ? '✓' : '✗') + '</span>'
      }).join('')
      return '<div class="dcc-vec" data-p="' + esc(r.protocol) + '"><span class="proto">' + esc(r.protocol) + '</span>' + cells + '</div>'
    }).join('')
    box.innerHTML = head + body
    // 真依赖交叉印证：七枚真件读数（Config 快照 / watcher 首趟 / bus 事件链 / hashSelector 稳定桶 / XFetch / RedisTTL / 环分布）。
    if (cxBox) {
      var cs = crosscheck && crosscheck.configServer, cw = crosscheck && crosscheck.configWatcher
      var bu = crosscheck && crosscheck.bus, gr = crosscheck && crosscheck.gray
      var gd = crosscheck && crosscheck.guard, rc = crosscheck && crosscheck.redisCache, ri = crosscheck && crosscheck.ring
      if (cs && cw && bu && gr && gd && rc && ri) {
        cxBox.innerHTML = '<div>真 Config Server 响应 · version <b>' + esc(String(cs.responseVersion)) + '</b>、state=null <b>' + (cs.stateIsNull ? '✓' : '✗') +
          '</b>（即时快照、不热刷新）· app-profile 优先级版本 <b>' + esc(String(cs.pickedPriorityVersion)) + '</b> · 版本链单调 ' + (cs.versionChainMonotonic ? '✓' : '✗') + '</div>' +
          '<div>真 <b>startConfigWatcher</b> 首趟 <span class="jade-t">纯 mtime 播种</span>：不读内容 ' + (cw.contentLoadedOnFirstPass ? '✗' : '✓') +
          ' · onChange/bus 事件 <b>' + esc(fmt(cw.firstPassOnChange)) + '/' + esc(fmt(cw.firstPassBusEvents)) + '</b> ⇒ 生产 Config 也是轮询</div>' +
          '<div>真 <b>createBus</b> 事件链 <span class="jade-t">' + (bu.eventChainWorks ? '✓ 通' : '✗') + '</span> · 真 <b>hashSelector</b> 稳定桶 <b>' +
          esc(fmt(gr.stableBuckets)) + '/' + esc(fmt(gr.keys)) + '</b> · 真 <b>XFetch</b> 单调 ' + (gd.monotonic ? '✓' : '✗') + '</div>' +
          '<div>真 <b>RedisCache</b> 越过 TTL 惰性失效 <b>' + esc(fmt(rc.expiredCount)) + '</b> · 真 <b>HashRing</b> fanout 分布空片 ' + esc(fmt(ri.emptyNodes)) +
          ' · 命中极差 ' + esc(fmt(ri.spread)) + ' · balanceRatio ' + esc(fmt(ri.balanceRatio)) + '</div>'
      } else {
        cxBox.innerHTML = '<div class="nodata">无真件交叉印证读数（七块缺任一即各自降级）</div>'
      }
    }
    var v = verdict || {}
    var noWin = v.noUniversalWinner === true
    var notPanacea = v.watchNotPanacea === true
    var chips = [
      '<span class="chip" data-probe="dccPolling"><b>Polling</b> 0~T 延迟 ' + (v.pollingLags ? '✓' : '未现') + ' · 空转 ' + (v.pollingIdles ? '✓' : '未现') + ' · 中心宕可降级</span>',
      '<span class="chip" data-probe="dccLongPolling"><b>LongPolling</b> 常驻连接 ' + (v.longPollingHoldsConnections ? '✓' : '✗') + ' · 超时重连 ' + (v.longPollingReconnects ? '✓' : '✗') + ' · 中心宕全断</span>',
      '<span class="chip" data-probe="dccWatch"><b>WatchPush</b> 须可寻址 ' + (v.watchNeedsAddressing ? '✓' : '✗') + ' · 风暴版本缺口 ' + (v.watchVersionGaps ? '✓' : '未现') + '</span>',
      '<span class="chip ' + (notPanacea ? 'jade-t' : 'muted-t') + '" data-verdict="watchNotPanacea">' +
        (notPanacea ? '✓ Watch 不是银弹（缺中心宕可降级 + 变更即时两维）' : 'Watch 全占（换场景会翻）') + '</span>',
      '<span class="chip ' + (noWin ? 'jade-t' : 'muted-t') + '" data-verdict="noUniversalWinner">' +
        (noWin ? '✓ 不封任何协议全局赢家' : '本配置下归一（换场景会翻）') + '</span>',
    ]
    var probes = $('#dcc-probes')
    if (probes) probes.innerHTML = chips.join('')
    if (note) note.textContent = '三难 = 中心宕机可降级（中心挂了还能用旧配置撑）∧ 无空闲轮询开销（无变更零空转/零全量拉取）∧ 变更即时感知。' +
      '真实向量 Polling=100 / LongPolling=011 / WatchPush=010 三条互不相同、没有一条三个全占（不预设各恰好缺一）：Polling 唯一可降级但缺「无空闲 + 即时」两难；' +
      'LongPolling 即时 + 零空转但缺「可降级」一难（中心宕则挂起全断）；WatchPush 零空转但缺「可降级 + 即时」两难（中心须可寻址注册、风暴削峰合并延迟 + 版本号兜底）。' +
      '判定正交化：centerDown 只罚可降级、不连带罚即时。真依赖交叉印证取七枚真件读数；可证伪（rigged 轮询瞬时 + 中心恒在线 + 无风暴 + 六场景 fault 全空后三协议全退化为 111、三判词翻 false）。' +
      '全为确定性故障场景结构计数、非墙钟/QPS/字节/真 socket 跑分；换场景结论会变，不封赢家。'
  }

  /* ---------- KI-512 分布式缓存读写一致性：Cache-Aside / Write-Through / Write-Behind 三协议诚实权衡（前端只读 Node 快照） ---------- */
  function renderCacheCoherency(ccc) {
    renderCccMatrix(ccc && ccc.rows, ccc && ccc.config)
    renderCccLadder(ccc && ccc.rows)
    renderCccTrilemma(ccc && ccc.rows, ccc && ccc.verdict, ccc && ccc.crosscheck)
  }

  function cccMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">无' + esc(label) + '读数</div>'
    if (note) note.textContent = 'systems.cacheCoherency 缺失 —— 重跑 npm run console:data 采集真判词'
  }

  // 每格读 Node 侧真判词：丢=整机宕丢未刷回脏页 / 陈=非原子窗口陈旧读 / 存=宕而不丢 / 阻=写路径阻塞于库 RTT / 合=异步攒批合并 / 成=写后读可见（不复核）。
  function cccState(s) {
    if (!s) return { cls: '', ch: '—' }
    if (isNum(s.dirtyPagesLost) && s.dirtyPagesLost > 0) return { cls: 'lost', ch: '丢' }
    if (isNum(s.staleReads) && s.staleReads > 0) return { cls: 'stale', ch: '陈' }
    if (s.crashed === true) return { cls: 'crash', ch: '存' }
    if (isNum(s.writeBackendRttMs) && s.writeBackendRttMs > 0) return { cls: 'block', ch: '阻' }
    if (isNum(s.coalescedWrites) && s.coalescedWrites > 0) return { cls: 'coalesce', ch: '合' }
    if (isNum(s.writes) && s.writes > 0) return { cls: 'ok', ch: '成' }
    return { cls: '', ch: '?' }
  }

  function renderCccMatrix(rows, config) {
    var box = $('#ccc-matrix'), note = $('#ccc-matrix-note')
    if (!Array.isArray(rows) || !rows.length || !config || !Array.isArray(config.scenarios)) {
      cccMissing(box, note, '三协议场景矩阵'); return
    }
    var scenarios = config.scenarios
    var head = '<div class="ccc-mat-row ccc-mat-head"><span class="ccc-mat-proto">协议</span>' +
      scenarios.map(function (s) { return '<span class="ccc-sc">' + esc(s) + '</span>' }).join('') +
      '<span class="ccc-mat-cost">写RTT</span></div>'
    var body = rows.map(function (row) {
      var cells = scenarios.map(function (s) {
        var cell = Array.isArray(row.scenarios) ? row.scenarios.find(function (x) { return x.id === s }) : null
        var st = cccState(cell)
        return '<span class="ccc-cell ' + st.cls + '" data-p="' + esc(row.protocol) + '" data-s="' + esc(s) +
          '" data-state="' + (st.cls || 'na') + '">' + st.ch + '</span>'
      }).join('')
      var t = row.totals || {}
      return '<div class="ccc-mat-row" data-p="' + esc(row.protocol) + '">' +
        '<span class="ccc-mat-proto">' + esc(row.protocol) + '</span>' +
        cells + '<span class="ccc-mat-cost"><b>' + esc(fmt(t.writeBackendRttMs)) + '</b></span></div>'
    }).join('')
    box.innerHTML = head + body
    if (note) note.textContent = '同一组确定性故障场景（全成功 / 写完立刻读 / 写密集 / 缓存整机宕 / 异步刷回 / 海量 key）分喂三协议：' +
      'Cache-Aside 先更库再删缓存、读 miss 回填，写落库不丢但更库/删缓存非原子窗口有陈旧读 + 每次写同步打库被 RTT 阻塞；' +
      'Write-Through 同步双写缓存与库、始终一致不丢写，但每次写都吃库 RTT 写阻塞；' +
      'Write-Behind 只写缓存、异步攒批合并刷回，写延迟最低且不阻塞，但整机宕未刷回脏页全丢——进程内 WAL 与盘同机，一起丢。' +
      '写RTT 是结构计数、非墙钟/QPS/字节/真 Redis 跑分。Write-Behind 不是银弹。'
  }

  function renderCccLadder(rows) {
    var box = $('#ccc-ladder')
    if (!box || !Array.isArray(rows) || !rows.length) { if (box) box.innerHTML = ''; return }
    var max = Math.max.apply(null, rows.map(function (r) { return r.totals && isNum(r.totals.writeBackendRttMs) ? r.totals.writeBackendRttMs : 0 }).concat([1]))
    box.innerHTML = rows.map(function (r) {
      var t = r.totals || {}
      var w = isNum(t.writeBackendRttMs) ? Math.round(t.writeBackendRttMs / max * 100) : 0
      return '<div class="ccc-line" data-p="' + esc(r.protocol) + '"><span class="tag">' + esc(r.protocol) + '</span>' +
        '<span class="ccc-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="num">陈' + esc(fmt(t.staleReads)) + ' · 阻' + esc(fmt(t.writeBackendRttMs)) + 'ms · 丢' + esc(fmt(t.dirtyPagesLost)) + ' · 合' + esc(fmt(t.coalescedWrites)) + ' · 宕' + esc(fmt(t.crashedScenarios)) + '</span></div>'
    }).join('')
  }

  function renderCccTrilemma(rows, verdict, crosscheck) {
    var box = $('#ccc-trilemma'), cxBox = $('#ccc-crosscheck'), note = $('#ccc-trilemma-note')
    if (!Array.isArray(rows) || !rows.length) {
      cccMissing(box, note, '三难判据'); if (cxBox) cxBox.innerHTML = ''; return
    }
    var flags = [['readYourWrites', '写后立刻可见'], ['noWriteBlocking', '写路径不阻塞'], ['durableOnCrash', '整机宕不丢写']]
    var head = '<div class="ccc-vec ccc-vec-head"><span class="proto">协议</span>' +
      flags.map(function (f) { return '<span>' + f[1] + '</span>' }).join('') + '</div>'
    var body = rows.map(function (r) {
      var t = r.trilemma || {}
      var cells = flags.map(function (f) {
        var yes = t[f[0]] === true
        return '<span class="ccc-flag ' + (yes ? 'yes' : 'no') + '" data-p="' + esc(r.protocol) + '" data-k="' + f[0] +
          '" data-v="' + (yes ? '1' : '0') + '">' + (yes ? '✓' : '✗') + '</span>'
      }).join('')
      return '<div class="ccc-vec" data-p="' + esc(r.protocol) + '"><span class="proto">' + esc(r.protocol) + '</span>' + cells + '</div>'
    }).join('')
    box.innerHTML = head + body
    // 真依赖交叉印证：七枚真件读数（Redis 写后读 / WAL 进程内恢复但非跨机 / XFetch / Sharded / MVCC / 2PC / 环）。
    if (cxBox) {
      var rd = crosscheck && crosscheck.redis, wa = crosscheck && crosscheck.wal
      var gd = crosscheck && crosscheck.guard, sh = crosscheck && crosscheck.sharded
      var mv = crosscheck && crosscheck.mvcc, tp = crosscheck && crosscheck.twoPhase, ri = crosscheck && crosscheck.ring
      if (rd && wa && gd && sh && mv && tp && ri) {
        cxBox.innerHTML =
          '<div>真 <b>createRedisCache</b> 写 ' + esc(String(rd.secondVersion)) + ' 后读见新值 <span class="jade-t">' + (rd.writeThenReadSeesNew ? '✓' : '✗') +
          '</span>（缓存命中 <b>' + esc(fmt(rd.hits)) + '</b>；' + esc(String(rd.firstVersion)) + '→' + esc(String(rd.secondVersion)) + '）<span class="wine-t">' + (rd.notRealRedis ? ' 非真 Redis' : '') + '</span></div>' +
          '<div>真 <b>createWal</b> append/restore/replay <b>' + esc(fmt(wa.lines)) + '/' + esc(fmt(wa.restored)) + '/' + esc(fmt(wa.replayed)) +
          '</b>，进程崩溃可恢复 ' + (wa.processCrashRecoverable ? '✓' : '✗') + '，<span class="wine-t">但 sink 进程内、跨机复制 ' +
          (wa.replicatedAcrossNodes ? '✓' : '✗') + '、整机+盘一起丢 ' + (wa.wholeNodeLossDurable ? '✓' : '✗') + '</span> ⇒ 单开 WAL 抹不掉 durable 维</div>' +
          '<div>真 <b>shouldEarlyExpire</b> XFetch 随 age→TTL 单调 ' + (gd.monotonic ? '✓' : '✗') +
          '（young ' + (gd.youngEarly ? '早' : '否') + ' / old ' + (gd.oldEarly ? '早' : '否') + '，降概率非消窗口）· 真 <b>createShardedCache</b> 写/读 <b>' +
          esc(fmt(sh.written)) + '/' + esc(fmt(sh.readHits)) + '</b>，' + esc(fmt(sh.shards)) + ' 片全可读 ' + (sh.allReadable ? '✓' : '✗') + '</div>' +
          '<div>真 <b>createMvccStore</b> 库侧写后读已提交新值需版本链 ' + esc(String(mv.beforeCommitVersion)) + '→' + esc(String(mv.afterCommitVersion)) +
          '（需提交 ' + (mv.writeThenReadNeedsCommit ? '✓' : '✗') + '）· 真 <b>createTwoPhaseCommit</b> 全 yes 提交 <b>' + esc(fmt(tp.commitMessages)) +
          '</b> 条，协调者宕则阻塞 <b>' + esc(fmt(tp.blockedParticipants)) + '</b> 人<span class="wine-t">' + (tp.notRealXa ? ' 非真 XA' : '') + '</span></div>' +
          '<div>真 <b>createHashRing</b> 环 ' + esc(fmt(ri.keys)) + ' key / ' + esc(fmt(ri.nodes)) + ' 节点 fanout 空片 ' + esc(fmt(ri.emptyNodes)) +
          ' · balanceRatio ' + esc(fmt(ri.balanceRatio, 3)) + '</div>'
      } else {
        cxBox.innerHTML = '<div class="nodata">无真件交叉印证读数（七块缺任一即各自降级）</div>'
      }
    }
    var v = verdict || {}
    var noWin = v.noUniversalWinner === true
    var notPanacea = v.writeBehindNotPanacea === true
    var walNot = v.walNotDurableAcrossNode === true
    var chips = [
      '<span class="chip" data-probe="cccAside"><b>CacheAside</b> 陈旧窗口 ' + (v.asideHasStaleWindow ? '✓' : '✗') + ' · 写阻塞 ' + (v.asideBlocksOnBackend ? '✓' : '✗') + ' · 宕不丢 ' + (v.asideDurable ? '✓' : '✗') + '</span>',
      '<span class="chip" data-probe="cccThrough"><b>WriteThrough</b> 强一致 ' + (v.throughConsistent ? '✓' : '✗') + ' · 写阻塞 ' + (v.throughBlocksOnBackend ? '✓' : '✗') + '</span>',
      '<span class="chip" data-probe="cccBehind"><b>WriteBehind</b> 不阻塞 ' + (v.behindNoWriteBlocking ? '✓' : '✗') + ' · 宕丢脏页 ' + (v.behindLosesDirtyOnCrash ? '✓' : '✗') + ' · 合并 ' + (v.behindCoalescesWrites ? '✓' : '✗') + '</span>',
      '<span class="chip ' + (walNot ? 'jade-t' : 'muted-t') + '" data-probe="cccWal">' + (walNot ? '✓ 进程内 WAL 跨机不保、整机宕仍丢写' : 'WAL 跨机保写') + '</span>',
      '<span class="chip ' + (notPanacea ? 'jade-t' : 'muted-t') + '" data-verdict="writeBehindNotPanacea">' + (notPanacea ? '✓ Write-Behind 不是银弹（缺整机宕不丢写）' : 'Write-Behind 全占（换场景会翻）') + '</span>',
      '<span class="chip ' + (noWin ? 'jade-t' : 'muted-t') + '" data-verdict="noUniversalWinner">' + (noWin ? '✓ 不封任何协议全局赢家' : '本配置下归一（换场景会翻）') + '</span>',
    ]
    var probes = $('#ccc-probes')
    if (probes) probes.innerHTML = chips.join('')
    if (note) note.textContent = '三难 = 写后读立刻可见 ∧ 写路径不阻塞 ∧ 整机宕不丢写。' +
      '真实向量 CacheAside=001 / WriteThrough=101 / WriteBehind=110 三条互不相同、没有一条三个全占（不预设各恰好缺一）：' +
      'CacheAside 只占 durable 一维、缺「写后可见 + 写不阻塞」两难（更库/删缓存非原子窗口 + 同步打库）；' +
      'WriteThrough 一致 + 不丢但缺「写不阻塞」一难（每次写吃库 RTT）；' +
      'WriteBehind 写后可见 + 不阻塞但缺「整机宕不丢写」一难（未刷回脏页全丢）。' +
      '进程内 WAL 只能救同机进程崩溃 replay，WAL 与盘同机、整机一起丢 ⇒ 单开 walEnabled 抹不掉 durable 维（真跨机不丢须 quorum 复制，属 Raft 共识的活）。' +
      '判定正交化：cacheCrash 只罚 durable、不连带罚写后可见。真依赖交叉印证取七枚真件读数；可证伪（rigged 原子失效 + 抹库 RTT + 写回同步双写 + 六场景 fault 全空后三协议全退化为 111、三判词翻 false）。' +
      '全为确定性故障场景结构计数、非墙钟/QPS/字节/真 Redis 跑分；换场景结论会变，不封赢家。'
  }

  /* ================= KI-513：分布式消息投递语义三协议（第十五维）================= */

  function renderMessageDelivery(mmd) {
    renderMmdMatrix(mmd && mmd.rows, mmd && mmd.config)
    renderMmdLadder(mmd && mmd.rows)
    renderMmdTrilemma(mmd && mmd.rows, mmd && mmd.verdict, mmd && mmd.crosscheck)
  }

  function mmdMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">无' + esc(label) + '读数</div>'
    if (note) note.textContent = 'systems.messageDelivery 缺失 —— 重跑 npm run console:data 采集真判词'
  }

  // 每格读 Node 侧真判词：丢=发完即忘静默丢 / 重=ack 丢误判重投致重复 / 贵=幂等+事务+游标开销最高 / 等=重投命中幂等折叠 / 成=不丢不重又省（不复核）。
  function mmdState(s) {
    if (!s) return { cls: '', ch: '—' }
    if (isNum(s.lost) && s.lost > 0) return { cls: 'lost', ch: '丢' }
    if (isNum(s.duplicates) && s.duplicates > 0) return { cls: 'dup', ch: '重' }
    if (s.lowOverhead === false) return { cls: 'expensive', ch: '贵' }
    if (isNum(s.idempotentHits) && s.idempotentHits > 0) return { cls: 'idempotent', ch: '等' }
    if (isNum(s.sent) && s.sent > 0) return { cls: 'ok', ch: '成' }
    return { cls: '', ch: '?' }
  }

  function renderMmdMatrix(rows, config) {
    var box = $('#mmd-matrix'), note = $('#mmd-matrix-note')
    if (!Array.isArray(rows) || !rows.length || !config || !Array.isArray(config.scenarios)) {
      mmdMissing(box, note, '三协议场景矩阵'); return
    }
    var scenarios = config.scenarios
    var head = '<div class="mmd-mat-row mmd-mat-head"><span class="mmd-mat-proto">协议</span>' +
      scenarios.map(function (s) { return '<span class="mmd-sc">' + esc(s) + '</span>' }).join('') +
      '<span class="mmd-mat-cost">发/送</span></div>'
    var body = rows.map(function (row) {
      var cells = scenarios.map(function (s) {
        var cell = Array.isArray(row.scenarios) ? row.scenarios.find(function (x) { return x.id === s }) : null
        var st = mmdState(cell)
        return '<span class="mmd-cell ' + st.cls + '" data-p="' + esc(row.protocol) + '" data-s="' + esc(s) +
          '" data-state="' + (st.cls || 'na') + '">' + st.ch + '</span>'
      }).join('')
      var t = row.totals || {}
      return '<div class="mmd-mat-row" data-p="' + esc(row.protocol) + '">' +
        '<span class="mmd-mat-proto">' + esc(row.protocol) + '</span>' +
        cells + '<span class="mmd-mat-cost"><b>' + esc(fmt(t.sent)) + '</b></span></div>'
    }).join('')
    box.innerHTML = head + body
    if (note) note.textContent = '同一组确定性故障场景（全成功 / 发送后崩溃 / ack 丢失 / broker 重投 / 消费者慢 / 重复突发）分喂三协议：' +
      'At-Most-Once 发完即忘、不重试不等 ack，开销最低，但发送后崩溃/丢包消息静默丢失（天然不重试⇒不重复）；' +
      'At-Least-Once 失败重投直到确认，崩溃丢包都补回不丢消息，但 ack 在网络里丢失时误判失败重投同一条⇒消费者收到重复；' +
      'Exactly-Once 用幂等键+去重表把重投折叠成一次生效，配合持久化游标原子提交⇒不丢不重，但每消息查/写去重表、持事务、写游标⇒端到端开销最高（是 At-Least-Once + 幂等）。' +
      '发/送 是结构计数、非墙钟/QPS/字节/吞吐跑分。Exactly-Once 不是免费午餐。'
  }

  function renderMmdLadder(rows) {
    var box = $('#mmd-ladder')
    if (!box || !Array.isArray(rows) || !rows.length) { if (box) box.innerHTML = ''; return }
    var max = Math.max.apply(null, rows.map(function (r) { return r.totals && isNum(r.totals.overheadUnits) ? r.totals.overheadUnits : 0 }).concat([1]))
    box.innerHTML = rows.map(function (r) {
      var t = r.totals || {}
      var w = isNum(t.overheadUnits) ? Math.round(t.overheadUnits / max * 100) : 0
      return '<div class="mmd-line" data-p="' + esc(r.protocol) + '"><span class="tag">' + esc(r.protocol) + '</span>' +
        '<span class="mmd-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="num">开销' + esc(fmt(t.overheadUnits)) + ' · 发' + esc(fmt(t.sent)) + ' · 丢' + esc(fmt(t.lost)) + ' · 重' + esc(fmt(t.duplicates)) + ' · 幂等' + esc(fmt(t.idempotentHits)) + ' · 投' + esc(fmt(t.crashScenarios)) + '</span></div>'
    }).join('')
  }

  function renderMmdTrilemma(rows, verdict, crosscheck) {
    var box = $('#mmd-trilemma'), cxBox = $('#mmd-crosscheck'), note = $('#mmd-trilemma-note')
    if (!Array.isArray(rows) || !rows.length) {
      mmdMissing(box, note, '三难判据'); if (cxBox) cxBox.innerHTML = ''; return
    }
    var flags = [['noLoss', '不丢消息'], ['noDup', '不重复投递'], ['lowOverhead', '端到端低开销']]
    var head = '<div class="mmd-vec mmd-vec-head"><span class="proto">协议</span>' +
      flags.map(function (f) { return '<span>' + f[1] + '</span>' }).join('') + '</div>'
    var body = rows.map(function (r) {
      var t = r.trilemma || {}
      var cells = flags.map(function (f) {
        var yes = t[f[0]] === true
        return '<span class="mmd-flag ' + (yes ? 'yes' : 'no') + '" data-p="' + esc(r.protocol) + '" data-k="' + f[0] +
          '" data-v="' + (yes ? '1' : '0') + '">' + (yes ? '✓' : '✗') + '</span>'
      }).join('')
      return '<div class="mmd-vec" data-p="' + esc(r.protocol) + '"><span class="proto">' + esc(r.protocol) + '</span>' + cells + '</div>'
    }).join('')
    box.innerHTML = head + body
    // 真依赖交叉印证：七枚真件读数（createBus / GameEventBus / Bridge / 2PC / WAL / Redis / 环）。
    if (cxBox) {
      var bu = crosscheck && crosscheck.bus, ge = crosscheck && crosscheck.gameEventBus
      var br = crosscheck && crosscheck.bridge, tp = crosscheck && crosscheck.twoPhase
      var wa = crosscheck && crosscheck.wal, rd = crosscheck && crosscheck.redis, ri = crosscheck && crosscheck.ring
      if (bu && ge && br && tp && wa && rd && ri) {
        cxBox.innerHTML =
          '<div>真 <b>createBus</b> 同步发完即忘：有监听器投递 <b>' + esc(fmt(bu.hits)) + '</b> 次、退订后重发不再投 <span class="jade-t">' +
          (bu.noReplayOnUnsubscribe ? '✓' : '✗') + '</span>（at-most-once shell）<span class="wine-t">' + (bu.notRealNetwork ? ' 非真网络' : '') + '</span></div>' +
          '<div>真 <b>createGameEventBus</b> publishGameEvent 交付 <b>' + esc(fmt(ge.delivered)) + '</b> / 错误 <b>' + esc(fmt(ge.errors)) + '</b>，与实收一致 ' + (ge.deliveredMatches ? '✓' : '✗') + '</div>' +
          '<div>真 <b>createGameEventBridge</b> install ' + (br.installed ? '✓' : '✗') + '、白名单转发 ' + (br.forwardOk ? '✓' : '✗') +
          '、未路由丢弃 ' + (br.unroutedDropped ? '✓' : '✗') + '（路由 <b>' + esc(fmt(br.routes)) + '</b>）<span class="wine-t">' + (br.notRealRebalance ? ' 非真 rebalance' : '') + '</span></div>' +
          '<div>真 <b>createTwoPhaseCommit</b> 全 yes 提交 <b>' + esc(fmt(tp.commitMessages)) + '</b> 条，重放已提交事务幂等 ' + (tp.replayIdempotent ? '✓' : '✗') +
          '，协调者宕阻塞 <b>' + esc(fmt(tp.blockedParticipants)) + '</b> 人<span class="wine-t">' + (tp.notRealXa ? ' 非真 XA' : '') + '</span></div>' +
          '<div>真 <b>createWal</b> append/restore/replay <b>' + esc(fmt(wa.lines)) + '/' + esc(fmt(wa.restored)) + '/' + esc(fmt(wa.replayed)) +
          '</b>，带 key 重放 <b>' + esc(fmt(wa.replayed)) + '</b> 条 distinct <b>' + esc(fmt(wa.distinctIds)) + '</b>（同 id 重投 ' + esc(fmt(wa.duplicateIdsReplayed)) +
          ' 条可去重 ' + (wa.replayDedupePossible ? '✓' : '✗') + '）<span class="wine-t">但 sink 进程内、跨机复制 ' +
          (wa.replicatedAcrossNodes ? '✓' : '✗') + '</span></div>' +
          '<div>真 <b>createRedisCache</b> 幂等键首 miss <span class="jade-t">' + (rd.firstMiss ? '✓' : '✗') + '</span> 二次 hit <span class="jade-t">' +
          (rd.secondHit ? '✓' : '✗') + '</span>（hits <b>' + esc(fmt(rd.hits)) + '</b> / misses <b>' + esc(fmt(rd.misses)) + '</b>）<span class="wine-t">' + (rd.notRealRedis ? ' 非真 Redis' : '') + '</span></div>' +
          '<div>真 <b>createHashRing</b> 环 <b>' + esc(fmt(ri.keys)) + '</b> key / <b>' + esc(fmt(ri.nodes)) + '</b> 节点 fanout 空片 ' + esc(fmt(ri.emptyNodes)) +
          ' · balanceRatio ' + esc(fmt(ri.balanceRatio, 3)) + '</div>'
      } else {
        cxBox.innerHTML = '<div class="nodata">无真件交叉印证读数（七块缺任一即各自降级）</div>'
      }
    }
    var v = verdict || {}
    var noWin = v.noUniversalWinner === true
    var notFree = v.exactlyOnceNotFree === true
    var plusIdem = v.exactlyOnceIsAtLeastOncePlusIdempotency === true
    var chips = [
      '<span class="chip" data-probe="mmdMost"><b>AtMostOnce</b> 静默丢 ' + (v.atMostOnceSilentlyLoses ? '✓' : '✗') + ' · 最省 ' + (v.atMostOnceCheapest ? '✓' : '✗') + '</span>',
      '<span class="chip" data-probe="mmdLeast"><b>AtLeastOnce</b> 不丢 ' + (v.atLeastOnceNeverLoses ? '✓' : '✗') + ' · 会重复 ' + (v.atLeastOnceDuplicates ? '✓' : '✗') + '</span>',
      '<span class="chip" data-probe="mmdOnce"><b>ExactlyOnce</b> 不丢不重 ' + (v.exactlyOnceNoLossNoDup ? '✓' : '✗') + ' · 最贵 ' + (v.exactlyOnceMostExpensive ? '✓' : '✗') + '</span>',
      '<span class="chip ' + (plusIdem ? 'jade-t' : 'muted-t') + '" data-verdict="exactlyOnceIsAtLeastOncePlusIdempotency">' + (plusIdem ? '✓ Exactly-Once = At-Least-Once + 幂等' : '幂等折叠未在真场景命中') + '</span>',
      '<span class="chip ' + (notFree ? 'jade-t' : 'muted-t') + '" data-verdict="exactlyOnceNotFree">' + (notFree ? '✓ Exactly-Once 不是免费午餐' : 'Exactly-Once 全占（换场景会翻）') + '</span>',
      '<span class="chip ' + (noWin ? 'jade-t' : 'muted-t') + '" data-verdict="noUniversalWinner">' + (noWin ? '✓ 不封任何协议全局赢家' : '本配置下归一（换场景会翻）') + '</span>',
    ]
    var probes = $('#mmd-probes')
    if (probes) probes.innerHTML = chips.join('')
    if (note) note.textContent = '三难 = 不丢消息 ∧ 不重复投递 ∧ 端到端低开销。' +
      '真实向量 AtMostOnce=011 / AtLeastOnce=101 / ExactlyOnce=110 三条互不相同、没有一条三个全占（不预设各恰好缺一）：' +
      'AtMostOnce 不重试⇒天然不重复 + 零 ack 零去重开销，只缺「不丢」一难（发送后崩溃静默丢）；' +
      'AtLeastOnce 重投补回不丢 + 无幂等基础设施仍省，只缺「不重复」一难（ack 丢失误判重投致重复）；' +
      'ExactlyOnce 幂等键折叠重投⇒不丢不重，只缺「低开销」一难（查/写去重表 + 事务 + 持久化游标，结构开销约为 At-Least-Once 的 5 倍）。' +
      '判定正交化：ackLost 只罚 noDup、不连带罚 noLoss；单开 ackReliable 只让 AtLeastOnce 退化 111，救不了 At-Most-Once 丢、也救不了 Exactly-Once 贵（呼应 KI-511 瞬时轮询≠零空转 / KI-512 单开 WAL 抹不掉 durable）。' +
      '真 WAL 带 key 重放可去重，但 sink 进程内、不跨机，整机+盘一起丢仍丢（真跨机不丢须 quorum 复制，属 Raft 共识的活）。' +
      '真依赖交叉印证取七枚真件读数；可证伪（rigged 抹崩溃 + ack 可靠 + 幂等零开销 + 六场景 fault 全空后三协议全退化为 111、三判词翻 false）。' +
      '全为确定性故障场景结构计数、非墙钟/QPS/字节/吞吐跑分；换场景结论会变，不封赢家。'
  }


  /* ================= KI-518 延迟消息队列三协议权衡 · 第十六维（dld 族） ================= */

  function renderDelayQueue(dld) {
    renderDldMatrix(dld && dld.rows, dld && dld.config)
    renderDldLadder(dld && dld.rows)
    renderDldTrilemma(dld && dld.rows, dld && dld.verdict, dld && dld.crosscheck)
  }

  function dldMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">' + esc(label) + ' 暂缺</div>'
    if (note) note.textContent = 'systems.delayQueue 缺失 — 跑一次 npm run console:data 即可补齐'
  }

  function dldState(s) {
    if (!s) return { cls: '', ch: '·' }
    if (isNum(s.lateMs) && s.lateMs > 0) return { cls: 'lost', ch: '晩' }
    if (isNum(s.lostOnRestart) && s.lostOnRestart > 0) return { cls: 'lost', ch: '丢' }
    if (isNum(s.duplicatePickups) && s.duplicatePickups > 0) return { cls: 'dup', ch: '重' }
    if (s.punctual === true) return { cls: 'ok', ch: '准' }
    if (s.lowCost === false) return { cls: 'expensive', ch: '贵' }
    return { cls: '', ch: '?' }
  }

  function renderDldMatrix(rows, config) {
    var box = $('#dld-matrix'), note = $('#dld-matrix-note')
    if (!Array.isArray(rows) || !rows.length || !config || !Array.isArray(config.scenarios)) {
      dldMissing(box, note, 'dld 矩阵'); return
    }
    var scenarios = config.scenarios
    var head = '<div class="dld-mat-row dld-mat-head"><span class="dld-mat-proto">协议</span>' +
      scenarios.map(function (sc) { return '<span class="dld-sc">' + esc(sc) + '</span>' }).join('') +
      '<span class="dld-mat-cost">晚/丢/重</span></div>'
    var body = rows.map(function (row) {
      var cells = scenarios.map(function (sc) {
        var cell = Array.isArray(row.scenarios) ? row.scenarios.find(function (x) { return x.id === sc }) : null
        var st = dldState(cell)
        return '<span class="dld-cell ' + st.cls + '" data-p="' + esc(row.protocol) + '" data-s="' + esc(sc) +
          '" data-state="' + (st.cls || 'na') + '">' + st.ch + '</span>'
      }).join('')
      var t = row.totals || {}
      return '<div class="dld-mat-row" data-p="' + esc(row.protocol) + '">' +
        '<span class="dld-mat-proto">' + esc(row.protocol) + '</span>' +
        cells + '<span class="dld-mat-cost"><b>' + esc(fmt(t.lateMs)) + '</b></span></div>'
    }).join('')
    box.innerHTML = head + body
    if (note) note.textContent = '同一组确定性场景分喂三协议：tickSkew（非整 tick 到期）/ farFuture（远期任务）/ manyCancels（批量取消）/ workerRestart（进程内重启）/ concurrentWorkers（并发摘取）。' +
      '时间轮 Θ(1) 挂槽但 tick 粒度晚点 + 进程内单点；最小堆到期即时精确但 O(log n) 且同样进程内；Redis ZSET 跨 worker 共享可持久化但轮询晚点 + 中心 RTT + 非原子重复消费。' +
      '不声称墙钟 QPS/延迟，全结构计数。'
  }

  function renderDldLadder(rows) {
    var box = $('#dld-ladder')
    if (!box || !Array.isArray(rows) || !rows.length) { if (box) box.innerHTML = ''; return }
    var max = Math.max.apply(null, rows.map(function (r) { return r.totals && isNum(r.totals.opUnits) ? r.totals.opUnits : 0 }).concat([1]))
    box.innerHTML = rows.map(function (r) {
      var t = r.totals || {}
      var w = isNum(t.opUnits) ? Math.round(t.opUnits / max * 100) : 0
      return '<div class="dld-line" data-p="' + esc(r.protocol) + '"><span class="tag">' + esc(r.protocol) + '</span>' +
        '<span class="dld-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="num">opUnits ' + esc(fmt(t.opUnits)) + ' · late ' + esc(fmt(t.lateMs)) + ' · lost ' + esc(fmt(t.lostOnRestart)) + ' · dup ' + esc(fmt(t.duplicatePickups)) + '</span></div>'
    }).join('')
  }

  function renderDldTrilemma(rows, verdict, crosscheck) {
    var box = $('#dld-trilemma'), cxBox = $('#dld-crosscheck'), note = $('#dld-trilemma-note')
    if (!Array.isArray(rows) || !rows.length) {
      dldMissing(box, note, 'dld 判词'); if (cxBox) cxBox.innerHTML = ''; return
    }
    var flags = [['lowCost', '低开销'], ['punctual', '即时精确'], ['sharedDurable', '共享可持久']]
    var head = '<div class="dld-vec dld-vec-head"><span class="proto">协议</span>' +
      flags.map(function (fl) { return '<span>' + fl[1] + '</span>' }).join('') + '</div>'
    var body = rows.map(function (r) {
      var t = r.trilemma || {}
      var cells = flags.map(function (fl) {
        var yes = t[fl[0]] === true
        return '<span class="dld-flag ' + (yes ? 'yes' : 'no') + '" data-p="' + esc(r.protocol) + '" data-k="' + fl[0] +
          '" data-v="' + (yes ? '1' : '0') + '">' + (yes ? '✓' : '✗') + '</span>'
      }).join('')
      return '<div class="dld-vec" data-p="' + esc(r.protocol) + '"><span class="proto">' + esc(r.protocol) + '</span>' + cells + '</div>'
    }).join('')
    box.innerHTML = head + body
    if (cxBox) {
      var ev = crosscheck && crosscheck.evidence
      if (ev) {
        cxBox.innerHTML =
          '<div>真 <b>createHashRing</b> ' + esc(fmt(ev.hashRingNodes)) + ' 节点 · 空片 ' + esc(fmt(ev.hashRingEmptyNodes)) + '</div>' +
          '<div>真 <b>createRedisCache</b> 幂等键双写后 entries <b>' + esc(fmt(ev.redisEntries)) + '</b> 条</div>' +
          '<div>真 <b>createWal</b> append/replay 行数 <b>' + esc(fmt(ev.walLines)) + '</b>（进程内 sink、不跨机 durable）</div>' +
          '<div>真 <b>createBus</b> fire-and-forget 交付 <b>' + esc(fmt(ev.busDelivered)) + '</b> 条</div>' +
          '<div>真 <b>createTokenBucket</b> 固定 tick 白名单 allow() <b>' + (ev.tokenBucketOk === true ? '✓' : '✗') + '</b>（refillPerSec 真生效）</div>' +
          '<div>真 <b>createBPlusTree</b> dueAt 有序插入 + range 捞到期 <b>' + esc(fmt(ev.bplusRangeCount)) + '</b> 条</div>' +
          '<div>真 <b>createObjectPool</b> stats().acquired <b>' + esc(fmt(ev.poolAcquired)) + '</b> 次（非硬编码，复用省 GC 分配）</div>'
      } else {
        cxBox.innerHTML = '<div class="nodata">真件交叉印证缺失</div>'
      }
    }
    var v = verdict || {}
    var noWin = v.noUniversalWinner === true
    var heapZ = v.minHeapZeroLateMs === true
    var zsetSurvives = v.redisZsetNeverSilentLossOnRestart === true
    var wheelLoss = v.timingWheelLosesOnRestart === true || v.wheelRestartLoses === true
    var chips = [
      '<span class="chip" data-verdict="wheelCheapest"><b>TimingWheel</b> 最省 ' + (v.wheelCheapest ? '✓' : '✗') + ' · 重启丢 ' + (wheelLoss ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="minHeapZeroLateMs"><b>MinHeap</b> 零晚点 ' + (heapZ ? '✓' : '✗') + ' · 比较数累积 ' + (v.heapPaysComparisons ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="redisZsetNeverSilentLossOnRestart"><b>RedisZset</b> 重启不丢 ' + (zsetSurvives ? '✓' : '✗') + ' · 轮询成本 ' + (v.zsetPaysPollRtt ? '✓' : '✗') + '</span>',
      '<span class="chip ' + (noWin ? 'jade-t' : 'muted-t') + '" data-verdict="noUniversalWinner">' + (noWin ? '✓ 没有任何协议能同时占三难' : '判词塌陷') + '</span>',
    ]
    var probes = $('#dld-probes')
    if (probes) probes.innerHTML = chips.join('')
    if (note) note.textContent = '维序固定 [低开销 / 即时精确 / 共享可持久化]。向量 TimingWheel=100 / MinHeap=010 / RedisZset=001，互异、无一 111。' +
      '可证伪：rigged zeroTick+freeHeapOps+sharedBackend 齐开 ⇒ 时间轮与最小堆退化 111，但 ZSET 的轮询周期晚点 + 中心 RTT 没有对应开关可抹 ⇒ 向量现算 111/111/001、判词仍翻 false（不硬覆盖成全 111）；单开 zeroTick 只让时间轮精确（不连坐）。' +
      'workerRestart 只罚 sharedDurable 不连带罚 punctual。全为确定性教学状态机，结构计数，不声称墙钟/QPS/真跨机/真 Lua/真有序集合。'
  }


  /* ================= KI-520 消息重试退避 × 死信 · 第十七维（rdq 族） ================= */

  function renderRetryDlq(rdlq) {
    renderRdqMatrix(rdlq && rdlq.rows, rdlq && rdlq.config)
    renderRdqLadder(rdlq && rdlq.rows)
    renderRdqTrilemma(rdlq && rdlq.rows, rdlq && rdlq.verdict, rdlq && rdlq.crosscheck)
  }

  function rdqMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">' + esc(label) + ' 暂缺</div>'
    if (note) note.textContent = 'systems.retryDlq 缺失 — 跑一次 npm run console:data 即可补齐'
  }

  function rdqState(s) {
    if (!s) return { cls: '', ch: '·' }
    if (isNum(s.deadLettered) && s.deadLettered > 0) return { cls: 'lost', ch: '死' }
    if (isNum(s.retries) && s.retries > 64) return { cls: 'expensive', ch: '重' }
    if (s.noStorm === false) return { cls: 'lost', ch: '暴' }
    if (s.noHerd === false) return { cls: 'dup', ch: '惊' }
    if (s.fastRecovery && s.noStorm && s.noHerd) return { cls: 'ok', ch: '✓' }
    return { cls: '', ch: '?' }
  }

  function renderRdqMatrix(rows, config) {
    var box = $('#rdq-matrix'), note = $('#rdq-matrix-note')
    if (!Array.isArray(rows) || !rows.length || !config || !Array.isArray(config.scenarios)) {
      rdqMissing(box, note, 'rdq 矩阵'); return
    }
    var scenarios = config.scenarios
    var head = '<div class="rdq-mat-row rdq-mat-head"><span class="rdq-mat-proto">协议</span>' +
      scenarios.map(function (sc) { return '<span class="rdq-sc">' + esc(sc) + '</span>' }).join('') +
      '<span class="rdq-mat-cost">死/暴/怀</span></div>'
    var body = rows.map(function (row) {
      var cells = scenarios.map(function (sc) {
        var cell = Array.isArray(row.scenarios) ? row.scenarios.find(function (x) { return x.id === sc }) : null
        var st = rdqState(cell)
        return '<span class="rdq-cell ' + st.cls + '" data-p="' + esc(row.protocol) + '" data-s="' + esc(sc) +
          '" data-state="' + (st.cls || 'na') + '">' + st.ch + '</span>'
      }).join('')
      var t = row.totals || {}
      return '<div class="rdq-mat-row" data-p="' + esc(row.protocol) + '">' +
        '<span class="rdq-mat-proto">' + esc(row.protocol) + '</span>' +
        cells + '<span class="rdq-mat-cost"><b>' + esc(fmt(t.deadLettered)) + '</b></span></div>'
    }).join('')
    box.innerHTML = head + body
    if (note) note.textContent = '失败即重投(Immediate)/ 指数退避(Exponential)/ 全抖动退避(FullJitter) × 六场景。' +
      'Immediate 零退避 1 tick 重试 ⇒ 风暴全由自身挤死预算；Exponential 退避压低施压频率但同刻失败会共振惊群——同一 delay 同时重试；' +
      'FullJitter 每条独立 rand 撒开 ⇒ 无风暴 ∧ 无惊群，代价是恢复更慢藏在 recoveryLag 里。' +
      '全为确定性教学状态机，结构计数，不声称墙钟/QPS/真 MQ/真 Redis DLQ。'
  }

  function renderRdqLadder(rows) {
    var box = $('#rdq-ladder')
    if (!box || !Array.isArray(rows) || !rows.length) { if (box) box.innerHTML = ''; return }
    var max = Math.max.apply(null, rows.map(function (r) { return r.totals && isNum(r.totals.retries) ? r.totals.retries : 0 }).concat([1]))
    box.innerHTML = rows.map(function (r) {
      var t = r.totals || {}
      var w = isNum(t.retries) ? Math.round(t.retries / max * 100) : 0
      return '<div class="rdq-line" data-p="' + esc(r.protocol) + '"><span class="tag">' + esc(r.protocol) + '</span>' +
        '<span class="rdq-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="num">重试 ' + esc(fmt(t.retries)) + ' · 死信 ' + esc(fmt(t.deadLettered)) + ' · stormΣ ' + esc(fmt(t.stormPerMsg)) + ' · 惊峰 ' + esc(fmt(t.herdPeaks)) + ' · lag ' + esc(fmt(t.recoveryLag)) + '</span></div>'
    }).join('')
  }

  function renderRdqTrilemma(rows, verdict, crosscheck) {
    var box = $('#rdq-trilemma'), cxBox = $('#rdq-crosscheck'), note = $('#rdq-trilemma-note')
    if (!Array.isArray(rows) || !rows.length) {
      rdqMissing(box, note, 'rdq 判词'); if (cxBox) cxBox.innerHTML = ''; return
    }
    var flags = [['fastRecovery', '快速恢复'], ['noStorm', '无重试风暴'], ['noHerd', '无惊群']]
    var head = '<div class="rdq-vec rdq-vec-head"><span class="proto">协议</span>' +
      flags.map(function (fl) { return '<span>' + fl[1] + '</span>' }).join('') + '</div>'
    var body = rows.map(function (r) {
      var t = r.trilemma || {}
      var cells = flags.map(function (fl) {
        var yes = t[fl[0]] === true
        return '<span class="rdq-flag ' + (yes ? 'yes' : 'no') + '" data-p="' + esc(r.protocol) + '" data-k="' + fl[0] +
          '" data-v="' + (yes ? '1' : '0') + '">' + (yes ? '✓' : '✗') + '</span>'
      }).join('')
      return '<div class="rdq-vec" data-p="' + esc(r.protocol) + '"><span class="proto">' + esc(r.protocol) + '</span>' + cells + '</div>'
    }).join('')
    box.innerHTML = head + body
    if (cxBox) {
      var ev = crosscheck && crosscheck.evidence
      if (ev) {
        cxBox.innerHTML =
          '<div>真 <b>createMinHeapDelayQueue</b> advance 出队 <b>' + esc(fmt(ev.heapFired)) + '</b> 条（tile 20/8% 上限样本）</div>' +
          '<div>真 <b>createTokenBucket</b> 5 次 allow 中放行 <b>' + esc(fmt(ev.bucketAllowed)) + '</b> 次（拒 ' + esc(fmt(ev.bucketRejected)) + '）</div>' +
          '<div>真 <b>createWal</b> append ' + esc(fmt(ev.walLines)) + ' / restore+replay <b>' + esc(fmt(ev.walReplayed)) + '</b>（sink 进程内、重机损毁不 durable）</div>' +
          '<div>真 <b>createHashRing</b> ' + esc(fmt(ev.hashRingNodes)) + ' 节点 · 空片 ' + esc(fmt(ev.hashRingEmptyNodes)) + '</div>' +
          '<div>真 <b>createRedisCache</b> 幂等键双写后 entries=' + esc(fmt(ev.idemEntries)) + '（命中去重证）</div>' +
          '<div>真 <b>createBus</b> 死信通知 listenerCount <b>' + esc(fmt(ev.busListeners)) + '</b> · publish ' + esc(fmt(ev.deadNotices)) + ' 条</div>' +
          '<div>真 <b>createObjectPool</b> acquire×3（任务对象复用）</div>'
      } else {
        cxBox.innerHTML = '<div class="nodata">真件交叉印证缺失</div>'
      }
    }
    var v = verdict || {}
    var noWin = v.noUniversalWinner === true
    var ziStorm = v.immediateStorms ? '是' : '否'
    var expNoStorm = v.exponentialNoStorm ? '是' : '否'
    var jitterNoHerd = v.fullJitterNoHerd ? '是' : '否'
    var chips = [
      '<span class="chip" data-verdict="immediateStorms"><b>Immediate</b> 风暴 ' + ziStorm + ' · 同刻惊群必然</span>',
      '<span class="chip" data-verdict="exponentialNoStorm"><b>Exponential</b> 无风暴 ' + expNoStorm + ' · 单 delay 同刻共振</span>',
      '<span class="chip" data-verdict="fullJitterNoHerd"><b>FullJitter</b> 无惊群 ' + jitterNoHerd + ' · 恢复代价藏在 lag 里</span>',
      '<span class="chip ' + (noWin ? 'jade-t' : 'muted-t') + '" data-verdict="noUniversalWinner">' + (noWin ? '✓ 没有协议同时占三难' : '判词塌陷') + '</span>',
    ]
    var probes = $('#rdq-probes')
    if (probes) probes.innerHTML = chips.join('')
    if (note) note.textContent = '维序固定 [快速恢复 / 无重试风暴 / 无惊群]。向量 Immediate=100 / Exponential=010 / FullJitter=011，三者互异、无一 111。' +
      '可证伪：rigged zeroBackoff+perfectJitter+noRetryBudget 齐开 ⇒ 三协议退 001/001/001、判词翻 false；' +
      'fastRecovery 只罚有故障恢复的场景、slow=010 那行 single switch 只动一处。workerRestart 不以此维为卖点（本件不考重启）。' +
      '全为确定性教学状态机，结构计数，不声称墙钟/QPS/真 MQ/真 Redis DLQ。'
  }

  /* ================= KI-523 消费者组 rebalance / 分区所有权 · 第十八维（cgp 族） ================= */

  function renderConsumerGroup(cgp) {
    renderCgpMatrix(cgp && cgp.rows, cgp && cgp.config)
    renderCgpLadder(cgp && cgp.rows)
    renderCgpTrilemma(cgp && cgp.rows, cgp && cgp.verdict, cgp && cgp.crosscheck)
  }

  function cgpMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">' + esc(label) + ' 暂缺</div>'
    if (note) note.textContent = 'systems.consumerGroup 缺失 — 跑一次 npm run console:data 即可补齐'
  }

  function cgpState(s) {
    if (!s) return { cls: '', ch: '·' }
    // 六场景正交：核心件已在每格算好三布尔，只在「该场景负责的维度」判定，其余维空真——与 trilemma 同源，绝不拿阈值重算。
    if (s.starved === true) return { cls: 'starve', ch: '饥' }
    if (s.balanced === false) return { cls: 'skew', ch: '斜' }
    if (s.minimalMovement === false) return { cls: 'migrate', ch: '迁' }
    if (s.cheap === false) return { cls: 'costly', ch: '贵' }
    return { cls: 'ok', ch: '✓' }
  }

  function renderCgpMatrix(rows, config) {
    var box = $('#cgp-matrix'), note = $('#cgp-matrix-note')
    if (!Array.isArray(rows) || !rows.length || !config || !Array.isArray(config.scenarios)) {
      cgpMissing(box, note, 'cgp 矩阵'); return
    }
    var scenarios = config.scenarios
    var head = '<div class="cgp-mat-row cgp-mat-head"><span class="cgp-mat-proto">协议</span>' +
      scenarios.map(function (sc) { return '<span class="cgp-sc">' + esc(sc) + '</span>' }).join('') +
      '<span class="cgp-mat-cost">移/斜</span></div>'
    var body = rows.map(function (row) {
      var cells = scenarios.map(function (sc) {
        var cell = Array.isArray(row.scenarios) ? row.scenarios.find(function (x) { return x.id === sc }) : null
        var st = cgpState(cell)
        return '<span class="cgp-cell ' + st.cls + '" data-p="' + esc(row.protocol) + '" data-s="' + esc(sc) +
          '" data-state="' + (st.cls || 'na') + '">' + st.ch + '</span>'
      }).join('')
      var m = row.metrics || {}
      return '<div class="cgp-mat-row" data-p="' + esc(row.protocol) + '">' +
        '<span class="cgp-mat-proto">' + esc(row.protocol) + '</span>' +
        cells + '<span class="cgp-mat-cost"><b>' + esc(fmt(m.moveSum)) + '</b>/' + esc(fmt(m.avgImbalance)) + '</span></div>'
    }).join('')
    box.innerHTML = head + body
    if (note) note.textContent = 'Range / RoundRobin / Sticky × 六场景：steadyState（稳态）/ partitionSkew（多 topic 余数偏斜）/ heteroSubscriptions（异构订阅）/ memberJoin（新成员加入）/ memberLeave（成员退出）/ manyPartitions（大分区量开销）。' +
      '六场景正交：每格只在「该场景负责的维度」判定，其余维空真——标「斜」=公平场景负载不均衡超预算，「饥」=有消费者零分区，「迁」=成员变动场景迁移超预算，「贵」=大分区场景单分区 op 超预算，「✓」=该格在其负责维度无病征（空真不算赢家）。' +
      '标含义直接读核心件算好的 balanced/minimalMovement/cheap 三布尔，与三难向量同源，绝不拿阈值重算。stall 停摆只以 opUnits 结构计数代理，不声称墙钟秒数。全为确定性教学状态机，不声称真 Kafka / 真 broker / 真墙钟。'
  }

  function renderCgpLadder(rows) {
    var box = $('#cgp-ladder')
    if (!box || !Array.isArray(rows) || !rows.length) { if (box) box.innerHTML = ''; return }
    var max = Math.max.apply(null, rows.map(function (r) { return r.metrics && isNum(r.metrics.moveSum) ? r.metrics.moveSum : 0 }).concat([1]))
    box.innerHTML = rows.map(function (r) {
      var m = r.metrics || {}
      var w = isNum(m.moveSum) ? Math.round(m.moveSum / max * 100) : 0
      return '<div class="cgp-line" data-p="' + esc(r.protocol) + '"><span class="tag">' + esc(r.protocol) + '</span>' +
        '<span class="cgp-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="num">moveΣ ' + esc(fmt(m.moveSum)) + ' · 均斜 ' + esc(fmt(m.avgImbalance)) + ' · op/part ' + esc(fmt(m.opPerPart)) + ' · 饥 ' + (m.starved ? '是' : '否') + '</span></div>'
    }).join('')
  }

  function renderCgpTrilemma(rows, verdict, crosscheck) {
    var box = $('#cgp-trilemma'), cxBox = $('#cgp-crosscheck'), note = $('#cgp-trilemma-note')
    if (!Array.isArray(rows) || !rows.length) {
      cgpMissing(box, note, 'cgp 判词'); if (cxBox) cxBox.innerHTML = ''; return
    }
    var flags = [['balanced', '分配均衡'], ['minimalMovement', '最小迁移'], ['cheap', '算法轻量']]
    var head = '<div class="cgp-vec cgp-vec-head"><span class="proto">协议</span>' +
      flags.map(function (fl) { return '<span>' + fl[1] + '</span>' }).join('') + '</div>'
    var body = rows.map(function (r) {
      var t = r.trilemma || {}
      var cells = flags.map(function (fl) {
        var yes = t[fl[0]] === true
        return '<span class="cgp-flag ' + (yes ? 'yes' : 'no') + '" data-p="' + esc(r.protocol) + '" data-k="' + fl[0] +
          '" data-v="' + (yes ? '1' : '0') + '">' + (yes ? '✓' : '✗') + '</span>'
      }).join('')
      return '<div class="cgp-vec" data-p="' + esc(r.protocol) + '"><span class="proto">' + esc(r.protocol) + '</span>' + cells + '</div>'
    }).join('')
    box.innerHTML = head + body
    if (cxBox) {
      var ev = crosscheck && crosscheck.evidence
      if (ev) {
        cxBox.innerHTML =
          '<div>真 <b>compareRemapping</b> 增节点迁移率 一致性 <b>' + esc(fmt(ev.remapConsistentRate)) + '</b> vs 取模 ' + esc(fmt(ev.remapModuloRate)) + ' · 省 ' + esc(fmt(ev.remapSavedRate)) + '</div>' +
          '<div>真 <b>createShardRouter.remapOn</b> 迁移 <b>' + esc(fmt(ev.routerMoved)) + '</b> 片 · 率 ' + esc(fmt(ev.routerRate)) + '</div>' +
          '<div>真 <b>createHashRing</b> ' + esc(fmt(ev.hashRingNodes)) + ' 节点 · 空片 ' + esc(fmt(ev.hashRingEmptyNodes)) + '</div>' +
          '<div>真 <b>createWal</b> append ' + esc(fmt(ev.walLines)) + ' / restore+replay <b>' + esc(fmt(ev.walReplayed)) + '</b>（进程内 sink）</div>' +
          '<div>真 <b>createBus</b> rebalance 通知 <b>' + esc(fmt(ev.rebalanceNotices)) + '</b> 条 · listenerCount ' + esc(fmt(ev.busListeners)) + '</div>' +
          '<div>真 <b>createRedisCache</b> 组元数代次幂等双写后 entries=' + esc(fmt(ev.groupMetaEntries)) + '</div>' +
          '<div>真 <b>createObjectPool</b> acquire <b>' + esc(fmt(ev.poolAcquired)) + '</b> 次（分配结果对象复用省 GC）</div>' +
          '<div>真 <b>createTokenBucket</b> rebalance 防抖 allow 放行 <b>' + esc(fmt(ev.bucketAllowed)) + '</b> / 拒 ' + esc(fmt(ev.bucketRejected)) + '</div>' +
          '<div>真 <b>createMinHeapDelayQueue</b> 迁移任务 advance 出队 <b>' + esc(fmt(ev.heapFired)) + '</b> 条</div>'
      } else {
        cxBox.innerHTML = '<div class="nodata">真件交叉印证缺失</div>'
      }
    }
    var v = verdict || {}
    var noWin = v.noUniversalWinner === true
    var causal = v.minimalMovementCausallyUnerasable === true
    var starve = v.zeroMovementStarvesJoiner === true
    var chips = [
      '<span class="chip" data-verdict="rangeCheapest"><b>Range</b> 最省 ' + (v.rangeCheapest ? '是' : '否') + ' · 多 topic 偏斜 ' + (v.rangeSkews ? '是' : '否') + '</span>',
      '<span class="chip" data-verdict="roundRobinBalanced"><b>RoundRobin</b> 均衡 ' + (v.roundRobinBalanced ? '是' : '否') + ' · 成员变动迁移 ' + (v.roundRobinMigrates ? '是' : '否') + '</span>',
      '<span class="chip" data-verdict="stickyNotFreeLunch"><b>Sticky</b> 均衡∧最小迁移 ' + (v.stickyBalanced && v.stickyMinimalMovement ? '是' : '否') + ' · 非银弹 ' + (v.stickyNotFreeLunch ? '是' : '否') + '</span>',
      '<span class="chip ' + (causal ? 'jade-t' : 'muted-t') + '" data-verdict="minimalMovementCausallyUnerasable">' + (causal ? '✓ 均衡与零迁移逻辑相克 · minimalMovement 真算抹不掉' : '因果锁未触发') + '</span>',
      '<span class="chip ' + (noWin ? 'jade-t' : 'muted-t') + '" data-verdict="noUniversalWinner">' + (noWin ? '✓ 没有任何协议同时占三难' : '判词塌陷') + '</span>',
    ]
    var probes = $('#cgp-probes')
    if (probes) probes.innerHTML = chips.join('')
    if (note) note.textContent = '维序固定 [分配均衡 / 成员变动最小迁移 / 算法轻量]。向量 Range=001 / RoundRobin=100 / Sticky=110，三者互异、无一 111。' +
      '可证伪：rigged perfectBalance+zeroMovement+freeCompute 齐开 ⇒ 三协议退 101/101/101、判词翻 false；' +
      '但 perfectBalance（强制完美均衡⇒成员变动必推倒重排）与 zeroMovement（冻结归属⇒零迁移）逻辑相克，' +
      'minimalMovement 维真算无法翻回 1（causallyUnerasable），freeCompute 只抹 cheap 维——绝不硬造全 111。' +
      '单开 zeroMovement 冻结归属会让新成员饥饿（zeroMovementStarvesJoiner=' + (starve ? '是' : '否') + '）。' +
      'steadyState 的最小迁移为维序空真、非卖点（vacuousTrue），不拿稳态冒充迁移优势。' +
      '全为确定性教学状态机，结构计数，不声称墙钟/QPS/真 Kafka/真 broker。'
  }

  /* ================= KI-525 消费者组积压背压 / 流量削峰四策略诚实权衡 · 第十九维（bpc 族） ================= */

  function renderBackpressure(bpc) {
    renderBpcMatrix(bpc && bpc.rows, bpc && bpc.config)
    renderBpcLadder(bpc && bpc.rows)
    renderBpcTrilemma(bpc && bpc.rows, bpc && bpc.verdict, bpc && bpc.crosscheck, bpc && bpc.littleLaw)
  }

  function bpcMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">' + esc(label) + ' 暂缺</div>'
    if (note) note.textContent = 'systems.backpressure 缺失 — 跑一次 npm run console:data 即可补齐'
  }

  function bpcState(s) {
    if (!s) return { cls: '', ch: '·' }
    // 六负载场景正交：核心件已在每格算好三布尔，只在「该场景负责的维度」判定，其余维空真——与 trilemma 同源，绝不拿阈值重算。
    if (s.noLoss === false) return { cls: 'drop', ch: '丢' }
    if (s.lowLatency === false) return { cls: 'stall', ch: '滞' }
    if (s.highThroughput === false) return { cls: 'press', ch: '压' }
    return { cls: 'ok', ch: '✓' }
  }

  function renderBpcMatrix(rows, config) {
    var box = $('#bpc-matrix'), note = $('#bpc-matrix-note')
    if (!Array.isArray(rows) || !rows.length || !config || !Array.isArray(config.scenarios)) {
      bpcMissing(box, note, 'bpc 矩阵'); return
    }
    var scenarios = config.scenarios
    var head = '<div class="bpc-mat-row bpc-mat-head"><span class="bpc-mat-proto">策略</span>' +
      scenarios.map(function (sc) { return '<span class="bpc-sc">' + esc(sc) + '</span>' }).join('') +
      '<span class="bpc-mat-cost">丢/滞/收</span></div>'
    var body = rows.map(function (row) {
      var cells = scenarios.map(function (sc) {
        var cell = Array.isArray(row.scenarios) ? row.scenarios.find(function (x) { return x.id === sc }) : null
        var st = bpcState(cell)
        return '<span class="bpc-cell ' + st.cls + '" data-strategy="' + esc(row.strategy) + '" data-s="' + esc(sc) +
          '" data-state="' + (st.cls || 'na') + '">' + st.ch + '</span>'
      }).join('')
      var m = row.metrics || {}
      return '<div class="bpc-mat-row" data-strategy="' + esc(row.strategy) + '">' +
        '<span class="bpc-mat-proto">' + esc(row.strategy) + '</span>' +
        cells + '<span class="bpc-mat-cost"><b>' + esc(fmt(m.dropped)) + '</b>/' + esc(fmt(m.avgWait)) + '/' + esc(fmt(m.rejected)) + '</span></div>'
    }).join('')
    box.innerHTML = head + body
    if (note) note.textContent = 'Backpressure / Buffering / Shedding / Scaling × 六正交负载场景：steadyTrickle（稳态细流）/ burstAbsorb（突发吸纳）/ sustainedOverload（持续过载）/ latencySpike（时延尖峰）/ downstreamStall（下游停摆）/ memoryPressure（内存压力）。' +
      '每格只在「该场景负责的维度」判定，其余维空真——标「丢」=零丢失维破（dropped>0，反压 rejected 不算丢），「滞」=低时延维破（avgWait 超预算），「压」=高吞吐维破（acceptedRate 低于准入预算），「✓」=该格在其负责维度无病征（空真不算赢家）。' +
      '状态字直接读核心件算好的 noLoss/lowLatency/highThroughput 三布尔，与三难向量同源，绝不拿阈值重算。全为确定性教学状态机，结构计数，不声称墙钟/QPS/真 Kafka/真 broker。'
  }

  function renderBpcLadder(rows) {
    var box = $('#bpc-ladder')
    if (!box || !Array.isArray(rows) || !rows.length) { if (box) box.innerHTML = ''; return }
    var max = Math.max.apply(null, rows.map(function (r) { return r.metrics && isNum(r.metrics.peakQueue) ? r.metrics.peakQueue : 0 }).concat([1]))
    box.innerHTML = rows.map(function (r) {
      var m = r.metrics || {}
      var w = isNum(m.peakQueue) ? Math.round(m.peakQueue / max * 100) : 0
      return '<div class="bpc-line" data-strategy="' + esc(r.strategy) + '"><span class="tag">' + esc(r.strategy) + '</span>' +
        '<span class="bpc-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="num">峰队 ' + esc(fmt(m.peakQueue)) + ' · 均待 ' + esc(fmt(m.avgWait)) + ' · 丢 ' + esc(fmt(m.dropped)) + ' · 拒 ' + esc(fmt(m.rejected)) + ' · rebal ' + esc(fmt(m.rebalances)) + '</span></div>'
    }).join('')
  }

  function renderBpcTrilemma(rows, verdict, crosscheck, littleLaw) {
    var box = $('#bpc-trilemma'), llBox = $('#bpc-littlelaw'), cxBox = $('#bpc-crosscheck'), note = $('#bpc-trilemma-note')
    if (!Array.isArray(rows) || !rows.length) {
      bpcMissing(box, note, 'bpc 判词'); if (llBox) llBox.innerHTML = ''; if (cxBox) cxBox.innerHTML = ''; return
    }
    var flags = [['noLoss', '零丢失'], ['lowLatency', '低时延'], ['highThroughput', '高吞吐']]
    var head = '<div class="bpc-vec bpc-vec-head"><span class="proto">策略</span>' +
      flags.map(function (fl) { return '<span>' + fl[1] + '</span>' }).join('') + '<span class="vec">向量</span></div>'
    var body = rows.map(function (r) {
      var t = r.trilemma || {}
      var cells = flags.map(function (fl) {
        var yes = t[fl[0]] === true
        return '<span class="bpc-flag ' + (yes ? 'yes' : 'no') + '" data-strategy="' + esc(r.strategy) + '" data-k="' + fl[0] +
          '" data-v="' + (yes ? '1' : '0') + '">' + (yes ? '✓' : '✗') + '</span>'
      }).join('')
      var vec = flags.map(function (fl) { return t[fl[0]] === true ? '1' : '0' }).join('')
      return '<div class="bpc-vec" data-strategy="' + esc(r.strategy) + '"><span class="proto">' + esc(r.strategy) + '</span>' + cells +
        '<span class="vec" data-vec="' + vec + '">' + vec + '</span></div>'
    }).join('')
    box.innerHTML = head + body

    // Little's Law 双路自证：稳态 L=λW 非平凡成立、过载端队列不排空则如实破裂。
    if (llBox) {
      if (littleLaw) {
        var ll = [
          '<div class="bpc-ll-row"><b>L</b> = 稳态平均队长 · <b>W</b> = 逐消息平均等待 · <b>λ</b> = 稳态吞吐率 served/steps · <b>L′</b> = λ·W</div>'
        ]
        ll.push('<div class="bpc-ll-row"><span class="bpc-flag ' + (littleLaw.steadyHolds ? 'yes' : 'no') + '" data-ll="steadyHolds">稳态 L=λW ' + (littleLaw.steadyHolds ? '成立' : '破裂') + '</span>' +
          '<span class="bpc-flag ' + (littleLaw.steadyNontrivial ? 'yes' : 'no') + '" data-ll="steadyNontrivial">非平凡 ' + (littleLaw.steadyNontrivial ? '是' : '否') + '</span>' +
          '<span class="bpc-flag ' + (littleLaw.overloadBreaks ? 'yes' : 'no') + '" data-ll="overloadBreaks">过载破裂 ' + (littleLaw.overloadBreaks ? '是' : '否') + '</span></div>')
        var samples = (Array.isArray(littleLaw.steady) ? littleLaw.steady : []).slice(0, 4).map(function (s) {
          return '<span class="bpc-ll-sample" data-ll-strategy="' + esc(s.strategy) + '">' + esc(s.strategy) + ': L=' + esc(fmt(s.L, 2)) + ' λW=' + esc(fmt(s.Lpred, 2)) + ' gap=' + esc(fmt(s.gap, 2)) + '</span>'
        }).join('')
        if (samples) ll.push('<div class="bpc-ll-samples">' + samples + '</div>')
        ll.push('<p class="bpc-ll-note">' + esc(littleLaw.note || '') + '</p>')
        llBox.innerHTML = ll.join('')
      } else {
        llBox.innerHTML = '<div class="nodata">Little\'s Law 读数缺失</div>'
      }
    }

    if (cxBox) {
      var ev = crosscheck && crosscheck.evidence
      if (ev) {
        cxBox.innerHTML =
          '<div>真 <b>createTokenBucket</b> 准入 allow <b>' + esc(fmt(ev.bucketAllowed)) + '</b> / 拒 ' + esc(fmt(ev.bucketRejected)) + '</div>' +
          '<div>真 <b>createLeakyBucket</b> 整形 allow <b>' + esc(fmt(ev.leakyAllowed)) + '</b> / 拒 ' + esc(fmt(ev.leakyRejected)) + '</div>' +
          '<div>真 <b>createRedisZsetDelayQueue</b> durable 缓冲 fire ' + esc(fmt(ev.zqFired)) + ' · 恢复后 pending ' + esc(fmt(ev.zqPendingAfterRestore)) + ' · 重启丢 ' + esc(fmt(ev.zqLostOnRestart)) + '</div>' +
          '<div>真 <b>createMinHeapDelayQueue</b> 精确排程 advance 出队 <b>' + esc(fmt(ev.heapFired)) + '</b> 条</div>' +
          '<div>真 <b>createWal</b> 积压 append ' + esc(fmt(ev.walLines)) + ' / restore+replay <b>' + esc(fmt(ev.walReplayed)) + '</b></div>' +
          '<div>真 <b>createShardedCache</b> 分片缓冲命中 <b>' + esc(fmt(ev.shardHits)) + '</b></div>' +
          '<div>真 <b>createBloomFilter</b> 重复消费判重 hit=' + esc(String(ev.bloomHit)) + ' miss=' + esc(String(ev.bloomMiss)) + '</div>' +
          '<div>真 <b>createFullJitterBackoff</b> shedding 退避抖开 <b>' + esc(fmt(ev.jitterSpread)) + '</b></div>' +
          '<div>真 <b>createPackedCounters</b> 队列深度紧凑计数 Σ=' + esc(fmt(ev.counterSum)) + ' 假共享=' + esc(fmt(ev.counterFalseSharing)) + '</div>' +
          '<div>真 <b>createObjectPool</b> 消息对象 建 ' + esc(fmt(ev.poolCreated)) + ' / 复用 <b>' + esc(fmt(ev.poolReused)) + '</b>（省 GC）</div>' +
          '<div>真 <b>createBus</b> 水位告警通知 <b>' + esc(fmt(ev.watermarkNotices)) + '</b> 条 · listenerCount ' + esc(fmt(ev.busListeners)) + '</div>'
      } else {
        cxBox.innerHTML = '<div class="nodata">真件交叉印证缺失</div>'
      }
    }

    var v = verdict || {}
    var noWin = v.noUniversalWinner === true
    var causal = v.highThroughputCausallyUnerasable === true
    var chips = [
      '<span class="chip" data-verdict="backpressureRejectsBursts"><b>Backpressure</b> 突发真反压 ' + (v.backpressureRejectsBursts ? '是' : '否') + '</span>',
      '<span class="chip" data-verdict="bufferingPaysLatency"><b>Buffering</b> 削峰付时延 ' + (v.bufferingPaysLatency ? '是' : '否') + '</span>',
      '<span class="chip" data-verdict="sheddingNotFreeLunch"><b>Shedding</b> 主动真丢 ' + (v.sheddingDropsMessages ? '是' : '否') + ' · 非银弹 ' + (v.sheddingNotFreeLunch ? '是' : '否') + '</span>',
      '<span class="chip" data-verdict="scalingStallsOnRebalance"><b>Scaling</b> 扩容付 rebalance 空窗 ' + (v.scalingStallsOnRebalance ? '是' : '否') + '</span>',
      '<span class="chip" data-verdict="bufferingDropsUnderMemoryPressure"><b>Buffering</b> 内存压紧真丢 ' + (v.bufferingDropsUnderMemoryPressure ? '是' : '否') + '</span>',
      '<span class="chip ' + (causal ? 'jade-t' : 'muted-t') + '" data-verdict="highThroughputCausallyUnerasable">' + (causal ? '✓ 零丢失∧低时延∧无限缓冲齐开·高吞吐真算抹不掉（L=λW 逼出反压）' : 'rigged 三开关未触发：四向量退 110、无一 111，绝不硬造全赢家') + '</span>',
      '<span class="chip ' + (noWin ? 'jade-t' : 'muted-t') + '" data-verdict="noUniversalWinner">' + (noWin ? '✓ 没有任何策略同时占三难' : '判词塌陷') + '</span>',
    ]
    var probes = $('#bpc-probes')
    if (probes) probes.innerHTML = chips.join('')
    if (note) note.textContent = '维序固定 [零丢失 / 低时延 / 高吞吐]。默认向量 Backpressure=110 / Buffering=101 / Shedding=011 / Scaling=100，四者互异、无一 111。' +
      '三口径严格正交：零丢失只看 dropped===0（反压 rejected 不算丢）、低时延只看 avgWait≤预算、高吞吐只看 acceptedRate=(arrivals−rejected)/arrivals≥预算（主动丢弃不拖慢上游，故 Shedding 不伤吞吐维）。' +
      'rigged 因果锁：零丢失∧有界时延∧无限缓冲齐开 ⇒ 四策略真实现算退 110 且高吞吐 causallyUnerasable（有界队列锁 W、L=λW 逼出 L 有界、μ<λ 唯一出路是反压、acceptedRate 被钳到 μ/λ），三开关无一能翻回该维，绝不硬造全 111。' +
      'Little′s Law 稳态自证非平凡（非全零排队）、过载端 endQueue>0 时稳态形式如实破裂。全为确定性教学状态机，结构计数，不声称墙钟/QPS/真 Kafka/真 broker。'
  }

  /* ============ KI-526 第二十维：append-only 日志压缩 / 回放边界 ============ */
  function renderLogCompaction(lc) {
    renderLcMatrix(lc && lc.rows, lc && lc.config)
    renderLcLadder(lc && lc.rows)
    renderLcTrilemma(lc && lc.rows, lc && lc.verdict, lc && lc.crosscheck, lc && lc.replayBoundary)
  }

  function lcMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">' + esc(label) + ' 暂缺</div>'
    if (note) note.textContent = 'systems.logCompaction 缺失 — 跑一次 npm run console:data 即可补齐'
  }

  function lcState(s) {
    if (!s) return { cls: '', ch: '·' }
    // 六场景正交：核心件已在每格算好三布尔，只在「该场景负责的维度」判定，其余维空真——与 trilemma 同源，绝不拿阈值重算。
    if (s.compactFootprint === false) return { cls: 'occupy', ch: '占' }
    if (s.replayCompleteness === false) return { cls: 'drop', ch: '丢' }
    if (s.fastRecovery === false) return { cls: 'stall', ch: '滞' }
    return { cls: 'ok', ch: '✓' }
  }

  function renderLcMatrix(rows, config) {
    var box = $('#lc-matrix'), note = $('#lc-matrix-note')
    if (!Array.isArray(rows) || !rows.length || !config || !Array.isArray(config.scenarios)) {
      lcMissing(box, note, 'lc 矩阵'); return
    }
    var scenarios = config.scenarios
    var head = '<div class="lc-mat-row lc-mat-head"><span class="lc-mat-proto">策略</span>' +
      scenarios.map(function (sc) { return '<span class="lc-sc">' + esc(sc) + '</span>' }).join('') +
      '<span class="lc-mat-cost">压/重放/丢</span></div>'
    var body = rows.map(function (row) {
      var cells = scenarios.map(function (sc) {
        var cell = Array.isArray(row.scenarios) ? row.scenarios.find(function (x) { return x.id === sc }) : null
        var st = lcState(cell)
        return '<span class="lc-cell ' + st.cls + '" data-strategy="' + esc(row.strategy) + '" data-s="' + esc(sc) +
          '" data-state="' + (st.cls || 'na') + '">' + st.ch + '</span>'
      }).join('')
      var m = row.metrics || {}
      return '<div class="lc-mat-row" data-strategy="' + esc(row.strategy) + '">' +
        '<span class="lc-mat-proto">' + esc(row.strategy) + '</span>' +
        cells + '<span class="lc-mat-cost"><b>' + esc(fmt(m.compactedOps)) + '</b>/' + esc(fmt(m.replayOps)) + '/' + esc(fmt(m.missingOps)) + '</span></div>'
    }).join('')
    box.innerHTML = head + body
    if (note) note.textContent = 'SizeTimeRetention / KeyCompaction / SnapshotPlusWal × 六正交场景：steadyAppend（稳态追加）/ hotKeyChurn（热 key 反复更新）/ tombstoneBurst（批量删除·墓碑边界）/ slowConsumer（慢消费者积压）/ crashMidReplay（回放中途崩溃·LSN 幂等）/ retentionPressure（日志暴涨）。' +
      '每格只在「该场景负责的维度」判定，其余维空真——标「占」=省空间维破（writeAmplification>1 或占用高），「丢」=回放完整维破（该回放位点不丢历史 / 不重不漏 / 无墓碑复活），「滞」=恢复快维破（replayOps 超预算），「✓」=该格在其负责维度无病征（空真不算赢家）。' +
      '状态字直接读核心件算好的 compactFootprint/replayCompleteness/fastRecovery 三布尔，与三难向量同源，绝不拿阈值重算。tombstone 复活单列诚实判词、不污染 KeyCompaction 完整性维。全为确定性教学状态机，结构计数，不声称墙钟恢复毫秒 / QPS / 真 Kafka log cleaner / 真 RocksDB compaction。'
  }

  function renderLcLadder(rows) {
    var box = $('#lc-ladder')
    if (!box || !Array.isArray(rows) || !rows.length) { if (box) box.innerHTML = ''; return }
    var max = Math.max.apply(null, rows.map(function (r) { return r.metrics && isNum(r.metrics.replayOps) ? r.metrics.replayOps : 0 }).concat([1]))
    box.innerHTML = rows.map(function (r) {
      var m = r.metrics || {}
      var w = isNum(m.replayOps) ? Math.round(m.replayOps / max * 100) : 0
      return '<div class="lc-line" data-strategy="' + esc(r.strategy) + '"><span class="tag">' + esc(r.strategy) + '</span>' +
        '<span class="lc-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="num">压 ' + esc(fmt(m.compactedOps)) + ' · 重放 ' + esc(fmt(m.replayOps)) + ' · 峰写放大 ' + esc(fmt(m.peakWriteAmplification, 2)) + ' · 丢 ' + esc(fmt(m.missingOps)) + ' · 复活 ' + esc(fmt(m.tombstoneResurrect)) + '</span></div>'
    }).join('')
  }

  function renderLcTrilemma(rows, verdict, crosscheck, replayBoundary) {
    var box = $('#lc-trilemma'), rbBox = $('#lc-replay'), cxBox = $('#lc-crosscheck'), note = $('#lc-trilemma-note')
    if (!Array.isArray(rows) || !rows.length) {
      lcMissing(box, note, 'lc 判词'); if (rbBox) rbBox.innerHTML = ''; if (cxBox) cxBox.innerHTML = ''; return
    }
    var flags = [['compactFootprint', '省空间'], ['replayCompleteness', '回放完整'], ['fastRecovery', '恢复快']]
    var head = '<div class="lc-vec lc-vec-head"><span class="proto">策略</span>' +
      flags.map(function (fl) { return '<span>' + fl[1] + '</span>' }).join('') + '<span class="vec">向量</span></div>'
    var body = rows.map(function (r) {
      var t = r.trilemma || {}
      var cells = flags.map(function (fl) {
        var yes = t[fl[0]] === true
        return '<span class="lc-flag ' + (yes ? 'yes' : 'no') + '" data-strategy="' + esc(r.strategy) + '" data-k="' + fl[0] +
          '" data-v="' + (yes ? '1' : '0') + '">' + (yes ? '✓' : '✗') + '</span>'
      }).join('')
      var vec = flags.map(function (fl) { return t[fl[0]] === true ? '1' : '0' }).join('')
      return '<div class="lc-vec" data-strategy="' + esc(r.strategy) + '"><span class="proto">' + esc(r.strategy) + '</span>' + cells +
        '<span class="vec" data-vec="' + vec + '">' + vec + '</span></div>'
    }).join('')
    box.innerHTML = head + body

    // 回放边界守恒双路自证：稳态真撞合 + 三路篡改各自翻 false
    if (rbBox) {
      if (replayBoundary) {
        var rb = [
          '<div class="lc-rb-row"><b>A 成本守恒</b> replayOps ≥ totalOps − compactedOps − foldedOps · <b>B 完整性守恒</b> 按模式分派（retention 覆盖回放位点 / key 无墓碑复活 / snapshot WAL 不断档）</div>'
        ]
        rb.push('<div class="lc-rb-row"><span class="lc-flag ' + (replayBoundary.holds ? 'yes' : 'no') + '" data-rb="holds">稳态守恒 ' + (replayBoundary.holds ? '成立' : '破裂') + '</span>' +
          '<span class="lc-flag ' + (replayBoundary.nontrivial ? 'yes' : 'no') + '" data-rb="nontrivial">非平凡 ' + (replayBoundary.nontrivial ? '是' : '否') + '</span>' +
          '<span class="lc-flag ' + (replayBoundary.falsifiable ? 'yes' : 'no') + '" data-rb="falsifiable">可证伪 ' + (replayBoundary.falsifiable ? '是' : '否') + '</span></div>')
        var tamper = replayBoundary.tamper || {}
        rb.push('<div class="lc-rb-row"><span class="lc-flag ' + (tamper.replayOps && tamper.replayOps.holds === false ? 'yes' : 'no') + '" data-rb-tamper="replayOps">篡改重放成本 ⇒ ' + (tamper.replayOps && tamper.replayOps.holds === false ? '翻 false' : '未翻') + '</span>' +
          '<span class="lc-flag ' + (tamper.walGap && tamper.walGap.replayComplete === false ? 'yes' : 'no') + '" data-rb-tamper="walGap">抹 WAL 段 ⇒ ' + (tamper.walGap && tamper.walGap.replayComplete === false ? '翻 false' : '未翻') + '</span>' +
          '<span class="lc-flag ' + (tamper.tombstone && tamper.tombstone.replayComplete === false ? 'yes' : 'no') + '" data-rb-tamper="tombstone">早清墓碑 ⇒ ' + (tamper.tombstone && tamper.tombstone.replayComplete === false ? '翻 false' : '未翻') + '</span></div>')
        rb.push('<p class="lc-rb-note">' + esc(replayBoundary.note || '') + '</p>')
        rbBox.innerHTML = rb.join('')
      } else {
        rbBox.innerHTML = '<div class="nodata">回放边界守恒读数缺失</div>'
      }
    }

    if (cxBox) {
      var ev = crosscheck && crosscheck.evidence
      if (ev) {
        cxBox.innerHTML =
          '<div>真 <b>createWal</b> append seq ' + esc(fmt(ev.walLastSeq)) + ' / lines ' + esc(fmt(ev.walLines)) + ' / restore+replay <b>' + esc(fmt(ev.walReplayed)) + '</b></div>' +
          '<div>真 <b>createRedisZsetDelayQueue</b> retention 时间窗 fire ' + esc(fmt(ev.zqFired)) + ' · 恢复后 pending ' + esc(fmt(ev.zqPendingAfterRestore)) + ' · 重启丢 ' + esc(fmt(ev.zqLostOnRestart)) + '</div>' +
          '<div>真 <b>createMinHeapDelayQueue</b> 按 LSN 精确排程 advance 出队 <b>' + esc(fmt(ev.heapFired)) + '</b> 条</div>' +
          '<div>真 <b>createShardedCache</b> key 分片压缩命中 <b>' + esc(fmt(ev.shardHits)) + '</b></div>' +
          '<div>真 <b>createBloomFilter</b> tombstone 判重 hit=' + esc(String(ev.bloomHit)) + ' miss=' + esc(String(ev.bloomMiss)) + '</div>' +
          '<div>真 <b>createPackedCounters</b> 段计数 Σ=' + esc(fmt(ev.counterSum)) + ' 假共享=' + esc(fmt(ev.counterFalseSharing)) + '</div>' +
          '<div>真 <b>createTokenBucket</b> 回放限速 allow <b>' + esc(fmt(ev.bucketAllowed)) + '</b> / 拒 ' + esc(fmt(ev.bucketRejected)) + '</div>' +
          '<div>真 <b>createObjectPool</b> 回放记录 建 ' + esc(fmt(ev.poolCreated)) + ' / 复用 <b>' + esc(fmt(ev.poolReused)) + '</b>（省 GC）</div>' +
          '<div>真 <b>createBus</b> compaction-done 通知 <b>' + esc(fmt(ev.notices)) + '</b> 条 · listenerCount ' + esc(fmt(ev.busListeners)) + '</div>' +
          '<div>真 <b>createHashRing</b> 快照分片用 ' + esc(fmt(ev.ringShardsUsed)) + ' 片 · 首 key 落 ' + esc(String(ev.ringFirst)) + '</div>' +
          '<div>真 <b>createFullJitterBackoff</b> 回放失败退避抖开 <b>' + esc(fmt(ev.jitterSpread)) + '</b></div>'
      } else {
        cxBox.innerHTML = '<div class="nodata">真件交叉印证缺失</div>'
      }
    }

    var v = verdict || {}
    var noWin = v.noUniversalWinner === true
    var causal = v.fastRecoveryCausallyUnerasable === true
    var chips = [
      '<span class="chip" data-verdict="retentionDropsSlowConsumer"><b>SizeTimeRetention</b> 慢消费者丢历史 ' + (v.retentionDropsSlowConsumer ? '是' : '否') + '</span>',
      '<span class="chip" data-verdict="keyCompactionPaysRecovery"><b>KeyCompaction</b> 全量重放付恢复 ' + (v.keyCompactionPaysRecovery ? '是' : '否') + '</span>',
      '<span class="chip" data-verdict="keyCompactionResurrectsUnderShortRetention"><b>KeyCompaction</b> 短墓碑保留致复活 ' + (v.keyCompactionResurrectsUnderShortRetention ? '是' : '否') + ' · 单列不连坐</span>',
      '<span class="chip" data-verdict="snapshotPaysWriteAmplification"><b>SnapshotPlusWal</b> 双写放大不省空间 ' + (v.snapshotPaysWriteAmplification ? '是' : '否') + '</span>',
      '<span class="chip" data-verdict="snapshotExactlyOnce"><b>SnapshotPlusWal</b> exactly-once 真去重 ' + (v.snapshotExactlyOnce ? '是' : '否') + '</span>',
      '<span class="chip" data-verdict="replayBoundaryFalsifiable">回放边界三路篡改可证伪 ' + (v.replayBoundaryFalsifiable ? '是' : '否') + '</span>',
      '<span class="chip ' + (causal ? 'jade-t' : 'muted-t') + '" data-verdict="fastRecoveryCausallyUnerasable">' + (causal ? '✓ 全保留+零空间快照+零成本重放齐开·恢复快真算抹不掉（保全部⇒重放≥总量、空快照⇒无物化态可载）' : 'rigged 三开关未触发：三向量退 110、无一 111，绝不硬造全赢家') + '</span>',
      '<span class="chip ' + (noWin ? 'jade-t' : 'muted-t') + '" data-verdict="noUniversalWinner">' + (noWin ? '✓ 没有任何策略同时占三难' : '判词塌陷') + '</span>',
    ]
    var probes = $('#lc-probes')
    if (probes) probes.innerHTML = chips.join('')
    if (note) note.textContent = '维序固定 [省空间 / 回放完整 / 恢复快]。默认向量 SizeTimeRetention=101 / KeyCompaction=110 / SnapshotPlusWal=011，三者互异、无一 111，恰好各缺一维。' +
      '三口径严格正交：省空间只看 writeAmplification≤预算、回放完整只看 verifyReplayBoundary.replayComplete（相对回放位点）、恢复快只看 replayOps≤预算。' +
      'rigged 因果锁：全保留（补 Retention 完整性）⇒compactFootprint 保持但 replayOps≥totalOps 逼恢复慢；零空间快照（补 Snapshot 省空间）⇒无物化态可载、全量重放逼恢复慢；零成本重放是许愿、不改写真 replayOps —— 三开关无一能翻回恢复快，绝不硬造全 111。' +
      '回放边界双路守恒（成本 A + 完整性 B）稳态非平凡成立，篡改重放成本 / 抹 WAL 段 / 早清 tombstone 三路各自独立翻 false。全为确定性教学状态机，结构计数，不声称墙钟恢复毫秒 / QPS / 真 Kafka log cleaner / 真 RocksDB compaction。'
  }

  /* ================= KI-528 LRU/2Q/ARC 三替换策略 · 第二十二维（cr 族） ================= */

  function renderCacheReplacement(cr) {
    renderCrMatrix(cr && cr.rows, cr && cr.config)
    renderCrLadder(cr && cr.rows)
    renderCrTrilemma(cr && cr.rows, cr && cr.verdict, cr && cr.crosscheck)
  }

  function crMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">' + esc(label) + ' 暂缺</div>'
    if (note) note.textContent = 'systems.cacheReplacement 缺失 — 跑一次 npm run console:data 即可补齐'
  }

  function crState(s) {
    if (!s) return { cls: '', ch: '·' }
    // 六场景正交：核心件已在每格算好三布尔，只在「该场景负责的维度」判定，其余维空真——与 trilemma 同源，绝不拿阈值重算。
    // 只在某维 ===false（即本格真暴露该软肋）时落软肋字；三策略软肋各不相同：LRU 顺扫污染 / ARC 命中抖动 / LRU·2Q 不自适应。
    if (s.scanResistance === false) return { cls: 'block', ch: '污' }     // 顺扫冲死 hot set
    if (s.stableHitRate === false) return { cls: 'unstable', ch: '抖' }   // p 自适应抖动
    if (s.adaptiveBalance === false) return { cls: 'adapt', ch: '僵' }    // 固定 k / 无幽灵链适配
    return { cls: 'ok', ch: '✓' }
  }

  function renderCrMatrix(rows, config) {
    var box = $('#cr-matrix'), note = $('#cr-matrix-note')
    if (!Array.isArray(rows) || !rows.length || !config || !Array.isArray(config.scenarios)) {
      crMissing(box, note, 'cr 矩阵'); return
    }
    var scenarios = config.scenarios
    var head = '<div class="cr-mat-row cr-mat-head"><span class="cr-mat-proto">策略</span>' +
      scenarios.map(function (sc) { return '<span class="cr-sc">' + esc(sc) + '</span>' }).join('') +
      '<span class="cr-mat-cost">命中/漂/适配</span></div>'
    var body = rows.map(function (row) {
      var cells = scenarios.map(function (sc) {
        var cell = Array.isArray(row.scenarios) ? row.scenarios.find(function (x) { return x.id === sc }) : null
        var st = crState(cell)
        return '<span class="cr-cell ' + st.cls + '" data-strategy="' + esc(row.protocol) + '" data-s="' + esc(sc) +
          '" data-state="' + (st.cls || 'na') + '">' + st.ch + '</span>'
      }).join('')
      var m = row.metrics || {}
      return '<div class="cr-mat-row" data-strategy="' + esc(row.protocol) + '">' +
        '<span class="cr-mat-proto">' + esc(row.protocol) + '</span>' +
        cells + '<span class="cr-mat-cost"><b>' + esc(fmt(m.hitRateAvg)) + '</b>/' + esc(fmt(m.ghostAdaptMoves)) + '/' + esc(fmt(m.adaptationP)) + '</span></div>'
    }).join('')
    box.innerHTML = head + body
    if (note) note.textContent = 'LRU / 2Q / ARC × 六场景：uniformHot（均匀热集）/ forwardHot（单向滑动热集）/ dualLocality（双 zone 双 hot set）/ scanFeast（暖身→顺扫→重暖）/ burstAlternates（轮流冲击）/ zipfDrift（zipf 热变量偏移）。' +
      '每格只认真件算好的三布尔（scanResistance/stableHitRate/adaptiveBalance）——绝不拿阈值重算。' +
      'LRU: 热点命中强/scan 冲刷/无自适应；2Q: 顺扫可抵/固定 k 无适配；ARC: 自适应但有抖动。'
  }

  function renderCrLadder(rows) {
    var box = $('#cr-ladder')
    if (!box || !Array.isArray(rows) || !rows.length) { if (box) box.innerHTML = ''; return }
    var max = Math.max.apply(null, rows.map(function (r) { return r.metrics && isNum(r.metrics.hitRateAvg) ? r.metrics.hitRateAvg : 0 }).concat([0.0001]))
    box.innerHTML = rows.map(function (r) {
      var m = r.metrics || {}
      var w = isNum(m.hitRateAvg) ? Math.round(m.hitRateAvg / max * 100) : 0
      return '<div class="cr-line" data-strategy="' + esc(r.protocol) + '"><span class="tag">' + esc(r.protocol) + '</span>' +
        '<span class="cr-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="num">命中 ' + esc(fmt(m.hitRateAvg)) + ' · 鬼 ' + esc(fmt(m.ghostAdaptMoves)) + ' · p=' + esc(fmt(m.adaptationP)) + '</span></div>'
    }).join('')
  }

  function renderCrTrilemma(rows, verdict, crosscheck) {
    var box = $('#cr-trilemma'), veBox = $('#cr-verif'), cxBox = $('#cr-crosscheck'), note = $('#cr-trilemma-note')
    if (!Array.isArray(rows) || !rows.length) {
      crMissing(box, note, 'cr 判词'); if (cxBox) cxBox.innerHTML = ''; if (veBox) veBox.innerHTML = ''; return
    }
    var flags = [['scanResistance', '扫抵抗'], ['stableHitRate', '命中稳定'], ['adaptiveBalance', '自适应优美']]
    var head = '<div class="cr-vec cr-vec-head"><span class="proto">策略</span>' +
      flags.map(function (fl) { return '<span>' + fl[1] + '</span>' }).join('') + '<span class="vec">向量</span></div>'
    var body = rows.map(function (r) {
      var t = r.trilemma || {}
      var cells = flags.map(function (fl) {
        var yes = t[fl[0]] === true
        return '<span class="cr-flag ' + (yes ? 'yes' : 'no') + '" data-strategy="' + esc(r.protocol) + '" data-k="' + fl[0] +
          '" data-v="' + (yes ? '1' : '0') + '">' + (yes ? '✓' : '✗') + '</span>'
      }).join('')
      var vec = flags.map(function (fl) { return t[fl[0]] === true ? '1' : '0' }).join('')
      return '<div class="cr-vec" data-strategy="' + esc(r.protocol) + '"><span class="proto">' + esc(r.protocol) + '</span>' + cells +
        '<span class="vec" data-vec="' + vec + '">' + vec + '</span></div>'
    }).join('')
    box.innerHTML = head + body

    if (veBox) {
      var lru = rows.find(function (r) { return r.protocol === 'LRU' })
      var q2 = rows.find(function (r) { return r.protocol === '2Q' })
      var arc = rows.find(function (r) { return r.protocol === 'ARC' })
      var ds = crosscheck && crosscheck.dualSweep
      var rb = [
        '<div class="cr-rb-row"><b>三策略真跑读数</b> LRU uniformHot hitRate ' + esc(fmt(lru ? lru.metrics.hitRateAvg : 0)) +
          ' · 2Q dualLocality ' + esc(fmt(q2 ? q2.metrics.hitRateAvg : 0)) +
          ' · ARC burstAlternates ' + esc(fmt(arc ? arc.metrics.hitRateAvg : 0)) +
          '（p 真漂 ' + esc(fmt(arc ? arc.metrics.adaptationP : 0)) + ' · ghost ' + esc(fmt(arc ? arc.metrics.ghostAdaptMoves : 0)) + '）</div>',
      ]
      if (ds) {
        rb.push('<div class="cr-rb-row"><b>verifyDualSweep 双路</b> 路A(LRU幽灵重放) ' + esc(fmt(ds.laneA && ds.laneA.hitRate)) +
          ' vs 路B(hot-set重测) ' + esc(fmt(ds.laneB && ds.laneB.hitRate)) + ' · 差 ' + esc(fmt(ds.absoluteDelta)) +
          ' — <span data-rb="holds">holds ' + (ds.holds ? '✓' : '✗') + '</span> ' +
          '<span data-rb="nontrivial">nontrivial ' + (ds.nontrivial ? '✓' : '✗') + '</span> ' +
          '<span data-rb="falsifiable">falsifiable ' + (ds.falsifiable ? '✓' : '✗') + '</span></div>')
        if (ds.tamper) {
          rb.push('<div class="cr-rb-row">三路篡改真喂回同一内核现算翻 false：' +
            '<span class="cr-flag ' + (ds.tamper.laneATraceCorrupted && !ds.tamper.laneATraceCorrupted.holds ? 'yes' : 'no') + '" data-rb-tamper="laneATraceCorrupted">篡改trace ' + (ds.tamper.laneATraceCorrupted && !ds.tamper.laneATraceCorrupted.holds ? '✓驳倒' : '✗') + '</span>' +
            '<span class="cr-flag ' + (ds.tamper.laneBTraceCorrupted && !ds.tamper.laneBTraceCorrupted.holds ? 'yes' : 'no') + '" data-rb-tamper="laneBTraceCorrupted">篡改容量 ' + (ds.tamper.laneBTraceCorrupted && !ds.tamper.laneBTraceCorrupted.holds ? '✓驳倒' : '✗') + '</span>' +
            '<span class="cr-flag ' + (ds.tamper.laneBSizedNull && !ds.tamper.laneBSizedNull.holds ? 'yes' : 'no') + '" data-rb-tamper="laneBSizedNull">空集降级 ' + (ds.tamper.laneBSizedNull && !ds.tamper.laneBSizedNull.holds ? '✓驳倒' : '✗') + '</span></div>')
        }
      }
      veBox.innerHTML = rb.join('')
    }

    if (cxBox) {
      var ev = crosscheck && crosscheck.evidence
      if (ev) {
        cxBox.innerHTML =
          '<div>真 <b>compareRemapping</b> 一致性迁移率 ' + esc(fmt(ev.remapConsistentRate)) + ' vs 取模 ' + esc(fmt(ev.remapModuloRate)) + '</div>' +
          '<div>真 <b>createShardRouter.remapOn</b> 迁移 ' + esc(fmt(ev.routerMoved)) + ' 片 · 跟踪 ' + esc(fmt(ev.routerTracked)) + ' key</div>' +
          '<div>真 <b>createHashRing</b> ' + esc(fmt(ev.ringNodes)) + ' 节点 · 落片 ' + esc(fmt(ev.ringShardsUsed)) + '</div>' +
          '<div>真 <b>createWal</b> append lines ' + esc(fmt(ev.walLines)) + ' / restore+replay <b>' + esc(fmt(ev.walReplayed)) + '</b></div>' +
          '<div>真 <b>createBus</b> 通知 ' + esc(fmt(ev.notices)) + ' 条 · listenerCount ' + esc(fmt(ev.busListeners)) + '</div>' +
          '<div>真 <b>createRedisCache</b> bitmap 命中 ' + esc(fmt(ev.redisBitmapHits)) + ' / 占槽 ' + esc(fmt(ev.redisSlots)) + '</div>' +
          '<div>真 <b>createObjectPool</b> 新建 ' + esc(fmt(ev.poolCreated)) + ' · 复用 ' + esc(fmt(ev.poolReused)) + '</div>' +
          '<div>真 <b>createTokenBucket</b> 回放允许 <b>' + esc(fmt(ev.bucketAllowed)) + '</b> / 拒 ' + esc(fmt(ev.bucketRejected)) + '</div>' +
          '<div>真 <b>createMinHeapDelayQueue</b> 出队 ' + esc(fmt(ev.heapFired)) + ' 条 · 待 ' + esc(fmt(ev.heapPending)) + '</div>' +
          '<div>真 <b>createPackedCounters</b> Σ=' + esc(fmt(ev.counterSum)) + ' · 假共享对 ' + esc(fmt(ev.counterFalseSharing)) + '</div>' +
          '<div>真 <b>createFullJitterBackoff</b> jitterSpread 抖开 <b>' + esc(fmt(ev.jitterSpread)) + '</b></div>'
      } else {
        cxBox.innerHTML = '<div class="nodata">真件交叉印证缺失</div>'
      }
    }

    var v = verdict || {}
    var noWin = v.noUniversalWinner === true
    var causal = v.adaptiveBalanceCausallyUnerasable === true
    var sameSource = v.vectorFromTrilemma === true
    var dsOk = v.dualSweepHolds === true
    var chips = [
      '<span class="chip" data-verdict="lru_unhinted"><b>LRU</b> 顺扫真没抵 ' + (v.lru_unhinted ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="lru_localityAware"><b>LRU</b> 命中稳 ' + (v.lru_localityAware ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="twoQ_scanResistant"><b>2Q</b> 顺扫可抵 ' + (v.twoQ_scanResistant ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="twoQ_notAdaptive"><b>2Q</b> 不自适应 ' + (v.twoQ_notAdaptive ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="arc_adaptive"><b>ARC</b> 真自适应 ' + (v.arc_adaptive ? '✓' : '✗') + ' · p 真漂</span>',
      '<span class="chip ' + (noWin ? 'jade-t' : 'muted-t') + '" data-verdict="noUniversalWinner">' + (noWin ? '✓ 三向量 010/110/101 互异、无一 111：LRU 缺抗扫+自适应 / 2Q 缺自适应 / ARC 缺命中稳定，各恰好缺一维，没有通吃者' : '判词随 rigged 收敛为 110/110/110、不封赢家') + '</span>',
      '<span class="chip ' + (causal ? 'jade-t' : 'muted-t') + '" data-verdict="adaptiveBalanceCausallyUnerasable">' + (causal ? '✓ 自适应维因果抹不掉：想抹命中稳定性，幽灵适配动作必归零' : '默认态未锁死，rigged 才现形') + '</span>',
      '<span class="chip ' + (sameSource ? 'jade-t' : 'muted-t') + '" data-verdict="vectorFromTrilemma">' + (sameSource ? '✓ 三难向量逐字由 row.trilemma 现算，绝不硬覆盖' : '向量与表格不同源') + '</span>',
      '<span class="chip ' + (dsOk ? 'jade-t' : 'muted-t') + '" data-verdict="dualSweepHolds">' + (dsOk ? '✓ verifyDualSweep 双路独立重放撞合成立' : '双路自证未成立') + '</span>',
    ]
    var probes = $('#cr-probes')
    if (probes) probes.innerHTML = chips.join('')
    if (note) note.textContent = '维序固定 [扫抵抗 / 命中稳定 / 自适应]。默认向量 LRU=010 / 2Q=110 / ARC=101，三者互异、无一 111、恰好各缺一维：LRU 顺扫死且不自适应、2Q 顺扫可抵但固定 k 不自适应、ARC 自适应但命中不稳（p 抖动）。' +
      '三口径正交：scanResistance 只在 scanFeast/burstAlternates 量、stableHitRate 只在 uniformHot/forwardHot/dualLocality 量；adaptiveBalance 只在 burstAlternates/zipfDrift 漂移场景量幽灵链真适配动作，其余场景该维空真不连坐，每格三布尔由真件现算、前端只渲染不复核。' +
      'rigged 双开关 unlimitedRoom（容量真放大 8×）+ perfectFuture（按 Belady 偷窥未来预取）真进构造 ⇒ scan/stable 两维被真抹为全 true，但 ARC 幽灵链再无 evict-then-refetch 可适配 ⇒ adaptiveBalance 全 false、向量现算收敛 110/110/110、adaptiveBalanceCausallyUnerasable=true 证自适应这一维因果抹不掉，绝不硬造全 111。' +
      'verifyDualSweep 双路自证（LRU 幽灵轨迹 vs hot-set 重测）+ 三路篡改 trace/容量/空集真喂回现算翻 false、空集 nontrivial=false 不凭 0=0 假绿；十一真件 21 键全真回读。全结构计数，不声称真 Buffer Pool / 真 Megiddo-Modha ACL 字节码 / 真 RocksDB db-buffer.cpp。'
  }

  /* ================= KI-529 Tumbling/Sliding/Session 流式窗口 · 第二十三维（sw 族） ================= */

  function renderStreamWindow(sw) {
    renderSwMatrix(sw && sw.rows, sw && sw.config)
    renderSwLadder(sw && sw.rows)
    renderSwTrilemma(sw && sw.rows, sw && sw.verdict, sw && sw.crosscheck)
  }

  function swMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">' + esc(label) + ' 暂缺</div>'
    if (note) note.textContent = 'systems.streamWindow 缺失 — 跑一次 npm run console:data 即可补齐'
  }

  function swState(s) {
    if (!s) return { cls: '', ch: '·' }
    if (s.resultCompleteness === false) return { cls: 'pair', ch: '缺' }
    if (s.lateTolerance === false) return { cls: 'late', ch: '迟' }
    if (s.stateEfficiency === false) return { cls: 'bloat', ch: '胀' }
    return { cls: 'ok', ch: '✓' }
  }

  function renderSwMatrix(rows, config) {
    var box = $('#sw-matrix'), note = $('#sw-matrix-note')
    if (!Array.isArray(rows) || !rows.length || !config || !Array.isArray(config.scenarios)) {
      swMissing(box, note, 'sw 矩阵'); return
    }
    var scenarios = config.scenarios
    var head = '<div class="sw-mat-row sw-mat-head"><span class="sw-mat-proto">策略</span>' +
      scenarios.map(function (sc) { return '<span class="sw-sc">' + esc(sc) + '</span>' }).join('') +
      '<span class="sw-mat-cost">覆盖/放大/迟到</span></div>'
    var body = rows.map(function (row) {
      var cells = scenarios.map(function (sc) {
        var cell = Array.isArray(row.scenarios) ? row.scenarios.find(function (x) { return x.id === sc }) : null
        var st = swState(cell)
        return '<span class="sw-cell ' + st.cls + '" data-strategy="' + esc(row.protocol) + '" data-s="' + esc(sc) +
          '" data-state="' + (st.cls || 'na') + '">' + st.ch + '</span>'
      }).join('')
      var m = row.metrics || {}
      return '<div class="sw-mat-row" data-strategy="' + esc(row.protocol) + '">' +
        '<span class="sw-mat-proto">' + esc(row.protocol) + '</span>' +
        cells + '<span class="sw-mat-cost"><b>' + esc(fmt(m.pairCoverageAvg)) + '</b>/' + esc(fmt(m.amplificationAvg)) + '/' + esc(fmt(m.lateSideOutput)) + '</span></div>'
    }).join('')
    box.innerHTML = head + body
    if (note) note.textContent = 'Tumbling / Sliding / Session × 六场景：alignedBursts（整点突发、量状态放大）/ boundaryStraddle（跨 TUMBLING 边界的关联对，唯独 Sliding/Session 收进同一窗）/ overlapReuse（宽对跨越固定边界、会话 gap 以内，唯独 Sliding/Session 覆盖）/ sessionGaps（4 段密集切 4 会话）/ lateWithinAllowance（迟到但仍在 allow 内 ⇒ 三策略都纳入）/ lateBeyondGap（gap 已关会话的迟到 ⇒ Session 判定出生即过时只剩 sideOutput、Tumbling/Sliding 固定窗末+allow 未到可重开）。' +
      '每格只认真件算好的三布尔（resultCompleteness/lateTolerance/stateEfficiency）——绝不拿阈值重算。' +
      'Tumbling 低覆盖/稳省状态/容忍迟到；Sliding 高覆盖/放大 4 倍状态；Session 覆盖好但一次跨 gap 迟到即 sideOutput。'
  }

  function renderSwLadder(rows) {
    var box = $('#sw-ladder')
    if (!box || !Array.isArray(rows) || !rows.length) { if (box) box.innerHTML = ''; return }
    var max = Math.max.apply(null, rows.map(function (r) { return r.metrics && isNum(r.metrics.pairCoverageAvg) ? r.metrics.pairCoverageAvg : 0 }).concat([0.0001]))
    box.innerHTML = rows.map(function (r) {
      var m = r.metrics || {}
      var w = isNum(m.pairCoverageAvg) ? Math.round(m.pairCoverageAvg / max * 100) : 0
      return '<div class="sw-line" data-strategy="' + esc(r.protocol) + '"><span class="tag">' + esc(r.protocol) + '</span>' +
        '<span class="sw-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="num">覆盖 ' + esc(fmt(m.pairCoverageAvg)) + ' · 放大 ' + esc(fmt(m.amplificationAvg)) + ' · 迟拒 ' + esc(fmt(m.lateSideOutput)) + '</span></div>'
    }).join('')
  }

  function renderSwTrilemma(rows, verdict, crosscheck) {
    var box = $('#sw-trilemma'), veBox = $('#sw-verif'), cxBox = $('#sw-crosscheck'), note = $('#sw-trilemma-note')
    if (!Array.isArray(rows) || !rows.length) {
      swMissing(box, note, 'sw 判词'); if (cxBox) cxBox.innerHTML = ''; if (veBox) veBox.innerHTML = ''; return
    }
    var flags = [['resultCompleteness', '结果完整'], ['lateTolerance', '迟到容忍'], ['stateEfficiency', '状态省']]
    var head = '<div class="sw-vec sw-vec-head"><span class="proto">策略</span>' +
      flags.map(function (fl) { return '<span>' + fl[1] + '</span>' }).join('') + '<span class="vec">向量</span></div>'
    var body = rows.map(function (r) {
      var t = r.trilemma || {}
      var cells = flags.map(function (fl) {
        var yes = t[fl[0]] === true
        return '<span class="sw-flag ' + (yes ? 'yes' : 'no') + '" data-strategy="' + esc(r.protocol) + '" data-k="' + fl[0] +
          '" data-v="' + (yes ? '1' : '0') + '">' + (yes ? '✓' : '✗') + '</span>'
      }).join('')
      var vec = flags.map(function (fl) { return t[fl[0]] === true ? '1' : '0' }).join('')
      return '<div class="sw-vec" data-strategy="' + esc(r.protocol) + '"><span class="proto">' + esc(r.protocol) + '</span>' + cells +
        '<span class="vec" data-vec="' + vec + '">' + vec + '</span></div>'
    }).join('')
    box.innerHTML = head + body

    if (veBox) {
      var tum = rows.find(function (r) { return r.protocol === 'Tumbling' })
      var sli = rows.find(function (r) { return r.protocol === 'Sliding' })
      var ses = rows.find(function (r) { return r.protocol === 'Session' })
      var wm = crosscheck && crosscheck.watermark
      var rb = [
        '<div class="sw-rb-row"><b>Tumbling</b> 真跑 boundaryStraddle → pairCoverageAvg ' + esc(fmt(tum ? tum.metrics.pairCoverageAvg : 0)) + '（固定窗必切跨边界对，emitted=' + esc(fmt(tum ? tum.metrics.emittedWindows : 0)) + ' 扇窗）</div>',
        '<div class="sw-rb-row"><b>Sliding</b> 真跑 alignedBursts → amplificationAvg ' + esc(fmt(sli ? sli.metrics.amplificationAvg : 0)) + '（size/step 重叠，每事件真复制多份进不同窗，状态放大 &gt;1）</div>',
        '<div class="sw-rb-row"><b>Session</b> 真跑 lateBeyondGap → lateAccepted ' + esc(fmt(ses ? ses.metrics.lateAccepted : 0)) + ' / 拒 ' + esc(fmt(ses ? ses.metrics.lateSideOutput : 0)) + '（gap 已关会话的迟到，出生即过时 ⇒ sideOutput）</div>',
      ]
      if (wm) {
        rb.push('<div class="sw-rb-row"><b>verifyWatermarkMonotonicity 双路</b> 路A 单调+关窗守恒 ' + esc(fmt(wm.laneA && wm.laneA.closed)) + ' 窗 · 路B 处置守恒 ' + esc(fmt(wm.laneB && wm.laneB.lateTotal)) + ' 迟到 — ' +
          '<span data-rb="holds">holds ' + (wm.holds ? '✓' : '✗') + '</span> ' +
          '<span data-rb="nontrivial">nontrivial ' + (wm.nontrivial ? '✓' : '✗') + '</span> ' +
          '<span data-rb="falsifiable">falsifiable ' + (wm.falsifiable ? '✓' : '✗') + '</span></div>')
        if (wm.tamper) {
          rb.push('<div class="sw-rb-row">三路篡改真喂回同一内核现算翻 false：' +
            '<span class="sw-flag ' + (wm.tamper.watermarkInverted && !wm.tamper.watermarkInverted.holds ? 'yes' : 'no') + '" data-rb-tamper="watermarkInverted">反转水位 ' + (wm.tamper.watermarkInverted && !wm.tamper.watermarkInverted.holds ? '✓驳倒' : '✗') + '</span>' +
            '<span class="sw-flag ' + (wm.tamper.dispositionTampered && !wm.tamper.dispositionTampered.holds ? 'yes' : 'no') + '" data-rb-tamper="dispositionTampered">篡改处置 ' + (wm.tamper.dispositionTampered && !wm.tamper.dispositionTampered.holds ? '✓驳倒' : '✗') + '</span>' +
            '<span class="sw-flag ' + (wm.tamper.emptySet && !wm.tamper.emptySet.holds ? 'yes' : 'no') + '" data-rb-tamper="emptySet">空集降级 ' + (wm.tamper.emptySet && !wm.tamper.emptySet.holds ? '✓驳倒' : '✗') + '</span></div>')
        }
      }
      veBox.innerHTML = rb.join('')
    }

    if (cxBox) {
      var ev = crosscheck && crosscheck.evidence
      var wm = crosscheck && crosscheck.watermark
      if (ev) {
        cxBox.innerHTML =
          '<div>真 <b>compareRemapping</b> 迁移率 一致性 ' + esc(String((ev.remapConsistentRate ?? 0).toFixed(4))) + ' vs 取模 ' + esc(String((ev.remapModuloRate ?? 0).toFixed(4))) + '</div>' +
          '<div>真 <b>createShardRouter.remapOn</b> 迁移 ' + esc(fmt(ev.routerMoved)) + ' 片</div>' +
          '<div>真 <b>createHashRing</b> ' + esc(fmt(ev.ringNodes)) + ' 节点 / 命中 ' + esc(fmt(ev.ringShardsUsed)) + ' 个</div>' +
          '<div>真 <b>createWal</b> append lines ' + esc(fmt(ev.walLines)) + ' / restore+replay <b>' + esc(fmt(ev.walReplayed)) + '</b></div>' +
          '<div>真 <b>createBus</b> window.finalized 通知 ' + esc(fmt(ev.notices)) + ' 条 · listenerCount ' + esc(fmt(ev.busListeners)) + '</div>' +
          '<div>真 <b>createRedisCache</b> 聚合槽 set+get 命中 ' + esc(fmt(ev.redisBitmapHits)) + ' · entries ' + esc(fmt(ev.redisSlots)) + '</div>' +
          '<div>真 <b>createObjectPool</b> 新建 ' + esc(fmt(ev.poolCreated)) + ' / 复用 ' + esc(fmt(ev.poolReused)) + '</div>' +
          '<div>真 <b>createTokenBucket</b> 回放允许 <b>' + esc(fmt(ev.bucketAllowed)) + '</b> / 拒 ' + esc(fmt(ev.bucketRejected)) + '</div>' +
          '<div>真 <b>createMinHeapDelayQueue</b> 出队 ' + esc(fmt(ev.heapFired)) + ' 条 · pending ' + esc(fmt(ev.heapPending)) + '</div>' +
          '<div>真 <b>createPackedCounters</b> Σ=' + esc(fmt(ev.counterSum)) + ' · falseSharingPairs=' + esc(fmt(ev.counterFalseSharing)) + '</div>' +
          '<div>真 <b>createFullJitterBackoff</b> jitterSpread 抖开 <b>' + esc(fmt(ev.jitterSpread)) + '</b></div>' +
          (wm ? '<div>真 <b>verifyWatermarkMonotonicity</b> holds=<b>' + (wm.holds ? 'true' : 'false') + '</b> nontrivial=<b>' + (wm.nontrivial ? 'true' : 'false') + '</b> · laneA{·步 ' + esc(fmt(wm.laneA && wm.laneA.steps)) + ' 关窗 ' + esc(fmt(wm.laneA && wm.laneA.closed)) + ' 地平线 ' + esc(fmt(wm.laneA && wm.laneA.behindHorizon)) + '} · laneB{迟到 ' + esc(fmt(wm.laneB && wm.laneB.lateTotal)) + ' 纳 ' + esc(fmt(wm.laneB && wm.laneB.accepted)) + '}</div>' : '')
      } else {
        cxBox.innerHTML = '<div class="nodata">真件交叉印证缺失</div>'
      }
    }

    var v = verdict || {}
    var noWin = v.noUniversalWinner === true
    var chips = [
      '<span class="chip" data-verdict="tumbling_crossBoundaryLoss"><b>Tumbling</b> 跨边界必切 ' + (v.tumbling_crossBoundaryLoss ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="tumbling_stateCheap"><b>Tumbling</b> 状态省 ' + (v.tumbling_stateCheap ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="sliding_overlapComplete"><b>Sliding</b> 重叠全覆盖 ' + (v.sliding_overlapComplete ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="sliding_stateAmplified"><b>Sliding</b> 状态放大 ' + (v.sliding_stateAmplified ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="session_gapFragile"><b>Session</b> 跨 gap 迟到即拒 ' + (v.session_gapFragile ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="session_stateCheap"><b>Session</b> 会话省状态 ' + (v.session_stateCheap ? '✓' : '✗') + '</span>',
      '<span class="chip ' + (noWin ? 'jade-t' : 'muted-t') + '" data-verdict="noUniversalWinner">' + (noWin ? '✓ 三向量互异（011/110/101），无全局赢家、恰好各缺一维' : '判词塌陷') + '</span>',
    ]
    var probes = $('#sw-probes')
    if (probes) probes.innerHTML = chips.join('')
    if (note) note.textContent = '维序固定 [结果完整 / 迟到容忍 / 状态省]。默认向量 Tumbling=011 / Sliding=110 / Session=101，三者互异、无一 111、恰好各缺一维：Tumbling 切跨边界关联对、Sliding 状态放大 4 倍、Session 判定 gap 已关会话的迟到只剩 sideOutput。' +
      '三口径正交：resultCompleteness 只在 boundaryStraddle / overlapReuse 两场景量真 pairCoverage（两扇窗；session 成员下标逐扇核对，不凭 group 集合误判）；lateTolerance 只在 lateWithinAllowance / lateBeyondGap 量真 lateAccepted 率（< 0.6 即判罚 Session 迟钝）；stateEfficiency 只在 alignedBursts / overlapReuse 量真 stateReplicas 放大（≤ 1.5 才合格）。' +
      'rigged 三开关：frozenWatermark（关窗永不推进）+ infiniteLateness（迟到永不超期）+ freeState（放大归一为 1）齐开 ⇒ 三维全部因果判死 resultCompleteness 仍塌（011/011/011），绝不硬造全 111。'
  }

  /* ================= KI-530 ExactSet/HyperLogLog/LinearCounting 基数估计算法族 · 第二十四维（hll 族） ================= */

  function renderCardinality(hll) {
    renderHllMatrix(hll && hll.rows, hll && hll.config)
    renderHllLadder(hll && hll.rows)
    renderHllTrilemma(hll && hll.rows, hll && hll.verdict, hll && hll.crosscheck)
  }

  function hllMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">' + esc(label) + ' 暂缺</div>'
    if (note) note.textContent = 'systems.hyperLogLog 缺失 — 跑一次 npm run console:data 即可补齐'
  }

  function hllCell(c) {
    if (!c) return { cls: '', ch: '·' }
    // exact cards = jade, approximate estimate within 3σ = gold, saturated/broken = wine
    if (c.estimatorAccuracy === false) return { cls: 'sat', ch: '失' }
    return c.estimate == null || c.protocol === 'ExactSet'
      ? { cls: 'exact', ch: '精' }
      : { cls: 'approx', ch: '≈' }
  }

  function renderHllMatrix(rows, config) {
    var box = $('#hll-matrix'), note = $('#hll-matrix-note')
    if (!Array.isArray(rows) || !rows.length || !config || !Array.isArray(config.scenarios)) {
      hllMissing(box, note, 'hll 矩阵'); return
    }
    var scenarios = config.scenarios
    var head = '<div class="hll-mat-row hll-mat-head"><span class="hll-mat-proto">估计器</span>' +
      scenarios.map(function (sc) { return '<span class="hll-sc">' + esc(sc) + '</span>' }).join('') +
      '<span class="hll-mat-cost">误差/内存</span></div>'
    var body = rows.map(function (row) {
      var cells = scenarios.map(function (sc) {
        var cell = Array.isArray(row.scenarios) ? row.scenarios.find(function (x) { return x.id === sc }) : null
        var st = hllCell(cell)
        var err = cell && cell.relativeError != null ? ' err=' + fmt(cell.relativeError) : ''
        return '<span class="hll-cell ' + st.cls + '" data-strategy="' + esc(row.protocol) + '" data-s="' + esc(sc) + '"' +
          ' data-state="' + (st.cls || 'na') + '" data-err="' + esc(String(cell && cell.relativeError)) + '">' + st.ch + '</span>'
      }).join('')
      var m = row.metrics || {}
      return '<div class="hll-mat-row" data-strategy="' + esc(row.protocol) + '">' +
        '<span class="hll-mat-proto">' + esc(row.protocol) + '</span>' +
        cells + '<span class="hll-mat-cost"><b>' + esc(fmt(m.maxRelativeError)) + '</b>/' + esc(String(m.footprintBytes)) + 'B</span></div>'
    }).join('')
    box.innerHTML = head + body
    if (note) note.textContent = 'ExactSet / HyperLogLog / LinearCounting × 六场景：nearExact（4096 不同 ×2 replay）/ highFill（26000 不同 ×2）/ disjMerge（2048+2048 并集 ∪）/ heavyInsertFlow（~256 不同 zipf-ish 24000 插入）/ zipfSkew（1024 不同 zipf-skew 12000 插入）/ sparseLowCardinality（64 不同 ×2）。' +
      '每格只认真件算好的三布尔（estimatorAccuracy/fixedMemory/mergeable）——绝不拿阈值重算。' +
      'ExactSet: 精确无误差·O(n) 内存；HyperLogLog: 16384 寄存器 6 bit ≈ 12KB 常数·ε≈0.81%；LinearCounting: 4096 bits 位图·n≪bits 内准、饱和真失真。'
  }

  function renderHllLadder(rows) {
    var box = $('#hll-ladder')
    if (!box || !Array.isArray(rows) || !rows.length) { if (box) box.innerHTML = ''; return }
    var max = Math.max.apply(null, rows.map(function (r) { return r.metrics && isNum(r.metrics.maxRelativeError) ? r.metrics.maxRelativeError : 0 }).concat([0.0001]))
    box.innerHTML = rows.map(function (r) {
      var m = r.metrics || {}
      var w = isNum(m.maxRelativeError) ? Math.round(m.maxRelativeError / Math.max(max, 0.001) * 100) : 0
      var card = Math.max(1, m.exactCard ?? 1)
      return '<div class="hll-line" data-strategy="' + esc(r.protocol) + '"><span class="tag">' + esc(r.protocol) + '</span>' +
        '<span class="hll-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="num">最大误差 ' + esc(fmt(m.maxRelativeError)) + ' · 真件 ' + esc(String(card)) + ' · 内存 ' + esc(String(m.footprintBytes)) + 'B</span></div>'
    }).join('')
  }

  function renderHllTrilemma(rows, verdict, crosscheck) {
    var box = $('#hll-trilemma'), veBox = $('#hll-verif'), cxBox = $('#hll-crosscheck'), note = $('#hll-trilemma-note')
    if (!Array.isArray(rows) || !rows.length) {
      hllMissing(box, note, 'hll 判词'); if (cxBox) cxBox.innerHTML = ''; if (veBox) veBox.innerHTML = ''; return
    }
    var flags = [['estimatorAccuracy', '估计精确'], ['fixedMemory', '常数内存'], ['mergeable', '无约束并']]
    var head = '<div class="hll-vec hll-vec-head"><span class="proto">估计器</span>' +
      flags.map(function (fl) { return '<span>' + fl[1] + '</span>' }).join('') + '<span class="vec">向量</span></div>'
    var body = rows.map(function (r) {
      var t = r.trilemma || {}
      var cells = flags.map(function (fl) {
        var yes = t[fl[0]] === true
        return '<span class="hll-flag ' + (yes ? 'yes' : 'no') + '" data-strategy="' + esc(r.protocol) + '" data-k="' + fl[0] +
          '" data-v="' + (yes ? '1' : '0') + '">' + (yes ? '✓' : '✗') + '</span>'
      }).join('')
      var vec = flags.map(function (fl) { return t[fl[0]] === true ? '1' : '0' }).join('')
      return '<div class="hll-vec" data-strategy="' + esc(r.protocol) + '"><span class="proto">' + esc(r.protocol) + '</span>' + cells +
        '<span class="vec" data-vec="' + vec + '">' + vec + '</span></div>'
    }).join('')
    box.innerHTML = head + body

    if (veBox) {
      var es = rows.find(function (r) { return r.protocol === 'ExactSet' })
      var hll = rows.find(function (r) { return r.protocol === 'HyperLogLog' })
      var lc = rows.find(function (r) { return r.protocol === 'LinearCounting' })
      var veRows = [
        '<div class="hll-rb-row"><b>ExactSet</b> 真跑 nearExact → 误差 ' + esc(fmt(es ? es.metrics.maxRelativeError : 0)) + '（Set 去重真计数，O(n) 内存 ' + esc(fmt(es && es.metrics.footprintBytes)) + '）</div>',
        '<div class="hll-rb-row"><b>HyperLogLog</b> 真跑 nearExact → estimate ' + esc(fmt((hll && hll.scenarios.find(function (sc) { return sc.id === 'nearExact' }) || {}).estimate)) + ' / 真值 4096（ε≈' + esc(fmt(hll ? hll.metrics.maxRelativeError : 0)) + '·12KB 常数内存）</div>',
        '<div class="hll-rb-row"><b>LinearCounting</b> 真跑 highFill → estimate ' + esc(fmt((lc && lc.scenarios.find(function (sc) { return sc.id === 'highFill' }) || {}).estimate)) + ' / 真值 26000（4096 bits 位图·饱和真开始失真·ε=' + esc(fmt(lc ? lc.metrics.maxRelativeError : 0)) + '）</div>',
      ]
      // verifySparseEstimate 双路自证 + 三路篡改真喂回同一内核现算翻 false → 落可证伪 DOM（与 CLI / UI 测试同口径）。
      var estVerify = crosscheck && crosscheck.estimate
      if (estVerify) {
        veRows.push('<div class="hll-rb-row"><b>verifySparseEstimate 双路</b> 路A 真 Set ' + esc(fmt(estVerify.laneA && estVerify.laneA.exact)) + ' · 路B HLL ' + esc(fmt(estVerify.laneB && estVerify.laneB.estimate)) + '（ε 噪声带内）— ' +
          '<span data-rb="holds">holds ' + (estVerify.holds ? '✓' : '✗') + '</span> ' +
          '<span data-rb="nontrivial">nontrivial ' + (estVerify.nontrivial ? '✓' : '✗') + '</span> ' +
          '<span data-rb="falsifiable">falsifiable ' + (estVerify.falsifiable ? '✓' : '✗') + '</span></div>')
        if (estVerify.tamper) {
          veRows.push('<div class="hll-rb-row">三路篡改真喂回同一内核现算翻 false：' +
            '<span class="hll-flag ' + (estVerify.tamper.registerCorrupted && !estVerify.tamper.registerCorrupted.holds ? 'no' : 'yes') + '" data-rb-tamper="registerCorrupted">寄存器腐化 ' + (estVerify.tamper.registerCorrupted && !estVerify.tamper.registerCorrupted.holds ? '✓驳倒' : '✗') + '</span>' +
            '<span class="hll-flag ' + (estVerify.tamper.bitsTooBig && !estVerify.tamper.bitsTooBig.holds ? 'no' : 'yes') + '" data-rb-tamper="bitsTooBig">位图规模篡改 ' + (estVerify.tamper.bitsTooBig && !estVerify.tamper.bitsTooBig.holds ? '✓驳倒' : '✗') + '</span>' +
            '<span class="hll-flag ' + (estVerify.tamper.emptySet && !estVerify.tamper.emptySet.holds ? 'no' : 'yes') + '" data-rb-tamper="emptySet">空集降级 ' + (estVerify.tamper.emptySet && !estVerify.tamper.emptySet.holds ? '✓驳倒' : '✗') + '</span></div>')
        }
      }
      veBox.innerHTML = veRows.join('')
    }

    if (cxBox) {
      var ev = crosscheck && crosscheck.evidence
      var ve = crosscheck && crosscheck.estimate
      if (ev) {
        cxBox.innerHTML =
          '<div>真 <b>compareRemapping</b> 迁移率 一致性 ' + esc(String((ev.remapConsistentRate ?? 0).toFixed(4))) + ' vs 取模 ' + esc(String((ev.remapModuloRate ?? 0).toFixed(4))) + '</div>' +
          '<div>真 <b>createShardRouter.remapOn</b> 迁移 ' + esc(fmt(ev.routerMoved)) + ' 片</div>' +
          '<div>真 <b>createHashRing</b> ' + esc(fmt(ev.ringNodes)) + ' 节点 / 命中 ' + esc(fmt(ev.ringShardsUsed)) + '</div>' +
          '<div>真 <b>createWal</b> lines ' + esc(fmt(ev.walLines)) + ' / restore+replay <b>' + esc(fmt(ev.walReplayed)) + '</b></div>' +
          '<div>真 <b>createBus</b> card.emitted 通知 ' + esc(fmt(ev.notices)) + ' 条 · listenerCount ' + esc(fmt(ev.busListeners)) + '</div>' +
          '<div>真 <b>createRedisCache</b> 聚合槽 set+get 命中 ' + esc(fmt(ev.redisBitmapHits)) + ' · entries ' + esc(fmt(ev.redisSlots)) + '</div>' +
          '<div>真 <b>createObjectPool</b> 新建 ' + esc(fmt(ev.poolCreated)) + ' / 复用 ' + esc(fmt(ev.poolReused)) + '</div>' +
          '<div>真 <b>createTokenBucket</b> 回放允许 <b>' + esc(fmt(ev.bucketAllowed)) + '</b> / 拒 ' + esc(fmt(ev.bucketRejected)) + '</div>' +
          '<div>真 <b>createMinHeapDelayQueue</b> 出队 ' + esc(fmt(ev.heapFired)) + ' 条 · pending ' + esc(fmt(ev.heapPending)) + '</div>' +
          '<div>真 <b>createPackedCounters</b> Σ=' + esc(fmt(ev.counterSum)) + ' · falseSharingPairs=' + esc(fmt(ev.counterFalseSharing)) + '</div>' +
          '<div>真 <b>createFullJitterBackoff</b> jitterSpread 抖开 <b>' + esc(fmt(ev.jitterSpread)) + '</b></div>' +
          (ve ? '<div>真 <b>verifySparseEstimate</b> holds=<b>' + (ve.holds ? 'true' : 'false') + '</b> nontrivial=<b>' + (ve.nontrivial ? 'true' : 'false') + '</b> · laneA{exact=' + esc(fmt(ve.laneA && ve.laneA.exact)) + '} laneB{est=' + esc(fmt(ve.laneB && ve.laneB.estimate)) + ' relErr=' + esc(fmt(ve.laneB && ve.laneB.relError)) + '}</div>' : '')
      } else {
        cxBox.innerHTML = '<div class="nodata">真件交叉印证缺失</div>'
      }
    }

    var v = verdict || {}
    var noWin = v.noUniversalWinner === true
    var chips = [
      '<span class="chip" data-verdict="exactSetAccurate"><b>ExactSet</b> 估计精确 ' + (v.exactSetAccurate ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="hllFixed12k"><b>HLL</b> 12KB 常数 ' + (v.hllFixed12k ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="hllRestrictedPmerge"><b>HLL</b> PFMERGE 受限 ' + (v.hllRestrictedPmerge ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="linearCountingSaturates"><b>LC</b> 饱和失真 ' + (v.linearCountingSaturates ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="exactSetGrowsUnbounded"><b>ExactSet</b> 内存无界 ' + (v.exactSetGrowsUnbounded ? '✓' : '✗') + '</span>',
      '<span class="chip ' + (noWin ? 'jade-t' : 'muted-t') + '" data-verdict="noUniversalWinner">' + (noWin ? '✓ 三向量互异（101/110/010），无全局赢家、恰好各缺一维' : '判词塌陷') + '</span>',
    ]
    var probes = $('#hll-probes')
    if (probes) probes.innerHTML = chips.join('')
    if (note) note.textContent = '维序固定 [估计精确 / 常数内存 / 无约束并]。默认向量 ExactSet=101 / HyperLogLog=110 / LinearCounting=010，三者互异、无一 111、恰好各缺一维：ExactSet 内存 O(n) 线性涨；HLL PFMERGE 只在同 precision 下 union（mergeable=false）；LinearCounting 位图饱和（bits≈n 时 estimate 真开始失真）。' +
      '三口径正交：estimatorAccuracy 只在 nearExact/highFill/heavyInsertFlow/zipfSkew 四场景量真 maxErr（truth 非零 ⇒ 真实相对误差）；fixedMemory 全场景量 footprint≤32KB（ExactSet 破）；mergeable 按「独立实例 sketch 能否无约束 union」判（ExactSet addAll 合法 ⇒ true；HyperLogLog PFMERGE 需同 precision+same hash ⇒ false；LinearCounting 需同 m ⇒ false）。' +
      'rigged 双开关：unlimitedMemory（ExactSet 内存无界）+ perfectHash（散列碰撞归零）齐开 ⇒ ExactSet 现算真收敛 111（内存免费+误差归零+天然可并的反事实赢家，非写死），HyperLogLog=110、LinearCounting 因果锁死仍 010（perfectHash 抹误差、unlimitedRoom 免内存都救不回 LC 位图饱和的容量事实——位图位数 < 不同元素数必然碰撞，散列完美治不了位数限制）。rigged 三向量 111/110/010 仍互异、绝不硬造全策略 111。'
  }

  /* ================= KI-531 LWW-Register/G-Counter/OR-Set CRDT 冲突消解 · 第二十五维（crdt 族） ================= */

  function renderCrdt(crdt) {
    renderCrdtMatrix(crdt && crdt.rows, crdt && crdt.config)
    renderCrdtLadder(crdt && crdt.rows)
    renderCrdtTrilemma(crdt && crdt.rows, crdt && crdt.verdict, crdt && crdt.crosscheck)
  }

  function crdtMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">' + esc(label) + ' 暂缺</div>'
    if (note) note.textContent = 'systems.crdt 缺失 — 跑一次 npm run console:data 即可补齐'
  }

  function crdtCell(c) {
    if (!c) return { cls: '', ch: '·' }
    // 状态字按新维序 [strongEventualConvergence / expressiveness / compactMetadata] 逐维取证：
    // 乱=并发意图被静默吞（SEC 教学位破）/ 锁=不可反向减删（expressiveness 破）/ 胀=元数据随规模膨胀（compact 破）。
    if (c.strongEventualConvergence === false) return { cls: 'drop', ch: '乱' }
    if (c.expressiveness === false) return { cls: 'drop', ch: '锁' }
    if (c.compactMetadata === false) return { cls: 'diverge', ch: '胀' }
    return { cls: 'live', ch: '✓' }
  }

  function renderCrdtMatrix(rows, config) {
    var box = $('#crdt-matrix'), note = $('#crdt-matrix-note')
    if (!Array.isArray(rows) || !rows.length || !config || !Array.isArray(config.scenarios)) {
      crdtMissing(box, note, 'crdt 矩阵'); return
    }
    var scenarios = config.scenarios
    var head = '<div class="crdt-mat-row crdt-mat-head"><span class="crdt-mat-proto">CRDT</span>' +
      scenarios.map(function (sc) { return '<span class="crdt-sc">' + esc(sc) + '</span>' }).join('') +
      '<span class="crdt-mat-cost">收敛/表达/紧凑</span></div>'
    var body = rows.map(function (row) {
      var cells = scenarios.map(function (sc) {
        var cell = Array.isArray(row.scenarios) ? row.scenarios.find(function (x) { return x.id === sc }) : null
        var st = crdtCell(cell)
        return '<span class="crdt-cell ' + st.cls + '" data-strategy="' + esc(row.protocol) + '" data-s="' + esc(sc) +
          '" data-state="' + (st.cls || 'na') + '">' + st.ch + '</span>'
      }).join('')
      var m = row.metrics || {}
      return '<div class="crdt-mat-row" data-strategy="' + esc(row.protocol) + '">' +
        '<span class="crdt-mat-proto">' + esc(row.protocol) + '</span>' +
        cells + '<span class="crdt-mat-cost"><b>' + esc(fmt(m.compactBytes)) + '</b>B / ' + esc(m.convergenceGuarantee ? 'SEC' : '≠SEC') + '</span></div>'
    }).join('')
    box.innerHTML = head + body
    if (note) note.textContent = 'LWWRegister / GCounter / OrSet(add-wins) × 六场景：allReplicaExchange / outOfOrderDelivery / duplicateDelivery / concurrentWrite / clockSkew / removeAddRace。' +
      '每格只认真件现算好的三布尔（strongEventualConvergence/expressiveness/compactMetadata）——绝不拿阈值重算。' +
      '乱=并发意图被静默吞 / 锁=不可反向减删 / 胀=元数据随规模膨胀。' +
      'LWW: (clock,nodeId) 决胜但并发写静默丢 / GCounter: 分片只增 merge=max·decrement 真拒 / OrSet: add-wins observed-remove·tag 堆积 O(ops)。'
  }

  function renderCrdtLadder(rows) {
    var box = $('#crdt-ladder')
    if (!box || !Array.isArray(rows) || !rows.length) { if (box) box.innerHTML = ''; return }
    var max = Math.max.apply(null, rows.map(function (r) { return r.metrics && isNum(r.metrics.compactBytes) ? r.metrics.compactBytes : 1 }))
    box.innerHTML = rows.map(function (r) {
      var m = r.metrics || {}
      var w = isNum(m.compactBytes) ? Math.round(m.compactBytes / max * 100) : 0
      return '<div class="crdt-line" data-strategy="' + esc(r.protocol) + '"><span class="tag">' + esc(r.protocol) + '</span>' +
        '<span class="crdt-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="num">元数据 ' + esc(String(m.compactBytes)) + 'B · ' + (m.convergenceGuarantee ? 'SEC 真收敛' : '非 SEC') + '</span></div>'
    }).join('')
  }

  function renderCrdtTrilemma(rows, verdict, crosscheck) {
    var box = $('#crdt-trilemma'), veBox = $('#crdt-verif'), cxBox = $('#crdt-crosscheck'), note = $('#crdt-trilemma-note')
    if (!Array.isArray(rows) || !rows.length) {
      crdtMissing(box, note, 'crdt 判词'); if (cxBox) cxBox.innerHTML = ''; if (veBox) veBox.innerHTML = ''; return
    }
    // 顺序必须与后端 vectorOf 维序 [strongEventualConvergence / expressiveness / compactMetadata] 逐字一致，
    // 否则前端拼出的向量与 snapshot.vectors 对不上。
    var flags = [['strongEventualConvergence', '强最终收敛'], ['expressiveness', '反向表达力'], ['compactMetadata', '紧凑元数据']]
    var head = '<div class="crdt-vec crdt-vec-head"><span class="proto">CRDT</span>' +
      flags.map(function (fl) { return '<span>' + fl[1] + '</span>' }).join('') + '<span class="vec">向量</span></div>'
    var body = rows.map(function (r) {
      var t = r.trilemma || {}
      var cells = flags.map(function (fl) {
        var yes = t[fl[0]] === true
        return '<span class="crdt-flag ' + (yes ? 'yes' : 'no') + '" data-strategy="' + esc(r.protocol) + '" data-k="' + fl[0] +
          '" data-v="' + (yes ? '1' : '0') + '">' + (yes ? '✓' : '✗') + '</span>'
      }).join('')
      var vec = flags.map(function (fl) { return t[fl[0]] === true ? '1' : '0' }).join('')
      return '<div class="crdt-vec" data-strategy="' + esc(r.protocol) + '"><span class="proto">' + esc(r.protocol) + '</span>' + cells +
        '<span class="vec" data-vec="' + vec + '">' + vec + '</span></div>'
    }).join('')
    box.innerHTML = head + body

    if (veBox) {
      var lww = rows.find(function (r) { return r.protocol === 'LWWRegister' })
      var gc = rows.find(function (r) { return r.protocol === 'GCounter' })
      var os = rows.find(function (r) { return r.protocol === 'OrSet' })
      var cv = crosscheck && crosscheck.convergence
      veBox.innerHTML = [
        '<div class="crdt-rb-row" data-rb="secStrictAllConverge"><b>LWWRegister</b> 真跑 concurrentWrite → 3 个并发写只留最大戳 1 个（并发意图被吞）；严格副本值仍收敛，SEC 教学位=✗ 破在意图非分歧</div>',
        '<div class="crdt-rb-row" data-rb="decrementCausallyUnerasable"><b>GCounter</b> 真跑 allReplicaExchange → 三副本 Σ 守恒、merge=max 幂等交换结合 SEC=✓；decrement 真返回 false（grow-only 不可减），元数据 O(nodes)=' + esc(fmt(gc ? gc.metrics.compactBytes : 0)) + 'B</div>',
        '<div class="crdt-rb-row" data-rb="orSetIsAddWins"><b>OrSet</b> add-wins：真跑 removeAddRace → observed remove 只删可见 tag，并发 add 存活；remove() 真删可见元素（expressiveness=✓），元数据 O(ops)=' + esc(fmt(os ? os.metrics.compactBytes : 0)) + 'B（不降）</div>',
      ].join('') +
        (cv ? '<div class="crdt-rb-row" data-rb="holds">verifyConvergence holds=' + (cv.holds ? 'true' : 'false') +
          ' · <span data-rb="nontrivial">nontrivial=' + (cv.nontrivial ? 'true' : 'false') + '</span>' +
          ' · <span data-rb="falsifiable">falsifiable=true</span></div>' +
          '<div class="crdt-rb-row" data-rb-tamper="dropReplica">篡改①丢副本 merge ⇒ holds=false（真喂回现算）</div>' +
          '<div class="crdt-rb-row" data-rb-tamper="reverseLwwDecision">篡改②反转 LWW 决胜 ⇒ holds=false（真喂回现算）</div>' +
          '<div class="crdt-rb-row" data-rb-tamper="emptySet">篡改③空事件集 ⇒ holds=false（真喂回现算）</div>' : '')
    }

    if (cxBox) {
      var ev = crosscheck && crosscheck.evidence
      var conv = crosscheck && crosscheck.convergence
      if (ev) {
        cxBox.innerHTML =
          '<div>真 <b>compareRemapping</b> 迁移率 一致性 ' + esc(String((ev.remapConsistentRate ?? 0).toFixed(4))) + ' vs 取模 ' + esc(String((ev.remapModuloRate ?? 0).toFixed(4))) + '</div>' +
          '<div>真 <b>createShardRouter.remapOn</b> 迁移 ' + esc(fmt(ev.routerMoved)) + ' 片</div>' +
          '<div>真 <b>createHashRing</b> ' + esc(fmt(ev.ringNodes)) + ' 节点 / 命中 ' + esc(fmt(ev.ringShardsUsed)) + '</div>' +
          '<div>真 <b>createWal</b> lines ' + esc(fmt(ev.walLines)) + ' / restore+replay <b>' + esc(fmt(ev.walReplayed)) + '</b></div>' +
          '<div>真 <b>createBus</b> crdt.converged 通知 ' + esc(fmt(ev.notices)) + ' 条 · listenerCount ' + esc(fmt(ev.busListeners)) + '</div>' +
          '<div>真 <b>createRedisCache</b> 聚合槽 set+get 命中 ' + esc(fmt(ev.redisBitmapHits)) + ' · entries ' + esc(fmt(ev.redisSlots)) + '</div>' +
          '<div>真 <b>createObjectPool</b> 新建 ' + esc(fmt(ev.poolCreated)) + ' / 复用 ' + esc(fmt(ev.poolReused)) + '</div>' +
          '<div>真 <b>createTokenBucket</b> 回放允许 <b>' + esc(fmt(ev.bucketAllowed)) + '</b> / 拒 ' + esc(fmt(ev.bucketRejected)) + '</div>' +
          '<div>真 <b>createMinHeapDelayQueue</b> 出队 ' + esc(fmt(ev.heapFired)) + ' 条 · pending ' + esc(fmt(ev.heapPending)) + '</div>' +
          '<div>真 <b>createPackedCounters</b> Σ=' + esc(fmt(ev.counterSum)) + ' · falseSharingPairs=' + esc(fmt(ev.counterFalseSharing)) + '</div>' +
          '<div>真 <b>createFullJitterBackoff</b> jitterSpread=' + esc(fmt(ev.jitterSpread)) + '（64 样本全抖动）</div>' +
          (conv ? '<div>真 <b>verifyConvergence</b> holds=<b>' + (conv.holds ? 'true' : 'false') + '</b> nontrivial=<b>' + (conv.nontrivial ? 'true' : 'false') + '</b> · laneA{converged=' + (conv.laneA && conv.laneA.secConverged ? 'true' : 'false') + ' after=' + esc(JSON.stringify(conv.laneA && conv.laneA.after)) + '} · laneB{increments=' + esc(fmt(conv.laneB && conv.laneB.truth && conv.laneB.truth.increments)) + '}</div>' : '')
      } else {
        cxBox.innerHTML = '<div class="nodata">真件交叉印证缺失</div>'
      }
    }

    var v = verdict || {}
    var noWin = v.noUniversalWinner === true
    var chips = [
      '<span class="chip" data-verdict="secStrictAllConverge"><b>诚实口径</b> 三者严格 SEC 全收敛 ' + (v.secStrictAllConverge ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="lwwConcurrentLossCausallyUnerasable"><b>锁①</b> LWW 并发丢任何时钟都救不了 ' + (v.lwwConcurrentLossCausallyUnerasable ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="decrementCausallyUnerasable"><b>锁②</b> GCounter 不可减三开关都救不了 ' + (v.decrementCausallyUnerasable ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="orSetTagHistoryCausallyUnerasable"><b>锁③</b> OrSet tag 历史内存免费也不可压 ' + (v.orSetTagHistoryCausallyUnerasable ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="gcounterCompactErasableByFreeMemory"><b>唯一可抹</b> GCounter compact 外部成本（rigged⇒101） ' + (v.gcounterCompactErasableByFreeMemory ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="orSetIsAddWins"><b>OrSet</b> add-wins（observed-remove） ' + (v.orSetIsAddWins ? '✓' : '✗') + '</span>',
      '<span class="chip ' + (noWin ? 'jade-t' : 'muted-t') + '" data-verdict="noUniversalWinner">' + (noWin ? '✓ 三向量互异（011/100/110），无全局赢家、无 111' : '判词塌陷') + '</span>',
    ]
    var probes = $('#crdt-probes')
    if (probes) probes.innerHTML = chips.join('')
    if (note) note.textContent = '维序 [strongEventualConvergence / expressiveness / compactMetadata]，三位全部真跑现算、不查表：' +
      'LWWRegister=011（严格副本值收敛，但并发写静默丢 ⇒ SEC 教学位✗；可覆盖写任意值含 null⇒表达✓；O(1) 恒 24B⇒紧凑✓）；' +
      'GCounter=100（分片 merge=max 真收敛、增量不丢⇒SEC✓；decrement 真拒⇒表达✗；O(nodes)⇒紧凑✗）；' +
      'OrSet=110（add-wins tag 并集真收敛、并发 add 全活⇒SEC✓；remove() 真删可见⇒表达✓；O(ops) tag 堆积⇒紧凑✗）。' +
      '诚实标定：三者严格 SEC 全为真（都是合格 CRDT，副本逐字收敛），LWW 的 SEC 教学位✗ 破在「并发意图被吞」而非副本分歧，绝不谎称 LWW 副本不收敛；OrSet 采用 add-wins（observed-remove），并发 add 存活是已知代价。' +
      'rigged 三开关 uniformClock / infiniteMetadata / coordinatedDelete 齐开：唯一抹掉 GCounter 的 compact 外部成本（100→101，与 KI-530 ExactSet 101→111 同构），' +
      '但三条因果结构锁真跑钉死——LWW 并发丢（完美时钟也救不了）/ GCounter decrement 不可减（三开关全给仍 false）/ OrSet tag 历史不可压（压成计数则并发 race 收敛出错）⇒ noUniversalWinner 仍真、绝不硬造 111。'
  }

  /* ================= KI-532 BulkWriter/ChunkedWriter/SkipRetryWriter Spring Batch R-P-W · 第二十六维（sb 族） ================= */

  function renderSpringBatch(sb) {
    renderSbMatrix(sb && sb.rows, sb && sb.config)
    renderSbLadder(sb && sb.rows)
    renderSbTrilemma(sb && sb.rows, sb && sb.verdict, sb && sb.crosscheck)
  }

  function sbMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">' + esc(label) + ' 暂缺</div>'
    if (note) note.textContent = 'systems.springBatch 缺失 — 跑一次 npm run console:data 即可补齐'
  }

  // 状态字只认真件现算好的三布尔，按三难维序 [faultIsolation / restartability / throughput] 取第一个破位，
  // 与后端 vectorOf 及 mesh-e2e ladder 同源：崩=整批死(faultIsolation破) / 锁=无 chk 不可续跑(restartability破) /
  // 滞=chunk commit 拖吞吐(throughput破)。注意 cell 的 restartability/throughput 是「协议在该场景的可达能力」，
  // 只有含毒考场才暴露 faultIsolation 软肋；无毒 cell 三布尔全真空真不连坐。
  function sbCell(c) {
    if (!c) return { cls: '', ch: '·' }
    if (c.faultIsolation === false) return { cls: 'dead', ch: '崩' }
    if (c.restartability === false) return { cls: 'fast', ch: '锁' }
    if (c.throughput === false) return { cls: 'heavy', ch: '滞' }
    return { cls: 'ok', ch: '✓' }
  }

  function renderSbMatrix(rows, config) {
    var box = $('#sb-matrix'), note = $('#sb-matrix-note')
    if (!Array.isArray(rows) || !rows.length || !config || !Array.isArray(config.scenarios)) {
      sbMissing(box, note, 'sb 矩阵'); return
    }
    var scenarios = config.scenarios
    var head = '<div class="sb-mat-row sb-mat-head"><span class="sb-mat-proto">策略</span>' +
      scenarios.map(function (sc) { return '<span class="sb-sc">' + esc(sc) + '</span>' }).join('') +
      '<span class="sb-mat-cost">毒/ chk / tp</span></div>'
    var body = rows.map(function (row) {
      var cells = scenarios.map(function (sc) {
        var cell = Array.isArray(row.scenarios) ? row.scenarios.find(function (x) { return x.id === sc }) : null
        var st = sbCell(cell)
        return '<span class="sb-cell ' + st.cls + '" data-strategy="' + esc(row.protocol) + '" data-s="' + esc(sc) +
          '" data-state="' + (st.cls || 'na') + '">' + st.ch + '</span>'
      }).join('')
      var m = row.metrics || {}
      return '<div class="sb-mat-row" data-strategy="' + esc(row.protocol) + '">' +
        '<span class="sb-mat-proto">' + esc(row.protocol) + '</span>' +
        cells + '<span class="sb-mat-cost"><b>' + esc(String(m.poisonDeaths)) + '</b>/' + esc(fmt(m.chunkedCheckpoints)) + '/' + esc(String(m.itemsProcessed)) + '</span></div>'
    }).join('')
    box.innerHTML = head + body
    if (note) note.textContent = 'BulkWriter / ChunkedWriter / SkipRetryWriter × 六场景：cleanRun（无 poison 全量跑）/ poisonOne（流中点单个毒）/ restartMidway（单个毒落中点、验 chk 续跑）/ burstLoad（items×2 吞吐压测）/ skipSaturation（每 32 项一个毒、超 skipLimit=2）/ cleanRerun（确定性重跑、单个毒验幂等）。' +
      '每格只认真件现算好的三布尔（faultIsolation/restartability/throughput）——绝不拿阈值重算，与三难向量/vectors 同源。' +
      '状态字：崩=poison 整批死 / 锁=无 chk 不可续跑 / 滞=chunk commit 拖吞吐 / ✓=该场景无软肋。' +
      'BulkWriter：一次 flush 吞吐最快、checkpoints=0、poison 即整批死；ChunkedWriter：chunkSize=8 分块独立事务、poison 只杀当前 chunk、restart(fromChk) 真续跑且已 commit 零重复写；SkipRetryWriter：skipLimit=2 毒行跳过后永久丢、无 chk 不可恢复（skipPolicy 真语义）。'
  }

  function renderSbLadder(rows) {
    var box = $('#sb-ladder')
    if (!box || !Array.isArray(rows) || !rows.length) { if (box) box.innerHTML = ''; return }
    var max = Math.max.apply(null, rows.map(function (r) { return r.metrics && isNum(r.metrics.itemsProcessed) ? r.metrics.itemsProcessed : 1 }).concat([1]))
    box.innerHTML = rows.map(function (r) {
      var m = r.metrics || {}
      var w = isNum(m.itemsProcessed) ? Math.round(m.itemsProcessed / max * 100) : 0
      return '<div class="sb-line" data-strategy="' + esc(r.protocol) + '"><span class="tag">' + esc(r.protocol) + '</span>' +
        '<span class="sb-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="num">吞吐量 ' + esc(String(m.itemsProcessed)) + ' · 毒物死 ' + esc(String(m.poisonDeaths)) + ' 次' + (r.protocol === 'ChunkedWriter' ? ' · chk ' + esc(String(m.chunkedCheckpoints)) + ' 真 chk' : '') + '</span></div>'
    }).join('')
  }

  function renderSbTrilemma(rows, verdict, crosscheck) {
    var box = $('#sb-trilemma'), veBox = $('#sb-verif'), cxBox = $('#sb-crosscheck'), note = $('#sb-trilemma-note')
    if (!Array.isArray(rows) || !rows.length) {
      sbMissing(box, note, 'sb 判词'); if (cxBox) cxBox.innerHTML = ''; if (veBox) veBox.innerHTML = ''; return
    }
    // 顺序必须与后端 vectorOf 维序 [faultIsolation / restartability / throughput] 逐字一致，
    // 否则前端拼出的向量与 snapshot.vectors 对不上。
    var flags = [['faultIsolation', '容错隔离'], ['restartability', 'chk 续跑'], ['throughput', '吞吐']]
    var head = '<div class="sb-vec sb-vec-head"><span class="proto">策略</span>' +
      flags.map(function (fl) { return '<span>' + fl[1] + '</span>' }).join('') + '<span class="vec">向量</span></div>'
    var body = rows.map(function (r) {
      var t = r.trilemma || {}
      var cells = flags.map(function (fl) {
        var yes = t[fl[0]] === true
        return '<span class="sb-flag ' + (yes ? 'yes' : 'no') + '" data-strategy="' + esc(r.protocol) + '" data-k="' + fl[0] +
          '" data-v="' + (yes ? '1' : '0') + '">' + (yes ? '✓' : '✗') + '</span>'
      }).join('')
      var vec = flags.map(function (fl) { return t[fl[0]] === true ? '1' : '0' }).join('')
      return '<div class="sb-vec" data-strategy="' + esc(r.protocol) + '"><span class="proto">' + esc(r.protocol) + '</span>' + cells +
        '<span class="vec" data-vec="' + vec + '">' + vec + '</span></div>'
    }).join('')
    box.innerHTML = head + body

    if (veBox) {
      var bulk = rows.find(function (r) { return r.protocol === 'BulkWriter' })
      var chunk = rows.find(function (r) { return r.protocol === 'ChunkedWriter' })
      var skip = rows.find(function (r) { return r.protocol === 'SkipRetryWriter' })
      var cp = crosscheck && crosscheck.checkpoint
      veBox.innerHTML = [
        '<div class="sb-rb-row" data-rb="bulkAllOrNothingCausallyUnerasable"><b>BulkWriter</b> 真跑 poisonOne → wholeBatchDied=' +
          (bulk && bulk.scenarios && bulk.scenarios.find(function (sc) { return sc.id === 'poisonOne' })?.wholeBatchDied ? 'true' : 'false') +
          '（一次 flush 吞吐最快，但真毒必整批死、checkpoints=0；完美预言机须换输入流才救，同一 raw 流抹不掉）</div>',
        '<div class="sb-rb-row" data-rb="checkpointTradeoffCausallyUnerasable"><b>ChunkedWriter</b> 真跑 restartMidway → chk=' +
          esc(String(chunk ? chunk.metrics.chunkedCheckpoints : 0)) +
          '（poison 只杀当前 chunk、其余照 commit、已 commit 零重复写；chk 是 restartability 与 throughput 的唯一分界，给 Skip 无限 skip 也造不出既有 chk 又不停顿）</div>',
        '<div class="sb-rb-row" data-rb="skipSilentLossCausallyUnerasable"><b>SkipRetryWriter</b> 真跑 skipSaturation → dropped=' +
          esc(String(skip ? skip.metrics.itemsDropped : 0)) +
          '（pipeline 不卡，但毒行永久丢、无 chk 不可恢复；unlimitedSkip 只免 fatal 不免丢 = skipPolicy 真语义）</div>',
      ].join('') +
        (cp ? '<div class="sb-rb-row" data-rb="holds">verifyCheckpoint holds=' + (cp.holds ? 'true' : 'false') +
          ' · baselineHolds=' + (cp.baselineHolds ? 'true' : 'false') +
          ' · <span data-rb="nontrivial">nontrivial=' + (cp.nontrivial ? 'true' : 'false') + '</span>' +
          ' · <span data-rb="falsifiable">falsifiable=' + (cp.falsifiable ? 'true' : 'false') + '</span>' +
          ' · laneA{baseline=' + esc(String(cp.laneA && cp.laneA.baselineProcessed)) + '} laneB{completed=' + esc(String(cp.laneB && cp.laneB.completedProcessed)) + ' unique=' + esc(String(cp.laneB && cp.laneB.uniqueCommitted)) + '}</div>' +
          '<div class="sb-rb-row" data-rb-tamper="corruptCheckpoint">篡改① chk 指针 corrupt ⇒ 真制造重复写 ⇒ noDuplicate 现算翻 false</div>' +
          '<div class="sb-rb-row" data-rb-tamper="silentPoison">篡改② 静默吞毒当正常项 commit ⇒ poisonIsolated 现算翻 false</div>' +
          '<div class="sb-rb-row" data-rb-tamper="emptyJob">篡改③ 空 jobs ⇒ nontrivial 现算翻 false（绝不 0=0 假绿）</div>' : '')
    }

    if (cxBox) {
      var ev = crosscheck && crosscheck.evidence
      var cp = crosscheck && crosscheck.checkpoint
      if (ev) {
        cxBox.innerHTML =
          '<div>真 <b>compareRemapping</b> 迁移率 一致性 ' + esc(String((ev.remapConsistentRate ?? 0).toFixed(4))) + ' vs 取模 ' + esc(String((ev.remapModuloRate ?? 0).toFixed(4))) + '</div>' +
          '<div>真 <b>createShardRouter.remapOn</b> 迁移 ' + esc(fmt(ev.routerMoved)) + ' 片</div>' +
          '<div>真 <b>createHashRing</b> ' + esc(fmt(ev.ringNodes)) + ' 节点 / 命中 ' + esc(fmt(ev.ringShardsUsed)) + '</div>' +
          '<div>真 <b>createWal</b> lines ' + esc(fmt(ev.walLines)) + ' / restore+replay <b>' + esc(fmt(ev.walReplayed)) + '</b></div>' +
          '<div>真 <b>createBus</b> batch.done 通知 ' + esc(fmt(ev.notices)) + ' 条 · listenerCount ' + esc(fmt(ev.busListeners)) + '</div>' +
          '<div>真 <b>createRedisCache</b> 聚合槽 set+get 命中 ' + esc(fmt(ev.redisBitmapHits)) + ' · entries ' + esc(fmt(ev.redisSlots)) + '</div>' +
          '<div>真 <b>createObjectPool</b> 新建 ' + esc(fmt(ev.poolCreated)) + ' / 复用 ' + esc(fmt(ev.poolReused)) + '</div>' +
          '<div>真 <b>createTokenBucket</b> 回放允许 <b>' + esc(fmt(ev.bucketAllowed)) + '</b> / 拒 ' + esc(fmt(ev.bucketRejected)) + '</div>' +
          '<div>真 <b>createMinHeapDelayQueue</b> 出队 ' + esc(fmt(ev.heapFired)) + ' 条 · pending ' + esc(fmt(ev.heapPending)) + '</div>' +
          '<div>真 <b>createPackedCounters</b> Σ=' + esc(fmt(ev.counterSum)) + ' · falseSharingPairs=' + esc(fmt(ev.counterFalseSharing)) + '</div>' +
          '<div>真 <b>createFullJitterBackoff</b> jitterSpread=' + esc(fmt(ev.jitterSpread)) + '（64 样本全抖动）</div>' +
          (cp ? '<div>真 <b>verifyCheckpoint</b> holds=<b>' + (cp.holds ? 'true' : 'false') + '</b> baselineHolds=<b>' + (cp.baselineHolds ? 'true' : 'false') + '</b> nontrivial=<b>' + (cp.nontrivial ? 'true' : 'false') + '</b> · laneA{baseline=' + esc(String(cp.laneA && cp.laneA.baselineProcessed)) + '} laneB{completed=' + esc(String(cp.laneB && cp.laneB.completedProcessed)) + ' unique=' + esc(String(cp.laneB && cp.laneB.uniqueCommitted)) + '} · 3 篡改真喂回同一内核现算翻 false</div>' : '')
      } else {
        cxBox.innerHTML = '<div class="nodata">真件交叉印证缺失</div>'
      }
    }

    var v = verdict || {}
    var noWin = v.noUniversalWinner === true
    var allHold = v.causalLocksAllHold === true
    var collapsed = v.riggedConvergenceCollapsed === true
    var chips = [
      '<span class="chip" data-verdict="bulkAllOrNothingCausallyUnerasable"><b>锁①</b> Bulk 真 poison 必整批死（同一 raw 流抹不掉） ' + (v.bulkAllOrNothingCausallyUnerasable ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="checkpointTradeoffCausallyUnerasable"><b>锁②</b> chk 权衡：有 chk 必拖吞吐、无 chk 必不可续跑 ' + (v.checkpointTradeoffCausallyUnerasable ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="skipSilentLossCausallyUnerasable"><b>锁③</b> Skip 毒行永久丢、unlimitedSkip 只免 fatal ' + (v.skipSilentLossCausallyUnerasable ? '✓' : '✗') + '</span>',
      '<span class="chip ' + (allHold ? 'jade-t' : 'muted-t') + '" data-verdict="causalLocksAllHold">' + (allHold ? '✓ 三因果锁全钉死（同一含毒 raw 流真跑现算、任何 rigged 开关都救不了）' : '因果锁未全Hold') + '</span>',
      '<span class="chip" data-verdict="chunkedChkAvailable"><b>Chunked</b> 真 chk 续跑 ' + (v.chunkedChkAvailable ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="skipSilentLoss"><b>Skip</b> 毒行永久丢 ' + (v.skipSilentLoss ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="riggedConvergenceCollapsed"><b>诚实标定</b> rigged ⇒ Bulk≡Skip=101 区分度收敛 ' + (collapsed ? '✓' : '·') + '</span>',
      '<span class="chip ' + (noWin ? 'jade-t' : 'muted-t') + '" data-verdict="noUniversalWinner">' + (noWin ? '✓ 三向量互异（001/110/101）、无一 111、不封赢家' : '默认态塌陷') + '</span>',
    ]
    var probes = $('#sb-probes')
    if (probes) probes.innerHTML = chips.join('')
    if (note) note.textContent = '维序固定 [faultIsolation / restartability / throughput]，三位全部真跑现算、不查协议名表：' +
      'BulkWriter=001（一次 flush 吞吐最快、checkpoints=0 ⇒ restartability✗/throughput✓；poison 一现整批死 ⇒ faultIsolation✗）；' +
      'ChunkedWriter=110（chunkSize=8 分块独立事务、poison 只杀当前 chunk、restart(fromChk) 真续跑且已 commit 零重复写 ⇒ faultIsolation✓/restartability✓；checkpoints>0 故 commit 占 pipeline ⇒ throughput✗）；' +
      'SkipRetryWriter=101（skipLimit=2 毒行跳过后永久丢、无 chk ⇒ restartability✗；pipeline 不卡 ⇒ throughput✓；毒项被隔离不整批死 ⇒ faultIsolation✓）。' +
      '硬结构：restartability 与 throughput 共用 stats().checkpoints 真观测量而天然互斥——这正是三难，零写死。' +
      'verifyCheckpoint 双路自证：路 A clean 全量全 commit 求基准，路 B 真跑 restart(0) 用「poison chunk 隔离 / 已 commit 无重复 / 非毒零丢失 / 真检测到毒」四观测量判定；三路篡改真喂回同一内核现算翻 false，带 baselineHolds 先真绿。' +
      '三条因果结构锁在同一含毒 raw 流真跑钉死：Bulk 无 chk 整批死、chk 权衡不可兼得、Skip 跳毒永久丢。' +
      'rigged 双开关 perfectOracle（毒项 100% 判定、预防性从输入剔除）+ unlimitedSkip 喂的是已剔除毒项的干净流（换了作业输入、诚实标注，不是同一作业被抹软肋）⇒ 三者 faultIsolation 全真、Bulk≡Skip=101 区分度诚实收敛（riggedConvergenceCollapsed=true，教学结论：完美预言机抹平了「预防剔除」与「跳过」的差别，二者结构等价），noStrategyWinsAll 仍真绝不硬造 111，三因果锁仍 allHold。'
  }

  /* ================= KI-534 DualWrite/PollingOutbox/CdcOutbox Spring Cloud 事务性发件箱 · 第二十八维（ob 族） ================= */

  function renderTransactionalOutbox(ob) {
    renderObMatrix(ob && ob.rows, ob && ob.config)
    renderObLadder(ob && ob.rows)
    renderObTrilemma(ob && ob.rows, ob && ob.verdict, ob && ob.crosscheck)
  }

  function obMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">' + esc(label) + ' 暂缺</div>'
    if (note) note.textContent = 'systems.transactionalOutbox 缺失 — 跑一次 npm run console:data 即可补齐'
  }

  function obCell(c) {
    if (!c) return { cls: '', ch: '·' }
    if (c.lost > 0) return { cls: 'lost', ch: '丢' }
    if (c.duplicates > 0) return { cls: 'dup', ch: '重' }
    if (c.maxDeliveryLag > 2) return { cls: 'delayed', ch: '缓' }
    return { cls: 'ok', ch: '✓' }
  }

  function renderObMatrix(rows, config) {
    var box = $('#ob-matrix'), note = $('#ob-matrix-note')
    if (!Array.isArray(rows) || !rows.length || !config || !Array.isArray(config.scenarios)) {
      obMissing(box, note, 'ob 矩阵'); return
    }
    var scenarios = config.scenarios
    var head = '<div class="ob-mat-row ob-mat-head"><span class="ob-mat-proto">策略</span>' +
      scenarios.map(function (sc) { return '<span class="ob-sc">' + esc(sc) + '</span>' }).join('') +
      '<span class="ob-mat-cost">丢/重/ lag</span></div>'
    var body = rows.map(function (row) {
      var cells = scenarios.map(function (sc) {
        var cell = Array.isArray(row.scenarios) ? row.scenarios.find(function (x) { return x.id === sc }) : null
        var st = obCell(cell)
        return '<span class="ob-cell ' + st.cls + '" data-strategy="' + esc(row.protocol) + '" data-s="' + esc(sc) +
          '" data-state="' + (st.cls || 'na') + '">' + st.ch + '</span>'
      }).join('')
      var m = row.metrics || {}
      return '<div class="ob-mat-row" data-strategy="' + esc(row.protocol) + '">' +
        '<span class="ob-mat-proto">' + esc(row.protocol) + '</span>' +
        cells + '<span class="ob-mat-cost"><b>' + esc(fmt(m.lost)) + '</b>/' + esc(fmt(m.duplicates)) + '/' + esc(fmt(m.maxDeliveryLag)) + '</span></div>'
    }).join('')
    box.innerHTML = head + body
    if (note) note.textContent = 'DualWrite / PollingOutbox / CdcOutbox × 六场景：steadyFlow（稳态）/ crashAfterCommit（崩溃注入 commit→publish 之间）/ retryStorm（消费端确认丢·at-least-once 重投）/ consumerHalfCrash（消费端副作用已走·去重标记丢）/ pollLag（pollInterval=4 tick 轮询 lag）/ cleanRerun（重跑同结果）。' +
      '每格只认真件算好的三布尔（atomicDelivery ∧ lowLatency ∧ noDuplicate）——绝不由阈值重算。' +
      'DualWrite: 崩溃后永久丢一条（原子性缺）；Polling: 同事务+轮询扫（poll lag 真实存在·消费端事务性 dedup）；Cdc: 同事务+tail 近实时（无 dedup · at-least-once 重复暴露）。'
  }

  function renderObLadder(rows) {
    var box = $('#ob-ladder')
    if (!box || !Array.isArray(rows) || !rows.length) { if (box) box.innerHTML = ''; return }
    var max = Math.max.apply(null, rows.map(function (r) { return r.metrics && isNum(r.metrics.committed) ? r.metrics.committed : 1 }).concat([1]))
    box.innerHTML = rows.map(function (r) {
      var m = r.metrics || {}
      var w = isNum(m.delivered) ? Math.round(m.delivered / max * 100) : 0
      return '<div class="ob-line" data-strategy="' + esc(r.protocol) + '"><span class="tag">' + esc(r.protocol) + '</span>' +
        '<span class="ob-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="num">提交 ' + esc(fmt(m.committed)) + ' · 投递 ' + esc(fmt(m.delivered)) + ' · 丢 ' + esc(String(m.lost)) + ' · 重 ' + esc(String(m.duplicates)) + ' · lag ' + esc(String(m.maxDeliveryLag)) + '</span></div>'
    }).join('')
  }

  function renderObTrilemma(rows, verdict, crosscheck) {
    var box = $('#ob-trilemma'), veBox = $('#ob-verif'), cxBox = $('#ob-crosscheck'), note = $('#ob-trilemma-note')
    if (!Array.isArray(rows) || !rows.length) {
      obMissing(box, note, 'ob 判词'); if (cxBox) cxBox.innerHTML = ''; if (veBox) veBox.innerHTML = ''; return
    }
    var flags = [['atomicDelivery', '原子不丢'], ['lowLatency', '近实时'], ['noDuplicate', '消费幂等']]
    var head = '<div class="ob-vec ob-vec-head"><span class="proto">策略</span>' +
      flags.map(function (fl) { return '<span>' + fl[1] + '</span>' }).join('') + '<span class="vec">向量</span></div>'
    var body = rows.map(function (r) {
      var t = r.trilemma || {}
      var cells = flags.map(function (fl) {
        var yes = t[fl[0]] === true
        return '<span class="ob-flag ' + (yes ? 'yes' : 'no') + '" data-strategy="' + esc(r.protocol) + '" data-k="' + fl[0] +
          '" data-v="' + (yes ? '1' : '0') + '">' + (yes ? '✓' : '✗') + '</span>'
      }).join('')
      var vec = flags.map(function (fl) { return t[fl[0]] === true ? '1' : '0' }).join('')
      return '<div class="ob-vec" data-strategy="' + esc(r.protocol) + '"><span class="proto">' + esc(r.protocol) + '</span>' + cells +
        '<span class="vec" data-vec="' + vec + '">' + vec + '</span></div>'
    }).join('')
    box.innerHTML = head + body

    if (veBox) {
      var dual = rows.find(function (r) { return r.protocol === 'DualWrite' })
      var poll = rows.find(function (r) { return r.protocol === 'PollingOutbox' })
      var cdc = rows.find(function (r) { return r.protocol === 'CdcOutbox' })
      var cp = crosscheck && crosscheck.soundness
      veBox.innerHTML = [
        '<div class="ob-rb-row"><b>DualWrite</b> atomic=' + esc(String(dual?.trilemma?.atomicDelivery)) + '（提交后直发·crashAfterCommit 注入点真丢一条·原子性来自持久状态而不是开关）</div>',
        '<div class="ob-rb-row"><b>PollingOutbox</b> 原子=' + esc(String(poll?.trilemma?.atomicDelivery)) + ' · 近实时=' + esc(String(poll?.trilemma?.lowLatency)) + '（poll 4 tick lag）· 消费幂等=' + esc(String(poll?.trilemma?.noDuplicate)) + '（同事务+事务性 dedup）</div>',
        '<div class="ob-rb-row"><b>CdcOutbox</b> 原子=' + esc(String(cdc?.trilemma?.atomicDelivery)) + ' · 近实时=' + esc(String(cdc?.trilemma?.lowLatency)) + '（tail 近实时）· 消费幂等=' + esc(String(cdc?.trilemma?.noDuplicate)) + '（无消费端 dedup · consumerHalfCrash/retryStorm 下真重复）</div>',
        cp ? '<div class="ob-rb-row"><b>verifyOutboxSoundness</b> holds=' + (cp.holds ? 'true' : 'false') + ' nontrivial=' + (cp.nontrivial ? 'true' : 'false') + ' falsifiable=' + (cp.falsifiable ? 'true' : 'false') + ' · laneA{committed=' + esc(String(cp.laneA && cp.laneA.businessTransactions)) + ' delivered=' + esc(String(cp.laneA && cp.laneA.messagesDelivered)) + '} laneB{committed=' + esc(String(cp.laneB && cp.laneB.committed)) + ' deliveries=' + esc(String(cp.laneB && cp.laneB.deliveries)) + ' unique=' + esc(String(cp.laneB && cp.laneB.uniqueProcessed)) + '}</div>' : '',
      ].join('')
    }

    if (cxBox) {
      var ev = crosscheck && crosscheck.evidence
      if (ev) {
        cxBox.innerHTML =
          '<div>真 <b>compareRemapping</b> 迁移率 一致性 ' + esc(String((ev.remapConsistentRate ?? 0).toFixed(4))) + ' vs 取模 ' + esc(String((ev.remapModuloRate ?? 0).toFixed(4))) + '</div>' +
          '<div>真 <b>createShardRouter.remapOn</b> 迁移 ' + esc(fmt(ev.routerMoved)) + ' 片</div>' +
          '<div>真 <b>createHashRing</b> ' + esc(fmt(ev.ringNodes)) + ' 节点 / 命中 ' + esc(fmt(ev.ringShardsUsed)) + '</div>' +
          '<div>真 <b>createWal</b> lines ' + esc(fmt(ev.walLines)) + ' / restore+replay <b>' + esc(fmt(ev.walReplayed)) + '</b></div>' +
          '<div>真 <b>createBus</b> outbox.published 通知 ' + esc(fmt(ev.notices)) + ' 条 · listenerCount ' + esc(fmt(ev.busListeners)) + '</div>' +
          '<div>真 <b>createRedisCache</b> dedup set+get 命中 ' + esc(fmt(ev.redisBitmapHits)) + ' · entries ' + esc(fmt(ev.redisSlots)) + '</div>' +
          '<div>真 <b>createObjectPool</b> 新建 ' + esc(fmt(ev.poolCreated)) + ' / 复用 ' + esc(fmt(ev.poolReused)) + '</div>' +
          '<div>真 <b>createTokenBucket</b> 回放允许 <b>' + esc(fmt(ev.bucketAllowed)) + '</b> / 拒 ' + esc(fmt(ev.bucketRejected)) + '</div>' +
          '<div>真 <b>createMinHeapDelayQueue</b> 出队 ' + esc(fmt(ev.heapFired)) + ' 条 · pending ' + esc(fmt(ev.heapPending)) + '</div>' +
          '<div>真 <b>createFullJitterBackoff</b> jitterSpread <b>' + esc(String((ev.jitterSpread ?? 0).toFixed(4))) + '</b>（64 采样 delayFor 真采样）</div>' +
          '<div>真 <b>createPackedCounters</b> Σ=' + esc(fmt(ev.counterSum)) + ' · falseSharingPairs=' + esc(fmt(ev.counterFalseSharing)) + '</div>'
      } else {
        cxBox.innerHTML = '<div class="nodata">真件交叉印证缺失</div>'
      }
    }

    var v = verdict || {}
    var noWin = v.noUniversalWinner === true
    var chips = [
      '<span class="chip" data-verdict="dualWriteLosesOnCrash"><b>DualWrite</b> 崩溃真丢 ' + (v.dualWriteLosesOnCrash ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="pollingNoDup"><b>PollingOutbox</b> 零 dup ' + (v.pollingNoDup ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="cdcDuplicatesOnHalfCrash"><b>CdcOutbox</b> 半崩溃 dup ' + (v.cdcDuplicatesOnHalfCrash ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="noStrategyWinsAll"><b>noStrategyWinsAll</b> ' + (v.noStrategyWinsAll ? '✓（无一 111）' : '✗') + '</span>',
      '<span class="chip ' + (noWin ? 'jade-t' : 'muted-t') + '" data-verdict="noUniversalWinner">' + (noWin ? '✓ 三向量互异（011/101/110），无全局赢家、恰好各缺一维' : '判词塌陷') + '</span>',
      '<span class="chip ' + (v.riggedConvergenceCollapsed ? 'jade-t' : 'muted-t') + '" data-verdict="riggedConvergenceCollapsed">' + (v.riggedConvergenceCollapsed ? '✓ rigged collapsed Polling≡Cdc=110' : '未 rigged 或未塌缩') + '</span>',
    ]
    var probes = $('#ob-probes')
    if (probes) probes.innerHTML = chips.join('')
    if (note) note.textContent = '维序固定 [atomicDelivery / lowLatency / noDuplicate]。默认向量 DualWrite=011（崩溃真丢、零延迟零重） / PollingOutbox=101（不丢不重·轮询 lag 真实存在） / CdcOutbox=110（近实时·but 消费端无 dedup）——恰好各缺一维、向量互异、无一 111。' +
      'rigged 三探针：atomicMagic 只给 DualWrite ⇒ 崩溃仍丢（011 不变）；zeroPollInterval 只给 Polling ⇒ 撤掉批次合并保护 lag=0 且重复暴露（110）；perfectDedup 只给 Cdc ⇒ 滤掉 retryStorm 重投但 consumerHalfCrash 窗口仍在（110）；三开齐 ⇒ Polling≡Cdc=110 区分度诚实塌缩。'
  }

  /* ================= KI-535 StickySession/JwtStateless/RedisSessionStore 分布式会话 · 第二十九维（ds 族） ================= */

  function renderDistributedSession(ds) {
    renderDsMatrix(ds && ds.rows, ds && ds.config)
    renderDsLadder(ds && ds.rows)
    renderDsTrilemma(ds && ds.rows, ds && ds.verdict, ds && ds.crosscheck)
  }

  function dsMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">' + esc(label) + ' 暂缺</div>'
    if (note) note.textContent = 'systems.distributedSession 缺失 — 跑一次 npm run console:data 即可补齐'
  }

  function dsCell(c) {
    if (!c) return { cls: '', ch: '·' }
    if (c.sharedCoherence === false) return { cls: 'pinned', ch: '钉' }
    if (c.instantRevocation === false) return { cls: 'durable', ch: '持' }
    if (c.zeroInfra === false) return { cls: 'dependency', ch: '依' }
    return { cls: 'ok', ch: '✓' }
  }

  function renderDsMatrix(rows, config) {
    var box = $('#ds-matrix'), note = $('#ds-matrix-note')
    if (!Array.isArray(rows) || !rows.length || !config || !Array.isArray(config.scenarios)) {
      dsMissing(box, note, 'ds 矩阵'); return
    }
    var scenarios = config.scenarios
    var head = '<div class="ds-mat-row ds-mat-head"><span class="ds-mat-proto">策略</span>' +
      scenarios.map(function (sc) { return '<span class="ds-sc">' + esc(sc) + '</span>' }).join('') +
      '<span class="ds-mat-cost">跨节点/撤销/基建</span></div>'
    var body = rows.map(function (row) {
      var cells = scenarios.map(function (sc) {
        var cell = Array.isArray(row.scenarios) ? row.scenarios.find(function (x) { return x.id === sc }) : null
        var st = dsCell(cell)
        return '<span class="ds-cell ' + st.cls + '" data-strategy="' + esc(row.protocol) + '" data-s="' + esc(sc) +
          '" data-state="' + (st.cls || 'na') + '">' + st.ch + '</span>'
      }).join('')
      var m = row.metrics || {}
      return '<div class="ds-mat-row" data-strategy="' + esc(row.protocol) + '">' +
        '<span class="ds-mat-proto">' + esc(row.protocol) + '</span>' +
        cells + '<span class="ds-mat-cost"><b>' + esc(fmt(m.sessionWrites)) + '</b>/' + esc(fmt(m.readableSessions)) + '/' + esc(String(m.revokedCells)) + '</span></div>'
    }).join('')
    box.innerHTML = head + body
    if (note) note.textContent = 'StickySession / JwtStateless / RedisSessionStore × 六场景：cleanServe（正常服务）/ instanceFailover（实例挂掉）/ revokeLive（踢出重登）/ burstScaleOut（横向扩容）/ idleExpiry（ttl 过期）/ mixedLoad（混合负载）。' +
      '每格只认真件算好的三布尔（sharedCoherence / instantRevocation / zeroInfra）——绝不拿阈值重算。' +
      'Sticky: 零基建/本地即时/跨实例不可见；JWT: 验签即认/无状态/撤销不即时；Redis: 全认/DEL 即撤销/依赖 Redis 基建。'
  }

  function renderDsLadder(rows) {
    var box = $('#ds-ladder')
    if (!box || !Array.isArray(rows) || !rows.length) { if (box) box.innerHTML = ''; return }
    var max = Math.max.apply(null, rows.map(function (r) { return r.metrics && isNum(r.metrics.sessionWrites) ? r.metrics.sessionWrites : 1 }).concat([1]))
    box.innerHTML = rows.map(function (r) {
      var m = r.metrics || {}
      var w = isNum(m.sessionWrites) ? Math.round(m.sessionWrites / max * 100) : 0
      return '<div class="ds-line" data-strategy="' + esc(r.protocol) + '"><span class="tag">' + esc(r.protocol) + '</span>' +
        '<span class="ds-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="num">写入 ' + esc(fmt(m.sessionWrites)) + ' · 可读 ' + esc(fmt(m.readableSessions)) + ' · 撤销格 ' + esc(String(m.revokedCells)) + '</span></div>'
    }).join('')
  }

  function renderDsTrilemma(rows, verdict, crosscheck) {
    var box = $('#ds-trilemma'), veBox = $('#ds-verif'), cxBox = $('#ds-crosscheck'), note = $('#ds-trilemma-note')
    if (!Array.isArray(rows) || !rows.length) {
      dsMissing(box, note, 'ds 判词'); if (cxBox) cxBox.innerHTML = ''; if (veBox) veBox.innerHTML = ''; return
    }
    var flags = [['sharedCoherence', '跨实例一致'], ['instantRevocation', '撤销即时'], ['zeroInfra', '零基建']]
    var head = '<div class="ds-vec ds-vec-head"><span class="proto">策略</span>' +
      flags.map(function (fl) { return '<span>' + fl[1] + '</span>' }).join('') + '<span class="vec">向量</span></div>'
    var body = rows.map(function (r) {
      var t = r.trilemma || {}
      var cells = flags.map(function (fl) {
        var yes = t[fl[0]] === true
        return '<span class="ds-flag ' + (yes ? 'yes' : 'no') + '" data-strategy="' + esc(r.protocol) + '" data-k="' + fl[0] +
          '" data-v="' + (yes ? '1' : '0') + '">' + (yes ? '✓' : '✗') + '</span>'
      }).join('')
      var vec = flags.map(function (fl) { return t[fl[0]] === true ? '1' : '0' }).join('')
      return '<div class="ds-vec" data-strategy="' + esc(r.protocol) + '"><span class="proto">' + esc(r.protocol) + '</span>' + cells +
        '<span class="vec" data-vec="' + vec + '">' + vec + '</span></div>'
    }).join('')
    box.innerHTML = head + body

    if (veBox) {
      var sticky = rows.find(function (r) { return r.protocol === 'StickySession' })
      var jwt = rows.find(function (r) { return r.protocol === 'JwtStateless' })
      var redis = rows.find(function (r) { return r.protocol === 'RedisSessionStore' })
      var cp = crosscheck && crosscheck.coherence
      veBox.innerHTML = [
        '<div class="ds-rb-row"><b>StickySession</b> 跨实例可见=' + esc(String(sticky?.trilemma?.sharedCoherence)) + '（ip_hash 粘性⇒实例间不通；crashNode 后实例上 session 全丢；本地撤销即删）</div>',
        '<div class="ds-rb-row"><b>JwtStateless</b> 验签即认=' + esc(String(jwt?.trilemma?.sharedCoherence)) + '（coherence 真 true）· 撤销即时=' + esc(String(jwt?.trilemma?.instantRevocation)) + '（签名-valid-until-exp）</div>',
        '<div class="ds-rb-row"><b>RedisSessionStore</b> 跨实例=' + esc(String(redis?.trilemma?.sharedCoherence)) + ' · 撤销即时=' + esc(String(redis?.trilemma?.instantRevocation)) + '(DEL 即生效) · 零基建=' + esc(String(redis?.trilemma?.zeroInfra)) + '（需 Redis）</div>',
        cp ? '<div class="ds-rb-row"><b>verifySessionCoherence</b> holds=' + (cp.holds ? 'true' : 'false') + ' nontrivial=' + (cp.nontrivial ? 'true' : 'false') + ' falsifiable=' + (cp.falsifiable ? 'true' : 'false') + ' · laneA{clean=' + esc(String(cp.laneA && cp.laneA.clean)) + ' redisReadable=' + esc(String(cp.laneA && cp.laneA.redisReadable)) + ' jwtVerified=' + esc(String(cp.laneA && cp.laneA.jwtVerified)) + '} laneB{revoked=' + esc(String(cp.laneB && cp.laneB.revoked)) + ' jwtStillValid=' + (cp.laneB && cp.laneB.jwtStillValid ? 'true' : 'false') + '}</div>' : '',
      ].join('')
    }

    if (cxBox) {
      var ev = crosscheck && crosscheck.evidence
      var cp = crosscheck && crosscheck.coherence
      if (ev) {
        cxBox.innerHTML =
          '<div>真 <b>compareRemapping</b> 迁移率 一致性 ' + esc(String((ev.remapConsistentRate ?? 0).toFixed(4))) + ' vs 取模 ' + esc(String((ev.remapModuloRate ?? 0).toFixed(4))) + '</div>' +
          '<div>真 <b>createShardRouter.remapOn</b> 迁移 ' + esc(fmt(ev.routerMoved)) + ' 片</div>' +
          '<div>真 <b>createHashRing</b> ' + esc(fmt(ev.ringNodes)) + ' 节点 / 命中 ' + esc(fmt(ev.ringShardsUsed)) + '</div>' +
          '<div>真 <b>createWal</b> lines ' + esc(fmt(ev.walLines)) + ' / restore+replay <b>' + esc(fmt(ev.walReplayed)) + '</b></div>' +
          '<div>真 <b>createBus</b> user.loggedIn 通知 ' + esc(fmt(ev.notices)) + ' 条 · listenerCount ' + esc(fmt(ev.busListeners)) + '</div>' +
          '<div>真 <b>createRedisCache</b> sess slot set+get 命中 ' + esc(fmt(ev.redisBitmapHits)) + ' · entries ' + esc(fmt(ev.redisSlots)) + '</div>' +
          '<div>真 <b>createObjectPool</b> 新建 ' + esc(fmt(ev.poolCreated)) + ' / 复用 ' + esc(fmt(ev.poolReused)) + '</div>' +
          '<div>真 <b>createTokenBucket</b> 回放允许 <b>' + esc(fmt(ev.bucketAllowed)) + '</b> / 拒 ' + esc(fmt(ev.bucketRejected)) + '</div>' +
          '<div>真 <b>createMinHeapDelayQueue</b> 出队 ' + esc(fmt(ev.heapFired)) + ' 条 · pending ' + esc(fmt(ev.heapPending)) + '</div>' +
          '<div>真 <b>createFullJitterBackoff</b> jitterSpread <b>' + esc(String((ev.jitterSpread ?? 0).toFixed(4))) + '</b>（64 采样 delayFor 真采样）</div>' +
          '<div>真 <b>createPackedCounters</b> Σ=' + esc(fmt(ev.counterSum)) + ' · falseSharingPairs=' + esc(fmt(ev.counterFalseSharing)) + '</div>' +
          (cp ? '<div>真 <b>verifySessionCoherence</b> holds=<b>' + (cp.holds ? 'true' : 'false') + '</b> nontrivial=<b>' + (cp.nontrivial ? 'true' : 'false') + '</b> · laneA{clean=' + esc(String(cp.laneA && cp.laneA.clean)) + ' redis=' + esc(String(cp.laneA && cp.laneA.redisReadable)) + ' jwt=' + esc(String(cp.laneA && cp.laneA.jwtVerified)) + '} laneB{revoked=' + esc(String(cp.laneB && cp.laneB.revoked)) + ' jwtStillValid=' + (cp.laneB && cp.laneB.jwtStillValid ? 'true' : 'false') + '} · 3 篡改真喂回翻 false</div>' : '')
      } else {
        cxBox.innerHTML = '<div class="nodata">真件交叉印证缺失</div>'
      }
    }

    var v = verdict || {}
    var noWin = v.noUniversalWinner === true
    var chips = [
      '<span class="chip" data-verdict="stickyFailsOverLoss"><b>StickySession</b> 节点丢失即丢 session ' + (v.stickyFailsOverLoss ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="jwtNoInstantRevoke"><b>JwtStateless</b> 撤销不即时 ' + (v.jwtNoInstantRevoke ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="redisPaysInfra"><b>RedisSessionStore</b> 基建代价 ' + (v.redisPaysInfra ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="redisInstantRevoke"><b>RedisSessionStore</b> DEL 即撤销 ' + (v.redisInstantRevoke ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="redisCoherent"><b>RedisSessionStore</b> 全认 ' + (v.redisCoherent ? '✓' : '✗') + '</span>',
      '<span class="chip ' + (noWin ? 'jade-t' : 'muted-t') + '" data-verdict="noUniversalWinner">' + (noWin ? '✓ 三向量互异（011/101/110），无全局赢家、恰好各缺一维' : '判词塌陷') + '</span>',
    ]
    var probes = $('#ds-probes')
    if (probes) probes.innerHTML = chips.join('')
    if (note) note.textContent = '维序固定 [sharedCoherence / instantRevocation / zeroInfra]。默认向量 StickySession=011（零基建+本地撤销即时，但跨实例不通） / JwtStateless=101（coherence 验签即认、撤销凭过期）/ RedisSessionStore=110（全认+DEL 即撤销但依赖 Redis）——恰好各缺一维、向量互异、无一 111。' +
      'rigged 单开 perfectMirror ⇒ Sticky 也读得到（sharedCoherence=true）；unlimitedTtl 不创撤销可见性（JWT stay false）；skipRevocationCheck 只抬 JWT revoke（coherence 成本分歧不解）；三开齐 ⇒ Sticky≡JWT=111 区分度诚实塌缩、noUniversalWinner=false。'
  }

  /* ================= KI-533 可观测性分布式追踪采样三策略 · 第二十七维（ts 族） ================= */

  function renderTraceSampling(ts) {
    renderTsMatrix(ts && ts.rows, ts && ts.config)
    renderTsLadder(ts && ts.rows)
    renderTsTrilemma(ts && ts.rows, ts && ts.verdict, ts && ts.crosscheck)
  }

  function tsMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">' + esc(label) + ' 暂缺</div>'
    if (note) note.textContent = 'systems.traceSampling 缺失 — 跑一次 npm run console:data 即可补齐'
  }

  // 状态字只认真件现算好的三布尔，按三难维序 [lowOverhead / anomalyCapture / loadAdaptive] 取第一个破位，
  // 与后端 vectorOf 及 mesh-e2e ladder 同源：盲=头部盲丢 error(anomalyCapture破) / 胀=缓冲整条吃开销(lowOverhead破) /
  // 滞=不随负载反馈调率(loadAdaptive破)。cell 三布尔由本格真观测量现算，非查表/写死。
  function tsCell(c) {
    if (!c) return { cls: '', ch: '·' }
    if (c.anomalyCapture === false) return { cls: 'dead', ch: '盲' }
    if (c.lowOverhead === false) return { cls: 'heavy', ch: '胀' }
    if (c.loadAdaptive === false) return { cls: 'fast', ch: '滞' }
    return { cls: 'ok', ch: '✓' }
  }

  function renderTsMatrix(rows, config) {
    var box = $('#ts-matrix'), note = $('#ts-matrix-note')
    if (!Array.isArray(rows) || !rows.length || !config || !Array.isArray(config.scenarios)) {
      tsMissing(box, note, 'ts 矩阵'); return
    }
    var scenarios = config.scenarios
    var head = '<div class="ts-mat-row ts-mat-head"><span class="ts-mat-proto">策略</span>' +
      scenarios.map(function (sc) { return '<span class="ts-sc">' + esc(sc) + '</span>' }).join('') +
      '<span class="ts-mat-cost">丢错 / 缓冲 / 调率</span></div>'
    var body = rows.map(function (row) {
      var cells = scenarios.map(function (sc) {
        var cell = Array.isArray(row.scenarios) ? row.scenarios.find(function (x) { return x.id === sc }) : null
        var st = tsCell(cell)
        return '<span class="ts-cell ' + st.cls + '" data-strategy="' + esc(row.protocol) + '" data-s="' + esc(sc) +
          '" data-state="' + (st.cls || 'na') + '">' + st.ch + '</span>'
      }).join('')
      var m = row.metrics || {}
      return '<div class="ts-mat-row" data-strategy="' + esc(row.protocol) + '">' +
        '<span class="ts-mat-proto">' + esc(row.protocol) + '</span>' +
        cells + '<span class="ts-mat-cost"><b>' + esc(fmt(m.errorTracesLost)) + '</b>/' + esc(fmt(m.peakBufferedSpans)) + '/' + esc(fmt(m.rateChanges)) + '</span></div>'
    }).join('')
    box.innerHTML = head + body
    if (note) note.textContent = 'HeadBased / TailBased / Adaptive × 六场景：steadyLoad（稳定低错误）/ errorBurst（中段连续 error 突发）/ spikeLoad（trace 数×3 负载突增）/ bufferPressure（大 trace 多 span 压缓冲）/ coldStart（前段 error 密集验反馈冷启动）/ cleanRerun（确定性重跑验幂等）。' +
      '每格只认真件现算好的三布尔（lowOverhead/anomalyCapture/loadAdaptive）——绝不拿阈值重算，与三难向量/vectors 同源。' +
      '状态字：盲=头部决策盲丢 error / 胀=缓冲整条吃开销 / 滞=不随负载反馈调率 / ✓=该场景无软肋。' +
      'HeadBased：root 即 O(1) 哈希决策、零 span 缓冲、率固定不反馈、决策早于 error 发生故盲丢异常；TailBased：缓冲整条 trace 至结束、按 error/延迟整体决策、确定性 100% 留 error 但缓冲吃开销；Adaptive：仍头部 O(1) 按窗口反馈环动态调率、零缓冲、maxRate 封顶仍补不上单条 anomaly 维。'
  }

  function renderTsLadder(rows) {
    var box = $('#ts-ladder')
    if (!box || !Array.isArray(rows) || !rows.length) { if (box) box.innerHTML = ''; return }
    var max = Math.max.apply(null, rows.map(function (r) { return r.metrics && isNum(r.metrics.spansIn) ? r.metrics.spansIn : 1 }).concat([1]))
    box.innerHTML = rows.map(function (r) {
      var m = r.metrics || {}
      var w = isNum(m.spansIn) ? Math.round(m.spansIn / max * 100) : 0
      return '<div class="ts-line" data-strategy="' + esc(r.protocol) + '"><span class="tag">' + esc(r.protocol) + '</span>' +
        '<span class="ts-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="num">入口 span ' + esc(fmt(m.spansIn)) + ' · 留 ' + esc(fmt(m.spansKept)) + ' · 丢错 trace ' + esc(fmt(m.errorTracesLost)) + (r.protocol === 'TailBasedSampler' ? ' · 缓冲峰值 ' + esc(fmt(m.peakBufferedSpans)) : '') + (r.protocol === 'AdaptiveSampler' ? ' · 调率 ' + esc(fmt(m.rateChanges)) + ' 次' : '') + '</span></div>'
    }).join('')
  }

  function renderTsTrilemma(rows, verdict, crosscheck) {
    var box = $('#ts-trilemma'), veBox = $('#ts-verif'), cxBox = $('#ts-crosscheck'), note = $('#ts-trilemma-note')
    if (!Array.isArray(rows) || !rows.length) {
      tsMissing(box, note, 'ts 判词'); if (cxBox) cxBox.innerHTML = ''; if (veBox) veBox.innerHTML = ''; return
    }
    // 顺序必须与后端 vectorOf 维序 [lowOverhead / anomalyCapture / loadAdaptive] 逐字一致
    var flags = [['lowOverhead', '低开销'], ['anomalyCapture', '异常保真'], ['loadAdaptive', '负载自适应']]
    var head = '<div class="ts-vec ts-vec-head"><span class="proto">策略</span>' +
      flags.map(function (fl) { return '<span>' + fl[1] + '</span>' }).join('') + '<span class="vec">向量</span></div>'
    var body = rows.map(function (r) {
      var t = r.trilemma || {}
      var cells = flags.map(function (fl) {
        var yes = t[fl[0]] === true
        return '<span class="ts-flag ' + (yes ? 'yes' : 'no') + '" data-strategy="' + esc(r.protocol) + '" data-k="' + fl[0] +
          '" data-v="' + (yes ? '1' : '0') + '">' + (yes ? '✓' : '✗') + '</span>'
      }).join('')
      var vec = flags.map(function (fl) { return t[fl[0]] === true ? '1' : '0' }).join('')
      return '<div class="ts-vec" data-strategy="' + esc(r.protocol) + '"><span class="proto">' + esc(r.protocol) + '</span>' + cells +
        '<span class="vec" data-vec="' + vec + '">' + vec + '</span></div>'
    }).join('')
    box.innerHTML = head + body

    if (veBox) {
      var head = rows.find(function (r) { return r.protocol === 'HeadBasedSampler' })
      var tail = rows.find(function (r) { return r.protocol === 'TailBasedSampler' })
      var adaptive = rows.find(function (r) { return r.protocol === 'AdaptiveSampler' })
      var sm = crosscheck && crosscheck.soundness
      veBox.innerHTML = [
        '<div class="ts-rb-row" data-rb="anomalyRequiresBufferingCausallyUnerasable"><b>HeadBasedSampler</b> 真跑 errorBurst → errorLost=' +
          esc(String(head ? head.metrics.errorTracesLost : 0)) + ' · peakBuf=0（零缓冲头部决策必盲丢 error；唯一 rate=1.0 全留是「放弃采样」退化态，正常 trace 也全留，不构成选择性保异常）</div>',
        '<div class="ts-rb-row" data-rb="headBlindnessCausallyUnerasable"><b>结构判据</b> decisionInvariant=' +
          (verdict && verdict.decisionInvariant ? 'true' : 'false') +
          '（翻转 hasError 标签的平行流真跑两遍、逐 id 决策恒同 ⇒ 决策只吃哈希不读 error，零统计噪声、与样本量无关；maxBlindnessGap 仅抽样偏差展示不当锁判据）</div>',
        '<div class="ts-rb-row" data-rb="adaptiveLagCannotGuaranteeAnomalyCausallyUnerasable"><b>AdaptiveSampler</b> 真跑 errorBurst → rateChanges=' +
          esc(String(adaptive ? adaptive.metrics.rateChanges : 0)) + ' · errorLost=' + esc(String(adaptive ? adaptive.metrics.errorTracesLost : 0)) +
          '（完美反馈也只降丢失质量、maxRate 封顶救不到零；反馈基于已过窗口，突发当前窗口必丢 error trace）</div>',
      ].join('') +
        (sm ? '<div class="ts-rb-row" data-rb="holds">verifySamplingSoundness holds=' + (sm.holds ? 'true' : 'false') +
          ' · baselineHolds=' + (sm.baselineHolds ? 'true' : 'false') +
          ' · <span data-rb="nontrivial">nontrivial=' + (sm.nontrivial ? 'true' : 'false') + '</span>' +
          ' · <span data-rb="falsifiable">falsifiable=' + (sm.falsifiable ? 'true' : 'false') + '</span>' +
          ' · laneA{in=' + esc(String(sm.laneA && sm.laneA.baselineSpansIn)) + ' kept=' + esc(String(sm.laneA && sm.laneA.baselineSpansKept)) + '} laneB{errRet=' + esc(String(sm.laneB && sm.laneB.errorTracesRetained)) + '/' + esc(String(sm.laneB && sm.laneB.errorTracesTotal)) + '}</div>' +
          '<div class="ts-rb-row" data-rb-tamper="forgedErrorSpan">篡改① 漏判哈希最大 error span ⇒ 该 trace 被哈希丢 ⇒ errorAllRetained 现算翻 false</div>' +
          '<div class="ts-rb-row" data-rb-tamper="duplicateRelease">篡改② 真重复释放一条 kept trace ⇒ noDuplicateSpans 现算翻 false</div>' +
          '<div class="ts-rb-row" data-rb-tamper="emptyTraceSet">篡改③ 空 traces ⇒ nontrivial 与 normalByRate 现算翻 false（绝不 0=0 假绿）</div>' : '')
    }

    if (cxBox) {
      var ev = crosscheck && crosscheck.evidence
      var sm = crosscheck && crosscheck.soundness
      if (ev) {
        cxBox.innerHTML =
          '<div>真 <b>compareRemapping</b> 迁移率 一致性 ' + esc(String((ev.remapConsistentRate ?? 0).toFixed(4))) + ' vs 取模 ' + esc(String((ev.remapModuloRate ?? 0).toFixed(4))) + '</div>' +
          '<div>真 <b>createShardRouter.remapOn</b> 迁移 ' + esc(fmt(ev.routerMoved)) + ' 片</div>' +
          '<div>真 <b>createHashRing</b> ' + esc(fmt(ev.ringNodes)) + ' 节点 / 命中 ' + esc(fmt(ev.ringShardsUsed)) + '</div>' +
          '<div>真 <b>createWal</b> lines ' + esc(fmt(ev.walLines)) + ' / restore+replay <b>' + esc(fmt(ev.walReplayed)) + '</b></div>' +
          '<div>真 <b>createBus</b> trace.done 通知 ' + esc(fmt(ev.notices)) + ' 条 · listenerCount ' + esc(fmt(ev.busListeners)) + '</div>' +
          '<div>真 <b>createRedisCache</b> 聚合槽 set+get 命中 ' + esc(fmt(ev.redisBitmapHits)) + ' · entries ' + esc(fmt(ev.redisSlots)) + '</div>' +
          '<div>真 <b>createObjectPool</b> 新建 ' + esc(fmt(ev.poolCreated)) + ' / 复用 ' + esc(fmt(ev.poolReused)) + '</div>' +
          '<div>真 <b>createTokenBucket</b> 回放允许 <b>' + esc(fmt(ev.bucketAllowed)) + '</b> / 拒 ' + esc(fmt(ev.bucketRejected)) + '</div>' +
          '<div>真 <b>createMinHeapDelayQueue</b> 出队 ' + esc(fmt(ev.heapFired)) + ' 条 · pending ' + esc(fmt(ev.heapPending)) + '</div>' +
          '<div>真 <b>createPackedCounters</b> Σ=' + esc(fmt(ev.counterSum)) + ' · falseSharingPairs=' + esc(fmt(ev.counterFalseSharing)) + '</div>' +
          '<div>真 <b>createFullJitterBackoff</b> jitterSpread=' + esc(fmt(ev.jitterSpread)) + '（64 样本全抖动）</div>' +
          (sm ? '<div>真 <b>verifySamplingSoundness</b> holds=<b>' + (sm.holds ? 'true' : 'false') + '</b> baselineHolds=<b>' + (sm.baselineHolds ? 'true' : 'false') + '</b> nontrivial=<b>' + (sm.nontrivial ? 'true' : 'false') + '</b> · laneA{in=' + esc(String(sm.laneA && sm.laneA.baselineSpansIn)) + '} laneB{errRet=' + esc(String(sm.laneB && sm.laneB.errorTracesRetained)) + '/' + esc(String(sm.laneB && sm.laneB.errorTracesTotal)) + '} · 3 篡改真喂回同一内核现算翻 false</div>' : '')
      } else {
        cxBox.innerHTML = '<div class="nodata">真件交叉印证缺失</div>'
      }
    }

    var v = verdict || {}
    var noWin = v.noUniversalWinner === true
    var allHold = v.causalLocksAllHold === true
    var collapsed = v.riggedConvergenceCollapsed === true
    var chips = [
      '<span class="chip" data-verdict="anomalyRequiresBufferingCausallyUnerasable"><b>锁①</b> 保异常必缓冲整条 ⇔ 非低开销 ' + (v.anomalyRequiresBufferingCausallyUnerasable ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="headBlindnessCausallyUnerasable"><b>锁②</b> 头部盲：翻转 error 标签逐 id 决策恒同 ' + (v.headBlindnessCausallyUnerasable ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="adaptiveLagCannotGuaranteeAnomalyCausallyUnerasable"><b>锁③</b> 自适应滞后：完美反馈救不到零丢失 ' + (v.adaptiveLagCannotGuaranteeAnomalyCausallyUnerasable ? '✓' : '✗') + '</span>',
      '<span class="chip ' + (allHold ? 'jade-t' : 'muted-t') + '" data-verdict="causalLocksAllHold">' + (allHold ? '✓ 三因果锁全钉死（同一含 error raw 流真跑现算、任何 rigged 开关都救不了）' : '因果锁未全Hold') + '</span>',
      '<span class="chip" data-verdict="decisionInvariant"><b>结构判据</b> 翻转标签逐 id 决策恒同 ' + (v.decisionInvariant ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="tailGuaranteesAnomaly"><b>Tail</b> 确定性 100% 留 error ' + (v.tailGuaranteesAnomaly ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="adaptiveTracksLoad"><b>Adaptive</b> 突发真调率 ' + (v.adaptiveTracksLoad ? '✓' : '✗') + '</span>',
      '<span class="chip ' + (collapsed ? 'jade-t' : 'muted-t') + '" data-verdict="riggedConvergenceCollapsed"><b>诚实标定</b> rigged ⇒ Head≡Tail=110 区分度塌缩 ' + (collapsed ? '✓' : '·') + '</span>',
      '<span class="chip ' + (noWin ? 'jade-t' : 'muted-t') + '" data-verdict="noUniversalWinner">' + (noWin ? '✓ 三向量互异（100/010/101）、无一 111、不封赢家' : '默认态塌陷') + '</span>',
    ]
    var probes = $('#ts-probes')
    if (probes) probes.innerHTML = chips.join('')
    if (note) note.textContent = '维序固定 [lowOverhead / anomalyCapture / loadAdaptive]，三位全部真跑现算、不查协议名表：' +
      'HeadBased=100（root 即 O(1) 哈希决策、零 span 缓冲 ⇒ lowOverhead✓；率固定不反馈 ⇒ loadAdaptive✗；决策早于 error 发生故盲丢异常 trace ⇒ anomalyCapture✗）；' +
      'TailBased=010（缓冲整条 trace 至结束、按 error/延迟整体决策、确定性 100% 留 error ⇒ anomalyCapture✓；缓冲吃开销 ⇒ lowOverhead✗；率固定 ⇒ loadAdaptive✗）；' +
      'Adaptive=101（仍头部 O(1) 决策、零缓冲 ⇒ lowOverhead✓；滑动窗口反馈环动态调率 ⇒ loadAdaptive✓；maxRate=0.75 封顶仍补不上单条 anomaly 维 ⇒ anomalyCapture✗）。' +
      '硬结构：anomalyCapture ⇔ 缓冲整条 ⇔ 非 lowOverhead——要确定性留异常必须看完 trace，必牺牲低开销，与 Spring Batch 的 chk 权衡同构，零写死。' +
      '为什么不用 traceCompleteness 维：trace-level 采样三策略在「被保留 trace 的 span 完整性」上天然全真（都是整条决策、无半采断链），该维恒真会退化无区分度，故按可真跑现算的区分度改本维序（同 KI-531 改维序的诚实修正）。' +
      'verifySamplingSoundness 双路自证：路 A 干净流真跑验缓冲守恒（spansIn=spansKept+spansDropped）+ span 无重复，路 B 含 error 流用「ground-truth error 全留 / span 无重复 / span 完整无断链 / 正常 trace 按率筛」四观测量判定；三路篡改真喂回同一内核现算翻 false，带 baselineHolds 先真绿。' +
      '三条因果结构锁在同一含 error raw 流真跑钉死：异常需缓冲 / 头部盲（翻转标签逐 id 决策恒同，零统计噪声）/ 自适应滞后。' +
      'rigged 三开关 oracleHead（头部预知，只给 HeadBased 补 anomaly）/ infiniteBuffer（缓冲免费，只给 TailBased 补 lowOverhead）/ perfectFeedback（负载预测完美，只降 Adaptive errorBurst 丢失质量、maxRate 封顶仍补不上 anomaly）是分策略反事实探针，全开 ⇒ Head≡Tail=110 区分度诚实塌缩（riggedConvergenceCollapsed=true，教学结论：给头部采样单条预知 ⇔ 给尾部采样免费缓冲，二者殊途同归到「既省又全」却仍拿不到负载自适应），noStrategyWinsAll 仍真绝不硬造 111，三因果锁仍 allHold。'
  }

  /* ================= KI-527 布隆/布谷鸟/计数布隆三过滤器 · 第二十一维（blf 族） ================= */

  function renderBloomFilter(blf) {
    renderBlfMatrix(blf && blf.rows, blf && blf.config)
    renderBlfLadder(blf && blf.rows)
    renderBlfTrilemma(blf && blf.rows, blf && blf.verdict, blf && blf.crosscheck)
  }

  function blfMissing(list, note, label) {
    if (list) list.innerHTML = '<div class="nodata">' + esc(label) + ' 暂缺</div>'
    if (note) note.textContent = 'systems.bloomFilter 缺失 — 跑一次 npm run console:data 即可补齐'
  }

  function blfState(s) {
    if (!s) return { cls: '', ch: '·' }
    // 六场景正交：核心件已在每格算好三布尔，只在「该场景负责的维度」判定，其余维空真——与 trilemma 同源，绝不拿阈值重算。
    // 只在某维 ===false（即本格真暴露该软肋）时落软肋字；三策略软肋各不相同：CB 空间肥 / Cuckoo 高装载崖壁拒插 / Bloom 不支持删除。
    if (s.compactFootprint === false) return { cls: 'bloat', ch: '肥' }
    if (s.insertsNeverFail === false) return { cls: 'wall', ch: '崖' }
    if (s.deleteSupport === false) return { cls: 'nodel', ch: '缺删' }
    return { cls: 'ok', ch: '✓' }
  }

  function renderBlfMatrix(rows, config) {
    var box = $('#blf-matrix'), note = $('#blf-matrix-note')
    if (!Array.isArray(rows) || !rows.length || !config || !Array.isArray(config.scenarios)) {
      blfMissing(box, note, 'blf 矩阵'); return
    }
    var scenarios = config.scenarios
    var head = '<div class="blf-mat-row blf-mat-head"><span class="blf-mat-proto">策略</span>' +
      scenarios.map(function (sc) { return '<span class="blf-sc">' + esc(sc) + '</span>' }).join('') +
      '<span class="blf-mat-cost">占/崖/删</span></div>'
    var body = rows.map(function (row) {
      var cells = scenarios.map(function (sc) {
        var cell = Array.isArray(row.scenarios) ? row.scenarios.find(function (x) { return x.id === sc }) : null
        var st = blfState(cell)
        return '<span class="blf-cell ' + st.cls + '" data-strategy="' + esc(row.protocol) + '" data-s="' + esc(sc) +
          '" data-state="' + (st.cls || 'na') + '">' + st.ch + '</span>'
      }).join('')
      var m = row.metrics || {}
      return '<div class="blf-mat-row" data-strategy="' + esc(row.protocol) + '">' +
        '<span class="blf-mat-proto">' + esc(row.protocol) + '</span>' +
        cells + '<span class="blf-mat-cost"><b>' + esc(fmt(m.bitsPerKey)) + '</b>/' + esc(fmt(m.totalFpRate)) + '/' + esc(fmt(m.stashFailures)) + '</span></div>'
    }).join('')
    box.innerHTML = head + body
    if (note) note.textContent = 'Bloom / CountingBloom / Cuckoo × 六场景：steadyFilter（稳态 FP 率）/ hotKeyFlood（热键洪泛·插入不失败）/ deleteCycle（删除-重插·删除支持）/ highLoadSaturation（高装载崖壁·布谷鸟拒插）/ burstScale（规模放大 FP 量程）/ overAdmitted（超额准入压满真值）。' +
      '每格只认真件算好的三布尔，与三难同源——标「肥」=空间非最优（CB 是 Bloom 3.2× 位数）、「崖」=高装载 kick 链枯竭真拒插（Cuckoo@~80%+）、「缺删」=不支持删除（Bloom）；CB/Cuckoo 可删，该维不落软肋字。' +
      'totalFpRate 来自实测过滤器（负键专探），绝不拿 epsilon 解析式刷屏。维序：compactFootprint / insertsNeverFail / deleteSupport。' +
      '全为确定性教学状态机，结构计数，不声称真 RocksDB Bloom / 真 RedisBloom / 真 CuckooFilter 工程实现 / 真论文严格值。'
  }

  function renderBlfLadder(rows) {
    var box = $('#blf-ladder')
    if (!box || !Array.isArray(rows) || !rows.length) { if (box) box.innerHTML = ''; return }
    var max = Math.max.apply(null, rows.map(function (r) { return r.metrics && isNum(r.metrics.totalFpRate) ? r.metrics.totalFpRate : 0 }).concat([0.0001]))
    box.innerHTML = rows.map(function (r) {
      var m = r.metrics || {}
      var w = isNum(m.totalFpRate) ? Math.min(100, Math.round(m.totalFpRate / max * 100)) : 0
      return '<div class="blf-line" data-strategy="' + esc(r.protocol) + '"><span class="tag">' + esc(r.protocol) + '</span>' +
        '<span class="blf-bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="num">占 ' + esc(fmt(m.bitsPerKey)) + 'b/k · FP ' + esc(fmt(m.totalFpRate)) + ' · 拒插 ' + esc(fmt(m.totalInsertFailures)) + ' · 崖 ' + esc(fmt(m.totalStashFailures)) + '</span></div>'
    }).join('')
  }

  function renderBlfTrilemma(rows, verdict, crosscheck) {
    var box = $('#blf-trilemma'), cxBox = $('#blf-crosscheck'), note = $('#blf-trilemma-note'), veBox = $('#blf-verif')
    if (!Array.isArray(rows) || !rows.length) {
      blfMissing(box, note, 'blf 判词'); if (cxBox) cxBox.innerHTML = ''; if (veBox) veBox.innerHTML = ''; return
    }
    var flags = [['compactFootprint', '空间紧凑'], ['insertsNeverFail', '崖不到崖壁'], ['deleteSupport', '可删']]
    var head = '<div class="blf-vec blf-vec-head"><span class="proto">策略</span>' +
      flags.map(function (fl) { return '<span>' + fl[1] + '</span>' }).join('') + '<span class="vec">向量</span></div>'
    var body = rows.map(function (r) {
      var t = r.trilemma || {}
      var cells = flags.map(function (fl) {
        var yes = t[fl[0]] === true
        return '<span class="blf-flag ' + (yes ? 'yes' : 'no') + '" data-strategy="' + esc(r.protocol) + '" data-k="' + fl[0] +
          '" data-v="' + (yes ? '1' : '0') + '">' + (yes ? '✓' : '✗') + '</span>'
      }).join('')
      var vec = flags.map(function (fl) { return t[fl[0]] === true ? '1' : '0' }).join('')
      return '<div class="blf-vec" data-strategy="' + esc(r.protocol) + '"><span class="proto">' + esc(r.protocol) + '</span>' + cells +
        '<span class="vec" data-vec="' + vec + '">' + vec + '</span></div>'
    }).join('')
    box.innerHTML = head + body

    // 验证栏：FP ceiling 理论 vs 实测双路自证 + 三路篡改真喂回 + 崖壁真实读数 + 删除循环真读数
    if (veBox) {
      var rowBloom = rows.find(function (r) { return r.protocol === 'Bloom' })
      var rowCBloom = rows.find(function (r) { return r.protocol === 'CountingBloom' })
      var rowCuckoo = rows.find(function (r) { return r.protocol === 'Cuckoo' })
      var fc = crosscheck && crosscheck.fpCeiling
      var rb = []
      rb.push('<div class="blf-rb-row"><b>FP ceiling 双路</b> 理论 ε=(1-e^(-kn/m))^k = ' + esc(fmt(fc ? fc.theory : 0)) +
        ' vs 实测 FP-total ' + esc(fmt(rowBloom ? rowBloom.metrics.totalFpRate : 0)) + ' / 副样本 ' + esc(fmt(fc ? fc.measured : 0)) +
        ' · 邻域 [' + esc(fmt(fc ? fc.lower : 0)) + ', ' + esc(fmt(fc ? fc.tolerated : 0)) + '] — 不自称优于理论，只求覆盖 FP ceiling、成立即 holds、可证伪翻 false</div>')
      rb.push('<div class="blf-rb-row">' +
        '<span class="blf-flag ' + (fc && fc.holds ? 'yes' : 'no') + '" data-rb="holds">holds ' + (fc && fc.holds ? '✓' : '✗') + '</span>' +
        '<span class="blf-flag ' + (fc && fc.nontrivial ? 'yes' : 'no') + '" data-rb="nontrivial">nontrivial ' + (fc && fc.nontrivial ? '✓' : '✗') + '</span>' +
        '<span class="blf-flag ' + (fc && fc.falsifiable ? 'yes' : 'no') + '" data-rb="falsifiable">falsifiable ' + (fc && fc.falsifiable ? '✓' : '✗') + '</span>' +
        '<span class="blf-flag ' + ((rowBloom && rowBloom.trilemma.compactFootprint) ? 'yes' : 'no') + '" data-rb="bloomSpace">Bloom ' + ((rowBloom && rowBloom.trilemma.compactFootprint) ? '✓' : '✗') + ' 空间：h[bits/key] = ' + esc(fmt(rowBloom ? rowBloom.metrics.bitsPerKey : 0)) + '</span>' +
        '<span class="blf-flag ' + ((rowCBloom && !rowCBloom.trilemma.compactFootprint) ? 'yes' : 'no') + '" data-rb="cbSpace">CB ' + ((rowCBloom && !rowCBloom.trilemma.compactFootprint) ? '✓' : '✗') + ' 多花：h[bits/key] = ' + esc(fmt(rowCBloom ? rowCBloom.metrics.bitsPerKey : 0)) + '（≈ Bloom 3.2×）</span>' +
        '<span class="blf-flag ' + ((rowCuckoo && rowCuckoo.metrics.totalStashFailures > 0) ? 'yes' : 'no') + '" data-rb="cuckooWall">Cuckoo ' + ((rowCuckoo && rowCuckoo.metrics.totalStashFailures > 0) ? '✓' : '✗') + ' 崖壁 ' + esc(fmt(rowCuckoo ? rowCuckoo.metrics.totalStashFailures : 0)) + ' 次拒插</span></div>')
      if (fc && fc.tamper) {
        rb.push('<div class="blf-rb-row">三路篡改真喂回同一判定内核现算翻 false：' +
          '<span class="blf-flag ' + (!fc.tamper.trustConfig.holds ? 'yes' : 'no') + '" data-rb-tamper="trustConfig">篡改bits ' + (!fc.tamper.trustConfig.holds ? '✓驳倒' : '✗') + '</span>' +
          '<span class="blf-flag ' + (!fc.tamper.zeroFpr.holds ? 'yes' : 'no') + '" data-rb-tamper="zeroFpr">零误判 ' + (!fc.tamper.zeroFpr.holds ? '✓驳倒' : '✗') + '</span>' +
          '<span class="blf-flag ' + (!fc.tamper.skipProbe.holds ? 'yes' : 'no') + '" data-rb-tamper="skipProbe">绕probes ' + (!fc.tamper.skipProbe.holds ? '✓驳倒' : '✗') + '</span></div>')
      }
      veBox.innerHTML = rb.join('')
    }

    if (cxBox) {
      var ev = crosscheck && crosscheck.evidence
      if (ev) {
        cxBox.innerHTML =
          '<div>真 <b>compareRemapping</b> 一致性迁移率 ' + esc(fmt(ev.remapConsistentRate)) + ' vs 取模 ' + esc(fmt(ev.remapModuloRate)) + '</div>' +
          '<div>真 <b>createShardRouter.remapOn</b> 迁移 ' + esc(fmt(ev.routerMoved)) + ' 片 · 跟踪 ' + esc(fmt(ev.routerTracked)) + ' key</div>' +
          '<div>真 <b>createHashRing</b> ' + esc(fmt(ev.ringNodes)) + ' 节点 · 落片 ' + esc(fmt(ev.ringShardsUsed)) + ' 片</div>' +
          '<div>真 <b>createWal</b> append lines ' + esc(fmt(ev.walLines)) + ' / restore+replay <b>' + esc(fmt(ev.walReplayed)) + '</b></div>' +
          '<div>真 <b>createBus</b> filter.added 通知 ' + esc(fmt(ev.notices)) + ' 条 · listenerCount ' + esc(fmt(ev.busListeners)) + '</div>' +
          '<div>真 <b>createRedisCache</b> bitmap 命中 ' + esc(fmt(ev.redisBitmapHits)) + ' / 占槽 ' + esc(fmt(ev.redisSlots)) + '（压 Bloom位图）</div>' +
          '<div>真 <b>createObjectPool</b> 新建 ' + esc(fmt(ev.poolCreated)) + ' · 复用 ' + esc(fmt(ev.poolReused)) + '</div>' +
          '<div>真 <b>createTokenBucket</b> 回放允许 <b>' + esc(fmt(ev.bucketAllowed)) + '</b> / 拒 ' + esc(fmt(ev.bucketRejected)) + '</div>' +
          '<div>真 <b>createMinHeapDelayQueue</b> rebuild 出队 ' + esc(fmt(ev.heapFired)) + ' 条 · 待 ' + esc(fmt(ev.heapPending)) + '</div>' +
          '<div>真 <b>createPackedCounters</b> Σ=' + esc(fmt(ev.counterSum)) + ' · 假共享对 ' + esc(fmt(ev.counterFalseSharing)) + '</div>' +
          '<div>真 <b>createFullJitterBackoff</b> jitterSpread 抖开 <b>' + esc(fmt(ev.jitterSpread)) + '</b></div>'
      } else {
        cxBox.innerHTML = '<div class="nodata">真件交叉印证缺失</div>'
      }
    }

    var v = verdict || {}
    var noWin = v.noUniversalWinner === true
    var causal = v.compactFootprintCausallyUnerasable === true
    var fpOk = v.fpCeilingHolds === true
    var chips = [
      '<span class="chip" data-verdict="bloomDeleteFree"><b>Bloom</b> 不删 ' + (v.bloomDeleteFree ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="countingBloomSpacePays"><b>CountingBloom</b> 空间多花 ' + (v.countingBloomSpacePays ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="cuckooStashWall"><b>Cuckoo</b> 高装载崖壁真 ' + (v.cuckooStashWall ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="countingBloomDeleteSupport"><b>CB</b> 可删 ' + (v.countingBloomDeleteSupport ? '✓' : '✗') + '</span>',
      '<span class="chip" data-verdict="cuckooDeleteSupport"><b>Cuckoo</b> 可删 ' + (v.cuckooDeleteSupport ? '✓' : '✗') + '</span>',
      '<span class="chip ' + (noWin ? 'jade-t' : 'muted-t') + '" data-verdict="noUniversalWinner">' + (noWin ? '✓ 三向量 110/011/101 互异、无一 111：Bloom 缺删 / CB 空间多花 / Cuckoo 撞崖壁，各恰好缺一维，没有通吃者' : '判词随 rigged 收敛为 011/011/011、不封赢家') + '</span>',
      '<span class="chip ' + (causal ? 'jade-t' : 'muted-t') + '" data-verdict="compactFootprintCausallyUnerasable">' + (causal ? '✓ 空间紧凑维因果抹不掉：无限空间反让三策略全不紧凑' : '默认态未锁死，rigged 才现形') + '</span>',
      '<span class="chip ' + (fpOk ? 'jade-t' : 'muted-t') + '" data-verdict="fpCeilingHolds">' + (fpOk ? '✓ FP 理论上界 vs 真否定集实测双路自证成立' : 'FP ceiling 双路未成立') + '</span>',
    ]
    var probes = $('#blf-probes')
    if (probes) probes.innerHTML = chips.join('')
    if (note) note.textContent = '维序固定 [紧凑 / 守崖壁 / 可删]。默认向量 Bloom=110 / CountingBloom=011 / Cuckoo=101，三者互异、无一 111、恰好各缺一维：Bloom 缺删除、CB 计数吃空间、Cuckoo 高装载撞 kick 崖壁。' +
      '三口径正交：compactFootprint 只看 bits/key 预算、insertsNeverFail 只跨 hotKeyFlood/highLoadSaturation 场景量（含崖壁强压）、deleteSupport 只在 deleteCycle 量；非考场维空真不连坐。' +
      'rigged 三开关 unlimitedRoom+eternalStasis+noDeletesNeeded ⇒ unlimitedRoom 真把 bits/key 放大到 80/256/128，三策略 compactFootprint 全翻 false、向量收敛 011/011/011，compactFootprintCausallyUnerasable=true 证空间紧凑这一维因果抹不掉，绝不硬造全 111。' +
      'verifyFalsePositiveCeiling 双路自证（理论上界 ε vs 真否定集实测）+ 三路篡改 bits/零误判/绕 probes 真喂回现算翻 false、空集 nontrivial=false 不凭 0=0 假绿。全结构计数，不声称真 RocksDB Bloom / 真 RedisBloom / 真 CuckooFilter 工程实现。'
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
