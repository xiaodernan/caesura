import { describe, expect, it, beforeEach } from 'vitest'
import { bus, STATUS_IDS, type StatusId } from '@/core/EventBus'
import { registry } from '@/core/Registry'
import { registerGameData, statuses, items, regions, progression, enemiesRaw } from '@/data'
import type { StatusConfig, EnemyData } from '@/data/schema'
import { EntityStats } from '@/combat/EntityStats'
import { CorruptionMeter, StatusGlossary, armStats, statusConfig, tagIs } from '@/combat/Statuses'
import { TICK_HZ } from '@/core/Time'

/**
 * 状态系统的**数据真值**闸门（combat.md §11；需求 §55/§78）。
 * 这里管三件事，flow 测试（tests/flow/status.test.ts）管另一件事（行为）：
 * 1. 表里的数字就是文档里的数字——改了数据要连带改文档，改不动就让它红。
 * 2. 每一张状态都得有**消费方**：字段能对上 EventBus 的口径、desc 有人播。
 * 3. 「代码里没有常量」：把数值灌进实体的那条线（armStats）得真的从 JSON 走。
 */

registerGameData()

const enemies = enemiesRaw as unknown as EnemyData[]
const ids = Object.keys(statuses) as (keyof StatusConfig)[]

describe('statuses.json 与 §11 数值表逐格对齐', () => {
  it('五张状态，一张不多一张不少，且和 EventBus 的口径全等', () => {
    expect([...ids].sort()).toEqual([...STATUS_IDS].sort())
    // core 层刻意不 import @/data（arch-boundaries），所以两边各写一份名单，靠这条钉住
    expect(STATUS_IDS.length).toBe(5)
  })

  it('每张状态都有 tag / displayName / desc：没有解释的状态不算实现完（需求 §19）', () => {
    for (const id of ids) {
      const s = statuses[id]
      expect(s.displayName, `${id} 缺名字`).toBeTruthy()
      expect(s.desc, `${id} 缺世界观解释`).toBeTruthy()
      expect(s.tag, `${id} 缺 Gameplay Tag`).toBeTruthy()
      expect(s.tag.endsWith(id), `${id} 的 tag 末段要和 id 一致`).toBe(true)
    }
  })

  it('震裂：5 层封顶、每层 +4%、10s 无新增后每 2s 掉一层、碎裂 20 真伤 + 架势 40', () => {
    const f = statuses.fissure
    expect(f.maxLayers).toBe(5)
    expect(f.dmgMulPerLayer).toBeCloseTo(0.04, 10)
    expect(f.idleTicks / TICK_HZ, '§11「10s 无新增」').toBe(10)
    expect(f.decayEveryTicks / TICK_HZ, '§11「-1 层/2s」').toBe(2)
    expect(f.burst).toEqual({ trueDamage: 20, poise: 40 })
  })

  it('§11「对装甲/晶体 ×2」标在**材质**上（敌人自己），状态表不替敌人认领倍率', () => {
    const crystal = enemies.find((e) => e.id === 'en_murkshell')
    expect(crystal?.fissureMul, '嘈壳＝铸出来的晶体壳').toBe(2)
    const bell = enemies.find((e) => e.id === 'en_ostlara')
    expect(bell?.boss?.phases[0].shell?.fissureMul, '壳期奥斯塔拉同理').toBe(2)
    // 没标的就是普通材质：倍率是「缺席」而不是「表里写了个 1」
    expect(enemies.find((e) => e.id === 'en_tympanus')?.fissureMul).toBeUndefined()
    expect(Object.keys(statuses.fissure)).not.toContain('crystalMul')
  })

  it('闷音：体力回复 −30%；封锁时长**不在这里**（施加方声明，消费方是 5-C2 战技）', () => {
    expect(statuses.mute.regenMul).toBeCloseTo(0.7, 10)
    expect(statuses.mute).not.toHaveProperty('lockTicks')
    expect(statuses.mute).not.toHaveProperty('skillLockTicks')
  })

  it('回响：1.5s 后重演 60%、对群、场上最多 2 影（性能锁）', () => {
    const e = statuses.echo
    expect(e.delayTicks / TICK_HZ, '§11「1.5s」').toBeCloseTo(1.5, 10)
    expect(e.replayMul).toBeCloseTo(0.6, 10)
    expect(e.maxShadows).toBe(2)
    expect(e.radius, '重演判定半径得是个有限的屋子尺度').toBeGreaterThan(1)
  })

  it('失谐：0→100、精英命中 +3、>60 起去色、满值 5HP/s', () => {
    const c = statuses.corruption
    expect(c.max).toBe(100)
    expect(c.eliteHit).toBe(3)
    expect(c.visualStart, '§11「>60 起屏幕饱和度渐减」').toBe(60)
    expect(c.hpPerSec).toBeCloseTo(5, 10)
  })

  it('共振过载：这张表**只带 tooltip**——数值散在 player.json/progression.json，不写第二份', () => {
    const od = statuses.overdrive as unknown as Record<string, unknown>
    expect(Object.keys(od).sort()).toEqual(['desc', 'displayName', 'tag'])
  })

  it('解除失谐的两条途径都在数据里：调音桩归零 + 音色晶 −25', () => {
    const crystal = items.find((i) => i.id === 'it_timbre_crystal')
    expect(crystal?.use?.corruption, '§11「音色晶消耗品 −25」').toBe(-25)
    expect(crystal?.use?.corruption, '清的是失谐，不是加失谐').toBeLessThan(0)
  })

  it('深窖的失谐压力是区域格（perSec），不是代码里的常量', () => {
    const deep = regions.find((r) => r.id === 'rg_earless_deeps')
    expect(deep?.corruption?.perSec, '§11 环境累积').toBeGreaterThan(0)
  })

  it('异常强度与耐受都从「异音」属性派生，且耐受有地板（属性点关不掉区域机制）', () => {
    const s = progression.derived.status
    expect(s.perFisPower).toBeGreaterThan(0)
    expect(s.perFisTolerance).toBeGreaterThan(0)
    expect(s.toleranceFloor, '堆满失谐也不能站在哑带里不动').toBeGreaterThan(0)
    expect(s.toleranceFloor).toBeLessThan(1)
  })
})

