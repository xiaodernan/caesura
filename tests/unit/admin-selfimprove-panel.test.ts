import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * KI-727 · admin 自我改进闸门可视化（KI-725 提案避让 + KI-726 终审回灌的面板接入）：
 *   ① index.html 有 ai-selfimprove 区块 + i18n 标题键（双语）；
 *   ② app.js renderAiCommitted 读取 proposalGuard / editorialFeedbackIn / editorialGate 并渲染两行闭环；
 *   ③ styles.css 有 ai-si-row / ai-si-ok / ai-si-warn 样式（不重叠、状态配色）；
 *   ④ exportAiMemo 也导出两个闭环（AI 诊断备忘完整）；
 *   ⑤ 面板与导出只读本地 JSON，不触网、不泄密。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

describe('admin · 自我改进闸门可视化（KI-727）', () => {
  const html = read('admin/index.html')
  const js = read('admin/app.js')
  const css = read('admin/styles.css')

  it('index.html 有自我改进区块 + 双语 h4', () => {
    expect(html).toContain('id="ai-selfimprove"')
    expect(html).toContain('data-i18n="ai.selfimprove.h4"')
    expect(js).toContain("'ai.selfimprove.h4': { zh:")
    expect(js).toMatch(/'ai\.selfimprove\.h4': \{ zh: '[^']+', en: '[^']+' \}/)
  })

  it('renderAiCommitted 读取并渲染两个闭环字段', () => {
    const fn = js.slice(js.indexOf('async function renderAiCommitted()'), js.indexOf('\nfunction showAiError'))
    expect(fn).toContain("aiEl('ai-selfimprove')")
    expect(fn).toContain('d.proposalGuard')
    expect(fn).toContain('d.editorialFeedbackIn')
    expect(fn).toContain('提案避让')
    expect(fn).toContain('终审回灌')
    expect(fn).toContain('ai-si-')
    expect(fn).toContain("'ok' : 'warn'")
  })

  it('styles.css 有自改进行样式（四列网格 + 状态配色，防重叠）', () => {
    expect(css).toContain('.ai-selfimprove')
    expect(css).toContain('.ai-si-row')
    expect(css).toContain('grid-template-columns: 84px 1fr 1fr 1fr')
    expect(css).toContain('.ai-si-ok')
    expect(css).toContain('.ai-si-warn')
  })

  it('exportAiMemo 也导出两个闭环（诊断备忘完整）', () => {
    const fn = js.slice(js.indexOf('async function exportAiMemo()'), js.indexOf('\nfunction digestText'))
    expect(fn).toContain('d.proposalGuard')
    expect(fn).toContain('d.editorialFeedbackIn')
    expect(fn).toContain('自我改进闸门')
  })

  it('只读本地 JSON · 不触网 · 不泄密', () => {
    const fn = js.slice(js.indexOf('async function renderAiCommitted()'), js.indexOf('\nfunction showAiError'))
    expect(fn).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)/i)
    expect(fn).not.toMatch(/Authorization|Bearer|sk-[A-Za-z0-9_\-]{10,}/)
    expect(fn).toContain('fetch(')
  })
})
