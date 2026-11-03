import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { TICK_DT } from '@/core/Time'
import { DEFAULT_BINDS, Input } from '@/core/Input'
import { BindingsStore } from '@/settings/Bindings'

/**
 * KI-337：「下一枚物理键」这件事的机制半格（玩家那一半在 `tests/flow/controls-page.test.ts`）。
 *
 * 为什么这组判据住在 `Input` 而不是面板：面板自己挂 `keydown` 会被源码闸门判红（DOM 一条 +
 * 菜单一条 = 一次按键被数两遍），所以捕获只能住在**已经有那一条监听器**的地方。
 * 而它一住进来就多了一条新规矩：**武装期间两条通道都要哑**。任何一条没哑，玩家按下要绑的那把键
 * 就会顺手发一次动作（在暂停面板里按 Ctrl ⇒ 世界已经闪了一下），那是改键界面最典型的坏形状。
 */

class FakeEl {
  handlers: Record<string, ((e: unknown) => void)[]> = {}
  /** KI-360：面板开着时把指针锁进 canvas 是看得见的伤害，量具得数得到它锁了几次 */
  locks = 0
  addEventListener(t: string, fn: (e: unknown) => void): void { (this.handlers[t] ??= []).push(fn) }
  requestPointerLock(): void { this.locks++ }
  dispatch(t: string, e: unknown): void { for (const fn of this.handlers[t] ?? []) fn(e) }
}

let win: Record<string, ((e: unknown) => void)[]> = {}
let prevented: string[] = []

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  g.document = { createElement: () => new FakeEl(), head: new FakeEl(), body: new FakeEl(), pointerLockElement: null }
  g.window = { addEventListener: (t: string, fn: (e: unknown) => void): void => { (win[t] ??= []).push(fn) } }
})

beforeEach(() => { win = {}; prevented = [] })

/** 往 window 上推一次键（`Input` 的键盘监听挂在 window） */
function key(code: string, up = false, repeat = false): void {
  const e = { code, repeat, preventDefault: (): void => { prevented.push(code) } }
  for (const fn of win[up ? 'keyup' : 'keydown'] ?? []) fn(e)
}

const input = (): Input => new Input(new FakeEl() as unknown as HTMLElement)

/** KI-360：鼠标那一枚要从屏幕上送进来，所以这一份量具得**留着**那个元素（`locks` 是要问的一格） */
function mouseRig(): { inp: Input; el: FakeEl } {
  const el = new FakeEl()
  return { inp: new Input(el as unknown as HTMLElement), el }
}
/**
 * 一次按下：`e.button` 用的是 DOM 的口径（0 左／1 中／2 右，3 与 4 是扩展键），
 * `target` 说的是这一下落在哪儿——KI-360 之后监听器在 window 上，"落在 canvas 上"这件事
 * 就得由量具自己写出来（默认落在 canvas：这是玩法的一下，只有等待途中那一下才不算）。
 */
const mouse = (el: FakeEl, button: number, on: unknown = el): void => {
  for (const fn of win.mousedown ?? []) fn({ button, target: on, preventDefault: (): void => { prevented.push(`button${button}`) } })
}
/** 抬起挂在 window 上（键盘那两条也是），所以它不需要元素 */
const mouseUp = (button: number): void => {
  for (const fn of win.mouseup ?? []) fn({ button })
}

