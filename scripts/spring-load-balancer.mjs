/**
 * scripts/spring-load-balancer.mjs —— Spring Cloud LoadBalancer 客户端（Node.js 侧）。
 *
 * <p>它不做判断，只做**基于 Eureka 服务发现的客户端负载均衡**：从 Eureka 查询服务
 * 实例列表，按策略（轮询/随机/权重）选择一个目标实例，供 Node.js 侧消费者构造
 * 服务调用地址。所有业务阈值与判定仍由 Node 侧负责；Spring 家族只负责
 * 编排/报告。
 *
 * **为什么不由 Java 直接完成负载均衡**：Node.js 侧也需要跨服务调用时的实例选择，
 * 让每个 Node 模块各自维护负载均衡状态 = 多个主人；由本脚本统一抓取 = 唯一出处。
 *
 * **策略**：
 *   - round-robin：按顺序轮转，每个实例平均分得请求
 *   - random：随机选择一个实例
 *   - weight：按权重选择（权重由实例 metadata 中的 weight 字段指定，缺省 1）
 *
 * 用法：
 *   node scripts/spring-load-balancer.mjs [服务名] [策略] [Eureka URL]
 *   例如：node scripts/spring-load-balancer.mjs caesura-gate round-robin http://localhost:8761
 *   例如：node scripts/spring-load-balancer.mjs caesura-gate random   http://localhost:8761
 *
 * 退出码：0 = 成功；1 = 无可用实例；2 = 用法不对；3 = 网络不通。
 */

/** 默认 Eureka 服务器地址 */
const DEFAULT_EUREKA_URL = 'http://127.0.0.1:8761'

/** 默认负载均衡策略 */
const DEFAULT_STRATEGY = 'round-robin'

/** 从 Eureka 实例列表构造负载均衡目标 */
function eurekaInstancesToTargets(serviceName, instances) {
  return instances.map((inst) => ({
    serviceName,
    instanceId: inst.instanceId,
    host: inst.hostName || inst.ipAddr,
    port: inst.port.$ ?? inst.port,
    scheme: inst.securePort.enabled ? 'https' : 'http',
    metadata: inst.metadata ?? {},
  }))
}

/** 构造负载均衡器 */
export function createLoadBalancer(serviceName, instances, strategy = DEFAULT_STRATEGY) {
  const targets = eurekaInstancesToTargets(serviceName, instances)
  return { serviceName, strategy, targets, cursor: 0 }
}

/** 选择下一个目标实例 */
export function selectTarget(balancer) {
  if (balancer.targets.length === 0) return null

  const { strategy, targets } = balancer

  if (strategy === 'round-robin') {
    const target = targets[balancer.cursor % targets.length]
    balancer.cursor = (balancer.cursor + 1) % targets.length
    return target
  }

  if (strategy === 'random') {
    const idx = Math.floor(Math.random() * targets.length)
    return targets[idx]
  }

  if (strategy === 'weight') {
    const totalWeight = targets.reduce(
      (sum, t) => sum + (Number(t.metadata.weight ?? 1) || 1),
      0,
    )
    let r = Math.random() * totalWeight
    for (const t of targets) {
      const w = Number(t.metadata.weight ?? 1) || 1
      if (r < w) return t
      r -= w
    }
    return targets[targets.length - 1]
  }

  return targets[0]
}

/** 从 Eureka 查询并构造负载均衡器，然后选择目标 */
export async function selectFromEureka(serviceName, eurekaUrl, strategy = DEFAULT_STRATEGY) {
  const { getInstances } = await import('./spring-eureka-client.mjs')
  const instances = await getInstances(serviceName, eurekaUrl)
  if (instances.length === 0) return null
  const balancer = createLoadBalancer(serviceName, instances, strategy)
  return selectTarget(balancer)
}

/** 把目标实例格式化为完整 URL */
export function targetToUrl(target, path = '') {
  return `${target.scheme}://${target.host}:${target.port}${path}`
}

/** CLI 主体：被直接运行时打印 JSON 并退相应码；被 import 时只交出函数。 */
if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const serviceName = process.argv[2] ?? null
  const strategy = process.argv[3] ?? DEFAULT_STRATEGY
  const eurekaUrl = process.argv[4] ?? DEFAULT_EUREKA_URL

  if (!serviceName) {
    console.error('用法：node scripts/spring-load-balancer.mjs <服务名> [策略] [Eureka URL]')
    process.exit(2)
  }

  try {
    const target = await selectFromEureka(serviceName, eurekaUrl, strategy)
    if (!target) {
      console.error(`服务 ${serviceName} 没有可用实例`)
      process.exit(1)
    }
    console.log(JSON.stringify({ serviceName, strategy, target, url: targetToUrl(target) }, null, 2))
    process.exit(0)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
