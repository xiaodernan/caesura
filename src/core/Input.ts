import { TICK_DT } from '@/core/Time'

/**
 * 动作名册（KI-336）：类型与运行时名单**同一个主人**。
 * 联合类型在这里是手写的，而运行时拿不到它——绑定一旦变成数据，`settings/Bindings.ts` 要回答
 * 「档里这一格的动作名到底存不存在」就只能在另一侧再抄一份名单。抄的副本会漂（§55 的唯一主人），
 * 所以名单先写成值，类型由它推导：默认表里把一个动作拼错，编译期就红，而不是变成一个没人绑的格子。
 */
const ACTION_NAMES = [
  'moveUp', 'moveDown', 'moveLeft', 'moveRight',
  'sprint', 'jump', 'dodge',
  'attackLight', 'attackHeavy', 'guard', 'parry',
  'lockOn', 'interact', 'weaponSkill', 'weaponSkillB',
  'observe',
  'ability1', 'ability2', 'ability3',
  'map', 'pause', 'throwCrystal'
] as const

export type ActionName = typeof ACTION_NAMES[number]

/** 可绑动作的运行时名册：信任边界读这一份，不另抄（顺序即默认表的书写顺序） */
export const BINDABLE_ACTIONS: readonly ActionName[] = ACTION_NAMES

export interface Binds {
  keyboard: Record<string, ActionName>
  padButtons: Record<number, ActionName>
  padAxes: { moveX: number; moveY: number; camX: number; camY: number }
  /**
   * 扳机推到多少算按下（KI-364，§6 那一格「扳机死区」）。**整张表里唯一一个数值格**，
   * 而且它说的是设备（那两把模拟扳机走到第几格）而不是某一行键位，所以它只有一个：
   * 判据住在 `padOn` 里，在捕获／玩法／菜单三个读者**分岔之前**回答一次——同一根手指的同一个深度
   * 不许有两个答案（那一条在捕获那一路最量得出来：等着一枚键的时候，半推既不作答也不撤武装）。
   * 「只有一个」不等于「不分通道」（KI-367 改口：这一句原来写的是「不随通道分家」）：配置文件那三盒
   * 按通道存／取时，这一格整格住 `settings/Bindings.ts > BIND_CHANNELS.pad` 那半，键盘那半没有它的一份。
   * 分家分的是同一个值的**那一份归谁搬**，不是把它劈成两个数——主人还是一个，读数面也还是那一个。
   * 默认值与界各有主人：默认住在下面的 `DEFAULT_BINDS`（这一格是它的一部分），界住在
   * `settings/Bindings.ts > BIND_BOUNDS.triggerThreshold`，玩家入口在 `setTriggerThreshold`。
   */
  triggerThreshold: number
  /**
   * 玩家**明说过**「键盘上这一格我不要」的动作（KI-342）。顺序取自动作名册，只有
   * `settings/Bindings.ts > clampBindings` 一个书写者——它是那张已解析完的键盘表的**投影**
   * （"这一格没有键"这件事由表本身说一次，这里只补一句"这是我要的"），不是第二张表。
   *
   * 为什么非要有这么一格：键盘那张表的语义是**整张**，所以"没被任何一格认领"这个写法已经被
   * 占去了「恢复默认」的意思（`clampBindings` 的回补那一遍正是这么读的）。用同一个写法同时表达
   * 两种相反的意思，结局是其中一种必然读不到——要「无」就得给它一个自己的名字。
   *
   * 它跟着 `setBindings` 一起抄进运行时那一份，不只是玩法通道要它：设置页那一列的「无」读的是
   * **消费者手里**这一份（`bindsSource.binds`），漏抄的那一半塌的是整条显示路，不止"按旧键没反应"。
   */
  unbound: ActionName[]
  /**
   * 玩家**明说过**「手柄这一行我不要」的动作（KI-346）。与上面那份同一条纪律（名册序、去重、
   * 只认名册、只有一个书写者），区别只在**它管哪张表**：这一份投影的是 `padButtons`，
   * 那份投影的是 `keyboard`。分成两份而不是共用一份，是因为「无」说的是"这一行在这一张表上不要"——
   * 面板上一行有四个家（键盘 · 手柄 · 两条名单），在一列上按下的按钮不许替另一列做主。
   *
   * 键盘那张有回补那一遍可以盖这份名单，手柄那张不回补，所以它的投影落在**两处**：
   * 档里残留的那一格、以及整块没写时兜底进来的默认那几格（`clampBindings > resolvePadMap`）。
   */
  padUnbound: ActionName[]
}

/** 玩法通道的**默认表**：默认快照的主人（`settings/Bindings.ts > defaultBindings()` 从它现推），
 *  运行时生效的那一份在 `Input.binds` 里。 */
