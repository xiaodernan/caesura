import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as INPUT from '@/core/Input'
import {
  BINDABLE_ACTIONS, DEFAULT_BINDS, UI_BINDS, UI_EXIT_INTENTS, UI_INTENTS, codeLabel, keyOf,
  type ActionName, type Bindings, type UiIntent
} from '@/core/Input'
import { BindingsStore, BIND_BOUNDS, PROFILE_SLOTS, clampBindings, clampProfiles, defaultBindings } from '@/settings/Bindings'

/**
 * KI-336：键位绑定变成数据之后的**数据半格**守卫。
 *
 * 这一份只管形状与信任边界（`clampBindings` / `BindingsStore` / 名册的来源），
 * 运行时换表与"改键之后屏幕不说谎"在 `tests/flow/bindings-remap.test.ts`。
 *
 * `raw` 在这里一律当成**玩家手改过的存档**：`Integrity` 的校验和只防截断，不防恶意，
 * 所以这一组的判据不是"能不能装出想要的键位"，而是"任何 blob 都只能装出玩得下去的那张表"。
 */

/**
 * KI-391：敌意档②那把键的来路。
 * 为什么不许写字面抄本：那一串字母的长度是名册张数的一次**手抄**——两数今天相等，
 * 所以那条腿今天是满覆盖的；名册一涨（KI-390 的甲候选正是涨一枚），多出来的那一枚派成 `Keyundefined`，
 * 被 `clampBindings` 的语法关丢掉，回补再替它另找一把 ⇒ 老判据「还剩一把键吗」照旧绿，只是**静默少覆盖一格**。
 * 于是键从名册自己派：`键池[i]` ⇄ `名册[i]`，而「池够不够长」由下面那条腿现问——不够长就红，不许静默。
 * 字母用 `fromCharCode` 生成而不是再抄一串字母表：那串字母表本身又是一份抄本。
 */
