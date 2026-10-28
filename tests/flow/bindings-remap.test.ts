import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { BINDABLE_ACTIONS, DEFAULT_BINDS, Input, UI_BINDS, type ActionName } from '@/core/Input'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { StreamingSystem } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import { RpgRuntime } from '@/rpg/Runtime'
import { Hud } from '@/ui/Hud'
import { Stakerite, type SavePanelDeps } from '@/ui/Stakerite'
import type { SlotCard } from '@/save/Slots'
import { MapStore, SAVE_VERSION, SaveGame, migrateV13toV14 } from '@/save/Serializer'
import { wrap } from '@/save/Integrity'
import { BindingsStore, clampBindings } from '@/settings/Bindings'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * KI-336 第二腿：键位表变成数据**之后跑到场上**的样子。
 * 形状与信任边界在 `tests/unit/bindings-data.test.ts`；这里只量三件 unit 量不到的事：
 *  ① `Input` 手里那张表真的被换掉（改完之后按新键打得出新动作，老键不再打得动）；
 *  ② 屏幕不说谎——HUD 的键位列与调音桩的槽位标签读的是**运行时**那一张，不是 `DEFAULT_BINDS`；
 *  ③ 跟档走：save→新世界 load 之后键位复原，且老档（v13 及更早，没有这块）一格都不动（§78）。
 *
 * ②是本批全部理由所在：`Stakerite` 的注释早就写着「改键之后面板不会说谎」，而它此前读的是常量表——
 * 那句话是一张开空头支票。现在它由一条用例量出来，不由注释担保。
 */

registerGameData()

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
  /** 点击测试用：把事件目标伪装成某个 [data-act] 元素（与 tests/unit/stakerite 的替身同形） */
  closest(): FakeEl | null { return this.dataset.act ? this : null }
  requestPointerLock(): void { /* 无头，不锁 */ }
}

const rootOf = (p: unknown): FakeEl => (p as { root: FakeEl }).root
function click(root: FakeEl, act: string, arg = ''): void {
  const el = new FakeEl()
  el.dataset = { act, arg }
  root.dispatch('click', { target: el })
}

let win: Record<string, ((e: unknown) => void)[]> = {}

/** 可编程手柄：四根轴 + 17 个按钮（`Input` 只用 `navigator.getGamepads`） */
function fakePad(axes: number[] = [0, 0, 0, 0], pressed: number[] = []): void {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      getGamepads: () => [{
        axes,
        buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
        mapping: 'standard', connected: true,
      }],
    },
  })
}

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
  fakePad()
})

beforeEach(() => {
  fakePad()
  // 每条用例从"上一只 Input 的监听器全部摘掉"开始：假 window 在整个文件里是同一只，
  // 不清的话上一条那个仍然会替这一条把键读走（与 tests/unit/ui-intents 同一条纪律）
  for (const k of Object.keys(win)) delete win[k]
})

/** 往 window 上推一次键（`Input` 的键盘监听挂在 window） */
function key(code: string, up = false): void {
  const e = { code, repeat: false, preventDefault: (): void => {} }
  for (const fn of win[up ? 'keyup' : 'keydown'] ?? []) fn(e)
}

const edges = (input: Input): string[] => [...input.frame.edges].sort()
const uiEdges = (input: Input): string[] => [...input.uiEdges].sort()

/** `Input` 与 `BindingsStore` 的接线就是 main.ts 那一行；测试里不另立第二种接法 */
function rig(): { input: Input; store: BindingsStore } {
  const input = new Input(new FakeEl() as unknown as HTMLElement)
  return { input, store: new BindingsStore({ input }) }
}

/* ---------------------------------------------------------------- ① 运行时换表 */

