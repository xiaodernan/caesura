import { describe, expect, it } from 'vitest'
import {
  ObserveSystem,
  OBSERVE_FADE_TICKS,
  OBSERVE_PULSE_GAP,
  OBSERVE_RADIUS,
  OBSERVE_TRAVEL_TICKS,
  type ObserveTarget,
} from '@/world/Observe'

/** 按 held 语义跑 n 个 tick（每 tick 先 hold 再 update，与 main.ts 的喂法一致） */
function run(o: ObserveSystem, n: number, tick0: number, held: boolean, px = 0, pz = 0): number {
  for (let k = 0; k < n; k++) {
    o.hold(held)
    o.update(tick0 + k, px, pz)
  }
  return tick0 + n
}

/** 波前走 1m 需要的 tick 数（26m / 180tick ⇒ 每 tick 0.1444m） */
const TICKS_PER_M = OBSERVE_TRAVEL_TICKS / OBSERVE_RADIUS

describe('KI-105 包络：入场与退场都是 §43 写的那 0.5s（30 tick）', () => {
  it('按住 30 tick 走满到 1；第 29 tick 还没满', () => {
    const o = new ObserveSystem()
    const t = run(o, OBSERVE_FADE_TICKS - 1, 0, true)
    expect(o.strength).toBeLessThan(1)
    run(o, 1, t, true)
    expect(o.strength).toBe(1)
  })

  it('松手 30 tick 回到 0；中途是收拢不是断崖', () => {
    const o = new ObserveSystem()
    let t = run(o, OBSERVE_FADE_TICKS, 0, true)
    t = run(o, 10, t, false)
    expect(o.strength).toBeGreaterThan(0)
    expect(o.strength).toBeLessThan(1)
    run(o, OBSERVE_FADE_TICKS, t, false)
    expect(o.strength).toBe(0)
    expect(o.active).toBe(false)
  })
})

describe('KI-105 脉冲：声呐 ping 的生、速、死', () => {
  it('第一颗脉冲在入场走满之后那一下出生（tick 30）；按住不松每 GAP 再来一颗', () => {
    const o = new ObserveSystem()
    const t = run(o, OBSERVE_FADE_TICKS, 0, true)
    // 入场中（tick 0..29）一颗都不发
    expect(o.livePulses.length).toBe(0)
    o.hold(true)
    const born = o.update(t, 0, 0) // tick 30
    expect(born.length).toBe(1)
    expect(born[0].birthTick).toBe(OBSERVE_FADE_TICKS)
    run(o, OBSERVE_PULSE_GAP - 1, t + 1, true)
    expect(o.livePulses.length).toBe(1) // 期间不再发
    o.hold(true)
    expect(o.update(t + OBSERVE_PULSE_GAP, 0, 0).length).toBe(1) // 恰好在 GAP 到点的那 tick 发
    expect(o.livePulses.length).toBe(2)
  })

  it('波前按 26m/180tick 线性外扩，走满停在半径上', () => {
    const o = new ObserveSystem()
    const t = run(o, OBSERVE_FADE_TICKS, 0, true)
    o.hold(true)
    o.update(t, 0, 0)
    const p = o.livePulses[0]
    expect(o.frontRadius(p, t + 90)).toBeCloseTo(OBSERVE_RADIUS / 2, 10)
    expect(o.frontRadius(p, t + OBSERVE_TRAVEL_TICKS)).toBe(OBSERVE_RADIUS)
    expect(o.frontRadius(p, t + OBSERVE_TRAVEL_TICKS + 500)).toBe(OBSERVE_RADIUS)
  })

  it('走满行程（180 tick）之后退休；按住时新生交叠保证盘面不清场', () => {
    const o = new ObserveSystem()
    const t = run(o, OBSERVE_FADE_TICKS, 0, true)
    o.hold(true)
    o.update(t, 0, 0)
    const first = o.livePulses[0]
    run(o, OBSERVE_TRAVEL_TICKS + 2, t + 1, true) // 中途会再发几颗
    expect(o.livePulses.includes(first)).toBe(false)
    expect(o.livePulses.length).toBeGreaterThan(0) // 但盘面上还有活的
  })

  it('半途松手：不再发新脉冲；淡出完即使脉冲还活着也不显形', () => {
    const o = new ObserveSystem()
    let t = run(o, OBSERVE_FADE_TICKS, 0, true)
    o.hold(true)
    o.update(t, 0, 0)
    t = run(o, 10, t + 1, false)
    const before = o.livePulses.length
    o.hold(false)
    expect(o.update(t, 0, 0).length).toBe(0)
    expect(o.livePulses.length).toBe(before) // 活脉冲不因松手被摘（波的行程还在）
    run(o, OBSERVE_FADE_TICKS, t, false)
    expect(o.revealed(0, 0, t + OBSERVE_FADE_TICKS)).toBe(false)
  })
})

