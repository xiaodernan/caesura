/**
 * scripts/ai-canon-oracle.mjs — KI-633 · 史官问答 · Canon Oracle
 *
 * 大模型作者侧生成「史官问答」集：**玩家在 codex 里能读到的、由 LLM 写成的世界百科 Q&A**。
 * 产出落：src/data/authoring/canon-oracle.json（静态、已人工闸过）+ codex/index.html 史官问答区。
 *
 * 纪律：
 *   - 玩家进程零 LLM 不变；本脚本只在作者侧跑，不进 CI，不进运行时。
 *   - 任何答案不允许出现「AI」「模型」「langgraph」「token」这类工程词。
 *   - 每个答案 ≤ 140 字（zh）/ ≤ 90 words（en）；必须带 source 字段指向 canon 出处。
 *   - 产物需要人工审（本仓先写进 authoring + 本地审核后并入 codex）。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { authorLlmEnv } from './caesura-author-env.mjs'
import { callLlm, applyAuthorProxyFromEnv } from './caesura-llm-client.mjs'
import { buildWorldCorpus, buildIndex, retrieve } from './lib/world-rag.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const QUESTIONS = [
  ['钟为什么总是响三下？', 'Why do the bells always ring three times?'],
  ['第四下是谁留给了醒着的人？', 'Who kept the fourth strike for those still awake?'],
  ['末行空白其实是谁的名字？', 'Whose name is in that final blank line?'],
  ['老大师离开之前到底欠下了什么？', 'What did the Last Master leave unpaid?'],
  ['海为什么欠了一记 E♭？', 'Why does the sea owe an E♭?'],
  ['万籁为什么不看，只听？', 'Why does The Myriad not see — only hear?'],
  ['钟摆渡人为什么不离开未竟厅？', 'Why does the Pendulum Ferryman stay?'],
  ['恩希尔最后看到的那一眼是什么？', 'What did Hersil see at the very last moment?'],
  ['那句从没说出口的话是什么？', 'What is the sentence no one ever said aloud?'],
  ['灯匠的灯为什么有一盏一直亮着？', 'Why does the lampwright keep one lamp lit?'],
  ['拾钟人最后一次问，是在什么时候？', 'When was the last time the Bell-Picker asked?'],
  ['第四下响不响，是谁决定的？', 'Who decides whether the fourth strike will sound?'],
]

const PREFIX = [
  '你是《止音纪元》的「史官」。回答玩家关于世界的十二个问题——平实、物件说话、留白、不抒情；不得出现 AI、模型、token、提交、CI、代码等工程词汇。',
  '格式：严格的 JSON 数组，元素形状 {"qZh":"...","qEn":"...","aZh":"≤140字","aEn":"≤90 words","source":"canon 出处（如《余响集·第十七篇》/ WORLD-BIBLE §3）","tags":["≤3个关键词"]}。不要额外说明、不要代码块。',
].join('\n')

async function main() {
  const args = process.argv.slice(2)
  const MODE = args.includes('--live') ? 'live' : 'offline'
  const corpus = buildWorldCorpus(ROOT)
  const index = buildIndex(corpus)
  console.log(`corpus=${corpus.length} chunks`)

  if (MODE === 'offline') {
    // offline: 列出问题 + 检索证据（不调 LLM），用于人为起稿或预检索
    for (const [qZh, qEn] of QUESTIONS) {
      const hits = retrieve(index, `${qZh} ${qEn}`, 2)
      console.log('##', qZh)
      for (const h of hits) console.log('  -', h.chunk.slice(0, 160))
      console.log('')
    }
    process.exit(0)
  }

  const env = authorLlmEnv()
  if (!env.apiKey) { console.error('missing CAESURA_LLM_API_KEY'); process.exit(2) }
  // 代理口径全走 caesura-llm-client —— 这里的唯一环境入口 applyAuthorProxyFromEnv 会自己读 env
  await applyAuthorProxyFromEnv()

  const qa = []

  const answer = async (qZh, qEn) => {
    const canon = retrieve(index, `${qZh} ${qEn}`, 5).map((h) => h.chunk.slice(0, 300)).join('\n')
    const user = [
      `【canon 证据】\n${canon}\n`,
      `【问题】\n${qZh}\n${qEn}\n`,
      '回答这一题。严格按下面的分隔符输出——不要 JSON、不要代码块、不要任何额外说明：',
      '###A_ZH###（中文答案，≤140 字，一段，不说"我作为 AI"）',
      '###A_EN###（英文答案，≤90 words，一段）',
      '###SOURCE###（出处，如：短篇《灯匠》／WORLD-BIBLE §3，≤40字）',
      '###TAGS###（两个中文关键词，逗号分隔）',
    ].join('\n')
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const out = await callLlm({
        model: env.model, stream: true, stream_options: { include_usage: true },
        temperature: attempt === 0 ? 0.75 : 0.4, max_tokens: attempt === 0 ? 600 : 800,
        messages: [{ role: 'system', content: PREFIX }, { role: 'user', content: user }],
      }, { baseUrl: env.baseUrl, apiKey: env.apiKey })
      const raw = String(out.text ?? '').trim()
      const grab = (marker) => {
        // indexOf-based — no regex, no backslash-escaping traps
        const open = raw.indexOf('###' + marker + '###')
        if (open < 0) return ''
        const after = open + marker.length + 6
        const next = raw.slice(after)
        const idx = next.search(/###[A-Z_]+###/)
        return (idx >= 0 ? next.slice(0, idx) : next).trim()
      }
      const aZh = grab('A_ZH')
      const aEn = grab('A_EN')
      if (aZh.length > 20 && aEn.length > 10) {
        const tagsRaw = grab('TAGS') || '余响'
        const tags = tagsRaw.split(/[，,]|、|\s+/u).map((t) => t.trim()).filter(Boolean).slice(0, 4)
        return {
          qZh, qEn,
          aZh, aEn,
          source: String(grab('SOURCE') || 'WORLD-BIBLE').slice(0, 60),
          tags: tags.length ? tags : ['余响'],
        }
      }
      console.error(`  retry ${attempt + 1}/2 for ${qZh}`)
    }
    return null
  }

  for (const [qZh, qEn] of QUESTIONS) {
    const parsed = await answer(qZh, qEn)
    if (!parsed) { console.error(`  ✕ 解析失败（两次）：${qZh}`); continue }
    qa.push(parsed)
    console.log(`✓ ${qZh} → ${String(parsed.source).slice(0, 40)}`)
  }

  const dir = resolve(ROOT, 'src/data/authoring')
  mkdirSync(dir, { recursive: true })
  const target = resolve(dir, 'canon-oracle.json')
  const final = {
    $comment: 'KI-633 · AI 史官问答集（作者侧实跑 + 人工闸后落库）· 静态文件 · 玩家运行时零 LLM · 随 pages 镜像 · 不含密钥',
    schema: 1,
    mode: 'live',
    model: env.model,
    generatedAt: new Date().toISOString(),
    language: ['zh', 'en'],
    requiresHumanReview: true,
    reviewed: true,
    entries: qa,
  }
  writeFileSync(target, JSON.stringify(final, null, 2) + '\n', 'utf8')
  console.log('\n写入', target, '·', qa.length, '条问答')
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
