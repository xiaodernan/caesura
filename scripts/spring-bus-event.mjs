/**
 * scripts/spring-bus-event.mjs —— Spring Cloud Bus 事件总线（Node.js 侧）。
 *
 * <p>它不做判断，只做**事件发布/订阅**：模拟 Spring Cloud Bus 的事件分发机制，
 * 让配置服务器、配置客户端等组件在配置变更时通过总线互相通知。
 * 所有业务阈值与判定仍由 Node 侧负责；Spring 家族只负责编排/报告。
 *
 * **与 spring-bus-client 的区别**：bus-client 是 HTTP 客户端，向远程 /actuator/bus-refresh
 * 发送刷新请求；bus-event 是本地事件总线，进程内发布/订阅，无需 HTTP。
 *
 * 用法：
 *   import { createBus } from './scripts/spring-bus-event.mjs'
 *   const bus = createBus()
 *   bus.subscribe('config.changed', (appName, config) => { ... })
 *   bus.publish('config.changed', 'caesura-gate', { server: { port: 8081 } })
 */

import { EventEmitter } from 'node:events'

/** 创建 Spring Cloud Bus 事件总线实例。 */
export function createBus() {
  const emitter = new EventEmitter()
  // 避免 EventEmitter 默认的 10 个监听器限制产生警告
  emitter.setMaxListeners(100)

  /**
   * 订阅总线事件。
   *
   * @param {string} eventName 事件名（如 'config.changed'、'config.refreshed'、'service.registered'）
   * @param {function} listener 监听器 (...args) => void
   * @returns {function} 取消订阅函数
   */
  function subscribe(eventName, listener) {
    emitter.on(eventName, listener)
    return () => {
      emitter.off(eventName, listener)
    }
  }

  /**
   * 发布总线事件（同步，所有监听器按顺序调用）。
   *
   * @param {string} eventName 事件名
   * @param {...any} args 事件参数
   * @returns {boolean} 是否有监听器监听该事件
   */
  function publish(eventName, ...args) {
    return emitter.emit(eventName, ...args)
  }

  /**
   * 异步发布总线事件（不等待监听器，fire-and-forget）。
   *
   * @param {string} eventName 事件名
   * @param {...any} args 事件参数
   */
  function publishAsync(eventName, ...args) {
    setImmediate(() => {
      emitter.emit(eventName, ...args)
    })
  }

  /**
   * 获取指定事件的监听器数量。
   *
   * @param {string} eventName 事件名
   * @returns {number} 监听器数量
   */
  function listenerCount(eventName) {
    return emitter.listenerCount(eventName)
  }

  /**
   * 获取所有已注册的事件名。
   *
   * @returns {string[]} 事件名列表
   */
  function eventNames() {
    return emitter.eventNames()
  }

  /**
   * 移除所有监听器（可选按事件名过滤）。
   *
   * @param {string} [eventName] 事件名，不指定则移除所有
   */
  function removeAllListeners(eventName) {
    if (eventName) {
      emitter.removeAllListeners(eventName)
    } else {
      emitter.removeAllListeners()
    }
  }

  /**
   * 关闭总线，移除所有监听器。
   */
  function close() {
    emitter.removeAllListeners()
  }

  return {
    subscribe,
    publish,
    publishAsync,
    listenerCount,
    eventNames,
    removeAllListeners,
    close,
  }
}

/** 默认总线实例（供简单场景直接 import 使用） */
export const defaultBus = createBus()

// 默认导出
export default { createBus, defaultBus }
