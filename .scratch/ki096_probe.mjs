// 只读探针：把"需求 §…"这条语法在真种群上的形状量出来（决定门禁的解析器怎么写）
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const req = readFileSync('新建 文本文档.txt', 'utf8')
const sections = new Map()
for (const m of req.matchAll(/^#{1,4}\s+(\d+)\.\s+([^\n]*)$/gm)) sections.set(Number(m[1]), m[2].trim())

const files = []
const walk = (d) => {
  if (!existsSync(d)) return
  for (const e of readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue
    const p = join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.(md|mts|ts)$/.test(e.name)) files.push(p)
  }
}
for (const d of ['docs', 'src', 'tests', 'scripts']) walk(d)

const shapes = new Map()
let refs = 0
const unresolved = new Map()
const decimals = []
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split(/\r?\n/)
  lines.forEach((line, i) => {
    let m
    const re = /需求\s*((?:§\s*\d+(?:\.\d+)?\s*[\/、,，\-–~]?\s*)+)/g
    while ((m = re.exec(line))) {
      refs++
      const nums = [...m[1].matchAll(/§\s*(\d+)(\.\d+)?/g)]
      shapes.set(m[1].replace(/\s+/g, ' ').trim(), (shapes.get(m[1].replace(/\s+/g, ' ').trim()) ?? 0) + 1)
      for (const [, n, dec] of nums) {
        if (dec) decimals.push(`${f}:${i + 1} §${n}${dec}`)
        if (!sections.has(Number(n))) {
          const k = Number(n)
          if (!unresolved.has(k)) unresolved.set(k, [])
          unresolved.get(k).push(`${f}:${i + 1}`)
        }
      }
    }
    // 另一支：需求 §15.2 里那种"编号后带书名/空格再跟中文"的写法已被上面吃掉；这里抓漏网的"需求§"（无空格）
  })
}
console.log('扫描文件数', files.length, '  语法命中的引用串数', refs)
console.log('不同写法样本(前 20):')
for (const [k, v] of [...shapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(' ', v, JSON.stringify(k))
console.log('小数子编号命中:', decimals.length, decimals.slice(0, 10).join(' | '))
console.log('未落地编号:', unresolved.size ? [...unresolved.entries()].map(([k, v]) => `§${k}@${v.join(',')}`).join(' | ') : 'NONE')
// 反向：整行里出现 需求 但没被这条语法吃掉的，看看还有什么形状
const other = []
for (const f of files) {
  readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
    if (/需求/.test(line) && !/需求\s*§/.test(line)) other.push(`${f}:${i + 1}: ${line.trim().slice(0, 70)}`)
  })
}
console.log('提到"需求"但不是 § 形状的行数:', other.length)
for (const o of other.slice(0, 14)) console.log('  ', o)
