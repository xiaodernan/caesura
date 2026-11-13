import { describe, expect, it } from 'vitest'
import {
  LLM_DEFAULTS,
  LLM_STRATEGIES,
  LLM_SCENARIOS,
  resolveApiKey,
  normalizeBaseUrl,
  derivePromptCacheKey,
  effectivePromptCacheKey,
  resetWarmPrefixes,
  normalizeUsage,
  buildChatBody,
  offlineReply,
  normalizeReply,
  callLlm,
  invokeBatch,
  llmGatewayStudy,
  verifyGatewaySoundness,
  verifyGatewayCausalLocks,
  createGatewayEvidence,
  createPromptCache,
} from '../../scripts/caesura-llm-gateway.mjs'

/** KI-538 真大模型协同网关。全部离线 mock，绝不联网、不需真 key；真连证据另见 docs/llm-voice-proof-evidence.md。 */

/** Healthy 200 响应的 mock fetch，记录每次调用数。 */
function healthyFetch(calls: { n: number } = { n: 0 }) {
  return async () => {
    calls.n += 1
    return {
      status: 200,
      text: async () => JSON.stringify({
        model: 'gpt-6-sol',
        choices: [{ message: { role: 'assistant', content: `mock-reply-${calls.n}` }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_tokens_details: { cached_tokens: 3 } },
      }),
    }
  }
}

describe('caesura-llm-gateway（KI-538）', () => {
  it('常量固定顺序 + 安全铁律：源码只从 env 读 key，base 强制带 /v1', () => {
    expect(LLM_DEFAULTS.model).toBe('gpt-6-sol')
    expect(LLM_DEFAULTS.baseUrl).toBe('https://wkapi.pro/v1')
    expect(LLM_STRATEGIES).toEqual(['OfflineDouble', 'LiveGrounded', 'CachedLive'])
    expect(LLM_SCENARIOS.length).toBe(6)
    expect(resolveApiKey({})).toBe('')
    expect(resolveApiKey({ CAESURA_LLM_API_KEY: '  sk-a  ' } as any)).toBe('sk-a')
    expect(resolveApiKey({ WKAPI_KEY: 'sk-b' } as any)).toBe('sk-b')
    expect(normalizeBaseUrl('https://wkapi.pro')).toBe('https://wkapi.pro/v1')
    expect(normalizeBaseUrl('https://wkapi.pro/v1')).toBe('https://wkapi.pro/v1')
    expect(normalizeBaseUrl('https://wkapi.pro/v1/')).toBe('https://wkapi.pro/v1')
  })

  it('buildChatBody：OpenAI 兼容结构、model/temperature/max_tokens 真注入', () => {
    const b = buildChatBody([{ role: 'user', content: 'hi' }], { model: 'gpt-6-astra', temperature: 0.3, maxTokens: 99 })
    expect(b.model).toBe('gpt-6-astra')
    expect(b.temperature).toBe(0.3)
    expect(b.max_tokens).toBe(99)
    expect((b.messages as any[])[0]).toEqual({ role: 'user', content: 'hi' })
  })

  it('offlineReply：确定性、零 token、标记 via=offline-double，绝不冒充真模型', () => {
    const msgs = [{ role: 'user', content: 'probe' }]
    const a = offlineReply(msgs, { seed: 538 })
    const b = offlineReply(msgs, { seed: 538 })
    expect(a.content).toBe(b.content)
    expect(a.mode).toBe('offline')
    expect(a.via).toBe('offline-double')
    expect(a.usage!.total_tokens).toBe(0)
    expect(a.content).toContain('非真模型输出')
    const c = offlineReply(msgs, { seed: 539 })
    expect(c.content).not.toBe(a.content) // seed 真影响 double
  })

  it('normalizeReply：非 200 / 坏 JSON / 空 content 一律 ok:false 且保留真实 status/原文', () => {
    expect(normalizeReply(401, { error: 'unauthorized' }, '401 text', {}).ok).toBe(false)
    expect(normalizeReply(429, {}, 'rate limited', {}).error).toBe('non_200')
    expect(normalizeReply(200, null, '<html>garbage</html>', {}).error).toBe('bad_json')
    expect(normalizeReply(200, { choices: [] }, '{}', {}).error).toBe('empty_content')
    const ok = normalizeReply(200, { model: 'gpt-6-sol', choices: [{ message: { content: '真回复' }, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12, prompt_tokens_details: { cached_tokens: 2 } } }, '{}', { latencyMs: 42 })
    expect(ok.ok).toBe(true)
    expect(ok.content).toBe('真回复')
    expect(ok.usage!.total_tokens).toBe(12)
    expect(ok.usage!.cached_tokens).toBe(2)
    expect(ok.latencyMs).toBe(42)
    expect(ok.finishReason).toBe('stop')
  })

  it('callLlm：offline 不联网；live 无 key 早退 missing_key 且不触碰 fetch', async () => {
    const calls = { n: 0 }
    const fetchImpl = healthyFetch(calls)
    const off = await callLlm([{ role: 'user', content: 'x' }], { mode: 'offline' }, { env: {}, fetchImpl, clock: () => 0 })
    expect(off.ok).toBe(true)
    expect(calls.n).toBe(0) // offline 零网络
    const miss = await callLlm([{ role: 'user', content: 'x' }], { mode: 'live' }, { env: {}, fetchImpl, clock: () => 0 })
    expect(miss.ok).toBe(false)
    expect(miss.error).toBe('missing_key')
    expect(calls.n).toBe(0) // 无 key 早退，不发请求
  })

  it('callLlm：live 有 key 真发一次，POST 体含 model/messages，回读 content/usage/延迟', async () => {
    const calls = { n: 0 }
    let capturedBody: any = null
    let clockT = 0
    const fetchImpl = async (_url: string, init: any) => {
      calls.n += 1
      capturedBody = JSON.parse(init.body)
      expect(init.headers.authorization).toContain('Bearer sk-test')
      return {
        status: 200,
        text: async () => JSON.stringify({ model: 'gpt-6-sol', choices: [{ message: { content: 'live-真回复' }, finish_reason: 'stop' }], usage: { total_tokens: 15, prompt_tokens_details: { cached_tokens: 3 } } }),
      }
    }
    const clock = () => { clockT += 40; return clockT }
    const r = await callLlm([{ role: 'user', content: 'hello' }], { mode: 'live', baseUrl: 'https://wkapi.pro' }, { env: { CAESURA_LLM_API_KEY: 'sk-test' }, fetchImpl, clock })
    expect(calls.n).toBe(1)
    expect(capturedBody.model).toBe('gpt-6-sol')
    expect(capturedBody.messages.length).toBe(1)
    expect(r.ok).toBe(true)
    expect(r.content).toBe('live-真回复')
    expect(r.usage!.total_tokens).toBe(15)
    expect(r.latencyMs).toBe(40)
  })

  it('invokeBatch：N 个 prompt 各发一条独立请求（修正「多人拼一条只回最后一人」缺陷）', async () => {
    const calls = { n: 0 }
    const fetchImpl = healthyFetch(calls)
    const prompts = [{ id: 'DLG_MEG', content: '梅格开场' }, { id: 'DLG_BELLTONGUE', content: '钟舌开场' }, { id: 'DLG_CORVIN', content: '科温开场' }]
    const rs = await invokeBatch(prompts, { mode: 'live' }, { env: { CAESURA_LLM_API_KEY: 'sk-test' }, fetchImpl, clock: () => 0 })
    expect(rs.length).toBe(3)
    expect(calls.n).toBe(3) // 关键：3 条独立请求
    expect(rs.map((r) => r.id)).toEqual(['DLG_MEG', 'DLG_BELLTONGUE', 'DLG_CORVIN'])
    expect(new Set(rs.map((r) => r.content)).size).toBe(3) // 三条内容各不相同，非同一条对话的最后一个回复
    for (const r of rs) expect(r.ok).toBe(true)
  })

  it('三策略三向量零查表：offline=011 / live=100 / cached=110，各由独立考场真跑现算，互异无 111', async () => {
    const env = { CAESURA_LLM_API_KEY: 'sk-test' }
    const deps = { env, fetchImpl: healthyFetch(), clock: () => 0 }
    const off = await llmGatewayStudy({ mode: 'offline', now: () => 538000, ...deps })
    const live = await llmGatewayStudy({ mode: 'live', now: () => 538000, ...deps })
    expect(off.vectors.OfflineDouble).toBe('011')
    expect(live.vectors.LiveGrounded).toBe('100')
    expect(live.vectors.CachedLive).toBe('110')
    expect(off.noUniversalWinner).toBe(true)
    expect(live.noUniversalWinner).toBe(true)
    expect(Object.values(live.vectors).every((v) => v !== '111')).toBe(true)
    expect(new Set(Object.values(live.vectors)).size).toBe(3) // 三向量互异
    expect(live.verdict.vectorFromExam).toBe(true)
    expect(live.verdict.trilemmaCrosscheck.liveGrounded).toBe(true)
    expect(live.verdict.trilemmaCrosscheck.reproducible).toBe(false)
    expect(live.verdict.trilemmaCrosscheck.zeroCost).toBe(false)
    // exams 逐策略回读真值：CachedLive 首调 grounded + 缓存命中复现，但首调计费 ⇒ zeroCost=false
    expect(live.exams.CachedLive.liveGrounded).toBe(true)
    expect(live.exams.CachedLive.reproducible).toBe(true)
    expect(live.exams.CachedLive.zeroCost).toBe(false)
    expect(live.exams.CachedLive.cacheHit).toBe(true)
  })

  it('createPromptCache：命中逐字节同一 content、cached=true、零新增 token， miss 返回 null，sizeCap 生效', () => {
    const msgs = [{ role: 'user', content: '梅格开场' }]
    const cache = createPromptCache()
    expect(cache.get(msgs)).toBeNull() // 未写入必 miss（可证伪）
    const first = { ok: true, mode: 'live' as const, status: 200, model: 'gpt-6-sol', content: '钟声落在空谷里……', finishReason: 'stop', usage: { total_tokens: 137, prompt_tokens: 100, completion_tokens: 37 }, latencyMs: 42, via: 'live' as const, rawText: null }
    expect(cache.set(msgs, first as any)).toBe(1)
    const hit = cache.get(msgs)!
    expect(hit.content).toBe(first.content) // 逐字节一致
    expect(hit.cached).toBe(true)
    expect(hit.usage!.total_tokens).toBe(0) // 命中零新增 token
    expect(cache.has(msgs)).toBe(true)
    expect(cache.get([{ role: 'user', content: '别的 prompt' }])).toBeNull()
    expect(cache.size()).toBe(1)
    const capped = createPromptCache({ sizeCap: 1 })
    capped.set(msgs, first as any)
    capped.set([{ role: 'user', content: '第二条' }], first as any)
    expect(capped.size()).toBe(1) // sizeCap 真生效
  })

  it('三难离线策略诚实不亮 grounded：无 key 时两条真连策略都 000、区分度如实塌缩，绝不冒充真连', async () => {
    const s = await llmGatewayStudy({ mode: 'offline', now: () => 538000 })
    expect(s.config.keyPresent).toBe(false)
    expect(s.vectors.LiveGrounded).toBe('000') // 无 key 诚实不亮
    expect(s.vectors.CachedLive).toBe('000')   // CachedLive 无 key 也无首调可缓存 ⇒ 诚实 000
    expect(s.trilemma.liveGrounded).toBe(false)
    expect(s.trilemma.reproducible).toBe(true)
    expect(s.trilemma.zeroCost).toBe(true)
    // 无 key 时两真连策略向量撞车 ⇒ 区分度诚实塌缩（同 KI-535/533 rigged 先例），绝不硬造 111 撑门面
    expect(s.noUniversalWinner).toBe(false)
    expect(s.trilemmaDistinguishes).toBe(false)
  })

  it('verifyGatewaySoundness：baselineHolds 先真绿，三路 tamper 真改输入喂回同一 holds 现算翻 false', async () => {
    const deps = { env: {}, fetchImpl: healthyFetch(), clock: () => 0 }
    const r = await verifyGatewaySoundness({ mode: 'offline' }, deps)
    expect(r.baselineHolds).toBe(true)
    expect(r.holds).toBe(true)
    expect(r.falsifiable).toBe(true)
    expect(r.tamper.missingKey.holds).toBe(false)
    expect(r.tamper.missingKey.error).toBe('missing_key')
    expect(r.tamper.badEndpoint.holds).toBe(false)
    expect(r.tamper.badEndpoint.error).toBe('non_200')
    expect(r.tamper.badJson.holds).toBe(false)
    expect(r.tamper.badJson.error).toBe('bad_json')
    expect(r.falsifiable).toBe(r.baselineHolds && !r.tamper.missingKey.holds && !r.tamper.badEndpoint.holds && !r.tamper.badJson.holds)
  })

  it('真连失败（401/坏响应）绝不假绿：两真连策略向量诚实 000，不把 usage=null 误读成 zeroCost=true', async () => {
    const unauthorized = async () => ({ status: 401, text: async () => JSON.stringify({ error: 'unauthorized' }) })
    const env = { CAESURA_LLM_API_KEY: 'sk-invalid' }
    const s = await llmGatewayStudy({ mode: 'live', now: () => 538000, env, fetchImpl: unauthorized, clock: () => 0 })
    expect(s.vectors.LiveGrounded).toBe('000')
    expect(s.vectors.CachedLive).toBe('000')
    expect(s.exams.LiveGrounded.trueReply!.ok).toBe(false)
    expect(s.exams.LiveGrounded.trueReply!.status).toBe(401)
    expect(s.exams.CachedLive.cacheHit).toBe(false)
    expect(s.noUniversalWinner).toBe(false) // 区分度诚实塌缩，不硬造 111 撑门面
  })

  it('网络异常真失败不假造：fetch 抛错 ⇒ ok:false error=network', async () => {
    const r = await callLlm([{ role: 'user', content: 'x' }], { mode: 'live' }, {
      env: { CAESURA_LLM_API_KEY: 'sk-test' },
      fetchImpl: async () => { throw new Error('ECONNRESET') },
      clock: () => 0,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('network')
    expect(r.content).toBe('')
    expect(r.rawText).toContain('ECONNRESET')
  })

  it('五因果锁真跑现算（含首调成本抹不掉）+ 十一真件 21 键 + 缓存命中可证伪', async () => {
    const r = verifyGatewayCausalLocks()
    expect(r.causalLocksAllHold).toBe(true)
    expect(r.offlineZeroCostCausallyUnerasable).toBe(true)
    expect(r.offlineReproducibleCausallyUnerasable).toBe(true)
    expect(r.badJsonNeverGroundedCausallyUnerasable).toBe(true)
    expect(r.cachedHitReproducibleCausallyUnerasable).toBe(true) // 缓存命中逐字节复现
    expect(r.firstCallCostCausallyUnerasable).toBe(true)          // 首调真实计费穷举命中次数都抹不掉
    expect(r.probes.aContent).toBe(r.probes.bContent)
    expect(r.probes.aTokens).toBe(0)
    expect(r.probes.firstCallTokens).toBe(137)
    expect(r.probes.cachedContent).toBe('真连首调的不可预测内容')
    expect(r.probes.costsAfterHits.every((c) => c >= 137 && c > 0)).toBe(true) // 链路成本恒 ≥ 首调
    const ev = createGatewayEvidence({ seed: 538, now: () => 538000 })
    expect(Object.keys(ev).length).toBe(21)
    expect(ev.redisBitmapHits).toBeGreaterThan(0)
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.counterSum).toBeGreaterThan(0)
    expect(ev.bucketRejected).toBeGreaterThan(0)
  })

  it('CachedLive 真连座：首调真发一次 + 缓存命中不再发请求，且首调计费抹不掉 zeroCost', async () => {
    const calls = { n: 0 }
    const fetchImpl = healthyFetch(calls)
    const env = { CAESURA_LLM_API_KEY: 'sk-test' }
    // 直接 import 的 examOf 是内部的，这里通过 llmGatewayStudy 的 exams.CachedLive 回读真值。
    const s = await llmGatewayStudy({ mode: 'live', now: () => 538000, env, fetchImpl, clock: () => 0 })
    // 真发 3 次 = LiveGrounded 座 1 次 + CachedLive 首调 1 次 + verifyGatewaySoundness 的 live baseline 1 次。
    // 关键判据：CachedLive 二调若错误地也真连 ⇒ calls 会变 4；命中走缓存不发 fetch ⇒ 恒 3。
    expect(calls.n).toBe(3)
    expect(s.exams.CachedLive.cacheHit).toBe(true)
    expect(s.exams.CachedLive.reproducible).toBe(true)
    expect(s.exams.CachedLive.zeroCost).toBe(false) // 首调 real usage 抹不掉
    expect(s.vectors.CachedLive).toBe('110')
  })

  it('llmGatewayStudy 固定时钟双跑结果字节一致（离线可复现）', async () => {
    const a = await llmGatewayStudy({ now: () => 538000 })
    const b = await llmGatewayStudy({ now: () => 538000 })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  /* ================= KI-538 修订 · 前缀缓存与流式双通道真值护栏（2026-11-13） ================= */

  it('derivePromptCacheKey：锚在稳定 system ⇒ 同前缀同 key；system 变则换 key；≤64 字符', () => {
    const a = derivePromptCacheKey([{ role: 'system', content: 'S1' }, { role: 'user', content: 'u1' }])
    const b = derivePromptCacheKey([{ role: 'system', content: 'S1' }, { role: 'user', content: 'u2' }])
    const c = derivePromptCacheKey([{ role: 'system', content: 'S2' }, { role: 'user', content: 'u1' }])
    // 关键：user 正文每次都变，key 必须**不变**（亲和路由靠 system 锚定；锚在 user 上等于每次换主机、缓存归零）。
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a.length).toBeLessThanOrEqual(64)
    // 显式覆盖优先。
    expect(derivePromptCacheKey([{ role: 'user', content: 'x' }], { promptCacheKey: 'my-fixed-key' })).toBe('my-fixed-key')
  })

  it('buildChatBody **默认注入** prompt_cache_key（2026-11-14 最终定案）；显式可关', () => {
    const msgs = [{ role: 'system', content: 'S' }, { role: 'user', content: 'u' }]
    // 【最终定案 2026-11-14 · 三轮实验】默认注入的理由**不是**「它能提高命中率」——
    // 实测（同一条前缀、注不注入、顺序对消）稳态命中率**两侧都是 4/4**，key 对命中率没有影响。
    // 它是**路由亲和**优化：把逐字节稳定的前缀钉在同一台缓存主机，减少被分到冷后端的概率。
    // 真正决定命中率的三个抓手是：① 前缀跨过 ≥2 个完整 1024 块；② 预热（首调必 miss）；③ 抖动自愈重试。
    expect(buildChatBody(msgs, {}).prompt_cache_key).toBe(derivePromptCacheKey(msgs))
    // 显式关闭的三种写法。
    expect(buildChatBody(msgs, { promptCacheKey: false }).prompt_cache_key).toBeUndefined()
    expect(buildChatBody(msgs, { promptCacheKey: 'off' }).prompt_cache_key).toBeUndefined()
    expect(buildChatBody(msgs, { promptCacheKey: 'none' }).prompt_cache_key).toBeUndefined()
    // 没有 system 锚点时**不注入**：退路锚点（首条消息前 512 字符）每轮都变，拿它当亲和键等于每轮换主机。
    expect(buildChatBody([{ role: 'user', content: 'u' }], {}).prompt_cache_key).toBeUndefined()
    // 显式指定仍然优先。
    expect(buildChatBody(msgs, { promptCacheKey: true }).prompt_cache_key).toBe(derivePromptCacheKey(msgs))
    expect(buildChatBody(msgs, { promptCacheKey: 'fixed-key' }).prompt_cache_key).toBe('fixed-key')
  })

  it('effectivePromptCacheKey：默认注入 / 显式关 / 无稳定锚点不注入 / 显式串优先', () => {
    const msgs = [{ role: 'system', content: 'S' }, { role: 'user', content: 'u' }]
    expect(effectivePromptCacheKey(msgs, {})).toBe(derivePromptCacheKey(msgs))
    expect(effectivePromptCacheKey(msgs, { promptCacheKey: false })).toBe(null)
    expect(effectivePromptCacheKey(msgs, { promptCacheKey: 'off' })).toBe(null)
    expect(effectivePromptCacheKey([{ role: 'user', content: 'u' }], {})).toBe(null)
    expect(effectivePromptCacheKey(msgs, { promptCacheKey: 'abc' })).toBe('abc')
  })

  it('降级重试：端点不认 prompt_cache_key（400）⇒ 自动去掉它再试一次并如实标记', async () => {
    const calls = { n: 0, bodies: [] as any[] }
    const fetchImpl = async (_url: string, init: any) => {
      calls.n += 1
      const body = JSON.parse(init.body)
      calls.bodies.push(body)
      if (body.prompt_cache_key) {
        // 端点不认识这个参数 ⇒ 400（这是「默认注入」必须带的安全阀）
        return { status: 400, text: async () => 'unsupported parameter: prompt_cache_key' }
      }
      return {
        status: 200,
        text: async () => JSON.stringify({ model: 'gpt-6-sol', choices: [{ message: { content: '降级后成功' }, finish_reason: 'stop' }], usage: { total_tokens: 9, prompt_tokens_details: { cached_tokens: 0 } } }),
      }
    }
    const msgs = [{ role: 'system', content: 'S' }, { role: 'user', content: 'u' }]
    const r = await callLlm(msgs, { mode: 'live', baseUrl: 'https://wkapi.pro' }, { env: { CAESURA_LLM_API_KEY: 'sk-test' }, fetchImpl, clock: () => 0 })
    expect(r.ok).toBe(true)
    expect(r.content).toBe('降级后成功')
    expect(calls.n).toBe(2)
    expect(calls.bodies[0].prompt_cache_key).toBe(derivePromptCacheKey(msgs))
    expect(calls.bodies[1].prompt_cache_key).toBeUndefined()
    expect((r as any).degradedWithoutCacheKey).toBe(true)
    expect(r.attempts).toBe(2)
  })

  /**
   * 【路由抖动自愈 · 2026-11-14】真机实测 T1 烤热段 `[0,24146,24146,0,0,24146]`：
   * 同一条前缀偶发被代理分到冷后端 ⇒ `cached_tokens` 直接归零（同时 `prompt_tokens` 从 24189 掉到 6696）。
   * ⇒ 暖过的前缀命中归零时重试并取命中最高的一次；**首轮冷启动不重试**（那是正常现象，重试是白花钱）。
   */
  it('cacheMissRetry：暖过的前缀命中归零 ⇒ 重试取命中最高的一次；首轮冷启动绝不重试', async () => {
    resetWarmPrefixes()
    const calls = { n: 0 }
    const fetchImpl = async () => {
      calls.n += 1
      // 第 1 次：冷启动（命中 0）；第 2 次：命中（暖）；第 3 次：被分到冷后端（命中 0）；第 4 次：命中
      const cached = calls.n === 1 || calls.n === 3 ? 0 : 4096
      return {
        status: 200,
        text: async () => JSON.stringify({
          model: 'gpt-6-sol',
          choices: [{ message: { content: `r${calls.n}` }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 4200, total_tokens: 4201, prompt_tokens_details: { cached_tokens: cached } },
        }),
      }
    }
    const msgs = [{ role: 'system', content: 'S' }, { role: 'user', content: 'u' }]
    const opts = { mode: 'live', baseUrl: 'https://wkapi.pro', cacheMissRetry: 2 }
    const deps = { env: { CAESURA_LLM_API_KEY: 'sk-test' }, fetchImpl, clock: () => 0 }

    // 首轮：冷启动 ⇒ 命中 0 是正常的，**不重试**（只发 1 次）
    const cold = await callLlm(msgs, opts, deps)
    expect(calls.n).toBe(1)
    expect(cold.cachedTokens).toBe(0)
    expect((cold as any).cacheMissRetries).toBe(0)

    // 第二轮：命中 ⇒ 记为「这条前缀暖过」
    const warm = await callLlm(msgs, opts, deps)
    expect(calls.n).toBe(2)
    expect(warm.cachedTokens).toBe(4096)

    // 第三轮：被分到冷后端（命中 0）⇒ 触发自愈重试，第 4 次命中 ⇒ 取命中最高的那次
    const healed = await callLlm(msgs, opts, deps)
    expect(calls.n).toBe(4)
    expect(healed.cachedTokens).toBe(4096)
    expect((healed as any).cacheMissRetries).toBe(1)
    expect(healed.attempts).toBe(2)
    resetWarmPrefixes()
  })

  it('cacheMissRetry 关闭（默认）时绝不自己多发请求——代价必须由调用方显式开启', async () => {
    resetWarmPrefixes()
    const calls = { n: 0 }
    const fetchImpl = async () => {
      calls.n += 1
      const cached = calls.n === 1 ? 0 : 4096
      return {
        status: 200,
        text: async () => JSON.stringify({
          model: 'gpt-6-sol', choices: [{ message: { content: 'x' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 4200, total_tokens: 4201, prompt_tokens_details: { cached_tokens: cached } },
        }),
      }
    }
    const msgs = [{ role: 'system', content: 'S2' }, { role: 'user', content: 'u' }]
    const deps = { env: { CAESURA_LLM_API_KEY: 'sk-test' }, fetchImpl, clock: () => 0 }
    await callLlm(msgs, { mode: 'live', baseUrl: 'https://wkapi.pro' }, deps)
    await callLlm(msgs, { mode: 'live', baseUrl: 'https://wkapi.pro' }, deps)
    // 第二次本应命中；即使命中归零，默认也不自愈
    const third = await callLlm(msgs, { mode: 'live', baseUrl: 'https://wkapi.pro' }, deps)
    expect(calls.n).toBe(3)
    expect((third as any).cacheMissRetries).toBe(0)
    resetWarmPrefixes()
  })

  it('normalizeUsage：容忍 prompt_tokens_details 整体缺失；cache_hit_rate 现算，绝不写死', () => {
    expect(normalizeUsage(null)).toBe(null)
    const hit = normalizeUsage({ prompt_tokens: 1000, completion_tokens: 10, total_tokens: 1010, prompt_tokens_details: { cached_tokens: 250 } })
    expect(hit!.cached_tokens).toBe(250)
    expect(hit!.cache_hit_rate).toBe(0.25)
    // 未命中时整个 prompt_tokens_details 缺失（实测真现象）⇒ 0，且绝不 NaN。
    const miss = normalizeUsage({ prompt_tokens: 1000, completion_tokens: 10, total_tokens: 1010 })
    expect(miss!.cached_tokens).toBe(0)
    expect(miss!.cache_hit_rate).toBe(0)
    // prompt_tokens=0 ⇒ 绝不能除零。
    expect(normalizeUsage({ total_tokens: 0 })!.cache_hit_rate).toBe(0)
  })

  it('【BUG 回归护栏】非流式真拿到 cached_tokens ⇒ cached 必须为 true（历史被硬覆写成 false）', async () => {
    const fetchImpl = async () => ({
      status: 200,
      text: async () => JSON.stringify({
        model: 'gpt-6-sol',
        choices: [{ message: { content: 'hit' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1000, completion_tokens: 5, total_tokens: 1005, prompt_tokens_details: { cached_tokens: 900 } },
      }),
    })
    const r = await callLlm([{ role: 'user', content: 'q' }], { mode: 'live' }, { env: { CAESURA_LLM_API_KEY: 'sk-test' }, fetchImpl })
    expect(r.ok).toBe(true)
    // 这条正是「命中了却被自己盖掉」那个 bug 的专属护栏：历史上此处恒 false。
    expect(r.cached).toBe(true)
    expect(r.cachedTokens).toBe(900)
    expect(r.usage!.cache_hit_rate).toBe(0.9)
  })

  it('流式与非流式 usage 同源可比：流式 cachedTokens/命中率先读真值（deps.fetchImpl 在流式通道生效）', async () => {
    const sse =
      'data: ' + JSON.stringify({ choices: [{ delta: { content: '流' } }] }) + '\n\n' +
      'data: ' + JSON.stringify({ usage: { prompt_tokens: 1000, completion_tokens: 5, total_tokens: 1005, prompt_tokens_details: { cached_tokens: 700 } } }) + '\n\n' +
      'data: [DONE]\n\n'
    const fetchImpl = async () => ({ status: 200, text: async () => sse })
    const r = await callLlm([{ role: 'user', content: 'q' }], { mode: 'live', stream: true }, { env: { CAESURA_LLM_API_KEY: 'sk-test' }, fetchImpl })
    expect(r.via).toBe('live-stream')
    expect(r.content).toBe('流')
    expect(r.cached).toBe(true)
    expect(r.cachedTokens).toBe(700)
    // 与非流式同一套字段 ⇒ 判定层可交叉印证。
    expect(r.usage!.cache_hit_rate).toBe(0.7)
    expect(Object.keys(r.usage!).sort()).toEqual(['cache_hit_rate', 'cached_tokens', 'completion_tokens', 'prompt_tokens', 'prompt_tokens_details', 'total_tokens'])
  })

  it('流式分支必须透传 deps.fetchImpl（此前自行解析 env ⇒ 注入完全失效、测试不可控）', async () => {
    const calls = { n: 0 }
    const fetchImpl = async () => {
      calls.n += 1
      return { status: 200, text: async () => 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'x' } }] }) + '\n\ndata: [DONE]\n\n' }
    }
    const r = await callLlm([{ role: 'user', content: 'q' }], { mode: 'live', stream: true }, { env: { CAESURA_LLM_API_KEY: 'sk-test' }, fetchImpl })
    expect(calls.n).toBe(1)
    expect(r.ok).toBe(true)
  })

  // ── 代理分流抖动重试（KI-555 受控实测 2026-11-14 的直接代码根因）────────────────
  // 实测：wkapi.pro 在 Chat Completions 与 Responses 两种后端间分流，落到只认 input/prompt 的
  // Responses 后端时**稳定**返回 400，且与请求长度/内容语言**都无关** ⇒ 400 是分流抖动，不是格式错。
  // 于是「一次 400 就判失败」会把本可成功的调用记成失败 ⇒ 真连通道必须对 400 重试并记账。
  it('400（代理分流抖动）必须重试且记账 attempts：实测同一请求体第一次 400、第二次 200 且命中真值被读出', async () => {
    const calls = { n: 0 }
    const fetchImpl = async () => {
      calls.n += 1
      if (calls.n === 1) {
        return { status: 400, text: async () => JSON.stringify({ error: { message: 'One of "input" or "previous_response_id" or \'prompt\' or \'conversation\' must be provided.' } }) }
      }
      return {
        status: 200,
        text: async () => JSON.stringify({
          model: 'gpt-6-sol',
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1000, completion_tokens: 5, total_tokens: 1005, prompt_tokens_details: { cached_tokens: 900 } },
        }),
      }
    }
    const r = await callLlm([{ role: 'user', content: 'q' }], { mode: 'live' }, { env: { CAESURA_LLM_API_KEY: 'sk-test' }, fetchImpl })
    expect(calls.n).toBe(2)
    expect(r.ok).toBe(true)
    expect(r.attempts).toBe(2)
    // 重试成功后命中真值照样被读出（不能因为重试就丢掉 cached 读数）。
    expect(r.cached).toBe(true)
    expect(r.cachedTokens).toBe(900)
    expect(r.usage!.cache_hit_rate).toBe(0.9)
  })

  it('401/5xx 不重试：如实失败、attempts=1（免得把配额压力放大成重试风暴）', async () => {
    const calls = { n: 0 }
    const fetchImpl = async () => {
      calls.n += 1
      return { status: 401, text: async () => '{"error":"unauthorized"}' }
    }
    const r = await callLlm([{ role: 'user', content: 'q' }], { mode: 'live' }, { env: { CAESURA_LLM_API_KEY: 'sk-test' }, fetchImpl })
    expect(calls.n).toBe(1)
    expect(r.ok).toBe(false)
    expect(r.status).toBe(401)
    expect(r.error).toBe('non_200')
    expect(r.attempts).toBe(1)
  })
})
