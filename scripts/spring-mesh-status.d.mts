/** `scripts/spring-mesh-status.mjs` 的声明：Spring Cloud 微服务族可观测性聚合器（Node.js 侧）。 */

/** 收集整族状态快照。 */
export function collectMeshStatus(opts: {
  services?: Array<{ name: string; [k: string]: any }>
  health?: (s: any) => Promise<any> | any
  circuit?: (s: any) => Promise<any> | any
  configVersion?: (s: any) => Promise<any> | any
}): Promise<{
  services: Array<{ name: string; health: any; circuit: any; configVersion: any; errors: string[] }>
  summary: { total: number; healthy: number; open: number; degraded: number; errors: number }
}>
