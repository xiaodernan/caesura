/**
 * scripts/battle-rules.mjs — 战斗档表（`battle.json`）的判据本体（KI-080）
 *
 * 与 `explore-rules.mjs` 同一只手、同一个理由：判据留在 `validate-data.mjs` 里就没法在测试里
 * "喂一行非法数据看它拒不拒"（那文件一被 import 就去校验真表并 `process.exit`，而本沙箱连 spawn
 * 子进程都被宿主拒 — KI-075）。搬出来之后校验器只当"把 findings 报成 ERROR/WARN 的那张嘴"，
 * 门禁与 `tests/unit/battle-table.test.ts` 读的是**同一份代码**。
 *
 * 刻意留在校验器的那一半：`bellEveryBars` 的正整数由 `report.num` 全场统一管（缺失 / 非有限数 /
 * 越界那三种说法它一家说了算），搬过来就是第二个主人。
 */

/** `schema.ts > BattleTonal` 的字段。运行时白名单由两支**现拼**（第三份手抄名单 = 第三个主人） */
export const BATTLE_TONAL_FIELDS = ['id', 'pattern', 'bellEveryBars']
/** `schema.ts > BattleSilent` 的字段（§6.3「本 Boss 无配乐」那一格只有这两样） */
export const BATTLE_SILENT_FIELDS = ['id', 'noMusic']
export const BATTLE_FIELDS = [...new Set([...BATTLE_TONAL_FIELDS, ...BATTLE_SILENT_FIELDS])]
/**
 * 低音线一个格子的取值上界。`pattern` 里那**不是半音数也不是 Hz**，而是「动机第几音 × 第几个八度档」
 * 折成一个整数（解码 `deg = e % MOTIF_R1.length`、`oct = floor(e / MOTIF_R1.length)`，见 `music.ts > battleOstinatoHz`）。
 * 上界 = 四音 × 两个八度档 - 1 = **7**。为什么这样折：这张表连一个音名都不写，于是
 * "宪法之外的音"在形状上就写不出来（与 §1.2 那条宪法、KI-079 那支判别联合同一条纪律）。
 * 为什么只有两档：最高那格（7 ⇒ Bb 之上一个八度 = 22 半音 = 246.9Hz）还在 `music.ts > bassLp`
 * 那道 320Hz 低通里；再高一档就是一条"排得出去而听不见"的音，而 §55 不许数据里有没人消费的格。
 * ⚠️ 这个 7 是靠"动机四个音"推出来的，而度数的唯一主人是 `music.ts > MOTIF_R1` —— 所以
 * `tests/unit/battle-table.test.ts` 有一条把 `MAX_PATTERN_CELL + 1 == 动机音数 × 档数` 对账的用例：
 * 动机增减一个音，这一格必须重推（它红，而不是静默换个意思）。
 */
export const PATTERN_OCTAVE_TIERS = 2
export const MAX_PATTERN_CELL = 7

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const isStr = (v) => typeof v === 'string' && v.length > 0

/** 一个 `pattern` 项是不是这一格允许的数（非负整数、且不越过八度档上界） */
export function patternCellOk(n) {
  return Number.isInteger(n) && n >= 0 && n <= MAX_PATTERN_CELL
}

/**
 * 表 + 区域 → 一串 findings（`{ level, file, where, msg }`）。
 * `rows` 是 `battle.json` 的顶层数组，`regions` 是 `regions.json` 的顶层数组；都只读不改。
 */
