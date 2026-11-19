/**
 * scripts/lib/scene-bible.mjs — 《止音纪元》世界「场景圣经」（作者侧 · 世界导演的巨前缀缓存轨道）
 *
 * 【为什么存在】（KI-663 · 2026-11-18）
 * Codex / ChatGPT 的工程实测规律：命中率稳在 90% 的前提，是**巨大、字节级稳定、不易变**的 system 前缀——
 * 每会话、每次调用都字节相同的巨石，而不是每轮都在变化的「快照+日期+KI行数」。
 * 本项目旧版 director 前缀（≈3–4k tokens）：
 *   ① DIRECTOR_SYSTEM ≈ 400 字符；② 易变「世界现状快照」（日期/KI行数/篇目数——每次提交都变 ⇒ 前缀变 ⇒ 前缀缓存**主动碎裂**）；
 *   ③ canon 证据 ≈3.6k 字。—— 这才是缓存命中率「始终没法稳定到 ~90%」的**真头号根因**，不是流、不是 key、也不是并行会话本身；
 * 每行 KI 提交都在大幅重写 prefix bytes，任何代理侧缓存都无从命中。
 *
 * 【本模块的做法】（≈40k tokens 巨前缀 · 字节稳定）：
 *   SCENE_BIBLE = 世界导演铁律（原 DIRECTOR_SYSTEM 原话，吸收 KI-657 提案硬约束）+ 世界谱 74 条（逐条 id/cat/双语/title/body）
 *                 + 余响集八十一篇全文（no/zhTitle/enTitle/zh 全文 + en 全文）
 *   ① 无日期、无 KI 行数、无 git sha、无易变统计 ⇒ 跨会话字节级一致 ⇒ 同一前缀可跨会话、跨进程、跨并行 session 复用同一缓存；
 *   ② sha-256 锚定（`sceneBibleHash()`）⇒ prompt_cache_key 也按此派生 ⇒ 亲和路由把同一逻辑前缀钉在同一缓存主机；
 *   ③ 易变内容（日期/KI/篇目数/focus/本轮任务）移入 **user** 消息，绝不进 system；
 *   ④ 单飞热身：`.scratch` 下 marker `scene-bible-<hash>.warm` 记账最近一次烤热结果；并行会话间共享，避免重复付首次冷 miss；
 *   ⑤ 纪律：仅作者侧（开发者/管理员），玩家进程零 LLM；本模块任何路径都不进游戏运行时。
 *
 * @module scene-bible
 */
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { createHash } from 'node:crypto'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const SCENE_BIBLE_VERSION = 'v1'

const DIRECTOR_SYSTEM_CORE = [
  '你是《止音纪元》的「世界导演」（World Director）。你读过完整的世界圣经、叙事圣经、新陆设定与全部八十一篇余响游记。',
  '你的工作不是写漂亮话，而是：① 对照 canon 证据审计世界现状；② 提出可落地的世界状态流转提案；③ 为下一篇游记产出可用的草稿。',
  '铁律：',
  '- 设定只能来自【世界谱 / 余响集 / canon 证据】出处；证据里没有的新设定必须标 requiresHumanReview:true 且不得伪造 canon 出处。',
  '- 写作纪律：禁复仇、禁新神、禁现代感叹词、禁动作括号、禁半句抒情。',
  '- 输出**严格的单个 JSON 对象**，不要 markdown 代码块、不要额外说明。',
  '- 提案中的 flag 必须以 "flag." 开头、全小写 snake_case，不许 proposed / new / plan 前缀。',
].join('\n')

function readText(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

function parseCodex(rel) {
  try {
    const d = JSON.parse(readText(rel))
    const entries = Array.isArray(d.entries) ? d.entries : []
    const lines = []
    for (const e of entries) {
      const zhTitle = e.title?.zh ?? ''
      const enTitle = e.title?.en ?? ''
      const zhBody = e.body?.zh ?? ''
      const enBody = e.body?.en ?? ''
      if (!zhTitle || !zhBody) continue
      lines.push(`### [${e.cat ?? 'lore'}] ${zhTitle} / ${enTitle}\n${zhBody}\n${enBody}`)
    }
    return lines.join('\n\n')
  } catch {
    return ''
  }
}

function parseAtlas(rel) {
  try {
    const raw = readText(rel)
    // 按 `no: <n>,` 切块；每块含 zhTitle/enTitle/zh/en
    const chunks = raw.split(/\n  \{\n    no: /).slice(1)
    const out = []
    for (const chunk of chunks) {
      const noM = chunk.match(/^(\d+)/)
      const zhTitleM = chunk.match(/zhTitle:\s*"([^"]+)"/)
      const enTitleM = chunk.match(/enTitle:\s*"([^"]+)"/)
      const zhM = chunk.match(/\n    zh:\s*`(.*?)`,/s)
      const enM = chunk.match(/\n    en:\s*`(.*?)`,/s)
      if (!noM || !zhTitleM || !zhM) continue
      const zh = zhM[1].replace(/<[^>]+>/g, ' ').replace(/\s+\n/g, '\n').trim()
      const en = enM ? enM[1].replace(/<[^>]+>/g, ' ').replace(/\s+\n/g, '\n').trim() : ''
      out.push(`### No.${noM[1]}《${zhTitleM[1]}${enTitleM ? ' / ' + enTitleM[1] : ''}》\n${zh}\n${en}`)
    }
    return out.join('\n\n')
  } catch {
    return ''
  }
}

