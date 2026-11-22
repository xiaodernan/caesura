/**
 * src/quest/WanderingEchoes.ts — KI-736「拾遗」世界细节遭遇的运行时（零 LLM）
 *
 * 解决的问题：八区只有主/支线与编年，玩家会觉得「看着很大、里面很空」。这一层提供
 * **走着走着撞见一段具体之物**的密度，不推进剧情、不给奖励、不发任务。
 *
 * 四条纪律：
 * 1. **零 LLM、零网络**：候选由作者侧脚本生成并经人工策展入 `wandering-echoes.json`，
 *    运行时只读这一张表。玩家进程不认识模型。
 * 2. **唯一触发源是区域进场**：`main.ts` 在 `ui.region.enter` 时调一次 `onRegionEnter`；
 *    不做每帧轮询、不数 tick（与 PatrolWatch 的事件型判据同一纪律）。
 * 3. **确定性**：同一区第 n 次进场 + 同一张表 ⇒ 永远选到同一条（FNV-1a 种子 + 权重）。
 *    全程不用随机数——同档读两次不该看到不同的世界。
 * 4. **会话内不重复**：见过的那条不再出现；一区的候选见完了，这一区就安静下来
 *    （拾遗是"遇见"，不是刷怪，不为了产出而重复自己）。
 *
 * 不写世界旗标：本层没有"后果"，只有"看见"。所以它不进 `worldstate.json`，
 * 也就不需要在 `regions.json` 里找读者（那一条数据闸门约束的是真会改变世界的旗标）。
 */
import type { WanderingEchoData } from '@/data/schema'

export type WanderingEcho = WanderingEchoData

export interface WanderingEchoDeps {
  /** 世界旗标读数（闸门用；与全项目同一个真值源） */
  hasFlag: (key: string) => boolean
  /** 值域型世界状态读数（`WorldStates.get`） */
  stateOf: (key: string) => string | null
  /** 真选出一条时的一次性回调（由组合根决定怎么呈现，通常是一条 ui.notify） */
  onEcho: (echo: WanderingEcho) => void
}

/** FNV-1a 32 位：小、稳、无依赖。只用来把"区 + 第几次进场"折成一个种子，不做安全用途。 */
function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** 权重至少 1（缺省 1），负值与 0 都按 1 处理——数据写坏不该让一条永远选不中。 */
function weightOf(e: WanderingEcho): number {
  const w = Number(e.weight)
  return Number.isFinite(w) && w >= 1 ? Math.floor(w) : 1
}

export class WanderingEchoes {
  /** 每区进场次数（只在本局内存里；不是存档事实） */
  private readonly visits = new Map<string, number>()
  /** 本局已经见过的条目 id */
  private readonly seen = new Set<string>()

  constructor(
    private readonly entries: readonly WanderingEcho[],
    private readonly deps: WanderingEchoDeps,
  ) {}

  /** 本局已见（调试面板与测试读它；不作为真值） */
  get seenIds(): string[] { return [...this.seen].sort() }

  /** 某区此刻**可触发**的候选（区域对、闸门开、本局没见过）。纯函数，不改状态。 */
  eligible(regionId: string): WanderingEcho[] {
    return this.entries.filter((e) => {
      if (e.regionId !== regionId) return false
      if (this.seen.has(e.id)) return false
      if (e.requiresFlag && !this.deps.hasFlag(e.requiresFlag)) return false
      if (e.requiresState) {
        const cur = this.deps.stateOf(e.requiresState.key)
        if (cur !== e.requiresState.value) return false
      }
      return true
    })
  }

  /**
   * 区域进场时调一次：选出这一区这一趟的那一条（可能没有）。
   * 返回被选中的条目（已标记为"见过"），没有可触发的就返回 null。
   */
  onRegionEnter(regionId: string): WanderingEcho | null {
    const visit = (this.visits.get(regionId) ?? 0) + 1
    this.visits.set(regionId, visit)
    const pool = this.eligible(regionId)
    if (pool.length === 0) return null
    const picked = WanderingEchoes.pickWeighted(pool, `${regionId}#${visit}`)
    if (!picked) return null
    this.seen.add(picked.id)
    this.deps.onEcho(picked)
    return picked
  }

  /** 确定性加权选取：种子固定 ⇒ 结果固定。池子为空返回 null。 */
  static pickWeighted(pool: readonly WanderingEcho[], seed: string): WanderingEcho | null {
    if (pool.length === 0) return null
    let total = 0
    for (const e of pool) total += weightOf(e)
    let point = fnv1a(seed) % total
    for (const e of pool) {
      point -= weightOf(e)
      if (point < 0) return e
    }
    return pool[pool.length - 1] ?? null
  }

  /** 开新局时清空会话内记忆（读档不恢复"见过"——拾遗是氛围，不是收集进度）。 */
  resetSession(): void {
    this.visits.clear()
    this.seen.clear()
  }
}