export function battleFindings(rows, regions) {
  const file = 'battle.json'
  const out = []
  const err = (where, msg, at = file) => out.push({ level: 'error', file: at, where, msg })
  if (!Array.isArray(rows)) { err(file, '顶层必须是数组'); return out }

  const ids = new Set()
  /** 逐格签名 → 第一个写它的那一行：两行逐格相同 = 同一张行抄了两遍 */
  const seen = new Map()
  for (const [i, row] of rows.entries()) {
    if (!isObj(row)) { err(`[${i}]`, '必须是对象'); continue }
    const w = isStr(row.id) ? row.id : `[${i}]`
    if (!isStr(row.id)) err(w, 'id 缺失或非字符串')
    else if (ids.has(row.id)) err(w, `id 重复：${row.id}`)
    else ids.add(row.id)
    for (const k of Object.keys(row)) {
      if (BATTLE_FIELDS.includes(k)) continue
      // §1.1「战斗 = 主音不变」与 KI-066「拍网只有一个主人」在这里兑现成门：主音格与速度格不是"还没加"，是**不许加**
      err(`${w}.${k}`, k === 'rootHz' || k === 'bpm' || k === 'beatsPerBar'
        ? `未知字段 ${k}：这张表里不许出现主音格或速度格——主音的主人住在 \`music.ts > BATTLE_ROOT_HZ\`（§1.1「主音不变」），拍长的主人是 \`RhythmClock\`（KI-066 拆的就是战斗层那份 BPM 副本）`
        : '未知字段：战斗档的字段就是 `schema.ts > BattleTonal`（有配乐）或 `BattleSilent`（§6.3 无配乐）那两支，加字段要连消费方一起加')
    }

    if ('noMusic' in row) {
      if (row.noMusic !== true) err(`${w}.noMusic`, `noMusic=${JSON.stringify(row.noMusic)}：写了这一格就必须是显式的 true（§6.3「本 Boss 无配乐」是一句声明，不是"少写几格"；要配乐请整行按另一支写）`)
      for (const k of ['pattern', 'bellEveryBars']) {
        if (row[k] !== undefined) err(`${w}.${k}`, 'noMusic 为 true（这一档什么都不排）却写了这一格：给一条不存在的声部配参数')
      }
      continue
    }

    if (!Array.isArray(row.pattern) || row.pattern.length === 0) {
      err(`${w}.pattern`, `pattern=${JSON.stringify(row.pattern)}：低音线至少要有一个音；"这一档什么都不排"该写 noMusic: true，而不是留一条空线`)
    } else {
      row.pattern.forEach((n, j) => {
        if (!patternCellOk(n)) err(`${w}.pattern[${j}]`, `格子 ${JSON.stringify(n)} 非法：每一项是「动机第几音 × 第几档八度」折成的整数，只许 0 到 ${MAX_PATTERN_CELL}（= ${PATTERN_OCTAVE_TIERS} 档八度 × 动机音数；越界要么写错了编码，要么把音抬出了 \`bassLp\` 那道 320Hz 低通 = 排得出去而听不见）`)
      })
    }

    const sig = `${JSON.stringify(row.pattern)}|${JSON.stringify(row.bellEveryBars)}`
    const first = seen.get(sig)
    if (first) err(w, `与 '${first}' 逐格相同：同一张行抄了两遍（§55）。要让两个区共用就指同一个 id，而不是再起一个名字`)
    else seen.set(sig, w)
  }

  // 与 regions.json 双向对账。共享在这里**合法**（与 `explore-rules` 那条"共用 = §1.2 的承诺破了"相反）：
  // §1.1 写的就是"战斗遭遇主音不变"，普通遭遇跨区共用一条 ostinato 是设计；所以这里只钉两个方向的存在性。
  const refBy = new Map()
  for (const rg of (Array.isArray(regions) ? regions : []).filter(isObj)) {
    const b = isObj(rg.music) ? rg.music.battle : undefined
    if (isStr(b)) refBy.set(b, [...(refBy.get(b) ?? []), isStr(rg.id) ? rg.id : '(无 id)'])
  }
  for (const [b, regs] of refBy) {
    if (!ids.has(b)) err(b, `${regs.join(', ')} 指它当战斗曲，但表里没有这一行 ⇒ 进那一区开打永远没有战斗音乐（鼓、低音、钟一条都没有，而那读起来像"这一档就是静音"而不是"坏了"）`)
  }
  for (const id of ids) {
    if (!refBy.has(id)) err(id, '没有任何区域指它 ⇒ §55 死数据：这一行永远不会被奏出来')
  }
  return out
}
