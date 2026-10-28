import type { DebugPanelSpec } from './DebugPanel'
import type { PerfSnapshot } from '@/core/PerfSampler'

/**
 * F5 · 性能面板（技术架构 §5.7 那一格：`PerfPanel` 此前**不存在**，F 键也没绑）。
 *
 * 与 F1/F3/F4 同一套规矩：本文件**不认识任何引擎实例**——它只认"哪一格是哪个读数"这一堆**结构**，
 * 实例由组合根（`main.ts`）交进来。于是文本装配在 node 里直接可测，而 `tools/` 不 import three
 * （§5.8 的依赖闸门守着：`renderer.info` 那一坨到这里已经是一堆 plain number）。
 *
 * **装配住在这里而不是住在组合根**（`perfPanelSpec`）：这一格的读数一行都不许长在 `main.ts` 里——
 * 组合根是零覆盖那一格（`scripts/coverage-floor.json` 的 `zeroFiles`），而覆盖率棘轮「可以涨，
 * 不可以跌」：分母 14,480 行，`(root)` 每多一行没人执行过的代码就把总覆盖往下拽约 0.0065 个
 * 百分点，而门读的是两位小数（`coverage.mjs` 向下取整）——本批落盘的那一格是 KI-335 那 34 行
 * 从根上搬过来之后 `--bless` 出的 **94.89**，所以**下一行长在根上的代码就红**（13741/14481 ＝
 * 94.8898 → 94.88 ＜ 地板）。KI-330 当年为 1 行长在根上的代码删了 3 行死代码，就是这个量级。
 * 把"读数怎么摆"搬进被测模块因此不是洁癖：它是**这一格能不能落地**的那笔账。
 *
 * **键**：§5.7 原文写的是「F 键」，而 `KeyF` 从 Phase 1 起就是**格挡**（`core/Input.ts > BINDS`，
 * 那一个字母在玩法里已有主人）。面板这一族历来是功能键（F2 战斗／F1 敌人／F3 任务／F4 AI
 * ⇒ 本块接 **F5**），既满足「一个 F 键」这句原话，也不去抢玩法键。这一格裁决记在账本 KI-335。
 */
export interface PoolRow {
  name: string
  live: number
  free: number
  peak: number
  cap: number
  hits: number
  misses: number
}

export interface GpuRow {
  calls: number
  triangles: number
  geometries: number
  textures: number
}

export interface StreamingRow {
  active: number
  resident: number
  preloading: number
  unloaded: number
  /** 窗口内、还没轮到加载的那一截（`queued` 与 `inFlight` 是两个数：配额管的是后者） */
  queued: number
  /** 同时在飞的加载数（§5.5 的配额读的是这一格 vs `maxInFlight`） */
  inFlight: number
  maxInFlight: number
}

export interface PerfSource {
  perf: PerfSnapshot
  pools: PoolRow[]
  streaming: StreamingRow
  gpu: GpuRow
  /** `GameLoop.maxTicksPerFrame`：每帧最多补几拍（§5.5 的 catch-up 上限，主人是那个字段） */
  maxTicksPerFrame: number
  /** 帧样本窗口（`core/PerfSampler > FRAME_WINDOW`）。与 `budget` 同一条理由：常数不许有两个主人 */
  frameWindow: number
  /** §5.3 的帧预算两格，由组合根从 `core/PerfSampler` 的那两个常数递过来（常数不许有两个主人） */
  budget: { cpuMs: number; gpuMs: number }
}

/** 面板的刻度盘：那两个常数由组合根从 `core/PerfSampler` 原样递过来，这里不留第二份 */
export type PerfCalibration = Pick<PerfSource, 'frameWindow' | 'budget'>

/**
 * F5 读的那四件东西，全部写成**结构**而不是类型：`tools/` 因此既不 import `vfx`／`world`／`core`
 * 的运行时，也不认识 `Renderer`／`StreamingManager` 这些名字（§5.8 的方向规矩，与
 * `world/HitboxWire` 只认 `pos`/`yaw`/`activeHitbox.box` 同一只手）。
 * 每一格都只写面板真要读的那几个字段——多写一格就是多要一个主人。
 */
export interface PerfEngines {
  /** 全库唯一那个池（§5.1 对账的原话）：`vfx/VfxLayer > emitterPoolStats` */
  vfx: { emitterPoolStats: Omit<PoolRow, 'name'> }
  streaming: {
    stats(): Omit<StreamingRow, 'maxInFlight'>
    options: { maxInFlight: number }
  }
  renderer: {
    info: { render: { calls: number; triangles: number }; memory: { geometries: number; textures: number } }
  }
  loop: { maxTicksPerFrame: number }
}

/** 采样器在面板这一侧的样子：三个动作，不认识 F5 也不认识 DOM */
export interface PerfSamplerLike {
  snapshot(): PerfSnapshot
  open(): void
  close(): void
}

const ms = (v: number): string => v.toFixed(2).padStart(6)
const int = (v: number): string => Math.round(v).toLocaleString('en-US')

