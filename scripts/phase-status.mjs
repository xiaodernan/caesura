/**
 * scripts/phase-status.mjs —— 仓库 rollup：三张账本/计划/架的可复数取数。
 * 输出 KEY=N 行（一行一个量），供 docs/PHASE-STATUS.md 与测试现取，不手抄。
 * 取数方式一律现读文件，绝不走缓存；取数失败即 exit 2（不出半套数字）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

const STATUS_OK = new Set(['Implemented', 'Partial', 'Placeholder', 'Blocked'])

const countStatus = (rows, getStatus) => {
  const out = { Implemented: 0, Partial: 0, Placeholder: 0, Blocked: 0 }
  for (const row of rows) {
    const s = getStatus(row)
    if (!STATUS_OK.has(s)) return { error: `非法状态标签：${s}（行：${row.slice(0, 80)}）` }
    out[s]++
  }
  return out
}

// ── 1) docs/KNOWN_ISSUES.md：正册 KI 行、§1.5 系统表、§2 TD、§3 PF ──────────
const ledger = read('docs/KNOWN_ISSUES.md')
const lines = ledger.split(/\r?\n/)
const mark = (h) => {
  const m = lines.findIndex((l) => l.startsWith(h + ' '))
  return m === -1 ? -1 : m
}
const after = (from, before) => {
  const end = before === null ? lines.length : mark(before)
  return end === -1 ? null : lines.slice(from + 1, end)
}
const seg = (h, before) => (mark(h) === -1 ? null : after(mark(h), before))

const tableRows = (body) =>
  body
    .filter((l) => /^\|\s/.test(l) && !/^\|\s*-+/.test(l))
    .filter((l) => !/^\|\s*\|/.test(l)) // 空行
    .filter((l) => !/"^| KI 序号|系统\s*\|\s*状态/.test(l))
    .filter((l) => !/---/.test(l))

// §1.5 系统表
const sysBody = seg('## 1.5', '## 2.')
if (!sysBody) throw Object.assign(new Error('找不到 §1.5 节'), { exitCode: 2 })
const sysRows = tableRows(sysBody).filter((l) => /\|\s*(Implemented|Partial|Placeholder|Blocked)\s*\|/.test(l))
const sysCount = countStatus(sysRows, (l) => l.split('|')[2].trim())
if ('error' in sysCount) { console.error(sysCount.error); process.exit(2) }

// §2 TD（列：id | 描述 | 欠账 | 状态 | …）
const tdBody = seg('## 2.', '## 3.')
const tdRows = tableRows(tdBody ?? []).filter((l) => /\|\s*TD-\d+/.test(l))
const tdCount = countStatus(tdRows, (l) => l.split('|')[4]?.trim() ?? '')
if ('error' in tdCount) { console.error(tdCount.error); process.exit(2) }

// §3 PF（列同 §2）
const pfBody = seg('## 3.', '## 4.')
const pfRows = tableRows(pfBody ?? []).filter((l) => /\|\s*PF-\d+/.test(l))
const pfCount = countStatus(pfRows, (l) => l.split('|')[4]?.trim() ?? '')
if ('error' in pfCount) { console.error(pfCount.error); process.exit(2) }

// 正册 KI 行（末个非空格即状态）
const cellsOf = (l) => l.split('|').map((s) => s.trim()).filter((s) => s.length > 0 && s !== '---')
const kiRows = lines.filter((l) => /^\|\s*KI-\d+\s*\|/.test(l))
const ki = countStatus(kiRows, (l) => {
  const cells = cellsOf(l)
  return cells[cells.length - 1] ?? ''
})
if ('error' in ki) { console.error(ki.error); process.exit(2) }

// ── 2) docs/technical-architecture.md：§5.9 节号名册 ─────────────────────────
const arch = read('docs/technical-architecture.md')
const heads = [...arch.matchAll(/^### 5\.9\.(\d+) /gm)].map((m) => Number(m[1]))
const uniq = [...new Set(heads)].sort((a, b) => a - b)
const dups = heads.length - uniq.length
const max = uniq.length ? uniq[uniq.length - 1] : 0
const holes = []
for (let n = 1; n <= max; n++) if (!uniq.includes(n)) holes.push(n)

// ── 3) package.json / scripts ─────────────────────────────────────────────
const pkg = JSON.parse(read('package.json'))
const depV = pkg.dependencies ?? {}
const devV = pkg.devDependencies ?? {}

const OUT = {
  'KI.rows': kiRows.length,
  'KI.Implemented': ki.Implemented,
  'KI.Partial': ki.Partial,
  'KI.Placeholder': ki.Placeholder,
  'KI.Blocked': ki.Blocked,
  'SYS.rows': sysRows.length,
  'SYS.Implemented': sysCount.Implemented,
  'SYS.Partial': sysCount.Partial,
  'SYS.Placeholder': sysCount.Placeholder,
  'SYS.Blocked': sysCount.Blocked,
  'TD.rows': tdRows.length,
  'TD.Implemented': tdCount.Implemented,
  'TD.Partial': tdCount.Partial,
  'TD.Placeholder': tdCount.Placeholder,
  'TD.Blocked': tdCount.Blocked,
  'PF.rows': pfRows.length,
  'PF.Implemented': pfCount.Implemented,
  'PF.Partial': pfCount.Partial,
  'PF.Placeholder': pfCount.Placeholder,
  'PF.Blocked': pfCount.Blocked,
  'ARCH.sections': uniq.length,
  'ARCH.maxSection': max,
  'ARCH.duplicates': dups,
  'ARCH.holes': holes.length ? holes.join(',') : 'none',
  'PKG.scripts': Object.keys(pkg.scripts ?? {}).length,
  'PKG.deps': Object.keys(depV).length,
  'PKG.devDeps': Object.keys(devV).length,
}
let fail = false
if (dups > 0) { console.error(`[phase-status] 架构节号重号：${dups} 处`); fail = true }
if (holes.length) { console.error(`[phase-status] 架构节号空洞：${holes.join(',')}`); fail = true }
for (const [k, v] of Object.entries(OUT)) console.log(`${k}=${v}`)
if (fail) process.exit(2)
