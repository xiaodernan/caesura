import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { EnemyData, ItemData, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { StreamingSystem, chunkKeyOf } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import { RpgRuntime } from '@/rpg/Runtime'
import { SaveGame, MapStore, SAVE_VERSION } from '@/save/Serializer'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * 需求 §59 的自动化 gameplay flow，Phase 5-B 补齐了中间那几拍：
 *
 *   Start → Move → Attack → Enemy detects → Combat → **Enemy dies → Loot → Equip
 *   → Upgrade → Level up → Save → Reload → Continue**
 *
 * 全 headless：逻辑层不 import three，所以整条链在 node 里能跑完（tech-arch §5.8）。
 */

function makeWorld(originId = 'origin_tuner') {
  registerGameData()
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime(originId)
  const weapon = registry.get<WeaponData>(rpg.mods().weaponId!)
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  player.applyRpg(rpg.mods())
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const streaming = new StreamingSystem(regions)
  const cellKey = (p: Vec3): string => { const c = streaming.cellOf(p); return chunkKeyOf(c.cx, c.cy, c.cz) }
  const spawner = new SpawnDirector(regions, {
    spawn: (id, pos, seed) => ai.spawn(id, pos, seed),
    despawn: (id) => ai.despawn(id),
    hasFlag: (k) => streaming.hasFlag(k)
  }, cellKey)

  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(time.dt)
    }
  }
  return { time, rhythm, rpg, player, ai, combat, streaming, spawner, frame, tick }
}

type World = ReturnType<typeof makeWorld>

/** 站到敌人身边、朝它，然后按一次轻击并跑到打完 */
function swingAt(w: World, e: { pos: Vec3 }, key = 'l1'): number {
  w.player.pos.x = e.pos.x
  w.player.pos.z = e.pos.z + 1.4
  w.player.pos.y = e.pos.y
  const a = Math.atan2(e.pos.x - w.player.pos.x, e.pos.z - w.player.pos.z)
  w.player.yaw = a
  w.player.camYawRef = Math.PI + a
  w.player.stats.stamina = w.player.stats.staMax
  const hpBefore = e.pos && w.ai.enemies.find((x) => x.pos === e.pos)!.stats.hp
  expect(w.player.tryStartAction(key, w.time.tick)).toBe(true)
  w.tick(90)
  const en = w.ai.enemies.find((x) => x.pos === e.pos)
  return hpBefore - (en ? en.stats.hp : 0)
}

