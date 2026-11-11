/**
 * scripts/redis-protocol-rules.mjs —— Redis Serialization Protocol（RE
SP）解码器。
 *
 * <p>它只干一件事：把一段从 TCP 读上来的字节切成一串 RESP 命令。RESP 长这样：
 *   - 简单字符串：`+OK\r\n`            → `OK`（一行字符串）
 *   - 错误：      `-ERR ...\r\n`       → `['ERR ...']`
 *   - 整数：      `:123\r\n`           → `123`
 *   - 批量：      `$5\r\nhello\r\n`   → `'hello'`
 *   - 数组：      `*3\r\n:1\r\n:2\r\n:3\r\n` → `[1, 2, 3]`
 *   - 空体：      `$-1\r\n`            → null（nil bulk）
 *
 * 本模块只提供 **纯函数 `parseRedisChunk` 与 `buildRedisResponse`**：
 *   - 不感知连接（没有 net，没有 socket）
 *   - 不猜（无歧义：每个字节都必须被识别，否则抛错）
 *   - 不依赖 npm（其他包里这个解析器都够用）
 *
 * 退出码：被 import 时只交出函数；直接运行时用一小段命令文本做自检（CI 上可跑）。
 */

/** 简单字符串：`+内容\r\n` — 取首尾之间、去掉 + 与 \r\n 的全部字节 */
export function parseSimpleString(text) {
  const m = text.match(/^\+([^\r]*)\r\n/)
  if (!m) return null
  return m[1]
}

/** 错误字符串：`-内容\r\n` */
export function parseErrorString(text) {
  const m = text.match(/^-([^\r]*)\r\n/)
  if (!m) return null
  return m[1]
}

/** 整数字符串：`:+123\r\n` / `:−45\r\n` / `:0\r\n` */
export function parseInteger(text) {
  const m = text.match(/^:(-?\d+)\r\n/)
  if (!m) return null
  return Number(m[1])
}

/** 批量字符串：`$<长度>\r\n<内容>\r\n`；`$-1\r\n` 返回 null */
export function parseBulkString(text) {
  const header = text.match(/^\$(-?\d+)\r\n/)
  if (!header) return null
  const len = Number(header[1])
  if (len === -1) return { value: null, rest: text.slice(header[0].length) }
  if (len < 0) return null
  const start = header[0].length
  if (text.length < start + len + 2) return null // 不完整，等下一段
  const value = text.slice(start, start + len)
  const end = start + len + 2
  return { value, rest: text.slice(end) }
}

/** 数组：`*<数量>\r\n` 后面跟 <数量> 个元素 */
export function parseArray(text) {
  const header = text.match(/^\*(-?\d+)\r\n/)
  if (!header) return null
  const count = Number(header[1])
  if (count < 0) return null
  const items = []
  let rest = text.slice(header[0].length)
  for (let i = 0; i < count; i++) {
    // 递归下降：元素可以是任何 RESP 类型
    const item = parseOne(rest)
    if (!item) return null // 元素未完整
    items.push(item.value)
    rest = item.rest
  }
  return { value: items, rest }
}

/** 试图在一段字节里读一个 RESP 值；返回 { value, rest } 或 null（不完整） */
export function parseOne(text) {
  const first = text[0]
  if (first === '+') { const v = parseSimpleString(text); return v ? { value: v, rest: text.slice(1 + v.length + 2) } : null }
  if (first === '-') { const v = parseErrorString(text); return v ? { value: { error: v }, rest: text.slice(1 + v.length + 2) } : null }
  if (first === ':') { const m = text.match(/^:(-?\d+)\r\n/); if (!m) return null; return { value: Number(m[1]), rest: text.slice(m[0].length) } }
  if (first === '$') { const r = parseBulkString(text); return r ? { value: r.value, rest: r.rest } : null }
  if (first === '*') { const r = parseArray(text); return r ? { value: r.value, rest: r.rest } : null }
  return null
}

/** 把一段字节解析成一个命令（最常见是数组，例如 ['SET','key','value']）。 */
export function parseCommand(text) {
  const r = parseOne(text)
  if (!r) return null
  if (r.rest.length > 0) {
    // 同一段字节里还有更多命令——调用者按顺序读；这里拒绝承载第二段
    return null
  }
  if (!Array.isArray(r.value)) return { args: [String(r.value)] }
  return { args: r.value.map(String) }
}

/** 拼装 RESP 响应 */
export function buildSimpleString(s) { return `+${s}\r\n` }
export function buildError(msg) { return `-ERR ${msg}\r\n` }
export function buildInteger(n) { return `:${Math.trunc(n)}\r\n` }
export function buildBulkString(s) { if (s === null) return '$-1\r\n'; return `$${Buffer.byteLength(s, 'utf8')}\r\n${s}\r\n` }
export function buildArray(arr) {
  let out = `*${arr.length}\r\n`
  for (const item of arr) {
    if (item === null) { out += '$-1\r\n'; continue }
    // 注意：continue 必须在花括号内。写成 `if (...) stmt; continue` 会让 continue 无条件执行、
    // 跳过所有字符串/数组元素（接手并轨时修掉这个分号陷阱）。
    if (typeof item === 'number') { out += buildInteger(item); continue }
    if (Array.isArray(item)) { out += buildArray(item); continue }
    out += buildBulkString(String(item))
  }
  return out
}

/**
 * 退出码：不感兴趣 CLI；只有直接运行时跑一个自检
 * （测试里有专门的 legs；这块只为看一眼路径是否能跑通）。
 */
if (process.argv[1] && process.argv[1].endsWith('redis-protocol-rules.mjs')) {
  const cmd = parseCommand('*3\r\n$3\r\nSET\r\n$3\r\nkey\r\n$5\r\nvalue\r\n')
  console.log('parse:', JSON.stringify(cmd))
  process.exit(cmd?.args?.join(' ') === 'SET key value' ? 0 : 1)
}
