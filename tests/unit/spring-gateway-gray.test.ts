import { describe, expect, it } from 'vitest'
import {
  GRAY_DEFAULTS,
  createGrayRouter,
  hashSelector,
} from '../../scripts/spring-gateway-gray.mjs'

const inst = (id: string, metadata: any = {}, healthy = true) => ({ id, name: 'gray-svc', address: '10.0.0.' + id, port: 8080, healthy, metadata })

describe('spring-gateway-gray（KI-491 灰度/金丝雀加权路由）', () => {
  it('① 名册：GRAY_DEFAULTS 默认 0% 金丝雀 + hashSelector 确定性同 key 同桶', () => {
    expect(GRAY_DEFAULTS).toMatchObject({ stickyHeader: 'x-canary-key', grayField: 'canary', weightField: 'weight', canaryPercent: 0 })
    const h = hashSelector('salt')
    expect(h({ key: 'p42' })).toBe(h({ key: 'p42' })) // 会话亲和：同 key 必同桶
    expect(h({ key: 'p42' })).toBeGreaterThanOrEqual(0)
    expect(h({ key: 'p42' })).toBeLessThanOrEqual(1)
    expect(h({ key: 'p43' })).not.toBe(h({ key: 'p42' })) // 不同 key 通常不同桶
    const other = hashSelector('other-salt')
    expect(other({ key: 'p42' })).not.toBe(h({ key: 'p42' })) // 盐影响桶
  })

  it('② decide 亲和键：命中 stickyHeader（大小写不敏感）优先，否则退 path', () => {
    const gray = createGrayRouter({ stickyHeader: 'x-player-id' })
    const d1 = gray.decide({ path: '/a', headers: { 'X-Player-Id': 'p7' } })
    const d2 = gray.decide({ path: '/b', headers: { 'x-player-id': 'p7' } })
    expect(d1.key).toBe('p7')
    expect(d1.bucket).toBe(d2.bucket) // 同 key ⇒ 同桶，与 path 无关 ⇒ 会话亲和
    const d3 = gray.decide({ path: '/api/fight' })
    expect(d3.key).toBe('/api/fight') // 无亲和头退 path
  })

  it('③ decide 阈值：0% 永不金丝雀 / 100% 永远 / [0,100] 夹取 / 每次调用可覆盖', () => {
    const never = createGrayRouter({ canaryPercent: 0 })
    expect(never.decide({ headers: { 'x-canary-key': 'k' } }).wantCanary).toBe(false)
    const always = createGrayRouter({ canaryPercent: 100 })
    expect(always.decide({ headers: { 'x-canary-key': 'k' } }).wantCanary).toBe(true)
    const g = createGrayRouter({ selector: () => 0.04 }) // 桶=4%
    expect(g.decide({ headers: { 'x-canary-key': 'k' }, canaryPercent: 5 }).wantCanary).toBe(true) // 4<5
    expect(g.decide({ headers: { 'x-canary-key': 'k' }, canaryPercent: 3 }).wantCanary).toBe(false) // 4>=3
    expect(g.decide({ headers: { 'x-canary-key': 'k' }, canaryPercent: 999 }).canaryPercent).toBe(100) // 夹取
    expect(g.decide({ headers: { 'x-canary-key': 'k' }, canaryPercent: -5 }).canaryPercent).toBe(0)
  })

  it('④ split 按 metadata[grayField] 分稳定/金丝雀两池，滤掉 healthy:false 并计数', () => {
    const gray = createGrayRouter()
    const rows = [inst('1'), inst('2', { canary: true }), inst('3', { canary: true, weight: 2 }), inst('4', {}, false), inst('5', { healthy: false })]
    const { primary, canary } = gray.split(rows)
    expect(primary.map((x) => x.id)).toEqual(['1'])
    expect(canary.map((x) => x.id)).toEqual(['2', '3'])
    expect(gray.stats().droppedUnhealthy).toBe(2) // 顶层 healthy:false + metadata.healthy:false 都没进池、也不参与选择
  })

  it('⑤ weightedPick 按 metadata[weight] 加权（注入 rand 可确定边界）+ 非法权重兜底 1 + 空池返回 null', () => {
    const gray = createGrayRouter({ rand: () => 0 }) // 总权重 4，r=0 → 落第一只
    const pool = [inst('a', { weight: 3 }), inst('b', { weight: 1 })]
    expect(gray.weightedPick(pool).id).toBe('a')
    const edge = createGrayRouter({ rand: () => 0.9 }) // r=3.6 ⇒ 越过权重3，落第二只
    expect(edge.weightedPick(pool).id).toBe('b')
    expect(gray.weightedPick([inst('x', { weight: 'nonsense' })])).toBeTruthy() // 非法权重按 1 兜底
    expect(gray.weightedPick([])).toBe(null)
  })

  it('⑥ select 想走金丝雀且该池非空 ⇒ lane=canary、fallback=false', () => {
    const gray = createGrayRouter()
    const rows = [inst('stable', {}), inst('can', { canary: true, weight: 1 })]
    const d = { key: 'k', bucket: 0, wantCanary: true, canaryPercent: 100 }
    const picked = gray.select(rows, d)
    expect(picked).toMatchObject({ ok: true, lane: 'canary', fallback: false })
    expect(picked.instance.id).toBe('can')
    expect(gray.stats().canary).toBe(1)
  })

  it('⑦ select 想走金丝雀但池空 ⇒ 诚实回退稳定池、fallback=true；两池全空 ⇒ no_instance', () => {
    const gray = createGrayRouter()
    const d = { key: 'k', bucket: 0, wantCanary: true, canaryPercent: 100 }
    const onlyStable = gray.select([inst('stable')], d)
    expect(onlyStable).toMatchObject({ ok: true, lane: 'primary', fallback: true })
    expect(onlyStable.instance.id).toBe('stable')
    expect(gray.stats().fallback).toBe(1)
    const empty = gray.select([], d)
    expect(empty).toMatchObject({ ok: false, lane: null, reason: 'no_instance', fallback: false })
    expect(gray.stats().noInstance).toBe(1)
  })

  it('⑧ route 一步到位（decide+select）回带 decision；stats/reset 可观测可清零', () => {
    const gray = createGrayRouter({ canaryPercent: 100 })
    const r = gray.route({ path: '/api/x', headers: { 'x-canary-key': 'u1' } }, [inst('s'), inst('c', { canary: true })])
    expect(r).toMatchObject({ ok: true, lane: 'canary', fallback: false })
    expect(r.decision).toMatchObject({ key: 'u1', wantCanary: true, canaryPercent: 100 })
    expect(gray.stats().decisions).toBe(1)
    gray.reset()
    expect(gray.stats()).toMatchObject({ decisions: 0, canary: 0, primary: 0, fallback: 0, noInstance: 0, droppedUnhealthy: 0 })
  })

  it('⑨ 自定义字段名 + canaryValue 精确值：version=v1/v2 拓扑只把 v2 当金丝雀', () => {
    const gray = createGrayRouter({
      stickyHeader: 'x-cohort', grayField: 'version', canaryValue: 'v2', weightField: 'traffic',
      canaryPercent: 100, selector: () => 0, rand: () => 0,
    })
    expect(gray.grayField).toBe('version')
    expect(gray.canaryValue).toBe('v2')
    // v1/v2 都 truthy；没有 canaryValue 会双误判。精确值只把 v2 收进金丝雀池。
    const rows = [inst('stable', { version: 'v1' }), inst('can', { version: 'v2', traffic: 5 })]
    const { primary, canary } = gray.split(rows)
    expect(primary.map((x) => x.id)).toEqual(['stable'])
    expect(canary.map((x) => x.id)).toEqual(['can'])
    const r = gray.route({ path: '/p', headers: { 'x-cohort': 'beta' } }, rows)
    expect(r.decision.key).toBe('beta') // 自定义亲和头
    expect(r.lane).toBe('canary')
    expect(r.instance.id).toBe('can')
  })
})
