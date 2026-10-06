import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { Haptics, mapShakeToRumble } from '@/input/Haptics'
import type { Input } from '@/core/Input'

/**
 * §12 手柄振动的异常腿：actuator 在但 `playEffect` 抛了（浏览器里文档不可见等环境态会这样）
 * 也要静默降级——振动永远不许把战斗反馈总线炸出异常。没有 actuator 的 no-op 腿在无手柄
 * 环境下每次构造都会走到（feature-detect 那一格），这里只钉「在而抛」的这一格。
 */

const hit = (): void => {
  bus.emit('combat.hit', {
    attackerId: 'p1', victimId: 'en_1', damage: 8, poiseDamage: 5,
    kind: 'light', point: { x: 0, y: 1, z: 0 }, dir: { x: 0, y: 0, z: 1 },
    result: 'hit', hitStopMs: 40, shakeKey: 'normal', backstab: false, weakpoint: false
  })
}

describe('Haptics：actuator 抛错静默降级', () => {
  it('playEffect 抛错不外泄；表值映射顺带对账（execute 行 KI-053）', () => {
    let calls = 0
    new Haptics({
      gamepad: { vibrationActuator: { playEffect: () => { calls++; throw new Error('actuator busy') } } }
    } as unknown as Input)
    expect(() => hit(), '抛错被 catch 吃掉，不许冒泡').not.toThrow()
    expect(calls, '异常发生前调用确确实实发生了').toBe(1)
    const r = mapShakeToRumble('execute')
    expect(r.durationMs).toBe(120)
    expect(r.strong).toBeCloseTo(0.4, 6)
    expect(r.weak).toBeCloseTo(0.4, 6)
    expect(mapShakeToRumble('nobody').durationMs, '认不出的档位退回 graze').toBe(40)
  })
})
