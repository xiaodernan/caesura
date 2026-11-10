/**
 * scripts/spring-cloud-task-client.mjs —— Spring Cloud Task 任务执行客户端（Node.js 侧）。
 *
 * <p>把「一次性短任务」收口成 launch / get / list / complete，对齐 Spring Cloud Task 的语义。
 * 默认走内存实现（测试/单机）；传入 `executorUrl` 时退化为调用真实 task executor 的 HTTP 端点。
 * 判定权仍在 Node 侧：本门只负责把任务跑起来并跟踪其执行状态。</p>
 *
 * <p>用法（CLI 仅作探针）：node scripts/spring-cloud-task-client.mjs [name] [json-params]</p>
 */

/**
 * 创建一个 Task 客户端。
 * @param {{ executorUrl?: string, fetch?: typeof fetch }} [opts]
 */
export function createTaskClient(opts = {}) {
  const fetchImpl = opts.fetch ?? globalThis.fetch
  const executorUrl = opts.executorUrl ?? null
  const store = new Map()
  let seq = 0
  const now = () => Date.now()

  async function launchTask(def) {
    if (!def || !def.name) throw new Error('task 需含 name')
    const id = def.id ?? `task-${++seq}`
    const execution = {
      id,
      name: def.name,
      params: def.params ?? {},
      status: 'RUNNING',
      startTime: now(),
      endTime: null,
    }
    if (executorUrl) {
      const res = await fetchImpl(`${executorUrl.replace(/\/$/, '')}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(def),
      })
      if (!res.ok) throw new Error(`task executor 启动失败: ${res.status}`)
    }
    store.set(id, execution)
    return execution
  }

  async function getExecution(id) {
    const e = store.get(id)
    if (!e) throw new Error(`找不到 task 执行 ${id}`)
    return e
  }

  async function listExecutions() { return [...store.values()] }

  async function complete(id, status = 'COMPLETED') {
    const e = store.get(id)
    if (e) { e.status = status; e.endTime = now() }
    return e
  }

  return { launchTask, getExecution, listExecutions, complete }
}

if (process.argv[1] && new URL(process.argv[1], 'file://').pathname === new URL(import.meta.url).pathname) {
  const c = createTaskClient()
  const name = process.argv[2] ?? 'probe-task'
  let params = {}
  if (process.argv[3]) { try { params = JSON.parse(process.argv[3]) } catch { params = { raw: process.argv[3] } } }
  c.launchTask({ name, params }).then((e) => { console.log(JSON.stringify(e)); process.exit(0) })
    .catch((e) => { console.error(e.message); process.exit(1) })
}
