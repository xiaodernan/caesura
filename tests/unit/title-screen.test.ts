import { describe, expect, it, beforeAll } from 'vitest'
import { registerGameData } from '@/data'
import type { ProgressionData } from '@/data/schema'
import { registry } from '@/core/Registry'
import { Input } from '@/core/Input'
import { AUTOSAVE_SLOT, type SlotCard } from '@/save/Slots'
import type { TitleHooks } from '@/ui/TitleScreen'

/**
 * 标题屏的三段流程（KI-031② 定弦 + KI-025② 挑档/防误删确认）。
 *
 * 这里要钉住的是**顺序**而不是排版：
 * - 本机有可读的档时，点一张出身卡不许立刻开新弦——必须先过确认屏（§45 的防误删），
 *   而确认屏的默认焦点是"取消"，不是"确认"；
 * - 名册还没读回来时同样不许开新弦：那不是"没有档"，那是"还不知道有没有档"（§78）；
 * - "续"读的是玩家选中那一格，不是写死的 autosave；
 * - 空格、坏档、可读档三态在卡面上必须可分辨，坏的那一格按不下去但要看懂为什么。
 *
 * **键盘从 KI-062 第二腿起走真通道**：本屏不再挂 `keydown`，键码先进 `core/Input.ts` 折成 `UiIntent`，
 * `poll()` 求出边沿后才喂给 `uiStep()`。所以 `screen()` 一并交回一个 `press`——它按的是完整一记
 * （按下 → poll → 喂屏 → 松开 → poll），少掉中间那次 poll 就没有边沿，少掉收尾那次下一记同键会被
 * 判成"一直按着"而没有新边沿（那是 edge 语义，不是 bug）。
 *
 * DOM 用最小替身（与 `stakerite.test.ts` 同一手法）；真实视口排版仍受 KI-010 限制。
 */

class FakeEl {
  id = ''
  innerHTML = ''
  textContent = ''
  dataset: Record<string, string> = {}
  children: FakeEl[] = []
  parent: FakeEl | null = null
  private classes = new Set<string>()
  handlers: Record<string, ((e: unknown) => void)[]> = {}
  classList = {
    add: (c: string) => { this.classes.add(c) },
    remove: (c: string) => { this.classes.delete(c) },
    contains: (c: string) => this.classes.has(c)
  }
  appendChild(c: FakeEl): FakeEl { c.parent = this; this.children.push(c); return c }
  remove(): void {
    if (!this.parent) return
    this.parent.children = this.parent.children.filter((x) => x !== this)
    this.parent = null
  }
  addEventListener(t: string, fn: (e: unknown) => void): void { (this.handlers[t] ??= []).push(fn) }
  dispatch(t: string, e: unknown): void { for (const fn of this.handlers[t] ?? []) fn(e) }
  closest(): FakeEl | null { return this.dataset.act ? this : null }
}

let body: FakeEl
let win: { handlers: Record<string, ((e: unknown) => void)[]> }

beforeAll(() => {
  body = new FakeEl()
  const g = globalThis as unknown as Record<string, unknown>
  g.document = {
    createElement: () => new FakeEl(),
    head: new FakeEl(),
    body,
    getElementById: () => new FakeEl()
  }
  win = { handlers: {} }
  g.window = {
    addEventListener: (t: string, fn: (e: unknown) => void) => { (win.handlers[t] ??= []).push(fn) },
    removeEventListener: (t: string, fn: (e: unknown) => void) => {
      win.handlers[t] = (win.handlers[t] ?? []).filter((f) => f !== fn)
    }
  }
})

/** 一格的形状与 `SlotRoster.card()` 一致（真名册能否产出它由 slots/save-ui 两档测试用真档证明） */
function card(slot: string, over: Partial<SlotCard> = {}): SlotCard {
  const data = {
    rank: 4, originId: 'origin_tuner', weaponId: 'wp_tuning_sword', regionId: null,
    playSec: 120, savedAt: 1770000000000, hp: 60, corruption: 0, questsStarted: 1, questsCompleted: 0
  }
  return {
    slot, kind: slot === AUTOSAVE_SLOT ? 'auto' : 'manual', state: 'ok', schemaVersion: 10,
    migrated: false, fromKey: null, problem: null, data, ...over
  }
}
const EMPTY: Partial<SlotCard> = { state: 'empty', schemaVersion: null, data: null }
const BLOCKED: Partial<SlotCard> = { state: 'blocked', schemaVersion: null, data: null, problem: 'crc' }

