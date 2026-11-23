import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * scripts/smoke-live.mjs 并发压测档（KI-595）自证：
 *   ① 支持 `--concurrency N`（缺省 4，上限 16，下限 1）；② 全部 95 个端点保留 marker 判据；
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

  it('104 个端点完整保留、marker 判据原样', () => {
    const endpoints = (SM.match(/\{ name: '/g) ?? []).length
    expect(endpoints).toBe(104)
    for (const marker of ["name: 'admin'", "name: 'story-12'", "name: 'story-13'", "name: 'story-14'", "name: 'story-15'", "name: 'story-16'", "name: 'story-17'", "name: 'story-18'", "name: 'story-19'", "name: 'story-20'", "name: 'story-21'", "name: 'story-22'", "name: 'story-23'", "name: 'story-24'", "name: 'story-25'", "name: 'story-26'", "name: 'story-27'", "name: 'story-28'", "name: 'story-29'", "name: 'story-30'", "name: 'story-31'", "name: 'story-32'", "name: 'story-33'", "name: 'story-34'", "name: 'story-35'", "name: 'story-36'", "name: 'story-37'", "name: 'story-38'", "name: 'story-39'", "name: 'story-40'", "name: 'story-41'", "name: 'story-42'", "name: 'story-43'", "name: 'story-44'", "name: 'story-45'", "name: 'story-46'", "name: 'story-47'", "name: 'story-48'", "name: 'story-49'", "name: 'story-50'", "name: 'story-51'", "name: 'story-52'", "name: 'story-53'", "name: 'story-54'", "name: 'story-55'", "name: 'story-56'", "name: 'story-57'", "name: 'story-58'", "name: 'story-59'", "name: 'story-60'", "name: 'story-61'", "name: 'story-62'", "name: 'story-63'", "name: 'story-64'", "name: 'story-65'", "name: 'story-66'", "name: 'story-67'", "name: 'story-68'", "name: 'story-69'", "name: 'story-70'", "name: 'story-71'", "name: 'story-72'", "name: 'story-73'", "name: 'story-74'", "name: 'story-75'", "name: 'story-76'", "name: 'story-77'", "name: 'story-78'", "name: 'story-79'", "name: 'story-80'", "name: 'story-81'", "name: 'story-82'", "name: 'story-83'", "name: 'story-84'", "name: 'story-85'", "name: 'story-86'", "name: 'story-87'", "name: 'story-88'", "name: 'story-89'", "name: 'story-90'", "name: 'story-91'", "name: 'story-92'", "name: 'story-93'", "/caesura/story/string-listener/", "/caesura/story/third-voice/", "/caesura/story/ensemble/", "/caesura/story/echo-vale/", "/caesura/story/after-half-a-chime/", "/caesura/story/beside-the-button/", "/caesura/story/beyond-the-line/", "/caesura/story/after-the-bag/", "/caesura/story/salt-on-the-sill/", "/caesura/story/after-the-salt-line/", "/caesura/story/the-sill-keeps-count/", "/caesura/story/after-the-space/", "/caesura/story/the-unmarked-number/", "/caesura/story/beside-the-scale/", "/caesura/story/the-unentered-page/", "/caesura/story/the-dry-place/", "/caesura/story/unweighed/", "/caesura/story/the-empty-scale/", "/caesura/story/beyond-the-scale/", "/caesura/story/the-scale-shadow/", "/caesura/story/beyond-the-threshold/", "/caesura/story/the-mark-outside/", "/caesura/story/salt-at-the-threshold/", "/caesura/story/the-unopened-page/", "/caesura/story/the-unsent-letter/", "/caesura/story/after-the-empty-scale/", "/caesura/story/the-unmade-swing/", "/caesura/story/the-dry-mark-beneath/", "/caesura/story/the-unasked-boat/", "/caesura/story/the-place-aboard/", "/caesura/story/salt-not-aboard/", "/caesura/story/the-boat-still/", "/caesura/story/beside-the-jar/", "/caesura/story/the-ring/", "/caesura/story/the-mark-beneath-the-jar/", "/caesura/story/the-unmoved-pendulum/", "/caesura/story/no-handover/", "/caesura/story/beside-the-pendulum/", "/caesura/story/salt-beside-the-seat/", "/caesura/story/the-mark-remains/", "/caesura/story/at-ebb-one-stick/", "/caesura/story/the-swing-unreturned/", "/caesura/story/the-ash-beside-the-pendulum/", "/caesura/story/ash-not-fallen/", "name: 'ai-json-commit'", "name: 'ai-json-qa'", "name: 'ai-json-cache'", "/caesura/story/dark-tide/", "/caesura/story/twelfth-listener/", "/caesura/story/bell-picker/", "/caesura/story/lampwright-bell/", "/caesura/story/lowtone-city/", "/caesura/story/pendulum-ferryman/", "/caesura/story/unfinished-ledger/", "/caesura/story/fourth-strike/", "admin/ai-director-latest.json", "admin/ai-director-transitions-qa.json"]) {
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
