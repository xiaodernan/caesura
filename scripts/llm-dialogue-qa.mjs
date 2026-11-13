/**
 * scripts/llm-dialogue-qa.mjs —— 对白声线真·LLM 现场审稿（作者侧编辑工具）
 *
 * 不创造新台词，而是把 dialogue.json 已决定的开场/文本送真模型问：
 * 是否符合 CAESURA 文风总纲（docs/narrative.md 头部 + §3.3 示例对话 A/B）：
 *
 *   - 克制的、声学隐喻的诗意
 *   - 禁止翻译腔（“哦，朋友”“我以……起誓”“听着，伙计”一律不合格）
 *   - 人物说话像敲钟——余音比敲击重要
 *   - 短句、句间断、省略号、词里藏意象、不解释意象
 *
 * 输出 JSONL：每节点一行 {"id":"...","speaker":"...","quote":"...","verdict":"pass|flag|skip","issues":["..."]}
 * 本工具只产生编辑建议，不改写任何文件；作者自行裁决是否改动。
 *
 * 用法：
 *   $env:CAESURA_LLM_API_KEY = 'sk-…'
 *   node scripts/llm-dialogue-qa.mjs [--npc <dialogueId>] [--json]
 *
 * 诚实边界：
 *   - 审稿结果不保证权威；LLM 审 LLM 存在自我偏好，交叉对照必需。
 *   - 只编辑建议；不会改动 dialogue.json 本身。
 *   - 玩家运行时零 LLM 依赖；密钥仅由环境变量临时注入，绝不进仓、绝不进数据。
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { authorLlmEnv } from './caesura-author-env.mjs'
import { callLlm, buildBibleMessages } from './caesura-llm-client.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const AUTHOR = authorLlmEnv()
const BASE = AUTHOR.baseUrl
const MODEL = AUTHOR.model
const SELECTED = (() => {
  const a = process.argv.slice(2)
  const i = a.indexOf('--npc')
  return i >= 0 ? a[i + 1] : null
})()
const jsonOnly = process.argv.includes('--json')
const outIdx = process.argv.indexOf('--out')
const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : null

const isCliInvocation = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

const RAW = JSON.parse(readFileSync(new URL('../src/data/json/dialogue.json', import.meta.url), 'utf8'))
const CONVS = Array.isArray(RAW) ? RAW : Object.values(RAW)

const SYSTEM = `你是 CAESURA《止音纪元》的文风审稿人。判断每段对白是否符合：

- 文风总纲：克制的、声学隐喻的诗意。人物说话像敲钟——余音比敲击重要。
- 禁止翻译腔（“哦，朋友”“我以……起誓”“听着，伙计”之类一律不合格）。
- 短句、句内断、省略号、词里藏意象、情绪不外露、不堆设定。
- 不要审判维度太多：出现翻译腔/啰嗦解释世界背景/现代现代/口头语“OK 好吧”→ flag，给出理由；整句问题不多 → pass；内容像舞台指示/环境叙事/法术口令/操作提示 → skip。

输出**严格 JSONL**：只输出一行 JSON 对象 {"id":"<id>","speaker":"<speaker>","quote":"<原文片段>","verdict":"pass|flag|skip","issues":["<原因>"]}。
不要\`\`\`，不要数组，不要 JSON 多行；当未识别 speaker 时仍按原文给 speaker。`

function strip(text) { return text.replace(/\s+/g, ' ').trim() }

const NODES = []
for (const conv of CONVS) {
  if (SELECTED && conv.id !== SELECTED) continue
  for (const node of Array.isArray(conv.nodes) ? conv.nodes : []) {
    const text = strip(node?.text ?? '')
    if (!text) continue
    NODES.push({ id: `${conv.id}:${node.id}`, speaker: node.speaker ?? '?', text, emotion: node.emotion ?? null })
  }
}

async function callSingle(it) {
  // 保留 llm-dialogue-qa 自身的「审稿人 / 严格 JSONL」系统提示；bible 不是审稿文风 = 不能罩这 81 条节点。
  // 直接 callLlm + 同 temperature=0 + 流协议 + 护存（等同旧提示，但现在可读 cache 数字）。
  const out = await callLlm({
    model: MODEL,
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0,
    max_tokens: 500,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `dialogue.id=${it.id}\ndialogue.speaker=${it.speaker}\ndialogue.emotion=${it.emotion ?? 'n/a'}\n\n${it.text}` },
    ],
  })
  const content = out.text || ''
  return { status: out.status, text: content, json: out.usage ? { choices: [{ message: { content } }], usage: out.usage } : null, ms: out.dt, cachedTokens: out.cachedTokens }
}

if (isCliInvocation) {
  if (!AUTHOR.apiKey) {
    console.error('[llm-dialogue-qa] 缺少 CAESURA_LLM_API_KEY，只作为使用则表示；在环境变量中注入，不入仓库')
    process.exit(2)
  }
  console.error(`[llm-dialogue-qa] ${NODES.length} dialogue nodes @ ${BASE} (${MODEL})`)
  const outChunks = []
  for (const it of NODES) {
    const out = await callSingle(it)
    if (out.status !== 200) {
      outChunks.push(JSON.stringify({ id: it.id, speaker: it.speaker, quote: it.text, verdict: 'skip', issues: [`http ${out.status}`] }) + '\n')
      continue
    }
    const content = String(out.json?.choices?.[0]?.message?.content ?? '').trim()
    let entry = null
    for (const line of content.split('\n')) {
      const s = line.trim()
      if (!s.startsWith('{')) continue
      try { const p = JSON.parse(s); if (p && p.id) { entry = p; break } } catch { /* continue */ }
    }
    if (!entry) entry = { id: it.id, speaker: it.speaker, verdict: 'skip', issues: ['unparseable: ' + content.slice(0, 140)] }
    entry.quote = it.text
    if (!entry.id) entry.id = it.id
    if (!entry.speaker) entry.speaker = it.speaker
    outChunks.push(JSON.stringify(entry) + '\n')
  }
  const outText = outChunks.join('')
  if (outPath) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(outPath, outText, 'utf8')
    console.error('[llm-dialogue-qa] wrote ' + outPath)
  } else {
    process.stdout.write(outText)
  }
  process.exit(0)
}
