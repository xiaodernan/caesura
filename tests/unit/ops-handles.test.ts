import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { TICK_DT } from '@/core/Time'
import { Input, type UiIntent } from '@/core/Input'
import { BIND_BOUNDS, BindingsStore, defaultBindings } from '@/settings/Bindings'
import { GAMEPLAY_BOUNDS, GameplaySettingsStore } from '@/settings/GameplaySettings'
import { QualityStore } from '@/settings/Quality'
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
  dispatch(t: string, e: unknown): void { for (const fn of this.handlers[t] ?? []) fn(e) }
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

/** 一套真的接线（真 Input + 真 store），加上两个「被读了几次」的计数探针 */
function seam(): { input: Input; el: FakeEl; bindings: BindingsStore; gameplay: GameplaySettingsStore; haptics: { scale: number; weakScale: number }; playerTarget: { holdMs: number; mashGuard: boolean }; deps: ReturnType<typeof makeOpsHandles>; reads: { bindings: number; gameplay: number } } {
  const el = new FakeEl()
  const input = new Input(el as unknown as HTMLElement)
  const bindings = new BindingsStore({ input })
  const haptics = { scale: 1, weakScale: 1 }
  // KI-365／KI-384：第五、六把消费者写成「还没被灌过」的形状（0 与「关」都不是各自的默认值）；
  // store 构造那一句之后它们若还是这两个值，就是没接线。
  const playerTarget = { holdMs: 0, mashGuard: false }
  const gameplay = new GameplaySettingsStore({ input, rig: { shakeIntensity: 1 }, haptics, combat: { damageScale: 1 }, player: playerTarget })
  const quality = new QualityStore({ particles: { spawnMul: 1 }, renderer: { resolutionScale: 1, shadowMapSize: 1536 } })
  const reads = { bindings: 0, gameplay: 0, quality: 0 }
  const deps = makeOpsHandles(input,
    () => { reads.bindings++; return bindings },
    () => { reads.gameplay++; return gameplay },
    () => { reads.quality++; return quality })
  return { input, el, bindings, gameplay, haptics, playerTarget, deps, reads }
}

/**
 * KI-360：鼠标那一枚的按下今天挂在 window 上（面板那层遮罩盖住 canvas，挂在 canvas 上就按不到），
 * 所以接线这一层要交的是"这一下落在哪儿"——`target` 给的是那块 canvas，因为这三条腿问的是
 * 落点（store）而不是坐标（坐标那一条在 `input-device` 里量）。
 */
const mouse = (el: FakeEl, button: number): void => {
  for (const fn of win.mousedown ?? []) fn({ button, target: el, preventDefault: (): void => {} })
}

/**
 * KI-345 起菜单那一节也用这一套接线（与上面同一个装配处、同一个 `reads` 形状）：
 * 新加的两格（`resetUi` 的 `via`、`setStickThreshold`）要的证人是**同一个**，另起一份就会有两把尺。
 */
