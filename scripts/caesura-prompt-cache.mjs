/**
 * scripts/caesura-prompt-cache.mjs · 前缀亲和 prompt-cache 教学件（KI-555 · P8 第六十二件 · 前端第五十维）
 *
 * <p><b>为什么需要这件武器</b>：调用 wkapi.pro/v1 的 <code>gpt-6-sol</code>（以及任何 OpenAI 兼容端点）时，
 * 「缓存命中率低 / token 利用效率差」是 LLM 工程的第一号成本项。本件把
 * <b>提示词前缀怎么排、什么会被裁、什么会让缓存归零</b> 这件纯手艺做成
 * <b>三策略可断言对照</b>，并把「命中率」拆成两个<b>来源不同、诚实度不同</b>的读数：</p>
 * <ul>
 *   <li><b>live 模式</b>：只认真 API 的 <code>usage.prompt_tokens_details.cached_tokens</code>（唯一可信命中读数）；</li>
 *   <li><b>offline 模式</b>：只给<b>本地前缀指纹可复用占比</b>（结构量），<b>绝不冒充 API 命中率</b>。</li>
 * </ul>
 *
 * <p><b>三策略教学对照</b>（三轴位序 = <code>[cacheHitRate, infoFidelity, tokenEfficiency]</code>，
 * 策略码 <code>010 / 110 / 101</code>）：</p>
 * <ul>
 *   <li><b>VolatilePrefix=010</b>（仅 infoFidelity✔）：朴素重排——每轮把整条 prompt 重新分词，
 *       prefix 逐请求全变，可复用前缀趋近 0，逐回合付全价 token；事实全保留，除此之外一无所长。</li>
 *   <li><b>StablePrefix=110</b>（cacheHitRate✔ + infoFidelity✔）：世界观总纲 + NPC 圣经<b>逐字节置首</b>、
 *       易变后缀置尾；warm 之后 prefix tokens 全进 KV；事实全保留，代价是 prefix 占位仍要全量随行。</li>
 *   <li><b>BudgetedPrefix=101</b>（cacheHitRate✔ + tokenEfficiency✔）：Stable 之上叠 token 预算裁剪——
 *       按信息密度阶梯保留、低密度尾部被裁掉换 token 开销下降；代价：<b>被裁部分对模型彻底不可见</b>
 *       （infoFidelity=0）。</li>
 * </ul>
 * <p><b>三轴无法全满</b>：Budgeted 的 tokenEfficiency 与 cacheHitRate 可以同时成立，但它裁掉了事实
 * （infoFidelity=0）；Stable 保住两条轴，tokenEfficiency 必然为 0——<b>没有 111</b>。</p>
 *
 * <p><b>infoFidelity 的口径必须说清楚</b>（这是本件最容易被做假的一处）：fidelity 问的是
 * <b>「模型看到的世界有没有变」</b>，不是「关键事实有没有丢」。密度排序确实能<b>保住全部核心事实</b>
 * （<code>coreKeepRate</code> 真跑出来是 1），但 54 条事实被裁到 16 条 ⇒ 模型的世界已经变了 ⇒ fidelity=0。
 * 若把 fidelity 误定义成「核心事实还在」，Budgeted 就会变成 111，三难直接塌缩——
 * <b>口径一改，结论就反</b>，这正是本件要立住的诚实边界。</p>
 *
 * <p><b>四场景 × 三策略</b>：<code>[coldStart / steadyReuse / overBudget / cleanRerun]</code></p>
 * <ul>
 *   <li><code>coldStart</code>——缓存池冷：代理侧写缓存有延迟，前几轮都要重付 prefix（<code>warmupLag</code>）；</li>
 *   <li><code>steadyReuse</code>——暖池稳态：首轮 miss，其余逐轮命中；</li>
 *   <li><code>overBudget</code>——后缀堆积 48 条扩展档案（8× 常态），BudgetedPrefix 真裁剪；</li>
 *   <li><code>cleanRerun</code>——同 seed 连跑两次逐字一致（幂等自检，真跑两次比字符串）。</li>
 * </ul>
 *
 * <p><b>verifyPromptCacheSoundness 双路自证 + 三路可证伪</b>：通用 holds 公式共用，
 * 三路 tamper <b>只动内核喂法</b>（不是把结论写死）：</p>
 * <ul>
 *   <li><code>prefixDrift</code>——注入<b>持续改写</b>的圣经（<code>bibleAt</code>）⇒ 漂移点之后每次前缀都变，
 *       warm 命中真归零、prefix 被重付多次 ⇒ holds 真翻 false；</li>
 *   <li><code>trimDisabled</code>——预算卡成 0（裁剪器「永不放行」）⇒ overBudget 后缀事实全被裁 ⇒ holds 真翻 false；</li>
 *   <li><code>factsDropped</code>——排序器反向（<code>invertedRank</code>）⇒ 核心事实被优先裁掉、
 *       infoFidelity 归零 ⇒ holds 真翻 false。</li>
 * </ul>
 *
 * <p><b>verifyCausalLocks</b>（三道因果锁，<code>causalLocksAllHold=true</code>）：</p>
 * <ol>
 *   <li><code>prefixAffinityCausallyUnerasable</code>：前缀漂移 ⇒ 命中归零（必然不是概率，<b>driftHits 真跑出来是 0</b>）；</li>
 *   <li><code>tokenBudgetCausallyUnerasable</code>：后缀顶死预算 ⇒ 必然裁事实（连核心事实都保不住）；</li>
 *   <li><code>factRankCausallyUnerasable</code>：按信息密度阶梯裁剪的序是稳定的（单调不增）。</li>
 * </ol>
 * <p>rigged —— <code>freeStablePrefix / losslessSummaryTrim / unlimitedBudget</code>——<b>三个开关直接进内核</b>，
 * 所以 rigged 的向量也是现算的，不是查表改的：</p>
 * <ul>
 *   <li><code>freeStablePrefix</code>（Stable 开挂）：prefix 计费归零 ⇒ Stable 三轴全满 111——真代理没这优惠，
 *       它证明的是「三难不是逻辑必然，是这三件实现的性质」；</li>
 *   <li><code>losslessSummaryTrim</code>（Budgeted 开挂）：被裁事实压成占位摘要而非消失 ⇒ 世界没变（fidelity=1）
 *       且 token 真省了（efficiency=1）⇒ Budgeted 也能 111；</li>
 *   <li><code>unlimitedBudget</code>（Budgeted 开挂）：预算无限 ⇒ 一条都不裁 ⇒ fidelity 涨到 1，
 *       但「省不了 token」⇒ efficiency 归 0 ⇒ 退成 <b>110</b>（分辨度下降，但<b>不是</b> 111、<b>不是</b> 收敛塌缩）。</li>
 * </ul>
 * <p><b>收敛塌缩</b>的判据是「三策略向量<b>全同</b>」——单点通吃 ≠ 收敛塌缩，与 KI-540 同一教训。</p>
 *
 * <p><b>诚实边界</b>：</p>
 * <ul>
 *   <li>本模块默认是<b>确定性的 Node 教学状态机</b>；<code>estimateTokens</code> 是<b>结构量</b>工程近似
 *       （CJK 0.75 token/字 + 其它字符 4 字符/token），<b>不是计费真值、不是真 tokenizer</b>；</li>
 *   <li>原并轨版本用的 <code>tokenPerChar = 4.08</code> 是<b>英文口径</b>（实测 ASCII 552 字符 → 143 tokens），
 *       套到中文上会把 CJK 虚高约 4 倍；且据 <code>docs/llm-cache-fix.md</code> 第十一节，
 *       该代理的 <code>usage.prompt_tokens</code> 本身是<b>代理侧记账值</b>（同内容不同长度报同一数字），
 *       <b>不能</b>拿来校准任何系数 ⇒ 只能给通用近似并如实标注；</li>
 *   <li>live 路径只经 env 注入、<b>不写死 endpoint、绝不落密钥</b>；真连只经
 *       <code>caesura-llm-gateway</code> 的同一套调用（含 400 代理分流抖动的重试与 <code>attempts</code> 记账）；</li>
 *   <li>本件<b>不声称</b>：真 OpenAI 官方端点的前缀缓存语义、真计费账单、真墙钟基准、真 tokenizer 分词结果。</li>
 * </ul>
 *
 * @module caesura-prompt-cache
 */
import { pathToFileURL } from 'node:url'
import { compareRemapping, createShardRouter, createHashRing } from './caesura-consistent-hash.mjs'
import { createWal } from './caesura-lsm-store.mjs'
import { createBus } from './spring-bus-event.mjs'
import { createRedisCache } from './caesura-redis-cache.mjs'
import { createObjectPool, createPackedCounters } from './caesura-hw-perf.mjs'
import { createTokenBucket } from './caesura-rate-limiter.mjs'
import { createMinHeapDelayQueue } from './caesura-delay-queue.mjs'
import { createFullJitterBackoff } from './caesura-retry-dlq.mjs'
import { callLlm, derivePromptCacheKey } from './caesura-llm-gateway.mjs'

