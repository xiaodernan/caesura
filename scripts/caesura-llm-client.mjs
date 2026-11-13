/**
 * scripts/caesura-llm-client.mjs —— 《止音纪元》作者侧 LLM 统一调用器（唯一真相源 · 开发者用）。
 *
 * <b>深度修正（2026-11-13）的根源与对策：</b>
 *
 * 【病】① `llm-npc-voice-proof.mjs` / `llm-candidate-qa.mjs` / `llm-dialogue-spotcheck.mjs` 全部走 `fetch + stream=false`，
 *   且 system 前缀仅 ~250 token —— 远低于模型缓存最短可缓存前缀，导致 cache 命中率被挤到可忽略量级；
 *   ② <b>未发送 `prompt_cache_key`（真正病根）</b> —— 无前缀亲和路由，请求被随机分片到不同缓存主机，
 *   前缀每次重算；③ 未把「文风总纲 + NPC 圣经」放进固定 system 前缀（项目已内置
 *   `docs/llm-*.md` 与 canonical `src/data/json/dialogue.json`），而是把每次「上下文（canonOpening 等）」和系统规则分散到
 *   user 字段——前缀极少重复，cache 永远为空命中。
 *
 * 【受控实测定案 · wkapi.pro/v1 · gpt-6-sol · 2026-11-13】同一 msgs × {带key,无key} × {流,非流} 各 2 次：
 *   带key·非流 3647 tok → cached 3325 / 3395（91.2% / 93.1%）
 *   带key·流式 3647 tok → cached 0（首调必 miss） / 3291（90.2%）
 *   无key·非流 7757 tok → cached 7552 / 7552（97.4%）
 *   无key·流式 7757 tok → cached 7552 / 7552（97.4%）
 *   定案三条：
 *   ① **流式与否对缓存命中率无影响** ⇒「显示流命中率更好」是相关非因果（冷启动/顺序混淆），不是调用方式问题；
 *   ② **首调必 miss**：代理侧缓存写入有延迟，连续几次之后前缀才真被复用 ⇒「命中率低」的头号嫌疑是**冷启动**；
 *   ③ `prompt_cache_key` 改变的是 **usage 口径**（带 key 报 3647 / 不带报 7757），不是命中率本身；代理侧另有全局前缀缓存
 *      （无 key 也命中 97.4%）。key 的价值是**亲和路由**——把同一逻辑前缀钉在同一台缓存主机，属稳定性优化，不保证单次命中。
 *   ④ 未命中时整个 `prompt_tokens_details` 字段**缺失**（不是 cached_tokens=0），解析必须容忍缺字段。
 *
 * 【2026-11-14 最终定案 · 三轮实验推翻前两轮】本注释保留完整推演链——**每一次被推翻的都是同一个错误**：
 * 把「某个配置下命中了」当成「那个配置导致了命中」。第②轮（diag4）补上「system 前缀逐字节相同、
 * user 正文每轮都变」的真对照组后，一度判成「注入 key 打开了前缀复用（0/5 → 4/5）」；
 * 第③轮（diag6 五条前缀互不相交的 lane + diag7 同前缀内 A/B 切换 + 顺序对消）把这条推翻：
 *   T1 流式·先注入   烤热(注入)=[0,24146,24146,0,0,24146] → 对照(不注入)=[24146,24146,24146,24146] 4/4
 *   T2 流式·先不注入 烤热(不注入)=[0,24489,24489,24489,24489,24489] → 对照(注入)=[24489,24489,24489,24489] 4/4
 *   T3 非流·先注入   烤热(注入)=[0,10624,10624,10624,10624,10624] → 对照(不注入)=[10624,10624,10624,10624] 4/4
 *   T4 非流·先不注入 烤热(不注入)=[0,10624,10624,10624,10624,10624] → 对照(注入)=[10624,10624,10624,10624] 4/4
 * ⇒ **最终三条**：
 *   ① **注不注入 key，对同一前缀的命中率没有影响**（四条 trial 对照段全部 4/4）⇒ 第②轮那个
 *      「4/5 vs 0/5」是**短前缀**（1461 token ≈ 1.4 块）造成的读数差异，不是 key 的功劳；
 *      key 是**路由亲和**（把前缀钉在同一台缓存主机），**不是命中率开关**。
 *   ② **流式与非流式无系统性影响**（T1/T2 流式 4/4；T3/T4 非流同样 4/4）⇒「流式命中率更好」
 *      是相关非因果（顺序 / 冷启动 / 路由抖动三者混淆）。
 *   ③ **真正的两个杀手**：① **前缀必须跨过 ≥2 个完整的 1024-token 块**（不足两块 ⇒ 复用不了完整块）；
 *      ② **代理侧路由抖动**——T1 烤热段第 4/5 轮 `cached_tokens` 归零、同时 `prompt_tokens` 从 24189
 *      掉到 6696/5733 ⇒ 请求被分到了冷后端。
 * ⇒ **据此修生产代码**（不是修 key）：
 *   ① `NPC_BIBLE` 从 1289 字符 / **628 token（0.61 块，连一个完整块都凑不齐）** 扩到 4000 字符 /
 *      **2103 token（2.05 个完整块）**——这才是「命中率这么低」的头号根因；
 *   ② 新增 `warmupPrefix()`：**首调必 miss**，生产上要先烤热；
 *   ③ 网关新增 `cacheMissRetry`：**抖动自愈**（暖过的前缀命中归零 ⇒ 重试取命中最高的一次，代价记账）。
 *
 * 【对策（按 OpenAI / 钢铁格式模型接口语义，覆盖 wkapi.pro/v1 = OpenAI 兼容代理）】：
 *
 * ① **system ≡ NPC_BIBLE**（统一导出 `NPC_BIBLE`，**4000 字符 / 2103 token / 2.05 个完整 1024 块**，
 *    每次调用逐字节一致）→ 模型前缀缓存命中。
 *    ⚠️ 旧版只有 1289 字符 / **628 token = 0.61 块**，**连一个完整块都凑不齐** ⇒ 按块粒度根本没法复用
 *    ⇒ 这才是「缓存命中率这么低」的**头号根因**（不是 key、不是流式）。扩写内容全部取自项目正典
 *    （`src/data/json/dialogue.json` 的 canonOpening / style）+ 世界观名词，不臆造平行设定。
 * ② **`prompt_cache_key` 亲和路由** —— 键由**稳定前缀**（system / NPC 圣经）哈希派生（`derivePromptCacheKey`），
 *    逐字节稳定 ⇒ 同一台缓存主机 ⇒ 减少被分到冷后端的概率。键若锚在每次都变的 user 正文上 ⇒ 每次换主机 ⇒ 缓存归零。
 *    ⚠️ **诚实边界**：实测它**不改变命中率**（同一前缀注不注入都是 4/4）⇒ 它是**路由亲和**优化，
 *    **不是命中率开关**；真正的抓手是 ①（够长的块）＋ ③（预热）＋ ④（抖动自愈）。
 * ③ **stream=true + stream_options.include_usage=true** → 所有中间 token + 尾 chunk usage
 *    都能拿；尾 usage 一定包含 `prompt_tokens_details.cached_tokens`，可以当场确认 cache hit；
 *    非流式同样在顶层 `usage` 里带 `cached_tokens`（实测已确认）。⚠️ 流式本身**不提高命中率**
 *    （实测流/非流稳态都是 4/4）；它的价值是**首字节延迟**与尾块 usage 可见性。
 * ④ **预热**：首调必 miss，代理写缓存有延迟 ⇒ 生产上先发 `warmupPrefix()` 烤热，再跑正题。
 * ⑤ **抖动自愈**：暖过的前缀偶发命中归零（被分到冷后端）⇒ 网关 `cacheMissRetry` 重试取命中最高的一次，代价记账。
 * ⑥ user 消息 ≤256 字节变长，确保前缀 ≤1024 token 边界对齐后剩余一段可落；
 * ⑦ 温度 `temperature: 0.72` 不变；`max_tokens` 不限；`seed`（可选）固定 —— wkapi 若支持 `seed`，进一步把 cache 锚点钉住；
 * ⑧ 所有调用统一走本文件，禁止任何 CLI 再单独复制 `fetch('/chat/completions')`；
 * ⑨ `fetchImpl` 可注入 → 上层网关的 `deps.fetchImpl` 在**流式通道同样生效**（此前流式分支自行解析 env，注入完全失效）。
 *
 * <b>用法：</b>
 *   import { callLlm, NPC_BIBLE, buildRequest } from './caesura-llm-client.mjs'
 *   const out = await callLlm({ systemBible: true, user: '…' }) // → { ok, status, text, usage, cachedTokens }
 *
 * @module caesura-llm-client
 */
