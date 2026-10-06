import { bus } from '@/core/EventBus'
import { describe, expect, it } from 'vitest'
import { registerGameData, movements as movementsData } from '@/data'
import type { MovementConfig, MovementData } from '@/data/schema'
import { Inventory } from '@/rpg/Inventory'
import { SCORE, MovementBook, movementConfig, movementName, unlockItemName } from '@/rpg/Movements'

/**
 * 乐章战技谱册（progression.md §7，Phase 5-C2）的状态层验收。
 *
 * 这一层只回答三件事：**点亮页花了什么、这一式现在几级、两槽装着什么**。
 * 出手不在这里（那是 flow 测试的活），所以本文件全部 headless、无玩家、无 three。
 * 数值一律回读数据表来比，测试里不抄第二份常量（§55）。
 */

registerGameData()

const TIM = 'it_timbite' // 升级的另一种学费，与强化装备共用同一种通货（rpg/Upgrade.ts）
/** 读档时「音级已封顶」的写法：槽位门禁要单独测，就别让默认值替它说话 */
const FULL = 999
/** 谱册会碰到的全部物品种类：断言"只动了该动的"要用它当全集 */
const TRACKED = [TIM, SCORE, 'it_resonance_core']
const cfg = (): MovementConfig => movementConfig()
const book = (): MovementBook => new MovementBook()

/** 装满钱的钱包：给足三样，让"付得起"成为用例的前提而不是巧合 */
function rich(...minus: [string, number][]): Inventory {
  const inv = new Inventory('mv')
  inv.add(TIM, 99999)
  inv.add(SCORE, 999)
  inv.add('it_resonance_core', 9)
  for (const [id, n] of minus) inv.remove(id, n)
  return inv
}

/** 点亮某条战技所在的页，返回该式 */
function learn(b: MovementBook, m: MovementData, inv = rich()): MovementBook {
  b.unlockPage(m.page, inv)
  return b
}

const some = (pred: (m: MovementData) => boolean, what: string): MovementData => {
  const m = cfg().movements.find(pred)
  if (!m) throw new Error(`movements.json 里没有「${what}」的战技，本用例的前提失效`)
  return m
}

describe('§7.1 点亮一页 = 吃掉数据里点名的那件东西', () => {
  it('静态表就是真源：页/槽/式子都从 movements.json 来，代码里没有第二份清单', () => {
    expect(cfg()).toBe(movementsData) // registry 里那份与导出的那份是同一个对象
    expect(cfg().pages.length).toBeGreaterThan(0)
    for (const m of cfg().movements) expect(cfg().pages.some((p) => p.id === m.page), m.id).toBe(true)
    for (const p of cfg().pages) expect(p.unlock.count || p.unlock.flag, `${p.id} 的点亮源要写物品或旗标`).toBeTruthy()
  })

  it('东西不够就不亮，而且一件都不扣（顺序反了就是「钱花了页没亮」）', () => {
    const b = book()
    const page = cfg().pages[0]
    if (page.unlock.flag) throw new Error('pages[0] 改成旗标页了：这条 poor 腿要换一张吃实物的页')
    const inv = new Inventory('mv')
    inv.add(page.unlock.item ?? '', (page.unlock.count ?? 1) - 1)
    expect(b.unlockPage(page.id, inv)).toMatchObject({ ok: false, reason: 'poor' })
    expect(b.isLit(page.id)).toBe(false)
    expect(inv.count(page.unlock.item ?? '')).toBe((page.unlock.count ?? 1) - 1)
  })

  it('够就点亮并扣款；重复点亮不再收第二份学费', () => {
    const b = book()
    const page = cfg().pages[0]
    if (page.unlock.flag) throw new Error('pages[0] 改成旗标页了：这条「只吃点名数量」腿要换一张吃实物的页')
    const inv = new Inventory('mv')
    inv.add(page.unlock.item ?? '', (page.unlock.count ?? 1) + 3)
    expect(b.unlockPage(page.id, inv).ok).toBe(true)
    expect(b.isLit(page.id)).toBe(true)
    expect(inv.count(page.unlock.item ?? ''), '只吃点名的数量，多余的留着换别的').toBe(3)
    expect(b.unlockPage(page.id, inv)).toMatchObject({ ok: false, reason: 'lit' })
    expect(inv.count(page.unlock.item ?? '')).toBe(3)
  })

  it('页 id 认不出来就是认不出来，不会顺手点亮别的页', () => {
    const b = book()
    expect(b.unlockPage('mvpage_nobody', rich())).toMatchObject({ ok: false, reason: 'unknown' })
    expect(b.snapshot().lit).toEqual([])
  })

  it('每一页都能从各自的点亮源走到「已亮」，而且只花表里写的那一样', () => {
    const b = book()
    const inv = rich()
    for (const page of cfg().pages) {
      // 旗标页（乐章 IV）不吃实物：让「恩希尔终段」发生，然后它点亮时一分钱都不花
      if (page.unlock.flag) bus.emit('world.flag', { key: page.unlock.flag, value: true })
      const before = Object.fromEntries(TRACKED.map((id) => [id, inv.count(id)]))
      expect(b.unlockPage(page.id, inv).ok, page.id).toBe(true)
      for (const id of TRACKED) {
        const want = id === (page.unlock.item ?? '') ? before[id] - (page.unlock.count ?? 0) : before[id]
        expect(inv.count(id), `${page.id} 不该动 ${id}`).toBe(want)
      }
    }
    expect(b.snapshot().lit.sort()).toEqual(cfg().pages.map((p) => p.id).sort())
  })
})

