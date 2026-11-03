import {
  BINDABLE_ACTIONS,
  DEFAULT_BINDS,
  GAMEPLAY_EXIT_ACTIONS,
  UI_BINDS,
  UI_EXIT_INTENTS,
  UI_INTENTS,
  type ActionName,
  type Bindings,
  type Binds,
  type UiBinds,
  type UiIntent
} from '@/core/Input'

/**
 * KI-336：键位绑定第一次是**数据**，不是两张常量表。
 *
 * 欠账原文（KI-062 的「仍欠」与 `ui-ux.md` §5.2 末尾同一句）：「`UI_BINDS` 目前是常量表，
 * 接进 settings 时要和 `DEFAULT_BINDS` 一起变成数据」；架构 §2 那张定表也写着「remapping 数据存 settings」。
 * 本批落的是**数据那一半**（形状、信任边界、运行时换表、跟档走、显示读真值）；玩家动手改键的设置页
 * 是下一半，登记在下面「还欠」与本批账本行里。
 *
 * **默认值不从这里抄第二份**：`defaultBindings()` 从 `core/Input.ts` 那两张默认表现推。
 * 于是「改默认键」只有一处可改（§55 的唯一主人），而这条推论有反向臂作证。
 *
 * 为什么这里必须有一整套校验而不是 `{...defaults, ...raw}`：`raw` 来自存档，存档是玩家能用手
 * 改开的文件（`Integrity` 的校验和只防截断，不防恶意）。信任边界的职责是让**任何** blob 都只能
 * 产出「玩得下去」的那一类表：
 *  - 认不出的动作名/意图名 ⇒ 丢（档里凭空造一个 `'fly'` 动作不会变成外挂）；
 *  - 码的**语法**校验 ⇒ `__proto__` / `constructor` / `''` / `'<img>'` 这类格子进不了对象
 *    （语法表里没有下划线也没有尖括号，毒键天然落榜——不需要另外列黑名单，这点在第 4 条腿里量）；
 *  - **不失联**：名册里每个动作/意图（除了被玩家点名「无」的那几格，见下面 KI-342 那一段）最后至少
 *    还有一格键（丢了就回它在默认表上的那一格，被占就落进对方腾出来的那一格——一次交换）。这条是整套
 *    规则里唯一真正保住玩法的那句：一份删光了 `dodge` 的档读进来，闪避仍然在 Ctrl 上，而不是变成
 *    一个没有键的动词。
 *
 * 两条键盘通道各自成表的语义是**整张表**，不是增量——没被任何一格认领的动作走默认，因此
 * 「删掉一格 = 恢复默认」而不是「解绑」。块这一层再分两种：**缺块 ⇒ 整块照默认**（老档与手改档最常
 * 漏的是整块 `padButtons`，把"没写"读成"清空"会让手柄凭空失灵），**写了（哪怕是 `{}`）⇒ 如实整张**。
 * 再往上一层是 `settings.bindings` 整个不存在 ⇒ `restore` 干脆不动运行时，那是 KI-112 的「留空是如实」。
 *
 * KI-342 补的就是那一格「无」：`解绑`（把动作从键盘上摘掉、只留手柄）不是规格里的东西
 * （§6 那行写的是 重映射 / 扳机死区 / 振动 / 长按阈值 / 连打 / 十字键可映射任意动作，没有"清空"），
 * 所以它必须由**玩家明说**才成立——住在 `gameplay.unbound` 那一份名单里，而不是靠删键暗示。
 * 两条语义由此各自有名字，不再共用同一个空缺格：
 *  - 档里没写这个动作 ⇒ 回补那一遍给它找家（= 恢复默认），今天与昨天一样；
 *  - 名单里点了名 ⇒ 两遍都跳过它，**回补不许把一个玩家关掉的动词悄悄塞回键盘**。
 * 「不失联」那条硬规则因此收窄成"**名单外**的每个动作至少还有一格键"——它保的还是原来那件事
 * （一份删光了 `dodge` 的档读进来，闪避仍在 Ctrl 上），只是不再覆盖玩家自己说过"不要"的那几格。
 * 名单与表的一致性只有一个书写者（`clampBindings` 自己），所以「既列在名单里又占着一格键」这种
 * 形状进不了运行时，不管存档怎么写；这条由下面一条腿量，不由这段推理担保。
 */

/**
 * 深拷贝一张表：`get()` 交出去的是副本，外面改不动 store 手里那份（数组那格同样是副本）。
 * **逐格列名**是这张表最脆的一处（KI-364）：加一格而这里没跟上，症状不是崩，而是那一格在
 * `get()`／那三盒磁带／存档里凭空消失——数值格比数组格更隐蔽，因为它漏抄之后仍然「是一张合法的表」。
 * 同一张表在 `Input.setBindings()` 里还被逐格抄第二遍，两处各有各的腿（`bindings-data` 那组第 4 条）。
 */
const clone = (b: Bindings): Bindings => ({
  gameplay: { keyboard: { ...b.gameplay.keyboard }, padButtons: { ...b.gameplay.padButtons }, padAxes: { ...b.gameplay.padAxes }, triggerThreshold: b.gameplay.triggerThreshold, unbound: [...b.gameplay.unbound], padUnbound: [...b.gameplay.padUnbound] },
  ui: { keyboard: { ...b.ui.keyboard }, padButtons: { ...b.ui.padButtons }, stickThreshold: b.ui.stickThreshold, unbound: [...b.ui.unbound], padUnbound: [...b.ui.padUnbound] }
})

/** 默认快照：两张默认表的现推副本，仓库里没有第三份键位表 */
export const defaultBindings = (): Bindings => clone({ gameplay: DEFAULT_BINDS, ui: UI_BINDS })

/**
 * 键盘码的**语法**，不是 `KeyboardEvent.code` 的 260 行全表。
 * 为什么不抄全表：全表是一份会漂的副本，而这里要挡的只有两类东西——手改档里的垃圾（`''`、
 * `'<img>'`、`'__proto__'`：语法里没有下划线、尖括号与空白，天然落榜）与真的物理键。
 * 一个语法合法但不存在的码（`KeyZZ` 之外的 `Key{`？括号落榜）只是**一条永远不会被 DOM 命中的死绑定**，
 * 不危险，所以不值得为它维护第二本名册。`Mouse*` 那三格是 `Input` 自己从 `e.button` 造出来的合成码。
 */
const CODE_RE = /^(?:Key[A-Z]|Digit[0-9]|Numpad[A-Za-z0-9]+|Arrow(?:Up|Down|Left|Right)|F[0-9]{1,2}|Space|Tab|Enter|Escape|Backspace|Delete|Insert|Home|End|PageUp|PageDown|CapsLock|NumLock|ScrollLock|Shift(?:Left|Right)|Control(?:Left|Right)|Alt(?:Left|Right)|Meta(?:Left|Right)|OS(?:Left|Right)|ContextMenu|PrintScreen|Pause|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Intl[A-Za-z0-9]+|Mouse(?:Left|Right|Middle))$/

/**
 * `Mouse*` 那三格是合成码：语法上它们与物理键同一支（`CODE_RE` 里那一格就是为它们开的），
 * 但**谁能读到它们**不一样——只有玩法那张表里的鼠标格有读者（`core/Input.ts` 的 `mousedown`），
 * 菜单那条通道的键名只从 `keydown` 的 `e.code` 里查，那里永远命中不了 `MouseLeft`。
 * KI-360 把鼠标接进捕获之后，面板第一次有可能把这样一格写给菜单那一列，所以这条差别要从
 * "语法"挪到**表**上说话（一个没人读的格子不是偏好，是债：§55）。
 */
const isMouseCode = (code: string): boolean => /^Mouse(?:Left|Right|Middle)$/.test(code)

/** 手柄按钮与轴下标的界（`padButtonMax`：默认表用到 18 ⇒ 上界留一格；轴 0–9 同理） */
export const BIND_BOUNDS = Object.freeze({
  stickThreshold: { min: 0.25, max: 0.9 },
  /**
   * 扳机那条线的界（KI-364）。规格里那句「扳机死区」没给数，所以这一格界是一次**裁决**，两条都有腿：
   * 下限不许是 0——`value >= 0` 对完全没按下的那一把（value 就是 0）也成立，写 0 不是「最灵敏」，
   * 是一把松不开的扳机；上限留一格行程（0.95）而不是 1，因为 `value` 到 1 要按到底，
   * 那一格线等于「必须按死才算」，玩家的手按不出一个可复现的判据。默认 0.5 住在 `DEFAULT_BINDS`。
   */
  triggerThreshold: { min: 0.05, max: 0.95 },
  padButtonMax: 19,
  padAxisMax: 9
})

