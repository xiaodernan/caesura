/** `scripts/spring-family-rules.mjs` 的声明：判据住在 .mjs 里（它要被 node 直接跑，也要被合成夹具喂），
 *  测试要能被 `tsc --noEmit` 检查 ⇒ 中间放这份声明（与 `scripts/*.d.mts` 同一理由）。 */

/** 一条读数：{ key, msg }（与 `scripts/id-rules.mjs` 的 `IdFinding` 同形） */
export interface SpringFinding {
  key: string
  msg: string
}

/** 名册里的一格（键名逐字是 YAML 里的那六个） */
export interface RosterGate {
  id?: string
  family?: string
  command?: string
  args?: string[]
  'timeout-sec'?: number
  blocking?: boolean
}

/** 名册读出来的样子：门们 ＋ 读不懂的地方（读不懂就是没有读数，不许猜） */
export interface RosterRead {
  repoRoot: string | null
  gates: RosterGate[]
  errors: string[]
}

/** 名册文件在仓里的相对路径 */
export const ROSTER_RELPATH: string

/** 每一格必带的键 */
export const ROSTER_KEYS: string[]

/** 这一族期望的服务名 */
export const SERVICE_NAMES: string[]

/** 读那份名册（只认一种形状；读不懂就逐条点名） */
export function parseGateRoster(text: string): RosterRead

/** 判据①：名册的形状（每格必带六个键／id 唯一／timeout-sec 是正整数） */
export function rosterShapeFindings(roster: RosterRead): SpringFinding[]

/** 判据②③：Java 源码里不许出现门 id，也不许出现名册里的阈值 */
export function javaHardcodeFindings(input: { roster: RosterRead; javaFiles: { rel: string; text: string }[] }): SpringFinding[]

/** 判据④：名册指向的命令真的存在（npm script 或 scripts/*.mjs） */
export function commandTargetFindings(input: {
  roster: RosterRead
  packageScripts: Record<string, string>
  scriptFiles: string[]
}): SpringFinding[]

/** 判据⑤：拓扑不许少服务（compose ⇄ 模块 ⇄ 期望名单，三方一致） */
export function serviceTopologyFindings(input: {
  composeServices: string[]
  moduleNames: string[]
  expected?: string[]
}): SpringFinding[]

/** 判据⑥：Java 侧不许去读仓库的数据表（判定只有一个主人） */
export function javaReadsRepoDataFindings(input: { javaFiles: { rel: string; text: string }[] }): SpringFinding[]

/** 编排参数的主人（**值由 YAML 现读**，判据不抄那些数——抄一份就是第二个主人） */
export interface OrchestrationOwner {
  owner: string
  label: string
  keys: string[]
}

/** 编排参数名册：谁拥有它、它住在哪个键上 */
export const ORCHESTRATION_OWNERS: OrchestrationOwner[]

/** 判据⑦：编排参数各有主人，Java 侧不许再写一遍那个数 */
export function orchestrationOwnerFindings(input: {
  owners: OrchestrationOwner[]
  ymlTexts: Record<string, string>
  javaFiles: { rel: string; text: string }[]
}): SpringFinding[]

/** 判据⑧：名册只装判定——编排参数不许混进去 */
export function rosterScopeFindings(rosterText: string): SpringFinding[]

/** 判据⑨：熔断必须接上了（三态齐 ＋ 起进程之前问一句 ＋ 开闸时如实说没起进程） */
export function breakerWiredFindings(input: { javaFiles: { rel: string; text: string }[] }): SpringFinding[]

/** 判据⑩：进程形状——Windows 上 npm 要经过 `cmd /c`（它证不了退出码，得靠实机读数） */
export function spawnShapeFindings(input: { javaFiles: { rel: string; text: string }[] }): SpringFinding[]

/** 这个 Dockerfile **真的**把 node 带进镜像了吗（先剥注释再问——注释不是机制） */
export function imageProvidesNode(dockerfile: string): boolean

/** 判据⑪：容器形态那几件必须成立的事（镜像带 node／每格都从它构建／容器里的地址用服务名） */
export function containerShapeFindings(input: {
  dockerfile: string
  composeText: string
  serviceNames: string[]
}): SpringFinding[]