const SLOTS = [AUTOSAVE_SLOT, 'slot1', 'slot2', 'slot3']
const roster = (over: Record<string, Partial<SlotCard>> = {}): SlotCard[] =>
  SLOTS.map((s) => card(s, over[s] ?? {}))

interface Hit { news: string[]; continues: string[] }

/** 把一记键码打进假窗口（那里只有 `Input` 的监听器，本屏自己一只都不挂）；`up` = 松开 */
const fire = (code: string, up = false): void => {
  const e = { code, key: '', repeat: false, preventDefault: () => {} }
  for (const fn of win.handlers[up ? 'keyup' : 'keydown'] ?? []) fn(e)
}

async function screen(read: () => SlotCard[]) {
  const { TitleScreen } = await import('@/ui/TitleScreen')
  const hit: Hit = { news: [], continues: [] }
  const hooks: TitleHooks = {
    onNew: (id) => { hit.news.push(id) },
    onContinue: (slot) => { hit.continues.push(slot) },
    listSlots: async () => read()
  }
  // 监听器只数**这一步新添的**：假窗口在整个文件里是同一只，用例之间会累加，
  // 直接断言总数等于几把上一格的功劳也算进来了。
  const kbOf = (): number => (win.handlers.keydown ?? []).length
  const beforeTitle = kbOf()
  const t = new TitleScreen(hooks)
  const titleKeydowns = kbOf() - beforeTitle // 本屏自己挂的：KI-062 第二腿之后恒为 0
  const beforeInput = kbOf()
  // 真通道：所有权 = 标题屏这一格，玩法那条按着组合根的样子关掉（enabled=false）
  const input = new Input(new FakeEl() as unknown as HTMLElement)
  input.enabled = false
  input.uiOwner = 'title'
  const inputKeydowns = kbOf() - beforeInput
  await new Promise((r) => setTimeout(r, 0)) // 等名册那一次异步读回来
  /** 完整一记：按下 → poll 出边沿 → 喂屏 → 松开 → 再 poll（清掉"按着"的状态） */
  const press = (code: string): void => {
    fire(code)
    input.poll(1 / 60)
    t.uiStep(input.uiEdges)
    fire(code, true)
    input.poll(1 / 60)
  }
  return { t, hit, press, root: (t as unknown as { root: FakeEl }).root, stats: { titleKeydowns, inputKeydowns } }
}
function click(root: FakeEl, act: string, arg = ''): void {
  const el = new FakeEl()
  el.dataset = { act, arg }
  root.dispatch('click', { target: el })
}
function clickDisabled(root: FakeEl, act: string, arg = ''): void {
  const el = new FakeEl()
  el.dataset = { act, arg, disabled: '1' }
  root.dispatch('click', { target: el })
}
const view = (t: unknown): string => (t as { root: FakeEl }).root.innerHTML

