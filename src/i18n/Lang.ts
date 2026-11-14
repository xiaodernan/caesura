/**
 * src/i18n/Lang.ts — 界面文案双语切换（KI-5xx 前置：i18n 基建 · 中文/EN 等价 · 默认中文）
 *
 * 这一套把「止音纪元」玩家界面上每一行汉字换成可切换的键/值。规则：
 *  - 默认 'zh'（止音纪元是一块中文唱片）；localStorage 'caesura-lang' 记忆用户选择
 *  - 任何界面文案都必须走 t('key') —— 原生英文也得进 zh dict（中文 mode 里无英文台词）
 *  - 数据字段里的内容（如 NPC 台词/物品描述/姓名）由数据真源管，不进本文件（rewrite 锁不破）
 *  - EN 侧追求"止音语气"：短、哑、碑文感；不许把中文直译成现代英文口气
 *
 * 当前覆盖范围：HUD 固定文案（6）/ 标题界面（15）/ 对白框（2）/ 过场字幕（1）/ 键位标签（21）
 * 后文圣典（ Stakerite 锻造台 ）在后续阶段——见 docs/PHASE-STATUS.md
 */

export type Lang = 'zh' | 'en'

const STORE_KEY = 'caesura-lang'

const ZH: Record<string, string> = {
  'ui.title.h1': '止音纪元',
  'ui.title.sub': 'CAESURA · 为她定一根弦',
  'ui.title.sub.fault': '问不出来 · ← 返回定弦',
  'ui.title.sub.reading': '这条路——Enter 把残片连回去',
  'ui.title.h1.newgame': '开一根新弦',
  'ui.title.h1.destination': '抵达碑文',
  'ui.title.slots.read.req': '读取 - 首 · W 槽位 · S 槽位',
  'ui.title.slots.read.req.never': '厄运 · 读也读不出来',
  'ui.title.cta.start': ' Y · 开始 —— 读存档',
  'ui.title.cta.fault': '查看 · 本机存档问不出来',
  'ui.title.cta.empty': ' Y · 无存档 —— 重新开始',
  'ui.title.cta.newgame': ' Y · 开始 —— 重新开始',
  'ui.title.hint.fault': '厄运 · 存档解析失败',
  'ui.title.hint.fault.detail': '厄运 · 存档解析失败 · ${fault}',
  'ui.title.hint.slots.fault': '厄运 · 存档解析失败 · ${fault}',
  'ui.title.hint.slots.read.hint': '读档页面——左右键移动 · Enter 确认',
  'ui.title.hint.idle': '←/→ 选弦 · Enter 定弦 · ↓ 挑存档',
  'ui.title.hint.blocked': '本机有存档，但读不出来 · ↓ 看是哪一格',
  'ui.title.hint.newgame': '本机没有可续的存档',
  'ui.title.confirm.continue': '确认覆盖',
  'ui.title.confirm.back': '取消 · 回去挑存档',
  'ui.title.confirm.warn.first': '创建存档点 · 一生只走这一次',
  'ui.title.confirm.warn.existing': '本机已有可读的存档。开新弦不会立刻动它，但下一次休息会把自动槽写掉。',
  'ui.title.slots.h1': '读档',
  'ui.title.back': '返回定弦',
  'ui.hud.codex': '谱册',
  'ui.hud.codex.done': '谱册 · 一段收束',
  'ui.hud.codex.progress': '谱册 · ${index}/${total}',
  'ui.hud.rank': '音级 ${rank}',
  'ui.hud.offtune': '失谐 · 正在褪色',
  'ui.hud.theHush': '休 止',
  'ui.hud.theHush.sub': '你的节拍停在这里',
  'ui.hud.seal': '寂',
  'ui.title.passive': '被动',
  'ui.title.cta.continue': '续 · 挑一格回到上次调音桩',
  'ui.title.cta.unreadable': '查看 · 本机有读不出来的存档',
  'ui.title.hint.loading': '正在查看本机存档…',
  'ui.title.sub.read': '挑一格 · Enter 读取 · ← 返回定弦',
  'ui.title.confirm.warn.fault': '本机存档问不出来（${fault}）。开新弦不会立刻动它，但下一次休息可能覆盖一份看不见的存档。',
  'ui.title.confirm.sure': '确认开新弦',
  'ui.title.hint.confirm': '←/→ 选 · Enter 确认',
  'ui.hud.quest.todo': '接头',
  'ui.dialogue.1to9': '1-9 选择 · Esc 离开',
  'ui.dialogue.continue': '空格 / 回车 继续 · Esc 离开',
  'ui.dialogue.lines': '档 ${i}',
  'ui.letterbox.skip': '已跳过 · ESC 重新放',
  'ui.letterbox.replay': 'ESC · 跳过',
  'ui.action.moveUp': '前进',
  'ui.action.moveDown': '后退',
  'ui.action.moveLeft': '左移',
  'ui.action.moveRight': '右移',
  'ui.action.sprint': '冲刺',
  'ui.action.jump': '跳跃',
  'ui.action.dodge': '闪避',
  'ui.action.attackLight': '轻击',
  'ui.action.attackHeavy': '重击',
  'ui.action.guard': '格挡',
  'ui.action.parry': '弹反',
  'ui.action.lockOn': '锁定',
  'ui.action.interact': '交互',
  'ui.action.weaponSkill': '战技一',
  'ui.action.weaponSkillB': '战技二',
  'ui.action.observe': '声纹观察',
  'ui.action.ability1': '武器槽一',
  'ui.action.ability2': '武器槽二',
  'ui.action.ability3': '武器槽三',
  'ui.action.map': '地图',
  'ui.action.pause': '暂停',
  'ui.action.throwCrystal': '投掷晶石',
}

