import { bus } from '../core/EventBus'

/**
 * F2-toggled runtime debugger panel (top-left, monospace DOM div).
 * Fully decoupled: every datum comes from the bus event stream
 * (`combat.hit` / `player.stats` / `rhythm.beat`) — no combat internals import.
 */
export class CombatDebugger {
  private readonly panel: HTMLDivElement
  private readonly unsub: Array<() => void> = []
  private enabled = false
  private hits: string[] = []
  private beatStrip = ''
  private statsLine = '—'

  constructor() {
    const d = document.createElement('div')
    d.style.cssText = [
      'position:fixed', 'left:12px', 'top:12px', 'z-index:9999',
      'display:none', 'pointer-events:none',
      'font:11px/1.5 Consolas, "JetBrains Mono", Menlo, monospace',
      'color:#c9b458', 'background:rgba(7,8,12,0.72)',
      'border:1px solid rgba(201,180,88,0.35)', 'padding:8px 10px',
      'white-space:pre', 'max-width:460px'
    ].join(';')
    document.body.appendChild(d)
    this.panel = d

    window.addEventListener('keydown', this.onKey)

    this.unsub.push(
      bus.on('combat.hit', (h) => {
        const flags = `${h.backstab ? ' BS' : ''}${h.weakpoint ? ' WP' : ''}`
        this.hits.unshift(
          `${h.kind.padEnd(6)} ${h.result.padEnd(12)} dmg ${this.fmt(h.damage)}` +
          ` poise ${this.fmt(h.poiseDamage)} stop ${Math.round(h.hitStopMs)}ms${flags}`
        )
        if (this.hits.length > 12) this.hits.length = 12
        this.refresh()
      }),
      bus.on('player.stats', (p) => {
        this.statsLine =
          `HP ${this.fmt(p.hp)}/${this.fmt(p.hpMax)}  STA ${this.fmt(p.stamina)}/${this.fmt(p.staminaMax)}` +
          `  POI ${this.fmt(p.poise)}/${this.fmt(p.poiseMax)}  OD ${this.fmt(p.overdrive)}/${this.fmt(p.overdriveMax)}  R${p.rank}`
        this.refresh()
      }),
      bus.on('rhythm.beat', (info) => {
        const mark = info.isBarStart ? '│' : '·' // bar start = downbeat, marked
        this.beatStrip = (this.beatStrip + ` ${mark}${info.beatInBar}`).slice(-96)
        this.refresh()
      })
    )
    this.refresh()
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey)
    for (const off of this.unsub) off()
    this.unsub.length = 0
    this.panel.remove()
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'F2') return
    e.preventDefault()
    this.enabled = !this.enabled
    this.panel.style.display = this.enabled ? 'block' : 'none'
    this.refresh()
  }

  private fmt(v: number): string {
    return Number.isInteger(v) ? String(v) : v.toFixed(1)
  }

  private refresh(): void {
    if (!this.enabled) return
    const hits = this.hits.length > 0 ? this.hits.join('\n') : '—'
    const beats = this.beatStrip.length > 0 ? this.beatStrip : '—'
    this.panel.textContent =
      `combat.debug  (F2 close)\n` +
      `${this.statsLine}\n` +
      `beats: ${beats}\n` +
      `last 12 combat.hit (newest first):\n${hits}`
  }
}
