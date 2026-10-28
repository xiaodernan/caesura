import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { BINDABLE_ACTIONS, DEFAULT_BINDS, Input, type ActionName, type UiIntent } from '@/core/Input'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { StreamingSystem } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import { RpgRuntime } from '@/rpg/Runtime'
import { Stakerite, type SavePanelDeps } from '@/ui/Stakerite'
import type { SlotCard } from '@/save/Slots'
import { MapStore, SaveGame } from '@/save/Serializer'
import { BindingsStore, defaultBindings } from '@/settings/Bindings'
import { DEFAULT_GAMEPLAY_SETTINGS, GAMEPLAY_BOUNDS, GameplaySettingsStore } from '@/settings/GameplaySettings'
import { actionLabel } from '@/ui/actionLabels'
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
  requestPointerLock(): void { /* 无头，不锁 */ }
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

/** 世界那一侧的泵：`main.ts` 每帧做的就是这两行 */
function pump(p: Stakerite, input: Input, intents: UiIntent[] = []): void {
  input.poll(TICK_DT)
  p.uiStep(new Set<UiIntent>([...input.uiEdges, ...intents]))
}

/** 焦点框当前圈住的那一格（`markFocus` 把 ` focus` 追加进 class） */
const focusTag = (h: string): string => (h.match(/<button\b[^>]*class="[^"]*focus[^"]*"[^>]*>/) ?? [''])[0]

interface Rig { p: Stakerite; input: Input; bindings: BindingsStore; gameplay: GameplaySettingsStore; notices: string[] }

/** 一块接好把手的面板：两个 store 都灌了真实消费者（`Input` 与三个假件），面板拿到的仍是那六个闭包 */
function rig(withOps = true, onOpsTab = true): Rig {
  const input = new Input(new FakeEl() as unknown as HTMLElement)
  const bindings = new BindingsStore({ input })
  const gameplay = new GameplaySettingsStore({ input, rig: { shakeIntensity: 1 }, haptics: { scale: 1 }, combat: { damageScale: 1 } })
  const notices: string[] = []
  const p = new Stakerite(new RpgRuntime('origin_tuner'),
    { onApply: () => {}, notify: (m) => notices.push(m), onUse: () => {}, onRequestClose: () => {} },
    NO_SAVES, input, withOps ? makeOpsHandles(input, () => bindings, () => gameplay) : null)
  p.show()
  if (onOpsTab) click(p, 'tab', 'ops')
  return { p, input, bindings, gameplay, notices }
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
    expect(html(r.p), '页脚要说清在等什么，以及怎么退').toContain('等待一枚键 · 闪避')
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
    for (let i = 0; i < 6; i++) pump(r.p, r.input, ['down'])
    expect(focusTag(html(r.p)), '焦点框要落在某个可执行行上').toContain('data-act="arm"')
    const target = (focusTag(html(r.p)).match(/data-arg="(\w+)"/) ?? [])[1] as ActionName
    pump(r.p, r.input, ['confirm'])
    expect(html(r.p), 'Enter 与鼠标点击落在同一个 handler 上').toContain(`等待一枚键 · ${actionLabel(target)}`)
    key('KeyY'); pump(r.p, r.input)
    expect(r.bindings.get().gameplay.keyboard.KeyY, `${target} 真的绑上了`).toBe(target)
  })

  it('到端点的 ◀ 写成 disabled，而 Enter 不许绕过它（键盘那条没人替玩家挡）', () => {
    const r = rig(true)
    for (let i = 0; i < 30; i++) click(r.p, 'gstep', 'bufferMs:-1')
    expect(r.gameplay.get().bufferMs, '界由 GAMEPLAY_BOUNDS 说：鼠标按到底也越不出去').toBe(GAMEPLAY_BOUNDS.bufferMs.min)
    expect(html(r.p)).toMatch(/data-act="gstep" data-arg="bufferMs:-1" disabled/)
    for (let i = 0; i < 80 && !focusTag(html(r.p)).includes('bufferMs:-1'); i++) pump(r.p, r.input, ['down'])
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

/* ------------------------------------------------------------------ 存档那半边 */

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
  const gameplay = new GameplaySettingsStore({ input, rig: { shakeIntensity: 1 }, haptics: { scale: 1 }, combat: { damageScale: 1 } })
  const p = new Stakerite(rpg,
    { onApply: () => {}, notify: () => {}, onUse: () => {}, onRequestClose: () => {} },
    NO_SAVES, input, makeOpsHandles(input, () => bindings, () => gameplay))
  p.show()
  const saves = new SaveGame({
    player, streaming, spawner, clock, time, rpg, audio: makeFakeAudio(),
    bindings: { get: () => bindings.get(), apply: (raw: unknown): void => bindings.restore(raw) },
    gameplay: { get: () => gameplay.get(), apply: (raw: unknown): void => gameplay.restore(raw) }
  }, store)
  return { p, input, bindings, gameplay, saves }
}
