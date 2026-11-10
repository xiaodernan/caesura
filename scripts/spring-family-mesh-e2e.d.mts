/** `scripts/spring-family-mesh-e2e.mjs` 的声明：集大成家族端到端证据（headless 可证）。 */

export function runMeshE2E(opts?: any): {
  gc: any
  k8s: any
  tracer: any
  run(): Promise<{
    started: any
    callRes: any
    status: any
    stopped: any
    spans: any[]
    services: string[]
  }>
}
