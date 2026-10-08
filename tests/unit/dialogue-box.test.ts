import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest'

/**
 * DialogueBox：纯 DOM 对话框（Phase 6-B 字幕层）。
 *
 * 覆盖：
 * - show/hide 与 isOpen 同步
 * - speaker/emotion/choices 渲染（含 STYLE_LABEL 映射 blunt/poetic/silent/provoke）
 * - 点击选择触发 onChoose
 * - 无选项时点击/空格/回车/KeyE 触发 onAdvance
 * - Esc 触发 onClose
 * - 数字键 1-9 直接选
 * - setSpeakerResolver 注入显示名
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
  appendChild(c: FakeEl): FakeEl { c.parent = this; this.children.push(c); this.innerHTML = this.children.map(ch => ch.innerHTML).join(''); return c }
  remove(): void {
    if (!this.parent) return
    this.parent.children = this.parent.children.filter((x) => x !== this)
    this.parent = null
  }
  addEventListener(t: string, fn: (e: unknown) => void): void { (this.handlers[t] ??= []).push(fn) }
  dispatch(t: string, e: unknown): void { for (const fn of this.handlers[t] ?? []) fn(e) }
  closest(sel: string): FakeEl | null {
    if (sel === '[data-ch]') return this.dataset.ch ? this : null
    return null
  }
}

let body: FakeEl
let head: FakeEl
let win: { handlers: Record<string, ((e: unknown) => void)[]> }

beforeAll(() => {
  body = new FakeEl()
  head = new FakeEl()
  const g = globalThis as unknown as Record<string, unknown>
  g.document = {
    createElement: (tag: string) => {
      const el = new FakeEl()
      if (tag === 'style') { /* styleEl = el */ }
      return el
    },
    head,
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

afterEach(() => {
  // clear any listeners to avoid cross-test noise
  win.handlers = {}
  body.children = []
  head.children = []
})

function makeView(over: Partial<{
  dialogueId: string
  npc: string
  nodeId: string
  speaker: string
  text: string
  emotion?: string
  choices: Array<{ id: string; text: string; style: 'blunt' | 'poetic' | 'silent' | 'provoke'; index: number }>
  advanceTo: string | null
  ended: boolean
}> = {}) {
  return {
    dialogueId: 'd_test',
    npc: 'npc_hersil',
    nodeId: 'n1',
    speaker: 'hersil',
    text: '这是一行台词。',
    choices: [],
    advanceTo: null,
    ended: false,
    ...over
  }
}

