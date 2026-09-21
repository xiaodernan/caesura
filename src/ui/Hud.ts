import { bus } from '../core/EventBus'

/** Screen-space (CSS px) lock-on target snapshot published by camera/lock systems. */
export interface TargetHudInfo {
  /** DOM-space pixel point of the target head/torso; null = no projection (hidden) */
  pos: { x: number; y: number } | null
  name: string
  hpFrac: number
  poiseFrac: number
  isBoss: boolean
}

declare module '../core/EventBus' {
  interface GameEvents {
    'ui.target': TargetHudInfo
  }
}

type RGB = readonly [number, number, number]
const BONE: RGB = [232, 223, 203]
const AMBER: RGB = [255, 184, 107]
const RED: RGB = [168, 50, 46]
const GOLD: RGB = [201, 180, 88]
const TAU = Math.PI * 2
const SERIF = 'Georgia, "Songti SC", "STSong", "SimSun", serif'

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const clamp = (lo: number, hi: number, v: number): number => (v < lo ? lo : v > hi ? hi : v)
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
/** deterministic hash noise (stable per integer seed, so the wave crackle stutters, not flickers) */
const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}
const css = (c: RGB, a: number): string => `rgba(${c[0]},${c[1]},${c[2]},${a})`
const mix = (c1: RGB, c2: RGB, t: number): RGB =>
  [Math.round(lerp(c1[0], c2[0], t)), Math.round(lerp(c1[1], c2[1], t)), Math.round(lerp(c1[2], c2[2], t))] as RGB
const GREYRED: RGB = [138, 90, 82]

interface Note { text: string; kind: 'info' | 'reward' | 'boss'; life: number }

/**
 * Full-frame Canvas-2D HUD in the "soundprint" visual language (docs/ui-ux.md §1):
 * HP amplitude wave, stamina beat ring + overdrive resonance layers, lock-on
 * voiceprint ring / boss phrase line, notification queue and death/damage screen
 * feedback. Pure event consumer: state arrives via bus events only.
 */
export class Hud {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly unsub: Array<() => void> = []

  private time = 0
  private cssW = 0
  private cssH = 0
  private dpr = 1

  // player stats (targets + displayed tweens)
  private hpFrac = 1
  private hpDisp = 1
  private stamFrac = 1
  private stamDisp = 1
  private odLayers = 0
  private spike = 0 // damage amplitude spike, decays
  private vign = 0 // edge vignette pulse
  private dead = false
  private deadT = 0

  // stamina ring
  private stamFlash = 0 // >0 while the consumed gap may flash on beats
  private stamIdle = 99 // seconds since last stamina change (6s fade rule)
  private ringAlpha = 0

  // rhythm
  private beatPulse = 0 // 1 at each beat point, decays
  private beatPeriod = 60 / 84
  private lastBeatAt = -1

  // target
  private target: TargetHudInfo | null = null
  private tAlpha = 0
  private tx = 0
  private ty = 0

  // notifications (max 3, 3s fade)
  private notes: Note[] = []
  /** 交互提示（[E] …），由 world/Interactables 每帧焦点变化时推送 */
  private prompt: string | null = null
  private promptA = 0

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('[Hud] 2d context unavailable')
    this.ctx = ctx

