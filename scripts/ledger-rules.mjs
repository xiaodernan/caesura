/**
 * scripts/ledger-rules.mjs — "先记账后接线"那两份账本的**销账**判据（纯函数，零依赖）。
 *
 * 为什么单独一个文件（与 `report-reds.mjs` 同一个理由）：判据留在 `validate-data.mjs` 里就没法被任何
 * 测试 import——那个脚本一被 import 就会去校验真表。抽出来之后两侧都能来自源码：真表跑真脚本，
 * 合成账本跑单元测试，而不是"作者试过一次"。
 *
 * 这两份账本（里程碑的 `PENDING_MILESTONE_GRANTS` / 旗标的 `PENDING_FLAG_WRITERS`）原本的规则都是
 * **"没腿/没写方 ⇒ 必须记账"**；缺的是反方向那条：**腿或写方出现了，账却没销**。缺的那一半不是洁癖——
 * 账上那句"为什么还没有"是给下一个读代码的人看的理由，理由过期之后它会指着一个已经完成的任务说
 * "这里还欠着"，那比没有账更糟。KI-073 动手前实测：`ms_deepcellar` 的 `grant.corruptionStayPct` 早就落地,
 * 而 pending 的理由还写着「无腿可接」。
 */

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)

/* ------------------------------------------------------------------ */
/* 三份账本住在这里，不住在校验脚本里                                     */
/* ------------------------------------------------------------------ */
// 判据要能喂合成账本（单元测试），真表自洽那条也要能读**同一份**名单。名单如果留在 `validate-data.mjs` 里，
// 测试想读它只有两条路：复制一份（第二个主人，必漂）或从源码里切字符串（第一版就是这么写的，
// 单引号加注释直接 `JSON.parse` 崩）。所以名单搬到这里，校验器与测试共用一个来源。

/** 里程碑：欠着机制腿的账（每条必须说清"为什么还没有腿"；腿一出现 ⇒ `milestoneLedgerErrors` 报"该销"） */
export const PENDING_MILESTONE_GRANTS = {
  ms_identity: '任一维触及 35 的专属效果：**需求侧其实给了**（progression §8.2 第 16–18 行"任一维触及 35 = 该维专属效果（如指法 35：翻滚体力 -2）"）——所以这条账的理由**不是"需求没定义"**，而是**其余各维的专属效果还没有读数**：**机制腿已落（KI-138，2026-10-20）**——`progression.json > identityEffects` 表（哪一维 / 到多少 / 给什么）＋ `Progression.derive` 的两格门槛（面板值够 min ＋ 音级到 ms_identity 的 rank）＋ 消费链（`PlayerMods.rollStaminaFlat` → `ThirdPersonController.rollProfile` 的自由翻滚体力价），需求给的那一例（**指法 35 ⇒ 翻滚体力 -2**）已逐字兑现。**仍欠**：其余各维各自给什么（需求只给了指法一例，其余是设计读数，§55 不许我编）⇒ 表里只有一行，那是如实的，不是漏写',
}

/** 里程碑：腿在表现层（HUD 承载体）的那一份。与字段腿可并存，所以销账判据对它只查"死 id" */
export const UI_BOUND_MILESTONES = {
  ms_beat_ripple: 'HUD 拍点涟漪刻度（体力环心荡圈）',
  ms_crit_ring: 'HUD 暴击飘字的金色泛音环',
}

/**
 * 旗标：被读但还没有写方的账（写方一出现 ⇒ `flagLedgerErrors` 报"该销"）。
 *
 * **这一格今天是空的，而且"空"就是它的目标状态**（KI-091，2026-09-29）：KI-041 立这本账时
 * `regions.json` 里被读到的 8 个旗标一个写方都没有，全部挂在这里；KI-081 落 `brokenbar_resolved`、
 * KI-087 落 `side_nave_found` 与 `brokenbar_allied`、KI-091 落 `found_first_phrase`（无耳深窖井底
 * 那扇门：四环线索齐了才认你）之后，**没有一面被读的旗是没人写的**。
 *
 * 与另外两份名单（`PENDING_MILESTONE_GRANTS` / `UI_BOUND_MILESTONES`）的区别写在这里：
 * 那两份记的是"需求要的效果还没有腿"，做下去还会一直有；这一份记的是**旗标对账欠下的笔**——
 * 它是一条待办清单，销完就该空着。判据本身照旧（新长出来的条目照样要带理由、写方一出现照样报"该销"）。
 */
export const PENDING_FLAG_WRITERS = {}

/** 这一行里程碑此刻有没有机制腿：一条字段 grant，或被某个战技槽按 id 引用 */
export function hasMilestoneLeg(row, movementMsIds) {
  if (!isObj(row)) return false
  if (isObj(row.grant) && Object.keys(row.grant).length > 0) return true
  return typeof row.id === 'string' && movementMsIds.has(row.id)
}

