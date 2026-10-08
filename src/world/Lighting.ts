import type { LightingRow } from '@/data/schema'
import { lightingRows } from '@/data'

/**
 * §37 第二腿的三层光读数（`lightingLights()` 的返回形状）。三个 hex + 三个强度 + 一个方向——
 * 表现层（`world/SceneLights.ts`）只负责把它们搬到 `THREE.Light` 上，不再做任何判断。
 */
export interface LightRig {
  /** 极光 hemi 的天色（= SKY 列，SKY 省略时按 SEC） */
  hemiSky: string
  /** 极光 hemi 的地色（= DARK 列） */
  hemiGround: string
  hemiIntensity: number
  /** 区域 key 方向光色（= SKY 列，SKY 省略时按 SEC） */
  keyColor: string
  /** 0 = 这一区不建方向光（§8 的深窖例外） */
  keyIntensity: number
  /** 方向光的方向（世界坐标，从被照物指向光源） */
  keyDir: [number, number, number]
  /** 局部 point 色（= EMIT 列） */
  pointColor: string
  pointIntensity: number
}

/**
 * §37 区域光照的**读数层**（逻辑层，不 import three）。
 *
 * 架构文档 §2 那张目录表里 `world/Lighting.ts` 这一行标了十周「未落」：`regions.json > lightingPreset`
 * 指着一个不存在的表，七区各有一个 `lp_*` 名字而没有任何一处代码读它。本文件把它落成**能读的那一半**：
 * 雾色（art-direction §8「雾色=区 DARK 与 SKY 的 70/30 混合」）与每区的 LUT 乘数（同节「每区 LUT 参数」）。
 *
 * **另一半也在这里，但只到读数为止**：三层光（极光 hemi / 区域 key / 局部 point）的**颜色与强度读数**由
 * `lightingLights()` 出（§37 第二腿），画的那一半在表现层 `world/SceneLights.ts`。仍然不在这里的是
 * **跨区 70/30 色板过渡带**——它要的是连续地形与"站在两区之间"这个空间概念，而今天的流送模型
 * （`world/Streaming.ts > regionAt`）对任何一个坐标只回答一个区（KI-008 / Phase 7）。
 * 这里不放过渡带的桩——放一个假的 `blend()` 比空着更糟，因为它会让「过渡带已落地」在搜索时看起来像真的。
 *
 * 与 `world/WeatherSwitch.ts` 的分工：那一格回答「这一区今天奏哪一格天气」，这一格回答「这一区的光长什么样」。
 * 两者**不合并**——§5.9.33 的欠账②写明「它和天气是两格，别把它们合成一个假的仲裁者」。
 */

/** art-direction §8：雾色 = 区 DARK 与 SKY 的 **70/30** 混合。这条比例只有一个家，就是这里 */
export const FOG_DARK_SHARE = 0.7
/** 同上，天光那一份（两数相加必须是 1：判据钉着，改一处不改另一处会红） */
export const FOG_SKY_SHARE = 0.3

/** 中性的 LUT 读数（= 不挂那一格滤镜）。文档没给数的区就是它 */
const NEUTRAL_GRADE = { saturateMul: 1, contrastMul: 1 } as const

/** 这一行的 LUT 读数；没给数的格按 1.0 中性（缺省 = 不改那一格，而不是猜一个数） */
export function lightingGrade(row: LightingRow | null | undefined): { saturateMul: number; contrastMul: number } {
  return {
    saturateMul: row?.grade?.saturateMul ?? NEUTRAL_GRADE.saturateMul,
    contrastMul: row?.grade?.contrastMul ?? NEUTRAL_GRADE.contrastMul,
  }
}

/**
 * `#RGB` / `#RRGGBB` → 0..255 三元组；不是合法 hex 返回 null（调用方决定怎么说话，不在这里吞）。
 * 大小写不敏感——文档那张表里大小写混用（`#3A2C1E` 与 `#E8DFCB`），按大小写判合法等于判文档不合法。
 */
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return null
  const h = m[1]
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
}

