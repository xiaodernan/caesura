/**
 * `PropSystem` 的门与兜底。这些分支正常游玩一条都不走——区域闸由组合根保证、
 * `hitsToBreak`/`breakLoudness` 每件都写齐了、Boss 场上总在——所以 flow 那批
 * 「真按键敲碎一根刺」的用例量不到它们。而它们漏了的后果一点也不安静：
 * 隔着锁着的区敲碎东西、没有 Boss 的场地件把血池物化成 NaN、或读档回来的
 * 碎件带着满耐久立回去。
 *
 * 这里用**合成 prop** 逼出每一条退路（真数据缺一格时的形状），全部走生产入口
 * `hittable` / `hitProp` / `restore`，不碰私有状态。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { registerGameData, regions } from '@/data'
import type { RegionData } from '@/data/schema'
import { PropSystem, type Prop, type BossQueryResult } from '@/world/Props'
import { bus } from '@/core/EventBus'

registerGameData()

/** 换一套 props 的真区域（`PropSystem` 只读它的 id 与 props，其余字段不影响判定） */
function regionWith(baseId: string, props: unknown[]): RegionData {
  return Object.assign(structuredClone(regions.find((x) => x.id === baseId)!), { props })
}

const CORE = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, kind: 'resonance_core', pos: { x: 0, y: 0, z: 0 }, ...over
})
const SPINE = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id, kind: 'soundspine', pos: { x: 3, y: 0, z: 0 }, ...over
})

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

describe('PropSystem 的门与兜底', () => {
  it('区域没开 ⇒ 打不中也碎不了（隔着锁着的区敲不掉一根刺）', () => {
    const ps = new PropSystem([regionWith('rg_earless_deeps', [SPINE('p_spine', { hitsToBreak: 4 })])], () => false)
    const p = ps.all[0]
    expect(ps.hittable(p), '区域关着 ⇒ 不在可击名单里').toBe(false)
    expect(ps.hitProp(p, { heavyFamily: true }), '打上去也是 none：不计数不响不碎').toBe('none')
    expect(ps.hittable(p), '一击之后仍然完好').toBe(false)
  })

  it('血量池物化要有 Boss：场上没有那只 Boss ⇒ none，且不留下半物化的池子', () => {
    // 没有 exposedWhen（不然 isExposed 先把门关上），只有 hpFracOfBoss ⇒ hittable 通过，
    // 于是退路只能落在「找不到 Boss」这一格上
    const ps = new PropSystem([regionWith('rg_unfinished_hall', [
      CORE('p_core_noboss', { hpFracOfBoss: 0.5, damageTarget: 'en_hersil' })
    ])], () => true)
    ps.bossQuery = null
    const p = ps.all[0]
    expect(ps.hittable(p), '没有暴露条件 ⇒ 这一格是露着的').toBe(true)
    expect(ps.hitProp(p, { heavyFamily: true }), '没有 Boss ⇒ 池子物化不了 ⇒ none').toBe('none')
    expect((p as Prop & { hpPool?: number }).hpPool, '不许留下半个池子（NaN / 0 / undefined 之外的第四种状态）').toBeUndefined()
    expect(ps.remainingByKind('resonance_core'), '它仍然算一个没碎的核').toBe(1)
  })

  it('pool 按当前那只 Boss 的 hpMax 物化；rawDamage 省略时按 1 扣', () => {
    const ps = new PropSystem([regionWith('rg_unfinished_hall', [
      CORE('p_pool', { hpFracOfBoss: 0.5, damageTarget: 'en_hersil' })
    ])], () => true)
    ps.bossQuery = (): BossQueryResult => ({ hpMax: 100, phase: 9, alive: true })
    const p = ps.all[0] as Prop & { hpPool?: number; hpLeft?: number }
    expect(ps.hitProp(p, { heavyFamily: true }), '第一记打掉 1 点').toBe('chip')
    expect(p.hpPool, '池子 = round(100 × 0.5)，不写第二份血量').toBe(50)
    expect(p.hpLeft, '省略 rawDamage ⇒ round(undefined ?? 1) = 1').toBe(49)
  })

  it('计数型忘了写 hitsToBreak ⇒ 一击就碎（不无限期敲不烂）', () => {
    const ps = new PropSystem([regionWith('rg_earless_deeps', [SPINE('p_nohits', { gatherRadius: 8 })])], () => true)
    const p = ps.all[0]
    expect((p as Prop & { hitsLeft?: number }).hitsLeft, '没写耐久就不预置计数').toBeUndefined()
    expect(ps.hitProp(p, { heavyFamily: true }), '(undefined ?? 1) - 1 = 0 ⇒ 当场碎').toBe('chip')
    expect(ps.remainingByKind('soundspine'), '碎了就退场').toBe(0)
  })

  it('restore(null) ⇒ 什么都不碎；restore 把计数与血池一起同步（读档不白还破势窗）', () => {
    const ps = new PropSystem([regionWith('rg_unfinished_hall', [
      CORE('p_core_r', { hpFracOfBoss: 0.5, damageTarget: 'en_hersil' })
    ])], () => true)
    ps.bossQuery = (): BossQueryResult => ({ hpMax: 100, phase: 9, alive: true })
    const p = ps.all[0] as Prop & { hpPool?: number; hpLeft?: number }
    ps.hitProp(p, { heavyFamily: true }) // 物化池子并敲掉 1 点

    ps.restore(null)
    expect(ps.remainingByKind('resonance_core'), 'null = 一份没碎过的世界').toBe(1)

    ps.restore(['p_core_r'])
    expect(ps.remainingByKind('resonance_core'), '名册里有它 ⇒ 它是碎的').toBe(0)
    expect(p.hpLeft, '血池侧也要归零（只同步一半的话，读档回来的碎件带着满耐久立回去）').toBe(0)
    expect(ps.snapshot(), '快照与 restore 互为逆操作').toEqual(['p_core_r'])
  })

  it('prop 指了一个不存在的区 ⇒ 视为没开（悬空的 regionId 不许变成永久可击）', () => {
    const ps = new PropSystem([regionWith('rg_earless_deeps', [SPINE('p_orphan', { hitsToBreak: 4 })])], () => true)
    const p = ps.all[0]
    ;(p as unknown as { regionId: string }).regionId = 'rg_does_not_exist'
    expect(ps.hittable(p), '区不在表里 ⇒ 没有"开"这一说').toBe(false)
    expect(ps.hitProp(p, { heavyFamily: true })).toBe('none')
  })

  it('breakLoudness 省略 ⇒ 碎裂广播用缺省 0.9', () => {
    const loud: number[] = []
    const off = bus.on('sound.source', (s) => loud.push(s.loudness))
    alive.push(off)
    const ps = new PropSystem([regionWith('rg_earless_deeps', [
      SPINE('p_quiet', { hitsToBreak: 1 }) // 没写 breakLoudness
    ])], () => true)
    expect(ps.hitProp(ps.all[0], { heavyFamily: true }), '一击碎').toBe('chip')
    expect(loud, '碎裂的那一响落进声场，音量取缺省值').toEqual([0.9])
  })
})
