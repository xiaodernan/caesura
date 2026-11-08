#!/usr/bin/env node
/**
 * scripts/check-links.mjs —— 校验 .md 文件中所有相对链接是否指向存在的文件。
 * 规则：
 *   [text](relative/path)  → 以引用文件所在目录为基准，existsSync 必须为真
 *   [text](https://…)     → 允许（不发起网络请求），记为 skipped=remote
 *   [text](#…)            → 允许（in-page anchor），记为 skipped=anchor
 *   [text](/absolute)     → 报红，本仓不允许根绝对路径
 * exit 0：所有本地链接可达；否则 exit 1，列出每个断链
 * 红线：本脚本不联网、不改任何源文件。
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/')

const SKIP_DIRS = new Set(['node_modules', '.scratch', 'dist', '.git', '.workbuddy-ai', 'coverage', '.cov-tmp'])
const walk = (dir) => {
  const out = []
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue
      out.push(...walk(p))
    } else if (name.endsWith('.md')) out.push(p)
  }
  return out
}
const CANDIDATES = ['', '']
const results = []
const visited = new Set()
for (const file of walk(ROOT)) {
  if (visited.has(file)) continue
  visited.add(file)
  const content = readFileSync(file, 'utf8')
  const base = dirname(file)
  const links = []
  const md = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  let m
  while ((m = md.exec(content))) {
    const [, text, target] = m
    if (target.startsWith('http://') || target.startsWith('https://') || target.startsWith('mailto:')) {
      results.push({ from: file, target, status: 'remote', ok: true })
      continue
    }
    if (target.startsWith('#')) {
      results.push({ from: file, target, status: 'anchor', ok: true })
      continue
    }
    if (target.startsWith('/')) {
      results.push({ from: file, target, status: 'absolute', ok: false, msg: '根绝对路径不允许' })
      continue
    }
    // 去掉 fragment
    const noFrag = target.split('#')[0]
    const resolved = join(base, decodeURIComponent(noFrag))
    if (noFrag === '') {
      results.push({ from: file, target, status: 'anchor', ok: true })
      continue
    }
    const ok = existsSync(resolved)
    results.push({ from: file, target, status: 'local', ok, resolved, msg: ok ? null : '目标缺失' })
  }
  // HTML <a href="...">
  const html = /<a[^>]+href="([^"]+)"/g
  while ((m = html.exec(content))) {
    const target = m[1]
    if (target.startsWith('http://') || target.startsWith('https://') || target.startsWith('mailto:')) {
      results.push({ from: file, target, status: 'remote', ok: true })
      continue
    }
    if (target.startsWith('#') || target === '') {
      results.push({ from: file, target, status: 'anchor', ok: true })
      continue
    }
    if (target.startsWith('/')) {
      results.push({ from: file, target, status: 'absolute', ok: false, msg: '根绝对路径不允许' })
      continue
    }
    const noFrag = target.split('#')[0]
    const resolved = join(base, decodeURIComponent(noFrag))
    if (noFrag === '') {
      results.push({ from: file, target, status: 'anchor', ok: true })
      continue
    }
    const ok = existsSync(resolved)
    results.push({ from: file, target, status: 'local', ok, resolved, msg: ok ? null : '目标缺失' })
  }
}
const bad = results.filter(r => r.status === 'local' && !r.ok)
const summary = {
  files: visited.size,
  links: results.length,
  remote: results.filter(r => r.status === 'remote').length,
  anchors: results.filter(r => r.status === 'anchor').length,
  local: results.filter(r => r.status === 'local').length,
  dangling: bad.length,
}
console.log('[check-links] summary:')
console.log(`  files scanned: ${summary.files}`)
console.log(`  links found:   ${summary.links} (${summary.remote} remote / ${summary.anchors} anchor / ${summary.local} local)`)
console.log(`  dangling:      ${summary.dangling}`)
if (bad.length) {
  console.log('[check-links] dangling:')
  for (const b of bad) console.log(`  ${b.from}: ${b.target}  → ${b.msg}`)
  process.exit(1)
}
console.log('[check-links] all links OK')
