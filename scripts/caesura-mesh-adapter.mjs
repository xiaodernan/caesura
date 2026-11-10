/**
 * scripts/caesura-mesh-adapter.mjs —— 游戏侧微服务适配层（集大成收口：让游戏成为家族一等公民）。
 *
 * <p>把 CAESURA 游戏本体接进 Spring Cloud 微服务族：用 CaesuraCloud 门面把游戏实例注册进发现中心、
 * 拉取自己的配置、在生命周期/健康频道上发事件、回报健康。判定权仍在 Node 侧（决策原则①）：
 * 本门只做编排，不写任何阈值。游戏侧（浏览器/Node）只消费 `start/stop/reportHealth/status`。</p>
 *
 * <p>用法（CLI 仅作探针）：node scripts/caesura-mesh-adapter.mjs</p>
 */
import { createCloud } from './spring-cloud-facade.mjs'

/**
 * 创建一只游戏侧微服务适配器。
 * @param {object} [opts]
 */
export function createGameMeshAdapter(opts = {}) {
  const cloud = opts.cloud ?? createCloud(opts)
  const gameId = opts.gameId ?? 'caesura-game'
  const address = opts.address ?? '127.0.0.1'
  const port = opts.port ?? 5173
  let registered = false

  function self() { return { id: gameId, name: gameId, address, port } }

  async function start() {
    if (cloud.discovery?.register) cloud.discovery.register(self())
    registered = true
    if (cloud.publish) await cloud.publish('caesura.lifecycle', { type: 'game.started', id: gameId })
    return { id: gameId, registered: true }
  }

  async function stop() {
    if (cloud.discovery?.deregister) cloud.discovery.deregister(gameId)
    registered = false
    if (cloud.publish) await cloud.publish('caesura.lifecycle', { type: 'game.stopped', id: gameId })
    return { id: gameId, registered: false }
  }

  async function reportHealth() {
    const health = typeof opts.health === 'function' ? await opts.health() : { status: 'UP' }
    if (cloud.publish) await cloud.publish('caesura.health', { id: gameId, ...health })
    return health
  }

  async function getConfig(key) {
    return cloud.config?.get ? cloud.config.get(key) : undefined
  }

  async function status() {
    return { id: gameId, registered, cloud: await cloud.status() }
  }

  return { start, stop, reportHealth, getConfig, status, self }
}

if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const adapter = createGameMeshAdapter()
  adapter.start().then(() => adapter.status()).then((s) => { console.log(JSON.stringify(s)); process.exit(0) })
    .catch((e) => { console.error(e.message); process.exit(1) })
}
