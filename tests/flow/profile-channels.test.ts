import { describe, expect, it } from 'vitest'
import * as BINDINGS_API from '@/settings/Bindings'
import { BindingsStore, PROFILE_SLOTS, defaultBindings } from '@/settings/Bindings'
import type { BindChannel } from '@/settings/Bindings'
import type { Bindings, UiIntent } from '@/core/Input'

/**
 * KI-367：配置文件那三盒**按通道分家**——键鼠那一半与手柄那一半第一次可以各自存、各自取。
 *
 * KI-366 量出来的形状是「两条通道一起存、一起取＝耦合是形状，不是遗漏」，而账本里连着六趟
 * （KI-336／KI-337／KI-342／KI-362／KI-364④／KI-365③／KI-366①）都写同一句「键鼠／手柄各自一套 profile 仍欠」。
 * 本批把那一句变成机制：`storeProfile(i, ch)` 只把**那一条通道**抄进盒，另一条保持盒里原来那一份；
 * `loadProfile(i, ch)` 只把那一条通道请回现表，另一条一个字不动，而灌注仍然恰好一次
 * ——分通道不是「灌半张」：先在 store 里搭好整张再交出去，KI-345 那条「一次动作一次灌注」没被绕过。
 *
 * 三条裁决写在这里，各由下面一条腿钉住，不由这段推理担保：
 * ① **通道是那两枚**：`kb`＝键盘那张＋玩法与菜单各自的「键盘那份无」；`pad`＝手柄按钮、手柄轴下标、
 *    扳机拐点、两份「手柄那份无」＋菜单手柄按钮与摇杆阈值。划分穷尽 `clone` 逐格列名的 6＋5 格，交集为空。
 * ② **空格只存一条通道时，另一条取的是此刻那张**，不是默认——那一格说的是「这一刻玩家的两条通道」，
 *    把没存的那半写成默认等于凭空造一份玩家没要的东西（KI-362 那句「没存过不是一种默认表」的另一半）。
 * ③ **「清空」与「哪一盒有东西」不动语义**：`clearProfile` 与 `profileFlags` 讲的还是那一整格（KI-363 的形状），
 *    分通道不产生「半满的盒」这种第三种存在感。所以存档形状一格没长：一盒仍是一张完整的 `Bindings`。
 *
 * 预测在写之前就按源码钉死：今天 `storeProfile`／`loadProfile` 只认一个下标（第二个参数被忽略），
 * 而 `BIND_CHANNELS` 这个名字还不存在 ⇒ L1、L2、L4、L5、L6、L9、L10、L12、L13 该红；
 * L3 与 L7、L8、L11 今天是绿的——L7／L8／L11 是「不许改坏」的边界，L3 与今天同形
 * （那一格由反向实测里「另一条通道回默认」那一刀点红）。
 */

/** 通道那两枚的名字表：从模块上取而不是 `import { BIND_CHANNELS }`，是为了让第一跑的读数是**每条腿各自的**，
 *    而不是整个文件在装载时就炸（那会让「哪几条腿红」这件事读不出来） */
type ChannelTable = { kb: { gameplay: string[]; ui: string[] }; pad: { gameplay: string[]; ui: string[] } }
const BIND_CHANNELS = (BINDINGS_API as unknown as Record<string, unknown>).BIND_CHANNELS as ChannelTable | undefined

/** 消费者那一位只负责「收到过几张表」：灌的次数与收到的那一张，是本批两条纪律的读数面 */
function makeStore() {
  const applied: Bindings[] = []
  const bindings = new BindingsStore({ input: { setBindings: (b: Bindings): void => { applied.push(b) } } })
  return { bindings, applied, last: () => applied[applied.length - 1] }
}

const kbHome = (b: Bindings, action: string): string | undefined =>
  Object.keys(b.gameplay.keyboard).find((code) => b.gameplay.keyboard[code] === action)
