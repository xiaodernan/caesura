/**
 * scripts/validate-data.mjs
 *
 * KI-015 数据门禁：零新增依赖（只用 node 内置 fs/path），校验 src/data/json/*.json。
 * KI-082 起多一道与其它判据**不相交**的门：表里出现 U+FFFD（写盘路径压坏中文留下的记号）即 ERROR，
 * 判据本体住 `scripts/text-integrity.mjs`。
 * 结构/词表以 src/data/schema.ts 为准（本脚本只读，绝不修改任何被校验的 JSON）。
 *
 * 用法：node scripts/validate-data.mjs        （或 npm run validate:data）
 * 退出码：存在 ERROR → 1；仅 WARN 或全绿 → 0（这才是它作为门禁的意义）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// 「先记账后接线」那两份账本的**销账**判据（KI-073）。住在这里而不是内联，是为了让测试能喂它合成账本：
// 本脚本一被 import 就会去校验真表，判据留在里面就没人 import 得动（与 report-reds.mjs 同一个理由）。
import { flagLedgerErrors, milestoneLedgerErrors, PENDING_FLAG_WRITERS, PENDING_MILESTONE_GRANTS, statusLedgerErrors, UI_BOUND_MILESTONES } from './ledger-rules.mjs'
// 词表对账（KI-074 / KI-076）：每张名单的主人（可能是 schema 的一条声明，也可能是某个模块的
// 一张表、一条数组、一组调用点）是唯一起点，这里读它而不是抄它。
// KI-086 补两种形状（嵌套对象里的内联联合、模块级 `const X = new Set([...])`），
// 并把"还剩几张没交代"换成机器读数（`handCopiedLists` + `vocabCoverageErrors`）。
// KI-088 认下第六种主人：**一个目录**——`corpusFor` 从此吃得下以 `/` 结尾的路径（语料是目录名逐行拼起来的），
// 于是 `FILES` 那张工作清单也不再是"没有主人"，而是与 `src/data/json/` 里的真文件双向对账。
import {
  arrayLiterals, assignedLiterals, bracketKeys, calledNames, callArgLiterals, dirListing, fieldUnion, functionBodies,
  handCopiedLists, importedNames, interfaceFields, objectKeys,
  refFieldUnion, schemaBlocks, setLiterals, unionMembers, vocabCoverageErrors, vocabDriftErrors,
} from './schema-vocab.mjs'
// KI-079：探索曲表的判据本体（同一族理由，见上面那两行）。这里只把 findings 报成 ERROR/WARN，
// 并把 `report.num` 管的数值可闻带留在本文件——那张名单的两端都要能在测试里喂合成行。
import {
  EXPLORE_ATONAL_FIELDS, EXPLORE_FORMS, EXPLORE_TONAL_FIELDS, EXPLORE_WAVES, exploreFindings,
} from './explore-rules.mjs'
// KI-080：战斗档表的判据本体，同一族理由（两端都要量得动）。`report.num` 管的 `bellEveryBars` 留在本文件。
import { BATTLE_SILENT_FIELDS, BATTLE_TONAL_FIELDS, battleFindings } from './battle-rules.mjs'
// KI-083：环境声床表的判据本体（同一族理由，见上面那两行）。这里只把 findings 报成 ERROR/WARN，
// 并把 `report.num`/`report.sub` 管的数值可闻带留在本文件——那张名单的两端都要能在测试里喂合成行。
import {
  AMB_BED_FIELDS, AMB_BELL_FIELDS, AMB_LAYER_FIELDS, AMB_SOURCE_FIELDS, AMB_SOURCE_LAYERS, AMB_WAVES,
  ambienceFindings,
} from './ambience-rules.mjs'
// KI-082：文本完整性。中文被写盘路径压坏这件事从此由机器发现，不靠人眼撞见（那一族不与任何既有判据相交）。
import { mojibakeFindings } from './text-integrity.mjs'
// KI-084：锁定四数的两条**关系**判据（同一族理由：那两句文档折成的不等式要在测试里喂得出非法数组）。
// 四个数各自的 min 仍走本文件的 `report.sub`——缺失/非有限数/越界那三种说法全场由它一家管。
import { LOCKON_FIELDS, lockOnFindings } from './lockon-rules.mjs'
// KI-085：连发/诱饵那几条**关系**判据的本体（同一族理由：`at` 与 `everyTicks` 与 `punishMs` 之间的
// 序关系要在测试里喂得出非法行）。count/everyTicks/at[i]/punishMs 各自的可闻带仍走本文件的 report.num。
import { BURST_FIELDS, FEINT_FIELDS, burstFindings } from './burst-rules.mjs'
// KI-092：§8.2 侧链表那几条**跨文件**判据的本体（同一族理由：要在测试里喂一行"引擎根本不听的触发口"
// 看它拒不拒）。这里只负责把那两份源码名单读出来当输入，再把 findings 报成 ERROR。
import { DUCK_FIELDS, duckFindings } from './ducking-rules.mjs'
// KI-094：天气表那几条**跨文件**判据的本体（同一族理由：要在测试里喂一行"§38 没有的那一档"、
// "没被任何一区指到的名字"看它拒不拒）。这里只负责把 §38 的档名名册与被引用的天气名读出来当输入。
import {
  PENDING_WEATHER_READINGS, PENDING_WEATHER_SWITCHES, WEATHER_FIELDS, WEATHER_GAMEPLAY_RULINGS,
  weatherFindings, weatherSwitchFindings,
} from './weather-rules.mjs'
import { cinematicBudgetErrors, cinematicReferenceErrors } from './cinematic-rules.mjs'
// KI-094 同族：§37 区域光照预设表（`lp_*`）那几条**跨文件**判据的本体。这里只把 regions.json 里
// 被指着的名字读出来当输入，再把 findings 报成 ERROR。
import { LIGHTING_FIELDS, lightingFindings } from './lighting-rules.mjs'
import { vfxFindings } from './vfx-rules.mjs'
// KI-100：世界图那三条**几何**判据的本体（同一族理由：要在测试里喂一条"落点正踩在两个区的缝上"的边、
// 一个"锚点排成一条直线"的区域，看它拒不拒）。这里只把 `regions.json` 递给它，再把 findings 报成 ERROR。
import { worldGraphFindings } from './world-graph-rules.mjs'
// KI-089：对话树的**可达性**判据本体（同一族理由：要在测试里喂一棵合成树看它拒不拒）。这里只把
// findings 报成 ERROR —— 一句话有没有玩家读得到，是"边"的事，不是"条件写得好不好"的事。
import { dialogueReachErrors } from './dialogue-rules.mjs'
// KI-093：`FILES` 名册 ⇄ `validateX()` 函数那条缝的判据本体。同一族理由（要在测试里喂一张"有表没人报"
// 的合成名册看它拒不拒），也同一族形状：这里只把 findings 报成 ERROR，而三端读数全部由抽取器现推。
import { mapFindings } from './validator-map-rules.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const JSON_DIR = resolve(ROOT, 'src/data/json')
const FILES = ['player.json', 'movesets.json', 'weapons.json', 'enemies.json', 'loot.json', 'regions.json', 'items.json', 'progression.json', 'statuses.json', 'movements.json', 'worldstate.json', 'npcs.json', 'dialogue.json', 'quests.json', 'reactions.json', 'shop.json', 'states.json', 'ambience.json', 'explore.json', 'battle.json', 'ducking.json', 'weather.json', 'cinematics.json', 'lighting.json', 'vfx.json']
// Phase 6-B：对话风格枚举与任务标注（narrative.md §3.2 / §28 图例）
const CHOICE_STYLES = new Set(['blunt', 'poetic', 'silent', 'provoke'])
const QUEST_TAGS = new Set(['D', 'C', 'H', 'M'])
const EFFECT_FIELDS = new Set(['setRelation', 'setFlags', 'clearFlags', 'startQuest', 'advanceQuest', 'giveItem', 'takeItem', 'notify', 'setState'])
const CONDITION_FIELDS = new Set(['flags', 'relation', 'quest', 'hasItem', 'state'])
const RELATION_OPS = new Set(['gte', 'lte', 'eq'])
// narrative §3.2 的约束：单节点文案上限
const NODE_TEXT_MAX = 120
// Phase 5-B 起：装备槽位 / 物品大类（与 schema.ts 的 SlotKey / ItemKind 对齐）
const SLOT_KEYS = new Set(['weapon', 'helm', 'cuirass', 'gloves', 'greaves', 'seal', 'sealA', 'sealB'])
// 'sealB'：B 槽专属件的载体（§6.2 音徽·丰谐——幸运系数只许长在看得见的署名件上，KI-030②）。
// 'sealA' 刻意不进词表：今天没有任何一件声明它，出现需求时先登记消费者，再动这张表。
const GEAR_SLOTS = new Set(['weapon', 'helm', 'cuirass', 'gloves', 'greaves', 'seal', 'sealB'])
const ITEM_KINDS = new Set(['currency', 'material', 'consumable', 'weapon', 'armor', 'seal', 'lore', 'key'])
const AFFIX_STATS = new Set(['poiseDmg', 'defense', 'staminaRegen', 'critRate', 'execDmg', 'noiseMul', 'lootLuck', 'skillDmg', 'comboScaling'])
const AFFIX_BEHAVIORS = new Set(['perfectBlockWindow', 'lightStartup', 'bellBonus', 'restOverdrive'])

// ---- 词表：手抄名单。每张的主人由文件末尾的 VOCAB_PAIRS 现场读出来，改了主人就会红 ----
const WEAPON_ARCHETYPES = new Set(['straight_sword', 'greatsword', 'spear', 'bow', 'staff', 'unique', 'needle'])
const ENEMY_ARCHETYPES = new Set(['basic', 'heavy', 'ranged', 'assassin', 'support', 'elite', 'miniboss', 'boss'])
const ATTR_KEYS = new Set(['str', 'dex', 'ton', 'vig', 'ovr', 'fis'])
const BIOMES = new Set(['hub', 'forest', 'ruins', 'underground', 'camp', 'dungeon', 'boss_arena'])
const HITBOX_SHAPES = new Set(['cone', 'sphere', 'ring'])
const PROJECTILE_KINDS = new Set(['spear', 'note', 'shard', 'arrow'])
const REACTIONS = new Set(['R0', 'R1', 'R2', 'R3', 'R4', 'R5'])
// CameraRig.SHAKE_TABLE 里**数据可指**的行（hurt/parry/execute 由代码按情境直接发，不经帧表 ⇒ 登记为子集豁免）；
// 'stomp' 自 KI-051 起是 §10「驼鼓踏地」的 worldShake 行
const SHAKES = new Set(['graze', 'normal', 'heavy', 'boss', 'stomp'])
const INTERACTABLE_KINDS = new Set(['checkpoint', 'elevator', 'bridge', 'soundwall', 'gather', 'chest', 'npc', 'teleport', 'gate', 'bell', 'inspect', 'shop'])
// KI-023 可破坏场景物的品类白名单（schema.ts PropRef.kind 同名单；新种类随消费方一起落）
const PROP_KINDS = new Set(['soundspine', 'resonance_core'])
const PICK_ORDERS = new Set(['random', 'cycle'])
// src/ai/Enemy.ts:707 —— 距离带里不是招式的伪动作
const PSEUDO_ACTIONS = new Set(['chase', 'backstep', 'hold'])
/* 下面这七张原来住在各自那张表的校验段落里，KI-086 起搬到词表区。理由不是排版：
   `VOCAB_PAIRS` 是一张在模块求值时就要读这些名单的数组，声明排在它后面就是
   `ReferenceError: Cannot access 'WEAPON_FIELDS' before initialization`——本批第一趟实测撞到的。
   也就是说：**一张名单想有主人，它必须和主人登记在同一个可求值的起点之前**，这条写在这里免得下次再撞。 */
/** WeaponData 的字段全集（KI-047）：每一格都必须有真实消费方，多余键一律 ERROR——
 *  曾有的 `atkBase` 就是从这里出去的：底数住在 movesets.json 的帧表，武器表再带一份
 *  "看起来是价格"的数，KI-039 的错价才躲过了整轮验收。 */
const WEAPON_FIELDS = new Set(['id', 'nameKey', 'archetype', 'movesetId', 'scaling', 'swingTag', 'skill', 'poiseMul', 'noiseMul', 'stealthKillFrac', 'heavyAlertBackstab', 'falloff', 'trail'])
/** 出身被动的类型白名单（KI-031③）：加一种 kind = 承诺带来一个消费者，反向探针守着那句话 */
const ORIGIN_PASSIVE_KINDS = ['lootStackBonus']
/** 营地商店那三张字段白名单（KI-055）：主人分别是 ShopData / ShopSell / ShopStockEntry */
const SHOP_FIELDS = new Set(['id', 'sell', 'stock', 'redlines'])
const SELL_FIELDS = new Set(['mul', 'stackKinds', 'note'])
const STOCK_FIELDS = new Set(['id', 'item', 'price', 'note'])
/** 世界状态规则表：`on` 是引擎听得懂的触发口，字段是它能做的动作——加一项必须同时加消费方 */
const RULE_ONS = new Set(['firstParry', 'bossDefeated', 'interactUsed', 'stateSet'])
const RULE_FIELDS = new Set(['id', 'on', 'dataId', 'interactId', 'stateKey', 'stateIn', 'setFlag', 'notify'])
// tests/flow/support.test.ts 同款判据：tag 末段为 mute 即闷音类，必须自带 ticks
const MUTE_TAG = /(^|\.)mute$/
// src/core/EventBus.ts > STATUS_IDS —— 五状态一张表：少一维 HUD 就没得播，多一维就是没人消费的数据（KI-076 起由对账读它，不再抄它）
const STATUS_IDS = ['fissure', 'mute', 'echo', 'corruption', 'overdrive']
// 每个状态允许出现的字段（§55：写了没消费方的数值不许进表；加新字段必须同时接上消费方）
const STATUS_FIELDS = {
  fissure: ['tag', 'displayName', 'desc', 'maxLayers', 'dmgMulPerLayer', 'idleTicks', 'decayEveryTicks', 'burst'],
  mute: ['tag', 'displayName', 'desc', 'regenMul'],
  echo: ['tag', 'displayName', 'desc', 'delayTicks', 'replayMul', 'radius', 'maxShadows'],
  corruption: ['tag', 'displayName', 'desc', 'max', 'eliteHit', 'visualStart', 'hpPerSec'],
  overdrive: ['tag', 'displayName', 'desc'],
}
// src/core/Input.ts > ActionName 的一个**子集**：目前只有这两条动作被乐章战技占用（新增槽位要先在输入层登记）
const MOVEMENT_ACTIONS = new Set(['weaponSkill', 'weaponSkillB'])
/** 里程碑 grant 的字段白名单：`schema.ts > MilestoneGrant`。每一项都必须有消费方
 *  （`Progression.derive` 或 mods 出口）；语义写在那条声明自己的注释里，这里不再抄一份。 */
export const GRANT_FIELDS = ['loadFlat', 'parryWhiffMs', 'execMulPct', 'overdriveFlat', 'corruptionStayPct', 'bowForkBranches', 'rollStaminaFlat']
/** 战技帧的字段白名单： MovementFrame（schema.ts）。多一个字段就必须多一个消费方 */
const MOVE_FRAME_FIELDS = ['startup', 'activeStart', 'activeEnd', 'recovery', 'poise', 'hitStopMs', 'hitbox', 'multi', 'hitPhases', 'shake', 'sfx', 'vfx', 'loudness']
/** 战技每级的数值字段： MovementLevel。同样一字段一消费口 */
const MOVE_LEVEL_FIELDS = ['cooldownTicks', 'damage', 'trueDamage', 'fissureLayers', 'muteTicks', 'distance', 'freezeTicks', 'echoCharges', 'silenceTicks', 'silenceDmgBonus']
/** 被动 id 白名单（§7.3，KI-036）：一条被动 = 一个消费者（src/rpg/Settlement.ts refreshPlayer）。
 *  名单只能随消费方一起加长；残响耳（撞 KI-032）没接，故不收录。 */
const PASSIVE_IDS = new Set(['ps_metronomefoot', 'ps_tympanicguard', 'ps_featherrest'])
/* 环境声床那几张名单（`AMB_BED_FIELDS`/`AMB_LAYER_FIELDS`/`AMB_BELL_FIELDS`/`AMB_SOURCE_FIELDS`/
   `AMB_WAVES`/`AMB_SOURCE_LAYERS`）自 KI-083 起住在 `scripts/ambience-rules.mjs`，与判据本体同一份
   ——名单跟读它的那段代码分家，就是"改了这边忘了那边"的经典形状。这里由 import 引进来。 */
/* KI-079 那五张（两支字段表 + 拼出来的白名单 + 音高变形 + 波形 + 每音拍数档位）住在 `explore-rules.mjs`，
   与上面的 `AMB_*` 不是同一份声明：探索曲的波形主人是 `ExploreTonal.wave`，各有一条对账。 */

/**
 * 词表对账表（KI-074 起，KI-076 把载体泛化）。上面这些名单每一张都写着「与 X 对齐」——**手抄**。
 * 抄不会失败，只会静悄悄变旧：声明加了成员而这里没加 ⇒ 合法数据被判 ERROR；
 * 这里加了而声明没有 ⇒ 代码侧根本不认识这一项（derive 可能已在读它）。
 * 所以每张都登记"主人住在哪个文件的哪条声明"（`from` + `at`），跑一次逐张比对（`validateVocabDrift`）。
 *
 * KI-074 那批刻意没一次把所有名单并进来：**一条没量过的对账不是门，是安慰**——每张都要先在真文件上
 * 量过"抽取读得回来"才登记。KI-086 把剩下的逐张量完并入了，只剩 `VOCAB_UNPAIRED` 那五张确实没有声明可指。
 * 顺带纠正一笔旧账：这里曾经写「`REACTIONS` 的载体不是任何一条声明，而是 `reactions.json` 的行键加上 R4」——
 * 那是 KI-074 当时的实话，而 KI-052② 后来补了 `IncomingGrade`（R0..R5 全列，正是敌人招式
 * `AttackSpec.reaction` 那一格的类型）。判据比注释老，就得改注释：`REACTIONS` 今天入表。
 */
