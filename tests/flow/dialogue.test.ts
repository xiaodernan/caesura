import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, regions, dialogues, quests as questTable, playerBase } from '@/data'
import type { ItemData, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { StreamingSystem } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import { Interactables, takeInteractEdge } from '@/world/Interactables'
import { RpgRuntime } from '@/rpg/Runtime'
import { Quests } from '@/quest/Quests'
import { DialogueEngine, type DialogueContext, type DialogueView } from '@/quest/Dialogue'
import { DialogueSession } from '@/quest/Settlement'
import { SaveGame, MapStore, SAVE_VERSION } from '@/save/Serializer'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * 叙事闭环（Phase 6-B / 需求 §27/§28/§30、narrative §2.1）：
 *
 *   走到 NPC → 按 E 交谈 → 选项 → **世界真的被改了**（旗标广播 / 任务推进 / 关系）
 *   → 条件门控的知情选项（背包里真有那截断舌才出现）→ 分支 → 存档 → 读档 → 不重演
 *
 * 全程 headless：逻辑层不 import three，所以整条链在 node 里跑得完（tech-arch §5.8）。
 * 这里走的是 `quest/Settlement.ts` 的**真编排**（不是测试里另写一份），main.ts 只是它的接线。
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
  const ai = new AISystem()
  const spawner = new SpawnDirector(regions, {
    spawn: (id, pos, seed) => ai.spawn(id, pos, seed),
    despawn: (id) => ai.despawn(id),
    hasFlag: (k) => streaming.hasFlag(k),
  }, (p: Vec3) => { const c = streaming.cellOf(p); return `${c.cx},${c.cy},${c.cz}` })
  const interact = new Interactables(regions, (r) => streaming.isRegionUnlocked(r))

  const flagEvents: string[] = []
  const off = bus.on('world.flag', (f) => { if (f.value !== false) flagEvents.push(f.key) })

  const quests = new Quests(questTable)
  const engine = new DialogueEngine(dialogues, quests)
  const ctx: DialogueContext = {
    hasFlag: (k) => streaming.hasFlag(k),
    relation: (npc) => quests.relation(npc),
    questState: (id) => quests.state(id),
    questIndex: (id) => quests.stepIndex(id),
    hasItem: (id, count = 1) => rpg.inv.count(id) >= count,
    hasSeen: (d, n) => quests.hasSeen(d, n),
  }
  const views: DialogueView[] = []
  let paused = false
  const session = new DialogueSession({
    quests, engine, ctx, inv: rpg.inv,
    setFlag: (k, v) => streaming.setFlag(k, v),
    notify: (text) => bus.emit('ui.notify', { text, kind: 'reward' }),
    refresh: () => player.applyRpg(rpg.mods()),
    setPaused: (p) => { paused = p },
    present: (v) => { if (v) views.push(v) },
  })
  const last = (): DialogueView => views[views.length - 1]
  return { time, rhythm, rpg, player, streaming, quests, engine, ctx, session, views, last, flagEvents, off, interact, spawner, isPaused: () => paused }
}

