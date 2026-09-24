#!/usr/bin/env node
/**
 * scripts/validate-data.mjs
 *
 * KI-015 数据门禁：零新增依赖（只用 node 内置 fs/path），校验 src/data/json/*.json。
 * 结构/词表以 src/data/schema.ts 为准（本脚本只读，绝不修改任何被校验的 JSON）。
 *
 * 用法：node scripts/validate-data.mjs        （或 npm run validate:data）
 * 退出码：存在 ERROR → 1；仅 WARN 或全绿 → 0（这才是它作为门禁的意义）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const JSON_DIR = resolve(ROOT, 'src/data/json')
const FILES = ['player.json', 'movesets.json', 'weapons.json', 'enemies.json', 'loot.json', 'regions.json', 'items.json', 'progression.json', 'statuses.json', 'movements.json', 'worldstate.json', 'npcs.json', 'dialogue.json', 'quests.json']
// Phase 6-B：对话风格枚举与任务标注（narrative.md §3.2 / §28 图例）
const CHOICE_STYLES = new Set(['blunt', 'poetic', 'silent', 'provoke'])
const QUEST_TAGS = new Set(['D', 'C', 'H', 'M'])
const EFFECT_FIELDS = new Set(['setRelation', 'setFlags', 'clearFlags', 'startQuest', 'advanceQuest', 'giveItem', 'takeItem', 'notify'])
const CONDITION_FIELDS = new Set(['flags', 'relation', 'quest', 'hasItem'])
const RELATION_OPS = new Set(['gte', 'lte', 'eq'])
// narrative §3.2 的约束：单节点文案上限
const NODE_TEXT_MAX = 120
// Phase 5-B 起：装备槽位 / 物品大类（与 schema.ts 的 SlotKey / ItemKind 对齐）
const SLOT_KEYS = new Set(['weapon', 'helm', 'cuirass', 'gloves', 'greaves', 'seal', 'sealA', 'sealB'])
const GEAR_SLOTS = new Set(['weapon', 'helm', 'cuirass', 'gloves', 'greaves', 'seal'])
const ITEM_KINDS = new Set(['currency', 'material', 'consumable', 'weapon', 'armor', 'seal', 'lore', 'key'])
const AFFIX_STATS = new Set(['poiseDmg', 'defense', 'staminaRegen', 'critRate', 'execDmg', 'noiseMul'])
const AFFIX_BEHAVIORS = new Set(['perfectBlockWindow', 'lightStartup', 'bellBonus', 'restOverdrive'])

// ---- 词表：与 src/data/schema.ts 对齐（改 schema 时同步这里） ----
const WEAPON_ARCHETYPES = new Set(['straight_sword', 'greatsword', 'spear', 'bow', 'staff', 'unique'])
const ENEMY_ARCHETYPES = new Set(['basic', 'heavy', 'ranged', 'assassin', 'support', 'elite', 'miniboss', 'boss'])
const ATTR_KEYS = new Set(['str', 'dex', 'ton', 'vig', 'ovr', 'fis'])
const BIOMES = new Set(['hub', 'forest', 'ruins', 'underground', 'camp', 'dungeon', 'boss_arena'])
const HITBOX_SHAPES = new Set(['cone', 'sphere', 'ring'])
const PROJECTILE_KINDS = new Set(['spear', 'note', 'shard'])
const REACTIONS = new Set(['R0', 'R1', 'R2', 'R3', 'R4', 'R5'])
const SHAKES = new Set(['graze', 'normal', 'heavy', 'boss'])
const INTERACTABLE_KINDS = new Set(['checkpoint', 'elevator', 'bridge', 'soundwall', 'gather', 'chest', 'npc', 'teleport', 'gate', 'bell'])
const PICK_ORDERS = new Set(['random', 'cycle'])
// src/ai/Enemy.ts:707 —— 距离带里不是招式的伪动作
const PSEUDO_ACTIONS = new Set(['chase', 'backstep', 'hold'])
// tests/flow/support.test.ts 同款判据：tag 末段为 mute 即闷音类，必须自带 ticks
const MUTE_TAG = /(^|\.)mute$/
// src/core/EventBus.ts:5 —— 五状态一张表：少一维 HUD 就没得播，多一维就是没人消费的数据
const STATUS_IDS = ['fissure', 'mute', 'echo', 'corruption', 'overdrive']
// 每个状态允许出现的字段（§55：写了没消费方的数值不许进表；加新字段必须同时接上消费方）
const STATUS_FIELDS = {
  fissure: ['tag', 'displayName', 'desc', 'maxLayers', 'dmgMulPerLayer', 'idleTicks', 'decayEveryTicks', 'burst'],
  mute: ['tag', 'displayName', 'desc', 'regenMul'],
  echo: ['tag', 'displayName', 'desc', 'delayTicks', 'replayMul', 'radius', 'maxShadows'],
  corruption: ['tag', 'displayName', 'desc', 'max', 'eliteHit', 'visualStart', 'hpPerSec'],
  overdrive: ['tag', 'displayName', 'desc'],
}
// src/core/Input.ts ActionName —— 目前只有这两条动作被乐章战技占用（新增槽位要先在输入层登记）
const MOVEMENT_ACTIONS = new Set(['weaponSkill', 'weaponSkillB'])
/** 战技帧的字段白名单： MovementFrame（schema.ts）。多一个字段就必须多一个消费方 */
const MOVE_FRAME_FIELDS = ['startup', 'activeStart', 'activeEnd', 'recovery', 'poise', 'hitStopMs', 'hitbox', 'multi', 'shake', 'sfx', 'vfx', 'loudness']
/** 战技每级的数值字段： MovementLevel。同样一字段一消费口 */
const MOVE_LEVEL_FIELDS = ['cooldownTicks', 'damage', 'trueDamage', 'fissureLayers', 'muteTicks', 'distance', 'freezeTicks']

// ---- 小工具 ----
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isArr = Array.isArray
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const isStr = (v) => typeof v === 'string' && v.length > 0
const isHex = (v) => typeof v === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)
// schema 里 body.color/emissive/coreColor 是 number（0xRRGGBB）；palette 三项才是 hex 字符串
const isColorValue = (v) => isHex(v) || (Number.isInteger(v) && v >= 0 && v <= 0xffffff)

class Report {
  constructor() { this.rows = [] }
  add(file, level, where, msg) { this.rows.push({ file, level, where, msg }) }
  error(file, where, msg) { this.add(file, 'ERROR', where, msg) }
  warn(file, where, msg) { this.add(file, 'WARN', where, msg) }

  /** 数值校验：undefined → 必填缺失；非有限数 → NaN/Infinity；int/范围越界。返回是否通过。 */
  num(file, where, v, opts = {}) {
    const { min = -Infinity, max = Infinity, int = false, name = where.split('.').pop() } = opts
    if (v === undefined || v === null) { this.error(file, where, `${name} 必填但缺失`); return false }
    if (typeof v !== 'number' || !Number.isFinite(v)) { this.error(file, where, `${name} 不是有限数值（${JSON.stringify(v)}）`); return false }
    if (int && !Number.isInteger(v)) { this.error(file, where, `${name} 必须是整数（${v}）`); return false }
    if (v < min || v > max) {
      const lo = min === -Infinity ? '-∞' : min
      const hi = max === Infinity ? '∞' : max
      this.error(file, where, `${name}=${v} 超出允许范围 [${lo}, ${hi}]`)
      return false
    }
    return true
  }

  /** 子对象里的数值字段：子对象存在时逐字段必填；可选字段请传 { optional:true }。 */
  sub(file, where, obj, spec) {
    if (obj === undefined) return
    if (!isObj(obj)) { this.error(file, where, '必须是对象'); return }
    for (const [k, o] of Object.entries(spec)) {
      if (o.str) { if (obj[k] !== undefined && !isStr(obj[k])) this.error(file, `${where}.${k}`, '必须是非空字符串'); continue }
      if (o.bool) { if (obj[k] !== undefined && typeof obj[k] !== 'boolean') this.error(file, `${where}.${k}`, '必须是布尔'); continue }
      if (o.optional && obj[k] === undefined) continue
      this.num(file, `${where}.${k}`, obj[k], { ...o, name: k })
    }
  }
}

const report = new Report()

// ---- 数据加载 ----
const data = {}
for (const f of FILES) {
  try { data[f] = JSON.parse(readFileSync(resolve(JSON_DIR, f), 'utf8')) }
  catch (e) { report.error(f, f, `JSON 读取/解析失败：${e.message}`); data[f] = null }
}

// ---- 通用片段校验 ----
function vec3(file, where, v) {
  if (!isObj(v)) { report.error(file, where, '必须是有 x/y/z 的对象'); return }
  for (const k of ['x', 'y', 'z']) report.num(file, `${where}.${k}`, v[k], { name: k })
}

function strArray(file, where, v, { nonEmpty = false } = {}) {
  if (!isArr(v)) { report.error(file, where, '必须是数组'); return }
  if (nonEmpty && v.length === 0) { report.error(file, where, '数组不能为空'); return }
  v.forEach((s, i) => { if (!isStr(s)) report.error(file, `${where}[${i}]`, '必须是非空字符串') })
}

function hitbox(file, where, hb) {
  if (!isObj(hb)) { report.error(file, where, 'hitbox 必须是对象'); return }
  if (!HITBOX_SHAPES.has(hb.shape)) { report.error(file, where, `hitbox.shape=${JSON.stringify(hb.shape)} 非法（cone/sphere/ring）`); return }
  if (hb.shape === 'cone') {
    report.num(file, `${where}.angleDeg`, hb.angleDeg, { min: 0, max: 360, name: 'angleDeg' })
    report.num(file, `${where}.radius`, hb.radius, { min: 0, name: 'radius' })
    report.num(file, `${where}.height`, hb.height, { min: 0, name: 'height' })
    report.num(file, `${where}.offsetY`, hb.offsetY, { name: 'offsetY' })
  } else if (hb.shape === 'sphere') {
    report.num(file, `${where}.radius`, hb.radius, { min: 0, name: 'radius' })
    report.num(file, `${where}.offsetY`, hb.offsetY, { name: 'offsetY' })
    report.num(file, `${where}.offsetFwd`, hb.offsetFwd, { name: 'offsetFwd' })
  } else {
    const okIn = report.num(file, `${where}.inner`, hb.inner, { min: 0, name: 'inner' })
    const okOut = report.num(file, `${where}.outer`, hb.outer, { min: 0, name: 'outer' })
    report.num(file, `${where}.forward`, hb.forward, { name: 'forward' })
    if (okIn && okOut && !(hb.inner < hb.outer)) report.error(file, where, `ring 必须 inner < outer（${hb.inner} / ${hb.outer}）`)
  }
}

function projectile(file, where, p) {
  if (!isObj(p)) { report.error(file, where, 'projectile 必须是对象'); return }
  if (!PROJECTILE_KINDS.has(p.kind)) report.error(file, where, `projectile.kind=${JSON.stringify(p.kind)} 非法（spear/note/shard）`)
  report.num(file, `${where}.speed`, p.speed, { min: 0, name: 'speed' })
  report.num(file, `${where}.range`, p.range, { min: 0, name: 'range' })
  report.num(file, `${where}.radius`, p.radius, { min: 0, name: 'radius' })
  for (const [k, o] of Object.entries({ offsetY: {}, gravity: {}, pierce: { min: 0, int: true }, pinTicks: { min: 0, int: true }, muteOnHit: { min: 0, int: true } })) {
    if (p[k] !== undefined) report.num(file, `${where}.${k}`, p[k], { ...o, name: k })
  }
  if (p.telegraph !== undefined && typeof p.telegraph !== 'boolean') report.error(file, `${where}.telegraph`, '必须是布尔')
  if (p.shake !== undefined && !SHAKES.has(p.shake)) report.error(file, `${where}.shake`, `shake=${JSON.stringify(p.shake)} 非法`)
  if (p.burst !== undefined) {
    const b = p.burst
    if (!isObj(b)) { report.error(file, `${where}.burst`, '必须是对象'); return }
    report.num(file, `${where}.burst.count`, b.count, { min: 1, int: true, name: 'count' })
    report.num(file, `${where}.burst.everyTicks`, b.everyTicks, { min: 1, int: true, name: 'everyTicks' })
    if (b.at !== undefined) {
      if (!isArr(b.at)) report.error(file, `${where}.burst.at`, '必须是数组')
      else {
        b.at.forEach((n, i) => report.num(file, `${where}.burst.at[${i}]`, n, { min: 0, name: 'at' }))
        if (isNum(b.count) && b.at.length > b.count) report.warn(file, `${where}.burst.at`, `显式帧位 ${b.at.length} 个多于 count=${b.count}`)
      }
    }
  }
}

/** 帧数据：必填 + 帧序 + 可选项。返回 frames.next（供调用方做引用校验）。 */
function frames(file, where, f) {
  if (!isObj(f)) { report.error(file, where, 'frames 缺失或不是对象'); return undefined }
  for (const k of ['startup', 'activeStart', 'activeEnd', 'recovery', 'damage', 'stamina', 'poise', 'hitStopMs']) {
    report.num(file, `${where}.${k}`, f[k], { min: 0, name: k })
  }
  const { startup, activeStart, activeEnd, recovery } = f
  if ([startup, activeStart, activeEnd, recovery].every(isNum)
    && !(startup <= activeStart && activeStart <= activeEnd && activeEnd <= recovery)) {
    report.error(file, where, `帧序非法：需 startup(${startup}) <= activeStart(${activeStart}) <= activeEnd(${activeEnd}) <= recovery(${recovery})`)
  }
  if (f.lunge !== undefined) report.num(file, `${where}.lunge`, f.lunge, { name: 'lunge' })
  if (f.loudness !== undefined) report.num(file, `${where}.loudness`, f.loudness, { min: 0, name: 'loudness' })
  if (f.fissureLayers !== undefined) report.num(file, `${where}.fissureLayers`, f.fissureLayers, { min: 0, int: true, name: 'fissureLayers' })
  if (f.shake !== undefined && !SHAKES.has(f.shake)) report.error(file, `${where}.shake`, `shake=${JSON.stringify(f.shake)} 非法`)
  for (const k of ['sfx', 'vfx', 'flags']) if (f[k] !== undefined) strArray(file, `${where}.${k}`, f[k])
  if (f.beatQuant !== undefined) {
    if (!isArr(f.beatQuant)) report.error(file, `${where}.beatQuant`, '必须是数组')
    else f.beatQuant.forEach((n, i) => report.num(file, `${where}.beatQuant[${i}]`, n, { name: 'beatQuant' }))
  }
  if (f.next !== undefined && !isStr(f.next)) report.error(file, `${where}.next`, '必须是非空字符串')
  if (f.echoOnHit !== undefined && typeof f.echoOnHit !== 'boolean') report.error(file, `${where}.echoOnHit`, '必须是布尔（§11 回响：命中时是否留下回声）')
  if (f.hitbox !== undefined) hitbox(file, `${where}.hitbox`, f.hitbox)
  if (f.projectile !== undefined) projectile(file, `${where}.projectile`, f.projectile)
  return f.next
}

