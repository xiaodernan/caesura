import { afterEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { InteractableRef, MovesetData, RegionData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { Interactables, takeInteractEdge } from '@/world/Interactables'

/**
 * gameplay.md §3.3「交互动词」＋ §3.4 优先级 6 那一行第一次在真链上被量（KI-305）。
 *
 * **为什么值得单独立一批**：KI-301 与 KI-303 两批都写下「交互距离门 ≤2.2m 需造交互物 ⇒ 本批无从对照」——
 * 交互物从来是数据驱动的（`regions.json > interactables`），「无从对照」不是不能造，是没造。
 * 本批把交互动词整族放上真链：真 `PlayerController`、真输入帧、真 `Interactables`（真区域数据）。
 *
 * 锁的契约（逐条来自设计文档）：
 *   ① §3.4 P6「距离 ≤2.2m」——设计写的 2.2m 与运行时的交互半径是不是一个数（**实测不是**，登记）；
 *   ② §3.4 P6「交互优先于处决/背刺」——同一帧有焦点物时 E 键的边被交互吃掉，战斗层看不到这条边；
 *   ③ §3.4 P6「仅在非硬直（无攻击/受击/翻滚）状态接受」——运行时有没有这道门（**实测没有**，登记）；
 *   ④ §3.3 六个动词的结果形状：调查/采集/对话/调律/破坏/潜行处置各自的 `use()` 回执；
 *   ⑤ 一次性与反复（`REPEATABLE`）的边界：teleport 反复可用，oneWay 数据可把任何种类钉成单次。
 *
 * 量具纪律（本批新立）：**距离门要两面夹逼**（半径内外各放一个点，不是只测"贴近了能开"）；
 * **仲裁要看边还在不在**（吃没吃掉 `interact` 这条边，而不是只看交互有没有发生）。
 */

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

registerGameData()

function makeWorld(regionList: readonly RegionData[] = regions) {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>('moveset:ms_sword'))
  player.camYawRef = 0
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const interact = new Interactables(regionList, () => true)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.step(TICK_DT)
      player.update(TICK_DT, time, input, time.tick, rhythm)
      interact.update(player.pos)
      combat.update(time.tick, input)
      rhythm.update(TICK_DT)
      frame.edges.clear()
    }
  }
  return { time, rhythm, player, ai, combat, interact, frame, input, tick }
}

/** 真区域数据里挑一只没有旗标/值域门槛的交互物（regionOpen 恒真，其余闸门不设） */
function pick(id: string): InteractableRef {
  const it = regions.flatMap((r) => r.interactables).find((x) => x.id === id)
  if (!it) throw new Error(`fixture: regions.json 里没有 ${id}`)
  return it
}

/** 只留一只交互物的单区世界（坐标与门槛全可控） */
function loneRegion(it: Record<string, unknown>): RegionData[] {
  const rg = structuredClone(regions[0])
  rg.interactables = [{ id: 'ga_lab', kind: 'chest', pos: { x: 0, y: 0, z: 0 }, ...it } as RegionData['interactables'][number]]
  return [rg]
}