export const DEFAULT_BINDS: Binds = {
  keyboard: {
    KeyW: 'moveUp', KeyS: 'moveDown', KeyA: 'moveLeft', KeyD: 'moveRight',
    ShiftLeft: 'sprint', Space: 'jump', ControlLeft: 'dodge',
    MouseLeft: 'attackLight', MouseRight: 'attackHeavy',
    KeyF: 'guard', KeyG: 'parry',
    KeyQ: 'lockOn', KeyE: 'interact', KeyR: 'weaponSkill', KeyC: 'weaponSkillB',
    KeyT: 'throwCrystal',
    KeyV: 'observe',
    Digit1: 'ability1', Digit2: 'ability2', Digit3: 'ability3',
    Tab: 'map', Escape: 'pause'
  },
  /* 10 = 标准映射的 L3（左摇杆点击）⇒ observe（KI-105①，2026-10-08）：声纹观察是「按一下发一波」的
     脉冲型动词，点摇杆正是这个手感；轻攻击是连打型，点摇杆没法连，它退守 13（十字键下）。 */
  padButtons: {
    0: 'dodge', 2: 'parry', 1: 'weaponSkill', 3: 'interact',
    4: 'guard', 5: 'lockOn', 6: 'map', 7: 'sprint',
    8: 'pause', 9: 'attackHeavy', 10: 'observe', 11: 'jump',
    12: 'dodge', 13: 'attackLight', 14: 'attackHeavy', 15: 'parry',
    16: 'interact', 17: 'pause', 18: 'weaponSkillB'
  },
  padAxes: { moveX: 0, moveY: 1, camX: 2, camY: 3 },
  // 扳机默认拐点是一半（KI-364）：0.5 是"推到行程一半才算按下"，界与治由 `BIND_BOUNDS`/`clampBindings` 说
  triggerThreshold: 0.5,
  // 「无」的默认值是"一个都没关"：默认表上每个动作都有键（这条由 `bindings-data` 的双射腿量着）
  unbound: [],
  // 手柄那侧同样默认"一个都没关"（KI-346）：那一列上每一行的家都由 `padButtons` 说，名单只说"不要"
  padUnbound: []
}

const DEADZONE = 0.2
export const INPUT_BUFFER_SEC = 0.2

/**
 * 标准映射里那两把**模拟量**键：6 = LT、7 = RT（其余那些格是数字键，浏览器只报一个布尔）。
 * 这一格说的是**物理位置**，与「它们此刻绑着谁」无关——把 `map` 从 6 搬到别处，6 仍然是一把扳机；
 * 把别的动作搬进 6，那个动作从此由玩家那条线回答"按下没"。判据按位置分岔正是本批的立足点：
 * 一条线管三个读者，而它不改任何一个读者的形状。
 */
const PAD_TRIGGER_INDICES = new Set([6, 7])

/**
 * DOM 报来的 `e.button` ⇒ 键盘那张表里的那一格合成码（KI-360）。名册只有这三格，
 * 与 `settings/Bindings.ts` 里 `CODE_RE` 收的那三格是同一份（第四、第五枚扩展键浏览器也报，
 * 但它们在那张表上无处落，所以在这条路上什么都不是）。按下与抬起**共用**这一份：
 * 两处各写一遍「0 是左键」，同一只手上的一枚中键就能一半算下、一半算抬。
 */
const MOUSE_CODES: Record<number, string> = { 0: 'MouseLeft', 1: 'MouseMiddle', 2: 'MouseRight' }

/**
 * 某个动作此刻绑在哪个键上（KI-181③：HUD 的键位参考行要从**运行时真值**画，不是从文档抄
 * 第二份——将来 §6 的全键位重映射落地，这一行自动跟着变）。返回给人看的短名（`KeyW`→`W`、
 * `MouseLeft`→`左键`、`Digit1`→`1`、其余原样），找不到绑定的动作返回 null（HUD 不画空行）。
 * null 说的是"这一格没有键"，**不说这是谁造成的**：玩家自己关掉的（`Binds.unbound`）与"整张表
 * 里没人认领它"在这一格里同形，要分清只能去问那份名单——显示侧不许拿一个 null 猜原因。
 */
/**
 * 一枚码的短名（给人看的那一份）。它是**唯一**一张换算表：`keyOf` 用它，菜单那一列的整组读数
 * 也用它（KI-344）——缩写规则一旦有第二份，同一把键就会在同一个屏幕上有两个名字。
 */
export const codeLabel = (code: string): string => {
  const mouse: Record<string, string> = { MouseLeft: '左键', MouseRight: '右键', MouseMiddle: '中键' }
  if (mouse[code]) return mouse[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code === 'ControlLeft' || code === 'ControlRight') return 'Ctrl'
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift'
  return code
}

export function keyOf(action: ActionName, binds: Binds = DEFAULT_BINDS): string | null {
  const code = Object.keys(binds.keyboard).find((k) => binds.keyboard[k] === action) ?? null
  return code === null ? null : codeLabel(code)
}

/* ---------------------------------------------------------------------------
 * UI 意图通道（ui-ux.md §5.2「摇杆/方向键 + 肩键切页 + Back 后退一层」（需求 §46 的 UI 细化，KI-062））。
 *
 * 为什么不复用玩法那套 ActionName：面板开着时 `enabled=false`，玩法那条 held/edges 是**故意空**的
 * （世界停摆期间不该有任何攻击边沿），而菜单恰恰只在这段窗口里需要读数。两套共用一条通道，
 * 结局要么是菜单吃不到键，要么是恢复游戏那一帧补发一次翻滚（KI-061 刚修掉的那条）。
 *
 * 也为什么它是"意图"而不是"键位"：手柄的十字键、左摇杆、键盘的方向键都表达同一件"往下走一格"，
 * 把它们折叠成一个意图，面板就不必知道今天接的是哪种设备——而且三个来源同时按下也只发一次边沿。
 * ------------------------------------------------------------------------- */
/* 数字键那一组为什么也进"意图"而不是让面板自己读码：对话框的『1-9 选择』与其余菜单读数必须
   走同一扇门——两处入口就是两个主人（KI-061 的"一次 ↓ 被数两遍"在这里的同款）。 */

