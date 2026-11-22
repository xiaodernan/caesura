import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerGameData } from '@/data'
import { AUTOSAVE_SLOT, type SlotCard } from '@/save/Slots'
import type { TitleHooks } from '@/ui/TitleScreen'

/**
 * KI-656（KI-645 行动 #2 · 趋势研判裁决）：世界入口直达游记与谱册的可见入口。
 *
 * 裁决原文：「在世界入口增加直达游记与谱册的可见入口；以进入世界后打开率达到百分之五十为验收」。
 * 这里钉住机器可验收的每一格：
 *   ① 定弦屏（世界入口）渲染两条真 <a>：游记（余响集全集）+ 世界谱（CAESURA Codex）；
 *   ② Lang.ts zh/en 两表都有这四个键；
 *   ③ CSS 常亮 fixed 定位 + focus-visible 键盘可达；
 *   ④ 点击 anthology 链接 ⇒ __caesuraTrack('title-link-anthology')（且**不**误触开局）；
 *   ⑤ 点击 codex 链接 ⇒ __caesuraTrack('title-link-codex')（且**不**误触开局）；
 *   ⑥ main.ts 新局分支（if (!slot)）里多一条进入世界后的指路（ui.notify.atlasCodex）+ inworld-atlas-hint 记账。
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

const EMPTY_ROSTER = (): SlotCard[] => [AUTOSAVE_SLOT, 'slot1', 'slot2', 'slot3'].map((s) => ({
  slot: s, kind: (s === AUTOSAVE_SLOT ? 'auto' : 'manual') as 'auto' | 'manual',
  state: 'empty' as const, schemaVersion: null, migrated: false, fromKey: null, problem: null, data: null
}))

const hooks = (news: string[]): TitleHooks => ({
  onNew: (id) => { news.push(id) },
  onContinue: () => {},
  listSlots: async () => EMPTY_ROSTER()
})

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

const clickAct = (root: FakeEl, act: string): void => {
  const el = new FakeEl()
  el.dataset = { act }
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
  ;(g.window as Record<string, unknown>).__caesuraTrack = undefined
})

describe('KI-656 · 世界入口直达游记与谱册（KI-645 行动 #2）', () => {
  it('定弦屏渲染两条直达链接（游记→余响集 · 世界谱→Codex · 真 <a> + aria-label）', async () => {
    const { TitleScreen } = await import('@/ui/TitleScreen')
    const t = new TitleScreen(hooks([]))
    const html = (t as unknown as { root: FakeEl }).root.innerHTML
    expect(html).toContain('qs-links')
    expect(html).toContain('href="/caesura/story/anthology/"')
    expect(html).toContain('href="/caesura/codex/"')
    expect(html).toContain('data-act="goto-anthology"')
    expect(html).toContain('data-act="goto-codex"')
    expect(html).toContain('aria-label=')
  })

  it('KI-733 · 首屏三条直达链接含 guide（LLM 优化建议 #1 减流失单变量）', async () => {
    const { TitleScreen } = await import('@/ui/TitleScreen')
    const t = new TitleScreen(hooks([]))
    const html = (t as unknown as { root: FakeEl }).root.innerHTML
    expect(html).toContain('href="/caesura/tutorial/"')
    expect(html).toContain('data-act="goto-guide"')
    expect(html).toContain('qs-guide')
    expect(html).toContain('30秒上手')
  })

  it('Lang.ts zh/en 两表都有 guide 键（中文纯中文、英文纯英文）', () => {
    const src = readFileSync(resolve(ROOT, 'src/i18n/Lang.ts'), 'utf8')
    expect(src.split("'ui.title.link.guide':").length - 1).toBeGreaterThanOrEqual(2)
    expect(src).toContain("'ui.title.link.guide': '30秒上手 · 先看教程'")
    expect(src).toContain("'ui.title.link.guide': '30s guide · read first'")
  })

  it('Lang.ts zh/en 两表都有四个键', () => {
    const src = readFileSync(resolve(ROOT, 'src/i18n/Lang.ts'), 'utf8')
    for (const k of ['ui.title.links.aria', 'ui.title.link.atlas', 'ui.title.link.codex', 'ui.title.link.guide', 'ui.notify.atlasCodex']) {
      expect(src.split(`'${k}':`).length - 1, `missing in one table: ${k}`).toBeGreaterThanOrEqual(2)
    }
    expect(src).toContain('游记 · 余响集（八十八篇全集）')
    expect(src).toContain('游记 · 余响集（八十八篇全集）世界谱')
    expect(src).toContain('Atlas · The Aftermath (all 88) · World Codex')
    expect(src).not.toContain('八十一篇全集')
    expect(src).not.toContain('all 81')
    expect(src).toContain('The Aftermath')
  })

  it('CSS：.qs-links fixed 常亮 + .qs-link focus-visible', () => {
    const src = readFileSync(resolve(ROOT, 'src/ui/TitleScreen.ts'), 'utf8')
    expect(src).toMatch(/#title \.qs-links\{position:fixed/)
    expect(src).toMatch(/#title \.qs-link\{[^}]*color:rgba\(255,217,138/)
    expect(src).toContain('#title .qs-link:focus-visible')
  })

  it('点击游记链接：记账 title-link-anthology（且不误触开局）', async () => {
    const { TitleScreen } = await import('@/ui/TitleScreen')
    const news: string[] = []
    const calls: string[] = []
    ;(g.window as Record<string, unknown>).__caesuraTrack = (t: string) => { calls.push(t) }
    const t = new TitleScreen(hooks(news))
    await tick()
    clickAct((t as unknown as { root: FakeEl }).root, 'goto-anthology')
    expect(calls).toContain('title-link-anthology')
    expect(news).toEqual([])
  })

  it('点击世界谱链接：记账 title-link-codex（且不误触开局）', async () => {
    const { TitleScreen } = await import('@/ui/TitleScreen')
    const news: string[] = []
    const calls: string[] = []
    ;(g.window as Record<string, unknown>).__caesuraTrack = (t: string) => { calls.push(t) }
    const t = new TitleScreen(hooks(news))
    await tick()
    clickAct((t as unknown as { root: FakeEl }).root, 'goto-codex')
    expect(calls).toContain('title-link-codex')
    expect(news).toEqual([])
  })

  it('KI-733 · 点击 guide 链接：记账 title-link-guide（且不误触开局）', async () => {
    const { TitleScreen } = await import('@/ui/TitleScreen')
    const news: string[] = []
    const calls: string[] = []
    ;(g.window as Record<string, unknown>).__caesuraTrack = (t: string) => { calls.push(t) }
    const t = new TitleScreen(hooks(news))
    await tick()
    clickAct((t as unknown as { root: FakeEl }).root, 'goto-guide')
    expect(calls).toContain('title-link-guide')
    expect(news).toEqual([])
  })

  it('main.ts：新局分支（if (!slot)）里多一条进入世界后的指路 + inworld-atlas-hint 记账', () => {
    const src = readFileSync(resolve(ROOT, 'src/main.ts'), 'utf8')
    expect(src).toContain("t('ui.notify.atlasCodex')")
    expect(src).toContain("'inworld-atlas-hint'")
    // 指路必须在「只说新局」的守门之内——读档不该再啰嗦一遍
    const i = src.indexOf("'inworld-atlas-hint'")
    const before = src.slice(Math.max(0, i - 400), i)
    expect(before).toContain('if (!slot)')
  })
})
