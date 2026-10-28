/**
 * `burst` 与「弓的分叉」之间那条**代用**关系的守卫（KI-334 的收尾）。
 *
 * KI-334 把分叉的枝数改成「只加在声明了 `burst` 的式子上」——
 * `launchPlayerProjectile`：`spec.burst ? spec.burst.count + bowForkBranches : 1`。
 * 这是对的（设计四处引文都说分叉是弓的独有腿），但它同时让实现**依赖**一个数据前提：
 * **今天全仓只有弓的满弓声明了 `burst`**。
 *
 * 那个前提没人钉。`tests/flow/milestone-rank12.test.ts` 的腿④ 枚举的是**今天那六式**
 * （弓的速射/重击/跳跃 + 杖的共振弹 + 枪的投掷），逐式问「rank11 与 rank12 的发数是否一样」——
 * 它看不见**新加进来的**第七式。谁给杖或枪加一个多发（`burst` 本来就是通用的多发字段，
 * 不是弓的专属），rank12 的 `bowForkBranches` 会静默加到那把武器上，而且那一枝吃**满伤**
 * （`branchDamageMul` 的 0.6 折只挂在 burst 的枝上）⇒ 正是 KI-334 修掉的那个形状，从另一个门回来。
 *
 * 所以这里钉的不是「弓能分叉」（那条行为腿已经钉了），是**代用关系的前提**：
 * 声明 `burst` 的式子只能是 `ms_bow.charged`。将来真要给别的武器加多发，
 * 先把分叉判据从 `burst` 上拆下来（按武器/招式判定），再来改这一格——
 * 红不是惩罚，是提醒「这一处要改两行」。
 */
import { describe, expect, it } from 'vitest'
import { movesetsRaw } from '@/data'
import type { MovesetData } from '@/data/schema'

const movesets = movesetsRaw as unknown as MovesetData[]

describe('burst 的作用域：分叉的枝数只该加在弓的满弓上（KI-334 的前提）', () => {
  /** 全仓所有「声明了 burst」的式子，写成 `movesetId.actionKey` */
  const withBurst: string[] = []
  for (const m of movesets) {
    for (const [key, action] of Object.entries(m.actions ?? {})) {
      if (action?.projectile?.burst) withBurst.push(`${m.id}.${key}`)
    }
  }

  it('全仓只有 ms_bow.charged 声明 burst —— 别处加多发之前先拆开 bowForkBranches 的耦合', () => {
    expect(
      withBurst.sort(),
      'burst 今天被当成「这是弓」的替身（KI-334：枝数只加在声明了 burst 的式子上）。'
        + '给非弓的式子加 burst ⇒ rank12 的 bowForkBranches 会静默加到它身上（多发、且那一枝吃满伤）。'
        + '真要加，先把分叉判据从 burst 上拆下来（按武器/招式判定），再来改这一格。',
    ).toEqual(['ms_bow.charged'])
  })

  it('满弓的底数是 3 发（1 主箭 + 设计 §4.4 的「泛音分叉 2 枝」）', () => {
    const bow = movesets.find((m) => m.id === 'ms_bow')
    expect(bow, 'ms_bow 不在表里 ⇒ 这一格谈不上').toBeDefined()
    const charged = bow!.actions.charged
    expect(charged?.projectile?.burst?.count, '满弓的 burst.count（含主箭）').toBe(3)
  })
})
