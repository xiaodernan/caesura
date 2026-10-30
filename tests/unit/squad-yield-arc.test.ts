import { describe, expect, it } from 'vitest'
import { registry } from '@/core/Registry'
import { TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registerGameData } from '@/data'
import { Enemy } from '@/ai/Enemy'
import { DEFAULT_SQUAD_CONFIG, Squad } from '@/ai/Squad'
import type { EnemyData } from '@/data/schema'
import type { PlayerController } from '@/player/ThirdPersonController'

/**
 * KI-374：等槽的人第一次「让位」——绕圈方向按占槽者的方位选，不从主攻手身上碾过去。
 *
 * KI-371/373 让等待者绕圈，但方向写死成 +0.4 rad：站在主攻手逆时针一侧的人继续逆时针（越绕越开），
 * 站在顺时针一侧的人却会**朝着主攻手转**——「我在等」的走位反而挡住真正出手的人。
 * 本批让 Squad 每 tick 给等待者写「占槽者在哪」（同一目标的最高仇恨者），stepAround 用两个候选
 * 方向里离占槽者更远的那个。没有占槽者/不在小队里 ⇒ 方向仍是 +1（KI-371 原样）。
 *
 * 四条腿：
 *  ① Squad 给等的人写占槽者位置，占槽者自己那一格是 null；
 *  ② 两个等待者分居占槽者两侧 ⇒ 各自朝远离占槽者的方向绕，夹角都变大；
 *  ③ 摘掉那一格（对照组）⇒ 靠内的那一个朝占槽者转，夹角变小——证明这一格是承重的；
 *  ④ 占槽者自己不绕圈：60 tick 里位置不动。
 */

registerGameData()

const fakePlayer = (): PlayerController => ({ pos: { x: 0, y: 0, z: 0 } }) as unknown as PlayerController

const rhythmOf = (): RhythmClock => {
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  return rhythm
}

const enemyAt = (id: string, x: number, z: number): Enemy => {
  const base = registry.get<EnemyData>('en_driftsinger')
  const e = new Enemy({ ...base, ai: { ...base.ai, distBands: [{ min: 0, max: 99, actions: ['claw1'] }] } }, { x, y: 0, z }, id)
  e.enter('combat')
  e.alertness = 100
  return e
}

const holderPosOf = (e: Enemy) =>
  (e as unknown as { squadHolderPos: { x: number; y: number; z: number } | null }).squadHolderPos

const bearing = (e: Enemy, p: PlayerController): number => Math.atan2(e.pos.z - p.pos.z, e.pos.x - p.pos.x)
const gap = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))

const fake = (id: string, x: number, z: number) => ({
  id,
  data: { ai: { camp: 'test' } },
  alive: true,
  pos: { x, y: 0, z },
  squadThreats: [] as unknown[],
  squadHasSlot: false,
  squadWaitRank: 0,
  squadTarget: null as string | null,
  squadHolderPos: null as { x: number; y: number; z: number } | null,
})

const R = 5
const OFF = 0.3

const arcRun = (yieldOn: boolean) => {
  const squad = new Squad({ ...DEFAULT_SQUAD_CONFIG, maxAttackSlots: 1 })
  const p = fakePlayer()
  const h = enemyAt('h', R, 0)
  const a = enemyAt('a', R * Math.cos(OFF), R * Math.sin(OFF))
  const b = enemyAt('b', R * Math.cos(-OFF), R * Math.sin(-OFF))
  for (const e of [h, a, b]) {
    squad.register(e)
    squad.addThreat(e.id, 'player', e === h ? 100 : 20)
  }
  squad.update(1)
  if (!yieldOn) for (const e of [a, b]) (e as unknown as { squadHolderPos: unknown }).squadHolderPos = null
  const g0 = { a: gap(bearing(a, p), bearing(h, p)), b: gap(bearing(b, p), bearing(h, p)) }
  const rhythm = rhythmOf()
  for (let i = 1; i <= 60; i++) for (const e of [a, b]) e.update(TICK_DT, i, p, rhythm, () => false)
  return {
    g0,
    g1: { a: gap(bearing(a, p), bearing(h, p)), b: gap(bearing(b, p), bearing(h, p)) },
    moved: Math.hypot(h.pos.x - R, h.pos.z),
    slots: { h: h.squadHasSlot, a: a.squadHasSlot, b: b.squadHasSlot },
  }
}

describe('KI-374 让位：绕圈方向按占槽者方位选', () => {
  it('Squad 给等的人写占槽者位置；占槽者自己那一格是 null', () => {
    const squad = new Squad({ ...DEFAULT_SQUAD_CONFIG, maxAttackSlots: 1 })
    const h = fake('h', 5, 0)
    const a = fake('a', 4.78, 1.48)
    for (const f of [h, a]) squad.register(f as unknown as Enemy)
    squad.addThreat('h', 'player', 100)
    squad.addThreat('a', 'player', 20)

    squad.update(1)

    expect(holderPosOf(h as unknown as Enemy), '占槽者不需要朝自己让路').toBeNull()
    const hp = holderPosOf(a as unknown as Enemy)
    expect(hp, '等的人拿到占槽者的位置').not.toBeNull()
    expect(hp!.x).toBeCloseTo(5, 5)
    expect(hp!.z).toBeCloseTo(0, 5)
  })

  it('两侧的等待者各朝远离占槽者的方向绕：两条夹角都变大', () => {
    const run = arcRun(true)
    expect(run.slots, '一槽 ⇒ 只有 h 在打').toEqual({ h: true, a: false, b: false })
    expect(run.g1.a - run.g0.a, '逆时针一侧继续向外').toBeGreaterThan(0.1)
    expect(run.g1.b - run.g0.b, '顺时针一侧改为向外（不再朝主攻手转）').toBeGreaterThan(0.1)
  })

  it('对照组：摘掉占槽者位置 ⇒ 靠内那一个朝主攻手转，夹角变小', () => {
    const run = arcRun(false)
    expect(run.g1.b - run.g0.b, '方向写死 +1 时，顺时针一侧越绕越近').toBeLessThan(0)
  })

  it('占槽者自己不绕圈：60 tick 里位置不动', () => {
    const run = arcRun(true)
    expect(run.moved).toBeLessThan(1e-6)
  })
})
