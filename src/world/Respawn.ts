/**
 * **重生点**（gameplay.md「重生点｜最近的调音桩（视觉：桩亮=可复活）」那一行）。
 *
 * **病**：这一行今天没有载体——玩家死在无耳深窖，四秒后被送回**世界原点 (0,0,0)**，
 * 也就是休垒的出厂位置，而不是他刚共鸣过的那根调音桩。于是"死亡点通常离调音桩 <60s"
 * （同一行第三栏的设计意图）在运行时是假的：回程是**整个世界**，不是那 60 秒。
 *
 * **规则（只有一条主人）**：重生点 = **最近的、亮着的**调音桩。
 * · "亮" = 玩家共鸣过它（`regions.json > interactables[].setsFlag` 那一面旗立着）——
 *   与"视觉：桩亮=可复活"同一件事：**没亮过的桩不是重生点**。
 * · "最近" = 三维距离（叠层世界里 y 也算：楼上那根桩与楼下那根不是一回事）。
 * · **一根都没亮 ⇒ 落回世界原点**（今天的行为）：设计没裁这一格，§55 不许我编一个
 *   "默认桩"，所以保留原行为并把这一格如实记在账上（**兜底不是裁决，是没裁决**）。
 *
 * 住在 `world/` 而不是 `player/`：它是**世界数据**（哪几根桩、亮没亮），
 * 组合根把它算成一个"重生目标"注进玩家（`PlayerController.respawnTarget`），
 * 玩家只负责把人搬到那儿 —— **判据与搬运分住两处**。
 */
import type { Vec3 } from '@/data/schema'

/** 一根调音桩：位置 + 点亮它的那面旗 */
export interface RespawnPost {
  id: string
  pos: Vec3
  /**
   * 点亮这根桩的那面旗（`regions.json > interactables[].setsFlag`）。
   * `null` = 永远亮着 —— **今天没有这样的桩**（七根桩各带一面 `flag.checkpoint_*`），
   * 但那一格留在这儿：**判据不许假设"每根桩都有旗"**，哪天数据给了常亮的桩，规则不用改。
   */
  litFlag: string | null
}

/** 一根都没亮时的兜底：世界原点（设计没裁那一格，保留今天的行为） */
export const RESPAWN_FALLBACK: Vec3 = { x: 0, y: 0, z: 0 }

/**
 * 最近的、亮着的调音桩；一根都没亮 ⇒ `null`。
 *
 * `isLit` 是**注入的读法**（组合根喂 `interact.hasFlag`）：本模块不认识旗标表，
 * 也不认识交互系统 —— 它只回答"这一堆桩里，哪一根是亮着且离这里最近的"。
 */
export function nearestLitPost(
  posts: readonly RespawnPost[],
  from: Vec3,
  isLit: (flag: string) => boolean,
): RespawnPost | null {
  let best: RespawnPost | null = null
  let bestD = Infinity
  for (const p of posts) {
    if (p.litFlag !== null && !isLit(p.litFlag)) continue
    const dx = p.pos.x - from.x
    const dy = p.pos.y - from.y
    const dz = p.pos.z - from.z
    const d = dx * dx + dy * dy + dz * dz
    // 严格小于 ⇒ **同距时先来先到**（名册顺序 = 数据顺序）：平局不许由迭代顺序决定
    if (d < bestD) { bestD = d; best = p }
  }
  return best
}

/**
 * 重生点：最近的亮桩；一根都没亮 ⇒ `RESPAWN_FALLBACK`。
 * 返回**是哪一根**（`post`）——日志与测试都要能回答"他是从哪根桩回来的"。
 */
export function respawnTarget(
  posts: readonly RespawnPost[],
  from: Vec3,
  isLit: (flag: string) => boolean,
): { post: RespawnPost | null; pos: Vec3 } {
  const post = nearestLitPost(posts, from, isLit)
  return post
    ? { post, pos: { x: post.pos.x, y: post.pos.y, z: post.pos.z } }
    : { post: null, pos: { ...RESPAWN_FALLBACK } }
}
