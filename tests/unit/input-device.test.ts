import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Input } from '@/core/Input'

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

describe('Input：鼠标按键与指针锁定', () => {
  it('左键按下 ⇒ attackLight 进 held+edges，还顺手锁指针；松开 ⇒ 清除', () => {
    const { input: inp, el } = input()
    el.emit('mousedown', { button: 0 })
    expect(el.locks).toBe(1)
    inp.poll(1 / 60)
    expect(inp.frame.held.has('attackLight')).toBe(true)
    expect(inp.frame.edges.has('attackLight')).toBe(true)
    // mouseup 监听在 window 上
    for (const fn of win.mouseup ?? []) fn({ button: 0 })
    inp.poll(1 / 60)
    expect(inp.frame.held.has('attackLight')).toBe(false)
  })

  it('右键 ⇒ attackHeavy；中键（button=2）⇒ 不是左右键，按右键那一支处理', () => {
    const { input: inp, el } = input()
    el.emit('mousedown', { button: 2 })
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
