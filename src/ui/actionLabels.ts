import type { ActionName } from '@/core/Input'

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
