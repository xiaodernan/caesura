import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { ItemData, MovesetData, ProgressionData, WeaponData } from '@/data/schema'
import { resolveDamage } from '@/combat/DamagePipeline'
import { CHARGE_TICKS, PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import type { Enemy } from '@/ai/Enemy'
import { CombatManager } from '@/combat/CombatManager'
import { StreamingSystem, chunkKeyOf } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import { Interactables } from '@/world/Interactables'
import { RpgRuntime } from '@/rpg/Runtime'
import { itemOf } from '@/rpg/Inventory'
import { KillSettlement, openLootTable, refreshPlayer, gearLabel, type SettlementDeps } from '@/rpg/Settlement'
import { SaveGame, MapStore, SAVE_VERSION } from '@/save/Serializer'
import { Checkpoints } from '@/save/Checkpoint'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * G5 出口验收（production-plan §5：「升级→加点→装备→掉落→强化 闭环自动化测试通过」）。
 *
 * 和 `rpg.test.ts` 的分工是**入口不同**：那份从 `rpg.onEnemyKilled()` 这类中间 API 进去，快而直接；
 * 这份只准从两个入口进——**输入帧**（移动/攻击键）和**事件**（`entity.died`），
 * 中间那串胶水（谁进背包、谁灌回面板、什么时候该存档）一律不许测试自己代劳。
 * 那串胶水本身此刻也搬进了逻辑层（`rpg/Settlement.ts`），所以它是可测的——这正是 G5 的前提。
 *
 *   ① 一条链：Start → 战斗 → 掉落 → 升级 → 拾取 → 装备 → 强化 → 存档 → 重载 → 数值一致
 *   ② 力 / 律 Build 对照：同一颗种子、同一份输入脚本，两种节奏
 *   ③ 掉落评审（数据侧）在 `tests/unit/loot-pity.test.ts`
 *   ④ 杀进程重开：亏掉的进度恰好等于「上一个检查点之后」那一截
 */

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

function makeWorld(originId = 'origin_tuner', seed: number | string = 0x51f3a2, store = new MapStore()) {
  registerGameData()
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime(originId, seed)
  const weapon = registry.get<WeaponData>(rpg.mods().weaponId!)
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const streaming = new StreamingSystem(regions)
  const cellKey = (p: Vec3): string => { const c = streaming.cellOf(p); return chunkKeyOf(c.cx, c.cy, c.cz) }
  const spawner = new SpawnDirector(regions, {
    spawn: (id, pos, s) => ai.spawn(id, pos, s),
    despawn: (id) => ai.despawn(id),
    hasFlag: (k) => streaming.hasFlag(k)
  }, cellKey)
  // 区域闸门全开：这里测的是成长链，通路本身由 world/spawn 那两份 flow 看着
  const interact = new Interactables(regions, () => true)

  const saves = new SaveGame({ player, streaming, spawner, clock: rhythm, time, rpg }, store)
  const ck = new Checkpoints(saves)
  const reasons: string[] = []
  let refreshes = 0
  const deps: SettlementDeps = {
    rpg,
    refresh: () => { refreshes++; refreshPlayer(rpg, player) },
    checkpoint: (r) => { reasons.push(r); ck.request(r) }
  }
  const settlement = new KillSettlement(deps)

  const notes: string[] = []
  const hits: { damage: number; victim: string }[] = []
  const offs = [
    bus.on('ui.notify', (p) => { notes.push(p.text) }),
    // 只记玩家砍出去的有效命中（敌人出手、弹反、格挡都不算）
    bus.on('combat.hit', (p) => { if (p.attackerId === 'player' && p.result === 'hit') hits.push({ damage: p.damage, victim: p.victimId }) })
  ]
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  refreshPlayer(rpg, player)

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }

  /**
   * 走近 + 有空就轻击，直到目标倒地。返回用了多少 tick。
   * 每 tick 回满血：这一层测的是"打完之后系统记住了什么"；生存压力由 combat/status 那两份看着。
   */
  function fight(e: Enemy, budget = 4000): number {
    let t = 0
    for (; t < budget && e.alive; t++) {
      player.stats.hp = player.stats.hpMax
      const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z)
      frame.move = d > 1.6 ? { x: 0, y: 1 } : { x: 0, y: 0 }
      const a = Math.atan2(e.pos.x - player.pos.x, e.pos.z - player.pos.z)
      player.yaw = a
      player.camYawRef = Math.PI + a
      if (player.action === null && player.stats.stamina > 12 && d < 2.4) frame.edges.add('attackLight')
      tick()
    }
    frame.move = { x: 0, y: 0 }
    tick(30) // 等死亡结算与掉落播报落定
    return t
  }

  /** 打死一只。spawn 用的是同一个 tag ⇒ 同一颗敌人种子 ⇒ 同一套出招节奏 */
  function killOne(id = 'en_murkshell', tag = 'g5'): Enemy {
    const e = ai.spawn(id, { x: 0, y: 0, z: -6 }, tag)
    e.skipIntro() // §16 入场演出由 bossshow.test.ts 看着；这里要测的是结算链
    fight(e)
    return e
  }

  /**
   * 站桩对砍一个**固定窗口**（KI-039 的第二条腿）：目标血量每 tick 顶满 ⇒ 它死不了，
   * 于是量的是"这段时间里打掉多少"而不是"多少 tick 打完"——高甲目标的通关节奏被
   * 机制（正面钟甲 ×0.6、碎甲时机）主导，用死亡时间当尺子会把定价与机制混成一坨。
   * 输入侧仍只走两个合法入口：轻击按边沿，蓄力按长按 + 松开（`charging` 那条分支）。
   */
  /**
   * 站桩对砍一个**固定窗口**（KI-039 的第二条腿）：目标血量每 tick 顶满 ⇒ 它死不了，
   * 于是量的是"这段时间里打掉多少"而不是"多少 tick 打完"——高甲目标的通关节奏被
   * 机制（正面钟甲 ×0.6、碎甲时机）主导，用死亡时间当尺子会把定价与机制混成一坨。
   *
   * **输入是自适应的，不是按绝对 tick 排的**（KI-017 第二步的量具前置）。旧脚本写的是
   * `if (i % 300 < 60) held.add('attackHeavy')`，也就是"窗口第 300 格起按住 60 格"。只要
   * 这一记的收招被任何机制拉长（命中停顿、闷音、被顶一下），那 60 格就整个落进恢复里被吞掉——
   * 实测同一把尺子下蓄力次数 3→1、力/律节奏比从 1.40 掉到 0.87，量的就不再是节奏而是脚本的相位。
   * 现在两张腿共用同一张**尝试表**（每 CHARGE_EVERY 格起一次蓄力），按住直到真的攒满放出蓄力、
   * 或者这一轮确实没机会（超时作废）。于是"收招被拉长"只推迟下一次出手，不会让它消失。
   */
  const CHARGE_EVERY = 300
  const CHARGE_GIVEUP = CHARGE_TICKS * 3
  function brawl(e: Enemy, ticks: number): { damage: number; hits: number; charges: number; armorBrokenAt: number | null; perTick: number } {
    const tick0 = time.tick
    const from = hits.length
    let armorBrokenAt: number | null = null
    let charges = 0
    let wasCharging = false
    let nextAttempt = 0
    let holding = -1
    for (let i = 0; i < ticks && e.alive; i++) {
      player.stats.hp = player.stats.hpMax
      e.stats.hp = e.stats.hpMax // 死不了的量具：击倒/退避都不会提前结束窗口
      const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z)
      frame.move = d > 1.6 ? { x: 0, y: 1 } : { x: 0, y: 0 }
      const a = Math.atan2(e.pos.x - player.pos.x, e.pos.z - player.pos.z)
      player.yaw = a
      player.camYawRef = Math.PI + a
      frame.held.clear()
      const free = player.action === null && player.roll === null && player.stats.stamina > 12 && d < 2.4
      const charged = player.charging && player.chargeTicks >= CHARGE_TICKS
      if (holding < 0 && i >= nextAttempt) { holding = i; nextAttempt = i + CHARGE_EVERY }
      if (holding >= 0) {
        if (charged) { /* 这一 tick 不喂 held ⇒ 松开就是蓄力那一记 */ }
        else frame.held.add('attackHeavy')
      } else if (free) frame.edges.add('attackLight')
      tick()
      if (holding >= 0 && (charged || (i - holding >= CHARGE_GIVEUP && !player.charging))) holding = -1
      const charging = player.action?.key === 'charged'
      if (charging && !wasCharging) charges++
      wasCharging = charging
      if (armorBrokenAt === null && e.armorBroken) armorBrokenAt = time.tick - tick0
    }
    const mine = hits.slice(from).filter((h) => h.victim === e.id) // 敲钟召来的帮手不算进这只的账
    const damage = mine.reduce((s, h) => s + h.damage, 0)
    const span = time.tick - tick0
    return { damage, hits: mine.length, charges, armorBrokenAt, perTick: damage / Math.max(1, span) }
  }

  /** 走到最近一个挂着该表的交互物前按下交互键（真入口：Interactables.use → lootTable） */
  function openChest(lootTable: string): boolean {
    const target = interact.all.find((i) => i.lootTable === lootTable)
    if (!target) throw new Error(`gate5: regions.json 里没有挂 ${lootTable} 的交互物`)
    player.pos.x = target.pos.x
    player.pos.y = target.pos.y
    player.pos.z = target.pos.z
    const r = interact.use(target.id, player.pos)
    if (r.ok && r.lootTable) openLootTable(deps, r.lootTable)
    return r.ok
  }

  const dispose = (): void => { for (const o of offs) o(); settlement.dispose() }
  alive.push(dispose)
  return {
    time, rhythm, rpg, player, ai, combat, streaming, spawner, interact, saves, store, ck, deps,
    notes, hits, reasons, tick, fight, killOne, brawl, openChest, dispose,
    refreshes: () => refreshes,
    gear: (uid: string): ItemData | undefined => {
      const g = rpg.inv.gearByUid(uid)
      return g ? itemOf(g.itemId) : undefined
    }
  }
}

