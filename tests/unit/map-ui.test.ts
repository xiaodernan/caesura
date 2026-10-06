import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { atlasOf, exploredRegionIds, MapUI, regionExplored, ZOOM_LEVELS, MAP_FACILITY_KINDS } from '@/ui/MapUI'
import type { MapDeps, MapFacility } from '@/ui/MapUI'
import type { RegionData, Vec3 } from '@/data/schema'

/**
 * 区域图（§43 / TD-002 的结案落点）。本文件只验 MapUI 自己的契约：
 * 纯几何（atlasOf / regionExplored 的「该问哪些点」）、开合状态机、KI-062 的唯一菜单读数、
 * 拖拽/滚轮的视图数学、渲染内容里「踏足才亮」的信息纪律（§4.2）。
 * 与 stakerite.test.ts 同一条路：没有 DOM 测试环境（零新增依赖），用最小 DOM 替身。
 */

class FakeEl {
  id = ''
  className = ''
  textContent = ''
  innerHTML = ''
  dataset: Record<string, string> = {}
  /** closest 命中自己的开关：测 onDown/onClick 的目标分发 */
  matchSelf = false
  private classes = new Set<string>()
  handlers: Record<string, ((e: unknown) => void)[]> = {}
  classList = {
    add: (c: string) => { this.classes.add(c) },
    remove: (c: string) => { this.classes.delete(c) },
    contains: (c: string) => this.classes.has(c),
  }
  style = { textContent: '' }
  rect = { width: 960, height: 540 }
  getBoundingClientRect(): { width: number; height: number } { return this.rect }
  appendChild(c: FakeEl): FakeEl { this.children.push(c); return c }
  children: FakeEl[] = []
  addEventListener(t: string, fn: (e: unknown) => void): void { (this.handlers[t] ??= []).push(fn) }
  dispatch(t: string, e: unknown): void { for (const fn of this.handlers[t] ?? []) fn(e) }
  closest(): FakeEl | null { return this.matchSelf ? this : null }
}

let winHandlers: Record<string, ((e: unknown) => void)[]> = {}

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  g.document = {
    createElement: () => new FakeEl(),
    head: new FakeEl(),
    body: new FakeEl(),
  }
  g.window = {
    addEventListener: (t: string, fn: (e: unknown) => void) => { (winHandlers[t] ??= []).push(fn) },
  }
})

/* ------------------------------ 夹具 ------------------------------ */

let seq = 0
const mkRegion = (over: Partial<RegionData> = {}): RegionData => ({
  id: `rg_test_${++seq}`,
  nameKey: `region.test${seq}`,
  displayName: `测试区${seq}`,
  order: seq,
  biome: 'forest',
  bounds: { minX: 0, maxX: 96, minY: -8, maxY: 8, minZ: 0, maxZ: 96 },
  groundY: 0,
  grid: { bpm: 84, beatsPerBar: 4 },
  palette: { base: '#101418', accent: '#c9b458', glow: '#ffb86b' },
  landmarks: [],
  spawnGroups: [],
  interactables: [],
  ...over,
} as unknown as RegionData)

const mkFacility = (over: Partial<MapFacility> = {}): MapFacility => ({
  id: `fac_${seq}`, kind: 'checkpoint', state: 'ready',
  regionId: 'rg_test_1', regionName: '测试区1', pos: { x: 20, y: 0, z: 20 },
  ...over,
})

const vb = (html: string): { x: number; y: number; w: number } => {
  const m = /viewBox="([^"]+)"/.exec(html)!
  const [x, y, w] = m[1].split(' ').map(Number)
  return { x, y, w }
}
const zoomOf = (html: string): number => Number(/缩放 ×([\d.]+)/.exec(html)![1])

/* ------------------------------ 纯几何 ------------------------------ */