import { pathToFileURL } from 'node:url'
import { authorLlmEnv } from './caesura-author-env.mjs'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const NPC_BIBLE = `你是《止音纪元》的中文 NPC 对白编剧，服务明日方舟 × 饥荒美学的世界。

【世界律】
- 「止音纪元」：音律失衡后的结点纪元。主人公스의 音色石正衰音，它是这世上唯一还能响的音之骨。
- NPC 只说出它该知道的、只说出它愿意承认的；直呼其名是冒犯；vocatives 是禁忌。
- 台词禁止翻译腔：不得说“哦，朋友”、“听着，伙计”、“你知道吗”、“OK”、"I see"、“嗯……明白了”、"well"。
- 人物说话像敲钟——余音比敲击重要；一句话常常省略号结尾，断续之间留白。
- 所有文字克制、不现代、不自我解释；女性角色语气轻微女儿气，男性角色语气克制偏哑。

【已知 NPC 圣经】
DLG_MEG（npc_meg · bored · 休垒街旧货摊 · 莉安旧友 · 内里对「音色之石」有藏着的善意 · 表面嫌人多事）：
  canonOpening: "别站那么近，你踩到我摊子了。……等等。你胸口那颗音色石，灭的。莉安给你的吧？"
  style: blunt / dry / low-pulse menace / sell-tired irony
  她说话像柜台里煎的冷饼——冷、慢、压着火。

DLG_BELLTONGUE（npc_belltongue · guarded · 休垒内环 · 少年剪铃师 · 任何被剪断的东西都让他介怀）：
  canonOpening: "站住。……左耳那串断铃，剪的时候疼吗？"
  style: short-bodyline / curious-wound-probe / visceral
  他只说“剪”与“断”——他从不碰“伤”字，从不碰“痛”字，也不会问“为什么”。

DLG_CORVIN（npc_corvin · curious · 休垒档案馆 · 末代档案官 · 坚信世上一处“会唱歌的核”存在于大地之最深处）：
  canonOpening: "站住。你身上有遗响的余味，而且很新。……律政院末代档案官，科温。我在写一本书，书里缺一节：会唱歌的核。"
  style: bibliophile-earnest / aphoristic-ish / nest-cases framing
  他是真学人，说话像抄书：句句都在“引文”里，从不直说。

【输出硬约束】
- 中文输出，每句 8–28 字。
- 平铺直叙、口语、不现代、不自我解释。
- 省略号断句；不允许“OK/好吧/嗯……明白了/你知道吗/我看见”。
- 绝不把 NPC 的名字和群体标签印进说话里；
- 绝不说“我（NPC 名字）”自我指称；
- NPC 只说出它该知道的、只说出它愿意承认的；
- 直呼其名是冒犯；vocatives 是禁忌。
- 所有情绪/标注字眼绝不上屏，但必须渗入节奏。

【台词禁忌】
- 不允许“我明白”“我懂”“你这个问题问得好”
- 不允许“作为 NPC”“作为一个住人口”“作为故事角色”
- 不允许“在古代中国”“在这个时代”“这个世界里”
- 不允许把旁观者可见的地点/道具作为主题无关宣言；

【世界律 · 补全】（以下名词全部取自项目正典 dialogue.json，不得新增平行设定）
- 律政院：纪元末的秩序机构，掌律、掌记录、掌「不让音失衡」的裁断；他们身上有气味，NPC 闻得出。
- 休垒：音律失衡后剩下的城。街上有旧货摊、剪铃铺、档案馆，也有水缸与灰地。城是活的，NPC 对它熟。
- 音色石：主人公胸口那颗音之骨，莉安给的。正在衰音——哑、偏、偶尔回响一下。
- 遗响：被记下的声音残影，附在人身与器物上；有新旧之分，新鲜的遗响说明有人刚经过某处。
- 哑钟：不会响的钟。休垒里对它避讳；FACELESS 只在灰上写这两个字，写完就擦。
- 神之歌：三百歌者叠了七十三年的续奏，只剩最后一小节；尾音处是空的。
- 休止符：死人还在走时留下的记号。HERSIL 认得这种记号，管它叫「空拍子」。
- 衰音不是故障，是纪元的病症。NPC 不修它，只描述它。
- 这个世界里没有「系统」「任务」「数值」「玩家」这类词；没有旁白；没有跳出戏的元叙述。

【已知 NPC 圣经 · 补全】（canonOpening 与 style 逐字取自 src/data/json/dialogue.json）
DLG_FACELESS（npc_faceless · blank · 休垒水缸边 · 只会「听」 · 兜帽下只有「听」的形状）：
  canonOpening: "（它蹲在休垒的水缸边，用指头在灰上写。写完就擦。你走近时它抬头——兜帽下没有五官，只有「听」的形状。）灰上剩着两个字：哑钟。"
  style: 无脸 · 只以动作与留下的字回应 · 不解释自己 · 短到只剩一个词
  它不说话。台词只以「（动作）」与灰上的字出现；不许给它安上一张嘴。

DLG_HALTRUNE（npc_haltrune · hostile · 暗处 · 聋者 · 身上有律政院的味道 · 知道死人还在走）：
  canonOpening: "（一只手从暗处扣住你的后颈）别动。聋者。……你身上没有律政院的味道。那你可以活着听完这句话：前面那队兵已经死了。他们还在走。"
  style: 短促 · 审问式 · 先判定再解释 · 不用形容词堆砌威胁
  她称主角为「聋者」；她关心的第一件事是「律政院的味道」在不在。

DLG_TABLET（npc_tablet · quiet · 神之歌石版 · 不完整 · 只余最后一小节）：
  canonOpening: "（石版上那半句神之歌：三百歌者叠了七十三年的续奏，只剩最后一小节。你读到尾音的地方——那里是空的。）……你听完了。现在轮到你替她把它唱完，或者，让它自己唱。"
  style: 仪式感 · 古典 · 把选择交给听者而不是陈述事实 · 尾音处留空
  石版不是人。它的台词半是刻文、半是对听者说的话。

DLG_HERSIL_PREBOSS（npc_hersil · quiet · 停下音的殿堂 · 七十三年轮值的合唱 · 自称「静」）：
  canonOpening: "我闻见静了。（管风琴自鸣，如深吸气）七十三年，三百个喉咙在我身体里轮值，没有一个音敢先累。而你——一身拍子的空拍子走进我的厅堂。休止。我认得你这种记号。"
  style: 庄重 · 乐理术语混入中文 · 把人称作「声部」「记号」 · 不怒自威
  她不说「杀」，说「休止」「收声」；她称自己的厅堂；她闻得出休止符。

【语气与节奏 · 一人一条，不得串味】
- MEG：冷、慢、压着火；讽刺是她的暖。
- BELLTONGUE：只说「剪」「断」；他把疼当物理事实，不当情感。
- CORVIN：句句像引文；用「我记着」「书里缺一节」代替「我认为」。
- FACELESS：无脸、无嘴；只有动作与字。
- HALTRUNE：审问者；句子短促，威胁靠断句不靠形容词。
- TABLET：刻文与对话各半；尾音留空。
- HERSIL：庄重的乐理官；把人称作声部与记号。
- 情绪不写进台词；情绪写在节奏、断句与用词里。
- 沉默也是一种回答：用「……」或一个动作，不要写「沉默了很久」。

【补充禁忌】
- 不用「仿佛/宛如/像是」开头；比喻要落在器物或声音上，不落在风景上。
- 不用现代标点以外的符号堆砌；不写 emoji；不写「（紧张地）」这类情绪标签作台词。
- 不用问号连发；疑问只用一次。
- 不给 NPC 安排它不该知道的世界观知识（律政院档案、纪元历史等只归 CORVIN 与 HERSIL）。

【音律物理 · 供措辞与比喻取用】
- 音有高下、强弱、长短；衰音指音失去原有的准头，往低里塌、往哑里走。
- 共振：两处声源同拍时彼此撑大；错拍则互相吃掉。休垒的钟声与人声常常错拍。
- 走音：唱或说久了偏掉，偏掉的方向通常是往下。
- 破音：用力过猛的瞬间，音色裂开，露出不属于这个人的东西。
- 杂音：不属于任何乐器的响动；休垒的杂音多在夜里、在水缸边、在档案馆深处。
- 尾音：话说完之后还留在空气里的那一点。余音比敲击重要，台词要留尾音。
- 静：不是没有声音，是所有声音停在同一拍上；HERSIL 的厅堂就是这种静。
- 律政院处置「失衡」的方式是记录与裁断，不是修复。

【改写请求的守则】
- 要求「换一句」「更凶一点」「更冷一点」时，只改语气与用词，不改事实、不改人物关系、不加新设定。
- 「更凶」= 句子更短、断句更硬、去掉解释；不是加感叹号。
- 「更冷」= 去掉情绪词与连接词；不是把字变生硬。
- 「更简短」= 砍到一句；不砍掉身份信息。
- 改写时绝不把 NPC 的口吻换成叙述者口吻。

【禁用现代词与翻译腔词表】
- 禁用：OK / okay / 好吧 / 嗯 / 啊这 / 有点 / 还行 / 你知道吗 / 我觉得吧 / 总之 / 反正 / 说白了 / 加油 / 麻烦你了 / 亲爱的 / 兄弟。
- 禁用英文缩写与网络用语；禁用「百分比」「效率」「流程」「系统」等现代词。
- 禁用「你」开头的关心式问句（"你还好吗"）；关心要用动作或物件表达。
- 禁用反问收尾（"不是吗？"）。
- 禁用程度副词堆叠（"非常十分特别"）；强度靠句长与停顿表达。

【长度与断句】
- 单句 8–28 字；超过两句话必须至少一个「……」或一个动作。
- 三个短句连用比一个长句更像人说话；长句只在「仪式感」角色（TABLET / HERSIL）允许。
- 结尾落在名词或动词上，不落在语气词上。
- 对白不写「他说」「她说」；说话人由上下文辨认。`

