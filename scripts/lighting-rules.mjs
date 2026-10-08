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
 *
 * **§37 第二腿（三层光）另有一套判据（L1–L5）**，因为那四格的处境与六色正好相反：颜色文档给了
 * （§8 明写 key 色 = SKY 列、point 色 = EMIT 列，读者照念即可），而**强度与方向文档一个数都没给**
 * ——§5.1 只说主方向光"始终指向 BAND-A 脊线法线"，没给角度。所以判据不再对账文档，而是盯住
 * **"每一颗数都必须挂着裁决理由"**（与 §5.9.33③ 的 G1–G4 同一只手）：
 *  L1 声明了 `lights` 的行必须在 `LIGHT_RULINGS` 上写明"这个数凭什么敢写下来"（≥20 字）；
 *  L2 反向：账上那条理由对应的行已经不声明 `lights`（或行没了）⇒ ERROR 假账该销（KI-073 一族）；
 *  L3 强度须落在 `LIGHT_INTENSITY_RANGE` 内；`hemiIntensity`／`pointIntensity` 不许写 0
 *     （整个 `lights` 不写就是 0 ⇒ 写 0 是一格没有后果的读数，§55），
 *     但 `keyIntensity: 0` **合法**——§8 自己开了那道口子（「深窖除外——其唯一光源是矿缝」）；
 *  L4 真表每一行都必须有 `lights`：读者对缺失行的退路是三格强度全 0，那一区会一团黑，
 *     而这种黑没有任何别的东西会响；
 *  L5 `keyDir` 必须是三个有限数且不是零向量——零向量在 three 里等于"没有方向"，
 *     而 `key.position` 就是方向（`DirectionalLight` 的方向 = position − target）。
 * 另有一条不占编号：**省略 `sky` 的行必须写 `note`**——它的 key/hemi 颜色要走 SEC 那条退路，
 * 而"为什么没有天光"必须落在表里，不能只活在读者的注释中。
 */

/** `schema.ts > LightingRow` 的字段（词表对账读的就是这张名单） */
export const LIGHTING_FIELDS = ['id', 'base', 'sec', 'accent', 'emit', 'sky', 'dark', 'grade', 'lights', 'note']

/** `schema.ts > LightingLights` 的四格（§37 第二腿：文档没给数、必须显式裁决的那几格） */
export const LIGHTING_LIGHTS_FIELDS = ['hemiIntensity', 'keyIntensity', 'keyDir', 'pointIntensity']

/**
 * 三层光强度的合法区间。文档一个数都没给，这条界拦的是数量级手误（把 0.7 写成 7、
 * 把 64 写成 6400）：下界 0 是"这一层不亮"，上界取 200——灰盒场地尺度（±40m 的 shadow 视锥）
 * 下再大的强度就只是把整屏推白，那不是"这一区的光"。
 */
export const LIGHT_INTENSITY_RANGE = { min: 0, max: 200 }

/**
 * §37 第二腿的**裁决账本**：预设 id → "这一行 `lights` 的数凭什么敢写下来"（≥20 字）。
 * 与 `weather-rules.mjs > WEATHER_GAMEPLAY_RULINGS` 同族：那张记"天气的玩法乘数今天给了而文档没有"，
 * 这张记"三层光的强度与方向今天给了而文档没有"。判据 L1（有数必须有理由）与 L2（理由对应的行已不声明
 * ⇒ 该销）两面盯着它。
 *
 * 七行今天共用同一条基线文字（`LIGHT_BASELINE_RULING`）：强度与方向**全部沿用灰盒期
 * `PlaceholderArena.ts` 的实机口径**，不是我编的——那一处写死的是 `hemi 0.7` / `key 1.5` /
 * `key.position (12,20,8)`，本批只是把它们从代码搬进表里（搬之前七区里有六区从来看见的不是自己的光）。
 * 逐行复制同一段文字没有意义，所以共用的部分抽成常量；**偏离基线的那一行必须写自己的理由**
 * （今天只有深窖：`keyIntensity: 0`，而那是 §8 自己开的例外）。
 */
const LIGHT_BASELINE_RULING =
  '强度与 key 方向全部沿用灰盒期 PlaceholderArena 的实机口径（hemi 0.7 / key 1.5 / dir (12,20,8)）：' +
  'art-direction §5.1 只说主方向光"始终指向 BAND-A 脊线法线"、§8 只说三层光各是什么，两者都没给角度与亮度；' +
  'point 取 64 是因为 three 的物理衰减 decay=2，64/8² ≈ 1 正好与 key 的 1.5 同量级，且 distance 24 把它圈在原地标周围'

