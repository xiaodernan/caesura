import { describe, expect, it, vi } from 'vitest'
import { callLlm, buildBibleMessages, warmupPrefix, NPC_BIBLE, SHORT_BIBLE } from '../../scripts/caesura-llm-client.mjs'
import { estimateTokens } from '../../scripts/caesura-prompt-cache.mjs'

/** LLM 统一 client 缓存上下文（KI-538 增补）： stream + stream_options.include_usage + 稳定 NPC_BIBLE system prefix。 */

describe('caesura-llm-client caesura-llm-cacheFix', () => {
  it('NPC_BIBLE / SHORT_BIBLE 结构性断言（NPC-BIBLE 是稳定 system 前缀，需 >1024 tokens 以满足 OpenAI prompt caching 断点）', () => {
    expect(NPC_BIBLE.length).toBeGreaterThan(1000)
    expect(SHORT_BIBLE.length).toBeGreaterThan(80)
    expect(NPC_BIBLE).toContain('NPC 对白编剧')
    expect(NPC_BIBLE).toContain('绝不把 NPC 的名字')
    expect(NPC_BIBLE).toContain('DLG_MEG')
    expect(NPC_BIBLE).toContain('DLG_BELLTONGUE')
    expect(NPC_BIBLE).toContain('DLG_CORVIN')
  })

  /**
   * 【2026-11-14 真机实测根因护栏】前缀缓存按 **1024 token 块**粒度复用。
   * 旧版 `NPC_BIBLE` 只有 628 token = **0.61 块** ⇒ 连一个完整块都凑不齐 ⇒ 整段前缀根本没法被复用。
   * 这才是「缓存命中率这么低」的**头号根因**（不是 cache key、也不是流式）。⇒ 必须跨过 ≥2 个完整块。
   */
  it('NPC_BIBLE 必须跨过 ≥2 个完整的 1024-token 块（实测根因：旧版 0.61 块根本没法复用）', () => {
    const t = estimateTokens(NPC_BIBLE)
    expect(t).toBeGreaterThanOrEqual(2048)
    expect(Math.floor(t / 1024)).toBeGreaterThanOrEqual(2)
    // 诚实记录旧版读数，防止有人把它改回去
    expect(estimateTokens(SHORT_BIBLE)).toBeLessThan(1024)
  })

  it('buildBibleMessages 返回 stream:true · stream_options.include_usage:true · system first', () => {
    const m = buildBibleMessages({ npcMode: 'canon', user: '测试 1 句' })
    expect(m.stream).toBe(true)
    expect(m.stream_options).toEqual({ include_usage: true })
    expect(m.messages[0].role).toBe('system')
    expect(m.messages[0].content).toBe(NPC_BIBLE)
    expect(m.messages[1].role).toBe('user')
    expect(m.temperature).toBe(0.72)
  })

  /**
   * 【路由亲和 ≠ 命中率开关】实测（同前缀、注不注入、顺序对消）稳态命中率都是 4/4
   * ⇒ key 只负责把前缀钉在同一台缓存主机。默认注入以保持客户端/网关同源；显式可关。
   */
  it('buildBibleMessages 默认注入亲和路由键；显式 cacheKey:false 可关（它不是命中率开关）', () => {
    const on = buildBibleMessages({ npcMode: 'canon', user: 'x' })
    expect(on.prompt_cache_key).toBeTruthy()
    expect(String(on.prompt_cache_key).length).toBeLessThanOrEqual(64)
    // 同前缀 ⇒ 同键（逐字节稳定）
    const again = buildBibleMessages({ npcMode: 'canon', user: '别的 user 正文' })
    expect(again.prompt_cache_key).toBe(on.prompt_cache_key)
    const off = buildBibleMessages({ npcMode: 'canon', user: 'x', cacheKey: false })
    expect('prompt_cache_key' in off).toBe(false)
  })

  it('buildBibleMessages npcMode=short 则 system 是 SHORT_BIBLE', () => {
    const m = buildBibleMessages({ npcMode: 'short', user: 'ok' })
    expect(m.messages[0].content).toBe(SHORT_BIBLE)
  })

  it('callLlm 非 key 抛错（缺 env 时 friendly，而不是 fetch 谜之 401）', async () => {
    const orig = process.env.CAESURA_LLM_API_KEY
    delete process.env.CAESURA_LLM_API_KEY
    try {
      await expect(callLlm(buildBibleMessages({ user: 'x' }))).rejects.toThrow(/missing CAESURA_LLM_API_KEY/)
    } finally {
      if (orig !== undefined) process.env.CAESURA_LLM_API_KEY = orig
    }
  })

  it('warmupPrefix 无 key ⇒ 零网络请求的诚实降级（绝不拿离线结构量冒充真读数）', async () => {
    const orig = process.env.CAESURA_LLM_API_KEY
    delete process.env.CAESURA_LLM_API_KEY
    const fetchMock = vi.fn(async () => { throw new Error('不该发请求') }) as any
    const origFetch = globalThis.fetch
    ;(globalThis as any).fetch = fetchMock
    try {
      const r = await warmupPrefix({ rounds: 2 })
      expect(r.skipped).toBe(true)
      expect(r.reason).toBe('missing_key')
      expect(r.cachedTokens).toEqual([])
      expect(r.warm).toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      (globalThis as any).fetch = origFetch
      if (orig !== undefined) process.env.CAESURA_LLM_API_KEY = orig
    }
  })

  it('warmupPrefix 真跑：只认 cached_tokens；首调必 miss、第 2 轮起命中（warmupRounds 如实现算）', async () => {
    process.env.CAESURA_LLM_API_KEY = 'sk-test-mock'
    let n = 0
    const fetchMock = vi.fn(async () => {
      n += 1
      // 首调 0（代理写缓存有延迟），之后命中 2100。
      const cached = n === 1 ? 0 : 2100
      return {
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            const enc = new TextEncoder()
            const events = [
              'data: ' + JSON.stringify({ choices: [{ delta: { content: '热' } }] }) + '\n\n',
              'data: ' + JSON.stringify({ usage: { prompt_tokens: 2200, completion_tokens: 1, total_tokens: 2201, prompt_tokens_details: { cached_tokens: cached } } }) + '\n\n',
              'data: [DONE]\n\n',
            ]
            for (const e of events) controller.enqueue(enc.encode(e))
            controller.close()
          },
        }),
      }
    }) as any
    const origFetch = globalThis.fetch
    ;(globalThis as any).fetch = fetchMock
    try {
      const r = await warmupPrefix({ rounds: 3 })
      expect(r.skipped).toBe(false)
      expect(r.cachedTokens).toEqual([0, 2100, 2100])
      expect(r.warmupRounds).toBe(2)
      expect(r.warm).toBe(true)
      expect(r.promptTokensReported).toEqual([2200, 2200, 2200])
      expect(fetchMock).toHaveBeenCalledTimes(3)
    } finally {
      (globalThis as any).fetch = origFetch
    }
  })

  it('callLlm mock 流 → usage 中的 cached_tokens 被正确暴露（不是 0）', async () => {
    process.env.CAESURA_LLM_API_KEY = 'sk-test-mock'
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          const enc = new TextEncoder()
          const events = [
            'data: ' + JSON.stringify({ id: 'gen-1', object: 'chat.completion.chunk', choices: [{ delta: { content: '测' } }] }) + '\n\n',
            'data: ' + JSON.stringify({ usage: { prompt_tokens: 500, completion_tokens: 80, total_tokens: 580, prompt_tokens_details: { cached_tokens: 400 } } }) + '\n\n',
            'data: [DONE]\n\n',
          ]
          for (const e of events) controller.enqueue(enc.encode(e))
          controller.close()
        },
      }),
    })) as any
    const origFetch = globalThis.fetch
    ;(globalThis as any).fetch = fetchMock
    try {
      const out = await callLlm(buildBibleMessages({ user: 'x', maxTokens: 20 }))
      expect(out.ok).toBe(true)
      expect(out.status).toBe(200)
      expect(out.text).toBe('测')
      // usage 契约扩展：新增 cached_tokens / cache_hit_rate 为**现算真值**（非命中时 prompt_tokens_details 整个缺失也必须容忍）。
      expect(out.usage).toEqual({
        prompt_tokens: 500,
        completion_tokens: 80,
        total_tokens: 580,
        prompt_tokens_details: { cached_tokens: 400 },
        cached_tokens: 400,
        cache_hit_rate: 0.8,
      })
      expect(out.cachedTokens).toBe(400)
      expect(out.cacheHitRate).toBe(0.8)
    } finally {
      (globalThis as any).fetch = origFetch
    }
  })
})
