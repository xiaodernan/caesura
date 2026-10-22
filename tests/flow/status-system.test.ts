import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { StreamingSystem, chunkKeyOf } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import { RpgRuntime } from '@/rpg/Runtime'
import { statusConfig } from '@/combat/Statuses'
import { movementConfig } from '@/rpg/Movements'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * KI-285：**§11「状态系统」那一族剩下那几格第一次在真链上被量**
 * （combat.md §11 的五行：震裂〔KI-233／KI-235 已量〕／**闷音 Mute**／回响〔KI-032 已量〕／
 * **失谐 Corruption**／**共鸣过载 Overdrive**）。
 *
 * **这一批量的七样东西**：
 * ① 失谐的**累积**（被喧堕精英命中 +3）；
 * ② 失谐的**褪色斜坡**（>60 起屏幕饱和度渐减）；
 * ③ 失谐的**满值掉血**（出安全区 −5HP/s）；
 * ④ 失谐的**清除**（调音桩归零／音色晶消耗品 −25）；
 * ⑤ 闷音的**体力回复 −30%**；
 * ⑥ 闷音的**战技封锁**（被拒的按键不吃过载、不起冷却）；
 * ⑦ 过载的**「脱战 8s 起 −1/3s」**。
 *
 * **两条量具纪律**：
 * ① **数值真源在 `statuses.json`**（代码里不写第二份常数）⇒ 腿里手钉的是**真读数**，不是表里的数；
 * ② **过载那一格要看它「在哪儿被写」**（谁给它加、谁给它减）⇒ 读的是运行时那几笔账，不是设计那句话。
 *
 * **腿里手钉的是真读数**（不读数据表：读表的话表一改腿也跟着改 ⇒ 那一格就没人守了）。
 */

registerGameData()

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime()
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>('moveset:ms_sword'))
  player.applyRpg(rpg.mods())
  player.setSkills(rpg.skillLoadout())
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const streaming = new StreamingSystem(regions)
  const spawner = new SpawnDirector(regions, {
    spawn: (id, pos, seed) => ai.spawn(id, pos, seed),
    despawn: (id) => ai.despawn(id),
    hasFlag: (k) => streaming.hasFlag(k),
  }, (p: Vec3) => { const c = streaming.cellOf(p); return chunkKeyOf(c.cx, c.cy, c.cz) })
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  const off = bus.on('combat.hit', () => {})
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.step(TICK_DT)
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, rhythm, rpg, player, ai, combat, streaming, spawner, frame, tick, off }
}

type World = ReturnType<typeof makeWorld>