describe('§7.2 等级：练熟一式要花残页与音色石，上限由表说了算', () => {
  it('没点亮的页里的式子是 0 级，也就永远读不出数值', () => {
    const b = book()
    const m = cfg().movements[0]
    expect(b.levelOf(m.id)).toBe(0)
    expect(b.level(m.id)).toBeNull()
    expect(b.actionFor(m.id)).toBeNull()
    expect(b.upgrade(m.id, rich())).toMatchObject({ ok: false, reason: 'dark' })
  })

  it('点亮即 1 级；升级按 upgradeCost 阶梯两端同扣，走到表尾才报 max', () => {
    const m = some((x) => x.levels.length === cfg().upgradeCost.length + 1, '级数与阶梯对齐')
    const b = learn(book(), m)
    const inv = rich()
    expect(b.levelOf(m.id)).toBe(1)
    expect(b.level(m.id), '1 级读的就是表里第一格').toBe(m.levels[0])
    for (let step = 0; step < cfg().upgradeCost.length; step++) {
      const cost = cfg().upgradeCost[step]
      expect(b.upgradeNeed(m.id)).toEqual({ timbite: cost.timbite, score: cost.score, level: cost.level })
      const stone = inv.count(TIM)
      const paper = inv.count(SCORE)
      expect(b.upgrade(m.id, inv).ok).toBe(true)
      expect(inv.count(TIM)).toBe(stone - cost.timbite)
      expect(inv.count(SCORE)).toBe(paper - cost.score)
      expect(b.levelOf(m.id)).toBe(step + 2)
    }
    expect(b.upgradeNeed(m.id), '满级后不再报价，UI 据此置灰').toBeNull()
    expect(b.upgrade(m.id, inv)).toMatchObject({ ok: false, reason: 'max' })
    expect(b.level(m.id)).toBe(m.levels[m.levels.length - 1])
  })

  it('只缺一样也不行：石够残页不够 ⇒ 一分钱都不扣', () => {
    const m = some((x) => x.levels.length > 1, '可升级')
    const b = learn(book(), m)
    const inv = new Inventory('mv')
    inv.add(TIM, 99999)
    expect(b.upgrade(m.id, inv)).toMatchObject({ ok: false, reason: 'poor' })
    expect(inv.count(TIM), '先验后扣').toBe(99999)
    expect(b.levelOf(m.id)).toBe(1)
  })
})

