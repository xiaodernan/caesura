import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * KI-732 · admin 深度优化顾问（LLM 读真实遥测 + 工程健康数据给优化措施）：
 *   ① 脚本把工程健康三数据源（压测/自我改进/缓存）纳入 payload；
 *   ② 产物含 engineeringHealth 快照（可审计，非估算）；
 *   ③ 真跑产物 model=gpt-6.2-sol · 4 条 actions · 至少一条引用压测/工程健康；
 *   ④ 双拷贝产物字节一致；
 *   ⑤ 产物无密钥/端点泄露，runtime:false/authorOnly:true。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

describe('KI-732 · admin 深度优化顾问', () => {
  const script = read('scripts/ai-trend-forecast.mjs')
  const art = JSON.parse(read('admin/admin-trend-forecast.json'))

  it('脚本把三数据源纳入 payload', () => {
    expect(script).toContain('stress-fanout-latest.json')
    expect(script).toContain('ai-director-latest.json')
    expect(script).toContain('ai-cache-metrics.json')
    expect(script).toContain('【工程健康 · 现场真实数据（非估算）】')
    expect(script).toContain('含工程健康字段')
  })

  it('产物含 engineeringHealth 快照（压测/自我改进/缓存）', () => {
    const eh = art.engineeringHealth
    expect(eh).toBeTruthy()
    expect(eh.stressFanout).toBeTruthy()
    expect(eh.stressFanout.endpoints).toBeGreaterThan(90)
    expect(eh.stressFanout.failures).toBe(0)
    expect(eh.selfImprove).toBeTruthy()
    expect(typeof eh.selfImprove.roster).toBe('number')
    expect(eh.llmCache).toBeTruthy()
    expect(eh.llmCache.model).toBe('gpt-6.2-sol')
  })

  it('真跑产物：gpt-6.2-sol · 4 条 actions · 有引用压测的措施', () => {
    expect(art.model).toBe('gpt-6.2-sol')
    expect(art.mode).toBe('live')
    expect(art.actions).toHaveLength(4)
    const allText = art.actions.map((a: any) => `${a.actionZh}${a.rationaleZh}${a.riskZh}`).join('')
    // #4 引用压测：慢端点 / 传输量 / 负载
    expect(/压测|慢端点|传输量|负载|p95|p99/.test(allText)).toBe(true)
  })

  it('admin 面板展示工程健康数据源（依据透明）', () => {
    const html = read('admin/index.html')
    const js = read('admin/app.js')
    const css = read('admin/styles.css')
    expect(html).toContain('id="forecast-health"')
    expect(js).toContain("document.getElementById('forecast-health')")
    expect(js).toContain('d.engineeringHealth')
    expect(css).toContain('.forecast-health-note')
  })

  it('建议→落地闭环：action#1 标记 landed，admin 显示已落地徽章', () => {
    const a1 = art.actions.find((a: any) => a.seq === 1)
    expect(a1.landed).toBeTruthy()
    expect(a1.landed.ki).toBe('KI-733')
    expect(a1.landed.status).toBe('shipped-single-variable')
    expect(a1.landed.evidence).toContain('TitleScreen.ts')
    const js = read('admin/app.js')
    expect(js).toContain('forecast-landed')
    expect(js).toContain('a.landed')
  })

  it('双拷贝产物字节一致', () => {
    expect(read('admin/admin-trend-forecast.json')).toBe(read('src/data/authoring/admin-trend-forecast.json'))
  })

  it('产物无密钥 · authorOnly/runtime:false', () => {
    const body = read('admin/admin-trend-forecast.json')
    expect(body).not.toMatch(/sk-[A-Za-z0-9_\-]{16,}/)
    expect(art.runtime).toBe(false)
    expect(art.authorOnly).toBe(true)
    expect(art.containsCredentials).toBe(false)
  })
})
