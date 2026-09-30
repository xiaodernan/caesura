/**
 * §5.4 处决演出的灰盒姿态数学（KI-002 的演出腿；纯函数，无 three——
 * 头less 测试直接量它，ActorVisuals 只负责把它画出来）。
 *
 * 设计口径：处决蒙太奇是**受刑者坍塌**的过程，不是攻击者的第二套连招——
 * 攻击者那边只有一记「高举-落下」的劈砍（同一条函数的 chop 半边）。
 * 进度 0..1 与 `player.executing { tick, total }` 的 tick/total 同源，
 * 代码里不写第二份时长（§55：一记演出只有一个时钟）。
 */
export interface ExecutionPose {
  /** 受刑者前倾角（弧度）：0 = 站立，1.35 = 跪倒在地 */
  tilt: number
  /** 受刑者下沉量（米，未乘体型）：0 → 0.35 */
  sink: number
  /** 攻击者武器劈砍角：0.6（高举）→ -1.1（落到底）→ 保持 */
  chop: number
}

/** ease-in（二次）：起步慢、倒得越来越快——重量感来自加速度而不是匀速 */
const easeIn = (t: number): number => t * t

export function executionPose(progress01: number): ExecutionPose {
  const p = Math.max(0, Math.min(1, progress01))
  // 受刑者：前 15% 站着挨第一刀（与 firstBladeHitStop 对齐的那一段），
  // 之后 85% 完成整段坍塌。tilt 与 sink 共用同一条 ease ⇒ 两者的"重量"是同一份。
  const fall = Math.max(0, (p - 0.15) / 0.85)
  const tilt = 1.35 * easeIn(fall)
  const sink = 0.35 * easeIn(fall)
  // 劈砍：0~0.25 高举过头（0.6），0.25~0.45 一刀落到底（-1.1），之后保持（刀留在身体里，不复位）
  const chop = p < 0.25
    ? 0.6
    : p < 0.45
      ? 0.6 - ((p - 0.25) / 0.2) * 1.7
      : -1.1
  return { tilt, sink, chop }
}