describe('§27/§30 叙事闭环：交谈 → 选择 → 世界被改 → 存档 → 读档', () => {
  it('按 E 交谈：世界停摆、开场节点来自 npcs 数据、对话框拿到第一句', () => {
    const w = makeWorld()
    expect(w.session.open('npc_belltongue')).toBe(true)
    expect(w.session.isTalking).toBe(true)
    expect(w.isPaused(), '对话期间世界停摆').toBe(true)
    expect(w.last().speaker).toBe('npc_belltongue')
    expect(w.last().text).toContain('左耳那串断铃')
    expect(w.last().choices.map((c) => c.id)).toEqual(['c1', 'c2'])
    w.session.close()
    expect(w.isPaused()).toBe(false)
    w.off()
  })

  it('一次选择同时改三样东西：旗标（走广播）、关系、任务线', () => {
    const w = makeWorld()
    w.session.open('npc_belltongue')
    w.session.choose('c1') // 「不疼。剪断的东西，从来不该疼第二次。」
    // ① 旗标：不是内部变量，是**广播**（流送层/交互层/调试器都看得见同一条）
    expect(w.streaming.hasFlag('flag.belltongue_met')).toBe(true)
    expect(w.flagEvents).toContain('flag.belltongue_met')
    // ② 关系：+1
    expect(w.quests.relation('npc_belltongue')).toBe(1)
    // ③ 任务：四镇钟线开始，落在第一步
    expect(w.quests.state('q_bells')).toBe('BELLS.STEP1_OPEN')
    expect(w.last().nodeId).toBe('n1')
    w.session.close()
    w.off()
  })

  it('知情选项由**背包**门控：拿到断舌之前，"我看了断面"这句话说不出口', () => {
    const w = makeWorld()
    w.session.open('npc_belltongue')
    w.session.choose('c1')
    w.session.close()

    w.session.open('npc_belltongue') // 复访 ⇒ fallback 节点
    expect(w.last().nodeId).toBe('n5')
    expect(w.last().choices.map((c) => c.id), '没有断舌 ⇒ 只剩两条').toEqual(['c2', 'c3'])

    w.rpg.inv.add('it_bell_tongue', 1) // 去钟坠院把首钟的断舌取回来
    w.session.close()
    w.session.open('npc_belltongue')
    expect(w.last().choices.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
    w.session.choose('c1') // 「断面是从里往外炸的。我看了。」
    expect(w.streaming.hasFlag('flag.bell_tongue_examined')).toBe(true)
    // 旗标是**任务步的读方**：立起来的那一刻，任务自己往前走一步
    expect(w.quests.state('q_bells')).toBe('BELLS.STEP1_JUDGED')
    w.session.close()
    w.off()
  })

  it('分支收敛：告诉 / 隐瞒 两条路各自立旗，都推进同一步（多结果不是多任务）', () => {
    const w = makeWorld()
    w.session.open('npc_belltongue')
    w.session.choose('c1')
    w.session.close()
    w.rpg.inv.add('it_bell_tongue', 1)
    w.session.open('npc_belltongue')
    w.session.choose('c1') // → n6（决断）
    expect(w.last().nodeId).toBe('n6')
    w.session.choose('c2') // 隐瞒
    expect(w.streaming.hasFlag('flag.belltongue_hidden')).toBe(true)
    expect(w.streaming.hasFlag('flag.belltongue_told')).toBe(false)
    // 初见直答 +1、说出断面 +1、隐瞒 −1 ⇒ 沉默确实要付代价（-1），但不是清零
    expect(w.quests.relation('npc_belltongue'), '沉默要付关系代价').toBe(1)
    expect(w.quests.state('q_bells')).toBe('BELLS.STEP2_OPEN')
    w.session.close()
    w.off()
  })

  it('交付类效果真的动背包：科温收下振源核（takeItem 有消费方）', () => {
    const w = makeWorld()
    w.session.open('npc_corvin')
    w.session.choose('c1') // 「什么价钱？」
    w.session.choose('c1') // 「成交。」—— 接委托与立"契约已签"的旗是同一次选择，所以当场推进到第二步
    expect(w.quests.state('q_corvin')).toBe('CORVIN.STEP2_DELIVER')
    w.session.close()

    w.rpg.inv.add('it_resonance_core', 1)
    w.session.open('npc_corvin')
    const before = w.rpg.inv.count('it_resonance_core')
    w.session.choose('c1') // 「（把振源核放在桌上）」
    expect(w.rpg.inv.count('it_resonance_core')).toBe(before - 1)
    expect(w.last().nodeId).toBe('n6')
    w.session.close()
    w.off()
  })

  it('同一次选择里「接委托 + 立第一步的旗」⇒ 任务要真的走到第二步（结算顺序的回归）', () => {
    const w = makeWorld()
    w.session.open('npc_meg')
    w.session.choose('c1') // 「你认识她。」
    w.session.choose('c1') // 「……这里。休垒。」—— 这一条同时 startQuest 与立 flag.meg_first_fragment
    expect(w.streaming.hasFlag('flag.meg_first_fragment')).toBe(true)
    // 旗标是第一步的 advanceOn：任务必须先被建立，旗标才落得到这一步上（否则玩家"接了委托却一步没走"）
    expect(w.quests.state('q_meg')).toBe('MEG.STEP2_EXCHANGE')
    w.session.close()
    w.off()
  })

  it('没有可说的内容时明确返回 false（不弹空对话框、不改世界）', () => {
    const w = makeWorld()
    expect(w.session.open('npc_nobody')).toBe(false)
    expect(w.session.isTalking).toBe(false)
    expect(w.isPaused()).toBe(false)
    expect(w.views).toHaveLength(0)
    w.off()
  })

  it('存档 v7 往返：任务步 / 关系 / 已读节点都回来，且初见节点不重演', async () => {
    const w = makeWorld()
    w.session.open('npc_belltongue')
    w.session.choose('c1')
    w.session.close()
    w.rpg.inv.add('it_bell_tongue', 1)
    w.session.open('npc_belltongue')
    w.session.choose('c1')
    w.session.close()
    expect(w.quests.state('q_bells')).toBe('BELLS.STEP1_JUDGED')

    const store = new MapStore()
    const saves = new SaveGame({ player: w.player, streaming: w.streaming, spawner: w.spawner, clock: w.rhythm, time: w.time, rpg: w.rpg, quests: w.quests }, store)
    const snap = await saves.save('slot1')
    expect(snap.version).toBe(SAVE_VERSION)
    expect(snap.quest).not.toBeNull()

    const w2 = makeWorld()
    const loads = new SaveGame({ player: w2.player, streaming: w2.streaming, spawner: w2.spawner, clock: w2.rhythm, time: w2.time, rpg: w2.rpg, quests: w2.quests }, store)
    expect(await loads.load('slot1')).not.toBeNull()
    expect(w2.quests.state('q_bells')).toBe('BELLS.STEP1_JUDGED')
    expect(w2.quests.relation('npc_belltongue')).toBe(2)
    expect(w2.streaming.hasFlag('flag.belltongue_met')).toBe(true)

    // 读档后再找她说话：初见那一段不该重演（条件 + 已读缓存两道都在）
    w2.session.open('npc_belltongue')
    expect(w2.last().nodeId).toBe('n5')
    w2.session.close()
    w.off()
  })

  it('NPC 交互本身不设旗标：世界只被对话里的选择改动（按 E 不等于签合同）', () => {
    const w = makeWorld()
    const npc = w.interact.get('npc_belltongue')!
    const id = takeInteractEdge(new Set(['interact']), npc)
    expect(id).toBe('npc_belltongue')
    // 走一遍"交互 → 开会话"的编排（main.ts 里就是这么接的），但**不做任何选择**
    const r = w.interact.use('npc_belltongue', { ...npc.pos })
    expect(r.ok).toBe(true)
    expect(r.npcId).toBe('npc_belltongue')
    expect(w.flagEvents).toEqual([])
    expect(w.quests.state('q_bells')).toBeNull()
    w.off()
  })

  it('五条线都有人发布、每个发布者都有自己的对话树（数据层对账的运行时版）', () => {
    const w = makeWorld()
    const publishers = new Set(dialogues.map((d) => d.npc))
    for (const q of questTable) expect(publishers.has(q.npc), `${q.id} 的发布者 ${q.npc} 没有对话树`).toBe(true)
    // 每条线的第一步都必须真的能被走到：开局全部未开始
    for (const q of questTable) expect(w.quests.state(q.id)).toBeNull()
    w.off()
  })

  it('音色晶/回响膏这类消耗品与叙事互不干扰（背包是同一个，但改写它的路径只有一条）', () => {
    const w = makeWorld()
    const item = registry.get<ItemData>('it_echo_salve')
    expect(item.kind).toBe('consumable')
    w.rpg.inv.add('it_echo_salve', 1)
    w.session.open('npc_meg')
    w.session.choose('c1') // 「你认识她。」→ 她才肯赊第一段记忆
    w.session.choose('c1') // 「……这里。休垒。她一直守在自家门口。」← 答对录音地点，第一步当场完成
    expect(w.quests.state('q_meg')).toBe('MEG.STEP2_EXCHANGE')
    expect(w.rpg.inv.count('it_echo_salve'), '对话不该碰无关物品').toBe(1)
    w.session.close()
    w.off()
  })
})
