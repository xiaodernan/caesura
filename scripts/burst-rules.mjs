/**
 * scripts/burst-rules.mjs — 连发（`ProjectileSpec.burst`）的判据本体（KI-085）
 *
 * 与 `battle-rules.mjs` / `explore-rules.mjs` / `ambience-rules.mjs` / `lockon-rules.mjs` 同一只手、
 * 同一个理由：判据留在 `validate-data.mjs` 里就没法在测试里"喂一组非法数看它拒不拒"（那文件一被
 * import 就去校验真表并 `process.exit`）。搬出来之后
 * 校验器只当"把 findings 报成 ERROR/WARN 的那张嘴"，门禁与 `tests/unit/burst-table.test.ts`
 * 读的是**同一份代码**。
 *
 * 刻意留在校验器的那一半：`count` / `everyTicks` / `at[i]` 各自的**缺失 / 非有限数 / 越界**由
 * `report.num` 管（那是第三个主人不该插手的地方），所以这里只判**格与格之间的关系**。
 *
 * 为什么这四条值得成为门：combat.md §14.4 那句「三叠箭第 2 拍为假动作（延迟 0.25 拍），骗翻滚后
 * 硬直 0.6s」说的全是**这一组数之间的关系**——哪一发是诱饵、它比均匀网格晚多少、它后面还有没有
 * 真收尾、硬直盖不盖得住下一发的间隔。逐字段的 `min` 判据对这四件事一句都说不出：把 `at` 从
 * `[0,32,42]` 改成 `[0,21,42]`（均匀网格，假动作消失了）或者把 `punishMs` 改成 50（惩罚短到玩家
 * 还能再滚一次），在旧判据下完全合法。这里把那半句中文折成四条不等式，让"改了数而没人改文档"
 * 当天红。
 */

/** `schema.ts > ProjectileBurst` 的字段（词表对账 `VOCAB_PAIRS` 读的正是这张名单） */
export const BURST_FIELDS = ['count', 'everyTicks', 'at', 'feint']
/** `schema.ts > BurstFeint` 的字段 */
export const FEINT_FIELDS = ['shot', 'punishMs']

/**
 * 逻辑 tick 的频率（Hz）。主人是 `src/core/Time.ts > TICK_HZ`，这里抄一份是因为 node 吃不下 `.ts`——
 * `.mjs` 牵不进那个模块。**抄了就要有对账**：
 * `tests/unit/burst-table.test.ts` 有一条门读 `Time.ts` 的源码行，两处不一致就红。
 */
export const TICK_HZ = 60

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const isArr = (v) => Array.isArray(v)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const isInt = (v) => isNum(v) && Number.isInteger(v)
const msToTicks = (ms) => Math.round(ms / (1000 / TICK_HZ))

/**
 * 一处连发（`...frames.projectile.burst`）→ findings（`{ level, file, where, msg }`）。只读不改。
 *
 * `where` 由调用方给（同一份判据要挂在 enemies.json 的各个招式与将来别的表上），所以这里的每一句
 * 说法都带着"在哪一块"而不假设自己只住在一个文件里。缺数时后面的关系**一律不作声**：那三种说法
 * 归 `report.num`，而 NaN 参与比较恒假会让这里跟着报一堆不存在的矛盾。
 */
