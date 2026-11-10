/** `scripts/spring-cloud-facade.mjs` 的声明：CaesuraCloud —— Spring Cloud 家族统一门面（Node.js 侧）。 */

/** 创建一只 CaesuraCloud 门面。 */
export function createCloud(opts?: any): {
  config: any
  discovery: any
  circuit: any
  loadBalancer: any
  bus: any
  stream: any
  gateway: any
  request(serviceName: string, path: string, init?: any): Promise<any>
  publish(channel: string, payload: unknown): Promise<any>
  subscribe(channel: string, handler: (env: any) => void | Promise<void>): () => void
  status(): Promise<any>
}
