// TD-003 判据臂：在归档平面上逐臂改 docs/KNOWN_ISSUES.md，跑 doc-audit 单文件，跑完还原。
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const PLANE = 'D:/法环游戏/.scratch/td003_plane'
const KEEP = 'D:/法环游戏/.scratch/td003_pristine'
const DOC = 'docs/KNOWN_ISSUES.md'
const docPath = `${PLANE}/${DOC}`

const arms = [
  { name: 'A1_table_ghost', from: '| TD-002 | 虚拟按钮', to: '| TD-003 | （臂）已销案却回魂的一行 | 臂 |\n| TD-002 | 虚拟按钮' },
  { name: 'A2a_unstrike', from: '> ~~TD-003~~（~~**需求 §62', to: '> TD-003（~~**需求 §62' },
  { name: 'A2b_wrong_id', from: '> ~~TD-003~~（~~**需求 §62', to: '> ~~TD-009~~（~~**需求 §62' },
  { name: 'A3_note_block_gone', from: '> **销案的债留号不留行**：', to: '> **销案的债**：' },
  { name: 'A4_drop_open_debt', from: '| TD-002 | 虚拟按钮', to: '| ~~TD-002~~ 臂：整行从表里消失' },
]

if (!existsSync(KEEP)) mkdirSync(KEEP, { recursive: true })
mkdirSync(`${KEEP}/docs`, { recursive: true })
copyFileSync(docPath, `${KEEP}/${DOC}`)
const pristine = readFileSync(docPath, 'utf8')

function restore() {
  const now = readFileSync(docPath, 'utf8')
  if (now !== pristine) {
    writeFileSync(docPath, pristine, 'utf8')
    if (readFileSync(docPath, 'utf8') !== pristine) throw new Error('RESTORE FAILED: ' + DOC)
  }
}

function run(label) {
  const r = spawnSync(process.execPath, ['scripts/test.mjs', 'tests/unit/doc-audit.test.ts'], {
    cwd: PLANE, encoding: 'utf8', env: { ...process.env }, maxBuffer: 64 * 1024 * 1024, timeout: 300000,
  })
  const out = (r.stdout ?? '') + (r.stderr ?? '')
  writeFileSync(`D:/法环游戏/.scratch/td003_arm_${label}.log`, out, 'utf8')
  const cov = out.match(/覆盖核对[^\n]*|用例全绿|红[^\n]*/g) ?? []
  console.log(`### ${label}`)
  console.log(cov.slice(-4).join('\n'))
  const names = [...out.matchAll(/^\s*(?:×|✕|FAIL)[^\n]*/gm)].map((m) => m[0].trim())
  console.log(names.slice(0, 8).join('\n') || '(没有红行)')
}

run('control')
restore()
for (const arm of arms) {
  const text = readFileSync(docPath, 'utf8')
  if (!text.includes(arm.from)) throw new Error(`ARM NOT APPLIED (needle missing): ${arm.name}`)
  writeFileSync(docPath, text.replace(arm.from, arm.to), 'utf8')
  if (readFileSync(docPath, 'utf8') === text) throw new Error(`ARM NOT APPLIED (no-op): ${arm.name}`)
  run(arm.name)
  restore()
}
console.log('ALL ARMS DONE, doc restored:', readFileSync(docPath, 'utf8') === pristine)
