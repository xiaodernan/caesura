import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Input } from '@/core/Input'
import { Cinematics } from '@/world/Cinematics'

/**
 * KI-392：玩法那条通道上的**第二道闸**——过场锁该每帧现问，不该跟着 overlay 的时机写成一格布尔。
 *
 * **病（登记批与纠正批量到的）**：`input.enabled` 全仓只有一个书写者，住在 `main.ts` 的 `setOverlay()` 里
 * （现量：`.scratch/ki392b_scales.json` 生产书写者 1 处，另 4 处是同名不同物的 `this.enabled`／`shadowMap.enabled`）。
 * 而过场起、走满、跳过都不经过 `setOverlay` ⇒ 那一句里 `&& !cinematics.inputLocked` 的那一半**只在 overlay
 * 变化的那一拍成立过**。纠正批数过：账上 9 条锁输入的过场、合计 154000ms，实际只有定弦屏那两拍真锁着。
 *
 * **先红预测（写在跑之前，跑完逐格对照；本文件 7 条）**：
 * ① 「默认一路放行」那条**今天就该绿**——它钉的是不改行为的前提，红了说明我把既有通道改坏了；
 * ② 其余 6 条**今天全红**，红的都是同一件事：`poll` 里没有第二个每帧读者（`.scratch/ki392_radius.json`
 *    量的 `Input.ts` 324/324 覆盖的是**这一格今天只由 `enabled` 决定**），所以 `playLive` 这一格在运行时
 *    只是一个没人读的新字段——赋值不报错、断言必然落空（红是**行为红**不是崩溃红）；
 * ③ `tsc --noEmit` 会跟着红：`playLive` 这一格此刻在 `Input` 上不存在，每一处赋值/读取各报一个错。
 *    报错数由本文件的引用点决定，我不预测它有几个——预测的是**错全在这一格上**，出现别处的错就是我把
 *    别的东西写坏了；
 * ④ 既有腿一条都不许变红：`ui-intents.test.ts` 那 8 处写 `enabled` 的腿、`input-device.test.ts` 整份、
 *    `tests/flow/cinematics-player.test.ts:93` 那把钉 `!cinematics.inputLocked` 字面的形状尺（全仓按形状钉
 *    组合根那一句的尺现量只有这一把——乙类 1 条）都要照旧绿。第 ④ 条是「加一项而不是换掉那一格」的判据。
 *
 * **跑完对照**（本批两趟定向：改动前 28 条里 4 红、改动后 142 条里 1 红）——预测有两处没量准，都记下：
 * 一、②说「其余 6 条全红」，实测红臂只红 4 条：`交还不送假打`／`交还后重新按`／`只夺玩法不夺菜单`
 *    三条**今天就绿**，而且绿得没有价值——那一格今天没人读，所以「闸门关着时菜单照发」「交还不补发」
 *    这些句子今天全都白真（断言的是尚不存在的闸门的后果）。它们是**防回归的钉**，不是**看病的腿**；
 *    看病的是「挡着的那一帧零边沿」「每帧问一次」「配方腿」这三条＋形状尺那一条。
 * 二、绿臂剩的那 1 红是我自己写坏的：`配方腿` 把"松开"与"再按"挤在同一拍的两侧，而 `prevHeld` 记的
 *    是上一拍的**设备**状态（闸门不许动它——KI-061 立的就是这条），所以那一拍看不到"新按下"。
 *    修法是在两下之间插一拍；插完之后这条腿仍然只声称配方成立，不声称 `main.ts` 本体被跑过。
 *
 * **不声称**：这些腿量的是 `Input` 与 `Cinematics` 之间那条**配方**成立；`main.ts` 本体今天仍 0/673 覆盖，
 * 组合根有没有真把这句接上由形状尺钉（在 `cinematics-player.test.ts` 里那条），不是由本文件声称。
 */

class FakeEl {
  handlers: Record<string, ((e: unknown) => void)[]> = {}
  addEventListener(t: string, fn: (e: unknown) => void): void { (this.handlers[t] ??= []).push(fn) }
  requestPointerLock(): void {}
}

let win: Record<string, ((e: unknown) => void)[]> = {}

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  g.document = { pointerLockElement: null }
  g.window = { addEventListener: (t: string, fn: (e: unknown) => void): void => { (win[t] ??= []).push(fn) } }
})

beforeEach(() => { win = {} })

const key = (code: string, up = false): void => {
  const e = { code, repeat: false, preventDefault: (): void => {} }
  for (const fn of win[up ? 'keyup' : 'keydown'] ?? []) fn(e)
}

const mk = (): Input => new Input(new FakeEl() as unknown as HTMLElement)

/** 走满那一刻：`advance` 把当前这条放完，锁跟着 `inputLocked` 自己解除（不靠任何人再写一次） */
const ROWS = [{ id: 'LOCK', kind: 'k', durationMs: 1000, lockInput: true }, { id: 'FREE', kind: 'k', durationMs: 1000 }]