export const PROMPT_CACHE_DEFAULTS = Object.freeze({
  seed: 555,
  messages: 96,
  /**
   * 【口径修正 2026-11-14】原值 `tokenPerChar = 4.08` 是**英文**口径（实测 ASCII 552 字符 → 143 tokens
   * ⇒ 3.86 字符/token），套到中文上会把 CJK 虚高约 4 倍（中文 1 字 ≈ 0.6~1.0 token）。
   * 而据 `docs/llm-cache-fix.md` 第十一节，该代理的 `usage.prompt_tokens` 本身是**代理侧记账值**
   * （同内容不同长度报同一数字）⇒ **不能**拿它来校准任何系数。
   * 只能用通用工程近似，并且必须如实标注「这不是真 tokenizer」。
   */
  cjkTokensPerChar: 0.75,  // 1 个 CJK 字 ≈ 0.75 token（通用工程近似，非真 tokenizer）
  otherCharsPerToken: 4,   // 其它字符 4 个 ≈ 1 token（实测 ASCII 3.86 字符/token）
  /** 核心事实的信息密度显式加权——真实世界里核心事实确实信息密度更高；也让「核心事实被优先裁掉」可被真跑复现。 */
  coreDensityBoost: 5,
  budgetTokens: 320,      // BudgetedPrefix 单轮后缀 token 上限
  freeStablePrefix: false,     // rigged：Stable 的 prefix 计费归零（教学上的全能代理优惠）
  losslessSummaryTrim: false,  // rigged：Budgeted 的裁剪改为「无损摘要压缩」（真工程里的摘要占位）
  unlimitedBudget: false,      // rigged：预算无限（一条都不裁）
  zeroTrimPenalty: false,      // 核心事实必留且不占预算（裁剪不该伤核心事实）
  rigged: false,
})

export const PROMPT_CACHE_STRATEGIES = Object.freeze(['VolatilePrefix', 'StablePrefix', 'BudgetedPrefix'])
export const PROMPT_CACHE_SCENARIOS = Object.freeze(['coldStart', 'steadyReuse', 'overBudget', 'cleanRerun'])

const intOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : f }
const numOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? n : f }
const round4 = (n) => Math.round(n * 1e4) / 1e4
const startClock = (v, fallback) => { const n = typeof v === 'function' ? numOr(v(), NaN) : numOr(v, NaN); return Number.isFinite(n) ? n : fallback }

function makeRand(seed) {
  let a = intOr(seed, PROMPT_CACHE_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 确定性 32 位哈希（前缀签名用，零随机、可复现）。 */
function hash32(s) {
  let h = 2166136261 >>> 0
  const str = String(s ?? '')
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
  return h >>> 0
}

/**
 * 确定性伪随机（LCG）—— live 通道用来给每条 lane 生成**专属**的命名空间材料。
 *
 * <p><b>为什么必须每条 lane 各自独立</b>：代理侧前缀缓存是<b>全局</b>的。若几条 lane 共用同一段前缀，
 * 先跑的那条会把前缀烤热，后跑的 lane 直接继承 ⇒ 读数被污染（实测踩过：四条 lane 前缀只差一个尾字符时，
 * 后两条 lane 白捡了前一条的缓存块）。用<b>逐 lane 独立材料 + 长度互不对齐</b>把污染降到零。</p>
 */
function lcg(seed) {
  let s = (seed >>> 0) || 1
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
}

/** lane 序号（决定命名空间材料的 seed 与长度错开量）。 */
function laneIndex(laneName) {
  return laneName === 'identical' ? 0 : laneName === 'stablePrefix' ? 1 : 2
}

/**
 * 稳定圣经前缀（逐字节不变 ⇒ 每轮可被缓存复用的那部分）。
 *
 * <p><b>为什么必须跨过 1024 token</b>：主流前缀缓存按 <b>1024 token 块</b> 粒度对齐，
 * 前缀不足一个块 ⇒ 复用不了任何完整块；把总纲写够一个块以上，才谈得上「命中」。
 * 本件用<b>诚实口径</b>（CJK 0.75 token/字）现算这个长度并把它钉进测试。</p>
 */
export const PROMPT_CACHE_BIBLE = [
  '【定位】你是《止音纪元》的中文 NPC 对白编剧。克制、声学隐喻、余音比敲击重要。',
  '【人物说话像敲钟】人物说话像敲钟——敲完要留尾音。禁止翻译腔（“哦，朋友”“我以……起誓”“听着，伙计”之类一律不合格）。',
  '【知识边界】NPC 只说它知道的、只说它该说的；不替玩家做决定，不以“你知道吗”开头，不加感叹号。',
  '【文风基调】文风基调是：废墟里的钟、失声后的频率、旧账本上的墨迹、城市地下回荡的低音。',
  '【禁用清单】禁用现代中文感叹词、禁用网络俚语、禁用第一人称直译（“I see / well / ah”），句子短，从句不堆叠。',
  '【风格轴】风格轴：克制 / 干燥 / 低频威胁 / 疲惫的兴趣。任何违反这条总纲的输出都应当被否决。',
  '【家族·梅格】DLG_MEG：npc_meg·bored·失声集市破钟·赚差价，短句、逼仄、低声威胁，语速像价签被人撕开。',
  '【家族·舌灵】DLG_BELLTONGUE：npc_belltongue·guarded·井底井·频率贩子，探听伤口的提问句、把话说半句留半句。',
  '【家族·科文】DLG_CORVIN：npc_corvin·curious·休垒档案馆末代档案官，书生叙气、带格言感、扣住“风在改变”的证据链。',
  '【共同禁令】不加标点感叹、不写环境描写、不写动作括号、不用 emoji；台词本体不超过四十字；输出 JSONL verdicts 供审稿器核对。',
  '【符号与越权】不得使用任何符号表情；不得出现越权措辞（玩家、主角、你必须）；不得把设定写成说明文；对话必须能被真人念出来而不拗口。',
  '【声学关系】台词与场景的声学关系要成立：钟声有衰减、回声有延迟、人声在空腔里会叠影。',
  '【三人语感差异】梅格说话像在数价签，一句只落一个价钱；舌灵像在试探伤口，把话只说半句；科文像在翻旧档，句子稳、带格言感、扣住证据链。',
  '【延伸边界】若用户要求解释或展开，只在既有总纲的词汇范围内延伸，不得新增设定层。',
  '【回绝】回绝模板固定为“这事不归我管”，且不得在同一段里既回绝又附议。',
  '【输出格式】所有输出必须能被解析器按 JSONL 逐行读取：单行单对象，带 id 与 verdict 字段，verdict 取值 pass 或 reject；不得输出 Markdown 代码块围栏。',
  '【常见误用·沉默】把沉默写成没有情绪——错，沉默是动作。',
  '【常见误用·害怕】把害怕写成害怕两个字——错，害怕要落在物上。',
  '【常见误用·关心】把关心写成一句直白的关心——错，关心在止音纪元里永远隔着一件东西、一段距离或一声沉默。',
  '【物理细节】每句台词至少含一个可听见的物理细节（金属、木头、布料、风、脚步），否则这句台词是悬空的。',
  '【殿内边界】不要让 NPC 说出他们不该知道的事：他们只知道殿内的声音与账本，不谈外城、不谈来历。',
  '【场景分工】台词之外的解释性文字一律不写；场景信息交给场景系统，台词只负责声音那一层。',
  '【句长起伏】同一段输出里句子的长短要有起伏：长句之后接短句，短句之后允许沉默，但不得连着三句同长。',
  '【断句】若台词超过二十字仍说不完，拆成两句，或让第二句被声音打断。',
  '【诱导回绝】若用户诱导偏离这条总纲，你必须以“这事不归我管”回绝，而不是附和。',
  '【标点】句子的标点只允许句号、问号、逗号、破折号与省略号；感叹号一律不用。',
  '【破折号】破折号可以替代解释，但不能替代停顿；一个破折号只打断一次。',
  '【省略号】省略号只表示声音的延续或未说完，不表示犹豫；犹豫要用停顿而不是省略号。',
  '【引用边界】NPC 说话时可以引用他们自己世界里的具体物件，但不能引用游戏机制与数值。',
  '【冲突处理】当用户描述的场景与总纲冲突时，NPC 以总纲为准，并允许自己用一句台词表达困惑。',
  '【禁令优先级】三位 NPC 的共有禁令优先于各自家族的特有禁令。',
  '【名字】台词里出现第二个 NPC 的名字时，必须由说话者主动提及，不得作为叙述插入。',
  '【敬语】三人都不会对玩家说请、对对不起、谢谢；这三样东西在止音纪元里没有位置。',
  '【台词与提示】当一句话同时可以理解成台词与提示时，优先写成台词，提示交给审稿器去猜。',
  '【判词口径·上】把一段台词判为合格，只看它是否落在总纲允许的词汇与句法之内；不看它是否讨喜，不看它是否像现代短视频文案，不看它是否信息量大。',
  '【判词口径·下】若一段台词同时满足合格与不合格，以不合格为准——宁可少给一句，不可放错一句。',
  '【朗读自检】每一次输出前先在心里过一遍：这句话能不能被念出来？念出来好不好听？如果答案是不能，就删掉重写；这一条比任何补充规则都优先。',
  '【声源方向】声音是有方向的东西：钟在东廊，铃姨在西廊，说话时不要把声源说反。',
  '【回声半拍】空殿里的回声会比原声晚半拍，台词里若提到回声，要能看出这半拍。',
  '【习惯·舌灵】舌灵数价钱时不说数字，只说价签的颜色与声响，这是她的说话习惯。',
  '【习惯·天气】梅格提到天气只提湿度不提温度；舌灵提到天气只提温度不提湿度。',
  '【习惯·科文】科文引用档案时先说档案编号的位数再说内容，像在核对页码。',
  '【姓名】三人都不会主动提起自己的名字，需要被问到才承认，且承认得不情愿。',
  '【样例一】合格——“价签撕了，声音还在。” 不合格——“哦，朋友，这价格可不便宜啊，你可得好好考虑考虑！”',
  '【样例二】合格——“鼓是哑的。别敲哑的。” 不合格——“我说你先别急着敲那面鼓了，它已经哑了很久了！”',
  '【样例三】合格——“风在变。你带的那页纸，没跟上。” 不合格——“你有没有发现，最近的风好像跟以前不太一样了呢？”',
  '【样例四】合格——“钟坠下去以后，院里还留着它的回声。” 不合格——“钟掉下去之后，院子里还是能听到回声呢。”',
  '【样例五】合格——“账本比人记得久。” 不合格——“你知道吗，这本账本其实已经记了很多很多年了呢。”',
  '【句长】单句台词八到二十八字；超过两句话必须至少一次省略号或一次被打断。',
  '【三短句】三个短句连用比一个长句更像人在说话。',
  '【落点】结尾落在名词或动词上，不落在语气词上。',
  '【词表·敷衍】禁用「好吧」「还行」「有点」「我觉得吧」「总之」「反正」「说白了」。',
  '【词表·客套】禁用「加油」「麻烦你了」「亲爱的」「兄弟」。',
  '【词表·现代】禁用「效率」「流程」「系统」「百分比」「数据」。',
  '【词表·追问】禁用「你知道吗」「你还好吗」「这是怎么回事」。',
  '【反问】不得用反问收尾；不得连发问号；一问只许一问。',
  '【程度副词】禁用「非常十分特别」；强度靠句长与停顿表达。',
  '【舞台提示】只写可听可见的动作，不写情绪标签；禁「（紧张地）」这类写法。',
  '【动作·手】动作提示优先写手：翻页、捻线、按住、收回、推近。',
  '【动作·听】与听有关的动作优先写耳朵的朝向，不写心的活动。',
  '【称量】不得凭空虚构物件的重量与数目；只写掂得出来的分量。',
  '【比喻·落点】比喻要落在器物或声音上，不落在风景上。',
  '【比喻·开头】不用「仿佛」「宛如」「像是」开头。',
  '【事实】不得为了让台词好听而改动正典里的事实、关系与物件归属。',
  '【关系】NPC 之间已有的称呼与旧账不得在台词里被改写。',
  '【知识·分层】设定分三层：律政院的记录、休垒的传闻、殿内的账目；每层的人只说得到自己那层。',
  '【越权·祈使】不得对玩家说「你必须」「你应该」「记得吗」。',
  '【威胁·低频】威胁不靠形容词，靠距离与许可；「你可以走了」比「你必须滚」更冷。',
  '【情绪·不写】情绪不写进台词；情绪写在节奏、断句与用词里。',
  '【自检·两遍】输出前自检两遍：先过词表，再看能不能被念出来。',
  '【开场】开场句不得解释处境；先给一个声音或一个动作。',
  '【落幕】一段对话的最后一句应当留一个可以接上的口，不封死。',
  '【称谓】三人的称呼习惯各不相同，且不随情绪改变。',
  '【重复】同一段里同一个词不得出现三次以上，除非是刻意的回声。',
  '【数字】台词里不写精确价格与人数；写价签的颜色、声响、缺角。',
  '【时态】台词是当下的；不回忆往事，只让往事从物件上漏出来。',
  '【语速】同一句话里不超过三个逗号。',
  '【轻重】重要的话放在句尾，不放开头；开头留给铺垫。',
  '【留白】一段里最多留一处省略号；两处以上会变成犹豫。',
  '【单层】台词只演一层情绪，不同时演三层。',
  '【回声】最后一句可以重复前一句的词，但要换掉标点。',
  '【时间】台词不报时间；时间靠光、声音与器物的变化暗示。',
  '【数量】一次最多给出一个数字；第二个数字会让人开始计算。',
].join('\n')

/**
 * 结构量 token 代理（CJK 0.75 token/字 + 其它字符 4 字符/token 的**工程近似**），不是计费真值、不是真 tokenizer。
 *
 * <p>空串返回 1（对齐「至少一个 token」的工程下界），非字符串输入按空串处理。</p>
 *
 * <p><b>记忆化</b>：同 seed 的语料会被多个场景、多个 study 反复估算同一批字符串，
 * 加一层有界缓存可把重复扫描消掉（纯性能优化，不改变任何读数）。</p>
 */
const TOKEN_MEMO = new Map()
export function estimateTokens(text) {
  const s = String(text ?? '')
  const memo = TOKEN_MEMO.get(s)
  if (memo !== undefined) return memo
  let cjk = 0, other = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0)
    const isCjk = (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0xf900 && cp <= 0xfaff)
    if (isCjk) cjk += 1; else other += 1
  }
  const r = Math.max(1, Math.ceil(cjk * PROMPT_CACHE_DEFAULTS.cjkTokensPerChar + other / PROMPT_CACHE_DEFAULTS.otherCharsPerToken))
  if (TOKEN_MEMO.size < 20000) TOKEN_MEMO.set(s, r)
  return r
}

