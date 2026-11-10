/** `scripts/spring-gateway-gray.mjs` 的声明：网关灰度/金丝雀加权路由决策器（KI-491）。 */

export interface GrayDefaults {
  readonly stickyHeader: string
  readonly grayField: string
  readonly weightField: string
  readonly salt: string
  readonly canaryPercent: number
}

export const GRAY_DEFAULTS: GrayDefaults

export type GraySelector = (ctx: { key: string; salt?: string }) => number

export function hashSelector(salt?: string): GraySelector

export interface GrayRouterOptions {
  stickyHeader?: string
  grayField?: string
  /** 金丝雀精确值匹配（如 version='v2'）；不给则取 metadata[grayField] 的 truthy 作旗标。 */
  canaryValue?: string | number | boolean
  weightField?: string
  salt?: string
  canaryPercent?: number
  selector?: GraySelector
  rand?: () => number
}

export interface GrayDecision {
  key: string
  bucket: number
  wantCanary: boolean
  canaryPercent: number
}

export interface GraySplit {
  primary: any[]
  canary: any[]
}

export interface GrayPicked {
  ok: boolean
  lane: 'canary' | 'primary' | null
  fallback: boolean
  instance: any
  reason?: string
}

export interface GrayRouted extends GrayPicked {
  decision: GrayDecision
}

export interface GrayStats {
  decisions: number
  canary: number
  primary: number
  fallback: number
  noInstance: number
  droppedUnhealthy: number
}

export interface GrayRouter {
  stickyHeader: string
  grayField: string
  canaryValue: string | number | boolean | undefined
  weightField: string
  salt: string
  canaryPercent: number
  decide(req?: { path?: string; method?: string; headers?: Record<string, unknown>; canaryPercent?: number }): GrayDecision
  split(instances: any[]): GraySplit
  weightedPick(pool: any[]): any | null
  select(instances: any[], decision: GrayDecision): GrayPicked
  route(req: any, instances: any[]): GrayRouted
  stats(): GrayStats
  reset(): void
}

export function createGrayRouter(opts?: GrayRouterOptions): GrayRouter
