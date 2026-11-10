/** `scripts/spring-cloud-openfeign-client.mjs` 的声明：Spring Cloud OpenFeign 声明式 REST 客户端（Node.js 侧）。 */

/** 定义一个声明式客户端。 */
export function defineClient(
  baseUrl: string,
  spec: Record<string, { method?: string; path?: string; service?: string; headers?: Record<string, string> }>,
  opts?: { choose?: (service: string) => Promise<any> | any; fetch?: typeof fetch },
): Record<string, (params?: Record<string, any>, body?: any) => Promise<any>>
