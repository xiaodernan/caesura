import { beforeEach, beforeAll, describe, expect, it } from 'vitest'
import { registerGameData } from '@/data'
import { RpgRuntime } from '@/rpg/Runtime'
import { Input, PICK_INTENTS, UI_BINDS, pumpMenu, type UiIntent } from '@/core/Input'
import type { SavePanelDeps } from '@/ui/Stakerite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * KI-062：`core/Input.ts` 的 UI 意图通道——ui-ux.md §5.2「摇杆/方向键 + 肩键切页 + Back 后退一层」里
 * 手柄那半条的落点。
 *
 * 面板为什么不能直接吃玩法那套 `ActionName`：面板开着时 `enabled=false`，玩法那条 held/edges 是
 * **故意空**的（世界停摆期间不该有任何攻击边沿），而菜单恰恰只在这段窗口里需要读数。
 * 两套挤一条通道的结局，KI-061 刚实测过一次：关面板那一帧"还按着"被当成"刚按下"，
 * 开一次调音桩送自己一次翻滚。
 *
 * **第二腿**（本轮）：`DialogueBox` 与 `TitleScreen` 原本自己听 `window` 的 `keydown`，等于在通道之外
 * 各立了第二个主人。它们现在也只在 `uiStep()` 里读数，于是这条通道有了四格主人（`MenuOwner`），
 * 键盘名册也随之补齐——菜单里的 `Escape` = 后退一层、`Space`/`E` = 执行、`1-9` = 选第 n 项。
 * 标题阶段 `GameLoop` 还不开（`time.tick` 那格实测读数要靠它），所以那一屏的读数由 `pumpMenu` 提供。
 */

const root = fileURLToPath(new URL('../..', import.meta.url))
registerGameData()

class FakeEl {
  innerHTML = ''
  dataset: Record<string, string> = {}
  private classes = new Set<string>()
  handlers: Record<string, ((e: unknown) => void)[]> = {}
  classList = {
    add: (c: string): void => { this.classes.add(c) },
    remove: (c: string): void => { this.classes.delete(c) },
    contains: (c: string): boolean => this.classes.has(c),
  }
  style = { textContent: '' }
  appendChild(c: FakeEl): FakeEl { return c }
  addEventListener(t: string, fn: (e: unknown) => void): void { (this.handlers[t] ??= []).push(fn) }
  requestPointerLock(): void { /* 与读数无关 */ }
}

let win: Record<string, ((e: unknown) => void)[]> = {}
let prevented: string[] = []
/** 一颗可编程的手柄：axes 四项 + 17 个按钮，测试按索引去推 */
function fakePad(axes: number[] = [0, 0, 0, 0], pressed: number[] = []) {
  // Node 24 上 `navigator` 是只读 getter（直接赋值在严格模式的模块里会抛），所以用 defineProperty 换掉
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      getGamepads: () => [{
        axes,
        buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
        mapping: 'standard', connected: true,
      }],
    },
  })
}

beforeAll(() => {
  win = {}
  prevented = []
  const g = globalThis as unknown as Record<string, unknown>
  g.document = { createElement: () => new FakeEl(), head: new FakeEl(), body: new FakeEl(), getElementById: () => new FakeEl() }
  g.window = {
    addEventListener: (t: string, fn: (e: unknown) => void): void => { (win[t] ??= []).push(fn) },
  }
  fakePad()
})

// 每条用例都从"手柄松着、没人被 preventDefault、window 上一只监听器都没有"开始：一条用例挂了就会把
// 上一次推下去的按钮留在场上，下一条读到的是同一颗假手柄（实测：B 键漏在上一条里 ⇒ 这一条的 Tab
// 变成"一直按着"，边沿判据白给）。监听器同理：假窗口在整个文件里是同一只，上一条用例那个仍然
// 拥有 `uiOwner` 的 `Input` 会替这一条把键抢下来，于是"没有主人时不许 preventDefault"永远红。
beforeEach(() => {
  fakePad()
  prevented = []
  for (const k of Object.keys(win)) delete win[k]
})

