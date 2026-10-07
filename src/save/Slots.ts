import { readSlot, SAVE_VERSION, type KvStore, type SlotProblem, type Snapshot } from './Serializer'

/**
 * 存档槽名册（KI-025① / 需求 §45、ui-ux §8）。
 *
 * 这一层只回答两个问题：**有哪几格、每一格能不能读、读出来是谁在玩**。
 * 它不碰 DOM，也不解析任何显示名（出身叫什么、武器叫什么、区域叫什么）——
 * 那些名字住在表里，解析它们的判据在 UI 侧车（`ui/SaveSlots.ts` 的 `saveCards()`）与
 * `ui/TitleScreen.ts` 的 `titleCards()` 同族：存档层认识 `rpg` 就又多了一条兄弟模块之间的
 * 运行时依赖（本仓库现在一条都没有，`arch-boundaries` 守的是"逻辑层不认识表现层"，
 * 而这里守的是"存档层不必认识成长层"）。
 *
 * **一条候选顺序，一个主人。** "主键位 → tmp → prev → 备份" 这条顺序以前只写在
 * `SaveGame.load` 里；名册要独立回答"这一格可不可读"，如果它自己再排一遍，
 * 就会出现"卡上说可读取、点下去读出来的是另一格"这种玩家眼前的假账。所以两边都走
 * `Serializer.slotCandidates`（经由 `readSlot`）。
 */

/** 自动槽：三个休息时机（调音桩 / Boss 跳阶 / 进新区域）写它，玩家不能手动选它覆盖 */
export const AUTOSAVE_SLOT = 'autosave'
/** 手动槽 ×3（需求 §45 的「槽位×3」）：底层早就按 slot 前缀设计，这里只是给它一个名册 */
export const MANUAL_SLOTS = ['slot1', 'slot2', 'slot3']

export function saveSlots(): string[] { return [AUTOSAVE_SLOT, ...MANUAL_SLOTS] }

/**
 * 一格的**状态**（决定卡片长什么样、能不能按下去）：
 * - `empty`：这一格从来没写过 ⇒ 空槽，写它不需要确认
 * - `ok`：主键位就能读出来 ⇒ 直接读
 * - `restored`：主键位坏了，从 tmp / prev / 备份捡回来的 ⇒ ui-ux §8 那块"已恢复备份"黄标
 * - `blocked`：四格候选全废 ⇒ 按下去一定失败，卡片必须给出 `problem` 的原话
 */
export type SlotState = 'empty' | 'ok' | 'restored' | 'blocked'

/** 摘要卡上的**原始读数**（名字与格式化归 UI；缺字段就是 null，不补一个假的） */
export interface SlotData {
  /** 音级。v1 老档没有成长数据 ⇒ null，卡上显示"未知" */
  rank: number | null
  originId: string | null
  weaponId: string
  regionId: string | null
  playSec: number
  /** 存档时刻（epoch ms）。v9 及更早的档没有这一格 ⇒ null */
  savedAt: number | null
  hp: number
  corruption: number
  /** 已经开过口的任务条数 / 已收束的条数（v7 前的档没有叙事层 ⇒ null，不是 0） */
  questsStarted: number | null
  questsCompleted: number | null
}

export interface SlotCard {
  slot: string
  kind: 'auto' | 'manual'
  state: SlotState
  /** 落盘那一刻的 schema 版本（null = 没有可读的档） */
  schemaVersion: number | null
  /** 落盘版本低于当前 ⇒ 读它会跑迁移链，卡上如实标"由 vN 升级" */
  migrated: boolean
  /** `restored` 时是哪一个键位救的场（"是 .prev 救的"与"是备份机救的"不是一回事，诊断要分得开） */
  fromKey: string | null
  /** `blocked` 的第一手原因；`restored` 时也带着主键位坏掉的那一条，供"详细信息"用 */
  problem: SlotProblem | null
  data: SlotData | null
}

/** 快照 → 卡面读数：老档缺哪一格就 null 哪一格（§78 的口径是留空，不是编一个） */
function summarize(s: Snapshot): SlotData {
  const rpg = s.rpg ?? null
  return {
    rank: rpg ? rpg.progression.rank : null,
    originId: rpg ? rpg.progression.originId : null,
    weaponId: s.player.weaponId,
    regionId: s.regionId,
    playSec: s.playSec,
    savedAt: s.savedAt ?? null,
    hp: s.player.hp,
    corruption: s.player.corruption ?? 0, //【恒死·批28】corruption 自 v3 起是 schema 必填格：capture 必写、v2→v3 迁移给更老的档补 0 ⇒ ?? 右腿不可达
    questsStarted: s.quest ? Object.keys(s.quest.states ?? {}).length : null,
    questsCompleted: s.quest ? (s.quest.completed?.length ?? 0) : null
  }
}

/** 键位的可读出处：主机上的 `slot1.prev` 与备份机上的 `slot1` 不是同一件事 */
function where(r: { fromKey: string | null; fromStore: 'primary' | 'backup' | null }): string | null {
  if (r.fromKey === null || r.fromStore === null) return null //【恒死·批28】readSlot 两个返回点里 fromKey/fromStore 同 null 或同非 null：一半有值另一半必非 null
  return r.fromStore === 'backup' ? `${r.fromKey}@backup` : r.fromKey
}

export class SlotRoster {
  constructor(
    private readonly primary: KvStore,
    private readonly backup: KvStore | null = null,
  ) {}

  /** 单格：`SaveGame.load` 之外的第二个读者，两者共用 `readSlot` 这一条通道 */
  async card(slot: string): Promise<SlotCard> {
    const r = await readSlot(this.primary, this.backup, slot)
    const kind: SlotCard['kind'] = slot === AUTOSAVE_SLOT ? 'auto' : 'manual'
    if (!r.snapshot || r.fromKey === null || r.schemaVersion === null) {
      return {
        slot, kind,
        state: r.problem === 'empty' ? 'empty' : 'blocked',
        schemaVersion: null, migrated: false, fromKey: null,
        problem: r.problem === 'empty' ? null : r.problem,
        data: null
      }
    }
    return {
      slot, kind,
      state: r.recovered ? 'restored' : 'ok',
      schemaVersion: r.schemaVersion,
      migrated: r.schemaVersion < SAVE_VERSION,
      fromKey: r.recovered ? where(r) : null,
      problem: r.tried.find((t) => t.reason !== 'empty')?.reason ?? null,
      data: summarize(r.snapshot)
    }
  }

  /** 全名册：顺序即 UI 顺序（自动槽在最前，然后三个手动槽） */
  async list(): Promise<SlotCard[]> {
    const out: SlotCard[] = []
    for (const s of saveSlots()) out.push(await this.card(s))
    return out
  }
}
