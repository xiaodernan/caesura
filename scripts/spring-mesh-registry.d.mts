/** `scripts/spring-mesh-registry.mjs` 的声明：Spring Cloud 统一服务注册表（Node.js 侧，集大成收口）。 */

/** 创建一个统一注册表。 */
export function createMeshRegistry(opts?: object): {
  registerSource(name: string, discoverFn: () => Promise<any[]> | any[]): string
  aggregate(): Promise<Map<string, any[]>>
  discover(serviceName: string): Promise<any[]>
}
