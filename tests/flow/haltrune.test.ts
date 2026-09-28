import { describe, expect, it } from 'vitest'
import { registerGameData, regions, dialogues, quests as questTable, worldStates } from '@/data'
import { StreamingSystem } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import { AISystem } from '@/ai/AISystem'
import { Quests } from '@/quest/Quests'
import { WorldStates } from '@/quest/WorldStates'
import { DialogueEngine, type DialogueContext, type DialogueView } from '@/quest/Dialogue'
import { DialogueSession } from '@/quest/Settlement'
import { Inventory } from '@/rpg/Inventory'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * 断弦线步 2/3（narrative §2.4《点名册》与营地定性，§7 `STATE.CAMP`）。
 *
 * 这一批把「尸体军阵的巡逻」接到一个**真的会改世界**的抉择上：替断弦填名册 = 给营地定性，
 * 三种写法各是终幕入场编排的一根线。四条设计承诺在这里被钉住：
 *
 * 1. **步 1 靠机制推进**：只有以纯闪避走完整圈（旗标 `flag.haltrune_patrol_seen`）才开《点名册》；
 *    仅仅"见过面"不算——那时复访给的是中立的那句，不是"名册的事，你想好了吗？"。
 * 2. **决断只由值域承载**：`state.haltrune.camp = OUTPOST/RUINS/GARRISON` 是营地归属的唯一读数，
 *    不另立一枚与它 1:1 重复的旗标（"两条同时立起来时世界是哪一种"就是值域表要消灭的局面）。
 * 3. **派生的后果**：真正动手改世界的几个读方（出怪表的 `!flag.brokenbar_resolved`、营地仓库箱的
 *    `requiresFlag`）只认旗标字符串 ⇒ 由抉择**派生**那面旗，而不是把 Decide 记两遍。
 * 4. **末步 ≠ 完成**：营地定性把线推到《最后一班岗》（`HALTRUNE.STEP3_LASTWATCH`），
 *    那一步没有 `advanceOn` ⇒ `isComplete` 必须是 false——停在末步意味着任务**正在进行**。
 */

function makeWorld() {
  registerGameData()
  const streaming = new StreamingSystem(regions)
  const quests = new Quests(questTable, () => {}, (k) => streaming.hasFlag(k))
  const states = new WorldStates(worldStates)
  const engine = new DialogueEngine(dialogues, quests)
  const inv = new Inventory('haltrune')
  const ctx: DialogueContext = {
    hasFlag: (k) => streaming.hasFlag(k),
    relation: (npc) => quests.relation(npc),
    questState: (id) => quests.state(id),
    questIndex: (id) => quests.stepIndex(id),
    hasItem: (id, count = 1) => inv.count(id) >= count,
    hasSeen: (d, n) => quests.hasSeen(d, n),
    state: (k) => states.get(k),
  }
  const views: DialogueView[] = []
  const session = new DialogueSession({
    quests, engine, ctx, inv,
    setFlag: (k, v) => streaming.setFlag(k, v),
    setState: (k, v) => states.set(k, v),
    notify: () => {},
    refresh: () => {},
    setPaused: () => {},
    present: (v) => { if (v) views.push(v) },
  })
  const last = (): DialogueView => views[views.length - 1]
  const cleanup = (): void => { session.close(); states.dispose(); quests.dispose(); streaming.dispose() }
  /** 走完一遍巡逻（初见 → 跟队 → 一整圈），返回落到步 2 的世界 */
  const walkPatrol = (): void => {
    session.open('npc_haltrune')
    session.choose('c1') // 我不打断他们
    session.choose('c1') // （跟着他们，走完一整圈）
    session.close()
  }
  /** 替他填名册：c1/c2/c3 = 友军哨站 / 废墟 / 恩希尔驻防地 */
  const fillRoster = (choice: string): void => {
    session.open('npc_haltrune')
    session.choose('c2') // （把名册还给他）
    session.choose(choice)
    session.close()
  }
  return { streaming, quests, states, session, views, last, cleanup, walkPatrol, fillRoster }
}

