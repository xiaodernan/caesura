/**
 * scripts/caesura-game-cloud.mjs —— 游戏侧「开箱即用」云入口（集大成最终收口）。
 *
 * <p>把前几轮的积木（facade / mesh-registry / 网关可用化 / load-balancer / 游戏适配层 / 进程内熔断 / sleuth tracer / service-proxy）
 * 收口成游戏本体只需一行就能拉起的一朵云：</p>
 *
 * ```js
 * const gc = createGameCloud({ gameId: 'caesura-game', gamePort: 7700, sources: { eureka: () => discoverEureka() } })
 * await gc.start()                 // 注册游戏实例、广播 lifecycle/runtime 事件、起 tracer/gateway
 * const data = await gc.proxyCall('caesura-gate', '/api/x')  // 负载均衡 + 进程内熔断 + 调用链追踪
 * await gc.shutdown()              // 注销 + 广播 stopped
 * ```
 *
 * <p>判词仍由 Node 侧持有（决策原则①）：本件只做编排与默认值收口，不写任何业务阈值；阈值经 opts 注入。</p>
 */
import { createCloudRuntime } from './caesura-cloud-runtime.mjs'
import { createServiceProxy } from './caesura-service-proxy.mjs'
import { createGameEventBus } from './caesura-event-bus.mjs'
import { createAuthGuard } from './caesura-auth-guard.mjs'
import { createGameEventBridge } from './caesura-game-event-bridge.mjs'

/**
 * 创建一只游戏侧开箱即用云。
 * @param {object} [opts] 透传给 createCloudRuntime 的全部选项，并可附 gameName/gameAddress/breakerOpts；
 *   以及 P7 扩展：eventsChannel/eventsTransport/eventBinder（事件总线）、requiredScopes（鉴权守卫）。
 */
export function createGameCloud(opts = {}) {
  const gameId = opts.gameId ?? 'caesura-game'
  const gameName = opts.gameName ?? gameId

  const runtime = createCloudRuntime({
    gameId,
    gameName,
    gameAddress: opts.gameAddress,
    gamePort: opts.gamePort,
    gameHealth: opts.gameHealth,
    sources: opts.sources,
    gateway: opts.gateway ?? true,
    tracer: opts.tracer ?? true,
    breakerOpts: opts.breakerOpts,
    transport: opts.transport,
    cloud: opts.cloud,
    bus: opts.bus,
    // KI-491：灰度/金丝雀加权路由（true 用缺省 0% / 对象逐项注入阈值/亲和键/selector）与 LB 策略透传。
    gray: opts.gray,
    lbStrategy: opts.lbStrategy,
  })

  const proxy = createServiceProxy(runtime, { breaker: opts.breakerOpts })

  // P7 扩展：游戏事件总线（Spring Cloud Stream 收口）与鉴权守卫（Spring Cloud Security 收口）。
  const events = createGameEventBus({
    channel: opts.eventsChannel,
    transport: opts.eventsTransport,
    binder: opts.eventBinder,
  })
  const auth = createAuthGuard({ requiredScopes: opts.requiredScopes })

  // KI-489 游戏真 EventBus ↔ 云事件总线桥：gameBridgeRoutes 给了才建；shutdown 自动退桥，避免悬挂订阅。
  let bridge = null
  function connectGameBus(gameBus, routes) {
    if (bridge) bridge.uninstall()
    bridge = createGameEventBridge({ gameBus, cloudBus: events, routes, onEvent: opts.onBridgeEvent })
    return bridge.install()
  }

  return {
    runtime,
    proxy,
    events,
    auth,
    /** KI-491：灰度/金丝雀决策器（未配 opts.gray 时为 null）；可直接 decide/select/stats。 */
    gray: runtime.gray,
    /** 把游戏真 EventBus 按白名单routes 接进云事件总线（游戏侧一行：gc.connectGameBus(bus, routes)）。 */
    connectGameBus,
    bridge: () => bridge,
    /** 拉起：注册游戏实例、广播 lifecycle/runtime 事件、启用网关与追踪、发 game.started 事件。 */
    async start() {
      const r = await runtime.bootstrap()
      await events.publishGameEvent('game.started', { gameId, gameName })
      return r
    },
    /** 裸调用（负载均衡 + 网关匹配 + 追踪 + CB filter）。 */
    async call(serviceName, path, init) { return runtime.call(serviceName, path, init) },
    /** 韧性调用（runtime.call + 按服务隔离的进程内熔断）。 */
    async proxyCall(serviceName, path, init) { return proxy.call(serviceName, path, init) },
    /** 关停：退桥 + 注销游戏实例 + 广播 stopped + 发 game.stopped 事件。 */
    async shutdown() {
      const bridgeOff = bridge ? bridge.uninstall() : null
      const r = await runtime.shutdown()
      await events.publishGameEvent('game.stopped', { gameId, gameName })
      return { ...r, bridgeOff }
    },
    /** 汇总：游戏状态 + 已聚合服务 + 路由数 + 事件频道 + 鉴权作用域。 */
    async status() {
      const s = await runtime.status()
      return { ...s, eventChannel: events.channel, authScopes: auth.requiredScopes }
    },
  }
}