/**
 * 手柄那一格的**目标拼写**（KI-343）：`Pad<n>`，n 只认规范十进制形且取自
 * `BIND_BOUNDS.padButtonMax` 那同一个界（界住在上面那一格，这里不抄第二份）。
 *
 * 为什么两种拼写收进同一个把手而不是加第二把：面板不该认识"哪张表"（它手里只有函数），
 * 而"这一串说的是键盘格子还是手柄格子"必须由一个主人回答——**语法本身就是路由**。`Pad07` 落榜不是
 * 洁癖：认两种写法等于允许档里出现同一枚键的两个名字，那才是第二个主人。
 *
 * 这一句回答的是**两条通道**（KI-345）：`rebind` 与 `rebindUi` 各自拿到同一个字符串、各自把它落到
 * 自己那张手柄表上（`gameplay.padButtons` / `ui.padButtons`），面板两边都不必解析一次。
 *
 * 路由的谓词是**前缀**而不是整条语法（`isPadClaim`），解析才用语法：`Pad20` 这类"说了要手柄、
 * 但那把不存在"必须落在拒绝那一侧，而不是掉进键盘那一半被 `CODE_RE` 丢掉、再被读成"改成默认"。
 * 两者可分的代价是零灌注——一次没改的动作不该灌动消费者（与 `unbind` 的名册守卫同一条口径）。
 * `CODE_RE` 里没有 `Pad` 开头的家族（`Pause` 差一个字母），所以这个前缀不会被键盘码撞上。
 */
const PAD_TARGET_RE = /^Pad(?:0|[1-9][0-9]?)$/
const isPadClaim = (code: string): boolean => code.startsWith('Pad')
const padTarget = (code: string): number | null => {
  const m = PAD_TARGET_RE.exec(code)
  if (!m) return null
  const i = Number(code.slice(3))
  return i >= 0 && i <= BIND_BOUNDS.padButtonMax ? i : null
}

const asObject = (raw: unknown): Record<string, unknown> =>
  (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>

const isKeyboardCode = (k: string): boolean => CODE_RE.test(k)
const isActionName = (v: unknown): v is ActionName => typeof v === 'string' && (BINDABLE_ACTIONS as readonly string[]).includes(v)
const isIntent = (v: unknown): v is UiIntent => typeof v === 'string' && (UI_INTENTS as readonly string[]).includes(v)
const inBounds = (v: unknown, d: number, b: { min: number; max: number }): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(b.min, Math.min(b.max, v)) : d

/**
 * 键盘那条通道成表。
 *
 * 两遍落格。第一遍**只认 raw 说过的格**（名册序；默认那一格若也在被认领里就留它，少一次没必要的
 * 搬家），第二遍给 raw 没提过的值找窝：先领回自己**全部**还空着的默认格（菜单那条的等价键在这一遍
 * 整体回归，玩法那条只有一格），一格都没剩才去池里找，候选序 = 别人腾出来的默认格 ⇒ 其余默认格 ⇒
 * raw 多出来的格。
 * 为什么 raw 在前：`{KeyQ:'dodge'}` 这份档的意思就是"闪避挪到 Q"，默认在前会让它什么也没改。
 * 为什么腾出来的格子排最前：同一份档让 `lockOn` 没了家（它的默认格正是 Q），而 dodge 留下的 Ctrl
 * 是空的 ⇒ lockOn 落回 Ctrl——**这就是一次交换**；写成"池中最小的空格"会让一整排键集体搬家，
 * 玩家看不懂的键位表就是新债。第一遍不许去池里抓键也是这句的配套：抓了就会替第二遍制造搬家。
 * 名字解释一句"不失联"：默认格 ∪ raw 的格 不比"在默认键盘表上有家的动作"短，而每个空手动作找窝时
 * 池里必有空位 ⇒ 名册里不会有人一行键都没有。KI-342 之后这句话要收窄成"**名单外**的动作"——玩家点名
 * 「无」的那几格本来就该没有键。这条由下面几条腿量出来，不由这段推理担保。
 *
 * `oneCodePerValue`（只给玩法那条）：HUD 的键位列与面板的槽位标签显示的是"一把键"，
 * 一个动作两把键会让 `keyOf` 的"第一条命中"变成第二个主人。菜单那条**不折叠**——
 * `confirm` 在默认表上就是 Enter / 小键盘回车 / 空格 / E 四把（`ui-ux.md` §5.2 那句"键盘不给这两格才是设备间的不一致"），
 * 折叠会把设计好的等价键当成冲突删掉。
 *
 * `off`（KI-342 那一份「无」的名单）：**两遍都跳过点名的值**——第一遍不许替它认领 raw 写的那一格，
 * 第二遍不许替它找家。为什么两处都要挡：只挡回补那一遍，raw 里残留的一格照样能把这个动词请回来，
 * "玩家说不要"就变成一句建议。跳过的代价是它原来占的那格落进池子（默认格在 `rest` 里，位置排在
 * 别人腾出来的那些格子**之后**）——这是刻意的：`released` 那一串给的是"交换"的手感，而解绑没有
 * "另一半"，把玩家刚关掉的格子优先塞给别的动词，等于把「无」读成「挪走」。
 */
function resolveCodeMap<V extends string>(
  entries: ReadonlyArray<readonly [string, V]>,
  defaults: Readonly<Record<string, V>>,
  roster: readonly V[],
  oneCodePerValue: boolean,
  off: ReadonlySet<V>
): Record<string, V> {
  /** 值 → 它在默认表上的**每一把**格（`home` 只记第一把，会漏掉设计好的等价键） */
  const home = new Map<V, string>()
  const nest = new Map<V, string[]>()
  for (const code of Object.keys(defaults).sort()) {
    const v = defaults[code]
    if (!home.has(v)) home.set(v, code)
    const list = nest.get(v)
    if (list) list.push(code); else nest.set(v, [code])
  }
  const claimed = new Map<V, string[]>()
  for (const [code, v] of entries) {
    const list = claimed.get(v)
    if (list) list.push(code); else claimed.set(v, [code])
  }
  /** 池 = 默认表出现过的格 ∪ raw 出现过的格；顺序在下面第二遍里给（腾出来的默认格排最前） */
  const defaultCodes = Object.keys(defaults).sort()
  const rawCodes = [...new Set(entries.map(([c]) => c))].sort()

  const taken = new Set<string>()
  const placed = new Map<V, string[]>()
  const assign = (v: V, c: string): void => {
    const cur = placed.get(v)
    if (cur) cur.push(c); else placed.set(v, [c])
    taken.add(c)
  }
  // 第一遍：**只认 raw 说过的那一格**（默认那一格若在其中就留它——少一次没必要的搬家）。
  // 这一遍不许去池里抓键，抓了就会把"空手动作的默认格"提前占掉，第二遍只能再搬家一次。
  for (const v of roster) {
    if (off.has(v)) continue
    const wants = (claimed.get(v) ?? []).filter((c) => !taken.has(c))
    if (!wants.length) continue
    const h = home.get(v)
    if (oneCodePerValue) assign(v, h !== undefined && wants.includes(h) ? h : wants[0])
    else for (const c of wants) assign(v, c)
  }
  // 第二遍：raw 没提过的值先领回自己**全部**还空着的默认格（折叠那条只会有一格），
  // 一格都没领到才去池里找。候选序 = **被腾出来的默认格** ⇒ 其余默认格 ⇒ raw 里多出来的格。
  // 这一句是给"交换"手感定分的：`{KeyQ:'dodge'}` 把 dodge 搬到 Q，腾出 Ctrl，而丢了 Q 的 lockOn
  // 正该落到 Ctrl 上；池序最小键（Digit1…）会让一整排键集体搬家，玩家看不懂的键位表就是新的债。
  const released = [...new Set(roster.flatMap((v) => {
    const got = placed.get(v)
    return got ? (nest.get(v) ?? []).filter((c) => !got.includes(c)) : []
  }))]
    .filter((c) => !taken.has(c))
    .sort()
  const rest = [...defaultCodes.filter((c) => !released.includes(c)), ...rawCodes.filter((c) => !defaultCodes.includes(c))]
  const free = (from: ReadonlyArray<string>): string | undefined => from.find((c) => !taken.has(c))
  for (const v of roster) {
    if (placed.has(v) || off.has(v)) continue
    const own = (nest.get(v) ?? []).filter((c) => !taken.has(c))
    if (own.length) {
      const h = home.get(v)!
      if (oneCodePerValue) assign(v, own.includes(h) ? h : own[0])
      else for (const c of own) assign(v, c)
      continue
    }
    // 默认表上没家的动作（只在手柄上存在的动词）不去键盘上抢一格：它本来就没有键盘键
    if (!home.has(v)) continue
    const c = free(released) ?? free(rest)
    if (c) assign(v, c)
  }

  // 落表按码序写：`keyOf` 读的是 `Object.keys` 的第一条命中，插入序必须是唯一确定的那个序
  const pairs: Array<[string, V]> = []
  for (const [v, codes] of placed) for (const c of codes) pairs.push([c, v])
  const out: Record<string, V> = {}
  for (const [code, v] of pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) out[code] = v
  return out
}

/**
 * 逐格校验：码语法过关 + 值在名册里才收，其余丢弃（丢弃不等于失败——下一段回补）。
 * `codeOk` 是**这一张表**多问的那一句（KI-360）：语法过关不等于这一列读得到它——鼠标那三格只有
 * 玩法那条有读者，菜单那条的 `codeOk` 就把它们挡掉。默认那个谓词就是纯语法。
 */
function readCodeMap<V>(raw: unknown, isValue: (v: unknown) => v is V, codeOk: (code: string) => boolean = isKeyboardCode): Array<[string, V]> {
  const src = asObject(raw)
  const out: Array<[string, V]> = []
  for (const code of Object.keys(src).sort()) {
    if (!codeOk(code)) continue
    const v = src[code]
    if (isValue(v)) out.push([code, v])
  }
  return out
}

/**
 * 「无」那份名单（KI-342）：只认名册上的动作名，其余丢弃；顺序取动作名册的书写序（档里那串
 * 是谁手写的、有没有重复都不算第二个主人），缺块/非数组 ⇒ 空名单（"没写"= 一个都没关）。
 * 名单里点名的动作在键盘那张表上**不会有格**（上面两遍都跳过它），所以这两半不可能互相矛盾。
 * 名册序、去重、只认名册这三件事是**同一次** `filter` 做到的：拆掉它不是一条腿红，是三处各塌一次
 * （「只认名册」由点名那条、「名册序」由幂等那条、「去重」由重复解绑那条）。
 *
 * KI-389 在这里加了第四件事：**出口那一格永远进不来**（`GAMEPLAY_EXIT_ACTIONS`），与菜单那份
 * （`readUnboundUi`）同一条纪律。为什么必须在边界做而不是只在界面上少画一个按钮：存档是玩家能用手
 * 改开的文件，而"把刹车关掉"读出来的不是一项偏好，是一个手动停不下来的世界。
 * 这一处同时管**两张表**——手柄那份走的也是这个装载者（下面 `padUnbound = readUnbound(g.padUnbound)`），
 * 与 KI-346 那句「一份名册管这条通道的两张表」正好对称。
 */
function readUnbound(raw: unknown): ActionName[] {
  if (!Array.isArray(raw)) return []
  return BINDABLE_ACTIONS.filter((a) => (raw as unknown[]).includes(a) && !GAMEPLAY_EXIT_ACTIONS.includes(a))
}

/**
 * 菜单那条通道的「无」名单（KI-344）：与上面那份同一条纪律（只认名册、名册序、缺块⇒空名单），
 * 多出来的一件事是**出口那一格永远进不来**（`UI_EXIT_INTENTS`）。这件事必须由边界做而不是只在界面上
 * 少画一个按钮：存档是玩家能用手改开的文件，而"把 `back` 关掉"读出来的不是偏好，是一个走不出去的菜单。
 * 名单与表的一致性同样只有一个书写者（`clampBindings` 自己），所以「既在名单里又占着一格键」进不了运行时。
 */
function readUnboundUi(raw: unknown): UiIntent[] {
  if (!Array.isArray(raw)) return []
  return UI_INTENTS.filter((i) => (raw as unknown[]).includes(i) && !UI_EXIT_INTENTS.includes(i))
}

/**
 * 手柄按钮表：逐格校验，**不做回补**（键位失联由键盘那张的回补规则挡在外面，手柄是第二条路）。
 * 缺块与错型 ⇒ 整块照默认；`{}` ⇒ 如实是空表（"这块我写过，就是要它空着"），两者不是一个意思。
 * 不回补还有一个理由：默认表本来就一键多用（0 与 12 都是闪避、9 与 14 都是重击），
 * 按"一个动作一把键"去折叠反而会吃掉这个设计。
 *
 * `off` 是**这一张表**的「无」名单（KI-346）。键盘那张只需要在回补那一遍跳过名单里的值，因为
 * "没人认领"本身就等于"没键"；手柄那张不回补，"没键"与"玩家说不要"在表上是同一个形状，
 * 所以这句话必须由名单**投影**进表里：档里残留的那一格、以及整块没写时兜底进来的默认那几格，
 * 两处都要盖（兜底那一遍不盖，老档里关掉的行会自己长回来）。
 */
function resolvePadMap<V>(raw: unknown, isValue: (v: unknown) => v is V, defaults: Readonly<Record<string, V>>, off: Set<V>): Record<number, V> {
  const out: Record<number, V> = {}
  const fill = (cells: Record<number, V>): void => {
    for (const [k, v] of Object.entries(cells)) if (!off.has(v)) out[Number(k)] = v
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fill({ ...defaults } as unknown as Record<number, V>)
    return out
  }
  const src = raw as Record<string, unknown>
  for (const k of Object.keys(src).sort((a, b) => Number(a) - Number(b))) {
    const i = Number(k)
    if (!Number.isInteger(i) || i < 0 || i > BIND_BOUNDS.padButtonMax) continue
    const v = src[k]
    if (isValue(v) && !off.has(v)) out[i] = v
  }
  return out
}

/**
 * 摇杆轴下标：四格各自校验，再整体查"不许两格共用一根轴"。
 * 共用一根 = 走路与转镜头读同一个传感器（往前推的同时镜头跟着转），不是可以夹取治好的数。
 * 与手柄按钮那张同一条口径：缺块/错型 ⇒ 整块默认。
 */
function clampAxes(raw: unknown): Binds['padAxes'] {
  const d = DEFAULT_BINDS.padAxes
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...d }
  const src = raw as Record<string, unknown>
  const pick = (k: keyof Binds['padAxes']): number => {
    const v = src[k]
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= BIND_BOUNDS.padAxisMax ? v : d[k]
  }
  const axes: Binds['padAxes'] = { moveX: pick('moveX'), moveY: pick('moveY'), camX: pick('camX'), camY: pick('camY') }
  const distinct = new Set([axes.moveX, axes.moveY, axes.camX, axes.camY])
  return distinct.size === 4 ? axes : { ...d }
}

