/**
 * scripts/spring-eureka-client.mjs —— Spring Cloud Eureka 服务发现客户端（Node.js 侧）。
 *
 * <p>它不做判断，只做**服务发现查询**：向 Eureka Server 查询已注册服务的实例信息
 *（主机名、端口、健康状态等），供 Node.js 侧消费者构造服务调用地址。
 * 所有业务阈值与判定仍由 Node 侧负责；Spring 家族只负责编排/报告。
 *
 * **为什么不由 Java 直接查 Eureka**：Node.js 侧也需要知道哪些服务可用、在哪个端口，
 * 让每个 Node 模块各自构造 Eureka 查询 = 多个主人；由本脚本统一抓取 = 唯一出处。
 *
 * **Eureka API**：GET /eureka/apps/{appId} 返回该应用的所有实例；GET /eureka/apps 返回全部应用。
 *
 * 用法：
 *   node scripts/spring-eureka-client.mjs [应用名] [Eureka服务器URL]
 *   例如：node scripts/spring-eureka-client.mjs caesura-gate http://localhost:8761
 *   例如：node scripts/spring-eureka-client.mjs   http://localhost:8761   （列出全部应用）
 *
 * 退出码：0 = 成功；1 = HTTP 错误；2 = 用法不对；3 = 网络不通。
 */

/** 默认 Eureka 服务器地址（与各服务 application.yml 的 eureka.client.defaultZone 一致） */
const DEFAULT_EUREKA_URL = 'http://127.0.0.1:8761'

/** 查询指定应用的所有实例 */
export async function getInstances(appName, eurekaUrl) {
  const url = `${eurekaUrl.replace(/\/$/, '')}/eureka/apps/${appName}`
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
    const apps = body.applications?.application ?? []
    const app = apps.find((a) => a.name?.toUpperCase() === appName.toUpperCase())
    if (!app) return []
    return (app.instance ?? []).map((inst) => ({
      instanceId: inst.instanceId,
      hostName: inst.hostName,
      ipAddr: inst.ipAddr,
      port: Number(inst.port?.$ ?? 0),
      status: inst.status,
      homePageUrl: inst.homePageUrl,
    }))
  } catch (e) {
    throw new Error(`Eureka 查询失败 ${appName} from ${url}: ${e.message}`)
  }
}

/** 查询全部已注册应用名 */
export async function getAppNames(eurekaUrl) {
  const url = `${eurekaUrl.replace(/\/$/, '')}/eureka/apps`
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
    return (body.applications?.application ?? []).map((a) => a.name)
  } catch (e) {
    throw new Error(`Eureka 查询全部应用失败 from ${url}: ${e.message}`)
  }
}

/** CLI 主体：被直接运行时打印 JSON 并退相应码；被 import 时只交出函数。 */
if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const appName = process.argv[2] ?? null
  const eurekaUrl = process.argv[3] ?? DEFAULT_EUREKA_URL
  try {
    if (appName) {
      const instances = await getInstances(appName, eurekaUrl)
      console.log(JSON.stringify(instances, null, 2))
    } else {
      const names = await getAppNames(eurekaUrl)
      console.log(JSON.stringify(names, null, 2))
    }
    process.exit(0)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
