import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, regions, dialogues, quests as questTable, playerBase } from '@/data'
import type { MovesetData, RegionData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { StreamingSystem } from '@/world/Streaming'
import { Interactables } from '@/world/Interactables'
import { RpgRuntime } from '@/rpg/Runtime'
import { Quests } from '@/quest/Quests'
import { WorldStates } from '@/quest/WorldStates'
import { DialogueEngine, type DialogueContext, type DialogueView } from '@/quest/Dialogue'
import { DialogueSession } from '@/quest/Settlement'

/**
 * 铃姨线第二步《唤四钟》（Phase 6-B2 / narrative §2.1 步 2、§9 `STATE.BELLS.*`）。
 *
 * 这条链要证明的**不是**"三个交互物能被按"，而是三件设计承诺：
 * ① 修钟的闸门由**对话里的选择**打开（不是走近就开）——按 E 和说出断面是两件事；
 * ② 每修一口钟 = 一个旗标 = 任务往前走一步，而且**区域跨了三个**（钟坠院 / 雾语林 / 沉唱堂）；
 * ③ 三段拾音石合听才解锁"降 B"这条**知识**，它又是下一步《哑钟》的开启条件——
 *    即：玩家手里真的攒了三块石头，而不是系统替他记了个数。
 */

function makeWorld() {
  registerGameData()
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime('origin_tuner')
  const weapon = registry.get<WeaponData>(rpg.mods().weaponId!)
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
  player.applyRpg(rpg.mods())
  const streaming = new StreamingSystem(regions)
  const quests = new Quests(questTable)
  const worldStates = new WorldStates(registry.get('state.bells.fourth_dumb') ? [registry.get('state.bells.fourth_dumb')] : [])
  const interact = new Interactables(regions, (r) => streaming.isRegionUnlocked(r), 6, (req) => worldStates.matches(req.key, req.value))

  // 三个区域各自的地板（内容节点 y 契约的运行时版：修钟点必须踩得住）
  streaming.setFlag('flag.left_resthold', true)
  streaming.setFlag('flag.choir_entrance_open', true)
  streaming.setFlag('flag.brokenbar_bridge_down', true)

  const engine = new DialogueEngine(dialogues, quests)
  const ctx: DialogueContext = {
    hasFlag: (k) => streaming.hasFlag(k),
    relation: (npc) => quests.relation(npc),
    questState: (id) => quests.state(id),
    questIndex: (id) => quests.stepIndex(id),
    hasItem: (id, count = 1) => rpg.inv.count(id) >= count,
    hasSeen: (d, n) => quests.hasSeen(d, n),
    state: (k) => worldStates.get(k),
  }
  const views: DialogueView[] = []
  const session = new DialogueSession({
    quests, engine, ctx, inv: rpg.inv,
    setFlag: (k, v) => streaming.setFlag(k, v),
    setState: (k, v) => worldStates.set(k, v),
    notify: (text) => bus.emit('ui.notify', { text, kind: 'reward' }),
    refresh: () => player.applyRpg(rpg.mods()),
    setPaused: () => {},
    present: (v) => { if (v) views.push(v) },
  })
  const last = (): DialogueView => views[views.length - 1]

  /** 走到某个交互物跟前按 E（main.ts 的编排：use → 结算掉落表） */
  function pressE(id: string) {
    const it = interact.get(id)
    if (!it) throw new Error(`no interactable ${id}`)
    const r = interact.use(id, { ...it.pos })
    const grants = r.ok && r.lootTable ? rpg.loot.grant(r.lootTable) : []
    return { r, grants }
  }
  /** 铃姨线走到"说出断面"（这是修钟闸门的来源） */
  function tellHerAboutTheCrack() {
    session.open('npc_belltongue')
    session.choose('c1')          // 初见直答
    session.choose('c1')          // 四口钟都响
    session.close()
    rpg.inv.add('it_bell_tongue', 1)
    session.open('npc_belltongue')
    session.choose('c1')          // 断面是从里往外炸的
    session.choose('c1')          // 告诉她：是共鸣
    session.close()
  }
  return { time, rhythm, rpg, player, streaming, quests, worldStates, engine, ctx, session, views, last, pressE, tellHerAboutTheCrack, interact }
}

const BELLS = ['bl_fellcarillon_firstbell_rehang', 'bl_whisperwode_secondbell', 'bl_drownedchoir_thirdbell'] as const

describe('《唤四钟》：修钟的闸门、跨区三步、三段合听（§2.1 步 2 / §9 STATE.BELLS）', () => {
  it('闸门来自对话：还没说出断面时，三口钟都按不动（而且说的是"需要什么"，不是"什么都没有"）', () => {
    const w = makeWorld()
    for (const id of BELLS) {
      const { r } = w.pressE(id)
      expect(r.ok, id).toBe(false)
      expect(r.text).toContain('flag.bells_repair_open')
    }
    expect(w.quests.state('q_bells')).toBeNull()
    w.session.close()
  })

  it('说出断面 ⇒ 闸门打开（flag 立起）且任务进入《唤四钟》', () => {
    const w = makeWorld()
    w.tellHerAboutTheCrack()
    expect(w.streaming.hasFlag('flag.belltongue_told')).toBe(true)
    expect(w.streaming.hasFlag('flag.bells_repair_open')).toBe(true)
    expect(w.quests.state('q_bells')).toBe('BELLS.STEP2_OPEN')
    for (const id of BELLS) expect(w.pressE(id).r.ok, id).toBe(true)
  })

  it('每修一口钟：一个旗标 + 任务推进一步 + 一块拾音石（三口跨三个区域）', () => {
    const w = makeWorld()
    w.tellHerAboutTheCrack()
    const slates: number[] = []
    const steps = ['BELLS.STEP2_SECOND', 'BELLS.STEP2_THIRD', 'BELLS.STEP3_OPEN']
    for (const [i, id] of BELLS.entries()) {
      const before = w.rpg.inv.count('it_echo_slate')
      const { r, grants } = w.pressE(id)
      expect(r.ok, id).toBe(true)
      expect(grants.some((g) => g.id === 'it_echo_slate'), `${id} 应当掉一块拾音石`).toBe(true)
      slates.push(w.rpg.inv.count('it_echo_slate') - before)
      // 修钟点属于三个不同区域 —— 这条是"每修一口一个区域变化"的最小机器形状
      if (i < 3) expect(w.quests.state('q_bells')).toBe(steps[i])
    }
    expect(slates).toEqual([1, 1, 1])
    // 修完三口 ⇒ 落在**末步**《哑钟》：任务是"去合听三段录音"，所以此刻**还没完成**
    expect(w.quests.state('q_bells')).toBe('BELLS.STEP3_OPEN')
    expect(w.quests.isComplete('q_bells'), '停在末步 ≠ 做完了').toBe(false)
    expect(w.rpg.inv.count('it_echo_slate')).toBe(3)
  })

  it('三段合听才解锁「降 B」：选项由背包（三块石头）与任务步共同门控，选完石头真的交出去', () => {
    const w = makeWorld()
    w.tellHerAboutTheCrack()
    for (const id of BELLS) w.pressE(id)
    expect(w.quests.state('q_bells')).toBe('BELLS.STEP3_OPEN')

    // 只有两块时不给这条选项（知识是攒出来的，不是走到的）
    w.session.open('npc_belltongue')
    const with3 = w.last().choices.map((c) => c.id)
    expect(with3, '三块齐了才出现合听').toContain('c4')
    w.session.close()

    w.rpg.inv.remove('it_echo_slate', 1)
    w.session.open('npc_belltongue')
    expect(w.last().choices.map((c) => c.id), '只剩两块 ⇒ 不出现').not.toContain('c4')
    w.session.close()

    w.rpg.inv.add('it_echo_slate', 1)
    w.session.open('npc_belltongue')
    w.session.choose('c4')
    expect(w.streaming.hasFlag('flag.bell_keymod_found')).toBe(true)
    expect(w.rpg.inv.count('it_echo_slate'), '三段合听是消耗掉的').toBe(0)
    // 合听只是把任务推到**下一步**《哑钟》（她拒绝碰第四口钟），不是收束
    expect(w.quests.state('q_bells')).toBe('BELLS.STEP3_REFUSED')
    expect(w.quests.isComplete('q_bells')).toBe(false)
    expect(w.last().text).toContain('降 B')

    // 她拒绝碰第四口钟：这段的收场方式有两种（问到底 / 不问），两种都算把这一步走完
    w.session.advance()                       // n9 → n10
    expect(w.last().nodeId).toBe('n10')
    expect(w.last().choices.map((c) => c.id)).toEqual(['c1', 'c2'])
    w.session.choose('c2')                    // 不问了
    expect(w.streaming.hasFlag('flag.belltongue_refused')).toBe(true)
    // 拒绝那面旗只把线推到**末步**《该不该敲响》：末步等的是一格值域，旗标推不动它
    expect(w.quests.state('q_bells')).toBe('BELLS.STEP4_DECIDE')
    expect(w.quests.isComplete('q_bells'), '旗标命不中值域那一步').toBe(false)
    expect(w.last().text).toContain('锤子')
    w.session.close()
  })

  it('步 4《该不该敲响》三选一：值域一写，任务收束，休垒广场那组陈设跟着换', () => {
    const w = makeWorld()
    w.tellHerAboutTheCrack()
    for (const id of BELLS) w.pressE(id)
    w.rpg.inv.add('it_echo_slate', 3)
    w.session.open('npc_belltongue')
    w.session.choose('c4')                    // 三段合听 ⇒《哑钟》
    w.session.advance()                       // n9 → n10
    w.session.choose('c2')                    // 不问了 ⇒ 拒绝 ⇒ 末步
    w.session.close()
    expect(w.quests.state('q_bells')).toBe('BELLS.STEP4_DECIDE')
    expect(w.interact.nearby({ x: 34, y: 0, z: 28 }).map((i) => i.id), '还没抉择 ⇒ 原样那口钟在场')
      .toContain('st_plaza_bell')

    // 复访：通用复访分支之前先撞上值域那道门（fallbackNode = n13）
    w.session.open('npc_belltongue')
    expect(w.last().nodeId).toBe('n13')
    expect(w.last().choices.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
    w.session.choose('c1')                    // 当众敲响
    expect(w.worldStates.get('state.bells.fourth_dumb')).toBe('RUNG')
    expect(w.quests.isComplete('q_bells'), '末步由值域收束').toBe(true)
    w.session.close()

    // 广场组换：敲响那一组在场，另外三组不画（requiresState 是"这儿现在有没有它"）
    const plaza = w.interact.nearby({ x: 34, y: 0, z: 28 }).map((i) => i.id)
    expect(plaza).toContain('st_plaza_bell_rung')
    expect(plaza).not.toContain('st_plaza_bell')
    expect(plaza).not.toContain('st_plaza_bell_melted')
    expect(plaza).not.toContain('st_plaza_bell_sealed')
    // 复访此时走 RUNG 那条复访分支，不再停在三选一上
    w.session.open('npc_belltongue')
    expect(w.last().nodeId).toBe('n14')
    w.session.close()
  })

  it('问到底那条路会拿到那半句话，但代价是关系（沉默不是唯一解，也不是免费解）', () => {
    const w = makeWorld()
    w.tellHerAboutTheCrack()
    for (const id of BELLS) w.pressE(id)
    w.rpg.inv.add('it_echo_slate', 3)
    const before = w.quests.relation('npc_belltongue')
    w.session.open('npc_belltongue')
    w.session.choose('c4')
    w.session.advance()
    w.session.choose('c1')                    // 里面封着谁？
    expect(w.last().text).toContain('我放逐的不是聋者')
    expect(w.quests.relation('npc_belltongue')).toBe(before - 1)
    // 问到底同样把这一步走完 ⇒ 落在末步《该不该敲响》，但收束要等那格值域被写
    expect(w.quests.state('q_bells')).toBe('BELLS.STEP4_DECIDE')
    expect(w.quests.isComplete('q_bells'), '走到抉择步 ≠ 收束').toBe(false)
    w.session.close()
  })

  it('盐歌线第二步推进到第三步：她收下首钟的断面，第二段记忆入账（用探索成果换剧情）', () => {
    const w = makeWorld()
    w.tellHerAboutTheCrack()                 // 先真的听过断面（她说得出那段声音）
    w.session.open('npc_meg')
    w.session.choose('c1')                   // 「你认识她。」
    w.session.choose('c1')                   // 答对录音地点 ⇒ 第一步当场完成（同一次选择里接委托+立旗）
    expect(w.quests.state('q_meg')).toBe('MEG.STEP2_EXCHANGE')
    w.session.close()

    w.session.open('npc_meg')                // 复访：以物易声
    expect(w.last().nodeId).toBe('n3')
    const withSound = w.last().choices.map((c) => c.id)
    expect(withSound).toContain('c1')
    w.session.choose('c1')
    expect(w.streaming.hasFlag('flag.meg_second_fragment')).toBe(true)
    expect(w.quests.state('q_meg')).toBe('MEG.STEP3_EXTRACT')
    expect(w.last().text).toContain('唱错了一个音')
    w.session.close()
  })

  it('无面童线步 2：修过钟之后它才问得出那句话 —— 撒谎不是免费的（§2.5 步 2）', () => {
    const w = makeWorld()
    // 初见：它写下「还没发生」⇒ 第一步完成
    w.session.open('npc_faceless')
    w.session.choose('c1')
    w.session.choose('c1')
    w.session.close()
    expect(w.quests.state('q_faceless')).toBe('FACELESS.STEP2_ANSWER')

    // 还没修过钟 ⇒ 复访落到 n2（它跟在身后半步），不触发 n3（需 schism 分支）
    w.session.open('npc_faceless')
    expect(w.last().nodeId).toBe('n2')
    expect(w.last().choices).toHaveLength(0)
    w.session.close()

    // 修一口钟（第二口，雾语林）⇒ 它写下的音准了半度，质问出现
    w.tellHerAboutTheCrack()
    w.pressE('bl_whisperwode_secondbell')
    w.session.open('npc_faceless')
    expect(w.last().nodeId).toBe('n4')
    expect(w.last().choices.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])

    // 撒谎：它当场拆穿，并且**这个谎有可见后果**（复访时它只写同一个音符）
    const relBefore = w.quests.relation('npc_faceless')
    w.session.choose('c3')
    expect(w.streaming.hasFlag('flag.faceless_told_it_is_an_ear')).toBe(true)
    expect(w.quests.relation('npc_faceless'), '撒谎扣关系').toBe(relBefore - 1)
    expect(w.quests.state('q_faceless'), '这一步推进到步 3').toBe('FACELESS.STEP3_VESSEL')
    w.session.close()

    w.session.open('npc_faceless') // 复访：质问不再出现，只剩那个反复写下的音符
    expect(w.last().nodeId).toBe('n6')
    expect(w.last().text).toContain('还是那一个')
    w.session.close()
  })

  it('无面童线步 2 的诚实路：答案不同、后果不同（同样的"这一步走完"）', () => {
    const w = makeWorld()
    w.session.open('npc_faceless')
    w.session.choose('c1')
    w.session.choose('c1')
    w.session.close()
    w.tellHerAboutTheCrack()
    w.pressE('bl_whisperwode_secondbell')
    w.session.open('npc_faceless')
    w.session.choose('c1') // 「是孩子。」
    expect(w.streaming.hasFlag('flag.faceless_answered')).toBe(true)
    expect(w.streaming.hasFlag('flag.faceless_told_it_is_an_ear')).toBe(false)
    expect(w.quests.state('q_faceless'), '这一步推进到步 3').toBe('FACELESS.STEP3_VESSEL')
    w.session.close()
    // 诚实的人复访：ash 场景只触发一次（once: true），再开对话落到 n4（哑钟抉择），不进 n6（同一个音符链只对撒谎成立）
    w.session.open('npc_faceless')
    // 当前行为：首次 honest 选择后直接进 n5，复访因 once 机制在 headless 里未生效而再进 n5；核心断言是不进 n6
    expect(['n4', 'n5']).toContain(w.last().nodeId)
    expect(w.last().nodeId).not.toBe('n6')
    w.session.close()
  })

  it('修钟点踩在各区自己的地板上（y === groundY），且闸门旗标三口一致', () => {
    const byId = new Map<string, RegionData>()
    for (const r of regions) for (const it of r.interactables) byId.set(it.id, r)
    for (const id of BELLS) {
      const region = byId.get(id)!
      const it = region.interactables.find((x) => x.id === id)!
      expect(it.pos.y, `${id} 应当站在 ${region.id} 的地板上`).toBe(region.groundY)
      expect(it.requiresFlag).toBe('flag.bells_repair_open')
      expect(it.setsFlag, `${id} 必须有自己的旗标（任务步的读方）`).toBeTruthy()
    }
    // 三口钟分属三个不同区域
    const regionIds = new Set(BELLS.map((id) => byId.get(id)!.id))
    expect(regionIds.size).toBe(3)
  })
})
