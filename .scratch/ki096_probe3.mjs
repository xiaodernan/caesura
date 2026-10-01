// KI-096 探针 3：用即将上线的语法做一次全量普查（只读，不改任何被跟踪文件）
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const CARRIER = '新建 文本文档.txt'

// 1) 名册：载体的 `# NN. 标题`
const raw = fs.readFileSync(path.join(ROOT, CARRIER), 'utf8').replace(/\r\n/g, '\n')
const roster = [...new Set([...raw.matchAll(/^#{1,4}\s+(\d+)\.\s+[^\n]*$/gm)].map((m) => +m[1]))].sort((a, b) => a - b)

// 2) 待扫文件：显式目录清单 + 根目录 .md（`.workbuddy-ai` 那种旁路目录不在总体里）
const DIRS = ['docs', 'src', 'tests', 'scripts', 'tools']
const SKIP = new Set(['node_modules', 'dist', '.git', '.scratch', 'coverage'])
const files = []
;(function () {
  for (const d of DIRS) {
    if (!fs.existsSync(path.join(ROOT, d))) continue
    ;(function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (!SKIP.has(e.name)) walk(path.join(dir, e.name))
        } else if (/\.(ts|md|mjs|json)$/.test(e.name)) {
          const rel = path.relative(ROOT, path.join(dir, e.name)).replace(/\\/g, '/')
          if (rel !== CARRIER) files.push(rel)
        }
      }
    })(path.join(ROOT, d))
  }
  for (const e of fs.readdirSync(ROOT)) if (/\.md$/.test(e)) files.push(e)
})()

// 3) 引用语法：`需求` 后面紧跟的一串编号（§ 可选，链接可为 / 、 , - – ~ 与空格）
const CIT =
  /需求\s*((?:§\s*)?\d+(?:\.\d+)?(?:\s*[、,/~]\s*(?:§\s*)?\d+(?:\.\d+)?|\s*[-–—]\s*(?:§\s*)?\d+(?:\.\d+)?)*)/g
const sites = []
for (const f of files) {
  const txt = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')
  txt.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(CIT)) {
      const nums = [...m[1].matchAll(/(\d+)(?:\.(\d+))?/g)].map((n) => ({
        v: +n[1],
        sub: n[2] !== undefined ? +n[2] : null,
        raw: n[0],
      }))
      sites.push({ file: f, line: i + 1, expr: m[1].trim(), tail: m[2], nums })
    }
  })
}

// 4) 覆盖集合：链里每一对相邻数若由 – ~ 连接则展开区间
const cited = new Set()
const bad = []
for (const s of sites) {
  for (const n of s.nums) {
    if (n.sub !== null || !roster.includes(n.v)) bad.push(s)
    cited.add(n.v)
  }
  const dashes = [...s.expr.matchAll(/\d+\s*[-–~]\s*\d+/g)]
  for (const d of dashes) {
    const [a, b] = d[0].split(/[-–~]/).map((x) => +x.trim())
    for (let k = Math.min(a, b); k <= Math.max(a, b); k++) cited.add(k)
  }
}

const uncited = roster.filter((n) => !cited.has(n))
console.log(`载体小节数 ${roster.length}（去重后）`)
console.log(`扫过的文件数 ${files.length}`)
console.log(`引用站点数 ${sites.length}`)
console.log(`被点名的小节数 ${cited.size}`)
console.log(`从未被点名的小节数 ${uncited.length}`)
console.log(`  = ${uncited.map((n) => '§' + n).join(' ')}`)
console.log(`\n形状有问题的站点（带小数 / 越界）：${bad.length}`)
for (const s of bad) console.log(`  ${s.file}:${s.line}  「需求 ${s.expr}」  数值 ${JSON.stringify(s.nums)}`)

// 5) 只写「需求」不跟数字的行（语法盲区，逐行给人看）
console.log('\n--- 含"需求"但后面不跟数字的行（本语法看不见）---')
let noNum = 0
for (const f of files) {
  const txt = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')
  txt.split('\n').forEach((line, i) => {
    if (line.includes('需求') && !/需求\s*§?\s*\d/.test(line)) {
      noNum++
      if (noNum <= 25) console.log(`  ${f}:${i + 1} ${line.trim().slice(0, 110)}`)
    }
  })
}
console.log(`  合计 ${noNum}`)
