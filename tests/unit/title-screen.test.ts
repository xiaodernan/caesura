import { describe, expect, it, beforeAll } from 'vitest'
import { registerGameData } from '@/data'
import { AUTOSAVE_SLOT, type SlotCard } from '@/save/Slots'
import type { TitleHooks } from '@/ui/TitleScreen'

/**
 * 标题屏的三段流程（KI-031② 定弦 + KI-025② 挑档/防误删确认）。
 *
 * 这里要钉住的是**顺序**而不是排版：
 * - 本机有可读的档时，点一张出身卡不许立刻开新弦——必须先过确认屏（§45 的防误删），
 *   而确认屏的默认焦点是"取消"，不是"确认"；
 * - 名册还没读回来时同样不许开新弦：那不是"没有档"，那是"还不知道有没有档"（§78）；
 * - "续"读的是玩家选中那一格，不是写死的 autosave；
 * - 空格、坏档、可读档三态在卡面上必须可分辨，坏的那一格按不下去但要看懂为什么。
 *
 * DOM 用最小替身（与 `stakerite.test.ts` 同一手法）；真实视口排版仍受 KI-010 限制。
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
let win: { handlers: Record<string, ((e: unknown) => void)[]> }

beforeAll(() => {
  body = new FakeEl()
  const g = globalThis as unknown as Record<string, unknown>
  g.document = {
    createElement: () => new FakeEl(),
    head: new FakeEl(),
    body,
    getElementById: () => new FakeEl()
  }
  win = { handlers: {} }
  g.window = {
    addEventListener: (t: string, fn: (e: unknown) => void) => { (win.handlers[t] ??= []).push(fn) },
    removeEventListener: (t: string, fn: (e: unknown) => void) => {
      win.handlers[t] = (win.handlers[t] ?? []).filter((f) => f !== fn)
    }
  }
})

/** 一格的形状与 `SlotRoster.card()` 一致（真名册能否产出它由 slots/save-ui 两档测试用真档证明） */
function card(slot: string, over: Partial<SlotCard> = {}): SlotCard {
  const data = {
    rank: 4, originId: 'origin_tuner', weaponId: 'wp_tuning_sword', regionId: null,
    playSec: 120, savedAt: 1770000000000, hp: 60, corruption: 0, questsStarted: 1, questsCompleted: 0
  }
  return {
    slot, kind: slot === AUTOSAVE_SLOT ? 'auto' : 'manual', state: 'ok', schemaVersion: 10,
    migrated: false, fromKey: null, problem: null, data, ...over
  }
}
const EMPTY: Partial<SlotCard> = { state: 'empty', schemaVersion: null, data: null }
const BLOCKED: Partial<SlotCard> = { state: 'blocked', schemaVersion: null, data: null, problem: 'crc' }

const SLOTS = [AUTOSAVE_SLOT, 'slot1', 'slot2', 'slot3']
const roster = (over: Record<string, Partial<SlotCard>> = {}): SlotCard[] =>
  SLOTS.map((s) => card(s, over[s] ?? {}))

interface Hit { news: string[]; continues: string[] }

async function screen(read: () => SlotCard[]) {
  const { TitleScreen } = await import('@/ui/TitleScreen')
  const hit: Hit = { news: [], continues: [] }
  const hooks: TitleHooks = {
    onNew: (id) => { hit.news.push(id) },
    onContinue: (slot) => { hit.continues.push(slot) },
    listSlots: async () => read()
  }
  const t = new TitleScreen(hooks)
  await new Promise((r) => setTimeout(r, 0)) // 等名册那一次异步读回来
  return { t, hit, root: (t as unknown as { root: FakeEl }).root }
}

const press = (code: string): void => { for (const fn of win.handlers.keydown ?? []) fn({ code, preventDefault: () => {} }) }
function click(root: FakeEl, act: string, arg = ''): void {
  const el = new FakeEl()
  el.dataset = { act, arg }
  root.dispatch('click', { target: el })
}
function clickDisabled(root: FakeEl, act: string, arg = ''): void {
  const el = new FakeEl()
  el.dataset = { act, arg, disabled: '1' }
  root.dispatch('click', { target: el })
}
const view = (t: unknown): string => (t as { root: FakeEl }).root.innerHTML

