/**
 * §5.5 流送策略 + Phase 3-A 区域数据的 headless 断言。
 * 覆盖测试矩阵项：地表/垂直跨层/传送同步加载/快速往返无泄漏/无 MissingRef。
 */
import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { registry } from '@/core/Registry'
import { registerGameData, regions } from '@/data'
import type { RegionData } from '@/data/schema'
import { PRIORITY, StreamingSystem } from '@/world/Streaming'

registerGameData()

const ALL_FLAGS = [...new Set(regions.map((r) => r.unlockFlag).filter((f): f is string => !!f))]

function freshSystem(allUnlocked = true): StreamingSystem {
  const s = new StreamingSystem(regions)
  if (allUnlocked) for (const f of ALL_FLAGS) s.setFlag(f)
  return s
}

/** 从静止开始推进到队列排空（或超时），返回用掉的 tick 数 */
function settle(s: StreamingSystem, fromTick: number, pos: { x: number; y: number; z: number }, max = 4000): number {
  let t = fromTick
  while (t - fromTick < max) {
    t++
    s.update(t, pos)
    if (s.stats().queued === 0 && s.inFlight === 0) return t
  }
  return t
}

function ring(cell: { cx: number; cy: number; cz: number }, p: { cx: number; cy: number; cz: number }): number {
  return Math.max(Math.abs(cell.cx - p.cx), Math.abs(cell.cy - p.cy), Math.abs(cell.cz - p.cz))
}

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