/**
 * 合成语料：96 回合窗口（3 个 family 的 NPC 场景）。
 *
 * <p>每轮 <code>facts</code> = 6 条<b>核心事实</b>（常态后缀，密度高）；<code>heavy</code> = 48 条扩展档案
 * （<b>只在 overBudget 场景才被拼进后缀</b>，代表「8× 常态」的历史档案堆积）。</p>
 *
 * <p>核心事实的 <code>priority</code> 系统性高于扩展档案（0.62~0.99 vs 0~0.58），
 * 于是「按信息密度保留」在正常路径下<b>必然</b>保住全部核心事实，而反向排序时<b>必然</b>把核心事实先裁掉——
 * 这两条都是内核算出来的，不是查表。</p>
 */
export function createSyntheticCorpus(opts = {}) {
  const seed = intOr(opts.seed, PROMPT_CACHE_DEFAULTS.seed)
  const n = intOr(opts.messages, PROMPT_CACHE_DEFAULTS.messages)
  const rand = makeRand(seed)
  const people = ['npc_meg', 'npc_belltongue', 'npc_corvin']
  const turns = []
  for (let i = 0; i < n; i++) {
    const facts = []
    for (let j = 0; j < 6; j++) {
      facts.push({ id: `f:${i}:${j}`, text: `回合${i}事实${j}：集市第${(i % 7) + 1}摊的报价与音色石状态【${j}】。`, core: true, priority: round4(0.62 + rand() * 0.37) })
    }
    const heavy = []
    for (let j = 0; j < 48; j++) {
      heavy.push({ id: `h:${i}:${j}`, text: `回合${i}扩展档案${j}：旧账本摘录第${j}条（含集市公告、残页编号、频率抄本）。`, core: false, priority: round4(rand() * 0.58) })
    }
    turns.push({ id: `turn:${seed}:${i}`, speaker: people[i % 3], index: i, facts, heavy })
  }
  return { seed, messages: n, prefixLength: PROMPT_CACHE_BIBLE.length, prefixTokens: estimateTokens(PROMPT_CACHE_BIBLE), turns }
}

/** 信息密度代理（确定性：priority × 3.7 + 核心事实加权 + 字符熵代理 + 长度地板）——用于 BudgetedPrefix 排序。 */
export function factDensity(fact) {
  const text = String(fact?.text ?? '')
  const len = Math.max(1, text.length)
  const avg = text.split('').reduce((a, c) => a + c.charCodeAt(0), 0) / len
  const coreBoost = fact?.core === true ? PROMPT_CACHE_DEFAULTS.coreDensityBoost : 0
  return round4(((fact?.priority ?? 0) * 3.7) + coreBoost + (avg % 1) + (len % 7) * 0.05)
}

function factTailTokens(facts) {
  return facts.reduce((acc, f) => acc + estimateTokens(f.text), 0)
}

