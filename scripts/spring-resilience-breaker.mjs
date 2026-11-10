/**
 * scripts/spring-resilience-breaker.mjs —— Spring Cloud Resilience4j 风格的内存熔断器（Node.js 侧）。
 *
 * <p>家族里既有的 `spring-circuit-breaker.mjs` 只「查」网关熔断器的状态（query-only），本件提供
 * 「在进程内对一次调用施加熔断保护」的能力，供 `caesura-cloud-runtime` 的 call 与 `caesura-service-proxy`
 * 的代理链路使用。判定权仍在 Node 侧（决策原则①）：阈值/冷却由调用方注入，本件只做状态机与计数。</p>
 *
 * <p>状态机：CLOSED ──(失败达阈值)──▶ OPEN ──(冷却到期)──▶ HALF_OPEN ──(成功)──▶ CLOSED
 *                                          ▲                         │
 *                                          └────────(失败)───────────┘</p>
 */

const DEFAULTS = {
  failureThreshold: 5,
  cooldownMs: 1000,
  halfOpenMax: 1,
  windowSize: 20,
}

/**
 * 创建一只内存熔断器。
 * @param {string} name 熔断器名（通常即服务名）
 * @param {object} [opts] { failureThreshold, cooldownMs, halfOpenMax, windowSize }
 */
export function createCircuitBreaker(name, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts }
  let state = 'CLOSED'
  let failures = 0
  let successes = 0
  let rejects = 0
  let openUntil = 0
  let halfOpenTrials = 0

  const now = () => Date.now()

  function recordFailure() {
    failures += 1
    if (state === 'CLOSED' && failures >= cfg.failureThreshold) {
      state = 'OPEN'
      openUntil = now() + cfg.cooldownMs
    } else if (state === 'HALF_OPEN') {
      // 半开期间任一失败立即回到 OPEN 并重置冷却
      state = 'OPEN'
      openUntil = now() + cfg.cooldownMs
    }
  }

  function recordSuccess() {
    successes += 1
    if (state === 'HALF_OPEN') {
      state = 'CLOSED'
      failures = 0
      halfOpenTrials = 0
    }
  }

  /**
   * 用熔断保护地执行 fn。
   * @param {() => any} fn 受保护的调用（可返回 Promise）
   * @returns {Promise<{ok:boolean, state:string, result?:any, error?:unknown}>}
   */
  async function run(fn) {
    if (state === 'OPEN') {
      if (now() >= openUntil) {
        state = 'HALF_OPEN'
        halfOpenTrials = 0
      } else {
        rejects += 1
        return { ok: false, state, result: undefined, error: new Error('circuit_open') }
      }
    }
    if (state === 'HALF_OPEN') {
      // 串行探测：超过 halfOpenMax 次仍未成功则回落 OPEN
      halfOpenTrials += 1
      if (halfOpenTrials > cfg.halfOpenMax) {
        state = 'OPEN'
        openUntil = now() + cfg.cooldownMs
        rejects += 1
        return { ok: false, state, result: undefined, error: new Error('circuit_open') }
      }
    }
    try {
      const result = await fn()
      recordSuccess()
      return { ok: true, state, result, error: undefined }
    } catch (error) {
      recordFailure()
      return { ok: false, state, result: undefined, error }
    }
  }

  function metrics() {
    return { state, failures, successes, rejects }
  }

  function reset() {
    state = 'CLOSED'
    failures = 0
    successes = 0
    rejects = 0
    openUntil = 0
    halfOpenTrials = 0
  }

  return { run, state: () => state, metrics, reset }
}
