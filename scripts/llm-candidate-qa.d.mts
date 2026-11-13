/** `scripts/llm-candidate-qa.mjs` 的声明：候选评分卡 · 逐候选便签 verdict 便签。 */

export interface CandQaInput {
  npc: string
  dlgId: string
  emotion: string
  status: number
  totalTokens: number
  finishReason: string
  canonOpening: string
  lines: string[]
  requiresHumanReview: boolean
}

export function buildCandQaUserContent(candidates: ReadonlyArray<CandQaInput>): string
