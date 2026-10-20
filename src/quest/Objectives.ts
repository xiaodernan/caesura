import type { RegionData } from '@/data/schema'

/**
 * **目标指示**的解析（KI-137）。
 *
 * **问题**：玩家醒来后知道"要干什么"却不知道"往哪走"——任务行写着「去钟坠院取回首钟的断舌」，
 * 而灰盒世界里没有路标、没有地图指引、连方向都不给。实测反馈是「完全不知道要干什么」。
 * 任务行（KI-181②）解决了前半句；这一件解决后半句：**当前目标在世界里的哪一个点**。
 *
 * **指示只由数据说**：`quests.json` 的每一步可以带一个 `marker`（指向某个 npc／交互物／区域／坐标），
 * 这里只负责把那个 marker 解析成世界坐标。**解析规则一处**：
 *   · `npc`     ⇒ 那个 NPC 在**哪一区的哪个交互位**上（`regions.json > interactables[].npcId`）
 *   · `interact`⇒ 那个交互物自己的位置
 *   · `region`  ⇒ 那个区域的 `bounds` 中心（跨区目标只能指到"那一区大概在哪儿"）
 *   · `pos`     ⇒ 就地坐标
 *
 * **为什么不在 HUD 里算**：HUD 是表现层，而"任务表的 marker 指向世界的哪一点"是**世界的事实**；
 * 放在表现层就得让表现层认识 regions.json 的结构（依赖方向错了）。这里住在 `quest/` 层，
 * 读数据层的表，组合根把结果喂给 HUD。
 */

/** 一个指示点（世界坐标） */
export interface ObjectivePoint {
  x: number
  y: number
  z: number
}

/**
 * 解析一个 marker ⇒ 世界坐标。**认不出就返回 null**（HUD 那时就不画指示），
 * 不猜、不静默落到 (0,0,0)——后者会让指示指向世界的原点，那比不画更坏。
 *
 * **参数是"松"的形状**（`kind` + 可选 `id`/`pos`），因为总线上的载荷就是那个形状
 * （`core/EventBus.ts` **刻意不 import data/schema**：core 层不认识数据表）。
 * 缺该有的那一格就当"认不出"⇒ null；严格的联合类型住在 `data/schema.ts` 的 `QuestMarker`。
 */
export function resolveMarker(
  marker: { kind: string; id?: string; pos?: { x: number; y: number; z: number } } | undefined,
  regions: readonly RegionData[],
): ObjectivePoint | null {
  if (!marker) return null
  switch (marker.kind) {
    case 'pos':
      if (!marker.pos) return null
      return { x: marker.pos.x, y: marker.pos.y, z: marker.pos.z }
    case 'npc': {
      if (!marker.id) return null
      for (const rg of regions) {
        for (const it of rg.interactables ?? []) {
          if (it.npcId === marker.id && it.pos) return { x: it.pos.x, y: it.pos.y, z: it.pos.z }
        }
      }
      return null
    }
    case 'interact': {
      if (!marker.id) return null
      for (const rg of regions) {
        for (const it of rg.interactables ?? []) {
          if (it.id === marker.id && it.pos) return { x: it.pos.x, y: it.pos.y, z: it.pos.z }
        }
      }
      return null
    }
    case 'region': {
      if (!marker.id) return null
      const rg = regions.find((r) => r.id === marker.id)
      const b = rg?.bounds
      if (!b) return null
      return {
        x: (b.minX + b.maxX) / 2,
        y: (b.minY + b.maxY) / 2,
        z: (b.minZ + b.maxZ) / 2,
      }
    }
    default:
      return null
  }
}

/**
 * 全部 marker 的**落点是否都在世界里**（数据门的判据要能喂合成夹具，所以它住在脚本里；
 * 这一份是给运行时与测试共用的同一形状的读法）。
 *
 * @param markers 全部 marker
 * @param regions 区域表
 * @returns 解析不出来的那些 marker（空 = 全部有落点）
 */
export function unresolvedMarkers(
  markers: readonly ({ kind: string; id?: string; pos?: { x: number; y: number; z: number } } | undefined)[],
  regions: readonly RegionData[],
): { kind: string; id?: string; pos?: { x: number; y: number; z: number } }[] {
  const out: { kind: string; id?: string; pos?: { x: number; y: number; z: number } }[] = []
  for (const m of markers) {
    if (!m) continue
    if (resolveMarker(m, regions) === null) out.push(m)
  }
  return out
}
