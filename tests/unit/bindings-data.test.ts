import { describe, expect, it } from 'vitest'
import {
  BINDABLE_ACTIONS, DEFAULT_BINDS, UI_BINDS, UI_INTENTS, keyOf,
  type ActionName, type Bindings, type UiIntent
} from '@/core/Input'
import { BindingsStore, BIND_BOUNDS, clampBindings, defaultBindings } from '@/settings/Bindings'

/**
 * KI-336：键位绑定变成数据之后的**数据半格**守卫。
 *
 * 这一份只管形状与信任边界（`clampBindings` / `BindingsStore` / 名册的来源），
 * 运行时换表与"改键之后屏幕不说谎"在 `tests/flow/bindings-remap.test.ts`。
 *
 * `raw` 在这里一律当成**玩家手改过的存档**：`Integrity` 的校验和只防截断，不防恶意，
 * 所以这一组的判据不是"能不能装出想要的键位"，而是"任何 blob 都只能装出玩得下去的那张表"。
 */

describe('KI-336 名册与默认快照：只有一个主人', () => {
  it('动作名册从默认表现推，且默认键盘表是一张双射（整套回补规则的立足点）', () => {
    const fromTable = [...new Set(Object.values(DEFAULT_BINDS.keyboard))]
    expect([...BINDABLE_ACTIONS].sort(), '名册必须等于默认键盘表的值集合——多一格是没绑定的动作，少一格是抄写漂移')
      .toEqual(fromTable.sort())
    expect(new Set(Object.keys(DEFAULT_BINDS.keyboard)).size, '一码两动作：DOM 查表的答案会变成插入序')
      .toBe(Object.keys(DEFAULT_BINDS.keyboard).length)
    expect(fromTable.length, '一动作两码：keyOf 的第一条命中会变成第二个主人').toBe(BINDABLE_ACTIONS.length)
    for (const v of Object.values(DEFAULT_BINDS.padButtons)) {
      expect(BINDABLE_ACTIONS, `手柄表里的 ${v} 不在名册上`).toContain(v)
    }
  })

  it('意图名册同样从 UI 默认表现推（菜单那条不折叠，等价键是设计）', () => {
    for (const v of Object.values(UI_BINDS.keyboard)) expect(UI_INTENTS).toContain(v)
    for (const v of Object.values(UI_BINDS.padButtons)) expect(UI_INTENTS).toContain(v)
    expect(new Set(UI_INTENTS).size, '名册自己不许有重复格子').toBe(UI_INTENTS.length)
  })

  it('默认快照是现推的深拷贝：改副本碰不到原件，改原件下一份快照跟着走', () => {
    const a = defaultBindings()
    expect(a.gameplay.keyboard, '玩法键盘那张逐字等于默认表').toEqual(DEFAULT_BINDS.keyboard)
    expect(a.ui.keyboard).toEqual(UI_BINDS.keyboard)
    expect(a.gameplay.padAxes, 'padAxes 也必须是副本（嵌套那格最容易漏抄）').not.toBe(DEFAULT_BINDS.padAxes)
    a.gameplay.keyboard.KeyW = 'dodge'
    a.ui.keyboard.Tab = 'confirm'
    a.gameplay.padAxes.moveX = 7
    expect(DEFAULT_BINDS.keyboard.KeyW, '默认表的主人只有一个：core/Input.ts').toBe('moveUp')
    expect(UI_BINDS.keyboard.Tab).toBe('back')
    expect(DEFAULT_BINDS.padAxes.moveX).toBe(0)
    expect(defaultBindings().gameplay.keyboard.KeyW, '下一次现推仍是原件').toBe('moveUp')
  })
})

