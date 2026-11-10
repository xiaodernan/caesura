/**
 * scripts/spring-cloud-consul-client.mjs —— Spring Cloud Consul 服务发现客户端（Node.js 侧）。
 *
 * <p>注册/注销/发现/健康探针，对齐 Spring Cloud Consul 的语义。默认走真实 Consul HTTP API；
 * 传入 `inMemory: true` 时退化为内存实现（测试/单机用），两路共用同一套接口。</p>
 *
 * <p>用法（CLI 仅作探针）：
 *   node scripts/spring-cloud-consul-client.mjs [address] [service] [action]
 *
 * <p>退出码：0 = 成功；2 = 参数不对；1 = 操作失败。</p>
 */

/**
 * 创建一个 Consul 客户端。
 * @param {{ address?: string, fetch?: typeof fetch, inMemory?: boolean }} [opts]
 * @returns {{ register: (s: object) => Promise<{id:string, stored:string}>, deregister: (id: string) => Promise<{id:string, stored:string}>, discover: (name: string) => Promise<any[]>, health: (name: string) => Promise<any[]>, address: string }}
 */
export function createConsulClient(opts = {}) {
  const address = opts.address ?? 'http://localhost:8500'
  const fetchImpl = opts.fetch ?? globalThis.fetch
  const local = opts.inMemory ? new Map() : null
  const strip = (s) => String(s).replace(/\/+$/, '')
  const idOf = (s) => s.id ?? `${s.name}-${s.address}-${s.port}`

  async function register(service) {
    if (!service || !service.name || !service.address || service.port == null) {
      throw new Error('service 需含 name/address/port')
    }
    if (local) {
      if (!local.has(service.name)) local.set(service.name, [])
      local.get(service.name).push({ ...service, id: idOf(service) })
      return { id: idOf(service), stored: 'memory' }
    }
    const res = await fetchImpl(`${strip(address)}/v1/agent/service/register`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(service),
    })
    if (!res.ok) throw new Error(`consul 注册失败: ${res.status}`)
    return { id: idOf(service), stored: 'consul' }
  }

  async function deregister(id) {
    if (local) {
      for (const [n, arr] of local) local.set(n, arr.filter((s) => idOf(s) !== id))
      return { id, stored: 'memory' }
    }
    const res = await fetchImpl(`${strip(address)}/v1/agent/service/deregister/${encodeURIComponent(id)}`, { method: 'PUT' })
    if (!res.ok) throw new Error(`consul 注销失败: ${res.status}`)
    return { id, stored: 'consul' }
  }

  async function discover(serviceName) {
    if (local) return [...(local.get(serviceName) ?? [])]
    const res = await fetchImpl(`${strip(address)}/v1/health/service/${encodeURIComponent(serviceName)}?passing`)
    if (!res.ok) throw new Error(`consul 发现失败: ${res.status}`)
    const arr = await res.json()
    return (Array.isArray(arr) ? arr : []).map((e) => ({
      id: e.Service?.ID,
      name: e.Service?.Service,
      address: e.Service?.Address,
      port: e.Service?.Port,
    }))
  }

  async function health(serviceName) {
    const instances = await discover(serviceName)
    return instances.map((i) => ({ id: i.id, healthy: true }))
  }

  return { register, deregister, discover, health, address }
}

if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const address = process.argv[2] ?? 'http://localhost:8500'
  const service = process.argv[3] ?? 'caesura'
  const action = process.argv[4] ?? 'discover'
  const c = createConsulClient({ address })
  const run = async () => {
    if (action === 'register') return c.register({ name: service, address: '127.0.0.1', port: 8080 })
    if (action === 'health') return c.health(service)
    return c.discover(service)
  }
  run().then((d) => { console.log(JSON.stringify(d)); process.exit(0) })
    .catch((e) => { console.error(e.message); process.exit(1) })
}
