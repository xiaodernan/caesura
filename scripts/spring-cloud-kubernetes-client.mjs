/**
 * scripts/spring-cloud-kubernetes-client.mjs —— Spring Cloud Kubernetes 客户端（Node.js 侧）。
 *
 * <p>家族此前缺 Kubernetes 这一支（config-map 配置 / endpoints 服务发现）。本件补上，默认内存实现，
 * 让 `createCloudRuntime` 的 `sources` 也能挂一只 K8s 发现源（其 `discover` 直接产出 mesh-registry 的实例形状）。
 * 判词仍由 Node 侧持有（决策原则①）：本件只做内存态的 config-map/endpoints 收口，真 K8s API 由注入的 fetch 决定。</p>
 */

/**
 * 创建一只 Kubernetes 客户端。
 * @param {object} [opts] { namespace?, configMaps?: Record<string,Record<string,unknown>>, endpoints?: Record<string,Array<{ip:string,port:number,ready?:boolean}>> }
 */
export function createKubernetesClient(opts = {}) {
  const namespace = opts.namespace ?? 'default'
  const configMaps = new Map(Object.entries(opts.configMaps ?? {}))
  const endpoints = new Map(Object.entries(opts.endpoints ?? {}))

  function getConfigMap(name) {
    return configMaps.get(name) ?? {}
  }

  function getEndpoints(serviceName) {
    return endpoints.get(serviceName) ?? []
  }

  // 把 K8s Endpoints 转成 mesh-registry 的实例形状（{id,name,address,port,healthy}）
  function discover(serviceName) {
    return getEndpoints(serviceName).map((e, i) => ({
      id: `${serviceName}-${e.ip}:${e.port}`,
      name: serviceName,
      address: e.ip,
      port: e.port,
      healthy: e.ready !== false,
    }))
  }

  function getServiceConfig(serviceName) {
    const ns = getConfigMap(namespace) ?? {}
    const svc = getConfigMap(serviceName) ?? {}
    return { ...ns, ...svc }
  }

  function namespaceOf() { return namespace }

  return { namespaceOf, getConfigMap, getEndpoints, discover, getServiceConfig }
}
