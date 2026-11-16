/** `scripts/lib/world-rag.mjs` 的声明：世界语料 RAG 检索库 · CJK bigram + BM25 · 零依赖。 */

export const ROOT: string

export interface WorldRagIndex {
  corpus: string[]
  docFreq: Map<string, number>
  N: number
  avgLen: number
  tfVectors: Map<string, number>[]
  docLens: number[]
}

export interface WorldRagHit {
  chunk: string
  score: number
}

export function tokenize(s: unknown): string[]
export function buildIndex(corpus: ReadonlyArray<string>): WorldRagIndex
export function retrieve(index: WorldRagIndex, query: string, k?: number): WorldRagHit[]
export function stripHtml(html: unknown): string[]
export function buildWorldCorpus(root?: string): string[]