/** 组装「场景圣经」：铁律页 + 世界谱 + 余响集八十一篇（不含任何易变字段）。 */
export function buildSceneBible() {
  const lore = parseCodex('services/spring/caesura-lore/src/main/resources/lore/codex.json')
  const atlas = parseAtlas('src/ui/atlas-texts.ts')
  return [
    '# 《止音纪元》世界导演 · 场景圣经（Scene Bible · ' + SCENE_BIBLE_VERSION + '）',
    '',
    '【铁律】',
    DIRECTOR_SYSTEM_CORE,
    '',
    '【世界谱 · 74 条 · 《止音纪元 · 世界谱》原文（zh/en 双语）】',
    lore,
    '',
    '【余响集 · 六十四篇全文（zh/en 双语 · 与 src/ui/atlas-texts.ts 同源）】',
    atlas,
    '',
  ].join('\n')
}

let cached
export const sceneBible = () => (cached ??= buildSceneBible())

/** sha256 锚定（不含任何易变字节 ⇒ 跨进程可复现）。 */
export const sceneBibleHash = () => createHash('sha256').update(sceneBible(), 'utf8').digest('hex')

/** 与 buildBibleMessages 的 cacheKey 同形，钉在前缀哈希上。 */
export const sceneBibleCacheKey = () => `caesura-scene-${sceneBibleHash().slice(0, 32)}`

/** 解析出用于测试/诊断的度量：章节条数、字节数、token 粗估（≈字节/3.2，仅诊断，不上报）。 */
export const sceneBibleStats = () => {
  const s = sceneBible()
  const bytes = Buffer.byteLength(s, 'utf8')
  const loreCount = (s.match(/^### \[/gm) ?? []).length
  const atlasCount = (s.match(/^### No\.\d+/gm) ?? []).length
  // 漂移只对**我自己加的静态头**下结论（DIRECTOR_SYSTEM_CORE ≈ 至世界谱之前的那一段）。
  // 源内容（世界谱正文／游记正文）允许出现历史日期——那些本身就是 canon 的一部分，
  // 改它们恰是字节应当失效缓存的时刻。不用 hex 字母柄（英文 defaced/acceded 都是 [a-f0-9]{7}）。
  const head = s.slice(0, s.indexOf('【世界谱'))
  const containsVolatileDrift = /\bKI-\d{3,}\b|\b202\d-\d{2}-\d{2}\b|\bT\d{2}:\d{2}:\d{2}\b/.test(head)
  return {
    version: SCENE_BIBLE_VERSION,
    bytes,
    approxTokens: Math.round(bytes / 3.2),
    loreEntries: loreCount,
    atlasChapters: atlasCount,
    containsVolatileDrift,
  }
}

/** 单飞热身标记（并行会话共享；marker 新鲜度内不重复烤热·不重复付冷 miss）。 */
const WARM_MARKER = join(ROOT, '.scratch', `scene-bible-${sceneBibleHash().slice(0, 16)}.warm`)
const WARM_FRESH_MS = 30 * 60 * 1000 // 30 分钟内视为仍热

export function readWarmMarker() {
  try {
    if (!existsSync(WARM_MARKER)) return null
    return JSON.parse(readFileSync(WARM_MARKER, 'utf8'))
  } catch {
    return null
  }
}

export function writeWarmMarker(meta) {
  try {
    mkdirSync(dirname(WARM_MARKER), { recursive: true })
    writeFileSync(WARM_MARKER, JSON.stringify({ ...meta, hash: sceneBibleHash(), at: Date.now() }), 'utf8')
    return true
  } catch {
    return false
  }
}
