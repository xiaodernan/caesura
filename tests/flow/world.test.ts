/**
 * 穿行流（§5.5 测试矩阵 · §59 自动化玩法流）：
 * 休垒 → 雾语林（地表大区域入口）→ 沉唱堂（地下垂直跨层）→ 传送回休垒。
 * 断言「流送后 1s 内无 MissingRef 警告」与全程预算不破。
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { StreamingSystem } from '@/world/Streaming'
import { Surface } from '@/world/Surface'
import { ChunkGreybox } from '@/world/ChunkGreybox'

registerGameData()

const HUB = { x: 0, y: 0, z: 0 }
const FOREST = { x: 320, y: 0, z: 40 }
const CHOIR = { x: 300, y: -40, z: 60 }

/** 沿直线以 2m/帧 走完一段路（≈60m/s 高速移动作弊，测试矩阵第 1 项） */
function run(s: StreamingSystem, from: typeof HUB, to: typeof HUB, tick: number): number {
  const steps = 40
  let t = tick
  for (let i = 1; i <= steps; i++) {
    const f = i / steps
    t++
    s.update(t, {
      x: from.x + (to.x - from.x) * f,
      y: from.y + (to.y - from.y) * f,
      z: from.z + (to.z - from.z) * f,
    })
  }
  return t
}

function drain(s: StreamingSystem, pos: typeof HUB, tick: number, ticks = 600): number {
  let t = tick
  for (let i = 0; i < ticks; i++) { t++; s.update(t, pos) }
  return t
}

describe('world traversal flow (Phase 3-A)', () => {
  it('streams hub → forest → underground without missing refs or budget breaches', () => {
    const warnings: string[] = []
    let maxInFlight = 0
    let maxActive = 0
    const off1 = bus.on('log', (l) => { if (l.level === 'warn') warnings.push(l.msg) })
    const s = new StreamingSystem(regions)
    const off2 = bus.on('world.chunk', () => {
      maxInFlight = Math.max(maxInFlight, s.inFlight)
      maxActive = Math.max(maxActive, s.activeCount)
    })
    s.teleport(0, HUB)
    let t = drain(s, HUB, 0)
    expect(s.regionAt(HUB)?.id).toBe('rg_resthold')
    expect(StreamingSystem.collectMissingRefs(regions, (id) => registry.has(id))).toEqual([])

    bus.emit('world.flag', { key: 'flag.left_resthold', value: true })
    t = run(s, HUB, FOREST, t)
    t = drain(s, FOREST, t)
    expect(s.regionAt(FOREST)?.id).toBe('rg_whisperwode')
    expect(s.activeCount).toBeGreaterThan(0)

    bus.emit('world.flag', { key: 'flag.choir_entrance_open', value: true })
    t = run(s, FOREST, CHOIR, t)
    t = drain(s, CHOIR, t)
    expect(s.regionAt(CHOIR)?.id).toBe('rg_drowned_choir')
    expect(s.byState('active').some((c) => c.regionId === 'rg_drowned_choir')).toBe(true)

    s.teleport(t + 1, HUB)
    t = drain(s, HUB, t + 1)
    expect(s.regionAt(HUB)?.id).toBe('rg_resthold')
    expect(s.stats().queued).toBe(0)

    // 「流送后 1s 内无 MissingRef 警告」：60 tick 静默窗口
    for (let i = 0; i < 60; i++) { t++; s.update(t, HUB) }
    expect(warnings.filter((w) => w.includes('MissingRef'))).toEqual([])
    expect(maxInFlight).toBeLessThanOrEqual(4)
    expect(maxActive).toBeLessThanOrEqual(27) // 3D 激活环 3×3×3
    off1(); off2(); s.dispose()
  })

  it('activates every cell of a region the player stands in, whatever the layer', () => {
    const s = new StreamingSystem(regions)
    for (const f of ['flag.left_resthold', 'flag.choir_entrance_open', 'flag.brokenbar_bridge_down', 'flag.organ_gate_open', 'flag.deeps_entrance_open']) {
      s.setFlag(f)
    }
    const probes: Array<{ pos: { x: number; y: number; z: number }; region: string }> = [
      { pos: HUB, region: 'rg_resthold' },
      { pos: FOREST, region: 'rg_whisperwode' },
      { pos: CHOIR, region: 'rg_drowned_choir' },
      { pos: { x: -80, y: 0, z: -200 }, region: 'rg_brokenbar_camp' },
      { pos: { x: 200, y: 90, z: -220 }, region: 'rg_fellcarillon' },
      { pos: { x: -100, y: -150, z: 200 }, region: 'rg_earless_deeps' },
      { pos: { x: 0, y: 160, z: -200 }, region: 'rg_unfinished_hall' },
    ]
    let tick = 0
    for (const p of probes) {
      s.teleport(tick, p.pos)
      tick = drain(s, p.pos, tick, 300)
      const here = s.chunkAt(p.pos)
      expect(here, `${p.region} cell missing at ${JSON.stringify(p.pos)}`).toBeTruthy()
      expect(here!.state, p.region).toBe('active')
      expect(here!.regionId, p.region).toBe(p.region)
    }
    s.dispose()
  })
})

