import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { GameTime, TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { BINDABLE_ACTIONS, DEFAULT_BINDS, Input, UI_BINDS, UI_EXIT_INTENTS, UI_INTENTS, codeLabel, type ActionName, type Bindings, type UiIntent } from '@/core/Input'
import * as INPUT from '@/core/Input'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { StreamingSystem } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import { RpgRuntime } from '@/rpg/Runtime'
import { TIMBITE } from '@/rpg/Upgrade'
import { Stakerite, type SavePanelDeps } from '@/ui/Stakerite'
import type { SlotCard } from '@/save/Slots'
import { MapStore, SaveGame } from '@/save/Serializer'
import { BIND_BOUNDS, BindingsStore, PROFILE_SLOTS, defaultBindings } from '@/settings/Bindings'
import { DEFAULT_GAMEPLAY_SETTINGS, GAMEPLAY_BOUNDS, GameplaySettingsStore } from '@/settings/GameplaySettings'
import { QualityStore } from '@/settings/Quality'
import { actionLabel, intentLabel, padLabel } from '@/ui/actionLabels'
import { makeOpsHandles } from '@/ui/OpsHandles'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * KI-337：`docs/ui-ux.md` §5.1 那句「全动作逐行可改」与 §5.1/§6 那五格玩法设置的**玩家入口**。
 *
 * 前两批把键位变成了数据（KI-336）、把五格玩法设置变成了带消费者的数（KI-112），
 * 两边都还缺一双手：机制在，把手不在，玩家仍然只能改文件。这一份量的正是那双手，
 * 而它专挑 unit 量不到的四件事：
 *  ① **捕获与意图的先后**：等键途中那一枚物理键要绑得上，而同一枚键不许顺手发动作或发意图；
 *  ② **全路径可达**（§7）：这一屏的每一格都能只用 ↑↓/Enter 走到，端点那些 `disabled` 的格子不许被 Enter 绕过；
 *  ③ **页签是现推的**：没接把手就没有「操作」这一页——给一个点了没东西的页签叫假可达；
 *  ④ **面板写的就是存档读的那一份**：改完直接 save，新世界 load 回来第一屏仍说真话。
 *
 * 接线与生产共用同一个装配处（`src/ui/OpsHandles.ts > makeOpsHandles`）：面板手里只有函数，
 * 两个 store 与那枚捕获都不交给它。这里以前是照组合根手抄的一份——两份字面一样却永远不会
 * 出现在同一个 diff 里，于是端口改了红的只有抄本，生产照样静默接错（§55 在接线层面的形状）。
 */

registerGameData()

const NO_SAVES: SavePanelDeps = { list: async (): Promise<SlotCard[]> => [], write: async () => null, erase: async () => false }

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
    add: (c: string): void => { this.classes.add(c) },
    remove: (c: string): void => { this.classes.delete(c) },
    contains: (c: string): boolean => this.classes.has(c)
  }
  style = { textContent: '' }
  appendChild(c: FakeEl): FakeEl { this.children.push(c); return c }
  addEventListener(t: string, fn: (e: unknown) => void): void { (this.handlers[t] ??= []).push(fn) }
  dispatch(t: string, e: unknown): void { for (const fn of this.handlers[t] ?? []) fn(e) }
  closest(): FakeEl | null { return this.dataset.act ? this : null }
  /** KI-360：等待途中把指针锁进 canvas 是玩家看得见的伤害，量具要数得到它锁了几次 */
  locks = 0
  requestPointerLock(): void { this.locks++ }
}

let win: Record<string, ((e: unknown) => void)[]> = {}

beforeAll(() => {
  win = {}
  const g = globalThis as unknown as Record<string, unknown>
  g.document = {
    createElement: () => new FakeEl(), head: new FakeEl(), body: new FakeEl(),
    getElementById: () => new FakeEl(), pointerLockElement: null,
  }
  g.window = {
    addEventListener: (t: string, fn: (e: unknown) => void): void => { (win[t] ??= []).push(fn) },
    innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
  }
  Object.defineProperty(globalThis, 'innerWidth', { value: 1280, configurable: true })
  Object.defineProperty(globalThis, 'innerHeight', { value: 720, configurable: true })
})

beforeEach(() => { for (const k of Object.keys(win)) delete win[k] })

/** 往 window 上推一次键（`Input` 的键盘监听挂在 window） */
function key(code: string, up = false, repeat = false): void {
  const e = { code, repeat, preventDefault: (): void => {} }
  for (const fn of win[up ? 'keyup' : 'keydown'] ?? []) fn(e)
}

const html = (p: Stakerite): string => (p as unknown as { root: FakeEl }).root.innerHTML
const click = (p: Stakerite, act: string, arg = ''): void => {
  const el = new FakeEl()
  el.dataset = { act, arg }
  ;(p as unknown as { root: FakeEl }).root.dispatch('click', { target: el })
}

/**
 * 出口名册**动态读**（KI-389）：机制未落地时读成空名单。
 * 为什么不直接 `import`：引一个还不存在的名字会让这份文件根本加载不了，先红那趟红的就不是
 * 某几条腿而是整把尺——量具坏了不等于读数掉了，但读数会失去主人。
 */
const exitRoster = (): readonly ActionName[] => {
  const v = (INPUT as unknown as Record<string, unknown>).GAMEPLAY_EXIT_ACTIONS
  return Array.isArray(v) ? (v as readonly ActionName[]) : []
}

/** 世界那一侧的泵：`main.ts` 每帧做的就是这两行 */
function pump(p: Stakerite, input: Input, intents: UiIntent[] = []): void {
  input.poll(TICK_DT)
  p.uiStep(new Set<UiIntent>([...input.uiEdges, ...intents]))
}

/** 只用键盘把焦点走到某一格（返回走了几步；走到上限还没见到就是量具先红，别让玩家替它红） */
function walkTo(p: Stakerite, input: Input, needle: string, limit = 90): number {
  for (let i = 0; i < limit; i++) {
    if (focusTag(html(p)).includes(needle)) return i
    pump(p, input, ['down'])
  }
  return limit
}

/** 焦点框当前圈住的那一格（`markFocus` 把 ` focus` 追加进 class） */
const focusTag = (h: string): string => (h.match(/<button\b[^>]*class="[^"]*focus[^"]*"[^>]*>/) ?? [''])[0]

interface Rig {
  p: Stakerite
  input: Input
  /** KI-360：按下搬到 window 之后，"这一下锁没锁走指针"是要问得出的一格 ⇒ 这块世界得留得住那块 canvas */
  inputEl: FakeEl
  bindings: BindingsStore
  gameplay: GameplaySettingsStore
  notices: string[]
  /** KI-359：振动那一格今天有两个消费者字段，量具得能各看各的（假件仍是一个裸对象，不引 `Haptics` 类型依赖） */
  haptics: { scale: number; weakScale: number }
  /** KI-365：长按阈值那一格的消费者（同样是一个裸对象）——「面板点得动」与「玩家手里跟着变」要能各问一次
   *  KI-384：第六把消费者同行。假件起手写**非默认**的那一枚（表里默认是开）：写成默认值就分不清「接上了」与「没人灌过」 */
  playerTarget: { holdMs: number; mashGuard: boolean }
  /** KI-385：那一屏的壳（页眉两格＋页脚三格）与四页正文读的都是这一个主人，量具要能不经面板动它 */
  rpg: RpgRuntime
}

/** 往 `root.innerHTML` 上装一只写计数器：改口这件事的**成本**就是这里数出来的（谁写了、写了几次） */
function domWrites(p: Stakerite): { count: () => void; n: () => number } {
  const el = (p as unknown as { root: FakeEl }).root
  let n = 0
  let v = el.innerHTML
  Object.defineProperty(el, 'innerHTML', { get: () => v, set: (x: string) => { v = x; n++ }, configurable: true })
  return { count: () => { n = 0 }, n: () => n }
}

/** 一块接好把手的面板：两个 store 都灌了真实消费者（`Input` 与三个假件），面板拿到的仍是那六个闭包 */
function rig(withOps = true, onOpsTab = true, saves: SavePanelDeps = NO_SAVES): Rig {
  const inputEl = new FakeEl()
  const input = new Input(inputEl as unknown as HTMLElement)
  const bindings = new BindingsStore({ input })
  const haptics = { scale: 1, weakScale: 1 }
  // KI-365：第五把消费者的假件（公开字段就是生产形状）——面板那一行点下去后要在这格里看得见同一个数
  const playerTarget = { holdMs: 0, mashGuard: false }
  const gameplay = new GameplaySettingsStore({ input, rig: { shakeIntensity: 1 }, haptics, combat: { damageScale: 1 }, player: playerTarget })
  const quality = new QualityStore({ particles: { spawnMul: 1 }, renderer: { resolutionScale: 1, shadowMapSize: 1536 } })
  const notices: string[] = []
  const rpg = new RpgRuntime('origin_tuner')
  const p = new Stakerite(rpg,
    { onApply: () => {}, notify: (m) => notices.push(m), onUse: () => {}, onRequestClose: () => {} },
    saves, input, withOps ? makeOpsHandles(input, () => bindings, () => gameplay, () => quality, () => 95.58) : null)
  p.show()
  if (onOpsTab) click(p, 'tab', 'ops')
  return { p, input, inputEl, bindings, gameplay, notices, haptics, playerTarget, rpg }
}

describe('KI-337 「操作」页签是现推的：没接把手就没有这一页', () => {
  it('接了 ⇒ 七个页签里有点得动的「操作」；没接 ⇒ 名册仍是六个', () => {
    expect(html(rig(true).p), '把手接上了就要有能点进去的格子').toContain('data-act="tab" data-arg="ops"')
    const without = html(rig(false).p)
    expect(without, '没接把手却给一个页签 = 点了没反应的假可达').not.toContain('data-arg="ops"')
    expect((without.match(/data-act="tab"/g) ?? []).length, 'TABS 那六格一格不多一格不少').toBe(6)
  })

  it('没接把手时被硬点进 ops 也只有那句实话，没有一张凭空的表', () => {
    const r = rig(false, false)
    click(r.p, 'tab', 'ops')
    expect(html(r.p)).toContain('这一页没有把手就没有内容')
    expect(html(r.p), '不许凭空画出一列键名').not.toContain('data-act="arm"')
  })

  it('左右换页那条也数得到第七页：肩键从「存档」走一步就落在「操作」', () => {
    const r = rig(true)
    click(r.p, 'tab', 'save')
    pump(r.p, r.input, ['pageNext'])
    expect(html(r.p), '页签名册是同一份 tabsOf()：翻页与点签不会各数一套').toContain('data-act="arm"')
  })
})

describe('KI-337 逐行可改（§5.1 那一格）：一枚物理键换一格', () => {
  it('名册 22 行逐行有「改键」，行名取自动作名字的唯一主人', () => {
    const h = html(rig(true).p)
    for (const a of BINDABLE_ACTIONS) {
      expect(h, `${a} 那一行要点得动`).toContain(`data-act="arm" data-arg="${a}"`)
      expect(h, `${a} 那一行的名字只有一个来源`).toContain(actionLabel(a))
    }
    expect((h.match(/data-act="arm"/g) ?? []).length, '行数 = 名册长度，多一格少一格都是抄写漂移').toBe(BINDABLE_ACTIONS.length)
  })

  it('鼠标那条路走完一整次改键：点「改键」→ 按 Y → 闪避这一格从此是 Y', () => {
    const r = rig(true)
    click(r.p, 'arm', 'dodge')
    expect(html(r.p), '页脚要说清在等什么（哪一节的哪一行），以及怎么退；KI-360 起玩法那一节的键盘等待连鼠标一起说').toContain('等待一枚键（或鼠标） · 玩法键位 · 闪避')
    key('KeyY')
    pump(r.p, r.input)
    expect(r.bindings.get().gameplay.keyboard.KeyY, '改的确实是运行时那张表').toBe('dodge')
    expect(r.input.binds.keyboard.KeyY, '面板与消费者同一份').toBe('dodge')
    expect(html(r.p), 'Y 原本是空着的 ⇒ 这一句由交换的裁决说，不是面板编的').toContain('这把键原本是空着的')
    expect(r.input.takeKeyCapture(), '取走即熄灭：下一枚键回到正常通道').toBeNull()
    key('ControlLeft'); pump(r.p, r.input)
    expect([...r.input.frame.edges], 'Ctrl 已经空着 ⇒ 这一帧不该再有闪避').toEqual([])
    click(r.p, 'arm', 'jump')
    expect(html(r.p), '那句说明只活到下一次操作为止：不是那一格的永久称号').not.toContain('这把键原本是空着的')
    click(r.p, 'unarm')
  })

  it('占着别人键的一枚 ⇒ 说的是一次交换，而原主人仍在玩（落进它腾出来的那一格）', () => {
    const r = rig(true)
    click(r.p, 'arm', 'parry')
    key('ControlLeft')   // Ctrl 此刻是闪避的家
    pump(r.p, r.input)
    const kb = r.bindings.get().gameplay.keyboard
    expect(kb.ControlLeft).toBe('parry')
    expect(kb.KeyG, '闪避落在弹反腾出的 G 上 ⇒ 没有动作因为这次交换而失联').toBe('dodge')
    expect(kb.KeyQ, '其余格子一格都不跟着搬（锁定仍在 Q）').toBe(DEFAULT_BINDS.keyboard.KeyQ)
    expect(html(r.p)).toContain('这把键原本归 闪避 ⇒ 已交换')
    key('ControlLeft'); pump(r.p, r.input)
    expect([...r.input.frame.edges], '按新表打得动：这一帧是弹反，不是闪避').toEqual(['parry'])
  })

  it('等键途中那一枚 ↑ 绑得上，而菜单那条不会顺手替玩家走一行', () => {
    const r = rig(true)
    r.input.uiOwner = 'panel'
    click(r.p, 'arm', 'jump')
    key('ArrowUp')
    r.input.poll(TICK_DT)
    expect([...r.input.uiEdges], '等待那一帧：↑ 既没变成"走一行"，也没变成"跳"').toEqual([])
    expect([...r.input.frame.edges], '等待那一帧：↑ 既没变成"走一行"，也没变成"跳"').toEqual([])
    r.p.uiStep(new Set<UiIntent>(r.input.uiEdges))
    expect(r.bindings.get().gameplay.keyboard.ArrowUp, '↑ 也可以是一把玩法键：两条通道各自成表').toBe('jump')
    expect(html(r.p), '等待已撤').not.toContain('等待一枚键')
  })

  it('Escape 是取消而不是绑成 Escape：那是这一屏唯一的后退键，绑走它等于把门拆了', () => {
    const r = rig(true)
    r.input.uiOwner = 'panel'   // 面板开着时菜单那条归它（`main.ts` 那一处赋值）
    const before = r.bindings.get()
    click(r.p, 'arm', 'jump')
    key('Escape')
    pump(r.p, r.input)
    expect(r.bindings.get(), '一格都没改').toEqual(before)
    expect(html(r.p), '等待已撤').not.toContain('等待一枚键')
    expect(r.input.uiBinds.keyboard.Escape, '菜单那条的 Escape 仍然是后退').toBe('back')
    key('ArrowUp'); pump(r.p, r.input)
    expect(r.input.takeKeyCapture(), '取消之后 ↑ 不再进捕获').toBeNull()
    expect([...r.input.uiEdges], '↑ 回到菜单那条：走一行').toEqual(['up'])
  })

  it('换行/换页/关面板都撤等待：留下半截武装，下一枚键就凭空消失', () => {
    for (const way of ['down', 'tab', 'close'] as const) {
      const r = rig(true)
      click(r.p, 'arm', 'dodge')
      if (way === 'down') pump(r.p, r.input, ['down'])
      if (way === 'tab') click(r.p, 'tab', 'tune')
      if (way === 'close') r.p.close()
      key('ControlLeft')
      r.input.poll(TICK_DT)
      expect(r.input.takeKeyCapture(), `${way} 之后不该还接着捕获`).toBeNull()
      expect([...r.input.frame.edges], `${way} 之后 Ctrl 立刻照常是闪避`).toEqual(['dodge'])
    }
  })

  it('外部改表也立刻反映在行上：面板每帧现读运行时那张表，不抄默认表', () => {
    const r = rig(true)
    r.bindings.set({ gameplay: { keyboard: { KeyH: 'parry' } } })
    click(r.p, 'tab', 'tune')
    click(r.p, 'tab', 'ops')
    const h = html(r.p)
    const row = h.slice(h.indexOf('弹反'), h.indexOf('弹反') + 260)
    expect(row, '默认表上的 G 已经不是弹反那一格的读数').toContain('<span class="num">H</span>')
    expect(row).not.toContain('G')
  })
})

describe('KI-337 手柄可达（§7）：这一屏的每一格只用 ↑↓/Enter 走得到', () => {
  it('不碰鼠标：走格子 → Enter 点「改键」→ 一枚键绑上', () => {
    const r = rig(true)
    /** 每一行今天有两格按钮（「改键」与「解绑」），所以"走到某一行的改键"要走到那一格为止，而不是数行号 */
    walkTo(r.p, r.input, 'data-act="arm"')
    expect(focusTag(html(r.p)), '焦点框要落在某个可执行行上').toContain('data-act="arm"')
    const target = (focusTag(html(r.p)).match(/data-arg="(\w+)"/) ?? [])[1] as ActionName
    pump(r.p, r.input, ['confirm'])
    expect(html(r.p), 'Enter 与鼠标点击落在同一个 handler 上').toContain(`等待一枚键（或鼠标） · 玩法键位 · ${actionLabel(target)}`)
    key('KeyY'); pump(r.p, r.input)
    expect(r.bindings.get().gameplay.keyboard.KeyY, `${target} 真的绑上了`).toBe(target)
  })

  it('到端点的 ◀ 写成 disabled，而 Enter 不许绕过它（键盘那条没人替玩家挡）', () => {
    const r = rig(true)
    for (let i = 0; i < 30; i++) click(r.p, 'gstep', 'bufferMs:-1')
    expect(r.gameplay.get().bufferMs, '界由 GAMEPLAY_BOUNDS 说：鼠标按到底也越不出去').toBe(GAMEPLAY_BOUNDS.bufferMs.min)
    expect(html(r.p)).toMatch(/data-act="gstep" data-arg="bufferMs:-1" disabled/)
    // 200 而不是 80：菜单那一节（KI-344 那 17 行）插在数值格之前，行号整体上移 ⇒ 圈的步数要跟着这一屏的真实长度走
    for (let i = 0; i < 200 && !focusTag(html(r.p)).includes('bufferMs:-1'); i++) pump(r.p, r.input, ['down'])
    expect(focusTag(html(r.p)), '没走到 ◀ 那一格（量具先红，别让玩家替它红）').toContain('bufferMs:-1')
    pump(r.p, r.input, ['confirm'])
    expect(r.gameplay.get().bufferMs, 'disabled 那一格被 Enter 点下去是 bug，不是可达性').toBe(GAMEPLAY_BOUNDS.bufferMs.min)
    pump(r.p, r.input, ['down'])
    pump(r.p, r.input, ['confirm'])
    expect(r.gameplay.get().bufferMs, '旁边那格 ▶ 没 disabled ⇒ Enter 点得动').toBe(100)
  })

  it('数值格连按十次不许漂出二进制尾巴（存档要的是往返不漂移）', () => {
    const r = rig(true)
    for (let i = 0; i < 10; i++) click(r.p, 'gstep', 'shakeScale:-1')
    expect(r.gameplay.get().shakeScale, '1 − 0.1×10 应该是 0，不是 5.5e-16').toBe(0)
    for (let i = 0; i < 6; i++) click(r.p, 'gstep', 'damageScale:1')
    expect(r.gameplay.get().damageScale, '1 + 0.05×6 = 1.3 ⇒ 正好顶到上界').toBe(1.3)
  })
})

describe('KI-337 五格玩法设置的把手：改完立刻到消费者，且跟着档走', () => {
  it('输入缓冲：面板按一格 ⇒ 夹取 ⇒ Input 手里那个秒数跟着变', () => {
    const r = rig(true)
    click(r.p, 'gstep', 'bufferMs:-1')
    expect(r.gameplay.get().bufferMs).toBe(180)
    expect(r.input.bufferSec, '200ms→0.2s 那一步换算住在消费者接线里，不是面板里').toBeCloseTo(0.18, 6)
    expect(html(r.p), '行上的读数跟着走').toContain('180ms')
    click(r.p, 'gstep', 'bufferMs:1')
    expect(r.input.bufferSec).toBeCloseTo(0.2, 6)
  })

  it('抖动/振动/受击三格各自有一条到消费者的线（数不是死设置店）', () => {
    const r = rig(true)
    click(r.p, 'gstep', 'shakeScale:1')
    expect(r.input.bufferSec, '改的是抖动，别格不许陪绑').toBeCloseTo(0.2, 6)
    click(r.p, 'gstep', 'rumbleScale:1')
    click(r.p, 'gstep', 'damageScale:1')
    const g = r.gameplay.get()
    expect([g.shakeScale, g.rumbleScale, g.damageScale], '三格各按自己那一步：0.1 / 0.1 / 0.05，不是一把尺')
      .toEqual([1.1, 1.1, 1.05])
    expect(html(r.p), '百分比口径由界面这一侧给（表里存的是倍率）').toContain('110%')
  })

  it('帧辅助是开关不是步进：点一下就翻，并且真的到了 Input', () => {
    const r = rig(true)
    expect(r.gameplay.get().frameAssist).toBe(DEFAULT_GAMEPLAY_SETTINGS.frameAssist)
    click(r.p, 'gtoggle', 'frameAssist')
    expect(r.gameplay.get().frameAssist).toBe(true)
    expect(r.input.frameAssist, '这一格的消费者是输入缓冲那一头，不是面板的显示').toBe(true)
    expect(html(r.p)).toContain('开')
    click(r.p, 'gtoggle', 'frameAssist')
    expect(r.input.frameAssist).toBe(false)
  })

  it('整张回默认：键位一格不剩地回去，而五格玩法设置**不在**这一格的范围里（那是两回事）', () => {
    const r = rig(true)
    click(r.p, 'arm', 'dodge'); key('KeyY'); pump(r.p, r.input)
    click(r.p, 'gstep', 'bufferMs:-1')
    click(r.p, 'resetall')
    expect(r.bindings.get(), '键位整张逐字回默认').toEqual(defaultBindings())
    expect(r.input.binds.keyboard.KeyY, '消费者同步').toBeUndefined()
    expect(r.input.binds.keyboard.ControlLeft).toBe('dodge')
    expect(r.gameplay.get().bufferMs, '那一行写的是键位，不许顺手洗掉手感').toBe(180)
    expect(r.notices.at(-1), '点了整张回默认要说一声').toContain('键位整张回到默认')
  })

  it('一行回默认不许抹平另一行', () => {
    const r = rig(true)
    click(r.p, 'arm', 'parry'); key('KeyY'); pump(r.p, r.input)
    click(r.p, 'resetkey', 'dodge')
    const kb = r.bindings.get().gameplay.keyboard
    expect(kb.ControlLeft, '闪避本来就在家里 ⇒ 这一格不该动').toBe('dodge')
    expect(kb.KeyY, '弹反那格是玩家自己挪的，逐行回默认管不到它').toBe('parry')
    expect(r.notices.at(-1), '说了回到哪一行').toContain('闪避')
  })

  it('跟档走：面板改出来的两格（键位 + 手感）一起进档，新世界读回来还是面板上那一列', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    click(w.p, 'tab', 'ops')
    click(w.p, 'arm', 'dodge')
    key('KeyY')
    pump(w.p, w.input)
    click(w.p, 'gstep', 'bufferMs:-1')
    await w.saves.save('ops')
    const raw = JSON.parse((await store.get('ops'))!) as {
      payload: { snapshot: { settings: { bindings: { gameplay: { keyboard: Record<string, string> } }, gameplay: { bufferMs: number } } } }
    }
    expect(raw.payload.snapshot.settings.bindings.gameplay.keyboard.KeyY, '面板写的就是存档读的那一份').toBe('dodge')
    expect(raw.payload.snapshot.settings.gameplay.bufferMs).toBe(180)

    const w2 = makeWorld(store)
    await w2.saves.load('ops')
    expect(w2.bindings.get().gameplay.keyboard.KeyY).toBe('dodge')
    expect(w2.gameplay.get().bufferMs).toBe(180)
    expect(w2.input.bufferSec).toBeCloseTo(0.18, 6)
    click(w2.p, 'tab', 'ops')
    const h = html(w2.p)
    const row = h.slice(h.indexOf('闪避'), h.indexOf('闪避') + 260)
    expect(row, '读回来的世界打开这一页，第一屏就说真话').toContain('<span class="num">Y</span>')
  })
})