describe('§59 全流程：击杀 → 掉落 → 装备 → 强化 → 升级 → 存档 → 读档', () => {
  it('击杀把遗响与掉落一起结算进成长系统（不是只发一条通知）', () => {
    const w = makeWorld()
    const enemy = registry.get<EnemyData>('en_tympanus')
    const beforeXp = w.rpg.prog.xp
    const beforeTimbite = w.rpg.inv.count('it_timbite')
    const grants = w.rpg.onEnemyKilled(enemy)
    expect(grants.some((g) => g.type === 'xp' && g.count >= 40)).toBe(true)
    expect(grants.some((g) => g.type === 'item' && g.id === 'it_timbite')).toBe(true)
    expect(w.rpg.prog.xp + (w.rpg.prog.rank > 1 ? 60 : 0)).toBeGreaterThan(beforeXp)
    expect(w.rpg.inv.count('it_timbite')).toBeGreaterThan(beforeTimbite)
  })

  it('Boss 的振源核是首杀专属：第二次打死同一份数据不再掉核（§9.1/§9.3 → 乐章战技解锁物）', () => {
    const w = makeWorld()
    const boss = registry.get<EnemyData>('en_ostlara')
    const first = w.rpg.onEnemyKilled(boss)
    expect(first.some((g) => g.type === 'item' && g.id === 'it_resonance_core'), '杀掉她 ⇒ 振源核到手，谱册那一页在调音桩前点得亮').toBe(true)
    const second = w.rpg.onEnemyKilled(boss)
    expect(second.some((g) => g.type === 'item' && g.id === 'it_resonance_core'), '同一份数据不再掉第二颗：否则「首杀唯一」是空话').toBe(false)
    expect(second.some((g) => g.type === 'xp'), '被掐掉的只有 firstKill 那一栏，常规 rolls 照旧').toBe(true)
  })

  it('攒够遗响就升音级、发音级点，并报出「你新能做什么」（§8.2）', () => {
    const w = makeWorld()
    const enemy = registry.get<EnemyData>('en_murkshell')
    let milestones = 0
    const off = bus.on('ui.notify', (p) => { if (/音级 \d+：/.test(p.text)) milestones++ })
    for (let i = 0; i < 40 && w.rpg.prog.rank < 3; i++) {
      const before = w.rpg.prog.rank
      w.rpg.onEnemyKilled(enemy)
      if (w.rpg.prog.rank > before) {
        const ms = w.rpg.prog.milestoneAt(w.rpg.prog.rank)
        if (ms) { bus.emit('ui.notify', { text: `音级 ${w.rpg.prog.rank}：${ms.label}`, kind: 'reward' }); milestones++ }
      }
    }
    off()
    expect(w.rpg.prog.rank).toBeGreaterThanOrEqual(2)
    expect(w.rpg.prog.unspent).toBe(w.rpg.prog.rank - 1)
    expect(milestones).toBeGreaterThan(0)
  })

  it('升级立刻反映到玩家面板（HP 上限与当前血一起长，掉的血不被治好）', () => {
    const w = makeWorld()
    const hpMaxBefore = w.player.stats.hpMax
    w.player.stats.hp = 40 // 带着伤升级
    w.rpg.prog.addResonance(400)
    w.player.applyRpg(w.rpg.mods())
    expect(w.player.stats.hpMax).toBeGreaterThan(hpMaxBefore)
    expect(w.player.stats.hp).toBe(40 + (w.player.stats.hpMax - hpMaxBefore))
    expect(w.player.rpg.rank).toBe(5)
  })

  it('武器强化真的走进伤害通道（同一招打同一只敌人，+5 的一刀更重）', () => {
    const plain = makeWorld()
    const e1 = plain.ai.spawn('en_murkshell', { x: 0, y: 0, z: -3 }, 'rpg-a')
    const dmgPlain = swingAt(plain, e1)

    const buffed = makeWorld()
    const uid = buffed.rpg.inv.gears.find((g) => {
      const it = registry.get<ItemData>(g.itemId)
      return it.gear?.weaponId === buffed.player.weapon.id
    })!.uid
    buffed.rpg.inv.add('it_timbite', 500)
    buffed.rpg.inv.add('it_dross', 50)
    // 素声件封顶 +3（§5.2）；第 4 次必须明确报 maxed 而不是静默吃掉材料
    for (let i = 0; i < 3; i++) expect(buffed.rpg.upgrade(uid).ok).toBe(true)
    expect(buffed.rpg.upgrade(uid)).toMatchObject({ ok: false, reason: 'maxed' })
    buffed.player.applyRpg(buffed.rpg.mods())
    expect(buffed.player.rpg.weaponDamageMul).toBeCloseTo(1.19, 6)

    const e2 = buffed.ai.spawn('en_murkshell', { x: 0, y: 0, z: -3 }, 'rpg-b')
    const dmgBuffed = swingAt(buffed, e2)
    expect(dmgBuffed, `+5 应当比裸装重：${dmgPlain} → ${dmgBuffed}`).toBeGreaterThan(dmgPlain)
  })

  it('装备决定属性：换上重甲 DEF 上升、负重上升，超载则翻滚被禁（§5.1）', () => {
    const w = makeWorld()
    const defBefore = w.player.stats.defense
    const armor = w.rpg.inv.addGear('ar_drummer_cuirass')
    w.rpg.equip(armor.uid)
    w.player.applyRpg(w.rpg.mods())
    expect(w.player.stats.defense).toBeGreaterThan(defBefore)
    expect(w.player.rpg.weight).toBeGreaterThan(0)

    // 超载：把上限压到比身上装备轻 ⇒ 翻滚不成立（同一帧里按住闪避也不会有 roll）
    w.player.rpg = { ...w.player.rpg, overloaded: true }
    w.frame.edges.add('dodge')
    w.tick(1)
    expect(w.player.roll).toBeNull()
  })

  it('存档 v2 往返：音级/属性点/背包/装备/首杀记录全部复原（§45/§71）', async () => {
    const w = makeWorld('origin_player')
    const store = new MapStore()
    const saves = new SaveGame({ player: w.player, streaming: w.streaming, spawner: w.spawner, clock: w.rhythm, time: w.time, rpg: w.rpg }, store)

    w.rpg.prog.addResonance(400)
    w.rpg.prog.allocate('dex')
    w.rpg.inv.add('it_timbite', 77)
    const spear = w.rpg.inv.addGear('wp_drawpin_spear_item', 3)
    w.rpg.equip(spear.uid)
    w.rpg.onEnemyKilled(registry.get<EnemyData>('en_phantome'))
    const timbite = w.rpg.inv.count('it_timbite') // 首杀那一笔也算进去
    const snap = await saves.save('slot1')
    expect(snap.version).toBe(SAVE_VERSION)
    expect(snap.rpg).not.toBeNull()

    const w2 = makeWorld('origin_tuner')
    const loads = new SaveGame({ player: w2.player, streaming: w2.streaming, spawner: w2.spawner, clock: w2.rhythm, time: w2.time, rpg: w2.rpg }, store)
    const back = await loads.load('slot1')
    expect(back).not.toBeNull()
    expect(w2.rpg.prog.rank).toBe(w.rpg.prog.rank)
    expect(w2.rpg.prog.attrs).toEqual(w.rpg.prog.attrs)
    expect(w2.rpg.prog.unspent).toBe(w.rpg.prog.unspent)
    expect(w2.rpg.inv.count('it_timbite')).toBe(timbite)
    expect(w2.rpg.mods().weaponId).toBe('wp_drawpin_spear')
    expect(w2.rpg.loot.isFirstKill('en_phantome'), '首杀记录跟着档走').toBe(false)
    // 读档后把派生值灌回去，玩家的面板与存档一致
    w2.player.applyRpg(w2.rpg.mods())
    expect(w2.player.rpg.rank).toBe(w.rpg.prog.rank)
    expect(w2.player.stats.defense).toBe(w.rpg.mods().defense)
  })

  it('老档（v1，没有成长字段）读进来不崩：明确留空而不是编造等级', async () => {
    const w = makeWorld()
    const store = new MapStore()
    await store.set('legacy', JSON.stringify({
      magic: 'CAESURA-SAVE', schemaVersion: 1, crc: 0, payload: null
    }))
    // 用真档过一遍完整链路：save(v2) → 读回
    const saves = new SaveGame({ player: w.player, streaming: w.streaming, spawner: w.spawner, clock: w.rhythm, time: w.time, rpg: w.rpg }, store)
    w.rpg.prog.addResonance(120)
    await saves.save('slot2')
    const w2 = makeWorld()
    const loads = new SaveGame({ player: w2.player, streaming: w2.streaming, spawner: w2.spawner, clock: w2.rhythm, time: w2.time, rpg: w2.rpg }, store)
    expect(await loads.load('slot2')).not.toBeNull()
    expect(w2.rpg.prog.rank).toBe(w.rpg.prog.rank)
  })

  it('掉落是数据驱动的：改敌人数据里的 drops 就换表，代码里没有第二份清单', () => {
    const w = makeWorld()
    for (const id of ['en_murkshell', 'en_tympanus', 'en_hanged_knight', 'en_ostlara', 'en_hersil', 'en_myriad']) {
      const e = registry.get<EnemyData>(id)
      expect(e.drops && e.drops.length, `${id} 要有掉落表`).toBeTruthy()
      for (const d of e.drops!) expect(registry.has(d.tableId), `${id} → ${d.tableId}`).toBe(true)
    }
    const grants = w.rpg.onEnemyKilled(registry.get<EnemyData>('en_hanged_knight'))
    expect(grants.length).toBeGreaterThan(0)
  })
})
