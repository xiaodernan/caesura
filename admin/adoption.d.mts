/** admin/adoption.mjs 的类型声明（tsc 不核 .mjs；兄弟 .d.mts 供 TS 消费者） */

export interface TelemetryEventLike {
  type?: unknown
  t?: unknown
  dep?: unknown
  region?: unknown
  q?: unknown
  path?: unknown
}

export interface FloorCount { dep: number; count: number }
export interface RegionCount { region: string; count: number }

export interface AdoptionReading {
  sample: number
  windowed: boolean
  capacity: number
  confident: boolean
  opens: number
  acts: number
  descents: number
  deepest: number
  floors: FloorCount[]
  echoes: { total: number; regions: RegionCount[] }
  pageviews: number
  opensPerView: number | null
  firstAt: number | null
  lastAt: number | null
}

export const TELEMETRY_CAPACITY: number
export const MIN_SAMPLE: number

export function adoption(events: unknown, opts?: { capacity?: number; minSample?: number }): AdoptionReading
export function pctOrDash(rate: number | null | undefined): string
