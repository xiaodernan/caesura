import { registry } from '@/core/Registry'
import playerRaw from './json/player.json'
import movesetsRaw from './json/movesets.json'
import weaponsRaw from './json/weapons.json'
import enemiesRaw from './json/enemies.json'
import lootRaw from './json/loot.json'
import type { MovesetData, WeaponData, EnemyData, PlayerBaseData } from './schema'

export const playerBase = playerRaw as unknown as PlayerBaseData

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
  for (const l of lootRaw as { id: string; entries: unknown }[]) registry.register(l.id, l)
  registry.register('player:base', playerBase)
}

export { weaponsRaw, enemiesRaw, movesetsRaw }