describe('§7.3 配装：两槽、页要先亮、槽要先开', () => {
  it('开槽门槛来自 progression.json 的里程碑 id，不是代码里的第二个常数', () => {
    const b = book()
    for (let i = 0; i < cfg().slots.length; i++) {
      const need = b.slotRank(i)!
      expect(Number.isInteger(need), `槽 ${i} 的里程碑要真在 progression.json 里`).toBe(true)
      expect(b.slotOpen(i, need - 1)).toBe(false)
      expect(b.slotOpen(i, need)).toBe(true)
    }
    expect(b.slotRank(99)).toBeNull()
  })

  it('没学会装不进去，没开槽也装不进去，槽号越界更不行', () => {
    const b = book()
    const m = cfg().movements[0]
    const opened = b.slotRank(0)!
    expect(b.equip(0, m.id, 99)).toMatchObject({ ok: false, reason: 'dark' })
    learn(b, m)
    expect(b.equip(0, m.id, opened - 1)).toMatchObject({ ok: false, reason: 'locked-slot' })
    expect(b.slots[0]).toBeNull()
    expect(b.equip(-1, m.id, 99)).toMatchObject({ ok: false, reason: 'bad-slot' })
    expect(b.equip(cfg().slots.length, m.id, 99)).toMatchObject({ ok: false, reason: 'bad-slot' })
    expect(b.equip(0, m.id, opened).ok).toBe(true)
  })

  it('loadout 的键＝输入动作名，帧与数值按当前等级合成', () => {
    const mv = some((m) => !!m.frame.hitbox && (m.levels[0].damage ?? 0) > 0, '自带伤害的招式')
    const action = cfg().slots[0].action
    const b = learn(book(), mv)
    expect(b.equip(0, mv.id, b.slotRank(0)!).ok).toBe(true)
    expect(Object.keys(b.loadout())).toEqual([action])

    const f = b.actionFor(mv.id)!.f
    expect(f.startup).toBe(mv.frame.startup)
    expect(f.damage, '战技的数值不写在帧上（帧＝动作的形状）').toBe(0)
    expect(f.stamina).toBe(mv.cost.stamina ?? 0)
    expect(f.poise).toBe(mv.frame.poise ?? 0)
    expect(f.hitbox).toBe(mv.frame.hitbox)

    const cast = b.actionFor(mv.id)!.cast
    expect(cast.damage).toBe(mv.levels[0].damage)
    expect(cast.cooldownTicks).toBe(mv.levels[0].cooldownTicks)
    expect(cast.overdriveCost).toBe(mv.cost.overdrive ?? 0)
    expect(cast.scaling).toBe(cfg().damage.scaling)
    expect(cast.overdriveLayerMul).toBe(cfg().damage.perOverdriveLayer)

    // 升级后重新装配 ⇒ 交给玩家的那份小表要跟着变，不必重开游戏
    const inv = rich()
    expect(b.upgrade(mv.id, inv).ok).toBe(true)
    expect(b.loadout()[action].cast.cooldownTicks).toBe(mv.levels[1].cooldownTicks)
  })

  it('卸下是清空槽，不是把式子从谱上抹掉（学会的东西不会被忘掉）', () => {
    const mv = cfg().movements[0]
    const b = learn(book(), mv)
    const opened = b.slotRank(0)!
    b.equip(0, mv.id, opened)
    expect(b.equip(0, null, opened).ok).toBe(true)
    expect(b.loadout()).toEqual({})
    expect(b.levelOf(mv.id), '空槽不该顺手清学费').toBe(1)
  })
})

