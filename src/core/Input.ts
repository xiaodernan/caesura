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
  padAxes: { moveX: 0, moveY: 1, camX: 2, camY: 3 }
}

const DEADZONE = 0.2
export const INPUT_BUFFER_SEC = 0.2

/**
 * 某个动作此刻绑在哪个键上（KI-181③：HUD 的键位参考行要从**运行时真值**画，不是从文档抄
 * 第二份——将来 §6 的全键位重映射落地，这一行自动跟着变）。返回给人看的短名（`KeyW`→`W`、
 * `MouseLeft`→`左键`、`Digit1`→`1`、其余原样），找不到绑定的动作返回 null（HUD 不画空行）。
 */
export function keyOf(action: ActionName, binds: Binds = DEFAULT_BINDS): string | null {
  const code = Object.keys(binds.keyboard).find((k) => binds.keyboard[k] === action) ?? null
  if (!code) return null
  const mouse: Record<string, string> = { MouseLeft: '左键', MouseRight: '右键', MouseMiddle: '中键' }
  if (mouse[code]) return mouse[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code === 'ControlLeft' || code === 'ControlRight') return 'Ctrl'
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift'
  return code
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
}

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
  /* ---------------- 改键捕获（KI-337） ---------------- */
  /**
   * 「操作」页要的那一格是**物理键**，既不是玩法动作也不是菜单意图，所以它只能住在 `Input` 手里：
   * 面板自己挂 `keydown` 会被源闸门当场判红（DOM 一条 + 菜单一条 = 一次按键被数两遍，见 §5.2）。
   * 武装之后，下一枚"按下"事件只被记成键名，两条通道一格都不发。
   */
  private captureArmed = false
  private captured: string | null = null

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
      if (this.captureArmed) { e.preventDefault(); this.captured = e.code; this.captureArmed = false; return }
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
    el.addEventListener('mousedown', (e) => {
      const a = this.liveBinds.keyboard[e.button === 0 ? 'MouseLeft' : 'MouseRight']
      if (a) { this.mouseHeld.add(a); void el.requestPointerLock() }
    })
    window.addEventListener('mouseup', (e) => {
      const a = this.liveBinds.keyboard[e.button === 0 ? 'MouseLeft' : 'MouseRight']
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
      padAxes: { ...next.gameplay.padAxes }
    }
    this.liveUi = { keyboard: { ...next.ui.keyboard }, padButtons: { ...next.ui.padButtons }, stickThreshold: next.ui.stickThreshold }
    this.kbHeld.clear(); this.mouseHeld.clear(); this.kbUiHeld.clear()
  }

  /**
   * 武装改键捕获（KI-337「操作」页）。**每次只等一枚键**：读走即熄灭，
   * 所以"面板还在等"与"已经拿到键"两种状态不可能同时成立，不需要额外的握手。
   */
  armKeyCapture(): void { this.captureArmed = true; this.captured = null }

  cancelKeyCapture(): void { this.captureArmed = false; this.captured = null }

  /**
   * 取走并熄灭。为什么是"取"不是"看"：同一枚键被看两遍就是两个主人，而改键这条路是
   * 一次按下 ⇒ 一次换格。**没按时一格都不动**（尤其不许顺手撤掉武装）：面板每帧都要问一次，
   * 若"还没键"也把武装清了，玩家真正按下的那一枚就没人接了。
   * 换表那一拍不清捕获（等键的那一行与"这是谁的表"没有因果关系）。
   */
  takeKeyCapture(): string | null {
    if (this.captured === null) return null
    const code = this.captured
    this.captured = null
    this.captureArmed = false
    return code
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
      for (const [idx, a] of Object.entries(this.liveBinds.padButtons)) {
        if (p.buttons[Number(idx)]?.pressed) this.padHeld.add(a)
      }
      /* 手柄的菜单读数：十字键 + A/B/LB/RB + 左摇杆。摇杆按"过阈值 = 按下"处理，
         于是一直推着不会连发（和按钮同一套 edge 语义），而十字键与摇杆同时推也只算一次。 */
      if (this.uiOwner) {
        for (const [idx, intent] of Object.entries(this.liveUi.padButtons)) {
          if (p.buttons[Number(idx)]?.pressed) this.padUiHeld.add(intent)
        }
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
