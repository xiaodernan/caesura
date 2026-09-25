import { registry } from '@/core/Registry'
import type { AttrKey, FrameData, MovementConfig, MovementData, MovementLevel, MovementPage } from '@/data/schema'
import type { Inventory } from './Inventory'
import { itemOf } from './Inventory'
import { progressionData } from './Progression'
import { TIMBITE } from './Upgrade'

/** 乐谱残页：§7.1 的第二条解锁源，也是战技升级的学费（和强化装备用的通货不同种） */
export const SCORE = 'it_score_fragment'

/**
 * 乐章战技谱册（progression.md §7，Phase 5-C2）：**谁学会了什么、几级、装在哪**。
 *
 * 三层分工，谁也不越界：
 * - `data/json/movements.json` 给静态表（页/槽/每条战技的等级成长）。
 * - 本类只管**成长状态**：点亮页（吃掉振源核或残页）、升级（残页+音色石）、装槽（音级门槛）。
 *   它不认识玩家、不认识 three，所以能在 headless 里整条跑通（需求 §59）。
 * - 出手本身在 `player/ThirdPersonController` + `combat/CombatManager`：本类只把它们要消费的
 *   一份 `SkillAction` 交出去（帧表 + 这一式此刻的数值）。
 *
 * 「点亮页=吃物品」而不是 `if (flag.bossX)`：解锁源写在数据里，于是掉在 loot 表里的
 * 振源核第一次有了用途（§55——它之前只是一件没人收的钥匙物）。
 */

export function movementConfig(): MovementConfig {
  return registry.get<MovementConfig>('movements')
}

/** 一次战技出手此刻的全部数值（等级已折算完，运行时不再回头查表） */
export interface SkillCast {
  id: string
  level: number
  cooldownTicks: number
  staminaCost: number
  overdriveCost: number
  /** 战技自身的基础伤害（0＝这一式不出伤害） */
  damage: number
  /** 追加真伤：全音符斩把它压在"下一记重击"上，随那一记一起结算 */
  trueDamage: number
  fissureLayers: number
  muteTicks: number
  /** 位移距离（米），0＝不位移 */
  distance: number
  /** §7.2 错拍步的落地窗口：落地后这些 tick 内，玩家自己的攻击架式伤害加这个数（0＝这一式没有落地收益） */
  landingPoise: number
  landingPoiseTicks: number
  /** §7.2 休止斩的时停：判定窗内按住的 tick 数（0＝这一式不停时间） */
  freezeTicks: number
  /** §7.2「每次使用后过载消耗 +2」：每用一次往上加这么多的过载价，过载条回满才归零 */
  overdriveRamp: number
  /** §7.2 定音回响：这一记存几扇加宽的弹反窗（0＝不存）。消费方＝ThirdPersonController 的弹反按下 */
  echoCharges: number
  /** 回响窗的加宽乘数（1＝这一式没有回响）。基准窗在 player.json `parry.activeTicks`，这里不抄第二份 */
  parryWindowMul: number
  /** §7.2 无声协奏：多少 tick 的全行动零噪音（0＝这一式不静音） */
  silenceTicks: number
  /** 无声协奏同一时段的出手伤害加成（0.15 = +15%）。消费方＝CombatManager.strikeEnemy 那条唯一通道 */
  silenceDmgBonus: number
  /** 伤害标尺（§2.1 音色列）。结算侧只认这张小表，不认识 movements.json */
  scaling: Partial<Record<AttrKey, number>>
  /** §11 过载列：每层过载给多少战技伤害 */
  overdriveLayerMul: number
}

export interface SkillAction {
  f: FrameData
  cast: SkillCast
}

export interface MovementSnapshot {
  lit: string[]
  levels: Record<string, number>
  slots: (string | null)[]
  /** 已研读的被动（v9 起，KI-036）：老档为空 ⇒ 一切从头（§78 的口径） */
  passives?: Record<string, number>
}

export type MoveFail = 'unknown' | 'lit' | 'dark' | 'max' | 'poor' | 'bad-slot' | 'locked-slot'

export interface MoveResult {
  ok: boolean
  reason?: MoveFail
}

export class MovementBook {
  readonly cfg: MovementConfig
  private readonly lit = new Set<string>()
  /** 只记**升过级**的式子；页亮了但没升级＝1 级，不必为每条战技存一份 1 */
  private readonly levels = new Map<string, number>()
  readonly slots: (string | null)[]

  constructor(cfg = movementConfig()) {
    this.cfg = cfg
    this.slots = cfg.slots.map(() => null)
  }

  /* ---------------- 页 ---------------- */

  page(id: string): MovementPage | undefined {
    return this.cfg.pages.find((p) => p.id === id)
  }

  movement(id: string): MovementData | undefined {
    return this.cfg.movements.find((m) => m.id === id)
  }

  isLit(pageId: string): boolean { return this.lit.has(pageId) }

