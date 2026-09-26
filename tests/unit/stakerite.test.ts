import { describe, expect, it, beforeAll, vi } from 'vitest'
import { registerGameData, regions } from '@/data'
import { RpgRuntime } from '@/rpg/Runtime'
import { AUTOSAVE_SLOT, type SlotCard } from '@/save/Slots'
import type { SavePanelDeps } from '@/ui/Stakerite'

/**
 * 本文件是全场地最贵的 UI 测试（一个用例里 boot 面板 + RpgRuntime + 存档名册），
 * 单独跑 25 条每次都在 ~1s 内过；但全场并发跑满时它会被挤到默认 5s 超时上（实测两条
 * "Test timed out in 5000ms"，重跑即绿）。抬到 20s 只给这一份文件，不动全局默认——
 * 全局默认一抬，别处真正的慢就再也读不出来了。
 */
vi.setConfig({ testTimeout: 20000 })

/**
 * 调音桩面板（Phase 5-B 的 UI 落点）。
 *
 * 本仓库没有 DOM 测试环境（零新增依赖策略），所以这里用一个**最小 DOM 替身**只验面板自己的
 * 契约：状态机（开/关/切页）、渲染内容（音级、六维、七槽、材料数）、动作派发
 * （点一下真的改了 RpgRuntime 的状态）。
 * 真实视口下的排版评审仍受 KI-010（隐藏标签页无法截图）限制，登记在 KNOWN_ISSUES。
 */

class FakeEl {
  id = ''
  className = ''
  textContent = ''
  innerHTML = ''
  dataset: Record<string, string> = {}
  private classes = new Set<string>()
  children: FakeEl[] = []
  handlers: Record<string, ((e: unknown) => void)[]> = {}
  classList = {
    add: (c: string) => { this.classes.add(c) },
    remove: (c: string) => { this.classes.delete(c) },
    contains: (c: string) => this.classes.has(c)
  }
  style = { textContent: '' }
  appendChild(c: FakeEl): FakeEl { this.children.push(c); return c }
  addEventListener(t: string, fn: (e: unknown) => void): void { (this.handlers[t] ??= []).push(fn) }
  dispatch(t: string, e: unknown): void { for (const fn of this.handlers[t] ?? []) fn(e) }
  /** 只有点击测试会用到：把事件目标伪装成某个 [data-act] 元素 */
  closest(): FakeEl | null { return this.dataset.act ? this : null }
}

let body: FakeEl
let winHandlers: Record<string, ((e: unknown) => void)[]> = {}

beforeAll(() => {
  body = new FakeEl()
  const head = new FakeEl()
  const g = globalThis as unknown as Record<string, unknown>
  g.document = {
    createElement: () => new FakeEl(),
    head,
    body,
    getElementById: () => new FakeEl()
  }
  g.window = {
    addEventListener: (t: string, fn: (e: unknown) => void) => { (winHandlers[t] ??= []).push(fn) }
  }
})

/** 名册是异步的（存储层给 Promise）；测试里"等它回来"就是让微任务队列跑空一次 */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

const SLOT_KEYS = [AUTOSAVE_SLOT, 'slot1', 'slot2', 'slot3']

/**
 * 存档页的卡（KI-025②）。面板的合同是"名册说是什么就是什么"，所以这里的 `SlotCard` 是手搓的
 * （和上面 `mods()` 那一记假件同理）；真实名册能否产出这些形状由 `slots.test.ts` 与
 * `save-ui.test.ts` 用**真落盘的档**证明。
 *
 * 一条不许弯的地方：名册永远给四格（自动 + 三个手动槽），连最简的假件也照这个形状来——
 * 让面板习惯一个生产里不存在的名单，它就学会了给那个名单排版。
 */
function slotCard(slot: string, over: Partial<SlotCard> = {}): SlotCard {
  const auto = slot === AUTOSAVE_SLOT
  return {
    slot, kind: auto ? 'auto' : 'manual', state: 'ok', schemaVersion: 10, migrated: false,
    fromKey: null, problem: null,
    data: {
      rank: 3, originId: 'origin_tuner', weaponId: 'wp_tuning_sword', regionId: regions[0].id,
      playSec: 90, savedAt: 1770000000000, hp: 60, corruption: 0, questsStarted: 0, questsCompleted: 0
    },
    ...(auto ? { kind: 'auto' as const } : {}),
    ...over
  }
}
const EMPTY: Partial<SlotCard> = { state: 'empty', schemaVersion: null, data: null }
const fourSlots = (over: Record<string, Partial<SlotCard>> = {}): SlotCard[] =>
  SLOT_KEYS.map((s) => slotCard(s, over[s] ?? {}))

