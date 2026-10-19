/**
 * StreamingSystem 生命周期专属契约锁（technical-architecture §5.5）。
 *
 * 现有 `streaming.test.ts` 已覆盖：region 数据 / ring-1 激活 / in-flight 预算 /
 * 卸载防抖 / 优先级排序 / boss arena 整场预载 / 传送同步 / 过渡带数学。本文件只锁它
 * **未**单独覆盖的状态机·查询·存档侧契约，避免冗余：
 *  - 静止世界每 tick 不发出任何 world.chunk 事件（setState no-op 守卫，防事件风暴）
 *  - visited 格卸载后进入 explored 集合（地图遮罩持久化，需求 §43）
 *  - chunkAt 只读、不造格
 *  - isRegionUnlocked 默认真 / 受 unlockFlag 门控
 *  - flagKeys 排序快照（存档只用这些推导解锁）
 *  - collectMissingRefs 缺失项精确字符串
 *  - stats() 聚合恒等式
 */
import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { registerGameData, regions } from '@/data'
import type { RegionData } from '@/data/schema'
import { StreamingSystem } from '@/world/Streaming'

registerGameData()

let sys: StreamingSystem | null = null
afterEach(() => { sys?.dispose(); sys = null })

function syntheticRegion(over: Partial<RegionData>): RegionData {
  return {
    id: 'rg_x', nameKey: 'region.x', displayName: 'X', order: 0, biome: 'forest',
    bounds: { minX: 0, maxX: 192, minY: 0, maxY: 48, minZ: 0, maxZ: 192 },
    chunkSize: 48, weatherPresets: ['clear'], lightingPreset: 'lp_x',
    palette: { base: '#fff', accent: '#fff', glow: '#fff' },
    spawnGroups: [], landmarks: [], interactables: [],
    music: { explore: 'e', battle: 'b', ambience: 'a' },
    streamingPriority: 10, secrets: [], storyHooks: [],
    ...over,
  } as RegionData
}

/** 把所有已定义的解锁旗标立起来（与 streaming.test.ts 的 freshSystem 口径一致） */
function unlockAll(s: StreamingSystem): void {
  for (const f of [...new Set(regions.map((r) => r.unlockFlag).filter((x): x is string => !!x))]) s.setFlag(f)
}

/** 推进到队列排空（或超时），返回用掉的 tick 数 */
function settle(s: StreamingSystem, fromTick: number, pos: { x: number; y: number; z: number }, max = 4000): number {
  let t = fromTick
  while (t - fromTick < max) {
    t++
    s.update(t, pos)
    const st = s.stats()
    if (st.queued === 0 && st.preloading === 0 && s.inFlight === 0) return t
  }
  return t
}

describe('setState no-op 守卫：静止世界不发出任何 chunk 事件', () => {
  it('已 settle 的静止世界，后续 60 tick 的 update 不产生任何 world.chunk 事件', () => {
    sys = new StreamingSystem(regions)
    unlockAll(sys)
    const t0 = settle(sys, 0, { x: 0, y: 0, z: 0 })
    const events: unknown[] = []
    const off = bus.on('world.chunk', (e) => events.push(e))
    let t = t0
    for (let i = 0; i < 60; i++) { t++; sys.update(t, { x: 0, y: 0, z: 0 }) }
    off()
    expect(events.length, 'setState 在状态无变化时不应重复 emit').toBe(0)
  })
})