describe('KI-336 运行时换表：Input 读的是手里那一张，不是常量那一张', () => {
  it('`{KeyQ:\'dodge\'}` 之后：按 Q 打得闪避、按 Ctrl 打得锁定（一次交换，两把都还能玩）', () => {
    const { input, store } = rig()
    expect(input.binds.keyboard.KeyQ, '起手是默认表').toBe('lockOn')
    store.set({ gameplay: { keyboard: { KeyQ: 'dodge' } } })
    key('KeyQ'); input.poll(TICK_DT)
    expect(edges(input), 'Q 这一格现在的主人是闪避').toEqual(['dodge'])
    key('KeyQ', true); input.poll(TICK_DT)
    key('ControlLeft'); input.poll(TICK_DT)
    expect(edges(input), 'Ctrl 接过了 lockOn——交换的另一半').toEqual(['lockOn'])
  })

  it('换表那一拍不留鬼键：仍然按着的 Ctrl 不会变成"刚按下 lockOn"', () => {
    // KI-061 那个形状的复发测试：换表若把旧 held 留在 prev 里，下一帧就是一个白送的边沿
    const { input, store } = rig()
    key('ControlLeft'); input.poll(TICK_DT)
    expect(input.frame.held).toContain('dodge')
    store.set({ gameplay: { keyboard: { KeyQ: 'dodge' } } })   // Ctrl 在新表上是 lockOn
    input.poll(TICK_DT)
    expect(edges(input), '换表那一帧不许有任何边沿').toEqual([])
    expect([...input.frame.held], '旧表留下的 held 归零；没收到新 keydown 就不算按下').toEqual([])
    key('ControlLeft'); input.poll(TICK_DT)
    expect(edges(input), '松开重按之后新表照常').toEqual(['lockOn'])
  })

  it('手柄那张也换：0 号键改跳之后不再闪避，十字键下真的通到闪避', () => {
    const { input, store } = rig()
    fakePad([0, 0, 0, 0], [0])
    input.poll(TICK_DT)
    expect(edges(input), '默认 0 = dodge').toEqual(['dodge'])
    store.set({ gameplay: { padButtons: { 0: 'jump', 12: 'dodge' } } })
    input.poll(TICK_DT)
    expect(edges(input), '同一颗物理键现在指 jump').toEqual(['jump'])
    fakePad([0, 0, 0, 0], [12])
    input.poll(TICK_DT)
    expect(edges(input), '十字键下 = 闪避这条新路真的通').toEqual(['dodge'])
  })

  it('摇杆轴换根传感器：改过之后走路读新轴，旧轴推到底也不再动', () => {
    const { input, store } = rig()
    store.set({ gameplay: { padAxes: { moveX: 6, moveY: 7, camX: 2, camY: 3 } } })
    fakePad([0, 0, 0, 0, 0, 0, 0, 0.9])
    input.poll(TICK_DT)
    expect(input.frame.move.y, '新表 moveY=7 ⇒ 7 号轴推到 -0.9 就是前进').toBeCloseTo(-0.9, 6)
    fakePad([0, -0.9, 0, 0])
    input.poll(TICK_DT)
    expect(input.frame.move.y, '旧的 1 号轴现在没人读')
      .toBeCloseTo(0, 6)
  })

  it('菜单那条同样活：back 整组换成 Z 之后 Tab 不再后退，而 confirm 的四把等价键回来', () => {
    const { input, store } = rig()
    input.uiOwner = 'panel'
    store.set({ ui: { keyboard: { KeyZ: 'back' } } })
    key('KeyZ'); input.poll(TICK_DT)
    expect(uiEdges(input), '新键真的算后退').toEqual(['back'])
    key('KeyZ', true); input.poll(TICK_DT)
    key('Tab'); input.poll(TICK_DT)
    expect(uiEdges(input), 'raw 说了 back = KeyZ 一把 ⇒ Tab/Backspace 让位（整张语义，不是追加）').toEqual([])
    key('Tab', true)
    key('Digit3'); input.poll(TICK_DT)
    expect(uiEdges(input), '没被点名的 pick3 走默认格').toEqual(['pick3'])
    key('Digit3', true)
    key('ArrowUp'); input.poll(TICK_DT)
    expect(uiEdges(input), '没被点名的 up 同样回来').toEqual(['up'])
    expect(Object.keys(input.uiBinds.keyboard).filter((c) => input.uiBinds.keyboard[c] === 'confirm').length,
      'confirm 四把等价键在运行时表上是完整的').toBe(4)
  })

  it('扳机死区（stickThreshold）也走运行时：0.7 的推力在 0.8 的死区下不算按下', () => {
    const { input, store } = rig()
    input.uiOwner = 'panel'
    fakePad([0, -0.7, 0, 0])
    store.set({ ui: { stickThreshold: 0.8 } })
    input.poll(TICK_DT)
    expect(uiEdges(input), '默认 0.55 会发 up，夹到 0.8 就不发了').toEqual([])
    store.set({ ui: { stickThreshold: 0.5 } })
    input.poll(TICK_DT)
    expect(uiEdges(input), '把死区调小 ⇒ 同一次推变成 up').toEqual(['up'])
  })
})

