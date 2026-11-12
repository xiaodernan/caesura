import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

/**
 * 无浏览器环境下的前端渲染烟测：用一只极简 DOM stub 跑真 app.js 对真 bootstrap 快照，
 * 证明①所有渲染路径不抛②真读数确实落进 DOM③缺字段诚实降级。
 * 这不是像素级截图，而是「app.js 读真快照 → 每块面板都被填」的可断言证据。
 */
const ROOT = resolve(process.cwd(), 'console')

/** 从 index.html 里抽出所有 id，造出对应的 FakeEl。 */
function idsFromHtml(): string[] {
  const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
  return [...new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]))]
}

interface FakeEl {
  id: string
  _html: string
  _text: string
  className: string
  attrs: Record<string, string>
  style: Record<string, string>
  innerHTML: string
  textContent: string
  setAttribute(k: string, v: string): void
  getAttribute(k: string): string | undefined
  insertAdjacentHTML(pos: string, html: string): void
  querySelector(s: string): FakeEl | null
}

/** app.js 里 loadSnapshot 用到的最小 XHR 表面；file: 回退下不会真发请求。 */
interface FakeXhr {
  open(method: string, url: string, async: boolean): void
  send(): void
  timeout: number
  responseText: string
  readyState: number
  status: number
  onerror: (() => void) | null
  ontimeout: (() => void) | null
  onreadystatechange: (() => void) | null
}

function makeEl(id: string): FakeEl {
  const el: FakeEl = {
    id, _html: '', _text: '', className: '', attrs: {}, style: {},
    get innerHTML() { return this._html },
    set innerHTML(v: string) { this._html = String(v) },
    get textContent() { return this._text },
    set textContent(v: string) { this._text = String(v) },
    setAttribute(k, v) { this.attrs[k] = v },
    getAttribute(k) { return this.attrs[k] },
    insertAdjacentHTML(_pos, html) { this._html += html },
    querySelector() { return null },
  }
  return el
}

/** 造一份 DOM stub，返回按 id 索引的元素表与 app.js 需要的最小全局。 */
function makeDom(snapshot: any) {
  const els: Record<string, FakeEl> = {}
  idsFromHtml().forEach((id) => { els[id] = makeEl(id) })
  // 大数元素带 data-num / data-pct（app.js 靠它定位），单独造 6 只。
  const numEls: FakeEl[] = ['services', 'spanCount', 'canaryHits', 'cacheHitRate', 'cwnd', 'timedOut'].map((k) => {
    const e = makeEl('num-' + k)
    e.attrs['data-num'] = k
    if (k === 'cacheHitRate') e.attrs['data-pct'] = '1'
    return e
  })
  // 条形填充元素：app.js 在 #resilience.innerHTML 里写它们，再用 querySelectorAll 取；stub 里让它从 innerHTML 抽 data-w。
  const document = {
    readyState: 'complete',
    querySelector(sel: string): FakeEl | null {
      if (sel[0] === '#') return els[sel.slice(1)] ?? null
      if (sel === '[data-num]') return numEls[0] ?? null
      // 面板内的 .legend / .panel-topo .legend 用不到精确返回，给个万能空元素。
      return makeEl('anon')
    },
    querySelectorAll(sel: string): FakeEl[] {
      if (sel === '[data-num]') return numEls
      if (sel.indexOf('bar-fill') >= 0) {
        const html = els['resilience']?._html ?? ''
        return [...html.matchAll(/data-w="(\d+)"/g)].map((m) => {
          const e = makeEl('bar')
          e.attrs['data-w'] = m[1]
          return e
        })
      }
      return []
    },
    addEventListener() {},
    createElement() { return makeEl('created') },
  }
  let raf = 0
  let fakeNow = 0
  const win = {
    document,
    window: null as any,
    location: { protocol: 'file:' }, // 走 bootstrap 回退，免得发 XHR
    XMLHttpRequest: function (this: FakeXhr) {
      this.open = () => {}
      this.timeout = 0
      this.responseText = ''
      this.send = () => { if (this.onerror) this.onerror() }
      this.onerror = null
      this.ontimeout = null
      this.onreadystatechange = null
      this.readyState = 0
      this.status = 0
    },
    __BOOTSTRAP_SNAPSHOT__: snapshot,
    // 有界、递增时间戳推进 count-up（真实 rAF 也是递增 ts，末帧 t≥1100 时到目标）。
    requestAnimationFrame(fn: Function) { if (raf++ < 300) { fakeNow += 120; fn(fakeNow) } },
    console,
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    isFinite,
    JSON,
  }
  win.window = win
  return { els, numEls, win, document }
}

async function runApp(snapshot: any) {
  const dom = makeDom(snapshot)
  const code = readFileSync(resolve(ROOT, 'app.js'), 'utf8')
  runInNewContext(code, dom.win as any, { filename: 'app.js' })
  // loadSnapshot().then(...) 里的渲染在微任务里跑；等它连同 rAF 回调一起冲完再断言。
  for (let i = 0; i < 5; i++) await Promise.resolve()
  return dom
}

