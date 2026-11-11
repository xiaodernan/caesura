import { beforeAll, afterEach, describe, expect, it } from 'vitest'
import { GameTime } from '@/core/Time'
import { PauseControl } from '@/core/PauseControl'
import { PauseOverlay } from '@/ui/PauseOverlay'

/**
 * PauseOverlay（Phase F-45 · 玩家手动暂停的「止音仪典」全屏提示，纯 DOM/CSS）。
 *
 * 与 ui-intents/panel-nav 同一条纪律：面板开与 DOM 落地由持有者裁决；<code>PauseControl</code> 只翻
 * 玩家那一格（不是菜单那一格）。只有玩家在交互模式按 pause（Esc），覆盖字才出现；菜单面板自带自身导航
 * 主题，那是另一条停摆线，不触发本 overlay。
 *
 * 测试：
 * - 渲染：constructor 不抛；<code>#pause-overlay</code> DOM 已挂在 body；<code>on</code> 类默认不亮
 * - 开关：update() 跟踪 <code>pause.userPaused</code>，<code>PauseControl.holdByOverlay(true)</code> 不算（菜单）
 * - 销毁：dispose() 后 DOM 摘除
 * - 纯 CSS：样式文本含 <code>pause-overlay</code> / <code>.ring.ring-b</code> / <code>pause-breathe</code> / <code>prefers-reduced-motion</code>
 */

class FakeStyle {
  id?: string
  innerHTML = ''
  textContent: string
  constructor(textContent: string) { this.textContent = textContent }
}
class FakeEl {
  id = ''
  className = ''
  innerHTML = ''
  textContent = ''
  children: FakeEl[] = []
  parent: FakeEl | null = null
  private classes = new Set<string>()
  classList = {
    add: (c: string) => { this.classes.add(c) },
    remove: (c: string) => { this.classes.delete(c) },
    contains: (c: string) => this.classes.has(c),
    toggle: (c: string, force?: boolean) => {
      if (force === undefined) (this.classes.has(c) ? this.classes.delete(c) : this.classes.add(c))
      else force ? this.classes.add(c) : this.classes.delete(c)
    },
  }
  setAttribute(_name: string, _value: string) {}
  appendChild(c: FakeEl): FakeEl { c.parent = this; this.children.push(c); return c }
  remove(): void {
    if (!this.parent) return
    this.parent.children = this.parent.children.filter((x) => x !== this)
    this.parent = null
  }
  querySelector(_sel: string): FakeEl | null { return null }
}

let head: FakeEl
let body: FakeEl

beforeAll(() => {
  head = new FakeEl()
  body = new FakeEl()
  const g = globalThis as unknown as Record<string, unknown>
  g.document = {
    createElement: (tag: string) => {
      const el = new FakeEl()
      if (tag === 'style') {
        const styleEl = new FakeStyle('')
        ;(el as unknown as Record<string, unknown>).textContent = ''
        ;(el as unknown as Record<string, unknown>).id = ''
        return styleEl as unknown as FakeEl
      }
      return el
    },
    head,
    body,
    getElementById: (id: string) => {
      const all = [...head.children, ...body.children]
      return all.find((c) => c.id === id) ?? null
    },
  }
})

afterEach(() => {
  head.children = []
  body.children = []
})

