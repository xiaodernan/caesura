/**
 * scripts/reaction-rules.mjs —— `reactions.json`（docs/combat.md §8 受击反应表）的判据本体（KI-436）
 *
 * 与 `ducking-rules.mjs` / `burst-rules.mjs` / `ledger-rules.mjs` 同一只手、同一个理由：判据留在
 * `validate-data.mjs` 里就没法在测试里「喂一张坏表看它拒不拒」（那文件一被 import 就去校验真表并
 * `process.exit`）。搬出来之后校验器只当「把 findings 报成 ERROR 的那张嘴」。
 *
 * **但这一张搬家的动机不是手感，是 KI-433 的臂 A6 量出来的一个洞**：
 * `REACTION_FIELDS`（名册）管「认不认这个字段」，`REACTION_SPECS`（区间）管「认得的字段值在不在范围内」，
 * 两半各管一件事，而**没有任何一道门问「名册里的每一格是否都有一格区间」**。于是 A6 那一刀——从区间表里
 * 删掉 `R4.crumpleDmgMul`——是 0 条 finding、退出码 0、校验器照样绿：那一格从此随便写都不判，
 * 而它同时住在名册、真表、类型面与运行时里，看不见地漏了。
 * 本模块补的就是这句话的机器读者：`reactionLedgerErrors`，两个方向都判。
 *
 * 这一条腿为什么今天可以不配豁免（先量过才敢硬）：`.scratch/ki436/premise.mjs` 实测名册 **5 档 / 10 格**、
 * 区间 **5 档 / 10 格**，双向差集四个 **0**，而 10 格在真表里的值**全是有限数字**——所以「每一格都得有界」
 * 是实话而不是巧合。哪一天有人给某一档加一个字符串格（`tag`／`displayName` 那种），
 * `tests/unit/reaction-rules.test.ts` 那条「10 格全是数值格」的腿会先红并点名，
 * 那时候要做的决定是「给它配豁免」而不是「把这条腿松掉」。
 *
 * 同族那一张为什么**不**跟着搬：`STATUS_FIELDS ⇄ STATUS_SPECS` 今天名册 29 格而区间只有 13 格，
 * 差的 16 格是 `tag`/`displayName`/`desc`/`burst` 这类**非数值**格，而 `overdrive` 那一档在区间表里是
 * 一个诚实的 `{}`（它没有数值）。把同一句话套到 STATUS 上会当场判红 16 条合法豁免——
 * 那需要的是「什么样的格可以没有界」这一条裁决，不在本批，登记为 KI-436 的剩余欠账。
 */

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * §8 受击反应表：只许写有承载体的行（KI-050 立规，KI-052① 补齐分级那三档）。
 * 一行一消费口，加行必须先接线。**这一份就是名册的唯一主人**（KI-436 从 `validate-data.mjs` 搬来）。
 */
export const REACTION_FIELDS = {
  // 消费方：ai/Enemy.onDamaged（§8 R0「架势未破，仅抖动材质发光」——材质发光时长是这一档的全部产品）
  R0: ['flashMs'],
  // 消费方：player/ThirdPersonController.takeDamage（玩家受击一律 R1 等效）+ CombatManager.applyReactionTier（玩家轻击打在敌人身上）
  R1: ['stunMs', 'displaceM'],
  // 消费方：CombatManager.applyReactionTier（重击 / 战技出手的默认档，TIER_BY_KIND）
  R2: ['stunMs', 'displaceM'],
  // 消费方：同上，但要有招式帧的 `reaction:"R3"` 声明才走这一档（今天只有 §4.2 强音大剑跳劈点名）
  R3: ['stunMs', 'displaceM'],
  // 消费方：前两格 combat/EntityStats.addPoise（经 armCrumple 上弦）；第三格 combat/Reactions.ts:crumpleDamageMul → CombatManager 的破势乘算（KI-433）
  R4: ['crumpleMs', 'bossCrumpleMs', 'crumpleDmgMul'],
}