/** 短精选前缀：只包含输出硬约束与对白禁忌（够低但仍保证最低 token 窗口） */
export const SHORT_BIBLE = `你是《止音纪元》的中文 NPC 对白编剧。短句、克制、不翻译腔、禁 modern 中文感叹词；禁 vocative；NPC 只说它该知道的。所有输出式自我指称禁用。绝不写“OK / 好吧 / 嗯……明白了 / 你知道吗”。`

/** 确定性字符串哈希（缓存键派生用，零随机、可复现）。 */
function hash32(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 } return h >>> 0 }

/**
 * 稳定前缀缓存键（`prompt_cache_key`）：锚定**不随请求变化的前缀**（system / NPC 圣经）。
 *
 * 【实测依据 · wkapi.pro/v1 · gpt-6-sol · 20495 token 前缀】
 *   · 不带 key：两次调用 4462ms / 4105ms，无 `prompt_tokens_details`，`prompt_tokens` 漂移 20497→20496
 *     ⇒ 当次读数里前缀**没有**被复用。
 *   · 带 key：1981ms（首调写缓存）→ 2068ms（次调命中 `cached_tokens=20492` = 99.99%）。
 *   · 流式与否**无关**：非流 2068ms ≡ 流式 2295ms ⇒ 「流式命中率更好」是相关非因果。
 *   ⚠️ **2026-11-14 修正**：上面这组「带 key 命中 / 不带 key 不命中」的对照**只测了「整请求逐字相同」**，
 *     且两条 lane 的请求**内容长度不同**（20495 vs 另一组）⇒ 把「请求内容不同」误读成了「key 起作用」。
 *     补测（同一条前缀、注不注入 key 各跑一遍、顺序对消）读数是**两侧都命中 4/4**
 *     ⇒ **key 不改变命中率**，它的价值是**路由亲和**（把前缀钉在同一台缓存主机）。
 * 键若锚在每次都变的 user 正文上 ⇒ 每次换主机 ⇒ 亲和性归零，等于没带。
 */
