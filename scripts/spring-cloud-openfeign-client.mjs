/**
 * scripts/spring-cloud-openfeign-client.mjs —— Spring Cloud OpenFeign 声明式 REST 客户端（Node.js 侧）。
 *
 * <p>把「一个接口 = 一组方法 → 一组 HTTP 端点」收口成一只可调用对象，与 Spring Cloud OpenFeign
 * 的声明式风格对齐。支持路径参数 `{id}` 模板、query 拼装、以及通过 load-balancer 的 `choose`
 * 钩子做服务发现寻址。所有阈值/判定仍由 Node 侧负责。</p>
 *
 * <p>用法（CLI 仅作探针）：
 *   node scripts/spring-cloud-openfeign-client.mjs [baseUrl] [path] [method]
 *
 * <p>退出码：0 = 成功；2 = 参数不对；1 = 调用失败。</p>
 */

/**
 * 定义一个声明式客户端。
 * @param {string} baseUrl 基础地址（如 http://svc 或 http://localhost:8080）
 * @param {Record<string, { method?: string, path?: string, service?: string, headers?: Record<string,string> }>} spec 方法名 → 端点描述
 * @param {{ choose?: (service: string) => (Promise<any>|any), fetch?: typeof fetch }} [opts]
 * @returns {Record<string, (params?: Record<string, any>, body?: any) => Promise<any>>}
 */
export function defineClient(baseUrl, spec, opts = {}) {
  if (typeof baseUrl !== 'string') throw new Error('baseUrl 必须是字符串')
  if (typeof spec !== 'object' || spec === null) throw new Error('spec 必须是方法名→端点描述的映射')
  const choose = opts.choose ?? null
  const fetchImpl = opts.fetch ?? globalThis.fetch

  /** @type {Record<string, any>} */
  const client = {}
  for (const [name, def] of Object.entries(spec)) {
    const method = (def.method ?? 'GET').toUpperCase()
    const path = def.path ?? ''
    client[name] = async (params = {}, body) => {
      let host = baseUrl
      if (choose && def.service) {
        const inst = await choose(def.service)
        if (!inst) throw new Error(`load-balancer 没有可用的 ${def.service} 实例`)
        host = `http://${inst.address ?? inst}:${inst.port ?? ''}`
      }
      const url = buildUrl(host, path, params)
      const headers = { 'Content-Type': 'application/json', ...(def.headers ?? {}) }
      /** @type {any} */
      const init = { method, headers }
      if (body !== undefined && method !== 'GET' && method !== 'HEAD') init.body = JSON.stringify(body)
      let res
      try {
        res = await fetchImpl(url, init)
      } catch (e) {
        throw new Error(`feign 调用 ${name} 失败: ${e?.message ?? e}`)
      }
      const text = await res.text()
      let data = null
      try { data = text ? JSON.parse(text) : null } catch { data = text }
      if (!res.ok) {
        const err = new Error(`feign ${name} 返回 ${res.status}`)
        err.status = res.status
        err.body = data
        throw err
      }
      return data
    }
  }
  return client
}

/** 把 host + 路径 + params（路径参数 + query）拼成最终 URL */
function buildUrl(base, path, params) {
  let p = path
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null) continue
    if (p.includes(`{${k}}`)) p = p.replace(`{${k}}`, encodeURIComponent(String(v)))
    else q.append(k, String(v))
  }
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base
  const full = p.startsWith('/') ? `${trimmedBase}${p}` : `${trimmedBase}/${p}`
  const qs = [...q.keys()].length ? `?${q.toString()}` : ''
  return full + qs
}

if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const baseUrl = process.argv[2] ?? 'http://localhost:8080'
  const path = process.argv[3] ?? '/'
  const method = process.argv[4] ?? 'GET'
  const client = defineClient(baseUrl, { probe: { method, path } })
  client.probe({}).then((d) => { console.log(JSON.stringify(d)); process.exit(0) })
    .catch((e) => { console.error(e.message); process.exit(1) })
}
