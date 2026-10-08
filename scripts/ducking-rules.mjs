/**
 * scripts/ducking-rules.mjs — `ducking.json`（docs/audio.md §8.2 侧链表）的判据本体（KI-092）
 *
 * 与 `burst-rules.mjs` / `battle-rules.mjs` / `explore-rules.mjs` / `ambience-rules.mjs` 同一只手、
 * 同一个理由：判据留在 `validate-data.mjs` 里就没法在测试里"喂一行非法数据看它拒不拒"（那文件一被
 * import 就去校验真表并 `process.exit`，而本沙箱连 spawn 子进程都被宿主拒 — KI-075）。搬出来之后
 * 校验器只当"把 findings 报成 ERROR 的那张嘴"，门禁与 `tests/unit/ducking.test.ts` 读的是同一份代码。
 *
 * 为什么这一张表特别需要"关系"型判据：§8.2 那一行说的是**一个触发口对几条总线的相对压低**。
 * 逐字段 min/max 对它一句都说不出——把 `trigger` 写成一个引擎根本不听的口（数据死在表里、听感上
 * 就是"弹反时音乐没让位"，而门禁全绿）或者把 `targets` 写成一个图上没有的总线，都是纯合法改动。
 * 所以这里判的是三件**跨文件**的事：
 *  ① `trigger` 必须是 `AudioEngine` 真的送进侧链的那几个字面量之一（名单从源码现推，不是手抄）；
 *  ② 反过来，引擎接的每一个侧链口都必须有行用它（白订阅就是"代码里有半张表"）；
 *  ③ `targets` 必须落在 `ducking.ts > DuckBusName` 那条联合上（主人是类型，不是这里的一份名单）。
 * 抽取器读不到名单时返回 null ⇒ 这里报 ERROR，绝不退成"名单为空所以什么都合法"。
 */

/**
 * `schema.ts > DuckRow` 的字段（词表对账 `VOCAB_PAIRS` 读的就是这张名单）
 *
 * KI-092① 加进来的两格是**出入斜率**（到位时长，秒）——它们不是"多写两个好看的数"：
 * `attackSec` 是休止那一行 §8.2 写的 `250ms 入`，`releaseSec` 是 `180ms 出`，
 * 而没有读者时它们就是 §55 名下的死字段（引擎侧那一段见 `AudioEngine > onDuckTrigger/reconcileDucks`）。
 */
export const DUCK_FIELDS = ['id', 'label', 'trigger', 'targets', 'db', 'holdSec', 'attackSec', 'releaseSec']
/** 每行必带的字段（attackSec/releaseSec 只给休止那一行，可缺省走 DUCK_TC_SEC）。单一声明：测试与判据都用它 */
export const DUCK_REQUIRED_FIELDS = ['id', 'label', 'trigger', 'targets', 'db', 'holdSec']

/**
 * −60dB（增益 ≈ 0.001）以下不是"压低"而是静音。静音这件事文档另有说法：§6.3 万籁那一格是
 * `battle.json` 里的 `noMusic: true`（数据说的安静），不是侧链压出来的。这条界的证人是一条
 * `db = -80` 的合成行（见 `tests/unit/ducking.test.ts`），不是猜的数。
 */
export const DUCK_DB_FLOOR = -60

/**
 * 侧链最长的一次：1.5 秒，取自 §8.2 表里最长的那一行（「Boss 大招 telegraph −8dB / 1.5s」）。
 * 界的上理由与上面那条相同：**比它还长就不是"让位"而是"接管"**，那该由数据里的静音格来说。
 */
export const DUCK_HOLD_MAX_SEC = 1.5

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const isArr = (v) => Array.isArray(v)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const isNonEmptyStr = (v) => typeof v === 'string' && v.trim().length > 0

/**
 * 一表侧链行 → findings（`{ level, file, where, msg }`）。只读不改。
 *
 * @param file 报告用的文件名（判据不认识文件，与 `burstFindings` 同一口径）
 * @param rows `ducking.json` 的顶层
 * @param handled **引擎听得懂的侧链触发口**：从 `src/audio/AudioEngine.ts` 的 `onDuckTrigger('…')`
 *                字面量实参现推；null = 抽取器什么都没读回来 ⇒ 门在空转，要说出来
 * @param buses 合法总线名：从 `src/audio/ducking.ts` 的 `DuckBusName` 联合现推，null 同上
 */