/**
 * 读档路径上唯一被信任的入口（与 `clampGameplaySettings` 同一位子）：
 * 缺块 / 错型 / 越界 / 毒键 / 名册外的动作 ⇒ 一律回默认那一格，返回值一定是能玩的那一类表。
 * 幂等（`clamp(clamp(x))` ＝ `clamp(x)`）是"存档往返不许漂移"的前提，那条腿单独钉。
 */
export function clampBindings(raw: unknown): Bindings {
  const src = asObject(raw)
  const g = asObject(src.gameplay)
  const u = asObject(src.ui)
  const unbound = readUnbound(g.unbound)
  const padUnbound = readUnbound(g.padUnbound)
  const uiUnbound = readUnboundUi(u.unbound)
  const uiPadUnbound = readUnboundUi(u.padUnbound)
  return {
    gameplay: {
      keyboard: resolveCodeMap(readCodeMap(g.keyboard, isActionName), DEFAULT_BINDS.keyboard, BINDABLE_ACTIONS, true, new Set(unbound)),
      padButtons: resolvePadMap(g.padButtons, isActionName, DEFAULT_BINDS.padButtons, new Set(padUnbound)),
      padAxes: clampAxes(g.padAxes),
      // 扳机那条线（KI-364）：与菜单那一格的阈值同一位治数的人（`inBounds`）、同一个默认值的主人
      // （`DEFAULT_BINDS`）；缺格／错型／越界三种写法在这里各自被回答，判据那侧不再兜底一次
      triggerThreshold: inBounds(g.triggerThreshold, DEFAULT_BINDS.triggerThreshold, BIND_BOUNDS.triggerThreshold),
      unbound,
      padUnbound
    },
    ui: {
      // KI-344：键盘那一列的「无」站得住，是因为这条通道有回补那一步可以盖（`resolveCodeMap` 的第二遍
      // 替没人认领的意图整组回归——"玩家说不要"必须显式点名才盖得住它）。
      // KI-360：这一张表的谓词多问一句"这一列读得到它吗"——鼠标那三格在菜单这条通道上没有读者
      // （读它的只有 `keydown` 的 `e.code`），所以手改档里塞进来的 `MouseLeft: 'confirm'` 在这里就掉。
      keyboard: resolveCodeMap(readCodeMap(u.keyboard, isIntent, (c) => isKeyboardCode(c) && !isMouseCode(c)), UI_BINDS.keyboard, UI_INTENTS, false, new Set(uiUnbound)),
      // KI-346：手柄那一列也有关得掉的那一格。它不回补，所以盖它的方式不是"跳过回补"，
      // 而是把名单**投影**进那张表（`resolvePadMap` 的 `off`）。四份名单读的是同一批名册：
      // 「谁不许关」这句话的主人还是只有一个（`UI_EXIT_INTENTS`），多出来的只是第二个读者。
      padButtons: resolvePadMap(u.padButtons, isIntent, UI_BINDS.padButtons, new Set(uiPadUnbound)),
      // 阈值是"过阈值 = 按下"的那条线：下限压过摇杆静止抖动，上限留一格还推得动的余量。
      // 玩家入口在 KI-345 落地（`BindingsStore.setStickThreshold`），界与治依旧只在这里说一次。
      stickThreshold: inBounds(u.stickThreshold, UI_BINDS.stickThreshold, BIND_BOUNDS.stickThreshold),
      unbound: uiUnbound,
      padUnbound: uiPadUnbound
    }
  }
}

/**
 * 配置文件的格数（KI-362）：`ui-ux.md` §5.1／§6 那句「3 套配置文件」里的那个 3。
 * 住在这里而不是抄在界面上：面板手里只有函数，它数不出「有几盒」——那一格由 `profileFlags()` 的长度说，
 * 而长度由下面那一个循环说。同一句「三」出现两处就是两个主人。
 */
export const PROFILE_SLOTS = 3

