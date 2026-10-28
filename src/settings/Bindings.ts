import {
  BINDABLE_ACTIONS,
  DEFAULT_BINDS,
  UI_BINDS,
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
 *  - **不失联**：名册里每个动作/意图最后至少还有一格键（丢了就回它在默认表上的那一格，被占就落进
 *    对方腾出来的那一格——一次交换）。这条是整套规则里唯一真正保住玩法的那句：一份删光了 `dodge`
 *    的档读进来，闪避仍然在 Ctrl 上，而不是变成一个没有键的动词。
 *
 * 两条键盘通道各自成表的语义是**整张表**，不是增量——没被任何一格认领的动作走默认，因此
 * 「删掉一格 = 恢复默认」而不是「解绑」。块这一层再分两种：**缺块 ⇒ 整块照默认**（老档与手改档最常
 * 漏的是整块 `padButtons`，把"没写"读成"清空"会让手柄凭空失灵），**写了（哪怕是 `{}`）⇒ 如实整张**。
 * 再往上一层是 `settings.bindings` 整个不存在 ⇒ `restore` 干脆不动运行时，那是 KI-112 的「留空是如实」。
 * `解绑`（把动作从键盘上摘掉、只留手柄）不是规格里的东西
 * （§6 那行写的是 重映射 / 扳机死区 / 振动 / 长按阈值 / 连打 / 十字键可映射任意动作，没有"清空"），
 * 要做成显式的一格「无」而不是靠删键表达；这一格语义留在「还欠」里。
 */

/** 深拷贝一张表：`get()` 交出去的是副本，外面改不动 store 手里那份 */
const clone = (b: Bindings): Bindings => ({
  gameplay: { keyboard: { ...b.gameplay.keyboard }, padButtons: { ...b.gameplay.padButtons }, padAxes: { ...b.gameplay.padAxes } },
  ui: { keyboard: { ...b.ui.keyboard }, padButtons: { ...b.ui.padButtons }, stickThreshold: b.ui.stickThreshold }
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

/** 手柄按钮与轴下标的界（`padButtonMax`：默认表用到 18 ⇒ 上界留一格；轴 0–9 同理） */
export const BIND_BOUNDS = Object.freeze({
  stickThreshold: { min: 0.25, max: 0.9 },
  padButtonMax: 19,
  padAxisMax: 9
})

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
 * 池里必有空位 ⇒ 名册里不会有人一行键都没有。这条由下面三腿量出来，不由这段推理担保。
 *
 * `oneCodePerValue`（只给玩法那条）：HUD 的键位列与面板的槽位标签显示的是"一把键"，
 * 一个动作两把键会让 `keyOf` 的"第一条命中"变成第二个主人。菜单那条**不折叠**——
 * `confirm` 在默认表上就是 Enter / 小键盘回车 / 空格 / E 四把（`ui-ux.md` §5.2 那句"键盘不给这两格才是设备间的不一致"），
 * 折叠会把设计好的等价键当成冲突删掉。
 */
function resolveCodeMap<V extends string>(
  entries: ReadonlyArray<readonly [string, V]>,
  defaults: Readonly<Record<string, V>>,
  roster: readonly V[],
  oneCodePerValue: boolean
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
    if (placed.has(v)) continue
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

/** 逐格校验：码语法过关 + 值在名册里才收，其余丢弃（丢弃不等于失败——下一段回补） */
function readCodeMap<V>(raw: unknown, isValue: (v: unknown) => v is V): Array<[string, V]> {
  const src = asObject(raw)
  const out: Array<[string, V]> = []
  for (const code of Object.keys(src).sort()) {
    if (!isKeyboardCode(code)) continue
    const v = src[code]
    if (isValue(v)) out.push([code, v])
  }
  return out
}

/**
 * 手柄按钮表：逐格校验，**不做回补**（键位失联由键盘那张的回补规则挡在外面，手柄是第二条路）。
 * 缺块与错型 ⇒ 整块照默认；`{}` ⇒ 如实是空表（"这块我写过，就是要它空着"），两者不是一个意思。
 * 不回补还有一个理由：默认表本来就一键多用（0 与 12 都是闪避、9 与 14 都是重击），
 * 按"一个动作一把键"去折叠反而会吃掉这个设计。
 */
function resolvePadMap<V>(raw: unknown, isValue: (v: unknown) => v is V, defaults: Readonly<Record<string, V>>): Record<number, V> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...defaults } as unknown as Record<number, V>
  const src = raw as Record<string, unknown>
  const out: Record<number, V> = {}
  for (const k of Object.keys(src).sort((a, b) => Number(a) - Number(b))) {
    const i = Number(k)
    if (!Number.isInteger(i) || i < 0 || i > BIND_BOUNDS.padButtonMax) continue
    const v = src[k]
    if (isValue(v)) out[i] = v
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
  return {
    gameplay: {
      keyboard: resolveCodeMap(readCodeMap(g.keyboard, isActionName), DEFAULT_BINDS.keyboard, BINDABLE_ACTIONS, true),
      padButtons: resolvePadMap(g.padButtons, isActionName, DEFAULT_BINDS.padButtons),
      padAxes: clampAxes(g.padAxes)
    },
    ui: {
      keyboard: resolveCodeMap(readCodeMap(u.keyboard, isIntent), UI_BINDS.keyboard, UI_INTENTS, false),
      padButtons: resolvePadMap(u.padButtons, isIntent, UI_BINDS.padButtons),
      // 阈值是"过阈值 = 按下"的那条线：下限压过摇杆静止抖动，上限留一格还推得动的余量
      stickThreshold: inBounds(u.stickThreshold, UI_BINDS.stickThreshold, BIND_BOUNDS.stickThreshold)
    }
  }
}

/**
 * 消费者的结构式把手（与 `GameplaySettingsTargets` 同一口径：只声明要做的事，不引入类型依赖）。
 * 本批只有一个消费者——`Input`，两条通道本来就在它手里，分开灌会变成"半张新表"。
 */
export interface BindingsTargets {
  input: { setBindings(b: Bindings): void }
}

/**
 * `set` 能收的形状：**块可缺、块内的张也可缺**。缺的那一张走当前值（`set` 按块浅合并），
 * 写了的那一张是**整张**——所以这里没有"只改一把键"的那种补丁：UI 那一格住在下面的 `rebind()`，
 * 它自己就是"取当前整张、改一格、再交回来"，界外与失联仍旧全由 `clampBindings` 兜。
 */
export type BindingsPatch = { gameplay?: Partial<Binds>; ui?: Partial<UiBinds> }

/**
 * 绑定的运行时宿主：`get` 交给存档抄，`set` 走信任边界并立刻灌进 `Input`，`restore` 是读档入口。
 * `restore(undefined)`（老档没这块）⇒ 原地不动，与 KI-112 那句「留空是如实，不是重置成默认」同一条。
 */
export class BindingsStore {
  private current: Bindings

  constructor(
    private readonly targets: BindingsTargets | null,
    initial?: BindingsPatch
  ) {
    const d = defaultBindings()
    this.current = clampBindings({
      gameplay: { ...d.gameplay, ...initial?.gameplay },
      ui: { ...d.ui, ...initial?.ui }
    })
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
   */
  rebind(action: ActionName, code: string): void {
    const keyboard: Record<string, ActionName> = {}
    for (const [c, a] of Object.entries(this.current.gameplay.keyboard)) if (a !== action) keyboard[c] = a
    keyboard[code] = action
    this.set({ gameplay: { ...this.current.gameplay, keyboard } })
  }

  /**
   * 「恢复默认」= 把这个动作绑回它在**默认表**上的那一格。默认格由表的主人自己算
   * （`defaultBindings()` 现推），面板抄不到第二份。
   * 找不到家的那一种只可能是**名册外的名字**（`data-arg` 是字符串，DOM 那侧谁都能写）：
   * 名册上的 22 个动作各有且仅有一把默认键，这条不变量由 `bindings-data` 那条双射腿量着，
   * 所以这里不是"手柄动词没有键盘家"，而是"不是动作的名字不配搬家"。
   */
  resetKey(action: ActionName): void {
    const d = defaultBindings()
    const home = Object.keys(d.gameplay.keyboard).find((c) => d.gameplay.keyboard[c] === action)
    if (home !== undefined) this.rebind(action, home)
  }

  /**
   * 整张回到默认（「操作」页那一格「全部回默认」）。写在这里而不是让面板去拼默认表：
   * 默认值的主人只有一个，面板手里只有函数。
   */
  restoreDefaults(): void {
    this.current = clampBindings(defaultBindings())
    this.applyToTargets()
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
