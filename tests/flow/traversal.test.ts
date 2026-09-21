/**
 * 交互物驱动的全程动线（Phase 3-C1，需求 §65 六要素之「交互」+ §59 自动化玩法流）。
 * 与 world.test.ts 的区别：这里不靠 setFlag 作弊，区域解锁一律由 regions.json 里的
 * 交互物产生，逐段推进 休垒 → … → 未竟厅。唯一的非交互 flag 是「弹反教学」——
 * 那是剧情奖励（Phase 6 对话树），此处显式标注为模拟。
 */
import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { registerGameData, regions } from '@/data'
import type { Vec3 } from '@/data/schema'
import { StreamingSystem } from '@/world/Streaming'
import { Surface } from '@/world/Surface'
import { Interactables, takeInteractEdge } from '@/world/Interactables'

registerGameData()

/** 一条动线：三段式（站位 → 用交互物 → 落到 to 点） */
function wire() {
  const stream = new StreamingSystem(regions)
  const interact = new Interactables(regions, (r) => stream.isRegionUnlocked(r))
  const surface = new Surface(regions, 0.5, (r) => !stream.isRegionUnlocked(r))
  const flags: string[] = []
  const off = bus.on('world.flag', (f) => {
    if (f.value !== false) flags.push(f.key)
  })
  const travel = (to: Vec3): void => { stream.teleport(0, to) } // 等价 main.ts 的 world.travel 处理
  return { stream, interact, surface, flags, off, travel }
}

function at(w: ReturnType<typeof wire>, id: string): Vec3 {
  const it = w.interact.get(id)
  expect(it, `interactable ${id} exists`).toBeTruthy()
  return { ...it!.pos }
}

function use(w: ReturnType<typeof wire>, id: string): { ok: boolean; state: string; text: string; to?: Vec3; rest?: boolean } {
  const pos = at(w, id)
  const r = w.interact.use(id, pos)
  if (r.ok && r.to) w.travel(r.to)
  return { ok: r.ok, state: r.state, text: r.text, ...(r.to ? { to: r.to } : {}), ...(r.rest ? { rest: true } : {}) }
}