/* ---------------------------------------------------------------- ② 屏幕不说谎 */

/** HUD 的画布替身：只收集 fillText 的字符串（与 hud-quest.test.ts 同一套零 DOM 口径） */
function hudTexts(input: Input | null): string[] {
  const texts: string[] = []
  const store: Record<string, unknown> = {}
  const grad = { addColorStop: () => {} }
  const ctx = new Proxy(store, {
    get(t, k: string) {
      if (k in t) return t[k]
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad
      if (k === 'measureText') return () => ({ width: 10 })
      if (k === 'fillText') return (txt: unknown) => { texts.push(String(txt)) }
      return () => {}
    },
    set(t, k: string, v) { t[k] = v; return true }
  })
  const canvas = { getContext: () => ctx, width: 0, height: 0 } as unknown as HTMLCanvasElement
  const hud = new Hud(canvas, input)
  hud.render(0, TICK_DT)
  hud.dispose()
  return texts
}

describe('KI-336 显示层读运行时真值：改键之后 HUD 与面板不说谎', () => {
  it('HUD 键位列：默认画 G，把弹反挪到 H 之后画 H 且不画 G', () => {
    const { input, store } = rig()
    expect(hudTexts(input), '默认表上弹反=G').toContain('G')
    store.set({ gameplay: { keyboard: { KeyH: 'parry' } } })
    const after = hudTexts(input)
    expect(after, '改完键不用重启、不用改 HUD 一行代码，这一列跟着走').toContain('H')
    expect(after, 'G 腾出来之后没有别的动作停在上面 ⇒ 那一格不再出现').not.toContain('G')
  })

  it('没接 bindsSource 的 HUD 仍画默认列（旧调用方不必被迫改）', () => {
    expect(hudTexts(null), '不注入 ⇒ 读 keyOf 的默认表').toContain('G')
  })

  it('调音桩的槽位标签：`第 1 槽 · 键 R` 改键之后变成 `键 H`（注释那句支票兑现）', () => {
    const { input, store } = rig()
    const NO_SAVES: SavePanelDeps = { list: async (): Promise<SlotCard[]> => [], write: async () => null, erase: async () => false }
    const render = (): string => {
      const p = new Stakerite(new RpgRuntime('origin_tuner'),
        { onApply: () => {}, notify: () => {}, onUse: () => {}, onRequestClose: () => {} }, NO_SAVES, input)
      p.show()
      click(rootOf(p), 'tab', 'moves')
      const html = rootOf(p).innerHTML
      p.close()
      return html
    }
    expect(render(), '默认战技槽=R').toContain('第 1 槽 · 键 R')
    store.set({ gameplay: { keyboard: { KeyH: 'weaponSkill' } } })
    expect(render(), '面板每次渲染现读运行时表：槽位标签跟着换').toContain('第 1 槽 · 键 H')
  })
})

/* ---------------------------------------------------------------- ③ 跟档走 */

function makeFakeAudio() {
  const vols = new Map<string, number>()
  return {
    setVolume: (b: string, v: number): void => { vols.set(b, Math.max(0, Math.min(1, v))) },
    getVolume: (b: string): number => vols.get(b) ?? 1,
  }
}

/**
 * 最小可存档世界。`withBindings=false` 写出的就是"这个世界的档里没有键位这块"，
 * 用来造 v13 时代的内容形状（不必真去跑一遍 v13 的迁移）。
 */
function makeWorld(store = new MapStore(), withBindings = true) {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
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
  const world = {
    player, streaming, spawner, clock: rhythm, time, rpg, audio: makeFakeAudio(),
    ...(withBindings ? { bindings: { get: () => bindings.get(), apply: (raw: unknown): void => bindings.restore(raw) } } : {})
  }
  return { input, bindings, saves: new SaveGame(world, store) }
}

type Stored = { payload: { snapshot: { version: number; settings: { bindings?: Record<string, unknown> } } } }
const readStored = async (store: MapStore, slot: string): Promise<Stored> =>
  JSON.parse((await store.get(slot))!) as Stored