describe('KI-342 那一格「无」：界面上关掉一把键，两半一起落', () => {
  it('每行都有「解绑」：名册减去出口那几格，一行一格，而那一格与「改键」同排（不是第二张表）', () => {
    const h = html(rig(true).p)
    const closable = BINDABLE_ACTIONS.filter((a) => !exitRoster().includes(a))
    expect((h.match(/data-act="unbind"/g) ?? []).length, '行数 = 名册长度减出口：多一格少一格都是抄写漂移').toBe(closable.length)
    for (const a of closable) expect(h, `${a} 那一行点得动`).toContain(`data-act="unbind" data-arg="${a}"`)
    for (const a of exitRoster()) expect(h, `${a} 是出口：把手不许画出来，画了就是骗玩家去点`).not.toContain(`data-act="unbind" data-arg="${a}"`)
  })

  it('点「解绑」⇒ 那一格画「无」、名单进 store 与消费者、按旧键不再闪避，而手柄那侧一把都不动', () => {
    const r = rig(true)
    click(r.p, 'unbind', 'dodge')
    const g = r.bindings.get().gameplay
    expect(g.unbound, '「没写」是恢复默认，"点名"才是无').toEqual(['dodge'])
    expect(g.keyboard.ControlLeft, '摘格子与记名单是同一句话的两半').toBeUndefined()
    expect(r.input.binds.unbound, '面板写的就是生效的那一份').toEqual(['dodge'])
    expect(html(r.p), '那一行的键名格换成「无」，不是留一个空格子冒充').toContain('<span class="num">无')
    expect(html(r.p)).toContain('键盘这一格已关掉 · 手柄上还有 2 把')
    key('ControlLeft'); pump(r.p, r.input)
    expect([...r.input.frame.edges], 'Ctrl 这一格从此什么都不是').toEqual([])
    expect(r.input.binds.padButtons[0], '「键盘上不要」≠「这个动词没了」').toBe('dodge')
    expect(r.notices.at(-1), '点了要说出是哪一行').toContain('闪避')
  })

  it('解绑过的那一行没有「解绑」而换成「回默认」：那一格的出口只有一把，且键与名单一起回来', () => {
    const r = rig(true)
    click(r.p, 'unbind', 'dodge')
    const h = html(r.p)
    const row = h.slice(h.indexOf('闪避'), h.indexOf('闪避') + 420)
    expect(row, '一边等着一枚键、一边说这行不要键，是矛盾的两格').not.toContain('data-act="unbind" data-arg="dodge"')
    expect(row).toContain('data-act="resetkey" data-arg="dodge"')
    click(r.p, 'resetkey', 'dodge')
    expect(r.bindings.get().gameplay.unbound, '回默认把名单也销掉（走的是同一个 rebind）').toEqual([])
    expect(r.bindings.get().gameplay.keyboard.ControlLeft).toBe('dodge')
    key('ControlLeft'); pump(r.p, r.input)
    expect([...r.input.frame.edges], '那一格又是闪避了').toEqual(['dodge'])
  })

  it('键盘与手柄都没有的那个动词：那一行说实话，不画一个好看的「无」蒙过去', () => {
    const r = rig(true)
    r.bindings.set({ gameplay: { keyboard: {}, padButtons: {}, unbound: ['observe'] } })
    click(r.p, 'tab', 'tune')
    click(r.p, 'tab', 'ops')
    const h = html(r.p)
    const row = h.slice(h.indexOf('观察'), h.indexOf('观察') + 460)
    expect(row).toContain('键盘这一格已关掉，而手柄那侧也没有这个动词')
    expect(row, '失联那一格用同一个 over 记号（与"到界""刚交换"同族），不是新造一种颜色')
      .toContain('<span class="over">没有键</span>')
    expect(html(r.p), '其余动作仍各有一把键：回补那一遍只管名单外的')
      .toContain('<span class="num">Ctrl</span>')
  })

  it('别行正在等键时点这一行的解绑 ⇒ 先撤等待，否则后来那一枚键会凭空消失', () => {
    const r = rig(true)
    click(r.p, 'arm', 'jump')
    expect(html(r.p), '先确认确实武装着').toContain('等待一枚键')
    click(r.p, 'unbind', 'dodge')
    expect(r.input.takeKeyCapture(), '捕获已熄灭：那一枚键不该再进等键那一条路').toBeNull()
    expect(html(r.p)).not.toContain('等待一枚键')
    key('KeyY'); pump(r.p, r.input)
    expect(r.bindings.get().gameplay.keyboard.KeyY, 'Y 回到正常通道（没被一次已经改过主子的等待吞掉）').toBeUndefined()
    expect([...r.input.frame.edges], '而 Y 今天谁也没绑：解绑之后它仍是空着的一格').toEqual([])
    expect(r.input.takeKeyCapture(), '也没有一枚键被吞进那一次已经作废的等待：键凭空消失才是这一行真正要挡的事').toBeNull()
  })

  it('不碰鼠标也点得动「解绑」：只用 ↑↓/Enter 走到那一格并按下去', () => {
    const r = rig(true)
    const steps = walkTo(r.p, r.input, 'data-act="unbind" data-arg="parry"')
    expect(focusTag(html(r.p)), `没走到弹反那一行的「解绑」（走了 ${steps} 步）`).toContain('data-act="unbind" data-arg="parry"')
    pump(r.p, r.input, ['confirm'])
    expect(r.bindings.get().gameplay.unbound, 'Enter 与鼠标点击落在同一个 handler 上').toEqual(['parry'])
    expect(r.bindings.get().gameplay.keyboard.KeyG, 'G 那一格摘掉了').toBeUndefined()
  })

  it('解绑跟着档走：写进 v14 的那一份名单读回来还是那一格，而重载后的世界按 Ctrl 不闪避', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    click(w.p, 'tab', 'ops')
    click(w.p, 'unbind', 'dodge')
    await w.saves.save('arms')
    const raw = JSON.parse((await store.get('arms'))!) as {
      payload: { snapshot: { settings: { bindings: { gameplay: { keyboard: Record<string, string>; unbound?: string[] } } } } }
    }
    expect(raw.payload.snapshot.settings.bindings.gameplay.unbound, '存档里真有这一格').toEqual(['dodge'])
    expect(raw.payload.snapshot.settings.bindings.gameplay.keyboard.ControlLeft, '而那一格真的不在表里了').toBeUndefined()
    const w2 = makeWorld(store)
    await w2.saves.load('arms')
    expect(w2.bindings.get().gameplay.unbound).toEqual(['dodge'])
    expect(w2.input.binds.keyboard.ControlLeft, '消费者也是这一份').toBeUndefined()
    key('ControlLeft'); pump(w2.p, w2.input)
    expect([...w2.input.frame.edges], '读回来的世界仍然守着你关掉的那一格').toEqual([])
    click(w2.p, 'tab', 'ops')
    expect(html(w2.p), '第一屏就说真话').toContain('<span class="num">无')
  })

  it('整张回默认连名单一起清空：那一行点的「全部回默认」回答的是两半', () => {
    const r = rig(true)
    click(r.p, 'unbind', 'dodge')
    click(r.p, 'unbind', 'observe')
    expect(r.bindings.get().gameplay.unbound, '先确认关过两格').toEqual(['dodge', 'observe'])
    click(r.p, 'resetall')
    expect(r.bindings.get(), '逐字回默认（名单也是）').toEqual(defaultBindings())
    expect(html(r.p), '两行的键都回来了').toContain('<span class="num">Ctrl</span>')
  })
})

/* ------------------------------------------------------------------ 存档那半边 */

/**
 * KI-343：给走查桩插一块 standard 布局的手柄（`null` = 没插）。
 * 每次调用现造手柄对象，因为 `Input.pollPad` 每帧重读一次 `getGamepads()`——事后改那个对象
 * 等于改一份已经交出去的副本，量具会以为自己按了键而世界根本没看见。
 *
 * `values`（KI-364）：**让某一格的 `value` 与 `pressed` 各说各话**。默认仍是「按下即 1、松开即 0」
 * 那把只报布尔的替身；扳机那两把（6/7）要的证人恰恰是「报着 pressed、手指却只推了一半」那一种，
 * 而它在这套走查里以前根本造不出来——量具造不出来的那种设备状态，判据就量不到。
 */
function padWith(pressed: number[] | null, axes: number[] = [0, 0, 0, 0], values: Record<number, number> = {}): void {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: {
      // 按钮名册的长度取自**同一个界**（`BIND_BOUNDS.padButtonMax`）：界上留了那一格（默认表只用到 18），
      // 替身却要拿得到它——否则"搬进一把空着的按钮"那一条路在这套走查里根本走不到，
      // 而面板上那句「这一把原本没有别人」就永远没有读者（覆盖率门量出来的正是这一格）。
      getGamepads: () => (pressed === null ? [null] : [{
        axes,
        buttons: Array.from({ length: BIND_BOUNDS.padButtonMax + 1 }, (_, i) => ({
          pressed: pressed.includes(i), value: values[i] ?? (pressed.includes(i) ? 1 : 0)
        })),
        mapping: 'standard', connected: true
      }])
    }
  })
}

describe('KI-343 手柄那一侧的逐行改键（玩家那半）：一屏两列、各一把把手', () => {
  it('名册 22 行各有一格「手柄」把手，而那一列画的是运行时那张表的几把（一键多用来的是设计）', () => {
    padWith(null)
    const h = html(rig(true).p)
    expect((h.match(/data-act="armpad"/g) ?? []).length, '行数 = 名册长度：与「改键」「解绑」同一把尺').toBe(BINDABLE_ACTIONS.length)
    for (const a of BINDABLE_ACTIONS) expect(h, `${a} 那一行点得动手柄那一格`).toContain(`data-act="armpad" data-arg="${a}"`)
    const row = (name: string): string => { const i = h.indexOf(name); return h.slice(i, i + 300) }
    expect(row('闪避'), '闪避在默认表上是 0 与 12 两把 ⇒ 那一列画的是一串，不是一个').toContain('<span class="num">A、十字上</span>')
    expect(row('弹反'), '弹反是 2 与 15').toContain('<span class="num">X、十字右</span>')
    expect(row('武器槽一'), '走路那四格外还有 throwCrystal 与 ability1..3：手柄上没有默认键的画「—」，不是画一个凭空的键名')
      .toContain('<span class="num">—</span>')
    expect((h.match(/data-act="arm"/g) ?? []).length, '键盘那一格没被新增的那一把顶掉').toBe(BINDABLE_ACTIONS.length)
  })

  it('点「手柄」→ 按一枚按钮 ⇒ 改的是手柄那张，键盘那张一格都不动，而页脚说的是等哪种传感器', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'armpad', 'dodge')
    expect(html(r.p), '页脚要说清等的是手柄（含糊一句"等待一枚键"就是让两种传感器抢同一枚答案）').toContain('等待一枚手柄键 · 玩法键位 · 闪避')
    padWith([2]); pump(r.p, r.input)
    const g = r.bindings.get().gameplay
    expect(g.padButtons[2], 'X 那一从此是闪避').toBe('dodge')
    expect(g.padButtons[0], '它原来那两把一把都不留（留一把就是旧键还能闪避的鬼键）').toBe('parry')
    expect(r.input.binds.padButtons[2], '面板写的就是生效的那一份').toBe('dodge')
    expect(g.keyboard, '而键盘那张逐字没动').toEqual(DEFAULT_BINDS.keyboard)
    expect(html(r.p), '交换由搬家规则说出来，不是面板编的').toContain('这一把原本归 弹反 ⇒ 已交换')
    padWith([2]); pump(r.p, r.input)
    expect([...r.input.frame.edges], '还按着的那一把不许替自己打一次弹反/闪避').toEqual([])
    padWith([]); pump(r.p, r.input)
    padWith([2]); pump(r.p, r.input)
    expect([...r.input.frame.edges], '松开再按才是下一次使用闪避').toEqual(['dodge'])
  })

  it('搬进一把**空着的**按钮 ⇒ 那句话是「这一把原本没有别人」，而不是编一个被换出去的动作', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'armpad', 'dodge')
    padWith([19]); pump(r.p, r.input)          // 19 在界内（`padButtonMax`）而默认表上没人占
    const g = r.bindings.get().gameplay
    expect(g.padButtons[19], '空着的那一格直接落进去，没有另一半要搬家').toBe('dodge')
    expect(Object.entries(g.padButtons).filter(([, a]) => a === 'dodge'), '原来那两把一起摘掉 ⇒ 只剩这一把')
      .toEqual([['19', 'dodge']])
    expect(g.keyboard, '键盘那张照旧一格不动').toEqual(DEFAULT_BINDS.keyboard)
    const h = html(r.p)
    expect(h, '空着就说什么也没被换出去——替玩家编一位"原本的主人"是第二句假话').toContain('这一把原本没有别人')
    expect(h, '而「已交换」那半句在这里是假话').not.toContain('已交换，其余把手不动')
    expect(h, '那一列画的是名册外的下标 ⇒ 如实画原始拼写，不凭猜给一个名字').toContain('<span class="num">Pad19</span>')
    expect(h, '而没有另一半就不许挂那枚记号：同一行不能既说「原本没有别人」又说「刚交换」')
      .not.toContain('<span class="over">刚交换</span>')
  })

  it('等手柄途中按键盘 ⇒ 一格都不改、等待不灭（两条通道都哑与来源无关，而作答只认对应那一种）', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'armpad', 'jump')
    key('KeyY'); pump(r.p, r.input)
    const before = r.bindings.get()
    expect(r.bindings.get(), '键盘那枚没替手柄作答').toEqual(before)
    expect(html(r.p), '还在等手柄那一枚').toContain('等待一枚手柄键 · 玩法键位 · 跳跃')
    padWith([3]); pump(r.p, r.input)
    expect(r.bindings.get().gameplay.padButtons[3], '而手柄那一枚仍接得住').toBe('jump')
    expect(r.bindings.get().gameplay.padButtons[11], 'interact 落进 jump 腾出的那一格 ⇒ 交换的两半由同一条规则算出').toBe('interact')
    expect(html(r.p)).not.toContain('等待一枚手柄键')
  })

  it('一行回默认只回那一条通道：手柄那一行复位，键盘上玩家自己挪过的那一把留着', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'arm', 'parry'); key('KeyY'); pump(r.p, r.input)
    click(r.p, 'armpad', 'dodge'); padWith([2]); pump(r.p, r.input)
    click(r.p, 'armpad', 'dodge')          // 上一枚键已把等待读走 ⇒ 再武装一次才露出那一格「手柄回默认」
    const h = html(r.p)
    expect(h, '等待中才有这一行的「手柄回默认」（与键盘那条同一布局）').toContain('data-act="resetpad" data-arg="dodge"')
    expect(h, '而这一行的键盘「回默认」不在这里出现：一行两把把手各回各的').not.toContain('data-act="resetkey" data-arg="dodge"')
    click(r.p, 'resetpad', 'dodge')
    const g = r.bindings.get().gameplay
    expect(g.padButtons, '手柄那张逐字回默认（连那一次被交换进来的 parry 一起复位）').toEqual(DEFAULT_BINDS.padButtons)
    expect(g.keyboard.KeyY, '键盘那一行是玩家自己挪的，逐行回默认管不到它').toBe('parry')
    expect(r.notices.at(-1)).toContain('闪避')
    expect(html(r.p), '回默认之后等待也撤了：不留半截武装吞掉下一枚键').not.toContain('等待一枚手柄键')
  })

  it('手柄上没有默认键的那一行点「手柄回默认」⇒ 说的是那句话，不是按了没反应', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'armpad', 'ability1')
    click(r.p, 'resetpad', 'ability1')
    expect(r.notices.at(-1), '面板不许自己猜哪一行有家，那是 store 的回答')
      .toContain('武器槽一 在手柄上没有默认键 ⇒ 这一行没动')
    expect(r.bindings.get().gameplay.padButtons, '一格都没动').toEqual(DEFAULT_BINDS.padButtons)
    expect(r.bindings.get().gameplay.keyboard, '也没顺手把键盘那张洗了').toEqual(DEFAULT_BINDS.keyboard)
  })

  it('不碰鼠标也点得动「手柄」那一格：只用 ↑↓/Enter 走到并按下去', () => {
    padWith(null)
    const r = rig(true)
    const steps = walkTo(r.p, r.input, 'data-act="armpad" data-arg="parry"')
    expect(focusTag(html(r.p)), `没走到弹反那一行的「手柄」（走了 ${steps} 步）`).toContain('data-act="armpad" data-arg="parry"')
    pump(r.p, r.input, ['confirm'])
    expect(html(r.p)).toContain('等待一枚手柄键 · 玩法键位 · 弹反')
    padWith([0]); pump(r.p, r.input)
    expect(r.bindings.get().gameplay.padButtons[0]).toBe('parry')
  })

  it('手柄改键跟着档走：写进 v14 的那一把读回来还是那一把，重载后的世界第一屏说真话', async () => {
    padWith(null)
    const store = new MapStore()
    const w = makeWorld(store)
    click(w.p, 'tab', 'ops')
    click(w.p, 'armpad', 'dodge')
    padWith([2]); pump(w.p, w.input)
    await w.saves.save('pads')
    const raw = JSON.parse((await store.get('pads'))!) as {
      payload: { snapshot: { settings: { bindings: { gameplay: { padButtons: Record<string, string> } } } } }
    }
    expect(raw.payload.snapshot.settings.bindings.gameplay.padButtons['2'], '存档里真有手柄那一格').toBe('dodge')
    const w2 = makeWorld(store)
    await w2.saves.load('pads')
    expect(w2.bindings.get().gameplay.padButtons[2], 'store 读回来还是那一把').toBe('dodge')
    expect(w2.input.binds.padButtons[2], '消费者同一份').toBe('dodge')
    click(w2.p, 'tab', 'ops')
    const h = html(w2.p)
    const i = h.indexOf('闪避')
    expect(h.slice(i, i + 300), '第一屏那一列画的是 X，不是默认的 A、十字上').toContain('<span class="num">X</span>')
    padWith([2]); pump(w2.p, w2.input)
    expect([...w2.input.frame.edges], '读回来的世界按那一把就是闪避').toEqual(['dodge'])
  })

  it('等待途中递进来一枚 `back` ⇒ 先撤那一步等待，不退整层面板（那一格留着有人测，不是装饰）', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'arm', 'jump')
    const before = r.bindings.get()
    pump(r.p, r.input, ['back'])
    expect(html(r.p), '等待已撤').not.toContain('等待一枚键')
    expect(r.p.isOpen, '退的是那一步等待，不是整层面板').toBe(true)
    expect(r.bindings.get(), '一格都没改').toEqual(before)
    key('KeyY'); pump(r.p, r.input)
    expect(r.bindings.get().gameplay.keyboard.KeyY, '而撤掉的等待不许把这一枚键吞掉：它回到正常通道').toBeUndefined()
  })
})


/**
 * KI-344：菜单那条通道的逐行改键（§5.1 那句「UI 导航同样可改」的最后一块）。
 *
 * 三条裁决在这一屏各有它的画法，腿就按这三条各量一次：
 * ① **单元是整组**——`confirm` 在默认表上是四把等价键，所以那一列画的是一串，改这一行 = 只留玩家按下的那一把，
 *    而"被抢走一把"与"整组搬了家"是两句话（`rebindUi` 的 `moved` 回答它，面板不许自己数）。
 * ② **「无」只长在有回补那一遍的通道上**——菜单这一格关掉写的是 `ui.unbound` 两半，手柄那侧一格都不动。
 * ③ **`back` 不许关**——「菜单必须走得出去」：那一行不画「解绑」把手，被硬点到时说的是「关不掉」，
 *    而不是静默，也不是"已关掉"。判据读的是 `UI_EXIT_INTENTS` 那一份名册，界面是它的第三个读者。
 */
describe('KI-344 菜单那一节：单元是整组、「无」只关键盘那半、后退不许关', () => {
  /** 一个意图此刻握着哪几把（升序，与表主人的落表序同一把尺） */
  const uiCodes = (kb: Record<string, UiIntent>, intent: UiIntent): string[] =>
    Object.keys(kb).filter((c) => kb[c] === intent).sort()

  it('名册 17 行逐行有「改键」，行名取自意图名字的唯一主人，而「解绑」只画在关得掉的那几格', () => {
    const h = html(rig(true).p)
    const sec = h.slice(h.indexOf('菜单导航'))
    expect(sec.length, '菜单那一节要在页面上（切不到那一节这些断言就是空测试）').toBeLessThan(h.length)
    for (const i of UI_INTENTS) {
      expect(sec, `${i} 那一行要有「改键」`).toContain(`data-act="armui" data-arg="${i}"`)
      expect(sec, `${i} 那一行的名字只有一个来源`).toContain(intentLabel(i))
    }
    expect((h.match(/data-act="armui"/g) ?? []).length, '行数 = 名册长度，多一格少一格都是抄写漂移').toBe(UI_INTENTS.length)
    /**
     * 「解绑」那一格**逐行点名**，不数总数：出口只有一格时，总数断言挡不住"数对了但画错了行"——
     * 反向实测 A5 把 `locked` 从读名单改成硬写一个意图名，`unbindui` 的总数仍是 16，
     * 而画错的那两行（`back` 多一把、`pagePrev` 少一把）只有逐行点名才量得出。
     */
    for (const i of UI_INTENTS) {
      const handle = `data-act="unbindui" data-arg="${i}"`
      if (UI_EXIT_INTENTS.includes(i)) {
        expect(sec, `「${intentLabel(i)}」那一行不许有一把关得掉的把手（画出来就是"这行本来能关"）`).not.toContain(handle)
        expect(sec, '而那一行要说清为什么没有这一格').toContain(`「${intentLabel(i)}」不许关掉`)
      } else {
        expect(sec, `${i} 关得掉，那一格却没画 ⇒ 玩家少一个出口`).toContain(handle)
        expect(sec, `${i} 那一行不许挂着「不许关掉」那句话`).not.toContain(`「${intentLabel(i)}」不许关掉`)
      }
    }
  })

  it('那一列画的是整组等价键，不是第一把（单元是整组这句话要看得见）', () => {
    const r = rig(true)
    const group = uiCodes(r.input.uiBinds.keyboard, 'confirm').map(codeLabel).join('、')
    expect(group.split('、').length, '默认表上这一行本来就不止一把 ⇒ 这条腿不是空断言').toBeGreaterThan(1)
    expect(html(r.p), `那一格要画 ${group}`).toContain(`<span class="num">${group}</span>`)
  })

  it('页脚要说清等的是哪一节：玩法的「后退」与菜单的「后退」在同一屏上不是同一行', () => {
    const r = rig(true)
    expect(actionLabel('moveDown'), '两节里确实各有一格叫「后退」（重名的那一条腿在 action-labels 里量）').toBe(intentLabel('back'))
    click(r.p, 'arm', 'moveDown')
    expect(html(r.p)).toContain('等待一枚键（或鼠标） · 玩法键位 · 后退')
    click(r.p, 'armui', 'back')
    expect(html(r.p), '同一个行名，换了节就要换一句：光靠名字分不开的两行，页脚必须指得出在哪一节')
      .toContain('等待一枚键 · 菜单导航 · 后退')
    click(r.p, 'unarm')
  })

  it('点「改键」→ 按一把空着的键 ⇒ 整组折成那一把，另外两张表一格都不动', () => {
    const r = rig(true)
    r.input.uiOwner = 'panel'
    click(r.p, 'armui', 'confirm')
    key('KeyF'); pump(r.p, r.input)
    const u = r.bindings.get().ui.keyboard
    expect(uiCodes(u, 'confirm'), '改这一行就是只留这一把（其余三把不是留着慢慢失效）').toEqual(['KeyF'])
    expect(r.input.uiBinds.keyboard.KeyF, '面板写的就是生效的那一份').toBe('confirm')
    key('KeyF'); r.input.poll(TICK_DT)
    expect([...r.input.uiEdges], '改完之后按 F 就是确认').toEqual(['confirm'])
    expect(r.bindings.get().gameplay.keyboard, '玩法那张一格都不动（两条通道各自成表）').toEqual(DEFAULT_BINDS.keyboard)
    expect(r.bindings.get().ui.padButtons, '键盘那一拍不洗手柄那张：两条通道各自成表').toEqual(UI_BINDS.padButtons)
    const h = html(r.p)
    expect(h, '空着的那一把不许被编出一位原本的主人').toContain('这把键原本是空着的')
    expect(h, '而没有另一半就不挂那枚记号').not.toContain('整组搬家')
  })

  it('抢的是别人的一把 ⇒ 说的是「少了这一把、没搬去别处」，而不是编一次搬家', () => {
    const r = rig(true)
    click(r.p, 'armui', 'pick1')
    key('Enter'); pump(r.p, r.input)
    const u = r.bindings.get().ui.keyboard
    expect(uiCodes(u, 'pick1'), '直接选 1 此刻只握玩家给的那一把').toEqual(['Enter'])
    expect(uiCodes(u, 'confirm'), '确认少了一把而其余三把照旧 ⇒ 它没有搬家').toEqual(['KeyE', 'NumpadEnter', 'Space'])
    const h = html(r.p)
    /**
     * KI-348 改写这一行的预期：原话是「这一把原本归 确认，它还有其余等价键」，两处都不守——
     * ① 落点是键盘那张，就该说「这把键」（那是 KI-345 立的口径，当时只兑现在「原本没有别人」那一支）；
     * ② 「还有其余等价键」在这张表上此刻为真，但在**不回补的手柄那张**上可以为假（原主人可能一把不剩），
     *    而 `moved=false` 本身只说得出"少了这一把、没搬去别处"。判据换成了形状说得出的那一句。
     */
    expect(h).toContain('这把键原本归 确认 ⇒ 它少了这一把，没搬去别处')
    expect(h, '说成「搬家」就是第二句假话：那一行了无痕迹，玩家以为确认没了').not.toContain('整组搬家')
  })

  it('整组只有一把的被抢走 ⇒ 它整组搬了家，而名册上不许有人因此失联', () => {
    const r = rig(true)
    click(r.p, 'armui', 'up')
    key('ArrowDown'); pump(r.p, r.input)
    const u = r.bindings.get().ui.keyboard
    expect(uiCodes(u, 'up')).toEqual(['ArrowDown'])
    expect(uiCodes(u, 'down'), '下移丢了唯一的家 ⇒ 落进上移腾出的那一格（交换的两半由同一条规则算出）').toEqual(['ArrowUp'])
    const h = html(r.p)
    expect(h, 'KI-348：那一句的名词跟着落点走（写进的是键盘那张 ⇒ 「这把键」），裁决一个字没变').toContain('这把键原本归 下移 ⇒ 它整组搬了家')
    expect(h).toContain('<span class="over">整组搬家</span>')
    for (const i of UI_INTENTS) expect(uiCodes(u, i).length, `${i} 不许因为这一次交换而失联`).toBeGreaterThanOrEqual(1)
  })

  it('菜单那一行的「解绑」写的是两半：表里没它、名单里有它，而玩法那份名单一个字不沾', () => {
    const r = rig(true)
    click(r.p, 'unbindui', 'up')
    const u = r.bindings.get().ui
    expect(Object.values(u.keyboard), '上移在键盘上一格都不占').not.toContain('up' as UiIntent)
    expect(u.unbound, '名单与表两半一起写：只摘格子等于"下次回补又把它请回来"').toEqual(['up'])
    expect(r.input.uiBinds.unbound, '消费者那份与 store 同一句话').toEqual(['up'])
    expect(r.bindings.get().gameplay.unbound, '玩法那份名单是另一条通道').toEqual([])
    expect(r.notices.at(-1), '解绑要说的是"这一屏这一格"，不是"这个动词没了"').toContain('上移')
    const h = html(r.p)
    expect(h, '关掉的那一格说的是键盘这一组，不谎称整条路都没了').toContain('键盘这一组已关掉')
    click(r.p, 'armui', 'up')
    key('KeyK'); pump(r.p, r.input)
    expect(r.bindings.get().ui.unbound, '改键那一遍必须销名单，否则刚绑上的一格会被下一次整张夹取抹掉').toEqual([])
    expect(uiCodes(r.bindings.get().ui.keyboard, 'up')).toEqual(['KeyK'])
  })

  it('硬点 `back` 那一格 ⇒ 说的是「关不掉」，一格都不动，也不写名单', () => {
    const r = rig(true)
    const before = r.bindings.get()
    click(r.p, 'unbindui', 'back')
    expect(r.bindings.get(), '关掉菜单唯一的退路 = 把这一屏变成陷阱').toEqual(before)
    expect(r.notices.at(-1)).toContain('后退')
    expect(r.notices.at(-1), '静默的按钮与一句"已关掉"都不可信：要回答的是"这一行关不掉"').toContain('关不掉')
  })

  it('菜单那一行的「回默认」＝整组一起回来（不是只回第一把），顺手退掉名单', () => {
    const r = rig(true)
    click(r.p, 'armui', 'confirm'); key('KeyF'); pump(r.p, r.input)
    click(r.p, 'armui', 'confirm')          // 上一枚键已把等待读走 ⇒ 再武装一次才露出那一格「回默认」（与玩法那一节同一布局）
    expect(html(r.p)).toContain('data-act="resetui" data-arg="confirm"')
    click(r.p, 'resetui', 'confirm')
    expect(uiCodes(r.bindings.get().ui.keyboard, 'confirm'), '四把等价键逐字回来').toEqual(uiCodes(UI_BINDS.keyboard, 'confirm'))
    expect(r.notices.at(-1)).toContain('确认')
    click(r.p, 'unbindui', 'up')
    click(r.p, 'resetui', 'up')
    const u = r.bindings.get().ui
    expect(u.unbound, '「回默认」就是「无」的出口（与玩法同一把）').toEqual([])
    expect(uiCodes(u.keyboard, 'up')).toEqual(['ArrowUp'])
    expect(html(r.p), '回默认之后等待也撤了：不留半截武装吞掉下一枚键').not.toContain('等待一枚键')
  })

  it('那一格「全部回默认」说的是两条通道：菜单那组与玩法那张一起逐字回来', () => {
    const r = rig(true)
    click(r.p, 'armui', 'confirm'); key('KeyF'); pump(r.p, r.input)
    click(r.p, 'unbindui', 'up')
    click(r.p, 'arm', 'dodge'); key('KeyV'); pump(r.p, r.input)
    click(r.p, 'resetall')
    const b = r.bindings.get()
    expect(b.ui.keyboard, '菜单那张逐字回默认（整组一起）').toEqual(defaultBindings().ui.keyboard)
    expect(b.ui.unbound, '两份名单一起清空：那一格说的是整张，不是某一条通道').toEqual([])
    expect(b.gameplay.unbound).toEqual([])
    expect(b.gameplay.keyboard).toEqual(defaultBindings().gameplay.keyboard)
  })

  it('名册外的 `data-arg`（DOM 那侧谁都能写）三把把手都不动：不改表、不响一声、不编说明', () => {
    const r = rig(true)
    const before = r.bindings.get()
    for (const act of ['armui', 'resetui', 'unbindui']) {
      click(r.p, act, 'fly')
      if (act === 'armui') { key('KeyJ'); pump(r.p, r.input) }
    }
    expect(r.bindings.get(), '名册外的名字连名字都没有 ⇒ 一律不落到表上').toEqual(before)
    expect(r.notices, '那一行不在屏幕上，没有一句该响').toEqual([])
    const h = html(r.p)
    expect(h, '没有交换就没有说明：编一句「原本是空着的」就是替玩家圆场').not.toContain('原本')
    expect(h, '没武装就没有等待').not.toContain('等待一枚键')
  })

  it('等待途中递进来一枚 `Pad<n>` ⇒ 菜单那一行落到手柄那张上，而那句话跟着落点走、不跟着传感器猜', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'armui', 'confirm')
    expect(html(r.p)).toContain('等待一枚键 · 菜单导航 · 确认')
    key('Pad9'); pump(r.p, r.input)          // 等的是键盘，作答的那一串说的是手柄 ⇒ 落到哪张表由边界回答
    const u = r.bindings.get().ui
    expect(u.padButtons[9], '语法就是路由：这一串写的是手柄那一把，就落在 `ui.padButtons` 上').toBe('confirm')
    expect(u.keyboard, '键盘那侧的四把等价键一把不少（改了手柄不等于洗了键盘）').toEqual(UI_BINDS.keyboard)
    const h = html(r.p)
    expect(h, '措辞跟着落点走：那一把是手柄上的一把，就说「这一把」，不说「这把键」').toContain('这一把原本没有别人')
    expect(h, '空着的那一把不许被编出一位原本的主人').not.toContain('这把键原本是空着的')
    expect(h, '而没有另一半就不挂那枚记号').not.toContain('整组搬家')
    expect(h, '等待随这一枚键一起撤掉：不留半截武装吞掉下一枚').not.toContain('等待一枚')
  })

  it('不碰鼠标也点得动菜单那一节的「改键」：只用 ↑↓/Enter 走到并按下去', () => {
    const r = rig(true)
    const steps = walkTo(r.p, r.input, 'data-act="armui" data-arg="confirm"', 240)
    expect(focusTag(html(r.p)), `没走到确认那一行的「改键」（走了 ${steps} 步）`).toContain('data-act="armui" data-arg="confirm"')
    pump(r.p, r.input, ['confirm'])
    expect(html(r.p)).toContain('等待一枚键 · 菜单导航 · 确认')
    key('KeyF'); pump(r.p, r.input)
    expect(r.bindings.get().ui.keyboard.KeyF, '键盘那条路走完的改键与鼠标同一件事').toBe('confirm')
  })

  it('菜单那条跟着档走：写进 v14 的 `settings.bindings.ui`，读回来的世界第一屏画的是那一把', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    click(w.p, 'tab', 'ops')
    click(w.p, 'armui', 'confirm')
    key('KeyF'); pump(w.p, w.input)
    click(w.p, 'unbindui', 'up')
    await w.saves.save('menu')
    const raw = JSON.parse((await store.get('menu'))!) as {
      payload: { snapshot: { settings: { bindings: { ui: { keyboard: Record<string, string>; unbound: string[] } } } } }
    }
    expect(raw.payload.snapshot.settings.bindings.ui.keyboard.KeyF, '存档里真有菜单那一格').toBe('confirm')
    expect(raw.payload.snapshot.settings.bindings.ui.unbound, '名单也跟着档走（那一格是它唯一的落点）').toEqual(['up'])
    const w2 = makeWorld(store)
    await w2.saves.load('menu')
    expect(w2.input.uiBinds.keyboard.KeyF, '消费者读回来还是那一把').toBe('confirm')
    expect(w2.input.uiBinds.unbound).toEqual(['up'])
    click(w2.p, 'tab', 'ops')
    const sec = html(w2.p).slice(html(w2.p).indexOf('菜单导航'))
    const row = sec.slice(sec.indexOf(`<span class="name">${intentLabel('confirm')}<span class="note"`))
    expect(row.slice(0, 260), '第一屏那一格画的是 F，不是默认那四把（那一列画的仍是运行时那一份）').toContain('<span class="num">F</span>')
    expect(sec, '而关掉的那一格第一屏就说「已关掉」').toContain('键盘这一组已关掉')
  })
})