describe('armStats：数值走 JSON，不走代码', () => {
  it('把 statuses.json 的震裂节奏与闷音回复真的挂到一具 stats 上', () => {
    const stats = new EntityStats(100, 100, 100)
    expect(stats.fissureRules, '未武装 ⇒ 不参与状态系统').toBeNull()
    expect(stats.muteRegenMul, '未武装 ⇒ 不减回复').toBe(1)
    armStats(stats)
    expect(stats.fissureRules).toEqual({
      maxLayers: statuses.fissure.maxLayers,
      idleTicks: statuses.fissure.idleTicks,
      decayEveryTicks: statuses.fissure.decayEveryTicks
    })
    expect(stats.muteRegenMul).toBe(statuses.mute.regenMul)
  })

  it('未武装就叠层 = 接线错误 ⇒ 抛出来，不静默免疫（§78）', () => {
    const stats = new EntityStats(100, 100, 100)
    expect(() => stats.addFissure(1)).toThrow(/arm/)
  })

  it('层数封顶、0 层不加、满层归零并回报 true（碎裂由调用方结算）', () => {
    const stats = new EntityStats(100, 100, 100)
    armStats(stats)
    expect(stats.addFissure(0)).toBe(false)
    expect(stats.addFissure(statuses.fissure.maxLayers - 1)).toBe(false)
    expect(stats.fissureLayers).toBe(statuses.fissure.maxLayers - 1)
    expect(stats.addFissure(5), '过顶也只在满层那一刻碎裂').toBe(true)
    expect(stats.fissureLayers).toBe(0)
  })

  it('10s 无新增才开始掉，之后每 2s 一层；中途新增加入会重排计时', () => {
    const stats = new EntityStats(100, 100, 100)
    const c = statuses.fissure
    armStats(stats)
    stats.addFissure(3)
    /** 只记录「层数发生变化」的那些时刻，别把初始读数算进去 */
    const run = (ticks: number): number[] => {
      const seen: number[] = []
      let prev = stats.fissureLayers
      for (let i = 0; i < ticks; i++) {
        stats.update(1 / TICK_HZ, i + 1)
        if (stats.fissureLayers !== prev) { seen.push(stats.fissureLayers); prev = stats.fissureLayers }
      }
      return seen
    }
    // 第一段：idleTicks 内一层都不掉
    expect(run(c.idleTicks - 2)).toEqual([])
    expect(stats.fissureLayers).toBe(3)
    // 之后：每 decayEveryTicks 掉一层
    expect(run(c.decayEveryTicks * 2)).toEqual([2, 1])
    stats.addFissure(1)
    expect(stats.fissureLayers).toBe(2)
    // 「正在逐层衰减」时被新增打断 ⇒ 从 decayEveryTicks 续掉，而不是重新等 10s
    expect(run(c.decayEveryTicks + 2)).toEqual([1])
  })
})

