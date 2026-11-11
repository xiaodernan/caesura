import { describe, expect, it, beforeAll, afterEach } from 'vitest'
import { registerGameData } from '@/data'
import { bus } from '@/core/EventBus'
import { Hud } from '@/ui/Hud'

/**
 * KI-522 · 死亡由「止音 · 禅宗往生」升格：往生双环 + 余烬弧 + 墨染 + 「寂」印。
 * 与 hud-screen.test.ts 同一套零 DOM Proxy canvas：bus 驱动 player.died，
 * 统计 arc 数量与 texts 内容——不声称美术评审通过（canvas 真无法目检像素）。
 */
interface Recorder {
  texts: string[]
  arcCount: number
  shadowBlurMax: number
  rectCount: number
}
function makeHud(): { hud: Hud; rec: Recorder } {
  const rec: Recorder = { texts: [], arcCount: 0, shadowBlurMax: 0, rectCount: 0 }
  const store: Record<string, unknown> = {}
  const grad = { addColorStop: () => {} }
  let shadowBlur = 0
  const ctx = new Proxy(store, {
    get(t, k: string) {
      if (k in t) return t[k]
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad
      if (k === 'measureText') return () => ({ width: 10 })
      if (k === 'arc') return () => { rec.arcCount++ }
      if (k === 'fillText') return (txt: unknown) => { rec.texts.push(String(txt)) }
      if (k === 'fillRect') return () => { rec.rectCount++ }
      if (k === 'shadowBlur') return shadowBlur
      return () => {}
    },
    set(t, k: string, v) {
      if (k === 'shadowBlur') { shadowBlur = Number(v) || 0; rec.shadowBlurMax = Math.max(rec.shadowBlurMax, shadowBlur) }
      t[k] = v
      return true
    },
  })
  const canvas = { getContext: () => ctx, width: 0, height: 0 } as unknown as HTMLCanvasElement
  const hud = new Hud(canvas, null)
  live.push(hud)
  return { hud, rec }
}
let live: Hud[] = []
afterEach(() => { for (const h of live.splice(0)) h.dispose() })
beforeAll(() => {
  registerGameData()
  const g = globalThis as unknown as Record<string, unknown>
  g.window = { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1 }
})
const stats = (over: Record<string, unknown> = {}): void => {
  bus.emit('player.stats', {
    hp: 100, hpMax: 100, stamina: 100, staminaMax: 100,
    poise: 100, poiseMax: 100, overdrive: 0, overdriveMax: 10,
    rank: 1, corruption: 0, corruptionMax: 100, corruptionVeil: 0, muteTicksLeft: 0,
    ...over,
  })
}
describe('KI-522 · HUD 死亡「往生仪典」止音', () => {
  it('player.died ⇒ render 不崩、arc 双环 + 余烬弧（≥3）、shadowBlur>0 辉光', () => {
    const { hud, rec } = makeHud()
    stats()
    hud.render(0, 1 / 60)
    bus.emit('player.died', undefined)
    for (let i = 0; i < 8; i++) hud.render(0, 1 / 60)
    expect(rec.texts).toContain('休 止')
    expect(rec.arcCount).toBeGreaterThanOrEqual(3)
    expect(rec.shadowBlurMax).toBeGreaterThan(0)
    expect(rec.rectCount).toBeGreaterThan(0)
  })

  it('player.died 后复活（hp>0）⇒ dead 复位 + 主字消失', () => {
    const { hud, rec } = makeHud()
    stats()
    hud.render(0, 1 / 60)
    bus.emit('player.died', undefined)
    for (let i = 0; i < 8; i++) hud.render(0, 1 / 60)
    expect(rec.texts).toContain('休 止')
    rec.texts.length = 0
    stats({ hp: 50 })
    for (let i = 0; i < 8; i++) hud.render(0, 1 / 60)
    expect(rec.texts).not.toContain('休 止')
  })
})
