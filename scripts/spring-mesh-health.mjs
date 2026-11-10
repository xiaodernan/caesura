/**
 * scripts/spring-mesh-health.mjs —— Spring Cloud 服务网格健康聚合器（Node.js 侧）。
 *
 * <p>它不做判断，只做**服务网格健康聚合**：从 Eureka 发现所有已注册服务，向每个服务
 * 的 /actuator/health 探针，再用 LoadBalancer 选择一个健康实例，输出聚合健康报告。
 * 所有业务阈值与判定仍由 Node 侧负责；Spring 家族只负责编排/报告。
 *
 * **编排流程**：
 *   1. GET /eureka/apps 列出全部已注册应用
 *   2. 对每个应用，GET /eureka/apps/{appId} 查询实例信息
 *   3. 对每个实例，GET /actuator/health 探测健康状态
 *   4. 输出聚合报告：每个服务的健康状态、实例数、健康实例数
 *
 * 用法：
 *   node scripts/spring-mesh-health.mjs [Eureka URL]
 *   例如：node scripts/spring-mesh-health.mjs http://localhost:8761
 *
 * 退出码：0 = 所有服务健康；1 = 有服务不健康；2 = 用法不对；3 = 网络不通。
 */

import { getAppNames } from './spring-eureka-client.mjs'

/** 默认 Eureka 服务器地址 */
const DEFAULT_EUREKA_URL = 'http://127.0.0.1:8761'

/** 探单个实例的健康状态 */
export async function probeInstanceHealth(host, port, contextPath = '') {
  const url = `http://${host}:${port}${contextPath}/actuator/health`
  try {
    const res = await globalThis.fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
    })
    const body = await res.json().catch(() => ({}))
    const status = body.status ?? 'UNKNOWN'
    return { status, healthy: res.ok && status === 'UP' }
  } catch (e) {
    return { status: 'DOWN', healthy: false }
  }
}

/** 聚合单个服务的健康状态：探所有实例，统计健康/不健康数量 */
export async function aggregateServiceHealth(serviceName, instances) {
  const instanceHealths = await Promise.all(
    instances.map(async (inst) => {
      const h = await probeInstanceHealth(inst.hostName, inst.port)
      return {
        instanceId: inst.instanceId,
        host: inst.hostName,
        port: inst.port,
        status: h.status,
        healthy: h.healthy,
      }
    }),
  )

  const healthyCount = instanceHealths.filter((h) => h.healthy).length
  return {
    name: serviceName,
    instanceCount: instances.length,
    healthyCount,
    unhealthyCount: instances.length - healthyCount,
    instances: instanceHealths,
  }
}

/** 聚合全部服务的健康状态：从 Eureka 发现所有应用，逐个探测 */
export async function aggregateMeshHealth(eurekaUrl) {
  const appNames = await getAppNames(eurekaUrl)
  const healths = []

  for (const appName of appNames) {
    try {
      const instances = await getInstances(appName, eurekaUrl)
      const health = await aggregateServiceHealth(appName, instances)
      healths.push(health)
    } catch (e) {
      healths.push({
        name: appName,
        instanceCount: 0,
        healthyCount: 0,
        unhealthyCount: 0,
        instances: [],
      })
    }
  }

  return healths
}

/** 打印健康聚合报告（文本形式） */
export function printMeshHealthReport(healths) {
  console.log('=== Spring Cloud 服务网格健康聚合报告 ===')
  console.log(`服务总数：${healths.length}`)
  console.log(
    `健康服务：${healths.filter((h) => h.unhealthyCount === 0).length} / ${healths.length}`,
  )
  console.log('')

  for (const h of healths) {
    const status = h.unhealthyCount === 0 ? '健康' : h.healthyCount === 0 ? '全部失效' : '部分失效'
    console.log(
      `  ${h.name.padEnd(20)} 实例：${h.healthyCount}/${h.instanceCount} 健康  状态：${status}`,
    )
    for (const inst of h.instances) {
      const mark = inst.healthy ? '✓' : '✗'
      console.log(
        `    ${mark} ${inst.instanceId.padEnd(24)} ${inst.host}:${inst.port}  ${inst.status}`,
      )
    }
  }
  console.log('')
}

/** CLI 主体：被直接运行时打印报告并退相应码；被 import 时只交出函数。 */
if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const eurekaUrl = process.argv[2] ?? DEFAULT_EUREKA_URL
  try {
    const healths = await aggregateMeshHealth(eurekaUrl)
    printMeshHealthReport(healths)
    const hasUnhealthy = healths.some((h) => h.unhealthyCount > 0)
    process.exit(hasUnhealthy ? 1 : 0)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
