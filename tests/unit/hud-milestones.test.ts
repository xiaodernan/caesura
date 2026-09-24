import { describe, expect, it, beforeAll, afterEach } from 'vitest'
import { registerGameData } from '@/data'
import { registry } from '@/core/Registry'
import { bus } from '@/core/EventBus'
import type { ProgressionData } from '@/data/schema'
import { Hud } from '@/ui/Hud'

/**
 * §8.2 两条 UI 腿（KI-031①）：ms_beat_ripple 的涟漪刻度与 ms_crit_ring 的暴击飘字泛音环。
 *
 * 本仓库零 DOM 测试环境（零新增依赖策略），这里用**最薄的画布替身**：ctx 是一层 Proxy，
 * 记录 stroke 的 strokeStyle 与 fillText 的文本；"金色环有没有画"从替身里数，
 * "涟漪/飘字有没有进账"读 Hud 的私有状态数组。视口排版评审仍受 KI-010 限制。
 *
 * 关键纪律（KI-053 的漏检教训）：Hud 构造会挂常驻总线订阅——**每个实例必须 dispose**，
 * 否则 combat.hit/ripple 记账会漏进别的用例。
 */

interface Recorder {
  strokes: string[]
  texts: string[]
}

function makeHud(): { hud: Hud; rec: Recorder } {
  const rec: Recorder = { strokes: [], texts: [] }
  const store: Record<string, unknown> = {}
  const grad = { addColorStop: () => {} }
  const ctx = new Proxy(store, {
    get(t, k: string) {
      if (k in t) return t[k]
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad
      if (k === 'measureText') return () => ({ width: 10 })
      if (k === 'stroke') return () => { rec.strokes.push(String(t.strokeStyle ?? '')) }
      if (k === 'fillText') return (txt: unknown) => { rec.texts.push(String(txt)) }
      return () => {}
    },
    set(t, k: string, v) { t[k] = v; return true }
  })
  const canvas = { getContext: () => ctx, width: 0, height: 0 } as unknown as HTMLCanvasElement
  const hud = new Hud(canvas)
  live.push(hud)
  return { hud, rec }
}

let live: Hud[] = []
const GOLD = 'rgba(201,180,88' // Hud.css 的逗号后没有空格——前缀抄错一个空格就永远数不到

beforeAll(() => {
  registerGameData()
  const g = globalThis as unknown as Record<string, unknown>
  g.window = { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1 }
})

afterEach(() => {
  for (const h of live) h.dispose()
  live = []
})

function stats(rank: number): void {
  bus.emit('player.stats', {
    hp: 100, hpMax: 100, stamina: 100, staminaMax: 100,
    poise: 100, poiseMax: 100, overdrive: 0, overdriveMax: 10,
    rank, corruption: 0, corruptionMax: 100, corruptionVeil: 0, muteTicksLeft: 0
  })
}

function beat(): void {
  bus.emit('rhythm.beat', { beatIndex: 0, beatInBar: 0, bar: 0, isBarStart: true, phase: 0 })
}

function critHit(damage = 77, over: Record<string, unknown> = {}): void {
  bus.emit('combat.hit', {
    attackerId: 'player', victimId: 'en_test', damage, poiseDamage: 0, kind: 'light',
    point: { x: 1, y: 2, z: 3 }, dir: { x: 0, y: 0, z: 1 }, result: 'hit',
    hitStopMs: 0, shakeKey: 'light', backstab: false, weakpoint: false, crit: true, ...over
  })
}

const peek = (hud: Hud, key: string): { age: number; value?: number }[] =>
  (hud as unknown as Record<string, { age: number; value?: number }[]>)[key]

const msRow = (id: string) =>
  registry.get<ProgressionData>('progression').milestones.find((m) => m.id === id)!