describe('§45 存档：谱册往返，脏字段一律丢弃', () => {
  it('点亮 / 等级 / 槽位 / 被动四样都复原', () => {
    const mv = some((m) => m.levels.length > 1, '可升级')
    const ps = cfg().passives?.find((p) => p.page === mv.page)
    expect(ps, '表里至少有一条被动落在本式所在的页（否则这条往返测不到被动）').toBeTruthy()
    const b = learn(book(), mv)
    const inv = rich()
    b.upgrade(mv.id, inv)
    b.equip(0, mv.id, b.slotRank(0)!)
    expect(b.learnPassive(ps!.id, inv).ok, '研读成立').toBe(true)
    const snap = JSON.parse(JSON.stringify(b.snapshot()))

    const back = book()
    back.restore(snap, FULL)
    expect(back.isLit(mv.page)).toBe(true)
    expect(back.levelOf(mv.id)).toBe(2)
    expect(back.slots[0]).toBe(mv.id)
    expect(back.loadout()).toEqual(b.loadout())
    expect(back.passiveLevel(ps!.id), '被动等级复原').toBe(1)
    expect(back.passiveValue(ps!.id), '被动数值跟着等级回来').toBe(ps!.values[0])
  })

  it('不存在的页、越界的等级、没亮页里的式子、还没开的槽——全进不了运行时', () => {
    const litPage = cfg().pages[0].id
    const onLitPage = cfg().movements.find((m) => m.page === litPage)!
    const elsewhere = cfg().movements.find((m) => m.page !== litPage)!
    const onPassive = cfg().passives?.find((p) => p.page === litPage)
    expect(onPassive, '本表至少有一条被动落在第一页（否则这条测不到被动的门禁）').toBeTruthy()
    const dirty = {
      lit: ['mvpage_nobody', litPage],
      levels: { [onLitPage.id]: 99, [elsewhere.id]: 2 }, // 一个越界、一个所在页没亮
      slots: ['mv_nobody', onLitPage.id, 'ignored-beyond-slot-count'],
      passives: { ps_nobody: 3, [onPassive!.id]: 99 } // 一条认不出、一条越界（不 clamp 成满级）
    }
    const b = book()
    b.restore(dirty, FULL)
    const snap = b.snapshot()
    expect(snap.lit).toEqual([litPage])
    expect(snap.levels[onLitPage.id], '越界等级被丢掉').toBeUndefined()
    expect(snap.levels[elsewhere.id], '页没亮的式子不保留等级').toBeUndefined()
    expect(snap.slots[0], '认不出的式子留空').toBeNull()
    expect(snap.slots[1], '合法的就收下').toBe(onLitPage.id)
    expect(snap.slots.length, '超出的槽位被忽略，不会凭空多出一个槽').toBe(cfg().slots.length)
    expect(snap.passives, '认不出/越界的被动都不进运行时').toEqual({})

    // 同一份脏档，在低音级下读进来：没开的槽连合法内容也不能带进来
    const poor = book()
    poor.restore(dirty, 1)
    expect(poor.slots).toEqual(cfg().slots.map(() => null))
    expect(poor.loadout(), '读档后打不出任何一式').toEqual({})
  })

  it('restore(null) 回到空白（v3 老档走的就是这个入口，不是替老档编一套已学会）', () => {
    const mv = cfg().movements[0]
    const b = learn(book(), mv)
    b.equip(0, mv.id, b.slotRank(0)!)
    b.restore(null, FULL)
    expect(b.snapshot()).toEqual({ lit: [], levels: {}, slots: cfg().slots.map(() => null), passives: {} })
    expect(b.loadout()).toEqual({})
  })
})

describe('面板与播报的取词口', () => {
  it('中文名从表里读；认不出来就退回 id，不编一个名字', () => {
    const m = cfg().movements[0]
    expect(movementName(m.id)).toBe(m.displayName)
    expect(movementName('mv_nobody')).toBe('mv_nobody')
    const page = cfg().pages[1]
    expect(unlockItemName(page.id)).toContain(String(page.unlock.count))
  })
})

describe('页旗标缓存：world.flag 广播是唯一写路径', () => {
  it('value 置假 ⇒ 缓存跟着删——世界收回的见证不再是见证', () => {
    const b = book()
    bus.emit('world.flag', { key: 'flag.organ_gate_open', value: true })
    expect(b.hasFlag('flag.organ_gate_open')).toBe(true)
    bus.emit('world.flag', { key: 'flag.organ_gate_open', value: false })
    expect(b.hasFlag('flag.organ_gate_open')).toBe(false)
    // 0 与 '' 同属「假」：写进来就是删
    bus.emit('world.flag', { key: 'flag.organ_gate_open', value: 0 })
    expect(b.hasFlag('flag.organ_gate_open')).toBe(false)
    bus.emit('world.flag', { key: 'flag.organ_gate_open', value: '' })
    expect(b.hasFlag('flag.organ_gate_open')).toBe(false)
  })
})
