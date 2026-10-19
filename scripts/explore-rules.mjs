/**
 * scripts/explore-rules.mjs — 探索曲表（`explore.json`）的判据本体（KI-079）
 *
 * 为什么不留在 `validate-data.mjs` 里：那个文件一被 import 就去校验真表并 `process.exit`
 * （它第 14 行为 `ledger-rules.mjs` 写的同一句理由）。于是"喂一行非法数据、看它拒不拒"这一半
 * 在测试里做不了——一条只有 accept 侧有人量的门
 * 不算门。判据搬到这里之后，校验器只当"把 findings 报成 ERROR/WARN 的那张嘴"，门禁与测试读的是
 * **同一份代码**（不是测试自己抄一份规则，那正是 KI-074 拆掉的东西）。
 *
 * 刻意留在校验器的那一半：`rootHz`/`peak` 的范围、缺失、非有限数——那三种说法由 `report.num`
 * 全场统一管，搬过来等于给同一句话配第二个主人。
 */

/** `schema.ts > ExploreTonal` 的字段。运行时白名单由两支**现拼**（第三份手抄名单 = 第三个主人） */
export const EXPLORE_TONAL_FIELDS = ['id', 'form', 'rootHz', 'beatsPerNote', 'wave', 'peak']
/** `schema.ts > ExploreAtonal` 的字段（§1.2「C→无调」那一格只有这两样） */
export const EXPLORE_ATONAL_FIELDS = ['id', 'form']
export const EXPLORE_FIELDS = [...new Set([...EXPLORE_TONAL_FIELDS, ...EXPLORE_ATONAL_FIELDS])]
/** §1.2 音乐宪法允许的三种音高变形（扩张/压缩是节奏变形，落在 `beatsPerNote` 那一格） */
export const EXPLORE_FORMS = new Set(['prime', 'inversion', 'retrograde'])
/** `ExploreTonal.wave`：与 drone 同一份 WebAudio 波形枚举，但**主人各是 schema 的一条声明**，所以各有一张名单 */
export const EXPLORE_WAVES = new Set(['sine', 'square', 'sawtooth', 'triangle'])
/** 一个音占几拍：1 = 原样、2 = 扩张（augment）、0.5 = 压缩（diminut）。不在格内就不是这条宪法允许的写法 */
export const BEATS_PER_NOTE = new Set([0.5, 1, 2])
/** 「一区一主音」的可辨阈值（音分）：低于这个数，跨那两区听不出换了地方 */
export const MIN_ROOT_CENTS = 50

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const isStr = (v) => typeof v === 'string' && v.length > 0
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * 表 + 区域 → 一串 findings（`{ level, file, where, msg }`）。
 * `rows` 是 `explore.json` 的顶层数组，`regions` 是 `regions.json` 的顶层数组；
 * 两个入参都由调用方原样传入，这里只读不改。
 */
export function exploreFindings(rows, regions) {
  const file = 'explore.json'
  const out = []
  const err = (where, msg, at = file) => out.push({ level: 'error', file: at, where, msg })
  if (!Array.isArray(rows)) { err(file, '顶层必须是数组'); return out }

  const ids = new Set()
  /** 主音名册：`行 id → rootHz`，用来逐对量音分距离 */
  const roots = new Map()
  for (const [i, row] of rows.entries()) {
    if (!isObj(row)) { err(`[${i}]`, '必须是对象'); continue }
    const w = isStr(row.id) ? row.id : `[${i}]`
    if (!isStr(row.id)) err(w, 'id 缺失或非字符串')
    else if (ids.has(row.id)) err(w, `id 重复：${row.id}`)
    else ids.add(row.id)
    for (const k of Object.keys(row)) {
      if (!EXPLORE_FIELDS.includes(k)) err(`${w}.${k}`, '未知字段：探索曲的字段就是 `schema.ts > ExploreTonal`（有调）或 `ExploreAtonal`（无调）那两支，加字段要连消费方一起加')
    }

    if (row.form === null) {
      // 无调那一支：多出来的每一格都是给一条不存在的旋律配的数
      for (const k of ['rootHz', 'beatsPerNote', 'wave', 'peak']) {
        if (row[k] !== undefined) err(`${w}.${k}`, 'form 为 null（这一区没有调性旋律）却写了这一格：给一条不存在的旋律配参数')
      }
      continue
    }
    if (!EXPLORE_FORMS.has(row.form)) {
      err(`${w}.form`, `form=${JSON.stringify(row.form)} 非法：§1.2 只允许 ${[...EXPLORE_FORMS].join('/')} 三种音高变形，或显式的 null（无调）`)
    }
    if (!EXPLORE_WAVES.has(row.wave)) err(`${w}.wave`, `wave=${JSON.stringify(row.wave)} 非法（${[...EXPLORE_WAVES].join('/')}）`)
    if (!BEATS_PER_NOTE.has(row.beatsPerNote)) {
      err(`${w}.beatsPerNote`, `beatsPerNote=${JSON.stringify(row.beatsPerNote)} 非法：§1.2 的节奏变形只有 1（原样）/ 2（扩张）/ 0.5（压缩）三档，别的数不是这条宪法允许的写法`)
    }
    if (isNum(row.rootHz)) {
      for (const [other, or] of roots) {
        const cents = Math.abs(1200 * Math.log2(row.rootHz / or))
        if (cents < MIN_ROOT_CENTS) err(w, `主音 ${row.rootHz.toFixed(2)}Hz 与 ${other} 的 ${or.toFixed(2)}Hz 只差 ${cents.toFixed(1)} 音分——§1.2「一区一主音」塌了，跨那两区听不出换了地方`)
      }
      roots.set(w, row.rootHz)
    }
  }

  // 与 regions.json 双向对账（两个方向都是 ERROR：少一行 = 那一区永远没有旋律，多一行 = §55 死数据）
  const refBy = new Map()
  for (const rg of (Array.isArray(regions) ? regions : []).filter(isObj)) {
    const e = isObj(rg.music) ? rg.music.explore : undefined
    if (isStr(e)) refBy.set(e, [...(refBy.get(e) ?? []), isStr(rg.id) ? rg.id : '(无 id)'])
  }
  for (const [e, regs] of refBy) {
    if (!ids.has(e)) err(e, `${regs.join(', ')} 指它当探索曲，但表里没有这一行 ⇒ 进那一区永远没有旋律（铃点照响，所以它读起来像"曲子少了一段"而不是"坏了"）`)
    if (regs.length > 1) err('music.explore', `${regs.join(' / ')} 共用同一张探索曲 '${e}'——一区一张是 §1.2 的承诺，共用 = 跨那两区旋律一个字都没换`, 'regions.json')
  }
  for (const id of ids) {
    if (!refBy.has(id)) err(id, '没有任何区域指它 ⇒ §55 死数据：这一行的旋律永远不会被奏出来')
  }
  return out
}