/**
 * 名册里每一格的取值界。**这一份就是区间的唯一主人**（同上）。
 * 界只说「这个数能不能被接受」，它说不出「名册里这一格有没有被问过」——那是 `reactionLedgerErrors` 的活。
 */
export const REACTION_SPECS = {
  R0: { flashMs: { min: 1 } },
  R1: { stunMs: { min: 1 }, displaceM: { min: 0 } },
  R2: { stunMs: { min: 1 }, displaceM: { min: 0 } },
  R3: { stunMs: { min: 1 }, displaceM: { min: 0 } },
  R4: { crumpleMs: { min: 1 }, bossCrumpleMs: { min: 1 }, crumpleDmgMul: { min: 1 } },
}

/** 分级序：`R1 < R2 < R3` 这两列必须「越重越疼」，否则这张表是在奖励用轻击 */
export const REACTION_TIER_ORDER = ['R1', 'R2', 'R3']

/**
 * 名册 ⇄ 区间的**格级**双向对账（KI-434 结案的那句话）。
 *
 * 它判的是两张表之间的关系，一页数据都不读——所以它不需要真表就能被喂坏数据试（这正是搬出来的理由）。
 * 两个方向不对称，都得有：
 *  · 名册有而区间无 ⇒ 那一格的数随便写都不判（A6 那一刀的形状，本函数存在的理由）；
 *  · 区间有而名册无 ⇒ 界在管一格数据里根本不许写的东西，或者名册被删了而界还留着（下一份抄代码的人
 *    会以为那一格有用）。
 * 传参默认走**真**那两张表：生产调用（校验器）就一句 `reactionLedgerErrors()` 走默认路径，
 * 测试则喂合成的两张表——两条路都得有腿，否则「默认路径」本身没人证。
 *
 * @param fields id → 字段名册
 * @param specs  id → 取值界表
 * @returns `[{ key, msg }]`，空数组 = 两张表说的同一件事
 */
export function reactionLedgerErrors({ fields = REACTION_FIELDS, specs = REACTION_SPECS } = {}) {
  const out = []
  if (!isObj(fields) || Object.keys(fields).length === 0) {
    // 读空了就说"这一格在空转"，不退成"两张表都空所以什么都合法"（与 statusLedgerErrors 同一口径）
    return [{ key: 'REACTION_FIELDS', msg: '名册读不到或读空（不是对象／0 档）⇒ 这道对账在空转：没有名册就没有"该有界"的格，两张表一起绿也不说明任何事' }]
  }
  if (!isObj(specs)) {
    return [{ key: 'REACTION_SPECS', msg: '区间表读不到（不是对象）⇒ 这道对账在空转：先把那张表接回来，再谈名册里每一格有没有界' }]
  }
  for (const [id, cells] of Object.entries(fields)) {
    if (!Array.isArray(cells)) {
      out.push({ key: `${id}.字段名册`, msg: `名册里 '${id}' 那一行不是数组 ⇒ 格级对账读不出它有哪些格，这一档等于没判` })
      continue
    }
    if (!(id in specs)) {
      out.push({ key: `${id}.取值表`, msg: `名册里有 '${id}' 而区间表没有这一档 ⇒ 这一档的 ${cells.length} 格数值今天没人管（少一格就少一路 HUD，多一格就是没人消费的数据）` })
      continue
    }
    const bound = specs[id]
    if (!isObj(bound)) {
      out.push({ key: `${id}.取值表`, msg: `区间表里 '${id}' 不是对象 ⇒ 读不出界，这一档在空转` })
      continue
    }
    for (const k of cells) {
      if (!(k in bound)) {
        out.push({ key: `${id}.${k}`, msg: `名册里有 '${id}.${k}' 而区间表没有这一格 ⇒ 它同时住在名册／真表／类型面／运行时，唯独没人问它的数：这一格写成任何值都动不到门禁（KI-433 臂 A6 就是这个形状，0 条 finding）` })
      }
    }
  }
  for (const [id, bound] of Object.entries(specs)) {
    if (!(id in fields)) {
      out.push({ key: `REACTION_SPECS.${id}`, msg: `区间表里有 '${id}' 而名册没有 ⇒ 这条派生该销了：留着它，下一个读代码的人会以为这一档有承载体` })
      continue
    }
    if (!isObj(bound)) continue // 上面已报
    for (const k of Object.keys(bound)) {
      const cells = fields[id]
      if (Array.isArray(cells) && !cells.includes(k)) {
        out.push({ key: `REACTION_SPECS.${id}.${k}`, msg: `区间表里有 '${id}.${k}' 而名册没有 ⇒ 这一格的数据会被拒（名册不认），界却在替它说话：两张表在判两件不同的事` })
      }
    }
  }
  return out
}