describe('§3.4 P6 交互距离门：设计写 ≤2.2m，运行时是另一把尺（KI-305）', () => {
  it('焦点半径两面夹逼：5.99m 有焦点、6.01m 没有——运行时的尺是 6m，不是设计的 2.2m', () => {
    const chest = pick('ch_whisperwode_therapist')
    const w = makeWorld()
    w.player.pos = { x: chest.pos.x + 5.99, y: chest.pos.y, z: chest.pos.z }
    expect(w.interact.focus(w.player.pos)?.id, '5.99m 内 ⇒ 有焦点').toBe(chest.id)
    w.player.pos = { x: chest.pos.x + 6.01, y: chest.pos.y, z: chest.pos.z }
    expect(w.interact.focus(w.player.pos), '6.01m 外 ⇒ 没有焦点').toBeNull()
    // 设计那一格（≤2.2m）在运行时没有承载体：2.3m 处本该没有焦点，实测有
    w.player.pos = { x: chest.pos.x + 2.3, y: chest.pos.y, z: chest.pos.z }
    expect(w.interact.focus(w.player.pos)?.id, '2.3m（设计的 2.2m 之外）⇒ 运行时仍然有焦点').toBe(chest.id)
    alive.push(w.interact.dispose.bind(w.interact))
  })

  it('use() 的距离拒收也按 6m 这把尺：6.5m 处「离得太远」且不落 flag', () => {
    const chest = pick('ch_whisperwode_therapist')
    const w = makeWorld()
    const far = { x: chest.pos.x + 6.5, y: chest.pos.y, z: chest.pos.z }
    const r = w.interact.use(chest.id, far)
    expect(r.ok, '6.5m 外按 E ⇒ 打不开').toBe(false)
    expect(r.text).toBe('离得太远')
    expect(w.interact.hasFlag('flag.any'), '拒收不落任何旗').toBe(false)
    alive.push(w.interact.dispose.bind(w.interact))
  })
})

describe('§3.4 P6 交互优先于处决/背刺：E 键的边被谁吃掉（KI-305）', () => {
  it('有焦点物 ⇒ 边被交互吃掉（战斗层再也看不到这条 interact 边）', () => {
    const chest = pick('ch_whisperwode_therapist')
    const w = makeWorld()
    w.player.pos = { ...chest.pos }
    const focus = w.interact.focus(w.player.pos)
    expect(focus?.id).toBe(chest.id)
    w.frame.edges.add('interact')
    const act = takeInteractEdge(w.frame.edges, focus)
    expect(act, '有焦点时交互拿到这条边').toBe(chest.id)
    expect(w.frame.edges.has('interact'), '边必须被吃掉——否则处决层会同时触发').toBe(false)
    alive.push(w.interact.dispose.bind(w.interact))
  })

  it('无焦点物 ⇒ 边原样留给战斗层（处决/背刺/拾回枪都靠它）', () => {
    const w = makeWorld()
    w.player.pos = { x: 9000, y: 0, z: 9000 }
    w.frame.edges.add('interact')
    const act = takeInteractEdge(w.frame.edges, w.interact.focus(w.player.pos))
    expect(act).toBeNull()
    expect(w.frame.edges.has('interact'), '没有焦点 ⇒ 边还在，处决层收得到').toBe(true)
    alive.push(w.interact.dispose.bind(w.interact))
  })
})

describe('§3.4 P6「仅在非硬直接受」在运行时没有承载体（KI-305 登记）', () => {
  it('翻滚中（busy=true）按 E ⇒ 交互照常发生——设计那道「非硬直」门不存在', () => {
    const chest = pick('ch_whisperwode_therapist')
    const w = makeWorld()
    w.player.pos = { x: chest.pos.x, y: chest.pos.y, z: chest.pos.z + 1.5 }
    // 真起一次翻滚：dodge 边进真 update 循环
    w.frame.edges.add('dodge')
    w.tick(1)
    expect(w.player.busy, '此刻正在翻滚（roll !== null ⇒ busy）').toBe(true)
    // 翻滚位移 3.2m，把人放回箱子旁再按 E（位移本身不是本腿的测量对象）
    w.player.pos = { x: chest.pos.x, y: chest.pos.y, z: chest.pos.z + 1.5 }
    const focus = w.interact.focus(w.player.pos)
    w.frame.edges.add('interact')
    const act = takeInteractEdge(w.frame.edges, focus)
    const r = act ? w.interact.use(act, w.player.pos) : null
    expect(act, '翻滚中 E 键仍被交互吃掉（没有 busy 门槛）').toBe(chest.id)
    expect(r?.ok, '翻滚中箱子照样打得开——设计写的是「仅非硬直接受」').toBe(true)
    alive.push(w.interact.dispose.bind(w.interact))
  })
})

