import { describe, expect, it } from 'vitest'
import { createConfigAggregator } from '../../scripts/caesura-config-aggregator.mjs'

describe('caesura-config-aggregator', () => {
  it('addSource + aggregate 合并全部源', async () => {
    const a = createConfigAggregator()
    a.addSource('base', () => ({ a: 1, b: 2 }))
    a.addSource('extra', () => ({ c: 3 }))
    expect(await a.aggregate()).toEqual({ a: 1, b: 2, c: 3 })
  })

  it('优先级大者覆盖小者', async () => {
    const a = createConfigAggregator()
    a.addSource('low', () => ({ x: 1 }), 0)
    a.addSource('high', () => ({ x: 2 }), 10)
    expect(await a.aggregate()).toEqual({ x: 2 })
  })

  it('get(key) 返回合并后的值', async () => {
    const a = createConfigAggregator()
    a.addSource('s', () => ({ k: 'v' }))
    expect(await a.get('k')).toBe('v')
  })

  it('setOverride 覆盖所有源', async () => {
    const a = createConfigAggregator()
    a.addSource('s', () => ({ x: 1 }))
    a.setOverride({ x: 99 })
    expect(await a.aggregate()).toEqual({ x: 99 })
  })

  it('缺失 key 返回 undefined', async () => {
    const a = createConfigAggregator()
    a.addSource('s', () => ({ x: 1 }))
    expect(await a.get('missing')).toBeUndefined()
  })

  it('空源返回空对象', async () => {
    const a = createConfigAggregator()
    expect(await a.aggregate()).toEqual({})
  })
})
