/**
 * tests/unit/llm-degrade-contract.test.ts —— **大模型 API 关闭后的降级契约**（KI-745）。
 *
 * 背景：作者侧大模型 API（aizzz / gpt-6.2-sol）已关闭 ⇒ 后续开发**不能再依赖它**。
 * 这个测试把「关掉之后不许坏」写成**契约**，而不是靠人记得别去调它。
 *
 * 它量的是五件事（每条都是实跑，不靠推理）：
 *   ① 缺 key ⇒ `callLlm` 抛**可识别**的错（`err.code === 'missing_key'`），
 *      不是一句含糊的网络错误（上层要能据此区分「没配」与「配了但不通」）；
 *   ② 上游 5xx / 404（API 关掉就是这个形状）⇒ 调用方拿到 `{ ok:false, status }`，
 *      **不是未捕获的异常**；
 *   ③ 网络层直接断（代理没开）⇒ 抛出**可捕获**的异常（上层能兜）；
 *   ④ **缓存账本与 latest 产物在失败后必须原样不动**
 *      —— 这是 KI-745 抓到的两个真缺陷：
 *        · `--live` 而 API 关着 ⇒ 账本被写进一行全是 0 的"命中记录"，
 *          把「≈90% 命中」这条曲线往下拽，admin 页还会把它当真实测量展示；
 *        · offline 干跑 ⇒ 把真实 live 产物覆盖成空（audit=null / transitions=[]），
 *          从 git 历史里都看不出是被抹掉的。
 *      ⇒ 守卫：**live 且至少一次调用成功**才许写账本；**只有 live 且成功**才许覆盖 latest。
 *   ⑤ 玩家侧（游戏运行时）与作者侧**彻底隔开** —— 关掉 API 不影响游戏。
 *
 * 纪律：不碰网络、不碰真密钥；`fetchImpl` 一律注入假的。
 */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { callLlm } from '../../scripts/caesura-llm-client.mjs'

const ROOT = resolve(__dirname, '../..')
const METRICS = resolve(ROOT, 'src/data/authoring/ai-cache-metrics.json')
const LATEST = resolve(ROOT, 'src/data/authoring/ai-director-latest.json')

/** 跑 ai-director，绝不碰网络（缺 key ⇒ 立刻 missing_key），并返回账本是否被动过 */
function runDirector(extraArgs: string[] = []) {
  const before = readFileSync(METRICS, 'utf8')
  const beforeLatest = existsSync(LATEST) ? readFileSync(LATEST, 'utf8') : null
  let status = 0
  try {
    execFileSync(process.execPath, ['scripts/ai-director.mjs', ...extraArgs], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, CAESURA_LLM_API_KEY: '', LLM_API_KEY: '' },
      stdio: 'pipe',
      timeout: 60_000,
    })
  } catch (e) {
    status = (e as { status?: number }).status ?? 1
  }
  return {
    status,
    metricsChanged: readFileSync(METRICS, 'utf8') !== before,
    latestChanged: beforeLatest === null ? null : readFileSync(LATEST, 'utf8') !== beforeLatest,
  }
}

describe('LLM 降级契约（KI-745 · API 已关闭）', () => {
  it('① 缺 key ⇒ 抛可识别的 missing_key（上层能区分“没配”与“通了但坏了”）', async () => {
    const saved = process.env.CAESURA_LLM_API_KEY
    delete process.env.CAESURA_LLM_API_KEY
    delete process.env.LLM_API_KEY
    try {
      await expect(
        callLlm({ messages: [{ role: 'user', content: 'x' }] }),
      ).rejects.toMatchObject({ code: 'missing_key' })
    } finally {
      if (saved !== undefined) process.env.CAESURA_LLM_API_KEY = saved
    }
  })

  it('② 上游 5xx ⇒ { ok:false, status } （不是未捕获异常）', async () => {
    const r = await callLlm(
      { messages: [{ role: 'user', content: 'x' }] },
      {
        apiKey: 'test-key-not-real',
        baseUrl: 'https://example.invalid/v1',
        fetchImpl: async () => ({ ok: false, status: 502, text: async () => 'Bad Gateway' }),
      },
    )
    expect(r.ok).toBe(false)
    expect(r.status).toBe(502)
  })

  it('②b 上游 404（端点没了）⇒ { ok:false, status:404 }', async () => {
    const r = await callLlm(
      { messages: [{ role: 'user', content: 'x' }] },
      {
        apiKey: 'test-key-not-real',
        baseUrl: 'https://example.invalid/v1',
        fetchImpl: async () => ({ ok: false, status: 404, text: async () => 'Not Found' }),
      },
    )
    expect(r.ok).toBe(false)
    expect(r.status).toBe(404)
  })

  it('③ 网络层直接断（代理没开）⇒ 抛可捕获的异常，不是悄悄返回空文本', async () => {
    let thrown: unknown = null
    try {
      await callLlm(
        { messages: [{ role: 'user', content: 'x' }] },
        {
          apiKey: 'k',
          baseUrl: 'https://example.invalid/v1',
          fetchImpl: async () => { throw new Error('fetch failed') },
        },
      )
    } catch (e) {
      thrown = e
    }
    expect(thrown).not.toBeNull()
  })

  it('④ --live 而 API 关着 ⇒ 干净失败退出，且缓存账本与 latest 产物原样不动', () => {
    const r = runDirector(['--live'])
    // 失败要看得见：非零码
    expect(r.status).not.toBe(0)
    // 账本不得被写进一行全是 0 的“命中记录”
    expect(r.metricsChanged).toBe(false)
    // 真实产物不得被覆盖成空
    expect(r.latestChanged).toBe(false)
  })

  it('④b offline 干跑 ⇒ 退出 0，且同样不覆盖缓存账本与 latest 产物', () => {
    const r = runDirector([])
    expect(r.status).toBe(0)
    expect(r.metricsChanged).toBe(false)
    expect(r.latestChanged).toBe(false)
  })

  it('⑤ 玩家侧源码里没有任何作者侧 API 调用痕迹（关掉 API 不影响游戏）', () => {
    const candidates = ['src/main.ts', 'src/game.ts', 'src/core/game.ts'].filter((p) =>
      existsSync(resolve(ROOT, p)),
    )
    expect(candidates.length).toBeGreaterThan(0)
    for (const p of candidates) {
      const s = readFileSync(resolve(ROOT, p), 'utf8')
      expect(s).not.toMatch(/aizzz|CAESURA_LLM|chat\/completions/)
    }
  })

  it('⑤b 缓存账本与 latest 产物都声明为作者侧（runtime:false），不进玩家运行时', () => {
    const metrics = JSON.parse(readFileSync(METRICS, 'utf8'))
    expect(metrics.runtime).toBe(false)
    expect(metrics.containsCredentials).toBe(false)
    const latest = JSON.parse(readFileSync(LATEST, 'utf8'))
    expect(latest.runtime).toBe(false)
    expect(latest.authorOnly).toBe(true)
    expect(latest.containsCredentials).toBe(false)
  })
})
