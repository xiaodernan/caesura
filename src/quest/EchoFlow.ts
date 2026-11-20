import { bus } from '@/core/EventBus'

/**
 * src/quest/EchoFlow.ts — KI-717「世界线」运行时（零 LLM）
 *
 * 数据来源只有一处：`src/data/json/echo-flow.json`。那张表由 `scripts/echo-flow.mjs` 从
 * AI 导演的 `transitions` + 流转 QA 的 `verdicts` + `admin/echo-flow-approvals.json` 编译而来，
 * 每一条都经过人工闸放行，运行时不触网、不调用任何模型。
 *
 * 这一层要解决的是「LLM 提案 → 可玩状态」之间最后一公里的**可审计性**：
 *   - 提案里的 `flag` 是玩家在世界上真的能触发的东西（交互物 `setsFlag` / 对话效果 / 世界规则）；
 *   - 触发后，这条 from → to 的流转在本局被记为「已抵达」，并带着 NPC 反应与 atlas hook 出现在纪事页；
 *   - 没抵达的条目仍然可见，但只给 from/to 与线索，不冒充已发生的事。
 *
 * 纪律：
 *   1. 只读数据，不自己发明状态；`record()` 只认表里登记过的 flag。
 *   2. 状态是**派生**的：`sync()` 从旗标现读，读档/回滚不需要另存一份快照。
 *   3. 提醒只发一次：同一 flag 在同一局重复触发不会重复播报（`record` 返回 null）。
 */
export interface EchoFlowApproval {
  by: string
  at: string
  noteZh: string
  noteEn: string
}

export interface EchoFlowSource {
  generatedAt: string | null
  model: string | null
  focus: string | null
  digest: string
  qaDigest: string
}

export interface EchoFlowEntry {
  id: string
  flag: string
  chapter: number
  fromZh: string
  fromEn: string
  toZh: string
  toEn: string
  narrativeZh: string
  narrativeEn: string
  npcReactionZh: string
  npcReactionEn: string
  atlasHookZh: string
  atlasHookEn: string
  canonEvidence: string[]
  canonFit: string
  qaNotesZh: string
  qaNotesEn: string
  approval: EchoFlowApproval
  source: EchoFlowSource
}

export interface EchoFlowSnapshot extends EchoFlowEntry {
  reached: boolean
}

export class EchoFlow {
  /** 本局已抵达的 flag（只增不减；读档回退由 `sync()` 现读旗标决定） */
  private readonly reachedFlags = new Set<string>()
  /** 由 `record()` 直接记下的 flag：即使测试替身还没把 hasFlag 同步过来，也不在 sync 时抹掉 */
  private readonly recordedFlags = new Set<string>()
  private readonly byFlag: Map<string, EchoFlowEntry>

  constructor(
    private readonly entries: readonly EchoFlowEntry[],
    private readonly hasFlag: (key: string) => boolean,
  ) {
    this.byFlag = new Map(entries.map((e) => [e.flag, e]))
  }

  /**
   * 从旗标现读一遍（进入纪事页、读档后都调它；不写任何存储）。
   * 未被 `record()` 记过的旗标按现读结果回退；记过的条目保持「已抵达」，
   * 避免纪事页在 `world.flag` 与 `hasFlag` 两个更新时序之间闪回未抵达。
   */
  sync(): void {
    for (const e of this.entries) {
      if (this.hasFlag(e.flag)) this.reachedFlags.add(e.flag)
      else if (!this.recordedFlags.has(e.flag)) this.reachedFlags.delete(e.flag)
    }
  }

  /**
   * 记录一次旗标触发。返回**首次**抵达的那条流转；重复触发 / 表外 flag 返回 null。
   * 调用方拿到非 null 时可以播一条通知，而不会因为同一交互重复点而刷屏。
   */
  record(flag: string): EchoFlowEntry | null {
    const entry = this.byFlag.get(flag)
    if (!entry) return null
    if (this.reachedFlags.has(flag)) return null
    this.reachedFlags.add(flag)
    this.recordedFlags.add(flag)
    return entry
  }

  /** 全表（带本局是否抵达）；纪事页与调试面板共用这一个读数 */
  snapshot(): EchoFlowSnapshot[] {
    this.sync()
    return this.entries.map((e) => ({ ...e, reached: this.reachedFlags.has(e.flag) }))
  }

  reached(): EchoFlowSnapshot[] {
    return this.snapshot().filter((e) => e.reached)
  }

  pending(): EchoFlowSnapshot[] {
    return this.snapshot().filter((e) => !e.reached)
  }

  /** 按章分组（纪事页按章摊开，避免 4 条以上时变成一堵墙） */
  byChapter(): Array<{ chapter: number; entries: EchoFlowSnapshot[] }> {
    const groups = new Map<number, EchoFlowSnapshot[]>()
    for (const e of this.snapshot()) {
      const list = groups.get(e.chapter) ?? []
      list.push(e)
      groups.set(e.chapter, list)
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([chapter, list]) => ({ chapter, entries: list }))
  }

  /** 供组合根在旗标广播时调用；返回首次抵达的条目（没有就 null） */
  onWorldFlag(key: string, value: boolean | number | string): EchoFlowEntry | null {
    return value !== false && value !== 0 && value !== '' ? this.record(key) : null
  }
}

/** 运行时表是 JSON 对象（schema + entries）；组合根在装配处注入。 */
export function echoFlowEntriesOf(raw: unknown): EchoFlowEntry[] {
  const list = (raw as { entries?: unknown })?.entries
  return Array.isArray(list) ? (list as EchoFlowEntry[]) : []
}

/** 组合根用：把一条新抵达的世界线播给玩家（不触网、不做二次创作） */
export function announceEchoFlow(entry: EchoFlowEntry, lang: 'zh' | 'en' = 'zh'): void {
  const text = lang === 'en'
    ? `Worldline advanced · ${entry.toEn}`
    : `世界线向前一步 · ${entry.toZh}`
  bus.emit('ui.notify', { text, kind: 'info' })
}
