/** `services/dev-gateway.mjs` 的声明：判据/实现住在 .mjs 里（它要能被 node 直接跑），
 *  测试要能被 `tsc --noEmit` 检查 ⇒ 中间放这份声明（与 `scripts/*.d.mts` 同一理由）。
 *
 *  约定：`.mjs` 与 `.d.mts` 同名成对 ⇒ 导出集合两边必须逐个相等（门禁「导出集合双向相等」）。 */

/** 一条路由：id ＝ 名册键；service ＝ 仿 Spring Cloud 的服务名（discovery 里的名字）；
 *  method ＝ 只允许 GET；path ＝ 以 `/api/` 开头的绝对路径；note ＝ 这一格干什么的 */
export interface GatewayRoute {
  id: string
  service: string
  method: 'GET'
  path: string
  note: string
}

/** 启动后的句柄：`url` ＝ 可直接 fetch 的基址；`close()` ＝ 关掉并等端口释放 */
export interface GatewayHandle {
  host: string
  port: number
  url: string
  close(): Promise<void>
}

/** `/api/health` 的读数形状（仿 Actuator 的 health/info 形状，只读） */
export interface GatewayHealth {
  status: 'UP'
  scope: 'local-dev'
  version: string
  node: string
  uptimeSec: number
  build: string
}

/** `/api/metrics` 的读数形状：没跑过 measure-probe 时 `latest` 为 null 且必须给出 `reason` */
export interface GatewayMetrics {
  latest: string | null
  reason?: string
  content?: Record<string, unknown> | null
  rawTail?: string | null
}

/** 造一个未监听的网关实例（测试拿它自己 listen 到随机端口） */
export function createGateway(): import('node:http').Server

/** 启动网关：`port = 0` 表示随机端口（测试用）；返回一个可关闭的句柄 */
export function startGateway(opts?: { port?: number; host?: string }): Promise<GatewayHandle>
