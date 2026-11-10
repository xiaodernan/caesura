/**
 * scripts/spring-cloud-contract-client.mjs —— Spring Cloud Contract 消费者驱动契约桩客户端（Node.js 侧）。
 *
 * <p>把「一份契约 = 一个期望的请求/响应形状」收口成 stub runner：给定契约集合，`serve(request)`
 * 返回命中的契约应给的罐头响应；`verify` 拿真实提供方的实际响应逐条对账，给出哪条契约被满足。
 * 判定权仍在 Node 侧：本门只做契约匹配与对账，不写任何业务阈值。</p>
 *
 * <p>用法（CLI 仅作探针）：node scripts/spring-cloud-contract-client.mjs [json-request]</p>
 */

/**
 * 创建一个契约桩运行器。
 * @param {object} [opts]
 */
export function createContractRunner(opts = {}) {
  const contracts = []

  function addContract(c) {
    if (!c || !c.name || !c.request || !c.response) throw new Error('contract 需含 name/request/response')
    contracts.push(c)
    return c.name
  }

  function match(contract, req) {
    const r = contract.request
    if (r.method && (req.method ?? 'GET').toUpperCase() !== r.method.toUpperCase()) return false
    if (r.path && req.path !== r.path) return false
    return true
  }

  function serve(req) {
    const hit = contracts.find((c) => match(c, req))
    if (!hit) return { status: 404, body: { error: 'no contract' } }
    return { status: hit.response.status ?? 200, body: hit.response.body ?? null }
  }

  function verify(contractsList, actuals) {
    return contractsList.map((c) => {
      const ok = (actuals ?? []).some(
        (a) => match(c, a.request) && (c.response.status ?? 200) === (a.response.status ?? 200),
      )
      return { name: c.name, satisfied: ok }
    })
  }

  return { addContract, match, serve, verify, list: () => contracts.slice() }
}

if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const runner = createContractRunner()
  runner.addContract({ name: 'getHealth', request: { method: 'GET', path: '/health' }, response: { status: 200, body: { status: 'UP' } } })
  let req = { method: 'GET', path: '/health' }
  if (process.argv[2]) { try { req = JSON.parse(process.argv[2]) } catch { req = { method: 'GET', path: process.argv[2] } } }
  console.log(JSON.stringify(runner.serve(req)))
  process.exit(0)
}