/**
 * 一张 `reactions.json` → findings（`{ level, file, where, msg }`）。只读不改。
 *
 * 数值 min/max 的消息主人仍然是校验器里的 `report.sub`（与其余各表同一口径），本函数**不重复**它：
 * 它管形状、行在不在、字段认不认、两半对不对得上，以及那些**逐字段 min/max 说不出**的关系
 * （档位之间的递增、Boss 与小兵的同一条时长轴）。
 *
 * @param file   报告用的文件名（判据不认识文件）
 * @param rows   `reactions.json` 的顶层
 * @param opts   注入两张表（默认走本模块那份真名册／真区间；测试喂合成的）
 */
export function reactionFindings(file, rows, { fields = REACTION_FIELDS, specs = REACTION_SPECS } = {}) {
  const out = []
  const err = (where, msg) => out.push({ level: 'error', file, where: where || file, msg })

  // 两半的关系先判：它不依赖真表，所以真表读坏了也照样要说（否则结构性漏判被数据错误盖住）
  for (const e of reactionLedgerErrors({ fields, specs })) {
    err(e.key, e.msg)
  }

  if (!isObj(rows)) {
    err('', '顶层必须是对象（按 R 行名键控）：一张受击反应表 = §8 的那几行，没有别的形状')
    return out
  }

  for (const id of Object.keys(fields)) {
    if (rows[id] === undefined) {
      err(id, `缺少 '${id}' 这一行：它已有消费方（onDamaged / takeDamage / applyReactionTier / addPoise），缺行就是运行时抛错`)
    }
  }
  for (const [id, row] of Object.entries(rows)) {
    if (!fields[id]) {
      err(id, `'${id}' 在这份 build 里没有承载体：§55 不许写没有消费方的行（R5 浮空＝敌人不会离地，见 KI-052）`)
      continue
    }
    if (!isObj(row)) {
      err(id, '必须是对象')
      continue
    }
    for (const k of Object.keys(row)) {
      if (!fields[id].includes(k)) {
        err(`${id}.${k}`, `不认的字段：新字段必须同时接上消费方（本行可用：${fields[id].join('/')}）`)
      }
    }
  }

  // 分级序：越重越疼
  const tiers = REACTION_TIER_ORDER.map((id) => (isObj(rows[id]) ? rows[id] : null))
  if (tiers.every(Boolean)) {
    const [t1, t2, t3] = tiers
    if (!(t1.stunMs <= t2.stunMs && t2.stunMs <= t3.stunMs)) err('R1/R2/R3', `硬直时长必须递增：${t1.stunMs}/${t2.stunMs}/${t3.stunMs}`)
    if (!(t1.displaceM <= t2.displaceM && t2.displaceM <= t3.displaceM)) err('R1/R2/R3', `位移必须递增：${t1.displaceM}/${t2.displaceM}/${t3.displaceM}`)
  }

  // Boss 不该比小兵破势更短——同一格时长轴上的第二个方向
  const r4 = isObj(rows.R4) ? rows.R4 : null
  if (r4 && isNum(r4.crumpleMs) && isNum(r4.bossCrumpleMs) && r4.bossCrumpleMs < r4.crumpleMs) {
    err('R4', `bossCrumpleMs(${r4.bossCrumpleMs}) 必须 ≥ crumpleMs(${r4.crumpleMs})：Boss 不该比小兵破势更短`)
  }

  return out
}
