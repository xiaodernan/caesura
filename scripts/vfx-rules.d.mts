/** `vfx-rules.mjs` 的声明：判据住在 .mjs 里（node 吃不下 `.ts`），测试要能被 `tsc --noEmit` 检查
 *  ⇒ 两边中间放这份声明（缺它就是 TS7016，与 `event-rules.d.mts` 同一个理由）。 */

/** 一条判据的读数：`where` 指出位置，`why` 说清为什么红 */
export interface VfxFinding {
  where: string
  why: string
}

/** `#rgb` / `#rrggbb` 的判定 */
export function isHexColor(v: unknown): boolean
/** 判据本体：量这张表能不能被表现层兑现 */
export function vfxFindings(file: string, table: unknown): VfxFinding[]
/** 三个 id 段的全集 */
export function vfxConfigIds(table: unknown): string[]
