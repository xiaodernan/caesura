/** `schema-vocab.mjs` 的声明（.mjs 判据 + 可被 tsc 检查的测试，中间放这份声明）。 */

export interface VocabPair {
  /** 载体名，出现在报错的 key 里：'SlotKey' / 'MilestoneGrant' / 'PropRef.kind' */
  at: string
  /** 人话名字（报错里印出来） */
  name?: string
  /** 从 schema 侧读出这份词表；读不到返回 null（对账会把它报成"门在空转"） */
  source: (blocks: Map<string, string>) => string[] | null
  /** 校验器手抄的那一份 */
  copied?: string[]
  /** 允许"schema 有而抄本没有"的成员（子集关系）；必须同时给 whyMissing */
  allowMissing?: string[]
  /** 为什么刻意少抄——这句话是给人看的，缺了它子集关系就没人能核对 */
  whyMissing?: string
  /** 抄本住在哪个文件/常量（报错里指路） */
  where?: string
  /** 读不到声明时给排查留的提示 */
  hint?: string
}

export interface VocabError {
  key: string
  msg: string
}

export function stripComments(text: string): string
export function schemaBlocks(text: string): Map<string, string>
export function unionMembers(blocks: Map<string, string>, typeName: string): string[] | null
export function interfaceFields(blocks: Map<string, string>, ifaceName: string): string[] | null
export function fieldUnion(blocks: Map<string, string>, ifaceName: string, field: string): string[] | null
export function vocabDriftErrors(input: { blocks: Map<string, string>; pairs: VocabPair[] }): VocabError[]
