/**
 * scripts/caesura-config-aggregator.mjs —— 多源配置按优先级合并（Node.js 侧，集大成收口）。
 *
 * <p>Spring Cloud 家族已有 config-server 客户端（`spring-config-client`）与 Vault 客户端（`spring-cloud-vault-client`），
 * 但缺一个把「config-server / vault / 本地默认」多源配置按优先级合成为一份统一配置的东西。本件补上：
 * 优先级小的先合并、大的后覆盖；本地 override 永远最后覆盖（判定权仍 Node 侧）。与 `createGameCloud` 启动时可喂一份统一配置配合。</p>
 */

/**
 * 创建一只配置聚合器。
 * @param {object} [opts] { override?: Record<string,unknown> }
 */
export function createConfigAggregator(opts = {}) {
  let localOverride = opts.override ?? null
  /** @type {Array<{name:string, fetch:any, priority:number}>} */
  const sources = []

  /**
   * 注册一个配置源。
   * @param {string} name 源名
   * @param {() => (Record<string,unknown> | Promise<Record<string,unknown>>) | Record<string,unknown>} fetchFn 取配置的函数或直接对象
   * @param {number} [priority] 优先级，越大越晚合并（覆盖前者），默认按注册顺序
   */
  function addSource(name, fetchFn, priority = sources.length) {
    sources.push({ name, fetch: fetchFn, priority })
    return name
  }

  function setOverride(obj) {
    localOverride = obj
    return localOverride
  }

  async function resolveSource(s) {
    const cfg = typeof s.fetch === 'function' ? await s.fetch() : s.fetch
    return cfg && typeof cfg === 'object' ? cfg : {}
  }

  /** 按优先级升序合并全部源，本地 override 最后覆盖。 */
  async function aggregate() {
    const merged = {}
    const ordered = [...sources].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
    for (const s of ordered) Object.assign(merged, await resolveSource(s))
    if (localOverride && typeof localOverride === 'object') Object.assign(merged, localOverride)
    return merged
  }

  async function get(key) {
    const m = await aggregate()
    return m[key]
  }

  return { addSource, setOverride, aggregate, get }
}
