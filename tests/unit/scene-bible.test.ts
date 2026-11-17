import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildSceneBible,
  sceneBible,
  sceneBibleHash,
  sceneBibleCacheKey,
  sceneBibleStats,
  readWarmMarker,
  writeWarmMarker,
  ROOT,
} from '../../scripts/lib/scene-bible.mjs'

/**
 * KI-663（用户对缓存命中率/上下文利用率的深问）：
 *   为什么 Codex 能稳在 ~90% 命中、为什么它的请求里装得下 50k–90k 上下文 —— 答案在字节级稳定的巨前缀。
 *   本模块钉住「场景圣经」巨前缀的每一条可机器验收的性质。
 *
 *   ① 体量 ≥ 50k tokens 量级（approxTokens ≥ 38000）；
 *   ② sha256 幂等熵（跨进程、跨请求、跨并行会话同一哈希）；
 *   ③ 前缀字节**不含任何易变数据**（无 KI 号/日期/时刻/sha —— 那些一律走 user 消息）；
 *   ④ 世界谱 74 条 + 余响集三十三篇全文都在；包含最新篇目（《秤旁》/《未刻之数》）；
 *   ⑤ cacheKey 形如 caesura-scene-<32 位 hex>，且由哈希派生；
 *   ⑥ stats 同口径（loreEntries=74 · atlasChapters=32 · containsVolatileDrift=false）；
 *   ⑦ 单飞 marker 读写往返（并行会话共享热身位置）；
 *   ⑧ 中英双语双在（中文标题 + English canon 地名/英文名都在文）。
 */
describe('KI-663 · 场景圣经巨前缀（scripts/lib/scene-bible.mjs）', () => {
  it('体量够大：buildSceneBible ≥ 150 KB，approxTokens ≥ 38k', () => {
    const s = buildSceneBible()
    expect(Buffer.byteLength(s, 'utf8')).toBeGreaterThan(150 * 1024)
    expect(sceneBibleStats().approxTokens).toBeGreaterThanOrEqual(38000)
    expect(sceneBible()).toBe(s) // sceneBible() 缓存同一串（非新函数重算）
  })

  it('sha256 幂等：两次构建同一哈希（字节级稳定 → 跨进程/跨会话可复用缓存）', () => {
    const h1 = sceneBibleHash()
    const h2 = sceneBibleHash()
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[a-f0-9]{64}$/)
  })

  it('我自己加的静态头不含易变字节（来源内容允许 canon 里的历史日期——那是正典自己的坐标）', () => {
    const head = sceneBible().slice(0, sceneBible().indexOf('【世界谱'))
    expect(head).not.toMatch(/\bKI-\d{3,}\b/)
    expect(head).not.toMatch(/\b202\d-\d{2}-\d{2}\b/)
    expect(head).not.toMatch(/\bT\d{2}:\d{2}:\d{2}/)
    expect(sceneBibleStats().containsVolatileDrift).toBe(false)
  })

  it('内容完整：世界谱 74 条 + 余响集三十三篇（与 src/ui/atlas-texts.ts 同源）', () => {
    const st = sceneBibleStats()
    expect(st.loreEntries, '世界谱条目应来自 codex.json 的 74 条').toBe(74)
    expect(st.atlasChapters, '余响集全文条目应等于 atlas 的 33 篇').toBe(33)
    expect(sceneBible()).toContain('未刻之数')
    expect(sceneBible()).toContain('秤旁')
    expect(sceneBible()).toContain('秤旁 / Beside the Scale')
    expect(sceneBible()).toContain('空处之后')
    expect(sceneBible()).toContain('休垒')
  })

  it('cacheKey 形如 caesura-scene-<32hex> 且派生自 sceneBibleHash 前缀', () => {
    const key = sceneBibleCacheKey()
    expect(key).toMatch(/^caesura-scene-[a-f0-9]{32}$/)
    expect(key).toBe(`caesura-scene-${sceneBibleHash().slice(0, 32)}`)
  })

  it('双语双在（中文标题 · 中文正文 · English canon 名）', () => {
    const s = sceneBible()
    expect(s).toContain('余响集')
    expect(s).toContain('The Arcade of Echoes') // canon 地名原文
    expect(s).toContain('世界谱')
    expect(s).toContain('Resthold') // 世界谱 EN 地名原文
  })

  it('stats 同口径（version · bytes · atlas/lore 计数 · 无漂移）', () => {
    const st = sceneBibleStats()
    expect(st.version).toBe('v1')
    expect(st.bytes).toBeGreaterThan(150 * 1024)
    expect(st.loreEntries).toBe(74)
    expect(st.atlasChapters).toBe(33)
  })

  it('单飞 marker 读写往返（并行会话共享热身位置 · 写后可读 · 测完删掉不污染真环境）', () => {
    const ok = writeWarmMarker({ calls: 1, cachedTokens: [1], statuses: [200], note: 'scene-bible test marker' })
    expect(ok).toBe(true)
    const m = readWarmMarker()
    expect(m).toBeTruthy()
    expect(Number(m?.calls)).toBe(1)
    expect(Array.isArray(m?.statuses)).toBe(true)
    expect(m?.statuses?.[0]).toBe(200)
    // 测试完成后删除 marker：避免测试污染真线的并行会话（未删除 → 真实 warmup 被误跳过）
    const marker = resolve(ROOT, '.scratch', `scene-bible-${sceneBibleHash().slice(0, 16)}.warm`)
    try { if (existsSync(marker)) rmSync(marker) } catch { /* noop */ }
    expect(readWarmMarker(), 'marker 必须在清理后不存在').toBe(null)
  })

  it('SCENE_BIBLE 结尾无残余 </p> 等标签碎片（atlas body 标签已剥离）', () => {
    const s = sceneBible()
    expect(s).not.toContain('<p class="coda">The plank did not record the blank.</p>')
    expect(s).toContain('The plank did not record the blank.')
  })
})