const rootOf = (p: unknown): FakeEl => (p as { root: FakeEl }).root

/** 面板的存档依赖：卡从哪来不重要，重要的是面板只会走这三个动作，碰不到键位 */
function saveFake(read: () => SlotCard[]) {
  const writes: string[] = []
  const erases: string[] = []
  const lists: string[] = []
  const deps: SavePanelDeps = {
    list: async () => { lists.push('list'); return read() },
    write: async (slot) => { writes.push(slot); return null },
    erase: async (slot) => { erases.push(slot); return read().some((c) => c.slot === slot && c.state !== 'empty') }
  }
  return { deps, writes, erases, lists }
}
const NO_SAVES: SavePanelDeps = { list: async () => fourSlots(), write: async () => null, erase: async () => false }

async function panel(runtime: RpgRuntime, deps: SavePanelDeps = NO_SAVES) {
  const { Stakerite } = await import('@/ui/Stakerite')
  const applied: number[] = []
  const notes: string[] = []
  const used: Array<{ heal: number; corruption: number }> = []
  const closes: number[] = []
  const p = new Stakerite(runtime, {
    onApply: () => applied.push(1),
    notify: (t) => notes.push(t),
    onUse: (eff) => used.push(eff),
    onRequestClose: () => closes.push(1),
  }, deps)
  return { p, applied, notes, used, closes }
}

/** 打开面板并走到存档页（真实点击切页，不伪造 tab 状态） */
async function openSaveTab(over: Record<string, Partial<SlotCard>> = {}) {
  const fake = saveFake(() => fourSlots(over))
  const { p, applied, notes, used } = await panel(new RpgRuntime('origin_tuner'), fake.deps)
  p.show()
  click(rootOf(p), 'tab', 'save')
  await flush()
  return { p, root: rootOf(p), notes, applied, used, ...fake }
}

/** 点一个**禁用**的按钮（真 DOM 里点不动，替身只能自己走一遍那条守卫） */
function clickDisabled(root: FakeEl, act: string, arg: string): void {
  const el = new FakeEl()
  el.dataset = { act, arg, disabled: '1' }
  root.dispatch('click', { target: el })
}

/** 面板把内容塞在 root.innerHTML 里；取出来当字符串断言（替身不做真解析） */
function html(p: unknown): string {
  return (p as { root?: FakeEl } & object) && ((p as unknown as { root: FakeEl }).root.innerHTML)
}

function click(root: FakeEl, act: string, arg = ''): void {
  const el = new FakeEl()
  el.dataset = { act, arg }
  root.dispatch('click', { target: el })
}