describe('region data (IP_SEED §3/§10/§14)', () => {
  it('covers the seven slice regions with the registered vocabulary', () => {
    expect(regions.map((r) => r.id)).toEqual([
      'rg_resthold', 'rg_whisperwode', 'rg_drowned_choir', 'rg_brokenbar_camp',
      'rg_fellcarillon', 'rg_earless_deeps', 'rg_unfinished_hall',
    ])
    expect(regions.map((r) => r.displayName)).toEqual([
      '休垒 Resthold', '雾语林 Whisperwode', '沉唱堂 Drowned Choir', '破拍营地 Brokenbar Camp',
      '钟坠院 Fellcarillon', '无耳深窖 Earless Deeps', '未竟厅 The Unfinished Hall',
    ])
    expect(regions.map((r) => r.order)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('grids cleanly: one chunkSize, bounds aligned to it, every cell claimed by at most one region', () => {
    const size = 48
    for (const r of regions) {
      expect(r.chunkSize).toBe(size)
      for (const [k, v] of Object.entries(r.bounds)) {
        // y 允许半格抬升（地面高度 -8/40），水平网格必须对齐，否则 chunk 接缝错位
        if (k === 'minY' || k === 'maxY') continue
        expect(Number.isInteger(v / size), `${r.id} bounds ${k}=${v}`).toBe(true)
      }
      const bb = r.bounds
      const probe1 = new StreamingSystem([r])
      const own = probe1.regionAt({ x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2, z: (bb.minZ + bb.maxZ) / 2 })
      probe1.dispose()
      expect(own?.id, `${r.id} claims no cell`).toBe(r.id)
    }
    const probe = new StreamingSystem(regions)
    const all = regions.map((r) => r.bounds)
    const min = (k: 'minX' | 'minY' | 'minZ'): number => Math.min(...all.map((b) => b[k]))
    const max = (k: 'maxX' | 'maxY' | 'maxZ'): number => Math.max(...all.map((b) => b[k]))
    const doubles: string[] = []
    for (let x = min('minX'); x < max('maxX'); x += size) {
      for (let y = min('minY'); y < max('maxY'); y += size) {
        for (let z = min('minZ'); z < max('maxZ'); z += size) {
          const owners = regions.filter((r) => probe.regionAt({ x: x + size / 2, y: y + size / 2, z: z + size / 2 }) === r)
          if (owners.length > 1) doubles.push(`${x},${y},${z}: ${owners.map((o) => o.id)}`)
        }
      }
    }
    expect(doubles).toEqual([])
  })

  it('keeps the vertical structure 休垒→地表→崖壁→地下→深层→终局 (IP_SEED §3)', () => {
    const y = (id: string): [number, number] => {
      const b = regions.find((r) => r.id === id)!.bounds
      return [b.minY, b.maxY]
    }
    expect(y('rg_resthold')).toEqual([-8, 40])
    expect(y('rg_fellcarillon')[0]).toBeGreaterThanOrEqual(40) // 崖壁层在地表之上
    expect(y('rg_unfinished_hall')[0]).toBeGreaterThan(y('rg_fellcarillon')[0]) // 管风琴最高层
    expect(y('rg_drowned_choir')[1]).toBeLessThan(0) // 沉唱堂在雾语林地表之下
    expect(y('rg_earless_deeps')[1]).toBeLessThanOrEqual(y('rg_drowned_choir')[0]) // 深窖层低于沉唱堂（共界不重叠）
  })

  it('resolves every referenced enemy/loot/nav id (§5.5 无 MissingRef 前提)', () => {
    const missing = StreamingSystem.collectMissingRefs(regions, (id) => registry.has(id))
    expect(missing).toEqual([])
  })

  it('annotates the six required elements per playable region (需求 §65)', () => {
    for (const r of regions.filter((x) => x.biome !== 'boss_arena')) {
      expect(r.landmarks.length, `${r.id} landmark`).toBeGreaterThan(0)
      expect(r.interactables.length, `${r.id} interactable`).toBeGreaterThan(0)
      expect(r.storyHooks.length, `${r.id} story`).toBeGreaterThan(0)
    }
    expect(regions.reduce((n, r) => n + r.secrets.length, 0)).toBeGreaterThanOrEqual(3)
    const shortcuts = regions.flatMap((r) => r.interactables.filter((i) => i.oneWay))
    expect(shortcuts.length).toBeGreaterThanOrEqual(3) // 共鸣井 / 吊桥 / 音壁
    for (const s of shortcuts) expect(s.setsFlag, s.id).toBeTruthy()
  })
})

describe('chunk streaming rules (technical-architecture §5.5)', () => {
  it('activates only the 3x3x3 ring-1 neighbourhood of the hub', () => {
    const s = freshSystem()
    const at = { x: 0, y: 0, z: 0 }
    let t = 0
    t = settle(s, t, at)
    const playerCell = s.cellOf(at)
    const actives = s.byState('active')
    expect(actives.length).toBeGreaterThan(0)
    for (const c of actives) expect(ring(c, playerCell)).toBeLessThanOrEqual(1)
    // 环 2 只做 resident（预载），环 3 之外不存在记录
    for (const c of s.byState('resident')) expect(ring(c, playerCell)).toBeGreaterThan(1)
    expect(s.stats().queued).toBe(0)
  })

  it('never streams a cell beyond the unload ring (boss arena excepted)', () => {
    const s = freshSystem()
    const t = settle(s, 0, { x: 0, y: 0, z: 0 })
    const p = s.cellOf({ x: 0, y: 0, z: 0 })
    for (const c of s.all()) {
      if (regions.find((r) => r.id === c.regionId)?.preloadWhole) continue
      expect(ring(c, p), `${c.key} ring`).toBeLessThanOrEqual(3)
    }
    expect(s.inFlight).toBe(0)
    expect(t).toBeGreaterThan(0)
  })

  it('respects the in-flight budget (§5.4 in-flight ≤4) while filling the window', () => {
    const s = freshSystem()
    let maxInFlight = 0
    let t = 0
    for (; t < 1500; t++) {
      s.update(t, { x: 0, y: 0, z: 0 })
      maxInFlight = Math.max(maxInFlight, s.inFlight)
    }
    expect(maxInFlight).toBeLessThanOrEqual(4)
    expect(s.stats().queued).toBe(0)
    expect(s.activeCount).toBeGreaterThan(4) // 预算只限速，不死锁
  })

  it('demotes out-of-ring active cells without reloading them', () => {
    const s = freshSystem()
    let t = settle(s, 0, { x: 0, y: 0, z: 0 })
    const oldKey = s.cellOf({ x: 0, y: 0, z: 0 })
    // 向东走到雾语林边缘（跨多个 cell）
    const target = { x: 380, y: 0, z: 0 }
    t = settle(s, t, target)
    const newCell = s.cellOf(target)
    expect(newCell.cx).toBeGreaterThan(oldKey.cx)
    for (const c of s.byState('active')) expect(ring(c, newCell)).toBeLessThanOrEqual(1)
    // 旧区域的格要么已降级 resident，要么进入卸载防抖，要么已被回收
    for (const c of s.all()) {
      const r = ring(c, newCell)
      if (r <= 1) continue
      expect(c.state, `${c.key} at ring ${r}`).not.toBe('active')
    }
  })

  it('holds the 2s (120 tick) unload debounce before releasing a left-behind cell', () => {
    const s = freshSystem()
    const hub = { x: 0, y: 0, z: 0 }
    let t = settle(s, 0, hub)
    const left = s.chunkAt(hub)
    expect(left).not.toBeNull()
    const key = left!.key
    const far = { x: -170, y: 0, z: -360 } // 破拍营地西侧：旧 cell 落到卸载圈外
    t++
    s.update(t, far)
    let releasedAt = -1
    for (let i = 1; i <= 130; i++) {
      s.update(t + i, far)
      if (!s.all().some((c) => c.key === key)) { releasedAt = i; break }
    }
    expect(releasedAt).toBeGreaterThanOrEqual(120)
    expect(releasedAt).toBeLessThanOrEqual(122)
  })

  it('orders the load queue by ring, then streaming priority (剧情区 > boss > 地表 > 地下)', () => {
    const flat = { minY: 0, maxY: 48, minZ: 0, maxZ: 48 }
    const a = syntheticRegion({ id: 'rg_a', streamingPriority: 10, bounds: { ...flat, minX: 96, maxX: 144 } })
    const b = syntheticRegion({ id: 'rg_b', streamingPriority: 90, bounds: { ...flat, minX: -96, maxX: -48 } })
    const s = new StreamingSystem([a, b], { maxInFlight: 1, loadTicks: 1 })
    const player = { x: 24, y: 24, z: 24 }
    expect(s.cellOf(player)).toEqual({ cx: 0, cy: 0, cz: 0 })
    const starts: { key: string; priority: number }[] = []
    const off = bus.on('world.chunk', (e) => { if (e.state === 'preloading') starts.push({ key: e.key, priority: e.priority }) })
    for (let t = 0; t < 40; t++) s.update(t, player)
    off()
    expect(starts.map((c) => c.key)).toEqual(['-2,0,0', '2,0,0']) // 同圈层：高优先级先加载
    expect(starts[0].priority).toBeGreaterThan(starts[1].priority)
  })

  it('boosts a cell that carries a story interactable above a bare cell of the same region', () => {
    const r = syntheticRegion({
      streamingPriority: 20,
      interactables: [{ id: 'st_1', kind: 'checkpoint', pos: { x: 24, y: 24, z: 24 }, setsFlag: 'flag.cp' }],
    })
    const s = new StreamingSystem([r])
    s.teleport(0, { x: 24, y: 24, z: 24 })
    const self = s.chunkAt({ x: 24, y: 24, z: 24 })!
    const neighbour = s.all().find((c) => c.cx === 1 && c.cy === 0 && c.cz === 0)!
    expect(self.state).toBe('active')
    expect(neighbour.priority).toBe(20)
    expect(self.priority).toBe(20 + PRIORITY.storyInteractable)
  })

  it('streams a locked region only after its unlock flag is set', () => {
    const s = new StreamingSystem(regions)
    s.setFlag('flag.left_resthold')
    let t = settle(s, 0, { x: 300, y: 0, z: 0 })
    expect(s.byState('active').every((c) => c.regionId === 'rg_whisperwode')).toBe(true)
    expect(s.byState('unloaded').length).toBe(0)
    expect(s.all().some((c) => c.regionId === 'rg_drowned_choir')).toBe(false)
    bus.emit('world.flag', { key: 'flag.choir_entrance_open', value: true })
    t = settle(s, t, { x: 300, y: 0, z: 0 })
    const choir = s.all().filter((c) => c.regionId === 'rg_drowned_choir')
    expect(choir.length).toBeGreaterThan(0)
    expect(t).toBeGreaterThan(0)
  })

  it('旗标被摘掉 ⇒ 窗口重算，锁住的区域整体退出流送（写关与写开同是写方）', () => {
    const s = new StreamingSystem(regions)
    s.setFlag('flag.choir_entrance_open')
    const at = { x: 300, y: -40, z: 60 } // 沉唱堂层里
    let t = settle(s, 0, at)
    expect(s.all().some((c) => c.regionId === 'rg_drowned_choir'), '旗立着 ⇒ 沉唱堂在场').toBe(true)
    bus.emit('world.flag', { key: 'flag.choir_entrance_open', value: false })
    expect(s.hasFlag('flag.choir_entrance_open')).toBe(false)
    expect(s.isRegionUnlocked(regions.find((r) => r.id === 'rg_drowned_choir')!), '先锁上').toBe(false)
    // 窗口重算只发生在下一次 update（invalidate 把 playerCell 置空），卸载还隔着 120 tick 防抖
    for (let k = 0; k < 400; k++) { t++; s.update(t, at) }
    expect(s.all().some((c) => c.regionId === 'rg_drowned_choir'), '防抖走完 ⇒ 格子整体退出流送').toBe(false)
    expect(t).toBeGreaterThan(0)
    s.dispose()
  })

  it('preloads the whole boss arena field, not just the near rings (§5.5)', () => {
    const s = freshSystem()
    const hall = regions.find((r) => r.id === 'rg_unfinished_hall')!
    let t = settle(s, 0, { x: 0, y: 0, z: 0 })
    const hubCell = s.cellOf({ x: 0, y: 0, z: 0 })
    const streamed = s.all().filter((c) => c.regionId === hall.id)
    // 站在休垒就能把整场拉进来：存在超出常规卸载圈（ring>3）的场地格，但不越观察圈
    expect(streamed.length).toBeGreaterThan(0)
    expect(streamed.some((c) => ring(c, hubCell) > 3)).toBe(true)
    for (const c of streamed) {
      expect(ring(c, hubCell)).toBeLessThanOrEqual(5)
      expect(c.priority).toBeGreaterThanOrEqual(PRIORITY.bossArenaRegion)
    }
    // 走进场地：全格驻留、近格激活
    const inside = { x: 0, y: 150, z: -200 }
    t = settle(s, t, inside)
    const cell = s.cellOf(inside)
    const all = s.all().filter((c) => c.regionId === hall.id)
    expect(all.length).toBe(4 * 3 * 6) // bounds 4×3×6 cell
    expect(all.every((c) => c.state === 'active' || c.state === 'resident')).toBe(true)
    expect(s.byState('active').every((c) => ring(c, cell) <= 1)).toBe(true)
    expect(s.regionAt(inside)?.id).toBe(hall.id)
  })

  it('teleport loads ring 1 synchronously and stays bounded over 20 round trips (§5.5/需求 §50)', () => {
    const s = freshSystem()
    const hub = { x: 0, y: 0, z: 0 }
    const forest = { x: 380, y: 0, z: 100 }
    s.teleport(0, hub)
    const p = s.cellOf(hub)
    expect(s.all().filter((c) => ring(c, p) <= 1 && c.state !== 'active')).toEqual([])
    const samples: number[] = []
    let t = 0
    for (let i = 0; i < 20; i++) {
      const dest = i % 2 === 0 ? forest : hub
      t += 200
      s.teleport(t, dest)
      for (let k = 0; k < 200; k++) { t++; s.update(t, dest) }
      samples.push(s.stats().loaded)
    }
    const first = samples[0], last = samples[samples.length - 1]
    expect(last).toBeLessThanOrEqual(first * 1.25) // 无累积泄漏
    expect(s.stats().queued).toBe(0)
    expect(s.inFlight).toBe(0)
    expect(s.all().length).toBeLessThan(400)
  })

  it('streams underground layers by vertical distance, not horizontal only', () => {
    const s = new StreamingSystem(regions)
    s.setFlag('flag.left_resthold') // 只开到雾语林：沉唱堂仍锁
    let t = settle(s, 0, { x: 300, y: 0, z: 0 })
    expect(s.all().some((c) => c.regionId === 'rg_drowned_choir')).toBe(false)
    s.setFlag('flag.choir_entrance_open')
    // 下降到沉唱堂层（y=-40，正下方）
    t = settle(s, t, { x: 300, y: -40, z: 60 })
    const cell = s.cellOf({ x: 300, y: -40, z: 60 })
    expect(s.activeCount).toBeGreaterThan(0)
    for (const c of s.byState('active')) expect(ring(c, cell)).toBeLessThanOrEqual(1)
    expect(s.byState('active').some((c) => c.regionId === 'rg_drowned_choir')).toBe(true)
    expect(s.regionAt({ x: 300, y: -40, z: 60 })?.id).toBe('rg_drowned_choir')
  })

  it('reports explored cells for the map mask (需求 §43)', () => {
    const s = freshSystem()
    let t = settle(s, 0, { x: 0, y: 0, z: 0 })
    expect(s.isExplored({ x: 0, y: 0, z: 0 })).toBe(true)
    expect(s.isExplored({ x: -400, y: 0, z: -400 })).toBe(false)
    t = settle(s, t, { x: 380, y: 0, z: 100 })
    s.update(t + 400, { x: 0, y: 0, z: 0 })
    expect(s.isExplored({ x: 380, y: 0, z: 100 })).toBe(true)
  })
})
