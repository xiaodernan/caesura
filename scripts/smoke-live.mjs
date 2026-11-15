/**
 * scripts/smoke-live.mjs — 公开站冒烟自检（2026-11-15 落）
 *
 * 只读地探六个公开入口 + site-latest.json：
 *   https://xiaodernan.github.io/caesura/
 *   ├── tutorial/     （入门教程）
 *   ├── cast/         （角色图鉴）
 *   ├── codex/        （世界谱）
 *   ├── story/        （《盐》短篇）
 *   ├── console/      （集大成调度台）
 *   └── raw.githubusercontent.com/xiaodernan/caesura/master/site-latest.json
 *
 * 纪律：
 *   - 每条入口带一个**必须出现**的最小标记（读起来是那页还是旧页/404）
 *   - 只 GET，不上传，不复用任何凭证；超时 10s
 *   - 退出码：0 = 全绿；1 = 至少一条红（输出机器可读一行）
 *   - 用法：`node scripts/smoke-live.mjs`（人眼跑） / `--json`（CI 吃）
 */
import { argv, exit } from 'node:process'

const ENDPOINTS = [
  { name: 'game', url: 'https://xiaodernan.github.io/caesura/', marker: '止音纪元' },
  { name: 'tutorial', url: 'https://xiaodernan.github.io/caesura/tutorial/', marker: '入门教程' },
  { name: 'cast', url: 'https://xiaodernan.github.io/caesura/cast/', marker: '角色图鉴' },
  { name: 'codex', url: 'https://xiaodernan.github.io/caesura/codex/', marker: '世界谱' },
  { name: 'story', url: 'https://xiaodernan.github.io/caesura/story/', marker: '盐' },
  { name: 'console', url: 'https://xiaodernan.github.io/caesura/console/', marker: '集大成' },
  { name: 'site-latest', url: 'https://raw.githubusercontent.com/xiaodernan/caesura/master/site-latest.json', marker: '"schema": 1' },
]

const asJson = argv.includes('--json')

const results = []
for (const e of ENDPOINTS) {
  const t0 = performance.now()
  try {
    const res = await fetch(e.url, { signal: AbortSignal.timeout(10000) })
    const text = await res.text()
    const ok = res.ok && text.includes(e.marker)
    results.push({ name: e.name, ok, status: res.status, bytes: Buffer.byteLength(text), ms: Math.round(performance.now() - t0) })
  } catch (err) {
    results.push({ name: e.name, ok: false, status: 0, bytes: 0, ms: Math.round(performance.now() - t0), error: String(err) })
  }
}

const failed = results.filter((r) => !r.ok)
const summary = { total: results.length, ok: results.length - failed.length, failed: failed.map((r) => r.name), results }

if (asJson) {
  console.log(JSON.stringify(summary))
} else {
  console.log('[smoke-live] public-site smoke check')
  for (const r of results) {
    const mark = r.ok ? 'pass' : 'FAIL'
    console.log(`  ${mark} ${r.name.padEnd(12)} HTTP ${String(r.status).padStart(3)} ${String(r.bytes).padStart(7)} B ${String(r.ms).padStart(5)} ms`)
  }
  console.log(`[smoke-live] ${summary.ok}/${summary.total} endpoints ok${failed.length ? ' — FAILED: ' + failed.map((r) => r.name).join(', ') : ''}`)
}
exit(failed.length === 0 ? 0 : 1)