const wire = seam

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
    /** 袋子里装的仍是函数，但那一格本身不是函数：两组各有一位主人，名册由端口自己给（见下面那条腿） */
    const bags: Record<string, string[]> = { capture: ['arm', 'cancel', 'take'], profiles: ['clear', 'list', 'load', 'store'] }
    for (const [k, v] of Object.entries(deps)) {
      if (k in bags) {
        expect(Object.keys(v).sort(), `${k} 那一组只有 ${bags[k].join('/')}`).toEqual(bags[k])
        for (const [c, f] of Object.entries(v)) expect(typeof f, `${k}.${c} 必须是函数`).toBe('function')
      } else {
        expect(typeof v, `${k} 必须是函数——面板只拿函数`).toBe('function')
      }
    }
  })

  it('装配那一刻一个 store 都不碰：组合根里那两个 store 声明在面板之后', () => {
    const { reads } = seam()
    expect(reads, '建面板的那一拍就去读 store ⇒ 真浏览器里 ReferenceError，假件里永远测不到').toEqual({ bindings: 0, gameplay: 0, quality: 0 })
  })

  it('每一格只在被点的那一拍取它的主人，一次', () => {
    const { deps, reads } = seam()
    /**
     * 问**差值**不问累计。累计那一把尺量不出"这一拍到底读没读"：装配期抢读一次冻成快照，
     * 后面每次调用都读 0 次，而累计计数器照样是 1、2、3——A14 就是从这条腿底下走过去的
     * （它红的是另外两条，这条绿着）。这条腿的标题写的就是"只在被点的那一拍"，判据得配得上这句话。
     */
    const once = (call: () => void, who: 'bindings' | 'gameplay', note: string): void => {
      const before = reads[who]
      call()
      expect(reads[who] - before, note).toBe(1)
    }
    once(() => deps.gameplay(), 'gameplay', 'gameplay() 那一拍读一次')
    once(() => deps.setGameplay({ bufferMs: 200 }), 'gameplay', 'setGameplay 那一拍也读一次')
    once(() => deps.rebind('dodge', 'KeyY'), 'bindings', 'rebind 那一拍读一次')
    once(() => deps.unbind('dodge'), 'bindings', 'unbind 那一拍读一次')
    once(() => deps.unbindPad('dodge'), 'bindings', 'unbindPad 那一拍读一次（KI-346 新加的那一格不许在装配期抢读）')
    once(() => deps.unbindUiPad('down'), 'bindings', 'unbindUiPad 那一拍读一次')
    once(() => deps.resetKey('dodge', 'key'), 'bindings', 'resetKey 那一拍读一次')
    once(() => deps.resetAll(), 'bindings', 'resetAll 那一拍读一次')
    expect(reads, '每一格各读各的主人：别格不许顺路多读一次').toEqual({ bindings: 6, gameplay: 2, quality: 0 })
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

  it('解绑同样落到 store：`Input` 手里那一格空了，名单进了 store 那一份（档里才带得走）', () => {
    const { deps, input, bindings } = seam()
    deps.unbind('dodge')
    expect(input.binds.keyboard.ControlLeft, '玩家按 Ctrl 不该再闪避').toBeUndefined()
    expect(input.binds.unbound, '消费者那份名单与 store 同一句话').toEqual(['dodge'])
    expect(bindings.get().gameplay.unbound, '绕过 store 直接写 `Input` 的话，这一格存档带不走').toEqual(['dodge'])
  })

  it('resetKey 只抹那一格、resetAll 抹整张，两个都回到默认表那一格', () => {
    const { deps, bindings } = seam()
    deps.rebind('dodge', 'KeyY')
    deps.rebind('jump', 'KeyZ')
    deps.resetKey('jump', 'key')
    expect(bindings.get().gameplay.keyboard.KeyZ, '归位之后 Z 不再是谁的键').toBeUndefined()
    expect(bindings.get().gameplay.keyboard.Space, 'jump 回到它在默认表上的那一格').toBe('jump')
    expect(bindings.get().gameplay.keyboard.KeyY, '另一格不受牵连').toBe('dodge')
    deps.resetAll()
    expect(bindings.get().gameplay.keyboard, '整张回默认').toEqual(defaultBindings().gameplay.keyboard)
  })

  it('捕获那三个把手就是 `Input` 的那三个：装配处不自己养一份等待状态', () => {
    const { deps, input } = seam()
    deps.capture.arm('key')
    key('KeyY')
    expect(deps.capture.take(), '取走的是那一枚物理键').toBe('KeyY')
    expect(deps.capture.take(), '取过即熄灭：同一枚键被看两遍就是两个主人').toBeNull()
    deps.capture.arm('key')
    deps.capture.cancel()
    key('ControlLeft'); input.poll(TICK_DT)
    expect([...input.frame.edges], '取消之后那一枚键回到正常通道').toEqual(['dodge'])
  })

  /**
   * KI-343：装配处这一层**不认识"哪张表"**——`Pad<n>` 与 `KeyY` 都是它手里的一个字符串，
   * 路由住在 `BindingsStore.rebind`。这条腿问的是接线有没有把这一格原样送到那唯一的主人面前：
   * 装配处要是自己先分了一次岔（哪怕只是"pad 那一支直接写 Input"），上面那条"绕过 store"的
   * 老 bug 形状就会从第二条路再长回来，而这次只有档里那一格是空的。
   */
  it('手柄那一格也经 store，不走第二条路：`Input` 与存档读数同时跟着换', () => {
    const { deps, input, bindings } = seam()
    deps.rebind('dodge', 'Pad2')
    expect(input.binds.padButtons[2], '消费者那张已换').toBe('dodge')
    expect(bindings.get().gameplay.padButtons[2], '绕过 store 直接写 Input 的话，这一格存档带不走').toBe('dodge')
    expect(input.binds.keyboard.ControlLeft, '而键盘那张一格都不动（两条通道各自成表）').toBe('dodge')
  })

  it('`resetKey` 的第二个参数原样送到 store：一行回默认只回那一条通道', () => {
    const { deps, bindings } = seam()
    deps.rebind('dodge', 'Pad2')
    deps.rebind('parry', 'KeyY')
    expect(deps.resetKey('dodge', 'pad'), '手柄那一行有家 ⇒ 做了').toBe(true)
    const g = bindings.get().gameplay
    expect(g.padButtons, '手柄那张逐字回默认').toEqual(defaultBindings().gameplay.padButtons)
    expect(g.keyboard.KeyY, '键盘那一行是玩家自己挪的，逐行回默认管不到它').toBe('parry')
    expect(deps.resetKey('ability1', 'pad'), '这一行在手柄上没有默认键 ⇒ 面板据此说话，不靠猜').toBe(false)
    expect(bindings.get().gameplay.padButtons, '而没有家那一格一格都不动').toEqual(defaultBindings().gameplay.padButtons)
  })
})

/**
 * KI-344：菜单那条通道的三把把手长在同一个装配处、同一个主人身上。
 *
 * 上面那两条老 bug 形状（绕过 store 直接写 `Input`、在面板构造那一拍抢读 store）在第三条通道上会复发，
 * 而这一条通道**新**的形状是「装配处替面板折了一次整组」——那一步归 `BindingsStore.rebindUi`，
 * 所以这里只问接线：格子有没有原样送到唯一主人面前、每一拍各读几次、边界的答案有没有被装配处改写。
 */
