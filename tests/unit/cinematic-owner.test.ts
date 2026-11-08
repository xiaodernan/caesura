import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import * as CORE from '@/core/Input'
import { Input } from '@/core/Input'
import { Cinematics } from '@/world/Cinematics'

/**
 * KI-390 实现批的尺（乙案落地）：**过场期间给手柄玩家一个出口**。
 *
 * **病**：账上 `lockInput`＝true 的过场（现量 9 行／合计 154000ms）期间，玩法那条被 KI-392 那道每帧现问的闸
 * 夺走，菜单那条又因为 `uiOwner` 为假而一个边沿都不发（`src/core/Input.ts:590`：`if (this.uiOwner)` 才产边沿）
 * ⇒ 手柄玩家既停不下（暂停在过场里不存在是 KI-389 已钉的裁决，本批不翻案）也跳不出。
 * **裁决（量批 2026-11-04，账本 KI-390 行）**：走乙——`MenuOwner` 值域加第五格 `cinematic`，出口走菜单那条通道，
 * 读者住 core 那侧（与 `readPauseAction` 同族），玩法那条闸 `enabled` 一字不拆。
 *
 * **为什么第五格不是一条 overlay**：`setOverlay` 里那句 `pause.holdByOverlay(overlay !== null)` 会把世界冻住，
 * 而 `cinematics.advance` 住在被 `if (!time.paused)` 挡着的 `core.update` 里 ⇒ 过场一旦算作 overlay，
 * 它自己的时间就不再往前走（黑场永久停着）。所以这一格只夺**菜单读数**，不夺**世界时间**——这是形状门，
 * 不是措辞：本文件的 A3 钉的就是这一句。
 *
 * **先红预测（写在跑之前；本档 7 条）**：
 * A1／A2／A3／B1／B2 五条**今天全红**——前两条红在 core 还没把名册交出去（`MENU_OWNERS` 现读 `undefined`），
 * 后三条红在组合根那一句还住在 `setOverlay` 体内、`feedMenu` 还只认四格；
 * D1／D2 两条**今天就该绿**：它们是防回归的钉（第五格在场时 `preventDefault` 只依赖"owner 非 null"这件事，
 * 玩法闸关着时 `pause` 不出现是 KI-392 已落地的形状），不是看病的腿——KI-392 先红臂量出的正是"把钉当腿"，
 * 这里点名标绿。出口读者那五条（`confirm`／`back` 各触发一次、无边沿不叫、别的意图不算、同帧两枚只跳一次）
 * 不住在本档：它们 import 一个还不存在的模块，红的方式会是**整档加载失败**而不是腿级红，因此另立
 * `tests/unit/cinematic-exit.test.ts`，落档时把那一档按"文件级红"记，不混进条数里充数。
 * 本档合起来预测 5 红／2 绿；`ui-intents.test.ts` 那两把改过的尺（所有权书写者的位置、按名册逐格喂读）
 * 各再红 1 条 ⇒ 定向这一格预计 7 红。数以两趟实测为准，与预测不符的逐条写在结案里。
 *
 * **先红臂的 `tsc` 也预测为红，而且红点就是这一批的病**（现量 2 条）：
 * ① `cinematic-exit.test.ts` import 不存在的模块（TS2307）；② 本档 D1 那句
 * `inp.uiOwner = 'cinematic'`（TS2322：值域里今天只有四格）。第二条是同一件事从类型平面读到的形状——
 * 运行时补不上第五格，类型上也就没有第五格，两边都得绿才算落地。
 * 落档后（绿臂）这两条应回到 0 错、`TSC_EXIT=0`。
 *
 * **不声称**：① 不声称真手柄上按过一次就能跳过（本批全部读数在进程内与源文本层）；
 * ② 不声称 `main.ts` 本体被执行过（root 包 0.00%，B1／B2 是形状尺）；③ 不声称过场期间世界该停——
 * 那半今天没判，A3 只钉"不许因为它把时间冻住"。
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
const mk = (): Input => new Input(new FakeEl() as unknown as HTMLElement)
/** `preventDefault` 要问得出被没被叫：事件对象自带一个可记录的桩 */
const key2 = (code: string): { prevented: boolean } => {
  let prevented = false
  const e = { code, repeat: false, preventDefault: (): void => { prevented = true } }
  for (const fn of win.keydown ?? []) fn(e)
  return { get prevented() { return prevented } }
}
const live = (t: string) => t.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n')
/**
 * 取一段源码，两个锚点都必须找得到。这条守卫不是客套：`slice(i, -1)` 在 JS 里是"切到倒数第一个字"，
 * 于是**锚点丢了 = 把整篇当成那一段**——本文件第一次量 A3 就是这样，锚点那句注释被 `live` 折掉之后
 * `indexOf` 返回 -1，区间从 293 字变成整份 main.ts，红得莫名其妙（读数是「expected 'function setOverlay(open:
 * Overlay): v…' not to contain 'cinematic'」，那段里有 `feedMenu`、有播放器的名字，什么都在里面）。
 * 锚点用函数名不用注释：注释会被 `live` 吃掉，函数名不会。
 */
