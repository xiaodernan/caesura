import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { BossPhraseBar } from '@/ui/BossPhraseBar'

/**
 * Phase 7 F3｜Boss 乐句线 HUD 测试。
 *
 * headless 可证：BossPhraseBar 只读 canvas-2D，订阅总线事件，不认识 PlayerController、
 * AISystem、CombatManager。测试通过合成 `boss.phase` 与 `rhythm.beat` 事件，验证
 * 相位读数、拍位读数、alpha 衰减三条腿。
 *
 * 不测 DOM 像素（无 WebGL / 无浏览器布局），只测状态机与边界。
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
    arc: () => {},
    fill: () => {},
    moveTo: () => {},
    quadraticCurveTo: () => {},
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

function emitRhythmBeat(beatInBar: number, bar: number): void {
  bus.emit('rhythm.beat', { beatIndex: (bar - 1) * 4 + (beatInBar - 1), beatInBar, bar, isBarStart: beatInBar === 1, phase: 0 })
}

describe('KI-429/F3｜BossPhraseBar：乐句线 HUD 状态机与边界', () => {
  it('初始状态：无 boss.phase ⇒ 相位为 null，draw 不抛', () => {
    const canvas = makeCanvas()
    const bar = new BossPhraseBar(canvas)
    expect(bar.draw()).toBeUndefined()
    bar.dispose()
  })

  it('boss.phase 到 ⇒ phase/phases/nameKey 原样留存，alpha 跳到 1', () => {
    const canvas = makeCanvas()
    const bar = new BossPhraseBar(canvas)
    emitBossPhase('en_hersil', 2, 3, 'dlg.hersil_phase2')
    bar.tick(0)
    expect(() => bar.draw()).not.toThrow()
    bar.dispose()
  })

  it('rhythm.beat 到 ⇒ beatInBar 原样留存', () => {
    const canvas = makeCanvas()
    const bar = new BossPhraseBar(canvas)
    emitRhythmBeat(3, 2)
    emitBossPhase('en_hersil', 1, 4, 'dlg.hersil_phase1')
    bar.tick(0)
    expect(() => bar.draw()).not.toThrow()
    bar.dispose()
  })

  it('tick 使 alpha 指数衰减：2 秒后趋近 0，draw 提前返回', () => {
    const canvas = makeCanvas()
    const bar = new BossPhraseBar(canvas)
    emitBossPhase('en_hersil', 1, 1, 'dlg.test')
    bar.tick(0)
    expect(() => bar.draw()).not.toThrow()
    for (let i = 0; i < 40; i++) bar.tick(0.05)
    bar.dispose()
  })

  it('多次 boss.phase：后到的覆盖前一次（不是累加）', () => {
    const canvas = makeCanvas()
    const bar = new BossPhraseBar(canvas)
    emitBossPhase('en_hersil', 1, 3, 'dlg.phase1')
    emitBossPhase('en_hersil', 3, 3, 'dlg.finale')
    bar.tick(0)
    expect(() => bar.draw()).not.toThrow()
    bar.dispose()
  })

  it('无 boss.phase 时多次 tick/draw 都不抛（空闲状态安全）', () => {
    const canvas = makeCanvas()
    const bar = new BossPhraseBar(canvas)
    for (let i = 0; i < 100; i++) {
      bar.tick(0.016)
      expect(() => bar.draw()).not.toThrow()
    }
    bar.dispose()
  })

  it('dispose 后不再响应事件', () => {
    const canvas = makeCanvas()
    const bar = new BossPhraseBar(canvas)
    bar.dispose()
    bar.tick(0.016)
    expect(() => bar.draw()).not.toThrow()
  })
})