const key = (code: string, up = false): void => {
  const e = { code, repeat: false, preventDefault: (): void => { prevented.push(`${up ? 'up' : 'down'}:${code}`) } }
  for (const fn of win[up ? 'keyup' : 'keydown'] ?? []) fn(e)
}
const intents = (s: Set<UiIntent>): string[] => [...s].sort()

describe('KI-062 UI 意图通道：谁能读、读成什么', () => {
  it('没有主人时一格都不发，也不抢浏览器的默认行为', () => {
    const input = new Input(new FakeEl() as unknown as HTMLElement)
    expect(input.uiOwner, '默认没有菜单在收读数').toBeNull()
    prevented = []
    key('ArrowDown')
    input.poll(1 / 60)
    expect(intents(input.uiEdges), '没菜单时方向键不该变成意图').toEqual([])
    expect(prevented, '没菜单时不许 preventDefault：页面该正常滚动').toEqual([])
  })

  it('有主人时：一次按下 = 一次边沿；一直按着不连发；松开再按才算第二次', () => {
    const input = new Input(new FakeEl() as unknown as HTMLElement)
    input.uiOwner = 'panel'
    key('ArrowDown')
    input.poll(1 / 60)
    expect(intents(input.uiEdges)).toEqual(['down'])
    input.poll(1 / 60)
    input.poll(1 / 60)
    expect(intents(input.uiEdges), '按住不放不是"连点"：菜单会自己跑到底').toEqual([])
    key('ArrowDown', true)
    input.poll(1 / 60)
    key('ArrowDown')
    input.poll(1 / 60)
    expect(intents(input.uiEdges), '松开再按才是新的一次').toEqual(['down'])
    expect(prevented.some((p) => p === 'down:ArrowDown'), '有主人时才把默认行为抢下来').toBe(true)
  })

  it('三个来源折成一组意图：十字键、左摇杆、再加一次同时推，都只发一次 down', () => {
    const padOnly = new Input(new FakeEl() as unknown as HTMLElement)
    padOnly.uiOwner = 'panel'
    fakePad([0, 0, 0, 0], [13])                       // 十字键下
    padOnly.poll(1 / 60)
    expect(intents(padOnly.uiEdges)).toEqual(['down'])

    const stick = new Input(new FakeEl() as unknown as HTMLElement)
    stick.uiOwner = 'panel'
    fakePad([0, 0.9, 0, 0], [])                       // 左摇杆推到底（y 轴向下为正）
    stick.poll(1 / 60)
    expect(intents(stick.uiEdges)).toEqual(['down'])

    const both = new Input(new FakeEl() as unknown as HTMLElement)
    both.uiOwner = 'panel'
    fakePad([0, 0.9, 0, 0], [13])                     // 同时推：合并之后再求边沿，才只发一次
    both.poll(1 / 60)
    expect(intents(both.uiEdges), '面板不该自己去重').toEqual(['down'])

    fakePad([0, 0.4, 0, 0], [])                        // 阈值内不算：轻推摇杆不该被当成"想往下走"
    const soft = new Input(new FakeEl() as unknown as HTMLElement)
    soft.uiOwner = 'panel'
    soft.poll(1 / 60)
    expect(intents(soft.uiEdges)).toEqual([])
  })

  it('肩键 = 切页，A = 执行，B = 后退；玩法那条一个字节都不多发', () => {
    const input = new Input(new FakeEl() as unknown as HTMLElement)
    input.uiOwner = 'panel'
    input.enabled = false                              // 真实组合：菜单开着 = 世界停着 = 玩法那条空
    fakePad([0, 0, 0, 0], [5])                         // RB
    input.poll(1 / 60)
    expect(intents(input.uiEdges)).toEqual(['pageNext'])
    fakePad([0, 0, 0, 0], [4])                         // LB
    input.poll(1 / 60)
    expect(intents(input.uiEdges)).toEqual(['pagePrev'])
    fakePad([0, 0, 0, 0], [0])                         // A
    input.poll(1 / 60)
    expect(intents(input.uiEdges)).toEqual(['confirm'])
    fakePad([0, 0, 0, 0], [1])                         // B
    input.poll(1 / 60)
    expect(intents(input.uiEdges)).toEqual(['back'])
    expect(input.frame.edges.size, '菜单读数不许漏进玩法那条（面板开着时世界是停的）').toBe(0)
    fakePad()
  })

  it('Tab 开 / Tab 关各走自己那条：UI 通道里的 back 与玩法里的 map 互斥', () => {
    const input = new Input(new FakeEl() as unknown as HTMLElement)
    // 关着：Tab 是玩法那条的 map（"在调音桩前打开"），UI 通道不发话
    input.poll(1 / 60)
    key('Tab')
    input.poll(1 / 60)
    expect(input.frame.edges.has('map'), '关着时 Tab 仍走玩法那条').toBe(true)
    expect(intents(input.uiEdges)).toEqual([])

    // 开着：Tab 变成 back，而那个 map 边沿**永远不补发**（否则关面板顺手又在原地开一次）
    input.enabled = false
    input.uiOwner = 'panel'
    input.poll(1 / 60)
    key('Tab')
    input.poll(1 / 60)
    expect(intents(input.uiEdges)).toEqual(['back'])
    input.enabled = true
    input.uiOwner = null
    input.poll(1 / 60)
    expect(input.frame.edges.has('map'), '一直按着 Tab ≠ 新按下 ⇒ 不会自己再开一次').toBe(false)
  })

  it('菜单里一直按着的那颗键，不会在关面板时变成一次跳跃（KI-061 那条修复留在这里当证人）', () => {
    const input = new Input(new FakeEl() as unknown as HTMLElement)
    key('Space')
    input.poll(1 / 60)
    expect(input.frame.held.has('jump'), '正常情况：按着就算 held').toBe(true)
    input.enabled = false
    input.uiOwner = 'panel'
    input.poll(1 / 60)
    expect(input.frame.held.size).toBe(0)
    input.enabled = true
    input.uiOwner = null
    input.poll(1 / 60)
    expect(input.frame.edges.has('jump'), '一直按着 ≠ 新按下').toBe(false)
    expect(input.frame.held.has('jump'), '但它确实被按着').toBe(true)
  })

  /* ---------------- KI-062 第二腿：对话框与标题屏并入同一条通道后，菜单里的键码名册 ---------------- */

  it('Escape / E 在菜单里折成后退与执行；没有主人时它们仍是浏览器/玩法的', () => {
    const input = new Input(new FakeEl() as unknown as HTMLElement)
    prevented = []
    key('Escape')
    input.poll(1 / 60)
    expect(intents(input.uiEdges), '没人收读数时 Escape 不该变成意图').toEqual([])
    expect(prevented, '没人收读数时不许把 Escape 抢下来').not.toContain('down:Escape')
    expect(input.frame.edges.has('pause'), '关着菜单时 Escape 仍是玩法那条的 pause').toBe(true)

    input.enabled = false
    input.uiOwner = 'dialogue'
    key('Escape', true)
    input.poll(1 / 60)
    key('Escape')
    input.poll(1 / 60)
    expect(intents(input.uiEdges), '开着菜单时 Escape = 后退一层').toEqual(['back'])
    key('Escape', true)
    key('KeyE')
    input.poll(1 / 60)
    expect(intents(input.uiEdges), '对话框的 hint 写着"空格 / 回车 继续"，E 是同权的执行').toEqual(['confirm'])

    input.uiOwner = 'title'
    key('KeyE', true)
    input.poll(1 / 60)
    key('Enter')
    input.poll(1 / 60)
    expect(intents(input.uiEdges), '换一格主人，Enter 的说法不变').toEqual(['confirm'])
  })

  it('1-9 在菜单里是"选第 n 项"：主键盘与小键盘同一格，同时按只发一次', () => {
    const input = new Input(new FakeEl() as unknown as HTMLElement)
    input.enabled = false
    input.uiOwner = 'dialogue'
    key('Digit5')
    input.poll(1 / 60)
    expect(intents(input.uiEdges)).toEqual(['pick5'])
    key('Digit5', true)
    input.poll(1 / 60)
    key('Numpad5')
    input.poll(1 / 60)
    expect(intents(input.uiEdges), '小键盘那一记也是 pick5：面板不该知道按的是哪一块键盘').toEqual(['pick5'])
    key('Digit3')
    key('Numpad3')
    input.poll(1 / 60)
    expect(intents(input.uiEdges), '两块键盘同时按 = 一次意图（先合并再求边沿）').toEqual(['pick3'])
    key('Digit3', true)
    key('Numpad3', true)
    input.poll(1 / 60)
    key('Digit0')
    input.poll(1 / 60)
    expect(intents(input.uiEdges), '没有 pick0 这一格：数字超出名册就是超出').toEqual([])
  })

  it('菜单开着时数字键不许再变成玩法技能槽（一条通道只有一个主人，两半都要成立）', () => {
    const input = new Input(new FakeEl() as unknown as HTMLElement)
    // 关着：Digit1 走玩法那条（ability1），UI 通道一格不发
    input.poll(1 / 60)
    key('Digit1')
    input.poll(1 / 60)
    expect(input.frame.edges.has('ability1')).toBe(true)
    expect(intents(input.uiEdges)).toEqual([])
    // 开着：`setOverlay` 把 enabled 与 uiOwner 一起翻，于是数字只剩 pick 这一读
    input.enabled = false
    input.uiOwner = 'dialogue'
    input.poll(1 / 60)
    key('Digit1', true)
    key('Digit1')
    input.poll(1 / 60)
    expect(intents(input.uiEdges)).toEqual(['pick1'])
    expect(input.frame.edges.size, '面板开着 = 世界停着：技能槽不许吃到菜单里的数字').toBe(0)
  })
})

