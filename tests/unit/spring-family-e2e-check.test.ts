import { describe, expect, it } from 'vitest'
import {
  START_ORDER,
  JAR_PATHS,
  SERVICE_PORTS,
  HEALTH_URLS,
  CONFIG_ROSTER_URL,
  PROBES,
  probeMatches,
  preconditionFindings,
} from '../../scripts/spring-family-e2e-check.mjs'

/**
 * spring-family-e2e-check.mjs 单元测试（headless 可证：不启动 Java 进程）。
 *
 * 只测纯函数与名册形状；真正的端到端跑（起六件 jar）是脚本的运行路径，不进 vitest。
 */

describe('spring-family-e2e-check：三张名册同形', () => {
  it('START_ORDER／JAR_PATHS／SERVICE_PORTS／HEALTH_URLS 四份名册覆盖同样的六件', () => {
    for (const svc of START_ORDER) {
      expect(JAR_PATHS.has(svc), `${svc} 缺 jar 路径`).toBe(true)
      expect(SERVICE_PORTS.has(svc), `${svc} 缺端口`).toBe(true)
      expect(HEALTH_URLS.has(svc), `${svc} 缺健康 URL`).toBe(true)
    }
    expect(JAR_PATHS.size).toBe(6)
    expect(SERVICE_PORTS.size).toBe(6)
    expect(HEALTH_URLS.size).toBe(6)
  })

  it('jar 路径全部指向 target/ 下的 artifactId-version.jar（KI-452 的形状）', () => {
    for (const [, p] of JAR_PATHS) {
      expect(p).toMatch(/services\/spring\/caesura-[a-z]+\/target\/caesura-[a-z]+-0\.1\.0\.jar$/)
    }
  })

  it('HEALTH_URLS 全部是 http://127.0.0.1: 且端口与 PORTS 一致', () => {
    for (const [svc, url] of HEALTH_URLS) {
      const port = SERVICE_PORTS.get(svc)!
      expect(url.startsWith(`http://127.0.0.1:${port}`), `${svc} 健康 URL 端口与名册不一致`).toBe(true)
    }
  })

  it('CONFIG_ROSTER_URL 指向 8888 上的 caesura-gates 名册（gate 的 fail-fast 配置来源）', () => {
    expect(CONFIG_ROSTER_URL).toBe('http://127.0.0.1:8888/caesura-gates/default')
  })
})

describe('spring-family-e2e-check：probeMatches（探针判读）', () => {
  it('contains-CAESURA-GATE：XML 字符串含登记实例名才过', () => {
    expect(probeMatches('<applications><application><name>CAESURA-GATE</name></application></applications>', 'contains-CAESURA-GATE')).toBe(true)
    expect(probeMatches('<applications><application><name>SOMETHING-ELSE</name></application></applications>', 'contains-CAESURA-GATE')).toBe(false)
    expect(probeMatches('not-xml-but-contains-CAESURA-GATE', 'contains-CAESURA-GATE')).toBe(true)
    expect(probeMatches('', 'contains-CAESURA-GATE')).toBe(false)
  })

  it('jsonPath：数字相等（gate 名册 count=5）', () => {
    expect(probeMatches('{"count":5,"gates":[]}', { jsonPath: ['count'], equals: 5 })).toBe(true)
    expect(probeMatches('{"count":4,"gates":[]}', { jsonPath: ['count'], equals: 5 })).toBe(false)
    expect(probeMatches('{"count":"5","gates":[]}', { jsonPath: ['count'], equals: 5 })).toBe(false)
    expect(probeMatches('{"nope":1}', { jsonPath: ['count'], equals: 5 })).toBe(false)
    expect(probeMatches('not-json', { jsonPath: ['count'], equals: 5 })).toBe(false)
  })

  it('jsonPath：字符串相等（client 健康 status=UP）', () => {
    expect(probeMatches('{"status":"UP"}', { jsonPath: ['status'], equals: 'UP' })).toBe(true)
    expect(probeMatches('{"status":"DOWN"}', { jsonPath: ['status'], equals: 'UP' })).toBe(false)
  })

  it('jsonPath：嵌套路径', () => {
    expect(probeMatches('{"a":{"b":{"c":42}}}', { jsonPath: ['a', 'b', 'c'], equals: 42 })).toBe(true)
    expect(probeMatches('{"a":{"b":{"c":43}}}', { jsonPath: ['a', 'b', 'c'], equals: 42 })).toBe(false)
    expect(probeMatches('{"a":null}', { jsonPath: ['a', 'b', 'c'], equals: 42 })).toBe(false)
  })
})

describe('spring-family-e2e-check：preconditionFindings（前提检查）', () => {
  const jarsBuilt = Object.fromEntries(START_ORDER.map((s) => [s, true]))

  it('全部前提满足 ⇒ 没有问题', () => {
    expect(preconditionFindings({ javaOk: true, jars: jarsBuilt, portsBusy: [] })).toEqual([])
  })

  it('java 找不到 ⇒ 一条问题', () => {
    const out = preconditionFindings({ javaOk: false, jars: jarsBuilt, portsBusy: [] })
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('找不到 java')
  })

  it('任一 jar 没构建 ⇒ 对应一条问题，点名那个服务', () => {
    const jars = { ...jarsBuilt, 'caesura-client': false }
    const out = preconditionFindings({ javaOk: true, jars, portsBusy: [] })
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('caesura-client')
  })

  it('端口忙 ⇒ 一条问题，含端口号（不替机器杀进程）', () => {
    const out = preconditionFindings({ javaOk: true, jars: jarsBuilt, portsBusy: ['caesura-gateway'] })
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('8099')
    expect(out[0]).toContain('别乱杀')
  })

  it('多重问题一起报，不吞', () => {
    const jars = { ...jarsBuilt, 'caesura-registry': false, 'caesura-config': false }
    const out = preconditionFindings({ javaOk: false, jars, portsBusy: ['caesura-gate'] })
    expect(out).toHaveLength(4) // 1 java + 2 jars + 1 port
  })
})

describe('spring-family-e2e-check：PROBES 表形状', () => {
  it('每条探针都有名、URL 和期望', () => {
    for (const probe of PROBES) {
      expect(probe.name.length).toBeGreaterThan(0)
      expect(probe.url.startsWith('http://127.0.0.1:')).toBe(true)
      expect(probe.expect).toBeDefined()
    }
  })

  it('探针里没有 @LoadBalanced 的假地址（probe 走真实 host 端口，KICKOUT LB 层不在这条路上）', () => {
    for (const probe of PROBES) {
      expect(probe.url).not.toContain('lb://')
    }
  })
})
