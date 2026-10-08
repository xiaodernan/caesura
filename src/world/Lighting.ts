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
 * §2 跨区过渡带：**带子的半宽**（米）。文档原句是「跨区过渡带（如钟坠院→深窖）色板按 70/30→30/70
 * 线性混合，过渡长度 ≥ 150m，禁止硬切」。
 *
 * 裁决（文档没说的是带子骑在接缝哪一边、两个端点在多远处）：**以接缝为中线，向两侧各探 200m**，
 * 邻居权重从带子外缘（自己那侧 200m）处的 0 线性升到接缝处的 `TRANSITION_SEAM_W`。于是 70/30 与 30/70
 * 各落在接缝内外 80m 处，两点相距 **160m ≥ 150m**（文档那句「过渡长度 ≥ 150m」），整条带 400m 连续、
 * 无任何跳变。选 400m 总宽而不是 300m，是因为 300m 总宽下 70/30 与 30/70 只隔 120m，凑不出文档那个长度。
 */
export const TRANSITION_HALF_M = 200

/**
 * §2 过渡带权重：**站在接缝上时邻居那一侧的占比**（0.5 = 两区各半）。`paletteBlendAt` 返回的 `t` 就是
 * 「邻居权重」：带子外缘（离接缝 `TRANSITION_HALF_M`）为 0，朝接缝线性爬到本值。取 0.5 是因为接缝是两区的
 * 对称中线，谁也没有理由多占一寸；也正是这个对称，让 70/30 与 30/70 到接缝等距（各 80m）。
 */
export const TRANSITION_SEAM_W = 0.5

/** 0..255 三元组逐通道线性插值 */
function lerpRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

/** 两个 hex 逐通道插值 ⇒ hex。任一侧不是合法 hex 时返回另一侧（与 `pick` 同一条口径） */
function lerpHex(a: string, b: string, t: number): string {
  const ra = hexToRgb(a)
  const rb = hexToRgb(b)
  if (!ra) return b
  if (!rb) return a
  return rgbToHex(lerpRgb(ra, rb, t))
}

const lerpNum = (a: number, b: number, t: number): number => a + (b - a) * t

/**
 * §2 跨区过渡带的**已解析读数**（`lightingFogRgb` / `lightingGrade` / `lightingLights` 三样的并集）。
 *
 * 为什么混合发生在**读数层**而不是行层：`sky` 这一格有三行故意省略，而行层的插值答不出
 * "一边有天光一边没有"该怎么办。读数层每一格都已经结论化（雾色已是 70/30 混出来的一个色、
 * key 色已按 SEC 退路定好），插值就没有歧义了。
 */
export interface LightingSnapshot {
  /** 雾色（§8 的 70/30 已混完）；null = 不写雾色 */
  fogRgb: [number, number, number] | null
  grade: { saturateMul: number; contrastMul: number }
  lights: LightRig | null
}

/** 一行 → 已解析读数。`null` 行 ⇒ 三样全空（调用方据此"不写"） */
export function lightingSnapshot(row: LightingRow | null | undefined): LightingSnapshot {
  return {
    fogRgb: lightingFogRgb(row),
    grade: lightingGrade(row),
    lights: lightingLights(row),
  }
}

/**
 * 两份读数按 `t` 线性混合（`t` = 0 全是 a，= 1 全是 b）。任一侧为空 ⇒ 原样返回另一侧
 * （见 `pick`：不猜中间色）。`t` 夹到 [0,1]——带子外的读数不该被外插成色板外的颜色。
 */
export function blendLightingSnapshot(a: LightingSnapshot, b: LightingSnapshot, t: number): LightingSnapshot {
  const k = Math.max(0, Math.min(1, t))
  // 任一侧读不出 ⇒ 整体退回有的那一侧（雾与灯一起退，不退一半）。猜一个中间色比不混合更糟——
  // 那一半的数据根本不存在，而"看起来像个过渡"正是最容易骗过自己的那种假象。
  if (a.fogRgb === null || a.lights === null) return { fogRgb: b.fogRgb, grade: b.grade, lights: b.lights }
  if (b.fogRgb === null || b.lights === null) return { fogRgb: a.fogRgb, grade: a.grade, lights: a.lights }
  return {
    fogRgb: lerpRgb(a.fogRgb, b.fogRgb, k),
    grade: {
      saturateMul: lerpNum(a.grade.saturateMul, b.grade.saturateMul, k),
      contrastMul: lerpNum(a.grade.contrastMul, b.grade.contrastMul, k),
    },
    lights: blendLightRigs(a.lights, b.lights, k),
  }
}

/**
 * 两份三层光读数按 `t` 线性混合。`LightRig` 里三个 hex 逐通道插值、三个强度与 `keyDir` 逐分量插值。
 * 强度为 0 的那一侧（深窖的 key）插过去就是"渐渐长出一盏灯"，这正是 §8 那个例外该有的样子——
 * 从深窖走向邻区时方向光不是"咔"地一下亮起来。
 */
export function blendLightRigs(a: LightRig, b: LightRig, t: number): LightRig {
  const k = Math.max(0, Math.min(1, t))
  return {
    hemiSky: lerpHex(a.hemiSky, b.hemiSky, k),
    hemiGround: lerpHex(a.hemiGround, b.hemiGround, k),
    hemiIntensity: lerpNum(a.hemiIntensity, b.hemiIntensity, k),
    keyColor: lerpHex(a.keyColor, b.keyColor, k),
    keyIntensity: lerpNum(a.keyIntensity, b.keyIntensity, k),
    keyDir: [
      lerpNum(a.keyDir[0], b.keyDir[0], k),
      lerpNum(a.keyDir[1], b.keyDir[1], k),
      lerpNum(a.keyDir[2], b.keyDir[2], k),
    ],
    pointColor: lerpHex(a.pointColor, b.pointColor, k),
    pointIntensity: lerpNum(a.pointIntensity, b.pointIntensity, k),
  }
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
