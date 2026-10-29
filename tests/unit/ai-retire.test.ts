import { describe, expect, it } from 'vitest'
import { AISystem } from '@/ai/AISystem'
import type { Enemy } from '@/ai/Enemy'
import type { PlayerController } from '@/player/ThirdPersonController'
import type { RhythmClock } from '@/core/RhythmClock'

/**
 * 尸体退役（AISystem.update 的收尾一拍）：倒地敌人 stateTick 熬过 3000 才从名单里拆走。
 * 退役是**名单层**的事——不发死亡事件、不给奖励（那是击杀结算拍的事），
 * 所以这里钉两件事：「什么时候拆」与「拆的时候小队名册也跟着收」。
 *
 * **KI-354**：此前只从 `enemies` splice，`Squad` 里那份引用没人收——尸体走了、
 * 名册还在，逐 tick 衰减永不出队（长局里是一条只会长不会短的表）。
 * `ai.retired` 那条"说一声"的频道生产读方为 0，本批连同声明一起删：观察面改成
 * 名单本身（`enemies` 与 `squadSystem.getMember()`），比一条只有测试在听的广播更硬。
 */

const rhythm = { restoreHome: () => {}, overrideTo: () => {} } as unknown as RhythmClock

/** 最小敌人替身：update 循环读什么就给什么，感知/招式/光环全不参与 */
function fake(id: string, alive: boolean, stateTick: number): Enemy {
  return {
    id, alive, stateTick, pos: { x: 0, y: 0, z: 0 }, buff: null, nav: null,
    data: { id: 'en_fake', ai: {} },
    update: () => {},
  } as unknown as Enemy
}

describe('ai.retired：尸体退役', () => {
  it('倒地熬过 3000 tick 的尸体被拆出名单，小队名册同步除名；活着的同伴不受牵连', () => {
    const ai = new AISystem()
    const live = fake('live', true, 99_999)
    const corpse = fake('corpse', false, 3001)
    ai.enemies.push(live, corpse)
    ai.squadSystem.register(live)
    ai.squadSystem.register(corpse)

    ai.update(0.016, 1, {} as unknown as PlayerController, rhythm)

    expect(ai.enemies.map((e) => e.id)).toEqual(['live'])
    expect(ai.squadSystem.getMember('corpse'), '尸体走了、名册也要收').toBeUndefined()
    expect(ai.squadSystem.getMember('live'), '活人还在名册里').toBeDefined()
  })

  it('阈值是严格大于：stateTick 恰好 3000 的尸体还留在名单上', () => {
    const ai = new AISystem()
    const stale = fake('stale', false, 3000)
    ai.enemies.push(stale)
    ai.squadSystem.register(stale)

    ai.update(0.016, 1, {} as unknown as PlayerController, rhythm)

    expect(ai.enemies.map((e) => e.id)).toEqual(['stale'])
    expect(ai.squadSystem.getMember('stale'), '没到阈值 ⇒ 名册也不动').toBeDefined()
  })
})