/** 菜单导航意图的名册（八格）；`pick1..9` 那一组在下面 `PICK_INTENTS`，两半合起来是 `UiIntent` 的全值域 */
const UI_NAV = ['up', 'down', 'left', 'right', 'confirm', 'back', 'pagePrev', 'pageNext'] as const
const UI_PICK = ['pick1', 'pick2', 'pick3', 'pick4', 'pick5', 'pick6', 'pick7', 'pick8', 'pick9'] as const

export type UiIntent = typeof UI_NAV[number] | typeof UI_PICK[number]

/** 九格"直接选第 n 项"的意图名册：顺序即行号，`pickN` ⇄ 第 N 行的换算只有这一处 */
export const PICK_INTENTS: readonly UiIntent[] = UI_PICK
/** 八格导航意图的名册（与 `PICK_INTENTS` 合成运行时全值域，信任边界读这两份，不另抄） */
export const UI_NAV_INTENTS: readonly UiIntent[] = UI_NAV
export const UI_INTENTS: readonly UiIntent[] = [...UI_NAV, ...UI_PICK]

/** UI 通道的一份绑定表：与玩法那张同形两格 + 摇杆阈值（`stickThreshold` 是它的第三个主人） */
export interface UiBinds {
  keyboard: Record<string, UiIntent>
  padButtons: Record<number, UiIntent>
  stickThreshold: number
  /**
   * KI-344：菜单那条通道的「无」名单，与 `Binds.unbound` 同一份纪律（只有一个书写者
   * `clampBindings`，是那张已解析表的投影）。它只在**有回补那一步**的通道上才成立——菜单那条
   * 有（`resolveCodeMap` 的第二遍替没人认领的意图整组回归），所以"玩家说不要"有东西可盖；
   * 手柄那张不回补，同一个格子读不出第二种意思（KI-343 那半句）。
   */
  unbound: UiIntent[]
  /**
   * KI-346：菜单那一行的**手柄**那一份「无」。上面那份管的是键盘那一列，这一份管的是 `padButtons`
   * 那一列——两份名单各有各的那张表，谁也不许顺手关对方（面板上一行两个家，按在哪一列就是哪一列）。
   * 与玩法那侧的 `Binds.padUnbound` 同一条纪律，也多一道**出口那一格永远进不来**：
   * `UI_EXIT_INTENTS` 那句话管的是这条通道的**两张表**，不是其中一列（名册仍只有一个主人）。
   */
  padUnbound: UiIntent[]
}

/**
 * 运行时生效的两张表（玩法 + 菜单）合起来的形状——`settings/Bindings.ts` 存的就是它，
 * `Input.setBindings()` 收的也是它。分成两格是**两条通道各自成套**：`Tab` 在玩法是 `map`、
 * 在菜单是 `back`（靠 `uiOwner` 互斥，见上面的理由），所以一条通道内的"一码一动作"不许被
 * 另一条通道的同码判成冲突。
 */
export interface Bindings {
  gameplay: Binds
  ui: UiBinds
}

/**
 * 谁现在拥有菜单（`uiOwner` 的值域）。四格全在这里说清楚，是因为**每加一格就多一个 uiStep 读者**：
 * 面板/地图之外，对话框与标题屏从前各自挂着 DOM 监听器（KI-062 第二腿把它们接进来）。
 */
export type MenuOwner = 'panel' | 'map' | 'dialogue' | 'title'

/**
 * `Tab` 也进 `back` 是有道理的：开着面板时它是"收起来"，关着时它是"在调音桩前打开"——
 * 两条路各自只在一种状态下成立（`uiOwner` 与玩法那条 `edges.has('map')` 天然互斥）。
 * 顺带修一条死路：以前"Tab 关面板"写在 `core.update` 里，而面板开着时那一整段被 `paused` 挡住，
 * 所以 Tab 事实上只能开不能关。
 */
/**
 * 菜单通道的**默认表**（KI-336 之后它是数据而不是常量：`settings/Bindings.ts` 从它现推默认快照，
 * 运行时生效的那一份在 `Input.uiBinds` 里，可由 `setBindings()` 整张换掉）。
 */
export const UI_BINDS: UiBinds = {
  keyboard: {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    Enter: 'confirm', NumpadEnter: 'confirm', Backspace: 'back', Tab: 'back',
    PageUp: 'pagePrev', PageDown: 'pageNext',
    /* `Escape` 在菜单里 = 后退一层（玩法那条它仍是 `pause`，两者靠 owner 互斥，与 `Tab` 同一条理由）。
       `Space` / `KeyE` 折成 `confirm`：对话框的 hint 写的就是「空格 / 回车 继续」，而手柄 A 早就等于
       confirm——键盘不给这两格才是设备间的不一致（面板里它们同样=执行被框住那一行，与 Enter 同权）。
       数字键在菜单里不再当玩法技能槽用：面板开着时 `enabled=false`，玩法那条本来就是空的。 */
    Escape: 'back', Space: 'confirm', KeyE: 'confirm',
    Digit1: 'pick1', Digit2: 'pick2', Digit3: 'pick3', Digit4: 'pick4', Digit5: 'pick5',
    Digit6: 'pick6', Digit7: 'pick7', Digit8: 'pick8', Digit9: 'pick9',
    Numpad1: 'pick1', Numpad2: 'pick2', Numpad3: 'pick3', Numpad4: 'pick4', Numpad5: 'pick5',
    Numpad6: 'pick6', Numpad7: 'pick7', Numpad8: 'pick8', Numpad9: 'pick9',
  },
  // Xbox 布局：十字键 12-15、A=0、B=1、LB=4、RB=5
  padButtons: { 12: 'up', 13: 'down', 14: 'left', 15: 'right', 0: 'confirm', 1: 'back', 4: 'pagePrev', 5: 'pageNext' },
  stickThreshold: 0.55,
  // 「无」的默认值同样是"一个都没关"（KI-344）
  unbound: [],
  // 手柄那一列同样默认"一个都没关"（KI-346）
  padUnbound: []
}

