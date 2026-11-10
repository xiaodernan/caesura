/**
 * scripts/caesura-game-bootstrap.mjs —— 游戏生命周期 ↔ 云入口 的桥接件（集大成最后一厘米，留在 scripts/ 侧）。
 *
 * <p>前面 KI-478 的 `createGameCloud` 已是「游戏一行拉起一朵云」。本件把云入口接到游戏真实生命周期上：
 * 游戏开机即注册进 mesh、关机即注销。为避免直接改游戏 src/ 启动流程（那一侧不归本沙箱的严格门管辖），
 * 这里只交付一个**桥接件**——游戏侧只需 `bridge.install(game)`（或手动 `bridge.start()/stop()`）即可。
 * 支持 event-emitter 风格（`game.on(event, fn)`）或 `game.lifecycle.on(...)` 两种常见钩子形状；事件名可由 opts 适配，
 * 无需改本件即可对上真实游戏的事件名。判词仍由 Node 侧持有（决策原则①）。</p>
 */
import { createGameCloud } from './caesura-game-cloud.mjs'

/**
 * 创建一只「游戏生命周期 ↔ 云入口」桥。
 * @param {object} [opts] 透传给 createGameCloud 的全部选项 + { bootEvents?, shutdownEvents? }
 */
export function createGameCloudBridge(opts = {}) {
  const bootEvents = opts.bootEvents ?? ['boot', 'ready', 'start']
  const shutdownEvents = opts.shutdownEvents ?? ['dispose', 'shutdown', 'stop']

  const gc = createGameCloud(opts)

  const onBoot = () => gc.start()
  const onShutdown = () => gc.shutdown()

  /** 把云入口挂到游戏生命周期上。 */
  function install(game) {
    if (!game || typeof game !== 'object') {
      return { installed: false, handlers: { onBoot, onShutdown } }
    }
    let installed = false
    const target = (typeof game.on === 'function') ? game : (game.lifecycle ?? null)
    if (target && typeof target.on === 'function') {
      for (const e of bootEvents) target.on(e, onBoot)
      for (const e of shutdownEvents) target.on(e, onShutdown)
      installed = true
    }
    return { installed, handlers: { onBoot, onShutdown } }
  }

  return {
    gc,
    onBoot,
    onShutdown,
    install,
    start: () => gc.start(),
    stop: () => gc.shutdown(),
    status: () => gc.status(),
  }
}
