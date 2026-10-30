import { describe, expect, it } from 'vitest'
import { registry } from '@/core/Registry'
import { AISystem } from '@/ai/AISystem'
import { DEFAULT_SQUAD_CONFIG, Squad } from '@/ai/Squad'
import { registerGameData, squadConfigData } from '@/data'
import type { SquadConfigData } from '@/data/schema'
import squadRaw from '@/data/json/squad.json'
import type { Enemy } from '@/ai/Enemy'

/**
 * KI-372：Phase B5 的小队配置从构造参数搬进数据表（squad.json）。
 *
 * 病：maxAttackSlots / callAllyRadius / 	hreatDecayPerTick / combatEntryThreshold 四个数
 * 只住在 SquadConfig 的构造参数里——表外没有读者，改一个数要改代码；KI-133 ① 从 Phase B5 起
 * 就记着这一格。本批把值搬进 squad.json，登记为注册表 squad:config，AISystem 构造时取它当缺省。
 *
 * 四条口径：
 *  ① 注册表缺席（单测直接 
ew AISystem()）⇒ 回落 DEFAULT_SQUAD_CONFIG，行为一格不变；
 *  ② 登记之后，表的**同一份对象**住在 squad:config（不复制第二份）；
 *  ③ 显式构造参数最后说话，未覆盖的格仍来自表；
 *  ④ 表值不是摆设：把 maxAttackSlots 改成 2，分槽行为真的只剩两个槽。
 */

const fake = (id: string) => ({
  id,
  data: { ai: { camp: 'test' } },
  alive: true,
  pos: { x: 0, y: 0, z: 0 },
  squadThreats: [] as unknown[],
  squadHasSlot: false,
  squadWaitRank: 0,
  squadTarget: null as string | null,
})

const asEnemy = (f: ReturnType<typeof fake>): Enemy => f as unknown as Enemy

describe('KI-372 squad.json：四个槽位/呼救数的值主人', () => {
  it('注册之前：注册表没有这一格，AISystem 回落代码默认', () => {
    expect(registry.has('squad:config'), '本文件的第一条腿必须跑在 registerGameData 之前').toBe(false)
    const ai = new AISystem()
    expect(ai.squadSystem.getConfig()).toEqual(DEFAULT_SQUAD_CONFIG)
  })

  it('表与代码默认四个数逐格相同——两处抄写不许漂', () => {
    expect(squadConfigData).toEqual(DEFAULT_SQUAD_CONFIG)
    expect(squadConfigData, '导出的是同一份 JSON 对象，不是复制').toBe(squadRaw)
    expect(Object.keys(squadConfigData).sort()).toEqual([
      'callAllyRadius',
      'combatEntryThreshold',
      'maxAttackSlots',
      'threatDecayPerTick',
    ])
  })

  it('registerGameData 之后：表的同一份对象住进 squad:config', () => {
    registerGameData()
    expect(registry.get('squad:config')).toBe(squadConfigData)
  })

  it('表值改变 ⇒ 新建的 AISystem 跟着变（数据表是值的主人）', () => {
    const cfg = registry.get<SquadConfigData>('squad:config')
    const before = cfg.maxAttackSlots
    cfg.maxAttackSlots = 2
    try {
      expect(new AISystem().squadSystem.getConfig().maxAttackSlots).toBe(2)
    } finally {
      cfg.maxAttackSlots = before
    }
  })

  it('显式构造参数最后说话，且未被覆盖的格仍来自表', () => {
    const cfg = registry.get<SquadConfigData>('squad:config')
    const before = cfg.callAllyRadius
    cfg.callAllyRadius = 30
    try {
      const conf = new AISystem({ maxAttackSlots: 1 }).squadSystem.getConfig()
      expect(conf.maxAttackSlots, '显式参数压过表值').toBe(1)
      expect(conf.callAllyRadius, '没被显式覆盖的格跟着表走').toBe(30)
    } finally {
      cfg.callAllyRadius = before
    }
  })

  it('表里的槽位数真的改变分槽：2 槽 ⇒ 四个等仇恨的人里两个在打、两个在等', () => {
    const cfg = registry.get<SquadConfigData>('squad:config')
    const before = cfg.maxAttackSlots
    cfg.maxAttackSlots = 2
    try {
      const s = new Squad(registry.get<SquadConfigData>('squad:config'))
      for (const id of ['a', 'b', 'c', 'd']) {
        s.register(asEnemy(fake(id)))
        s.addThreat(id, 'player', 20)
      }
      s.update(1)
      const report = s.getSlotReport()
      expect(report.attacking, '只有表里那两个槽').toEqual(['a', 'b'])
      expect(report.waiting, '其余两个按序排队').toEqual(['c', 'd'])
    } finally {
      cfg.maxAttackSlots = before
    }
  })

  it('不写不认的字段：表的键集合就是 schema 的四个', () => {
    for (const k of Object.keys(squadConfigData)) {
      expect(Object.keys(DEFAULT_SQUAD_CONFIG)).toContain(k)
    }
  })
})
