/**
 * scripts/spring-bus-client.mjs —— Spring Cloud Bus 事件总线客户端（Node.js 侧）。
 *
 * <p>它不做判断，只做**配置刷新广播**：向 Spring Cloud Bus 的 `/actuator/bus-refresh`
 * 端点发送 POST 请求，触发目标服务（或全部服务）从 Config Server 重新拉取配置。
 * 所有业务阈值与判定仍由 Node 侧负责；Spring 家族只负责编排/报告。
 *
 * **为什么不由 Java 直接发 bus 事件**：配置刷新的触发方可能是 Node.js 侧的脚本或工具，
 * 让每个 Node 模块各自构造 HTTP 请求 = 多个主人；由本脚本统一抓取 = 唯一出处。
 *
 * **与 spring-config-client 的区别**：config-client 是**拉取**配置（GET），bus-client 是**推送**刷新（POST）。
 * 两者互补：Node 侧用 config-client 读当前配置，用 bus-client 通知各服务重新读。
 *
 * 用法：
 *   node scripts/spring-bus-client.mjs [服务名] [配置服务器URL]
 *   例如：node scripts/spring-bus-client.mjs caesura-gate http://localhost:8081
 *   例如：node scripts/spring-bus-client.mjs   http://localhost:8081   （广播给全部服务）
 *
 * 退出码：0 = 成功；1 = HTTP 错误；2 = 用法不对；3 = 网络不通。
 */

/** 默认配置服务器地址（可被环境变量或命令行参数覆盖） */
const DEFAULT_CONFIG_URL = 'http://127.0.0.1:8081'

/** 发送 bus-refresh 刷新事件 */
export async function busRefresh(serviceName, configUrl) {
  const url = `${configUrl.replace(/\/$/, '')}/actuator/bus-refresh`
  try {
    const res = await globalThis.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: serviceName ? JSON.stringify({ destination: serviceName }) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${res.statusText}${text ? ` ${text}` : ''}`)
    }
    const body = await res.json()
    return body
  } catch (e) {
    throw new Error(`bus-refresh 失败 ${serviceName ?? '全部服务'} from ${url}: ${e.message}`)
  }
}

/** CLI 主体：被直接运行时打印 JSON 并退相应码；被 import 时只交出函数。 */
if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const serviceName = process.argv[2] ?? null
  const configUrl = process.argv[3] ?? DEFAULT_CONFIG_URL
  try {
    const result = await busRefresh(serviceName, configUrl)
    console.log(JSON.stringify(result, null, 2))
    process.exit(0)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
