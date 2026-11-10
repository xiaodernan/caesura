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
})
