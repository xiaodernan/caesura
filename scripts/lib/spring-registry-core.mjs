/**
 * scripts/lib/spring-registry-core.mjs — 服务注册租约 + 客户端故障转移的**纯内核**（KI-740）。
 *
 * ## 为什么还要这一件
 * 仓库里已经有一整套 Spring Cloud 家族：`spring-eureka-client`（真去 Eureka 拉实例）、
 * `spring-load-balancer`（按策略从**拉到的那张表**里选一个）、`spring-mesh-registry`（多后端合并视图）。
 * 但它们都假设「表是对的」——**没有一处回答「表什么时候会错、错了以后谁把死实例摘掉、摘掉之前客户端怎么办」**。
 * 而这三件事恰恰是服务发现真正难的地方：
 *
 *   1. **租约（lease）**：实例不是"注册了就永远在"，它得**一直续约**。心跳断了，租约到期，注册中心才敢摘。
 *      所以"实例还活着"不是一个布尔，而是一个**时间窗**：`now - lastHeartbeat <= ttl`。
 *   2. **摘除（eviction）**：到期后不是立刻消失，而是从 UP 掉到 DOWN（还能被运维看见、能被诊断），
 *      再从候选集里排除。**悄悄消失**是最坏的实现——线上出问题时没人知道它曾经在。
 *   3. **故障转移（failover）**：客户端拿着"也许已经死了"的表去调用，第一次可能就打空。
 *      正确做法是**有界的**重试：换一个没试过的实例，成功即停；全试完就快速失败。
 *      无界重试 = 把一次超时放大成一场雪崩（这正是熔断器存在的理由，见 `caesura-circuit-breaker`）。
 *
 * ## 这一件是什么 / 不是什么
 * - 是：可注入时钟的**确定性内核** + 可复算的仿真（`study()`），用来证明上面三条不是口号。
 * - 不是：真 Eureka 服务器、真 HTTP 客户端、真 Spring Cloud LoadBalancer。那些由既有件负责；
 *   这里只把「租约→摘除→转移」这条因果链做成**能被篡改打穿**的判据。
 *
 * 三难维序固定 `[leaseAccurate / failoverBounded / deterministic]`：
 * - `leaseAccurate`：过了 TTL 的死实例**一次都不许**再被选中（且在 TTL 内允许被选中——那是对的，不是 bug）
 * - `failoverBounded`：每次调用最多 `maxAttempts` 次，且**成功即停**（不许"成功了还继续试"）
 * - `deterministic`：同一脚本 + 同一时钟走两遍，逐字一致（不取随机数、不读真实时钟）
 */

export const INSTANCE_STATE = Object.freeze({
  UP: 'UP',
  DOWN: 'DOWN',
  /** 人工摘流（发布/维护）：不受租约影响，也永远不进候选集 */
  OUT_OF_SERVICE: 'OUT_OF_SERVICE',
})

const isPosInt = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d)

/**
 * 建一个注册中心内核。
 * @param {object} [opts]
 * @param {number} [opts.leaseTtlMs] 租约时长（缺省 30000）
 * @param {() => number} [opts.now] 时钟（缺省 `Date.now`；测试与仿真一律注入固定钟）
 */
