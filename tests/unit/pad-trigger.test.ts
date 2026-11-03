import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { TICK_DT } from '@/core/Time'
import { DEFAULT_BINDS, UI_BINDS, Input } from '@/core/Input'
import { BindingsStore } from '@/settings/Bindings'

/**
 * KI-364：手柄那两把模拟扳机（标准映射的 6 = LT、7 = RT）第一次由**自己那一条线**回答「按下没」。
 *
 * 病（§6 那一格「扳机死区」在规格里挂了很久，机制里一直没有落点）：离散按钮那一圈今天只有一个判据，
 * 读的是浏览器报的那个布尔——而扳机的那个布尔是 UA 拿一个**看不见也改不了**的数从模拟量里折出来的。
 * 于是「手指搭上去一点算不算按下」这件事由设备报的那个数说了算，`ui-ux.md` §6 要的那格死区没有主人。
 * 这一份量的就是加上那条线之后**设备侧的读数**，七条：拐点两边（1）· 线跟着边界走（2）·
 * 索引闸门两侧各钉一次（3）· 边沿语义与数字键同一套（4）· 三条读者共用同一个判据（5、6）·
 * 老判据不许在判据以外复发（7）。
 *
 * 界（5–95%）与默认值不在这份文件里钉第二遍：那两格的主人分别是 `settings/Bindings.ts > BIND_BOUNDS`
 * 与 `core/Input.ts > DEFAULT_BINDS`；这里只量它们生效到读数上的那一段，同一个数在两条路上各钉一次的是
 * 判据，不是数值。
 */

class FakeEl {
  handlers: Record<string, ((e: unknown) => void)[]> = {}
  addEventListener(t: string, fn: (e: unknown) => void): void { (this.handlers[t] ??= []).push(fn) }
  requestPointerLock(): void { /* 与读数无关 */ }
}

let win: Record<string, ((e: unknown) => void)[]> = {}

/**
 * 一把**每格都能单独写**的手柄：`cells[下标] = [pressed, value]`，没点名的格子是松开的。
 * 与 `input-pad.test.ts` 那只的区别正是本批要的那一件——这里 `pressed` 与 `value` 可以不一致，
 * 而「扳机过没过线」必须由 `value` 回答、「数字键按没按」必须由 `pressed` 回答，两个方向都能单独给。
 */
function pad(cells: Record<number, [boolean, number]> = {}): void {
  // Node 24 上 `navigator` 是只读 getter（直接赋值会抛），所以用 defineProperty 换掉
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      getGamepads: () => [{
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 19 }, (_, i) => ({ pressed: cells[i]?.[0] ?? false, value: cells[i]?.[1] ?? 0 })),
        mapping: 'standard', connected: true
      }]
    }
  })
}

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  g.window = { addEventListener: (t: string, fn: (e: unknown) => void): void => { (win[t] ??= []).push(fn) } }
})

// 每条用例从「手柄松着」开始：挂一条就会把扳机留在推着的状态，下一条的第一帧读到一次不属于自己的边沿
// （`input-pad.test.ts` 与 `ui-intents.test.ts` 实测过的同一口坑）。
beforeEach(() => { win = {}; pad() })

const fresh = (): Input => new Input(new FakeEl() as unknown as HTMLElement)

