/**
 * KI-112 第一腿：玩法/辅助设置第一次有数据形状。
 *
 * 五格各有真实的规格出处与真实消费者（§55：设计数要带消费方，不是死设置店）：
 * - `bufferMs`  ui-ux §5.1 输入缓冲滑条 80–240ms → `Input.bufferSec`
 * - `frameAssist` 输入缓冲多保一帧（+1 tick）→ `Input.frameAssist`
 * - `shakeScale` combat.md §10 设置项 0–150% → `CameraRig.shakeIntensity`
 * - `rumbleScale` ui-ux §6 手柄振动 0–200% → `Haptics.scale`
 * - `damageScale` gameplay.md:312 受击伤害 70–130% → `CombatManager.damageScale`
 *
 * 这份形状也是**信任边界**：存档里的数谁都能写，`clampGameplaySettings` 是
 * 读档路径上唯一被信任的入口——缺格/错型回默认，越界夹取，NaN 回默认。
 * 消费者（Input/CameraRig/Haptics/CombatManager）只认自己字段，不认识这张表。
 */

export interface GameplaySettings {
  /** 输入缓冲窗口毫秒（ui-ux §5.1：80–240）。默认 200 = 发售常量 INPUT_BUFFER_SEC */
  bufferMs: number
  /** 辅助：输入缓冲窗口在 bufferMs 之外再多保一帧（+TICK_DT 秒） */
  frameAssist: boolean
  /** 震镜倍率（combat.md §10 设置项：0–150%）。1 = 表里的原样 */
  shakeScale: number
  /** 振动倍率（ui-ux §6：0–200%）。1 = 表里的原样；幅值在 Gamepad API 顶格 1 处截断 */
  rumbleScale: number
  /** 受击伤害倍率（gameplay.md:312：70–130%）。只乘玩家**收到**的那一份 */
  damageScale: number
}

export const DEFAULT_GAMEPLAY_SETTINGS: Readonly<GameplaySettings> = Object.freeze({
  bufferMs: 200,
  frameAssist: false,
  shakeScale: 1,
  rumbleScale: 1,
  damageScale: 1
})

/** 数值格的界（与规格出处一一对应；boolean 格不在此表） */
export const GAMEPLAY_BOUNDS = Object.freeze({
  bufferMs: { min: 80, max: 240 },
  shakeScale: { min: 0, max: 1.5 },
  rumbleScale: { min: 0, max: 2 },
  damageScale: { min: 0.7, max: 1.3 }
})

const clamp = (v: number, b: { min: number; max: number }): number => Math.max(b.min, Math.min(b.max, v))

/**
 * 存档/恢复路径上的信任边界：`raw` 来自档（可被玩家手改）。
 * 缺格或错型 ⇒ 默认；数越界 ⇒ 夹到界内；NaN ⇒ 默认（NaN 连比较都不过）。
 * 返回全新对象——不把调用方的 raw 引用存进任何地方。
 */
export function clampGameplaySettings(raw: unknown): GameplaySettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const num = (key: keyof GameplaySettings, bounds?: { min: number; max: number }): number => {
    const v = src[key]
    if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_GAMEPLAY_SETTINGS[key] as number
    return bounds ? clamp(v, bounds) : v
  }
  return {
    bufferMs: num('bufferMs', GAMEPLAY_BOUNDS.bufferMs),
    frameAssist: typeof src.frameAssist === 'boolean' ? src.frameAssist : DEFAULT_GAMEPLAY_SETTINGS.frameAssist,
    shakeScale: num('shakeScale', GAMEPLAY_BOUNDS.shakeScale),
    rumbleScale: num('rumbleScale', GAMEPLAY_BOUNDS.rumbleScale),
    damageScale: num('damageScale', GAMEPLAY_BOUNDS.damageScale)
  }
}

/**
 * 设置消费者们的结构式把手（与 SaveWorld.audio 同一口径：只声明读数，不引入类型依赖）。
 * 组合根（main.ts）负责把自己的实例装进来；单元测试可以塞假件。
 */
export interface GameplaySettingsTargets {
  input: { bufferSec: number; frameAssist: boolean }
  rig: { shakeIntensity: number }
  haptics: { scale: number }
  combat: { damageScale: number }
}

/**
 * 设置的运行时宿主：持有一份已夹取的当前值，`set` 走信任边界、改完立刻灌进消费者。
 * `restore` 是读档的入口——老档没有 gameplay 块 ⇒ `raw` 为 undefined ⇒ 什么都不动
 * （§78：留空是如实，运行时保持当前值，不假装"重置成默认"）。
 */
export class GameplaySettingsStore {
  private current: GameplaySettings

  constructor(
    private readonly targets: GameplaySettingsTargets | null,
    initial?: Partial<GameplaySettings>
  ) {
    this.current = clampGameplaySettings({ ...DEFAULT_GAMEPLAY_SETTINGS, ...initial })
    if (this.targets) this.applyToTargets()
  }

  get(): GameplaySettings {
    return { ...this.current }
  }

  set(patch: Partial<GameplaySettings>): void {
    this.current = clampGameplaySettings({ ...this.current, ...patch })
    if (this.targets) this.applyToTargets()
  }

  /** 把当前值灌进消费者（bufferMs→秒；振动幅值在消费者侧截断） */
  private applyToTargets(): void {
    if (!this.targets) return
    this.targets.input.bufferSec = this.current.bufferMs / 1000
    this.targets.input.frameAssist = this.current.frameAssist
    this.targets.rig.shakeIntensity = this.current.shakeScale
    this.targets.haptics.scale = this.current.rumbleScale
    this.targets.combat.damageScale = this.current.damageScale
  }

  /** 读档入口：undefined/null（老档无此块）⇒ 不动；有块 ⇒ 夹取后生效 */
  restore(raw: unknown): void {
    if (raw === undefined || raw === null) return
    this.current = clampGameplaySettings(raw)
    if (this.targets) this.applyToTargets()
  }
}
