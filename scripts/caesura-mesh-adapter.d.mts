/** `scripts/caesura-mesh-adapter.mjs` 的声明：游戏侧微服务适配层（集大成收口）。 */

/** 创建一只游戏侧微服务适配器。 */
export function createGameMeshAdapter(opts?: any): {
  start(): Promise<{ id: string; registered: boolean }>
  stop(): Promise<{ id: string; registered: boolean }>
  reportHealth(): Promise<any>
  getConfig(key: string): any
  status(): Promise<any>
  self(): { id: string; name: string; address: string; port: number }
}
