import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import { Input, type UiIntent } from '@/core/Input'

/**
 * DialogueBox：纯 DOM 对话框（Phase 6-B 字幕层）。
 *
 * 覆盖：
 * - show/hide 与 isOpen 同步
 * - speaker/emotion/choices 渲染（含 STYLE_LABEL 映射 blunt/poetic/silent/provoke）
 * - 点击选择触发 onChoose
 * - 无选项时点击 + `confirm` 意图（空格/回车/E/手柄 A）触发 onAdvance
 * - `back` 意图（Esc/Backspace/Tab/手柄 B）触发 onClose
 * - 数字键 1-9（`pick1..9`）直接选
 * - setSpeakerResolver 注入显示名
 *
 * **键盘那三条从 KI-062 第二腿起不再直接喂 `keydown` 给本屏**：对话框自己那只监听器删了，
 * 读数只有一个入口 `uiStep(intents)`。所以这里的按键一律走**真通道**——真 `Input` 实例
 * （假 window + 假 navigator）收下键码，`poll()` 求出边沿，再喂给框。用替身喂意图的话，
 * "键码到底折成了哪个意图"这一层就没人证了。
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

/* ---------------- 真通道（键码 → Input 折意图 → poll 求边沿 → 喂给框） ---------------- */

type Steppable = { uiStep(intents: Set<UiIntent>): void }

/** 对话框在场时的真实组合：世界停着（`enabled=false`），但菜单正需要读数（`uiOwner`） */
function attach(box: Steppable): Input {
  const input = new Input(new FakeEl() as unknown as HTMLElement)
  input.enabled = false
  input.uiOwner = 'dialogue'
  return input
}
const fire = (code: string, up = false): void => {
  const e = { code, key: '', repeat: false, preventDefault: () => {} }
  for (const fn of win.handlers[up ? 'keyup' : 'keydown'] ?? []) fn(e)
}
/**
 * 一记完整的按下-松开。中间那次 `poll` 之后必须再来一次：边沿是"新出现"的意思，
 * 松开不过一遍 poll，下一记同一个键就被当成"一直按着"而没有边沿（这是产品语义，不是 bug）。
 */
