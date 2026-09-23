import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT, TICK_HZ } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { EnemyData, ItemData, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import type { Enemy } from '@/ai/Enemy'
import { RpgRuntime } from '@/rpg/Runtime'
import { KillSettlement, refreshPlayer, type SettlementDeps } from '@/rpg/Settlement'
import { SCORE, movementConfig } from '@/rpg/Movements'

/**
 * KI-021 的第二半：三场 Boss 战的**首杀奖励整链**实测。
 *
 * 此前这一步只在中间 API 上验过（`rpg.onEnemyKilled(数据)` 直接调，且只测了奥斯塔拉一份数据），
 * 于是「真打死 ⇒ `entity.died` ⇒ `KillSettlement` ⇒ 掉落 ⇒ 背包 ⇒ 谱册点得亮」这条生产路径上
 * 的任何一环掉了链子都测不出来——Phase 5-C2b 抓到的那个 bug（万籁的首杀奖励挂在一个从不进
 * `applyHitStatus` 的静默 id 上）正是这一类：数据齐全、逐字段合法，只有跑一遍真死亡才看得见。
 * 所以这里三场都从**输入侧**进（真弹体 → `projectileStrikesEnemy` → `strikeEnemy` → 死亡），
 * 结算用生产那份 `KillSettlement`，测试自己不叫任何死亡或掉落函数。
 *
 * §7.1 的经济口径也压在这里：全作的振源核**只有**三场 Boss 战的首杀会掉，而吃核的页正好三张
 * ——「三颗核付得起 I+III+IV」（KI-037 那句裁决）此前是一句口算，现在有数。
 */

const CORE = 'it_resonance_core'
const BOSSES = [
  { id: 'en_ostlara', at: { x: 0, y: 0, z: -4 } },
  { id: 'en_hersil', at: { x: 0, y: 0, z: -4 } },
  { id: 'en_myriad', at: { x: 0, y: 0, z: -4 } },
] as const

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

function makeWorld(seed: string) {
  registerGameData()
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4) // 区域基准拍：Boss 进战后会各自接管成私有拍速（§15.1/§15.2），那是被测的一部分
  const rpg = new RpgRuntime('origin_tuner', seed)
  const weapon = registry.get<WeaponData>(rpg.mods().weaponId!)
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const deps: SettlementDeps = { rpg, refresh: () => refreshPlayer(rpg, player), checkpoint: () => {} }
  const settlement = new KillSettlement(deps)
  const defeats: Array<{ dataId: string; holdTicks: number }> = []
  const notifies: string[] = []
  const offs = [
    bus.on('boss.defeated', (p) => defeats.push({ dataId: p.dataId ?? '', holdTicks: p.holdTicks })),
    bus.on('ui.notify', (p) => notifies.push(p.text)),
  ]
  alive.push(() => settlement.dispose(), ...offs)

  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  refreshPlayer(rpg, player)
  player.stats.hpMax = 9_999_999
  player.stats.hp = 9_999_999

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.reset() // 拍钟不跟 hitStop 走（KI-017 第一步的口径）；屏息那段真实秒由下面的 step 手动给
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input, TICK_DT)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }

  /** 玩家侧的一记远程出手：走 ProjectileSystem 的真命中通道，不是直接调 `strikeEnemy` */
  const hit = (t: Enemy, dmg: number): void => {
    combat.projectiles.spawn({
      hostile: false, ownerId: 'player', kind: 'spear',
      origin: { x: t.pos.x, y: t.pos.y + 1.1, z: t.pos.z }, dir: { x: 0, y: 0, z: 1 },
      speed: 2, range: 5, radius: 1.5, damage: dmg, poise: 0, hitStopMs: 0
    }, time.tick)
  }

  /**
   * 打满一整场：每 4 tick 一记 60 伤（约一记重击的节奏），直到她倒下。
   * 刻意不是一发 9999——首发秒掉会跳过阶段机，而「阶段机跑到最后一阶之后还认得首杀这件事」
   * 正是这条链要量的东西（奥斯塔拉 P1 的钟壳只吃 10% 伤害，因此她要二十几记才过第一档）。
   */
  function fight(target: Enemy, cap = 8000): void {
    for (let t = 0; t < cap && target.alive; t++) {
      if (t % 4 === 0) hit(target, 60)
      player.stats.hp = player.stats.hpMax // 「会不会被反杀」不是本文件的问题
      tick()
    }
  }

  /** 让她真的照面：进战那一 tick 起演 §16 的三拍入场 */
  const engage = (id: string, tag: string): Enemy => {
    const at = BOSSES.find((b) => b.id === id)!.at
    const boss = ai.spawn(id, { ...at }, tag)
    boss.alertness = 100
    boss.enter('combat')
    return boss
  }

  return { time, rhythm, player, ai, combat, rpg, tick, hit, fight, engage, defeats, notifies }
}

type World = ReturnType<typeof makeWorld>

const coreName = (): string => registry.get<ItemData>(CORE).displayName

