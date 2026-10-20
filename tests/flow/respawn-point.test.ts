import { describe, expect, it } from 'vitest'
import { registerGameData, playerBase, regions } from '@/data'
import { registry } from '@/core/Registry'
import { PlayerController } from '@/player/ThirdPersonController'
import { nearestLitPost, respawnTarget, RESPAWN_FALLBACK, type RespawnPost } from '@/world/Respawn'
import { GameTime } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import type { Input } from '@/core/Input'
import type { MovesetData, WeaponData } from '@/data/schema'

/**
 * **重生点**（KI-157）：gameplay.md §8「失败与恢复（死亡惩罚：褪色 Fading）」那张表里
 * 「重生点｜最近的调音桩（视觉：桩亮=可复活）」那一行，今天第一次有载体。
 *
 * **病**：这一行此前**没有载体**——玩家死在无耳深窖，四秒后被送回**世界原点 (0,0,0)**，
 * 也就是休垒的出厂位置。于是同一行第三栏的设计意图「循环闭合：死亡点通常离调音桩 <60s」
 * 在运行时是假的：回程是**整个世界**，不是那 60 秒。
 *
 * **规则（只有一条主人，住在 `world/Respawn`）**：重生点 = **最近的、亮着的**调音桩。
 * · "亮" = 玩家共鸣过它（`regions.json > interactables[].setsFlag` 那一面旗立着）
 *   ——与同一行的"视觉：桩亮=可复活"是同一件事：**没亮过的桩不是重生点**。
 * · "最近" = 三维距离（叠层世界里 y 也算：楼上那根桩与楼下那根不是一回事）。
 * · **一根都没亮 ⇒ 落回世界原点**（今天的行为）：设计没裁那一格，§55 不许我编一根
 *   "默认桩"，所以保留原行为并把这一格如实登记（**兜底不是裁决，是没裁决**）。
 *
 * 判据与搬运分住两处：本文件量**规则**（纯函数）与**真链**（玩家真的死在桩那儿），
 * 画面那一半（桩亮不亮）在 `tests/unit/interactable-animate.test.ts` 里量。
 */
registerGameData()

/** 七根桩（数据现推：每区一根 `kind === 'checkpoint'`） */
const POSTS: RespawnPost[] = regions.flatMap((r) =>
  (r.interactables ?? [])
    .filter((i) => i.kind === 'checkpoint')
    .map((i) => ({ id: i.id, pos: { x: i.pos.x, y: i.pos.y, z: i.pos.z }, litFlag: i.setsFlag ?? null })),
)

/** 造一个能死的玩家（真控制器：死亡那 240 拍与重生都在它自己身上） */
function makePlayer() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const moveset = registry.get<MovesetData>('ms_sword')
  const player = new PlayerController(playerBase, weapon, moveset)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  const tick = (): void => {
    time.tick++
    player.update(1 / 60, time, input, time.tick, rhythm)
    frame.edges.clear()
  }
  return { player, tick }
}