/**
 * 状态名册与它在本仓库派生出的两张按 id 键控的表（字段白名单 / 取值范围）必须同一批行（KI-076）。
 * 为什么这算"账"：名册的主人已经搬到 `core/EventBus.ts` 去了（对账门读它），但这两张派生表还住在
 * 校验器里、还是手抄的。
 *
 * 崩溃的真实形状是**量出来的**，而且第一版量错了：我原以为"名册加一态而白名单没跟上"就会崩，
 * 植入实测发现那种情形一条都不会崩（statuses.json 里没有那一行，那个循环根本走不到）。真正崩的那条是
 * **数据里有这一行、白名单里删掉了它**（删派生行／改名都可能）：读到 `undefined` ⇒ 脚本以 TypeError 收场，
 * 报告一段都不印——十七份表全部没人看（C7b）。给白名单补上 `?? []` 兜底之后同一颗植入变回 5 条可读的红（C7c）。
 * @param roster 名册（数组，来自 EventBus.STATUS_IDS 那份手抄）
 * @param fields id → 字段白名单
 * @param specs  id → 取值范围表
 */
export function statusLedgerErrors({ roster, fields, specs }) {
  const out = []
  if (!Array.isArray(roster)) {
    // 名册读不到时说"每张派生表都该销"是撒谎：主人没了，派生表再全也没人读。同一条门在空转的口径。
    return [{ key: 'STATUS_IDS', msg: '状态名册读不到（不是数组）⇒ 这一格在空转：先把名册接回来，再谈三张表对不对得上' }]
  }
  const ids = roster
  for (const id of ids) {
    if (!isObj(fields) || !(id in fields)) out.push({ key: `${id}.字段表`, msg: `名册里有 '${id}' 而字段白名单没有这一行 ⇒ 数据里那一行的每个字段都会被判成"不认的字段"（假红一片），而在没有兜底的那一版里它直接把校验器崩掉、整份报告一条都不印（补上白名单：§55 一字段一消费方）` })
    if (!isObj(specs) || !(id in specs)) out.push({ key: `${id}.取值表`, msg: `名册里有 '${id}' 而取值范围表没有这一行 ⇒ 这个状态的数值今天没人管（少一维 HUD 就没得播，多一维就是没人消费的数据）` })
  }
  for (const [tbl, t] of [['STATUS_FIELDS', fields], ['STATUS_SPECS', specs]]) {
    for (const id of Object.keys(isObj(t) ? t : {})) {
      if (!ids.includes(id)) out.push({ key: `${tbl}.${id}`, msg: `${tbl} 里有 '${id}' 而名册没有 ⇒ 这条派生该销了（KI-073 同族：留着它，下一个读代码的人会以为名册里多一态）` })
    }
  }
  return out
}

/**
 * 里程碑那两份名单的销账判据。
 * @param pending   id → 欠账理由
 * @param uiBound   id → 承载体说明（这份承诺的是"腿在表现层"，与字段腿可并存，所以只查死条目）
 * @param rows      `progression.json > milestones`
 * @param movementMsIds 被 `movements.json > slots[].milestone` 引用的 id 集合
 * @returns 每条 `{ key, msg }`，调用方逐条 report.error
 */
export function milestoneLedgerErrors({ pending, uiBound, rows, movementMsIds }) {
  const out = []
  const byId = new Map((Array.isArray(rows) ? rows : []).filter(isObj).map((m) => [m.id, m]))
  for (const [id, why] of Object.entries(pending ?? {})) {
    const row = byId.get(id)
    if (!row) {
      out.push({ key: `PENDING_MILESTONE_GRANTS.${id}`, msg: '账上挂着表里没有的里程碑：要么是删行时忘销，要么是 id 抄错（这条账现在谁也接不了）' })
      continue
    }
    if (hasMilestoneLeg(row, movementMsIds)) {
      out.push({
        key: `PENDING_MILESTONE_GRANTS.${id}`,
        msg: `这条账该销了：${id} 已经有机制腿（grant=${JSON.stringify(row.grant ?? {})}），而账上的理由还写着「${why}」——留着假理由比没有账更糟`,
      })
    }
  }
  for (const id of Object.keys(uiBound ?? {})) {
    if (!byId.has(id)) out.push({ key: `UI_BOUND_MILESTONES.${id}`, msg: '账上挂着表里没有的里程碑（删行忘销 ⇒ 这份承载体名单从此没人读）' })
  }
  return out
}

/**
 * 旗标白名单的销账判据：写方一旦出现，条目就该删。
 * @param pending  flag → 欠账理由
 * @param written  Map<flag, 谁写的>（校验器那份 `collectFlagUsage` 的读数）
 */
export function flagLedgerErrors({ pending, written }) {
  const out = []
  for (const [flag, why] of Object.entries(pending ?? {})) {
    const by = typeof written?.has === 'function' && written.has(flag) ? written.get(flag) : null
    if (by) out.push({ key: flag, msg: `这条账该销了：${flag} 已有写方（${by}），而名单里的理由还写着「${why}」` })
  }
  return out
}
