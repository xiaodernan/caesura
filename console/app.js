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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