describe('调音桩面板：状态机与内容', () => {
  it('初始是收起的；show() 后渲染出音级、六维、洗点与派生值', async () => {
    registerGameData()
    const rt = new RpgRuntime('origin_tuner')
    const { p } = await panel(rt)
    const root = (p as unknown as { root: FakeEl }).root
    expect(p.isOpen).toBe(false)
    expect(root.classList.contains('on')).toBe(false)
    p.show()
    expect(p.isOpen).toBe(true)
    expect(root.classList.contains('on')).toBe(true)
    const s = html(p)
    expect(s).toContain('调音桩')
    expect(s).toContain('音级')
    for (const name of ['基音', '指法', '音色', '腔体', '泛音', '失谐']) expect(s).toContain(name)
    expect(s).toContain('洗点')
    expect(s).toContain('负重上限')
    expect(s).toContain('音色石')
    p.close()
    expect(p.isOpen).toBe(false)
  })

  it('方向键切页：调音 → 装备 → 行囊 → 谱册 → 交易，再往右回到第一页', async () => {
    const rt = new RpgRuntime('origin_tuner')
    rt.inv.add('it_timbite', 12)
    rt.inv.add('it_echo_salve', 2)
    const { p } = await panel(rt)
    p.show()
    const key = (code: string) => { for (const fn of winHandlers.keydown ?? []) fn({ code, preventDefault() {} }) }
    key('ArrowRight')
    expect(html(p)).toContain('七槽')
    expect(html(p)).toContain('调律剑')
    key('ArrowRight')
    expect(html(p)).toContain('通货')
    expect(html(p)).toContain('消耗品')
    key('ArrowRight')
    const moves = html(p)
    expect(moves, '§7 谱册：每一页都要亮出来，包括还没点亮的那些').toContain('乐章 I·序句')
    expect(moves).toContain('主动槽')
    expect(moves).toContain('乐谱研读')
    // §7.3 被动栏（KI-036）：页底常驻，研读按钮按被动 id 派发
    expect(moves, '常拍脚出现在序句页的被动栏').toContain('被动 · 常拍脚')
    expect(moves).toContain('被动 · 厚膜鼓')
    expect(moves).toContain('data-act="pslearn" data-arg="ps_metronomefoot"')
    // 页是数据驱动的：第四页（乐章 IV·休止）一入表就自己长出来了，UI 没加一行代码。
    // 没点亮也要看得见——玩家得知道"这一页上还有东西"， KI-027 那句括号到此为止。
    expect(moves).toContain('乐章 IV·休止 · 全暗')
    key('ArrowRight')
    expect(html(p), '第五页：营地交易').toContain('购入')
    key('ArrowRight')
    expect(html(p), '第六页：存档（KI-025②）').toContain('手动存档槽')
    key('ArrowRight')
    expect(html(p), '再往右绕回头一页').toContain('六音级属性')
  })

  it('点「+1」真的分配音级点，并触发一次应用回调（面板不自己写应用逻辑）', async () => {
    const rt = new RpgRuntime('origin_tuner')
    const { p, applied } = await panel(rt)
    p.show()
    const root = (p as unknown as { root: FakeEl }).root
    const before = rt.prog.attrs.str
    click(root, 'alloc', 'str') // 没有点数 ⇒ 不该变
    expect(rt.prog.attrs.str).toBe(before)
    rt.prog.addResonance(400)
    p.show()
    click(root, 'alloc', 'str')
    expect(rt.prog.attrs.str).toBe(before + 1)
    expect(rt.prog.unspent).toBe(3)
    expect(applied.length).toBeGreaterThan(0)
  })

  it('点「强化」扣材料并升级；材料不够时给一句人话而不是静默失败', async () => {
    const rt = new RpgRuntime('origin_tuner')
    const { p, notes } = await panel(rt)
    p.show()
    const root = (p as unknown as { root: FakeEl }).root
    const weapon = rt.inv.gears.find((g) => g.itemId === 'wp_tuning_sword_item')!
    click(root, 'upgrade', weapon.uid)
    expect(weapon.level, '没有材料 ⇒ 不升').toBe(0)
    expect(notes.some((n) => n.includes('材料不足'))).toBe(true)
    rt.inv.add('it_timbite', 500)
    rt.inv.add('it_dross', 50)
    click(root, 'upgrade', weapon.uid)
    expect(weapon.level).toBe(1)
    expect(notes.some((n) => n.includes('强化 +1'))).toBe(true)
  })

  it('点「使用」消耗品会真的消耗一件并把回血量交给宿主', async () => {
    const rt = new RpgRuntime('origin_tuner')
    const { p, used } = await panel(rt)
    p.show()
    const root = (p as unknown as { root: FakeEl }).root
    rt.inv.add('it_echo_salve', 1)
    click(root, 'use', 'it_echo_salve')
    expect(rt.inv.count('it_echo_salve')).toBe(0)
    expect(used[0].heal).toBeGreaterThan(0)
  })

  it('音色晶：面板只把数据里的 use.corruption 交给宿主，自己不碰玩家状态（§11 失谐）', async () => {
    const rt = new RpgRuntime('origin_tuner')
    const { p, used, notes } = await panel(rt)
    p.show()
    const root = (p as unknown as { root: FakeEl }).root
    rt.inv.add('it_timbre_crystal', 1)
    click(root, 'use', 'it_timbre_crystal')
    expect(rt.inv.count('it_timbre_crystal')).toBe(0)
    // 负数=往下刮；回血是 0——一件东西只该做数据允许它做的事
    expect(used[0]).toEqual({ heal: 0, corruption: -25 })
    expect(notes.some((n) => n.includes('失谐 -25'))).toBe(true)
  })

  it('点「卸下」把槽位清空（不会留下指向空气的 uid）', async () => {
    const rt = new RpgRuntime('origin_tuner')
    const { p } = await panel(rt)
    p.show()
    const root = (p as unknown as { root: FakeEl }).root
    expect(rt.eq.slots.weapon).toBeTruthy()
    click(root, 'unequip', 'weapon')
    expect(rt.eq.slots.weapon).toBeUndefined()
    expect(rt.mods().weaponId).toBeNull()
  })

  it('谱册页的三个动作：点亮先收学费、装槽认音级，面板只派发不自己写状态', async () => {
    const { movementConfig } = await import('@/rpg/Movements')
    registerGameData() // movementConfig 读 registry，别假设别人已经注册过
    const mv = movementConfig()
    const page = mv.pages[0]
    const onLitPage = mv.movements.find((m) => m.page === page.id)!
    const rt = new RpgRuntime('origin_tuner')
    const { p, notes, applied } = await panel(rt)
    p.show()
    const root = (p as unknown as { root: FakeEl }).root

    click(root, 'lit', page.id)
    expect(rt.moves.isLit(page.id), '一件解锁物都没有 ⇒ 页不亮').toBe(false)
    expect(notes.some((n) => n.includes('解锁物不足'))).toBe(true)

    rt.inv.add(page.unlock.item, page.unlock.count)
    click(root, 'lit', page.id)
    expect(rt.moves.isLit(page.id)).toBe(true)
    expect(rt.inv.count(page.unlock.item)).toBe(0)
    expect(notes.some((n) => n.includes('谱册点亮'))).toBe(true)

    const need = rt.moves.slotRank(0)!
    click(root, 'mvequip', `0:${onLitPage.id}`)
    expect(rt.moves.slots[0], `音级 ${rt.prog.rank} 还没到开槽的 ${need}`).toBeNull()
    expect(notes.some((n) => n.includes('才开'))).toBe(true)
    for (let i = 0; i < 400 && rt.prog.rank < need; i++) rt.prog.addResonance(300)
    expect(rt.prog.rank, `抬不到开槽音级 ${need}`).toBeGreaterThanOrEqual(need)
    click(root, 'mvequip', `0:${onLitPage.id}`)
    expect(rt.moves.slots[0]).toBe(onLitPage.id)
    expect(applied.length, '每次点击都让宿主重算派生值（面板不自己 patch 玩家）').toBeGreaterThan(0)
  })
})