describe('KI-364 扳机那两把由模拟量回答：一条线，三个读者，数字键不受影响', () => {
  it('默认拐点是一半：0.3 不算按下、0.7 算，而 LT 与 RT 各走同一条线', () => {
    expect(DEFAULT_BINDS.triggerThreshold, '默认那一个数的主人是默认表，写的是一半').toBe(0.5)
    const inp = fresh()
    pad({ 6: [true, 0.3], 7: [true, 0.3] })
    inp.poll(TICK_DT)
    expect(inp.frame.held.has('map'), 'UA 报的是按下了，但没到我们自己那条线 ⇒ 不算').toBe(false)
    expect(inp.frame.held.has('sprint'), 'RT 那一把同一条线').toBe(false)
    expect(inp.frame.edges.has('map'), '半推既然不算按下，也就不许送一次边沿').toBe(false)
    pad({ 6: [true, 0.7], 7: [true, 0.7] })
    inp.poll(TICK_DT)
    expect([...inp.frame.held].sort(), '推过线才算按下：LT = map、RT = sprint').toEqual(['map', 'sprint'])
    expect(inp.frame.edges.has('map'), '第一帧过线 ⇒ 有边沿，与数字键同一套').toBe(true)
  })

  it('拐点改的是机制不是装饰：线推到 0.9 之后同一推量不再算按下，整张回默认又算', () => {
    const inp = fresh()
    const store = new BindingsStore({ input: inp })
    store.setTriggerThreshold(0.9)
    expect(inp.binds.triggerThreshold, '消费者手里那一份与边界那一个是同一个数').toBe(0.9)
    pad({ 7: [true, 0.7] })
    inp.poll(TICK_DT)
    expect(inp.frame.held.has('sprint'), '0.7 在 0.5 那一侧算、在 0.9 那一侧不算').toBe(false)
    pad({ 7: [true, 0.95] })
    inp.poll(TICK_DT)
    expect(inp.frame.edges.has('sprint'), '推到线上面照样打得出 ⇒ 这一格不是把扳机关掉').toBe(true)
    store.restoreDefaults()
    pad({ 7: [false, 0] })
    inp.poll(TICK_DT)
    pad({ 7: [true, 0.7] })
    inp.poll(TICK_DT)
    expect(inp.frame.edges.has('sprint'), '回默认之后 0.7 又算了：那一个数从头到尾只有一个主人').toBe(true)
  })

  it('闸门只管那两把扳机：数字键那 17 格两个方向都不许被模拟量改判', () => {
    const inp = fresh()
    pad({ 0: [true, 0] })
    inp.poll(TICK_DT)
    expect(inp.frame.edges.has('dodge'), 'pressed 真、value 是 0（把扳机当数字键报的那一类驱动）⇒ 闪避照样打得出').toBe(true)
    pad({ 13: [false, 1] })
    inp.poll(TICK_DT)
    expect(inp.frame.held.has('attackLight'), '反过来 pressed 假、value 是 1 ⇒ 也不许凭模拟量亮起来').toBe(false)
    pad({})
    inp.poll(TICK_DT)
    pad({ 13: [true, 1] })
    inp.poll(TICK_DT)
    expect(inp.frame.edges.has('attackLight'), '两个都报的那一格照常生效（上一条不是空断言）').toBe(true)
  })

  it('边沿那一套与数字键同形：按住不连发、线上面小幅起伏不重发、掉回线下面才算松手', () => {
    const inp = fresh()
    pad({ 6: [true, 0.8] })
    inp.poll(TICK_DT)
    inp.poll(TICK_DT)
    expect(inp.frame.held.has('map'), '一直推着是 held').toBe(true)
    expect(inp.frame.edges.has('map'), '一直推着不是连点：脉冲只发一波').toBe(false)
    pad({ 6: [true, 0.85] })
    inp.poll(TICK_DT)
    expect(inp.frame.edges.has('map'), '0.8 → 0.85 都还在线上面 ⇒ 不该再送一次').toBe(false)
    pad({ 6: [true, 0.2] })
    inp.poll(TICK_DT)
    expect(inp.frame.held.has('map'), '掉回线下面就是松手，手指还搭着也算放').toBe(false)
    pad({ 6: [true, 0.9] })
    inp.poll(TICK_DT)
    expect(inp.frame.edges.has('map'), '再推过去才是下一次按下').toBe(true)
  })

  it('等键那一路共用同一个判据：半推不作答也不撤武装，推过去答的是 `Pad6`', () => {
    const inp = fresh()
    inp.armKeyCapture('pad')
    pad({ 6: [true, 0.3] })
    inp.poll(TICK_DT)
    expect(inp.takeKeyCapture(), '半推不是一枚「下一枚物理键」：这一下玩家还没把它按下去').toBeNull()
    pad({ 6: [true, 0.8] })
    inp.poll(TICK_DT)
    expect(inp.takeKeyCapture(), '同一只手推过线才算作答，形状仍是 `Pad<n>`').toBe('Pad6')
    inp.armKeyCapture('pad')
    pad({ 7: [true, 0.3] })
    inp.poll(TICK_DT)
    expect(inp.takeKeyCapture(), 'RT 那一把走的是同一条线（闸门按位置，不按谁绑了什么）').toBeNull()
    pad({ 7: [true, 0.8] })
    inp.poll(TICK_DT)
    expect(inp.takeKeyCapture(), '而它推过去也照样答得出').toBe('Pad7')
    pad({})
    inp.poll(TICK_DT)
  })

  it('菜单那一列借了扳机也是同一条线：0.3 不发 confirm、0.8 发一次，玩法那一侧不陪绑', () => {
    const inp = fresh()
    const store = new BindingsStore({ input: inp })
    store.set({ ui: { padButtons: { ...UI_BINDS.padButtons, 6: 'confirm' } } })
    inp.enabled = false
    inp.uiOwner = 'panel'
    pad({ 6: [true, 0.3] })
    inp.poll(TICK_DT)
    expect([...inp.uiEdges], '面板开着时半推一样不算按下：菜单一条意图都不发').toEqual([])
    pad({ 6: [true, 0.8] })
    inp.poll(TICK_DT)
    expect([...inp.uiEdges], '推过线就是 confirm，读的是与玩法那两把同一条线').toEqual(['confirm'])
    inp.poll(TICK_DT)
    expect([...inp.uiEdges], '一直推着不连发（三个读者共用判据，也共用边沿语义）').toEqual([])
    expect(inp.frame.edges.size, '世界停着：玩法那条一格都不发').toBe(0)
    pad({})
    inp.poll(TICK_DT)
    inp.uiOwner = null
    inp.enabled = true
  })

  it('那个布尔只剩判据自己在读：`Input.ts` 里 `.pressed` 出现一次，多的就是第二个判据', () => {
    const src = readFileSync(fileURLToPath(new URL('../../src/core/Input.ts', import.meta.url)), 'utf8')
    const hits = src.split(/\r?\n/).filter((l) => /\.pressed\b/.test(l))
    expect(hits.length, `读者只剩一个 ⇒ 现在是这些行：${hits.join(' | ')}`).toBe(1)
    expect(hits[0], '留下的那一处必须是判据自己，不是又一处直接判定').toContain('pressed')
  })
})