describe('KI-336 键位跟档走：save → 新世界 load ⇒ 复原并按新键打得动', () => {
  it('改键 → save ⇒ 档里真的有 settings.bindings，版本号是 v14', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    w.bindings.set({ gameplay: { keyboard: { KeyQ: 'dodge' } } })
    await w.saves.save('bindings')
    const stored = await readStored(store, 'bindings')
    expect(SAVE_VERSION, '本批把存档版本推到 14').toBe(14)
    expect(stored.payload.snapshot.version).toBe(14)
    const kb = (stored.payload.snapshot.settings.bindings as { gameplay: { keyboard: Record<string, string> } }).gameplay.keyboard
    expect(kb.KeyQ).toBe('dodge')
    expect(kb.ControlLeft, '交换的另一半也进了档').toBe('lockOn')
  })

  it('新世界 load ⇒ store 与 Input 同时复原，按 Q 真的闪避（数据跑到玩法那一帧）', async () => {
    const store = new MapStore()
    const w1 = makeWorld(store)
    w1.bindings.set({ gameplay: { keyboard: { KeyQ: 'dodge' } } })
    await w1.saves.save('bindings')

    const w2 = makeWorld(store)
    expect(w2.input.binds.keyboard.KeyQ, '新世界从默认起手').toBe('lockOn')
    await w2.saves.load('bindings')
    expect(w2.bindings.get().gameplay.keyboard.KeyQ).toBe('dodge')
    expect(w2.input.binds.keyboard.KeyQ, '灌进消费者的与档里的一致（不是只存了个数）').toBe('dodge')
    key('KeyQ'); w2.input.poll(TICK_DT)
    expect(edges(w2.input), '读档之后的第一次按键就按新表打得出动作').toEqual(['dodge'])
  })

  it('往返不漂移：save→load→save 之后档里那一块逐字相等（幂等的存档版）', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    w.bindings.restore({ gameplay: { keyboard: { KeyQ: 'dodge' }, padButtons: { 0: 'jump' } }, ui: { stickThreshold: 0.4 } })
    await w.saves.save('bindings')
    const first = (await readStored(store, 'bindings')).payload.snapshot.settings.bindings
    const w2 = makeWorld(store)
    await w2.saves.load('bindings')
    await w2.saves.save('bindings')
    expect((await readStored(store, 'bindings')).payload.snapshot.settings.bindings,
      '第二份档与第一份逐格相同 ⇒ 存几次都不漂').toEqual(first)
    expect(w2.bindings.get()).toEqual(clampBindings(first))
    const ui = w2.bindings.get().ui
    expect(ui.stickThreshold, '手柄与阈值这些"半边"也照原样回来').toBe(0.4)
  })

  it('老档（这个世界的档里根本没写过键位）load ⇒ 当前键位一格都不动（§78 留空是如实）', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    w.bindings.set({ ui: { stickThreshold: 0.3 }, gameplay: { keyboard: { KeyH: 'parry' } } })
    const before = w.bindings.get()
    const legacy = makeWorld(store, false)
    await legacy.saves.save('bindings')
    await w.saves.load('bindings')
    expect(w.bindings.get(), '没记过键位的档 ⇒ 不改当前表（改成默认就是把玩家的键删了）').toEqual(before)
    expect(w.input.binds.keyboard.KeyH, '消费者同样原地不动').toBe('parry')
    expect(w.input.uiBinds.stickThreshold).toBe(0.3)
  })

  it('手改过的 v14 档带着毒键与名册外的动作 ⇒ 照样读得进去，且每个动作仍有键', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    const hostile = wrap(14, {
      snapshot: {
        version: 14, playSec: 1, savedAt: null, regionId: null,
        player: { x: 0, y: 0, z: 0, hp: 90, stamina: 80, overdrive: 0, weaponId: 'wp_tuning_sword', corruption: 0 },
        flags: [], clearedSlots: [], usedInteractables: [], brokenProps: [],
        settings: { audio: {}, bindings: JSON.parse('{"gameplay":{"keyboard":{"__proto__":{"x":1},"":"parry","<img>":"dodge","KeyQ":"fly","KeyE":"dodge"}}}') },
        rpg: null, quest: null, states: {}
      }
    })
    await store.set('bindings', hostile)
    await w.saves.load('bindings')
    expect(Object.prototype.hasOwnProperty.call(w.input.binds.keyboard, '__proto__'), '毒键没进运行时表').toBe(false)
    expect(Object.getPrototypeOf(w.input.binds.keyboard), '原型也没被动过').toBe(Object.prototype)
    expect(Object.keys(w.input.binds.keyboard), '空串与 `<img>` 老老实实会成自己的键——挡住它们的是语法闸门，不是 JS 语义').not.toContain('')
    expect(w.input.binds.keyboard['<img>'], '尖括号那把同样进不来').toBeUndefined()
    expect(Object.values(w.input.binds.keyboard), '名册外的 fly 落榜').not.toContain('fly' as ActionName)
    expect(w.input.binds.keyboard.KeyE, '合法那格照整张语义生效').toBe('dodge')
    for (const a of BINDABLE_ACTIONS) {
      expect(Object.values(w.input.binds.keyboard), `${a} 在这份手改档读进来之后仍有键`).toContain(a)
    }
    key('KeyE'); w.input.poll(TICK_DT)
    expect(edges(w.input), '按新表打得动，才叫读得进去').toEqual(['dodge'])
  })
})

