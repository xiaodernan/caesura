import { describe, expect, it } from 'vitest'
import { dialogueDiffReport } from '../../scripts/llm-dialogue-diff.mjs'

/** KI-538 衍生：LLM 候选 vs dialogue.json 机读对账（作者侧）。 */

const dlg = (texts: Array<{ dlgId: string; nodeId: string; text: string }>) =>
  texts.map((t) => ({ id: t.dlgId, nodes: [{ id: t.nodeId, speaker: 'npc', text: t.text }] }))
const cleanCand = (id: string, lines: string[]) => ({
  dlgId: id, npc: 'npc_x', status: 200, totalTokens: 1, finishReason: 'stop', canonOpening: 'x',
  lines, requiresHumanReview: true,
})

describe('llm-dialogue-diff dialogueDiffReport', () => {
  const baseRoot = { runtime: false, authorOnly: true, requiresHumanReview: true, candidates: [] as any[] }

  it('干净输入：ok=true、leaks=0、requiresHumanReviewOk=true、runtimeOk=true', () => {
    const r = dialogueDiffReport({
      dialogue: dlg([{ dlgId: 'DLG_A', nodeId: 'n0', text: '完整节点原文' }]),
      candidates: { ...baseRoot, candidates: [cleanCand('DLG_A', ['完全崭新的候选行'])] },
    })
    expect(r.ok).toBe(true)
    expect(r.leaks).toBe(0)
    expect(r.requiresHumanReviewOk).toBe(true)
    expect(r.runtimeOk).toBe(true)
    expect(r.nodes).toBe(1)
  })

  it('候选逐字落进 dialogue.json：leaks=1、problems 非空、ok=false（泄漏出口不许软化）', () => {
    const r = dialogueDiffReport({
      dialogue: dlg([{ dlgId: 'DLG_A', nodeId: 'n0', text: '逐字落进的候选行' }]),
      candidates: { ...baseRoot, candidates: [cleanCand('DLG_A', ['逐字落进的候选行'])] },
    })
    expect(r.leaks).toBe(1)
    expect(r.ok).toBe(false)
    expect(r.problems.some((p) => p.includes('逐字落在'))).toBe(true)
  })

  it('requiresHumanReview=false 的候选 ⇒ problems 非空、ok=false', () => {
    const r = dialogueDiffReport({
      dialogue: dlg([{ dlgId: 'DLG_A', nodeId: 'n0', text: 'x' }]),
      candidates: { ...baseRoot, candidates: [{ dlgId: 'DLG_A', lines: ['换行'], requiresHumanReview: false }] },
    })
    expect(r.ok).toBe(false)
    expect(r.problems.some((p) => p.includes('requiresHumanReview !== true'))).toBe(true)
  })

  it('root.runtime=true ⇒ runtimeOk=false、problems 非空、ok=false', () => {
    const r = dialogueDiffReport({
      dialogue: dlg([{ dlgId: 'DLG_A', nodeId: 'n0', text: 'x' }]),
      candidates: { ...baseRoot, runtime: true, candidates: [cleanCand('DLG_A', ['换行'])] },
    })
    expect(r.ok).toBe(false)
    expect(r.runtimeOk).toBe(false)
  })

  it('直方图按 dlgId 计数·空候选集仍合法', () => {
    const r = dialogueDiffReport({
      dialogue: dlg([{ dlgId: 'DLG_A', nodeId: 'n0', text: 'x' }]),
      candidates: { ...baseRoot, candidates: [cleanCand('DLG_A', ['a']), cleanCand('DLG_A', ['b']), cleanCand('DLG_B', ['c'])] },
    })
    expect(r.histogram).toEqual({ DLG_A: 2, DLG_B: 1 })
    const empty = dialogueDiffReport({
      dialogue: dlg([{ dlgId: 'DLG_A', nodeId: 'n0', text: 'x' }]),
      candidates: { ...baseRoot, candidates: [] },
    })
    expect(empty.ok).toBe(true)
    expect(empty.leaks).toBe(0)
    expect(empty.candidates).toBe(0)
  })

  it('非数组非对象根的 dialogue.json 不炸：nodes=0、leaks=0（作者工具容错）', () => {
    const r = dialogueDiffReport({
      dialogue: null as never,
      candidates: { ...baseRoot, candidates: [cleanCand('DLG_A', ['任意行'])] },
    })
    expect(r.nodes).toBe(0)
    expect(r.leaks).toBe(0)
  })
})
