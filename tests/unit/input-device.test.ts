import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_BINDS, Input } from '@/core/Input'

/**
 * Input：键盘/鼠标设备腿（ui-intents 测的是意图通道，这里测玩法通道的设备侧）。
 *
 * 覆盖缺口：
 * - mousedown/mouseup ⇒ mouseHeld 的置位与清除（左键轻击/右键重击）
 * - mousemove 只有 pointerLock 命中 canvas 才累计（锁不住 ⇒ 不看镜头）
 * - blur ⇒ 键盘/鼠标/手柄三套 held 全清（切出去回来不留"鬼键"）
 * - buffer/consume/endTick：边沿保活 0.2s、消费一次、仍按着的已保活边沿在 endTick 回收
 */

class FakeEl {
  handlers: Record<string, ((e: unknown) => void)[]> = {}
  locks = 0
  addEventListener(t: string, fn: (e: unknown) => void): void { (this.handlers[t] ??= []).push(fn) }
  requestPointerLock(): void { this.locks++ }
  emit(t: string, e: unknown): void { for (const fn of this.handlers[t] ?? []) fn(e) }
}

let win: Record<string, ((e: unknown) => void)[]> = {}
let prevented: string[] = []
let doc: { pointerLockElement: unknown }

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  doc = { pointerLockElement: null }
  g.document = doc
  g.window = {
    addEventListener: (t: string, fn: (e: unknown) => void): void => { (win[t] ??= []).push(fn) },
  }
})

beforeEach(() => { win = {}; prevented = []; doc.pointerLockElement = null })

const key = (code: string, up = false): void => {
  const e = { code, repeat: false, preventDefault: (): void => { prevented.push(code) } }
  for (const fn of win[up ? 'keyup' : 'keydown'] ?? []) fn(e)
}

function input(): { input: Input; el: FakeEl } {
  const el = new FakeEl()
  return { input: new Input(el as unknown as HTMLElement), el }
}

/**
 * KI-360：`mousedown` 从 canvas 搬到了 window（面板那层遮罩盖住 canvas，等待途中那一下只有挂在
 * window 上才按得到）。搬过来之后"这一下落在世界上"就成了一格**要说出来的事实**，量具因此必须自己
 * 交 `target`——`on` 缺省就是那块 canvas，写在屏上"落在别处"的那几条腿传一个别的对象。
 */
const mouseDown = (el: FakeEl, button: number, on: unknown = el): void => {
  for (const fn of win.mousedown ?? []) fn({ button, target: on, preventDefault: (): void => { prevented.push(`button${button}`) } })
}

describe('Input：鼠标按键与指针锁定', () => {
  it('左键按下 ⇒ attackLight 进 held+edges，还顺手锁指针；松开 ⇒ 清除', () => {
    const { input: inp, el } = input()
    mouseDown(el, 0)
    expect(el.locks).toBe(1)
    inp.poll(1 / 60)
    expect(inp.frame.held.has('attackLight')).toBe(true)
    expect(inp.frame.edges.has('attackLight')).toBe(true)
    // mouseup 监听在 window 上
    for (const fn of win.mouseup ?? []) fn({ button: 0 })
    inp.poll(1 / 60)
    expect(inp.frame.held.has('attackLight')).toBe(false)
  })

  it('右键（`button=2`）⇒ attackHeavy', () => {
    const { input: inp, el } = input()
    mouseDown(el, 2)
    inp.poll(1 / 60)
    expect(inp.frame.held.has('attackHeavy')).toBe(true)
  })

  it('mousemove 只有锁住 canvas 才累计 look；没锁 ⇒ 镜头不动', () => {
    const { input: inp, el } = input()
    el.emit('mousemove', { movementX: 100, movementY: 50 })
    inp.poll(1 / 60)
    expect(inp.frame.look.dx).toBe(0)
    doc.pointerLockElement = el
    // mousemove 监听在 window 上
    for (const fn of win.mousemove ?? []) fn({ movementX: 100, movementY: 50 })
    inp.poll(1 / 60)
    expect(inp.frame.look.dx).toBeCloseTo(100 * 0.0022)
    expect(inp.frame.look.dy).toBeCloseTo(50 * 0.0022)
    inp.poll(1 / 60)
    expect(inp.frame.look.dx, '读完一帧就清零，不滚雪球').toBe(0)
  })

  it('blur ⇒ 三套 held 全清：切出去时按着 W，回来那一帧不该自己往前走', () => {
    const { input: inp } = input()
    key('KeyW')
    inp.poll(1 / 60)
    expect(inp.frame.held.has('moveUp')).toBe(true)
    for (const fn of win.blur ?? []) fn({})
    inp.poll(1 / 60)
    expect(inp.frame.held.has('moveUp')).toBe(false)
    expect(inp.frame.move.x).toBe(0)
    expect(inp.frame.move.y).toBe(0)
  })
})