/**
 * 一盒磁带（KI-362）：要么装着**某一刻那张表的快照**，要么**空的**。
 *
 * 写成 `Bindings | null` 而不是 `Bindings[]` ＋ 一份「哪些格子有东西」的名册，是因为后者会让同一件事
 * 有两个书写者（一格既「不存在」又「存在但是默认」）。空态在这里是**值**，不是缺位——而缺位读成同一个空态。
 */
export type BindingProfile = Bindings | null

/**
 * 那三格的信任边界（与 `clampBindings` 同一位子，读档路径上唯一被信任的入口之一）。
 *
 * 三条裁决，每条都有腿：
 * ① **定长**：`PROFILE_SLOTS` 那一格说几次就是几次。手改档多写的那两格丢掉——不是「尊重玩家的选择」，
 *    是那份选择没有读者（面板画的是名册那三行，档里凭空长出来的盒子谁也看不见，§55）。
 * ② **一格磁带的空态有两种写法，而且是同一个意思**：`null`、缺格、稀疏位、下标越界 ⇒ `null`；
 *    而 `{}` 是另一件事——**写了这一格就是要它**，读成一张完整的默认表（与 `clampBindings` 那条
 *    「缺块 ⇒ 整块默认／写了空块 ⇒ 如实整张」同一条纪律，一格一级）。
 * ③ **列表只认数组**：`{0: …, 1: …}` 那种「按下标写的对象」读成三格皆空，与 KI-336 那条
 *    `unbound: {0:'dodge'}` 同一条口径。存档那一路产不出对象形（`JSON.stringify(数组)` 还是数组），
 *    认它等于给同一份数据第二种拼写。
 * ④ **半张（只写了一条通道）读成「写的那半＋默认那半」**（KI-369 从世界那侧量到，八条腿在
 *    `tests/flow/bindings-remap.test.ts`）：每一格过的仍是同一个 `clampBindings`，而它「缺名补默认」，
 *    所以盒里缺的那一半是**默认**那一张，不是这份档此刻在用的那一张。那不是两条路写岔了：按下「存入」
 *    那一刻玩家两条通道都在手里（② 取此刻那张），而读档那一刻边界只知道这份档写了什么，它没有「此刻」可取。
 *    改不掉的那一格也记在这里：一份 KI-364 之前的老盒（那时还没有 `triggerThreshold`）与一份只写了
 *    键盘那半的盒，缺的是同一种东西——名字。「缺名字就整格作废」那一种闸门会先把老玩家那一盒洗掉，
 *    而那是比补默认更坏的读法（`bindings-data` 的 D2 钉的就是这一句，D1 钉「这一格里没有第二套夹取规则」）。
 *
 * 每一格过的是**同一个** `clampBindings`：于是「一格里的毒键」与「现表里的毒键」不可能有两种治法，
 * 而幂等（`clamp(clamp(x))` ＝ `clamp(x)`）由那位既有主人担保——这条是「往返不漂移」的前提。
 */
export function clampProfiles(raw: unknown): BindingProfile[] {
  const src = Array.isArray(raw) ? raw : []
  const out: BindingProfile[] = []
  for (let i = 0; i < PROFILE_SLOTS; i++) {
    const cell = src[i]
    out.push(cell === undefined || cell === null ? null : clampBindings(cell))
  }
  return out
}

/** 下标是否在那三格里：非整数／负／越界一律「没有那一格」（`data-arg` 是字符串，DOM 那侧谁都能写） */
const profileSlot = (i: number): number | null =>
  Number.isInteger(i) && i >= 0 && i < PROFILE_SLOTS ? i : null

/**
 * 一条通道（KI-367）：`kb` 是键鼠那半，`pad` 是手柄那半。这个名字表是**划分**的唯一书写者——
 * `withChannel` 与本批那十三条腿都读它，谁都不许再抄一份「哪些格算手柄」。（面板与存档今天都不读它：
 * 那一格按下去走的还是**不带通道**那一次，按通道那枚选择在 KI-367 的还欠①。）
 *
 * 三条纪律，各由 `profile-channels` 的腿钉住：
 * ① **穷尽**：两枚并起来正好是上面 `clone` 逐格列名的 6＋5 格（那条名册腿比的是名字，不是形状）。
 *    加一格而这里没跟上，症状不是崩，是那一格在分通道存／取时**两边都不管**——与 `clone` 漏列同一族病。
 * ② **不相交**：交集为空。一格住两枚就意味着「只载入手柄」也动键盘那一张，KI-366 量出来的耦合就此还回去。
 * ③ **两把模拟量的线住 `pad`**：`gameplay.triggerThreshold`（KI-364）与 `ui.stickThreshold`（KI-345）
 *    说的都是设备而不是某一行键位，`core/Input.ts` 那句「它只有一个、不随通道分家」在这里读作
 *    「整格住手柄那半，键盘那半没有它的一份」——分家之后仍然只有一个值、一个主人。
 *
 * 两份「无」名单各归各家（KI-346 的两列在此处第二次派上用场）：`unbound` 是键盘那一份、住 `kb`，
 * `padUnbound` 是手柄那一份、住 `pad`；「解绑键盘这一格」与「解绑手柄这一格」本来就互不打扰。
 */
export type BindChannel = 'kb' | 'pad'
export const BIND_CHANNELS: Record<BindChannel, { gameplay: (keyof Binds)[]; ui: (keyof UiBinds)[] }> = {
  kb: { gameplay: ['keyboard', 'unbound'], ui: ['keyboard', 'unbound'] },
  pad: { gameplay: ['padButtons', 'padAxes', 'triggerThreshold', 'padUnbound'], ui: ['padButtons', 'stickThreshold', 'padUnbound'] }
}

/** 那一枚是不是那两枚之一：`data-arg` 是字符串，DOM 那侧谁都能写 ⇒ 界外通道与界外下标同位（L9 的腿） */
const bindChannel = (ch: unknown): BindChannel | null =>
  ch === 'kb' || ch === 'pad' ? ch : null

/**
 * 逐格整块搬：把 `src` 的 `keys` 那几格原样抄进 `dst`（覆盖，不是合并）。
 * 那两处 `as unknown as` 是本节唯一的转换点：`keyof T` 那种写法在这里会被类型系统判成往 `never` 里写，
 * 而这张表要的正是「按名字搬」——名字由上面那张划分表说，类型只负责搬的时候不偏心某一格。
 */
const moveKeys = <T extends object>(dst: T, src: T, keys: readonly (keyof T)[]): void => {
  const d = dst as unknown as Record<string, unknown>
  const s = src as unknown as Record<string, unknown>
  for (const k of keys) d[String(k)] = s[String(k)]
}

/**
 * 「以 `base` 为底，把 `ch` 那一条通道换成 `from` 的那一半」——分家后存与取共用的那一步。
 *
 * 两个 `clone` 都是必需的：先抄 `base` 是为了交回一张**新**的整张表（不许把 `this.current` 或盒里那张
 * 的引用漏出去，KI-362 那条「快照不是活引用」在分家之后仍然成立），先抄 `from` 是为了搬过来的那几格
 * 也是副本而不是 `from` 的子对象。逐格整块搬（不是逐键合并）由上面那张划分表说：半张表不进运行时。
 */
const withChannel = (base: Bindings, from: Bindings, ch: BindChannel): Bindings => {
  const dst = clone(base)
  const src = clone(from)
  moveKeys(dst.gameplay, src.gameplay, BIND_CHANNELS[ch].gameplay)
  moveKeys(dst.ui, src.ui, BIND_CHANNELS[ch].ui)
  return dst
}

/**
 * 消费者的结构式把手（与 `GameplaySettingsTargets` 同一口径：只声明要做的事，不引入类型依赖）。
 * 本批只有一个消费者——`Input`，两条通道本来就在它手里，分开灌会变成「半张新表」。
 */
export interface BindingsTargets {
  input: { setBindings(b: Bindings): void }
}

/**
 * `set` 能收的形状：**块可缺、块内的张也可缺**。缺的那一张走当前值（`set` 按块浅合并），
 * 写了的那一张是**整张**——所以这里没有"只改一把键"的那种补丁：UI 那一格住在下面的 `rebind()`
 * 与 `unbind()`，它们自己就是"取当前整张、改那一格、再交回来"，界外与失联仍旧全由 `clampBindings` 兜。
 */
export type BindingsPatch = { gameplay?: Partial<Binds>; ui?: Partial<UiBinds> }