describe('KI-336 clampBindings：任何 blob 只能装出玩得下去的那张表', () => {
  it('全缺 / 错型 / 数组 ⇒ 逐格默认（老档没这块、手改成任何东西都不炸）', () => {
    for (const junk of [undefined, null, 'junk', 42, [], true]) {
      expect(clampBindings(junk), `raw＝${String(junk)}`).toEqual(defaultBindings())
    }
  })

  it('半张表也补得满：只有键盘半边的 blob ⇒ ui 那半边回默认，不是缺着', () => {
    const out = clampBindings({ gameplay: { keyboard: { KeyQ: 'dodge' } } })
    expect(out.ui).toEqual(UI_BINDS)
    expect(out.gameplay.padAxes).toEqual(DEFAULT_BINDS.padAxes)
    expect(out.gameplay.padButtons, '缺块 = 照默认："没写"读成"清空"会让手柄凭空失灵').toEqual(DEFAULT_BINDS.padButtons)
    const explicit = clampBindings({ gameplay: { keyboard: { KeyQ: 'dodge' }, padButtons: {} } })
    expect(explicit.gameplay.padButtons, '写了空表 = 如实空表，与缺块不是一个意思').toEqual({})
    for (const a of BINDABLE_ACTIONS) expect(keyOf(a, explicit.gameplay), '摘光手柄之后每个动作仍有键盘键').not.toBeNull()
  })

  it('名册外的动作名不是外挂：`fly` 那一格落榜，Q 仍然归它的默认主人', () => {
    const out = clampBindings({ gameplay: { keyboard: { KeyQ: 'fly' } } })
    expect(out.gameplay.keyboard.KeyQ, '丢格之后 Q 是空的 ⇒ lockOn 回自己的默认格').toBe('lockOn')
    expect(Object.values(out.gameplay.keyboard), '整张表里没有一个 fly').not.toContain('fly' as ActionName)
  })

  it('码的语法闸门顺带挡住毒键：`__proto__` / `constructor` / 空串 / `<img>` 一格都进不来', () => {
    const raw = JSON.parse('{"gameplay":{"keyboard":{"__proto__":{"polluted":1},"constructor":"dodge","prototype":"jump","":"nothing","KeyQ":"lockOn","<img>":"parry"}}}')
    const out = clampBindings(raw)
    expect(({} as Record<string, unknown>).polluted, '原型链没被写过').toBeUndefined()
    expect(Object.getPrototypeOf(out.gameplay.keyboard), '返回值仍是普通对象').toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(out.gameplay.keyboard, 'constructor'), 'constructor 那格根本没进表').toBe(false)
    expect(Object.prototype.hasOwnProperty.call(out.gameplay.keyboard, 'prototype'), 'prototype 同上').toBe(false)
    expect(Object.keys(out.gameplay.keyboard), '空串与 `<img>` 都过不了语法').not.toContain('<img>')
    expect(out.gameplay.keyboard.KeyQ, '合法那格照常生效').toBe('lockOn')
  })

  it('不存在的物理键不危险，只是一条没人按得到的死绑定（全表要的是名册一致，不是键盘真伪）', () => {
    const out = clampBindings({ gameplay: { keyboard: { KeyY: 'observe' } } })
    expect(out.gameplay.keyboard.KeyY).toBe('observe')
    expect(keyOf('observe', out.gameplay), '显示跟着表走：这一格从此是 Y').toBe('Y')
    for (const a of BINDABLE_ACTIONS) expect(keyOf(a, out.gameplay), `${a} 仍有一把键`).not.toBeNull()
  })

  it('`{KeyQ: \'dodge\'}` 是一次交换，不是一排搬家（dodge→Q，lockOn 落进 dodge 腾出的 Ctrl，其余照旧）', () => {
    const out = clampBindings({ gameplay: { keyboard: { KeyQ: 'dodge' } } })
    expect(out.gameplay.keyboard.KeyQ).toBe('dodge')
    expect(out.gameplay.keyboard.ControlLeft, 'lockOn 落在腾出来的那一格，而不是 Digit1').toBe('lockOn')
    const moved = Object.keys(out.gameplay.keyboard).filter((c) => out.gameplay.keyboard[c] !== DEFAULT_BINDS.keyboard[c])
    expect(moved.sort(), '整张表只有这两格换了主人').toEqual(['ControlLeft', 'KeyQ'])
  })

  it('删格 = 恢复默认，不是解绑：只留一格的 blob 会让其余 21 格全部回到默认', () => {
    const out = clampBindings({ gameplay: { keyboard: { KeyE: 'interact' } } })
    expect(out.gameplay.keyboard, '默认表本来就是"每格都被自己人认领"').toEqual(DEFAULT_BINDS.keyboard)
  })

  it('一份档抢两把键：只留一把（默认那把优先），另一个动作不因此失联', () => {
    const out = clampBindings({ gameplay: { keyboard: { KeyR: 'dodge', KeyQ: 'dodge' } } })
    const claims = Object.keys(out.gameplay.keyboard).filter((c) => out.gameplay.keyboard[c] === 'dodge')
    expect(claims, '一动作两把键会让 keyOf 的第一条命中变成第二个主人').toEqual(['KeyQ'])
    expect(keyOf('dodge', out.gameplay), '显示读的就是这一把').toBe('Q')
    expect(out.gameplay.keyboard.KeyR, 'R 腾出来之后仍归它的默认主人').toBe('weaponSkill')
  })

  it('菜单那条不折叠：confirm 的四把等价键在默认表上是设计，不是冲突', () => {
    const out = clampBindings(defaultBindings())
    const confirm = Object.keys(out.ui.keyboard).filter((c) => out.ui.keyboard[c] === 'confirm')
    expect(confirm.sort()).toEqual(['Enter', 'KeyE', 'NumpadEnter', 'Space'])
  })

  it('菜单那条"点了名的值整组换、没点名的整组回"：`{Enter:\'back\'}` 里 confirm 仍是三把', () => {
    const out = clampBindings({ ui: { keyboard: { Enter: 'back' } } })
    const codes = (intent: UiIntent): string[] => Object.keys(out.ui.keyboard).filter((c) => out.ui.keyboard[c] === intent).sort()
    expect(codes('back'), '说了 back = back 只有 Enter 这一把（raw 是整张，不是追加）').toEqual(['Enter'])
    expect(codes('confirm'), '没点名 confirm ⇒ 它四把里还空着的三把一起回来，不会缩成一把').toEqual(['KeyE', 'NumpadEnter', 'Space'])
    expect(out.ui.keyboard.Backspace, 'back 腾出来的格子没人抢就空着——回填是给失联者准备的').toBeUndefined()
    for (const i of UI_INTENTS) expect(Object.values(out.ui.keyboard), `${i} 仍有路`).toContain(i)
  })

  it('不失联（三格狠档各量一次）：每个有默认家的动作仍有一把键，意图一个都不落空', () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUV'
    const hostile = [
      // ① 全删：两张键盘表都空着
      { gameplay: { keyboard: {} }, ui: { keyboard: {} } },
      // ② 22 个动作各占一把默认表用过的字母键（KeyA…KeyV 与默认表重叠 ⇒ 一路搬家）
      { gameplay: { keyboard: Object.fromEntries(BINDABLE_ACTIONS.map((a, i) => [`Key${letters[i]}`, a])) } },
      // ③ 一个动作吃掉所有键
      { gameplay: { keyboard: Object.fromEntries(Object.keys(DEFAULT_BINDS.keyboard).map((c) => [c, 'dodge'])) } }
    ]
    for (const raw of hostile) {
      const out = clampBindings(raw)
      for (const a of BINDABLE_ACTIONS) {
        expect(Object.values(out.gameplay.keyboard), `${a} 必须还有一把键（${JSON.stringify(Object.keys(raw))}）`).toContain(a)
      }
      for (const i of UI_INTENTS) {
        expect(Object.values(out.ui.keyboard), `${i} 不许被档锁死`).toContain(i)
      }
    }
  })

  it('幂等（存档往返不漂移）：clamp(clamp(x)) 与 clamp(x) 逐字相等', () => {
    const once = clampBindings({ gameplay: { keyboard: { KeyQ: 'dodge', KeyE: 'guard' } }, ui: { keyboard: { KeyZ: 'back' }, stickThreshold: 0.4 } })
    expect(clampBindings(once), '第二次夹取一格都不该再动').toEqual(once)
    expect(clampBindings(defaultBindings())).toEqual(defaultBindings())
  })

  it('同一个内容的两种键序 ⇒ 同一个结果（插入序不是第二个主人）', () => {
    const pairs: Array<[string, string]> = [['KeyQ', 'dodge'], ['ControlLeft', 'lockOn'], ['KeyG', 'parry']]
    const fwd = clampBindings({ gameplay: { keyboard: Object.fromEntries(pairs) } })
    const rev = clampBindings({ gameplay: { keyboard: Object.fromEntries([...pairs].reverse()) } })
    expect(rev).toEqual(fwd)
    expect(Object.keys(fwd.gameplay.keyboard), '落表按码序写').toEqual([...Object.keys(fwd.gameplay.keyboard)].sort())
  })

  it('手柄那张：下标越界与非整数落榜，多路共用一键（0 与 12 都闪避）不当冲突删', () => {
    const out = clampBindings({ gameplay: { padButtons: { 0: 'dodge', 12: 'dodge', 19: 'jump', 20: 'jump', 3.5: 'parry', '-1': 'guard', 9: 'nope' } } })
    expect(out.gameplay.padButtons[0]).toBe('dodge')
    expect(out.gameplay.padButtons[12], '等价的第二把路不是冲突').toBe('dodge')
    expect(out.gameplay.padButtons[19], `上界 ${BIND_BOUNDS.padButtonMax}`).toBe('jump')
    expect(out.gameplay.padButtons[20], '20 不是物理键').toBeUndefined()
    expect(out.gameplay.padButtons[-1]).toBeUndefined()
    expect(Object.values(out.gameplay.padButtons)).not.toContain('nope' as ActionName)
  })

  it('轴下标：四格不许两根共用一个传感器，越界与错型各回默认', () => {
    const same = clampBindings({ gameplay: { padAxes: { moveX: 0, moveY: 0, camX: 2, camY: 3 } } })
    expect(same.gameplay.padAxes, 'moveX/moveY 同轴 ⇒ 整块回默认（走路与转镜头读同一个传感器的形状不许活着）')
      .toEqual(DEFAULT_BINDS.padAxes)
    const bad = clampBindings({ gameplay: { padAxes: { moveX: '0', moveY: 99, camX: 2, camY: 3 } } })
    expect(bad.gameplay.padAxes, '两格都落榜 ⇒ 又撞成同轴 ⇒ 整块回默认').toEqual(DEFAULT_BINDS.padAxes)
    const ok = clampBindings({ gameplay: { padAxes: { moveX: 4, moveY: 5, camX: 2, camY: 3 } } })
    expect(ok.gameplay.padAxes).toEqual({ moveX: 4, moveY: 5, camX: 2, camY: 3 })
  })

  it('摇杆阈值有界：0.1 与 1.4 被夹进 0.25–0.9，错型与 NaN 回默认', () => {
    expect(clampBindings({ ui: { stickThreshold: 0.1 } }).ui.stickThreshold).toBe(BIND_BOUNDS.stickThreshold.min)
    expect(clampBindings({ ui: { stickThreshold: 1.4 } }).ui.stickThreshold).toBe(BIND_BOUNDS.stickThreshold.max)
    expect(clampBindings({ ui: { stickThreshold: 0.42 } }).ui.stickThreshold).toBe(0.42)
    for (const junk of ['x', null, NaN, Infinity, undefined]) {
      expect(clampBindings({ ui: { stickThreshold: junk } }).ui.stickThreshold, String(junk)).toBe(UI_BINDS.stickThreshold)
    }
  })
})

