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
import { BIND_BOUNDS, BindingsStore, PROFILE_SLOTS, clampBindings, clampProfiles, defaultBindings } from '@/settings/Bindings'
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
    ...(withBindings ? {
      bindings: {
        get: () => bindings.get(),
        apply: (raw: unknown): void => bindings.restore(raw),
        profiles: { get: () => bindings.getProfiles(), apply: (raw: unknown): void => bindings.applyProfiles(raw) }
      }
    } : {})
  }
  return { input, bindings, saves: new SaveGame(world, store) }
}

type Stored = { payload: { snapshot: { version: number; settings: { bindings?: Record<string, unknown>; bindingsProfiles?: unknown } } } }
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

/* ---------------------------------------------------- KI-362 配置文件跟档走 */

/**
 * KI-362：「3 套配置文件」第一次走得进档。这一组只问 unit 问不到的那三件事：
 *  ① **两块各写各的**：`settings.bindings` 是玩家**此刻在用**的那一张，`settings.bindingsProfiles`
 *     是那三盒快照。共用同一格就会变成"存一盘磁带顺手换了现表"，而读档那侧也分不开这两件事了。
 *  ② **不写空块**（§78）：一盒都没存 ⇒ 档里那一格干脆不存在。写了 `[null,null,null]` 与没写
 *     是同一个意思，两种写法就是两个主人——那正是 KI-336 那一批反复抓的形状。
 *  ③ **磁带读进来不等于请回运行时**：读档只把三盒放回去，换现表只有玩家按「载入」那一步。
 *     少这一刀，读一份旧档会静默改掉玩家这一局正在用的键。
 *
 * 界外与毒键那一半在 `bindings-data` 里量过了；这里量的是**过了那道边界之后仍然走得进档、走得回来**，
 * 以及手改档里那三格进来了也仍然玩得下去（按得出动作，不是只躺在对象里）。
 */
