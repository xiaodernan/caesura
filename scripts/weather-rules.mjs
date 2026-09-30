/**
 * scripts/weather-rules.mjs — `weather.json`（需求 §38 / art-direction §8 的天气档）的判据本体（KI-094）
 *
 * 与 `ducking-rules.mjs` / `burst-rules.mjs` / `explore-rules.mjs` 同一只手、同一个理由：判据留在
 * `validate-data.mjs` 里就没法在测试里"喂一行非法数据看它拒不拒"（那文件一被 import 就去校验真表
 * 并 `process.exit`，而本沙箱连 spawn 子进程都被宿主拒 — KI-075）。
 *
 * **这张表为什么全是关系型判据**：一行天气说了三件互相约束的事——「数据侧那个名字有谁能奏到」
 * （regions.json 的 `weatherPresets`）、「它对应需求 §38 的哪一档」（读数只有从那一档才量得出）、
 * 「这一档今天到底有没有读数」（没有的就欠美术一笔，欠账要挂名字而不是挂注释）。逐字段 min/max
 * 对这三句一句都说不出。所以这里量：
 *  ① `docWeather` 必须落在 `schema.ts > WeatherDocId` 那条联合上（名单从源码现推，不是手抄）；
 *  ② 反向：§38 的每一档都得有行奏它，没人奏的那一档报 **WARN**（那是"需求里还剩一档没做"，不是数据写错）；
 *  ③ 行键必须被 `regions.json > weatherPresets` 里某个名字指到（否则这一行永远不响，§55）；
 *  ④ 反向：被指到的名字要么有行，要么挂在 `PENDING_WEATHER_READINGS` 上写明"为什么还没有读数"；
 *  ⑤ 基线行（`clear`）必须存在且给得出雾密度——没有读数的名字全都按它奏，那条退路不能是空的。
 * 抽取器读不到名单时返回 null ⇒ 报 ERROR 说"这道门在空转"，绝不退成"名单为空所以什么都合法"。
 */

/** `schema.ts > WeatherRow` 的字段（词表对账 `VOCAB_PAIRS` 读的就是这张名单） */
export const WEATHER_FIELDS = ['id', 'docWeather', 'fogDensity', 'brightnessMul', 'contrastMul']

/** 三格读数：一行至少要说出一件可观测的事，否则这一行奏出来和没奏一样 */
export const WEATHER_READING_FIELDS = ['fogDensity', 'brightnessMul', 'contrastMul']

/**
 * 没有读数的天气名走的那一行（今天 = 基线晴空）。它不是一句"默认值"的糖衣：`ColorGrade` 真的按
 * 这一行的雾密度奏，而 pending 名单点着每一个走这条路的名字。主人若被删，判据④会红而不是静默。
 */
export const WEATHER_BASELINE_ID = 'clear'

/**
 * 雾密度的上界。文档最深的一档是 Fog 0.030（art-direction §8），这里放到它的四倍：
 * 再深就不是"这一区起雾了"而是"整屏糊成一堵墙"，那种东西属于关卡几何不属于天气。
 */
export const FOG_DENSITY_MAX = 0.12

/**
 * 明度/对比乘数的合法区间。文档给的读数全落在 0.6–1.15（§2 天气那句），这条界只拦数量级的手误
 * （把 0.6 写成 6、把乘数写成百分比 80）。0 与 1 各有专门的说法，见判据里那两句。
 */
export const GRADE_MUL_RANGE = { min: 0.2, max: 5 }

/**
 * 被 `regions.json` 指着、而 `weather.json` 里**故意还没有行**的那几个天气名（KI-094）。
 *
 * 每一条写的都是"为什么今天给不出读数"，而不是"待办"。理由必须是文档层面的：art-direction §8
 * 那句只按 §38 的 Clear/Rain/Fog/Storm 四档给雾密度，§2 那句只给 Rain 明度与 Fog/Storm 对比，
 * 区域自己的叫法（落烬／沉静／滴答／石风／噤声）挂哪一档是美术裁决，我从文档里读不出来 ——
 * 读不出来还写进表，那一行就是我的编造，而它会伪装成"美术给过的数"（§77 的同一条纪律）。
 *
 * 这份账**能销**（KI-073 那一族）：条目里的名字一旦有了行，判据就报 ERROR 说这条该销；
 * 名字一旦不再被任何一区指到，条目自己也作废。
 */