describe('KI-337 改键捕获：武装期间两条通道都哑', () => {
  it('下一枚键只被记成键名：玩法不发、菜单也不发', () => {
    const inp = input()
    inp.uiOwner = 'panel'
    inp.armKeyCapture()
    key('KeyY')
    inp.poll(TICK_DT)
    expect([...inp.frame.edges], 'Y 在默认表上谁的键都不是，但仍不许被当成"某个动作"').toEqual([])
    expect([...inp.uiEdges], '菜单那条同样一格不发').toEqual([])
    expect(inp.takeKeyCapture(), '取走的是物理键名').toBe('KeyY')
  })

  it('绑过动作的那把键在等待中也不发动作（这才是"改键时不误触"的那半）', () => {
    const inp = input()
    inp.armKeyCapture()
    key('ControlLeft')   // 默认表上 = dodge
    inp.poll(TICK_DT)
    expect([...inp.frame.edges], '闪避没有被这一枚 Ctrl 打出去').toEqual([])
    expect(inp.takeKeyCapture()).toBe('ControlLeft')
  })

  it('等待中的那一枚仍走 preventDefault：按空格改键不该顺手把页面滚一下', () => {
    const inp = input()
    inp.armKeyCapture()
    key('Space')
    expect(prevented, '空格是浏览器的滚动键，挡住它是这一格的本分').toContain('Space')
    inp.poll(TICK_DT)   // 没有这一拍，下面那句读的是**初始**那个 frame，永远空 ⇒ 这一半就是空转
    expect(inp.frame.edges.has('jump'), '挡住了浏览器，也没漏出动作').toBe(false)
    // 第二截才是"捕获自己挡浏览器"的证人：Y 既不在应用占键名册里、默认表上也不是谁的键，
    // 正常那条路一个 preventDefault 都不会调 ⇒ 这一枚被挡住只能是因为捕获。
    inp.armKeyCapture()
    key('KeyY')
    expect(prevented, '捕获那一枚拦浏览器，不靠它恰好落在名册上').toContain('KeyY')
  })

  it('取走即熄灭：同一枚键被看两遍就是两个主人', () => {
    const inp = input()
    inp.armKeyCapture()
    key('KeyY')
    expect(inp.takeKeyCapture()).toBe('KeyY')
    expect(inp.takeKeyCapture(), '第二次问什么都没有了').toBeNull()
    key('ControlLeft'); inp.poll(TICK_DT)
    expect([...inp.frame.edges], '熄灭之后正常通道立刻回来').toEqual(['dodge'])
  })

  it('没按时一格都不动——尤其不许顺手撤掉武装（面板每帧都要问一次）', () => {
    const inp = input()
    inp.armKeyCapture()
    for (let f = 0; f < 3; f++) {
      inp.poll(TICK_DT)
      expect(inp.takeKeyCapture(), `第 ${f + 1} 帧没人按`).toBeNull()
    }
    key('KeyY')
    expect(inp.takeKeyCapture(), '问了三帧没人按，第四帧按下的那一枚仍要有人接').toBe('KeyY')
  })

  it('cancel 之后那一枚键回到正常通道：只撤面板的等待不撤机制，会留下一枚没人接的键', () => {
    const inp = input()
    inp.armKeyCapture()
    inp.cancelKeyCapture()
    key('ControlLeft'); inp.poll(TICK_DT)
    expect([...inp.frame.edges], '取消之后按 Ctrl 就是闪避，不是凭空消失').toEqual(['dodge'])
    expect(inp.takeKeyCapture(), '取消不留残余').toBeNull()
  })

  it('长按连发的 repeat 不算"玩家按下的那一枚键"', () => {
    const inp = input()
    inp.armKeyCapture()
    key('ControlLeft', false, true)
    expect(inp.takeKeyCapture(), '操作系统替按住不放补发的重复事件不能替玩家做决定').toBeNull()
    key('KeyY')
    expect(inp.takeKeyCapture(), '真正的按下仍然要接得住').toBe('KeyY')
  })

  it('捕获只管 keydown：松开照常放行，等键途中不会把"还按着"留在表里', () => {
    const inp = input()
    key('ControlLeft'); inp.poll(TICK_DT)
    expect([...inp.frame.held]).toEqual(['dodge'])
    inp.armKeyCapture()
    key('ControlLeft', true)   // 等待途中松开
    inp.poll(TICK_DT)
    expect([...inp.frame.held], 'keyup 不被捕获挡 ⇒ 不留鬼键').toEqual([])
    expect(inp.takeKeyCapture(), '松开不算按下').toBeNull()
  })

  it('换表那一拍不清捕获：等键途中改了键位，那一枚键仍归改键', () => {
    const inp = input()
    const store = new BindingsStore({ input: inp })
    inp.armKeyCapture()
    store.set({ gameplay: { keyboard: { KeyY: 'dodge' } } })   // Y 现在表上是 dodge
    key('KeyY'); inp.poll(TICK_DT)
    expect(inp.takeKeyCapture(), '先记键名，再谈它是谁').toBe('KeyY')
    expect([...inp.frame.edges], '新表里 Y=dodge 也不许在等待那一帧打出闪避').toEqual([])
  })

  it('没武装过就问取 ⇒ null（面板每帧都问，包括根本没进「操作」页的那些帧）', () => {
    const inp = input()
    expect(inp.takeKeyCapture()).toBeNull()
    key('KeyY'); inp.poll(TICK_DT)
    expect(inp.takeKeyCapture(), '没武装的按下走正常通道，不进捕获').toBeNull()
    expect([...inp.frame.edges]).toEqual([])
  })
})

