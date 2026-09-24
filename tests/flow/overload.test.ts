import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { items, registerGameData, playerBase } from '@/data'
import { progressionData } from '@/rpg/Progression'
import type { ItemData, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { RpgRuntime } from '@/rpg/Runtime'
import { refreshPlayer } from '@/rpg/Settlement'

/**
 * 负重超载的**可见性**（需求 §25「每次输入都要有可感知的反馈」；KI-027 的一项）。
 *
 * 三条惩罚（翻滚拒、疾跑拒、体力回复 −40%）一直是真的，但一条都不出声：玩家按下翻滚键只知道
 * "键坏了"。这一步补的是"为什么"，而测试同时钉两件事：
 * ①那句解释**不撒谎**——报的重量与上限就是 `mods()` 里那两个数，回复那一半单独量出来对一次 0.6；
 * ②它不是新的刷屏源——连打只播一次，冷却走完可以再播。
 *
 * 顺带把一件只有对账才能发现的事钉在这里：见最后一条用例——**当前装备表下超载不可达**。
 * 那条用例不是"测试顺便测了下数据"，它是这条惩罚的存活证明：哪天有人加了更重的甲或调低上限，
 * 它会红，提醒回去看这三条惩罚还平不平衡（同一族的先例是 KI-032 的"影子上限没有真实压力"）。
 */

registerGameData()

/** 注入用的重量：比任何出身的上限都大，比最重搭配也大——它只负责"让状态为真"，数字要出现在提示里 */
const FORCED = { weight: 99, loadMax: 40 }

function makeWorld(seed = 'overload') {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime('origin_tuner', seed)
  const weapon = registry.get<WeaponData>(rpg.mods().weaponId!)
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const notes: string[] = []
  const off = bus.on('ui.notify', (p) => notes.push(p.text))
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  refreshPlayer(rpg, player) // 生产那份胶水：装备栏 → 玩家面板

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
  /**
   * 把玩家放进"超载"这个状态。走的是 `applyRpg` 那扇门（面板给玩家的就是这一份乘数快照），
   * 因为按现有装备表**装不出**超载——这件事本身有专门一条用例钉着，不靠这里糊过去。
   */
  const setOverloaded = (on: boolean): void => {
    const m = rpg.mods()
    player.applyRpg({ ...m, weight: on ? FORCED.weight : m.weight, loadMax: on ? FORCED.loadMax : m.loadMax, overloaded: on })
    expect(player.rpg.overloaded, '前提：状态确实翻过去了').toBe(on)
  }
  const pressDodge = (): void => {
    frame.edges.add('dodge')
    tick()
  }
  return { time, rhythm, rpg, player, notes, tick, setOverloaded, pressDodge, off }
}

const overloadNotes = (list: string[]): string[] => list.filter((n) => n.includes('负重超载'))

describe('§5.1 负重超载：拒判要出声，而且说的要是真的', () => {
  it('超载时按翻滚：不出翻滚，但出一句带着重量与上限的解释', () => {
    const w = makeWorld()
    w.setOverloaded(true)
    w.pressDodge()
    expect(w.player.roll, '翻滚确实被拒了').toBeNull()
    const said = overloadNotes(w.notes)
    expect(said.length, '拒了就必须说一句（不然玩家只知道键坏了）').toBe(1)
    expect(said[0], '报出来的两个数就是判据用的那两个数').toContain(`${FORCED.weight} / ${FORCED.loadMax} kg`)
    expect(said[0]).toContain('翻滚与疾跑禁用')
    expect(said[0]).toContain('体力回复 −40%')
    w.off()
  })

  it('连打不刷屏：冷却里只播一次，冷却走完可以再说第二次', () => {
    const w = makeWorld()
    w.setOverloaded(true)
    for (let i = 0; i < 12; i++) w.pressDodge()
    expect(overloadNotes(w.notes).length, '12 次按键配一条提示').toBe(1)
    expect(w.player.roll, '每一次都被拒着（提示不该顺手把翻滚放出来）').toBeNull()
    w.tick(130)
    w.pressDodge()
    expect(overloadNotes(w.notes).length, '还在超载，冷却走完就该再说一次').toBe(2)
    w.off()
  })

  it('不超载时：翻滚照常出来，那句也不该出现', () => {
    const w = makeWorld()
    w.setOverloaded(false)
    w.pressDodge()
    expect(w.player.roll, '正常负重就该滚出去').not.toBeNull()
    expect(overloadNotes(w.notes).length, '正常状态不该被这句骚扰').toBe(0)
    w.off()
  })

  it('那句"体力回复 −40%"是真的：生效的回复乘子比值 = 0.6', () => {
    /**
     * 量的是**实际挂到 `EntityStats.mods.regenMul` 上的那个乘子**，不是"回了多少体力"：
     * 后者会被上限截断（两跑都回满就量不出比例），那是量具的假绿而不是惩罚的存在证明。
     */
    const mul = (overloaded: boolean): number => {
      const w = makeWorld(`regen-${overloaded}`)
      w.setOverloaded(overloaded)
      w.player.stats.stamina = 20
      w.tick(1)
      const applied = w.player.stats.mods.regenMul
      w.off()
      return applied
    }
    const light = mul(false)
    const heavy = mul(true)
    expect(light, '量具失效：不超载时这个乘子本身是 0').toBeGreaterThan(0)
    expect(heavy / light, '回复乘子就是那句提示说的 0.6').toBeCloseTo(0.6, 6)
  })
})

describe('超载这条惩罚的存活证明：它现在可达吗（数据对账）', () => {
  it('当前装备表下**装不出**超载：最重搭配仍低于最轻的那条负身上限', () => {
    const prog = progressionData()
    const heaviest: Record<string, number> = {}
    for (const item of items as ItemData[]) {
      const gear = item.gear
      if (!gear) continue
      const slot = gear.slot === 'sealA' || gear.slot === 'sealB' ? 'seal' : gear.slot
      heaviest[slot] = Math.max(heaviest[slot] ?? 0, gear.weight ?? 0)
    }
    const maxWearable = ['weapon', 'helm', 'cuirass', 'gloves', 'greaves'].reduce((s, k) => s + (heaviest[k] ?? 0), 0)
    const minLoadMax = Math.min(...prog.origins.map((o) => Math.round(prog.derived.load.base + prog.derived.load.perStr * o.attrs.str)))
    // ⚠ KI-054 之后 `milestones[].grant.loadFlat`（rank4 的 +8）真的进了 `derive()`，它会**抬高**上限，
    // 而这条判据取的是"不带任何里程碑的最轻上限"——grant 只会把差距拉大，不会把它反转，
    // 所以判据仍然成立（且比 grant 之前更保守）。
    // 断言写成"不可达"，并给出余量：哪天这件装备表把这条激活了，这条会红，
    // 红的那句就是要回去复核三条惩罚与提示的措辞，而不是把断言反过来一删了之。
    expect(maxWearable, `最重搭配 ${maxWearable} kg 对上最轻上限 ${minLoadMax} kg：已经可达了，回去复核这三条惩罚`).toBeLessThan(minLoadMax)
  })
})
