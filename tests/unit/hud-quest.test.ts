import { describe, expect, it, beforeAll, afterEach } from 'vitest'
import { bus } from '@/core/EventBus'
import { Hud } from '@/ui/Hud'

/**
 * 常驻任务行（KI-113②）：`quest.changed` 事件注释里写着「UI 与调试面板据此播报」，
 * 调试面板（F3）早有这一格，HUD 没有——玩家在灰盒里走得再远，「现在该干什么」只有
 * 开调试器才知道。本文件钉住 HUD 那一格的三条纪律：
 *  · 事件带的 label/序号**原样上屏**，HUD 不抄第二份任务数据（没有事件就没有行）；
 *  · 任务不在场（没接）不占屏；
 *  · 步进与收束共用一格，收束那一拍文案换成「一段收束」。
 * 用 hud-milestones.test.ts 同一套画布替身（零 DOM 测试环境）。
 */

interface Recorder {
  texts: string[]
}

function makeHud(): { hud: Hud; rec: Recorder } {
  const rec: Recorder = { texts: [] }
  const store: Record<string, unknown> = {}
  const grad = { addColorStop: () => {} }
  const ctx = new Proxy(store, {
    get(t, k: string) {
      if (k in t) return t[k]
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad
      if (k === 'measureText') return () => ({ width: 10 })
      if (k === 'fillText') return (txt: unknown) => { rec.texts.push(String(txt)) }
      return () => {}
    },
    set(t, k: string, v) { t[k] = v; return true }
  })
  const canvas = { getContext: () => ctx, width: 0, height: 0 } as unknown as HTMLCanvasElement
  const hud = new Hud(canvas)
  live.push(hud)
  return { hud, rec }
}

let live: Hud[] = []
afterEach(() => { for (const h of live.splice(0)) h.dispose() })

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  g.window = { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1 }
})

const STEP = {
  questId: 'q_haltrune', state: 'HALTRUNE.STEP2_ROSTER', index: 1, total: 4,
  label: '《点名册》：七个还在巡逻的兵，他记的是四个', started: true, completed: false
}

describe('HUD 常驻任务行：quest.changed 的第四个读者', () => {
  it('事件带什么画什么：谱册序号行 + 步 label 原样上屏（不抄第二份任务数据）', () => {
    const { hud, rec } = makeHud()
    bus.emit('quest.changed', STEP)
    hud.render(0, 1 / 60)
    expect(rec.texts.some((t) => t.includes('谱册 · 2/4')), '序号行来自事件的 index/total').toBe(true)
    expect(rec.texts.some((t) => t.includes('《点名册》')), 'label 原样').toBe(true)
  })

  it('没有事件就没有行：任务不在场不占屏（发了 started=false 且 index<0 的播报也不画）', () => {
    const { hud, rec } = makeHud()
    hud.render(0, 1 / 60)
    expect(rec.texts.some((t) => t.includes('谱册')), '静默世界里没有任务行').toBe(false)
    bus.emit('quest.changed', { ...STEP, started: false, index: -1 })
    hud.render(0, 1 / 60)
    expect(rec.texts.some((t) => t.includes('谱册')), '空播报不画空行').toBe(false)
  })

  it('收束那一拍换成「一段收束」，长句截断不是阅读区', () => {
    const { hud, rec } = makeHud()
    bus.emit('quest.changed', { ...STEP, completed: true, label: 'x'.repeat(40) })
    hud.render(0, 1 / 60)
    expect(rec.texts.some((t) => t.includes('一段收束'))).toBe(true)
    const long = rec.texts.find((t) => t.startsWith('xxx'))
    expect(long && long.length, '超过 30 字截断加省略号').toBeLessThanOrEqual(30)
  })
})
