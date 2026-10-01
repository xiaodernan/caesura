// 只读探针：把 6+1 处"小数/越界"的需求引用对回需求原文，量出它们真正该指哪一节
import { readFileSync } from 'node:fs'

const raw = readFileSync('新建 文本文档.txt', 'utf8')
const lines = raw.split(/\r?\n/)
// 按编号小节切段（含 `# 19. Status System` 这种 H1 写法）
const marks = []
lines.forEach((l, i) => {
  const m = l.match(/^#{1,4}\s*(\d+)\.\s+(.*)$/)
  if (m) marks.push({ n: Number(m[1]), title: m[2].trim(), from: i })
})
const sections = marks.map((s, i) => ({
  n: s.n,
  title: s.title,
  body: lines.slice(s.from, i + 1 < marks.length ? marks[i + 1].from : lines.length).join('\n'),
}))

const probes = [
  ['docs/KNOWN_ISSUES.md:55', '目录已定不得更改'],
  ['docs/technical-architecture.md:582', '叠唱'],
  ['src/core/Input.ts:40', '摇杆'],
  ['src/core/Input.ts:40', '肩键'],
  ['tests/flow/occlusion.test.ts:18', '躲入断音柱'],
  ['tests/flow/occlusion.test.ts:18', '弹体不该穿过掩体'],
  ['tests/flow/occlusion.test.ts:18', '视锥'],
  ['tests/unit/rpg.test.ts:27', '2 级 60'],
]
for (const [site, phrase] of probes) {
  const hits = sections.filter((s) => s.body.includes(phrase))
  console.log(`${site}  短语「${phrase}」 → 需求里出现的节: ` + (hits.length ? hits.map((h) => `§${h.n} ${h.title}`).join(' ; ') : 'NOT FOUND'))
}
console.log('\n--- 需求 §2 §5 §7 §14 §15 §65 的标题 ---')
for (const n of [2, 5, 7, 14, 15, 65, 64]) {
  const s = sections.find((x) => x.n === n)
  console.log(`§${n} = ${s ? s.title : '(不存在)'}`)
}
console.log('\n--- 需求文档第 577 行、第 5.2/2.3 想问的行 ---')
for (const ln of [577, 578]) console.log(ln + ': ' + (lines[ln - 1] ?? '').trim())
console.log('\n--- 需求里含"等级/经验"数字表的小节 ---')
for (const s of sections) if (/60/.test(s.body) && /75/.test(s.body) && /经验|等级|rank|Level/i.test(s.body)) console.log(`§${s.n} ${s.title}`)
