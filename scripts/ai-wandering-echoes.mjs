/**
 * scripts/ai-wandering-echoes.mjs — KI-736 ·「拾遗」世界细节遭遇的作者侧候选生成器
 *
 * 定位：玩家感到「看着很大、里面很空」时，缺的不是主线，而是**走着走着遇见一段细节**的密度层。
 * 本脚本让 gpt-6.2-sol 按八区各写一条双语「拾遗」：只写物件与动作、不写抒情、必须有 canon 锚点。
 * 产物落 `src/data/authoring/wandering-echoes-candidates.json`（人工闸，机器初稿）；
 * **不直接改运行时表**——`src/data/json/wandering-echoes.json` 由人工从候选里策展（逐条核 canon）。
 *
 * 纪律：玩家进程零 LLM；runtime:false / authorOnly:true / requiresHumanReview:true /
 * containsCredentials:false；密钥只走 env；稳定 system 前缀（利于前缀缓存）。
 *
 * 运行：node --env-file=.env scripts/ai-wandering-echoes.mjs --live
 *       node scripts/ai-wandering-echoes.mjs            （offline 结构自检，零网络）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { authorLlmEnv } from './caesura-author-env.mjs'
import { callLlm, applyAuthorProxyFromEnv, derivePromptCacheKey } from './caesura-llm-client.mjs'
import { buildWorldCorpus, buildIndex, retrieve } from './lib/world-rag.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const LIVE = process.argv.includes('--live')
const NOW = new Date()

/** 稳定前缀：canon 事实 + 笔法 + 契约。措辞刻意固定，重复运行逐字相同（前缀缓存友好）。 */
const SYSTEM_PREFIX = [
  '你是止音纪元的世界细节写作者。任务不是推进剧情，而是给每一区写一条「拾遗」——玩家走着走着撞见的一小段具体之物。',
  '【canon 事实（只能照此写，不得新造神名/地名/人名）】',
  '区域：休垒（rg_resthold）、雾语林（rg_whisperwode）、沉唱堂（rg_drowned_choir）、破拍营地（rg_brokenbar_camp）、钟坠院（rg_fellcarillon）、无耳深窖（rg_earless_deeps）、未竟厅（rg_unfinished_hall）、风钟海岸（rg_windcoast）。',
  '人物与物件：钟摆渡人、阿汐、薄簿、余响集、回廊钟、落钟、盐、干痕、低音之城、老大师、恩希尔、拾钟人、灯匠。',
  '【笔法】物件说话，不抒情，不解释意义；一条只写一个动作或一个痕迹；不超过六十字；留白。',
  '【硬约束】① 每条必须落到一个 canon 锚点（锚点逐字取自给定 anchors）；② 中文不得夹英文单词；',
  '③ id 形如 we_<区域短名>_<小写蛇形>；④ 只输出 JSON，不要解释。',
].join('\n')

const REGIONS = [
  { id: 'rg_resthold', nameZh: '休垒', hint: '宿营与门边空碗，火与灰' },
  { id: 'rg_whisperwode', nameZh: '雾语林', hint: '树皮上的刻痕、被听走的声音' },
  { id: 'rg_drowned_choir', nameZh: '沉唱堂', hint: '没唱完的那一拍、水下的音' },
  { id: 'rg_brokenbar_camp', nameZh: '破拍营地', hint: '断掉的拍、修补的痕迹' },
  { id: 'rg_fellcarillon', nameZh: '钟坠院', hint: '落钟与钟壳内侧' },
  { id: 'rg_earless_deeps', nameZh: '无耳深窖', hint: '盐、干痕、看不见的账' },
  { id: 'rg_unfinished_hall', nameZh: '未竟厅', hint: '管风琴、没有写完的那一页' },
  { id: 'rg_windcoast', nameZh: '风钟海岸', hint: '风、绳结、远行的记号' },
]