describe('标题屏 · 定弦（KI-031②）', () => {
  registerGameData()

  it('五张出身卡全部从表里读，屏上没有第二条出身文案', async () => {
    const { t } = await screen(() => roster())
    const s = view(t)
    expect(s).toContain('止音纪元')
    expect(s).toContain('CAESURA')
    expect(s.match(/data-act="card"/g)?.length).toBe(5)
    expect(s).toContain('被动 ·')
  })

  it('本机没有档 ⇒ 点一张卡直接开弦，不打扰确认屏', async () => {
    const { t, hit } = await screen(() => roster({ autosave: EMPTY, slot1: EMPTY, slot2: EMPTY, slot3: EMPTY }))
    expect(view(t)).toContain('本机没有可续的存档')
    click((t as unknown as { root: FakeEl }).root, 'card', 'origin_drummer')
    expect(hit.news).toEqual(['origin_drummer'])
  })

  it('名册还没读回来时点卡不开弦：那不是「没有档」，是「还不知道」', async () => {
    const { TitleScreen } = await import('@/ui/TitleScreen')
    const hit: Hit = { news: [], continues: [] }
    let release: ((c: SlotCard[]) => void) | null = null
    const t = new TitleScreen({
      onNew: (id) => { hit.news.push(id) },
      onContinue: (s) => { hit.continues.push(s) },
      listSlots: () => new Promise<SlotCard[]>((res) => { release = res })
    })
    const root = (t as unknown as { root: FakeEl }).root
    expect(view(t)).toContain('正在查看本机存档…')
    click(root, 'card', 'origin_drummer')
    expect(hit.news, '读数没到齐就不该有决定').toEqual([])
    release!(roster())
    await new Promise((r) => setTimeout(r, 0))
    expect(t.hasSaveable).toBe(true)
    click(root, 'card', 'origin_drummer')
    expect(hit.news, '读数到齐之后同一记点击走确认屏').toEqual([])
    expect(view(t)).toContain('开一根新弦')
  })
})

describe('标题屏 · 防误删确认（KI-025②）', () => {
  registerGameData()

  it('有可读的档 ⇒ 点卡先落在确认屏，并且默认焦点是「取消」', async () => {
    const { t, hit } = await screen(() => roster())
    click((t as unknown as { root: FakeEl }).root, 'card', 'origin_drummer')
    const s = view(t)
    expect(hit.news).toEqual([])
    expect(s).toContain('本机已有可读的存档')
    expect(s).toContain('下一次休息会把自动槽写掉')
    expect(s).toContain('class="act sel" data-act="new-no"')
    expect(s).toContain('音级 4')
  })

  it('确认屏上 Enter 的默认那一记是取消：回到定弦，谁也不开', async () => {
    const { t, hit, press } = await screen(() => roster())
    const root = (t as unknown as { root: FakeEl }).root
    click(root, 'card', 'origin_drummer')
    press('Enter')
    expect(hit.news).toEqual([])
    expect(view(t)).toContain('为她定一根弦')
  })

  it('→ 之后 Enter 才真的开新弦，而且开的是被点的那一根', async () => {
    const { t, hit, press } = await screen(() => roster())
    const root = (t as unknown as { root: FakeEl }).root
    click(root, 'card', 'origin_scavenger')
    press('ArrowRight')
    press('Enter')
    expect(hit.news).toEqual(['origin_scavenger'])
    press('Enter')
    expect(hit.news, '那一根弦已经交出去了：同一屏再按 Enter 不会二次开弦').toEqual(['origin_scavenger'])
    expect(view(t)).toContain('为她定一根弦')
  })

  it('只有坏档时也要给路看原因：能进挑档屏，但那一格按不下去', async () => {
    const { t, hit, press } = await screen(() => roster({
      autosave: EMPTY, slot1: BLOCKED, slot2: EMPTY, slot3: EMPTY
    }))
    const s = view(t)
    expect(s).toContain('本机有存档，但读不出来')
    expect(s).not.toContain('本机没有可续的存档')
    expect(s, '没有可读的档，但"查看"那一行还是要给').toContain('查看 · 本机有读不出来的存档')
    press('ArrowDown')
    press('Enter')
    const picked = view(t)
    expect(picked).toContain('存档文件已损坏')
    expect(picked).toContain('data-act="load" data-arg="slot1" data-disabled="1"')
    clickDisabled((t as unknown as { root: FakeEl }).root, 'load', 'slot1')
    expect(hit.continues, '坏档点不动').toEqual([])
    press('ArrowDown')
    press('Enter')
    expect(hit.continues, '一格可读的都没有 ⇒ Enter 不续任何东西').toEqual([])
    expect(view(t), '还留在挑档屏：那句原因就是要给人看到的').toContain('data-slot="slot1"')
  })
})

