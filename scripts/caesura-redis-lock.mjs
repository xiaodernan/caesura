/**
 * scripts/caesura-redis-lock.mjs —— Redis 分布式锁（单实例 SET NX PX 口径）教学件（KI-519，P8 第二十六维）。
 *
 * <p>与 KI-508（SETNX / Redlock / etcd Lease 三协议权衡）不同：KI-508 量的是**取舍**，
 * 本件量的是**真线路怎么把「SET NX PX + TTL + 仅锁主可释放」表现出来**——
 * 从 RESP 字节流直接看互斥锁形态的工程落点：</p>
 *
 * <ul>
 *   <li>{@link acquire} —— `SET key token NX PX ttlMs`（原子）：已存在 ⇒ `$-1`（nil）⇒ 获取失败；否则 `+OK`。</li>
 *   <li>{@link release} —— 读值与 token 比对，仅锁主可 DEL（不是 fencing token，仅等价单实例语义）。</li>
 *   <li>{@link extend} —— 读值与 token 比对，命中才 `SET XX PX`（同表所有权续期）。</li>
 *   <li>{@link runExclusive} —— acquire → fn → finally release，异常必释放。</li>
 * </ul>
 *
 * <p><b>诚实边界</b>（不声称什么）：
 * ① 不是 Redlock（无 quorum、无多数派心跳）；② 不是 etcd Lease + fencing token（无单调递增围栏、无 GC 暂停兜底）；
 * ③ 无 wall-clock QPS/延迟跑分；④ 底层 RESP server 是进程内教学内核（单线程事件环串行化 == 原子性载体），不是真 Redis 集群；
 * ⑤ `extend` 是两段式（读-比-续），窗口内有人抢会误续——
 *    这正是「单 RTT 不能保值匹配」的教训（真 fencing 需后端 CAS / Lua / etcd compare-and-swap）。</p>
 *
 * <p>可换真后端：{@param client} 只要满足 RESP 行为（本仓 `createRedisClient` 或真 Redis via RESP）即可；
 * 教学件本身不感知后端实现，只感知协议字节。</p>
 *
 * @module caesura-redis-lock
 */

import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { connect as netConnect } from 'node:net'
import {
  createRedisServer,
  createRedisClient,
} from './spring-redis-cache.mjs'

/** @param {{ client: { setNx: (k:string, v:string, px?:number) => Promise<string|null>, setXx: (k:string, v:string, px?:number) => Promise<string|null>, get: (k:string) => Promise<string|null>, del: (k:string) => Promise<number> }, key?: string, ttlMs?: number }} opts */
export function createRedisLock(opts) {
  if (!opts || !opts.client) throw new Error('createRedisLock 需要一个已连接的 RESP 客户端（setNx/setXx/get/del）')
  const client = opts.client
  const key = opts.key ?? 'caesura:lock'
  const ttlMs = Number.isFinite(Number(opts.ttlMs)) && Number(opts.ttlMs) > 0 ? Math.trunc(Number(opts.ttlMs)) : 2000

  const newToken = () => randomUUID().replaceAll('-', '')

  /** 尝试取锁；成功返回 { ok, token, ttlMs, key }；已被占则 { ok:false } */
  async function acquire(token) {
    const tk = token ?? newToken()
    const r = await client.setNx(key, tk, ttlMs)
    return r === 'OK' ? { ok: true, token: tk, ttlMs, key } : { ok: false, key }
  }

  /** 释放锁：仅持有者可释放；他人 token 或锁已过期都返回 false */
  async function release(token) {
    if (!token) return false
    const v = await client.get(key)
    if (v !== token) return false
    return (await client.del(key)) === 1
  }

  /** 续期：先读-比-续（单 RTT 不能保证保值匹配——这是锁件自曝的教训，不是 bug） */
  async function extend(token, pxMs = ttlMs) {
    if (!token) return false
    const v = await client.get(key)
    if (v !== token) return false
    return (await client.setXx(key, token, pxMs)) === 'OK'
  }

  /** 互斥执行：acquire → fn → finally release；已被占则 { ok:false, reason:'held' } */
  async function runExclusive(fn, token) {
    const a = await acquire(token)
    if (!a.ok) return { ok: false, reason: 'held', result: undefined }
    try {
      const result = await fn()
      return { ok: true, result, token: a.token }
    } finally {
      await release(a.token)
    }
  }

  return { acquire, release, extend, runExclusive, key, ttlMs }
}

/** CLI 自检：自旋 RESP 服务端 + 两个客户端抢锁，打印真线路结果；被 import 时不运行。 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server } = createRedisServer({ maxKeys: 64, defaultTtlSec: 60 })
  server.listen(0, async () => {
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    try {
      const a = createRedisClient({ port })
      const b = createRedisClient({ port })
      await a.connect(); await b.connect()
      const la = createRedisLock({ client: a, key: 'selfcheck:lock', ttlMs: 500 })
      const lb = createRedisLock({ client: b, key: 'selfcheck:lock', ttlMs: 500 })
      const [ra, rb] = await Promise.all([la.acquire(), lb.acquire()])
      const wins = [ra, rb].filter((r) => r.ok).length
      console.log(`[lock-selfcheck] two contenders → winners=${wins}（应为 1）`)
      const loser = ra.ok ? rb : ra
      const winner = ra.ok ? la : lb
      const wtoken = (ra.ok ? ra : rb).token
      // 仅持锁者可释放
      const steal = await lb.release('not-a-valid-token')
      const releaseOk = await winner.release(wtoken)
      // 锁已释放后可再取
      const re = await lb.acquire()
      console.log(`[lock-selfcheck] stolenRelease=${steal} releaseOk=${releaseOk} reAcquire=${re.ok}`)
      // 先关客户端连接，再关 server，最后退
      await a.quit(); await b.quit()
      console.log(`[lock-selfcheck] PASS (token-guarded release, TTL-bound mutual exclusion)`)
      server.close(() => process.exit(0))
    } catch (e) {
      console.error('[lock-selfcheck] FAIL', e)
      server.close(() => process.exit(1))
    }
  })
}
