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
import { createGatewayMatcher } from './spring-gateway-matcher.mjs'
import { createTracer } from './spring-sleuth-tracer.mjs'
import { createCircuitBreaker } from './spring-resilience-breaker.mjs'
import { createFilterHandlers } from './spring-gateway-filter-handlers.mjs'
import { createGrayRouter } from './spring-gateway-gray.mjs'

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

  // 可选能力：网关可用化（predicate 求值 + filter 链）与进程内追踪；传 true 用默认实现，传对象用注入实现。
  const gateway = opts.gateway === true ? createGatewayMatcher() : (opts.gateway ?? null)
  const tracer = opts.tracer === true ? createTracer({ serviceName: gameName }) : (opts.tracer ?? null)
  // KI-491：灰度/金丝雀决策器。opts.gray 为 true 用默认（0% 金丝雀＝全稳定），为对象则逐项注入；
  // 不配则根本不建 ⇒ 旧路径逐字保持。判定权 Node 侧（阈值/字段名/亲和键/selector 全由注入决定）。
  const gray = opts.gray === true ? createGrayRouter() : (opts.gray && typeof opts.gray === 'object' ? createGrayRouter(opts.gray) : null)
  // KI-491：负载均衡策略可注入（round-robin / random / weight），缺省维持 round-robin 非破坏。
  const lbStrategy = opts.lbStrategy ?? 'round-robin'
  const breakerCache = new Map()
  function getBreaker(name) {
    if (!breakerCache.has(name)) breakerCache.set(name, createCircuitBreaker(name, opts.breakerOpts ?? {}))
    return breakerCache.get(name)
  }

  // KI-487：内置网关 filter handlers（CircuitBreaker / Retry / RateLimit）。
  // 熔断器工厂复用上面的 breakerCache ⇒ 同一服务跨多次 call 共享熔断状态；阈值仍由调用方注入（判定权 Node 侧）。
  const filterPack = createFilterHandlers({
    breakerFor: getBreaker,
    breakerOpts: opts.breakerOpts ?? {},
    sleep: opts.retryBackoff,
    now: opts.filterNow,
  })
  // 调用方可注入自定义 filter handler 或覆盖内置者（如把 RateLimit 换成 Redis 版）。
  const filterHandlers = { ...filterPack.handlers, ...(opts.filterHandlers ?? {}) }

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

  // mesh 聚合出的实例是 {id,name,address,port,healthy,...} 形状；load-balancer 的 createLoadBalancer
  // 只认 Eureka 形状（instanceId/hostName/port.{$}/securePort.enabled）。这里做归一桥接，判定权仍在 Node 侧。
  // KI-491：metadata 必须**保真**——实例上标的 canary/version/weight 是灰度决策与 weight 策略的唯一输入，
  //   旧版只留 healthy 一格把灰度信息全丢了；这里展开源 metadata 再补 healthy，缺字段仍非破坏。
  function toLoadBalancerInstances(serviceName, instances) {
    return instances.map((inst) => ({
      instanceId: inst.id,
      hostName: inst.address,
      ipAddr: inst.address,
      port: { $: inst.port },
      securePort: { enabled: false },
      metadata: { ...(inst.metadata ?? {}), healthy: inst.healthy ?? true },
    }))
  }

  // KI-491：灰度决策器产出的是**原始 mesh 实例**，这里把它投影成与 selectTarget 同一形状的 target，
  // 让下游 doTransport/targetToUrl/span 完全不改。字段映射与 spring-load-balancer 的 eurekaInstancesToTargets 对齐。
  function rawInstanceToTarget(serviceName, inst) {
    return {
      serviceName,
      instanceId: inst.id,
      host: inst.address,
      port: inst.port,
      scheme: inst.securePort?.enabled ? 'https' : 'http',
      metadata: { ...(inst.metadata ?? {}), healthy: inst.healthy ?? true },
    }
  }

  /** 为某服务建立（并缓存）一只负载均衡器，实例来自 mesh 聚合视图。 */
  async function loadBalancerFor(serviceName) {
    if (lbCache.has(serviceName)) return lbCache.get(serviceName)
    const agg = await mesh.aggregate()
    const instances = agg.get(serviceName) ?? []
    const lb = createLoadBalancer(serviceName, toLoadBalancerInstances(serviceName, instances), lbStrategy)
    lbCache.set(serviceName, lb)
    return lb
  }

  async function defaultTransport(t, p, i) {
    return cloud.request(t.serviceName, p, i)
  }

  /**
   * 对目标服务做一次调用：网关路由匹配（可选）→ 负载均衡选实例 → 起 span（可选）→ 经网关 CircuitBreaker filter 熔断（可选）→ transport。
   * @returns {Promise<{ok:boolean, target?:any, data?:any, route?:any, span?:any, reason?:string, error?:unknown}>}
   */
  async function call(serviceName, path, init = {}) {
    // 1) 网关路由匹配（可选）：拿请求去匹配路由表，匹配不到直接短路
    let route = null
    if (gateway) {
      const matched = gateway.matchRoute(routes, { path, method: init?.method, headers: init?.headers })
      if (!matched) {
        return { ok: false, target: null, data: undefined, reason: 'no_route', error: new Error(`no gateway route for ${path}`) }
      }
      route = matched.route
    }

    // 2) 选实例。KI-491：配了 gray 就走灰度决策——从 mesh 原始实例按 metadata 分稳定/金丝雀池、
    //    用亲和 key 哈希决定落哪池、池内按权重选一只；未配 gray 则逐字维持既有 LB 语义
    //    （round-robin/random/weight 由 lbStrategy 注入），非破坏。
    let target = null
    let grayInfo = null
    if (gray) {
      const agg = await mesh.aggregate()
      const rawInstances = agg.get(serviceName) ?? []
      const decision = gray.decide({ path, method: init?.method, headers: init?.headers, canaryPercent: init?.canaryPercent })
      const picked = gray.select(rawInstances, decision)
      grayInfo = {
        lane: picked.lane, fallback: picked.fallback, reason: picked.reason,
        key: decision.key, bucket: decision.bucket, canaryPercent: decision.canaryPercent,
      }
      if (picked.ok && picked.instance) target = rawInstanceToTarget(serviceName, picked.instance)
    } else {
      const lb = await loadBalancerFor(serviceName)
      target = selectTarget(lb)
    }
    if (!target) {
      return { ok: false, target: null, data: undefined, route: route ?? undefined, gray: grayInfo ?? undefined, reason: 'no_instance', error: new Error(`no instance for ${serviceName}`) }
    }
    const url = targetToUrl(target, path)

    // 3) 起 span（可选），把 W3C traceparent 注入请求头
    let span = null
    const headers = { ...(init.headers ?? {}) }
    if (tracer) {
      span = tracer.startSpan(`${serviceName}${path}`)
      headers['traceparent'] = tracer.inject(span)
    }
    const callInit = span ? { ...init, headers } : init

    // 4) 执行传输。KI-487：把整条网关 filter 链真正接进调用——terminal 才是真 transport，
    //    CircuitBreaker / Retry / RateLimit 由 spring-gateway-filter-handlers 提供（判定权仍 Node 侧，阈值来自路由 args）。
    const transport = opts.transport ?? defaultTransport
    const doTransport = () => transport(
      { url, serviceName, instanceId: target.instanceId, host: target.host, port: target.port },
      path, callInit,
    )

    const finishSpan = (tags) => {
      if (span) tracer.finish(span, { remoteEndpoint: { serviceName }, tags })
    }

    try {
      let data
      if (gateway && route && typeof gateway.runWithFilters === 'function') {
        // 有网关且命中路由：跑完整 filter 链，链尾才发真传输。
        data = await gateway.runWithFilters(route, { serviceName, path, routeId: route.id }, filterHandlers, doTransport)
      } else {
        // 无网关 / 注入的自定义网关无 runWithFilters：退回旧语义（只按 CircuitBreaker filter 包一层）。
        const cbFilter = route?.filters?.find((f) => f.name === 'CircuitBreaker')
        if (cbFilter) {
          const r = await getBreaker(cbFilter.args?.name ?? serviceName).run(doTransport)
          if (!r.ok) throw r.error
          data = r.result
        } else {
          data = await doTransport()
        }
      }
      finishSpan({ 'caesura.target': target.instanceId })
      return { ok: true, target, data, route: route ?? undefined, span: span ?? undefined, gray: grayInfo ?? undefined, filterStats: filterPack.stats(), error: undefined }
    } catch (error) {
      finishSpan({ error: String(error?.message ?? error) })
      return { ok: false, target, data: undefined, route: route ?? undefined, span: span ?? undefined, gray: grayInfo ?? undefined, filterStats: filterPack.stats(), error }
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
      gray: gray ? { salt: gray.salt, stickyHeader: gray.stickyHeader, grayField: gray.grayField, canaryValue: gray.canaryValue, weightField: gray.weightField, canaryPercent: gray.canaryPercent, stats: gray.stats() } : null,
    }
  }

  return { cloud, mesh, routes, game, gray, filters: filterPack, loadBalancerFor, bootstrap, call, shutdown, status }
}