const padHome = (b: Bindings, action: string): number | undefined =>
  Object.keys(b.gameplay.padButtons).map(Number).find((i) => b.gameplay.padButtons[i] === action)
const uiKbHome = (b: Bindings, intent: string): string | undefined =>
  Object.keys(b.ui.keyboard).find((code) => (b.ui.keyboard as Record<string, string>)[code] === intent)
const uiPadHome = (b: Bindings, intent: string): number | undefined =>
  Object.keys(b.ui.padButtons).map(Number).find((i) => (b.ui.padButtons as Record<string, string>)[i] === intent)

/** 一条通道一格数：腿与腿比的是**同一批读数**，不是各自手抄的键名 */
const probe = (b: Bindings) => ({
  kbDodge: kbHome(b, 'dodge'),
  kbLockOn: kbHome(b, 'lockOn'),
  padParry: padHome(b, 'parry'),
  padInteract: padHome(b, 'interact'),
  padAxes: JSON.stringify(b.gameplay.padAxes),
  trig: b.gameplay.triggerThreshold,
  stick: b.ui.stickThreshold,
  uiKbConfirm: uiKbHome(b, 'confirm'),
  uiPadBack: uiPadHome(b, 'back'),
  unbound: [...b.gameplay.unbound].sort().join(','),
  padUnbound: [...b.gameplay.padUnbound].sort().join(','),
  uiUnbound: [...b.ui.unbound].sort().join(','),
  uiPadUnbound: [...b.ui.padUnbound].sort().join(',')
})
type Probe = ReturnType<typeof probe>

/** 面板那一侧的路径：两条通道各拧一格（改键、改手柄轴、改两把线、改菜单那一节），不绕信任边界 */
function twist(bindings: BindingsStore, tag: 'A' | 'B'): void {
  const a = tag === 'A'
  bindings.rebind('dodge', a ? 'KeyQ' : 'KeyW')
  bindings.rebind('parry', a ? 'Pad3' : 'Pad4')
  bindings.set({ gameplay: { padAxes: a ? { moveX: 0, moveY: 1, camX: 2, camY: 3 } : { moveX: 1, moveY: 0, camX: 3, camY: 2 } } })
  bindings.setTriggerThreshold(a ? 0.7 : 0.3)
  bindings.setStickThreshold(a ? 0.6 : 0.2)
  bindings.rebindUi('confirm' as UiIntent, a ? 'KeyJ' : 'KeyM')
  bindings.rebindUi('back' as UiIntent, a ? 'Pad9' : 'Pad2')
}

/** 拧到某一时刻并把它数下来：后面的腿比的是这两份读数，而不是源码里的键名 */
function moment(bindings: BindingsStore, tag: 'A' | 'B'): Probe {
  twist(bindings, tag)
  return probe(bindings.get())
}

const boxOf = (bindings: BindingsStore, i: number): Bindings => bindings.getProfiles()![i] as Bindings