describe('标题屏 · 挑档续玩（KI-025②）', () => {
  registerGameData()

  it('「续」进挑档屏：四格都渲染，只有可读的那几格能按', async () => {
    const { t, hit, press } = await screen(() => roster({
      autosave: EMPTY, slot2: BLOCKED, slot3: EMPTY
    }))
    press('ArrowDown')
    press('Enter')
    const s = view(t)
    expect(s.match(/data-act="load"/g)?.length).toBe(4)
    expect(s).toContain('data-act="load" data-arg="autosave" data-disabled="1"')
    expect(s).toContain('data-act="load" data-arg="slot1"')
    click((t as unknown as { root: FakeEl }).root, 'load', 'slot1')
    expect(hit.continues).toEqual(['slot1'])
    expect(hit.news, '续档不是开新弦').toEqual([])
  })

  it('读的是玩家选中的那一格，不是写死的 autosave', async () => {
    const { t, hit } = await screen(() => roster({ slot2: EMPTY }))
    await t.goto('slots')
    click((t as unknown as { root: FakeEl }).root, 'load', 'autosave')
    expect(hit.continues).toEqual(['autosave'])
    click((t as unknown as { root: FakeEl }).root, 'load', 'slot3')
    expect(hit.continues).toEqual(['autosave', 'slot3'])
  })

  it('焦点只在可读的那几格里绕：空槽与坏档不参与计数', async () => {
    const { t, press } = await screen(() => roster({ autosave: EMPTY, slot2: BLOCKED, slot3: EMPTY }))
    await t.goto('slots')
    const focus = () => (t as unknown as { focus: { kind: string; index: number } }).focus
    expect(focus()).toEqual({ kind: 'slot', index: 0 })
    press('ArrowDown') // 可读的只有 slot1 一格 ⇒ m=1，绕回自己
    expect(focus()).toEqual({ kind: 'slot', index: 0 })
    const s = view(t)
    expect(s.match(/class="slot sel"/g)?.length, '选中记号只有一处').toBe(1)
    expect(s).toContain('<div class="slot sel"><div class="scard ok" data-slot="slot1"')
  })

  it('← / Escape 从挑档屏回定弦，不算一次决定', async () => {
    const { t, hit, press } = await screen(() => roster())
    await t.goto('slots')
    press('ArrowLeft')
    expect(view(t)).toContain('为她定一根弦')
    await t.goto('slots')
    press('Escape')
    expect(view(t)).toContain('为她定一根弦')
    expect(hit.news).toEqual([])
    expect(hit.continues).toEqual([])
  })

  it('定弦屏是根：Escape / B 那一记在根屏上一格效果都没有', async () => {
    const { t, hit, press } = await screen(() => roster())
    const before = view(t)
    press('Escape')
    expect(view(t), '根屏不许自己关掉自己：back 在 string 模式上不认任何一格').toBe(before)
    press('Backspace')
    press('Tab')
    expect(view(t)).toBe(before)
    expect(hit.news).toEqual([])
    expect(hit.continues).toEqual([])
  })

  it('根屏没有档可挑时按确认没有一格效果（没档的"续"不占 focus，不是漏接）', async () => {
    const { t, hit, press } = await screen(() => roster({
      autosave: EMPTY, slot1: EMPTY, slot2: EMPTY, slot3: EMPTY
    }))
    expect(view(t)).toContain('本机没有可续的存档')
    const before = view(t)
    press('Enter') // 焦点在卡上：无可续档 ⇒ 直接 onNew，不走确认屏
    expect(view(t), '没档时 onNew 直发，视图不变').toBe(before)
    expect(hit.news, 'onNew 已被调用').toHaveLength(1)
    hit.news.length = 0
    press('Escape') // 回根屏
    expect(view(t)).toBe(before)
    expect(hit.news, 'Escape 不再触发 onNew').toEqual([])
  })

it('全坏档的挑档屏：up 也不动一格（m=0 ⇒ 不许凭空选中空气）', async () => {
    const { t, press } = await screen(() => roster({
      autosave: BLOCKED, slot1: BLOCKED, slot2: BLOCKED, slot3: BLOCKED
    }))
    await t.goto('slots')
    expect(view(t)).toContain('挑一格 · Enter 读取 · ← 返回定弦')
    const focus = () => (t as unknown as { focus: { kind: string; index: number } }).focus
    const before = focus()
    press('ArrowUp') // 一格可读的都没有 ⇒ m=0 ⇒ 直接 return
    expect(focus(), '坏档不参与焦点：up 不许把焦点给空气').toEqual(before)
  })

  it('dispose() 之后 DOM 摘掉，而这一屏从来就不在 window 上挂 keydown（读数只有 uiStep 一个入口）', async () => {
    const { t, root, press, stats } = await screen(() => roster())
    expect(root.parent).toBe(body)
    expect(stats.titleKeydowns, '本屏自己挂的 keydown 数：读数只有 core/Input 那一条').toBe(0)
    expect(stats.inputKeydowns, 'Input 那一条要真在场上，否则 press 喂的是空气').toBe(1)
    const keydowns = (win.handlers.keydown ?? []).length
    t.dispose()
    expect(root.parent, 'DOM 节点摘掉').toBeNull()
    expect((win.handlers.keydown ?? []).length, 'Input 的那一只不归本屏摘：谁挂的谁摘').toBe(keydowns)
    const news = view(t)
    press('Enter')
    expect(view(t), 'dispose 之后 isOpen=false ⇒ 意图喂进来也不重画').toBe(news)
  })
})