describe('KI-362 配置文件跟档走：两块各写各的、空块不写、磁带不越权换现表', () => {
  const settingsOf = async (store: MapStore, slot: string): Promise<Record<string, unknown>> =>
    (await readStored(store, slot)).payload.snapshot.settings as unknown as Record<string, unknown>

  it('一盒都没存 ⇒ 档里那一格不写；存了一盒 ⇒ 那一格真的是三格，而且第一格里有改过的那一把', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    await w.saves.save('bindings')
    expect('bindingsProfiles' in await settingsOf(store, 'bindings'), '没写过 ⇒ 不留下第二种"没写过"的写法').toBe(false)

    w.bindings.rebind('dodge', 'KeyQ')
    expect(w.bindings.storeProfile(0)).toBe('new')
    await w.saves.save('bindings')
    const cell = await settingsOf(store, 'bindings')
    const tapes = cell.bindingsProfiles as (Record<string, unknown> | null)[]
    expect(tapes, '交出去的是定长三格，不是"存了几格就写几格"').toHaveLength(PROFILE_SLOTS)
    expect(clampProfiles(tapes), '过一遍信任边界逐字不动（幂等 ⇒ 存档往返不漂）').toEqual(tapes)
    expect((tapes[0] as { gameplay: { keyboard: Record<string, string> } }).gameplay.keyboard.KeyQ).toBe('dodge')
    expect(tapes[1], '没存的那两格是 null，不是一份假默认').toBeNull()
    expect(tapes[2]).toBeNull()
    expect((cell.bindings as { gameplay: { keyboard: Record<string, string> } }).gameplay.keyboard.KeyQ,
      '现表那一格照常写自己那一份：两块各自有主人').toBe('dodge')
  })

  it('新世界 load ⇒ 三盒回来了而现表仍是 `settings.bindings` 那一张；按下「载入」才换，且换得动', async () => {
    const store = new MapStore()
    const w1 = makeWorld(store)
    w1.bindings.storeProfile(0)                       // 第一盒：存的是**默认**那一张
    w1.bindings.rebind('dodge', 'KeyQ')               // 然后才把闪避挪走 ⇒ 现表与磁带从此不同
    await w1.saves.save('bindings')

    const w2 = makeWorld(store)
    await w2.saves.load('bindings')
    expect(w2.input.binds.keyboard.KeyQ, '现表跟着档里那一格复原：读档不许把玩家的键洗成默认').toBe('dodge')
    expect(w2.bindings.profileFlags(), '三盒的形状回来了，第一盒有东西').toEqual([true, false, false])
    expect(w2.bindings.getProfiles()![0]!.gameplay.keyboard.KeyQ, '而磁带里那张仍是当时那一张：后来挪走的 Q 没追进盒子')
      .toBe('lockOn')
    expect(w2.bindings.getProfiles()![0]!.gameplay.keyboard.ControlLeft, '第一盒里闪避还在 Ctrl 上').toBe('dodge')
    expect(w2.bindings.loadProfile(0), '玩家按下那一行的「载入」才是换表那一步').toBe(true)
    expect(w2.input.binds.keyboard.KeyQ, '换完了：Q 回到它默认那一位（锁定）').toBe('lockOn')
    key('KeyQ'); w2.input.poll(TICK_DT)
    expect(edges(w2.input), '按 Q 发的是锁，不是闪避：磁带真的请回了运行时').not.toContain('dodge')
    key('ControlLeft'); w2.input.poll(TICK_DT)
    expect(edges(w2.input), '而 Ctrl 又打得动闪避了').toContain('dodge')
  })

  it('往返不漂移：save→load→save 之后两块各自逐字相等（存几次都不漂）', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    w.bindings.rebind('dodge', 'KeyQ')
    w.bindings.storeProfile(0)
    w.bindings.unbind('jump')
    w.bindings.rebind('parry', 'Pad3')
    w.bindings.storeProfile(2)
    await w.saves.save('bindings')
    const first = await settingsOf(store, 'bindings')
    const w2 = makeWorld(store)
    await w2.saves.load('bindings')
    await w2.saves.save('bindings')
    const second = await settingsOf(store, 'bindings')
    expect(second.bindingsProfiles, '那三盒过一遍档与新世界 ⇒ 逐字相同').toEqual(first.bindingsProfiles)
    expect(second.bindings, '现表那一格同一条判据').toEqual(first.bindings)
    expect(w2.bindings.profileFlags(), '哪一盒存过也照原样回来').toEqual([true, false, true])
  })

  it('手改档里那三格带毒、多写两格 ⇒ 夹过再进格，三格定长，而载入之后按得出动作', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    const hostile = wrap(14, {
      snapshot: {
        version: 14, playSec: 1, savedAt: null, regionId: null,
        player: { x: 0, y: 0, z: 0, hp: 90, stamina: 80, overdrive: 0, weaponId: 'wp_tuning_sword', corruption: 0 },
        flags: [], clearedSlots: [], usedInteractables: [], brokenProps: [],
        settings: {
          audio: {},
          bindingsProfiles: JSON.parse('[{"gameplay":{"keyboard":{"__proto__":{"x":1},"<img>":"dodge","KeyQ":"fly","KeyE":"dodge"}}},{"ui":{"stickThreshold":9}},null,{"gameplay":{"keyboard":{"KeyR":"dodge"}}},{"ui":{"stickThreshold":0.1}}]')
        },
        rpg: null, quest: null, states: {}
      }
    })
    await store.set('bindings', hostile)
    await w.saves.load('bindings')
    const tapes = w.bindings.getProfiles()!
    expect(tapes, '多写的那两格不进来：定长三格只有一个主人').toHaveLength(PROFILE_SLOTS)
    expect(tapes[2], '明写 null 那一格还是空的').toBeNull()
    const kb = tapes[0]!.gameplay.keyboard
    expect(Object.prototype.hasOwnProperty.call(kb, '__proto__'), '毒键没进磁带').toBe(false)
    expect(kb['<img>'], '尖括号那把进不来').toBeUndefined()
    expect(Object.values(kb), '名册外的 fly 落榜').not.toContain('fly' as ActionName)
    expect(kb.KeyE, '合法那一格照整张语义进盒').toBe('dodge')
    expect(tapes.filter((t) => t !== null), '三格之外没有第四盒：多写的那两格整条截掉').toHaveLength(2)
    expect(tapes[0]!.ui.stickThreshold, '第一格没写 ui ⇒ 走整块默认：第二格那个越界数不渗进别的格').toBe(defaultBindings().ui.stickThreshold)
    expect(tapes[1]!.ui.stickThreshold, '越界那个数在每一格里同样被夹住').toBe(BIND_BOUNDS.stickThreshold.max)
    expect(tapes[1]!.ui.keyboard, '而夹过的那一格仍是**整张**：没写的块走默认，不是半张新表').toEqual(defaultBindings().ui.keyboard)
    expect(w.input.binds.keyboard.KeyE, '读档这一拍磁带不越权：现表仍是默认那一张（E 还是交互）').toBe('interact')
    expect(w.bindings.loadProfile(0), '而玩家按「载入」请得回那一盒').toBe(true)
    key('KeyE'); w.input.poll(TICK_DT)
    expect(edges(w.input), '按新表打得动，才叫那一盒真能玩').toEqual(['dodge'])
  })

  it('KI-362 之前的 v14 档没这块 ⇒ 三盒一格都不动（§78 留空是如实，与现表同一条裁决）', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    w.bindings.rebind('dodge', 'KeyQ')
    w.bindings.storeProfile(1)
    const tapes = w.bindings.getProfiles()!
    const before = w.bindings.get()
    const legacy = makeWorld(store)
    legacy.bindings.rebind('jump', 'KeyB')
    await legacy.saves.save('bindings')
    await w.saves.load('bindings')
    expect(w.bindings.getProfiles(), '那份档没记过磁带 ⇒ 不许把这一局存好的清空').toEqual(tapes)
    expect(w.bindings.get(), '而现表照档里那一格换（两块的"没写"读法本来就不同：现表是玩家此刻用的）')
      .not.toEqual(before)
    expect(w.input.binds.keyboard.KeyB, '现表那条路照常走').toBe('jump')
  })
})

