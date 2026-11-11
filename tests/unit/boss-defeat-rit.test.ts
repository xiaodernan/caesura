import { beforeAll, afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { BossDefeatRit } from '@/ui/BossDefeatRit'

/**
 * BossDefeatRit（Phase F-49 · Boss 终局「烬印」）。
 *
 * 与 BossPhaseBanner 同纪律：纯 DOM/CSS 全屏装饰，bus.on 唯增不改扇出，
 * `render()` 走「摘 on → 强制回流 → 再加 on」标准重播；脚注残留不掩盖换段。
 */

class FakeEl {
  id = ''
  className = ''
  innerHTML = ''
  textContent = ''
  children: FakeEl[] = []
  parent: FakeEl | null = null
  /** 重播序列留痕：classList 操作与 offsetWidth 回流各记一笔（同 F-47 纪律） */
  ops: string[] = []
  private classes = new Set<string>()
  classList = {
    add: (c: string) => { this.classes.add(c); this.ops.push('add:' + c) },
    remove: (c: string) => { this.classes.delete(c); this.ops.push('remove:' + c) },
    contains: (c: string) => this.classes.has(c),
    toggle: (c: string, force?: boolean) => {
      if (force === undefined) (this.classes.has(c) ? this.classes.delete(c) : this.classes.add(c))
      else force ? this.classes.add(c) : this.classes.delete(c)
    },
  }
  /** 读 offsetWidth 触发回流；render() 靠 `void offsetWidth` 结算动画移除 */
  get offsetWidth(): number { this.ops.push('reflow'); return 0 }
  setAttribute(_name: string, _value: string) {}
  appendChild(c: FakeEl): FakeEl { c.parent = this; this.children.push(c); return c }
  remove(): void {
    if (!this.parent) return
    this.parent.children = this.parent.children.filter((x) => x !== this)
    this.parent = null
  }
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
        const styleEl = { textContent: '', id: '' }
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

describe('BossDefeatRit：阶段 F-49 Boss 终局「烬印」', () => {
  it('constructor 不抛；#boss-defeat-rit DOM 已挂 body；默认不亮', () => {
    const rit = new BossDefeatRit()
    const root = body.children.find((el) => el.id === 'boss-defeat-rit')
    expect(root, '节点挂在 body').toBeDefined()
    expect(root!.classList.contains('on')).toBe(false)
    rit.dispose()
  })

  it('emit boss.defeated ⇒ altar 亮起并渲染 Boss 中文名 + 「终」印 + 焚烬将寂副标', () => {
    const rit = new BossDefeatRit()
    bus.emit('boss.defeated', { id: 'boss_myriad', dataId: 'en_myriad', nameKey: 'enemy.myriad', holdTicks: 120 })
    const root = body.children.find((el) => el.id === 'boss-defeat-rit')!
    expect(root.classList.contains('on')).toBe(true)
    expect(root.innerHTML).toContain('万籁 The Myriad')
    expect(root.innerHTML).toContain('焚烬将寂')
    expect(root.innerHTML).toContain('TERMINUS')
    expect(root.innerHTML).toContain('终')
    rit.dispose()
  })

  it('连续两次 emit ⇒ 内容真更新到最新一次的 Boss（不残留旧 Boss）', () => {
    const rit = new BossDefeatRit()
    bus.emit('boss.defeated', { id: 'boss_tympanus', dataId: 'en_tympanus', nameKey: 'enemy.tympanus', holdTicks: 120 })
    bus.emit('boss.defeated', { id: 'boss_ostlara', dataId: 'en_ostlara', nameKey: 'enemy.ostlara', holdTicks: 120 })
    const root = body.children.find((el) => el.id === 'boss-defeat-rit')!
    expect(root.innerHTML).toContain('奥斯塔拉')
    // 上一条 emit 的驼鼓（enemy.tympanus）不得残留——真名册里是「驼鼓」，不是恒假的「鼓鼓」
    expect(root.innerHTML).not.toContain('驼鼓')
    rit.dispose()
  })

  it('dispose 摘掉 DOM，bus 退订后不再复活', () => {
    const rit = new BossDefeatRit()
    rit.dispose()
    expect(body.children.find((el) => el.id === 'boss-defeat-rit')).toBeUndefined()
    // 退订后再 emit 不得抛、且 body 不再出现节点（bus 里不该再有本实例的监听器）
    expect(() => bus.emit('boss.defeated', { id: 'x', dataId: 'en_tympanus', nameKey: 'enemy.tympanus', holdTicks: 1 })).not.toThrow()
    expect(body.children.find((el) => el.id === 'boss-defeat-rit')).toBeUndefined()
  })

  it('纯 CSS：样式注入进 head，含 bdr-enter / bdr-seal / bdr-rule / reduced-motion 兜底 / 双 corner', () => {
    const rit = new BossDefeatRit()
    const css = head.children.map((c) => (c as unknown as { textContent: string }).textContent ?? '').join('\n')
    expect(css).toContain('.boss-defeat-rit')
    expect(css).toContain('@keyframes bdr-enter')
    expect(css).toContain('@keyframes bdr-seal')
    expect(css).toContain('@keyframes bdr-rule')
    expect(css).toContain('@keyframes bdr-glyph-breathe')
    expect(css).toContain('prefers-reduced-motion')
    expect(css).toContain('.corner-tl')
    expect(css).toContain('.corner-br')
    expect(css).toContain('.seal')
    expect(css, '终印确在右下（与源码注释一致，非遗留的左上 12° 假描述）').toMatch(/\.seal\s*\{[^}]*bottom:[^}]*right:/)
    rit.dispose()
  })

  it('markup 只含 CSS 里真实存在的元素：无「声渊已静」竖排草书等文档假元素', () => {
    const rit = new BossDefeatRit()
    bus.emit('boss.defeated', { id: 'x', dataId: 'en_myriad', nameKey: 'enemy.myriad', holdTicks: 10 })
    const root = body.children.find((el) => el.id === 'boss-defeat-rit')!
    expect(root.innerHTML).not.toContain('声渊已静')   // 初版注释写过、DOM 从未有过
    expect(root.innerHTML).not.toContain('乐章归寂')
    for (const cls of ['altar', 'overline', 'rule', 'seal', 'corner-tl', 'corner-tr', 'corner-bl', 'corner-br']) {
      expect(root.innerHTML, '每个渲染元素都要有对应 CSS 契约：' + cls).toContain(cls)
    }
    rit.dispose()
  })

  it('连续两次 boss.defeated 真重播：第二次是 remove→回流→add（bdr-enter 能从头跑，非裸 add no-op）', () => {
    const rit = new BossDefeatRit()
    const root = body.children.find((el) => el.id === 'boss-defeat-rit')!
    bus.emit('boss.defeated', { id: 'b1', dataId: 'en_hersil', nameKey: 'enemy.hersil', holdTicks: 30 })
    const afterFirst = root.ops.slice()
    expect(afterFirst, '第一次：摘 on → 回流 → 挂 on').toEqual(['remove:on', 'reflow', 'add:on'])
    expect(root.innerHTML, 'enemy.hersil 走真名册全名，不是硬抄的错名').toContain('无拍长·恩希尔·万籁')
    root.ops.length = 0
    bus.emit('boss.defeated', { id: 'b2', dataId: 'en_myriad', nameKey: 'enemy.myriad', holdTicks: 60 })
    expect(root.ops, '第二次同样真重播，不是对已在的 .on 做 no-op add').toEqual(['remove:on', 'reflow', 'add:on'])
    expect(root.innerHTML, '且内容更新到第二位 Boss').toContain('万籁 The Myriad')
    expect(root.classList.contains('on'), '重播后仍亮').toBe(true)
    rit.dispose()
  })

  it('未知的 nameKey ⇒ 回落原样显示（不抛错、不空名）', () => {
    const rit = new BossDefeatRit()
    bus.emit('boss.defeated', { id: 'x', dataId: 'en_unknown_test', nameKey: 'enemy.unknown_test', holdTicks: 10 })
    const root = body.children.find((el) => el.id === 'boss-defeat-rit')!
    expect(root.innerHTML).toContain('enemy.unknown_test')
    rit.dispose()
  })
})
