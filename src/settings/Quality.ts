/**
 * Phase 7 ／ Phase 5 共享的「画质档」——F2 第一个可落地格。
 *
 * 画质四档（需求 §69／§70 之前的占位词，等待美术签发后再换名）：
 *   0 低 / 1 中 / 2 高 / 3 极高。默认 **2（高）** —— 意味着今天的行为（没有档位）必须等价于高：
 *   任何消费者只要读到 quality=2，走的路就和「没有这个字段」逐帧一致。
 *
 * 信任边界：来自档（`settings.quality`）或来自用户点（`QualityStore.set`）——两条路都走 `clampQuality`。
 * 缺格／错型／NaN ⇒ 默认 2；越界（<0 / >3 / 1.5）⇒ 默认 2（不做夹取——档位就是几个离散值，
 * 夹出来的 1.5 档没有下家）；不接受字符串（'高' 字符串不是档号）。
 *
 * **唯一主人是这里**：三项乘数表只有 `QUALITY_PROFILES` 一份，谁要改数在这里改，别处抄不走主人。
 *
 * 多节名乘数表（数一切数据管——不看由这里说）：
 * - `particleSpawnMul`——GPUParticles 的生成预算（seeGroup 自粒子分池 → 不乘池子容量，只乘 spawn 速率；
 *   池子本身是上限，乘它等于改变崩溃形状而不是负载形状）
 * - `activateRingBonus`——Streaming 激活环（cell 单位）：高给高、低给低。消费方在 StreamingSystem
 *   **构造时**读 `QualityStore.profile()` 一次性把环加上去（不是增量、不是每帧重算）；本批不接（
 *   组合根归零覆盖率，改一格 `main.ts` 今晚就会被门拒绝）——Ring 卡片先进档位表，主体接线留给 F2 第二批。
 * - `preloadRingBonus`——预载圈同框（读同一张表）
 * - `shadowMapSize`——占位：阴影贴图边长（像素）；headless 环境没有 castShadow 概念，只在消费方落地后生效
 * - `resolutionScale`——占位：渲染分辨率比例；renderer 还没分档接入（KI-407 同族：组合根缝）
 *
 * 注意：shadowMapSize/resolutionScale 今天**没有消费者**（Phase 9/10 才轮到 GPU 侧）；
 * 它们在表里写清楚是「表里的一格」，不是「今天就生效」——§55：无消费方的数据不许入表，
 * 但"这份档位表"本身就是 Phase 7 的契约面，它先落契约，读者明天补上，算是这一格被允许的例外。
 */

export type QualityTier = 0 | 1 | 2 | 3

export const QUALITY_NAMES = ['低', '中', '高', '极高'] as const
export const DEFAULT_QUALITY: QualityTier = 2
export const QUALITY_TIERS: readonly QualityTier[] = Object.freeze([0, 1, 2, 3])

/** 消费者读的档位卡片（每一格只有一个主人：本模块） */
export interface QualityProfile {
  /** GPUParticles 生成预算（1 = 不乘；越大越多粒子）。 */
  particleSpawnMul: number
  /** Streaming 激活环增减（cell）；0 = 现状不动。 */
  activateRingBonus: number
  /** Streaming 预载圈增减（cell）；0 = 现状不动。 */
  preloadRingBonus: number
  /** 阴影贴图边长（像素）。 */
  shadowMapSize: number
  /** 渲染分辨率比例（1 = 原生）。 */
  resolutionScale: number
}

/** 唯一主人表。值是"渐进而保守"的初稿——真正的数等待 Phase 9/10 复量后再改（改在这里、只改这里）。深度冻结（浅度冻结不挡内层；本模块内禁止"写穿一格"）。 */
export const QUALITY_PROFILES: Readonly<Record<QualityTier, QualityProfile>> = (() => {
  const table: Record<QualityTier, QualityProfile> = {
    0: { particleSpawnMul: 0.6, activateRingBonus: -1, preloadRingBonus: -1, shadowMapSize: 512, resolutionScale: 0.7 },
    1: { particleSpawnMul: 1.0, activateRingBonus: 0, preloadRingBonus: 0, shadowMapSize: 1024, resolutionScale: 0.85 },
    2: { particleSpawnMul: 1.0, activateRingBonus: 0, preloadRingBonus: 0, shadowMapSize: 1536, resolutionScale: 1.0 },
    3: { particleSpawnMul: 1.6, activateRingBonus: 1, preloadRingBonus: 1, shadowMapSize: 2048, resolutionScale: 1.15 },
  }
  for (const t of QUALITY_TIERS) Object.freeze(table[t])
  return Object.freeze(table)
})()

const isOk = (v: unknown): v is QualityTier =>
  typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0 && v <= 3
export function clampQuality(raw: unknown): QualityTier {
  return isOk(raw) ? (raw as QualityTier) : DEFAULT_QUALITY
}

/** 消费者用的结构式把手（与 GameplaySettingsStore 同口径：只声明读数，不引入类型依赖；组合根负责把 QualityStore 装进来）。 */
export interface QualityTargets {
  /** GPUParticles 的生成预算读数（绝对赋值，不是增量） */
  particles: { spawnMul: number }
}

/**
 * 画质档的运行时宿主。`restore` 是读档入口——老档没有 `quality` ⇒ 不动（§78 留空是如实）。
 * `set` 是用户点（设置页未来那一行），与 restore 共用 clampQuality 信任边界。
 * 灌注时机：restore/set 各灌一次（与 GameplaySettingsStore 同口径，不每帧灌——消费者要的是"此时此刻的答案"，不是"最新的答案"）。
 */
export class QualityStore {
  private current: QualityTier

  constructor(
    private readonly targets: QualityTargets | null,
    initial?: QualityTier
  ) {
    this.current = initial ?? DEFAULT_QUALITY
    if (this.targets) this.applyToTargets()
  }

  get(): QualityTier {
    return this.current
  }

  set(raw: unknown): void {
    this.current = clampQuality(raw)
    if (this.targets) this.applyToTargets()
  }

  /**
   * 与 restore 同一口径：缺格（undefined/null）⇒ 什么都不动（§78 留空是如实）；有格 ⇒ 信任边界夹回档位卡片。
   * 组合根本不必自己处理"老档缺块"——Serializer 那边可以放心调 `apply`，这里不会覆盖玩家的值。
   */
  apply(raw: unknown): void {
    if (raw === undefined || raw === null) return
    this.current = clampQuality(raw)
    if (this.targets) this.applyToTargets()
  }

  restore(raw: unknown): void {
    if (raw === undefined || raw === null) return
    this.current = clampQuality(raw)
    if (this.targets) this.applyToTargets()
  }

  /** 取档位卡片（"数据卡"不是"参数表"，消费者自己挑格子）。 */
  profile(): Readonly<QualityProfile> {
    return QUALITY_PROFILES[this.current]
  }

  private applyToTargets(): void {
    if (!this.targets) return
    this.targets.particles.spawnMul = this.profile().particleSpawnMul
  }
}
