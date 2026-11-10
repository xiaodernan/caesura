/** `scripts/spring-cloud-vault-client.mjs` 的声明：Spring Cloud Vault 配置/密钥客户端（Node.js 侧）。 */

/** 创建一个 Vault 客户端。 */
export function createVaultClient(opts: {
  address: string
  token: string
  fetch?: typeof fetch
  cacheTtlMs?: number
}): {
  readSecret(path: string, o?: { noCache?: boolean }): Promise<any>
  readCached(path: string): Promise<any>
  invalidate(path?: string): void
  address: string
}