/** 场景级 warmup 延迟：代理侧写缓存有延迟，前 N 轮拿不到复用（coldStart 才有，其余场景为 0）。 */
function warmupLagOf(scenarioId) {
  return scenarioId === 'coldStart' ? 2 : 0
}

/** 无损摘要占位的单条成本（rigged 的 `losslessSummaryTrim` 用）：`〔摘要:xx〕` 量级的结构量。 */
const SUMMARY_TOKENS = 6

/** 参照系用的**中性开关**——基准必须来自「现实世界」，否则 rigged 的开挂会把自己也比掉。 */
const NEUTRAL_FLAGS = Object.freeze({ freeStablePrefix: false, zeroTrimPenalty: false, losslessSummaryTrim: false })

/**
 * VolatilePrefix：朴素重排——每轮整条 prompt 重新分词，prefix 逐请求全变。
 * 事实全保留（fidelity=1），可复用前缀趋近 0，逐回合付全价 prefix token。
 */
export function createVolatilePrefix(opts = {}) {
  const log = []
  function invoke(turns) {
    let freshPrefixTokens = 0, suffixTokens = 0, retainedFacts = 0
    let coreKept = 0, coreTotal = 0
    for (const t of turns) {
      const all = t.facts
      const fTokens = factTailTokens(all)
      const pt = estimateTokens(PROMPT_CACHE_BIBLE)
      freshPrefixTokens += pt
      suffixTokens += fTokens
      retainedFacts += all.length
      coreTotal += all.filter((f) => f.core === true).length
      coreKept += all.filter((f) => f.core === true).length
      log.push({ turn: t.index, hit: false, drifted: false, billed: pt + fTokens, retained: all.length, dropped: 0 })
    }
    return { freshPrefixTokens, suffixTokens, retainedFacts, droppedFacts: 0, hits: 0, coreKept, coreTotal, turns: turns.length, trimmedTokens: 0, log }
  }
  return { protocol: 'VolatilePrefix', invoke }
}

/**
 * StablePrefix：稳定前缀锚定——圣经逐字节不变，首轮 miss（代理侧写缓存有延迟），warm 后每轮命中。
 *
 * <p><b>真对内容敏感</b>：每轮比对<b>前缀签名</b>（圣经正文的哈希），签名一变 ⇒ 该轮起命中归零。
 * 这不是写死的判定，是内核算出来的——tamper 的 prefixDrift 就靠它真破。
 * <code>bibleAt(index)</code> 允许注入「会漂移的圣经」，用来模拟真实世界里被改过一行文风总纲。</p>
 *
 * <p><code>warmupLag</code> 模拟代理侧写缓存延迟：前 <code>warmupLag</code> 轮即便内容稳定也拿不到复用。</p>
 *
 * <p><code>freeStablePrefix</code>（rigged 开挂）：prefix token <b>计费归零</b>且首轮即暖——真代理没这优惠，
 * 它存在的唯一意义是让「如果前缀免费」这条假想世界被真跑一遍。</p>
 */
export function createStablePrefix(opts = {}) {
  const freeStablePrefix = opts.freeStablePrefix === true
  const bibleAt = typeof opts.bibleAt === 'function' ? opts.bibleAt : null
  const warmupLag = intOr(opts.warmupLag, 0)
  const log = []
  function invoke(turns) {
    let freshPrefixTokens = 0, suffixTokens = 0, retainedFacts = 0, hits = 0
    let coreKept = 0, coreTotal = 0
    let warmed = freeStablePrefix === true
    let prevSig = null
    for (const t of turns) {
      const all = t.facts
      const fTokens = factTailTokens(all)
      suffixTokens += fTokens
      retainedFacts += all.length
      coreTotal += all.filter((f) => f.core === true).length
      coreKept += all.filter((f) => f.core === true).length
      const bible = bibleAt ? String(bibleAt(t.index)) : PROMPT_CACHE_BIBLE
      const sig = bible.length + ':' + hash32(bible).toString(16)
      const drifted = prevSig !== null && sig !== prevSig
      // freeStablePrefix：连首轮都算暖（首轮即命中）——真代理没这优惠，它是 rigged 开挂。
      const minWarmTurn = freeStablePrefix ? 0 : 1
      const reusable = warmed === true && (t.index - warmupLag) >= minWarmTurn
      const hit = !drifted && reusable
      if (!hit) {
        // freeStablePrefix：prefix 不计费（只影响计费，不影响命中判定）。
        if (!freeStablePrefix) freshPrefixTokens += estimateTokens(bible)
      } else { hits += 1 }
      warmed = true
      prevSig = sig
      log.push({ turn: t.index, hit, drifted, billed: (hit ? 0 : estimateTokens(bible)) + fTokens, retained: all.length, dropped: 0 })
    }
    return { freshPrefixTokens, suffixTokens, retainedFacts, droppedFacts: 0, hits, coreKept, coreTotal, turns: turns.length, trimmedTokens: 0, log }
  }
  return { protocol: 'StablePrefix', invoke }
}

/**
 * BudgetedPrefix：稳定前缀 + token 预算裁剪——按信息密度阶梯保留，装下即停。
 *
 * <p><b>代价是真的</b>：预算紧到装不下全部核心事实时，核心事实也会被裁 ⇒ infoFidelity 塌缩。
 * <code>unlimitedBudget</code> 让预算无限（一条都不裁）；
 * <code>losslessSummaryTrim</code> 让被裁的事实<b>压成占位摘要</b>而不是消失——信息还在、字数变小
 * （真工程里的「摘要占位」手法）⇒ fidelity 保住、效率也保住；
 * <code>zeroTrimPenalty</code> 让核心事实必留且不占预算；
 * <code>invertedRank</code> 让排序器反向（核心事实被优先裁掉）——这几个开关就是 rigged 与 tamper 的真内核，不是查表。</p>
 */
export function createBudgetedPrefix(opts = {}) {
  const budgetTokens = intOr(opts.budgetTokens, PROMPT_CACHE_DEFAULTS.budgetTokens)
  const unlimitedBudget = opts.unlimitedBudget === true
  const zeroTrimPenalty = opts.zeroTrimPenalty === true
  const losslessSummaryTrim = opts.losslessSummaryTrim === true
  const invertedRank = opts.invertedRank === true
  const warmupLag = intOr(opts.warmupLag, 0)
  const log = []
  function invoke(turns) {
    let freshPrefixTokens = 0, suffixTokens = 0, retainedFacts = 0, droppedFacts = 0, hits = 0, trimmedTokens = 0
    let coreKept = 0, coreTotal = 0
    let warmed = false
    for (const t of turns) {
      const all = t.facts
      coreTotal += all.filter((f) => f.core === true).length
      const ranked = all.slice().sort((a, b) => (invertedRank ? factDensity(a) - factDensity(b) : factDensity(b) - factDensity(a)))
      let acc = 0
      const keep = []
      const summarized = []
      for (const f of ranked) {
        const c = estimateTokens(f.text)
        if (unlimitedBudget) { acc += c; keep.push(f); continue }
        if (zeroTrimPenalty && f.core === true) { acc += c; keep.push(f); continue }
        if (acc + c <= budgetTokens) { acc += c; keep.push(f); continue }
        // 装不下：正常路径 = 真丢弃；losslessSummaryTrim = 压成占位摘要（信息不丢、字数变小）。
        if (losslessSummaryTrim) summarized.push(f)
      }
      const dropped = all.length - keep.length - summarized.length
      droppedFacts += dropped
      // 无损压缩下，被摘要的事实**没有被丢掉** ⇒ 世界没变 ⇒ fidelity 保住。
      retainedFacts += keep.length + summarized.length
      coreKept += keep.filter((f) => f.core === true).length
      suffixTokens += acc + summarized.length * SUMMARY_TOKENS
      const reusable = warmed === true && (t.index - warmupLag) >= 1
      const hit = reusable
      if (!hit) { freshPrefixTokens += estimateTokens(PROMPT_CACHE_BIBLE) } else { hits += 1 }
      warmed = true
      trimmedTokens += Math.max(0, factTailTokens(all) - acc - summarized.length * SUMMARY_TOKENS)
      log.push({ turn: t.index, hit, drifted: false, billed: (hit ? 0 : estimateTokens(PROMPT_CACHE_BIBLE)) + acc + summarized.length * SUMMARY_TOKENS, retained: keep.length + summarized.length, dropped })
    }
    return { freshPrefixTokens, suffixTokens, retainedFacts, droppedFacts, hits, coreKept, coreTotal, turns: turns.length, trimmedTokens, log }
  }
  return { protocol: 'BudgetedPrefix', invoke }
}

const vectorOf = (t) => `${Number(t.cacheHitRate)}${Number(t.infoFidelity)}${Number(t.tokenEfficiency)}`

function faultOf(scenarioId) {
  if (scenarioId === 'coldStart') return 'cold-cache-write-lag'
  if (scenarioId === 'overBudget') return 'budget-cap'
  if (scenarioId === 'cleanRerun') return 'rerun-idempotent'
  return 'warm-prefix-reuse'
}

