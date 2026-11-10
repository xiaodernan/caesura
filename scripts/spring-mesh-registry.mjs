/**
 * scripts/spring-mesh-registry.mjs —— Spring Cloud 统一服务注册表（Node.js 侧，集大成收口）。
 *
 * <p>把多种发现后端（Eureka / Consul / 静态清单）收口成一张合并视图：每个 source 注册一个
 * `discover()` 函数，`aggregate()` 把它们按服务名合并、按实例 id 去重、把来源叠成 `sources`、
 * 并把各来源的 healthy 做「与」归并。`discover(name)` 取单服务。判定权仍在 Node 侧。</p>
 *
 * <p>用法（CLI 仅作探针）：node scripts/spring-mesh-registry.mjs</p>
 */

/**
 * 创建一个统一注册表。
 * @param {object} [opts]
 */
export function createMeshRegistry(opts = {}) {
  const sources = new Map()

  function registerSource(name, discoverFn) {
    if (typeof name !== 'string' || !name) throw new Error('source 名必填')
    if (typeof discoverFn !== 'function') throw new Error('discoverFn 必填')
    sources.set(name, discoverFn)
    return name
  }

  async function aggregate() {
    const merged = new Map()
    for (const [srcName, discoverFn] of sources) {
      let instances = []
      try { instances = await discoverFn() } catch { instances = [] }
      for (const inst of instances) {
        const key = inst.name
        if (!merged.has(key)) merged.set(key, [])
        const bucket = merged.get(key)
        const exists = bucket.find((x) => x.id === inst.id)
        if (exists) {
          exists.sources = [...new Set([...(exists.sources ?? []), srcName])]
          if (inst.healthy !== undefined) exists.healthy = (exists.healthy ?? true) && inst.healthy
        } else {
          bucket.push({ ...inst, sources: [srcName] })
        }
      }
    }
    return merged
  }

  async function discover(serviceName) {
    const m = await aggregate()
    return m.get(serviceName) ?? []
  }

  return { registerSource, aggregate, discover }
}

if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const reg = createMeshRegistry()
  reg.registerSource('eureka', async () => [{ id: 'a-1', name: 'svc', address: '1.1.1.1', port: 1, healthy: true }])
  reg.registerSource('consul', async () => [{ id: 'a-1', name: 'svc', address: '1.1.1.1', port: 1, healthy: true }])
  reg.aggregate().then((m) => { console.log(JSON.stringify([...m.entries()])); process.exit(0) })
}
