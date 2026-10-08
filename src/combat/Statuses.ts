import { bus } from '@/core/EventBus'
import { registry } from '@/core/Registry'
import type { CorruptionStatus, StatusConfig } from '@/data/schema'
import type { EntityStats } from './EntityStats'

/**
 * §11 状态系统的运行时（Phase 5-C1）。五张状态里，这一层只管三件别人管不了的事：
 *
 * 1. **数值真源**：`data/json/statuses.json` 通过 `statusConfig()` 读，代码里不写常量（需求 §55）。
 *    共振过载是例外——它的数字本来就散在 player.json / progression.json 里，这张表只补它的 tooltip。
 * 2. **回响的账本**：回声影本身住在 `CombatManager`（那里才有唯一的伤害通道 `strikeEnemy`；
 *    在别处再打一遍就是第二条伤害流程）。这里只放它需要的调度器与失谐计量表。
 * 3. **世界观解释**（需求 §19）：每个状态第一次在玩家眼前发生时播一遍 `desc`。
 *    「查表看说明」是文档，「当场告诉你世界怎么解释这件事」才是玩法——所以消费口是 HUD 播报。
 */

export function statusConfig(): StatusConfig {
  return registry.get<StatusConfig>('statuses')
}

/**
 * 把状态数值挂到一具实体身上。EntityStats 刻意不认识 JSON：谁造出 stats，谁负责武装它
 * （调用点＝`ai/Enemy` 与 `player/ThirdPersonController` 的构造函数，各一处）。
 */
export function armStats(stats: EntityStats): void {
  const c = statusConfig()
  stats.fissureRules = {
    maxLayers: c.fissure.maxLayers,
    idleTicks: c.fissure.idleTicks,
    decayEveryTicks: c.fissure.decayEveryTicks
  }
  stats.muteRegenMul = c.mute.regenMul
}

/** Gameplay Tag 口径：数据里写 `mute` 与 `status.mute` 是同一个状态（末段匹配） */
export function tagIs(tag: string | undefined, id: keyof StatusConfig): boolean {
  return !!tag && new RegExp(`(^|\\.)${id}$`).test(tag)
}

/** 玩家侧的失谐（褪色值）计量表。§11 把它写成"区域压力机制而非惩罚"，所以这里只有累积/清除，没有惩罚分支 */
export class CorruptionMeter {
  value = 0
  readonly cfg: CorruptionStatus
  /** 耐受乘数（失谐属性给的，`PlayerMods.corruptionResistMul`）；由 applyRpg 灌进来 */
  resistMul = 1
  /**
   * 天气乘数（§5.9.33③ 失谐累积速率腿）：`weather.json > gameplay.corruptionMul`，
   * 由组合根在每次重算天气时灌进来（`world/WeatherEffects > corruptionMul`）。
   *
   * 与 `resistMul` **并列相乘而不是合成一格**：一个来自角色（属性/装备），一个来自世界（天气），
   * 两个主人各自的写方不同——合成一格之后，"这次累积变快了"再也说不清是装备还是天。
   * 环境暴露（`expose`）与精英命中（`combat/CombatManager`）两条路都走 `add()`，所以一处即两处。
   */
  weatherMul = 1

  constructor(cfg = statusConfig().corruption) {
    this.cfg = cfg
  }

  get full(): boolean { return this.value >= this.cfg.max }
  get frac(): number { return this.value / this.cfg.max }

  /**
   * 累积。返回实际加了多少（便于测试断言"耐受生效了"而不是"看起来生效了"）。
   * 三个乘数在这里相乘：基准量 × 耐受 × 天气。**只此一处**——分开写在调用方就会出现
   * "精英那条乘了、环境那条忘了"这类接线漏网。
   */
  add(amount: number): number {
    if (amount <= 0) return 0
    const before = this.value
    this.value = Math.min(this.cfg.max, this.value + amount * this.resistMul * this.weatherMul)
    return this.value - before
  }

  /** 清除（音色晶等消耗品给的是正数=要刮掉的量）。返回实际清掉多少 */
  purge(amount: number): number {
    if (amount <= 0) return 0
    const before = this.value
    this.value = Math.max(0, this.value - amount)
    return before - this.value
  }

  reset(): void { this.value = 0 }

  /**
   * 褪色表现量（0=本色，1=抽干）。§11 的措辞是"`>`60 起屏幕饱和度渐减"，
   * 所以这是一条从 `visualStart` 到 `max` 的线性斜坡，而不是一个开关。
   */
  veil(): number {
    const span = this.cfg.max - this.cfg.visualStart
    if (span <= 0 || this.value <= this.cfg.visualStart) return 0
    return Math.min(1, (this.value - this.cfg.visualStart) / span)
  }

  /**
   * 环境暴露：`perSec` 来自所在区域的 `corruption` 格（没写这格＝安全区，不进这个函数）。
   * 单独成函数的理由：让"站着不动也在褪色"这件事可以在 headless 里被逐 tick 断言。
   */
  expose(dt: number, perSec: number): void {
    if (perSec <= 0) return
    this.add(perSec * dt)
  }

  /** 满值后的掉血（只在非安全区调用）。返回本 tick 该扣的血，调用方负责走玩家受伤通道 */
  drain(dt: number): number {
    if (!this.full) return 0
    return this.cfg.hpPerSec * dt
  }

  /**
   * 一 tick 的环境结算。**区域那一个是唯一的闸门**：没有 `corruption` 格 ⇒ 既不会累积，
   * 也不会在满值时掉血（安全区里带着满值走回家是可以的）。主循环只许走这里——
   * 把 expose/drain 分头写在调用方，就会出现「安全区也在流血」这类接线漏网（实机抓到过）。
   */
  tickEnvironment(dt: number, cell: { perSec: number } | undefined): number {
    if (!cell) return 0
    this.expose(dt, cell.perSec)
    return this.drain(dt)
  }
}

/** 状态的第一次解释（需求 §19）。一局之内每个状态只播一次，播过的记在这里 */
export class StatusGlossary {
  private seen = new Set<keyof StatusConfig>()

  /** 返回 true = 这是本局第一次见到它（调用方据此播 chip，避免每次施加都刷屏） */
  explain(id: keyof StatusConfig): boolean {
    if (this.seen.has(id)) return false
    this.seen.add(id)
    const s = statusConfig()[id]
    bus.emit('ui.notify', { text: `${s.displayName}｜${s.desc}`, kind: 'info' })
    return true
  }

  forgetAll(): void { this.seen.clear() }
}

/** 与 `bus` / `registry` 同级的进程单例：解释是"这一局"的事，不该出现两份互相重复的台账 */
export const glossary = new StatusGlossary()