/**
 * 这一条通道上**不许进「无」名单**的那几格（KI-344）。菜单那条的硬规则不是玩法那句「每格至少一把键」，
 * 而是「**菜单必须走得出去**」：别的意图关掉只是少一种能力（没有 `confirm` 就执行不了被框住的那一行，
 * 仍然退得出去），而 `back` 关掉是把这一屏变成陷阱——那一行是这一屏唯一的后退路。
 * 它与 KI-337 那句「`Escape` 算取消、不算绑成 `Escape`」是同一句的两半：那一屏唯一的后退键，
 * 捕获时不许顺手绑走，名单里也不许顺手关掉。
 *
 * 这一份名册有三个读者（`BindingsStore.unbindUi` 挡请求、`clampBindings` 丢掉手改档里的那一格、
 * 界面那一行不画「解绑」把手），但只有一个主人——面板不许自己数"哪些行看起来不能关"。
 */
export const UI_EXIT_INTENTS: readonly UiIntent[] = ['back']

/**
 * 玩法这一条通道上**不许进「无」名单**的那几格（KI-389）。菜单那条（上面那份）的硬规则是
 * 「菜单必须走得出去」，这一份是它对称过来的那一头：「**世界必须停得下来**」。22 枚里关掉别的动词
 * 只是少一种能力（没有 `confirm` 执行不了被框住的那一行，仍然退得出去），而 `pause` 两列一起关掉
 * 得到的是一个手动停不下来的世界——没有暂停、没有退出路，只有还在往前跑的循环。
 *
 * 为什么只有这一枚：它是 22 枚里唯一替那句话负责的动词（KI-388 结案时量的那一格：`consume('pause')`
 * 的读者 1 处，而默认表给它键盘 `Escape` 一处、手柄 8／17 两处）。护一枚在默认表上根本没家的动作是
 * 空话，所以那条腿也钉在 `bindings-data.test.ts` 里。
 *
 * 它与 `UI_EXIT_INTENTS` 是**两份**名册、不合并：两句话各自管一条通道。三个读者（`BindingsStore.unbind`
 * 与 `unbindPad` 挡请求、`clampBindings` 丢掉手改档里的那一格、界面那一行两把「解绑」都不画），
 * 主人只有一个——面板不许自己数"哪些行看起来不能关"，那是 KI-344 为菜单那条立过的同一格规矩。
 */
export const GAMEPLAY_EXIT_ACTIONS: readonly ActionName[] = ['pause']

/**
 * 一枚改键答案的**来历**（KI-361）：`keydown` 的码、鼠标那一枚合成码、还是轮询到的 `Pad<n>`。
 * 与 `armKeyCapture(via)` 那个 `'key' | 'pad'` 不是同一件事——那是"这次等哪一列"，这是"谁答了"；
 * 等键盘那一列时两种传感器都能答，所以这两个名字必须能不相等。
 */
export type AnswerSource = 'key' | 'mouse' | 'pad'

export interface FrameInput {
  move: { x: number; y: number }
  look: { dx: number; dy: number }
  edges: Set<ActionName>
  held: Set<ActionName>
}

const blankFrame = (): FrameInput => ({
  move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 },
  edges: new Set(), held: new Set()
})

