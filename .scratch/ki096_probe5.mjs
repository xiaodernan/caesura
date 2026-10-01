// KI-096 探针 5：只认 `需求 §N` 单点形状的窄语法（为了把"13 → 7"这句写成实测而不是记忆）
import fs from 'node:fs'
import path from 'node:path'
const ROOT = process.cwd()
const C = '新建 文本文档.txt'
const raw = fs.readFileSync(C, 'utf8').replace(/\r\n/g, '\n')
const roster = [...new Set([...raw.matchAll(/^#{1,4}\s+(\d+)\.\s+[^\n]*$/gm)].map((m) => +m[1]))]
const DIRS = ['docs', 'src', 'tests', 'scripts', 'tools']
const SKIP = new Set(['node_modules', 'dist', '.git', '.scratch', 'coverage'])
const files = []
for (const d of DIRS) {
  if (!fs.existsSync(path.join(ROOT, d))) continue
  ;(function w(x) {
    for (const e of fs.readdirSync(x, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) w(path.join(x, e.name))
      } else if (/\.(ts|md|mjs|json)$/.test(e.name)) {
        const r = path.relative(ROOT, path.join(x, e.name)).replace(/\\/g, '/')
        if (r !== C) files.push(r)
      }
    }
  })(path.join(ROOT, d))
}
for (const e of fs.readdirSync(ROOT)) if (/\.md$/.test(e)) files.push(e)
const NARROW = /需求\s*§\s*(\d+)/g
const cited = new Set()
let sites = 0
for (const f of files) {
  const t = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')
  for (const m of t.matchAll(NARROW)) {
    sites++
    cited.add(+m[1])
  }
}
const unc = roster.filter((n) => !cited.has(n))
console.log(`窄语法：文件 ${files.length} · 站点 ${sites} · 点名 ${cited.size} · 未点名 ${unc.length}`)
console.log(`未点名 = ${unc.join(', ')}`)