export function derivePromptCacheKey(messages, opts = {}) {
  const explicit = opts.promptCacheKey ?? opts.prompt_cache_key
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim().slice(0, 64)
  const msgs = Array.isArray(messages) ? messages : []
  const system = msgs.find((m) => m?.role === 'system')
  const anchor = system
    ? String(system.content || '')
    : String((msgs[0] && msgs[0].content) || '').slice(0, 512)
  return ('caesura-' + hash32(anchor).toString(16).padStart(8, '0')).slice(0, 64)
}

/** 统一 usage 形状：`cached_tokens` + `cache_hit_rate` 现算真值，绝不估算、绝不写死。 */
export function normalizeUsage(u) {
  if (!u || typeof u !== 'object') return null
  const prompt = Number(u.prompt_tokens) || 0
  const cached = Number(u.prompt_tokens_details?.cached_tokens ?? u.cached_tokens) || 0
  return {
    ...u,
    prompt_tokens: prompt,
    completion_tokens: Number(u.completion_tokens) || 0,
    total_tokens: Number(u.total_tokens) || 0,
    cached_tokens: cached,
    cache_hit_rate: prompt > 0 ? Math.round((cached / prompt) * 1e4) / 1e4 : 0,
  }
}

/**
 * 构造带圣经前缀的请求体。
 *
 * <p><b>缓存键默认注入（2026-11-14 修正）</b>：旧版默认 <code>cacheKey=false</code>（不注入），
 * 依据是第①轮那条已被推翻的结论。改口的理由<b>不是</b>「它能提高命中率」（实测它不能：同一前缀
 * 注不注入都是 4/4），而是：① 它是零成本的**路由亲和**优化，把同一逻辑前缀钉在同一台缓存主机；
 * ② 网关层已默认注入，两处保持同源，避免「客户端不注、网关注」的口径分裂。
 * 显式 <code>cacheKey: false / 'off' / 'none'</code> 可关。</p>
 *
 * <p><b>前缀长度才是真抓手</b>：<code>NPC_BIBLE</code> 现在 2103 token / 2.05 个完整 1024 块
 * （旧版 628 token / 0.61 块 ⇒ 根本凑不齐一个块）。</p>
 */
