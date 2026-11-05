import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { EnemyData, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { newAttack, type Enemy } from '@/ai/Enemy'

/**
 * KI-402：§6.1「全营巡逻以 4/4 拍军鼓为令（鼓手=驼鼓），鼓停则全营停顿 1 小节」
 * ＋ §6.5「静音驼鼓后：全营进入 Search」。
 *
 * 病：这一行从立项起就只在文档里。驼鼓在代码里是一只普通 Heavy——死了就只是少一个人，
 * 营里没有任何人感觉到节拍被拿走。于是潜行解 A 的第二步「砸掉或静音驼鼓」没有战斗侧的兑现：
 * 玩家先杀鼓手，得到的收益和先杀任何一只嘈壳完全一样。
 *
 * 裁决（与 §14.6「走调时刻」同形，一个数据格 + 一个死亡回调）：
 *  ① `ai.beatLossOnDeath = { pauseBars, searchAlertness }`，只有驼鼓带；
 *  ② 鼓手倒下 ⇒ 同营活人 `frozenTicks = pauseBars × beatsPerBar × beatTicks`——时长按**小节**算，
 *     拍长归 `RhythmClock`，Boss 接管拍速时同一句仍然成立；
 *  ③ 停的是 `frozenTicks` 不是 `stunTicks`：这一格的语义就是「节拍被拿走」，招式停在原地、
 *     架势／震裂／闷音的计时一起停；
 *  ④ 停完落进 `search`，`lastKnown` 挪到鼓手倒下的地方，警觉落到 `searchAlertness`——
 *     静悄悄杀鼓手，他们搜的是鼓，不是玩家。
 *
 * 腿：
 *  ① 数据：驼鼓有这一格、叠唱没有（两种「死亡涟漪」各归各的号）；
 *  ② 死鼓手 ⇒ 三名同伴冻 171 拍（84BPM／4/4）、读条被清、落进 search、警觉 0、搜鼓位；
 *  ③ 冻结那一段真的不动：位置逐字节不变、stateTick 不涨；解冻之后才开始走；
 *  ④ 时长跟着钟走：同一场把拍速换成 120 ⇒ 一小节 120 拍（不是写死的 171）；
 *  ⑤ 对照组：杀一只没有这一格的嘈壳，同伴一动不动也不用进 search。
 */

registerGameData()

function makeWorld(bpm = 84) {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(bpm, 4)
  const weapon = registry.get<WeaponData>('wp_drawpin_spear')
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  player.yaw = Math.PI
  const notifies: string[] = []
  const offNotify = bus.on('ui.notify', (p) => { notifies.push(p.text) })
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input, TICK_DT)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  const off = () => { offNotify() }
  return { time, rhythm, player, ai, combat, frame, tick, notifies, off }
}

/** 走真实伤害通道（弹体 -> strikeEnemy -> onEnemyKilled），10 拍内确定性地打死目标 */
function kill(w: ReturnType<typeof makeWorld>, target: Enemy): void {
  w.combat.projectiles.spawn({
    hostile: false, ownerId: 'player', kind: 'spear',
    origin: { x: target.pos.x, y: target.pos.y + 1.1, z: target.pos.z }, dir: { x: 0, y: 0, z: 1 },
    speed: 2, range: 5, radius: 1, damage: 9999, poise: 0, hitStopMs: 0
  }, w.time.tick)
  for (let t = 0; t < 10 && target.alive; t++) w.tick()
}

function force(e: Enemy, id: string, tickIn = 0): void {
  const spec = e.data.attacks.find((a) => a.id === id)!
  e.attack = newAttack(spec, tickIn)
  e.enter('combat')
}