const EN: Record<string, string> = {
  'ui.title.h1': 'The Epoch of Hush',
  'ui.title.sub': 'CAESURA · The Epoch of Hush',
  'ui.title.sub.fault': 'Ruin — the roster will not parse',
  'ui.title.sub.reading': 'The road — Enter to tie the shards',
  'ui.title.h1.newgame': 'Only once',
  'ui.title.h1.destination': 'The stone',
  'ui.title.slots.read.req': 'W · first slot · S · second slot',
  'ui.title.slots.read.req.never': 'Ruin — none can be read',
  'ui.title.cta.start': ' Y · Continue — load a save',
  'ui.title.cta.fault': ' Y · Ruin — the roster would not parse',
  'ui.title.cta.empty': ' Y · No save — begin anew',
  'ui.title.cta.newgame': ' Y · Continue — begin again',
  'ui.title.hint.fault': 'Ruin — the roster would not parse',
  'ui.title.hint.fault.detail': 'Ruin — the roster · ${fault}',
  'ui.title.hint.slots.fault': 'Ruin — the roster · ${fault}',
  'ui.title.hint.slots.read.hint': 'Read page — ←→ to move · Enter to confirm',
  'ui.title.hint.idle': 'Choose ←→ · Enter to confirm · Y for a new game',
  'ui.title.hint.blocked': 'The save is blocked · send one traveler away first',
  'ui.title.hint.newgame': 'No save yet',
  'ui.title.confirm.continue': 'Overwrite it',
  'ui.title.confirm.back': 'Back',
  'ui.title.confirm.warn.first': 'A checkpoint — only once in your life',
  'ui.title.confirm.warn.existing': 'A readable save exists. A new string will not touch it now — but the next rest will overwrite it.',
  'ui.title.slots.h1': 'Load',
  'ui.title.back': 'Back',
  'ui.hud.codex': 'Codex',
  'ui.hud.codex.done': 'Codex · one chapter closed',
  'ui.hud.codex.progress': 'Codex · ${index}/${total}',
  'ui.hud.rank': 'Pitch ${rank}',
  'ui.hud.offtune': 'Off-tune · fading',
  'ui.hud.theHush': 'Hush',
  'ui.hud.theHush.sub': 'Your beat stops here',
  'ui.hud.seal': 'Hush',
  'ui.title.passive': 'Passive',
  'ui.title.cta.continue': 'Y · Continue — back to the last tuning peg',
  'ui.title.cta.unreadable': 'View · saves exist that will not read',
  'ui.title.hint.loading': 'Reading the roster…',
  'ui.title.sub.read': 'Pick one · Enter to load · ← back',
  'ui.title.confirm.warn.fault': 'The roster will not parse (${fault}). A new string will not touch it now — but the next rest may overwrite one you cannot see.',
  'ui.title.confirm.sure': 'Confirm the new string',
  'ui.title.hint.confirm': '←→ choose · Enter to confirm',
  'ui.hud.quest.todo': 'meet',
  'ui.dialogue.1to9': '1-9 choose · Esc to leave',
  'ui.dialogue.continue': 'Space / Enter to continue · Esc to leave',
  'ui.dialogue.lines': 'Save slot ${i}',
  'ui.letterbox.skip': 'Skipped · ESC to replay',
  'ui.letterbox.replay': 'ESC to replay',
  'ui.action.moveUp': 'Forward',
  'ui.action.moveDown': 'Back',
  'ui.action.moveLeft': 'Left',
  'ui.action.moveRight': 'Right',
  'ui.action.sprint': 'Sprint',
  'ui.action.jump': 'Rise',
  'ui.action.dodge': 'Dodge',
  'ui.action.attackLight': 'Strike',
  'ui.action.attackHeavy': 'Fall',
  'ui.action.guard': 'Guard',
  'ui.action.parry': 'Parry',
  'ui.action.lockOn': 'Target',
  'ui.action.interact': 'Hand',
  'ui.action.weaponSkill': 'Song I',
  'ui.action.weaponSkillB': 'Song II',
  'ui.action.observe': 'Tune',
  'ui.action.ability1': 'Ark I',
  'ui.action.ability2': 'Ark II',
  'ui.action.ability3': 'Ark III',
  'ui.action.map': 'Map',
  'ui.action.pause': 'Pause',
  'ui.action.throwCrystal': 'Fling',
}

const DICTS: Record<Lang, Record<string, string>> = { zh: ZH, en: EN }

let current: Lang = (() => {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORE_KEY) : null
    return stored === 'en' ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
})()

export const getLang = (): Lang => current

export const setLang = (next: Lang): Lang => {
  current = next === 'en' ? 'en' : 'zh'
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORE_KEY, current)
  } catch { /* noop */ }
  return current
}

/** 取词：${name} 占位会走 vars；缺词时回落 key 本身并保持一种安静 */
export const t = (key: string, vars?: Record<string, string | number>): string => {
  let out = DICTS[current][key] ?? DICTS.zh[key] ?? key
  if (vars) {
    for (const name of Object.keys(vars)) {
      out = out.split('${' + name + '}').join(String(vars[name]))
    }
  }
  return out
}

export const LANGS: readonly Lang[] = ['zh', 'en']