const VOCAB_PAIRS = [
  { at: 'AttrKey', from: 'src/data/schema.ts', name: '六维词表', source: (c) => unionMembers(c.blocks, 'AttrKey'), copied: [...ATTR_KEYS], where: 'ATTR_KEYS' },
  { at: 'SlotKey', from: 'src/data/schema.ts', name: '槽位全集', source: (c) => unionMembers(c.blocks, 'SlotKey'), copied: [...SLOT_KEYS], where: 'SLOT_KEYS' },
  {
    at: 'SlotKey', from: 'src/data/schema.ts', name: '装备件槽位', source: (c) => unionMembers(c.blocks, 'SlotKey'), copied: [...GEAR_SLOTS],
    allowMissing: ['sealA'], where: 'GEAR_SLOTS',
    whyMissing: '今天没有任何一件装备声明 sealA（B 槽专属件的载体是 sealB）；出现需求先登记消费者，再动这张表',
  },
  { at: 'ItemKind', from: 'src/data/schema.ts', name: '物品大类', source: (c) => unionMembers(c.blocks, 'ItemKind'), copied: [...ITEM_KINDS], where: 'ITEM_KINDS' },
  { at: 'MilestoneGrant', from: 'src/data/schema.ts', name: '里程碑 grant 字段', source: (c) => interfaceFields(c.blocks, 'MilestoneGrant'), copied: GRANT_FIELDS, where: 'GRANT_FIELDS' },
  { at: 'MovementFrame', from: 'src/data/schema.ts', name: '战技帧字段', source: (c) => interfaceFields(c.blocks, 'MovementFrame'), copied: MOVE_FRAME_FIELDS, where: 'MOVE_FRAME_FIELDS' },
  { at: 'MovementLevel', from: 'src/data/schema.ts', name: '战技每级数值字段', source: (c) => interfaceFields(c.blocks, 'MovementLevel'), copied: MOVE_LEVEL_FIELDS, where: 'MOVE_LEVEL_FIELDS' },
  { at: 'PropRef.kind', from: 'src/data/schema.ts', name: '可破坏场景物品类', source: (c) => fieldUnion(c.blocks, 'PropRef', 'kind'), copied: [...PROP_KINDS], where: 'PROP_KINDS' },
  { at: 'InteractableRef.kind', from: 'src/data/schema.ts', name: '交互物品类', source: (c) => fieldUnion(c.blocks, 'InteractableRef', 'kind'), copied: [...INTERACTABLE_KINDS], where: 'INTERACTABLE_KINDS' },
  { at: 'ProjectileSpec.kind', from: 'src/data/schema.ts', name: '弹道种类', source: (c) => fieldUnion(c.blocks, 'ProjectileSpec', 'kind'), copied: [...PROJECTILE_KINDS], where: 'PROJECTILE_KINDS' },
  // KI-076：这张的形状不是字面量联合，是 `export type Hitbox = HitboxCone | HitboxSphere | HitboxRing`
  // 那条**引用链**——从被引用的三个接口各自的 `shape:` 行现推，才不用再手抄一遍接口名。
  { at: 'Hitbox', from: 'src/data/schema.ts', name: '判定盒形状', source: (c) => refFieldUnion(c.blocks, 'Hitbox', 'shape'), copied: [...HITBOX_SHAPES], where: 'HITBOX_SHAPES' },
  // Phase 6-B 的值域状态：这两张名单是"引擎听得懂的条件/效果字段"，与 schema 同一条纪律
  { at: 'DialogueCondition', from: 'src/data/schema.ts', name: '对话条件字段', source: (c) => interfaceFields(c.blocks, 'DialogueCondition'), copied: [...CONDITION_FIELDS], where: 'CONDITION_FIELDS' },
  { at: 'DialogueEffects', from: 'src/data/schema.ts', name: '对话效果字段', source: (c) => interfaceFields(c.blocks, 'DialogueEffects'), copied: [...EFFECT_FIELDS], where: 'EFFECT_FIELDS' },
  /* ---- KI-076：主人不在 schema.ts 的那四张（每张都先量过它读得到，见 KI-074 行末「没做①」） ---- */
  {
    at: 'SHAKE_TABLE', from: 'src/player/CameraRig.ts', name: '震镜档位', source: (c) => objectKeys(c.text, 'SHAKE_TABLE'), copied: [...SHAKES],
    allowMissing: ['hurt', 'parry', 'execute'], where: 'SHAKES',
    whyMissing: '这三行由代码按情境直接发（CameraRig 订阅 player.damaged→hurt、combat.hit 的 parry 分支、CombatManager 的处决 shakeKey），不开放给数据帧指——数据侧能指的行只有 graze/normal/heavy/boss/stomp',
  },
  { at: 'STATUS_IDS', from: 'src/core/EventBus.ts', name: '五状态名册', source: (c) => arrayLiterals(c.text, 'STATUS_IDS'), copied: STATUS_IDS, where: 'STATUS_IDS' },
  {
    at: 'ActionName', from: 'src/core/Input.ts', name: '乐章战技占用的输入动作', source: (c) => unionMembers(c.blocks, 'ActionName'), copied: [...MOVEMENT_ACTIONS],
    subset: true, where: 'MOVEMENT_ACTIONS',
    whySubset: '输入层有 20 个动作，战技槽只占用其中两个；这张表**本来就是**子集，所以少抄不报、多抄（输入层没这个动作）照报',
  },
  {
    at: "passiveValue('…')", from: 'src/rpg/Settlement.ts', name: '被动白名单', source: (c) => callArgLiterals(c.text, 'passiveValue'), copied: [...PASSIVE_IDS], where: 'PASSIVE_IDS',
    hint: '载体是 Settlement.refreshPlayer 里那三处字面量调用（§55：一条被动 = 一个消费者）；哪天改成变量传参，这条普查就读不到了，要连判据一起换',
  },
  /* ---- KI-077：环境声床那三张字段表 + 波形词表（每张都先量过：interfaceFields / fieldUnion 读得回来） ---- */
  { at: 'AmbienceBed', from: 'src/data/schema.ts', name: '环境声床字段', source: (c) => interfaceFields(c.blocks, 'AmbienceBed'), copied: AMB_BED_FIELDS, where: 'AMB_BED_FIELDS' },
  { at: 'AmbienceLayer', from: 'src/data/schema.ts', name: 'drone 单层字段', source: (c) => interfaceFields(c.blocks, 'AmbienceLayer'), copied: AMB_LAYER_FIELDS, where: 'AMB_LAYER_FIELDS' },
  { at: 'AmbienceBell', from: 'src/data/schema.ts', name: 'L4 铃点字段', source: (c) => interfaceFields(c.blocks, 'AmbienceBell'), copied: AMB_BELL_FIELDS, where: 'AMB_BELL_FIELDS' },
  { at: 'AmbienceLayer.wave', from: 'src/data/schema.ts', name: 'drone 波形', source: (c) => fieldUnion(c.blocks, 'AmbienceLayer', 'wave'), copied: [...AMB_WAVES], where: 'AMB_WAVES' },
  /* ---- KI-083：§4 的 L2／L3 那一支（`sources[]` 是**新的一层**，字段与层名各有一条主人） ---- */
  { at: 'AmbienceSource', from: 'src/data/schema.ts', name: '真位置声源字段', source: (c) => interfaceFields(c.blocks, 'AmbienceSource'), copied: AMB_SOURCE_FIELDS, where: 'AMB_SOURCE_FIELDS' },
  { at: 'AmbienceSource.layer', from: 'src/data/schema.ts', name: '§4 的 L2／L3 层名', source: (c) => fieldUnion(c.blocks, 'AmbienceSource', 'layer'), copied: [...AMB_SOURCE_LAYERS], where: 'AMB_SOURCE_LAYERS' },
  /* ---- KI-079：探索曲那三张 + 音高变形词表（同一份四波形在 schema 里是**另一条声明**，所以另起一张名单，不借 `AMB_WAVES`） ---- */
  { at: 'ExploreForm', from: 'src/data/schema.ts', name: 'R-1 的音高变形', source: (c) => unionMembers(c.blocks, 'ExploreForm'), copied: [...EXPLORE_FORMS], where: 'EXPLORE_FORMS' },
  { at: 'ExploreTonal', from: 'src/data/schema.ts', name: '有调探索曲字段', source: (c) => interfaceFields(c.blocks, 'ExploreTonal'), copied: EXPLORE_TONAL_FIELDS, where: 'EXPLORE_TONAL_FIELDS' },
  { at: 'ExploreAtonal', from: 'src/data/schema.ts', name: '无调探索曲字段', source: (c) => interfaceFields(c.blocks, 'ExploreAtonal'), copied: EXPLORE_ATONAL_FIELDS, where: 'EXPLORE_ATONAL_FIELDS' },
  { at: 'ExploreTonal.wave', from: 'src/data/schema.ts', name: '探索曲波形', source: (c) => fieldUnion(c.blocks, 'ExploreTonal', 'wave'), copied: [...EXPLORE_WAVES], where: 'EXPLORE_WAVES' },
  /* ---- KI-080：战斗档那两支字段表（鼓型不在这里：五档真数据那一格全同，一列没有信息量的数据就不进表，见 schema 那段） ---- */
  { at: 'BattleTonal', from: 'src/data/schema.ts', name: '有配乐战斗档字段', source: (c) => interfaceFields(c.blocks, 'BattleTonal'), copied: BATTLE_TONAL_FIELDS, where: 'BATTLE_TONAL_FIELDS' },
  { at: 'BattleSilent', from: 'src/data/schema.ts', name: '无配乐战斗档字段', source: (c) => interfaceFields(c.blocks, 'BattleSilent'), copied: BATTLE_SILENT_FIELDS, where: 'BATTLE_SILENT_FIELDS' },
  /* ---- KI-084：锁定那一块的字段名单（判据住在 `lockon-rules.mjs`，名单与它同一份声明，不再手抄） ---- */
  { at: 'LockOnConfig', from: 'src/data/schema.ts', name: '锁定四数字段', source: (c) => interfaceFields(c.blocks, 'LockOnConfig'), copied: LOCKON_FIELDS, where: 'LOCKON_FIELDS' },
  /* ---- KI-085：连发与诱饵那两块的字段名单（判据住在 `burst-rules.mjs`；此前 burst 是 schema 里的
     内联类型，没有任何名单可对账，所以拼错一个键（`faint`）只会静默失效。提成具名接口才有主人可读。 ---- */
  { at: 'ProjectileBurst', from: 'src/data/schema.ts', name: '连发字段', source: (c) => interfaceFields(c.blocks, 'ProjectileBurst'), copied: BURST_FIELDS, where: 'BURST_FIELDS' },
  { at: 'BurstFeint', from: 'src/data/schema.ts', name: '诱饵惩罚字段', source: (c) => interfaceFields(c.blocks, 'BurstFeint'), copied: FEINT_FIELDS, where: 'FEINT_FIELDS' },
  /* ---- KI-092：§8.2 侧链表那一行的字段名单（判据住在 `ducking-rules.mjs`，名单与它同一份声明） ---- */
  { at: 'DuckRow', from: 'src/data/schema.ts', name: '侧链表字段', source: (c) => interfaceFields(c.blocks, 'DuckRow'), copied: DUCK_FIELDS, where: 'DUCK_FIELDS' },
  /* ---- KI-094：天气表那一行的字段名单（判据住在 `weather-rules.mjs`，名单与它同一份声明） ---- */
  { at: 'WeatherRow', from: 'src/data/schema.ts', name: '天气表字段', source: (c) => interfaceFields(c.blocks, 'WeatherRow'), copied: WEATHER_FIELDS, where: 'WEATHER_FIELDS' },
  /* ---- KI-094 同族：§37 光照预设表那一行的字段名单（判据住在 `lighting-rules.mjs`，名单与它同一份声明） ---- */
  { at: 'LightingRow', from: 'src/data/schema.ts', name: '光照预设表字段', source: (c) => interfaceFields(c.blocks, 'LightingRow'), copied: LIGHTING_FIELDS, where: 'LIGHTING_FIELDS' },
  /* ---- KI-086：把剩下那批"能指到主人"的名单逐张量完并入（每张都先量过它读得回来，KI-074 的规矩：
     一条没量过的对账不是门，是安慰）。其中 `PICK_ORDERS` 入表前读回来是 null —— 那是判据认不了
     "嵌在嵌套对象里的内联联合"这一种排版，补的是抽取器，不是名单；`PSEUDO_ACTIONS` 同族，
     主人是 `src/ai/Enemy.ts` 的模块级 `const … = new Set([...])`，既不是 export 也不是数组。
     剩下的没交代不行，所以另有一张 `VOCAB_UNPAIRED` 专门记"确实没有主人"的那几张。 ---- */
  { at: 'WeaponData.archetype', from: 'src/data/schema.ts', name: '武器原型', source: (c) => fieldUnion(c.blocks, 'WeaponData', 'archetype'), copied: [...WEAPON_ARCHETYPES], where: 'WEAPON_ARCHETYPES' },
  { at: 'EnemyData.archetype', from: 'src/data/schema.ts', name: '敌人原型', source: (c) => fieldUnion(c.blocks, 'EnemyData', 'archetype'), copied: [...ENEMY_ARCHETYPES], where: 'ENEMY_ARCHETYPES' },
  // KI-074 曾把这张名单登记为"没有声明可指"；KI-052② 之后主人是 `IncomingGrade`（敌人招式那一格的类型），
  // 而不是只到 R3 的 `ReactionTier`。今天量过：R0..R5 逐张相等 ⇒ 入表，那条旧说法随之改掉。
  { at: 'IncomingGrade', from: 'src/data/schema.ts', name: '受击反应档位', source: (c) => unionMembers(c.blocks, 'IncomingGrade'), copied: [...REACTIONS], where: 'REACTIONS' },
  // 嵌在 `EnemyData.ai` 里那一格：KI-086 起 `fieldUnion` 认得四格缩进（只认两格的那一版读成 null）
  { at: 'EnemyData.ai.pickOrder', from: 'src/data/schema.ts', name: '选招方式', source: (c) => fieldUnion(c.blocks, 'EnemyData', 'pickOrder'), copied: [...PICK_ORDERS], where: 'PICK_ORDERS' },
  { at: 'RegionData.biome', from: 'src/data/schema.ts', name: '生物群系', source: (c) => fieldUnion(c.blocks, 'RegionData', 'biome'), copied: [...BIOMES], where: 'BIOMES' },
  { at: 'DialogueChoice.style', from: 'src/data/schema.ts', name: '对话风格（narrative §3.2）', source: (c) => fieldUnion(c.blocks, 'DialogueChoice', 'style'), copied: [...CHOICE_STYLES], where: 'CHOICE_STYLES' },
  // 主人是 `relation?: { npc?: string; op: 'gte' | 'lte' | 'eq'; value: number }` 里那一格——
  // 内联嵌套对象的字段跟在 `;` 后面，`fieldUnion` 的第二条分支本来就认，量过就入表，不再手抄。
  { at: 'DialogueCondition.relation.op', from: 'src/data/schema.ts', name: '关系比较符', source: (c) => fieldUnion(c.blocks, 'DialogueCondition', 'op'), copied: [...RELATION_OPS], where: 'RELATION_OPS' },
  { at: 'WeaponData', from: 'src/data/schema.ts', name: '武器字段白名单', source: (c) => interfaceFields(c.blocks, 'WeaponData'), copied: [...WEAPON_FIELDS], where: 'WEAPON_FIELDS' },
  { at: 'OriginPassive.kind', from: 'src/data/schema.ts', name: '出身被动类型', source: (c) => fieldUnion(c.blocks, 'OriginPassive', 'kind'), copied: ORIGIN_PASSIVE_KINDS, where: 'ORIGIN_PASSIVE_KINDS' },
  { at: 'ShopData', from: 'src/data/schema.ts', name: '商店字段白名单', source: (c) => interfaceFields(c.blocks, 'ShopData'), copied: [...SHOP_FIELDS], where: 'SHOP_FIELDS' },
  // `SELL_FIELDS` 的主人原来是一行内联对象（`sell: { mul; stackKinds; note }`），形状上没有可指的名。
  // 按 KI-085 对 `burst.feint` 的同一处理：把内联类型提成具名接口 `ShopSell`，抽取器不用长新形状。
  { at: 'ShopSell', from: 'src/data/schema.ts', name: '卖出系数字段', source: (c) => interfaceFields(c.blocks, 'ShopSell'), copied: [...SELL_FIELDS], where: 'SELL_FIELDS' },
  { at: 'ShopStockEntry', from: 'src/data/schema.ts', name: '商店库存字段', source: (c) => interfaceFields(c.blocks, 'ShopStockEntry'), copied: [...STOCK_FIELDS], where: 'STOCK_FIELDS' },
  { at: 'WorldStateRule', from: 'src/data/schema.ts', name: '世界状态规则字段', source: (c) => interfaceFields(c.blocks, 'WorldStateRule'), copied: [...RULE_FIELDS], where: 'RULE_FIELDS' },
  { at: 'WorldStateRule.on', from: 'src/data/schema.ts', name: '规则触发口', source: (c) => fieldUnion(c.blocks, 'WorldStateRule', 'on'), copied: [...RULE_ONS], where: 'RULE_ONS' },
  { at: 'QuestTag', from: 'src/data/schema.ts', name: '§28 任务标注', source: (c) => unionMembers(c.blocks, 'QuestTag'), copied: [...QUEST_TAGS], where: 'QUEST_TAGS' },
  // 主人不在 schema：伪动作那张住在 AI 模块里，是私有常量而不是 export，也不是数组（KI-086 的新形状）
  { at: 'PSEUDO_ACTIONS', from: 'src/ai/Enemy.ts', name: '距离带里的伪动作', source: (c) => setLiterals(c.text, 'PSEUDO_ACTIONS'), copied: [...PSEUDO_ACTIONS], where: 'PSEUDO_ACTIONS' },
  // KI-088：第六种主人是**一个目录**。`FILES` 不是一段数据的值域，它是"校验器去读哪几份表"的工作清单，
  // 真主人是 `src/data/json/` 里躺着的那些文件（语料由 corpusFor 现读目录，见上面那条注释）。
  // 这一行替掉了 KI-086 登记在豁免表里的那句"那个形状今天没有"。
  {
    at: 'src/data/json/ 目录', from: 'src/data/json/', name: '校验器要读的表名册',
    source: (c) => dirListing(c.text, '.json'), copied: FILES, where: 'FILES',
    missHint: '那份 JSON 躺在表目录里而校验器不读它 ⇒ 它永远不过门禁（§55 的死数据，比写错一格更糟：没人会看见它错）',
    extraHint: '名单里有这个文件名而目录里没有 ⇒ 校验器在读一份不存在的表，那条判据从此在空转',
  },
]

/**
 * 没有主人的那几张名单（KI-086 起由 `vocabCoverageErrors` 逐张交代，不再是散在注释里的自述）。
 * 这张名单与 `VOCAB_PAIRS` 一样**只能变短**：一张名单既没登记主人也没登记理由，覆盖普查就红；
 * 登记了理由而名单已经消失，那条豁免该销，也红。
 *
 * 顺手纠正一笔 §2 冒充事实的旧账：KI-074 那时写「`REACTIONS` 的载体不是任何一条声明，
 * 而是 `reactions.json` 的行键加上 R4」——那是**当时**的实话，而 KI-052② 后来补了
 * `IncomingGrade`（R0..R5 全列，正是敌人招式 `AttackSpec.reaction` 那一格的类型）。
 * 今天它有主人，所以 `REACTIONS` 进 `VOCAB_PAIRS` 而不是这张豁免表（判据比注释老，就得改注释）。
 */
const VOCAB_UNPAIRED = [
  {
    name: 'AFFIX_STATS', master: 'src/rpg/Equipment.ts > EquipMods',
    why: '它与 EquipMods 的双向对账已经由 tests/unit/gear-advice.test.ts 在跑——一道门不需要两个主人',
  },
  {
    name: 'AFFIX_BEHAVIORS', master: 'src/rpg/Equipment.ts > EquipMods',
    why: '同上：那张测试把词缀行为与 EquipMods 逐轴对账，这里再配一条声明只是第二个主人',
  },
  {
    name: 'ADVICE_AXES', master: 'src/rpg/Equipment.ts > ADVICE_AXES',
    why: '它是 validateGearAdvice 的函数内临时量而不是模块级词表，且 tests/unit/gear-advice.test.ts 已把它与 `ADVICE_AXES` 逐字对账（KI-060）',
  },
  {
    name: 'VOCAB_PAIRS', master: '（无）',
    why: '对账表自己：一张对象数组而不是词表。普查按形状认名单，所以它会被扫到——把"为什么它不算一张词表"写在这里，而不是在抽取器里开一个特例（特例是藏身处，KI-073 那一族）',
  },
  {
    name: 'VOCAB_UNPAIRED', master: '（无）',
    why: '豁免表自己，同一个道理：它装的是"没有主人"那一侧的账，不是一段数据的值域。判据第一趟就报出这一条——**这张门连自己的新名单都不放过**，那它才不是在给人留余地',
  },
  // KI-093：`SUBJECT_WAIVERS` 也是一张这样的账（它记的是"哪个校验函数刻意不报任何表"，不是值域），
  // 所以对同一道覆盖普查登记。它与 `VOCAB_UNPAIRED` 一样只能变短：函数一旦写出 `const file = '…'`，
  // 那条豁免就由 `validateValidatorMap` 报成"该销了"。
  {
    name: 'SUBJECT_WAIVERS', master: '（无）',
    why: '豁免账而不是词表：一行 = 一个"确实不报任何 JSON"的校验函数加它的理由。它自己的对账由 validateValidatorMap 逐条做（漏登记、条目已失效、没写理由都红），这里只向 KI-086 的覆盖普查交代"它为什么没有一段声明可指"',
  },
]

/**
 * 刻意"不报任何一张表"的那些校验函数（KI-093）。一张表都没有主人的函数只有两类合法理由：
 * ① 它做的是**跨载体**对账（词表 ⇄ 主人），ERROR 记在那些载体名下；② 它管的是校验器自己这份源码。
 * 除这两类之外的一张"什么都不报"的 validateX，就该由 `validateValidatorMap` 报红。
 */
const SUBJECT_WAIVERS = [
  {
    name: 'validateVocabDrift',
    why: '跨载体的词表与覆盖对账：它的 ERROR 记在 schema.ts / src/ai/Enemy.ts / src/data/json/ 目录 / 本文件这些**主人**名下（report 的段名就是它们），FILES 里没有一张表是它管的对象',
  },
  {
    name: 'validateValidatorMap',
    why: '这道门管的就是校验器自己这份源码（`FILES` ⇄ `validateX`），对端不是任何一张 JSON。它自指，所以也必须在这张表上交代自己——否则它第一趟就红，而那一次红是对的：那条缝确实不属于任何一张表',
  },
]

/**
 * 名册 ⇄ 校验函数的对账（KI-093，结案 KI-088 没做①）。三端读数全部**现推**，这里不抄任何名单：
 * 名册 = `arrayLiterals(本文件, 'FILES')`，函数 = `functionBodies(本文件, 'validate')` 逐条配对切体，
 * 每个函数报哪张表 = 它体内 `const file = '…'`，它读了哪张表 = 体内 `data['…']` 加上 `data[file]` 这一种
 * 变量式，调用点 = `calledNames(本文件, 'validate')`。判据本体住 `validator-map-rules.mjs`（两端都要喂合成的）。
 */