/**
 * 改完之后要回报的四件事，**一条通道一份形状、两节共用同一个书写者**（KI-348 起玩法与菜单都交这一份）。
 * `displaced` = 被拿走那一把的原主人（空着就 null）；
 * `moved` = 这一行此刻的格子集合**变没变家**。折叠那一条上这两件事是分开的：原主人往往还握着
 * 别的等价键（`back` 被抢走 `Escape` 之后还有 `Tab` 与 `Backspace`；玩法键盘那张上被抢的一方
 * 会被回补请回它的默认格），那时候说「已交换」就是说谎。
 * 两句话在**两张表**上是同一条裁决（KI-345）：键盘那张以码为键、手柄那张以下是标为键，
 * 而这里要的只是「谁的格子变了」，所以两样都当成「格子 → 行名」来读（键统一成字符串那一步在 `ownersOf` 里）。
 * 行的种类（意图 / 动作）是这一份形状唯一的参数——把同一件事写成两个 `type` 就是让它有两次演化机会，
 * 将来加第五件事要改两处，漏一处就是两节又各说各话。
 *
 * `onto` 是第三件：**这一次到底写进了哪张表**。面板不许按「我等的是哪种传感器」来措辞——
 * 语法才是路由（`isPadClaim`），落到哪张表由这里回答，而说的话必须跟着落点走：
 * 等的是键盘、按下的是一枚手柄键，那句「这把键原本是空着的」就在替手柄那一列说谎。
 * KI-343 立这一句时只有菜单那一半兑现，玩法那半仍按传感器措辞（登记在 KI-345 的「还欠」）；
 * KI-348 起两条通道交同一样东西，面板两节读同一个字段，这条不对称正式收平。
 *
 * 这一份回报**说不出**的第四件事也登记在这里：`moved=false` 只说「它的格子集合只是少了这一把」，
 * 那里面装着两种不同的事——它还握着别的键，或者它在这一列上彻底没了家（键盘那张有回补，后者基本
 * 不发生；**手柄那张不回补**，`movePadRow` 只能把这行腾出的格子分给它，而这行本来可能一格都没占）。
 * 面板因此只能说「少了这一把、没搬去别处」，不能说「它还有其余把手」。要把那一格说出来得再回报一样东西，
 * 而本批不顺手加：没有腿需要那句话，加就是让形状跑到消费方前面（§78 那句「不许为将来的读者先写」）。
 */
export type Swap<V> = { displaced: V | null; moved: boolean; onto: 'keyboard' | 'pad' }

/** 菜单那一行的落点回报（`Swap` 在意图这一种行上的实例） */
export type UiSwap = Swap<UiIntent>
/** 玩法那一行的落点回报（`Swap` 在动作这一种行上的实例） */
export type GameSwap = Swap<ActionName>

/** 某一行的主人此刻占着哪几格：两张表（码 / 下标）在这里读法相同，换算只在这一处 */
const ownersOf = <V>(cells: Record<string, V> | Record<number, V>, owner: V): string[] => {
  const map = cells as Record<string, V>
  return Object.keys(map).filter((c) => map[c] === owner)
}

/** 这一句只回答「谁被换出去、它搬家没有」——落点由调用它的那四处补（`onto` 说的是哪张表被写，不是这一句的事） */
const swapOf = <V>(
  displaced: V | undefined,
  row: V,
  before: Record<string, V> | Record<number, V>,
  after: Record<string, V> | Record<number, V>
): Omit<Swap<V>, 'onto'> => {
  if (displaced === undefined || displaced === row) return { displaced: null, moved: false }
  const was = ownersOf(before, displaced)
  const now = ownersOf(after, displaced)
  // 「只是少了一把」＝ 现在那一串恰好是原来去掉被拿走的那一把；多出一格就是搬了家
  // （键盘那张多一格来自回补，手柄那张多一格来自那一次交换——两种来历在这条腿里同形）
  return { displaced, moved: !(now.length === was.length - 1 && now.every((c) => was.includes(c))) }
}

/**
 * 手柄那张上「把这一行搬到那一把」的算法，**两条通道共用**（玩法与菜单各一张 `Record<number, V>`）。
 * 这张表**不回补**（默认表本来就一键多用：0 与 12 都是闪避），所以搬家规则必须自己守卫，
 * 不能把兜底的指望交给夹取。三件事按顺序发生：① 摘掉这一行此刻占的**所有**格
 * （留一把就是"旧键还能闪避"那种鬼键）；② 目标那一把的原主人拿走 ① 里**升序第一格**腾出的位置——
 * 这就是一次交换，两个方向由同一条规则算出，与键盘那一半同一把手感；③ 目标原本是空的 ⇒ 只搬家不交换，
 * 腾出的格子如实空着。这一段在 KI-343 只服务玩法那条，KI-345 起两条通道共用一份——
 * "同一句裁决不许有两个书写者"在这一格上的形状。
 */
function movePadRow<V>(pad: Record<number, V>, row: V, target: number): Record<number, V> {
  const next: Record<number, V> = { ...pad }
  const freed: number[] = []
  for (const k of Object.keys(next)) { const i = Number(k); if (next[i] === row) { delete next[i]; freed.push(i) } }
  const displaced = next[target]
  delete next[target]
  if (displaced !== undefined && displaced !== row) {
    const cell = freed.sort((a, b) => a - b).shift()
    if (cell !== undefined) next[cell] = displaced
  }
  next[target] = row
  return next
}

/**
 * 同一张表上的「整行回默认」：家由默认表给而不是由玩家给，其余与 `movePadRow` 同一条规则。
 * 落不下的那些原主人按升序领腾出的格子——那一次交换是整体复位的（`dodge` 回 0 与 12，被它换来的
 * `parry` 回 2，逐字回到默认表），不是"只把 dodge 那一格搬回去、留下 parry 挂在 0 号"那种半截复位。
 */
function restorePadRow<V>(pad: Record<number, V>, row: V, homes: readonly number[]): Record<number, V> {
  const next: Record<number, V> = { ...pad }
  const freed: number[] = []
  for (const k of Object.keys(next)) { const i = Number(k); if (next[i] === row) { delete next[i]; freed.push(i) } }
  freed.sort((a, b) => a - b)
  const bumped: V[] = []
  for (const h of homes) {
    const cur = next[h]
    if (cur !== undefined && cur !== row) bumped.push(cur)
    next[h] = row
  }
  for (const v of bumped) {
    const cell = freed.shift()
    if (cell !== undefined) next[cell] = v
  }
  return next
}

/** 默认手柄表上这一行的**所有**家（下标升序）：一张表、两条通道，问法只有这一处 */
const padHomesOf = (defaults: Record<number, unknown>, row: unknown): number[] =>
  Object.keys(defaults).map(Number).filter((i) => defaults[i] === row).sort((a, b) => a - b)

/**
 * 绑定的运行时宿主：`get` 交给存档抄，`set` 走信任边界并立刻灌进 `Input`，`restore` 是读档入口。
 * `restore(undefined)`（老档没这块）⇒ 原地不动，与 KI-112 那句「留空是如实，不是重置成默认」同一条。
 */
export class BindingsStore {
  private current: Bindings
  /** 那三盒磁带（KI-362）：起手全空——「没存过」不是一种默认表，所以这里没有一份兜底的第四张 */
  private profiles: BindingProfile[]

  constructor(
    private readonly targets: BindingsTargets | null,
    initial?: BindingsPatch
  ) {
    const d = defaultBindings()
    this.current = clampBindings({
      gameplay: { ...d.gameplay, ...initial?.gameplay },
      ui: { ...d.ui, ...initial?.ui }
    })
    this.profiles = clampProfiles(undefined)
    this.applyToTargets()
  }

  get(): Bindings { return clone(this.current) }

  set(patch: BindingsPatch): void {
    this.current = clampBindings({
      gameplay: { ...this.current.gameplay, ...patch.gameplay },
      ui: { ...this.current.ui, ...patch.ui }
    })
    this.applyToTargets()
  }

  /**
   * KI-337：UI 的「把这一格改成那把键」就是这一句。面板不动表——它既不认识默认格，也不该认识。
   * 这里交出去的仍然是**当前整张 + 那一格改了**（`set` 的整张语义没被绕过）：
   * 先把这个动作原来占的格子摘掉，再写上新那一格；新格子原本的主人因此变成"没被点名"，
   * 走 `clampBindings` 的回补那一遍——先领自己的默认格，领不到才落进被腾出来的那一格。
   * 于是「一次交换」不是一句口号，而是同一条规则的两个方向（那条腿在 `bindings-data` 里）。
   * 语法不过的码（`e.code` 里有，名册里没有的那些多媒体键）在边界里落榜 ⇒ 这个动作回它的默认格，
   * 不会留下一格谁也按不到的死绑定。
   *
   * 顺手把这个动作从「无」的名单里摘掉是**必需的一半**，不是清理：名单那一遍会跳过它，于是刚绑上的
   * 那一格在下一次整张夹取时被抹掉——"按下改键、屏幕上什么也没变"就是漏掉这一半的形状。
   *
   * KI-343：`code` 是 `Pad<n>` 拼写时走的是**手柄那张**（见上面 `isPadClaim` 的理由），此时名单一个字
   * 都不动——名单说的是"键盘上这一格我不要"，而玩家刚在手柄上给它找了一把，两件事不矛盾（那条腿里
   * `unbind('parry')` 之后 `rebind('parry','Pad7')`，名单仍是 `['parry']`、键盘仍无键、手柄有了键）。
   *
   * **返回值**是 KI-348 起与菜单那一半**同一份形状**（`GameSwap`）：`displaced` 说"被这一格换出去的动作"，
   * `moved` 说"它此刻的格子集合变没变家"，`onto` 说"这一次究竟写进了哪张表"。面板要说的
   * 「这把键原本归谁」读这三样，而不按「我等的是哪种传感器」措辞——尤其不能是「面板解析 `Pad<n>`」，
   * 那会让目标拼写出现第二个读者（语法只有一个主人正是 KI-343 的立足点，落点回报是它的另一半）。
   * 目标那一把本来就属于这个动作自己（把闪避绑回闪避那一把）⇒ `displaced` 是 null：没别人被换出去。
   * 返回 `null` 只有一种来历：说了要手柄但那把不在界内／拼写不过语法（与 `rebindUi` 同一条拒绝——
   * 拒绝了就没有交换，也就没有一句说明可画）。
   */
  rebind(action: ActionName, code: string): GameSwap | null {
    if (isPadClaim(code)) {
      const swap = this.rebindPad(action, padTarget(code))
      return swap === null ? null : { ...swap, onto: 'pad' }
    }
    const before = this.current.gameplay.keyboard
    const keyboard: Record<string, ActionName> = {}
    for (const [c, a] of Object.entries(before)) if (a !== action) keyboard[c] = a
    const pre = before[code]
    keyboard[code] = action
    this.set({ gameplay: { ...this.current.gameplay, keyboard, unbound: this.current.gameplay.unbound.filter((a) => a !== action) } })
    return { ...swapOf(pre, action, before, this.current.gameplay.keyboard), onto: 'keyboard' }
  }

