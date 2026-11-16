/**
 * scripts/lib/world-rag.mjs — 《止音纪元》世界语料检索库（作者侧，零依赖）
 *
 * 这不是玩具：newlands-canon-rag.mjs 那套 BM25-ish（字符二元组）打分法在这里被推广成
 * 全仓共享的真实现，并扩展了语料面 → 世界观文档 + 叙事 + lore + 全部 story/*.html
 * （条目标签剥离后的正文）+ dialogue.json + npcs.json 名册。AI 导演引擎（scripts/ai-director.mjs）
 * 拿它做「canon 现查现证」，不许模型凭参数里的记忆编设定。
 *
 * 设计纪律：
 *   - 零 embedding / 零第三方依赖：字符 bigram + df 平滑 idf，小语料下足够准（>4k chunks）。
 *   - 纯函数：buildIndex / retrieve 不触文件系统；buildWorldCorpus(root) 才读盘。
 *   - retrieve 返回的是**原文 chunk**（带来源标签），调用方不许把打分值当证据。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/* ─────────── 分词（CJK bigram + ASCII word）─────────── */
export function tokenize(s) {
  const t = String(s ?? '')
  const out = []
  for (let i = 0; i < t.length; i += 1) {
    const a = t[i]
    if (/[A-Za-z0-9_]/.test(a)) {
      let j = i
      while (j < t.length && /[A-Za-z0-9_]/.test(t[j])) j += 1
      out.push(t.slice(i, j).toLowerCase())
      i = j - 1
      continue
    }
    if (i + 1 < t.length) out.push(t.slice(i, i + 2))
  }
  if (t.length < 2 && t.trim().length > 0) out.push(t)
  return out
}

/* ─────────── 建索引 ─────────── */
export function buildIndex(corpus) {
  const docs = corpus.map((c) => tokenize(c))
  const docFreq = new Map()
  for (const toks of docs) {
    for (const tok of new Set(toks)) docFreq.set(tok, (docFreq.get(tok) || 0) + 1)
  }
  const N = docs.length
  const avgLen = docs.reduce((n, d) => n + d.length, 0) / Math.max(N, 1)
  const tfVectors = docs.map((toks) => {
    const m = new Map()
    for (const tok of toks) m.set(tok, (m.get(tok) || 0) + 1)
    return m
  })
  return { corpus, docFreq, N, avgLen, tfVectors, docLens: docs.map((d) => d.length) }
}

const K1 = 1.2
const B = 0.75

function idf(index, tok) {
  const df = index.docFreq.get(tok) || 0
  return Math.log(1 + (index.N - df + 0.5) / (df + 0.5))
}

export function retrieve(index, query, k = 8) {
  const q = tokenize(query)
  const scored = []
  for (let i = 0; i < index.N; i += 1) {
    const tf = index.tfVectors[i]
    const len = index.docLens[i] || 1
    let s = 0
    for (const tok of q) {
      const f = tf.get(tok)
      if (!f) continue
      const num = f * (K1 + 1)
      const den = f + K1 * (1 - B + (B * len) / index.avgLen)
      s += idf(index, tok) * (num / den)
    }
    if (s > 0) scored.push({ index: i, score: s })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, Math.max(1, k)).map((r) => ({ chunk: index.corpus[r.index], score: r.score }))
}

/* ─────────── HTML 剥离（story 静态页 → 正文 chunks）─────────── */
export function stripHtml(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 18)
}

/* ─────────── 世界语料装配 ─────────── */
const mdChunks = (root, file, tag) => {
  const p = resolve(root, file)
  if (!existsSync(p)) return []
  const raw = readFileSync(p, 'utf8')
  return raw
    .split(/\n{2,}/)
    .map((part, i) => `[${tag}][${file}#${i + 1}] ${part.replace(/\s*\n\s*/g, ' ').trim()}`)
    .filter((p) => p.length > 40)
}

const dialogueChunks = (root) => {
  const p = resolve(root, 'src/data/json/dialogue.json')
  if (!existsSync(p)) return []
  const dialogue = JSON.parse(readFileSync(p, 'utf8'))
  const npcs = JSON.parse(readFileSync(resolve(root, 'src/data/json/npcs.json'), 'utf8'))
  const nameOf = (id) => (npcs.find((n) => n.id === id) ?? {}).displayName || id
  const out = []
  for (const tree of dialogue) {
    for (const node of tree.nodes ?? []) {
      const speaker = tree.npc ? nameOf(tree.npc) : (node.speaker ?? tree.id)
      const text = String(node.text ?? '').trim()
      if (!text) continue
      out.push(`[对白][${tree.id}/${speaker}] ${text}`)
    }
  }
  return out
}

const storyChunks = (root) => {
  const dir = resolve(root, 'story')
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const html = resolve(dir, entry.name, 'index.html')
    if (!existsSync(html)) continue
    for (const line of stripHtml(readFileSync(html, 'utf8'))) {
      out.push(`[短篇][story/${entry.name}] ${line}`)
    }
  }
  return out
}

/**
 * 装配整个世界语料库（chunk 数组，每条带来源标签）。
 * @param {string} [root] 仓库根目录（默认取本文件位置上推两级）
 */
export function buildWorldCorpus(root = ROOT) {
  const corpus = [
    ...dialogueChunks(root),
    ...storyChunks(root),
    ...mdChunks(root, 'docs/WORLD-BIBLE.md', '设定'),
    ...mdChunks(root, 'docs/narrative.md', '叙事'),
    ...mdChunks(root, 'docs/lore/NEW-LANDS.md', '设定'),
  ]
  return corpus
}
