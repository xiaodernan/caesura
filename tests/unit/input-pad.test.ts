import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_BINDS, Input } from '@/core/Input'

/**
 * KI-105①：手柄 L3（标准映射的左摇杆点击 = 按钮 10）⇒ observe 的 pad 腿。
 *
 * 裁决与理由住在 src/core/Input.ts 的绑定表注释里：声纹观察是「按一下发一波」的脉冲型动词，
 * 点摇杆正是这个手感；原来住在 10 上的 attackLight 退守 13（十字键下）。这里守三件事：
 * 行为腿（按下=脉冲、按住不连发、松开清掉）、退守格（13 仍能打出轻攻击）、
 * 以及两条通道互不沾（10 不是 UI 键，面板开着时它什么都不说）。
 */

class FakeEl {
  handlers: Record<string, ((e: unknown) => void)[]> = {}
  addEventListener(t: string, fn: (e: unknown) => void): void { (this.handlers[t] ??= []).push(fn) }
  requestPointerLock(): void { /* 与读数无关 */ }
}

let win: Record<string, ((e: unknown) => void)[]> = {}

/** 一颗可编程的手柄：padButtons 表到 18 为止，按钮位开 19 个。测试按索引去推。 */
function pad(pressed: number[] = []): void {
  // Node 24 上 `navigator` 是只读 getter（直接赋值会抛），所以用 defineProperty 换掉
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      getGamepads: () => [{
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 19 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
        mapping: 'standard', connected: true,
      }],
    },
  })
}

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  g.window = {
    addEventListener: (t: string, fn: (e: unknown) => void): void => { (win[t] ??= []).push(fn) },
  }
})

// 每条用例都从"手柄松着"开始：一条用例挂了就会把它按着的按钮留在场上，下一条的第一帧
// 就会读到一次不属于自己的边沿（ui-intents.test.ts 实测过的同一口坑）。
beforeEach(() => { win = {}; pad() })

const fresh = (): Input => new Input(new FakeEl() as unknown as HTMLElement)

describe('KI-105① 手柄 L3 ⇒ observe', () => {
  it('按下 pad 键 10 ⇒ observe 有 held 也有 edge，且 attackLight 不再从 10 来', () => {
    const inp = fresh()
    pad([10])
    inp.poll(1 / 60)
    expect(inp.frame.held.has('observe'), 'L3 按着：observe 该是 held').toBe(true)
    expect(inp.frame.edges.has('observe'), '第一帧：observe 该有边沿').toBe(true)
    expect(inp.frame.held.has('attackLight'), '轻攻击不再住在 10 上').toBe(false)
    expect(inp.frame.edges.has('attackLight'), '换绑不许顺手送一次轻攻击').toBe(false)
  })

  it('按住不放不连发；松开 ⇒ 读数清掉', () => {
    const inp = fresh()
    pad([10])
    inp.poll(1 / 60)
    inp.poll(1 / 60)
    expect(inp.frame.held.has('observe')).toBe(true)
    expect(inp.frame.edges.has('observe'), '一直按着不是连点：脉冲只发一波').toBe(false)
    pad([])
    inp.poll(1 / 60)
    expect(inp.frame.held.has('observe'), '松开了就该松手').toBe(false)
    expect(inp.frame.edges.has('observe')).toBe(false)
  })

  it('十字键下（13）仍是 attackLight 的家——轻攻击退守的那格没空着', () => {
    const inp = fresh()
    pad([13])
    inp.poll(1 / 60)
    expect(inp.frame.edges.has('attackLight'), '退守格要真能打出轻攻击').toBe(true)
    expect(inp.frame.held.has('attackLight')).toBe(true)
  })

  it('绑定表钉：10=observe / 13=attackLight / 键盘 KeyV=observe', () => {
    expect(DEFAULT_BINDS.padButtons[10], '标准映射的 L3 = 左摇杆点击').toBe('observe')
    expect(DEFAULT_BINDS.padButtons[13], '轻攻击的退守格').toBe('attackLight')
    expect(DEFAULT_BINDS.keyboard.KeyV, '键盘那条 observe 的原位不动').toBe('observe')
  })

  it('UI 通道不受影响：面板开着（enabled=false + uiOwner=panel）按 10，两条通道都安静', () => {
    const inp = fresh()
    inp.enabled = false
    inp.uiOwner = 'panel'
    pad([10])
    inp.poll(1 / 60)
    expect(inp.uiEdges.size, '10 不是 UI 键：菜单一格意图都不该有').toBe(0)
    expect(inp.frame.edges.size, '世界停着：玩法那条一条边沿都不该有').toBe(0)
  })
})