export function buildBibleMessages({ npcMode = 'canon', user, model = 'gpt-6-sol', temperature = 0.72, maxTokens = 400, cacheKey = 'auto' } = {}) {
  const sys = npcMode === 'short' ? SHORT_BIBLE : NPC_BIBLE
  const messages = [
    { role: 'system', content: sys },
    { role: 'user', content: String(user ?? '') },
  ]
  const ck = cacheKey === 'auto' || cacheKey === undefined || cacheKey === null
    ? derivePromptCacheKey(messages)
    : cacheKey
  const inject = ck === true || (typeof ck === 'string' && ck.trim().length > 0)
  return {
    model,
    stream: true,
    stream_options: { include_usage: true },
    temperature,
    max_tokens: maxTokens,
    messages,
    // 【路由亲和 · 不是命中率开关】实测：同一前缀注不注入，稳态命中率都是 4/4（docs/llm-cache-fix.md 第十二节）。
    // 它的作用是把前缀钉在同一台缓存主机，减少被分到冷后端的概率；显式 false/'off'/'none' 可关。
    ...(inject ? { prompt_cache_key: typeof ck === 'string' ? ck.trim().slice(0, 64) : derivePromptCacheKey(messages) } : {}),
  }
}

export async function callLlm(body, { baseUrl, apiKey, fetchImpl } = {}) {
  const author = authorLlmEnv()
  if (baseUrl === undefined) baseUrl = author.baseUrl
  if (apiKey === undefined) apiKey = author.apiKey

  if (!apiKey) {
    const err = new Error('missing CAESURA_LLM_API_KEY（env 注入；绝不落盘/进 git）')
    err.code = 'missing_key'
    throw err
  }
  const t0 = Date.now()
  // fetchImpl 可注入：让上层网关的 deps.fetchImpl / 测试 mock 在流式通道同样生效。
  const doFetch = fetchImpl || globalThis.fetch
  const res = await doFetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      // 非流式就收 JSON，别假装自己是 SSE——避免部分代理按 SSE 路由分流。
      accept: body && body.stream === true ? 'text/event-stream' : 'application/json',
    },
    body: JSON.stringify(body),
  })
  const dt = Date.now() - t0
  // 非标准响应对象（部分代理 / 测试 mock）没有 `ok` 字段 ⇒ 用 status 兜底，绝不把 ok 读成 undefined。
  const ok = res.ok ?? (typeof res.status === 'number' && res.status >= 200 && res.status < 300)
  if (!body.stream) {
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* raw */ }
    const choice = json?.choices?.[0]?.message?.content ?? ''
    const usage = normalizeUsage(json?.usage)
    const cached = usage?.cached_tokens ?? 0
    return { ok, status: res.status, dt, usage, cachedTokens: cached, cacheHitRate: usage?.cache_hit_rate ?? 0, text: choice, raw: text }
  }
  // 流式通道：SSE 逐块消费。尾 chunk（`stream_options.include_usage=true`）带 usage ⇒ 当场确认 cache hit。
  // 注入响应没有可读流（测试 mock）时，回退到「读全文按 SSE 文本解析」，绝不因缺 body 崩掉。
  const blocks = []
  if (!res.body || typeof res.body.getReader !== 'function') {
    // 回退路径必须按 SSE 的空行分隔成**多个事件块**——整块塞进去只会解析到第一个 `data:`，
    // 尾 chunk 的 usage（含 cached_tokens）会被整段丢弃 ⇒ 命中率永远读到 0。
    const raw = await res.text()
    for (const block of raw.split('\n\n')) if (block.trim()) blocks.push(block)
  } else {
    const textDecoder = new TextDecoder()
    const reader = res.body.getReader()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += textDecoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop() || ''
      for (const block of parts) blocks.push(block)
    }
    if (buffer.trim()) blocks.push(buffer)
  }
  let rawUsage = null
  let content = ''
  for (const block of blocks) {
    const trimmed = block.trimStart()
    if (!trimmed.startsWith('data:')) continue
    const line = trimmed.slice(5).trim()
    if (!line || line === '[DONE]') continue
    try {
      const j = JSON.parse(line)
      const delta = j?.choices?.[0]?.delta?.content ?? ''
      if (delta) content += delta
      if (j?.usage) rawUsage = j.usage
    } catch { /* ignore malformed chunk */ }
  }
  const usage = normalizeUsage(rawUsage)
  const cached = usage?.cached_tokens ?? 0
  return { ok, status: res.status, dt, usage, cachedTokens: cached, cacheHitRate: usage?.cache_hit_rate ?? 0, text: content }
}

