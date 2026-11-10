/** `scripts/spring-cloud-task-client.mjs` 的声明：Spring Cloud Task 任务执行客户端（Node.js 侧）。 */

/** 创建一个 Task 客户端。 */
export function createTaskClient(opts?: { executorUrl?: string; fetch?: typeof fetch }): {
  launchTask(def: { name: string; id?: string; params?: any }): Promise<{ id: string; name: string; params: any; status: string; startTime: number; endTime: number | null }>
  getExecution(id: string): Promise<any>
  listExecutions(): Promise<any[]>
  complete(id: string, status?: string): Promise<any>
}