export const PENDING_WEATHER_READINGS = {
  emberfall: '休垒修钟后的"落烬"。§38 四档说的是可见度与明度，没有"落烬"这一档；它挂 clear 还是 rain 属美术裁决，文档没给，读数就不能由校验器编',
  still: '沉溺合唱与未竟厅的驻留天气"沉静"。它描述的是"没有声音"而不是某种可见度，§38/§8 两句里都没有对应读数 ⇒ 今天按基线奏，欠的是 §37 光照表那条腿',
  drip: '沉溺合唱修钟后的"滴答"。形状上最像 §38 的 Rain（文档给 Rain 雾 0.018、明度 ×0.8），但"drip 就是 Rain"这一句文档没说过，认档之后再入表',
  'stone-wind': '钟坠院修钟后的"石风"。风不在 §38 的四档里，而 §8 的四个雾密度数没有一个按风给过；要先有人决定它改雾还是改明度，才有读数可写',
  hush: '深窖的驻留天气"噤声"。与 still 同族：那一区的压抑来自病白色与光照（§8 区域色板那句），不在天气那一格里，天气表替光照欠着这一笔',
}

/**
 * 「这一区的第二格天气今天由谁的条件来」还没裁的那些区（KI-094② 判据 S1）。
 *
 * 每条写的都是**那一区的变化在数据里长什么形状**，而不是"待办"：切换的判据是"一口修得动的钟立起
 * 一面任务线在等的旗"（`src/world/WeatherSwitch.ts`），下面这四处的事件都不是那个形状——
 * 给它们编一个条件就是拿我的猜测冒充叙事裁决（§77 那条纪律在数据侧的样子）。
 */
