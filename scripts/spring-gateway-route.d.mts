/** `scripts/spring-gateway-route.mjs` 的声明：Spring Cloud Gateway 路由客户端（Node.js 侧）。
 *  与 `scripts/*.d.mts` 同一理由：让 `tsc --noEmit` 能检查 import。
 */

/** Gateway 路由定义形状（fetch API：predicates/filters 为带名字的对象数组） */
export interface GatewayRoute {
  id: string
  uri: string
  order: number
  predicates: Array<{ name: string; args: Record<string, unknown> }>
  filters: Array<{ name: string; args: Record<string, unknown> }>
}

/** 内存路由表条目（routes.json：predicates/filters 原样透传，形状由数据文件决定） */
export interface RouteRecord {
  id: string
  uri: string
  order: number
  predicates: unknown[]
  filters: unknown[]
}

/** 内存路由表（Node 侧进程内的动态路由名册）。 */
export interface RouteTable {
  /** 新增/覆盖一条路由。 */
  add(row: unknown): RouteRecord
  /** 删除一条路由；不存在返回 false。 */
  remove(id: string): boolean
  /** 查询单条路由；不存在返回 undefined。 */
  get(id: string): RouteRecord | undefined
  /** 列出全部路由，按 order 升序。 */
  list(): RouteRecord[]
  /** 清空全部路由。 */
  clear(): void
  /** 当前路由数量。 */
  size(): number
}

/** 创建内存路由表。 */
export function createRouteTable(): RouteTable

/** 从 routes.json 加载路由（清空旧表），返回加载后的路由名册（按 order 排序）。 */
export function loadRoutesFromFile(table: RouteTable, filePath: string): RouteRecord[]

/**
 * 热加载路由文件：首趟只取快照不吐事件；之后 mtime 真变才重读替换并触发 onChange／Bus。
 *
 * @param table 路由表
 * @param filePath routes.json 文件路径
 * @param interval 检查间隔（毫秒）
 * @param onChange 变更回调 (added, removed, routes) => void
 * @param bus 可选的 Spring Cloud Bus 事件总线（提供时发布 `route.changed`）
 * @returns 停止监听的函数
 */
export function watchRoutes(
  table: RouteTable,
  filePath: string,
  interval?: number,
  onChange?: (added: string[], removed: string[], routes: RouteRecord[]) => void,
  bus?: { publish(event: string, ...args: unknown[]): boolean },
): () => void

/** 触发 Spring Cloud Gateway 丢路由缓存并重读配置（POST /actuator/gateway/refresh）。 */
export function refreshRoutes(gatewayUrl: string): Promise<{ ok: true; body: string }>

/** 查询指定路由定义 */
export function getRoute(routeId: string, gatewayUrl: string): Promise<GatewayRoute>

/** 查询全部路由定义 */
export function getRoutes(gatewayUrl: string): Promise<GatewayRoute[]>