describe('KI-360 三枚标准鼠标键各归各的：中键不再冒充右键，扩展键一格都不发', () => {
  it('中键（`button=1`，DOM 里那枚滚轮按下）⇒ 说的是 `MouseMiddle`，默认没人绑它 ⇒ 一记重击都不许发', () => {
    const { input: inp, el } = input()
    mouseDown(el, 1)
    inp.poll(1 / 60)
    expect(inp.frame.held.has('attackHeavy'), '今天"非左即右"把它读成右键那一支：按滚轮等于凭空一记重击').toBe(false)
    expect([...inp.frame.edges]).toEqual([])
  })

  it('把中键绑给一个动词之后，它发的就是那一个、抬的也是那一个（第三枚键第一次有自己的落点）', () => {
    const { input: inp, el } = input()
    inp.setBindings({
      gameplay: { ...DEFAULT_BINDS, keyboard: { MouseMiddle: 'parry' }, padButtons: {}, padAxes: { moveX: 0, moveY: 1, camX: 2, camY: 3 }, unbound: [], padUnbound: [] },
      ui: { keyboard: {}, padButtons: {}, stickThreshold: 0.55, unbound: [], padUnbound: [] }
    })
    mouseDown(el, 1)
    inp.poll(1 / 60)
    expect([...inp.frame.edges]).toEqual(['parry'])
    for (const fn of win.mouseup ?? []) fn({ button: 1 })
    inp.poll(1 / 60)
    expect(inp.frame.held.has('parry'), '抬起要抬得动它自己那一枚——按下记的是中键、抬起却去清右键，就是一只永远松不开的手').toBe(false)
  })

  it('第四、第五枚扩展键不在那三格里 ⇒ 既不发行动，也不顺手把指针锁走', () => {
    const { input: inp, el } = input()
    mouseDown(el, 3)
    inp.poll(1 / 60)
    expect([...inp.frame.edges], '浏览器报来的扩展键不是「非左即右」').toEqual([])
    expect(el.locks, '那三枚之外的按下对这一格什么都不是，连指针都不该锁').toBe(0)
    mouseDown(el, 4)
    inp.poll(1 / 60)
    expect([...inp.frame.edges], '第五枚也一样').toEqual([])
    expect(el.locks).toBe(0)
  })

  it('按下搬到 window 之后唯一多出来的那条规矩：落在世界之外的一下不是玩法输入（不锁指针）', () => {
    const { input: inp, el } = input()
    const panel = { name: '面板上的一行' }
    mouseDown(el, 0, panel)
    inp.poll(1 / 60)
    expect([...inp.frame.edges], '这一行没等键，那一下是面板的一下，不是玩家挥出的一记轻击').toEqual([])
    expect(el.locks, '而拿指针锁走的是那一下点在世界上——点面板不该锁').toBe(0)
    for (const fn of win.mouseup ?? []) fn({ button: 0 })
    mouseDown(el, 0)
    inp.poll(1 / 60)
    expect([...inp.frame.edges], '同一个 button 落在 canvas 上才是一次使用（抬起那边不问坐标，见上面那条腿）').toEqual(['attackLight'])
  })
})

describe('Input：边沿保活 buffer/consume/endTick', () => {
  it('buffer 住的边沿在后续帧里重放，直到 0.2s 过期', () => {
    const { input: inp } = input()
    inp.buffer('jump')
    inp.poll(1 / 60)
    expect(inp.frame.edges.has('jump'), '保活期内没按也有边沿').toBe(true)
    for (let i = 0; i < 20; i++) inp.poll(1 / 60)
    expect(inp.frame.edges.has('jump'), '0.2s 走完 ⇒ 过期').toBe(false)
  })

  it('consume 吃掉边沿：第一次 true，第二次 false（同一帧内不许两家分吃）', () => {
    const { input: inp } = input()
    key('Space')
    inp.poll(1 / 60)
    expect(inp.consume('jump')).toBe(true)
    expect(inp.consume('jump')).toBe(false)
    expect(inp.consume('dodge'), '没出现过的边沿 ⇒ false').toBe(false)
  })

  it('endTick 回收"还按着的已保活边沿"：下一帧不再重放', () => {
    const { input: inp } = input()
    key('Space') // jump 按住不放
    inp.buffer('jump')
    inp.poll(1 / 60)
    expect(inp.frame.edges.has('jump')).toBe(true)
    inp.endTick()
    inp.poll(1 / 60)
    expect(inp.frame.edges.has('jump'), '保活的那一份已被回收，还按着也不重放').toBe(false)
  })
})
