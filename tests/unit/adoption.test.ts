import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { adoption, pctOrDash, TELEMETRY_CAPACITY } from '../../admin/adoption.mjs'

/**
 * KI-739 · 功能采纳读数。
 *
 * 这一屏最容易出的三种假：**空表算成 0%**、**窗口当全量**、**样本薄就下结论**。
 * 前两条由纯函数直接钉住；第三条钉 `confident`（分母不够就别谈比率）。
 */

const ev = (type: string, extra: Record<string, unknown> = {}) => ({ type, t: 1, ...extra })

describe('KI-739 · adoption() 的基本读数', () => {
  it('空表就是空表：不编最深层，不编比率（比率是 null 不是 0）', () => {
    const a = adoption([])
    expect(a.sample).toBe(0)
    expect(a.opens).toBe(0)
    expect(a.deepest).toBe(0)
    expect(a.opensPerView).toBeNull()
    expect(a.confident).toBe(false)
    expect(a.echoes.total).toBe(0)
    expect(a.floors).toEqual([])
  })

  it('非数组 / 垃圾条目一律不吃（埋点通道谁都能调，读数层必须先自保）', () => {
    for (const bad of [null, undefined, 'x', 42, {}]) {
      expect(adoption(bad as unknown).sample).toBe(0)
    }
    const a = adoption([null, 1, 'x', {}, { type: 5 }, ev('descend-open', { dep: 3 })])
    expect(a.opens).toBe(1)
    expect(a.deepest).toBe(3)
  })

  it('最深一层取三种事件里最大的 dep（乱序也算得对）', () => {
    const a = adoption([
      ev('descend-floor', { dep: 7 }),
      ev('descend-open', { dep: 2 }),
      ev('descend-act', { dep: 11 }),
      ev('descend-floor', { dep: 7 }),
    ])
    expect(a.deepest).toBe(11)
    expect(a.descents).toBe(2)
    expect(a.acts).toBe(1)
  })

  it('层直方图按深度降序（同一层多次只占一行）', () => {
    const a = adoption([
      ev('descend-floor', { dep: 3 }), ev('descend-floor', { dep: 3 }),
      ev('descend-floor', { dep: 9 }), ev('descend-floor', { dep: 5 }),
    ])
    expect(a.floors).toEqual([{ dep: 9, count: 1 }, { dep: 5, count: 1 }, { dep: 3, count: 2 }])
  })

  it('拾遗按区聚合、按次数降序；缺 region 的落 (unknown) 而不是消失', () => {
    const a = adoption([
      ev('echo-shown', { region: 'ostlara' }),
      ev('echo-shown', { region: 'ostlara' }),
      ev('echo-shown', { region: 'whisper-wood' }),
      ev('echo-shown'),
    ])
    expect(a.echoes.total).toBe(4)
    expect(a.echoes.regions[0]).toEqual({ region: "ostlara", count: 2 })
    expect(a.echoes.regions.map((r) => r.region)).toContain('(unknown)')
  })
})

describe('KI-739 · 分母与窗口的诚实边界', () => {
  it('有浏览才谈比率：10 次浏览 2 次开深处 = 0.2', () => {
    const events = [ev('descend-open'), ev('descend-open'), ...Array.from({ length: 10 }, () => ev('pageview'))]
    const a = adoption(events)
    expect(a.pageviews).toBe(10)
    expect(a.opensPerView).toBeCloseTo(0.2, 10)
    expect(a.confident).toBe(false) // 样本仍薄
  })

  it('二十次浏览起才 confident（之前只报计数）', () => {
    const build = (n: number) => Array.from({ length: n }, () => ev('pageview'))
    expect(adoption(build(19)).confident).toBe(false)
    expect(adoption(build(20)).confident).toBe(true)
  })

  it('缓冲满了要自报「这是窗口不是全量」', () => {
    const full = Array.from({ length: TELEMETRY_CAPACITY }, () => ev('pageview'))
    expect(adoption(full).windowed).toBe(true)
    expect(adoption(full.slice(1)).windowed).toBe(false)
  })

  it('pctOrDash：null / NaN → 「—」；真值 → 一位小数百分号', () => {
    expect(pctOrDash(null)).toBe('—')
    expect(pctOrDash(Number.NaN)).toBe('—')
    expect(pctOrDash(0)).toBe('0.0%')
    expect(pctOrDash(0.1234)).toBe('12.3%')
  })
})

describe('KI-739 · 三处接线同源（埋点 → 纯函数 → 页面）', () => {
  const read = (p: string) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8')

  it('环形缓冲容量两边逐字一致（400 改一处、另一处不跟着改就会谎报全量）', () => {
    const tracker = read('public/tracker.js')
    expect(tracker).toContain('doc.events.length > 400')
    expect(TELEMETRY_CAPACITY).toBe(400)
  })

  it('埋点通道的 meta 是白名单：只认 dep / region / q，别的字段写不进去', () => {
    const tracker = read('public/tracker.js')
    expect(tracker).toContain('meta.dep')
    expect(tracker).toContain('meta.region')
    expect(tracker).toContain('meta.q')
    // 反例守卫：不许把整个 meta 摊进事件（那是通用上传口，不是埋点）
    expect(/Object\.assign\(\s*ev\s*,\s*meta/.test(tracker)).toBe(false)
    expect(/ev\[[^\]]*k[^\]]*\]\s*=\s*meta/.test(tracker)).toBe(false)
  })

  it('游戏侧真的在记这三件事（打开深处 / 下一层 / 拾遗出现）', () => {
    const main = read('src/main.ts')
    expect(main).toContain("track('descend-open'")
    expect(main).toContain("track('echo-shown'")
    const panel = read('src/ui/DescendPanel.ts')
    expect(panel).toContain("'descend-floor'")
    expect(panel).toContain("'descend-act'")
  })

  it('后台页面真的画了这块（容器 + 渲染函数 + 首屏调用）', () => {
    const html = read('admin/index.html')
    expect(html).toContain('id="adoption-stats"')
    expect(html).toContain('id="adoption-regions"')
    const app = read('admin/app.js')
    expect(app).toContain('function renderAdoption()')
    expect(app).toContain('renderLive(); renderAdoption();')
  })
})
