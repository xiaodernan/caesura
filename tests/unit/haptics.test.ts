import { describe, expect, it, vi } from 'vitest'
import { bus } from '@/core/EventBus'
import { Haptics, mapShakeToRumble } from '@/input/Haptics'
import type { Input } from '@/core/Input'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function emitHit(shakeKey: string): void {
  bus.emit('combat.hit', {
    attackerId: 'player', victimId: 'x', damage: 1, poiseDamage: 0, kind: 'light',
    point: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: 0 }, result: 'hit',
    hitStopMs: 60, shakeKey, backstab: false, weakpoint: false
  } as any)
}

describe('gamepad haptics (§64)', () => {
  it('maps shake tiers to escalating rumble, unknown -> graze', () => {
    expect(mapShakeToRumble('graze').strong).toBeLessThan(mapShakeToRumble('boss').strong)
    expect(mapShakeToRumble('parry').weak).toBeLessThan(mapShakeToRumble('parry').strong)
    expect(mapShakeToRumble('nope').durationMs).toBe(mapShakeToRumble('graze').durationMs)
  })

  it('处决档（KI-053）：不发明新尺子——strong 借 normal↔hurt 之间，整档轻于 heavy', () => {
    const ex = mapShakeToRumble('execute')
    expect(ex.strong, '轻于 heavy：分量在推轨与消音，手柄只标那一刀落下').toBeLessThan(mapShakeToRumble('heavy').strong)
    expect(ex.strong).toBeGreaterThan(mapShakeToRumble('normal').strong)
    expect(ex.strong).toBeLessThan(mapShakeToRumble('hurt').strong)
    expect(ex.durationMs, '单发比擦过长、比破防短').toBeGreaterThan(mapShakeToRumble('graze').durationMs)
    expect(ex.durationMs).toBeLessThan(mapShakeToRumble('heavy').durationMs)
  })

  it('drives a connected pad actuator with the right params on combat.hit', () => {
    const playEffect = vi.fn()
    const input = { gamepad: { vibrationActuator: { playEffect } } } as unknown as Input
    new Haptics(input)
    emitHit('heavy')
    expect(playEffect).toHaveBeenCalledTimes(1)
    expect(playEffect.mock.calls[0][0]).toBe('dual-rumble')
    expect(playEffect.mock.calls[0][1]).toMatchObject({ duration: 180, strongMagnitude: 0.8, weakMagnitude: 0.5 })
  })

  it('is a safe no-op when no pad is connected', () => {
    const input = { gamepad: null } as unknown as Input
    new Haptics(input)
    expect(() => emitHit('normal')).not.toThrow()
  })

  it('actuator 在但 playEffect 抛错 ⇒ 静默降级（catch 腿此前没有读者）', () => {
    // 浏览器里文档不可见等环境态会让 playEffect 抛错：振动永远不许把战斗反馈总线炸出异常
    let calls = 0
    const input = {
      gamepad: { vibrationActuator: { playEffect: () => { calls++; throw new Error('actuator busy') } } }
    } as unknown as Input
    new Haptics(input)
    expect(() => emitHit('heavy'), '抛错被 catch 吃掉，不许冒泡').not.toThrow()
    expect(calls, '异常发生前调用确实发生了').toBe(1)
  })
})

/**
 * KI-359：ui-ux §6「手柄支持」那一行写的是「振动强度 0–200% 分（**弱/强马达独立**）」，
 * 而今天只有一个 `scale`，`pulse` 把同一个数乘在 `strongMagnitude` 与 `weakMagnitude` 两格上
 * （面板那一行的注语甚至自己写着「弱/强马达同一把尺」）。表里七档的两格比例本来各不相同
 * （parry 0.7/0.2、graze 0.15/0.35），所以"一把尺"不是"少一个把手"，是**玩家调不动设计里那两格**。
 */
describe('KI-359 振动的两把尺：弱马达第一次有自己的数', () => {
  /** 每一发都喂**一个新实例**：限流（16ms）是按实例算的，共用实例会把第二发悄悄吃掉 */
  function pulse(scale: number, weakScale: number, shakeKey: string): Record<string, number> {
    const sink: Record<string, number>[] = []
    const h = new Haptics({
      gamepad: { vibrationActuator: { playEffect: (_t: string, p: Record<string, number>) => { sink.push(p) } } }
    } as unknown as Input)
    h.scale = scale
    h.weakScale = weakScale
    emitHit(shakeKey)
    expect(sink.length, '这一发必须真的落到 actuator 上（没落到的话下面全是空话）').toBe(1)
    return sink[0]
  }

  it('两把尺各乘各的：只砍强马达，弱那一格逐字不动', () => {
    const p = pulse(0.5, 1, 'heavy') // heavy 表值 strong 0.8 / weak 0.5
    expect(p.strongMagnitude, '强那一格乘 0.5').toBeCloseTo(0.4)
    expect(p.weakMagnitude, '旧写法这里是 0.25——别人的尺不许乘到这一格').toBeCloseTo(0.5)
  })

  it('弱马达单独关掉（玩家要的就是这一格），而强那一格仍是表里的原样', () => {
    const p = pulse(1, 0, 'parry') // parry 是 0.7/0.2：两格比例与 heavy 相反，正是"一把尺"最说不通的那一档
    expect(p.strongMagnitude).toBeCloseTo(0.7)
    expect(p.weakMagnitude, '关到 0 说的是「这一格我不要」，不是「这一档没有」').toBe(0)
  })

  it('各自在 Gamepad API 顶格 1 处截断，而不是两格合起来再截', () => {
    const a = pulse(2, 0.2, 'boss') // boss strong 1.0 / weak 0.8
    expect(a.strongMagnitude, '1.0×2 到顶').toBe(1)
    expect(a.weakMagnitude, '顶格那一刀只落在强这一格：0.8×0.2=0.16').toBeCloseTo(0.16)
    const b = pulse(0.2, 2, 'normal') // normal strong 0.3 / weak 0.5
    expect(b.strongMagnitude).toBeCloseTo(0.06)
    expect(b.weakMagnitude, '0.5×2 恰好到顶，不许多出 1 之外的数').toBe(1)
  })

  it('时长两把尺都不乘：200% 是更用力，不是振更久（时值是节拍回报的一部分）', () => {
    expect(pulse(2, 2, 'boss').duration, '两格都顶格而时长仍是表里的 320').toBe(320)
    expect(pulse(0, 0, 'boss').duration, '两把都关到 0 也不动时长——那是「没有触感」，不是「触感很短」').toBe(320)
  })

  it('两个数的默认都是 1 ⇒ 与「一把尺」的旧行为逐字相等（老档没这一格不许改手感）', () => {
    const h = new Haptics({ gamepad: null } as unknown as Input)
    expect(h.scale).toBe(1)
    expect(h.weakScale, '新格默认 1 就是把今天的行为原样登记下来').toBe(1)
  })
})
