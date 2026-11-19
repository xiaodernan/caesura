import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * KI-620 AI 导演引擎 · 机读门钉（2026-11-17）。
 *
 * ① 双拷贝产物（authoring + admin）字节级一致；
 * ② 产物是**真机**跑出来的（mode=live · audit 非空 · consistency 0–100 · 提案≥1 条 · 草稿齐双语）；
 * ③ 任何产物里不得出现密钥形状；
 * ④ RAG 检索库真能检索（低音之城 ⇒ 命中含「低音之城」的 chunk）；
 * ⑤ 人工闸名册：runtime:false / authorOnly:true / requiresHumanReview:true / containsCredentials:false。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const AUTHORING = resolve(ROOT, 'src/data/authoring/ai-director-latest.json')
const ADMIN = resolve(ROOT, 'admin/ai-director-latest.json')
const RUN_DIR = resolve(ROOT, 'docs/ai-director')
const SCRIPT = resolve(ROOT, 'scripts/ai-director.mjs')
const RAG = resolve(ROOT, 'scripts/lib/world-rag.mjs')

const read = (p: string) => readFileSync(p, 'utf8')
const KEY_SHAPE = /sk-[A-Za-z0-9_\-]{16,}/

describe('KI-620 · AI 导演引擎产物门钉', () => {
  it('脚本与 RAG 库都在', () => {
    expect(existsSync(SCRIPT)).toBe(true)
    expect(existsSync(RAG)).toBe(true)
  })

  it('双拷贝产物存在且字节级一致', () => {
    expect(existsSync(AUTHORING)).toBe(true)
    expect(existsSync(ADMIN)).toBe(true)
    expect(read(ADMIN)).toBe(read(AUTHORING))
  })

  const art = JSON.parse(read(AUTHORING)) as Record<string, any>

  it('人工闸四要素：runtime/authorOnly/requiresHumanReview/containsCredentials', () => {
    expect(art.runtime).toBe(false)
    expect(art.authorOnly).toBe(true)
    expect(art.requiresHumanReview).toBe(true)
    expect(art.containsCredentials).toBe(false)
    expect(art.schema).toBe(1)
  })

  it('真机产物：mode=live · 有 audit（一致性 0–100）· 提案 ≥1 条 · 草稿双语齐', () => {
    expect(art.mode).toBe('live')
    expect(art.model).toBeTruthy()
    expect(art.usage.calls).toBeGreaterThanOrEqual(3) // KI-663 单飞热身：warmup 允许被并行会话摊销（3 条正题调用恒在）
    expect(Array.isArray(art.usage.statuses)).toBe(true)
    for (const s of art.usage.statuses) expect([200, 201]).toContain(Number(s))
    const audit = art.audit
    expect(audit, 'audit 必须非空').toBeTruthy()
    expect(Number(audit.consistency)).toBeGreaterThanOrEqual(0)
    expect(Number(audit.consistency)).toBeLessThanOrEqual(100)
    expect(Array.isArray(audit.risks)).toBe(true)
    expect(audit.risks.length).toBeGreaterThanOrEqual(2)
    expect(Array.isArray(art.transitions)).toBe(true)
    expect(art.transitions.length).toBeGreaterThanOrEqual(1)
    for (const t of art.transitions) {
      expect(t.fromZh).toBeTruthy()
      expect(t.toZh).toBeTruthy()
      expect(t.flag).toMatch(/^flag\./)
      expect(t.narrativeZh).toBeTruthy()
      expect(t.narrativeEn).toBeTruthy()
    }
    const draft = art.atlasDraft
    expect(draft, 'atlasDraft 必须非空').toBeTruthy()
    expect(draft.no).toBe(80)
    expect(draft.titleZh).toBeTruthy()
    expect(draft.pZh).toBeTruthy()
    expect(draft.pEn).toBeTruthy()
    expect(draft.requiresHumanReview).toBe(true)

    // KI-683 的自然延伸：live 产物必须带「canon 编辑闸门」终审格（verdict + fidelity 双分数）
    const gate = art.editorialGate
    expect(gate, 'editorialGate 必须非空').toBeTruthy()
    if (!gate.skipped) {
      expect(['pass', 'revise', 'reject']).toContain(gate.verdict)
      expect(typeof gate.canonFidelity).toBe('number')
      expect(typeof gate.voiceFidelity).toBe('number')
      expect(Array.isArray(gate.issues)).toBe(true)
    }
  })

  it('cache hit 账本（admin/ai-cache-metrics.json）：存在 · rolling · 最新 live 条目与产物同构', () => {
    const LEDGER = resolve(ROOT, 'admin/ai-cache-metrics.json')
    expect(existsSync(LEDGER), 'admin/ai-cache-metrics.json 必须存在（writeArtifacts 落盘）').toBe(true)
    const ledger = JSON.parse(read(LEDGER)) as Record<string, any>
    expect(ledger.version).toBe(1)
    expect(ledger.runtime).toBe(false)
    expect(ledger.containsCredentials).toBe(false)
    const entries = ledger.entries
    expect(Array.isArray(entries)).toBe(true)
    expect(entries.length).toBeGreaterThanOrEqual(1)
    const live = entries.filter((e: any) => e && e.mode === 'live')
    expect(live.length).toBeGreaterThanOrEqual(1)
    const last = live[live.length - 1]
    expect(last.calls).toBeGreaterThanOrEqual(3)
    expect(Array.isArray(last.perCall)).toBe(true)
    expect(last.perCall.length).toBe(last.calls)
    for (const c of last.perCall) {
      expect([200, 201]).toContain(Number(c.status))
      expect(Number.isFinite(Number(c.prompt))).toBe(true)
      expect(Number.isFinite(Number(c.cached))).toBe(true)
      expect(Number.isFinite(Number(c.hitRate))).toBe(true)
    }
    // 与最新产物的 calls/cached 对齐（同一次运行的两种记账，不许漂移）
    expect(last.calls).toBe(art.usage.calls)
    expect(last.cachedTokens).toBe(art.usage.cachedTokens)
  })

  it('任何产物文件里不得出现密钥形状', () => {
    for (const p of [AUTHORING, ADMIN]) {
      expect(KEY_SHAPE.test(read(p)), `${p} 出现 sk- 密钥形状`).toBe(false)
    }
  })

  it('docs/ai-director/ 下至少有一份 RUN 报告且含「一致性审计」', () => {
    expect(existsSync(RUN_DIR)).toBe(true)
    const runs = readdirSync(RUN_DIR).filter((f) => /^RUN-\d{4}-\d{2}-\d{2}\.md$/.test(f))
    expect(runs.length).toBeGreaterThanOrEqual(1)
    const hasAudit = runs.some((f) => read(resolve(RUN_DIR, f)).includes('一致性审计'))
    expect(hasAudit).toBe(true)
  })

  it('StateGraph：节点名册与五个节点齐（loadWorld→retrieveCanon→warmup→audit→proposeTransitions→draftContent→writeArtifacts）', () => {
    const s = read(SCRIPT)
    for (const node of ['loadWorld', 'retrieveCanon', 'warmup', 'audit', 'proposeTransitions', 'draftContent', 'writeArtifacts']) {
      expect(s).toContain(`'${node}'`)
    }
    expect(s).toContain('addConditionalEdges')
    expect(s).toContain('directorPrefix')
  })
})

describe('KI-620 · world-rag（RAG 检索库）', () => {
  it('buildWorldCorpus + retrieve：「低音之城」检出含该词的 chunk，且分数为正', async () => {
    const rag = await import('../../scripts/lib/world-rag.mjs')
    const corpus = rag.buildWorldCorpus(ROOT)
    expect(corpus.length).toBeGreaterThan(500)
    const labeled = corpus.some((c: string) => c.startsWith('[短篇]')) && corpus.some((c: string) => c.startsWith('[对白]'))
    expect(labeled).toBe(true)
    const index = rag.buildIndex(corpus)
    const hits = rag.retrieve(index, '低音之城', 5)
    expect(hits.length).toBe(5)
    expect(hits.some((h: { chunk: string }) => h.chunk.includes('低音之城'))).toBe(true)
    for (const h of hits) expect(h.score).toBeGreaterThan(0)
  })

  it('tokenize：CJK 二元组 + ASCII 单词小写', async () => {
    const rag = await import('../../scripts/lib/world-rag.mjs')
    const toks = rag.tokenize('Lowtone 低音之城')
    expect(toks).toContain('lowtone')
    expect(toks.some((t: string) => t.length === 2)).toBe(true)
  })
})