describe('ms_beat_ripple：拍点涟漪按表里的 rank 放行', () => {
  it('rank2 不荡圈；跨过表值 rank3 起每拍一圈；0.9s 后自己退场（不留常驻谎言）', () => {
    const { hud } = makeHud()
    stats(2)
    beat()
    expect(peek(hud, 'ripples').length, 'rank2：表说还没解锁').toBe(0)
    stats(3)
    beat()
    expect(peek(hud, 'ripples').length, 'rank3：这一拍起该看得见踏音时点了').toBe(1)
    for (let i = 0; i < 56; i++) hud.render(0, 1 / 60)
    expect(peek(hud, 'ripples').length, '0.9 秒走完，涟漪必须清零').toBe(0)
  })

  it('开关是表行本身：改表法抬到 99 立刻不亮、删行永不亮，还原分毫不差', () => {
    const d = registry.get<ProgressionData>('progression')
    const backup = JSON.parse(JSON.stringify(d.milestones))
    const idx = d.milestones.findIndex((m) => m.id === 'ms_beat_ripple')
    const { hud } = makeHud()
    stats(9)
    d.milestones[idx].rank = 99
    beat()
    expect(peek(hud, 'ripples').length, 'rank 抬到 99：现查现用，不是构造期快照').toBe(0)
    d.milestones.splice(idx, 1)
    beat()
    expect(peek(hud, 'ripples').length, '删行 = 拔腿：功能永不亮（validator 的另一半由 UI_BOUND 清单盯）').toBe(0)
    d.milestones = backup
    beat()
    expect(peek(hud, 'ripples').length, '还原后照常亮').toBe(1)
  })
})

describe('ms_crit_ring：暴击飘字与金色泛音环', () => {
  it('只有玩家→敌人的暴击 hit 进账；非暴击/挨打/格挡都不飘；1.1s 后清零', () => {
    const { hud } = makeHud()
    stats(8)
    critHit(77)
    expect(peek(hud, 'floaters').length).toBe(1)
    critHit(50, { crit: false })
    critHit(50, { attackerId: 'en_test', victimId: 'player' })
    critHit(50, { result: 'block' })
    expect(peek(hud, 'floaters').length, '三条负例一条都不许进账').toBe(1)
    expect(peek(hud, 'floaters')[0].value).toBe(77)
    for (let i = 0; i < 67; i++) hud.render(0, 1 / 60)
    expect(peek(hud, 'floaters').length).toBe(0)
  })

  it('环是 rank8 起挂在飘字上：rank7 零金环、rank8 起环、改表 99 又断环（单帧取样数环）', () => {
    const row = msRow('ms_crit_ring')
    const backupRank = row.rank
    const { hud, rec } = makeHud()
    hud.project = (p) => ({ x: 960 + p.x, y: 540 + p.y })
    const goldOneFrame = (): number => {
      rec.strokes.length = 0
      hud.render(0, 1 / 60) // 起环那一帧：只有最内圈扩开（外两圈要等字飘起来）
      return rec.strokes.filter((s) => s.startsWith(GOLD)).length
    }
    stats(7)
    critHit()
    expect(goldOneFrame(), 'rank7：字照飘，环是承诺给 rank8 的').toBe(0)
    expect(rec.texts.filter((t) => t === '77').length, '暴击数字本体不分 rank').toBe(1)
    for (let i = 0; i < 67; i++) hud.render(0, 1 / 60) // 等字走完，账上只留新的一条
    stats(8)
    critHit()
    expect(goldOneFrame(), 'rank8：最内圈泛音环挂上').toBe(1)
    row.rank = 99
    expect(goldOneFrame(), '改表法：环的开关也是表行（现查现用）').toBe(0)
    row.rank = backupRank
    expect(goldOneFrame(), '还原后环回来').toBe(1)
  })

  it('投影没接/点在相机背后：账照记、画不出来（隐藏标签页 0×0 视口的现实形状）', () => {
    const { hud, rec } = makeHud()
    stats(8)
    critHit()
    hud.render(0, 1 / 60)
    expect(peek(hud, 'floaters').length).toBe(1)
    expect(rec.texts.filter((t) => t === '77').length, '没接 project 就不该画').toBe(0)
    hud.project = () => null
    for (let i = 0; i < 4; i++) hud.render(0, 1 / 60)
    expect(peek(hud, 'floaters').length, '相机外的点不画，但寿命照走').toBeGreaterThan(0)
  })
})

describe('表行对账：UI 腿的 rank 就是表里的 rank', () => {
  it('ms_beat_ripple=rank3、ms_crit_ring=rank8（label 承诺与承载体同一条命）', () => {
    expect(msRow('ms_beat_ripple').rank).toBe(3)
    expect(msRow('ms_crit_ring').rank).toBe(8)
    expect(msRow('ms_beat_ripple').label).toContain('涟漪')
    expect(msRow('ms_crit_ring').label).toContain('泛音环')
  })
})
