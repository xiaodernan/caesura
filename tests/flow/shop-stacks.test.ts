import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { registerGameData, items } from '@/data'
import { registry } from '@/core/Registry'
import { itemOf } from '@/rpg/Inventory'
import { RpgRuntime } from '@/rpg/Runtime'
import { salvageValue, TIMBITE, DROSS } from '@/rpg/Upgrade'
import {
  saleUnit, sellPrice, shopData, stackSellPrice, stackSellKinds, CURRENCY,
} from '@/rpg/Shop'
import type { ShopData } from '@/data/schema'

/**
 * KI-059：堆叠件（残骸 / 素材 / 乐谱）出售——需求 §6 收入表那行「出售战利品（残骸→石）5-40」
 * 到这一天才有实现。断言全部**从表里算**：单价 = `items.value × shop.sell.mul`（与装备腿同一条
 * 式子、同一个函数），一次卖 n 件就是 n 次同价乘法。
 *
 * 这条腿唯一真正危险的地方不是价格算错，而是它与"买"那条腿的关系：
 * **可买的类别与可卖的类别必须不相交**（否则买回再卖 = 印钞机），所以那条不相交在这里
 * 是结构判据，不靠 mul 的数值大小兜着。
 */

registerGameData()

const root = fileURLToPath(new URL('../..', import.meta.url))
const shop = (): ShopData => shopData()

/** 与生产同一个式子，但**不**调生产的函数——这条对账量的是"代码读没读表" */
const unit = (itemId: string): number => Math.round((itemOf(itemId).value ?? 0) * shop().sell.mul)

const live: Array<() => void> = []
afterEach(() => { while (live.length) live.pop()!() })

const runtime = (timbite = 0): RpgRuntime => {
  const rt = new RpgRuntime('origin_tuner', 4242)
  if (timbite) rt.inv.add(TIMBITE, timbite)
  return rt
}

describe('KI-059 堆叠件卖价的口径（§6 收入表「残骸→石」）', () => {
  it('名单是数据不是代码：sell.stackKinds 存在、非空，而且不含装备类与通货', () => {
    const kinds = stackSellKinds()
    expect(kinds.length, '类别名单空着 = 这条出口被关掉').toBeGreaterThan(0)
    for (const k of ['weapon', 'armor', 'seal', 'currency']) {
      expect(kinds, `装备只认实例、通货不能换算成自己：${k} 不该在名单里`).not.toContain(k)
    }
  })

  it('可买的类别与可卖的类别不相交（§6.3 反套利的机器形状，与 mul 取值无关）', () => {
    const buyKinds = new Set(shop().stock.map((e) => itemOf(e.item).kind))
    const both = stackSellKinds().filter((k) => buyKinds.has(k))
    expect(both, `相交 ⇒ 买回来再卖开始印石：${both.join(', ')}`).toEqual([])
  })

  it('每一件可卖的堆叠货：单价 = 底数 × 系数，逐件对账（读的就是表）', () => {
    const sellable = items.filter((it) => stackSellPrice(it.id) > 0)
    expect(sellable.length, '一件都没有 = 这条腿在空转').toBeGreaterThanOrEqual(5)
    for (const it of sellable) {
      expect(stackSellPrice(it.id), `${it.id} 的单价`).toBe(unit(it.id))
      expect(stackSellPrice(it.id), `${it.id} 走的是 saleUnit 那一个主人`).toBe(saleUnit(it.value ?? 0))
    }
  })

  it('装备件在这条腿上永远是 0：按类别卖装备会绕过「强化沉没不反还」', () => {
    for (const it of items.filter((x) => x.gear)) expect(stackSellPrice(it.id), it.id).toBe(0)
  })

  it('买来的消耗品、通货、任务信物一律不收（value 写 0 的那几件就是"不是商品"的声明）', () => {
    for (const id of ['it_echo_salve', 'it_timbre_crystal', 'it_timbite', 'it_resonance_core', 'it_bell_tongue']) {
      expect(stackSellPrice(id), `${id} 是 ${itemOf(id).kind}/value=${itemOf(id).value}`).toBe(0)
    }
  })
})

