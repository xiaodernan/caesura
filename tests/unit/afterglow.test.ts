import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

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
