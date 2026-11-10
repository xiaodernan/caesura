/**
 * scripts/spring-config-refresh.mjs —— Spring Cloud 配置刷新综合脚本（Node.js 侧）。
 *
 * <p>它不做判断，只做**配置刷新编排**：先用 spring-config-client 从 Config Server
 * 拉取指定应用的配置，再用 spring-bus-client 向 Eureka 注册的服务广播 bus-refresh
 * 事件，触发各服务从 Config Server 重新拉取配置。所有业务阈值与判定仍由 Node 侧
 * 负责；Spring 家族只负责编排/报告。
 *
 * **编排流程**：
 *   1. GET /eureka/apps 列出全部已注册应用
 *   2. 对每个应用（或指定应用），GET /eureka/apps/{appId} 查询实例信息
 *   3. GET /actuator/bus-refresh POST 广播刷新事件（或指定目标服务）
 *
 * **为什么不由 Java 直接完成编排**：配置刷新的触发时机和策略是 Node 侧的编排决策，
 * 让每个 Node 模块各自构造 HTTP 请求序列 = 多个主人；由本脚本统一抓取 = 唯一出处。
 *
 * 用法：
 *   node scripts/spring-config-refresh.mjs [应用名] [Eureka URL] [Config Server URL]
 *   例如：node scripts/spring-config-refresh.mjs caesura-gate http://localhost:8761 http://localhost:8081
 *   例如：node scripts/spring-config-refresh.mjs   http://localhost:8761 http://localhost:8081   （刷新全部）
 *
 * 退出码：0 = 成功；1 = 操作失败；2 = 用法不对；3 = 网络不通。
 */

import { fetchConfig } from './spring-config-client.mjs'
import { busRefresh } from './spring-bus-client.mjs'
import { getAppNames } from './spring-eureka-client.mjs'

/** 默认 Eureka 服务器地址 */
const DEFAULT_EUREKA_URL = 'http://127.0.0.1:8761'
/** 默认 Config Server 地址 */
const DEFAULT_CONFIG_URL = 'http://127.0.0.1:8888'

/** 刷新指定应用：先拉取配置，再广播 bus-refresh（返回结构体，CLI 是唯一消费方） */
export async function refreshApp(appName, eurekaUrl, configUrl, busRefreshUrl) {
  // 第一步：拉取配置（验证应用在 Config Server 上可读）
  const config = await fetchConfig(appName, configUrl)
  console.log(`[refresh] ${appName} 配置已拉取：${Object.keys(config).length} 个属性`)

  // 第二步：广播 bus-refresh（未传 busRefreshUrl 时，按 configUrl 推导：8888→8081，否则原样透传）
  const target = busRefreshUrl ?? (typeof configUrl === 'string' && configUrl.includes(':8888') ? configUrl.replace(':8888', ':8081') : configUrl ?? 'http://127.0.0.1:8081')
  const result = await busRefresh(appName, target)
  console.log(`[refresh] ${appName} bus-refresh 已发送：status=${result?.status ?? 'unknown'}`)
  return {
    appName,
    configPropsCount: Object.keys(config).length,
    busRefreshEndpoint: target,
    busRefreshBody: result,
  }
}

/** 刷新全部应用：列出 Eureka 中的所有应用，逐一刷新 */
export async function refreshAll(eurekaUrl, configUrl) {
  const appNames = await getAppNames(eurekaUrl)
  console.log(`[refresh] 发现 ${appNames.length} 个已注册应用：${appNames.join(', ')}`)
  for (const appName of appNames) {
    try {
      await refreshApp(appName, eurekaUrl, configUrl)
    } catch (e) {
      console.warn(`[refresh] ${appName} 刷新失败：${e.message}`)
    }
  }
}

/** CLI 主体：被直接运行时执行刷新并退相应码；被 import 时只交出函数。 */
if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const appName = process.argv[2] ?? null
  const eurekaUrl = process.argv[3] ?? DEFAULT_EUREKA_URL
  const configUrl = process.argv[4] ?? DEFAULT_CONFIG_URL
  try {
    if (appName) {
      await refreshApp(appName, eurekaUrl, configUrl)
    } else {
      await refreshAll(eurekaUrl, configUrl)
    }
    process.exit(0)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