describe('§9.3 首杀唯一：三场 Boss 战各走一遍真通道', () => {
  for (const b of BOSSES) {
    it(`${b.id}：真打死 ⇒ 恰好一颗振源核，而胜利那行字排在屏息之后`, () => {
      const w: World = makeWorld(`kill-${b.id}`)
      const data = registry.get<EnemyData>(b.id)
      const before = w.rpg.inv.count(CORE)
      const boss = w.engage(b.id, 'reward')
      w.fight(boss)
      expect(boss.alive, `${b.id} 在 8000 tick 里没死：这套夹具的尺子失效`).toBe(false)
      expect(w.rpg.inv.count(CORE) - before, '首杀那一颗核真的进了背包').toBe(1)
      const d = w.defeats.filter((x) => x.dataId === b.id)
      expect(d.length, '胜利序列也发了（同一次死亡的两侧后果）').toBe(1)
      expect(d[0].holdTicks).toBe(data.boss!.victory!.holdTicks)
      const label = data.boss!.victory!.label!
      expect(w.notifies.includes(label), '安静里不落字').toBe(false)
      w.time.step(d[0].holdTicks / TICK_HZ + 0.05)
      w.tick(1)
      expect(w.notifies.includes(label), '屏息走完，收尾那行才落').toBe(true)
    })
  }
})

describe('§9.1「首杀唯一」在真通道上：第二次打死同一份数据', () => {
  it('不再掉第二颗核，但常规掉落照旧（被掐掉的只有 firstKill 那一栏）', () => {
    const w = makeWorld('twice')
    for (const b of BOSSES) {
      const first = w.rpg.inv.count(CORE)
      const one = w.engage(b.id, 'once')
      w.fight(one)
      expect(w.rpg.inv.count(CORE) - first, `${b.id} 第一次：一颗`).toBe(1)
      w.ai.despawn(one.id)
      const seen = w.notifies.length
      const again = w.engage(b.id, 'twice') // 同一份数据的第二个实例：战斗层的账按实例记，掉落层的账按数据记
      w.fight(again)
      expect(again.alive, `${b.id} 的第二场没打死`).toBe(false)
      const tail = w.notifies.slice(seen)
      expect(w.rpg.inv.count(CORE) - first, `${b.id}：第二颗核不该存在`).toBe(1)
      expect(tail.some((t) => t.includes('获得') && t.includes(coreName())), `${b.id}：播报里也不该再出现核`).toBe(false)
      expect(tail.some((t) => t.startsWith('遗响 +')), `${b.id}：常规 rolls 照旧付遗响`).toBe(true)
    }
  })
})

describe('§7.1 的经济链对账：三场 Boss 战 ⇒ 整本谱册', () => {
  it('三颗核点亮三张吃核的页，乐章 II 由万籁那两页残章付——正好够，一分余量都不多', () => {
    const w = makeWorld('economy')
    const cfg = movementConfig()
    const beforeCore = w.rpg.inv.count(CORE)
    const beforeScore = w.rpg.inv.count(SCORE)
    for (const b of BOSSES) w.fight(w.engage(b.id, `eco-${b.id}`))
    expect(w.rpg.inv.count(CORE) - beforeCore, '全作的核只有三场 Boss 战的首杀会掉').toBe(
      cfg.pages.filter((p) => p.unlock.item === CORE).length)
    expect(w.rpg.inv.count(SCORE) - beforeScore, '残章的总供给').toBeGreaterThanOrEqual(
      cfg.pages.filter((p) => p.unlock.item === SCORE).reduce((s, p) => s + p.unlock.count, 0))
    for (const p of cfg.pages) {
      expect(w.rpg.moves.unlockPage(p.id, w.rpg.inv), p.id).toMatchObject({ ok: true })
      expect(w.rpg.moves.isLit(p.id), `${p.id} 亮了`).toBe(true)
    }
    expect(w.rpg.inv.count(CORE) - beforeCore, '钱花完了：核没有多余的来兜底').toBe(0)
  })

  it('反向：少杀一场 Boss，三张吃核的页就点不满（乐章 IV 真的悬在那一场战上）', () => {
    const w = makeWorld('short')
    const cfg = movementConfig()
    const corePages = cfg.pages.filter((p) => p.unlock.item === CORE)
    expect(corePages[corePages.length - 1].id, '这条负例把「最后一张吃核的页=乐章 IV」当成了顺序前提').toBe('mvpage_rest')
    const before = w.rpg.inv.count(CORE)
    for (const b of BOSSES.filter((x) => x.id !== 'en_myriad')) w.fight(w.engage(b.id, 'two-only'))
    expect(w.rpg.inv.count(CORE) - before, '两场 Boss 战只给两颗核').toBe(corePages.length - 1)
    for (const p of corePages.slice(0, -1)) expect(w.rpg.moves.unlockPage(p.id, w.rpg.inv).ok, p.id).toBe(true)
    const rest = corePages[corePages.length - 1]
    expect(w.rpg.moves.unlockPage(rest.id, w.rpg.inv)).toMatchObject({ ok: false, reason: 'poor' })
    expect(w.rpg.moves.isLit(rest.id), '少一颗核就是暗的：解锁价不是装饰').toBe(false)
  })
})