/** 招式必填帧序检查（movesets 与 enemies 共用） */
function attackFrames(file, where, a) {
  if (!isObj(a)) { report.error(file, where, '招式必须是对象'); return undefined }
  return frames(file, `${where}.frames`, a.frames)
}

// ---- player.json ----
function validatePlayer() {
  const file = 'player.json'
  const p = data[file]
  if (!isObj(p)) { report.error(file, file, '顶层必须是对象'); return }
  for (const [k, o] of Object.entries({
    hp: { min: 1 }, stamina: { min: 0 }, poise: { min: 0 }, defense: { min: 0 },
    moveSpeed: { min: 0 }, sprintSpeed: { min: 0 }, sprintCostPerSec: { min: 0 },
    jumpSpeed: { min: 0 }, gravity: { min: 0 }, perfectBlockWindow: { min: 0, int: true }, attrUpCost: { min: 0 },
  })) report.num(file, k, p[k], { ...o, name: k })

  report.sub(file, 'staminaRegen', p.staminaRegen, { hardDelay: { min: 0, int: true }, slowPerSec: { min: 0 }, slowTicks: { min: 0, int: true }, fastPerSec: { min: 0 } })
  // §5.1 破防踉跄 + §10 那行的慢放附加格（KI-017③ 裁决 2026-09-25：破防不进 §9 停顿表，时间演出走这里）。
  // scale 卡在 (0,1) 开区间：≥1 就不是"慢放"，那格该删而不是留着骗消费者。
  report.sub(file, 'guard', p.guard, { startupTicks: { min: 0, int: true }, reduction: { min: 0, max: 1 }, staPerDmg: { min: 0 }, bleedPoiseFrac: { min: 0, max: 1 }, perfectBlockReflectMul: { min: 0, max: 1 }, breakStunMs: { min: 1 }, breakSlowMs: { min: 0 }, breakSlowScale: { min: 0.05, max: 0.99 } })
  report.sub(file, 'parry', p.parry, { activeTicks: { min: 0, int: true }, whiffRecovery: { min: 0, int: true }, poiseDamage: { min: 0 }, stunTicks: { min: 0, int: true }, overdriveGain: { min: 0 }, projectileReflectMul: { min: 0, max: 1 } })
  report.sub(file, 'roll', p.roll, { total: { min: 0, int: true }, iframeStart: { min: 0, int: true }, iframeEnd: { min: 0, int: true }, dist: { min: 0 }, backDist: { min: 0 }, stamina: { min: 0 }, lockOnDist: { min: 0 } })
  report.sub(file, 'execution', p.execution, {
    hpFrac: { min: 0, max: 1 }, flat: { min: 0 }, stealthKillFrac: { min: 0, max: 1 }, backstabConeDeg: { min: 0, max: 180 },
    backstabRange: { min: 0 }, crumpleRange: { min: 0 }, overdriveCost: { min: 0 }, overdriveFrac: { min: 0, max: 1 },
    overdriveFlat: { min: 0 }, durationTicks: { min: 0, int: true }, firstBladeHitStopMs: { min: 0 },
  })
  // §9「Hitstop 时长分级表」里玩家是守方的四行（KI-017 第四步：这四个数曾写死在 CombatManager 里）
  if (!isObj(p.hitStop)) report.error(file, 'hitStop', '缺失：§9 的四行情境停顿必须有来源，代码里不留第二个数')
  else {
    report.sub(file, 'hitStop', p.hitStop, { hurtMs: { min: 0 }, blockMs: { min: 0 }, perfectBlockMs: { min: 0 }, parryMs: { min: 0 } })
    const { hurtMs, blockMs, perfectBlockMs, parryMs } = p.hitStop
    // 序关系就是这一表的设计意图：接住（盾面卡一下）比挨在身上短，接准与弹反比挨在身上更长——
    // 「防守成功」那一格必须比「防守失败」更有电影感，否则整张表是在惩罚正确操作。
    if ([hurtMs, blockMs, perfectBlockMs, parryMs].every(isNum)) {
      if (blockMs > hurtMs) report.error(file, 'hitStop', `命中被格挡(${blockMs}) 不该长于玩家受击(${hurtMs})：盾上那一下更短`)
      if (perfectBlockMs < hurtMs) report.error(file, 'hitStop', `完美格挡(${perfectBlockMs}) 短于硬吃(${hurtMs}) ⇒ 接准反而更没存在感`)
      if (parryMs < perfectBlockMs) report.error(file, 'hitStop', `弹反(${parryMs}) 短于完美格挡(${perfectBlockMs})：§9 的精度阶梯反了`)
    }
  }
  report.sub(file, 'rankXpCurve', p.rankXpCurve, { base: { min: 0 }, a: { min: 0 }, b: { min: 0 } })
  report.sub(file, 'attrs', p.attrs, Object.fromEntries([...ATTR_KEYS].map((k) => [k, { min: 0 }])))

  // 区间序关系
  if (isObj(p.roll)) {
    const { total, iframeStart, iframeEnd, lockOnIframes } = p.roll
    if ([total, iframeStart, iframeEnd].every(isNum) && !(iframeStart <= iframeEnd && iframeEnd <= total)) {
      report.error(file, 'roll', `需 iframeStart(${iframeStart}) <= iframeEnd(${iframeEnd}) <= total(${total})`)
    }
    if (lockOnIframes !== undefined) {
      if (!isArr(lockOnIframes) || lockOnIframes.length !== 2) report.error(file, 'roll.lockOnIframes', '必须是 [start, end] 两元素数组')
      else {
        lockOnIframes.forEach((n, i) => report.num(file, `roll.lockOnIframes[${i}]`, n, { min: 0, int: true, name: 'lockOnIframes' }))
        if (lockOnIframes.every(isNum) && !(lockOnIframes[0] <= lockOnIframes[1] && lockOnIframes[1] <= total)) {
          report.error(file, 'roll.lockOnIframes', `需 start <= end <= roll.total(${total})`)
        }
      }
    }
  }
  if (isObj(p.execution)) {
    const bf = p.execution.bossFracs
    if (!isArr(bf) || bf.length === 0) report.error(file, 'execution.bossFracs', '必须是非空数组')
    else bf.forEach((n, i) => report.num(file, `execution.bossFracs[${i}]`, n, { min: 0, max: 1, name: 'bossFracs' }))
  }
}

// ---- movesets.json ----
function validateMovesets() {
  const file = 'movesets.json'
  const list = data[file]
  const ids = new Set()
  if (!isArr(list)) { report.error(file, file, '顶层必须是数组'); return ids }
  list.forEach((ms, i) => {
    if (!isObj(ms)) { report.error(file, `[${i}]`, '必须是对象'); return }
    const w = isStr(ms.id) ? ms.id : `[${i}]`
    if (!isStr(ms.id)) report.error(file, w, 'id 缺失或非字符串')
    else if (ids.has(ms.id)) report.error(file, w, `id 重复：${ms.id}`)
    else ids.add(ms.id)
    if (!isObj(ms.actions) || Object.keys(ms.actions).length === 0) { report.error(file, w, 'actions 必须是非空对象'); return }
    const keys = new Set(Object.keys(ms.actions))
    for (const [name, f] of Object.entries(ms.actions)) {
      const nx = frames(file, `${w}.actions.${name}`, f)
      if (nx !== undefined && isStr(nx) && !keys.has(nx)) {
        report.error(file, `${w}.actions.${name}`, `next 悬空引用：'${nx}' 不在本 moveset 的 actions 里`)
      }
    }
  })
  return ids
}

// ---- weapons.json ----
function validateWeapons(movesetIds) {
  const file = 'weapons.json'
  const list = data[file]
  const ids = new Set()
  if (!isArr(list)) { report.error(file, file, '顶层必须是数组'); return ids }
  list.forEach((wp, i) => {
    if (!isObj(wp)) { report.error(file, `[${i}]`, '必须是对象'); return }
    const w = isStr(wp.id) ? wp.id : `[${i}]`
    if (!isStr(wp.id)) report.error(file, w, 'id 缺失或非字符串')
    else if (ids.has(wp.id)) report.error(file, w, `id 重复：${wp.id}`)
    else ids.add(wp.id)
    if (!isStr(wp.nameKey)) report.error(file, w, 'nameKey 缺失或非字符串')
    if (!WEAPON_ARCHETYPES.has(wp.archetype)) report.error(file, w, `archetype=${JSON.stringify(wp.archetype)} 非法`)
    if (!isStr(wp.movesetId)) report.error(file, w, 'movesetId 缺失或非字符串')
    else if (!movesetIds.has(wp.movesetId)) report.error(file, w, `movesetId 悬空引用：'${wp.movesetId}' 不在 movesets.json`)
    report.num(file, `${w}.atkBase`, wp.atkBase, { min: 0, name: 'atkBase' })
    if (!isObj(wp.scaling)) report.error(file, `${w}.scaling`, '必须是对象')
    else for (const [k, v] of Object.entries(wp.scaling)) {
      if (!ATTR_KEYS.has(k)) report.error(file, `${w}.scaling.${k}`, `未知属性键 '${k}'（${[...ATTR_KEYS].join('/')}）`)
      else report.num(file, `${w}.scaling.${k}`, v, { min: 0, name: k })
    }
    strArray(file, `${w}.swingTag`, wp.swingTag, { nonEmpty: true })
    if (!isStr(wp.skill)) report.error(file, `${w}.skill`, '缺失或非字符串')
    if (wp.poiseMul !== undefined) report.num(file, `${w}.poiseMul`, wp.poiseMul, { min: 0, name: 'poiseMul' })
    if (wp.noiseMul !== undefined) report.num(file, `${w}.noiseMul`, wp.noiseMul, { min: 0, name: 'noiseMul' })
  })
  return ids
}

