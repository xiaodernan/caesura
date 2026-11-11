import { describe, expect, it, afterEach } from 'vitest'
import {
  createCacheInstance,
  createRedisServer,
  createRedisClient,
} from '../../scripts/spring-redis-cache.mjs'
import {
  parseOne,
  parseCommand,
  buildSimpleString,
  buildError,
  buildInteger,
  buildBulkString,
  buildArray,
} from '../../scripts/redis-protocol-rules.mjs'

/**
 * spring-redis-cache + redis-protocol-rules 单元测试。
 *
 * headless 可证：协议编解码 + 进程内 LRU/TTL 缓存；启动真 TCP server 只在 e2e 那一腿。h 导出的
 * createCacheInstance 是纯内存对象——任何一腿都能独立跑。
 */

const servers: import('node:net').Server[] = []
afterEach(() => {
  for (const s of servers.splice(0)) s.close()
})

describe('redis-protocol-rules：RESP 协议编解码', () => {
  it('parseCommand：*3 SET key value', () => {
    const cmd = parseCommand('*3\r\n$3\r\nSET\r\n$3\r\nkey\r\n$5\r\nvalue\r\n')
    expect(cmd?.args).toEqual(['SET', 'key', 'value'])
  })

  it('parseCommand：-ERR 解析成 { error }', () => {
    const cmd = parseCommand('*1\r\n$3\r\nERR\r\n')
    expect(cmd?.args).toEqual(['ERR'])
  })

  it('buildArray：空数组', () => {
    expect(buildArray([])).toBe('*0\r\n')
  })

  it('buildArray：包含整数、字符串、null', () => {
    const r = buildArray(['hello', 42, null])
    expect(r).toBe('*3\r\n$5\r\nhello\r\n:42\r\n$-1\r\n')
  })

  it('buildBulkString / buildInteger / buildSimpleString / buildError', () => {
    expect(buildBulkString('hi')).toBe('$2\r\nhi\r\n')
    expect(buildBulkString(null as any)).toBe('$-1\r\n')
    expect(buildInteger(-7)).toBe(':-7\r\n')
    expect(buildSimpleString('PONG')).toBe('+PONG\r\n')
    expect(buildError('bad command')).toBe('-ERR bad command\r\n')
  })

  it('parseOne：不完整数据返回 null（等下一段）', () => {
    expect(parseOne('*2\r\n$3\r\nGET\r\n')).toBeNull()
  })

  it('buildArray：字符串项不得被跳过（接手并轨修掉分号陷阱：continue 必须锁在花括号内）', () => {
    // 回归：旧实现 `if (typeof item === 'number') out += ...; continue` 让 continue 无条件执行，
    // 字符串/数组项全被吞。这里把字符串、整数、null、嵌套数组一起编码，逐字节核对。
    expect(buildArray(['hello'])).toBe('*1\r\n$5\r\nhello\r\n')
    expect(buildArray(['hello', 42, null])).toBe('*3\r\n$5\r\nhello\r\n:42\r\n$-1\r\n')
    expect(buildArray(['a', ['b', 1]])).toBe('*2\r\n$1\r\na\r\n*2\r\n$1\r\nb\r\n:1\r\n')
  })

  it('parseOne：简单字符串 +OK 的 rest 恰好落在下一段起点（接手并轨修掉 off-by-one）', () => {
    // 回归：旧实现 slice(2 + v.length + 2) 从 6 开始，把下一命令首字节 '*' 吞掉。
    const r = parseOne('+OK\r\n*1\r\n$3\r\nGET\r\n')!
    expect(r.value).toBe('OK')
    expect(r.rest).toBe('*1\r\n$3\r\nGET\r\n') // 第二段完整保留
    expect(parseCommand(r.rest)?.args).toEqual(['GET'])
  })
})

describe('createCacheInstance：LRU/TTL 语义', () => {
  it('set/get 常规路径', () => {
    const c = createCacheInstance({ maxKeys: 8, defaultTtlSec: 60 })
    c.set('a', 'apple')
    expect(c.get('a')).toBe('apple')
  })

  it('过期即不可见（TTL 0）', async () => {
    const c = createCacheInstance({ maxKeys: 8, defaultTtlSec: 1 })
    c.set('x', 'val', 0) // 0 秒即过期
    await new Promise((r) => setTimeout(r, 20))
    expect(c.get('x')).toBeNull()
  })

  it('LRU 满时踢最旧一条', () => {
    const c = createCacheInstance({ maxKeys: 2, defaultTtlSec: 60 })
    c.set('a', '1')
    c.set('b', '2')
    c.set('c', '3') // 这时 a 该被踢
    expect(c.get('a')).toBeNull()
    expect(c.get('b')).toBe('2')
    expect(c.get('c')).toBe('3')
  })

  it('覆盖已有 key 视为最近使用（set 覆盖刷新 LRU 位置，不误伤热键）', () => {
    const c = createCacheInstance({ maxKeys: 2, defaultTtlSec: 60 })
    c.set('a', '1')
    c.set('b', '2')
    c.set('a', '1b') // a 覆盖写 ⇒ a 变最近使用；下一个淘汰目标应为 b
    c.set('c', '3') // 满 2 键，踢最旧的 b
    expect(c.get('b')).toBeNull()
    expect(c.get('a')).toBe('1b')
    expect(c.get('c')).toBe('3')
  })

  it('EXPIRE 改写有效期', async () => {
    const c = createCacheInstance({ maxKeys: 8, defaultTtlSec: 1 })
    c.set('x', 'v', 10)
    c.expire('x', 0) // 缩短到 0s
    await new Promise((r) => setTimeout(r, 20))
    expect(c.get('x')).toBeNull()
  })

  it('DEL / EXISTS / FLUSHALL', () => {
    const c = createCacheInstance({ maxKeys: 8, defaultTtlSec: 60 })
    c.set('x', 'v')
    expect(c.exists('x')).toBe(1)
    expect(c.del('x')).toBe(1)
    expect(c.exists('x')).toBe(0)
    c.set('y', 'v')
    c.flushall()
    expect(c.size()).toBe(0)
  })
})