function validateValidatorMap() {
  const SELF = 'scripts/validate-data.mjs'
  let text = null
  try { text = readFileSync(resolve(ROOT, SELF), 'utf8') } catch { text = null }
  if (text === null) {
    report.error(SELF, 'map:carrier', `${SELF} 读不到 ⇒ "名册 ⇄ 校验函数"这条对账在空转（工作目录不对？文件改名？）`)
    return
  }
  const validators = (functionBodies(text, 'validate') ?? []).map((b) => ({
    name: b.name,
    bodyOk: b.body !== null,
    subjects: b.body === null ? null : assignedLiterals(b.body, 'file'),
    reads: b.body === null ? null : bracketKeys(b.body, 'data'),
    readsVar: b.body !== null && /\bdata\[file\]/.test(b.body),
  }))
  for (const f of mapFindings({
    file: SELF,
    roster: arrayLiterals(text, 'FILES'),
    validators,
    calls: calledNames(text, 'validate'),
    waivers: SUBJECT_WAIVERS,
  })) report.error(f.file, f.where, f.msg)
}

/**
 * 词表对账（KI-074 / KI-076）：按 `from` 逐份读载体文件（一次一趟，缓存着），把顶上每张手抄名单比一遍。
 * 读不到载体或读不到某条声明都报 ERROR —— **看不见的门比没有门更糟**（它让所有人都以为有人在看）。
 */
function validateVocabDrift() {
  const cache = new Map()
  const corpusFor = (from) => {
    if (!cache.has(from)) {
      try {
        // 以 `/` 结尾的主人是一个**目录**（KI-088）：语料就是"这里面躺着哪些文件"，逐行拼起来交给 dirListing。
        const text = from.endsWith('/')
          ? readdirSync(resolve(ROOT, from)).join('\n')
          : readFileSync(resolve(ROOT, from), 'utf8')
        cache.set(from, { text, blocks: schemaBlocks(text) })
      } catch { cache.set(from, null) }
    }
    return cache.get(from)
  }
  for (const e of vocabDriftErrors({ pairs: VOCAB_PAIRS, corpusFor })) report.error(e.from, e.key, e.msg)
  /* 覆盖面（KI-086）：还剩一个问题没被回答——"每张手抄名单到底有没有交代"（有主人 / 没主人并写明原因）。
     读的是校验器**自己**这份文件，所以它同时钉着抽取器：`handCopiedLists` 一旦读空，
     下面那条反向判据会让每张已入表的本地名单各自红一次——"判据坏了"不会变成静默绿。 */
  const SELF = 'scripts/validate-data.mjs'
  const selfCorpus = corpusFor(SELF)
  if (!selfCorpus) {
    report.error(SELF, 'coverage:carrier', `${SELF} 读不到 ⇒ 覆盖普查在空转（工作目录不对？文件改名？）`)
    return
  }
  const coverage = vocabCoverageErrors({
    file: SELF,
    census: handCopiedLists(selfCorpus.text),
    imported: importedNames(selfCorpus.text) ?? [],
    pairs: VOCAB_PAIRS,
    unpaired: VOCAB_UNPAIRED,
  })
  for (const e of coverage) report.error(e.from, e.key, e.msg)
}

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
/** 每份表的**原文**（KI-082）：坏字符不破坏 JSON 的合法性，只看解析后的对象是看不见它的 */
const sourceText = {}
for (const f of FILES) {
  try {
    const text = readFileSync(resolve(JSON_DIR, f), 'utf8')
    sourceText[f] = text
    data[f] = JSON.parse(text)
  }
  catch (e) { report.error(f, f, `JSON 读取/解析失败：${e.message}`); data[f] = null }
}

// ---- KI-082 文本完整性：数据表里不许有 U+FFFD ----
/**
 * 为什么它要单列一道门：这一族坏字符**不与任何既有判据相交**——文件仍然是合法 JSON、字段仍然对得上
 * `schema.ts`、数值仍然在范围内，只有那一段中文悄悄少了几个字（2026-09-28 实测：`states.json` 的
 * `§2.3` 被压成 `\uFFFD?.3`，成因是另一条并行会话的写盘路径）。判据本体住 `text-integrity.mjs`，
 * 这里只当那张嘴；`where` 报行号 —— 压坏之后连那条 JSON 路径自己都可能读不出来。
 */
for (const f of mojibakeFindings(FILES.map((file) => ({ file, text: sourceText[file] })))) {
  report.error(f.file, f.where, f.msg)
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
    // §14.4 诱饵那两格的可闻带留在这里（缺失/非有限/越界由 `report.num` 全场统一说），
    // 而**关系**（哪一发、延迟、真收尾、盖得住间隔）归 `burst-rules.mjs`——见下面那 4 行。
    if (b.feint !== undefined) report.sub(file, `${where}.burst.feint`, b.feint, { shot: { min: 0, int: true }, punishMs: { min: 1 } })
    for (const f of burstFindings(file, `${where}.burst`, b)) {
      if (f.level === 'warn') report.warn(f.file, f.where, f.msg)
      else report.error(f.file, f.where, f.msg)
    }
  }
  // §4.4 泛音弓分叉四件套（KI-037）：每一格都只在 launchPlayerProjectile 里有读者，
  // 所以"写了没人读的组合"要在这里当场红，而不是等它变成一份看起来像机制的数据。
  if (p.spreadDeg !== undefined) report.num(file, `${where}.spreadDeg`, p.spreadDeg, { min: 0, max: 180, name: 'spreadDeg' })
  if (p.branchDamageMul !== undefined) report.num(file, `${where}.branchDamageMul`, p.branchDamageMul, { min: 0, max: 1, name: 'branchDamageMul' })
  if (p.moveSpreadDeg !== undefined) report.num(file, `${where}.moveSpreadDeg`, p.moveSpreadDeg, { min: 0, max: 45, name: 'moveSpreadDeg' })
  if (p.assistConeDeg !== undefined) report.num(file, `${where}.assistConeDeg`, p.assistConeDeg, { min: 1, max: 180, name: 'assistConeDeg' })
  // 分叉的"形"（spreadDeg）与"价"（branchDamageMul）都挂在连发上：没有 burst 就没有第几枝
  if ((p.spreadDeg !== undefined || p.branchDamageMul !== undefined) && p.burst === undefined) {
    report.error(file, `${where}.spreadDeg`, '分叉角/枝伤写在单发弹道上：没有 burst.count 就没有"第几枝"，这两格没有读者')
  } else if (p.spreadDeg !== undefined && isObj(p.burst) && isNum(p.burst.count) && p.burst.count < 2) {
    report.error(file, `${where}.spreadDeg`, `burst.count=${p.burst.count}：只发一发就无所谓分叉，spreadDeg 没有读者`)
  }
}