describe('PauseOverlay：阶段 F-45 玩家手动暂停的「止音仪典」', () => {
  it('constructor 不抛；未暂停时 overlay 不显示', () => {
    const time = new GameTime()
    const pause = new PauseControl(time)
    new PauseOverlay({ pause })
    const root = body.children.find((el) => el.id === 'pause-overlay')
    expect(root, 'overlay 节点挂在 body 上').toBeDefined()
    expect(root!.classList.contains('on'), '未暂停时不亮').toBe(false)
  })

  it('update() 跟踪 userPaused：toggleByUser() 之后 \t pause-overlay 出现 1 枚 pause glyph', () => {
    const time = new GameTime()
    const pause = new PauseControl(time)
    const overlay = new PauseOverlay({ pause })
    pause.toggleByUser()
    overlay.update()
    const root = body.children.find((el) => el.id === 'pause-overlay')!
    expect(root.classList.contains('on'), 'Esc 触发玩家那一格 → overlay 出现').toBe(true)
    expect(root.innerHTML, '止 glyph 在').toContain('止')
    expect(root.innerHTML, 'PAUSED 字在').toContain('PAUSED')
    expect(root.innerHTML, 'Esc 提示在').toContain('Esc')
  })

  it('update() 跟踪 userPaused 的对称：再次 Esc 之后 overlay 出现/消失、随 pausedByUser 翻转', () => {
    const time = new GameTime()
    const pause = new PauseControl(time)
    const overlay = new PauseOverlay({ pause })
    overlay.update() // false
    const root = body.children.find((el) => el.id === 'pause-overlay')!
    expect(root.classList.contains('on')).toBe(false)
    pause.toggleByUser()
    overlay.update()
    expect(root.classList.contains('on')).toBe(true)
    pause.toggleByUser()
    overlay.update()
    expect(root.classList.contains('on'), '第二次 Esc 翻回去').toBe(false)
  })

  it('holdByOverlay(true) 不会让 overlay 出现——菜单那一路的停摆不是玩家那一格', () => {
    const time = new GameTime()
    const pause = new PauseControl(time)
    const overlay = new PauseOverlay({ pause })
    pause.holdByOverlay(true)
    overlay.update()
    const root = body.children.find((el) => el.id === 'pause-overlay')!
    expect(root.classList.contains('on'), '菜单面板那一格停摆不触发本 overlay').toBe(false)
    expect(time.paused, 'worldPaused 已合成 → time.paused = true（但那是菜单那一路理解的停）').toBe(true)
  })

  it('纯 CSS：样式表已注入到 head，包含 pause-overlay / ring / breathing keyframes / reduced-motion 兜底', () => {
    const time = new GameTime()
    const pause = new PauseControl(time)
    new PauseOverlay({ pause })
    // 注入按需（已注入则本轮复用；第二次构造不再注入）
    const css = head.children.map((c) => (c as unknown as { textContent: string }).textContent ?? '').join('\n')
    expect(css, '#pause-overlay 选择器已注入').toContain('.pause-overlay')
    expect(css, '双环（外圈）Ring-Breath 已注入').toContain('.pause-overlay .ring.ring-b')
    expect(css, '呼吸 keyframes 已注入').toContain('@keyframes pause-breathe')
    expect(css, '止 glyph breathing keyframes 已注入').toContain('@keyframes pause-glyph-breathe')
    expect(css, 'reduced-motion 兜底').toContain('prefers-reduced-motion')
    // 注意：本测试用 head.children 量，不能直接读一个文件——两个 dirty 测试不应有依赖文件的绝对路径
  })

  it('dispose() 释放 DOM——body 上不再有 #pause-overlay', () => {
    const time = new GameTime()
    const pause = new PauseControl(time)
    const overlay = new PauseOverlay({ pause })
    expect(body.children.find((el) => el.id === 'pause-overlay'), 'dispose 前节点在 body').toBeDefined()
    overlay.dispose()
    expect(body.children.find((el) => el.id === 'pause-overlay'), 'dispose 后节点摘除').toBeUndefined()
  })

  it('isOpen getter 跟随 userPaused', () => {
    const time = new GameTime()
    const pause = new PauseControl(time)
    const overlay = new PauseOverlay({ pause })
    expect(overlay.isOpen).toBe(false)
    pause.toggleByUser()
    overlay.update()
    expect(overlay.isOpen).toBe(true)
    pause.toggleByUser()
    overlay.update()
    expect(overlay.isOpen).toBe(false)
  })
})