/* ------------------------------------------------- KI-363 清空之后那一格怎么写 */

/**
 * KI-363：「清空」在档上是什么形状。这一组只问 unit 问不到的那两件事：
 *  ① **清空三盒之后，那一格整个消失**，而不是写成 `[null,null,null]`——「清空过」与「没写过」
 *     在档上是同一句话，而同一句话只许一种写法（§78；KI-362 的 A19 那条臂量的正是这条判据）。
 *  ② **清空只动磁带那一格，现表那一格照写自己那一份**——两块各写各的这条形状在清空这一侧也要成立：
 *     载入过一盒、再把那盒清空，档里应看到「现表是刚载入那张、而那格磁带是 null」。
 *     写歪成共用一格，读回来玩家手里就会凭空多一张没人存过的表，或凭空少一张他正在用的。
 */
describe('KI-363 清空跟档走：三盒全空 ⇒ 那一格不写，而现表那一格照写自己那一份', () => {
  const settingsOf = async (store: MapStore, slot: string): Promise<Record<string, unknown>> =>
    (await readStored(store, slot)).payload.snapshot.settings as unknown as Record<string, unknown>

  it('三盒都存过 ⇒ 那一格要写；逐个清空后再存 ⇒ 那一格整个消失，不是留下三种"没写过"', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    for (let i = 0; i < PROFILE_SLOTS; i++) expect(w.bindings.storeProfile(i)).toBe('new')
    await w.saves.save('bindings')
    const cell = await settingsOf(store, 'bindings')
    expect('bindingsProfiles' in cell, '三盒都有 ⇒ 那一格在档里').toBe(true)
    expect(cell.bindingsProfiles as unknown[], '交出去的是定长三格').toHaveLength(PROFILE_SLOTS)

    for (let i = 0; i < PROFILE_SLOTS; i++) expect(w.bindings.clearProfile(i), `第 ${i} 盒清得动`).toBe(true)
    await w.saves.save('bindings')
    const after = await settingsOf(store, 'bindings')
    expect('bindingsProfiles' in after, '全清空之后再存 ⇒ 那一格干脆不写（不留 [null,null,null] 那种第二种「没写过」）').toBe(false)
    expect(after.bindings, '而现表那一格与清空无关：玩家此刻那张照常写').toBeDefined()

    const w2 = makeWorld(store)
    await w2.saves.load('bindings')
    expect(w2.bindings.profileFlags(), '读回来仍是三格空，且没有一个"曾经存过"的影子')
      .toEqual([false, false, false])
    expect(w2.bindings.getProfiles(), '新世界也拿不到那一格').toBeUndefined()
  })

  it('带三盒的老档读回来 ⇒ 只清一盒后再存：那一格仍三格、被点那格是 null、另两盒逐字不动', async () => {
    const store = new MapStore()
    const w1 = makeWorld(store)
    w1.bindings.rebind('dodge', 'KeyQ')
    w1.bindings.storeProfile(0)
    w1.bindings.unbind('jump')
    w1.bindings.storeProfile(2)
    await w1.saves.save('bindings')
    const before = await settingsOf(store, 'bindings')
    const tapesBefore = before.bindingsProfiles as unknown[]

    const w2 = makeWorld(store)
    await w2.saves.load('bindings')
    expect(w2.bindings.clearProfile(0), '第二盒没录过、第一盒录过 ⇒ 清的是点名那一盒').toBe(true)
    await w2.saves.save('bindings')
    const after = await settingsOf(store, 'bindings')
    const tapesAfter = after.bindingsProfiles as (Record<string, unknown> | null)[]
    expect(tapesAfter, '那一格仍是定长三格，不是"清掉一格就少一格"').toHaveLength(PROFILE_SLOTS)
    expect(tapesAfter[0], '被清空的那一格写的是 null（一格磁带的空态本来就是这么写的）').toBeNull()
    expect(tapesAfter[2], '没点名的那盒逐字不动').toEqual(tapesBefore[2])
    expect(after.bindings, '而现表那一格走的是自己那条路：E 仍写着「无」').toEqual(before.bindings)
  })

  it('载入一盒、再把那盒清空 ⇒ 现表仍是刚载入那张，磁带那一格是 null（两块各写各的在清空这一侧也成立）', async () => {
    const store = new MapStore()
    const w1 = makeWorld(store)
    w1.bindings.storeProfile(1)                       // 第二盒：默认那一张
    w1.bindings.rebind('dodge', 'KeyQ')               // 然后才把闪避挪走
    await w1.saves.save('bindings')

    const w2 = makeWorld(store)
    await w2.saves.load('bindings')
    expect(w2.bindings.loadProfile(1), '请回第二盒').toBe(true)
    expect(w2.input.binds.keyboard.KeyQ, 'Q 回到它当时那一位（锁定）').toBe('lockOn')
    expect(w2.bindings.clearProfile(1), '再把那一盒清空').toBe(true)
    expect(w2.input.binds.keyboard.KeyQ, '清空不倒回去：手里仍是刚载入那一张').toBe('lockOn')
    await w2.saves.save('bindings')
    const cell = await settingsOf(store, 'bindings')
    const kb = (cell.bindings as { gameplay: { keyboard: Record<string, string> } }).gameplay.keyboard
    expect(kb.KeyQ, '档里现表那一格写的是刚载入那张 ⇒ Q 记的是锁定').toBe('lockOn')
    expect('bindingsProfiles' in cell, '那一盒是当时唯一存过的一盒 ⇒ 清空之后整块不写：同一条裁决落在档上，而现表那一格照常写').toBe(false)
    expect(w2.bindings.profileFlags(), '新世界手里那三格仍是三句「空」：清空过不留下第二种写法').toEqual([false, false, false])
  })
})

