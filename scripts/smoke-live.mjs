/**
 * scripts/smoke-live.mjs — 公开站冒烟自检（2026-11-15 落）
 *
 * 只读地探六个公开入口 + site-latest.json：
 *   https://xiaodernan.github.io/caesura/
 *   ├── tutorial/     （入门教程）
 *   ├── cast/         （角色图鉴）
 *   ├── codex/        （世界谱）
 *   ├── story/        （《盐》短篇）
 *   ├── story/unnamed-stone/（短篇之二）
 *   ├── story/empty-bar/（短篇之三）
 *   ├── story/ledger/（短篇之四）
 *   ├── story/garden/（短篇之五）
 *   ├── story/tribunal/（短篇之六）
 *   ├── story/anthology/（余响集 · 全集页）
 *   ├── story/frostbell/（短篇之七）
 *   ├── story/doors/（短篇之八）
 *   ├── story/stonethroat/（短篇之九）
 *   ├── story/first-bell/（短篇之十 · 创世）
 *   ├── story/dark-tide/（短篇之十一 · 暗潮 · 黑暗森林）
 *   ├── story/twelfth-listener/（短篇之十二 · 后记 · 第十二个听者）
 *   ├── story/bell-picker/（短篇之十三 · 拾钟人 · 余响拾遗）
 *   ├── story/lampwright-bell/（短篇之十四 · 灯匠 · 破碎的铜）
 *   ├── console/      （集大成调度台）
 *   ├── admin/        （止音后台 · 用户观察站 · 密码 123 · 静态页种子数据）
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
  { name: 'story-2', url: 'https://xiaodernan.github.io/caesura/story/unnamed-stone/', marker: '无名碑' },
  { name: 'console', url: 'https://xiaodernan.github.io/caesura/console/', marker: '集大成' },
  { name: 'site-latest', url: 'https://raw.githubusercontent.com/xiaodernan/caesura/master/site-latest.json', marker: '"schema": 1' },
  { name: 'hub', url: 'https://xiaodernan.github.io/', marker: '/caesura/story/' },
  { name: 'story-3', url: 'https://xiaodernan.github.io/caesura/story/empty-bar/', marker: '空拍子' },
  { name: 'story-4', url: 'https://xiaodernan.github.io/caesura/story/ledger/', marker: '账本' },
  { name: 'story-5', url: 'https://xiaodernan.github.io/caesura/story/garden/', marker: '回声庭园' },
  { name: 'story-6', url: 'https://xiaodernan.github.io/caesura/story/tribunal/', marker: '雨审判' },
  { name: 'story-7', url: 'https://xiaodernan.github.io/caesura/story/anthology/', marker: '余响集' },
  { name: 'story-8', url: 'https://xiaodernan.github.io/caesura/story/frostbell/', marker: '霜锤' },
  { name: 'story-9', url: 'https://xiaodernan.github.io/caesura/story/doors/', marker: '千门' },
  { name: 'story-10', url: 'https://xiaodernan.github.io/caesura/story/stonethroat/', marker: '石喉' },
  { name: 'story-11', url: 'https://xiaodernan.github.io/caesura/story/first-bell/', marker: '第一钟' },
  { name: 'admin', url: 'https://xiaodernan.github.io/caesura/admin/', marker: 'CAESURA / USER OBSERVATORY' },
  { name: 'story-12', url: 'https://xiaodernan.github.io/caesura/story/dark-tide/', marker: '暗潮' },
  { name: 'story-13', url: 'https://xiaodernan.github.io/caesura/story/twelfth-listener/', marker: '第十二个听者' },
  { name: 'story-14', url: 'https://xiaodernan.github.io/caesura/story/bell-picker/', marker: '拾钟人' },
  { name: 'story-15', url: 'https://xiaodernan.github.io/caesura/story/lampwright-bell/', marker: '灯匠' },
  { name: 'story-16', url: 'https://xiaodernan.github.io/caesura/story/lowtone-city/', marker: '低音之城' },
  { name: 'story-17', url: 'https://xiaodernan.github.io/caesura/story/pendulum-ferryman/', marker: '钟摆渡人' },
  { name: 'story-18', url: 'https://xiaodernan.github.io/caesura/story/unfinished-ledger/', marker: '未竟账页' },
  { name: 'story-19', url: 'https://xiaodernan.github.io/caesura/story/fourth-strike/', marker: '第四下' },
  { name: 'story-20', url: 'https://xiaodernan.github.io/caesura/story/last-string/', marker: '末弦' },
  { name: 'story-21', url: 'https://xiaodernan.github.io/caesura/story/string-listener/', marker: '听弦' },
  { name: 'story-22', url: 'https://xiaodernan.github.io/caesura/story/third-voice/', marker: '第三声' },
  { name: 'story-23', url: 'https://xiaodernan.github.io/caesura/story/ensemble/', marker: '合奏' },
  { name: 'story-24', url: 'https://xiaodernan.github.io/caesura/story/echo-vale/', marker: '回声谷' },
  { name: 'story-25', url: 'https://xiaodernan.github.io/caesura/story/after-half-a-chime/', marker: '半声之后' },
  { name: 'story-26', url: 'https://xiaodernan.github.io/caesura/story/beside-the-button/', marker: '铜扣旁' },
  { name: 'ai-json-commit', url: 'https://xiaodernan.github.io/caesura/admin/ai-director-latest.json', marker: '"authorOnly": true' },
  { name: 'ai-json-qa', url: 'https://xiaodernan.github.io/caesura/admin/ai-director-transitions-qa.json', marker: '"authorOnly": true' },
]

const asJson = argv.includes('--json')
const concIdx = argv.indexOf('--concurrency')
const concEq = argv.find((a) => a.startsWith('--concurrency='))
const concRaw = concEq ? Number(concEq.slice('--concurrency='.length)) : (concIdx >= 0 ? Number(argv[concIdx + 1]) : 4)
const concurrency = Math.max(1, Math.min(16, Number.isFinite(concRaw) ? concRaw : 4))

// 并发压测：同一批 29 个端点以 N 路并发发出（Promise pool），逐个验证 marker、
// 统计总时长与 p50/p95/p99。不新增权限、不改 marker、不跨网络滥用——仅本机连 Pages。
const results = new Array(ENDPOINTS.length)
let cursor = 0
const tGlobal = performance.now()
async function worker() {
  while (true) {
    const i = cursor++
    if (i >= ENDPOINTS.length) return
    const e = ENDPOINTS[i]
    const t0 = performance.now()
    try {
      const res = await fetch(e.url, { signal: AbortSignal.timeout(10000) })
      const text = await res.text()
      const ok = res.ok && text.includes(e.marker)
      results[i] = { name: e.name, ok, status: res.status, bytes: Buffer.byteLength(text), ms: Math.round(performance.now() - t0) }
    } catch (err) {
      results[i] = { name: e.name, ok: false, status: 0, bytes: 0, ms: Math.round(performance.now() - t0), error: String(err) }
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker))
const wallMs = Math.round(performance.now() - tGlobal)

const failed = results.filter((r) => !r.ok)
const sorted = [...results].map((r) => r.ms).sort((a, b) => a - b)
const pct = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]
const summary = { total: results.length, ok: results.length - failed.length, failed: failed.map((r) => r.name), concurrency, wallMs, p50: pct(50), p95: pct(95), p99: pct(99), results }

if (asJson) {
  console.log(JSON.stringify(summary))
} else {
  console.log('[smoke-live] public-site smoke check')
  for (const r of results) {
    const mark = r.ok ? 'pass' : 'FAIL'
    console.log(`  ${mark} ${r.name.padEnd(12)} HTTP ${String(r.status).padStart(3)} ${String(r.bytes).padStart(7)} B ${String(r.ms).padStart(5)} ms`)
  }
  console.log(`[smoke-live] ${summary.ok}/${summary.total} endpoints ok${failed.length ? ' — FAILED: ' + failed.map((r) => r.name).join(', ') : ''} · concurrency=${concurrency} wall=${wallMs}ms p50=${summary.p50}ms p95=${summary.p95}ms p99=${summary.p99}ms`)
}
exit(failed.length === 0 ? 0 : 1)
