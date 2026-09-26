import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { registerGameData } from '@/data'
import { registry } from '@/core/Registry'
import { RpgRuntime } from '@/rpg/Runtime'
import { ADVICE_AXES, EMPTY_MODS } from '@/rpg/Equipment'
import type { ProgressionData } from '@/data/schema'

/**
 * KI-060：§44 那一栏「更适合当前 Build 的建议星标」（ui-ux.md §3.3）。
 *
 * 这块逻辑最容易坏在三处，测试各钉一条：
 * 1. **表与类型漂开**——写了 `EquipMods` 里不存在的轴 ⇒ 它永远贡献 0，面板照样画星，没人会发现；
 * 2. **星标有了第二个来源**——代码里内置一份"默认权重"，于是改表不跟；
 * 3. **建议变成了闸门**——"这不是最优解所以不让你装"是把 §3.3 那句"玩家可否决"反过来写。
 *
 * 所有夹具都传 `affixes: []`：词缀是掷出来的，让掷骰混进"谁该被标星"的断言，
 * 这条测试就会在某个种子下变成另一道题。
 */

const root = fileURLToPath(new URL('../..', import.meta.url))

registerGameData()

const table = (): ProgressionData => registry.get<ProgressionData>('progression')
const weights = (): Record<string, number> => table().gearAdvice.weights

/**
 * 基线 = 头戴 +0 唱诗班头巾（DEF 5 / 3kg）。候选把两条轴推向相反方向，而且**故意让"先来者"不等于"最优者"**：
 * `mid` 是同一件 +2（DEF 6，正分但不是最高）、`light` 是哑带裹布（DEF 3 / 2kg，净亏 -0.5）、
 * `heavy` 是同一件 +4（DEF 7，最高 +2 分），创建顺序 mid→light→heavy。
 * 于是"取这一格第一个正分"那种偷懒写法会被夹具当场抓住（反向探针 T3 就是这么打红的）。
 * 默认权重：1 DEF = 1 分、1kg = -1.5 分。
 * 出身 kit 里还留着第三顶帽子，它同样是候选——所以断言一律写"谁的分最高 / 星标搬没搬"，不数候选件数。
 */
function helmBench(): { rt: RpgRuntime; mid: string; heavy: string; light: string } {
  const rt = new RpgRuntime('origin_tuner', 7)
  rt.unequip('helm')
  rt.equip(rt.inv.addGear('ar_choir_hood', 0, []).uid)
  const mid = rt.inv.addGear('ar_choir_hood', 2, []).uid
  const light = rt.inv.addGear('ar_mutewrap_helm', 0, []).uid
  const heavy = rt.inv.addGear('ar_choir_hood', 4, []).uid
  return { rt, mid, heavy, light }
}

/** 临时改权重表：必须 finally 还原（同文件后面的用例会读到污染值） */
function withWeights(patch: Record<string, number>, body: () => void): void {
  const w = weights()
  const before = { ...w }
  try {
    Object.assign(w, patch)
    body()
  } finally {
    for (const k of Object.keys(w)) delete w[k]
    Object.assign(w, before)
  }
}

describe('KI-060 权重表 ↔ 类型 ↔ 校验器：三方不许漂', () => {
  it('表里写的每一个轴都真的存在于 EquipMods（写了不存在的轴 = 永远贡献 0 的死数据）', () => {
    const axes = Object.keys(weights())
    expect(axes.length, '空表等于没有这一栏').toBeGreaterThan(5)
    for (const a of axes) {
      expect(ADVICE_AXES, `轴 '${a}' 不在 ADVICE_AXES 里`).toContain(a)
      expect(typeof (EMPTY_MODS as unknown as Record<string, unknown>)[a], `EquipMods.${a} 不是数值轴`).toBe('number')
    }
  })

  it('校验器手抄的那份轴名单与 Equipment.ADVICE_AXES 逐字相同（抄漏一条就红）', () => {
    const src = readFileSync(root + 'scripts/validate-data.mjs', 'utf8')
    const m = src.match(/const ADVICE_AXES = \[([\s\S]*?)\]/)
    expect(m, '校验器里找不到那份轴名单了（改名或搬走 ⇒ 这条对账要跟着改）').toBeTruthy()
    const listed = [...m![1].matchAll(/'([a-zA-Z]+)'/g)].map((x) => x[1]).sort()
    expect(listed, '脚本抄的名单 ≠ 从 EMPTY_MODS 现推的名单').toEqual([...ADVICE_AXES].sort())
  })

  it('轴名单是从 EMPTY_MODS 现推的：数值轴全覆盖，字符串轴一个都不混进来', () => {
    const numeric = Object.keys(EMPTY_MODS).filter((k) => typeof (EMPTY_MODS as unknown as Record<string, unknown>)[k] === 'number')
    expect([...ADVICE_AXES].sort()).toEqual(numeric.sort())
    expect(ADVICE_AXES, 'weaponId 是字符串，不能进建议分').not.toContain('weaponId')
  })
})

