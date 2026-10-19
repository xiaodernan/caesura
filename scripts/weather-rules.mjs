/**
 * scripts/weather-rules.mjs — `weather.json`（需求 §38 / art-direction §8 的天气档）的判据本体（KI-094）
 *
 * 与 `ducking-rules.mjs` / `burst-rules.mjs` / `explore-rules.mjs` 同一只手、同一个理由：判据留在
 * `validate-data.mjs` 里就没法在测试里"喂一行非法数据看它拒不拒"（那文件一被 import 就去校验真表
 * 并 `process.exit`）。
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
 *
 * **§5.9.33③ 的玩法三腿另有一套判据（G1–G4）**，因为那三格的处境与上面五条正好相反：读数那边是
 * "文档给了数，对账它抄没抄对"；`gameplay` 这边是**文档一个数都没给**——`art-direction §8` 只给雾密度
 * 四档与三条画面乘数，需求 §38 只剩一句「Storm 期敌人浓度+」。所以判据不再对账文档，而是盯住
 * **"每一颗乘数都必须挂着裁决理由"**：
 *  G1 声明了 `gameplay` 的行必须在 `WEATHER_GAMEPLAY_RULINGS` 上挂着理由（≥20 字）——没有理由的乘数
 *     就是拿猜测冒充设计（§77 那条纪律的同一族）；
 *  G2 反向：账上那条理由对应的行已经不声明 `gameplay`（或行没了）⇒ ERROR 假账该销（KI-073 一族）；
 *  G3 三个乘数须落在 `GAMEPLAY_MUL_RANGE` 内，且不许等于 1（不写就是 1，写出来是没有后果的读数）；
 *  G4 **基线行不许声明 `gameplay`**：没有读数的名字全部按基线奏，基线一非中性，`still`/`hush`/`drip`
 *     /`stone-wind`/`emberfall` 就会静默继承一套谁也没裁决过的玩法乘数。
 */

/** `schema.ts > WeatherRow` 的字段（词表对账 `VOCAB_PAIRS` 读的就是这张名单） */
export const WEATHER_FIELDS = ['id', 'docWeather', 'fogDensity', 'brightnessMul', 'contrastMul', 'gameplay']

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
 * §5.9.33③ 三条玩法腿乘数的合法区间（`WeatherRow.gameplay` 的三格）。
 *
 * 与 `GRADE_MUL_RANGE` 同一条理由，但界更窄也更讲得清：这三个乘数一个动的是**刷怪聚拢**
 * （`concentrationMul` ÷ 组内铺开半径）、一个动的是**失谐累积**（`corruptionMul` × 每击/每秒）、
 * 一个动的是**声景增益**（`ambienceGain` × 每一声的衰减）。下界 0.1 = 稀到只剩一成也还说得通；
 * 上界 4 = 再大就不再是"这一格天气的脾气"，而是把整区节奏交给天气（浓度 4 倍会把组心糊成一团、
 * 增益 4 倍会让贴脸的源越过 1 去削波）。0 与 1 不在这条界里讲——它们各有专门的说法，见判据 G3。
 */
export const GAMEPLAY_MUL_RANGE = { min: 0.1, max: 4 }

/** `schema.ts > WeatherGameplay` 的三格（词表对账 `VOCAB_PAIRS` 读的就是这一张） */
export const WEATHER_GAMEPLAY_FIELDS = ['concentrationMul', 'corruptionMul', 'ambienceGain']

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
}

/**
 * 「这一区的第二格天气今天由谁的条件来」还没裁的那些区（KI-094② 判据 S1）。
 *
 * 每条写的都是**那一区的变化在数据里长什么形状**，而不是"待办"：切换的来源今天有两种——
 * 本区被任务线追踪的钟，与 `regions.json > weatherSwitch` 的显式声明（旗形／值域形）。
 * **两条原始欠账已于 2026-10-08 销掉**（weatherSwitch 落地），名单现在是空的；新条目只许因为
 * "这一区的变化连形状都定不下来"而挂，不许因为懒得写那一行声明而挂。
 */
