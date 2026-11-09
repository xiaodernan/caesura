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
import { Enemy } from '@/ai/Enemy'

/**
 * KI-403：§6.5「静音驼鼓后：全营进入 Search 且每 4 小节集体回头一次」。
 *
 * 病：KI-402 让鼓停真的把整营按停一小节、落进搜场，但搜场里没有那一句「集体回头」——
 * 敌人绕着鼓位走、脸朝哪儿全凭出生时的随机 yaw（而且 `lastKnown` 一被感知改写，圈心就跟着
 * 玩家走：实测警觉 27→85 一路爬、4 秒后直接进 combat）。§6.5 括号里那句
 * 「失去节拍可预测性，难度↑」于是没有兑现：鼓停之后营地反而更安全。
 *
 * 裁决（与 KI-402 同一格数据的第二个字段，不新开机制）：
 *  ① `beatLossOnDeath.lookBackEveryBars = 4`；间隔与回头那一下的时长都从 `RhythmClock` 换算：
 *     间隔 = 小节数 × 一小节 tick（84BPM/4/4 = 686 拍），回头 = 一拍（43 拍）；
 *  ② 丢拍落地后的搜场里，人绕着**鼓位**（`searchAnchor`，不是会被感知改写的 `lastKnown`）走、
 *     脸朝圈心——视锥对着鼓，圈外是安全的；
 *  ③ 每 4 小节整营同时把身子拧到背后（+π）、站定一拍——视锥扫过圈外。转身那一拍真的有声音
 *     （footstep + 尘环），不是只在数学里存在；
 *  ④ 回头那半拍是**真的在看**：被视锥框住的人当场警觉拉满、下一拍进 chase。没有这一条，
 *     search 里 20/s 的警觉衰减会把 3.4/次的爬升抵掉，「回头」永远抓不到人。
 *
 * 腿：
 *  ① 数据：驼鼓带 `lookBackEveryBars: 4`，没有这一格的怪照旧只有丢拍；
 *  ② 装表：丢拍给每个人装上 4 小节 / 一拍的钟（84BPM：686 / 43 tick）；
 *  ③ 节拍：685 拍不回头且脸一直朝着鼓位，第 686 拍整营同时转身、站定一拍不动，转完才继续搜；
 *  ④ 看见：站在圈外（原视锥之外）、回头那一拍在视锥里的玩家会被当场发现并进 chase；
 *  ⑤ 反向臂：同一次丢拍、数据里没有 `lookBackEveryBars` ⇒ 冻结照旧，但永远不回头。
 *
 * 不声称：转身只有 yaw（灰盒身体真的转），没有专门的「回头」动画；「每 4 小节」是唯一的
 * 回头节拍，玩家能背谱——这本来就是设计要的「另一种可预测」。
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
  return { time, rhythm, player, ai, combat, frame, tick, notifies, off: () => { offNotify() } }
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

function norm(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

/** 4 小节在 84BPM／4/4 下的实际 tick 数：4 × 171.43 = 685.7 ⇒ 686 */
const EVERY = 686
const HOLD = 43

