import { describe, expect, it, beforeAll, afterEach } from 'vitest'
import { bus } from '@/core/EventBus'
import { Hud } from '@/ui/Hud'

/**
 * HUD 的**目标指示**箭头（KI-137）。
 *
 * 任务行（KI-113②）回答了"要干什么"，这一格回答"往哪走"：目标在画面里画一枚菱形，
 * 在画面外（或者在相机背后）就在屏幕边缘画一枚指向它的箭头。
 *
 * **HUD 不认识任务表**：它只收一个世界坐标（`hud.objective`）与一个投影函数（`hud.projectEdge`），
 * 投影与夹取都在组合根那一侧（相机在那一侧）。本文件钉住四件事：
 *  · 没有目标就不画（不占屏）；
 *  · 目标在画面里 ⇒ 画菱形（描边，不填充）；
 *  · 目标在画面外 ⇒ 画箭头（填充的三角），且**位置用组合根给的那个**；
 *  · 投影没接时也不画（宁可没有，不要画在错的地方）。
 *
 * **读数用"差值"而不是绝对值**：HUD 上还有别的东西会描边/填充（血波、节拍环…），
 * 绝对计数会随那些东西变 ⇒ 每一格都拿"没有目标"那一趟当基线，比差值。
 */
interface Recorder {
  strokes: number
  fills: number
  /** 折线的顶点（moveTo 与 lineTo 都记） */
  verts: number[][]
  /** translate 的落点（箭头像"贴纸"一样先贴到那个位置再转） */
  translates: number[][]
}

function makeHud(): { hud: Hud; rec: Recorder } {
  const rec: Recorder = { strokes: 0, fills: 0, verts: [], translates: [] }
  const store: Record<string, unknown> = {}
  const grad = { addColorStop: () => {} }
  const ctx = new Proxy(store, {
    get(t, k: string) {
      if (k in t) return t[k]
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad
      if (k === 'measureText') return () => ({ width: 10 })
      if (k === 'fillText') return () => {}
      if (k === 'stroke') return () => { rec.strokes++ }
      if (k === 'fill') return () => { rec.fills++ }
      if (k === 'moveTo' || k === 'lineTo') return (x: number, y: number) => { rec.verts.push([x, y]) }
      if (k === 'translate') return (x: number, y: number) => { rec.translates.push([x, y]) }
      return () => {}
    },
    set(t, k: string, v) { t[k] = v; return true },
  })
  const canvas = { getContext: () => ctx, width: 0, height: 0 } as unknown as HTMLCanvasElement
  const hud = new Hud(canvas)
  live.push(hud)
  return { hud, rec }
}

let live: Hud[] = []
afterEach(() => { for (const h of live.splice(0)) h.dispose() })

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  g.window = { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1 }
})

/** 基线：没有目标时那一趟的读数 */
const baseline = (): Recorder => {
  const { hud, rec } = makeHud()
  hud.projectEdge = () => ({ x: 100, y: 100, onScreen: true })
  hud.render(0, 0.016)
  return rec
}

describe('HUD 目标指示（KI-137）', () => {
  it('没有目标时不画指示（不占屏）', () => {
    const base = baseline()
    const { hud, rec } = makeHud()
    hud.projectEdge = () => ({ x: 100, y: 100, onScreen: true })
    hud.render(0, 0.016)
    expect(rec.strokes, '描边次数与基线相同').toBe(base.strokes)
    expect(rec.fills, '填充次数与基线相同').toBe(base.fills)
  })

  it('目标在画面里：画一枚菱形（描边，不填充）', () => {
    const base = baseline()
    const { hud, rec } = makeHud()
    hud.projectEdge = () => ({ x: 960, y: 540, onScreen: true })
    hud.objective = { x: 1, y: 2, z: 3 }
    hud.render(0, 0.016)
    expect(rec.strokes, '菱形多描一次边').toBe(base.strokes + 1)
    expect(rec.fills, '菱形不填充').toBe(base.fills)
    expect(rec.verts.length - base.verts.length, '菱形是四个顶点的多边形').toBe(4)
  })

  it('目标在画面外：画一枚箭头（填充的三角），位置用组合根给的那个', () => {
    const base = baseline()
    const { hud, rec } = makeHud()
    hud.projectEdge = () => ({ x: 1900, y: 540, onScreen: false })
    hud.objective = { x: 1, y: 2, z: 3 }
    hud.render(0, 0.016)
    expect(rec.fills, '箭头多填一次').toBe(base.fills + 1)
    const added = rec.translates.slice(base.translates.length)
    expect(added.some(([x, y]) => Math.abs(x - 1900) < 1 && Math.abs(y - 540) < 1), '箭头贴在组合根给的位置上').toBe(true)
  })

  it('投影没接时也不画（宁可没有，不要画在错的地方）', () => {
    const base = baseline()
    const { hud, rec } = makeHud()
    hud.objective = { x: 1, y: 2, z: 3 }
    hud.projectEdge = null
    hud.render(0, 0.016)
    expect(rec.strokes).toBe(base.strokes)
    expect(rec.fills).toBe(base.fills)
  })

  it('任务步变了 ⇒ marker 原样透传（引擎不解析世界坐标）', () => {
    makeHud()
    let seen: unknown = null
    bus.on('quest.changed', (p) => { seen = p.marker })
    bus.emit('quest.changed', {
      questId: 'q_bells', state: 'BELLS.STEP1_OPEN', index: 0, total: 8,
      label: '《裂舌的断面》', started: true, completed: false,
      marker: { kind: 'npc', id: 'npc_belltongue' },
    })
    expect(seen, 'marker 原样透传（解析世界坐标是 Objectives 那一层的事）').toEqual({ kind: 'npc', id: 'npc_belltongue' })
  })
})