describe('标题屏 · 点击收尾（back/new-yes/new-no）', () => {
  it('挑档屏点"返回定弦" ⇒ 回到定弦，不算决定', async () => {
    const { t, hit } = await screen(() => roster())
    const root = (t as unknown as { root: FakeEl }).root
    click(root, 'continue')
    expect(view(t)).toContain('返回定弦')
    click(root, 'back')
    expect(view(t)).toContain('为她定一根弦')
    expect(hit.news).toEqual([])
    expect(hit.continues).toEqual([])
  })

  it('确认屏点"确认开新弦" ⇒ 开的是被点的那一根；点"取消" ⇒ 回定弦谁也不开', async () => {
    const { t, hit } = await screen(() => roster())
    const root = (t as unknown as { root: FakeEl }).root
    click(root, 'card', 'origin_scavenger')
    expect(view(t)).toContain('开一根新弦')
    click(root, 'new-yes')
    expect(hit.news).toEqual(['origin_scavenger'])
    click(root, 'card', 'origin_drummer')
    click(root, 'new-no')
    expect(hit.news).toEqual(['origin_scavenger'])
    expect(view(t)).toContain('为她定一根弦')
  })

  it('点到不认识的动作 ⇒ 静默忽略，不算决定也不重画崩', async () => {
    const { t, hit } = await screen(() => roster())
    const root = (t as unknown as { root: FakeEl }).root
    click(root, 'bogus-action')
    expect(hit.news).toEqual([])
    expect(hit.continues).toEqual([])
  })
})

/**
 * 键盘腿的四条"没腿"分支：`uiStep` 的 switch 里那几个 `return`。
 * 挑档屏的 **up** 此前一条读方都没有（只有 down 被绕回过）；确认屏的 up/down、
 * 定弦屏"焦点在续上却没档可看"、以及 mode 撞上没接线的值，四条兜底各自钉死
 * "这一记什么也不许发生"——兜底的价值就在于它安静，而安静必须有人看着。
 */