describe('Input：玩法那条的第二道闸（KI-392）', () => {
  it('不接线时一路放行——本批不改任何既有行为（今天该绿；红了就是我把通道改坏了）', () => {
    const inp = mk()
    key('KeyG')
    inp.poll(16)
    expect(inp.frame.edges.has('parry'), '默认：按下就发一次边沿').toBe(true)
    expect(inp.frame.held.has('parry')).toBe(true)
  })

  it('第二道闸答「不许」的这一帧：边沿空、held 空、移动归零', () => {
    const inp = mk()
    inp.playLive = () => false
    key('KeyG')
    key('KeyD')
    inp.poll(16)
    expect([...inp.frame.edges], '闸门挡着就不该有任何玩法边沿').toEqual([])
    expect([...inp.frame.held], '闸门挡着时 held 也是空的（读数不许假装手指还按着）').toEqual([])
    expect(inp.frame.move.x, '移动那条合成同样要走闸门').toBe(0)
  })

  it('闸门从挡到开而手指没动 ⇒ 交还那一帧不送一次假打（KI-061 的另一面）', () => {
    const inp = mk()
    let blocked = true
    inp.playLive = () => !blocked
    key('KeyG')
    inp.poll(16)
    inp.poll(16)
    blocked = false
    inp.poll(16)
    expect([...inp.frame.edges], '交还只说"现在能动了"，不补发一次按下').toEqual([])
    expect(inp.frame.held.has('parry'), '交还之后这一格仍按着是要看得见的').toBe(true)
  })

  it('交还之后重新按 ⇒ 正常发一次（证明那道闸不是永久堵死）', () => {
    const inp = mk()
    let blocked = true
    inp.playLive = () => !blocked
    key('KeyG'); inp.poll(16)
    key('KeyG', true)
    blocked = false
    inp.poll(16)
    key('KeyG')
    inp.poll(16)
    expect(inp.frame.edges.has('parry'), '开了闸就得重新收键').toBe(true)
  })

  it('那道闸每帧问一次：三拍 poll 就问三回，不是起个头问一遍', () => {
    const inp = mk()
    let asks = 0
    inp.playLive = () => { asks++; return false }
    inp.poll(16)
    inp.poll(16)
    inp.poll(16)
    expect(asks, '每帧现问').toBe(3)
  })

  it('第二道闸只夺玩法不夺菜单：闸门关着而 `uiOwner` 在场 ⇒ 菜单意图照发', () => {
    const inp = mk()
    inp.playLive = () => false
    inp.uiOwner = 'panel'
    key('ArrowDown')
    inp.poll(16)
    expect([...inp.uiEdges], '过场锁管的是玩法那条，菜单那条另有主人').toEqual(['down'])
    expect([...inp.frame.edges], '玩法那条同一帧仍是空的').toEqual([])
  })

  it('配方腿：起一条 `lockInput` 的过场 ⇒ 下一拍玩法零边沿；走满交还不补发', () => {
    const cine = new Cinematics(ROWS)
    const inp = mk()
    inp.playLive = () => !cine.inputLocked /* 与组合根那一句同一形：把"谁在跑"交给每帧现问 */
    key('KeyG')
    inp.poll(16)
    expect(inp.frame.edges.has('parry'), '过场之前：正常').toBe(true)
    cine.start('LOCK')
    inp.poll(16)
    expect([...inp.frame.edges], '起过场之后没人重算那一格 ⇒ 今天这里必然红').toEqual([])
    expect([...inp.frame.held], '过场期间玩法那条要空').toEqual([])
    cine.advance(1000)
    inp.poll(16)
    expect(cine.inputLocked, '走满：锁自己解除').toBe(false)
    expect([...inp.frame.edges], '交还那一帧不补发一次按下').toEqual([])
    /* 交还之后要重新动，必须先让"松开"走过一拍：`prevHeld` 记的是上一拍的**设备**状态（闸门不挡它，
       这正是 KI-061 的规矩），所以松键与再按挤在同一拍的两侧时，下一拍看到的仍是"一直按着"⇒ 不发边沿。
       第一版就是把这两下写在同一拍里，绿臂因此白红了一条——那是量具写坏，不是生产码没修好。 */
    key('KeyG', true)
    inp.poll(16)
    expect([...inp.frame.edges], '松开那一拍本来就没有新边沿').toEqual([])
    key('KeyG')
    inp.poll(16)
    expect(inp.frame.edges.has('parry'), '交还后能重新动').toBe(true)
    /* 不锁输入的那一条过场：玩法那条一个字都不许被挡（`lockInput` 是每条自己的） */
    cine.start('FREE')
    key('KeyG', true)
    inp.poll(16)
    key('KeyG')
    inp.poll(16)
    expect(inp.frame.edges.has('parry'), '不锁输入的过场不该顺手把玩法关掉').toBe(true)
  })
})