describe('KI-105 显形判据：圈就是判据，不是示意图', () => {
  /** 入场走满 + 波前跑出一段（100 tick ≈ 14.4m），仍在按住 */
  function fullAndPulse(): { o: ObserveSystem; tick: number } {
    const o = new ObserveSystem()
    let t = run(o, OBSERVE_FADE_TICKS, 0, true)
    t = run(o, 100, t + 1, true)
    return { o, tick: t }
  }

  it('圈内 true / 圈外 false', () => {
    const { o, tick } = fullAndPulse()
    expect(o.revealed(1, 0, tick)).toBe(true)
    expect(o.revealed(OBSERVE_RADIUS + 1, 0, tick)).toBe(false)
  })

  it('包络半开：有效半径收拢——13m 内看得见、20m 看不见', () => {
    const o = new ObserveSystem()
    let t = run(o, OBSERVE_FADE_TICKS, 0, true) // tick 30：第一颗脉冲出生
    t = run(o, 100, t + 1, true) // 波前跑到 ~14.4m
    t = run(o, 15, t, false) // 松手 15 tick：包络掉到一半
    expect(o.strength).toBeCloseTo(0.5, 5)
    // 波前早已扫过 5m 与 20m，但有效半径只剩 26×0.5=13：近的留、远的收
    expect(o.revealed(5, 0, t)).toBe(true)
    expect(o.revealed(20, 0, t)).toBe(false)
  })

  it('完全关着（从未按过）⇒ 一律 false', () => {
    const o = new ObserveSystem()
    o.update(0, 0, 0)
    expect(o.revealed(0, 0, 0)).toBe(false)
  })
})

describe('KI-105 标记账：每颗脉冲对每个目标只报一次', () => {
  const far: ObserveTarget = { id: 't_far', x: 20, y: 0, z: 0 }
  const near: ObserveTarget = { id: 't_near', x: 2, y: 0, z: 0 }

  it('波前还没扫到不报；扫到那 tick 报；下一 tick 不重复', () => {
    const o = new ObserveSystem()
    const t = run(o, OBSERVE_FADE_TICKS, 0, true)
    o.hold(true)
    o.update(t, 0, 0)
    const birth = t
    const nearHit = birth + Math.ceil(2 * TICKS_PER_M) // 2m 要 14 tick
    const farHit = birth + Math.ceil(20 * TICKS_PER_M) // 20m 要 139 tick，仍在 180 行程内
    o.hold(true)
    let marks = o.takeMarks([far, near], [], nearHit - 1)
    expect(marks.some((m) => m.id === 't_near')).toBe(false)
    marks = o.takeMarks([far, near], [], nearHit)
    expect(marks.some((m) => m.id === 't_near' && m.kind === 'enemy')).toBe(true)
    marks = o.takeMarks([far, near], [], nearHit + 1)
    expect(marks.length).toBe(0)
    marks = o.takeMarks([far, near], [], farHit)
    expect(marks.some((m) => m.id === 't_far')).toBe(true)
  })

  it('新脉冲（下一颗 ping）对同一目标重新报一次', () => {
    const o = new ObserveSystem()
    const t = run(o, OBSERVE_FADE_TICKS, 0, true) // 第一颗 @30
    o.hold(true)
    o.update(t, 0, 0)
    const first = o.takeMarks([near], [], t + Math.ceil(2 * TICKS_PER_M))
    expect(first.length).toBe(1)
    // 走到第二颗脉冲出生（@75），等**它自己的**波前扫到 2m 再取——第一颗的账不能再报
    const secondBirth = t + OBSERVE_PULSE_GAP
    run(o, secondBirth - t - 1, t + 1, true)
    o.hold(true)
    o.update(secondBirth, 0, 0)
    const second = o.takeMarks([near], [], secondBirth + Math.ceil(2 * TICKS_PER_M))
    expect(second.some((m) => m.id === 't_near')).toBe(true)
  })

  it('交互物与敌人共用同一颗波前，kind 分形状；闸门关着交还空账', () => {
    const o = new ObserveSystem()
    let t = run(o, OBSERVE_FADE_TICKS, 0, true)
    o.hold(true)
    o.update(t, 0, 0)
    const marks = o.takeMarks([near], [{ id: 'in_well', x: 3, y: 0, z: 0 }], t + 30)
    expect(marks.find((m) => m.id === 't_near')?.kind).toBe('enemy')
    expect(marks.find((m) => m.id === 'in_well')?.kind).toBe('interact')
    run(o, OBSERVE_FADE_TICKS + 2, t + 1, false)
    expect(o.takeMarks([near], [], t + OBSERVE_FADE_TICKS + 5).length).toBe(0)
  })
})
