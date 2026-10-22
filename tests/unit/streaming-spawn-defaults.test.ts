import { describe, it, expect } from 'vitest'
import { registerGameData, regions } from '@/data'
import { StreamingSystem, DEFAULT_OPTIONS } from '@/world/Streaming'
import { SpawnDirector, DEFAULT_SPAWN_OPTIONS, type SpawnHost, type SpawnOptions } from '@/world/SpawnDirector'

registerGameData()

/**
 * 两个系统的默认参数（§5.4 流式预算 / §5.5 刷怪口径）。
 *
 * 这里**不锁具体数值**——调参不该让测试红。锁的是三条调参也推不翻的结构不变式：
 *   1. 环序单调 `activateRing < preloadRing < unloadRing`：若卸载圈被设得比预载圈还小，
 *      就会「未预载先卸载」，玩家永远走在已卸载的地面上。
 *   2. 节流/预算格为正：`loadTicks`/`maxInFlight`/`unloadDebounceTicks` 为 0 会让
 *      加载队列永久卡死或去抖立即触发。
 *   3. `jitter` 是**半径比例**，必须落在 [0,1]；给 1.5 会把布点甩到组外。
 * 另外锁 `{...DEFAULT, ...options}` 的**部分覆盖语义**——这是组合根最常踩的坑：
 * 只传一格时其余各格必须仍是默认值，否则"改一个预算"会静默改掉六个行为。
 *
 * 零覆盖：`streaming-lifecycle.test.ts` 没有一处引用这些默认值；`spawn.test.ts` 只是把
 * `{maxAlive:4}` 当构造参数测上限，没有断言过默认值本身。
 */
describe('Streaming.DEFAULT_OPTIONS：环序与预算的结构不变式（§5.4/§5.5）', () => {
  it('环序单调：activateRing < preloadRing < unloadRing', () => {
    expect(DEFAULT_OPTIONS.activateRing).toBeLessThan(DEFAULT_OPTIONS.preloadRing)
    expect(DEFAULT_OPTIONS.preloadRing).toBeLessThan(DEFAULT_OPTIONS.unloadRing)
  })

  it('节流与预算各格为正', () => {
    expect(DEFAULT_OPTIONS.loadTicks).toBeGreaterThan(0)
    expect(DEFAULT_OPTIONS.maxInFlight).toBeGreaterThan(0)
    expect(DEFAULT_OPTIONS.unloadDebounceTicks).toBeGreaterThan(0)
    expect(DEFAULT_OPTIONS.wholeFieldPreloadRings).toBeGreaterThan(0)
  })

  it('不传 options ⇒ 七格全等于默认值', () => {
    expect(new StreamingSystem(regions).options).toEqual(DEFAULT_OPTIONS)
  })

  it('部分覆盖：只给 maxInFlight，其余六格仍是默认值', () => {
    const s = new StreamingSystem(regions, { maxInFlight: 9 })
    expect(s.options.maxInFlight).toBe(9)
    expect(s.options.activateRing).toBe(DEFAULT_OPTIONS.activateRing)
    expect(s.options.preloadRing).toBe(DEFAULT_OPTIONS.preloadRing)
    expect(s.options.unloadRing).toBe(DEFAULT_OPTIONS.unloadRing)
    expect(s.options.unloadDebounceTicks).toBe(DEFAULT_OPTIONS.unloadDebounceTicks)
    expect(s.options.loadTicks).toBe(DEFAULT_OPTIONS.loadTicks)
    expect(s.options.wholeFieldPreloadRings).toBe(DEFAULT_OPTIONS.wholeFieldPreloadRings)
  })
})

describe('SpawnDirector.DEFAULT_SPAWN_OPTIONS：上限与抖动口径（§5.5）', () => {
  /** regions 为空 ⇒ host 永不被调用，构造只为读回 options */
  const make = (o?: Partial<SpawnOptions>) => {
    const d = new SpawnDirector([], {} as SpawnHost, () => 'k', o)
    return { d, opts: d.options }
  }

  it('maxAlive 为正；jitter 是半径比例故落在 [0,1]', () => {
    expect(DEFAULT_SPAWN_OPTIONS.maxAlive).toBeGreaterThan(0)
    expect(DEFAULT_SPAWN_OPTIONS.jitter).toBeGreaterThanOrEqual(0)
    expect(DEFAULT_SPAWN_OPTIONS.jitter).toBeLessThanOrEqual(1)
  })

  it('不传 options ⇒ 两格全等于默认值', () => {
    const { opts, d } = make()
    expect(opts).toEqual(DEFAULT_SPAWN_OPTIONS)
    d.dispose()
  })

  it('部分覆盖：只给 jitter，maxAlive 仍是默认值', () => {
    const { opts, d } = make({ jitter: 0.5 })
    expect(opts.jitter).toBe(0.5)
    expect(opts.maxAlive).toBe(DEFAULT_SPAWN_OPTIONS.maxAlive)
    d.dispose()
  })
})
