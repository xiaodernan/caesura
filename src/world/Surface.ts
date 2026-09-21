/**
 * 地表/落点查询（technical-architecture §3 world/Surface，需求 §65 垂直结构）。
 * 息声领是叠层世界（地表 / 崖壁 / 地下 / 深层共用 xz），所以「脚下是哪一层」
 * 不能用 regionAt(pos) —— 边界处一个点会同时落在两个区域的 bounds 里。
 * 规则：取「水平覆盖该点」且「地面不高于脚底」中最高的那块地板。
 */
import type { RegionData, Vec3 } from '@/data/schema'

export interface FloorSample {
  y: number
  regionId: string
}

export class Surface {
  /** tolerance：允许斜坡/台阶的浮点误差（米） */
  constructor(private readonly regions: readonly RegionData[], private readonly tolerance = 0.5) {}

  floorAt(pos: Vec3): FloorSample | null {
    let best: FloorSample | null = null
    for (const r of this.regions) {
      const b = r.bounds
      if (pos.x < b.minX || pos.x >= b.maxX || pos.z < b.minZ || pos.z >= b.maxZ) continue
      if (r.groundY > pos.y + this.tolerance) continue
      if (best === null || r.groundY > best.y) best = { y: r.groundY, regionId: r.id }
    }
    return best
  }
}