describe('标题屏 · 定弦（KI-031②）', () => {
  registerGameData()

  it('五张出身卡全部从表里读，屏上没有第二条出身文案', async () => {
    const { t } = await screen(() => roster())
    const s = view(t)
    expect(s).toContain('止音纪元')
    expect(s).toContain('CAESURA')
    expect(s.match(/data-act="card"/g)?.length).toBe(5)
    expect(s).toContain('被动 ·')
  })

  it('本机没有档 ⇒ 点一张卡直接开弦，不打扰确认屏', async () => {
    const { t, hit } = await screen(() => roster({ autosave: EMPTY, slot1: EMPTY, slot2: EMPTY, slot3: EMPTY }))
    expect(view(t)).toContain('本机没有可续的存档')
    click((t as unknown as { root: FakeEl }).root, 'card', 'origin_drummer')
    expect(hit.news).toEqual(['origin_drummer'])
  })

  it('名册还没读回来时点卡不开弦：那不是「没有档」，是「还不知道」', async () => {
    const { TitleScreen } = await import('@/ui/TitleScreen')
    const hit: Hit = { news: [], continues: [] }
    let release: ((c: SlotCard[]) => void) | null = null
    const t = new TitleScreen({
      onNew: (id) => { hit.news.push(id) },
      onContinue: (s) => { hit.continues.push(s) },
      listSlots: () => new Promise<SlotCard[]>((res) => { release = res })
    })
    const root = (t as unknown as { root: FakeEl }).root
    expect(view(t)).toContain('正在查看本机存档…')
    click(root, 'card', 'origin_drummer')
    expect(hit.news, '读数没到齐就不该有决定').toEqual([])
    release!(roster())
    await new Promise((r) => setTimeout(r, 0))
    expect(t.hasSaveable).toBe(true)
    click(root, 'card', 'origin_drummer')
    expect(hit.news, '读数到齐之后同一记点击走确认屏').toEqual([])
    expect(view(t)).toContain('开一根新弦')
  })
})

describe('标题屏 · 防误删确认（KI-025②）', () => {
  registerGameData()

  it('有可读的档 ⇒ 点卡先落在确认屏，并且默认焦点是「取消」', async () => {
    const { t, hit } = await screen(() => roster())
    click((t as unknown as { root: FakeEl }).root, 'card', 'origin_drummer')
    const s = view(t)
    expect(hit.news).toEqual([])
    expect(s).toContain('本机已有可读的存档')
    expect(s).toContain('下一次休息会把自动槽写掉')
    expect(s).toContain('class="act sel" data-act="new-no"')
    expect(s).toContain('音级 4')
  })

  it('确认屏上 Enter 的默认那一记是取消：回到定弦，谁也不开', async () => {
    const { t, hit } = await screen(() => roster())
    const root = (t as unknown as { root: FakeEl }).root
    click(root, 'card', 'origin_drummer')
    press('Enter')
    expect(hit.news).toEqual([])
    expect(view(t)).toContain('为她定一根弦')
  })

  it('→ 之后 Enter 才真的开新弦，而且开的是被点的那一根', async () => {
    const { t, hit } = await screen(() => roster())
    const root = (t as unknown as { root: FakeEl }).root
    click(root, 'card', 'origin_scavenger')
    press('ArrowRight')
    press('Enter')
    expect(hit.news).toEqual(['origin_scavenger'])
    press('Enter')
    expect(hit.news, '那一根弦已经交出去了：同一屏再按 Enter 不会二次开弦').toEqual(['origin_scavenger'])
    expect(view(t)).toContain('为她定一根弦')
  })

  it('只有坏档时也要给路看原因：能进挑档屏，但那一格按不下去', async () => {
    const { t, hit } = await screen(() => roster({
      autosave: EMPTY, slot1: BLOCKED, slot2: EMPTY, slot3: EMPTY
    }))
    const s = view(t)
    expect(s).toContain('本机有存档，但读不出来')
    expect(s).not.toContain('本机没有可续的存档')
    expect(s, '没有可读的档，但"查看"那一行还是要给').toContain('查看 · 本机有读不出来的存档')
    press('ArrowDown')
    press('Enter')
    const picked = view(t)
    expect(picked).toContain('存档文件已损坏')
    expect(picked).toContain('data-act="load" data-arg="slot1" data-disabled="1"')
    clickDisabled((t as unknown as { root: FakeEl }).root, 'load', 'slot1')
    expect(hit.continues, '坏档点不动').toEqual([])
    press('ArrowDown')
    press('Enter')
    expect(hit.continues, '一格可读的都没有 ⇒ Enter 不续任何东西').toEqual([])
    expect(view(t), '还留在挑档屏：那句原因就是要给人看到的').toContain('data-slot="slot1"')
  })
})