describe('DialogueBox：字幕层的显示与交互', () => {
  it('show ⇒ 类 on / innerHTML 注入 speaker+台词+选择+hint；hide ⇒ 清空并移除 on', async () => {
    const { DialogueBox } = await import('@/ui/DialogueBox')
    const hooks = { onChoose: () => {}, onAdvance: () => {}, onClose: () => {} }
    const box = new DialogueBox(hooks)
    box.show(makeView({ choices: [{ id: 'c1', text: '选项一', style: 'blunt', index: 1 }] }))
    expect(box.isOpen).toBe(true)
    const root = body.children.find(c => c.id === 'dialogue')!
    expect(root.classList.contains('on')).toBe(true)
    const html = root.innerHTML
    expect(html).toContain('hersil')
    expect(html).toContain('这是一行台词')
    expect(html).toContain('选项一')
    expect(html).toContain('直') // STYLE_LABEL['blunt']
    expect(html).toContain('1-9 选择')
    box.hide()
    expect(box.isOpen).toBe(false)
    expect(root.classList.contains('on')).toBe(false)
    expect(root.innerHTML).toBe('')
  })

  it('emotion 存在 ⇒ 渲染 .em span；emotion 缺失 ⇒ 无 em', async () => {
    const { DialogueBox } = await import('@/ui/DialogueBox')
    const hooks = { onChoose: () => {}, onAdvance: () => {}, onClose: () => {} }
    const box = new DialogueBox(hooks)
    box.show(makeView({ emotion: '愤怒', choices: [] }))
    const root = body.children.find(c => c.id === 'dialogue')!
    expect(root.innerHTML).toContain('<span class="em">愤怒</span>')
    box.hide()
    box.show(makeView({ choices: [] }))
    expect(root.innerHTML).not.toContain('<span class="em">')
  })

  it('四种 style 标签正确映射：blunt=直 poetic=诗 silent=默 provoke=激', async () => {
    const { DialogueBox } = await import('@/ui/DialogueBox')
    const hooks = { onChoose: () => {}, onAdvance: () => {}, onClose: () => {} }
    const box = new DialogueBox(hooks)
    box.show(makeView({
      choices: [
        { id: 'c1', text: 'A', style: 'blunt', index: 1 },
        { id: 'c2', text: 'B', style: 'poetic', index: 2 },
        { id: 'c3', text: 'C', style: 'silent', index: 3 },
        { id: 'c4', text: 'D', style: 'provoke', index: 4 }
      ]
    }))
    const root = body.children.find(c => c.id === 'dialogue')!
    const html = root.innerHTML
    expect(html).toContain('直')
    expect(html).toContain('诗')
    expect(html).toContain('默')
    expect(html).toContain('激')
  })

  it('点击 [data-ch] 触发 onChoose；无选项时点击空白触发 onAdvance', async () => {
    const { DialogueBox } = await import('@/ui/DialogueBox')
    const choose = vi.fn()
    const advance = vi.fn()
    const box = new DialogueBox({ onChoose: choose, onAdvance: advance, onClose: () => {} })
    // 有选择
    box.show(makeView({ choices: [{ id: 'c1', text: '选', style: 'blunt', index: 1 }] }))
    const root = body.children.find(c => c.id === 'dialogue')!
    const el = new FakeEl()
    el.dataset = { ch: 'c1' }
    root.dispatch('click', { target: el })
    expect(choose).toHaveBeenCalledWith('c1')
    expect(advance).not.toHaveBeenCalled()
    // 无选择
    box.hide()
    box.show(makeView({ choices: [] }))
    const root2 = body.children.find(c => c.id === 'dialogue')!
    root2.dispatch('click', { target: new FakeEl() })
    expect(advance).toHaveBeenCalled()
  })

  it('键盘：Esc ⇒ onClose；有选择时 1-9 ⇒ onChoose；无选择时 Space/Enter/KeyE ⇒ onAdvance', async () => {
    const { DialogueBox } = await import('@/ui/DialogueBox')
    const choose = vi.fn()
    const advance = vi.fn()
    const close = vi.fn()
    const box = new DialogueBox({ onChoose: choose, onAdvance: advance, onClose: close })
    // 有选择
    box.show(makeView({ choices: [{ id: 'c1', text: '选', style: 'blunt', index: 1 }] }))
    for (const fn of win.handlers.keydown ?? []) fn({ code: 'Escape', key: 'Escape', preventDefault: () => {} })
    expect(close).toHaveBeenCalled()
    close.mockClear()
    for (const fn of win.handlers.keydown ?? []) fn({ code: 'Digit1', key: '1', preventDefault: () => {} })
    expect(choose).toHaveBeenCalledWith('c1')
    expect(advance).not.toHaveBeenCalled()
    choose.mockClear()
    // 无选择
    box.hide()
    box.show(makeView({ choices: [] }))
    for (const fn of win.handlers.keydown ?? []) fn({ code: 'Space', key: ' ', preventDefault: () => {} })
    expect(advance).toHaveBeenCalled()
    advance.mockClear()
    for (const fn of win.handlers.keydown ?? []) fn({ code: 'Enter', key: 'Enter', preventDefault: () => {} })
    expect(advance).toHaveBeenCalled()
    advance.mockClear()
    for (const fn of win.handlers.keydown ?? []) fn({ code: 'KeyE', key: 'e', preventDefault: () => {} })
    expect(advance).toHaveBeenCalled()
  })

  it('超范围数字键不触发 onChoose', async () => {
    const { DialogueBox } = await import('@/ui/DialogueBox')
    const choose = vi.fn()
    const box = new DialogueBox({ onChoose: choose, onAdvance: () => {}, onClose: () => {} })
    box.show(makeView({ choices: [{ id: 'c1', text: '选', style: 'blunt', index: 1 }] }))
    for (const fn of win.handlers.keydown ?? []) fn({ code: 'Digit9', key: '9', preventDefault: () => {} })
    expect(choose).not.toHaveBeenCalled()
  })

  it('setSpeakerResolver 注入显示名函数 ⇒ who 渲染用解析后的名字', async () => {
    const { DialogueBox } = await import('@/ui/DialogueBox')
    const box = new DialogueBox({ onChoose: () => {}, onAdvance: () => {}, onClose: () => {} })
    box.setSpeakerResolver((id) => id === 'hersil' ? '赫西尔' : id)
    box.show(makeView({ speaker: 'hersil', choices: [] }))
    const root = body.children.find(c => c.id === 'dialogue')!
    expect(root.innerHTML).toContain('赫西尔')
  })

  it('hide 后 keydown 不触发任何回调（view 为 null 早退）', async () => {
    const { DialogueBox } = await import('@/ui/DialogueBox')
    const choose = vi.fn()
    const advance = vi.fn()
    const close = vi.fn()
    const box = new DialogueBox({ onChoose: choose, onAdvance: advance, onClose: close })
    box.show(makeView({ choices: [] }))
    box.hide()
    for (const fn of win.handlers.keydown ?? []) fn({ code: 'Space', key: ' ', preventDefault: () => {} })
    for (const fn of win.handlers.keydown ?? []) fn({ code: 'Escape', key: 'Escape', preventDefault: () => {} })
    expect(advance).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })
})