describe('断弦线《点名册》：营地归属是一次真的三选一', () => {
  it('仅仅"见过面"不算走完巡逻：那时复访不给名册，只给中立的那句', () => {
    const w = makeWorld()
    w.session.open('npc_haltrune')
    expect(w.last().nodeId).toBe('n0')
    w.session.choose('c2') // 死人该躺下 ⇒ 只立"见过面"
    expect(w.streaming.hasFlag('flag.haltrune_met')).toBe(true)
    expect(w.streaming.hasFlag('flag.haltrune_patrol_seen')).toBe(false)
    w.session.close()

    w.session.open('npc_haltrune')
    expect(w.last().nodeId, '名册还没开张 ⇒ 落在中立节点上').toBe('n10')
    expect(w.last().text).not.toContain('名册的事')
    expect(w.last().choices).toEqual([])
    w.cleanup()
  })

  it('走完巡逻 ⇒ 步 2《点名册》；三选一写到 state.haltrune.camp 并把线推到《最后一班岗》', () => {
    const w = makeWorld()
    w.walkPatrol()
    expect(w.streaming.hasFlag('flag.haltrune_patrol_seen')).toBe(true)
    expect(w.quests.state('q_haltrune'), '旗标是任务步的读方').toBe('HALTRUNE.STEP2_ROSTER')

    w.session.open('npc_haltrune')
    expect(w.last().nodeId).toBe('n5')
    expect(w.last().choices.map((c) => c.id)).toEqual(['c1', 'c2'])
    w.session.choose('c2') // （把名册还给他）
    expect(w.last().nodeId).toBe('n6')
    expect(w.last().choices.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])

    w.session.choose('c1') // 归还给休垒 —— 友军哨站
    expect(w.states.get('state.haltrune.camp')).toBe('OUTPOST')
    expect(w.quests.state('q_haltrune'), '营地既定 ⇒ 线往前走到最后一班岗').toBe('HALTRUNE.STEP3_LASTWATCH')
    expect(w.quests.isComplete('q_haltrune'), '最后一班岗还没演 ⇒ 不许算收束').toBe(false)
    expect(w.last().nodeId, '后果句').toBe('n7')
    expect(w.last().text).toContain('友军哨站')

    w.session.advance() // 效果句走完 ⇒ 落到复访的中立末节点
    expect(w.last().nodeId).toBe('n10')
    w.cleanup()
  })

  it('三种写法各写各的值（并派生各自的后果旗标），决定之后不可回退', () => {
    //                选项  读数        后果句  关键词     营地不再有守军
    const cases: Array<[string, string, string, string, boolean]> = [
      ['c1', 'OUTPOST', 'n7', '友军哨站', true], // 收编 ⇒ 军阵安息
      ['c2', 'RUINS', 'n8', '废墟', true], // 清算 ⇒ 营地空了
      ['c3', 'GARRISON', 'n9', '驻防地', false], // 留给恩希尔 ⇒ 守军还在
    ]
    for (const [choice, value, node, needle, resolved] of cases) {
      const w = makeWorld()
      w.walkPatrol()
      w.fillRoster(choice)
      expect(w.states.get('state.haltrune.camp'), `${choice} ⇒ ${value}`).toBe(value)
      expect(w.last().nodeId).toBe(node)
      expect(w.last().text).toContain(needle)
      // 派生旗标：出怪表与仓库箱只认旗标，不认值域
      expect(w.streaming.hasFlag('flag.brokenbar_resolved'), `${value} ⇒ resolved=${resolved}`).toBe(resolved)

      w.session.open('npc_haltrune')
      expect(w.last().nodeId, '复访还是那一句后果').toBe(node)
      expect(w.last().choices, '名册交出去了 ⇒ 这里没有可选项').toEqual([])
      expect(w.states.get('state.haltrune.camp'), '值不会被第二次决定改写').toBe(value)
      w.session.close()
      w.cleanup()
    }
  })

  it('营地既定 ⇒ 尸体军阵真的停摆（值域 → 派生旗标 → 出怪表那个既有读方的现场量法）', () => {
    const w = makeWorld()
    const ai = new AISystem()
    const dir = new SpawnDirector(regions, {
      spawn: (id, pos, sd) => ai.spawn(id, pos, sd),
      despawn: (id) => ai.despawn(id),
      hasFlag: (k) => w.streaming.hasFlag(k),
    }, (p: Vec3) => { const c = w.streaming.cellOf(p); return `${c.cx},${c.cy},${c.cz}` })
    w.streaming.setFlag('flag.left_resthold') // 破拍营地那一片的 unlockFlag
    const CAMP: Vec3 = { x: -80, y: 0, z: -200 }
    const FAR: Vec3 = { x: 900, y: 0, z: 900 }
    // 进出激活圈走的是 `world.chunk` 事件（active ⇒ spawn、其余 ⇒ recall），
    // 与 main.ts 同一条路：所以这里只 teleport + syncActive，不手动删敌人。
    const syncAt = (p: Vec3): void => {
      w.streaming.teleport(0, p)
      dir.syncActive(w.streaming.byState('active').map((c) => c.key))
    }
    const murkshells = (): number => ai.enemies.filter(
      (e) => e.data.id === 'en_murkshell' && Math.hypot(e.pos.x - CAMP.x, e.pos.z - CAMP.z) < 24,
    ).length

    syncAt(CAMP)
    expect(murkshells(), '还没抉择的世界：那队兵照旧在营地里走').toBeGreaterThanOrEqual(4)

    w.walkPatrol()
    w.fillRoster('c1') // 收编 —— 归还给休垒
    expect(w.streaming.hasFlag('flag.brokenbar_resolved'), '值域定了 ⇒ 派生旗标跟着立').toBe(true)

    syncAt(FAR) // 走开：活跃圈里的敌人被收回去
    expect(murkshells(), '离开营地 ⇒ 活着的那些先撤回').toBe(0)
    syncAt(CAMP) // 再进来：这一趟只按**现在的**条件刷
    expect(murkshells(), '营地归了休垒 ⇒ 这组不再落地（副官那组没有条件，与本次无关）').toBe(0)
    dir.dispose()
    w.cleanup()
  })

  it('营地归属只有值域一个抉择记录：不再另立一枚与它 1:1 重复的旗标', () => {
    const w = makeWorld()
    w.walkPatrol()
    w.fillRoster('c3')
    expect(w.states.get('state.haltrune.camp')).toBe('GARRISON')
    expect(w.streaming.hasFlag('flag.haltrune_camp_decided'), '抉择记两遍 = 两个真值').toBe(false)
    w.cleanup()
  })
})