describe('标题屏 · 键盘腿的兜底分支', () => {
  const focusOf = (t: unknown) => (t as unknown as { focus: { kind: string; index: number } }).focus

  it('挑档屏 up：焦点往回走一格，到顶绕回最后一格（down 的镜像）', async () => {
    const { t, press } = await screen(() => roster()) // 四格全可读 ⇒ m=4
    await t.goto('slots')
    expect(focusOf(t)).toEqual({ kind: 'slot', index: 0 })
    press('ArrowUp') // 0 上一格 ⇒ 绕到最后一格
    expect(focusOf(t)).toEqual({ kind: 'slot', index: 3 })
    press('ArrowUp')
    expect(focusOf(t), '一路往前挨着走，不跳格').toEqual({ kind: 'slot', index: 2 })
    press('ArrowDown') // 与 up 互为镜像，回来
    expect(focusOf(t)).toEqual({ kind: 'slot', index: 3 })
    const s = view(t)
    expect(s.match(/class="slot sel"/g)?.length, '选中记号只有一处').toBe(1)
  })

  it('确认屏 up/down 都不是左右：一动都不动，也不算决定', async () => {
    const { t, hit, press } = await screen(() => roster()) // 有可读档 ⇒ 点卡进确认屏
    const root = (t as unknown as { root: FakeEl }).root
    click(root, 'card', 'origin_tuner')
    expect(view(t)).toContain('开一根新弦')
    const before = view(t)
    press('ArrowUp')
    press('ArrowDown')
    expect(view(t), '确认屏只认左右：上下不该挪动默认项（破坏性动作的默认项必须是安全那一个）').toBe(before)
    expect(hit.news, '上下不是确认').toEqual([])
  })

  it('定弦屏确认而焦点在"续"上、却又没档可看 ⇒ 什么都不发生（string 的兜底）', async () => {
    // 今天构造上到不了这一格：焦点只在 canBrowseSlots 成立时才被搬到 continue 上。
    // 但它是 string 模式 confirm 的兜底——真落到这里时，这一记不许把屏开出去。
    const { t, hit, press } = await screen(() => roster({
      autosave: EMPTY, slot1: EMPTY, slot2: EMPTY, slot3: EMPTY
    }))
    ;(t as unknown as { focus: { kind: string; index: number } }).focus = { kind: 'continue', index: 0 }
    const before = view(t)
    press('Enter')
    expect(view(t), '没有档可挑 ⇒ 确认不开屏也不开弦').toBe(before)
    expect(hit.news).toEqual([])
    expect(hit.continues).toEqual([])
  })

  it('mode 撞上一个没接线的值 ⇒ 静默返回，不重画不崩', async () => {
    const { t, hit, press } = await screen(() => roster())
    const before = view(t)
    ;(t as unknown as { mode: string }).mode = 'not-a-mode'
    press('Enter')
    press('ArrowLeft')
    press('Escape')
    expect(view(t), '没接线的 mode 一记效果都没有，也不许把屏画坏').toBe(before)
    expect(hit.news).toEqual([])
    expect(hit.continues).toEqual([])
  })
})

/**
 * 出身卡面的**数据回落**（`titleCards`）与两条键盘腿。
 *
 * 卡面的四个 `??` 全是"表缺一格"时的安静退路：出身没写简介、找不到对应装备件、
 * 没写被动、属性表少一维。它们正常数据一条都不走（校验器盯着 origins 的完整性），
 * 漏了的后果是卡上出现 `undefined` 或一整行被动挂在空气上。
 * 合成表直接换进 registry 再换回来（try/finally），所以只动这一条用例看得到的世界。
 */
