import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData } from '@/data'
import { bindEnemyRegistry, Enemy } from '@/ai/Enemy'
import type { EnemyData } from '@/data/schema'
import type { PlayerController } from '@/player/ThirdPersonController'

/**
 * Enemy 状态机两条没有读者的腿第一次有读者（覆盖尾巴清账）：
 * 1. tryAttack 选中 `scream` ⇒ 读条走完那一刻向同伴广播 ai.callAlly。现有 JSON 的任何
 *    距离带都没把 'scream' 写进 actions，这条腿是数据驱动的引擎能力——这里把漂调者的
 *    距离带改写成只点名 scream，直接点亮它（alert 态的 beginCallAlly 广播由 elite.test
 *    盯着，两条通道互不相扰）。
 * 2. retreat 向最近的活同伴靠拢。nearestAlly 的循环体此前从未跑过：注册表里没有第二个
 *    活人时 `o === e || !o.alive` 全部 continue，查了个寂寞。
 * update 的依赖面其实只有 `player.pos`（不配 hearsHeartbeat ⇒ 不读玩家的动静），
 * 用最小假身，不牵动 PlayerController 全家。
 */

registerGameData()

const driftData = (over: Partial<EnemyData['ai']> = {}): EnemyData => {
  const base = registry.get<EnemyData>('en_driftsinger')
  return { ...base, ai: { ...base.ai, ...over } }
}

const fakePlayer = (x: number, z: number): PlayerController =>
  ({ pos: { x, y: 0, z } }) as unknown as PlayerController

describe('Enemy 状态机的两条暗腿', () => {
  it('距离带点名 scream ⇒ 起手帧走完恰好广播一次（range 来自 ai.callAlly）', () => {
    const e = new Enemy(driftData({ distBands: [{ min: 0, max: 99, actions: ['scream'] }] }), { x: 0, y: 0, z: 0 }, 'scream-a')
    const calls: Array<{ fromId: string; range: number }> = []
    const off = bus.on('ai.callAlly', (p) => calls.push({ fromId: p.fromId, range: p.range }))
    const rhythm = new RhythmClock()
    rhythm.setBpm(84, 4)
    e.enter('combat')
    e.alertness = 100
    let tick = 0
    const step = (): void => e.update(TICK_DT, ++tick, fakePlayer(3, 0), rhythm, () => false)
    step()
    expect(e.attack?.spec.id, '带内唯一候选 ⇒ 第一拍就选中 scream').toBe('scream')
    for (let i = 0; i < 400 && calls.length === 0; i++) step()
    expect(calls.length, '读条走完那一格恰好广播一次').toBe(1)
    expect(calls[0]).toEqual({ fromId: e.id, range: 18 })
    off()
  })

  it('retreat 向最近的活同伴靠拢：+x 侧的伙伴把背退拉力几乎抵消', () => {
    const a = new Enemy(driftData(), { x: 0, y: 0, z: 0 }, 'retreat-a')
    const b = new Enemy(driftData(), { x: 10, y: 0, z: 0 }, 'retreat-b')
    bindEnemyRegistry([a, b])
    const rhythm = new RhythmClock()
    rhythm.setBpm(84, 4)
    a.enter('combat')
    a.alertness = 100
    a.stats.hp = 10 // 漂调者 hp 70、retreatHpFrac 0.25 ⇒ 10 ≤ 17.5 破线
    let tick = 0
    const step = (): void => a.update(TICK_DT, ++tick, fakePlayer(2, 0), rhythm, () => false)
    step()
    expect(a.state, '血线破线 ⇒ combat 分流进 retreat').toBe('retreat')
    const x0 = a.pos.x
    for (let i = 0; i < 100; i++) step()
    expect(a.state, '距玩家仅 2m、血未回 ⇒ 一直在退').toBe('retreat')
    // 纯背退（没有同伴可投奔）100 tick 会把 x 推到 -1.1·4·dt·100 ≈ -7.3；
    // 同伴在 +x 侧以同速往回拉 ⇒ 净剩 -0.1·4·dt·100 ≈ -0.67
    expect(a.pos.x).toBeLessThan(x0)
    expect(a.pos.x).toBeGreaterThan(-2)
  })
})