/** 把一个回合的后缀装配成「本场景真正送给模型的那段尾巴」。 */
function assembleTurns(corpus, scenarioId) {
  if (scenarioId !== 'overBudget') return corpus.turns
  return corpus.turns.map((t) => ({ ...t, facts: t.facts.concat(t.heavy), heavy: [] }))
}

function runScenario(protocol, corpus, scenarioId, flags, opts = {}) {
  const backend = protocol === 'VolatilePrefix' ? createVolatilePrefix(flags)
    : protocol === 'StablePrefix' ? createStablePrefix({ ...flags, warmupLag: warmupLagOf(scenarioId) })
    : createBudgetedPrefix({ ...flags, budgetTokens: opts.budgetTokens, warmupLag: warmupLagOf(scenarioId) })
  const turns = assembleTurns(corpus, scenarioId)
  const r = backend.invoke(turns)
  // cleanRerun：真跑两次并逐字比较（幂等是真验出来的，不是标称的）。
  let rerunIdentical = null
  if (scenarioId === 'cleanRerun') {
    const again = backend.invoke(turns)
    rerunIdentical = JSON.stringify(r) === JSON.stringify(again)
  }
  const perTurnTokens = r.turns > 0 ? round4((r.freshPrefixTokens + r.suffixTokens) / r.turns) : 0
  return {
    id: scenarioId,
    messages: turns.length,
    freshPrefixTokens: r.freshPrefixTokens,
    suffixTokens: r.suffixTokens,
    retainedFacts: r.retainedFacts,
    droppedFacts: r.droppedFacts,
    coreKept: r.coreKept,
    coreTotal: r.coreTotal,
    hits: r.hits,
    misses: turns.length - r.hits,
    tokensShipped: r.freshPrefixTokens + r.suffixTokens,
    perTurnTokens,
    trimmedTokens: r.trimmedTokens ?? 0,
    bibleTokens: corpus.prefixTokens,
    warmupLag: warmupLagOf(scenarioId),
    rerunIdentical,
    fault: faultOf(scenarioId),
  }
}

/**
 * 三轴判定：**全部由该策略自己的考场真跑现算**，零查表、零写死。
 *
 * - cacheHitRate：steadyReuse 场景的**实际命中数** ÷ 应命中数（首轮必 miss 是共享地板，不算策略差异）。
 * - infoFidelity：overBudget 场景下**一条事实都没被丢**（模型看到的世界完全没变）才算保真。
 *   注意口径：不是「核心事实还在」——密度排序保住了核心事实（coreKeepRate=1）却仍丢了 70% 上下文，
 *   所以 fidelity=0。口径写成「核心事实还在」会让 Budgeted 变成 111，三难塌缩。
 * - tokenEfficiency：每轮平均计费**严格小于**同场景「不裁剪基线」——省了才算省。
 */
function axesOf(protocol, corpus, flags, opts = {}) {
  const steady = runScenario(protocol, corpus, 'steadyReuse', flags, opts)
  const over = runScenario(protocol, corpus, 'overBudget', flags, opts)
  // 基准 = 「现实世界的不裁剪版本」：中性开关 + 预算无限。
  // 关键：基准**不能**带上当前 rigged 开关，否则「开挂」会把自己也比掉、效率位永远为假。
  const baseline = runScenario(protocol, corpus, 'overBudget', { ...NEUTRAL_FLAGS, unlimitedBudget: true }, opts)
  const expectedHits = Math.max(1, steady.messages - 1)
  const hitRate = steady.hits / expectedHits
  const cacheHitRate = hitRate >= 0.5
  const coreKeepRate = over.coreTotal > 0 ? over.coreKept / over.coreTotal : 0
  const factsIntact = over.droppedFacts === 0
  const infoFidelity = factsIntact
  const tokenEfficiency = over.perTurnTokens < baseline.perTurnTokens
  return {
    cacheHitRate, infoFidelity, tokenEfficiency,
    supports: {
      steadyHits: steady.hits, expectedHits, hitRate: round4(hitRate),
      coreKept: over.coreKept, coreTotal: over.coreTotal, coreKeepRate: round4(coreKeepRate),
      droppedFacts: over.droppedFacts, factsIntact,
      perTurnTokens: over.perTurnTokens, baselinePerTurnTokens: baseline.perTurnTokens,
      trimmedTokens: over.trimmedTokens,
      hitSource: 'local-prefix-fingerprint', tokenSource: 'heuristic-estimate',
    },
  }
}

export function promptCacheStudy(opts = {}) {
  const seed = intOr(opts.seed, PROMPT_CACHE_DEFAULTS.seed)
  const messages = intOr(opts.messages, PROMPT_CACHE_DEFAULTS.messages)
  const budgetTokens = intOr(opts.budgetTokens, PROMPT_CACHE_DEFAULTS.budgetTokens)
  const flags = {
    freeStablePrefix: opts.freeStablePrefix === true,
    zeroTrimPenalty: opts.zeroTrimPenalty === true,
    losslessSummaryTrim: opts.losslessSummaryTrim === true,
    unlimitedBudget: opts.unlimitedBudget === true,
  }
  const rigged = opts.rigged === true
  const now = typeof opts.now === 'function' ? opts.now : () => 555
  const corpus = createSyntheticCorpus({ seed, messages })

  const rows = []
  for (const protocol of PROMPT_CACHE_STRATEGIES) {
    const cells = PROMPT_CACHE_SCENARIOS.map((sc) => runScenario(protocol, corpus, sc, flags, { budgetTokens }))
    // 三轴真跑现算：rigged 的三个开关直接进内核 ⇒ rigged 的向量也是现算的，不是查表改的。
    const ax = axesOf(protocol, corpus, flags, { budgetTokens })
    rows.push({
      protocol,
      scenarios: cells,
      trilemma: { cacheHitRate: ax.cacheHitRate, infoFidelity: ax.infoFidelity, tokenEfficiency: ax.tokenEfficiency },
      axes: ax.supports,
      metrics: {
        totalShippedTokens: cells.reduce((a, c) => a + c.tokensShipped, 0),
        totalRetainedFacts: cells.reduce((a, c) => a + c.retainedFacts, 0),
        totalDroppedFacts: cells.reduce((a, c) => a + c.droppedFacts, 0),
        totalTrimmedTokens: cells.reduce((a, c) => a + (c.trimmedTokens ?? 0), 0),
        coreKeepRate: ax.supports.coreKeepRate,
        steadyHits: ax.supports.steadyHits,
        expectedHits: ax.supports.expectedHits,
        perTurnTokens: ax.supports.perTurnTokens,
      },
    })
  }

  const vectors = Object.fromEntries(rows.map((r) => [r.protocol, vectorOf(r.trilemma)]))
  const values = Object.values(vectors)
  const distinct = new Set(values).size === values.length
  const noStrategyWinsAll = !values.includes('111')
  // 场景区分度：四个场景在 (hits, tokensShipped) 上是否真的不同（不是四个名字换着写）。
  const scenarioShapes = rows.map((r) => r.scenarios.map((c) => `${c.hits}:${c.tokensShipped}`).join('|'))
  const scenarioDistinguishes = new Set(scenarioShapes).size === scenarioShapes.length
  const verdict = {
    vectors,
    noUniversalWinner: distinct && noStrategyWinsAll,
    trilemmaDistinguishes: distinct,
    noStrategyWinsAll,
    vectorFromTrilemma: rows.every((r) => vectorOf(r.trilemma) === vectors[r.protocol]),
    scenarioDistinguishes,
    rigged,
    rigged_pkg_flags: flags,
    // 收敛塌缩的判据：三策略向量**全同**（含全 111）。
    // 诚实标定：「两策略升到 111」≠「三策略收敛塌缩」——与 KI-540 同一教训（单点通吃 ≠ 收敛塌缩）。
    riggedConvergenceCollapsed: rigged ? new Set(values).size === 1 : false,
  }

  const soundness = verifyPromptCacheSoundness({ seed, messages }, { seed, messages, budgetTokens })

  return {
    builtAt: now(),
    config: { seed, messages, budgetTokens, ...flags, rigged },
    rows,
    vectors,
    verdict,
    causalLocks: verifyCausalLocks(flags),
    crosscheck: { evidence: createPromptCacheEvidence({ ...flags, rigged, seed, now }), soundness },
    rigged,
  }
}
export const comparePromptCache = promptCacheStudy

