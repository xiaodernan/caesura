import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { registerGameData } from '@/data'
import { AUTOSAVE_SLOT, type SlotCard } from '@/save/Slots'
import type { TitleHooks } from '@/ui/TitleScreen'

/**
 * KI-653（KI-645 行动 #1 · 趋势研判裁决）：首屏 Start 固定可见按钮。
 *
 * 裁决原文：「为首页首屏增加固定可见的开始按钮，并记录曝光与按下事件；以按下率达到百分之六十四为验收」。
 * 这里钉住的是能被机器验收的每一小格：
 *   ① 按钮随定弦屏一起渲染（fixed 常亮定位的 CSS 也钉）；
 *   ② 曝光（quickstart-shown）只记一次，重渲染不重复记账；
 *   ③ 按下（quickstart-press）= 以**当前聚焦的弦**（聚焦在「续」时落回第一根弦）立刻开场；
 *   ④ 埋点通道缺失 / 埋点抛错 ⇒ 屏照常工作（埋点永远不许弄坏产品本体）；
 *   ⑤ Lang.ts 双语双键齐备；⑥ tracker.js 暴露 __caesuraTrack 且零网络；⑦ admin 本机实况有两格。
 */
class FakeEl {
  id = ''
  innerHTML = ''
  textContent = ''
  dataset: Record<string, string> = {}
  children: FakeEl[] = []
  parent: FakeEl | null = null
  private classes = new Set<string>()
  handlers: Record<string, ((e: unknown) => void)[]> = {}
  classList = {
    add: (c: string) => { this.classes.add(c) },
    remove: (c: string) => { this.classes.delete(c) },
    contains: (c: string) => this.classes.has(c)
  }
  appendChild(c: FakeEl): FakeEl { c.parent = this; this.children.push(c); return c }
  remove(): void {
    if (!this.parent) return
    this.parent.children = this.parent.children.filter((x) => x !== this)
    this.parent = null
  }
  addEventListener(t: string, fn: (e: unknown) => void): void { (this.handlers[t] ??= []).push(fn) }
  dispatch(t: string, e: unknown): void { for (const fn of this.handlers[t] ?? []) fn(e) }
  closest(): FakeEl | null { return this.dataset.act ? this : null }
}

let body: FakeEl
let g: Record<string, unknown>
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

const read = (): SlotCard[] => [{
  slot: AUTOSAVE_SLOT, kind: 'auto', state: 'ok', schemaVersion: 10,
  migrated: false, fromKey: null, problem: null,
  data: { rank: 4, originId: 'origin_tuner', weaponId: 'wp_tuning_sword', regionId: null, playSec: 120, savedAt: 1770000000000, hp: 60, corruption: 0, questsStarted: 1, questsCompleted: 0 }
}, ...['slot1', 'slot2', 'slot3'].map((s) => ({
  slot: s, kind: 'manual' as const, state: 'empty' as const, schemaVersion: null,
  migrated: false, fromKey: null, problem: null, data: null
}))]
/** 一个可读的档都没有（全空槽）——这才是一键 Start 应当直接开弦的场景 */
const readEmpty = (): SlotCard[] => [AUTOSAVE_SLOT, 'slot1', 'slot2', 'slot3'].map((s) => ({
  slot: s, kind: (s === AUTOSAVE_SLOT ? 'auto' : 'manual') as 'auto' | 'manual',
  state: 'empty' as const, schemaVersion: null, migrated: false, fromKey: null, problem: null, data: null
}))
const hooks = (news: string[], roster: () => SlotCard[] = read): TitleHooks => ({
  onNew: (id) => { news.push(id) },
  onContinue: () => {},
  listSlots: async () => roster()
})

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

const clickAct = (root: FakeEl, act: string, arg = ''): void => {
  const el = new FakeEl()
  el.dataset = { act, arg }
  root.dispatch('click', { target: el })
}

beforeAll(() => {
  registerGameData()
  body = new FakeEl()
  g = globalThis as unknown as Record<string, unknown>
  g.document = {
    createElement: () => new FakeEl(),
    head: new FakeEl(),
    body,
    getElementById: () => new FakeEl()
  }
  g.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    __caesuraTrack: undefined as unknown
  }
})

afterAll(() => {
  // 还原窗口上的通道，避免污染同文件其它用例
  ;(g.window as Record<string, unknown>).__caesuraTrack = undefined
})

