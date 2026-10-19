import { registry } from '@/core/Registry'
import playerRaw from './json/player.json'
import movesetsRaw from './json/movesets.json'
import weaponsRaw from './json/weapons.json'
import enemiesRaw from './json/enemies.json'
import lootRaw from './json/loot.json'
import regionsRaw from './json/regions.json'
import progressionRaw from './json/progression.json'
import itemsRaw from './json/items.json'
import npcsRaw from './json/npcs.json'
import dialogueRaw from './json/dialogue.json'
import questsRaw from './json/quests.json'
import statusesRaw from './json/statuses.json'
import movementsRaw from './json/movements.json'
import worldstateRaw from './json/worldstate.json'
import statesRaw from './json/states.json'
import reactionsRaw from './json/reactions.json'
import shopRaw from './json/shop.json'
import ambienceRaw from './json/ambience.json'
import exploreRaw from './json/explore.json'
import battleRaw from './json/battle.json'
import duckingRaw from './json/ducking.json'
import weatherRaw from './json/weather.json'
import cinematicsRaw from './json/cinematics.json'
import lightingRaw from './json/lighting.json'
import vfxRaw from './json/vfx.json'
import navmeshResthold from './json/navmesh/rg_resthold.navmesh.json'
import navmeshWhisperwode from './json/navmesh/rg_whisperwode.navmesh.json'
import navmeshDrownedChoir from './json/navmesh/rg_drowned_choir.navmesh.json'
import navmeshBrokenbarCamp from './json/navmesh/rg_brokenbar_camp.navmesh.json'
import navmeshFellcarillon from './json/navmesh/rg_fellcarillon.navmesh.json'
import navmeshEarlessDeeps from './json/navmesh/rg_earless_deeps.navmesh.json'
import navmeshUnfinishedHall from './json/navmesh/rg_unfinished_hall.navmesh.json'
import type { MovesetData, WeaponData, EnemyData, PlayerBaseData, RegionData, ProgressionData, ItemData, LootTableData, NpcData, DialogueData, QuestData, StatusConfig, MovementConfig, WorldStateRule, WorldStateDef, HitReactionTable, ShopData, AmbienceBed, ExploreScore, BattleScore, DuckRow, WeatherRow, CinematicRow, LightingRow, VfxTable } from './schema'

export const playerBase = playerRaw as unknown as PlayerBaseData
export const regions = regionsRaw as unknown as RegionData[]
export const progression = progressionRaw as unknown as ProgressionData
export const items = itemsRaw as unknown as ItemData[]
export const npcs = npcsRaw as unknown as NpcData[]
export const dialogues = dialogueRaw as unknown as DialogueData[]
export const quests = questsRaw as unknown as QuestData[]
/** §11 五状态的单一数值真源（含世界观 tooltip）；派生读取走 combat/Statuses.ts 的 `statusConfig()` */
export const statuses = statusesRaw as unknown as StatusConfig
/** §7 乐章战技谱册（页/槽/等级成长）；成长状态本身在 rpg/Movements.ts，这里只有静态表 */
export const movements = movementsRaw as unknown as MovementConfig
/** 世界状态的写入规则表（narrative §7 的执行位）：发生了什么 ⇒ 立哪个旗标 */
export const worldstate = worldstateRaw as unknown as WorldStateRule[]
/** 值域型世界状态登记表（narrative §7 的 `STATE.*`）：一格状态有哪几个取值、缺省是哪个 */
export const worldStates = statesRaw as unknown as WorldStateDef[]
/** §8 受击反应表（只有有承载体的行：R1 玩家受击 / R4 破势时长）；派生读取走 combat/Reactions.ts */
export const reactions = reactionsRaw as unknown as HitReactionTable
/** §6.2/§6.3 营地商店（买清单 + 卖装系数）；玩法读取走 rpg/Shop.ts，红线由 validator 钉住 */
export const shop = shopRaw as unknown as ShopData
/** docs/audio.md §1.2/§4 的区域环境声床（行键 = `regions.json > music.ambience`）；唯一读者是 `audio/AudioEngine.ts`（id→行 解析在那里，解析结果注入 `MusicLayer`） */
export const ambienceBeds = ambienceRaw as unknown as AmbienceBed[]
/** docs/audio.md §1.2 的区域探索曲（行键 = `regions.json > music.explore`）：R-1 的哪一种变形、每音占几拍、这一区的主音。唯一读者同上（KI-079） */
export const exploreScores = exploreRaw as unknown as ExploreScore[]
/** docs/audio.md §1.1/§2.2 的区域战斗档（行键 = `regions.json > music.battle`）：低音走哪条线、钟隔几小节，或显式的"无配乐"。唯一读者同上（KI-080） */
export const battleScores = battleRaw as unknown as BattleScore[]
/**
 * docs/audio.md §8.2 的侧链表（一行 = 文档表里那一行：谁触发、压哪几条总线、压多少 dB、压多久）。
 * 唯一读者是 `audio/AudioEngine.ts`（KI-092）：触发口在那里接，压的是四条前置总线的基准电平，
 * 数学（dB→增益、叠压取最深）住 `audio/ducking.ts`。这里不进 `registry`：行键 `parry` 不是内容 id，
 * 没有任何一处按 id 取它——登记进注册表就是给一个没人敲的门配一把钥匙。
 */
