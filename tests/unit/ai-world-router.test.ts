import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BRANCHES,
  FALLBACK,
  TRILEMMA,
  normalizeDecision,
  decideNext,
  fixtureCall,
  routeStudy,
  routerSnapshot,
} from '../../scripts/lib/llm-router.mjs'

/**
 * KI-735 · LLM 驱动的条件路由世界状态机门钉：
 *   ① 内核三难逐字同源、决策归一（非法 next 归 fallback）；
 *   ② 三路 tamper 各只打穿一位、rigged 诚实塌缩、falsifiable 由真值推导；
 *   ③ 真机产物：双拷贝字节一致、条件边真走分支、人工闸四要素、密钥零落盘；
 *   ④ 实现层：StateGraph.addConditionalEdges 首次真用、五分支节点、admin 面板 + i18n + boot + CSS。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')
const AUTHORING = 'src/data/authoring/ai-world-router.json'
const ADMIN = 'admin/ai-world-router.json'
const KEY_SHAPE = /sk-[A-Za-z0-9_\-]{16,}|ghp_[A-Za-z0-9]{20,}/

describe('KI-735 · LLM router 内核（判据可注入 / 可证伪）', () => {
  it('分支名册 + 三难维 + fallback 逐字固定', () => {
    expect([...BRANCHES]).toEqual(['escalate', 'resolve', 'branch', 'foreshadow', 'breather'])
    expect(FALLBACK).toBe('breather')
    expect([...TRILEMMA]).toEqual(['stateResponsive', 'canonGrounded', 'auditable'])
  })

  it('normalizeDecision：合法 JSON / 代码围栏 / 非法分支归 fallback 前态', () => {
    expect(normalizeDecision('{"next":"escalate","reason":"张力高","canon":"回廊钟"}').valid).toBe(true)
    const fenced = normalizeDecision('```json\n{"next":"resolve","reason":"回落","canon":"薄簿"}\n```')
    expect(fenced.valid).toBe(true)
    expect(fenced.next).toBe('resolve')
    const bad = normalizeDecision('{"next":"BOGUS"}')
    expect(bad.valid).toBe(false)
    expect(bad.source).toBe('invalid-branch')
    expect(normalizeDecision('not json at all').source).toBe('unparseable')
  })

  it('decideNext：异常与非法输出都归 fallback 且标 source，绝不静默当成功', async () => {
    const state = { id: 'x', tension: 90, threads: 4, lastKind: 'x', anchors: ['回廊钟'] }
    const ok = await decideNext({ state, call: fixtureCall })
    expect(ok.next).toBe('escalate')
    expect(ok.source).toBe('llm')
    const thrown = await decideNext({ state, call: async () => { throw new Error('boom') } })
    expect(thrown.next).toBe(FALLBACK)
    expect(thrown.source).toBe('error-fallback')
    const illegal = await decideNext({ state, call: async () => ({ next: 'nonsense', reason: 'r', canon: '回廊钟' }) })
    expect(illegal.next).toBe(FALLBACK)
    expect(illegal.valid).toBe(false)
  })
})

describe('KI-735 · 三难现算 + tamper 精确切片 + rigged 诚实塌缩', () => {
  it('基线 LLMDecided=111、常量基线不响应式', async () => {
    const s = await routeStudy({ tamper: 'none' })
    const llm = s.strategies.find((x) => x.strategy === 'LLMDecided')!
    const constant = s.strategies.find((x) => x.strategy === 'ConstantBaseline')!
    expect(llm.key).toBe('111')
    expect(llm.distinctBranches).toBeGreaterThanOrEqual(2)
    expect(constant.stateResponsive).toBe(false)
    expect(s.falsifiable).toBe(true)
    expect(s.noUniversalWinner).toBe(true)
  })

  it('三路 tamper 各只打穿一位（011 / 101 / 110），互不串味', async () => {
    const expected: Record<string, string> = { noState: '011', hallucinateCanon: '101', noReason: '110' }
    for (const [mode, key] of Object.entries(expected)) {
      const s = await routeStudy({ tamper: mode })
      const llm = s.strategies.find((x) => x.strategy === 'LLMDecided')!
      expect(llm.key, `tamper=${mode}`).toBe(key)
      expect(s.falsifiable, `falsifiable tamper=${mode}`).toBe(true)
    }
  })

  it('rigged 全开 ⇒ 两家收敛 111，区分度塌缩、falsifiable 归 false', async () => {
    const s = await routeStudy({ rigged: true, tamper: 'noState' })
    expect(s.strategies.every((x) => x.key === '111')).toBe(true)
    expect(s.riggedConvergenceCollapsed).toBe(true)
    expect(s.falsifiable).toBe(false)
    expect(routerSnapshot(s).riggedConvergenceCollapsed).toBe(true)
  })
})

describe('KI-735 · 真机产物 + 实现层接线', () => {
  it('双拷贝产物存在且字节级一致', () => {
    expect(existsSync(resolve(ROOT, AUTHORING))).toBe(true)
    expect(existsSync(resolve(ROOT, ADMIN))).toBe(true)
    expect(read(ADMIN)).toBe(read(AUTHORING))
  })

  const art = JSON.parse(read(AUTHORING)) as Record<string, any>

  it('人工闸四要素 + schema + 决策来自 LLM', () => {
    expect(art.schema).toBe(1)
    expect(art.ki).toBe('KI-735')
    expect(art.runtime).toBe(false)
    expect(art.authorOnly).toBe(true)
    expect(art.containsCredentials).toBe(false)
    expect(art.requiresHumanReview).toBe(true)
    expect(art.decision.source).toBe('llm')
    expect(BRANCHES).toContain(art.decision.next)
    expect(art.model).toBe('gpt-6.2-sol')
    expect(art.mode).toBe('live')
  })

  it('条件边真走分支：checkpoints 含 llmRoute → draft_<next> → writeArtifacts', () => {
    const nodes = (art.checkpoints || []).map((c: any) => c.node)
    expect(nodes).toContain('llmRoute')
    expect(nodes).toContain('writeArtifacts')
    expect(nodes).toContain(`draft_${art.decision.next}`)
    expect(art.branchReached).toBe(true)
    // 只有一个 draft 节点被走到（五分支互斥）
    expect(nodes.filter((n: string) => n.startsWith('draft_')).length).toBe(1)
  })

  it('产物零密钥形状', () => {
    expect(KEY_SHAPE.test(read(AUTHORING))).toBe(false)
    expect(KEY_SHAPE.test(read(ADMIN))).toBe(false)
  })

  it('实现层：StateGraph.addConditionalEdges 首次真用 + 五分支节点 + CLI 注册', () => {
    const src = read('scripts/ai-world-router.mjs')
    expect(src).toContain('.addConditionalEdges(')
    expect(src).toContain('llmRoute')
    // 分支节点由模板动态生成（draft_${b}），五分支名册来自 BRANCHES 常量而非硬编码字面量。
    expect(src).toContain('graph.addNode(`draft_${b}`')
    expect(src).toContain('Object.fromEntries(BRANCHES.map')
    expect(src).toContain('callLlm')
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.scripts['ai:world-router']).toBeTruthy()
    expect(pkg.scripts['ai:world-router:live']).toContain('--live')
  })

  it('声明层与实现同名导出（decl-parity 同构）', () => {
    const impl = read('scripts/lib/llm-router.mjs')
    const decl = read('scripts/lib/llm-router.d.mts')
    for (const name of ['BRANCHES', 'FALLBACK', 'TRILEMMA', 'TAMPER_MODES', 'DEFAULT_STATES', 'normalizeDecision', 'decideNext', 'fixtureCall', 'routeStudy', 'routerSnapshot']) {
      expect(impl, `impl missing ${name}`).toContain(name)
      expect(decl, `decl missing ${name}`).toContain(name)
    }
  })

  it('admin 面板：panel-router + renderRouter + boot 调用 + 双语 + CSS 不重叠', () => {
    const html = read('admin/index.html')
    const app = read('admin/app.js')
    const css = read('admin/styles.css')
    expect(html).toContain('id="panel-router"')
    expect(html).toContain('id="router-path"')
    expect(html).toContain('id="router-verdict"')
    expect(app).toContain('async function renderRouter()')
    expect(app).toMatch(/renderStateGraph\(\); renderRouter\(\)/)
    expect(app).toContain("'router.h2'")
    expect(css).toContain('.router-grid')
    expect(css).toContain('grid-template-columns: repeat(3')
    expect(css).toContain('overflow-wrap: anywhere')
  })
})
