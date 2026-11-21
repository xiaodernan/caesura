import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * KI-726 · AI 导演终审反馈回灌（StateGraph 第二个自我改进闭环）：
 *   ① 脚本含 editorialFeedback()：从上一轮 editorialGate（verdict + issues）读批评信号；
 *   ② draftContent 注入"规避同类问题"提示；
 *   ③ 产物新增 editorialFeedbackIn 字段 + RUN 文档回灌节；
 *   ④ 真跑 proof 证明：读到上轮 issues → 新草稿终审 issues=0 / verdict=pass；
 *   ⑤ 与 KI-725 提案避让构成双向闭环（两个 proof 都在）。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')
const SCRIPT = read('scripts/ai-director.mjs')

describe('KI-726 · AI 导演终审反馈回灌（StateGraph 自我改进）', () => {
  it('脚本含 editorialFeedback 读取上一轮 verdict/issues', () => {
    expect(SCRIPT).toContain('function editorialFeedback()')
    expect(SCRIPT).toContain('editorialGate')
    expect(SCRIPT).toContain('g.issues')
    expect(SCRIPT).toContain('draftTitle')
  })

  it('draftContent 注入终审反馈 + 规避提示', () => {
    expect(SCRIPT).toContain('const feedback = editorialFeedback()')
    expect(SCRIPT).toContain('state.editorialFeedback = feedback')
    expect(SCRIPT).toContain('上一轮终审反馈')
    expect(SCRIPT).toContain('规避同类问题')
  })

  it('产物构建逻辑写 editorialFeedbackIn，RUN 文档有回灌节', () => {
    expect(SCRIPT).toContain('editorialFeedbackIn: state.editorialFeedback')
    expect(SCRIPT).toContain('终审反馈回灌')
  })

  it('真跑 proof：读到上轮 issues → 新草稿终审 issues=0 / pass', () => {
    const files = readdirSync(resolve(ROOT, 'docs/ai-director')).filter((f) => /^EDITORIAL-FEEDBACK-\d{4}-\d{2}-\d{2}\.md$/.test(f))
    expect(files.length).toBeGreaterThanOrEqual(1)
    const proof = read('docs/ai-director/' + files[files.length - 1])
    expect(proof).toContain('verdict')
    expect(proof).toContain('issues=0')
    expect(proof).toContain('pass')
    expect(proof).toContain('门口的水')
  })

  it('双向闭环：提案避让 + 终审反馈两个 proof 并存', () => {
    const files = readdirSync(resolve(ROOT, 'docs/ai-director'))
    expect(files.some((f) => /^PROPOSAL-GUARD-\d{4}-\d{2}-\d{2}\.md$/.test(f))).toBe(true)
    expect(files.some((f) => /^EDITORIAL-FEEDBACK-\d{4}-\d{2}-\d{2}\.md$/.test(f))).toBe(true)
  })
})