/**
 * 2026-10-08：两条欠账同批销掉——`weatherSwitch` 落地（art-direction §8.1.2 选 A）之后，这两区
 * 各自的第二格都有了主人，判据 S1 的"该销"分支当场会红，所以条目必须在此删除而不是留着好看：
 * - `rg_resthold` ⇒ 值域形 `{ state: { key: 'state.bells.fourth_dumb', in: [RUNG/MELTED/SEALED] } }`
 *   （广场那四件 inspect 陈设按值域换组；`INTACT` 不算——她还没做决定，不构成换天的理由）；
 * - `rg_brokenbar_camp` ⇒ 旗形 `{ flag: 'flag.brokenbar_resolved' }`（写方是《断弦》步 4 的对话抉择，
 *   不为天气另立新旗）。
 * 现在这份名单是空的：今天每个有第二格的区要么有被追踪的钟，要么有 `weatherSwitch`。**新条目只许
 * 因为"这一区的变化连形状都定不下来"而挂**（例：五环线索合取算不算一个天气条件，哪天要给深窖加
 * 第二格时先裁这个），不许因为"懒得写那一行声明"而挂。
 */
export const PENDING_WEATHER_SWITCHES = {
}

/**
 * §5.9.33③ 的**裁决账本**：天气名 → "这一行 `gameplay` 里的乘数凭什么敢写下来"（≥20 字，判据 G1/G2）。
 *
 * 它与上面两张 `PENDING_*` 不是同一族，名字也因此不跟着叫 pending：那两张记的是"今天还给不出"，
 * 这一张记的是"**今天给了，而文档没有**"。三条玩法腿（敌人浓度／失谐累积速率／声景增益）在需求 §38
 * 与 art-direction §8 里一句数字都没有，所以每一颗乘数都是实施期裁决，理由必须落在纸面上——
 * 否则两年后没人分得清"这是美术给的数"还是"那天下午顺手写的 1.5"。
 *
 * 与 KI-073 那一族一样**能销**：行不再声明 `gameplay`（或行被删）当天，判据 G2 就报"这条该销"。
 */