/** 一行分位数：窗口没满时把 n 一起写出来——"P99 ＝ 33.9"在 n ＝ 12 的窗口里是没有那句话 */
function percentileLine(label: string, p50: number, p90: number | null, p99: number, max: number | null, over?: number): string {
  const parts = [`P50 ${ms(p50)}`, ...(p90 !== null ? [`P90 ${ms(p90)}`] : []), `P99 ${ms(p99)}`, ...(max !== null ? [`max ${ms(max)}`] : [])]
  const verdict = over === undefined ? '' : p99 > over ? `  OVER ${ms(over)}` : `  ≤ ${ms(over)}`
  return `${label.padEnd(10)} ${parts.join(' ')}${verdict}`
}

export function perfPanelText(src: PerfSource): string {
  const s = src.perf
  const partial = s.samples < src.frameWindow ? `  [窗口未满：分位数读的是这 ${s.samples} 帧]` : ''
  const head = `frames ${int(s.frames)} · 窗口 ${s.samples}/${src.frameWindow} · fps ${s.fps.toFixed(1).padStart(5)}${partial}`
  const lines: string[] = [
    head,
    percentileLine('frame ms', s.frameMs.p50, s.frameMs.p90, s.frameMs.p99, s.frameMs.max),
    percentileLine('logic ms', s.logicMs.p50, null, s.logicMs.p99, null, src.budget.cpuMs),
    percentileLine('render ms', s.renderMs.p50, null, s.renderMs.p99, null, src.budget.gpuMs),
    `ticks/frame avg ${s.ticksPerFrame.avg.toFixed(2)} max ${s.ticksPerFrame.max} (cap ${src.maxTicksPerFrame}) · 丢整拍 ${s.truncated}`,
  ]
  lines.push('—— spans (EMA ms · calls/frame · max) ——')
  if (!s.spans.length) lines.push('  (还没有样本：面板开着至少要跑一帧)')
  for (const sp of s.spans) {
    lines.push(`  ${sp.name.padEnd(20)} ${ms(sp.avgMs)} x${sp.callsPerWindow.toFixed(2).padStart(5)} ${ms(sp.maxMs)}`)
  }
  lines.push('—— pools ——')
  for (const p of src.pools) {
    const total = p.hits + p.misses
    const rate = total === 0 ? '—' : `${((p.hits / total) * 100).toFixed(1)}%`
    lines.push(
      `  ${p.name.padEnd(14)} live ${String(p.live).padStart(4)}/${p.cap} free ${String(p.free).padStart(4)} ` +
      `peak ${String(p.peak).padStart(4)} reuse ${p.hits}/${total} (${rate})`,
    )
  }
  const st = src.streaming
  lines.push(
    `—— streaming (active ${st.active} resident ${st.resident} preload ${st.preloading} ` +
    `queued ${st.queued} in-flight ${st.inFlight}/${st.maxInFlight} unloaded ${st.unloaded})`,
  )
  lines.push('—— renderer.info ——')
  lines.push(`  calls ${int(src.gpu.calls)}  tris ${int(src.gpu.triangles)}  geom ${int(src.gpu.geometries)}  tex ${int(src.gpu.textures)}`)
  return lines.join('\n')
}

/**
 * F5 那一格的面板规格：键、标题、停靠位、开关联动，以及"每一行的数从哪一格来"。
 *
 * 组合根因此只写一行接线（`new DebugPanel(perfPanelSpec(perf, { vfx, streaming, renderer, loop }, calib))`），
 * 而这些行——每格读数的对应关系——全部落在**被测**的那一侧：把 `spec.text()` 交给一组结构替身，
 * 就能问"池那一行的数是不是池自己的账"「流送那一行分不分得清 queued 与 in-flight」这类问题，
 * 而这些问题住在 `main.ts` 里时没有任何机器能问（组合根零覆盖，见文件头那笔账）。
 */
export function perfPanelSpec(sampler: PerfSamplerLike, engines: PerfEngines, calibration: PerfCalibration): DebugPanelSpec {
  return {
    key: 'F5',
    label: 'perf：帧时间分位 / 分段耗时 / 池 / 流送 / drawcall',
    anchor: 'position:fixed;right:12px;bottom:12px',
    // 这一块面板与其它三块的唯一结构差别：关着要连计时一起停（`PerfSampler.armed` 是第二道闸门）
    onToggle: (on) => (on ? sampler.open() : sampler.close()),
    text: () => perfPanelText({
      ...calibration,
      perf: sampler.snapshot(),
      pools: [{ name: 'vfx.emitter', ...engines.vfx.emitterPoolStats }],
      streaming: { ...engines.streaming.stats(), maxInFlight: engines.streaming.options.maxInFlight },
      gpu: {
        calls: engines.renderer.info.render.calls,
        triangles: engines.renderer.info.render.triangles,
        geometries: engines.renderer.info.memory.geometries,
        textures: engines.renderer.info.memory.textures,
      },
      maxTicksPerFrame: engines.loop.maxTicksPerFrame,
    }),
  }
}