describe('KI-059 卖整堆：先查后扣', () => {
  it('卖一件：钱加单价、数量减一，播报带着件数', () => {
    const rt = runtime()
    rt.inv.add(DROSS, 4)
    const r = rt.sellStacks(DROSS, 1)
    expect(r.ok).toBe(true)
    expect(r.price).toBe(unit(DROSS))
    expect(rt.inv.count(DROSS)).toBe(3)
    expect(rt.inv.count(CURRENCY)).toBe(unit(DROSS))
  })

  it('整堆卖出 = n × 单价，不做第二次取整（"卖一件"与"卖九件"必须落在同一个世界里）', () => {
    const rt = runtime()
    rt.inv.add('it_bell_bronze', 9)
    const r = rt.sellStacks('it_bell_bronze', 9)
    expect(r.ok).toBe(true)
    expect(r.count).toBe(9)
    expect(r.price, '钟铜 12 × 50% = 6/件，九件就是 54，不是 round(9×12×0.5) 之外的任何东西').toBe(9 * unit('it_bell_bronze'))
    expect(rt.inv.count('it_bell_bronze')).toBe(0)
  })

  it('数量不合法或手里没这么多：一个子都不动（不做"扣了再退"）', () => {
    const rt = runtime(777)
    rt.inv.add(DROSS, 2)
    for (const n of [0, -1, 3, 2.5, Number.NaN]) {
      const r = rt.sellStacks(DROSS, n)
      expect(r.ok, `n=${n} 不该成功`).toBe(false)
      expect(r.reason, `n=${n}`).toBe('empty')
      expect(rt.inv.count(DROSS), `n=${n} 之后货还在`).toBe(2)
      expect(rt.inv.count(CURRENCY), `n=${n} 之后钱一分没动`).toBe(777)
    }
  })

  it('空手卖：报 empty 而不是 missing（面板要说的是"包里没这件了"，不是"没这个东西"）', () => {
    const rt = runtime(10)
    const r = rt.sellStacks('it_shell_shard', 1)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('empty')
    expect(rt.inv.count(CURRENCY)).toBe(10)
  })

  it('不收的类别与查无此件是两种失败：原因分开报', () => {
    const rt = runtime(10)
    rt.inv.add('it_echo_salve', 3)
    expect(rt.sellStacks('it_echo_salve', 1).reason, '消耗品不收').toBe('not-stack')
    expect(rt.sellStacks('it_does_not_exist', 1).reason, '表里没这件').toBe('missing')
    expect(rt.inv.count('it_echo_salve')).toBe(3)
  })

  it('卖光之后不能重复卖：第二次是 empty（钱不会自己长回来）', () => {
    const rt = runtime()
    rt.inv.add('it_string_silk', 2)
    const first = rt.sellStacks('it_string_silk', 2)
    const second = rt.sellStacks('it_string_silk', 2)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    expect(rt.inv.count(CURRENCY)).toBe(first.price!)
  })

  it('改表法：mul 一动，装备腿与堆叠腿同时动（同一个主人，不是两份系数）', () => {
    const row = registry.get<ShopData>('shop')
    const original = row.sell.mul
    const rt = runtime()
    rt.inv.add(DROSS, 2)
    const gear = 'ar_choir_hood'
    try {
      const before = { gear: sellPrice(gear), stack: stackSellPrice(DROSS) }
      row.sell.mul = 0.25
      const after = { gear: sellPrice(gear), stack: stackSellPrice(DROSS) }
      expect(after.gear, '装备腿跟着表走').toBeLessThan(before.gear)
      expect(after.stack, '堆叠腿也跟着表走').toBeLessThan(before.stack)
      const r = rt.sellStacks(DROSS, 1)
      expect(r.price, '卖出实收也用新表值').toBe(after.stack)
    } finally {
      row.sell.mul = original
    }
    expect(sellPrice('ar_choir_hood'), '还原').toBe(Math.round((itemOf('ar_choir_hood').value ?? 0) * original))
  })
})

describe('KI-059 这条腿有人按（新逻辑没有消费者就等于没做）', () => {
  const ui = readFileSync(root + 'src/ui/Stakerite.ts', 'utf8')
  const code = ui.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
    .join('\n')

  it('交易页真的画了那一栏，而且按钮派发的就是 sell-stack', () => {
    expect(code, '面板里没有"残骸与素材"那一栏').toContain('data-act="sell-stack"')
    expect(code, '按钮没有派发口').toContain("case 'sell-stack'")
    expect(code, '面板绕过了 runtime 直接调 Shop（那是第二套账）').toContain('this.rpg.sellStacks(')
  })

  it('面板不自己算价：单价只来自 stackSellPrice，总数只是单价×件数', () => {
    const lines = code.split('\n').filter((l) => l.includes('stackSellPrice'))
    expect(lines.length, '面板没读 stackSellPrice（那它把单价从哪儿来的？）').toBeGreaterThan(0)
    const bad = code.split('\n').filter((l) => /value[^;]*\*[^;]*mul|mul[^;]*\*[^;]*value/.test(l))
    expect(bad, `面板里自己乘了一次系数 = 第二个价格主人：${bad.join(' | ')}`).toEqual([])
    expect(code, '那一栏的总价必须是"单价 × 件数"，不是重新算一遍').toMatch(/unit \* x\.count/)
  })
})

describe('KI-059 诚实账：卖 vs 分解+把回到的残晶立刻卖掉', () => {
  it('18/18 件装备仍然是"卖"多于"拆+卖残晶"——§6.3 括注「鼓励分解」到今天也不成立（登记为数值裁决）', () => {
    const gears = items.filter((it) => it.gear)
    expect(gears.length).toBe(18)
    const notEncouraged: string[] = []
    for (const it of gears) {
      const sv = salvageValue(it, 0)
      const salvageTotal = sv.timbite + sv.dross * stackSellPrice(DROSS)
      if (salvageTotal > sellPrice(it.id)) notEncouraged.push(`${it.id}（拆+卖 ${salvageTotal} > 卖 ${sellPrice(it.id)}）`)
    }
    expect(notEncouraged, '这些件现在拆得比卖得多，那条裁决该重立：' + notEncouraged.join(' · ')).toEqual([])
  })
})

