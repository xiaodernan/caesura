/**
 * scripts/spring-gateway-route.mjs —— Spring Cloud Gateway 路由客户端（Node.js 侧）。
 *
 * <p>它不做判断，只做**路由查询**：向 caesura-gateway 的 `/actuator/gateway/routes`
 * 端点查询已注册的路由规则（路径断言、过滤器、目标 URI 等），供 Node.js 侧消费者
 * 构造完整的服务调用地址。所有业务阈值与判定仍由 Node 侧负责；Spring 家族只负责
 * 编排/报告。
 *
 * **为什么不由 Java 直接查 Gateway 路由**：Node.js 侧也需要知道 Gateway 如何转发请求，
 * 让每个 Node 模块各自构造 Gateway 查询 = 多个主人；由本脚本统一抓取 = 唯一出处。
 *
 * **Gateway API**：GET /actuator/gateway/routes 返回所有路由定义；GET /actuator/gateway/routes/{id}
 * 返回单个路由定义；POST /actuator/gateway/refresh 强制网关丢路由缓存重读配置。
 *
 * **动态路由热加载（新能力）**：
 *   - `createRouteTable()` 创建 Node 侧进程内路由名册（add/remove/list，按 order 升序）；
 *   - `watchRoutes(table, filePath, interval, onChange, bus)` 热加载 routes.json，
 *     mtime 真变才重读替换；首趟只取快照不吐事件；可选 `bus` 发布 `route.changed`
 *     （载荷：added, removed, routes）；
 *   - `loadRoutesFromFile(table, filePath)` 同步加载（不清空顺序的外部消费者可用）；
 *   - `refreshRoutes(gatewayUrl)` POST /actuator/gateway/refresh 触发网关热重载。
 *
 * 用法：
 *   node scripts/spring-gateway-route.mjs [路由ID] [Gateway URL]
 *   node scripts/spring-gateway-route.mjs refresh [Gateway URL]     （强制网关热重载）
 *   例如：node scripts/spring-gateway-route.mjs caesura-gate http://localhost:8099
 *   例如：node scripts/spring-gateway-route.mjs   http://localhost:8099   （列出全部路由）
 *
 * 退出码：0 = 成功；1 = HTTP 错误；2 = 用法不对；3 = 网络不通。
 */

import { readFileSync, statSync } from 'node:fs'

/** 默认 Gateway 服务器地址（与 docker-compose.yml 中 caesura-gateway 的端口一致） */
const DEFAULT_GATEWAY_URL = 'http://localhost:8099'
/** 路由文件热加载的默认检查间隔（毫秒） */
const WATCH_INTERVAL_MS = 2000

/**
 * 内存路由表：Node 侧同进程的动态路由名册。
 * 与 Spring Cloud Gateway 的 `/actuator/gateway/refresh` 对称——网关侧丢路由缓存重读，
 * Node 侧这里丢名册重读。
 */
export function createRouteTable() {
  /** @type {Map<string, { id: string, uri: string, order: number, predicates: unknown[], filters: unknown[] }>} */
  const routes = new Map()

  const normalize = (row) => {
    if (!row || typeof row !== 'object') throw new Error('路由行必须是对象')
    if (typeof row.id !== 'string' || row.id.trim() === '') throw new Error('路由缺少 id')
    if (typeof row.uri !== 'string' || row.uri.trim() === '') throw new Error(`路由 ${row.id} 缺少 uri`)
    return {
      id: row.id.trim(),
      uri: row.uri.trim(),
      order: Number.isFinite(row.order) ? row.order : 0,
      predicates: Array.isArray(row.predicates) ? [...row.predicates] : [],
      filters: Array.isArray(row.filters) ? [...row.filters] : [],
    }
  }

  return {
    /** 新增/覆盖一条路由。 */
    add(row) {
      const route = normalize(row)
      routes.set(route.id, route)
      return route
    },
    /** 删除一条路由；不存在返回 false。 */
    remove(id) {
      return routes.delete(id)
    },
    /** 查询单条路由；不存在返回 undefined。 */
    get(id) {
      return routes.get(id)
    },
    /** 列出全部路由，按 order 升序（同 order 按 id 再排）。 */
    list() {
      return [...routes.values()].sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id))
    },
    /** 清空全部路由。 */
    clear() {
      routes.clear()
    },
    /** 当前路由数量。 */
    size() {
      return routes.size
    },
  }
}

/**
 * 从 routes.json 文件加载路由，清空旧表并写入。返回加载后的路由名册（按 order 排序）。
 *
 * @param {ReturnType<typeof createRouteTable>} table 路由表
 * @param {string} filePath routes.json 文件路径
 */
export function loadRoutesFromFile(table, filePath) {
  const content = readFileSync(filePath, 'utf8')
  const rows = JSON.parse(content)
  if (!Array.isArray(rows)) throw new Error(`路由文件必须是数组：${filePath}`)
  table.clear()
  for (const row of rows) table.add(row)
  return table.list()
}