describe('KI-653 · 首屏 Start 固定按钮（KI-645 行动 #1）', () => {
  it('按钮随定弦屏一起渲染：固定定位常亮、双语 aria-label、data-act="qs-start"', async () => {
    const { TitleScreen } = await import('@/ui/TitleScreen')
    const t = new TitleScreen(hooks([]))
    const html = (t as unknown as { root: FakeEl }).root.innerHTML
    expect(html).toContain('data-act="qs-start"')
    expect(html).toContain('class="qs-start"')
    expect(html).toContain('aria-label=')
    expect(html).toContain('type="button"')
  })

  it('曝光 quickstart-shown 只记一次（构造上屏 + 之后再渲染都不重复记账）', async () => {
    const { TitleScreen } = await import('@/ui/TitleScreen')
    const calls: string[] = []
    ;(g.window as Record<string, unknown>).__caesuraTrack = (t: string) => { calls.push(t) }
    const t = new TitleScreen(hooks([]))
    await tick() // 名册回来会再 render() 一轮
    ;(t as unknown as { render(): void }).render()
    expect(calls.filter((c) => c === 'quickstart-shown')).toHaveLength(1)
  })

  it('按下 quickstart-press = 无可续档时以聚焦的弦立刻开场，并记账 quickstart-press', async () => {
    const { TitleScreen, titleCards } = await import('@/ui/TitleScreen')
    const news: string[] = []
    const calls: string[] = []
    ;(g.window as Record<string, unknown>).__caesuraTrack = (t: string) => { calls.push(t) }
    const t = new TitleScreen(hooks(news, readEmpty))
    await tick()
    clickAct((t as unknown as { root: FakeEl }).root, 'qs-start')
    expect(news).toEqual([titleCards()[0].id])
    expect(calls).toContain('quickstart-press')
  })

  it('有可读档时按下 Start：与点卡同语义——进入确认屏，绝不越过防误删（§45）', async () => {
    const { TitleScreen } = await import('@/ui/TitleScreen')
    const news: string[] = []
    const t = new TitleScreen(hooks(news, read))
    await tick()
    clickAct((t as unknown as { root: FakeEl }).root, 'qs-start')
    expect(news).toEqual([])
    expect((t as unknown as { mode: string }).mode).toBe('confirm')
  })

  it('聚焦在「续」时按下 Start：落回第一根弦（Start 的语义，不误触存档；无可续档直开）', async () => {
    const { TitleScreen, titleCards } = await import('@/ui/TitleScreen')
    const news: string[] = []
    const t = new TitleScreen(hooks(news, readEmpty))
    await tick()
    ;(t as unknown as { focus: { kind: string; index: number } }).focus = { kind: 'continue', index: 0 }
    clickAct((t as unknown as { root: FakeEl }).root, 'qs-start')
    expect(news).toEqual([titleCards()[0].id])
  })

  it('埋点通道缺失 ⇒ 屏照常工作（onNew 照样触发）', async () => {
    const { TitleScreen, titleCards } = await import('@/ui/TitleScreen')
    const news: string[] = []
    ;(g.window as Record<string, unknown>).__caesuraTrack = undefined
    const t = new TitleScreen(hooks(news, readEmpty))
    await tick()
    clickAct((t as unknown as { root: FakeEl }).root, 'qs-start')
    expect(news).toEqual([titleCards()[0].id])
  })

  it('埋点抛错 ⇒ 屏照常工作（埋点永远不许弄坏产品本体）', async () => {
    const { TitleScreen, titleCards } = await import('@/ui/TitleScreen')
    const news: string[] = []
    ;(g.window as Record<string, unknown>).__caesuraTrack = () => { throw new Error('telemetry on fire') }
    const t = new TitleScreen(hooks(news, readEmpty))
    await tick()
    clickAct((t as unknown as { root: FakeEl }).root, 'qs-start')
    expect(news).toEqual([titleCards()[0].id])
  })

  it('CSS：.qs-start 固定定位 + 常亮 z-index（不随内容流动）', () => {
    const src = readFileSync(resolve(ROOT, 'src/ui/TitleScreen.ts'), 'utf8')
    expect(src).toMatch(/#title \.qs-start\{position:fixed/)
    expect(src).toMatch(/#title \.qs-start\{[^}]*z-index:70/)
    expect(src).toContain('prefers-reduced-motion')
  })

  it('Lang.ts：quickstart 双语三键（zh + en 两表都在）', () => {
    const src = readFileSync(resolve(ROOT, 'src/i18n/Lang.ts'), 'utf8')
    for (const k of ['ui.title.quickstart', 'ui.title.quickstart.hint', 'ui.title.tip.quickstart']) {
      expect(src.split(`'${k}':`).length - 1, `missing: ${k}`).toBeGreaterThanOrEqual(2)
    }
    expect(src).toContain('直接入场')
    expect(src).toContain('ENTER THE WORLD')
  })

  it('tracker.js：暴露 __caesuraTrack；默认零网络，真人上报须显式 opt-in（KI-720）', () => {
    const src = readFileSync(resolve(ROOT, 'public/tracker.js'), 'utf8')
    expect(src).toContain('__caesuraTrack')
    expect(src).not.toMatch(/XMLHttpRequest/)
    expect(src).toContain('window.__caesuraLiveTelemetry')
    const gate = src.indexOf('if (!live.enabled || typeof window.fetch')
    expect(gate).toBeGreaterThan(-1)
    expect(src.indexOf('window.fetch(live.endpoint')).toBeGreaterThan(gate)
  })

  it('admin 本机实况：Start 曝光/按下两格真读数（不是装饰）', () => {
    const src = readFileSync(resolve(ROOT, 'admin/app.js'), 'utf8')
    expect(src).toContain('qsShown')
    expect(src).toContain('qsPress')
    expect(src).toContain("quickstart-shown")
    expect(src).toContain("quickstart-press")
  })
})