export const duckingRows = duckingRaw as unknown as DuckRow[]
/**
 * 需求 §38 / art-direction §8 的天气表（一行 = 数据侧的一个天气名加它那一档的读数，KI-094）。
 * 唯一读者是 `vfx/ColorGrade.ts`：它按驻留天气写 `scene.fog.density`，并把乘数与失谐的褪色合成成
 * 一条 `canvas.style.filter`。和 `duckingRows` 同理**不进 `registry`**：行键（`clear`／`fog`／
 * `dissonant-storm`）是被 `regions.json > weatherPresets` 指着的名字而不是内容 id，注册表里没有按 id 敲它的门。
 */
export const weatherRows = weatherRaw as unknown as WeatherRow[]

/** §6 过场清单（需求 §31）。判据住 `scripts/cinematic-rules.mjs`（单条 ≤25s / 全清单 ≤180s） */
export const cinematics = cinematicsRaw as unknown as CinematicRow[]
/**
 * §37 区域光照预设表（art-direction §2 的六色 + §8 的 LUT 两格）。行键 = `regions.json > lightingPreset`。
 * 唯一读者是 `vfx/ColorGrade.ts`（读数经 `world/Lighting.ts`）：雾色与每区的饱和度/对比乘数。
 * 与 `weatherRows` 同理**不进 `registry`**：`lp_*` 是被区域指着的名字，不是内容 id。
 */
export const lightingRows = lightingRaw as unknown as LightingRow[]

/**
 * 表现层三件套的配置表（Phase B4：贴花 / 拖尾 / 发射器，KI-135）。
 *
 * **进 `registry`，但用三个带前缀的键**（`vfx:decals` / `vfx:trails` / `vfx:emitters`），
 * 而不是把 id 一个个塞进顶层：这三张表的 id 与别处的 id（武器、招式、敌人）不在同一个命名空间里，
 * 顶层混着会让"这个 id 指的是什么"变成猜的（`vfx-rules.mjs` 的跨段重名判据同源）。
 *
 * 读者：`vfx/Decals.ts`、`vfx/Trails.ts`、`vfx/GPUParticles.ts`——表现层自己读，
 * 战斗层与 AI 层不碰它们（依赖方向单向）。
 */
export const vfxTable = vfxRaw as unknown as VfxTable

let registered = false

export function registerGameData(): void {
  if (registered) return
  registered = true
  for (const ms of movesetsRaw as unknown as MovesetData[]) registry.register(ms.id, ms)
  for (const w of weaponsRaw as unknown as WeaponData[]) {
    registry.register(w.id, w)
    registry.register(`moveset:${w.movesetId}`, (movesetsRaw as unknown as MovesetData[]).find((m) => m.id === w.movesetId))
  }
  for (const e of enemiesRaw as unknown as EnemyData[]) registry.register(e.id, e)
  for (const l of lootRaw as unknown as LootTableData[]) registry.register(l.id, l)
  for (const r of regions) registry.register(r.id, r)
  for (const it of items) registry.register(it.id, it)
  // 叙事层（Phase 6-B）：NPC / 对话树 / 任务线各自进注册表，谁都能按 id 取
  for (const n of npcs) registry.register(n.id, n)
  for (const d of dialogues) registry.register(d.id, d)
  for (const q of quests) registry.register(q.id, q)
  registry.register('player:base', playerBase)
  registry.register('progression', progression)
  registry.register('statuses', statuses)
  registry.register('movements', movements)
  registry.register('reactions', reactions)
  registry.register(shop.id, shop)
  for (const b of ambienceBeds) registry.register(b.id, b)
  for (const r of worldstate) registry.register(r.id, r)
  for (const s of worldStates) registry.register(s.key, s)
  // 表现层三件套的配置（Phase B4）：三个带前缀的键，读者是表现层那三个文件
  registry.register('vfx:decals', vfxTable.decals)
  registry.register('vfx:trails', vfxTable.trails)
  registry.register('vfx:emitters', vfxTable.emitters)
  // 导航网格（Phase B1）：每个区域的烘焙网格按 navmeshRef 的 key 进注册表
  registry.register('navmesh/rg_resthold.navmesh.json', navmeshResthold)
  registry.register('navmesh/rg_whisperwode.navmesh.json', navmeshWhisperwode)
  registry.register('navmesh/rg_drowned_choir.navmesh.json', navmeshDrownedChoir)
  registry.register('navmesh/rg_brokenbar_camp.navmesh.json', navmeshBrokenbarCamp)
  registry.register('navmesh/rg_fellcarillon.navmesh.json', navmeshFellcarillon)
  registry.register('navmesh/rg_earless_deeps.navmesh.json', navmeshEarlessDeeps)
  registry.register('navmesh/rg_unfinished_hall.navmesh.json', navmeshUnfinishedHall)
}

export { weaponsRaw, enemiesRaw, movesetsRaw, regionsRaw, progressionRaw, itemsRaw, lootRaw, worldstateRaw }