/* ------------------------------------------------------------------ KI-345 */

/**
 * KI-345：菜单那一节的**手柄那一列**，加上 `ui.stickThreshold` 那一格的入口。
 *
 * 上一批把这条通道做成了"改得动"，但只有键盘那一半有把手，而 `ui.padButtons` 与 `ui.stickThreshold`
 * 早就在档里走、也早被 `Input` 读——缺的从来不是机制，是把手。这一屏量的是把手接上之后玩家看得见的四件事：
 * ① **两列各一把把手**：等的是哪种传感器就只在页脚说那一种，一次等待也不许落到另一张表上；
 * ② **措辞与记号跟着落点走**（边界给的 `onto`）：哪张表被写了就按哪张表说话——面板若拿"我武装的是键盘"
 *    去猜手柄那一格的内容，同一行就会同时挂着「原本没有别人」和一句凭空的"这把键"；
 * ③ **阈值那一格是机制不是装饰**：面板改的那一个数就是 `Input` 下一帧读的那一个数，
 *    界由 `BIND_BOUNDS` 说，端点那两把把手写成 `disabled`，而 Enter 也绕不过它（§7）；
 * ④ **手柄那侧仍然没有「无」**：那张表不回补，"没键"与"关掉了"在那里是同一个形状，所以只有一把「解绑」。
 */
describe('KI-345 菜单那一节的手柄列与摇杆阈值：两列各一把把手，措辞跟着落点走', () => {
  /** 某个意图此刻在**运行时手柄表**上的显示串（与面板同一把尺：下标升序、`padLabel`、没家就「—」） */
  const padGroup = (pad: Record<number, UiIntent>, i: UiIntent): string => {
    const cells = Object.keys(pad).map(Number).filter((n) => pad[n] === i).sort((a, b) => a - b)
    return cells.length ? cells.map(padLabel).join('、') : '—'
  }
  /** 某一行的两列内容：`[0]` = 键盘那一列，`[1]` = 手柄那一列（记号挂错列只有分开才量得出） */
  const rowNums = (h: string, intent: UiIntent): string[] => {
    /** 从**菜单那一节的 `<h2>` 之后**找行：两节的行名今天真的重名（菜单的「后退」「左移」与玩法的那两格），
     *  从整页找会先撞进玩法那一节，量具就会拿着玩法那一列去比菜单的表——红的是量具自己。 */
    const sec = h.slice(h.indexOf('菜单导航'))
    const at = sec.indexOf(`<span class="name">${intentLabel(intent)}<span class="note"`)
    expect(at, `${intent} 那一行要在菜单那一节里`).toBeGreaterThanOrEqual(0)
    const rest = sec.slice(at, sec.indexOf('</div>', at))
    return rest.split('<span class="num">').slice(1).map((s) => s.slice(0, s.indexOf('</span>')))
  }

  it('名册 17 行各有一格「手柄」把手，第二列画的是运行时那张表，而九格 `pickN` 那一列是「—」', () => {
    padWith(null)
    const r = rig(true)
    const h = html(r.p)
    const sec = h.slice(h.indexOf('菜单导航'))
    for (const i of UI_INTENTS) expect(sec, `${i} 那一行要有「手柄」那一格`).toContain(`data-act="armuipad" data-arg="${i}"`)
    expect((sec.match(/data-act="armuipad"/g) ?? []).length, '行数 = 名册长度').toBe(UI_INTENTS.length)
    expect((sec.match(/data-act="armui"/g) ?? []).length, '键盘那一格没被新增的把手顶掉：一行两把，不是把前一把换掉').toBe(UI_INTENTS.length)
    for (const i of UI_INTENTS) {
      const nums = rowNums(h, i)
      expect(nums.length, `${i} 那一行有两列（键盘 · 手柄）`).toBe(2)
      expect(nums[1], `${i} 那一列画的是**此刻生效**那张表，不是抄一份默认`).toBe(padGroup(r.input.uiBinds.padButtons, i))
    }
    expect(padGroup(UI_BINDS.padButtons, 'up'), '这条腿不是空断言：默认表上十字键与 A/B/LB/RB 真有八格家').toBe('十字上')
    expect(rowNums(h, 'pick1')[1], '九格 `pickN` 在手柄上没有家 ⇒ 画「—」，不画一个凭空的键名').toBe('—')
    expect((sec.match(/data-act="unbindui"/g) ?? []).length, '键盘那一列的「无」仍只有那一把 ⇒ 一行一处，不多画').toBe(UI_INTENTS.length - UI_EXIT_INTENTS.length)
    /** KI-346 把这条腿的「不许出现」改写成「必须出现」：欠账还上了，钉住缺席的那一枚就该换成一枚钉住在场的 */
    expect((sec.match(/data-act="unbinduipad"/g) ?? []).length,
      '手柄那一列现在也有自己的「无」，而它与键盘那一把同数：两份名单各管各的表，`back` 那一行两列都进不来')
      .toBe(UI_INTENTS.length - UI_EXIT_INTENTS.length)
    expect(sec, '但键盘那一把不许被手柄那一把顶掉：一行两处，不是把前一把改名').toContain('data-act="unbindui" data-arg="up"')
  })

  it('点「手柄」→ 真按一枚按钮 ⇒ 改的是 `ui.padButtons`，键盘那张一格不动，页脚说的是等哪种传感器', () => {
    padWith(null)
    const r = rig(true)
    r.input.uiOwner = 'panel'
    click(r.p, 'armuipad', 'confirm')
    expect(html(r.p), '两节两列都在等键的屏上，页脚要指得出传感器与行').toContain('等待一枚手柄键 · 菜单导航 · 确认')
    padWith([3]); pump(r.p, r.input)         // 3 = Y，默认表上没人占
    const u = r.bindings.get().ui
    expect(u.padButtons[3], '玩家按下的那一从此是确认').toBe('confirm')
    expect(Object.keys(u.padButtons).filter((k) => u.padButtons[Number(k)] === 'confirm'), '原来那一把一把不留（留一把就是旧键还能确认的鬼键）').toEqual(['3'])
    expect(u.keyboard, '键盘那侧的四把等价键一把不少：改了手柄不等于洗了键盘').toEqual(UI_BINDS.keyboard)
    expect(r.input.uiBinds.padButtons[3], '面板写的就是生效的那一份').toBe('confirm')
    const h = html(r.p)
    expect(rowNums(h, 'confirm')[1], '那一列换成了刚按下的那一把（画的是运行时表，不是默认表）').toBe(padLabel(3))
    expect(rowNums(h, 'confirm')[0], '键盘那一列逐字没动').toBe('Enter、E、NumpadEnter、Space')
    expect(h).toContain('这一把原本没有别人')
    padWith([3]); pump(r.p, r.input)
    expect([...r.input.uiEdges], '还按着的那一把不许替自己确认一次').toEqual([])
    padWith([]); pump(r.p, r.input)
    padWith([3]); pump(r.p, r.input)
    expect([...r.input.uiEdges], '松开再按才是下一次确认（绑上的那一把真在菜单通道上说话）').toEqual(['confirm'])
  })

  it('抢走别人唯一的一把 ⇒ 那句话与那枚记号都跟着落点走：记号挂在手柄那一列，键盘那一列一格没被写', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'armuipad', 'up')
    padWith([13]); pump(r.p, r.input)        // 13 = 十字下，是 `down` 唯一的一把
    const pad = r.bindings.get().ui.padButtons
    expect(pad[13]).toBe('up')
    expect(pad[12], '下移拿走上移腾出的那一格 ⇒ 交换的两半由同一条规则算出，面板不自己配').toBe('down')
    const h = html(r.p)
    expect(h, '整组只有一把的被抢走 ⇒ 说的是搬家，而措辞用的是「这一把」（落点在手柄）').toContain('这一把原本归 下移 ⇒ 它整组搬了家')
    const nums = rowNums(h, 'up')
    expect(nums[0], '键盘那一列没被这一次写脏：ArrowUp 还握着，也不挂记号').toBe('ArrowUp')
    expect(nums[1], '记号挂在**被写进的那一列**上：另一列不许替这一列作证').toContain('整组搬家')
    expect(rowNums(h, 'down')[1], '而下移那一列画的是它新落进来的那一把（十字上）').toBe(padLabel(12))
    expect(r.bindings.get().ui.keyboard, '键盘那张逐字默认（两条通道各自成表）').toEqual(UI_BINDS.keyboard)
  })

  it('同一行先点键盘、再点手柄 ⇒ 换的是目标传感器而不是撤销等待（两把把手各等一种来源）', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'armui', 'pageNext')
    expect(html(r.p)).toContain('等待一枚键 · 菜单导航 · 下一页')
    click(r.p, 'armuipad', 'pageNext')
    const h = html(r.p)
    expect(h, '换传感器不是撤销：等待还在，只是改听手柄').toContain('等待一枚手柄键 · 菜单导航 · 下一页')
    expect(h, '键盘那一格回到「改键」：两列的「等待中」各归各的通道').toContain('data-act="armui" data-arg="pageNext">改键<')
    expect(h).toContain('data-act="armuipad" data-arg="pageNext">等待中<')
    key('KeyF'); pump(r.p, r.input)
    expect(r.bindings.get().ui.keyboard.KeyF, '等的是手柄 ⇒ 键盘那一枚不作答').toBeUndefined()
    expect(html(r.p), '而等待也不许被键盘那一枚吞掉：不然玩家下一次按手柄就没了对象').toContain('等待一枚手柄键 · 菜单导航 · 下一页')
    padWith([6]); pump(r.p, r.input)
    expect(r.bindings.get().ui.padButtons[6], '手柄那一枚仍接得住').toBe('pageNext')
    expect(r.bindings.get().ui.keyboard, '键盘那张一格没动').toEqual(UI_BINDS.keyboard)
  })

  it('一行两把「回默认」各回各的通道：手柄那一行复位，键盘上玩家自己挪过的那一把留着', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'armui', 'confirm'); key('KeyF'); pump(r.p, r.input)
    click(r.p, 'armuipad', 'confirm'); padWith([3]); pump(r.p, r.input)
    click(r.p, 'armuipad', 'confirm')        // 上一枚键已把等待读走 ⇒ 再武装一次才露出那一格「手柄回默认」
    const h = html(r.p)
    expect(h, '等待中才有这一行的「手柄回默认」（与键盘那条同一布局）').toContain('data-act="resetuipad" data-arg="confirm"')
    expect(h, '而这一行的键盘「回默认」不在这里出现：一行两把把手各回各的').not.toContain('data-act="resetui" data-arg="confirm"')
    click(r.p, 'resetuipad', 'confirm')
    const u = r.bindings.get().ui
    expect(u.padButtons, '手柄那张逐字回默认（连那一次搬进来的那一把一起复位）').toEqual(UI_BINDS.padButtons)
    expect(u.keyboard.KeyF, '键盘那一行是玩家自己挪的，逐行回默认管不到它').toBe('confirm')
    expect(r.notices.at(-1)).toContain('确认')
    expect(html(r.p), '回默认之后等待也撤了：不留半截武装吞掉下一枚键').not.toContain('等待一枚手柄键')
  })

  it('手柄上没家的那一行点「手柄回默认」⇒ 说的是那句话；同一行的键盘把手回得来（`pick1` 两列对照）', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'armuipad', 'pick1')
    click(r.p, 'resetuipad', 'pick1')
    expect(r.notices.at(-1), '面板不许自己猜哪一行有家，那是 store 的回答')
      .toContain('直接选 1 在手柄里没有默认键 ⇒ 这一行没动')
    expect(r.bindings.get().ui.padButtons, '一格都没动').toEqual(UI_BINDS.padButtons)
    click(r.p, 'resetui', 'pick1')
    expect(r.notices.at(-1), '同一行的键盘那一格有 Digit1 与 Numpad1 两把 ⇒ 回得来，说的是另一句话').toContain('整组回到默认')
    expect(rowNums(html(r.p), 'pick1')[1], '而手柄那一列画的还是「—」：没回补也没从别人手里抢一把').toBe('—')
  })

  it('关掉键盘那一组之后，那一行要说清手柄上还有几把；手柄上没家的那一行说的是两边都没有', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'unbindui', 'up')
    const h = html(r.p)
    expect(h, '键盘关掉了而手柄那侧照旧 ⇒ 那句话必须报出还剩几把，不然玩家以为整条路没了').toContain('键盘这一组已关掉 · 手柄上还有 1 把')
    expect(rowNums(h, 'up')[0], '键盘那一格画「无」').toBe('无')
    expect(rowNums(h, 'up')[1], '手柄那一格照样画着十字上：这一格洗不到另一条通道').toBe(padLabel(12))
    click(r.p, 'unbindui', 'pick1')
    expect(html(r.p), '两边都没有的 ⇒ 说的是"也没有这个意图"，不报一个凭空的 0 把').toContain('键盘这一组已关掉，而手柄那侧也没有这个意图')
    click(r.p, 'resetall')
    expect(html(r.p), '而整张回默认之后那两行都说的是键名，不再是「已关掉」').not.toContain('键盘这一组已关掉')
  })

  it('名册外的 `data-arg` 与步进那一格的错参数 ⇒ 五把把手加 ◀▶ 都不动、不响、不编说明', () => {
    padWith(null)
    const r = rig(true)
    const before = r.bindings.get()
    for (const act of ['armui', 'armuipad', 'resetui', 'resetuipad', 'unbindui']) click(r.p, act, 'fly')
    for (const arg of ['notStick:1', 'stickThreshold:abc', 'stickThreshold:', 'stickThreshold']) click(r.p, 'ustep', arg)
    key('KeyJ'); pump(r.p, r.input)
    expect(r.bindings.get(), '名册外的名字连名字都没有 ⇒ 一律不落到表上').toEqual(before)
    expect(r.bindings.get().ui.stickThreshold, '步进那一格认的不是"前缀像不像"，是那一格的名字').toBe(UI_BINDS.stickThreshold)
    expect(r.notices, '那一行不在屏幕上，没有一句该响').toEqual([])
    const h = html(r.p)
    expect(h, '没有交换就没有说明：替玩家圆场的那句「原本是空着的」是假读数').not.toContain('原本')
    expect(h, '没武装就没有等待（名册外的那一次不许留下半截武装）').not.toContain('等待一枚')
  })

  it('阈值那一格：读数＝此刻生效那一个数，◀▶ 一步 0.05，端点写 `disabled`，连按不漂出二进制尾巴', () => {
    padWith(null)
    const r = rig(true)
    r.input.uiOwner = 'panel'
    const sec = (): string => { const h = html(r.p); return h.slice(h.indexOf('摇杆推过多少算按下')) }
    expect(sec(), '第一屏画的是**生效**那一个数（读 `bindsSource.uiBinds`，不是抄一份默认）')
      .toContain(`${Math.round(UI_BINDS.stickThreshold * 100)}%`)
    click(r.p, 'ustep', 'stickThreshold:1')
    expect(r.bindings.get().ui.stickThreshold, '0.05 是界面粒度：写死在这里正是为了量它').toBe(0.6)
    expect(r.input.uiBinds.stickThreshold, '面板走的是 store ⇒ 消费者拿到同一个数，不是第二份状态').toBe(0.6)
    for (let i = 0; i < 12; i++) click(r.p, 'ustep', 'stickThreshold:1')
    expect(r.bindings.get().ui.stickThreshold, '界由 `BIND_BOUNDS` 说：鼠标按到底也越不出去').toBe(BIND_BOUNDS.stickThreshold.max)
    expect(sec()).toMatch(/data-act="ustep" data-arg="stickThreshold:1" disabled/)
    for (let i = 0; i < 30; i++) click(r.p, 'ustep', 'stickThreshold:-1')
    const v = r.bindings.get().ui.stickThreshold
    expect(v, '0.9 − 0.05×13 应该是那一个字，不是拖出二进制尾巴的近似').toBe(BIND_BOUNDS.stickThreshold.min)
    expect(String(v), '存进档的就是这一串：往返不漂移要的是十进制的干净').toBe('0.25')
    expect(sec()).toMatch(/data-act="ustep" data-arg="stickThreshold:-1" disabled/)
    expect(sec(), '而另一端没被连按拖走：到界了才写 disabled').toMatch(/data-act="ustep" data-arg="stickThreshold:1"\s*>▶/)
  })

  it('阈值改的是机制不是装饰：把"摇杆推过这条线才算按下"改掉，下一帧手柄就真的不发了', () => {
    padWith(null)
    const r = rig(true)
    r.input.uiOwner = 'panel'
    padWith([], [0, 0.7]); pump(r.p, r.input)
    expect([...r.input.uiEdges], '默认 55% ⇒ 推到 0.7 是「下移」').toEqual(['down'])
    padWith([], [0, 0]); pump(r.p, r.input)
    for (let i = 0; i < 7; i++) click(r.p, 'ustep', 'stickThreshold:1')   // 0.55 → 0.90
    padWith([], [0, 0.7]); pump(r.p, r.input)
    expect([...r.input.uiEdges], '同一只手、同一个推量，改完阈值就不算按下了 ⇒ 这一格不是给存档看的装饰').toEqual([])
    click(r.p, 'resetall')
    padWith([], [0, 0.7]); pump(r.p, r.input)
    expect([...r.input.uiEdges], '回默认之后又算了：那一个数从头到尾只有一个主人').toEqual(['down'])
    padWith([], [0, 0]); pump(r.p, r.input)
  })

  it('不碰鼠标也走得到新格子：只用 ↑↓/Enter 点得动「手柄」，而端点那把 ◀ 连 Enter 也绕不过', () => {
    padWith(null)
    const r = rig(true)
    const steps = walkTo(r.p, r.input, 'data-act="armuipad" data-arg="confirm"', 240)
    expect(focusTag(html(r.p)), `没走到确认那一行的「手柄」（走了 ${steps} 步）`).toContain('data-act="armuipad" data-arg="confirm"')
    pump(r.p, r.input, ['confirm'])
    expect(html(r.p)).toContain('等待一枚手柄键 · 菜单导航 · 确认')
    padWith([3]); pump(r.p, r.input)
    expect(r.bindings.get().ui.padButtons[3], '键盘那条路走完的手柄改键与鼠标同一件事').toBe('confirm')
    for (let i = 0; i < 12; i++) click(r.p, 'ustep', 'stickThreshold:-1')
    let reached = 0
    while (reached < 300 && !focusTag(html(r.p)).includes('data-act="ustep" data-arg="stickThreshold:-1"')) { pump(r.p, r.input, ['down']); reached++ }
    expect(focusTag(html(r.p)), `没走到阈值那一格的 ◀（走了 ${reached} 步）`).toContain('data-act="ustep" data-arg="stickThreshold:-1"')
    expect(focusTag(html(r.p)), '框住那一格此刻真的写着 disabled ⇒ Enter 绕不过的是这一句，不是夹紧之后那个数（KI-345 A4 量出来的那半格）').toContain('disabled')
    pump(r.p, r.input, ['confirm'])
    expect(r.bindings.get().ui.stickThreshold, 'disabled 那一格被 Enter 点下去是 bug，不是可达性').toBe(BIND_BOUNDS.stickThreshold.min)
    pump(r.p, r.input, ['down'])
    pump(r.p, r.input, ['confirm'])
    expect(r.bindings.get().ui.stickThreshold, '旁边那格 ▶ 没 disabled ⇒ Enter 点得动（上一条不是空断言）').toBe(0.3)
  })

  it('手柄那一列与阈值跟着档走：写进 v14 的两格读回来还是它们，重载后的世界第一屏说真话', async () => {
    padWith(null)
    const store = new MapStore()
    const w = makeWorld(store)
    click(w.p, 'tab', 'ops')
    click(w.p, 'armuipad', 'confirm')
    padWith([3]); pump(w.p, w.input)
    click(w.p, 'ustep', 'stickThreshold:1')
    await w.saves.save('menu2')
    const raw = JSON.parse((await store.get('menu2'))!) as {
      payload: { snapshot: { settings: { bindings: { ui: { padButtons: Record<string, string>; stickThreshold: number } } } } }
    }
    expect(raw.payload.snapshot.settings.bindings.ui.padButtons['3'], '存档里真有菜单那一格的手柄').toBe('confirm')
    expect(raw.payload.snapshot.settings.bindings.ui.stickThreshold, '阈值进的是同一格档，不是第二次落盘').toBe(0.6)
    const w2 = makeWorld(store)
    await w2.saves.load('menu2')
    expect(w2.input.uiBinds.padButtons[3], '消费者读回来还是那一把').toBe('confirm')
    expect(w2.input.uiBinds.stickThreshold).toBe(0.6)
    click(w2.p, 'tab', 'ops')
    const h = html(w2.p)
    expect(rowNums(h, 'confirm')[1], '第一屏那一列画的是 Y，不是默认的 A').toBe(padLabel(3))
    expect(h.slice(h.indexOf('摇杆推过多少算按下')), '而阈值画的是读回来的那一个数').toContain('60%')
  })
})


/* ------------------------------------------------------------------ KI-346 */

/**
 * KI-346：手柄那一列的「无」——**一行四个家，关掉的是其中一格**。
 *
 * 前三批（KI-342／343／345）把这一屏做成了"两节两列都能改"，但「无」只有键盘那一半有把手；
 * 当时登记的理由是「手柄那张不回补，'这一格我不要'与'这一格没人认领'在那张表上是同一个形状」。
 * 这一批把那句话拆开：会混是因为**只有一份名单**，把名单改成每表一份，那两个形状第一次有了
 * 两种写法（「—」＝没人认领，「无」＝玩家说过不要）。所以这里量的不是"多了一个按钮"，而是：
 * ① **两半一起落**：摘格子与记名单，而且只摘这一列的格子——另一列那份名单一个字不沾；
 * ② **那两个写法不混**：同一行没关的时候画「—」，关过之后画「无」，措辞各说各的来历；
 * ③ **出口有两个**：「手柄回默认」与「手柄改键」都能把那一句收回来，而**没有家**的那一行
 *    按「手柄回默认」必须说实话（一格没动、那一列仍写「无」）——不许演一个"看起来关掉了"；
 * ④ **拒绝读的是同一份名册**：「菜单必须走得出去」管的是这条通道的两张表，不是只锁键盘那一列。
 */
