import { beforeAll, describe, expect, it } from 'vitest'
import { registerGameData } from '@/data'
import { RpgRuntime } from '@/rpg/Runtime'
import type { SavePanelDeps } from '@/ui/Stakerite'

/**
 * KI-061：调音桩面板的键盘导航（ui-ux.md §218「方向键 + 肩键切页 + Back 永远后退一层 + 焦点记忆」）
 * 与它顺手抓出的那条关闭冻结 bug。
 *
 * 为什么这一份测试值得单独存在：面板的鼠标那条路一直有人按（`stakerite.test.ts` 点得动），
 * 键盘那条路没有——而 §242 的出口清单问的是"全路径可达？"。更糟的是遮罩点击那条 close 分支
 * 只摘 DOM、不归还 `time.paused` / `input.enabled`：**点一下背景 = 把游戏冻在看不见的地冻里**，
 * 事后按 Esc 也只解开一半（`input.enabled` 只有 `setPanelOpen` 那处会恢复）。
 * 所以这里既量导航，也量"关闭只有一个主人"。
 */

registerGameData()

class FakeEl {
  innerHTML = ''
  dataset: Record<string, string> = {}
  private classes = new Set<string>()
  handlers: Record<string, ((e: unknown) => void)[]> = {}
  classList = {
    add: (c: string): void => { this.classes.add(c) },
    remove: (c: string): void => { this.classes.delete(c) },
    contains: (c: string): boolean => this.classes.has(c),
  }
  style = { textContent: '' }
  appendChild(c: FakeEl): FakeEl { return c }
  addEventListener(t: string, fn: (e: unknown) => void): void { (this.handlers[t] ??= []).push(fn) }
  dispatch(t: string, e: unknown): void { for (const fn of this.handlers[t] ?? []) fn(e) }
  requestPointerLock(): void { /* 指针锁定与导航无关 */ }
}

let win: Record<string, ((e: unknown) => void)[]> = {}
beforeAll(() => {
  win = {}
  const g = globalThis as unknown as Record<string, unknown>
  g.document = {
    createElement: () => new FakeEl(), head: new FakeEl(), body: new FakeEl(), getElementById: () => new FakeEl(),
  }
  g.window = { addEventListener: (t: string, fn: (e: unknown) => void): void => { (win[t] ??= []).push(fn) } }
})

/**
 * 面板的读数入口只有一个：`uiStep(意图集合)`（KI-062）。
 * 键盘码/手柄按钮怎么折成这些意图，是 `tests/unit/ui-intents.test.ts` 的事——
 * 这份文件只管"意图落到走行/走页/执行/后退上"的语义，两边各测各的，谁坏谁知道。
 */
const step = (p: object, ...intents: string[]): void =>
  (p as { uiStep(i: ReadonlySet<string>): void }).uiStep(new Set(intents))

const NO_SAVES: SavePanelDeps = { list: async () => [], write: async () => null, erase: async () => false }

type Panel = { root: FakeEl }
const htmlOf = (p: object): string => (p as unknown as Panel).root.innerHTML

/** 这一页里"可被选中的行"有几个：与面板 `navRows` 同一份谓词（遮罩与页签不算行） */
const rowTags = (html: string): { act: string; arg: string; disabled: boolean }[] => (html.match(/<button\b[^>]*>/g) ?? [])
  .map((t) => ({
    act: t.match(/data-act="([^"]*)"/)?.[1] ?? '',
    arg: t.match(/data-arg="([^"]*)"/)?.[1] ?? '',
    disabled: /\bdisabled\b/.test(t),
  }))
  .filter((r) => r.act && r.act !== 'close' && r.act !== 'tab')

/** 焦点框现在落在第几行（-1 = 还没有焦点框） */
const focusIndex = (html: string): number => {
  const tags = (html.match(/<button\b[^>]*>/g) ?? []).filter((t) => {
    const a = t.match(/data-act="([^"]*)"/)?.[1]
    return !!a && a !== 'close' && a !== 'tab'
  })
  return tags.findIndex((t) => /class="[^"]*focus/.test(t))
}