const 键池: readonly string[] = [
  ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`),
  ...Array.from({ length: 10 }, (_, i) => `Digit${i}`)
]
const 派键: ReadonlyArray<readonly [string, ActionName]> =
  BINDABLE_ACTIONS.map((a, i) => [键池[i], a] as const)

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
    // KI-342：数组那一格是同一个坑——`{...}` 与 `[...]` 只差一个字符，漏了就是让原件替所有人记账
    a.gameplay.unbound.push('dodge')
    expect(DEFAULT_BINDS.unbound, '默认表上「一个都没关」，而这句话不许被副本改').toEqual([])
    expect(defaultBindings().gameplay.keyboard.KeyW, '下一次现推仍是原件').toBe('moveUp')
    expect(defaultBindings().gameplay.unbound, '下一次现推也仍是空名单').toEqual([])
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

  it('不失联（四格狠档各量一次）：名单外的动作仍有一把键，名单里的动作一格都不许留，意图一个都不落空', () => {
    const hostile: Array<{ 名: string; raw: Record<string, unknown>; 派?: Map<ActionName, string> }> = [
      // ① 全删：两张键盘表都空着
      { 名: '①', raw: { gameplay: { keyboard: {} }, ui: { keyboard: {} } } },
      // ② 名册里每一枚各占一把**派来的**键（`键池[i]` ⇄ `名册[i]`，今天与默认表重叠 ⇒ 一路搬家）。
      // 这一档额外带一张 `派` 表，判据因此能问「回来的那一把是不是它自己那把」，而不只问「还剩一把吗」——KI-391
      { 名: '②', raw: { gameplay: { keyboard: Object.fromEntries(派键) } }, 派: new Map(派键.map(([c, a]) => [a, c] as [ActionName, string])) },
      // ③ 一个动作吃掉所有键
      { 名: '③', raw: { gameplay: { keyboard: Object.fromEntries(Object.keys(DEFAULT_BINDS.keyboard).map((c) => [c, 'dodge'])) } } },
      // ④ KI-342：全删之外还点名了三格「无」——这一档是上面三条的合流，回补要救前者、要放过后者
      { 名: '④', raw: { gameplay: { keyboard: {}, unbound: ['dodge', 'observe', 'throwCrystal'] } } }
    ]
    for (const { 名, raw, 派 } of hostile) {
      const out = clampBindings(raw)
      const off = new Set(out.gameplay.unbound)
      for (const a of BINDABLE_ACTIONS) {
        const codes = Object.keys(out.gameplay.keyboard).filter((c) => out.gameplay.keyboard[c] === a)
        if (off.has(a)) {
          expect(codes, `${a} 点名了「无」⇒ 回补不许把它请回键盘上（名单与表必须同向）`).toEqual([])
        } else {
          expect(codes.length, `${a} 必须还有一把键（${名}：${JSON.stringify(Object.keys(raw))}）`)
            .toBeGreaterThanOrEqual(1)
          if (派) expect(codes, `${名} 里 ${a} 派的是 ${派.get(a)}，回到表里那一格写的必须还是它——只数「还剩一把」看不见静默搬家（KI-391）`).toEqual([派.get(a)])
        }
      }
      for (const i of UI_INTENTS) {
        expect(Object.values(out.ui.keyboard), `${i} 不许被档锁死`).toContain(i)
      }
    }
  })

  it('点名「无」之后，档里残留的那一格也不算数：两遍都跳过它，不是只挡回补', () => {
    // 只挡第二遍（回补）的话，这一格会绿：raw 亲口写的 Ctrl=dodge 照样进表，而名单里也写着 dodge
    const out = clampBindings({ gameplay: { keyboard: { ControlLeft: 'dodge' }, unbound: ['dodge'] } })
    expect(Object.keys(out.gameplay.keyboard).filter((c) => out.gameplay.keyboard[c] === 'dodge'), '表里没有 dodge').toEqual([])
    expect(out.gameplay.unbound, '名单原样留着这一格').toEqual(['dodge'])
    expect(out.gameplay.keyboard.KeyQ, '其余动作一格都不跟着搬（锁定仍在 Q）').toBe('lockOn')
  })

  it('名单自己也是数据：非数组/重复/乱序/名册外的名字都归成"名册序、去重、只认名册"（档里那串不是第二个主人）', () => {
    expect(clampBindings({ gameplay: { unbound: 'dodge' } }).gameplay.unbound, '字符串不是数组 ⇒ 空名单').toEqual([])
    expect(clampBindings({ gameplay: { unbound: { 0: 'dodge' } } }).gameplay.unbound, '对象不是数组 ⇒ 空名单').toEqual([])
    expect(clampBindings({ gameplay: { unbound: null } }).gameplay.unbound).toEqual([])
    expect(clampBindings({ gameplay: { unbound: ['dodge', 'dodge'] } }).gameplay.unbound, '重复 ⇒ 去重').toEqual(['dodge'])
    expect(clampBindings({ gameplay: { unbound: ['observe', 'dodge'] } }).gameplay.unbound, '乱序 ⇒ 归成名册序（存档往返不漂移的前提）')
      .toEqual(['dodge', 'observe'])
    const junk = clampBindings({ gameplay: { unbound: ['fly', '__proto__', 7, null, 'jump', { a: 1 }] } })
    expect(junk.gameplay.unbound, '只有名册上的名字进得了名单').toEqual(['jump'])
    expect(Object.getPrototypeOf(junk.gameplay.unbound), '名单仍是普通数组').toBe(Array.prototype)
  })

  it('幂等（存档往返不漂移）：clamp(clamp(x)) 与 clamp(x) 逐字相等', () => {
    const once = clampBindings({ gameplay: { keyboard: { KeyQ: 'dodge', KeyE: 'guard' } }, ui: { keyboard: { KeyZ: 'back' }, stickThreshold: 0.4 } })
    expect(clampBindings(once), '第二次夹取一格都不该再动').toEqual(once)
    expect(clampBindings(defaultBindings())).toEqual(defaultBindings())
    // KI-342：名单那一格也走同一条幂等——写进档的东西读回来第二次一个字都不动
    const off = clampBindings({ gameplay: { keyboard: {}, unbound: ['observe', 'dodge'] } })
    expect(clampBindings(off), '名单与表同向，第二次夹取不必再纠一遍').toEqual(off)
    expect(off.gameplay.unbound, '归一化在第一次就做完（名册序）').toEqual(['dodge', 'observe'])
  })

  it('解绑腾出的那一格不当先塞给失联者：`released` 是"交换"的手感，解绑没有另一半', () => {
    // G 被 map 占了 ⇒ 弹反失联。可它落的是 map 腾出的 Tab，而不是 dodge 被点名「无」腾出的 Ctrl：
    // 玩家刚关掉的那一格不该被回补排在前面，否则「无」读起来像"这一格挪给了别人"
    const out = clampBindings({ gameplay: { keyboard: { KeyG: 'map' }, unbound: ['dodge'] } })
    expect(out.gameplay.keyboard.Tab, '弹反落在别人主动腾出来的那一格').toBe('parry')
    expect(out.gameplay.keyboard.ControlLeft, '名单里那一格腾出的键保持空着').toBeUndefined()
    expect(out.gameplay.unbound).toEqual(['dodge'])
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

describe('KI-391 派键的来路：不许是名册长度的一份抄本', () => {
  it('池装得下名册，而且池里每一把都过 clampBindings 的语法关（不够长要响，不许静默少覆盖一格）', () => {
    expect(键池.length, `池 ${键池.length} 格要 ≥ 名册 ${BINDABLE_ACTIONS.length} 枚——池短一枚，多出来的那枚就派成 undefined`)
      .toBeGreaterThanOrEqual(BINDABLE_ACTIONS.length)
    for (const code of 键池) {
      const out = clampBindings({ gameplay: { keyboard: { [code]: 'interact' } } })
      expect(out.gameplay.keyboard[code], `${code} 被 clampBindings 丢掉了 ⇒ 它不该待在池里（池里的键必须真能落表）`).toBe('interact')
    }
  })

  it('派键与名册同长、两两不同、每一把都在池里（一枚不多，一枚不少）', () => {
    expect(派键.length, '有几枚动作就有几把派键——多出来的是抄本，少了的那枚会静默没键')
      .toBe(BINDABLE_ACTIONS.length)
    expect(new Set(派键.map(([c]) => c)).size, '派键两两不同：两枚挤同一格 ⇒ 敌意档少覆盖一格而老判据仍绿')
      .toBe(派键.length)
    for (const [c, a] of 派键) {
      expect(键池, `${a} 那把 ${c} 不在池里——名册长过池了，去加格子而不是让派键掉出去`).toContain(c)
      expect(c, `派出来的键名里不许有 undefined（那是池比名册短时那一枚的下场）`).not.toContain('undefined')
    }
  })

  it('全仓的尺与码里不许再住一份引号内的 [A-Z] 长串——它只能是某份名册长度的抄本', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url))
    const 命中: string[] = []
    const 扫 = (dir: string): void => {
      for (const e of readdirSync(`${root}${dir}`, { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`
        if (e.isDirectory()) { 扫(rel); continue }
        if (!/\.ts$/.test(e.name)) continue
        readFileSync(`${root}${rel}`, 'utf8').split('\n').forEach((l, i) => {
          for (const m of l.match(/['"`][A-Z]{18,}['"`]/g) ?? []) 命中.push(`${rel}:${i + 1}（${m.length - 2} 字符）`)
        })
      }
    }
    for (const d of ['tests', 'src']) 扫(d)
    expect(命中, `引号内连续大写 ≥18 的每一处都是一份手抄名册长度（KI-391）：${命中.join('、')}`).toEqual([])
  })
  it('全仓的尺里不许再有一句拿裸整数钉名册自己的长度——那枚数就是名册的一份抄本（KI-393 甲）', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url))
    const TOKENS = ['ACTION_NAMES', 'BINDABLE_ACTIONS', 'UI_INTENTS', 'UI_NAV_INTENTS', 'PICK_INTENTS', 'UI_NAV', 'UI_PICK', 'STATUS_IDS', 'ActionName', 'UiIntent']
    const 像名册 = (s: string): boolean => TOKENS.some((t) => new RegExp('(^|[^A-Za-z_])' + t + '($|[^A-Za-z_])').test(s))
    const 第 = (文: string, i: number): string => (i >= 0 && i < 文.length ? 文[i] ?? '' : '')
    /** 先把「不是代码」的那些位置划出去：引号串、模板串、行注释、块注释、正则字面量。
     *  上一版没有这一层，把本条自己那句 indexOf('expect(') 当成了一处调用点，从那一行起整份文件再没往下看——
     *  于是这把尺在自己住的那份文件里漏掉了它要抓的一枚，报出来的名单短了一枚，而短名单看着仍是绿的。
     *  正则字面量必须一起划：本文件里就住着一枚 /['"`][A-Z]{18,}['"`]/，三种引号都在里头，
     *  不划的话头一枚引号会一路吞掉后面的真代码。 */
    const 码位 = (文: string): Uint8Array => {
      const 表 = new Uint8Array(文.length)
      表.fill(1)
      const 吞串 = (i: number, q: string): number => {
        表[i] = 0
        let j = i + 1
        while (j < 文.length) {
          const d = 第(文, j)
          if (d === '\\') { 表[j] = 0; 表[j + 1] = 0; j += 2; continue }
          if (d === q) { 表[j] = 0; return j }
          if (d === '\n' && q !== '`') break
          表[j] = 0
          j++
        }
        return j - 1
      }
      let 上 = ''
      for (let i = 0; i < 文.length; i++) {
        if (表[i] !== 1) continue
        const c = 第(文, i)
        if (c === "'" || c === '"' || c === '`') { 上 = c; i = 吞串(i, c); continue }
        if (c === '/' && (第(文, i + 1) === '/' || 第(文, i + 1) === '*')) {
          const 止 = 第(文, i + 1) === '/' ? 文.indexOf('\n', i) : 文.indexOf('*/', i + 2)
          const 末 = 止 < 0 ? 文.length - 1 : 第(文, i + 1) === '/' ? 止 : 止 + 1
          for (let j = i; j <= 末 && j < 文.length; j++) 表[j] = 0
          i = 止 < 0 ? 文.length : 末
          continue
        }
        /* 正则字面量先**探**再划：在同一条里找得到收尾的那枚斜杠，才把整段划成非代码；
           找不到就说明这一枚斜杠是除号。上一版边写边划，又拿「紧挨着的前一个字符」（空格也算）当记号，
           于是 `=> /re/` 里那枚斜杠后面一旦探不到收尾，整行的真括号全被划走，配平再也回不到 0。 */
        if (c === '/' && (上 === '' || '([{,=:&|?;+-*%~^<>'.includes(上))) {
          let j = i + 1
          let 类 = false
          let 闭 = -1
          while (j < 文.length) {
            const d = 第(文, j)
            if (d === '\n') break
            if (d === '\\') { j += 2; continue }
            if (类) { if (d === ']') 类 = false } else if (d === '[') 类 = true
            else if (d === '/') { 闭 = j; break }
            j++
          }
          if (闭 >= 0) {
            for (let k = i; k <= 闭; k++) 表[k] = 0
            let k = 闭 + 1
            while (k < 文.length && /[a-z]/.test(第(文, k))) { 表[k] = 0; k++ }
            上 = '/'
            i = k - 1
            continue
          }
        }
        if (!/\s/.test(c)) 上 = c
      }
      return 表
    }
    const 跳串 = (文: string, i: number): number => {
      const q = 第(文, i)
      let j = i + 1
      while (j < 文.length) { if (第(文, j) === '\\') { j += 2; continue } if (第(文, j) === q) return j; j++ }
      return j
    }
    /* 从 expect 的那枚左括号起，按深度走到配对的右括号；非代码位置（串身与注释）一概不参与配平 */
    const 配平 = (文: string, 表: Uint8Array, 开: number): number => {
      let d = 0
      for (let j = 开; j < 文.length; j++) {
        if (表[j] !== 1) continue
        const c = 第(文, j)
        if (c === '(') d++
        else if (c === ')') { d--; if (d === 0) return j }
      }
      return -1
    }
    /* 主语取第一个顶层逗号之前的那一段；若它只是个标识符，把它那行 const 的右端拉进来一起看 */
    const 主语段 = (参: string, 文: string): string => {
      let d = 0, k = 0
      for (; k < 参.length; k++) {
        const c = 参[k] ?? ''
        if (c === "'" || c === '"' || c === '`') { k = 跳串(参, k); continue }
        if (c === '(' || c === '[' || c === '{') d++
        else if (c === ')' || c === ']' || c === '}') d--
        else if (c === ',' && d === 0) break
      }
      const 主 = 参.slice(0, k)
      const id = /^(\w+)(\.length)?$/.exec(主.trim())
      if (!id) return 主
      const 名 = id[1]
      if (!名) return 主
      const m = new RegExp('(?:const|let)\\s+' + 名 + '\\s*(?::[^=\\n]*)?=\\s*([^\\n]{0,240})').exec(文)
      return m ? 主 + '=>' + m[1] : 主
    }
    /* expect( 收尾之后只容许一枚「说明」实参，再往下必须紧跟链式调用 */
    const 尾段 = (文: string, 闭: number): string => {
      let j = 闭 + 1
      while (j < 文.length && /\s/.test(第(文, j))) j++
      if (第(文, j) === ',') {
        j++
        let d = 0
        while (j < 文.length) {
          const c = 第(文, j)
          if (c === "'" || c === '"' || c === '`') { j = 跳串(文, j) + 1; continue }
          if (c === '(') d++
          else if (c === ')') { if (d === 0) break; d-- }
          j++
        }
        j++
      }
      return 文.slice(j, j + 120)
    }
    const 裸数 = (尾: string): string | null => {
      const m = /^\s*(?:\.\s*not)?\s*\.\s*(toBe|toHaveLength|toEqual)\(\s*([^)]{0,80}?)\s*\)/.exec(尾)
      const v = m?.[2]
      return v && /^\d+$/.test(v) ? v : null
    }
    const 抄本: string[] = []
    const 瞎处: string[] = []
    const 漏行: string[] = []
    const 扫 = (dir: string): void => {
      for (const e of readdirSync(`${root}${dir}`, { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`
        if (e.isDirectory()) { 扫(rel); continue }
        if (!/\.ts$/.test(e.name)) continue
        const 文 = readFileSync(`${root}${rel}`, 'utf8')
        if (!/expect\s*\(/.test(文)) continue
        const 表 = 码位(文)
        const 行号 = new Int32Array(文.length + 1)
        let n = 1
        for (let k = 0; k < 文.length; k++) { 行号[k] = n; if (第(文, k) === '\n') n++ }
        行号[文.length] = n
        const 行 = (i: number): number => 行号[i] ?? 1
        const 走到 = new Set<number>()
        for (let i = 0; i < 文.length; i++) {
          if (表[i] !== 1 || !文.startsWith('expect(', i)) continue
          if (/[\w$.]/.test(第(文, i - 1))) continue
          const 站 = i
          走到.add(行(站))
          const 闭 = 配平(文, 表, 站 + 6)
          if (闭 < 0) { 瞎处.push(`${rel}:${行(站)}`); continue }
          const 数 = 裸数(尾段(文, 闭))
          const 主 = 数 ? 主语段(文.slice(站 + 7, 闭), 文) : ''
          i = 闭
          if (!数 || !像名册(主)) continue
          抄本.push(`${rel}:${行(站)}（期望 ${数}，主语 ${主.replace(/\s+/g, ' ').slice(0, 60)}）`)
        }
        文.split('\n').forEach((l, k) => { if (/^[ \t]*expect\(/.test(l) && !走到.has(k + 1)) 漏行.push(`${rel}:${k + 1}`) })
      }
    }
    扫('tests')
    expect(瞎处, `凡走到一处 expect( 却配不出右括号，就是这把尺自己瞎了——那一处之后的半份文件不许静悄悄不看（KI-393 甲）：${瞎处.join('、')}`).toEqual([])
    expect(漏行, `行首那一枚 expect 是本仓尺的写法底色，一处没被走到就是这把尺漏看了那一行（KI-393 甲）：${漏行.join('、')}`).toEqual([])
    expect(抄本, `名册自己的长度被裸整数钉住的每一处都是一份抄本（KI-393 甲）：${抄本.join('、')}`).toEqual([])
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
    expect(UI_INTENTS.length, '导航那一族＋直选那一族＝全值域，多一格少一格都是抄写漂移').toBe(INPUT.UI_NAV_INTENTS.length + INPUT.PICK_INTENTS.length)
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

/**
 * KI-342：显式「无／解绑」那一格在 store 这一侧的形状。
 *
 * 这一组问的都是**两半**这件事：`unbind` 既摘格子又记名单，`rebind` 既写格子又销名单。
 * 少了任何一半，表与名单就会各说一句话——而玩家看见的是其中那一句，另一句在下一次整张夹取
 * 时才生效（"按了改键却什么也没变"就是这么来的）。存档那一侧的往返在 `tests/flow/controls-page.test.ts`。
 */
describe('KI-342 「无」那一格：两半同向的四把手', () => {
  function rig() {
    const applied: Bindings[] = []
    const store = new BindingsStore({ input: { setBindings: (b: Bindings): void => { applied.push(b) } } })
    return { store, applied }
  }

  it('unbind 写的正是两半：那一格摘掉、名字进名单，而手柄那张与其余 21 格一概不动', () => {
    const { store, applied } = rig()
    store.unbind('dodge')
    const g = store.get().gameplay
    expect(Object.keys(g.keyboard).filter((c) => g.keyboard[c] === 'dodge'), '表里没有 dodge').toEqual([])
    expect(g.unbound, '名单里有 dodge（"没写"是恢复默认，"点名"才是无）').toEqual(['dodge'])
    expect(g.keyboard.ControlLeft, '它腾出的那一格保持空着，不是顺手给别人').toBeUndefined()
    expect(g.padButtons, '「键盘上不要」≠「这个动词没了」：手柄那两把一把都不许摘').toEqual(DEFAULT_BINDS.padButtons)
    expect(Object.keys(g.keyboard).length, '除了 dodge 那一格，其余 21 个动作仍各占一把').toBe(Object.keys(DEFAULT_BINDS.keyboard).length - 1)
    expect(applied.length, '一次解绑一次灌注').toBe(2)
  })

  it('解绑过的动作再改键 ⇒ 名单自己退掉这一格（不清名单的话，刚绑上的那一格会被下一次夹取抹掉）', () => {
    const { store } = rig()
    store.unbind('dodge')
    store.rebind('dodge', 'KeyY')
    const full = store.get()
    expect(full.gameplay.keyboard.KeyY, '改键真的算数了').toBe('dodge')
    expect(full.gameplay.unbound, '「无」与"有键"不可能同时成立').toEqual([])
    expect(clampBindings(full).gameplay, '再夹一次（存档往返那一拍）不许把这一格抹掉').toEqual(full.gameplay)
  })

  it('resetKey 是那一格的出口：回默认把键与名单一起收回来，逐字回到默认表', () => {
    const { store } = rig()
    store.unbind('dodge')
    store.resetKey('dodge')
    expect(store.get().gameplay.keyboard.ControlLeft, 'Ctrl 回来了').toBe('dodge')
    expect(store.get(), '整张逐字回默认（名单也是）').toEqual(defaultBindings())
  })

  it('解绑两次同一名动作 ⇒ 名单不重复，第二次照样是一次灌注一次夹取', () => {
    const { store, applied } = rig()
    store.unbind('dodge')
    const before = applied.length
    store.unbind('dodge')
    expect(store.get().gameplay.unbound, '重复点名不产生第二个格子').toEqual(['dodge'])
    expect(applied.length, '一次动作一次灌注（不做"看起来没变就不灌"那种优化）').toBe(before + 1)
  })

  it('unbind 认不出名册外的名字 ⇒ 一格都不动、一次都不灌（`data-arg` 是字符串，DOM 那侧谁都能写）', () => {
    const { store, applied } = rig()
    for (const junk of ['fly', '__proto__', '', 'constructor']) {
      store.unbind(junk as ActionName)
      expect(store.get(), `「${JSON.stringify(junk)}」不配进名单`).toEqual(defaultBindings())
    }
    expect(applied.length, '没改就不许再灌一遍消费者').toBe(1)
  })

  it('get() 交出去的名单是副本：外面 push 进不去 store，而旧副本也不跟着 store 长', () => {
    const { store, applied } = rig()
    const g = store.get()
    g.gameplay.unbound.push('dodge')
    expect(store.get().gameplay.unbound, 'store 手里那份没被碰').toEqual([])
    store.unbind('parry')
    expect(applied.at(-1)!.gameplay.unbound, '灌给消费者的那一份也只有这一次的名字').toEqual(['parry'])
    expect(g.gameplay.unbound, '先前交出去的那一份不跟着长：里面只有它自己那一次 push').toEqual(['dodge'])
  })

  it('读档带名单 ⇒ 名单与表一起落到 store 与消费者（老档没这一格 = 空名单，不是"全关"）', () => {
    const { store, applied } = rig()
    store.restore({ gameplay: { keyboard: {}, unbound: ['observe'] } })
    expect(store.get().gameplay.unbound).toEqual(['observe'])
    expect(applied.at(-1)!.gameplay.unbound, '消费者拿到的与 store 同一份').toEqual(['observe'])
    expect(keyOf('observe', store.get().gameplay), '显示侧读到的是 null：这一格此刻没有键').toBeNull()
    const legacy = new BindingsStore(null)
    legacy.restore({ gameplay: { keyboard: DEFAULT_BINDS.keyboard, padButtons: DEFAULT_BINDS.padButtons, padAxes: DEFAULT_BINDS.padAxes } })
    expect(legacy.get().gameplay.unbound, 'v14 之前写下的档没这一格 ⇒ 空名单（缺块不是"全关"）').toEqual([])
  })

  it('restoreDefaults 连名单一起清空（"全部回默认"要回答的是两半）', () => {
    const { store } = rig()
    store.unbind('dodge')
    store.unbind('observe')
    expect(store.get().gameplay.unbound, '先确认确实关过两格').toEqual(['dodge', 'observe'])
    store.restoreDefaults()
    expect(store.get().gameplay.unbound, '整张回默认 ⇒ 一个都没关').toEqual([])
    expect(store.get().gameplay.keyboard, '两把键都回来了').toEqual(DEFAULT_BINDS.keyboard)
  })
})

describe('KI-343 手柄那一侧的逐行改键：`rebind` 认得 `Pad` 拼写', () => {
  function rig() {
    const applied: Bindings[] = []
    const store = new BindingsStore({ input: { setBindings: (b: Bindings): void => { applied.push(b) } } })
    return { store, applied }
  }
  /** 与默认手柄表逐格相比，**动了哪几把** */
  const movedPad = (pad: Record<number, ActionName>): number[] => {
    const idx = new Set([...Object.keys(DEFAULT_BINDS.padButtons), ...Object.keys(pad)].map(Number))
    return [...idx].filter((i) => pad[i] !== DEFAULT_BINDS.padButtons[i]).sort((a, b) => a - b)
  }

  it('把闪避绑到手柄那一把：摘掉它原来占的**所有**格（0 与 12 都闪避），而键盘那张一格都不动', () => {
    const { store, applied } = rig()
    store.rebind('dodge', 'Pad2')
    const pad = store.get().gameplay.padButtons
    expect(pad[2], '新那一把归闪避').toBe('dodge')
    expect(pad[0], '原来的两把一把都不许留着——留一把就是"旧键还能闪避"那种鬼键').toBe('parry')
    expect(pad[12], '第二把腾出来的格是空的').toBeUndefined()
    expect(store.get().gameplay.keyboard, '改手柄不许顺手动键盘那张（两侧各是一条独立的路）').toEqual(DEFAULT_BINDS.keyboard)
    expect(applied.length, '一次改键一次灌注').toBe(2)
  })

  it('目标那一把原本有主人 ⇒ 一次交换：原主人拿走升序第一格腾出的位置，其余动作一把都不搬', () => {
    const { store } = rig()
    store.rebind('dodge', 'Pad2')
    const pad = store.get().gameplay.padButtons
    expect(pad[0], 'parry 丢掉 2 号，落到 dodge 刚腾出的 0 号').toBe('parry')
    expect(pad[15], '而它原来那把（15 号）留着——交换不该顺手再摘一把').toBe('parry')
    expect(movedPad(pad), '整张只有这三格换了主人').toEqual([0, 2, 12])
    for (const a of BINDABLE_ACTIONS) {
      if (a === 'dodge' || a === 'parry') continue
      const now = Object.keys(pad).filter((i) => pad[Number(i)] === a).length
      const home = Object.keys(DEFAULT_BINDS.padButtons).filter((i) => DEFAULT_BINDS.padButtons[Number(i)] === a).length
      expect(now, `${a} 的手柄把数不该因为别人改键而变`).toBe(home)
    }
  })

  it('目标那一把原本是空的 ⇒ 只搬家不交换，腾出的格子如实空着', () => {
    const { store } = rig()
    store.rebind('dodge', 'Pad19')   // 默认表上 19 号没人（界内空格）
    const pad = store.get().gameplay.padButtons
    expect(pad[19]).toBe('dodge')
    expect(pad[0], '没有原主人 ⇒ 谁也不该被"交换"进来').toBeUndefined()
    expect(pad[12]).toBeUndefined()
    expect(movedPad(pad)).toEqual([0, 12, 19])
  })

  it('手柄那侧的改键不碰「无」那份名单：键盘上关掉的动词照样能绑到手柄', () => {
    const { store } = rig()
    store.unbind('parry')
    expect(store.get().gameplay.unbound).toEqual(['parry'])
    store.rebind('parry', 'Pad7')
    const g = store.get().gameplay
    expect(g.unbound, '名单说的是键盘那一格，手柄改键不许替玩家反悔').toEqual(['parry'])
    expect(g.keyboard, '而键盘那张也不许因为手柄改键就把 G 请回来').not.toContain('parry')
    expect(g.padButtons[7]).toBe('parry')
    expect(Object.values(g.keyboard), '这个动词此刻在键盘上无键、在手柄上有键 ⇒ 两半各说各的').not.toContain('parry')
  })

  /**
   * 这里分成两条腿是**被逼出来的**，不是修辞：`rebind` 的键盘那一半在 KI-337 已落账一条口径——
   * 「码名过不了语法 ⇒ 夹取丢掉那一格、但仍灌一次」（`applied` 每条 +1）。如果"什么都不是"的
   * 字符串也享受零灌注，那条已落账的腿就得改判。所以路由必须先回答"这是不是手柄声明"：
   * 是 ⇒ 畸形/越界一律拒绝且零灌注；不是 ⇒ 落到键盘那一半，沿用 KI-337 那条已测过的口径。
   */
  it('手柄声明但畸形 / 越界的 target（`Pad20`、`Pad07`、`Padx`…）⇒ 一格都不动、一次都不灌', () => {
    const { store, applied } = rig()
    for (const junk of ['Pad20', 'Pad99', 'Pad100', 'Pad999', 'Pad-1', 'Pad1.5', 'Padx', 'Pad', 'Pad07']) {
      store.rebind('dodge', junk)
      expect(store.get().gameplay.padButtons, `${junk} 不该写进手柄那张`).toEqual(DEFAULT_BINDS.padButtons)
      expect(store.get().gameplay.keyboard, `${junk} 也不该顺手把键盘那张改成默认`).toEqual(DEFAULT_BINDS.keyboard)
    }
    expect(applied.length, '一次都没灌 ⇒ 界外的 target 不是"改成默认"那种写法').toBe(1)
  })

  it('不是手柄声明的字符串（空串 / 尾随空格 / 小写 `pad0`）⇒ 走键盘那一半：灌一次、两张表逐字默认', () => {
    const { store, applied } = rig()
    for (const junk of ['', 'KeyQ ', 'pad0', 'PAD2']) {
      const before = applied.length
      store.rebind('dodge', junk)
      expect(store.get().gameplay.keyboard, `${JSON.stringify(junk)} 过不了键盘语法 ⇒ dodge 回默认格（KI-337 落账的那条）`)
        .toEqual(DEFAULT_BINDS.keyboard)
      expect(store.get().gameplay.padButtons, '而手柄那张一格都不动').toEqual(DEFAULT_BINDS.padButtons)
      expect(applied.length, '键盘那一半的口径：夹取之后照样灌一次').toBe(before + 1)
    }
  })

  it('`Pause` 是键盘码不是手柄声明：前缀路由不许撞上同族拼写', () => {
    const { store } = rig()
    store.rebind('dodge', 'Pause')
    expect(store.get().gameplay.keyboard.Pause, '语法过关 ⇒ 这一格就是闪避').toBe('dodge')
    expect(store.get().gameplay.padButtons, '手柄那张没参与').toEqual(DEFAULT_BINDS.padButtons)
  })

  it('名册外的动作名配一个合法 target ⇒ 拒绝、零灌注（手柄这一半没有回补，兜底的位子在这里）', () => {
    const { store, applied } = rig()
    store.rebind('fly' as ActionName, 'Pad2')
    expect(store.get().gameplay.padButtons, `'fly' 进不了表，而 parry 那一把不能被"摘掉之后再指望夹取补回来"`).toEqual(DEFAULT_BINDS.padButtons)
    expect(store.get(), '整份快照逐字默认').toEqual(defaultBindings())
    expect(applied.length, '没改就不许再灌一遍消费者').toBe(1)
  })

  it('`resetKey(action, "pad")` 是手柄那一格的出口：那一次交换整体复位，键盘那张一格都不动', () => {
    const { store } = rig()
    store.rebind('dodge', 'Pad2')
    store.resetKey('dodge', 'pad')
    const g = store.get().gameplay
    expect(g.padButtons, '闪避与那一次被交换进来的 parry 一起回自己的那几把（0/2/12 一起复位）').toEqual(DEFAULT_BINDS.padButtons)
    expect(g.keyboard, '回的是手柄那一格 ⇒ 键盘那张根本没参与').toEqual(DEFAULT_BINDS.keyboard)
  })

  it('手柄那一行回默认不许销掉键盘上那份「无」：借道 `rebind` 就是替玩家反悔', () => {
    const { store, applied } = rig()
    store.unbind('parry')                 // 键盘上明说不要这一格
    store.rebind('parry', 'Pad7')          // 手柄上给它一把（7 号原本归 sprint ⇒ 一次交换）
    const before = applied.length
    expect(store.resetKey('parry', 'pad'), 'parry 在手柄上有默认家 ⇒ 这一格该回答"动了"').toBe(true)
    const g = store.get().gameplay
    expect(g.padButtons, '两张手柄默认格（2 与 15）一起回来，被换来的 sprint 回 7 号').toEqual(DEFAULT_BINDS.padButtons)
    expect(g.unbound, '名单说的是键盘那一格：手柄复位管不到它，一次都不许销').toEqual(['parry'])
    expect(Object.values(g.keyboard), '而键盘那张仍然没有 parry（复位手柄不许把键请回来）').not.toContain('parry')
    expect(applied.length, '一次复位一次灌注').toBe(before + 1)
  })

  it('一行回默认不许抹平另一行（手柄那侧同一条口径）：别人自己挪过的那一把留着', () => {
    const { store } = rig()
    store.rebind('dodge', 'Pad2')
    store.rebind('map', 'Pad3')        // 玩家自己把地图挪到 3（3 号原本归 interact ⇒ 一次交换）
    store.resetKey('dodge', 'pad')
    const pad = store.get().gameplay.padButtons
    expect(pad[0], '闪避回了两把').toBe('dodge')
    expect(pad[12]).toBe('dodge')
    expect(pad[3], 'map 那一次改键没被顺手抹掉').toBe('map')
    expect(pad[6], 'interact 站在 map 腾出的那一格里——回 dodge 那一行不该把它请回 6 号，那是另一行的事').toBe('interact')
  })

  it('`resetKey(action)` 不写第二个参数时还是键盘那条（既有形状不许被新参数改掉）', () => {
    const { store } = rig()
    store.rebind('dodge', 'Pad2')
    store.rebind('parry', 'KeyY')
    store.resetKey('parry')
    expect(store.get().gameplay.keyboard, '键盘那格回了家').toEqual(DEFAULT_BINDS.keyboard)
    expect(store.get().gameplay.padButtons, '而手柄那次改键没被顺手抹掉').not.toEqual(DEFAULT_BINDS.padButtons)
  })

  it('手柄改键跟着档走：写进 v14 的那一把读回来还是那一把，且整张夹取幂等', () => {
    const { store } = rig()
    store.rebind('attackLight', 'Pad6')
    const saved = store.get()
    const again = clampBindings(JSON.parse(JSON.stringify(saved)))
    expect(again.gameplay.padButtons, '存档往返不漂移').toEqual(saved.gameplay.padButtons)
    expect(clampBindings(again).gameplay.padButtons, '夹取自己幂等').toEqual(again.gameplay.padButtons)
    const loaded = new BindingsStore(null, saved)
    expect(loaded.get().gameplay.padButtons[6]).toBe('attackLight')
  })
})

/**
 * KI-344：菜单那条通道（`UiIntent`）的逐行改键与「无」。
 *
 * 这一条与玩法那两条最不一样的地方是**折叠**：`confirm` 在默认表上就是四把等价键（§5.2 那句
 * 「键盘不给空格/E 才是设备间的不一致」），所以"一行"的单位是**整组**——玩家改的是"这一行用什么键"，
 * 而不是"这一行的其中一把"。而它的「无」只在**有回补那一步**的通道上才成立（玩法键盘有、手柄没有、
 * 菜单键盘也有），这是 KI-343 那句「手柄那侧为什么没有『无』」的另一半。
 * 第三条口径是这一条通道独有的硬规则：**菜单必须走得出去**——别的意图关掉只是少一种能力，
 * `back` 关掉是把这一屏变成陷阱，所以它不许进名单（而挪动照做）。
 */
describe('KI-344 菜单那条通道的逐行改键：单元是整组、目标那一把的原主人可能被读成"少一把"而不是"搬家"', () => {
  function rig() {
    const applied: Bindings[] = []
    const store = new BindingsStore({ input: { setBindings: (b: Bindings): void => { applied.push(b) } } })
    return { store, applied }
  }
  /** 某一行此刻占的**所有**格（升序）：折叠那条一条都不许漏 */
  const codesOf = (kb: Record<string, UiIntent>, i: UiIntent): string[] =>
    Object.keys(kb).filter((c) => kb[c] === i).sort()
  /** 与默认菜单表逐格相比动了哪几格 */
  const movedUi = (kb: Record<string, UiIntent>): string[] => {
    const codes = new Set([...Object.keys(UI_BINDS.keyboard), ...Object.keys(kb)])
    return [...codes].filter((c) => kb[c] !== UI_BINDS.keyboard[c]).sort()
  }

  it('改一行 = 摘掉这一行此刻占的**所有**格（四把等价键是设计，但"这一行用 F"说的就是一把），其余行一把不动', () => {
    const { store, applied } = rig()
    store.rebindUi('confirm', 'KeyF')
    const kb = store.get().ui.keyboard
    expect(codesOf(kb, 'confirm'), '那一行现在只剩玩家给的那一把').toEqual(['KeyF'])
    expect(kb.KeyF).toBe('confirm')
    expect(movedUi(kb), '动的只有这一行的四把旧格加上新那一格').toEqual(['Enter', 'KeyE', 'NumpadEnter', 'Space', 'KeyF'].sort())
    for (const i of UI_INTENTS) {
      if (i === 'confirm') continue
      expect(codesOf(kb, i), `${i} 那一行不该因为别人改键而少一把`).toEqual(codesOf(UI_BINDS.keyboard, i))
    }
    expect(store.get().ui.padButtons, '键盘那一拍不洗手柄那张：两条通道各自成表').toEqual(UI_BINDS.padButtons)
    expect(store.get().gameplay.keyboard, '而玩法那张逐字没动').toEqual(DEFAULT_BINDS.keyboard)
    expect(applied.length, '一次改键一次灌注').toBe(2)
  })

  it('目标那一把的原主人**还有别的键** ⇒ 那一行只是少了一把，不叫交换（`moved` 为假）', () => {
    const { store } = rig()
    const r = store.rebindUi('up', 'Escape')
    expect(r, '说的是"这一把原本归后退"，而退那一条路没被搬走').toEqual({ displaced: 'back', moved: false, onto: 'keyboard' })
    const kb = store.get().ui.keyboard
    expect(codesOf(kb, 'up'), '上移现在就是 Escape 一把').toEqual(['Escape'])
    expect(codesOf(kb, 'back'), '后退仍握着它的另外两把 ⇒ 等价键被读成"少一把"，不是"搬家"').toEqual(['Backspace', 'Tab'])
  })

  it('原主人**只剩那一把** ⇒ 回补替它找家：那一行真的搬了（`moved` 为真），而且它不落空', () => {
    const { store } = rig()
    const r = store.rebindUi('confirm', 'ArrowUp')
    expect(r, '上移只有 ArrowUp 那一把，被拿走就得搬家').toEqual({ displaced: 'up', moved: true, onto: 'keyboard' })
    const kb = store.get().ui.keyboard
    expect(codesOf(kb, 'confirm')).toEqual(['ArrowUp'])
    expect(codesOf(kb, 'up').length, '回补那一遍给它找了一格，而不是一行空着').toBe(1)
    expect(codesOf(kb, 'up'), '而它落的那一格不是自己原来的那一把').not.toEqual(['ArrowUp'])
  })

  it('一把把抢光 `back` 的三把默认键 ⇒ 后退仍不落空：这条通道的硬规则是「菜单必须走得出去」', () => {
    const { store } = rig()
    store.rebindUi('up', 'Escape')
    store.rebindUi('left', 'Tab')
    store.rebindUi('right', 'Backspace')
    const kb = store.get().ui.keyboard
    expect(codesOf(kb, 'back').length, '三把默认键全被别人占了，后退仍该有一把').toBeGreaterThan(0)
    for (const i of UI_INTENTS) {
      expect(codesOf(kb, i).length, `${i} 每一行都还握着一把键（名单外不许有人失联）`).toBeGreaterThan(0)
    }
  })

  it('解绑写的还是那两半：表里没它 ＋ `ui.unbound` 里有它，两遍回补都不许把它请回来', () => {
    const { store } = rig()
    store.unbindUi('confirm')
    const u = store.get().ui
    expect(codesOf(u.keyboard, 'confirm'), '表里没有这一行').toEqual([])
    expect(u.unbound, '"没写"是恢复默认，"点名"才是无').toEqual(['confirm'])
    expect(movedUi(u.keyboard), '腾出的那四把一格都不许塞给别人（把「无」读成「挪走」是玩法那条已经挡过的形状）')
      .toEqual(['Enter', 'KeyE', 'NumpadEnter', 'Space'].sort())
    for (const i of UI_INTENTS) {
      if (i === 'confirm') continue
      expect(codesOf(u.keyboard, i), `${i} 那一行一把都不动`).toEqual(codesOf(UI_BINDS.keyboard, i))
    }
    const round = clampBindings(JSON.parse(JSON.stringify(store.get())))
    expect(round.ui.unbound, '跟着档走').toEqual(['confirm'])
    expect(codesOf(round.ui.keyboard, 'confirm'), '夹取也不许替玩家反悔').toEqual([])
  })

  it('`back` 那一格不许关：返回假、一格不动、一次都不灌（"关掉它"在这条通道上不是一个合法请求）', () => {
    const { store, applied } = rig()
    expect(store.unbindUi('back'), '后退是这一屏唯一的出口').toBe(false)
    expect(store.get().ui.unbound, '名单里也因此没有它').toEqual([])
    expect(store.get().ui.keyboard, '一格都没动').toEqual(UI_BINDS.keyboard)
    expect(applied.length, '零灌注：没改就不灌（与 KI-342 那条同方向）').toBe(1)
    expect(UI_EXIT_INTENTS, '被保护的那几格只有一个主人，面板读的就是这一份名册').toEqual(['back'])
  })

  it('存档里手写 `ui.unbound: ["back","up","fly"]` ⇒ 只有 `up` 进名单：边界丢掉出口，也丢掉名册外的名字', () => {
    const out = clampBindings({ ui: { unbound: ['back', 'up', 'fly', 42, null] } })
    expect(out.ui.unbound, '信任边界不是界面上的礼貌——手改的档也不能把菜单变成陷阱').toEqual(['up'])
    expect(codesOf(out.ui.keyboard, 'back'), '被丢掉的那一格仍握着自己的三把默认键').toEqual(['Backspace', 'Escape', 'Tab'])
    expect(codesOf(out.ui.keyboard, 'up'), '而过关的那一格确实没键').toEqual([])
    expect(clampBindings(out).ui.unbound, '幂等').toEqual(['up'])
  })

  it('改键自己把这一行从名单里退掉（必需的一半）：不退就是"按下改键、屏幕上什么也没变"', () => {
    const { store } = rig()
    store.unbindUi('confirm')
    expect(store.rebindUi('confirm', 'KeyF'), '名单里的一格照样改得动').toEqual({ displaced: null, moved: false, onto: 'keyboard' })
    const u = store.get().ui
    expect(u.unbound, '点名"不要"已经被"我要这一把"覆盖了').toEqual([])
    expect(u.keyboard.KeyF).toBe('confirm')
    expect(clampBindings(store.get()).ui.keyboard.KeyF, '再夹取一次也还在').toBe('confirm')
  })

  it('一行回默认回的是**整组**（四把一起回来）而不是只回一把，名单一起清', () => {
    const { store } = rig()
    store.unbindUi('confirm')
    store.rebindUi('confirm', 'KeyF')
    expect(store.resetUi('confirm'), '这一行在默认表上有家').toBe(true)
    const kb = store.get().ui.keyboard
    expect(codesOf(kb, 'confirm'), '整组回归：这才是"回默认"在折叠那条上的意思').toEqual(['Enter', 'KeyE', 'NumpadEnter', 'Space'])
    expect(store.get().ui.unbound).toEqual([])
    expect(kb.KeyF, '玩家塞进去的那一把不留').toBeUndefined()
    expect(kb, '整张逐字回默认').toEqual(UI_BINDS.keyboard)
  })

  it('名册外的意图名 / 手柄声明 / 语法不过的码：三把把手各有各的挡法，都不许留下半截表', () => {
    const { store, applied } = rig()
    for (const junk of ['fly', '', 'confirm ']) {
      expect(store.rebindUi(junk as UiIntent, 'KeyG'), `名册外的 ${JSON.stringify(junk)} 不配搬家`).toBeNull()
      expect(store.unbindUi(junk as UiIntent), JSON.stringify(junk)).toBe(false)
      expect(store.resetUi(junk as UiIntent), JSON.stringify(junk)).toBe(false)
    }
    expect(applied.length, '一次都没灌').toBe(1)
    expect(store.get().ui, '整格逐字默认').toEqual(defaultBindings().ui)

    const before = applied.length
    expect(store.rebindUi('up', 'Pad2'), '菜单那一行落到手柄那张上（KI-345：这一串说的是哪张表，由边界回答）')
      .toEqual({ displaced: null, moved: false, onto: 'pad' })
    expect(store.get().ui.keyboard, '键盘那张一格没动 ⇒ 路由没有替玩家洗另一条通道').toEqual(UI_BINDS.keyboard)
    expect(store.get().ui.padButtons[2], '上移现在握着手柄上那一把').toBe('up')
    expect(store.get().ui.padButtons[12], '而它原来那一把一把不留（留一把就是旧键还能上移的鬼键）').toBeUndefined()
    expect(applied.length, '一次改键一次灌注').toBe(before + 1)
    const mid = applied.length
    expect(store.rebindUi('down', 'Pad20'), '说了要手柄但那把不存在 ⇒ 仍旧是拒绝，不掉进键盘那一半').toBeNull()
    expect(store.get().ui.padButtons[13], '被拒绝的那一次连原本那一把都没动').toBe('down')
    expect(applied.length, '也是零灌注').toBe(mid)

    store.rebindUi('up', 'Key{')
    expect(codesOf(store.get().ui.keyboard, 'up'), '语法不过的码 ⇒ 夹取丢掉那一格，整组照旧回归').toEqual(['ArrowUp'])
    expect(applied.length, '而键盘那一半的口径不变：没改也灌一次（KI-337 已落账那条）').toBe(mid + 1)
  })

  it('默认快照里 `ui.unbound` 是空名单**且是副本**（数组那一格与玩法那条同一个坑）', () => {
    const a = defaultBindings()
    expect(a.ui.unbound, '默认一个都没关').toEqual([])
    a.ui.unbound.push('back')
    expect(UI_BINDS.unbound, '改副本碰不到原件').toEqual([])
    expect(defaultBindings().ui.unbound, '下一次现推仍是空名单').toEqual([])
    const r = rig()
    r.store.unbindUi('up')
    const g = r.store.get()
    g.ui.unbound.push('confirm')
    expect(r.store.get().ui.unbound, 'store 交出去的也是副本').toEqual(['up'])
  })

  it('整张回默认连菜单那份名单一起清空，而菜单那张与玩法那张各自独立（改玩法不碰菜单）', () => {
    const { store } = rig()
    store.unbindUi('up')
    store.rebindUi('confirm', 'KeyF')
    store.restoreDefaults()
    expect(store.get().ui.keyboard).toEqual(UI_BINDS.keyboard)
    expect(store.get().ui.unbound, '整张回默认是唯一一把能同时清空两份名单的把手').toEqual([])
    store.rebind('dodge', 'KeyY')
    expect(store.get().ui.keyboard, '玩法那一行改键不许动菜单那张一格').toEqual(UI_BINDS.keyboard)
    expect(store.get().ui.unbound).toEqual([])
  })

  it('每一行都关得掉，除了那份名册点名的：17 格逐格过一遍，关掉之后也都回得来', () => {
    for (const i of UI_INTENTS) {
      const { store } = rig()
      const off = store.unbindUi(i)
      expect(off, `${i} 关不关得掉由名册回答`).toBe(!UI_EXIT_INTENTS.includes(i))
      if (!off) {
        expect(store.get().ui.unbound, '关不掉的 ⇒ 名单里也不许出现它').toEqual([])
        continue
      }
      expect(store.get().ui.unbound).toEqual([i])
      expect(store.resetUi(i), '而回默认对每一行都点得动').toBe(true)
      expect(store.get().ui.unbound).toEqual([])
      expect(codesOf(store.get().ui.keyboard, i), '回到整组').toEqual(codesOf(UI_BINDS.keyboard, i))
    }
  })

  it('短名换算只有一个主人：菜单那一列用的 `codeLabel` 就是 `keyOf` 里那条（不许有第二张缩写表）', () => {
    expect(codeLabel('KeyY')).toBe('Y')
    expect(codeLabel('Digit3')).toBe('3')
    expect(codeLabel('MouseLeft')).toBe('左键')
    expect(codeLabel('ControlRight')).toBe('Ctrl')
    expect(codeLabel('Enter'), '本来就好读的码原样画').toBe('Enter')
    expect(codeLabel('NumpadEnter')).toBe('NumpadEnter')
    const wCode = Object.keys(DEFAULT_BINDS.keyboard).find((c) => DEFAULT_BINDS.keyboard[c] === 'moveUp')!
    expect(keyOf('moveUp'), '玩法那条的换算仍走同一句（改缩写表只有一处可改）').toBe(codeLabel(wCode))
  })
})

describe('KI-345 菜单那一节的手柄列 ＋ 摇杆阈值的入口：`Pad<n>` 在这条通道上从拒绝变成路由', () => {
  function rig() {
    const applied: Bindings[] = []
    const store = new BindingsStore({ input: { setBindings: (b: Bindings): void => { applied.push(b) } } })
    return { store, applied }
  }
  /** 那一行此刻在**手柄**那张上占的所有把（下标升序，与表主人的落表序同一把尺） */
  const cellsOf = (pad: Record<number, UiIntent>, i: UiIntent): number[] =>
    Object.keys(pad).map(Number).filter((n) => pad[n] === i).sort((a, b) => a - b)
  /** 同一件事在**键盘**那张上的问法（键是码，不是下标） */
  const codesOf = (kb: Record<string, UiIntent>, i: UiIntent): string[] =>
    Object.keys(kb).filter((c) => kb[c] === i).sort()

  it('改菜单那一行的手柄那一把 = 摘掉这一行此刻占的**所有**格，而键盘那张一格都不动', () => {
    const { store, applied } = rig()
    const r = store.rebindUi('confirm', 'Pad7')
    expect(r, '那一把本来空着 ⇒ 没有另一半，也没有搬家').toEqual({ displaced: null, moved: false, onto: 'pad' })
    expect(cellsOf(store.get().ui.padButtons, 'confirm'), '菜单的 confirm 默认只有 0 那一把，改完就只剩 7').toEqual([7])
    expect(store.get().ui.keyboard, '键盘那张逐字没动（两条通道各自成表，手柄改键不许洗等价键）').toEqual(UI_BINDS.keyboard)
    expect(store.get().gameplay.padButtons, '玩法那张手柄表是另一条通道').toEqual(DEFAULT_BINDS.padButtons)
    expect(store.get().ui.unbound, '手柄那一拍不写名单：名单说的是键盘那一组').toEqual([])
    expect(applied.length, '一次改键一次灌注').toBe(2)
  })

  it('抢走别人唯一的一把 ⇒ 一次交换：原主人拿走升序第一格腾出的位置，`moved` 为真', () => {
    const { store } = rig()
    const r = store.rebindUi('confirm', 'Pad12')
    expect(r, '上移只有 12 那一把 ⇒ 它真的搬了家').toEqual({ displaced: 'up', moved: true, onto: 'pad' })
    const pad = store.get().ui.padButtons
    expect(pad[12], '玩家点名的那一把就是那一行').toBe('confirm')
    expect(cellsOf(pad, 'up'), '它落进 confirm 腾出的那一格（0）——交换的两半由同一条规则算出').toEqual([0])
    expect(store.get().ui.keyboard.ArrowUp, '而键盘那侧的上移仍握着 ArrowUp：手柄的搬家不洗键盘').toBe('up')
  })

  it('原主人**还有第二把** ⇒ 那一行只是少了一把（`moved` 为假），而不是编一次搬家', () => {
    const { store } = rig()
    store.set({ ui: { ...store.get().ui, padButtons: { ...UI_BINDS.padButtons, 7: 'confirm' } } })
    expect(cellsOf(store.get().ui.padButtons, 'confirm'), '先让 confirm 握两把（一键多用与玩法同一种形状）').toEqual([0, 7])
    const r = store.rebindUi('pick1', 'Pad0')
    expect(r, '确认被抢走一把而还剩一把 ⇒ 不是搬家').toEqual({ displaced: 'confirm', moved: false, onto: 'pad' })
    const pad = store.get().ui.padButtons
    expect(cellsOf(pad, 'confirm'), '还剩 7 那一把').toEqual([7])
    expect(pad[0], '被点名的那一行就是玩家给的那一把').toBe('pick1')
  })

  it('搬进一把**空着的**按钮 ⇒ 只搬家不交换，腾出的格子如实空着（手柄那张不回补，这一条与玩法同一口径）', () => {
    const { store } = rig()
    const r = store.rebindUi('back', 'Pad19')
    expect(r, '搬进空着的一把 ⇒ 没有另一半，落点仍是手柄那张').toEqual({ displaced: null, moved: false, onto: 'pad' })
    const pad = store.get().ui.padButtons
    expect(cellsOf(pad, 'back'), '原来那一把不留着慢慢失效（留一把就是旧键还能后退的鬼键）').toEqual([19])
    expect(1 in pad, '而腾出的那一格就是空的：不回补不许从别处抓一把塞给它').toBe(false)
    expect(store.get().ui.keyboard.Backspace, '键盘那侧的退路一格不少 —— 「菜单必须走得出去」不靠手柄那张兜底').toBe('back')
  })

  it('菜单这侧的畸形／越界手柄声明 ⇒ 拒绝、零灌注（「说了要手柄但那把不存在」不许掉进键盘那一半）', () => {
    const { store, applied } = rig()
    const before = applied.length
    for (const junk of ['Pad20', 'Pad07', 'Padx', 'Pad', 'Pad-1']) {
      expect(store.rebindUi('confirm', junk), JSON.stringify(junk)).toBeNull()
    }
    expect(applied.length, '五趟一次都没灌').toBe(before)
    expect(store.get().ui, '两张菜单表逐字默认').toEqual(defaultBindings().ui)
    expect(store.rebindUi('confirm', 'Pause'), '`Pause` 是键盘码不是手柄声明：前缀路由不许撞上同族拼写').not.toBeNull()
  })

  it('名册外的意图名配一个合法手柄 target ⇒ 拒绝、零灌注（这条通道没有回补，兜底的位子在这里）', () => {
    const { store, applied } = rig()
    const before = applied.length
    expect(store.rebindUi('fly' as UiIntent, 'Pad3')).toBeNull()
    expect(applied.length).toBe(before)
    expect(store.get().ui.padButtons).toEqual(UI_BINDS.padButtons)
  })

  it('「手柄回默认」回的是**整组**默认那几把，而键盘那一行玩家自己挪过的那一把不动', () => {
    const { store } = rig()
    store.rebindUi('confirm', 'Pad7')
    store.rebindUi('confirm', 'KeyF')
    expect(store.resetUi('confirm', 'pad'), '这一行在手柄上有默认键 ⇒ 回得来').toBe(true)
    expect(store.get().ui.padButtons, '手柄那张逐字回到默认表').toEqual(UI_BINDS.padButtons)
    expect(codesOf(store.get().ui.keyboard, 'confirm'), '键盘那一行仍是玩家挪出来的那一把：逐行回默认管不到另一条通道').toEqual(['KeyF'])
  })

  it('手柄那一行回默认不许销掉键盘上那份「无」：借道改键就是替玩家反悔', () => {
    const { store } = rig()
    store.unbindUi('up')
    store.rebindUi('up', 'Pad7')
    expect(store.resetUi('up', 'pad')).toBe(true)
    const u = store.get().ui
    expect(u.unbound, '名单那一半说的是键盘，手柄那一拍不碰它').toEqual(['up'])
    expect(codesOf(u.keyboard, 'up'), '键盘那张也仍不占它（回了手柄不等于回了键盘）').toEqual([])
    expect(cellsOf(u.padButtons, 'up'), '而手柄上回到默认那一把').toEqual([12])
  })

  it('那一行在手柄上没有默认键 ⇒ 返回假、一格不动（17 格逐格过：八格回得来、九格本来就无处可回）', () => {
    const homes = UI_INTENTS.filter((i) => cellsOf(UI_BINDS.padButtons, i).length > 0)
    expect(homes, '默认菜单手柄表上有家的就是这八格（名册与表的双射腿）').toEqual(['up', 'down', 'left', 'right', 'confirm', 'back', 'pagePrev', 'pageNext'])
    for (const i of UI_INTENTS) {
      const { store } = rig()
      store.rebindUi(i, 'Pad7')
      const ok = store.resetUi(i, 'pad')
      expect(ok, `${i} 回不回得来手柄那侧，由默认表回答`).toBe(cellsOf(UI_BINDS.padButtons, i).length > 0)
      const pad = store.get().ui.padButtons
      if (!ok) {
        expect(pad, '没家的 ⇒ 那一把留着，也不从别人手里抢一把过来').toEqual({ ...UI_BINDS.padButtons, 7: i })
      } else {
        expect(cellsOf(pad, i), '有家的 ⇒ 逐字回到默认那几把').toEqual(cellsOf(UI_BINDS.padButtons, i))
      }
    }
  })

  it('`resetUi(intent)` 不写第二个参数时还是键盘那一条（既有形状不许被新参数改掉）', () => {
    const { store } = rig()
    store.rebindUi('confirm', 'Pad7')
    store.rebindUi('confirm', 'KeyF')
    expect(store.resetUi('confirm')).toBe(true)
    expect(codesOf(store.get().ui.keyboard, 'confirm'), '键盘那侧整组回来').toEqual(codesOf(UI_BINDS.keyboard, 'confirm'))
    expect(cellsOf(store.get().ui.padButtons, 'confirm'), '而手柄那一把没被顺手抹平：两条通道各一把把手').toEqual([7])
  })

  it('手柄改键跟着档走：那一张表落进 store、读回来逐字不变，且整张夹取幂等', () => {
    const { store } = rig()
    store.rebindUi('confirm', 'Pad7')
    store.setStickThreshold(0.3)
    const saved = store.get()
    const loaded = new BindingsStore(null, saved)
    expect(loaded.get(), '往返不漂移：存档是那张表的落点，不是第二次裁决').toEqual(saved)
    expect(clampBindings(clampBindings(saved)), '再夹一遍一格不变（幂等是往返的前提）').toEqual(saved)
    expect(loaded.get().ui.padButtons[7]).toBe('confirm')
  })

  it('`setStickThreshold` 交回的是**生效**那一个数：越界夹到界上，错型回默认，一次写一次灌', () => {
    const { store, applied } = rig()
    expect(store.setStickThreshold(0.2), '下限压过摇杆静止抖动').toBe(BIND_BOUNDS.stickThreshold.min)
    expect(store.setStickThreshold(2), '上限留一格还推得动的余量').toBe(BIND_BOUNDS.stickThreshold.max)
    expect(store.setStickThreshold(Number.NaN), 'NaN 不是"一个很大的数"，是错型 ⇒ 回默认那一格').toBe(UI_BINDS.stickThreshold)
    expect(store.setStickThreshold(Number.POSITIVE_INFINITY), 'Infinity 同一条').toBe(UI_BINDS.stickThreshold)
    expect(store.setStickThreshold(0.4)).toBe(0.4)
    expect(store.get().ui.stickThreshold, '存的与交回来的必须是同一个数（面板要读的是生效那一个）').toBe(0.4)
    expect(applied.at(-1)!.ui.stickThreshold, '消费者那一格也拿到同一个数').toBe(0.4)
    expect(applied.length, '五写加构造那一次 = 六灌，一次都不许多').toBe(6)
  })

  it('画出了手柄那一列，键盘那一把「解绑」仍只关键盘那半（手柄那侧的「无」另有把手，KI-346）', () => {
    const { store } = rig()
    store.unbindUi('up')
    const u = store.get().ui
    expect(u.unbound, '名单里只有键盘那一组的名字').toEqual(['up'])
    expect(cellsOf(u.padButtons, 'up'), '手柄那侧它照样握着默认那一把 —— 两份名单各管各的那张表').toEqual([12])
    expect(clampBindings({ ui: { ...u, unbound: ['up', 'back', 'fly'] } }).ui.unbound, '手改档里也一样：只有名册上、且不是出口的名字进得来').toEqual(['up'])
  })

  it('整张回默认把手柄那一列与阈值一起带回去（那一格说的是整张，不是某一条通道）', () => {
    const { store } = rig()
    store.rebindUi('confirm', 'Pad7')
    store.setStickThreshold(0.9)
    store.restoreDefaults()
    expect(store.get().ui.padButtons).toEqual(UI_BINDS.padButtons)
    expect(store.get().ui.stickThreshold).toBe(UI_BINDS.stickThreshold)
    expect(store.get().ui.keyboard).toEqual(UI_BINDS.keyboard)
  })
})

describe('KI-346 手柄那一侧的「无」：名单从每通道一份改成每表一份', () => {
  /**
   * 这批立的是一条形状：**「无」说的是"这一行在这一张表上不要"**，不是"这一行不要"。
   * 于是每通道两份名单（`unbound` 管键盘那张、`padUnbound` 管手柄那张），而 `padUnbound`
   * 与键盘那份同一条纪律：只有一个书写者（`clampBindings`）、是那张已解析表的投影、
   * 名册序去重、老档没这一格 = 空名单。手柄那张不回补，所以它没有"回补跳过"那一半，
   * 多出来的是**默认兜底那一遍也要投影**（缺块 ⇒ 默认，但名单点名的那几格不许回来）。
   */
  function rig() {
    const applied: Bindings[] = []
    const store = new BindingsStore({ input: { setBindings: (b: Bindings): void => { applied.push(b) } } })
    return { store, applied }
  }
  const padCells = (pad: Record<number, string>, owner: string): number[] =>
    Object.keys(pad).map(Number).filter((n) => pad[n] === owner).sort((a, b) => a - b)
  /** 默认手柄表去掉这一行的那几格 ⇒「无」应当正好落成这一份，一格不多一格不少 */
  const padWithout = (defaults: Record<number, string>, owner: string): Record<string, string> =>
    Object.fromEntries(Object.entries(defaults).filter(([, v]) => v !== owner))

  it('手柄那一行的「无」写的也是两半：摘掉此刻占的**所有**格、名字进 `padUnbound`，键盘那半一概不沾', () => {
    const { store, applied } = rig()
    store.unbindPad('dodge')
    const g = store.get().gameplay
    expect(padCells(g.padButtons, 'dodge'), '0 与 12 都闪避 ⇒ 两格一把不留（留一把就是"旧键还能闪避"那种鬼键）').toEqual([])
    expect(g.padButtons, '其余每一格照旧：腾出的两格空着，不塞给别人').toEqual(padWithout(DEFAULT_BINDS.padButtons, 'dodge'))
    expect(g.padUnbound, '「没写」是恢复默认，「点名」才是无').toEqual(['dodge'])
    expect(g.unbound, '手柄那一列上点的「无」不写键盘那份名单').toEqual([])
    expect(g.keyboard, '键盘那张一格都不动：关掉手柄不等于洗掉键盘').toEqual(DEFAULT_BINDS.keyboard)
    expect(applied.length, '一次解绑一次灌注').toBe(2)
    expect(applied.at(-1)!.gameplay.padUnbound, '消费者那一份也拿到同一份名单（那一列画的是消费者手里这一份）').toEqual(['dodge'])
  })

  it('两份名单各管各的那张表：谁也不许顺手关对方（一行的四个家里，关掉的是其中一格）', () => {
    const { store } = rig()
    store.unbind('dodge')
    store.unbindPad('parry')
    const g = store.get().gameplay
    expect(g.unbound).toEqual(['dodge'])
    expect(g.padUnbound).toEqual(['parry'])
    expect(padCells(g.padButtons, 'dodge'), '键盘上关掉的动词，在手柄上照旧握着那两把').toEqual([0, 12])
    expect(g.keyboard.KeyG, '手柄上关掉的动词，在键盘上照旧有自己的键').toBe('parry')
    expect(g.padButtons[2], '被关掉的那一把是空的，而不是"没人认领"').toBeUndefined()
  })

  it('夹取那一遍把手柄名单投影到那张表上：档里残留的那一格不算数，缺块也不把默认请回来', () => {
    const residue = clampBindings({ gameplay: { padButtons: { 0: 'dodge', 2: 'parry' }, padUnbound: ['dodge'] } })
    expect(padCells(residue.gameplay.padButtons, 'dodge'), '残留那一格由名单盖掉（"要不要"的主人是名单）').toEqual([])
    expect(residue.gameplay.padButtons[2], '没点名的那一格不受牵连').toBe('parry')
    const noBlock = clampBindings({ gameplay: { padUnbound: ['dodge'] } })
    expect(noBlock.gameplay.padButtons, '整块没写 ⇒ 默认那一份，但名单点名的两格仍然不许回来').toEqual(padWithout(DEFAULT_BINDS.padButtons, 'dodge'))
    expect(noBlock.gameplay.keyboard, '投影只作用于手柄那张：键盘那张一格不少').toEqual(DEFAULT_BINDS.keyboard)
  })

  it('手柄名单自己也是数据：非数组／重复／乱序／名册外都归成"名册序、去重、只认名册"（两张表各量一次）', () => {
    const messy = clampBindings({
      gameplay: { padUnbound: ['parry', 'dodge', 'parry', 'fly', 7, null] },
      ui: { padUnbound: ['down', 'up', 'down', 'fly', 'not-an-intent'] }
    })
    expect(messy.gameplay.padUnbound, '乱序归名册序、重复去掉、名册外与错型丢掉').toEqual(['dodge', 'parry'])
    expect(messy.ui.padUnbound).toEqual(['up', 'down'])
    const wrong = clampBindings({ gameplay: { padUnbound: 'dodge' }, ui: { padUnbound: { 0: 'up' } } })
    expect(wrong.gameplay.padUnbound, '非数组 ⇒ 空名单（"一个都没关"），而不是把整串字符当成名单').toEqual([])
    expect(wrong.ui.padUnbound).toEqual([])
  })

  it('名册外的动作名配不上这一把把手：返回假、一格都不动、名单也不长', () => {
    const { store, applied } = rig()
    for (const junk of ['fly', '__proto__', '', 'constructor']) {
      expect(store.unbindPad(junk as ActionName), `「${JSON.stringify(junk)}」不配进名单`).toBe(false)
      expect(store.get(), '一格都没动').toEqual(defaultBindings())
    }
    expect(applied.length, '没改就不许再灌一遍消费者').toBe(1)
  })

  it('同一行在手柄上关两次 ⇒ 名单不重复，而第二次照样是一次写、一次灌（不做"看起来没变就不灌"那种优化）', () => {
    const { store, applied } = rig()
    store.unbindPad('dodge')
    const before = applied.length
    store.unbindPad('dodge')
    expect(store.get().gameplay.padUnbound, '重复点名不产生第二个格子').toEqual(['dodge'])
    expect(applied.length, '一次动作一次灌注').toBe(before + 1)
  })

  it('手柄那一行的「改键」自己把这一行从手柄名单里退掉，而键盘那份名单一个字不沾', () => {
    const { store } = rig()
    store.unbindPad('dodge')
    store.rebind('dodge', 'Pad2')
    const g = store.get().gameplay
    expect(g.padButtons[2], '按下新的那一把就是"这一行要" ⇒ 名单不许继续盖它').toBe('dodge')
    expect(g.padUnbound, '「无」与"有键"不可能同时成立').toEqual([])
    expect(g.unbound, '键盘那份名单不是这里的账').toEqual([])
    expect(clampBindings(store.get()).gameplay, '再夹一次（存档往返那一拍）不许把这一格抹掉').toEqual(g)
  })

  it('键盘那一行的「改键」不许退掉手柄那份名单：两条通道各有各的「无」', () => {
    const { store } = rig()
    store.unbindPad('parry')
    store.rebind('parry', 'KeyH')
    const g = store.get().gameplay
    expect(g.keyboard.KeyH, '键盘那一格改成了它').toBe('parry')
    expect(g.padUnbound, '手柄上说过不要，键盘上重新要它 —— 那是另一只手的事').toEqual(['parry'])
    expect(padCells(g.padButtons, 'parry'), '名单继续盖着 2 与 15 那两把').toEqual([])
    expect(clampBindings(store.get()).gameplay.padUnbound, '整张夹取幂等：名单还是那一份').toEqual(['parry'])
  })

  it('「手柄回默认」是那一格的出口：整组一起回来、名单一起清，而键盘上那份「无」留着', () => {
    const { store } = rig()
    store.unbind('dodge')
    store.unbindPad('parry')
    expect(store.resetKey('parry', 'pad'), 'parry 在默认手柄表上有两把（2 与 15）').toBe(true)
    const g = store.get().gameplay
    expect(padCells(g.padButtons, 'parry'), '整组回来，不是只补一把').toEqual([2, 15])
    expect(g.padUnbound, '点了回默认、屏幕上的「无」还挂着 = 一句假话').toEqual([])
    expect(g.unbound, '键盘上那句"不要"不是这一格该替玩家收回的话').toEqual(['dodge'])
    expect(padCells(g.padButtons, 'dodge'), '而键盘那份名单也不作用于手柄那张').toEqual([0, 12])
  })

  it('「回默认」不写第二个参数时还是键盘那一条：不许顺手收回手柄那份「无」', () => {
    const { store } = rig()
    store.unbindPad('parry')
    expect(store.resetKey('parry'), '键盘那一格有默认的家').toBe(true)
    const g = store.get().gameplay
    expect(g.keyboard.KeyG, '键盘那张回了自己的默认键').toBe('parry')
    expect(g.padUnbound, '手柄那份名单不是这一把把手的账（与 KI-343 那条同形）').toEqual(['parry'])
    expect(padCells(g.padButtons, 'parry'), '那一列仍被名单盖着').toEqual([])
  })

  it('菜单那侧的出口那一格进不来：两列两把把手读的是同一份名册，档里手写那一格也被丢掉', () => {
    const { store, applied } = rig()
    expect(store.unbindUiPad('back'), '「菜单必须走得出去」不只管键盘那一半').toBe(false)
    expect(store.get().ui.padUnbound).toEqual([])
    expect(store.get().ui.padButtons, '一格都没动').toEqual(UI_BINDS.padButtons)
    expect(applied.length, '拒绝不留第二次灌注').toBe(1)
    const hand = clampBindings({ ui: { padUnbound: ['back', 'up', 'fly'] } })
    expect(hand.ui.padUnbound, '同一个主人读两份名单：出口与名册外的名字都进不来').toEqual(['up'])
    expect(padCells(hand.ui.padButtons, 'up'), '投影到那一列 ⇒ 十字上那一把（12）不回来').toEqual([])
    expect(hand.ui.unbound, '而键盘那份名单是另一格，不跟着长').toEqual([])
  })

  it('那一行在手柄上没有家也关得掉：格子集合不变、名单里有它，而「手柄改键」是它的第二个出口', () => {
    const { store } = rig()
    expect(store.unbindUiPad('pick1'), '九格直选在手柄上本来就没有家 ⇒ 关掉的不是某一把键，是"以后也不许有家"').toBe(true)
    expect(store.get().ui.padUnbound).toEqual(['pick1'])
    expect(store.get().ui.padButtons, '本来就没有 ⇒ 一格都不动（不是"没反应"，是"无事可做"）').toEqual(UI_BINDS.padButtons)
    store.rebindUi('pick1', 'Pad3')
    expect(store.get().ui.padButtons[3], '改键算数').toBe('pick1')
    expect(store.get().ui.padUnbound, '改键就是那一格的第二个出口（与键盘那条同一纪律）').toEqual([])
  })

  it('菜单那一半的「手柄回默认」也是那一格的出口：整组回来、名单一起销，而键盘那份「无」留着', () => {
    const { store } = rig()
    store.unbindUi('up')
    store.unbindUiPad('up')
    const both = store.get().ui
    expect(padCells(both.padButtons, 'up'), '两列都关掉 ⇒ 手柄上 12 那一把先没了').toEqual([])
    expect(both.unbound, '而键盘那份名单点名的还是它（两份名单各盖一张表）').toEqual(['up'])
    expect(store.resetUi('up', 'pad'), '那一行在手柄上有默认键 ⇒ 回得来').toBe(true)
    const u = store.get().ui
    expect(padCells(u.padButtons, 'up'), '整组回来（默认菜单手柄表上它就一把）').toEqual([12])
    expect(u.padUnbound, '点了「手柄回默认」、那一列还写着「无」＝一句假话（与玩法那一半的出口同一形状）').toEqual([])
    expect(u.unbound, '键盘上那句"不要"不是这一格该替玩家收回的话').toEqual(['up'])
    expect(clampBindings(store.get()).ui.padButtons, '再夹一次不许把那一把抹掉：名单退了，投影就不盖它').toEqual(UI_BINDS.padButtons)
  })

  it('整张回默认把四份名单一起清空：那一格回答的是两节 × 两列', () => {
    const { store } = rig()
    store.unbind('dodge')
    store.unbindPad('parry')
    store.unbindUi('up')
    store.unbindUiPad('down')
    store.restoreDefaults()
    const b = store.get()
    expect([b.gameplay.unbound, b.gameplay.padUnbound, b.ui.unbound, b.ui.padUnbound], '四份名单一起清空').toEqual([[], [], [], []])
    expect(b.gameplay.padButtons).toEqual(DEFAULT_BINDS.padButtons)
    expect(b.ui.padButtons).toEqual(UI_BINDS.padButtons)
  })

  it('交出去的每份名单都是副本，默认快照里两份手柄名单是空数组（原件与消费者都碰不到）', () => {
    const { store, applied } = rig()
    const snap = defaultBindings()
    expect(snap.gameplay.padUnbound, '默认值是"一个都没关"').toEqual([])
    expect(snap.ui.padUnbound).toEqual([])
    snap.gameplay.padUnbound.push('dodge')
    snap.ui.padUnbound.push('up')
    expect(store.get().gameplay.padUnbound, '改快照的副本碰不到原件').toEqual([])
    const g = store.get()
    g.gameplay.padUnbound.push('dodge')
    g.ui.padUnbound.push('up')
    store.unbindPad('parry')
    expect(store.get().gameplay.padUnbound, 'store 手里那份没被碰').toEqual(['parry'])
    expect(applied.at(-1)!.gameplay.padUnbound, '灌给消费者的那一份里只有它自己那一次').toEqual(['parry'])
    expect(applied.at(-1)!.ui.padUnbound).toEqual([])
  })

  it('两份新手柄名单跟着档走：读回来逐字还是它们、再夹一次不漂移，而老档没这两格 = 空名单（v14 不必升版）', () => {
    const blob = { gameplay: { keyboard: { KeyQ: 'dodge' }, padUnbound: ['parry'] }, ui: { padButtons: { 3: 'confirm' }, padUnbound: ['down'] } }
    const one = clampBindings(blob)
    expect(one.gameplay.padUnbound).toEqual(['parry'])
    expect(one.ui.padUnbound).toEqual(['down'])
    expect(clampBindings(one), '幂等：存档往返不许漂移（两份新名单也在内）').toEqual(one)
    const legacy = clampBindings({ gameplay: { unbound: ['dodge'] }, ui: { unbound: ['back'] } })
    expect([legacy.gameplay.padUnbound, legacy.ui.padUnbound], '老档没有这两格 ⇒ 空名单，不是"全关"').toEqual([[], []])
    expect(legacy.ui.unbound, '而"back 是出口"那条裁决在老档上照样生效（键盘那份名单丢掉它）').toEqual([])
    expect(legacy.gameplay.unbound).toEqual(['dodge'])
  })
})

/* ------------------------------------------------------------------ KI-348 */

/**
 * KI-348：玩法那一半从今天起也交出一份**落点回报**。
 *
 * 在这一道之前，「落到哪张表」只有菜单那条通道回答（`rebindUi`），玩法那一半把裁决留给了面板——
 * 面板于是按「我等的是哪种传感器」猜落点。那一猜在跨表那一格上必然说错话：等的是键盘、作答的是一枚手柄键，
 * 屏幕上就同时出现「这把键原本是空着的」与一枚挂错列的记号。这里的判据只问边界交回的那份形状，
 * 三件事各自有名字：`onto` 说的是**被写进的那张表**（不是传感器），`moved` 只在真腾出格子时被补回去时才成立，
 * 而**拒绝**交回的是 `null`——那说的是「这一次没发生」，不是一套 `{ displaced: null }`（那说的是「这一把原本没有别人」）。
 */
describe('KI-348 玩法那一半的落点回报：形状、`onto`、以及「拒绝」与「空着」不是一件事', () => {
  function rig() {
    const applied: Bindings[] = []
    const store = new BindingsStore({ input: { setBindings: (b: Bindings): void => { applied.push(b) } } })
    return { store, applied }
  }
  const cellsOf = (row: Record<string, string>, owner: string): string[] =>
    Object.keys(row).filter((k) => row[k] === owner).sort()
  const padCellsOf = (row: Record<number, string>, owner: string): number[] =>
    Object.keys(row).map(Number).filter((n) => row[n] === owner).sort((a, b) => a - b)
  /** 面板手里只有这一份字段名册 ⇒ 多一格少一格都在这里红，不需要谁去读实现 */
  const SHAPE = ['displaced', 'moved', 'onto']

  it('两条通道 × 两张表交回的是同一个字段名册：面板没有第二个形状可对', () => {
    const { store } = rig()
    const replies = [
      store.rebind('parry', 'ControlLeft'), store.rebind('dodge', 'Pad2'),
      store.rebindUi('confirm', 'KeyF'), store.rebindUi('pick1', 'Pad1'),
    ]
    for (const [i, r] of replies.entries()) expect(r, `第 ${i + 1} 次改键要做得成，否则形状无从对账`).not.toBeNull()
    for (const r of replies) expect(Object.keys(r as object).sort(), '形状只有一个主人').toEqual(SHAPE)
  })

  it('键盘那一半回答落点：抢走 Ctrl ⇒ 闪避搬进弹反腾出的 G，而 `onto` 说的是被写进的那张表', () => {
    const { store } = rig()
    expect(store.rebind('parry', 'ControlLeft')).toEqual({ displaced: 'dodge', moved: true, onto: 'keyboard' })
    const k = store.get().gameplay.keyboard
    expect(k.ControlLeft).toBe('parry')
    expect(k.KeyG, '闪避不是被扔掉的：它领走弹反腾出的那一格').toBe('dodge')
    expect(store.get().gameplay.padButtons, '键盘改键一格都不分手柄那张').toEqual(DEFAULT_BINDS.padButtons)
  })

  it('手柄那一半的 `onto` 是 pad：抢 2 号 ⇒ parry 少了这一把、搬进 0 号 ⇒ 这才叫 moved', () => {
    const { store } = rig()
    expect(store.rebind('dodge', 'Pad2')).toEqual({ displaced: 'parry', moved: true, onto: 'pad' })
    const g = store.get().gameplay
    expect(padCellsOf(g.padButtons, 'parry')).toEqual([0, 15])
    expect(g.keyboard, '手柄改键不碰键盘那张（那条路自己的四把等价键一把不少）').toEqual(DEFAULT_BINDS.keyboard)
  })

  it('目标那一格原本空着 ⇒ `displaced` 与 `moved` 一起落空（两半各一条）', () => {
    const { store } = rig()
    expect(store.rebind('parry', 'KeyY'), 'Y 在默认键盘表上没人').toEqual({ displaced: null, moved: false, onto: 'keyboard' })
    expect(store.rebind('dodge', 'Pad19'), '19 号在默认手柄表上没人').toEqual({ displaced: null, moved: false, onto: 'pad' })
    expect(cellsOf(store.get().gameplay.keyboard, 'parry'), '空格那一支是搬家不是复制：弹反不许同时占着 G 与 Y（鬼键形状）').toEqual(['KeyY'])
  })

  /**
   * 这一条钉的是一段推理，不是一句措辞：`moved=false` 里面装着两种完全不同的事——原主人还握着别把，
   * 或者它在这一列上彻底没了家。键盘那张有回补所以后者基本不发生，**手柄那张不回补**（`movePadRow`
   * 只能把这行腾出的格子分给它，而这一行可能一格都没占）。让面板自己去数那张表就是给搬家裁决添第二个
   * 书写者，所以「还剩几格」由边界在 `moved` 里回答，而这一格量的是那个回答对应的现实。
   */
  it('`moved=false` 不许被读成「它还有其余把手」：手柄不回补 ⇒ 冲刺从 7 号掉下来后在这一列上一格不剩', () => {
    const { store } = rig()
    store.unbindPad('ability1')
    expect(store.rebind('ability1', 'Pad7')).toEqual({ displaced: 'sprint', moved: false, onto: 'pad' })
    const g = store.get().gameplay
    expect(padCellsOf(g.padButtons, 'sprint'), '没有格子可补 ⇒ 它在这一列上没家了').toEqual([])
    expect(g.keyboard.ShiftLeft, '而另一列上它还有键：那句「其余把手不动」只对键盘说，对手柄说就是假话').toBe('sprint')
    expect(g.padUnbound, '改键就是那一行把手柄那句「不要」撤回：名单里不许留一个此刻有键的名字')
      .toEqual([])
  })

  it('拒绝交回的是 `null`，不是一套 `{ displaced: null }`：越界那一串一格不动、一次都不灌', () => {
    const { store, applied } = rig()
    const before = store.get()
    for (const junk of ['Pad20', 'Padx', 'Pad-1', 'Pad07']) {
      expect(store.rebind('dodge', junk), `${junk} 说的是手柄，而语法或界域不认 ⇒ 那一次没发生`).toBeNull()
    }
    expect(store.get(), '四次拒绝，两张表一个字节都没动').toEqual(before)
    expect(applied.length, '拒绝不灌注：构造那一次之后一次都不许多').toBe(1)
  })

  it('菜单那一半的裁决没被这次改动挪动：抢走 Enter 的 confirm 还剩三把等价键 ⇒ moved=false', () => {
    const { store } = rig()
    expect(store.rebindUi('pick1', 'Enter')).toEqual({ displaced: 'confirm', moved: false, onto: 'keyboard' })
    expect(cellsOf(store.get().ui.keyboard, 'confirm'), '整组是菜单那一行的单元：少一把不等于搬家').toEqual(['KeyE', 'NumpadEnter', 'Space'])
  })
})

/* ------------------------------------------------- KI-348 补：键盘那一半的可达性 */

/**
 * 反向臂 A6 在这一格里连量两版都是**等价变异**（0 红），追问之下读出来的不是判据缺口，是形状：
 * `clampBindings` 那一遍把键盘那张折成**每个动作恰好一格**（档里同一动词写两把也只留一把），
 * 于是「有人被换出去、而它没搬家」在玩法键盘那一条路上**结构上到不了**——`swapOf` 的第四个参数
 * 在这一条路上因此不可观测。这条腿把那句推理钉成实测：`Bindings.ts` 里 `Swap` 的注释从此有证人，
 * 而不是只有一段读起来像真的话。
 */
describe('KI-348 键盘那张每动作恰好一格：`moved=false` 在这一条路上到不了（A6 两版同义的来历）', () => {
  const cells = (row: Record<string, string>, owner: string): string[] => Object.keys(row).filter((k) => row[k] === owner).sort()

  it('档里同一动词写两把也只剩一把：键盘那张不是"多对一"的表，回补因此总是替被抢走那一格找家', () => {
    const two = clampBindings({ gameplay: { keyboard: { KeyW: 'dodge', ControlLeft: 'dodge', KeyG: 'parry' } } })
    expect(cells(two.gameplay.keyboard, 'dodge'), '两把写成一个动作 ⇒ 折成一格（第二把不算数）').toEqual(['ControlLeft'])
    expect(two.gameplay.keyboard.KeyW, '腾出来的那一格交给回补，而不是留给同一个动作').not.toBe('dodge')
    for (const a of BINDABLE_ACTIONS) {
      expect(cells(two.gameplay.keyboard, a).length, `${a} 在键盘那张上恰好一格`).toBe(1)
    }
  })

  it('键盘那一条路的落点回报恒有下半句可说：抢走别人的那一把 ⇒ 它必然搬进腾出的那一格', () => {
    const store = new BindingsStore({ input: { setBindings: () => {} } })
    expect(store.rebind('parry', 'ControlLeft'), '闪避唯一的 Ctrl 被抢走 ⇒ 它搬进弹反腾出的 G').toEqual({ displaced: 'dodge', moved: true, onto: 'keyboard' })
    expect(cells(store.get().gameplay.keyboard, 'dodge'), '而它没有"少一把、没别处"那种形状').toEqual(['KeyG'])
    store.unbind('jump')
    expect(store.rebind('jump', 'KeyW'), '名单里的动词重新上台：moveUp 被换出去、jump 搬进 W，两半各得其所')
      .toEqual({ displaced: 'moveUp', moved: true, onto: 'keyboard' })
    expect(cells(store.get().gameplay.keyboard, 'moveUp'), '而 moveUp 领走 jump 腾出的那一格').toEqual(['Space'])
  })
})

/**
 * KI-360：鼠标那三格在**两张表**上不再是同一个意思。语法早就收它们（`CODE_RE` 里那一格就是为
 * 这三格开的，默认表把轻击与重击挂在鼠标上），所以这一批要钉的不是"收不收"，而是"谁读得到"：
 * 玩法那一列的读者是 `Input` 的 `mousedown`（它自己从 `e.button` 造出同一个名字），
 * 菜单那一列的读者只有 `keydown` 的 `e.code`——`MouseLeft` 写进那张表就是一个永远无人按得到的键。
 * 捕获那一路现在两种传感器都会作答，所以这条差别必须由**边界**按表回答（面板不认传感器名字，
 * 那是 KI-343 立的口径），而不是让语法再分一次岔。
 */
describe('KI-360 鼠标那三格：玩法那张收、菜单那张拒——分的不是语法，是读者', () => {
  const mouseCells = (kb: Record<string, unknown>): string[] => Object.keys(kb).filter((c) => /^Mouse/.test(c)).sort()

  it('手改档里给菜单那一列塞一枚鼠标键 ⇒ 那一格掉，同一段里合法的那一把留（夹取不整块回退）', () => {
    const clamped = clampBindings({ ui: { keyboard: { MouseLeft: 'confirm', KeyF: 'confirm' } } })
    expect(clamped.ui.keyboard.MouseLeft, '菜单那条通道没有读鼠标名的那一路').toBeUndefined()
    expect(Object.keys(clamped.ui.keyboard).filter((c) => clamped.ui.keyboard[c] === 'confirm'), '那一行落回玩家给的这一把')
      .toEqual(['KeyF'])
    const g = clampBindings({ gameplay: { keyboard: { MouseMiddle: 'parry' } } })
    expect(g.gameplay.keyboard.MouseMiddle, '同一枚码在玩法那张是有读者的一格 ⇒ 如实收下').toBe('parry')
  })

  it('`rebindUi(意图, 一枚鼠标键)` 是**拒绝**：返回 null、一格不动、一次不灌（面板不许替玩家圆场）', () => {
    const applied: Bindings[] = []
    const store = new BindingsStore({ input: { setBindings: (b: Bindings): void => { applied.push(b) } } })
    expect(store.rebindUi('confirm', 'MouseLeft'), '语法过关不等于这一列收得下').toBeNull()
    expect(store.get().ui.keyboard, '整张菜单表逐字没动').toEqual(UI_BINDS.keyboard)
    expect(mouseCells(store.get().ui.keyboard), '一张表里不许住着一种没人读的键').toEqual([])
    expect(applied.length, '拒绝了就没有写入，也就没有第二次灌注').toBe(1)
    expect(store.rebind('dodge', 'MouseMiddle'), '同一名义下玩法那条照常落点：那一格有读者').toEqual({ displaced: null, moved: false, onto: 'keyboard' })
    expect(store.get().gameplay.keyboard.MouseMiddle).toBe('dodge')
  })

  it('手柄那一枚仍能绑菜单那一行：拒的是传感器这一格，不是整条通道', () => {
    const store = new BindingsStore({ input: { setBindings: () => {} } })
    expect(store.rebindUi('confirm', 'Pad0'), '等键盘那一次的答案换成手柄那一枚 ⇒ 走 `ui.padButtons`').not.toBeNull()
    expect(store.get().ui.padButtons[0], '而它落的是菜单那张手柄表').toBe('confirm')
    expect(mouseCells(store.get().ui.keyboard), '菜单那张键盘表到过这一拍仍然一格鼠标都没有').toEqual([])
  })
})

/* ------------------------------------------------------------------ KI-362 */

/**
 * KI-362：ui-ux §5.1／§6 那句「3 套配置文件」今天第一次是**数据**。
 *
 * 形状是一盒**磁带**，不是第四张表：运行时那一格（`current`）仍然只有一个主人，磁带格存的是
 * 「某一刻那张表的快照」，而 `loadProfile` 是把快照请回运行时的那一步——唯一一步。于是这一组量四件事：
 *  ① **三格定长**——文档写的是 3 不是 n，这个数只许有一个主人（`PROFILE_SLOTS`）；档里多写的那一格
 *     丢掉，不许留着一份没人读的表（§55）。
 *  ② **「没写过」与「清空了」不是一个意思**——一格磁带的空态是 `null`，而 `{}` 是一张完整的默认表；
 *     混起来就是 KI-336 那一批反复抓的那个形状（缺块与写了空块共用同一个空缺格）。
 *  ③ **快照不是活引用**——存进去之后改键、改交出去的那一份，都不许动到那三格里。磁带若住的是同一张
 *     对象，「存三套」就变成「存一套看三遍」，而玩家毁掉的是他以为自己存好的那两盒。
 *  ④ **三格与运行时各归各**——`storeProfile` 与 `applyProfiles` 都不灌消费者（没换玩家在用的那张表，
 *     就不许让消费者看见一次新的）；只有 `loadProfile` 那一步灌，而且恰好一次。
 *
 * `raw` 在这里一律当成玩家手改过的存档，判据与上面那几组同一把尺：任何 blob 只能装出玩得下去的那一类。
 */
describe('KI-362 配置文件那三格：定长、快照、以及「没写过」与「清空了」不是一件事', () => {
  const junkBlob = ['', 7, null, undefined, 'KeyQ', {}, { 0: 'x' }, true]

  it('格数写死在这里正是为了量它：`PROFILE_SLOTS` ＝ 3（ui-ux §5.1／§6 那句「3 套配置文件」的那个 3）', () => {
    expect(PROFILE_SLOTS).toBe(3)
    for (const junk of junkBlob) {
      expect(clampProfiles(junk), `raw＝${String(junk)}`).toHaveLength(PROFILE_SLOTS)
    }
    expect(clampProfiles(undefined), '没写过这块 ⇒ 三格都是空磁带，不是三张默认表').toEqual([null, null, null])
  })

  it('短一格／多一格的档都归成三格：多出来的那一格丢掉（同一份数据不许有第四个读者）', () => {
    const one = defaultBindings()
    expect(clampProfiles([one])).toHaveLength(PROFILE_SLOTS)
    expect(clampProfiles([one, one, one, one, one]), '手改档凭空多写的那两格不进来').toHaveLength(PROFILE_SLOTS)
    expect(clampProfiles([one, undefined, one])[1], '中间那一格没写 ⇒ 空磁带（不是整块回退）').toBeNull()
    const sparse = clampProfiles([, one])
    expect(sparse[0], '稀疏数组那一格读成「没写」，与 undefined 同一个意思').toBeNull()
    expect(sparse[1]).not.toBeNull()
  })

  it('一格里的脏表走 `clampBindings` 那一道，而不是整格作废：毒键掉、合法那格留', () => {
    const cell = clampProfiles([{ gameplay: { keyboard: JSON.parse('{"__proto__":{"x":1},"<img>":"dodge","KeyE":"fly","KeyQ":"dodge"}') } }])[0]
    expect(cell, '写了这一格就是要它 ⇒ 夹成玩得下去的那一张，而不是读成「空磁带」').not.toBeNull()
    const kb = cell!.gameplay.keyboard
    expect(Object.prototype.hasOwnProperty.call(kb, '__proto__'), '毒键没进表').toBe(false)
    expect(kb['<img>'], '尖括号那把同样进不来').toBeUndefined()
    expect(Object.values(kb), '名册外的 fly 落榜').not.toContain('fly' as ActionName)
    expect(kb.KeyQ, '合法那一格照整张语义生效').toBe('dodge')
    for (const a of BINDABLE_ACTIONS) expect(Object.values(kb), `${a} 在这份手改磁带里仍有键`).toContain(a)
  })

  it('一格磁带的两种空写法同义，而「写了空块」是另一件事：`null`／缺格＝空磁带，`{}`＝一张完整的默认表', () => {
    expect(clampProfiles([null])[0], '明写 null').toBeNull()
    expect(clampProfiles([{}])[0], '明写空块 ⇒ 如实是一张整表（与缺块不是一个意思）').toEqual(defaultBindings())
    expect(clampProfiles([{ gameplay: {}, ui: {} }])[0], '块在而块内空 ⇒ 两张各自回默认，仍然是「有这一盒」').toEqual(defaultBindings())
  })

  it('幂等＋JSON 往返不漂移：夹过的磁带再夹一次、序列化回来再夹一次，三格逐字不动', () => {
    const one = clampBindings({ gameplay: { keyboard: { KeyQ: 'dodge' } }, ui: { stickThreshold: 0.4 } })
    const once = clampProfiles([one, null, clampBindings({ gameplay: { unbound: ['dodge'] } })])
    expect(clampProfiles(once), '第二次夹取一格都不该再动').toEqual(once)
    expect(clampProfiles(JSON.parse(JSON.stringify(once))), '过一遍 JSON 也不漂（存档那一拍走的就是这条路）').toEqual(once)
  })

  it('夹取不留外来引用：改过传进来的那个对象，交出去的那一格不动（磁带不许住在玩家手里的对象上）', () => {
    const raw = { gameplay: { keyboard: { KeyQ: 'dodge' } } }
    const out = clampProfiles([raw])[0]!
    raw.gameplay.keyboard.KeyQ = 'jump'
    expect(out.gameplay.keyboard.KeyQ, '夹取那一步重建了整张表 ⇒ 快照与原对象已经分家').toBe('dodge')
  })

  it('列表只认数组：对象形的磁带读成「没写过」，与 KI-336 那条 `unbound` 是同一条口径', () => {
    expect(clampProfiles({ 0: { gameplay: { keyboard: { KeyQ: 'dodge' } } } }), '凭空造一个"按下标写"的对象不是一种形状').toEqual([null, null, null])
  })

  it('store 起手三格全空，而且空到档里那块干脆不写（§78 留空是如实：「三盒空磁带」不是「没写过」的另一种写法）', () => {
    const applied: Bindings[] = []
    const store = new BindingsStore({ input: { setBindings: (b: Bindings): void => { applied.push(b) } } })
    expect(store.profileFlags(), '面板问「这一格里有没有东西」读的就是这一份').toEqual([false, false, false])
    expect(store.getProfiles(), '一盒都没存 ⇒ 交回 undefined，档里那一格跟着不写').toBeUndefined()
    expect(applied.length, '构造那一次之后一次都不许多').toBe(1)
  })

  it('`storeProfile` 抄走的是此刻那张表：说得出「原来那一格是空的」，而且一次都不灌（存磁带不换玩家在用的键）', () => {
    const applied: Bindings[] = []
    const store = new BindingsStore({ input: { setBindings: (b: Bindings): void => { applied.push(b) } } })
    store.rebind('dodge', 'KeyQ')
    expect(store.storeProfile(0), '存进一格空磁带 ⇒ 回答 new').toBe('new')
    expect(applied.length, '存入不许灌第二次：玩家手里的键一个都没变').toBe(2)
    expect(store.profileFlags()).toEqual([true, false, false])
    expect(store.getProfiles()![0], '存进去的就是此刻那张表').toEqual(store.get())
    expect(store.getProfiles()![0]!.gameplay.keyboard.KeyQ, '改过的那一格带得走').toBe('dodge')
  })

  it('快照不是活引用：存完之后改键、改交出去的那一份，都不动那一格（三盒共一张对象就是「存一套看三遍」）', () => {
    const store = new BindingsStore({ input: { setBindings: () => {} } })
    store.storeProfile(1)
    const saved = store.getProfiles()![1]!
    store.rebind('dodge', 'KeyQ')
    store.unbind('jump')
    expect(saved.gameplay.keyboard.KeyQ, '运行时改键不追进磁带：那一格里仍是当时那一位主人').toBe('lockOn')
    expect(saved.gameplay.unbound, '运行时解绑也不追进磁带').toEqual([])
    const copy = store.getProfiles()!
    copy[1]!.gameplay.keyboard.KeyA = 'dodge'
    copy[0] = defaultBindings()
    expect(store.getProfiles()![1]!.gameplay.keyboard.KeyA, '改交出去的那一份动不到 store').toBe('moveLeft')
    expect(store.getProfiles()![0], '而那格本来就是空的，外面塞一整张也塞不进').toBeNull()
  })

  it('`loadProfile` 是唯一把磁带请回运行时的那一步：空格回答「没做」且零灌注，有格恰好灌一次', () => {
    const applied: Bindings[] = []
    const store = new BindingsStore({ input: { setBindings: (b: Bindings): void => { applied.push(b) } } })
    expect(store.loadProfile(0), '空磁带 ⇒ 没有东西可载入').toBe(false)
    expect(applied.length, '拒绝不灌注：没换表就不许让消费者看见一次新的').toBe(1)
    store.rebind('dodge', 'KeyQ')
    expect(store.storeProfile(0)).toBe('new')
    const saved = store.getProfiles()![0]!
    store.rebind('dodge', 'KeyE')
    expect(store.get().gameplay.keyboard.KeyE).toBe('dodge')
    const before = applied.length
    expect(store.loadProfile(0), '有东西那一格做得成').toBe(true)
    expect(applied.length - before, '一次载入一次灌注').toBe(1)
    expect(store.get().gameplay.keyboard, '整张换成那一盒里的').toEqual(saved.gameplay.keyboard)
    expect(store.get().gameplay.keyboard.KeyQ, '存进去的那一把回来了').toBe('dodge')
    expect(store.get().gameplay.keyboard.KeyE, '刚才那一把不在磁带里 ⇒ 载入之后那一格回它当时的主人（E 还是交互）').toBe('interact')
  })

  it('覆盖已有那一格说得出来，而载入不许把磁带自己洗掉（读三遍不会把盒子读空）', () => {
    const store = new BindingsStore({ input: { setBindings: () => {} } })
    store.storeProfile(2)
    const before = store.getProfiles()![2]!
    store.rebind('jump', 'KeyB')
    expect(store.storeProfile(2), '已有东西那一格再存 ⇒ 回答 overwritten，面板据此说「覆盖」').toBe('overwritten')
    expect(store.getProfiles()![2]!.gameplay.keyboard.KeyB, '存进去的是新那一张').toBe('jump')
    for (let i = 0; i < 3; i++) expect(store.loadProfile(2)).toBe(true)
    expect(store.get().gameplay.keyboard.KeyB, '运行时现在是磁带那一张').toBe('jump')
    expect(store.getProfiles()![2]!.gameplay.keyboard.KeyB, '读三遍那一格还在，而且是同一张：载入不反向洗磁带').toBe('jump')
    expect(before.gameplay.keyboard.KeyB, '而第一次交出去的那一份仍是当时的快照').toBeUndefined()
  })

  it('界外的下标（-1／3／1.5／NaN／非数）三个把手一律回答「没做」：一格不动、磁带不少一格', () => {
    const applied: Bindings[] = []
    const store = new BindingsStore({ input: { setBindings: (b: Bindings): void => { applied.push(b) } } })
    for (const i of [-1, 3, 9, 1.5, NaN, '0' as unknown as number, null as unknown as number]) {
      expect(store.storeProfile(i), `storeProfile(${String(i)}) ⇒ 界外是拒绝，不是"存到别处"`).toBeNull()
      expect(store.loadProfile(i), `loadProfile(${String(i)})`).toBe(false)
    }
    expect(applied.length, '七趟一次都没灌').toBe(1)
    expect(store.getProfiles(), '三格还是三格空').toBeUndefined()
    expect(store.profileFlags()).toEqual([false, false, false])
  })

  it('`applyProfiles`：没写这块不动（老档如实）、写了空数组清空（那是另一件事）、脏 blob 夹过再进格，而且一次都不灌', () => {
    const applied: Bindings[] = []
    const store = new BindingsStore({ input: { setBindings: (b: Bindings): void => { applied.push(b) } } })
    store.storeProfile(0)
    const before = store.getProfiles()!
    store.applyProfiles(undefined)
    store.applyProfiles(null)
    expect(store.getProfiles(), '档里没这块 ⇒ 磁带一格不动（§78 与 `restore(undefined)` 同一个裁决）').toEqual(before)
    store.applyProfiles([])
    expect(store.profileFlags(), '明写了空数组 ⇒ 如实清空，与「没写过」不是一件事').toEqual([false, false, false])
    store.applyProfiles(JSON.parse('[{"gameplay":{"keyboard":{"<img>":"dodge","KeyQ":"dodge"}}},null,{"ui":{"stickThreshold":9}}]'))
    const g = store.getProfiles()!
    expect(g, '三格定长').toHaveLength(PROFILE_SLOTS)
    expect(g[0]!.gameplay.keyboard['<img>'], '毒键在每一格里同样进不来').toBeUndefined()
    expect(g[0]!.gameplay.keyboard.KeyQ).toBe('dodge')
    expect(g[1], '明写 null 那一格还是空的').toBeNull()
    expect(g[2]!.ui.stickThreshold, '越界的数在这一格同样被夹住').toBe(BIND_BOUNDS.stickThreshold.max)
    expect(applied.length, '磁带进来的是数据，不是玩家此刻那张表 ⇒ 一次都不灌').toBe(1)
    expect(store.get(), '而运行时那张表逐字没动：换现表只有 `loadProfile` 那一步').toEqual(defaultBindings())
  })
})

/* ------------------------------------------------------------------ KI-363 */

/**
 * KI-363：KI-362 还欠③那一格——那三盒第一次有「清空」这把把手。
 *
 * 要裁决的是那句欠账自己提出的问：**「清空」与「没写过」在 UI 上是不是同一句话**。答案分两半，
 * 而这一组就是照着这两半量的：
 *  ① **在档上是同一句话**：三盒全空 ⇒ `getProfiles()` 交回 `undefined` ⇒ 存档那一格整个不写。
 *     「清空过」不许留下 `[null,null,null]` 这种第二种「没写过」的写法（§78 那条纪律的同一个结论，
 *     与 `applyProfiles([])`、与从没存过，三条路回来同形）。
 *  ② **在界面上不是同一句话**：清空是玩家按下去的一次动作，动作要有回声；而初始那个空态没有人按过，
 *     没有回声。所以 `clearProfile` 交回的是**那一格原来有没有东西**（与 `storeProfile` 那个
 *     `'new'`／`'overwritten'` 同一个形状），面板据此说得出「已清空」，而不自己数第几次。
 *
 * 另一条口径是从 KI-362 ④ 直接接过来的：**清空只动磁带那一格，一个键都不灌**。清空不是「回默认」，
 * 也不是「把刚载入那张倒回去」——玩家手里那张表与那三盒本来就不是同一格数据（那是 KI-362 ① 的理由）。
 */
describe('KI-363 那一格的「清空」：请回空的是磁带，不是运行时', () => {
  it('清空改的是磁带那一格：`profileFlags` 跟着变，而运行时那张逐字不动、一次都不灌', () => {
    const applied: Bindings[] = []
    const store = new BindingsStore({ input: { setBindings: (b: Bindings): void => { applied.push(b) } } })
    store.rebind('dodge', 'KeyQ')
    store.storeProfile(0)
    const live = store.get()
    expect(store.clearProfile(0), '那一格里有东西 ⇒ 清得动').toBe(true)
    expect(store.profileFlags(), '面板那一行从此读成「空」').toEqual([false, false, false])
    expect(store.get(), '清空磁带不是回默认：玩家手里那张一个键都没变').toEqual(live)
    expect(applied.length, '与「存入」同一句话——没换表就不许让消费者看见一次新的').toBe(2)
  })

  it('空盒上的「清空」是「没有东西可清空」：回答没做、三格不动、一句回声都不该有', () => {
    const applied: Bindings[] = []
    const store = new BindingsStore({ input: { setBindings: (b: Bindings): void => { applied.push(b) } } })
    for (let i = 0; i < PROFILE_SLOTS; i++) expect(store.clearProfile(i), `第 ${i} 盒本来就没东西`).toBe(false)
    expect(applied.length, '三趟一次都没灌').toBe(1)
    expect(store.getProfiles(), '「清空」不替玩家凭空造出一格，也不把那一格写成空块').toBeUndefined()
  })

  it('界外的下标这把同样拒绝（-1／3／9／1.5／NaN／字符串／null）：那一格里的东西不受牵连', () => {
    const store = new BindingsStore({ input: { setBindings: () => {} } })
    store.storeProfile(1)
    for (const i of [-1, 3, 9, 1.5, NaN, '1' as unknown as number, null as unknown as number]) {
      expect(store.clearProfile(i), `clearProfile(${String(i)}) ⇒ 界外是拒绝，不是「清到别处」`).toBe(false)
    }
    expect(store.profileFlags(), '第二盒仍在，别的盒也没被顺手清空').toEqual([false, true, false])
  })

  it('三盒里清空是一格的事：另两盒逐字不动（「清空这一套」不许读成「清空全部」）', () => {
    const store = new BindingsStore({ input: { setBindings: () => {} } })
    store.rebind('dodge', 'KeyQ')
    store.storeProfile(0)
    store.rebind('jump', 'KeyB')
    store.storeProfile(1)
    const keep = JSON.stringify(store.getProfiles()![1])
    expect(store.clearProfile(0)).toBe(true)
    expect(store.getProfiles()![0], '被点名的那一格才是空的').toBeNull()
    expect(store.getProfiles()![1], '另一盒逐字还在').toEqual(JSON.parse(keep))
    expect(store.profileFlags()).toEqual([false, true, false])
  })

  it('清空把「原来那一格有没有东西」重新归零：再存回答 new、再载入回答没做', () => {
    const store = new BindingsStore({ input: { setBindings: () => {} } })
    store.storeProfile(2)
    expect(store.storeProfile(2), '第二次是覆盖').toBe('overwritten')
    expect(store.clearProfile(2)).toBe(true)
    expect(store.storeProfile(2), '清空之后那格又回到「新录」那一侧').toBe('new')
    expect(store.clearProfile(2)).toBe(true)
    expect(store.loadProfile(2), '而盒里已经没有东西可请回来').toBe(false)
  })

  it('「刚载入」之后清空那一盒：玩家继续用着刚请回来那张，而不是被倒回默认', () => {
    const applied: Bindings[] = []
    const store = new BindingsStore({ input: { setBindings: (b: Bindings): void => { applied.push(b) } } })
    store.rebind('dodge', 'KeyQ')
    store.storeProfile(0)
    store.rebind('dodge', 'KeyE')
    expect(store.loadProfile(0), '先把它请回运行时').toBe(true)
    const n = applied.length
    expect(store.clearProfile(0), '再把那一盒清空').toBe(true)
    expect(applied.length - n, '清空是磁带侧的一件事：一格都不灌').toBe(0)
    expect(store.get().gameplay.keyboard.KeyQ, '刚载入那张仍留在手里（不回默认）').toBe('dodge')
    expect(store.get().gameplay.keyboard.KeyE, '而 E 也仍是载入那张里的 E').toBe(defaultBindings().gameplay.keyboard.KeyE)
  })

  it('三盒全清空、读了个空数组、从没存过 ⇒ 三条路回来同形：档里那一格整个不写（§78）', () => {
    const store = new BindingsStore({ input: { setBindings: () => {} } })
    for (let i = 0; i < PROFILE_SLOTS; i++) store.storeProfile(i)
    expect(store.getProfiles(), '三盒都有 ⇒ 那一格要写').toHaveLength(PROFILE_SLOTS)
    for (let i = 0; i < PROFILE_SLOTS; i++) expect(store.clearProfile(i)).toBe(true)
    const cleared = store.getProfiles()
    const fresh = new BindingsStore({ input: { setBindings: () => {} } })
    const never = fresh.getProfiles()
    store.applyProfiles([])
    expect([cleared, never, store.getProfiles()], '清空过／没写过／档里明写空数组 ⇒ 交出去的仍是同一句「没这块」').toEqual([undefined, undefined, undefined])
    expect(store.profileFlags(), '而界面上那三行仍是三格可读的读数（空态说得出自己是空）').toEqual([false, false, false])
  })
})

/* ------------------------------------------------------------------ KI-364 */

/**
 * KI-364：扳机拐点那一格在**数据这一侧**的形状。设备读数那一段（拐点两边、索引闸门、三个读者）
 * 住在 `tests/unit/pad-trigger.test.ts`，这里只量界与抄写点。
 *
 * 这一批真正危险的地方不是"多了一个数"，而是它落在 `gameplay` 那张表的**第 6 格**上，而那张表在
 * 三个地方各自被逐格抄一遍（`clone`／`setBindings` 交出去那一份／配置文件那盒的快照）——
 * 漏掉任何一处，症状都不是「报错」，而是那一格静默变成 `undefined`：屏幕上写着一个数、
 * 消费者手里按另一个数生效（假读数），或者存进档的一圈回来丢了它。所以第 4 条腿把三处一起量。
 */
describe('KI-364 扳机拐点那一格：默认、界、以及那张表上的三处抄写点', () => {
  it('默认那一个数只有一个主人：现推的快照与原件同形，错型与缺格一律回它', () => {
    expect(defaultBindings().gameplay.triggerThreshold, '默认快照从 `DEFAULT_BINDS` 现推，不抄第二份')
      .toBe(DEFAULT_BINDS.triggerThreshold)
    for (const raw of [undefined, {}, { gameplay: {} }, { gameplay: { triggerThreshold: '0.7' } },
      { gameplay: { triggerThreshold: null } }, { gameplay: { triggerThreshold: [] } }]) {
      expect(clampBindings(raw).gameplay.triggerThreshold, `raw＝${JSON.stringify(raw)} ⇒ 回默认那一个数`)
        .toBe(DEFAULT_BINDS.triggerThreshold)
    }
    expect(clampBindings({ ui: { stickThreshold: 0.8 } }).gameplay.triggerThreshold,
      '菜单那一格的阈值与扳机这一格各归各的通道：动一边不许碰另一边').toBe(DEFAULT_BINDS.triggerThreshold)
  })

  it('界住在 `BIND_BOUNDS`：两面越界各夹一次，而下限不许是 0（0 会让没按下的扳机永远算按下）', () => {
    expect(BIND_BOUNDS.triggerThreshold, '那一格线写的是 5–95%').toEqual({ min: 0.05, max: 0.95 })
    expect(clampBindings({ gameplay: { triggerThreshold: 0.99 } }).gameplay.triggerThreshold).toBe(0.95)
    expect(clampBindings({ gameplay: { triggerThreshold: 2 } }).gameplay.triggerThreshold).toBe(0.95)
    expect(clampBindings({ gameplay: { triggerThreshold: -3 } }).gameplay.triggerThreshold).toBe(0.05)
    /** 下限那半格是本批唯一一条由**推理**给出的界，所以必须由一条腿量：0 不是"最灵敏"，是"永远按着" */
    expect(clampBindings({ gameplay: { triggerThreshold: 0 } }).gameplay.triggerThreshold,
      '写 0 会被夹成下限：`value >= 0` 对没按下的那一把（value 是 0）也成立，那是一把松不开的扳机').toBe(0.05)
    expect(BIND_BOUNDS.triggerThreshold.min, '下限必须是正数，上面那条裁决才成立').toBeGreaterThan(0)
  })

  it('幂等与往返：夹第二遍不改结果，过一圈 JSON 还是那一个数', () => {
    for (const v of [0.05, 0.2, 0.5, 0.55, 0.75, 0.9, 0.95]) {
      const once = clampBindings({ gameplay: { triggerThreshold: v } })
      expect(clampBindings(once), `v＝${v} 夹第二遍应当一个字不改`).toEqual(once)
      expect(JSON.parse(JSON.stringify(once)).gameplay.triggerThreshold, `v＝${v} 过档回来还是那一个数`).toBe(v)
    }
    // 端点之差必须是**面板那一步**的整数倍。这里故意写字面量 5 分（面板那一格的步长在 `src/ui/Stakerite.ts:82`）：
    // 读同一位主人的常数就成了自我印证——上一版查的是「差是整数分」，0.98 也过（93 分当然是整数），
    // 而玩家从下端往上按永远停在 0.95、到不了写着的那一端（E3 那一刀量出的正是这一格）
    const cents = Math.round(BIND_BOUNDS.triggerThreshold.max * 100) - Math.round(BIND_BOUNDS.triggerThreshold.min * 100)
    expect(cents % 5, `端点之差 ${cents} 分不是面板那一步（5 分）的整数倍 ⇒ 连按落不到那一端`).toBe(0)
  })

  it('那张表上的三处抄写点一处都没漏：`get()`、灌给消费者那一份、配置文件那盒的快照', () => {
    const applied: Bindings[] = []
    const store = new BindingsStore({ input: { setBindings: (b: Bindings): void => { applied.push(b) } } })
    store.setTriggerThreshold(0.8)
    expect(store.get().gameplay.triggerThreshold, '存档抄的是这一份：漏了它档里就带不走').toBe(0.8)
    expect(applied[applied.length - 1].gameplay.triggerThreshold, '交出去的那一份也带着它（漏抄就是屏幕与消费者两个数）').toBe(0.8)
    store.storeProfile(0)
    expect(store.getProfiles()![0]!.gameplay.triggerThreshold, '磁带装的是**那一刻整张表**，包括这一格').toBe(0.8)
    expect(clampProfiles([{ gameplay: { triggerThreshold: 0.7 } }])[0]!.gameplay.triggerThreshold,
      '一格磁带过的是同一个 `clampBindings`：毒法与治法不许有两套').toBe(0.7)
    expect(clampProfiles([{ gameplay: { triggerThreshold: 5 } }])[0]!.gameplay.triggerThreshold).toBe(0.95)
  })

  it('边界那把 setter 交回的是夹过的那一个数，而且恰好灌一次消费者', () => {
    const applied: Bindings[] = []
    const store = new BindingsStore({ input: { setBindings: (b: Bindings): void => { applied.push(b) } } })
    expect(store.setTriggerThreshold(0.4), '界内 ⇒ 写进去的就是生效的那一个').toBe(0.4)
    expect(applied.length, '一次写一次灌（多灌一次就是消费者看见半张表）').toBe(2)
    expect(store.setTriggerThreshold(1.7), '界外 ⇒ 交回的是夹过那一个，不是玩家写的那一个').toBe(0.95)
    expect(store.setTriggerThreshold(-1), '另一面同样').toBe(0.05)
    expect(applied.length, '三趟各灌一次，一趟都没多').toBe(4)
    expect(store.get().gameplay.triggerThreshold, '屏幕上那个数与实际生效的那一个不许分家').toBe(0.05)
  })

  it('读档那一拍三种写法：缺格／明写／毒值 ⇒ 分别是默认、那一个数、默认', () => {
    const applied: Bindings[] = []
    const store = new BindingsStore({ input: { setBindings: (b: Bindings): void => { applied.push(b) } } })
    store.restore({ gameplay: { keyboard: { KeyQ: 'dodge' } }, ui: { keyboard: {} } })
    expect(store.get().gameplay.triggerThreshold, '老档没这一格 ⇒ 默认那一个数（「没写过」只有这一种写法）')
      .toBe(DEFAULT_BINDS.triggerThreshold)
    expect(store.get().gameplay.keyboard.KeyQ, '而同一份档里写过的那一格照常生效').toBe('dodge')
    store.restore({ gameplay: { triggerThreshold: 0.3 }, ui: {} })
    expect(store.get().gameplay.triggerThreshold, '写了这一格就是要它 ⇒ 0.3 生效').toBe(0.3)
    store.restore({ gameplay: { triggerThreshold: '0.3' }, ui: {} })
    expect(store.get().gameplay.triggerThreshold, '错型 ⇒ 回默认，而不是把字符串比给判据').toBe(DEFAULT_BINDS.triggerThreshold)
    expect(applied.length, '三趟读档三趟灌：一次都不多').toBe(4)
    store.applyProfiles([defaultBindings(), null, null])
    expect(store.loadProfile(0), '先把手里那张换成刚载入那一张').toBe(true)
    expect(store.get().gameplay.triggerThreshold, '拐点跟着配置文件走：那一盒里装的是整张表的快照').toBe(DEFAULT_BINDS.triggerThreshold)
  })
})

/* ----------------------------------- KI-369 那一格的夹取里没有第二套规则 */

/**
 * KI-369 的两条机制侧证人（unit 那一面）。世界那一路的八条腿在 `tests/flow/bindings-remap.test.ts`，
 * 这两条钉的是它们**为什么只能是这样**——不是「今天恰好如此」，是「换一种读法要先付出第二个主人」：
 *
 * ① `clampProfiles` 逐格交给 `clampBindings`，自己一条规则都不立（`src/settings/Bindings.ts:397`）。
 *    所以「半张的盒读成默认那半」与「缺格的现表读成默认那一格」是**同一句话**，不是两套治法。
 * ② 于是「缺的名字 ⇒ 整格作废」那一种闸门在 JSON 上分不开两件事：一份 KI-364 之前的老盒（没有
 *    `triggerThreshold` 这一格）与一份只写了键盘那半的盒，缺的都是名字。加格不推版本那条既有纪律
 *    使得老盒合法，所以严格闸门会先洗掉老玩家那一盒——那是比"补默认"更坏的读法。
 *
 * 预测：两条都是绿的（本批不改机制，这两条是把既有形状钉住，供反向臂点）。
 */

/** 只写键盘那半：`gameplay` 留 `keyboard`＋`unbound`，`ui` 同样只留那两格（名字的主人仍是 `BIND_CHANNELS`） */
const kbHalf = (keyboard: Record<string, string>): Record<string, unknown> => ({
  gameplay: { keyboard, unbound: [] },
  ui: { keyboard: { Tab: 'back' }, unbound: [] }
})

describe('KI-369 那一格的夹取里没有第二套规则：半张的读法就是缺格补默认，而它分不开老盒', () => {
  it('D1 一格磁带的夹取与整张现表的夹取逐字同一句：`clampProfiles([raw])[0]` ＝ `clampBindings(raw)`', () => {
    const raw = kbHalf({ KeyQ: 'dodge' })
    const asCell = clampProfiles([raw])[0]
    const asLive = clampBindings(raw)
    expect(asCell, '半张那一格不是第四种存在感：它有东西，而那份"有"逐字等于同一张 raw 过现表那一道').toEqual(asLive)
    expect(clampProfiles([asCell])[0], '再夹一遍不动（幂等是"往返不漂移"的前提，由那位既有主人担保）').toEqual(asCell)
    expect(asCell!.gameplay.triggerThreshold, '缺的那一半补的是默认，不是 undefined、也不是上一盒那个数')
      .toBe(defaultBindings().gameplay.triggerThreshold)
    expect(Object.keys(asCell!.ui).sort(), '补完是一张整表：名字名册只有一份，而它是 `clone` 逐格列名那一份')
      .toEqual(Object.keys(defaultBindings().ui).sort())
  })

  it('D2 半张与「KI-364 之前的整张」缺的是同一种东西：名字 ⇒ 任何「缺名字就整格作废」的闸门会先把老盒洗掉', () => {
    const era = JSON.parse(JSON.stringify(defaultBindings())) as Record<string, Record<string, unknown>>
    delete era.gameplay.triggerThreshold
    const half = kbHalf({ KeyQ: 'dodge' }) as unknown as Record<string, Record<string, unknown>>
    const missingIn = (raw: Record<string, Record<string, unknown>>): string[] => {
      const out = clampBindings(raw)
      const miss: string[] = []
      for (const blk of ['gameplay', 'ui'] as const) {
        for (const k of Object.keys(out[blk])) if (!(k in raw[blk])) miss.push(`${blk}.${k}`)
      }
      return miss.sort()
    }
    expect(missingIn(era), '老盒缺的正是 KI-364 那一次新加的那一格（那份档那时没有它，不是玩家不要它）')
      .toEqual(['gameplay.triggerThreshold'])
    expect(missingIn(half).length, '半张盒缺的是手柄那一整条通道的名字：两处的缺法同为「没有那个名字」，只是多少不同')
      .toBeGreaterThan(missingIn(era).length)
    expect(clampProfiles([era, half])[0], '而两条读法逐字同一句：缺名补默认 ⇒ 整盒仍在（`profileFlags` 那一句说的就是这个）')
      .toEqual(clampBindings(era))
    expect(clampProfiles([era, half])[1]).toEqual(clampBindings(half))
    expect(clampProfiles([era, half]).filter((c) => c !== null).length, '两盒都读成"有东西"：把它们判成空的闸门今天不存在，也不能存在')
      .toBe(2)
  })
})

/**
 * KI-389：玩法这一侧的「谁不许关」。菜单那条通道的先例是 `UI_EXIT_INTENTS`（一份名册、三个读者），
 * 而玩法这一侧今天一份都没有：`unbind`／`unbindPad` 只挡名册外的名字，`readUnbound` 里也没有闸，
 * 于是 `gameplay.unbound: ["pause"]` 手改进档里读得回来——两列一起关掉之后世界永远手动停不下来。
 *
 * 这一组量**值与行为**（住家与份数在 `pause-action.test.ts`，屏幕在 `controls-page.test.ts`）。
 * 名册走**动态读**而不是 `import`：先红那趟要红在这条腿上，不能红在整份文件的编译上——
 * 直接引一个还不存在的名字会让这把尺根本加载不了，红的就不是腿而是全表（本批读数会验这一句）。
 */
describe('KI-389 玩法那侧的出口名册：值、两把把手与装载那一路', () => {
  function rig() {
    const applied: Bindings[] = []
    const store = new BindingsStore({ input: { setBindings: (b: Bindings): void => { applied.push(b) } } })
    return { store, applied }
  }
  const roster = (): readonly string[] => {
    const v = (INPUT as unknown as Record<string, unknown>).GAMEPLAY_EXIT_ACTIONS
    return Array.isArray(v) ? (v as readonly string[]) : []
  }
  const codesOf = (kb: Record<string, ActionName>, a: ActionName): string[] =>
    Object.keys(kb).filter((c) => kb[c] === a).sort()
  const padOf = (pad: Record<number, ActionName>, a: ActionName): number[] =>
    Object.keys(pad).map(Number).filter((n) => pad[n] === a).sort((x, y) => x - y)

  it('被保护的那几格只有一个主人，且它就是一枚：读出来是名册，不是面板自己数的', () => {
    expect(roster(), '「世界必须停得下来」这句话在 22 枚里只由 pause 负责（KI-388 量的那一格：读者 1 处）')
      .toEqual(['pause'])
    expect(UI_EXIT_INTENTS, '菜单那份照旧，两份名册不许合并成一份').toEqual(['back'])
  })

  it('`unbind("pause")` 回答得出拒绝：一次不灌、名单不进、Escape 仍绑着它', () => {
    const { store, applied } = rig()
    expect(store.unbind('pause'), '关掉刹车不是一个合法请求').toBe(false)
    expect(store.get().gameplay.unbound, '名单里也因此没有它').toEqual([])
    expect(store.get().gameplay.keyboard, '一格都没动').toEqual(DEFAULT_BINDS.keyboard)
    expect(applied.length, '零灌注：没改就不灌（与 KI-342 那条同方向）').toBe(1)
  })

  it('手柄那一半同一条话：`unbindPad("pause")` 返回假、那一列一格不剩的话不算数', () => {
    const { store, applied } = rig()
    expect(store.unbindPad('pause'), '「停得下来」不是键盘那半的事（KI-346：两张表共一份名册）').toBe(false)
    expect(store.get().gameplay.padUnbound, '名单不进').toEqual([])
    expect(store.get().gameplay.padButtons, '8 与 17 两把都在').toEqual(DEFAULT_BINDS.padButtons)
    expect(applied.length, '也没替玩家偷偷灌一次默认').toBe(1)
  })

  it('手改档里那一条不算数：`gameplay.unbound: ["pause","dodge",42,null]` ⇒ 只有 dodge 进名单', () => {
    const out = clampBindings({ gameplay: { unbound: ['pause', 'dodge', 42, null] } })
    expect(out.gameplay.unbound, '信任边界不是界面上的礼貌——手改的档也不能把世界变成没有刹车').toEqual(['dodge'])
    expect(codesOf(out.gameplay.keyboard, 'pause'), '被丢掉的那一格仍握着自己的默认键').toEqual(['Escape'])
    expect(codesOf(out.gameplay.keyboard, 'dodge'), '而过关的那一格确实没键').toEqual([])
    expect(clampBindings(out).gameplay.unbound, '幂等').toEqual(['dodge'])
  })

  it('手柄那份也一样：`gameplay.padUnbound: ["pause","dodge"]` ⇒ 丢掉出口，8／17 仍归 pause', () => {
    const out = clampBindings({ gameplay: { padUnbound: ['pause', 'dodge'] } })
    expect(out.gameplay.padUnbound, '两份玩法名单共用那一个装载者 ⇒ 一道闸管两张表').toEqual(['dodge'])
    expect(padOf(out.gameplay.padButtons, 'pause'), '两把都在：把手被丢掉的那一格才是不设防的那一格').toEqual([8, 17])
    expect(padOf(out.gameplay.padButtons, 'dodge'), '而过关的那一格在这一列上一把不剩').toEqual([])
  })

  it('名册管的是「无」，不管换键：`rebind("pause")` 照样成立（把它读成"这枚动词不许动"是第二个洞）', () => {
    const { store } = rig()
    expect(store.rebind('pause', 'KeyJ'), '改键是另一种请求，出口名册不许顺手把它也拒了').toEqual({ displaced: null, moved: false, onto: 'keyboard' })
    expect(store.get().gameplay.keyboard.KeyJ).toBe('pause')
    expect(store.get().gameplay.unbound, '名单里仍然没有它：本批没有把 pause 变成"永远不许动"').toEqual([])
  })

  it('被保护的那一格在默认表上真有落点（护一枚没家的动作是空话）', () => {
    for (const a of roster()) {
      expect(codesOf(DEFAULT_BINDS.keyboard, a as ActionName).length, `${a} 在键盘上要有默认键`).toBeGreaterThan(0)
      expect(padOf(DEFAULT_BINDS.padButtons, a as ActionName).length, `${a} 在手柄上要有默认键`).toBeGreaterThan(0)
    }
  })
})