export function burstFindings(file, where, burst) {
  const out = []
  const err = (sub, msg) => out.push({ level: 'error', file, where: sub ? `${where}.${sub}` : where, msg })

  if (!isObj(burst)) {
    // 与 lockOn 同一张脸：这块读不出来时玩法不是"少校验一项"而是连发直接不发，所以要说一句就够，
    // 但要说出来——静默通过等于把"三叠箭变成单发"当成合法改动。
    err('', '缺失或非对象：连发的发数与拍位必须有来源，代码里不留第二个数')
    return out
  }

  for (const k of Object.keys(burst)) {
    if (BURST_FIELDS.includes(k)) continue
    err(k, `未知字段 ${k}：这一块的字段就是 \`schema.ts > ProjectileBurst\` 那四格，加字段要连消费方一起加（§55）`)
  }

  const { count, everyTicks, at, feint } = burst

  if (feint === undefined) {
    // 没有诱饵声明就连发关系都谈不上（`at` 与 `everyTicks` 的错位由 `report.num` 各自管，
    // 而"帧位比发数多"那条 WARN 已经住在校验器里，这里不抄第二遍）。
    return out
  }

  if (!isObj(feint)) { err('feint', '必须是对象'); return out }
  for (const k of Object.keys(feint)) {
    if (FEINT_FIELDS.includes(k)) continue
    err(`feint.${k}`, `未知字段 ${k}：诱饵声明的字段就是 \`schema.ts > BurstFeint\` 那两格（哪一发 / 罚多久），加字段要连消费方一起加（§55）`)
  }

  const { shot, punishMs } = feint

  // ① 诱饵必须落在**真会发出去**的那一发上。`at` 缺失时这一条不判"越界"，由②统一说一句"没有显式
  //    帧位就没有延迟可言"——同一个缺陷报两条，红的那条会把人往错的那一格带。
  if (isInt(shot) && isInt(count) && !(shot >= 0 && shot < count)) {
    err('feint.shot', `诱饵下标 ${shot} 不在 0..${count - 1} 里：这一格永远等不到离手的那一发，惩罚就是死数据（§55）`)
    return out
  }

  // ② §14.4 的「假动作」靠的是**显式帧位偏离均匀网格**；没有 at，"延迟的那一发"在数据里根本不存在。
  if (!isArr(at) || !isInt(shot) || at.length <= shot) {
    err('feint', '声明了诱饵却没有可读的显式帧位 at[shot]：缺省时每一发都落在 everyTicks 的均匀网格上，"延迟 0.25 拍的假动作"这句话在这组数下没有载体')
    return out
  }

  const grid = isInt(everyTicks) ? shot * everyTicks : null
  const thisFrame = at[shot]

  // ③ 诱饵后面必须还有**真收尾**：假动作的用处就是把下一发送进玩家的惩罚窗，最后一发当诱饵等于白送
  //    （玩家被骗空之后没有任何东西在等他）。这一条排在"延迟"之前并且报完就走：`shot` 指到最后一发时
  //    "它不比网格晚"往往也成立，同一处手误报两条会把人往错的那一格带（KI-083 的 opaque 守卫同因）。
  if (isInt(count) && !(shot < count - 1)) {
    err('feint.shot', `诱饵是最后一发(${shot} = count-1)：假动作后面没有真收尾那一发，骗空一次翻滚之后场上什么都不会发生`)
    return out
  }

  // ④「延迟」这一半：诱饵那一发必须**比均匀网格晚**。早于或等于网格的那一发不叫假动作——
  //    玩家按网格翻滚照样躲得掉，诱饵就没有骗的东西可骗。
  if (isNum(thisFrame) && grid !== null && !(thisFrame > grid)) {
    err('feint.shot', `第 ${shot} 发的帧位(${thisFrame}) 不比均匀网格(${shot} × ${everyTicks} = ${grid}) 晚：那一发不是"延迟的假动作"，§14.4 那句话在这一组数下不成立`)
  }

  // ⑤ 硬直必须**盖得住到下一发之间的那段间隔**（都折成 tick 比，尺子来自 `TICK_HZ`）。间隔按 0 算
  //    时这一条自然成立——同帧连发本来就没有可被骗的窗，不必为此闭嘴报错。
  const nextFrame = shot + 1 < at.length ? at[shot + 1] : (isInt(count) && shot + 1 < count && grid !== null ? grid + everyTicks : null)
  if (isNum(punishMs) && isNum(thisFrame) && typeof nextFrame === 'number') {
    const gap = Math.max(0, Math.round(nextFrame - thisFrame))
    const punish = msToTicks(punishMs)
    if (!(punish > gap)) {
      err('feint.punishMs', `硬直(${punishMs}ms = ${punish} tick) 盖不住诱饵到下一发的间隔(${gap} tick)：玩家被骗空之后还来得及再滚一次，这一格惩罚形同虚设`)
    }
  }

  return out
}