// ---- progression.json ----
function validateProgression() {
  const file = 'progression.json'
  const d = data[file]
  const rarityIds = new Set()
  const attrKeys = new Set()
  if (!isObj(d)) { report.error(file, file, '顶层必须是对象'); return { rarityIds, attrKeys } }
  report.num(file, 'maxRank', d.maxRank, { min: 2, int: true, name: 'maxRank' })
  // 六音级属性必须一个不多一个不少（漏一维就会有一个属性永远无法分配）
  if (!isArr(d.attrs) || d.attrs.length !== 6) report.error(file, 'attrs', '必须恰好 6 条六音级属性')
  else d.attrs.forEach((a, i) => {
    const w = `attrs[${i}]`
    if (!isObj(a)) { report.error(file, w, '必须是对象'); return }
    if (!ATTR_KEYS.has(a.key)) report.error(file, `${w}.key`, `未知属性键：${a.key}`)
    else if (attrKeys.has(a.key)) report.error(file, w, `属性键重复：${a.key}`)
    else attrKeys.add(a.key)
    if (!isStr(a.displayName)) report.error(file, `${w}.displayName`, '必填')
    if (!isStr(a.desc) || a.desc.length < 5) report.error(file, `${w}.desc`, '需要一句世界内解释（§19）')
    const soft = report.num(file, `${w}.softcap`, a.softcap, { min: 1, int: true, name: 'softcap' })
    const hard = report.num(file, `${w}.hardcap`, a.hardcap, { min: 1, int: true, name: 'hardcap' })
    if (soft && hard && !(a.softcap < a.hardcap)) report.error(file, w, `softcap 必须小于 hardcap（${a.softcap} / ${a.hardcap}）`)
  })
  // 等级曲线：rank 从 2 连续到 maxRank，xp 严格递增
  if (!isArr(d.rankCurve) || d.rankCurve.length === 0) report.error(file, 'rankCurve', '必须是非空数组')
  else {
    let prev = 0
    d.rankCurve.forEach((r, i) => {
      const w = `rankCurve[${i}]`
      if (!isObj(r)) { report.error(file, w, '必须是对象'); return }
      report.num(file, `${w}.rank`, r.rank, { min: 2, int: true, name: 'rank' })
      const ok = report.num(file, `${w}.xp`, r.xp, { min: 1, int: true, name: 'xp' })
      if (ok && r.xp <= prev) report.error(file, w, `xp 必须严格递增（${prev} → ${r.xp}）`)
      if (ok) prev = r.xp
      if (i + 2 !== r.rank) report.error(file, w, `rank 必须连续：期望 ${i + 2}，实际 ${r.rank}`)
    })
    if (d.rankCurve.length !== d.maxRank - 1) report.error(file, 'rankCurve', `长度应为 maxRank-1=${d.maxRank - 1}，实际 ${d.rankCurve.length}`)
  }
  // 强化曲线：1..10 连续，花费与收益非负
  if (!isArr(d.upgrade) || d.upgrade.length === 0) report.error(file, 'upgrade', '必须是非空数组')
  else d.upgrade.forEach((u, i) => {
    const w = `upgrade[${i}]`
    if (!isObj(u)) { report.error(file, w, '必须是对象'); return }
    if (u.level !== i + 1) report.error(file, w, `level 必须连续：期望 ${i + 1}，实际 ${u.level}`)
    report.num(file, `${w}.timbite`, u.timbite, { min: 0, int: true, name: 'timbite' })
    report.num(file, `${w}.dross`, u.dross, { min: 0, int: true, name: 'dross' })
    report.num(file, `${w}.weaponMul`, u.weaponMul, { min: 0, name: 'weaponMul' })
    report.num(file, `${w}.armorMul`, u.armorMul, { min: 0, name: 'armorMul' })
  })
  // 稀有度：id 唯一、词缀数与上限合理
  if (!isArr(d.rarity) || d.rarity.length === 0) report.error(file, 'rarity', '必须是非空数组')
  else d.rarity.forEach((r, i) => {
    const w = `rarity[${i}]`
    if (!isObj(r)) { report.error(file, w, '必须是对象'); return }
    if (!isStr(r.id)) report.error(file, `${w}.id`, '必填')
    else if (rarityIds.has(r.id)) report.error(file, w, `id 重复：${r.id}`)
    else rarityIds.add(r.id)
    report.num(file, `${w}.affixes`, r.affixes, { min: 0, int: true, name: 'affixes' })
    report.num(file, `${w}.maxLevel`, r.maxLevel, { min: 0, int: true, name: 'maxLevel' })
  })
  // 全局装备大保底（§9.4）：Loot.ts 逐字消费这两个数，代码里不留第二份
  if (!isObj(d.pity)) report.error(file, 'pity', '必须是 { every, floorRarity }（§9.4 全局大保底）')
  else {
    report.num(file, 'pity.every', d.pity.every, { min: 2, int: true, name: 'pity.every' })
    if (!isStr(d.pity.floorRarity) || !rarityIds.has(d.pity.floorRarity)) {
      report.error(file, 'pity.floorRarity', `未知稀有度：${d.pity.floorRarity}（progression.json.rarity）`)
    }
  }
  const affixDefs = new Map()
  // 词缀：每条必须有 stat 或 behavior（没有消费方的词缀不许写进表）
  if (!isObj(d.affixes)) report.error(file, 'affixes', '必须是对象')
  else for (const group of ['prefix', 'suffix']) {
    const list = d.affixes[group]
    if (!isArr(list)) { report.error(file, `affixes.${group}`, '必须是数组'); continue }
    list.forEach((a, i) => {
      const w = `affixes.${group}[${i}]`
      if (!isObj(a)) { report.error(file, w, '必须是对象'); return }
      if (!isStr(a.id)) report.error(file, `${w}.id`, '必填')
      if (!isStr(a.desc)) report.error(file, `${w}.desc`, '必填')
      const hasStat = a.stat !== undefined
      const hasBehavior = a.behavior !== undefined
      if (!hasStat && !hasBehavior) report.error(file, w, '必须写 stat 或 behavior —— 没有消费方的词缀不许进表（KI-029）')
      if (hasStat && hasBehavior) report.error(file, w, 'stat 与 behavior 只能二选一')
      if (hasStat && !AFFIX_STATS.has(a.stat)) report.error(file, `${w}.stat`, `未知 stat：${a.stat}`)
      if (hasBehavior && !AFFIX_BEHAVIORS.has(a.behavior)) report.error(file, `${w}.behavior`, `未知 behavior：${a.behavior}`)
      if (isStr(a.id)) affixDefs.set(a.id, a)
      if (a.minRarity !== undefined && !rarityIds.has(a.minRarity)) report.error(file, `${w}.minRarity`, `未知稀有度：${a.minRarity}`)
      if (a.slots !== undefined) {
        if (!isArr(a.slots) || a.slots.length === 0) report.error(file, `${w}.slots`, '要写就是非空数组（不写＝任何槽都行）')
        else for (const sl of a.slots) if (!GEAR_SLOTS.has(sl)) report.error(file, `${w}.slots`, `未知槽位：${sl}`)
      }
      if (isArr(a.range)) {
        if (a.range.length !== 2) report.error(file, `${w}.range`, '必须是 [min, max]')
        else if (!(a.range[0] <= a.range[1])) report.error(file, `${w}.range`, `需 min <= max（${a.range[0]} / ${a.range[1]}）`)
      } else report.error(file, `${w}.range`, '必填 [min, max]')
      if (a.slots !== undefined) strArray(file, `${w}.slots`, a.slots, { nonEmpty: true })
      if (a.slots !== undefined) for (const sl of a.slots) if (!GEAR_SLOTS.has(sl)) report.error(file, `${w}.slots`, `未知槽位：${sl}`)
      if (a.minRarity !== undefined && !rarityIds.has(a.minRarity)) report.error(file, `${w}.minRarity`, `未知稀有度：${a.minRarity}`)
    })
  }
  // 里程碑：rank 必须在曲线范围内
  if (!isArr(d.milestones)) report.error(file, 'milestones', '必须是数组')
  else d.milestones.forEach((m, i) => {
    const w = `milestones[${i}]`
    if (!isObj(m)) { report.error(file, w, '必须是对象'); return }
    report.num(file, `${w}.rank`, m.rank, { min: 2, max: d.maxRank, int: true, name: 'rank' })
    if (!isStr(m.id)) report.error(file, `${w}.id`, '必填')
    if (!isStr(m.label)) report.error(file, `${w}.label`, '必填（§8.2「你新能做什么」）')
  })
  // 出身：六维齐全、合计一致（"定弦只改分布"这条设计承诺必须可机器检查）
  if (!isArr(d.origins) || d.origins.length === 0) report.error(file, 'origins', '必须是非空数组')
  else {
    const totals = new Set()
    d.origins.forEach((o, i) => {
      const w = `origins[${i}]`
      if (!isObj(o)) { report.error(file, w, '必须是对象'); return }
      if (!isStr(o.id)) report.error(file, `${w}.id`, '必填')
      if (!isObj(o.attrs)) { report.error(file, `${w}.attrs`, '必须是对象'); return }
      let total = 0
      for (const k of ATTR_KEYS) {
        const ok = report.num(file, `${w}.attrs.${k}`, o.attrs[k], { min: 1, int: true, name: k })
        if (ok) total += o.attrs[k]
      }
      totals.add(total)
      if (!isStr(o.weaponId)) report.error(file, `${w}.weaponId`, '必填')
      else if (!weaponIds.has(o.weaponId)) report.error(file, `${w}.weaponId`, `悬空引用：'${o.weaponId}' 不在 weapons.json`)
      if (o.gearIds !== undefined) strArray(file, `${w}.gearIds`, o.gearIds, { nonEmpty: true })
      if (!isStr(o.blurb)) report.error(file, `${w}.blurb`, '必填')
    })
    if (totals.size > 1) report.error(file, 'origins', `各出身六维合计必须一致，实际出现：${[...totals].join(' / ')}`)
  }
  return { rarityIds, attrKeys, affixDefs }
}

// ---- statuses.json ----
/** 每个状态的数值字段与取值范围（字段白名单在 STATUS_FIELDS，两边一起改） */
const STATUS_SPECS = {
  fissure: { maxLayers: { min: 2, int: true }, dmgMulPerLayer: { min: 0 }, idleTicks: { min: 0, int: true }, decayEveryTicks: { min: 1, int: true } },
  mute: { regenMul: { min: 0, max: 1 } },
  echo: { delayTicks: { min: 1, int: true }, replayMul: { min: 0 }, radius: { min: 0 }, maxShadows: { min: 1, int: true } },
  corruption: { max: { min: 1 }, eliteHit: { min: 0 }, visualStart: { min: 0 }, hpPerSec: { min: 0 } },
  overdrive: {},
}

function validateStatuses() {
  const file = 'statuses.json'
  const d = data[file]
  if (!isObj(d)) { report.error(file, file, '顶层必须是对象（按状态 id 键控）'); return }
  // 五缺一：HUD chip / 术语台账按 STATUS_IDS 逐个取，缺一行就是「这个状态永远不会被解释」
  for (const id of STATUS_IDS) if (d[id] === undefined) report.error(file, id, `缺少 '${id}' 这一行（EventBus.STATUS_IDS 声明了它）`)
  for (const [id, s] of Object.entries(d)) {
    if (!STATUS_IDS.includes(id)) { report.error(file, id, `'${id}' 不是五状态之一：要加就得同时补进 EventBus.STATUS_IDS 并接上消费方`); continue }
    if (!isObj(s)) { report.error(file, id, '必须是对象'); continue }
    if (!isStr(s.tag)) report.error(file, `${id}.tag`, '缺失或非字符串')
    else if (s.tag.split('.').pop() !== id) report.error(file, `${id}.tag`, `tag 末段必须等于 '${id}'（StatusGlossary 与 tagIs 都按末段判），实为 '${s.tag}'`)
    if (!isStr(s.displayName)) report.error(file, `${id}.displayName`, '必填')
    if (!isStr(s.desc) || s.desc.length < 5) report.error(file, `${id}.desc`, '需要一句世界内解释（§19 的 tooltip）')
    for (const k of Object.keys(s)) {
      if (!STATUS_FIELDS[id].includes(k)) report.error(file, `${id}.${k}`, `不认的字段：§55 不许写没有消费方的数据（本状态可用：${STATUS_FIELDS[id].join('/')}）`)
    }
    report.sub(file, id, s, STATUS_SPECS[id])
    if (id === 'fissure') {
      report.sub(file, `${id}.burst`, s.burst, { trueDamage: { min: 0 }, poise: { min: 0 } })
      if (isNum(s.dmgMulPerLayer) && s.dmgMulPerLayer >= 1) report.error(file, `${id}.dmgMulPerLayer`, `每层 +${s.dmgMulPerLayer} >= 100%：满层就是倍率怪物，请回到 0.x`)
    }
    if (id === 'corruption' && isNum(s.visualStart) && isNum(s.max) && !(s.visualStart < s.max)) {
      report.error(file, id, `visualStart(${s.visualStart}) 必须小于 max(${s.max})，否则去饱和永远不会渐入`)
    }
  }
}

// ---- items.json ----
function validateItems(weaponIds, rarityIds, affixDefs) {
  const file = 'items.json'
  const list = data[file]
  const ids = new Set()
  if (!isArr(list)) { report.error(file, file, '顶层必须是数组'); return ids }
  list.forEach((it, i) => {
    const w = isStr(it?.id) ? it.id : `[${i}]`
    if (!isObj(it)) { report.error(file, w, '必须是对象'); return }
    if (!isStr(it.id)) report.error(file, w, 'id 缺失或非字符串')
    else if (ids.has(it.id)) report.error(file, w, `id 重复：${it.id}`)
    else ids.add(it.id)
    if (!isStr(it.displayName)) report.error(file, w, 'displayName 必填')
    if (!isStr(it.desc)) report.error(file, w, 'desc 必填（物品也要有世界内解释）')
    if (!ITEM_KINDS.has(it.kind)) report.error(file, w, `未知 kind：${it.kind}`)
    report.num(file, `${w}.stack`, it.stack, { min: 1, int: true, name: 'stack' })
    if (it.value !== undefined) report.num(file, `${w}.value`, it.value, { min: 0, name: 'value' })
    const gearKind = it.kind === 'weapon' || it.kind === 'armor' || it.kind === 'seal'
    if (gearKind && !isObj(it.gear)) { report.error(file, w, `${it.kind} 必须带 gear`); return }
    if (!gearKind && it.gear !== undefined) report.error(file, w, '非装备件不该带 gear')
    if (isObj(it.gear)) {
      const g = it.gear
      if (!GEAR_SLOTS.has(g.slot)) report.error(file, `${w}.gear.slot`, `未知槽位：${g.slot}`)
      if (!rarityIds.has(g.rarity)) report.error(file, `${w}.gear.rarity`, `未知稀有度：${g.rarity}（progression.json.rarity）`)
      report.num(file, `${w}.gear.weight`, g.weight, { min: 0, name: 'weight' })
      if (g.def !== undefined) report.num(file, `${w}.gear.def`, g.def, { min: 0, name: 'def' })
      if (it.kind === 'weapon') {
        if (!isStr(g.weaponId)) report.error(file, `${w}.gear.weaponId`, '武器件必须指向 weapons.json 的 id')
        else if (!weaponIds.has(g.weaponId)) report.error(file, `${w}.gear.weaponId`, `悬空引用：'${g.weaponId}' 不在 weapons.json`)
      } else if (g.weaponId !== undefined) report.error(file, `${w}.gear.weaponId`, '只有武器件才写 weaponId')
      if (g.affixes !== undefined) strArray(file, `${w}.gear.affixes`, g.affixes, { nonEmpty: true })
      // 固定词缀要能落在这个槽位上：af_bellwarden 只给武器，写在胸甲上就是"永远掷不到"（KI-015 那次的镜像）
      if (isArr(g.affixes)) for (const aid of g.affixes) {
        if (!isStr(aid)) continue
        const def = affixDefs.get(aid)
        if (!def) { report.error(file, `${w}.gear.affixes`, `未知词缀 id：'${aid}' 不在 progression.json.affixes`); continue }
        if (def.slots && !def.slots.includes(g.slot)) report.error(file, `${w}.gear.affixes`, `'${aid}' 只能落在 ${def.slots.join('/')} 上，这件是 ${g.slot}`)
      }
      if (g.salvage !== undefined) report.sub(file, `${w}.gear.salvage`, g.salvage, { dross: { min: 0, int: true }, timbite: { min: 0, int: true } })
    }
    if (it.use !== undefined) {
      // heal=回血；corruption 写成负数=往下刮失谐。两者都不写就是「用了什么也没发生」，直接拦掉。
      report.sub(file, `${w}.use`, it.use, { heal: { min: 0, optional: true }, corruption: { max: -1, int: true, optional: true } })
      if (isObj(it.use)) {
        for (const k of Object.keys(it.use)) {
          if (k !== 'heal' && k !== 'corruption') report.error(file, `${w}.use.${k}`, '没有消费方（use 只认 heal/corruption）')
        }
        if (it.use.heal === undefined && it.use.corruption === undefined) {
          report.error(file, `${w}.use`, '必须至少写 heal 或 corruption，否则这个 use 没有消费方')
        }
      }
    }
    if (it.kind === 'consumable' && it.use === undefined) report.error(file, w, '消耗品必须写 use，否则它没有消费方')
  })
  // 每把武器都要有一件对应的装备件 —— 否则出身/RpgRuntime 找不到它（真会抛错）
  for (const wid of weaponIds) {
    const has = list.some((it) => it?.gear?.weaponId === wid)
    if (!has) report.error(file, 'weapons', `weapons.json 的 '${wid}' 没有对应的装备件（RpgRuntime 会因此抛错）`)
  }
  return ids
}

