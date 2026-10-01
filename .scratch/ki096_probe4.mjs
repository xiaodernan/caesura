// KI-096 探针 4：两种分隔符语法的差集（裸空格到底会不会把散文里的数字记成引用）
import fs from 'node:fs'
import path from 'node:path'
const ROOT = process.cwd()
const CARRIER = '新建 文本文档.txt'
const raw = fs.readFileSync(CARRIER, 'utf8').replace(/\r\n/g, '\n')
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
        if (r !== CARRIER) files.push(r)
      }
    }
  })(path.join(ROOT, d))
}
for (const e of fs.readdirSync(ROOT)) if (/\.md$/.test(e)) files.push(e)

const TIGHT = /需求\s*((?:§\s*)?\d+(?:\.\d+)?(?:\s*[、,/~]\s*(?:§\s*)?\d+(?:\.\d+)?|\s*[-–—]\s*(?:§\s*)?\d+(?:\.\d+)?)*)/g
const LOOSE = /需求\s*((?:§\s*)?\d+(?:\.\d+)?(?:\s*[、,/~\s]\s*(?:§\s*)?\d+(?:\.\d+)?|\s*[-–—]\s*(?:§\s*)?\d+(?:\.\d+)?)*)/g

function run(re) {
  const cited = new Set()
  const hits = []
  for (const f of files) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')
    t.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(re)) {
        const expr = m[1].replace(/\s+/g, ' ')
        hits.push(`${f}:${i + 1}  「需求 ${expr}」`)
        for (const n of expr.matchAll(/(\d+)(?:\.(\d+))?/g)) cited.add(+n[1])
        for (const r of expr.matchAll(/(\d+)\s*[-–—]\s*(\d+)/g)) {
          const a = +r[1]
          const b = +r[2]
          for (let k = Math.min(a, b); k <= Math.max(a, b); k++) cited.add(k)
        }
      }
    })
  }
  return { cited, hits }
}
const A = run(TIGHT)
const B = run(LOOSE)
console.log(`TIGHT 站点 ${A.hits.length}   LOOSE 站点 ${B.hits.length}`)
console.log(`TIGHT 未点名 ${roster.filter((n) => !A.cited.has(n)).join(',')}`)
console.log(`LOOSE 未点名 ${roster.filter((n) => !B.cited.has(n)).join(',')}`)
const sa = new Set(A.hits)
const sb = new Set(B.hits)
console.log('\nLOOSE 独有（裸空格多抓进来的）：')
B.hits.filter((h) => !sa.has(h)).slice(0, 15).forEach((h) => console.log('  +' + h))
console.log('\nTIGHT 独有（收紧后丢掉的）：')
A.hits.filter((h) => !sb.has(h)).slice(0, 15).forEach((h) => console.log('  -' + h))
