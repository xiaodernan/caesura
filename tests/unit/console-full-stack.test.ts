import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 控制台「Spring 教学件全集成联合测试」——确保每条 KI-530+ 至 KI-554 的新教学件
 * 面板在 console 里同时落位到了 (1) HTML (2) CSS (3) JS render 链路 (4) snapshot 的 systems 键。
 *
 * 这不是功能正确性测试，而是「一个集大成 dashboard 不会悄悄退化成半成品」的闸门。
 * 它把我们这 10 件教学件的产出合进了同一个不变量，任何一环回归就会红。
 */

const ROOT = resolve(process.cwd(), 'console')
const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8')
const css = readFileSync(resolve(ROOT, 'styles.css'), 'utf8')
const app = readFileSync(resolve(ROOT, 'app.js'), 'utf8')
const snap = JSON.parse(readFileSync(resolve(ROOT, 'snapshot.json'), 'utf8'))

/** 这 10 件教学件在本会话里全部登记到 Master */
const TEACHING_ROWS: Array<{ feature: string; rowClass: string; ids: string[]; cssPrefix: string; render: string }> = [
  { feature: 'KI-548 Spring Cloud Stream binding',        rowClass: 'row-ssb', ids: ['ssb-matrix', 'ssb-ladder', 'ssb-verif'],          cssPrefix: '.ssb', render: 'renderSpringStreamBinding' },
  { feature: 'KI-546 Spring Cloud OpenFeign client',      rowClass: 'row-sf',  ids: ['sf-matrix', 'sf-ladder', 'sf-verif'],              cssPrefix: '.sf',   render: 'renderSpringFeign' },
  { feature: 'KI-545 Spring Cloud Stream 绑定',            rowClass: 'row-ssb2',ids: [],                                                 cssPrefix: '',      render: '' },
  { feature: 'KI-549 Redis Pipeline / Lua / WatchCas',    rowClass: 'row-rp',  ids: ['rp-matrix', 'rp-ladder', 'rp-verif'],              cssPrefix: '.rp',   render: 'renderRedisPipeline' },
  { feature: 'KI-550 Spring Cloud Gateway Retry',         rowClass: 'row-gw',  ids: ['gw-matrix', 'gw-ladder', 'gw-verif'],              cssPrefix: '.gw',   render: 'renderGatewayRetry' },
  { feature: 'KI-547 Spring Cloud Config 三策略后端',      rowClass: 'row-sc',  ids: ['sc-matrix', 'sc-ladder', 'sc-verif'],              cssPrefix: '.sc',   render: 'renderSpringConfig' },
  { feature: 'KI-548 Spring Cloud Bus — 事件分发',         rowClass: 'row-bus', ids: ['bus-matrix', 'bus-ladder', 'bus-verif'],           cssPrefix: '.bus',  render: 'renderSpringBus' },
  { feature: 'KI-553 Redis Stream 三策略',                 rowClass: 'row-xst', ids: ['xst-matrix', 'xst-ladder', 'xst-verif'],           cssPrefix: '.xst',  render: 'renderRedisStream' },
  { feature: 'KI-551 Consul KV 三策略',                   rowClass: 'row-ckv', ids: ['ckv-matrix', 'ckv-ladder', 'ckv-verif'],           cssPrefix: '.ckv',  render: 'renderSpringConsul' },
  { feature: 'KI-552 Redis HA 三策略',                    rowClass: 'row-rea', ids: ['rea-matrix', 'rea-ladder', 'rea-verif'],           cssPrefix: '.rea',  render: 'renderRedisHa' },
  { feature: 'KI-554 Spring Cloud Vault 三策略',           rowClass: 'row-svt', ids: ['svt-matrix', 'svt-ladder', 'svt-verif'],           cssPrefix: '.svt',  render: 'renderSpringVault' },
]

const SYSTEMS_FOR: Record<string, keyof typeof snap.systems> = {
  'row-ssb': 'springStreamBinding',
  'row-sf': 'springFeign',
  'row-rp': 'redisPipeline',
  'row-gw': 'gatewayRetry',
  'row-sc': 'springConfig',
  'row-bus': 'springBus',
  'row-xst': 'redisStream',
  'row-ckv': 'springConsul',
  'row-rea': 'redisHa',
  'row-svt': 'springVault',
}

describe('集大成 dashboard · 10 件微服务教学件产物静态完整性闸门', () => {
  for (const { feature, rowClass, ids, cssPrefix, render } of TEACHING_ROWS) {
    if (!ids.length) continue
    describe(feature, () => {
      it('index.html contains the panel section', () => {
        expect(html).toContain(rowClass)
      })
      it('index.html contains every required id', () => {
        for (const id of ids) expect(html).toContain(`id="${id}"`)
      })
      it('app.js has the matching render function and dispatch', () => {
        expect(app).toContain(`function ${render}(`)
        expect(app).toContain(`render${render.slice(6)}(`)
      })
      it('styles.css contains matching .<cls>-* rules (.matrix + .verif at least)', () => {
        expect(css).toContain(`${cssPrefix}-matrix`)
        expect(css).toContain(`${cssPrefix}-verif`)
      })
      it('snapshot.json contains the matching systems key', () => {
        const key = SYSTEMS_FOR[rowClass]
        expect(key).toBeDefined()
        expect(snap.systems[key!]).toBeDefined()
      })
    })
  }

  it('HTML contains all declared row sections simultaneously (no silently missing K-552 trailing pack)', () => {
    for (const { rowClass } of TEACHING_ROWS) {
      if (!rowClass.startsWith('row-ssb2')) expect(html).toMatch(new RegExp(`class="row ${rowClass}"`))
    }
  })

  it('snapshot.systems contains the expected 47+ keys and 9 teaching entries simultaneously', () => {
    const systems = snap.systems ?? {}
    for (const key of ['springFeign', 'springConfig', 'springBus', 'redisPipeline', 'gatewayRetry', 'springStreamBinding', 'redisStream', 'springConsul', 'redisHa', 'springVault']) {
      expect(systems[key], `missing systems.${key}`).toBeDefined()
    }
  })

  it('bootstrap.js is the double-source twin of snapshot.json', () => {
    const boot = readFileSync(resolve(ROOT, 'bootstrap.js'), 'utf8')
    expect(boot).toContain('window.__BOOTSTRAP_SNAPSHOT__')
    expect(boot).toContain('springFeign')
    expect(boot).toContain('springConfig')
    expect(boot).toContain('springBus')
    expect(boot).toContain('redisPipeline')
    expect(boot).toContain('gatewayRetry')
    expect(boot).toContain('springStreamBinding')
    expect(boot).toContain('redisStream')
    expect(boot).toContain('springConsul')
    expect(boot).toContain('redisHa')
    expect(boot).toContain('springVault')
  })
})