  /**
   * 吸收解锁源点亮一页。扣得动才点亮——顺序反了就会出现「钱花了页没亮」。
   * 已经亮着的页不再收物品（`reason: 'lit'`），否则玩家可以拿多余的核去换别的。
   */
  unlockPage(pageId: string, inv: Inventory): MoveResult {
    const p = this.page(pageId)
    if (!p) return { ok: false, reason: 'unknown' }
    if (this.lit.has(pageId)) return { ok: false, reason: 'lit' }
    if (inv.count(p.unlock.item) < p.unlock.count) return { ok: false, reason: 'poor' }
    inv.remove(p.unlock.item, p.unlock.count)
    this.lit.add(pageId)
    return { ok: true }
  }

  /* ---------------- 等级 ---------------- */

  /** 0＝这一式还在没点亮的页里；1..N＝可用等级 */
  levelOf(movementId: string): number {
    const mv = this.movement(movementId)
    if (!mv || !this.lit.has(mv.page)) return 0
    return this.levels.get(movementId) ?? 1
  }

  level(movementId: string): MovementLevel | null {
    const mv = this.movement(movementId)
    const lv = this.levelOf(movementId)
    return mv && lv > 0 ? mv.levels[lv - 1] : null
  }

  /** 升到下一级要花多少；满级（或还没学会）给 null，UI 据此把按钮置灰而不是自己猜上限 */
  upgradeNeed(movementId: string): { timbite: number; score: number; level: number } | null {
    const mv = this.movement(movementId)
    if (!mv) return null
    const lv = this.levelOf(movementId)
    if (lv <= 0 || lv >= mv.levels.length) return null
    const step = this.cfg.upgradeCost[lv - 1]
    if (!step) return null
    return { timbite: step.timbite, score: step.score, level: step.level }
  }

  upgrade(movementId: string, inv: Inventory): MoveResult {
    const need = this.upgradeNeed(movementId)
    if (!need) return { ok: false, reason: this.levelOf(movementId) > 0 ? 'max' : 'dark' }
    if (inv.count(TIMBITE) < need.timbite || inv.count(SCORE) < need.score) {
      return { ok: false, reason: 'poor' }
    }
    inv.remove(TIMBITE, need.timbite)
    inv.remove(SCORE, need.score)
    this.levels.set(movementId, this.levelOf(movementId) + 1)
    return { ok: true }
  }

  /* ---------------- 槽 ---------------- */

  /** 第 i 槽要几级才开：门槛的**数字**住在 progression.json 的里程碑里，这里只引用它的 id（§8.2） */
  slotRank(index: number): number | null {
    const def = this.cfg.slots[index]
    if (!def) return null
    return progressionData().milestones.find((m) => m.id === def.milestone)?.rank ?? null
  }

  slotOpen(index: number, rank: number): boolean {
    const need = this.slotRank(index)
    return need !== null && rank >= need
  }

  /** 装（或清空）一个主动槽。页没亮 / 槽没开都装不进去——「先拿到工具箱，再决定带哪两件」 */
  equip(index: number, movementId: string | null, rank: number): MoveResult {
    if (index < 0 || index >= this.slots.length) return { ok: false, reason: 'bad-slot' }
    if (!this.slotOpen(index, rank)) return { ok: false, reason: 'locked-slot' }
    if (movementId === null) {
      this.slots[index] = null
      return { ok: true }
    }
    if (this.levelOf(movementId) <= 0) return { ok: false, reason: 'dark' }
    this.slots[index] = movementId
    return { ok: true }
  }

  /**
   * 交给玩家的一组可出手招式，键＝输入动作名（`weaponSkill` / `weaponSkillB`）。
   * 装了两条同一战技也没关系——两个键打出去的是同一式，冷却各算各的（§7.2 没禁止抄写）。
   */
  loadout(): Record<string, SkillAction> {
    const out: Record<string, SkillAction> = {}
    this.cfg.slots.forEach((def, i) => {
      const id = this.slots[i]
      if (!id) return
      const act = this.actionFor(id)
      if (act) out[def.action] = act
    })
    return out
  }

  /** 把一条战技的静态帧 + 当前等级合成玩家要的 `SkillAction` */
  actionFor(movementId: string): SkillAction | null {
    const mv = this.movement(movementId)
    const lv = this.levelOf(movementId)
    if (!mv || lv <= 0) return null
    const l = mv.levels[lv - 1]
    const fr = mv.frame
    const f: FrameData = {
      startup: fr.startup,
      activeStart: fr.activeStart,
      activeEnd: fr.activeEnd,
      recovery: fr.recovery,
      // 战技的伤害不写在帧上：帧是"动作的形状"，数值随等级长（§7.2 的 L1→L3 列）。
      // 结算侧读的是 cast.damage（下面那份），所以这里给 0 是"这一式没有固定值"，不是"打不着人"。
      damage: 0,
      stamina: mv.cost.stamina ?? 0,
      poise: fr.poise ?? 0,
      hitStopMs: fr.hitStopMs ?? 0,
      hitbox: fr.hitbox,
      multi: fr.multi,
      shake: fr.shake,
      sfx: fr.sfx,
      vfx: fr.vfx,
      loudness: fr.loudness
    }
    return {
      f,
      cast: {
        id: mv.id,
        level: lv,
        cooldownTicks: l.cooldownTicks,
        staminaCost: mv.cost.stamina ?? 0,
        overdriveCost: mv.cost.overdrive ?? 0,
        damage: l.damage ?? 0,
        trueDamage: l.trueDamage ?? 0,
        fissureLayers: l.fissureLayers ?? 0,
        muteTicks: l.muteTicks ?? 0,
        distance: l.distance ?? 0,
        landingPoise: mv.landing?.poise ?? 0,
        landingPoiseTicks: mv.landing?.withinTicks ?? 0,
        freezeTicks: l.freezeTicks ?? 0,
        overdriveRamp: mv.cost.overdriveRamp ?? 0,
        echoCharges: l.echoCharges ?? 0,
        parryWindowMul: mv.echo?.windowMul ?? 1,
        silenceTicks: l.silenceTicks ?? 0,
        silenceDmgBonus: l.silenceDmgBonus ?? 0,
        scaling: this.cfg.damage.scaling,
        overdriveLayerMul: this.cfg.damage.perOverdriveLayer
      }
    }
  }