describe('标题屏 · 挑档续玩（KI-025②）', () => {
  registerGameData()

  it('「续」进挑档屏：四格都渲染，只有可读的那几格能按', async () => {
    const { t, hit } = await screen(() => roster({
      autosave: EMPTY, slot2: BLOCKED, slot3: EMPTY
    }))
    press('ArrowDown')
    press('Enter')
    const s = view(t)
    expect(s.match(/data-act="load"/g)?.length).toBe(4)
    expect(s).toContain('data-act="load" data-arg="autosave" data-disabled="1"')
    expect(s).toContain('data-act="load" data-arg="slot1"')
    click((t as unknown as { root: FakeEl }).root, 'load', 'slot1')
    expect(hit.continues).toEqual(['slot1'])
    expect(hit.news, '续档不是开新弦').toEqual([])
  })

  it('读的是玩家选中的那一格，不是写死的 autosave', async () => {
    const { t, hit } = await screen(() => roster({ slot2: EMPTY }))
    await t.goto('slots')
    click((t as unknown as { root: FakeEl }).root, 'load', 'autosave')
    expect(hit.continues).toEqual(['autosave'])
    click((t as unknown as { root: FakeEl }).root, 'load', 'slot3')
    expect(hit.continues).toEqual(['autosave', 'slot3'])
  })

  it('焦点只在可读的那几格里绕：空槽与坏档不参与计数', async () => {
    const { t } = await screen(() => roster({ autosave: EMPTY, slot2: BLOCKED, slot3: EMPTY }))
    await t.goto('slots')
    const focus = () => (t as unknown as { focus: { kind: string; index: number } }).focus
    expect(focus()).toEqual({ kind: 'slot', index: 0 })
    press('ArrowDown') // 可读的只有 slot1 一格 ⇒ m=1，绕回自己
    expect(focus()).toEqual({ kind: 'slot', index: 0 })
    const s = view(t)
    expect(s.match(/class="slot sel"/g)?.length, '选中记号只有一处').toBe(1)
    expect(s).toContain('<div class="slot sel"><div class="scard ok" data-slot="slot1"')
  })

  it('← / Escape 从挑档屏回定弦，不算一次决定', async () => {
    const { t, hit } = await screen(() => roster())
    await t.goto('slots')
    press('ArrowLeft')
    expect(view(t)).toContain('为她定一根弦')
    await t.goto('slots')
    press('Escape')
    expect(view(t)).toContain('为她定一根弦')
    expect(hit.news).toEqual([])
    expect(hit.continues).toEqual([])
  })

  it('dispose() 之后键盘监听与 DOM 都不留（谁挂的谁摘）', async () => {
    const { t, root } = await screen(() => roster())
    expect(root.parent).toBe(body)
    const before = (win.handlers.keydown ?? []).length
    expect(before, '这一屏至少挂上了自己的那一个监听').toBeGreaterThan(0)
    t.dispose()
    expect(root.parent, 'DOM 节点摘掉').toBeNull()
    expect((win.handlers.keydown ?? []).length, '监听摘掉，不留一个偷偷吃键的幽灵').toBe(before - 1)
  })
})

describe('标题屏 · 点击收尾（back/new-yes/new-no）', () => {
  it('挑档屏点"返回定弦" ⇒ 回到定弦，不算决定', async () => {
    const { t, hit } = await screen(() => roster())
    const root = (t as unknown as { root: FakeEl }).root
    click(root, 'continue')
    expect(view(t)).toContain('返回定弦')
    click(root, 'back')
    expect(view(t)).toContain('为她定一根弦')
    expect(hit.news).toEqual([])
    expect(hit.continues).toEqual([])
  })

  it('确认屏点"确认开新弦" ⇒ 开的是被点的那一根；点"取消" ⇒ 回定弦谁也不开', async () => {
    const { t, hit } = await screen(() => roster())
    const root = (t as unknown as { root: FakeEl }).root
    click(root, 'card', 'origin_scavenger')
    expect(view(t)).toContain('开一根新弦')
    click(root, 'new-yes')
    expect(hit.news).toEqual(['origin_scavenger'])
    click(root, 'card', 'origin_drummer')
    click(root, 'new-no')
    expect(hit.news).toEqual(['origin_scavenger'])
    expect(view(t)).toContain('为她定一根弦')
  })

  it('点到不认识的动作 ⇒ 静默忽略，不算决定也不重画崩', async () => {
    const { t, hit } = await screen(() => roster())
    const root = (t as unknown as { root: FakeEl }).root
    click(root, 'bogus-action')
    expect(hit.news).toEqual([])
    expect(hit.continues).toEqual([])
  })
})