describe('KI-367 那三盒按通道分家：存一条、取一条，另一条一个字都不许跟着动', () => {
  it('L1 划分名册：两枚通道并起来正好是逐格列名那 6＋5 格，交集为空，而两把模拟量的线都住 `pad`', () => {
    expect(BIND_CHANNELS).toBeDefined()
    const table = BIND_CHANNELS as unknown as ChannelTable
    const d = defaultBindings()
    for (const block of ['gameplay', 'ui'] as const) {
      expect([...table.kb[block], ...table.pad[block]].sort()).toEqual(Object.keys(d[block]).sort())
      expect(table.kb[block].filter((k) => table.pad[block].includes(k))).toEqual([])
    }
    expect(table.pad.gameplay).toEqual(expect.arrayContaining(['padButtons', 'padAxes', 'padUnbound', 'triggerThreshold']))
    expect(table.pad.ui).toEqual(expect.arrayContaining(['padButtons', 'padUnbound', 'stickThreshold']))
    expect(table.kb.gameplay).toEqual(['keyboard', 'unbound'])
    expect(table.kb.ui).toEqual(['keyboard', 'unbound'])
  })

  it('L2 分通道存入只写那半张：盒里另一条通道保持**原来那一份**，不是此刻那一张', () => {
    const { bindings } = makeStore()
    const A = moment(bindings, 'A')
    expect(bindings.storeProfile(0)).toBe('new')
    const B = moment(bindings, 'B')
    expect(B.padParry).not.toBe(A.padParry)
    expect(bindings.storeProfile(0, 'kb')).toBe('overwritten')
    const p = probe(boxOf(bindings, 0))
    expect(p.kbDodge).toBe(B.kbDodge)
    expect(p.kbLockOn).toBe(B.kbLockOn)
    expect(p.uiKbConfirm).toBe(B.uiKbConfirm)
    expect(p.padParry).toBe(A.padParry)
    expect(p.padAxes).toBe(A.padAxes)
    expect(p.trig).toBe(A.trig)
    expect(p.stick).toBe(A.stick)
    expect(p.uiPadBack).toBe(A.uiPadBack)
  })

  it('L3 空格只存一条通道时，另一条取的是此刻那张（裁决②：不是一份凭空造出来的默认）', () => {
    const { bindings } = makeStore()
    const B = moment(bindings, 'B')
    const D = probe(defaultBindings())
    expect(B.padParry).not.toBe(D.padParry)
    expect(B.kbDodge).not.toBe(D.kbDodge)
    expect(bindings.storeProfile(1, 'pad')).toBe('new')
    const p = probe(boxOf(bindings, 1))
    expect(p.padParry).toBe(B.padParry)
    expect(p.trig).toBe(B.trig)
    expect(p.kbDodge).toBe(B.kbDodge)
    expect(p.uiKbConfirm).toBe(B.uiKbConfirm)
  })

  it('L4 分通道载入只换那半张，而且恰好灌一次（分通道不是「灌半张」）', () => {
    const { bindings, applied } = makeStore()
    const A = moment(bindings, 'A')
    bindings.storeProfile(0)
    const B = moment(bindings, 'B')
    const before = applied.length
    expect(bindings.loadProfile(0, 'kb')).toBe(true)
    expect(applied.length - before).toBe(1)
    const now = probe(bindings.get())
    expect(now.kbDodge).toBe(A.kbDodge)
    expect(now.uiKbConfirm).toBe(A.uiKbConfirm)
    expect(now.padParry).toBe(B.padParry)
    expect(now.padAxes).toBe(B.padAxes)
    expect(now.trig).toBe(B.trig)
    expect(now.stick).toBe(B.stick)
    expect(probe(applied[applied.length - 1])).toEqual(now)
    expect(Object.keys(applied[applied.length - 1].gameplay).sort()).toEqual(Object.keys(defaultBindings().gameplay).sort())
  })

  it('L5 载入手柄那半：两把模拟量的线一起回来，而键盘那一张一个字都不动', () => {
    const { bindings } = makeStore()
    const A = moment(bindings, 'A')
    bindings.storeProfile(0)
    const B = moment(bindings, 'B')
    expect(bindings.loadProfile(0, 'pad')).toBe(true)
    const now = probe(bindings.get())
    expect(now.trig).toBe(A.trig)
    expect(now.stick).toBe(A.stick)
    expect(now.padParry).toBe(A.padParry)
    expect(now.padAxes).toBe(A.padAxes)
    expect(now.uiPadBack).toBe(A.uiPadBack)
    expect(now.kbDodge).toBe(B.kbDodge)
    expect(now.kbLockOn).toBe(B.kbLockOn)
    expect(now.uiKbConfirm).toBe(B.uiKbConfirm)
  })

  it('L6 两次分通道合成一盒：整盒载入时两条通道各自回到各自那一刻（「各用一套」的玩家故事）', () => {
    const { bindings } = makeStore()
    const A = moment(bindings, 'A')
    bindings.storeProfile(2, 'kb')
    const B = moment(bindings, 'B')
    bindings.storeProfile(2, 'pad')
    bindings.restoreDefaults()
    expect(bindings.loadProfile(2)).toBe(true)
    const now = probe(bindings.get())
    expect(now.kbDodge).toBe(A.kbDodge)
    expect(now.uiKbConfirm).toBe(A.uiKbConfirm)
    expect(now.padParry).toBe(B.padParry)
    expect(now.padAxes).toBe(B.padAxes)
    expect(now.trig).toBe(B.trig)
    expect(now.stick).toBe(B.stick)
  })

  it('L7 不带通道那一次仍是今天那一句：整盒存、整盒取（不许回归）', () => {
    const { bindings } = makeStore()
    const A = moment(bindings, 'A')
    bindings.storeProfile(0)
    moment(bindings, 'B')
    bindings.restoreDefaults()
    expect(bindings.loadProfile(0)).toBe(true)
    const now = probe(bindings.get())
    expect(now.kbDodge).toBe(A.kbDodge)
    expect(now.padParry).toBe(A.padParry)
    expect(now.padAxes).toBe(A.padAxes)
    expect(now.trig).toBe(A.trig)
    expect(now.stick).toBe(A.stick)
    expect(now.uiKbConfirm).toBe(A.uiKbConfirm)
    expect(now.uiPadBack).toBe(A.uiPadBack)
  })

  it('L8 界外那两把分通道那一次照样拒绝：空盒载入交回假、一个键都不灌；界外下标存入交回 null、三盒一格不动', () => {
    const { bindings, applied } = makeStore()
    moment(bindings, 'B')
    const before = applied.length
    const nowBefore = JSON.stringify(bindings.get())
    const boxesBefore = JSON.stringify(bindings.getProfiles())
    expect(bindings.loadProfile(1, 'pad')).toBe(false)
    expect(bindings.storeProfile(PROFILE_SLOTS, 'kb')).toBeNull()
    expect(bindings.storeProfile(-1, 'pad')).toBeNull()
    expect(bindings.storeProfile(1.5, 'kb')).toBeNull()
    expect(applied.length).toBe(before)
    expect(JSON.stringify(bindings.get())).toBe(nowBefore)
    expect(JSON.stringify(bindings.getProfiles())).toBe(boxesBefore)
    expect(bindings.profileFlags()).toEqual([false, false, false])
  })

  it('L9 通道那枚不是那两枚之一 ⇒ 存不写、载不灌（界外通道的裁决，与界外下标同位）', () => {
    const { bindings, applied } = makeStore()
    moment(bindings, 'A')
    bindings.storeProfile(0)
    const nowBefore = JSON.stringify(bindings.get())
    const boxesBefore = JSON.stringify(bindings.getProfiles())
    const before = applied.length
    expect(bindings.loadProfile(0, 'mouse' as BindChannel)).toBe(false)
    expect(bindings.loadProfile(0, '' as BindChannel)).toBe(false)
    expect(bindings.storeProfile(1, 'mouse' as BindChannel)).toBeNull()
    expect(applied.length).toBe(before)
    expect(JSON.stringify(bindings.get())).toBe(nowBefore)
    expect(JSON.stringify(bindings.getProfiles())).toBe(boxesBefore)
  })

  it('L10 跟档走而形状不变：分通道合成的那一盒过一遍 JSON 仍是整张一格，回来两条通道各自在那', () => {
    const { bindings } = makeStore()
    const A = moment(bindings, 'A')
    bindings.storeProfile(0, 'kb')
    const B = moment(bindings, 'B')
    bindings.storeProfile(0, 'pad')
    const tape = JSON.parse(JSON.stringify(bindings.getProfiles()))
    expect(Array.isArray(tape)).toBe(true)
    expect(tape).toHaveLength(PROFILE_SLOTS)
    expect(Object.keys(tape[0].gameplay).sort()).toEqual(Object.keys(defaultBindings().gameplay).sort())
    expect(Object.keys(tape[0].ui).sort()).toEqual(Object.keys(defaultBindings().ui).sort())
    const other = makeStore()
    other.bindings.applyProfiles(tape)
    const p = probe(boxOf(other.bindings, 0))
    expect(p.kbDodge).toBe(A.kbDodge)
    expect(p.padParry).toBe(B.padParry)
    expect(p.trig).toBe(B.trig)
    expect(other.bindings.profileFlags()).toEqual([true, false, false])
    expect(bindings.clearProfile(0)).toBe(true)
    expect(bindings.getProfiles()).toBeUndefined()
  })

  it('L11 快照不是活引用那一侧也成立：分通道载入之后拧现表，盒里那半张一个字都不跟着变', () => {
    const { bindings } = makeStore()
    const A = moment(bindings, 'A')
    bindings.storeProfile(0, 'kb')
    moment(bindings, 'B')
    expect(bindings.loadProfile(0, 'kb')).toBe(true)
    const boxBefore = JSON.stringify(bindings.getProfiles()![0])
    bindings.rebind('dodge', 'KeyF')
    bindings.setTriggerThreshold(0.9)
    expect(JSON.stringify(bindings.getProfiles()![0])).toBe(boxBefore)
    expect(probe(boxOf(bindings, 0)).kbDodge).toBe(A.kbDodge)
    expect(probe(boxOf(bindings, 0)).trig).toBe(A.trig)
  })

  it('L12 两份「无」名单各归各家：载入手柄那半不动键盘那份，载入键鼠那半不动手柄那份', () => {
    const { bindings } = makeStore()
    bindings.unbind('parry')
    bindings.unbindPad('dodge')
    const stored = probe(bindings.get())
    expect(stored.unbound).toBe('parry')
    expect(stored.padUnbound).toBe('dodge')
    bindings.storeProfile(0)
    bindings.restoreDefaults()
    expect(probe(bindings.get()).unbound).toBe('')
    expect(probe(bindings.get()).padUnbound).toBe('')
    expect(bindings.loadProfile(0, 'pad')).toBe(true)
    let now = probe(bindings.get())
    expect(now.padUnbound).toBe('dodge')
    expect(now.unbound).toBe('')
    expect(bindings.loadProfile(0, 'kb')).toBe(true)
    now = probe(bindings.get())
    expect(now.unbound).toBe('parry')
    expect(now.padUnbound).toBe('dodge')
  })

  it('L13 菜单那一节跟着两条通道走：`ui` 那半的手柄列与摇杆线住 `pad`，键盘列与那份名单住 `kb`', () => {
    const { bindings } = makeStore()
    moment(bindings, 'A')
    bindings.unbindUi('up' as UiIntent)
    const afterUnbind = probe(bindings.get())
    expect(afterUnbind.uiUnbound).toBe('up')
    bindings.storeProfile(0, 'kb')
    const B = moment(bindings, 'B')
    bindings.storeProfile(0, 'pad')
    const p = probe(boxOf(bindings, 0))
    expect(p.uiKbConfirm).toBe(afterUnbind.uiKbConfirm)
    expect(p.uiUnbound).toBe('up')
    expect(p.uiPadBack).toBe(B.uiPadBack)
    expect(p.stick).toBe(B.stick)
    bindings.restoreDefaults()
    expect(bindings.loadProfile(0, 'pad')).toBe(true)
    const now = probe(bindings.get())
    const D = probe(defaultBindings())
    expect(now.uiPadBack).toBe(B.uiPadBack)
    expect(now.stick).toBe(B.stick)
    /* 键盘那一列读回来的是**此刻**那一份（默认那张），不是盒里那一半——这一句不许写成等于 `A`，
       写成了就等于宣布「载入一条通道其实换了整张」 */
    expect(now.uiKbConfirm).toBe(D.uiKbConfirm)
    expect(now.uiKbConfirm).not.toBe(afterUnbind.uiKbConfirm)
    expect(now.uiUnbound).toBe('')
  })
})
