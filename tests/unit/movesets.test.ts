import { describe, expect, it } from 'vitest'
import { registry } from '@/core/Registry'
import { registerGameData, weaponsRaw } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'

/**
 * §64 acceptance ④: frame data is read from the data table (no hardcoded
 * numbers in code). These assert the greatsword + spear 段 timings match the
 * combat.md §4.2/§4.3 spec that was authored into movesets.json.
 */
registerGameData()

const gs = registry.get<MovesetData>('moveset:ms_greatsword').actions
const sp = registry.get<MovesetData>('moveset:ms_spear').actions

describe('weapon frame data comes from the table (§55/§64)', () => {
  it('greatsword 27f startup / 9f active / 24f recovery L1, and charged stacks 震裂×3', () => {
    expect(gs['l1'].startup).toBe(27)
    expect(gs['l1'].activeEnd - gs['l1'].activeStart).toBe(9)
    expect(gs['l1'].recovery).toBe(60) // 27 + 9 + 24
    expect(gs['charged'].fissureLayers).toBe(3)
    expect(gs['charged'].damage).toBe(80)
    expect(gs['l1'].hitbox && 'radius' in gs['l1'].hitbox && gs['l1'].hitbox.radius).toBe(3.0)
  })

  it('spear has a 5-hit light chain and long reach (3.2m)', () => {
    expect(sp['l1'].next).toBe('l2')
    expect(sp['l4'].next).toBe('l5')
    expect(sp['l5']).toBeTruthy()
    expect(sp['l1'].hitbox && 'radius' in sp['l1'].hitbox && sp['l1'].hitbox.radius).toBe(3.2)
    expect(sp['jump'].fissureLayers).toBe(1)
  })

  it('weapons carry archetype + noise scaling used by the sim (greatsword is a noise source)', () => {
    const gw = registry.get<WeaponData>('wp_fortissimo_greatsword')
    const sw = registry.get<WeaponData>('wp_drawpin_spear')
    expect(gw.archetype).toBe('greatsword')
    expect(gw.noiseMul).toBeGreaterThan(1)
    expect(sw.archetype).toBe('spear')
  })
})

/**
 * KI-039 的**定价闸门**（数据侧，不靠跑战斗）。
 *
 * 为什么放在这里而不只放在 gate5：KI-039 那 2× 的节奏差是**从帧表里读出来的**，
 * 而跑一次对照要 600+ tick、还混进了 AI 出招与架势打断的噪声。这条闸门只看每把武器
 * 的第一记轻击，量的是「这家族的持续输出被定在什么档」，所以 KI-037 补新武器时它当场就会响。
 *
 * 口径：持续 DPS 用 `l1.damage / l1.recovery`（这一记从起手到收势的整段墙钟成本，
 * 与 `boss-budget.test.ts` 那把「蓄力一记 / 74 tick」的尺子同源）。极差上限取 1.25×，
 * 意思是：**重击可以多打慌人、多吃体力、更响，但不许多打死人**——
 * 「哪一边更快杀掉同一只敌人」不该由武器家族决定，那是建卡（加点方向）该决定的事。
 */
describe('KI-039：武器家族的轻击定价必须互相咬住（重量的回报不落在通关时间上）', () => {
  const rows = weaponsRaw.map((w) => {
    const a = registry.get<MovesetData>(`moveset:${w.movesetId}`).actions['l1']
    if (!a) throw new Error(`movesets: ${w.movesetId} 没有 l1，玩家第一记轻击打不出来`)
    return { id: w.id, perHit: a.damage, cycle: a.recovery, dps: a.damage / a.recovery }
  })

  it('每把武器都有 l1 定价，且 sustained DPS 极差 ≤1.25×', () => {
    expect(rows.length, 'weapons.json 一把都没有 ⇒ 这条闸门在自证空集').toBeGreaterThan(0)
    const sorted = [...rows].sort((x, y) => x.dps - y.dps)
    const spread = sorted[sorted.length - 1].dps / sorted[0].dps
    const detail = rows.map((r) => `${r.id} ${r.perHit}/${r.cycle}=${r.dps.toFixed(3)}`).join(' | ')
    expect(spread, `轻击持续输出极差 ${spread.toFixed(2)}×（${detail}）> 1.25× ⇒ 某一边顺带赢下了通关时间`).toBeLessThanOrEqual(1.25)
  })

  it('单发最重的那把同时也是收势最长的那把（否则"重"只是文案）', () => {
    const byHit = [...rows].sort((x, y) => y.perHit - x.perHit)[0]
    const byCycle = [...rows].sort((x, y) => y.cycle - x.cycle)[0]
    expect(byCycle.id, `最重=${byHit.id}，最慢=${byCycle.id} ⇒ 重量没换来代价`).toBe(byHit.id)
  })
})
