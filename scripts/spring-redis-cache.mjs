/**
 * scripts/spring-redis-cache.mjs —— Spring Cloud 家族的 Redis 子集实现（Node.js 侧）。
 *
 * <p>它不是第三方 Redis 代理，而是**协议子集** + **进程内 LRU/TTL 缓存**：
 *   - `createCacheInstance`：独立可嵌套的缓存单元（LRU + TTL + maxKeys 上限）
 *   - `createRedisServer`：RESP 行为兼容的网络服务器（单命令单答，不 pipelining）
 *   - `createRedisClient`：RESP 兼容客户端，外部置连 Express / 真实 Redis 都可
 *
 * <p>它学习 Redis 三件事——
 *   1. **RESP 协议**：所有命令都编码/解码成 `SET key value\r\n` 那种 `*N\r\n$L\r\n…` 字节；
 *   2. **LRU + TTL**：maxKeys 满时踢最旧一条；每条记录带 expiresAt，过期即清扫；
 *   3. **键值类型分离**：过期与否在写入时决定、在读取时校验，过期即视为不存在。
 *
 * 用法：
 *   node scripts/spring-redis-cache.mjs serve 6399       # 起服务端（默认 6379）
 *   node scripts/spring-redis-cache.mjs ping              # 连本机 6379 打 PING
 *   node scripts/spring-redis-cache.mjs selfcheck         # 起+连+自检，秒级退出
 *
 * 退出码：0 = OK / 自检通过；1 = 操作失败；2 = 用法错。
 */

import { createServer, connect } from 'node:net'
import {
  parseOne,
  parseCommand,
  buildSimpleString,
  buildError,
  buildInteger,
  buildBulkString,
  buildArray,
} from './redis-protocol-rules.mjs'

// 默认值（生产上可以环境变量覆盖，这里不让零参门）
const DEFAULT_PORT = 6379
const DEFAULT_MAX_KEYS = 256
const DEFAULT_TTL_SEC = 300

/** 创建一个独立的 LRU/TTL 缓存单元（嵌入在 server 里，也可以独立用） */
export function createCacheInstance(opts = {}) {
  const maxKeys = Number.isFinite(opts.maxKeys) ? opts.maxKeys : DEFAULT_MAX_KEYS
  const defaultTtl = Number.isFinite(opts.defaultTtlSec) ? opts.defaultTtlSec : DEFAULT_TTL_SEC
  /** @type {Map<string, { value: string, expiresAt: number }>} */
  const store = new Map()

  /** 每读一次就踢过期的——Redis 是惰性 + 主动采样，我们这里总是清一遍（数据量小够用） */
  function sweepExpired() {
    const now = Date.now()
    for (const [k, v] of store) {
      if (v.expiresAt <= now) store.delete(k)
    }
  }

  /** 把 key 提升到最末位（LRU 策略） */
  function touch(key) {
    const v = store.get(key)
    if (!v) return
    store.delete(key)
    store.set(key, v)
  }

  return {
    get(key) {
      sweepExpired()
      const v = store.get(key)
      if (!v) return null
      touch(key)
      return v.value
    },
    set(key, value, ttlSec = defaultTtl) {
      sweepExpired()
      if (store.size >= maxKeys && !store.has(key)) {
        const oldest = store.keys().next().value
        if (oldest !== undefined) store.delete(oldest)
      }
      // 覆盖已有 key 视为最近使用：先删再插，Map 插入序（即 LRU 序）才不会停在旧位置
      if (store.has(key)) store.delete(key)
      store.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 })
      return 'OK'
    },
    del(key) {
      return store.delete(key) ? 1 : 0
    },
    exists(key) {
      sweepExpired()
      return store.has(key) ? 1 : 0
    },
    keys() {
      sweepExpired()
      return [...store.keys()]
    },
    ttl(key) {
      const v = store.get(key)
      if (!v) return -2
      return Math.max(0, Math.floor((v.expiresAt - Date.now()) / 1000))
    },
    expire(key, sec) {
      const v = store.get(key)
      if (!v) return 0
      v.expiresAt = Date.now() + sec * 1000
      return 1
    },
    flushall() {
      store.clear()
      return 'OK'
    },
    size() {
      sweepExpired()
      return store.size
    },
  }
}

