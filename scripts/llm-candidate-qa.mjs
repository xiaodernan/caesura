/**
 * scripts/llm-candidate-qa.mjs —— 候选口令「声线评分卡」（作者侧）。
 *
 * <p><b>做什么</b>：读 `src/data/authoring/llm-voice-candidates.json`（6 条 DLG_* 候选），
 * 为每条候选向 LLM 发出一张「声线评分卡」请求（verdict: keep / pending / flag + 一行理由）。</p>
 *
 * <p><b>不做什么</b>：
 *   ① 不改写任何 JSON——落盘权永远在作者；事实上本脚本零写入。
 *   ② 不替作者下结论——LLM 的「keep/pending/flag」只是一张便签；作者才是真审阅人（你本人）。
 *   ③ 不进任何玩家运行时——玩家进程零 LLM；本脚本只在 shell 里跑。
 * </p>
 *
 * <p><b>诚实边界</b>：同 `llm:qa` 有相同幻觉偏差；LLM 会倾向 keep 每一句它自己写的句子。
 * 所以结果只能用来指导「先读哪一句」，不能用作评估完成态（final sign-off）。</p>
 *
 * 用法：
 *   $env:CAESURA_LLM_API_KEY = 'sk-...'
 *   node scripts/llm-candidate-qa.mjs           # 默认打印 Markdown 可粘贴的评分卡
 *   npm run llm:cand-qa                         # 同上
 *
 * @module llm-candidate-qa
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { callLlm, buildBibleMessages } from './caesura-llm-client.mjs'

const BASE = process.env.CAESURA_LLM_BASE_URL ?? 'https://wkapi.pro/v1'
const API_KEY = process.env.CAESURA_LLM_API_KEY ?? ''
const MODEL = process.env.CAESURA_LLM_MODEL ?? 'gpt-6-sol'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const REGISTRY = [
  { id: 'DLG_MEG', canonOpening: '别站那么近，你踩到我摊子了。……等等。你胸口那颗音色石，灭的。莉安给你的吧？', style: 'blunt / dry / sell-tired irony' },
  { id: 'DLG_BELLTONGUE', canonOpening: '站住。你耳后那道旧伤，是不是莉安剪的？', style: 'short-bodyline / visceral / curious-wound-probe' },
  { id: 'DLG_CORVIN', canonOpening: '站住。你身上有遗响的余味，而且很新。……律政院末代档案官，科温。我在写一本书，书里缺一节：会唱歌的核。', style: 'bibliophile-earnest / aphoristic-ish / nest-cases framing' },
]

/** 纯函数：构造 LLM 用户消息正文（不调 LLM、可单测）。 */
export function buildCandQaUserContent(candidates) {
  const lines = []
  for (const c of candidates) {
    const meta = REGISTRY.find((r) => r.id === c.dlgId) ?? { id: c.dlgId, canonOpening: '?', style: '?' }
    lines.push(`### ${c.dlgId} · ${c.npc ?? '?'} · emotion=${c.emotion ?? '?'}`)
    lines.push(`canonOpening: ${meta.canonOpening}`)
    lines.push(`style: ${meta.style}`)
    for (const [i, line] of (c.lines ?? []).entries()) {
      lines.push(`候选 ${i + 1}. ${line}`)
    }
    lines.push('')
  }
  return [
    '你是 CAESURA《止音纪元》的声线总监助手。请逐候选行给一张便签式评分卡，严格使用以下 JSON 单行输出（无代码块、无前后缀）：',
    '\n{"verdict":"keep"|"pending"|"flag","reason":"≤30字"}\n',
    `需要分析的 NPC 候选（${candidates.length} 条）：`,
    ...lines,
    '规则：每条候选单独一行评分；verdict 只能是 keep/pending/flag；reason ≤30字；不得开始/结束对话、不得道歉、不得加语气。',
  ].join('\n')
}

async function callLlmPack(userContent) {
  return callLlm(buildBibleMessages({
    npcMode: 'canon',
    user: userContent,
    maxTokens: 1200,
    temperature: 0.1,
  }))
}

const isCliInvocation = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCliInvocation) {
  if (!process.env.CAESURA_LLM_API_KEY) {
    console.error('[llm:cand-qa] missing CAESURA_LLM_API_KEY（env 注入，密钥绝不落盘/进 git）—— exit 2')
    process.exit(2)
  }
  const raw = readFileSync(resolve(ROOT, 'src/data/authoring/llm-voice-candidates.json'), 'utf8')
  const candidatesFile = JSON.parse(raw)
  const candidates = candidatesFile.candidates ?? []
  if (!candidates.length) { console.error('[llm:cand-qa] 候选池为空，退出'); process.exit(2) }
  console.log('[llm:cand-qa] base=' + BASE + ' model=gpt-6-sol candidates=' + candidates.length)
  const userContent = buildCandQaUserContent(candidates)
  const out = await callLlmPack(userContent)
  console.log('status=' + out.status + ' · ' + out.dt + 'ms · totalTokens=' + (out.usage?.total_tokens ?? '?') + ' cached=' + out.cachedTokens + '/' + (out.usage?.prompt_tokens ?? '?'))
  console.log('--- 便签原文（作者裁决后请自行誊到 QA 文档） ---')
  console.log(out.text)
  console.log('--- 诚实声明：LLM 便签不下定论；事实裁决权在作者；本脚本零写入 ---')
}