describe('KI-402 鼓停 ⇒ 全营丢拍一小节（§6.1／§6.5）', () => {
  it('数据：驼鼓带 beatLossOnDeath，叠唱带的是另一格（走调时刻）', () => {
    const tym = registry.get<EnemyData>('en_tympanus')
    expect(tym.ai.beatLossOnDeath).toEqual({ pauseBars: 1, searchAlertness: 0 })
    expect(tym.ai.offTuneOnDeath, '两种死亡涟漪各归各的号').toBeUndefined()
    const ref = registry.get<EnemyData>('en_refrein')
    expect(ref.ai.beatLossOnDeath).toBeUndefined()
    expect(ref.ai.offTuneOnDeath).toBeTruthy()
  })

  it('鼓手倒了：三名同伴丢拍一小节、读条清空、落进 search 搜鼓位', () => {
    const w = makeWorld(84)
    const tym = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -6 }, 'drum')
    tym.alertness = 100
    tym.enter('combat')
    const allies = [-3, 3, 6].map((x, i) => {
      const e = w.ai.spawn('en_driftsinger', { x, y: 0, z: -6 }, 'ally' + i)
      e.alertness = 100
      e.enter('chase')
      return e
    })
    w.tick(2)
    const long = allies[0]!.data.attacks.reduce((a, b) => (b.frames.recovery > a.frames.recovery ? b : a))
    force(allies[0]!, long.id, 0)
    expect(allies[0]!.attack, '先让它进入读条').not.toBeNull()

    kill(w, tym)
    expect(tym.alive).toBe(false)
    expect(w.notifies.some((t) => t.includes('鼓声断了')), '屏上要说出来').toBe(true)

    const pauseTicks = Math.round(w.rhythm.beatTicks * w.rhythm.beatsPerBar)
    expect(pauseTicks, '84BPM／4/4 的一小节 = 171 拍').toBe(171)
    for (const e of allies) {
      expect(e.frozenTicks, e.id + ' 丢拍一小节').toBe(pauseTicks)
      expect(e.attack, e.id + ' 的读条被清').toBeNull()
      expect(e.state, e.id + ' 落进 search').toBe('search')
      expect(e.alertness, e.id + ' 完全丢掉玩家').toBe(0)
      expect(e.lastKnown.x, e.id + ' 搜的是鼓位').toBeCloseTo(tym.pos.x, 6)
      expect(e.lastKnown.z, e.id + ' 搜的是鼓位').toBeCloseTo(tym.pos.z, 6)
    }
    w.off()
  })

  it('冻结那一段真的不动：位置逐字节不变、stateTick 不涨；解冻后才开始走', () => {
    const w = makeWorld(84)
    const tym = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -6 }, 'drum')
    tym.alertness = 100
    tym.enter('combat')
    const a = w.ai.spawn('en_driftsinger', { x: 4, y: 0, z: -6 }, 'ally')
    a.alertness = 100
    a.enter('chase')
    w.tick(2)
    kill(w, tym)
    const before = { x: a.pos.x, z: a.pos.z, stateTick: a.stateTick }
    w.tick(120)
    expect([a.pos.x, a.pos.z], '冻着的 120 拍里一步都不走').toEqual([before.x, before.z])
    expect(a.stateTick, '冻着的拍不计入 search 的钟').toBe(before.stateTick)
    expect(a.frozenTicks, '还剩 51 拍').toBe(171 - 120)
    w.tick(60)
    expect(a.frozenTicks).toBe(0)
    const thawed = { x: a.pos.x, z: a.pos.z }
    w.tick(30)
    expect(Math.hypot(a.pos.x - thawed.x, a.pos.z - thawed.z), '解冻后开始搜').toBeGreaterThan(0.2)
    w.off()
  })

  it('时长跟着钟走：拍速 120 ⇒ 一小节 120 拍，不是写死的 171', () => {
    const w = makeWorld(120)
    const tym = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -6 }, 'drum')
    tym.alertness = 100
    tym.enter('combat')
    const a = w.ai.spawn('en_driftsinger', { x: 4, y: 0, z: -6 }, 'ally')
    a.alertness = 100
    a.enter('chase')
    w.tick(2)
    kill(w, tym)
    expect(w.rhythm.bpm).toBe(120)
    expect(a.frozenTicks, '120BPM 的一小节 = 4 × 30 = 120 拍').toBe(120)
    w.off()
  })

  it('对照组：杀一只没有这一格的嘈壳，同伴不吃冻结也不进 search', () => {
    const w = makeWorld(84)
    const plain = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -6 }, 'plain')
    plain.alertness = 100
    plain.enter('combat')
    const a = w.ai.spawn('en_driftsinger', { x: 4, y: 0, z: -6 }, 'ally')
    a.alertness = 100
    a.enter('chase')
    w.tick(2)
    kill(w, plain)
    expect(plain.alive).toBe(false)
    expect(a.frozenTicks).toBe(0)
    expect(a.state).not.toBe('search')
    expect(a.alertness).toBe(100)
    w.off()
  })
})
