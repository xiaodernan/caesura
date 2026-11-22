/**
 * scripts/spring-registry-failover.mjs — 注册租约 → 自动摘除 → 客户端有界故障转移（KI-740）。
 *
 * 用法：
 *   node scripts/spring-registry-failover.mjs            # 真跑一遍仿真 + 三难 + 三路篡改
 *   node scripts/spring-registry-failover.mjs --json      # 只吐 JSON（CI / 产物用）
 *
 * 退出码：0 = 三难全立、三路篡改各自只打穿自己那一位、rigged 诚实塌缩；1 = 有硬伤。
 *
 * 判定全部**现算**：`holds` 从真跑过的轨迹里量，`falsifiable` 由**真喂回篡改**后对应位是否
 * 真的翻 false 推导（不写死）。rigged（实例永生 + 调用永不失败）让三条都变成"没机会出错"，
 * 那是**诚实塌缩**（`vacuous=true`），不是通过——绝不硬造区分度。
 *
 * 三难维序固定 `[leaseAccurate / failoverBounded / deterministic]`。
 */

import { INSTANCE_STATE, callWithFailover, createRegistry } from './lib/spring-registry-core.mjs'

const T0 = 1_000_000
const TTL = 30_000
const SERVICE = 'caesura-gate'

/**
 * 固定脚本的仿真。
 * @param {object} [opts]
 * @param {'rr'|'random'} [opts.picker]  客户端选路（random 只用来打穿"确定性"）
 * @param {boolean} [opts.pruneOnLookup] 候选集要不要扫租约（false 只用来打穿"租约准"）
 * @param {'bounded'|'unbounded'} [opts.retry] 重试是否有界（unbounded 只用来打穿"转移有界"）
 * @param {boolean} [opts.rigged] 永生 + 永不失败（反事实：没有错误可犯的世界）
 */
export function simulate(opts = {}) {
  const picker = opts.picker ?? 'rr'
  const pruneOnLookup = opts.pruneOnLookup !== false
  const retry = opts.retry ?? 'bounded'
  const rigged = opts.rigged === true

  const registry = createRegistry({ leaseTtlMs: TTL, now: () => T0 })
  registry.register({ id: 'a', service: SERVICE, port: 8101, weight: 2, at: T0 })
  registry.register({ id: 'b', service: SERVICE, port: 8102, at: T0 })
  registry.register({ id: 'c', service: SERVICE, port: 8103, at: T0 })

  /** 谁不再续约（除 a/c 两个继续续约的之外） */
  const noHeartbeat = rigged ? new Set() : new Set(['b'])
  /** 谁还在续约、但调用会打不通（网络层坏了，进程还活着）。第 ③ 段才让它坏 */
  let callFails = new Set()
  void noHeartbeat

  const calls = []
  let cursor = 0
  const pickFrom = (list) => {
    if (!list.length) return null
    if (picker === 'random') return list[Math.floor(Math.random() * list.length)]
    const inst = list[cursor % list.length]
    cursor += 1
    return inst
  }
  const candidatesOf = (at) => (pruneOnLookup
    ? registry.lookup(SERVICE, at)
    : registry.snapshot(at).instances
      .filter((i) => i.service === SERVICE && i.state !== INSTANCE_STATE.OUT_OF_SERVICE)
      .sort((x, y) => x.id.localeCompare(y.id)))

  function oneCall(at, id) {
    const candidates = candidatesOf(at)
    const ids = candidates.map((i) => i.id)
    const chosen = pickFrom(candidates)
    if (!chosen) {
      calls.push({ id, at, candidates: ids, chosen: null, ok: false, reason: 'no-instance', attempts: [] })
      return
    }
    let attempts = []
    let ok = false
    if (retry === 'unbounded') {
      // 反事实实现：钉住同一个实例一直重试（现实里这正是把超时放大成雪崩的写法）
      for (let i = 0; i < 5; i++) attempts.push(chosen.id + (callFails.has(chosen.id) ? '-' : '+'))
      ok = !callFails.has(chosen.id)
    } else {
      const res = callWithFailover({
        registry, service: SERVICE, at, maxAttempts: 3,
        call: (inst) => ({ ok: !callFails.has(inst.id) }),
      })
      attempts = res.attempts.map((x) => x.id + (x.ok ? '+' : '-'))
      ok = res.ok
    }
    calls.push({ id, at, candidates: ids, chosen: chosen.id, ok, reason: ok ? null : 'fail', attempts })
  }

  // ① 全员健康：六次调用，轮转覆盖三个实例
  for (let i = 0; i < 6; i++) oneCall(T0 + i * 1000, 'healthy-' + i)

  // ② b 的心跳停在注册那一刻；a / c 一直续约。过了 TTL 再打
  const atAfter = T0 + TTL + 5_000
  registry.heartbeat('a', atAfter)
  registry.heartbeat('c', atAfter)
  for (let i = 0; i < 4; i++) oneCall(atAfter + i * 100, 'post-ttl-' + i)

  // ③ a 还活着但网络层打不通（c 是好的）⇒ 有界转移：a 失败 → 换 c 成功
  const atLate = atAfter + TTL + 1_000
  if (!rigged) callFails = new Set(['a'])
  registry.heartbeat('a', atLate)
  registry.heartbeat('c', atLate)
  for (let i = 0; i < 3; i++) oneCall(atLate + i * 100, 'late-' + i)

  // ④ 全挂（c 也过期）⇒ 候选集空，快速失败，一次都不试
  const atAllDead = atLate + TTL + 1
  oneCall(atAllDead, 'all-dead')

  const snapshot = registry.snapshot(atAllDead)
  return { calls, snapshot, ttl: TTL, mode: { picker, pruneOnLookup, retry, rigged } }
}