describe('KI-403 鼓停后的搜场：每 4 小节整营集体回头（§6.5）', () => {
  it('数据：驼鼓带 lookBackEveryBars: 4；没有这一格的怪只有丢拍', () => {
    const tym = registry.get<EnemyData>('en_tympanus')
    expect(tym.ai.beatLossOnDeath).toEqual({ pauseBars: 1, searchAlertness: 0, lookBackEveryBars: 4 })
    expect(registry.get<EnemyData>('en_murkshell').ai.beatLossOnDeath).toBeUndefined()
  })

  it('装表：丢拍给每个人装上 4 小节 / 一拍的钟（84BPM = 686 / 43 tick）', () => {
    const w = makeWorld(84)
    const tym = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -6 }, 'drum')
    tym.alertness = 100
    tym.enter('combat')
    const a = w.ai.spawn('en_driftsinger', { x: 4, y: 0, z: -6 }, 'ally')
    a.alertness = 100
    a.enter('chase')
    w.tick(2)
    kill(w, tym)
    expect(w.rhythm.beatTicks).toBeCloseTo(42.857, 2)
    expect(a.lookBackEveryTicks, '4 小节 × 171.43 拍').toBe(EVERY)
    expect(a.lookBackHoldTicks, '回头那一下 = 一拍').toBe(HOLD)
    expect(a.lookBackNextTicks, '第一次回头要等一整段').toBe(EVERY)
    expect(a.searchAnchor?.x, '圈心是鼓手倒下的地方').toBeCloseTo(tym.pos.x, 6)
    expect(a.searchAnchor?.z).toBeCloseTo(tym.pos.z, 6)
    w.off()
  })

  it('节拍：685 拍不回头、脸一直朝鼓位；第 686 拍整营同时转身、站定一拍，转完才继续搜', () => {
    const w = makeWorld(84)
    w.player.pos.x = 40 // 圈外，且远在感知之外，不干扰这一条
    w.player.pos.z = 0
    const tym = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -6 }, 'drum')
    tym.alertness = 100
    tym.enter('combat')
    const a = w.ai.spawn('en_driftsinger', { x: 4, y: 0, z: -6 }, 'ally0')
    const b = w.ai.spawn('en_driftsinger', { x: -4, y: 0, z: -6 }, 'ally1')
    for (const e of [a, b]) { e.alertness = 100; e.enter('chase') }
    w.tick(2)
    kill(w, tym)

    w.tick(171) // 丢拍那一小节走完
    expect(a.frozenTicks).toBe(0)

    w.tick(300) // 先让脸转到鼓位（平时就是朝圈心的）
    const ax = a.searchAnchor!.x, az = a.searchAnchor!.z
    const bx = b.searchAnchor!.x, bz = b.searchAnchor!.z
    const drumYawA = Math.atan2(ax - a.pos.x, az - a.pos.z)
    const drumYawB = Math.atan2(bx - b.pos.x, bz - b.pos.z)
    expect(Math.abs(norm(a.yaw - drumYawA)), '搜场时脸朝鼓位').toBeLessThan(0.35)
    expect(Math.abs(norm(b.yaw - drumYawB))).toBeLessThan(0.35)

    w.tick(EVERY - 1 - 300) // 走到回头前一拍
    expect(a.lookBackNextTicks).toBe(1)
    const drumYawA2 = Math.atan2(ax - a.pos.x, az - a.pos.z)
    expect(Math.abs(norm(a.yaw - drumYawA2)), '没到点是真不回头').toBeLessThan(0.35)

    const posA = { x: a.pos.x, z: a.pos.z }
    const posB = { x: b.pos.x, z: b.pos.z }
    const yawA1 = a.yaw
    const yawB1 = b.yaw
    w.tick(1) // 第 686 拍：钟响，转身从下一拍开始
    expect(a.lookBackNextTicks).toBe(EVERY)
    expect(Math.abs(norm(a.yaw - yawA1)), '这一拍只是把钟叫响，还没转身').toBeLessThan(0.02)
    expect(Math.abs(norm(b.yaw - yawB1))).toBeLessThan(0.02)
    const yawA2 = a.yaw
    const yawB2 = b.yaw

    w.tick(HOLD) // 站定一拍，把身子拧到背后
    expect(Math.abs(norm(a.yaw - (yawA2 + Math.PI))), 'A 转身 ≈ π').toBeLessThan(1e-6)
    expect(Math.abs(norm(b.yaw - (yawB2 + Math.PI))), 'B 同一拍转身 ≈ π').toBeLessThan(1e-6)
    expect([a.pos.x, a.pos.z], '回头那一拍站定').toEqual([posA.x, posA.z])
    expect([b.pos.x, b.pos.z]).toEqual([posB.x, posB.z])

    w.tick(30)
    expect(Math.hypot(a.pos.x - posA.x, a.pos.z - posA.z), '转完接着搜').toBeGreaterThan(0.2)
    w.off()
  })

  it('看见：圈外站在原视锥之外的人，会被回头那一拍当场看见并进 chase', () => {
    const w = makeWorld(84)
    // 驼鼓 (0,-6)；同伴 (4,-6) 搜场时脸朝鼓位（-x）。玩家在 (+x) 方向 10 米：
    // 原视锥之外，回头（+x）时正对脸上。
    w.player.pos.x = 14
    w.player.pos.z = -6
    const tym = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -6 }, 'drum')
    tym.alertness = 100
    tym.enter('combat')
    const a = w.ai.spawn('en_driftsinger', { x: 4, y: 0, z: -6 }, 'ally')
    a.alertness = 100
    a.enter('chase')
    w.tick(2)
    kill(w, tym)

    w.tick(171 + EVERY - 1) // 搜场走到回头前一拍
    expect(a.state, '回头之前没看见（脸朝鼓位）').toBe('search')
    expect(a.alertness, '原视锥之外：警觉没有拉满').toBeLessThan(100)

    w.tick(HOLD + 6) // 回头 + 一个感知周期
    expect(a.state, '下一拍进 chase').toBe('chase')
    // 100 会在进 chase 之后按 20/s 回落，所以量的是「已经拉满过」：≥99 就够
    expect(a.alertness, '回头那一眼是当场看见').toBeGreaterThanOrEqual(99)
    w.off()
  })

  /* KI-437 #1：`Enemy.lookingBack` 落地之前，「回头那一拍还在进行」这句在 `sense` 与 `search`
     各手写一遍，而 getter 零读者。这两条腿是那句话**现在真的住在 getter 里**的行为证人：
     第一条量"真满多久"（窗口 = 表里那一拍，不多不少），第二条量 getter 删掉的那半句
     （`&& frozenTicks <= 0`）本来就是上面那道冻结短路的重复陈述——冻结里连眼睛都没有。 */
  it('getter 说的窗口恰好是一拍：钟响那一刻为真，站定 43 拍走完立刻为假', () => {
    const w = makeWorld(84)
    w.player.pos.x = 40 // 圈外且远在感知之外：这一条只量窗口，不让警觉爬升干扰
    w.player.pos.z = 0
    const tym = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -6 }, 'drum')
    tym.alertness = 100
    tym.enter('combat')
    const a = w.ai.spawn('en_driftsinger', { x: 4, y: 0, z: -6 }, 'ally')
    a.alertness = 100
    a.enter('chase')
    w.tick(2)
    kill(w, tym)
    expect(a.lookingBack, '刚装表：钟还没响').toBe(false)

    w.tick(171 + EVERY - 1)
    expect(a.lookingBack, '走到回头前一拍仍为假').toBe(false)

    w.tick(1) // 钟响那一拍：`lookBackRemainTicks` 落下，getter 当场改口
    const seen: boolean[] = [a.lookingBack]
    for (let i = 0; i < HOLD; i++) {
      w.tick(1)
      seen.push(a.lookingBack)
    }
    expect(seen.filter(Boolean).length, `回头那半拍的窗口 = 表里的一拍（${HOLD}）`).toBe(HOLD)
    expect(seen[HOLD], '站定那一拍走完，主人立刻说"没在回头"').toBe(false)
    expect(a.lookingBack, '下一小节之前不再回头').toBe(false)
    w.tick(EVERY - 2)
    expect(a.lookingBack, '第二次回头之前一直是假').toBe(false)
    w.off()
  })

  it('冻结里连眼睛都没有：把玩家塞到脸前，那 171 拍一格警觉不涨', () => {
    const w = makeWorld(84)
    const tym = w.ai.spawn('en_tympanus', { x: 0, y: 0, z: -6 }, 'drum')
    tym.alertness = 100
    tym.enter('combat')
    const a = w.ai.spawn('en_driftsinger', { x: 4, y: 0, z: -6 }, 'ally')
    a.alertness = 100
    a.enter('chase')
    w.tick(2)
    kill(w, tym)
    expect(a.frozenTicks, '丢拍那一小节').toBe(171)
    expect(a.alertness, '丢拍把读条一起清掉').toBe(0)
    // 站到他的脸正前方（+Z = 他的 yaw 朝向那一支），距离 1.5m——视锥与射程都覆盖得到
    w.player.pos.x = a.pos.x + Math.sin(a.yaw) * 1.5
    w.player.pos.z = a.pos.z + Math.cos(a.yaw) * 1.5
    w.tick(171)
    expect(a.frozenTicks).toBe(0)
    expect(a.alertness, '冻结里那 28 次感知轮询一次都没看见 ⇒ `sense` 的短路就是唯一的那道门').toBe(0)

    w.tick(30)
    expect(a.alertness, '解冻后同一位置立刻看得见（否则上面那句是玩家根本没在视锥里）').toBeGreaterThan(0)
    w.off()
  })

  it('反向臂：数据里没有 lookBackEveryBars ⇒ 冻结照旧，但永远不回头', () => {
    const w = makeWorld(84)
    w.player.pos.x = 40
    const base = registry.get<EnemyData>('en_tympanus')
    const bare: EnemyData = JSON.parse(JSON.stringify(base))
    bare.ai.beatLossOnDeath = { pauseBars: 1, searchAlertness: 0 }
    const drum = new Enemy(bare, { x: 0, y: 0, z: -6 }, 'bare')
    drum.alertness = 100
    drum.enter('combat')
    w.ai.enemies.push(drum)

    const a = w.ai.spawn('en_driftsinger', { x: 4, y: 0, z: -6 }, 'ally')
    a.alertness = 100
    a.enter('chase')
    w.tick(2)
    kill(w, drum)
    expect(drum.alive).toBe(false)
    expect(a.frozenTicks, '丢拍本身还在').toBe(171)
    expect(a.lookBackEveryTicks, '没有这一格就不装钟').toBe(0)

    w.tick(171)
    const yaw = a.yaw
    w.tick(900)
    expect(Math.abs(norm(a.yaw - yaw)), '没有回头这一拍').toBeLessThan(1e-9)
    w.off()
  })
})
