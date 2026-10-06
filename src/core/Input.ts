export type ActionName =
  | 'moveUp' | 'moveDown' | 'moveLeft' | 'moveRight'
  | 'sprint' | 'jump' | 'dodge'
  | 'attackLight' | 'attackHeavy' | 'guard' | 'parry'
  | 'lockOn' | 'interact' | 'weaponSkill' | 'weaponSkillB'
  | 'observe'
  | 'ability1' | 'ability2' | 'ability3'
  | 'map' | 'pause' | 'throwCrystal'

export interface Binds {
  keyboard: Record<string, ActionName>
  padButtons: Record<number, ActionName>
  padAxes: { moveX: number; moveY: number; camX: number; camY: number }
}

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
  padButtons: {
    0: 'dodge', 2: 'parry', 1: 'weaponSkill', 3: 'interact',
    4: 'guard', 5: 'lockOn', 6: 'map', 7: 'sprint',
    8: 'pause', 9: 'attackHeavy', 10: 'attackLight', 11: 'jump',
    12: 'dodge', 13: 'attackLight', 14: 'attackHeavy', 15: 'parry',
    16: 'interact', 17: 'pause', 18: 'weaponSkillB'
  },
  padAxes: { moveX: 0, moveY: 1, camX: 2, camY: 3 }
}

const DEADZONE = 0.2
export const INPUT_BUFFER_SEC = 0.2

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
export type UiIntent = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'pagePrev' | 'pageNext'

/**
 * `Tab` 也进 `back` 是有道理的：开着面板时它是"收起来"，关着时它是"在调音桩前打开"——
 * 两条路各自只在一种状态下成立（`uiOwner` 与玩法那条 `edges.has('map')` 天然互斥）。
 * 顺带修一条死路：以前"Tab 关面板"写在 `core.update` 里，而面板开着时那一整段被 `paused` 挡住，
 * 所以 Tab 事实上只能开不能关。
 */
export const UI_BINDS: { keyboard: Record<string, UiIntent>; padButtons: Record<number, UiIntent>; stickThreshold: number } = {
  keyboard: {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    Enter: 'confirm', NumpadEnter: 'confirm', Backspace: 'back', Tab: 'back',
    PageUp: 'pagePrev', PageDown: 'pageNext',
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
  private binds: Binds
  private kbHeld = new Set<ActionName>()
  private mouseHeld = new Set<ActionName>()
  private padHeld = new Set<ActionName>()
  private prevHeld = new Set<ActionName>()
  private mouseLook = { dx: 0, dy: 0 }
  private padState = { moveX: 0, moveY: 0, lookX: 0, lookY: 0 }
  private bufferedEdges = new Map<ActionName, number>()
  private elapsed = 0
  frame: FrameInput = blankFrame()
  enabled = true
  /* ---------------- UI 意图通道（见 UI_BINDS 上方的理由） ---------------- */
  /**
   * 谁现在拥有菜单。null ⇒ 这条通道一格都不发，也**不抢**浏览器的默认行为
   * （方向键在没菜单时该 scroll 就 scroll，不该被游戏吃掉）。
   * 今天只有 `main.ts` 在面板开合时改它；对话框/标题屏各自留着 DOM 监听器，等各自那一批再并进来。
   */
  uiOwner: 'panel' | 'map' | null = null
  /** 本帧新出现的 UI 意图（edge 语义：一直按着不放不会连发） */
  uiEdges = new Set<UiIntent>()
  private kbUiHeld = new Set<UiIntent>()
  private padUiHeld = new Set<UiIntent>()
  private prevUi = new Set<UiIntent>()

  private activePad: Gamepad | null = null
  /** the currently-polled gamepad, for haptics (null when no pad connected) */
  get gamepad(): Gamepad | null { return this.activePad }

  constructor(el: HTMLElement, binds: Binds = DEFAULT_BINDS) {
    this.binds = binds
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return
      // UI 意图先记：它和玩法那条互不隶属（面板开着时玩法那条被 enabled 挡着，菜单却正需要读数）
      const ui = UI_BINDS.keyboard[e.code]
      if (ui && this.uiOwner) { e.preventDefault(); this.kbUiHeld.add(ui) }
      const a = this.binds.keyboard[e.code]
      if (!a) return
      if (['Space', 'Tab', 'F1', 'F2', 'F3', 'F4'].includes(e.code)) e.preventDefault()
      this.kbHeld.add(a)
    })
    window.addEventListener('keyup', (e) => {
      const ui = UI_BINDS.keyboard[e.code]
      if (ui) this.kbUiHeld.delete(ui)
      const a = this.binds.keyboard[e.code]
      if (a) this.kbHeld.delete(a)
    })
    el.addEventListener('mousedown', (e) => {
      const a = this.binds.keyboard[e.button === 0 ? 'MouseLeft' : 'MouseRight']
      if (a) { this.mouseHeld.add(a); void el.requestPointerLock() }
    })
    window.addEventListener('mouseup', (e) => {
      const a = this.binds.keyboard[e.button === 0 ? 'MouseLeft' : 'MouseRight']
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
      this.padState.moveX = dz(p.axes[this.binds.padAxes.moveX] ?? 0)
      this.padState.moveY = dz(p.axes[this.binds.padAxes.moveY] ?? 0)
      this.padState.lookX = dz(p.axes[this.binds.padAxes.camX] ?? 0)
      this.padState.lookY = dz(p.axes[this.binds.padAxes.camY] ?? 0)
      for (const [idx, a] of Object.entries(this.binds.padButtons)) {
        if (p.buttons[Number(idx)]?.pressed) this.padHeld.add(a)
      }
      /* 手柄的菜单读数：十字键 + A/B/LB/RB + 左摇杆。摇杆按"过阈值 = 按下"处理，
         于是一直推着不会连发（和按钮同一套 edge 语义），而十字键与摇杆同时推也只算一次。 */
      if (this.uiOwner) {
        for (const [idx, ui] of Object.entries(UI_BINDS.padButtons)) {
          if (p.buttons[Number(idx)]?.pressed) this.padUiHeld.add(ui)
        }
        const th = UI_BINDS.stickThreshold
        const ax = p.axes[this.binds.padAxes.moveX] ?? 0
        const ay = p.axes[this.binds.padAxes.moveY] ?? 0
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
    this.bufferedEdges.set(a, this.elapsed + INPUT_BUFFER_SEC)
  }

  consume(a: ActionName): boolean {
    if (!this.frame.edges.has(a)) return false
    this.frame.edges.delete(a)
    this.bufferedEdges.delete(a)
    return true
  }
}