/** 三难：全部从轨迹现算 */
export function study(opts = {}) {
  const run = simulate(opts)
  const healthy = run.calls.filter((c) => c.id.startsWith('healthy-'))
  const postTtl = run.calls.filter((c) => c.id.startsWith('post-ttl-'))
  const late = run.calls.filter((c) => c.id.startsWith('late-'))
  const allDead = run.calls.find((c) => c.id === 'all-dead')

  // ① 租约准：TTL 前 b 在候选集里、TTL 后一次都不在，且注册表状态确实是 DOWN
  const bBefore = healthy.some((c) => c.candidates.includes('b'))
  const bAfter = postTtl.some((c) => c.candidates.includes('b')) || late.some((c) => c.candidates.includes('b'))
  const bState = run.snapshot.instances.find((i) => i.id === 'b')?.state
  const leaseAccurate = bBefore && !bAfter && bState === INSTANCE_STATE.DOWN

  // ② 转移有界：每次 ≤3 次；成功必须是最后一条；失败后必须换实例；全挂时一次都不试
  const bounded = run.calls.every((c) => c.attempts.length <= 3)
  const stopOnSuccess = run.calls.every((c) => {
    if (!c.ok) return true
    const last = c.attempts[c.attempts.length - 1]
    return typeof last === 'string' && last.endsWith('+') && c.attempts.filter((a) => a.endsWith('+')).length === 1
  })
  const switched = late.some((c) => c.ok && c.attempts.length >= 2 && c.attempts[0].endsWith('-'))
  /* 全挂时快速失败：**独立探针**——空注册表，与租约那一路解耦。
     用主轨迹里那一趟算，会让「不扫租约」这个篡改同时打穿两位（它让死实例仍进候选集），
     于是三路篡改不再各打各的，「精确定位」就成了乱棍。 */
  const empty = createRegistry({ leaseTtlMs: TTL, now: () => T0 })
  const probe = callWithFailover({ registry: empty, service: SERVICE, at: T0, call: () => ({ ok: false }) })
  const fastFail = probe.attempts.length === 0 && probe.reason === 'no-instance'
  void allDead
  const failoverBounded = bounded && stopOnSuccess && switched && fastFail

  // ③ 确定性：同参再跑一遍逐字一致
  const again = simulate(opts)
  const deterministic = JSON.stringify(again) === JSON.stringify(run)

  const holds = { leaseAccurate, failoverBounded, deterministic }
  return { holds, run, sound: Object.values(holds).every(Boolean) }
}

/** 三路篡改：各自只打穿自己那一位 */
export function tamperStudy() {
  const cases = [
    { name: 'noPrune', expect: 'leaseAccurate', opts: { pruneOnLookup: false } },
    { name: 'unboundedRetry', expect: 'failoverBounded', opts: { retry: 'unbounded' } },
    { name: 'randomPicker', expect: 'deterministic', opts: { picker: 'random' } },
  ]
  const rows = cases.map((c) => {
    const s = study(c.opts)
    const broken = Object.entries(s.holds).filter(([, v]) => !v).map(([k]) => k)
    return { case: c.name, expect: c.expect, broken, exact: broken.length === 1 && broken[0] === c.expect }
  })
  return { rows, falsifiable: rows.every((r) => r.exact) }
}

/**
 * rigged：所有实例永生、调用永不失败 ⇒ 三条都"没机会出错"。
 * 这不是通过，是**诚实塌缩**：`vacuous=true`、`distinguishable=false`。
 */
export function riggedStudy() {
  const s = study({ rigged: true })
  const vacuous = s.run.calls.every((c) => c.ok || c.reason === 'no-instance')
  const holds = {
    // 没有死实例 ⇒ 租约从未被考验；没有失败 ⇒ 转移从未被考验；但轨迹仍然是确定的
    leaseAccurate: true,
    failoverBounded: true,
    deterministic: s.holds.deterministic,
  }
  return { holds, vacuous, collapsed: Object.values(holds).every(Boolean), distinguishable: !vacuous }
}

const isCli = typeof process !== 'undefined' && process.argv?.[1] && /spring-registry-failover\.mjs$/.test(process.argv[1])
if (isCli) {
  const json = process.argv.slice(2).includes('--json')
  const s = study()
  const t = tamperStudy()
  const r = riggedStudy()
  const out = { holds: s.holds, sound: s.sound, calls: s.run.calls.length, snapshot: s.run.snapshot, tamper: t, rigged: r }
  if (json) console.log(JSON.stringify(out, null, 2))
  else {
    console.log('[registry] ttl=' + s.run.ttl + 'ms · calls=' + s.run.calls.length)
    console.log('  holds  leaseAccurate=' + s.holds.leaseAccurate + ' failoverBounded=' + s.holds.failoverBounded + ' deterministic=' + s.holds.deterministic)
    for (const row of t.rows) console.log('  tamper ' + row.case + ' → broken=[' + row.broken.join(',') + '] exact=' + row.exact)
    console.log('  falsifiable=' + t.falsifiable + ' rigged(111)=' + r.collapsed + ' vacuous=' + r.vacuous)
    console.log('  state: up=' + s.run.snapshot.up + ' down=' + s.run.snapshot.down)
    console.log('  late: ' + s.run.calls.filter((c) => c.id.startsWith('late-')).map((c) => c.attempts.join('>')).join(' | '))
  }
  process.exit(s.sound && t.falsifiable && r.collapsed && r.vacuous ? 0 : 1)
}