export const LIGHT_RULINGS = {
  lp_resthold: LIGHT_BASELINE_RULING,
  lp_whisperwode: LIGHT_BASELINE_RULING,
  lp_fellcarillon: LIGHT_BASELINE_RULING,
  lp_brokenbar_camp: LIGHT_BASELINE_RULING,
  lp_drowned_choir: LIGHT_BASELINE_RULING,
  lp_unfinished_hall: LIGHT_BASELINE_RULING,
  // §8 自己开的那道口子：「禁止无 key 光的纯自发光场景（深窖除外——其唯一光源是矿缝，属设计例外）」
  lp_earless_deeps:
    LIGHT_BASELINE_RULING +
    '；本行 keyIntensity = 0 正是 §8 那句例外：深窖唯一光源是矿缝，方向光不建也不投影',
}

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
 * @param rulings §37 第二腿的裁决账本（L1/L2 读它）。省略 = 用真账本 `LIGHT_RULINGS`；
 *    测试喂合成行时传自己的小账本，与 `weatherFindings` 的 `rulings?` 同一条理由。
 */
export function lightingFindings(file, rows, referenced, rulings = LIGHT_RULINGS) {
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

    /* ---- §37 第二腿：三层光的强度与方向（判据 L1–L5） ---- */
    if (row.lights !== undefined) {
      if (!isObj(row.lights)) {
        err(`${at}.lights`, 'lights 必须是对象：三层光的强度与方向四格')
      } else {
        for (const k of Object.keys(row.lights)) {
          if (!LIGHTING_LIGHTS_FIELDS.includes(k)) {
            err(`${at}.lights.${k}`, `未知字段 ${k}：这一格就是 schema.ts > LightingLights 那四格，加字段要连消费方一起加（§55）`)
          }
        }
        for (const k of ['hemiIntensity', 'keyIntensity', 'pointIntensity']) {
          const v = row.lights[k]
          if (!isNum(v)) { err(`${at}.lights.${k}`, `${k} 必须是有限数字`); continue }
          if (v === 0 && k !== 'keyIntensity') {
            err(`${at}.lights.${k}`, `${k} = 0：整个 lights 不写就是 0，写出来是一格没有后果的读数（§55）。想让这一层不亮，删掉整个 lights 让读者走"没有裁决过的光不许亮"那条退路`)
          } else if (v < LIGHT_INTENSITY_RANGE.min || v > LIGHT_INTENSITY_RANGE.max) {
            err(`${at}.lights.${k}`, `${k} = ${v} 出界 [${LIGHT_INTENSITY_RANGE.min}, ${LIGHT_INTENSITY_RANGE.max}]：文档没给数，这条界拦的是数量级手误`)
          }
        }
        const d = row.lights.keyDir
        if (!isArr(d) || d.length !== 3 || !d.every(isNum)) {
          err(`${at}.lights.keyDir`, 'keyDir 必须是三个有限数（世界坐标，从被照物指向光源）')
        } else if (d[0] === 0 && d[1] === 0 && d[2] === 0) {
          err(`${at}.lights.keyDir`, 'keyDir 是零向量：DirectionalLight 的方向 = position − target，零向量等于没有方向，那一盏灯照不到任何地方')
        }
      }
    } else {
      err(`${at}.lights`, 'lights 必填：§8 要求每区三层光，而读者对缺失行的退路是三格强度全 0——那一区会一团黑，而这种黑没有任何别的东西会响')
    }

    // 省略 sky 的行必须在 note 里说为什么（文档自己在那三格写了理由，表里也要有）
    if (row.sky === undefined && !isStr(row.note)) {
      err(`${at}.note`, 'sky 省略 ⇒ note 必填：这一区的 key 与 hemi 天色要按 SEC 走（§8 没给这条退路，是实施期裁决），为什么没有天光必须写在表里')
    }
  }

  /* ---- 裁决账本 ⇄ 表：两侧都要交代（L1 / L2） ---- */
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!isObj(row) || !isStr(row.id)) continue
    const has = row.lights !== undefined
    const why = rulings[row.id]
    if (has && !isStr(why)) {
      err(`[${i}]`, `'${row.id}' 声明了 lights 却没有裁决理由：强度与方向文档一个数都没给，没有理由的数就是拿猜测冒充设计（§77）`)
    } else if (has && why.length < 20) {
      err(`[${i}]`, `'${row.id}' 的裁决理由太短（${why.length} 字 < 20）：一句话要说清"这个数凭什么敢写下来"`)
    } else if (!has && isStr(why)) {
      err(`[${i}]`, `'${row.id}' 已经不声明 lights，而 LIGHT_RULINGS 上还挂着理由 ⇒ 假账该销（KI-073 一族）`)
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