const tap = (input: Input, code: string, box: Steppable): void => {
  fire(code)
  input.poll(1 / 60)
  box.uiStep(input.uiEdges)
  fire(code, true)
  input.poll(1 / 60)
}
/** 手柄的一记按钮：过 `pollPad` 那条腿（A=0、B=1），与键盘折成同一组意图 */
function fakePad(pressed: number[] = []): void {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      getGamepads: () => [{
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
        mapping: 'standard', connected: true,
      }],
    },
  })
}
const tapPad = (input: Input, button: number, box: Steppable): void => {
  fakePad([button])
  input.poll(1 / 60)
  box.uiStep(input.uiEdges)
  fakePad()
  input.poll(1 / 60)
}

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

  it('情绪标注**不上屏**（它是作者面的标注，不是玩家读的标签，KI-185）', async () => {
    const { DialogueBox } = await import('@/ui/DialogueBox')
    const hooks = { onChoose: () => {}, onAdvance: () => {}, onClose: () => {} }
    const box = new DialogueBox(hooks)
    box.show(makeView({ emotion: 'guarded', choices: [] }))
    const root = body.children.find(c => c.id === 'dialogue')!
    // 数据里的情绪是**内部英文标注**（全表 26 种："guarded"／"measured"／"blank"…），
    // 原样印在说话者名字后面 ⇒ 玩家看到「铃姨 measured」。
    // `docs/narrative.md` §27 那张表写的是「无 `emotion` 表现」——文档是权威，标注不上屏。
    expect(root.innerHTML, '情绪词不许漏到玩家面前').not.toContain('guarded')
    expect(root.innerHTML, '也没有那个 span').not.toContain('class="em"')
    // 说话者的名字照旧在（那一格是玩家要读的）
    expect(root.innerHTML).toContain('hersil')
    box.hide()
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

  it('键盘（真通道）：back ⇒ onClose；有选择时 pick1 ⇒ onChoose；无选择时 confirm ⇒ onAdvance', async () => {
    const { DialogueBox } = await import('@/ui/DialogueBox')
    const choose = vi.fn()
    const advance = vi.fn()
    const close = vi.fn()
    const box = new DialogueBox({ onChoose: choose, onAdvance: advance, onClose: close })
    const input = attach(box)
    // 有选择
    box.show(makeView({ choices: [{ id: 'c1', text: '选', style: 'blunt', index: 1 }] }))
    tap(input, 'Escape', box)
    expect(close).toHaveBeenCalled()
    close.mockClear()
    tap(input, 'Digit1', box)
    expect(choose).toHaveBeenCalledWith('c1')
    expect(advance, '有选项时数字键只选，不推进').not.toHaveBeenCalled()
    choose.mockClear()
    // 无选择：hint 上写的三格（空格 / 回车）+ E，全部折成同一个 confirm
    box.hide()
    box.show(makeView({ choices: [] }))
    for (const code of ['Space', 'Enter', 'KeyE']) {
      advance.mockClear()
      tap(input, code, box)
      expect(advance, `${code} 应当折成 confirm 并推进`).toHaveBeenCalled()
    }
  })

  it('手柄那半条：A ⇒ confirm 推进、B ⇒ back 离开（与键盘折成同一组意图）', async () => {
    const { DialogueBox } = await import('@/ui/DialogueBox')
    const advance = vi.fn()
    const close = vi.fn()
    const box = new DialogueBox({ onChoose: () => {}, onAdvance: advance, onClose: close })
    const input = attach(box)
    box.show(makeView({ choices: [] }))
    tapPad(input, 0, box)   // A
    expect(advance).toHaveBeenCalled()
    tapPad(input, 1, box)   // B
    expect(close).toHaveBeenCalled()
    expect(input.frame.edges.size, '菜单读数不许漏进玩法那条').toBe(0)
  })

  it('有选项时 confirm 不推进：一屏待着四条选项，空格该选一条而不是把整段推走', async () => {
    const { DialogueBox } = await import('@/ui/DialogueBox')
    const choose = vi.fn()
    const advance = vi.fn()
    const box = new DialogueBox({ onChoose: choose, onAdvance: advance, onClose: () => {} })
    const input = attach(box)
    box.show(makeView({
      choices: [
        { id: 'c1', text: 'A', style: 'blunt', index: 1 },
        { id: 'c2', text: 'B', style: 'poetic', index: 2 },
      ],
    }))
    tap(input, 'Space', box)
    expect(advance, '选项还在屏上时 confirm 什么都不做（没有"默认那一条"）').not.toHaveBeenCalled()
    tap(input, 'Digit2', box)
    expect(choose).toHaveBeenCalledWith('c2')
  })

  it('超范围数字键不触发 onChoose', async () => {
    const { DialogueBox } = await import('@/ui/DialogueBox')
    const choose = vi.fn()
    const box = new DialogueBox({ onChoose: choose, onAdvance: () => {}, onClose: () => {} })
    const input = attach(box)
    box.show(makeView({ choices: [{ id: 'c1', text: '选', style: 'blunt', index: 1 }] }))
    tap(input, 'Digit9', box)
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

  it('hide 之后把意图喂进来也不触发任何回调（view 为 null 早退）', async () => {
    const { DialogueBox } = await import('@/ui/DialogueBox')
    const advance = vi.fn()
    const close = vi.fn()
    const box = new DialogueBox({ onChoose: () => {}, onAdvance: advance, onClose: close })
    const input = attach(box)
    box.show(makeView({ choices: [] }))
    box.hide()
    tap(input, 'Space', box)
    tap(input, 'Escape', box)
    expect(advance).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })

  it('构造一只框不在窗口上多挂任何监听器：读数只有 uiStep 这一个入口（行为证人）', async () => {
    const { DialogueBox } = await import('@/ui/DialogueBox')
    const before = (win.handlers.keydown ?? []).length
    expect(before, '这一条之前本文件没有别处构造 Input').toBe(0)
    const box = new DialogueBox({ onChoose: () => {}, onAdvance: () => {}, onClose: () => {} })
    expect((win.handlers.keydown ?? []).length, 'DOM 一条 + 菜单一条 = 两个主人，一次回车会被数两遍').toBe(before)
    box.show(makeView({ choices: [] }))
    box.hide()
  })
})