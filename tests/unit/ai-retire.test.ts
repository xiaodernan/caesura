import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { AISystem } from '@/ai/AISystem'
import type { Enemy } from '@/ai/Enemy'
import type { PlayerController } from '@/player/ThirdPersonController'
import type { RhythmClock } from '@/core/RhythmClock'

/**
 * 尸体退役（AISystem.update 的收尾一拍）：倒地敌人 stateTick 熬过 3000 才从名单里
 * 拆走，并广播 `ai.retired`。退役是**名单层**的事——不发死亡事件、不给奖励
 * （那是击杀结算拍的事），所以这里只钉「什么时候拆、拆了说一声」。
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
  it('倒地熬过 3000 tick 的尸体被拆出名单并广播；活着的同伴不受牵连', () => {
    const ai = new AISystem()
    ai.enemies.push(fake('live', true, 99_999), fake('corpse', false, 3001))
    const retired: string[] = []
    const off = bus.on('ai.retired', (e) => retired.push(e.id))
    try {
      ai.update(0.016, 1, {} as unknown as PlayerController, rhythm)
    } finally {
      off()
    }
    expect(retired).toEqual(['corpse'])
    expect(ai.enemies.map((e) => e.id)).toEqual(['live'])
  })

  it('阈值是严格大于：stateTick 恰好 3000 的尸体还留在名单上', () => {
    const ai = new AISystem()
    ai.enemies.push(fake('stale', false, 3000))
    const retired: string[] = []
    const off = bus.on('ai.retired', (e) => retired.push(e.id))
    try {
      ai.update(0.016, 1, {} as unknown as PlayerController, rhythm)
    } finally {
      off()
    }
    expect(retired).toEqual([])
    expect(ai.enemies.map((e) => e.id)).toEqual(['stale'])
  })
})
