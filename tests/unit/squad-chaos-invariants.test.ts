import { describe, expect, it } from 'vitest'
import { TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registerGameData } from '@/data'
import { AISystem } from '@/ai/AISystem'
import type { Enemy } from '@/ai/Enemy'
import type { PlayerController } from '@/player/ThirdPersonController'

/**
 * KI-399：小队状态在「乱战长跑」下的不变量。
 *
 * KI-394–398 这批队形/槽位修复全部是**单病单量**：每批只盯一个读数，跑的是脚本化到极干净的场景。
 * 真实乱战里那些状态会互相踩——掉血撤退、阵亡、玩家跑远、警觉归零、再回来重新接战。这一批不修生产码，
 * 把七条已经量出来的承诺钉成一台长跑尺，每拍都在 8 只混合敌人身上重算：
 *
 *  ① 占槽人数 ≤ 配置上限（3）；
 *  ② 死人一个槽也不占、名次也不留；
 *  ③ 等待名次从 1 开始不跳号、不重复（一个名次一个人）；
 *  ④ 「仇恨表非空却出手 ⇒ 必须占着槽」（KI-379 的闸）；
 *  ⑤ 撤退者只在**进入撤退那一拍**可能还挂着槽（`Squad` 先于 `Enemy` 跑，下一拍必清，KI-396 的兜底）；
 *  ⑥ 一个人不许同时占槽又挂名次；读条不许越过 recovery（负数起手是节拍前置量，合法）；
 *  ⑦ 位置与血量不出 NaN／负数，状态名只许是状态机里那十一个。
 *
 * **尺子自检**（防这把尺本身是恒真断言）：把三只手动标成占槽、再标第四只 ⇒ ①必须响；
 * 把两个人的名次都写成 2 ⇒ ③必须响。没有这两条，下面那张「0 违例」的绿是空的。
 *
 * **分母出自同一次长跑**（KI-326 的读数纪律）：出手拍数、死亡数、撤退拍数、最大同时占槽数一起报，
 * 长跑若因为别的原因提前熄火（没人出手、没人掉血），这些数会先掉下来，不会白送一条干净的绿。
 */

registerGameData()

const STATES = new Set(['idle', 'patrol', 'investigate', 'alert', 'chase', 'combat', 'retreat', 'search', 'callAlly', 'recover', 'dead'])
const MAX_SLOTS = 3

const fakePlayer = (x: number, z: number): PlayerController =>
  ({
    pos: { x, y: 0, z },
    hitTarget: () => ({ height: 1.7 }),
    stats: { stamina: 100, staMax: 100 },
    grounded: true,
    action: null,
  } as unknown as PlayerController)

/** 一台只读的尺：不改任何状态，只把这一拍的违例收成字符串 */
function violations(enemies: Enemy[], prevState: Map<string, string>, tick: number): string[] {
  const out: string[] = []
  const slots = enemies.filter((e) => e.squadHasSlot)
  if (slots.length > MAX_SLOTS) out.push(`slot>${MAX_SLOTS}@${tick}:${slots.length}`)
  for (const e of slots) if (!e.alive) out.push(`deadSlot@${tick}:${e.id}`)
  const ranks = enemies.filter((e) => e.squadWaitRank > 0).map((e) => e.squadWaitRank).sort((a, b) => a - b)
  if (new Set(ranks).size !== ranks.length) out.push(`dupRank@${tick}`)
  if (ranks.some((r, i) => r !== i + 1)) out.push(`rankGap@${tick}`)
  for (const e of enemies) {
    if (e.squadThreats.length > 0 && e.attack && !e.squadHasSlot) out.push(`attackNoSlot@${tick}:${e.id}`)
    if (!e.alive && (e.attack || e.squadWaitRank > 0 || e.squadHasSlot)) out.push(`deadBusy@${tick}:${e.id}`)
    if (e.squadHasSlot && e.squadWaitRank > 0) out.push(`slotAndRank@${tick}:${e.id}`)
    if (e.state === 'retreat' && e.squadHasSlot && prevState.get(e.id) === 'retreat') {
      out.push(`retreatSlot@${tick}:${e.id}`)
    }
    if (e.attack) {
      const f = e.attack.spec.frames
      if (e.attack.tick > f.recovery) out.push(`tickPastRecovery@${tick}:${e.id}`)
    }
    if (!Number.isFinite(e.pos.x) || !Number.isFinite(e.pos.z)) out.push(`nanPos@${tick}:${e.id}`)
    if (!(e.stats.hp >= 0)) out.push(`negHp@${tick}:${e.id}`)
    if (!STATES.has(e.state)) out.push(`badState@${tick}:${e.id}:${e.state}`)
  }
  return out
}

