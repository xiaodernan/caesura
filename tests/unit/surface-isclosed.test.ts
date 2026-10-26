/**
 * Surface.floorAt 的 isClosed 闸门守卫（src/world/Surface.ts）。
 *
 * 覆盖实测（v8，surface.test.ts）报 Surface.ts 92.85% branch，唯一未取分支是 `floorAt` 里这一格
 * （源码 25）：
 *
 *     if (this.isClosed(r)) continue // 未开放区域：几何上也没有可站的面（灰盒期表现为深渊/断桥）
 *
 * surface.test.ts 全程用**默认** `isClosed = () => false`（`new Surface(regions)`），所以"关闭区域被跳过"
 * 这条腿从没被机器验过。而它是**真生产契约**：`main.ts:366` 用
 * `new Surface(regions, 0.5, (r) => !streaming.isRegionUnlocked(r))` 接真闸门——没解锁的区域
 * 在几何上就不该有可站的面（否则玩家会踩到一块根本走不到的地板，或掉进本该是深渊的地方）。
 *
 * 用真数据里的叠层点 `overlap`（钟坠院 groundY 64 与雾语林 groundY 0 共用 xz）锁三件事：
 *   1. 对照：默认无闸门 ⇒ 取最高地板（钟坠院 y=64）；
 *   2. 关闭钟坠院 ⇒ 跳过它，落到下面那层开着的雾语林（y=0）——闸门只摘一层，不误伤下层；
 *   3. 全部关闭 ⇒ 没有任何可站的面，返回 null（灰盒期表现为深渊/断桥）。
 */
import { describe, expect, it } from 'vitest'
import { registerGameData, regions } from '@/data'
import { Surface } from '@/world/Surface'

registerGameData()

/** 钟坠院(64) 与雾语林(0) 的 xz 交叠点（同 surface.test.ts 的 fixture） */
const overlap = { x: 200, y: 80, z: -150 }

describe('Surface.floorAt 的 isClosed 闸门：未开放区域没有可站的面', () => {
  it('对照：默认无闸门 ⇒ 取最高地板（钟坠院 y=64）', () => {
    expect(new Surface(regions).floorAt(overlap)).toEqual({ y: 64, regionId: 'rg_fellcarillon' })
  })

  it('关闭钟坠院 ⇒ 跳过它，落到下面那层开着的雾语林（y=0）', () => {
    const s = new Surface(regions, 0.5, (r) => r.id === 'rg_fellcarillon')
    expect(s.floorAt(overlap)).toEqual({ y: 0, regionId: 'rg_whisperwode' })
  })

  it('全部关闭 ⇒ 没有任何可站的面，返回 null（灰盒期表现为深渊/断桥）', () => {
    const s = new Surface(regions, 0.5, () => true)
    expect(s.floorAt(overlap)).toBeNull()
  })
})