describe('KI-060 评分：读表、纯函数、不动真实槽位', () => {
  it('同一件连算两次给出同一个数（无 rng），而且算完之后一身装备一位没动', () => {
    const { rt, heavy } = helmBench()
    const before = JSON.stringify(rt.eq.snapshot())
    const a = rt.eq.adviceDelta(rt.inv, heavy)
    const b = rt.eq.adviceDelta(rt.inv, heavy)
    expect(b).toBe(a)
    expect(Number.isFinite(a)).toBe(true)
    expect(JSON.stringify(rt.eq.snapshot()), '观测不许改变被观测的那一身').toBe(before)
  })

  it('星标完全来自那张表：把权重全清成 0，一颗星都不该落下（代码里没有第二份默认权重）', () => {
    withWeights(Object.fromEntries(ADVICE_AXES.map((k) => [k, 0])), () => {
      const { rt } = helmBench()
      expect(Object.keys(rt.eq.adviceStars(rt.inv))).toEqual([])
    })
  })

  it('改表法：把 DEF 的符号反过来 ⇒ 星标离开 DEF 最高的那件（读的是表不是等级）', () => {
    const { rt, heavy } = helmBench()
    expect(rt.eq.adviceStars(rt.inv).helm, '默认权重（1 DEF = 1 分，1kg = -1.5 分）该推荐强化过的那顶').toBe(heavy)
    withWeights({ defense: -1 }, () => {
      // 这一格里还有出身kit留下的第三顶（夹具不搬走它，搬走就是替被测系统做选择），
      // 所以判据写成"星标离开 heavy"而不是"星标必须落在某一件上"：换谁都由表说了算。
      expect(rt.eq.adviceStars(rt.inv).helm, '只动一张表，星标就搬家').not.toBe(heavy)
      expect(rt.eq.adviceDelta(rt.inv, heavy), '而 heavy 自己已经掉进负分（所以它落选是规则，不是特例）').toBeLessThan(0)
    })
    expect(rt.eq.adviceStars(rt.inv).helm, '还原后回到默认答案').toBe(heavy)
  })

  it('每格最多一颗星，它确实是那一格里分数最高的一件；换上更差的件一律不标', () => {
    const { rt, light } = helmBench()
    const stars = rt.eq.adviceStars(rt.inv)
    expect(Object.keys(stars).length).toBe(new Set(Object.values(stars)).size)
    const worn = rt.eq.snapshot().helm!
    const rivals = rt.inv.gears
      .filter((g) => g.uid !== worn && rt.eq.preview(rt.inv, g.uid)?.slot === 'helm')
      .map((g) => rt.eq.adviceDelta(rt.inv, g.uid))
    expect(rivals.length, '这一格至少要有两件候选可荐').toBeGreaterThanOrEqual(2)
    expect(rt.eq.adviceDelta(rt.inv, stars.helm!), '★ 必须是候选里最高分').toBe(Math.max(...rivals))
    expect(light && rt.eq.adviceDelta(rt.inv, light), '轻的那顶在默认权重下是净亏，不该有星').toBeLessThan(0)
    expect(stars.helm).not.toBe(light)
  })

  it('身上那件不参与推荐（推荐自己不是建议，是噪音）', () => {
    const { rt } = helmBench()
    const worn = rt.eq.snapshot().helm
    expect(worn, '夹具该穿着一顶').toBeTruthy()
    expect(Object.values(rt.eq.adviceStars(rt.inv)).includes(worn!), '身上这件不该出现在推荐里').toBe(false)
  })

  it('建议不是闸门：装一件分数为负的件照样成功（§3.3「玩家可否决」）', () => {
    const { rt, light } = helmBench()
    expect(rt.eq.adviceDelta(rt.inv, light), '先确认这一件确实是"不推荐"的').toBeLessThan(0)
    const r = rt.equip(light)
    expect(r.ok, '面板的★不参与许可判断').toBe(true)
    expect(rt.eq.snapshot().helm).toBe(light)
  })
})

describe('KI-060 面板是它的读者（没有消费方的表就是死数据）', () => {
  const ui = readFileSync(root + 'src/ui/Stakerite.ts', 'utf8')
  const code = ui.split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
    .join('\n')

  it('装备页画了 ★，而且分数只问 Equipment 一次（面板自己不加权）', () => {
    expect(code, '面板没画那一颗星').toContain('★ 建议')
    expect(code, '面板绕过了 Equipment.adviceStars').toContain('adviceStars(')
    expect(code, '面板绕过了 Equipment.adviceDelta').toContain('adviceDelta(')
    expect(code, '面板里不许出现第二份权重乘法').not.toMatch(/gearAdvice\.weights/)
  })

  it('Equipment 不认识 DOM，也不认识别的数值来源（依赖箭头没反）', () => {
    const eq = readFileSync(root + 'src/rpg/Equipment.ts', 'utf8')
    expect(eq, '逻辑层不许 import three / document').not.toMatch(/from 'three'|document\./)
    expect(eq, '权重只能从 progression 表里拿').toContain("registry.get<ProgressionData>('progression').gearAdvice.weights")
  })
})
