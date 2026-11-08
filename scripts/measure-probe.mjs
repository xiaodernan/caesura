#!/usr/bin/env node
/**
 * scripts/measure-probe.mjs — Phase 9 的量值盘（docs/roadmap-next.md §3.2 第一条）。
 *
 * 跑一次 `tests/flow/perf-probe.test.ts`（12 只混编开局即最大负载、3600 拍 = 1 分钟@60Hz），
 * 把探头印出的那行 `[perf-probe] {…}` JSON 追加进 `artifacts/perf-probe-<date>.log`。
 *
 * **只读，不改任何东西**：日志是本地读数，不入库（KI-410：`artifacts/` 不入库——与截图证据同一个规矩）。
 * 它抱的是 vitest，不是跑测器（`scripts/test.mjs` 用 JSON reporter，`console.log` 会被吃进报告文件，
 * 印不到终端）；`[perf-probe]` 那一行是探头的机器判决，凡是读不到就当**没有读数**（exit 2），
 * 不说谎（§5.7「不要猜性能」：量不到就是量不到）。
 *
 * 用法：node scripts/measure-probe.mjs
 *   退出码：0 = 量到了并落盘；1 = 跑红了；2 = 没有可归因的读数（不开跑/跑了没印）。
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, appendFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VITEST = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')
const OUT_DIR = join(ROOT, 'artifacts')
const DATE = new Intl.DateTimeFormat('en-CA').format(new Date()) // YYYY-MM-DD, local
const OUT = join(OUT_DIR, `perf-probe-${DATE}.log`)

if (!existsSync(VITEST)) {
  console.error('[measure-probe] 找不到 node_modules/vitest/vitest.mjs——先 npm install')
  process.exit(2)
}

console.log(`[measure-probe] 平面 ${ROOT}；spawn vitest → tests/flow/perf-probe.test.ts`)
const r = spawnSync(process.execPath, [VITEST, 'run', 'tests/flow/perf-probe.test.ts', '--reporter=verbose'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 1 << 26,
})
const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
const line = out.split('\n').find((l) => l.includes('[perf-probe] '))
if (!line) {
  console.error('[measure-probe] 探头没有印出 [perf-probe] 那一行——本趟没有读数，不落账：\n' + out.slice(-1500))
  process.exit(2)
}
const m = line.match(/\{.*\}/)
mkdirSync(OUT_DIR, { recursive: true })
appendFileSync(OUT, `${new Date().toISOString()}  exit=${r.status}\n${m ? m[0] : line.trim()}\n\n`)

console.log('[measure-probe] 读数（本趟，未入库；落进 ' + OUT + '）：')
try {
  const j = JSON.parse(m?.[0] ?? line)
  for (const [k, v] of Object.entries(j)) console.log(`  ${k}: ${v}`)
} catch {
  console.log('  ' + line.trim())
}
if (r.status !== 0) {
  console.error(`[measure-probe] 探头那一趟退出码 ${r.status}——记的是失败，不是干净读数`)
  process.exit(1)
}
process.exit(0)
