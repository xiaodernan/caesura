/**
 * scripts/pressure-mesh.mjs — 轻量 in-process 压测「api mesh」:
 * 同一「/api/health 路由」在 N 次并发的 M 批调用下，平均延迟、p95、失败率、Heap 增长。
 *
 * 这不是「真实压力」——没有真 IP / 真端到端网络——
 * 它测的是**我们这一侧的路由链 + 决策 + transport mock 的开销**：
 *   1) `createGameCloud` 在内存里 dispatch 一条 Path 路由到 service 所用的 ms
 *   2) `proxyCall` 经 Path filter + service resolution 路由择优的开销
 *   3) 一波 N 请求同时涌入同一个 gate，会不会让 queue / 失败增加
 *
 * 用法：
 *   node scripts/pressure-mesh.mjs --iterations=200 --concurrency=20
 *   node scripts/pressure-mesh.mjs --iterations=500 --concurrency=50 --verbose
 */

import { createGameCloud } from './caesura-game-cloud.mjs'
import { createKubernetesClient } from './spring-cloud-kubernetes-client.mjs'
import { createTracer } from './spring-sleuth-tracer.mjs'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const argFlag = (name) => argv.includes(`--${name}`)

const iterations = Math.max(1, Math.floor(Number(argOf('iterations', '200'))))
const concurrency = Math.max(1, Math.floor(Number(argOf('concurrency', '20'))))
const verbose = argFlag('verbose')

const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const bearer = (() => {
  const h = enc({ alg: 'none', typ: 'JWT' })
  const p = enc({ sub: 'pressure', scope: 'game:call', exp: Math.floor(Date.now() / 1000) + 3600 })
  return `Bearer ${h}.${p}.sig`
})()

const k8s = createKubernetesClient({
  namespace: 'game',
  endpoints: { 'caesura-gate': [{ ip: '10.1.0.1', port: 8099 }] },
})
const tracer = createTracer({ serviceName: 'pressure-mesh' })
const transport = (t, p) => ({ url: t.url, serviceName: t.serviceName, path: p, pressure: true })
const gc = createGameCloud({ gameId: 'caesura-game', gamePort: 7700, cloud: undefined, tracer, transport })

// 一条/api/** → caesura-gate（与 mesh-e2e 同形状）
gc.runtime.routes.add({ id: 'r-gate', uri: 'lb://caesura-gate', order: 0, predicates: [{ name: 'Path', args: { patterns: '/api/**' } }] })

console.log(`pressure mesh: iterations=${iterations} concurrency=${concurrency}`)
console.log('')

// Warm-up
await gc.start()
for (let i = 0; i < Math.min(10, iterations); i++) {
  await gc.proxyCall('caesura-gate', '/api/health')
}

const batch = async (n) => {
  const tasks = []
  for (let i = 0; i < n; i++) {
    tasks.push((async () => {
      const t0 = Number(process.hrtime.bigint() / 1000n)
      try {
        await gc.proxyCall('caesura-gate', '/api/health')
        return { tag: 'ok', dt: Number(process.hrtime.bigint() / 1000n) - t0 }
      } catch (e) {
        return { tag: 'err', dt: Number(process.hrtime.bigint() / 1000n) - t0, err: e?.message || String(e) }
      }
    })())
  }
  return Promise.all(tasks)
}

let okCount = 0, errCount = 0
const latencies = []
const errors = []
const wall0 = Number(process.hrtime.bigint() / 1000n)
const memBefore = process.memoryUsage().heapUsed

for (let i = 0; i < iterations; i += concurrency) {
  const chunk = Math.min(concurrency, iterations - i)
  const rs = await batch(chunk)
  for (const r of rs) {
    latencies.push(r.dt)
    if (r.tag === 'ok') okCount++
    else { errCount++; errors.push(r.err) }
  }
  if (verbose) console.log(`  batch [${Math.floor(i / concurrency)}] ok=${okCount} err=${errCount}`)
}

latencies.sort((a, b) => a - b)
const p = (q) => latencies[Math.floor(latencies.length * q)] || 0
const avg = Math.round(latencies.reduce((s, x) => s + x, 0) / latencies.length)
const wallMs = Math.round(Number(process.hrtime.bigint() / 1000n) - wall0) / 1000
const memAfter = process.memoryUsage().heapUsed

console.log('')
console.log('pressure mesh result:')
console.log(`  ok / total   = ${okCount} / ${iterations}  (${((okCount / iterations) * 100).toFixed(1)}%)`)
console.log(`  errors       = ${errCount} (${((errCount / iterations) * 100).toFixed(2)}%)`)
console.log(`  avg_latency  = ${avg} us`)
console.log(`  p50/p95/p99  = ${p(0.50)} / ${p(0.95)} / ${p(0.99)} us`)
console.log(`  heap_growth  = ${(((memAfter - memBefore) / 1024 / 1024).toFixed(1))} MB (over ${iterations} calls)`)
console.log(`  wall_clock   = ${wallMs} ms`)
if (errors.length) console.log('  sample err   =', JSON.stringify(errors.slice(0, 3)))
console.log('')
process.exit(errCount === 0 ? 0 : 1)