export class Input {
  /** 此刻生效的玩法表（构造时是默认表，`setBindings()` 之后是档/设置里那一份） */
  private liveBinds: Binds
  /** 此刻生效的菜单表：同上，两条通道各自一张，同码不算冲突（靠 `uiOwner` 互斥） */
  private liveUi: UiBinds
  /** 显示层读这一格（HUD 键位列、面板槽位）——读 `DEFAULT_BINDS` 会让改键之后的屏幕说谎 */
  get binds(): Binds { return this.liveBinds }
  get uiBinds(): UiBinds { return this.liveUi }
  private kbHeld = new Set<ActionName>()
  private mouseHeld = new Set<ActionName>()
  private padHeld = new Set<ActionName>()
  private prevHeld = new Set<ActionName>()
  private mouseLook = { dx: 0, dy: 0 }
  private padState = { moveX: 0, moveY: 0, lookX: 0, lookY: 0 }
  private bufferedEdges = new Map<ActionName, number>()
  private elapsed = 0
  /**
   * KI-112：缓冲窗口不再是常量而是设置值（秒）。默认仍等于 INPUT_BUFFER_SEC——
   * 设置模块不改它，手感就不变；`frameAssist`（§5.1 的辅助格）在读档/设置侧翻开时，
   * 窗口在 bufferSec 之外再多保一帧（+TICK_DT，与逻辑 tick 同一把尺）。
   */
  bufferSec = INPUT_BUFFER_SEC
  frameAssist = false
  frame: FrameInput = blankFrame()
  enabled = true
  /* ---------------- UI 意图通道（见 UI_BINDS 上方的理由） ---------------- */
  /**
   * 谁现在拥有菜单。null ⇒ 这条通道一格都不发，也**不抢**浏览器的默认行为
   * （方向键在没菜单时该 scroll 就 scroll，不该被游戏吃掉）。
   * 唯一的写方是 `main.ts` 的 `setOverlay()`（KI-062 第二腿之后，对话框与标题屏也归它管，
   * 不再各自挂 DOM 监听器——DOM 一条 + 菜单一条就是两个主人）。
   */
  uiOwner: MenuOwner | null = null
  /** 本帧新出现的 UI 意图（edge 语义：一直按着不放不会连发） */
  uiEdges = new Set<UiIntent>()
  private kbUiHeld = new Set<UiIntent>()
  private padUiHeld = new Set<UiIntent>()
  private prevUi = new Set<UiIntent>()
  /* ---------------- 改键捕获（KI-337 键盘 / KI-343 手柄） ---------------- */
  /**
   * 「操作」页要的那一格是**物理键**，既不是玩法动作也不是菜单意图，所以它只能住在 `Input` 手里：
   * 面板自己挂 `keydown` 会被源闸门当场判红（DOM 一条 + 菜单一条 = 一次按键被数两遍，见 §5.2）。
   * 武装之后，下一枚"按下"事件只被记成键名，两条通道一格都不发。
   */
  private captureArmed = false
  private captured: string | null = null
  /**
   * 这次等的是**哪种传感器**（KI-343）。两条通道都哑这件事与来源无关，但"谁来作答"有关：
   * 等手柄时键盘不许替它作答，等键盘时手柄也不许——否则玩家在面板上用左摇杆走到那一行、
   * 顺手按了一下 A，改键界面就把那一行绑给了 A。
   * KI-360 起 `'key'` 那一次等待有**两枚**传感器作答（物理键与鼠标键）：鼠标那一枚在数据层
   * 就是键盘那张表里的格子（`Mouse*` 合成码），所以它复用这一格，不开第三个 `via`——
   * 「等的是哪一列」只有一个主人，而那一列上住着几种传感器由那张表自己说。
   */
  private captureVia: 'key' | 'pad' = 'key'
  /**
   * 手里那一枚答案是**哪一只传感器**答的（KI-361）。它与 `captureVia` 不是一回事：那一格说的是
   * 「这次等的是哪一列」，这一格说的是「谁作答了」——等键盘那一列时物理键与鼠标键都算答案，
   * 而屏幕上按在控制件上的那一下只想作废**自己那一枚**（`Stakerite.onClick` 那一声握手）。
   * 主人只有这一个：只有 `Input` 知道自己是从哪一条监听器收到这一枚的；让面板去从字符串里猜来源
   * （`isMouseCode(code)`）就是给代码拼写找第二个读者——KI-343 立的「语法才是路由」反的正是这个。
   */
  private capturedBy: AnswerSource | null = null
  /**
   * 等待途中被吞掉的那些手柄按钮下标（KI-343 的反幻影）。手柄**没有事件**：`pollPad` 每帧重读
   * 一遍，所以"吞掉一次按下"不能像键盘那样靠"keydown 只会来一次"自然成立——捕获结束之后的
   * 第一帧会把这个仍然按着的按钮读成一次**新**按下，于是改一次键送自己一次动作。
   * 口径因此是"到松开为止"：吞掉过的那一把要等它松开（`pressed` 落到 false）才重新作数。
   * 键盘那条不需要这一格，正是同一个区别的另一面。
   */
  private padConsumed = new Set<number>()

  private activePad: Gamepad | null = null
  /** the currently-polled gamepad, for haptics (null when no pad connected) */
  get gamepad(): Gamepad | null { return this.activePad }