describe('KI-055① 交易页（营地买卖）', () => {
  /** 走到第五页（用真实的方向键导航，不是伪造 tab 状态） */
  const tradeTab = async (rt: RpgRuntime) => {
    const { p } = await panel(rt)
    p.show()
    for (let i = 0; i < 4; i++) { for (const fn of winHandlers.keydown ?? []) fn({ code: 'ArrowRight', preventDefault() {} }) }
    return { p, s: html(p) }
  }

  it('买清单与卖价都从表里读出来，面板里没有第二个数', async () => {
    const { shopData, sellPrice } = await import('@/rpg/Shop')
    const { itemOf } = await import('@/rpg/Inventory')
    const rt = new RpgRuntime('origin_tuner')
    rt.inv.add('it_timbite', 900)
    const { s } = await tradeTab(rt)
    for (const e of shopData().stock) {
      expect(s, `${e.id} 要出现在清单上`).toContain(itemOf(e.item).displayName)
      expect(s, `按钮按条目 id 派发，不是按物品 id`).toContain(`data-act="buy" data-arg="${e.id}"`)
      expect(s, '价格一格一字不差地报出来').toContain(`${e.price} 石`)
    }
    for (const g of rt.inv.gears) {
      expect(s, `${g.uid} 要有一行可售出，价从表里读`).toContain(`data-act="sell" data-arg="${g.uid}"`)
      expect(s).toContain(`${sellPrice(g.itemId)} 石`)
    }
    expect(s, '系数也要念出来：卖价不是黑箱').toContain(`${Math.round(shopData().sell.mul * 100)}%`)
  })

  it('点「售出」真的换到石、点「购入」真的扣石（面板只派发，账在 RpgRuntime 上）', async () => {
    const { shopData, sellPrice } = await import('@/rpg/Shop')
    const rt = new RpgRuntime('origin_tuner')
    const { p, notes } = await panel(rt)
    p.show()
    const root = (p as unknown as { root: FakeEl }).root
    for (let i = 0; i < 4; i++) { for (const fn of winHandlers.keydown ?? []) fn({ code: 'ArrowRight', preventDefault() {} }) }
    const gem = rt.inv.addGear('ar_choir_hood')
    const stone = rt.inv.count('it_timbite')
    click(root, 'sell', gem.uid)
    expect(rt.inv.gearByUid(gem.uid)).toBeUndefined()
    expect(rt.inv.count('it_timbite') - stone).toBe(sellPrice('ar_choir_hood'))
    expect(notes.some((n) => n.includes('售出'))).toBe(true)

    const entry = shopData().stock[0]
    const wallet = rt.inv.count('it_timbite')
    click(root, 'buy', entry.id)
    expect(rt.inv.count(entry.item)).toBe(1)
    expect(wallet - rt.inv.count('it_timbite')).toBe(entry.price)
    expect(notes.some((n) => n.includes('购入'))).toBe(true)

    click(root, 'buy', 'no_such_entry')
    expect(notes.some((n) => n.includes('清单上没有'))).toBe(true)
  })
})

