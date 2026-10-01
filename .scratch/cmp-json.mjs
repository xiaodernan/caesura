// 语义对比：HEAD blob vs 工作副本（只看数据，不看缩进/行尾）
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const files = process.argv.slice(2)
for (const f of files) {
  const head = execFileSync('git', ['show', `HEAD:${f}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const work = readFileSync(f, 'utf8')
  let a, b
  try { a = JSON.parse(head) } catch (e) { console.log(`${f}: HEAD 解析失败 ${e.message}`); continue }
  try { b = JSON.parse(work) } catch (e) { console.log(`${f}: 工作副本解析失败 ${e.message}`); continue }
  const sa = JSON.stringify(a, null, 1)
  const sb = JSON.stringify(b, null, 1)
  if (sa === sb) { console.log(`${f}: 语义相同（仅缩进/行尾差异）`) ; continue }
  console.log(`${f}: 语义不同`)
  // 逐行 diff 摘要
  const la = sa.split('\n'), lb = sb.split('\n')
  const setA = new Set(la), setB = new Set(lb)
  const onlyHead = la.filter((l) => !setB.has(l))
  const onlyWork = lb.filter((l) => !setA.has(l))
  console.log(`  仅 HEAD 有 ${onlyHead.length} 行 / 仅工作副本有 ${onlyWork.length} 行`)
  console.log('  --- 仅工作副本（前 40 行）---')
  for (const l of onlyWork.slice(0, 40)) console.log('  +' + l)
  console.log('  --- 仅 HEAD（前 40 行）---')
  for (const l of onlyHead.slice(0, 40)) console.log('  -' + l)
}
