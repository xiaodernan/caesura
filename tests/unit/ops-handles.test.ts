import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { TICK_DT } from '@/core/Time'
import { Input } from '@/core/Input'
import { BindingsStore, defaultBindings } from '@/settings/Bindings'
import { GAMEPLAY_BOUNDS, GameplaySettingsStore } from '@/settings/GameplaySettings'
import { makeOpsHandles } from '@/ui/OpsHandles'

/**
 * KI-337：「操作」页把手的那个装配处（`src/ui/OpsHandles.ts`）自己。
 *
 * 玩家那一半在 `tests/flow/controls-page.test.ts`，机制那一半在 `tests/unit/key-capture.test.ts`，
 * 这一份量的只有中间那层接线——它此前没有证人，于是有两个真 bug 的形状它拦不住：
 *  ① 装配处**绕过 store 直接改 `Input`**：看上去改键成功了，存档里那一格却还是默认的
 *    （键位的唯一主人是 store，`Input` 只是它的读者）；
 *  ② 装配处**在面板构造那一拍就去读 store**：组合根里那两个 store 声明在面板之后，
 *    于是浏览器里开面板就 `ReferenceError`，而假件世界永远测不到（假件把 store 建在前面）。
 * 这两条都落在"接线"上，所以判据也只问接线：名册对不对得上端口、什么时候读、读到的是不是那唯一的主人。
 */

const SRC = fileURLToPath(new URL('../../src', import.meta.url))

class FakeEl {
  handlers: Record<string, ((e: unknown) => void)[]> = {}
  addEventListener(t: string, fn: (e: unknown) => void): void { (this.handlers[t] ??= []).push(fn) }
  requestPointerLock(): void { /* 无头，不锁 */ }
}

let win: Record<string, ((e: unknown) => void)[]> = {}

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  g.document = { createElement: () => new FakeEl(), head: new FakeEl(), body: new FakeEl(), pointerLockElement: null }
  g.window = { addEventListener: (t: string, fn: (e: unknown) => void): void => { (win[t] ??= []).push(fn) } }
})

beforeEach(() => { win = {} })

function key(code: string): void {
  for (const fn of win.keydown ?? []) fn({ code, repeat: false, preventDefault: (): void => {} })
}

/** 一套真的接线（真 Input + 真 store），加上两个"被读了几次"的计数探针 */
function seam(): { input: Input; bindings: BindingsStore; gameplay: GameplaySettingsStore; deps: ReturnType<typeof makeOpsHandles>; reads: { bindings: number; gameplay: number } } {
  const input = new Input(new FakeEl() as unknown as HTMLElement)
  const bindings = new BindingsStore({ input })
  const gameplay = new GameplaySettingsStore({ input, rig: { shakeIntensity: 1 }, haptics: { scale: 1 }, combat: { damageScale: 1 } })
  const reads = { bindings: 0, gameplay: 0 }
  const deps = makeOpsHandles(input,
    () => { reads.bindings++; return bindings },
    () => { reads.gameplay++; return gameplay })
  return { input, bindings, gameplay, deps, reads }
}

