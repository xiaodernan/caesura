import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { QuestData } from '@/data/schema'

/**
 * **每一步任务都要有一处台词落点**（KI-140）。
 *
 * **病**：任务表里的一步只有 `label`（HUD 上那行字）与 `advanceOn`，却**没有任何对话节点接它**
 * ⇒ 玩家走得到这一步、看得见那行字、然后什么也没发生。那一步是"只有一行 label 的空步"，
 * 而账本读起来像是"这一步落了"（表里有它、门禁也认它）。
 *
 * **三种落法都算数**（判准是"玩家能不能在这一步看到戏"，不是"表里有没有这个 state"）：
 *   ① 某个节点的 condition 直接点了这一 step 的 state；
 *   ② 某个节点的 condition 点的是这一步的 advanceOn **旗标**（"修好钟之后她说什么"那种以旗为闸门的场景）；
 *   ③ 某个节点的**效果**写了这一步的 advanceOn **状态**（"你在 h0 里落笔 ⇒ 任务顺推到步 4"那种——
 *      断弦线的《义体尽头的拍子》就在这一族，它的 state 串从不出现在任何 condition 里）。
 *
 * **判据的判据**：总体 = 全表任务步数（现读，不手钉）；"有落点"的那一族要各自有实例，
 * 否则这条门会绿在"判据自己失效"上。
 */
const root = fileURLToPath(new URL('../..', import.meta.url))
const quests = JSON.parse(readFileSync(root + 'src/data/json/quests.json', 'utf8')) as QuestData[]
const dialogues = JSON.parse(readFileSync(root + 'src/data/json/dialogue.json', 'utf8')) as unknown[]
const dblob = JSON.stringify(dialogues)

const allSteps = quests.flatMap((q) => q.steps.map((s) => ({ quest: q.id, step: s })))

describe('每一步任务都要有台词落点（KI-140）', () => {
  it('总体不是空的（判据不许在空扫描上白送绿）', () => {
    expect(quests.length, '任务线数').toBeGreaterThanOrEqual(5)
    expect(allSteps.length, '任务步总数').toBeGreaterThanOrEqual(20)
  })

  it('没有"只有一行 label"的空步', () => {
    const gaps: string[] = []
    for (const { quest, step } of allSteps) {
      const flags = step.advanceOn?.flags ?? []
      const st = step.advanceOn?.state
      const byState = dblob.includes(`"${step.state}"`)
      const byFlag = flags.some((f) => dblob.includes(`"${f}"`))
      const byValue = !!st && dblob.includes(`"${st.key}"`) && (st.in ?? []).some((v) => dblob.includes(`"${v}"`))
      if (!byState && !byFlag && !byValue) gaps.push(`${quest}/${step.state}  ${step.label}`)
    }
    expect(gaps, '这些任务步在对话里没有任何落点：玩家走得到、看得见那行字、然后什么也没发生').toEqual([])
  })

  it('三种落法各自都有实例（判据不许自己变窄）', () => {
    let byState = 0
    let byFlag = 0
    let byValue = 0
    for (const { step } of allSteps) {
      const flags = step.advanceOn?.flags ?? []
      const st = step.advanceOn?.state
      if (dblob.includes(`"${step.state}"`)) byState++
      else if (flags.some((f) => dblob.includes(`"${f}"`))) byFlag++
      else if (st && dblob.includes(`"${st.key}"`) && (st.in ?? []).some((v) => dblob.includes(`"${v}"`))) byValue++
    }
    expect(byState, '按 state 落的那种').toBeGreaterThan(0)
    expect(byFlag, '按旗落的那种').toBeGreaterThan(0)
    expect(byValue, '按状态效果落的那种').toBeGreaterThan(0)
  })

  it('每一步的 label 都要有内容（空 label ＝ 屏幕上那行字是空的）', () => {
    for (const { quest, step } of allSteps) {
      expect(step.label.length, `${quest}/${step.state} 的 label`).toBeGreaterThan(0)
    }
  })
})
