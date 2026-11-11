import { beforeAll, afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { BossPhaseBanner } from '@/ui/BossPhaseBanner'

/**
 * BossPhaseBanner（Phase F-47 · Boss 换段誓约）。
 *
 * 全 async import 的单一入口（npm 上 runApp 与 ui 一般测试方式一样），不直接 import
 * CombatManager 以免 pull 整个套装。`intent visible`  = DOM classList 顺序
 * 渲染正确（`.on` 必须包含 `id='boss-phase-banner'`、减弱运动兜底 etc）。
 */

class FakeEl {
  id = ''
  className = ''
  innerHTML = ''
  textContent = ''
  children: FakeEl[] = []
  parent: FakeEl | null = null
  /** 重播序列留痕：每次 classList 操作记一笔，offsetWidth 读取记一笔（回流戳） */
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
  /** 模拟 layout 读取触发回流；render() 靠 `void this.root.offsetWidth` 结算动画移除 */
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
      ;(el as unknown as Record<string, unknown>).textContent = ''
      ;(el as unknown as Record<string, unknown>).id = ''
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

describe('BossPhaseBanner：阶段 F-47', () => {
  it('构造完不抛，DOM 节点已挂上 body，默认隐藏（无 class on）', () => {
    const banner = new BossPhaseBanner()
    const root = body.children.find((el) => el.id === 'boss-phase-banner')
    expect(root, '节点已挂到 body').toBeDefined()
    expect(root!.classList.contains('on'), '默认不亮').toBe(false)
    banner.dispose()
  })

  it('emit boss.phase payload → 让 #boss-phase-banner 亮起、渲染 name + 第 N 阶 + 共 phase 阶', () => {
    const banner = new BossPhaseBanner()
    bus.emit('boss.phase', { id: 'boss_myriad', phase: 2, phases: 3, nameKey: 'enemy.myriad', pos: { x: 0, y: 0, z: 0 } })
    const root = body.children.find((el) => el.id === 'boss-phase-banner')!
    expect(root.classList.contains('on'), '.on 类已加').toBe(true)
    expect(root.innerHTML).toContain('万籁 The Myriad')
    expect(root.innerHTML, '「止」风格主字：phases 数字应入').toContain('2')
    expect(root.innerHTML, '副标应记录共 phases 数').toContain('3')
    banner.dispose()
  })

  it('多次 emit 更新而非累加——DOM 内容是最新那次 banner', () => {
    const banner = new BossPhaseBanner()
    bus.emit('boss.phase', { id: 'boss_tympanus', phase: 2, phases: 3, nameKey: 'enemy.tympanus', pos: { x: 0, y: 0, z: 0 } })
    bus.emit('boss.phase', { id: 'boss_ostlara', phase: 3, phases: 3, nameKey: 'enemy.ostlara', pos: { x: 0, y: 0, z: 0 } })
    const root = body.children.find((el) => el.id === 'boss-phase-banner')!
    expect(root.innerHTML, 'banner 反映最新 phase').toContain('奥斯塔拉')
    expect(root.innerHTML).not.toContain('鼓鼓')
    banner.dispose()
  })

  it('连续两次 boss.phase 真重播动画：第二次不再只裸 add，而是 remove→回流→add（bpb-enter 能从头跑）', () => {
    const banner = new BossPhaseBanner()
    const root = body.children.find((el) => el.id === 'boss-phase-banner')!
    bus.emit('boss.phase', { id: 'boss_a', phase: 2, phases: 3, nameKey: 'enemy.ostlara', pos: { x: 0, y: 0, z: 0 } })
    const afterFirst = root.ops.slice()
    expect(afterFirst, '第一次：摘 .on → 回流 → 挂 .on').toEqual(['remove:on', 'reflow', 'add:on'])
    root.ops.length = 0
    bus.emit('boss.phase', { id: 'boss_b', phase: 3, phases: 3, nameKey: 'enemy.myriad', pos: { x: 0, y: 0, z: 0 } })
    expect(root.ops, '第二次同样真重播，不是对已在的 .on 做 no-op add').toEqual(['remove:on', 'reflow', 'add:on'])
    expect(root.innerHTML, '且内容更新到第二位 Boss 的新阶段').toContain('万籁 The Myriad')
    expect(root.classList.contains('on'), '重播后仍亮').toBe(true)
    banner.dispose()
  })

  it('dispose 摘掉 DOM 且退订：dispose 后再 emit 不复活节点、不抛', () => {
    const banner = new BossPhaseBanner()
    banner.dispose()
    expect(() => bus.emit('boss.phase', { id: 'boss_z', phase: 2, phases: 3, nameKey: 'enemy.ostlara', pos: { x: 0, y: 0, z: 0 } })).not.toThrow()
    expect(body.children.find((el) => el.id === 'boss-phase-banner'), '退订后 emit 不该重建节点').toBeUndefined()
  })

  it('dispose 摘掉 DOM，body 上不再有 #boss-phase-banner', () => {
    const banner = new BossPhaseBanner()
    expect(body.children.find((el) => el.id === 'boss-phase-banner')).toBeDefined()
    banner.dispose()
    expect(body.children.find((el) => el.id === 'boss-phase-banner')).toBeUndefined()
  })

  it('CSS 已落 head：含 bpb-enter keyframes / reduced-motion 兜底 / 双角线主题', () => {
    const banner = new BossPhaseBanner()
    const css = head.children.map((c) => (c as unknown as { textContent: string }).textContent ?? '').join('\n')
    expect(css).toContain('.boss-phase-banner')
    expect(css).toContain('@keyframes bpb-enter')
    expect(css).toContain('prefers-reduced-motion')
    expect(css).toContain('.corner-left')
    expect(css).toContain('.corner-right')
    banner.dispose()
  })
})