describe('标题屏 · 出身卡面的数据回落与预选', () => {
  /** 把 registry 里那一格换成合成值，返回还原函数（用例必须调用） */
  const swap = (id: string, value: unknown): (() => void) => {
    const data = (registry as unknown as { data: Map<string, unknown> }).data
    const prev = data.get(id)
    data.set(id, value)
    return () => { data.set(id, prev) }
  }

  it('出身缺简介 / 找不到装备件 / 没写被动 ⇒ 空串 / 武器 id / null（不许出现 undefined）', async () => {
    const { titleCards } = await import('@/ui/TitleScreen')
    const base = registry.get<ProgressionData>('progression')
    const undo = swap('progression', {
      ...base,
      origins: [{ id: 'origin_bare', displayName: '素衣', weaponId: 'wp_not_in_the_table', attrs: {} }],
    })
    try {
      const c = titleCards().find((x) => x.id === 'origin_bare')!
      expect(c.blurb, '没写简介 ⇒ 空串（卡上不写 undefined）').toBe('')
      expect(c.passive, '没写被动 ⇒ null ⇒ 那一行不渲染').toBeNull()
      expect(c.weaponName, '找不到装备件 ⇒ 回落武器 id（卡上不空着）').toBe('wp_not_in_the_table')
    } finally { undo() }
    expect(titleCards().length, '还原后仍是表里那五张').toBe(base.origins.length)
  })

  it('属性表少一维 ⇒ 那一段的标签回落键名，而不是空标签', async () => {
    const { titleCards } = await import('@/ui/TitleScreen')
    const base = registry.get<ProgressionData>('progression')
    const undo = swap('progression', { ...base, attrs: [] }) // 六维标签整表抽掉
    try {
      const c = titleCards()[0]
      expect(c.attrs.length, '六维一格都不能少（ATTR_KEYS 是顺序的主人）').toBe(6)
      for (const a of c.attrs) expect(a.label, '标签回落成键名').toMatch(/^[a-z]+$/)
    } finally { undo() }
  })

  it('构造时给了 preselect ⇒ 焦点直接落在那张卡上（?origin= 的落点）', async () => {
    const { TitleScreen, titleCards } = await import('@/ui/TitleScreen')
    const want = titleCards().findIndex((c) => c.id === 'origin_choir')
    const hooks: TitleHooks = {
      onNew: () => {}, onContinue: () => {}, listSlots: async () => roster()
    }
    const t = new TitleScreen(hooks, 'origin_choir')
    await new Promise((r) => setTimeout(r, 0))
    const focus = (t as unknown as { focus: { kind: string; index: number } }).focus
    expect(focus, '预选的那张卡就是焦点').toEqual({ kind: 'card', index: want })
    const s = view(t)
    expect(s.match(/class="card sel"/g)?.length, '选中记号只有一处').toBe(1)
    t.dispose()
  })

  it('定弦屏 ← 把焦点往回带一格，并向左绕回最后一张', async () => {
    const { t, press } = await screen(() => roster())
    const focus = () => (t as unknown as { focus: { kind: string; index: number } }).focus
    expect(focus(), '开局焦点在第一张').toEqual({ kind: 'card', index: 0 })
    press('ArrowLeft')
    expect(focus(), '第一张再往左 ⇒ 绕到最后一张（不是原地不动）').toEqual({ kind: 'card', index: 4 })
    press('ArrowRight')
    expect(focus(), '← 与 → 互为镜像').toEqual({ kind: 'card', index: 0 })
  })

  it('挑档屏只认上下/确认/后退：→ 那一记什么都不做', async () => {
    const { t, press } = await screen(() => roster())
    await t.goto('slots')
    const focus = () => (t as unknown as { focus: { kind: string; index: number } }).focus
    const before = focus()
    press('ArrowRight')
    expect(focus(), '挑档屏没有"下一列"可去').toEqual(before)
  })

  it('挑档屏确认而焦点越界（名册中途少了一格）⇒ 不续任何东西', async () => {
    const { t, hit, press } = await screen(() => roster())
    await t.goto('slots')
    ;(t as unknown as { focus: { kind: string; index: number } }).focus = { kind: 'slot', index: 99 }
    press('Enter')
    expect(hit.continues, '没有那一格 ⇒ 不许续一个 undefined').toEqual([])
    expect(view(t), '还留在挑档屏').toContain('挑一格')
  })

  it('确认屏走键盘：←/→ 挪默认项，确认落在"取消"上就回定弦、不算一次开弦', async () => {
    const { t, hit, press } = await screen(() => roster()) // 有可读档 ⇒ 点卡进确认屏
    const root = (t as unknown as { root: FakeEl }).root
    click(root, 'card', 'origin_tuner')
    expect(view(t)).toContain('开一根新弦')
    press('ArrowRight')
    press('Enter') // 默认项在"确认开新弦" ⇒ 这一下真的开
    expect(hit.news, '键盘确认与鼠标点击同一条 handler').toEqual(['origin_tuner'])

    click(root, 'card', 'origin_drummer')
    press('ArrowLeft')
    press('Enter') // 焦点回"取消" ⇒ 不开弦，屏退回定弦（取消就是"回去挑存档"）
    expect(hit.news, '按在取消上 ⇒ 不开弦').toEqual(['origin_tuner'])
    expect(view(t), '退回定弦屏').toContain('为她定一根弦')
    expect(view(t), '确认条不留在页上').not.toContain('确认开新弦')
  })
})
