/**
 * tests/unit/llm-author-env.test.ts — 作者侧 LLM env 入口（.env 旧名回落，KI-587 修法）
 * 纪律：不碰网络、不碰真密钥；只测读法与回落优先级。
 */
import { describe, expect, it } from 'vitest'
import {
  AUTHOR_ENV_KEYS,
  LLM_DEFAULT_BASE_URL,
  LLM_DEFAULT_MODEL,
  LLM_DEFAULT_MISSING_KEY,
  authorLlmKey,
  authorLlmEnv,
} from '../../scripts/caesura-author-env.mjs'

describe('authorLlmEnv · 优先级与回落（KI-587）', () => {
  it('CAESURA_* 全部齐全 ⇒ 精确使用', () => {
    const r = authorLlmEnv({
      CAESURA_LLM_API_KEY: 'sk-test-1',
      CAESURA_LLM_BASE_URL: 'https://example.test/v1',
      CAESURA_LLM_MODEL: 'some-model',
    })
    expect(r).toEqual({ apiKey: 'sk-test-1', baseUrl: 'https://example.test/v1', model: 'some-model' })
  })
  it('只有旧名 LLM_* ⇒ 回落生效（不再静默走空 key）', () => {
    const r = authorLlmEnv({ LLM_API_KEY: 'sk-legacy', LLM_BASE_URL: 'https://legacy.test/v1', LLM_MODEL: 'legacy-model' })
    expect(r).toEqual({ apiKey: 'sk-legacy', baseUrl: 'https://legacy.test/v1', model: 'legacy-model' })
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
    expect(r).toEqual({ apiKey: 'sk-new', baseUrl: 'https://new.test/v1', model: 'new-model' })
  })
  it('全空 ⇒ baseUrl/model 回落默认，key 为空串', () => {
    const r = authorLlmEnv({})
    expect(r).toEqual({ apiKey: '', baseUrl: LLM_DEFAULT_BASE_URL, model: LLM_DEFAULT_MODEL })
  })
  it('空格/全空串 ⇒ 视为未设，回落默认', () => {
    const r = authorLlmEnv({ CAESURA_LLM_BASE_URL: '   ', CAESURA_LLM_MODEL: '' })
    expect(r.baseUrl).toBe(LLM_DEFAULT_BASE_URL)
    expect(r.model).toBe(LLM_DEFAULT_MODEL)
  })
  it('whitespace-only key 保留（空白也是 key，我们不替调用方裁剪）', () => {
    expect(authorLlmKey({ CAESURA_LLM_API_KEY: '  ', LLM_API_KEY: 'sk-keep' })).toBe('  ')
    expect(authorLlmKey({ LLM_API_KEY: 'sk-keep' })).toBe('sk-keep')
    expect(authorLlmKey({})).toBe('')
  })
  it('AUTHOR_ENV_KEYS 只列新名（旧名是回落，不是规范面）', () => {
    expect([...AUTHOR_ENV_KEYS].sort()).toEqual(['CAESURA_LLM_API_KEY', 'CAESURA_LLM_BASE_URL', 'CAESURA_LLM_MODEL'])
  })
  it('默认缺 key 文案住在模块里（给 CLI 报人话用）', () => {
    expect(LLM_DEFAULT_MISSING_KEY.length).toBeGreaterThan(10)
    expect(LLM_DEFAULT_MISSING_KEY).toContain('CAESURA_LLM_API_KEY')
  })
})
