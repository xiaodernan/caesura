/**
 * 流送的「幂等传送」守卫 —— `StreamingSystem.setState` 的同态早退（src/world/Streaming.ts:376）。
 *
 * 为什么单开一条：`streaming-lifecycle.test.ts` 守的是**静止世界的 update() 不发事件**
 * （那条路径里 setState 压根没被调用）；而 `teleport()` 是**显式**逐格调用 `setState('active')` 的。
 * 站在同一个格子里连按两次传送（读档/回营地/重开演出都可能这么调），第二次传送到的是
 * 「已经是 active」的同一批格子 —— 若没有同态早退，每一次都会重发一遍 `world.chunk`，
 * 表现层按事件挂载/卸载子场景，于是原地传送 = 一轮无谓的全场重建（事件风暴）。
 *
 * 同态早退是**可达**的：`rebuildWindow` 只重算窗口、`reconcileStates` 只降级圈外的 active，
 * 圈内的 active 保持 active；随后 teleport 的循环对这批格子再次 `setState(chunk, 'active')`
 * ⇒ `c.state === state` 成立 ⇒ 早退。这条分支此前没有任何用例走到（覆盖率里 arm 计数为 0）。
 */
import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import type { RegionData } from '@/data/schema'
import { StreamingSystem } from '@/world/Streaming'

/** 单区、4×4×4 格（chunkSize=48，bounds 0..192），无解锁旗标 —— 只量流送本身 */
function syntheticRegion(): RegionData {
  return {
    id: 'rg_probe',
    nameKey: 'region.probe',
    displayName: 'Probe',
    order: 0,
    biome: 'forest',
    bounds: { minX: 0, maxX: 192, minY: 0, maxY: 192, minZ: 0, maxZ: 192 },
    chunkSize: 48,
    weatherPresets: ['clear'],
    lightingPreset: 'lp_probe',
    palette: { base: '#fff', accent: '#fff', glow: '#fff' },
    spawnGroups: [],
    landmarks: [],
    interactables: [],
    music: { explore: 'e', battle: 'b', ambience: 'a' },
    streamingPriority: 10,
    secrets: [],
    storyHooks: [],
  } as unknown as RegionData
}

/** cell (0,0,0) 的激活圈（activateRing=1）在 4×4×4 区域内的 8 格 */
const A_CELL_ACTIVE = [
  '0,0,0', '0,0,1', '0,1,0', '0,1,1',
  '1,0,0', '1,0,1', '1,1,0', '1,1,1',
]

describe('StreamingSystem.teleport 幂等性（同态 setState 早退）', () => {
  it('同一格连传两次：第二次不再发任何 world.chunk，active 集合逐字不变', () => {
    const s = new StreamingSystem([syntheticRegion()])
    const at = { x: 24, y: 24, z: 24 } // cell (0,0,0)

    // 第一次传送：ring ≤ activateRing(1) 的格子同步置 active
    s.teleport(0, at)
    const activeAfterFirst = s.byState('active').map((c) => c.key).sort()
    expect(activeAfterFirst).toEqual(A_CELL_ACTIVE)
    const chunkCount = s.all().length

    // 第二次传送（同一坐标、下一 tick）：全部命中同态早退 ⇒ 零事件
    const events: string[] = []
    const off = bus.on('world.chunk', (e) => { events.push(`${e.key}:${e.state}`) })
    s.teleport(1, at)
    off()

    expect(events).toEqual([])
    expect(s.byState('active').map((c) => c.key).sort()).toEqual(activeAfterFirst)
    // 传送不开新格：窗口（ring ≤ unloadRing=3）在第一趟就已 ensure 完，第二趟只复用
    expect(s.all().length).toBe(chunkCount)
    s.dispose()
  })

  it('换格再传回：圈内格子经历 resident→active 的真转换（同态早退不能吞掉真转换）', () => {
    const s = new StreamingSystem([syntheticRegion()])
    const a = { x: 24, y: 24, z: 24 } // cell (0,0,0)
    const b = { x: 168, y: 24, z: 24 } // cell (3,0,0)，与 a 相距 3 格 > activateRing

    s.teleport(0, a)
    s.teleport(1, b)
    // 对照面前置：a 处那批此刻已被 reconcileStates 降级（不在 b 的激活圈内）
    expect(s.chunkAt(a)?.state).toBe('resident')

    const events: { key: string; state: string }[] = []
    const off = bus.on('world.chunk', (e) => { events.push({ key: e.key, state: e.state }) })
    s.teleport(2, a)
    off()

    // a 处 8 格各发生**恰好一次** resident→active（多一次就说明早退失效、事件被重发）
    const promoted = events
      .filter((e) => A_CELL_ACTIVE.includes(e.key) && e.state === 'active')
      .map((e) => e.key)
      .sort()
    expect(promoted).toEqual(A_CELL_ACTIVE)
    expect(s.chunkAt(a)?.state).toBe('active')
    s.dispose()
  })
})
