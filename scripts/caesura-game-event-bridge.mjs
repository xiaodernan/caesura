/**
 * scripts/caesura-game-event-bridge.mjs —— 游戏真 EventBus ↔ 云事件总线 桥接件（集大成 P7 / KI-489）。
 *
 * <p>病：游戏侧有真实的类型化 `src/core/EventBus`（`on(key,fn)` / `emit(key,payload)`，载荷 `GameEvents`），
 * 而云侧 KI-484 的 `caesura-event-bus` 是另一只内存 bus；两边此前没有任何桥——游戏里真发的
 * `combat.hit`／`boss.phase`／`quest.changed` 一个都到不了微服务网格，云侧事件也进不了游戏。
 * 集大成要求「游戏事件即一等微服务事件」，本件补这一格。</p>
 *
 * <p><b>为什么不直接 import 游戏总线</b>：`scripts/` 是纯 Node 侧（家族门不让它 import 浏览器 `src/`，
 * `src/core/EventBus` 走 `@/` vite 别名，Node 加载器不认）。所以本件<b>依赖注入</b>两只 duck-typed bus：
 * 游戏侧把真 `bus` 传进来，云侧把 `createGameCloud().events` 传进来，本件只做转发。</p>
 *
 * <p><b>判定权仍在 Node 侧（决策原则①）</b>：哪些游戏事件键允许过桥、映射成什么云事件 type、
 * 哪些云事件反向进游戏，全由 `opts.routes` 决定；本件不猜、不默认全量转发（默认空路由＝什么都不转）。
 * 所有载荷原样透传，不做序列化/过滤。</p>
 *
 * <p>用法（游戏侧，src/ 一行接线，不改本件）：
 * ```js
 * import { bus } from '@/core/EventBus'
 * const bridge = createGameEventBridge({
 *   gameBus: bus, cloudBus: gc.events,
 *   routes: [
 *     { from: 'game', key: 'boss.phase',   type: 'game.boss.phase' },
 *     { from: 'game', key: 'combat.hit',   type: 'game.combat.hit' },
 *     { from: 'cloud', type: 'remote.notice', key: 'ui.notify' },
 *   ],
 * })
 * bridge.install()
 * // ... 退场时 bridge.uninstall()
 * ```
 */
export const DIRECTIONS = ['game', 'cloud']

/**
 * 创建一只游戏事件桥。
 * @param {object} opts
 * @param {{on:(k:string,fn:Function)=>Function, emit:(k:string,p:any)=>void}} opts.gameBus 游戏真 EventBus（duck-typed）
 * @param {{onGameEvent:(t:string,fn:Function)=>Function, publishGameEvent:(t:string,p?:any)=>Promise<any>}} opts.cloudBus 云事件总线
 * @param {Array<{from:'game'|'cloud', key:string, type:string}>} [opts.routes] 过桥白名单（默认 []）
 * @param {(e:object)=>void} [opts.onEvent] 观测量子（每次转发/丢弃发一条）
 */
export function createGameEventBridge(opts = {}) {
  const gameBus = opts.gameBus
  const cloudBus = opts.cloudBus
  const routes = Array.isArray(opts.routes) ? opts.routes : []
  const onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : () => {}

  // 缺任一 bus 时 install 诚实报未装，不抛（与 caesura-game-bootstrap 的 install 同脾气）。
  const gameOK = gameBus && typeof gameBus.on === 'function' && typeof gameBus.emit === 'function'
  const cloudOK = cloudBus && typeof cloudBus.onGameEvent === 'function' && typeof cloudBus.publishGameEvent === 'function'

  const gameRoutes = routes.filter((r) => r?.from === 'game' && typeof r.key === 'string' && typeof r.type === 'string')
  const cloudRoutes = routes.filter((r) => r?.from === 'cloud' && typeof r.key === 'string' && typeof r.type === 'string')
  // 云 type → 游戏 key 的倒排，便于反向 handler 一次查表（同一 type 只认首条，避免重复 emit）。
  const reverse = new Map()
  for (const r of cloudRoutes) if (!reverse.has(r.type)) reverse.set(r.type, r.key)

  const counters = { forward: 0, reverse: 0, dropped: 0 }
  const offs = []
  let installed = false

  /** 装桥：给每条白名单在源总线上挂一个转发 handler，返回 uninstall 用的一摞退订。 */
  function install() {
    if (installed) return { installed: true, handlers: offs.length }
    if (!gameOK || !cloudOK) {
      onEvent({ type: 'bridge.not_installed', gameOK: !!gameOK, cloudOK: !!cloudOK })
      return { installed: false, handlers: 0, reason: 'missing_bus' }
    }
    // 游戏 → 云：游戏真事件发出来时，原样 publishGameEvent 到云总线。
    for (const r of gameRoutes) {
      offs.push(gameBus.on(r.key, (payload) => {
        counters.forward += 1
        onEvent({ direction: 'game→cloud', key: r.key, type: r.type })
        Promise.resolve(cloudBus.publishGameEvent(r.type, payload)).catch((e) => {
          counters.dropped += 1
          onEvent({ direction: 'game→cloud', key: r.key, type: r.type, dropped: String(e?.message ?? e) })
        })
      }))
    }
    // 云 → 游戏：云事件到达时，原样 emit 到游戏真总线（同步，与 EventBus.emit 一致）。
    for (const [type, key] of reverse) {
      offs.push(cloudBus.onGameEvent(type, (payload) => {
        counters.reverse += 1
        onEvent({ direction: 'cloud→game', key, type })
        gameBus.emit(key, payload)
      }))
    }
    installed = true
    return { installed: true, handlers: offs.length }
  }

  /** 退桥：摘掉全部 handler，计数保留供读数。幂等。 */
  function uninstall() {
    let removed = 0
    for (const off of offs) {
      if (typeof off === 'function') { off(); removed += 1 }
    }
    offs.length = 0
    installed = false
    return { uninstalled: true, removed }
  }

  return {
    install,
    uninstall,
    isInstalled: () => installed,
    stats: () => ({ ...counters, handlers: offs.length, gameRoutes: gameRoutes.length, cloudRoutes: cloudRoutes.length }),
    /** 手动转发一次游戏事件（不经订阅，供测试/补发用）。统一返回 {ok, result?/error?}。 */
    async forward(key, payload) {
      const r = gameRoutes.find((x) => x.key === key)
      if (!r) { counters.dropped += 1; onEvent({ direction: 'game→cloud', key, dropped: 'not_routed' }); return { ok: false, reason: 'not_routed' } }
      counters.forward += 1
      onEvent({ direction: 'game→cloud', key, type: r.type, manual: true })
      try {
        const result = await cloudBus.publishGameEvent(r.type, payload)
        return { ok: true, result }
      } catch (e) {
        counters.dropped += 1
        return { ok: false, error: e }
      }
    },
    routes: () => routes.map((r) => ({ ...r })),
  }
}