const region = (text: string, from: string, to: string, what: string): string => {
  const i = text.indexOf(from)
  const j = text.indexOf(to)
  expect(i >= 0 && j > i, `${what}：锚点「${from}」／「${to}」在 live 里找不齐（起=${i} 止=${j}）——不许让 slice 拿整篇当这一段`).toBe(true)
  return text.slice(i, j)
}
const coreSrc = readFileSync('src/core/Input.ts', 'utf8').replace(/\r\n/g, '\n')
const mainSrc = readFileSync('src/main.ts', 'utf8').replace(/\r\n/g, '\n')
const mainLive = live(mainSrc)
/** 名册：今天 core 没交出来，读回来是 `undefined`——两条 A 组腿的第一句都先问它有没有 */
const 名册 = (CORE as unknown as Record<string, unknown>).MENU_OWNERS as readonly string[] | undefined

describe('KI-390 乙案：第五格主人在 core 那一侧（A 组）', () => {
  it('core 把五格主人作为**一份可枚举名册**交出来，第五格叫 `cinematic`', () => {
    expect(名册, 'core 没有 `MENU_OWNERS`：值域今天只活在 `MenuOwner` 那句字面量里，别人没法按它循环').toBeDefined()
    expect([...(名册 ?? [])].sort(), '名册应是五格，且第五格是 `cinematic`').toEqual(['cinematic', 'dialogue', 'map', 'panel', 'title'])
  })

  it('`MenuOwner` 由名册派生，不再另抄一遍字面量（词表只有一份账）', () => {
    const decl = (coreSrc.match(/export type MenuOwner =.*/) || ['（读不到这一行）'])[0]
    expect(decl, `类型声明要从名册派生，现读「${decl.trim()}」`).toContain('typeof MENU_OWNERS[number]')
    expect(decl, '派生之后就不许再把四格／五格字面量抄在类型里（那正是第二份账）').not.toMatch(/'panel'\s*\|/)
  })

  it('第五格**不是**一条 overlay：过场不许把世界时间冻住（`advance` 会跟着停）', () => {
    const decl = (mainSrc.match(/type Overlay =.*/) || ['（读不到这一行）'])[0]
    expect(decl, `overlay 的值域要从「MenuOwner」派生并排掉第五格，现读「${decl.trim()}」`).toContain(`Exclude<MenuOwner, 'cinematic'>`)
    // 量在 live 那一路，不量原文：`setOverlay` 体内本来就有一句 KI-392 的注释写着播放器的名字，
    // 按原文判会让一条**说清了规矩的注释**把形状门锁死（与 ui-intents 那把数 `uiOwner` 次数的尺同族）。
    const body = region(mainLive, 'function setOverlay', 'function setPanelOpen', '`setOverlay` 那一段')
    expect(body, '`setOverlay` 体里出现 `cinematic` ⇒ 过场会被算成一条 overlay，`holdByOverlay` 一冻住，`advance` 就不再走时间').not.toContain('cinematic')
  })
})

describe('KI-390 乙案：组合根那一句搬到每帧现算的位置（B 组，形状尺）', () => {
  it('所有权的书写者仍只有一处，而且它住在 `feedMenu` 里、每帧现算', () => {
    // 病：`input.uiOwner = overlay` 住在 `setOverlay`（事件时机），过场的起止不经过它 ⇒ 第五格永远补不上。
    // 修法与 KI-392 同一族：把"现在谁是主人"变成每帧现算的一句，写在 `feedMenu` 里；书写者仍只有一处。
    const hits = mainLive.match(/input\.uiOwner\s*=/g) || []
    expect(hits.length, `全仓「input.uiOwner」的赋值只许一处，现读 ${hits.length} 处`).toBe(1)
    const feed = region(mainLive, 'function feedMenu', 'const loop = new GameLoop', '`feedMenu` 那一段')
    expect(feed, '那句赋值要在 `feedMenu` 体内（每帧现算），而不是住在 `setOverlay` 的事件时机里').toContain('input.uiOwner =')
    expect(feed, '每帧现算的那一句要同时看见 overlay 与过场锁，否则第五格还是补不上').toMatch(/cinematics\.inputLocked/)
  })

  it('`feedMenu` 按名册逐格分发——第五格也要有读者，不许留成挂名的第四者', () => {
    expect(名册, '名册还没交出来，这条尺没法按名册循环').toBeDefined()
    const feed = region(mainLive, 'function feedMenu', 'const loop = new GameLoop', '`feedMenu` 那一段')
    for (const owner of 名册 ?? []) {
      expect(feed, `喂读那一段少了 ${owner} 这一格：那块主人就成了挂名却不读数的第五者`).toContain(`=== '${owner}'`)
    }
  })
})

describe('KI-390 乙案：两条今天就该绿的钉（D 组，标出来不当腿用）', () => {
  it('钉：第五格在场时方向键被 `preventDefault`（新副作用，裁决要求钉住它）', () => {
    const inp = mk()
    inp.uiOwner = 'cinematic'
    const e = key2('ArrowUp')
    expect(e.prevented, '`uiOwner` 非 null 就该拦默认行为：过场期间方向键不再滚页面').toBe(true)
  })

  it('钉：玩法闸关着时 `pause` 边沿不出现 ⇒ 暂停在过场里仍然不存在（KI-389 的裁决不翻案）', () => {
    const inp = mk()
    const cine = new Cinematics([{ id: 'LOCK', kind: 'k', durationMs: 5000, lockInput: true }])
    cine.start('LOCK')
    inp.playLive = () => !cine.inputLocked
    key2('Escape')
    inp.poll(16)
    expect([...inp.frame.edges], '玩法那条被闸门挡着时不该有任何边沿，`pause` 也不行').toEqual([])
  })
})