    this.unsub.push(
      bus.on('player.stats', (p) => this.onStats(p)),
      bus.on('player.damaged', () => {
        this.spike = 1
        this.vign = 1
      }),
      bus.on('player.died', () => {
        this.dead = true
        this.deadT = 0
      }),
      bus.on('rhythm.beat', (info) => {
        const now = this.time
        if (this.lastBeatAt >= 0) this.beatPeriod = clamp(0.2, 1.5, now - this.lastBeatAt)
        this.lastBeatAt = now
        this.beatPulse = 1
        void info
      }),
      bus.on('ui.notify', (p) => {
        this.notes.push({ text: p.text, kind: p.kind ?? 'info', life: 0 })
        while (this.notes.length > 3) this.notes.shift()
      }),
      bus.on('ui.prompt', (p) => { this.prompt = p.text }),
      bus.on('ui.target', (p) => {
        const fresh = !this.target || this.target.pos === null
        this.target = p
        if (p.pos && fresh) {
          this.tx = p.pos.x
          this.ty = p.pos.y
        }
      })
    )
  }

  dispose(): void {
    for (const off of this.unsub) off()
    this.unsub.length = 0
  }

  /** GameLoop render hook — real-time driven so the HUD keeps breathing while paused. */
  render(_alpha: number, realDelta: number): void {
    const dt = Math.min(realDelta, 0.25)
    this.time += dt

    this.spike = Math.max(0, this.spike - dt * 1.6)
    this.vign = Math.max(0, this.vign - dt * 2.2)
    this.stamFlash = Math.max(0, this.stamFlash - dt)
    this.beatPulse = Math.max(0, this.beatPulse - dt / Math.max(0.15, this.beatPeriod * 0.6))
    this.stamIdle += dt
    if (this.dead) this.deadT += dt

    const k = 1 - Math.exp(-dt / 0.12) // ~300ms numeric tween
    this.hpDisp = lerp(this.hpDisp, this.hpFrac, k)
    this.stamDisp = lerp(this.stamDisp, this.stamFrac, k)

    const wantRing = this.stamIdle < 6 || this.odLayers > 0
    this.ringAlpha = lerp(this.ringAlpha, wantRing ? 1 : 0, 1 - Math.exp(-dt / 0.15))

    const tg = this.target
    const wantTarget = tg ? (tg.isBoss || tg.pos ? 1 : 0) : 0
    this.tAlpha = lerp(this.tAlpha, wantTarget, 1 - Math.exp(-dt / 0.1))
    if (tg && tg.pos && !tg.isBoss) {
      this.tx = lerp(this.tx, tg.pos.x, 0.4)
      this.ty = lerp(this.ty, tg.pos.y, 0.4)
    }

    for (const n of this.notes) n.life += dt
    this.notes = this.notes.filter((n) => n.life < 3)

    const wantPrompt = this.prompt && !this.dead ? 1 : 0
    this.promptA = lerp(this.promptA, wantPrompt, 1 - Math.exp(-dt / 0.09))

    this.resizeIfNeeded()
    const { ctx } = this
    ctx.clearRect(0, 0, this.cssW, this.cssH)

    this.drawVignette()
    this.drawHpWave()
    this.drawBeatRing()
    this.drawTarget()
    this.drawNotes()
    this.drawPrompt()
    this.drawDeath()
  }

  // ---------------------------------------------------------------- events

  private onStats(p: {
    hp: number; hpMax: number; stamina: number; staminaMax: number
    overdrive: number; overdriveMax: number
  }): void {
    this.hpFrac = clamp01(p.hpMax > 0 ? p.hp / p.hpMax : 0)
    const stam = clamp01(p.staminaMax > 0 ? p.stamina / p.staminaMax : 0)
    if (stam < this.stamFrac - 0.002) {
      this.stamFlash = 1.2
      this.stamIdle = 0
    } else if (stam > this.stamFrac + 0.002) {
      this.stamIdle = 0
    }
    this.stamFrac = stam
    this.odLayers = clamp(0, 10, Math.round(p.overdriveMax > 0 ? (p.overdrive / p.overdriveMax) * 10 : 0))
    if (this.hpFrac > 0.001 && this.dead) {
      this.dead = false
      this.deadT = 0
    }
  }

  // ---------------------------------------------------------------- layout

  private resizeIfNeeded(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (w !== this.cssW || h !== this.cssH || dpr !== this.dpr) {
      this.cssW = w
      this.cssH = h
      this.dpr = dpr
      this.canvas.width = Math.round(w * dpr)
      this.canvas.height = Math.round(h * dpr)
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  /** design-space scale, 1920x1080 baseline; wide/4K screens only gain margin */
  private scale(): number {
    return Math.max(0.55, Math.min(this.cssW / 1920, this.cssH / 1080))
  }

  private hpLayout(): { x0: number; yc: number; w: number; h: number } {
    const s = this.scale()
    return { x0: 56 * s, yc: this.cssH - 56 * s, w: 320 * s, h: 26 * s }
  }

  // ---------------------------------------------------------------- widgets

  /** 1.3 HP amplitude bar — a waveform, not a rectangle bar. */
  private drawHpWave(): void {
    const { ctx } = this
    const { x0, yc, w, h } = this.hpLayout()
    const s = this.scale()
    const f = this.hpFrac
    const lowPulse = f < 0.3 ? 1 + 0.12 * Math.sin(this.time * 0.8 * TAU) : 1
    const alpha = (0.35 + clamp01((0.8 - f) / 0.5) * 0.55) * lowPulse
    const colRGB = f > 0.55
      ? mix(BONE, AMBER, clamp01((0.8 - f) / 0.25))
      : mix(AMBER, RED, clamp01((0.55 - f) / 0.55))
    const col = css(colRGB, alpha)

    // resting track the wave "should" fill
    ctx.strokeStyle = css(BONE, 0.10)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x0, yc)
    ctx.lineTo(x0 + w, yc)
    ctx.stroke()

    if (f <= 0.001) {
      // dead: waveform flatlines (heart-stop imagery)
      ctx.strokeStyle = css(RED, 0.85)
      ctx.lineWidth = 1.5 * s
      ctx.beginPath()
      ctx.moveTo(x0, yc)
      ctx.lineTo(x0 + w, yc)
      ctx.stroke()
      return
    }

    const len = w * clamp01(this.hpDisp)
    const amp = h * 0.5 * (0.85 + 0.9 * this.spike)
    const crackle = clamp01(0.9 - this.hpDisp) * 1.1 + this.spike * 1.6
    const steps = Math.max(28, Math.floor(len / (3 * s)))
    const seed = Math.floor(this.time * 12)

    const wave = (u: number): number => {
      const env = u > 0.82 ? clamp01((1 - u) / 0.18) * 0.8 + 0.2 : 1
      const base = Math.sin(u * 14 + this.time * 2.6) * 0.62 + Math.sin(u * 31 - this.time * 4.1) * 0.38
      const jit = (hash(u * 997 + seed * 131) - 0.5) * crackle * 2.6
      return (base * (1 + this.spike * 0.7) + jit) * amp * env
    }

    ctx.beginPath()
    ctx.moveTo(x0, yc)
    for (let i = 0; i <= steps; i++) {
      const u = i / steps
      ctx.lineTo(x0 + u * len, yc - wave(u))
    }
    for (let i = steps; i >= 0; i--) {
      const u = i / steps
      ctx.lineTo(x0 + u * len, yc + wave(u))
    }
    ctx.closePath()
    ctx.fillStyle = css(colRGB, alpha * 0.35)
    ctx.fill()
    ctx.strokeStyle = col
    ctx.lineWidth = 1.2 * s
    ctx.stroke()
  }

  /** 1.4 stamina beat ring + 1.x overdrive inner resonance glow (0-10 layers). */
  private drawBeatRing(): void {
    if (this.ringAlpha < 0.01) return
    const { ctx } = this
    const s = this.scale()
    const { x0, yc, w } = this.hpLayout()
    const cx = x0 + w + 62 * s
    const cy = yc
    const breath = 1 + 0.04 * this.beatPulse
    const r = 28 * s * breath
    const a0 = -Math.PI / 2
    const stam = clamp01(this.stamDisp)
    const exhausted = this.stamFrac <= 0.001
    const A = this.ringAlpha

    ctx.lineCap = 'round'
    ctx.globalAlpha = A

    // consumed sector: near-silent remainder
    ctx.lineWidth = 2 * s
    ctx.strokeStyle = css(BONE, 0.13)
    ctx.beginPath()
    ctx.arc(cx, cy, r, a0 + stam * TAU, a0 + TAU)
    ctx.stroke()

    // gap flashes on the beat while recently spent (full ring stays silent)
    if (this.stamFlash > 0 && this.beatPulse > 0.02 && stam < 0.999) {
      ctx.lineWidth = 3.2 * s
      ctx.strokeStyle = css(AMBER, 0.55 * this.beatPulse * clamp01(this.stamFlash))
      ctx.beginPath()
      ctx.arc(cx, cy, r, a0 + stam * TAU, a0 + TAU)
      ctx.stroke()
    }

    // remaining stamina arc: bone-white, amber right after a heavy cost,
    // grey-red shattered when exhausted
    ctx.lineWidth = 3 * s
    if (exhausted) {
      ctx.setLineDash([3 * s, 4 * s])
      ctx.strokeStyle = css(GREYRED, 0.9)
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, TAU)
      ctx.stroke()
      ctx.setLineDash([])
    } else {
      ctx.strokeStyle = this.stamFlash > 0.95 ? css(AMBER, 0.9) : css(BONE, 0.85)
      ctx.beginPath()
      ctx.arc(cx, cy, r, a0, a0 + stam * TAU)
      ctx.stroke()
    }

    // overdrive: concentric inner glow layers, 0-10
    for (let i = 0; i < this.odLayers; i++) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 3 + i * 0.9)
      ctx.lineWidth = 1.6 * s
      ctx.strokeStyle = css(GOLD, A * (0.10 + 0.045 * i + 0.05 * pulse))
      ctx.beginPath()
      ctx.arc(cx, cy, Math.max(4 * s, r - 7 * s - i * 2.1 * s), 0, TAU)
      ctx.stroke()
    }
    if (this.odLayers >= 10) {
      ctx.save()
      ctx.shadowColor = css(GOLD, 0.8)
      ctx.shadowBlur = 14 * s * (0.7 + 0.3 * this.beatPulse)
      ctx.strokeStyle = css(GOLD, A * 0.9)
      ctx.lineWidth = 1.5 * s
      ctx.beginPath()
      ctx.arc(cx, cy, r - 5 * s, 0, TAU)
      ctx.stroke()
      ctx.restore()
    }
    ctx.globalAlpha = 1
  }

  /** 1.x lock-on voiceprint ring; bosses swap to the bottom phrase line (1.6). */
  private drawTarget(): void {
    const tg = this.target
    if (!tg || this.tAlpha < 0.02) return
    if (tg.isBoss) {
      this.drawPhraseLine(tg)
      return
    }
    if (!tg.pos) return
    const { ctx } = this
    const s = this.scale()
    const A = this.tAlpha
    const cx = this.tx
    const cy = this.ty
    const r = 40 * s
    const a0 = -Math.PI / 2

    // voiceprint ring: segment widths read as a spectral signature (fixed seed)
    const segs = 28
    for (let i = 0; i < segs; i++) {
      const a1 = a0 + (i / segs) * TAU
      const a2 = a0 + ((i + 1) / segs) * TAU - 0.035
      const shimmer = 0.62 + 0.38 * Math.sin(this.time * 2.2 + i * 1.7)
      ctx.lineWidth = Math.max(0.9 * s, (0.5 + hash(i * 7.13) * 2.1) * s * shimmer)
      ctx.strokeStyle = css(GOLD, A * 0.62)
      ctx.beginPath()
      ctx.arc(cx, cy, r, a1, a2)
      ctx.stroke()
    }

    // hp as outer arc, poise as faint inner arc
    ctx.lineCap = 'butt'
    ctx.lineWidth = 2 * s
    ctx.strokeStyle = css(GOLD, A * 0.95)
    ctx.beginPath()
    ctx.arc(cx, cy, r + 7 * s, a0, a0 + clamp01(tg.hpFrac) * TAU)
    ctx.stroke()
    ctx.lineWidth = 1.2 * s
    ctx.strokeStyle = css(BONE, A * 0.45)
    ctx.beginPath()
    ctx.arc(cx, cy, r - 7 * s, a0, a0 + clamp01(tg.poiseFrac) * TAU)
    ctx.stroke()

    ctx.font = `${13 * s}px ${SERIF}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = css(GOLD, A * 0.9)
    ctx.fillText(tg.name, cx, cy + r + 26 * s)
  }

  /** 1.6 boss phrase line: one bar of music = one life bar, bar-lines = phases. */
  private drawPhraseLine(tg: TargetHudInfo): void {
    const { ctx } = this
    const s = this.scale()
    const A = this.tAlpha
    const half = this.cssW * 0.275
    const x0 = this.cssW / 2 - half
    const y = this.cssH - 34 * s
    const f = clamp01(tg.hpFrac)

    ctx.lineCap = 'butt'
    ctx.lineWidth = 1
    ctx.strokeStyle = css(BONE, 0.18 * A)
    ctx.beginPath()
    ctx.moveTo(x0, y)
    ctx.lineTo(x0 + half * 2, y)
    ctx.stroke()

    // damage erases notes right-to-left; the played part glows gold
    ctx.lineWidth = 2 * s
    ctx.strokeStyle = css(GOLD, 0.85 * A)
    ctx.beginPath()
    ctx.moveTo(x0, y)
    ctx.lineTo(x0 + half * 2 * f, y)
    ctx.stroke()

    // beat ticks across the phrase, every 4th a stronger bar line
    const beats = 16
    for (let i = 0; i <= beats; i++) {
      const x = x0 + (half * 2 * i) / beats
      const strong = i % 4 === 0
      ctx.strokeStyle = css(BONE, A * (strong ? 0.55 : 0.28))
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, y - (strong ? 7 : 4) * s)
      ctx.lineTo(x, y + (strong ? 7 : 4) * s)
      ctx.stroke()
    }

    // phase division marks at 60% / 25%
    for (const th of [0.6, 0.25]) {
      const x = x0 + half * 2 * th
      ctx.strokeStyle = css(GOLD, A * (f <= th ? 0.25 : 0.8))
      ctx.lineWidth = 1.5 * s
      ctx.beginPath()
      ctx.moveTo(x, y - 10 * s)
      ctx.lineTo(x, y + 10 * s)
      ctx.stroke()
    }

    ctx.font = `${14 * s}px ${SERIF}`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = css(GOLD, A * 0.95)
    ctx.fillText(tg.name, x0 + half * 2, y - 14 * s)
  }

  /** right-top notification queue: <=3 notes, slide in, 3s fade out. */
  private drawNotes(): void {
    const { ctx } = this
    const s = this.scale()
    const xr = this.cssW - 56 * s
    let y = 64 * s
    ctx.textAlign = 'right'
    ctx.textBaseline = 'alphabetic'
    for (const n of this.notes) {
      const inT = clamp01(n.life / 0.18)
      const slide = Math.pow(1 - inT, 3) * 34 * s // cubic settle in from the right edge
      const outA = n.life < 2.2 ? 1 : clamp01(1 - (n.life - 2.2) / 0.8)
      const A = inT * outA
      if (A <= 0.01) continue
      if (n.kind === 'boss') {
        ctx.font = `${16 * s}px ${SERIF}`
        ctx.fillStyle = css(GOLD, 0.95 * A)
      } else if (n.kind === 'reward') {
        ctx.font = `${12 * s}px ${SERIF}`
        ctx.fillStyle = css(GOLD, 0.85 * A)
      } else {
        ctx.font = `${12 * s}px ${SERIF}`
        ctx.fillStyle = css(BONE, 0.8 * A)
      }
      const prefix = n.kind === 'reward' ? '◆ ' : ''
      ctx.fillText(prefix + n.text, xr + slide, y)
      y += 26 * s
    }
  }

  /** bottom-centre interaction prompt: `[E] 动作` fades in with the Interactables focus. */
  private drawPrompt(): void {
    const text = this.prompt
    const a = clamp01(this.promptA)
    if (text === null || a <= 0.01) return
    const { ctx } = this
    const s = this.scale()
    const y = this.cssH - 148 * s
    const rise = (1 - a) * 8 * s
    const font = `${14 * s}px ${SERIF}`
    ctx.font = font
    ctx.textBaseline = 'middle'
    const key = '[E]'
    const gap = 10 * s
    const wKey = ctx.measureText(key).width
    const wAll = wKey + gap + ctx.measureText(text).width
    let x = this.cssW / 2 - wAll / 2
    ctx.textAlign = 'left'
    ctx.fillStyle = css(GOLD, 0.9 * a)
    ctx.fillText(key, x, y + rise)
    x += wKey + gap
    ctx.fillStyle = css(BONE, 0.82 * a)
    ctx.fillText(text, x, y + rise)
    ctx.fillStyle = css(GOLD, 0.18 * a)
    ctx.fillRect(this.cssW / 2 - wAll / 2, y + 13 * s + rise, wAll, 1)
  }

  /** hit feedback: brief warm-dark vignette pulse at the screen edges. */
  private drawVignette(): void {
    if (this.vign <= 0.01) return
    const { ctx } = this
    const w = this.cssW
    const h = this.cssH
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.34, w / 2, h / 2, Math.max(w, h) * 0.72)
    g.addColorStop(0, 'rgba(84,18,14,0)')
    g.addColorStop(1, `rgba(108,26,20,${(0.42 * this.vign).toFixed(3)})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  /** death: the full-screen caesura. */
  private drawDeath(): void {
    if (!this.dead) return
    const { ctx } = this
    const a = clamp01(this.deadT / 0.8)
    ctx.fillStyle = `rgba(7,8,12,${(0.6 * a).toFixed(3)})`
    ctx.fillRect(0, 0, this.cssW, this.cssH)
    const size = Math.min(this.cssW, this.cssH) * 0.16
    ctx.font = `${size}px ${SERIF}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = css(BONE, 0.92 * a)
    ctx.fillText('休 止', this.cssW / 2, this.cssH / 2)
    const s = this.scale()
    ctx.font = `${14 * s}px ${SERIF}`
    ctx.fillStyle = css(BONE, 0.45 * a)
    ctx.fillText('你的节拍停在这里', this.cssW / 2, this.cssH / 2 + size * 0.75)
  }
}
