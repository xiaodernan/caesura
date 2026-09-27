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
  ms_identity: '任一维触及 35 的专属效果：需求侧尚未定义具体效果（§8.2"待实装后补"）',
}

/** 里程碑：腿在表现层（HUD 承载体）的那一份。与字段腿可并存，所以销账判据对它只查"死 id" */
export const UI_BOUND_MILESTONES = {
  ms_beat_ripple: 'HUD 拍点涟漪刻度（体力环心荡圈）',
  ms_crit_ring: 'HUD 暴击飘字的金色泛音环',
}

/** 旗标：被读但还没有写方的账（写方一出现 ⇒ `flagLedgerErrors` 报"该销"） */
export const PENDING_FLAG_WRITERS = {
  'flag.side_nave_found': 'Phase 6-B：侧廊入口需要一段能在地板上站住的领取点几何（当前 secret 坐标在可行走层之外）',
  'flag.brokenbar_resolved': 'Phase 6-B：断弦营地线（收编/清算抉择）',
  'flag.brokenbar_allied': 'Phase 6-B：同上，潜行解专属那条',
  'flag.found_first_phrase': 'Phase 6-C：初句圣所五环线索链（narrative §4.8），不靠走近解',
}

/** 这一行里程碑此刻有没有机制腿：一条字段 grant，或被某个战技槽按 id 引用 */
export function hasMilestoneLeg(row, movementMsIds) {
  if (!isObj(row)) return false
  if (isObj(row.grant) && Object.keys(row.grant).length > 0) return true
  return typeof row.id === 'string' && movementMsIds.has(row.id)
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
