import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * scripts/smoke-live.mjs 并发压测档（KI-595）自证：
 *   ① 支持 `--concurrency N`（缺省 4，上限 16，下限 1）；② 全部 31 个端点保留 marker 判据；
 *   ③ 汇总含 wallMs/p50/p95/p99；④ 退出码语义不变（有失败仍=1）；⑤ JSON 模式字段完整。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const SM = existsSync(resolve(ROOT, 'scripts/smoke-live.mjs')) ? readFileSync(resolve(ROOT, 'scripts/smoke-live.mjs'), 'utf8') : ''

describe('scripts/smoke-live.mjs · 并发压测档（KI-595）', () => {
  it('支持 --concurrency（N 与 =N 两种形态）且默认 4、上下限夹取 [1, 16]', () => {
    expect(SM).toContain("argv.indexOf('--concurrency')")
    expect(SM).toContain("argv.find((a) => a.startsWith('--concurrency='))")
    expect(SM).toMatch(/Math\.max\(1,\s*Math\.min\(16,/)
  })

  it('Promise pool 并发（不是串行 for）', () => {
    expect(SM).toContain('async function worker()')
    expect(SM).toContain('Promise.all(Array.from({ length: concurrency }, worker))')
    expect(SM).not.toContain('for (const e of ENDPOINTS) {')
  })

  it('31 个端点完整保留、marker 判据原样', () => {
    const endpoints = (SM.match(/\{ name: '/g) ?? []).length
    expect(endpoints).toBe(31)
    for (const marker of ["name: 'admin'", "name: 'story-12'", "name: 'story-13'", "name: 'story-14'", "name: 'story-15'", "name: 'story-16'", "name: 'story-17'", "name: 'story-18'", "name: 'story-19'", "name: 'story-20'", "name: 'story-21'", "/caesura/story/string-listener/", "name: 'ai-json-commit'", "name: 'ai-json-qa'", "/caesura/story/dark-tide/", "/caesura/story/twelfth-listener/", "/caesura/story/bell-picker/", "/caesura/story/lampwright-bell/", "/caesura/story/lowtone-city/", "/caesura/story/pendulum-ferryman/", "/caesura/story/unfinished-ledger/", "/caesura/story/fourth-strike/", "admin/ai-director-latest.json", "admin/ai-director-transitions-qa.json"]) {
      expect(SM).toContain(marker)
    }
  })

  it('summary 含 wallMs/p50/p95/p99 且 JSON 模式可被 CI 机读', () => {
    for (const token of ['wallMs', 'p50', 'p95', 'p99', 'concurrency']) {
      expect(SM, `missing summary field: ${token}`).toContain(token)
    }
  })

  it('退出码语义不变：失败列表非空 ⇒ exit 1', () => {
    expect(SM).toContain('exit(failed.length === 0 ? 0 : 1)')
  })
})
