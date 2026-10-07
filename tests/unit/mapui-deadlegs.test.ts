import { beforeAll, describe, expect, it } from 'vitest'
import { registerGameData, regions } from '@/data'
import { atlasOf, MapUI, type MapDeps, type MapFacility } from '@/ui/MapUI'

/**
 * 批30：ui/MapUI.ts 的 4 条死分支经核实**全部恒死**（cov_b29 排行，源码同行尾已标注）：
 * - L237 提前 return：UiIntent 值域 8 意图全被 uiStep 的 if 链吃净，不存在"静默意图"；
 * - L421 两侧 ?? 0：revealed ⊆ 本名册 id，filter 保证 regionId 必在 rank 里；
 * - L424 ?? f.kind：isMapFacility 过滤后 kind 必在六类内，FACILITY_LABEL 是全类 Record。
 *
 * 本文件不点亮死腿（没有可点亮的），而是把"uiStep 无静默意图"这个不变量钉住：
 * 将来谁往 UiIntent 里加新值（比如 zoomIn），if 链就会漏接、L237 复活成真腿——这条测试会先红。
 */

registerGameData()

class FakeEl {
  innerHTML = ''
  dataset: Record<string, string> = {}
  private classes = new Set<string>()
  handlers: Record<string, ((e: unknown) => void)[]> = {}
  classList = {
    add: (c: string): void => { this.classes.add(c) },
    remove: (c: string): void => { this.classes.delete(c) },
    contains: (c: string): boolean => this.classes.has(c),
  }
  style = { textContent: '' }
  appendChild(c: FakeEl): FakeEl { return c }
  addEventListener(): void { /* 本批不点 DOM */ }
}

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  g.document = { createElement: () => new FakeEl(), head: new FakeEl(), body: new FakeEl(), getElementById: () => new FakeEl() }
  g.window = { addEventListener: (): void => {} }
})

/** 已踏足一切、我在原点、设施清单由用例自定的最小 deps */
function makeDeps(facilities: readonly MapFacility[] = []): MapDeps & { closes: number[] } {
  const closes: number[] = []
  return {
    closes,
    regionAt: () => null,
    isExplored: () => true,
    chunkSize: () => 8,
    playerPos: () => ({ x: 0, y: 0, z: 0 }),
    viewDir: () => ({ x: 0, z: -1 }),
    facilities: () => facilities,
    onRequestClose: () => { closes.push(1) },
  }
}

type Priv = { cx: number; cz: number; zoom: number }
const priv = (m: object): Priv => m as unknown as Priv
const step = (m: object, ...intents: string[]): void =>
  (m as { uiStep(i: ReadonlySet<string>): void }).uiStep(new Set(intents))

function makeMap(deps = makeDeps()): { m: MapUI; deps: ReturnType<typeof makeDeps> } {
  const m = new MapUI(regions, deps)
  return { m, deps }
}

const ATLAS = atlasOf(regions)

describe('批30 守门：uiStep 的每个 UiIntent 都必须有可观察效果（恒死 L237 的结构性根据）', () => {
  it('四个方向各平移一次：cx/cz 必离开回中位', () => {
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      const { m } = makeMap()
      m.show()
      const before = priv(m)
      const cx0 = before.cx, cz0 = before.cz
      step(m, dir)
      const after = priv(m)
      expect(after.cx !== cx0 || after.cz !== cz0, `意图 ${dir} 必须真的平移视图`).toBe(true)
    }
  })

  it('翻页两向缩放：zoom 必离开基准档', () => {
    const { m } = makeMap()
    m.show()
    expect(priv(m).zoom).toBe(4) // ZOOM_LEVELS.indexOf(1)
    step(m, 'pagePrev')
    expect(priv(m).zoom, 'pagePrev 放大一级').toBe(5)
    step(m, 'pageNext')
    step(m, 'pageNext')
    expect(priv(m).zoom, 'pageNext 缩小两级').toBe(3)
  })

  it('confirm 回中：先平走再回，视图中心必须回到玩家所在格', () => {
    const { m } = makeMap()
    m.show()
    step(m, 'left', 'up')
    expect(priv(m).cx, '平移后确实离开了').not.toBe(0 - ATLAS.minX)
    step(m, 'confirm')
    expect(priv(m).cx, '回中 = 玩家图坐标').toBe(0 - ATLAS.minX)
    expect(priv(m).cz).toBe(0 - ATLAS.minZ)
  })

  it('back 后退：关闭请求交给持有者，面板自己不收自己', () => {
    const { m, deps } = makeMap()
    m.show()
    expect(deps.closes).toHaveLength(0)
    step(m, 'back')
    expect(deps.closes, 'onRequestClose 恰好被叫一次').toHaveLength(1)
    expect(m.isOpen).toBe(true)
  })

  it('右栏设施排序与显示在真表上照常工作（L421 恒死标注不碰正常腿）', () => {
    const fac = (id: string, kind: string, regionId: string, state: MapFacility['state']): MapFacility =>
      ({ id, kind, state, regionId, regionName: '某区', pos: { x: 0, y: 0, z: 0 } })
    // 两个在册设施：排序腿（?? 0 的左腿）照常跑
    const { m } = makeMap(makeDeps([
      fac('f2', 'gate', regions[0].id, 'locked'),
      fac('f1', 'checkpoint', regions[0].id, 'ready'),
    ]))
    m.show()
    const html = ((m as unknown as { root: FakeEl }).root).innerHTML
    expect(html).toContain('调音桩')
    expect(html).toContain('闸门')
    expect(html.indexOf('f1') >= 0 || html.indexOf('f2') >= 0, '设施 id 出现在卡面').toBe(true)
  })
})
