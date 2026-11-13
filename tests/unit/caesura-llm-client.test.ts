import { describe, expect, it, vi } from 'vitest'
import { callLlm, buildBibleMessages, NPC_BIBLE, SHORT_BIBLE } from '../../scripts/caesura-llm-client.mjs'

/** LLM 统一 client 缓存上下文（KI-538 增补）： stream + stream_options.include_usage + 稳定 NPC_BIBLE system prefix。 */

function makeSseStream(bytes: string[]) {
  const enc = new TextEncoder()
  const body = bytes.map((b) => (typeof b === 'string' ? enc.encode(b + '\n\n') : b))
  const stream = new ReadableStream({
    start(controller) {
      for (const b of body) controller.enqueue(b)
      controller.close()
    },
  })
  return body[0] as Uint8Array & ReadableStream | null as any
}

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

  it('buildBibleMessages 返回 stream:true · stream_options.include_usage:true · system first', () => {
    const m = buildBibleMessages({ npcMode: 'canon', user: '测试 1 句' })
    expect(m.stream).toBe(true)
    expect(m.stream_options).toEqual({ include_usage: true })
    expect(m.messages[0].role).toBe('system')
    expect(m.messages[0].content).toBe(NPC_BIBLE)
    expect(m.messages[1].role).toBe('user')
    expect(m.temperature).toBe(0.72)
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
      expect(out.usage).toEqual({ prompt_tokens: 500, completion_tokens: 80, total_tokens: 580, prompt_tokens_details: { cached_tokens: 400 } })
      expect(out.cachedTokens).toBe(400)
    } finally {
      (globalThis as any).fetch = origFetch
    }
  })
})