/* ---------------------------------------------- KI-364 扳机拐点跟档走 */

/**
 * KI-364：那一格在档上的形状。三条各钉一处：
 * ① **加格不推版本**：`triggerThreshold` 骑的是既有的 `settings.bindings` 那一格，`SAVE_VERSION` 仍是 14，
 *    `Serializer` 一个字没改——写出去的一直是 store 交回的那**整张**表；
 * ② **老档没这一格** ⇒ 读回来是默认那一个数，而这一格上「没写过」不许长出第二种写法：整张语义意味着
 *    下一次存盘把它补写出来。这与配置文件那三盒**相反**——那三盒的「没存过」由 store 回答 `undefined`，
 *    因为那里真的有空态；现表这一格从来没有空态可言（§78 那句「留空是如实」管的是缺块，不是缺省值）；
 * ③ **磁带带得动它**：存一盒 → 把线推高 → 载入那盒 ⇒ 线回到快照那一刻，与键位同生同灭。
 */
describe('KI-364 扳机拐点跟档走：加格不推版本、老档没它是默认、磁带里它是快照的一部分', () => {
  it('改线 → save ⇒ 档里那一格是那个数而版本仍是 14；新世界 load ⇒ 消费者拿到同一个数', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    w.bindings.setTriggerThreshold(0.3)
    await w.saves.save('bindings')
    const stored = await readStored(store, 'bindings')
    expect(SAVE_VERSION, '本批没推版本：那一格骑的是 v14 已有的那一块').toBe(14)
    expect(stored.payload.snapshot.version).toBe(14)
    const g = (stored.payload.snapshot.settings.bindings as { gameplay: { triggerThreshold: number } }).gameplay
    expect(g.triggerThreshold, '写进档的是生效那一个数，不是玩家往面板里敲的那一串').toBe(0.3)
    const w2 = makeWorld(store)
    await w2.saves.load('bindings')
    expect(w2.bindings.get().gameplay.triggerThreshold, '新世界读回来还是那一个数').toBe(0.3)
    expect(w2.input.binds.triggerThreshold, '而消费者那一份与 store 那一个同形（漏抄就是屏幕上两个数）').toBe(0.3)
  })

  it('写过键位却没写这一格的老档 ⇒ 读回来是默认那一个数，下一次存盘把它补写出来（这一格没有空态）', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    const legacy = wrap(14, {
      snapshot: {
        version: 14, playSec: 1, savedAt: null, regionId: null,
        player: { x: 0, y: 0, z: 0, hp: 90, stamina: 80, overdrive: 0, weaponId: 'wp_tuning_sword', corruption: 0 },
        flags: [], clearedSlots: [], usedInteractables: [], brokenProps: [],
        settings: { audio: {}, bindings: { gameplay: { keyboard: { KeyQ: 'dodge' } } } },
        rpg: null, quest: null, states: {}
      }
    })
    await store.set('bindings', legacy)
    await w.saves.load('bindings')
    expect(w.bindings.get().gameplay.triggerThreshold, '档里没这一格 ⇒ 边界补的是默认那一个数，不是 0、也不是 undefined')
      .toBe(DEFAULT_BINDS.triggerThreshold)
    expect(w.input.binds.triggerThreshold, '消费者拿到的同形：缺格不许变成"这一把永远推不动"').toBe(DEFAULT_BINDS.triggerThreshold)
    expect(w.input.binds.keyboard.KeyQ, '同一块里写过的那一格照常生效（补一格不是把整张退回默认）').toBe('dodge')
    await w.saves.save('bindings')
    const again = (await readStored(store, 'bindings')).payload.snapshot.settings.bindings as { gameplay: Record<string, unknown> }
    expect('triggerThreshold' in again.gameplay, '而再存一遍就写上了：整张语义下这一格从来没有"没写过"第二种拼写').toBe(true)
    expect(again.gameplay.triggerThreshold, '补写出去的就是生效那一个数').toBe(DEFAULT_BINDS.triggerThreshold)
  })

  it('磁带装的是整张表：存一盒 → 把线推高 → 载入那盒 ⇒ 线回到快照那一刻，与键位同生同灭', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    w.bindings.rebind('dodge', 'KeyQ')
    w.bindings.setTriggerThreshold(0.2)
    expect(w.bindings.storeProfile(0), '那一盒记下的线是 0.2').toBe('new')
    w.bindings.setTriggerThreshold(0.9)
    w.bindings.rebind('dodge', 'KeyH')
    expect(w.bindings.loadProfile(0), '再把那一盒请回来').toBe(true)
    expect(w.input.binds.keyboard.KeyQ, '键位那半回到快照那一刻').toBe('dodge')
    expect(w.input.binds.triggerThreshold, '而拐点那一格也回来了：磁带不是半张表').toBe(0.2)
    await w.saves.save('bindings')
    const cell = (await readStored(store, 'bindings')).payload.snapshot.settings.bindings as { gameplay: { triggerThreshold: number } }
    expect(cell.gameplay.triggerThreshold, '档里现表那一格写的是刚载入那张的线，与磁带那一格各写各的').toBe(0.2)
  })
})

