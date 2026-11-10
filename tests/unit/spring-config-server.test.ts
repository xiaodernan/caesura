import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  createServer,
  loadConfigs,
  findConfig,
  buildConfigResponse,
} from '../../scripts/spring-config-server.mjs'

/**
 * Spring Cloud Config Server 客户端单元测试。
 *
 * headless 可证：不启动真 HTTP 服务器，直接测试配置加载和查找逻辑。
 */

const origFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = origFetch
  vi.restoreAllMocks()
})

describe('spring-config-server：Spring Cloud Config Server 客户端', () => {
  it('loadConfigs：读取配置文件', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const os = require('node:os')

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caesura-config-'))
    fs.writeFileSync(
      path.join(tmpDir, 'caesura-gate.json'),
      JSON.stringify({ server: { port: 8081 }, caesura: { circuit: { 'failure-threshold': 3 } } }),
    )
    fs.writeFileSync(
      path.join(tmpDir, 'caesura-report.yml'),
      'server:\n  port: 8082\ncaesura:\n  report:\n    retry-attempts: 8\n    retry-delay-ms: 2000',
    )

    const configs = loadConfigs(tmpDir)
    const gateConfig = configs['caesura-gate'] as Record<string, unknown>
    expect(gateConfig).toBeDefined()
    expect((gateConfig.server as Record<string, unknown>).port).toBe(8081)
    expect(
      ((gateConfig.caesura as Record<string, unknown>).circuit as Record<string, unknown>)[
        'failure-threshold'
      ],
    ).toBe(3)

    // 清理
    fs.rmSync(tmpDir, { recursive: true })
  })

  it('findConfig：按应用名查找配置', () => {
    const configs = {
      'caesura-gate': { server: { port: 8081 }, caesura: { circuit: { 'failure-threshold': 3 } } },
      'caesura-report': { server: { port: 8082 } },
    }

    const gateConfig = findConfig('caesura-gate', 'default', 'master', configs) as Record<
      string,
      unknown
    >
    expect(gateConfig).toBeDefined()
    expect((gateConfig.server as Record<string, unknown>).port).toBe(8081)
    expect(
      ((gateConfig.caesura as Record<string, unknown>).circuit as Record<string, unknown>)[
        'failure-threshold'
      ],
    ).toBe(3)

    const configConfig = findConfig('caesura-config', 'default', 'master', configs)
    expect(configConfig).toBeUndefined()
  })

  it('buildConfigResponse：构建标准响应体', () => {
    const config = { server: { port: 8081 }, caesura: { circuit: { 'failure-threshold': 3 } } }
    const response = buildConfigResponse('caesura-gate', 'default', 'master', config) as Record<
      string,
      unknown
    >

    expect(response.name).toBe('caesura-gate')
    expect(response.profiles).toEqual(['default'])
    expect(response.label).toBe('master')
    expect(response.propertySources).toHaveLength(1)
    expect((response.propertySources as Array<Record<string, unknown>>)[0].name).toBe(
      'caesura-gate-default',
    )
    expect((response.propertySources as Array<Record<string, unknown>>)[0].source).toEqual(config)
  })

  it('createServer：创建 HTTP 服务器实例', () => {
    const configs = {
      'caesura-gate': { server: { port: 8081 } },
    }
    const server = createServer(configs)
    expect(server).toBeDefined()
    expect(typeof server.listen).toBe('function')
    expect(typeof server.close).toBe('function')
    server.close()
  })
})