describe('KI-062 两半接得上（一个入口，一次按键只挪一格）', () => {
  const NO_SAVES: SavePanelDeps = { list: async () => [], write: async () => null, erase: async () => false }
  const htmlOf = (p: object): string => (p as unknown as { root: FakeEl }).root.innerHTML
  const focusedTag = (html: string): string => (html.match(/<button\b[^>]*>/g) ?? []).find((t) => /focus/.test(t)) ?? ''

  it('真按一次方向键 + 一次 poll + 一次 uiStep ⇒ 焦点框恰好前进一格', async () => {
    const { Stakerite } = await import('@/ui/Stakerite')
    const rt = new RpgRuntime('origin_tuner', 3)
    let requests = 0
    const p = new Stakerite(rt, { onApply: () => {}, notify: () => {}, onUse: () => {}, onRequestClose: () => { requests++ } }, NO_SAVES)
    const input = new Input(new FakeEl() as unknown as HTMLElement)
    p.show()
    input.uiOwner = 'panel'

    fakePad([0, 0, 0, 0], [13])                        // 手柄：十字键下
    input.poll(1 / 60)
    p.uiStep(input.uiEdges)
    const first = focusedTag(htmlOf(p))
    expect(first, '手柄第一条意图就该把框点亮').toContain('focus')

    input.poll(1 / 60)                                 // 一直按着：没有新意图
    p.uiStep(input.uiEdges)
    expect(focusedTag(htmlOf(p)), '按住不放不许自己往下跑').toBe(first)

    fakePad([0, 0, 0, 0], [14])                        // 左：换页
    input.poll(1 / 60)
    p.uiStep(input.uiEdges)
    expect((p as unknown as { tab: string }).tab, '手柄肩键/左键切页落到 setTab 上').not.toBe('tune')

    fakePad([0, 0, 0, 0], [1])                         // B：后退一层 = 请求收面板
    input.poll(1 / 60)
    p.uiStep(input.uiEdges)
    expect(requests, 'B 走的是"提出请求"，不是自己 hide').toBe(1)
    fakePad()
  })
})

