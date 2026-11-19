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
  { name: 'story-27', url: 'https://xiaodernan.github.io/caesura/story/beyond-the-line/', marker: '线外' },
  { name: 'story-28', url: 'https://xiaodernan.github.io/caesura/story/after-the-bag/', marker: '纸袋之后' },
  { name: 'story-29', url: 'https://xiaodernan.github.io/caesura/story/salt-on-the-sill/', marker: '窗台盐线' },
  { name: 'story-30', url: 'https://xiaodernan.github.io/caesura/story/after-the-salt-line/', marker: '盐线之后' },
  { name: 'story-31', url: 'https://xiaodernan.github.io/caesura/story/the-sill-keeps-count/', marker: '窗台记数' },
  { name: 'story-32', url: 'https://xiaodernan.github.io/caesura/story/after-the-space/', marker: '空处之后' },
  { name: 'story-33', url: 'https://xiaodernan.github.io/caesura/story/the-unmarked-number/', marker: '未刻之数' },
  { name: 'story-34', url: 'https://xiaodernan.github.io/caesura/story/beside-the-scale/', marker: '秤旁' },
  { name: 'story-35', url: 'https://xiaodernan.github.io/caesura/story/the-unentered-page/', marker: '未记的一页' },
  { name: 'story-36', url: 'https://xiaodernan.github.io/caesura/story/the-dry-place/', marker: '干处' },
  { name: 'story-37', url: 'https://xiaodernan.github.io/caesura/story/unweighed/', marker: '未称之物' },
  { name: 'story-38', url: 'https://xiaodernan.github.io/caesura/story/the-empty-scale/', marker: '空秤' },
  { name: 'story-39', url: 'https://xiaodernan.github.io/caesura/story/beyond-the-scale/', marker: '秤盘之外' },
  { name: 'story-40', url: 'https://xiaodernan.github.io/caesura/story/the-scale-shadow/', marker: '秤影' },
  { name: 'story-41', url: 'https://xiaodernan.github.io/caesura/story/beyond-the-threshold/', marker: '门槛之外' },
  { name: 'story-42', url: 'https://xiaodernan.github.io/caesura/story/the-mark-outside/', marker: '门外的湿痕' },
  { name: 'story-43', url: 'https://xiaodernan.github.io/caesura/story/salt-at-the-threshold/', marker: '门槛上的盐' },
  { name: 'story-44', url: 'https://xiaodernan.github.io/caesura/story/the-unopened-page/', marker: '未开之页' },
  { name: 'story-45', url: 'https://xiaodernan.github.io/caesura/story/the-unsent-letter/', marker: '未寄出的信' },
  { name: 'story-46', url: 'https://xiaodernan.github.io/caesura/story/after-the-empty-scale/', marker: '空秤之后' },
  { name: 'story-47', url: 'https://xiaodernan.github.io/caesura/story/the-unmade-swing/', marker: '未摆的一次' },
  { name: 'story-48', url: 'https://xiaodernan.github.io/caesura/story/the-dry-mark-beneath/', marker: '船底的干痕' },
  { name: 'story-49', url: 'https://xiaodernan.github.io/caesura/story/the-unasked-boat/', marker: '未问之船' },
  { name: 'story-50', url: 'https://xiaodernan.github.io/caesura/story/the-place-aboard/', marker: '船上的空处' },
  { name: 'story-51', url: 'https://xiaodernan.github.io/caesura/story/salt-not-aboard/', marker: '盐未上船' },
  { name: 'story-52', url: 'https://xiaodernan.github.io/caesura/story/the-boat-still/', marker: '船未启' },
  { name: 'story-53', url: 'https://xiaodernan.github.io/caesura/story/beside-the-jar/', marker: '壶边' },
  { name: 'story-54', url: 'https://xiaodernan.github.io/caesura/story/the-ring/', marker: '圈印' },
  { name: 'story-55', url: 'https://xiaodernan.github.io/caesura/story/the-mark-beneath-the-jar/', marker: '壶底旧痕' },
  { name: 'story-56', url: 'https://xiaodernan.github.io/caesura/story/the-unmoved-pendulum/', marker: '未动的摆' },
  { name: 'story-57', url: 'https://xiaodernan.github.io/caesura/story/no-handover/', marker: '未交接' },
  { name: 'story-58', url: 'https://xiaodernan.github.io/caesura/story/beside-the-pendulum/', marker: '摆旁空位' },
  { name: 'story-59', url: 'https://xiaodernan.github.io/caesura/story/salt-beside-the-seat/', marker: '摆下的盐' },
  { name: 'story-60', url: 'https://xiaodernan.github.io/caesura/story/the-mark-remains/', marker: '干痕仍在' },
  { name: 'story-61', url: 'https://xiaodernan.github.io/caesura/story/at-ebb-one-stick/', marker: '潮退添柴' },
  { name: 'story-62', url: 'https://xiaodernan.github.io/caesura/story/the-swing-unreturned/', marker: '摆不回' },
  { name: 'story-63', url: 'https://xiaodernan.github.io/caesura/story/the-ash-beside-the-pendulum/', marker: '摆旁的灰' },
  { name: 'story-64', url: 'https://xiaodernan.github.io/caesura/story/ash-not-fallen/', marker: '灰未落' },
  { name: 'story-65', url: 'https://xiaodernan.github.io/caesura/story/the-mark-not-entered/', marker: '干痕未进' },
  { name: 'story-66', url: 'https://xiaodernan.github.io/caesura/story/the-ash-unhurried/', marker: '灰不催' },
  { name: 'story-67', url: 'https://xiaodernan.github.io/caesura/story/the-fire-knows/', marker: '火自己知道' },
  { name: 'story-68', url: 'https://xiaodernan.github.io/caesura/story/the-ash-unreturned/', marker: '灰不归' },
  { name: 'story-69', url: 'https://xiaodernan.github.io/caesura/story/the-fading-mark/', marker: '淡痕' },
  { name: 'story-70', url: 'https://xiaodernan.github.io/caesura/story/the-unentered-stroke/', marker: '未添的一笔' },
  { name: 'story-71', url: 'https://xiaodernan.github.io/caesura/story/the-corner-turns/', marker: '页角自翻' },
  { name: 'story-72', url: 'https://xiaodernan.github.io/caesura/story/one-more-dusk/', marker: '又多一个傍晚' },
  { name: 'story-73', url: 'https://xiaodernan.github.io/caesura/story/the-ledger-shut/', marker: '薄簿合着' },
  { name: 'story-74', url: 'https://xiaodernan.github.io/caesura/story/the-unanswered-question/', marker: '未答之问' },
  { name: 'story-75', url: 'https://xiaodernan.github.io/caesura/story/one-line-in-the-night/', marker: '夜开的一线' },
  { name: 'story-76', url: 'https://xiaodernan.github.io/caesura/story/she-too-a-seam/', marker: '她也一线' },
  { name: 'story-77', url: 'https://xiaodernan.github.io/caesura/story/a-page-beside-the-pendulum/', marker: '摆旁一页' },
  { name: 'story-78', url: 'https://xiaodernan.github.io/caesura/story/the-unferried-page/', marker: '未渡的一页' },
  { name: 'story-79', url: 'https://xiaodernan.github.io/caesura/story/the-salt-is-there/', marker: '盐还在' },
  { name: 'story-80', url: 'https://xiaodernan.github.io/caesura/story/the-boats-measure/', marker: '空船的刻度' },
  { name: 'story-81', url: 'https://xiaodernan.github.io/caesura/story/two-lines/', marker: '两条线' },
  { name: 'story-82', url: 'https://xiaodernan.github.io/caesura/story/a-page-by-the-boat/', marker: '船边的一页' },
  { name: 'story-83', url: 'https://xiaodernan.github.io/caesura/story/the-unsent-page/', marker: '未寄的一页' },
  { name: 'ai-json-commit', url: 'https://xiaodernan.github.io/caesura/admin/ai-director-latest.json', marker: '"authorOnly": true' },
  { name: 'ai-json-qa', url: 'https://xiaodernan.github.io/caesura/admin/ai-director-transitions-qa.json', marker: '"authorOnly": true' },
  { name: 'ai-json-cache', url: 'https://xiaodernan.github.io/caesura/admin/ai-cache-metrics.json', marker: '"entries"' },
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