describe('KI-344 菜单那一节的三把把手：仍然只是转发', () => {
  it('`rebindUi` 落到 store 而不是绕过它写 `Input`，交回的是边界那句裁决', () => {
    const { input, bindings, deps } = wire()
    expect(deps.rebindUi('confirm', 'KeyF'), '那一把原本空着 ⇒ 没有谁被换出去，也没有谁搬家').toEqual({ displaced: null, moved: false, onto: 'keyboard' })
    expect(input.uiBinds.keyboard.KeyF, '消费者那张已换').toBe('confirm')
    expect(bindings.get().ui.keyboard.KeyF, '绕过 store 直接写 Input 的话这一格存档带不走').toBe('confirm')
    expect(Object.keys(bindings.get().ui.keyboard).filter((c) => bindings.get().ui.keyboard[c] === 'confirm'), '单元是整组 ⇒ 这一行只剩这一把')
      .toEqual(['KeyF'])
  })

  it('关不掉的格由边界回答，装配处不自己数：`back` 那一句是拒绝，`up` 那一句写的是两半', () => {
    const { bindings, deps } = wire()
    expect(deps.unbindUi('back'), '「菜单必须走得出去」由 store 说，装配处只是原样交回').toBe(false)
    expect(bindings.get().ui.unbound, '被拒绝的那一次一个字都没写').toEqual([])
    expect(deps.unbindUi('up')).toBe(true)
    const u = bindings.get().ui
    expect(u.unbound, '表里没它 ＋ 名单里有它，两半都在 store 那一份里').toEqual(['up'])
    expect(Object.values(u.keyboard), '而那张表里确实没有一格还认领着上移').not.toContain('up' as UiIntent)
  })

  it('`resetUi` 是整组回来，同时是「无」的出口；名册外的名字一格都不动', () => {
    const { bindings, deps } = wire()
    deps.rebindUi('confirm', 'KeyF')
    deps.unbindUi('up')
    expect(deps.resetUi('up', 'key'), '上移在菜单里有家 ⇒ 做了').toBe(true)
    expect(bindings.get().ui.unbound, '「回默认」顺手退名单：不退的那一格是"点了回默认、屏幕上还挂着无"').toEqual([])
    expect(deps.resetUi('confirm', 'key')).toBe(true)
    expect(bindings.get().ui.keyboard, '确认那一行回来的是整组四把，整张逐字回默认').toEqual(defaultBindings().ui.keyboard)
    expect(deps.resetUi('fly' as UiIntent, 'key'), '名册外的名字没有家 ⇒ 面板据此说话，不靠猜').toBe(false)
    expect(bindings.get().ui.keyboard, '而没有家那一格一格都不动').toEqual(defaultBindings().ui.keyboard)
  })

  it('三把把手各读一次它的主人，一次都不顺路读玩法那一格', () => {
    const { deps, reads } = wire()
    deps.rebindUi('confirm', 'KeyF')
    deps.unbindUi('back')
    deps.unbindUi('up')
    deps.resetUi('up', 'key')
    deps.resetUi('confirm', 'key')
    deps.resetUi('fly' as UiIntent, 'key')
    expect(reads, '六次调用读六次 bindings，`gameplay` 那一格一次都不该被菜单的把手碰到').toEqual({ bindings: 6, gameplay: 0, quality: 0 })
  })
})

/**
 * KI-345：菜单那一节补齐成与玩法同形，多出来的两格（`resetUi` 的 `via`、`setStickThreshold`）
 * 落在同一个装配处、同一个主人身上。这一层要证的还是那三件事，一条都不新发明：
 * ① **装配处不认识"哪张表"**：`Pad7` 到它手里只是一个字符串，落到 `ui.padButtons` 是边界算的；
 *    而"落到哪张表"这一格（`onto`）也是原样交回——装配处若自己补一个落点，面板那句措辞就有了第二个书写者。
 * ② **数也是同一个数**：阈值那一格若绕过 store 直接写 `Input`，玩家当场看着生效、下一次读档就没了
 *    （ KI-337 立的那两条老 bug 形状在第四格把手上的复发）。
 * ③ **各读各的主人**：新加的这两格读的是键位那一个主人，玩法那一次都不该被碰到。
 */