export const PENDING_WEATHER_SWITCHES = {
  rg_resthold: '休垒的"落烬"：区内没有 `kind:\'bell\'` 的钟——广场那四件陈设是 `inspect`，按**值域**换组（`state.bells.fourth_dumb` = INTACT/RUNG/MELTED/SEALED，narrative §7 那个抉择）。切换今天只认"被任务线追踪的旗"，要让它认值域得先裁"值域状态算不算天气条件"',
  rg_brokenbar_camp: '营地的"雾"：那一区的世界变化走的是桥放下来／后门开／`flag.brokenbar_resolved` 那类事件（没有钟，也没有修钟这一步），而文档里没有任何一句说营地为什么起雾。那一格是抄雾语林的样子还是另有条件 ⇒ 欠叙事裁决',
  rg_earless_deeps: '深窖从"噤声"到"沉静"：它的事件是五环线索读齐后初句圣所那扇门打开（`ga_deeps_firstphrase_door` 吃四面 `flag.clue_*` 的**合取**），不是修钟。把"线索齐了"当天气条件是另一种判据形状，要接就先裁它属不属于天气那一格',
  rg_unfinished_hall: '未竟厅的"失谐风暴"：那一区的门槛是 `flag.organ_gate_open`（管风琴门），它由关卡推进而不是由某口钟的修复立起；§15.2 里恩希尔战改变的是**音乐与拍**，文档没说过它改天气 ⇒ 谁的条件来这一格欠裁决',
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const isArr = (v) => Array.isArray(v)
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const isNonEmptyStr = (v) => typeof v === 'string' && v.trim().length > 0

/**
 * 「修钟之后这一区的天气换掉」那条切换的判据本体（KI-094②）。它量的是三方之间的关系，而不是一张新表：
 * **任务线追踪的旗标**（`quests.json > steps[].advanceOn.flags`）× **站在谁的地上的钟**
 * （`regions.json > interactables[kind==='bell'].setsFlag`）× **那一区声明了几格天气**（`weatherPresets`）。
 * 读者的算法住在 `src/world/WeatherSwitch.ts`，与这里同一判据、同一份数据 —— 判据与读者各写一份
 * "什么算修好的钟"就是两份账（KI-092 那一族：口径必须有主人）。
 *
 * 五条：
 *  S1 每区都要交代它的切换：`weatherPresets` 只有驻留那一格 ⇒ 没事；有第二格而**没有任何被追踪的钟**
 *     ⇒ 必须挂在 `PENDING_WEATHER_SWITCHES` 上写清"这一格今天由谁的条件来"，否则 ERROR（欠账能挂，
 *     不能不挂）；已经挂了账而条件后来出现 ⇒ ERROR 说该销（KI-073 那一族）。
 *  S2 一面被追踪的旗不许被两区的钟同时立：那"这面旗改谁的天"没有答案 ⇒ ERROR。
 *  S3 钟数与格数不齐（`bells !== presets.length - 1`）⇒ WARN：多出来的钟拨不动新天气，
 *     少掉的那几格永远等不到（今天没有这种区，这条是给以后拦的）。
 *  S4 `kind === 'bell'` 而立了旗、那面旗**不在任务线名册里** ⇒ WARN：这口钟改了世界而不改天气，
 *     要么它本来就不是"修钟"（今天那口倒钟正是敲响而非修复），要么任务线漏了它。
 *  S5 两侧任一名册读空 ⇒ ERROR 说"这道门在空转"，不退成"名单为空所以什么都合法"。
 *
 * @param {string} file 报告用的文件名
 * @param {unknown} regions `regions.json` 的顶层
 * @param {string[] | null} questFlags 任务线用来推进步骤的旗标（由调用方从 `quests.json` 现推）；null/空 ⇒ 门在空转
 * @param {{ [regionId: string]: string } | null} pending 欠条件的区域账本：区 id → 为什么今天给不出条件
 * @returns {{ level: 'error' | 'warn', file: string, where: string, msg: string }[]}
 */
export function weatherSwitchFindings(file, regions, questFlags, pending) {
  const out = []
  const err = (where, msg) => out.push({ level: 'error', file, where: where || file, msg })
  const warn = (where, msg) => out.push({ level: 'warn', file, where: where || file, msg })

  if (!isArr(regions) || regions.length === 0) {
    err('', '读不到 regions.json 的区域名单：这条切换判据在空转')
    return out
  }
  if (!isArr(questFlags) || questFlags.length === 0) {
    err('', '读不到 quests.json 里被任务线追踪的旗标（主人：steps[].advanceOn.flags）：这条切换判据在空转——'
      + '名册读空时每一区都会被判成"没有修钟的条件"，零条 finding 什么都不证明')
    return out
  }
  const tracked = new Set(questFlags)
  const ledger = isObj(pending) ? pending : null

  // S2 先收集：一面旗被哪几区的钟立着
  const flagOwners = new Map()
  for (const rg of regions) {
    if (!isObj(rg) || !isNonEmptyStr(rg.id)) continue
    for (const flag of trackedBellFlags(rg, tracked)) {
      const owners = flagOwners.get(flag) ?? []
      owners.push(rg.id)
      flagOwners.set(flag, owners)
    }
  }
  for (const [flag, owners] of [...flagOwners].sort()) {
    if (owners.length > 1) err(flag, `旗标 '${flag}' 被 ${owners.length} 区的钟同时立着（${owners.join(' / ')}）：一面旗改两区的天气，切换没有答案`)
  }

  for (const rg of regions) {
    if (!isObj(rg) || !isNonEmptyStr(rg.id)) continue
    const presets = isArr(rg.weatherPresets) ? rg.weatherPresets : []
    const bells = [...new Set(trackedBellFlags(rg, tracked))]
    const slots = Math.max(presets.length - 1, 0)

    if (presets.length === 0) {
      err(`${rg.id}.weatherPresets`, '必填且非空：一区至少要说得出它驻留的天气，否则画面那一格对它没有读数')
      continue
    }
    if (slots > 0 && bells.length === 0) {
      const why = ledger && ledger[rg.id]
      if (why) {
        warn(rg.id, `这一区声明了修钟后的天气而今天没有能让它响的条件：${why}`)
      } else {
        err(`${rg.id}.weatherPresets`, `'${rg.id}' 声明了 ${presets.length} 格天气（${presets.join(' → ')}），`
          + '而区内没有任何一口钟立着被任务线追踪的旗 ⇒ 第二格永远不会奏。要么在那一区放一口修得动的钟，'
          + '要么把"这一格今天由谁的条件来"写进 PENDING_WEATHER_SWITCHES')
      }
    }
    if (ledger && ledger[rg.id] && bells.length > 0) {
      err(`PENDING_WEATHER_SWITCHES.${rg.id}`, `这一区已经有 ${bells.length} 口被追踪的钟（${bells.join(' / ')}）作为条件，这条待办该销（留着就是两种交代同时挂）`)
    }
    if (bells.length > 0 && bells.length !== slots) {
      warn(rg.id, `这一区有 ${bells.length} 口被追踪的钟而天气只有 ${slots} 格可换：${bells.length > slots ? '多出来的钟拨不动新天气' : `第 ${bells.length + 1} 格之后的天气永远等不到`}（bell 数与格数要一起改）`)
    }

    // S4：不被追踪的钟——它立了旗而任务线不等那面旗，于是它不改天气
    for (const it of rg.interactables ?? []) {
      if (!isObj(it) || it.kind !== 'bell') continue
      if (isNonEmptyStr(it.setsFlag) && !tracked.has(it.setsFlag)) {
        warn(`${rg.id}.interactables(${it.id})`, `这口钟立的是 '${it.setsFlag}'，而它不在任务线追踪的旗标里 ⇒ 敲响/修好它都不改天气。`
          + '如果它本该改：让某个任务步骤的 advanceOn.flags 等这面旗；如果不该改（比如它只是"敲响"而不是"修复"），这条 WARN 就是它的说明')
      }
      if (!isNonEmptyStr(it.setsFlag)) warn(`${rg.id}.interactables(${it.id})`, '一口不立任何旗的钟：它没有能拨天气的出口（也不改任何世界状态）')
    }
  }

  // 账本自己也要能销：条目指的区没有第二格了 = 条目作废
  if (ledger) {
    for (const [id, why] of Object.entries(ledger)) {
      const rg = regions.find((r) => isObj(r) && r.id === id)
      if (!rg) err(`PENDING_WEATHER_SWITCHES.${id}`, `待办点着一区 '${id}'，而 regions.json 里没有这一区：条目作废`)
      else if (isArr(rg.weatherPresets) && rg.weatherPresets.length <= 1) {
        err(`PENDING_WEATHER_SWITCHES.${id}`, `'${id}' 已经只剩驻留那一格天气：没有要切换的第二格，这条待办该销`)
      }
      if (!isNonEmptyStr(why) || why.trim().length < 20) {
        err(`PENDING_WEATHER_SWITCHES.${id}`, '欠账必须写清楚今天为什么给不出切换条件（≥20 字）：一句"待办"两年后没人能判断它成不成立')
      }
    }
  }
  return out
}

/**
 * 与 `src/world/WeatherSwitch.ts > repairBellFlags` 同一条判据：`kind === 'bell'` 而立着被任务线追踪的旗。
 *
 * 这条判据在两个平面各有一份实现（判据不能 import 玩法层，玩法层不能 import 判据），
 * 所以它**被导出**：`tests/unit/weather-switch.test.ts` 在真实的 `regions.json` + `quests.json` 上
 * 逐区对账两份名单。对不上就是有一份在说谎——这一句话是那条用例的全部内容。
 */
export function trackedBellFlags(region, tracked) {
  const flags = []
  for (const it of region.interactables ?? []) {
    if (!isObj(it) || it.kind !== 'bell' || !isNonEmptyStr(it.setsFlag)) continue
    if (tracked.has(it.setsFlag)) flags.push(it.setsFlag)
  }
  return flags
}

/**
 * 一表天气行 → findings（`{ level, file, where, msg }`）。只读不改。
 *
 * @param {string} file 报告用的文件名（判据不认识文件，与 `duckFindings` 同一口径）
 * @param {unknown} rows `weather.json` 的顶层
 * @param {string[] | null} docIds 需求 §38 那四档：从 `src/data/schema.ts` 的 `WeatherDocId` 联合现推；null = 读不到 ⇒ 门在空转
 * @param {string[] | null} referenced `regions.json > weatherPresets` 里出现过的全部名字（去重）；null 或空 ⇒ 门在空转
 * @param {{ [name: string]: string } | null} pending 待裁决名单：名字 → 理由
 */
export function weatherFindings(file, rows, docIds, referenced, pending) {
  const out = []
  const err = (where, msg) => out.push({ level: 'error', file, where: where || file, msg })
  const warn = (where, msg) => out.push({ level: 'warn', file, where: where || file, msg })

  if (!isArr(rows)) {
    err('', '顶层必须是数组：一张天气表 = 需求 §38 那几档里有读数的部分，没有别的形状')
    return out
  }
  if (!isArr(docIds) || docIds.length === 0) {
    err('', '读不到需求 §38 的天气档名册（主人：src/data/schema.ts 的 WeatherDocId 联合）：这道门在空转')
    return out
  }
  if (!isArr(referenced) || referenced.length === 0) {
    err('', '读不到 regions.json 里被引用的天气名（主人：每区的 weatherPresets）：这道门在空转——两侧都读空时"零条 finding"什么都不证明')
    return out
  }
  const ledger = isObj(pending) ? pending : null

  const ids = new Set()
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const at = `[${i}]`
    if (!isObj(row)) {
      err(at, '一行必须是对象：一行 = 一个数据侧的天气名加它的读数')
      continue
    }
    for (const k of Object.keys(row)) {
      if (WEATHER_FIELDS.includes(k)) continue
      err(`${at}.${k}`, `未知字段 ${k}：这一行的字段就是 schema.ts > WeatherRow 那五格，加字段要连消费方一起加（§55）`)
    }

    if (!isNonEmptyStr(row.id)) err(`${at}.id`, 'id 必须是非空字符串（行键 = regions.json 里写的那个名字）')
    else if (ids.has(row.id)) err(`${at}.id`, `id "${row.id}" 与上一行重复：两行给同一个天气名两套读数，仲裁者没有答案`)
    else ids.add(row.id)

    if (!isNonEmptyStr(row.docWeather)) err(`${at}.docWeather`, 'docWeather 必填：这一行的读数只有从需求 §38 的某一档才量得出')
    else if (!docIds.includes(row.docWeather)) err(`${at}.docWeather`, `'${row.docWeather}' 不是 §38 的那几档（名册：${docIds.join('/')}，主人是 schema.ts > WeatherDocId）`)

    const declared = WEATHER_READING_FIELDS.filter((f) => row[f] !== undefined)
    if (declared.length === 0) {
      err(at, '一行三格读数都没写：这样的天气奏出来与"没有天气"逐像素相同，那它不该进表（§55）')
    }

    if (row.fogDensity !== undefined) {
      if (!isNum(row.fogDensity)) err(`${at}.fogDensity`, 'fogDensity 必须是有限数字（art-direction §8 那一行的指数雾密度）')
      else if (row.fogDensity <= 0) err(`${at}.fogDensity`, `fogDensity = ${row.fogDensity}：0 是"关掉雾"，而这一档的载体是雾不是天气开关；负数会被 THREE 当成 0`)
      else if (row.fogDensity > FOG_DENSITY_MAX) err(`${at}.fogDensity`, `fogDensity = ${row.fogDensity} 越过 ${FOG_DENSITY_MAX}（文档最深一档 Fog 0.030 的四倍）：那已经不是这一区起雾，而是看不见路`)
    }
    for (const f of ['brightnessMul', 'contrastMul']) {
      if (row[f] === undefined) continue
      if (!isNum(row[f])) { err(`${at}.${f}`, `${f} 必须是有限数字（CSS 乘子）`); continue }
      if (row[f] === 1) err(`${at}.${f}`, `${f} = 1：不写这一格就是 1，写出来是一格没有后果的读数（§55）`)
      else if (row[f] <= 0) err(`${at}.${f}`, `${f} = ${row[f]}：0 是全黑/全灰，负数在 CSS 里会被夹到 0——都不是天气，是坏掉的滤镜`)
      else if (row[f] < GRADE_MUL_RANGE.min || row[f] > GRADE_MUL_RANGE.max) err(`${at}.${f}`, `${f} = ${row[f]} 出界 [${GRADE_MUL_RANGE.min}, ${GRADE_MUL_RANGE.max}]：文档给的乘数落在 0.6–1.15，这条界拦的是数量级手误（把 0.6 写成 6，或把乘数写成百分比）`)
    }

    if (!referenced.includes(row.id)) {
      err(`${at}.id`, `'${row.id}' 没有任何一区在 weatherPresets 里指它：这一行永远不会奏。要么给一个区域换上这个天气，要么删掉这一行`)
    }
  }

  // 被指到的名字 ⇄ 表：两侧都要交代。名字没有行 = 拼错或还没接线，两种都必须说出口。
  for (const name of referenced) {
    if (ids.has(name)) continue
    const why = ledger && ledger[name]
    if (why) {
      warn(name, `天气 '${name}' 被 regions.json 指着而表里没有行 ⇒ 它走基线（${WEATHER_BASELINE_ID} 那一行）：${why}`)
      continue
    }
    err('', `天气 '${name}' 被 regions.json 指着而表里没有行，也没挂进 PENDING_WEATHER_READINGS：`
      + `玩家到那一区会静默走基线（${WEATHER_BASELINE_ID}），而没有人知道这一区本来该是什么样。补一行（给得出读数就写读数），或者把"为什么今天给不出"写进待裁决名单`)
  }
  // 待裁决名单自己也要能销（KI-073 那一族：先记账后接线，账必须有到期的一天）
  if (ledger) {
    for (const [name, why] of Object.entries(ledger)) {
      if (ids.has(name)) err(`PENDING_WEATHER_READINGS.${name}`, `天气 '${name}' 已经在 weather.json 里有行了，这条待办该销（留着就是两种交代同时挂）`)
      else if (!referenced.includes(name)) err(`PENDING_WEATHER_READINGS.${name}`, `待办里点着 '${name}' 而没有任何一区指它：它既不奏也不欠，条目作废`)
      if (!isNonEmptyStr(why) || why.trim().length < 20) err(`PENDING_WEATHER_READINGS.${name}`, '欠账必须写清楚为什么今天给不出读数（≥20 字）：一句"待办"两年后没人能判断它成不成立')
    }
  }

  // 反向：§38 那一档今天没人奏 ⇒ 这是"需求还剩一格"，不是数据写错，所以 WARN
  for (const doc of docIds) {
    if (rows.some((r) => isObj(r) && r.docWeather === doc)) continue
    warn(`§38 ${doc}`, `需求 §38 有 '${doc}' 这一档，而表里没有任何一行挂它：那一档的读数今天没有载体（要么给一个区域换上这一档，要么在需求里作废它）`)
  }

  const baseline = rows.find((r) => isObj(r) && r.id === WEATHER_BASELINE_ID)
  if (!isObj(baseline) || !isNum(baseline.fogDensity)) {
    err('', `基线行 '${WEATHER_BASELINE_ID}' 必须存在且给出 fogDensity：没有读数的天气名全部按它奏，那条退路不能是空的`)
  }

  return out
}
