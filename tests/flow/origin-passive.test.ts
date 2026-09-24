import { describe, expect, it } from 'vitest'
import { registerGameData } from '@/data'
import { registry } from '@/core/Registry'
import { originOf } from '@/rpg/Progression'
import { RpgRuntime } from '@/rpg/Runtime'
import type { ProgressionData } from '@/data/schema'

/**
 * KI-031③：出身被动（§2.2「哑带拾晶人：拾取音色石 +10%」）第一次有了数据形状与消费者。
 *
 * 取整口径是这组测试的主角：**期望值取整**——`Math.round(3×1.1)=3` 会把 "+10%" 在
 * 小数量掉落里悄悄抹成 "+0%"，所以小数部分掷给那颗已入档的种子 RNG（§10 可复现）。
 * 不吃数的件与整数乘数的情形**一个随机数都不消耗**：对照腿因此保持同轨，等式才敢写死。
 */

registerGameData()

const scRow = (): ProgressionData => registry.get<ProgressionData>('progression')
const passiveMul = (): number => originOf('origin_scavenger').passive!.mul

function farm(tableId: string, originId: string, times: number, seed: number): number {
  const rpg = new RpgRuntime(originId, seed)
  for (let i = 0; i < times; i++) rpg.loot.grant(tableId)
  return tableId === 'loot_gather_timbite'
    ? rpg.inv.count('it_timbite')
    : rpg.inv.count('it_bell_bronze')
}

describe('出身被动 lootStackBonus：+10% 是能被量出来的 10%', () => {
  it('两世界同种子对照：拾晶人 80 批音色石严格多于学徒，且涨幅贴 1.1×（不是翻倍也不是零）', () => {
    const a = farm('loot_gather_timbite', 'origin_tuner', 80, 777)
    const b = farm('loot_gather_timbite', 'origin_scavenger', 80, 777)
    expect(b, '被动必须真给数').toBeGreaterThan(a)
    expect(b, `实测 ${b}/${a}=${(b / a).toFixed(3)}，远超 1.1× 就是接线接错了`).toBeLessThanOrEqual(Math.ceil(a * 1.25))
    expect(b / a, '期望值取整长期该收敛到 1.1 附近').toBeGreaterThanOrEqual(1.02)
  })

  it('改表法（整数乘数）：mul 1.1→2.0 时拾晶人恰好双倍——不吃随机数的腿让等式敢写死', () => {
    const row = scRow().origins.find((o) => o.id === 'origin_scavenger')!
    const backup = row.passive!.mul
    row.passive!.mul = 2.0
    try {
      const a = farm('loot_gather_timbite', 'origin_tuner', 50, 4242)
      const b = farm('loot_gather_timbite', 'origin_scavenger', 50, 4242)
      expect(b, '2.0× 且小数恒为零 ⇒ 两边 RNG 序列同轨，双倍必须精确').toBe(2 * a)
    } finally {
      row.passive!.mul = backup
    }
    expect(passiveMul(), '还原').toBe(1.1)
  })

  it('不吃数就不掷数：别的出身/别的件不碰掉落序列——非音色石表两世界逐枚相等', () => {
    const a = farm('loot_secret_bellinterior', 'origin_tuner', 40, 555)
    const b = farm('loot_secret_bellinterior', 'origin_scavenger', 40, 555)
    expect(b, '表里没有音色石 ⇒ 被动一次都不该触发，连 RNG 消耗都不该多').toBe(a)
  })

  it('存档往返后被动仍跟着人走：restore 从 originId 现查现用（缓存副本才是谎言）', () => {
    const row = scRow().origins.find((o) => o.id === 'origin_scavenger')!
    const backup = row.passive!.mul
    row.passive!.mul = 2.0 // 整数倍 ⇒ 快照点之后的每一批可精确复现
    try {
      const sc = new RpgRuntime('origin_scavenger', 777)
      for (let i = 0; i < 30; i++) sc.loot.grant('loot_gather_timbite')
      const mid = sc.inv.count('it_timbite')
      const snap = sc.snapshot()
      for (let i = 0; i < 30; i++) sc.loot.grant('loot_gather_timbite')
      const later = sc.inv.count('it_timbite') - mid

      const loaded = new RpgRuntime('origin_tuner', 111)
      loaded.restore(snap)
      expect(loaded.prog.originId).toBe('origin_scavenger')
      for (let i = 0; i < 30; i++) loaded.loot.grant('loot_gather_timbite')
      expect(loaded.inv.count('it_timbite') - mid, '读档后那 30 批必须和没断线时逐枚相同（被动活着的铁证）')
        .toBe(later)
    } finally {
      row.passive!.mul = backup
    }
  })

  it('被动一句话住在表上：label 就是 §2.2 那句，代码里不留第二份', () => {
    const p = originOf('origin_scavenger').passive!
    expect(p.kind).toBe('lootStackBonus')
    expect(p.itemId).toBe('it_timbite')
    expect(p.label).toContain('音色石')
    expect(p.mul).toBe(1.1)
    for (const o of scRow().origins) {
      if (o.id === 'origin_scavenger') continue
      expect(o.passive, '其余四签名的表达是六维与初始装备本身，不硬造数字').toBeUndefined()
    }
  })
})
