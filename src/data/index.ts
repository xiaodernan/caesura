import { registry } from '@/core/Registry'
import playerRaw from './json/player.json'
import movesetsRaw from './json/movesets.json'
import weaponsRaw from './json/weapons.json'
import enemiesRaw from './json/enemies.json'
import lootRaw from './json/loot.json'
import regionsRaw from './json/regions.json'
import progressionRaw from './json/progression.json'
import itemsRaw from './json/items.json'
import statusesRaw from './json/statuses.json'
import type { MovesetData, WeaponData, EnemyData, PlayerBaseData, RegionData, ProgressionData, ItemData, LootTableData, StatusConfig } from './schema'

export const playerBase = playerRaw as unknown as PlayerBaseData
export const regions = regionsRaw as unknown as RegionData[]
export const progression = progressionRaw as unknown as ProgressionData
export const items = itemsRaw as unknown as ItemData[]
/** §11 五状态的单一数值真源（含世界观 tooltip）；派生读取走 combat/Statuses.ts 的 `statusConfig()` */
export const statuses = statusesRaw as unknown as StatusConfig

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
  registry.register('player:base', playerBase)
  registry.register('progression', progression)
  registry.register('statuses', statuses)
}

export { weaponsRaw, enemiesRaw, movesetsRaw, regionsRaw, progressionRaw, itemsRaw, lootRaw }
