/** admin/analytics.mjs 的类型声明（tsc 不核 .mjs；兄弟 .d.mts 供 TS 消费者） */

export interface RegressionResult { slope: number; intercept: number; r2: number }
export interface ForecastResult { points: number[]; slope: number; r2: number }
export interface Anomaly { index: number; value: number; z: number; direction: 'up' | 'down' }
export interface FunnelStepLike { count: number }
export interface Recommendation {
  id: string
  priority: 'P0' | 'P1' | 'P2'
  metric: string
  current: number
  threshold: number
  titleZh: string
  titleEn: string
  actionZh: string
  actionEn: string
}

export function mulberry32(seed: number): () => number
export function mean(xs: number[]): number
export function std(xs: number[]): number
export function movingAverage(xs: number[], window: number): number[]
export function linearRegression(xs: number[], ys: number[]): RegressionResult
export function forecast(series: number[], opts?: { lookback?: number; horizon?: number }): ForecastResult
export function anomalies(series: number[], threshold?: number): Anomaly[]
export function funnelRates(steps: FunnelStepLike[]): { stepRates: number[]; overall: number }
export function pct(x: number, digits?: number): string
export function num(x: number): string
export function dur(seconds: number): string
export function deriveRecommendations(data: unknown): Recommendation[]