async function makePanel(): Promise<{ rt: RpgRuntime; p: object; closes: number[] }> {
  const { Stakerite } = await import('@/ui/Stakerite')
  const rt = new RpgRuntime('origin_tuner', 11)
  const closes: number[] = []
  const p = new Stakerite(rt, {
    onApply: () => {}, notify: () => {}, onUse: () => {}, onRequestClose: () => closes.push(1),
  }, NO_SAVES)
  return { rt, p, closes }
}

/**
 * 按到焦点落在某个动作上为止（不猜行号：行号由渲染决定，测试只认 data-act）。
 * `skipDisabled` 是给"我要点的那个按钮必须真的能点"用的：装备页里身上那件的按钮是 disabled 的，
 * 停在它上面按 Enter 本来就该什么都不发生（另一条用例正钉着这件事）。
 */
async function focusOn(p: object, act: string, skipDisabled = false): Promise<number> {
  for (let i = 0; i < 60; i++) {
    step(p,'down')
    const rows = rowTags(htmlOf(p))
    const idx = focusIndex(htmlOf(p))
    const row = rows[idx]
    if (row && row.act === act && (!skipDisabled || !row.disabled)) return idx
  }
  return -1
}

describe('KI-061 面板键盘导航（§218 方向键 / 焦点记忆 / Back）', () => {
  it('↑↓ 移动焦点框；第一行往上按是回绕到最后一行；没按过导航键之前不该有框', async () => {
    const { p } = await makePanel()
    ;(p as { show(): void }).show()
    expect(focusIndex(htmlOf(p)), '鼠标用户一打开就看见一个孤零零的框 = 不该').toBe(-1)
    step(p,'down')
    expect(focusIndex(htmlOf(p))).toBe(0)
    step(p,'up')
    expect(focusIndex(htmlOf(p)), '列表是环：回绕到最后一行').toBe(rowTags(htmlOf(p)).length - 1)
  })

  it('焦点记忆是**按页**记的：切走再切回来，还站在刚才那一行', async () => {
    const { p } = await makePanel()
    ;(p as { show(): void }).show()
    // 第一次按方向键只是把框亮出来（停在记住的那行），之后每一按挪一格
    step(p,'down'); step(p,'down'); step(p,'down')
    const stuck = focusIndex(htmlOf(p))
    expect(stuck, '三按 = 从第 0 行走到第 2 行').toBe(2)
    step(p,'right')
    expect(focusIndex(htmlOf(p)), '新页从自己的第一行开始，不继承上一页').toBe(0)
    step(p,'down'); step(p,'down')
    step(p,'left')
    expect(focusIndex(htmlOf(p)), '回到上一页时该记住上次停在哪').toBe(stuck)
  })

  it('Enter 点的就是被框住那一行：装备页真的把这件穿上（走的是和鼠标同一个 handler）', async () => {
    const { p, rt } = await makePanel()
    // 换到装备页（TABS 的第二页）
    ;(p as { show(): void }).show()
    step(p,'right')
    // 出身 kit 是一身全穿的（那是开局该有的样子），所以"没穿的那件"得自己带进来
    const spare = rt.inv.addGear('ar_choir_hood', 0, [])
    const unworn = rt.inv.gears.find((g) => !Object.values(rt.eq.slots).includes(g.uid))
    expect(unworn?.uid, '夹具得有一件没穿的').toBe(spare.uid)
    const idx = await focusOn(p, 'equip', true)
    expect(idx, '装备页里该能聚焦到"装备"这一行').toBeGreaterThanOrEqual(0)
    // 断言"就是被框住的那一件被穿上了"，而不是"槽位动了"——后者在执行第 0 行的实现下也成立
    const target = rowTags(htmlOf(p))[idx].arg
    const before = JSON.stringify(rt.eq.slots)
    step(p,'confirm')
    expect(JSON.stringify(rt.eq.slots), 'Enter 真的换了装备').not.toBe(before)
    expect(Object.values(rt.eq.slots), '被框住的那一件才是被穿上的一件').toContain(target)
  })

  it('禁用的行可以被选中，但不许被 Enter 执行（鼠标那条有浏览器挡着，键盘这条没人挡）', async () => {
    const { p, rt } = await makePanel()
    ;(p as { show(): void }).show()
    step(p,'right')                       // 装备页：身上那件的"分解"是 disabled 的
    const worn = rt.inv.gears.find((g) => Object.values(rt.eq.slots).includes(g.uid))!
    const idx = await focusOn(p, 'salvage')   // 先停在**禁用**的那一行上（第一件就是身上那件）
    expect(idx, '装备页该能聚焦到"分解"这一行').toBeGreaterThanOrEqual(0)
    const rows = rowTags(htmlOf(p))
    expect(rows[idx].disabled, '身上那件的分解按钮是禁用的').toBe(true)
    expect(rows[idx].arg, '而且它就是身上那件').toBe(worn.uid)
    const gears = rt.inv.gears.length
    step(p,'confirm')
    expect(rt.inv.gears.length, 'Enter 点禁用的分解 ⇒ 一件装备都不许消失（rpg 层可没有"身上这件不能拆"这道闸）').toBe(gears)
    expect(Object.values(rt.eq.slots).includes(worn.uid), '那件也仍然穿在身上').toBe(true)
  })

  it('后退只有一个出口：Backspace 只是**提出请求**，收面板与解冻都由持有者做', async () => {
    const { p, closes } = await makePanel()
    ;(p as { show(): void }).show()
    step(p,'back')
    expect(closes.length, '面板不许自己 hide 自己').toBe(1)
    expect((p as { isOpen: boolean }).isOpen, '在持有者真的关掉之前，面板仍然算开着').toBe(true)
  })

  it('遮罩点击走的也是同一个出口（那条直接 close() 的老路就是把游戏冻死的元凶）', async () => {
    const { p, closes } = await makePanel()
    ;(p as { show(): void }).show()
    const root = (p as unknown as Panel).root
    root.dispatch('click', { target: { closest: () => ({ dataset: { act: 'close', arg: '' }, disabled: false }) } })
    expect(closes.length).toBe(1)
    root.dispatch('click', { target: { closest: () => ({ dataset: { act: 'tab', arg: 'bag' }, disabled: false }) } })
    expect((p as { tab: string }).tab, '页签照旧是面板自己的事（它不改世界状态）').toBe('bag')
  })

  it('行的定义只有一处：调音页恰好是"六维 +1 洗点"七行，页签与遮罩都不算行', async () => {
    const { p } = await makePanel()
    ;(p as { show(): void }).show()
    expect(rowTags(htmlOf(p)).length, '六维 + 洗点 = 7 行；把页签算进来就会变成 13').toBe(7)
    step(p,'down')
    const focused = (htmlOf(p).match(/<button\b[^>]*>/g) ?? []).find((t) => /class="[^"]*focus/.test(t)) ?? ''
    expect(focused, '按过 down 之后必须真有一个带焦点框的行（空串会让下面那条断言拿着不存在的东西白过）').not.toBe('')
    expect(focused, '焦点框不许落在页签或遮罩上').not.toMatch(/data-act="tab"|data-act="close"/)
  })

  it('行清单是从渲染产物里数的：包里多一件装备，重新打开后可选行数跟着长', async () => {
    const { p, rt } = await makePanel()
    ;(p as { show(): void }).show()
    step(p,'right')                      // 装备页：行数是"包里的件数 × 三个按钮"，多一件就多三行
    const before = rowTags(htmlOf(p)).length
    rt.inv.addGear('ar_choir_hood', 0, [])
    ;(p as { close(): void }).close()
    ;(p as { show(): void }).show()   // 重新打开仍在装备页（页是记着的），行数就是那一页的行数
    expect(rowTags(htmlOf(p)).length, '多一件就是多一行（数错行 = 焦点全体错位）').toBeGreaterThan(before)
  })
})