/* ----------------------------------- KI-369 半张磁带在真存档那一路上的形状 */

/**
 * KI-369：那三盒在**档里**缺一条通道时，读回来到底是什么。KI-367 的还欠②与 KI-368 的还欠②写的是同一句
 * 「半张磁带在真存档那一路上的形状未量（`M11` 那一臂被崩形遮蔽）」，而那句里已经指出了路该怎么走：
 * 从世界那侧走 `SaveGame.save`／`load`，中间经过一次真的 `JSON.parse(JSON.stringify(…))`，
 * 不是从 store 走 `getProfiles`／`applyProfiles`。本批那八条腿走的就是这条路。
 *
 * **文件头按源码钉死的预测（跑完如实记差，不抹）**：R1–R8 全预测为**绿**——本批一个字机制都不改，
 * 量的是既有形状，而那个形状住在两处源码里：`clampProfiles`（`src/settings/Bindings.ts:397`，逐格交给
 * `clampBindings`，自己一条规则都不立）与 `clampBindings` 那四条「缺 ⇒ 默认」（`asObject`／`resolvePadMap`／
 * `clampAxes`／`inBounds`，同文件 :328 那一节）。任何一条实读成红，都是预测写错，改的是预测而不是判据。
 *
 * 「只写键盘那半」那个拼写在本批的三份尺里各写一次，是有意的重复，不是第二个主人：本批的判据是
 * 「缺的名字补默认」，而「哪些名字算手柄那半」的主人仍是 `BIND_CHANNELS`（`:428`，`profile-channels`
 * 那条穷尽腿钉的是它）。这些字面量少列一个名字只会多缺一格、走的还是同一条路——它红不了，
 * 也就不会替本批撒谎。
 */