  /* ---------------- 存档 ---------------- */

  /* ---------------- 被动栏（§7.3，KI-036） ---------------- */

  /** 已研读的被动：id → 等级（0 = 没学）。被动没有卸下动词——学了的常驻（页底常驻的本意） */
  private passiveLv = new Map<string, number>()

  passiveLevel(id: string): number { return this.passiveLv.get(id) ?? 0 }

  /** 当前等级的效果值（L0 = null）。量纲由 PassiveDef 的注释说，这条函数只管取数 */
  passiveValue(id: string): number | null {
    const def = this.cfg.passives?.find((d) => d.id === id)
    const lv = this.passiveLevel(id)
    if (!def || lv <= 0) return null
    return def.values[Math.min(lv, def.values.length) - 1] ?? null
  }

  /** 研读/升级一条被动：页要亮、等级没满、钱要够（同一本书的同一套扣费纪律） */
  learnPassive(id: string, inv: Inventory): MoveResult {
    const def = this.cfg.passives?.find((d) => d.id === id)
    if (!def) return { ok: false, reason: 'unknown' }
    if (!this.isLit(def.page)) return { ok: false, reason: 'lit' }
    const lv = this.passiveLevel(id)
    const max = def.values.length
    if (lv >= max) return { ok: false, reason: 'max' }
    const step = this.cfg.passiveCost?.[lv]
    if (!step) return { ok: false, reason: 'max' }
    if (inv.count(TIMBITE) < step.timbite || inv.count(SCORE) < step.score) return { ok: false, reason: 'poor' }
    inv.remove(TIMBITE, step.timbite)
    inv.remove(SCORE, step.score)
    this.passiveLv.set(id, lv + 1)
    return { ok: true }
  }

  snapshot(): MovementSnapshot {
    return {
      lit: [...this.lit],
      levels: Object.fromEntries(this.levels),
      slots: [...this.slots],
      passives: Object.fromEntries(this.passiveLv)
    }
  }

  /**
   * 读档。逐条对着表验：存档里可能有已被删掉的页/式子（或者手改的档），装上就等于凭空造出一式。
   * `rank` 一起交给它判槽位——槽是音级开的，「装着的槽没开」在存档里同样是可行的伪造。
   */
  restore(s: Partial<MovementSnapshot> | null | undefined, rank: number): void {
    this.lit.clear()
    this.levels.clear()
    this.passiveLv.clear()
    this.slots.fill(null)
    if (!s) return
    const cfg = this.cfg
    for (const id of s.lit ?? []) if (cfg.pages.some((p) => p.id === id)) this.lit.add(id)
    for (const [id, lv] of Object.entries(s.passives ?? {})) {
      const def = cfg.passives?.find((d) => d.id === id)
      // 与 levels 同一套纪律：认不出的、页没亮的、越界的（手改档）一律丢掉，不 clamp 成满级
      if (def && this.lit.has(def.page) && lv >= 1 && lv <= def.values.length) this.passiveLv.set(id, lv)
    }
    for (const [id, lv] of Object.entries(s.levels ?? {})) {
      const mv = cfg.movements.find((m) => m.id === id)
      if (mv && this.lit.has(mv.page) && lv >= 1 && lv <= mv.levels.length) this.levels.set(id, lv)
    }
    ;(s.slots ?? []).forEach((id, i) => {
      if (i >= this.slots.length || !this.slotOpen(i, rank)) return
      const mv = id ? cfg.movements.find((m) => m.id === id) : null
      this.slots[i] = mv && this.lit.has(mv.page) ? mv.id : null
    })
  }
}

/** 物品中文名（面板/播报共用；和 gearName 同一个口径） */
export function movementName(id: string): string {
  return registry.get<MovementConfig>('movements').movements.find((m) => m.id === id)?.displayName ?? id
}

export function unlockItemName(pageId: string): string {
  const cfg = registry.get<MovementConfig>('movements')
  const p = cfg.pages.find((x) => x.id === pageId)
  if (!p) return pageId
  return `${itemOf(p.unlock.item).displayName} ×${p.unlock.count}`
}