describe('重生点：最近的、亮着的调音桩（KI-157）', () => {
  it('数据：每区恰好一根调音桩（"最近"永远有候选；一区没有桩 ⇒ 那一区的死亡只能落回兜底）', () => {
    expect(POSTS.length, `七区七桩，今天是 ${POSTS.length} 根`).toBe(regions.length)
    for (const r of regions) {
      const n = (r.interactables ?? []).filter((i) => i.kind === 'checkpoint').length
      expect(n, `${r.id} 的调音桩数`).toBe(1)
    }
    for (const p of POSTS) {
      expect(p.litFlag, `${p.id} 必须带一面"点亮它"的旗，否则"亮"无从判`).toBeTruthy()
    }
  })

  it('规则：两根都亮 ⇒ 选近的那根（"最近"不是"名册里第一个"）', () => {
    const a: RespawnPost = { id: 'a', pos: { x: 0, y: 0, z: 0 }, litFlag: 'f.a' }
    const b: RespawnPost = { id: 'b', pos: { x: 10, y: 0, z: 0 }, litFlag: 'f.b' }
    const lit = (f: string): boolean => f === 'f.a' || f === 'f.b'
    const near = nearestLitPost([b, a], { x: 1, y: 0, z: 0 }, lit)
    expect(near?.id, '名册顺序故意把远的放在前面，判据必须按距离选').toBe('a')
  })

  it('规则：没亮过的桩不算重生点（哪怕它更近）——"桩亮=可复活"', () => {
    const lit: RespawnPost = { id: 'lit', pos: { x: 100, y: 0, z: 0 }, litFlag: 'f.lit' }
    const dark: RespawnPost = { id: 'dark', pos: { x: 1, y: 0, z: 0 }, litFlag: 'f.dark' }
    const only = (f: string): boolean => f === 'f.lit'
    expect(nearestLitPost([lit, dark], { x: 0, y: 0, z: 0 }, only)?.id).toBe('lit')
    expect(nearestLitPost([lit, dark], { x: 0, y: 0, z: 0 }, () => false), '一根都没亮 ⇒ 没有重生点').toBeNull()
  })

  it('规则：一根都没亮 ⇒ 落回世界原点（兜底不是裁决，是设计没裁那一格）', () => {
    const { post, pos } = respawnTarget(POSTS, { x: 0, y: 0, z: 0 }, () => false)
    expect(post, '没有桩可选').toBeNull()
    expect(pos).toEqual(RESPAWN_FALLBACK)
  })

  it('规则：同距时先来先到（名册顺序 = 数据顺序；平局不许由迭代顺序决定）', () => {
    const a: RespawnPost = { id: 'a', pos: { x: 5, y: 0, z: 0 }, litFlag: 'f.a' }
    const b: RespawnPost = { id: 'b', pos: { x: -5, y: 0, z: 0 }, litFlag: 'f.b' }
    expect(nearestLitPost([a, b], { x: 0, y: 0, z: 0 }, () => true)?.id).toBe('a')
  })

  it('真链：人死在沉唱堂 ⇒ 四秒后回到**那根亮着的桩**，位置与地板一起搬', () => {
    const { player, tick } = makePlayer()
    const wode = POSTS.find((p) => p.id === 'st_whisperwode')!   // 低语林那根（地板 0）
    const choir = POSTS.find((p) => p.id === 'st_drowned_choir')! // 沉唱堂那根（地板 −40）
    const lit = new Set(['flag.checkpoint_whisperwode'])           // 只亮了低语林那根
    // 人站在沉唱堂（地板 −40）；亮着的那根桩在低语林（地板 0）⇒ **地板必须换**
    player.pos = { x: choir.pos.x + 3, y: choir.pos.y, z: choir.pos.z + 3 }
    player.floorY = choir.pos.y
    player.respawnTarget = () => {
      const { pos } = respawnTarget(POSTS, player.pos, (f) => lit.has(f))
      return { pos, floorY: pos.y }
    }
    player.takeDamage(999)
    expect(player.stats.hp, '血空 ⇒ 死').toBe(0)
    for (let i = 0; i < 241; i++) tick()
    expect(player.stats.hp, '241 拍之后该活过来（死亡 240 拍是设计给的那段停顿）').toBe(player.stats.hpMax)
    expect(player.pos, '必须回到那根亮着的桩上').toEqual({ x: wode.pos.x, y: wode.pos.y, z: wode.pos.z })
    expect(player.floorY, '地板也要一起搬（−40 → 0；不搬 ⇒ 人悬在 40m 空中往下掉）').toBe(wode.pos.y)
  })

  it('默认注入：不接线时行为与本批之前逐字相同（回到世界原点）——地基不许被这批偷偷改掉', () => {
    const { player, tick } = makePlayer()
    player.pos = { x: 100, y: 64, z: -200 }
    player.takeDamage(999)
    for (let i = 0; i < 241; i++) tick()
    expect(player.pos, '没注入重生点 ⇒ 仍然是世界原点').toEqual({ x: 0, y: 0, z: 0 })
  })
})
