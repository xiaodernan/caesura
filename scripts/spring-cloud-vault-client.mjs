/**
 * scripts/spring-cloud-vault-client.mjs —— Spring Cloud Vault 配置/密钥客户端（Node.js 侧）。
 *
 * <p>从 HashiCorp Vault 的 KV 引擎读取密钥，带本地缓存与 TTL 感知；403/401 被标记为
 * `tokenExpired`，由调用方决定如何重新认证。判定权仍在 Node 侧：本门只负责把值取回来。</p>
 *
 * <p>用法（CLI 仅作探针）：
 *   node scripts/spring-cloud-vault-client.mjs [address] [token] [path]
 *
 * <p>退出码：0 = 成功；2 = 参数不对；1 = 读取失败。</p>
 */

/**
 * 创建一个 Vault 客户端。
 * @param {{ address: string, token: string, fetch?: typeof fetch, cacheTtlMs?: number }} opts
 * @returns {{ readSecret: (path: string, o?: { noCache?: boolean }) => Promise<any>, readCached: (path: string) => Promise<any>, invalidate: (path?: string) => void, address: string }}
 */
export function createVaultClient(opts) {
  if (!opts || typeof opts.address !== 'string') throw new Error('vault address 必填')
  if (!opts.token) throw new Error('vault token 必填')
  const fetchImpl = opts.fetch ?? globalThis.fetch
  const ttlMs = opts.cacheTtlMs ?? 30000
  const cache = new Map()

  const strip = (s) => String(s).replace(/\/+$/, '')

  async function readSecret(path, o = {}) {
    const url = `${strip(opts.address)}/v1/${strip(path)}`
    let res
    try {
      res = await fetchImpl(url, { headers: { 'X-Vault-Token': opts.token } })
    } catch (e) {
      const err = new Error(`vault 读取 ${path} 失败: ${e?.message ?? e}`)
      err.cause = e
      throw err
    }
    if (!res.ok) {
      const err = new Error(`vault 读取 ${path} 失败: ${res.status}`)
      err.status = res.status
      if (res.status === 403 || res.status === 401) err.tokenExpired = true
      throw err
    }
    const json = await res.json().catch(() => ({}))
    const data = json?.data?.data ?? json?.data ?? json
    if (!o.noCache) cache.set(path, { data, at: Date.now() })
    return data
  }

  async function readCached(path) {
    const hit = cache.get(path)
    if (hit && Date.now() - hit.at < ttlMs) return hit.data
    return readSecret(path)
  }

  function invalidate(path) {
    if (path) cache.delete(path)
    else cache.clear()
  }

  return { readSecret, readCached, invalidate, address: opts.address }
}

if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const address = process.argv[2] ?? 'http://localhost:8200'
  const token = process.argv[3] ?? ''
  const path = process.argv[4] ?? 'secret/caesura'
  if (!token) { console.error('vault token 必填'); process.exit(2) }
  const v = createVaultClient({ address, token })
  v.readSecret(path).then((d) => { console.log(JSON.stringify(d)); process.exit(0) })
    .catch((e) => { console.error(e.message); process.exit(1) })
}
