import { readFileSync } from 'node:fs'
const j = JSON.parse(readFileSync('.scratch/ki094_plane/.scratch_ctrl.json', 'utf8'))
const names = j.testResults.flatMap((f) => (f.assertionResults || []).map((a) => f.name.split('/').pop() + ' :: ' + a.fullName))
const keys = [
  '都在 quests.json 里真的被某个步骤等着', '不改天气：「敲响」不是「修复」', '逐区逐字相同',
  '其他区纹丝不动', '自己的天不变', '拨到第二格（旗数就是格数', '赋值点只剩 ColorGrade 一处',
  '也没挂账 ⇒ ERROR 指名那一区', '换成 WARN（欠账可以挂', 'WARN 的位点', 'regions 读空同理',
  '按**旗**而不是按钟数', '结果要等于运行时的名册',
]
for (const k of keys) {
  const hit = names.filter((n) => n.includes(k))
  console.log((hit.length ? 'ok  ' : 'MISS') + hit.length + '  ' + k)
}
console.log('--- total cases', names.length)
