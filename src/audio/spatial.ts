/**
 * spatial.ts — 「声源 → 听者」那一步的**唯一主人**（KI-083）。
 *
 * 这段数学原本只长在 `AudioEngine.onSfx()` 里，KI-083 给 docs/audio.md §4 的 L2／L3
 * （真位置声景层）接上第二个读者 ⇒ 再抄一份就是第二个主人，所以抽出来。
 * 常数与算式**一字不改**地搬过来（`16` / `1.8` / `2` / `0.85` / `0.02` 就是它们原来的值），
 * 于是"两条读者读同一个位置得到同一个声像"这件事是被构造出来的，不是被祈祷出来的。
 */

/** 听者位姿。世界坐标 + 朝向 yaw（弧度，0 = 面向 -Z），与 `CameraRig.yaw` 同一口径 */
export interface ListenerPose {
  x: number
  y: number
  z: number
  yaw: number
}

export interface Spatialized {
  /** 斜距（米）：含高度差——声源在头顶与在脚下，衰减不一样 */
  dist: number
  /** 距离衰减（0–1）：直接乘在声源那一只增益上 */
  att: number
  /** 声像（-1 左 / +1 右）：交给 `StereoPannerNode.pan` */
  pan: number
}

/** 衰减半程（米）：走到这么远，增益掉到 1/(1+1^1.8) = 0.5 */
export const ATT_HALF_M = 16
/** 衰减指数：1.8 ⇒ 近处几乎不掉、远处迅速退场（比 1/r 更"贴着耳朵"） */
export const ATT_EXP = 1.8
/** 听不见的门槛：低于它一个节点都不建（省下的是声部配额与一条噪声链，见 §9） */
export const AUDIBLE_FLOOR = 0.02
/**
 * 声像分母的地板（米）：贴脸时拿 `side / dist` 当 pan 会一格跳到 ±1，那个跳变听起来像
 * "声音从耳朵里穿过去"——所以近距离按 2m 算，让 pan 在贴身那一段缓慢地推到位。
 */
export const PAN_MIN_DIST = 2
/** 声像上限：留一点对侧串音，比"硬贴一只耳朵"更像有房间 */
export const PAN_MAX = 0.85

/**
 * 一次算齐三样：斜距、衰减、声像。
 *
 * 声像用的是**水平投影**（`x/z` 转到听者朝向系里），所以它是"左/右"而不是双耳 HRTF——
 * §4 原文写的是 `PannerNode + HRTF`，本作走的是这条 `StereoPanner` 路线（KI-083 之前全部
 * SFX 都在这条路上）。差异记在 technical-architecture.md §5.9.19：位置是真的，头部传递函数没有。
 */
export function spatialize(pos: { x: number; y: number; z: number }, l: ListenerPose): Spatialized {
  const rx = pos.x - l.x
  const ry = pos.y - l.y
  const rz = pos.z - l.z
  const dist = Math.sqrt(rx * rx + ry * ry + rz * rz)
  const att = Math.min(1, 1 / (1 + Math.pow(dist / ATT_HALF_M, ATT_EXP)))
  const side = rx * Math.cos(l.yaw) - rz * Math.sin(l.yaw)
  const pan = Math.max(-1, Math.min(1, side / Math.max(PAN_MIN_DIST, dist))) * PAN_MAX
  return { dist, att, pan }
}
