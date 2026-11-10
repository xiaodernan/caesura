/** `scripts/spring-cloud-kubernetes-client.mjs` 的声明：Spring Cloud Kubernetes 客户端（Node.js 侧）。 */

export interface K8sEndpoint {
  ip: string
  port: number
  ready?: boolean
}

export interface KubernetesClientOptions {
  namespace?: string
  configMaps?: Record<string, Record<string, unknown>>
  endpoints?: Record<string, K8sEndpoint[]>
}

/** 创建一只 Kubernetes 客户端。 */
export function createKubernetesClient(opts?: KubernetesClientOptions): {
  namespaceOf(): string
  getConfigMap(name: string): Record<string, unknown>
  getEndpoints(serviceName: string): K8sEndpoint[]
  discover(serviceName: string): Array<{ id: string; name: string; address: string; port: number; healthy: boolean }>
  getServiceConfig(serviceName: string): Record<string, unknown>
}