/** KI-343：手柄那侧的「下一枚物理键」。 fake 一个 standard 布局的手柄，按下哪几把由参数点名；`null` = 没插手柄。
 *  每次调用都**现造**手柄对象（`getGamepads` 每帧读一次新的），所以模拟量也只能由参数给，不能事后改。 */
function padWith(pressed: number[] | null, axes: number[] = [0, 0, 0, 0]): void {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: {
      getGamepads: () => (pressed === null ? [null] : [{
        axes,
        buttons: Array.from({ length: 19 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
        mapping: 'standard', connected: true
      }])
    }
  })
}

describe('KI-343 手柄改键捕获：等的是手柄那一枚，键盘不许替它作答', () => {
  it('armed-for-pad ⇒ 下一次 poll 里第一枚按下的按钮被记成 `Pad<n>`，而那一帧两条通道都哑', () => {
    padWith([2])
    const inp = input()
    inp.uiOwner = 'panel'
    inp.armKeyCapture('pad')
    inp.poll(TICK_DT)
    expect(inp.takeKeyCapture()).toBe('Pad2')
    inp.poll(TICK_DT)
    expect([...inp.frame.edges], '捕获读走之后仍然按着 ⇒ 不该替自己打一次闪避').not.toContain('parry')
    expect([...inp.uiEdges]).toEqual([])
  })

  it('等手柄那一枚的途中按键盘 ⇒ 不记录、不灭武装，也不发玩法/菜单（两条通道都哑与来源无关）', () => {
    padWith([])
    const inp = input()
    inp.uiOwner = 'panel'
    inp.armKeyCapture('pad')
    key('Tab')   // Tab 在两张表上都有主人：玩法 map ＋ 菜单 back —— 一枚键同时问两条通道
    expect(inp.takeKeyCapture(), '键盘那枚不该替手柄作答').toBeNull()
    inp.poll(TICK_DT)
    expect([...inp.frame.edges], '不发 map').toEqual([])
    expect([...inp.uiEdges], '不发 back：菜单那条也不许被这一枚键挪一格').toEqual([])
    expect(prevented, '等待途中的默认行为照样拦住（Tab 不该把焦点从面板上挪走）').toEqual(['Tab'])
    inp.armKeyCapture('pad')   // 再武装一次仍然能用，说明上面那次没有把它消耗掉
    expect(inp.takeKeyCapture()).toBeNull()
    padWith([2])
    inp.poll(TICK_DT)
    expect(inp.takeKeyCapture(), '而被键盘挡掉的那次等待，之后仍接得住手柄').toBe('Pad2')
  })

  it('等键盘那一枚的途中按手柄 ⇒ 同样不记录、不灭武装，两条通道也照哑（反方向同一条口径）', () => {
    padWith([5])   // 5 = 玩法 lockOn ＋ 菜单 pageNext
    const inp = input()
    inp.uiOwner = 'panel'
    inp.armKeyCapture()
    inp.poll(TICK_DT)
    expect(inp.takeKeyCapture(), '手柄那一枚不该填进键盘那次等待').toBeNull()
    expect([...inp.frame.edges], '不发 lockOn').toEqual([])
    expect([...inp.uiEdges], '不发 pageNext').toEqual([])
    key('KeyY'); inp.poll(TICK_DT)
    expect(inp.takeKeyCapture(), '而键盘那枚照样接得住').toBe('KeyY')
  })

  it('等键盘途中按下的那把手柄，等完之后仍按着 ⇒ 也不补发一次动词（consumed 到松开为止）', () => {
    padWith([5])
    const inp = input()
    inp.armKeyCapture()
    inp.poll(TICK_DT)
    expect([...inp.frame.edges]).toEqual([])
    key('KeyY'); inp.poll(TICK_DT)          // 捕获被键盘那枚满足，手柄还按着
    expect(inp.takeKeyCapture()).toBe('KeyY')
    expect([...inp.frame.edges], '解锁之后的**第一帧**不许把"一直按着"读成刚按下（这一断言的位置就是这条腿的刀口）').toEqual([])
    inp.poll(TICK_DT)
    expect([...inp.frame.edges], '第二帧同样：consumed 到松开为止').toEqual([])
    padWith([]); inp.poll(TICK_DT)
    padWith([5]); inp.poll(TICK_DT)
    expect([...inp.frame.edges], '松开再按才是下一次使用它').toEqual(['lockOn'])
  })

  it('刚绑上的那一把还按着 ⇒ 不产生边沿；松开再按才发（否则改一次键送自己一次动作）', () => {
    const inp = input()
    inp.setBindings({
      gameplay: { ...DEFAULT_BINDS, keyboard: {}, padButtons: { 2: 'dodge' }, padAxes: { moveX: 0, moveY: 1, camX: 2, camY: 3 }, unbound: [], padUnbound: [] },
      ui: { keyboard: {}, padButtons: {}, stickThreshold: 0.55, unbound: [], padUnbound: [] }
    })
    padWith([2])
    inp.uiOwner = 'panel'
    inp.armKeyCapture('pad')
    inp.poll(TICK_DT)
    expect(inp.takeKeyCapture()).toBe('Pad2')
    inp.poll(TICK_DT)
    expect([...inp.frame.edges], '刚绑上那一把仍按着：绑好之后的**第一帧**就不许有边沿（断言晚一帧就是没量到）').toEqual([])
    inp.poll(TICK_DT)
    expect([...inp.frame.edges], '一直按着不放不许连发').toEqual([])
    padWith([])
    inp.poll(TICK_DT)
    padWith([2])
    inp.poll(TICK_DT)
    expect([...inp.frame.edges], '松开再按才是下一次使用这个动词').toEqual(['dodge'])
  })

  it('没插手柄 / 一把都没按 ⇒ 一格都不记、武装不灭（接上手柄之后的第一枚仍被接住）', () => {
    padWith(null)
    const inp = input()
    inp.armKeyCapture('pad')
    inp.poll(TICK_DT)
    expect(inp.takeKeyCapture(), '没有传感器可读 ⇒ 不许凭空造一个 `Pad0`').toBeNull()
    padWith([])
    inp.poll(TICK_DT)
    expect(inp.takeKeyCapture(), '插上了但一把没按 ⇒ 还是不许作答').toBeNull()
    padWith([7])
    inp.poll(TICK_DT)
    expect(inp.takeKeyCapture(), '武装还在 ⇒ 第一枚真按下的按钮被接住').toBe('Pad7')
  })

  it('手柄的模拟量（摇杆）不在捕获的形状里：它不记成 `Pad<n>`，也不因为等待而断流', () => {
    padWith([], [0, -1, 0, 0])   // axes[1] = 左摇杆 Y（padAxes.moveY 的默认下标）推到底
    const inp = input()
    inp.uiOwner = 'panel'
    inp.armKeyCapture('pad')
    inp.poll(TICK_DT)
    expect(inp.takeKeyCapture(), '摇杆推到底也不是一枚"下一枚物理键"（捕获只认离散按钮）').toBeNull()
    expect([...inp.uiEdges], '而导航读数不许因为等待断流：面板还得能用摇杆走到那一行').toEqual(['up'])
  })
})

