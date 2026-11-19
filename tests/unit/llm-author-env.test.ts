/**
 * tests/unit/llm-author-env.test.ts — 作者侧 LLM env 入口（.env 旧名回落，KI-587 修法）
 * 纪律：不碰网络、不碰真密钥；只测读法与回落优先级（KI-710 · 有序模型兜底链 2026-11-19 落，
 *        aizzz 分组 GPT特价 下 gpt-6.1-terra 无可用渠道 → 503；链顺移 + 如实记账，绝不静默换模型）。
 */
import { describe, expect, it } from 'vitest'
import {
  AUTHOR_ENV_KEYS,
  LLM_DEFAULT_BASE_URL,
  LLM_DEFAULT_MODEL,
  LLM_DEFAULT_MODEL_CHAIN,
  LLM_DEFAULT_MISSING_KEY,
  authorLlmKey,
  authorLlmEnv,
  resolveModelChain,
} from '../../scripts/caesura-author-env.mjs'

describe('authorLlmEnv · 优先级与回落（KI-587）', () => {
  it('CAESURA_* 全部齐全 ⇒ 精确使用（首选用户指定 · 后接默认链）', () => {
    const r = authorLlmEnv({
      CAESURA_LLM_API_KEY: 'sk-test-1',
      CAESURA_LLM_BASE_URL: 'https://example.test/v1',
      CAESURA_LLM_MODEL: 'some-model',
    })
    expect(r).toEqual({
      apiKey: 'sk-test-1',
      baseUrl: 'https://example.test/v1',
      model: 'some-model',
      modelChain: ['some-model', 'gpt-6.1-terra', 'gpt-6.1-sol', 'gpt-6.2-sol', 'gpt-5.6-terra'],
    })
  })
  it('只有旧名 LLM_* ⇒ 回落生效（不再静默走空 key）', () => {
    const r = authorLlmEnv({ LLM_API_KEY: 'sk-legacy', LLM_BASE_URL: 'https://legacy.test/v1', LLM_MODEL: 'legacy-model' })
    expect(r.model).toBe('legacy-model')
    expect(r.baseUrl).toBe('https://legacy.test/v1')
    expect(r.modelChain[0]).toBe('legacy-model')
  })
  it('CAESURA_* 与 LLM_* 同时存在 ⇒ CAESURA_* 优先（不被旧名抢走）', () => {
    const r = authorLlmEnv({
      CAESURA_LLM_API_KEY: 'sk-new',
      LLM_API_KEY: 'sk-old',
      CAESURA_LLM_BASE_URL: 'https://new.test/v1',
      LLM_BASE_URL: 'https://old.test/v1',
      CAESURA_LLM_MODEL: 'new-model',
      LLM_MODEL: 'old-model',
    })
    expect(r.apiKey).toBe('sk-new')
    expect(r.baseUrl).toBe('https://new.test/v1')
    expect(r.model).toBe('new-model')
    expect(r.modelChain[0]).toBe('new-model')
  })
  it('全空 ⇒ baseUrl/model 回落默认，key 为空串，链 = 默认链', () => {
    const r = authorLlmEnv({})
    expect(r.apiKey).toBe('')
    expect(r.baseUrl).toBe(LLM_DEFAULT_BASE_URL)
    expect(r.model).toBe(LLM_DEFAULT_MODEL)
    expect(r.modelChain).toEqual([...LLM_DEFAULT_MODEL_CHAIN])
  })
  it('空格/全空串 ⇒ 视为未设，回落默认', () => {
    const r = authorLlmEnv({ CAESURA_LLM_BASE_URL: '   ', CAESURA_LLM_MODEL: '' })
    expect(r.baseUrl).toBe(LLM_DEFAULT_BASE_URL)
    expect(r.model).toBe(LLM_DEFAULT_MODEL)
    expect(r.modelChain).toEqual([...LLM_DEFAULT_MODEL_CHAIN])
  })
  it('whitespace-only key 保留（空白也是 key，我们不替调用方裁剪）', () => {
    expect(authorLlmKey({ CAESURA_LLM_API_KEY: '  ', LLM_API_KEY: 'sk-keep' })).toBe('  ')
    expect(authorLlmKey({ LLM_API_KEY: 'sk-keep' })).toBe('sk-keep')
    expect(authorLlmKey({})).toBe('')
  })
  it('AUTHOR_ENV_KEYS 只列新名（旧名是回落，不是规范面）', () => {
    expect([...AUTHOR_ENV_KEYS].sort()).toEqual(['CAESURA_LLM_API_KEY', 'CAESURA_LLM_BASE_URL', 'CAESURA_LLM_MODEL', 'CAESURA_LLM_MODELS'])
  })
  it('默认缺 key 文案住在模块里（给 CLI 报人话用）', () => {
    expect(LLM_DEFAULT_MISSING_KEY.length).toBeGreaterThan(10)
    expect(LLM_DEFAULT_MISSING_KEY).toContain('CAESURA_LLM_API_KEY')
  })
})

describe('resolveModelChain · 有序模型兜底链（KI-710）', () => {
  it('CAESURA_LLM_MODELS 优先：逗号列表原样生效（去重 · 去空格）', () => {
    expect(resolveModelChain({ CAESURA_LLM_MODELS: 'a, b ,c, a' })).toEqual(['a', 'b', 'c'])
    expect(resolveModelChain({ CAESURA_LLM_MODELS: ' , ', CAESURA_LLM_MODEL: 'solo' })).toEqual(['solo', 'gpt-6.1-terra', 'gpt-6.1-sol', 'gpt-6.2-sol', 'gpt-5.6-terra'])
  })
  it('未设 MODELS ⇒ 首选（CAESURA>LLM）后接默认链，首选不重复', () => {
    expect(resolveModelChain({ CAESURA_LLM_MODEL: 'gpt-6.1-terra' })).toEqual([...LLM_DEFAULT_MODEL_CHAIN])
    expect(resolveModelChain({ LLM_MODEL: 'legacy-x' })).toEqual(['legacy-x', 'gpt-6.1-terra', 'gpt-6.1-sol', 'gpt-6.2-sol', 'gpt-5.6-terra'])
  })
  it('全空 ⇒ 整条默认链（首选 = terra）', () => {
    expect(resolveModelChain({})).toEqual([...LLM_DEFAULT_MODEL_CHAIN])
    expect(resolveModelChain({})[0]).toBe(LLM_DEFAULT_MODEL)
  })
})