/** 只写键盘那半的一盒磁带：`gameplay` 只留 `keyboard`＋`unbound`，`ui` 那半要么跟着留两格、要么整块不写 */
const kbOnlyBox = (keyboard: Record<string, string>, uiKeyboard?: Record<string, string>): Record<string, unknown> => ({
  gameplay: { keyboard, unbound: [] },
  ...(uiKeyboard ? { ui: { keyboard: uiKeyboard, unbound: [] } } : {})
})

/** 一份真经过 JSON 的档：`settings` 里那两格（现表与磁带）各自给足，不借既有那条腿的 blob */
const saveOf = (settings: Record<string, unknown>): string => {
  const draft = {
    snapshot: {
      version: 14, playSec: 1, savedAt: null, regionId: null,
      player: { x: 0, y: 0, z: 0, hp: 90, stamina: 80, overdrive: 0, weaponId: 'wp_tuning_sword', corruption: 0 },
      flags: [], clearedSlots: [], usedInteractables: [], brokenProps: [],
      settings: { audio: {}, ...settings },
      rpg: null, quest: null, states: {}
    }
  }
  return wrap(14, JSON.parse(JSON.stringify(draft)))
}

/** 一张合法的整盒：两张表都写全，而改动的两格都在界内——它过一遍夹取应当逐字不变（幂等那条既有纪律） */
const fullBox = (): Record<string, unknown> => {
  const b = JSON.parse(JSON.stringify(defaultBindings())) as
    { gameplay: { padAxes: Record<string, number> }; ui: { stickThreshold: number } }
  b.gameplay.padAxes = { moveX: 2, moveY: 3, camX: 0, camY: 1 }
  b.ui.stickThreshold = 0.4
  return b as unknown as Record<string, unknown>
}