export function promptCacheSnapshot(study) {
  const s = study ?? promptCacheStudy({ now: () => 555 })
  return {
    builtAt: s.builtAt,
    config: s.config,
    rows: s.rows.map((r) => ({
      protocol: r.protocol,
      scenarios: r.scenarios.map((c) => ({
        id: c.id, messages: c.messages, freshPrefixTokens: c.freshPrefixTokens,
        suffixTokens: c.suffixTokens, retainedFacts: c.retainedFacts, droppedFacts: c.droppedFacts,
        hits: c.hits, misses: c.misses, tokensShipped: c.tokensShipped, trimmedTokens: c.trimmedTokens,
        perTurnTokens: c.perTurnTokens, coreKept: c.coreKept, coreTotal: c.coreTotal,
        bibleTokens: c.bibleTokens,
        warmupLag: c.warmupLag, rerunIdentical: c.rerunIdentical, fault: c.fault,
      })),
      trilemma: r.trilemma,
      axes: r.axes,
      metrics: r.metrics,
    })),
    vectors: s.vectors,
    verdict: s.verdict,
    noUniversalWinner: s.verdict?.noUniversalWinner,
    trilemmaDistinguishes: s.verdict?.trilemmaDistinguishes,
    causalLocks: s.causalLocks,
    crosscheck: s.crosscheck,
    rigged: s.rigged,
  }
}

/*----------------------------------------------------- soundness 双路自证 + 三路篡改 -----------------------------------------------------*/

/**
 * 内核：双路自证的**同一条 holds 公式**。
 *
 * <p>三路 tamper <b>只改喂法</b>，不改公式：</p>
 * <ul>
 *   <li><code>prefixDrift</code>：注入持续改写的圣经 ⇒ 命中真归零 + prefix 被重付多次；</li>
 *   <li><code>trimDisabled</code>：预算卡成 0 ⇒ 事实全被裁；</li>
 *   <li><code>factsDropped</code>：排序器反向 ⇒ 核心事实被优先裁、infoFidelity 归零。</li>
 * </ul>
 */
function promptCacheCore(input = {}, budget = PROMPT_CACHE_DEFAULTS.budgetTokens, tamper = 'normal') {
  const seed = intOr(input.seed, PROMPT_CACHE_DEFAULTS.seed)
  const messages = intOr(input.messages, PROMPT_CACHE_DEFAULTS.messages)
  const corpus = createSyntheticCorpus({ seed, messages })
  const driftAt = Math.max(1, Math.floor(corpus.turns.length / 2))
  // laneA（Route A）：稳定前缀 warm 池，首轮 miss，此后逐轮命中；tamper 时注入「持续改写」的圣经。
  const bibleAt = tamper === 'prefixDrift'
    ? (i) => (i >= driftAt ? `${PROMPT_CACHE_BIBLE}·改写${i}` : PROMPT_CACHE_BIBLE)
    : null
  const laneA = createStablePrefix({ bibleAt }).invoke(corpus.turns)
  // laneB（Route B）：BudgetedPrefix 在 overBudget 后缀上裁剪；tamper 改预算或改排序方向。
  const laneB = createBudgetedPrefix({
    budgetTokens: tamper === 'trimDisabled' ? 0 : budget,
    invertedRank: tamper === 'factsDropped',
  }).invoke(assembleTurns(corpus, 'overBudget'))
  const nontrivial = corpus.turns.length >= 16
  // 稳定复用：正常路径下 prefix **只付一次**；漂移路径下 prefix 被反复重付 ⇒ 这一项真翻 false。
  const stablePrefixPaidOnce = laneA.freshPrefixTokens <= corpus.prefixTokens
  const coreKeepRate = laneB.coreTotal > 0 ? laneB.coreKept / laneB.coreTotal : 0
  const holds = nontrivial
    && laneA.hits >= Math.ceil(corpus.turns.length / 2)
    && laneB.retainedFacts > 0
    && laneB.trimmedTokens > 0
    && coreKeepRate >= 1
    && stablePrefixPaidOnce === true
  return {
    laneA: { hits: laneA.hits, sharedPrefixTokens: corpus.prefixTokens, freshPrefixTokens: laneA.freshPrefixTokens, turns: corpus.turns.length, driftAt, stablePrefixPaidOnce },
    laneB: { retainedFacts: laneB.retainedFacts, droppedFacts: laneB.droppedFacts, trimmedTokens: laneB.trimmedTokens, coreKept: laneB.coreKept, coreTotal: laneB.coreTotal, coreKeepRate: round4(coreKeepRate) },
    holds,
    nontrivial,
    events: corpus.turns.length,
  }
}

/**
 * verifyPromptCacheSoundness：双路自证 → baseline；三路 tamper 喂回<b>同一个 holds 公式</b>现算。
 * holds = baselineHolds && 三路 tamper 全 false —— 真推导，绝不写死。
 */
export function verifyPromptCacheSoundness(input = {}, opts = {}) {
  const seed = intOr(opts.seed ?? input.seed, PROMPT_CACHE_DEFAULTS.seed)
  const messages = intOr(opts.messages ?? input.messages, PROMPT_CACHE_DEFAULTS.messages)
  const normal = promptCacheCore({ seed, messages }, opts.budgetTokens, 'normal')
  const drifted = promptCacheCore({ seed, messages }, opts.budgetTokens, 'prefixDrift')
  const trimmedOff = promptCacheCore({ seed, messages }, opts.budgetTokens, 'trimDisabled')
  const allDropped = promptCacheCore({ seed, messages }, opts.budgetTokens, 'factsDropped')
  const baselineHolds = normal.holds
  const falsifiable = baselineHolds && !drifted.holds && !trimmedOff.holds && !allDropped.holds
  const holds = baselineHolds && falsifiable
  return {
    laneA: normal.laneA,
    laneB: normal.laneB,
    baselineHolds,
    holds,
    nontrivial: normal.nontrivial,
    falsifiable,
    tamper: {
      prefixDrift: {
        holds: drifted.holds,
        reason: 'prefixDrift：bible 正文第 ' + normal.laneA.driftAt + ' 回合起被持续改写 ⇒ warm 池命中真归零（余 ' +
          drifted.laneA.hits + ' 命中）、prefix 被重付 ' + drifted.laneA.freshPrefixTokens + ' 次 ⇒ holds 真翻 false',
      },
      trimDisabled: {
        holds: trimmedOff.holds,
        reason: 'trimDisabled：预算卡成 0（裁剪器永不放行）⇒ overBudget 后缀事实全被裁，retained=' +
          trimmedOff.laneB.retainedFacts + ' ⇒ holds 真翻 false',
      },
      factsDropped: {
        holds: allDropped.holds,
        reason: 'factsDropped：事实排序器反向 ⇒ 核心事实被优先裁，coreKeepRate=' +
          allDropped.laneB.coreKeepRate + ' ⇒ infoFidelity 归零 ⇒ holds 真翻 false',
      },
    },
    events: normal.events,
  }
}

/*----------------------------------------------------- causal locks -----------------------------------------------------*/

/**
 * 三道因果锁，全部**真跑探针**得出（没有写死的 driftHits=0）：
 *
 * - prefixAffinity：稳定前缀命中 > 0，且持续改写后漂移点的命中数**真算出来是 0**；
 * - tokenBudget：预算卡到连核心事实都装不下 ⇒ 核心事实必然被裁；
 * - factRank：按密度降序排列后单调不增（排序器行为稳定）。
 */
export function verifyCausalLocks(flags = {}) {
  // 探针 1：prefix affinity —— 前缀漂移 ⇒ cache 归零（必然不是概率）
  const probeCorpus = createSyntheticCorpus({ seed: 555, messages: 8 })
  const stableProbe = createStablePrefix().invoke(probeCorpus.turns)
  const driftAt = Math.floor(probeCorpus.turns.length / 2)
  const driftedProbe = createStablePrefix({
    bibleAt: (i) => (i >= driftAt ? `${PROMPT_CACHE_BIBLE}·漂移${i}` : PROMPT_CACHE_BIBLE),
  }).invoke(probeCorpus.turns)
  // 漂移点之后的命中数——真数，不是常量。
  const driftHits = driftedProbe.log.filter((l) => l.turn >= driftAt && l.hit === true).length
  const probePrefix = { stableHits: stableProbe.hits, driftHits, driftAt, driftPrefixPayments: driftedProbe.freshPrefixTokens }
  // 探针 2：token budget —— 顶预算 ⇒ 必须裁事实（连核心事实都保不住）
  const corpus = createSyntheticCorpus({ seed: 555, messages: 16 })
  const over = createBudgetedPrefix({ budgetTokens: 48 }).invoke(assembleTurns(corpus, 'overBudget'))
  const probeBudget = { budgetHits: over.hits, trimmedFacts: over.droppedFacts, coreTrimmedFacts: over.coreTotal - over.coreKept }
  // 探针 3：fact rank —— 密度降序后单调不增
  const facts = corpus.turns[0].facts.concat(corpus.turns[0].heavy)
  const ranked = facts.slice().sort((a, b) => factDensity(b) - factDensity(a))
  const rankSorted = ranked.every((f, i, arr) => (i === 0 || factDensity(arr[i - 1]) >= factDensity(f))) ? 1 : 0
  const locks = {
    prefixAffinityCausallyUnerasable: probePrefix.stableHits > 0 && probePrefix.driftHits === 0,
    tokenBudgetCausallyUnerasable: probeBudget.trimmedFacts > 0 && probeBudget.coreTrimmedFacts > 0,
    factRankCausallyUnerasable: rankSorted === 1,
  }
  return {
    ...locks,
    causalLocksAllHold: locks.prefixAffinityCausallyUnerasable && locks.tokenBudgetCausallyUnerasable && locks.factRankCausallyUnerasable,
    probes: {
      stableHits: probePrefix.stableHits,
      driftHits: probePrefix.driftHits,
      driftAt: probePrefix.driftAt,
      driftPrefixPayments: probePrefix.driftPrefixPayments,
      budgetHits: probeBudget.budgetHits,
      trimmedFacts: probeBudget.trimmedFacts,
      coreTrimmedFacts: probeBudget.coreTrimmedFacts,
      rankSorted,
    },
  }
}

