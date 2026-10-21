import { afterEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { Rng } from '@/core/Math'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { bus } from '@/core/EventBus'

/**
 * KI-235：**震裂的材质倍率／强度侧那一族**第一次在真链上被量。
 *
 * 那一格的完整形状是 `1 + 层数 × 0.04 × 强度侧（玩家的「异音」属性 `statusPowerMul`）× 材质侧（敌人的 `fissureMul`）`
 * —— KI-233 量的是**强度侧与材质侧都是 1** 的那一种；这一批量的是**那两个乘子各自是什么、能不能变**。
 *
 * | 强度侧 | 玩家的「异音」属性（`statusPowerMul`）⇒ 同样几层裂纹**更疼**（而没裂纹的那一记**不变**） |
 *
 * **材质侧（敌人的 `fissureMul` 那一格）本批没有腿守着**：读数是「材质疑固的敌人：0 层 **11** 点、1 层 **18** 点；
 * 普通敌人：0 层 **9** 点、1 层 **9** 点」⇒ 那一格**确实有效果**，但它**对不上** `1 + 0.04 × 2`，
 * 机制本批没查清 ⇒ **登记待查**（不声称它被腿守着；反向实测的臂 A／臂 B 装了不咬住，理由见账本那一行）。
 *
 * 真链：真 `PlayerController` ＋ 真 `Enemy` ＋ 真 `CombatManager` ＋ 真事件；敌人被钉住。
 *
 * **量具上的一个坑（记在这儿免得下一个人再踩）**：`player.applyRpg(mods)` 会把**整套** mods 灌进去
 * （连 `poiseMax` 一起换）⇒ 玩家的架势上限被换成默认值 ⇒ 那一记的架势伤害直接把它自己打断
 * ⇒ **那一记根本打不到人**（量出来是 0）⇒ 所以这一批只改**那一格**（`player.rpg.statusPowerMul`）。
 */

registerGameData()

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(60, 1)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  const off = bus.on('combat.hit', () => { /* 那一记真的落在敌人身上就够读了 */ })
  const hook = { pin: (): void => { /* 默认不钉 */ } }

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.reset()
      hook.pin()
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, rhythm, player, ai, combat, frame, tick, off, hook }
}

type World = ReturnType<typeof makeWorld>

describe('KI-235 震裂的材质倍率与强度侧（异音属性）', () => {
  const alive: Array<() => void> = []
  afterEach(() => { for (const off of alive.splice(0)) off() })

  /** 一只被钉住的敌人，站在玩家正前方 1.6m */
  function prey(w: World, id: string) {
    const e = w.ai.spawn(id, { x: 0, y: 0, z: -1.6 }, 'prey')
    e.alertness = 0
    e.enter('idle')
    const p = w.player
    p.pos = { x: 0, y: 0, z: 0 }
    p.yaw = Math.PI
    p.camYawRef = Math.PI + p.yaw
    w.hook.pin = () => { e.pos.x = 0; e.pos.z = -1.6; e.yaw = 0 }
    return e
  }

  /**
   * 打敌人一记（`heavy` 挂层、`light` 量伤害）⇒ 返回那一记的伤害。
   * **随机种子每次重置** ⇒ 两次量到的结算方差是同一格 ⇒ 差出来的就是那一格倍率。
   */
  function hit(w: World, e: ReturnType<World['ai']['spawn']>, mode: 'light' | 'heavy'): number {
    const p = w.player
    p.stats.stamina = p.stats.staMax
    w.combat.rng = new Rng('ki235')
    const hp0 = e.stats.hp
    if (mode === 'heavy') {
      w.frame.held.add('attackHeavy')
      for (let k = 0; k < 5; k++) w.tick()
      w.frame.held.delete('attackHeavy')
      w.tick()
    } else {
      w.frame.edges.add('attackLight')
      w.tick()
      w.frame.edges.delete('attackLight')
    }
    for (let i = 0; i < 90 && e.stats.hp === hp0; i++) w.tick()
    const dmg = hp0 - e.stats.hp
    for (let i = 0; i < 90 && p.action; i++) w.tick() // 等这一式收完（下一记才出得来）
    return dmg
  }

  it('腿① 强度侧（玩家的「异音」属性）：同样几层裂纹 ⇒ 那一记更疼', () => {
    const plain = makeWorld()
    const t = prey(plain, 'en_tympanus')
    const dmg0 = hit(plain, t, 'light')
    hit(plain, t, 'heavy') // 挂 1 层
    const dmg1 = hit(plain, t, 'light')
    alive.push(plain.off)

    const strong = makeWorld()
    // **只改那一格**（`applyRpg` 会把整套 mods 灌进去 ⇒ 架势上限被换掉 ⇒ 那一记会被自己打断）
    strong.player.rpg.statusPowerMul = 2
    const t2 = prey(strong, 'en_tympanus')
    hit(strong, t2, 'heavy') // 挂 1 层
    const sDmg1 = hit(strong, t2, 'light')
    alive.push(strong.off)

    expect(dmg0, '前提：0 层裂纹的那一记打疼了敌人').toBeGreaterThan(0)
    expect(dmg1, '前提：1 层裂纹的那一记也打疼了敌人').toBeGreaterThan(0)
    expect(sDmg1, '强度侧加倍 ⇒ 同样 1 层裂纹**更疼**（1 + 0.04 × 2）').toBeGreaterThan(dmg1)
  })

  it('腿② 强度侧只进裂纹的倍率：没裂纹的那一记一个字节都不变', () => {
    const plain = makeWorld()
    const t = prey(plain, 'en_tympanus')
    const dmg0 = hit(plain, t, 'light')
    alive.push(plain.off)

    const strong = makeWorld()
    strong.player.rpg.statusPowerMul = 2
    const t2 = prey(strong, 'en_tympanus')
    const sDmg0 = hit(strong, t2, 'light')
    alive.push(strong.off)

    expect(dmg0, '前提：0 层裂纹的那一记打疼了敌人').toBeGreaterThan(0)
    expect(sDmg0, '强度侧加倍 ⇒ **没裂纹**的那一记一个字节都不变（那一格只进裂纹的倍率，不进普通伤害）')
      .toBe(dmg0)
  })
})