// ---- loot.json ----
function validateLoot(itemIds, rarityIds) {
  const file = 'loot.json'
  const list = data[file]
  const ids = new Set()
  if (!isArr(list)) { report.error(file, file, '顶层必须是数组'); return ids }
  const range = (where, v, name) => {
    if (!isArr(v) || v.length !== 2) { report.error(file, where, `${name} 必须是 [min, max] 两元素数组`); return }
    const ok = v.every((n, i) => report.num(file, `${where}[${i}]`, n, { min: 0, int: true, name }))
    if (ok && !(v[0] <= v[1])) report.error(file, where, `${name} 需 min <= max（${v[0]} / ${v[1]}）`)
  }
  const roll = (tableId, r, ri) => {
    const w = `${tableId}.rolls[${ri}]`
    if (!isObj(r)) { report.error(file, w, '必须是对象'); return }
    if (!isStr(r.id)) report.error(file, `${w}.id`, 'roll 必须有自己的 id')
    if (r.chance !== undefined) report.num(file, `${w}.chance`, r.chance, { min: 0, max: 1, name: 'chance' })
    if (r.weight !== undefined) report.num(file, `${w}.weight`, r.weight, { min: 0, name: 'weight' })
    const sources = ['item', 'xp', 'gearBand'].filter((k) => r[k] !== undefined)
    if (sources.length === 0) report.error(file, w, '至少要写 item / xp / gearBand 之一')
    if (sources.length > 1) report.error(file, w, `一条 roll 只能有一种来源，实际写了：${sources.join(' + ')}`)
    if (r.item !== undefined) {
      if (!isStr(r.item)) report.error(file, `${w}.item`, '必须是非空字符串')
      else if (!itemIds.has(r.item)) report.error(file, `${w}.item`, `悬空引用：'${r.item}' 不在 items.json`)
      if (r.count === undefined) report.error(file, `${w}.count`, 'item 条目必须写 count')
      else range(`${w}.count`, r.count, 'count')
    }
    if (r.xp !== undefined) {
      if (r.count !== undefined) report.error(file, `${w}.count`, 'xp 条目不应再写 count')
      range(`${w}.xp`, r.xp, 'xp')
    }
    if (r.gearBand !== undefined) {
      if (!isArr(r.gearBand) || r.gearBand.length === 0) report.error(file, `${w}.gearBand`, '必须是非空数组')
      else r.gearBand.forEach((b, bi) => {
        const bw = `${w}.gearBand[${bi}]`
        if (!isObj(b)) { report.error(file, bw, '必须是 { rarity, weight }'); return }
        if (!rarityIds.has(b.rarity)) report.error(file, `${bw}.rarity`, `未知稀有度：${b.rarity}（progression.json.rarity）`)
        report.num(file, `${bw}.weight`, b.weight, { min: 0, name: 'weight' })
      })
    }
    if (r.pity !== undefined) {
      report.num(file, `${w}.pity`, r.pity, { min: 2, int: true, name: 'pity' })
      // pity 的消费方是「这条 roll 连续没中」的计数：没有 chance 就永远掷得中，那一格计数是死数据
      if (r.chance === undefined) report.error(file, w, '写了 pity 就必须写 chance：必中条目不存在「没中」')
    }
  }
  list.forEach((t, i) => {
    if (!isObj(t)) { report.error(file, `[${i}]`, '必须是对象'); return }
    const w = isStr(t.id) ? t.id : `[${i}]`
    if (!isStr(t.id)) report.error(file, w, 'id 缺失或非字符串')
    else if (ids.has(t.id)) report.error(file, w, `id 重复：${t.id}`)
    else ids.add(t.id)
    if (!isArr(t.rolls) || t.rolls.length === 0) { report.error(file, w, 'rolls 必须是非空数组'); return }
    t.rolls.forEach((r, ri) => roll(w, r, ri))
    if (t.firstKill !== undefined) {
      if (!isArr(t.firstKill) || t.firstKill.length === 0) report.error(file, `${w}.firstKill`, '写了就必须是非空数组')
      else t.firstKill.forEach((r, ri) => roll(`${w}.firstKill`, r, ri))
    }
    // 逐条保底把计数存成 `${表id}:${roll id}`：同名就会让常规档和首杀档共用一格（互相吃掉对方的保底）
    const rollIds = [...(t.rolls ?? []), ...(t.firstKill ?? [])].map((r) => (isObj(r) ? r.id : undefined)).filter(isStr)
    const dup = rollIds.filter((id, k) => rollIds.indexOf(id) !== k)
    if (dup.length) report.error(file, w, `roll id 在同一张表里重复：${[...new Set(dup)].join('、')}（保底计数会串台）`)
  })
  return ids
}

// ---- enemies.json ----
/** 深度收集所有招式引用：任意 'attackId' 字符串字段 + 纯字符串数组的 'attacks' 字段 */
function collectAttackRefs(node, out, where = '') {
  if (isArr(node)) { node.forEach((v, i) => collectAttackRefs(v, out, `${where}[${i}]`)); return }
  if (!isObj(node)) return
  for (const [k, v] of Object.entries(node)) {
    const w = where ? `${where}.${k}` : k
    if (k === 'attackId' && typeof v === 'string') out.push({ where: w, id: v })
    else if (k === 'attacks' && isArr(v) && v.length > 0 && v.every((x) => typeof x === 'string')) {
      v.forEach((x, i) => out.push({ where: `${w}[${i}]`, id: x }))
    } else collectAttackRefs(v, out, w)
  }
}

function validateEnemies(lootIds) {
  const file = 'enemies.json'
  const list = data[file]
  const ids = new Set()
  if (!isArr(list)) { report.error(file, file, '顶层必须是数组'); return ids }
  list.forEach((e, i) => {
    if (!isObj(e)) { report.error(file, `[${i}]`, '必须是对象'); return }
    const w = isStr(e.id) ? e.id : `[${i}]`
    if (!isStr(e.id)) report.error(file, w, 'id 缺失或非字符串')
    else if (ids.has(e.id)) report.error(file, w, `id 重复：${e.id}`)
    else ids.add(e.id)
    if (!isStr(e.nameKey)) report.error(file, w, 'nameKey 缺失或非字符串')
    if (!ENEMY_ARCHETYPES.has(e.archetype)) report.error(file, w, `archetype=${JSON.stringify(e.archetype)} 非法`)
    report.num(file, `${w}.hp`, e.hp, { min: 1, name: 'hp' })
    report.num(file, `${w}.poise`, e.poise, { min: 0, name: 'poise' })
    report.num(file, `${w}.speed`, e.speed, { min: 0, name: 'speed' })
    if (e.defense !== undefined) report.num(file, `${w}.defense`, e.defense, { min: 0, name: 'defense' })
    // §11：震裂对材质的效果倍率标在敌人身上（铸出来的东西最怕同频敲击），不是状态表的全局量
    if (e.fissureMul !== undefined) report.num(file, `${w}.fissureMul`, e.fissureMul, { min: 0, name: 'fissureMul' })

    // ---- ai ----
    if (!isObj(e.ai)) report.error(file, `${w}.ai`, 'ai 缺失或不是对象')
    else {
      const ai = e.ai
      report.sub(file, `${w}.ai.vision`, ai.vision, { range: { min: 0 }, fovDeg: { min: 0, max: 360 } })
      report.sub(file, `${w}.ai.vibration`, ai.vibration, { range: { min: 0 } })
      report.sub(file, `${w}.ai.hearing`, ai.hearing, { range: { min: 0 } })
      if (!isArr(ai.distBands) || ai.distBands.length === 0) report.error(file, `${w}.ai.distBands`, '必须是非空数组')
      else ai.distBands.forEach((b, bi) => {
        const bw = `${w}.ai.distBands[${bi}]`
        if (!isObj(b)) { report.error(file, bw, '必须是对象'); return }
        const okMin = report.num(file, `${bw}.min`, b.min, { min: 0, name: 'min' })
        const okMax = report.num(file, `${bw}.max`, b.max, { min: 0, name: 'max' })
        if (okMin && okMax && !(b.min <= b.max)) report.error(file, bw, `距离带需 min <= max（${b.min} / ${b.max}）`)
        strArray(file, `${bw}.actions`, b.actions, { nonEmpty: true })
      })
      if (ai.kiteRange !== undefined) report.num(file, `${w}.ai.kiteRange`, ai.kiteRange, { min: 0, name: 'kiteRange' })
      if (ai.chaseBeyond !== undefined) report.num(file, `${w}.ai.chaseBeyond`, ai.chaseBeyond, { min: 0, name: 'chaseBeyond' })
      if (ai.retreatHpFrac !== undefined) report.num(file, `${w}.ai.retreatHpFrac`, ai.retreatHpFrac, { min: 0, max: 1, name: 'retreatHpFrac' })
      report.sub(file, `${w}.ai.callAlly`, ai.callAlly, { range: { min: 0 }, broadcastTicks: { min: 0, int: true } })
      report.sub(file, `${w}.ai.buffAura`, ai.buffAura, { range: { min: 0 }, attackSpeedMul: { min: 0 }, dmgMul: { min: 0 } })
      report.sub(file, `${w}.ai.offTuneOnDeath`, ai.offTuneOnDeath, { stunTicks: { min: 0, int: true }, resetAlertness: { bool: true } })
      report.sub(file, `${w}.ai.beatGhost`, ai.beatGhost, {
        intangibleWindowTicks: { min: 0, int: true }, dodgeRevealTicks: { min: 0, int: true }, dodgeStunTicks: { min: 0, int: true },
        fakeBeatRevealTicks: { min: 0, int: true }, fakeBeatLoudness: { min: 0 },
      })
      report.sub(file, `${w}.ai.huntsSound`, ai.huntsSound, { minLoudness: { min: 0 }, cooldownTicks: { min: 0, int: true }, maxRange: { min: 0 } })
      if (isObj(ai.huntsSound) && !isStr(ai.huntsSound.attackId)) report.error(file, `${w}.ai.huntsSound.attackId`, '缺失或非字符串')
      report.sub(file, `${w}.ai.hearsHeartbeat`, ai.hearsHeartbeat, { stillTicks: { min: 0, int: true }, decayPerSec: { min: 0 } })
      report.sub(file, `${w}.ai.armorFront`, ai.armorFront, { arcDeg: { min: 0, max: 360 }, dmgMul: { min: 0 } })
      report.sub(file, `${w}.ai.selfToll`, ai.selfToll, { everyBars: { min: 1, int: true }, heal: { min: 0 }, label: { str: true } })
      if (isObj(ai.selfToll) && !isStr(ai.selfToll.attackId)) report.error(file, `${w}.ai.selfToll.attackId`, '缺失或非字符串')
      if (ai.pickOrder !== undefined && !PICK_ORDERS.has(ai.pickOrder)) report.error(file, `${w}.ai.pickOrder`, `pickOrder=${JSON.stringify(ai.pickOrder)} 非法（random/cycle）`)
      if (ai.deaf !== undefined && typeof ai.deaf !== 'boolean') report.error(file, `${w}.ai.deaf`, '必须是布尔')
      if (ai.eyes !== undefined && typeof ai.eyes !== 'boolean') report.error(file, `${w}.ai.eyes`, '必须是布尔')
    }

    // ---- attacks（先建 id 集合，引用统一在下面解析）----
    const attackIds = new Set()
    const refs = [] // { where, id }
    const nextRefs = []
    if (!isArr(e.attacks) || e.attacks.length === 0) report.error(file, `${w}.attacks`, '必须是非空数组')
    else e.attacks.forEach((a, ai) => {
      const aw = `${w}.attacks.${isStr(a?.id) ? a.id : `[${ai}]`}`
      if (!isObj(a)) { report.error(file, aw, '必须是对象'); return }
      if (!isStr(a.id)) report.error(file, aw, 'id 缺失或非字符串')
      else if (attackIds.has(a.id)) report.error(file, aw, `招式 id 重复：${a.id}`)
      else attackIds.add(a.id)
      if (!isArr(a.beat) || a.beat.length === 0) report.error(file, `${aw}.beat`, 'beat 必须是非空数组')
      else a.beat.forEach((b, bi) => report.num(file, `${aw}.beat[${bi}]`, b, { min: 0, name: 'beat' }))
      if (typeof a.parryable !== 'boolean') report.error(file, `${aw}.parryable`, '必须是布尔')
      if (a.reaction !== undefined && !REACTIONS.has(a.reaction)) report.error(file, `${aw}.reaction`, `reaction=${JSON.stringify(a.reaction)} 非法`)
      if (a.parryStunTicks !== undefined) report.num(file, `${aw}.parryStunTicks`, a.parryStunTicks, { min: 0, int: true, name: 'parryStunTicks' })
      if (a.onGrid !== undefined && typeof a.onGrid !== 'boolean') report.error(file, `${aw}.onGrid`, '必须是布尔')
      if (a.reclaimWindow !== undefined && typeof a.reclaimWindow !== 'boolean') report.error(file, `${aw}.reclaimWindow`, '必须是布尔')
      if (a.statusOnHit !== undefined) {
        const st = a.statusOnHit
        if (!isObj(st)) report.error(file, `${aw}.statusOnHit`, '必须是对象')
        else {
          if (!isStr(st.tag)) report.error(file, `${aw}.statusOnHit.tag`, '缺失或非字符串')
          report.num(file, `${aw}.statusOnHit.layers`, st.layers, { min: 1, int: true, name: 'layers' })
          const isMute = isStr(st.tag) && MUTE_TAG.test(st.tag)
          if (isMute && st.ticks === undefined) {
            report.error(file, `${aw}.statusOnHit`, `闷音类 tag '${st.tag}' 必须声明 ticks（历史上闷音从未生效的坑）`)
          } else if (st.ticks !== undefined) {
            report.num(file, `${aw}.statusOnHit.ticks`, st.ticks, { min: 1, int: true, name: 'ticks' })
          }
          // 跨文件闸：tag 的末段必须是 statuses.json 里真实存在的一行
          if (isStr(st.tag)) {
            const id = st.tag.split('.').pop() ?? ''
            const sts = data['statuses.json']
            if (!STATUS_IDS.includes(id)) report.error(file, `${aw}.statusOnHit.tag`, `'${st.tag}' 不是五状态之一（${STATUS_IDS.join('/')}）`)
            else if (isObj(sts) && !isObj(sts[id])) report.error(file, `${aw}.statusOnHit.tag`, `statuses.json 缺 '${id}' 这一行`)
            else if (isObj(sts) && isNum(sts[id]?.maxLayers) && isNum(st.layers) && st.layers > sts[id].maxLayers) {
              report.error(file, `${aw}.statusOnHit.layers`, `一记就叠 ${st.layers} 层，超过 ${id}.maxLayers=${sts[id].maxLayers}：上限会被静默吃掉`)
            }
          }
        }
      }
      const nx = attackFrames(file, aw, a)
      if (nx !== undefined) {
        if (!isStr(nx)) report.error(file, `${aw}.frames.next`, '必须是非空字符串')
        else nextRefs.push({ where: `${aw}.frames.next`, id: nx })
      }
    })

    // ---- 距离带动作：伪动作放行，其余必须是本敌人的招式 ----
    if (isObj(e.ai) && isArr(e.ai.distBands)) {
      e.ai.distBands.forEach((b, bi) => {
        if (!isObj(b) || !isArr(b.actions)) return
        b.actions.forEach((act, ai2) => {
          if (typeof act !== 'string') return
          if (PSEUDO_ACTIONS.has(act)) return
          refs.push({ where: `${w}.ai.distBands[${bi}].actions[${ai2}]`, id: act })
        })
      })
    }

    // ---- boss ----
    if (e.boss !== undefined) {
      const b = e.boss
      if (!isObj(b)) report.error(file, `${w}.boss`, '必须是对象')
      else {
        if (b.bpm !== undefined) report.num(file, `${w}.boss.bpm`, b.bpm, { min: 0, name: 'bpm' })
        if (b.beatsPerBar !== undefined) report.num(file, `${w}.boss.beatsPerBar`, b.beatsPerBar, { min: 1, int: true, name: 'beatsPerBar' })
        // §15.1/§10 那一嗓子的两件时长。省略只对**单阶段** Boss 合法（她永远跳不了阶 ⇒ 没有消费者）；
        // 多阶段而不写 = 转阶段演出会静默变成哑巴，所以这里挡下来（KI-017 第四步）。
        // 这一格**必须独立于**下面的阶段循环、且不得带 `else`：第一版把它并进了那条 if/else 链，
        // 结果凡是写了 roar 的 Boss 整个 `phases[]` 都不再被校验（反向实测当场抓到）。
        if (b.roar !== undefined) report.sub(file, `${w}.boss.roar`, b.roar, { hitStopMs: { min: 0 }, muffleMs: { min: 0 } })
        else if (isArr(b.phases) && b.phases.length > 1) report.error(file, `${w}.boss.roar`, `${b.phases.length} 个阶段 ⇒ 会跳阶，必须写那一嗓子的时长`)
        if (!isArr(b.phases) || b.phases.length === 0) report.error(file, `${w}.boss.phases`, '必须是非空数组')
        else {
          const phaseIds = new Set()
          b.phases.forEach((ph, pi) => {
            const pw = `${w}.boss.phases[${pi}]`
            if (!isObj(ph)) { report.error(file, pw, '必须是对象'); return }
            if (!isStr(ph.id)) report.error(file, pw, '阶段 id 缺失或非字符串')
            else if (phaseIds.has(ph.id)) report.error(file, pw, `阶段 id 重复：${ph.id}`)
            else phaseIds.add(ph.id)
            if (!isArr(ph.attacks) || ph.attacks.length === 0) report.error(file, `${pw}.attacks`, '阶段招式白名单必须是非空数组')
            if (ph.belowHpFrac !== undefined) report.num(file, `${pw}.belowHpFrac`, ph.belowHpFrac, { min: 0, max: 1, name: 'belowHpFrac' })
            if (ph.shell !== undefined) {
              report.sub(file, `${pw}.shell`, ph.shell, { dmgMul: { min: 0 }, fissureMul: { min: 0, optional: true } })
              if (isObj(ph.shell) && typeof ph.shell.immuneToPoise !== 'boolean') report.error(file, `${pw}.shell.immuneToPoise`, '必须是布尔')
            }
            if (ph.stealBeat !== undefined) {
              const sb = ph.stealBeat
              report.sub(file, `${pw}.stealBeat`, sb, { bpmDrift: { min: 0 }, reDriftEveryTicks: { min: 1, int: true }, staRegenMul: { min: 0 }, dodgeJitterTicks: { min: 0, int: true } })
              if (isObj(sb)) report.sub(file, `${pw}.stealBeat.reclaim`, sb.reclaim, { neutralTicks: { min: 0, int: true }, overdrive: { min: 0 }, hitStopMs: { min: 0 } })
            }
            report.sub(file, `${pw}.barCast`, ph.barCast, { everyBars: { min: 1, int: true }, heal: { min: 0, optional: true }, label: { str: true } })
            if (isObj(ph.barCast) && !isStr(ph.barCast.attackId)) report.error(file, `${pw}.barCast.attackId`, '缺失或非字符串')
          })
        }
        if (b.bells !== undefined) {
          const bells = b.bells
          if (!isObj(bells)) report.error(file, `${w}.boss.bells`, '必须是对象')
          else {
            if (!isArr(bells.positions) || bells.positions.length === 0) report.error(file, `${w}.boss.bells.positions`, '必须是非空数组')
            else bells.positions.forEach((pos, pi) => vec3(file, `${w}.boss.bells.positions[${pi}]`, pos))
            report.sub(file, `${w}.boss.bells`, bells, { hitRadius: { min: 0 }, releaseTicks: { min: 0, int: true }, breaksAt: { min: 1, int: true }, resonanceRadius: { min: 0 }, damagePerBeat: { min: 0 } })
          }
        }
        if (b.covers !== undefined) {
          const cov = b.covers
          if (!isObj(cov)) report.error(file, `${w}.boss.covers`, '必须是对象')
          else {
            if (!isArr(cov.positions) || cov.positions.length === 0) report.error(file, `${w}.boss.covers.positions`, '必须是非空数组')
            else cov.positions.forEach((pos, pi) => vec3(file, `${w}.boss.covers.positions[${pi}]`, pos))
            report.sub(file, `${w}.boss.covers`, cov, { radius: { min: 0 } })
          }
        }
        // §16「Boss 均带 3 拍入场演出 + 胜利序列（音乐停=世界屏息）」：少了这两格，她就只是
        // 一具更厚的怪。上限是防呆：入场超过 8 拍（>4s）就变成站着挨打，屏息超过 180 tick 变成卡死。
        const SHOW = { intro: { beats: { min: 1, max: 8, int: true }, label: { str: true, optional: true } }, victory: { holdTicks: { min: 1, max: 180, int: true }, label: { str: true, optional: true } } }
        for (const [k, spec] of Object.entries(SHOW)) {
          if (!isObj(b[k])) { report.error(file, `${w}.boss.${k}`, `缺失：§16 要求 Boss 均带${k === 'intro' ? '入场演出' : '胜利序列'}`); continue }
          report.sub(file, `${w}.boss.${k}`, b[k], spec)
          if (b[k].sfx !== undefined) strArray(file, `${w}.boss.${k}.sfx`, b[k].sfx)
        }
      }
    }

    // ---- 引用解析（本敌人的招式闭包）----
    collectAttackRefs(e.ai ?? {}, refs)
    if (isObj(e.boss)) collectAttackRefs(e.boss, refs)
    for (const ref of refs) {
      if (!attackIds.has(ref.id)) report.error(file, ref.where, `招式悬空引用：'${ref.id}' 不在 ${w} 自己的 attacks 里`)
    }
    for (const ref of nextRefs) {
      if (!attackIds.has(ref.id)) report.error(file, ref.where, `frames.next 悬空引用：'${ref.id}' 不在 ${w} 自己的 attacks 里`)
    }

    // ---- 其余字段 ----
    if (e.weakpoint !== undefined) report.sub(file, `${w}.weakpoint`, e.weakpoint, { dmgMul: { min: 0 } })
    if (e.drops !== undefined) {
      if (!isArr(e.drops)) report.error(file, `${w}.drops`, '必须是数组')
      else e.drops.forEach((d, di) => {
        const dw = `${w}.drops[${di}]`
        if (!isObj(d)) { report.error(file, dw, '必须是对象'); return }
        if (!isStr(d.tableId)) report.error(file, `${dw}.tableId`, '缺失或非字符串')
        else if (!lootIds.has(d.tableId)) report.error(file, dw, `tableId 悬空引用：'${d.tableId}' 不在 loot.json`)
        report.num(file, `${dw}.chance`, d.chance, { min: 0, max: 1, name: 'chance' })
      })
    }
    if (e.body !== undefined) {
      const bd = e.body
      if (!isObj(bd)) report.error(file, `${w}.body`, '必须是对象')
      else {
        report.num(file, `${w}.body.scale`, bd.scale, { min: 0, name: 'scale' })
        for (const k of ['color', 'emissive', 'coreColor']) {
          if (!isColorValue(bd[k])) report.error(file, `${w}.body.${k}`, `${k} 必须是合法颜色（hex 字符串或 0x000000~0xFFFFFF 整数），实为 ${JSON.stringify(bd[k])}`)
        }
      }
    }
    if (e.tint !== undefined && !isStr(e.tint)) report.error(file, `${w}.tint`, '必须是非空字符串')
  })
  return ids
}

