import * as THREE from 'three'
import type { LightingRow, WeatherRow } from '@/data/schema'
import { weatherRows } from '@/data'
import { blendLightingSnapshot, lightingSnapshot, rgbToHex, type LightingSnapshot } from '@/world/Lighting'

/**
 * 画面调色的唯一仲裁者（KI-094①）。它管的两格今天都只该有一个写方：
 * - `scene.fog.density` ← `weather.json` 那一行的雾密度（art-direction §8「指数雾，密度 Clear 0.008 /
 *   Fog 0.030 / Rain 0.018 / Storm 0.022」）。这一格在 2026-09-30 之前写死在 `world/PlaceholderArena.ts:25`
 *   的构造参数里，换区不改、天气不改，整片世界永远同一片雾。
 * - `scene.fog.color` ← `lighting.json` 那一行的雾色（同节「雾色=区 DARK 与 SKY 的 70/30 混合」）。
 *   这是 §37 的第一条落地腿（KI-094 同族）：`lightingPreset` 这个名字十周来没有任何读者。
 * - `canvas.style.filter` ← 天气的明度/对比乘数与 §11 失谐褪色的**合成**。WebGL 画面没有后处理管线，
 *   CSS filter 是这套环境里唯一真实的去饱和/调色通道（ENV-001 下的合理替代，接上真 post-processing
 *   pass 时换实现不换数据）。
 *
 * 为什么"合成"必须住在同一个类里：这两件事各自的落地时间是两次 commit。失谐那半早在 §11 就在写
 * `style.filter`，天气这半今天才有表。任何一方单独往那条字符串上写，都会把另一方的读数盖掉
 * （浏览器里只有最后一个写方说话）。所以 `setVeil()` 与 `setWeather()` 都只是**改输入**，
 * 真正动手的只有 `apply()` 一处，它每次把两条腿一起算完再写。
 *
 * 它**不认识区域也不认识旗标**：「脚下这一区当前生效的是哪一格天气」由 `world/WeatherSwitch` 推导
 * （KI-094②），组合根把那个名字递进来。这一层只管"这一格怎么画"。
 */

/**
 * 没有读数的天气名走的那一行。这个名字的**主人**是 `scripts/weather-rules.mjs > WEATHER_BASELINE_ID`
 * （判据⑤钉着那一行必须存在且给得出雾密度）；`tests/unit/color-grade.test.ts` 把这两个字面量钉在一起，
 * 所以这里不是第二份账，而是同一句话的读者侧。
 */
const BASELINE_ID = 'clear'

/** §11「饱和度渐减」的亮度那一半：失谐满值时屏幕剩 70% 亮度（沿用 main.ts 落地以来的 0.3 斜率） */
const VEIL_BRIGHTNESS_SLOPE = 0.3
/** 失谐量化到 5% 一档：CSS filter 每帧改一次会一直触发重排（量化是为了省重排，不是为了好看） */
const VEIL_QUANTUM = 20

/** 天气行里能被画面读的那两格（`fogDensity` 走雾，这两格走 filter） */
export type GradeReadings = Pick<WeatherRow, 'brightnessMul' | 'contrastMul'>

/** 光照行里能被画面读的那两格（§8 的 LUT 参数；`fog` 那一格走雾色，不经这条滤镜） */
export type LightingReadings = Pick<NonNullable<LightingRow['grade']>, 'saturateMul' | 'contrastMul'>

/**
 * 合成律（纯函数，测试直接吃它）：失谐负责 `saturate` 与亮度斜率，天气与光照各负责表里声明过的乘数，
 * 三方相乘而不是互相覆盖。没有任何一条腿要说话时返回**空串**（= 不挂滤镜，与"没天气、没失谐、没光照"等价）。
 *
 * 第三条腿（`l`）是 §37 落地时加的，**可选且缺省中性**：不传 = 今天所有既有调用点的读数一个字节都不变。
 * 饱和度那一格三方相乘（失谐往下压、天气没有这一格、光照的 LUT 往上抬），对比度只有天气与光照两方——
 * §11 的失谐不碰对比度，这是它从落地那天起的口径，不是这次改的。
 */
export function gradeFilter(veil: number, w: GradeReadings, l?: LightingReadings): string {
  const q = Math.round(veil * VEIL_QUANTUM) / VEIL_QUANTUM
  const parts: string[] = []
  const sat = (1 - q) * (l?.saturateMul ?? 1)
  if (sat !== 1) parts.push(`saturate(${sat.toFixed(2)})`)
  const bright = (w.brightnessMul ?? 1) * (1 - q * VEIL_BRIGHTNESS_SLOPE)
  if (bright !== 1) parts.push(`brightness(${bright.toFixed(2)})`)
  const contrast = (w.contrastMul ?? 1) * (l?.contrastMul ?? 1)
  if (contrast !== 1) parts.push(`contrast(${contrast.toFixed(2)})`)
  return parts.join(' ')
}

