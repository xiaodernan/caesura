import { describe, expect, it } from 'vitest'
import {
  PROMPT_CACHE_DEFAULTS,
  PROMPT_CACHE_BIBLE,
  PROMPT_CACHE_SCENARIOS,
  PROMPT_CACHE_STRATEGIES,
  createSyntheticCorpus,
  estimateTokens,
  factDensity,
  createVolatilePrefix,
  createStablePrefix,
  createBudgetedPrefix,
  promptCacheStudy,
  promptCacheSnapshot,
  verifyPromptCacheSoundness,
  verifyCausalLocks,
  createPromptCacheEvidence,
  runPromptCacheLive,
} from '../../scripts/caesura-prompt-cache.mjs'

/** KI-555 前缀亲和 prompt-cache 教学件 · 第六十二件（2026-11-14） */

describe('caesura-prompt-cache（KI-555）', () => {
  it('默认值/策略/场景 冻结（诚实口径：CJK 0.75 token/字 + 其它 4 字符/token）', () => {
    expect(PROMPT_CACHE_STRATEGIES).toEqual(['VolatilePrefix', 'StablePrefix', 'BudgetedPrefix'])
    expect(PROMPT_CACHE_SCENARIOS).toEqual(['coldStart', 'steadyReuse', 'overBudget', 'cleanRerun'])
    expect(PROMPT_CACHE_DEFAULTS.seed).toBe(555)
    expect(PROMPT_CACHE_DEFAULTS.messages).toBe(96)
    expect(PROMPT_CACHE_DEFAULTS.budgetTokens).toBe(320)
    expect(PROMPT_CACHE_DEFAULTS.cjkTokensPerChar).toBe(0.75)
    expect(PROMPT_CACHE_DEFAULTS.otherCharsPerToken).toBe(4)
    // 并轨线旧版的 tokenPerChar=4.08 是**英文**口径，套到中文上虚高约 4 倍 ⇒ 已移除，不得复活。
    expect('tokenPerChar' in PROMPT_CACHE_DEFAULTS).toBe(false)
  })

  it('圣经前缀逐字节稳定、estimateTokens 是结构量双口径（CJK 0.75 / ASCII 0.25）', () => {
    const a = estimateTokens(PROMPT_CACHE_BIBLE)
    const b = estimateTokens(PROMPT_CACHE_BIBLE.slice(0))
    expect(a).toBe(b)
    expect(estimateTokens('你')).toBe(Math.ceil(0.75))
    expect(estimateTokens('ab')).toBe(1)
    // 24 个 CJK 字符 × 0.75 = 18；40 个 ASCII 字符 × 0.25 = 10（允许 floor/ceil 到整数）
    expect(estimateTokens('你你你你你你你你你你你你你你你你你你你你你你你你')).toBe(18)
    expect(estimateTokens('a'.repeat(40))).toBe(10)
    expect(PROMPT_CACHE_BIBLE.length).toBeGreaterThan(400)
    expect(estimateTokens(PROMPT_CACHE_BIBLE)).toBeGreaterThan(150)
    // 前缀必须跨过一个 1024-token 缓存块，否则谈不上「命中」。
    expect(estimateTokens(PROMPT_CACHE_BIBLE)).toBeGreaterThan(1024)
    expect(estimateTokens('')).toBe(1)
  })

  it('合成语料：96 回合、3 个 speaker 轮转、每轮 6 核心 + 48 扩展', () => {
    const c = createSyntheticCorpus({ seed: 555, messages: 96 })
    expect(c.turns.length).toBe(96)
    expect(new Set(c.turns.map((t) => t.speaker))).toEqual(new Set(['npc_meg', 'npc_belltongue', 'npc_corvin']))
    expect(c.prefixTokens).toBe(estimateTokens(PROMPT_CACHE_BIBLE))
    expect(c.turns[0].facts.length).toBe(6)
    expect(c.turns[0].heavy.length).toBe(48)
  })

  it('factDensity 单调且**核心事实密度系统性高于扩展档案**（真分层，不是标签）', () => {
    const c = createSyntheticCorpus({ seed: 555, messages: 1 })
    for (const f of c.turns[0].facts.concat(c.turns[0].heavy)) {
      expect(Number.isFinite(factDensity(f))).toBe(true)
    }
    const minCore = Math.min(...c.turns[0].facts.map((f) => factDensity(f)))
    const maxHeavy = Math.max(...c.turns[0].heavy.map((f) => factDensity(f)))
    expect(minCore).toBeGreaterThan(maxHeavy)
  })

  it('VolatilePrefix：所有回合 hits=0、prefix 每轮全付、facts 全保留', () => {
    const c = createSyntheticCorpus({ seed: 555, messages: 12 })
    const r = createVolatilePrefix().invoke(c.turns)
    expect(r.hits).toBe(0)
    expect(r.freshPrefixTokens).toBe(12 * estimateTokens(PROMPT_CACHE_BIBLE))
    expect(r.retainedFacts).toBe(12 * 6)
    expect(r.droppedFacts).toBe(0)
  })

  it('StablePrefix：首轮 miss、其余全中、prefix **只付一次**、facts 全保留', () => {
    const c = createSyntheticCorpus({ seed: 555, messages: 12 })
    const r = createStablePrefix().invoke(c.turns)
    expect(r.hits).toBe(11)
    expect(r.freshPrefixTokens).toBe(estimateTokens(PROMPT_CACHE_BIBLE))
    expect(r.retainedFacts).toBe(12 * 6)
  })

  it('freeStablePrefix：连首轮都算暖且 prefix 计费归零（rigged 开挂，真进内核）', () => {
    const c = createSyntheticCorpus({ seed: 555, messages: 8 })
    const r = createStablePrefix({ freeStablePrefix: true }).invoke(c.turns)
    expect(r.hits).toBe(8)
    expect(r.freshPrefixTokens).toBe(0)
  })

  it('BudgetedPrefix：overBudget 后缀裁剪真发生（dropped>0）且核心事实全保住', () => {
    const c = createSyntheticCorpus({ seed: 555, messages: 12 })
    const over = c.turns.map((t) => ({ ...t, facts: t.facts.concat(t.heavy), heavy: [] }))
    const r = createBudgetedPrefix({ budgetTokens: 320 }).invoke(over)
    expect(r.droppedFacts).toBeGreaterThan(100)
    expect(r.retainedFacts).toBeGreaterThan(0)
    expect(r.trimmedTokens).toBeGreaterThan(0)
    expect(r.coreKept).toBe(r.coreTotal)
  })

  it('BudgetedPrefix 与 StablePrefix：Budgeted 的 suffixTokens < StablePrefix', () => {
    const c = createSyntheticCorpus({ seed: 555, messages: 16 })
    const over = c.turns.map((t) => ({ ...t, facts: t.facts.concat(t.heavy), heavy: [] }))
    const b = createBudgetedPrefix({ budgetTokens: 320 }).invoke(over)
    const s = createStablePrefix().invoke(over)
    expect(b.suffixTokens).toBeLessThan(s.suffixTokens)
  })

  it('向量表：Volatile=010 Stable=110 Budgeted=101，不存在 111（三轴现算，非查表）', () => {
    const study = promptCacheStudy({ now: () => 555 })
    expect(study.vectors.VolatilePrefix).toBe('010')
    expect(study.vectors.StablePrefix).toBe('110')
    expect(study.vectors.BudgetedPrefix).toBe('101')
    expect(Object.values(study.vectors)).not.toContain('111')
    expect(study.verdict.noUniversalWinner).toBe(true)
    expect(study.verdict.trilemmaDistinguishes).toBe(true)
    expect(study.verdict.noStrategyWinsAll).toBe(true)
    expect(study.verdict.vectorFromTrilemma).toBe(true)
  })

  it('infoFidelity 口径 = 「模型看到的世界有没有变」：Budgeted 保住核心事实却仍丢 70% 上下文 ⇒ fidelity=0', () => {
    const study = promptCacheStudy({ now: () => 555 })
    const budgeted = study.rows.find((r) => r.protocol === 'BudgetedPrefix')!
    expect(budgeted.axes.coreKeepRate).toBe(1)
    expect(budgeted.axes.factsIntact).toBe(false)
    expect(budgeted.axes.droppedFacts).toBeGreaterThan(0)
    expect(budgeted.trilemma.infoFidelity).toBe(false)
    const stable = study.rows.find((r) => r.protocol === 'StablePrefix')!
    expect(stable.axes.factsIntact).toBe(true)
    expect(stable.trilemma.infoFidelity).toBe(true)
  })

  it('四场景 × 三策略 全量有细胞；steadyReuse 命中=消息数-1；coldStart 因写缓存延迟命中更少', () => {
    const study = promptCacheStudy({ now: () => 555 })
    for (const row of study.rows) {
      expect(row.scenarios).toHaveLength(4)
      expect(row.scenarios.map((c) => c.id)).toEqual(['coldStart', 'steadyReuse', 'overBudget', 'cleanRerun'])
    }
    const stable = study.rows.find((r) => r.protocol === 'StablePrefix')!
    const warm = stable.scenarios.find((c) => c.id === 'steadyReuse')!
    const cold = stable.scenarios.find((c) => c.id === 'coldStart')!
    expect(warm.hits).toBe(95)
    expect(cold.hits).toBeLessThan(warm.hits)
    expect(cold.freshPrefixTokens).toBeGreaterThan(warm.freshPrefixTokens)
    const volatile = study.rows.find((r) => r.protocol === 'VolatilePrefix')!
    expect(volatile.scenarios.every((c) => c.hits === 0)).toBe(true)
  })

  it('cleanRerun 幂等是真跑两次比字符串得出的 true；四场景真的彼此不同', () => {
    const study = promptCacheStudy({ now: () => 555 })
    for (const row of study.rows) {
      const cell = row.scenarios.find((c) => c.id === 'cleanRerun')!
      expect(cell.rerunIdentical).toBe(true)
    }
    expect(study.verdict.scenarioDistinguishes).toBe(true)
  })

  it('不写死：两跑结果逐字一致（同 now=555）', () => {
    const a = promptCacheSnapshot(promptCacheStudy({ now: () => 555 }))
    const b = promptCacheSnapshot(promptCacheStudy({ now: () => 555 }))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('verifyPromptCacheSoundness：baseline holds=true，三路 tamper 喂回同一 holds 公式全 false', () => {
    const r = verifyPromptCacheSoundness({ seed: 555, messages: 96 })
    expect(r.baselineHolds).toBe(true)
    expect(r.holds).toBe(true)
    expect(r.falsifiable).toBe(true)
    expect(r.nontrivial).toBe(true)
    expect(r.tamper.prefixDrift.holds).toBe(false)
    expect(r.tamper.trimDisabled.holds).toBe(false)
    expect(r.tamper.factsDropped.holds).toBe(false)
    expect(r.tamper.prefixDrift.reason).toContain('prefixDrift')
    expect(r.tamper.trimDisabled.reason).toContain('trimDisabled')
    expect(r.tamper.factsDropped.reason).toContain('factsDropped')
  })

  it('三路 tamper 差异化读数：laneA 命中 95/漂移点 48、laneB retained>0 且 trimmed>0、核心事实全保', () => {
    const r = verifyPromptCacheSoundness({ seed: 555, messages: 96 })
    expect(r.laneA.hits).toBe(95)
    expect(r.laneA.driftAt).toBe(48)
    expect(r.laneA.stablePrefixPaidOnce).toBe(true)
    expect(r.laneB.retainedFacts).toBeGreaterThan(0)
    expect(r.laneB.trimmedTokens).toBeGreaterThan(0)
    expect(r.laneB.coreKeepRate).toBe(1)
  })

  it('verifyCausalLocks 三道因果锁全闭合；driftHits=0 是真跑出来的不是常量', () => {
    const c = verifyCausalLocks({})
    expect(c.prefixAffinityCausallyUnerasable).toBe(true)
    expect(c.tokenBudgetCausallyUnerasable).toBe(true)
    expect(c.factRankCausallyUnerasable).toBe(true)
    expect(c.causalLocksAllHold).toBe(true)
    expect(c.probes.stableHits).toBeGreaterThan(0)
    expect(c.probes.driftHits).toBe(0)
    expect(c.probes.trimmedFacts).toBeGreaterThan(0)
    expect(c.probes.coreTrimmedFacts).toBeGreaterThan(0)
    expect(c.probes.rankSorted).toBe(1)
  })

  it('rigged 单开 freeStablePrefix：Stable=111（前缀免费），其余不动', () => {
    const s = promptCacheStudy({ now: () => 555, rigged: true, freeStablePrefix: true })
    expect(s.vectors.StablePrefix).toBe('111')
    expect(s.vectors.VolatilePrefix).toBe('010')
    expect(s.vectors.BudgetedPrefix).toBe('101')
    expect(s.verdict.rigged).toBe(true)
    expect(s.verdict.noUniversalWinner).toBe(false)
  })

  it('rigged 单开 losslessSummaryTrim：Budgeted=111（无损摘要压缩），其余不动', () => {
    const s = promptCacheStudy({ now: () => 555, rigged: true, losslessSummaryTrim: true })
    expect(s.vectors.BudgetedPrefix).toBe('111')
    expect(s.vectors.VolatilePrefix).toBe('010')
    expect(s.vectors.StablePrefix).toBe('110')
  })

  it('rigged 单开 unlimitedBudget：Budgeted=110（fidelity 涨、效率归零）且不是收敛塌缩', () => {
    const s = promptCacheStudy({ now: () => 555, rigged: true, unlimitedBudget: true })
    expect(s.vectors.BudgetedPrefix).toBe('110')
    expect(s.verdict.riggedConvergenceCollapsed).toBe(false)
  })

  it('rigged 三开：两件策略各自被顶高，但三向量不全同 ⇒ 不构成收敛塌缩', () => {
    const s = promptCacheStudy({
      now: () => 555,
      rigged: true,
      freeStablePrefix: true,
      losslessSummaryTrim: true,
      unlimitedBudget: true,
    })
    expect(new Set(Object.values(s.vectors)).size).toBeGreaterThan(1)
    expect(s.verdict.riggedConvergenceCollapsed).toBe(false)
  })

  it('zeroTrimPenalty 是真保险：排序器反向（核心事实被优先裁）时能把核心事实救回来', () => {
    const c = createSyntheticCorpus({ seed: 555, messages: 4 })
    const over = c.turns.map((t) => ({ ...t, facts: t.facts.concat(t.heavy), heavy: [] }))
    const broken = createBudgetedPrefix({ budgetTokens: 320, invertedRank: true }).invoke(over)
    const rescued = createBudgetedPrefix({ budgetTokens: 320, invertedRank: true, zeroTrimPenalty: true }).invoke(over)
    expect(broken.coreKept).toBe(0)
    expect(rescued.coreKept).toBe(rescued.coreTotal)
  })

  it('21 件证据齐全且全为有限数', () => {
    const ev = createPromptCacheEvidence({ seed: 555, now: 0 })
    const keys = Object.keys(ev).sort()
    expect(keys).toHaveLength(21)
    for (const k of keys) expect(Number.isFinite(ev[k as keyof typeof ev])).toBe(true)
    expect(ev.ringShardsUsed).toBeGreaterThanOrEqual(1)
    expect(ev.redisBitmapHits).toBeGreaterThanOrEqual(1)
    expect(ev.walReplayed).toBe(ev.walLines)
    expect(ev.busListeners).toBe(1)
    expect(ev.notices).toBe(12)
  })

  it('Snapshot 双源同代：promptCacheSnapshot 与 study 同 builtAt / vectors', () => {
    const s = promptCacheStudy({ now: () => 424242 })
    const snap = promptCacheSnapshot(s)
    expect(snap.builtAt).toBe(424242)
    expect(snap.vectors).toEqual(s.vectors)
    expect(snap.causalLocks.causalLocksAllHold).toBe(true)
    expect(snap.crosscheck.soundness.holds).toBe(true)
    expect(snap.rows.every((r) => r.axes.hitSource === 'local-prefix-fingerprint')).toBe(true)
    expect(snap.rows.every((r) => r.axes.tokenSource === 'heuristic-estimate')).toBe(true)
  })

  it('CLI 结构快照：JSON 可解析、三行、含 verdict', () => {
    const s = promptCacheSnapshot(promptCacheStudy({ now: () => 555 }))
    expect(s.rows.map((r) => r.protocol)).toEqual(['VolatilePrefix', 'StablePrefix', 'BudgetedPrefix'])
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.config.seed).toBe(555)
  })

  it('live 通道无 key ⇒ 诚实降级、零网络请求、绝不拿结构量冒充真读数', async () => {
    const r = await runPromptCacheLive({ rounds: 2 }, { env: {} })
    expect(r.live).toBe(false)
    expect(r.skipped).toBe(true)
    expect(r.reason).toBe('missing_key')
    expect(r.hitSource).toBe('none')
    expect(r.cachedTokens).toBe(0)
    expect(r.note).toContain('未发起任何网络调用')
  })

  it('live 通道只认 cached_tokens；代理记账值单列且标注不可比；400 分流抖动自动重试并记账 attempts', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      if (calls === 1) return { status: 400, text: async () => 'bad request' }
      return {
        status: 200,
        text: async () => JSON.stringify({
          model: 'gpt-6-sol',
          choices: [{ message: { content: '价签撕了，声音还在。' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 18507, prompt_tokens_details: { cached_tokens: 3968 }, total_tokens: 18600 },
        }),
      }
    }) as unknown as typeof fetch
    const r = await runPromptCacheLive({ rounds: 1, driftLane: false }, { env: { CAESURA_LLM_API_KEY: 'sk-test-not-a-real-key' }, fetchImpl })
    expect(r.live).toBe(true)
    expect(r.skipped).toBe(false)
    expect(r.hitSource).toBe('api-usage-prompt-tokens-details-cached-tokens')
    expect(r.tokenSource).toBe('proxy-accounting-not-comparable')
    expect(r.stable!.cachedTokens).toEqual([3968])
    // 代理侧记账值如实记录，但被标注为不可比——不得当成物理量。
    expect(r.stable!.promptTokensReported).toEqual([18507])
    expect(r.stable!.attempts).toBe(2)
    expect(calls).toBe(2)
  })
})
