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
    expect(html).toContain('./bootstrap.js')
    expect(html).toContain('./app.js')
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
})
