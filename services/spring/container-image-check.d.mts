/**
 * services/spring/container-image-check.d.mts —— 那份容器镜像核对器的类型面（KI-430）。
 *
 * 有类型面才谈得上「测试 import 它」：`npx tsc --noEmit` 走的是这份声明，
 * 而运行时走的是同名 `.mjs`——两面的名字必须一致，名字对不上就是死数据。
 */

export interface BaseImage {
  image: string
  alias: string | null
}

/** 从 Dockerfile 的文本里现读出来的两个底座（`froms` 是全部 `FROM`，逐条可查） */
export interface ParsedBases {
  nodeStage: BaseImage | null
  target: BaseImage | null
  froms: BaseImage[]
}

export interface ImageCheckFinding {
  key: string
  msg: string
}

export interface ImageCheckResult {
  verdict: 'OK' | 'RED'
  readings: Record<string, unknown>
  findings: ImageCheckFinding[]
}

/** node 二进制需要的所有 glibc 版本（去重、按**数值**升序 ⇒ 最后一格才是最高的那个） */
export function parseGlibcNeeded(text: string): string[]

/** libc.so.6 自己提供的版本；两种拼法都认，都不认就是 `null`（不许落回默认值） */
export function parseGlibcProvided(text: string): string | null

/** 两个底座的名字从 Dockerfile 现读（不写死在核对器里） */
export function parseBaseImages(text: string): ParsedBases

/** compose 里每一格的镜像名（`image:` 那几格现读 ⇒ 运行那半不许写死一个 tag） */
export function composeImageTags(text: string): string[]

/** 跑一遍两半量测（**会动 docker**，所以只有当命令跑时才跑它） */
export function runContainerImageCheck(): ImageCheckResult