describe('atlasOf / regionExplored：踏足的唯一判据是注入的遮罩', () => {
  it('atlasOf：全图外框 = 区块包络 + 留白；没有区块时给 1×1 的空图', () => {
    expect(atlasOf([])).toEqual({ minX: 0, minZ: 0, w: 1, h: 1 })
    const a = atlasOf([mkRegion({ bounds: { minX: 0, maxX: 96, minY: 0, maxY: 8, minZ: 0, maxZ: 96 } as RegionData['bounds'] })])
    expect(a.minX).toBe(-24)
    expect(a.minZ).toBe(-24)
    expect(a.w).toBe(96 + 24 * 2)
    expect(a.h).toBe(96 + 24 * 2)
  })

  it('regionExplored：扫的是区域自己的 chunk 格中心，踩到一角就算踏足', () => {
    const r = mkRegion()
    const probes: Vec3[] = []
    expect(regionExplored(r, 48, (p) => { probes.push(p); return false })).toBe(false)
    // 半开区间 [0,96)：x/z 各 2 格（0/48 起点），y 跨 -1/0 两格 ⇒ 2×2×2
    expect(probes.length).toBe(8)
    expect(probes[0]).toEqual({ x: 24, y: -24, z: 24 })
    // 命中任意一格的中心就算踏足
    expect(regionExplored(r, 48, (p) => p.x === 72 && p.z === 72)).toBe(true)
    // 格边长被夹到 ≥1：碎尺寸不会把查询变成死循环
    const tiny: Vec3[] = []
    regionExplored(mkRegion({ bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 } as RegionData['bounds'] }), 0.001, (p) => { tiny.push(p); return false })
    expect(tiny.length).toBe(1)
  })

  it('exploredRegionIds：遮罩没读到东西时是空集，不是「全都亮着」', () => {
    const a = mkRegion({ id: 'rg_a' })
    const b = mkRegion({ id: 'rg_b', bounds: { minX: 1000, maxX: 1100, minY: 0, maxY: 8, minZ: 1000, maxZ: 1100 } as RegionData['bounds'] })
    expect(exploredRegionIds([a, b], 48, () => false).size).toBe(0)
    expect(exploredRegionIds([a, b], 48, (p) => p.x === 24 && p.z === 24)).toEqual(new Set(['rg_a']))
  })
})

/* ------------------------------ 面板本体 ------------------------------ */

