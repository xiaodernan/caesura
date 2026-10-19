/**
 * scripts/lockon-rules.mjs — 锁定四数（`player.json > lockOn`）的判据本体（KI-084）
 *
 * 与 `battle-rules.mjs` / `explore-rules.mjs` / `ambience-rules.mjs` 同一只手、同一个理由：判据留在
 * `validate-data.mjs` 里就没法在测试里"喂一组非法数看它拒不拒"（那文件一被 import 就去校验真表并
 * `process.exit`）。搬出来之后校验器只当"把 findings
 * 报成 ERROR/WARN 的那张嘴"，门禁与 `tests/unit/lockon-table.test.ts` 读的是**同一份代码**。
 *
 * 刻意留在校验器的那一半：四个数的**缺失 / 非有限数 / 越界**由 `report.sub` 全场统一管（那是第三个
 * 主人不该插手的地方），所以这里只判**两个数之间的关系** —— 而那种判据在 `report.num` 的形状里根本
 * 表达不出来：它一次只看一个字段。
 *
 * 为什么这两条值得成为门：`LockOn` 的打分式是
 * `score = -ang × aimWeight - dist × distWeight + (isBoss ? bossBonus : 0)`，其中 `ang` 的单位是
 * **弧度**（`clampAngleDiff` 的绝对值 ∈ [0, π]）。文档里那两句话（§34「Boss 独立锁定框」与
 * tech-arch §3「角度优先→距离」）说的都是**这一组数之间的序关系**，不是某一个数的大小 —— 于是
 * "把 aimWeight 从 2.2 调到 0.5"这种改动在逐字段的 `min` 判据下完全合法，而它已经把那句文档推翻了。
 * 判据做的事只有一件：把那两句中文折成两个不等式，让"改了数而没人改文档"这件事当场红。
 */

/** `schema.ts > LockOnConfig` 的字段：每一项的唯一读者都在 `src/player/LockOn.ts`（那里没有第二份数） */
export const LOCKON_FIELDS = ['range', 'aimWeight', 'distWeight', 'bossBonus']

/** 90° 换成弧度：角度项那一侧的参照格（文档说「角度优先」，量的就是这一格上谁赢） */
export const RIGHT_ANGLE_RAD = Math.PI / 2

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * `player.json` 的 `lockOn` 那一块 → findings（`{ level, file, where, msg }`）。只读不改。
 *
 * 缺数时两条不等式**一律不作声**：那三种说法由 `report.sub` 说，这里跟着说就是第二个主人；而
 * "NaN 比较恒假"那种静默失灵由 `isNum` 挡在前面（见 `tests/unit/lockon-table.test.ts` 那条反向用例）。
 */
export function lockOnFindings(cfg) {
  const file = 'player.json'
  const out = []
  const err = (where, msg) => out.push({ level: 'error', file, where, msg })

  if (!isObj(cfg)) {
    // 缺块的后果不是"少校验一项"而是**玩法整个失灵**：四个数被读成 undefined 之后 `d <= undefined` 恒假，
    // 症状是"锁定谁都锁不上"而控制台一句都不说 —— 所以这一格必须是 ERROR，不是放过。
    err('lockOn', '缺失或非对象：§34 的射程与打分权重必须有来源，代码里不留第二个数（这四个数一旦读成 undefined，`d <= undefined` 恒假 ⇒ 症状是"谁都锁不上"而没有任何报错）')
    return out
  }

  for (const k of Object.keys(cfg)) {
    if (LOCKON_FIELDS.includes(k)) continue
    err(`lockOn.${k}`, `未知字段 ${k}：这一块的字段就是 \`schema.ts > LockOnConfig\` 那四格，唯一读者是 \`src/player/LockOn.ts\`（射程筛选、打分式、脱锁距离）——加字段要连消费方一起加（§55）`)
  }

  const { range, aimWeight, distWeight, bossBonus } = cfg

  // ① §34「Boss 独立锁定框」：同一个角度上，她站在射程最远处也不该被贴脸的杂兵用距离优势抢走
  //    ⇒ Boss 加分必须**严格大过**距离项在整条射程上的最大跨度（现值 35 × 0.06 = 2.1 < 3）。
  if ([range, distWeight, bossBonus].every(isNum)) {
    if (bossBonus <= range * distWeight) {
      err('lockOn', `Boss 加分(${bossBonus}) 不大于距离项在射程上的跨度(${range} × ${distWeight} = ${(range * distWeight).toFixed(3)})：她站在射程边缘就会被贴脸的杂兵抢走锁定`)
    }
  }

  // ② tech-arch §3 那句「角度优先→距离」：从贴脸走到射程尽头，距离能拉开的差距还比不上一个 90°
  //    的偏离惩罚（现值 2.1 < 2.2 × π/2 = 3.456）。角度项要是被削到这个界限以下，那是**文档那一格该改**，
  //    不该让判据追着数跑 —— 所以这条红的话要说的是"两句对不上了"，而不是"这个数不合法"。
  if ([range, aimWeight, distWeight].every(isNum)) {
    if (distWeight * range >= aimWeight * RIGHT_ANGLE_RAD) {
      err('lockOn', `距离项跨度(${(distWeight * range).toFixed(3)}) 已达到角度项在 90° 上的惩罚(${(aimWeight * RIGHT_ANGLE_RAD).toFixed(3)})：文档那句「角度优先→距离」在这一组数下不再成立`)
    }
  }

  return out
}
