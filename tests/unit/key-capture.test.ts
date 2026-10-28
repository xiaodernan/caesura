import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { TICK_DT } from '@/core/Time'
import { Input } from '@/core/Input'
import { BindingsStore } from '@/settings/Bindings'

/**
 * KI-337：「下一枚物理键」这件事的机制半格（玩家那一半在 `tests/flow/controls-page.test.ts`）。
 *
 * 为什么这组判据住在 `Input` 而不是面板：面板自己挂 `keydown` 会被源码闸门判红（DOM 一条 +
 * 菜单一条 = 一次按键被数两遍），所以捕获只能住在**已经有那一条监听器**的地方。
 * 而它一住进来就多了一条新规矩：**武装期间两条通道都要哑**。任何一条没哑，玩家按下要绑的那把键
 * 就会顺手发一次动作（在暂停面板里按 Ctrl ⇒ 世界已经闪了一下），那是改键界面最典型的坏形状。
 */

class FakeEl {
  handlers: Record<string, ((e: unknown) => void)[]> = {}
  addEventListener(t: string, fn: (e: unknown) => void): void { (this.handlers[t] ??= []).push(fn) }
  requestPointerLock(): void { /* 无头，不锁 */ }
}

let win: Record<string, ((e: unknown) => void)[]> = {}
let prevented: string[] = []

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  g.document = { createElement: () => new FakeEl(), head: new FakeEl(), body: new FakeEl(), pointerLockElement: null }
  g.window = { addEventListener: (t: string, fn: (e: unknown) => void): void => { (win[t] ??= []).push(fn) } }
})

beforeEach(() => { win = {}; prevented = [] })

/** 往 window 上推一次键（`Input` 的键盘监听挂在 window） */
function key(code: string, up = false, repeat = false): void {
  const e = { code, repeat, preventDefault: (): void => { prevented.push(code) } }
  for (const fn of win[up ? 'keyup' : 'keydown'] ?? []) fn(e)
}

const input = (): Input => new Input(new FakeEl() as unknown as HTMLElement)

describe('KI-337 改键捕获：武装期间两条通道都哑', () => {
  it('下一枚键只被记成键名：玩法不发、菜单也不发', () => {
    const inp = input()
    inp.uiOwner = 'panel'
    inp.armKeyCapture()
    key('KeyY')
    inp.poll(TICK_DT)
    expect([...inp.frame.edges], 'Y 在默认表上谁的键都不是，但仍不许被当成"某个动作"').toEqual([])
    expect([...inp.uiEdges], '菜单那条同样一格不发').toEqual([])
    expect(inp.takeKeyCapture(), '取走的是物理键名').toBe('KeyY')
  })

  it('绑过动作的那把键在等待中也不发动作（这才是"改键时不误触"的那半）', () => {
    const inp = input()
    inp.armKeyCapture()
    key('ControlLeft')   // 默认表上 = dodge
    inp.poll(TICK_DT)
    expect([...inp.frame.edges], '闪避没有被这一枚 Ctrl 打出去').toEqual([])
    expect(inp.takeKeyCapture()).toBe('ControlLeft')
  })

  it('等待中的那一枚仍走 preventDefault：按空格改键不该顺手把页面滚一下', () => {
    const inp = input()
    inp.armKeyCapture()
    key('Space')
    expect(prevented, '空格是浏览器的滚动键，挡住它是这一格的本分').toContain('Space')
    inp.poll(TICK_DT)   // 没有这一拍，下面那句读的是**初始**那个 frame，永远空 ⇒ 这一半就是空转
    expect(inp.frame.edges.has('jump'), '挡住了浏览器，也没漏出动作').toBe(false)
    // 第二截才是"捕获自己挡浏览器"的证人：Y 既不在应用占键名册里、默认表上也不是谁的键，
    // 正常那条路一个 preventDefault 都不会调 ⇒ 这一枚被挡住只能是因为捕获。
    inp.armKeyCapture()
    key('KeyY')
    expect(prevented, '捕获那一枚拦浏览器，不靠它恰好落在名册上').toContain('KeyY')
  })

  it('取走即熄灭：同一枚键被看两遍就是两个主人', () => {
    const inp = input()
    inp.armKeyCapture()
    key('KeyY')
    expect(inp.takeKeyCapture()).toBe('KeyY')
    expect(inp.takeKeyCapture(), '第二次问什么都没有了').toBeNull()
    key('ControlLeft'); inp.poll(TICK_DT)
    expect([...inp.frame.edges], '熄灭之后正常通道立刻回来').toEqual(['dodge'])
  })

  it('没按时一格都不动——尤其不许顺手撤掉武装（面板每帧都要问一次）', () => {
    const inp = input()
    inp.armKeyCapture()
    for (let f = 0; f < 3; f++) {
      inp.poll(TICK_DT)
      expect(inp.takeKeyCapture(), `第 ${f + 1} 帧没人按`).toBeNull()
    }
    key('KeyY')
    expect(inp.takeKeyCapture(), '问了三帧没人按，第四帧按下的那一枚仍要有人接').toBe('KeyY')
  })

  it('cancel 之后那一枚键回到正常通道：只撤面板的等待不撤机制，会留下一枚没人接的键', () => {
    const inp = input()
    inp.armKeyCapture()
    inp.cancelKeyCapture()
    key('ControlLeft'); inp.poll(TICK_DT)
    expect([...inp.frame.edges], '取消之后按 Ctrl 就是闪避，不是凭空消失').toEqual(['dodge'])
    expect(inp.takeKeyCapture(), '取消不留残余').toBeNull()
  })

  it('长按连发的 repeat 不算"玩家按下的那一枚键"', () => {
    const inp = input()
    inp.armKeyCapture()
    key('ControlLeft', false, true)
    expect(inp.takeKeyCapture(), '操作系统替按住不放补发的重复事件不能替玩家做决定').toBeNull()
    key('KeyY')
    expect(inp.takeKeyCapture(), '真正的按下仍然要接得住').toBe('KeyY')
  })

  it('捕获只管 keydown：松开照常放行，等键途中不会把"还按着"留在表里', () => {
    const inp = input()
    key('ControlLeft'); inp.poll(TICK_DT)
    expect([...inp.frame.held]).toEqual(['dodge'])
    inp.armKeyCapture()
    key('ControlLeft', true)   // 等待途中松开
    inp.poll(TICK_DT)
    expect([...inp.frame.held], 'keyup 不被捕获挡 ⇒ 不留鬼键').toEqual([])
    expect(inp.takeKeyCapture(), '松开不算按下').toBeNull()
  })

  it('换表那一拍不清捕获：等键途中改了键位，那一枚键仍归改键', () => {
    const inp = input()
    const store = new BindingsStore({ input: inp })
    inp.armKeyCapture()
    store.set({ gameplay: { keyboard: { KeyY: 'dodge' } } })   // Y 现在表上是 dodge
    key('KeyY'); inp.poll(TICK_DT)
    expect(inp.takeKeyCapture(), '先记键名，再谈它是谁').toBe('KeyY')
    expect([...inp.frame.edges], '新表里 Y=dodge 也不许在等待那一帧打出闪避').toEqual([])
  })

  it('没武装过就问取 ⇒ null（面板每帧都问，包括根本没进「操作」页的那些帧）', () => {
    const inp = input()
    expect(inp.takeKeyCapture()).toBeNull()
    key('KeyY'); inp.poll(TICK_DT)
    expect(inp.takeKeyCapture(), '没武装的按下走正常通道，不进捕获').toBeNull()
    expect([...inp.frame.edges]).toEqual([])
  })
})
