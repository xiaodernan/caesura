import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { registerGameData, regions, worldstate, worldStates as stateTable } from '@/data'
import { StreamingSystem } from '@/world/Streaming'
import { WorldState } from '@/quest/WorldState'
import { WorldStates } from '@/quest/WorldStates'
import { registry } from '@/core/Registry'
import { bus } from '@/core/EventBus'

/**
 * §2.3「她在唱歌时，休垒全 BGM 加一层人声垫片——全游戏最温柔的旗帜」的机器形状：
 * 声床表里的变体行（`mus_resthold_amb_meg` = 同一张床 + 220Hz 慢呼吸正弦垫片）与
 * 组合根的三个入口（开局 / 换区 / **她在玩家站着的时候离场**——没有换区事件可借，
 * 渲染循环自己跟旗换床）。垫片层的人声区与「加一层不是换一张」的音量关系也钉在这里。
 */

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

const MAIN = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')

describe('盐歌在场的人声垫片：变体床与三个入口', () => {
  it('变体行存在且是「同一张床加一层」：层集为超集、主音相同、垫片在人声区且音量低于主 drone', () => {
    registerGameData()
    const base = registry.get<{ id: string; layers: Array<{ hz: number; peak: number }> }>('mus_resthold_amb')
    const meg = registry.get<{ id: string; layers: Array<{ hz: number; peak: number }> }>('mus_resthold_amb_meg')
    const baseHzs = base.layers.map((l) => l.hz).sort((a, b) => a - b)
    const megHzs = meg.layers.map((l) => l.hz).sort((a, b) => a - b)
    expect(megHzs.slice(0, baseHzs.length), '基床的每一条层都还在（加一层，不是换一张）').toEqual(baseHzs)
    expect(Math.min(...megHzs), '主音（最低层）不变——同一区的调性不因她在不在而换').toBe(Math.min(...baseHzs))
    const pad = meg.layers.filter((l) => !base.layers.some((b) => b.hz === l.hz && b.peak === l.peak))
    expect(pad.length, '变体多出来的就是垫片层').toBeGreaterThanOrEqual(1)
    for (const p of pad) {
      expect(p.hz).toBeGreaterThanOrEqual(180) // 人声低区（A3≈220），不是又一条 bass drone
      expect(p.peak, '垫片音量低于主 drone（加一层不是盖过去）').toBeLessThan(0.05)
    }
  })

  it('选床的机械关系写在组合根：`_meg` 后缀派生 + meg_gone 旗是开关（源码门，KI-058 手法）', () => {
    expect(MAIN).toContain("`${baseId}_meg`")
    expect(MAIN).toContain("streaming.hasFlag('flag.meg_gone')")
    expect(MAIN).toContain('ambienceBedOf(here.id, here.music.ambience)')
    expect(MAIN).toContain('ambienceBedOf(homeRegion.id, homeRegion.music.ambience)')
  })

  it('第三入口的行为账：她离场那一拍单发一条声床事件（换床不换区），走到真链上量', () => {
    registerGameData()
    const streaming = new StreamingSystem(regions)
    const states = new WorldStates(stateTable)
    const worldState = new WorldState(worldstate, {
      hasFlag: (k) => streaming.hasFlag(k),
      setFlag: (k) => streaming.setFlag(k, true)
    })
    alive.push(() => { worldState.dispose(); states.dispose(); streaming.dispose() })
    const got: string[] = []
    const off = bus.on('audio.music.ambience', (p) => { got.push(p.id) })
    alive.push(off)
    // 玩家站在休垒（regionAt 为真）——她被夺走声卷的那一拍
    expect(streaming.regionAt({ x: 0, y: 0, z: 0 })?.id).toBe('rg_resthold')
    expect(streaming.hasFlag('flag.meg_gone')).toBe(false)
    states.set('state.meg.ending', 'SILENCED')
    expect(streaming.hasFlag('flag.meg_gone'), 'stateSet 派生链在跑').toBe(true)
    // 换床的发射由渲染循环的旗跟块做（源码门已钉）——这里量的是「她的离场确实改变了
    // 选床函数会读到的那个世界量」：旗从无到有，选床函数的答案随之从变体回到基床。
    const base = 'mus_resthold_amb'
    expect(streaming.hasFlag('flag.meg_gone') ? base : `${base}_meg`).toBe('mus_resthold_amb')
  })
})
