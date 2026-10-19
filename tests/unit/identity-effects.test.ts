import { describe, expect, it, beforeAll } from 'vitest'
import { Progression } from '@/rpg/Progression'
import { progression, registerGameData, playerBase, weaponsRaw } from '@/data'
import { RpgRuntime } from '@/rpg/Runtime'
import { PlayerController } from '@/player/ThirdPersonController'
import { registry } from '@/core/Registry'
import type { MovesetData, ProgressionData, WeaponData } from '@/data/schema'

/**
 * **身份效果**（§8.2「任一维触及 35 = 该维专属效果」，KI-138）的机制腿。
 *
 * 需求只给了**指法那一例**（"如指法 35：翻滚体力 -2"）——本批把机制落下来并把那一例兑现，
 * 其余各维**不写行**（§55：需求没给的数不编）。
 *
 * 三条腿：① **门槛两格**——那一维的**面板值**够 min，且音级到了 ms_identity 的 rank；
 * ② **效果是 grant**——与里程碑的机制腿同一套字段（一个主人）；
 * ③ **消费链真的兑现**——`PlayerMods.rollStaminaFlat` → 翻滚体力价（另一份测试钉那一段）。
 */
const data = progression as unknown as ProgressionData

// `Progression` 的数据是从注册表现读的（core 不认识数据表，依赖方向单向）⇒ 先把数据注册进去
beforeAll(() => { registerGameData() })

/** 走**生产路径**取那一份 mods（`RpgRuntime.mods()`）——不另拼一份 mods（那就是第二个主人） */
const rpgModsOf = (p: Progression) => {
  const rt = new RpgRuntime('origin_tuner')
  rt.prog.attrs.dex = p.attrs.dex
  rt.prog.rank = p.rank
  return rt.mods()
}

describe('身份效果（KI-138）', () => {
  it('表里现在有需求给的那一例：指法 35 ⇒ 翻滚体力 -2', () => {
    const rows = data.identityEffects ?? []
    expect(rows.length, '身份效果表的行数').toBeGreaterThan(0)
    const dex = rows.find((r) => r.attr === 'dex')
    expect(dex, '需求给的那一例必须在表里').toBeDefined()
    expect(dex!.min).toBe(35)
    expect(dex!.grant.rollStaminaFlat).toBe(-2)
  })

  it('默认出身没有身份效果（门槛两格都没到）', () => {
    const p = new Progression('origin_tuner')
    expect(p.derive(0).rollStaminaFlat, '出身自带指法 6、音级 1 ⇒ 没有身份效果').toBe(0)
  })

  it('指法到 35 且音级到 16 ⇒ 翻滚体力 -2（逐字兑现需求那一例）', () => {
    const p = new Progression('origin_tuner')
    p.attrs.dex = 35
    p.rank = 16
    expect(p.derive(0).rollStaminaFlat, '指法 35 + rank16 ⇒ -2').toBe(-2)
  })

  it('门槛差一格就不给：指法 34 或音级 15 都拿不到', () => {
    const a = new Progression('origin_tuner')
    a.attrs.dex = 34
    a.rank = 16
    expect(a.derive(0).rollStaminaFlat, '差一格（指法 34）不给').toBe(0)

    const b = new Progression('origin_tuner')
    b.attrs.dex = 35
    b.rank = 15
    expect(b.derive(0).rollStaminaFlat, '差一格（rank 15）不给').toBe(0)
  })

  it('门槛用的是**面板值**，不是软上限折算后的值（"你投入了多少" ≠ "它实际当多少"）', () => {
    const q = new Progression('origin_tuner')
    q.attrs.dex = 45
    q.rank = 16
    // 折算后 45 不到 45（软上限 40 之后打折），但**面板 45 ≥ 35** ⇒ 身份效果照给
    expect(q.derive(0).rollStaminaFlat, '面板 45 仍然够门槛（门槛问的是面板值）').toBe(-2)
  })

  it('消费链那一段：翻滚体力价真的便宜了两点（`rollProfile` 读 mods 那一格）', () => {
    const p = new Progression('origin_tuner')
    p.attrs.dex = 35
    p.rank = 16
    const mods = rpgModsOf(p)
    expect(mods.rollStaminaFlat, 'mods 那一格拿到 -2').toBe(-2)

    // 玩家控制器那一侧：自由翻滚的体力价 = 底数 + 平移（下限 1）
    const weapon = (weaponsRaw as unknown as WeaponData[])[0]
    const ctrl = new PlayerController(
      playerBase,
      weapon,
      registry.get<MovesetData>(`moveset:${weapon.movesetId}`),
    )
    const base = ctrl.rollProfile(false).stamina
    ctrl.applyRpg(mods)
    const after = ctrl.rollProfile(false).stamina
    expect(after, '翻滚体力价真的便宜了两点').toBe(Math.max(1, base - 2))
  })
})
