#!/usr/bin/env node
/**
 * scripts/spring-health-check.mjs —— Spring Cloud 家族健康探针（KI-422 扩展）。
 *
 * <p>它只干一件事：向 Spring 家族的每一服务探 `/actuator/health`，把返回码与
 * body 原样交给调用方。**它不做判断**——「UP 还是 DOWN」由 Node 侧的调用方
 * 自己决定（像 `scripts/phase-status.mjs` 只量不决，判断由门自己答）。
 *
 * **为什么不由 Java 自己报健康**：健康探针住在 Node 侧，是因为「哪一服务该不该被信任」
 * 是 Node 侧的编排决策（见 `scripts/spring-family-rules.mjs` 的 `serviceTopologyFindings`）。
 * Java 侧只负责「我起来了」、「我拉到了配置」、「熔断器已就绪」这三条编排事实。
 *
 * 用法：
 *   node scripts/spring-health-check.mjs              探全部五服务（端口 8081/8082/8083/8761/8888/8099）
 *   node scripts/spring-health-check.mjs caesura-gate 只探一道门（名 → 端口，见下表）
 *
 * 退出码：0 = 全部 UP；1 = 有 DOWN；2 = 用法不对／连不上（拒绝连接不是服务 DOWN，是网络不通）。
 */

/** 服务名 → 管理端口（与 docker-compose.yml / 各 application.yml 同步，唯一出处） */
export const SERVICE_PORTS = new Map([
  ['caesura-registry', 8761],
  ['caesura-config', 8888],
  ['caesura-gate', 8081],
  ['caesura-report', 8082],
  ['caesura-client', 8083],
  ['caesura-gateway', 8099],
])

/** 一个服务的 health 上下文路径（context-path 与 actuator 路径的组合） */
export const HEALTH_PATH = new Map([
  ['caesura-registry', '/actuator/health'],
  ['caesura-config', '/actuator/health'],
  ['caesura-gate', '/gate/actuator/health'],
  ['caesura-report', '/report/actuator/health'],
  ['caesura-client', '/actuator/health'],
  ['caesura-gateway', '/actuator/health'],
])

/** 探一道服务：返回 { name, port, ok, status, body } */
export async function probeOne(name) {
  const port = SERVICE_PORTS.get(name)
  const path = HEALTH_PATH.get(name)
  if (port === undefined || path === undefined) {
    return { name, port: null, ok: false, status: null, body: `未知服务：${name}` }
  }
  const url = `http://127.0.0.1:${port}${path}`
  try {
    const res = await globalThis.fetch(url, { signal: AbortSignal.timeout(3000) })
    const text = await res.text()
    let body = null
    try { body = JSON.parse(text) } catch { body = text }
    return { name, port, ok: res.ok, status: res.status, body }
  } catch (e) {
    return { name, port, ok: false, status: null, body: e.message }
  }
}

/** 探全部服务，返回每份结果 */
export async function probeAll() {
  const results = []
  for (const [name] of SERVICE_PORTS) {
    results.push(await probeOne(name))
  }
  return results
}

/** CLI 主体：被直接运行时打印表格并退相应码；被 import 时只交出函数。 */
if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const name = process.argv[2]
  if (name) {
    const r = await probeOne(name)
    console.log(JSON.stringify(r, null, 2))
    process.exit(r.ok ? 0 : 1)
  } else {
    const results = await probeAll()
    let allUp = true
    for (const r of results) {
      const mark = r.ok ? 'UP ' : 'DOWN'
      console.log(`${mark.padEnd(5)} ${r.name.padEnd(16)} :${r.port} ${r.status ?? '-'} ${typeof r.body === 'string' ? r.body.slice(0, 80) : JSON.stringify(r.body).slice(0, 80)}`)
      if (!r.ok) allUp = false
    }
    process.exit(allUp ? 0 : 1)
  }
}
