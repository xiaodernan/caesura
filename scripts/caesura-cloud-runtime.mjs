/**
 * scripts/caesura-cloud-runtime.mjs —— 集大成运行时：把 Spring Cloud 家族既有客户端组合成「游戏可一键拉起的一朵云」。
 *
 * <p>组合对象（均为已存在、可独立测试的家族件）：
 *   - `spring-cloud-facade` 的 CaesuraCloud 门面（编排/重试/熔断/上报）
 *   - `spring-mesh-registry` 的统一服务注册表（合并 Eureka/Consul/静态）
 *   - `spring-gateway-route` 的内存路由表
 *   - `spring-load-balancer` 的客户端负载均衡
 *   - `caesura-mesh-adapter` 的游戏侧微服务适配层（游戏成为一等公民）
 *   - `spring-resilience-breaker` 的进程内熔断（call 链路保护）
 *
 * <p>判词仍由 Node 侧持有（决策原则①）：运行时只做编排（注册/聚合/选实例/发事件），阈值由注入项决定。
 * call 默认走 CaesuraCloud.request（编排权威），亦可用注入的 transport 接管真实传输。</p>
 */
import { createCloud } from './spring-cloud-facade.mjs'
import { createMeshRegistry } from './spring-mesh-registry.mjs'
import { createRouteTable, loadRoutesFromFile, watchRoutes } from './spring-gateway-route.mjs'
import { createLoadBalancer, selectTarget, targetToUrl } from './spring-load-balancer.mjs'
import { createGameMeshAdapter } from './caesura-mesh-adapter.mjs'

/**
 * 创建一只集大成运行时。
 * @param {object} [opts]
 */
export function createCloudRuntime(opts = {}) {
  const gameId = opts.gameId ?? 'caesura-game'
  const gameName = opts.gameName ?? 'caesura-game'
  const gameAddress = opts.gameAddress ?? '127.0.0.1'
  const gamePort = opts.gamePort ?? 7700
  const gameHealth = opts.gameHealth ?? (() => ({ status: 'UP' }))

  const cloud = opts.cloud ?? createCloud({})
  const mesh = createMeshRegistry()
  const routes = createRouteTable()
  const game = createGameMeshAdapter({ cloud, gameId, address: gameAddress, port: gamePort, health: gameHealth })

  const lbCache = new Map()
  let stopWatcher = null

  // 把注入的发现源登记进统一注册表
  if (opts.sources) {
    for (const [name, fn] of Object.entries(opts.sources)) {
      mesh.registerSource(name, fn)
    }
  }
  // 游戏自身也成为可发现的一等实例
  mesh.registerSource('self', () => [
    { id: `${gameId}:${gamePort}`, name: gameName, address: gameAddress, port: gamePort, healthy: true },
  ])

  // mesh 聚合出的实例是 {id,name,address,port,healthy} 形状；load-balancer 的 createLoadBalancer
  // 只认 Eureka 形状（instanceId/hostName/port.{$}/securePort.enabled）。这里做归一桥接，判定权仍在 Node 侧。
  function toLoadBalancerInstances(serviceName, instances) {
    return instances.map((inst) => ({
      instanceId: inst.id,
      hostName: inst.address,
      ipAddr: inst.address,
      port: { $: inst.port },
      securePort: { enabled: false },
      metadata: { healthy: inst.healthy ?? true },
    }))
  }

  /** 为某服务建立（并缓存）一只负载均衡器，实例来自 mesh 聚合视图。 */
  async function loadBalancerFor(serviceName) {
    if (lbCache.has(serviceName)) return lbCache.get(serviceName)
    const agg = await mesh.aggregate()
    const instances = agg.get(serviceName) ?? []
    const lb = createLoadBalancer(serviceName, toLoadBalancerInstances(serviceName, instances), 'round-robin')
    lbCache.set(serviceName, lb)
    return lb
  }

  async function defaultTransport(t, p, i) {
    return cloud.request(t.serviceName, p, i)
  }

  /**
   * 对目标服务做一次调用：负载均衡选实例 → 交给 transport。
   * @returns {Promise<{ok:boolean, target?:any, data?:any, error?:unknown}>}
   */
  async function call(serviceName, path, init = {}) {
    const lb = await loadBalancerFor(serviceName)
    const target = selectTarget(lb)
    if (!target) {
      return { ok: false, target: null, data: undefined, error: new Error(`no instance for ${serviceName}`) }
    }
    const url = targetToUrl(target, path)
    const transport = opts.transport ?? defaultTransport
    try {
      const data = await transport({ url, serviceName, instanceId: target.instanceId, host: target.host, port: target.port }, path, init)
      return { ok: true, target, data, error: undefined }
    } catch (error) {
      return { ok: false, target, data: undefined, error }
    }
  }

  /** 拉起：注册游戏实例、可选加载/热看路由表、广播 booted。 */
  async function bootstrap() {
    const started = await game.start()
    if (opts.routesFile) {
      loadRoutesFromFile(routes, opts.routesFile)
      if (opts.routesWatchInterval) {
        stopWatcher = watchRoutes(routes, opts.routesFile, opts.routesWatchInterval, undefined, opts.bus ?? cloud)
      }
    }
    await cloud.publish('caesura.runtime.booted', { gameId, gameName })
    return { started }
  }

  /** 关停：停看路由、注销游戏实例、广播 stopped。 */
  async function shutdown() {
    if (stopWatcher) { stopWatcher(); stopWatcher = null }
    const stopped = await game.stop()
    await cloud.publish('caesura.runtime.stopped', { gameId, gameName })
    return { stopped }
  }

  /** 汇总：游戏状态 + 已聚合服务 + 路由数。 */
  async function status() {
    const agg = await mesh.aggregate()
    return {
      game: await game.status(),
      services: [...agg.keys()],
      routeCount: routes.size(),
      lbCache: [...lbCache.keys()],
    }
  }

  return { cloud, mesh, routes, game, loadBalancerFor, bootstrap, call, shutdown, status }
}