describe('KI-346 手柄那一列的「无」：一行四个家，关掉的是其中一格', () => {
  /** 某一节里某一行的**整行文本**（两节行名今天会重名，所以先按节切；`</div>` 之前就是这一行） */
  const rowIn = (h: string, section: string, label: string): string => {
    const sec = h.slice(h.indexOf(section))
    const at = sec.indexOf(`<span class="name">${label}<span class="note"`)
    expect(at, `${label} 那一行要在「${section}」那一节里`).toBeGreaterThanOrEqual(0)
    return sec.slice(at, sec.indexOf('</div>', at))
  }
  /** 某一行的两列内容：`[0]` = 键盘那一列，`[1]` = 手柄那一列（「无」与「—」分列才量得出不混） */
  const numsIn = (h: string, section: string, label: string): string[] =>
    rowIn(h, section, label).split('<span class="num">').slice(1).map((s) => s.slice(0, s.indexOf('</span>')))
  const gameRow = (h: string, a: ActionName): string => rowIn(h, '玩法键位', actionLabel(a))
  const gameNums = (h: string, a: ActionName): string[] => numsIn(h, '玩法键位', actionLabel(a))
  const menuNums = (h: string, i: UiIntent): string[] => numsIn(h, '菜单导航', intentLabel(i))
  const padCells = (pad: Record<number, ActionName | UiIntent>, owner: string): number[] =>
    Object.keys(pad).map(Number).filter((n) => pad[n] === owner).sort((a, b) => a - b)

  it('两节每一行都有第二把「无」的把手：玩法除去出口那格、菜单除去出口那格，而键盘那一把一把没被顶掉', () => {
    padWith(null)
    const h = html(rig(true).p)
    const game = h.slice(0, h.indexOf('菜单导航'))
    const closable = BINDABLE_ACTIONS.filter((a) => !exitRoster().includes(a))
    expect((game.match(/data-act="unbindpad"/g) ?? []).length, '行数 = 名册长度减出口：多一格少一格都是抄写漂移').toBe(closable.length)
    for (const a of closable) {
      expect(game, `${a} 那一行要有手柄那一把「无」`).toContain(`data-act="unbindpad" data-arg="${a}"`)
      expect(game, `而键盘那一把不许被它换掉：一行两处`).toContain(`data-act="unbind" data-arg="${a}"`)
    }
    for (const a of exitRoster()) {
      expect(game, `${a} 那一行两列都关不掉 ⇒ 两把「解绑」都不画`).not.toContain(`data-act="unbindpad" data-arg="${a}"`)
      expect(game, '而锁手柄那一半不许顺手把键盘那一半也画出来：一句话两处落点').not.toContain(`data-act="unbind" data-arg="${a}"`)
    }
    const sec = h.slice(h.indexOf('菜单导航'))
    for (const i of UI_INTENTS) {
      const locked = UI_EXIT_INTENTS.includes(i)
      expect(sec.includes(`data-act="unbinduipad" data-arg="${i}"`), `${i} 那一行的手柄把手${locked ? '不该出现' : '要出现'}`).toBe(!locked)
    }
    expect(gameRow(h, 'parry'), '那一把与「改键」同排，不是第二张表').toContain('data-act="unbindpad" data-arg="parry"')
  })

  it('点「手柄解绑」⇒ 那一列一格不剩、名字进那份名单，而键盘那张与那份名单一个字不沾', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'unbindpad', 'dodge')
    const g = r.bindings.get().gameplay
    expect(padCells(g.padButtons, 'dodge'), '0 与 12 都摘掉（留一把就是"旧键还能闪避"那种鬼键）').toEqual([])
    expect(g.padUnbound, '「没写」是恢复默认，「点名」才是无').toEqual(['dodge'])
    expect(g.unbound, '键盘那份名单不是这一列的账').toEqual([])
    expect(g.keyboard, '键盘那张逐字默认：关掉手柄不等于洗掉键盘').toEqual(DEFAULT_BINDS.keyboard)
    expect(r.input.binds.padUnbound, '面板写的就是生效的那一份').toEqual(['dodge'])
    const h = html(r.p)
    expect(gameNums(h, 'dodge')[1], '那一列画的是「无」，不是留一个「—」冒充没人认领').toBe('无')
    expect(gameNums(h, 'dodge')[0], '键盘那一列仍是那一把：一行四个家，关掉的是其中一格').toBe('Ctrl')
    expect(h).toContain('手柄这一列已关掉')
    padWith([0]); pump(r.p, r.input)
    expect([...r.input.frame.edges], 'A 那一把从此什么都不是').toEqual([])
    expect(r.notices.at(-1), '点了要说出是哪一行、关的是哪一列').toContain('闪避')
  })

  it('「—」与「无」第一次是两句话：没家的那一行画前者，关过的那一行画后者', () => {
    padWith(null)
    const r = rig(true)
    expect(gameNums(html(r.p), 'ability1')[1], '武器槽一在手柄上本来就没有格 ⇒「—」＝没人认领').toBe('—')
    click(r.p, 'unbindpad', 'ability1')
    expect(r.bindings.get().gameplay.padButtons, '本来就没有 ⇒ 一格都不动（不是没反应，是无事可做）').toEqual(DEFAULT_BINDS.padButtons)
    expect(r.bindings.get().gameplay.padUnbound, '而名单里有它：说的是"以后也不许在这一列上给它键"').toEqual(['ability1'])
    const h = html(r.p)
    expect(gameNums(h, 'ability1')[1], '点过之后画的是「无」：同一个空格子从今天起有两种来历').toBe('无')
    expect(gameNums(h, 'ability1')[0], '另一列不许跟着变：键盘那一把还握着').toBe('1')
    expect(gameRow(h, 'throwCrystal'), '而没被点名的那一行仍说「—」，不替玩家猜').toContain('<span class="num">—</span>')
  })

  it('关掉之后那一行的把手换成「手柄回默认」：整组回来、名单一起销，而键盘那句「无」留着', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'unbind', 'parry')
    click(r.p, 'unbindpad', 'parry')
    const row = gameRow(html(r.p), 'parry')
    expect(row, '一边等着一枚键、一边说这一列不要键是矛盾的两格，而关掉之后「解绑」也没有可画的').not.toContain('data-act="unbindpad" data-arg="parry"')
    expect(row).toContain('data-act="resetpad" data-arg="parry"')
    expect(row).toContain('data-act="resetkey" data-arg="parry"')
    click(r.p, 'resetpad', 'parry')
    const g = r.bindings.get().gameplay
    expect(padCells(g.padButtons, 'parry'), '整组回来，不是只补一把').toEqual([2, 15])
    expect(g.padUnbound, '点了回默认、屏幕上的「无」还挂着 = 一句假话').toEqual([])
    expect(g.unbound, '键盘上那句"不要"不是这一格该替玩家收回的话').toEqual(['parry'])
    const h = html(r.p)
    expect(gameNums(h, 'parry')[0], '键盘那一列仍写「无」').toBe('无')
    expect(gameNums(h, 'parry')[1]).toBe(`${padLabel(2)}、${padLabel(15)}`)
  })

  it('两条都关掉的那一行：两列各写一个「无」，那句话说的是都不发，而两种传感器真的都不发', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'unbind', 'dodge')
    click(r.p, 'unbindpad', 'dodge')
    const h = html(r.p)
    expect(gameRow(h, 'dodge'), '两列各一个「无」，不是把一列的内容搬到另一列去说')
      .toContain('<span class="num">无 <span class="over">没有键</span></span>')
    expect(gameNums(h, 'dodge')[1]).toBe('无')
    expect(gameRow(h, 'dodge')).toContain('两条都关掉了')
    expect(gameRow(h, 'jump'), '其余那一行一个字不沾：一份名单盖不住别行')
      .toContain('<span class="num">Space</span>')
    key('ControlLeft'); padWith([0]); pump(r.p, r.input)
    expect([...r.input.frame.edges], '键盘与手柄都不发：这一行此刻什么都按不出').toEqual([])
  })

  /**
   * 菜单那一节也有一条「两条都关掉了」：那句话在实现里是**两处分支**（玩法一节一处、菜单一节一处），
   * 只量玩法那一处就等于把"同一格在两节里是同一条口径"这句话交给了一处代码作证——反向臂 A13 量的正是这一格。
   */
  it('菜单那一行也有「两条都关掉」那一句：四份名单在同一屏上各有写法，而关掉那一行两种传感器都不发', () => {
    padWith(null)
    const r = rig(true)
    r.input.uiOwner = 'panel'
    const downCode = Object.keys(r.bindings.get().ui.keyboard).find((c) => r.bindings.get().ui.keyboard[c] === 'down')!
    key(downCode); pump(r.p, r.input)
    expect([...r.input.uiEdges], '先确认这一行原来发得出去 ⇒ 下面那句"都不发"才有对照').toContain('down')
    click(r.p, 'unbindui', 'down')
    click(r.p, 'unbinduipad', 'down')
    const u = r.bindings.get().ui
    expect([u.unbound, u.padUnbound], '两半各写一份名单：一份盖一张表').toEqual([['down'], ['down']])
    expect(padCells(u.padButtons, 'down'), '十字下那一把摘干净').toEqual([])
    const h = html(r.p)
    expect(rowIn(h, '菜单导航', intentLabel('down'))).toContain('两条都关掉了')
    expect(numsIn(h, '菜单导航', intentLabel('down')), '两列各一个「无」，不是把一列的内容搬到另一列去说').toEqual(['无', '无'])
    key(downCode); padWith([13]); pump(r.p, r.input)
    expect([...r.input.uiEdges], '关掉的那一行：键盘与手柄都不发').toEqual([])
    padWith(null)
  })

  it('等键中的那一行不画「手柄解绑」，而别行等键时点这一格 ⇒ 先撤等待，按钮不许被吞进作废的等待', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'armpad', 'dodge')
    expect(gameRow(html(r.p), 'dodge'), '那一行此刻正在等一枚按钮，"这一列不要"不能同时成立').not.toContain('data-act="unbindpad"')
    expect(gameRow(html(r.p), 'jump'), '而别行仍画着自己的两把把手：等键只改等键那一行').toContain('data-act="unbindpad" data-arg="jump"')
    click(r.p, 'unbindpad', 'jump')
    expect(r.input.takeKeyCapture(), '捕获已熄灭：那一枚按钮不该再进等键那一条路').toBeNull()
    expect(html(r.p)).not.toContain('等待一枚手柄键')
    padWith([9]); pump(r.p, r.input)
    expect(r.bindings.get().gameplay.padButtons[9], '9 那一格没被一次已经改过主子的等待挪走').toBe('attackHeavy')
    expect([...r.input.frame.edges], '它回到正常通道：取消之后那一枚按钮发的还是重击').toEqual(['attackHeavy'])
    expect(r.bindings.get().gameplay.padUnbound, '而这一格的「无」照样落了两半').toEqual(['jump'])
  })

  it('菜单那一行的出口格进不来：两列读的是同一份名册，硬点「手柄解绑」回答的是"关不掉"', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'unbinduipad', 'back')
    expect(r.bindings.get().ui.padUnbound, '「菜单必须走得出去」不只管键盘那一半').toEqual([])
    expect(r.bindings.get().ui.padButtons, '一格都没动').toEqual(UI_BINDS.padButtons)
    expect(r.notices.at(-1), '静默会让玩家以为自己按坏了，谎称"已关掉"会把这一屏变成陷阱').toContain('关不掉')
    const row = rowIn(html(r.p), '菜单导航', intentLabel('back'))
    expect(row).not.toContain('data-act="unbindui"')
    expect(row).not.toContain('data-act="unbinduipad"')
    expect(row).toContain('不许关掉：菜单必须走得出去')
  })

  it('菜单里没有家的那一行也关得掉，而「手柄改键」是它的第二个出口', () => {
    padWith(null)
    const r = rig(true)
    r.input.uiOwner = 'panel'
    expect(menuNums(html(r.p), 'pick1')[1], '先确认那一列本来是「—」').toBe('—')
    click(r.p, 'unbinduipad', 'pick1')
    expect(r.bindings.get().ui.padUnbound).toEqual(['pick1'])
    expect(menuNums(html(r.p), 'pick1')[1]).toBe('无')
    click(r.p, 'armuipad', 'pick1')
    padWith([3]); pump(r.p, r.input)
    const u = r.bindings.get().ui
    expect(u.padButtons[3], '按下新的那一把就是"这一行要" ⇒ 名单不许继续盖它').toBe('pick1')
    expect(u.padUnbound, '「无」与"有键"不可能同时成立').toEqual([])
    expect(u.keyboard, '键盘那张一格不动').toEqual(UI_BINDS.keyboard)
    expect(menuNums(html(r.p), 'pick1')[1]).toBe(padLabel(3))
  })

  it('关掉的行若在手柄上没有家：「手柄回默认」说实话（一格没动、那一列仍写「无」）', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'unbindpad', 'ability1')
    click(r.p, 'resetpad', 'ability1')
    expect(r.notices.at(-1), '那一行在家谱上就没有手柄那一格 ⇒ 面板不许编一个"已回默认"').toContain('在手柄上没有默认键 ⇒ 这一行没动')
    const g = r.bindings.get().gameplay
    expect(g.padUnbound, '没动就是没动：名单留着，屏幕上的「无」也留着（第二个出口是「手柄改键」）').toEqual(['ability1'])
    expect(gameNums(html(r.p), 'ability1')[1]).toBe('无')
    click(r.p, 'armpad', 'ability1')
    padWith([7]); pump(r.p, r.input)
    expect(r.bindings.get().gameplay.padButtons[7], '「手柄改键」才是这一格的第二个出口：那一枚按钮落进来了').toBe('ability1')
    expect(r.bindings.get().gameplay.padUnbound, '按下新的那一把就是"这一行要" ⇒ 名单退了，屏幕那一列不再说「无」').toEqual([])
    expect(gameNums(html(r.p), 'ability1')[1], '而那一列画的是刚按下的那一把（读数只有一个主人）').toContain(padLabel(7))
    /**
     * KI-348 把这一行原来那句「⇒ 已交换」改掉了，因为它是假的：`ability1` 此刻在 `padUnbound` 里，
     * 手柄上一格都没占 ⇒ `movePadRow` 没有腾出的格子可分给奔跑，奔跑**从 7 号上掉下来而没有落进任何一格**
     * （下面那一格 `padCells(...)==[]` 就是这句话的证人）。那一次不是交换，是"少了一把、没搬去别处"，
     * 而记号「刚交换」跟着 `moved` 走 ⇒ 这一格今天第一次不挂它。
     */
    expect(padCells(r.bindings.get().gameplay.padButtons, 'sprint'), '这一臂的前提：奔跑在手柄上一格不剩（不是换到别处）').toEqual([])
    expect(gameRow(html(r.p), 'ability1'), '被抢走那一把的那句话挂在**被写进的那一列**上：手柄那一格原本归奔跑')
      .toContain(`这一把原本归 ${actionLabel('sprint')} ⇒ 它少了这一把，没搬去别处`)
    expect(gameRow(html(r.p), 'ability1'), '没搬家的这一次不许挂「刚交换」').not.toContain('<span class="over">刚交换</span>')
  })

  it('不碰鼠标也点得动「手柄解绑」：只用 ↑↓/Enter 走到那一格并按下去', () => {
    padWith(null)
    const r = rig(true)
    /** 一行今天有四格把手，走查步数的上限按整屏行数放宽（量具走不到 ≠ 玩家走不到，别拿前者红后者） */
    const steps = walkTo(r.p, r.input, 'data-act="unbindpad" data-arg="parry"', 300)
    expect(focusTag(html(r.p)), `没走到弹反那一行的「手柄解绑」（走了 ${steps} 步）`).toContain('data-act="unbindpad" data-arg="parry"')
    pump(r.p, r.input, ['confirm'])
    expect(r.bindings.get().gameplay.padUnbound, 'Enter 与鼠标点击落在同一个 handler 上').toEqual(['parry'])
    expect(padCells(r.bindings.get().gameplay.padButtons, 'parry'), '2 与 15 那两把一起摘掉').toEqual([])
    const second = walkTo(r.p, r.input, 'data-act="unbinduipad" data-arg="pageNext"', 400)
    expect(focusTag(html(r.p)), `菜单那一节的同一把把手也走得到（走了 ${second} 步）`).toContain('data-act="unbinduipad" data-arg="pageNext"')
    pump(r.p, r.input, ['confirm'])
    expect(r.bindings.get().ui.padUnbound).toEqual(['pageNext'])
  })

  it('两份新手柄名单跟着档走：写进 v14 的那两格读回来还是它们，而读回来的世界守着你关掉的那一列', async () => {
    padWith(null)
    const store = new MapStore()
    const w = makeWorld(store)
    click(w.p, 'tab', 'ops')
    click(w.p, 'unbindpad', 'dodge')
    click(w.p, 'unbinduipad', 'down')
    await w.saves.save('pads')
    const raw = JSON.parse((await store.get('pads'))!) as {
      payload: { snapshot: { settings: { bindings: { gameplay: { padUnbound?: string[] }; ui: { padButtons: Record<string, string>; padUnbound?: string[] } } } } }
    }
    expect(raw.payload.snapshot.settings.bindings.gameplay.padUnbound, '存档里真有玩法那一格').toEqual(['dodge'])
    expect(raw.payload.snapshot.settings.bindings.ui.padUnbound, '而菜单那一格也在').toEqual(['down'])
    expect(raw.payload.snapshot.settings.bindings.ui.padButtons['13'], '十字下那一格真的不在表里了').toBeUndefined()
    const w2 = makeWorld(store)
    await w2.saves.load('pads')
    expect(w2.input.binds.padUnbound, '消费者读回来还是那一份').toEqual(['dodge'])
    expect(w2.input.uiBinds.padUnbound).toEqual(['down'])
    click(w2.p, 'tab', 'ops')
    const h = html(w2.p)
    expect(gameNums(h, 'dodge')[1], '第一屏就说真话').toBe('无')
    expect(menuNums(h, 'down')[1]).toBe('无')
    padWith([0]); pump(w2.p, w2.input)
    expect([...w2.input.frame.edges], '读回来的世界仍然守着你关掉的那一列').toEqual([])
    padWith([])
  })

  it('整张回默认之后屏幕上不再有一句「已关掉」：那一格回答的是两节 × 两列（玩家看得见的四份名单）', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'unbind', 'dodge')
    click(r.p, 'unbindpad', 'parry')
    click(r.p, 'unbindui', 'up')
    click(r.p, 'unbinduipad', 'down')
    const b = r.bindings.get()
    expect([b.gameplay.unbound, b.gameplay.padUnbound, b.ui.unbound, b.ui.padUnbound], '先确认四份各有名')
      .toEqual([['dodge'], ['parry'], ['up'], ['down']])
    click(r.p, 'resetall')
    expect(r.bindings.get(), '逐字回默认（四份名单也是）').toEqual(defaultBindings())
    const h = html(r.p)
    expect(h, '没有一列还挂着"已关掉"').not.toContain('已关掉')
    expect(gameNums(h, 'parry')[1], '弹反那一列画回两把').toBe(`${padLabel(2)}、${padLabel(15)}`)
    expect(menuNums(h, 'down')[1], '菜单那一列也画回十字下').toBe(padLabel(13))
  })
})


function makeFakeAudio() {
  const vols = new Map<string, number>()
  return {
    setVolume: (b: string, v: number): void => { vols.set(b, Math.max(0, Math.min(1, v))) },
    getVolume: (b: string): number => vols.get(b) ?? 1,
  }
}

/** 最小可存档世界 + 一块接好把手的面板（照 `main.ts` 的接法） */
function makeWorld(store = new MapStore()) {
  const time = new GameTime()
  const clock = new RhythmClock()
  clock.setBpm(84, 4)
  const rpg = new RpgRuntime('origin_tuner')
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
  player.camYawRef = 0
  const ai = new AISystem()
  const streaming = new StreamingSystem(regions)
  const cellKey = (p: Vec3): string => { const c = streaming.cellOf(p); return `${c.cx},${c.cy},${c.cz}` }
  const spawner = new SpawnDirector(regions, {
    spawn: (id, pos, sd) => ai.spawn(id, pos, sd),
    despawn: (id) => ai.despawn(id),
    hasFlag: (k) => streaming.hasFlag(k)
  }, cellKey)
  const input = new Input(new FakeEl() as unknown as HTMLElement)
  const bindings = new BindingsStore({ input })
  const gameplay = new GameplaySettingsStore({ input, rig: { shakeIntensity: 1 }, haptics: { scale: 1, weakScale: 1 }, combat: { damageScale: 1 }, player })
  const quality = new QualityStore({ particles: { spawnMul: 1 }, renderer: { resolutionScale: 1, shadowMapSize: 1536 } })
  const p = new Stakerite(rpg,
    { onApply: () => {}, notify: () => {}, onUse: () => {}, onRequestClose: () => {} },
    NO_SAVES, input, makeOpsHandles(input, () => bindings, () => gameplay, () => quality, () => 95.58))
  p.show()
  const saves = new SaveGame({
    player, streaming, spawner, clock, time, rpg, audio: makeFakeAudio(),
    bindings: {
      get: () => bindings.get(),
      apply: (raw: unknown): void => bindings.restore(raw),
      profiles: { get: () => bindings.getProfiles(), apply: (raw: unknown): void => bindings.applyProfiles(raw) }
    },
    gameplay: { get: () => gameplay.get(), apply: (raw: unknown): void => gameplay.restore(raw) }
  }, store)
  return { p, input, bindings, gameplay, saves }
}

/* ------------------------------------------------------------------ KI-348 */

/**
 * KI-348：玩法那一半的措辞接回边界的**落点回报**（两节同主人）。
 *
 * KI-345 立「措辞跟着落点走」时只兑现在菜单那一节；玩法那一节今天按 `justSwapped.via`
 * （我等的是哪种传感器）分支，于是同一件事在两节里两个主人。这一屏量的四件事：
 * ① **跨表那一格不再替另一列作证**：等键盘、作答的是一枚手柄键 ⇒ 话说「这一把」、记号挂在手柄那一列，
 *    键盘那一列一格没被写也不挂记号（这一格以前会同时说「这把键原本是空着的」与挂错列的记号）；
 * ② **拒绝就没有说明**：越界的 `Pad<n>` 在玩法这一半以前交回的是 `null`（读成「原本没有别人」），
 *    今天交回的是「这一次没发生」——表逐字不动，屏幕上一句说明都不许多画；
 * ③ **记号只跟真搬家**：`moved=false` 那一支里原主人可能一把不剩（手柄那张不回补），
 *    所以「刚交换」今天既不在那种时候出现，也不再说「它还有其余把手」；
 * ④ **落点由边界回答**：面板手里只有 `onto` 这一个字段名，两节读同一个（装配处不补、面板不猜）。
 */
describe('KI-348 玩法那一节的落点回报：措辞与记号跟着 `onto`，两节同一个主人', () => {
  const rowIn = (h: string, section: string, label: string): string => {
    const sec = h.slice(h.indexOf(section))
    const at = sec.indexOf(`<span class="name">${label}<span class="note"`)
    expect(at, `${label} 那一行要在「${section}」那一节里`).toBeGreaterThanOrEqual(0)
    return sec.slice(at, sec.indexOf('</div>', at))
  }
  const gameRow = (h: string, a: ActionName): string => rowIn(h, '玩法键位', actionLabel(a))
  const gameNums = (h: string, a: ActionName): string[] =>
    gameRow(h, a).split('<span class="num">').slice(1).map((s) => s.slice(0, s.indexOf('</span>')))
  const padCells = (pad: Record<number, ActionName>, owner: ActionName): number[] =>
    Object.keys(pad).map(Number).filter((n) => pad[n] === owner).sort((a, b) => a - b)

  it('等的是键盘、作答的是一枚手柄键 ⇒ 那一行说「这一把」，记号与读数都落在手柄那一列', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'arm', 'dodge')
    expect(html(r.p), '页脚那句说的是「在等哪种传感器」——那是等待自己的事，与落点无关').toContain('等待一枚键（或鼠标） · 玩法键位 · 闪避')
    key('Pad19'); pump(r.p, r.input)     // 等键盘，作答的那一串说的是手柄 ⇒ 落到哪张表由边界回答
    const g = r.bindings.get().gameplay
    expect(g.padButtons[19], '语法就是路由：那一串写的是手柄那一把 ⇒ 落在 `gameplay.padButtons`').toBe('dodge')
    expect(g.keyboard, '键盘那张逐字没动（等键盘不等于写键盘）').toEqual(DEFAULT_BINDS.keyboard)
    const h = html(r.p)
    expect(gameRow(h, 'dodge'), '措辞跟着落点走：落进手柄那张就说「这一把」，不说「这把键」')
      .toContain('这一把原本没有别人')
    expect(gameRow(h, 'dodge'), 'KI-343 那一版在这里画的正是后半句——它在替手柄那一列说谎').not.toContain('这把键原本是空着的')
    const nums = gameNums(h, 'dodge')
    expect(nums[0], '键盘那一列没被这一次写脏，也不许挂记号').not.toContain('刚交换')
    expect(nums[1], '被写进的那一列画的是刚按下的那一把').toContain(padLabel(19))
  })

  it('跨表那一次若真抢了别人的唯一一把 ⇒ 记号挂手柄那一列，而键盘那一列替它保持原样', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'arm', 'parry')
    key('Pad13'); pump(r.p, r.input)     // 13 号是轻击唯一的一把手柄键，而弹反此刻占着 2 与 15
    const g = r.bindings.get().gameplay
    expect(g.padButtons[13], '新那一把归弹反').toBe('parry')
    expect(padCells(g.padButtons, 'attackLight'), '轻击落进弹反腾出的那一格 ⇒ 交换的两半由同一条规则算出').toEqual([2])
    const h = html(r.p)
    /** 名字不在这里写第二遍：面板那一行的原主人叫什么，只有 `actionLabel` 一个主人。 */
    expect(gameRow(h, 'parry'), '落点是手柄 ⇒ 那句话用「这一把」，而 `moved` 为真才叫已交换')
      .toContain(`这一把原本归 ${actionLabel('attackLight')} ⇒ 已交换`)
    const nums = gameNums(h, 'parry')
    expect(nums[1], '记号挂在被写进的那一列').toContain('刚交换')
    expect(nums[0], '另一列不许替这一列作证（键盘那张上弹反还是 G）').not.toContain('刚交换')
    expect(g.keyboard, '键盘那张一格没动').toEqual(DEFAULT_BINDS.keyboard)
  })

  it('落点真是键盘那一格 ⇒ 同一句话说「这把键」，记号挂键盘那一列（与上面那一臂成对照）', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'arm', 'parry')
    key('ControlLeft'); pump(r.p, r.input)   // Ctrl 此刻是闪避的家，落点是键盘那张
    const g = r.bindings.get().gameplay
    expect(g.keyboard.ControlLeft).toBe('parry')
    expect(g.padButtons, '手柄那张一格不动：等键盘、按的也是键盘').toEqual(DEFAULT_BINDS.padButtons)
    const h = html(r.p)
    expect(gameRow(h, 'parry')).toContain('这把键原本归 闪避 ⇒ 已交换')
    const nums = gameNums(h, 'parry')
    expect(nums[0], '记号在这一列（被写进的那一列）').toContain('刚交换')
    expect(nums[1], '手柄那一列不许挂').not.toContain('刚交换')
  })

  it('越界的那一枚（`Pad20`）在玩法这一半是**拒绝**：表逐字不动，屏幕上一句说明都不许多画', () => {
    padWith(null)
    const r = rig(true)
    const before = r.bindings.get()
    click(r.p, 'arm', 'dodge')
    key('Pad20'); pump(r.p, r.input)
    expect(r.bindings.get(), '拒绝了就没有写：两张表一个字节都不动').toEqual(before)
    const h = html(r.p)
    expect(gameRow(h, 'dodge'), 'KI-343 那一版把拒绝读成了 `displaced=null`，于是这一格会编一句「原本没有别人」')
      .not.toContain('原本')
    expect(h, '等待随这一枚键一起撤掉：不留半截武装吞掉下一枚').not.toContain('等待一枚')
  })

  it('原主人在这一列上一把不剩 ⇒ 那句是「少了这一把、没搬去别处」，而记号不挂（不谎称交换）', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'unbindpad', 'ability1')     // 先把这一行关掉：它在手柄上一格都不占 ⇒ 腾不出任何格子
    click(r.p, 'arm', 'ability1')
    key('Pad7'); pump(r.p, r.input)         // 7 号是冲刺唯一的一把手柄键
    const g = r.bindings.get().gameplay
    expect(g.padButtons[7], '这一枚按钮落进来了（「手柄改键」是那一格「无」的第二个出口）').toBe('ability1')
    expect(padCells(g.padButtons, 'sprint'), '而冲刺从 7 号上掉下来、没有任何格子可补 ⇒ 它在这一列上没家了').toEqual([])
    const h = html(r.p)
    expect(gameRow(h, 'ability1')).toContain(`这一把原本归 ${actionLabel('sprint')} ⇒ 它少了这一把，没搬去别处`)
    expect(gameRow(h, 'ability1'), '没有搬家就没有交换：那一枚记号在这一格上是假话').not.toContain('<span class="over">刚交换</span>')
  })
})

