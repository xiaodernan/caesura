import { describe, expect, it, beforeAll } from 'vitest'
import { registerGameData } from '@/data'
import { RpgRuntime } from '@/rpg/Runtime'

/**
 * 调音桩面板（Phase 5-B 的 UI 落点）。
 *
 * 本仓库没有 DOM 测试环境（零新增依赖策略），所以这里用一个**最小 DOM 替身**只验面板自己的
 * 契约：状态机（开/关/切页）、渲染内容（音级、六维、七槽、材料数）、动作派发
 * （点一下真的改了 RpgRuntime 的状态）。
 * 真实视口下的排版评审仍受 KI-010（隐藏标签页无法截图）限制，登记在 KNOWN_ISSUES。
 */

class FakeEl {
  id = ''
  className = ''
  textContent = ''
  innerHTML = ''
  dataset: Record<string, string> = {}
  private classes = new Set<string>()
  children: FakeEl[] = []
  handlers: Record<string, ((e: unknown) => void)[]> = {}
  classList = {
    add: (c: string) => { this.classes.add(c) },
    remove: (c: string) => { this.classes.delete(c) },
    contains: (c: string) => this.classes.has(c)
  }
  style = { textContent: '' }
  appendChild(c: FakeEl): FakeEl { this.children.push(c); return c }
  addEventListener(t: string, fn: (e: unknown) => void): void { (this.handlers[t] ??= []).push(fn) }
  dispatch(t: string, e: unknown): void { for (const fn of this.handlers[t] ?? []) fn(e) }
  /** 只有点击测试会用到：把事件目标伪装成某个 [data-act] 元素 */
  closest(): FakeEl | null { return this.dataset.act ? this : null }
}

let body: FakeEl
let winHandlers: Record<string, ((e: unknown) => void)[]> = {}

beforeAll(() => {
  body = new FakeEl()
  const head = new FakeEl()
  const g = globalThis as unknown as Record<string, unknown>
  g.document = {
    createElement: () => new FakeEl(),
    head,
    body,
    getElementById: () => new FakeEl()
  }
  g.window = {
    addEventListener: (t: string, fn: (e: unknown) => void) => { (winHandlers[t] ??= []).push(fn) }
  }
})

async function panel(runtime: RpgRuntime) {
  const { Stakerite } = await import('@/ui/Stakerite')
  const applied: number[] = []
  const notes: string[] = []
  const heals: number[] = []
  const p = new Stakerite(runtime, {
    onApply: () => applied.push(1),
    notify: (t) => notes.push(t),
    onHeal: (h) => heals.push(h)
  })
  return { p, applied, notes, heals }
}

/** 面板把内容塞在 root.innerHTML 里；取出来当字符串断言（替身不做真解析） */
function html(p: unknown): string {
  return (p as { root?: FakeEl } & object) && ((p as unknown as { root: FakeEl }).root.innerHTML)
}

function click(root: FakeEl, act: string, arg = ''): void {
  const el = new FakeEl()
  el.dataset = { act, arg }
  root.dispatch('click', { target: el })
}

describe('调音桩面板：状态机与内容', () => {
  it('初始是收起的；show() 后渲染出音级、六维、洗点与派生值', async () => {
    registerGameData()
    const rt = new RpgRuntime('origin_tuner')
    const { p } = await panel(rt)
    const root = (p as unknown as { root: FakeEl }).root
    expect(p.isOpen).toBe(false)
    expect(root.classList.contains('on')).toBe(false)
    p.show()
    expect(p.isOpen).toBe(true)
    expect(root.classList.contains('on')).toBe(true)
    const s = html(p)
    expect(s).toContain('调音桩')
    expect(s).toContain('音级')
    for (const name of ['基音', '指法', '音色', '腔体', '泛音', '失谐']) expect(s).toContain(name)
    expect(s).toContain('洗点')
    expect(s).toContain('负重上限')
    expect(s).toContain('音色石')
    p.close()
    expect(p.isOpen).toBe(false)
  })

  it('方向键切页：调音 → 装备 → 行囊 各自渲染自己的内容', async () => {
    const rt = new RpgRuntime('origin_tuner')
    rt.inv.add('it_timbite', 12)
    rt.inv.add('it_echo_salve', 2)
    const { p } = await panel(rt)
    p.show()
    const key = (code: string) => { for (const fn of winHandlers.keydown ?? []) fn({ code, preventDefault() {} }) }
    key('ArrowRight')
    expect(html(p)).toContain('七槽')
    expect(html(p)).toContain('调律剑')
    key('ArrowRight')
    expect(html(p)).toContain('通货')
    expect(html(p)).toContain('消耗品')
    key('ArrowRight')
    expect(html(p)).toContain('六音级属性')
  })

  it('点「+1」真的分配音级点，并触发一次应用回调（面板不自己写应用逻辑）', async () => {
    const rt = new RpgRuntime('origin_tuner')
    const { p, applied } = await panel(rt)
    p.show()
    const root = (p as unknown as { root: FakeEl }).root
    const before = rt.prog.attrs.str
    click(root, 'alloc', 'str') // 没有点数 ⇒ 不该变
    expect(rt.prog.attrs.str).toBe(before)
    rt.prog.addResonance(400)
    p.show()
    click(root, 'alloc', 'str')
    expect(rt.prog.attrs.str).toBe(before + 1)
    expect(rt.prog.unspent).toBe(3)
    expect(applied.length).toBeGreaterThan(0)
  })

  it('点「强化」扣材料并升级；材料不够时给一句人话而不是静默失败', async () => {
    const rt = new RpgRuntime('origin_tuner')
    const { p, notes } = await panel(rt)
    p.show()
    const root = (p as unknown as { root: FakeEl }).root
    const weapon = rt.inv.gears.find((g) => g.itemId === 'wp_tuning_sword_item')!
    click(root, 'upgrade', weapon.uid)
    expect(weapon.level, '没有材料 ⇒ 不升').toBe(0)
    expect(notes.some((n) => n.includes('材料不足'))).toBe(true)
    rt.inv.add('it_timbite', 500)
    rt.inv.add('it_dross', 50)
    click(root, 'upgrade', weapon.uid)
    expect(weapon.level).toBe(1)
    expect(notes.some((n) => n.includes('强化 +1'))).toBe(true)
  })

  it('点「使用」消耗品会真的消耗一件并把回血量交给宿主', async () => {
    const rt = new RpgRuntime('origin_tuner')
    const { p, heals } = await panel(rt)
    p.show()
    const root = (p as unknown as { root: FakeEl }).root
    rt.inv.add('it_echo_salve', 1)
    click(root, 'use', 'it_echo_salve')
    expect(rt.inv.count('it_echo_salve')).toBe(0)
    expect(heals[0]).toBeGreaterThan(0)
  })

  it('点「卸下」把槽位清空（不会留下指向空气的 uid）', async () => {
    const rt = new RpgRuntime('origin_tuner')
    const { p } = await panel(rt)
    p.show()
    const root = (p as unknown as { root: FakeEl }).root
    expect(rt.eq.slots.weapon).toBeTruthy()
    click(root, 'unequip', 'weapon')
    expect(rt.eq.slots.weapon).toBeUndefined()
    expect(rt.mods().weaponId).toBeNull()
  })
})
