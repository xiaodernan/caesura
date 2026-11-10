/** `scripts/spring-cloud-consul-client.mjs` 的声明：Spring Cloud Consul 服务发现客户端（Node.js 侧）。 */

/** 创建一个 Consul 客户端。 */
export function createConsulClient(opts?: {
  address?: string
  fetch?: typeof fetch
  inMemory?: boolean
}): {
  register(service: { name: string; address: string; port: number; id?: string; [k: string]: any }): Promise<{ id: string; stored: string }>
  deregister(id: string): Promise<{ id: string; stored: string }>
  discover(serviceName: string): Promise<Array<{ id?: string; name?: string; address?: string; port?: number; [k: string]: any }>>
  health(serviceName: string): Promise<Array<{ id?: string; healthy: boolean }>>
  address: string
}
