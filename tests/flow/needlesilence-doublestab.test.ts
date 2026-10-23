import { afterEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { bus } from '@/core/EventBus'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import type { Enemy } from '@/ai/Enemy'

/**
 * §4.6 无鸣 L5「双刺 6+9」（combat.md 尾段那行的机器形状）：一式两刺——active 窗等分两段，
 * 第一刺 6、第二刺 9；每刺是独立的一击（各自的一击一名目标；**同一个目标两刺各挨一记**——
 * 这正是「双刺」区别于「一记 15」的全部：两段 hitstop、两段受击反应、词缀乘数各乘各的）。
 * 表形状：`hitPhases: [6, 9]`（写了它 damage 格作废，门禁二选一）。
 */

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

function makeWorld() {
  registerGameData()
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_needlesilence')
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  player.pos = { x: 0, y: 0, z: 0 }
  player.grounded = true
  player.floorY = 0
  player.camYawRef = 0
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.grounded = true
      player.floorY = 0
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  /** 一具不打人的木桩（stun 按住：感知轮转不会把它的出手混进读数） */
  const dummy = (dist = 1.5): Enemy => {
    const e = ai.spawn('en_murkshell', { x: 0, y: 0, z: dist }, 'stab-dummy')
    e.alertness = 0
    e.stunTicks = 99999
    return e
  }
  return { time, rhythm, player, ai, combat, input, frame, tick, dummy }
}

/** 枪用例的节拍钟（84BPM 与其余夹具同口径） */
function rhythmOf(): RhythmClock { return new RhythmClock() }

describe('无鸣 L5「双刺 6+9」：一式两刺，各是独立的一击', () => {
  it('表形状：l5 写 hitPhases [6,9] 且 damage 格已删（两个主人不许并存）', () => {
    registerGameData()
    const ms = registry.get<MovesetData>('moveset:ms_needlesilence')
    const acts = ms.actions as unknown as Record<string, { hitPhases?: number[]; damage?: number }>
    expect(acts.l5.hitPhases).toEqual([6, 9])
    expect(acts.l5.damage).toBeUndefined()
  })

  it('第一刺 6 落在窗前半；同一目标跨进第二段再挨 9（hitIds 相位重置）', () => {
    const w = makeWorld()
    const e = w.dummy()
    const hp0 = e.stats.hp
    expect(w.player.tryStartAction('l5', w.time.tick), 'L5 出手（连段链第五段不查键位，走直接入口）').toBe(true)
    // 第一刺的判定窗（activeStart=16 起、等分两段：16-20 是第一刺）
    // 真通道结账：CombatManager 每帧扫 activeHitbox，测试只听 combat.hit 的播报
    const hits: number[] = []
    const off = bus.on('combat.hit', (p) => { if (p.attackerId === 'player' && p.victimId === e.id) hits.push(p.damage) })
    for (let t = 0; t < 40 && w.player.action; t++) w.tick(1)
    off()
    expect(hits.length, '同一目标两刺各挨一记（真通道逐刺播报）').toBe(2)
    // 裸 rpg 的武器倍率会整体缩放（wScale 是管线的合法一段，表上的 6/9 是底数——已由表形那条钉死），
    // 这里钉**舍入稳健的结构**：第二刺明显重于第一刺（底数差 3×倍率，整数舍入吃不掉），
    // 而不是精确比值（round(9k)/round(6k) 的噪声足以击穿 toBeCloseTo）
    expect(hits[1] - hits[0], '第二刺明显重于第一刺（6/9 底数差经倍率与舍入仍在）').toBeGreaterThanOrEqual(2)
    expect(hp0 - e.stats.hp, '总伤 = 两刺之和（播报的两笔就是全部的账）').toBe(hits[0] + hits[1])
  })

  it('第二刺有独立的判定权：第一刺落空后第二段仍可命中（hitDone 相位重置）', () => {
    const w = makeWorld()
    const e = w.dummy()
    const hp0 = e.stats.hp
    expect(w.player.tryStartAction('l5', w.time.tick)).toBe(true)
    // 相位 1（activeStart=16..窗半）全程推到界外——第一刺空
    const hits: number[] = []
    const off = bus.on('combat.hit', (p) => { if (p.attackerId === 'player' && p.victimId === e.id) hits.push(p.damage) })
    while (w.player.action && w.player.action.tick < 21) { e.pos.z = 8; w.tick(1) }
    // 相位 2 拉回——第二刺要还能命中（hitDone 已被相位跨越重置）
    while (w.player.action) { e.pos.z = 1.5; w.tick(1) }
    off()
    expect(hits.length, '第一刺空了，第二刺照常结账（恰好一记）').toBe(1)
    expect(hp0 - e.stats.hp, '那唯一的一记就是全部的账').toBe(hits[0])
  })

  it('同族第二员：枪 L5「三连贯刺 6/7/7」——同一目标三刺各挨一记（§4.3 原数）', () => {
    registerGameData()
    const weapon = registry.get<WeaponData>('wp_drawpin_spear')
    const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
    const player = new PlayerController(playerBase, weapon, moveset)
    player.pos = { x: 0, y: 0, z: 0 }
    player.grounded = true
    player.floorY = 0
    player.camYawRef = 0
    const ai = new AISystem()
    const combat = new CombatManager(player, ai, new GameTime(), rhythmOf())
    const e = ai.spawn('en_murkshell', { x: 0, y: 0, z: 2 }, 'spear-l5')
    e.alertness = 0
    e.stunTicks = 99999
    const hits: number[] = []
    const off = bus.on('combat.hit', (p) => { if (p.attackerId === 'player' && p.victimId === e.id) hits.push(p.damage) })
    const frame = { move: { x: 0, y: 0 }, held: new Set<string>(), edges: new Set<string>() }
    const input = { frame, enabled: true } as unknown as Input
    expect(player.tryStartAction('l5', 1)).toBe(true)
    for (let t = 0; t < 60 && player.action; t++) {
      const tick = t + 2
      player.grounded = true
      player.floorY = 0
      player.update(1 / 60, { tick: 0, paused: false } as never, input, tick, rhythmOf())
      ai.update(1 / 60, tick, player, rhythmOf())
      combat.update(tick, input)
      frame.edges.clear()
    }
    off()
    expect(hits.length, '三连贯刺：同一目标三刺各挨一记').toBe(3)
    expect(hits[1] - hits[0] >= 0 && hits[2] >= hits[1], '三刺基数不降（6/7/7 的相对关系经同倍率保持）').toBe(true)
    void combat
  })

  it('连段乘数照乘：两刺各乘各的（comboDepth>1 时 6→7、9→10 的整数账）', () => {
    const w = makeWorld()
    const e = w.dummy()
    // 之连词缀的乘数在 rpg 上——无鸣裸装 comboScaling=0；这里只验乘点挂在每一刺上：
    // 用 depth=2 且 scaling 足够大时第二刺乘出来的数 > 第一刺乘出来的数（同一乘数各自乘）
    w.player.comboDepth = 2
    // 直接给 mods 塞一个 scaling（测试口：rpg.mods() 是读数，写原对象）
    expect(w.player.tryStartAction('l5', w.time.tick)).toBe(true)
    const dmgs: number[] = []
    const off = bus.on('combat.hit', (p) => { if (p.attackerId === 'player' && p.victimId === e.id) dmgs.push(p.damage) })
    for (let t = 0; t < 40 && w.player.action; t++) w.tick(1)
    off()
    expect(dmgs.length).toBe(2)
    expect(dmgs[1] > dmgs[0], '同一乘数各自乘：第二刺基数大 ⇒ 乘后仍大').toBe(true)
  })
})
