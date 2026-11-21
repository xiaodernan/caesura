import endlessRaw from '@/data/json/endless-sectors.json'
import type { EchoFlowEntry } from '@/quest/EchoFlow'

/**
 * src/quest/EndlessWorld.ts — KI-723 无尽开放世界的玩家侧读表（零 LLM / 零联网）。
 *
 * 表由 `scripts/endless-world.mjs` 用固定 seed 生成，且经过生成器级人工闸；这里只读不写。
 * 「无尽」不是一句标语：`nextDepth` 由每个扇区给出，作者侧可以无限追加深度；
 * 每一深度都有 6 处可看的东西与 3 根旗标，因此不会出现「地图很大里面很空」。
 */
export interface EndlessMark {
  id: string
  zh: string
  en: string
}

export interface EndlessFlag {
  flag: string
  fromZh: string
  fromEn: string
  toZh: string
  toEn: string
  narrativeZh: string
  narrativeEn: string
  atlasHookZh: string
  atlasHookEn: string
  canonEvidence: string
}

export interface EndlessSector {
  id: string
  depth: number
  seed: number
  titleZh: string
  titleEn: string
  soundZh: string
  soundEn: string
  guideZh: string
  guideEn: string
  personZh: string
  personEn: string
  marks: EndlessMark[]
  flags: EndlessFlag[]
  nextDepth: number
}

export interface EndlessWorldTable {
  schema: number
  seed: number
  startDepth: number
  generatedCount: number
  sectors: EndlessSector[]
  entries: unknown[]
}

export const endlessWorldTable = endlessRaw as unknown as EndlessWorldTable

export function endlessSectorsOf(raw: unknown = endlessWorldTable): EndlessSector[] {
  const list = (raw as { sectors?: unknown })?.sectors
  return Array.isArray(list) ? (list as EndlessSector[]) : []
}

export function endlessEntriesOf(raw: unknown = endlessWorldTable): EchoFlowEntry[] {
  const list = (raw as { entries?: unknown })?.entries
  return Array.isArray(list) ? (list as EchoFlowEntry[]) : []
}

export class EndlessWorld {
  private readonly byDepth: Map<number, EndlessSector>
  private readonly byFlag: Map<string, EchoFlowEntry>

  constructor(
    private readonly sectors: readonly EndlessSector[] = endlessSectorsOf(),
    private readonly entries: readonly EchoFlowEntry[] = endlessEntriesOf(),
  ) {
    this.byDepth = new Map(sectors.map((s) => [s.depth, s]))
    this.byFlag = new Map(entries.map((e) => [e.flag, e]))
  }

  /** 世界永远有下一扇区：最后一扇区的 nextDepth 仍指向一个未装配的深度。 */
  nextDepth(): number {
    return this.sectors.length ? Math.max(...this.sectors.map((s) => s.nextDepth)) : 1
  }

  sector(depth: number): EndlessSector | null {
    return this.byDepth.get(depth) ?? null
  }

  describe(depth: number, lang: 'zh' | 'en' = 'zh'): string | null {
    const s = this.sector(depth)
    if (!s) return null
    return lang === 'en'
      ? s.titleEn + ' — ' + s.guideEn + ' (' + s.marks.length + ' things to see)'
      : s.titleZh + ' —— ' + s.guideZh + '（' + s.marks.length + ' 处可看）'
  }

  entryFor(flag: string): EchoFlowEntry | null {
    return this.byFlag.get(flag) ?? null
  }

  snapshot() {
    return {
      seed: endlessWorldTable.seed,
      loaded: this.sectors.length,
      nextDepth: this.nextDepth(),
      marks: this.sectors.reduce((a, s) => a + s.marks.length, 0),
      flags: this.entries.length,
    }
  }
}
