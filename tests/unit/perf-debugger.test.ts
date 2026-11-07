import { describe, expect, it } from 'vitest'
import { perfPanelText, type PerfSource } from '@/tools/PerfDebugger'
import type { PoolRow, StreamingRow, GpuRow, FrameAccount } from '@/tools/PerfDebugger'

/**
 * `src/tools/PerfDebugger.ts`：F5 性能面板的纯文本渲染（headless 可测——不 import three/DOM/renderer）。
 *
 * 组合根只留一行接线，而这些行——每格读数的对应关系——全落在**被测**那一侧：
 * 把 `spec.text()` 交给结构替身，就能问「池那一行的数是不是池自己的账」这类问题。
 */

const frame: FrameAccount = {
  rejectedDeltas: 2,
  lastRejectedDelta: 42, // 被吃掉的最后那一帧 delta（可正常打印，不该炸）
  renderFaults: 1,
  lastRenderFault: 'TypeError: undefined',
  logicFaults: 0,
  lastLogicFault: null,
}

const pools: PoolRow[] = [
  { name: 'emitter', live: 12, cap: 64, free: 52, peak: 40, hits: 1000, misses: 5 },
]

const streaming: StreamingRow = {
  active: 3, resident: 5, preloading: 1, queued: 2, inFlight: 1, maxInFlight: 4, unloaded: 12,
}

const gpu: GpuRow = { calls: 42, triangles: 12345, geometries: 33, textures: 7 }

const source = (over: Partial<PerfSource> = {}): PerfSource => ({
  perf: {
    samples: 300,
    frames: 12345,
    fps: 59.9,
    frameMs: { p50: 16.7, p90: 20.1, p99: 25.3, max: 40.2 },
    logicMs: { p50: 2.1, p99: 5.6 },
    renderMs: { p50: 8.9, p99: 15.3 },
    ticksPerFrame: { avg: 1.0, max: 5 },
    truncated: 0,
    spans: [
      { name: 'ai', avgMs: 0.12, callsPerWindow: 1.0, maxMs: 0.4 },
      { name: 'combat', avgMs: 0.35, callsPerWindow: 1.0, maxMs: 1.2 },
    ],
  },
  pools,
  streaming,
  gpu,
  maxTicksPerFrame: 5,
  frame,
  frameWindow: 300,
  budget: { cpuMs: 16.6, gpuMs: 33.3 },
  ...over,
})

describe('perfPanelText：每行读数从哪一格来', () => {
  const text = perfPanelText(source())

  it('frames / 窗口 / fps 那一行在首行，含 frameWindow', () => {
    expect(text).toContain('frames 12,345')
    expect(text).toContain('窗口 300/300')
    expect(text).toContain('fps')
  })

  it('逻辑 ms 那行：p99 ≤ cpuMs ⇒ 显示预算 ≤ 号', () => {
    expect(text).toContain('logic ms')
    expect(text).toContain('≤')
  })

  it('spans 那行按 name 现写，带 EMA ms 与 calls', () => {
    expect(text).toContain('ai')
    expect(text).toContain('combat')
  })

  it('池那行：hits/misses 合计、命中率、peak/live/cap', () => {
    expect(text).toContain('emitter')
    expect(text).toContain('live   12/64')
    expect(text).toContain('1000/1005')
    expect(text).toContain('99.5%')
  })

  it('流送那行：queued 与 in-flight 分得清', () => {
    expect(text).toContain('queued 2')
    expect(text).toContain('in-flight 1/4')
  })

  it('渲染 faults 那行：>0 时带明细，0 时只写 0', () => {
    expect(text).toContain('渲染抛出 1：TypeError: undefined')
    expect(text).toContain('逻辑抛出 0')
  })

  it('窗口未满时 head 行带提示', () => {
    const partial = perfPanelText(source({ perf: { ...source().perf, samples: 12 } }))
    expect(partial).toContain('窗口未满：分位数读的是这 12 帧')
  })

  it('spans 为空 ⇒ 提示“还没有样本”', () => {
    const noSpans = perfPanelText(source({ perf: { ...source().perf, spans: [] } }))
    expect(noSpans).toContain('还没有样本')
  })

  it('全字段展开 ⇔ 确实没有 NaN 漏进文本', () => {
    expect(text).not.toContain('NaN')
    expect(perfPanelText(source()).split('\n').length).toBeGreaterThan(5)
  })
})