  constructor(el: HTMLElement, binds: Binds = DEFAULT_BINDS, ui: UiBinds = UI_BINDS) {
    this.liveBinds = binds
    this.liveUi = ui
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return
      // 捕获武装着 ⇒ 这一枚键只被记成键名：两条通道都不发，浏览器的默认行为也拦住
      // （正在改键时按下的那把不该顺手把页面滚动一下、也不该先把面板后退一层）
      // KI-343：等的是手柄那一枚时，这一枚键盘**同样**要哑，但不许记、也不许把武装熄掉——
      // 「两条通道都哑与来源无关」与「只有对应的传感器能作答」是同一格的正反两面。
      if (this.captureArmed) {
        e.preventDefault()
        if (this.captureVia === 'key') { this.captured = e.code; this.capturedBy = 'key'; this.captureArmed = false }
        return
      }
      // UI 意图先记：它和玩法那条互不隶属（面板开着时玩法那条被 enabled 挡着，菜单却正需要读数）
      const intent = this.liveUi.keyboard[e.code]
      if (intent && this.uiOwner) { e.preventDefault(); this.kbUiHeld.add(intent) }
      const a = this.liveBinds.keyboard[e.code]
      if (!a) return
      // 这一串是**应用占住的键的名册**（KI-335 加 F5；`tests/flow/sec17-doc-rows.test.ts` 那条名册腿读的就是它）。
      // 读的人要分清两件事：面板键真正拦住浏览器的 `preventDefault` 在**面板自己**手里（F1~F6 一律没绑
      // 动作，走不到这一行 ⇒ 这里那个 `if` 今天对功能键是空转的），删掉这里的一格不会让面板失灵，
      // 只会让"哪把键被占住"这份名册少一格。那处空转登记在账本 KI-335 的「还欠」。
      if (['Space', 'Tab', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6'].includes(e.code)) e.preventDefault()
      this.kbHeld.add(a)
    })
    window.addEventListener('keyup', (e) => {
      const intent = this.liveUi.keyboard[e.code]
      if (intent) this.kbUiHeld.delete(intent)
      const a = this.liveBinds.keyboard[e.code]
      if (a) this.kbHeld.delete(a)
    })
    /* 鼠标那一枚的按下**只有这一处**在读（KI-360）。监听器挂在 window 而不是 canvas 上，
       为的是等待途中那一下：面板开着时 `.cxs` 那层是 `position:fixed; inset:0; pointer-events:auto`，
       canvas 被它整个盖住，挂在 canvas 上的"下一枚键"等于挂在一个玩家按不到的地方。
       换到 window 之后，"这一下落在世界上、还是落在面板上"要说清一句：**只有落在自己身上那一下才是玩法输入**
       （`e.target === el`；canvas 没有子元素，命中它的按下 target 就是它，与挂在 canvas 时同一件事）。
       等待途中那一下无论落在哪儿都只当一枚答案、不发行动、不锁指针——作答看的是传感器，不是坐标。 */
    window.addEventListener('mousedown', (e) => {
      const code = MOUSE_CODES[e.button]
      if (code === undefined) return
      if (this.captureArmed) {
        // 与键盘那一条同口径：等手柄时鼠标不许替它作答，也不许把武装熄掉（之后那把手柄照常接得住）
        e.preventDefault()
        if (this.captureVia === 'key') { this.captured = code; this.capturedBy = 'mouse'; this.captureArmed = false }
        return
      }
      if (e.target !== el) return
      const a = this.liveBinds.keyboard[code]
      if (a) { this.mouseHeld.add(a); void el.requestPointerLock() }
    })
    /* 抬起**不**问坐标：按下之后把手挪到屏幕哪儿松开都得抬得动（这是它一直挂在 window 上的理由）。
       也不在这里作答：作答的是按下那一拍，与键盘（keydown）和手柄（轮询到 pressed）同一时机。 */
    window.addEventListener('mouseup', (e) => {
      const code = MOUSE_CODES[e.button]
      if (code === undefined) return
      const a = this.liveBinds.keyboard[code]
      if (a) this.mouseHeld.delete(a)
    })
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === el) {
        this.mouseLook.dx += e.movementX
        this.mouseLook.dy += e.movementY
      }
    })
    window.addEventListener('blur', () => {
      this.kbHeld.clear(); this.mouseHeld.clear(); this.padHeld.clear()
      this.kbUiHeld.clear(); this.padUiHeld.clear()
    })
    el.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  /**
   * 换整张表：读档与（下一批的）设置页共用的唯一入口。
   *
   * 传进来的两张表**逐格抄一遍**，不存引用——store 手里那份之后还会被继续改，
   * 存引用就是让第二个主人能隔着 `Input` 改玩法。
   *
   * 换表那一拍清空键盘/鼠标侧的 held：`keyup` 查的是**新**表，旧表留下的那一格从此没有
   * 人来摘，一个仍然按着的键会永远挂在 `kbHeld` 里（镜头自己转的那种"鬼键"）。清空之后
   * 下一次 `poll` 只会看到 `deviceHeld` 为空 ⇒ 不产生边沿，所以这不是 KI-061 那条假边沿的
   * 复发（那条是"禁用的 held 被记进 prev"，这里是"prev 与 held 一起归零"）。
   */
  setBindings(next: Bindings): void {
    this.liveBinds = {
      keyboard: { ...next.gameplay.keyboard },
      padButtons: { ...next.gameplay.padButtons },
      padAxes: { ...next.gameplay.padAxes },
      // 扳机那条线逐格抄（KI-364）：这一格漏掉的形状不是报错，是屏幕上写着一个数、这里按另一个数生效
      triggerThreshold: next.gameplay.triggerThreshold,
      unbound: [...next.gameplay.unbound],
      padUnbound: [...next.gameplay.padUnbound]
    }
    /** 菜单那张同样逐格抄，数组那一格也不例外（KI-342 那个坑在两条通道上是同一个坑，KI-346 起是四份名单） */
    this.liveUi = {
      keyboard: { ...next.ui.keyboard },
      padButtons: { ...next.ui.padButtons },
      stickThreshold: next.ui.stickThreshold,
      unbound: [...next.ui.unbound],
      padUnbound: [...next.ui.padUnbound]
    }
    this.kbHeld.clear(); this.mouseHeld.clear(); this.kbUiHeld.clear()
  }

  /**
   * 武装改键捕获（KI-337「操作」页）。**每次只等一枚键**：读走即熄灭，
   * 所以"面板还在等"与"已经拿到键"两种状态不可能同时成立，不需要额外的握手。
   * `via`（KI-343）说这次等的是键盘那一列还是手柄那一枚，默认 `'key'` —— 既有那一行调用不必跟着改；
   * 键盘那一列今天住着两种传感器（物理键与 `Mouse*` 那三格，KI-360），两者都算这一枚的答案；
   * 记下来的形状是 `Pad<n>`（`<n>` = `GamepadButton` 的下标），与 `settings/Bindings.ts` 里
   * `rebind` 认的那两种目标拼写**是同一门语言**：捕获侧造串、边界侧解析，中间没有第三份表。
   */
  armKeyCapture(via: 'key' | 'pad' = 'key'): void {
    this.captureArmed = true
    this.captureVia = via
    this.captured = null
    this.capturedBy = null
  }

  cancelKeyCapture(): void { this.captureArmed = false; this.captured = null; this.capturedBy = null }

  /**
   * 取走并熄灭。为什么是"取"不是"看"：同一枚键被看两遍就是两个主人，而改键这条路是
   * 一次按下 ⇒ 一次换格。**没按时一格都不动**（尤其不许顺手撤掉武装）：面板每帧都要问一次，
   * 若"还没键"也把武装清了，玩家真正按下的那一枚就没人接了。
   * 换表那一拍不清捕获（等键的那一行与"这是谁的表"没有因果关系）。
   * `only`（KI-361）是**按来历问**：给了名字就只交回那一来历的答案，来历不符时一格都不动——
   * 连"没答案"也不许顺手撤武装。这不是新读法：面板那一声握手要的从来就是"这一下自己答的那一枚"，
   * 不带参数的老读法（投递那一路）一个字没变。
   */
  takeKeyCapture(only?: AnswerSource): string | null {
    if (this.captured === null) return null
    if (only !== undefined && this.capturedBy !== only) return null
    const code = this.captured
    this.captured = null
    this.capturedBy = null
    this.captureArmed = false
    return code
  }

  /**
   * 这一把此刻算不算按下（KI-364）。扳机那两把读玩家自己那条线与模拟量的比，其余那些格读浏览器报的布尔。
   *
   * 为什么扳机不许继续读那个布尔：它是 UA 从 `value` 里折出来的一个数——看不见、改不动，而 §6 那一格
   * 要的就是"这条线由玩家定"。折回来的那个数因此是这条线的**第二个答案**，而屏幕上写着另一个。
   * 为什么数字键不许改成读 `value`：规范里数字键的 `value` 也是 0 或 1，理论上等价，但等价的前提是驱动
   * 守规范；按位置分岔之后，那一类把扳机当数字键报的驱动（布尔真、`value` 是 0）仍然只剩**原有**那一条路，
   * 不会被这条新线判死。两侧各由一条腿量（`tests/unit/pad-trigger.test.ts` 第 1 与第 3 条），
   * 而"没别处再读那个布尔"由第 7 条腿钉着——判据只能有一个。
   */
  private padOn(i: number, b: GamepadButton): boolean {
    return PAD_TRIGGER_INDICES.has(i) ? b.value >= this.liveBinds.triggerThreshold : b.pressed
  }

  private pollPad(): void {
    this.padHeld.clear()
    this.padUiHeld.clear()
    this.activePad = null
    const pads = navigator.getGamepads ? navigator.getGamepads() : []
    this.padState = { moveX: 0, moveY: 0, lookX: 0, lookY: 0 }
    for (const p of pads) {
      if (!p) continue
      this.activePad = p
      const dz = (v: number) => (Math.abs(v) < DEADZONE ? 0 : v)
      this.padState.moveX = dz(p.axes[this.liveBinds.padAxes.moveX] ?? 0)
      this.padState.moveY = dz(p.axes[this.liveBinds.padAxes.moveY] ?? 0)
      this.padState.lookX = dz(p.axes[this.liveBinds.padAxes.camX] ?? 0)
      this.padState.lookY = dz(p.axes[this.liveBinds.padAxes.camY] ?? 0)
      /* 离散按钮：一张名册都读完之后才谈"这一把算不算"（KI-343）。
         等待途中的按下有三件事同时发生：① 若这次等的正是手柄且还没有答案，第一枚被记成 `Pad<n>`
         并熄灭武装（一次按下 ⇒ 一次换格，第二枚不许再进来）；② 无论如何这一把都进 `padConsumed`，
         两条通道不发；③ 松开之前它不许变成一次"新按下"。
         为什么整帧先看完armed再决定：一帧里同时按下 2 与 5 时，若读 2 时顺手把武装熄了，
         5 就会在同一帧里变成一次 lockOn——"我用改键的那只手送自己一次锁定"。 */
      const armed = this.captureArmed
      const awaitingPad = armed && this.captureVia === 'pad'
      for (let i = 0; i < p.buttons.length; i++) {
        const b = p.buttons[i]
        if (!b) continue
        // 「这一把算不算按下」只有 `padOn` 一个回答（KI-364）：下面三个读者都在这一个字之后才分岔
        if (!this.padOn(i, b)) { this.padConsumed.delete(i); continue }
        if (armed) {
          this.padConsumed.add(i)
          if (awaitingPad && this.captured === null) { this.captured = `Pad${i}`; this.capturedBy = 'pad'; this.captureArmed = false }
          continue
        }
        if (this.padConsumed.has(i)) continue
        const a = this.liveBinds.padButtons[i]
        if (a) this.padHeld.add(a)
        if (this.uiOwner) {
          const intent = this.liveUi.padButtons[i]
          if (intent) this.padUiHeld.add(intent)
        }
      }
      /* 手柄的菜单读数：十字键 + A/B/LB/RB + 左摇杆。摇杆按"过阈值 = 按下"处理，
         于是一直推着不会连发（和按钮同一套 edge 语义），而十字键与摇杆同时推也只算一次。
         摇杆（模拟量）**不进捕获形状**：它不是一枚"下一枚物理键"，绑不成 `Pad<n>`；
         也不因等待而断流——玩家得靠它走到要改的那一行，而连续推本来就不产生新边沿。 */
      if (this.uiOwner) {
        const th = this.liveUi.stickThreshold
        const ax = p.axes[this.liveBinds.padAxes.moveX] ?? 0
        const ay = p.axes[this.liveBinds.padAxes.moveY] ?? 0
        if (ay <= -th) this.padUiHeld.add('up')
        if (ay >= th) this.padUiHeld.add('down')
        if (ax <= -th) this.padUiHeld.add('left')
        if (ax >= th) this.padUiHeld.add('right')
      }
      break
    }
  }

  poll(dtReal: number): void {
    this.elapsed += dtReal
    this.pollPad()
    /* UI 意图：三个来源（键盘码 / 手柄按钮 / 摇杆）折成一组意图之后再求边沿——
       先合并再比，十字键和摇杆同时推才只发一次；反过来各发各的，面板就得自己防重复。 */
    const deviceUi = new Set<UiIntent>([...this.kbUiHeld, ...this.padUiHeld])
    const uiEdges = new Set<UiIntent>()
    if (this.uiOwner) for (const i of deviceUi) if (!this.prevUi.has(i)) uiEdges.add(i)
    this.prevUi = deviceUi
    this.uiEdges = uiEdges
    const deviceHeld = new Set<ActionName>([...this.kbHeld, ...this.mouseHeld, ...this.padHeld])
    const held = this.enabled ? deviceHeld : new Set<ActionName>()
    const edges = new Set<ActionName>()
    // `enabled` 只决定"游戏这一帧看不看得见输入"，不决定"我们还跟不跟设备状态"。
    // 以前禁用期是把 held 清空之后再记进 prevHeld 的，于是"在菜单里一直按着 A"会在关面板
    // 那一帧被当成新按下 —— 关个调音桩送自己一次翻滚（KI-061 抓出）。
    if (this.enabled) {
      for (const a of deviceHeld) if (!this.prevHeld.has(a)) edges.add(a)
      for (const [a, until] of this.bufferedEdges) {
        if (until < this.elapsed) this.bufferedEdges.delete(a)
        else if (!edges.has(a)) edges.add(a)
      }
    }
    const m = {
      x: (held.has('moveRight') ? 1 : 0) - (held.has('moveLeft') ? 1 : 0) + this.padState.moveX,
      y: (held.has('moveUp') ? 1 : 0) - (held.has('moveDown') ? 1 : 0) + (-this.padState.moveY)
    }
    const mag = Math.hypot(m.x, m.y)
    if (mag > 1) { m.x /= mag; m.y /= mag }
    this.frame = {
      move: m,
      look: {
        dx: this.mouseLook.dx * 0.0022 + this.padState.lookX * 2.4,
        dy: this.mouseLook.dy * 0.0022 + this.padState.lookY * 2.4
      },
      edges, held
    }
    this.mouseLook.dx = 0; this.mouseLook.dy = 0
    this.prevHeld = deviceHeld
  }

  endTick(): void {
    for (const a of this.frame.edges) {
      const stillHeld = this.frame.held.has(a)
      if (stillHeld && this.wasBuffered(a)) this.bufferedEdges.delete(a)
    }
  }

  private wasBuffered(a: ActionName): boolean { return this.bufferedEdges.has(a) }

  /** keep an edge alive for INPUT_BUFFER_SEC so systems on longer ticks can consume it */
  buffer(a: ActionName): void {
    this.bufferedEdges.set(a, this.elapsed + this.bufferSec + (this.frameAssist ? TICK_DT : 0))
  }

  consume(a: ActionName): boolean {
    if (!this.frame.edges.has(a)) return false
    this.frame.edges.delete(a)
    this.bufferedEdges.delete(a)
    return true
  }
}

