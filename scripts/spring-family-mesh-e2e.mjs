/**
 * scripts/spring-family-mesh-e2e.mjs —— 集大成家族端到端证据（headless 可证）。
 *
 * <p>把前几轮的积木真正串成一条可跑的链：用 `createGameCloud` 拉起「游戏云」，发现源同时挂
 * Eureka（内存）与 Spring Cloud Kubernetes 客户端（`spring-cloud-kubernetes-client`，演示 KI-479 真用在流程里）；
 * 加一条网关路由；随后：注册游戏实例 → 经「网关 predicate 匹配 → filter 链（Retry 等） → 负载均衡选实例 →
 * 起 span → 进程内熔断」的 proxyCall 调到 caesura-gate → 查 mesh 状态（应含 self/eureka/k8s 三来源）→ 关停注销。</p>
 *
 * <p><b>KI-488 主链扩展</b>：一趟 run 里同时证明三件新积木真在主链上跑——
 *   ① 事件总线（KI-484）：订阅 `game.started`/`game.stopped`，随结果回 `events`；
 *   ② 鉴权守卫（KI-485）：调用前用 `gc.auth` 校验一个带 scope 的 Bearer，缺域/过期则短路拒调；
 *   ③ filter 链（KI-486/487）：`opts.retryAttempts` 挂 Retry filter，注入 flaky transport 可在结果 `filterStats.retries` 读到真重试。</p>
 *
 * <p>默认用内存 transport 全 headless 跑通（CLI 直接 `node scripts/spring-family-mesh-e2e.mjs` 即得 JSON 证据）；
 * 注入 `transport`/`cloud`/`tracer`/`bearer` 可在测试里接管。判词仍由 Node 侧持有（决策原则①）。</p>
 */
import { createGameCloud } from './caesura-game-cloud.mjs'
import { createKubernetesClient } from './spring-cloud-kubernetes-client.mjs'
import { createTracer } from './spring-sleuth-tracer.mjs'
import { pathToFileURL } from 'node:url'

/** 造一枚仅用于 headless 证据的 Bearer（不验签；auth 守卫只解析 claims/过期/作用域）。 */
function demoBearer(sub = 'caesura-e2e', scope = 'game:call', ttlSec = 3600) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const header = enc({ alg: 'none', typ: 'JWT' })
  const payload = enc({ sub, scope, exp: Math.floor(Date.now() / 1000) + ttlSec })
  return `Bearer ${header}.${payload}.sig`
}

/**
 * 跑一趟集大成家族端到端。
 * @param {object} [opts]
 */
export function runMeshE2E(opts = {}) {
  const k8s = createKubernetesClient({
    namespace: 'game',
    endpoints: { 'caesura-gate': [{ ip: '10.1.0.1', port: 8099 }] },
  })

  let tracer = null
  if (opts.tracer !== false) {
    tracer = (opts.tracer && typeof opts.tracer === 'object') ? opts.tracer : createTracer({ serviceName: 'e2e' })
  }

  const transport = opts.transport ?? (async (t, p) => ({ url: t.url, serviceName: t.serviceName, path: p }))

  // KI-488③：retryAttempts 有值才给路由挂 Retry filter（默认不挂 ⇒ 老 5 条断言的 calls.length=1 不变）。
  const filters = []
  if (opts.retryAttempts) filters.push({ name: 'Retry', args: { attempts: opts.retryAttempts, backoffMs: opts.retryBackoffMs ?? 0 } })

  const gc = createGameCloud({
    gameId: opts.gameId ?? 'caesura-game',
    gamePort: opts.gamePort ?? 7700,
    cloud: opts.cloud,
    tracer,
    transport,
    sources: {
      eureka: () => (opts.svcA ?? [{ id: 'svc-a:1', name: 'svc-a', address: '10.0.0.1', port: 8080, healthy: true }]),
      k8s: () => k8s.discover('caesura-gate'),
    },
  })

  // 一条网关路由：/api/** 打到 caesura-gate（可带 Retry filter）。
  gc.runtime.routes.add({
    id: 'r-gate', uri: 'lb://caesura-gate', order: 0,
    predicates: [{ name: 'Path', args: { patterns: '/api/**' } }],
    filters,
  })

  return {
    gc,
    k8s,
    tracer,
    async run() {
      // KI-488①：在 start 之前订阅游戏事件总线，一路收到 shutdown 之后。
      const gameEvents = []
      const offStarted = gc.events.onGameEvent('game.started', (p) => gameEvents.push({ type: 'game.started', payload: p }))
      const offStopped = gc.events.onGameEvent('game.stopped', (p) => gameEvents.push({ type: 'game.stopped', payload: p }))

      // KI-488②：调用前经鉴权守卫校验 Bearer；缺域/过期则短路，不发起下游调用。
      let auth = null
      if (opts.bearer !== null) {
        const bearer = opts.bearer ?? demoBearer()
        const requiredScope = opts.requiredScope ?? 'game:call'
        try {
          const claims = gc.auth.authenticate(bearer)
          auth = { ok: true, sub: claims.sub, scope: claims.scope, allowed: gc.auth.canAccess(claims, requiredScope), requiredScope }
        } catch (e) {
          auth = { ok: false, reason: e.message, allowed: false, requiredScope }
        }
      }

      const boot = await gc.start()
      let callRes
      if (auth && !auth.allowed) {
        callRes = { ok: false, reason: 'forbidden', error: new Error(`auth: missing scope ${auth.requiredScope}`) }
      } else {
        callRes = await gc.proxyCall('caesura-gate', '/api/health')
      }
      const status = await gc.status()
      const shut = await gc.shutdown()
      offStarted()
      offStopped()
      const spans = tracer ? tracer.spans() : []
      const filterStats = gc.runtime.filters.stats()
      return {
        started: boot.started, callRes, status, stopped: shut.stopped, spans, services: status.services,
        events: gameEvents, auth, filterStats,
      }
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMeshE2E().run().then((r) => {
    console.log(JSON.stringify({
      registered: r.started?.registered,
      callOk: r.callRes?.ok,
      callData: r.callRes?.result,
      services: r.services,
      spanCount: r.spans.length,
      eventTypes: r.events.map((e) => e.type),
      authOK: r.auth?.ok,
      authAllowed: r.auth?.allowed,
      retryCount: r.filterStats.retries,
      stoppedRegistered: r.stopped?.registered,
    }, null, 2))
    process.exit(0)
  }).catch((e) => { console.error(e.message); process.exit(1) })
}
