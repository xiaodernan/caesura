import { beforeAll, afterEach, describe, expect, it } from 'vitest'
import { CinematicLetterbox, type CinematicLetterboxHooks } from '@/ui/CinematicLetterbox'

/**
 * CinematicLetterbox（Phase F-50 · 电影黑边仪典）。
 *
 * 与 PauseOverlay 同纪律：每帧 update() 跟 cinematics.current 同步；这里用注入 hook 替身 mock
 * 出「当前激活 / 无激活 / 谱题缺失」三档现实，确认 DOM 类、题字、kind 自定义属性、dispose。
 */

class FakeEl {
  id = ''
  className = ''
  innerHTML = ''
  textContent = ''
  dataset = {} as Record<string, string>
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
  setAttribute(name: string, value: string) {
    if (name === 'data-kind') this.dataset.kind = value
    if (name === 'aria-hidden') this.dataset.ariaHidden = value
  }
  appendChild(c: FakeEl): FakeEl { c.parent = this; this.children.push(c); return c }
  remove(): void {
    if (!this.parent) return
    this.parent.children = this.parent.children.filter((x) => x !== this)
    this.parent = null
  }
  findByClass(needle: string): FakeEl | null {
    const walk = (el: FakeEl): FakeEl | null => {
      for (const child of el.children) {
        if (child.className.split(/\s+/).includes(needle)) return child
        const found = walk(child)
        if (found) return found
      }
      return null
    }
    return walk(this)
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
      if (tag === 'style') return { textContent: '', id: '' } as unknown as FakeEl
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

function makeHooks(over: Partial<CinematicLetterboxHooks> = {}) {
  const holder: { current: { id: string; kind: string; note?: string } | null } = { current: null }
  const hooks: CinematicLetterboxHooks = {
    info: () => (holder.current ? { id: holder.current.id, kind: holder.current.kind } : null),
    note: (id) => (holder.current && holder.current.id === id ? holder.current.note : undefined),
    ...over,
  }
  return { holder, hooks }
}

const rootOf = () => body.children.find((el) => el.id === 'cine-letterbox')!

describe('CinematicLetterbox：阶段 F-50 电影黑边仪典', () => {
  it('constructor 不抛；#cine-letterbox DOM 挂在 body；默认不亮；五个内置节点都在', () => {
    const { hooks } = makeHooks()
    new CinematicLetterbox(hooks)
    const root = rootOf()
    expect(root, '节点挂在 body').toBeDefined()
    expect(root.classList.contains('on')).toBe(false)
    for (const cls of ['cine-bar', 'cine-top', 'cine-bottom', 'cine-caption', 'cine-skip', 'cine-mark']) {
      expect(root.findByClass(cls), `节点 ${cls} 存在`).not.toBeNull()
    }
  })

  it('update() 无激活 ⇒ 保持静默；激活 ⇒ 两幕布 .on + aria-hidden=false + data-kind 落当前 kind', () => {
    const { holder, hooks } = makeHooks()
    const box = new CinematicLetterbox(hooks)
    box.update()
    expect(rootOf().classList.contains('on')).toBe(false)
    holder.current = { id: 'CINE_WIN', kind: 'win', note: '管风琴过载熄灭' }
    box.update()
    const root = rootOf()
    expect(root.classList.contains('on')).toBe(true)
    expect(root.dataset.ariaHidden).toBe('false')
    expect(root.dataset.kind).toBe('win')
  })

  it('激活后题字真写进 .cine-caption（含 cinematics.json 的 note 原文）', () => {
    const { holder, hooks } = makeHooks()
    const box = new CinematicLetterbox(hooks)
    holder.current = { id: 'CINE_WIN', kind: 'win', note: '管风琴过载熄灭：逐段去饱和至骨白' }
    box.update()
    expect(rootOf().findByClass('cine-caption')!.textContent).toContain('管风琴过载熄灭')
  })

  it('谱题缺失（note 查不到）⇒ 落 GENERIC_NOTE 通用题字而非空串', () => {
    const { holder, hooks } = makeHooks()
    const box = new CinematicLetterbox(hooks)
    holder.current = { id: 'CINE_UNKNOWN_X', kind: 'story', note: undefined }
    box.update()
    expect(rootOf().findByClass('cine-caption')!.textContent).toContain('乐句未明')
  })

  it('激活→无激活 ⇒ 摘 on；aria-hidden 翻回去', () => {
    const { holder, hooks } = makeHooks()
    const box = new CinematicLetterbox(hooks)
    holder.current = { id: 'CINE_END_A', kind: 'ending', note: '石版谱线褪色' }
    box.update()
    holder.current = null
    box.update()
    const root = rootOf()
    expect(root.classList.contains('on')).toBe(false)
    expect(root.dataset.ariaHidden).toBe('true')
  })

  it('dispose() 摘掉 DOM；再 update() 不抛错', () => {
    const { holder, hooks } = makeHooks()
    const box = new CinematicLetterbox(hooks)
    box.dispose()
    expect(body.children.find((el) => el.id === 'cine-letterbox')).toBeUndefined()
    holder.current = { id: 'CINE_STORY_B7', kind: 'story', note: '恩希尔坦白' }
    expect(() => box.update()).not.toThrow()
  })

  it('纯 CSS：注入含 cine-bar/cine-caption/cine-skip/reduced-motion/win+ending+montage 三档 kind/skip-breathe', () => {
    const { hooks } = makeHooks()
    new CinematicLetterbox(hooks)
    const css = head.children.map((c) => (c as unknown as { textContent: string }).textContent ?? '').join('\n')
    expect(css).toContain('.cine-letterbox')
    expect(css).toContain('@keyframes cine-skip-breathe')
    expect(css).toContain('prefers-reduced-motion')
    expect(css).toContain("[data-kind='win']")
    expect(css).toContain("[data-kind='ending']")
    expect(css).toContain("[data-kind='montage']")
    expect(css).toContain('.cine-bar.cine-top')
    expect(css).toContain('.cine-bar.cine-bottom')
    expect(css).toContain('.cine-caption')
  })

  it('constructor 接受自定义 skipHint（"停止 · 跳过"）并写进 .cine-skip 子节点', () => {
    const { hooks } = makeHooks({ skipHint: '停止 · 跳过' })
    new CinematicLetterbox(hooks)
    expect(rootOf().findByClass('cine-skip')!.textContent).toContain('停止 · 跳过')
  })

  it('默认 skipHint 是 ESC · 跳过', () => {
    const { hooks } = makeHooks()
    new CinematicLetterbox(hooks)
    expect(rootOf().findByClass('cine-skip')!.textContent).toBe('ESC · 跳过')
  })

  it('连续两次激活 ⇒ data-kind/题字都跟最新一次走（不残留前一次）', () => {
    const { holder, hooks } = makeHooks()
    const box = new CinematicLetterbox(hooks)
    holder.current = { id: 'CINE_WIN', kind: 'win', note: '管风琴熄灭' }
    box.update()
    holder.current = { id: 'CINE_STORY_B7', kind: 'story', note: '恩希尔坦白' }
    box.update()
    const root = rootOf()
    expect(root.dataset.kind).toBe('story')
    expect(root.findByClass('cine-caption')!.textContent).toContain('恩希尔坦白')
    expect(root.findByClass('cine-mark')!.textContent).toBe('CINE_STORY_B7')
  })
})
