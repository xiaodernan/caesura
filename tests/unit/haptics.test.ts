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
