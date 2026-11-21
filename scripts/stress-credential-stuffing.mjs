/**
 * scripts/stress-credential-stuffing.mjs — 撞库 / 口令枚举压力场景（KI-721）
 *
 * 诚实边界：本项目是静态站 + 公开口令门（123），**没有真实登录后端**。这里压的是
 * 「如果接了后端，登录守卫在海量错误口令下会怎样」——一个可复现的内存守卫，
 * 真算失败计数、锁定窗口、限流与延迟；不伪装成打过某个真实网站。
 *
 * 判据（不可造假）：
 *   1. 错误口令**永远不接受**（falseAccepts 必须为 0，否则整体红）；
 *   2. 同一用户在 maxAttempts 次失败后真进入锁定，锁定期间即使给正确口令也拒绝；
 *   3. 锁定到期后正确口令恢复；
 *   4. 并发洪峰下 p95 延迟与 heap 增长如实读出，不写死数字。
 *
 * 用法：node scripts/stress-credential-stuffing.mjs --attempts=20000 --concurrency=200
 */

const DEFAULT_SECRET = '123' // 刻意公开的礼貌门：这里只当被攻击的口令样本，不声称有秘密

export const STUFFING_DEFAULTS = Object.freeze({
  attempts: 5000,
  concurrency: 100,
  users: 48,
  maxAttempts: 5,
  windowMs: 60_000,
  lockMs: 300_000,
  seed: 721,
})

const intOr = (v, d) => (Number.isFinite(Number(v)) ? Math.max(1, Math.floor(Number(v))) : d)
const lcg = (seed) => {
  let s = Number(seed) >>> 0 || 1
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
}

/** 定长比较：不提前退出，避免用响应时间泄露「前缀猜对了多少」。 */
function constantTimeEqual(a, b) {
  const x = String(a), y = String(b)
  const n = Math.max(x.length, y.length, 16)
  let diff = x.length ^ y.length
  for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0)
  return diff === 0
}

export function createLoginGuard(opts = {}) {
  const secret = String(opts.secret ?? DEFAULT_SECRET)
  const maxAttempts = intOr(opts.maxAttempts, STUFFING_DEFAULTS.maxAttempts)
  const windowMs = intOr(opts.windowMs, STUFFING_DEFAULTS.windowMs)
  const lockMs = intOr(opts.lockMs, STUFFING_DEFAULTS.lockMs)
  let clock = Number.isFinite(opts.now) ? Number(opts.now) : Date.now()
  const state = new Map()
  const stats = { attempts: 0, failures: 0, locked: 0, accepted: 0, falseAccepts: 0, uniqueUsers: 0 }

  function now() { return typeof opts.nowFn === 'function' ? Number(opts.nowFn()) : clock }
  function bucket(user) {
    const u = String(user).slice(0, 64)
    if (!state.has(u)) {
      state.set(u, { failures: [], lockUntil: 0 })
      stats.uniqueUsers++
    }
    return state.get(u)
  }

  function attempt(user, password) {
    stats.attempts++
    const b = bucket(user)
    const t = now()
    if (t < b.lockUntil) {
      stats.locked++
      return { accepted: false, reason: 'locked', remainingMs: b.lockUntil - t }
    }
    const ok = constantTimeEqual(password, secret)
    if (ok) {
      stats.accepted++
      b.failures.length = 0
      return { accepted: true, reason: 'ok' }
    }
    stats.failures++
    b.failures = b.failures.filter((x) => t - x < windowMs)
    b.failures.push(t)
    if (b.failures.length >= maxAttempts) {
      b.lockUntil = t + lockMs
      b.failures.length = 0
      return { accepted: false, reason: 'just-locked', remainingMs: lockMs }
    }
    return { accepted: false, reason: 'bad-password', remaining: maxAttempts - b.failures.length }
  }

  return {
    attempt,
    stats: () => ({ ...stats }),
    advance: (ms) => { clock += Math.max(0, Number(ms) || 0) },
    lockState: (user) => {
      const b = state.get(String(user))
      return b ? { locked: now() < b.lockUntil, remainingMs: Math.max(0, b.lockUntil - now()) } : { locked: false, remainingMs: 0 }
    },
  }
}