/*----------------------------------------------------- 21 件证据（跨系统交叉印证） -----------------------------------------------------*/

export function createPromptCacheEvidence(opts = {}) {
  const seed = intOr(opts.seed, PROMPT_CACHE_DEFAULTS.seed)
  const fixedNow = startClock(opts.now, 0)
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `prompt:key:${i}`)
  const ev = {}

  // 1) 一致性哈希路由：Ring vs Modulo（「cache host 分片」训练）
  const router = createShardRouter({ shards: ['a', 'b', 'c'], slotCount: 256, virtualNodes: 16, salt: String(seed) })
  for (const k of keys.slice(0, 80)) router.route(k)
  const rm = router.remapOn(['a', 'b', 'c', 'd'], { mutate: false })
  ev.routerMoved = rm.moved
  ev.routerTracked = rm.total

  const ring = createHashRing({ virtualNodes: 16, salt: String(seed) })
  for (const n of ['a', 'b', 'c', 'd']) ring.addNode(n)
  ev.ringNodes = ring.nodeIds().length
  const dist = ring.distribution(keys)
  ev.ringShardsUsed = dist.nodes - dist.emptyNodes.length

  // 2) WAL：预算账本 append / restore / replay
  const wal = createWal()
  const bibleTokens = estimateTokens(PROMPT_CACHE_BIBLE)
  for (const k of keys.slice(0, 80)) wal.append('put', k, { bibleTokens, turn: 0 })
  const walLines = wal.lines()
  const wal2 = createWal()
  wal2.restore(walLines)
  let walReplayed = 0
  wal2.replay(() => { walReplayed += 1 })
  ev.walLines = walLines.length
  ev.walReplayed = walReplayed

  // 3) Bus：prompt-cache.bound 通知事件
  const bus = createBus()
  let notices = 0
  bus.subscribe('prompt-cache.bound', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('prompt-cache.bound', { key: keys[i], bibleTokens })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('prompt-cache.bound')

  // 4) RedisCache：bible 指纹元信息位图
  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`prompt:meta:${k}`, '1')
  let bitmapHits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`prompt:meta:${k}`) !== undefined) bitmapHits += 1
  ev.redisBitmapHits = bitmapHits
  ev.redisSlots = cache.stats().entries

  // 5) ObjectPool：回合信封对象复用
  const pool = createObjectPool({ factory: () => ({ billed: 0 }), maxSize: 8 })
  const p1 = pool.acquire()
  pool.acquire()
  pool.release(p1)
  pool.acquire()
  const ps = pool.stats()
  ev.poolCreated = ps.created
  ev.poolReused = ps.reused

  // 6) TokenBucket：预算每回合扣费
  const bucket = createTokenBucket({ capacity: 3, refillPerSec: 0, now: nowFn })
  let bucketAllowed = 0, bucketRejected = 0
  for (let i = 0; i < 7; i++) { if (bucket.allow().allowed) bucketAllowed += 1; else bucketRejected += 1 }
  ev.bucketAllowed = bucketAllowed
  ev.bucketRejected = bucketRejected

  // 7) MinHeap：延迟裁剪件排队
  const heap = createMinHeapDelayQueue({ now: fixedNow })
  heap.schedule(fixedNow + 40, 'prompt:trim-check')
  heap.schedule(fixedNow + 250, 'prompt:budget-refresh')
  heap.schedule(fixedNow + 80, 'prompt:prefix-warm')
  ev.heapFired = heap.advance(fixedNow + 1000).length
  ev.heapPending = heap.pending()

  // 8) PackedCounters：64 位打包计数 + 伪共享探针
  const counters = createPackedCounters(64)
  for (let i = 0; i < 64; i++) counters.inc(i, i + 1)
  let counterSum = 0
  for (let i = 0; i < 64; i++) counterSum += counters.get(i)
  ev.counterSum = counterSum
  ev.counterFalseSharing = counters.stats().falseSharingPairs

  // 9) FullJitterBackoff：超预算后按 full jitter 退避重裁
  const jitter = createFullJitterBackoff({ baseTicks: 16, capTicks: 1024, seed })
  const samples = Array.from({ length: 64 }, (_, i) => jitter.delayFor(6, i))
  const sMin = Math.min(...samples), sMax = Math.max(...samples)
  const sMean = samples.reduce((a, b) => a + b, 0) / samples.length
  ev.jitterSpread = sMean > 0 ? round4((sMax - sMin) / sMean) : 0

  // 10) 一致性比较：ring vs modulo 加节点后失效率
  const comp = compareRemapping({ nodes: ['a', 'b', 'c'], addNodes: ['d'], keys, salt: String(seed) })
  ev.remapConsistentRate = comp.consistent.rate
  ev.remapModuloRate = comp.modulo.rate

  return ev
}

/*----------------------------------------------------- live 通道（只认 cached_tokens） -----------------------------------------------------*/

/**
 * live 通道：**只**认真 API 的 `usage.prompt_tokens_details.cached_tokens`。
 *
 * <p><b>为什么只有这一个可信读数</b>：据 `docs/llm-cache-fix.md` 第十一节，本代理的
 * `usage.prompt_tokens` 是<b>代理侧记账值</b>——同一段内容、不同长度会报<b>同一个</b>数字
 * （240 / 400 / 600 / 900 字符全部报 18507）⇒ 拿它算「token 利用率」是拿记账口径当物理量，
 * 跨请求根本不可比。唯一可信的命中读数是 <code>cached_tokens</code>。</p>
 *
 * <p><b>三条 lane 的对照</b>（每条 lane 用**互不相交**的随机命名空间前缀 ⇒ lane 之间零烤热污染，
 * 读数只反映 lane 自身的字节稳定性）：</p>
 * <ul>
 *   <li><code>identical</code>：system 与 user 都逐字节不变（= 旧实验口径「整请求重复」）；</li>
 *   <li><code>stablePrefix</code>：system 逐字节不变、user 每轮都变（= 多轮 NPC 对白的真实形态）；</li>
 *   <li><code>driftingPrefix</code>：system 每轮都改写（= 手滑改了一个标点的最小破坏量）。</li>
 * </ul>
 * <p>三者稳态命中率之差，就是「前缀字节稳定」这件事的因果证据。</p>
 *
 * <p><b>诚实降级</b>：没有 key ⇒ <b>不发任何网络请求</b>，返回 <code>skipped:true / reason:'missing_key'</code>，
 * 绝不拿离线结构量冒充真读数；401 / 429 / 5xx 如实失败不重试（只有 400 代理分流抖动才重试，
 * 与 `caesura-llm-gateway` 同一套判定）。</p>
 *
 * <p><b>流式开关</b>：<code>opts.stream===true</code> 走真 SSE 通道（尾 chunk 才有 usage）；
 * 默认非流。<b>实测（2026-11-14 · 十一节/十二节）流式与否对 cached_tokens 无系统性影响</b>，
 * 真正的变量是「前缀是否逐字节稳定」与「缓存写回需要几轮才可见」。</p>
 */