describe('KI-345 菜单那一节多出来的两格：落点与数都只转发，不自己算', () => {
  it('`Pad<n>` 到装配处只是一个字符串：那一格落进 store 的手柄表，而裁决里的 `onto` 说的就是落点', () => {
    const { input, bindings, deps } = wire()
    expect(deps.rebindUi('confirm', 'Pad7'), '装配处不解析这一串，只把边界的答案原样交回').toEqual({ displaced: null, moved: false, onto: 'pad' })
    expect(input.uiBinds.padButtons[7], '消费者那张已换').toBe('confirm')
    expect(bindings.get().ui.padButtons[7], '绕过 store 直接写 Input 的话这一格存档带不走').toBe('confirm')
    expect(bindings.get().ui.keyboard, '键盘那张逐字默认：路由不洗手').toEqual(defaultBindings().ui.keyboard)
    expect(deps.rebindUi('up', 'KeyF'), '键盘那一串交回的是另一个落点（面板那句措辞读的就是这一格）').toEqual({ displaced: null, moved: false, onto: 'keyboard' })
  })

  it('`resetUi` 的第二个参数原样送到 store：一行回默认只回那一条通道', () => {
    const { bindings, deps } = wire()
    deps.rebindUi('confirm', 'KeyF')
    deps.rebindUi('confirm', 'Pad7')
    expect(deps.resetUi('confirm', 'pad'), '手柄那一行有家 ⇒ 做了').toBe(true)
    const u = bindings.get().ui
    expect(u.padButtons, '手柄那张逐字回默认').toEqual(defaultBindings().ui.padButtons)
    expect(u.keyboard.KeyF, '键盘那一行是玩家自己挪的，逐行回默认管不到它').toBe('confirm')
    expect(deps.resetUi('pick1', 'pad'), '这一行在手柄上没有家 ⇒ 面板据此说话，不靠猜').toBe(false)
    expect(bindings.get().ui.padButtons, '而没有家那一格一格都不动').toEqual(defaultBindings().ui.padButtons)
    expect(deps.resetUi('fly' as UiIntent, 'pad'), '名册外的名字配哪条通道都是没这个名字').toBe(false)
  })

  it('阈值那一格落到 store 并走到消费者，交回的是**夹过**那一个数（界不在这一层）', () => {
    const { input, bindings, deps } = wire()
    expect(deps.setStickThreshold(2), '越界的一格由 store 夹住，装配处不许自己兜底').toBe(BIND_BOUNDS.stickThreshold.max)
    expect(bindings.get().ui.stickThreshold, '存的与交回的是同一个数').toBe(BIND_BOUNDS.stickThreshold.max)
    expect(input.uiBinds.stickThreshold, '绕过 store 直接写 Input 的话，下一次读档就没了').toBe(BIND_BOUNDS.stickThreshold.max)
    expect(deps.setStickThreshold(0.4)).toBe(0.4)
    expect(input.uiBinds.stickThreshold, '面板下一步就是从这一格读到 0.4 ⇒ 它读的不是自己上一次步进').toBe(0.4)
  })

  it('新加的两格各读一次键位那一个主人，玩法那一格一次都不碰', () => {
    const { deps, reads } = wire()
    deps.rebindUi('confirm', 'Pad7')
    deps.resetUi('confirm', 'pad')
    deps.setStickThreshold(0.4)
    expect(reads, '三次调用读三次 bindings：一次都不许多，也不许顺路去读玩法那一个').toEqual({ bindings: 3, gameplay: 0, quality: 0 })
  })
})

/* ------------------------------------------------------------------ KI-346 */

/**
 * KI-346：手柄那一列的「无」在这一层仍然只是**转发**。这一批把「无」的名单从"每通道一份"改成"每表一份"，
 * 于是同一屏上出现了四把同族把手，而最容易写歪的形状恰好是这一层能写出来的那一种：
 * 装配处"顺手"把另一份名单也退了（一行的四个家里，玩家关的只是其中一格）。所以这里量三件事，
 * 一条都不新发明：① 落到 store 而不是绕过它写 `Input`（绕过就是档里那一格空的、下一次读档没了）；
 * ② store 的**拒绝也是答案**，原样交回（这一层不许替"关不掉"编一句"成"）；③ 各读各的主人。
 */
describe('KI-346 手柄那一列的「无」：两半都在 store，装配处只交回答案', () => {
  it('玩法那一把落到 store 并走到消费者：那一列空了、名单进的是手柄那一份，键盘那份一个字不沾', () => {
    const { input, bindings, deps } = wire()
    expect(deps.unbindPad('dodge'), '名册上的动作 ⇒ store 说做了').toBe(true)
    expect(input.binds.padButtons[0], '消费者那张的 0 与 12 一起摘掉（留一把就是"旧键还能闪避"那种鬼键）').toBeUndefined()
    expect(input.binds.padUnbound, '面板下一拍读的是消费者那一份 ⇒ 它必须是同一句话').toEqual(['dodge'])
    expect(bindings.get().gameplay.padUnbound, '绕过 store 直接写 Input 的话，这一格存档带不走').toEqual(['dodge'])
    expect(bindings.get().gameplay.unbound, '两份名单各管各的表：这一把不写键盘那一份').toEqual([])
    expect(bindings.get().gameplay.keyboard.ControlLeft, '键盘那张一格都不动').toBe('dodge')
  })

  it('菜单那一把把 store 的拒绝原样交回：这一层不自己兜底，也不替「关不掉」编一句「成」', () => {
    const { input, bindings, deps } = wire()
    expect(deps.unbindUiPad('back'), '「菜单必须走得出去」管的是这条通道的两张表').toBe(false)
    expect(bindings.get().ui.padUnbound, '拒绝不留名单').toEqual([])
    expect(deps.unbindUiPad('fly' as UiIntent), '名册外的名字配哪条通道都是没这个名字').toBe(false)
    expect(bindings.get().ui.padButtons, '两次拒绝都没动一格').toEqual(defaultBindings().ui.padButtons)
    expect(input.uiBinds.padButtons, '也没灌第二次：拒绝不许留半张表给消费者').toEqual(defaultBindings().ui.padButtons)
    expect(deps.unbindUiPad('down'), '而名册上有家的那一行做得成').toBe(true)
    expect(input.uiBinds.padUnbound, '菜单那一份名单同样走到了消费者').toEqual(['down'])
    expect(input.uiBinds.padButtons[13], '十字下那一格在消费者手里也空了').toBeUndefined()
  })

  it('新加的两格各读一次键位那一个主人，玩法设置那一个一次都不碰', () => {
    const { deps, reads } = wire()
    deps.unbindPad('dodge')
    deps.unbindUiPad('down')
    expect(reads, '两次调用读两次 bindings：一次都不许多，也不许顺路去读玩法那一个').toEqual({ bindings: 2, gameplay: 0, quality: 0 })
  })
})

