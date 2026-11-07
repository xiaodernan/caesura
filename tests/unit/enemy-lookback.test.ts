import { describe, expect, it } from 'vitest'
import { registry } from '@/core/Registry'
import { registerGameData } from '@/data'
import type { EnemyData } from '@/data/schema'
import { Enemy } from '@/ai/Enemy'

/**
 * `Enemy.armLookBack(everyTicks, holdTicks, anchor)` 的「disarm」一半——
 * `everyTicks <= 0` 的那四条腿（KI-403 的注释只写了调用方按 `RhythmClock` 换算好再装表、
 * 唯一调用方是 `CombatManager.beatLossMoment` 且只在 `lookBackEvery > 0` 时调）。
 *
 * 这不是死代码：它是「这面鼓之后不再回头」的取消通道，是一个公开方法的半边——
 * 删掉它 = 让「关掉这只怪的回头」没有入口。测试钉住的是这个语义本身，不是硬凑覆盖：
 *
 *  ① 装表后调用 `armLookBack(0, holdTicks, 新anchor)` ⇒ `lookBackEveryTicks`／`lookBackRemainTicks` 归零；
 *  ② `anchor` 分支**先于**每 tick 数判据执行：disarm 时新锚点仍然生效（换位的鼓位置要记住——下次再装表
 *     用的是新锚点），不清锚、不清岗位角；
 *  ③ `holdTicks` 与 `lookBackNextTicks` 不动——disarm 只摘时钟，不重写倒计时
 *     （上层要把钟完整拆掉，靠的是这两格以后永远不再有人推进它们）；
 *  ④ `anchor` 不带时仍能单独调用（不带参数 = 只停时钟，锚点原样留着）。
 */
registerGameData()

const bare = (): EnemyData => JSON.parse(JSON.stringify(registry.get<EnemyData>('en_tympanus')))

describe('Enemy.armLookBack：disarm（everyTicks ≤ 0）', () => {
  it('装表再 disarm：EveryTicks/RemainTicks 归零，anchor 换成新的那个', () => {
    const e = new Enemy(bare(), { x: 0, y: 0, z: 0 }, 'e0')
    e.armLookBack(686, 43, { x: 0, y: 0, z: -6 })
    expect(e.lookBackEveryTicks).toBe(686)

    e.armLookBack(0, 43, { x: 0, y: 0, z: 1 }) // 另一个锚点，同一函数的 disarm 半边
    expect(e.lookBackEveryTicks, 'disarm：回头时钟摘掉').toBe(0)
    expect(e.lookBackRemainTicks, 'disarm：残余也摘掉').toBe(0)
    expect(e.searchAnchor!.z, 'disarm 时 anchor 仍按新锚点落下').toBeCloseTo(1, 6)
  })

  it('everyTicks = 0 精确边界：不会误判成「时钟没装」', () => {
    const e = new Enemy(bare(), { x: 0, y: 0, z: 0 }, 'e1')
    e.armLookBack(0, 43)
    expect(e.lookBackEveryTicks).toBe(0)
    expect(e.lookBackRemainTicks).toBe(0)
    expect(e.searchAnchor, '没 anchor 就不动锚点').toBeNull()
  })

  it('everyTicks 是负数：同一 disarm 分支，不抛不进正半边', () => {
    const e = new Enemy(bare(), { x: 0, y: 0, z: 0 }, 'e2')
    e.armLookBack(10, 2, { x: 0, y: 0, z: 0 })
    e.armLookBack(-5, 2) // 负数同样是「摘掉」：不装时钟也不抛
    expect(e.lookBackEveryTicks).toBe(0)
    expect(e.lookBackRemainTicks).toBe(0)
    expect(e.searchAnchor?.z, '负数 disarm 不带 anchor 时锚点不动').toBe(0)
  })
})