describe('§44 装备对比 Current vs New（需求 §44 / ui-ux §3.3）', () => {
  /** 面板的七槽页里，候选件那一行下面挂一块双栏对比 */
  const gearTab = async (rt: RpgRuntime) => {
    const { p } = await panel(rt)
    p.show()
    for (const fn of winHandlers.keydown ?? []) fn({ code: 'ArrowRight', preventDefault() {} })
    return { p, s: html(p) }
  }

  it('未装备的候选：双栏都在，每一行都带差值（不允许只显新物品那一侧）', async () => {
    const rt = new RpgRuntime('origin_tuner') // 出身戴着哑带盔（def 3 / 2.0）
    const g = rt.inv.addGear('ar_choir_hood') // 唱诗班头巾：def 5 / 3.0 ⇒ 两项都该有差值
    const { s } = await gearTab(rt)
    expect(s, '候选件行下方要有对比块').toContain('<div class="cmp">')
    expect(s).toContain('当前 · ')
    expect(s).toContain('换上 · ')
    // 两栏都是**整套**乘数（不是这一件的属性），所以当前防御是全身合计 17
    expect(s, '防御那一行要报出差值').toMatch(/防御<\/span><span class="a">17<\/span><span class="d up">▲ \+2<\/span><span class="b">19/)
    expect(s, '负重同样').toMatch(/负重<\/span><span class="a">24<\/span><span class="d up">▲ \+1<\/span><span class="b">25/)
    expect(s, '词缀那一行也要有（特殊：左 vs 右）').toContain('特殊')
    void g
  })

  it('已经穿着的那件不配拥有对比块（它就是"当前"）', async () => {
    const rt = new RpgRuntime('origin_tuner')
    const worn = rt.inv.gears.find((x) => x.itemId === 'ar_mutewrap_helm')!
    const { s } = await gearTab(rt)
    const at = s.indexOf(worn.uid)
    expect(at, '已装备件仍在清单里').toBeGreaterThan(-1)
    const block = s.slice(at, s.indexOf('</div>', at) + 6)
    expect(block, '它的行下方不该再来一块对比').not.toContain('换上 ·')
  })

  it('同一件装备的另一份拷贝：三行常驻都在，但没有一行被标成提升或下降', async () => {
    const rt = new RpgRuntime('origin_tuner')
    rt.inv.addGear('ar_mutewrap_helm') // 与身上那件同一张表、同样没有词缀 ⇒ 差值必须全是 —
    const { s } = await gearTab(rt)
    expect(s).toContain('<div class="cmp">')
    expect(s, '不许把相同的东西说成有提升').not.toContain('class="d up"')
    expect(s).not.toContain('class="d down"')
    expect(s, '常驻三行仍然要在（缺了要玩家自己心算）').toMatch(/重击底数[\s\S]*防御[\s\S]*负重/)
  })

  it('投影只是投影：不改真实槽位，音徽仍走 A→B 那一条规则', () => {
    const rt = new RpgRuntime('origin_tuner')
    const before = { ...rt.eq.slots }
    const seal = rt.inv.addGear('seal_firstbeat')
    const p = rt.eq.preview(rt.inv, seal.uid)
    expect(p, '音徽要有落点').not.toBeNull()
    expect(p!.slot, 'A 槽空着才进 A')
      .toBe(rt.eq.slots.sealA ? 'sealB' : 'sealA')
    expect(rt.eq.slots, 'preview 不许碰真实槽位').toEqual(before)
    const helm = rt.inv.addGear('ar_veilbell_helm')
    const q = rt.eq.preview(rt.inv, helm.uid)
    expect(q!.slot).toBe('helm')
    expect(q!.mods.defense, '投影里的防御 = 换上之后的值（当前 3 → 这件 7）')
      .toBeGreaterThan(rt.eq.totals(rt.inv).defense)
    expect(rt.eq.slots).toEqual(before)
  })
})