describe('MapUI：开合、菜单语义与视图数学', () => {
  const regions = [mkRegion({ id: 'rg_a', displayName: '雾语林', landmarks: [{ id: 'lm_1', nameKey: 'landmark.1', pos: { x: 30, y: 0, z: 30 }, sightRange: 120 }] })]
  const facilities = [
    mkFacility({ id: 'fac_a', kind: 'checkpoint', state: 'ready' }),
    mkFacility({ id: 'fac_b', kind: 'gate', state: 'locked', pos: { x: 60, y: 0, z: 60 } }),
    mkFacility({ id: 'fac_x', kind: 'prop', state: 'ready' }), // 排版口径外的类别不上图
  ]

  function boot(over: Partial<MapDeps> = {}) {
    winHandlers = {} // 只听本实例的窗口 handler：前面测试的实例不再收事件
    let closes = 0
    const deps: MapDeps = {
      regionAt: () => regions[0],
      isExplored: () => true,
      chunkSize: () => 48,
      playerPos: () => ({ x: 10, y: 0, z: 10 }),
      viewDir: () => ({ x: 0, z: -1 }),
      facilities: () => facilities,
      onRequestClose: () => { closes++ },
      ...over,
    }
    const ui = new MapUI(regions, deps)
    const root = (globalThis as unknown as { document: { body: FakeEl } }).document.body.children.at(-1)!
    return { ui, root, closes: () => closes }
  }

  it('ZOOM_LEVELS 是 ui-ux §4.3 的 12 级离散档：含 ×1 基准档，单调且端点 0.5/4', () => {
    expect(ZOOM_LEVELS.length).toBe(12)
    expect(ZOOM_LEVELS).toContain(1)
    expect(ZOOM_LEVELS[0]).toBe(0.5)
    expect(ZOOM_LEVELS[ZOOM_LEVELS.length - 1]).toBe(4)
    for (let i = 1; i < ZOOM_LEVELS.length; i++) expect(ZOOM_LEVELS[i]).toBeGreaterThan(ZOOM_LEVELS[i - 1])
    expect(MAP_FACILITY_KINDS).toContain('checkpoint')
  })

  it('toggle/show/close：关面板只由持有者调，onRequestClose 只是「提出」', () => {
    const { ui, root, closes } = boot()
    expect(ui.isOpen).toBe(false)
    ui.uiStep(new Set(['back'])) // 关着的时候菜单读数整个不进来
    expect(closes()).toBe(0)
    ui.toggle()
    expect(ui.isOpen).toBe(true)
    expect(root.classList.contains('on')).toBe(true)
    expect(root.innerHTML).toContain('息声领 · 区域图')
    ui.uiStep(new Set(['back']))
    expect(closes()).toBe(1)
    expect(ui.isOpen).toBe(true) // 面板不自己收自己：等持有者来关
    ui.close()
    expect(ui.isOpen).toBe(false)
    expect(root.classList.contains('on')).toBe(false)
  })

  it('uiStep：方向键=平移（viewSize 的 1/8），翻页=缩放，confirm=回中丢掉视图状态', () => {
    const { ui, root } = boot()
    ui.show()
    const home = vb(root.innerHTML)
    ui.uiStep(new Set(['right']))
    const right = vb(root.innerHTML)
    expect(right.x).toBeGreaterThan(home.x) // 中心右移 ⇒ 视口左上角 x 增大
    ui.uiStep(new Set(['up']))
    expect(vb(root.innerHTML).y).toBeLessThan(right.y) // dz -= 1 ⇒ cz 减 ⇒ 视口 y 减
    expect(zoomOf(root.innerHTML)).toBe(1)
    ui.uiStep(new Set(['pagePrev']))
    expect(zoomOf(root.innerHTML)).toBe(1.2)
    ui.uiStep(new Set(['confirm']))
    expect(vb(root.innerHTML)).toEqual(home) // 回中 = 「我此刻在哪」，视图状态全丢
  })

  it('平移到边角会被 clampView 拉住：图可以看边，不许整片滑出画面', () => {
    const { ui, root } = boot()
    ui.show()
    for (let i = 0; i < 12; i++) ui.uiStep(new Set(['left']))
    const stuck = vb(root.innerHTML).x
    for (let i = 0; i < 6; i++) ui.uiStep(new Set(['left']))
    expect(vb(root.innerHTML).x).toBe(stuck) // 到底了：再按也不再动
  })

  it('wheel 缩放：上滚放大下滚缩小，档位两端是死墙（不是循环）', () => {
    const { ui, root } = boot()
    ui.show()
    root.dispatch('wheel', { deltaY: -100 })
    expect(zoomOf(root.innerHTML)).toBe(1.2)
    root.dispatch('wheel', { deltaY: 100 })
    expect(zoomOf(root.innerHTML)).toBe(1)
    for (let i = 0; i < 20; i++) root.dispatch('wheel', { deltaY: 100 })
    expect(zoomOf(root.innerHTML)).toBe(0.5) // 钉在最小档
    for (let i = 0; i < 40; i++) root.dispatch('wheel', { deltaY: -100 })
    expect(zoomOf(root.innerHTML)).toBe(4) // 钉在最大档
  })

  it('拖拽：按住图往右拖，中心反向跟手；松手与关面板都断开', () => {
    const { ui, root } = boot()
    ui.show()
    const home = vb(root.innerHTML)
    const target = new FakeEl()
    target.matchSelf = true // closest('[data-map-drag]') 命中
    root.dispatch('mousedown', { clientX: 480, clientY: 270, target })
    const [move] = winHandlers['mousemove']
    move({ clientX: 470, clientY: 270 }) // 往左拖 10px ⇒ 中心反向 = 视口 x 增大
    expect(vb(root.innerHTML).x).toBeCloseTo(home.x + (10 / 960) * home.w, 4)
    const [up] = winHandlers['mouseup']
    up({})
    move({ clientX: 100, clientY: 270 }) // 松手后拖动失效
    expect(vb(root.innerHTML).x).toBeCloseTo(home.x + (10 / 960) * home.w, 4)
  })

  it('点 veil（data-act=close）提出收起；点图不触发', () => {
    const { ui, root, closes } = boot()
    ui.show()
    const veil = new FakeEl()
    veil.dataset.act = 'close'
    veil.matchSelf = true
    root.dispatch('click', { target: veil })
    expect(closes()).toBe(1)
    root.dispatch('click', { target: new FakeEl() })
    expect(closes()).toBe(1)
  })
})