/**
 * KI-348：玩法那一半的落点回报穿过装配处时**一格都不许被折**。
 *
 * 这一层此前对 `rebind` 的返回值什么都不说（菜单那一半 `rebindUi` 有腿，玩法那一半没有）。
 * 而面板的措辞现在只读边界交回的那三个字段 ⇒ 装配处要是顺手补一次「没回报就当成没换出去」，
 * 拒绝就会在屏幕上变成一句「这一把原本没有别人」——那是把接线的一格空缺读成了玩家的一句陈述。
 */
describe('KI-348 装配处把玩法那一半的落点原样交回：不折、不补、不猜', () => {
  it('键盘那一支交回 onto=keyboard，手柄那一支交回 onto=pad：装配处不改写落点', () => {
    const { deps } = wire()
    expect(deps.rebind('parry', 'ControlLeft'), '抢走 Ctrl ⇒ 闪避整把搬走，落点是键盘那张').toEqual({ displaced: 'dodge', moved: true, onto: 'keyboard' })
    expect(deps.rebind('dodge', 'Pad2'), '同一把把手认得另一串拼写，交回的是另一张表').toEqual({ displaced: 'parry', moved: true, onto: 'pad' })
  })

  it('拒绝在这一层还是 `null`：装配处不替它编一套「原本没有别人」，也不为此多读一个主人', () => {
    const { deps, bindings, reads } = wire()
    const before = bindings.get()
    expect(deps.rebind('dodge', 'Pad20'), '越界 ⇒ 「这一次没发生」，不是一个空回报').toBeNull()
    expect(bindings.get()).toEqual(before)
    expect(deps.rebind('parry', 'KeyY'), '做得成那一次交回的是三个字段').toEqual({ displaced: null, moved: false, onto: 'keyboard' })
    expect(reads, '两次调用各读一次键位那一个主人（拒绝也要问它），玩法设置那一个一次都不碰').toEqual({ bindings: 2, gameplay: 0, quality: 0 })
  })
})

/* ------------------------------------------------------------------ KI-359 */

/**
 * KI-359：振动拆成两把尺之后，**这一层一个字节的接线都不该添**。
 *
 * 面板那一屏从四行数值长成五行，用的是同一对既有把手（`gameplay()` / `setGameplay(patch)`）：
 * patch 的形状由 store 的主人说了算，装配处既不认字段名、也不给新行开一格端口。
 * 这条腿量的就是"长一行不等于长一格端口"——它要是红了，红的是有人在接线层又开了第二条路。
 * `portRoster()` 从面板源文件里现推名册（不在测试里抄第二份），所以端口的判据由声明那一侧给。
 */
describe('KI-359 弱马达那一行走的是同一对把手：不添端口、不绕 store、不多读一次', () => {
  it('`setGameplay({ rumbleWeakScale })` 落到 store，也落到消费者那一个字段；别格一格不动', () => {
    const { deps, gameplay, haptics } = seam()
    deps.setGameplay({ rumbleWeakScale: 0.3 })
    expect(gameplay.get().rumbleWeakScale, '绕过 store 的话这一格存档带不走').toBe(0.3)
    expect(deps.gameplay().rumbleWeakScale, '面板读回来的还是那一个数').toBe(0.3)
    expect([haptics.scale, haptics.weakScale], '弱那一格到的是它自己那一个字段，强马达的尺不陪绑')
      .toEqual([1, 0.3])
  })

  it('越界的一格由 store 夹住，装配处不兜底：上界 2、下界 0 各撞一次', () => {
    const { deps, gameplay, haptics } = seam()
    deps.setGameplay({ rumbleWeakScale: 9 })
    expect(gameplay.get().rumbleWeakScale).toBe(GAMEPLAY_BOUNDS.rumbleWeakScale.max)
    expect(haptics.weakScale, '夹取发生在灌之前：消费者手里不许出现过 9').toBe(2)
    deps.setGameplay({ rumbleWeakScale: -1 })
    expect([gameplay.get().rumbleWeakScale, haptics.weakScale], '关掉这一列马达是 0，不是负数').toEqual([0, 0])
  })

  it('两格同一句 `setGameplay` 一起写也不互相覆盖，而且只读主人那一次', () => {
    const { deps, reads, haptics } = seam()
    const before = reads.gameplay
    deps.setGameplay({ rumbleScale: 1.5, rumbleWeakScale: 0.5 })
    expect(reads.gameplay - before, '一次写一次灌（多读一次就是两个主人）').toBe(1)
    expect([haptics.scale, haptics.weakScale], '两把尺各得其所').toEqual([1.5, 0.5])
    const roster = portRoster()
    expect(Object.keys(deps).sort(), '五行数值仍是那一对把手：新行不许在接线层开新端口').toEqual(roster)
    expect(roster.filter((k) => /rumble|vibrat|haptic/i.test(k)), '名册里没有一个字是替振动那一行开的').toEqual([])
  })
})

/**
 * KI-365：长按阈值那一格多出来的**不是端口，而是第五把消费者**。
 *
 * 上面 KI-359 那条说的是「长一行不添端口」；这一批多出一格**接线**（`GameplaySettingsTargets.player`），
 * 所以这条腿问的是两件相反方向的事故：其一，端口名册不许因为多一行而长（还是那一对 `gameplay()`／`setGameplay(patch)`）；
 * 其二，`setGameplay` 落进 store 之后**必须**真的走到玩家那一格里——漏了这一把的形状正是「面板照样动、
 * 手感一个字不响」，而那是 KI-359 那条腿不需要防的（`Haptics` 两把尺当时已经接好了）。
 * 这一块紧挨着上面 KI-359 那一块放，不按编号排到文件末尾：两条问的是同一件事，分开就看不出「同一对把手」这条纪律被连着兑了两次。
 */
