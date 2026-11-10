/**
 * scripts/spring-cloud-facade.mjs —— CaesuraCloud：把 Spring Cloud 家族客户端收口到一把门后。
 *
 * <p>判定权仍在 Node 侧（决策原则①）：本门只做编排，不写任何阈值。它把 config / discovery /
 * circuit / load-balancer / bus / stream / gateway 七族客户端用依赖注入的方式收到一只
 * `createCloud(opts)` 工厂后面；`request(service, path)` 会按「发现 → 负载均衡选实例 →
 * 熔断问询 → 发起调用」这一条链路走，让游戏侧把整族微服务当一只客户端用。</p>
 *
 * <p>用法（CLI 仅作探针）：
 *   node scripts/spring-cloud-facade.mjs
 *
 * <p>退出码：0 = 成功。</p>
 */
import { createStreamClient } from './spring-cloud-stream-client.mjs'

/**
 * 创建一只 CaesuraCloud 门面。
 * @param {object} [opts]
 * @returns {object}
 */
export function createCloud(opts = {}) {
  const fetchImpl = opts.fetch ?? globalThis.fetch
  const config = opts.config ?? { get: () => undefined, url: opts.configUrl ?? null }
  const discovery = opts.discovery ?? inMemoryDiscovery()
  const circuit = opts.circuit ?? { isOpen: () => Promise.resolve(false), snapshot: () => ({}) }
  const loadBalancer = opts.loadBalancer ?? roundRobin()
  const bus = opts.bus ?? { publish: () => Promise.resolve(), subscribe: () => () => {} }
  const stream = opts.stream ?? createStreamClient()
  const gateway = opts.gateway ?? { route: (name) => `http://${name}` }

  async function request(serviceName, path, init = {}) {
    const instances = await discovery.discover(serviceName)
    if (!instances || instances.length === 0) throw new Error(`没有可用的 ${serviceName} 实例`)
    const host = loadBalancer.choose(instances)
    const open = circuit.isOpen ? await circuit.isOpen(serviceName).catch(() => false) : false
    if (open) throw new Error(`${serviceName} 熔断中`)
    const base = typeof host === 'string' ? host : `http://${host.address ?? host}:${host.port ?? ''}`
    const url = base + (path.startsWith('/') ? path : `/${path}`)
    return fetchImpl(url, init)
  }

  function publish(channel, payload) { return stream.publish(channel, payload) }
  function subscribe(channel, handler) { return stream.subscribe(channel, handler) }

  async function status() {
    const instances = discovery._known ?? []
    return {
      services: instances,
      circuit: circuit.snapshot ? circuit.snapshot() : {},
      streamChannels: stream.channels ? stream.channels() : [],
      gateway: typeof gateway.route === 'function',
    }
  }

  return { config, discovery, circuit, loadBalancer, bus, stream, gateway, request, publish, subscribe, status }
}

/** 内置内存发现（无外部依赖；可被注入真实 discovery 覆盖）。 */
function inMemoryDiscovery() {
  const reg = new Map()
  return {
    _known: [],
    register(s) {
      if (!reg.has(s.name)) reg.set(s.name, [])
      reg.get(s.name).push(s)
      this._known = [...reg.keys()]
      return s
    },
    async discover(name) { return [...(reg.get(name) ?? [])] },
  }
}

/** 内置轮询负载均衡（无外部依赖；可被注入真实 LB 覆盖）。 */
function roundRobin() {
  let i = 0
  return { choose(instances) { const inst = instances[i % instances.length]; i += 1; return inst } }
}

if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const cloud = createCloud()
  cloud.discovery.register({ name: 'probe', address: '127.0.0.1', port: 8080 })
  cloud.status().then((s) => { console.log(JSON.stringify(s)); process.exit(0) })
}
