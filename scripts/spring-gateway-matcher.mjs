/**
 * scripts/spring-gateway-matcher.mjs —— Spring Cloud Gateway 的「可用化」收口：predicate 求值 + filter 链执行（Node.js 侧）。
 *
 * <p>家族既有 `spring-gateway-route.mjs` 只管路由表的增删查/热看，没有「真拿一个请求去匹配路由、
 * 再跑一遍 filter 链」的能力。本件补齐：让 Gateway 在 Node 侧真正可求值，运行时 call 可以先过网关再选实例。
 * 判词仍由 Node 侧持有（决策原则①）：predicate/filter 的语义解释都在本件，不依赖真网关。</p>
 *
 * <p>predicate：Path（支持 `**`/`*` glob）、Method、Header（正则）、Weight（注入式 selector，默认按 path 哈希决定）。
 * filter 链：planFilters 给出执行计划，runWithFilters 经注入的 handlers 真正执行（CircuitBreaker/Retry/RateLimit 等
 * 由调用方注入，本件不绑死具体熔断实现，与 `spring-resilience-breaker` 解耦）。</p>
 */

function fnv1a(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 0xffffffff
}

function globToRegExp(glob) {
  let re = '^'
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++ } else { re += '[^/]*' }
    } else if (c === '.') re += '\\.'
    else if (c === '/') re += '/'
    else re += c
  }
  return new RegExp(re + '$')
}

function pathMatches(pattern, path) {
  try {
    return globToRegExp(pattern).test(path)
  } catch {
    return false
  }
}

/**
 * 创建一只网关匹配器。
 * @param {object} [opts] { weightSelector?: (ctx:{group:string,path:string}) => number in [0,1) }
 */
export function createGatewayMatcher(opts = {}) {
  const weightSelector = opts.weightSelector ?? (({ path }) => fnv1a(path))

  function evaluatePredicate(pred, req) {
    const name = pred?.name
    const args = pred?.args ?? {}
    const path = req?.path ?? ''
    if (name === 'Path') {
      const raw = args.patterns ?? args.pattern
      const patterns = Array.isArray(raw) ? raw : (raw != null ? [raw] : [])
      return patterns.some((p) => pathMatches(p, path))
    }
    if (name === 'Method') {
      const methods = Array.isArray(args.methods)
        ? args.methods
        : String(args.methods ?? '').split(',').map((s) => s.trim()).filter(Boolean)
      if (methods.length === 0) return true
      return methods.map((m) => m.toUpperCase()).includes((req?.method ?? 'GET').toUpperCase())
    }
    if (name === 'Header') {
      const header = String(args.header ?? '').toLowerCase()
      const regex = args.regexp ?? args.regex ?? '.*'
      const val = req?.headers?.[header]
      if (val === undefined) return false
      try { return new RegExp(regex).test(val) } catch { return false }
    }
    if (name === 'Weight') {
      const group = args.group ?? 'default'
      const weight = Number(args.weight ?? 0)
      const r = weightSelector({ group, path })
      return r * 100 < weight
    }
    // 未知 predicate 宽松视为匹配，保证非破坏性
    return true
  }

  function predicatesMatch(route, req) {
    return (route.predicates ?? []).every((p) => evaluatePredicate(p, req))
  }

  /**
   * 在路由表中匹配首个（按 order 升序）全部 predicate 命中的路由。
   * @returns {{route:any, matched:Array<{name:string,matched:boolean}>}} | null
   */
  function matchRoute(table, req) {
    const routes = typeof table.list === 'function' ? table.list() : (Array.isArray(table) ? table : [])
    for (const route of routes) {
      if (predicatesMatch(route, req)) {
        return { route, matched: (route.predicates ?? []).map((p) => ({ name: p.name, matched: evaluatePredicate(p, req) })) }
      }
    }
    return null
  }

  function planFilters(route) {
    return (route.filters ?? []).map((f) => ({ name: f.name, args: f.args ?? {} }))
  }

  /**
   * 按 filter 链顺序执行；handlers 提供各 filter 名的具体执行（缺省透传）。
   *
   * <p><b>可重入</b>（KI-486）：每一层的 `next` 是「重跑剩余链」的纯函数，而非只前进一次的共享游标。
   * 这是 Retry 能成立的前提——handler 多次 `await next()` 会真把下游 filter 与 terminal 各跑一遍；
   * 旧的单游标写法第二次 `next()` 只会越过链尾拿 `ctx.result`，重试是假的。</p>
   *
   * @param {object} route 含 filters
   * @param {object} ctx 调用上下文（可含 result 初始值）
   * @param {Record<string, (args:any, ctx:any, next:()=>Promise<any>) => any>} [handlers]
   * @param {() => Promise<any>} [terminal] 链尾动作（如真发起 transport）；缺省返回 ctx.result。
   *   缺省保持与 KI-475 的 3 参调用逐字同义（终端读 ctx.result）。</p>
   */
  async function runWithFilters(route, ctx, handlers = {}, terminal) {
    const filters = planFilters(route)
    const tail = typeof terminal === 'function' ? terminal : async () => ctx?.result

    // 从尾部往前把链编译成嵌套函数：每层拿到的 next 都是「从下一层起重跑」的闭包。
    let chain = tail
    for (let i = filters.length - 1; i >= 0; i--) {
      const f = filters[i]
      const handler = handlers[f.name]
      const downstream = chain
      chain = async () => {
        if (handler) return handler(f.args, ctx, downstream)
        return downstream()
      }
    }
    return chain()
  }

  return { evaluatePredicate, matchRoute, planFilters, runWithFilters }
}