/* ------------------------------------------------------------------ KI-359 */

/**
 * KI-359：`docs/ui-ux.md` §6「手柄支持」那行写的是「振动强度 0–200% 分（弱/强马达独立）」——
 * 「独立」那半句今天没落地：面板那一格注语原文写着「弱/强马达同一把尺」，而 `Haptics.pulse`
 * 把同一个 `scale` 乘进两个幅值。这一屏量的是**这一格长成两行之后玩家看见的东西**：
 * 两把把手各写各的数（点一行另一行逐字不动）、两行各有自己的端点 `disabled`、
 * 读数仍是百分比口径、注语不许再替另一列作证。
 * 机制那一半在 `tests/unit/haptics.test.ts`，跟档那一半在 `tests/flow/settings-persistence.test.ts`。
 */

/** 数值行的行块（`OPS_NUMERIC` 那一渲染：`name` 里的行名 + 注语 + 那两把把手在同一个 `div` 里） */
const numRow = (h: string, key: string): string =>
  h.split('<div class="row">').find((s) => s.includes(`data-arg="${key}:-1"`)) ?? ''

describe('KI-359 振动的两把尺在这一屏上是两行：各点各的、各到各的端点', () => {
  it('点强马达那一行，弱那一行逐字不动（反之亦然）；两行各有自己的把手格子', () => {
    const r = rig(true)
    expect(html(r.p), '弱马达那一行要有自己的两把把手，不是共用 `rumbleScale` 那两格').toContain('data-act="gstep" data-arg="rumbleWeakScale:1"')
    click(r.p, 'gstep', 'rumbleScale:1')
    expect([r.gameplay.get().rumbleScale, r.gameplay.get().rumbleWeakScale], '0.1 那一步只落在按下的那一行')
      .toEqual([1.1, 1])
    click(r.p, 'gstep', 'rumbleWeakScale:-1')
    expect([r.gameplay.get().rumbleScale, r.gameplay.get().rumbleWeakScale], '反过来也一样：别格不许陪绑')
      .toEqual([1.1, 0.9])
    expect(numRow(html(r.p), 'rumbleWeakScale'), '读数口径与强马达那一行一致（表里存倍率，百分比由界面这侧给）')
      .toContain('90%')
  })

  it('两把尺各有一条到消费者的线：`haptics.scale` 与 `haptics.weakScale` 不是同一个数', () => {
    const r = rig(true)
    click(r.p, 'gstep', 'rumbleScale:1')
    expect([r.haptics.scale, r.haptics.weakScale], '强那一格到得了消费者').toEqual([1.1, 1])
    click(r.p, 'gstep', 'rumbleWeakScale:1')
    click(r.p, 'gstep', 'rumbleWeakScale:1')
    expect([r.haptics.scale, r.haptics.weakScale], '弱那一格到的是它自己那一个字段')
      .toEqual([1.1, 1.2])
    expect(r.haptics.weakScale, '两条线各自通，不是一个字段换名').not.toBe(r.haptics.scale)
  })

  it('端点：弱马达按到底只有它那一格写 `disabled`，界与强马达同为 0–2 但是两把尺', () => {
    const r = rig(true)
    for (let i = 0; i < 20; i++) click(r.p, 'gstep', 'rumbleWeakScale:-1')
    /** 界写成**字面量**：这一腿钉的就是 §6 那条 0–200%，读 `GAMEPLAY_BOUNDS` 会变成自我印证（界写错时两边一起错） */
    expect(r.gameplay.get().rumbleWeakScale, '鼠标按到底也越不出去（夹取只有一个主人）').toBe(0)
    const h = html(r.p)
    expect(h).toMatch(/data-act="gstep" data-arg="rumbleWeakScale:-1" disabled/)
    expect(numRow(h, 'rumbleScale'), '另一行此刻还两头都能点：两行的端点各说各的').not.toMatch(/disabled/)
    for (let i = 0; i < 40; i++) click(r.p, 'gstep', 'rumbleWeakScale:1')
    expect(r.gameplay.get().rumbleWeakScale, '上界是 2 = §6 那句 200%，不是 1').toBe(2)
    expect(html(r.p)).toMatch(/data-act="gstep" data-arg="rumbleWeakScale:1" disabled/)
  })

  it('注语不许再替另一列作证：两行各说自己那一列马达，「同一把尺」那句话得没了', () => {
    const h = html(rig(true).p)
    const strong = numRow(h, 'rumbleScale')
    const weak = numRow(h, 'rumbleWeakScale')
    expect(strong, '一行都不许空着行名（玩家要能分辨自己砍的是哪一列）').toContain('强马达')
    expect(weak).toContain('弱马达')
    expect(strong, '「弱/强马达同一把尺」是这一批改掉的那句话：留着就是界面在替机制说谎').not.toContain('同一把尺')
    expect(weak).not.toContain('同一把尺')
  })

  it('连按十次不漂出二进制尾巴：弱那一行与强那一行同一格往返语义（存档要的是数不漂）', () => {
    const r = rig(true)
    for (let i = 0; i < 10; i++) click(r.p, 'gstep', 'rumbleWeakScale:-1')
    expect(r.gameplay.get().rumbleWeakScale, '1 − 0.1×10 应该是 0，不是 5.5e-16').toBe(0)
    for (let i = 0; i < 5; i++) click(r.p, 'gstep', 'rumbleWeakScale:1')
    expect(r.gameplay.get().rumbleWeakScale, '回来 0.5，不带 0.5000000000000001').toBe(0.5)
  })
})

/**
 * KI-360：从屏幕上送一次鼠标按下（`button` 用 DOM 的口径：0 左／1 中／2 右）。
 * 监听器挂在 window（面板那层遮罩盖住 canvas，挂在 canvas 上的话这一批要修的那件事在真浏览器里
 * 根本没有发生的窗口），`target` 因此由量具给：**默认落在面板那层上**——那是等待途中唯一按得到的地方。
 */
const mouse = (r: Rig, button: number): void => {
  for (const fn of win.mousedown ?? []) fn({ button, target: { name: '面板' }, preventDefault: (): void => {} })
}
/** 玩法那一节里某个动作的那一行（`data-act="arm"` 是键盘那一列的把手，行名、注语与读数槽都在这一截里） */
const gameRow = (h: string, action: string): string =>
  h.split('<div class="row">').find((s) => s.includes(`data-act="arm" data-arg="${action}"`)) ?? ''

/** 菜单那一节里某个意图的那一行（`data-act="armui"` 是那一列的把手，与玩法那一节各自拼自己的行） */
const uiRow = (h: string, intent: string): string =>
  h.split('<div class="row">').find((s) => s.includes(`data-act="armui" data-arg="${intent}"`)) ?? ''

describe('KI-360 那一行的等待也认鼠标：屏上那句「按任意键」第一次说到鼠标', () => {
  it('武装那一行的注语说得出鼠标，而等手柄那一行仍然只说手柄（两句话各管各的传感器）', () => {
    const r = rig(true)
    click(r.p, 'arm', 'attackLight')
    expect(gameRow(html(r.p), 'attackLight'), '键盘那一列今天接得住鼠标，注语就得说它接得住').toContain('按键或点鼠标绑定')
    click(r.p, 'armpad', 'attackLight')
    const row = gameRow(html(r.p), 'attackLight')
    expect(row, '等手柄那一枚时按下鼠标不作答，注语就不许提鼠标').toContain('按手柄上一枚键绑定')
    expect(row, '一句话里不许同时等两种传感器却又只答得出一种').not.toContain('鼠标')
  })

  it('菜单那一行的注语不提鼠标：两节各说各的传感器，而边界收不下的那一格屏幕不许先替它许诺', () => {
    const r = rig(true)
    click(r.p, 'armui', 'confirm')
    const row = uiRow(html(r.p), 'confirm')
    expect(row, '菜单那一列只有 `keydown` 一个读者：注语说得出鼠标，就是替 `rebindUi` 许一笔它自己收不下的交易').toContain('按任意键绑定')
    expect(row, '这一句与玩法那一节那一句住在同一个三元表达式里，却必须不一样').not.toContain('鼠标')
  })

  it('页脚那一句把鼠标也算进答案里，而它原来那半句话一个字没动（十九读的老腿读的就是那半句）', () => {
    const r = rig(true)
    click(r.p, 'arm', 'dodge')
    expect(html(r.p), '等待那一格现在要说清两种传感器都算答案').toContain('等待一枚键（或鼠标） · 玩法键位')
    click(r.p, 'armpad', 'dodge')
    expect(html(r.p), '等手柄那一枚时不许把鼠标也算进去').toContain('等待一枚手柄键 · 玩法键位')
  })

  it('屏上整条流程：点「改键」→ 按下鼠标左键 → 那一行换成「左键」，原来那位主人换到右键那一格，而这一发既没打出去也没锁指针', () => {
    const r = rig(true)
    click(r.p, 'arm', 'attackHeavy')
    mouse(r, 0)
    pump(r.p, r.input)
    const h = html(r.p)
    expect(gameRow(h, 'attackHeavy'), '重击现在住在左键那一格').toContain('左键')
    expect(gameRow(h, 'attackLight'), '轻击被换到右键那一格：rebind 的回补是一次交换，不是一句「我不管」').toContain('右键')
    const g = r.bindings.get().gameplay.keyboard
    expect([g.MouseLeft, g.MouseRight], 'store 那一份与屏幕上那两份同一句话').toEqual(['attackHeavy', 'attackLight'])
    expect([...r.input.frame.edges], '等待途中按下鼠标，一格行动都不许发').toEqual([])
    expect(r.inputEl.locks, '而指针没被锁进 canvas：面板还留在玩家眼前').toBe(0)
  })

  it('中键在屏上第一次有自己的名字：绑上去那一行写「中键」，而左键那一格被搬空', () => {
    const r = rig(true)
    click(r.p, 'arm', 'attackLight')
    mouse(r, 1)
    pump(r.p, r.input)
    expect(gameRow(html(r.p), 'attackLight'), '第三枚标准键也有落点').toContain('中键')
    expect(r.bindings.get().gameplay.keyboard.MouseLeft, '默认表上左键是轻击 ⇒ 搬走之后那一格就该是空的').toBeUndefined()
  })

  it('那一声握手：等待途中按下左键、而这一记点的是滑杆 ⇒ 滑杆动了、那一行没被绑走、而等待还续着', () => {
    const r = rig(true)
    click(r.p, 'arm', 'dodge')
    mouse(r, 0)                              // Input 先把它记成答案（按下那一拍它不知道这一下要点哪儿）
    click(r.p, 'gstep', 'damageScale:1')     // 玩家这一下按的是滑杆：那一枚答案要撤掉，滑杆照常走
    pump(r.p, r.input)
    const g = r.bindings.get().gameplay
    expect(g.keyboard.MouseLeft, '点滑杆的那一下不许把滑杆变成改键').toBe('attackLight')
    expect(Object.keys(g.keyboard).find((c) => g.keyboard[c] === 'dodge'), '闪避仍住在它原来那把键上').toBe('ControlLeft')
    expect(r.gameplay.get().damageScale, '而滑杆那一格照旧动了一步（撤答案不许连带把点击也吞掉）').toBeCloseTo(1.05)
    expect(html(r.p), '等待没有被这一下吃掉：面板与 Input 两边都还挂着这一次等待').toContain('等待一枚键（或鼠标） · 玩法键位 · 闪避')
    mouse(r, 2)                              // 所以下一次真按下仍然算
    pump(r.p, r.input)
    expect(gameRow(html(r.p), 'dodge'), '而那一行此刻才把它换成右键').toContain('右键')
  })

  it('菜单那一行的等待收不下鼠标：`rebindUi` 拒绝那一枚，`ui.keyboard` 里不许出现鼠标格', () => {
    const r = rig(true)
    click(r.p, 'armui', 'confirm')
    mouse(r, 0)                              // 鼠标作答得一样到（`Input` 不知道这一行归哪一节）
    pump(r.p, r.input)
    const u = r.bindings.get().ui.keyboard
    expect(Object.keys(u).some((c) => /^Mouse/.test(c)), '菜单那一列只被 `keydown` 读：写进来就是一格无人读的键').toBe(false)
    expect(u.MouseLeft, '而 `MouseLeft` 这一格压根不许出现').toBeUndefined()
    expect([...new Set(Object.keys(u).filter((c) => u[c] === 'confirm'))].sort(), '确认那一行仍是默认那四把等价键')
      .toEqual([...new Set(Object.keys(UI_BINDS.keyboard).filter((c) => UI_BINDS.keyboard[c] === 'confirm'))].sort())
    /**
     * A10 第一跑量出来的那一格：屏幕上「一格没动」与「一句说明」是两件事。
     * 夹取那一侧的谓词会替边界把鼠标格挡在表外，所以只问表不够——边界一旦不再拒，
     * `rebindUi` 就交回一个 swap，那一行的注语立刻写成「这把键原本是空着的」，而格子里什么都没有。
     */
    expect(uiRow(html(r.p), 'confirm'), '拒绝了就没有交换，也就没有一句说明可画（KI-344 立的口径）').not.toContain('这把键')
    expect(html(r.p), '等待收场了：那一行不再挂着「等待中」').not.toContain('等待一枚键')
  })
})

/**
 * KI-361：同一双手在同一帧里的两件事。KI-360 那一声握手把"点控制件的那一下"从答案里撤掉是对的，
 * 但它撤的是**袋里那一枚**，没问它是谁答的——于是玩家按下要绑的那把键（先到的那件）会被一次无关的
 * 点击（后到的那件）吞掉，等待还被续上：屏幕上既不绑、也没有一句说明，玩家只知道"我按了它没反应"。
 * 撤法：握手只按名字拿走鼠标自己答的那一枚，其余来源留在袋里由那一帧的投递路径交给正等着的那一行。
 * 这一份量具的关键是**两件事之间不插帧**（`pump` 只在最后走一次）——那正是真浏览器里同一帧的形状。
 */
describe('KI-361 同一帧里的两件事：握手只吞下这一下自己答的那一枚', () => {
  it('先按下一把键、再点了一下滑杆（同一帧）⇒ 键归那一行、滑杆归这一下，谁也不许替谁吞账', () => {
    const r = rig(true)
    click(r.p, 'arm', 'dodge')
    key('KeyQ')                                // 玩家要绑的那把键：先到，Input 记成答案并熄灭武装
    click(r.p, 'gstep', 'damageScale:1')       // 同一帧里另一只手点了滑杆
    pump(r.p, r.input)
    expect(r.bindings.get().gameplay.keyboard.KeyQ, '键盘那枚答案不许被一次无关的点击吃掉（KI-360 还欠①）').toBe('dodge')
    expect(r.gameplay.get().damageScale, '而滑杆照旧动了一步：撤答案不等于撤控制件').toBeCloseTo(1.05)
    expect(html(r.p), '等待收场了：那一行不再挂着「等待中」').not.toContain('等待一枚键')
  })

  it('同帧里按 Escape 想退那一步等待、又点了一下控制件 ⇒ 退的是等待，而不是把 Escape 吞掉再绑成键', () => {
    const r = rig(true)
    click(r.p, 'arm', 'dodge')
    key('Escape')                              // 玩家的本意就是撤等待（`takeCapturedKey` 那条既有口径）
    click(r.p, 'gstep', 'damageScale:1')       // 而同一帧里手指还碰了一下别处
    pump(r.p, r.input)
    expect(r.bindings.get().gameplay.keyboard.Escape, 'Escape 在默认表上本来就是暂停：它既没被改绑进这一行、也没被吞掉').toBe('pause')
    expect(Object.keys(r.bindings.get().gameplay.keyboard).find((c) => r.bindings.get().gameplay.keyboard[c] === 'dodge'),
      '闪避仍住在它原来那把键上').toBe('ControlLeft')
    expect(html(r.p), '等待已经被那一次 Escape 收场：面板不该还挂着「等待中」让玩家再按一次').not.toContain('等待一枚键')
  })

  it('两只手谁先到都得各自的账：先点滑杆、后按下那把键 ⇒ 同一格结果（这条一写出来就该绿）', () => {
    const r = rig(true)
    click(r.p, 'arm', 'dodge')
    click(r.p, 'gstep', 'damageScale:1')       // 这一刻袋里是空的：握手什么都拿不到
    key('KeyQ')                                // 之后按下的那把键才是这一行等的答案
    pump(r.p, r.input)
    expect(r.bindings.get().gameplay.keyboard.KeyQ, '顺序不该决定一枚键的命运').toBe('dodge')
    expect(r.gameplay.get().damageScale, '滑杆那一步同样落账').toBeCloseTo(1.05)
  })

  it('等的是手柄那一枚时，一次点击既答不上也撤不掉等待（名字这条路不许动 KI-343 那条口径）', () => {
    const r = rig(true)
    click(r.p, 'armpad', 'dodge')
    key('KeyQ')                                // 键盘不许替手柄那一枚作答
    click(r.p, 'gstep', 'damageScale:1')
    pump(r.p, r.input)
    expect(r.bindings.get().gameplay.keyboard.KeyQ, '那一枚键从来没有成为答案：KeyQ 的主人仍是它默认那一位（锁定），等待没被它填上').toBe('lockOn')
    expect(Object.keys(r.bindings.get().gameplay.keyboard).find((c) => r.bindings.get().gameplay.keyboard[c] === 'dodge'),
      '闪避也没被换走').toBe('ControlLeft')
    expect(html(r.p), '等待还续着：半截等待那条老纪律与来源的名字无关').toContain('等待一枚手柄键')
    expect(r.gameplay.get().damageScale, '而控制件那一下照常走').toBeCloseTo(1.05)
  })
})

/* ------------------------------------------------------------------ KI-362 */

/**
 * KI-362：「3 套配置文件」第一次长在这屏上——三行、每行两把把手，而它写的是**那三盒**，不是面板自己的状态。
 *
 * 这一屏最容易写歪的三件事，本批各有一条腿钉着：
 * ① **存入不换键**：按下「存入」抄走的是此刻那张表，而玩家正在用的那张一个字节都不动。
 *    做反了就变成"存个文件顺手把键改了"——那是同一双手上的两件事被并成一次（与 KI-361 同一类）。
 * ② **载入才换键**：只有那一格的「载入」把盒里那张请回运行时，而屏幕那一列必须跟着说真话
 *    （读的是 `input.binds`，不是面板 remembered 的那一盒）。
 * ③ **空盒不许被 Enter 点下去**：那一格的 `disabled` 只有鼠标替浏览器挡，键盘那条路没人挡（KI-345 立的那条）。
 *
 * 「口径」那一行也在这批换掉：它原来还写着「3 套配置文件……还没接」，而鼠标那一半早已在 KI-360／KI-361 接上——
 * 一句停在旧形状上的页脚就是 ui-ux §8 反对的那类假读数，所以它由两条腿量，不由这段推理担保。
 */
const profileRow = (h: string, i: number): string =>
  h.split('<div class="row">').find((s) => s.includes(`data-act="profstore" data-arg="${i}"`)) ?? ''

describe('KI-362 配置文件那三行：存入不换键、载入才换、空盒点不动', () => {
  it('三行都在，格数就是那位主人给的三；一盒没存 ⇒ 三个「载入」都写着 disabled，读数说「空」', () => {
    const r = rig()
    const h = html(r.p)
    expect((h.match(/data-act="profstore"/g) ?? []).length, '存入的行数 = 磁带的格数，多一格少一格都是抄写漂移').toBe(PROFILE_SLOTS)
    expect((h.match(/data-act="profload"/g) ?? []).length, '载入与存入各画各的：一行两把，不是把前一替换掉').toBe(PROFILE_SLOTS)
    for (let i = 0; i < PROFILE_SLOTS; i++) {
      const row = profileRow(h, i)
      expect(row, `第 ${i + 1} 行的两把把手都写着第几盒`).toContain(`data-act="profload" data-arg="${i}"`)
      expect(row, `第 ${i + 1} 行此刻是空的 ⇒ 那一格说「空」`).toContain('空')
      expect(row, `而空盒的「载入」要 disabled：没有东西可载入不是一次能点的操作`).toContain('data-act="profload"')
    }
    expect((h.match(/data-act="profload"[^>]*disabled/g) ?? []).length, '三格全空 ⇒ 三个载入都点不动').toBe(PROFILE_SLOTS)
  })

  it('改键之后按「存入」：抄走的是此刻那张，而玩家在用的键一个没动、那一行从此说「已存」', () => {
    const r = rig()
    click(r.p, 'arm', 'dodge'); key('KeyQ'); pump(r.p, r.input)
    click(r.p, 'profstore', '0')
    const tapes = r.bindings.getProfiles()
    expect(tapes, '面板手里只有函数：那一盒进了 store，不是面板自己留的').not.toBeUndefined()
    expect(tapes![0]!.gameplay.keyboard.KeyQ, '存进去的就是刚才改那一张').toBe('dodge')
    expect(r.input.binds.keyboard.KeyQ, '而"存入"不许换键：玩家此刻用的还是那一张').toBe('dodge')
    const row = profileRow(html(r.p), 0)
    expect(row, '下一拍屏幕读回来的是 store 那句话，不是"我刚点过"').toContain('已存')
    expect(row).not.toMatch(/data-act="profload"[^>]*disabled/)
    expect(r.notices.at(-1), '存入一盒说的是存入').toContain('配置文件 1')
    expect(r.notices.at(-1)).not.toContain('覆盖')
  })

  it('同一行再存一次说得出来是覆盖：那一句与第一次不是同一句，也不许两句都不说', () => {
    const r = rig()
    click(r.p, 'profstore', '1')
    const first = r.notices.at(-1)
    click(r.p, 'arm', 'jump'); key('KeyB'); pump(r.p, r.input)
    click(r.p, 'profstore', '1')
    expect(r.notices.at(-1), '覆盖那一次必须说覆盖（面板读的是边界的回答，不是自己数）').not.toBe(first)
    expect(r.notices.at(-1)).toContain('覆盖')
    expect(r.bindings.getProfiles()![1]!.gameplay.keyboard.KeyB, '盒里换成了新那一张').toBe('jump')
    expect(r.notices.filter((n) => /配置文件 2/.test(n)).length, '两次点击各说一句，不多不少').toBe(2)
  })

  it('存 → 改成别的 → 按「载入」：整张换回盒里那一张，而屏幕那一列跟着说真话', () => {
    const r = rig()
    click(r.p, 'arm', 'dodge'); key('KeyQ'); pump(r.p, r.input)
    click(r.p, 'profstore', '0')
    click(r.p, 'arm', 'dodge'); key('KeyE'); pump(r.p, r.input)
    expect(r.input.binds.keyboard.KeyE).toBe('dodge')
    click(r.p, 'profload', '0')
    expect(r.input.binds.keyboard.KeyQ, '盒里那一把回来了').toBe('dodge')
    expect(r.input.binds.keyboard.KeyE, '而刚才那一次改键不在盒里 ⇒ 载入之后它不该还挂着').toBe('interact')
    const row = gameRow(html(r.p), 'dodge')
    expect(row, '那一行的键名列读的是运行时真值：屏幕不说谎这条在载入那一拍也要成立').toContain('<span class="num">Q</span>')
    expect(r.notices.at(-1)).toContain('载入配置文件 1')
  })

  it('空盒那一格连 Enter 也点不动：键盘那条路没人挡 disabled，一格都不动、一句也不说', () => {
    const r = rig()
    const steps = walkTo(r.p, r.input, 'data-act="profload" data-arg="1"', 400)
    expect(focusTag(html(r.p)), `没走到第 2 行的「载入」（走了 ${steps} 步）`).toContain('data-act="profload" data-arg="1"')
    expect(focusTag(html(r.p)), '框住的那一格此刻真的写着 disabled').toContain('disabled')
    pump(r.p, r.input, ['confirm'])
    expect(r.bindings.getProfiles(), '点下去不是"载入一份默认"，而是根本没发生').toBeUndefined()
    expect(r.input.binds.keyboard, '运行时那张一格没动').toEqual(defaultBindings().gameplay.keyboard)
    expect(r.notices.filter((n) => /配置文件/.test(n)), '被挡住的那一次不该留下一句"我做了什么"').toEqual([])
    pump(r.p, r.input, ['confirm'])
    expect(r.bindings.getProfiles(), '连按两次仍然没发生（上一条不是空断言）').toBeUndefined()
  })

  it('三盒跟着档走：面板里存好那一盒 → save → 新世界 load → 那一行仍说「已存」，按「载入」拿回当时那张', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    click(w.p, 'tab', 'ops')
    click(w.p, 'arm', 'dodge'); key('KeyQ'); pump(w.p, w.input)
    click(w.p, 'profstore', '2')
    click(w.p, 'arm', 'dodge'); key('KeyE'); pump(w.p, w.input)
    await w.saves.save('ops')
    const raw = JSON.parse((await store.get('ops'))!) as {
      payload: { snapshot: { settings: { bindingsProfiles?: (Record<string, unknown> | null)[] } } }
    }
    expect(raw.payload.snapshot.settings.bindingsProfiles![2], '第三盒真的进了档：那一格里有 Q').not.toBeNull()

    const w2 = makeWorld(store)
    await w2.saves.load('ops')
    expect(w2.bindings.profileFlags()[2], '新世界读回来的是"这一盒有东西"那句话').toBe(true)
    click(w2.p, 'tab', 'ops')
    expect(profileRow(html(w2.p), 2), '第一屏就说真话：那一行不是空的（面板读的是 store，不是自己的记忆）').toContain('已存')
    click(w2.p, 'profload', '2')
    expect(w2.input.binds.keyboard.KeyQ, '按下去请回的是当时那一张').toBe('dodge')
  })

  it('「口径」那一行不再停在旧形状上：配置文件那三盒说得出住在哪一格，而键鼠／手柄各自一套仍然登记为欠', () => {
    const r = rig()
    const note = html(r.p).split('<div class="row">').find((s) => s.includes('口径')) ?? ''
    expect(note, '那句话今天还说「3 套配置文件还没接」——而这一批刚把它接上了').not.toContain('3 套配置文件')
    expect(note).toContain('settings.bindingsProfiles')
    expect(note, '剩下的那一半（两条通道各一套 profile）不许被这一句顺手宣布完成').toContain('键鼠')
  })
})

/* ------------------------------------------------------------------ KI-363 */

/**
 * KI-363：那一行多第三把把手（「清空」）。这一屏要量的还是那两句话，只是把「存过没有」之外
 * 又多问一次「清得掉吗」：
 * ① **清空不换键**——按下它之后屏幕上每一行的键名一格都不该动（它动的是那三盒，不是此刻那张）；
 *    这与 KI-362 ①「存入不换键」是同一条纪律的另一半，所以它由**同一批键名列**量，不由推理担保。
 * ② **「清空」与「载入」共用同一道闸门**——空盒那两把都写 `disabled`，读的都是同一句
 *    `profileFlags()`；一格不许有两个「这一格有没有东西」的书写者（§55）。
 *    而键盘那条路没人挡 `disabled`（KI-345），所以第三把也得站在那道闸门后面。
 * ③ **回声来自边界那个布尔**——面板不自己数第几次，也不替拒绝编一句「已清空」。
 */