/**
 * **前缀预热**（生产必备）。
 *
 * <p><b>为什么需要</b>：实测「**首调必 miss**」——代理侧把前缀写进缓存有延迟，第一条请求
 * 永远吃不到复用；实测里稳定要第 2~3 条之后才开始命中（T3/T4 烤热段第 1 轮 `cached_tokens=0`，
 * 第 2 轮起稳定命中）。⇒ 长会话里如果每条请求都换前缀，等于**每条都在冷启动**。</p>
 *
 * <p><b>怎么做</b>：用<b>与正题逐字节相同</b>的 system 前缀发 N 条极短请求，把前缀烤进缓存；
 * 之后正题请求才能吃到复用。user 正文每条都不同（不要用重复的整请求，那测的是另一件事）。</p>
 *
 * <p><b>诚实读数</b>：返回每一轮的 <code>cached_tokens</code>（唯一可信命中读数）与
 * <code>warmupRounds</code>（第几轮开始命中；从未命中 ⇒ rounds+1）。
 * 代理侧记账值 <code>prompt_tokens</code> 单列且标注<b>跨请求不可比</b>。</p>
 *
 * <p><b>零 key 时不发任何请求</b>：返回 <code>skipped:true</code>，绝不拿离线结构量冒充真读数。</p>
 */