type World = ReturnType<typeof makeWorld>

const modsNumbers = (w: World): string => JSON.stringify(w.rpg.mods())

describe('G5① 整链闭环：只在输入帧与事件两个入口上进出', () => {
  it('Start → 战斗 → 掉落 → 升级 → 拾取 → 装备 → 强化 → 存档 → 重载 → 数值一致', async () => {
    const w = makeWorld()
    expect(w.rpg.prog.rank, 'Start：出身就是 1 级').toBe(1)
    const startUids = new Set(w.rpg.inv.gears.map((g) => g.uid))
    const timbiteAtStart = w.rpg.inv.count('it_timbite')

    // —— 战斗 + 掉落 + 升级：只喂输入帧，进背包这一步由 KillSettlement 在 entity.died 上做
    let kills = 0
    while (w.rpg.prog.rank === 1 && kills < 12) { w.killOne('en_murkshell', `g5-kill-${kills++}`) }
    expect(kills, '六只嘈壳的遗响够升一级（rankCurve[2] = 60）').toBeGreaterThan(0)
    expect(w.rpg.prog.rank).toBe(2)
    expect(w.rpg.prog.unspent, '升级发的是音级点，不是自动加点').toBe(1)
    expect(w.notes.some((n) => n.startsWith('遗响 +')), '遗响有播报').toBe(true)
    expect(w.rpg.inv.count('it_timbite'), '音色石真的进了背包').toBeGreaterThan(timbiteAtStart)
    expect(w.reasons, '升级这一刻是 §71 的检查点之一').toContain('levelup')
    expect(w.refreshes(), '每一笔结算都灌回过一次面板').toBeGreaterThan(0)

    // —— 装备：把打出来的那一件穿上（保底保证 11 只内必出一件，这里给到 18 只的余量）
    let dropped = w.rpg.inv.gears.filter((g) => !startUids.has(g.uid))
    for (let i = 0; dropped.length === 0 && i < 12; i++) {
      w.killOne('en_murkshell', `g5-gear-${i}`)
      dropped = w.rpg.inv.gears.filter((g) => !startUids.has(g.uid))
    }
    expect(dropped.length, `${kills + 12} 只还没掉出一件装备 ⇒ 装备档没接线`).toBeGreaterThan(0)
    const item = itemOf(dropped[0].itemId)
    expect(w.rpg.equip(dropped[0].uid).ok, `${item.displayName} 穿不上`).toBe(true)
    w.deps.refresh()
    expect(Object.values(w.rpg.eq.slots), `${item.displayName} 该出现在某个槽位里`).toContain(dropped[0].uid)
    // 掉的很可能就是出身那套的同款——同款换同款面板当然不动。要钉住"装备这一步有效"，
    // 就得换一件确实不同的：开一张隐藏房表（§4.1 T4 硬规则：稀有起步），那件必然不是初装档
    const gearGrant = openLootTable(w.deps, 'loot_secret_nave').find((g) => g.type === 'gear')
    expect(gearGrant, '隐藏房表要掉得出装备件').toBeDefined()
    const rare = itemOf(w.rpg.inv.gearByUid(gearGrant!.id)!.itemId)
    expect(rare.gear!.rarity, '隐藏房掉出的档位').not.toBe('common')
    const modsBefore = modsNumbers(w)
    expect(w.rpg.equip(gearGrant!.id).ok, `${rare.displayName} 穿不上`).toBe(true)
    w.deps.refresh()
    expect(modsNumbers(w), `换上${item.displayName}→${rare.displayName}必须真的改变面板`).not.toBe(modsBefore)
    expect(w.notes.some((n) => n.startsWith('获得')), '掉落有播报').toBe(true)

    // —— 拾取：走交互物（遗箱），拿到强化要的残晶
    for (let i = 0; w.rpg.inv.count('it_dross') < 1 && i < 6; i++) w.openChest('loot_chest_t1')
    expect(w.rpg.inv.count('it_dross'), '箱子里真的掉出了残晶').toBeGreaterThanOrEqual(1)
    expect(w.rpg.inv.count('it_timbite'), '+1 要 20 石').toBeGreaterThanOrEqual(20)

    // —— 强化：用捡来的材料把手里那把剑顶一级，并确认乘数走进了玩家面板
    const weaponUid = w.rpg.eq.slots.weapon!
    const lvBefore = w.rpg.inv.gearByUid(weaponUid)!.level
    const up = w.rpg.upgrade(weaponUid)
    expect(up.ok, `强化失败：${up.reason}`).toBe(true)
    expect(w.rpg.inv.gearByUid(weaponUid)!.level).toBe(lvBefore + 1)
    expect(gearLabel(w.rpg, weaponUid), '播报要带强化等级').toMatch(/\+1$/)
    w.deps.refresh()
    expect(w.player.rpg.weaponDamageMul, '强化真的走进了伤害通道').toBeGreaterThan(1)
    expect(w.player.rpg.weaponDamageMul).toBe(w.rpg.mods().weaponDamageMul)

    // —— 存档 → 重载：整份成长状态一字不差，派生值也一样
    const snapBefore = structuredClone(w.rpg.snapshot())
    const modsAtSave = modsNumbers(w)
    const saved = await w.saves.save('autosave')
    expect(saved.rpg).not.toBeNull()
    expect(saved.version).toBe(SAVE_VERSION)

    const w2 = makeWorld('origin_tuner', 0x51f3a2, w.store)
    const back = await w2.saves.load('autosave')
    expect(back).not.toBeNull()
    expect(structuredClone(w2.rpg.snapshot()), '读档后的成长状态必须与落盘那一刻逐字段相等')
      .toEqual(snapBefore)
    w2.deps.refresh()
    expect(modsNumbers(w2), '面板数值一致').toBe(modsAtSave)
    expect(w2.player.weapon.id, '重载后手里那把剑还得是那把剑（refresh 认装备栏，不认存档文本）')
      .toBe(w.player.weapon.id)
    expect(w2.rpg.loot.isFirstKill('en_murkshell'), '首杀记录跟着档走').toBe(false)
  })

  it('掷骰位置跟着档走：读档后再掉一串，和不断档那一局掉得一模一样（§10 可复现 QA）', async () => {
    const through = makeWorld('origin_tuner', 'gate5-seed')
    const seq = (times: number): string[] => {
      const out: string[] = []
      for (let i = 0; i < times; i++) {
        for (const g of through.rpg.loot.grant('loot_chest_t1')) out.push(`${g.type}:${g.name}:${g.count}`)
      }
      return out
    }
    seq(7) // 先走 7 次：这一段是"存档之前"
    const snapshot = structuredClone(through.rpg.snapshot())
    await through.saves.save('roll')
    const tail = seq(9) // 不断档继续掉 9 次

    // 换一颗种子开档再读回来：读档必须把掷骰位置也换过来，否则这一段会重放开头那几发
    const reloaded = makeWorld('origin_tuner', 'a-different-seed', through.store)
    expect(await reloaded.saves.load('roll')).not.toBeNull()
    expect(JSON.stringify(reloaded.rpg.snapshot()), '读档那一刻的状态 == 落盘那一刻（含 rng 抽到第几笔）')
      .toBe(JSON.stringify(snapshot))
    const after: string[] = []
    for (let i = 0; i < 9; i++) {
      for (const g of reloaded.rpg.loot.grant('loot_chest_t1')) after.push(`${g.type}:${g.name}:${g.count}`)
    }
    expect(after, '读档续上的这一串 == 不断档的那一串').toEqual(tail)
  })
})

