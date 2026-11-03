/**
 * 名册里那枚 `pause` 第一次有了读者（KI-388）。
 *
 * 前两组量机制与真设备：三枚默认映射（键盘 `Escape`、手柄 8／17）各打得动一次世界，
 * 改键之后老键不再打人——那一行「暂停」从此不是假把手。
 * 第三组量**接线的位置**：读者必须在渲染那一路而不是 `systems.update` 里，否则只能停不能开
 * （`src/core/Input.ts` 里 Tab 那条老死路是同一格病）。
 * 第四组是形状尺：读磁盘上的源码文本，守「一条通道只有一个主人」与「不许删掉映射来骗过读数」。
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DEFAULT_BINDS, Input, UI_BINDS, type ActionName, type Bindings } from '@/core/Input'
import { GameLoop } from '@/core/GameLoop'
import { GameTime, TICK_DT } from '@/core/Time'
import { PauseControl, readPauseAction } from '@/core/PauseControl'

const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url))
/** 形状腿读代码不读注释（KI-387 那批踩过的坑：新写的注释引了一句老代码，正则照单全收） */
const codeOf = (t: string): string => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('//'))
  .join('\n')
const srcFiles = (dir = SRC_DIR, out: string[] = []): string[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) srcFiles(p, out)
    else if (e.name.endsWith('.ts')) out.push(p)
  }
  return out
}
const relOf = (abs: string): string => abs.slice(SRC_DIR.length).replace(/^\//, '')
const codeRead = (rel: string): string => codeOf(readFileSync(`${SRC_DIR}/${rel}`, 'utf8').replace(/\r\n/g, '\n'))

/* ---- 真 Input 的替身环境：window 收监听器，navigator 给一颗可编程的手柄 ---- */
let win: Record<string, ((e: unknown) => void)[]> = {}
beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  g.document = { pointerLockElement: null }
  g.window = { addEventListener: (t: string, fn: (e: unknown) => void): void => { (win[t] ??= []).push(fn) } }
})
beforeEach(() => {
  win = {}
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [] } })
})
const key = (code: string, up = false): void => {
  const e = { code, repeat: false, preventDefault: (): void => {} }
  for (const fn of win[up ? 'keyup' : 'keydown'] ?? []) fn(e)
}
/** 一颗标准映射的手柄：按钮位开到 19（`BIND_BOUNDS.padButtonMax` 的界内） */
const pad = (pressed: number[]): void => {
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
const fakeEl = (): HTMLElement => ({ addEventListener: (): void => {}, requestPointerLock: (): void => {} }) as unknown as HTMLElement
const rig = (): { input: Input; time: GameTime; pause: PauseControl } => {
  const time = new GameTime()
  const input = new Input(fakeEl())
  return { input, time, pause: new PauseControl(time) }
}
const bindsWith = (gameplayPatch: Partial<Bindings['gameplay']>): Bindings => ({
  gameplay: { ...DEFAULT_BINDS, ...gameplayPatch },
  ui: UI_BINDS
})

describe('pause 那枚动作的读者 · 机制（KI-388）', () => {
  it('端口答「有人按下暂停」⇒ 只翻玩家那一格，函数说它吞下了', () => {
    const asked: ActionName[] = []
    const time = new GameTime()
    const pause = new PauseControl(time)
    const source = { consume: (a: ActionName): boolean => { asked.push(a); return a === 'pause' } }
    expect(readPauseAction(source, pause)).toBe(true)
    expect(asked).toEqual(['pause'])
    expect(pause.pausedByUser).toBe(true)
    expect(time.paused).toBe(true)
  })

  it('端口答「没人按」⇒ 一格都不动，函数说没有（不许把空闲折成任何一种停或走）', () => {
    const asked: ActionName[] = []
    const time = new GameTime()
    const pause = new PauseControl(time)
    const source = { consume: (a: ActionName): boolean => { asked.push(a); return false } }
    expect(readPauseAction(source, pause)).toBe(false)
    expect(asked).toEqual(['pause'])
    expect(pause.pausedByUser).toBe(false)
    expect(time.paused).toBe(false)
    // 停着的时候没人按也不许把世界放开
    pause.toggleByUser()
    expect(readPauseAction(source, pause)).toBe(false)
    expect(time.paused).toBe(true)
  })

  it('这条通道只动玩家那一格，菜单那一格照旧归 overlay（KI-387 的两格分工不许被新读者打破）', () => {
    const time = new GameTime()
    const pause = new PauseControl(time)
    const edge = { consume: (a: ActionName): boolean => a === 'pause' }
    pause.holdByOverlay(true)
    expect(readPauseAction(edge, pause)).toBe(true)
    expect(pause.pausedByUser).toBe(true)
    expect(pause.heldByOverlay).toBe(true)
    expect(readPauseAction(edge, pause)).toBe(true)
    expect(pause.pausedByUser).toBe(false)
    expect(pause.heldByOverlay).toBe(true)
    expect(time.paused).toBe(true)
  })
})

describe('真设备：三枚默认映射各打得动一次（KI-388）', () => {
  it('键盘 Escape：按一下停，松手再按一下走', () => {
    const { input, time, pause } = rig()
    key('Escape')
    input.poll(TICK_DT)
    expect(readPauseAction(input, pause)).toBe(true)
    expect(time.paused).toBe(true)
    key('Escape', true)
    input.poll(TICK_DT)
    key('Escape')
    input.poll(TICK_DT)
    expect(readPauseAction(input, pause)).toBe(true)
    expect(time.paused).toBe(false)
  })

  it('手柄按钮 17 与按钮 8 各停得下一次（这两枚以前按下去没人读）', () => {
    const { input, time, pause } = rig()
    pad([17])
    input.poll(TICK_DT)
    expect(readPauseAction(input, pause)).toBe(true)
    expect(time.paused).toBe(true)
    pad([])
    input.poll(TICK_DT)
    pad([8])
    input.poll(TICK_DT)
    expect(readPauseAction(input, pause)).toBe(true)
    expect(time.paused).toBe(false)
  })

  it('一枚边沿只吞一次：连着问第二次不许再翻（一直按着不连发）', () => {
    const { input, time, pause } = rig()
    key('Escape')
    input.poll(TICK_DT)
    expect(readPauseAction(input, pause)).toBe(true)
    expect(readPauseAction(input, pause)).toBe(false)
    expect(time.paused).toBe(true)
  })

  it('改键之后老键不再打人、新键打人——那一行「暂停」说的是真话', () => {
    const { input, time, pause } = rig()
    input.setBindings(bindsWith({
      keyboard: { ...DEFAULT_BINDS.keyboard, Escape: 'jump', KeyP: 'pause' },
      padButtons: {}
    }))
    key('Escape')
    input.poll(TICK_DT)
    expect(readPauseAction(input, pause)).toBe(false)
    expect(time.paused).toBe(false)
    key('Escape', true)
    input.poll(TICK_DT)
    key('KeyP')
    input.poll(TICK_DT)
    expect(readPauseAction(input, pause)).toBe(true)
    expect(time.paused).toBe(true)
  })

  it('两列都解绑之后世界真的停不下来（本批只量不堵——登记为 KI-388 还欠①）', () => {
    const { input, time, pause } = rig()
    input.setBindings(bindsWith({
      keyboard: { ...DEFAULT_BINDS.keyboard, Escape: 'jump' },
      padButtons: {},
      unbound: ['pause'],
      padUnbound: ['pause']
    }))
    key('Escape')
    input.poll(TICK_DT)
    expect(readPauseAction(input, pause)).toBe(false)
    pad([8, 17])
    input.poll(TICK_DT)
    expect(readPauseAction(input, pause)).toBe(false)
    expect(time.paused).toBe(false)
  })
})

describe('读者住在闸门外（KI-388 · 与 Input.ts 那条 Tab 老死路同一格）', () => {
  it('真环里停着的时候仍被问 ⇒ 再按一次打得开（逻辑段那一拍根本没跑，读者照旧）', () => {
    const { input, time, pause } = rig()
    let updates = 0
    const loop = new GameLoop(time, input, () => { readPauseAction(input, pause) })
    loop.add({ update: (): void => { updates++ } })
    key('Escape')
    loop.tickFrame(TICK_DT)
    expect(time.paused).toBe(true)
    expect(updates).toBe(1) // 按下那一拍世界还走着 ⇒ 逻辑段跑过
    key('Escape', true)
    loop.tickFrame(TICK_DT)
    key('Escape')
    loop.tickFrame(TICK_DT)
    expect(updates).toBe(1) // 这两帧闸门都是关的：`systems.update` 一次也没跑
    expect(time.paused).toBe(false) // 而停着的那一路仍然问得到 ⇒ 醒得过来
  })

  it('菜单在场时玩法那条通道不给边沿 ⇒ 玩家那一格不被菜单里的 Esc 翻（KI-387 那条 Esc 腿搬到这里，判据换成通道自己说话）', () => {
    const { input, time, pause } = rig()
    input.enabled = false
    input.uiOwner = 'panel'
    key('Escape')
    input.poll(TICK_DT)
    expect(readPauseAction(input, pause)).toBe(false)
    expect(pause.pausedByUser).toBe(false)
    expect(time.paused).toBe(false)
  })

  it('过场锁玩法那条输入时，停摆也一并被锁走——这一格是本批**改窄**的行为面，钉住它才说得出', () => {
    const { input, time, pause } = rig()
    /* 老写法（`main.ts` 里那句 `e.code === 'Escape' && !overlayOpen()`）只看有没有菜单，
       过场进行中按 Esc 停得下来；改走动作名册之后，`enabled = overlay === null && !inputLocked`
       把这一枚也一起挡住了。本批只登记不解锁——解锁要给 `pause` 划一条不属于玩法的系统通道。 */
    input.enabled = false // 组合根里这一格由 `cinematics.inputLocked` 写成假（`main.ts` 的 enabled 合成）
    key('Escape')
    input.poll(TICK_DT)
    expect(readPauseAction(input, pause)).toBe(false)
    expect(time.paused).toBe(false)
  })
})

describe('形状：一条通道一个主人，且不许删映射骗读数（KI-388）', () => {
  it('src 里 `pause` 这枚动作有读者了，且读者不住在组合根', () => {
    const readers = srcFiles()
      .map((abs) => ({ r: relOf(abs), t: codeOf(readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')) }))
      .filter(({ r, t }) => r !== 'core/Input.ts' && (/(?:consume|has)\(\s*'pause'\s*\)/.test(t)))
      .map(({ r }) => r)
      .sort()
    expect(readers).toEqual(['core/PauseControl.ts'])
  })

  it('main.ts 不再直接吃浏览器的 Escape 码（手动暂停只走动作名册）', () => {
    const main = codeRead('main.ts')
    expect((main.match(/e\.code === 'Escape'/g) ?? []).length).toBe(0)
  })

  it('main.ts 的渲染回调里恰有一处 `readPauseAction(`，且不在 core.update 那一段', () => {
    const main = codeRead('main.ts')
    expect((main.match(/readPauseAction\(/g) ?? []).length).toBe(1)
    const start = main.indexOf('new GameLoop(')
    const end = main.indexOf('loop.add(core)')
    const call = main.indexOf('readPauseAction(')
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect(call).toBeGreaterThan(start)
    expect(call).toBeLessThan(end)
    // 逻辑那一段（core 的 update 里）一处都不许有：那里被 `paused` 挡着，读者进去就是只能停不能开。
    // 判据在这里坏过一次：写成 `expect(....match(...) ?? []).toBeNull()`，`?? []` 先把 null 吞成空数组，
    // 于是这一格**永远红**（接线前它跟着上一格一起红，看不出自己坏了；接线后才露出来）。数数才是读数。
    expect((main.slice(0, start).match(/readPauseAction\(/g) ?? []).length).toBe(0)
    /* 调用点还要在回调**体内**。这一格是臂 A3 逼出来的：把读者搬去包 `core.update`（那一段整个被
       `paused` 挡着）之后，文本顺序仍是「new GameLoop( … readPauseAction( … loop.add(core)」，
       上面几条一条也不红——只比这两个位置就是写窄。`}, perf)` 是那条回调的收口。 */
    const cbEnd = main.indexOf('}, perf)')
    expect(cbEnd).toBeGreaterThan(start)
    expect(call).toBeLessThan(cbEnd)
  })

  it('默认表里那三处映射仍在（不许用「删掉映射」把上面几条判成绿）', () => {
    expect(DEFAULT_BINDS.keyboard.Escape).toBe('pause')
    expect(DEFAULT_BINDS.padButtons[8]).toBe('pause')
    expect(DEFAULT_BINDS.padButtons[17]).toBe('pause')
  })

  it('main.ts 里不直接翻玩家那一格（翻格只有读者一处）', () => {
    const main = codeRead('main.ts')
    expect((main.match(/toggleByUser\(/g) ?? []).length).toBe(0)
  })
})

/**
 * KI-389：玩法这一侧「谁不许关」那句话今天**没有主人**——量到的形状是
 * `unbind`／`unbindPad` 只挡名册外的名字（`isActionName`），`readUnbound` 的身体里没有出口名册，
 * 而界面那一行两把「解绑」都照画。于是 `gameplay.unbound: ["pause"]` 手改进档里读得回来，
 * 两列一起关掉 ⇒ 世界永远手动停不下来。菜单那条通道早就有这一格的先例（`UI_EXIT_INTENTS`：
 * 一份名册、三个读者），本批判的是把它对称过来。
 *
 * 这一组只量**住家与份数**：值与行为在 `bindings-data.test.ts`，屏幕在 `controls-page.test.ts`。
 * 为什么份数值得单独一条腿：先例那一句「面板不许自己数哪些行看起来不能关」不是审美——
 * 名单一旦有两份，改档那一路就绕过界面那道闸，而屏幕上那句话还在说"已解绑"。
 */
describe('玩法那侧的出口名册：一个主人，三个读者（KI-389）', () => {
  const ROSTER = 'GAMEPLAY_EXIT_ACTIONS'
  const withCode = srcFiles().map((abs) => ({
    rel: relOf(abs),
    code: codeOf(readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')),
  }))
  /** 函数身体按花括号收口（前一批的教训：按「往后 520 字」切会让两个名字前缀相吞，读出假绿） */
  const bodyOf = (code: string, decl: string): string => {
    const i = code.indexOf(decl)
    if (i < 0) return ''
    const open = code.indexOf('{', i)
    if (open < 0) return ''
    let depth = 0
    for (let k = open; k < code.length; k++) {
      if (code[k] === '{') depth++
      else if (code[k] === '}') { depth--; if (depth === 0) return code.slice(open, k + 1) }
    }
    return ''
  }

  it('这句话只有一个主人：全 src 里定义处恰一处，住在名册的主人那一份文件里', () => {
    const defs = withCode.filter((f) => new RegExp(`export const ${ROSTER}\\s*[=:]`).test(f.code)).map((f) => f.rel)
    expect(defs, `定义处现读 ${defs.join('、') || '一处也没有（玩法这侧今天不设闸）'}`).toEqual(['core/Input.ts'])
  })

  it('读者恰是那三处：把手、装载、界面都读同一份名册，第四份名单不存在', () => {
    const users = withCode.filter((f) => f.code.includes(ROSTER)).map((f) => f.rel).sort()
    expect(users, `读到这份名册的文件现读 ${users.join('、') || '（还没有读者）'}`)
      .toEqual(['core/Input.ts', 'settings/Bindings.ts', 'ui/Stakerite.ts'])
    for (const rel of ['settings/Bindings.ts', 'ui/Stakerite.ts']) {
      const copied = (codeRead(rel).match(/\[\s*'pause'\s*,?\s*\]/g) ?? []).length
      expect(copied, `${rel} 里出现 ${copied} 份只装 pause 的字面名单：抄一份就是第二个主人`).toBe(0)
    }
  })

  it('装载那一路是真读者：`readUnbound` 的身体里要有名册（只挡按钮不挡档，手改的档照样拆掉刹车）', () => {
    const body = bodyOf(codeRead('settings/Bindings.ts'), 'function readUnbound(')
    expect(body.length, '量具前提：这个函数读得到身体').toBeGreaterThan(0)
    expect(body.includes(ROSTER), '两份玩法名单（键盘与手柄）共用这一个装载者 ⇒ 一处闸管两张表').toBe(true)
    /** 对照：菜单那一路的先例确实是这么做的，本批不新造形状 */
    expect(bodyOf(codeRead('settings/Bindings.ts'), 'function readUnboundUi(').includes('UI_EXIT_INTENTS'),
      '菜单那份今天就有这一格，读到它才说明判据不是空的').toBe(true)
  })
})