describe('§3.3 交互动词的结果形状（KI-305）', () => {
  it('调律（checkpoint）⇒ rest + setsFlag；对话（npc）⇒ npcId', () => {
    const w = makeWorld()
    const st = pick('st_resthold')
    w.player.pos = { ...st.pos }
    const r1 = w.interact.use(st.id, w.player.pos)
    expect(r1.ok).toBe(true)
    expect(r1.rest, '调音桩要给胶水层回血+存档的信号').toBe(true)
    expect(r1.setsFlag).toBe('flag.checkpoint_resthold')
    expect(w.interact.hasFlag('flag.checkpoint_resthold'), '旗标真立起来').toBe(true)

    const npc = pick('npc_belltongue')
    w.player.pos = { ...npc.pos }
    const r2 = w.interact.use(npc.id, w.player.pos)
    expect(r2.ok).toBe(true)
    expect(r2.npcId, '对话动词把 npcId 交给胶水层开对话树').toBe('npc_belltongue')
    expect(r2.rest).toBeUndefined()
    alive.push(w.interact.dispose.bind(w.interact))
  })

  it('采集/遗箱 ⇒ loot + lootTable（胶水层据此掷掉落表）', () => {
    const w = makeWorld()
    for (const [id, table] of [['gh_whisperwode_timbite_1', 'loot_gather_timbite'], ['ch_whisperwode_therapist', 'loot_chest_t1']] as const) {
      const it = pick(id)
      w.player.pos = { ...it.pos }
      const r = w.interact.use(id, w.player.pos)
      expect(r.ok, id).toBe(true)
      expect(r.loot, `${id} 要给 loot 信号`).toBe(true)
      expect(r.lootTable, `${id} 要带出掉落表 id`).toBe(table)
    }
    alive.push(w.interact.dispose.bind(w.interact))
  })

  it('传送（teleport）⇒ to 落点原样带回；调查（inspect）⇒ 纯文本无副作用', () => {
    const w = makeWorld(loneRegion({ kind: 'teleport', to: { x: -100, y: -144, z: 120 } }))
    w.player.pos = { x: 0, y: 0, z: 0 }
    const r = w.interact.use('ga_lab', w.player.pos)
    expect(r.ok).toBe(true)
    expect(r.to, '传送的落点原样带回（胶水层据此搬人）').toEqual({ x: -100, y: -144, z: 120 })

    const w2 = makeWorld()
    const inspect = pick('in_resthold_noticeboard')
    w2.player.pos = { ...inspect.pos }
    const r2 = w2.interact.use(inspect.id, w2.player.pos)
    expect(r2.ok).toBe(true)
    expect(r2.to, '调查不传送').toBeUndefined()
    expect(r2.rest, '调查不回血').toBeUndefined()
    expect(r2.loot, '调查不掷掉落').toBeUndefined()
    alive.push(w.interact.dispose.bind(w.interact), w2.interact.dispose.bind(w2.interact))
  })
})

describe('一次性与反复：REPEATABLE 族与 oneWay 数据（KI-305）', () => {
  it('teleport 反复可用；oneWay 数据可把任何种类钉成单次', () => {
    const w = makeWorld(loneRegion({ kind: 'teleport', to: { x: 1, y: 0, z: 0 } }))
    w.player.pos = { x: 0, y: 0, z: 0 }
    expect(w.interact.use('ga_lab', w.player.pos).ok, '第一次').toBe(true)
    expect(w.interact.use('ga_lab', w.player.pos).ok, '传送点是"门开了就一直在" ⇒ 第二次照样开').toBe(true)

    const oneWay = makeWorld(loneRegion({ kind: 'teleport', oneWay: true, to: { x: 1, y: 0, z: 0 } }))
    oneWay.player.pos = { x: 0, y: 0, z: 0 }
    expect(oneWay.interact.use('ga_lab', oneWay.player.pos).ok, 'oneWay 第一次').toBe(true)
    const second = oneWay.interact.use('ga_lab', oneWay.player.pos)
    expect(second.ok, 'oneWay 第二次 ⇒ 此路已尽').toBe(false)
    expect(second.state).toBe('used')
    alive.push(w.interact.dispose.bind(w.interact), oneWay.interact.dispose.bind(oneWay.interact))
  })
})