describe('G5④ 杀进程重开：亏掉的进度恰好是"上一个检查点之后"那一截', () => {
  it('升级检查点之后继续打，再强杀进程 ⇒ 回到检查点那一刻，亏的不到一级', async () => {
    const w = makeWorld()
    let kills = 0
    while (w.rpg.prog.rank === 1 && kills < 12) w.killOne('en_murkshell', `crash-${kills++}`)
    await w.ck.flush() // 检查点落盘（真机里是同一帧之后的异步排队）

    const cp = structuredClone(w.rpg.snapshot())
    expect(w.reasons, '升级这一刻按 §71 存了一笔').toContain('levelup')
    expect(cp.progression.rank).toBe(2)

    // 检查点之后又打了一截——然后进程被杀，没人再存过盘
    for (let i = 0; i < 4; i++) w.killOne('en_murkshell', `after-${i}`)
    expect(w.rpg.prog.rank, '这四只不该再升一级：否则"检查点之后"就没有对照物了').toBe(2)
    const banked = w.rpg.prog.xp - cp.progression.xp
    expect(banked, '检查点之后确实又攒了一截（不然这条测试是在自证）').toBeGreaterThan(0)

    const w2 = makeWorld('origin_tuner', 0x51f3a2, w.store)
    expect(await w2.saves.load('autosave'), '杀进程后能读回最后那个检查点').not.toBeNull()
    expect(structuredClone(w2.rpg.snapshot()), '整份状态回到检查点那一刻，不多一格不少一格').toEqual(cp)
    const nextRank = registry.get<ProgressionData>('progression').rankCurve.find((r) => r.rank === 3)!.xp
    expect(banked, `一次崩溃最多吞掉 ${banked} 点遗响，而升一级要 ${nextRank}`).toBeLessThan(nextRank)
    expect(w2.rpg.inv.count('it_timbite'), '材料也只回到检查点').toBe(
      cp.inventory.stacks.find((s) => s.itemId === 'it_timbite')?.count ?? 0)
  })
})