// ---- regions.json ----
function navmeshExists(ref) {
  const roots = ['src/world/navmesh', 'src/data/navmesh', 'assets/navmesh', 'public/navmesh']
  const suffixes = ['', '.json', '.bin']
  return roots.some((root) => suffixes.some((s) => existsSync(resolve(ROOT, root, ref + s))))
}

function validateRegions(enemyIds, lootIds) {
  const file = 'regions.json'
  const list = data[file]
  const ids = new Set()
  const landmarkIds = new Set()
  const interactableIds = new Set()
  const secretIds = new Set()
  const orders = new Map()
  if (!isArr(list)) { report.error(file, file, '顶层必须是数组'); return ids }
  list.forEach((rg, i) => {
    if (!isObj(rg)) { report.error(file, `[${i}]`, '必须是对象'); return }
    const w = isStr(rg.id) ? rg.id : `[${i}]`
    if (!isStr(rg.id)) report.error(file, w, 'id 缺失或非字符串')
    else if (ids.has(rg.id)) report.error(file, w, `id 重复：${rg.id}`)
    else ids.add(rg.id)
    if (!isStr(rg.nameKey)) report.error(file, w, 'nameKey 缺失或非字符串')
    if (!isStr(rg.displayName)) report.error(file, w, 'displayName 缺失或非字符串')
    if (!BIOMES.has(rg.biome)) report.error(file, w, `biome=${JSON.stringify(rg.biome)} 非法`)
    if (report.num(file, `${w}.order`, rg.order, { min: 0, int: true, name: 'order' })) {
      if (orders.has(rg.order)) report.warn(file, `${w}.order`, `order=${rg.order} 与 ${orders.get(rg.order)} 重复`)
      else orders.set(rg.order, w)
    }

    // bounds
    if (!isObj(rg.bounds)) report.error(file, `${w}.bounds`, '必须是对象')
    else {
      const b = rg.bounds
      const ok = {}
      for (const k of ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ']) ok[k] = report.num(file, `${w}.bounds.${k}`, b[k], { name: k })
      for (const [lo, hi] of [['minX', 'maxX'], ['minY', 'maxY'], ['minZ', 'maxZ']]) {
        if (ok[lo] && ok[hi] && !(b[lo] <= b[hi])) report.error(file, `${w}.bounds`, `需 ${lo} <= ${hi}（${b[lo]} / ${b[hi]}）`)
      }
    }
    report.num(file, `${w}.groundY`, rg.groundY, { name: 'groundY' })

    // grid：必填且为正数（省略会悄悄退回硬编码 84）
    if (!isObj(rg.grid)) report.error(file, `${w}.grid`, 'grid 必填且必须是对象（省略会退回硬编码 84）')
    else {
      report.num(file, `${w}.grid.bpm`, rg.grid.bpm, { min: 1, name: 'bpm' })
      report.num(file, `${w}.grid.beatsPerBar`, rg.grid.beatsPerBar, { min: 1, int: true, name: 'beatsPerBar' })
      if (rg.grid.label !== undefined && !isStr(rg.grid.label)) report.error(file, `${w}.grid.label`, '必须是非空字符串')
    }

    report.num(file, `${w}.chunkSize`, rg.chunkSize, { min: 1, name: 'chunkSize' })
    strArray(file, `${w}.weatherPresets`, rg.weatherPresets, { nonEmpty: true })
    if (!isStr(rg.lightingPreset)) report.error(file, `${w}.lightingPreset`, '缺失或非字符串')

    // palette：三项必须是合法 hex
    if (!isObj(rg.palette)) report.error(file, `${w}.palette`, '必须是对象')
    else for (const k of ['base', 'accent', 'glow']) {
      if (!isHex(rg.palette[k])) report.error(file, `${w}.palette.${k}`, `${k} 必须是合法 hex 颜色（#RGB 或 #RRGGBB），实为 ${JSON.stringify(rg.palette[k])}`)
    }

    // spawnGroups
    if (!isArr(rg.spawnGroups)) report.error(file, `${w}.spawnGroups`, '必须是数组')
    else rg.spawnGroups.forEach((g, gi) => {
      const gw = `${w}.spawnGroups[${gi}]`
      if (!isObj(g)) { report.error(file, gw, '必须是对象'); return }
      if (!isStr(g.enemyId)) report.error(file, `${gw}.enemyId`, '缺失或非字符串')
      else if (!enemyIds.has(g.enemyId)) report.error(file, gw, `enemyId 悬空引用：'${g.enemyId}' 不在 enemies.json`)
      report.num(file, `${gw}.count`, g.count, { min: 1, int: true, name: 'count' })
      vec3(file, `${gw}.center`, g.center)
      report.num(file, `${gw}.radius`, g.radius, { min: 0, name: 'radius' })
      if (g.campId !== undefined && !isStr(g.campId)) report.error(file, `${gw}.campId`, '必须是非空字符串')
      if (g.condition !== undefined && !isStr(g.condition)) report.error(file, `${gw}.condition`, '必须是非空字符串')
    })

    // landmarks
    if (!isArr(rg.landmarks)) report.error(file, `${w}.landmarks`, '必须是数组')
    else rg.landmarks.forEach((lm, li) => {
      const lw = `${w}.landmarks[${li}]`
      if (!isObj(lm)) { report.error(file, lw, '必须是对象'); return }
      if (!isStr(lm.id)) report.error(file, lw, 'id 缺失或非字符串')
      else if (landmarkIds.has(lm.id)) report.error(file, lw, `landmark id 重复：${lm.id}`)
      else landmarkIds.add(lm.id)
      if (!isStr(lm.nameKey)) report.error(file, `${lw}.nameKey`, '缺失或非字符串')
      vec3(file, `${lw}.pos`, lm.pos)
      report.num(file, `${lw}.sightRange`, lm.sightRange, { min: 0, name: 'sightRange' })
    })

    // interactables
    if (!isArr(rg.interactables)) report.error(file, `${w}.interactables`, '必须是数组')
    else rg.interactables.forEach((it, ii) => {
      const iw = `${w}.interactables[${ii}]`
      if (!isObj(it)) { report.error(file, iw, '必须是对象'); return }
      if (!isStr(it.id)) report.error(file, iw, 'id 缺失或非字符串')
      else if (interactableIds.has(it.id)) report.error(file, iw, `interactable id 重复：${it.id}`)
      else interactableIds.add(it.id)
      if (!INTERACTABLE_KINDS.has(it.kind)) report.error(file, `${iw}.kind`, `kind=${JSON.stringify(it.kind)} 非法`)
      vec3(file, `${iw}.pos`, it.pos)
      if (it.verb !== undefined && !isStr(it.verb)) report.error(file, `${iw}.verb`, '必须是非空字符串')
      if (it.oneWay !== undefined && typeof it.oneWay !== 'boolean') report.error(file, `${iw}.oneWay`, '必须是布尔')
      for (const k of ['requiresFlag', 'setsFlag', 'npcId']) if (it[k] !== undefined && !isStr(it[k])) report.error(file, `${iw}.${k}`, '必须是非空字符串')
      if (it.to !== undefined) vec3(file, `${iw}.to`, it.to)
      if (it.kind === 'npc' && !isStr(it.npcId)) report.warn(file, iw, `kind=npc 但没有 npcId`)
    })

    // music
    if (!isObj(rg.music)) report.error(file, `${w}.music`, '必须是对象')
    else for (const k of ['explore', 'battle', 'ambience']) {
      if (!isStr(rg.music[k])) report.error(file, `${w}.music.${k}`, '缺失或非字符串')
    }

    report.num(file, `${w}.streamingPriority`, rg.streamingPriority, { name: 'streamingPriority' })
    if (rg.preloadWhole !== undefined && typeof rg.preloadWhole !== 'boolean') report.error(file, `${w}.preloadWhole`, '必须是布尔')
    // 失谐渗漏格：写了就必须是正数（0 会做出「看着像机制、实际什么都不做」的区域）
    if (rg.corruption !== undefined) report.sub(file, `${w}.corruption`, rg.corruption, { perSec: { min: 0.0001 } })
    if (rg.unlockFlag !== undefined && !isStr(rg.unlockFlag)) report.error(file, `${w}.unlockFlag`, '必须是非空字符串')

    // navmeshRef：写了就必须有对应实体；不写不算错（KI-009）
    if (rg.navmeshRef !== undefined) {
      if (!isStr(rg.navmeshRef)) report.error(file, `${w}.navmeshRef`, '必须是非空字符串')
      else if (!navmeshExists(rg.navmeshRef)) report.error(file, `${w}.navmeshRef`, `写了 '${rg.navmeshRef}' 但找不到对应导航网格实体（KI-009：留空即可）`)
    }

    // secrets
    if (!isArr(rg.secrets)) report.error(file, `${w}.secrets`, '必须是数组')
    else rg.secrets.forEach((s, si) => {
      const sw = `${w}.secrets[${si}]`
      if (!isObj(s)) { report.error(file, sw, '必须是对象'); return }
      if (!isStr(s.id)) report.error(file, sw, 'id 缺失或非字符串')
      else if (secretIds.has(s.id)) report.error(file, sw, `secret id 重复：${s.id}`)
      else secretIds.add(s.id)
      if (!isStr(s.unlockFlag)) report.error(file, `${sw}.unlockFlag`, '缺失或非字符串')
      if (!isStr(s.rewardTable)) report.error(file, `${sw}.rewardTable`, '缺失或非字符串')
      else if (!lootIds.has(s.rewardTable)) report.error(file, sw, `rewardTable 悬空引用：'${s.rewardTable}' 不在 loot.json`)
      vec3(file, `${sw}.pos`, s.pos)
    })

    strArray(file, `${w}.storyHooks`, rg.storyHooks)
  })
  return ids
}

// ---- movements.json ----
/** loot.json 里真正会掉出来的物品全集（rolls + firstKill）。点亮源必须落在这里面，否则那一页永远点不亮 */
function lootedItemIds() {
  const out = new Set()
  const list = data['loot.json']
  if (!isArr(list)) return out
  for (const t of list) {
    if (!isObj(t)) continue
    const rows = [...(isArr(t.rolls) ? t.rolls : []), ...(isArr(t.firstKill) ? t.firstKill : [])]
    for (const r of rows) if (isObj(r) && isStr(r.item)) out.add(r.item)
  }
  return out
}

function validateMovements(itemIds) {
  const file = 'movements.json'
  const d = data[file]
  if (!isObj(d)) { report.error(file, file, '顶层必须是对象'); return }
  const { slots, pages, movements, upgradeCost, damage } = d
  for (const k of Object.keys(d)) {
    if (!['slots', 'pages', 'movements', 'upgradeCost', 'damage'].includes(k)) report.error(file, k, '不认的顶层字段（§55）')
  }

  // 主动槽：开槽门槛只住 progression.json.milestones，这里引用 id，不抄第二份数字
  const mileIds = new Set((isObj(data['progression.json']) ? data['progression.json'].milestones ?? [] : []).filter(isObj).map((m) => m.id))
  if (!isArr(slots) || slots.length === 0) report.error(file, 'slots', '必须是非空数组')
  else {
    const acts = new Set()
    slots.forEach((s, i) => {
      const w = `slots[${i}]`
      if (!isObj(s)) { report.error(file, w, '必须是对象'); return }
      for (const k of Object.keys(s)) if (!['index', 'action', 'milestone'].includes(k)) report.error(file, `${w}.${k}`, '不认的字段（§55）')
      report.num(file, `${w}.index`, s.index, { min: 1, int: true, name: 'index' })
      if (isNum(s.index) && s.index !== i + 1) report.error(file, `${w}.index`, `槽序号必须从 1 连续：期望 ${i + 1}，实际 ${s.index}`)
      if (!MOVEMENT_ACTIONS.has(s.action)) report.error(file, `${w}.action`, `action=${JSON.stringify(s.action)} 不是战技动作（${[...MOVEMENT_ACTIONS].join('/')}；新槽要先在 core/Input.ts 登记）`)
      else if (acts.has(s.action)) report.error(file, w, `动作重复绑定：${s.action}`)
      else acts.add(s.action)
      if (!isStr(s.milestone)) report.error(file, `${w}.milestone`, '缺失或非字符串')
      else if (!mileIds.has(s.milestone)) report.error(file, `${w}.milestone`, `悬空引用：'${s.milestone}' 不在 progression.json.milestones`)
    })
  }

  const pageIds = new Set()
  if (!isArr(pages) || pages.length === 0) report.error(file, 'pages', '必须是非空数组')
  else {
    const lootable = lootedItemIds()
    pages.forEach((p, i) => {
      const w = isStr(p?.id) ? p.id : `pages[${i}]`
      if (!isObj(p)) { report.error(file, w, '必须是对象'); return }
      if (!isStr(p.id)) report.error(file, w, 'id 缺失或非字符串')
      else if (pageIds.has(p.id)) report.error(file, w, `id 重复：${p.id}`)
      else pageIds.add(p.id)
      for (const k of Object.keys(p)) if (!['id', 'nameKey', 'displayName', 'desc', 'unlock'].includes(k)) report.error(file, `${w}.${k}`, '不认的字段（§55）')
      if (!isStr(p.nameKey)) report.error(file, `${w}.nameKey`, '必填')
      if (!isStr(p.displayName)) report.error(file, `${w}.displayName`, '必填')
      if (!isStr(p.desc) || p.desc.length < 5) report.error(file, `${w}.desc`, '需要一句世界内解释（§19）')
      if (!isObj(p.unlock)) report.error(file, `${w}.unlock`, '必须是 { item, count } —— 点亮源写在数据里，不是代码里的 if')
      else {
        for (const k of Object.keys(p.unlock)) if (k !== 'item' && k !== 'count') report.error(file, `${w}.unlock.${k}`, '不认的字段（§55）')
        if (!isStr(p.unlock.item)) report.error(file, `${w}.unlock.item`, '必填')
        else {
          if (!itemIds.has(p.unlock.item)) report.error(file, `${w}.unlock.item`, `悬空引用：'${p.unlock.item}' 不在 items.json`)
          else if (!lootable.has(p.unlock.item)) report.error(file, `${w}.unlock.item`, `没有任何掉落表给出 '${p.unlock.item}'：这一页永远点不亮（unreachable content）`)
        }
        report.num(file, `${w}.unlock.count`, p.unlock.count, { min: 1, int: true, name: 'count' })
      }
    })
  }

  // 升级阶梯（全表共用一条：§6.2 战技乐谱 40-200/级）
  let ladder = 0
  if (!isArr(upgradeCost) || upgradeCost.length === 0) report.error(file, 'upgradeCost', '必须是非空数组')
  else {
    upgradeCost.forEach((u, i) => {
      const w = `upgradeCost[${i}]`
      if (!isObj(u)) { report.error(file, w, '必须是对象'); return }
      for (const k of Object.keys(u)) if (!['level', 'timbite', 'score'].includes(k)) report.error(file, `${w}.${k}`, '不认的字段（§55）')
      report.num(file, `${w}.level`, u.level, { min: 2, int: true, name: 'level' })
      if (isNum(u.level) && u.level !== i + 2) report.error(file, `${w}.level`, `level 必须从 2 连续：期望 ${i + 2}，实际 ${u.level}`)
      report.num(file, `${w}.timbite`, u.timbite, { min: 1, int: true, name: 'timbite' })
      report.num(file, `${w}.score`, u.score, { min: 1, int: true, name: 'score' })
    })
    ladder = upgradeCost.length + 1
  }

  if (!isObj(damage)) report.error(file, 'damage', '必须是 { scaling, perOverdriveLayer }')
  else {
    for (const k of Object.keys(damage)) if (!['scaling', 'perOverdriveLayer'].includes(k)) report.error(file, `damage.${k}`, '不认的字段（§55）')
    if (!isObj(damage.scaling) || Object.keys(damage.scaling).length === 0) report.error(file, 'damage.scaling', '必须是非空对象（§2.1 音色列）')
    else for (const [k, v] of Object.entries(damage.scaling)) {
      if (!ATTR_KEYS.has(k)) report.error(file, `damage.scaling.${k}`, `未知属性键 '${k}'（${[...ATTR_KEYS].join('/')}）`)
      else report.num(file, `damage.scaling.${k}`, v, { min: 0, name: k })
    }
    report.num(file, 'damage.perOverdriveLayer', damage.perOverdriveLayer, { min: 0, name: 'perOverdriveLayer' })
    if (isNum(damage.perOverdriveLayer) && damage.perOverdriveLayer >= 1) {
      report.error(file, 'damage.perOverdriveLayer', `每层 +${damage.perOverdriveLayer} >= 100%：满过载就是倍率怪物，请回到 0.x`)
    }
  }

  if (!isArr(movements) || movements.length === 0) { report.error(file, 'movements', '必须是非空数组'); return }
  const ids = new Set()
  movements.forEach((m, i) => {
    const w = isStr(m?.id) ? m.id : `movements[${i}]`
    if (!isObj(m)) { report.error(file, w, '必须是对象'); return }
    if (!isStr(m.id)) report.error(file, w, 'id 缺失或非字符串')
    else if (ids.has(m.id)) report.error(file, w, `id 重复：${m.id}`)
    else ids.add(m.id)
    for (const k of Object.keys(m)) if (!['id', 'page', 'nameKey', 'displayName', 'desc', 'cost', 'frame', 'levels', 'landing'].includes(k)) report.error(file, `${w}.${k}`, '不认的字段（§55）')
    // 落地窗口（§7.2 错拍步）：没有位移就没有"落地"，这一格就成了没人能触发的死数据
    if (m.landing !== undefined) {
      if (!isObj(m.landing)) report.error(file, `${w}.landing`, '必须是 { poise, withinTicks }')
      else {
        for (const k of Object.keys(m.landing)) if (!['poise', 'withinTicks'].includes(k)) report.error(file, `${w}.landing.${k}`, '不认的字段（§55）')
        report.num(file, `${w}.landing.poise`, m.landing.poise, { min: 0.1, name: 'poise' })
        report.num(file, `${w}.landing.withinTicks`, m.landing.withinTicks, { min: 1, int: true, name: 'withinTicks' })
      }
      if (!(isArr(m.levels) && m.levels.some((l) => isObj(l) && l.distance !== undefined))) {
        report.error(file, `${w}.landing`, '写了落地窗口但这一式没有 distance ⇒ 永远触发不了')
      }
    }
    if (!isStr(m.nameKey)) report.error(file, `${w}.nameKey`, '必填')
    if (!isStr(m.displayName)) report.error(file, `${w}.displayName`, '必填')
    if (!isStr(m.desc) || m.desc.length < 5) report.error(file, `${w}.desc`, '需要一句世界内解释（§19）')
    if (!isStr(m.page)) report.error(file, `${w}.page`, '缺失或非字符串（点亮源住在页上）')
    else if (!pageIds.has(m.page)) report.error(file, `${w}.page`, `悬空引用：'${m.page}' 不在 pages`)

    if (!isObj(m.cost)) report.error(file, `${w}.cost`, '必须是 { stamina?, overdrive? }')
    else {
      for (const k of Object.keys(m.cost)) if (!['stamina', 'overdrive', 'overdriveRamp'].includes(k)) report.error(file, `${w}.cost.${k}`, '不认的字段（§55）')
      report.sub(file, `${w}.cost`, m.cost, { stamina: { min: 1, int: true, optional: true }, overdrive: { min: 1, int: true, optional: true }, overdriveRamp: { min: 1, int: true, optional: true } })
      if (Object.keys(m.cost).length === 0) report.error(file, `${w}.cost`, '一条战技至少要有一种代价（体力或过载），否则它没有消费方')
      // 涨价是挂在过载价上的一截利息：没有底价就没有可涨的东西，那一格就成了没人付的死数据
      if (m.cost.overdriveRamp !== undefined && !isNum(m.cost.overdrive)) {
        report.error(file, `${w}.cost.overdriveRamp`, '连打涨价需要 overdrive 底价：没有过载价可涨')
      }
    }

    const fr = m.frame
    if (!isObj(fr)) { report.error(file, `${w}.frame`, '必须是对象'); return }
    for (const k of Object.keys(fr)) if (!MOVE_FRAME_FIELDS.includes(k)) report.error(file, `${w}.frame.${k}`, `不认的字段（本表可用：${MOVE_FRAME_FIELDS.join('/')}）`)
    for (const k of ['startup', 'activeStart', 'activeEnd', 'recovery']) report.num(file, `${w}.frame.${k}`, fr[k], { min: 0, name: k })
    const { startup, activeStart, activeEnd, recovery } = fr
    if ([startup, activeStart, activeEnd, recovery].every(isNum)
      && !(startup <= activeStart && activeStart <= activeEnd && activeEnd <= recovery)) {
      report.error(file, `${w}.frame`, `帧序非法：需 startup(${startup}) <= activeStart(${activeStart}) <= activeEnd(${activeEnd}) <= recovery(${recovery})`)
    }
    if (fr.poise !== undefined) report.num(file, `${w}.frame.poise`, fr.poise, { min: 0, name: 'poise' })
    if (fr.hitStopMs !== undefined) report.num(file, `${w}.frame.hitStopMs`, fr.hitStopMs, { min: 0, name: 'hitStopMs' })
    if (fr.loudness !== undefined) report.num(file, `${w}.frame.loudness`, fr.loudness, { min: 0, name: 'loudness' })
    if (fr.shake !== undefined && !SHAKES.has(fr.shake)) report.error(file, `${w}.frame.shake`, `shake=${JSON.stringify(fr.shake)} 非法`)
    for (const k of ['sfx', 'vfx']) if (fr[k] !== undefined) strArray(file, `${w}.frame.${k}`, fr[k])
    if (fr.hitbox !== undefined) hitbox(file, `${w}.frame.hitbox`, fr.hitbox)
    if (fr.multi !== undefined) {
      report.num(file, `${w}.frame.multi`, fr.multi, { min: 2, int: true, name: 'multi' })
      if (!isObj(fr.hitbox)) report.error(file, `${w}.frame.multi`, 'multi 需要 hitbox：没有形状就打不出第二个人')
    }

    if (!isArr(m.levels) || m.levels.length === 0) { report.error(file, `${w}.levels`, '必须是非空数组'); return }
    if (ladder > 0 && m.levels.length !== ladder) {
      report.error(file, `${w}.levels`, `共 ${m.levels.length} 级，但 upgradeCost 只有 ${ladder - 1} 档（上限 L${ladder}）：两边必须对齐，否则要么有一级没有价目，要么有一个价目没人付`)
    }
    const cds = []
    m.levels.forEach((l, li) => {
      const lw = `${w}.levels[${li}]`
      if (!isObj(l)) { report.error(file, lw, '必须是对象'); return }
      for (const k of Object.keys(l)) if (!MOVE_LEVEL_FIELDS.includes(k)) report.error(file, `${lw}.${k}`, `不认的字段（本表可用：${MOVE_LEVEL_FIELDS.join('/')}）`)
      const okCd = report.num(file, `${lw}.cooldownTicks`, l.cooldownTicks, { min: 1, int: true, name: 'cooldownTicks' })
      if (okCd) cds.push(l.cooldownTicks)
      if (l.damage !== undefined) {
        report.num(file, `${lw}.damage`, l.damage, { min: 0, name: 'damage' })
        if (!isObj(fr.hitbox)) report.error(file, `${lw}.damage`, `这一式没有 hitbox，damage 永远打不出去（要挂在别的招上请写 trueDamage）`)
      }
      if (l.trueDamage !== undefined) report.num(file, `${lw}.trueDamage`, l.trueDamage, { min: 1, name: 'trueDamage' })
      if (l.fissureLayers !== undefined) report.num(file, `${lw}.fissureLayers`, l.fissureLayers, { min: 1, int: true, name: 'fissureLayers' })
      if (l.muteTicks !== undefined) report.num(file, `${lw}.muteTicks`, l.muteTicks, { min: 1, int: true, name: 'muteTicks' })
      if (l.distance !== undefined) report.num(file, `${lw}.distance`, l.distance, { min: 0.1, name: 'distance' })
      if (l.freezeTicks !== undefined) {
        report.num(file, `${lw}.freezeTicks`, l.freezeTicks, { min: 1, int: true, name: 'freezeTicks' })
        // 时停挂在判定窗的第一记上（CombatManager.caesuraFreeze）。没有窗口就永远不会落地 ⇒ 死数据
        if (!(isNum(fr.activeStart) && isNum(fr.activeEnd) && fr.activeEnd >= fr.activeStart)) {
          report.error(file, `${lw}.freezeTicks`, '写了时停但这一式没有判定窗（activeStart/activeEnd）⇒ 永远触发不了')
        }
      }
    })
    for (let k = 1; k < cds.length; k++) {
      if (cds[k] > cds[k - 1]) report.error(file, `${w}.levels`, `cooldownTicks 逐级变长（L${k}=${cds[k - 1]} → L${k + 1}=${cds[k]}）：练熟一招不该惩罚玩家`)
    }
  })
}

// ---- 掉落档位的"付得出钱"检查（Phase 6-A / KI-042）----
/**
 * gearBand 里写了一个稀有度，items.json 里就得真有那一档的装备件，否则 `Loot.pickGearItem` 会
 * 静悄悄返回 null ——表配好了、概率算对了、玩家打开箱子什么都没有。
 * 这一步真的抓到了：修之前 rareplus / epic 两档一件装备都没有，而隐藏房的两条 roll 全押在这两档上。
 */
function validateGearRarityCoverage() {
  const file = 'loot.json'
  const gearRarities = new Set((data['items.json'] ?? []).filter(isObj).map((it) => it.gear?.rarity).filter(isStr))
  const seen = new Set()
  const walk = (t) => {
    for (const r of [...(t.rolls ?? []), ...(t.firstKill ?? [])]) {
      for (const b of r.gearBand ?? []) {
        if (!isStr(b.rarity) || seen.has(b.rarity)) continue
        seen.add(b.rarity)
        if (!gearRarities.has(b.rarity)) {
          report.error(file, `gearBand.${b.rarity}`, `这张档的稀有度 '${b.rarity}' 在 items.json 里没有任何装备件 ⇒ 掷到它等于什么都不掉（KI-042）`)
        }
      }
    }
  }
  for (const t of data[file] ?? []) if (isObj(t)) walk(t)
}

// ---- worldstate.json（世界状态写入规则，Phase 6-A / KI-041）----
/**
 * 这一节是"可达性"闸门，不是普通的字段校验。它存在的原因是 KI-041 那个真 bug：
 * `regions.json` 里有一批**只有读方、没有写方**的世界旗标（箱子的 requiresFlag、隐藏房的 unlockFlag），
 * 于是那些内容在玩家侧永远打不开——而逐文件的校验全绿，因为每一半单独看都合法。
 * 所以这里做的是**双向对账**：写了没人读 = ERROR（§55 的老规矩），读了没人写 = 必须逐个列在
 * PENDING_FLAG_WRITERS 里（带原因），否则 ERROR。白名单只能变短不能变长。
 */
const PENDING_FLAG_WRITERS = {
  'flag.echo_cairn_read': 'Phase 6-B：石堆的「读」是一次剧情动作（要接对话/调查），不预先编造触发器',
  'flag.side_nave_found': 'Phase 6-B：侧廊入口需要一段能在地板上站住的领取点几何（当前 secret 坐标在可行走层之外）',
  'flag.brokenbar_resolved': 'Phase 6-B：断弦营地线（收编/清算抉择）',
  'flag.brokenbar_allied': 'Phase 6-B：同上，潜行解专属那条',
  'flag.found_first_phrase': 'Phase 6-C：初句圣所五环线索链（narrative §4.8），不靠走近解',
}
const RULE_ONS = new Set(['firstParry', 'bossDefeated', 'interactUsed'])
const RULE_FIELDS = new Set(['id', 'on', 'dataId', 'interactId', 'setFlag', 'notify'])

function collectFlagUsage() {
  const read = new Map() // flag -> 读它的地方（用于报错时指路）
  const written = new Map() // flag -> 写它的规则/交互物
  const interactableIds = new Set()
  const secrets = [] // { id, unlockFlag, regionId, claim: null | interactable id }
  for (const rg of data['regions.json'] ?? []) {
    if (!isObj(rg)) continue
    for (const it of rg.interactables ?? []) {
      if (!isObj(it)) continue
      interactableIds.add(it.id)
      if (isStr(it.requiresFlag)) read.set(it.requiresFlag, `${rg.id}.interactables(${it.id}).requiresFlag`)
      if (isStr(it.setsFlag)) written.set(it.setsFlag, `${rg.id}.interactables(${it.id}).setsFlag`)
      if (isStr(it.secretId)) {
        const owner = (rg.secrets ?? []).find((x) => x.id === it.secretId)
        if (owner) owner.claim = owner.claim ?? it.id
      }
    }
    // claim 在上面那个循环里被写在原始 secret 对象上（同一份 data 里），这里只把它搬到视图上——
    // 之前写成 `claim: null` 会把刚认出来的领取点覆盖掉，闸门因此误报"旗立了没人发奖"。
    for (const s of rg.secrets ?? []) if (isObj(s)) secrets.push({ ...s, regionId: rg.id, claim: s.claim ?? null })
    if (isStr(rg.unlockFlag)) read.set(rg.unlockFlag, `${rg.id}.unlockFlag`)
  }
  for (const s of secrets) if (isStr(s.unlockFlag)) read.set(s.unlockFlag, `${s.regionId}.secrets(${s.id}).unlockFlag`)
  return { read, written, interactableIds, secrets }
}

function validateWorldstate() {
  const file = 'worldstate.json'
  const list = data[file]
  const { read, written, interactableIds, secrets } = collectFlagUsage()
  const enemyIds = new Set((data['enemies.json'] ?? []).filter(isObj).map((e) => e.id))
  const seen = new Set()
  if (!isArr(list) || list.length === 0) { report.error(file, file, '必须是非空数组'); return { read, written, secrets } }
  list.forEach((r, i) => {
    const w = isStr(r?.id) ? r.id : `[${i}]`
    if (!isObj(r)) { report.error(file, `[${i}]`, '必须是对象'); return }
    for (const k of Object.keys(r)) if (!RULE_FIELDS.has(k)) report.error(file, `${w}.${k}`, `未知字段：规则表的字段就是引擎能听懂的动作，加字段必须同时加消费方`)
    if (!isStr(r.id)) report.error(file, w, 'id 缺失')
    else if (seen.has(r.id)) report.error(file, w, `id 重复：${r.id}`)
    else seen.add(r.id)
    if (!RULE_ONS.has(r.on)) report.error(file, `${w}.on`, `on=${JSON.stringify(r.on)} 非法（${[...RULE_ONS].join('/')}）`)
    if (!isStr(r.setFlag)) { report.error(file, `${w}.setFlag`, '缺失或非字符串'); return }
    if (r.on === 'bossDefeated' && !enemyIds.has(r.dataId)) report.error(file, `${w}.dataId`, `悬空引用：'${r.dataId}' 不在 enemies.json`)
    if (r.on === 'interactUsed' && !interactableIds.has(r.interactId)) report.error(file, `${w}.interactId`, `悬空引用：'${r.interactId}' 不是任何区域的交互物`)
    if (r.notify !== undefined && !isStr(r.notify)) report.error(file, `${w}.notify`, '必须是非空字符串')
    // §55 的正方向：这条规则立的旗标必须真有人读
    if (!read.has(r.setFlag)) report.error(file, `${w}.setFlag`, `写了 '${r.setFlag}' 但 regions.json 里没有任何读方（写进表却没人读的旗标就是死数据）`)
    written.set(r.setFlag, `${w}`)
  })
  // §55 的反方向：被读的旗标必须有人写，否则它锁着的内容不可达（KI-041 的机器版判据）
  for (const [flag, where] of [...read].sort()) {
    if (written.has(flag)) continue
    if (PENDING_FLAG_WRITERS[flag]) report.warn(file, flag, `${where} 在读它，但还没有写方（待办：${PENDING_FLAG_WRITERS[flag]}）`)
    else report.error(file, flag, `${where} 在读这个旗标，但没有任何写方，也没列进 PENDING_FLAG_WRITERS ⇒ 它锁着的内容玩家不可达`)
  }
  // 反过来"写了却没人读"只对**规则表**判 ERROR（上面逐条已查）；交互物的 setsFlag
  // 有一类是给 Phase 6 的对话/条件将来要读的（调音桩激活记录等），在这里报 WARN 只会变成噪音。
  // 隐藏房：锁要有钥匙，钥匙也要有能按的锁
  for (const s of secrets) {
    const hasWriter = written.has(s.unlockFlag)
    if (s.claim && !hasWriter) report.error(file, `${s.regionId}.secrets(${s.id})`, `领取点 ${s.claim} 依赖 ${s.unlockFlag}，但没有任何写方 ⇒ 这是一只永久焊死的箱子`)
    if (!s.claim && hasWriter) report.error(file, `${s.regionId}.secrets(${s.id})`, `${s.unlockFlag} 有写方，但这条 secret 没有带 secretId 的领取点 ⇒ 旗立了也没人发奖`)
    // 既没写方也没领取点 = 还没做的内容线；它的旗标已经在上面的 PENDING_FLAG_WRITERS 里挂过号，
    // 这里不再重复报，免得一条欠账出现两行 WARN 把真正的新增孤儿淹掉。
  }
  // secretId 不许再自己抄一份 requiresFlag/lootTable（同一事实两处住）
  for (const rg of data['regions.json'] ?? []) for (const it of rg.interactables ?? []) {
    if (!isObj(it) || !it.secretId) continue
    for (const k of ['requiresFlag', 'lootTable']) if (it[k] !== undefined) report.error('regions.json', `${it.id}.${k}`, `带了 secretId 就不该再自己写 ${k}：解锁旗标与奖励表只住在 secrets[] 那一条记录里`)
  }
  return { read, written, secrets }
}

// ---- npcs.json / quests.json / dialogue.json（Phase 6-B 叙事层）----
function validateNpcs() {
  const file = 'npcs.json'
  const list = data[file]
  const ids = new Set()
  if (!isArr(list) || list.length === 0) { report.error(file, file, '必须是非空数组'); return ids }
  const regionIds = new Set((data['regions.json'] ?? []).filter(isObj).map((r) => r.id))
  list.forEach((n, i) => {
    const w = isStr(n?.id) ? n.id : `[${i}]`
    if (!isObj(n)) { report.error(file, w, '必须是对象'); return }
    if (!isStr(n.id)) report.error(file, w, 'id 缺失或非字符串')
    else if (ids.has(n.id)) report.error(file, w, `id 重复：${n.id}`)
    else ids.add(n.id)
    if (!isStr(n.displayName)) report.error(file, w, 'displayName 必填')
    if (!isStr(n.nameKey)) report.error(file, w, 'nameKey 必填')
    if (!isStr(n.blurb) || n.blurb.length < 8) report.error(file, w, 'blurb 必填（一句话人设）')
    if (!isStr(n.homeRegion) || !regionIds.has(n.homeRegion)) report.error(file, `${w}.homeRegion`, `悬空引用：'${n.homeRegion}' 不是任何区域`)
    if (n.relation !== undefined) report.num(file, `${w}.relation`, n.relation, { min: -5, max: 5, int: true, name: 'relation' })
  })
  return ids
}

function validateQuests(npcIds) {
  const file = 'quests.json'
  const list = data[file]
  const ids = new Set()
  const states = new Map() // state -> questId（state 串全局唯一：它是条件求值的键）
  if (!isArr(list) || list.length === 0) { report.error(file, file, '必须是非空数组'); return ids }
  list.forEach((q, i) => {
    const w = isStr(q?.id) ? q.id : `[${i}]`
    if (!isObj(q)) { report.error(file, w, '必须是对象'); return }
    if (!isStr(q.id)) report.error(file, w, 'id 缺失或非字符串')
    else if (ids.has(q.id)) report.error(file, w, `id 重复：${q.id}`)
    else ids.add(q.id)
    if (!isStr(q.displayName)) report.error(file, w, 'displayName 必填')
    if (!isStr(q.outcome)) report.error(file, w, 'outcome 必填（完成后的世界状态摘要）')
    if (!isStr(q.npc) || !npcIds.has(q.npc)) report.error(file, `${w}.npc`, `悬空引用：'${q.npc}' 不在 npcs.json`)
    if (!isArr(q.steps) || q.steps.length === 0) { report.error(file, w, 'steps 必须是非空数组'); return }
    q.steps.forEach((st, si) => {
      const sw = `${w}.steps[${si}]`
      if (!isObj(st)) { report.error(file, sw, '必须是对象'); return }
      if (!isStr(st.state)) report.error(file, `${sw}.state`, 'state 必填（条件求值的键）')
      else if (states.has(st.state)) report.error(file, sw, `state 串重复：${st.state}（已被 ${states.get(st.state)} 用掉）`)
      else states.set(st.state, q.id)
      if (!isStr(st.label)) report.error(file, `${sw}.label`, 'label 必填')
      if (st.tags !== undefined) {
        strArray(file, `${sw}.tags`, st.tags, { nonEmpty: true })
        for (const t of st.tags ?? []) if (!QUEST_TAGS.has(t)) report.error(file, `${sw}.tags`, `未知标注：${t}（§28 只有 D/C/H/M）`)
      }
      if (st.advanceOn !== undefined) {
        if (!isObj(st.advanceOn)) { report.error(file, `${sw}.advanceOn`, '必须是对象'); return }
        strArray(file, `${sw}.advanceOn.flags`, st.advanceOn.flags, { nonEmpty: true })
        for (const f of st.advanceOn.flags ?? []) if (!isStr(f) || !f.startsWith('flag.')) report.error(file, `${sw}.advanceOn.flags`, `旗标命名必须是 flag.*：${f}`)
      }
    })
  })
  return ids
}

function validateDialogue(npcIds, questIds, itemIds) {
  const file = 'dialogue.json'
  const list = data[file]
  const ids = new Set()
  const flagReads = new Map()
  const flagWrites = new Map()
  const note = (map, flag, where) => { if (!map.has(flag)) map.set(flag, where) }
  if (!isArr(list) || list.length === 0) { report.error(file, file, '必须是非空数组'); return { ids, flagReads, flagWrites } }

  const checkCondition = (where, c, npc) => {
    if (c === undefined) return
    if (!isObj(c)) { report.error(file, where, '必须是对象'); return }
    for (const k of Object.keys(c)) if (!CONDITION_FIELDS.has(k)) report.error(file, `${where}.${k}`, `未知条件：${k}（条件求值只认这四种）`)
    if (c.flags !== undefined) {
      for (const group of ['all', 'any', 'not']) {
        if (c.flags[group] === undefined) continue
        strArray(file, `${where}.flags.${group}`, c.flags[group], { nonEmpty: true })
        for (const f of c.flags[group] ?? []) {
          if (!isStr(f) || !f.startsWith('flag.')) report.error(file, `${where}.flags.${group}`, `旗标命名必须是 flag.*：${f}`)
          else note(flagReads, f, `${where}.flags.${group}`)
        }
      }
    }
    if (c.relation !== undefined) {
      if (!RELATION_OPS.has(c.relation.op)) report.error(file, `${where}.relation.op`, `未知比较符：${c.relation.op}`)
      report.num(file, `${where}.relation.value`, c.relation.value, { min: -5, max: 5, int: true, name: 'value' })
      if (c.relation.npc !== undefined && !npcIds.has(c.relation.npc)) report.error(file, `${where}.relation.npc`, `悬空引用：'${c.relation.npc}'`)
    }
    if (c.quest !== undefined) {
      if (!questIds.has(c.quest.id)) report.error(file, `${where}.quest.id`, `悬空引用：'${c.quest.id}' 不在 quests.json`)
      if (c.quest.in !== undefined) strArray(file, `${where}.quest.in`, c.quest.in, { nonEmpty: true })
      if (c.quest.in === undefined && c.quest.gte === undefined) report.error(file, `${where}.quest`, '至少要写 in 或 gte 之一')
    }
    if (c.hasItem !== undefined) {
      if (!itemIds.has(c.hasItem.id)) report.error(file, `${where}.hasItem.id`, `悬空引用：'${c.hasItem.id}' 不在 items.json`)
      if (c.hasItem.count !== undefined) report.num(file, `${where}.hasItem.count`, c.hasItem.count, { min: 1, int: true, name: 'count' })
    }
  }

  const checkEffects = (where, e, npc) => {
    if (e === undefined) return
    if (!isObj(e)) { report.error(file, where, '必须是对象'); return }
    for (const k of Object.keys(e)) if (!EFFECT_FIELDS.has(k)) report.error(file, `${where}.${k}`, `未知效果：${k}（效果表的字段就是引擎听得懂的动作，加字段必须同时加消费方）`)
    if (e.setRelation !== undefined) {
      report.num(file, `${where}.setRelation.delta`, e.setRelation.delta, { min: -5, max: 5, int: true, name: 'delta' })
      if (e.setRelation.npc !== undefined && !npcIds.has(e.setRelation.npc)) report.error(file, `${where}.setRelation.npc`, `悬空引用：'${e.setRelation.npc}'`)
    }
    for (const group of ['setFlags', 'clearFlags']) {
      if (e[group] === undefined) continue
      strArray(file, `${where}.${group}`, e[group], { nonEmpty: true })
      for (const f of e[group] ?? []) {
        if (!isStr(f) || !f.startsWith('flag.')) report.error(file, `${where}.${group}`, `旗标命名必须是 flag.*：${f}`)
        else if (group === 'setFlags') note(flagWrites, f, `${where}.${group}`)
      }
    }
    if (e.startQuest !== undefined && !questIds.has(e.startQuest)) report.error(file, `${where}.startQuest`, `悬空引用：'${e.startQuest}' 不在 quests.json`)
    if (e.advanceQuest !== undefined && !questIds.has(e.advanceQuest.id)) report.error(file, `${where}.advanceQuest.id`, `悬空引用：'${e.advanceQuest.id}'`)
    for (const k of ['giveItem', 'takeItem']) {
      if (e[k] === undefined) continue
      if (!itemIds.has(e[k].id)) report.error(file, `${where}.${k}.id`, `悬空引用：'${e[k].id}' 不在 items.json`)
      if (e[k].count !== undefined) report.num(file, `${where}.${k}.count`, e[k].count, { min: 1, int: true, name: 'count' })
    }
    if (e.notify !== undefined && !isStr(e.notify)) report.error(file, `${where}.notify`, '必须是非空字符串')
  }

  list.forEach((t, i) => {
    const w = isStr(t?.id) ? t.id : `[${i}]`
    if (!isObj(t)) { report.error(file, w, '必须是对象'); return }
    if (!isStr(t.id)) report.error(file, w, 'id 缺失或非字符串')
    else if (ids.has(t.id)) report.error(file, w, `id 重复：${t.id}`)
    else ids.add(t.id)
    if (!isStr(t.npc) || !npcIds.has(t.npc)) report.error(file, `${w}.npc`, `悬空引用：'${t.npc}' 不在 npcs.json`)
    if (t.priority !== undefined) report.num(file, `${w}.priority`, t.priority, { name: 'priority' })
    if (!isArr(t.nodes) || t.nodes.length === 0) { report.error(file, w, 'nodes 必须是非空数组'); return }
    const nodeIds = new Set(t.nodes.filter(isObj).map((n) => n.id))
    checkCondition(`${w}.entry`, t.entry, t.npc)
    if (!isStr(t.rootNode)) report.error(file, `${w}.rootNode`, '必填')
    else if (!nodeIds.has(t.rootNode)) report.error(file, `${w}.rootNode`, `悬空引用：'${t.rootNode}' 不是本树的节点`)
    if (t.fallbackNode !== undefined) {
      if (!isStr(t.fallbackNode)) report.error(file, `${w}.fallbackNode`, '必须是非空字符串')
      else if (!nodeIds.has(t.fallbackNode)) report.error(file, `${w}.fallbackNode`, `悬空引用：'${t.fallbackNode}' 不是本树的节点`)
    }
    const seen = new Set()
    t.nodes.forEach((n, ni) => {
      const nw = `${w}.nodes[${ni}]`
      if (!isObj(n)) { report.error(file, nw, '必须是对象'); return }
      if (!isStr(n.id)) report.error(file, nw, 'id 缺失')
      else if (seen.has(n.id)) report.error(file, nw, `节点 id 重复：${n.id}`)
      else seen.add(n.id)
      if (!isStr(n.speaker)) report.error(file, `${nw}.speaker`, '必填')
      if (!isStr(n.text)) report.error(file, `${nw}.text`, '必填')
      else if (n.text.length > NODE_TEXT_MAX) report.warn(file, `${nw}.text`, `文案 ${n.text.length} 字，超过 §3.2 的 ${NODE_TEXT_MAX} 字上限`)
      checkCondition(`${nw}.conditions`, n.conditions, t.npc)
      checkEffects(`${nw}.effects`, n.effects, t.npc)
      if (n.next !== undefined && n.next !== null) {
        if (!isStr(n.next) || !nodeIds.has(n.next)) report.error(file, `${nw}.next`, `悬空引用：'${n.next}' 不是本树的节点`)
      }
      if (!isArr(n.choices) || n.choices.length === 0) return
      const cids = new Set()
      n.choices.forEach((c, ci) => {
        const cw = `${nw}.choices[${ci}]`
        if (!isObj(c)) { report.error(file, cw, '必须是对象'); return }
        if (!isStr(c.id)) report.error(file, cw, 'id 缺失')
        else if (cids.has(c.id)) report.error(file, cw, `选项 id 重复：${c.id}`)
        else cids.add(c.id)
        if (!isStr(c.text)) report.error(file, `${cw}.text`, '必填')
        if (!CHOICE_STYLES.has(c.style)) report.error(file, `${cw}.style`, `未知风格：${c.style}（${[...CHOICE_STYLES].join('/')}）`)
        checkCondition(`${cw}.conditions`, c.conditions, t.npc)
        checkEffects(`${cw}.effects`, c.effects, t.npc)
        if (c.next !== undefined && c.next !== null) {
          if (!isStr(c.next) || !nodeIds.has(c.next)) report.error(file, `${cw}.next`, `悬空引用：'${c.next}' 不是本树的节点`)
        }
      })
      // §3.2 的 maxVisibleChoices：可见选项由条件过滤，但**声明**的选项数不该超过上限太多，
      // 否则条件一放宽就会溢出 UI。
      if (n.choices.length > 4) report.warn(file, nw, `声明了 ${n.choices.length} 个选项（§3.2 上限 3 个可见，超过 4 个声明通常是没在条件上收敛）`)
    })
  })
  // 每棵树都要有落点：从 root/fallback 出发必须能走到一个"结束"（没有 next 且没有选项的节点），
  // 否则玩家会卡在一段永远不结束的对话里。
  for (const t of list.filter(isObj)) {
    if (!isStr(t.rootNode)) continue
    const byId = new Map((t.nodes ?? []).filter(isObj).map((n) => [n.id, n]))
    const start = isStr(t.fallbackNode) ? t.fallbackNode : t.rootNode
    const seen = new Set()
    let cur = byId.get(start)
    let ends = 0
    let steps = 0
    while (cur && steps++ < 64) {
      if (seen.has(cur.id)) break
      seen.add(cur.id)
      const choices = (cur.choices ?? []).filter(isObj)
      if (choices.length === 0) {
        if (!cur.next) { ends++; break }
        cur = byId.get(cur.next)
        continue
      }
      if (choices.some((c) => !c.next)) { ends++; break }
      cur = byId.get(choices[0].next)
    }
    if (ends === 0) report.error(file, `${t.id}`, '从 root/fallback 出发走不到任何结束节点 ⇒ 玩家会卡在一段不结束的对话里')
  }
  return { ids, flagReads, flagWrites }
}

// ---- 跑全部校验（跨文件引用需要先拿到 id 集合）----
// statuses 先跑：enemies 的 statusOnHit.tag 要拿它当词表对账
validateStatuses()
const movesetIds = validateMovesets()
const weaponIds = validateWeapons(movesetIds)
// progression 要先跑：稀有度是 items/loot 的跨文件依据；items 要先跑：掉落表引用物品 id
const { rarityIds, affixDefs } = validateProgression()
const itemIds = validateItems(weaponIds, rarityIds, affixDefs)
const lootIds = validateLoot(itemIds, rarityIds)
const enemyIds = validateEnemies(lootIds)
validatePlayer()
const regionIds = validateRegions(enemyIds, lootIds)
// movements 最后跑：它要同时对账 items（点亮源）、loot（源是否真会掉）、progression（开槽里程碑）
validateMovements(itemIds)
// 叙事层（Phase 6-B）：NPC → 任务 → 对话（后者依赖前两者的 id）
const npcIds = validateNpcs()
const questIds = validateQuests(npcIds)
const dialogueInfo = validateDialogue(npcIds, questIds, itemIds)
// 叙事层的双向对账（§55 / KI-041 的同一条纪律，两个方向都查）：
// ① 对话写的旗标必须有人读（区域闸门 / 任务步 / 对话条件），否则是死数据；
// ② 对话读的旗标必须有人写，否则那个条件永远不成立；
// ③ NPC 交互物指向的 npcId 必须真有数据，否则按 E 只有一句占位台词。
{
  const { read: regionReads, written: regionWrites } = collectFlagUsage()
  const questReads = new Set()
  for (const q of data['quests.json'] ?? []) {
    if (!isObj(q)) continue
    for (const st of q.steps ?? []) for (const f of st.advanceOn?.flags ?? []) questReads.add(f)
  }
  const allWrites = new Set([...regionWrites.keys(), ...dialogueInfo.flagWrites.keys()])
  for (const [flag, where] of [...dialogueInfo.flagWrites].sort()) {
    if (dialogueInfo.flagReads.has(flag) || regionReads.has(flag) || questReads.has(flag)) continue
    report.error('dialogue.json', flag, `${where} 写了它，但没有任何读方（区域闸门 / 任务步 / 对话条件都没有）⇒ 死数据`)
  }
  for (const [flag, where] of [...dialogueInfo.flagReads].sort()) {
    if (allWrites.has(flag)) continue
    report.error('dialogue.json', flag, `${where} 在读它，但没有任何写方 ⇒ 这个条件永远不成立`)
  }
  for (const rg of data['regions.json'] ?? []) {
    for (const it of rg.interactables ?? []) {
      if (!isObj(it) || it.kind !== 'npc' || !isStr(it.npcId)) continue
      if (!npcIds.has(it.npcId)) report.error('regions.json', `${rg.id}.interactables(${it.id})`, `npcId '${it.npcId}' 不在 npcs.json ⇒ 按 E 只会得到一句占位台词`)
    }
  }
}
void dialogueInfo.ids
// worldstate 最后：它要拿 regions/enemies 的 id 与"谁在读旗标"做双向对账
validateWorldstate()
validateGearRarityCoverage()
void regionIds

// ---- 报告 ----
let errTotal = 0
let warnTotal = 0
console.log('CAESURA 数据校验（KI-015 门禁）— src/data/json')
for (const f of FILES) {
  const rows = report.rows.filter((x) => x.file === f)
  const errs = rows.filter((x) => x.level === 'ERROR')
  const warns = rows.filter((x) => x.level === 'WARN')
  errTotal += errs.length
  warnTotal += warns.length
  console.log(`\n=== ${f} ===`)
  if (rows.length === 0) console.log('  OK — 无 ERROR / WARN')
  for (const x of errs) console.log(`  ERROR  ${x.where}: ${x.msg}`)
  for (const x of warns) console.log(`  WARN   ${x.where}: ${x.msg}`)
  if (rows.length > 0) console.log(`  -- ${errs.length} ERROR / ${warns.length} WARN`)
}
console.log(`\n总计：${errTotal} ERROR / ${warnTotal} WARN`)
process.exit(errTotal > 0 ? 1 : 0)
