import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  createServer,
  loadConfigs,
  findConfig,
  buildConfigResponse,
  startConfigWatcher,
} from '../../scripts/spring-config-server.mjs'
import { createBus } from '../../scripts/spring-bus-event.mjs'

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
      path.join(tmpDir, 'caesura-gate.yml'),
      'server:\n  port: 8081\ncaesura_circuit_failure_threshold: 3\ncaesura_circuit_cooldown_sec: 120',
    )
    fs.writeFileSync(
      path.join(tmpDir, 'caesura-report.yml'),
      'server:\n  port: 8082\ncaesura_report_retry_attempts: 8\ncaesura_report_retry_delay_ms: 2000',
    )

    const configs = loadConfigs(tmpDir)
    const gateConfig = configs['caesura-gate'] as Record<string, unknown>
    expect(gateConfig).toBeDefined()
    expect((gateConfig.server as Record<string, unknown>).port).toBe(8081)
    expect((gateConfig as Record<string, unknown>)['caesura_circuit_failure_threshold']).toBe(3)

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

  it('startConfigWatcher：配置文件变化时自动重新加载并触发回调', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const os = require('node:os')

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caesura-config-'))
    fs.writeFileSync(
      path.join(tmpDir, 'caesura-gate.yml'),
      'server:\n  port: 8081\ncaesura_circuit_failure_threshold: 3\ncaesura_circuit_cooldown_sec: 120',
    )

    const configs = loadConfigs(tmpDir)
    let callbackCalled = false

    const stopWatcher = startConfigWatcher(configs, tmpDir, 100, (name: string, config: Record<string, unknown>) => {
      callbackCalled = true
      expect(name).toBe('caesura-gate')
      expect((config.server as Record<string, unknown>).port).toBe(8082)
    })

    // 修改配置文件
    fs.writeFileSync(
      path.join(tmpDir, 'caesura-gate.yml'),
      'server:\n  port: 8082\ncaesura_circuit_failure_threshold: 5\ncaesura_circuit_cooldown_sec: 120',
    )

    // 等待监听器检测变化
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(callbackCalled).toBe(true)
        stopWatcher()
        fs.rmSync(tmpDir, { recursive: true })
        resolve()
      }, 350)
    })
  })

  it('startConfigWatcher + Bus：配置变更自动向总线广播 config.changed', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const os = require('node:os')

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caesura-config-'))
    fs.writeFileSync(
      path.join(tmpDir, 'caesura-gate.yml'),
      'server:\n  port: 8081\ncaesura_circuit_failure_threshold: 3',
    )

    const configs = loadConfigs(tmpDir)
    const evbus = createBus()
    const received: Array<{ name: string; config: Record<string, unknown> }> = []
    evbus.subscribe('config.changed', (...args: unknown[]) => {
      const [name, config] = args as [string, Record<string, unknown>]
      received.push({ name, config })
    })

    const stopWatcher = startConfigWatcher(configs, tmpDir, 100, undefined, evbus)

    // 修改配置文件
    fs.writeFileSync(
      path.join(tmpDir, 'caesura-gate.yml'),
      'server:\n  port: 8082\ncaesura_circuit_failure_threshold: 5',
    )

    // 等待监听器检测变化
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(received.length).toBe(1)
        expect(received[0]!.name).toBe('caesura-gate')
        expect((received[0]!.config.server as Record<string, unknown>).port).toBe(8082)
        stopWatcher()
        evbus.close()
        fs.rmSync(tmpDir, { recursive: true })
        resolve()
      }, 400)
    })
  })

  it('startConfigWatcher：启动不吐事件（已有文件只登记 mtime，不广播）', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const os = require('node:os')

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caesura-config-'))
    fs.writeFileSync(
      path.join(tmpDir, 'caesura-gate.yml'),
      'server:\n  port: 8081',
    )

    const configs = loadConfigs(tmpDir)
    const evbus = createBus()
    const received: string[] = []
    evbus.subscribe('config.changed', (...args: unknown[]) => {
      received.push(args[0] as string)
    })

    const stopWatcher = startConfigWatcher(configs, tmpDir, 50, undefined, evbus)

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(received).toEqual([]) // 启动期不吐事件
        stopWatcher()
        evbus.close()
        fs.rmSync(tmpDir, { recursive: true })
        resolve()
      }, 250)
    })
  })

  it('findConfig：查找不存在的应用返回 undefined', () => {
    const configs = {
      'caesura-gate': { server: { port: 8081 } },
    }

    const result = findConfig('nonexistent', 'default', 'master', configs)
    expect(result).toBeUndefined()
  })

  it('buildConfigResponse：缺失字段使用默认值', () => {
    const config = { server: { port: 8081 } } // 没有 version 字段
    const response = buildConfigResponse('caesura-gate', 'default', 'master', config) as Record<
      string,
      unknown
    >

    expect(response.version).toBe('1') // 默认版本
    expect(response.state).toBeNull()
  })
})