describe('KI-365 长按那一行走的是同一对把手：不开端口，但第五把消费者得接到', () => {
  it('`setGameplay({ holdMs })` 落到 store，也落到玩家手里那一个字段；别格一格不动', () => {
    const { deps, gameplay, playerTarget, input, haptics } = seam()
    expect(playerTarget.holdMs, '取证前提：store 构造那一句就灌了第五把（假件留在 0 就是没接线）').toBe(200)
    deps.setGameplay({ holdMs: 500 })
    expect(gameplay.get().holdMs, '绕过 store 的话这一格存档带不走').toBe(500)
    expect(deps.gameplay().holdMs, '面板读回来的还是那一个数').toBe(500)
    expect(playerTarget.holdMs, '判据读的就是这一格：没接上的话面板拧的是空气').toBe(500)
    expect([input.bufferSec, haptics.scale, haptics.weakScale], '其余消费者不许被这一格顺手拧走').toEqual([0.2, 1, 1])
  })

  it('越界由 store 夹住，装配处不兜底：上界 800、下界 200 各撞一次，而夹取发生在灌之前', () => {
    const { deps, gameplay, playerTarget } = seam()
    expect(deps.setGameplay({ holdMs: 9000 }), '这一格没有回报生效值的把手（`setGameplay` 是 void）：界由 store 说').toBeUndefined()
    expect(gameplay.get().holdMs).toBe(GAMEPLAY_BOUNDS.holdMs.max)
    expect(playerTarget.holdMs, '玩家手里不许出现过 9000').toBe(800)
    deps.setGameplay({ holdMs: 20 })
    expect([gameplay.get().holdMs, playerTarget.holdMs], '拧到比下限还短是 200，不是 0（0 会让长按永远打不出来）')
      .toEqual([200, 200])
  })

  it('名册里没有一个字是替这一行开的：第六行数值仍是那一对把手、只读主人那一次', () => {
    const { deps, reads } = seam()
    const before = reads.gameplay
    deps.setGameplay({ holdMs: 300 })
    expect(reads.gameplay - before, '一次写一次灌（多读一次就是两个主人）').toBe(1)
    const roster = portRoster()
    expect(Object.keys(deps).sort(), '六行数值仍是那一对把手：新行不许在接线层开新端口').toEqual(roster)
    expect(roster.filter((k) => /holdms|longpress/i.test(k)), '长按那一行没有自己的端口。过滤词写的是这一格的名字，不是「像不像」：`Threshold` 里也住着 `hold`，第一次就撞在这上面').toEqual([])
  })
})

/**
 * KI-360：`CODE_RE` 早就收着 `Mouse(?:Left|Right|Middle)`（默认表把轻击与重击挂在鼠标上），
 * 缺的从来不是数据格，而是**作答**那一路。这一串只问接线：鼠标这一枚落进的是不是同一位主人，
 * 以及它有没有顺手在接线层开出一格新端口。
 */
describe('KI-360 鼠标那一格也经 store：第三枚传感器不开新端口', () => {
  it('`rebind(action, 一枚鼠标键)` 走的还是那一位主人：`Input` 与存档读数同时跟着换', () => {
    const { deps, input, bindings } = seam()
    deps.rebind('attackHeavy', 'MouseLeft')
    expect(input.binds.keyboard.MouseLeft, '消费者那张已换').toBe('attackHeavy')
    expect(bindings.get().gameplay.keyboard.MouseLeft, '绕过 store 直接写 Input 的话，这一格存档带不走').toBe('attackHeavy')
    expect(bindings.get().gameplay.keyboard.MouseRight, '轻击换到右键那一格：回补的那一次交换由同一位主人做，装配处不参与').toBe('attackLight')
  })

  it('名册一格都没为鼠标多开，捕获袋里仍是那三个把手：鼠标借的是键盘那一列的把手，不是新开辟的第三列', () => {
    const { deps } = seam()
    const roster = portRoster()
    expect(Object.keys(deps).sort(), '新传感器不许在接线层开新端口').toEqual(roster)
    expect(roster.filter((k) => /mouse|pointer|button/i.test(k)), '名册里没有一个字是替鼠标那一枚开的').toEqual([])
    expect(Object.keys(deps.capture).sort(), '捕获那一组仍是 arm/cancel/take：等待的种类没添第三种').toEqual(['arm', 'cancel', 'take'])
  })

  it('「无」对鼠标那一格同样成立：解绑之后按下左键不发行动，而名单进了 store 那一份', () => {
    const { input, el, bindings, deps } = seam()
    deps.unbind('attackLight')
    expect(input.binds.keyboard.MouseLeft, '默认表上左键是轻击，关掉之后它谁的键都不是').toBeUndefined()
    expect(bindings.get().gameplay.unbound, '这一格带不走就是那个老 bug 的形状').toEqual(['attackLight'])
    mouse(el, 0)
    input.poll(TICK_DT)
    expect([...input.frame.edges], '关掉的那一格连边沿都不许有').toEqual([])
  })
})