describe('interactable-driven traversal (Phase 3-C1)', () => {
  it('未开放区域既没有地面也没有交互物：出城前世界在休垒脚下为止', () => {
    const w = wire()
    expect(w.surface.floorAt({ x: 0, y: 0, z: 0 })?.regionId).toBe('rg_resthold')
    expect(w.surface.floorAt({ x: 200, y: 0, z: 0 })).toBeNull() // 雾语林未解锁
    const gate = w.interact.focus({ x: 76, y: 0, z: 0 })
    expect(gate?.id).toBe('gt_resthold_gate')
    expect(w.interact.focus({ x: 130, y: 0, z: 0 })).toBeNull() // 区域外的交互物不可见
    w.off()
  })

  it('休垒 → 未竟厅：全程只按 E，区域逐段解锁', () => {
    const w = wire()
    const seen: string[] = []
    const step = (id: string): void => {
      const r = use(w, id)
      expect(`${id}:${r.ok}`, r.text).toBe(`${id}:true`)
      seen.push(id)
    }
    step('gt_resthold_gate')          // flag.left_resthold → 雾语林 + 破拍营地
    expect(w.stream.isRegionUnlocked(regions.find((r) => r.id === 'rg_whisperwode')!)).toBe(true)
    // 音壁先拒后开：弹反是剧情奖励，未教不动
    const wall = w.interact.use('sw_whisperwode_soundwall', at(w, 'sw_whisperwode_soundwall'))
    expect([wall.ok, wall.state]).toEqual([false, 'locked'])
    bus.emit('world.flag', { key: 'flag.parry_taught', value: true }) // 模拟铃姨教学（Phase 6 对话）
    step('sw_whisperwode_soundwall')  // flag.choir_entrance_open → 沉唱堂
    step('gt_drownedchoir_deepstair') // flag.deeps_entrance_open → 无耳深窖
    step('el_resthold_well')          // 共鸣井：休垒 ↔ 深窖快速旅行（此时才可用）
    step('br_brokenbar_gate')         // flag.brokenbar_bridge_down → 钟坠院
    step('bl_fellcarillon_fallenbell')// flag.bell_toll_rung
    step('el_fellcarillon_organlift') // flag.organ_gate_open → 未竟厅
    const hall = regions.find((r) => r.id === 'rg_unfinished_hall')!
    expect(w.stream.isRegionUnlocked(hall)).toBe(true)
    expect(seen).toEqual([
      'gt_resthold_gate', 'sw_whisperwode_soundwall', 'gt_drownedchoir_deepstair',
      'el_resthold_well', 'br_brokenbar_gate', 'bl_fellcarillon_fallenbell', 'el_fellcarillon_organlift',
    ])
    // 到了最高层：落地即激活脚下 chunk，且脚下地面是未竟厅
    const landing = { x: 0, y: 152, z: -120 }
    w.stream.teleport(1, landing)
    expect(w.stream.chunkAt(landing)?.state).toBe('active')
    expect(w.surface.floorAt(landing)).toEqual({ y: 152, regionId: 'rg_unfinished_hall' })
    w.off()
  })

  it('单行道不能回头，调音桩可反复休息，采集/遗箱只用一次', () => {
    const w = wire()
    expect(use(w, 'gt_resthold_gate').ok).toBe(true)
    expect(use(w, 'br_brokenbar_gate').ok).toBe(true)
    const again = w.interact.use('br_brokenbar_gate', at(w, 'br_brokenbar_gate'))
    expect([again.ok, again.state]).toEqual([false, 'used'])
    // 调音桩：不消耗，返回 rest
    const st = use(w, 'st_resthold')
    expect([st.ok, st.rest]).toEqual([true, true])
    expect(w.interact.stateOf(w.interact.get('st_resthold')!)).toBe('ready')
    // 采集一次即空
    const g = 'gh_whisperwode_timbite_1'
    expect(use(w, g).ok).toBe(true)
    expect(w.interact.stateOf(w.interact.get(g)!)).toBe('used')
    // 遗箱需要剧情 flag
    const chest = 'ch_drowned_choir_movement'
    bus.emit('world.flag', { key: 'flag.choir_entrance_open', value: true })
    expect(w.interact.use(chest, at(w, chest)).state).toBe('locked')
    bus.emit('world.flag', { key: 'flag.ostlara_defeated', value: true })
    expect(w.interact.use(chest, at(w, chest)).ok).toBe(true)
    w.off()
  })

  it('够不着就用不到（交互半径 6m）', () => {
    const w = wire()
    const far = { x: 0, y: 0, z: 0 }
    const r = w.interact.use('gt_resthold_gate', far)
    expect([r.ok, r.text]).toEqual([false, '离得太远'])
    expect(w.flags).not.toContain('flag.left_resthold')
    w.off()
  })

  it('NPC 不假装完成：只登记「对话待接入」，不设 flag', () => {
    const w = wire()
    const r = use(w, 'npc_belltongue')
    expect(r.ok).toBe(true)
    expect(r.text).toContain('Phase 6')
    expect(w.flags).toEqual([])
    w.off()
  })

  it('HUD 提示随焦点进出：进半径给文案，离开/用完即清空', () => {
    const w = wire()
    const prompts: Array<string | null> = []
    const offPrompt = bus.on('ui.prompt', (p) => { prompts.push(p.text) })
    const gate = at(w, 'gt_resthold_gate')
    w.interact.update({ x: gate.x, y: 0, z: gate.z + 40 }) // 远处：无焦点，无事件
    w.interact.update(gate)
    w.interact.update(gate) // 焦点未变：不重复刷屏
    expect(prompts).toEqual(['开门 · 休垒 Resthold'])
    use(w, 'gt_resthold_gate')
    w.interact.update(gate) // 一次性闸门用掉后焦点腾空
    expect(prompts[prompts.length - 1]).toBeNull()
    const st = at(w, 'st_resthold')
    w.interact.update(st)
    w.interact.use('st_resthold', st)
    w.interact.update(st) // 调音桩可反复：提示不消失
    expect(prompts[prompts.length - 1]).toBe('调音 · 休垒 Resthold')
    // 数据里的 verb 覆盖 kind 默认动词（吊机不是共鸣井）
    w.interact.setFlag('flag.left_resthold')
    w.interact.setFlag('flag.brokenbar_bridge_down') // 只解锁区域，不动交互 flag
    w.interact.update(at(w, 'bl_fellcarillon_fallenbell'))
    expect(prompts[prompts.length - 1]).toBe('敲钟 · 钟坠院 Fellcarillon')
    w.interact.update(at(w, 'el_fellcarillon_organlift'))
    expect(prompts[prompts.length - 1]).toBe('乘管风琴吊机 · 钟坠院 Fellcarillon')
    offPrompt()
    w.off()
  })

  it('E 键仲裁：有焦点时交互吃掉边，没焦点时留给处决/背刺', () => {
    const w = wire()
    const gate = w.interact.focus(at(w, 'gt_resthold_gate'))
    const edges = new Set(['interact'])
    expect(takeInteractEdge(edges, gate)).toBe('gt_resthold_gate')
    expect(edges.has('interact')).toBe(false) // 战斗层这一帧看不到 E 边
    const free = new Set(['interact'])
    expect(takeInteractEdge(free, null)).toBeNull()
    expect(free.has('interact')).toBe(true) // 无交互物：原样交给处决
    const noKey = new Set<string>()
    expect(takeInteractEdge(noKey, gate)).toBeNull()
    w.off()
  })
})
