import { readFileSync, writeFileSync } from 'node:fs'

const p = 'docs/KNOWN_ISSUES.md'
const lines = readFileSync(p, 'utf8').split(/\r?\n/)

const takeRow = (id, label) => {
  const needle = `| ${id} |`
  const i = lines.findIndex((l) => l.startsWith(needle) && (label === undefined || l.includes(label)))
  if (i < 0) throw new Error(`找不到 ${needle}`)
  return lines.splice(i, 1)[0]
}

// 账本里此刻有四行是"本批尚未定稿"的：KI-129（已提交/已定稿，保留原位）、KI-130/131/132（要按号序重排）
const r130 = takeRow('KI-130', 'rain')
const r131 = takeRow('KI-131', 'bake-navmesh')
const r132 = readFileSync('.scratch/ki132_row.md', 'utf8').split(/\r?\n/).filter((l) => l.startsWith('| KI-132 |'))[0]

// 插到 KI-129 那一行之后，顺序 130 → 131 → 132
const i129 = lines.findIndex((l) => l.startsWith('| KI-129 |'))
if (i129 < 0) throw new Error('找不到 KI-129')
lines.splice(i129 + 1, 0, r130, r131, r132)

writeFileSync(p, lines.join('\n'))
const t = readFileSync(p, 'utf8')
for (const id of ['KI-128', 'KI-129', 'KI-130', 'KI-131', 'KI-132']) {
  const i = t.indexOf(`| ${id} |`)
  console.log(id, i >= 0 ? `行 ${t.slice(0, i).split('\n').length}` : '缺失')
}
