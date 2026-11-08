/**
 * tests/unit/phase-status.test.ts —— `npm run status` 与 PHASE-STATUS.md 的对账门。
 *
 * 两件事证出 PHASE-STATUS.md 的嵌入数字不是手抄的：
 *   ① 脚本能跑、输出所有 KEY=VALUE 且退出码 0；
 *   ② 文档里每个 KEY=VALUE 与脚本现读逐字一致（regex 取值，无空格）。
 * 另两条钉住嵌入点——缺了任何一个都=「有人手改文档」。
 *
 * 设计目标：编辑者只能「改脚本 → 跑脚本 → 替换文档里的数字」，手改文档任意一个数字都红。
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'

const ROOT = process.cwd()
const DOC_REL = join(ROOT, 'docs', 'PHASE-STATUS.md')
const SCRIPT_REL = join(ROOT, 'scripts', 'phase-status.mjs')

const runStatus = () => execFileSync(process.execPath, [SCRIPT_REL], { encoding: 'utf8' })
const parseKv = (text: string) => {
  const out = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z][\w.]*)=(.*)$/)
    if (m) out.set(m[1], m[2])
  }
  return out
}

describe('PHASE-STATUS 嵌入门', () => {
  it('scripts/phase-status.mjs 退出码 0 且输出键集非空且自洽', () => {
    const out = runStatus()
    const kv = parseKv(out)
    expect(kv.size).toBeGreaterThan(15)
    expect(kv.get('KI.rows')).toBeDefined()
    expect(kv.get('ARCH.sections')).toBeDefined()
    // 无架构空洞与重号时脚本 exit=0
    expect(kv.get('ARCH.holes')).toBe('none')
    expect(kv.get('ARCH.duplicates')).toBe('0')
  })

  it('文档中的每个 KEY=VALUE 与现读逐字一致（防手改）', () => {
    const out = runStatus()
    const kv = parseKv(out)
    const doc = readFileSync(DOC_REL, 'utf8')
    const block = doc.match(/<!-- PHASE-STATUS:BEGIN-KV -->([\s\S]*?)<!-- PHASE-STATUS:END-KV -->/)
    expect(block, 'PHASE-STATUS 里必须有 BEGIN-KV…END-KV 块').toBeTruthy()
    if (!block) return
    const kvInDoc = [...block[1].matchAll(/^([A-Za-z][\w.]*)=([\w.,-]+)\s*$/gm)]
    expect(kvInDoc.length).toBeGreaterThan(10)
    const docKeys = new Set(kvInDoc.map((m) => m[1]))
    expect(docKeys.has('KI.rows')).toBe(true)
    expect(docKeys.has('ARCH.maxSection')).toBe(true)
    for (const m of kvInDoc) {
      const [, k, v] = m
      expect(kv.has(k), `脚本里没有 KEY=${k}：脚本与文档分家了`).toBe(true)
      expect(kv.get(k), `${k}：文档=${v}，脚本现读=${kv.get(k)}`).toBe(v)
    }
  })

  it('PHASE-STATUS.md 显式指引读者跑 npm run status', () => {
    const doc = readFileSync(DOC_REL, 'utf8')
    expect(doc).toMatch(/npm run status/)
    expect(doc).toMatch(/phase-status\.test\.ts/)
  })

  it('嵌入的脚本命令与 deps 数与 package.json 一致', () => {
    const out = runStatus()
    const kv = parseKv(out)
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
    expect(Number(kv.get('PKG.scripts'))).toBe(Object.keys(pkg.scripts ?? {}).length)
    expect(Number(kv.get('PKG.deps'))).toBe(Object.keys(pkg.dependencies ?? {}).length)
    expect(Number(kv.get('PKG.devDeps'))).toBe(Object.keys(pkg.devDependencies ?? {}).length)
  })

  it('ARCH 名册自洽：maxSection 等于节号名册的最大值且连续', () => {
    const out = runStatus()
    const kv = parseKv(out)
    expect(Number(kv.get('ARCH.sections'))).toBe(Number(kv.get('ARCH.maxSection')))
    expect(kv.get('ARCH.holes')).toBe('none')
  })

  it('KI 嵌入数字与账本行数一致（不要凭叙冒）', () => {
    const out = runStatus()
    const kv = parseKv(out)
    const sum = Number(kv.get('KI.Implemented')) + Number(kv.get('KI.Partial')) +
      Number(kv.get('KI.Placeholder')) + Number(kv.get('KI.Blocked'))
    expect(sum).toBe(Number(kv.get('KI.rows')))
  })
})