describe('KI-027：负重那一行要说实话', () => {
  it('未超载时写「未超载」，超载时写清罚了什么——两个分支都取自同一份 mods()', async () => {
    const { Stakerite } = await import('@/ui/Stakerite')
    const rt = new RpgRuntime('origin_tuner')
    const real = rt.mods.bind(rt)
    const mk = (overloaded: boolean) => {
      // 面板的合同是"只读 RpgRuntime 的公开方法"，所以喂一份假的 mods 就是合法的接缝
      rt.mods = () => ({ ...real(), weight: overloaded ? 99 : real().weight, overloaded })
      const p = new Stakerite(rt, { onApply: () => {}, notify: () => {}, onUse: () => {}, onRequestClose: () => {} }, NO_SAVES)
      p.show()
      const s = (p as unknown as { root: FakeEl }).root.innerHTML
      p.close()
      return s
    }
    const light = mk(false)
    expect(light, '当前重量与上限都要写出来（只给上限要玩家自己心算）')
      .toContain(`负重</span><span class="num">${real().defense} / ${real().weight} · 上限 ${real().loadMax} kg</span>`)
    expect(light).toContain('未超载')
    expect(light).not.toContain('class="over"')
    const heavy = mk(true)
    expect(heavy, '超载要说出罚了什么，不是只涂个色').toContain('超载 · 翻滚与疾跑禁用、体力回复 −40%')
    expect(heavy, '超载那一行报的重量就是 mods() 里那个数').toContain(`/ 99 · 上限 ${real().loadMax} kg`)
    rt.mods = real
  })
})

/* --------------------------- 存档页（KI-025②） --------------------------- */

/**
 * 存档页要守住的三件事：
 * 1. **两步**——写入会覆盖那一格、删除拿不回来，一次点击不许落到硬盘上；
 * 2. 名册现读——写/删之后再取一次，卡上的字来自存储而不是面板的"我应该写过了"；
 * 3. 存档动作不重算派生值——它没改变任何 build 状态，`onApply` 被叫到就说明页间逻辑串了线。
 */