/**
 * KI-360：键盘那张表里今天就住着 `MouseLeft`／`MouseRight`（默认表把轻击与重击挂在鼠标上，
 * `CODE_RE` 也明写「`Mouse*` 那三格是 `Input` 自己从 `e.button` 造出来的合成码」），而捕获那一路
 * 只认物理键与手柄按钮。这一串问的是三件各有来历的事：
 * ① **作答**：面板上点了「改键」之后按下鼠标，那一行原本永远写着「等待中」——而它等的那一枚
 *    其实落在得进来（监听器在 canvas 上，可面板那层 `.cxs` 是 `fixed; inset:0; pointer-events:auto`，
 *    真浏览器里等待途中手指根本碰不到 canvas）。所以这一批把按下那一拍搬到 window，作答才第一次可达。
 * ② **等待途中的那一下不许变成一次使用**：不发行动、不把指针锁进 canvas（锁走指针玩家就看不见自己刚绑的那一行）、
 *    也不许替手柄那一次作答。
 * ③ **三枚标准键各归各的**：`e.button` 老写法是「非左即右」，滚轮按下（1）与扩展键（3／4）都被读成右键那一支。
 */
describe('KI-360 鼠标那一枚第一次能作答：等待途中它既不发行动也不锁指针', () => {
  it('等键盘那一枚的途中按下左键 ⇒ 答案是一枚鼠标键，轻击没被打出去、指针也没被锁', () => {
    const { inp, el } = mouseRig()
    inp.armKeyCapture()
    mouse(el, 0)
    expect(inp.takeKeyCapture(), '那一行等的是「下一枚代码键」，而左键今天就住在那张表里').toBe('MouseLeft')
    inp.poll(TICK_DT)
    expect([...inp.frame.edges], '改键途中按下左键不许顺手打出一记轻击').toEqual([])
    expect(el.locks, '面板开着时把指针锁进 canvas，玩家就看不见自己刚绑上的那一行').toBe(0)
    expect(prevented, '等待途中的默认行为照样拦住（中键是浏览器的自动滚动）').toContain('button0')
  })

  it('那一下落在哪儿都算答案：等键途中点在面板上（不是 canvas）一样作答', () => {
    const { inp, el } = mouseRig()
    inp.armKeyCapture()
    mouse(el, 2, { name: 'veil' })   // 真浏览器里等待途中那一下只会落在面板那层遮罩上，不会落在 canvas 上
    expect(inp.takeKeyCapture(), '作答看的是传感器，不是坐标').toBe('MouseRight')
    expect(el.locks, '而不管落在哪儿，等待途中都不许把指针锁走').toBe(0)
  })

  it('第一枚作答者胜出：答完之后的第二枚鼠标键回到正常通道，发行动也锁指针', () => {
    const { inp, el } = mouseRig()
    inp.armKeyCapture()
    mouse(el, 0)
    expect(inp.takeKeyCapture()).toBe('MouseLeft')
    mouse(el, 2)
    inp.poll(TICK_DT)
    expect([...inp.frame.edges], '武装已经熄了，这一枚右键就是普通的一记重击').toEqual(['attackHeavy'])
    expect(el.locks, '捕获只管等待那一段，不管完之后').toBe(1)
  })

  it('等手柄那一枚的途中按下鼠标 ⇒ 不作答、不灭武装，而重击也没有被打出去', () => {
    padWith([])
    const { inp, el } = mouseRig()
    inp.uiOwner = 'panel'
    inp.armKeyCapture('pad')
    mouse(el, 2)
    inp.poll(TICK_DT)
    expect(inp.takeKeyCapture(), '鼠标那一枚填不进手柄那一次等待').toBeNull()
    expect([...inp.frame.edges], '等的是手柄，按下鼠标同样不许发动作').toEqual([])
    expect(el.locks, '也不许趁等待把指针锁走').toBe(0)
    padWith([5])
    inp.poll(TICK_DT)
    expect(inp.takeKeyCapture(), '武装还在 ⇒ 之后那把手柄照常接得住（与键盘那一条同口径）').toBe('Pad5')
  })

  it('作答途中按住不放、答完再松 ⇒ 表里从没进过"还按着"，松开再按才是第一次使用', () => {
    const { inp, el } = mouseRig()
    inp.armKeyCapture()
    mouse(el, 0)
    expect(inp.takeKeyCapture()).toBe('MouseLeft')
    mouseUp(0)
    inp.poll(TICK_DT)
    expect(inp.frame.held.has('attackLight'), '抬起不许被读成一次按下').toBe(false)
    mouse(el, 0)
    inp.poll(TICK_DT)
    expect([...inp.frame.edges], '等待结束之后重新按下，才是这一枚的第一次使用').toEqual(['attackLight'])
  })

  it('中键在等待里是一枚它自己的答案（`MouseMiddle`），不是右键的替身', () => {
    const { inp, el } = mouseRig()
    inp.armKeyCapture()
    mouse(el, 1)
    expect(inp.takeKeyCapture(), '三枚标准键各有各的名字，绑的时候也一样').toBe('MouseMiddle')
  })
})