describe('KI-336 BindingsStore：设置→消费者的那根线', () => {
  function target() {
    const applied: Bindings[] = []
    return { applied, input: { setBindings: (b: Bindings): void => { applied.push(b) } } }
  }

  it('构造即灌一遍当前值（与 GameplaySettingsStore 同一位子）', () => {
    const t = target()
    const store = new BindingsStore(t)
    expect(store.get()).toEqual(defaultBindings())
    expect(t.applied.length, '一次构造一次灌注').toBe(1)
  })

  it('set 按块深合并：只调阈值不会把键位清空', () => {
    const t = target()
    const store = new BindingsStore(t)
    store.set({ ui: { stickThreshold: 0.7 } })
    expect(store.get().ui.stickThreshold).toBe(0.7)
    expect(store.get().gameplay.keyboard, '玩法那张一格都不该动').toEqual(DEFAULT_BINDS.keyboard)
    expect(store.get().ui.keyboard).toEqual(UI_BINDS.keyboard)
  })

  it('set 走信任边界：越界与错型先夹取再灌，消费者见不到界外的数', () => {
    const t = target()
    const store = new BindingsStore(t)
    // `'fly'` 不在名册上 ⇒ 绕过类型再交：类型是下一批那个 UI 的扶手，界外的值本来就从 `unknown` 那一侧来
    store.set({ ui: { stickThreshold: 99 }, gameplay: { keyboard: { KeyQ: 'fly' } as unknown as Record<string, ActionName> } })
    expect(store.get().ui.stickThreshold).toBe(BIND_BOUNDS.stickThreshold.max)
    expect(Object.values(store.get().gameplay.keyboard)).not.toContain('fly' as ActionName)
    expect(t.applied.at(-1), '灌进消费者的就是夹取之后的那一份').toEqual(store.get())
  })

  it('restore(undefined/null)（老档没这块）⇒ 一格都不动，也不第二次灌注', () => {
    const t = target()
    const store = new BindingsStore(t)
    store.set({ ui: { stickThreshold: 0.33 } })
    const before = t.applied.length
    store.restore(undefined)
    store.restore(null)
    expect(store.get().ui.stickThreshold, '留空是如实，不是"重置成默认"（默认 0.55）').toBe(0.33)
    expect(t.applied.length, '不动就不许再灌一遍').toBe(before)
  })

  it('restore 是**整张表**不是补丁：手柄那张写了空表就空着（存档写的本来就是整张）', () => {
    const t = target()
    const store = new BindingsStore(t)
    store.restore({ gameplay: { keyboard: { KeyQ: 'dodge' }, padButtons: {} } })
    expect(store.get().gameplay.keyboard.KeyQ).toBe('dodge')
    expect(store.get().gameplay.padButtons, 'raw 写了空手柄表 ⇒ 这张表里没有手柄键，但动作仍从键盘那条有路').toEqual({})
    expect(store.get().ui.stickThreshold, '而 raw 没写的 ui 整块照默认（缺块 ≠ 清空）').toBe(UI_BINDS.stickThreshold)
    for (const a of BINDABLE_ACTIONS) expect(keyOf(a, store.get().gameplay), `${a} 仍然有键`).not.toBeNull()
  })

  it('get 交出去的是副本：外面乱改动不到 store，也动不到上一次的灌注值', () => {
    const t = target()
    const store = new BindingsStore(t)
    const g = store.get()
    g.gameplay.keyboard.KeyW = 'parry'
    g.ui.padButtons[0] = 'back'
    expect(store.get().gameplay.keyboard.KeyW).toBe('moveUp')
    expect(t.applied.at(-1)!.ui.padButtons[0]).toBe('confirm')
  })

  it('targets 为 null（只想要数据形状的世界）⇒ 存得改得，不灌任何消费者', () => {
    const store = new BindingsStore(null)
    store.set({ ui: { stickThreshold: 0.5 } })
    expect(store.get().ui.stickThreshold).toBe(0.5)
  })
})

