import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Quests } from '@/quest/Quests'
import type { QuestData } from '@/data/schema'

/**
 * 《余响归位》落档叙事相（2026-11-15 · F-96 候选的第一步）：
 * 石版（DLG_TABLET）发一条纯巡礼线，四步全部锚定**已有对话写手**产生的旗标——
 * 零新台词、零新旗标、零新状态，是《止音纪元》第七条线的首个可玩骨架。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const quests = JSON.parse(readFileSync(resolve(ROOT, 'src/data/json/quests.json'), 'utf8')) as Array<{
  id: string
  nameKey: string
  npc: string
  steps: Array<{ state: string; label: string; labelKey?: string; advanceOn?: { flags?: string[] } }>
}>
const dialogueBlob = JSON.stringify(JSON.parse(readFileSync(resolve(ROOT, 'src/data/json/dialogue.json'), 'utf8')))

const afterglow = quests.find((q) => q.id === 'q_afterglow')
const NPCS = JSON.parse(readFileSync(resolve(ROOT, 'src/data/json/npcs.json'), 'utf8')) as Array<{ id: string }>
const REGIONS = JSON.parse(readFileSync(resolve(ROOT, 'src/data/json/regions.json'), 'utf8')) as Array<{ id: string }>

describe('q_afterglow 《余响归位》存在的结构自证', () => {
  it('第七条线在册、发布者是石版', () => {
    expect(afterglow, 'quests.json 缺 q_afterglow').toBeTruthy()
    expect(afterglow!.nameKey).toBe('quest.afterglow')
    expect(NPCS.some((n) => n.id === afterglow!.npc), '发布者不在 npcs.json').toBe(true)
  })

  it('恰好四步；旗标全部锚到 dialogue.json 里已有的写手（零新旗标，KI-140）', () => {
    expect(afterglow!.steps.length, '余响归位恰好四步').toBe(4)
    for (const step of afterglow!.steps) {
      const flags = step.advanceOn?.flags ?? []
      expect(flags.length, `${step.state} 没有 advanceOn.flags`).toBeGreaterThan(0)
      for (const f of flags) {
        expect(dialogueBlob.includes(`"${f}"`), `${flags} 在对话里找不到写手`).toBe(true)
      }
    }
  })

  it('marker 全解析到 regions.json（HUD 目标箭头不许悬空）', () => {
    const regionIds = new Set(REGIONS.map((r) => r.id))
    for (const step of afterglow!.steps as Array<{ marker?: { kind: string; id?: string } }>) {
      expect(step.marker?.kind).toBe('region')
      expect(regionIds.has(step.marker!.id!), `marker 悬空：${step.marker!.id}`).toBe(true)
    }
  })

  it('四步顺序串全局唯一（与全库无碰撞）', () => {
    const all = quests.flatMap((q) => q.steps.map((s) => s.state))
    for (const step of afterglow!.steps) {
      expect(all.indexOf(step.state), `${step.state} 重复`).toBe(all.lastIndexOf(step.state))
    }
  })
})

describe('q_afterglow 引擎侧『Finale 接戏』路径（settle 顺序补判）', () => {
  const mk = (flagsAllSet: boolean) =>
    new Quests([afterglow as unknown as QuestData], () => {}, (k) => flagsAllSet && k.startsWith('flag.'))

  it('旗标全已在册 ⇒ start 即冲到底（末步 advanceOn 命中 ⇒ isComplete=true）', () => {
    const qs = mk(true)
    expect(qs.start('q_afterglow')).toBe(true)
    expect(qs.isComplete('q_afterglow'), 'Finale 之前三线旗都落了 ⇒ 起手直读完结！').toBe(true)
  })

  it('一旗都没落 ⇒ start 停在第一步、不假装收束', () => {
    const qs = mk(false)
    expect(qs.start('q_afterglow')).toBe(true)
    expect(qs.state('q_afterglow')).toBe('AFTERGLOW.STEP1')
    expect(qs.isComplete('q_afterglow')).toBe(false)
  })

  it('部分旗标在册 ⇒ 卡在缺旗的那一步（不跳步也不倒走）', () => {
    const grown = new Set(['flag.corvin_archive_confronted', 'flag.brokenbar_resolved'])
    const qs = new Quests([afterglow as unknown as QuestData], () => {}, (k) => grown.has(k))
    expect(qs.start('q_afterglow')).toBe(true)
    expect(qs.state('q_afterglow')).toBe('AFTERGLOW.STEP3')
    expect(qs.isComplete('q_afterglow')).toBe(false)
  })
})

describe('q_threewords 的同款启动（Finale 接戏顺带）', () => {
  const threewords = quests.find((q) => q.id === 'q_threewords')!

  it('旗标全已在册 ⇒ start 即冲到底（第六条线从第六条旗接回顺序）', () => {
    expect(threewords, '缺 q_threewords').toBeTruthy()
    const qs = new Quests([threewords as unknown as QuestData], () => {}, () => true)
    expect(qs.start('q_threewords')).toBe(true)
    expect(qs.isComplete('q_threewords')).toBe(true)
  })
})