/** 端口那一侧声明的格子（从面板的源文件里现推，不在测试里另抄一份名册） */
function portRoster(): string[] {
  const src = readFileSync(`${SRC}/ui/Stakerite.ts`, 'utf8').replace(/\r\n/g, '\n')
  const from = src.indexOf('export interface OpsPanelDeps {')
  expect(from, '端口自己得还在它住的地方（改名/挪家要连着这里）').toBeGreaterThanOrEqual(0)
  const body = src.slice(from, src.indexOf('\n}', from))
  return [...body.matchAll(/^ {2}(\w+)[:(]/gm)].map((m) => m[1]).sort()
}

describe('KI-337 把手装配处：名册、时机、主人', () => {
  it('交出去的格子与面板声明的那个端口一字不差，而且里面只有函数', () => {
    const { deps } = seam()
    expect(Object.keys(deps).sort(), '端口加一格/装配处漏一格，两边就是两个世界').toEqual(portRoster())
    for (const [k, v] of Object.entries(deps)) {
      if (k === 'capture') {
        // 那一格是三个把手的一个袋子，不是第七个函数——袋子里也不许藏数据格
        expect(Object.keys(v).sort(), '捕获那一组只有 arm/cancel/take').toEqual(['arm', 'cancel', 'take'])
        for (const [c, f] of Object.entries(v)) expect(typeof f, `capture.${c} 必须是函数`).toBe('function')
      } else {
        expect(typeof v, `${k} 必须是函数——面板只拿函数`).toBe('function')
      }
    }
  })

  it('装配那一刻一个 store 都不碰：组合根里那两个 store 声明在面板之后', () => {
    const { reads } = seam()
    expect(reads, '建面板的那一拍就去读 store ⇒ 真浏览器里 ReferenceError，假件里永远测不到').toEqual({ bindings: 0, gameplay: 0 })
  })

  it('每一格只在被点的那一拍取它的主人，一次', () => {
    const { deps, reads } = seam()
    deps.gameplay()
    expect(reads, 'gameplay() 读一次 store').toEqual({ bindings: 0, gameplay: 1 })
    deps.setGameplay({ bufferMs: 200 })
    expect(reads.gameplay, 'setGameplay 也只在被叫那一拍读').toBe(2)
    deps.rebind('dodge', 'KeyY')
    deps.resetKey('dodge')
    deps.resetAll()
    expect(reads.bindings, '三格键位把手各取一次 bindings').toBe(3)
  })

  it('玩法那一格落到 store，并真的走到消费者：面板写的就是 `Input` 生效的那一个数', () => {
    const { deps, input, gameplay } = seam()
    const lo = GAMEPLAY_BOUNDS.bufferMs.min
    deps.setGameplay({ bufferMs: lo - 400 })
    expect(deps.gameplay().bufferMs, '越界的一格由 store 夹住，装配处不许自己兜底').toBe(lo)
    expect(gameplay.get().bufferMs).toBe(lo)
    expect(input.bufferSec).toBeCloseTo(lo / 1000, 6)
  })

  it('改键落到 store 而不是绕过它写 `Input`：现表与存档读数一起变，档里才带得走', () => {
    const { deps, input, bindings } = seam()
    deps.rebind('dodge', 'KeyY')
    expect(input.binds.keyboard.KeyY, '玩家按下 Y 就该闪避：`Input` 手里那张现表已换').toBe('dodge')
    expect(bindings.get().gameplay.keyboard.KeyY, '绕过 store 直接改 Input 的话这一格还是空的 ⇒ 档里带不走').toBe('dodge')
  })

  it('resetKey 只抹那一格、resetAll 抹整张，两个都回到默认表那一格', () => {
    const { deps, bindings } = seam()
    deps.rebind('dodge', 'KeyY')
    deps.rebind('jump', 'KeyZ')
    deps.resetKey('jump')
    expect(bindings.get().gameplay.keyboard.KeyZ, '归位之后 Z 不再是谁的键').toBeUndefined()
    expect(bindings.get().gameplay.keyboard.Space, 'jump 回到它在默认表上的那一格').toBe('jump')
    expect(bindings.get().gameplay.keyboard.KeyY, '另一格不受牵连').toBe('dodge')
    deps.resetAll()
    expect(bindings.get().gameplay.keyboard, '整张回默认').toEqual(defaultBindings().gameplay.keyboard)
  })

  it('捕获那三个把手就是 `Input` 的那三个：装配处不自己养一份等待状态', () => {
    const { deps, input } = seam()
    deps.capture.arm()
    key('KeyY')
    expect(deps.capture.take(), '取走的是那一枚物理键').toBe('KeyY')
    expect(deps.capture.take(), '取过即熄灭：同一枚键被看两遍就是两个主人').toBeNull()
    deps.capture.arm()
    deps.capture.cancel()
    key('ControlLeft'); input.poll(TICK_DT)
    expect([...input.frame.edges], '取消之后那一枚键回到正常通道').toEqual(['dodge'])
  })
})
