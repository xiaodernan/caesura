#!/usr/bin/env node
/**
 * scripts/release.mjs —— 竖切片发布前的一站式验收：tsc → validate:data → test → build → check-dist
 * 全绿才输出 RELEASE CHECK OK；任何一红都不声称自己通过；不改源、不 push、不 --bless。
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'))
const steps = [
  { name: 'tsc --noEmit', cmd: process.execPath, args: ['node_modules/typescript/bin/tsc', '--noEmit'] },
  { name: 'validate:data', cmd: process.execPath, args: ['scripts/validate-data.mjs'] },
  { name: 'full suite (node scripts/test.mjs)', cmd: process.execPath, args: ['scripts/test.mjs'], timeout: 25 * 60 * 1000 },
  { name: 'build', cmd: process.execPath, args: ['node_modules/vite/bin/vite.js', 'build'] },
  { name: 'check-dist', cmd: process.execPath, args: ['scripts/check-dist.mjs'] },
]

const results = []
let failed = 0
for (const s of steps) {
  const t0 = Date.now()
  process.stdout.write(`[release] ${s.name} … `)
  try {
    const env = { ...process.env }
    execFileSync(s.cmd, s.args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: s.timeout ?? 12 * 60 * 1000 })
    const ms = Date.now() - t0
    results.push({ name: s.name, ok: true, ms })
    process.stdout.write('OK\n')
  } catch (e) {
    failed++
    const tail = (((e.stdout && e.stdout.toString()) || '') + '\n' + ((e.stderr && e.stderr.toString()) || '')).slice(-1600)
    results.push({ name: s.name, ok: false, ms: Date.now() - t0, tail })
    process.stdout.write(`RED\n${tail}\n`)
  }
}

console.log('\n[release] summary:')
for (const r of results) console.log(`  ${r.ok ? 'OK' : 'FAIL'}  ${r.name}${r.ms ? `  (${r.ms}ms)` : ''}`)
if (failed > 0) {
  console.log('\nRELEASE CHECK FAILED — do not ship.')
  process.exit(1)
}
console.log('\nRELEASE CHECK OK — build is verifiable end-to-end.')