/** RESP 行为：LIST / SHOW 数据量限制，避免大 KEYS 拖死 server */
const KEYS_LIMIT = 1024

/**
 * 模块级命令→回包纯函数：输入内存缓存与一条已解析命令，返回 { reply }。
 * 命令级错误（参数不对、整数非法、未知命令、KEYS 超限）一律回 -ERR **不断连**——
 * 与真实 Redis 一致：pipelining 里一条命令写错不该炸掉整条连接。
 * 连接只在 framing 级错误（对端字节拼不成数组命令）时被对端关闭。
 */
function redisCommandReply(cache, cmd) {
  const [rawOp, ...rawArgs] = cmd.map((a) => String(a))
  const op = (rawOp ?? '').toUpperCase()
  const args = rawArgs
  try {
    switch (op) {
      case 'PING':
        return { reply: buildSimpleString('PONG') }
      case 'SET': {
        if (args.length < 2) return { reply: buildError('wrong number of arguments') }
        return { reply: buildSimpleString(cache.set(args[0], args.slice(1).join(' '))) }
      }
      case 'GET': {
        if (args.length !== 1) return { reply: buildError('wrong number of arguments') }
        const v = cache.get(args[0])
        return { reply: v === null ? '$-1\r\n' : buildBulkString(v) }
      }
      case 'DEL': {
        const n = cache.del(args[0])
        return { reply: buildInteger(n) }
      }
      case 'EXISTS': {
        const n = cache.exists(args[0])
        return { reply: buildInteger(n) }
      }
      case 'KEYS':
        if (cache.size() > KEYS_LIMIT) return { reply: buildError(`KEYS forbidden: ${cache.size()} keys > ${KEYS_LIMIT}`) }
        return { reply: buildArray(cache.keys()) }
      case 'TTL': {
        const n = cache.ttl(args[0])
        return { reply: buildInteger(n) }
      }
      case 'EXPIRE': {
        if (args.length !== 2) return { reply: buildError('wrong number of arguments') }
        const sec = Number(args[1])
        if (!Number.isFinite(sec) || sec < 0) return { reply: buildError('integer expected') }
        return { reply: buildInteger(cache.expire(args[0], sec)) }
      }
      case 'FLUSHALL':
        return { reply: buildSimpleString(cache.flushall()) }
      default:
        return { reply: buildError(`unknown command '${op.toLowerCase()}'`) }
    }
  } catch (e) {
    return { reply: buildError(String((e && e.message) ?? e)) }
  }
}

/** 创建 RESP server：args 数组→case；返回 { server, cache } */
export function createRedisServer(opts = {}) {
  const cache = createCacheInstance(opts)
  const server = createServer((socket) => {
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      buffer += chunk

      // RESP pipelining：一个 TCP 段里可以有多条命令，遂条排干（drain）再逐个回包；
      // parseOne 返回不完整时停止等待下一段字节（不乱猜、不提前回）。
      for (;;) {
        const parsed = parseOne(buffer)
        if (!parsed) break
        const cmd = parsed.value
        buffer = parsed.rest
        if (!Array.isArray(cmd)) {
          socket.end(buildError('protocol: expected array command'))
          return
        }
        const { reply } = redisCommandReply(cache, cmd)
        socket.write(reply)
      }
    })
  })
  return { server, cache }
}