export function createRegistry(opts = {}) {
  const ttl = isPosInt(opts.leaseTtlMs, 30000)
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()
  /** @type {Map<string, any>} */
  const byId = new Map()

  function register(spec = {}) {
    const id = String(spec.id ?? '')
    const service = String(spec.service ?? '')
    if (!id || !service) throw new Error('register 需要 id 与 service')
    const at = Number.isFinite(spec.at) ? Number(spec.at) : now()
    const inst = {
      id,
      service,
      host: String(spec.host ?? '127.0.0.1'),
      port: isPosInt(spec.port, 8080),
      weight: isPosInt(spec.weight, 1),
      state: spec.state === INSTANCE_STATE.OUT_OF_SERVICE ? INSTANCE_STATE.OUT_OF_SERVICE : INSTANCE_STATE.UP,
      lastHeartbeat: at,
      evictedAt: null,
    }
    byId.set(id, inst)
    return { ...inst }
  }

  /** 续约。返回 false = 这个 id 不在册（调用方不要静默当成功） */
  function heartbeat(id, at = now()) {
    const inst = byId.get(String(id))
    if (!inst) return false
    inst.lastHeartbeat = Number(at)
    // 心跳回来 ⇒ 从 DOWN 复活（网络抖动不该需要人工重新注册）
    if (inst.state === INSTANCE_STATE.DOWN) { inst.state = INSTANCE_STATE.UP; inst.evictedAt = null }
    return true
  }

  function deregister(id) {
    return byId.delete(String(id))
  }

  function setState(id, state) {
    const inst = byId.get(String(id))
    if (!inst) return false
    if (state !== INSTANCE_STATE.UP && state !== INSTANCE_STATE.DOWN && state !== INSTANCE_STATE.OUT_OF_SERVICE) return false
    inst.state = state
    if (state === INSTANCE_STATE.UP) { inst.evictedAt = null; inst.lastHeartbeat = now() }
    return true
  }

  /**
   * 扫一遍租约：到期且仍在 UP 的，掉成 DOWN（**不是删掉**——运维要看得见它曾经在）。
   * @returns {string[]} 这一趟被摘掉的 id
   */
  function prune(at = now()) {
    const t = Number(at)
    const evicted = []
    for (const inst of byId.values()) {
      if (inst.state !== INSTANCE_STATE.UP) continue
      if (t - inst.lastHeartbeat > ttl) {
        inst.state = INSTANCE_STATE.DOWN
        inst.evictedAt = t
        evicted.push(inst.id)
      }
    }
    return evicted.sort()
  }

  /** 候选集：先扫租约，再按 id 排序返回 UP 实例（顺序稳定 ⇒ 可复算） */
  function lookup(service, at = now()) {
    prune(at)
    return [...byId.values()]
      .filter((i) => i.service === String(service) && i.state === INSTANCE_STATE.UP)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((i) => ({ ...i }))
  }

  function snapshot(at = now()) {
    prune(at)
    const list = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
    const services = [...new Set(list.map((i) => i.service))].sort()
    return {
      ttl,
      at: Number(at),
      services,
      up: list.filter((i) => i.state === INSTANCE_STATE.UP).length,
      down: list.filter((i) => i.state === INSTANCE_STATE.DOWN).length,
      outOfService: list.filter((i) => i.state === INSTANCE_STATE.OUT_OF_SERVICE).length,
      instances: list.map((i) => ({ ...i })),
    }
  }

  return { ttl, now, register, heartbeat, deregister, setState, prune, lookup, snapshot, size: () => byId.size }
}

/**
 * 带故障转移的调用。
 *
 * 一次调用最多试 `maxAttempts` 个**不同**实例：失败的那个立刻不再重试（同一轮里），
 * 成功立刻返回（**不许"成功了再试一个看看"**——那是把用户的一次请求变成 N 次）。
 * 全部失败 ⇒ `{ ok:false }`，由调用方决定熔断/降级。
 *
 * @param {object} opts
 * @param {ReturnType<typeof createRegistry>} opts.registry
 * @param {string} opts.service
 * @param {(inst: any) => ({ok: boolean, result?: any}) } opts.call 被调用的假件（仿真里由脚本决定谁挂）
 * @param {number} [opts.maxAttempts]
 * @param {number} [opts.at]
 */
export function callWithFailover(opts) {
  const { registry, service, call } = opts
  const maxAttempts = isPosInt(opts.maxAttempts, 3)
  const at = Number.isFinite(opts.at) ? Number(opts.at) : registry.now()
  const candidates = registry.lookup(service, at)
  const attempts = []
  if (!candidates.length) return { ok: false, reason: 'no-instance', attempts, result: undefined }
  const tried = new Set()
  for (const inst of candidates) {
    if (attempts.length >= maxAttempts) break
    if (tried.has(inst.id)) continue
    tried.add(inst.id)
    const r = call(inst)
    const ok = !!(r && r.ok)
    attempts.push({ id: inst.id, ok })
    if (ok) return { ok: true, attempts, result: r.result, instance: inst }
  }
  return { ok: false, reason: 'all-attempts-failed', attempts, result: undefined }
}

/** 一个按"调用序号"轮转的确定性选路器（仿真用；真实现走 `spring-load-balancer` 的策略） */
export function roundRobinPicker() {
  let cursor = 0
  return (instances) => {
    if (!instances.length) return null
    const inst = instances[cursor % instances.length]
    cursor += 1
    return inst
  }
}
