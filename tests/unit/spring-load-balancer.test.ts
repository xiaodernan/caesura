import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  createLoadBalancer,
  selectTarget,
  selectFromEureka,
  targetToUrl,
  type LoadBalancerTarget,
} from '../../scripts/spring-load-balancer.mjs'

/**
 * Spring Cloud LoadBalancer 客户端单元测试。
 *
 * headless 可证：不启动真 Eureka，直接构造负载均衡器并测试选择逻辑。
 * 验证轮询/随机/权重三种策略的正确性。
 */

const origFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = origFetch
  vi.restoreAllMocks()
})

function makeInstance(
  instanceId: string,
  hostName: string,
  port: number,
  metadata: Record<string, unknown> = {},
): any {
  return {
    instanceId,
    hostName,
    ipAddr: '127.0.0.1',
    port: { $: port, '@enabled': true },
    securePort: { $: port, '@enabled': false },
    metadata,
    status: 'UP',
  }
}

describe('spring-load-balancer：负载均衡选择', () => {
  it('createLoadBalancer：从 Eureka 实例构造目标列表', () => {
    const instances = [
      makeInstance('inst-1', 'host-1', 8081),
      makeInstance('inst-2', 'host-2', 8082),
    ]
    const lb = createLoadBalancer('caesura-gate', instances, 'round-robin')
    expect(lb.serviceName).toBe('caesura-gate')
    expect(lb.strategy).toBe('round-robin')
    expect(lb.targets.length).toBe(2)
    expect(lb.targets[0].instanceId).toBe('inst-1')
    expect(lb.targets[0].host).toBe('host-1')
    expect(lb.targets[0].port).toBe(8081)
    expect(lb.targets[0].scheme).toBe('http')
  })

  it('round-robin：轮转选择，每个实例平均分得请求', () => {
    const instances = [
      makeInstance('inst-1', 'host-1', 8081),
      makeInstance('inst-2', 'host-2', 8082),
    ]
    const lb = createLoadBalancer('caesura-gate', instances, 'round-robin')

    const selected: string[] = []
    for (let i = 0; i < 6; i++) {
      const t = selectTarget(lb)
      selected.push(t!.instanceId)
    }
    expect(selected).toEqual(['inst-1', 'inst-2', 'inst-1', 'inst-2', 'inst-1', 'inst-2'])
  })

  it('random：每次选择都在实例范围内', () => {
    const instances = [makeInstance('inst-1', 'host-1', 8081), makeInstance('inst-2', 'host-2', 8082)]
    const lb = createLoadBalancer('caesura-gate', instances, 'random')

    for (let i = 0; i < 20; i++) {
      const t = selectTarget(lb)
      expect(t).not.toBeNull()
      expect(['inst-1', 'inst-2']).toContain(t!.instanceId)
    }
  })

  it('weight：权重更高的实例被选中概率更高', () => {
    const instances = [
      makeInstance('inst-heavy', 'host-1', 8081, { weight: 9 }),
      makeInstance('inst-light', 'host-2', 8082, { weight: 1 }),
    ]
    const lb = createLoadBalancer('caesura-gate', instances, 'weight')

    let heavyCount = 0
    for (let i = 0; i < 100; i++) {
      const t = selectTarget(lb)
      if (t!.instanceId === 'inst-heavy') heavyCount++
    }
    expect(heavyCount).toBeGreaterThan(50) // 权重 9:1，重实例应被选中远多于一半
  })

  it('空实例列表 ⇒ selectTarget 返回 null', () => {
    const lb = createLoadBalancer('empty-svc', [], 'round-robin')
    expect(selectTarget(lb)).toBeNull()
  })

  it('targetToUrl：格式化完整 URL', () => {
    const target: LoadBalancerTarget = {
      serviceName: 'caesura-gate',
      instanceId: 'inst-1',
      host: 'host-1',
      port: 8081,
      scheme: 'http',
      metadata: {},
    }
    expect(targetToUrl(target, '/gate/gates')).toBe('http://host-1:8081/gate/gates')
    expect(targetToUrl(target)).toBe('http://host-1:8081')

    const httpsTarget: LoadBalancerTarget = {
      ...target,
      scheme: 'https',
    }
    expect(targetToUrl(httpsTarget, '/actuator/health')).toBe('https://host-1:8081/actuator/health')
  })

  it('selectFromEureka：无实例 ⇒ 返回 null', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve({ applications: { application: [] } }),
      text: () => Promise.resolve('[]'),
    } as Response)

    const target = await selectFromEureka('no-svc', 'http://localhost:8761', 'round-robin')
    expect(target).toBeNull()
  })
})
