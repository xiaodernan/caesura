import type { ActionName, UiIntent } from '@/core/Input'

/**
 * 动作的中文名只有一份（KI-337）。
 *
 * 之前 HUD 右下角那一列自带一张 `[动作, 文字]` 的表，「操作」页要的却是**全部**动作各一行——
 * 两处各写一遍就是两个主人，而它们的读者永远不会出现在同一个 diff 里（改了一边的说法，
 * 另一边还是老名字，玩家看到的是同一件事的两个名字）。
 *
 * `satisfies Record<ActionName, string>` 就是这条腿：少一格或多一格都是编译期红。
 * 名册从被数的那一侧现推，这里不另抄一份动作名单（`ACTION_NAMES` 的主人只有 `core/Input.ts`）。
 */
export const ACTION_LABELS = {
  moveUp: '前进',
  moveDown: '后退',
  moveLeft: '左移',
  moveRight: '右移',
  sprint: '冲刺',
  jump: '跳跃',
  dodge: '闪避',
  attackLight: '轻击',
  attackHeavy: '重击',
  guard: '格挡',
  parry: '弹反',
  lockOn: '锁定',
  interact: '交互',
  weaponSkill: '战技一',
  weaponSkillB: '战技二',
  observe: '声纹观察',
  ability1: '武器槽一',
  ability2: '武器槽二',
  ability3: '武器槽三',
  map: '地图',
  pause: '暂停',
  throwCrystal: '投掷晶石'
} satisfies Record<ActionName, string>

/** 逐格取字（不写 `?? action` 那种兜底：名册是编译期全盖住的，落到这里的一定是名册里的动作） */
export const actionLabel = (action: ActionName): string => ACTION_LABELS[action]

/**
 * 手柄按钮的显示名（KI-343）——与上面那张同一个文件、同一条理由：**给人看的名字只有一份**。
 * 「操作」页那一列今天要画 `padButtons` 的下标，HUD 明天要是也画，抄第二张表就是两个主人
 * （改了一边的说法另一边还是老名字，而玩家看到的是同一枚键的两个名字）。
 *
 * 名册只认 **W3C `standard` 映射**的那十六格（0–15）：`core/Input.ts` 那两张默认手柄表用的就是
 * 这套坐标（注释里写着「10 = 标准映射的 L3」「Xbox 布局：十字键 12-15、A=0、B=1」），
 * 所以这里不是另起一套命名，而是给那套坐标补上汉字。界内但超出标准布局的那几把（16–19，
 * 默认表上真用到了 16/17/18）落回 `Pad<n>`：**画的是原始下标**，不凭猜给一个可能错的名字——
 * 一把非标准手柄上被叫做「C」的键，画错了比画粗更糟。
 */
const PAD_BUTTON_LABELS: Record<number, string> = {
  0: 'A', 1: 'B', 2: 'X', 3: 'Y',
  4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT',
  8: 'Back', 9: 'Start', 10: 'L3', 11: 'R3',
  12: '十字上', 13: '十字下', 14: '十字左', 15: '十字右'
}

/** 一枚下标的显示名；非整数与界外都落回 `Pad<n>`（这一串与 `Bindings.ts` 的目标拼写同一门语言） */
export const padLabel = (index: number): string =>
  (Number.isInteger(index) ? PAD_BUTTON_LABELS[index] : undefined) ?? `Pad${index}`

/**
 * 菜单意图的显示名（KI-344）——同一个文件、同一条理由：**给人看的名字只有一份**。
 * 「操作」页今天要给菜单那条通道画 17 行，HUD 与将来的对话框提示要是也各抄一张，
 * 玩家就会在同一块屏幕上看到同一件事的两个名字。
 *
 * 与上面那张动作表不同的是这里**没有**「后退」的第二个名字：`ACTION_LABELS.moveDown` 也叫「后退」
 * （玩法里那是往回走一格），而两条通道在同一个屏幕上各占一节——所以页脚那一行必须说清等的
 * 是哪一节的哪一行（那条腿在 `controls-page`），光靠名字本身分不开。
 */
export const UI_INTENT_LABELS = {
  up: '上移', down: '下移', left: '左移', right: '右移',
  confirm: '确认', back: '后退', pagePrev: '上一页', pageNext: '下一页',
  pick1: '直接选 1', pick2: '直接选 2', pick3: '直接选 3', pick4: '直接选 4', pick5: '直接选 5',
  pick6: '直接选 6', pick7: '直接选 7', pick8: '直接选 8', pick9: '直接选 9'
} satisfies Record<UiIntent, string>

/** 逐格取字（与 `actionLabel` 同一口径：名册是编译期全盖住的，落到这里的一定是名册上的意图） */
export const intentLabel = (intent: UiIntent): string => UI_INTENT_LABELS[intent]