describe('spring-redis-cache：端到端 PING/SET/GET/DEL via RESP', () => {
  it('启动服务端 → 客户端 PING/SET/GET 往返', async () => {
    const { server } = createRedisServer({ maxKeys: 8, defaultTtlSec: 60 })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const addr = server.address() as { port: number }

    const c = createRedisClient({ port: addr.port })
    await c.connect()
    expect(await c.ping()).toBe('PONG')
    expect(await c.set('key', 'value')).toBe('OK')
    expect(await c.get('key')).toBe('value')
    expect(await c.del('key')).toBe(1)
    expect(await c.get('key')).toBeNull()
    await c.quit()
  })

  it('EXPIRE + GET 往返：过期读到 nil', async () => {
    const { server } = createRedisServer({ maxKeys: 8, defaultTtlSec: 1 })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const addr = server.address() as { port: number }

    const c = createRedisClient({ port: addr.port })
    await c.connect()
    await c.set('k', 'v')
    await c.expire('k', 0)
    await new Promise((r) => setTimeout(r, 50))
    expect(await c.get('k')).toBeNull()
    await c.quit()
  })

  it('LRU 满时服务端踢最旧一条（客户端经过 RESP 看得到 nil）', async () => {
    const { server } = createRedisServer({ maxKeys: 2, defaultTtlSec: 60 })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const addr = server.address() as { port: number }

    const c = createRedisClient({ port: addr.port })
    await c.connect()
    await c.set('a', '1')
    await c.set('b', '2')
    await c.set('c', '3')
    expect(await c.get('a')).toBeNull()
    expect(await c.get('b')).toBe('2')
    expect(await c.get('c')).toBe('3')
    await c.quit()
  })

  it('RESP pipelining：服务端须在同一 TCP 段内排干多条命令（历史缺陷：第二条起永不回复）', async () => {
    const { server } = createRedisServer({ maxKeys: 8, defaultTtlSec: 60 })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const addr = server.address() as { port: number }

    const c = createRedisClient({ port: addr.port })
    await c.connect()
    // 一轮 pipeline：PING + SET + GET + DEL + EXISTS 五条命令一次发出
    const out = (await c.pipeline([
      ['PING'],
      ['SET', 'pk', 'pv'],
      ['GET', 'pk'],
      ['DEL', 'pk'],
      ['EXISTS', 'pk'],
    ])) as unknown[]
    expect(out).toEqual(['PONG', 'OK', 'pv', 1, 0])
    await c.quit()
  })

  it('pipeline：空批返回 []，不写任何字节也不卡连接', async () => {
    const { server } = createRedisServer({ maxKeys: 8, defaultTtlSec: 60 })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const addr = server.address() as { port: number }
    const c = createRedisClient({ port: addr.port })
    await c.connect()
    expect(await c.pipeline([])).toEqual([])
    expect(await c.ping()).toBe('PONG')
    await c.quit()
  })

  it('pipeline：坏参数 mid-batch —— 服务端回 -ERR 但连接不瘫（致命错误除外）', async () => {
    const { server } = createRedisServer({ maxKeys: 8, defaultTtlSec: 60 })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const addr = server.address() as { port: number }
    const c = createRedisClient({ port: addr.port })
    await c.connect()
    // EXPIRE 传非整数 → 该条回 -ERR（以 { error } 原样返回、不 reject），连接保持健康，后续命令正常排干
    const [pong, err] = (await c.pipeline([
      ['PING'],
      ['EXPIRE', 'k', 'not-a-number'],
    ])) as unknown[]
    expect(pong).toBe('PONG')
    expect(err).toEqual({ error: 'ERR integer expected' })
    expect(await c.ping()).toBe('PONG')
    await c.quit()
  })

  it('pipeline：尾部半包命令延迟 flush —— 两条命令拆成两段仍全部回包（TCP 分片安全）', async () => {
    const { server } = createRedisServer({ maxKeys: 8, defaultTtlSec: 60 })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const addr = server.address() as { port: number }
    const c = createRedisClient({ port: addr.port })
    await c.connect()
    // 直接往裸 socket 写：第一条命令完整、第二条命令跨两段字节
    const net = await import('node:net')
    const replies: string[] = []
    await new Promise<void>((resolve, reject) => {
      const raw = net.connect(addr.port, '127.0.0.1', () => {
        const part = '*1\r\n$4\r\nPING\r\n*1\r\n$4\r\n'
        raw.write(part)
        setTimeout(() => {
          raw.write('PING\r\n')
        }, 30)
      })
      raw.setEncoding('utf8')
      raw.on('data', (chunk: string) => {
        replies.push(chunk)
        if (replies.join('').match(/PONG/g)?.length === 2) { raw.end(); resolve() }
      })
      raw.on('error', reject)
      setTimeout(() => { raw.end(); reject(new Error('timeout waiting for both PONGs')) }, 10000)
    })
    expect(replies.join('').match(/PONG/g)?.length).toBe(2)
    await c.quit()
  })
})
