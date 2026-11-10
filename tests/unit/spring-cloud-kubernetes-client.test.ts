import { describe, expect, it } from 'vitest'
import { createKubernetesClient } from '../../scripts/spring-cloud-kubernetes-client.mjs'

describe('spring-cloud-kubernetes-client', () => {
  it('getConfigMap 返回存储的 configMap', () => {
    const k = createKubernetesClient({ namespace: 'game', configMaps: { svc: { a: 1 } } })
    expect(k.getConfigMap('svc')).toEqual({ a: 1 })
  })

  it('getEndpoints 返回存储的 endpoints', () => {
    const k = createKubernetesClient({ endpoints: { svc: [{ ip: '10.0.0.1', port: 8080 }] } })
    expect(k.getEndpoints('svc')).toEqual([{ ip: '10.0.0.1', port: 8080 }])
  })

  it('discover 产出 mesh 形状的实例', () => {
    const k = createKubernetesClient({ endpoints: { svc: [{ ip: '10.0.0.1', port: 8080 }] } })
    const got = k.discover('svc')
    expect(got[0]).toMatchObject({ id: 'svc-10.0.0.1:8080', name: 'svc', address: '10.0.0.1', port: 8080, healthy: true })
  })

  it('discover 映射 ready:false → healthy:false', () => {
    const k = createKubernetesClient({ endpoints: { svc: [{ ip: '10.0.0.2', port: 9, ready: false }] } })
    expect(k.discover('svc')[0].healthy).toBe(false)
  })

  it('getServiceConfig 合并 namespace + 服务配置', () => {
    const k = createKubernetesClient({
      namespace: 'game',
      configMaps: { game: { tier: 'prod' }, svc: { replicas: 3 } },
    })
    expect(k.getServiceConfig('svc')).toEqual({ tier: 'prod', replicas: 3 })
  })

  it('namespace 默认 default；缺失 configMap 返回空', () => {
    const k = createKubernetesClient()
    expect(k.namespaceOf()).toBe('default')
    expect(k.getConfigMap('nope')).toEqual({})
  })
})