describe('KI-062 第二腿 标题阶段的泵（pumpMenu）：一帧一次 poll、一次喂读', () => {
  it('每帧恰好读一次输入、喂一次菜单；stop 之后两样都不再来', () => {
    const input = new Input(new FakeEl() as unknown as HTMLElement)
    input.uiOwner = 'title'
    const queue: ((t: number) => void)[] = []
    const cancelled: number[] = []
    let t = 0
    let feeds = 0
    const pump = pumpMenu(input, () => { feeds++ }, {
      raf: (cb) => { queue.push(cb); return queue.length },
      cancelRaf: (id) => { cancelled.push(id) },
      now: () => t,
    })
    expect(queue.length, '装上就转：不 poll 的话标题屏一根键都收不到').toBe(1)

    key('ArrowRight')
    queue.shift()!(t += 16)
    expect(feeds, '一帧一次喂读').toBe(1)
    expect(intents(input.uiEdges), '喂读时读到的是这一帧刚出现的边沿').toEqual(['right'])
    queue.shift()!(t += 16)
    expect(feeds, '第二帧：一直按着不是连发').toBe(2)
    expect(intents(input.uiEdges)).toEqual([])
    key('ArrowRight', true)

    pump.stop()
    const pending = queue.length
    for (let i = 0; i < pending; i++) queue.shift()!(t += 16)
    expect(feeds, 'stop 之后不再喂菜单，也不再 poll').toBe(2)
    expect(cancelled, '谁挂的 rAF 谁取消').toEqual([1])
    pump.stop()
    expect(cancelled.length, '第二次 stop 是空操作，不是第二次取消').toBe(1)
  })

  it('钳住回来的 dt（与 GameLoop 同一把尺）：标签页回前台不许补出半秒的按键史', () => {
    const dts: number[] = []
    const fake = { poll: (dt: number): void => { dts.push(dt) }, uiEdges: new Set<UiIntent>() }
    const queue: ((t: number) => void)[] = []
    pumpMenu(fake as unknown as Input, () => {}, { raf: (cb) => { queue.push(cb); return 1 }, cancelRaf: () => {}, now: () => 0 })
    queue.shift()!(0)
    queue.shift()!(5000)   // 挂机五分钟回来：不许把 5 秒当成一帧的按键史
    queue.shift()!(5016)
    expect(dts, '首帧 dt=0，缺席那一帧钳在 0.25，之后恢复正常帧长').toEqual([0, 0.25, 0.016])
  })
})