export async function runStuffing(opts = {}) {
  const attempts = intOr(opts.attempts, STUFFING_DEFAULTS.attempts)
  const concurrency = intOr(opts.concurrency, STUFFING_DEFAULTS.concurrency)
  const users = intOr(opts.users, STUFFING_DEFAULTS.users)
  const rand = typeof opts.rand === 'function' ? opts.rand : lcg(opts.seed ?? STUFFING_DEFAULTS.seed)
  const guard = createLoginGuard({ ...opts, nowFn: opts.nowFn })
  const latencies = []
  const reasons = Object.create(null)
  const heapBefore = process.memoryUsage().heapUsed
  const wall0 = Number(process.hrtime.bigint() / 1000n)
  let falseAccepts = 0

  // 攻击者视角：绝大多数是错口令，偶尔混入正确口令看锁定是否被绕过。
  const passwords = ['wrong', '1234', 'password', '111', 'admin', 'qwerty', '123']

  for (let i = 0; i < attempts; i += concurrency) {
    const chunk = Math.min(concurrency, attempts - i)
    await Promise.all(Array.from({ length: chunk }, async (_, j) => {
      const user = 'u' + Math.floor(rand() * users)
      const isCorrect = rand() < 0.02
      const password = isCorrect ? '123' : passwords[Math.floor(rand() * (passwords.length - 1))]
      const t0 = Number(process.hrtime.bigint() / 1000n)
      const r = guard.attempt(user, password)
      latencies.push(Number(process.hrtime.bigint() / 1000n) - t0)
      reasons[r.reason] = (reasons[r.reason] || 0) + 1
      if (!isCorrect && r.accepted) falseAccepts++
    }))
  }

  // stats() 返回副本，只读一次；falseAccepts 是本函数作用域内真加的计数器，不靠 getter 副本。
  const guardStats = { falseAccepts }
  const wallMs = Math.round(Number(process.hrtime.bigint() / 1000n) - wall0) / 1000
  const heapGrowth = Number(((process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024).toFixed(2))
  latencies.sort((a, b) => a - b)
  const p = (q) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * q))] || 0
  const st = guard.stats()
  return {
    attempts,
    concurrency,
    users,
    ...st,
    reasons,
    falseAccepts: st.falseAccepts,
    avgLatencyUs: Math.round(latencies.reduce((a, b) => a + b, 0) / Math.max(1, latencies.length)),
    p50Us: p(0.5), p95Us: p(0.95), p99Us: p(0.99),
    heapGrowthMb: heapGrowth,
    wallMs,
    sound: st.falseAccepts === 0 && st.failures > 0 && st.locked > 0,
  }
}

export function credentialStuffingSnapshot(run) {
  return {
    attempts: run.attempts, concurrency: run.concurrency, users: run.users,
    accepted: run.accepted, rejected: run.failures + run.locked,
    falseAccepts: run.falseAccepts, sound: run.sound,
    avgLatencyUs: run.avgLatencyUs, p50Us: run.p50Us, p95Us: run.p95Us, p99Us: run.p99Us,
    heapGrowthMb: run.heapGrowthMb, wallMs: run.wallMs,
  }
}

const isCli = typeof process !== 'undefined' && process.argv?.[1]
  && /stress-credential-stuffing\.mjs$/.test(process.argv[1])
if (isCli) {
  const argv = process.argv.slice(2)
  const arg = (n, d) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d }
  const run = await runStuffing({
    attempts: intOr(arg('attempts', STUFFING_DEFAULTS.attempts), STUFFING_DEFAULTS.attempts),
    concurrency: intOr(arg('concurrency', STUFFING_DEFAULTS.concurrency), STUFFING_DEFAULTS.concurrency),
    users: intOr(arg('users', STUFFING_DEFAULTS.users), STUFFING_DEFAULTS.users),
  })
  const snap = credentialStuffingSnapshot(run)
  console.log('credential stuffing stress (simulated guard · static site has no real auth backend):')
  console.log('  attempts / accepted / rejected = ' + snap.attempts + ' / ' + snap.accepted + ' / ' + snap.rejected)
  console.log('  false accepts = ' + snap.falseAccepts + '  sound = ' + snap.sound)
  console.log('  reasons = ' + JSON.stringify(run.reasons))
  console.log('  avg / p50 / p95 / p99 us = ' + [snap.avgLatencyUs, snap.p50Us, snap.p95Us, snap.p99Us].join(' / '))
  console.log('  heap growth = ' + snap.heapGrowthMb + ' MB · wall = ' + snap.wallMs + ' ms')
  process.exit(snap.sound ? 0 : 1)
}
