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
 * 返回单个路由定义。
 *
 * 用法：
 *   node scripts/spring-gateway-route.mjs [路由ID] [Gateway URL]
 *   例如：node scripts/spring-gateway-route.mjs caesura-gate http://localhost:8099
 *   例如：node scripts/spring-gateway-route.mjs   http://localhost:8099   （列出全部路由）
 *
 * 退出码：0 = 成功；1 = HTTP 错误；2 = 用法不对；3 = 网络不通。
 */

/** 默认 Gateway 服务器地址（与 docker-compose.yml 中 caesura-gateway 的端口一致） */
const DEFAULT_GATEWAY_URL = 'http://localhost:8099'

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
  const routeId = process.argv[2] ?? null
  const gatewayUrl = process.argv[3] ?? DEFAULT_GATEWAY_URL
  try {
    if (routeId) {
      const route = await getRoute(routeId, gatewayUrl)
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
