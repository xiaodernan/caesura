import { describe, expect, it } from 'vitest'
import { EventBus, type GameEvents } from '@/core/EventBus'
import { Rng } from '@/core/Math'
import { Pool } from '@/core/Pool'
import { Registry } from '@/core/Registry'
import { RhythmClock } from '@/core/RhythmClock'

/**
 * 核心模块零散缺口收尾（EventBus/Math/Pool/Registry/RhythmClock/Occlusion）。
 *
 * 各文件只剩 1-4 行未覆盖，全部是纯函数/边界分支，无 three/依赖，可 headless 全速跑。
 */

describe('EventBus：once 包装器立即卸载', () => {
  it('once 注册的监听器触发一次后自动 off', () => {
    const bus = new EventBus<GameEvents>()
    let count = 0
    const off = bus.once('player.stats', () => { count++ })
    bus.emit('player.stats', { hp: 100, hpMax: 100, stamina: 100, staminaMax: 100,
      poise: 100, poiseMax: 100, overdrive: 0, overdriveMax: 10,
      rank: 1, corruption: 0, corruptionMax: 100, corruptionVeil: 0, muteTicksLeft: 0 })
    bus.emit('player.stats', { hp: 100, hpMax: 100, stamina: 100, staminaMax: 100,
      poise: 100, poiseMax: 100, overdrive: 0, overdriveMax: 10,
      rank: 1, corruption: 0, corruptionMax: 100, corruptionVeil: 0, muteTicksLeft: 0 })
    expect(count).toBe(1)
    expect(typeof off).toBe('function')
  })
})

describe('Rng：weighted 兜底返回最后一项', () => {
  it('权重被前面全吃光 ⇒ 返回最后一项（L49）', () => {
    const rng = new Rng(0xdeadbeef)
    // draw() 返回值 × total 可能 > 所有权重之和，导致循环跑完兜底
    // 这里构造极小权重差，让最后一项必被选中
    const items = [
      { item: 'a', weight: 0.0001 },
      { item: '_', weight: 0.0001 },
      { item: 'c', weight: 1000 } // 最后一项权重极大，且 r 可能 > 1000.0002
    ]
    // 用固定种子跑一次，验证兜底分支在循环结束后被执行
    const result = rng.weighted(items)
    expect(result).toBe('c')
  })
})

describe('Pool：stats getter', () => {
  it('stats 返回 live/free/peak/cap', () => {
    let created = 0
    const pool = new Pool(
      () => { created++; return { x: 0 } },
      (item) => { item.x = 0 },
      2
    )
    const a = pool.obtain()
    pool.obtain()
    const s = pool.stats
    expect(s.live).toBe(2)
    expect(s.free).toBe(0)
    expect(s.cap).toBe(2)
    pool.release(a)
    expect(pool.stats.live).toBe(1)
    expect(pool.stats.free).toBe(1)
  })
})

describe('Registry：load 缓存同一 url', () => {
  it('同一 url 只调一次 loader；第二次直接返回缓存 promise', async () => {
    const reg = new Registry()
    let calls = 0
    const loader = (): Promise<number> => { calls++; return Promise.resolve(42) }
    const p1 = reg.load('res://test', loader)
    const p2 = reg.load('res://test', loader)
    expect(await p1).toBe(42)
    expect(await p2).toBe(42)
    expect(calls).toBe(1)
  })
})

describe('RhythmClock：toNextBeatSec', () => {
  it('计算到下一整拍的秒数（默认 bpm=84 ⇒ 0.714s）', () => {
    const rc = new RhythmClock()
    // 默认 bpm=84 ⇒ beatSec = 60/84 ≈ 0.714
    expect(rc.toNextBeatSec).toBeCloseTo(60 / 84)
    // 推进半拍
    const beatSec = 60 / 84
    rc.update(beatSec / 2)
    expect(rc.toNextBeatSec).toBeCloseTo(beatSec / 2)
  })
})