describe('caesura-console-ui (KI-495)', () => {
  const real = JSON.parse(readFileSync(resolve(ROOT, 'snapshot.json'), 'utf8'))

  it('① 真快照跑通全部渲染路径：每块面板都被填、无异常', async () => {
    const dom = await runApp(real)
    expect(dom.els['topo'].innerHTML).toContain('<svg') // 拓扑
    expect(dom.els['topo'].innerHTML).toContain('caesura-game')
    expect(dom.els['events'].innerHTML).toContain('game.started') // 事件流
    expect(dom.els['events'].innerHTML).toContain('game.stopped')
    expect(dom.els['resilience'].innerHTML).toContain('TimeLimiter') // 韧性条
    expect(dom.els['gray-split'].innerHTML).toContain('金丝雀') // 灰度分池
    expect(dom.els['gray-probes'].innerHTML).toContain('canary') // 探针
    expect(dom.els['cache-ring'].innerHTML).toContain('<svg') // 缓存环
    expect(dom.els['cache-kv'].innerHTML).toContain('cacheHit')
    expect(dom.els['cwnd-svg'].innerHTML).toContain('class="line') // cwnd 曲线
    expect(dom.els['netstats'].innerHTML).toContain('ssthresh') // 计网读数
    expect(dom.els['cwnd-svg'].innerHTML).toContain('marker timeout') // 锯齿上的超时标记
  })

  it('② 真读数落进顶栏与页脚（数据源/时间/采集范围诚实）', async () => {
    const dom = await runApp(real)
    expect(dom.els['live-text'].textContent).toContain('真值已载入')
    expect(dom.els['src-badge'].textContent).toContain('BOOTSTRAP')
    expect(dom.els['provenance'].textContent).toContain('真跑 5 趟')
    expect(dom.els['provenance'].textContent).toContain('5/5 通过')
    expect(dom.els['generated-at'].textContent).not.toBe('—')
  })

  it('③ 大数不是写死的：来自 snapshots.highlights（含 cwnd 一位小数）', async () => {
    const dom = await runApp(real)
    const byKey = Object.fromEntries(dom.numEls.map((e) => [e.getAttribute('data-num'), e.textContent]))
    // count-up 在 stub 里被推进到末帧（raf 有界），应接近 target。
    expect(Number(byKey.services)).toBeCloseTo(real.highlights.services, 0)
    expect(Number(byKey.spanCount)).toBeCloseTo(real.highlights.spanCount, 0)
    expect(Number(byKey.canaryHits)).toBeCloseTo(real.highlights.canaryHits, 0)
    expect(Number(byKey.timedOut)).toBeCloseTo(real.highlights.timedOut, 0)
    expect(Number(byKey.cacheHitRate.replace('%', ''))).toBeCloseTo(real.highlights.cacheHitRate * 100, 0)
  })

  it('④ 缺字段诚实降级：空快照画出「无数据」而非假图/假数', async () => {
    const empty = { schema: 1, generatedAt: 0, generator: 'x', scenarios: [], highlights: {} }
    const dom = await runApp(empty)
    expect(dom.els['events'].innerHTML).toContain('无事件读数')
    expect(dom.els['gray-split'].innerHTML).toContain('无灰度读数')
    expect(dom.els['cache-ring'].innerHTML).toContain('—') // 环仍画，但命中率是破折号（不编 0%）
    expect(dom.els['cache-kv'].innerHTML).toContain('cacheHit')
    expect(dom.els['cwnd-svg'].innerHTML).not.toContain('class="line') // 没曲线时不画假线
    expect(dom.els['chart-axis'].innerHTML).toContain('无 cwnd')
    expect(dom.els['netstats'].innerHTML).toContain('—') // 缺值显示破折号
    dom.numEls.forEach((e) => expect(e.textContent).toBe('—'))
  })

  it('⑤ 部分缺字段：只降级缺的那块，其余照常渲染真值', async () => {
    const partial = JSON.parse(JSON.stringify(real))
    partial.scenarios = partial.scenarios.filter((s: any) => s.id !== 'gray') // 抽掉灰度
    const dom = await runApp(partial)
    expect(dom.els['gray-split'].innerHTML).toContain('无灰度读数') // 灰度降级
    expect(dom.els['topo'].innerHTML).toContain('caesura-game') // 主链照常
    expect(dom.els['events'].innerHTML).toContain('game.started')
    expect(dom.els['cwnd-svg'].innerHTML).toContain('class="line') // 曲线照常
  })

  it('⑥ 前端不引入任何外部依赖/CDN（零依赖可离线直开）', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
    const css = readFileSync(resolve(ROOT, 'styles.css'), 'utf8')
    const js = readFileSync(resolve(ROOT, 'app.js'), 'utf8')
    expect(html).not.toMatch(/https?:\/\//) // 无外链
    expect(html).not.toMatch(/<script[^>]+src=["']http/)
    expect(css).not.toMatch(/@import\s+url/) // 无远程字体
    // CSS 里唯一的 http 是 grain 内联 SVG 的 xmlns 命名空间（非网络请求）；排除它后不得有别的 URL。
    expect(css.replace(/xmlns='http:\/\/www\.w3\.org\/2000\/svg'/g, '')).not.toMatch(/https?:\/\//)
    expect(js).not.toMatch(/^\s*import\s/m) // app.js 无 import 语句
    // app.js 里唯一的 http 是 renderTopology 内联 SVG 的 xmlns 命名空间（非网络请求）。
    expect(js.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '')).not.toMatch(/https?:\/\//)
    // 本地资源都在
    expect(html).toContain('./styles.css')
    expect(html).toContain('<div class="aurora" aria-hidden="true">')
    expect(css).toContain('.aurora')
    expect(css).toContain('@keyframes aurora-breathe')
    expect(css).toContain('prefers-reduced-motion')
    expect(html).toContain('<div class="grain" aria-hidden="true">')
    expect(html).toContain('<div class="vignette" aria-hidden="true">')
    expect(css).toContain('.grain, .vignette { position: fixed')
    expect(html).toContain('<link rel="stylesheet" href="./styles.css" />')
  })

  it('⑦ bootstrap 与 snapshot 是同一份真数据（file:// 回退不编造第二套数）', () => {
    const bootCode = readFileSync(resolve(ROOT, 'bootstrap.js'), 'utf8')
    const ctx: any = { window: {} }
    runInNewContext(bootCode, ctx, { filename: 'bootstrap.js' })
    const fromBootstrap = ctx.window.__BOOTSTRAP_SNAPSHOT__
    expect(fromBootstrap).toBeTruthy()
    expect(fromBootstrap.schema).toBe(real.schema)
    expect(fromBootstrap.scenarios.map((s: any) => s.id)).toEqual(real.scenarios.map((s: any) => s.id))
    expect(fromBootstrap.highlights).toEqual(real.highlights)
    expect(fromBootstrap.scenarios.find((s: any) => s.id === 'net').series.length)
      .toBe(real.scenarios.find((s: any) => s.id === 'net').series.length)
  })

  it('⑧ KI-498 真 systems 读数落进 LSM / 硬件适配新面板（不是写死的数）', async () => {
    const dom = await runApp(real)
    const sys = real.systems
    // LSM：speedup 仪表、点查 vs 线性扫描比较数、六项算法计数、各层段数。
    expect(dom.els['lsm-gauge'].innerHTML).toContain(sys.lsm.speedup.toFixed(1)) // 39.0
    expect(dom.els['lsm-gauge'].innerHTML).toContain('点查')
    expect(dom.els['lsm-gauge'].innerHTML).toContain(String(sys.lsm.comparisons)) // 1377
    expect(dom.els['lsm-gauge'].innerHTML).toContain(String(sys.lsm.scanBaselineComparisons)) // 53760
    const kv = dom.els['lsm-kv'].innerHTML
    for (const label of ['flush 次数', 'compaction 次数', '归并掉旧版本', '丢弃 tombstone', 'Bloom 负查']) {
      expect(kv).toContain(label)
    }
    expect(kv).toContain(String(sys.lsm.flushes))
    expect(kv).toContain(String(sys.lsm.compactions))
    expect(kv).toContain(String(sys.lsm.tombstonesDropped))
    // 分层段数：真 levels 转成 L0 / L1 与段数条。
    const levels = dom.els['lsm-levels'].innerHTML
    sys.lsm.levels.forEach((lv: any) => expect(levels).toContain('L' + lv.level))
    expect(levels).toContain('段')
    expect(dom.els['lsm-note'].textContent).toContain('算法计数，非墙钟跑分')
    // HW：对象池省分配、padding 假共享 0 vs packed>0、AoS→SoA 布局对照。
    const grid = dom.els['hw-grid'].innerHTML
    expect(grid).toContain('对象池 · GC 分配')
    expect(grid).toContain('缓存行 · false sharing')
    expect(grid).toContain('AoS→SoA')
    expect(grid).toContain('省下分配')
    expect(grid).toContain(String(sys.hw.allocation.saved)) // 1999
    expect(grid).toContain('padded 假共享')
    expect(grid).toContain('packed 假共享')
    expect(grid).toContain('顺序 speedup')
    expect(grid).toContain(sys.hw.layout.sequential.speedup.toFixed(1) + '×') // 4.0×
    expect(dom.els['hw-note'].textContent).toContain('非墙钟跑分')
  })

  it('⑨ KI-498 systems 缺失诚实降级：整块缺不画假数、单维缺只降那维', async () => {
    // 整块缺：两个面板都降级，绝不用 0 或假 speedup 顶替。
    const noSystems = { schema: 1, generatedAt: 0, generator: 'x', scenarios: [], highlights: {}, systems: null }
    const dom = await runApp(noSystems)
    expect(dom.els['lsm-gauge'].innerHTML).toContain('—')
    expect(dom.els['lsm-gauge'].innerHTML).toContain('LSM 读数缺失')
    expect(dom.els['lsm-kv'].innerHTML).toBe('')
    expect(dom.els['lsm-levels'].innerHTML).toContain('无存储引擎读数')
    expect(dom.els['lsm-note'].textContent).toContain('systems.lsm 缺失')
    expect(dom.els['hw-grid'].innerHTML).toContain('无硬件适配读数')
    expect(dom.els['hw-note'].textContent).toContain('systems.hw 缺失')

    // 单维缺：只降 lsm，hw 仍照常渲染真读数（不连坐）。
    const partial = JSON.parse(JSON.stringify(real))
    partial.systems.lsm = null
    const dom2 = await runApp(partial)
    expect(dom2.els['lsm-gauge'].innerHTML).toContain('LSM 读数缺失')
    expect(dom2.els['hw-grid'].innerHTML).toContain('对象池 · GC 分配')
    expect(dom2.els['hw-grid'].innerHTML).toContain(String(real.systems.hw.allocation.saved))
  })

  it('⑩ KI-501 真 guards 读数落进击穿 / 穿透 / 雪崩三面板（不是写死的数）', async () => {
    const dom = await runApp(real)
    const g = real.systems.guards
    // 击穿：放大倍数、无防护 vs singleflight 回源次数、真条宽。
    const sh = dom.els['stampede-hero'].innerHTML
    expect(sh).toContain(String(g.stampede.amplification))
    expect(sh).toContain(String(g.stampede.singleflightLoads))
    const sb = dom.els['stampede-bars'].innerHTML
    expect(sb).toContain('无防护')
    expect(sb).toContain('singleflight')
    expect(sb).toContain(String(g.stampede.naiveLoads))
    expect(sb).toContain('width:100%') // 无防护那条铺满（max）
    expect(sb).toContain('width:')     // singleflight 那条按真比值
    expect(dom.els['stampede-note'].textContent).toContain('结构计数')
    // 穿透：布隆省下回源率、三路回源真数、假阳性如实标注。
    const ph = dom.els['penetration-hero'].innerHTML
    expect(ph).toContain(String(Math.round(g.penetration.bloomSavedRate * 100)))
    const pb = dom.els['penetration-bars'].innerHTML
    expect(pb).toContain('空值墓碑')
    expect(pb).toContain('布隆前置')
    expect(pb).toContain(String(g.penetration.naiveDbHits))
    expect(pb).toContain(String(g.penetration.bloomDbHits))
    expect(dom.els['penetration-note'].textContent).toContain(String(g.penetration.bloomFalsePositives))
    expect(dom.els['penetration-note'].textContent).toContain('不零误判')
    // 雪崩：削峰率、统一 TTL vs 抖动峰值、真 histogram 转条高。
    const ah = dom.els['avalanche-hero'].innerHTML
    expect(ah).toContain(String(Math.round(g.avalanche.peakReduction * 100)))
    expect(ah).toContain(String(g.avalanche.uniformPeak))
    expect(ah).toContain(String(g.avalanche.jitterPeak))
    const hist = dom.els['avalanche-hist'].innerHTML
    expect(hist).toContain('统一 TTL')
    expect(hist).toContain('TTL 抖动')
    expect(hist).toContain('hist-bars jitter') // 抖动那行用 jade 色
    expect((hist.match(/<i style="height:/g) || []).length)
      .toBe(g.avalanche.histogram.uniform.length + g.avalanche.histogram.jitter.length)
    expect(dom.els['avalanche-note'].textContent).toContain('不减少总过期数')
  })

  it('⑪ KI-501 guards 整块缺 / 单块缺诚实降级，不连坐 lsm-hw', async () => {
    // 整块缺：三面板各自降级，绝不用 0 或假条顶替；lsm/hw 仍照常。
    const noGuards = JSON.parse(JSON.stringify(real))
    noGuards.systems.guards = null
    const dom = await runApp(noGuards)
    expect(dom.els['stampede-hero'].innerHTML).toContain('击穿读数缺失')
    expect(dom.els['stampede-bars'].innerHTML).toContain('无击穿读数')
    expect(dom.els['penetration-bars'].innerHTML).toContain('无穿透读数')
    expect(dom.els['avalanche-hist'].innerHTML).toContain('无雪崩读数')
    expect(dom.els['avalanche-note'].textContent).toContain('systems.guards 缺失')
    expect(dom.els['lsm-gauge'].innerHTML).toContain(real.systems.lsm.speedup.toFixed(1)) // lsm 不连坐
    expect(dom.els['hw-grid'].innerHTML).toContain('对象池 · GC 分配')

    // 单块缺：只降击穿，穿透/雪崩仍渲染真读数（不连坐同维其它块）。
    const partial = JSON.parse(JSON.stringify(real))
    partial.systems.guards.stampede = null
    const dom2 = await runApp(partial)
    expect(dom2.els['stampede-hero'].innerHTML).toContain('击穿读数缺失')
    expect(dom2.els['penetration-hero'].innerHTML).toContain(String(Math.round(real.systems.guards.penetration.bloomSavedRate * 100)))
    expect(dom2.els['avalanche-hero'].innerHTML).toContain(String(real.systems.guards.avalanche.uniformPeak))
  })

  it('⑫ KI-502 真 rateLimit 读数落进五算法突发 + Redis 原子性两面板（不是写死的数）', async () => {
    const dom = await runApp(real)
    const rl = real.systems.rateLimit
    // 五算法：五条都在，固定窗口 2× 判酒红 warn，滑动 1× 判 safe；内联宽度静态可读。
    const algos = dom.els['rl-algos'].innerHTML
    for (const name of ['固定窗口', '滑动日志', '滑动计数', '令牌桶', '漏桶']) expect(algos).toContain(name)
    expect((algos.match(/class="rl-algo"/g) || []).length).toBe(5)
    expect(algos).toContain('fill warn')
    expect(algos).toContain('data-ratio="' + rl.strategies.fixedWindow.burstRatio + '"')
    expect(algos).toContain('fill safe')
    expect(algos).toContain('data-ratio="' + rl.strategies.slidingLog.burstRatio + '"')
    expect(dom.els['rl-algo-note'].textContent).toContain('自然分钟对齐')
    expect(dom.els['rl-algo-note'].textContent).toContain(String(rl.strategies.fixedWindow.maxInWindow))
    // Redis：超发大数、原子/非原子两路、跨实例共享一致 dot。
    const rd = dom.els['rl-redis'].innerHTML
    expect(rd).toContain(String(rl.redis.overshoot))
    expect(rd).toContain('原子 · Lua')
    expect(rd).toContain('非原子 · 竞态')
    expect(rd).toContain('fill atomic')
    expect(rd).toContain('fill raw')
    expect(rd).toContain(String(rl.redis.atomicAllowed))
    expect(rd).toContain(String(rl.redis.nonAtomicAllowed))
    expect(rd).toContain('dot ok') // 跨实例共享一致
    expect(dom.els['rl-redis-note'].textContent).toContain('等价 Lua 串行')
    expect(dom.els['rl-redis-note'].textContent).toContain('丢失更新')
  })

  it('⑬ KI-502 rateLimit 整块缺 / 单块缺诚实降级，不连坐 guards-lsm-hw', async () => {
    // 整块缺：两面板各自降级，绝不画 0/假条；guards/lsm/hw 仍照常。
    const noRl = JSON.parse(JSON.stringify(real))
    noRl.systems.rateLimit = null
    const dom = await runApp(noRl)
    expect(dom.els['rl-algos'].innerHTML).toContain('无限流算法读数')
    expect(dom.els['rl-redis'].innerHTML).toContain('无Redis 原子性读数')
    expect(dom.els['rl-algo-note'].textContent).toContain('systems.rateLimit 缺失')
    expect(dom.els['stampede-hero'].innerHTML).toContain('singleflight') // guards 不连坐
    expect(dom.els['lsm-gauge'].innerHTML).toContain(real.systems.lsm.speedup.toFixed(1)) // lsm 不连坐

    // 单块缺：只降 Redis，五算法仍渲染真读数（不连坐同维另一块）。
    const partial = JSON.parse(JSON.stringify(real))
    partial.systems.rateLimit.redis = null
    const dom2 = await runApp(partial)
    expect(dom2.els['rl-redis'].innerHTML).toContain('无Redis 原子性读数')
    expect(dom2.els['rl-algos'].innerHTML).toContain('固定窗口')
    expect(dom2.els['rl-algos'].innerHTML).toContain('data-ratio="' + real.systems.rateLimit.strategies.fixedWindow.burstRatio + '"')
    // 另一向：只降算法，Redis 仍渲染真读数。
    const partial2 = JSON.parse(JSON.stringify(real))
    partial2.systems.rateLimit.strategies = null
    const dom3 = await runApp(partial2)
    expect(dom3.els['rl-algos'].innerHTML).toContain('无限流算法读数')
    expect(dom3.els['rl-redis'].innerHTML).toContain(String(real.systems.rateLimit.redis.overshoot))
  })

  it('⑭ KI-503 真 failureDetector 读数落进「固定 vs φ」+「SWIM 三态」两面板（不是写死的数）', async () => {
    const fd = real.systems.failureDetector
    const dom = await runApp(real)
    // 面板一主读数：固定/φ 抖动误报大数 + 两侧真故障检出延迟。
    const hero = dom.els['fd-hero'].innerHTML
    expect(hero).toContain(String(fd.fixed.falsePositives))
    expect(hero).toContain(String(fd.phi.falsePositives))
    expect(hero).toContain(String(fd.fixed.detectionLatencyMs))
    expect(hero).toContain(String(fd.phi.detectionLatencyMs))
    expect(dom.els['fd-hero-note'].textContent).toContain('权衡') // 如实保留、不粉饰
    // φ 曲线：真 curve 逐点折线 + 阈值线 + 固定超时误报点（酒红圆点）。
    const curve = dom.els['fd-curve'].innerHTML
    expect(curve).toContain('<polyline')
    expect(curve).toContain('phi-line')
    expect(curve).toContain('thresh') // 判死阈值虚线
    expect(curve).toContain('φ=')
    expect(curve).toContain(String(fd.curve.length)) // 真点数
    expect((curve.match(/class="fp-dot"/g) || []).length).toBe(fd.curve.filter((p: any) => p.fixedSuspect && p.label !== 'fault').length)
    // 自适应对照：同延迟规律 vs 抖动两行、data-w 静态可读。
    const adapt = dom.els['fd-adapt'].innerHTML
    expect(adapt).toContain('规律历史')
    expect(adapt).toContain('抖动历史')
    expect(adapt).toContain('data-w="')
    // 面板二：SWIM 三态成员（真 id + data-state）+ 计数 + 间接救回。
    const swim = dom.els['fd-swim'].innerHTML
    expect(swim).toContain('data-state="alive"')
    expect(swim).toContain('data-state="faulty"')
    expect(swim).toContain('gate-a')
    // 面板渲染的是 alive/suspected/faulty 各自计数（非 total 字段本身）
    expect(swim).toContain('alive <b>' + fd.swim.counts.alive + '</b>')
    expect(swim).toContain('faulty <b>' + fd.swim.counts.faulty + '</b>')
    expect(dom.els['fd-swim-note'].textContent).toContain('间接救回')
    // 健康视图：真节点 + 剔除节点 + TTL 缓存命中三段。
    const health = dom.els['fd-health'].innerHTML
    expect(health).toContain('gate-a')
    expect(health).toContain('gate-c') // 被剔除
    expect(health).toContain('命中')
    expect(health).toContain(String(fd.health.ttlMs))
  })

  it('⑮ KI-503 failureDetector 整块缺 / 单块缺诚实降级，不连坐 rateLimit-lsm', async () => {
    // 整块缺：两面板各子块降级、绝不画 0/假折线；rateLimit/lsm 仍照常。
    const noFd = JSON.parse(JSON.stringify(real))
    noFd.systems.failureDetector = null
    const dom = await runApp(noFd)
    expect(dom.els['fd-hero'].innerHTML).toContain('无故障检测读数')
    expect(dom.els['fd-curve'].innerHTML).toContain('无φ 曲线读数')
    expect(dom.els['fd-swim'].innerHTML).toContain('无SWIM 成员读数')
    expect(dom.els['fd-health'].innerHTML).toContain('无健康视图读数')
    expect(dom.els['fd-hero-note'].textContent).toContain('systems.failureDetector 缺失')
    expect(dom.els['rl-algos'].innerHTML).toContain('固定窗口') // rateLimit 不连坐
    expect(dom.els['lsm-gauge'].innerHTML).toContain(String(real.systems.lsm.speedup.toFixed(1))) // lsm 不连坐

    // 单块缺：只降 SWIM，φ 曲线与健康视图仍渲染真读数（同维不连坐）。
    const partial = JSON.parse(JSON.stringify(real))
    partial.systems.failureDetector.swim = null
    const dom2 = await runApp(partial)
    expect(dom2.els['fd-swim'].innerHTML).toContain('无SWIM 成员读数')
    expect(dom2.els['fd-curve'].innerHTML).toContain('<polyline') // φ 曲线照常
    expect(dom2.els['fd-health'].innerHTML).toContain('gate-a') // 健康视图照常
  })

  it('⑯ KI-504 真 bplusIndex 读数落进「层高/扇出」+「三笔账对照」两面板（不是写死的数）', async () => {
    const bp = real.systems.bplusIndex
    const dom = await runApp(real)
    // 面板一：实测层高 + 稳态估 + 叶数 + 扇出 + 不变式 0 违例，阶梯条逐阶真读数。
    const st = dom.els['bp-structure'].innerHTML
    expect(st).toContain('data-h="' + bp.structure.height + '"')
    expect(st).toContain('data-est="' + bp.structure.heightEstimate + '"')
    expect(st).toContain('data-leaves="' + bp.structure.leafCount + '"')
    expect(st).toContain('扇出 <b>' + bp.structure.fanout + '</b>')
    expect(st).toContain('不变式违例 <b class="jade-t">0</b>') // 真 B+ 树
    expect(st).toContain('✓ 真 B+ 树')
    const ladder = dom.els['bp-ladder'].innerHTML
    bp.structure.heightLadder.forEach((r: any) => {
      expect(ladder).toContain('data-order="' + r.order + '" data-h="' + r.heightEstimate + '"')
    })
    // 面板二：三笔账各自双侧真读数 + favors 上色，对账 dot 一致。
    const cmp = dom.els['bp-compare'].innerHTML
    expect(cmp).toContain('data-key="point" data-favors="' + bp.point.favors + '"')
    expect(cmp).toContain('data-key="range" data-favors="' + bp.range.favors + '"')
    expect(cmp).toContain('data-key="write" data-favors="' + bp.write.favors + '"')
    expect(cmp).toContain(String(bp.point.bplusComparisons))
    expect(cmp).toContain(String(bp.point.lsmComparisons))
    expect(cmp).toContain(String(bp.write.bplusPageRewrites))
    expect(cmp).toContain(String(bp.write.lsmSeqWriteUnits))
    expect(cmp).toContain('三维未归一引擎全拿') // 不封全局赢家
    expect(cmp).toContain('B+ 顺序扫 ✓')
    const ag = dom.els['bp-agreement'].innerHTML
    expect(ag).toContain('data-agree="true"')
    expect(ag).toContain('✓ 一致 · 对照成立')
    expect(ag).toContain('点查分叉 <b>0</b>')
    expect(dom.els['bp-compare-note'].textContent).toContain('非墙钟') // 诚实边界
  })

  it('⑰ KI-504 bplusIndex 整块缺 / 单块缺诚实降级，不连坐 failureDetector-lsm', async () => {
    // 整块缺：四子块全降级、绝不画 0/假条；failureDetector/lsm 仍照常。
    const noBp = JSON.parse(JSON.stringify(real))
    noBp.systems.bplusIndex = null
    const dom = await runApp(noBp)
    expect(dom.els['bp-structure'].innerHTML).toContain('无B+ 树结构读数')
    expect(dom.els['bp-ladder'].innerHTML).toContain('无层高阶梯读数')
    expect(dom.els['bp-compare'].innerHTML).toContain('无三笔账对照读数')
    expect(dom.els['bp-agreement'].innerHTML).toContain('无正确性对账读数')
    expect(dom.els['bp-structure-note'].textContent).toContain('systems.bplusIndex 缺失')
    expect(dom.els['fd-hero'].innerHTML).toContain('次抖动误报') // failureDetector 不连坐
    expect(dom.els['lsm-gauge'].innerHTML).toContain(String(real.systems.lsm.speedup.toFixed(1))) // lsm 不连坐

    // 单块缺：只降 agreement，结构/阶梯/三笔账仍渲染真读数（同维不连坐）。
    const partial = JSON.parse(JSON.stringify(real))
    partial.systems.bplusIndex.agreement = null
    const dom2 = await runApp(partial)
    expect(dom2.els['bp-agreement'].innerHTML).toContain('无正确性对账读数')
    expect(dom2.els['bp-structure'].innerHTML).toContain('✓ 真 B+ 树') // 结构照常
    expect(dom2.els['bp-compare'].innerHTML).toContain('data-key="point"') // 三笔账照常
  })

  it('⑱ KI-505 真 mvccTxn 读数落进「隔离×异常矩阵」+「版本链/死锁」两面板（不是写死的数）', async () => {
    const dom = await runApp(real)
    const mv = real.systems.mvccTxn
    // 面板一：五行隔离 × 五类异常热力格，按挡住(玉)/漏掉(酒红)上色 + 中止 chip + 不封全局赢家
    const matrix = dom.els['mv-matrix'].innerHTML
    expect(matrix).toContain('mv-matrix-head')
    for (const l of mv.levels) expect(matrix).toContain('data-lvl="' + l.short + '"')
    expect(matrix).toContain('data-a="dirtyRead"')
    expect(matrix).toContain('data-a="writeSkew"')
    expect(matrix).toContain('class="mv-cell leaked" data-a="writeSkew"') // SI/SER 行里 SER 挡住 → 至少有一格 blocked；writeSkew 在 RU/RC/RR/SI 漏
    expect(matrix).toContain('class="mv-cell blocked"')                  // SER 全挡 → 有玉格
    expect(matrix).toContain(String(mv.levels.find((l: any) => l.short === 'SER').aborted))
    const aborts = dom.els['mv-abort'].innerHTML
    expect(aborts).toContain('noUniversalWinner')
    expect(aborts).toContain('不封 Serializable 全局赢家')
    expect(dom.els['mv-matrix-note'].textContent).toContain('SI 挡住前四类')
    expect(dom.els['mv-matrix-note'].textContent).toContain('漏写偏斜')
    // 面板二：死锁 wait-for graph 环 + 牺牲者 + 2PL + 无环探针 + gc 水位对照
    const dl = dom.els['mv-deadlock'].innerHTML
    expect(dl).toContain('data-detected="true"')
    expect(dl).toContain('data-txn="T1"')
    expect(dl).toContain('DFS 找环')
    expect(dl).toContain('已放锁解开')
    expect(dl).toContain('无环图如实报无环')
    expect(dl).toContain('判 2PL 违规')
    const gc = dom.els['mv-gc'].innerHTML
    expect(gc).toContain('data-wm="long"')
    expect(gc).toContain('data-wm="clean"')
    expect(gc).toContain(String(mv.gc.longWaterMark.kept))
    expect(gc).toContain(String(mv.gc.cleanWaterMark.kept))
    expect(dom.els['mv-deadlock-note'].textContent).toContain('写饥饿是教学边界')
  })

  it('⑲ KI-505 mvccTxn 整块缺 / 单块缺诚实降级，不连坐 bplusIndex-lsm', async () => {
    // 整块缺：四子块全降级、绝不画 0/假格；bplusIndex/lsm 仍照常。
    const noMv = JSON.parse(JSON.stringify(real))
    noMv.systems.mvccTxn = null
    const dom = await runApp(noMv)
    expect(dom.els['mv-matrix'].innerHTML).toContain('无隔离异常矩阵读数')
    expect(dom.els['mv-abort'].innerHTML).toBe('')
    expect(dom.els['mv-deadlock'].innerHTML).toContain('无死锁检测读数')
    expect(dom.els['mv-gc'].innerHTML).toContain('无gc 水位读数')
    expect(dom.els['mv-matrix-note'].textContent).toContain('systems.mvccTxn 缺失')
    expect(dom.els['bp-structure'].innerHTML).toContain('✓ 真 B+ 树') // bplusIndex 不连坐
    expect(dom.els['lsm-gauge'].innerHTML).toContain(String(real.systems.lsm.speedup.toFixed(1))) // lsm 不连坐

    // 单块缺：只降 gc，矩阵/死锁仍渲染真读数（同维不连坐）。
    const partial = JSON.parse(JSON.stringify(real))
    partial.systems.mvccTxn.gc = null
    const dom2 = await runApp(partial)
    expect(dom2.els['mv-gc'].innerHTML).toContain('无gc 水位读数')
    expect(dom2.els['mv-matrix'].innerHTML).toContain('data-lvl="RU"') // 矩阵照常
    expect(dom2.els['mv-deadlock'].innerHTML).toContain('DFS 找环')    // 死锁照常
  })

  it('⑳ KI-506 真 distributedTxn 读数落进「三协议×六场景」+「三难不可兼得」两面板（不是写死的数）', async () => {
    const dom = await runApp(real)
    const dt = real.systems.distributedTxn
    // 面板一：三协议 × 六场景矩阵（每格读 Node 判词：成/止/阻/脏）+ 侵入度 + 消息横条
    const matrix = dom.els['dt-matrix'].innerHTML
    expect(matrix).toContain('dt-mat-head')
    for (const row of dt.rows) expect(matrix).toContain('data-p="' + row.protocol + '"')
    for (const s of dt.config.scenarios) expect(matrix).toContain('data-s="' + s.id + '"')
    expect(matrix).toContain('class="dt-cell blocked" data-p="2PC" data-s="coordinatorDown"')  // 2PC 阻塞
    expect(matrix).toContain('class="dt-cell dirty" data-p="Saga" data-s="compensateFail"')    // Saga 留脏
    expect(matrix).toContain('class="dt-cell ok" data-p="TCC" data-s="confirmFlaky"')          // TCC 幂等后提交
    expect(matrix).toContain(String(dt.rows.find((r: any) => r.protocol === 'TCC').intrusion)) // 侵入度真读数
    const ladder = dom.els['dt-ladder'].innerHTML
    expect(ladder).toContain('data-p="2PC"')
    expect(ladder).toContain('dt-bar')
    expect(dom.els['dt-matrix-note'].textContent).toContain('侵入度是每服务要写的接口数结构计数')
    // 面板二：三难向量（玉=占/酒红=缺，逐格 data-v）+ 判词探针 + 不封赢家 dot
    const tri = dom.els['dt-trilemma'].innerHTML
    expect(tri).toContain('dt-vec-head')
    expect(tri).toContain('data-k="noBlock"')
    expect(tri).toContain('data-k="noDirty"')
    expect(tri).toContain('data-k="lowIntrusion"')
    expect(tri).toContain('data-p="2PC" data-k="noBlock" data-v="0"')  // 2PC 缺不阻塞
    expect(tri).toContain('data-p="Saga" data-k="noDirty" data-v="0"') // Saga 缺不留脏
    expect(tri).toContain('data-p="TCC" data-k="lowIntrusion" data-v="0"') // TCC 缺侵入最低
    const probes = dom.els['dt-probes'].innerHTML
    expect(probes).toContain('data-probe="twoPcBlocks"')
    expect(probes).toContain('data-probe="sagaDirty"')
    expect(probes).toContain('data-probe="tccRetry"')
    expect(probes).toContain('data-verdict="noUniversalWinner"')
    expect(probes).toContain('不封任何协议全局赢家')
    expect(dom.els['dt-trilemma-note'].textContent).toContain('换场景或故障点结论会变')
  })

  it('㉑ KI-506 distributedTxn 整块缺 / 单块缺诚实降级，不连坐 mvccTxn-bplusIndex-lsm', async () => {
    // 整块缺：四子块全降级、绝不画 0/假格；其它七维仍照常。
    const noDt = JSON.parse(JSON.stringify(real))
    noDt.systems.distributedTxn = null
    const dom = await runApp(noDt)
    expect(dom.els['dt-matrix'].innerHTML).toContain('无三协议场景矩阵读数')
    expect(dom.els['dt-ladder'].innerHTML).toBe('')
    expect(dom.els['dt-trilemma'].innerHTML).toContain('无三难判据读数')
    expect(dom.els['dt-probes'].innerHTML).toBe('')
    expect(dom.els['dt-matrix-note'].textContent).toContain('systems.distributedTxn 缺失')
    expect(dom.els['mv-matrix'].innerHTML).toContain('data-lvl="RU"')      // mvccTxn 不连坐
    expect(dom.els['bp-structure'].innerHTML).toContain('✓ 真 B+ 树')       // bplusIndex 不连坐
    expect(dom.els['lsm-gauge'].innerHTML).toContain(String(real.systems.lsm.speedup.toFixed(1))) // lsm 不连坐

    // 单块缺：只降 tccRetry，矩阵/三难向量仍渲染真读数（同维不连坐）。
    const partial = JSON.parse(JSON.stringify(real))
    partial.systems.distributedTxn.tccRetry = null
    const dom2 = await runApp(partial)
    const probes = dom2.els['dt-probes'].innerHTML
    expect(probes).toContain('TCC</b> Confirm 幂等重试 — 次') // tccRetry 缺 → 诚实落「—」不画 0，其余探针照常
    expect(probes).toContain('data-probe="twoPcBlocks"')
    expect(dom2.els['dt-matrix'].innerHTML).toContain('class="dt-cell blocked"') // 矩阵照常
    expect(dom2.els['dt-trilemma'].innerHTML).toContain('data-k="noBlock"')      // 三难照常
  })

  it('㉒ KI-507 真 raftConsensus 读数落进「三协议×六场景」+「三难不可兼得」两面板（不是写死的数）', async () => {
    const dom = await runApp(real)
    const rc = real.systems.raftConsensus
    // 面板一：三协议 × 六场景矩阵（每格读 Node 判词：成/阻/陈/冲/散）+ 消息横条
    const matrix = dom.els['rc-matrix'].innerHTML
    expect(matrix).toContain('rc-mat-head')
    for (const row of rc.rows) expect(matrix).toContain('data-p="' + row.protocol + '"')
    for (const s of rc.config.scenarios) expect(matrix).toContain('data-s="' + s.id + '"')
    expect(matrix).toContain('class="rc-cell denied" data-p="Raft" data-s="networkPartition"')      // Raft 分区拒写
    expect(matrix).toContain('class="rc-cell conflict" data-p="MultiMaster" data-s="writeConflict"') // 多主冲突
    expect(matrix).toContain('class="rc-cell diverged" data-p="Gossip" data-s="antiEntropyGap"')     // Gossip 未收敛
    expect(matrix).toContain(String(rc.rows.find((r: any) => r.protocol === 'Gossip').totals.messages)) // 消息真读数
    const ladder = dom.els['rc-ladder'].innerHTML
    expect(ladder).toContain('data-p="Raft"')
    expect(ladder).toContain('rc-bar')
    expect(dom.els['rc-matrix-note'].textContent).toContain('反熵间隙结束仍未收敛')
    // 面板二：三难向量（玉=占/酒红=缺，逐格 data-v）+ 判词探针 + 不封赢家 dot
    const tri = dom.els['rc-trilemma'].innerHTML
    expect(tri).toContain('rc-vec-head')
    expect(tri).toContain('data-k="linearizable"')
    expect(tri).toContain('data-k="partitionAvailable"')
    expect(tri).toContain('data-k="boundedConvergence"')
    expect(tri).toContain('data-p="Raft" data-k="partitionAvailable" data-v="0"')       // Raft 缺分区可用
    expect(tri).toContain('data-p="MultiMaster" data-k="linearizable" data-v="0"')      // 多主缺线性一致
    expect(tri).toContain('data-p="Gossip" data-k="boundedConvergence" data-v="0"')     // Gossip 缺确定收敛
    const probes = dom.els['rc-probes'].innerHTML
    expect(probes).toContain('data-probe="raftBlocks"')
    expect(probes).toContain('data-probe="raftElection"')
    expect(probes).toContain('data-probe="raftSafety"')
    expect(probes).toContain('data-probe="mmConflict"')
    expect(probes).toContain('data-probe="gossipGap"')
    expect(probes).toContain('data-verdict="noUniversalWinner"')
    expect(probes).toContain('不封任何协议全局赢家')
    expect(dom.els['rc-trilemma-note'].textContent).toContain('换场景结论会变')
  })

  it('㉓ KI-507 raftConsensus 整块缺 / 单块缺诚实降级，不连坐 distributedTxn-mvccTxn-lsm', async () => {
    // 整块缺：四子块全降级、绝不画 0/假格；其它八维仍照常。
    const noRc = JSON.parse(JSON.stringify(real))
    noRc.systems.raftConsensus = null
    const dom = await runApp(noRc)
    expect(dom.els['rc-matrix'].innerHTML).toContain('无三协议场景矩阵读数')
    expect(dom.els['rc-ladder'].innerHTML).toBe('')
    expect(dom.els['rc-trilemma'].innerHTML).toContain('无三难判据读数')
    expect(dom.els['rc-probes'].innerHTML).toBe('')
    expect(dom.els['rc-matrix-note'].textContent).toContain('systems.raftConsensus 缺失')
    expect(dom.els['dt-matrix'].innerHTML).toContain('data-p="2PC"')           // distributedTxn 不连坐
    expect(dom.els['mv-matrix'].innerHTML).toContain('data-lvl="RU"')          // mvccTxn 不连坐
    expect(dom.els['lsm-gauge'].innerHTML).toContain(String(real.systems.lsm.speedup.toFixed(1))) // lsm 不连坐

    // 单块缺：只降 gossip 探针，矩阵/三难向量仍渲染真读数（同维不连坐）。
    const partial = JSON.parse(JSON.stringify(real))
    partial.systems.raftConsensus.gossip = null
    const dom2 = await runApp(partial)
    const probes = dom2.els['rc-probes'].innerHTML
    expect(probes).toContain('反熵间隙 收敛 · 读陈 无 · 无确定上界 ✗') // gossip 缺 → 诚实落否定，不编读数
    expect(probes).toContain('data-probe="raftBlocks"')              // 其余探针照常
    expect(dom2.els['rc-matrix'].innerHTML).toContain('class="rc-cell denied"') // 矩阵照常
    expect(dom2.els['rc-trilemma'].innerHTML).toContain('data-k="linearizable"') // 三难照常
  })

  it('㉔ KI-508 真 distributedLock 读数落进「三协议×六场景」+「三难不可兼得」两面板（不是写死的数）', async () => {
    const dom = await runApp(real)
    const dl = real.systems.distributedLock
    // 面板一：三协议 × 六场景矩阵（每格读 Node 判词：成/双/护/脏/阻/拒）+ 消息横条
    const matrix = dom.els['dl-matrix'].innerHTML
    expect(matrix).toContain('dl-mat-head')
    for (const row of dl.rows) expect(matrix).toContain('data-p="' + row.protocol + '"')
    for (const s of dl.config.scenarios) expect(matrix).toContain('data-s="' + s.id + '"')
    expect(matrix).toContain('class="dl-cell double" data-p="SETNX" data-s="gcPause"')       // SETNX GC 暂停双主
    expect(matrix).toContain('class="dl-cell double" data-p="Redlock" data-s="clockDrift"')  // Redlock 漂移双主
    expect(matrix).toContain('class="dl-cell guard" data-p="ETCD" data-s="staleFencing"')    // etcd fencing 拒旧写
    expect(matrix).toContain('class="dl-cell denied" data-p="SETNX" data-s="nodeDown"')      // SETNX 单点宕机阻
    expect(matrix).toContain('class="dl-cell denied" data-p="ETCD" data-s="partitionMinority"') // etcd 少数派拒锁
    expect(matrix).toContain(String(dl.rows.find((r: any) => r.protocol === 'ETCD').totals.messages)) // 消息真读数
    const ladder = dom.els['dl-ladder'].innerHTML
    expect(ladder).toContain('data-p="SETNX"')
    expect(ladder).toContain('dl-bar')
    expect(dom.els['dl-matrix-note'].textContent).toContain('fencing 用单调 token 拒绝旧写')
    // 面板二：三难向量（玉=占/酒红=缺，逐格 data-v）+ 判词探针 + 不封赢家 dot
    const tri = dom.els['dl-trilemma'].innerHTML
    expect(tri).toContain('dl-vec-head')
    expect(tri).toContain('data-k="mutualExclusion"')
    expect(tri).toContain('data-k="partialFaultTolerance"')
    expect(tri).toContain('data-k="lowLatency"')
    expect(tri).toContain('data-p="SETNX" data-k="mutualExclusion" data-v="0"')     // SETNX 缺互斥
    expect(tri).toContain('data-p="SETNX" data-k="partialFaultTolerance" data-v="0"') // SETNX 缺容错
    expect(tri).toContain('data-p="Redlock" data-k="lowLatency" data-v="0"')        // Redlock 缺低延迟
    expect(tri).toContain('data-p="ETCD" data-k="mutualExclusion" data-v="1"')      // etcd 占互斥
    expect(tri).toContain('data-p="ETCD" data-k="lowLatency" data-v="0"')           // etcd 缺低延迟
    const probes = dom.els['dl-probes'].innerHTML
    expect(probes).toContain('data-probe="setnxGc"')
    expect(probes).toContain('data-probe="setnxTtl"')
    expect(probes).toContain('data-probe="redlockDrift"')
    expect(probes).toContain('data-probe="redlockFence"')
    expect(probes).toContain('data-probe="etcdFence"')
    expect(probes).toContain('data-probe="etcdRenew"')
    expect(probes).toContain('data-verdict="noUniversalWinner"')
    expect(probes).toContain('不封任何协议全局赢家')
    expect(dom.els['dl-trilemma-note'].textContent).toContain('换场景结论会变')
  })

  it('㉕ KI-508 distributedLock 整块缺 / 单块缺诚实降级，不连坐 raftConsensus-distributedTxn-lsm', async () => {
    // 整块缺：四子块全降级、绝不画 0/假格；其它九维仍照常。
    const noDl = JSON.parse(JSON.stringify(real))
    noDl.systems.distributedLock = null
    const dom = await runApp(noDl)
    expect(dom.els['dl-matrix'].innerHTML).toContain('无三协议场景矩阵读数')
    expect(dom.els['dl-ladder'].innerHTML).toBe('')
    expect(dom.els['dl-trilemma'].innerHTML).toContain('无三难判据读数')
    expect(dom.els['dl-probes'].innerHTML).toBe('')
    expect(dom.els['dl-matrix-note'].textContent).toContain('systems.distributedLock 缺失')
    expect(dom.els['rc-matrix'].innerHTML).toContain('data-p="Raft"')             // raftConsensus 不连坐
    expect(dom.els['dt-matrix'].innerHTML).toContain('data-p="2PC"')              // distributedTxn 不连坐
    expect(dom.els['lsm-gauge'].innerHTML).toContain(String(real.systems.lsm.speedup.toFixed(1))) // lsm 不连坐

    // 单块缺：只降 fencing 探针，矩阵/三难向量仍渲染真读数（同维不连坐）。
    const partial = JSON.parse(JSON.stringify(real))
    partial.systems.distributedLock.fencing = null
    const dom2 = await runApp(partial)
    const probes = dom2.els['dl-probes'].innerHTML
    expect(probes).toContain('单调 token ✗ · 旧 token 写 未拒 · 不脏写 ✗') // fencing 缺 → 诚实落否定，不编读数
    expect(probes).toContain('data-probe="setnxGc"')                     // 其余探针照常
    expect(dom2.els['dl-matrix'].innerHTML).toContain('class="dl-cell guard"')    // 矩阵照常
    expect(dom2.els['dl-trilemma'].innerHTML).toContain('data-k="mutualExclusion"') // 三难照常
  })

  it('㉖ KI-509 真 idGen 读数落进「三协议×六场景」+「三难不可兼得」两面板（含 KI-504 真树交叉印证，不是写死数）', async () => {
    const dom = await runApp(real)
    const ig = real.systems.idGen
    // 面板一：三协议 × 六场景矩阵（每格读 Node 判词：成/裂/停/重/隙/迟）+ 发号横条
    const matrix = dom.els['ig-matrix'].innerHTML
    expect(matrix).toContain('ig-mat-head')
    for (const row of ig.rows) expect(matrix).toContain('data-p="' + row.protocol + '"')
    for (const s of ig.config.scenarios) expect(matrix).toContain('data-s="' + s.id + '"')
    expect(matrix).toContain('class="ig-cell split" data-p="UUID" data-s="randomKeyInsert"')   // UUID 随机主键索引代价
    expect(matrix).toContain('class="ig-cell halt" data-p="Snowflake" data-s="clockBackward"') // Snowflake 回拨停发
    expect(matrix).toContain('class="ig-cell halt" data-p="Segment" data-s="centerDown"')      // 号段中心宕中断
    expect(matrix).toContain('class="ig-cell gap" data-p="Segment" data-s="segmentGap"')       // 号段重启跳号
    expect(matrix).toContain('class="ig-cell lag" data-p="Segment" data-s="sequenceOverflow"') // 号段取新段 RTT
    expect(matrix).toContain(String(ig.rows.find((r: any) => r.protocol === 'UUID').totals.issued)) // 发号真读数
    const ladder = dom.els['ig-ladder'].innerHTML
    expect(ladder).toContain('data-p="UUID"')
    expect(ladder).toContain('ig-bar')
    expect(dom.els['ig-matrix-note'].textContent).toContain('随机主键插真 B+ 树定位比较更高')
    // 面板二：三难向量（玉=占/酒红=缺，逐格 data-v）+ KI-504 真树交叉印证栏 + 判词探针 + 不封赢家 dot
    const tri = dom.els['ig-trilemma'].innerHTML
    expect(tri).toContain('ig-vec-head')
    expect(tri).toContain('data-k="indexFriendly"')
    expect(tri).toContain('data-k="decentralized"')
    expect(tri).toContain('data-k="clockRobust"')
    expect(tri).toContain('data-p="UUID" data-k="indexFriendly" data-v="0"')      // UUID 缺索引友好
    expect(tri).toContain('data-p="Snowflake" data-k="clockRobust" data-v="0"')   // Snowflake 缺抗时钟
    expect(tri).toContain('data-p="Segment" data-k="decentralized" data-v="0"')   // 号段缺去中心
    const btree = dom.els['ig-btree'].innerHTML
    expect(btree).toContain('KI-504 真 B+ 树交叉印证')
    expect(btree).toContain(String(ig.btree.randomCmp))
    expect(btree).toContain('反直觉')
    const probes = dom.els['ig-probes'].innerHTML
    expect(probes).toContain('data-probe="uuidIndex"')
    expect(probes).toContain('data-probe="snowBack"')
    expect(probes).toContain('data-probe="segCenter"')
    expect(probes).toContain('data-verdict="noUniversalWinner"')
    expect(probes).toContain('不封任何协议全局赢家')
    expect(dom.els['ig-trilemma-note'].textContent).toContain('换场景结论会变')
  })

  it('㉗ KI-509 idGen 整块缺 / 单块缺诚实降级，不连坐 distributedLock-raftConsensus-lsm', async () => {
    // 整块缺：五子块全降级、绝不画 0/假格；其它十维仍照常。
    const noIg = JSON.parse(JSON.stringify(real))
    noIg.systems.idGen = null
    const dom = await runApp(noIg)
    expect(dom.els['ig-matrix'].innerHTML).toContain('无三协议场景矩阵读数')
    expect(dom.els['ig-ladder'].innerHTML).toBe('')
    expect(dom.els['ig-trilemma'].innerHTML).toContain('无三难判据读数')
    expect(dom.els['ig-btree'].innerHTML).toBe('')
    expect(dom.els['ig-probes'].innerHTML).toBe('')
    expect(dom.els['ig-matrix-note'].textContent).toContain('systems.idGen 缺失')
    expect(dom.els['dl-matrix'].innerHTML).toContain('data-p="SETNX"')            // distributedLock 不连坐
    expect(dom.els['rc-matrix'].innerHTML).toContain('data-p="Raft"')             // raftConsensus 不连坐
    expect(dom.els['lsm-gauge'].innerHTML).toContain(String(real.systems.lsm.speedup.toFixed(1))) // lsm 不连坐

    // 单块缺：只降 btree 真树交叉印证，矩阵/三难向量/探针仍渲染真读数（同维不连坐）。
    const partial = JSON.parse(JSON.stringify(real))
    partial.systems.idGen.btree = null
    const dom2 = await runApp(partial)
    expect(dom2.els['ig-btree'].innerHTML).toContain('无真树交叉印证读数') // btree 缺 → 诚实降级
    expect(dom2.els['ig-btree'].innerHTML).not.toContain('伤索引')         // 不编造铁证
    expect(dom2.els['ig-probes'].innerHTML).toContain('data-probe="uuidIndex"')    // 其余探针照常
    expect(dom2.els['ig-matrix'].innerHTML).toContain('class="ig-cell split"')      // 矩阵照常
    expect(dom2.els['ig-trilemma'].innerHTML).toContain('data-k="indexFriendly"')   // 三难照常
  })

  it('㉘ KI-510 真 distributedRateLimit 读数落进「三协议×六场景」+「三难不可兼得」两面板（含真 Redis 原子桶/真环交叉印证，不是写死数）', async () => {
    const dom = await runApp(real)
    const drl = real.systems.distributedRateLimit
    // 面板一：三协议 × 六场景矩阵（成/超/迟/碎/降，读 Node 判词）+ 中心 RTT 横条
    const matrix = dom.els['drl-matrix'].innerHTML
    expect(matrix).toContain('drl-mat-head')
    for (const row of drl.rows) expect(matrix).toContain('data-p="' + row.protocol + '"')
    for (const s of drl.config.scenarios) expect(matrix).toContain('data-s="' + s + '"')
    expect(matrix).toContain('class="drl-cell over" data-p="Local" data-s="allOk"')        // Local 六场景超发
    expect(matrix).toContain('class="drl-cell lag" data-p="Central" data-s="allOk"')       // Central 中心 RTT
    expect(matrix).toContain('class="drl-cell frag" data-p="Sharded" data-s="skewKeys"')   // Sharded 配额碎片
    expect(matrix).toContain('class="drl-cell degrade" data-p="Sharded" data-s="centerDown"') // 单片降级
    expect(matrix).toContain(String(drl.rows.find((r: any) => r.protocol === 'Local').totals.allowed)) // 放行真读数
    const ladder = dom.els['drl-ladder'].innerHTML
    expect(ladder).toContain('data-p="Central"')
    expect(ladder).toContain('drl-bar')
    expect(dom.els['drl-matrix-note'].textContent).toContain('Sharded 不是银弹')
    // 面板二：三难向量（逐格 data-v）+ 真件交叉印证栏 + 判词探针 + 不封赢家
    const tri = dom.els['drl-trilemma'].innerHTML
    expect(tri).toContain('drl-vec-head')
    expect(tri).toContain('data-k="globalExact"')
    expect(tri).toContain('data-k="partialFaultTolerance"')
    expect(tri).toContain('data-k="noCenterRTT"')
    expect(tri).toContain('data-p="Local" data-k="globalExact" data-v="0"')            // Local 缺全局精确
    expect(tri).toContain('data-p="Central" data-k="partialFaultTolerance" data-v="0"') // Central 缺容错
    expect(tri).toContain('data-p="Sharded" data-k="noCenterRTT" data-v="0"')          // Sharded 仍吃 RTT
    const cx = dom.els['drl-crosscheck'].innerHTML
    expect(cx).toContain('真 Redis 令牌桶')
    expect(cx).toContain('真一致性哈希环')
    expect(cx).toContain(String(drl.crosscheck.sharded.skewEmptyNodes))                // 偏斜空片真读数
    const probes = dom.els['drl-probes'].innerHTML
    expect(probes).toContain('data-probe="drlLocal"')
    expect(probes).toContain('data-probe="drlCentral"')
    expect(probes).toContain('data-probe="drlSharded"')
    expect(probes).toContain('data-verdict="shardedNotPanacea"')
    expect(probes).toContain('data-verdict="noUniversalWinner"')
    expect(dom.els['drl-trilemma-note'].textContent).toContain('换场景结论会变')
  })

  it('㉙ KI-510 distributedRateLimit 整块缺 / 单块缺诚实降级，不连坐 idGen-distributedLock-lsm', async () => {
    // 整块缺：五子块全降级、绝不画 0/假格；其它维仍照常。
    const noDrl = JSON.parse(JSON.stringify(real))
    noDrl.systems.distributedRateLimit = null
    const dom = await runApp(noDrl)
    expect(dom.els['drl-matrix'].innerHTML).toContain('无三协议场景矩阵读数')
    expect(dom.els['drl-ladder'].innerHTML).toBe('')
    expect(dom.els['drl-trilemma'].innerHTML).toContain('无三难判据读数')
    expect(dom.els['drl-crosscheck'].innerHTML).toBe('')
    expect(dom.els['drl-probes'].innerHTML).toBe('')
    expect(dom.els['drl-matrix-note'].textContent).toContain('systems.distributedRateLimit 缺失')
    expect(dom.els['ig-matrix'].innerHTML).toContain('data-p="UUID"')            // idGen 不连坐
    expect(dom.els['dl-matrix'].innerHTML).toContain('data-p="SETNX"')           // distributedLock 不连坐
    expect(dom.els['lsm-gauge'].innerHTML).toContain(String(real.systems.lsm.speedup.toFixed(1))) // lsm 不连坐

    // 单块缺：只降 crosscheck 真件交叉印证，矩阵/三难向量/探针仍渲染真读数（同维不连坐）。
    const partial = JSON.parse(JSON.stringify(real))
    partial.systems.distributedRateLimit.crosscheck = null
    const dom2 = await runApp(partial)
    expect(dom2.els['drl-crosscheck'].innerHTML).toContain('无真件交叉印证读数') // crosscheck 缺 → 诚实降级
    expect(dom2.els['drl-crosscheck'].innerHTML).not.toContain('丢失更新')       // 不编造铁证
    expect(dom2.els['drl-probes'].innerHTML).toContain('data-probe="drlLocal"')  // 其余探针照常
    expect(dom2.els['drl-matrix'].innerHTML).toContain('class="drl-cell over"')   // 矩阵照常
    expect(dom2.els['drl-trilemma'].innerHTML).toContain('data-k="globalExact"')  // 三难照常
  })

  it('㉚ KI-511 真 configConsistency 读数落进「三协议×六场景」+「三难不可兼得」两面板（含七枚真件交叉印证，不是写死数）', async () => {
    const dom = await runApp(real)
    const dcc = real.systems.configConsistency
    // 面板一：三协议 × 六场景矩阵（成/空/迟/断/缺/连，读 Node 判词）+ 常驻连接横条
    const matrix = dom.els['dcc-matrix'].innerHTML
    expect(matrix).toContain('dcc-mat-head')
    for (const row of dcc.rows) expect(matrix).toContain('data-p="' + row.protocol + '"')
    for (const s of dcc.config.scenarios) expect(matrix).toContain('data-s="' + s + '"')
    expect(matrix).toContain('class="dcc-cell over" data-p="Polling" data-s="idleNoChange"')      // Polling 空转
    expect(matrix).toContain('class="dcc-cell degrade" data-p="LongPolling" data-s="centerDown"') // 长轮询中心宕全断
    expect(matrix).toContain('class="dcc-cell frag" data-p="WatchPush" data-s="burstChanges"')    // Watch 风暴版本缺口
    expect(matrix).toContain('class="dcc-cell lag" data-p="Polling" data-s="burstChanges"')       // Polling 0~T 延迟
    expect(matrix).toContain(String(dcc.rows.find((r: any) => r.protocol === 'WatchPush').totals.connections)) // 连接真读数
    const ladder = dom.els['dcc-ladder'].innerHTML
    expect(ladder).toContain('data-p="Polling"')
    expect(ladder).toContain('dcc-bar')
    expect(dom.els['dcc-matrix-note'].textContent).toContain('Watch 不是银弹')
    // 面板二：三难向量（逐格 data-v）+ 七枚真件交叉印证栏 + 判词探针 + 不封赢家
    const tri = dom.els['dcc-trilemma'].innerHTML
    expect(tri).toContain('dcc-vec-head')
    expect(tri).toContain('data-k="degradeOnCenterDown"')
    expect(tri).toContain('data-k="noIdleOverhead"')
    expect(tri).toContain('data-k="instantPerceive"')
    expect(tri).toContain('data-p="Polling" data-k="noIdleOverhead" data-v="0"')      // Polling 缺无空闲
    expect(tri).toContain('data-p="LongPolling" data-k="degradeOnCenterDown" data-v="0"') // 长轮询缺可降级
    expect(tri).toContain('data-p="WatchPush" data-k="instantPerceive" data-v="0"')    // Watch 缺即时
    const cx = dom.els['dcc-crosscheck'].innerHTML
    expect(cx).toContain('真 Config Server 响应')
    expect(cx).toContain('startConfigWatcher')
    expect(cx).toContain('createBus')
    expect(cx).toContain('hashSelector')
    expect(cx).toContain(String(dcc.crosscheck.gray.stableBuckets))                   // 稳定桶真读数
    expect(cx).toContain(String(dcc.crosscheck.redisCache.expiredCount))              // TTL 失效真读数
    const probes = dom.els['dcc-probes'].innerHTML
    expect(probes).toContain('data-probe="dccPolling"')
    expect(probes).toContain('data-probe="dccLongPolling"')
    expect(probes).toContain('data-probe="dccWatch"')
    expect(probes).toContain('data-verdict="watchNotPanacea"')
    expect(probes).toContain('data-verdict="noUniversalWinner"')
    expect(dom.els['dcc-trilemma-note'].textContent).toContain('换场景结论会变')
  })

  it('㉛ KI-511 configConsistency 整块缺 / 单块缺诚实降级，不连坐 drl-idGen-lsm', async () => {
    // 整块缺：五子块全降级、绝不画 0/假格；其它维仍照常。
    const noDcc = JSON.parse(JSON.stringify(real))
    noDcc.systems.configConsistency = null
    const dom = await runApp(noDcc)
    expect(dom.els['dcc-matrix'].innerHTML).toContain('无三协议场景矩阵读数')
    expect(dom.els['dcc-ladder'].innerHTML).toBe('')
    expect(dom.els['dcc-trilemma'].innerHTML).toContain('无三难判据读数')
    expect(dom.els['dcc-crosscheck'].innerHTML).toBe('')
    expect(dom.els['dcc-probes'].innerHTML).toBe('')
    expect(dom.els['dcc-matrix-note'].textContent).toContain('systems.configConsistency 缺失')
    expect(dom.els['drl-matrix'].innerHTML).toContain('data-p="Local"')             // KI-510 不连坐
    expect(dom.els['ig-matrix'].innerHTML).toContain('data-p="UUID"')               // idGen 不连坐
    expect(dom.els['lsm-gauge'].innerHTML).toContain(String(real.systems.lsm.speedup.toFixed(1))) // lsm 不连坐

    // 单块缺：只降 crosscheck 真件交叉印证，矩阵/三难向量/探针仍渲染真读数（同维不连坐）。
    const partial = JSON.parse(JSON.stringify(real))
    partial.systems.configConsistency.crosscheck = null
    const dom2 = await runApp(partial)
    expect(dom2.els['dcc-crosscheck'].innerHTML).toContain('无真件交叉印证读数')   // crosscheck 缺 → 诚实降级
    expect(dom2.els['dcc-crosscheck'].innerHTML).not.toContain('startConfigWatcher') // 不编造铁证
    expect(dom2.els['dcc-probes'].innerHTML).toContain('data-probe="dccPolling"')  // 其余探针照常
    expect(dom2.els['dcc-matrix'].innerHTML).toContain('class="dcc-cell over"')     // 矩阵照常
    expect(dom2.els['dcc-trilemma'].innerHTML).toContain('data-k="instantPerceive"') // 三难照常
  })

  it('㉜ KI-512 真 cacheCoherency 读数落进「三协议×六场景」+「三难不可兼得」两面板（含七枚真件交叉印证，不是写死数）', async () => {
    const dom = await runApp(real)
    const ccc = real.systems.cacheCoherency
    // 面板一：三协议 × 六场景矩阵（丢/陈/存/阻/合/成，读 Node 判词）+ 写 RTT 横条
    const matrix = dom.els['ccc-matrix'].innerHTML
    expect(matrix).toContain('ccc-mat-head')
    for (const row of ccc.rows) expect(matrix).toContain('data-p="' + row.protocol + '"')
    for (const s of ccc.config.scenarios) expect(matrix).toContain('data-s="' + s + '"')
    expect(matrix).toContain('class="ccc-cell stale" data-p="CacheAside" data-s="readAfterWrite"')    // CacheAside 非原子窗口陈旧读
    expect(matrix).toContain('class="ccc-cell lost" data-p="WriteBehind" data-s="cacheCrash"')        // WriteBehind 整机宕丢脏页
    expect(matrix).toContain('class="ccc-cell crash" data-p="WriteThrough" data-s="cacheCrash"')      // WriteThrough 宕而不丢
    expect(matrix).toContain('class="ccc-cell coalesce" data-p="WriteBehind" data-s="writeHeavy"')    // WriteBehind 写回合并
    expect(matrix).toContain('class="ccc-cell block" data-p="WriteThrough" data-s="writeHeavy"')      // WriteThrough 写阻塞
    expect(matrix).toContain(String(ccc.rows.find((r: any) => r.protocol === 'CacheAside').totals.writeBackendRttMs)) // 写 RTT 真读数
    const ladder = dom.els['ccc-ladder'].innerHTML
    expect(ladder).toContain('data-p="WriteBehind"')
    expect(ladder).toContain('ccc-bar')
    expect(dom.els['ccc-matrix-note'].textContent).toContain('Write-Behind 不是银弹')
    // 面板二：三难向量（逐格 data-v）+ 七枚真件交叉印证栏 + 判词探针 + 不封赢家
    const tri = dom.els['ccc-trilemma'].innerHTML
    expect(tri).toContain('ccc-vec-head')
    expect(tri).toContain('data-k="readYourWrites"')
    expect(tri).toContain('data-k="noWriteBlocking"')
    expect(tri).toContain('data-k="durableOnCrash"')
    expect(tri).toContain('data-p="CacheAside" data-k="readYourWrites" data-v="0"')     // CacheAside 缺写后可见
    expect(tri).toContain('data-p="WriteThrough" data-k="noWriteBlocking" data-v="0"')  // WriteThrough 缺写不阻塞
    expect(tri).toContain('data-p="WriteBehind" data-k="durableOnCrash" data-v="0"')    // WriteBehind 缺整机宕不丢写
    const cx = dom.els['ccc-crosscheck'].innerHTML
    expect(cx).toContain('createRedisCache')
    expect(cx).toContain('createWal')
    expect(cx).toContain('shouldEarlyExpire')
    expect(cx).toContain('createShardedCache')
    expect(cx).toContain('createMvccStore')
    expect(cx).toContain('createTwoPhaseCommit')
    expect(cx).toContain('createHashRing')
    expect(cx).toContain(String(ccc.crosscheck.sharded.readHits))            // 分片全可读真读数
    expect(cx).toContain(String(ccc.crosscheck.twoPhase.blockedParticipants)) // 2PC 阻塞真读数
    expect(cx).toContain('整机+盘一起丢')                                     // WAL 诚实边界
    const probes = dom.els['ccc-probes'].innerHTML
    expect(probes).toContain('data-probe="cccAside"')
    expect(probes).toContain('data-probe="cccThrough"')
    expect(probes).toContain('data-probe="cccBehind"')
    expect(probes).toContain('data-probe="cccWal"')
    expect(probes).toContain('data-verdict="writeBehindNotPanacea"')
    expect(probes).toContain('data-verdict="noUniversalWinner"')
    expect(dom.els['ccc-trilemma-note'].textContent).toContain('换场景结论会变')
  })

  it('㉝ KI-512 cacheCoherency 整块缺 / 单块缺诚实降级，不连坐 dcc-drl-lsm', async () => {
    // 整块缺：五子块全降级、绝不画 0/假格；其它维仍照常。
    const noCcc = JSON.parse(JSON.stringify(real))
    noCcc.systems.cacheCoherency = null
    const dom = await runApp(noCcc)
    expect(dom.els['ccc-matrix'].innerHTML).toContain('无三协议场景矩阵读数')
    expect(dom.els['ccc-ladder'].innerHTML).toBe('')
    expect(dom.els['ccc-trilemma'].innerHTML).toContain('无三难判据读数')
    expect(dom.els['ccc-crosscheck'].innerHTML).toBe('')
    expect(dom.els['ccc-probes'].innerHTML).toBe('')
    expect(dom.els['ccc-matrix-note'].textContent).toContain('systems.cacheCoherency 缺失')
    expect(dom.els['dcc-matrix'].innerHTML).toContain('data-p="Polling"')             // KI-511 不连坐
    expect(dom.els['drl-matrix'].innerHTML).toContain('data-p="Local"')               // KI-510 不连坐
    expect(dom.els['lsm-gauge'].innerHTML).toContain(String(real.systems.lsm.speedup.toFixed(1))) // lsm 不连坐

    // 单块缺：只降 crosscheck 真件交叉印证，矩阵/三难向量/探针仍渲染真读数（同维不连坐）。
    const partial = JSON.parse(JSON.stringify(real))
    partial.systems.cacheCoherency.crosscheck = null
    const dom2 = await runApp(partial)
    expect(dom2.els['ccc-crosscheck'].innerHTML).toContain('无真件交叉印证读数')   // crosscheck 缺 → 诚实降级
    expect(dom2.els['ccc-crosscheck'].innerHTML).not.toContain('createRedisCache') // 不编造铁证
    expect(dom2.els['ccc-probes'].innerHTML).toContain('data-probe="cccWal"')      // 其余探针照常
    expect(dom2.els['ccc-matrix'].innerHTML).toContain('class="ccc-cell lost"')     // 矩阵照常
    expect(dom2.els['ccc-trilemma'].innerHTML).toContain('data-k="durableOnCrash"')  // 三难照常
  })

  it('㉞ KI-513 真 messageDelivery 读数落进「三协议×六场景」+「三难不可兼得」两面板（含七枚真件交叉印证，不是写死数）', async () => {
    const dom = await runApp(real)
    const mmd = real.systems.messageDelivery
    // 面板一：三协议 × 六场景矩阵（丢/重/贵/等/成，读 Node 判词）+ 结构开销横条
    const matrix = dom.els['mmd-matrix'].innerHTML
    expect(matrix).toContain('mmd-mat-head')
    for (const row of mmd.rows) expect(matrix).toContain('data-p="' + row.protocol + '"')
    for (const s of mmd.config.scenarios) expect(matrix).toContain('data-s="' + s + '"')
    expect(matrix).toContain('class="mmd-cell lost" data-p="AtMostOnce" data-s="crashAfterSend"')     // AtMostOnce 静默丢
    expect(matrix).toContain('class="mmd-cell dup" data-p="AtLeastOnce" data-s="ackLost"')             // AtLeastOnce 重复
    expect(matrix).toContain('class="mmd-cell expensive" data-p="ExactlyOnce" data-s="allOk"')         // ExactlyOnce 最贵
    expect(matrix).toContain('class="mmd-cell expensive" data-p="ExactlyOnce" data-s="brokerRetry"')   // 幂等折叠格仍最贵（贵优先于等，与 CLI 同口径）
    // "等"(idempotent) 是假想分支：仅当 lowOverhead=true 且 idempotentHits>0 才出现，默认快照恒被"贵"压住，不在此断言。
    expect(matrix).toContain(String(mmd.rows.find((r: any) => r.protocol === 'AtMostOnce').totals.sent)) // 发送数真读数
    const ladder = dom.els['mmd-ladder'].innerHTML
    expect(ladder).toContain('data-p="ExactlyOnce"')
    expect(ladder).toContain('mmd-bar')
    expect(dom.els['mmd-matrix-note'].textContent).toContain('Exactly-Once 不是免费午餐')
    // 面板二：三难向量（逐格 data-v）+ 七枚真件交叉印证栏 + 判词探针 + 不封赢家
    const tri = dom.els['mmd-trilemma'].innerHTML
    expect(tri).toContain('mmd-vec-head')
    expect(tri).toContain('data-k="noLoss"')
    expect(tri).toContain('data-k="noDup"')
    expect(tri).toContain('data-k="lowOverhead"')
    expect(tri).toContain('data-p="AtMostOnce" data-k="noLoss" data-v="0"')      // AtMostOnce 缺不丢
    expect(tri).toContain('data-p="AtLeastOnce" data-k="noDup" data-v="0"')      // AtLeastOnce 缺不重复
    expect(tri).toContain('data-p="ExactlyOnce" data-k="lowOverhead" data-v="0"') // ExactlyOnce 缺低开销
    const cx = dom.els['mmd-crosscheck'].innerHTML
    expect(cx).toContain('createBus')
    expect(cx).toContain('createGameEventBus')
    expect(cx).toContain('createGameEventBridge')
    expect(cx).toContain('createTwoPhaseCommit')
    expect(cx).toContain('createWal')
    expect(cx).toContain('createRedisCache')
    expect(cx).toContain('createHashRing')
    expect(cx).toContain(String(mmd.crosscheck.wal.distinctIds))          // 真 WAL distinct 真读数
    expect(cx).toContain(String(mmd.crosscheck.gameEventBus.delivered))    // 真 GameEventBus 交付真读数
    expect(cx).toContain('跨机复制')                                       // WAL 诚实边界
    const probes = dom.els['mmd-probes'].innerHTML
    expect(probes).toContain('data-probe="mmdMost"')
    expect(probes).toContain('data-probe="mmdLeast"')
    expect(probes).toContain('data-probe="mmdOnce"')
    expect(probes).toContain('data-verdict="exactlyOnceNotFree"')
    expect(probes).toContain('data-verdict="noUniversalWinner"')
    expect(dom.els['mmd-trilemma-note'].textContent).toContain('换场景结论会变')

    // "等"(idempotent) 分支可达性：freeIdempotency 假想下 ExactlyOnce 低开销翻转 ⇒ 幂等折叠格从"贵"翻"等"，分支非死代码。
    const freed = JSON.parse(JSON.stringify(real))
    for (const row of freed.systems.messageDelivery.rows) {
      if (row.protocol === 'ExactlyOnce') for (const s of row.scenarios) s.lowOverhead = true
    }
    const domF = await runApp(freed)
    expect(domF.els['mmd-matrix'].innerHTML).toContain('class="mmd-cell idempotent" data-p="ExactlyOnce" data-s="brokerRetry"')
    expect(domF.els['mmd-matrix'].innerHTML).toContain('class="mmd-cell idempotent" data-p="ExactlyOnce" data-s="ackLost"')
  })

  it('㉟ KI-513 messageDelivery 整块缺 / 单块缺诚实降级，不连坐 ccc-dcc-drl-lsm', async () => {
    // 整块缺：五子块全降级、绝不画 0/假格；其它维仍照常。
    const noMmd = JSON.parse(JSON.stringify(real))
    noMmd.systems.messageDelivery = null
    const dom = await runApp(noMmd)
    expect(dom.els['mmd-matrix'].innerHTML).toContain('无三协议场景矩阵读数')
    expect(dom.els['mmd-ladder'].innerHTML).toBe('')
    expect(dom.els['mmd-trilemma'].innerHTML).toContain('无三难判据读数')
    expect(dom.els['mmd-crosscheck'].innerHTML).toBe('')
    expect(dom.els['mmd-probes'].innerHTML).toBe('')
    expect(dom.els['mmd-matrix-note'].textContent).toContain('systems.messageDelivery 缺失')
    expect(dom.els['ccc-matrix'].innerHTML).toContain('data-p="CacheAside"')         // KI-512 不连坐
    expect(dom.els['dcc-matrix'].innerHTML).toContain('data-p="Polling"')            // KI-511 不连坐
    expect(dom.els['drl-matrix'].innerHTML).toContain('data-p="Local"')              // KI-510 不连坐
    expect(dom.els['lsm-gauge'].innerHTML).toContain(String(real.systems.lsm.speedup.toFixed(1))) // lsm 不连坐

    // 单块缺：只降 crosscheck 真件交叉印证，矩阵/三难向量/探针仍渲染真读数（同维不连坐）。
    const partial = JSON.parse(JSON.stringify(real))
    partial.systems.messageDelivery.crosscheck = null
    const dom2 = await runApp(partial)
    expect(dom2.els['mmd-crosscheck'].innerHTML).toContain('无真件交叉印证读数')   // crosscheck 缺 → 诚实降级
    expect(dom2.els['mmd-crosscheck'].innerHTML).not.toContain('createWal')        // 不编造铁证
    expect(dom2.els['mmd-probes'].innerHTML).toContain('data-probe="mmdOnce"')     // 其余探针照常
    expect(dom2.els['mmd-matrix'].innerHTML).toContain('class="mmd-cell lost"')    // 矩阵照常
    expect(dom2.els['mmd-trilemma'].innerHTML).toContain('data-k="lowOverhead"')   // 三难照常
  })
})

describe('KI-518 · delayQueue 延迟消息队列面板：三协议 × 六场景 + 三难向量 + 真件交叉印证', () => {
  const real = JSON.parse(readFileSync(resolve(ROOT, 'snapshot.json'), 'utf8'))
  it('真快照下渲染：矩阵/横条/判词/交叉印证/探针全部到位', async () => {
    const dom = await runApp(real)
    const dld = real.systems.delayQueue
    expect(dld).toBeTruthy()
    const matrix = dom.els['dld-matrix'].innerHTML
    expect(matrix).toContain('dld-mat-head')
    for (const row of dld.rows) expect(matrix).toContain('data-p="' + row.protocol + '"')
    for (const s of dld.config.scenarios) expect(matrix).toContain('data-s="' + s + '"')
    expect(matrix).toContain('class="dld-cell lost" data-p="TimingWheel" data-s="tickSkew"')
    expect(matrix).toContain('class="dld-cell ok" data-p="MinHeap" data-s="tickSkew"')
    const ladder = dom.els['dld-ladder'].innerHTML
    expect(ladder).toContain('data-p="MinHeap"')
    expect(ladder).toContain('dld-bar')
    expect(dom.els['dld-matrix-note'].textContent).toContain('不声称墙钟')
    const tri = dom.els['dld-trilemma'].innerHTML
    expect(tri).toContain('dld-vec-head')
    expect(tri).toContain('data-k="lowCost"')
    expect(tri).toContain('data-k="punctual"')
    expect(tri).toContain('data-k="sharedDurable"')
    expect(tri).toContain('data-p="TimingWheel" data-k="punctual" data-v="0"')
    expect(tri).toContain('data-p="MinHeap" data-k="punctual" data-v="1"')
    expect(tri).toContain('data-p="RedisZset" data-k="sharedDurable" data-v="1"')
    const cx = dom.els['dld-crosscheck'].innerHTML
    expect(cx).toContain('createHashRing')
    expect(cx).toContain('createRedisCache')
    expect(cx).toContain('createWal')
    expect(cx).toContain('createBus')
    expect(cx).toContain('createTokenBucket')
    expect(cx).toContain('createBPlusTree')
    expect(cx).toContain('createObjectPool')
    const probes = dom.els['dld-probes'].innerHTML
    expect(probes).toContain('data-verdict="minHeapZeroLateMs"')
    expect(probes).toContain('data-verdict="noUniversalWinner"')
    expect(dom.els['dld-trilemma-note'].textContent).toContain('TimingWheel=100')
  })

  it('systems.delayQueue 缺失 / crosscheck 缺失：真实降级、绝不伪造', async () => {
    const noDld = JSON.parse(JSON.stringify(real))
    noDld.systems.delayQueue = null
    const dom = await runApp(noDld)
    expect(dom.els['dld-matrix'].innerHTML).toContain('暂缺')
    expect(dom.els['dld-ladder'].innerHTML).toBe('')
    expect(dom.els['dld-trilemma'].innerHTML).toContain('暂缺')
    expect(dom.els['dld-crosscheck'].innerHTML).toBe('')
    expect(dom.els['dld-probes'].innerHTML).toBe('')
    expect(dom.els['dld-matrix-note'].textContent).toContain('systems.delayQueue 缺失')

    const partial = JSON.parse(JSON.stringify(real))
    partial.systems.delayQueue.crosscheck = null
    const dom2 = await runApp(partial)
    expect(dom2.els['dld-crosscheck'].innerHTML).toContain('真件交叉印证缺失')
    expect(dom2.els['dld-crosscheck'].innerHTML).not.toContain('createWal')
    expect(dom2.els['dld-probes'].innerHTML).toContain('data-verdict="noUniversalWinner"')
  })
})

describe('KI-520 · retryDlq 重试退避 × 死信面板：三协议 × 六场景 + 三难向量 + 真件交叉印证', () => {
  const real2 = JSON.parse(readFileSync(resolve(ROOT, 'snapshot.json'), 'utf8'))

  it('真快照下渲染：矩阵/横条/判词/交叉印证/探针全部到位', async () => {
    const dom = await runApp(real2)
    const rdlq = real2.systems.retryDlq
    expect(rdlq).toBeTruthy()
    const matrix = dom.els['rdq-matrix'].innerHTML
    expect(matrix).toContain('rdq-mat-head')
    for (const row of rdlq.rows) expect(matrix).toContain('data-p="' + row.protocol + '"')
    for (const s of rdlq.config.scenarios) expect(matrix).toContain('data-s="' + s + '"')
    expect(dom.els['rdq-ladder'].innerHTML).toContain('data-p="FullJitter"')
    const tri = dom.els['rdq-trilemma'].innerHTML
    expect(tri).toContain('rdq-vec-head')
    expect(tri).toContain('data-k="fastRecovery"')
    expect(tri).toContain('data-p="Immediate" data-k="fastRecovery" data-v="1"')
    expect(tri).toContain('data-p="Immediate" data-k="noStorm" data-v="0"')
    expect(tri).toContain('data-p="Exponential" data-k="noStorm" data-v="1"')
    expect(tri).toContain('data-p="FullJitter" data-k="noHerd" data-v="1"')
    const cx = dom.els['rdq-crosscheck'].innerHTML
    expect(cx).toContain('createMinHeapDelayQueue')
    expect(cx).toContain('createTokenBucket')
    expect(cx).toContain('createWal')
    expect(cx).toContain('createHashRing')
    expect(cx).toContain('createRedisCache')
    expect(cx).toContain('createBus')
    expect(cx).toContain('createObjectPool')
    const probes = dom.els['rdq-probes'].innerHTML
    expect(probes).toContain('data-verdict="noUniversalWinner"')
    expect(probes).toContain('data-verdict="immediateStorms"')
    expect(probes).toContain('data-verdict="exponentialNoStorm"')
  })

  it('systems.retryDlq 缺失 / 证据缺失：真实降级、绝不伪造', async () => {
    const noRdq = JSON.parse(JSON.stringify(real2))
    noRdq.systems.retryDlq = null
    const dom = await runApp(noRdq)
    expect(dom.els['rdq-matrix'].innerHTML).toContain('暂缺')
    expect(dom.els['rdq-ladder'].innerHTML).toBe('')
    expect(dom.els['rdq-trilemma'].innerHTML).toContain('暂缺')
    expect(dom.els['rdq-matrix-note'].textContent).toContain('systems.retryDlq 缺失')

    const partial = JSON.parse(JSON.stringify(real2))
    partial.systems.retryDlq.crosscheck = null
    const dom2 = await runApp(partial)
    expect(dom2.els['rdq-crosscheck'].innerHTML).toContain('真件交叉印证缺失')
    expect(dom2.els['rdq-crosscheck'].innerHTML).not.toContain('createWal')
    expect(dom2.els['rdq-probes'].innerHTML).toContain('data-verdict="noUniversalWinner"')
  })
})

describe('KI-523 · consumerGroup 消费者组 rebalance 面板：三协议 × 六场景 + 正交三难向量 + 九真件交叉印证', () => {
  const real3 = JSON.parse(readFileSync(resolve(ROOT, 'snapshot.json'), 'utf8'))

  it('真快照下渲染：矩阵/横条/判词/交叉印证/探针全部到位', async () => {
    const dom = await runApp(real3)
    const cgp = real3.systems.consumerGroup
    expect(cgp).toBeTruthy()
    const matrix = dom.els['cgp-matrix'].innerHTML
    expect(matrix).toContain('cgp-mat-head')
    for (const row of cgp.rows) expect(matrix).toContain('data-p="' + row.protocol + '"')
    for (const s of cgp.config.scenarios) expect(matrix).toContain('data-s="' + s + '"')
    // 正交布尔：每格标注直接读核心件 balanced/minimalMovement/cheap，与 trilemma 同源，绝不拿阈值重算。
    for (const row of cgp.rows) {
      for (const c of row.scenarios) {
        const expectState = c.starved ? 'starve' : c.balanced === false ? 'skew' : c.minimalMovement === false ? 'migrate' : c.cheap === false ? 'costly' : 'ok'
        expect(matrix).toContain('data-p="' + row.protocol + '" data-s="' + c.id + '" data-state="' + expectState + '"')
      }
    }
    // 默认向量与已知病征落点
    expect(cgp.vectors).toEqual({ Range: '001', RoundRobin: '100', Sticky: '110' })
    expect(matrix).toContain('data-p="Range" data-s="partitionSkew" data-state="skew"')
    expect(matrix).toContain('data-p="Range" data-s="memberJoin" data-state="migrate"')
    expect(matrix).toContain('data-p="RoundRobin" data-s="manyPartitions" data-state="costly"')
    expect(matrix).toContain('data-p="Sticky" data-s="steadyState" data-state="ok"')
    expect(dom.els['cgp-ladder'].innerHTML).toContain('data-p="Sticky"')
    const tri = dom.els['cgp-trilemma'].innerHTML
    expect(tri).toContain('cgp-vec-head')
    expect(tri).toContain('data-k="balanced"')
    expect(tri).toContain('data-p="Range" data-k="balanced" data-v="0"')
    expect(tri).toContain('data-p="Range" data-k="cheap" data-v="1"')
    expect(tri).toContain('data-p="RoundRobin" data-k="balanced" data-v="1"')
    expect(tri).toContain('data-p="Sticky" data-k="minimalMovement" data-v="1"')
    expect(tri).toContain('data-p="Sticky" data-k="cheap" data-v="0"')
    const cx = dom.els['cgp-crosscheck'].innerHTML
    for (const api of ['compareRemapping', 'createShardRouter.remapOn', 'createHashRing', 'createWal', 'createBus', 'createRedisCache', 'createObjectPool', 'createTokenBucket', 'createMinHeapDelayQueue']) {
      expect(cx).toContain(api)
    }
    const probes = dom.els['cgp-probes'].innerHTML
    expect(probes).toContain('data-verdict="noUniversalWinner"')
    expect(probes).toContain('data-verdict="rangeCheapest"')
    expect(probes).toContain('data-verdict="roundRobinBalanced"')
    expect(probes).toContain('data-verdict="stickyNotFreeLunch"')
    expect(probes).toContain('data-verdict="minimalMovementCausallyUnerasable"')
  })

  it('systems.consumerGroup 缺失 / 证据缺失：真实降级、绝不伪造', async () => {
    const noCgp = JSON.parse(JSON.stringify(real3))
    noCgp.systems.consumerGroup = null
    const dom = await runApp(noCgp)
    expect(dom.els['cgp-matrix'].innerHTML).toContain('暂缺')
    expect(dom.els['cgp-ladder'].innerHTML).toBe('')
    expect(dom.els['cgp-trilemma'].innerHTML).toContain('暂缺')
    expect(dom.els['cgp-matrix-note'].textContent).toContain('systems.consumerGroup 缺失')

    const partial = JSON.parse(JSON.stringify(real3))
    partial.systems.consumerGroup.crosscheck = null
    const dom2 = await runApp(partial)
    expect(dom2.els['cgp-crosscheck'].innerHTML).toContain('真件交叉印证缺失')
    expect(dom2.els['cgp-crosscheck'].innerHTML).not.toContain('createWal')
    expect(dom2.els['cgp-probes'].innerHTML).toContain('data-verdict="noUniversalWinner"')
  })
})

describe('KI-525 · backpressure 消费者组积压背压面板：四策略 × 六负载 + 正交三难向量 + Little′s Law 自证 + 十一真件交叉印证', () => {
  const realBp = JSON.parse(readFileSync(resolve(ROOT, 'snapshot.json'), 'utf8'))

  it('四策略 × 六负载矩阵状态字直读三布尔 + 指标梯 + 与三难向量同源', async () => {
    const dom = await runApp(realBp)
    const matrix = dom.els['bpc-matrix'].innerHTML
    expect(matrix).toContain('bpc-mat-head')
    expect(matrix).toContain('data-strategy="Backpressure"')
    expect(matrix).toContain('data-strategy="Buffering"')
    expect(matrix).toContain('data-strategy="Shedding"')
    expect(matrix).toContain('data-strategy="Scaling"')
    expect(matrix).toContain('data-s="steadyTrickle"')
    expect(matrix).toContain('data-s="memoryPressure"')
    // 每个格子都带 data-state，且值只来自三布尔判定的四类之一
    const states = [...matrix.matchAll(/data-state="([^"]+)"/g)].map((m: any) => m[1])
    expect(states.length).toBe(24) // 4 策略 × 6 场景
    for (const st of states) expect(['drop', 'stall', 'press', 'ok']).toContain(st)
    // 状态字与 cell 三布尔同源：Shedding 持续过载/下游停摆应判「丢」
    expect(matrix).toContain('class="bpc-cell drop"')
    // 指标梯四行
    const ladder = dom.els['bpc-ladder'].innerHTML
    for (const s of ['Backpressure', 'Buffering', 'Shedding', 'Scaling']) expect(ladder).toContain('data-strategy="' + s + '"')
    expect(ladder).toContain('bpc-bar')
    expect(dom.els['bpc-matrix-note'].textContent).toContain('三布尔')
  })

  it('三难向量四行 + 向量串 110/101/011/100 + 不封赢家 + 判词 chips', async () => {
    const dom = await runApp(realBp)
    const tri = dom.els['bpc-trilemma'].innerHTML
    expect(tri).toContain('bpc-vec-head')
    expect(tri).toContain('data-vec="110"') // Backpressure
    expect(tri).toContain('data-vec="101"') // Buffering
    expect(tri).toContain('data-vec="011"') // Shedding
    expect(tri).toContain('data-vec="100"') // Scaling
    expect(tri).toContain('data-k="noLoss"')
    expect(tri).toContain('data-k="lowLatency"')
    expect(tri).toContain('data-k="highThroughput"')
    const probes = dom.els['bpc-probes'].innerHTML
    expect(probes).toContain('data-verdict="noUniversalWinner"')
    expect(probes).toContain('data-verdict="highThroughputCausallyUnerasable"')
    expect(probes).toContain('data-verdict="backpressureRejectsBursts"')
    expect(probes).toContain('data-verdict="sheddingNotFreeLunch"')
    expect(probes).toContain('data-verdict="scalingStallsOnRebalance"')
    expect(dom.els['bpc-trilemma-note'].textContent).toContain('110')
  })

  it('Little′s Law 自证面板 + 十一真件交叉印证全部真 API 名落 DOM', async () => {
    const dom = await runApp(realBp)
    const ll = dom.els['bpc-littlelaw'].innerHTML
    expect(ll).toContain('data-ll="steadyHolds"')
    expect(ll).toContain('data-ll="steadyNontrivial"')
    expect(ll).toContain('data-ll="overloadBreaks"')
    expect(ll).toContain('λW')                     // L=λW 公式直陈
    expect(ll).toContain('bpc-ll-sample')          // 稳态样本读数
    const cx = dom.els['bpc-crosscheck'].innerHTML
    for (const api of [
      'createTokenBucket', 'createLeakyBucket', 'createRedisZsetDelayQueue', 'createMinHeapDelayQueue',
      'createWal', 'createShardedCache', 'createBloomFilter', 'createFullJitterBackoff',
      'createPackedCounters', 'createObjectPool', 'createBus',
    ]) expect(cx, '真件 ' + api + ' 必须落 DOM').toContain(api)
  })

  it('systems.backpressure 缺失 / 证据缺失：真实降级、绝不伪造', async () => {
    const noBp = JSON.parse(JSON.stringify(realBp))
    noBp.systems.backpressure = null
    const dom = await runApp(noBp)
    expect(dom.els['bpc-matrix'].innerHTML).toContain('暂缺')
    expect(dom.els['bpc-ladder'].innerHTML).toBe('')
    expect(dom.els['bpc-trilemma'].innerHTML).toContain('暂缺')
    expect(dom.els['bpc-matrix-note'].textContent).toContain('systems.backpressure 缺失')

    const partial = JSON.parse(JSON.stringify(realBp))
    partial.systems.backpressure.crosscheck = null
    const dom2 = await runApp(partial)
    expect(dom2.els['bpc-crosscheck'].innerHTML).toContain('真件交叉印证缺失')
    expect(dom2.els['bpc-crosscheck'].innerHTML).not.toContain('createWal')
    const noLl = JSON.parse(JSON.stringify(realBp))
    noLl.systems.backpressure.littleLaw = null
    const dom3 = await runApp(noLl)
    expect(dom3.els['bpc-littlelaw'].innerHTML).toContain('缺失')
  })

  it('第十九维 markup 与 CSS 契约：row-bpc 两面板 + bpc-* 视觉族 + reduced-motion 兜底', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
    const css = readFileSync(resolve(ROOT, 'styles.css'), 'utf8')
    expect(html).toContain('row-bpc')
    expect(html).toContain('id="bpc-matrix"')
    expect(html).toContain('id="bpc-littlelaw"')
    expect(html).toContain('第十九维')
    expect(css).toContain('.bpc-cell.drop')           // 零丢失破
    expect(css).toContain('.bpc-cell.stall')          // 低时延破
    expect(css).toContain('.bpc-cell.press')          // 高吞吐破
    expect(css).toContain('.bpc-cell.ok')             // 空真无病征
    expect(css).toContain('.bpc-bar > i')             // 指标梯
    expect(css).toContain('prefers-reduced-motion')   // 前庭友好兜底
    expect(css).toContain('@media (max-width: 720px)')
  })
})

describe('KI-526 · logCompaction 日志压缩面板：三策略 × 六场景 + 正交三难向量 + 回放边界守恒自证 + 十一真件交叉印证', () => {
  const realLc = JSON.parse(readFileSync(resolve(ROOT, 'snapshot.json'), 'utf8'))

  it('三策略 × 六场景矩阵状态字直读三布尔 + 指标梯 + 与三难向量同源', async () => {
    const dom = await runApp(realLc)
    const matrix = dom.els['lc-matrix'].innerHTML
    expect(matrix).toContain('lc-mat-head')
    for (const s of ['SizeTimeRetention', 'KeyCompaction', 'SnapshotPlusWal']) expect(matrix).toContain('data-strategy="' + s + '"')
    expect(matrix).toContain('data-s="steadyAppend"')
    expect(matrix).toContain('data-s="retentionPressure"')
    const states = [...matrix.matchAll(/data-state="([^"]+)"/g)].map((m: any) => m[1])
    expect(states.length).toBe(18) // 3 策略 × 6 场景
    for (const st of states) expect(['occupy', 'drop', 'stall', 'ok']).toContain(st)
    expect(matrix).toContain('class="lc-cell occupy"')  // SnapshotPlusWal 双写放大
    expect(matrix).toContain('class="lc-cell drop"')    // SizeTimeRetention 慢消费者丢历史
    const ladder = dom.els['lc-ladder'].innerHTML
    for (const s of ['SizeTimeRetention', 'KeyCompaction', 'SnapshotPlusWal']) expect(ladder).toContain('data-strategy="' + s + '"')
    expect(ladder).toContain('lc-bar')
    expect(dom.els['lc-matrix-note'].textContent).toContain('三布尔')
  })

  it('三难向量三行 + 向量串 101/110/011 + 不封赢家 + 判词 chips', async () => {
    const dom = await runApp(realLc)
    const tri = dom.els['lc-trilemma'].innerHTML
    expect(tri).toContain('lc-vec-head')
    expect(tri).toContain('data-vec="101"') // SizeTimeRetention
    expect(tri).toContain('data-vec="110"') // KeyCompaction
    expect(tri).toContain('data-vec="011"') // SnapshotPlusWal
    for (const k of ['compactFootprint', 'replayCompleteness', 'fastRecovery']) expect(tri).toContain('data-k="' + k + '"')
    const probes = dom.els['lc-probes'].innerHTML
    expect(probes).toContain('data-verdict="noUniversalWinner"')
    expect(probes).toContain('data-verdict="fastRecoveryCausallyUnerasable"')
    expect(probes).toContain('data-verdict="retentionDropsSlowConsumer"')
    expect(probes).toContain('data-verdict="snapshotExactlyOnce"')
    expect(probes).toContain('data-verdict="replayBoundaryFalsifiable"')
    expect(dom.els['lc-trilemma-note'].textContent).toContain('101')
  })

  it('回放边界守恒面板 + 十一真件交叉印证全部真 API 名落 DOM', async () => {
    const dom = await runApp(realLc)
    const rb = dom.els['lc-replay'].innerHTML
    expect(rb).toContain('data-rb="holds"')
    expect(rb).toContain('data-rb="nontrivial"')
    expect(rb).toContain('data-rb="falsifiable"')
    expect(rb).toContain('data-rb-tamper="replayOps"')
    expect(rb).toContain('data-rb-tamper="walGap"')
    expect(rb).toContain('data-rb-tamper="tombstone"')
    expect(rb).toContain('replayOps')
    const cx = dom.els['lc-crosscheck'].innerHTML
    for (const api of [
      'createWal', 'createRedisZsetDelayQueue', 'createMinHeapDelayQueue', 'createShardedCache',
      'createBloomFilter', 'createPackedCounters', 'createTokenBucket', 'createObjectPool',
      'createBus', 'createHashRing', 'createFullJitterBackoff',
    ]) expect(cx, '真件 ' + api + ' 必须落 DOM').toContain(api)
  })

  it('systems.logCompaction 缺失 / 证据缺失：真实降级、绝不伪造', async () => {
    const noLc = JSON.parse(JSON.stringify(realLc))
    noLc.systems.logCompaction = null
    const dom = await runApp(noLc)
    expect(dom.els['lc-matrix'].innerHTML).toContain('暂缺')
    expect(dom.els['lc-ladder'].innerHTML).toBe('')
    expect(dom.els['lc-trilemma'].innerHTML).toContain('暂缺')
    expect(dom.els['lc-matrix-note'].textContent).toContain('systems.logCompaction 缺失')
    const partial = JSON.parse(JSON.stringify(realLc))
    partial.systems.logCompaction.crosscheck = null
    const dom2 = await runApp(partial)
    expect(dom2.els['lc-crosscheck'].innerHTML).toContain('真件交叉印证缺失')
    expect(dom2.els['lc-crosscheck'].innerHTML).not.toContain('createWal')
    const noRb = JSON.parse(JSON.stringify(realLc))
    noRb.systems.logCompaction.replayBoundary = null
    const dom3 = await runApp(noRb)
    expect(dom3.els['lc-replay'].innerHTML).toContain('缺失')
  })

  it('第二十维 markup 与 CSS 契约：row-lc 两面板 + lc-* 视觉族 + reduced-motion 兜底', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
    const css = readFileSync(resolve(ROOT, 'styles.css'), 'utf8')
    expect(html).toContain('row-lc')
    expect(html).toContain('id="lc-matrix"')
    expect(html).toContain('id="lc-replay"')
    expect(html).toContain('第二十维')
    expect(css).toContain('.lc-cell.occupy')          // 省空间破
    expect(css).toContain('.lc-cell.drop')            // 回放完整破
    expect(css).toContain('.lc-cell.stall')           // 恢复快破
    expect(css).toContain('.lc-cell.ok')              // 空真无病征
    expect(css).toContain('.lc-bar > i')              // 指标梯
    expect(css).toContain('.lc-replay')               // 回放边界自证栏
    expect(css).toContain('prefers-reduced-motion')   // 前庭友好兜底
    expect(css).toContain('@media (max-width: 720px)')
  })
})

describe('KI-527 · bloomFilter 布隆/布谷鸟/计数布隆面板：三策略 × 六场景 + 正交三难向量 + FP ceiling 双路自证 + 十一真件交叉印证', () => {
  const realBf = JSON.parse(readFileSync(resolve(ROOT, 'snapshot.json'), 'utf8'))

  it('三策略 × 六场景矩阵状态字直读 cell 三布尔 + 指标梯 + 软肋字（肥/崖/缺删）与三难同源', async () => {
    const dom = await runApp(realBf)
    const matrix = dom.els['blf-matrix'].innerHTML
    expect(matrix).toContain('blf-mat-head')
    for (const s of ['Bloom', 'CountingBloom', 'Cuckoo']) expect(matrix).toContain('data-strategy="' + s + '"')
    expect(matrix).toContain('data-s="steadyFilter"')
    expect(matrix).toContain('data-s="overAdmitted"')
    const states = [...matrix.matchAll(/data-state="([^"]+)"/g)].map((m: any) => m[1])
    expect(states.length).toBe(18) // 3 策略 × 6 场景
    for (const st of states) expect(['bloat', 'wall', 'nodel', 'ok']).toContain(st)
    expect(matrix).toContain('class="blf-cell nodel"')  // Bloom 缺删（deleteCycle）
    expect(matrix).toContain('class="blf-cell bloat"')  // CountingBloom 计数吃空间
    expect(matrix).toContain('class="blf-cell wall"')   // Cuckoo 高装载崖壁
    const ladder = dom.els['blf-ladder'].innerHTML
    for (const s of ['Bloom', 'CountingBloom', 'Cuckoo']) expect(ladder).toContain('data-strategy="' + s + '"')
    expect(ladder).toContain('blf-bar')
    expect(dom.els['blf-matrix-note'].textContent).toContain('三布尔')
  })

  it('三难向量三行 + 向量串 110/011/101 + 不封赢家 + 因果锁/FP 判词 chips', async () => {
    const dom = await runApp(realBf)
    const tri = dom.els['blf-trilemma'].innerHTML
    expect(tri).toContain('blf-vec-head')
    expect(tri).toContain('data-vec="110"') // Bloom
    expect(tri).toContain('data-vec="011"') // CountingBloom
    expect(tri).toContain('data-vec="101"') // Cuckoo
    for (const k of ['compactFootprint', 'insertsNeverFail', 'deleteSupport']) expect(tri).toContain('data-k="' + k + '"')
    const probes = dom.els['blf-probes'].innerHTML
    for (const k of ['noUniversalWinner', 'compactFootprintCausallyUnerasable', 'fpCeilingHolds', 'bloomDeleteFree', 'cuckooStashWall']) {
      expect(probes, '判词 chip ' + k + ' 必须落 DOM').toContain('data-verdict="' + k + '"')
    }
    expect(dom.els['blf-trilemma-note'].textContent).toContain('Cuckoo=101')
    expect(dom.els['blf-trilemma-note'].textContent).not.toContain('Cuckoo=001')
  })

  it('FP ceiling 双路自证栏 + 三路篡改真喂回标记 + 十一真件交叉印证全部真 API 名落 DOM', async () => {
    const dom = await runApp(realBf)
    const vf = dom.els['blf-verif'].innerHTML
    expect(vf).toContain('data-rb="holds"')
    expect(vf).toContain('data-rb="nontrivial"')
    expect(vf).toContain('data-rb="falsifiable"')
    expect(vf).toContain('data-rb-tamper="trustConfig"')
    expect(vf).toContain('data-rb-tamper="zeroFpr"')
    expect(vf).toContain('data-rb-tamper="skipProbe"')
    const cx = dom.els['blf-crosscheck'].innerHTML
    for (const api of [
      'compareRemapping', 'createShardRouter', 'createHashRing', 'createWal', 'createBus',
      'createRedisCache', 'createObjectPool', 'createTokenBucket', 'createMinHeapDelayQueue',
      'createPackedCounters', 'createFullJitterBackoff',
    ]) expect(cx, '真件 ' + api + ' 必须落 DOM').toContain(api)
  })

  it('systems.bloomFilter 缺失 / 交叉印证缺失：真实降级、绝不伪造', async () => {
    const noBf = JSON.parse(JSON.stringify(realBf))
    noBf.systems.bloomFilter = null
    const dom = await runApp(noBf)
    expect(dom.els['blf-matrix'].innerHTML).toContain('暂缺')
    expect(dom.els['blf-ladder'].innerHTML).toBe('')
    expect(dom.els['blf-trilemma'].innerHTML).toContain('暂缺')
    expect(dom.els['blf-matrix-note'].textContent).toContain('systems.bloomFilter 缺失')
    const partial = JSON.parse(JSON.stringify(realBf))
    partial.systems.bloomFilter.crosscheck = null
    const dom2 = await runApp(partial)
    expect(dom2.els['blf-crosscheck'].innerHTML).toContain('真件交叉印证缺失')
    expect(dom2.els['blf-crosscheck'].innerHTML).not.toContain('createHashRing')
  })

  it('第二十一维 markup 与 CSS 契约：row-blf 两面板 + blf-* 视觉族 + 向量真值 + reduced-motion 兜底', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
    const css = readFileSync(resolve(ROOT, 'styles.css'), 'utf8')
    expect(html).toContain('row-blf')
    expect(html).toContain('id="blf-matrix"')
    expect(html).toContain('id="blf-verif"')
    expect(html).toContain('Cuckoo=101')
    expect(html).not.toContain('Cuckoo=001')
    expect(css).toContain('.blf-cell.bloat')            // 空间肥
    expect(css).toContain('.blf-cell.wall')             // 高装载崖壁
    expect(css).toContain('.blf-cell.nodel')            // 不支持删除
    expect(css).toContain('.blf-cell.ok')               // 空真无病征
    expect(css).toContain('.blf-bar > i')               // 指标梯
    expect(css).toContain('.blf-verif')                 // FP ceiling 自证栏
    expect(css).toContain('prefers-reduced-motion')     // 前庭友好兜底
    expect(css).toContain('@media (max-width: 720px)')
  })
})

describe('KI-528 · cacheReplacement 缓存替换面板：三策略 × 六场景 + 正交三难向量 + 双路自证 + 十一真件交叉印证', () => {
  const realCr = JSON.parse(readFileSync(resolve(ROOT, 'snapshot.json'), 'utf8'))

  it('三策略 × 六场景矩阵状态字直读 cell 三布尔 + 指标梯 + 软肋字（污/抖/僵）与三难同源', async () => {
    const dom = await runApp(realCr)
    const matrix = dom.els['cr-matrix'].innerHTML
    expect(matrix).toContain('cr-mat-head')
    for (const s of ['LRU', '2Q', 'ARC']) expect(matrix).toContain('data-strategy="' + s + '"')
    expect(matrix).toContain('data-s="uniformHot"')
    expect(matrix).toContain('data-s="zipfDrift"')
    const states = [...matrix.matchAll(/data-state="([^"]+)"/g)].map((m: any) => m[1])
    expect(states.length).toBe(18) // 3 策略 × 6 场景
    for (const st of states) expect(['block', 'unstable', 'adapt', 'ok']).toContain(st)
    expect(matrix).toContain('class="cr-cell block"')     // LRU scanFeast 顺扫污染
    expect(matrix).toContain('class="cr-cell unstable"')  // ARC 命中抖动
    expect(matrix).toContain('class="cr-cell adapt"')     // LRU/2Q 僵（不自适应）
    const ladder = dom.els['cr-ladder'].innerHTML
    for (const s of ['LRU', '2Q', 'ARC']) expect(ladder).toContain('data-strategy="' + s + '"')
    expect(ladder).toContain('cr-bar')
    expect(dom.els['cr-matrix-note'].textContent).toContain('三布尔')
  })

  it('三难向量三行 + 向量串 010/110/101 + 不封赢家 + 因果锁/同源/双路判词 chips', async () => {
    const dom = await runApp(realCr)
    const tri = dom.els['cr-trilemma'].innerHTML
    expect(tri).toContain('cr-vec-head')
    expect(tri).toContain('data-vec="010"') // LRU
    expect(tri).toContain('data-vec="110"') // 2Q
    expect(tri).toContain('data-vec="101"') // ARC
    for (const k of ['scanResistance', 'stableHitRate', 'adaptiveBalance']) expect(tri).toContain('data-k="' + k + '"')
    const probes = dom.els['cr-probes'].innerHTML
    for (const k of ['noUniversalWinner', 'vectorFromTrilemma', 'dualSweepHolds', 'lru_unhinted', 'arc_adaptive']) {
      expect(probes, '判词 chip ' + k + ' 必须落 DOM').toContain('data-verdict="' + k + '"')
    }
    expect(dom.els['cr-trilemma-note'].textContent).toContain('ARC=101')
    expect(dom.els['cr-trilemma-note'].textContent).not.toContain('Bloom') // 不串抄 KI-527 文案
  })

  it('verifyDualSweep 双路自证栏 + 三路篡改真喂回标记 + 十一真件交叉印证全部真 API 名落 DOM', async () => {
    const dom = await runApp(realCr)
    const vf = dom.els['cr-verif'].innerHTML
    expect(vf).toContain('data-rb="holds"')
    expect(vf).toContain('data-rb="nontrivial"')
    expect(vf).toContain('data-rb="falsifiable"')
    expect(vf).toContain('data-rb-tamper="laneATraceCorrupted"')
    expect(vf).toContain('data-rb-tamper="laneBTraceCorrupted"')
    expect(vf).toContain('data-rb-tamper="laneBSizedNull"')
    const cx = dom.els['cr-crosscheck'].innerHTML
    for (const api of [
      'compareRemapping', 'createShardRouter', 'createHashRing', 'createWal', 'createBus',
      'createRedisCache', 'createObjectPool', 'createTokenBucket', 'createMinHeapDelayQueue',
      'createPackedCounters', 'createFullJitterBackoff',
    ]) expect(cx, '真件 ' + api + ' 必须落 DOM').toContain(api)
    expect(cx).toContain('jitterSpread')
  })

  it('systems.cacheReplacement 缺失 / 交叉印证缺失：真实降级、绝不伪造', async () => {
    const noCr = JSON.parse(JSON.stringify(realCr))
    noCr.systems.cacheReplacement = null
    const dom = await runApp(noCr)
    expect(dom.els['cr-matrix'].innerHTML).toContain('暂缺')
    expect(dom.els['cr-ladder'].innerHTML).toBe('')
    expect(dom.els['cr-trilemma'].innerHTML).toContain('暂缺')
    expect(dom.els['cr-matrix-note'].textContent).toContain('systems.cacheReplacement 缺失')
    const partial = JSON.parse(JSON.stringify(realCr))
    partial.systems.cacheReplacement.crosscheck = null
    const dom2 = await runApp(partial)
    expect(dom2.els['cr-crosscheck'].innerHTML).toContain('真件交叉印证缺失')
    expect(dom2.els['cr-crosscheck'].innerHTML).not.toContain('createHashRing')
  })

  it('第二十二维 markup 与 CSS 契约：row-cr 两面板 + cr-* 视觉族 + 向量真值 + reduced-motion 兜底', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
    const css = readFileSync(resolve(ROOT, 'styles.css'), 'utf8')
    expect(html).toContain('row-cr')
    expect(html).toContain('id="cr-matrix"')
    expect(html).toContain('id="cr-verif"')
    expect(html).toContain('LRU=010 / 2Q=110 / ARC=101')
    expect(css).toContain('.cr-cell.block')            // 顺扫污染
    expect(css).toContain('.cr-cell.unstable')         // 命中抖动
    expect(css).toContain('.cr-cell.adapt')            // 不自适应
    expect(css).toContain('.cr-cell.ok')               // 空真无病征
    expect(css).toContain('.cr-bar > i')               // 指标梯
    expect(css).toContain('.cr-verif')                 // 双路自证栏
    expect(css).toContain('prefers-reduced-motion')    // 前庭友好兜底
    expect(css).toContain('@media (max-width: 720px)')
  })
})

describe('KI-529 · streamWindow 流式窗口面板：三策略 × 六场景 + 正交三难向量 + 双路自证 + 十一真件交叉印证', () => {
  const realSw = JSON.parse(readFileSync(resolve(ROOT, 'snapshot.json'), 'utf8'))

  it('三策略 × 六场景矩阵状态字直读 cell 三布尔 + 指标梯 + 软肋字（缺/迟/胀）与三难同源', async () => {
    const dom = await runApp(realSw)
    const matrix = dom.els['sw-matrix'].innerHTML
    expect(matrix).toContain('sw-mat-head')
    for (const s of ['Tumbling', 'Sliding', 'Session']) expect(matrix).toContain('data-strategy="' + s + '"')
    expect(matrix).toContain('data-s="alignedBursts"')
    expect(matrix).toContain('data-s="lateBeyondGap"')
    const states = [...matrix.matchAll(/data-state="([^"]+)"/g)].map((m: any) => m[1])
    expect(states.length).toBe(18) // 3 策略 × 6 场景
    for (const st of states) expect(['pair', 'late', 'bloat', 'ok']).toContain(st)
    expect(matrix).toContain('class="sw-cell pair"')   // Tumbling boundaryStraddle 跨边界必切
    expect(matrix).toContain('class="sw-cell late"')   // Session lateBeyondGap 跨 gap 迟到
    expect(matrix).toContain('class="sw-cell bloat"')  // Sliding 重叠状态放大
    const ladder = dom.els['sw-ladder'].innerHTML
    for (const s of ['Tumbling', 'Sliding', 'Session']) expect(ladder).toContain('data-strategy="' + s + '"')
    expect(ladder).toContain('sw-bar')
    expect(dom.els['sw-matrix-note'].textContent).toContain('三布尔')
  })

  it('三难向量三行 + 向量串 011/110/101 + 不封赢家 + 判词 chips', async () => {
    const dom = await runApp(realSw)
    const tri = dom.els['sw-trilemma'].innerHTML
    expect(tri).toContain('sw-vec-head')
    expect(tri).toContain('data-vec="011"') // Tumbling
    expect(tri).toContain('data-vec="110"') // Sliding
    expect(tri).toContain('data-vec="101"') // Session
    for (const k of ['resultCompleteness', 'lateTolerance', 'stateEfficiency']) expect(tri).toContain('data-k="' + k + '"')
    const probes = dom.els['sw-probes'].innerHTML
    for (const k of ['noUniversalWinner', 'tumbling_crossBoundaryLoss', 'sliding_stateAmplified', 'session_gapFragile']) {
      expect(probes, '判词 chip ' + k + ' 必须落 DOM').toContain('data-verdict="' + k + '"')
    }
    expect(dom.els['sw-trilemma-note'].textContent).toContain('Tumbling=011')
    expect(dom.els['sw-trilemma-note'].textContent).not.toContain('LRU=010') // 不串抄 KI-528 文案
  })

  it('verifyWatermarkMonotonicity 双路自证栏 + 三路篡改真喂回标记 + 十一真件交叉印证全部真 API 名落 DOM', async () => {
    const dom = await runApp(realSw)
    const vf = dom.els['sw-verif'].innerHTML
    expect(vf).toContain('data-rb="holds"')
    expect(vf).toContain('data-rb="nontrivial"')
    expect(vf).toContain('data-rb="falsifiable"')
    expect(vf).toContain('data-rb-tamper="watermarkInverted"')
    expect(vf).toContain('data-rb-tamper="dispositionTampered"')
    expect(vf).toContain('data-rb-tamper="emptySet"')
    const cx = dom.els['sw-crosscheck'].innerHTML
    for (const api of [
      'compareRemapping', 'createShardRouter', 'createHashRing', 'createWal', 'createBus',
      'createRedisCache', 'createObjectPool', 'createTokenBucket', 'createMinHeapDelayQueue',
      'createPackedCounters', 'createFullJitterBackoff', 'verifyWatermarkMonotonicity',
    ]) expect(cx, '真件 ' + api + ' 必须落 DOM').toContain(api)
    expect(cx).toContain('jitterSpread')
  })

  it('systems.streamWindow 缺失 / 交叉印证缺失：真实降级、绝不伪造', async () => {
    const noSw = JSON.parse(JSON.stringify(realSw))
    noSw.systems.streamWindow = null
    const dom = await runApp(noSw)
    expect(dom.els['sw-matrix'].innerHTML).toContain('暂缺')
    expect(dom.els['sw-ladder'].innerHTML).toBe('')
    expect(dom.els['sw-trilemma'].innerHTML).toContain('暂缺')
    expect(dom.els['sw-matrix-note'].textContent).toContain('systems.streamWindow 缺失')
    const partial = JSON.parse(JSON.stringify(realSw))
    partial.systems.streamWindow.crosscheck = null
    const dom2 = await runApp(partial)
    expect(dom2.els['sw-crosscheck'].innerHTML).toContain('真件交叉印证缺失')
    expect(dom2.els['sw-crosscheck'].innerHTML).not.toContain('createHashRing')
  })

  it('第二十三维 markup 与 CSS 契约：row-sw 两面板 + sw-* 视觉族 + 向量真值 + reduced-motion 兜底', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
    const css = readFileSync(resolve(ROOT, 'styles.css'), 'utf8')
    expect(html).toContain('row-sw')
    expect(html).toContain('id="sw-matrix"')
    expect(html).toContain('id="sw-verif"')
    expect(html).toContain('Tumbling=011 / Sliding=110 / Session=101')
    expect(css).toContain('.sw-cell.pair')            // 跨边界结果缺
    expect(css).toContain('.sw-cell.late')            // 迟到拒绝
    expect(css).toContain('.sw-cell.bloat')           // 状态膨胀
    expect(css).toContain('.sw-cell.ok')              // 空真无病征
    expect(css).toContain('.sw-bar > i')              // 指标梯
    expect(css).toContain('.sw-verif')                // 双路自证栏
    expect(css).toContain('prefers-reduced-motion')   // 前庭友好兜底
    expect(css).toContain('@media (max-width: 720px)')
  })

  it('第二十四维 hll-* 面板：系统集成落落 DOM、三向量与 hll-* CSS 族一致', async () => {
    const full = JSON.parse(JSON.stringify(realSw as any))
    const dom = await runApp(full)
    // 矩阵行：三策略行（cell 直接三布尔渲染）
    for (const proto of ['ExactSet', 'HyperLogLog', 'LinearCounting']) {
      expect(dom.els['hll-matrix'].innerHTML).toContain(proto)
      expect(dom.els['hll-matrix'].innerHTML).toContain('data-strategy="' + proto + '"')
    }
    // 三难向量：101/110/010 直接落 DOM
    expect(dom.els['hll-trilemma'].innerHTML).toContain('101')
    expect(dom.els['hll-trilemma'].innerHTML).toContain('110')
    expect(dom.els['hll-trilemma'].innerHTML).toContain('010')
    // 梯度条 bar 包含策略行
    expect(dom.els['hll-ladder'].innerHTML).toContain('ExactSet')
    expect(dom.els['hll-ladder'].innerHTML).toContain('HyperLogLog')
    expect(dom.els['hll-ladder'].innerHTML).toContain('LinearCounting')
    // 双路自证栏
    expect(dom.els['hll-verif'].innerHTML).toContain('ExactSet')
    expect(dom.els['hll-verif'].innerHTML).toContain('LinearCounting')
  })

  it('第二十四维 hll-* 交叉印证真件落 DOM：createMinHeapDelayQueue / createPackedCounters / createWal / createBus 全名', async () => {
    const dom = await runApp(JSON.parse(JSON.stringify(realSw as any)))
    for (const nm of ['createMinHeapDelayQueue', 'createPackedCounters', 'createWal', 'createBus', 'createRedisCache', 'createHashRing', 'createShardRouter', 'createTokenBucket', 'createObjectPool', 'createFullJitterBackoff']) {
      expect(dom.els['hll-crosscheck'].innerHTML, '落 DOM 真件：' + nm).toContain(nm)
    }
  })

  it('第二十四维 hll-* chips：noUniversalWinner=true —— 判词「三向量互异、无全局赢家、恰好各缺一维」', async () => {
    const dom = await runApp(JSON.parse(JSON.stringify(realSw as any)))
    expect(dom.els['hll-probes'].innerHTML).toContain('noUniversalWinner')
    expect(dom.els['hll-probes'].innerHTML).toContain('三向量互异')
  })

  it('systems.hyperLogLog 缺失：hll-matrix/ladder/trilemma 真实降级、绝不伪造', async () => {
    const noHll = JSON.parse(JSON.stringify(realSw as any))
    noHll.systems.hyperLogLog = null
    const dom = await runApp(noHll)
    expect(dom.els['hll-matrix'].innerHTML).toContain('暂缺')
    expect(dom.els['hll-ladder'].innerHTML).toBe('')
    expect(dom.els['hll-trilemma'].innerHTML).toContain('暂缺')
    expect(dom.els['hll-matrix-note'].textContent).toContain('systems.hyperLogLog 缺失')
    const partial = JSON.parse(JSON.stringify(realSw as any))
    partial.systems.hyperLogLog.crosscheck = null
    const dom2 = await runApp(partial)
    expect(dom2.els['hll-crosscheck'].innerHTML).toContain('真件交叉印证缺失')
    expect(dom2.els['hll-crosscheck'].innerHTML).not.toContain('createHashRing')
  })

  it('第二十四维 markup 与 CSS 契约：row-hll 两面板 + hll-* 视觉族 + 向量真值 + reduced-motion 兜底', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
    const css = readFileSync(resolve(ROOT, 'styles.css'), 'utf8')
    expect(html).toContain('row-hll')
    expect(html).toContain('id="hll-matrix"')
    expect(html).toContain('id="hll-verif"')
    expect(html).toContain('ExactSet=101 / HyperLogLog=110 / LinearCounting=010')
    expect(css).toContain('.hll-cell.approx')        // ≈ estimate 金
    expect(css).toContain('.hll-cell.exact')         // 精确 jade
    expect(css).toContain('.hll-cell.sat')           // 饱和失真 wine
    expect(css).toContain('.hll-bar > i')            // 指标梯
    expect(css).toContain('.hll-verif')              // 双路自证栏
    expect(css).toContain('prefers-reduced-motion')  // 前庭友好兜底
    expect(css).toContain('@media (max-width: 720px)')
  })

  it('KI-530 可证伪 DOM：18 cell 状态字（sat/exact/approx）+ verifySparseEstimate 双路自证 + 三路篡改真喂回标记 + 第 11 真件', async () => {
    const dom = await runApp(JSON.parse(JSON.stringify(realSw as any)))
    const matrix = dom.els['hll-matrix'].innerHTML
    const states = [...matrix.matchAll(/data-state="([^"]+)"/g)].map((m: any) => m[1])
    expect(states.length).toBe(18) // 3 估计器 × 6 场景
    for (const st of states) expect(['sat', 'exact', 'approx']).toContain(st)
    expect(matrix).toContain('class="hll-cell sat"')    // LinearCounting highFill 饱和
    expect(matrix).toContain('class="hll-cell exact"')  // ExactSet 精确
    expect(matrix).toContain('class="hll-cell approx"') // HyperLogLog ε 带内
    const vf = dom.els['hll-verif'].innerHTML
    expect(vf).toContain('data-rb="holds"')
    expect(vf).toContain('data-rb="nontrivial"')
    expect(vf).toContain('data-rb="falsifiable"')
    expect(vf).toContain('data-rb-tamper="registerCorrupted"')
    expect(vf).toContain('data-rb-tamper="bitsTooBig"')
    expect(vf).toContain('data-rb-tamper="emptySet"')
    const cx = dom.els['hll-crosscheck'].innerHTML
    for (const api of ['compareRemapping', 'createShardRouter', 'createHashRing', 'createWal', 'createBus',
      'createRedisCache', 'createObjectPool', 'createTokenBucket', 'createMinHeapDelayQueue',
      'createPackedCounters', 'createFullJitterBackoff', 'verifySparseEstimate']) {
      expect(cx, '真件 ' + api + ' 必须落 DOM').toContain(api)
    }
    expect(cx).toContain('jitterSpread')
  })

  // ============ KI-531 CRDT 最终一致冲突消解三策略 · 前端第二十五维 ============
  it('第二十五维 crdt-* 面板：三策略真落 DOM、向量 011/100/110 与维序 [SEC/expressiveness/compact] 一致', async () => {
    const dom = await runApp(JSON.parse(JSON.stringify(realSw as any)))
    const matrix = dom.els['crdt-matrix'].innerHTML
    for (const proto of ['LWWRegister', 'GCounter', 'OrSet']) {
      expect(matrix, '矩阵策略行 ' + proto).toContain('data-strategy="' + proto + '"')
    }
    // 18 cell 状态字：3 策略 × 6 场景，只认 {乱,锁,胀,✓}
    const states = [...matrix.matchAll(/data-state="([^"]+)"/g)].map((m: any) => m[1])
    expect(states.length).toBe(18)
    for (const st of states) expect(['live', 'drop', 'diverge', 'na']).toContain(st)
    const tri = dom.els['crdt-trilemma'].innerHTML
    // 三维表头顺序与向量拼接顺序一致：expressiveness 在 compactMetadata 之前
    expect(tri).toContain('data-k="strongEventualConvergence"')
    expect(tri).toContain('data-k="expressiveness"')
    expect(tri).toContain('data-k="compactMetadata"')
    expect(tri).toContain('data-vec="011"') // LWWRegister
    expect(tri).toContain('data-vec="100"') // GCounter
    expect(tri).toContain('data-vec="110"') // OrSet
    expect(dom.els['crdt-ladder'].innerHTML).toContain('LWWRegister')
    expect(dom.els['crdt-ladder'].innerHTML).toContain('GCounter')
    expect(dom.els['crdt-ladder'].innerHTML).toContain('OrSet')
  })

  it('KI-531 可证伪 DOM：三路篡改真喂回标记 + 双路自证 + 三因果锁 chips + 11 真件 21 键落 DOM', async () => {
    const dom = await runApp(JSON.parse(JSON.stringify(realSw as any)))
    const vf = dom.els['crdt-verif'].innerHTML
    expect(vf).toContain('data-rb="secStrictAllConverge"')
    expect(vf).toContain('data-rb="decrementCausallyUnerasable"')
    expect(vf).toContain('data-rb="orSetIsAddWins"')
    expect(vf).toContain('data-rb="holds"')            // 双路自证
    expect(vf).toContain('data-rb="nontrivial"')
    expect(vf).toContain('data-rb-tamper="dropReplica"')
    expect(vf).toContain('data-rb-tamper="reverseLwwDecision"')
    expect(vf).toContain('data-rb-tamper="emptySet"')
    const probes = dom.els['crdt-probes'].innerHTML
    for (const lock of ['lwwConcurrentLossCausallyUnerasable', 'decrementCausallyUnerasable',
      'orSetTagHistoryCausallyUnerasable', 'noUniversalWinner', 'orSetIsAddWins']) {
      expect(probes, '因果锁 chip ' + lock).toContain('data-verdict="' + lock + '"')
    }
    expect(probes).toContain('三向量互异')
    const cx = dom.els['crdt-crosscheck'].innerHTML
    for (const api of ['compareRemapping', 'createShardRouter', 'createHashRing', 'createWal', 'createBus',
      'createRedisCache', 'createObjectPool', 'createTokenBucket', 'createMinHeapDelayQueue',
      'createPackedCounters', 'createFullJitterBackoff', 'verifyConvergence']) {
      expect(cx, '真件 ' + api + ' 必须落 DOM').toContain(api)
    }
    expect(cx).toContain('jitterSpread')
    // 诚实口径：不再出现旧 remove-wins / 旧向量 / 旧三开关字样
    expect(dom.els['crdt-trilemma-note'].textContent).not.toContain('remove-wins')
    expect(dom.els['crdt-trilemma-note'].textContent).toContain('add-wins')
  })

  it('第二十五维 markup/CSS 契约 + systems.crdt 缺失真实降级（前端第二十五维）', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
    const css = readFileSync(resolve(ROOT, 'styles.css'), 'utf8')
    expect(html).toContain('row-crdt')
    expect(html).toContain('id="crdt-matrix"')
    expect(html).toContain('id="crdt-verif"')
    expect(html).toContain('LWWRegister=011 / GCounter=100 / OrSet=110')
    expect(css).toContain('.crdt-cell.drop')       // 乱/锁 wine
    expect(css).toContain('.crdt-cell.diverge')    // 胀 金
    expect(css).toContain('.crdt-cell.live')       // ✓ jade
    expect(css).toContain('.crdt-flag.yes')
    expect(css).toContain('.crdt-bar > i')         // 元数据梯
    expect(css).toContain('.crdt-verif')           // 可证伪栏
    expect(css).toContain('@media')
  })

  it('systems.crdt 缺失：crdt-matrix/trilemma 真实降级、绝不伪造第二套数', async () => {
    const noCrdt = JSON.parse(JSON.stringify(realSw as any))
    noCrdt.systems.crdt = null
    const dom = await runApp(noCrdt)
    expect(dom.els['crdt-matrix'].innerHTML).toContain('暂缺')
    expect(dom.els['crdt-trilemma'].innerHTML).toContain('暂缺')
    expect(dom.els['crdt-matrix-note'].textContent).toContain('systems.crdt 缺失')
  })

  // ============ KI-532 前端第二十六维 · SB 族（4 腿）============
  it('第二十六维真快照渲染：sb 矩阵 18 cell + 三难向量 001/110/101 + 三策略状态字（前端第二十六维）', async () => {
    const dom = await runApp(realSw)
    const matrix = dom.els['sb-matrix'].innerHTML
    expect(matrix).toContain('sb-mat-head')
    for (const p of ['BulkWriter', 'ChunkedWriter', 'SkipRetryWriter']) {
      expect(matrix).toContain('data-strategy="' + p + '"')
    }
    for (const sc of ['cleanRun', 'poisonOne', 'restartMidway', 'burstLoad', 'skipSaturation', 'cleanRerun']) {
      expect(matrix).toContain('data-s="' + sc + '"')
    }
    // 18 cell 真落（3 策略 × 6 场景）
    expect((matrix.match(/class="sb-cell /g) || []).length).toBe(18)
    const tri = dom.els['sb-trilemma'].innerHTML
    expect(tri).toContain('data-vec="001"')
    expect(tri).toContain('data-vec="110"')
    expect(tri).toContain('data-vec="101"')
    // 状态字按新口径：崩/锁/滞/✓
    const states = [...matrix.matchAll(/data-state="([^"]+)"/g)].map((m) => m[1])
    expect(states.length).toBeGreaterThanOrEqual(18)
    expect(dom.els['sb-ladder'].innerHTML).toContain('sb-bar')
  })

  it('第二十六维可证伪 DOM：verifyCheckpoint 双路 + 三路篡改 data-rb-tamper + 三因果锁 chips + 11 真件落 DOM', async () => {
    const dom = await runApp(realSw)
    const probes = dom.els['sb-probes'].innerHTML
    for (const lock of ['bulkAllOrNothingCausallyUnerasable', 'checkpointTradeoffCausallyUnerasable',
      'skipSilentLossCausallyUnerasable', 'causalLocksAllHold', 'riggedConvergenceCollapsed', 'noUniversalWinner']) {
      expect(probes, '因果锁/判词 chip ' + lock).toContain('data-verdict="' + lock + '"')
    }
    const verif = dom.els['sb-verif'].innerHTML
    for (const rb of ['bulkAllOrNothingCausallyUnerasable', 'checkpointTradeoffCausallyUnerasable',
      'skipSilentLossCausallyUnerasable', 'holds', 'nontrivial', 'falsifiable']) {
      expect(verif, '可证伪栏 ' + rb).toContain('data-rb="' + rb + '"')
    }
    for (const t of ['corruptCheckpoint', 'silentPoison', 'emptyJob']) {
      expect(verif, '篡改 DOM ' + t).toContain('data-rb-tamper="' + t + '"')
    }
    const cx = dom.els['sb-crosscheck'].innerHTML
    for (const api of ['compareRemapping', 'createShardRouter', 'createHashRing', 'createWal', 'createBus',
      'createRedisCache', 'createObjectPool', 'createTokenBucket', 'createMinHeapDelayQueue',
      'createPackedCounters', 'createFullJitterBackoff', 'verifyCheckpoint']) {
      expect(cx, '真件 ' + api + ' 必须落 DOM').toContain(api)
    }
    expect(cx).toContain('jitterSpread')
    // 诚实口径：不出现旧乱码开关名 / 旧 chk 续跑续跑字样
    expect(dom.els['sb-trilemma-note'].textContent).not.toContain('autoRecoveryMemory')
    expect(dom.els['sb-trilemma-note'].textContent).not.toContain('续跑续跑')
    expect(dom.els['sb-trilemma-note'].textContent).toContain('riggedConvergenceCollapsed')
  })

  it('第二十六维 markup/CSS 契约 + systems.springBatch 缺失真实降级（前端第二十六维）', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
    const css = readFileSync(resolve(ROOT, 'styles.css'), 'utf8')
    expect(html).toContain('row-sb')
    expect(html).toContain('id="sb-matrix"')
    expect(html).toContain('id="sb-verif"')
    expect(html).toContain('BulkWriter=001 / ChunkedWriter=110 / SkipRetryWriter=101')
    expect(css).toContain('.sb-cell.dead')       // 崩 wine
    expect(css).toContain('.sb-cell.fast')       // 锁 gold
    expect(css).toContain('.sb-cell.heavy')      // 滞 gold-dim
    expect(css).toContain('.sb-cell.ok')         // ✓ jade
    expect(css).toContain('.sb-flag.yes')
    expect(css).toContain('.sb-bar > i')
    expect(css).toContain('.sb-verif')
    expect(css).toContain('@media')
  })

  it('systems.springBatch 缺失：sb-matrix/trilemma 真实降级、绝不伪造第二套数', async () => {
    const noSb = JSON.parse(JSON.stringify(realSw as any))
    noSb.systems.springBatch = null
    const dom = await runApp(noSb)
    expect(dom.els['sb-matrix'].innerHTML).toContain('暂缺')
    expect(dom.els['sb-trilemma'].innerHTML).toContain('暂缺')
    expect(dom.els['sb-matrix-note'].textContent).toContain('systems.springBatch 缺失')
  })

  // ============ KI-533 前端第二十七维 · TS 族（4 腿）============
  it('第二十七维真快照渲染：ts 矩阵 18 cell + 三难向量 100/010/101 + 三策略状态字（前端第二十七维）', async () => {
    const dom = await runApp(realSw)
    const matrix = dom.els['ts-matrix'].innerHTML
    expect(matrix).toContain('ts-mat-head')
    for (const p of ['HeadBasedSampler', 'TailBasedSampler', 'AdaptiveSampler']) {
      expect(matrix).toContain('data-strategy="' + p + '"')
    }
    for (const sc of ['steadyLoad', 'errorBurst', 'spikeLoad', 'bufferPressure', 'coldStart', 'cleanRerun']) {
      expect(matrix).toContain('data-s="' + sc + '"')
    }
    // 18 cell 真落（3 策略 × 6 场景）
    expect((matrix.match(/class="ts-cell /g) || []).length).toBe(18)
    const tri = dom.els['ts-trilemma'].innerHTML
    expect(tri).toContain('data-vec="100"')
    expect(tri).toContain('data-vec="010"')
    expect(tri).toContain('data-vec="101"')
    // 状态字：盲/胀/滞/✓
    const states = [...matrix.matchAll(/data-state="([^"]+)"/g)].map((m) => m[1])
    expect(states.length).toBeGreaterThanOrEqual(18)
    expect(dom.els['ts-ladder'].innerHTML).toContain('ts-bar')
  })

  it('第二十七维可证伪 DOM：verifySamplingSoundness 双路 + 三路篡改 data-rb-tamper + 三因果锁 chips + 11 真件落 DOM', async () => {
    const dom = await runApp(realSw)
    const probes = dom.els['ts-probes'].innerHTML
    for (const lock of ['anomalyRequiresBufferingCausallyUnerasable', 'headBlindnessCausallyUnerasable',
      'adaptiveLagCannotGuaranteeAnomalyCausallyUnerasable', 'causalLocksAllHold', 'decisionInvariant',
      'riggedConvergenceCollapsed', 'noUniversalWinner']) {
      expect(probes, '因果锁/判词 chip ' + lock).toContain('data-verdict="' + lock + '"')
    }
    const verif = dom.els['ts-verif'].innerHTML
    for (const rb of ['anomalyRequiresBufferingCausallyUnerasable', 'headBlindnessCausallyUnerasable',
      'adaptiveLagCannotGuaranteeAnomalyCausallyUnerasable', 'holds', 'nontrivial', 'falsifiable']) {
      expect(verif, '可证伪栏 ' + rb).toContain('data-rb="' + rb + '"')
    }
    for (const t of ['forgedErrorSpan', 'duplicateRelease', 'emptyTraceSet']) {
      expect(verif, '篡改 DOM ' + t).toContain('data-rb-tamper="' + t + '"')
    }
    const cx = dom.els['ts-crosscheck'].innerHTML
    for (const api of ['compareRemapping', 'createShardRouter', 'createHashRing', 'createWal', 'createBus',
      'createRedisCache', 'createObjectPool', 'createTokenBucket', 'createMinHeapDelayQueue',
      'createPackedCounters', 'createFullJitterBackoff', 'verifySamplingSoundness']) {
      expect(cx, '真件 ' + api + ' 必须落 DOM').toContain(api)
    }
    expect(cx).toContain('jitterSpread')
    // 诚实口径：写明 rigged 诚实塌缩与 traceCompleteness 维退化说明
    expect(dom.els['ts-trilemma-note'].textContent).toContain('riggedConvergenceCollapsed')
    expect(dom.els['ts-trilemma-note'].textContent).toContain('traceCompleteness')
  })

  it('第二十七维 markup/CSS 契约 + systems.traceSampling 缺失真实降级（前端第二十七维）', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
    const css = readFileSync(resolve(ROOT, 'styles.css'), 'utf8')
    expect(html).toContain('row-ts')
    expect(html).toContain('id="ts-matrix"')
    expect(html).toContain('id="ts-verif"')
    expect(html).toContain('HeadBased=100 / TailBased=010 / Adaptive=101')
    expect(css).toContain('.ts-cell.dead')       // 盲 wine
    expect(css).toContain('.ts-cell.fast')       // 滞 gold
    expect(css).toContain('.ts-cell.heavy')      // 胀 gold-dim
    expect(css).toContain('.ts-cell.ok')         // ✓ jade
    expect(css).toContain('.ts-flag.yes')
    expect(css).toContain('.ts-bar > i')
    expect(css).toContain('.ts-verif')
    expect(css).toContain('.row-ts')
    expect(css).toContain('@media')
  })

  it('systems.traceSampling 缺失：ts-matrix/trilemma 真实降级、绝不伪造第二套数', async () => {
    const noTs = JSON.parse(JSON.stringify(realSw as any))
    noTs.systems.traceSampling = null
    const dom = await runApp(noTs)
    expect(dom.els['ts-matrix'].innerHTML).toContain('暂缺')
    expect(dom.els['ts-trilemma'].innerHTML).toContain('暂缺')
    expect(dom.els['ts-matrix-note'].textContent).toContain('systems.traceSampling 缺失')
  })
})


// ============ KI-535 第二十九维 · spring cloud 分布式会话（ds 族 · 5 腿） ============
describe('KI-535 第二十九维 · sticky-session/jwt-stateless/redis-distributed-session（ds 族）', () => {
  const realSw = JSON.parse(readFileSync(resolve(ROOT, 'snapshot.json'), 'utf8'))
  it('第二十九维真渲染：ds 矩阵 18 cell + 三策略向量 011/101/110 + 状态类前缀 + ladder 条', async () => {
    const dom = await runApp(realSw)
    const matrix = dom.els['ds-matrix'].innerHTML
    expect(matrix).toContain('ds-mat-head')
    for (const p of ['StickySession', 'JwtStateless', 'RedisSessionStore']) {
      expect(matrix).toContain('data-strategy="' + p + '"')
    }
    for (const sc of ['cleanServe', 'instanceFailover', 'revokeLive', 'burstScaleOut', 'idleExpiry', 'mixedLoad']) {
      expect(matrix).toContain('data-s="' + sc + '"')
    }
    expect((matrix.match(/class="ds-cell /g) || []).length).toBe(18)
    const tri = dom.els['ds-trilemma'].innerHTML
    expect(tri).toContain('data-vec="011"')
    expect(tri).toContain('data-vec="101"')
    expect(tri).toContain('data-vec="110"')
    const states = [...matrix.matchAll(/data-state="([^"]+)"/g)].map((m) => m[1])
    expect(states.length).toBeGreaterThanOrEqual(18)
    expect(dom.els['ds-ladder'].innerHTML).toContain('ds-bar')
  })

  it('第二十九维画中件 DOM：verifySessionCoherence 双路 + 十一真件 chip/verify 件 + 三因果锁在 DOM', async () => {
    const dom = await runApp(realSw)
    const probes = dom.els['ds-probes'].innerHTML
    for (const key of ['stickyFailsOverLoss', 'jwtNoInstantRevoke', 'redisPaysInfra', 'redisCoherent',
      'redisInstantRevoke', 'noUniversalWinner']) {
      expect(probes, 'probe chip ' + key).toContain('data-verdict="' + key + '"')
    }
    const verif = dom.els['ds-verif'].innerHTML
    for (const key of ['holds', 'nontrivial', 'falsifiable']) {
      expect(verif, 'verify row ' + key).toContain(key)
    }
    const cx = dom.els['ds-crosscheck'].innerHTML
    for (const api of ['compareRemapping', 'createShardRouter', 'createHashRing', 'createWal', 'createBus',
      'createRedisCache', 'createObjectPool', 'createTokenBucket', 'createMinHeapDelayQueue',
      'createPackedCounters', 'verifySessionCoherence']) {
      expect(cx, '真件 ' + api + ' 必须 DOM 可见').toContain(api)
    }
    expect(cx).toContain('jitterSpread')
  })

  it('第二十九维 markup/CSS 自同 + systems.distributedSession 缺失时真显式降级（微一致记）', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
    const css = readFileSync(resolve(ROOT, 'styles.css'), 'utf8')
    expect(html).toContain('row-ds')
    expect(html).toContain('id="ds-matrix"')
    expect(html).toContain('id="ds-verif"')
    expect(html).toContain('StickySession=011 / JwtStateless=101 / RedisSessionStore=110')
    expect(css).toContain('.ds-cell.pinned')      // 钉（ wine ）
    expect(css).toContain('.ds-cell.durable')     // 持（ gold-dim ）
    expect(css).toContain('.ds-cell.dependency')  // 依（ gold ）
    expect(css).toContain('.ds-cell.ok')          // ✓ jade
    expect(css).toContain('.ds-flag.yes')
    expect(css).toContain('.ds-bar > i')
    expect(css).toContain('.ds-verif')
    expect(css).toContain('@media')
  })

  it('systems.distributedSession 缺失 ⇒ ds 矩阵/trilemma 显式降级到真件兜底句（不静默消失）', async () => {
    const noDs = JSON.parse(JSON.stringify(realSw as any))
    noDs.systems.distributedSession = null
    const dom = await runApp(noDs)
    expect(dom.els['ds-matrix'].innerHTML).toContain('暂缺')
    expect(dom.els['ds-trilemma'].innerHTML).toContain('暂缺')
    expect(dom.els['ds-matrix-note'].textContent).toContain('systems.distributedSession 缺失')
  })
})


// ============ KI-534 第二十八维 · Spring Cloud 事务性发件箱（ob 族 · 5 腿） ============
describe('KI-534 第二十八维 · transactional outbox / dual-write / polling / cdc（ob 族）', () => {
  const realOb = JSON.parse(readFileSync(resolve(ROOT, 'snapshot.json'), 'utf8'))
  it('第二十八维真渲染：ob 矩阵 18 cell + 三策略向量 011/101/110 + 状态类 + ladder 条', async () => {
    const dom = await runApp(realOb)
    const matrix = dom.els['ob-matrix'].innerHTML
    expect(matrix).toContain('ob-mat-head')
    for (const p of ['DualWrite', 'PollingOutbox', 'CdcOutbox']) {
      expect(matrix).toContain('data-strategy="' + p + '"')
    }
    for (const sc of ['steadyFlow', 'crashAfterCommit', 'retryStorm', 'consumerHalfCrash', 'pollLag', 'cleanRerun']) {
      expect(matrix).toContain('data-s="' + sc + '"')
    }
    expect((matrix.match(/class="ob-cell /g) || []).length).toBe(18)
    const tri = dom.els['ob-trilemma'].innerHTML
    expect(tri).toContain('data-vec="011"')
    expect(tri).toContain('data-vec="101"')
    expect(tri).toContain('data-vec="110"')
    const states = [...matrix.matchAll(/data-state="([^"]+)"/g)].map((m) => m[1])
    expect(states.length).toBeGreaterThanOrEqual(18)
    expect(dom.els['ob-ladder'].innerHTML).toContain('ob-bar')
  })

  it('第二十八维画中件 DOM：verifyOutboxSoundness 双路 + 十一真件 chip + 无 111', async () => {
    const dom = await runApp(realOb)
    const probes = dom.els['ob-probes'].innerHTML
    for (const key of ['dualWriteLosesOnCrash', 'pollingNoDup', 'cdcDuplicatesOnHalfCrash',
      'noStrategyWinsAll', 'noUniversalWinner', 'riggedConvergenceCollapsed']) {
      expect(probes, 'probe chip ' + key).toContain('data-verdict="' + key + '"')
    }
    const verif = dom.els['ob-verif'].innerHTML
    for (const key of ['holds', 'nontrivial', 'falsifiable']) {
      expect(verif, 'verify row ' + key).toContain(key)
    }
    const cx = dom.els['ob-crosscheck'].innerHTML
    for (const api of ['compareRemapping', 'createShardRouter', 'createHashRing', 'createWal', 'createBus',
      'createRedisCache', 'createObjectPool', 'createTokenBucket', 'createMinHeapDelayQueue',
      'createFullJitterBackoff', 'createPackedCounters']) {
      expect(cx, '真件 ' + api + ' 必须 DOM 可见').toContain(api)
    }
    expect(cx).toContain('jitterSpread')
  })

  it('第二十八维 markup/CSS 自同 + systems.transactionalOutbox 缺失时真显式降级（不静默消失）', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
    const css = readFileSync(resolve(ROOT, 'styles.css'), 'utf8')
    expect(html).toContain('row-ob')
    expect(html).toContain('id="ob-matrix"')
    expect(html).toContain('id="ob-verif"')
    expect(html).toContain('DualWrite=011 / PollingOutbox=101 / CdcOutbox=110')
    expect(css).toContain('.ob-cell.lost')
    expect(css).toContain('.ob-cell.delayed')
    expect(css).toContain('.ob-cell.dup')
    expect(css).toContain('.ob-cell.ok')
    expect(css).toContain('.ob-flag.yes')
    expect(css).toContain('.ob-bar > i')
    expect(css).toContain('.ob-verif')
    expect(css).toContain('@media')
    const noOb = JSON.parse(JSON.stringify(realOb as any))
    noOb.systems.transactionalOutbox = null
    return runApp(noOb).then((dom2: any) => {
      expect(dom2.els['ob-matrix'].innerHTML).toContain('暂缺')
      expect(dom2.els['ob-trilemma'].innerHTML).toContain('暂缺')
      expect(dom2.els['ob-matrix-note'].textContent).toContain('systems.transactionalOutbox 缺失')
    })
  })
})


// ============ KI-536 第三十维 · Spring Cloud LoadBalancer（lb 族 · 4 腿） ============
describe('KI-536 第三十维 · weightedroundrobin/leastconnections/consistenthash（lb 族）', () => {
  const realLb = JSON.parse(readFileSync(resolve(ROOT, 'snapshot.json'), 'utf8'))
  it('第三十维真渲染：lb 矩阵 18 cell + 三策略向量 101/100/011 + 状态类 + ladder 条', async () => {
    const dom = await runApp(realLb)
    const matrix = dom.els['lb-matrix'].innerHTML
    expect(matrix).toContain('lb-mat-head')
    for (const p of ['WeightedRoundRobin', 'LeastConnections', 'ConsistentHash']) {
      expect(matrix).toContain('data-strategy="' + p + '"')
    }
    for (const sc of ['steadyLoad', 'hotspotNode', 'burstParallel', 'scaleOut', 'connectionLeak', 'cleanRerun']) {
      expect(matrix).toContain('data-s="' + sc + '"')
    }
    expect((matrix.match(/class="lb-cell /g) || []).length).toBe(18)
    const tri = dom.els['lb-trilemma'].innerHTML
    expect(tri).toContain('data-vec="101"')
    expect(tri).toContain('data-vec="100"')
    expect(tri).toContain('data-vec="011"')
    const states = [...matrix.matchAll(/data-state="([^"]+)"/g)].map((m) => m[1])
    expect(states.length).toBeGreaterThanOrEqual(18)
    expect(dom.els['lb-ladder'].innerHTML).toContain('lb-bar')
  })

  it('第三十维画中件 DOM：verifyRoutingSoundness 双路 + 十一真件 chip + 无 111', async () => {
    const dom = await runApp(realLb)
    const probes = dom.els['lb-probes'].innerHTML
    for (const key of ['chStickyOutperformsRR', 'stateFreeDegradesLC', 'hashSkewPersists',
      'noStrategyWinsAll', 'noUniversalWinner', 'riggedConvergenceCollapsed']) {
      expect(probes, 'probe chip ' + key).toContain('data-verdict="' + key + '"')
    }
    const verif = dom.els['lb-verif'].innerHTML
    for (const key of ['holds', 'nontrivial', 'falsifiable']) {
      expect(verif, 'verify row ' + key).toContain(key)
    }
    const cx = dom.els['lb-crosscheck'].innerHTML
    for (const api of ['compareRemapping', 'createShardRouter', 'createHashRing', 'createWal', 'createBus',
      'createRedisCache', 'createObjectPool', 'createTokenBucket', 'createMinHeapDelayQueue',
      'createFullJitterBackoff', 'createPackedCounters']) {
      expect(cx, '真件 ' + api + ' 必须 DOM 可见').toContain(api)
    }
    expect(cx).toContain('jitterSpread')
  })

  it('第三十维 markup/CSS 自同 + systems.loadBalance 缺失时真显式降级', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
    const css = readFileSync(resolve(ROOT, 'styles.css'), 'utf8')
    expect(html).toContain('row-lb')
    expect(html).toContain('id="lb-matrix"')
    expect(html).toContain('id="lb-verif"')
    expect(html).toContain('WeightedRoundRobin=101 / LeastConnections=100 / ConsistentHash=011')
    expect(css).toContain('.lb-cell.rr')
    expect(css).toContain('.lb-cell.lc')
    expect(css).toContain('.lb-cell.ch')
    expect(css).toContain('.lb-cell.ok')
    expect(css).toContain('.lb-flag.yes')
    expect(css).toContain('.lb-bar > i')
    expect(css).toContain('.lb-verif')
    expect(css).toContain('@media')
    const noLb = JSON.parse(JSON.stringify(realLb as any))
    noLb.systems.loadBalance = null
    return runApp(noLb).then((dom2: any) => {
      expect(dom2.els['lb-matrix'].innerHTML).toContain('暂缺')
      expect(dom2.els['lb-trilemma'].innerHTML).toContain('暂缺')
      expect(dom2.els['lb-matrix-note'].textContent).toContain('systems.loadBalance 缺失')
    })
  })
})


// ============ KI-537 第三十一维 · Spring Cloud CircuitBreaker（cb 族 · 4 腿） ============
describe('KI-537 第三十一维 · spring-cloud-circuit-breaker · burst/rate/slow（cb 族）', () => {
  const realCb = JSON.parse(readFileSync(resolve(ROOT, 'snapshot.json'), 'utf8'))
  it('第三十一维真渲染：cb 矩阵 18 cell + 三策略向量 100/101/011 + 状态类 + ladder 条', async () => {
    const dom = await runApp(realCb)
    const matrix = dom.els['cb-matrix'].innerHTML
    expect(matrix).toContain('cb-mat-head')
    for (const p of ['CountBasedBreaker', 'RateBasedBreaker', 'SlowCallBreaker']) {
      expect(matrix).toContain('data-strategy="' + p + '"')
    }
    for (const sc of ['steadyState', 'burstySpikeFailures', 'slowDegradation', 'permanentHostile', 'sparseTraffic', 'cleanRerun']) {
      expect(matrix).toContain('data-s="' + sc + '"')
    }
    expect((matrix.match(/class="cb-cell /g) || []).length).toBe(18)
    const tri = dom.els['cb-trilemma'].innerHTML
    expect(tri).toContain('data-vec="100"')
    expect(tri).toContain('data-vec="101"')
    expect(tri).toContain('data-vec="011"')
    const states = [...matrix.matchAll(/data-state="([^"]+)"/g)].map((m) => m[1])
    expect(states.length).toBeGreaterThanOrEqual(18)
    expect(dom.els['cb-ladder'].innerHTML).toContain('cb-bar')
  })

  it('第三十一维画中件 DOM：verifyCircuitSoundness 双路 + 十一真件 chip + 无 111', async () => {
    const dom = await runApp(realCb)
    const probes = dom.els['cb-probes'].innerHTML
    for (const key of ['slowCallBlindToFailures', 'countBlindToSlow', 'rateSafeOnSparse',
      'noStrategyWinsAll', 'noUniversalWinner', 'riggedConvergenceCollapsed']) {
      expect(probes, 'probe chip ' + key).toContain('data-verdict="' + key + '"')
    }
    const verif = dom.els['cb-verif'].innerHTML
    for (const key of ['holds', 'nontrivial', 'falsifiable']) {
      expect(verif, 'verify row ' + key).toContain(key)
    }
    const cx = dom.els['cb-crosscheck'].innerHTML
    for (const api of ['compareRemapping', 'createShardRouter', 'createHashRing', 'createWal', 'createBus',
      'createRedisCache', 'createObjectPool', 'createTokenBucket', 'createMinHeapDelayQueue',
      'createFullJitterBackoff', 'createPackedCounters']) {
      expect(cx, '真件 ' + api + ' 必须 DOM 可见').toContain(api)
    }
    expect(cx).toContain('jitterSpread')
  })

  it('第三十一维 markup/CSS 自同 + systems.circuitBreaker 缺失时真显式降级', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
    const css = readFileSync(resolve(ROOT, 'styles.css'), 'utf8')
    expect(html).toContain('row-cb')
    expect(html).toContain('id="cb-matrix"')
    expect(html).toContain('id="cb-verif"')
    expect(html).toContain('CountBasedBreaker=100 / RateBasedBreaker=101 / SlowCallBreaker=011')
    expect(css).toContain('.cb-cell.burst')
    expect(css).toContain('.cb-cell.rate')
    expect(css).toContain('.cb-cell.slow')
    expect(css).toContain('.cb-cell.ok')
    expect(css).toContain('.cb-flag.yes')
    expect(css).toContain('.cb-bar > i')
    expect(css).toContain('.cb-verif')
    expect(css).toContain('@media')
    const noCb = JSON.parse(JSON.stringify(realCb as any))
    noCb.systems.circuitBreaker = null
    return runApp(noCb).then((dom2: any) => {
      expect(dom2.els['cb-matrix'].innerHTML).toContain('暂缺')
      expect(dom2.els['cb-trilemma'].innerHTML).toContain('暂缺')
      expect(dom2.els['cb-matrix-note'].textContent).toContain('systems.circuitBreaker 缺失')
    })
  })
})


// ============ KI-538 第三十二维 · Spring Cloud LLM 网关（lg 族 · 4 腿） · 仅离线 ============
describe('KI-538 第三十二维 · offline-double/live-grounded/cached-live（lg 族，仅离线）', () => {
  const realLg = JSON.parse(readFileSync(resolve(ROOT, 'snapshot.json'), 'utf8'))
  it('第三十二维真渲染：lg 矩阵 18 cell + 三策略向量 011/000/000 + 状态类 + ladder 条', async () => {
    const dom = await runApp(realLg)
    const matrix = dom.els['lg-matrix'].innerHTML
    expect(matrix).toContain('lg-mat-head')
    for (const p of ['OfflineDouble', 'LiveGrounded', 'CachedLive']) {
      expect(matrix).toContain('data-strategy="' + p + '"')
    }
    for (const sc of ['singlePrompt', 'batchThreeNpc', 'missingKey', 'badEndpoint', 'badJson', 'cleanRerun']) {
      expect(matrix).toContain('data-s="' + sc + '"')
    }
    expect((matrix.match(/class="lg-cell /g) || []).length).toBe(18)
    const tri = dom.els['lg-trilemma'].innerHTML
    expect(tri).toContain('data-vec="011"')
    expect(tri).toContain('data-vec="000"')
    const states = [...matrix.matchAll(/data-state="([^"]+)"/g)].map((m) => m[1])
    expect(states.length).toBeGreaterThanOrEqual(18)
    expect(dom.els['lg-ladder'].innerHTML).toContain('lg-bar')
  })

  it('第三十二维画中件 DOM：verifyGatewaySoundness 双路 + 三路篡改 + 九 chips + 无 111', async () => {
    const dom = await runApp(realLg)
    const probes = dom.els['lg-probes'].innerHTML
    // 五因果锁 chip 必须与核心件逐字同名，且每枚都带 ✓ 真值状态字 —— 杜绝「无真值来源的装饰 chip 假绿」。
    for (const key of ['offlineZeroCostCausallyUnerasable', 'offlineReproducibleCausallyUnerasable',
      'badJsonNeverGroundedCausallyUnerasable', 'cachedHitReproducibleCausallyUnerasable',
      'firstCallCostCausallyUnerasable'] as const) {
      expect(probes, '真锁 chip ' + key).toContain('data-verdict="' + key + '">✓')
    }
    // 绝不许臆造锁名漏进 DOM（此前 cachedHitRate/liveHallucinatesWithoutKey 是无值装饰假绿）。
    expect(probes).not.toContain('cachedHitRateCausallyUnerasable')
    expect(probes).not.toContain('liveHallucinatesWithoutKeyCausallyUnerasable')
    for (const key of ['noStrategyWinsAll', 'noUniversalWinner', 'vectorFromExam']) {
      expect(probes, 'probe chip ' + key).toContain('data-verdict="' + key + '"')
    }
    const verif = dom.els['lg-verif'].innerHTML
    for (const key of ['holds', 'falsifiable', 'baselineHolds']) {
      expect(verif, 'verify row ' + key).toContain(key)
    }
    const cx = dom.els['lg-crosscheck'].innerHTML
    for (const api of ['compareRemapping', 'createShardRouter', 'createHashRing', 'createWal', 'createBus',
      'createRedisCache', 'createObjectPool', 'createTokenBucket', 'createMinHeapDelayQueue',
      'createFullJitterBackoff', 'createPackedCounters']) {
      expect(cx, '真件 ' + api + ' 必须 DOM 可见').toContain(api)
    }
    expect(cx).toContain('jitterSpread')
  })

  it('第三十二维 markup/CSS 自同 + systems.llmGateway 缺失时真显式降级', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
    const css = readFileSync(resolve(ROOT, 'styles.css'), 'utf8')
    expect(html).toContain('row-lg')
    expect(html).toContain('id="lg-matrix"')
    expect(html).toContain('id="lg-verif"')
    expect(html).toContain('OfflineDouble=011 / LiveGrounded=000 / CachedLive=000')
    expect(css).toContain('.lg-cell.offline')
    expect(css).toContain('.lg-cell.live')
    expect(css).toContain('.lg-cell.cached')
    expect(css).toContain('.lg-cell.ok')
    expect(css).toContain('.lg-flag.yes')
    expect(css).toContain('.lg-bar > i')
    expect(css).toContain('.lg-verif')
    expect(css).toContain('@media')
    const noLg = JSON.parse(JSON.stringify(realLg as any))
    noLg.systems.llmGateway = null
    return runApp(noLg).then((dom2: any) => {
      expect(dom2.els['lg-matrix'].innerHTML).toContain('暂缺')
      expect(dom2.els['lg-trilemma'].innerHTML).toContain('暂缺')
      expect(dom2.els['lg-matrix-note'].textContent).toContain('systems.llmGateway 缺失')
    })
  })
})


// ============ KI-539 第三十三维 · Spring Cloud Gateway 路由（gr 族 · 4 腿） ============
describe('KI-539 第三十三维 · pathprefix/regexcapture/headergroup（gr 族）', () => {
  const realGr = JSON.parse(readFileSync(resolve(ROOT, 'snapshot.json'), 'utf8'))
  it('第三十三维真渲染：gr 矩阵 18 cell + 三策略向量 001/110/101 + 状态类 + ladder 条', async () => {
    const dom = await runApp(realGr)
    const matrix = dom.els['gr-matrix'].innerHTML
    expect(matrix).toContain('gr-mat-head')
    for (const p of ['PathPrefixRouting', 'RegexCaptureRouting', 'HeaderGroupRouting']) {
      expect(matrix).toContain('data-strategy="' + p + '"')
    }
    for (const sc of ['prefixMatch', 'regexCapture', 'headerGroup', 'bigRouteTable', 'conflictingRoutes', 'cleanRerun']) {
      expect(matrix).toContain('data-s="' + sc + '"')
    }
    expect((matrix.match(/class="gr-cell /g) || []).length).toBe(18)
    const tri = dom.els['gr-trilemma'].innerHTML
    expect(tri).toContain('data-vec="001"')
    expect(tri).toContain('data-vec="110"')
    expect(tri).toContain('data-vec="101"')
    const states = [...matrix.matchAll(/data-state="([^"]+)"/g)].map((m) => m[1])
    expect(states.length).toBeGreaterThanOrEqual(18)
    expect(dom.els['gr-ladder'].innerHTML).toContain('gr-bar')
  })

  it('第三十三维画中件 DOM：verifyGatewayRoutingSoundness 双路 + 十一真件 chip + 无 111', async () => {
    const dom = await runApp(realGr)
    const probes = dom.els['gr-probes'].innerHTML
    for (const key of ['pathFindsHashMiss', 'regexDistinguishesLabs', 'headerGroupNotPowered',
      'noStrategyWinsAll', 'noUniversalWinner', 'riggedConvergenceCollapsed']) {
      expect(probes, 'probe chip ' + key).toContain('data-verdict="' + key + '"')
    }
    const verif = dom.els['gr-verif'].innerHTML
    for (const key of ['holds', 'nontrivial', 'falsifiable']) {
      expect(verif, 'verify row ' + key).toContain(key)
    }
    const cx = dom.els['gr-crosscheck'].innerHTML
    for (const api of ['compareRemapping', 'createShardRouter', 'createHashRing', 'createWal', 'createBus',
      'createRedisCache', 'createObjectPool', 'createTokenBucket', 'createMinHeapDelayQueue',
      'createFullJitterBackoff', 'createPackedCounters']) {
      expect(cx, '真件 ' + api + ' 必须 DOM 可见').toContain(api)
    }
    expect(cx).toContain('jitterSpread')
  })

  it('第三十三维 markup/CSS 自同 + systems.gatewayRouting 缺失时真显式降级', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
    const css = readFileSync(resolve(ROOT, 'styles.css'), 'utf8')
    expect(html).toContain('row-gr')
    expect(html).toContain('id="gr-matrix"')
    expect(html).toContain('id="gr-verif"')
    expect(html).toContain('PathPrefixRouting=001 / RegexCaptureRouting=110 / HeaderGroupRouting=101')
    expect(css).toContain('.gr-cell.loose')
    expect(css).toContain('.gr-cell.capture')
    expect(css).toContain('.gr-cell.tight')
    expect(css).toContain('.gr-cell.ok')
    expect(css).toContain('.gr-flag.yes')
    expect(css).toContain('.gr-bar > i')
    expect(css).toContain('.gr-verif')
    expect(css).toContain('@media')
    const noGr = JSON.parse(JSON.stringify(realGr as any))
    noGr.systems.gatewayRouting = null
    return runApp(noGr).then((dom2: any) => {
      expect(dom2.els['gr-matrix'].innerHTML).toContain('暂缺')
      expect(dom2.els['gr-trilemma'].innerHTML).toContain('暂缺')
      expect(dom2.els['gr-matrix-note'].textContent).toContain('systems.gatewayRouting 缺失')
    })
  })
})
