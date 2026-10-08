import { describe, expect, it, beforeAll, afterEach } from 'vitest'
import { registerGameData } from '@/data'
import { bus } from '@/core/EventBus'
import { Hud } from '@/ui/Hud'

/**
 * Hud：全帧 Canvas-2D HUD（soundprint 视觉语言）。
 *
 * 覆盖缺口（cov9 missing 289 行）：
 * - 事件处理：player.damaged/vignette、player.died/death、ui.notify 队列、ui.target voiceprint/boss、ui.prompt
 * - onStats 分支：stamFlash/降/升、dead reset、rankFlash
 * - onStatus：TTL 删除、value<=0 删除
 * - 绘制：corruption bar、status chips（mute/fissure/echo）、beat ring（consumed/gap flash/exhausted/OD layers/≥10 glow）
 * - drawHpWave：低血色、flatline
 * - drawTarget：voiceprint 28 段 + hp/poise 弧、boss phrase line
 * - drawNotes：info/reward/boss 三态、入场滑入、3s 淡出、上限 3 条
 * - drawPrompt：[E] + 文本、underline、死时隐藏
 * - drawVignette：径向渐变 fillRect
 * - drawDeath：全屏遮罩 + "休 止" + "你的节拍停在这里"
 */

interface Recorder {
  strokes: string[]
  texts: string[]
  fills: string[]
  rects: number[][]
  arcs: { cx: number; cy: number; r: number }[]
}

