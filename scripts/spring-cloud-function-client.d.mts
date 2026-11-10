/** `scripts/spring-cloud-function-client.mjs` 的声明：Spring Cloud Function 函数路由客户端（Node.js 侧）。 */

/** 创建一个函数路由器。 */
export function createFunctionRouter(opts?: { onError?: (err: Error) => void }): {
  register(name: string, fn: (payload: any) => any): string
  route(name: string, payload: any): Promise<any>
  list(): string[]
  unregister(name: string): boolean
}