describe('G5② 力 / 律 Build 对照：同一颗种子、同一份输入脚本', () => {
  /** 固定遭遇：同一只敌人、同一个出生 tag ⇒ 同一套出招节奏；两边只差在建卡 */
  function encounter(originId: string, spend: 'str' | 'dex') {
    const w = makeWorld(originId, 'gate5-build')
    // 音级点全砸到一个轴上（§2.1 的两条标尺），其余口径两边完全一致
    w.rpg.prog.addResonance(400)
    while (w.rpg.prog.unspent > 0) expect(w.rpg.prog.allocate(spend)).toBe(true)
    w.deps.refresh()
    const hitsBefore = w.hits.length
    const e = w.killOne('en_tympanus', 'same-encounter')
    expect(e.alive).toBe(false)
    const mine = w.hits.slice(hitsBefore)
    const total = mine.reduce((s, h) => s + h.damage, 0)
    return {
      ticks: w.time.tick, hits: mine.length, total,
      perHit: total / Math.max(1, mine.length),
      weaponId: w.player.weapon.id, attrs: { ...w.rpg.mods().attrs },
      hpMax: w.rpg.mods().hpMax, staminaMax: w.rpg.mods().staminaMax
    }
  }

  it('力（鼓手遗孤 + 强音大剑）与律（弦坊伶人 + 引针枪）各有各的节奏，且没有一边碾压', () => {
    const li = encounter('origin_drummer', 'str')
    const lv = encounter('origin_player', 'dex')
    // 两条建卡走的是不同的伤害标尺：出手次数与单发重量必须成反比，否则"选建卡"是假的
    expect(li.perHit, `力应当更重：${li.perHit} vs ${lv.perHit}`).toBeGreaterThan(lv.perHit)
    expect(lv.hits, `律应当出手更多：${lv.hits} vs ${li.hits}`).toBeGreaterThan(li.hits)
    // KI-039 裁决后的实测（同一只驼鼓、同一颗种子、同一份输入脚本）：
    //   力 = 673 tick / 10 次命中 / 单发均伤 24.7
    //   律 = 772 tick / 19 次命中 / 单发均伤 12.8
    // 裁决前是 613 对 1221（差出 2.0×）：根因不在 `weapons.json`，而在 `movesets.json`——
    // 玩家出手的底数是**招式帧表里的 damage**（`CombatManager.strikeEnemy` 拿 `hb.damage`），
    // 而轻击家族当时是 8 伤 / 37 tick、重击 24 伤 / 60 tick ⇒ 每 tick 持续输出 0.22 对 0.40。
    // 单发重 3× 却只慢 1.6×，"重"就顺带把"快"也赢了。现在两边拉到 0.324 对 0.35，
    // 重量只从**架势（22 对 5）、体力（18 对 8）、噪声（loudness 5 对 3）**这几维拿回报，
    // 不再从通关时间拿。带子按实测点取 ±35%：站桩对砍结构性地偏袒重击（脚本不吃枪的射程与
    // 风筝优势），所以 0.87 这一侧留了余量，而不是把两边伪造成一样快。
    const ratio = li.ticks / lv.ticks
    expect(ratio, `节奏比 ${ratio.toFixed(2)} 超出容忍带`).toBeGreaterThan(0.75)
    expect(ratio).toBeLessThan(1.35)
    expect(li.weaponId).not.toBe(lv.weaponId)
    expect(li.hpMax, '力那侧的腔体/负重优势要看得见').toBeGreaterThan(lv.hpMax)
  })

  it('属性点真的走进伤害通道：同一把剑只换加点方向，谁占优跟着 weapons.json 的 scaling 走', () => {
    /**
     * 纯标尺对照：把音级点一次性砸满（29 点，仍在软上限之前），走生产公式
     * （`DamagePipeline.resolveDamage`），关掉方差与暴击，只留"加点方向"这一个变量。
     */
    const oneSwing = (spend: 'str' | 'dex', weaponId: string): number => {
      const w = makeWorld('origin_tuner', 'gate5-scaling')
      w.rpg.prog.addResonance(1_000_000)
      while (w.rpg.prog.unspent > 0) expect(w.rpg.prog.allocate(spend)).toBe(true)
      w.deps.refresh()
      const weapon = registry.get<WeaponData>(weaponId)
      // 底数从**生产同一处**取：movesets.json 帧表的第一记轻击（KI-047 删掉了武器表里
      // 那件没人读的 atkBase）。本条断言只比同一把剑的加点方向，attrScale 是乘项，
      // 底数取哪一记都不改结论——但必须从帧表取，才不会再量一条生产不走的通道。
      const base = registry.get<MovesetData>(`moveset:${weapon.movesetId}`).actions['l1'].damage
      return resolveDamage({
        base, attrs: w.rpg.mods().attrs, scaling: weapon.scaling,
        defense: 0, variance: 0, critRate: 0
      }, () => 0.5).damage
    }
    // 调律剑 str 0.6 / dex 0.9 ⇒ 指法侧更重；强音大剑 str 1.15 / dex 0.25 ⇒ 基音侧更重。
    // 两条一起才说明"哪一维值钱"是武器说的，不是代码里钦定的（§55）
    expect(oneSwing('dex', 'wp_tuning_sword'), '轻剑上指法更值钱').toBeGreaterThan(oneSwing('str', 'wp_tuning_sword'))
    expect(oneSwing('str', 'wp_fortissimo_greatsword'), '重剑上基音更值钱').toBeGreaterThan(oneSwing('dex', 'wp_fortissimo_greatsword'))
  })

  it('KI-039 第二条腿：把同一把尺子换到高甲目标（悬钟骑士·正面钟甲 60°/×0.6）', () => {
    /**
     * 为什么这条不用"多少 tick 打死"当尺子：高甲目标的死亡时间被**机制**（正面 ×0.6、
     * 碎甲要震裂满 5 层，而只有 h/charged 派生带层数）主导，拿死亡时间量定价会把
     * "武器贵不贵"和"机制让不让"混成一坨。所以这里固定 1600 tick 窗口、目标血量顶满，
     * 量**这段时间真正打进去多少**，外加"甲在第几 tick 碎"。
     *
     * 实测（同一颗种子、同一份自适应输入；KI-017 第二步把量具重造之后重测的一版）：
     *   力 = 771 伤害 / 20 命中 / 6 次蓄力 / 第 393 tick 碎甲 ⇒ 0.482 伤害每 tick
     *   律 = 533 伤害 / 32 命中 / 6 次蓄力 / 第 995 tick 碎甲 ⇒ 0.333 伤害每 tick
     * 比是 **1.45**（无甲驼鼓上同一对建卡是 1.15）⇒ 高甲把重击的优势又放大了一档，
     * 而放大来自机制而不是数值偏袒：轻击一记都不带震裂层数，蓄力那记大剑带 3 层，
     * 五层就碎甲；枪的蓄力只有 2 层，所以它要攒到 995 才碎得开（出身腔体 7 对 3 也在这里还债）。
     *
     * **KI-052② 之后又重锚了一次，而且这一次动因是明确的**：§8 R2 括号里那句「招式自带 1 次 R2 免役」
     * 第一次有了消费方（`hyperLive`/`spendHyper`）之后，力那侧的 6 次蓄力斩各吃下一次钟锤打断，
     * 伤害 771→876，比值 1.45→**2.16**；同一份代码里把 §8 R1 的「不打断重击与蓄力」摘掉，读数一位不动
     * （悬钟骑士的招式没有 R1 级的那一档）——所以越过旧上界的不是"轻击线被打成废的"，
     * 而是**只有两把剑的蓄力斩声明了 hyper、枪的没有**（§4.1/§4.2 与 §4.3 的数据差）。
     * 上界因此从 2 收到 **2.3**（读数 + 约 6% 余量）而不是放开到"怎么都不红"：
     * 这条带现在防的是"再往重击侧加保护"，而它是否该给轻武线一份等价补偿，是数值裁决，登记在 KI-052 行。
     *
     * **这一版数字与上一版不同，而且上一版是量具的错**：旧脚本按绝对 tick 排按键（`i % 300 < 60` 蓄力），
     * 于是"谁的收招被拉长，谁的按键就被吞掉"——同一份脚本在力身上产生 3 次蓄力、在律身上只剩 1 次，
     * 律甚至整窗没碎甲。改成"每 300 格起一次蓄力尝试、按住直到真的攒满"之后，两条腿各拿 6 次蓄力，
     * 比值从 1.40 抬到 1.45，而**律现在也碎甲了**（晚 600 格）。"重击在甲胄上占先"这条结论没变，
     * 变的是它的程度：占先是"早 600 格"而不是"只有我能碎"。
     * 所以 KI-039 那条 [0.75, 1.35] 的节奏带**只适用于无甲目标**；两边一起看才是完整口径：
     * 重击该赢的地方（破甲、站得住）赢，不该赢的地方（单纯杀得快）不赢。
     */
    const run = (originId: string, spend: 'str' | 'dex') => {
      const w = makeWorld(originId, 'gate5-armor')
      w.rpg.prog.addResonance(400)
      while (w.rpg.prog.unspent > 0) expect(w.rpg.prog.allocate(spend)).toBe(true)
      w.deps.refresh()
      const e = w.ai.spawn('en_hanged_knight', { x: 0, y: 0, z: -6 }, 'armor')
      e.skipIntro()
      const r = w.brawl(e, 1600)
      return { weapon: w.player.weapon.id, ...r }
    }
    const li = run('origin_drummer', 'str')
    const lv = run('origin_player', 'dex')
    expect(li.perTick, '量具没打到人 ⇒ 这条断言在自证空集').toBeGreaterThan(0)
    expect(lv.perTick, '量具没打到人 ⇒ 这条断言在自证空集').toBeGreaterThan(0)
    // 重击必须能碎甲（否则 §14.7 的正面钟甲对主力建卡也不成立）
    expect(li.armorBrokenAt, '力那侧整窗没碎甲 ⇒ 蓄力/层数链断了').not.toBeNull()
    // 碎甲时刻：律没碎就记 +∞ ⇒ "重量在甲胄上占先"是可比较的，而不是一句文案
    const brokenAt = (r: { armorBrokenAt: number | null }): number => r.armorBrokenAt ?? Number.POSITIVE_INFINITY
    expect(brokenAt(lv), `律碎甲于 ${lv.armorBrokenAt}，不比力（${li.armorBrokenAt}）更晚 ⇒ 甲白叠了`).toBeGreaterThan(brokenAt(li))
    const ratio = li.perTick / lv.perTick
    expect(ratio, `高甲节奏比 ${ratio.toFixed(2)}：重击不占先=机制假，占先超过 2.3×=轻武线在高甲前是废的（上界的重锚理由与归因实测见上面的 KI-052② 段）`).toBeGreaterThanOrEqual(1)
    expect(ratio).toBeLessThanOrEqual(2.3)
  })
})