/* ---------------------------------------------------------------------------
 * 标题阶段的菜单泵（KI-062 第二腿）。
 *
 * 为什么不直接开 `GameLoop` 再让它暂停：`GameLoop.tickFrame` 里 `time.tick++` 写在
 * `if (!this.time.paused)` **之外**——开着环站在标题屏会把「标题在场时 `time.tick` 停在 0」
 * 那条实测读数（KI-031②）报成"boot 已放行"。这里只读输入、只喂菜单，一格逻辑 tick 都不发。
 * ------------------------------------------------------------------------- */
export interface MenuPump {
  stop(): void
}

export function pumpMenu(
  input: Input,
  onView: () => void,
  deps: {
    raf?: (cb: (now: number) => void) => number
    cancelRaf?: (id: number) => void
    now?: () => number
  } = {},
): MenuPump {
  const raf = deps.raf ?? ((cb): number => requestAnimationFrame(cb))
  const cancelRaf = deps.cancelRaf ?? ((id): void => { cancelAnimationFrame(id) })
  const now = deps.now ?? ((): number => performance.now())
  let last = now()
  let id = 0
  let running = true
  const step = (t: number): void => {
    if (!running) return
    // 与 GameLoop 同一把钳：标签页回到前台不许补出半秒的按键史
    const dt = Math.min((t - last) / 1000, 0.25)
    last = t
    input.poll(dt)
    onView()
    id = raf(step)
  }
  id = raf(step)
  return {
    stop(): void {
      if (!running) return
      running = false
      cancelRaf(id)
    },
  }
}
