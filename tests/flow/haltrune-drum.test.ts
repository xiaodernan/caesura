import { afterEach, describe, expect, it } from 'vitest'
import { registerGameData, regions, worldstate } from '@/data'
import { StreamingSystem } from '@/world/Streaming'
import { WorldState } from '@/quest/WorldState'
import { WorldStates } from '@/quest/WorldStates'
import { worldStates as stateTable } from '@/data'
import { registry } from '@/core/Registry'
import { readFileSync } from 'node:fs'

/**
 * §2.4 断弦 DRUM_LEGEND 的音频腿（KI-309 留账的兑现）：「一个会自己打更的鼓，某些夜晚
 * 玩家路过真能听见」——更鼓是营地声床的**变体**（`mus_brokenbar_amb_drum` = 同床 +
 * 一记周期低鼓挂在鼓的位置），选择由 stateSet 规则派生的旗驱动（fate=DRUM_LEGEND ⇒
 * `flag.haltrune_drum`），与盐歌人声垫片同一台机器（stateSet→旗→选床函数）。
 */

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

const MAIN = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')

function makeWorld() {
  registerGameData()
  const streaming = new StreamingSystem(regions)
  const states = new WorldStates(stateTable)
  const worldState = new WorldState(worldstate, {
    hasFlag: (k) => streaming.hasFlag(k),
    setFlag: (k) => streaming.setFlag(k, true)
  })
  alive.push(() => { worldState.dispose(); states.dispose(); streaming.dispose() })
  return { streaming, states, cleanup: () => { worldState.dispose(); states.dispose(); streaming.dispose() } }
}

describe('更鼓：fate 落格 ⇒ stateSet 派生旗 ⇒ 营地声床换变体', () => {
  it('变体行存在且是「同一张床加一源」：源集为超集、多出的那源挂在鼓上且是稀疏低鼓', () => {
    registerGameData()
    const base = registry.get<{ id: string; sources: Array<{ hz: number; pos: { x: number; z: number }; everySec: number[]; durSec: number }> }>('mus_brokenbar_amb')
    const drum = registry.get<{ id: string; sources: Array<{ hz: number; pos: { x: number; z: number }; everySec: number[]; durSec: number }> }>('mus_brokenbar_amb_drum')
    expect(drum.sources.length, '同床 + 一源').toBe(base.sources.length + 1)
    const extra = drum.sources.filter((s) => !base.sources.some((b) => b.hz === s.hz && b.pos.x === s.pos.x && b.pos.z === s.pos.z))
    expect(extra.length).toBe(1)
    expect(extra[0].hz, '低频鼓体感（98Hz ≈ G2）').toBeLessThan(150)
    expect(extra[0].pos.x).toBe(-100) // 挂在 st_brokenbar_nightdrum 的位置
    expect(extra[0].pos.z).toBe(-330)
    expect(extra[0].everySec[0], '稀疏：夜巡的节拍不是急促的（≥8s 一记）').toBeGreaterThanOrEqual(8)
  })

  it('stateSet 派生链：fate=DRUM_LEGEND ⇒ flag.haltrune_drum（第三条 stateSet 规则）；别的 fate 不触发', () => {
    const w = makeWorld()
    w.states.set('state.haltrune.fate', 'PASSING_STILL')
    expect(w.streaming.hasFlag('flag.haltrune_drum')).toBe(false)
    w.states.set('state.haltrune.fate', 'DRUM_LEGEND')
    expect(w.streaming.hasFlag('flag.haltrune_drum'), '传说成真那一拍，更鼓的旗立起').toBe(true)
    w.cleanup()
  })

  it('选床的机械关系写在组合根（源码门）：营地读 haltrune_drum 旗、后缀 _drum 派生', () => {
    expect(MAIN).toContain('`ambienceBedOf` 之外的第三个入口'.length > 0 ? 'flag.haltrune_drum' : '')
    expect(MAIN).toContain('`${baseId}_drum`')
    expect(MAIN).toContain("regionId === 'rg_brokenbar_camp'")
  })

  it('夜鼓陈设读同一面旗（世界的可听物与耳朵听到的同一份账）', () => {
    const w = makeWorld()
    const bed = () => w.streaming.hasFlag('flag.haltrune_drum') ? 'mus_brokenbar_amb_drum' : 'mus_brokenbar_amb'
    expect(bed()).toBe('mus_brokenbar_amb')
    w.states.set('state.haltrune.fate', 'DRUM_LEGEND')
    expect(bed(), '旗立 ⇒ 选床函数的答案换到更鼓变体（发射在渲染循环，这里量决策量）').toBe('mus_brokenbar_amb_drum')
    w.cleanup()
  })
})