export const WEATHER_GAMEPLAY_RULINGS = {
  'dissonant-storm': '文档对这三腿一个数都没给（§8 只给雾密度四档与三条画面乘数，§38 只剩一句「Storm 期敌人浓度+」）。实施期裁决：三腿共用同一个风暴强度 1.5——浓度按「组内铺开半径 ÷ 1.5」兑现，因为 slot 条数由 regions.json 的 spawnGroups.count 写死，天气没有"多刷几个"的合法来源；失谐速率乘在 CorruptionMeter.add 上，环境暴露与精英命中两条路共用同一个乘数，于是钟坠院那只悬钟骑士的一击从 +3 变 +4.5（statuses.json corruption.eliteHit 的同档放大）；声景增益乘在 audio.md §4 的 L2/L3 每一声的距离衰减上，锚的是同一条「风/水物理动源」与 §8 Storm 的「+闪雷」。三腿取同一个数，是不为一条风暴编三个数。',
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
 * 六条：
 *  S1 每区都要交代它的切换：`weatherPresets` 只有驻留那一格 ⇒ 没事；有第二格而**没有任何被追踪的钟、也没有 `weatherSwitch`**
 *     ⇒ 必须挂在 `PENDING_WEATHER_SWITCHES` 上写清"这一格今天由谁的条件来"，否则 ERROR（欠账能挂，
 *     不能不挂）；已经挂了账而条件后来出现 ⇒ ERROR 说该销（KI-073 那一族）。
 *     **两种来源不叠加**（`art-direction §8.1.2`）：`weatherSwitch` 与本区被追踪的钟同时在场
 *     ⇒ ERROR——一个第二格只能有一个主人，其中一个会被静默叠掉。
 *  S2 一面被追踪的旗不许被两区的钟同时立：那"这面旗改谁的天"没有答案 ⇒ ERROR。
 *  S3 钟数与格数不齐（`bells !== presets.length - 1`）⇒ WARN：多出来的钟拨不动新天气，
 *     少掉的那几格永远等不到（今天没有这种区，这条是给以后拦的）。
 *  S4 `kind === 'bell'` 而立了旗、那面旗**不在任务线名册里** ⇒ WARN：这口钟改了世界而不改天气，
 *     要么它本来就不是"修钟"（今天那口倒钟正是敲响而非修复），要么任务线漏了它。
 *  S5 两侧任一名册读空 ⇒ ERROR 说"这道门在空转"，不退成"名单为空所以什么都合法"。
 *  S6 `weatherSwitch` 自己的形状（`art-direction §8.1.2` 选 A 落地）：必须正好是一种形——
 *     旗形 `{ flag }` 或值域形 `{ state: { key, in } }`；两种同时写、一个都不写、空白字符串、空的 `in` 都是 ERROR。
 *     值域形的 `key` 必须在 `states.json` 登记表里，`in` 里每个取值必须是那一格的成员
 *     （与 `QuestStep.advanceOn.state` 同一份对账，不为它新立一套语法）。
 *
 * @param {string} file 报告用的文件名
 * @param {unknown} regions `regions.json` 的顶层
 * @param {string[] | null} questFlags 任务线用来推进步骤的旗标（由调用方从 `quests.json` 现推）；null/空 ⇒ 门在空转
 * @param {{ [regionId: string]: string } | null} pending 欠条件的区域账本：区 id → 为什么今天给不出条件
 * @returns {{ level: 'error' | 'warn', file: string, where: string, msg: string }[]}
 */
export function weatherSwitchFindings(file, regions, questFlags, pending, stateDefs = null) {
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
    // S6：`weatherSwitch` 自己的形状——正好一种形，且值域形的 key/in 要能对上 states.json
    let declared = null
    let declaredBad = false
    if (rg.weatherSwitch !== undefined) {
      const ws = rg.weatherSwitch
      const at = `${rg.id}.weatherSwitch`
      if (!isObj(ws)) { err(at, '必须是对象：旗形 { flag } 或值域形 { state: { key, in } }（art-direction §8.1.2 选 A 的确切形状）'); declaredBad = true }
      else if (isNonEmptyStr(ws.flag) && isObj(ws.state)) { err(at, '旗形与值域形同时写了：一个第二格只能有一个主人，判据不知道该认哪一句'); declaredBad = true }
      else if (isNonEmptyStr(ws.flag)) declared = { form: 'flag', flag: ws.flag }
      else if (isObj(ws.state)) {
        const st = ws.state
        const inArr = isArr(st.in) ? st.in : null
        if (!isNonEmptyStr(st.key)) { err(`${at}.state.key`, 'key 必填且非空（值域的 key 只能由 states.json 说了算）'); declaredBad = true }
        else if (!inArr || inArr.length === 0 || !inArr.every(isNonEmptyStr)) { err(`${at}.state.in`, 'in 必填且是非空字符串数组：哪几个值算"这一格成立"是设计读数，写在数据里而不是代码里'); declaredBad = true }
        else if (stateDefs instanceof Map && !stateDefs.has(st.key)) err(`${at}.state.key`, `不在 states.json 登记表里：${st.key}（与 QuestStep.advanceOn.state 同一份对账）`)
        else if (stateDefs instanceof Map) {
          const legal = stateDefs.get(st.key).values ?? []
          const bad = inArr.filter((v) => !legal.includes(v))
          if (bad.length) err(`${at}.state.in`, `取值 ${bad.map((v) => JSON.stringify(v)).join('/')} 不在 ${st.key} 的取值表里（合法：${legal.join('/')}）`)
        }
        if (isNonEmptyStr(st.key) && inArr && inArr.length > 0) declared = { form: 'state', state: st }
      } else { err(at, '既不是旗形 { flag } 也不是值域形 { state: { key, in } }：两种形状之外没有第三种'); declaredBad = true }
    }

    if (slots > 0) {
      // S1：第二格要有且只有一个主人——声明的 weatherSwitch 或本区被追踪的钟，二选一；都没有就挂账
      if (declared && bells.length > 0) {
        err(rg.id, `这一区同时写了 weatherSwitch（${declared.form} 形）又有 ${bells.length} 口被追踪的钟（${bells.join(' / ')}）：`
          + '两种来源不叠加（art-direction §8.1.2）——钟那一条会被静默叠掉，而"谁拨这一格"从此有两个答案')
      } else if (!declared && !declaredBad && bells.length === 0) {
        const why = ledger && ledger[rg.id]
        if (why) {
          warn(rg.id, `这一区声明了修钟后的天气而今天没有能让它响的条件：${why}`)
        } else {
          err(`${rg.id}.weatherPresets`, `'${rg.id}' 声明了 ${presets.length} 格天气（${presets.join(' → ')}），`
            + '而区内没有任何一口钟立着被任务线追踪的旗、也没有 weatherSwitch ⇒ 第二格永远不会奏。'
            + '要么在那一区放一口修得动的钟，要么加一格 weatherSwitch 显式声明"这一格由谁拨"，'
            + '要么把"这一格今天由谁的条件来"写进 PENDING_WEATHER_SWITCHES')
        }
      }
    }
    if (ledger && ledger[rg.id] && (declared || bells.length > 0)) {
      const src = declared ? `weatherSwitch（${declared.form} 形）` : `${bells.length} 口被追踪的钟（${bells.join(' / ')}）`
      err(`PENDING_WEATHER_SWITCHES.${rg.id}`, `这一区已经有 ${src} 作为条件，这条待办该销（留着就是两种交代同时挂）`)
    }
    // S1 的另一半：声明了 weatherSwitch 而只有一格天气 ⇒ 那一格永远不唤醒（与"钟多于格"同形）
    if (declared && slots === 0) {
      err(`${rg.id}.weatherSwitch`, `这一区声明了 weatherSwitch 却只有一格天气（${presets[0]}）：那一格条件成立了也没有第二格可换`)
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
 * @param {{ [name: string]: string } | null} rulings §5.9.33③ 裁决账本：名字 → "乘数凭什么敢写下来"（G1/G2）
 */
export function weatherFindings(file, rows, docIds, referenced, pending, rulings) {
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
  const rulingsLedger = isObj(rulings) ? rulings : null

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
      err(`${at}.${k}`, `未知字段 ${k}：这一行的字段就是 schema.ts > WeatherRow 那六格，加字段要连消费方一起加（§55）`)
    }

    if (!isNonEmptyStr(row.id)) err(`${at}.id`, 'id 必须是非空字符串（行键 = regions.json 里写的那个名字）')
    else if (ids.has(row.id)) err(`${at}.id`, `id "${row.id}" 与上一行重复：两行给同一个天气名两套读数，仲裁者没有答案`)
    else ids.add(row.id)

    if (!isNonEmptyStr(row.docWeather)) err(`${at}.docWeather`, 'docWeather 必填：这一行的读数只有从需求 §38 的某一档才量得出')
    else if (!docIds.includes(row.docWeather)) err(`${at}.docWeather`, `'${row.docWeather}' 不是 §38 的那几档（名册：${docIds.join('/')}，主人是 schema.ts > WeatherDocId）`)

    const declared = WEATHER_READING_FIELDS.filter((f) => row[f] !== undefined)
    if (declared.length === 0 && !isObj(row.gameplay)) {
      err(at, '一行三格读数都没写、也没写 gameplay：这样的天气奏出来与"没有天气"逐像素相同，那它不该进表（§55）')
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

    /* ---- §5.9.33③：gameplay 三腿（G3 形状与界 / G1 裁决账）---- */
    const gp = row.gameplay
    if (gp !== undefined && !isObj(gp)) {
      err(`${at}.gameplay`, 'gameplay 必须是对象：它的三格（concentrationMul/corruptionMul/ambienceGain）各自可选，缺的那格按 1 中性')
    } else if (isObj(gp)) {
      for (const k of Object.keys(gp)) {
        if (WEATHER_GAMEPLAY_FIELDS.includes(k)) continue
        err(`${at}.gameplay.${k}`, `未知字段 ${k}：gameplay 的三格就是 schema.ts > WeatherGameplay 那三格，加腿要连消费方一起加（§55）`)
      }
      for (const f of WEATHER_GAMEPLAY_FIELDS) {
        if (gp[f] === undefined) continue
        const v = gp[f]
        if (!isNum(v)) { err(`${at}.gameplay.${f}`, `${f} 必须是有限数字（乘数：1 = 这一腿不生效）`); continue }
        if (v === 1) err(`${at}.gameplay.${f}`, `${f} = 1：不写这一格就是 1，写出来是一格没有后果的读数（§55）`)
        else if (v <= 0) err(`${at}.gameplay.${f}`, `${f} = ${v}：0 与负数会把这一腿静默关掉，而"这一腿不生效"的正确写法是不写它（缺省即 1）`)
        else if (v < GAMEPLAY_MUL_RANGE.min || v > GAMEPLAY_MUL_RANGE.max) {
          err(`${at}.gameplay.${f}`, `${f} = ${v} 出界 [${GAMEPLAY_MUL_RANGE.min}, ${GAMEPLAY_MUL_RANGE.max}]：文档没给这三腿任何数，这条界拦的是数量级手误（把 1.5 写成 15）`)
        }
      }
      // G1：声明了 gameplay 的行必须挂着裁决理由。没有理由的乘数就是那天下午顺手写的数。
      const why = isNonEmptyStr(row.id) ? rulingsLedger?.[row.id] : undefined
      if (!isNonEmptyStr(why)) {
        err(`${at}.gameplay`, `这一行声明了 gameplay 乘数，却没有在 WEATHER_GAMEPLAY_RULINGS 上挂裁决理由：文档对这三腿一个数都没给，不写理由就等于拿猜测冒充设计`)
      } else if (why.trim().length < 20) {
        err(`WEATHER_GAMEPLAY_RULINGS.${row.id}`, '裁决理由必须写清楚这个数凭什么敢写下来（≥20 字）')
      }
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
  /*
   * G2：裁决账反向能销。挂着账而那一行已经**不再有 gameplay 这一格** ⇒ 这条理由今天在替一行不存在的话说话。
   * 两条归因纪律：①"键在但值不是对象"算**活着**——那一格写坏了由 G3 报形状，这里再报一条"该销"就把
   * 一个病说成两个病（红的话归属就不准了）；②理由长短**只由 G1 管**（那一行真的声明 gameplay 时），
   * 这里重复一遍就会出现同一个理由红两条。
   */
  if (rulingsLedger) {
    for (const name of Object.keys(rulingsLedger)) {
      const live = rows.some((r) => isObj(r) && r.id === name && r.gameplay !== undefined)
      if (!live) {
        err(`WEATHER_GAMEPLAY_RULINGS.${name}`, `天气 '${name}' 在裁决账上挂着理由，而 weather.json 里它已经没有 gameplay 这一格了：这条该销（留着就是两种交代同时挂）`)
      }
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
  // G4：基线非中性 ⇒ 今天五个欠读数的名字会静默继承一套谁也没裁决过的玩法乘数。
  if (isObj(baseline) && isObj(baseline.gameplay)) {
    err(`WeatherRow.${WEATHER_BASELINE_ID}.gameplay`, `基线行 '${WEATHER_BASELINE_ID}' 不许声明 gameplay：没有读数的天气名全部按它奏，基线一非中性，它们就静默继承了一套谁也没裁决过的乘数`)
  }

  return out
}