/**
 * 热加载路由文件：
 *  - 首趟扫描只取快照（不触发 onChange / Bus）——避免启动即比对风暴；
 *  - 之后只在文件 mtime 真变了时重读并替换表内容，触发 onChange(added, removed, routes)；
 *  - 提供 `bus` 时，向总线发布 `route.changed`（载荷：added, removed, routes）。
 *
 * @param {ReturnType<typeof createRouteTable>} table 路由表
 * @param {string} filePath routes.json 文件路径
 * @param {number} interval 检查间隔（毫秒）
 * @param {(added: string[], removed: string[], routes: unknown[]) => void} [onChange]
 * @param {{ publish(event: string, ...args: unknown[]): boolean } | undefined} [bus]
 * @returns {function} 停止监听的函数
 */
export function watchRoutes(table, filePath, interval = WATCH_INTERVAL_MS, onChange, bus) {
  let prevMtime = null
  let prevIds = new Set()
  let seeded = false

  function check() {
    try {
      const stat = statSync(filePath)
      const currMtime = stat.mtimeMs
      if (prevMtime !== null && prevMtime === currMtime) return

      prevMtime = currMtime
      const before = prevIds
      const routes = loadRoutesFromFile(table, filePath)
      const after = new Set(routes.map((r) => r.id))

      if (!seeded) {
        // 首趟：只取快照，不触发
        seeded = true
        prevIds = after
        return
      }

      const added = [...after].filter((id) => !before.has(id))
      const removed = [...before].filter((id) => !after.has(id))
      if (added.length === 0 && removed.length === 0) {
        prevIds = after
        return
      }
      prevIds = after

      if (onChange) {
        try {
          onChange(added, removed, routes)
        } catch (e) {
          // Ignore callback errors
        }
      }
      if (bus && typeof bus.publish === 'function') {
        try {
          bus.publish('route.changed', added, removed, routes)
        } catch (e) {
          // Ignore bus errors
        }
      }
    } catch (e) {
      // 文件不存在/JSON 解析失败等 — 忽略，保持上一份路由不变
    }
  }

  // 立即执行一次（登记快照）
  check()
  const intervalId = setInterval(check, interval)

  return function stop() {
    if (intervalId) {
      clearInterval(intervalId)
    }
  }
}

/**
 * 触发 Spring Cloud Gateway 丢路由缓存并重读配置（POST /actuator/gateway/refresh）。
 *
 * @param {string} gatewayUrl Gateway 服务器 URL
 * @returns {Promise<unknown>} 网关响应体
 */
export async function refreshRoutes(gatewayUrl) {
  const url = `${gatewayUrl.replace(/\/$/, '')}/actuator/gateway/refresh`
  try {
    const res = await globalThis.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${res.statusText}${text ? ` ${text}` : ''}`)
    }
    const text = await res.text()
    return { ok: true, body: text }
  } catch (e) {
    throw new Error(`Gateway 路由刷新失败 from ${url}: ${e.message}`)
  }
}

/** 查询指定路由定义 */
export async function getRoute(routeId, gatewayUrl) {
  const url = `${gatewayUrl.replace(/\/$/, '')}/actuator/gateway/routes/${routeId}`
  try {
    const res = await globalThis.fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${res.statusText}${text ? ` ${text}` : ''}`)
    }
    const body = await res.json()
    return {
      id: body.id,
      uri: body.uri,
      order: body.order,
      predicates: body.predicates ?? [],
      filters: body.filters ?? [],
    }
  } catch (e) {
    throw new Error(`Gateway 路由查询失败 ${routeId} from ${url}: ${e.message}`)
  }
}

/** 查询全部路由定义 */
export async function getRoutes(gatewayUrl) {
  const url = `${gatewayUrl.replace(/\/$/, '')}/actuator/gateway/routes`
  try {
    const res = await globalThis.fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${res.statusText}${text ? ` ${text}` : ''}`)
    }
    const body = await res.json()
    return body.map((r) => ({
      id: r.id,
      uri: r.uri,
      order: r.order,
      predicates: r.predicates ?? [],
      filters: r.filters ?? [],
    }))
  } catch (e) {
    throw new Error(`Gateway 路由列表查询失败 from ${url}: ${e.message}`)
  }
}

/** CLI 主体：被直接运行时打印 JSON 并退相应码；被 import 时只交出函数。 */
if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const arg = process.argv[2] ?? null
  const gatewayUrl = process.argv[3] ?? DEFAULT_GATEWAY_URL
  try {
    if (arg === 'refresh') {
      const result = await refreshRoutes(gatewayUrl)
      console.log(JSON.stringify(result, null, 2))
    } else if (arg) {
      const route = await getRoute(arg, gatewayUrl)
      console.log(JSON.stringify(route, null, 2))
    } else {
      const routes = await getRoutes(gatewayUrl)
      console.log(JSON.stringify(routes, null, 2))
    }
    process.exit(0)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
