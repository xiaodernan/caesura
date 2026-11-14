#!/usr/bin/env node
/**
 * scripts/lore-codex-snapshot.mjs — 从 `codex/index.html` 的 CODEX 数组切出
 * `Services/spring/caesura-lore/src/main/resources/lore/codex.json` 快照（2026-11-15）。
 *
 * 为什么需要：`caesura-lore` 是 Java 侧的「世界谱后端」，Java 侧不许读仓库数据表
 * （`javaReadsRepoDataFindings`）；它携带 jar 里打包的快照，把 48 条真实文本在
 * `/lore/codex` 与 `/lore/search` 上以 BM25 返回。快照是**同源**的——它不是手抄，
 * 而是这段脚本从页面源里真的切出来，生成时校验条目数=48、id 唯一。
 *
 * 用法：`node scripts/lore-codex-snapshot.mjs`（写入后 git status 会显示该文件）
 * 作者侧脚本：不进 runtime、不进 dialogue.json、不读 env。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'codex/index.html')
const OUT = join(ROOT, 'Services/spring/caesura-lore/src/main/resources/lore/codex.json')

const html = readFileSync(SRC, 'utf8')
const m = html.match(/const CODEX = (\[[\s\S]*?\n\]);/)
if (!m) {
  console.error('CODEX 数组没有在 codex/index.html 里找到（结构漂移？）')
  process.exit(2)
}

// 只 eval 这个字面量数组（它是仓库固定内容，不是外部输入）
// eslint-disable-next-line no-eval
const CODEX = Function(`"use strict"; return (${m[1]});`)()

if (!Array.isArray(CODEX) || CODEX.length !== 48) {
  console.error(`CODEX 条目数不是 48（实测 ${CODEX.length}）——要么页面改了，要么提取错位`)
  process.exit(3)
}

const slug = (s) =>
  String(s)
    .split('@')[0]                    // 丢掉「层数」后缀（如「· @−40」）
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/·/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const seen = new Set()
const entries = CODEX.map((e) => {
  const base = slug(e.title.en)
  const id = `${e.cat}-${base}`
  if (!id) throw new Error(`空 id: ${JSON.stringify(e.title)}`)
  if (seen.has(id)) throw new Error(`id 冲突: ${id}`)
  seen.add(id)
  return { id, cat: e.cat, title: { zh: e.title.zh, en: e.title.en }, body: { zh: e.body.zh, en: e.body.en } }
})

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify({ schema: 1, source: 'codex/index.html', generated: new Date().toISOString().slice(0, 10), entries }, null, 2) + '\n')
console.log(`lore/codex.json written: ${entries.length} entries`)
console.log('sample:', entries.slice(0, 3).map((e) => e.id).join(', '))
