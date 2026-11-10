/** `scripts/spring-health-check.mjs` 的声明：健康探针住在 .mjs 里（node 可直接跑，也要被测试 import），
 *  中间放这份声明让 `tsc --noEmit` 能检查（与 `scripts/*.d.mts` 同一理由）。 */

/** 一服务的 health 探测结果 */
export interface HealthProbe {
  /** 服务名（与 SERVICE_PORTS / HEALTH_PATH 的键一致） */
  name: string
  /** 管理端口（无法识别的服务为 null） */
  port: number | null
  /** HTTP 是否 2xx */
  ok: boolean
  /** HTTP 状态码（连不上为 null） */
  status: number | null
  /** 解析后的 JSON body，或原始文本／错误消息 */
  body: unknown
}

/** 服务名 → 管理端口（与 docker-compose.yml / 各 application.yml 同步，唯一出处） */
export const SERVICE_PORTS: Map<string, number>

/** 服务名 → health 上下文路径（context-path + /actuator/health） */
export const HEALTH_PATH: Map<string, string>

/** 探一道服务：返回 { name, port, ok, status, body } */
export function probeOne(name: string): Promise<HealthProbe>

/** 探全部服务，返回每份结果 */
export function probeAll(): Promise<HealthProbe[]>