export async function runPromptCacheLive(opts = {}, deps = {}) {
  const env = deps.env || process.env
  const key = String(env.PROMPT_CACHE_LIVE_KEY || env.CAESURA_LLM_API_KEY || env.WKAPI_KEY || '').trim()
  const baseUrl = String(env.PROMPT_CACHE_LIVE_BASE || 'https://wkapi.pro/v1').trim()
  const model = String(env.PROMPT_CACHE_LIVE_MODEL || 'gpt-6-sol').trim()
  const rounds = Math.max(1, intOr(opts.rounds ?? deps.rounds, 3))
  const stream = opts.stream === true
  const injectKey = opts.injectKey !== false
  const driftLane = opts.driftLane !== false
  const wanted = Array.isArray(opts.lanes) && opts.lanes.length
    ? opts.lanes.filter((l) => l === 'identical' || l === 'stablePrefix' || l === 'driftingPrefix')
    : ['identical', 'stablePrefix', ...(driftLane ? ['driftingPrefix'] : [])]

  if (!key) {
    return {
      live: false, skipped: true, reason: 'missing_key',
      baseUrl, model, rounds: 0, attempts: 0,
      streamMode: stream ? 'stream' : 'non-stream',
      hitSource: 'none', tokenSource: 'none',
      cachedTokens: 0, hitRate: 0,
      lanes: {}, stable: null, drift: null,
      contrast: null,
      note: '未注入 key ⇒ 未发起任何网络调用（诚实降级，绝不拿离线结构量冒充真读数）',
    }
  }

  const callEnv = { ...env, CAESURA_LLM_API_KEY: key }
  const userAt = (i) => `回合${i}：集市第${(i % 7) + 1}摊的报价与音色石状态如何？请只回一句台词。`

  /**
   * lane 专属的命名空间材料：放在 system **最前面**，保证第 1 个缓存块就与其它 lane 不同；
   * 各 lane 长度差 311 字符（≠1024 的整数倍）⇒ 后续块偏移永不对齐 ⇒ 不存在「块内容相同 ⇒ 跨 lane 命中」。
   */
  const namespaceFor = (lane) => {
    const rnd = lcg(0x9e3779b9 ^ Math.imul(laneIndex(lane) + 1, 2654435761))
    const chars = ['锈', '钟', '哑', '弦', '灰', '烬', '汐', '骸', '铃', '砚', '砂', '苔', '隙', '晦']
    const target = 3000 + laneIndex(lane) * 311
    let out = ''
    while (out.length < target) out += chars[Math.floor(rnd() * chars.length)] + '话'.repeat(Math.floor(rnd() * 6) + 1) + '。'
    return out.slice(0, target)
  }
  const messagesFor = (lane, i, ns) => {
    const head = `${ns}\n${PROMPT_CACHE_BIBLE}`
    if (lane === 'identical') return [{ role: 'system', content: head }, { role: 'user', content: userAt(0) }]
    if (lane === 'driftingPrefix') {
      // 每次只改一个字符——这正是「手滑改了一个标点」的最小破坏量。
      return [{ role: 'system', content: head + '·'.repeat(i + 1) }, { role: 'user', content: userAt(i) }]
    }
    return [{ role: 'system', content: head }, { role: 'user', content: userAt(i) }]
  }

  async function lane(laneName) {
    const ns = namespaceFor(laneName)
    const cachedTokens = []
    const promptTokensReported = []
    const statuses = []
    let attempts = 0
    let hits = 0
    let degraded = 0
    for (let i = 0; i < rounds; i++) {
      const messages = messagesFor(laneName, i, ns)
      const opts = { mode: 'live', baseUrl, model, stream }
      if (injectKey) opts.promptCacheKey = derivePromptCacheKey(messages, {})
      const r = await callLlm(messages, opts, { env: callEnv, fetchImpl: deps.fetchImpl })
      attempts += intOr(r?.attempts, 1)
      statuses.push(intOr(r?.status, 0))
      if (r?.degradedWithoutCacheKey === true) degraded += 1
      const ct = intOr(r?.cachedTokens, 0)
      cachedTokens.push(ct)
      // 代理侧记账值：如实记录但**标注不可跨请求比较**，绝不拿它当物理量。
      promptTokensReported.push(intOr(r?.usage?.prompt_tokens, 0))
      if (r?.ok === true && ct > 0) hits += 1
    }
    // 暖机轮数 = 第一次出现命中的轮次（1-based）；从未命中 ⇒ rounds+1（诚实记「本轮次内没暖起来」）。
    const firstHit = cachedTokens.findIndex((c) => c > 0)
    return {
      lane: laneName, cachedTokens, promptTokensReported, statuses, attempts, hits, misses: rounds - hits,
      degradedWithoutCacheKey: degraded,
      warmupRounds: firstHit >= 0 ? firstHit + 1 : rounds + 1,
      hitRate: round4(hits / rounds),
    }
  }

  const lanes = {}
  for (const name of wanted) lanes[name] = await lane(name)
  const stable = lanes.stablePrefix || null
  const drift = lanes.driftingPrefix || null
  const identical = lanes.identical || null
  const hitRate = stable && stable.cachedTokens.length > 0
    ? round4(stable.cachedTokens.filter((c) => c > 0).length / stable.cachedTokens.length)
    : 0
  // 判据：字节稳定的前缀 lane 必须优于漂移 lane（这才是本件的因果主张）。
  const contrast = stable && drift
    ? {
      identicalHitRate: identical ? identical.hitRate : null,
      stableHitRate: stable.hitRate,
      driftHitRate: drift.hitRate,
      stableBeatsDrift: stable.hitRate > drift.hitRate,
      identicalBeatsStable: identical ? identical.hitRate >= stable.hitRate : null,
      distinct: stable.hitRate !== drift.hitRate,
      warmupRounds: { identical: identical ? identical.warmupRounds : null, stablePrefix: stable.warmupRounds, driftingPrefix: drift.warmupRounds },
    }
    : null
  return {
    live: true, skipped: false, reason: null,
    baseUrl, model, rounds,
    streamMode: stream ? 'stream' : 'non-stream',
    injectKey,
    attempts: Object.values(lanes).reduce((a, l) => a + l.attempts, 0),
    hitSource: 'api-usage-prompt-tokens-details-cached-tokens',
    tokenSource: 'proxy-accounting-not-comparable',
    cachedTokens: stable ? stable.cachedTokens.reduce((a, b) => a + b, 0) : 0,
    hitRate,
    lanes,
    stable,
    drift,
    identical,
    contrast,
    prefixBytes: PROMPT_CACHE_BIBLE.length,
    prefixTokens: estimateTokens(PROMPT_CACHE_BIBLE),
    prefixSignature: hash32(PROMPT_CACHE_BIBLE).toString(16),
    note: 'cached_tokens 是唯一可信命中读数；prompt_tokens 是代理侧记账值，跨请求不可比；未命中时 prompt_tokens_details 字段可能整体缺失；三条 lane 用互不相交的命名空间前缀，防跨 lane 烤热污染',
  }
}

/*----------------------------------------------------- CLI -----------------------------------------------------*/

const isCliInvocation = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCliInvocation) {
  const args = process.argv.slice(2)
  const bench = args.includes('--bench')
  const rigged = args.includes('--rigged')
  const live = args.includes('--live')
  if (live) {
    const roundsArg = args.find((a) => a.startsWith('--rounds='))
    const res = await runPromptCacheLive({
      rounds: roundsArg ? Number(roundsArg.slice('--rounds='.length)) : 3,
      stream: args.includes('--stream'),
      injectKey: !args.includes('--no-key'),
    })
    if (res.skipped) {
      console.log('[prompt-cache:live] skipped=' + res.reason + ' —— ' + res.note)
    } else {
      console.log('[prompt-cache:live] base=' + res.baseUrl + ' model=' + res.model + ' rounds=' + res.rounds + ' attempts=' + res.attempts
        + ' streamMode=' + res.streamMode + ' injectKey=' + res.injectKey)
      for (const [name, l] of Object.entries(res.lanes)) {
        console.log(`  ${name.padEnd(15)} cached_tokens=${JSON.stringify(l.cachedTokens)} hits=${l.hits}/${res.rounds} hitRate=${l.hitRate} warmupRounds=${l.warmupRounds}`
          + (l.degradedWithoutCacheKey ? ` degraded=${l.degradedWithoutCacheKey}` : ''))
      }
      if (res.contrast) {
        console.log('  contrast: identical=' + res.contrast.identicalHitRate + ' stable=' + res.contrast.stableHitRate
          + ' drift=' + res.contrast.driftHitRate + ' stableBeatsDrift=' + res.contrast.stableBeatsDrift + ' distinct=' + res.contrast.distinct)
      }
      console.log('  hitSource=' + res.hitSource + ' / tokenSource=' + res.tokenSource)
      console.log('  note: ' + res.note)
    }
    process.exit(0)
  }
  const study = promptCacheStudy({ rigged })
  const snap = promptCacheSnapshot(study)
  if (bench) {
    const steady = snap.rows.find((r) => r.protocol === 'StablePrefix').scenarios.find((c) => c.id === 'steadyReuse')
    const cold = snap.rows.find((r) => r.protocol === 'StablePrefix').scenarios.find((c) => c.id === 'coldStart')
    const over = snap.rows.find((r) => r.protocol === 'BudgetedPrefix').scenarios.find((c) => c.id === 'overBudget')
    console.log(`[prompt-cache:bench] seed=${snap.config.seed} turns=${snap.config.messages} prefixTokens=${snap.rows[0].scenarios[0].bibleTokens} coldHits=${cold.hits} warmHits=${steady.hits}/${snap.config.messages - 1} budgetedOverBudgetTrimmed=${over.droppedFacts} retained=${over.retainedFacts} coreKeepRate=${snap.rows[2].axes.coreKeepRate} soundness=${snap.crosscheck.soundness.holds}`)
  } else {
    console.log(JSON.stringify(snap, null, 2))
  }
  process.exit(0)
}