describe('MapUI 渲染：踏足才亮（§4.2）与三态设施', () => {
  const regions = [mkRegion({ id: 'rg_a', displayName: '雾语林', landmarks: [{ id: 'lm_1', nameKey: 'landmark.1', pos: { x: 30, y: 0, z: 30 }, sightRange: 120 }] })]

  function boot(revealed: boolean, regionHere = true) {
    const deps: MapDeps = {
      regionAt: () => (regionHere ? regions[0] : null),
      isExplored: () => revealed,
      chunkSize: () => 48,
      playerPos: () => ({ x: 10, y: 0, z: 10 }),
      viewDir: () => ({ x: 1, z: 0 }), // 面向 +x ⇒ svg 旋转 90°
      facilities: () => [
        mkFacility({ id: 'fac_a', kind: 'checkpoint', state: 'ready', regionId: 'rg_a' }),
        mkFacility({ id: 'fac_b', kind: 'gate', state: 'locked', regionId: 'rg_a', pos: { x: 60, y: 0, z: 60 } }),
        mkFacility({ id: 'fac_c', kind: 'bridge', state: 'used', regionId: 'rg_a' }),
        mkFacility({ id: 'fac_x', kind: 'prop', state: 'ready', regionId: 'rg_a' }),
      ],
      onRequestClose: () => {},
    }
    const ui = new MapUI(regions, deps)
    ui.show()
    const root = (globalThis as unknown as { document: { body: FakeEl } }).document.body.children.at(-1)!
    return root.innerHTML
  }

  it('已踏足：区名/拍表/地标/设施三态都上屏；玩家标记指向镜头朝向', () => {
    const html = boot(true)
    expect(html).toContain('雾语林')
    expect(html).toContain('84BPM/4')
    expect(html).toContain('data-name-key="landmark.1"')
    expect(html).toContain('远望 120m')
    expect(html).toContain('已开通') // ready
    expect(html).toContain('未开通') // locked
    expect(html).toContain('已通过') // used
    expect(html).toContain('rotate(90)') // viewDir(1,0) ⇒ atan2(1, 0) = 90°
    expect(html).not.toContain('prop') // 排版口径外的类别不上图
    expect(html).toContain('1 格 = 48m')
  })

  it('未踏足：磨砂遮罩不给名字与内容；界外不指认区域', () => {
    const html = boot(false)
    expect(html).toContain('rg-box fog') // 区块还在，但只是磨砂
    expect(html).not.toContain('84BPM/4') // 拍表注脚先不漏（区名在头部只作「我在哪」的读数）
    expect(html).not.toContain('rlabel')
    expect(html).not.toContain('data-landmark')
    expect(html).not.toContain('远望')
    expect(html).not.toContain('data-fac') // 未踏足区的设施不画点
    expect(html).toContain('这一带还没有可用的机关')
    expect(html).toContain('还没有踏足任何区域')
    expect(html).toContain('另有 1 区还没有踏足')
  })

  it('界外 + 缩略图：只画区色块，隐藏标记、名字与刻度尺', () => {
    const html = boot(false, false)
    expect(html).toContain('界外')
    // 缩到最小档
    const ui = (() => {
      const deps: MapDeps = {
        regionAt: () => regions[0], isExplored: () => true, chunkSize: () => 48,
        playerPos: () => ({ x: 10, y: 0, z: 10 }), viewDir: () => ({ x: 0, z: -1 }),
        facilities: () => [], onRequestClose: () => {},
      }
      const u = new MapUI(regions, deps)
      u.show()
      return u
    })()
    for (let i = 0; i < 4; i++) ui.uiStep(new Set(['pageNext']))
    const root = (globalThis as unknown as { document: { body: FakeEl } }).document.body.children.at(-1)!
    const thumb = root.innerHTML
    expect(thumb).toContain('缩略图')
    expect(thumb).not.toContain('data-fac')
    expect(thumb).not.toContain('pl-ring')
    expect(thumb).not.toContain('scale-line')
    expect(thumb).not.toContain('rlabel')
  })
})

describe('源码门：面板里没有一个手抄的区名（文件头点名的账）', () => {
  it('MapUI.ts 不硬编码任何 regions.json 的 displayName——名字只能来自数据', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url))
    const src = readFileSync(root + 'src/ui/MapUI.ts', 'utf8')
    const list = JSON.parse(readFileSync(root + 'src/data/json/regions.json', 'utf8')) as RegionData[]
    expect(list.length, 'regions.json 得先真的有区，门才有意义').toBeGreaterThan(0)
    const leaked = list.filter((r) => src.includes(r.displayName))
    expect(leaked.map((r) => r.id), '区名被手抄进面板源码：数据改名就会漏改代码').toEqual([])
  })
})
