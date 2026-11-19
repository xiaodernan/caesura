/** scripts/sim-real-visitor.mjs 的类型声明（tsc 不核 .mjs；兄弟 .d.mts 供 TS 消费者 · KI-440 交付直接要求） */

export interface SimCheck {
  path: string
  status: number
  bytes: number
  text: string
  error: string | null
  expectedMarkers: string[]
  hitMarkers: string[]
  ok: boolean
}

export interface SimSummary {
  seed: number
  pages: number
  okPages: number
  badPages: number
  blindClickHops: number
  blindClickFails: number
  referrer: { url: string; status: number }
  totalBytes: number
  avgBytes: number
  wallMs: number
}

export declare function parseArgs(argv?: string[]): Record<string, string>
export declare function storySlugs(): string[]
export declare function publicPageList(): string[]
export declare function listStoryPages(): string[]
export declare function extractInnerLinks(html: string): string[]
export declare function mulberry32(seed: number): () => number
export declare function pick<T>(rng: () => number, xs: T[]): T
export declare const checkPage: (path: string) => Promise<SimCheck>
export declare const runPool: <T, R>(xs: T[], limit: number, workerFn: (x: T) => Promise<R>) => Promise<R[]>
export declare const SITES: Readonly<Record<string, string>>
export declare const args: Record<string, string>
export declare const SEED: number
export declare const rng: () => number
export declare const concurrency: number
export declare const retries: number
export declare const fetchWithBudget: (url: string, timeoutMs?: number) => Promise<{ status: number; bytes: number; text: string; url: string; error?: string | null }>
