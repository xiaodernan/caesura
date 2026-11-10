/**
 * scripts/spring-family-mesh-e2e.mjs —— 集大成家族端到端证据（headless 可证）。
 *
 * <p>把前几轮的积木真正串成一条可跑的链：用 `createGameCloud` 拉起「游戏云」，发现源同时挂
 * Eureka（内存）与 Spring Cloud Kubernetes 客户端（`spring-cloud-kubernetes-client`，演示 KI-479 真用在流程里）；
 * 加一条网关路由；随后：注册游戏实例 → 经「网关 predicate 匹配 → 负载均衡选实例 → 起 span → 进程内熔断」
 * 的 proxyCall 调到 caesura-gate → 查 mesh 状态（应含 self/eureka/k8s 三来源）→ 关停注销。</p>
 *
 * <p>默认用内存 transport 全 headless 跑通（CLI 直接 `node scripts/spring-family-mesh-e2e.mjs` 即得 JSON 证据）；
 * 注入 `transport`/`cloud`/`tracer` 可在测试里接管。判词仍由 Node 侧持有（决策原则①）。</p>
 */
import { createGameCloud } from './caesura-game-cloud.mjs'
import { createKubernetesClient } from './spring-cloud-kubernetes-client.mjs'
import { createTracer } from './spring-sleuth-tracer.mjs'
import { pathToFileURL } from 'node:url'

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

  // 一条网关路由：/api/** 打到 caesura-gate
  gc.runtime.routes.add({
    id: 'r-gate', uri: 'lb://caesura-gate', order: 0,
    predicates: [{ name: 'Path', args: { patterns: '/api/**' } }],
    filters: [],
  })

  return {
    gc,
    k8s,
    tracer,
    async run() {
      const boot = await gc.start()
      const callRes = await gc.proxyCall('caesura-gate', '/api/health')
      const status = await gc.status()
      const shut = await gc.shutdown()
      const spans = tracer ? tracer.spans() : []
      return { started: boot.started, callRes, status, stopped: shut.stopped, spans, services: status.services }
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
      stoppedRegistered: r.stopped?.registered,
    }, null, 2))
    process.exit(0)
  }).catch((e) => { console.error(e.message); process.exit(1) })
}
