/** `scripts/caesura-net-stack.d.mts` 的声明：计网协议栈教学件（P8 / KI-494）。 */

/* ① Reno AIMD */
export interface AimdState {
  cwnd: number
  ssthresh: number
  mode: 'slow-start' | 'congestion-avoidance'
  dupAcks: number
  history: Array<{ event: string; cwnd: number; ssthresh: number; mode: string; dupAcks?: number }>
}
export interface AimdCongestion {
  onAck(): number
  onDupAck(): { fastRetransmit: boolean; cwnd: number; ssthresh: number; dupAcks?: number }
  onTimeout(): { cwnd: number; ssthresh: number }
  state(): AimdState
  readonly cwnd: number
  readonly ssthresh: number
  readonly mode: string
}
export function createAimdCongestion(opts?: {
  initialCwnd?: number
  ssthresh?: number
  minCwnd?: number
  dupAckThreshold?: number
}): AimdCongestion

/* ② CUBIC */
export interface CubicState {
  cwnd: number
  Wmax: number
  K: number
  C: number
  beta: number
  epochStart: number
  elapsed: number
}
export interface CubicCongestion {
  onAck(): number
  onCongestion(): { cwnd: number; Wmax: number; K: number; epochStart: number }
  targetAt(tSec: number): number
  state(): CubicState
  readonly cwnd: number
  readonly Wmax: number
  readonly K: number
}
export function createCubicCongestion(opts?: {
  Wmax?: number
  C?: number
  beta?: number
  initialCwnd?: number
  now?: () => number
}): CubicCongestion

/* ③ RTO 估计 */
export interface RtoState {
  srtt: number | null
  rttvar: number | null
  rto: number
  timeouts: number
  ignoredSamples: number
  minRto: number
  maxRto: number
}
export interface RtoEstimator {
  sample(rttMs: number, retransmitted?: boolean): { used: boolean; ignored: boolean; srtt: number | null; rttvar: number | null; rto: number }
  onTimeout(): { rto: number; timeouts: number }
  current(): RtoState
  readonly rto: number
  readonly srtt: number | null
  readonly ignoredSamples: number
}
export function createRtoEstimator(opts?: {
  alpha?: number
  beta?: number
  minRto?: number
  maxRto?: number
  initialRto?: number
}): RtoEstimator

/* ④ 滑动窗口 */
export interface SlidingWindowState {
  base: number
  next: number
  windowSize: number
  inFlight: number
  sack: number[]
  sends: number
  blocked: number
  cumAcks: number
}
export interface SlidingWindow {
  send(payload?: any): { sent: boolean; reason?: string; seq?: number; payload?: any; base?: number; next?: number; windowSize?: number }
  ack(seq: number, cumulative?: boolean): { base: number; next: number; sack: number[]; inFlight: number }
  state(): SlidingWindowState
  readonly inFlight: number
  readonly base: number
  readonly windowSize: number
}
export function createSlidingWindow(opts?: { windowSize?: number }): SlidingWindow

/* ⑤ QUIC 0-RTT 票据 */
export interface SessionTicket {
  id: string
  clientId: string
  issuedAt: number
  ttlMs: number
  nonce: string
}
export interface TicketVerdict {
  mode: '0-RTT' | '1-RTT'
  reason?: string
  ticket?: SessionTicket
}
export interface SessionTickets {
  issue(clientId: string): SessionTicket
  accept(ticket: SessionTicket, isIdempotent?: boolean): TicketVerdict
  reapReplay(t?: number): void
  stats(): { issued: number; accepted0Rtt: number; fellBack1Rtt: number; replayRejected: number; replaySetSize: number }
}
export function createSessionTickets(opts?: {
  ttlMs?: number
  replayWindowMs?: number
  now?: () => number
  nonce?: () => string
}): SessionTickets

/* ⑥ HTTP 缓存 */
export interface HttpCacheState {
  state: 'fresh' | 'stale' | 'miss'
  body?: any
  etag?: string
  age?: number
  revalidate?: boolean
}
export interface HttpCache {
  put(key: string, body: any, etag: string, maxAgeSec: number, swrSec?: number): { ok: boolean }
  get(key: string): HttpCacheState
  conditional(key: string, requestEtag: string): { status: 304 | 200; body?: any; etag?: string }
  stats(): { freshHits: number; staleHits: number; misses: number; notModified: number; entries: number }
}
export function createHttpCache(opts?: { now?: () => number }): HttpCache
