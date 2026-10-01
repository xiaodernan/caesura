// 从工作副本的 4 个 hunk 里只留我的两个（hunk 1 = weather-rules 的 import，hunk 4 = validateWeather 尾巴）。
// 并行会话那两个武器 hunk（WEAPON_FIELDS / validateWeapons）留在工作副本，不进索引。
import { readFileSync, writeFileSync } from 'node:fs'
const d = readFileSync('.scratch/ki094_validator_full.diff', 'utf8').replace(/\r\n/g, '\n')
const lines = d.split('\n')
const head = []
const hunks = []
let cur = null
for (const l of lines) {
  if (l.startsWith('@@')) { cur = [l]; hunks.push(cur); continue }
  if (cur) cur.push(l); else head.push(l)
}
// 去掉每个 hunk 尾部因切分多出来的空行
for (const h of hunks) while (h.length > 1 && h[h.length - 1] === '') h.pop()
console.error(`hunks=${hunks.length}`)
hunks.forEach((h, i) => console.error(`  [${i}] ${h[0]}  | weather mentioned: ${/weather/i.test(h.join('\n'))}`))
const KEEP = [0, 3]
const mine = hunks.filter((_, i) => KEEP.includes(i))
if (mine.length !== 2) throw new Error(`KEEP 选出的不是 2 个 hunk：${mine.length}`)
for (const h of mine) if (!/weather/i.test(h.join('\n'))) throw new Error(`留下的 hunk 里没有 weather 字样，选错了：${h[0]}`)
const others = hunks.filter((_, i) => !KEEP.includes(i))
for (const h of others) if (/weather/i.test(h.join('\n'))) throw new Error(`被排除的 hunk 里含 weather ⇒ 分组判据不干净：${h[0]}`)
writeFileSync('.scratch/ki094_validator_mine.diff', [...head, ...mine.flat()].join('\n') + '\n')
console.error(`WROTE .scratch/ki094_validator_mine.diff (${mine.flat().length} lines)`)