export function duckFindings(file, rows, handled, buses) {
  const out = []
  const err = (where, msg) => out.push({ level: 'error', file, where: where || file, msg })

  if (!isArr(rows)) {
    err('', '顶层必须是数组：一张侧链表 = 文档 §8.2 里的那些行，没有别的形状')
    return out
  }
  if (!isArr(handled) || handled.length === 0) {
    err('', '读不到引擎的侧链触发口名单（主人：src/audio/AudioEngine.ts 里的 onDuckTrigger(…) 字面量）：这道门在空转')
    return out
  }
  if (!isArr(buses) || buses.length === 0) {
    err('', '读不到总线名册（主人：src/audio/ducking.ts 的 DuckBusName 联合）：这道门在空转')
    return out
  }

  const seenTriggers = new Set()
  const ids = new Set()
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const at = `[${i}]`
    if (!isObj(row)) {
      err(at, '一行必须是对象：一行 = §8.2 表里的那一行')
      continue
    }
    for (const k of Object.keys(row)) {
      if (DUCK_FIELDS.includes(k)) continue
      err(`${at}.${k}`, `未知字段 ${k}：这一行的字段就是 schema.ts > DuckRow 那几个，加字段要连消费方一起加（§55）`)
    }

    if (!isNonEmptyStr(row.id)) err(`${at}.id`, 'id 必须是非空字符串（行键）')
    else if (ids.has(row.id)) err(`${at}.id`, `id "${row.id}" 与上一行重复：两行压同一次会让"哪一行说了算"没有答案`)
    else ids.add(row.id)

    if (!isNonEmptyStr(row.label)) err(`${at}.label`, 'label 必须非空：它是 §8.2 第一列的原字，对账要靠它认行')

    if (!isNonEmptyStr(row.trigger)) err(`${at}.trigger`, 'trigger 必须是非空字符串（总线事件名）')
    else if (!handled.includes(row.trigger)) {
      err(`${at}.trigger`, `'${row.trigger}' 没有执行口：引擎只会把 ${handled.join('/')} 送进侧链。`
        + '要么在 AudioEngine 里接上这一句（并在 ducking.json 里给出这一行），要么删掉这一行——数据死在表里而没人放它响，§55 就是这么红的')
    } else seenTriggers.add(row.trigger)

    if (!isArr(row.targets) || row.targets.length === 0) err(`${at}.targets`, 'targets 必须是非空数组：压哪几条总线总要写清楚，空数组读起来像"什么都不压"那一行')
    else for (const b of row.targets) {
      if (!buses.includes(b)) err(`${at}.targets`, `'${b}' 不是图上的一条总线（名册：${buses.join('/')}，主人是 ducking.ts > DuckBusName）`)
    }

    if (!isNum(row.db)) err(`${at}.db`, 'db 必须是有限数字（§8.2 那一列的量）')
    else if (row.db >= 0) err(`${at}.db`, `db = ${row.db}：侧链只许往下压。0 是"这一行什么都不做"，正数是推过载——都不是 ducking`)
    else if (row.db <= DUCK_DB_FLOOR) err(`${at}.db`, `db = ${row.db} 越过 ${DUCK_DB_FLOOR}dB：那已经是静音，而"永久静音"这一格的主人是 battle.json 的 noMusic（§6.3），不是侧链`)

    if (!isNum(row.holdSec)) err(`${at}.holdSec`, 'holdSec 必须是有限数字（秒）')
    else if (row.holdSec <= 0) err(`${at}.holdSec`, `holdSec = ${row.holdSec}：压住 0 秒等于这一行没有后果，而"一直压着不弹"不归侧链管`)
    else if (row.holdSec > DUCK_HOLD_MAX_SEC) err(`${at}.holdSec`, `holdSec = ${row.holdSec}s 超过 ${DUCK_HOLD_MAX_SEC}s（§8.2 表里最长那一行的读数）：比它长就不是让位而是接管`)

    /*
     * KI-092①：出入斜率（**到位时长**，秒）。两格都可选：§8.2 只有休止那一行给了斜率
     * （250ms 入 / 180ms 出），其余行只给量与时长 ⇒ 缺省走引擎那个非设计读数 `DUCK_TC_SEC`。
     * 两条判据各自对应一种坏法：0 或负 = 阶跃（真机上是一次咔哒，不是"斜率"）；
     * 比 `holdSec` 还长 = 这段压制**压不到底就弹回去**，表里那个 dB 从此是一句空话。
     */
    for (const k of ['attackSec', 'releaseSec']) {
      if (row[k] === undefined) continue
      if (!isNum(row[k])) err(`${at}.${k}`, `${k} 必须是有限数字（秒，到位时长）`)
      else if (row[k] <= 0) err(`${at}.${k}`, `${k} = ${row[k]}：斜率为 0 或负 = 阶跃，真机上那是一次咔哒`)
      else if (isNum(row.holdSec) && row[k] > row.holdSec) {
        err(`${at}.${k}`, `${k} = ${row[k]}s 比 holdSec = ${row.holdSec}s 还长：压不到底就弹回去，这一行承诺的那个 dB 兑现不了`)
      }
    }
  }

  // 反向：引擎接了的口没有行用它 = 代码里躺着半张表（改动表的人看不见它，改引擎的人以为它有用）
  for (const t of handled) {
    if (!seenTriggers.has(t)) err('', `引擎接了侧链口 '${t}' 而表里没有任何一行用它：要么补一行，要么把那一句订阅删掉`)
  }
  return out
}
