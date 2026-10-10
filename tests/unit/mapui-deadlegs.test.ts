import { beforeAll, describe, expect, it } from 'vitest'
import { registerGameData, regions } from '@/data'
import { PICK_INTENTS, UI_BINDS, type UiIntent } from '@/core/Input'
import { atlasOf, MapUI, type MapDeps, type MapFacility } from '@/ui/MapUI'

/**
 * 批30：ui/MapUI.ts 的 4 条死分支经核实**全部恒死**（cov_b29 排行，源码同行尾已标注）：
 * - L237 提前 return：当时 UiIntent 值域只有 8 意图，全被 uiStep 的 if 链吃净，不存在"静默意图"；
 * - L421 两侧 ?? 0：revealed ⊆ 本名册 id，filter 保证 regionId 必在 rank 里；
 * - L424 ?? f.kind：isMapFacility 过滤后 kind 必在六类内，FACILITY_LABEL 是全类 Record。
 *
 * **KI-062 第二腿把 L237 从恒死翻成活腿**：通道里多了 `pick1..9`（对话框的"1-9 选择"），
 * 而地图没有编号行 ⇒ 那一格第一次有了真实读者，读出来的效果就是"什么都不做"。
 * 因此下面钉的是两条而不是一条：八格导航意图每格都必须有可观察效果（漏接就红），
 * 九格 pick 在地图上必须静默（谁哪天让"按 3"跳到第 3 个设施，那是新语义，得先把它写进这里）。
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

describe('批30 守门：地图上的八格导航意图必须有可观察效果，九格 pick 必须静默', () => {
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

  it('八格导航意图每格都有可观察效果；九格 pick 在地图上静默（L237 那条活腿）', () => {
    // 名册从 `UI_BINDS` 现推，不是手抄八格：谁往通道里加新意图（zoomIn 之类），
    // 这里就要求地图上也有一个可观察效果，否则 L237 会把漏接吞成"静默意图"。
    const bound = new Set<UiIntent>([...Object.values(UI_BINDS.keyboard), ...Object.values(UI_BINDS.padButtons)])
    const picks = new Set<string>(PICK_INTENTS)
    const nav = [...bound].filter((i) => !picks.has(i)).sort()
    expect(nav, '地图上"必须有读者"的那八格').toEqual(['back', 'confirm', 'down', 'left', 'pageNext', 'pagePrev', 'right', 'up'])
    const state = (m: MapUI, deps: ReturnType<typeof makeDeps>) => {
      const p = priv(m)
      return { cx: p.cx, cz: p.cz, zoom: p.zoom, closes: deps.closes.length, html: ((m as unknown as { root: FakeEl }).root).innerHTML }
    }
    for (const intent of nav) {
      const { m, deps } = makeMap()
      m.show()
      step(m, 'up')   // 先离开"打开即在中心"那个位置：`confirm` 的效果就是回中，原地按它当然一格都不变
      const before = state(m, deps)
      step(m, intent)
      const after = state(m, deps)
      expect(JSON.stringify(after) !== JSON.stringify(before), `意图 ${intent} 必须真的改变地图上的某一格（漏接 = 静默意图）`).toBe(true)
    }
    for (const pick of PICK_INTENTS) {
      const { m, deps } = makeMap()
      m.show()
      step(m, 'up')   // 与上面同一把尺：在"打开即回中"的位置上量静默是量不出效果的——第一版 A10 刀就是这么漏的（把 pick 改成回中，原地看不出来）
      const before = state(m, deps)
      step(m, pick)
      expect(JSON.stringify(state(m, deps)), `${pick} 在地图上应当静默：地图没有编号行，不许替玩家猜`).toBe(JSON.stringify(before))
    }
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
