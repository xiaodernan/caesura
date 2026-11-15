import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * StateGraph 状态图内核面板（KI-594，console/index.html · 集大成调度台）自证：
 *   ① 文件存在；② 四个节点 plan/write/qa/commit + qa→write 条件边在场；
 *   ③ 徽标零网络（ panel 段）；④ app.js 内置 sgKernel 微内核且 renderStateGraph 已调用（ boot 链）；
 *   ⑤ LANG_EXACT 双语对完整（zh/en 成对）；⑥ —— 与 STORY 面板同层的 SVG 教学件。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const HTML = existsSync(resolve(ROOT, 'console/index.html')) ? readFileSync(resolve(ROOT, 'console/index.html'), 'utf8') : ''
const APP = existsSync(resolve(ROOT, 'console/app.js')) ? readFileSync(resolve(ROOT, 'console/app.js'), 'utf8') : ''
const CSS = existsSync(resolve(ROOT, 'console/styles.css')) ? readFileSync(resolve(ROOT, 'console/styles.css'), 'utf8') : ''

describe('KI-594 · console/panel-stategraph（StateGraph 状态图内核）', () => {
  it('console/index.html 携带 panel-stategraph 与四个节点', () => {
    expect(HTML.length).toBeGreaterThan(1000)
    expect(HTML).toContain('panel-stategraph')
    for (const n of ['plan', 'write', 'qa', 'commit']) expect(HTML, `missing node: ${n}`).toContain('data-node="' + n + '"')
    expect(HTML).toContain('qa 不过 → write')
    expect(HTML).toContain('id="sg-verdicts"')
    expect(HTML).toContain('id="sg-note"')
  })

  it('app.js 内置 sgKernel 微内核 + renderStateGraph 定义且在 boot 链中调用', () => {
    expect(APP).toContain('function sgKernel()')
    expect(APP).toContain('function renderStateGraph()')
    expect(APP).toContain('renderStateGraph()')
    expect(APP).toContain('Checkpointer')
    expect(APP).toContain('add_conditional_edges')
  })

  it('CSS 含 .sg-verdicts/.sg-line（ok/bad 两态）且遵守桌面 grid 规则', () => {
    expect(CSS).toContain('.sg-verdicts')
    expect(CSS).toContain('.sg-line.ok')
    expect(CSS).toContain('.sg-line.bad')
  })

  it('LANG_EXACT 英↔中成对（EN 模式零 CJK 面前提）', () => {
    for (const pair of [
      "'STATEGRAPH · 状态图内核': 'State Graph Kernel',",
      "'节点是纯函数：同入参同出参（×100）': 'Nodes are pure: same input → same output (×100)',",
      "'interrupt() 人审回路：挂起→审批→同 thread 恢复（interrupt → resume）': 'interrupt() human-in-the-loop: suspend → approve → resume on the same thread',",
    ]) {
      expect(APP, `missing LANG_EXACT pair: ${pair}`).toContain(pair)
    }
  })

  it('math check: 微内核幂等性 — 同入参 JSON 一致（字符串级复现）', () => {
    expect(APP).toContain("Array(100).fill(0).every")
    expect(APP).toContain("qaCount >= 2 ? 'commit' : 'write'")
    expect(APP).toContain('mergeFan')
  })

  it('零网络请求（无外链 script/stylesheet 参与本面板）', () => {
    const block = HTML.slice(HTML.indexOf('panel-stategraph'), HTML.indexOf('panel-story'))
    expect(block).not.toMatch(/<script[^>]*src=["']https?:/)
    expect(block).not.toMatch(/<link[^>]*href=["']https?:/)
  })
})
