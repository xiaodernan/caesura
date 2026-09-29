import * as THREE from 'three'
import type { RegionData, WeatherRow } from '@/data/schema'
import { weatherRows } from '@/data'

/**
 * 画面调色的唯一仲裁者（KI-094①）。它管的两格今天都只该有一个写方：
 * - `scene.fog.density` ← `weather.json` 那一行的雾密度（art-direction §8「指数雾，密度 Clear 0.008 /
 *   Fog 0.030 / Rain 0.018 / Storm 0.022」）。这一格在 2026-09-30 之前写死在 `world/PlaceholderArena.ts:25`
 *   的构造参数里，换区不改、天气不改，整片世界永远同一片雾。
 * - `canvas.style.filter` ← 天气的明度/对比乘数与 §11 失谐褪色的**合成**。WebGL 画面没有后处理管线，
 *   CSS filter 是这套环境里唯一真实的去饱和/调色通道（ENV-001 下的合理替代，接上真 post-processing
 *   pass 时换实现不换数据）。
 *
 * 为什么"合成"必须住在同一个类里：这两件事各自的落地时间是两次 commit。失谐那半早在 §11 就在写
 * `style.filter`，天气这半今天才有表。任何一方单独往那条字符串上写，都会把另一方的读数盖掉
 * （浏览器里只有最后一个写方说话）。所以 `setVeil()` 与 `setRegion()` 都只是**改输入**，
 * 真正动手的只有 `apply()` 一处，它每次把两条腿一起算完再写。
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

/**
 * 合成律（纯函数，测试直接吃它）：失谐负责 `saturate` 与亮度斜率，天气负责表里声明过的那两格乘数，
 * 两边相乘而不是互相覆盖。没有任何一条腿要说话时返回**空串**（= 不挂滤镜，与"没天气、没失谐"等价）。
 */
export function gradeFilter(veil: number, w: GradeReadings): string {
  const q = Math.round(veil * VEIL_QUANTUM) / VEIL_QUANTUM
  const parts: string[] = []
  if (q > 0) parts.push(`saturate(${(1 - q).toFixed(2)})`)
  const bright = (w.brightnessMul ?? 1) * (1 - q * VEIL_BRIGHTNESS_SLOPE)
  if (bright !== 1) parts.push(`brightness(${bright.toFixed(2)})`)
  const contrast = w.contrastMul ?? 1
  if (contrast !== 1) parts.push(`contrast(${contrast.toFixed(2)})`)
  return parts.join(' ')
}

export class ColorGrade {
  /** null = 这一区驻留的天气名在表里没有行，走基线（那个名字欠读数这件事由校验器的 pending 账交代） */
  private weather: WeatherRow | null = null
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
   * 玩家脚下的区域。读的是 `weatherPresets[0]`（驻留天气）。
   * 数组里后面那些格子是"修钟之后换成的样子"，那条切换今天还没有写方（世界状态里只有任务线给的
   * `STATE.BELLS.*`，把它接进来的腿欠在 KI-094②），所以这里**故意**不看 `[1]`。
   */
  setRegion(region: RegionData | null): void {
    this.setWeather(region?.weatherPresets?.[0] ?? null)
  }

  setWeather(name: string | null): void {
    this.weather = name === null ? null : this.rows.find((r) => r.id === name) ?? null
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
    const density = r?.fogDensity
    const fog = this.scene.fog as THREE.FogExp2 | null
    // 本作只有指数雾（`world/PlaceholderArena.ts` 建的就是 FogExp2，art-direction §8 那句也写的是指数雾）；
    // 需求 §38 的"天气改可见度"在别种雾上没有对应的那一格，所以这里不猜，直接不写。
    if (fog && typeof density === 'number') fog.density = density

    const next = gradeFilter(this.veil, r ?? {})
    if (next === this.applied) return
    this.applied = next
    this.canvas.style.filter = next
  }
}
