/** `schema-vocab.mjs` 的声明（.mjs 判据 + 可被 tsc 检查的测试，中间放这份声明）。 */

/** 一张名单的**载体语料**：整份文件文本 + 按顶层声明切好的块。不同形状的判据要不同的一层。 */
export interface VocabCorpus {
  text: string
  blocks: Map<string, string>
}

export interface VocabPair {
  /** 那张声明在这道门里的身份，出现在报错的 key 里：'SlotKey' / 'MilestoneGrant' / 'SHAKE_TABLE' */
  at: string
  /** 主人住的文件（KI-076 起不再只有 schema.ts）：报错按它分段、措辞也用它 */
  from: string
  /** 人话名字（报错里印出来） */
  name?: string
  /** 从载体侧读出这份词表；读不到返回 null（对账会把它报成"门在空转"） */
  source: (corpus: VocabCorpus) => string[] | null
  /** 校验器手抄的那一份 */
  copied?: string[]
  /** 允许"声明有而抄本没有"的**那几个**成员（子集关系）；必须同时给 whyMissing */
  allowMissing?: string[]
  /** 为什么刻意少抄——这句话是给人看的，缺了它子集关系就没人能核对 */
  whyMissing?: string
  /** 抄本只是声明的一个任意子集（少抄不报、多抄照报）；必须同时给 whySubset，且与 allowMissing 互斥 */
  subset?: boolean
  /** 为什么这张表允许整体不抄全 */
  whySubset?: string
  /** 抄本住在哪个文件/常量（报错里指路） */
  where?: string
  /** 读不到声明时给排查留的提示 */
  hint?: string
}

export interface VocabError {
  key: string
  msg: string
  from: string
}

export function stripComments(text: string): string
export function schemaBlocks(text: string): Map<string, string>
export function unionMembers(blocks: Map<string, string>, typeName: string): string[] | null
export function interfaceFields(blocks: Map<string, string>, ifaceName: string): string[] | null
export function fieldUnion(blocks: Map<string, string>, ifaceName: string, field: string): string[] | null
export function refFieldUnion(blocks: Map<string, string>, typeName: string, field: string): string[] | null
export function objectKeys(text: string, constName: string): string[] | null
export function arrayLiterals(text: string, constName: string): string[] | null
export function callArgLiterals(text: string, fnName: string): string[] | null
/** `corpusFor(from)`：按载体文件给语料；读不到返回 null（对账会把它报成"这张门的载体读不到"） */
export function vocabDriftErrors(input: { pairs: VocabPair[]; corpusFor: (from: string) => VocabCorpus | null }): VocabError[]
