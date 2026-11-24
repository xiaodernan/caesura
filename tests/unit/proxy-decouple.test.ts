import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyAuthorProxyFromEnv } from '../../scripts/caesura-llm-client.mjs'

/**
 * KI-746 · 与 Clash Verge 解绑（用户明确要求：不用 Clash，走正常网络）：
 *   ① 父进程残留 HTTPS_PROXY/HTTP_PROXY（Clash 7897）时，作者侧 client 仍**直连**——
 *      这是 ECONNREFUSED 的根因：旧版读通用代理变量，Clash 没开就报连不上 127.0.0.1:7897；
 *   ② 只有显式设项目专用 CAESURA_LLM_PROXY 才走代理（用户完全掌控，opt-in）；
 *   ③ 源码里不再内置 Clash 代理主机常量（LLM_DEFAULT_PROXY 已移除）；
 *   ④ 两个 .d.mts 类型声明与实现同步（via='proxy'、无 LLM_DEFAULT_PROXY）；
 *   ⑤ 玩家侧源码零代理痕迹（游戏运行不受影响）。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

describe('KI-746 · 与 Clash Verge 解绑，走正常网络', () => {
  it('① 父进程带 Clash 残留代理变量 ⇒ 仍直连（不再 ECONNREFUSED）', async () => {
    const r = await applyAuthorProxyFromEnv({
      HTTPS_PROXY: 'http://127.0.0.1:7897',
      https_proxy: 'http://127.0.0.1:7897',
      HTTP_PROXY: 'http://127.0.0.1:7897',
      http_proxy: 'http://127.0.0.1:7897',
    } as never)
    expect(r.via).toBe('direct')
    expect(r.proxy).toBeUndefined()
  })

  it('② 只有显式 CAESURA_LLM_PROXY 才 opt-in 走代理', async () => {
    const r = await applyAuthorProxyFromEnv({ CAESURA_LLM_PROXY: 'http://127.0.0.1:7897' } as never)
    expect(r.via).toBe('proxy')
    expect(r.proxy).toBe('http://127.0.0.1:7897')
    // 副作用清理：把全局 dispatcher 还原成直连，避免坏代理 socket 影响同 fork 后续测试
    try {
      const { setGlobalDispatcher, Agent } = await import('undici')
      setGlobalDispatcher(new Agent())
    } catch { /* undici 不可用时忽略 */ }
  })

  it('③ client 源码不再读通用系统代理变量（注释里说明为何忽略是允许的）', () => {
    const src = read('scripts/caesura-llm-client.mjs')
    expect(src).not.toMatch(/env\.(HTTPS_PROXY|https_proxy|HTTP_PROXY|http_proxy)/)
    expect(src).toContain('const proxy = env.CAESURA_LLM_PROXY')
    // 代理仅来自 opt-in 的项目专用变量：两个读取点都只读 CAESURA_LLM_PROXY
    expect(src.match(/env\.CAESURA_LLM_PROXY/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('④ 移除内置代理常量 + 类型声明同步', () => {
    expect(read('scripts/caesura-author-env.mjs')).not.toContain('LLM_DEFAULT_PROXY')
    expect(read('scripts/caesura-author-env.d.mts')).not.toContain('LLM_DEFAULT_PROXY')
    const d = read('scripts/caesura-llm-client.d.mts')
    expect(d).toContain("via: 'direct' | 'proxy'")
    expect(d).not.toContain('clash-proxy')
  })

  it('⑤ 玩家侧源码零代理痕迹（关掉 API/Clash 不影响游戏）', () => {
    const s = read('src/main.ts')
    expect(s).not.toMatch(/aizzz|CAESURA_LLM|chat\/completions|127\.0\.0\.1:7897|HTTPS_PROXY/)
  })

  it('⑥ env.example 默认不启用 Clash 代理（代理行须注释掉）', () => {
    const ex = read('env.example')
    const active = ex.split('\n').filter((l) => /^\s*CAESURA_LLM_PROXY\s*=/.test(l))
    expect(active, 'env.example 里 CAESURA_LLM_PROXY 应默认注释').toHaveLength(0)
  })
})
