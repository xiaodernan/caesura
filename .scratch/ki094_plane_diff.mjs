import { readdirSync, statSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const walk = (root, dir = '') => {
  const out = []
  for (const e of readdirSync(`${root}/${dir}` || root, { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name
    if (e.name === '.scratch_mut.json' || e.name === '.scratch_ctrl.json') continue
    if (statSync(`${root}/${rel}`).isDirectory()) out.push(...walk(root, rel))
    else out.push(rel)
  }
  return out
}
const A = '.scratch/ki094_pure', B = '.scratch/ki094_plane'
const h = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
const setB = new Set(walk(B))
const diff = walk(A).filter((r) => setB.has(r) && h(`${A}/${r}`) !== h(`${B}/${r}`))
console.log('平面里与我改过的文件（相对 HEAD）：', diff.length)
for (const d of diff) console.log('  ' + d)
console.log('只在平面里（我新增的文件）：', walk(B).filter((r) => !walk(A).includes(r)).join(' | ') || '（无）')