describe('KI-363 那一行第三把「清空」：请回空的是那一盒，屏幕上每一行都不换键', () => {
  it('一行三把：空盒那两把（载入／清空）一起写 disabled，而「存入」永远点得动', () => {
    const r = rig()
    const h = html(r.p)
    expect((h.match(/data-act="profclear"/g) ?? []).length, '清空与载入各画各的：三行就是三把').toBe(PROFILE_SLOTS)
    expect((h.match(/data-act="profclear"[^>]*disabled/g) ?? []).length, '三格全空 ⇒ 三个载入与三个清空一起点不动').toBe(PROFILE_SLOTS)
    expect((h.match(/data-act="profstore"[^>]*disabled/g) ?? []).length, '「存入」抄的是此刻那张：它没有空不空这一说').toBe(0)
    click(r.p, 'profstore', '1')
    const row = profileRow(html(r.p), 1)
    expect(row).not.toMatch(/data-act="profclear"[^>]*disabled/)
    expect(row, '同一句 `profileFlags()` 一次答两把：存过之后载入与清空一起变得能点').not.toMatch(/data-act="profload"[^>]*disabled/)
    expect(profileRow(html(r.p), 0), '而没存过的那一行两把仍点不动（清空不许顺手把别格也点亮）').toMatch(/data-act="profclear"[^>]*disabled/)
  })

  it('按「清空」：那一行从「已存」回到「空」，回声说得出第几盒，而屏幕上每一行的键名一格都没动', () => {
    const r = rig()
    click(r.p, 'arm', 'dodge'); key('KeyQ'); pump(r.p, r.input)
    click(r.p, 'profstore', '0')
    const rows = html(r.p)
    expect(r.bindings.getProfiles()![0], '先确认那一盒真存进去了').not.toBeNull()
    click(r.p, 'profclear', '0')
    expect(r.bindings.getProfiles(), '盒里那张没了（面板不另留一份影子）').toBeUndefined()
    const after = html(r.p)
    expect(profileRow(after, 0), '那一行下一拍读回来的是 store 那句话：又空了').toContain('空')
    expect(profileRow(after, 0)).toMatch(/data-act="profclear"[^>]*disabled/)
    expect(gameRow(after, 'dodge'), '清空动的是那三盒：玩法那一行的键名列一个字都不该重排').toBe(gameRow(rows, 'dodge'))
    expect(r.input.binds.keyboard.KeyQ, '玩家此刻用的还是那一张（不回默认、也不倒回去）').toBe('dodge')
    expect(r.notices.at(-1), '清空说的是清空，不是"已存入"也不是"已载入"').toContain('已清空配置文件 1')
  })

  it('空盒那一把连 Enter 也点不动：走到它那一格按确认 ⇒ 一句也不说、三格仍是三格空', () => {
    const r = rig()
    const steps = walkTo(r.p, r.input, 'data-act="profclear" data-arg="2"', 400)
    expect(focusTag(html(r.p)), `没走到第 3 行的「清空」（走了 ${steps} 步）`).toContain('data-act="profclear" data-arg="2"')
    expect(focusTag(html(r.p)), '框住的那一格此刻真的写着 disabled').toContain('disabled')
    pump(r.p, r.input, ['confirm'])
    expect(r.bindings.getProfiles(), '点下去不是「清出一个空」，而是根本没发生').toBeUndefined()
    expect(r.notices.filter((n) => /配置文件/.test(n)), '被挡住的那一次不该留下一句「我做了什么」').toEqual([])
    pump(r.p, r.input, ['confirm'])
    expect(r.notices, '连按两次仍然一句没多说（上一条不是空断言）').toEqual([])
  })

  it('拒绝那一次面板一句不说：绕过闸门直接按在空盒上 ⇒ 没有「已清空」，而那一行仍说「空」', () => {
    const r = rig()
    click(r.p, 'profclear', '1')
    expect(r.notices, '空盒的「清空」没有回声：那一行的「空」与 disabled 已经把话说完').toEqual([])
    expect(profileRow(html(r.p), 1)).toContain('空')
    click(r.p, 'profstore', '1'); click(r.p, 'profclear', '1')
    expect(r.notices.at(-1), '存过之后同一把按下去才有回声：回声的主人仍是边界那个布尔').toContain('已清空')
    click(r.p, 'profclear', '1')
    expect(r.notices.filter((n) => /已清空/.test(n)).length, '第二次按在空盒上不该再说一遍「已清空」').toBe(1)
  })
})

/* ------------------------------------------------------------------ KI-364 */

/**
 * KI-364：扳机拐点那一格的玩家入口（§6 那一格在规格里挂了很久，机制与存档里没有落点，界面里更没有）。
 *
 * 这一屏量的是「那一格改的到底是哪一个数」，四条各钉一处：
 * ① **读数与把手同节**：那一行画在玩法键位那一节（它是玩法那张表的第 6 格），读的是**此刻生效**那一个数，
 *    端点两把 `disabled`——界由 `BIND_BOUNDS` 说，面板既不抄默认也不夹取；
 * ② **改的是机制不是装饰**：同一块手柄、同一个推量，改完线就不算按下了（这一条走的是真 `Input.pollPad`，
 *    不是面板自己算的一个数）；
 * ③ **那一行只认那一格的名字**：名册外的前缀与错形参数一格都不动；
 * ④ **键盘那条路没人替玩家挡** `disabled`（§218），端点那把 ◀ 连 Enter 也点不动。
 */
describe('KI-364 扳机拐点那一行：读数＝生效那一个数，而它改的是判据', () => {
  it('那一行在玩法键位那一节里：50% 起手，◀▶ 一步 0.05，两端写 `disabled`，连按不漂二进制尾巴', () => {
    padWith(null)
    const r = rig(true)
    const h = html(r.p)
    expect(h.indexOf('扳机推过多少算按下'), '那一行属于玩法那一节：它在「菜单导航」那个 h2 之前').toBeLessThan(h.indexOf('菜单导航'))
    const sec = (): string => html(r.p).slice(html(r.p).indexOf('扳机推过多少算按下'))
    expect(sec(), '第一屏画的是**生效**那一个数（读 `bindsSource.binds`，不是抄一份默认）')
      .toContain(`${Math.round(DEFAULT_BINDS.triggerThreshold * 100)}%`)
    click(r.p, 'tstep', 'triggerThreshold:1')
    expect(r.bindings.get().gameplay.triggerThreshold, '0.05 是界面粒度：写死在这里正是为了量它').toBe(0.55)
    expect(r.input.binds.triggerThreshold, '面板走的是 store ⇒ 消费者拿到同一个数，不是第二份状态').toBe(0.55)
    for (let i = 0; i < 8; i++) click(r.p, 'tstep', 'triggerThreshold:1')
    expect(r.bindings.get().gameplay.triggerThreshold, '界由 `BIND_BOUNDS` 说：鼠标按到底也越不出去').toBe(BIND_BOUNDS.triggerThreshold.max)
    expect(sec()).toMatch(/data-act="tstep" data-arg="triggerThreshold:1" disabled/)
    for (let i = 0; i < 30; i++) click(r.p, 'tstep', 'triggerThreshold:-1')
    const v = r.bindings.get().gameplay.triggerThreshold
    expect(v, '0.95 − 0.05×18 应该是那一个字，不是拖出二进制尾巴的近似').toBe(BIND_BOUNDS.triggerThreshold.min)
    expect(String(v), '存进档的就是这一串：往返不漂移要的是十进制的干净').toBe('0.05')
    expect(sec()).toMatch(/data-act="tstep" data-arg="triggerThreshold:-1" disabled/)
    expect(sec(), '而另一端没被连按拖走：到界了才写 disabled').toMatch(/data-act="tstep" data-arg="triggerThreshold:1"\s*>▶/)
  })

  it('那一行改的是判据：同一块手柄、同一个推量，线推高之后就不算按下；报着 pressed 也不算', () => {
    padWith(null)
    const r = rig(true)
    // `click` 量具递的是自己造的一枚 target（它不看那一行在不在屏上），所以"我点的是屏上那把把手"必须先被证一次；
    // 否则这一条腿在「那一行整个不画」的折法下照样绿——那是量具替机制腿兜了底（A2／D1 第一次量出来的正是这一格）
    expect(html(r.p), '这一条走的是屏上那两把 ◀▶：它们得先在屏上').toContain('data-act="tstep" data-arg="triggerThreshold:1"')
    const pull = (v: number): void => { padWith([], [0, 0, 0, 0], { 7: v }); pump(r.p, r.input) }
    const off = (): void => { padWith([]); pump(r.p, r.input) }
    pull(0.7)
    expect([...r.input.frame.held], '默认线是一半 ⇒ 0.7 推着 RT 就是 sprint').toContain('sprint')
    off()
    for (let i = 0; i < 6; i++) click(r.p, 'tstep', 'triggerThreshold:1')   // 0.5 → 0.8，走的就是那一行的 ▶
    pull(0.7)
    expect([...r.input.frame.held], '同一只手同一个推量，改完线就不算按下 ⇒ 那一格不是给存档看的装饰').toEqual([])
    pull(0.9)
    expect([...r.input.frame.held], '线上面照样打得出：这一格也没有把扳机关掉').toContain('sprint')
    off()
    padWith([7], [0, 0, 0, 0], { 7: 0.3 })
    pump(r.p, r.input)
    expect([...r.input.frame.held], '浏览器报着 pressed、却没到我们那条线 ⇒ 由我们说了算').toEqual([])
    padWith([7], [0, 0, 0, 0], { 7: 0.9 })
    pump(r.p, r.input)
    expect([...r.input.frame.held], '而推过去之后 pressed 那个布尔一个字没变，亮的仍是同一路').toContain('sprint')
    padWith([])
    pump(r.p, r.input)
  })

  it('那一行只认那一格的名字：名册外的前缀、错形的方向参数 ⇒ 不动、不响、不编说明', () => {
    padWith(null)
    const r = rig(true)
    // 两条取证前提（都不是判据，是"这一格量不量得出"）：① 这条腿说的是**屏上那一行**，所以它得先在屏上
    // （`click` 递的是自己造的 target，不看那一行画没画——与上一条腿同一处量具兜底）；
    // ② 先把那一格挪离默认，否则「不校验方向」那一折把 `NaN` 交回边界、边界夹回的就是默认，
    //    而默认正是起手值 ⇒「动了」与「没动」在量具上是同一串
    expect(html(r.p), '这一条走的是屏上那一行：它得先在屏上').toContain('data-act="tstep" data-arg="triggerThreshold:1"')
    click(r.p, 'tstep', 'triggerThreshold:1')
    const before = r.bindings.get()
    expect(before.gameplay.triggerThreshold, '"不动"要量得出，先得有一格动得起来').toBe(0.55)
    for (const arg of ['notTrig:1', 'triggerThreshold:abc', 'triggerThreshold:', 'triggerThreshold', 'stickThreshold:1']) {
      click(r.p, 'tstep', arg)
    }
    expect(r.bindings.get(), '步进那一格认的不是「前缀像不像」，是那一格的名字').toEqual(before)
    expect(r.bindings.get().ui.stickThreshold, '菜单那一格的阈值也不许被 `tstep` 顺手走一格').toBe(UI_BINDS.stickThreshold)
    expect(r.notices, '那一行没被点中就没有一句该响').toEqual([])
    expect(html(r.p), '没有一次写入就没有一句说明').not.toContain('已把扳机')
  })

  it('键盘那条路没人替玩家挡：端点那把 ◀ 被 Enter 点下去是 bug，旁边那格照样点得动', () => {
    padWith(null)
    const r = rig(true)
    for (let i = 0; i < 20; i++) click(r.p, 'tstep', 'triggerThreshold:-1')
    let reached = 0
    while (reached < 300 && !focusTag(html(r.p)).includes('data-act="tstep" data-arg="triggerThreshold:-1"')) { pump(r.p, r.input, ['down']); reached++ }
    expect(focusTag(html(r.p)), `没走到扳机那一格的 ◀（走了 ${reached} 步）`).toContain('data-act="tstep" data-arg="triggerThreshold:-1"')
    expect(focusTag(html(r.p)), '框住那一格此刻真的写着 disabled ⇒ Enter 绕不过的是这一句，不是夹紧之后那个数').toContain('disabled')
    pump(r.p, r.input, ['confirm'])
    expect(r.bindings.get().gameplay.triggerThreshold, 'disabled 那一格被 Enter 点下去是 bug，不是可达性').toBe(BIND_BOUNDS.triggerThreshold.min)
    pump(r.p, r.input, ['down'])
    pump(r.p, r.input, ['confirm'])
    expect(r.bindings.get().gameplay.triggerThreshold, '旁边那格 ▶ 没 disabled ⇒ Enter 点得动（上一条不是空断言）').toBe(0.1)
  })
})

/* ------------------------------------------------------------------ KI-365 */

/**
 * KI-365：§6 那一行「长按阈值 200–800ms」在这一屏上第一次有一格把手。
 *
 * 它骑的是数值那一批既成的形状（`OPS_NUMERIC` 一行 + `gstep` 那对把手），所以这里问的四件事与
 * KI-359／KI-364 那两批同口径：**读数就是生效那一个数**、**一步是界面粒度而不是规格**、
 * **端点由 `GAMEPLAY_BOUNDS` 说**（这一格最要紧的一条：拧到 0 会让「长按」这件事根本打不出来，
 * 而下界 200 恰好是**离旧行为最近**的那一端）、**名册外的名字不许顺手走一格**。
 * 机制那一半在 `tests/flow/heavy-hold-threshold.test.ts`，接线那一半在 `tests/unit/ops-handles.test.ts`，
 * 跟档那一半在 `tests/flow/settings-persistence.test.ts`。
 */
describe('KI-365 长按那一行：读的是生效那一个数，界由表说，一步 50ms', () => {
  it('那一行在数值那一节里：起手画 200ms，注语把界写在这一行自己身上，meter 从下限起手', () => {
    const r = rig(true)
    const row = numRow(html(r.p), 'holdMs')
    expect(row, '一行都不许空着行名（玩家要能分辨自己拧的是长按还是输入缓冲）').toContain('按住多久算长按')
    expect(row, '画的是**生效**那一个数（读 `ops.gameplay()`，不是抄一份默认）').toContain('200ms')
    expect(row, '注语得说得出这一格的界——§6 那一行写的就是 200–800ms').toContain('200–800ms')
    expect(row, '下限起手 ⇒ meter 一格不满（0.0%）；顶格那一端在下一条腿里量').toContain('width:0.0%')
    expect(numRow(html(r.p), 'bufferMs'), '长按这一行不是把输入缓冲那一行改了名字：两行同时在屏上').toContain('输入缓冲')
  })

  it('点 ▶ 一步 50ms：落进 store，也落进玩家手里那一个字段；别格一格不动', () => {
    const r = rig(true)
    click(r.p, 'gstep', 'holdMs:1')
    expect(r.gameplay.get().holdMs, '50 是界面粒度：写死在这一格上正是为了量它').toBe(250)
    expect(r.playerTarget.holdMs, '面板走的是 store ⇒ 判据读的是同一个数，不是第二份状态').toBe(250)
    expect(numRow(html(r.p), 'holdMs'), '而屏上那一格读回来的也是它').toContain('250ms')
    expect([r.gameplay.get().bufferMs, r.gameplay.get().shakeScale, r.gameplay.get().damageScale], '别格不许陪绑')
      .toEqual([200, 1, 1])
  })

  it('端点两头：◀ 到底回的是 200 而不是 0（拧成 0 就没有长按了），▶ 到 800 才写 disabled', () => {
    const r = rig(true)
    for (let i = 0; i < 30; i++) click(r.p, 'gstep', 'holdMs:-1')
    /** 界写成**字面量**：这一腿钉的就是 §6 那一条 200–800，读 `GAMEPLAY_BOUNDS` 会变成自我印证（界写错时两边一起错） */
    expect(r.gameplay.get().holdMs, '鼠标按到底也下不去 200：那一条线的下界就是这一格的存在理由').toBe(200)
    expect(r.playerTarget.holdMs, '而玩家手里见的也是夹过的那一个').toBe(200)
    expect(numRow(html(r.p), 'holdMs')).toMatch(/data-act="gstep" data-arg="holdMs:-1" disabled/)
    for (let i = 0; i < 40; i++) click(r.p, 'gstep', 'holdMs:1')
    expect(r.gameplay.get().holdMs, '上界是 800ms = §6 那一行的上限，不是 240（输入缓冲那一条界）').toBe(800)
    const row = numRow(html(r.p), 'holdMs')
    expect(row).toMatch(/data-act="gstep" data-arg="holdMs:1" disabled/)
    expect(row, '顶格时 meter 该满：那一格说的是「这一行拧到头了」').toContain('width:100.0%')
    expect(row, '而另一端此刻还能点回去：端点各说各的').toMatch(/data-act="gstep" data-arg="holdMs:-1"\s*>◀/)
    expect(String(r.gameplay.get().holdMs), '存进档的就是这一串：整数毫秒不该被步进量拖出小数尾巴').toBe('800')
  })

  it('那一行只认这一格的名字：名册外的前缀、错形的方向参数 ⇒ 不动、不响、不编说明', () => {
    const r = rig(true)
    // 取证前提（不是判据，是"这一格量不量得出"）：先把那一格挪离默认，否则「不校验方向」那一折
    // 把 `NaN` 交回边界、边界夹回的就是默认，而默认正是起手值 ⇒「动了」与「没动」在量具上是同一串
    click(r.p, 'gstep', 'holdMs:1')
    const before = r.gameplay.get()
    expect(before.holdMs, '"不动"要量得出，先得有一格动得起来').toBe(250)
    for (const arg of ['notHold:1', 'holdMs:abc', 'holdMs', 'holdMsx:1', 'bufferMs2:1']) {
      click(r.p, 'gstep', arg)
    }
    expect(r.gameplay.get(), '步进那一格认的不是「前缀像不像」，是那一格的名字').toEqual(before)
    expect(r.playerTarget.holdMs, '而消费者手里也不许被一个名册外的名字拧走').toBe(250)
    expect(r.notices, '那一行没被点中就没有一句该响').toEqual([])
    expect(html(r.p), '没有一次写入就没有一句说明').not.toContain('已把长按')
  })

  it('长按那一行的键盘那条路没人替玩家挡：端点那把 ◀ 被 Enter 点下去是 bug，旁边那格照样点得动', () => {
    const r = rig(true)
    for (let i = 0; i < 30; i++) click(r.p, 'gstep', 'holdMs:-1')
    let reached = 0
    while (reached < 400 && !focusTag(html(r.p)).includes('data-act="gstep" data-arg="holdMs:-1"')) { pump(r.p, r.input, ['down']); reached++ }
    expect(focusTag(html(r.p)), `没走到长按那一格的 ◀（走了 ${reached} 步）`).toContain('data-act="gstep" data-arg="holdMs:-1"')
    expect(focusTag(html(r.p)), '框住那一格此刻真的写着 disabled ⇒ Enter 绕不过的是这一句，不是夹紧之后那个数').toContain('disabled')
    pump(r.p, r.input, ['confirm'])
    expect(r.gameplay.get().holdMs, 'disabled 那一格被 Enter 点下去是 bug，不是可达性').toBe(200)
    pump(r.p, r.input, ['down'])
    pump(r.p, r.input, ['confirm'])
    expect(r.gameplay.get().holdMs, '旁边那格 ▶ 没 disabled ⇒ Enter 点得动（上一条不是空断言）').toBe(250)
    expect(r.playerTarget.holdMs, '键盘那一路也一样通到消费者：两条路落的是同一格').toBe(250)
  })
})

/* ------------------------------------------------------------------ KI-366 */

/**
 * KI-366：这一屏第一次要说得出**那一盒里装着什么**。
 *
 * 这批不写新机制，量的是形状，而形状在屏上有两处落点：
 * ① **「口径」那一行**。它原来只交代那三盒**住在哪一格**，没说盒里装的是什么——于是 KI-365 那趟
 *    顺手把它写成「键位快照」也无处可查。读回来是整张表：键盘与手柄两半、玩法那两份「无」的名单、
 *    连扳机与摇杆那两条模拟量的线一起；而那八格玩法数值住在 `settings.gameplay`，不跟着盒走。
 *    这一句由腿量，不由推理担保。
 * ② **那两行新数（KI-345 的摇杆阈值、KI-364 的扳机拐点）第一次有了「跟着盒子走」这件事**。
 *    KI-362／KI-363 那两批写「载入才换键、存入与清空都不换键」时，屏上只有键名列可查——
 *    那两行读数是后来才长出来的，所以那三条纪律在新的读数面上**从没量过**。本批补上。
 *
 * 第一跑那两条读数腿红在量具自己身上：`linePct` 的捕获组写成 `(\d+)%`，把百分号留在了组外，
 * 于是取回来的是 `80` 而不是 `80%`。判据（那两行跟着盒子走、存入与清空不许碰它们）一个字没动，改的是取串。
 */
const lineRow = (h: string, label: string): string =>
  h.split('<div class="row">').find((s) => s.includes(label)) ?? ''
/** 那一行 `class="num"` 后面的第一个读数（连着百分号一起取）：面板上排第二的那个百分数是 meter 的宽度，不是这一格的数 */
const linePct = (h: string, label: string): string => (lineRow(h, label).match(/class="num">(\d+%)/) ?? ['', ''])[1]
/** 那两行的行名照字面写：`OPS_TRIGGER`／`OPS_STICK` 是面板模块里的私货，抄进尺就成第二个主人 */
const TRIG_LABEL = '扳机推过多少算按下'
const STICK_LABEL = '摇杆推过多少算按下'

describe('KI-366 那一盒里装着什么：口径那一行说得出整张表带那两条线，而那八格数值不跟着盒走', () => {
  it('「口径」那一行第一次说得出那一盒里装的是什么：整张键位表连那两条线，而那八格玩法数值不跟着盒走', () => {
    const r = rig(true)
    const note = html(r.p).split('<div class="row">').find((s) => s.includes('口径')) ?? ''
    expect(note, '那一盒不是「键位」那么窄：手柄那一半与那两条模拟量的线也在里面（本批从源码读回来、由数据那七条腿量出的形状）').toContain('整张键位表')
    expect(note, '两把线要点得出名字：只写「整张表」等于玩家还是推不开那只盒').toContain('扳机与摇杆那两条线')
    expect(note, '那一节上面那八格数值住在另一格（`settings.gameplay`）：「切一盒切不动手感」这句真话要说得出').toContain('不跟着盒走')
    expect(note, 'KI-366 那一句「面板这一档仍是两条通道一起存、一起取」到 KI-368 已被改口：屏上那一枚现在有名字，旧句子不许留在面上').not.toContain('一起存、一起取')
    expect(note, '而数据那一侧的分家已落地（KI-367）：上一句不许被读成「两条通道谁也分不开」').toContain('能各自存、各自取')
    expect(note, '屏上那一枚也从 KI-368 起接上了把手：这一句读的是界面上的形状，不是数据那半格').toContain('存取哪一半')
    expect(note, '而那把「清空」始终不在这一枚的管辖里：句子要说全，不许读成三把都按通道走').toContain('「清空」不受它管')
    expect(note, '仍要欠得说出名字：按档独立那一格今天还没接').toContain('按档独立')
  })

  it('按「载入」那一拍，屏上那两行的读数一起回到存盒那一刻：盒里带的那两条线走到了屏上', () => {
    const r = rig(true)
    for (let i = 0; i < 6; i++) click(r.p, 'tstep', 'triggerThreshold:1')
    for (let i = 0; i < 5; i++) click(r.p, 'ustep', 'stickThreshold:1')
    expect([linePct(html(r.p), TRIG_LABEL), linePct(html(r.p), STICK_LABEL)], '取证前提：两行都拧离了默认（0.50／0.55）')
      .toEqual(['80%', '80%'])
    click(r.p, 'profstore', '0')
    for (let i = 0; i < 6; i++) click(r.p, 'tstep', 'triggerThreshold:-1')
    for (let i = 0; i < 5; i++) click(r.p, 'ustep', 'stickThreshold:-1')
    expect([linePct(html(r.p), TRIG_LABEL), linePct(html(r.p), STICK_LABEL)], '存盒之后那一次拧落到了屏上')
      .toEqual(['50%', '55%'])
    click(r.p, 'profload', '0')
    const h = html(r.p)
    expect(linePct(h, TRIG_LABEL), '盒里那条拐点回来了：那一盒带的不是只有键位').toBe('80%')
    expect(linePct(h, STICK_LABEL), '阈值那一条也一起回来：菜单那一半住在同一只盒里').toBe('80%')
    expect(r.input.binds.triggerThreshold, '面板那一行画的数与 `Input.padOn` 读的数是同一个，不是第二份状态').toBe(0.8)
  })

  it('「存入」与「清空」碰的是那三盒，不是屏上那两行：存一盒、清另一盒 ⇒ 两条线的读数一个数字都不动', () => {
    const r = rig(true)
    for (let i = 0; i < 4; i++) click(r.p, 'tstep', 'triggerThreshold:1')
    for (let i = 0; i < 3; i++) click(r.p, 'ustep', 'stickThreshold:1')
    const before = [linePct(html(r.p), TRIG_LABEL), linePct(html(r.p), STICK_LABEL), r.input.binds.triggerThreshold]
    expect(before, '取证前提：两行都拧离了默认，否则「不动」与「动了」在量具上是同一串').toEqual(['70%', '70%', 0.7])
    click(r.p, 'profstore', '0')
    expect([linePct(html(r.p), TRIG_LABEL), linePct(html(r.p), STICK_LABEL)], 'KI-362 ① 在新的读数面上第一次量得到：存入不换键，也不换那两条线')
      .toEqual(['70%', '70%'])
    click(r.p, 'profstore', '1')
    click(r.p, 'profclear', '0')
    expect([linePct(html(r.p), TRIG_LABEL), linePct(html(r.p), STICK_LABEL), r.input.binds.triggerThreshold], 'KI-363 那一把同样只动磁带：清掉一盒，屏上照旧')
      .toEqual(before)
    expect(r.notices.filter((n) => /配置文件/.test(n)).length, '三次点击各说一句回声，一条不多、一条不少').toBe(3)
  })
})

/* ------------------------------------------------------------------ KI-368 */