/**
 * KI-361：面板那一声握手从此问的是"这一下自己答的那一枚"，而名字要到 `Input` 才算数。
 * 装配处这一层的判据只有一条：**转发**——它既不许把名字折成"随便哪一枚"（那正是握手吞掉键盘答案的
 * 那条路走法），也不许自己替名字做决定（来源的主人只有一个）。
 */
describe('KI-361 那个名字经端口原样落到 `Input`：折一次就是一次偷答案', () => {
  it('键盘答的那一枚经端口问「mouse」问不到，而问「key」答得出来', () => {
    const { deps } = seam()
    deps.capture.arm('key')
    key('KeyQ')
    expect(deps.capture.take('mouse'), '端口不许替面板把名字折成"随便哪一枚"——折了就又是 KI-360 ① 那一枚被吃掉的键').toBeNull()
    expect(deps.capture.take('key'), '名字到了 `Input` 才起作用：装配处只交实参').toBe('KeyQ')
  })

  it('不传名字那一读法经端口仍然谁答的都交还（面板投递那一路用的就是它，两路必须各是各的）', () => {
    const { deps, el } = seam()
    deps.capture.arm('key')
    key('KeyZ')
    expect(deps.capture.take(), '键盘那一路').toBe('KeyZ')
    deps.capture.arm('key')
    mouse(el, 0)
    expect(deps.capture.take(), '鼠标那一路同一个不带名字的读法，形状不许变味').toBe('MouseLeft')
  })
})

/* ------------------------------------------------------------------ KI-362 */

/**
 * KI-362：配置文件那三格第一次有把手，于是端口多了一格**袋子**（与 `capture` 同一种形状：
 * 三个把手、一位主人）。这一层要证的还是那三件事，一条都不新发明：
 * ① **落的是 store 那三格**——装配处要是自己养一盒磁带（`const tapes = []`），面板当场看着生效、
 *    下一次读档就没了，正是 KI-337 抓过的那两条老 bug 形状在第五组把手上的复发；
 * ② **拒绝也是答案**——空磁带与界外的下标交回的是两种不同的话（假 与 null），装配处不许替它们圆成一句「成」；
 * ③ **各读各的主人**——三个把手各读一次键位那一个，玩法设置那一个一次都不碰。
 */
describe('KI-362 配置文件那三个把手：仍是转发，不在接线层养第二盒', () => {
  it('存入落到 store 那三格、载入换掉的是消费者手里那张：面板读到的"有没有东西"随存入而变', () => {
    const { deps, input, bindings, reads } = seam()
    expect(deps.profiles.list(), '起手三格全空（长度就是那位主人给的格数）').toEqual([false, false, false])
    deps.rebind('dodge', 'KeyQ')
    expect(deps.profiles.store(0), '空磁带那一格存进去 ⇒ new').toBe('new')
    expect(bindings.getProfiles()![0]!.gameplay.keyboard.KeyQ, '装配处不自己养一盒：存的就是 store 那一张').toBe('dodge')
    expect(deps.profiles.list(), '面板下一拍读回来的是同一句话').toEqual([true, false, false])
    deps.rebind('dodge', 'KeyE')
    expect(deps.profiles.load(0), '有东西那一格做得成').toBe(true)
    expect(input.binds.keyboard.KeyQ, '载入换的是消费者手里那张现表').toBe('dodge')
    expect(input.binds.keyboard.KeyE, '而刚才那一把不在磁带里 ⇒ 载入后那一格回它当时的主人（E 还是交互）').toBe('interact')
    expect(reads, '三次问格子、两次改键、一次载入 = 六次读同一位主人，玩法那一个一次都不碰').toEqual({ bindings: 6, gameplay: 0, quality: 0 })
  })

  it('空格与界外是两种拒绝，经端口原样交回：装配处不兜底、消费者那张一格不动', () => {
    const { deps, input, bindings, reads } = seam()
    const before = input.binds.keyboard
    expect(deps.profiles.load(1), '空磁带 ⇒ store 说"没有东西可载入"').toBe(false)
    expect(deps.profiles.load(9), '界外的下标同样是拒绝，但不是同一句话的形状').toBe(false)
    expect(deps.profiles.store(9), '界外的存入交回 null（做不成，也就没有 new/overwritten 可说）').toBeNull()
    expect(deps.profiles.store(-1)).toBeNull()
    expect(input.binds.keyboard, '四趟拒绝之后消费者那张逐字没动').toEqual(before)
    expect(bindings.getProfiles(), '磁带也仍是一盒都没存').toBeUndefined()
    expect(reads, '四次调用读四次主人：拒绝也要问它，一次都不许多').toEqual({ bindings: 4, gameplay: 0, quality: 0 })
  })

  it('袋子里没有数据格：交出去的是三个函数，面板拿不到 store、也拿不到磁带本体', () => {
    const { deps } = seam()
    for (const [k, v] of Object.entries(deps.profiles)) expect(typeof v, `profiles.${k} 必须是函数`).toBe('function')
    expect(deps.profiles.list(), 'list 交回的是"每格有没有东西"那三个布尔，不是三张表').toEqual([false, false, false])
    deps.profiles.store(0)
    expect(deps.profiles.list().every((f) => typeof f === 'boolean'), '存过之后仍是布尔那一串').toBe(true)
    expect(portRoster(), '端口名册多出来的那一格就叫 profiles').toContain('profiles')
  })
})

