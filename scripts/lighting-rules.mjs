/**
 * scripts/lighting-rules.mjs — `lighting.json`（§37 区域光照预设）的判据本体（KI-094 同族）
 *
 * 与 `weather-rules.mjs` 同一只手、同一个理由：判据留在 `validate-data.mjs` 里就没法在测试里
 * "喂一行非法数据看它拒不拒"（那文件一被 import 就去校验真表并 `process.exit`）。
 *
 * **这张表的判据为什么也全是关系型的**：`lightingPreset` 这个名字在 `regions.json` 里躺了十周，
 * 指着一张不存在的表（KI-094 之前 `world/Lighting.ts` 也标着「未落」）。所以这里量的第一件事
 * 不是"颜色写对没有"，而是**这条链是通的**：
 *  ① 每行的六色必须是合法 hex（`#RGB`／`#RRGGBB`，大小写不敏感——文档那张表本身就混用）；
 *  ② LUT 乘数只能给大于 0 的有限数，且不许写 1（不写就是 1，写出来是一格没有后果的读数，§55）；
 *  ③ 每一行必须被某个区域的 `lightingPreset` 指到（没人指 = 死数据，与 weather 的③同罪）；
 *  ④ 反向：每个被指到的名字必须在表里（拼错一个字母 ⇒ 那一区静默不换雾色，而不会有别的东西响）。
 * 抽取器读不到名册时返回 null ⇒ 报 ERROR 说"这道门在空转"，绝不退成"名单为空所以什么都合法"。
 *
 * **这里不量的**：色板与 art-direction §2 那张表逐字一致——那一半是**文档对账**，
 * 由 `tests/unit/lighting.test.ts` 从文档现推（同一个理由：校验器不该会读 markdown）。
 */

/** `schema.ts > LightingRow` 的字段（词表对账读的就是这张名单） */
export const LIGHTING_FIELDS = ['id', 'base', 'sec', 'accent', 'emit', 'sky', 'dark', 'grade', 'note']

/** §2 那六色的字段名（`sky` 单列：文档在三行里明写"无天光"，它是可省的） */
export const LIGHTING_COLOR_FIELDS = ['base', 'sec', 'accent', 'emit', 'dark']

/** LUT 乘数的合法区间：文档给的两个数是 0.65 与 1.25，放到 0.2–3 拦数量级手误（把 0.65 写成 65） */
export const GRADE_MUL_RANGE = { min: 0.2, max: 3 }

const isArr = (v) => Array.isArray(v)
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const isStr = (v) => typeof v === 'string' && v.length > 0
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)

/** `#RGB` / `#RRGGBB`（大小写不敏感）。判据与 `src/world/Lighting.ts > hexToRgb` 同一个正则 */
const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/**
 * 逐行 + 跨文件判据 → findings（`{ level, file, where, msg }`）。只读不改，也不认识任何文件。
 *
 * @param file 报告用的段名（判据不认识文件，与 `weatherFindings` 同一口径）
 * @param rows `lighting.json` 的读数
 * @param referenced `regions.json > lightingPreset` 的全部读数（去重与否皆可，判据自己去重）
 */
export function lightingFindings(file, rows, referenced) {
  const out = []
  const err = (where, msg) => out.push({ level: 'error', file, where: where || file, msg })

  if (!isArr(rows)) {
    err('', '顶层必须是数组：一张光照预设表 = 七个 `lp_*` 行，没有别的形状')
    return out
  }
  if (!isArr(referenced) || referenced.length === 0) {
    err('', '读不到 regions.json 里被引用的 lightingPreset 名单 ⇒ 这道门在空转（名单读空时"零条 finding"什么都不证明）')
    return out
  }

  const ids = new Set()
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const at = `[${i}]`
    if (!isObj(row)) {
      err(at, '一行必须是对象：一行 = 一个区域光照预设')
      continue
    }
    for (const k of Object.keys(row)) {
      if (LIGHTING_FIELDS.includes(k)) continue
      err(`${at}.${k}`, `未知字段 ${k}：这一行的字段就是 schema.ts > LightingRow 那几格，加字段要连消费方一起加（§55）`)
    }

    if (!isStr(row.id)) err(`${at}.id`, 'id 必须是非空字符串（行键 = regions.json 里写的那个 lp_* 名字）')
    else if (ids.has(row.id)) err(`${at}.id`, `id "${row.id}" 与上一行重复：两行给同一个预设两套取色，读者没有答案`)
    else ids.add(row.id)

    for (const f of LIGHTING_COLOR_FIELDS) {
      if (row[f] === undefined) { err(`${at}.${f}`, `${f} 必填：§2 那张表每一区都有这一格`); continue }
      if (!HEX_RE.test(row[f])) err(`${at}.${f}`, `${f} 必须是合法 hex（#RGB 或 #RRGGBB），实为 ${JSON.stringify(row[f])}`)
    }
    if (row.sky !== undefined && !HEX_RE.test(row.sky)) {
      err(`${at}.sky`, `sky 必须是合法 hex，实为 ${JSON.stringify(row.sky)}。文档在三行里写的是"无天光"——那种行的正确写法是**省略这一格**，不是填一个近似色`)
    }
    if (row.note !== undefined && !isStr(row.note)) err(`${at}.note`, 'note 必须是非空字符串（写"为什么少一格"）')

    if (row.grade !== undefined) {
      if (!isObj(row.grade)) { err(`${at}.grade`, 'grade 必须是对象'); }
      else {
        for (const k of Object.keys(row.grade)) {
          if (k !== 'saturateMul' && k !== 'contrastMul') {
            err(`${at}.grade.${k}`, `未知乘数 ${k}：§8 只给了饱和度与对比两格，冷暖没有数值口径（§55 不许拿猜测冒充裁决）`)
            continue
          }
          const v = row.grade[k]
          if (!isNum(v)) { err(`${at}.grade.${k}`, `${k} 必须是有限数字（CSS 乘子）`); continue }
          if (v === 1) err(`${at}.grade.${k}`, `${k} = 1：不写这一格就是 1，写出来是一格没有后果的读数（§55）`)
          else if (v <= 0) err(`${at}.grade.${k}`, `${k} = ${v}：0 是全灰，负数在 CSS 里会被夹到 0——都不是调色，是坏掉的滤镜`)
          else if (v < GRADE_MUL_RANGE.min || v > GRADE_MUL_RANGE.max) err(`${at}.grade.${k}`, `${k} = ${v} 出界 [${GRADE_MUL_RANGE.min}, ${GRADE_MUL_RANGE.max}]：文档给的乘数落在 0.65–1.25，这条界拦的是数量级手误`)
        }
      }
    }
  }

  // 被指到的名字 ⇄ 表：两侧都要交代（与 weather 判据同一族）
  for (const name of referenced) {
    if (!ids.has(name)) {
      err('', `区域指着 '${name}' 而表里没有这一行：那一区会静默不换雾色与 LUT，而不会有别的东西响。补一行，或者把 regions.json 里那个名字改对`)
    }
  }
  for (const id of ids) {
    if (!referenced.includes(id)) {
      err(`${id}`, `'${id}' 没有任何一区在 lightingPreset 里指它：这一行永远不会被读。要么给一个区域换上它，要么删掉这一行`)
    }
  }

  return out
}
