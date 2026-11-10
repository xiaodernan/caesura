/**
 * scripts/spring-mesh-status.mjs —— Spring Cloud 微服务族可观测性聚合器（Node.js 侧）。
 *
 * <p>把各服务的 health / circuit / configVersion 三族读数收口成一份统一快照，供控制台/看板
 * 一处呈现。任一探针失败只记进该服务的 errors，不会让整次聚合崩掉（判定权仍在 Node 侧）。</p>
 *
 * <p>用法（CLI 仅作探针）：
 *   node scripts/spring-mesh-status.mjs
 *
 * <p>退出码：0 = 成功。</p>
 */

/**
 * 收集整族状态快照。
 * @param {{ services?: Array<{name: string, [k: string]: any}>, health?: (s:any)=>any, circuit?: (s:any)=>any, configVersion?: (s:any)=>any }} opts
 * @returns {Promise<{ services: Array<{name:string, health:any, circuit:any, configVersion:any, errors:string[]}>, summary: {total:number, healthy:number, open:number, degraded:number, errors:number} }>}
 */
export async function collectMeshStatus(opts) {
  const services = opts?.services ?? []
  const health = opts?.health ?? (() => Promise.resolve({ status: 'UP' }))
  const circuit = opts?.circuit ?? (() => Promise.resolve({ state: 'CLOSED' }))
  const configVersion = opts?.configVersion ?? (() => Promise.resolve(null))

  const out = []
  for (const s of services) {
    const entry = { name: s.name, health: null, circuit: null, configVersion: null, errors: [] }
    try { entry.health = await health(s) } catch (e) { entry.errors.push(`health: ${e?.message ?? e}`) }
    try { entry.circuit = await circuit(s) } catch (e) { entry.errors.push(`circuit: ${e?.message ?? e}`) }
    try { entry.configVersion = await configVersion(s) } catch (e) { entry.errors.push(`config: ${e?.message ?? e}`) }
    out.push(entry)
  }
  const healthy = out.filter((e) => e.health?.status === 'UP' && (!e.circuit || e.circuit.state === 'CLOSED')).length
  const open = out.filter((e) => e.circuit?.state === 'OPEN').length
  const summary = {
    total: out.length,
    healthy,
    open,
    degraded: out.length - healthy,
    errors: out.reduce((a, e) => a + e.errors.length, 0),
  }
  return { services: out, summary }
}

if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  collectMeshStatus({ services: [{ name: 'caesura-config' }, { name: 'caesura-gate' }] })
    .then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0) })
}
