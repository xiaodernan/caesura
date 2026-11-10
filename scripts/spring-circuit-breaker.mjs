/**
 * scripts/spring-circuit-breaker.mjs —— Spring Cloud 熔断器客户端（Node.js 侧）。
 *
 * <p>它不做判断，只做**熔断器状态查询**：向 caesura-gate 的熔断器端点查询各门的
 * 熔断状态（CLOSED/OPEN/HALF_OPEN、连续失败次数、冷却剩余时间等），供 Node.js 侧
 * 消费者构造熔断感知逻辑。所有业务阈值与判定仍由 Node 侧负责；Spring 家族只负责
 * 编排/报告。
 *
 * **为什么不由 Java 直接查熔断器**：Node.js 侧也需要知道哪些门处于熔断状态，
 * 让每个 Node 模块各自构造熔断器查询 = 多个主人；由本脚本统一抓取 = 唯一出处。
 *
 * **熔断器端点**：GET /actuator/circuitbreakers 返回所有熔断器状态；
 * GET /actuator/circuitbreakers/{name} 返回单个熔断器状态。
 *
 * 用法：
 *   node scripts/spring-circuit-breaker.mjs [熔断器名] [Gate URL]
 *   例如：node scripts/spring-circuit-breaker.mjs fx_dust http://localhost:8081
 *   例如：node scripts/spring-circuit-breaker.mjs   http://localhost:8081   （列出全部熔断器）
 *
 * 退出码：0 = 成功；1 = HTTP 错误；2 = 用法不对；3 = 网络不通。
 */

/** 默认 Gate 服务器地址（与 docker-compose.yml 中 caesura-gate 的端口一致） */
const DEFAULT_GATE_URL = 'http://localhost:8081'

/** 查询单个熔断器状态 */
export async function getCircuitBreaker(name, gateUrl) {
  const url = `${gateUrl.replace(/\/$/, '')}/actuator/circuitbreakers/${name}`
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
      name: body.name,
      state: body.state,
      failureRate: body.failureRate,
      failureThreshold: body.failureThreshold,
      slowCallRate: body.slowCallRate,
      slowCallRateThreshold: body.slowCallRateThreshold,
      bufferedCalls: body.bufferedCalls,
    }
  } catch (e) {
    throw new Error(`熔断器查询失败 ${name} from ${url}: ${e.message}`)
  }
}

/** 查询全部熔断器状态 */
export async function getCircuitBreakers(gateUrl) {
  const url = `${gateUrl.replace(/\/$/, '')}/actuator/circuitbreakers`
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
    return body.map((b) => ({
      name: b.name,
      state: b.state,
      failureRate: b.failureRate,
      failureThreshold: b.failureThreshold,
      slowCallRate: b.slowCallRate,
      slowCallRateThreshold: b.slowCallRateThreshold,
      bufferedCalls: b.bufferedCalls,
    }))
  } catch (e) {
    throw new Error(`熔断器列表查询失败 from ${url}: ${e.message}`)
  }
}

/** CLI 主体：被直接运行时打印 JSON 并退相应码；被 import 时只交出函数。 */
if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const name = process.argv[2] ?? null
  const gateUrl = process.argv[3] ?? DEFAULT_GATE_URL
  try {
    if (name) {
      const state = await getCircuitBreaker(name, gateUrl)
      console.log(JSON.stringify(state, null, 2))
    } else {
      const states = await getCircuitBreakers(gateUrl)
      console.log(JSON.stringify(states, null, 2))
    }
    process.exit(0)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