/**
 * KI-368：屏上那一枚「存取哪一半」——KI-367 分好家的那两把把手，第一次在界面上按得动。
 *
 * **为什么腿全长在这份既有面板尺里**：那块世界早就接好了两个 store、`Input` 与三个假件，而 `click`／`html`／
 * `walkTo`／`profileRow` 四个把手正是每条腿都要用的；抄第二份 rig 就是 KI-337 那节反对的「两份字面一样却永远
 * 不会出现在同一个 diff 里」——端口改了红的只有抄本，生产照样静默接错。
 *
 * **预测（写在任何一趟跑之前，按当前源码钉死）**：十条红、两条绿。
 * 红的是本批那枚 `act` 还不存在的直接后果——L1 三把一把也不在（`data-act="profchan"` 数不出 3）、
 * L3 点到「只键鼠」什么都不会换、L4 满盒里手柄那半会被整张盖掉、L5 第二行走的不是同一枚、
 * L6 载入会把键鼠那半一起换掉、L7 回声里说不出那半张的名字、L8 清完之后使用中那一枚仍要在原处（今天没有「原处」这一格）、
 * L9 界外那一枚之后落点仍是整张、L10 那三把根本走不到、L12 口径那一行还在宣布「面板这一档两条通道仍一起存、一起取」。
 * 绿的两条是**不许被本批改坏**的那两条，不是漏网：L2 不碰那一枚就逐字仍是 KI-362 那一条路（默认那一枚、整张的落点与那三句回声全钉在这一条里）、
 * L11 那一枚不进存档（今天档里根本没有这一格，本批也不许给它长出一格）。
 *
 * **† 第一趟的预测错过两处，两处都留在注语里而不是抹掉**：
 * ① L2 那时红的是**量具自己**——它先按「载入」把手里那张请回默认、再存一次，然后拿一次**更早**的快照去比**载入之后**的表，
 * 于是那句「盒里装的仍是刚存的那一张」在任何改法之前都会红，红的还是一个错的因。
 * 改成「两条通道各改离默认 → 存 → 再各改一次 → 载入 ⇒ 两半一起回到存进去那一刻」，这条才真的只量「整张」那一档。
 * ② L8 写在预测里是绿的，因为它前四句（半盒就是一只满盒、清的是整盒、回声不提那一半、那一行说「空」）今天确实成立；
 * 可它最后一句要问「清完之后使用中那一枚还在不在原处」——那一枚今天不存在 ⇒ 整条红。
 * 登记这一处是因为**预测写在了腿的名字上而不是写在每一句落点上**：一条腿有六句断言，绿的是那四句，红的是那一句，
 * 「这条腿绿」这句话当时并没有被逐句钉过。
 * ③ L6 的取证前提先写成「闪避那格只剩 A 一把」，量出来的却是 `A、R3`：我把「搬进一枚有人占着的按钮」当成了**覆盖**，
 * 而边界给的是**交换**（KI-348 那一节「已交换」读的就是这一件事）——跳跃落到十字上，被顶掉的闪避接手它原来的 R3。
 * 这条不是量具坏，是**前提抄自记忆而不是抄自边界**；落点那句（载入后回到 `A、十字上`）本来就是按默认表钉的，一个字没动。
 * ④ 第一版的取行把手写成了「行名之后 400 字内数 `<span class="num">`」，于是窗里会漏进下一行的两格，红了也分不清是谁的格子。
 * 换成这份文件里早就有的形状（先从那一节的 `<h2>` 切进去，再截到这一行的 `</div>`）：两节的行名今天真的重名，
 * 而一行的长度由那串 note 决定，note 是要改口的——固定长度的窗量的是历史，不是那一行。
 *
 * **一条形状上的陷阱**：`armpad` 与 `arm` 改的都是**此刻那张**（运行时表），而「存入」抄的正是此刻那张 ⇒
 * 每次取证都要先把「盒里旧那一份」在改键之前取出来（`boxPad0`／`box1Key0`），否则拿着一张表跟它自己比，
 * 红了也说不清是谁动的。
 */

/** 那三把选择把手（`data-act="profchan"`）与使用中那一枚（`class` 里带 `sel`） */
const chanTags = (h: string): string[] => (h.match(/<button\b[^>]*data-act="profchan"[^>]*>/g) ?? [])
const chanSel = (h: string): string => {
  const t = chanTags(h).find((tag) => /class="[^"]*\bsel\b/.test(tag))
  return t ? (t.match(/data-arg="([^"]+)"/) ?? [])[1] ?? '' : ''
}
/** 玩法那一节里某一行两格的内容（`[0]` 键盘、`[1]` 手柄）：与 KI-346／KI-348 那两份同一形状——
 *  **从「玩法键位」那一节的 `<h2>` 之后**找行（两节的行名今天真的重名），也别拿固定长度的窗当一行：
 *  一行的长度由那串 note 决定，而 note 是要改口的，窗一挪就量到下一行。 */
const gameCells = (h: string, label: string): string[] => {
  const sec = h.slice(h.indexOf('玩法键位'))
  const at = sec.indexOf(`<span class="name">${label}<span class="note"`)
  expect(at, `${label} 那一行要在玩法那一节里`).toBeGreaterThanOrEqual(0)
  const rest = sec.slice(at, sec.indexOf('</div>', at))
  return rest.split('<span class="num">').slice(1).map((s) => s.slice(0, s.indexOf('</span>')))
}

describe('KI-368 屏上那一枚「存取哪一半」：默认仍是整张，点上哪一枚就动那一半', () => {
  it('L1 那三把都在、使用中恰有一枚、默认落在「两半一起」', () => {
    const r = rig(true)
    const h = html(r.p)
    expect(chanTags(h).length, '三枚选择 = 名册长度（两半一起／只键鼠／只手柄），多一把少一把都是抄写漂移').toBe(3)
    for (const arg of ['both', 'kb', 'pad']) expect(h, `界面上要有 ${arg} 那一枚`).toContain(`data-act="profchan" data-arg="${arg}"`)
    expect(chanTags(h).filter((t) => /class="[^"]*\bsel\b/.test(t)).length,
      '使用中只画一枚：两枚就说不出「这一按动的是哪一半」，零枚就是屏上根本没有这一档').toBe(1)
    expect(chanSel(h), '不碰它就是 KI-362 那一天：默认落在「两半一起」').toBe('both')
    expect(lineRow(h, '存取哪一半'), '那一行的读数格写的就是使用中那一枚的名字：钉死成名册第一枚，屏上便说不出按下去动的是哪一半')
      .toContain('<span class="num">两半一起</span>')
    expect(lineRow(h, '存取哪一半'), '那一行自己也要说得出「清空」不在它管辖里：只写在「口径」那一行，站在把手旁边的玩家读不到')
      .toContain('「清空」不受它管')
  })

  it('L2 不碰那一枚 ⇒ 存与取逐字仍是 KI-362 那条整张的路，三句回声也逐字相同', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'arm', 'dodge'); key('KeyY'); pump(r.p, r.input)
    click(r.p, 'armpad', 'jump'); padWith([12]); pump(r.p, r.input)
    const liveKey = { ...r.bindings.get().gameplay.keyboard }
    const livePad = { ...r.bindings.get().gameplay.padButtons }
    expect(liveKey, '取证前提：键盘那半离了默认').not.toEqual(defaultBindings().gameplay.keyboard)
    expect(livePad, '而手柄那半也离了默认：整张那一条路要一次动两条通道，只动一条就不是整张的读数').not.toEqual(defaultBindings().gameplay.padButtons)
    click(r.p, 'profstore', '0')
    expect(r.notices.at(-1), '默认那一句不许被本批改口：它已经读了三批，改它要单独一批').toBe('已存入配置文件 1')
    click(r.p, 'arm', 'dodge'); key('KeyB'); pump(r.p, r.input)
    click(r.p, 'armpad', 'jump'); padWith([13]); pump(r.p, r.input)
    click(r.p, 'profload', '0')
    expect(r.bindings.get().gameplay.keyboard, '整张载入：键盘那半跟着盒里那张回来').toEqual(liveKey)
    expect(r.bindings.get().gameplay.padButtons, '整张载入：手柄那半也一起回来（半张那一种落点在默认这一档不存在）').toEqual(livePad)
    expect(r.notices.at(-1), '默认那一句「载入」也逐字不变').toBe('已载入配置文件 1')
    click(r.p, 'profstore', '0')
    expect(r.notices.at(-1), '第二次于满盒上按「存入」说的是覆盖，还是那一句').toBe('已覆盖配置文件 1')
  })

  it('L3 点到「只键鼠」只换使用中那一枚：不改键、不动那三盒、不回声', () => {
    const r = rig(true)
    const table = JSON.stringify(r.bindings.get())
    const flags = r.bindings.profileFlags().join(',')
    click(r.p, 'profchan', 'kb')
    expect(chanSel(html(r.p)), '使用中那一枚跟着按下去的那一枚走').toBe('kb')
    expect(lineRow(html(r.p), '存取哪一半'), '那一行的读数格也一起走：名字与实际使用中那一枚不许各读一处')
      .toContain('<span class="num">只键鼠</span>')
    expect(chanTags(html(r.p)).length, '三把仍画得出来（选择器不是把另外两把收掉）').toBe(3)
    expect(JSON.stringify(r.bindings.get()), '那一枚本身一格键都不改').toBe(table)
    expect(r.bindings.profileFlags().join(','), '也不动那三盒').toBe(flags)
    expect(r.notices.length, '选择不是「存入」也不是「载入」：它没有回声可说').toBe(0)
  })

  it('L4 「只键鼠」那一次存入：满盒里手柄那半保持盒里旧那一份，键盘那半换此刻那张', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'profstore', '0')
    const boxPad0 = { ...(r.bindings.getProfiles()![0] as Bindings).gameplay.padButtons }
    click(r.p, 'arm', 'dodge'); key('KeyY'); pump(r.p, r.input)
    click(r.p, 'armpad', 'jump'); padWith([12]); pump(r.p, r.input)
    expect(r.bindings.get().gameplay.padButtons, '取证前提：手柄那张确实离了盒里那一份').not.toEqual(boxPad0)
    click(r.p, 'profchan', 'kb')
    click(r.p, 'profstore', '0')
    const box = r.bindings.getProfiles()![0] as Bindings
    expect(box.gameplay.keyboard, '键盘那半跟着此刻那张走').toEqual(r.bindings.get().gameplay.keyboard)
    expect(box.gameplay.padButtons, '手柄那半一个字不跟着动：只键鼠那一次不许顺手盖掉它').toEqual(boxPad0)
    expect(box.ui.keyboard, '菜单那半也归手柄那一条通道：它不在键鼠那半里').toEqual(defaultBindings().ui.keyboard)
  })

  it('L5 一枚选择器管全三行：换到「只手柄」之后，另一行的「存入」走的也是同一枚', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'profstore', '0')
    click(r.p, 'profstore', '1')
    const box1Key0 = { ...(r.bindings.getProfiles()![1] as Bindings).gameplay.keyboard }
    click(r.p, 'arm', 'dodge'); key('KeyY'); pump(r.p, r.input)
    click(r.p, 'armpad', 'jump'); padWith([12]); pump(r.p, r.input)
    click(r.p, 'profchan', 'pad')
    click(r.p, 'profstore', '1')
    const box = r.bindings.getProfiles()![1] as Bindings
    expect(box.gameplay.padButtons, '第二行的「存入」按的是同一枚选择器：那一半来了').toEqual(r.bindings.get().gameplay.padButtons)
    expect(box.gameplay.keyboard, '而它原来那一份不退成默认，也不跟着第一行走').toEqual(box1Key0)
    expect(r.bindings.profileFlags(), '两行都还是满的（选择器不改变「这一盒有没有东西」那句话）').toEqual([true, true, false])
  })

  it('L6 「只手柄」那一次载入：键鼠那半一个字没动，手柄那半回来，而屏上那一列跟着真值走', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'profstore', '0')
    click(r.p, 'arm', 'dodge'); key('KeyY'); pump(r.p, r.input)
    click(r.p, 'armpad', 'jump'); padWith([12]); pump(r.p, r.input)
    const liveKey = { ...r.bindings.get().gameplay.keyboard }
    // 那一行两格合成一条串再判：红了要一眼看出屏幕此刻在两格里各画了什么，数组会在消息里被截断
    expect(gameCells(html(r.p), '闪避').join(' | '), '取证前提：键盘那格是 Y，手柄那格是 A、R3——搬进有人那一格是**交换**不是覆盖（跳跃落到十字上，被顶掉的闪避接手它原来的 R3）')
      .toBe('Y | A、R3')
    click(r.p, 'profchan', 'pad')
    click(r.p, 'profload', '0')
    const g = r.bindings.get().gameplay
    expect(g.keyboard, '键鼠那半不许被半张载入顺手换掉').toEqual(liveKey)
    expect(g.padButtons, '手柄那半请回了盒里那一份').toEqual(defaultBindings().gameplay.padButtons)
    expect(r.input.binds.keyboard, '面板写的就是生效的那一份（消费者没有第二张表）').toEqual(liveKey)
    expect(gameCells(html(r.p), '闪避').join(' | '), '而屏上那一格读的是此刻生效那一份：手柄又握两把了，键盘那格不许被替玩家忘掉')
      .toBe('Y | A、十字上')
  })

  it('L7 回声点名那半张，三句各不相同，而默认那两句与 KI-362 时代逐字相同', () => {
    const r = rig(true)
    click(r.p, 'profchan', 'kb'); click(r.p, 'profstore', '0')
    const kbStore = r.notices.at(-1)!
    expect(kbStore, '存入那一句要说得出抄走了哪一半').toContain('只抄走键鼠那一半')
    click(r.p, 'profchan', 'pad'); click(r.p, 'profstore', '0')
    const padStore = r.notices.at(-1)!
    expect(padStore).toContain('只抄走手柄那一半')
    expect(padStore, '说手柄的那一句不许同时提键鼠：一句话说两半就是说整张').not.toContain('键鼠')
    click(r.p, 'profchan', 'both'); click(r.p, 'profstore', '0')
    expect(r.notices.at(-1)!, '回到默认那一句：逐字仍是 KI-362 那句').toBe('已覆盖配置文件 1')
    expect(kbStore, '两句各说一半 ⇒ 它们不是同一句话').not.toBe(padStore)
    click(r.p, 'profchan', 'kb'); click(r.p, 'profload', '0')
    expect(r.notices.at(-1)!, '载入那一句同样点名').toContain('只请回键鼠那一半')
    click(r.p, 'profchan', 'both'); click(r.p, 'profload', '0')
    expect(r.notices.at(-1)!).toBe('已载入配置文件 1')
  })

  it('L8 「清空」不受选择器管：请回空的仍是整盒，回声也不提那一半', () => {
    const r = rig(true)
    click(r.p, 'profchan', 'pad')
    click(r.p, 'profstore', '0')
    expect(profileRow(html(r.p), 0), '满盒那一行的注语要说得出「按上面那一枚」：停在「只手柄」时再说「抄走此刻那一张」就是不精确等于说反')
      .toContain('「载入」按上面那一枚')
    expect(r.bindings.profileFlags(), '存过之后那一格是满的（半盒就是一只满盒，不是第四种状态）').toEqual([true, false, false])
    click(r.p, 'profclear', '0')
    expect(r.bindings.profileFlags(), '按「清空」请回空的是整盒：选择器停在哪儿都不管').toEqual([false, false, false])
    expect(r.notices.at(-1), '回声不提那一半——那半种落点在这把上不存在').toBe('已清空配置文件 1')
    expect(profileRow(html(r.p), 0)).toContain('空')
    expect(chanSel(html(r.p)), '清完之后使用中那一枚仍留在原处：这一把不改选择器').toBe('pad')
  })

  it('L9 界外那一枚按下去什么都不改：使用中不动、落点仍是那半张、也不回声', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'profstore', '0')
    const boxPad0 = { ...(r.bindings.getProfiles()![0] as Bindings).gameplay.padButtons }
    click(r.p, 'profchan', 'kb')
    expect(chanSel(html(r.p)), '前提：先真的点到「只键鼠」').toBe('kb')
    click(r.p, 'profchan', 'gamepad')
    expect(chanSel(html(r.p)), '界外那一枚不改使用中那枚（`data-arg` 是字符串，DOM 那侧谁都能写）').toBe('kb')
    expect(r.notices.length, '也不替界外那枚编一句回声').toBe(1)
    click(r.p, 'armpad', 'jump'); padWith([12]); pump(r.p, r.input)
    click(r.p, 'profstore', '0')
    expect((r.bindings.getProfiles()![0] as Bindings).gameplay.padButtons,
      '而它的落点仍是「只键鼠」：那一次越界不许把整张偷偷换成半张的反面').toEqual(boxPad0)
  })

  it('L10 只用键盘走得到那三把，Enter 只换使用中那一枚', () => {
    const r = rig(true)
    for (const arg of ['both', 'kb', 'pad']) {
      const steps = walkTo(r.p, r.input, `data-act="profchan" data-arg="${arg}"`, 500)
      expect(focusTag(html(r.p)), `没走到「${arg}」那一枚（走了 ${steps} 步）`).toContain(`data-act="profchan" data-arg="${arg}"`)
    }
    // 上一圈正好停在「只手柄」那一枚上
    const flags = r.bindings.profileFlags().join(',')
    const notices = r.notices.length
    pump(r.p, r.input, ['confirm'])
    expect(chanSel(html(r.p)), 'Enter 与鼠标点击落在同一个 handler 上').toBe('pad')
    expect(r.notices.length, '按它不是存也不是取：没有回声').toBe(notices)
    expect(r.bindings.profileFlags().join(','), '也没有哪一盒被顺手写满或清空').toBe(flags)
  })

  it('L11 那一枚不进存档：盒里仍是两块，运行时那张表也没为它长出一格', () => {
    const r = rig(true)
    click(r.p, 'profchan', 'pad')
    click(r.p, 'profstore', '0')
    const box = r.bindings.getProfiles()![0] as Bindings
    expect(Object.keys(box).sort(), '那一盒还是两块：没有第三格住着「当初按的是哪一半」').toEqual(['gameplay', 'ui'])
    const tape = JSON.stringify(r.bindings.getProfiles())
    expect(tape, '磁带里没有通道这枚状态').not.toMatch(/profChan|profchan|channel/i)
    expect(Object.keys(r.bindings.get()).sort(), '运行时那张表也没长格子：它仍是玩法与菜单两块').toEqual(['gameplay', 'ui'])
  })

  it('L12 口径那一行说得出落点，而那句旧话不许留在面上', () => {
    const r = rig(true)
    const note = html(r.p).split('<div class="row">').find((s) => s.includes('口径')) ?? ''
    expect(note, '旧的那一句还在宣布「面板这一档两条通道仍一起存、一起取」——本批把它接上了，句子就得跟着改口')
      .not.toContain('面板这一档两条通道仍一起存、一起取')
    expect(note).toContain('存取哪一半')
    expect(note, '要说得出「这一按动的是整张还是那半张」（KI-367 还欠① 就是这一句）').toContain('动的是整张还是那半张')
    expect(note, '而「清空」不在这一枚的管辖里，句子要说全').toContain('「清空」不受它管')
    expect(note, '按档独立仍欠：不许顺手宣布完成').toContain('按档独立')
  })
})

/* ----------------------------------- KI-369 半张磁带在屏上有读数 */

/**
 * KI-369 的三条屏上腿。世界那一路的八条在 `tests/flow/bindings-remap.test.ts`，机制侧那两条在
 * `tests/unit/bindings-data.test.ts`；这三条量的是**玩家看得见的部分**：
 *  ① 一档里只写了一条通道 ⇒ 屏上那一行仍是「已存」、那一把「载入」仍点得动（「半盒」不是第四种存在感）；
 *  ② 按下去之后缺的那一半真的把玩家此刻那一半换掉了，而这件事在屏上那两行读数上有数（50%／50%）；
 *  ③ 屏上那枚「只键鼠／只手柄」（KI-368）是这一刀唯一的挡手——同一盒、同一行，按上那一枚再载入，两行读数一格不动。
 *
 * 这里用 `applyProfiles(raw)` 而不是走一次 `SaveGame`：那一步在 `clampProfiles` 之后交出的正是档里那一路
 * 交给 store 的东西，而世界那一路已经由 R1–R8 量过；把同一份 blob 再从这里递进去，量具不重复造证人。
 *
 * **预测**：C1 绿、C2 绿、**C3 红**——C3 要的那半句「口径」注语此刻还不存在，它是本批唯一一处落地
 * （文本，不改机制）。
 *
 * **跑完如实记差**：第一轮 **C1 红**（预测错），错的还是量具自己。它当时期望「三格里两格点不动」而读到三格都点不动，
 * 原因是这一节的三行只在**一次重绘**里现读 `profileFlags()`，而 `uiStep` 在意图为空时先 `return`——从测试里
 * 直接调 `applyProfiles` 不会换来一次重绘，于是 `html(r.p)` 交回的是注入之前的 DOM 旧快照，把它当读数就是量具替
 * 玩家编的那句「磁带还是空的」。**判据一个字没改**：改成点一次页签（玩家走到这一屏的同一把手）之后再取 DOM。
 * 这条差顺手量到一格真的事：面板开着时从别处换掉磁带，那一行不会自己改口——本批不接它，登记进还欠。
 * 第二轮 **C1 还红一次**，红的是同一句预测的第二半：我把「回到默认」抄成了「50%／50%」。扳机那条线恰好住在
 * 界的中点（0.5 在 0.05–0.95 之间 ⇒ 50%），菜单那条不是（0.6 在 0.25–0.9 之间 ⇒ 55%）——一个猜中的数与一个
 * 量出来的数在断言里长得一样，这就是抄常数的代价。改成先把默认那两份读数从屏上取下来（`dflt`），断言只比形状：
 * 「补的是默认」这句话从此不依赖任何写死的百分比。判据（比默认、不比此刻）没动。
 * C2 绿、C3 第一轮红（如预测）、落地那半句之后绿。
 */

/** 只写键盘那半的一盒：名字的主人仍是 `BIND_CHANNELS`，这里少列一个只会多缺一格，走的还是同一条路 */
const kbHalfPanel = (keyboard: Record<string, string>): Record<string, unknown> => ({
  gameplay: { keyboard, unbound: [] },
  ui: { keyboard: { Tab: 'back' }, unbound: [] }
})

describe('KI-369 半张的盒在屏上是「满的」：载入把缺的那一半换成默认，而那两行读数说得出这件事', () => {
  it('C1 那一行写「已存」、那一把点得动；按下去之后屏上那两行读数回到默认（缺的那半补的是默认，不是此刻）', () => {
    const r = rig(true)
    expect(r.bindings.rebind('jump', 'Pad0')?.moved, '取证前提：玩家此刻的手柄那半确实离了默认').toBe(true)
    // 「默认那一份」在屏上的读数由这一屏自己交出来：扳机那条线正好住在界的中点（50%），菜单那条不是——
    // 把两条都抄成 50% 等于用测试替玩家说了一个他没听过、也没量过的数。
    const dflt = [linePct(html(r.p), TRIG_LABEL), linePct(html(r.p), STICK_LABEL)]
    expect(dflt, '取证前提：默认那两份与玩家手里那两份要有距离，否则下面那句「回到默认」是空的')
      .not.toEqual(['80%', '80%'])
    for (let i = 0; i < 6; i++) click(r.p, 'tstep', 'triggerThreshold:1')
    for (let i = 0; i < 5; i++) click(r.p, 'ustep', 'stickThreshold:1')
    expect([linePct(html(r.p), TRIG_LABEL), linePct(html(r.p), STICK_LABEL)], '而两行读数跟着离了默认')
      .toEqual(['80%', '80%'])
    r.bindings.applyProfiles([kbHalfPanel({ KeyQ: 'dodge' }), null, null])
    // 取证：面板那三行只在一次重绘里现读 `profileFlags()`（`uiStep` 没有意图时先 return，泵一帧不画）。
    // 所以这里走玩家到这一屏的那同一条路——重新点一次页签；DOM 的旧快照不是一张磁带状态。
    click(r.p, 'tab', 'ops')
    const hBefore = html(r.p)
    expect((hBefore.match(/data-act="profload"[^>]*disabled/g) ?? []).length, '半张的盒在屏上是「满的」：只有另两格空着点不动（不是第四种存在感）')
      .toBe(PROFILE_SLOTS - 1)
    expect([linePct(hBefore, TRIG_LABEL), linePct(hBefore, STICK_LABEL)], '读档那一步不动现表：两行读数还停在玩家手里那一份')
      .toEqual(['80%', '80%'])
    click(r.p, 'profload', '0')
    const h = html(r.p)
    expect([linePct(h, TRIG_LABEL), linePct(h, STICK_LABEL)], '按下「载入」（默认那一枚 ＝ 两半一起）之后：两条线都换回默认那一份——不是 0%，不是玩家手里那一份，是这一屏一开始量到的那两个数')
      .toEqual(dflt)
    expect(r.input.binds.padButtons[0], '而玩法那一半也回了默认：玩家自己搬上去的那一把跳没了——这就是那句「改不掉」的代价').toBe('dodge')
    expect(r.input.binds.keyboard.KeyQ, '写过的那半照常进来').toBe('dodge')
  })

  it('C2 同一盒、同一行：屏上先点上「只键鼠」再载入 ⇒ 那两行读数与玩家那一半一个字都不动', () => {
    const r = rig(true)
    expect(r.bindings.rebind('jump', 'Pad0')?.moved, '取证前提：同上').toBe(true)
    for (let i = 0; i < 6; i++) click(r.p, 'tstep', 'triggerThreshold:1')
    for (let i = 0; i < 5; i++) click(r.p, 'ustep', 'stickThreshold:1')
    r.bindings.applyProfiles([kbHalfPanel({ KeyQ: 'dodge' }), null, null])
    click(r.p, 'profchan', 'kb')
    click(r.p, 'profload', '0')
    const h = html(r.p)
    expect([linePct(h, TRIG_LABEL), linePct(h, STICK_LABEL)], '那枚选择挡住的就是这一刀：两行读数一格没动').toEqual(['80%', '80%'])
    expect(r.input.binds.padButtons[0], '玩家那一半留着').toBe('jump')
    expect(r.input.binds.keyboard.KeyQ, '而写过的那半进得来：挡住的是缺的那一半，不是整盒').toBe('dodge')
  })

  it('C3 口径那一行第一次说得出半张在档上的读法：缺的那半是默认那一份，而挡得住它的只有那两枚', () => {
    const r = rig(true)
    const note = html(r.p).split('<div class="row">').find((s) => s.includes('口径')) ?? ''
    expect(note, '那半句在屏上（玩家看得见的一格，不是注释里的一句话）').toContain('缺的那半读成默认那一份')
    expect(note, '并且它说得出这是量到的，不是推出来的').toContain('KI-369')
    expect(note, '而「按档独立的配置文件还没接」那句旧话留着：本批没动那一格').toContain('按档独立的配置文件还没接')
    expect(note, '注语住在模板字符串里：反引号会截断它，星号会照原样画给玩家').not.toMatch(/[`*]/)
  })
})

/* ------------------------------------------------------------------ KI-384 */

/**
 * KI-384：§6 那一行的最后一格「连打」第一次有了屏上的落点。
 *
 * 这一格是**布尔**，所以它骑的是既有那把 `gtoggle` 把手——不新增 case、不新增 act 名，两枚开关共用一个分支。
 * 于是屏上这一节要问的三件事跟着变成：① 那一行画得出自己（行名、注语、读数与按钮文案各说各的）；
 * ② 点它一次 ⇒ store、玩家手里那一个字段、屏上读数三处同时翻（消费者不接的话面板就是在拧空气）；
 * ③ 两枚 toggle 各翻各的，而那枚把手**只认真布尔格**——`{ [arg]: !值 }` 若落到数值格上，写进去的是
 *   `false`，边界会把它当错型夹回**默认**：那不是「翻不动」，是「把别一格洗回默认」。这一条是本批的预测红，
 *   写下这条腿时 `gtoggle` 还没有那道名字闸门。
 *
 * 机制那一半在 `tests/flow/mash-guard.test.ts`，跟档那一半在 `tests/flow/settings-persistence.test.ts`。
 */

/** 开关行的行块（`name` + 注语 + 那一枚 `gtoggle` 按钮在同一个 `div` 里） */
const toggleRow = (h: string, key: string): string =>
  h.split('<div class="row">').find((s) => s.includes(`data-act="gtoggle" data-arg="${key}"`)) ?? ''

describe('KI-384 连打涨价那一行：一枚开关、三处一起翻、只认真布尔格', () => {
  it('那一行画得出自己：行名、界与语义都在注语里，默认读数是「开」而按钮写「关掉」', () => {
    const r = rig(true)
    const row = toggleRow(html(r.p), 'mashGuard')
    expect(row, '屏上根本没有这一行 ⇒ 玩家今天仍只能全盘接受涨价').toContain('连打涨价')
    expect(row, '注语要指得出那一格的界（§6 那一行）与它管的是哪两式').toContain('§6 那一格')
    expect(row, '并且要说得出关掉之后从哪儿起算——「底价」是 §7.2 那两行的词').toContain('底价')
    expect(row, '默认开＝今天的行为，起手读数就该是开').toContain('class="num">开<')
    expect(row, '按钮写的是它要做的那一下，不是当前状态').toContain('>关掉<')
    expect(r.gameplay.get().mashGuard, '屏上那个「开」读的就是 store 里那一格').toBe(DEFAULT_GAMEPLAY_SETTINGS.mashGuard)
  })

  it('点一下三处一起翻：store、玩家手里那一个字段、屏上读数；再点回来逐字还原', () => {
    const r = rig(true)
    click(r.p, 'gtoggle', 'mashGuard')
    expect(r.gameplay.get().mashGuard).toBe(false)
    expect(r.playerTarget.mashGuard, '第六路消费者不接的话，面板点的就是空气').toBe(false)
    const off = toggleRow(html(r.p), 'mashGuard')
    expect(off, '翻过去之后屏上要说得出「关」').toContain('class="num">关<')
    expect(off, '按钮也跟着改口成「打开」，不然玩家看不出自己按的是哪一下').toContain('>打开<')
    click(r.p, 'gtoggle', 'mashGuard')
    expect([r.gameplay.get().mashGuard, r.playerTarget.mashGuard], '再点回来：两处逐字还原').toEqual([true, true])
    expect(toggleRow(html(r.p), 'mashGuard')).toContain('class="num">开<')
  })

  it('两枚开关各翻各的：点连打不许动帧辅助，点帧辅助也不许动连打', () => {
    const r = rig(true)
    click(r.p, 'gtoggle', 'mashGuard')
    expect(r.gameplay.get().frameAssist, '共用一个 case 不等于共用一格').toBe(DEFAULT_GAMEPLAY_SETTINGS.frameAssist)
    expect(r.input.frameAssist, '而 Input 手里那一格同样没被带走').toBe(DEFAULT_GAMEPLAY_SETTINGS.frameAssist)
    click(r.p, 'gtoggle', 'frameAssist')
    expect(r.gameplay.get().mashGuard, '反方向也一样：帧辅助那一枚翻的是它自己').toBe(false)
    expect(r.playerTarget.mashGuard, '消费者手里也不许跟着翻').toBe(false)
    expect(r.input.frameAssist).toBe(true)
  })

  it('那一枚只认真布尔格：数值格与名册外的名字都翻不动，也不许把别格洗回默认', () => {
    const r = rig(true)
    click(r.p, 'gstep', 'bufferMs:1')
    click(r.p, 'gstep', 'holdMs:1')
    const before = r.gameplay.get()
    expect([before.bufferMs, before.holdMs], '"不动"要量得出，先得有两格动得起来（默认值会让洗回默认看不出来）').toEqual([220, 250])
    for (const arg of ['bufferMs', 'holdMs', 'shakeScale', 'mashGuardx', 'notMash', '']) {
      click(r.p, 'gtoggle', arg)
    }
    expect(r.gameplay.get(), '`!220` 写进数值格会被边界当错型夹回默认：那是洗格子，不是翻不动').toEqual(before)
    expect([r.playerTarget.holdMs, r.playerTarget.mashGuard], '消费者手里也不许被一个名册外的名字拧走').toEqual([250, true])
    expect(r.notices, '没写进任何一格就没有一句该响').toEqual([])
    expect(toggleRow(html(r.p), 'mashGuard'), '屏上那一行也不许被错名字点过之后改口').toContain('class="num">开<')
  })

  it('键盘那一路也点得动这一枚：走到那格、Enter 下去，玩家手里跟着翻', () => {
    const r = rig(true)
    const reached = walkTo(r.p, r.input, 'data-act="gtoggle" data-arg="mashGuard"', 400)
    expect(focusTag(html(r.p)), `没走到连打那一枚（走了 ${reached} 步）`).toContain('data-act="gtoggle" data-arg="mashGuard"')
    pump(r.p, r.input, ['confirm'])
    expect([r.gameplay.get().mashGuard, r.playerTarget.mashGuard], '手柄／键盘那一路落的也是同一格').toEqual([false, false])
    expect(r.input.frameAssist, '而 Enter 只点住了框住的那一枚').toBe(DEFAULT_GAMEPLAY_SETTINGS.frameAssist)
  })

  it('「口径」那一行把这一格也报进「不跟着盒走」那一份：漏一格就是给玩家留一处假读数', () => {
    const r = rig(true)
    const note = html(r.p).split('<div class="row">').find((s) => s.includes('口径')) ?? ''
    expect(note, '那一行点名的是「这一节上面那几格」，第九格的名字要在里面').toContain('Y 反转')
    expect(note, '而格数那一句也跟着改口：数还写八，新接的那一格就从读数面上被抹掉了').toContain('那九格数值')
    expect(note, '注语住在模板字符串里：反引号会截断它，星号会照原样画给玩家').not.toMatch(/[`*]/)
  })
})