  /**
   * 手柄那张上的「把这一格改成那一把」（KI-343；算法在 `movePadRow`，KI-345 起与菜单那条共用一份）。
   * **返回值**是落点回报去掉 `onto` 的那两半（`onto` 由调用它的那两处各补自己那一张）：面板要说的
   * 「这一把原本归谁」读 `displaced` 与 `moved`，而解析 `Pad<n>` 的那一步不许有第二个读者。
   * 名册外的动作名在这里**必须**先挡（键盘那一半不用挡：那里的失联由回补兜住；这里兜不住——
   * `clampBindings` 会把 `'fly'` 那一格丢掉，而我们已经把原主人摘掉了 ⇒ 白白让一个动作失联）。
   * 腾出的格子不够分（动作原本一格都没占）时原主人在手柄上失联：这是玩家要的那件事本身，
   * 而"这个动词彻底没路"不会发生——键盘那条仍由回补兜着。
   *
   * 名单那一半（KI-346）：按下新的那一把就是"这一行我要"，所以这一行从**手柄那份**名单里退掉
   * （不退就是"按下去改好了、下一次夹取又把它抹了"）；键盘那份名单不是这里的账，一个字不沾。
   */
  private rebindPad(action: ActionName, idx: number | null): Omit<GameSwap, 'onto'> | null {
    if (idx === null || !isActionName(action)) return null
    const before = this.current.gameplay.padButtons
    const pre = before[idx]
    this.set({
      gameplay: {
        ...this.current.gameplay,
        padButtons: movePadRow(before, action, idx),
        padUnbound: this.current.gameplay.padUnbound.filter((a) => a !== action)
      }
    })
    return swapOf(pre, action, before, this.current.gameplay.padButtons)
  }

  /**
   * KI-342 那一格「无」：把动作从**玩法键盘那条通道**上摘掉，并且把它记进名单。
   * 摘格子单做不算解绑——档里没写＝恢复默认，回补那一遍会把这个动词请回来（KI-336 就靠这条把
   * 一份删光了 `dodge` 的档救活），所以"我不要这一格"必须由玩家**明说**，写成两半：
   * 表里没有它 ＋ 名单里有它。两半都在 `set` 那一条整张路径上，界外的值进不来。
   * 手柄那侧一格都不动：「键盘上不要」与「手柄上也不要」是两件事，后者由 `unbindPad` 另外说一次
   * （KI-346：两份名单各管各的那张表，一列上的按钮不许替另一列做主）。
   * 名册外的名字（`data-arg` 是字符串，DOM 那侧谁都能写）⇒ 一格不动、一次不灌，与 `resetKey` 同一条。
   *
   * KI-389 改了两件形状：① 它现在**回答得出拒绝**（返回 boolean），因为屏幕上那一行的把手是按名册
   * 画的，被硬点到时（`run` 那道闸门只挡 `disabled`）面板要答得出"关不掉"，否则那句回执是谎；
   * ② 出口那一格（`GAMEPLAY_EXIT_ACTIONS`）与名册外同名地返回假、一次不灌。下面 `unbindPad` 里那句
   * 「unbind 返回 void 是 KI-342 的形状、被既有那些腿钉住」到这一批作废：现量过全仓，`store.unbind(...)`
   * 的 23 处调用一处也不读返回值，也没有一条腿钉它的 `undefined`。
   */
  unbind(action: ActionName): boolean {
    if (!isActionName(action) || GAMEPLAY_EXIT_ACTIONS.includes(action)) return false
    const keyboard: Record<string, ActionName> = {}
    for (const [c, a] of Object.entries(this.current.gameplay.keyboard)) if (a !== action) keyboard[c] = a
    this.set({ gameplay: { ...this.current.gameplay, keyboard, unbound: [...this.current.gameplay.unbound, action] } })
    return true
  }

  /**
   * 手柄那一行的「无」（KI-346）：两半与 `unbind` 同一条纪律（那一行在**手柄那张**上一格不剩 ＋
   * 名字进 `gameplay.padUnbound`），区别只有两件：
   * ① 摘的是此刻占的全部格子（一键多用是默认表的设计，闪避在 0 与 12 上，留一把就是旧键还能闪避）；
   * ② 它**回答得出拒绝**——名册外的名字返回假、一格不动、一次不灌。（这一段原本还写着「`unbind` 那一格
   * 返回 void 是 KI-342 的形状，被既有那些腿钉住了」——KI-389 起那句作废：`unbind` 也回答得出拒绝，
   * 现量 23 处调用无一处读返回值。面板因此仍不必自己猜「这个 `data-arg` 是不是名册上的动作」，
   * 那是第二份名册。）
   *
   * 这一行在手柄上本来就没有家（走路四格住摇杆轴、`throwCrystal` 与 `ability1..3` 没手柄默认键）
   * 也算关得掉：格子集合不变、名单里有它，说的是"以后也不许在这一列上给它键"。屏幕那一列因此画
   * 「无」而不是「—」——那两个写法今天第一次不混（「—」＝没人认领，「无」＝玩家说过不要）。
   */
  unbindPad(action: ActionName): boolean {
    if (!isActionName(action) || GAMEPLAY_EXIT_ACTIONS.includes(action)) return false
    const padButtons: Record<number, ActionName> = {}
    for (const [i, a] of Object.entries(this.current.gameplay.padButtons)) if (a !== action) padButtons[Number(i)] = a
    this.set({ gameplay: { ...this.current.gameplay, padButtons, padUnbound: [...this.current.gameplay.padUnbound, action] } })
    return true
  }

  /**
   * 「恢复默认」= 把这个动作绑回它在**默认表**上的那一格。默认格由表的主人自己算
   * （`defaultBindings()` 现推），面板抄不到第二份。
   * 找不到家的那一种只可能是**名册外的名字**（`data-arg` 是字符串，DOM 那侧谁都能写）：
   * 名册上的 22 个动作各有且仅有一把默认键，这条不变量由 `bindings-data` 那条双射腿量着，
   * 所以这里不是"手柄动词没有键盘家"，而是"不是动作的名字不配搬家"。
   * 这一句同时是「无」那一格的**出口**：走的是 `rebind`，因此它顺带把名字从名单里摘掉
   * （界面上那一格「回默认」按下去，被关掉的动词就回来了——不需要第四把把手）。
   *
   * `via`（KI-343）默认 `'key'`：既有那一行的形状不因新参数而变（不写第二个参数就还是键盘那条）。
   * `'pad'` 走下面那条独立的路，**不借道 `rebind`**：`rebind` 会销名单，而"手柄上回默认"与
   * "我在键盘上说过不要"是两件事，借道就等于替玩家反悔。
   *
   * **返回值**说"这一行在那条通道上有没有家"（false ⇒ 一格都没动）。这个信息必须由边界这一侧给：
   * 面板不许去读默认表（那正是"默认值只有一个主人"要抓的形状），而它又不能说谎——名册 22 个动作里
   * 只有 14 个有手柄默认键，剩下那 8 格（走路四格在摇杆轴上、`throwCrystal` 与 `ability1..3` 压根没有
   * 手柄默认键）按下「手柄回默认」本来就该得到一句"这一行在手柄上没有默认键"，而不是一个没反应的按钮。
   */
  resetKey(action: ActionName, via: 'key' | 'pad' = 'key'): boolean {
    if (via === 'pad') return this.resetPadHome(action)
    const d = defaultBindings()
    const home = Object.keys(d.gameplay.keyboard).find((c) => d.gameplay.keyboard[c] === action)
    if (home === undefined) return false
    this.rebind(action, home)
    return true
  }

