/** admin/data.js 的类型声明（生成物的手工描述；scripts/gen-analytics.mjs 产物与此同形） */

export interface TelemetryRef { labelZh: string; labelEn: string; detail: string }
export interface TelemetryMeta {
  schema: number
  generatedAt: string
  seed: number
  days: number
  startDate: string
  endDate: string
  cohortKind: string
  noteZh: string
  noteEn: string
  refs: TelemetryRef[]
  disclaimerZh: string
  disclaimerEn: string
}
export interface TelemetryDay {
  date: string
  sessions: number
  newUsers: number
  bounce: number
  avgDurationSec: number
  pageViews: number
  endings: number
  marks: number
  storyFinishes: number
}
export interface TelemetryFunnelStep { id: string; labelZh: string; labelEn: string; count: number }
export interface TelemetryTotals {
  sessions: number
  newUsers: number
  returning: number
  endings: number
  pageViews: number
  marks: number
  storyFinishes: number
}
export interface TelemetryChannel {
  id: string
  labelZh: string
  labelEn: string
  share: number
  endingRate: number
  sessions: number
}
export interface TelemetryDevice {
  id: string
  labelZh: string
  labelEn: string
  share: number
  endingRate: number
  avgDurationSec: number
}
export interface TelemetryLocale { id: string; labelZh: string; labelEn: string; share: number }
export interface TelemetryHour { h: number; share: number }
export interface TelemetryCohort {
  id: string
  labelZh: string
  labelEn: string
  size: number
  d1: number
  d3: number
  d7: number | null
  d14: number | null
  d30: number | null
}
export interface TelemetryPage {
  path: string
  labelZh: string
  labelEn: string
  views: number
  avgTimeSec: number
  bounce: number
  exitShare: number
  rageClicks: number
}
export interface Telemetry {
  meta: TelemetryMeta
  daily: TelemetryDay[]
  totals: TelemetryTotals
  funnel: { steps: TelemetryFunnelStep[] }
  channels: TelemetryChannel[]
  devices: TelemetryDevice[]
  locales: TelemetryLocale[]
  hourly: TelemetryHour[]
  cohorts: TelemetryCohort[]
  pages: TelemetryPage[]
}

export const TELEMETRY: Telemetry