/**
 * 这一行的雾色（0..255 三元组，给 `THREE.Color.setRGB` 用）。
 *
 * §8 的 70/30 是**按通道**混的，不是把两个 hex 拼起来；`sky` 省略的行（文档写「无天光」「无（地下）」）
 * 整份取 DARK——那种地方的天光份额是 0，不是「找个近似色顶上」。
 */
export function lightingFogRgb(row: LightingRow | null | undefined): [number, number, number] | null {
  const dark = row ? hexToRgb(row.dark) : null
  if (!dark) return null
  if (!row?.sky) return dark
  const sky = hexToRgb(row.sky)
  if (!sky) return dark
  return [
    Math.round(dark[0] * FOG_DARK_SHARE + sky[0] * FOG_SKY_SHARE),
    Math.round(dark[1] * FOG_DARK_SHARE + sky[1] * FOG_SKY_SHARE),
    Math.round(dark[2] * FOG_DARK_SHARE + sky[2] * FOG_SKY_SHARE),
  ]
}

/**
 * §37 第二腿：这一行的**三层光读数**（art-direction §8 那句「每区三层光」）。
 *
 * 颜色一格都不新开——§8 把映射写死了，这里只是把它念出来：
 *  · `hemiSky` / `keyColor` = **SKY 列**（§8「区域 key（方向光，色=SKY 列）」；§5.1「区域色板的
 *    SKY 列决定各区看到的带占比」⇒ 极光 hemi 的天色同样随它）；
 *  · `hemiGround` = **DARK 列**（半球光的"地色"本来就是从暗部反弹上来的那一半）；
 *  · `pointColor` = **EMIT 列**（§8「局部 point（火/钟/矿，色=EMIT）」）。
 *
 * **SKY 列省略时按 SEC 走**（实施期裁决 L1，理由记在 `scripts/lighting-rules.mjs > LIGHT_RULINGS`）：
 * 文档在三行里明写「无天光（纯黑）」／「无（地下）」／「落日渐层两停」——单色格装不下两停，
 * 而 §8 又只给了深窖一个"没有 key 光"的例外。所以那三行的方向光不能没有，只能另取一色：
 * SEC 是 §2 里"次要"那一档，正是天光退潮之后剩下的颜色。深窖那道例外不走这条路——
 * 它的 `lights.keyIntensity` 在表里就写着 0，方向光压根不建。
 *
 * 强度与方向来自 `lights`（文档一个数都没给 ⇒ 表里显式写 + 裁决账本挂着理由，判据 L1）。
 * `lights` 缺失时三格强度全给 0：**没有裁决过的光不许亮**，猜一个强度比不亮更糟
 * （校验器 L4 钉着真表七行都有 `lights`，所以这条退路只在合成行上走）。
 */
export function lightingLights(row: LightingRow | null | undefined): LightRig | null {
  if (!row) return null
  const hemiSky = row.sky ?? row.sec
  const colors = [hemiSky, row.dark, row.emit]
  if (colors.some((c) => hexToRgb(c) === null)) return null
  const l = row.lights
  return {
    hemiSky,
    hemiGround: row.dark,
    hemiIntensity: l?.hemiIntensity ?? 0,
    keyColor: hemiSky,
    keyIntensity: l?.keyIntensity ?? 0,
    keyDir: l?.keyDir ?? [0, 0, 0],
    pointColor: row.emit,
    pointIntensity: l?.pointIntensity ?? 0,
  }
}

/** 行键（`lp_*`）→ 行；认不出来返回 null（调用方落回基线，与 `WeatherSwitch` 同一口径） */
export function lightingRow(id: string | null | undefined): LightingRow | null {
  if (!id) return null
  return lightingRows.find((r) => r.id === id) ?? null
}

/** 0..255 三元组 → `#rrggbb`（`hexToRgb` 的逆，给画面侧 `Color.setStyle` 用；同一个编解码家住一处） */
export function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')
}