  /**
   * 手柄那一行的「回默认」（KI-343；算法在 `restorePadRow`）。
   * 这个动作在默认手柄表上一格都没有 ⇒ 这一行在手柄上没有家 ⇒ 一格都不动、一次都不灌
   * （名册 22 个动作里只有 14 个有手柄默认键：走路那四格住摇杆轴上，`throwCrystal` 与 `ability1..3`
   * 今天压根没有手柄默认键。面板上那一格对它们是空的，按下"回默认"不该从别人手里抢一把过来）。
   */
  private resetPadHome(action: ActionName): boolean {
    if (!isActionName(action)) return false
    const homes = padHomesOf(defaultBindings().gameplay.padButtons, action)
    if (!homes.length) return false
    this.set({
      gameplay: {
        ...this.current.gameplay,
        padButtons: restorePadRow(this.current.gameplay.padButtons, action, homes),
        // KI-346：这一把把手就是那一格「无」的出口——不一起退掉名单，刚补上的那几把会被下一次夹取抹掉
        padUnbound: this.current.gameplay.padUnbound.filter((a) => a !== action)
      }
    })
    return true
  }

  /**
   * 菜单那一行的「把这一行改成那一把」（KI-344）。与玩法那两条只区别一件事：**单元是整组**。
   * `confirm` 在默认表上是四把等价键（§5.2 那句"键盘不给空格/E 才是设备间的不一致"），所以改这一行
   * = 摘掉它此刻占的**所有**格、只留下玩家给的那一把；而"没被点名的意图整组回归"不是这里新立的规矩，
   * 是 `resolveCodeMap` 回补那一遍已有的折叠语义——这一批只是把它交到玩家手里。
   *
   * `Pad<n>` 在这一格**是路由**（KI-345，KI-344 那一批写的"拒绝"到这里兑现）：菜单那一节有了手柄那一列，
   * 玩家按下的那一枚就该落在 `ui.padButtons` 上。路由的仍是**前缀谓词**而不是面板——面板手里只有
   * 一个字符串，而"这一串说的是哪张表"必须由边界回答（KI-343 立的口径，两条通道共用一把尺）。
   * 说了要手柄、但那把不存在（`Pad20`／`Pad07`）仍然是**拒绝**：掉进键盘那一半会被 `CODE_RE` 丢掉、
   * 再被回补读成"整组回归"，那就是"按下改键、屏幕上自己动了一格"。
   * 名册外的意图名同样先挡（`data-arg` 是字符串，DOM 那侧谁都能写），两张表都挡在同一个位子。
   *
   * KI-360 多出来的是一道**传感器**的拒绝：鼠标那三格在这一列收不下。理由不在语法（`CODE_RE` 收它们），
   * 而在读者——这一张表只被 `keydown` 的 `e.code` 查，`MouseLeft` 写进来就是一格永远无人读的键。
   * 玩法那一列同一名义上是反过来的：那三格有读者（`Input` 的 `mousedown` 从 `e.button` 造出同一个名字），
   * 所以 `rebind` 对它们照收。捕获那一路现在两种传感器都会送到这一格来，拒绝必须由边界做，
   * 面板不认传感器名字（它手里只有一个字符串，这是 KI-343 立的口径）。
   */
  rebindUi(intent: UiIntent, code: string): UiSwap | null {
    if (!isIntent(intent) || isMouseCode(code)) return null
    if (isPadClaim(code)) {
      const swap = this.rebindUiPad(intent, padTarget(code))
      return swap === null ? null : { ...swap, onto: 'pad' }
    }
    const before = this.current.ui.keyboard
    const displaced = before[code]
    this.writeUiGroup(intent, [code])
    return { ...swapOf(displaced, intent, before, this.current.ui.keyboard), onto: 'keyboard' }
  }

  /**
   * 菜单那一行的手柄那一把（KI-345）。与玩法那条同一份算法（`movePadRow`），回报也是同一份
   * （`swapOf` 读两张表读法一致）；KI-346 起它同样要退掉**手柄那份**名单——按下新的那一把就是
   * "这一行在这一列上我要"，而键盘那份名单仍是一个字不沾（「无」说的是每一张表，不是每一条通道）。
   * 返回 `null` 只有一种来历：说了要手柄但那把不在界内／拼写不过语法（拒绝 ⇒ 面板一句说明都不许编）。
   */
  private rebindUiPad(intent: UiIntent, idx: number | null): Omit<UiSwap, 'onto'> | null {
    if (idx === null) return null
    const before = this.current.ui.padButtons
    const displaced = before[idx]
    this.set({
      ui: {
        ...this.current.ui,
        padButtons: movePadRow(before, intent, idx),
        padUnbound: this.current.ui.padUnbound.filter((i) => i !== intent)
      }
    })
    return swapOf(displaced, intent, before, this.current.ui.padButtons)
  }

  /**
   * 菜单那一行的「无」：两半与 `unbind` 同一条纪律（表里没它 ＋ 名单里有它），多出来的是一道**拒绝**——
   * `UI_EXIT_INTENTS` 那一格不许关。一句话的理由是「菜单必须走得出去」：关掉 `confirm` 只是少一种能力，
   * 关掉 `back` 是把这一屏变成陷阱。返回值说"这一行关不关得掉"，面板拿它说话，
   * 于是那一格既不消失、也不变成一个没反应的按钮。
   * 这一句**只管键盘那一列**（KI-346 起手柄那一列另有 `unbindUiPad`）：一行的两个家各有各的名单。
   */
  unbindUi(intent: UiIntent): boolean {
    if (!isIntent(intent) || UI_EXIT_INTENTS.includes(intent)) return false
    const keyboard: Record<string, UiIntent> = {}
    for (const [c, i] of Object.entries(this.current.ui.keyboard)) if (i !== intent) keyboard[c] = i
    this.set({ ui: { ...this.current.ui, keyboard, unbound: [...this.current.ui.unbound, intent] } })
    return true
  }

  /**
   * 菜单那一行的手柄那一格「无」（KI-346）：与玩法那条 `unbindPad` 同一份两半（那一列一格不剩 ＋
   * 名字进 `ui.padUnbound`），也多同一道拒绝——**「菜单必须走得出去」管的是这条通道的两张表，
   * 不是其中一列**：`back` 在键盘上有三把、在手柄上有一把（1 号键），只挡住一列等于没挡。
   * 所以那份名册今天多了一个读者，而它的主人还是一个（`readUnboundUi` 同时是读档那侧的读者，
   * 于是"界面不画那一格／写的那侧拒绝／读的那侧丢掉"三处讲的是同一句话）。
   */
  unbindUiPad(intent: UiIntent): boolean {
    if (!isIntent(intent) || UI_EXIT_INTENTS.includes(intent)) return false
    const padButtons: Record<number, UiIntent> = {}
    for (const [i, v] of Object.entries(this.current.ui.padButtons)) if (v !== intent) padButtons[Number(i)] = v
    this.set({ ui: { ...this.current.ui, padButtons, padUnbound: [...this.current.ui.padUnbound, intent] } })
    return true
  }

  /**
   * 菜单那一行的「回默认」＝**整组**回来（`confirm` 是四把一起，不是只回第一把），走的是与 `rebindUi`
   * 同一次写，所以它同样顺手把名字从名单里退掉——不退的那一格是"点了回默认、屏幕上的「无」还挂着"。
   * 名册外的名字与"默认表上这一行没有家"在这一格同形：都返回假、一格都不动（面板把这句话画出来）。
   *
   * `via`（KI-345）默认 `'key'`：既有那一行的形状不因新参数而变。`'pad'` 走下面那条独立的路，
   * **不借道改键**：改键那一遍会销**键盘**那份名单，而"手柄上回默认"与"我在键盘上说过不要"是两件事，
   * 借道就等于替玩家反悔（与玩法那条 KI-343 同一条口径，两行文案也各自有证人）。
   * KI-346 之后手柄那一列有了自己的名单，`resetUiPadHome` 退的是**那一份**——两列各有各的出口。
   */
  resetUi(intent: UiIntent, via: 'key' | 'pad' = 'key'): boolean {
    if (via === 'pad') return this.resetUiPadHome(intent)
    const d = defaultBindings().ui.keyboard
    const homes = isIntent(intent) ? Object.keys(d).filter((c) => d[c] === intent) : []
    if (!homes.length) return false
    this.writeUiGroup(intent, homes)
    return true
  }

  /**
   * 菜单那一行的「手柄回默认」（KI-345）。17 格里有家的只有那八格导航/确认键
   * （`pick1..9` 在默认手柄表上一格都没有——直选是键盘与数字键的语义），没家的那九格
   * 返回假、一格不动：面板要说「这一行在手柄上没有默认键」，而不是画一个按了没反应的按钮。
   * KI-346：它同时是那一格「无」的**第一个**出口（整组回来 ＋ 从手柄名单里退掉；那九格没家的
   * 行另有第二个出口——手柄改键，与键盘那条同一条纪律）。
   */
  private resetUiPadHome(intent: UiIntent): boolean {
    if (!isIntent(intent)) return false
    const homes = padHomesOf(defaultBindings().ui.padButtons, intent)
    if (!homes.length) return false
    this.set({
      ui: {
        ...this.current.ui,
        padButtons: restorePadRow(this.current.ui.padButtons, intent, homes),
        padUnbound: this.current.ui.padUnbound.filter((i) => i !== intent)
      }
    })
    return true
  }

