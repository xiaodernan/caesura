/**
 * KI-119：combat.md §4.8 那张乐章战技表 ⇄ `movements.json` 的第一台逐格对账机，外加
 * progression.md §7.1/§7.2 与 §11 那三处同族声明的存在性和计数。
 *
 * **病是什么**：§4.8 从 2026-09-22 起是「乐章战技实装帧」的唯一人手抄本，而 KI-117 立在
 * `combat-frames-doc.test.ts` 头部的那句「§4.8（`mv_*`）那张表的另一头住在哪、有几格没读者，
 * 接着量」一直没人量。这一趟先量出来七条（①–⑥ 是本批要改的文档，⑦ 是量过之后要留在记录里的事实）：
 *  ① **数据有而文档没有**——`mv_terminate`（终止）整行不存在：表头写「六式」，数据里是七式；
 *  ② **同一列名两种口径**——§4.1–4.6 的 Recovery 栏是**后摇时长**，§4.8 这一栏是**整段结束的绝对帧**
 *    （引擎判据是 `ThirdPersonController` 的 `action.tick >= f.recovery`），两义共用一个列名；
 *  ③ **键栏说死了绑定**——「R（槽 0）」「C（槽 1）」两格声称某一式固定占某槽某键，而装哪式是玩家在
 *    调音桩上选的（`MovementBook.equip` 今天只有 `Stakerite` 调），引擎里没有任何一处按式子分配键；
 *  ④ **槽的基数两套拼写**——`movements.json > slots[].index` 是 1/2（校验器钉 `index === i+1`），
 *    面板印「第 1 槽」，而两份文档都按数组下标写「槽 0」；
 *  ⑤ **数据有格而文档不读**——`mv_syncopace.landing`（18f 内攻击架势 +3，KI-035 早已闭合）与
 *    `hitbox.forward` 在 §4.8 一个字都没有；
 *  ⑥ **progression.md 落后于它自己的两笔改判**——§7.1 那张页表只有四行（终止页没有），§7.2 里
 *    定音回响／无声协奏仍写「未实装」（2026-09-25 第三步就入了表），§11 那句「四页 + 四式」与
 *    「R=槽 0、C=槽 1」也还停在 Phase 5-C2 第一天；
 *  ⑦ **六行的帧栏与消耗、冷却今天都对得上**（零帧漂移——漂移全在①–⑥那种「整格没人读／说死了」上）。
 *
 * **口径**：
 *  - **表的主人是文档**（沿用 KI-037①／KI-117 那句「文档写几帧，表里就得是几帧」）。这一批**不动数据**：
 *    数据侧七个 `mv_*` 的帧栏本来就有 flow 断言在先、又与文档对得上，所以改的是文档那三处。
 *  - **ms ⇄ f 走引擎的 `msToTicks`**，不抄第三份 16.667。`ticksToMs(44)` 交的是 733.3333333333334，
 *    文档那一格是四舍五入过的整数，所以只判「文档的 ms 推回帧 == 文档的 f」这一向。
 *  - **结算栏按字段身份读**：每个字段有自己的名册（`FIELD_READERS`），认两种拼写——数据字段名本身
 *    （`freezeTicks: 48/60/72f`）与登记过的中文标签（`震裂 2/2/3`）。名册**按字段开**，不按行号不按节号：
 *    改一格拼写会把豁免叫回来重裁，删一格数据不会。
 *  - **三级同值**的字段允许写成一条（`silenceTicks: 420f`）也允许写三条；**三级异值**只许写三条——
 *    写成一条就是把「升级不涨这一格」这件事擦掉。
 *  - **分数量纲**（`silenceDmgBonus` = 0.15）文档写百分数：名册同时认 `15%` 与 `0.15`，因为两份文档
 *    历史上两种都写过。
 *
 * **变异臂教出来的两笔改正**（22 臂第一轮把三条"洞"点名，两条是臂的刀口不对，一条是判据真的窄）：
 *  - §7.1 与 §7.2 都改成**按行收**（`filter` 而不是 `find` 第一行）：两行点同一页 id、或两行的名栏都以同一
 *    `displayName` 开头 ⇒ 双主人红。原先只读第一行，第二行是无声的。
 *  - §7.1 那一行的「页」栏现在必须仍以数据侧 `displayName` 开头（与 §4.8 那一栏同一只手）。A15 那一臂把
 *    页名改成「终止页（本臂删掉）」而**行仍绿**——因为查找只 `includes(pg.id)`，而 id 活在行尾那格的说明里，
 *    名栏那格今天没有任何读者。这一格从那一刻起才有主人。
 *  - **§7.2 的实装栏读判决词，不读子串**：那一格里常常抄着它自己被否证的旧判决（「错拍步」如今正是
 *    `**Implemented**（…原写"Partial：…+3 未实装"）`），子串判据会把一行已经正确的表永远钉红。
 *  - **两本名册互斥**：`NO_DOC_FIELD`（豁免）与 `FIELD_READERS`（读者）不许有同一条字段——豁免在读者之前判，
 *    重名等于"把一格悄悄从被读到改算成被豁免"，而 `claims + exemptHits == dataCells` 那条算术看不出差别。
 *  - **同一标签跨字段**今天不成问题（`damage` 与 `silenceDmgBonus` 都能被叫做「伤害」，但没有一式同时有这两格），
 *    所以没再加一道"标签唯一"的闸；真出现了就是要设计换拼写，而不是让两个字段抢同一格读数。
 *
 * **本门有意不做的三格**（登记，不冒充做了）：
 *  - 结算栏里那些**叙述性数字**（「§7.2 的 0.8/1.0/1.2s」「48 tick 落在她本来就在等的空隙里」
 *    「6×2=12f=200ms」）不在字段名册的形状里——读它们要先给散文建一张数字身份表，那是 KI-028②；
 *  - progression.md §7.2「数值成长（L1→L3）」那一栏 ⇄ `levels` 的逐格对账：那张表里还有六条
 *    **未入表的设计式**（震音刺／不协和撞音／延音遁／反复记号／声啸音浪／万籁共鸣），它们的数值
 *    没有数据可推，先要 KI-028② 那趟普查裁「设计行的数字算不算承诺」；
 *  - `frame.loudness` 的语义（÷10 = 秒，主人是 combat.md §14.5）不重推，只登记它没有读者。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { items, movements } from '@/data'
import type { MovementData } from '@/data/schema'
import { DEFAULT_BINDS } from '@/core/Input'
import { msToTicks, TICK_HZ } from '@/core/Time'

const root = fileURLToPath(new URL('../../', import.meta.url))
/** 行尾统一成 LF：判据不许靠「这份文档今天是什么行尾」这个假设（混行尾会把整段读空） */
const combat = readFileSync(`${root}docs/combat.md`, 'utf8').replace(/\r\n/g, '\n')
const prog = readFileSync(`${root}docs/progression.md`, 'utf8').replace(/\r\n/g, '\n')

