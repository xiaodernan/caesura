import type { LightingRow } from '@/data/schema'
import { lightingRows } from '@/data'

/**
 * §37 区域光照的**读数层**（逻辑层，不 import three）。
 *
 * 架构文档 §2 那张目录表里 `world/Lighting.ts` 这一行标了十周「未落」：`regions.json > lightingPreset`
 * 指着一个不存在的表，七区各有一个 `lp_*` 名字而没有任何一处代码读它。本文件把它落成**能读的那一半**：
 * 雾色（art-direction §8「雾色=区 DARK 与 SKY 的 70/30 混合」）与每区的 LUT 乘数（同节「每区 LUT 参数」）。
 *
 * **另一半故意不在这里**：三层光（极光 hemi / 区域 key / 局部 point）与跨区 70/30 色板过渡要的是真几何、
 * 真光源与连续地形（KI-008 / Phase 7）。这里不放它们的桩——放一个假的 `applyLights()` 比空着更糟，
 * 因为它会让「§37 已落地」这句话在搜索时看起来像真的。
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

/** 行键（`lp_*`）→ 行；认不出来返回 null（调用方落回基线，与 `WeatherSwitch` 同一口径） */
export function lightingRow(id: string | null | undefined): LightingRow | null {
  if (!id) return null
  return lightingRows.find((r) => r.id === id) ?? null
}

/** 0..255 三元组 → `#rrggbb`（`hexToRgb` 的逆，给画面侧 `Color.setStyle` 用；同一个编解码家住一处） */
export function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')
}