describe('KI-336 v13→v14 迁移', () => {
  it('版本推到 14；没有 bindings 块就不写（§78）；已有的原样交给信任边界', () => {
    const noBlock = migrateV13toV14({ snapshot: { version: 13, settings: { audio: { music: 0.5 }, gameplay: { bufferMs: 120 } } } }) as unknown as
      { snapshot: { version: number; settings: { bindings?: unknown; audio: Record<string, number>; gameplay?: unknown } } }
    expect(noBlock.snapshot.version).toBe(14)
    expect(noBlock.snapshot.settings.bindings, '迁移不白送一份假默认').toBeUndefined()
    expect(noBlock.snapshot.settings.audio, 'audio/gameplay 半边照旧').toEqual({ music: 0.5 })
    const withBlock = migrateV13toV14({ snapshot: { version: 13, settings: { audio: {}, bindings: { ui: { stickThreshold: 0.4 } } } } }) as unknown as
      { snapshot: { version: number; settings: { bindings: { ui: { stickThreshold: number } } } } }
    expect(withBlock.snapshot.settings.bindings.ui.stickThreshold, '不在迁移里夹取：那是读档路径上唯一入口的活').toBe(0.4)
  })

  it('真 v13 形状的档经读档路径读入：键位不动，audio 半边照常复原', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    w.bindings.set({ gameplay: { keyboard: { KeyH: 'parry' } }, ui: { stickThreshold: 0.3 } })
    const v13 = wrap(13, {
      snapshot: {
        version: 13, playSec: 1, savedAt: null, regionId: null,
        player: { x: 0, y: 0, z: 0, hp: 90, stamina: 80, overdrive: 0, weaponId: 'wp_tuning_sword', corruption: 0 },
        flags: [], clearedSlots: [], usedInteractables: [], brokenProps: [],
        settings: { audio: { music: 0.4 } },
        rpg: null, quest: null, states: {}
      }
    })
    await store.set('bindings', v13)
    await w.saves.load('bindings')
    expect(w.input.binds.keyboard.KeyH, 'v13 档没有 bindings 块 ⇒ 保持当前表').toBe('parry')
    expect(w.bindings.get().ui.stickThreshold, '也不把阈值拽回默认（默认 0.55，当前 0.3）').toBe(0.3)
  })
})

/** 一份"没改过键"的档读回来，运行时表必须逐字回到默认表（restore 不是近似还原） */
describe('KI-336 restore 一份没改过键的档 ⇒ 运行时表逐字回默认', () => {
  it('键盘/手柄/轴/阈值四张都回到 `DEFAULT_BINDS`/`UI_BINDS` 那一份形状', () => {
    const { input, store } = rig()
    store.set({ gameplay: { keyboard: { KeyH: 'parry' }, padButtons: { 0: 'jump' } }, ui: { stickThreshold: 0.8 } })
    expect(input.binds.keyboard.KeyH, '先确认确实改过').toBe('parry')
    store.restore(clampBindings(undefined))
    expect(input.binds.keyboard, '玩法键盘逐字回默认').toEqual(DEFAULT_BINDS.keyboard)
    expect(input.binds.padButtons, '手柄逐字回默认').toEqual(DEFAULT_BINDS.padButtons)
    expect(input.binds.padAxes).toEqual(DEFAULT_BINDS.padAxes)
    expect(input.uiBinds.keyboard, '菜单键盘逐字回默认').toEqual(UI_BINDS.keyboard)
    expect(input.uiBinds.stickThreshold).toBe(UI_BINDS.stickThreshold)
    for (const a of BINDABLE_ACTIONS) {
      expect(Object.values(input.binds.keyboard), `${a} 有键`).not.toHaveLength(0)
    }
  })
})