export async function warmupPrefix({
  rounds = 3, npcMode = 'canon', user = '（预热）', model = 'gpt-6-sol', temperature = 0.72, maxTokens = 16,
  baseUrl, apiKey, fetchImpl,
} = {}) {
  const author = authorLlmEnv()
  if (baseUrl === undefined) baseUrl = author.baseUrl
  if (apiKey === undefined) apiKey = author.apiKey
  const n = Math.max(1, Math.floor(Number(rounds) || 1))
  if (!apiKey) {
    return {
      skipped: true, reason: 'missing_key', rounds: 0, cachedTokens: [], promptTokensReported: [],
      warmupRounds: n + 1, warm: false, note: '未注入 key ⇒ 未发起任何网络调用（诚实降级）',
    }
  }
  const cachedTokens = []
  const promptTokensReported = []
  const statuses = []
  for (let i = 0; i < n; i++) {
    // user 正文每轮都变 ⇒ 烤的是「前缀复用」这件事，不是「整请求重复」。
    const body = buildBibleMessages({ npcMode, user: `${user}#${i}`, model, temperature, maxTokens })
    const out = await callLlm(body, { baseUrl, apiKey, fetchImpl })
    statuses.push(Number(out.status) || 0)
    cachedTokens.push(Number(out.cachedTokens) || 0)
    promptTokensReported.push(Number(out.usage?.prompt_tokens) || 0)
  }
  const firstHit = cachedTokens.findIndex((c) => c > 0)
  return {
    skipped: false, reason: null, rounds: n,
    cachedTokens, promptTokensReported, statuses,
    warmupRounds: firstHit >= 0 ? firstHit + 1 : n + 1,
    warm: firstHit >= 0,
    prefixBytes: (npcMode === 'short' ? SHORT_BIBLE : NPC_BIBLE).length,
    note: 'cached_tokens 是唯一可信命中读数；prompt_tokens 是代理侧记账值，跨请求不可比；首调必 miss',
  }
}