export class ColorGrade {
  /** null = 这一区驻留的天气名在表里没有行，走基线（那个名字欠读数这件事由校验器的 pending 账交代） */
  private weather: WeatherRow | null = null
  /**
   * §37 的**已解析光照读数**（雾色 + LUT + 三层光）。存快照而不是存行，是为了让「单行」与
   * 「§2 跨区过渡带的两行混合」走同一条内部路径——否则混合要另起一套解析，那就是第二个仲裁者。
   * null = 还没有区域（或那一区的 `lightingPreset` 读不出行）⇒ 雾色保持场景建好时的样子，不猜一个。
   */
  private lighting: LightingSnapshot | null = null
  /** 上一次真正写进雾里的颜色：过渡带每帧都算，这个短路省掉的是每帧一次 hex 解析 + setStyle */
  private appliedFog: string | null = null
  private veil = 0
  /** 上一次真正写进 DOM 的字符串：只有它变了才动手（`setVeil` 每帧都被叫，而绝大多数帧不该重排） */
  private applied: string | null = null

  constructor(
    private readonly scene: THREE.Scene,
    private readonly canvas: HTMLCanvasElement,
    private readonly rows: WeatherRow[] = weatherRows,
  ) {
    this.apply()
  }

  /**
   * 现在生效的那一格天气（名字来自 `world/WeatherSwitch > activeWeather`：那一区驻留的天气，
   * 或修过钟之后换上的那一格）。**这一层不认识区域也不认识旗标**——它只接一个天气名，
   * 因为"哪一格生效"是玩法侧的推导（KI-094②），而"这一格怎么画"是这里的活。
   * 名字为 null（没有区、或那一区没声明天气）或表里没这一行时走基线（`clear`）；
   * 名字欠读数这件事由校验器的 `PENDING_WEATHER_READINGS` 账交代，不由这里编一个默认值。
   */
  setWeather(name: string | null): void {
    this.weather = name === null ? null : this.rows.find((r) => r.id === name) ?? null
    this.apply()
  }

  /**
   * §37 这一区的光照预设（`regions.json > lightingPreset` 的那一行）。**这一层不认识区域**——
   * 「哪一区」是组合根的事（与 `setWeather` 同一条理由：画面层一旦认识区域，就长出第二份切换判据）。
   * 认不出名字时传 null：不写雾色、LUT 按中性，而"指了个不存在的行"由校验器的引用判据说。
   */
  setLighting(row: LightingRow | null): void {
    this.lighting = lightingSnapshot(row)
    this.apply()
  }

  /**
   * §2 跨区过渡带：两行按 `t` 线性混合后喂进来（`t` = 0 全是 a，= 1 全是 b）。
   *
   * **为什么混合发生在读数层而不是这一层**：`sky` 那一格有三行故意省略，行层插值答不出
   * "一边有天光一边没有"该怎么办；而 `world/Lighting.ts` 里每一格都已结论化（雾色已是 70/30
   * 混出来的一个色、key 色已按 SEC 退路定好），插值没有歧义。这一层仍然只负责"画"。
   *
   * 任一侧读不出 ⇒ 整体退回有的那一侧（`blendLightingSnapshot` 的口径）：猜一个中间色比不混合更糟。
   */
  setLightingBlend(a: LightingRow | null, b: LightingRow | null, t: number): void {
    this.lighting = blendLightingSnapshot(lightingSnapshot(a), lightingSnapshot(b), t)
    this.apply()
  }

  /** §11 失谐（0..1）：`player.corruption.veil()` 的读数。改这里不会重算雾，只重算 filter */
  setVeil(v: number): void {
    this.veil = v
    this.apply()
  }

  /** 当前生效的雾密度；表里这一行没给 `fogDensity` 时返回 null（= 雾保持场景建好时的样子） */
  fogDensity(): number | null {
    return this.row()?.fogDensity ?? null
  }

  private row(): WeatherRow | undefined {
    return this.weather ?? this.rows.find((r) => r.id === BASELINE_ID)
  }

  private apply(): void {
    const r = this.row()
    const snap = this.lighting
    const density = r?.fogDensity
    const fog = this.scene.fog as THREE.FogExp2 | null
    // 本作只有指数雾（`world/PlaceholderArena.ts` 建的就是 FogExp2，art-direction §8 那句也写的是指数雾）；
    // 需求 §38 的"天气改可见度"在别种雾上没有对应的那一格，所以这里不猜，直接不写。
    if (fog && typeof density === 'number') fog.density = density

    const fogRgb = snap?.fogRgb ?? null
    if (fog && fogRgb) {
      const hex = rgbToHex(fogRgb)
      // 过渡带每帧都会走到这里；同一个色不重复解析（hex → Color 的解析不是免费的）
      if (hex !== this.appliedFog) {
        fog.color.setStyle(hex)
        this.appliedFog = hex
      }
    }

    const next = gradeFilter(this.veil, r ?? {}, snap?.grade)
    if (next === this.applied) return
    this.applied = next
    this.canvas.style.filter = next
  }
}