describe('KI-062 入口只有一个（源码门）', () => {
  const ui = readFileSync(root + 'src/ui/Stakerite.ts', 'utf8')
  const main = readFileSync(root + 'src/main.ts', 'utf8')

  it('面板自己不再挂任何 keydown 监听器：读数只有 uiStep 这一个入口', () => {
    expect(ui, 'DOM 一条 + 菜单一条 = 一次按键被数两遍').not.toMatch(/addEventListener\(\s*['"]keydown/)
    expect(ui).toMatch(/uiStep\(intents: ReadonlySet<UiIntent>\)/)
    expect(UI_BINDS.keyboard.Tab, 'Tab 的开关两条路靠 owner 互斥，不是靠两处各自判').toBe('back')
  })

  it('main 里：意图每帧喂一次，所有权的赋值只有一处', () => {
    // 注释里出现同样的字串不算数（探针 N7 第一次就是这样白给的：把喂线注释掉，toContain 仍然通过）
    const live = main.split(/[\r\n]+/).filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
    expect(live, '通道接好了却没人念给面板听：每帧喂一次这条要在（而且不能在注释里）').toContain('panel.uiStep(input.uiEdges)')
    expect(main.match(/input\.uiOwner = overlay/g)?.length, '认领与交还是同一次赋值：值就是 Overlay 变量本身（KI-097）').toBe(1)
    expect(main.match(/input\.uiOwner = (?:'panel'|'map'|null)/g), '字面量形状 = 第二份账：所有权不许再有一处直写').toBeNull()
    // 第三条原来数的是**原文**里的 `uiOwner` 出现次数（=3：一处赋值 + 注释里两次提及），
    // 于是 overlay 那一批为了解释"为什么只有一处"而写下的 `input.uiOwner = ` 本身就把门点到 4——
    // 一条为了说清规矩而存在的注释，反过来把守着规矩的判据弄红了（与它自己头一句"注释不算数"相反）。
    // 现在按同一把尺子量：**live 代码里只许那一处赋值**，注释爱写几遍写几遍；
    // 另留一条地板盯着"解释还在"——只剩一行裸代码而没人说为什么，下一个人会再写一处。
    expect(live.match(/uiOwner/g)!.length, 'live 代码里 uiOwner 只允许那一处赋值：别处不许再动所有权').toBe(1)
    expect(main.match(/uiOwner/g)!.length, '解释"为什么只有一处"的注释不见了：没人说过的规矩下一个人会再犯').toBeGreaterThanOrEqual(3)
  })

  it('第二腿：对话框与标题屏也不再自己挂 keydown，四格主人各有各的喂读腿', () => {
    const srcs = [
      ['DialogueBox', readFileSync(root + 'src/ui/DialogueBox.ts', 'utf8')],
      ['TitleScreen', readFileSync(root + 'src/ui/TitleScreen.ts', 'utf8')],
    ] as const
    for (const [name, src] of srcs) {
      expect(src, `${name}：DOM 一条 + 菜单一条 = 两个主人，一次回车被数两遍`).not.toMatch(/addEventListener\(\s*['"]keydown/)
      expect(src, `${name}：读数入口的签名要和面板同一份约定`).toMatch(/uiStep\(intents: ReadonlySet<UiIntent>\)/)
    }
    const live = main.split(/[\r\n]+/).filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
    for (const owner of ['panel', 'map', 'dialogue', 'title'] as const) {
      expect(live, `feedMenu 少喂 ${owner} 这一格：那块屏就成了挂名却不读数的第四者`).toContain(`overlay === '${owner}'`)
    }
    // 标题阶段环还不开，喂线要有第二个敲它的人；只有开环那一条腿的话，标题屏一根键都收不到
    expect(live, '环之前那一段要有泵：pumpMenu(input, feedMenu) 是标题屏唯一的读数来源').toContain('pumpMenu(input, feedMenu)')
  })

  it('pick 名册的键盘侧一条不缺：1-9 两种拼写都落到同一格', () => {
    expect(PICK_INTENTS.length, '"直接选第 n 项"的名册长度就是键盘能给的名册长度').toBe(9)
    for (let i = 0; i < PICK_INTENTS.length; i++) {
      const n = i + 1
      expect(UI_BINDS.keyboard[`Digit${n}`], `Digit${n} 没接进通道`).toBe(PICK_INTENTS[i])
      expect(UI_BINDS.keyboard[`Numpad${n}`], `Numpad${n} 与主键盘不是同一格`).toBe(PICK_INTENTS[i])
    }
    expect(UI_BINDS.keyboard.Escape, 'Escape 在菜单里 = 后退一层（玩法那条仍是 pause）').toBe('back')
    expect(UI_BINDS.keyboard.Space, '对话框的 hint 写着"空格 / 回车 继续"：空格必须等于 confirm').toBe('confirm')
  })
})
