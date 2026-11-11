import { describe, expect, it, beforeAll, afterEach } from 'vitest'
import { bus } from '@/core/EventBus'
import { Hud } from '@/ui/Hud'

/**
 * Hud 失谐腐败「余烬仪典」：
 *   ① corruption == 0 ⇒ 不画失谐弧、不画失谐余晖
 *   ② corruption 高 ⇒ 边缘淤血（4 条带渐变）+ 血条末端余烬弧发光
 *   ③ 满失谐 ⇒ 渲染不崩
 * 与 hud-quest.test.ts 同一套零 DOM Proxy canvas：bus 驱动 player.stats，
 * 统计 createLinearGradient / arc 调用。
 */
class CanvasProbe {
  readonly texts: string[] = []
  linearGradients: Array<{ args: unknown[] }> = []
  arcCount = 0
  createCtx() {
    const store: Record<string, unknown> = {}
    const grad = { addColorStop: () => {} }
    const probe = this
    return new Proxy(store, {
      get(t, k: string) {
        if (k in t) return t[k]
        if (k === 'createLinearGradient') return (...args: unknown[]) => { probe.linearGradients.push({ args }); return grad }
        if (k === 'createRadialGradient') return () => grad
        if (k === 'measureText') return () => ({ width: 10 })
        if (k === 'fillText') return (txt: unknown) => { probe.texts.push(String(txt)) }
        if (k === 'arc') return () => { probe.arcCount++ }
        return () => {}
      },
      set(t, k: string, v) { t[k] = v; return true },
    })
  }
}
let live: Hud[] = []
afterEach(() => { for (const h of live.splice(0)) h.dispose() })
beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  g.window = { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1 }
})
function stat(over: Partial<{ corruption: number; corruptionMax: number; corruptionVeil: number }> = {}) {
  return {
    hp: 70, hpMax: 100, stamina: 60, staminaMax: 100, poise: 30, poiseMax: 50,
    overdrive: 0, overdriveMax: 10,
    corruption: over.corruption ?? 0, corruptionMax: over.corruptionMax ?? 100,
    corruptionVeil: over.corruptionVeil ?? 0, muteTicksLeft: 0, rank: 4,
  }
}
describe('KI-521 · HUD 失谐腐败「余烬仪典」', () => {
  it('corruption=0：失谐余烬弧不出现；corruption=0.8：出现', () => {
    const probe = new CanvasProbe()
    const canvas = { getContext: () => probe.createCtx(), width: 0, height: 0 } as unknown as HTMLCanvasElement
    const hud = new Hud(canvas, null)
    live.push(hud)
    bus.emit('player.stats', stat({ corruption: 0 }))
    hud.render(0, 1 / 60)
    const arcsZero = probe.arcCount
    // 相同 HUD、相同场景，只推高失谐值：余烬弧从零变为非零
    bus.emit('player.stats', stat({ corruption: 80, corruptionVeil: 0.5 }))
    hud.render(0, 1 / 60)
    expect(probe.arcCount).toBeGreaterThan(arcsZero)
  })

  it('corruption=0.8：失谐淤血带渐变比 corruption=0 多 ≥ 4 条，余烬弧出现', () => {
    const probe = new CanvasProbe()
    const canvas = { getContext: () => probe.createCtx(), width: 0, height: 0 } as unknown as HTMLCanvasElement
    const hud = new Hud(canvas, null)
    live.push(hud)
    bus.emit('player.stats', stat({ corruption: 0 }))
    hud.render(0, 1 / 60)
    const gradsZero = probe.linearGradients.length
    const arcsZero = probe.arcCount
    bus.emit('player.stats', stat({ corruption: 80, corruptionVeil: 0.5 }))
    hud.render(0, 1 / 60)
    expect(probe.arcCount).toBeGreaterThan(arcsZero)
    expect(probe.linearGradients.length - gradsZero).toBeGreaterThanOrEqual(4)
  })

  it('满失谐 corruption=1.0：渲染不崩且余烬弧存在', () => {
    const probe = new CanvasProbe()
    const canvas = { getContext: () => probe.createCtx(), width: 0, height: 0 } as unknown as HTMLCanvasElement
    const hud = new Hud(canvas, null)
    live.push(hud)
    bus.emit('player.stats', stat({ corruption: 0 }))
    hud.render(0, 1 / 60)
    const arcsZero = probe.arcCount
    bus.emit('player.stats', stat({ corruption: 100, corruptionVeil: 1 }))
    hud.render(0, 1 / 60)
    expect(probe.arcCount).toBeGreaterThan(arcsZero)
    expect(probe.linearGradients.length).toBeGreaterThanOrEqual(4)
  })

  it('dispose：退订总线后后续 stats 不崩', () => {
    const probe = new CanvasProbe()
    const canvas = { getContext: () => probe.createCtx(), width: 0, height: 0 } as unknown as HTMLCanvasElement
    const hud = new Hud(canvas, null)
    hud.dispose() // 立即释放订阅
    expect(() => bus.emit('player.stats', stat({ corruption: 100 }))).not.toThrow()
  })
})