/** 帧数据：必填 + 帧序 + 可选项。返回 frames.next（供调用方做引用校验）。 */
function frames(file, where, f) {
  if (!isObj(f)) { report.error(file, where, 'frames 缺失或不是对象'); return undefined }
  // §4.6 双刺（hitPhases）：写了 hitPhases 的帧，damage 那**格**由数组顶（每刺各带各的伤）——
  // 「必填」改读成「两格必须有一格在场」，都缺才报；都在场是两个主人（activeHitbox 只认 hitPhases）。
  if (Array.isArray(f.hitPhases)) {
    if (f.hitPhases.length < 2 || !f.hitPhases.every((d) => isNum(d) && d > 0)) {
      report.error(file, `${where}.hitPhases`, `双刺的段伤数组至少两段、每段为正（现值 ${JSON.stringify(f.hitPhases)}）`)
    }
    if (f.damage !== undefined) report.error(file, `${where}.damage`, '与 hitPhases 同时写 = 同一式伤害的两个主人（写了 hitPhases 就删 damage 格）')
    for (const k of ['startup', 'activeStart', 'activeEnd', 'recovery', 'stamina', 'poise', 'hitStopMs']) {
      report.num(file, `${where}.${k}`, f[k], { min: 0, name: k })
    }
  } else {
    for (const k of ['startup', 'activeStart', 'activeEnd', 'recovery', 'damage', 'stamina', 'poise', 'hitStopMs']) {
      report.num(file, `${where}.${k}`, f[k], { min: 0, name: k })
    }
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
  if (f.worldShake !== undefined && !SHAKES.has(f.worldShake)) report.error(file, `${where}.worldShake`, `worldShake=${JSON.stringify(f.worldShake)} 非法（§10 落帧震场：消费方 Enemy.advanceAttackFrames ⇒ CameraRig.SHAKE_TABLE）`)
  for (const k of ['sfx', 'vfx', 'flags']) if (f[k] !== undefined) strArray(file, `${where}.${k}`, f[k])
  if (f.beatQuant !== undefined) {
    if (!isArr(f.beatQuant)) report.error(file, `${where}.beatQuant`, '必须是数组')
    else f.beatQuant.forEach((n, i) => report.num(file, `${where}.beatQuant[${i}]`, n, { name: 'beatQuant' }))
  }
  if (f.next !== undefined && !isStr(f.next)) report.error(file, `${where}.next`, '必须是非空字符串')
  // §8 反应分级（KI-052①）：招式帧只许点"有腿的那三档"。R4 的主人是对面的 `poise` 列、
  // R5 没有承载体（本作敌人不离地），写在这里就是开一张兑不了现的支票。
  if (f.reaction !== undefined && !['R1', 'R2', 'R3'].includes(f.reaction)) {
    report.error(file, `${where}.reaction`, `reaction=${JSON.stringify(f.reaction)} 非法（帧上只许 R1/R2/R3）`)
  }
  if (f.echoOnHit !== undefined && typeof f.echoOnHit !== 'boolean') report.error(file, `${where}.echoOnHit`, '必须是布尔（§11 回响：命中时是否留下回声）')
  if (f.hitbox !== undefined) hitbox(file, `${where}.hitbox`, f.hitbox)
  // §15.1 P3「外环 20 / 内环 36」（KI-057）：落点分环。**伤害档位的主人是 bands 这张表**，
  // `damage` 在写了 bands 的招式上退为"最深那一档"的读数——两边各写一套就是两个主人，当场红。
  if (f.bands !== undefined) {
    if (file !== 'enemies.json') {
      report.error(file, `${where}.bands`, 'bands 唯一的读者是 Enemy.bandedDamage（敌人落点）⇒ 玩家侧不许写，那是一份读不到的数据')
    } else if (f.projectile !== undefined) {
      report.error(file, `${where}.bands`, '弹体在飞行路上只有一个伤害数，落点档位对它没有意义 ⇒ bands 与 projectile 互斥')
    } else if (!isArr(f.bands) || f.bands.length < 2) {
      report.error(file, `${where}.bands`, 'bands 必须是 ≥2 档的数组（只有一档＝没有分环，走 damage 那一格）')
    } else {
      let prev = -1
      for (const [i, b] of f.bands.entries()) {
        const w = `${where}.bands[${i}]`
        if (!isObj(b)) { report.error(file, w, '必须是 {outer, damage}'); continue }
        for (const k of Object.keys(b)) if (k !== 'outer' && k !== 'damage') report.error(file, `${w}.${k}`, '不认的字段（本档只有 outer/damage）')
        const okO = report.num(file, `${w}.outer`, b.outer, { min: 0, name: 'outer' })
        report.num(file, `${w}.damage`, b.damage, { min: 1, int: true, name: 'damage' })
        // 查表是"由近及远取第一档"，顺序错了就会先撞上外档 ⇒ 内环反而更轻
        if (okO && !(b.outer > prev)) { report.error(file, `${w}.outer`, `bands.outer 必须严格递增（第 ${i} 档 ${b.outer} <= 前一档 ${prev}）`); }
        if (okO) prev = b.outer
      }
      const deepest = f.bands.map((b) => (isObj(b) ? b.damage : NaN)).filter(isNum)
      if (isNum(f.damage) && deepest.length && f.damage !== Math.max(...deepest)) {
        report.error(file, `${where}.damage`, `写了 bands 时 damage 必须等于最深那一档（表里 ${Math.max(...deepest)}，这里 ${f.damage}）——两个主人各说一套`)
      }
      // 可达半径与档位表必须严丝合缝：留缝＝"打得到但不知道吃多少"，超出＝"有一档永远读不到"
      const hb = f.hitbox
      const reach = isObj(hb) ? (hb.shape === 'ring' ? (hb.outer ?? NaN) + (hb.forward ?? 0) : hb.shape === 'sphere' ? hb.radius : NaN) : NaN
      if (!isNum(reach)) report.error(file, `${where}.bands`, 'bands 要求同一条招式上有 ring/sphere hitbox（没有落点就没有"离爆心多远"）')
      else if (isNum(prev) && prev !== reach) report.error(file, `${where}.bands`, `最后一档 outer(${prev}) 必须等于可达外沿(${reach})`)
      // 结算那一格手上只有出手点与目标中心：角、朝向、爆心偏移它都拿不到
      const centered = isObj(hb) && ((hb.shape === 'sphere' && (hb.offsetFwd ?? 0) === 0) || (hb.shape === 'ring' && (hb.forward ?? 0) === 0))
      if (!centered) report.error(file, `${where}.bands`, 'bands 只吃"以出手者为圆心"的形状（sphere offsetFwd=0 / ring forward=0）；cone 与偏心落点没有可用的距离尺')
    }
  }
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
  // whiffDmgMul（§5.3 赌注）卡在 ≥1：<1 就成了「落空反而减伤」，那是奖励不是代价
  report.sub(file, 'parry', p.parry, { activeTicks: { min: 0, int: true }, whiffRecovery: { min: 0, int: true }, whiffDmgMul: { min: 1 }, poiseDamage: { min: 0 }, stunTicks: { min: 0, int: true }, overdriveGain: { min: 0 }, projectileReflectMul: { min: 0, max: 1 } })
  report.sub(file, 'roll', p.roll, { total: { min: 0, int: true }, iframeStart: { min: 0, int: true }, iframeEnd: { min: 0, int: true }, dist: { min: 0 }, backDist: { min: 0 }, stamina: { min: 0 }, lockOnTotal: { min: 1, int: true }, lockOnDist: { min: 0 }, lockOnStamina: { min: 1 } })
  report.sub(file, 'execution', p.execution, {
    hpFrac: { min: 0, max: 1 }, flat: { min: 0 }, stealthKillFrac: { min: 0, max: 1 }, backstabConeDeg: { min: 0, max: 180 },
    backstabRange: { min: 0 }, crumpleRange: { min: 0 }, overdriveCost: { min: 0 }, overdriveFrac: { min: 0, max: 1 },
    overdriveFlat: { min: 0 }, durationTicks: { min: 0, int: true }, firstBladeHitStopMs: { min: 0 },
  })
  // §9「Hitstop 时长分级表」里玩家是守方的四行（KI-017 第四步：这四个数曾写死在 CombatManager 里）
  if (!isObj(p.hitStop)) report.error(file, 'hitStop', '缺失：§9 的四行情境停顿必须有来源，代码里不留第二个数')
  else {
    report.sub(file, 'melee', p.melee, { impactLoudness: { min: 0.0001, max: 1 }, killNoiseLoudness: { min: 0.0001, max: 1 } })
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
  // 需求 §34 锁定的四个数（KI-084，TD-005 的入表腿）：唯一读者是 `player/LockOn.ts`，构造时注入。
  // 两条**关系**判据（Boss 加分 vs 距离项跨度、跨度 vs 90° 的角度惩罚）住在 `lockon-rules.mjs`，这里只当
  // 那张把 findings 报成 ERROR 的嘴 —— 留在本文件就没法在测试里"喂一组对不上的数看它拒不拒"（同一族理由见
  // `lockon-rules.mjs` 顶部：本文件一被 import 就跑真表并 `process.exit`），
  // 而那两句文档说的是数与数之间的序关系，`report.num` 一次只看一个字段，表达不出来。
  for (const f of lockOnFindings(p.lockOn)) report.error(f.file, f.where, f.msg)
  // 四个数各自的可闻带仍走 `report.sub`：缺失 / 非有限数 / 越界那三种说法全场由它一家管，搬走就是第二个主人。
  if (isObj(p.lockOn)) report.sub(file, 'lockOn', p.lockOn, { range: { min: 0.1 }, aimWeight: { min: 0.0001 }, distWeight: { min: 0.0001 }, bossBonus: { min: 0 } })
  report.sub(file, 'rankXpCurve', p.rankXpCurve, { base: { min: 0 }, a: { min: 0 }, b: { min: 0 } })
  report.sub(file, 'attrs', p.attrs, Object.fromEntries([...ATTR_KEYS].map((k) => [k, { min: 0 }])))

  // 区间序关系：§5.5 那两行**各自**成立——免伤窗要住在自己那一行的时长里。
  // `lockOnIframes` 以前比的是 `total`（自由翻滚那 30 拍），所以把侧步时长改成 8 拍也不会红：
  // 那条判据量的是**另一行**的长度（KI-090 纠正）。
  if (isObj(p.roll)) {
    const { total, iframeStart, iframeEnd, lockOnTotal, lockOnIframes } = p.roll
    if ([total, iframeStart, iframeEnd].every(isNum) && !(iframeStart <= iframeEnd && iframeEnd <= total)) {
      report.error(file, 'roll', `需 iframeStart(${iframeStart}) <= iframeEnd(${iframeEnd}) <= total(${total})`)
    }
    if (lockOnIframes !== undefined) {
      if (!isArr(lockOnIframes) || lockOnIframes.length !== 2) report.error(file, 'roll.lockOnIframes', '必须是 [start, end] 两元素数组')
      else {
        lockOnIframes.forEach((n, i) => report.num(file, `roll.lockOnIframes[${i}]`, n, { min: 0, int: true, name: 'lockOnIframes' }))
        if (lockOnIframes.every(isNum) && isNum(lockOnTotal) && !(lockOnIframes[0] <= lockOnIframes[1] && lockOnIframes[1] <= lockOnTotal)) {
          report.error(file, 'roll.lockOnIframes', `需 start <= end <= roll.lockOnTotal(${lockOnTotal})：侧步的免伤窗住在侧步的时长里，不是自由翻滚那一行里`)
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
// `WEAPON_FIELDS`（WeaponData 的字段全集，KI-047）住在文件顶部的词表区：
// 它的主人由 VOCAB_PAIRS 现场读，而那张表在模块求值时就要引用名单本身，所以声明必须在那之前。

function validateWeapons(movesetIds) {
  const file = 'weapons.json'
  const list = data[file]
  const ids = new Set()
  const movesetOwners = new Map() // movesetId -> 第一把引用它的武器
  if (!isArr(list)) { report.error(file, file, '顶层必须是数组'); return ids }
  list.forEach((wp, i) => {
    if (!isObj(wp)) { report.error(file, `[${i}]`, '必须是对象'); return }
    const w = isStr(wp.id) ? wp.id : `[${i}]`
    if (!isStr(wp.id)) report.error(file, w, 'id 缺失或非字符串')
    else if (ids.has(wp.id)) report.error(file, w, `id 重复：${wp.id}`)
    else ids.add(wp.id)
    for (const k of Object.keys(wp)) {
      if (!WEAPON_FIELDS.has(k)) report.error(file, `${w}.${k}`, 'WeaponData 没有这个字段：无消费方的数据不许入表（§55/KI-047）')
    }
    if (!isStr(wp.nameKey)) report.error(file, w, 'nameKey 缺失或非字符串')
    if (!WEAPON_ARCHETYPES.has(wp.archetype)) report.error(file, w, `archetype=${JSON.stringify(wp.archetype)} 非法`)
    if (!isStr(wp.movesetId)) report.error(file, w, 'movesetId 缺失或非字符串')
    else if (!movesetIds.has(wp.movesetId)) report.error(file, w, `movesetId 悬空引用：'${wp.movesetId}' 不在 movesets.json`)
    else {
      // 武器↔moveset 一对一（KI-047）：帧表就是武器的价格本身，共用 ⇒ 两把武器永远同价
      const prev = movesetOwners.get(wp.movesetId)
      if (prev) report.error(file, w, `movesetId ${wp.movesetId} 已被 ${prev} 使用：武器↔moveset 必须一对一，新武器要带自己的架式表`)
      else movesetOwners.set(wp.movesetId, w)
    }
    if (!isObj(wp.scaling)) report.error(file, `${w}.scaling`, '必须是对象')
    else for (const [k, v] of Object.entries(wp.scaling)) {
      if (!ATTR_KEYS.has(k)) report.error(file, `${w}.scaling.${k}`, `未知属性键 '${k}'（${[...ATTR_KEYS].join('/')}）`)
      else report.num(file, `${w}.scaling.${k}`, v, { min: 0, name: k })
    }
    strArray(file, `${w}.swingTag`, wp.swingTag, { nonEmpty: true })
    if (wp.skill !== undefined && !isStr(wp.skill)) report.error(file, `${w}.skill`, '缺失或非字符串')
    if (wp.stealthKillFrac !== undefined) report.num(file, `${w}.stealthKillFrac`, wp.stealthKillFrac, { min: 0, max: 1, name: 'stealthKillFrac' })
    if (wp.heavyAlertBackstab !== undefined && typeof wp.heavyAlertBackstab !== 'boolean') report.error(file, `${w}.heavyAlertBackstab`, '必须是布尔')
    if (wp.poiseMul !== undefined) report.num(file, `${w}.poiseMul`, wp.poiseMul, { min: 0, name: 'poiseMul' })
    if (wp.noiseMul !== undefined) report.num(file, `${w}.noiseMul`, wp.noiseMul, { min: 0, name: 'noiseMul' })
    // §4.4 距离衰减档位（武器级，KI-037）：由近及远逐档查，只许越远越轻
    if (wp.falloff !== undefined) {
      if (!isArr(wp.falloff) || wp.falloff.length === 0) report.error(file, `${w}.falloff`, '必须是非空数组（一档都没有＝没有衰减，写它干什么）')
      else {
        let prev = -1
        for (const [i, b] of wp.falloff.entries()) {
          const bw = `${w}.falloff[${i}]`
          if (!isObj(b)) { report.error(file, bw, '必须是 {beyond, mul}'); continue }
          for (const k of Object.keys(b)) if (k !== 'beyond' && k !== 'mul') report.error(file, `${bw}.${k}`, '不认的字段（本档只有 beyond/mul）')
          const okB = report.num(file, `${bw}.beyond`, b.beyond, { min: 0, name: 'beyond' })
          const okM = report.num(file, `${bw}.mul`, b.mul, { min: 0, max: 1, name: 'mul' })
          if (okB && !(b.beyond > prev)) report.error(file, `${bw}.beyond`, `falloff.beyond 必须严格递增（第 ${i} 档 ${b.beyond} <= 前一档 ${prev}）`)
          if (okB) prev = b.beyond
          const prevMul = isObj(wp.falloff[i - 1]) ? wp.falloff[i - 1].mul : undefined
          if (okM && isNum(prevMul) && !(b.mul < prevMul)) {
            report.error(file, `${bw}.mul`, `falloff.mul 必须随距离递减（第 ${i} 档 ${b.mul} 不轻于前一档 ${prevMul}）`)
          }
        }
      }
    }
  })
  return ids
}

// ---- progression.json ----
// 出身被动的类型白名单 `ORIGIN_PASSIVE_KINDS`（KI-031③：加一种 kind = 承诺带来一个消费者）住在顶部词表区
function validateProgression() {
  const file = 'progression.json'
  const d = data[file]
  const rarityIds = new Set()
  const attrKeys = new Set()
  const originPassives = []
  if (!isObj(d)) { report.error(file, file, '顶层必须是对象'); return { rarityIds, attrKeys, originPassives } }
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
  // 里程碑：rank 必须在曲线范围内。KI-054 起「一行承诺一条腿」——每行必须满足四者之一：
  // ① 带 grant（Progression.derive 逐项消费，字段白名单在 GRANT_FIELDS）；
  // ② 被 movements.json slots[].milestone 引用（既有消费者，不重复挂腿）；
  // ③ 出现在 PENDING_MILESTONE_GRANTS 且理由非空（先记账后接线；**销账有判据**，KI-073：有腿不销 ⇒ ERROR。
  //    "清单只许变短"那半句从前是空话——新记一条欠账是虚是实机器不知道，所以变长这一侧由 review 管，
  //    而"该销未销"这一侧从今天起是门）；
  // ④ 被 UI 承载体按 id 消费（UI_BOUND_MILESTONES，腿由 hud-milestones 测试作证，KI-031①）。
  // 这条规则的存在理由：§8.2 的 label 是玩家面向的数值承诺，此前 11 行里 9 行没有任何机制承载。
  // GRANT_FIELDS 已提到模块层（词表对账要读它；见文件顶部的 VOCAB_PAIRS）
  // ④ UI 腿（KI-031①）：行的消费方是 HUD 组件，unlock rank 由 Hud.milestoneRank **按 id 现查现用**
  // （不是构造期快照）。承载体在表现层、derive 摸不到，所以这一形式的证人不是字段白名单，
  // 是 tests/unit/hud-milestones.test.ts：rank A/B、改表法、删行⇒功能永不亮，三条腿都咬住表。
  // 两份名单住在 scripts/ledger-rules.mjs（销账判据与单元测试都读同一份；复制或切字符串都是第二个主人）
  const movementMsIds = new Set((Array.isArray(data['movements.json']?.slots) ? data['movements.json'].slots : [])
    .map((s) => (isObj(s) ? s.milestone : undefined)).filter(isStr))
  if (!isArr(d.milestones)) report.error(file, 'milestones', '必须是数组')
  else d.milestones.forEach((m, i) => {
    const w = `milestones[${i}]`
    if (!isObj(m)) { report.error(file, w, '必须是对象'); return }
    report.num(file, `${w}.rank`, m.rank, { min: 2, max: d.maxRank, int: true, name: 'rank' })
    if (!isStr(m.id)) report.error(file, `${w}.id`, '必填')
    if (!isStr(m.label)) report.error(file, `${w}.label`, '必填（§8.2「你新能做什么」）')
    if (m.grant !== undefined) {
      if (!isObj(m.grant)) report.error(file, `${w}.grant`, '必须是对象')
      else {
        if (Object.keys(m.grant).length === 0) report.error(file, `${w}.grant`, '空对象＝没有腿，删掉它并走 pending 清单')
        for (const [k, v] of Object.entries(m.grant)) {
          if (!GRANT_FIELDS.includes(k)) report.error(file, `${w}.grant.${k}`, `不认的 grant 字段（只认 ${GRANT_FIELDS.join('/')}；加字段必须同时在 Progression.derive 接线）`)
          else report.num(file, `${w}.grant.${k}`, v, { name: k })
        }
      }
    } else if (!movementMsIds.has(m.id) && !(m.id in PENDING_MILESTONE_GRANTS) && !(m.id in UI_BOUND_MILESTONES)) {
      report.error(file, w, `里程碑无机制腿：既无 grant、也不被战技槽/UI 承载体引用、也不在 PENDING_MILESTONE_GRANTS（KI-054/KI-031①）`)
    }
  })
  /**
   * **销账判据（KI-073）**。上面那条规则管的是"没腿又不记账 ⇒ 红"；它管不到的是反面——
   * 腿已经接上了，账还挂着，于是**理由那句话从此说谎**。这不是假想：本批动手前实测，
   * `PENDING_MILESTONE_GRANTS.ms_deepcellar` 写着「区域侧还没有"停留时长"这个量，无腿可接」,
   * 而表里那一行早在 KI-054③ 就有了 `grant.corruptionStayPct: 35`（label 也已改成"失谐耐受 +1 档"）。
   * 规则③只在 `grant` 缺席时才去查名单，所以这条死条目既不报错也不被任何读者用上——
   * 一份"只能变短"的清单，缺的正是"变短"这一步的机器判据。
   *
   * 两份名单不对称，理由是它们各自承诺的不是同一件事：pending 承诺的是**没有腿**（一有腿就被证伪），
   * UI_BOUND 承诺的是**承载体在表现层**（字段腿与它并存不构成为假，例如某个 HUD 刻度同时给负重加成）。
   * 所以"有腿就红"只对 pending 用；两边共用的是"id 必须还在表里"。
   */
  /**
   * **身份效果表**（§8.2「任一维触及 35 = 该维专属效果」，KI-138）的判据。
   *
   * ① 那一维必须在 `progression.json > attrs` 里（不认识的维 = 永远不触发）；
   * ② 门槛必须是正数（0 意味着"出生即有"，那不是"触及 35"）；
   * ③ `grant` 不许空（空效果 = 一行没人读的数据）；
   * ④ grant 的字段必须在 `GRANT_FIELDS` 里（加字段必须同时在 `Progression.derive` 接线）；
   * ⑤ **门槛的里程碑必须存在**（`ms_identity`）——那一行是"终局那一档"的 rank 主人。
   */
  const identityRows = d.identityEffects
  if (identityRows !== undefined) {
    if (!isArr(identityRows)) report.error(file, 'identityEffects', '必须是数组（可以为空数组，但不能缺类型）')
    else {
      const attrKeys = new Set((d.attrs ?? []).map((a) => a?.key).filter((k) => isStr(k)))
      const msIds = new Set((d.milestones ?? []).map((m) => m?.id).filter((x) => isStr(x)))
      identityRows.forEach((row, i) => {
        const w = `identityEffects[${i}]`
        if (!isObj(row)) { report.error(file, w, '必须是对象'); return }
        if (!isStr(row.attr) || !attrKeys.has(row.attr)) {
          report.error(file, `${w}.attr`, `悬空引用：'${row.attr}' 不在 progression.json > attrs 里`)
        }
        if (!isNum(row.min) || row.min <= 0) report.error(file, `${w}.min`, '必须是正数（"触及 35"的那个门槛）')
        if (!isStr(row.label)) report.error(file, `${w}.label`, 'label 必填（面板/里程碑要念它）')
        if (!isObj(row.grant) || Object.keys(row.grant).length === 0) {
          report.error(file, `${w}.grant`, '必须带至少一个效果字段（空效果 = 一行没人读的数据）')
        } else {
          for (const k of Object.keys(row.grant)) {
            if (!GRANT_FIELDS.includes(k)) report.error(file, `${w}.grant.${k}`, `不认的 grant 字段（只认 ${GRANT_FIELDS.join('/')}）`)
            if (!isNum(row.grant[k])) report.error(file, `${w}.grant.${k}`, '必须是有限数')
          }
        }
        if (!msIds.has('ms_identity')) report.error(file, w, '门槛里程碑 ms_identity 不在 milestones 里：身份效果没有 rank 门槛')
      })
    }
  }

  for (const e of milestoneLedgerErrors({ pending: PENDING_MILESTONE_GRANTS, uiBound: UI_BOUND_MILESTONES, rows: d.milestones, movementMsIds })) {
    report.error(file, e.key, e.msg)
  }
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
      // §2.2 出身被动（KI-031③）：kind 白名单——每加一种 kind 都必须同时带来一个消费者；
      // itemId 的悬空与"没人掉它"两问要等 items/loot 跑完，先收集、稍后各答一次。
      if (o.passive !== undefined) {
        const pw = `${w}.passive`
        if (!isObj(o.passive)) report.error(file, pw, '必须是对象')
        else {
          if (!ORIGIN_PASSIVE_KINDS.includes(o.passive.kind)) report.error(file, `${pw}.kind`, `不认的被动类型：'${o.passive.kind}'（白名单：${ORIGIN_PASSIVE_KINDS.join(' / ')}）`)
          if (isStr(o.passive.itemId)) originPassives.push({ w: `${w}.passive`, itemId: o.passive.itemId })
          else report.error(file, `${pw}.itemId`, '必填（非空字符串）')
          report.num(file, `${pw}.mul`, o.passive.mul, { min: 1, name: 'mul' })
          if (!isStr(o.passive.label)) report.error(file, `${pw}.label`, '必填——被动是给玩家看的一句话，卡面要显示它')
        }
      }
    })
    if (totals.size > 1) report.error(file, 'origins', `各出身六维合计必须一致，实际出现：${[...totals].join(' / ')}`)
  }
  // §44 建议星标的权重表（KI-060）。这里的职责只有两件：**别让表指向不存在的轴**，
  // 以及**别让表变成一堆 NaN**。至于权重本身合不合理，那是数值裁决，不是校验器的活。
  // 轴名单是手抄的（脚本读不到 TS 类型），所以它由 tests/unit/gear-advice.test.ts 与
  // `Equipment.ADVICE_AXES` 逐字对账——抄漏一条，那条测试就红。
  const ADVICE_AXES = ['defense', 'weight', 'critRate', 'poiseDmgMul', 'staminaRegenMul', 'execMul',
    'noiseMul', 'perfectBlockBonusTicks', 'lightStartupTicks', 'bellBonus', 'restOverdrive',
    'skillDmg', 'lootLuck', 'weaponDamageMul', 'comboScaling']
  if (!isObj(d.gearAdvice)) report.error(file, 'gearAdvice', '必须有（§44 那一栏的权重表；缺了它面板就不该画星标，而不是拿一套代码内置数字继续标）')
  else {
    for (const k of Object.keys(d.gearAdvice)) if (!['weights', 'note'].includes(k)) report.error(file, `gearAdvice.${k}`, '没有消费方')
    const w = d.gearAdvice.weights
    if (!isObj(w) || Object.keys(w).length === 0) report.error(file, 'gearAdvice.weights', '必须是非空对象（空表 = 星标永远不落，那还不如没有这一栏）')
    else {
      for (const [axis, v] of Object.entries(w)) {
        if (!ADVICE_AXES.includes(axis)) report.error(file, `gearAdvice.weights.${axis}`, `不存在的轴：EquipMods 没有这一项（可写轴：${ADVICE_AXES.join(', ')}）`)
        if (typeof v !== 'number' || !Number.isFinite(v)) report.error(file, `gearAdvice.weights.${axis}`, '轴权重必须是有限数（负数合法：负重与噪音越低越好）')
      }
    }
  }
  return { rarityIds, attrKeys, affixDefs, originPassives }
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
  for (const id of STATUS_IDS) if (d[id] === undefined) report.error(file, id, `缺少 '${id}' 这一行（名册里有它；名册的主人是 EventBus.STATUS_IDS，这里读的是它的手抄，两边由词表对账钉住）`)
  // 同一个名册在本文件里还有两张派生表（字段白名单 / 取值范围）。三张表必须同一批行——判据在
  // `ledger-rules.mjs`（KI-076），这样合成名册也测得动它，而不是只有真表跑一遍。
  for (const e of statusLedgerErrors({ roster: STATUS_IDS, fields: STATUS_FIELDS, specs: STATUS_SPECS })) report.error(file, e.key, e.msg)
  for (const [id, s] of Object.entries(d)) {
    if (!STATUS_IDS.includes(id)) { report.error(file, id, `'${id}' 不是五状态之一：要加就得同时补进 EventBus.STATUS_IDS 并接上消费方`); continue }
    if (!isObj(s)) { report.error(file, id, '必须是对象'); continue }
    if (!isStr(s.tag)) report.error(file, `${id}.tag`, '缺失或非字符串')
    else if (s.tag.split('.').pop() !== id) report.error(file, `${id}.tag`, `tag 末段必须等于 '${id}'（StatusGlossary 与 tagIs 都按末段判），实为 '${s.tag}'`)
    if (!isStr(s.displayName)) report.error(file, `${id}.displayName`, '必填')
    if (!isStr(s.desc) || s.desc.length < 5) report.error(file, `${id}.desc`, '需要一句世界内解释（§19 的 tooltip）')
    for (const k of Object.keys(s)) {
      if (!(STATUS_FIELDS[id] ?? []).includes(k)) report.error(file, `${id}.${k}`, `不认的字段：§55 不许写没有消费方的数据（本状态可用：${(STATUS_FIELDS[id] ?? []).join('/')}）`)
    }
    report.sub(file, id, s, STATUS_SPECS[id] ?? {})
    if (id === 'fissure') {
      report.sub(file, `${id}.burst`, s.burst, { trueDamage: { min: 0 }, poise: { min: 0 } })
      if (isNum(s.dmgMulPerLayer) && s.dmgMulPerLayer >= 1) report.error(file, `${id}.dmgMulPerLayer`, `每层 +${s.dmgMulPerLayer} >= 100%：满层就是倍率怪物，请回到 0.x`)
    }
    if (id === 'corruption' && isNum(s.visualStart) && isNum(s.max) && !(s.visualStart < s.max)) {
      report.error(file, id, `visualStart(${s.visualStart}) 必须小于 max(${s.max})，否则去饱和永远不会渐入`)
    }
  }
}

// ---- reactions.json ----
/** §8 受击反应表：只许写有承载体的行（KI-050 立规，KI-052① 补齐分级那三档）。一行一消费口，加行必须先接线 */
const REACTION_FIELDS = {
  // 消费方：ai/Enemy.onDamaged（§8 R0「架势未破，仅抖动材质发光」——材质发光时长是这一档的全部产品）
  R0: ['flashMs'],
  // 消费方：player/ThirdPersonController.takeDamage（玩家受击一律 R1 等效）+ CombatManager.applyReactionTier（玩家轻击打在敌人身上）
  R1: ['stunMs', 'displaceM'],
  // 消费方：CombatManager.applyReactionTier（重击 / 战技出手的默认档，TIER_BY_KIND）
  R2: ['stunMs', 'displaceM'],
  // 消费方：同上，但要有招式帧的 `reaction:"R3"` 声明才走这一档（今天只有 §4.2 强音大剑跳劈点名）
  R3: ['stunMs', 'displaceM'],
  R4: ['crumpleMs', 'bossCrumpleMs'], // 消费方：combat/EntityStats.addPoise（经 armCrumple 上弦）
}
const REACTION_SPECS = {
  R0: { flashMs: { min: 1 } },
  R1: { stunMs: { min: 1 }, displaceM: { min: 0 } },
  R2: { stunMs: { min: 1 }, displaceM: { min: 0 } },
  R3: { stunMs: { min: 1 }, displaceM: { min: 0 } },
  R4: { crumpleMs: { min: 1 }, bossCrumpleMs: { min: 1 } },
}

function validateReactions() {
  const file = 'reactions.json'
  const d = data[file]
  if (!isObj(d)) { report.error(file, file, '顶层必须是对象（按 R 行名键控）'); return }
  for (const id of Object.keys(REACTION_FIELDS)) {
    if (d[id] === undefined) report.error(file, id, `缺少 '${id}' 这一行：它已有消费方（onDamaged / takeDamage / applyReactionTier / addPoise），缺行就是运行时抛错`)
  }
  for (const [id, row] of Object.entries(d)) {
    if (!REACTION_FIELDS[id]) { report.error(file, id, `'${id}' 在这份 build 里没有承载体：§55 不许写没有消费方的行（R5 浮空＝敌人不会离地，见 KI-052）`); continue }
    if (!isObj(row)) { report.error(file, id, '必须是对象'); continue }
    for (const k of Object.keys(row)) {
      if (!REACTION_FIELDS[id].includes(k)) report.error(file, `${id}.${k}`, `不认的字段：新字段必须同时接上消费方（本行可用：${REACTION_FIELDS[id].join('/')}）`)
    }
    report.sub(file, id, row, REACTION_SPECS[id])
  }
  // 分级序：R1 < R2 < R3 必须是"越重越疼"，否则这张表是在奖励用轻击
  const tiers = ['R1', 'R2', 'R3'].map((id) => (isObj(d[id]) ? d[id] : null))
  if (tiers.every(Boolean)) {
    const [t1, t2, t3] = tiers
    if (!(t1.stunMs <= t2.stunMs && t2.stunMs <= t3.stunMs)) report.error(file, 'R1/R2/R3', `硬直时长必须递增：${t1.stunMs}/${t2.stunMs}/${t3.stunMs}`)
    if (!(t1.displaceM <= t2.displaceM && t2.displaceM <= t3.displaceM)) report.error(file, 'R1/R2/R3', `位移必须递增：${t1.displaceM}/${t2.displaceM}/${t3.displaceM}`)
  }
  const r4 = isObj(d.R4) ? d.R4 : null
  if (r4 && isNum(r4.crumpleMs) && isNum(r4.bossCrumpleMs) && r4.bossCrumpleMs < r4.crumpleMs) {
    report.error(file, 'R4', `bossCrumpleMs(${r4.bossCrumpleMs}) 必须 ≥ crumpleMs(${r4.crumpleMs})：Boss 不该比小兵破势更短`)
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
    // 装备件必须写 value：营地卖价 = value × shop.sell.mul（KI-055），缺了它就是一件"卖不出钱"的装备
    if (gearKind && !(isNum(it.value) && it.value > 0)) report.error(file, `${w}.value`, '装备件必须写正数 value（营地交易的卖价底数，shop.json sell.mul 乘在它上面）')
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
          if (k !== 'heal' && k !== 'corruption' && k !== 'throw' && k !== 'inspect') report.error(file, `${w}.use.${k}`, '没有消费方（use 只认 heal/corruption/throw/inspect——KI-023① 声东击西 + KI-046 检视动词）')
          if (k === 'inspect' && (typeof it.use.inspect !== 'string' || it.use.inspect.trim().length === 0)) {
            report.error(file, `${w}.use.inspect`, 'inspect 必须是非空字符串（检视文本：Inventory.inspect 播报的就是它）')
          }
          if (k === 'throw' && isObj(it.use.throw)) {
            const t = it.use.throw
            for (const [tk, tv] of Object.entries(t)) {
              if (typeof tv !== 'number' || !Number.isFinite(tv)) report.error(file, `${w}.use.throw.${tk}`, '必须是有限数字')
            }
            if (!(t.speed > 0) || !(t.range > 0) || !(t.gravity >= 0) || !(t.loudness > 0 && t.loudness <= 1) || !(t.radius > 0)) {
              report.error(file, `${w}.use.throw`, 'speed/range/radius/loudness(0,1]/gravity 必须在合法区间')
            }
          }
        }
        // 「至少写一个用法」那一句必须与本条**同一个名单**：只写 `throw` 的消耗品（一颗只会被扔出去的
        // 晶石）是合法的，而条件里漏掉 throw 时上面那句新措辞就是假的（说认三种、实际只认两种）。
        if (it.use.heal === undefined && it.use.corruption === undefined && it.use.throw === undefined && it.use.inspect === undefined) {
          report.error(file, `${w}.use`, '必须至少写 heal/corruption/throw/inspect 之一，否则这个 use 没有消费方')
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

// ---- shop.json（营地交易，KI-055） ----
// `SHOP_FIELDS`/`SELL_FIELDS`/`STOCK_FIELDS` 住在顶部词表区（主人分别是 ShopData / ShopSell / ShopStockEntry）
/**
 * 交易的三条红线全部做成机器形状（§6.3「无风险套利禁止」）：
 * 清单只许 consumable、卖系数严格在 (0,1)、条目引用的件必须真存在且价是正整数。
 * 为什么钉得这么死：这三条只要松一条，「买→卖」或「买材料→强化→卖装」就会变成印钞机，
 * 而印钞机一旦发生，整个 §6 的经济设计（拾取即收入）就不再是收入的来源。
 */
function validateShop(items) {
  const itemKinds = new Map(items.map((it) => [it.id, it.kind]))
  const kindsPresent = new Set(items.map((it) => it.kind))
  const file = 'shop.json'
  const d = data[file]
  if (!isObj(d)) { report.error(file, file, '顶层必须是对象'); return }
  for (const k of Object.keys(d)) if (!SHOP_FIELDS.has(k)) report.error(file, k, '没有消费方（ShopData 不读它）')
  if (d.id !== 'shop') report.error(file, 'id', "必须是 'shop'（registerGameData 以此 id 入注册表）")
  if (!isObj(d.sell)) report.error(file, 'sell', '必须是 { mul, stackKinds, note? }')
  else {
    for (const k of Object.keys(d.sell)) if (!SELL_FIELDS.has(k)) report.error(file, `sell.${k}`, '没有消费方')
    if (report.num(file, 'sell.mul', d.sell.mul, { name: 'mul' })) {
      if (d.sell.mul <= 0) report.error(file, 'sell.mul', `${d.sell.mul}：卖出价为 0 等于没有这条经济出口（§6.3 是「档价×50%」，不是「销毁装备」）`)
      if (d.sell.mul >= 1) report.error(file, 'sell.mul', `${d.sell.mul}：≥1 让「买→卖」回环不亏钱，直接违反 §6.3 反通胀红线`)
    }
  }
  if (!isArr(d.stock) || d.stock.length === 0) { report.error(file, 'stock', '必须是非空数组（没有清单就没有买这条腿）'); return }
  const seen = new Set()
  d.stock.forEach((e, i) => {
    const w = isStr(e?.id) ? e.id : `stock[${i}]`
    if (!isObj(e)) { report.error(file, w, '必须是对象'); return }
    for (const k of Object.keys(e)) if (!STOCK_FIELDS.has(k)) report.error(file, `${w}.${k}`, '没有消费方')
    if (!isStr(e.id)) report.error(file, w, 'id 缺失')
    else if (seen.has(e.id)) report.error(file, w, `id 重复：${e.id}（买按钮按 id 派发，同名就会买错东西）`)
    else seen.add(e.id)
    const kind = itemKinds.get(e.item)
    if (kind === undefined) { report.error(file, `${w}.item`, `悬空引用：'${e.item}' 不在 items.json`); return }
    if (kind !== 'consumable') report.error(file, `${w}.item`, `'${e.item}' 是 ${kind}：买清单只许 consumable（§6.3 强化材料/乐谱不可购，装备可购则卖装腿变印钞机）`)
    report.num(file, `${w}.price`, e.price, { min: 1, int: true, name: 'price' })
  })
  // ---- 堆叠件出售那一腿（KI-059，需求 §6 收入表「出售战利品（残骸→石）」）----
  // 排在 stock 之后跑：这条腿唯一真正会坏的地方就是它与"买"那条腿的关系，
  // 而对账要用到清单里的 kind，所以顺序本身是判据的一部分（挪到前面就读不到 stock）。
  if (isObj(d.sell) && !isArr(d.sell.stackKinds)) {
    report.error(file, 'sell.stackKinds', '必须是数组（缺了它，Shop.stackSellKinds() 在运行时才炸，门禁不该等到运行时）')
  } else if (isObj(d.sell) && isArr(d.sell.stackKinds)) {
    const sk = d.sell.stackKinds
    if (sk.length === 0) report.error(file, 'sell.stackKinds', '空数组等于关掉这条出口（§6 收入表那行落空）')
    const unknown = sk.filter((k) => !kindsPresent.has(k))
    if (unknown.length) report.error(file, 'sell.stackKinds', `这些 kind 在 items.json 里一件都没有：${unknown.join(', ')}（名单里写不存在的类别 = 这一腿永远卖不出东西）`)
    // 装备类一律禁止：装备只认实例（uid 才是卖家），按类别卖就绕过了「强化沉没不反还」那道闸
    const gear = sk.filter((k) => k === 'weapon' || k === 'armor' || k === 'seal')
    if (gear.length) report.error(file, 'sell.stackKinds', `装备类不得按数量卖：${gear.join(', ')}（卖价只看件底数靠的就是"装备只能按实例卖"）`)
    if (sk.includes('currency')) report.error(file, 'sell.stackKinds', '通货不能卖：把货币换算成货币是无中生有')
    // 反套利的机器形状：**可买的类别与可卖的类别不相交**。今天 stock 只有 consumable，
    // 于是"买来的消耗品卖不掉"不靠自觉，靠这一行。
    const buyKinds = new Set(d.stock.map((e) => itemKinds.get(e?.item)).filter((k) => k !== undefined))
    const both = sk.filter((k) => buyKinds.has(k))
    if (both.length) report.error(file, 'sell.stackKinds', `与 stock 的 kind 相交：${both.join(', ')} ⇒ 买回再卖这一圈开始印石，违反 §6.3「无风险套利禁止」`)
    // 名单非空、类别也存在，却一件都卖不掉（全是 value 0）＝这条腿在空转
    if (!unknown.length) {
      const sellable = items.filter((it) => sk.includes(it.kind) && isNum(it.value) && it.value > 0)
      if (sellable.length === 0) report.error(file, 'sell.stackKinds', '名单里的类别没有任何一件写了正数 value ⇒ 这一腿空转')
    }
  }
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
      // 分级只有一个主人：敌人这一侧住在 AttackSpec.reaction，帧上再写一份就是两个来源（KI-052①）
      if (isObj(a.frames) && a.frames.reaction !== undefined) {
        report.error(file, `${aw}.frames.reaction`, '敌人招式的反应分级住在这条招式行的 reaction，不许在帧上再写一份')
      }
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
            // 阶段级拍速（§15.2 Finale「网格加速至 120BPM」）：全场网格被它接管，所以卡在能弹人的区间外
            if (ph.bpm !== undefined) report.num(file, `${pw}.bpm`, ph.bpm, { min: 20, max: 300, name: 'bpm' })
            if (ph.beatsPerBar !== undefined) report.num(file, `${pw}.beatsPerBar`, ph.beatsPerBar, { min: 1, int: true, name: 'beatsPerBar' })
            // 前摇倍率必须是"缩短"：≥1 那一侧的加速已经有主人（§14.6 定调光环的 attackSpeedMul），
            // 两处都能加速就会互相掩盖，而 §15.2 那句说的是"前摇 -20%"。
            if (ph.startupMul !== undefined) report.num(file, `${pw}.startupMul`, ph.startupMul, { min: 0.05, max: 0.99, name: 'startupMul' })
            if (ph.interruptOnHit !== undefined && typeof ph.interruptOnHit !== 'boolean') report.error(file, `${pw}.interruptOnHit`, '必须是布尔（§15.2「受击即断」）')
            // KI-024 场地阶段入口与本阶的聋乱/振动载荷
            if (ph.deaf !== undefined && typeof ph.deaf !== 'boolean') report.error(file, `${pw}.deaf`, '必须是布尔（聋乱期）')
            if (ph.vibrationRange !== undefined) report.num(file, `${pw}.vibrationRange`, ph.vibrationRange, { min: 0, name: 'vibrationRange' })
            if (ph.enterOnProps !== undefined) {
              const ep = ph.enterOnProps
              if (!isObj(ep)) report.error(file, `${pw}.enterOnProps`, '必须是对象')
              else {
                if (!isStr(ep.kind)) report.error(file, `${pw}.enterOnProps.kind`, '缺失或非字符串')
                report.num(file, `${pw}.enterOnProps.atMost`, ep.atMost, { min: 0, int: true, name: 'atMost' })
              }
              if (pi === 0) report.error(file, pw, '起始阶不该带 enterOnProps——它没有「上一阶」可以推进')
            }
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
            // KI-014①：这一格从此是**遮挡体的尺寸**而不是装饰——`core/Occlusion` 拿它算"弹体能不能
            // 从柱顶上方飞过去"，表现层拿它缩放画出来的那一根，两边读同一个数。
            // 高度必须为正（0 高的柱子挡不住任何东西，写它就是写一条永远为假的判据）；
            // 上限是防呆：30m 已经远超灰盒期任何场地高度，写出更大的数只会是手抖多打了一个 0。
            report.sub(file, `${w}.boss.covers`, cov, { radius: { min: 0 }, heightM: { min: 0.1, max: 30 } })
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
/**
 * `navmeshRef` 的落点判据。`regions.json` 里写的是**相对路径**（`navmesh/rg_xxx.navmesh.json`），
 * 而烘焙器 `scripts/bake-navmesh.mjs` 的输出目录是 `src/data/json/navmesh/`（与 `JSON_DIR` 同一个根，
 * 因为运行时那份是 `src/data/index.ts` 直接 `import` 进来的 JSON——不是 assets，不进 public）。
 * 原先这四条 root 里**没有一条**能拼出烘焙器的落点 ⇒ 7 张真网格被判成"找不到实体"（KI-131）：
 * 门在报"数据写了没落"，而落的东西恰好躺在它没看的那一格。
 */
function navmeshExists(ref) {
  const roots = ['src/data/json', 'src/world/navmesh', 'src/data/navmesh', 'assets/navmesh', 'public/navmesh']
  const suffixes = ['', '.json', '.bin']
  return roots.some((root) => suffixes.some((s) => existsSync(resolve(ROOT, root, ref + s))))
}

function validateRegions(enemyIds, lootIds, rarityIds, stateDefs, markerTargets) {
  const file = 'regions.json'
  const list = data[file]
  const ids = new Set()
  const landmarkIds = new Set()
  const interactableIds = new Set()
  const secretIds = new Set()
  const propIds = new Set()
  const wallIds = new Set()
  const propKinds = new Set()
  const orders = new Map()
  if (!isArr(list)) { report.error(file, file, '顶层必须是数组'); return ids }
  /**
   * 「会给玩家扔东西的敌人」与「自己带掩体的 Boss」：authored 墙那条远程布点判据要用（见下）。
   * 判据从**招式数据**推（`frames.projectile`），不从 id 名单抄——新增一种远程怪不该改验证器。
   */
  const enemyList = (data['enemies.json'] ?? []).filter(isObj)
  const rangedEnemy = new Set(enemyList.filter((e) => (isArr(e.attacks) ? e.attacks : [])
    .some((a) => isObj(a) && isObj(a.frames) && a.frames.projectile !== undefined)).map((e) => e.id))
  const coverBearingEnemy = new Set(enemyList.filter((e) => isObj(e.boss) && isObj(e.boss.covers)).map((e) => e.id))
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

    // §9.4 区域上修（KI-030①）：写了就必须形状完整——atOrAbove 是稀有度表里的档位，mul ≥ 1（上修不是下修）
    if (rg.loot !== undefined) {
      if (!isObj(rg.loot)) report.error(file, `${w}.loot`, '必须是对象')
      else if (rg.loot.rarityBoost !== undefined) {
        const rb = rg.loot.rarityBoost
        if (!isObj(rb)) report.error(file, `${w}.loot.rarityBoost`, '必须是对象')
        else {
          if (!isStr(rb.atOrAbove) || !rarityIds.has(rb.atOrAbove)) report.error(file, `${w}.loot.rarityBoost.atOrAbove`, `未知稀有度：${JSON.stringify(rb.atOrAbove)}——高段门槛必须是 rarity 表里的档`)
          report.num(file, `${w}.loot.rarityBoost.mul`, rb.mul, { min: 1, name: 'mul' })
        }
      }
    }

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

    // KI-141：这一区在**开任务之前**该先找的人/地方（判据与任务步的 marker 同一份）
    if (rg.prologueMarker !== undefined) {
      for (const e of markerFindings(file, `${w}.prologueMarker`, rg.prologueMarker, markerTargets)) {
        report.error(file, e.where, e.msg)
      }
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
      else if (isStr(g.condition)) {
        /**
         * 刷怪闸门的条件语言（KI-143 扩了一格）：
         *   · `flag.x` / `!flag.x` —— 旗标两形（老形，逐字不动）
         *   · `state.K==V` / `state.K!=V` —— 世界状态两形（KI-143：破拍营地的营长只在 GARRISON 那条线上）
         *
         * 判据：每一项的**形状**要合法；带 `state.` 的那一项，**键必须在 states.json 里**、
         * **取值必须是那个状态的合法取值**——拼错一个键 ⇒ 那一组永远不刷（玩家看不到设计要的那个精英），
         * 拼错一个取值 ⇒ 同理，而且更难查（键对了、值错了）。
         */
        for (const rawTerm of g.condition.split('&&')) {
          const term = rawTerm.trim()
          if (term === '') continue
          if (term.startsWith('state.')) {
            const m = /^(state\.[A-Za-z0-9_.]+)(==|!=)(.+)$/.exec(term)
            if (!m) {
              report.error(file, `${gw}.condition`, `条件项形状不合法：'${term}'（状态两形是 state.KEY==VALUE / state.KEY!=VALUE）`)
              continue
            }
            const [, key, , value] = m
            const def = stateDefs.get(key)
            if (!def) {
              report.error(file, `${gw}.condition`, `条件项引用了不认识的状态：'${key}'（不在 states.json 里）`)
              continue
            }
            if (Array.isArray(def.values) && !def.values.includes(value)) {
              report.error(file, `${gw}.condition`, `条件项的取值不在该状态的合法取值里：'${value}'（合法取值：${def.values.join('/')}）`)
            }
          } else if (term.startsWith('!')) {
            if (!term.slice(1).trim()) report.error(file, `${gw}.condition`, `条件项 '${term}' 后面没有旗名`)
          } else if (!term) {
            report.error(file, `${gw}.condition`, '条件项为空')
          }
        }
      }
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
      // 合取闸门（Phase 6-C）：数组、非空、每项是字符串，且不许与单面的 requiresFlag 同时写
      if (it.requiresFlags !== undefined) {
        if (!isArr(it.requiresFlags) || it.requiresFlags.length === 0) {
          report.error(file, `${iw}.requiresFlags`, '必须是非空字符串数组（要几面旗就列几面；只有一面请用 requiresFlag）')
        } else {
          it.requiresFlags.forEach((f, fi) => { if (!isStr(f)) report.error(file, `${iw}.requiresFlags[${fi}]`, '必须是非空字符串') })
          if (new Set(it.requiresFlags).size !== it.requiresFlags.length) report.error(file, `${iw}.requiresFlags`, '有重复项：同一面旗列两遍不会更严，只会让锁文本重复同一句')
          if (it.requiresFlag !== undefined) report.error(file, `${iw}.requiresFlags`, '与 requiresFlag 同时写 = 同一件事两处真值（单面 / 合取选一种）')
        }
      }
      // 值域闸门（Phase 6-B 组换）：与 requiresFlag 平级的另一种"这儿现在有没有它"
      if (it.requiresState !== undefined) {
        if (!isObj(it.requiresState)) report.error(file, `${iw}.requiresState`, '必须是对象 { key, value }')
        else {
          for (const msg of stateRefErrors(stateDefs, it.requiresState.key, [it.requiresState.value])) {
            report.error(file, `${iw}.requiresState`, msg)
          }
        }
      }
      // 不在场旗（收摊/撤离）：非空字符串即可——域语义由 collectFlagUsage 的双向对账管
      //（写了没人读 ⇒ 死数据；被读没人写 ⇒ 不可达，两条判据都已经在跑）
      if (it.absentFlag !== undefined && !isStr(it.absentFlag)) report.error(file, `${iw}.absentFlag`, '必须是非空字符串')
      if (it.absentFlag !== undefined && it.requiresFlag !== undefined) report.error(file, `${iw}.absentFlag`, '与 requiresFlag 同时写 = 同一件事两处真值（在场门与缺席门各自问一件事，不许都写）')
      if (it.to !== undefined) vec3(file, `${iw}.to`, it.to)
      if (it.kind === 'npc' && !isStr(it.npcId)) report.warn(file, iw, `kind=npc 但没有 npcId`)
    })

    // props（KI-023 可破坏场景物）
    if (rg.props !== undefined) {
      if (!isArr(rg.props)) report.error(file, `${w}.props`, '必须是数组')
      else rg.props.forEach((p, pi) => {
        const pw = `${w}.props[${pi}]`
        if (!isObj(p)) { report.error(file, pw, '必须是对象'); return }
        if (!isStr(p.id)) report.error(file, pw, 'id 缺失或非字符串')
        else if (propIds.has(p.id)) report.error(file, pw, `prop id 重复：${p.id}`)
        else propIds.add(p.id)
        if (!PROP_KINDS.has(p.kind)) report.error(file, `${pw}.kind`, `kind=${JSON.stringify(p.kind)} 非法`)
        else propKinds.add(p.kind)
        vec3(file, `${pw}.pos`, p.pos)
        // y 契约（与 spawnGroups/interactables 同一条）：prop 立在本层地板上，
        // 否则 shapeHits 的竖向判据与它永远错开——「看得见按不到」的镜像版
        if (isObj(p.pos) && Math.abs(p.pos.y - rg.groundY) > 0.001) {
          report.error(file, `${pw}.pos`, `pos.y 必须踩在本层地板 groundY=${rg.groundY}`)
        }
        // 耐久模型二选一（KI-023 计数型 / KI-022② 血量型）：两样都缺 = 打不坏的装饰，两样都有 = 两个主人
        if (p.hitsToBreak === undefined && p.hpFracOfBoss === undefined) {
          report.error(file, pw, 'hitsToBreak（计数型）与 hpFracOfBoss（血量型）必须二选一——两样都缺就是一根打不坏的装饰')
        }
        if (p.breakLabel !== undefined && !isStr(p.breakLabel)) report.error(file, `${pw}.breakLabel`, '必须是非空字符串')
        report.num(file, `${pw}.breakLoudness`, p.breakLoudness, { min: 0.0001, max: 1, name: 'breakLoudness' })
        if (p.kind === 'soundspine' && (p.gatherRadius === undefined || p.gatherRadius <= 0)) {
          report.error(file, pw, 'soundspine 必须写正的 gatherRadius——汇聚噪音是这一类的全部意义，缺了它就只是一根打不坏的柱子')
        } else if (p.gatherRadius !== undefined) {
          report.num(file, `${pw}.gatherRadius`, p.gatherRadius, { min: 0.0001, name: 'gatherRadius' })
        }
        if (p.kind === 'resonance_core') {
          if (p.hpFracOfBoss === undefined || p.hpFracOfBoss <= 0 || p.hpFracOfBoss > 0.5) {
            report.error(file, pw, 'resonance_core 必须写 hpFracOfBoss ∈ (0, 0.5]——「每个 18% HP」是这一类的全部意义')
          }
          if (!isStr(p.damageTarget)) report.error(file, pw + '.damageTarget', '缺失或非字符串——核上掉的血必须有个去处')
          else if (!enemyIds.has(p.damageTarget)) report.error(file, pw + '.damageTarget', '悬空引用：' + p.damageTarget + ' 不在 enemies.json')
          if (p.hitsToBreak !== undefined) report.error(file, pw, 'resonance_core 是血量型（hpFracOfBoss），不该再写 hitsToBreak——一个 prop 只许一种耐久模型')
        }
        if (p.hitsToBreak !== undefined) report.num(file, pw + '.hitsToBreak', p.hitsToBreak, { min: 1, int: true, name: 'hitsToBreak' })
        if (p.exposedWhen !== undefined) {
          const ex = p.exposedWhen
          if (!isObj(ex)) { report.error(file, pw + '.exposedWhen', '必须是对象') }
          else {
            if (!isStr(ex.bossId)) report.error(file, pw + '.exposedWhen.bossId', '缺失或非字符串')
            report.num(file, pw + '.exposedWhen.minPhase', ex.minPhase, { min: 0, int: true, name: 'minPhase' })
          }
        }
        if (p.onBreakDeaf !== undefined) {
          const d = p.onBreakDeaf
          if (!isObj(d)) { report.error(file, `${pw}.onBreakDeaf`, '必须是对象') }
          else {
            if (!isStr(d.target)) report.error(file, `${pw}.onBreakDeaf.target`, '缺失或非字符串')
            else if (!enemyIds.has(d.target)) report.error(file, `${pw}.onBreakDeaf.target`, `悬空引用：'${d.target}' 不在 enemies.json`)
            else {
              // 聋乱窗只对「靠听的敌人」成立：hearing.range=0 的东西聋不聋没有玩法差
              const t = (data['enemies.json'] ?? []).find((e) => isObj(e) && e.id === d.target)
              const hearRange = isObj(t) && isObj(t.ai) && isObj(t.ai.hearing) ? t.ai.hearing.range : 0
              if (!(hearRange > 0)) report.error(file, `${pw}.onBreakDeaf.target`, `'${d.target}' 的 hearing.range=${hearRange}——聋乱窗对听不见的敌人没有意义`)
            }
            report.num(file, `${pw}.onBreakDeaf.deafTicks`, d.deafTicks, { min: 1, int: true, name: 'deafTicks' })
          }
        }
      })
    }

    // authored 墙体（KI-014②）：挡视线与弹道的关卡几何。三条判据各自对应一种坏法——
    // ① 越界：息声领是叠层世界（bounds 共用 xz），伸出 bounds 的墙会伸进邻层的地板上；
    // ② 埋点：交互物/出怪中心/场地件/隐藏房落在墙肚子里。起点在遮挡体内按几何口径是**不挡**，
    //    于是那一处得到一座无限掩体，而灰盒里它被墙盖住看不见——"看得见按不到"的镜像版；
    // ③ 远程敌人要有的放矢：能给远程怪（`frames.projectile`）的布点区域必须给得出掩体，
    //    否则 §14 的"躲一下再冲"在关卡上无处可躲。Boss 自带的 `boss.covers`（断音柱）算数。
    const sites = [
      ...(isArr(rg.interactables) ? rg.interactables : []),
      ...(isArr(rg.props) ? rg.props : []),
      ...(isArr(rg.secrets) ? rg.secrets : []),
    ].filter(isObj).filter((x) => isObj(x.pos))
    for (const g of isArr(rg.spawnGroups) ? rg.spawnGroups : []) {
      if (isObj(g) && isObj(g.center)) sites.push({ id: `${g.enemyId}@spawn`, pos: g.center })
    }
    if (rg.walls !== undefined) {
      if (!isArr(rg.walls)) report.error(file, `${w}.walls`, '必须是数组')
      else rg.walls.forEach((wl, wi) => {
        const lw = `${w}.walls[${wi}]`
        if (!isObj(wl)) { report.error(file, lw, '必须是对象'); return }
        const nm = isStr(wl.id) ? `${w}.walls(${wl.id})` : lw
        if (!isStr(wl.id)) report.error(file, lw, 'id 缺失或非字符串')
        else if (wallIds.has(wl.id)) report.error(file, nm, `wall id 重复：${wl.id}——遮挡体 id 要能回答"是哪堵墙救了我"，全场唯一`)
        else wallIds.add(wl.id)
        vec3(file, `${nm}.pos`, wl.pos)
        if (!isObj(wl.size)) report.error(file, `${nm}.size`, '必须是对象（x/z 两个方向的**全尺寸**，不是半宽）')
        else {
          report.num(file, `${nm}.size.x`, wl.size.x, { min: 0.2, name: 'size.x' })
          report.num(file, `${nm}.size.z`, wl.size.z, { min: 0.2, name: 'size.z' })
        }
        report.num(file, `${nm}.heightM`, wl.heightM, { min: 1, name: 'heightM' })
        if (!isObj(wl.pos) || !isObj(wl.size) || typeof wl.heightM !== 'number') return
        // 墙底必须坐在**这一层的地面**上：灰盒期一片天只有一张地板（`Surface.floorAt` 按 groundY 分层），
        // 底面不等于 groundY 的墙要么浮在半空（玩家看得见却躲不进去那条线），要么沉进地里（画不出来）
        if (typeof rg.groundY === 'number' && wl.pos.y !== rg.groundY) {
          report.error(file, `${nm}.pos.y`, `墙底在 ${wl.pos.y}，而 ${rg.id} 的地面在 ${rg.groundY}：区域只有一张地板，错层的墙既看不见也不挡（要叠第二层请开新区域）`)
        }
        const b = rg.bounds
        if (isObj(b)) {
          const hx = wl.size.x / 2, hz = wl.size.z / 2
          if (wl.pos.x - hx < b.minX || wl.pos.x + hx > b.maxX || wl.pos.z - hz < b.minZ || wl.pos.z + hz > b.maxZ) {
            report.error(file, `${nm}.pos`, `墙伸出区域 ${rg.id} 的 bounds：水平范围 [${wl.pos.x - hx}, ${wl.pos.x + hx}]×[${wl.pos.z - hz}, ${wl.pos.z + hz}] 不在 [${b.minX},${b.maxX}]×[${b.minZ},${b.maxZ}] 内`)
          }
          if (wl.pos.y < b.minY || wl.pos.y + wl.heightM > b.maxY) {
            report.error(file, `${nm}.heightM`, `竖直范围 [${wl.pos.y}, ${wl.pos.y + wl.heightM}] 超出 bounds 的 [${b.minY}, ${b.maxY}]`)
          }
        }
        for (const s of sites) {
          const inside = Math.abs(s.pos.x - wl.pos.x) < wl.size.x / 2
            && Math.abs(s.pos.z - wl.pos.z) < wl.size.z / 2
            && s.pos.y >= wl.pos.y && s.pos.y <= wl.pos.y + wl.heightM
          if (inside) report.error(file, `${nm}.pos`, `把 ${s.id} 埋进了墙肚子里：站在墙里=无限掩体（几何口径"起点在体内不挡"），而灰盒里它被墙盖住`)
        }
      })
    }

    // 远程布点要有的放矢（KI-014② 的第三条判据）：这一片地刷了会扔东西的敌人，就得给得出掩体
    {
      const groups = isArr(rg.spawnGroups) ? rg.spawnGroups : []
      const rangedHere = groups.filter((g) => isObj(g) && rangedEnemy.has(g.enemyId))
      const ownCover = groups.some((g) => isObj(g) && coverBearingEnemy.has(g.enemyId))
      const wallsHere = isArr(rg.walls) ? rg.walls.length : 0
      if (rangedHere.length > 0 && wallsHere === 0 && !ownCover) {
        report.error(file, `${w}.walls`, `这片地方刷了远程敌人（${rangedHere.map((g) => g.enemyId).join(', ')}）却一块 authored 遮挡体都没有：§14 的"躲一下再冲"在关卡上无处可躲`)
      }
    }

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

  // §55 死数据闸门（KI-014②）：全场一块 authored 遮挡体都没有的话，`walls` 这一格、
  // `core/Occlusion` 的盒截面、`world/WallGreybox` 三条腿就一起空转——那比"没做"更糟，因为它看起来做完了
  const authoredWalls = list.filter(isObj).reduce((n, rg) => n + (isArr(rg.walls) ? rg.walls.length : 0), 0)
  if (authoredWalls === 0) {
    report.error(file, 'walls', '全场没有任何 authored 遮挡体：关卡侧的遮挡通道是死代码（要么布墙，要么把这格从 schema 删掉）')
  }

  // KI-024 跨文件对账：场地阶段入口指向的 prop 品类必须真的有区域布过——
  // 否则那一阶永远进不去（「配置齐全但付不出货」的洞，KI-042 同族，只有跨文件才拦得住）
  for (const en of data['enemies.json'] ?? []) {
    if (!isObj(en) || !isObj(en.boss) || !isArr(en.boss.phases)) continue
    en.boss.phases.forEach((ph, pi) => {
      if (!isObj(ph) || !isObj(ph.enterOnProps) || !isStr(ph.enterOnProps.kind)) return
      if (!propKinds.has(ph.enterOnProps.kind)) {
        report.error('enemies.json', `${en.id}.boss.phases[${pi}].enterOnProps.kind`, `品类 '${ph.enterOnProps.kind}' 没有任何区域布过 prop——这一阶永远进不去`)
      }
    })
  }
  // KI-022② 跨文件对账：exposedWhen 指向的 Boss 必须存在、且 minPhase 真的落在**她自己**的阶段数内——
  // 否则这颗核永远外露不了（「配置齐全但付不出货」的洞，KI-042 同族）
  for (const rg of data['regions.json'] ?? []) {
    if (!isObj(rg) || !isArr(rg.props)) continue
    for (const p of rg.props) {
      if (!isObj(p) || !isObj(p.exposedWhen) || !isStr(p.exposedWhen.bossId)) continue
      const boss = (data['enemies.json'] ?? []).find((e) => isObj(e) && e.id === p.exposedWhen.bossId)
      if (!isObj(boss)) {
        report.error('regions.json', `${rg.id}.props(${p.id}).exposedWhen.bossId`, `悬空引用：'${p.exposedWhen.bossId}' 不在 enemies.json`)
        continue
      }
      const phaseCount = isObj(boss.boss) && isArr(boss.boss.phases) ? boss.boss.phases.length : 0
      if (p.exposedWhen.minPhase >= phaseCount) {
        report.error('regions.json', `${rg.id}.props(${p.id}).exposedWhen.minPhase`, `${p.exposedWhen.bossId} 只有 ${phaseCount} 阶——minPhase=${p.exposedWhen.minPhase} 的核永远外露不了`)
      }
    }
  }
  return ids
}

// ---- ambience.json（KI-077：docs/audio.md §1.2 主音分配 + §4 的 L1/L4 两层入表）----
/**
 * 一张声床 = 一个区域的 drone + 铃点。这里管三件事：
 * ① 字段集合恰好等于 `schema.ts > AmbienceBed / AmbienceLayer / AmbienceBell`（多一个字段 = 引擎读不懂的装饰。
 *    那三张字段表本身由词表对账门钉在 schema 上（KI-074/076），所以这条不是「手抄对空抄」）；
 * ② `lpHz` / `breath` 与 `layers` 的**存在性绑定**：这两个字段只在 drone 子图上有消费者，
 *    给一张不存在的图配参数就是 §55 的死数据；
 * ③ 与 `regions.json > music.ambience` **双向**对账：少一行 = 那一区永远没有底噪（听感上像游戏坏了），
 *    多一行 = 没有读者的表。两个方向都是 ERROR，与 KI-041 那条纪律同源。
 */
// ---- ambience.json（KI-077 建表；KI-083 长出 L2／L3 那一支）----
/**
 * 一张环境声床 = 一区的 L1 drone + L2／L3 真位置声源 + L4 铃点。判据本体已经搬进
 * `scripts/ambience-rules.mjs`（KI-083），理由与 explore/battle 那两个模块一字不差：
 * 本文件一被 import 就去校验真表并 `process.exit`，于是"喂一张非法床、看它拒不拒"这一半只能把判据
 * 抽成纯函数模块再在测试里喂合成表（`tests/unit/ambience-table.test.ts` 就是这么量的），
 * 而一条只有 accept 侧有人量的门不算门。
 * 这里剩两张嘴：findings → ERROR/WARN，加 `report.num`/`report.sub` 管的那批可闻带——
 * 缺失/非有限数/越界那三种说法全场由它们一家管，搬过去等于给同一句话配第二个主人。
 */
function validateAmbience() {
  const file = 'ambience.json'
  const list = data[file]
  if (!isArr(list)) { report.error(file, file, '顶层必须是数组'); return }
  for (const f of ambienceFindings(list, data['regions.json'] ?? [])) {
    if (f.level === 'warn') report.warn(f.file, f.where, f.msg)
    else report.error(f.file, f.where, f.msg)
  }

  /** §4 的 L1 逐层参数域：hz 卡在可闻带内（低于 20Hz 连"体感"那一格都谈不上，高于 20k 只是费一个节点） */
  const HZ = { min: 20, max: 20000 }
  /** drone 层峰值上限 0.5：§4 写的是 -24dB 级（≈0.063），一半增益会把 AMB 总线顶穿 */
  const LAYER_PEAK = { min: 0.0001, max: 0.5 }
  /** 音分：±50 以内是"两条同音层的微失谐 = 暖"，越过半个音就变成第二个音高而不是失谐 */
  const DETUNE = { min: -50, max: 50 }
  /** 呼吸 LFO 比 4Hz 快就不是呼吸而是颤音（那是 §4 之外的另一件事） */
  const BREATH_HZ = { min: 0.01, max: 4 }
  const BREATH_DEPTH = { min: 0.0001, max: 0.2 }
  /**
   * §4 的 L2／L3：一声多长、起音多快、多久来一次。`durSec` 上限 30s——比这更长的一条"事件"
   * 在听感上就是一整层（那该画成 L1），`attackSec` 上限 10s 同理。峰值与 drone 同一量纲、同一上限。
   */
  const SOURCE_PEAK = { min: 0.0001, max: 0.5 }
  const ATTACK = { min: 0.001, max: 10 }
  const DUR = { min: 0.01, max: 30 }
  /** 每颗铃到点后掷间隔与峰值的那一格 */
  const pair = (where, v, { min, max, name }) => {
    if (!isArr(v) || v.length !== 2) { report.error(file, where, '必须是 [最轻/最短, 最响/最长] 两个数'); return }
    const [lo, hi] = v
    if (!isNum(lo) || !isNum(hi)) { report.error(file, where, '两端必须是有限数值'); return }
    if (lo < min || lo > max || hi < min || hi > max) report.error(file, where, `${name} 两端都须落在 [${min}, ${max}]（${lo} / ${hi}）`)
    else if (lo > hi) report.error(file, where, `需 下限 <= 上限（${lo} / ${hi}）`)
  }

  for (const [i, bed] of list.entries()) {
    if (!isObj(bed)) continue
    const w = isStr(bed.id) ? bed.id : `[${i}]`
    if (isArr(bed.layers)) {
      bed.layers.forEach((l, li) => {
        if (!isObj(l)) return
        const lw = `${w}.layers[${li}]`
        report.num(file, `${lw}.hz`, l.hz, { ...HZ, name: 'hz' })
        report.num(file, `${lw}.peak`, l.peak, { ...LAYER_PEAK, name: 'peak' })
        report.num(file, `${lw}.detune`, l.detune, { ...DETUNE, name: 'detune' })
      })
      // 存在性绑定：drone 子图不在，暖度低通与呼吸 LFO 就没有落脚的节点
      if (bed.layers.length > 0) {
        report.num(file, `${w}.lpHz`, bed.lpHz, { ...HZ, name: 'lpHz' })
        report.sub(file, `${w}.breath`, bed.breath, { hz: { min: BREATH_HZ.min, max: BREATH_HZ.max }, depth: { min: BREATH_DEPTH.min, max: BREATH_DEPTH.max } })
      }
    }

    if (isObj(bed.bell)) {
      const sc = bed.bell.scale
      if (isArr(sc)) sc.forEach((f, si) => report.num(file, `${w}.bell.scale[${si}]`, f, { min: 20, max: 8000, name: 'scale' }))
      pair(`${w}.bell.everySec`, bed.bell.everySec, { min: 0.01, max: 600, name: 'everySec' })
      pair(`${w}.bell.peak`, bed.bell.peak, { min: 0.0001, max: 1, name: 'peak' })
      report.num(file, `${w}.bell.hammerP`, bed.bell.hammerP, { min: 0, max: 1, name: 'hammerP' })
    }

    // §4 的 L2／L3（KI-083）：位置那一格的坐标也是数值，走同一只手（缺失/非有限数由 report.num 说）
    if (isArr(bed.sources)) {
      bed.sources.forEach((s, si) => {
        if (!isObj(s)) return
        const sw = `${w}.sources[${si}]`
        report.num(file, `${sw}.hz`, s.hz, { ...HZ, name: 'hz' })
        report.num(file, `${sw}.peak`, s.peak, { ...SOURCE_PEAK, name: 'peak' })
        report.num(file, `${sw}.attackSec`, s.attackSec, { ...ATTACK, name: 'attackSec' })
        report.num(file, `${sw}.durSec`, s.durSec, { ...DUR, name: 'durSec' })
        pair(`${sw}.everySec`, s.everySec, { min: 0.05, max: 600, name: 'everySec' })
        if (isObj(s.pos)) for (const k of ['x', 'y', 'z']) report.num(file, `${sw}.pos.${k}`, s.pos[k], { name: k })
      })
    }
  }
}

// ---- explore.json（KI-079：docs/audio.md §1.2 的「世界音乐层」第一次成为一张表）----
/**
 * 一行的探索曲 = 一个区域探索时那条慢旋律（§2.1 四层里的 L3 对位旋律）。判据是那四件事，
 * **本体住在 `explore-rules.mjs`**（①字段集合落在 schema 那两支之一 ②§1.2 音乐宪法：音高变形只有三个词、
 * 节奏变形只许 1/2/0.5 ③有调／无调两支的形状不能混 ④与 `regions.json > music.explore` 双向对账 + 一区一主音）。
 * 搬走的唯一理由是"两端都要量得动"：本文件一被 import 就去校验真表并 `process.exit`，
 * 于是拒不拒那一半只有在判据抽成纯函数模块之后才量得动。这里剩的是两张嘴：
 * findings → ERROR/WARN，加 `report.num` 管的那两格可闻带（那种说法全场共用，不该有第二个主人）。
 */
function validateExplore() {
  const file = 'explore.json'
  const list = data[file]
  if (!isArr(list)) { report.error(file, file, '顶层必须是数组'); return }
  // 判据本体住在 `explore-rules.mjs`（上面四件事全在那一份里），这里只当"把 findings 报成 ERROR/WARN 的那张嘴"：
  // 搬走之后测试可以喂合成行量"拒不拒"，门禁与测试读的是同一条规则，而不是两份各自手抄。
  for (const f of exploreFindings(list, data['regions.json'] ?? [])) {
    if (f.level === 'warn') report.warn(f.file, f.where, f.msg)
    else report.error(f.file, f.where, f.msg)
  }
  /**
   * 数值可闻带留在本文件走 `report.num`：缺失 / 非有限数 / 越界那三种说法全场由它一家管，搬走就是第二个主人。
   * `rootHz` 20–4000：这一格写的是**音级**（与同区那张床的 drone 同高），旋律声部在运行时才抬八度。
   * `peak` ≤0.2：§8 的 ambience 总线要让位给战斗层，一条永远在奏的旋律比铃点贵得多。
   */
  for (const [i, row] of list.entries()) {
    if (!isObj(row) || row.form === null) continue
    const w = isStr(row.id) ? row.id : `[${i}]`
    report.num(file, `${w}.rootHz`, row.rootHz, { min: 20, max: 4000, name: 'rootHz' })
    report.num(file, `${w}.peak`, row.peak, { min: 0.0001, max: 0.2, name: 'peak' })
  }
}

// ---- battle.json（KI-080：`music.battle` 那 5 个 id 从"指向一张不存在的表"变成有读者的一行）----
/**
 * 一行的战斗档 = 进那一区开打时奏的那一档（§1.1「战斗遭遇」+ §2.2 那张表缺的"遭遇层"）。
 * 判据本体在 `battle-rules.mjs`（①字段集合落在 schema 那两支之一，且**主音格/速度格出现即红**——
 * §1.1「主音不变」与 KI-066「拍网只有一个主人」的数据侧 ②有配乐/无配乐两支的形状不能混
 * ③低音线每一项是 `R-1` 派生的音级、不越八度上界 ④与 `regions.json > music.battle` 双向对账 +
 * `kickBeats` 越界即死数据）。这里剩两张嘴：findings → ERROR/WARN，加 `report.num` 管 `bellEveryBars`。
 */
function validateBattle() {
  const file = 'battle.json'
  const list = data[file]
  if (!isArr(list)) { report.error(file, file, '顶层必须是数组'); return }
  for (const f of battleFindings(list, data['regions.json'] ?? [])) {
    if (f.level === 'warn') report.warn(f.file, f.where, f.msg)
    else report.error(f.file, f.where, f.msg)
  }
  /**
   * `bellEveryBars` ≥1 的整数：`i % (bars × beatsPerBar)`，写 0 就是 `i % 0 = NaN`（永远不响而无人说话），
   * 写小数就是"每隔 1.5 小节"那种谁也走不到的格。想表达"钟也不打"请整行换 `noMusic` 那一支。
   */
  for (const [i, row] of list.entries()) {
    if (!isObj(row) || row.noMusic === true) continue
    const w = isStr(row.id) ? row.id : `[${i}]`
    report.num(file, `${w}.bellEveryBars`, row.bellEveryBars, { min: 1, int: true, name: 'bellEveryBars' })
  }
}

// ---- movements.json ----
// ---- ducking.json（KI-092：docs/audio.md §8.2 侧链表）----
/**
 * 判据本体在 `ducking-rules.mjs`（字段名单 / 触发口两端对账 / 总线名 / db 与 holdSec 的界）。
 * 这里只多做一件判据本体做不了的事：**把两份源码名单读出来**。
 *  · `handled` = `src/audio/AudioEngine.ts` 里 `onDuckTrigger('…')` 的字面量实参（引擎真接的侧链口）；
 *  · `buses`   = `src/audio/ducking.ts` 的 `DuckBusName` 联合（图上有哪几条总线）。
 * 两份都是**现推**而不是手抄：抄一份名单就等于给这句话配第二个主人，改了引擎而名单不动，
 * 门就会替过时的代码说话（KI-074 那条纪律的同一家族）。读不到时把 null 交给判据，它说"门在空转"。
 */
function validateDucking() {
  const file = 'ducking.json'
  const read = (p) => {
    try { return readFileSync(resolve(ROOT, p), 'utf8') } catch { return null }
  }
  const engineText = read('src/audio/AudioEngine.ts')
  const duckText = read('src/audio/ducking.ts')
  const handled = engineText === null ? null : callArgLiterals(engineText, 'onDuckTrigger')
  const buses = duckText === null ? null : unionMembers(schemaBlocks(duckText), 'DuckBusName')
  for (const f of duckFindings(file, data[file], handled, buses)) {
    if (f.level === 'warn') report.warn(f.file, f.where, f.msg)
    else report.error(f.file, f.where, f.msg)
  }
}

// ---- weather.json（KI-094：需求 §38 / art-direction §8 的天气档）----
/**
 * 判据本体在 `weather-rules.mjs`（字段名单 / 读数界 / 两侧对账 / 基线行）。这里只多做一件判据
 * 本体做不了的事：**把两端的名册读出来**。
 *  · `docIds`     = `src/data/schema.ts` 的 `WeatherDocId` 联合（需求 §38 认的那几档）；
 *  · `referenced` = `regions.json` 每一区 `weatherPresets` 里的名字（数据侧真被指到的天气）。
 * 两份都**现推**而不是手抄（与 `validateDucking` 同一族纪律）：抄一份就等于给这句话配第二个主人，
 * 改了 schema 而名单不动，门会替过时的代码说话。读不到时把 null 交给判据，它说"门在空转"。
 */
function validateWeather() {
  const file = 'weather.json'
  let schemaText = null
  try { schemaText = readFileSync(resolve(ROOT, 'src/data/schema.ts'), 'utf8') } catch { schemaText = null }
  const docIds = schemaText === null ? null : unionMembers(schemaBlocks(schemaText), 'WeatherDocId')
  const regions = isArr(data['regions.json']) ? data['regions.json'] : []
  const referenced = [...new Set(regions.filter(isObj).flatMap((rg) => isArr(rg.weatherPresets) ? rg.weatherPresets.filter(isStr) : []))]
  for (const f of weatherFindings(file, data[file], docIds, referenced, PENDING_WEATHER_READINGS, WEATHER_GAMEPLAY_RULINGS)) {
    if (f.level === 'warn') report.warn(f.file, f.where, f.msg)
    else report.error(f.file, f.where, f.msg)
  }
  /*
   * KI-094②：那条切换（`weatherPresets[1]`）的条件名册从 `quests.json` 现推——**主人是 `steps[].advanceOn.flags`**，
   * 手抄一份就等于给这条判据编第二个真源。runtime 那一侧的同名推导在 `src/world/WeatherSwitch.ts`，
   * 两边读的是同一份 `quests.json`，而"它们今天是不是同一批旗"由 `tests/unit/weather-switch.test.ts` 对账。
   */
  // S6 要拿 states.json 的登记表（`stateDefs`）对账 weatherSwitch 值域形的 key/in——
  // 不传就会把"拼错的 state key"当成"这一格没人读"而安静地管不着。
  // 这段注释故意站在名册推导的那一行**之前**：单测要把那一行整段抽出来就地求值，
  // 中间插注释会把它切成不能编译的碎块（这一回真挥过一次）。
  const questFlags = (isArr(data['quests.json']) ? data['quests.json'] : []).filter(isObj)
    .flatMap((q) => isArr(q.steps) ? q.steps : []).filter(isObj)
    .flatMap((s) => isObj(s.advanceOn) && isArr(s.advanceOn.flags) ? s.advanceOn.flags.filter(isStr) : [])
  for (const f of weatherSwitchFindings(file, data['regions.json'], questFlags, PENDING_WEATHER_SWITCHES, stateDefs)) {
    if (f.level === 'warn') report.warn(f.file, f.where, f.msg)
    else report.error(f.file, f.where, f.msg)
  }
}

// ---- regions.json 的世界图几何（KI-100：需求 §9「地图设计」的第一台机器读者）----
/**
 * 判据本体在 `world-graph-rules.mjs`：①作者标注的点位不许伸出本区 bounds，②每条通行器边的落点必须
 * **恰好**落进一个区域，③一个区域的锚点不许全部共线，④两盒不许重叠出体积，⑤从起始区走遍全图且每区有出路，
 * ⑥每一把锁的钥匙都拿得到，⑦落进上锁区的边不许无证白送。这里只递表、只报 findings —— 判据不认识文件。
 *
 * ⑥⑦ 要认**两份别表的旗标**（`worldstate.json` 的 setFlag 规则、`dialogue.json` 的对话效果），
 * 所以这一格递的不止 `regions.json`：不递，判据只能把指不到位置的旗标当成别人的账跳过，
 * 「钥匙锁在自己开的那扇门后面」这一整类就永远读不到。`tests/unit/world-graph.test.ts` 的
 * 「消费端」那一节钉的正是这个第二参数。
 *
 * `regions.json` 本来就有报告者（区域字段、旗标对账那几段），所以 `mapFindings` 那道门不会因为这一格变绿；
 * 它早就绿着，而绿的那句话是"这张表至少有人看"，不是"这张表的每一维都有人看"。这一格补的正是几何与先后那一维：
 * 在 KI-100 之前，`to` 只被当成 vec3 验一次型，落点在不在虚空、有没有同时踩进两个叠层区，一个读者都没有。
 */
function validateWorldGraph() {
  const file = 'regions.json'
  // 没有 warn 分支不是漏了：`worldGraphFindings` 今天只产 error，写一条走不到的分派就是给同一句话配第二个口径。
  // 判据哪天要出 WARN，会由那条钉着"这里的出口只有 report.error"的证人先红一次。
  for (const f of worldGraphFindings(data[file], { worldstate: data['worldstate.json'], dialogue: data['dialogue.json'] })) report.error(f.file, f.where, f.msg)
}

/** loot.json 里真正会掉出来的物品全集（rolls + firstKill）。点亮源必须落在这里面，否则那一页永远点不亮 */function lootedItemIds() {
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
    if (!['slots', 'pages', 'movements', 'upgradeCost', 'damage', 'passiveCost', 'passives'].includes(k)) report.error(file, k, '不认的顶层字段（§55）')
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
      if (!isObj(p.unlock)) report.error(file, `${w}.unlock`, '必须是 { item, count } 或 { flag } —— 点亮源写在数据里，不是代码里的 if')
      else {
        for (const k of Object.keys(p.unlock)) if (k !== 'item' && k !== 'count' && k !== 'flag') report.error(file, `${w}.unlock.${k}`, '不认的字段（§55）')
        const formItem = isStr(p.unlock.item)
        const formFlag = isStr(p.unlock.flag)
        if (!formItem && !formFlag) report.error(file, `${w}.unlock`, 'item 与 flag 至少写一个（两种解锁源二选一）')
        if (formItem && formFlag) report.error(file, `${w}.unlock`, 'item 与 flag 二选一——一个解锁源只有一种主人（KI-037 改判）')
        if (formItem) {
          if (!itemIds.has(p.unlock.item)) report.error(file, `${w}.unlock.item`, `悬空引用：'${p.unlock.item}' 不在 items.json`)
          else if (!lootable.has(p.unlock.item)) report.error(file, `${w}.unlock.item`, `没有任何掉落表给出 '${p.unlock.item}'：这一页永远点不亮（unreachable content）`)
          report.num(file, `${w}.unlock.count`, p.unlock.count, { min: 1, int: true, name: 'count' })
        }
        if (formFlag) {
          // 旗标形（KI-037 乐章 IV）：读方登记进 collectFlagUsage 的对账（写方=worldstate 的 bossDefeated 规则）
          if (!p.unlock.flag.startsWith('flag.')) report.error(file, `${w}.unlock.flag`, `命名必须是 flag.*：${p.unlock.flag}`)
        }
      }
    })
  }

  // 被动栏（§7.3，KI-036）：价目 + 表。两者是一对——只有价目没有被动是死数据，
  // 只有被动没有价目则 learnPassive 每一次都以 'max' 拒绝（玩家看到的是按钮永远点不动）。
  const { passiveCost, passives } = d
  if (passiveCost !== undefined) {
    if (!isArr(passiveCost)) report.error(file, 'passiveCost', '必须是数组')
    else {
      passiveCost.forEach((c, i) => {
        const w = `passiveCost[${i}]`
        if (!isObj(c)) { report.error(file, w, '必须是对象'); return }
        for (const k of Object.keys(c)) if (!['timbite', 'score'].includes(k)) report.error(file, `${w}.${k}`, '不认的字段（§55）')
        report.num(file, `${w}.timbite`, c.timbite, { min: 1, int: true, name: 'timbite' })
        report.num(file, `${w}.score`, c.score, { min: 1, int: true, name: 'score' })
      })
    }
  }
  if (passives !== undefined && !isArr(passives)) report.error(file, 'passives', '必须是数组')
  else if (isArr(passives)) {
    if (!isArr(passiveCost)) report.error(file, 'passives', '写了被动却没写 passiveCost ⇒ 每一级都研读不动（死门）')
    const pids = new Set()
    passives.forEach((p, i) => {
      const w = isStr(p?.id) ? p.id : `passives[${i}]`
      if (!isObj(p)) { report.error(file, w, '必须是对象'); return }
      if (!isStr(p.id)) report.error(file, w, 'id 缺失或非字符串')
      else if (pids.has(p.id)) report.error(file, w, `id 重复：${p.id}`)
      else pids.add(p.id)
      // §55 没有消费方的数值不许进表：每加一条被动 = 承诺一个消费者。
      // ps_metronomefoot / ps_tympanicguard / ps_featherrest 的消费者都是 src/rpg/Settlement.ts refreshPlayer
      // （常拍脚 → PlayerController.setBeatGrace → CombatManager 的 onBeat 窗；厚膜鼓 → EntityStats.poiseDecayMul；
      //  轻身法 → PlayerController.setExecCancel → update 里处决演出的取消窗），由 tests/flow/passives.test.ts 作证；
      // 残响耳（撞 KI-032）还没接，故不在表里也不在白名单里。
      if (isStr(p.id) && !PASSIVE_IDS.has(p.id)) report.error(file, `${w}.id`, `白名单外的被动 '${p.id}'：加一条就要同时带来一个消费者（当前白名单：${[...PASSIVE_IDS].join(' / ')}）`)
      for (const k of Object.keys(p)) if (!['id', 'page', 'nameKey', 'displayName', 'desc', 'values'].includes(k)) report.error(file, `${w}.${k}`, '不认的字段（§55）')
      if (!isStr(p.nameKey)) report.error(file, `${w}.nameKey`, '必填')
      if (!isStr(p.displayName)) report.error(file, `${w}.displayName`, '必填——面板上显示的是它，不是 id')
      if (!isStr(p.desc) || p.desc.length < 5) report.error(file, `${w}.desc`, '需要一句世界内解释（§19）：数值的量纲写在这一句里')
      if (!isStr(p.page)) report.error(file, `${w}.page`, '必填——被动挂在页底，没有页就没有位置')
      else if (!pageIds.has(p.page)) report.error(file, `${w}.page`, `悬空引用：'${p.page}' 不在 pages`)
      if (!isArr(p.values) || p.values.length === 0) report.error(file, `${w}.values`, '必须是非空数组（L1-3 的效果值）')
      else {
        if (p.values.length > 3) report.error(file, `${w}.values`, `L1-3 是上限（§7.3），实际 ${p.values.length} 级`)
        let prev = -Infinity
        p.values.forEach((v, li) => {
          const vw = `${w}.values[${li}]`
          if (!isNum(v)) { report.error(file, vw, '必须是数字'); return }
          if (v <= 0) report.error(file, vw, `L${li + 1} = ${v} ≤ 0：学了等于没学，这一级没有存在的理由`)
          if (v <= prev) report.error(file, vw, `L${li + 1} = ${v} 不大于上一级 ${prev}：升级不能变弱`)
          prev = v
        })
        // 每一级都要有价目：learnPassive 拿 level 去 index passiveCost，够不着就当"已满"拒绝
        if (isArr(passiveCost) && p.values.length > passiveCost.length) {
          report.error(file, `${w}.values`, `L${p.values.length} 的学费没有价目（passiveCost 只有 ${passiveCost.length} 档）⇒ 第 ${passiveCost.length + 1} 级永远研读不动`)
        }
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
    for (const k of Object.keys(m)) if (!['id', 'page', 'nameKey', 'displayName', 'desc', 'cost', 'frame', 'levels', 'landing', 'echo'].includes(k)) report.error(file, `${w}.${k}`, '不认的字段（§55）')
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
    // 回响（定音回响 §7.2）：加宽乘数与充能必须两半都在。windowMul < 1 的赌注同 whiffDmgMul——
    // "回响"反而把窗拧窄，就变成对成功弹反的惩罚。int 是硬要求：parryTicksLeft 靠 `=== 0` 落账，
    // 小数窗永远关不上 ⇒ §5.3 的落空与回响的账一起静默蒸发。
    if (m.echo !== undefined) {
      if (!isObj(m.echo)) report.error(file, `${w}.echo`, '必须是 { windowMul }')
      else {
        for (const k of Object.keys(m.echo)) if (k !== 'windowMul') report.error(file, `${w}.echo.${k}`, '不认的字段（§55）')
        report.num(file, `${w}.echo.windowMul`, m.echo.windowMul, { min: 1, int: true, name: 'windowMul' })
      }
      if (!(isArr(m.levels) && m.levels.some((l) => isObj(l) && (l.echoCharges ?? 0) > 0))) {
        report.error(file, `${w}.echo`, '写了加宽乘数但没有任何一级给充能 ⇒ 没有一格可花，窗永远不会加宽（死数据）')
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
      if (l.echoCharges !== undefined) {
        report.num(file, `${lw}.echoCharges`, l.echoCharges, { min: 1, int: true, name: 'echoCharges' })
        // 充能的载体是式子上的 echo 块（windowMul 从那里进 SkillCast）：没有它，
        // tryStartAction 根本不会存这一格——写了三级成长也没人发牌。
        if (!isObj(m.echo)) report.error(file, `${lw}.echoCharges`, '写了回响充能但这一式没有 echo.windowMul ⇒ 无处可加宽，存了也白存')
      }
      if (l.silenceTicks !== undefined) report.num(file, `${lw}.silenceTicks`, l.silenceTicks, { min: 1, int: true, name: 'silenceTicks' })
      if (l.silenceDmgBonus !== undefined) {
        report.num(file, `${lw}.silenceDmgBonus`, l.silenceDmgBonus, { min: 0.01, name: 'silenceDmgBonus' })
        // 加成的载体是 silentTicks 开出的那段窗口（ThirdPersonController.tacet）：没有窗就没有载体，
        // 那一笔百分比永远乘不到任何一记上。
        if (l.silenceTicks === undefined) report.error(file, `${lw}.silenceDmgBonus`, '写了伤害加成但没有 silenceTicks ⇒ 加成没有可挂靠的时段（死数据）')
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
 * PENDING_FLAG_WRITERS 里（带原因），否则 ERROR。**这份名单也要能销**（KI-073：条目里的旗标一旦出现写方
 * ⇒ ERROR）；至于"只许变短"——新记一条欠账是虚是实机器判不了，那一侧留给 review，别写成机器的功劳。
 */
// 名单本体在 ledger-rules.mjs（与里程碑那两份同一个理由）

// `RULE_ONS` / `RULE_FIELDS` 住在顶部词表区（主人 `WorldStateRule` 与它的 `on` 那一格，同一个理由）

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
      // 不在场旗（收摊/撤离）：也是读方——缺席的判定与成色同样吃 §55 双向对账
      if (isStr(it.absentFlag)) read.set(it.absentFlag, `${rg.id}.interactables(${it.id}).absentFlag`)
      // 合取闸门（Phase 6-C 初句圣所）：列进去的每一面旗都是**读方**——少登记一面，
      // 那面旗就会在下面"写了没人读"那条判据里被判成死数据
      if (isArr(it.requiresFlags)) for (const f of it.requiresFlags) if (isStr(f)) read.set(f, `${rg.id}.interactables(${it.id}).requiresFlags`)
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
    // KI-094② 的旗形 weatherSwitch：那面旗也是读方——没有写方的话这一格天气永远不切换，
    // 而那不是"可选的补充"；不登记进来，它就会在"写了没人读"那条判据里变成死旗标。
    if (isObj(rg.weatherSwitch) && isStr(rg.weatherSwitch.flag)) {
      read.set(rg.weatherSwitch.flag, `${rg.id}.weatherSwitch.flag`)
    }
  }
  for (const s of secrets) if (isStr(s.unlockFlag)) read.set(s.unlockFlag, `${s.regionId}.secrets(${s.id}).unlockFlag`)
  // 谱册页的旗标解锁源（KI-037 乐章 IV）：读方登记进对账——没有写方的页永远点不亮
  const mvCfg = data['movements.json']
  if (isObj(mvCfg)) for (const pg of mvCfg.pages ?? []) {
    if (isObj(pg) && isObj(pg.unlock) && isStr(pg.unlock.flag)) read.set(pg.unlock.flag, `movements.json pages(${pg.id}).unlock.flag`)
  }
  // 叙事层（Phase 6-B）也是旗标的写方：对话效果里的 setFlags 与交互物、规则表**同权**。
  // 不把它算进来，就会出现一类假 ERROR——"这个旗标锁着的内容不可达"，而它明明是玩家在对话里选出来的
  // （例：铃姨说出断面 ⇒ `flag.bells_repair_open` ⇒ 三口钟的钟座才修得动）。
  for (const t of data['dialogue.json'] ?? []) {
    if (!isObj(t)) continue
    for (const n of t.nodes ?? []) {
      if (!isObj(n)) continue
      const effectList = [n.effects, ...(n.choices ?? []).map((c) => (isObj(c) ? c.effects : undefined))]
      for (const e of effectList) {
        if (!isObj(e)) continue
        for (const f of e.setFlags ?? []) if (isStr(f)) written.set(f, `${t.id} 对话效果`)
      }
    }
  }
  /*
   * **规则表也是写方**（2026-10-10 修一处假 ERROR 类）：`worldstate.json` 每条规则的 `setFlag`
   * 是"这个世界自己会改的事"——`validateWorldstate` 一直在查它的**反方向**（规则立的旗得有人读），
   * 却没人把它的**正方向**登记进这份普查 ⇒ 于是**凡"只被世界规则写"的旗，一旦被读就吃一条假 ERROR**
   * （"没有任何写方 ⇒ 它锁着的内容玩家不可达"），而那面旗恰恰是玩家打倒 Boss 才会立的。
   * 例：`flag.hersil_felled`（`ws_hersil_felled` 在 `bossDefeated` 时立）被 §3.4 战前对话的
   * `conditions.flags.not` 一读就报 ERROR。**上面那段注释早就写着"与…规则表同权"，实现漏了这一支。**
   */
  for (const r of data['worldstate.json'] ?? []) {
    if (isObj(r) && isStr(r.setFlag)) written.set(r.setFlag, `worldstate.json(${r.id ?? '?'}).setFlag`)
  }
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
    if (r.on === 'stateSet') {
      const stateRow = (data['states.json'] ?? []).find((x) => isObj(x) && x.key === r.stateKey)
      if (!isStr(r.stateKey) || !stateRow) report.error(file, `${w}.stateKey`, `stateSet 规则的 stateKey 必须是 states.json 里登记过的 key`)
      else if (!isArr(r.stateIn) || r.stateIn.length === 0 || !r.stateIn.every((v) => stateRow.values.includes(v))) report.error(file, `${w}.stateIn`, `stateIn 的每个值都必须在 '${r.stateKey}' 的登记域 ${JSON.stringify(stateRow.values)} 里`)
    }
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
  /**
   * 销账判据（KI-073，与 `validateProgression` 里那两条同族）：上面那个循环只在"没人写"时才读这份名单，
   * 所以**写方出现之后条目还留着**它一句话都不说——而名单里那句"待办"从此是假理由。
   * 里程碑那边已经实测过这条形状（`ms_deepcellar` 的账在腿落地之后仍挂着"无腿可接"），
   * 旗标这边今天量到的是干净的（现在的写方只有三条：弹反教学、奥斯塔拉、钟腹闸门，都不在名单上），
   * 所以这条判据现在不响——它买的是"下一次销账不会靠人记得"。
   */
  for (const e of flagLedgerErrors({ pending: PENDING_FLAG_WRITERS, written })) report.error(file, e.key, e.msg)
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
/**
 * 值域型世界状态（`state.*`，Phase 6-B / narrative §7 的 `STATE.<域>.<对象> = <枚举>`）。
 * 这张表把三件事钉死在数据里：一共几格、缺省哪格、谁说了算。
 * 没有它，`conditions.state` / `effects.setState` / `advanceOn.state` / `requiresState`
 * 四处引用会各自发明 key —— 拼错的那个会变成一个永远读不到的死状态，
 * 而逐文件的形状检查看不见它（这正是旗标那边 PENDING_FLAG_WRITERS 一族要挡的东西，值域这边的对应物）。
 * 返回 `key -> { values }`，供四处引用对账。
 */
function validateStates() {
  const file = 'states.json'
  const list = data[file]
  const out = new Map()
  if (!isArr(list) || list.length === 0) { report.error(file, file, '必须是非空数组（值域状态登记表）'); return out }
  list.forEach((s, i) => {
    const w = `[${i}]`
    if (!isObj(s)) { report.error(file, w, '必须是对象'); return }
    if (!isStr(s.key)) report.error(file, `${w}.key`, 'key 必填')
    else if (!s.key.startsWith('state.')) report.error(file, `${w}.key`, `命名必须是 state.*（与旗标 flag.* 同一条命名纪律）：${s.key}`)
    if (!isStr(s.displayName)) report.error(file, `${w}.displayName`, 'displayName 必填（F3 面板与锁门文案要印它）')
    const values = s.values
    if (!isArr(values) || values.length < 2) report.error(file, `${w}.values`, '至少两格（一格不叫状态机）')
    else {
      strArray(file, `${w}.values`, values, { nonEmpty: true })
      const dup = values.find((v, idx) => values.indexOf(v) !== idx)
      if (dup !== undefined) report.error(file, `${w}.values`, `取值重复：${JSON.stringify(dup)}（枚举里两格同名，写进去也读不出落在哪一格）`)
    }
    if (!isStr(s.default)) report.error(file, `${w}.default`, 'default 必填（这一格从没被写过时读它——"还没抉择"是状态机的一格，不是第五种谓词）')
    else if (isArr(values) && !values.includes(s.default)) report.error(file, `${w}.default`, `default 必须是 values 里的一员：${JSON.stringify(s.default)}`)
    if (s.note !== undefined && !isStr(s.note)) report.error(file, `${w}.note`, '必须是非空字符串')
    if (!isStr(s.key) || out.has(s.key)) return
    out.set(s.key, { values: isArr(values) ? values : [] })
  })
  return out
}

/**
 * 一处值域引用（对话条件 / 对话效果 / 任务步 advanceOn / 交互物 requiresState）的对账：
 * key 必须在 `states.json` 登记过，用到的取值必须是那一格里的成员。
 * 返回错误消息（空数组 = 干净），由四处引用各报各的文件与位置。
 */
function stateRefErrors(stateDefs, key, values) {
  if (!isStr(key)) return ['key 缺失或非字符串']
  const def = stateDefs.get(key)
  if (!def) return [`不在 states.json 登记表里：${key}（值域的 key 与取值只能由这张表说了算）`]
  const out = []
  for (const v of values ?? []) if (!def.values.includes(v)) out.push(`取值 ${JSON.stringify(v)} 不在 ${key} 的取值表里（合法：${def.values.join('/')}）`)
  return out
}

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

/**
 * 世界上"能指的东西"三份名册（KI-137：任务步的 `marker` 要指向其中之一）。
 *
 * **npc 名册从 `regions.json` 的交互位上收**（`interactables[].npcId`）——npc 的**位置**住在世界里，
 * 不住在 `npcs.json`；任务表只说"去找铃姨"，不写坐标。
 */
/**
 * **目标指示**（任务步的 `marker` 与区域的 `prologueMarker`）的判据本体。
 *
 * **同一种形状只有一份判据**：两处指向的形状完全一样（npc / interact / region / pos），
 * 分开写两份就是两个主人——将来加一形要记得改两处。
 *
 * 指错了 ⇒ 玩家永远找不到该去的地方（而画面上那枚箭头还指着另一个方向，比没有箭头更坏）
 * ⇒ 拼错一个字母当场红。
 */
function markerFindings(file, where, marker, targets) {
  const out = []
  const err = (w, msg) => out.push({ where: w, msg })
  if (!isObj(marker)) {
    err(where, '必须是对象')
    return out
  }
  const kind = marker.kind
  if (!['npc', 'interact', 'region', 'pos'].includes(kind)) {
    err(`${where}.kind`, `未知指示种类：${kind}（npc/interact/region/pos）`)
  } else if (kind === 'pos') {
    if (!isObj(marker.pos) || !['x', 'y', 'z'].every((k) => isNum(marker.pos?.[k]))) {
      err(`${where}.pos`, '必须带 x / y / z 三个数')
    }
  } else if (!isStr(marker.id)) {
    err(`${where}.id`, '必须是非空字符串')
  } else {
    const pool = kind === 'npc' ? targets.npcIds : kind === 'interact' ? targets.interactIds : targets.regionIds
    if (!pool.has(marker.id)) {
      const what = kind === 'npc' ? '世界里的 npc 名册' : kind === 'interact' ? 'regions.json 的交互物' : 'regions.json 的区域'
      err(`${where}.id`, `悬空引用：'${marker.id}' 不在${what}里`)
    }
  }
  return out
}

function collectMarkerTargets() {
  const npcIds = new Set()
  const interactIds = new Set()
  const regionIds = new Set()
  for (const rg of data['regions.json'] ?? []) {
    if (!isObj(rg)) continue
    if (isStr(rg.id)) regionIds.add(rg.id)
    for (const it of rg.interactables ?? []) {
      if (!isObj(it)) continue
      if (isStr(it.id)) interactIds.add(it.id)
      if (isStr(it.npcId)) npcIds.add(it.npcId)
    }
  }
  return { npcIds, interactIds, regionIds }
}

function validateQuests(npcIds, stateDefs, markerTargets) {
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
      // KI-137：这一步的**目标指示**（判据与区域的序章指向共用同一份，见 markerFindings）
      if (st.marker !== undefined) {
        for (const e of markerFindings(file, `${sw}.marker`, st.marker, markerTargets)) report.error(file, e.where, e.msg)
      }
      if (st.tags !== undefined) {
        strArray(file, `${sw}.tags`, st.tags, { nonEmpty: true })
        for (const t of st.tags ?? []) if (!QUEST_TAGS.has(t)) report.error(file, `${sw}.tags`, `未知标注：${t}（§28 只有 D/C/H/M）`)
      }
      if (st.advanceOn !== undefined) {
        if (!isObj(st.advanceOn)) { report.error(file, `${sw}.advanceOn`, '必须是对象'); return }
        if (st.advanceOn.flags === undefined && st.advanceOn.state === undefined) {
          report.error(file, `${sw}.advanceOn`, '至少要写 advanceOn.flags 或 advanceOn.state 之一（没有读方的步骤永远不会自己往前走）')
        }
        if (st.advanceOn.flags !== undefined) {
          strArray(file, `${sw}.advanceOn.flags`, st.advanceOn.flags, { nonEmpty: true })
          for (const f of st.advanceOn.flags ?? []) if (!isStr(f) || !f.startsWith('flag.')) report.error(file, `${sw}.advanceOn.flags`, `旗标命名必须是 flag.*：${f}`)
        }
        if (st.advanceOn.state !== undefined) {
          if (!isObj(st.advanceOn.state)) report.error(file, `${sw}.advanceOn.state`, '必须是对象 { key, in }')
          else {
            if (!isArr(st.advanceOn.state.in)) report.error(file, `${sw}.advanceOn.state.in`, '必须是数组（这一步等哪些取值）')
            else strArray(file, `${sw}.advanceOn.state.in`, st.advanceOn.state.in, { nonEmpty: true })
            for (const msg of stateRefErrors(stateDefs, st.advanceOn.state.key, st.advanceOn.state.in)) {
              report.error(file, `${sw}.advanceOn.state`, msg)
            }
          }
        }
      }
    })
  })
  return ids
}

function validateDialogue(npcIds, questIds, itemIds, stateDefs) {
  const file = 'dialogue.json'
  const list = data[file]
  const ids = new Set()
  const flagReads = new Map()
  const flagWrites = new Map()
  /** 值域状态的读写名册（与旗标那两份同构；对账在主流程末尾做） */
  const stateReads = new Map()
  const stateWrites = new Map()
  const note = (map, flag, where) => { if (!map.has(flag)) map.set(flag, where) }
  if (!isArr(list) || list.length === 0) { report.error(file, file, '必须是非空数组'); return { ids, flagReads, flagWrites, stateReads, stateWrites } }

  const checkCondition = (where, c, npc) => {
    if (c === undefined) return
    if (!isObj(c)) { report.error(file, where, '必须是对象'); return }
    for (const k of Object.keys(c)) if (!CONDITION_FIELDS.has(k)) report.error(file, `${where}.${k}`, `未知条件：${k}（条件求值只认这五种）`)
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
    if (c.state !== undefined) {
      if (!isObj(c.state)) { report.error(file, `${where}.state`, '必须是对象 { key, eq | in | notIn }'); return }
      const used = [c.state.eq, ...(isArr(c.state.in) ? c.state.in : []), ...(isArr(c.state.notIn) ? c.state.notIn : [])].filter((v) => v !== undefined)
      if (used.length === 0) report.error(file, `${where}.state`, '至少要写 eq / in / notIn 之一（什么都不比的条件永远成立）')
      if (c.state.in !== undefined) strArray(file, `${where}.state.in`, c.state.in, { nonEmpty: true })
      if (c.state.notIn !== undefined) strArray(file, `${where}.state.notIn`, c.state.notIn, { nonEmpty: true })
      for (const msg of stateRefErrors(stateDefs, c.state.key, used)) report.error(file, `${where}.state`, msg)
      if (isStr(c.state.key)) note(stateReads, c.state.key, `${where}.state`)
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
    if (e.setState !== undefined) {
      if (!isObj(e.setState)) { report.error(file, `${where}.setState`, '必须是对象 { key, value }'); return }
      for (const msg of stateRefErrors(stateDefs, e.setState.key, [e.setState.value])) report.error(file, `${where}.setState`, msg)
      if (isStr(e.setState.key)) note(stateWrites, e.setState.key, `${where}.setState`)
    }
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
  // KI-089：**读得到的台词**。上面那条"每棵树都要有落点"只顺 root/fallback 的**第一条**路走，
  // 走不到的节点它不作声 —— 而实测里正是有 19 个节点没有任何一条边指向（科温 7 / 无面童 8 / 盐歌 4），
  // 写它的人以为它在场上。判据本体在 `dialogue-rules.mjs`（孤儿节点 + 没有出口的环），这里只报。
  for (const e of dialogueReachErrors(list)) report.error(file, e.at, e.msg)
  return { ids, flagReads, flagWrites, stateReads, stateWrites }
}

// ---- 跑全部校验（跨文件引用需要先拿到 id 集合）----
// 值域状态表先跑：regions/quests/dialogue 三处都要拿它当对账依据（key 与取值只能由它说了算）
const stateDefs = validateStates()
// statuses 先跑：enemies 的 statusOnHit.tag 要拿它当词表对账
validateStatuses()
// §8 受击反应表（KI-050）：独立一张小表，没有跨文件引用
validateReactions()
const movesetIds = validateMovesets()
const weaponIds = validateWeapons(movesetIds)
// progression 要先跑：稀有度是 items/loot 的跨文件依据；items 要先跑：掉落表引用物品 id
const { rarityIds, affixDefs, originPassives } = validateProgression()
const itemIds = validateItems(weaponIds, rarityIds, affixDefs)
// §6.2/§6.3 营地交易（KI-055/KI-059）：买侧清单与卖侧类别名单要按 kind 互相对账，所以把整张 items 交给它
validateShop((Array.isArray(data['items.json']) ? data['items.json'] : []).filter(isObj))
const lootIds = validateLoot(itemIds, rarityIds)
// §2.2 出身被动双向对账（KI-031③）：itemId 必须活在 items.json，也必须真被某张掉落表掉出——
// 后者是"被动承诺加成于一个无人掉落的东西"的空头支票门，等 loot 跑完才量得到。
{
  const lootItemIds = new Set()
  for (const t of data['loot.json'] ?? []) {
    if (!isObj(t)) continue
    for (const r of Array.isArray(t.rolls) ? t.rolls : []) if (isStr(r?.item)) lootItemIds.add(r.item)
  }
  for (const p of originPassives) {
    if (!itemIds.has(p.itemId)) report.error('progression.json', `${p.w}.itemId`, `悬空引用：'${p.itemId}' 不在 items.json`)
    if (!lootItemIds.has(p.itemId)) report.error('progression.json', `${p.w}.itemId`, `'${p.itemId}' 没有任何掉落表掉它——被动在给不存在的产出加成`)
  }
}
const enemyIds = validateEnemies(lootIds)
validatePlayer()
const regionIds = validateRegions(enemyIds, lootIds, rarityIds, stateDefs, collectMarkerTargets())
// KI-077：环境声床表要对账 regions 的 music.ambience，所以排在它后面
validateAmbience()
// KI-079：探索曲表同理对账 regions 的 music.explore
validateExplore()
// KI-080：战斗档表对账 regions 的 music.battle（这一格从"指向一张不存在的表"变成有读者的行）
validateBattle()
// KI-092：§8.2 侧链表要对账两处源码名单（引擎的触发口 + 总线名册），所以排在它们所在的模块之外也能读到
validateDucking()
// KI-094：天气表要对账两端名册（§38 的档名联合 + 各区 weatherPresets 引用的名字），排在 regions 之后
/**
 * §37 区域光照预设（需求 §37 / art-direction §2 六色 + §8 LUT 两格）的判据落点。
 * 判据本体住 `scripts/lighting-rules.mjs`（hex 合法、乘数有界、两侧引用都交代得清），
 * 与 `weatherFindings` 同一族纪律：判据要能被合成夹具喂，也要能被校验器读**同一份**实现。
 *
 * 排在 `validateRegions` 之后：③④ 两条跨文件判据要读 `regions.json > lightingPresets` 的全体读数。
 * 表未落地时这道门空转（不是数组就返回），表一落即生效。
 */
function validateLighting() {
  const file = 'lighting.json'
  if (!isArr(data[file])) return
  const rows = data[file]
  const referenced = []
  for (const rg of data['regions.json'] ?? []) {
    if (isObj(rg) && isStr(rg.lightingPreset)) referenced.push(rg.lightingPreset)
  }
  for (const e of lightingFindings(file, rows, referenced)) report.error(file, e.where, e.msg)
}

/**
 * 表现层三件套配置表（Phase B4）的判据落点。判据本体住 `vfx-rules.mjs`
 * （贴花/拖尾/发射器三段各自的值域、hex 合法、id 跨段不重名），
 * 与 `lightingFindings` 同一族纪律：判据要能被合成夹具喂，也要能被校验器读**同一份**实现。
 *
 * 排在最后：它不读别的表（只读自己），但**发射方那几条 id** 要在别处对账（见 `tests/unit/vfx-table.test.ts`）。
 */
function validateVfx() {
  const file = 'vfx.json'
  if (!isObj(data[file])) return
  for (const e of vfxFindings(file, data[file])) report.error(file, e.where, e.why)
}

// KI-135：表现层三件套的配置表（贴花/拖尾/发射器）——判据住 `vfx-rules.mjs`
validateVfx()

/**
 * §6 过场清单（需求 §31）的判据落点。判据本体住 `cinematic-rules.mjs`（单条 ≤25s / 全清单 ≤180s、
 * id 唯一、`durationMs` 为正、缺字段说话、非数组报"这道门在空转"）——与 `weatherFindings` 同一族纪律：
 * 判据要能被合成夹具喂，也要能被校验器读**同一份**实现。
 *
 * 这两条上限不是这里编的，是 §6 自己写的；清单未落地时这道门空转（空表不报错），表一落即生效。
 */
function validateCinematics() {
  const file = 'cinematics.json'
  if (!isArr(data[file])) return
  for (const e of cinematicBudgetErrors(data[file])) report.error(file, e.where, e.why)
  // 引用对账：对话里挂的 `cinematic` 名字必须都在清单里（拼错一个字母 = 那一段永远不演）
  for (const e of cinematicReferenceErrors(data[file], data['dialogue.json'])) {
    report.error('dialogue.json', e.where, e.why)
  }
}

validateLighting()

validateWeather()
validateCinematics()
// KI-100：世界图几何（点位归属 / 落点歧义 / 锚点共线）——同样只读 regions，所以也排在它之后
validateWorldGraph()
// movements 最后跑：它要同时对账 items（点亮源）、loot（源是否真会掉）、progression（开槽里程碑）
validateMovements(itemIds)
// 叙事层（Phase 6-B）：NPC → 任务 → 对话（后者依赖前两者的 id）
const npcIds = validateNpcs()
const questIds = validateQuests(npcIds, stateDefs, collectMarkerTargets())
const dialogueInfo = validateDialogue(npcIds, questIds, itemIds, stateDefs)
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
/**
 * 值域状态的双向对账（与上面旗标那三条同一族，只是把"一面旗"换成"一格枚举"）：
 * ① 读了却没人写 ⇒ 那个条件永远不成立，它锁着的内容不可达（旗标那边是 KI-041 的机器版判据）；
 * ② 写了却没人读 ⇒ 死数据（§55：字段与状态都必须有真实消费方）；
 * ③ 登记了却整张表都没人碰 ⇒ 死表（`states.json` 自己的那条）。
 * 写方今天只有一条路（对话效果 `effects.setState`）；哪天世界状态规则表也写值域，这里要跟着认第二条。
 */
{
  const reads = new Map()
  const writes = new Map(dialogueInfo.stateWrites)
  const put = (m, k, w) => { if (isStr(k) && !m.has(k)) m.set(k, w) }
  for (const [k, w] of dialogueInfo.stateReads) put(reads, k, w)
  for (const q of data['quests.json'] ?? []) {
    if (!isObj(q)) continue
    ;(Array.isArray(q.steps) ? q.steps : []).forEach((st, i) => put(reads, st?.advanceOn?.state?.key, `${q.id}.steps[${i}].advanceOn.state`))
  }
  for (const rg of data['regions.json'] ?? []) {
    if (!isObj(rg)) continue
    for (const it of rg.interactables ?? []) if (isObj(it)) put(reads, it.requiresState?.key, `${rg.id}.interactables(${it.id}).requiresState`)
    // KI-094② 的值域形 weatherSwitch：那一格值域也是读方（否则它会落进"写了没人读"的死数据）
    if (isObj(rg.weatherSwitch) && isObj(rg.weatherSwitch.state)) put(reads, rg.weatherSwitch.state.key, `${rg.id}.weatherSwitch.state.key`)
  }
  for (const [k, w] of [...reads].sort()) {
    if (writes.has(k)) continue
    report.error('states.json', k, `${w} 在读它，但没有任何写方（值域的写方今天只有对话效果 effects.setState）⇒ 这一格永远停在 default，它锁着的内容不可达`)
  }
  for (const [k, w] of [...writes].sort()) {
    if (reads.has(k)) continue
    report.error('states.json', k, `${w} 写了它，但没有任何读方（对话条件 / 任务步 advanceOn / 交互物 requiresState）⇒ 写进去也没人看的死数据`)
  }
  for (const k of [...stateDefs.keys()].sort()) {
    if (reads.has(k) || writes.has(k)) continue
    report.warn('states.json', k, '登记了这一格，但整张表里既没有读方也没有写方 ⇒ 死表')
  }
}
void dialogueInfo.ids
// worldstate 最后：它要拿 regions/enemies 的 id 与"谁在读旗标"做双向对账
validateWorldstate()
validateGearRarityCoverage()
validateVocabDrift()
// KI-093 排在最后：它读的是本文件的源码，而"有没有被调用"正是它的一条判据 ⇒ 调用点必须已经写下去了
validateValidatorMap()
void regionIds

// ---- 报告 ----
let errTotal = 0
let warnTotal = 0
console.log('CAESURA 数据校验（KI-015 门禁）— src/data/json')
/**
 * 打印的段 = 11 份 JSON ∪ **报过事的其他名字**。
 * 前半直查出来的一件事（KI-074）：词表对账挂在 `schema.ts` 这个段名下，而这段循环只走 `FILES`，
 * 于是它报的 ERROR 既不打印也不计数——**一门彻底哑掉的门**，四趟植入实测全部"不咬"就是这么来的。
 * 跨文件的检查以后还会加，所以修的是这段循环，不是给对账挑一个在 `FILES` 里的假名字。
 */
const sections = [...FILES, ...[...new Set(report.rows.map((x) => x.file))].filter((f) => !FILES.includes(f))]
for (const f of sections) {
  const rows = report.rows.filter((x) => x.file === f)
  const errs = rows.filter((x) => x.level === 'ERROR')
  const warns = rows.filter((x) => x.level === 'WARN')
  errTotal += errs.length
  warnTotal += warns.length
  if (!FILES.includes(f) && rows.length === 0) continue
  console.log(`\n=== ${f} ===`)
  if (rows.length === 0) console.log('  OK — 无 ERROR / WARN')
  for (const x of errs) console.log(`  ERROR  ${x.where}: ${x.msg}`)
  for (const x of warns) console.log(`  WARN   ${x.where}: ${x.msg}`)
  if (rows.length > 0) console.log(`  -- ${errs.length} ERROR / ${warns.length} WARN`)
}
console.log(`\n总计：${errTotal} ERROR / ${warnTotal} WARN`)
process.exit(errTotal > 0 ? 1 : 0)
