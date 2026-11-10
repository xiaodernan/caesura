import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, loadConfigs, startConfigWatcher } from '../../scripts/spring-config-server.mjs'
import { createBus } from '../../scripts/spring-bus-event.mjs'
import { fetchConfigWithFallback } from '../../scripts/spring-config-client.mjs'

/**
 * 端到端集成测试：Spring Cloud Config Server + Bus + Config Client（Node 侧）。
 *
 * 模拟"运维改了 Repos 里的配置 → config 变更经总线广播 → 消费方热拉刷新"闭环：
 *   1. 起真 HTTP 配置服务器（随机端口——不占 8888）；
 *   2. Config Client 经 HTTP 拉取配置（走 `fetchConfigWithFallback` 的真实路径）；
 *   3. Bus 监听 `config.changed`；
 *   4. `startConfigWatcher` 依文件 mtime 触发 `onChange`，在回调里向 Bus 发布；
 *   5. 另一侧订阅者收到事件后再次拉取，确认新配置生效。
 *
 * headless 可证：不启动 JVM、不依赖外部网络、不碰真 8888 端口。
 */

describe('spring-config-bus：Config Server + Bus + Client 端到端（Node 侧）', () => {
  const tmpDirs: string[] = []
  const servers: import('node:http').Server[] = []
  const buses = new Set<ReturnType<typeof createBus>>()

  function mkTmpDir(): string {
    const d = mkdtempSync(join(tmpdir(), 'caesura-spring-e2e-'))
    tmpDirs.push(d)
    return d
  }

  afterEach(async () => {
    for (const s of servers.splice(0)) {
      await new Promise<void>((resolve) => s.close(() => resolve()))
    }
    for (const b of buses) {
      b.close()
    }
    buses.clear()
    while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true })
  })

  it('config 变更经 Bus 广播后，消费方热拉取到新值', async () => {
    // 1) 起配置服务器
    const dir = mkTmpDir()
    writeFileSync(join(dir, 'caesura-gate.yml'), 'server.port: 8081\ncaesura.circuit.threshold: 3\n')
    const configs = loadConfigs(dir)
    expect(configs['caesura-gate'] as Record<string, any>).toEqual({ 'server.port': 8081, 'caesura.circuit.threshold': 3 })

    const server = createServer(configs)
    servers.push(server)
    const port = await new Promise<number>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve((server.address() as any).port))
      server.once('error', reject)
    })

    // 2) Client 拉取当前配置
    const url = `http://127.0.0.1:${port}`
    const before = await fetchConfigWithFallback('caesura-gate', url)
    expect((before as Record<string, any>)['server.port']).toBe(8081)
    expect((before as Record<string, any>)['_configError']).toBeUndefined()
    // 3) Bus + watcher：配置文件变化时发布 config.changed
    const evbus = createBus()
    buses.add(evbus)
    const received: Array<{ name: string; config: Record<string, any> }> = []
    evbus.subscribe('config.changed', (...args: unknown[]) => {
      const [name, config] = args as [string, Record<string, any>]
      received.push({ name, config })
    })

    const stop = startConfigWatcher(configs, dir, 50, (name, cfg) => {
      evbus.publish('config.changed', name, cfg)
    })

    // 4) 修改配置文件（点式键——Spring Cloud 本身也这么存）
    writeFileSync(join(dir, 'caesura-gate.yml'), 'server.port: 8082\ncaesura.circuit.threshold: 5\n')

    // 等 watcher 触发 + 停止 watcher
    await new Promise<void>((resolve) => setTimeout(resolve, 350))
    stop()

    expect(received).toHaveLength(1)
    expect(received[0]!.name).toBe('caesura-gate')
    expect(received[0]!.config['server.port']).toBe(8082)
    expect(received[0]!.config['caesura.circuit.threshold']).toBe(5)

    // 5) 消费方热拉取：经 HTTP 取到新值
    const after = await fetchConfigWithFallback('caesura-gate', url)
    expect((after as Record<string, any>)['server.port']).toBe(8082)
    expect((after as Record<string, any>)['_configError']).toBeUndefined()
  })
})