describe('KI-336 意图名册的换算仍只有一处', () => {
  it('`UiIntent` 的名册覆盖八格导航 + 九格直选（类型与值同一来源）', () => {
    const nav: UiIntent[] = ['up', 'down', 'left', 'right', 'confirm', 'back', 'pagePrev', 'pageNext']
    for (const n of nav) expect(UI_INTENTS).toContain(n)
    for (let i = 1; i <= 9; i++) expect(UI_INTENTS).toContain(`pick${i}` as UiIntent)
    expect(UI_INTENTS.length, '8 + 9 = 全值域，多一格少一格都是抄写漂移').toBe(17)
  })
})

/**
 * KI-337：「操作」页按下去之后，store 这一侧的三把手。
 * 页面上那一格「改键」在数据层就是 `rebind` 一句——它不许变成"面板自己拼一张表"，
 * 因为拼表要读默认值与界，那两个主人各在别处（`defaultBindings()` / `clampBindings`）。
 * 这三条腿读的是**同一张表的搬运规则**，运行时换表在 `tests/flow/bindings-remap.test.ts`。
 */
describe('KI-337 store 三把手：rebind / resetKey / restoreDefaults', () => {
  function rig() {
    const applied: Bindings[] = []
    const store = new BindingsStore({ input: { setBindings: (b: Bindings): void => { applied.push(b) } } })
    return { store, applied }
  }
  /** 与默认表逐格相比，**动了哪几格**（两张码的并集：新增的格也算动了） */
  const moved = (kb: Record<string, ActionName>): string[] => {
    const codes = new Set([...Object.keys(DEFAULT_BINDS.keyboard), ...Object.keys(kb)])
    return [...codes].filter((c) => kb[c] !== DEFAULT_BINDS.keyboard[c]).sort()
  }

  it('rebind 只动那一格：闪避挪去 Y 之后，其余 21 个动作仍各在自己的默认键上', () => {
    const { store, applied } = rig()
    store.rebind('dodge', 'KeyY')
    const kb = store.get().gameplay.keyboard
    expect(kb.KeyY).toBe('dodge')
    expect(kb.ControlLeft, '腾出来的那一格是空的，不是"留给谁的默认"').toBeUndefined()
    expect(moved(kb), '整张表只有这两格换了主人（一次改键 ≠ 一排搬家）').toEqual(['ControlLeft', 'KeyY'])
    for (const a of BINDABLE_ACTIONS) {
      expect(Object.keys(kb).filter((c) => kb[c] === a), `${a} 仍恰好有一把键（两把会让 keyOf 的第一条命中变成第二个主人）`)
        .toHaveLength(1)
    }
    expect(applied.length, '一次改键一次灌注').toBe(2)
  })

  it('rebind 到一把被人占着的键 = 一次交换，不是把原主人删掉', () => {
    const { store } = rig()
    store.rebind('dodge', 'KeyQ')   // Q 原本是 lockOn 的默认格
    const kb = store.get().gameplay.keyboard
    expect(kb.KeyQ).toBe('dodge')
    expect(kb.ControlLeft, 'lockOn 落进 dodge 腾出的那一格 ⇒ 交换的两半由同一条规则算出').toBe('lockOn')
    expect(moved(kb)).toEqual(['ControlLeft', 'KeyQ'])
    expect(store.get().gameplay.padButtons, '改键盘不许顺手动那张手柄表').toEqual(DEFAULT_BINDS.padButtons)
    expect(store.get().ui, '也不许顺手动菜单那条').toEqual(UI_BINDS)
  })

  it('rebind 走同一道语法闸门：把 `__proto__` / 空串 / `<img>` 当键名 ⇒ 一格都不动', () => {
    const { store, applied } = rig()
    for (const junk of ['__proto__', 'constructor', 'prototype', '', '<img>', 'MediaNextTrack']) {
      const before = applied.length
      store.rebind('dodge', junk)
      expect(store.get().gameplay.keyboard, `码名「${JSON.stringify(junk)}」过不了语法 ⇒ 回默认格，且不留死绑定`)
        .toEqual(DEFAULT_BINDS.keyboard)
      expect(Object.getPrototypeOf(store.get().gameplay.keyboard), '原型没被写过').toBe(Object.prototype)
      expect(applied.length, '夹取之后照样灌一次（一次动作一个主人，不做"看起来没变就不灌"那种优化）').toBe(before + 1)
    }
  })

  it('resetKey 把那一格送回它在默认表上的家：交换过之后整张逐字回默认', () => {
    const { store } = rig()
    store.rebind('dodge', 'KeyQ')
    expect(moved(store.get().gameplay.keyboard), '先确认确实交换过').toEqual(['ControlLeft', 'KeyQ'])
    store.resetKey('dodge')
    expect(store.get().gameplay.keyboard, '回默认走的是同一条 rebind ⇒ lockOn 也一起回到 Q').toEqual(DEFAULT_BINDS.keyboard)
  })

  it('一行回默认不许抹平另一行：玩家自己挪过的那一格留着', () => {
    const { store } = rig()
    store.rebind('parry', 'KeyY')
    store.resetKey('dodge')     // dodge 本来就在家里 ⇒ 不该有副作用
    const kb = store.get().gameplay.keyboard
    expect(kb.KeyY, '弹反仍在玩家给它的那把键上（"回默认"是逐行的，不是整张的别名）').toBe('parry')
    expect(kb.ControlLeft).toBe('dodge')
    expect(kb.KeyG, '腾出来的 G 空着：回填那一遍只替失联的动作跑腿').toBeUndefined()
  })

  it('resetKey 认不出名册外的名字 ⇒ 一格都不动、一次都不灌（`data-arg` 是字符串，DOM 那侧谁都能写）', () => {
    const { store, applied } = rig()
    store.resetKey('fly' as ActionName)
    expect(store.get()).toEqual(defaultBindings())
    expect(applied.length, '没改就不许再灌一遍消费者').toBe(1)
  })

  it('restoreDefaults：三张玩法表 + 菜单那条 + 阈值一起回默认，且只多灌一次', () => {
    const { store, applied } = rig()
    store.restore({
      gameplay: { keyboard: { KeyQ: 'dodge' }, padButtons: { 0: 'jump' }, padAxes: { moveX: 4, moveY: 5, camX: 2, camY: 3 } },
      ui: { stickThreshold: 0.4, keyboard: { KeyZ: 'back' } }
    })
    const before = applied.length
    store.restoreDefaults()
    expect(store.get(), '逐字回默认，不是"近似默认"').toEqual(defaultBindings())
    expect(applied.length, '整张回默认是一次灌注').toBe(before + 1)
    expect(applied.at(-1)).toEqual(defaultBindings())
  })
})
