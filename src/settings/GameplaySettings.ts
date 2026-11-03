/**
 * KI-112 第一腿：玩法/辅助设置第一次有数据形状。
 *
 * 八格各有真实的规格出处与真实消费者（§55：设计数要带消费方，不是死设置店）：
 * - `bufferMs`  ui-ux §5.1 输入缓冲滑条 80–240ms → `Input.bufferSec`
 * - `frameAssist` 输入缓冲多保一帧（+1 tick）→ `Input.frameAssist`
 * - `shakeScale` combat.md §10 设置项 0–150% → `CameraRig.shakeIntensity`
 * - `rumbleScale` ui-ux §6 手柄振动 0–200% → `Haptics.scale`
 * - `rumbleWeakScale` 同一行的「弱/强马达独立」那半句 → `Haptics.weakScale`（KI-359 才落地）
 * - `damageScale` gameplay.md:312 受击伤害 70–130% → `CombatManager.damageScale`
 * - `holdMs`  ui-ux §6 长按阈值 200–800ms → `PlayerController.holdMs`（重键「按住再松」那条线）
 * - `mashGuard`  ui-ux §6 同一行的「连打关闭」→ `PlayerController.mashGuard`（§7.2 那两行的防连发涨价）
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
  /** 振动倍率·强马达（ui-ux §6：0–200%）。1 = 表里的原样；幅值在 Gamepad API 顶格 1 处截断 */
  rumbleScale: number
  /**
   * 振动倍率·弱马达（同一行的「弱/强马达独立」，KI-359）。默认 1 = 把「一把尺」那一段
   * 的行为原样登记下来：老档没有这一格读成 1，手感一格都不变，因此不推存档版本号。
   * 两格共用 0–200% 那**一条界**，但各乘各的幅值——表里 strong/weak 的比例本来就每档不同。
   */
  rumbleWeakScale: number
  /** 受击伤害倍率（gameplay.md:312：70–130%）。只乘玩家**收到**的那一份 */
  damageScale: number
  /**
   * 长按阈值毫秒（ui-ux §6：200–800）。默认 200 = 消费者声明的 `HEAVY_HOLD_MS`，
   * 也是这一格**下限**——离旧行为（句子中间那把 8 tick 的线＝133ms）最近的那一端。
   * 它管的是重键「按住再松」：松手时按住没超过这条线 ⇒ 出一记 `h`；过了线又没蓄满 ⇒ 取消。
   */
  holdMs: number
  /**
   * 防连发涨价开关（ui-ux §6 那一行的「连打关闭」，KI-384）。默认 开 ＝ 今天的行为逐字不变：
   * §7.2 那两行（休止斩／终止「每次使用后过载消耗 +2」）照旧一档一档往上涨。
   * 关 ⇔ 不再写涨价，**且关掉那一刻把已涨的那一截清掉**（它是一只开关，不是一台暂停的表）；
   * 重新打开从底价重新起算。管的是「这份账长不长、还在不在」，不是「付多少」——
   * 验价那一句（`overdriveCostOf`）一个字不认这个开关。
   */
  mashGuard: boolean
}

export const DEFAULT_GAMEPLAY_SETTINGS: Readonly<GameplaySettings> = Object.freeze({
  bufferMs: 200,
  frameAssist: false,
  shakeScale: 1,
  rumbleScale: 1,
  rumbleWeakScale: 1,
  damageScale: 1,
  holdMs: 200,
  mashGuard: true
})

/** 数值格的界（与规格出处一一对应；boolean 格不在此表） */
export const GAMEPLAY_BOUNDS = Object.freeze({
  bufferMs: { min: 80, max: 240 },
  shakeScale: { min: 0, max: 1.5 },
  rumbleScale: { min: 0, max: 2 },
  rumbleWeakScale: { min: 0, max: 2 },
  damageScale: { min: 0.7, max: 1.3 },
  holdMs: { min: 200, max: 800 }
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
    rumbleWeakScale: num('rumbleWeakScale', GAMEPLAY_BOUNDS.rumbleWeakScale),
    damageScale: num('damageScale', GAMEPLAY_BOUNDS.damageScale),
    holdMs: num('holdMs', GAMEPLAY_BOUNDS.holdMs),
    mashGuard: typeof src.mashGuard === 'boolean' ? src.mashGuard : DEFAULT_GAMEPLAY_SETTINGS.mashGuard
  }
}

/**
 * 设置消费者们的结构式把手（与 SaveWorld.audio 同一口径：只声明读数，不引入类型依赖）。
 * 组合根（main.ts）负责把自己的实例装进来；单元测试可以塞假件。
 */
export interface GameplaySettingsTargets {
  input: { bufferSec: number; frameAssist: boolean }
  rig: { shakeIntensity: number }
  /** 两把尺各一个字段（KI-359）：一个数灌两遍就是「独立」那半句没落地的那个形状 */
  haptics: { scale: number; weakScale: number }
  combat: { damageScale: number }
  /**
   * 第五、六把消费者：长按阈值与防连发开关都不是给存档看的数，它们判的是玩家自己那一记出手。
   * 声明成**必填**而不是可选——可选就意味着「装配处忘了它」也是一份能跑的档，
   * 而忘了接的那一格会在面板上照样动、在手感上一个字不响（`applyToTargets` 里那句是唯一灌入路径）。
   */
  player: { holdMs: number; mashGuard: boolean }
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

  /** 把当前值灌进消费者（bufferMs→秒；振动两把尺各灌各的字段，幅值在消费者侧截断；holdMs→毫秒原样给，换成拍数是消费者的换算；mashGuard→布尔原样给，翻转那一下的清账住在消费者那里） */
  private applyToTargets(): void {
    if (!this.targets) return
    this.targets.input.bufferSec = this.current.bufferMs / 1000
    this.targets.input.frameAssist = this.current.frameAssist
    this.targets.rig.shakeIntensity = this.current.shakeScale
    this.targets.haptics.scale = this.current.rumbleScale
    this.targets.haptics.weakScale = this.current.rumbleWeakScale
    this.targets.combat.damageScale = this.current.damageScale
    this.targets.player.holdMs = this.current.holdMs
    this.targets.player.mashGuard = this.current.mashGuard
  }

  /** 读档入口：undefined/null（老档无此块）⇒ 不动；有块 ⇒ 夹取后生效 */
  restore(raw: unknown): void {
    if (raw === undefined || raw === null) return
    this.current = clampGameplaySettings(raw)
    if (this.targets) this.applyToTargets()
  }
}
