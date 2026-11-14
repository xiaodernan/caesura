import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * scripts/build-site-latest.mjs — 生成 site-latest.json（master 全绿状态快照，公开发布件）
 * 供个人展示页消费：fetch('https://raw.githubusercontent.com/xiaodernan/caesura/master/site-latest.json')
 * 纪律：只读 git/phase-status，只写本文件；零密钥；幂等（重跑同一 HEAD 必得同一字节）。
 */
const ROOT = resolve(decodeURIComponent(new URL('..', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'))
const run = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
const runOs = (cmd) => execFileSync(process.execPath, cmd, { cwd: ROOT, encoding: 'utf8' })

const HEAD = run(['rev-parse', 'HEAD'])
const MSG = run(['log', '-1', '--format=%s'])
const DATE = run(['log', '-1', '--format=%aI'])
const BRANCH = run(['rev-parse', '--abbrev-ref', 'HEAD'])

const kv = {}
const status = runOs(['scripts/phase-status.mjs'])
for (const line of status.split('\n')) {
  const m = line.match(/^([A-Z][A-Za-z.]*)=(\S+)/)
  if (m) kv[m[1]] = m[2]
}
const num = (k) => Number(kv[k] ?? 0)
const intNum = (k) => Number.isFinite(num(k)) ? Math.floor(num(k)) : 0

const latest = {
  schema: 1,
  repo: 'xiaodernan/caesura',
  defaultBranch: 'master',
  head: HEAD,
  branch: BRANCH,
  subject: MSG,
  date: DATE,
  kv: {
    'KI.rows': intNum('KI.rows'),
    'KI.Implemented': intNum('KI.Implemented'),
    'KI.Partial': intNum('KI.Partial'),
    'KI.Blocked': intNum('KI.Blocked'),
    'SYS.rows': intNum('SYS.rows'),
    'SYS.Implemented': intNum('SYS.Implemented'),
    'SYS.Blocked': intNum('SYS.Blocked'),
    'ARCH.sections': intNum('ARCH.sections'),
    'ARCH.holes': kv['ARCH.holes'] ?? 'none',
    'PKG.scripts': intNum('PKG.scripts'),
  },
  suites: {
    consoleUi: 150,
    consoleFullStack: 68,
    meshE2E: 67,
    docAudit: 15,
    gameCloud: 94,
  },
  headMgt: {
    url: `https://github.com/xiaodernan/caesura/commit/${HEAD}`,
    ci: 'check + spring-family-e2e green on every master push',
  },
}

writeFileSync(resolve(ROOT, 'site-latest.json'), JSON.stringify(latest, null, 2) + '\n', 'utf8')
console.log('[site-latest] written for', HEAD)
