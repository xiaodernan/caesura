/**
 * src/i18n/LangKey.ts — KI-742：世界里的语言键（`L`）的**唯一判据**。
 *
 * 【为什么单独一格】
 * 这一枚键不属于玩法动作（它不做任何游戏里的事：不移动、不出手、不开面板），
 * 也不属于菜单意图（菜单关着的时候照样得能按）。⇒ 它走不了 `DEFAULT_BINDS` 那条通道，
 * 也走不了 `UI_BINDS` 那条通道——那两条各自都有主人，而"往里塞一格只为了一枚热键"
 * 会让动作名册（`ACTION_LABELS` 要求每格都有中文名、操作页要求每格都有一行）凭空多一行。
 *
 * 它是**页面级热键**。而页面级热键一旦直接写成监听器里的 `if`，判据就散在事件回调里：
 * 改键武装时按下的 `L` 会被顺手当成"切语言"（玩家的新绑定变成了中文变英文），
 * 面板开着时按下的 `L` 会让半屏旧字半屏新字（中英夹杂正是 §八 要避免的那一面）。
 * 所以判据留在这里，一条纯函数、一张真值表、一个守卫文件量着它。
 *
 * @module i18n/LangKey
 */

/** 这一枚键的物理名（`KeyboardEvent.code`，不是 `key`：切到中文输入法后 `key` 会变成别的字符） */
export const LANG_KEY = 'KeyL'

/** 只看这次按下自己带的修饰键；不读任何全局状态 */
export interface LangKeyEvent {
  code: string
  repeat?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

/** 三个现场条件，全部由调用方现读（本模块不碰 DOM、不碰输入实例） */
export interface LangKeyContext {
  /** 有一块 overlay 开着（面板／地图／深处／对话／标题／开局卡）：见 `main.ts` 的 `setOverlay` */
  overlayOpen: boolean
  /** `Input` 正在等一枚键当新绑定（改键武装）：那一枚只该被记成键名 */
  capturing: boolean
  /** 焦点在可输入控件里（将来的搜索框、存档命名等）：那时 `L` 是一个字符，不是一把键 */
  inField: boolean
}

/**
 * 这一下该不该切语言。**只有一条肯定路径**：正是 `L`、不是长按重复、没带 Ctrl/Meta/Alt、
 * 没有 overlay 开着、没在改键、焦点不在输入框里。
 *
 * 为什么 Shift 不算修饰：`Shift+L` 是玩家想打一个大写 L，而这里没有输入框；
 * 在游戏里它和 `l` 是同一枚键，按下就该切——多拦一个修饰键只会让"按了没反应"多一种死法。
 */
export const shouldCycleLang = (e: LangKeyEvent, ctx: LangKeyContext): boolean =>
  e.code === LANG_KEY &&
  e.repeat !== true &&
  e.ctrlKey !== true &&
  e.metaKey !== true &&
  e.altKey !== true &&
  ctx.overlayOpen === false &&
  ctx.capturing === false &&
  ctx.inField === false

/** 语言名：三个名字是**专名**，两种词典里都原样显示（不做翻译——"English" 在中文界面里也叫 English） */
export const LANG_NAME_KEY = {
  zh: 'ui.lang.name.zh',
  'zh-TW': 'ui.lang.name.zhTW',
  en: 'ui.lang.name.en',
} as const