describe('KI-025②：存档页', () => {
  registerGameData() // 卡面上的 regionId 从表里取：假件也要用一个真实存在的区域键

  it('进页才取名册一次：四格的标签都在，自动槽那格不给写与删', async () => {
    const { p, lists } = await openSaveTab({ slot2: EMPTY, slot3: EMPTY })
    expect(lists.length, '进页读一次，不多读').toBe(1)
    const s = html(p)
    expect(s).toContain('槽 I')
    expect(s).toContain('槽 II')
    expect(s).toContain('槽 III')
    expect(s).toContain('data-act="write" data-arg="autosave" data-disabled="1"')
    expect(s).toContain('data-act="erase" data-arg="autosave" data-disabled="1"')
    expect(s, '这一页只给写入/删除：读档是标题屏的位置才该干的事').not.toContain('data-act="load"')
    expect(s).toContain('只有站在调音桩前才写得进去')
  })

  it('一次点击只是把那一笔记成待确认，落盘要第二下', async () => {
    const { p, writes, lists } = await openSaveTab({ slot2: EMPTY, slot3: EMPTY })
    const before = lists.length
    click(rootOf(p), 'write', 'slot2')
    expect(writes, '确认之前不写盘').toEqual([])
    const armed = html(p)
    expect(armed).toContain('写入 槽 II —— 这一格现在是空的')
    expect(armed).toContain('data-act="confirm"')
    expect(armed).toContain('这一步会动到硬盘上的东西，确认才做。')
    click(rootOf(p), 'confirm')
    await flush()
    expect(writes).toEqual(['slot2'])
    expect(lists.length, '写完重新取名册').toBe(before + 1)
  })

  it('覆盖已有的那一格要说清楚会被覆盖，而不是只说「写入 槽 I」', async () => {
    const { p } = await openSaveTab()
    click(rootOf(p), 'write', 'slot1')
    expect(html(p)).toContain('写入 槽 I —— 这一格已有的存档会被当前局面覆盖')
  })

  it('取消就不落盘，确认条也不留在页上', async () => {
    const { p, writes } = await openSaveTab()
    click(rootOf(p), 'erase', 'slot1')
    expect(html(p)).toContain('data-act="confirm"')
    click(rootOf(p), 'cancel')
    expect(html(p)).not.toContain('data-act="confirm"')
    await flush()
    expect(writes).toEqual([])
  })

  it('「已删除」只在该格真有东西时；erase 返回 false 就要如实说本来就是空的', async () => {
    const { p, erases, notes } = await openSaveTab({ slot2: EMPTY })
    click(rootOf(p), 'erase', 'slot1')
    click(rootOf(p), 'confirm')
    await flush()
    click(rootOf(p), 'erase', 'slot2')
    click(rootOf(p), 'confirm')
    await flush()
    expect(erases).toEqual(['slot1', 'slot2'])
    expect(notes[0]).toBe('已删除 槽 I')
    expect(notes[1], '删了一个本来就空的格子，不能报"已删除"').toBe('槽 II本来就是空的')
  })

  it('禁用的按钮点不动：自动槽写不进去，空格也删不了', async () => {
    const { p, writes, erases } = await openSaveTab({ slot2: EMPTY })
    clickDisabled(rootOf(p), 'write', AUTOSAVE_SLOT)
    clickDisabled(rootOf(p), 'erase', 'slot2')
    expect(html(p), '被拦下的那一下不该留下确认条').not.toContain('data-act="confirm"')
    await flush()
    expect(writes).toEqual([])
    expect(erases).toEqual([])
  })

  it('存档动作不重算派生值（页间逻辑不许串线）', async () => {
    const { p, applied, writes } = await openSaveTab()
    const before = applied.length
    click(rootOf(p), 'write', 'slot1')
    click(rootOf(p), 'confirm')
    await flush()
    expect(writes).toEqual(['slot1'])
    expect(applied.length, '存档没有改变任何 build 状态').toBe(before)
  })

  it('写盘失败要说出来，不能假装写完了', async () => {
    const deps: SavePanelDeps = {
      list: async () => fourSlots(),
      write: async () => { throw new Error('quota exceeded') },
      erase: async () => false
    }
    const { p, notes } = await panel(new RpgRuntime('origin_tuner'), deps)
    p.show()
    click(rootOf(p), 'tab', 'save')
    await flush()
    click(rootOf(p), 'write', 'slot1')
    click(rootOf(p), 'confirm')
    await flush()
    expect(notes[0], '存储没答应就不能报"已写入"').toBe('写入失败：存储没有答应')
    expect(notes).not.toContain('已写入 槽 I')
  })

  it('换页时撤掉没确认的那一笔：确认条不会跟着跑到调音页', async () => {
    const { p } = await openSaveTab()
    click(rootOf(p), 'write', 'slot1')
    expect(html(p)).toContain('data-act="confirm"')
    click(rootOf(p), 'tab', 'tune')
    expect(html(p)).not.toContain('data-act="confirm"')
    click(rootOf(p), 'tab', 'save')
    await flush()
    expect(html(p), '换回来也不该把刚才那笔的确认条原样端回来').not.toContain('data-act="confirm"')
  })

  it('关面板也撤掉待确认：下次打开从名册重读，不从半截状态继续', async () => {
    const { p, erases } = await openSaveTab()
    click(rootOf(p), 'erase', 'slot1')
    p.close()
    p.show()
    await flush()
    expect(html(p)).not.toContain('data-act="confirm"')
    expect(erases).toEqual([])
  })
})
