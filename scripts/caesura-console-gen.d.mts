/** `scripts/caesura-console-gen.mjs` 的声明：前端集大成控制台真 E2E 数据生成器（P8 / KI-495）。 */

export const SCENARIO_IDS: string[]
export const SCENARIO_TITLES: Record<string, string>

export interface ConsoleHighlights {
  services: number | null
  spanCount: number | null
  canaryHits: number | null
  cacheHitRate: number | null
  timedOut: number | null
  cwnd: number | null
  rto: number | null
}

export interface ConsoleScenario {
  id: string
  title: string
  ok: boolean
  [k: string]: any
}

export interface LsmReading {
  keys: number
  flushes: number
  compactions: number
  mergedAway: number
  tombstonesDropped: number
  bloomRejects: number
  comparisons: number
  scanBaselineComparisons: number
  speedup: number | null
  levels: Array<{ level: number; segments: number; entries: number }>
}

export interface HwReading {
  allocation: { accesses: number; naiveCreated: number; poolCreated: number; saved: number; reuseRate: number | null }
  cacheLine: { paddedFalseSharing: number; packedFalseSharing: number; paddingOverhead: number | null }
  layout: {
    sequential: { aosMisses: number; soaMisses: number; speedup: number | null }
    strided: { stride: number; aosMisses: number; soaMisses: number; speedup: number | null }
  }
}

/** KI-501：与 LSM/HW 并列的第三维「缓存防护」读数（击穿/穿透/雪崩三件套结构计数）。 */
export interface GuardsReading {
  stampede: {
    concurrency: number
    naiveLoads: number
    singleflightLoads: number
    savedLoads: number
    amplification: number | null
    xfetchAvoidedMisses: number
  }
  penetration: {
    absent: number
    rounds: number
    naiveDbHits: number
    negativeDbHits: number
    bloomDbHits: number
    bloomRejected: number
    bloomFalsePositives: number | null
    bloomSavedRate: number | null
  }
  avalanche: {
    keys: number
    buckets: number
    uniformPeak: number
    jitterPeak: number
    peakReduction: number | null
    uniformBuckets: number
    jitterBuckets: number
    histogram: { uniform: number[]; jitter: number[] }
  }
}

/** KI-498 + KI-501：与五场景并列的独立「系统读数」数据块（LSM + OS/硬件 + 缓存防护）。 */
export interface SystemsBlock {
  lsm: LsmReading | null
  hw: HwReading | null
  guards: GuardsReading | null
  builtAt: number
}

export interface ConsoleSnapshot {
  schema: number
  generatedAt: number
  generator: string
  scenarios: ConsoleScenario[]
  highlights: ConsoleHighlights
  /** KI-498：可空；`systems:false` 生成时为 null，缺块时 lsm/hw 各自为 null。 */
  systems: SystemsBlock | null
}

export interface E2ERunner {
  run(): Promise<any>
  gc?: any
}

export function buildSnapshot(opts?: {
  runner?: (scenarioId: string) => E2ERunner
  now?: () => number
  driveNet?: boolean
  /** KI-498：false 关掉 systems 块（兼容旧快照/确定性单测）；缺省真跑三维系统读数。 */
  systems?: boolean
  lsmKeys?: number
  poolAccesses?: number
  layoutCount?: number
  /** KI-501：false 关掉缓存防护维（兼容旧快照）；guardConcurrency/guardKeys 注入规模。 */
  guards?: boolean
  guardConcurrency?: number
  guardKeys?: number
}): Promise<ConsoleSnapshot>

/** KI-498 + KI-501：真跑 LSM + OS/硬件 + 缓存防护三维系统读数；击穿对照真跑并发 ⇒ async。 */
export function buildSystems(opts?: {
  now?: () => number
  lsmKeys?: number
  poolAccesses?: number
  layoutCount?: number
  guards?: boolean
  guardConcurrency?: number
  guardKeys?: number
}): Promise<SystemsBlock>

/** KI-501：真跑缓存防护三件套（击穿/穿透/雪崩）收敛成前端三面板紧凑读数；单维失败落 null。 */
export function buildGuardsReading(opts: {
  now?: () => number
  guards?: boolean
  guardConcurrency?: number
  guardKeys?: number
}, now: () => number): Promise<GuardsReading | null>

export function realScenarioOpts(id: string): Record<string, any>

export function normalizeScenario(id: string, gc: any, r: any): ConsoleScenario

export function driveNetSeries(net: any): any | null

export function cwndSeries(history: any): Array<{ step: number; cwnd: number | null; event: string | null; mode: string | null }>

export function deriveHighlights(scenarios: ConsoleScenario[]): ConsoleHighlights