function buildTask(anchors) {
  return [
    '【任务】为下列八区各写一条「拾遗」候选。每一条必须贴合该区 hint，不得八条共用一个意象。',
    '**同一 canon 锚点最多用两次；不同区域不得写几乎相同的一句。**',
    '每区一条，共八条；每条：{"id":"we_xxx_yyy","regionId":"rg_xxx","titleZh":"≤6字","titleEn":"≤4 words","textZh":"≤60字","textEn":"≤40 words","canonAnchor":"逐字取自 anchors","requiresFlag":null,"weight":3}。',
    '【八区与各自的 hint】',
    ...REGIONS.map((r) => `- ${r.id}（${r.nameZh}）：${r.hint}`),
    '【anchors（canon 检索结果，canonAnchor 必须逐字取自其中一条的片段）】',
    ...anchors.map((a, i) => `${i + 1}. ${a}`),
    '只输出 {"candidates":[...]} 的 JSON。',
  ].join('\n')
}

function parseJsonLoose(text) {
  if (!text) return null
  const fence = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i)
  const t = fence ? fence[1] : String(text)
  try { return JSON.parse(t) } catch { /* fall through */ }
  const s = t.indexOf('{')
  const e = t.lastIndexOf('}')
  if (s >= 0 && e > s) { try { return JSON.parse(t.slice(s, e + 1)) } catch { return null } }
  return null
}

async function main() {
  const errors = []
  let canon = []
  try {
    const corpus = buildWorldCorpus(ROOT)
    const index = buildIndex(corpus)
    canon = retrieve(index, '回廊钟 薄簿 余响集 盐 干痕 落钟 管风琴 绳结 刻痕 水位 火 灰 钟声 渡人', 10).map((h) => h.chunk.slice(0, 120))
  } catch (e) { errors.push({ node: 'retrieveCanon', message: String((e && e.message) || e) }) }
  const anchors = canon.length ? canon : ['回廊钟', '薄簿', '余响集', '盐', '干痕']

  let candidates = []
  let mode = 'offline'
  let model = null
  let usage = { calls: 0, cachedTokens: 0, promptTokens: 0, statuses: [] }

  if (LIVE) {
    const env = authorLlmEnv()
    if (!env.apiKey) { console.error('missing CAESURA_LLM_API_KEY（env 注入）'); process.exit(2) }
    await applyAuthorProxyFromEnv()
    mode = 'live'
    model = env.model
    const body = {
      model: env.model,
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.85,
      max_tokens: 1400,
      messages: [
        { role: 'system', content: SYSTEM_PREFIX },
        { role: 'user', content: buildTask(anchors) },
      ],
    }
    body.prompt_cache_key = derivePromptCacheKey(body.messages)
    let out
    try { out = await callLlm(body, { baseUrl: env.baseUrl, apiKey: env.apiKey }) } catch (e) {
      console.error('[ai-wandering-echoes] call failed:', e?.message || e); process.exit(2)
    }
    usage = { calls: 1, cachedTokens: out.cachedTokens ?? 0, promptTokens: out.usage?.prompt_tokens ?? 0, statuses: [out.status] }
    const parsed = parseJsonLoose(out.text)
    if (!parsed?.candidates) { console.error('[ai-wandering-echoes] JSON 解析失败 head=', String(out.text).slice(0, 200)); process.exit(2) }
    candidates = parsed.candidates
  } else {
    // offline：只产出空候选骨架，供结构自检；绝不当真机读数。
    candidates = []
  }

  const artifact = {
    schema: 1,
    kind: 'wandering-echo-candidates',
    ki: 'KI-736',
    generatedAt: NOW.toISOString(),
    mode,
    model,
    anchors,
    regions: REGIONS.map((r) => r.id),
    candidates,
    usage,
    errors,
    runtime: false,
    authorOnly: true,
    requiresHumanReview: true,
    containsCredentials: false,
  }
  const p = resolve(ROOT, 'src/data/authoring/wandering-echoes-candidates.json')
  const eol = existsSync(p) && readFileSync(p, 'utf8').includes('\r\n') ? '\r\n' : '\n'
  writeFileSync(p, JSON.stringify(artifact, null, 2) + eol, 'utf8')
  const hit = usage.promptTokens ? Math.round((usage.cachedTokens / usage.promptTokens) * 1000) / 10 : 0
  console.log(`[ai-wandering-echoes] mode=${mode} model=${model ?? '-'} candidates=${candidates.length} · llm_calls=${usage.calls} cached=${usage.cachedTokens}/${usage.promptTokens} hit=${hit}%`)
}

main().catch((e) => { console.error('[ai-wandering-echoes] fatal:', e?.message || e); process.exitCode = 1 })