describe('地图遮罩持久化（需求 §43）：visited 格卸载进 explored', () => {
  it('原点格被传送推到窗口外并回收后，isExplored 仍为真', () => {
    sys = new StreamingSystem(regions)
    unlockAll(sys)
    let t = settle(sys, 0, { x: 0, y: 0, z: 0 })
    const hub = { x: 0, y: 0, z: 0 }
    expect(sys.chunkAt(hub)).not.toBeNull()

    // 传送到雾语林深处，把原点推出窗口
    const far = { x: 380, y: 0, z: 100 }
    sys.teleport(t, far)
    t = settle(sys, t, far, 2000)

    // 等到原点格被卸载回收
    let guard = 0
    while (sys.chunkAt(hub) !== null && guard < 2000) { t++; sys.update(t, far); guard++ }
    expect(sys.chunkAt(hub), '原点格应被回收').toBeNull()
    // 但地图遮罩仍记得（visited 累加到 explored 集合）
    expect(sys.isExplored(hub), '回收后地图遮罩应仍可读到原点').toBe(true)
  })

  it('从未踏足的远处坐标 isExplored 为假', () => {
    sys = new StreamingSystem(regions)
    unlockAll(sys)
    settle(sys, 0, { x: 0, y: 0, z: 0 })
    expect(sys.isExplored({ x: -400, y: 0, z: -400 })).toBe(false)
  })
})

describe('chunkAt 只读查询契约', () => {
  it('未知 cell 返回 null 且不创建新 chunk（查询不改变 all() 长度）', () => {
    sys = new StreamingSystem(regions)
    unlockAll(sys)
    settle(sys, 0, { x: 0, y: 0, z: 0 })
    const before = sys.all().length
    const got = sys.chunkAt({ x: 999999, y: 0, z: 0 })
    expect(got).toBeNull()
    expect(sys.all().length, 'chunkAt 不应造格').toBe(before)
  })
})

describe('isRegionUnlocked 解锁门控', () => {
  it('无 unlockFlag 默认真；有 flag 时随旗标门控', () => {
    const open = syntheticRegion({ id: 'rg_open' })
    const locked = syntheticRegion({ id: 'rg_locked', unlockFlag: 'flag.gate' })
    sys = new StreamingSystem([open, locked])
    expect(sys.isRegionUnlocked(open)).toBe(true)
    expect(sys.isRegionUnlocked(locked)).toBe(false)
    sys.setFlag('flag.gate')
    expect(sys.isRegionUnlocked(locked)).toBe(true)
  })
})

describe('flagKeys 排序快照（存档用）', () => {
  it('返回按字典序排序的旗标名数组', () => {
    sys = new StreamingSystem([syntheticRegion({ id: 'rg_x' })])
    sys.setFlag('flag.zebra')
    sys.setFlag('flag.alpha')
    sys.setFlag('flag.mike')
    expect(sys.flagKeys()).toEqual(['flag.alpha', 'flag.mike', 'flag.zebra'])
  })
})

describe('collectMissingRefs 数据门数据侧前提', () => {
  it('精确报告未注册的 enemyId / rewardTable / navmeshRef 及其来源路径', () => {
    const r = {
      id: 'rg_missing',
      spawnGroups: [{ enemyId: 'enemy.ghost' }],
      secrets: [{ rewardTable: 'loot.ghost' }],
      navmeshRef: 'nav.ghost',
    } as unknown as RegionData
    const missing = StreamingSystem.collectMissingRefs([r], () => false)
    expect(missing).toContain('rg_missing.spawnGroups -> enemy.ghost')
    expect(missing).toContain('rg_missing.secrets -> loot.ghost')
    expect(missing).toContain('rg_missing.navmeshRef -> nav.ghost')
  })

  it('全部注册时返回空数组（与 streaming.test.ts 的 happy path 一致）', () => {
    const missing = StreamingSystem.collectMissingRefs(regions, () => true)
    expect(missing).toEqual([])
  })
})

describe('stats() 聚合恒等式', () => {
  it('loaded = preloading+resident+active；inFlight = preloading；静止后无在飞/无预载/无排队', () => {
    sys = new StreamingSystem(regions)
    unlockAll(sys)
    settle(sys, 0, { x: 0, y: 0, z: 0 })
    const st = sys.stats()
    expect(st.loaded).toBe(st.preloading + st.resident + st.active)
    expect(st.inFlight).toBe(st.preloading)
    expect(st.preloading).toBe(0)
    expect(st.inFlight).toBe(0)
    expect(st.queued).toBe(0)
  })
})