  /**
   * 摇杆阈值的玩家入口（KI-345：机制与存档里早就有它，界面里没有）。
   * **返回值是"生效那一个数"**而不是写进去的那一个：界在哪由 `BIND_BOUNDS` 说、越界怎么治由
   * `clampBindings` 说，面板读回来的必须是夹过的那一个——否则屏幕上写 0.9 而实际按 0.25 生效，
   * 那就是 ui-ux §8 反对的假读数。一次写一次灌（与 `rebind` 同一把尺，多灌一次就是消费者看见半张表）。
   */
  setStickThreshold(v: number): number {
    this.set({ ui: { ...this.current.ui, stickThreshold: v } })
    return this.current.ui.stickThreshold
  }

  /**
   * 扳机那条线的玩家入口（KI-364，§6 那一格在规格里挂了很久、机制里第一次有落点）。
   * 形状与上面那一把**同一把尺**：交回的是"生效那一个数"而不是写进去的那一个（界由 `BIND_BOUNDS` 说、
   * 越界怎么治由 `clampBindings` 说），一次写一次灌。两条阈值各归各的通道，但**都不是面板在夹数**——
   * 面板手里只有一个步进量。
   */
  setTriggerThreshold(v: number): number {
    this.set({ gameplay: { ...this.current.gameplay, triggerThreshold: v } })
    return this.current.gameplay.triggerThreshold
  }

  /** 键盘那张上摘掉这一行此刻占的所有格，再按给定的格子写回（`rebindUi` 与 `resetUi` 共用的一条出口） */
  private writeUiGroup(intent: UiIntent, codes: string[]): void {
    const keyboard: Record<string, UiIntent> = {}
    for (const [c, i] of Object.entries(this.current.ui.keyboard)) if (i !== intent) keyboard[c] = i
    for (const c of codes) keyboard[c] = intent
    this.set({ ui: { ...this.current.ui, keyboard, unbound: this.current.ui.unbound.filter((i) => i !== intent) } })
  }

  /**
   * 整张回到默认（「操作」页那一格「全部回默认」）。写在这里而不是让面板去拼默认表：
   * 默认值的主人只有一个，面板手里只有函数。
   * **四份**「无」名单（玩法 × 键盘／手柄 ＋ 菜单 × 键盘／手柄）一起清空——那一格说的是"整张回默认"，
   * 不是"某一条通道、某一列回默认"（KI-346 起名单有两列，这一格的话要说全）。
   */
  restoreDefaults(): void {
    this.current = clampBindings(defaultBindings())
    this.applyToTargets()
  }

  /**
   * 那三盒磁带（KI-362）：**运行时那张表仍然只有一个主人**（`this.current`），磁带格装的是
   * 「某一刻它的快照」。这一点是本批全部理由所在——把「三套配置」写成第四张会被 `Input` 读到的表，
   * 就等于让"玩家此刻用的键"有两个答案；写成快照＋一次显式的 `loadProfile`，才既有多套又不多加主人。
   *
   * 三条口径，各由 `bindings-data` 那组腿量出来：
   * ① **存入不换键**：`storeProfile` 与 `applyProfiles` 都不灌消费者——没换玩家在用的那张表，
   *    就不许让 `Input` 看见一次新的（KI-345 立的「一次动作一次灌注」里那个「动作」，说的就是换表）。
   * ② **载入才换键**：`loadProfile` 是唯一一次灌注，而且恰好一次。
   * ③ **快照不是活引用**：两个方向都 `clone()`——存进去抄一份、交出去再抄一份。少任一边，
   *    「存三套」就退化成「存一套看三遍」，而玩家以为留住的那两盒会跟着他下一次的改键一起变。
   */
  profileFlags(): boolean[] {
    return this.profiles.map((p) => p !== null)
  }

  /**
   * 交给存档抄的那一份。
   * **一盒都没存 ⇒ `undefined`**（不是 `[null,null,null]`）：那是同一句话的第二种写法，
   * 而 §78 那条纪律说的是「没写过就整块不写」——老档读回来不许因此长出第三种「没存过」。
   */
  getProfiles(): BindingProfile[] | undefined {
    if (this.profiles.every((p) => p === null)) return undefined
    return this.profiles.map((p) => (p === null ? null : clone(p)))
  }

  /** 读档那一拍：`undefined`/`null`（档里没这块）⇒ 三盒一格都不动，与 `restore` 同一个裁决 */
  applyProfiles(raw: unknown): void {
    if (raw === undefined || raw === null) return
    this.profiles = clampProfiles(raw)
  }

  /**
   * 把此刻那张表抄进第 `i` 盒；给了通道就**只抄那一条通道**（KI-367）。
   * 返回值说的是**那一格原来有没有东西**（`'new'`／`'overwritten'`），
   * 而不是「做没做成」：面板要说「覆盖了原来那一套」就得知道原来那一套存在过，而它手里没有那三格
   * （自己留一份「我存过几次」就是第二个主人）。界外那一次交回 `null`——做不成，也就没有 new 可说。
   * 一格都不灌：存磁带这件事不换玩家在用的键。
   *
   * 分通道那两条裁决：
   * ① **满盒只换那半**：另一条通道保持盒里原来那一份——「手柄那套练过了、键鼠那套今天又改了两个键」
   *    这件事第一次能只更新一半，而不用把另一半一起盖掉。
   * ② **空盒的另一半取此刻那张**，不是一份凭空造出来的默认（L3）：那一格说的是「这一刻玩家的两条通道」，
   *    写成默认等于让玩家没存过的那半在载入时悄悄变成别人的键（KI-362 那句「没存过不是一种默认表」的另一半）。
   *    于是空盒只存一条通道时，落盘仍是**整张**——存档形状一格没长。
   */
  storeProfile(i: number, ch?: BindChannel): 'new' | 'overwritten' | null {
    const slot = profileSlot(i)
    if (slot === null) return null
    const channel = bindChannel(ch)
    if (ch !== undefined && channel === null) return null
    const wasEmpty = this.profiles[slot] === null
    if (channel === null) {
      this.profiles[slot] = clone(this.current)
    } else {
      const base = wasEmpty ? this.current : (this.profiles[slot] as Bindings)
      this.profiles[slot] = withChannel(base, this.current, channel)
    }
    return wasEmpty ? 'new' : 'overwritten'
  }

  /**
   * 把第 `i` 盒请回运行时——**这一步才是换表**，所以它是这一组里唯一灌消费者那一个。
   * 给了通道就**只请回那半张**（KI-367）：另一条通道保持此刻那一份，一个字不跟着动。
   * 分通道不是「灌半张」——先在 store 里搭好一整张再交出去，`Input` 收到的仍是完整的表，
   * 而灌注仍然恰好一次（KI-345 那条纪律在分家之后没有被绕开）。
   *
   * 空盒返回假：「没有东西可载入」与「载入了一份默认」是两件事，后者会静默改掉玩家的键，
   * 而那一格的按钮在界面上本来就是 `disabled`（面板不画一个按了会换键的按钮）。
   * 交回运行时之前不重新夹取：那一盒进门时已过 `clampProfiles`，而 `clampBindings` 幂等 ⇒
   * 再夹一遍不会改变结果，只会让「磁带里那张」与「玩家手里那张」出现两个书写时刻。
   */
  loadProfile(i: number, ch?: BindChannel): boolean {
    const slot = profileSlot(i)
    if (slot === null) return false
    const channel = bindChannel(ch)
    if (ch !== undefined && channel === null) return false
    const tape = this.profiles[slot]
    if (tape === null) return false
    this.current = channel === null ? clone(tape) : withChannel(this.current, tape, channel)
    this.applyToTargets()
    return true
  }

  /**
   * 把第 `i` 盒请回空态（KI-363）。返回值说的是**那一格原来有没有东西**，与 `storeProfile` 那个
   * `'new'`／`'overwritten'` 同一个形状：面板要说「已清空配置文件 2」就得知道原来那一格是满的，
   * 而它手里没有那三格（自己留一份「我清过几次」是第二个主人）。
   *
   * 这里要裁决的是 KI-362 那条欠账自己提出的问——「清空」与「没写过」是不是同一句话：**在档上是**
   * （三盒全空 ⇒ `getProfiles()` 交回 `undefined` ⇒ 那一格整个不写，§78 一种写法），
   * **在界面上不是**（清空是玩家按下去的一次动作，要有回声；初始那个空态没人按过，没有回声）。
   *
   * 一个键都不灌：这一把动的是那三盒，不是运行时那张表。它既不是「回默认」（那是 `resetAll`），
   * 也不是「把刚载入那张倒回去」——玩家手里那张与那三盒本来就不是同一格数据（KI-362 ① 的理由）。
   *
   * 分通道（KI-367）不改这一格的语义：`clearProfile` 与 `profileFlags` 说的还是**那一整格**——
   * 存过一条通道的盒就是满的，「半满的盒」不是第四种存在感（那一盒落盘仍是整张，见 `storeProfile` ②）。
   */
  clearProfile(i: number): boolean {
    const slot = profileSlot(i)
    if (slot === null) return false
    if (this.profiles[slot] === null) return false
    this.profiles[slot] = null
    return true
  }

  private applyToTargets(): void {
    this.targets?.input.setBindings(this.current)
  }

  /** 读档入口：undefined/null（老档没这块）⇒ 不动；有块 ⇒ 校验之后整张换掉 */
  restore(raw: unknown): void {
    if (raw === undefined || raw === null) return
    this.current = clampBindings(raw)
    this.applyToTargets()
  }
}
