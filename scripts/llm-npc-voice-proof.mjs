/**
 * scripts/llm-npc-voice-proof.mjs —— NPC 声线真生成探测（开发者侧 · 真 LLM）
 *
 * 与游戏运行时零 API 依赖；本脚本是作者侧工具：读 dialogue.json 七位 NPC 的
 * 开场白与情绪标注，调 OpenAI 兼容端点让真模型按**游戏已建立的叙事风格约束**
 * 写出其余可能的开场，供写作者选用。不改写、不声称 LLM 生成内容进入玩家运行时。
 *
 * 用法:
 *   $env:CAESURA_LLM_API_KEY = 'sk-...'
 *   node scripts/llm-npc-voice-proof.mjs [--model gpt-6-sol] [--all] [--npc DLG_BELLTONGUE]
 *
 * 诚实边界：失败则诚实 exit 2（429/401/network），绝不假造模型回复；输出标记 via=<model>。
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { callLlm, buildBibleMessages } from './caesura-llm-client.mjs'

const BASE = process.env.CAESURA_LLM_BASE_URL ?? 'https://wkapi.pro/v1'
const API_KEY = process.env.CAESURA_LLM_API_KEY ?? ''
const MODEL = (() => {
  const a = process.argv.slice(2)
  const i = a.indexOf('--model')
  if (i >= 0 && a[i + 1]) return a[i + 1]
  return process.env.CAESURA_LLM_MODEL ?? 'gpt-6-sol'
})()
const SELECTED_NPC = (() => {
  const a = process.argv.slice(2)
  const i = a.indexOf('--npc')
  return i >= 0 ? a[i + 1] : null
})()

const POINTS = [
  {
    id: 'DLG_MEG',
    npc: 'npc_meg',
    emotion: 'bored',
    where: '休垒街 / 旧货摊',
    who: '莉安旧友；表面嫌你搅摊生意，内里是为一缕“音色之石”的善意',
    canonOpening: '别站那么近，你踩到我摊子了。……等等。你胸口那颗音色石，灭的。莉安给你的吧？',
    style: ['blunt', 'dry', 'low-pulse menace', 'sell-tired irony'],
    ask: '请替她写 3 句别的可能开场（中文，每句都必须「冷一点、短一点、像她活着摊子上等得不耐烦」）。',
  },
  {
    id: 'DLG_BELLTONGUE',
    npc: 'npc_belltongue',
    emotion: 'guarded',
    where: '休垒内环 / 剪铃场',
    who: '少年剪铃师；对“任何剪断的东西”有令人窒息的介怀',
    canonOpening: '站住。……左耳那串断铃，剪的时候疼吗？',
    style: ['short-bodyline', 'curious-wound-probe', 'visceral'],
    ask: '请替他写 3 句别的可能开场（中文，保留“伤口提问”的质地）。',
  },
  {
    id: 'DLG_CORVIN',
    npc: 'npc_corvin',
    emotion: 'curious',
    where: '休垒档案馆 / 书堆间',
    who: '律政院末代档案官；整个档案馆卷帙因为他的“遗响之核”奇想都失势了',
    canonOpening: '站住。你身上有遗响的余味，而且很新。……律政院末代档案官，科温。我在写一本书，书里缺一节：会唱歌的核。',
    style: ['bibliophile-earnest', 'aphoristic-ish', 'nest-cases framing'],
    ask: '请替他写 2 句别的可能开场（中文，保持书生语气与“遗响”信仰）。',
  },
]

const isCliInvocation = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

async function callLlmWithPrompt({ bibleKey = 'canon' } = {}) {
  const sys = bibleKey === 'short' ? '你是《止音纪元》的中文 NPC 对白编剧。短句、克制、不翻译腔。' : undefined // unused — kept for symmetry
  const body = buildBibleMessages({
    npcMode: 'canon',
    user: POINTS.filter((p) => !SELECTED_NPC || p.id === SELECTED_NPC)
      .map((p) => `NPC id: ${p.id}（emotion: ${p.emotion}）\n`
        + `Where: ${p.where}\n`
        + `Who: ${p.who}\n`
        + `Canon opening: ${p.canonOpening}\n`
        + `Style: ${p.style.join(' / ')}\n`
        + p.ask)
      .join('\n\n'),
    maxTokens: 900,
    temperature: 0.72,
  })
  return callLlm(body)
}

if (isCliInvocation) {
  const t0 = Date.now()
  if (!API_KEY) {
    console.error('[llm-npc-voice-proof] missing CAESURA_LLM_API_KEY — 设环境变量后再跑；key 不落库。')
    process.exit(2)
  }
  console.log(`[llm-npc-voice-proof] base=${BASE} model=${MODEL}`)
  const out = await callLlmWithPrompt({})
  const dt = Date.now() - t0
  console.log(`[llm-npc-voice-proof] HTTP ${out.status}  (${out.dt} ms)`)
  if (!out.ok) {
    console.error('[llm-npc-voice-proof] 端点未正常：', out.text?.slice(0, 600) ?? out.raw?.slice(0, 600) ?? out)
    process.exit(2)
  }
  const choice = out.text ?? '(空回)'
  console.log('=== 模型返回（真 LLM · 未改写） ===')
  console.log(choice)
  console.log('usage:', JSON.stringify(out.usage ?? null))
  console.log(`每次缓存命中 cached=${out.cachedTokens}/${out.usage?.prompt_tokens ?? '?'} tokens`)
  console.log('--- 本脚本只向作者输出内容，不把任何 LLM 输出写进数据/玩家侧。 ---')
}
