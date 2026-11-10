/**
 * scripts/spring-discovery.mjs —— Spring Cloud 服务发现与配置综合客户端（Node.js 侧）。
 *
 * <p>它不做判断，只做**服务发现 + 配置获取**的组合编排：
 *   1. 向 Eureka Server 查询已注册服务的实例信息（主机名、端口、状态）
 *   2. 向 Config Server 拉取指定应用的配置
 *   3. 将两者合并输出，供 Node.js 侧消费者构造完整的服务调用地址
 *
 * 所有业务阈值与判定仍由 Node 侧负责；Spring 家族只负责编排/报告。
 *
 * **为什么不由 Java 直接完成**：Node.js 侧需要知道「哪些服务可用、在哪个端口、配置是什么」，
 * 让每个 Node 模块各自构造 Eureka + Config 查询 = 多个主人；由本脚本统一抓取 = 唯一出处。
 *
 * 用法：
 *   node scripts/spring-discovery.mjs [应用名] [Eureka URL] [Config URL]
 *   例如：node scripts/spring-discovery.mjs caesura-gate http://localhost:8761 http://localhost:8888
 *   例如：node scripts/spring-discovery.mjs   http://localhost:8761 http://localhost:8888   （列出全部应用及其配置）
 *
 * 退出码：0 = 成功；1 = 操作失败；2 = 用法不对；3 = 网络不通。
 */

import { fetchConfig } from './spring-config-client.mjs'
import { getInstances, getAppNames } from './spring-eureka-client.mjs'

/** 默认 Eureka 服务器地址 */
const DEFAULT_EUREKA_URL = 'http://127.0.0.1:8761'
/** 默认 Config Server 地址 */
const DEFAULT_CONFIG_URL = 'http://127.0.0.1:8888'

/** 发现指定应用：查实例 + 拉配置，合并输出 */
export async function discoverApp(appName, eurekaUrl, configUrl) {
  const [instances, config] = await Promise.all([
    getInstances(appName, eurekaUrl),
    fetchConfig(appName, configUrl),
  ])
  return {
    name: appName,
    instances: instances.map((inst) => ({
      instanceId: inst.instanceId,
      hostName: inst.hostName,
      ipAddr: inst.ipAddr,
      port: inst.port,
      status: inst.status,
    })),
    config,
  }
}

/** 发现全部应用：列出 Eureka 中的所有应用，逐一查实例 + 拉配置 */
export async function discoverAll(eurekaUrl, configUrl) {
  const appNames = await getAppNames(eurekaUrl)
  const views = []
  for (const appName of appNames) {
    try {
      views.push(await discoverApp(appName, eurekaUrl, configUrl))
    } catch (e) {
      console.warn(`[discovery] ${appName} 发现失败：${e.message}`)
    }
  }
  return views
}

/** CLI 主体：被直接运行时打印 JSON 并退相应码；被 import 时只交出函数。 */
if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const appName = process.argv[2] ?? null
  const eurekaUrl = process.argv[3] ?? DEFAULT_EUREKA_URL
  const configUrl = process.argv[4] ?? DEFAULT_CONFIG_URL
  try {
    if (appName) {
      const view = await discoverApp(appName, eurekaUrl, configUrl)
      console.log(JSON.stringify(view, null, 2))
    } else {
      const views = await discoverAll(eurekaUrl, configUrl)
      console.log(JSON.stringify(views, null, 2))
    }
    process.exit(0)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
