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
import reactionsRaw from './json/reactions.json'
import shopRaw from './json/shop.json'
import type { MovesetData, WeaponData, EnemyData, PlayerBaseData, RegionData, ProgressionData, ItemData, LootTableData, NpcData, DialogueData, QuestData, StatusConfig, MovementConfig, WorldStateRule, HitReactionTable, ShopData } from './schema'

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
/** §8 受击反应表（只有有承载体的行：R1 玩家受击 / R4 破势时长）；派生读取走 combat/Reactions.ts */
export const reactions = reactionsRaw as unknown as HitReactionTable
/** §6.2/§6.3 营地商店（买清单 + 卖装系数）；玩法读取走 rpg/Shop.ts，红线由 validator 钉住 */
export const shop = shopRaw as unknown as ShopData

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
  for (const r of worldstate) registry.register(r.id, r)
}

export { weaponsRaw, enemiesRaw, movesetsRaw, regionsRaw, progressionRaw, itemsRaw, lootRaw, worldstateRaw }