/* ------------------------------------------------------------------ KI-385 */

/**
 * KI-385：面板开着时，**别人**动了一格，那一屏要自己改口。
 *
 * **病**（不是崩溃，是一屏停在昨天的字）：这一屏的重绘今天有 20 处落点、11 个方法，逐处数过去全部挂在
 * 「玩家自己那一下」上（点把手／走格子／武装与撤等待／确认与落盘），唯一一条不挂在手上的那条是
 * `refreshSaves` 里那一次异步回来补画——而它补的只有存档那一页。于是 `uiStep` 在意图为空时先 `return`
 * 的那一帧起，屏上那些**主人不在面板手里**的读数（此刻生效那两张表、那八格、那三盒、页眉页脚那五格 `rpg` 的数）
 * 再也不会被重画。KI-369 的 C1 第一轮红就是撞见这一格的（那行注语现在还写着「泵一帧不画」），当时登记进还欠⑤。
 *
 * **裁决的形状**（一句话，不新增把手）：改口的判据是**「此刻要画的那一整块字」与「屏幕上那一块字」是否不同**，
 * 而不是「谁改了」——比较的覆盖面天生等于画出去的那些字，所以不必给任何一个主人加版本计数
 * （版本是可以被某一条写方忘掉的，忘了就又停在昨天），也不必给那两个 store 加新的读格（端口名册一格不长）。
 * 拼那块字是既有那一句（`render` 本来每次整块重排），本批改的只是**多问一次**：意图为空那一帧也问；
 * 字没变就一个 DOM 写都不许有；面板没开着就一个字都不拼。
 *
 * **预测（跑之前写死）**：先红 7 条＝PL1／PL2／PL3／PL4／PL6／PL8／PL9（这七条要的就是「没人按也改口」，
 * 今天那条路不存在）；其余 6 条是边界与成本，**本来就绿**、落地后必须还绿＝PL5（无事发生零写）／
 * PL7（关着不拼、重开画此刻）／PL10（改口不替玩家做事）／PL11（存档那一页读的仍是名册缓存——本批不声称它也活了）／
 * PL12（源码门：不许长出版本计数）／PL13（换到别的一页时，那一页根本不画的读数不许惹来一次重画）。
 *
 * **PL14 是机制落地之后补的一条**（如实分开写，不冒充第一批预测）：它是在量完 `compose()` 的成本之后
 * 才长出来的读数面——「拼字的次数」本身。前半（关着一帧零拼）今天已由 `uiStep` 门口那句 `if (!this.open) return`
 * 担保，量的是「这笔钱根本没花出去」；后半（开着每帧恰好一拼）要的仍是「没人按也问一次」，所以它**与那七条同族、
 * 也是先红**，只是这一格不必回到机制之前重放：A1／A2 那一臂把「多问一次」拆掉，十帧只拼 0 次，先红在臂里现量。
 */

/** 操作那一屏上「那一行的数」：`num` 里那一段文本，格名用 `data-arg` 找，不抄行序 */
const gnum = (h: string, key: string): string =>
  (h.split('<div class="row">').find((s) => s.includes(`data-arg="${key}:-1"`)) ?? '').match(/class="num">([^<]*)</)?.[1] ?? ''

/** 页眉那一格（音级／遗响／未分配三样都住在同一个 `span.sub` 里）与页脚那三格（各是一个 `span`） */
const subCell = (h: string): string => (h.match(/<span class="sub">([^<]*)</) ?? ['', ''])[1]
const footNum = (h: string, label: string): string => (h.match(new RegExp(`${label} (\\d+)`)) ?? ['', ''])[1]

describe('KI-385 外部动了一格而玩家一帧都没按：那一屏第一次自己改口', () => {
  it('PL1 别人改了键位那张表 ⇒ 那一行的键名在下一次泵就改口（不点页签、不按把手）', () => {
    const r = rig(true)
    expect(gameRow(html(r.p), 'parry'), '取证前提：画的是默认那一把').toContain('class="num">G<')
    r.bindings.rebind('parry', 'KeyT')
    pump(r.p, r.input)
    expect(gameRow(html(r.p), 'parry'), '表已经换了键而屏上还说旧键：那一行是昨天那块字')
      .toContain(`class="num">${codeLabel('KeyT')}<`)
  })

  it('PL2 别人动了玩法那一格 ⇒ 开关那两个字与数那一格一起改口', () => {
    const r = rig(true)
    expect(toggleRow(html(r.p), 'mashGuard')).toContain('class="num">开<')
    r.gameplay.set({ mashGuard: false })
    pump(r.p, r.input)
    expect(toggleRow(html(r.p), 'mashGuard'), '另一双手关掉的连打，屏上不许还写「开」——那是替玩家说了一句假话')
      .toContain('class="num">关<')
    r.gameplay.set({ bufferMs: GAMEPLAY_BOUNDS.bufferMs.min })
    pump(r.p, r.input)
    expect(gnum(html(r.p), 'bufferMs'), '数那一格读的仍是 store 里此刻那个数，不是面板抄下的上一次')
      .toContain(String(r.gameplay.get().bufferMs))
  })

  it('PL3 别人换了磁带 ⇒「已存／空」与那一把「载入」点不点得动一起改口（KI-369 还欠⑤ 在这一格结案）', () => {
    const r = rig(true)
    expect(profileRow(html(r.p), 0), '取证前提：起手三盒全空').toContain('class="num">空<')
    expect(r.bindings.storeProfile(0), '从另一双手存进第一盒').toBe('new')
    pump(r.p, r.input)
    const row = profileRow(html(r.p), 0)
    expect(row, '那一行还写「空」就是量具替玩家编的一句磁带状态').toContain('class="num">已存<')
    expect(row, '而「载入」跟着从点不动变成点得动：一屏两说是这一格的另一半')
      .not.toMatch(/data-act="profload"[^>]*disabled/)
    expect(r.bindings.clearProfile(0)).toBe(true)
    pump(r.p, r.input)
    expect(profileRow(html(r.p), 0), '清空那一次同样自己改口回来').toContain('class="num">空<')
  })

  it('PL4 世界给的东西落在页眉与页脚那五格上：开着的那一屏也跟着改口（壳也是屏）', () => {
    const r = rig(true)
    expect(subCell(html(r.p)), '取证前提：页眉那两格今天画的是 prog 里的数')
      .toContain(`遗响 ${r.rpg.prog.xp}`)
    r.rpg.prog.addResonance(999)
    r.rpg.inv.add(TIMBITE, 2)
    pump(r.p, r.input)
    const h = html(r.p)
    expect(subCell(h), '页眉那一句说的是 prog 此刻的数——它比正文更早被玩家看见，却和正文同一条重绘路')
      .toContain(`遗响 ${r.rpg.prog.xp}`)
    expect(footNum(h, '音色石'), '页脚那一格也是屏上的读数：包里多了两枚而屏上还写旧数，就是假读数')
      .toBe(String(r.rpg.inv.count(TIMBITE)))
  })

  it('PL5 没有任何一件事变：连泵 30 帧，屏幕上那块字一个 DOM 写都不许有', () => {
    const r = rig(true)
    const w = domWrites(r.p)
    w.count()
    for (let i = 0; i < 30; i++) pump(r.p, r.input)
    expect(w.n(), '「改口」不许变成「每帧重排整屏」：字没变就一个字都不写')
      .toBe(0)
  })

  it('PL6 变一次只画一次：外部改一格之后连泵 5 帧，那块字只写一次', () => {
    const r = rig(true)
    const w = domWrites(r.p)
    w.count()
    r.bindings.rebind('parry', 'KeyT')
    for (let i = 0; i < 5; i++) pump(r.p, r.input)
    expect(w.n(), '零次是停在昨天，五次是每帧重排——判据是「字不同才写」，所以答案只能是一次')
      .toBe(1)
    expect(gameRow(html(r.p), 'parry')).toContain('class="num">T<')
  })

  it('PL7 面板没开着：一个字都不拼；重新打开那一次画的是此刻那张表', () => {
    const r = rig(true)
    r.p.close()
    const w = domWrites(r.p)
    w.count()
    r.bindings.rebind('parry', 'KeyT')
    for (let i = 0; i < 4; i++) pump(r.p, r.input)
    expect(w.n(), '关着的那一屏没有玩家在看，改口的钱一分都不许花').toBe(0)
    r.p.show()
    expect(w.n(), '打开那一次是一次正经重绘：不是每帧偷偷重排').toBe(1)
    expect(gameRow(html(r.p), 'parry'), '而它画的是此刻的表，不是收起之前那一块旧字').toContain('class="num">T<')
  })

  it('PL8 等键途中别人改了别行：那一行改口，而这一行的等待一个字不被冲掉', () => {
    const r = rig(true)
    click(r.p, 'arm', 'parry')
    expect(html(r.p), '取证前提：武装的是弹反那一行').toContain('等待中')
    r.bindings.rebind('dodge', 'KeyT')
    pump(r.p, r.input)
    const h = html(r.p)
    expect(gameRow(h, 'dodge'), '等待挡住的是意图，不该挡住「这一屏要说真话」').toContain('class="num">T<')
    expect(h, '而等待不许被这次改口冲掉：那一行还在等它那一枚键').toContain('等待中')
    key('KeyY')
    pump(r.p, r.input)
    expect([r.input.binds.keyboard.KeyY, r.input.binds.keyboard.KeyT], '后来那一枚键仍绑进武装那一行')
      .toEqual(['parry', 'dodge'])
  })

  it('PL9 改口不许把焦点框挪走：走过格子之后别人改一格，重画之后框还圈在同一格', () => {
    const r = rig(true)
    const steps = walkTo(r.p, r.input, 'data-act="arm" data-arg="parry"', 400)
    expect(focusTag(html(r.p)), `取证前提：框要落在弹反那一格（走了 ${steps} 步）`).toContain('data-act="arm" data-arg="parry"')
    const before = focusTag(html(r.p))
    r.bindings.rebind('dodge', 'KeyT')
    pump(r.p, r.input)
    expect(gameRow(html(r.p), 'dodge'), '先要真的改口了，这条腿量到的才是「改口而不丢框」').toContain('class="num">T<')
    expect(focusTag(html(r.p)), '整块重排是既有的做法，焦点行号也一样交回面板手里那一个数——改口不该把玩家退回第一格')
      .toBe(before)
  })

  it('PL10 改口不替玩家按任何东西：零回声，也不回写另一个 store', () => {
    const r = rig(true)
    const settings = r.gameplay.get()
    r.bindings.rebind('parry', 'KeyT')
    for (let i = 0; i < 3; i++) pump(r.p, r.input)
    expect(r.notices, '那一屏自己改了口，玩家没听见任何一句：回声只跟着落点走，不跟着重绘走').toEqual([])
    expect(r.gameplay.get(), '重画只读，不许顺手把另一份档写回去').toEqual(settings)
  })

  it('PL11 存档那一页读的是面板手里那份名册缓存：本批不声称它也活了（外部多了档案，那一屏不自己改口）', () => {
    const roster: SlotCard[] = []
    const r = rig(true, false, { list: async () => roster.slice(), write: async () => null, erase: async () => false })
    click(r.p, 'tab', 'save')
    expect(html(r.p), '取证前提：名册为空时那一页说的是「名册还在读…」')
      .toContain('名册还在读')
    const w = domWrites(r.p)
    w.count()
    roster.push({ slot: 'slot1', kind: 'manual', state: 'empty', schemaVersion: null, migrated: false, fromKey: null, problem: null, data: null })
    for (let i = 0; i < 3; i++) pump(r.p, r.input)
    expect(w.n(), '那三行的字来自缓存，缓存的刷新只有一个入口（异步名册回来那一次）——比较字面不许假装这一页也活了')
      .toBe(0)
    expect(html(r.p), '所以刚多出来的那一档此刻还画不出来：这是本批明写的不声称').not.toContain('空的')
    click(r.p, 'tab', 'ops')
    click(r.p, 'tab', 'save')
    return Promise.resolve().then(() => expect(html(r.p), '走回那一页才过一次异步名册：那条路一格没变').toContain('空的'))
  })

  it('PL12 源码门：改口的判据是「字不同」，那一屏里不许长出版本计数那一格', () => {
    const src = readFileSync(fileURLToPath(new URL('../../src/ui/Stakerite.ts', import.meta.url)), 'utf8')
    expect(src, '面板里不许出现「谁改了」那一份第二真相：版本／脏标记／epoch 全都不许有').not.toMatch(/\b(version|revision|epoch|dirtyFlag|dirty)\b/)
    expect(src, '比较的是拼出来的那块字（拼那块字的函数与写 DOM 的函数必须分成两个，否则每帧都要写一次才能问）')
      .toMatch(/lastHtml/)
    expect(src.match(/this\.render\(\)/g) ?? [], '重绘落点的总数是本批改过的一格：数一变这条腿就要人重读一遍').toHaveLength(21)
  })

  it('PL13 停在别的一页时，那一页根本不画的读数不许惹来一次重画：改口的覆盖面就是此刻那一屏的字', () => {
    const r = rig(true, false)
    expect(html(r.p), '取证前提：这一屏是「调音」，磁带那三行不在这里')
      .not.toContain('data-act="profstore"')
    const w = domWrites(r.p)
    w.count()
    r.bindings.storeProfile(0)
    r.gameplay.set({ bufferMs: 300 })
    for (let i = 0; i < 3; i++) pump(r.p, r.input)
    expect(w.n(), '换主人不该换出一次重排：那一屏没有一格读它们').toBe(0)
    click(r.p, 'tab', 'ops')
    expect(profileRow(html(r.p), 0), '而走到画它们的那一页，字是此刻的（那是既有的 setTab，不是本批新增的路）')
      .toContain('class="num">已存<')
  })

  it('PL14 拼字那一步的次数本身也是读数：关着一帧都不拼，开着每帧恰好拼一次', () => {
    const r = rig(true)
    const host = r.p as unknown as { compose: () => string }
    const real = host.compose.bind(host)
    let calls = 0
    host.compose = (): string => { calls++; return real() }
    r.p.close()
    calls = 0
    for (let i = 0; i < 60; i++) pump(r.p, r.input)
    expect(calls, '「关着零写」不等于「关着零拼」：这一格量的是那笔钱根本没花出去').toBe(0)
    r.p.show()
    calls = 0
    for (let i = 0; i < 10; i++) pump(r.p, r.input)
    expect(calls, '开着而没人按：一帧恰好问一次。两次就是同一帧把那块字拼两遍——本批加的是「多问一次」，不是「多问几次」').toBe(10)
  })
})

/**
 * KI-389：玩法那一行的「暂停」今天画着两把点得动、点了会谎称已解绑的把手。
 *
 * 屏上这一格是三处读者里最容易被当成装饰的那一处——把手不画，玩家就点不到，看起来与"边界拒了"
 * 是同一个结果。但它不是同一件事：`run` 那道闸门只挡 `disabled`，`data-arg` 是 DOM 里谁都能写的字符串，
 * 硬点得到；而面板那句回执今天无论如何都说「已解绑」。菜单那条通道（KI-344／KI-346）为此立过的形状是
 * **名册算 locked ⇒ 两把把手都不画 ⇒ 被硬点到时答得出「关不掉」**，本批把它对称过来，
 * 并把 `unbind` 从 void 改成回答得出拒绝的那一个（现量：全仓 23 处调用没有一处读返回值，也没有一条腿钉它的 undefined）。
 */
describe('KI-389 玩法那一行「暂停」关不掉：两把把手都不画，硬点答「关不掉」', () => {
  it('那一行两把「解绑」都不画，note 说的是同一句话，而那一行仍改得动', () => {
    padWith(null)
    const r = rig(true)
    const row = gameRow(html(r.p), 'pause')
    expect(row, '量具前提：那一行确实在屏上（`data-act="arm"` 找不到的话下面的 not.toContain 全是空转）').not.toBe('')
    expect(row, '关不掉的行不许留一把点了谎称已解绑的把手').not.toContain('data-act="unbind" data-arg="pause"')
    expect(row, '手柄那一半同一条话：「停得下来」不是键盘那半的事').not.toContain('data-act="unbindpad" data-arg="pause"')
    expect(row, '换成说实话的那一句，而不是留一个好看的「无」蒙过去').toContain('不许关掉：世界必须停得下来')
    expect(row, '锁的是进「无」名单这一格，不是整行：改键那两把照在').toContain('data-act="arm" data-arg="pause"')
    expect(row).toContain('data-act="armpad" data-arg="pause"')
  })

  it('硬点那一行的两把「解绑」都答「关不掉」：一格没动、名单不进、页脚不许谎称已解绑', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'unbind', 'pause')
    expect(r.bindings.get().gameplay.unbound, '「世界必须停得下来」不只管屏幕上看不看得到按钮').toEqual([])
    expect(r.bindings.get().gameplay.keyboard, '一格都没动').toEqual(DEFAULT_BINDS.keyboard)
    expect(r.notices.at(-1), '谎称"已解绑"会让玩家去按一把根本没绑的键').toContain('关不掉')
    click(r.p, 'unbindpad', 'pause')
    expect(r.bindings.get().gameplay.padUnbound, '两列各写各的名单，而那句拒绝读的是同一份名册').toEqual([])
    expect(r.bindings.get().gameplay.padButtons, '手柄那一列也一格没动').toEqual(DEFAULT_BINDS.padButtons)
    expect(r.notices.at(-1)).toContain('关不掉')
    expect(r.notices.at(-1), '不许把"关不掉"说成"在菜单里解绑了"那类串道的措辞').not.toContain('解绑（')
  })

  it('「不许关掉」这句话在屏上只出现在出口那几行：出现次数＝名册长度（多一处就是面板自己数了一遍）', () => {
    padWith(null)
    const h = html(rig(true).p)
    expect((h.match(/不许关掉：世界必须停得下来/g) ?? []).length, '这句话的主人还是那份名册，面板只把它画出来').toBe(exitRoster().length)
    expect((h.match(/不许关掉：菜单必须走得出去/g) ?? []).length, '菜单那一节那句照旧一处，两份名册不合并').toBe(UI_EXIT_INTENTS.length)
  })

  it('别的行不受牵连：解绑 dodge 仍是两半同向，页脚仍说"已解绑"', () => {
    padWith(null)
    const r = rig(true)
    click(r.p, 'unbind', 'dodge')
    expect(r.bindings.get().gameplay.unbound, '名册只锁它点名的那一格，不是把整张表锁死').toEqual(['dodge'])
    expect(r.notices.at(-1)).toContain('解绑')
    expect(gameRow(html(r.p), 'dodge'), '关掉之后那一行的出口换成「回默认」').toContain('data-act="resetkey" data-arg="dodge"')
  })
})

describe('画质档位那一行（Phase 7 F2 UI）：◀▶ 循环四档，夹取在边界', () => {
  /** 与顶层 `rig()` 同形，但把 quality store 暴露出来——这一组问的正是那一格 */
  function qualityRig(): { p: Stakerite; quality: QualityStore; notices: string[] } {
    const inputEl = new FakeEl()
    const input = new Input(inputEl as unknown as HTMLElement)
    const bindings = new BindingsStore({ input })
    const gameplay = new GameplaySettingsStore({ input, rig: { shakeIntensity: 1 }, haptics: { scale: 1, weakScale: 1 }, combat: { damageScale: 1 }, player: { holdMs: 0, mashGuard: false } })
    const quality = new QualityStore({ particles: { spawnMul: 1 }, renderer: { resolutionScale: 1, shadowMapSize: 1536 } })
    const rpg = new RpgRuntime('origin_tuner')
    const notices: string[] = []
    const p = new Stakerite(
      rpg,
      { onApply: () => {}, notify: (m) => notices.push(m), onUse: () => {}, onRequestClose: () => {} },
      NO_SAVES,
      input,
      makeOpsHandles(input, () => bindings, () => gameplay, () => quality, () => 95.58),
    )
    p.show()
    click(p, 'tab', 'ops')
    return { p, quality, notices }
  }

  it('「操作」页里有「画质档位」这一行，读数是 QUALITY_NAMES 的唯一主人', () => {
    const { p } = qualityRig()
    const h = html(p)
    expect(h, '标签只有一个主人').toContain('画质档位')
    expect(h, '默认档 2（高）').toContain('高') // QUALITY_NAMES[2]
    expect(h, '◀▶ 按钮都在').toContain('data-act="qstep" data-arg="-1"')
    expect(h, '◀▶ 按钮都在').toContain('data-act="qstep" data-arg="1"')
  })

  it('▶ 循环四档（2→3→0→1→2 回绕），夹取由 QualityStore 边界做', () => {
    const { p, quality } = qualityRig()
    expect(quality.get()).toBe(2)
    click(p, 'qstep', '1') // 高 → 极高
    expect(quality.get()).toBe(3)
    click(p, 'qstep', '1') // 极高 → 低（回绕）
    expect(quality.get()).toBe(0)
    click(p, 'qstep', '-1') // 低 → 极高（回绕回去）
    expect(quality.get()).toBe(3)
    click(p, 'qstep', '-1') // 极高 → 高
    expect(quality.get()).toBe(2)
    click(p, 'qstep', '-1') // 高 → 中
    expect(quality.get()).toBe(1)
    click(p, 'qstep', '1') // 中 → 高
    expect(quality.get()).toBe(2)
  })

  it('切换后重渲染，面板画出新的档位名（画质档位行真的跟 store 走）', () => {
    const { p, quality } = qualityRig()
    expect(html(p)).toContain('高')
    click(p, 'qstep', '1') // 2 → 3
    expect(quality.get()).toBe(3)
    expect(html(p), '画出极高').toContain('极高')
  })

  it('界外 arg 静默原样（不落到别的格子里去）', () => {
    const { p, quality } = qualityRig()
    click(p, 'qstep', 'bogus') // NaN ⇒ 不动
    expect(quality.get()).toBe(2)
    click(p, 'qstep', '2') // 只认 ±1（Number.sign(2) 也不是 0 —— 向上是 +1）
    expect(quality.get()).toBe(3) // sign(2)=1 ⇒ 高 → 极高
  })

  it('外部 set() 后面板点击按实时读数循环（证明面板不缓存档位）', () => {
    const { p, quality } = qualityRig()
    quality.set(3) // 外部换成极高
    click(p, 'qstep', '1') // 3 → 0（回绕）
    expect(quality.get()).toBe(0)
  })
})