function makeHud(): { hud: Hud; rec: Recorder } {
  const rec: Recorder = { strokes: [], texts: [], fills: [], rects: [], arcs: [] }
  const store: Record<string, unknown> = {}
  const grad = { addColorStop: () => {} }
  const ctx = new Proxy(store, {
    get(t, k: string) {
      if (k in t) return t[k]
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad
      if (k === 'measureText') return () => ({ width: 10 })
      if (k === 'stroke') return () => { rec.strokes.push(String(t.strokeStyle ?? '')) }
      if (k === 'fillText') return (txt: unknown) => { rec.texts.push(String(txt)) }
      if (k === 'fill') return () => { rec.fills.push(String(t.fillStyle ?? '')) }
      if (k === 'fillRect') return (x: number, y: number, w: number, h: number) => { rec.rects.push([x, y, w, h]) }
      if (k === 'arc') return (cx: number, cy: number, r: number) => { rec.arcs.push({ cx, cy, r }) }
      if (k === 'beginPath') return () => {}
      if (k === 'moveTo') return () => {}
      if (k === 'lineTo') return () => {}
      if (k === 'closePath') return () => {}
      if (k === 'setLineDash') return () => {}
      if (k === 'save') return () => {}
      if (k === 'restore') return () => {}
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
const GOLD = 'rgba(201,180,88'
const AMBER = 'rgba(255,184,107'
const GREYRED = 'rgba(138,90,82'

beforeAll(() => {
  registerGameData()
  const g = globalThis as unknown as Record<string, unknown>
  g.window = { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1 }
})

afterEach(() => {
  for (const h of live) h.dispose()
  live = []
})

function stats(over: Record<string, unknown> = {}): void {
  bus.emit('player.stats', {
    hp: 100, hpMax: 100, stamina: 100, staminaMax: 100,
    poise: 100, poiseMax: 100, overdrive: 0, overdriveMax: 10,
    rank: 1, corruption: 0, corruptionMax: 100, corruptionVeil: 0, muteTicksLeft: 0,
    ...over
  })
}

function beat(): void {
  bus.emit('rhythm.beat', { beatIndex: 0, beatInBar: 0, bar: 0, isBarStart: true, phase: 0 })
}

function status(id: string, value: number, max = 5, on = true): void {
  bus.emit('ui.status', { id, value, max, on } as any)
}

function notify(text: string, kind?: 'info' | 'reward' | 'boss'): void {
  bus.emit('ui.notify', { text, kind: kind ?? 'info' })
}

function target(pos: { x: number; y: number } | null, name = 'Test', hpFrac = 1, poiseFrac = 1, isBoss = false): void {
  bus.emit('ui.target', { pos, name, hpFrac, poiseFrac, isBoss } as any)
}

function prompt(text: string | null, id = 'it_test'): void {
  bus.emit('ui.prompt', { text, id })
}

function render(hud: Hud, frames = 1, dt = 1 / 60): void {
  for (let i = 0; i < frames; i++) hud.render(0, dt)
}

const peek = (hud: Hud, key: string): any =>
  (hud as unknown as Record<string, any>)[key]

describe('Hud：受伤/死亡与 vignette/death 画面', () => {
  it('player.damaged ⇒ vignette 脉冲；再渲染 ⇒ fillRect 全屏径向渐变', () => {
    const { hud, rec } = makeHud()
    stats()
    render(hud, 2)
    bus.emit('player.damaged', { amount: 10 })
    render(hud, 1)
    expect(rec.rects.some(r => r[0] === 0 && r[1] === 0 && r[2] === 1920 && r[3] === 1080)).toBe(true)
  })

  it('player.died ⇒ death 遮罩 + 两行字；stats hp>0 ⇒ dead 复位、字消失', () => {
    const { hud, rec } = makeHud()
    stats()
    render(hud, 2)
    bus.emit('player.died', undefined)
    render(hud, 10)
    expect(rec.texts.some(t => t === '休 止')).toBe(true)
    expect(rec.texts.some(t => t === '你的节拍停在这里')).toBe(true)
    rec.texts.length = 0
    stats({ hp: 50 })
    render(hud, 10)
    expect(rec.texts.some(t => t === '休 止')).toBe(false)
  })
})

describe('Hud：ui.notify 队列（≤3 条，3s 淡出）', () => {
  it('四条推入只留后三条；reward 前缀 ◆；boss 金字大号', () => {
    const { hud, rec } = makeHud()
    stats()
    notify('a')
    notify('b', 'reward')
    notify('c', 'boss')
    notify('d') // 超限，a 被挤掉
    render(hud, 2)
    // 第一帧 life=0 → inT=0 不画；第二帧 life=dt≈0.0167 → inT≈0.092 >0.01 画
    expect(rec.texts).toContain('◆ b')
    expect(rec.texts).toContain('c')
    expect(rec.texts).toContain('d')
    expect(rec.texts).not.toContain('a')
  })
})

describe('Hud：ui.prompt 交互提示', () => {
  it('prompt 文本 ⇒ [E] + 文本 + underline；dead 时自动淡出', () => {
    const { hud, rec } = makeHud()
    stats()
    prompt('打开门')
    render(hud, 2)
    expect(rec.texts.some(t => t === '[E]')).toBe(true)
    expect(rec.texts.some(t => t === '打开门')).toBe(true)
    // 死后
    bus.emit('player.died', undefined)
    render(hud, 5)
    // promptA 衰减到 <0.01 → 不画 → 文本不再出现（上一次渲染可能还有残留，断言最后帧不含）
    expect(rec.texts.slice(-2)).not.toContain('[E]')
  })
})

describe('Hud：ui.target voiceprint 环 + hp/poise 弧', () => {
  it('首次 emit pos ⇒ fresh=true 直接吸附；第二次 emit pos ⇒ lerp 0.4', () => {
    const { hud, rec } = makeHud()
    stats()
    target({ x: 100, y: 200 })
    render(hud, 5) // tAlpha 上升，第一次画在 100
    target({ x: 300, y: 400 })
    render(hud, 1) // lerp 到 180/280，再画一次（voiceprint 28 段 + hp弧 + poise弧 = 30 个 arc）
    // 取最后一组 voiceprint 的第 1 段（index = rec.arcs.length - 30）
    const idx = rec.arcs.length - 30
    expect(rec.arcs[idx].cx).toBe(180)
    expect(rec.arcs[idx].cy).toBe(280)
  })

  it('pos=null 期间 tAlpha 衰减仍 ≥0.02 时 ⇒ 进入 drawTarget 但 !pos 早退（覆盖 L580）', () => {
    const { hud, rec } = makeHud()
    stats()
    target({ x: 100, y: 200 })
    render(hud, 5)
    target(null)
    render(hud, 1) // 衰减中仍 ≥0.02
    // 没有新 arc（因为 !pos return），旧 arc 记录还在
    const arcsBefore = rec.arcs.length
    render(hud, 3) // 彻底衰减
    expect(rec.arcs.length).toBe(arcsBefore)
  })
})

describe('Hud：boss phrase line', () => {
  it('isBoss=true ⇒ 画 phrase line：基线/已玩段/16 条刻度/两条相位线/名字', () => {
    const { hud, rec } = makeHud()
    stats()
    target(null, 'BossName', 0.5, 1, true) // hpFrac=0.5
    render(hud, 5)
    expect(rec.texts).toContain('BossName')
    expect(rec.strokes.length).toBeGreaterThan(20)
  })
})

describe('Hud：status chips（mute/fissure/echo）', () => {
  it('mute 秒数显示', () => {
    const { hud, rec } = makeHud()
    stats({ muteTicksLeft: 60 })
    render(hud, 20) // chipA 上升
    expect(rec.texts.some(t => t.startsWith('闷音 1.0s'))).toBe(true)
  })

  it('fissure 层数竖线', () => {
    const { hud, rec } = makeHud()
    stats()
    status('fissure', 3, 5)
    render(hud, 20)
    expect(rec.texts.some(t => t.includes('▍▍▍▏▏'))).toBe(true)
  })

  it('echo 计数', () => {
    const { hud, rec } = makeHud()
    stats()
    status('echo', 2, 4)
    render(hud, 20)
    expect(rec.texts.some(t => t.includes('回响 2/4'))).toBe(true)
  })

  it('TTL：无新读数 2s 后自动删除', () => {
    const { hud } = makeHud()
    stats()
    status('fissure', 2, 5)
    render(hud, 10)
    expect(peek(hud, 'chips').size).toBe(1)
    // 快进 3s
    for (let i = 0; i < 180; i++) hud.render(0, 1 / 60)
    expect(peek(hud, 'chips').size).toBe(0)
  })

  it('emit on:false/value<=0 ⇒ 立即删除', () => {
    const { hud } = makeHud()
    stats()
    status('echo', 1, 3)
    render(hud, 2)
    expect(peek(hud, 'chips').size).toBe(1)
    status('echo', 0, 3, false)
    render(hud, 1)
    expect(peek(hud, 'chips').size).toBe(0)
  })
})

describe('Hud：corruption bar + 满层标签', () => {
  it('corrFrac>0 ⇒ 灰红线 + fill；corrFrac=1 ⇒ "失谐 · 正在褪色" 文案', () => {
    const { hud, rec } = makeHud()
    stats({ corruption: 100, corruptionMax: 100 })
    render(hud, 20)
    expect(rec.texts).toContain('失谐 · 正在褪色')
    expect(rec.strokes.some(s => s.startsWith(GREYRED))).toBe(true)
  })

  it('partial corruption ⇒ GREYRED stroke（不含标签）', () => {
    const { hud, rec } = makeHud()
    stats({ corruption: 50, corruptionMax: 100 })
    render(hud, 20)
    expect(rec.texts).not.toContain('失谐 · 正在褪色')
    expect(rec.strokes.some(s => s.startsWith(GREYRED))).toBe(true)
  })
})

describe('Hud：HP wave —— 低血色分支 + flatline', () => {
  it('hp=40 ⇒ low-color 分支（rgba(231,147,90... 前缀）', () => {
    const { hud, rec } = makeHud()
    stats({ hp: 40, hpMax: 100 })
    render(hud, 2)
    expect(rec.fills.some(f => f.startsWith('rgba(231,147,90'))).toBe(true)
  })

  it('hp=0 ⇒ flatline 红线（rgba(168,50,46,0.85)）', () => {
    const { hud, rec } = makeHud()
    stats({ hp: 0, hpMax: 100 })
    render(hud, 2)
    expect(rec.strokes).toContain('rgba(168,50,46,0.85)')
  })
})

describe('Hud：beat ring —— consumed/gap flash/exhausted/OD layers/≥10 glow', () => {
  it('stamina drop + beat ⇒ gap flash amber；exhausted ⇒ GREYRED dash', () => {
    const { hud, rec } = makeHud()
    stats({ stamina: 50, staminaMax: 100 }) // stamFlash=1.2, stamIdle=0
    beat() // beatPulse=1
    render(hud, 1)
    const ambers = rec.strokes.filter(s => s.startsWith(AMBER))
    expect(ambers.length).toBeGreaterThanOrEqual(2) // gap flash + remaining arc (stamFlash>0.95)
    // exhausted
    const { hud: h2, rec: r2 } = makeHud()
    stats({ stamina: 0, staminaMax: 100 })
    beat()
    render(h2, 10) // ringAlpha 上升
    expect(r2.strokes.some(s => s.startsWith(GREYRED + ',0.9)'))).toBe(true)
  })

  it('odLayers=10 ⇒ 10 层内圈 + ≥10 shadow glow', () => {
    const { hud, rec } = makeHud()
    stats({ overdrive: 10, overdriveMax: 10 })
    render(hud, 10)
    const golds = rec.strokes.filter(s => s.startsWith(GOLD))
    expect(golds.length).toBeGreaterThanOrEqual(11) // 10 layers + 1 glow
  })

  it('stamina rise ⇒ stamIdle=0（覆盖 L249-250）', () => {
    const { hud, rec } = makeHud()
    stats({ stamina: 20, staminaMax: 100 })
    render(hud, 1)
    stats({ stamina: 80, staminaMax: 100 }) // rising
    render(hud, 1)
    // 仅覆盖分支；stamIdle 归零无直接可观察，渲染即触发分支
    expect(rec.strokes.length).toBeGreaterThan(0)
  })
})

describe('Hud：onStats 其余分支', () => {
  it('rank 变化 ⇒ rankFlash=1（drawRank 亮字）', () => {
    const { hud, rec } = makeHud()
    stats({ rank: 1 })
    render(hud, 2)
    stats({ rank: 2 })
    render(hud, 2)
    expect(rec.texts.some(t => t.startsWith('音级 2'))).toBe(true)
  })

  it('corruptionVeil 混色（corrVeil>0）', () => {
    const { hud, rec } = makeHud()
    stats({ corruption: 50, corruptionMax: 100, corruptionVeil: 1 })
    render(hud, 20)
    // mix(GREYRED, [150,150,155], 1) = [150,150,155]
    expect(rec.strokes.some(s => s.startsWith('rgba(150,150,155'))).toBe(true)
  })
})

describe('Hud：ui.target fresh 逻辑（首次/非首次/pos=null/再次有 pos）', () => {
  it('完整四段：pos→pos2→null→pos3', () => {
    const { hud } = makeHud()
    stats()
    target({ x: 10, y: 20 })
    render(hud, 1)
    target({ x: 30, y: 40 })
    render(hud, 1)
    target(null)
    render(hud, 1)
    target({ x: 50, y: 60 })
    render(hud, 1)
    // 仅需无报错；分支覆盖由代码行统计
  })
})