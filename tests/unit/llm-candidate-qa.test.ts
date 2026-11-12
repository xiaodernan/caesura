import { describe, expect, it } from 'vitest'
import { buildCandQaUserContent } from '../../scripts/llm-candidate-qa.mjs'

/** llm-candidate-qa：候选评分卡的「纯函数」腿（不调真 LLM）。 */

const pool = () => [
  { npc: 'npc_meg', dlgId: 'DLG_MEG', emotion: 'bored', status: 200, totalTokens: 100, finishReason: 'stop', canonOpening: 'x',
    lines: ['第一行候选', '第二行候选'], requiresHumanReview: true },
  { npc: 'npc_belltongue', dlgId: 'DLG_BELLTONGUE', emotion: 'guarded', status: 200, totalTokens: 100, finishReason: 'stop', canonOpening: 'z',
    lines: ['Belltongue 候选 1', 'Belltongue 候选 2'], requiresHumanReview: true },
  { npc: 'npc_corvin', dlgId: 'DLG_CORVIN', emotion: 'curious', status: 200, totalTokens: 200, finishReason: 'stop', canonOpening: 'y',
    lines: ['科温候选 A', '科温候选 B'], requiresHumanReview: true },
]

describe('llm-candidate-qa buildCandQaUserContent', () => {
  it('每条候选都出现在 userContent 中（id/emotion/both lines）', () => {
    const content = buildCandQaUserContent(pool())
    for (const c of pool()) {
      expect(content).toContain(c.dlgId)
      expect(content).toContain('emotion=' + c.emotion)
      for (const line of c.lines) expect(content).toContain(line)
    }
  })

  it('含总纲要点与输出格式规则（keep/pending/flag · ≤30 字）', () => {
    const content = buildCandQaUserContent(pool())
    expect(content).toContain('"verdict"')
    expect(content).toContain('keep')
    expect(content).toContain('pending')
    expect(content).toContain('flag')
    expect(content).toContain('≤30')
  })

  it('含三条 NPC 的 canonOpening + style 锚点', () => {
    const content = buildCandQaUserContent(pool())
    expect(content).toContain('canonOpening:')
    expect(content).toContain('style:')
    expect(content).toContain('别站那么近')
    expect(content).toContain('是不是莉安剪的')
    expect(content).toContain('末代档案官')
  })

  it('空候选池不炸：标题注记=0 条，schema 仍完整', () => {
    const content = buildCandQaUserContent([])
    expect(typeof content).toBe('string')
    expect(content).toContain('0 条')
  })
})
