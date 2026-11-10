/** `scripts/spring-cloud-contract-client.mjs` 的声明：Spring Cloud Contract 消费者驱动契约桩客户端（Node.js 侧）。 */

/** 创建一个契约桩运行器。 */
export function createContractRunner(opts?: object): {
  addContract(c: { name: string; request: { method?: string; path?: string }; response: { status?: number; body?: any } }): string
  match(contract: any, req: { method?: string; path?: string }): boolean
  serve(req: { method?: string; path?: string }): { status: number; body: any }
  verify(contractsList: any[], actuals?: Array<{ request: any; response: any }>): Array<{ name: string; satisfied: boolean }>
  list(): any[]
}
