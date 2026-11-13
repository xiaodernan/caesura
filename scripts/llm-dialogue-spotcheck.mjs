/**
 * scripts/llm-dialogue-spotcheck.mjs —— 单点声线评估（作者侧，一次结论）。
 *
 * 用于「已 flag 但作者暂保留」的一行，再请一次第三方视角。不改写、零写入。
 * 用法：node scripts/llm-dialogue-spotcheck.mjs
 */
import { pathToFileURL } from 'node:url'
import { authorLlmEnv } from './caesura-author-env.mjs'
import { callLlm, buildBibleMessages } from './caesura-llm-client.mjs'
const isCliInvocation = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

const LINE = '声卷全了。她该唱的、不该唱的，都在这儿了。以后休垒如果还有人唱这首歌，就知道是谁留下来的了。'

export function buildSpotcheckUserContent(line = LINE) {
  return [
    '你是 CAESURA《止音纪元》的声线总监。',
    'NPC DLG_MEG（npc_meg · Act 2 hub 收尾 · emotion quiet）在 n8 的真白独白，原文：',
    `「${line}」`,
    '请在 150 字内只回答三处结构化意见（每处一行）：',
    '1) 是否过白（voice vs translationese）？3) 若要保留请点出最强的融入 NPC 声线的理由。',
    '4) 若要删减请指出最大的弊病位置。5) 总裁决 keep | pending | flag',
    '不得说"作为一个AI"；不得事事迎合；不得回答与本行无关的内容。',
  ].join('\n')
}

if (isCliInvocation) {
  if (!authorLlmEnv().apiKey) {
    console.error('[llm:spotcheck] missing CAESURA_LLM_API_KEY（env 注入；绝不落 git）：exit 2')
    process.exit(2)
  }
  const out = await callLlm(buildBibleMessages({
    npcMode: 'canon',
    user: buildSpotcheckUserContent(LINE),
    maxTokens: 400,
    temperature: 0.2,
  }))
  console.log('[llm:spotcheck] status=' + out.status + ' tokens=' + (out.usage?.total_tokens ?? '?') + ' cached=' + out.cachedTokens + '/' + (out.usage?.prompt_tokens ?? '?'))
  console.log(out.text)
  console.log('--- 作者侧 · 零写入 · 作者仍保有终裁权 ---')
}if (!authorLlmEnv().apiKey) {
    console.error('[llm:spotcheck] missing CAESURA_LLM_API_KEY（env 注入；绝不落 git）：exit 2')
    process.exit(2)
  }
