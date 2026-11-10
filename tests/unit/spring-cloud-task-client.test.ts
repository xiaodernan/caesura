import { describe, expect, it, vi } from 'vitest'
import { createTaskClient } from '../../scripts/spring-cloud-task-client.mjs'

/**
 * Spring Cloud Task 任务执行客户端单元测试（headless 可证，mock fetch）。
 */
describe('spring-cloud-task-client', () => {
  it('launchTask 记录执行并返回 RUNNING', async () => {
    const c = createTaskClient()
    const e = await c.launchTask({ name: 'etl', params: { x: 1 } })
    expect(e.status).toBe('RUNNING')
    expect(e.name).toBe('etl')
    expect(e.endTime).toBeNull()
  })

  it('listExecutions 返回全部', async () => {
    const c = createTaskClient()
    await c.launchTask({ name: 'a' })
    await c.launchTask({ name: 'b' })
    expect((await c.listExecutions()).length).toBe(2)
  })

  it('getExecution 取回指定执行', async () => {
    const c = createTaskClient()
    const e = await c.launchTask({ name: 'a' })
    const got = await c.getExecution(e.id)
    expect(got.id).toBe(e.id)
  })

  it('getExecution 未知 id 抛错', async () => {
    const c = createTaskClient()
    await expect(c.getExecution('nope')).rejects.toThrow()
  })

  it('complete 标记完成', async () => {
    const c = createTaskClient()
    const e = await c.launchTask({ name: 'a' })
    const done = await c.complete(e.id, 'COMPLETED')
    expect(done.status).toBe('COMPLETED')
    expect(done.endTime).not.toBeNull()
  })

  it('executorUrl 真路径走 HTTP POST', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' } as Response)
    const c = createTaskClient({ executorUrl: 'http://exec:9000', fetch: fetchImpl })
    await c.launchTask({ name: 'a' })
    expect((fetchImpl.mock.calls[0][0] as string)).toContain('/tasks')
  })

  it('task 无 name 抛错', async () => {
    const c = createTaskClient()
    await expect(c.launchTask({} as any)).rejects.toThrow()
  })
})
