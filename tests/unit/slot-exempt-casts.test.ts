import { describe, expect, it } from 'vitest'
import { registry } from '@/core/Registry'
import { registerGameData } from '@/data'
import { Enemy } from '@/ai/Enemy'
import type { EnemyData } from '@/data/schema'

/**
 * KI-356：槽位闸的两条旁路到底是什么。
 *
 * KI-352 把「同屏最多 3 人同时出手」接到生产里之后，账上还留着两条不走 `tryAttack` 的路：
 * ① Boss 的 `maybeBarCast`（到点必须敲钟，§14.7）；② alert 态的 `beginCallAlly`（呼救）。
 * 本批的裁决不是「也给它们加闸」，而是先把豁免的前提说清并钉住：
 *
 * **§1.2 管的是「出手」= 会伤人的招式。** 这两条今天的伤害都是 0——敲钟是节拍器（走完回血），
 * 呼救是广播（不伤人）——所以它们不占围殴可读性的那三格。前提一旦坏了（数据把 barCast 改成
 * 伤人招式），豁免就不再成立，这条门必须先红：那时要么让它走槽位，要么改判并重写这一段。
 *
 * 三条腿：
 *  ① 数据里**每一处** `boss.phases[].barCast` 与 `ai.selfToll` 解析到的招式 `frames.damage === 0`；
 *  ② `beginCallAlly` 现场造出来的那一式也是 0 伤害（不是抄数据，是运行时读它真正装进 `attack` 的 spec）；
 *  ③ 分母不是空的：数据里至少有一处 barCast、一只带 callAlly 的敌人——否则①②在看空集合。
 */

registerGameData()

const enemyIds = (): string[] => registry.ids('en_')

describe('KI-356 槽位闸的两条旁路：零伤害的节拍器与呼救', () => {
  it('数据里每一处 barCast／selfToll 都是零伤害（豁免的前提，不是注释里的声称）', () => {
    const offenders: string[] = []
    let barCasts = 0
    let selfTolls = 0
    for (const id of enemyIds()) {
      const data = registry.get<EnemyData>(id)
      for (const phase of data.boss?.phases ?? []) {
        if (!phase.barCast) continue
        barCasts++
        const spec = data.attacks.find((a) => a.id === phase.barCast!.attackId)
        if (!spec) {
          offenders.push(`${id}／${phase.id}：barCast 指向不存在的招式 ${phase.barCast.attackId}`)
        } else if (spec.frames.damage !== 0) {
          offenders.push(`${id}／${phase.id}：${spec.id} damage=${spec.frames.damage}（会伤人 ⇒ 不能再绕开槽位）`)
        }
      }
      if (data.ai.selfToll) {
        selfTolls++
        const spec = data.attacks.find((a) => a.id === data.ai.selfToll!.attackId)
        if (!spec) {
          offenders.push(`${id}：selfToll 指向不存在的招式 ${data.ai.selfToll.attackId}`)
        } else if (spec.frames.damage !== 0) {
          offenders.push(`${id}：selfToll ${spec.id} damage=${spec.frames.damage}（会伤人 ⇒ 不能再绕开槽位）`)
        }
      }
    }
    expect(barCasts, '分母：数据里至少有一处 barCast，否则这条在看空集合').toBeGreaterThan(0)
    expect(selfTolls, '分母：数据里至少有一处 selfToll').toBeGreaterThan(0)
    expect(offenders, '这些「强制插入」已经会伤人；槽位闸必须重新裁决').toEqual([])
  })

  it('beginCallAlly 装进 attack 的那一式伤害是 0：呼救不算出手', () => {
    const base = registry.get<EnemyData>('en_driftsinger')
    const data: EnemyData = { ...base, ai: { ...base.ai, callAlly: { range: 14, broadcastTicks: 6 } } }
    const e = new Enemy(data, { x: 0, y: 0, z: 0 }, 'ki356-call')
    ;(e as unknown as { beginCallAlly(tick: number): void }).beginCallAlly(1)
    expect(e.attack?.spec.id, '走的是呼救那一式').toBe('callAlly')
    expect(e.attack?.spec.frames.damage, '呼救不伤人 ⇒ 不占攻击槽位').toBe(0)
  })

  it('分母不是空的：数据里确实有带 callAlly 的敌人，且它们与 barCast 不是同一只也算数', () => {
    const withCall = enemyIds().filter((id) => registry.get<EnemyData>(id).ai.callAlly)
    expect(withCall.length, '至少一只敌人带 callAlly（否则第二条腿的现场替身没有现实对应）').toBeGreaterThan(0)
  })
})