const rhythmOf = (): RhythmClock => {
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  return rhythm
}

const KINDS = ['en_driftsinger', 'en_driftsinger', 'en_driftsinger', 'en_murkshell', 'en_murkshell', 'en_tympanus', 'en_skewer', 'en_refrein']

function arena() {
  const ai = new AISystem({ maxAttackSlots: MAX_SLOTS })
  const rhythm = rhythmOf()
  const player = fakePlayer(0, 0)
  const enemies: Enemy[] = []
  KINDS.forEach((kind, i) => {
    const ang = (i / KINDS.length) * Math.PI * 2
    const e = ai.spawn(kind, { x: Math.cos(ang) * (2 + i * 0.7), y: 0, z: Math.sin(ang) * (2 + i * 0.7) }, 'chaos' + i)
    e.alertness = 100
    e.enter('combat')
    enemies.push(e)
  })
  return { ai, rhythm, player, enemies }
}

describe('KI-399 乱战长跑的小队不变量', () => {
  it('八只混合、六次剧本转折、6000 拍：七条不变量一条违例都没有', () => {
    const w = arena()
    const prev = new Map<string, string>()
    const bad: string[] = []
    let attackTicks = 0
    let retreatTicks = 0
    let maxSlots = 0
    let deaths = 0
    for (let tick = 1; tick <= 6000; tick++) {
      // 玩家绕圈；周期性站定；跑远；再回来把警报重新拉满
      const a = tick / 300
      w.player.pos.x = Math.cos(a) * 6
      w.player.pos.z = Math.sin(a) * 6
      if (tick % 900 === 300) { w.player.pos.x = 0; w.player.pos.z = 0 }
      if (tick === 1500) for (const e of w.enemies.slice(0, 3)) e.stats.hp = Math.max(1, Math.round(e.stats.hpMax * 0.15))
      if (tick === 2600) w.enemies[3].stats.damage(9999)
      if (tick === 3400) {
        w.player.pos.x = 60
        w.player.pos.z = 0
        for (const e of w.enemies) e.alertness = 0
      }
      if (tick === 4600) {
        w.player.pos.x = 0
        w.player.pos.z = 0
        for (const e of w.enemies) if (e.alive) { e.alertness = 100; e.enter('combat') }
      }
      w.ai.update(TICK_DT, tick, w.player, w.rhythm)
      w.rhythm.update(TICK_DT)
      bad.push(...violations(w.enemies, prev, tick))
      const slots = w.enemies.filter((e) => e.squadHasSlot).length
      if (slots > maxSlots) maxSlots = slots
      for (const e of w.enemies) {
        if (e.attack) attackTicks++
        if (e.state === 'retreat') retreatTicks++
      }
      for (const e of w.enemies) prev.set(e.id, e.state)
      deaths = w.enemies.filter((e) => !e.alive).length
    }
    expect(bad.slice(0, 5), '前几条违例').toEqual([])
    expect(bad.length).toBe(0)
    // 分母：这条长跑真的打起来了、真的有人退、真的死了人、上限真的被顶到过
    expect(attackTicks, '有人出手的敌人拍数').toBeGreaterThan(5000)
    expect(retreatTicks, '撤退态出现过的敌人拍数').toBeGreaterThan(0)
    expect(deaths, '脚本里那一只真的死了').toBeGreaterThanOrEqual(1)
    expect(maxSlots, '三格槽位被同时占满过').toBe(MAX_SLOTS)
  })

  it('尺子自检：第四个人占槽、两个人同名次 ⇒ 这台尺必须响，否则上面那条绿不成立', () => {
    const w = arena()
    const prev = new Map<string, string>()
    w.enemies[0].squadHasSlot = true
    w.enemies[1].squadHasSlot = true
    w.enemies[2].squadHasSlot = true
    w.enemies[3].squadHasSlot = true
    w.enemies[4].squadWaitRank = 2
    w.enemies[5].squadWaitRank = 2
    const bad = violations(w.enemies, prev, 1)
    expect(bad.some((v) => v.startsWith('slot>3')), '第四格被数出来').toBe(true)
    expect(bad.some((v) => v.startsWith('dupRank')), '同名次被数出来').toBe(true)
  })
})