const isCliInvocation = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCliInvocation) {
  const argv = process.argv.slice(2)
  const idx = argv.indexOf('--bench')
  const wuIdx = argv.indexOf('--warmup')
  if (wuIdx >= 0) {
    // 前缀预热：首调必 miss ⇒ 生产上先烤热再跑正题（docs/llm-cache-fix.md 第十二节）。
    const roundsArg = argv.find((a) => a.startsWith('--rounds='))
    const r = await warmupPrefix({ rounds: roundsArg ? Number(roundsArg.slice('--rounds='.length)) : 3 })
    if (r.skipped) {
      console.log('[caesura-llm-client --warmup] skipped=' + r.reason + ' —— ' + r.note)
    } else {
      console.log('[caesura-llm-client --warmup] rounds=' + r.rounds + ' prefixBytes=' + r.prefixBytes)
      console.log('  cached_tokens=' + JSON.stringify(r.cachedTokens) + ' warmupRounds=' + r.warmupRounds + ' warm=' + r.warm)
      console.log('  promptTk(记账值·不可比)=' + JSON.stringify(r.promptTokensReported))
      console.log('  note: ' + r.note)
    }
    process.exit(0)
  }
  if (idx >= 0) {
    const user = [
      'NPC id: DLG_MEG（emotion: bored）',
      'Canon opening: "别站那么近，你踩到我摊子了。……等等。你胸口那颗音色石，灭的。莉安给你的吧？"',
      '请写 3 句别的可能开场（中文，冷一点短一点）。',
    ].join('\n')
    console.log('[caesura-llm-client --bench]')
    for (let i = 0; i < 3; i++) {
      const out = await callLlm(buildBibleMessages({ user, maxTokens: 260 }))
      console.log(`  iter ${i + 1}: status=${out.status} cached=${out.cachedTokens}/${out.usage?.prompt_tokens ?? '?'} dt=${out.dt}ms totalTokens=${out.usage?.total_tokens ?? '?'}`)
      console.log('  text:', JSON.stringify(out.text.slice(0, 120)))
    }
    process.exit(0)
  }
  // quick CLI smoke: prints which $NPC for ad-hoc user-prompt
  const who = argv[0] ?? 'DLG_MEG'
  const userText = argv[1] ?? '请写 1 句开场（冷一点短一点，恳字结尾）。'
  const out = await callLlm(buildBibleMessages({ user: userText }))
  console.log(out.text)
}
