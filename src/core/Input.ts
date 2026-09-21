export type ActionName =
  | 'moveUp' | 'moveDown' | 'moveLeft' | 'moveRight'
  | 'sprint' | 'jump' | 'dodge'
  | 'attackLight' | 'attackHeavy' | 'guard' | 'parry'
  | 'lockOn' | 'interact' | 'weaponSkill'
  | 'ability1' | 'ability2' | 'ability3'
  | 'map' | 'pause'

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
    KeyQ: 'lockOn', KeyE: 'interact', KeyR: 'weaponSkill',
    Digit1: 'ability1', Digit2: 'ability2', Digit3: 'ability3',
    Tab: 'map', Escape: 'pause'
  },
  padButtons: {
    0: 'dodge', 2: 'parry', 1: 'weaponSkill', 3: 'interact',
    4: 'guard', 5: 'lockOn', 6: 'map', 7: 'sprint',
    8: 'pause', 9: 'attackHeavy', 10: 'attackLight', 11: 'jump',
    12: 'dodge', 13: 'attackLight', 14: 'attackHeavy', 15: 'parry',
    16: 'interact', 17: 'pause'
  },
  padAxes: { moveX: 0, moveY: 1, camX: 2, camY: 3 }
}

const DEADZONE = 0.2
export const INPUT_BUFFER_SEC = 0.2

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

  constructor(el: HTMLElement, binds: Binds = DEFAULT_BINDS) {
    this.binds = binds
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return
      const a = this.binds.keyboard[e.code]
      if (!a) return
      if (['Space', 'Tab', 'F1', 'F2', 'F3', 'F4'].includes(e.code)) e.preventDefault()
      this.kbHeld.add(a)
    })
    window.addEventListener('keyup', (e) => {
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
    })
    el.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  private pollPad(): void {
    this.padHeld.clear()
    const pads = navigator.getGamepads ? navigator.getGamepads() : []
    this.padState = { moveX: 0, moveY: 0, lookX: 0, lookY: 0 }
    for (const p of pads) {
      if (!p) continue
      const dz = (v: number) => (Math.abs(v) < DEADZONE ? 0 : v)
      this.padState.moveX = dz(p.axes[this.binds.padAxes.moveX] ?? 0)
      this.padState.moveY = dz(p.axes[this.binds.padAxes.moveY] ?? 0)
      this.padState.lookX = dz(p.axes[this.binds.padAxes.camX] ?? 0)
      this.padState.lookY = dz(p.axes[this.binds.padAxes.camY] ?? 0)
      for (const [idx, a] of Object.entries(this.binds.padButtons)) {
        if (p.buttons[Number(idx)]?.pressed) this.padHeld.add(a)
      }
      break
    }
  }

  poll(dtReal: number): void {
    this.elapsed += dtReal
    this.pollPad()
    const held = new Set<ActionName>([...this.kbHeld, ...this.mouseHeld, ...this.padHeld])
    if (!this.enabled) held.clear()
    const edges = new Set<ActionName>()
    for (const a of held) if (!this.prevHeld.has(a)) edges.add(a)
    for (const [a, until] of this.bufferedEdges) {
      if (until < this.elapsed) this.bufferedEdges.delete(a)
      else if (!edges.has(a)) edges.add(a)
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
    this.prevHeld = held
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