/**
 * KI-361：答案从此带着"是谁答的"。这一格不是为了漂亮——面板按在控制件上的那一下要作废的**只有
 * 这一下自己答的那一枚**，而它此前问的是"袋里有没有东西"，于是同一帧里玩家按下的那把键被一次无关的
 * 点击吞掉，等待还被续上（屏幕上既不绑也不说为什么）。来源的主人在 `Input`：只有它知道自己是从
 * 哪一条监听器收到这一枚的；让面板去从字符串里猜来源，就是给代码拼写找第二个读者（KI-343 反的就是这个）。
 */
describe('KI-361 这一枚答案是谁答的：来源第一次有名字，而问名字的人只拿走自己那一只', () => {
  it('键盘答的那一枚不归「鼠标」那一位读者：它留在袋里，等下一帧那一行来取', () => {
    const inp = input()
    inp.armKeyCapture()
    key('KeyQ')
    expect(inp.takeKeyCapture('mouse'), '点控制件的那一下只该作废鼠标自己答的那一枚').toBeNull()
    expect(inp.takeKeyCapture(), '而那一枚键还在：投递那一路（下一帧的 `takeCapturedKey`）照样拿得到').toBe('KeyQ')
  })

  it('鼠标答的那一枚正是它的读者：交还、熄灭，同一枚答案不许被数两遍', () => {
    const { inp, el } = mouseRig()
    inp.armKeyCapture()
    mouse(el, 0)
    expect(inp.takeKeyCapture('mouse')).toBe('MouseLeft')
    expect(inp.takeKeyCapture(), '取走即熄灭——KI-337 那条纪律在新读法下同样成立').toBeNull()
  })

  it('手柄答的那一枚同样不归鼠标：按名字问才答得出来（三个来源各有各的名字）', () => {
    padWith([])
    const inp = input()
    inp.uiOwner = 'panel'
    inp.armKeyCapture('pad')
    padWith([5])
    inp.poll(TICK_DT)
    expect(inp.takeKeyCapture('mouse'), 'Pad5 不是这一下点出来的').toBeNull()
    expect(inp.takeKeyCapture('pad'), '名字是这一格的第三个读数，不是给文案猜的').toBe('Pad5')
  })

  it('不传参数的老读法一个字没改：谁答的都交还（这条一写出来就该绿——它继承的是 KI-337）', () => {
    padWith([])
    const { inp, el } = mouseRig()
    inp.uiOwner = 'panel'
    inp.armKeyCapture()
    key('KeyZ')
    expect(inp.takeKeyCapture(), '键盘那一路照旧').toBe('KeyZ')
    inp.armKeyCapture()
    mouse(el, 2)
    expect(inp.takeKeyCapture(), '鼠标那一路照旧').toBe('MouseRight')
    inp.armKeyCapture('pad')
    padWith([7])
    inp.poll(TICK_DT)
    expect(inp.takeKeyCapture(), '手柄那一路照旧').toBe('Pad7')
  })

  it('换一行重问之后上一枚的来源不许还挂着：`arm` 把名字一起清掉', () => {
    const { inp, el } = mouseRig()
    inp.armKeyCapture()
    key('KeyQ')
    expect(inp.takeKeyCapture('mouse'), '第一枚是键盘答的，鼠标那一位读者问不到').toBeNull()
    inp.armKeyCapture()   // 玩家去点另一行的「改键」：上一枚作废，重新开始等一枚
    mouse(el, 2)          // 这一次答的是右键
    expect(inp.takeKeyCapture('key'), '新答案的来历是鼠标，不许还挂着上一枚的键盘名字').toBeNull()
    expect(inp.takeKeyCapture('mouse')).toBe('MouseRight')
  })
})

