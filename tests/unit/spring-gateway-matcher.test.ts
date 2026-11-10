import { describe, expect, it } from 'vitest'
import { createGatewayMatcher } from '../../scripts/spring-gateway-matcher.mjs'

function tableFrom(routes: any[]) {
  const sorted = [...routes].sort((a, b) => a.order - b.order)
  return { list: () => sorted }
}

describe('spring-gateway-matcher', () => {
  it('Path predicate 命中则返回路由', () => {
    const m = createGatewayMatcher()
    const t = tableFrom([{ id: 'r1', uri: 'lb://svc-a', order: 0, predicates: [{ name: 'Path', args: { patterns: '/api/**' } }], filters: [] }])
    const got = m.matchRoute(t, { path: '/api/foo' })
    expect(got).not.toBeNull()
    expect(got!.route.id).toBe('r1')
  })

  it('Path 不命中返回 null', () => {
    const m = createGatewayMatcher()
    const t = tableFrom([{ id: 'r1', uri: 'lb://svc-a', order: 0, predicates: [{ name: 'Path', args: { patterns: '/api/**' } }], filters: [] }])
    expect(m.matchRoute(t, { path: '/other/x' })).toBeNull()
  })

  it('order 较小的路由优先匹配', () => {
    const m = createGatewayMatcher()
    const t = tableFrom([
      { id: 'low', uri: 'lb://a', order: 0, predicates: [{ name: 'Path', args: { patterns: '/x/**' } }], filters: [] },
      { id: 'high', uri: 'lb://b', order: 10, predicates: [{ name: 'Path', args: { patterns: '/x/**' } }], filters: [] },
    ])
    const got = m.matchRoute(t, { path: '/x/1' })
    expect(got!.route.id).toBe('low')
  })

  it('Method predicate 按动词过滤', () => {
    const m = createGatewayMatcher()
    const t = tableFrom([{ id: 'r', uri: 'lb://a', order: 0, predicates: [{ name: 'Method', args: { methods: ['GET', 'POST'] } }], filters: [] }])
    expect(m.matchRoute(t, { path: '/x', method: 'POST' })).not.toBeNull()
    expect(m.matchRoute(t, { path: '/x', method: 'DELETE' })).toBeNull()
  })

  it('Header predicate 按正则过滤', () => {
    const m = createGatewayMatcher()
    const t = tableFrom([{ id: 'r', uri: 'lb://a', order: 0, predicates: [{ name: 'Header', args: { header: 'X-Tenant', regex: '^t1$' } }], filters: [] }])
    expect(m.matchRoute(t, { path: '/x', headers: { 'x-tenant': 't1' } })).not.toBeNull()
    expect(m.matchRoute(t, { path: '/x', headers: { 'x-tenant': 't2' } })).toBeNull()
  })

  it('Weight predicate 使用注入式 selector', () => {
    const always = createGatewayMatcher({ weightSelector: () => 0 }) // 0*100 < weight → 命中
    const never = createGatewayMatcher({ weightSelector: () => 1 }) // 100 < weight(50) 为否
    const route = { id: 'r', uri: 'lb://a', order: 0, predicates: [{ name: 'Weight', args: { group: 'g', weight: 50 } }], filters: [] }
    const tHit = tableFrom([route])
    expect(always.matchRoute(tHit, { path: '/x' })).not.toBeNull()
    expect(never.matchRoute(tHit, { path: '/x' })).toBeNull()
  })

  it('runWithFilters 按 handler 顺序执行并可读 chain', async () => {
    const m = createGatewayMatcher()
    const route = { id: 'r', uri: 'lb://a', order: 0, predicates: [], filters: [
      { name: 'CircuitBreaker', args: { name: 'svcA' } },
      { name: 'Retry', args: { attempts: 3 } },
    ] }
    const seen: string[] = []
    const ctx = { result: 'done' }
    const handlers = {
      CircuitBreaker: async (_a: any, c: any, next: () => Promise<any>) => { seen.push('cb'); c.result = 'cb-' + c.result; return next() },
      Retry: async (_a: any, c: any, next: () => Promise<any>) => { seen.push('retry'); c.result = 'retry-' + c.result; return next() },
    }
    const res = await m.runWithFilters(route, ctx, handlers)
    expect(seen).toEqual(['cb', 'retry'])
    expect(res).toBe('retry-cb-done')
    expect(m.planFilters(route).map((f) => f.name)).toEqual(['CircuitBreaker', 'Retry'])
  })

  it('runWithFilters 可重入：Retry handler 多次 await next() 会真重跑下游与 terminal（KI-486）', async () => {
    const m = createGatewayMatcher()
    const route = { id: 'r', uri: 'lb://a', order: 0, predicates: [], filters: [{ name: 'Retry', args: { attempts: 3 } }] }
    let termRuns = 0
    const terminal = async () => { termRuns += 1; if (termRuns < 3) throw new Error(`fail#${termRuns}`); return 'ok' }
    const handlers = {
      Retry: async (args: any, ctx: any, next: () => Promise<any>) => {
        const attempts = Number(args.attempts ?? 3)
        let last: unknown
        for (let i = 0; i < attempts; i++) {
          try { return await next() } catch (e) { last = e }
        }
        throw last
      },
    }
    const res = await m.runWithFilters(route, {}, handlers, terminal)
    expect(res).toBe('ok')
    expect(termRuns).toBe(3) // 真跑了三次 terminal，而非只前进一次的共享游标
  })

  it('runWithFilters 缺省 3 参调用仍读 ctx.result（向后兼容 KI-475）', async () => {
    const m = createGatewayMatcher()
    const route = { id: 'r', uri: 'lb://a', order: 0, predicates: [], filters: [{ name: 'X', args: {} }] }
    const res = await m.runWithFilters(route, { result: 42 }, { X: async (_a: any, c: any, next: () => Promise<any>) => next() })
    expect(res).toBe(42)
  })
})