/* ------------------------------------------------------------------ KI-363 */

/**
 * KI-363：那三盒多第四把把手（「清空」），而这一层要证的还是同一件事——**它是转发，不是第二盒**。
 * 这一批新加的一格如果落在接线层（`tapes[i] = null` 写在装配处、或装配处替边界兜底成「成」），
 * 屏幕上那一行就会说一句没有主人的话：清空之后按「存入」仍答「覆盖」，因为 store 那一格还满着。
 */
describe('KI-363 「清空」这把经端口同样只是转发：落的是 store 那一格，消费者那张不动', () => {
  it('存 → 清 ⇒ 面板下一拍读回来那一格又空了，而消费者手里那张逐字没动', () => {
    const { deps, input, bindings } = seam()
    deps.rebind('dodge', 'KeyQ')
    deps.profiles.store(0)
    const before = input.binds.keyboard
    expect(deps.profiles.clear(0), '那一格里有东西 ⇒ 边界答「真清了」').toBe(true)
    expect(deps.profiles.list(), '面板读回来的是同一句话，不是自己记的那一份').toEqual([false, false, false])
    expect(bindings.getProfiles(), '盒里那张真的没了：装配处不留影子').toBeUndefined()
    expect(input.binds.keyboard, '清空是磁带侧的事：消费者那张一个键都没变').toEqual(before)
  })

  it('空格与界外的「清空」原样交回 false：接线层不兜底成「成」，那句回声因此仍只有一个主人', () => {
    const { deps, input, bindings } = seam()
    const before = input.binds.keyboard
    expect(deps.profiles.clear(1), '空磁带 ⇒ store 说「那一格没东西可清」').toBe(false)
    expect(deps.profiles.clear(9), '界外的下标同样是拒绝').toBe(false)
    bindings.storeProfile(1)
    expect(deps.profiles.clear(1), '有东西那一次才叫真清').toBe(true)
    expect(input.binds.keyboard, '三趟之后消费者那张仍逐字不动').toEqual(before)
  })

  it('袋子里第四个名字就叫 clear：四把交出去的都是函数，而 `list` 仍是那三个布尔', () => {
    const { deps } = seam()
    expect(Object.keys(deps.profiles).sort(), '多的是第四把把手，不是第二盒数据').toEqual(['clear', 'list', 'load', 'store'])
    for (const [k, v] of Object.entries(deps.profiles)) expect(typeof v, `profiles.${k} 必须是函数`).toBe('function')
    expect(deps.profiles.list(), '格数那位主人仍是 store').toEqual([false, false, false])
  })
})

/* ------------------------------------------------------------------ KI-364 */

/**
 * KI-364：扳机拐点那一格的把手落在接线层。这一层的判据还是 KI-337 立的那一条：**只是转发**。
 * 这一批最容易写歪的两样都在这层：① 装配处自己夹一次（那就是第二个治数的人，界住在 `BIND_BOUNDS`）；
 * ② 装配处直接写 `input.binds`（那就是绕过 store，存档带不走这一格——KI-337 抓过的那条老 bug 的形状）。
 */
describe('KI-364 扳机拐点经端口仍是转发：落的是 store，夹取的也是它', () => {
  it('`setTriggerThreshold` 交回边界那一个数，消费者拿到同一个，装配处一次都不多读', () => {
    const { deps, input, bindings, reads } = seam()
    expect(reads.bindings, '装配那一刻仍不读 store（这一格没破坏 KI-337 那条时机裁决）').toBe(0)
    expect(deps.setTriggerThreshold(0.7), '交回的是生效那一个，不是写进去那一个').toBe(0.7)
    expect(bindings.get().gameplay.triggerThreshold, '绕过 store 直接写 Input 的话，这一格存档带不走').toBe(0.7)
    expect(input.binds.triggerThreshold, '而 Input 手里那一份是 store 灌进去的，不是装配处另写的').toBe(0.7)
    expect(deps.setTriggerThreshold(3), '越界由边界夹：装配处不许兜底成「看起来能用」').toBe(BIND_BOUNDS.triggerThreshold.max)
    expect(input.binds.triggerThreshold, '夹取发生在灌之前：消费者手里不许出现过 3').toBe(0.95)
    expect([reads.bindings, reads.gameplay], '两趟调用读两趟键位那一位主人，玩法那一个一次都不碰')
      .toEqual([2, 0])
  })

  it('端口名册多出来的那一格就叫 `setTriggerThreshold`：没有第二盒数值，也没有第五组袋子', () => {
    const { deps } = seam()
    const roster = portRoster()
    expect(roster, '面板声明那一侧从此有这一格（名册由源文件现推，不在测试里抄）').toContain('setTriggerThreshold')
    expect(Object.keys(deps).sort(), '装配处交出去的格子与端口一字不差：漏一格就是面板拿到 undefined').toEqual(roster)
    expect(roster.filter((k) => /trigger|deadzone/i.test(k)), '多的是既有那一位主人的一格把手').toEqual(['setTriggerThreshold'])
    expect(Object.keys(deps.profiles).sort(), '配置文件那盒仍是四把——拐点不住在磁带那组里').toEqual(['clear', 'list', 'load', 'store'])
    expect(Object.keys(deps.capture).sort(), '捕获那组也仍是三把：拐点改的是判据，不是捕获形状').toEqual(['arm', 'cancel', 'take'])
  })
})
