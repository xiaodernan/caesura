import { describe, expect, it } from 'vitest'
import { TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registerGameData } from '@/data'
import { AISystem } from '@/ai/AISystem'
import type { PlayerController } from '@/player/ThirdPersonController'

/**
 * KI-401：仇恨表在脱战之后到底清不清——KI-396 不声称②／KI-397 不声称② 的复核批。
 *
 * 那两行写着「仇恨表本身没有清（脱战后名册里仍留着 threats 条目，数值 0）」。本批复核：
 * `Squad.update` 的衰减过滤器（`threat > 0.01 || engaged`）里 `engaged` 读的是
 * `ENGAGED_STATES`，所以人一旦真的离开交战四态（搜索／巡逻），0 值条目就会被滤掉。
 * 实测：玩家从 4 米处瞬移到 60 米外，仇恨条目在第 783 拍清掉前四个、第 822 拍全清——
 * 即离开后 183／222 拍（3.05／3.70 秒），不是「一直留着」。
 *
 * 但这条边界有两个方向，缺一个都会写坏：
 *  ① 还在交战（combat）的人，数值归零也**必须留着**条目——KI-379 的整条裁决，
 *     滤掉它等于让「名册里有没有这个人」跟着数值走，`tryAttack` 那道闸会整道放行；
 *  ② 离开交战四态之后**必须**清掉——否则名册只增不减，重新接战还会带着旧账。
 *
 * 腿：
 *  ① 逃离：600 拍后逐人有一笔账；瞬移 60 米，第 900 拍前全清、末态无名次无槽、currentTarget 为 null；
 *  ② 反向边界：交了 1200 拍、数值早已是 0，条目仍在（KI-379）；手动掉进 search 一拍就被清，
 *     再回 combat 时由 AISystem 补回**恰好一条**（不是第二套账）；
 *  ③ 三轮逃离／回来：每人的条目数从不超过 1（不随重接战累加），回来之后出手恢复。
 */

registerGameData()

const fakePlayer = (x = 0, z = 0): PlayerController =>
  ({
    pos: { x, y: 0, z },
    hitTarget: () => ({ height: 1.7 }),
    stats: { stamina: 100, staMax: 100 },
    grounded: true,
    camYawRef: {},
    action: null,
  }) as unknown as PlayerController

const rhythmOf = (): RhythmClock => {
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  return rhythm
}

function camp(n = 6) {
  const ai = new AISystem({ maxAttackSlots: 3 })
  const rhythm = rhythmOf()
  const player = fakePlayer(0, 0)
  const enemies = Array.from({ length: n }, (_, i) => {
    const ang = (i / n) * Math.PI * 2
    const e = ai.spawn('en_driftsinger', { x: Math.cos(ang) * 4, y: 0, z: Math.sin(ang) * 4 }, 'camp' + i)
    e.alertness = 100
    e.enter('combat')
    return e
  })
  return { ai, rhythm, player, enemies }
}

function step(w: ReturnType<typeof camp>, from: number, to: number, onTick?: (tick: number) => void): void {
  for (let tick = from; tick <= to; tick++) {
    w.ai.update(TICK_DT, tick, w.player, w.rhythm)
    w.rhythm.update(TICK_DT)
    onTick?.(tick)
  }
}

const threatCount = (w: ReturnType<typeof camp>, id: string): number => w.ai.squad.getMember(id)?.threats.length ?? -1

describe('KI-401 脱战后的仇恨表：该留的留、该清的清', () => {
  it('玩家瞬移 60 米：5 秒内条目全清、名次与槽一起放掉', () => {
    const w = camp(6)
    step(w, 1, 600)
    expect(w.enemies.map((e) => threatCount(w, e.id)), '交战 10 秒后每人一笔账（数值可能已是 0）').toEqual([1, 1, 1, 1, 1, 1])
    expect(w.enemies.some((e) => e.squadHasSlot), '这 10 秒里确实在打').toBe(true)

    w.player.pos.x = 60
    const cleared = new Map<string, number>()
    step(w, 601, 1200, (tick) => {
      for (const e of w.enemies) if (!cleared.has(e.id) && threatCount(w, e.id) === 0) cleared.set(e.id, tick)
    })
    expect(cleared.size, '600 拍之内六个人都清干净').toBe(6)
    const worst = Math.max(...cleared.values())
    expect(worst - 600, '最后一个清掉的时刻（离开后多少拍）').toBeLessThanOrEqual(240)
    for (const e of w.enemies) {
      expect(threatCount(w, e.id), e.id + ' 的旧账').toBe(0)
      expect(w.ai.squad.getMember(e.id)?.currentTarget, '目标指针跟着账一起清').toBeNull()
      expect(e.squadWaitRank, '名次').toBe(0)
      expect(e.squadHasSlot, '槽位').toBe(false)
    }
    expect(w.enemies.every((e) => e.state === 'patrol' || e.state === 'search' || e.state === 'investigate')).toBe(true)
  })

  it('反向边界：还在交战的 0 值条目留着；掉出交战态才清，回来只补一条', () => {
    const w = camp(4)
    step(w, 1, 1200)
    for (const e of w.enemies) {
      const m = w.ai.squad.getMember(e.id)!
      expect(m.threats.length, e.id + ' 交了 20 秒，数值早已是 0，条目仍必须留着（KI-379）').toBe(1)
      expect(m.threats[0]!.threat).toBeLessThanOrEqual(0.01)
      expect(e.state).toBe('combat')
    }

    const one = w.enemies[0]!
    w.player.pos.x = 60
    one.alertness = 0 // 真实的脱战入口：玩家看不见了，警觉先掉下去（搜索态才有意义）
    one.enter('search')
    step(w, 1201, 1202)
    expect(threatCount(w, one.id), '离开交战的下一拍，0 值条目被滤掉').toBe(0)

    // 回来那一步只测「重新进交战集合时补账」这条合成规则：感知爬警觉那一支另有尺
    // （10Hz × 3.4 点，约 180 拍），不在这里重复量。进门这一下直接摆成 chase。
    w.player.pos.x = one.pos.x
    one.enter('chase')
    step(w, 1203, 1203)
    const m = w.ai.squad.getMember(one.id)!
    expect(m.threats.length, '回来时 AISystem 补回一笔，不是第二套账').toBe(1)
    expect(m.threats[0]!.threat, '这一笔要够格（阈值 + 1）').toBeGreaterThan(10)
  })

  it('三轮逃离／回来：条目不累加，出手能恢复', () => {
    const w = camp(6)
    let tick = 1
    step(w, tick, 600); tick = 600
    for (let round = 0; round < 3; round++) {
      w.player.pos.x = w.player.pos.x === 0 ? 60 : 0
      const until = tick + 900
      for (; tick < until; tick++) {
        w.ai.update(TICK_DT, tick, w.player, w.rhythm)
        w.rhythm.update(TICK_DT)
        for (const e of w.enemies) {
          expect(threatCount(w, e.id), '第 ' + round + ' 轮：任何人的账都不超过一条').toBeLessThanOrEqual(1)
        }
      }
    }
    w.player.pos.x = 0
    let attacks = 0
    for (let i = 0; i < 900; i++, tick++) {
      w.ai.update(TICK_DT, tick, w.player, w.rhythm)
      w.rhythm.update(TICK_DT)
      if (w.enemies.some((e) => e.attack)) attacks++
    }
    expect(attacks, '三轮之后重新接战，出手没有卡死').toBeGreaterThan(300)
  })
})
