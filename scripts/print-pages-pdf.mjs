/**
 * scripts/print-pages-pdf.mjs — 把离线教材/全集印成真正的 A4 PDF（2026-11-15 落）
 *
 * 用途：在 CI 工作流 `snapshot-pdf` 里跑，`.github/workflows/snapshot-pdf.yml` 吃。
 *    1. `story/anthology/index.html` → dist-pdf/caesura-anthology-the-aftermath.pdf
 *    2. `tutorial/index.html` → dist-pdf/caesura-player-primer.pdf
 *
 * 设计取舍：
 *   - 不经过 vite 构建，直接以 `file://` 打开仓库里的静态 index.html（两件都零外链）。
 *   - Playwright Chromium 原生 `page.pdf()` — 吃 `@media print` 规则（KI-576 落地的纸面整卷 CSS）。
 *   - 不入 package.json 依赖树（CI 安装时不污染 runtime deps；`npm ci` 之后 `npm i --no-save playwright`）。
 *   - 输出目录 `dist-pdf/`（.gitignored）。
 */
import { chromium } from 'playwright'
import { mkdirSync, statSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'dist-pdf')
mkdirSync(OUT, { recursive: true })

const targets = [
  { name: 'caesura-anthology-the-aftermath', src: 'story/anthology/index.html', title: 'The Aftermath · CAESURA 短篇全集' },
  { name: 'caesura-player-primer', src: 'tutorial/index.html', title: 'CAESURA · Player Primer' },
]

const browser = await chromium.launch()
let ok = 0
for (const t of targets) {
  const page = await browser.newPage()
  const src = resolve(ROOT, t.src)
  await page.goto('file://' + src, { waitUntil: 'load' })
  const out = resolve(OUT, t.name + '.pdf')
  await page.pdf({
    path: out,
    format: 'A4',
    preferCSSPageSize: true,
    printBackground: true,
    margin: { top: '17mm', bottom: '17mm', left: '16mm', right: '16mm' },
  })
  const bytes = statSync(out).size
  if (bytes < 4096) throw new Error(`PDF looks too small (${bytes} B): ${out}`)
  const bin = readFileSync(out)
  const pageCount = (bin.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
  if (pageCount < 1) throw new Error(`no /Type /Page found — broken PDF: ${out}`)
  console.log(`[print-pdf] ${t.name}.pdf ${bytes} B, ~${pageCount} pages`)
  ok++
  await page.close()
}
await browser.close()
console.log(`[print-pdf] done — ${ok}/${targets.length} PDFs in ${OUT}`)
process.exit(0)