describe('KI-285 §11 状态系统：闷音／失谐／过载那几格', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  it('腿① **失谐的累积那一格**：被喧堕精英命中 ⇒ **+2.82**（＝设计那一格的 3 × 失谐抗性 **0.94**）⇒ 与设计「被喧堕精英命中 +3」**差一个抗性乘数** ⇒ 登记', () => {
    const w = makeWorld()
    const c = w.player.corruption
    const cfg = statusConfig().corruption
    const added = c.add(cfg.eliteHit)
    expect(c.resistMul, '**失谐抗性那一格不是 1**（角色的失谐属性给的）').toBeLessThan(1)
    expect(added, '**一记精英命中加的是 3 × 抗性**（设计写的是 +3）').toBeCloseTo(3 * c.resistMul, 5)
    expect(c.value, '（褪色值就涨了这么多）').toBeCloseTo(added, 5)
    alive.push(w.off)
  })

  it('腿② **失谐的褪色斜坡那一格**：**≤60 是 0**，之后线性爬到 100 时的 **1** ⇒ 与设计「>60 起屏幕饱和度渐减」**逐字对上**', () => {
    const w = makeWorld()
    const c = w.player.corruption
    const at = (v: number) => { c.value = v; return c.veil() }
    expect(at(0), '（0 ⇒ 不褪色）').toBe(0)
    expect(at(60), '**60 ⇒ 还不褪色**（设计写「>60 起」）').toBe(0)
    expect(at(61), '**61 ⇒ 开始褪**').toBeCloseTo(0.025, 5)
    expect(at(80), '**80 ⇒ 褪一半**').toBeCloseTo(0.5, 5)
    expect(at(100), '**100 ⇒ 褪满**').toBe(1)
    alive.push(w.off)
  })

  it('腿③ **失谐的满值掉血那一格**：满值时 **5 点/秒**；没满 ⇒ **0** ⇒ 与设计「满值：出安全区持续 −5HP/s」**逐字对上**', () => {
    const w = makeWorld()
    const c = w.player.corruption
    c.value = 100
    expect(c.full, '（满了）').toBe(true)
    expect(c.drain(1), '**满值时一秒扣 5 点血**').toBeCloseTo(5, 5)
    c.value = 99
    expect(c.drain(1), '**没满 ⇒ 一滴都不扣**').toBe(0)
    alive.push(w.off)
  })

  it('腿④ **失谐的清除那一格**：音色晶消耗品 **−25**；调音桩 **归零** ⇒ 与设计「调音桩归零；音色晶消耗品 −25」**逐字对上**', () => {
    const w = makeWorld()
    const c = w.player.corruption
    c.value = 100
    const purged = c.purge(25)
    expect(purged, '**一次刮掉 25**').toBe(25)
    expect(c.value, '（100 ⇒ 75）').toBe(75)
    c.reset()
    expect(c.value, '**调音桩归零**').toBe(0)
    alive.push(w.off)
  })

  it('腿⑤ **闷音的体力回复那一格**：**×0.7**（＝设计「体力回复 −30%」）⇒ 与设计**逐字对上**', () => {
    const a = makeWorld()
    const pa = a.player
    pa.stats.stamina = 50
    const before = pa.stats.stamina
    a.tick(60)
    const plain = pa.stats.stamina - before
    const b = makeWorld()
    const pb = b.player
    pb.stats.stamina = 50
    pb.stats.muteTicksLeft = 180
    const before2 = pb.stats.stamina
    b.tick(60)
    const muted = pb.stats.stamina - before2
    expect(pa.stats.muteRegenMul, '**闷音的回复乘数是 0.7**').toBe(0.7)
    expect(muted / plain, '**挂上闷音之后回复慢了 30%**').toBeCloseTo(0.7, 2)
    alive.push(a.off, b.off)
  })

  it('腿⑥ **闷音的战技封锁那一格**：闷音期间战技**出不来**，而且**不吃过载、不起冷却** ⇒ 与设计「战技/律具技封锁」**逐字对上**（但设计写的「4s」与「6s」在运行时是**同一个计时器** ⇒ 登记）', () => {
    // **先装一式上去**（否则「出不来」是因为根本没有那一式 ⇒ 那一格就没被量到）
    const setup = (w: World) => {
      const book = w.rpg.moves
      const mv = movementConfig().movements.find((x) => x.id === 'mv_wholenotecut')!
      const page = book.page(mv.page)!
      if (!book.isLit(page.id)) {
        if (page.unlock.flag) bus.emit('world.flag', { key: page.unlock.flag, value: true })
        else w.rpg.inv.add(page.unlock.item ?? '', page.unlock.count ?? 0)
        expect(book.unlockPage(page.id, w.rpg.inv).ok).toBe(true)
      }
      for (let i = 0; i < 40 && w.rpg.prog.rank < book.slotRank(0)!; i++) w.rpg.prog.addResonance(300)
      expect(book.equip(0, 'mv_wholenotecut', w.rpg.prog.rank).ok).toBe(true)
      w.player.setSkills(w.rpg.skillLoadout())
      return book.cfg.slots[0].action
    }
    // 对照：没有闷音 ⇒ 那一式出得来
    const a = makeWorld()
    const keyA = setup(a)
    a.player.stats.overdrive = 10
    expect(a.player.tryStartAction(keyA, a.time.tick), '**没有闷音 ⇒ 那一式出得来**（这一格是对照组）').toBe(true)
    // 挂上闷音 ⇒ 出不来、且不吃过载、不起冷却
    const b = makeWorld()
    const keyB = setup(b)
    const p = b.player
    p.stats.overdrive = 10
    p.stats.muteTicksLeft = 180
    const before = p.stats.overdrive
    const ok = p.tryStartAction(keyB, b.time.tick)
    expect(ok, '**闷音期间战技出不来**').toBe(false)
    expect(p.stats.overdrive, '**被拒的那一下不吃过载**').toBe(before)
    expect(p.action, '（也没有起手）').toBe(null)
    expect(p.skillCooldown(keyB), '**也不起冷却**').toBe(0)
    alive.push(a.off, b.off)
  })

  it('腿⑦ **过载的「脱战 8s 起 −1/3s」那一格没有承载体**：脱战 **30 秒**它也**一格不掉** ⇒ 登记', () => {
    const w = makeWorld()
    const p = w.player
    p.stats.overdrive = 10
    w.tick(60 * 30)
    expect(p.stats.overdrive, '**30 秒之后过载还是满的**（设计「脱战 8s 起 −1/3s」在运行时没有那一格）').toBe(10)
    alive.push(w.off)
  })
})
