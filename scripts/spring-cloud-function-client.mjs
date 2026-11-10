/**
 * scripts/spring-cloud-function-client.mjs —— Spring Cloud Function 函数路由客户端（Node.js 侧）。
 *
 * <p>把「一个函数名 = 一段处理逻辑」收口成注册表 + 路由器，对齐 Spring Cloud Function 的
 * 声明式函数即服务（FaaS）语义。支持按名路由、列出、注销；路由失败交给 `onError`。</p>
 *
 * <p>用法（CLI 仅作探针）：node scripts/spring-cloud-function-client.mjs [name] [json-payload]</p>
 */

/**
 * 创建一个函数路由器。
 * @param {{ onError?: (err: Error) => void }} [opts]
 */
export function createFunctionRouter(opts = {}) {
  const onError = typeof opts.onError === 'function' ? opts.onError : null
  const fns = new Map()

  function register(name, fn) {
    if (typeof name !== 'string' || !name) throw new Error('function 名必填')
    if (typeof fn !== 'function') throw new Error('function 体必填')
    fns.set(name, fn)
    return name
  }

  async function route(name, payload) {
    const fn = fns.get(name)
    if (!fn) {
      const err = new Error(`未注册的函数 ${name}`)
      if (onError) onError(err)
      throw err
    }
    return fn(payload)
  }

  function list() { return [...fns.keys()] }
  function unregister(name) { return fns.delete(name) }

  return { register, route, list, unregister }
}

if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const r = createFunctionRouter()
  r.register('echo', (p) => ({ echo: p }))
  const name = process.argv[2] ?? 'echo'
  let payload = {}
  if (process.argv[3]) { try { payload = JSON.parse(process.argv[3]) } catch { payload = { raw: process.argv[3] } } }
  r.route(name, payload).then((out) => { console.log(JSON.stringify(out)); process.exit(0) })
    .catch((e) => { console.error(e.message); process.exit(1) })
}