/** 创建兼容 RESP 的客户端。 */
export function createRedisClient(opts = {}) {
  const host = opts.host ?? '127.0.0.1'
  const port = opts.port ?? DEFAULT_PORT
  /** @type {import('node:net').Socket | null} */
  let socket = null
  let buffer = ''
  /** @type {Array<(v: any) => void>} 等待响应的 Promise resolver 队列 */
  const waiters = []

  /** 连接到外部 RESP 服务器（函数名不与 import 重名） */
  async function ensureConnected() {
    socket = connect(port, host)
    await new Promise((resolve, reject) => {
      socket.once('error', reject)
      socket.once('connect', () => {
        socket.off('error', reject)
        resolve()
      })
    })
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      buffer += chunk

      while (buffer.length > 0) {
        const parsed = parseOne(buffer)
        if (!parsed) break
        const resolver = waiters.shift()
        if (resolver) resolver(parsed.value)
        buffer = parsed.rest
      }
    })
  }

  function encodeArray(parts) {
    return '*' + parts.length + '\r\n' + parts.map((p) => {
      const bytes = Buffer.byteLength(String(p), 'utf8')
      return `$${bytes}\r\n${String(p)}\r\n`
    }).join('')
  }

  /** 底层：入队一条应答；解析值原样返回（-ERR 为 { error } 对象），不 reject */
  function rawCall(args) {
    if (!socket) throw new Error('客户端未连接')
    const cmd = encodeArray(args)
    return new Promise((resolve) => {
      waiters.push((v) => resolve(v))
      socket.write(cmd)
    })
  }

  /** 单条命令：遇 -ERR 直接 reject（程序化取值用） */
  async function call(...args) {
    const v = await rawCall(args)
    if (v && typeof v === 'object' && v.error) throw new Error(v.error)
    return v
  }

  return {
    connect: ensureConnected,
    ping: () => call('PING'),
    set: (key, value) => call('SET', key, value),
    get: (key) => call('GET', key),
    del: (key) => call('DEL', key),
    exists: (key) => call('EXISTS', key),
    keys: () => call('KEYS'),
    ttl: (key) => call('TTL', key),
    expire: (key, sec) => call('EXPIRE', key, String(sec)),
    flushall: () => call('FLUSHALL'),
    /**
     * RESP pipelining：一轮 RTT 里发 N 条命令、按 RESP 顺序回收 N 个**解析结果**——
     * -ERR 以 { error } 对象原样返回、不 reject（单条命令的 call() 才会 reject），
     * 让批量调用方逐条核对而不是被整批炸掉。
     */
    pipeline: (cmds) => Promise.all(cmds.map((c) => rawCall(c))),
    quit: () => new Promise((r) => { if (socket) socket.end(() => r()) }),
  }
}

/** CLI 分支：被直接运行时做事；被 import 时只交出函数。 */
if (process.argv[1] && process.argv[1].endsWith('spring-redis-cache.mjs')) {
  const cmd = process.argv[2] ?? 'selfcheck'
  if (cmd === 'serve') {
    const port = Number(process.argv[3] ?? DEFAULT_PORT)
    const { server } = createRedisServer({ maxKeys: 1024, defaultTtlSec: 300 })
    server.listen(port, () => console.log(`[spring-redis-cache] RESP server listening on :${port}`))
  } else if (cmd === 'ping') {
    const port = Number(process.argv[3] ?? DEFAULT_PORT)
    const c = createRedisClient({ port })
    c.connect().then(() => c.ping()).then((r) => { console.log(JSON.stringify(r)); return c.quit() }).then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1) })
  } else if (cmd === 'selfcheck') {
    const { server, cache } = createRedisServer({ maxKeys: 4, defaultTtlSec: 60 })
    server.listen(0, () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      console.log(`[selfcheck] server on :${port}, running sequence…`)
      const c = createRedisClient({ port })
      c.connect().then(() => c.pipeline([['PING'], ['SET', 'k1', 'v1'], ['GET', 'k1']]))
        .then(([p, r, v]) => { console.log(`[selfcheck] pipeline(PING,SET,GET) → ${JSON.stringify([p, r, v])}`) })
        .then(() => c.ttl('k1'))
        .then((n) => { console.log(`[selfcheck] TTL k1 → ${n}`) })
        .then(() => { server.close(); process.exit(0) })
        .catch((e) => { console.error('[selfcheck] FAIL', e); server.close(); process.exit(1) })
    })
  } else {
    console.error('用法：node scripts/spring-redis-cache.mjs serve [port] | ping | selfcheck')
    process.exit(2)
  }
}
