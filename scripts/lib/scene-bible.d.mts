/** scripts/lib/scene-bible.mjs 的类型声明（tsc 与 Vitest 共用；行为以源码为准） */
export interface SceneBibleStats {
  version: string
  bytes: number
  approxTokens: number
  loreEntries: number
  atlasChapters: number
  containsVolatileDrift: boolean
}
export interface WarmMarker {
  calls: number
  cachedTokens: number[]
  statuses: number[]
  note?: string
  hash?: string
  at?: number
}
export const ROOT: string
export const SCENE_BIBLE_VERSION: string
export function buildSceneBible(): string
export function sceneBible(): string
export function sceneBibleHash(): string
export function sceneBibleCacheKey(): string
export function sceneBibleStats(): SceneBibleStats
export function readWarmMarker(): WarmMarker | null
export function writeWarmMarker(meta: Record<string, unknown>): boolean