describe('KI-369 半张磁带在真存档那一路上的形状：缺的那半补默认、不是补此刻，而这一点改不掉', () => {
  it('R1 档里那一格只写键盘那半 ⇒ 读回来是一张整表：写过的那半生效，没写的那半是默认那一份', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    await store.set('bindings', saveOf({ bindingsProfiles: [kbOnlyBox({ KeyQ: 'dodge' }), null, null] }))
    await w.saves.load('bindings')
    const tape = w.bindings.getProfiles()![0]!
    expect(tape, '那一格是「有东西」：半张不是一种「没写过」').toBeTruthy()
    expect(tape.gameplay.keyboard.KeyQ, '写过的那半照常生效').toBe('dodge')
    expect(tape.gameplay.padButtons, '没写的那半读成默认那一张').toEqual(defaultBindings().gameplay.padButtons)
    expect(tape.gameplay.triggerThreshold, '扳机那条线住在缺的那一半里：补的是默认那一个数，不是 undefined').toBe(DEFAULT_BINDS.triggerThreshold)
    expect(tape.ui.stickThreshold, '菜单那一半同理').toBe(UI_BINDS.stickThreshold)
    expect(Object.keys(tape.gameplay).sort(), '读回来这张表的名字是完整的：半张不留在磁带里').toEqual(Object.keys(defaultBindings().gameplay).sort())
  })

  it('R2 缺的那半不取这份档自己的此刻：现表那一格是跳，盒里补的是默认闪避——与屏上按下「存入」那一次不同答', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    await store.set('bindings', saveOf({
      bindings: { gameplay: { padButtons: { 0: 'jump' } } },
      bindingsProfiles: [kbOnlyBox({ KeyQ: 'dodge' }), null, null]
    }))
    await w.saves.load('bindings')
    expect(w.input.binds.padButtons[0], '取证前提：这份档自己的那张现表上，0 号键是跳').toBe('jump')
    expect(w.bindings.getProfiles()![0]!.gameplay.padButtons[0], '而同一份档里那一盒缺的那半补的是默认那一位，不是这份档的此刻')
      .toBe(DEFAULT_BINDS.padButtons[0])
    expect(DEFAULT_BINDS.padButtons[0], '默认那一位确实是闪避（不是碰巧同名）').toBe('dodge')
  })

  it('R3 按下「载入」（不带通道）之后玩家此刻那一半被换成默认：同一颗物理键从跳变成闪避', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    await store.set('bindings', saveOf({
      bindings: { gameplay: { padButtons: { 0: 'jump' } } },
      bindingsProfiles: [kbOnlyBox({ KeyQ: 'dodge' }), null, null]
    }))
    await w.saves.load('bindings')
    fakePad([0, 0, 0, 0], [0]); w.input.poll(TICK_DT)
    expect(edges(w.input), '载入之前：0 号键按这份档的此刻那张发跳').toEqual(['jump'])
    fakePad([0, 0, 0, 0], []); w.input.poll(TICK_DT)
    expect(w.bindings.loadProfile(0), '玩家按下那一行的「载入」（不带通道 ＝ 两半一起）').toBe(true)
    fakePad([0, 0, 0, 0], [0]); w.input.poll(TICK_DT)
    expect(edges(w.input), '同一颗物理键现在发的是默认那一位：KI-367 裁决① 反对的那件事从另一扇门进来了').toEqual(['dodge'])
  })

  it('R4 按通道那一次（只请回键盘那半）不动另一半：0 号键仍是跳——屏上那一枚选择是这一刀唯一的挡手', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    await store.set('bindings', saveOf({
      bindings: { gameplay: { padButtons: { 0: 'jump' } } },
      bindingsProfiles: [kbOnlyBox({ KeyQ: 'dodge', Tab: 'confirm' }), null, null]
    }))
    await w.saves.load('bindings')
    expect(w.bindings.loadProfile(0, 'kb'), '只请回键盘那半').toBe(true)
    expect(w.input.binds.keyboard.KeyQ, '写过的那半照常进来').toBe('dodge')
    expect(w.input.binds.padButtons[0], '缺的那半没有被"补"进来：此刻那一张一个字不动').toBe('jump')
  })

  it('R5 半张经过一次再存变成整张：补写出去的那几格无声无息，而版本仍是 14', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    await store.set('bindings', saveOf({ bindingsProfiles: [kbOnlyBox({ KeyQ: 'dodge' }), null, null] }))
    await w.saves.load('bindings')
    await w.saves.save('bindings')
    const stored = await readStored(store, 'bindings')
    const cells = stored.payload.snapshot.settings.bindingsProfiles as Record<string, Record<string, unknown>>[]
    expect(stored.payload.snapshot.version, '本批没推版本：那几格骑的还是 v14 已有的那一块').toBe(14)
    expect(Object.keys(cells[0].gameplay).sort(), '下一份档里不再有半张——而那几格是边界替玩家补的，没人签过字')
      .toEqual(Object.keys(defaultBindings().gameplay).sort())
    expect(cells[0].gameplay.triggerThreshold, '补出去的就是生效那一个数').toBe(DEFAULT_BINDS.triggerThreshold)
  })

  it('R6 同一档里另两盒逐字不动：治法是逐格的，一格半张不牵动邻居，明写 null 那格仍是空', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    const whole = fullBox()
    await store.set('bindings', saveOf({ bindingsProfiles: [whole, kbOnlyBox({ KeyQ: 'dodge' }), null] }))
    await w.saves.load('bindings')
    const tapes = w.bindings.getProfiles()!
    expect(tapes[0]!.gameplay.padAxes.moveX, '整张那一盒里写过的那一格照常').toBe(2)
    expect(tapes[0]!.ui.stickThreshold, '而那一盒的两块都写全：夹取对它是一句幂等').toBe(0.4)
    expect(tapes[0], '而它逐字就是那一张：补默认只发生在缺名字的盒里，整张的一格都不动').toEqual(whole)
    expect(tapes[1]!.gameplay.padButtons, '半张那一盒补的是默认').toEqual(defaultBindings().gameplay.padButtons)
    expect(tapes[2], '明写 null 那一格仍是空磁带（不是第三种存在感）').toBeNull()
  })

  it('R7 写的那半里有毒键也照样过同一道夹取：半张不是免检的理由', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    const dirty = JSON.parse('{"__proto__":{"x":1},"<img>":"dodge","KeyZ":"fly","KeyQ":"dodge"}') as Record<string, string>
    await store.set('bindings', saveOf({ bindingsProfiles: [kbOnlyBox(dirty), null, null] }))
    await w.saves.load('bindings')
    const kb = w.bindings.getProfiles()![0]!.gameplay.keyboard
    expect(Object.prototype.hasOwnProperty.call(kb, '__proto__'), '毒键没进盒').toBe(false)
    expect(kb['<img>'], '尖括号那把进不来').toBeUndefined()
    expect(Object.values(kb), '名册外的动作落榜').not.toContain('fly' as ActionName)
    expect(kb.KeyQ, '合法那一格照进盒').toBe('dodge')
  })

  it('R8 补默认只发生在盒里：现表那一格仍读回这份档自己那张，两块各写各的在缺格这一侧也成立', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    await store.set('bindings', saveOf({
      bindings: { gameplay: { padButtons: { 0: 'jump' } } },
      bindingsProfiles: [kbOnlyBox({ KeyQ: 'dodge' }), null, null]
    }))
    await w.saves.load('bindings')
    expect(w.bindings.get().gameplay.padButtons[0], '磁带的缺格不渗到现表身上').toBe('jump')
    expect(w.bindings.get().gameplay.keyboard.KeyQ, '而现表自己没写的那一格走的是现表那条默认，与盒里那半无关')
      .toBe(defaultBindings().gameplay.keyboard.KeyQ)
    await w.saves.save('bindings')
    const again = (await readStored(store, 'bindings')).payload.snapshot.settings as unknown as
      { bindings: { gameplay: { padButtons: Record<string, string> } } }
    expect(again.bindings.gameplay.padButtons[0], '再存一次，现表那一格写回的还是跳').toBe('jump')
  })
})
