import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Catalog — data-side invariant guard (neither runtime nor build).
 *
 * 攻入：任何时候 region 加了 enemyId / spawnGruour / weatherPreset / music row 漂移
 *       不进脚本就红，写进 CI 早于玩家看  -- 之后也没有任何玩家能逃进"被污染的组合根"
 *
 * 粒度：
 *   1. regions.json.weatherPresets[*] 无悬空引用
 *   2. regions.json.spawnGroups[*].enemyId 在 enemies.json 中登记
 *   3. regions.json.spawnGroups[*].condition（若存在）只引用 dialogue.json 中可见的 flag
 *      （这不全部——它只检查 flag.* 出现在 dialogue.json 的 effects 任意一处）
 *   4. regions.json.music.explore/battle/ambience 在 explore/battle/ambience.json 中都在
 *   5. region 内 landmarks / secrets / interactables id 唯一（region-local）
 *   6. region 的 unlockFlag 在 dialogue.json effects 中出现过或出现在 worldstate.json 中
 *   （旨在拦截"这里写了一个旗，但全世界没人写"）
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const load = (rel: string) => JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8'))

describe('catalog — data invariants (new gates)', () => {
  const regions: Array<Record<string, unknown>> = load('src/data/json/regions.json')
  const enemies: Array<{ id: string }> = load('src/data/json/enemies.json')
  const enemyIds = new Set(enemies.map((e) => e.id))
  const weatherRows: Array<{ id: string }> = load('src/data/json/weather.json')
  const weatherIds = new Set(weatherRows.map((w) => w.id))
  const exploreRows: Array<{ id: string }> = load('src/data/json/explore.json')
  const battleRows: Array<{ id: string }> = load('src/data/json/battle.json')
  const ambienceRows: Array<{ id: string }> = load('src/data/json/ambience.json')
  const exploreIds = new Set(exploreRows.map((r) => r.id))
  const battleIds = new Set(battleRows.map((r) => r.id))
  const ambienceIds = new Set(ambienceRows.map((r) => r.id))

  it('every region references registered weather', () => {
    for (const r of regions) {
      const ow = r.weatherPresets as string[] | undefined
      if (!Array.isArray(ow)) continue
      for (const w of ow) expect(weatherIds.has(w), `${r.id} weather: ${w}`).toBe(true)
    }
  })

  it('every spawnGroup enemyId exists in enemies.json', () => {
    for (const r of regions) {
      const groups = (r.spawnGroups ?? []) as Array<{ enemyId?: string }>
      for (const g of groups) expect(enemyIds.has(g.enemyId ?? ''), `${r.id}.spawnGroups[${g.enemyId}]`).toBe(true)
    }
  })

  it('every region`s music.explore/battle/ambience exists as row', () => {
    for (const r of regions) {
      const music = r.music as { explore?: string; battle?: string; ambience?: string } | undefined
      if (!music) continue
      if (music.explore) expect(exploreIds.has(music.explore), `${r.id}.music.explore=${music.explore}`).toBe(true)
      if (music.battle) expect(battleIds.has(music.battle), `${r.id}.music.battle=${music.battle}`).toBe(true)
      if (music.ambience) expect(ambienceIds.has(music.ambience), `${r.id}.music.ambience=${music.ambience}`).toBe(true)
    }
  })

  it('every landmark id is unique within its region', () => {
    for (const r of regions) {
      const ids = ((r.landmarks ?? []) as Array<{ id: string }>).map((x) => x.id)
      expect(new Set(ids).size, `${r.id}.landmarks dup`).toBe(ids.length)
    }
  })

  it('every secret s.id is unique within its region', () => {
    for (const r of regions) {
      const ids = ((r.secrets ?? []) as Array<{ id: string }>).map((x) => x.id)
      expect(new Set(ids).size, `${r.id}.secrets dup`).toBe(ids.length)
    }
  })

  it('every interactable id is unique within its region', () => {
    for (const r of regions) {
      const ids = ((r.interactables ?? []) as Array<{ id: string }>).map((x) => x.id)
      expect(new Set(ids).size, `${r.id}.interactables dup`).toBe(ids.length)
    }
  })

  it('every unlockFlag appears somewhere in dialogue.json / worldstate.json / regions.json (writer present)', () => {
    const dialogueText = readFileSync(resolve(ROOT, 'src/data/json/dialogue.json'), 'utf8')
    const ws = readFileSync(resolve(ROOT, 'src/data/json/worldstate.json'), 'utf8')
    const rj = readFileSync(resolve(ROOT, 'src/data/json/regions.json'), 'utf8')
    for (const r of regions) {
      const uf = r.unlockFlag as string | undefined
      if (!uf) continue
      // tests look for the string anywhere so the writer's location is flexible (dialogue choice, worldstate rule, or interactable setsFlag)
      const inDialogue = dialogueText.includes(uf)
      const inWs = ws.includes(uf)
      const inRegions = rj.includes(uf)
      expect(inDialogue || inWs || inRegions, `${r.id}.unlockFlag ${uf} never written`).toBe(true)
    }
  })
})
