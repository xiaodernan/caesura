import { describe, expect, it } from 'vitest'
import { createTracer } from '../../scripts/spring-sleuth-tracer.mjs'

describe('spring-sleuth-tracer', () => {
  it('startSpan 生成带 traceId/id/serviceName/timestamp 的 span', () => {
    const tr = createTracer({ serviceName: 'game' })
    const s = tr.startSpan('boot')
    expect(s.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(s.id).toMatch(/^[0-9a-f]{16}$/)
    expect(s.localEndpoint?.serviceName).toBe('game')
    expect(s.timestamp).toBeGreaterThan(0)
    expect(s.parentId).toBeNull()
  })

  it('子 span 继承父 traceId 并设 parentId', () => {
    const tr = createTracer({ serviceName: 'game' })
    const parent = tr.startSpan('boot')
    const child = tr.startSpan('call', parent)
    expect(child.traceId).toBe(parent.traceId)
    expect(child.parentId).toBe(parent.id)
  })

  it('inject 产出合法 W3C traceparent', () => {
    const tr = createTracer({ serviceName: 'game' })
    const s = tr.startSpan('x')
    const tp = tr.inject(s)
    expect(tp).toBe(`00-${s.traceId}-${s.id}-01`)
  })

  it('extract 还原 traceparent 为 {traceId,parentId}', () => {
    const tr = createTracer({ serviceName: 'game' })
    const s = tr.startSpan('x')
    const tp = tr.inject(s)
    const got = tr.extract({ traceparent: tp })
    expect(got?.traceId).toBe(s.traceId)
    expect(got?.parentId).toBe(s.id)
    expect(tr.extract({})).toBeNull()
  })

  it('finish 计算 duration 并收集进 spans', () => {
    const tr = createTracer({ serviceName: 'game' })
    const s = tr.startSpan('x')
    const finished = tr.finish(s, { remoteEndpoint: { serviceName: 'svc-a' }, tags: { k: 'v' } })
    expect(finished.duration).toBeGreaterThanOrEqual(0)
    expect(finished.remoteEndpoint?.serviceName).toBe('svc-a')
    expect(finished.tags.k).toBe('v')
    expect(tr.spans().length).toBe(1)
  })

  it('同一 tracer 下的父/子 span 共享 traceId 且收集器含两者', () => {
    const tr = createTracer({ serviceName: 'game' })
    const p = tr.startSpan('parent')
    const c = tr.startSpan('child', p)
    tr.finish(p)
    tr.finish(c)
    const all = tr.spans()
    expect(all.length).toBe(2)
    expect(all.every((x) => x.traceId === p.traceId)).toBe(true)
  })
})
