/** `scripts/llm-dialogue-diff.mjs` 的声明：LLM 候选与对白 `dialogue.json` 的结构化差异对账（作者侧）。 */

export interface DialogueDiffReport {
  nodes: number
  candidates: number
  leaks: number
  requiresHumanReviewOk: boolean
  runtimeOk: boolean
  ok: boolean
  histogram: Record<string, number>
  problems: string[]
}

export function dialogueDiffReport(input: {
  dialogue?: unknown
  candidates?: { candidates?: any[]; runtime?: boolean; authorOnly?: boolean; requiresHumanReview?: boolean } | null
}): DialogueDiffReport