const cfg = movements
/** markdown 的强调与代码标记不是内容：先剥掉，名册的拼写就只写语义 */
const MS = (v: string): string => v.replace(/\*/g, '').replace(/`/g, '')

/** 中文数词 → 数（文档把式数／页数写成「六式」「四页」，不是阿拉伯数字） */
const CN: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** 标签与数之间允许文档里那点连接噪声（冒号、全半角括号、加号、markdown 残留） */
const JOIN = '[\\s（(:：=+]*'
/** 数值序列后面必须收口：`2/2/3` 不许把 `2/2/30` 也算命中 */
const TAIL = '(?![\\d.])'

type Kind = 'tick' | 'ms' | 'num' | 'distance' | 'percent'
const UNIT: Record<Kind, string> = { tick: 'f', ms: 'ms', num: '', distance: 'm', percent: '%' }

/**
 * 帧栏／消耗／冷却／结算各列的字段名册：一条 = 数据侧的一个格子。
 * `labels` 是文档可能用的中文称呼（数据字段名自己总在名单里，故不重复）；`col` 决定它读哪一栏。
 */
interface Reader { labels: string[]; kind: Kind; col: 'startup' | 'active' | 'recovery' | 'cost' | 'cooldown' | 'settle' }
const FIELD_READERS: Record<string, Reader> = {
  startup: { labels: [], kind: 'tick', col: 'startup' },
  active: { labels: [], kind: 'num', col: 'active' },
  recovery: { labels: [], kind: 'tick', col: 'recovery' },
  cooldownTicks: { labels: [], kind: 'tick', col: 'cooldown' },
  overdrive: { labels: ['过载'], kind: 'num', col: 'cost' },
  overdriveRamp: { labels: ['每用一次'], kind: 'num', col: 'cost' },
  stamina: { labels: ['体力'], kind: 'num', col: 'cost' },
  damage: { labels: ['伤害'], kind: 'num', col: 'settle' },
  trueDamage: { labels: ['真伤'], kind: 'num', col: 'settle' },
  fissureLayers: { labels: ['震裂'], kind: 'num', col: 'settle' },
  muteTicks: { labels: ['闷音'], kind: 'tick', col: 'settle' },
  distance: { labels: ['位移'], kind: 'distance', col: 'settle' },
  freezeTicks: { labels: [], kind: 'tick', col: 'settle' },
  silenceTicks: { labels: [], kind: 'tick', col: 'settle' },
  silenceDmgBonus: { labels: ['伤害'], kind: 'percent', col: 'settle' },
  echoCharges: { labels: [], kind: 'num', col: 'settle' },
  'frame.poise': { labels: ['架势'], kind: 'num', col: 'settle' },
  'frame.hitStopMs': { labels: ['hitStop'], kind: 'ms', col: 'settle' },
  'frame.multi': { labels: ['multi'], kind: 'num', col: 'settle' },
  'frame.shake': { labels: [], kind: 'num', col: 'settle' },
  'frame.hitbox': { labels: ['hitbox'], kind: 'num', col: 'settle' },
  'landing.poise': { labels: ['poise'], kind: 'num', col: 'settle' },
  'landing.withinTicks': { labels: ['withinTicks'], kind: 'tick', col: 'settle' },
  'echo.windowMul': { labels: ['windowMul'], kind: 'num', col: 'settle' },
}

/** 表现字段：它们的主人不在这张战斗帧表里（`sfx`/`vfx` 的名册在音频侧，`loudness` 的 ÷10 语义在 §14.5）。 */
const NO_DOC_FIELD: Record<string, string> = {
  sfx: '音名册的主人是音频侧（`audio.json` 那一族），战斗帧表抄第二份就是两本账',
  vfx: '特效名册的主人同上；这一栏写了就是第二本账',
  loudness: '语义（÷10 = 秒）住在 combat.md §14.5，逐式的数值今天没有读者 ⇒ 点名登记，不静默跳过',
}

/** 振动档位 → 文档那一格的中文拼写（§4.8 用的是世界内说法，不是枚举值） */
const SHAKE_WORD: Record<string, string> = { graze: '轻擦', normal: '普通', heavy: '重震', boss: '首领震' }

/**
 * 一条字段的规范拼写集合。`2/2/3` 这种**三级同值**额外允许写成一条（`420f`）；
 * 百分数量纲同时认小数写法（`0.15` ⇄ `15%`）。
 */
function forms(kind: Kind, vals: number[]): string[] {
  const u = UNIT[kind]
  const shown = kind === 'percent' ? vals.map((v) => Math.round(v * 100)) : vals
  const out = [`${shown.join('/')}${u}`]
  if (shown.every((s) => s === shown[0])) out.push(`${shown[0]}${u}`)
  if (kind === 'percent') out.push(`${vals.join('/')}`, `${vals[0]}`)
  return out
}

/** 数据侧的格子全集：帧栏三格 + 消耗通道 + 冷却 + 成长字段 + 帧附加字段 + `landing`/`echo` */
function cells(m: MovementData): { field: string; vals: number[] }[] {
  const out: { field: string; vals: number[] }[] = [
    { field: 'startup', vals: [m.frame.startup] },
    { field: 'active', vals: [m.frame.activeStart, m.frame.activeEnd] },
    { field: 'recovery', vals: [m.frame.recovery] },
  ]
  const cost = m.cost as Record<string, number | undefined>
  for (const k of ['overdrive', 'overdriveRamp', 'stamina']) if (cost[k] !== undefined) out.push({ field: k, vals: [cost[k] as number] })
  out.push({ field: 'cooldownTicks', vals: m.levels.map((l) => l.cooldownTicks) })
  const grew = new Set<string>()
  for (const lv of m.levels) for (const k of Object.keys(lv)) if (k !== 'cooldownTicks') grew.add(k)
  // `levels` 的每一级是 `MovementLevel`（可选字段全在声明里），按名取值要过一层 unknown：
  // 直接把接口当 `Record<string, number>` 转，tsc 判的是「两个类型充分不重叠」——那正是这里的形状。
  const levelField = (lv: MovementData['levels'][number], k: string): number =>
    (lv as unknown as Record<string, number | undefined>)[k] as number
  for (const k of [...grew].sort()) out.push({ field: k, vals: m.levels.map((l) => levelField(l, k)) })
  const fr = m.frame as unknown as Record<string, unknown>
  if (fr.poise !== undefined) out.push({ field: 'frame.poise', vals: [fr.poise as number] })
  if (fr.hitStopMs !== undefined) out.push({ field: 'frame.hitStopMs', vals: [fr.hitStopMs as number] })
  if (fr.multi !== undefined) out.push({ field: 'frame.multi', vals: [fr.multi as number] })
  if (fr.shake !== undefined) out.push({ field: 'frame.shake', vals: [] })
  if (fr.hitbox !== undefined) out.push({ field: 'frame.hitbox', vals: [] })
  if (fr.sfx !== undefined) out.push({ field: 'sfx', vals: [] })
  if (fr.vfx !== undefined) out.push({ field: 'vfx', vals: [] })
  if (fr.loudness !== undefined) out.push({ field: 'loudness', vals: [fr.loudness as number] })
  if (m.landing) {
    out.push({ field: 'landing.poise', vals: [m.landing.poise] })
    out.push({ field: 'landing.withinTicks', vals: [m.landing.withinTicks] })
  }
  if (m.echo) out.push({ field: 'echo.windowMul', vals: [m.echo.windowMul] })
  return out
}

/** 一行表体切成单元格（不合并空串：栏位错位要看得见） */
function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
}

/** 取 `### N.N` 那一节：切到下一个 h3/h2 之前（读空 = 下面所有算术都在自证空集，见 prose 那条） */
function h3(md: string, id: string): string {
  const head = md.match(new RegExp(`^### ${esc(id)}[^\\n]*`, 'm'))
  if (!head || head.index === undefined) return ''
  const rest = md.slice(head.index + head[0].length)
  const stop = rest.search(/\n### |\n## /)
  return stop < 0 ? rest : rest.slice(0, stop)
}

const tableRows = (body: string): string[] =>
  body.split('\n').filter((l) => /^\|\s*[^-|: ]/.test(l) && !/^\|\s*(式|页|战技)\s*\|/.test(l))

/**
 * §7.2 实装栏的**判决词**判据：只看那一格开头说没说「未实装」，不看整格里有没有这三个字。
 * 这不是宽松——「错拍步」那一格现在长这样：`**Implemented**（2026-10-07 复核时改正；原写"Partial：…+3 未实装"）`，
 * 它把自己被否证的旧判决抄在括号里当履历。用子串判，这一行会永远红着一行已经正确的表；
 * 用开头判，改判据的那一笔（把 未实装 挪到格首 / 给 Implemented 行冠上 未实装）才会红。
 */
const NOT_IMPLEMENTED_LEADING_RE = /^\*{0,2}\s*未实装/

/**
 * 键位标签的唯一推导：和面板 `Stakerite.keyFor` 同一个表达式（那是它在源码里的第二份，
 * 也是最后一份——文档那一格从此不是第三本账，而是这条推导的**读数**）。
 */
function keyLabel(action: string): string {
  const code = Object.entries(DEFAULT_BINDS.keyboard).find(([, a]) => a === action)?.[0] ?? ''
  return code.replace(/^(Key|Digit|Mouse)/, '')
}
const SLOTS = cfg.slots.map((s) => s.index)
const SLOT_CELL = `槽 ${SLOTS.join('/')} 任选`
const MAP_SENTENCE = cfg.slots.map((s) => `槽 ${s.index}=${s.action}=${keyLabel(s.action)}`).join('、')

/**
 * 一趟读完 §4.8 与 progression 的三处声明。**这里一个 expect 都不做**：读表发生在 describe 求值时，
 * 在那里抛错只会把整个文件炸成一条 suite 级失败（0 条红用例，归属点名读不到谁）。
 */
function readTables() {
  const missingRows: string[] = []
  const unknownRows: string[] = []
  const duplicateRows: string[] = []
  const shape: string[] = []
  const drift: string[] = []
  const unlisted: string[] = []
  const staleExempt: string[] = []
  const prose: string[] = []
  let claims = 0
  let exemptHits = 0

  const body = h3(combat, '4.8')
  if (!body) {
    prose.push('combat.md 里没有 `### 4.8` 那一节 ⇒ 下面的算术在空集上')
    return { missingRows, unknownRows, duplicateRows, shape, drift, unlisted, staleExempt, prose, claims, exemptHits, dataCells: 0, rows: 0 }
  }

  // ① 表头：Recovery 那一栏必须写明是**绝对帧**（§4.1–4.6 同名列是后摇时长，两义不许共用一个名字）
  const headerLine = body.split('\n').find((l) => /^\|\s*式\s*\|/.test(l))
  if (!headerLine) prose.push('§4.8 的表头行（`| 式 | …`）读不到 ⇒ 列序没有主人')
  else {
    const rec = splitRow(headerLine).find((c) => /Recovery/.test(c)) ?? '（那一栏不存在）'
    if (!/绝对/.test(rec)) prose.push(`§4.8 的 Recovery 列名「${rec}」没声明口径：§4.1–4.6 那一栏是**后摇时长**，这一栏是**绝对帧**（引擎判据 \`action.tick >= recovery\`）⇒ 同名列两义必须点破`)
  }

  // ② 引言：式数要从数据现推，槽⇄键那句必须等于推导
  const preamble = body.slice(0, body.search(/\n\|\s*式\s*\|/))
  const cnCount = preamble.match(/([一二两三四五六七八九十])式的实装帧/)
  if (!cnCount) prose.push(`§4.8 引言里那句「N 式的实装帧」读不到 ⇒ 式数没有主人（数据侧是 ${cfg.movements.length} 式）`)
  else if (CN[cnCount[1]!] !== cfg.movements.length) prose.push(`§4.8 引言写「${cnCount[1]}式」＝${CN[cnCount[1]!]} ⇄ movements.json 有 ${cfg.movements.length} 式`)
  if (!preamble.includes(MAP_SENTENCE)) prose.push(`§4.8 引言没有那句现推的槽⇄键映射「${MAP_SENTENCE}」（主人是 movements.json > slots[].index/action + DEFAULT_BINDS.keyboard）`)

  // ③ 逐式：行 ⇄ 数据双向对齐
  const named = new Map<string, string>()
  for (const line of tableRows(body)) {
    const c = splitRow(line)
    const label = MS(c[0] ?? '')
    const id = label.match(/(mv_[a-z0-9]+)/)?.[1]
    if (!id) { unknownRows.push(`§4.8 行「${c[0]}」的「式」栏里没有 \`mv_*\` 数据 id ⇒ 这一行没有主人`); continue }
    const m = cfg.movements.find((x) => x.id === id)
    if (!m) { unknownRows.push(`§4.8 行点了 ${id}，而 movements.json 里没有这一式`); continue }
    if (named.has(id)) { duplicateRows.push(`${id} 被两行点名：「${named.get(id)}」与「${label}」`); continue }
    named.set(id, label)
    if (!label.startsWith(m.displayName)) drift.push(`§4.8 ${id} 的「式」栏「${label}」不以数据侧的 displayName「${m.displayName}」开头`)

    // 槽与键：不许把某一式写死在某槽某键上（装哪式由玩家选，键跟着槽走）
    if (MS(c[1] ?? '') !== SLOT_CELL) drift.push(`§4.8 ${id} 的「键」栏「${c[1]}」不等于槽名册推出来的「${SLOT_CELL}」（槽的基数取 movements.json > slots[].index）`)

    const cols = { startup: MS(c[2] ?? ''), active: MS(c[3] ?? ''), recovery: MS(c[4] ?? ''), cost: MS(c[5] ?? ''), cooldown: MS(c[6] ?? ''), settle: MS(c[7] ?? '') }

    // Startup / Recovery：`Nf/Mms` 两标必须互推得回来
    for (const key of ['startup', 'recovery'] as const) {
      const at = key === 'startup' ? 2 : 4
      const want = key === 'startup' ? m.frame.startup : m.frame.recovery
      const mm = cols[key].match(/^(\d+)f\s*\/\s*(\d+(?:\.\d+)?)ms$/)
      if (!mm) { shape.push(`§4.8 ${id}.${key}「${c[at]}」不是 \`Nf/Mms\` 那一族拼写`); continue }
      const fr = Number(mm[1])
      const asMs = Number(mm[2])
      if (msToTicks(asMs) !== fr) drift.push(`§4.8 ${id}.${key}：${asMs}ms/${fr}f 互推不合（${asMs}ms 按 msToTicks 应为 ${msToTicks(asMs)}f）`)
      else if (fr !== want) drift.push(`§4.8 ${id}.${key}：文档 ${fr} ⇄ 数据 ${want}`)
      else claims++
    }
    // Active：判定窗写成 `A–Bf`（两端都是绝对帧）
    {
      const mm = cols.active.match(/^(\d+)[–-](\d+)f$/)
      if (!mm) shape.push(`§4.8 ${id}.active「${c[3]}」不是 \`A–Bf\` 那一族拼写`)
      else if (Number(mm[1]) !== m.frame.activeStart || Number(mm[2]) !== m.frame.activeEnd)
        drift.push(`§4.8 ${id}.active：文档 ${mm[1]}–${mm[2]} ⇄ 数据 ${m.frame.activeStart}–${m.frame.activeEnd}`)
      else claims++
    }
    // 消耗：那一格的数必须恰为 cost 推出来的那一组（多一个少一个都是漂移）
    {
      const cost = m.cost as Record<string, number | undefined>
      const want = (['stamina', 'overdrive', 'overdriveRamp'] as const)
        .map((k) => cost[k])
        .filter((v): v is number => v !== undefined)
        .sort((a, b) => a - b)
      const got = [...cols.cost.matchAll(/\d+(?:\.\d+)?/g)].map((x) => Number(x[0])).sort((a, b) => a - b)
      if (got.join(',') !== want.join(',')) {
        drift.push(`§4.8 ${id}.cost：文档「${c[5]}」里的数 [${got.join(',')}] ⇄ cost 推出来的是 [${want.join(',')}]`)
      } else {
        for (const k of ['overdrive', 'overdriveRamp', 'stamina'] as const) {
          const v = cost[k]
          if (v === undefined) continue
          const lb = FIELD_READERS[k]!.labels[0]!
          if (!new RegExp(esc(lb) + JOIN + esc(String(v)) + TAIL).test(cols.cost)) drift.push(`§4.8 ${id}.${k}：那一格有这个数，但没把它挂在「${lb}」的称呼上（${c[5]}）`)
          else claims++
        }
      }
    }
    // 冷却：`a→b→cf` 必给；后面那串秒可省，给了就必须由帧推得出来
    {
      const tri = cols.cooldown.match(/(\d+)→(\d+)→(\d+)f/)
      const want = m.levels.map((l) => l.cooldownTicks)
      if (!tri) shape.push(`§4.8 ${id}.cooldownTicks「${c[6]}」里没有 \`a→b→cf\` 那一条`)
      else if ([Number(tri[1]), Number(tri[2]), Number(tri[3])].join(',') !== want.join(','))
        drift.push(`§4.8 ${id}.cooldownTicks：文档 ${tri[1]}→${tri[2]}→${tri[3]}f ⇄ 数据 ${want.join('→')}f`)
      else {
        claims++
        const sec = cols.cooldown.match(/（\s*([\d.]+)→([\d.]+)→([\d.]+)s/)
        if (sec) {
          // tick → 秒只有一个除数：TICK_HZ 就是「每秒几 tick」，再除 1000 就把 2s 读成 0.002s
          const wantS = want.map((t) => Math.round((t / TICK_HZ) * 10000) / 10000)
          const gotS = [Number(sec[1]), Number(sec[2]), Number(sec[3])]
          if (gotS.some((g, i) => Math.abs(g - (wantS[i] as number)) > 0.051))
            drift.push(`§4.8 ${id} 冷却那一格的秒 ${gotS.join('→')}s ⇄ 帧推出来是 ${wantS.map((x) => x.toFixed(1)).join('→')}s`)
        }
      }
    }
    // 结算栏：逐字段（帧栏与消耗、冷却已经在上面判过，这里只读 col==='settle' 的那几格）
    for (const cell of cells(m)) {
      const exempt = NO_DOC_FIELD[cell.field]
      if (exempt !== undefined) { exemptHits++; continue }
      const r = FIELD_READERS[cell.field]
      if (!r) {
        unlisted.push(`§4.8 ${id}.${cell.field}：数据侧有这一格，而名册（FIELD_READERS）与豁免（NO_DOC_FIELD）都不认它 ⇒ 静默少读一格`)
        continue
      }
      if (r.col !== 'settle') continue
      const settle = cols.settle
      if (cell.field === 'frame.shake') {
        const word = SHAKE_WORD[String(m.frame.shake)]
        if (!word) { unlisted.push(`§4.8 ${id}.frame.shake：档位 ${String(m.frame.shake)} 没有登记的中文拼写（SHAKE_WORD）`); continue }
        if (settle.includes(word)) claims++
        else drift.push(`§4.8 ${id}.frame.shake：数据给 ${String(m.frame.shake)}，文档要写「${word}」而结算栏里没有这个说法`)
        continue
      }
      if (cell.field === 'frame.hitbox') {
        const hb = m.frame.hitbox as unknown as Record<string, number | string>
        const mm = settle.match(new RegExp(`inner\\s*([\\d.]+)\\s*/\\s*outer\\s*([\\d.]+)\\s*/\\s*forward\\s*([\\d.]+)${TAIL}`))
        if (!mm) { drift.push(`§4.8 ${id}.frame.hitbox：结算栏读不到 \`inner x / outer y / forward z\` 那三条（数据是 ${String(hb.shape)} inner ${String(hb.inner)} / outer ${String(hb.outer)} / forward ${String(hb.forward)}）`); continue }
        const bad = (['inner', 'outer', 'forward'] as const).filter((k) => Number(mm[k === 'inner' ? 1 : k === 'outer' ? 2 : 3]) !== hb[k])
        if (bad.length) { drift.push(`§4.8 ${id}.frame.hitbox：${bad.map((k) => `${k} 文档 ${mm[k === 'inner' ? 1 : k === 'outer' ? 2 : 3]} ⇄ 数据 ${String(hb[k])}`).join('；')}`); continue }
        if (!settle.includes(String(hb.shape))) { drift.push(`§4.8 ${id}.frame.hitbox.shape：数据是 ${String(hb.shape)}，结算栏没写这个形状名`); continue }
        claims++
        continue
      }
      const labels = [cell.field.replace(/^(frame|landing|echo)\./, ''), ...r.labels]
      const list = forms(r.kind, cell.vals)
      const hit = labels.some((lb) => list.some((fo) => new RegExp(esc(lb) + JOIN + esc(fo) + TAIL).test(settle)))
      if (hit) { claims++; continue }
      const present = labels.some((lb) => new RegExp(esc(lb)).test(settle))
      const seen = [...settle.matchAll(new RegExp(esc(labels[0]!) + JOIN + '([\\d./]+\\s*[a-z%]?)', 'g'))].map((x) => (x[1] ?? '').trim()).filter(Boolean)
      if (present) drift.push(`§4.8 ${id}.${cell.field}：那一格里有「${labels.join('／')}」的说法而数对不上（数据要给的是 ${list[0]}，格子里现在是 ${seen.join(' / ') || '空'}）`)
      else unlisted.push(`§4.8 ${id}.${cell.field}：结算栏既没写它（数据 ${list[0]}），也不在豁免名册里（数据侧有这一格 = 没读者）`)
    }
  }
  for (const m of cfg.movements) if (!named.has(m.id)) missingRows.push(`movements.json 的 ${m.displayName}（${m.id}）在 §4.8 没有点它的行 ⇒ 这一式的帧数没有文档主人`)

  // 豁免名册不许陈旧：每一条都得真的对应到数据侧的格子
  const exemptSeen = new Map<string, number>()
  for (const m of cfg.movements) for (const c of cells(m)) if (NO_DOC_FIELD[c.field] !== undefined) exemptSeen.set(c.field, (exemptSeen.get(c.field) ?? 0) + 1)
  for (const k of Object.keys(NO_DOC_FIELD)) if (!exemptSeen.get(k)) staleExempt.push(`NO_DOC_FIELD 里的「${k}」没命中任何一格（那一格现在有数了 ⇒ 豁免必须撤）`)
  const dataCells = cfg.movements.reduce((a, m) => a + cells(m).length, 0)

  // ④ progression.md §7.1 的页表：每一页有行、那一行的页名等于数据侧的 displayName、解锁源照数据写、不认的页 id 要点名
  const p1 = h3(prog, '7.1')
  const p1Rows = tableRows(p1)
  for (const pg of cfg.pages) {
    // 按**行**收（不是 find 第一行）：两行都点同一页 id 时，哪一行才是主人？A24 那一臂量出的就是这个洞
    const hits = p1Rows.filter((l) => l.includes(pg.id))
    const row = hits[0]
    if (!row) { missingRows.push(`progression.md §7.1 那张页表没有 ${pg.id}（${pg.displayName}）那一行 ⇒ 这一页的点亮源没有文档主人`); continue }
    if (hits.length > 1) { duplicateRows.push(`progression.md §7.1 有 ${hits.length} 行点名 ${pg.id} ⇒ 那一页的点亮源有两本账`); continue }
    // 名栏要等于数据侧的 displayName（§4.8 那一栏同一只手）：只按 id 找行，改掉的页名是读不出来的（A15 那臂量出来的洞）
    const nameCell = MS(splitRow(row)[0] ?? '')
    if (!nameCell.startsWith(pg.displayName)) drift.push(`§7.1 ${pg.id} 那一行的「页」栏「${nameCell}」不以数据侧的 displayName「${pg.displayName}」开头 ⇒ 页名这一格没有对着表，它只借了那一格里残留的 id 通过了查找`)
    const u = pg.unlock as { item?: string; count?: number; flag?: string }
    if (u.flag && !row.includes(u.flag)) drift.push(`§7.1 ${pg.id} 那一行没写出它的点亮旗标 ${u.flag}`)
    if (u.item) {
      const dn = items.find((i) => i.id === u.item)?.displayName ?? u.item
      if (!new RegExp(`${esc(String(u.count ?? 1))}\\s*${esc(dn)}`).test(MS(row))) drift.push(`§7.1 ${pg.id} 那一行没写「${String(u.count)} ${dn}」（数据 unlock = { item: ${u.item}, count: ${String(u.count)} }）`)
    }
  }
  for (const id of [...p1.matchAll(/`(mvpage_[a-z0-9]+)`/g)]) if (!cfg.pages.some((p) => p.id === id[1])) unknownRows.push(`progression.md §7.1 点了 ${id[1]}，而 movements.json.pages 里没有这一页`)

  // ⑤ progression.md §7.2 的战技全表：每一式有且只有一行，已在表里的不许把「未实装」当作**判决词**
  const p2 = h3(prog, '7.2')
  const p2Rows = tableRows(p2)
  const statusCell = (line: string): string => splitRow(line)[5] ?? ''
  for (const m of cfg.movements) {
    const hits = p2Rows.filter((l) => MS(splitRow(l)[0] ?? '').startsWith(m.displayName))
    const row = hits[0]
    if (!row) { missingRows.push(`progression.md §7.2 那张战技全表没有「${m.displayName}」（${m.id}）那一行 ⇒ 它在设计表里不存在，可它已经在数据里了`); continue }
    if (hits.length > 1) { duplicateRows.push(`progression.md §7.2 有 ${hits.length} 行的名栏以「${m.displayName}」开头 ⇒ 这一式在设计表里有两行，判决词读哪一行？`); continue }
    if (NOT_IMPLEMENTED_LEADING_RE.test(statusCell(row))) drift.push(`progression.md §7.2 的「${m.displayName}」那一行实装栏的判决词仍是未实装，而 ${m.id} 在 movements.json 里有帧表（KI-037③ 2026-09-25 就入了表）`)
  }
  if (!p2.includes(MAP_SENTENCE)) prose.push(`progression.md §7.2 的配装那句没有现推的槽⇄键映射「${MAP_SENTENCE}」（同一本账不许两份拼写；旧写法「R=槽 0」的基数还是数组下标）`)

  // ⑥ progression.md §11 那一格「N 页 + M 式」「A/B 式设计未入表」：总数与差数都要由名册/表自己推出来
  const st = prog.split('\n').find((l) => /^\|\s*乐章战技（§7）\s*\|/.test(l))
  if (!st) prose.push('progression.md §11 那张实现状态表里读不到「乐章战技（§7）」那一行 ⇒ 页/式总数没有主人')
  else {
    const pc = st.match(/([一二两三四五六七八九十])页\s*\+\s*([一二两三四五六七八九十])式/)
    if (!pc) prose.push('§11 那一格里的「N 页 + M 式」读不到 ⇒ 总数没有主人（数据侧是 ' + `${cfg.pages.length} 页 / ${cfg.movements.length} 式` + '）')
    else {
      if (CN[pc[1]!] !== cfg.pages.length) prose.push(`progression.md §11 写「${pc[1]}页」＝${CN[pc[1]!]} ⇄ movements.json.pages 有 ${cfg.pages.length} 页`)
      if (CN[pc[2]!] !== cfg.movements.length) prose.push(`progression.md §11 写「${pc[2]}式」＝${CN[pc[2]!]} ⇄ movements.json.movements 有 ${cfg.movements.length} 式`)
    }
    const gap = st.match(/(\d+)\/(\d+)\s*式设计未入表/)
    const notIn = p2Rows.filter((l) => NOT_IMPLEMENTED_LEADING_RE.test(statusCell(l))).length
    if (!gap) prose.push('§11 那句「A/B 式设计未入表」读不到 ⇒ 这张设计表的总数与未入表数没有主人')
    else if (Number(gap[1]) !== notIn || Number(gap[2]) !== p2Rows.length)
      prose.push(`progression.md 写「${gap[1]}/${gap[2]} 式设计未入表」⇄ §7.2 那张表自己数出来的是 ${notIn}/${p2Rows.length}`)
    if (!st.includes(MAP_SENTENCE)) prose.push(`progression.md §11 那一格没有现推的槽⇄键映射「${MAP_SENTENCE}」（它今天写的是「R=槽 0、C=槽 1」）`)
  }

  return { missingRows, unknownRows, duplicateRows, shape, drift, unlisted, staleExempt, prose, claims, exemptHits, dataCells, rows: named.size }
}

describe('KI-119：combat.md §4.8 的乐章战技帧表逐格对着 movements.json，外加 progression.md §7.1/§7.2/§11 的存在性与计数', () => {
  const r = readTables()

  it('绑定读得出（地板）：每一式恰有一行，且数据侧每一格都有归宿', () => {
    expect(r.missingRows, `数据有而文档没有：\n${r.missingRows.join('\n')}`).toEqual([])
    expect(r.unknownRows, `文档点了数据里没有的东西：\n${r.unknownRows.join('\n')}`).toEqual([])
    expect(r.duplicateRows, `一式被两行点名（哪一行是主人？）：\n${r.duplicateRows.join('\n')}`).toEqual([])
    expect(r.rows, `§4.8 读到 ${r.rows} 式，不等于数据侧的 ${cfg.movements.length} ⇒ 下面的算术在自证空集`).toBe(cfg.movements.length)
    expect(r.dataCells, `数据侧格子数 ${r.dataCells} 不足以铺满帧栏+消耗+冷却+结算 ⇒ 名册读窄了（分母从数据现推，不是手钉）`).toBeGreaterThan(60)
    expect(r.claims + r.exemptHits, `文档有数的格 ${r.claims} + 命中豁免的格 ${r.exemptHits} ≠ 数据侧的 ${r.dataCells} 格 ⇒ 要么表被读窄，要么豁免与实格不是一一对应`).toBe(r.dataCells)
  })

  it('帧栏逐格对等（主人是文档；ms 与 f 必须互推得回来）', () => {
    expect(r.shape, `那一格的拼写推不出数（新形状要先认下来，不然静默少读一格）：\n${r.shape.join('\n')}`).toEqual([])
    expect(r.drift, `文档 ⇄ 数据漂移：\n${r.drift.join('\n')}`).toEqual([])
  })

  it('结算栏：每一格要么被读到、要么在豁免名册里，两条都不沾的就是没读者', () => {
    expect(r.unlisted, `这些格子没有读者又不在名册里：\n${r.unlisted.join('\n')}`).toEqual([])
    const exemptTotal = cfg.movements.reduce((a, m) => a + cells(m).filter((c) => NO_DOC_FIELD[c.field] !== undefined).length, 0)
    expect(r.exemptHits, `豁免名册 ${Object.keys(NO_DOC_FIELD).length} 条实际命中 ${r.exemptHits} 格（数据侧该豁免的格子是 ${exemptTotal} 格）`).toBe(exemptTotal)
    expect(r.staleExempt, `陈旧豁免：${r.staleExempt.join(' ，')}`).toEqual([])
  })

  it('口径与计数：列名点破两义、式数与页数从数据现推、槽⇄键那句等于推导、设计表的差数等于它自己', () => {
    expect(r.prose, `文档自己那一头对不上数据或对不上它自己的表：\n${r.prose.join('\n')}`).toEqual([])
  })

  it('反向自证：名册与推导自己得先成立（判据读空也叫通过就是假绿）', () => {
    expect(Object.keys(FIELD_READERS).length, '字段名册读窄了（数据侧字段的并集要在里面）').toBeGreaterThanOrEqual(20)
    expect(Object.keys(NO_DOC_FIELD).length, '豁免名册为空 = 上面那条「命中数」在自证 0').toBeGreaterThan(0)
    expect(SLOT_CELL, '槽名册推出来是空（movements.json > slots 读不到）').toMatch(/^槽 \d/)
    expect(cfg.slots.length, '槽数为 0 ⇒ 映射句没有载体').toBeGreaterThan(0)
    for (const s of cfg.slots) expect(keyLabel(s.action), `${s.action} 在 DEFAULT_BINDS.keyboard 里没有键 ⇒ 映射句推不出键`).not.toBe('')
    for (const s of cfg.slots) {
      // 映射句的每一段都得是「槽 N=action=键」三件套：少一段，文档那一格就没有载体了
      expect(MAP_SENTENCE).toContain(`槽 ${s.index}=${s.action}=${keyLabel(s.action)}`)
    }
    expect(MAP_SENTENCE.split('、').length, '映射句的段数要等于槽数，多一段就是手抄了一段').toBe(cfg.slots.length)
    // 两本名册必须互斥：豁免是在 `FIELD_READERS` 之前判的，一条字段若同时进了两本，
    // 「被读到的格」就悄悄变成「命中豁免的格」——`claims + exemptHits == dataCells` 那条算术照旧绿，
    // 而那一格再也无人对账。豁免只能豁免名册外的东西。
    for (const k of Object.keys(NO_DOC_FIELD)) {
      expect(FIELD_READERS[k], `豁免名册里的「${k}」同时在 FIELD_READERS 里 ⇒ 它会被豁免吞掉而不是被读掉（两本名册必须互斥）`).toBeUndefined()
    }
    // 判决词判据自己得先会分：子串会红一行已经正确的表（见 NOT_IMPLEMENTED_LEADING_RE 那条注释）
    for (const [cell, want] of [
      ['未实装', true],
      ['**未实装**', true],
      ['**Implemented**（2026-10-07 复核时改正；原写"Partial：+3 未实装"）', false],
      ['**Partial（KI-037）**：已入表，缺口：另两式未实装', false],
    ] as [string, boolean][]) {
      expect(NOT_IMPLEMENTED_LEADING_RE.test(cell), `判决词判据把「${cell}」判反了：它读的应当是那一格开头的判决，不是整格里的子串`).toBe(want)
    }
  })
})
