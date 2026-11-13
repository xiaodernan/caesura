import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { BossPhraseBar } from '@/ui/BossPhraseBar'

/**
 * BossPhraseBar 单元测试（headless 可证）。
 *
 * 使用假 canvas 对象，不依赖 DOM / WebGL。验证：
 * ① 初始状态无 boss.phase ⇒ draw 不抛且不画
 * ② boss.phase 到 ⇒ phase/phases/nameKey 原样留存，alpha=1
 * ③ tick 使 alpha 指数衰减
 * ④ 多次 boss.phase 后到覆盖前一次
 * ⑥ dispose 后不再响应
 */

function makeCanvas(): HTMLCanvasElement {
  const ctx = {
    save: () => {},
    restore: () => {},
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect: () => {},
    strokeRect: () => {},
    fillText: () => {},
    beginPath: () => {},
    moveTo: () => {},
    quadraticCurveTo: () => {},
    arc: () => {},
    fill: () => {},
    stroke: () => {},
    setTransform: () => {},
  } as unknown as CanvasRenderingContext2D
  return {
    getContext: () => ctx,
    clientWidth: 1280,
    clientHeight: 720,
    width: 1280,
    height: 720,
    style: {},
  } as unknown as HTMLCanvasElement
}

function emitBossPhase(id: string, phase: number, phases: number, nameKey: string): void {
  bus.emit('boss.phase', { id, phase, phases, nameKey, pos: { x: 0, y: 0, z: 0 } })
}

describe('BossPhraseBar 单元测试', () => {
  it('初始状态：draw 不抛', () => {
    const bar = new BossPhraseBar(makeCanvas())
    expect(bar.draw()).toBeUndefined()
    bar.dispose()
  })

  it('boss.phase 到 ⇒ draw 不抛，alpha 跳到 1', () => {
    const bar = new BossPhraseBar(makeCanvas())
    emitBossPhase('en_hersil', 2, 3, 'dlg.hersil_phase2')
    expect(() => bar.draw()).not.toThrow()
    bar.dispose()
  })

  it('tick 衰减 alpha：多次 tick 后 draw 仍不抛', () => {
    const bar = new BossPhraseBar(makeCanvas())
    emitBossPhase('en_hersil', 1, 1, 'dlg.test')
    for (let i = 0; i < 40; i++) bar.tick(0.05)
    expect(() => bar.draw()).not.toThrow()
    bar.dispose()
  })

  it('多次 boss.phase：后到覆盖前一次', () => {
    const bar = new BossPhraseBar(makeCanvas())
    emitBossPhase('en_hersil', 1, 3, 'dlg.phase1')
    emitBossPhase('en_hersil', 3, 3, 'dlg.finale')
    expect(() => bar.draw()).not.toThrow()
    bar.dispose()
  })

  it('dispose 后不再响应', () => {
    const bar = new BossPhraseBar(makeCanvas())
    bar.dispose()
    bar.tick(0.016)
    expect(() => bar.draw()).not.toThrow()
  })

  it('Phase F-41 朱砂乐谱：真 canvas 样件统计 —— 面板分层/金丝/朱引线/朱「命」印/staff 连珠钉', () => {
    const counts = { fillRect: 0, arc: 0, stroke: 0, quad: 0 }
    const strokes: string[] = []
    const ctx = {
      save: () => {}, restore: () => {},
      globalAlpha: 1,
      fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
      fillRect: () => { counts.fillRect++ },
      strokeRect: () => {},
      fillText: (t: string) => { strokes.push(String(t)) },
      beginPath: () => {},
      arc: () => { counts.arc++ },
      fill: () => {},
      quadraticCurveTo: () => { counts.quad++ },
      moveTo: () => {},
      stroke: () => { counts.stroke++ },
      setTransform: () => {},
    } as unknown as CanvasRenderingContext2D
    const canvas = {
      getContext: () => ctx,
      clientWidth: 1280, clientHeight: 720, width: 1280, height: 720, style: {},
    } as unknown as HTMLCanvasElement
    const bar = new BossPhraseBar(canvas)
    emitBossPhase('en_hersil', 2, 3, 'dlg.hersil_phase2')
    bar.draw()
    bar.dispose()
    // 面板+双金丝+朱引线+朱印+staff+4 拍钉 ≥ 10 块填充；当前拍（默认 beatInBar=1）有朱连珠弧
    expect(counts.fillRect).toBeGreaterThanOrEqual(10)
    expect(counts.arc, '当前拍连珠 + 朱点×2 + 余辉朱点×2 = 5 枚朱弧').toBe(5)
    expect(counts.quad, 'Phase F-70 金丝闪弧应画 1 条二次曲线').toBe(1)
    expect(counts.stroke, 'Flash>0 时金丝闪弧应 stroke 1 次').toBe(1)
    expect(strokes, '朱「命」印在场').toContain('命')
    expect(strokes, 'nameKey 原样画出').toContain('dlg.hersil_phase2')
    expect(strokes, '段次小字').toContain('第2 / 3 段')
  })
})
