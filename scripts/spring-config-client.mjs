/**
 * scripts/spring-config-client.mjs —— Spring Cloud Config 客户端（Node.js 侧）。
 *
 * <p>它不做判断，只做**配置获取**：从 Spring Cloud Config Server（caesura-config）
 * 拉取指定应用的配置，返回给 Node.js 侧消费者。所有业务阈值与判定仍由 Node 侧
 * 负责（见 {@code scripts/spring-family-rules.mjs} 的守门判据）；Spring 家族只负责
 * 编排/报告。
 *
 * **为什么不由 Java 直接读配置**：配置服务器是 Java 侧的，Node 侧也需要同一份配置。
 * 让每个 Node 模块各自向 Config Server 请求 = 多个主人；由本脚本统一抓取 = 唯一出处。
 *
 * **与 caesura-client 的区别**：caesura-client 是 Java 侧的 Spring Cloud Config Client，
 * 它在 JVM 内直接读配置；本脚本是 Node.js 侧的 HTTP 客户端，供没有 JVM 的 Node 模块使用。
 *
 * 用法：
 *   node scripts/spring-config-client.mjs <应用名> [配置服务器URL]
 *   例如：node scripts/spring-config-client.mjs caesura-gate http://localhost:8888
 *
 * 输出：JSON 格式的配置内容；失败退非零。
 *
 * 退出码：0 = 成功；1 = HTTP 错误；2 = 用法不对；3 = 网络不通。
 */

/** 默认配置服务器地址（可被环境变量或命令行参数覆盖） */
const DEFAULT_CONFIG_URL = 'http://127.0.0.1:8888'

/** 把 Config Server 的 propertySources 展平成单层键值对 */
function flattenProperties(response) {
  const out = {}
  for (const ps of response.propertySources ?? []) {
    for (const [key, value] of Object.entries(ps.source ?? {})) {
      out[key] = value
    }
  }
  return out
}

/** 获取指定应用的配置 */
export async function fetchConfig(appName, configUrl) {
  const url = `${configUrl.replace(/\/$/, '')}/${appName}/master`
  try {
    const res = await globalThis.fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    }
    const body = await res.json()
    return flattenProperties(body)
  } catch (e) {
    throw new Error(`配置获取失败 ${appName} from ${url}: ${e.message}`)
  }
}

/** CLI 主体：被直接运行时打印 JSON 并退相应码；被 import 时只交出函数。 */
if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const appName = process.argv[2]
  const configUrl = process.argv[3] ?? DEFAULT_CONFIG_URL
  if (!appName) {
    console.error('用法：node scripts/spring-config-client.mjs <应用名> [配置服务器URL]')
    process.exit(2)
  }
  try {
    const config = await fetchConfig(appName, configUrl)
    console.log(JSON.stringify(config, null, 2))
    process.exit(0)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
