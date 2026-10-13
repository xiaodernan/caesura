/** `event-rules.mjs` 的声明：判据住在 .mjs 里（node 吃不下 `.ts`），测试要能被 `tsc --noEmit` 检查
 *  ⇒ 两边中间放这份声明（缺它就是 TS7016，与 `lockon-rules.d.mts` 同一个理由）。 */

/** 一个按字面量名走总线的调用点 */
export interface EventCallSite {
  name: string
  method: string
  line: number
  file: string
}

/** 名字是算出来的那种调用点——这条判据看不见它的名字，所以必须如实报数 */
export interface DynamicCallSite {
  method: string
  line: number
  file: string
}

/**
 * 空参数表那一类：`this.off()`。实测那个 `off` 是 `bus.on(...)` 返回的退订闭包字段，不是总线方法，
 * 也不带事件名 ⇒ 既不能当 offender，也不许被吞掉（census 那条门就是靠它差 3 条变红的）。
 */
export interface NamelessCallSite {
  method: string
  line: number
  file: string
}

/** 吃字面量事件名的方法名；测试有一条门从 `EventBus` 源码现推那五个泛型方法名来双向对账 */
export const NAMED_EVENT_METHODS: string[]
/** 走事件总线的接收者写法（模块级单例 `bus` 与类内部 `this`） */
export const BUS_RECEIVERS: string[]
/** 主干此刻已知、且已在账本登记过的欠账：事件名 → 那一笔账的说法。**空是目标状态** */
export const HEAD_UNDECLARED_LEDGER: Record<string, string>

/** 注释涂白 + 字符串体标记，两者一次扫描给出（长度与行数不变 ⇒ 行号可用） */
export function scanSkeleton(src: string): { code: string; inString: Uint8Array }
/** 某文件里 `interface GameEvents` 的成员名（声明合并的那几份各调一次，名册取并集） */
export function declaredEventNames(src: string): string[]
export function eventCallSites(src: string, file: string): { sites: EventCallSite[]; dynamic: DynamicCallSite[]; nameless: NamelessCallSite[] }
export function undeclaredEventNames(input: { declared: string[]; sites: EventCallSite[] }): EventCallSite[]