describe('CorruptionMeter：累积、耐受、去色斜坡、满值掉血', () => {
  let m: CorruptionMeter
  beforeEach(() => { m = new CorruptionMeter() })

  it('封顶在 max，且封顶之后不再累积（返回「实际加了多少」便于断言真的生效了）', () => {
    const c = statuses.corruption
    expect(m.add(c.max * 2)).toBe(c.max)
    expect(m.full).toBe(true)
    expect(m.add(1)).toBe(0)
  })

  it('耐受乘数按 (1 − 系数) 生效：失谐属性越高，褪色越慢', () => {
    m.resistMul = 0.5
    expect(m.add(10)).toBe(5)
    m.resistMul = 1
    expect(m.add(10)).toBe(10)
  })

  it('清除只到 0，不会回血成负失谐', () => {
    m.add(10)
    expect(m.purge(25)).toBe(10)
    expect(m.value).toBe(0)
  })

  it('去色是从 visualStart 到 max 的线性斜坡，不是一个开关（§11「渐减」）', () => {
    const c = statuses.corruption
    m.value = c.visualStart
    expect(m.veil()).toBe(0)
    m.value = (c.visualStart + c.max) / 2
    expect(m.veil()).toBeCloseTo(0.5, 10)
    m.value = c.max
    expect(m.veil()).toBe(1)
  })

  it('暴露要 perSec>0 才推进：安全区（没有 corruption 格）站着不掉色', () => {
    m.expose(1, 0)
    expect(m.value).toBe(0)
    const per = regions.find((r) => r.id === 'rg_earless_deeps')!.corruption!.perSec
    m.expose(1, per)
    expect(m.value).toBe(per)
  })

  it('满值才掉血，且掉血走调用方的受伤通道（这里只给数）', () => {
    const c = statuses.corruption
    expect(m.drain(1)).toBe(0)
    m.value = c.max
    expect(m.drain(1)).toBeCloseTo(c.hpPerSec, 10)
    expect(m.drain(0.2)).toBeCloseTo(c.hpPerSec * 0.2, 10)
  })

  it('主循环只有一条路：区域那一格同时管住累积与掉血（安全区满值不见血）', () => {
    const c = statuses.corruption
    const deep = regions.find((r) => r.id === 'rg_earless_deeps')!.corruption!
    m.value = c.max
    // 实机复验抓到的接线漏网：expose 有闸门、drain 没有 ⇒ 带着满值站在休垒里流血
    expect(m.tickEnvironment(1, undefined), '没有那一格 ⇒ 既不褪色也不掉血').toBe(0)
    expect(m.value).toBe(c.max)
    expect(m.tickEnvironment(0.2, deep), '有那一格 ⇒ 满值才见血').toBeCloseTo(c.hpPerSec * 0.2, 10)
  })
})

describe('StatusGlossary：世界观解释有 UI 消费方（需求 §19）', () => {
  it('每个状态本局只播一次 desc，内容就是「名字｜解释」，forgetAll 开新一局', () => {
    const g = new StatusGlossary()
    const notes: string[] = []
    const off = bus.on('ui.notify', (p) => notes.push(p.text))
    expect(g.explain('mute')).toBe(true)
    expect(g.explain('mute'), '第二次不再刷屏').toBe(false)
    off()
    expect(notes).toEqual([`${statuses.mute.displayName}｜${statuses.mute.desc}`])
    g.forgetAll()
    const n2: string[] = []
    const off2 = bus.on('ui.notify', (p) => n2.push(p.text))
    expect(g.explain('mute')).toBe(true)
    off2()
    expect(n2.length).toBe(1)
  })

  it('五张状态的 desc 全都可播（没有"表里有、没人读"的半死数据）', () => {
    const g = new StatusGlossary()
    const off = bus.on('ui.notify', () => {})
    for (const id of STATUS_IDS as unknown as StatusId[]) expect(g.explain(id)).toBe(true)
    off()
  })
})

describe('Gameplay Tag 口径', () => {
  it('数据里写 `mute` 与 `status.mute` 是同一个状态，但不会误伤 `sub.muteaudio`', () => {
    expect(tagIs('status.mute', 'mute')).toBe(true)
    expect(tagIs('mute', 'mute')).toBe(true)
    expect(tagIs('status.fissure', 'fissure')).toBe(true)
    expect(tagIs('muteaudio', 'mute')).toBe(false)
    expect(tagIs(undefined, 'mute')).toBe(false)
  })

  it('statuses.json 的 tag 自己就能被 tagIs 认出来（施加方与状态表说的是同一件事）', () => {
    for (const id of ids) expect(tagIs(statuses[id].tag, id)).toBe(true)
  })
})

describe('registry 接线', () => {
  it('statusConfig() 读的就是 data/json/statuses.json 那一份对象（没有第二处真源）', () => {
    expect(statusConfig()).toBe(registry.get<StatusConfig>('statuses'))
    expect(statusConfig()).toBe(statuses)
  })
})
