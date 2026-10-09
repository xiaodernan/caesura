/**
 * 落地的引针枪（docs/combat.md §4.3「按处决键拾回」的前提，KI-006 剩余缺口①）——
 * 纯逻辑层，不 import three。
 *
 * 为什么需要一张名册而不是"弹体活着就不用捡"：`ProjectileSystem` 的回收口径是**这发攻击结束了**
 * （`kill` → `reap`），而"枪还躺在地上"说的是一件仍然在场的物件。把这两件事塞进同一个容器，
 * 就等于让"还能不能造成伤害"和"还能不能捡起来"共用一个开关——一记把伤害吃完的枪（`hit`）
 * 会从场上消失，于是文档里那句拾回永远按不出来。所以这里只记一件事：**躺着的枪在哪、朝哪**。
 *
 * 谁写：`CombatManager` 在弹体回收的那一刻（任何离场原因）种下一杆；玩家拾回或"枪回家了"
 * （死亡/跨区/重开）时清掉。谁读：`tryExecute` 的拾回分支 + 组合根注入给 `ProjectileVisuals` 的名单。
 */
import type { Vec3 } from './EntityStats'

export interface GroundedSpear {
  id: number
  /** 静止位置：y 已经被写方贴到地面高度，所以表现层照抄即可 */
  pos: Vec3
  /** 水平朝向（躺着的姿态）。弹体的速度向量在这里只保留 x/z —— 一根斜插在半空的枪不是"落地" */
  dir: Vec3
  plantedTick: number
}

export class GroundedSpearField {
  private items: GroundedSpear[] = []
  private seq = 0

  get live(): number { return this.items.length }

  list(): readonly GroundedSpear[] { return this.items }

  plant(pos: Vec3, dir: Vec3, tick: number): GroundedSpear {
    const dl = Math.hypot(dir.x, dir.z) || 1
    const s: GroundedSpear = {
      id: ++this.seq,
      pos: { x: pos.x, y: pos.y, z: pos.z },
      dir: { x: dir.x / dl, y: 0, z: dir.z / dl },
      plantedTick: tick
    }
    this.items.push(s)
    return s
  }

  /**
   * 够得着的那一杆。距离量的是**水平**米数（与处决/背刺的 `crumpleRange`、`backstabRange` 同一口径：
   * 玩家的"伸不伸手"从来不由高度差决定），半径由调用方给它那把尺子——这里不认识"处决键"，
   * 只回答"这个半径内有没有、哪一个最近"。
   */
  nearestWithin(pos: Vec3, radius: number): GroundedSpear | null {
    let best: GroundedSpear | null = null
    let bestD = Infinity
    for (const s of this.items) {
      const d = Math.hypot(s.pos.x - pos.x, s.pos.z - pos.z)
      if (d > radius || d >= bestD) continue
      bestD = d
      best = s
    }
    return best
  }

  remove(id: number): boolean {
    const i = this.items.findIndex((s) => s.id === id)
    if (i < 0) return false
    this.items.splice(i, 1)
    return true
  }

  clear(): void { this.items.length = 0 }
}