/**
 * Phase 3-B：玩家脚下的层由 Surface 给出（垂直分层世界），
 * 不再是控制器里硬编码的 y=0。
 */
describe('vertical floor flow (Phase 3-B · §65 垂直结构)', () => {
  function makePlayer() {
    const time = new GameTime()
    const rhythm = new RhythmClock()
    rhythm.setBpm(84, 4)
    const weapon = registry.get<WeaponData>('wp_tuning_sword')
    const moveset = registry.get<MovesetData>('ms_sword')
    const player = new PlayerController(playerBase, weapon, moveset)
    const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
    const input = { frame, enabled: true } as unknown as Input
    player.camYawRef = 0
    const surface = new Surface(regions)
    const step = (n: number): void => {
      for (let i = 0; i < n; i++) {
        time.tick++
        player.update(TICK_DT, time, input, time.tick, rhythm)
        const f = surface.floorAt(player.pos)
        player.floorY = f ? f.y : 0 // 与 main.ts 同规则：层外回落到基准地面
        frame.edges.clear()
      }
    }
    const snap = (pos: { x: number; y: number; z: number }): void => {
      player.pos.x = pos.x; player.pos.y = pos.y; player.pos.z = pos.z
      player.vy = 0
      player.floorY = surface.floorAt(pos)?.y ?? 0
    }
    return { player, step, snap }
  }

  it('站在上层地板上不穿模，走到无覆盖 xz 后落到该 xz 的最高地板', () => {
    const { player, step, snap } = makePlayer()
    snap({ x: 200, y: 64, z: -150 }) // 钟坠院 groundY 64（雾语林地表在其下）
    step(10)
    expect(player.grounded).toBe(true)
    expect(player.pos.y).toBe(64)
    snap({ x: 200, y: 64, z: -50 }) // 走出钟坠院 bounds，脚下只剩雾语林 0
    step(5)
    expect(player.grounded).toBe(false)
    step(300) // 64m 自由落体 ≈ 2.3s，给足余量
    expect(player.pos.y).toBe(0)
    expect(player.grounded).toBe(true)
  })

  it('从崖口进入地下层时落到地下地面，而不是被地表接住', () => {
    const { player, step, snap } = makePlayer()
    snap({ x: 300, y: -20, z: 60 }) // 沉唱堂 xz：地表 0 在头顶，本层 -40
    expect(player.floorY).toBe(-40)
    step(120)
    expect(player.pos.y).toBe(-40)
    expect(player.grounded).toBe(true)
  })

  it('跨层瞬移不会被高层陈旧的 floorY 拎起来（main.ts 在 player.update 之后才刷新地面）', () => {
    const { player, step, snap } = makePlayer()
    snap({ x: 200, y: 64, z: -150 })
    step(10)
    expect(player.floorY).toBe(64)
    player.pos.x = 300; player.pos.y = -20; player.pos.z = 60 // 本 tick 内 floorY 仍是 64
    step(1)
    expect(player.pos.y).toBe(-20)
    step(400)
    expect(player.pos.y).toBe(-40)
    expect(player.grounded).toBe(true)
  })

  it('容差内的台阶自动抬升（Surface 只给脚底 +0.5m 以内的地板）', () => {
    const { player, step, snap } = makePlayer()
    snap({ x: 0, y: 0, z: 0 })
    step(5)
    player.floorY = 0.4 // 抬半米以内的层面
    step(1)
    expect(player.pos.y).toBe(0.4)
    expect(player.grounded).toBe(true)
  })

  it('区域外没有地板时回落到基准地面（不会悬空也不会无限下坠）', () => {
    const { player, step, snap } = makePlayer()
    snap({ x: 5_000, y: 30, z: 5_000 })
    step(200)
    expect(player.pos.y).toBe(0)
    expect(player.grounded).toBe(true)
  })

  it('整条穿行动线走一遍：灰盒实例数与存活 chunk 数始终一致', () => {
    const scene = new THREE.Scene()
    const s = new StreamingSystem(regions)
    for (const f of ['flag.left_resthold', 'flag.choir_entrance_open']) s.setFlag(f)
    const g = new ChunkGreybox(scene, regions, s.chunkSize)
    s.teleport(0, HUB)
    let t = drain(s, HUB, 0)
    let events = 0
    const off = bus.on('world.chunk', () => { events++ })
    const versions = () => scene.children
      .filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh)
      .reduce((n, m) => n + m.instanceMatrix.version, 0)
    const v0 = versions()
    t = run(s, HUB, FOREST, t); t = drain(s, FOREST, t)
    t = run(s, FOREST, CHOIR, t); t = drain(s, CHOIR, t)
    expect(s.regionAt(CHOIR)?.id).toBe('rg_drowned_choir')
    expect(g.liveFloors).toBe(s.all().filter((c) => c.state !== 'unloaded').length)
    expect(g.liveFloors).toBeGreaterThan(0)
    // 每个 chunk 事件最多两张图（地板 + 该格地标）各一次上传：版本增量 ≤ 2×事件数，无 O(N²) 重刷
    expect(versions() - v0).toBeLessThanOrEqual(events * 2)
    g.dispose(); s.dispose(); off()
    expect(scene.children.length).toBe(0)
  })
})
