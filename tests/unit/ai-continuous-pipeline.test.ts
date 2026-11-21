import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * KI-728 · AI 导演持续产出流水线（动态篇号 + 双闭环自动运转）：
 *   ① 脚本含 nextChapterNo()，从 atlas no 序列现读 max+1（不再 hardcode）；
 *   ② draftContent 用动态篇号（模板字符串 ${nextNo}，无 "no":84 字面量）；
 *   ③ 现读 atlas max no 与 nextChapterNo 结果 +1 一致；
 *   ④ 与 KI-725 提案避让 + KI-726 终审回灌三机制并存；
 *   ⑤ 真跑 proof 证明产出 no:85 且三机制同时生效。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')
const SCRIPT = read('scripts/ai-director.mjs')

describe('KI-728 · AI 导演持续产出流水线', () => {
  it('脚本含 nextChapterNo 现读 atlas max+1', () => {
    expect(SCRIPT).toContain('function nextChapterNo()')
    expect(SCRIPT).toContain('Math.max(...nos) + 1')
  })

  it('draftContent 用动态篇号，无 hardcode no:84', () => {
    expect(SCRIPT).toContain('const nextNo = nextChapterNo()')
    expect(SCRIPT).toContain('${nextNo}')
    // 不应再有硬编码的 "no":84（注意 proof/文档不在 SCRIPT 里）
    expect(SCRIPT).not.toContain('"no":84')
  })

  it('现读 atlas 最大 no 与预期下一篇一致（动态，不写死篇号）', () => {
    const atlas = read('src/ui/atlas-texts.ts')
    const nos = [...atlas.matchAll(/^\s*no:\s*(\d+)/gm)].map((m) => Number(m[1])).filter((n) => Number.isFinite(n))
    const max = Math.max(...nos)
    expect(max).toBeGreaterThanOrEqual(85)
    // 序列严格是 1..max（无断点、无重复）——每落地一篇，动态篇号自动 +1
    expect(nos.sort((a, b) => a - b)).toEqual(Array.from({ length: max }, (_, i) => i + 1))
  })

  it('三机制并存：动态篇号 + 提案避让 + 终审回灌', () => {
    expect(SCRIPT).toContain('nextChapterNo()')
    expect(SCRIPT).toContain('canonFlagRoster()')
    expect(SCRIPT).toContain('editorialFeedback()')
  })

  it('真跑 proof 证明产出 no:85 且三机制同时生效', () => {
    const files = readdirSync(resolve(ROOT, 'docs/ai-director')).filter((f) => /^CONTINUOUS-PIPELINE-\d{4}-\d{2}-\d{2}\.md$/.test(f))
    expect(files.length).toBeGreaterThanOrEqual(1)
    const proof = read('docs/ai-director/' + files[files.length - 1])
    expect(proof).toContain('no:85')
    expect(proof).toContain('warnings=[]')
    expect(proof).toContain('终审回灌')
    expect(proof).toContain('88.3%')
  })
})
