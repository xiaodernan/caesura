import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * KI-622 · admin「状态图检查站」门钉：
 *   ① admin 页含状态图检查站面板（#panel-stategraph / #sg-graph / sg.h2）；
 *   ② app.js 有 renderStateGraph + 七节点名册，且 renderAll 真的调用它；
 *   ③ ai-director 产物的 graphCheckpoints 恰好七条、全部 ok（真机产物硬断言）；
 *   ④ RUN 报告含七个节点名（人读证据齐全）；
 *   ⑤ styles.css 含 .panel-stategraph（样式不掉队）。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

describe('admin · StateGraph 检查站（KI-622）', () => {
  const html = read('admin/index.html')
  const js = read('admin/app.js')
  const css = read('admin/styles.css')

  it('admin/index.html 含状态图检查站面板与 SVG 容器', () => {
    expect(html).toContain('id="panel-stategraph"')
    expect(html).toContain('id="sg-graph"')
    expect(html).toContain('data-i18n="sg.h2"')
    expect(html).toContain('id="sg-rerun"')
  })

  it('app.js 有名册 + 渲染函数，且 renderAll 调用它', () => {
    for (const node of ['loadWorld', 'retrieveCanon', 'warmup', 'audit', 'proposeTransitions', 'draftContent', 'writeArtifacts']) {
      expect(js, `SG_NODES 缺节点 ${node}`).toContain(`'${node}'`)
    }
    expect(js).toContain('renderStateGraph')
    expect(js).toContain("renderAiCommitted(); hydrateAiLive(); renderStateGraph()")
    expect(js).toContain('sg-graph')
  })

  it('styles.css 含状态图检查站样式', () => {
    expect(css).toContain('.panel-stategraph')
    expect(css).toContain('.sg-foot')
  })

  it('ai-director-latest.json：七条 graphCheckpoints 且全部 ok', () => {
    const art = JSON.parse(read('src/data/authoring/ai-director-latest.json')) as Record<string, any>
    expect(Array.isArray(art.graphCheckpoints)).toBe(true)
    expect(art.graphCheckpoints.length).toBe(7)
    for (const c of art.graphCheckpoints) {
      expect(c.ok, `checkpoint ${c.node} 未 ok`).toBe(true)
    }
    expect(art.usage.calls).toBeGreaterThanOrEqual(4)
    expect(Array.isArray(art.usage.statuses)).toBe(true)
    for (const s of art.usage.statuses) expect([200, 201]).toContain(Number(s))
  })

  it('docs/ai-director/RUN-*.md 含七个节点名', () => {
    const dir = resolve(ROOT, 'docs/ai-director')
    const runs = readdirSync(dir).filter((f) => /^RUN-\d{4}-\d{2}-\d{2}\.md$/.test(f))
    expect(runs.length).toBeGreaterThanOrEqual(1)
    const newest = runs.sort().reverse()[0]
    const md = readFileSync(resolve(dir, newest), 'utf8')
    for (const node of ['loadWorld', 'retrieveCanon', 'warmup', 'audit', 'proposeTransitions', 'draftContent', 'writeArtifacts']) {
      expect(md, `RUN 报告缺节点 ${node}`).toContain(node)
    }
  })
})
