import { beforeAll, describe, expect, it } from 'vitest'
import { GameTime } from '@/core/Time'
import { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { CameraRig } from '@/player/CameraRig'
import { Haptics } from '@/input/Haptics'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { StreamingSystem } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import { RpgRuntime } from '@/rpg/Runtime'
import { MapStore, SaveGame } from '@/save/Serializer'
import { DEFAULT_GAMEPLAY_SETTINGS, GameplaySettingsStore } from '@/settings/GameplaySettings'
import { BindingsStore, PROFILE_SLOTS, defaultBindings } from '@/settings/Bindings'
import type { BindingProfile } from '@/settings/Bindings'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * KI-366：配置文件那三盒里**到底装着什么**——第一次有一张点得出名字的清单。
 *
 * 这批不写新机制，量的是形状：账本里连着五趟（KI-348④／KI-362①／KI-363①／KI-364④／KI-365③）都写同一句
 * 「键鼠／手柄各自一套 profile 仍欠」，而 KI-365 那一行与本道 ui-ux 那条更写死了一句「配置文件那三盒装的是
 * **键位**快照」，还专门用它解释「切一套配置文件今天不会把长按一起切走」。这两句话此刻都没人量过。
 * 一读源码就露馅：`storeProfile` 抄的是 `clone(this.current)`＝**整张** `Bindings`，而那张里住着两把模拟量的线
 * （`gameplay.triggerThreshold`＝KI-364 那格扳机拐点，`ui.stickThreshold`＝KI-345 那格摇杆阈值）。
 * 于是「键位快照」是**写窄了**：盒子确实不带那八格玩法数值（长按就在其中，那句结论仍成立），
 * 但它带两把"手感线"——而这两把今天除了盒子没有任何别的东西带走它们。先量清楚，再谈分不分家。
 * （KI-366 落这批腿时表里是七格，KI-384 加了第八格「连打涨价」，标题跟着改口；判据取自 `SETTINGS_KEYS`，
 * 本来就是派生数——改的只是人读的那一句，格数那条钉在 `mash-guard` 的名册腿上。）
 *
 * 七条腿各钉一件事，预测在写之前就按源码钉死：① 名册（交集为空、两把线在内）；② 拐点随盒走且走到判据那一位；
 * ③ 阈值随盒走且住在菜单那一块；④ 八格玩法数值一格都不随盒走（KI-365 还欠②那条腿在这里落地），而同一次载入
 * 确实换了键——否则这条是空断言；⑤ 两条通道一起存一起取（耦合是形状，登记而不假装已分家）；
 * ⑥ 两份「无」名单也在盒里；⑦ 跟档走，而现表与磁带仍是两块各写各的。
 */

registerGameData()
Object.defineProperty(globalThis, 'innerWidth', { value: 1280, configurable: true })
Object.defineProperty(globalThis, 'innerHeight', { value: 720, configurable: true })
beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  g.window ??= { addEventListener: () => {} }
})

/** Input 构造要挂 el 监听；headless 里给个什么都不做的壳（同 KI-112 那一份尺的口径） */
class FakeEl {
  handlers: Record<string, ((e: unknown) => void)[]> = {}
  addEventListener(t: string, fn: (e: unknown) => void): void { (this.handlers[t] ??= []).push(fn) }
  requestPointerLock(): void { /* 无头，不锁 */ }
}

function makeFakeAudio() {
  const vols = new Map<string, number>()
  return {
    setVolume: (b: string, v: number) => { vols.set(b, Math.max(0, Math.min(1, v))) },
    getVolume: (b: string) => vols.get(b) ?? 1
  }
}

/**
 * 装配照 `main.ts` 那五行：两位主人各有自己的 store，`SaveGame` 拿到的是三个端口
 * （`gameplay.get/apply`、`bindings.get/apply`、`bindings.profiles.get/apply`）。
 * 这里不复用别的尺文件的假 world：这批问的正是**那两个 store 之间**的东西走不走得通，
 * 拼在一起的 world 才是生产形状，各自单测的接缝量不到中间那条缝。
 */
function makeWorld(store = new MapStore()) {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime('origin_tuner')
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
  player.camYawRef = 0
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const streaming = new StreamingSystem(regions)
  const cellKey = (p: Vec3): string => { const c = streaming.cellOf(p); return `${c.cx},${c.cy},${c.cz}` }
  const spawner = new SpawnDirector(regions, {
    spawn: (id, pos, sd) => ai.spawn(id, pos, sd),
    despawn: (id) => ai.despawn(id),
    hasFlag: (k) => streaming.hasFlag(k)
  }, cellKey)
  const input = new Input(new FakeEl() as unknown as HTMLElement)
  const rig = new CameraRig()
  const haptics = new Haptics(input)
  const settings = new GameplaySettingsStore({ input, rig, haptics, combat, player })
  const bindings = new BindingsStore({ input })
  const world = {
    player, streaming, spawner, clock: rhythm, time, rpg, audio: makeFakeAudio(),
    gameplay: { get: () => settings.get(), apply: (raw: unknown): void => settings.restore(raw) },
    bindings: {
      get: () => bindings.get(),
      apply: (raw: unknown): void => bindings.restore(raw),
      profiles: { get: () => bindings.getProfiles(), apply: (raw: unknown): void => bindings.applyProfiles(raw) }
    }
  }
  return { input, player, rig, haptics, combat, settings, bindings, saves: new SaveGame(world, store), store }
}

/** 一棵树上的叶子名（不含键名册那层的下标）：名册腿比的是**名字**，不是形状抄第二遍 */
function leafNames(node: unknown, out = new Set<string>()): Set<string> {
  if (node === null || typeof node !== 'object') return out
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) leafNames(v, out)
    else out.add(k)
  }
  return out
}

const SETTINGS_KEYS = Object.keys(DEFAULT_GAMEPLAY_SETTINGS)
const boxOf = (b: BindingProfile): Record<string, unknown> => (b ?? {}) as unknown as Record<string, unknown>

describe('KI-366 那一盒磁带里住着什么：两把模拟量的线在里面，那八格玩法数值在外面', () => {
  it('名册：盒子里的名字与 `settings.gameplay` 那八格**交集为空**，而 `triggerThreshold`／`stickThreshold` 在里面', () => {
    const w = makeWorld()
    expect(w.bindings.storeProfile(0), '取证前提：得先有一盒').toBe('new')
    const tape = w.bindings.getProfiles()![0]
    const names = leafNames(tape)
    const both = SETTINGS_KEYS.filter((k) => names.has(k))
    expect(both, '同名两块（`Bindings.gameplay` 是键位那半、`settings.gameplay` 是那八格）里若有一个名字重合，「切盒切不动玩法数值」就不是一句话了').toEqual([])
    for (const k of SETTINGS_KEYS) expect(names.has(k), `玩法数值那一格「${k}」不该住在磁带里`).toBe(false)
    expect([...names].filter((n) => /threshold/i.test(n)).sort(), '盒子里那两把线就叫这两个名字：一个都不许多、一个都不许少').toEqual(['stickThreshold', 'triggerThreshold'])
    const fresh = leafNames(defaultBindings())
    expect([...names].sort(), '一盒的名册＝整张默认表的名册：存进去的不是删剩的一张表').toEqual([...fresh].sort())
  })

  it('扳机拐点随盒子走，而且走到判据那一位：0.8 存进盒、拧到 0.2、请回那一盒 ⇒ `Input.padOn` 读的还是 0.8', () => {
    const w = makeWorld()
    expect(w.bindings.setTriggerThreshold(0.8)).toBe(0.8)
    expect(w.bindings.storeProfile(0)).toBe('new')
    expect(w.bindings.setTriggerThreshold(0.2)).toBe(0.2)
    expect(w.input.binds.triggerThreshold, '取证前提：消费者此刻已经是 0.2').toBe(0.2)
    expect(w.bindings.loadProfile(0), '请回那一盒').toBe(true)
    expect(w.bindings.get().gameplay.triggerThreshold, '边界那一份回来了').toBe(0.8)
    expect(w.input.binds.triggerThreshold, '判据那一位也回来了：盒子不是只躺在档里的一张纸').toBe(0.8)
  })

  it('摇杆阈值同样住在盒里（它在 `ui` 那一块）：0.3 存进去、拧到 0.9、请得回，而菜单那条读数跟着换', () => {
    const w = makeWorld()
    expect(w.bindings.setStickThreshold(0.3)).toBe(0.3)
    expect(w.bindings.storeProfile(1)).toBe('new')
    expect(w.bindings.setStickThreshold(0.9)).toBe(0.9)
    expect(w.input.uiBinds.stickThreshold, '取证前提：菜单那一位此刻是 0.9').toBe(0.9)
    expect(w.bindings.loadProfile(1)).toBe(true)
    expect(w.bindings.get().ui.stickThreshold).toBe(0.3)
    expect(w.input.uiBinds.stickThreshold, '过阈值＝按下那条线读的就是这一格').toBe(0.3)
    expect(w.input.binds.triggerThreshold, '阈值回来不许顺手把拐点也拧走：盒里那两把各走各的').toBe(0.5)
  })

  it('那八格玩法数值一格都不随盒子走（KI-365 还欠②那条腿），而同一次载入确实换了键——否则这条是空断言', () => {
    const w = makeWorld()
    w.settings.set({ bufferMs: 120, holdMs: 600, shakeScale: 0.4, rumbleScale: 1.8, rumbleWeakScale: 0.3, damageScale: 0.9, frameAssist: true })
    expect(w.bindings.storeProfile(0)).toBe('new')
    w.settings.set({ ...DEFAULT_GAMEPLAY_SETTINGS })
    const before = w.settings.get()
    w.bindings.rebind('dodge', 'KeyQ')
    expect(w.bindings.loadProfile(0)).toBe(true)
    expect(w.settings.get(), '切一盒配置文件切不动那八格：长按 600 存进去再拧回默认，请回那一盒也不会把它带回 600').toEqual(before)
    expect(w.input.bufferSec, '消费者那一侧也没被顺手拧走').toBe(0.2)
    expect(w.player.holdMs, 'KI-365 那一格今天仍不跟着配置文件走').toBe(200)
    /**
     * 存盒之后那次 `rebind` 被这次载入**退回去了**：`Q` 又回到默认表上它原本的主人（锁）那儿。
     * 我原先把它写成「`Q` 上是闪避」，那是把「请回那一盒」读成了「重放我刚才那一步」——方向反了。
     * 判据不变：这一句是取证「同一次载入确实换了表」，否则上面那五句「八格没动」就分不清是
     * 「盒子不带它们」还是「这次载入整趟没跑」。
     */
    expect(w.input.binds.keyboard.KeyQ, '同一次载入真的换了表：存盒之后那一步被退回，Q 又归锁定了').toBe('lockOn')
    expect(w.input.binds.triggerThreshold, '而盒子里那把拐点这次是**和键一起**回来的').toBe(0.5)
  })

  it('两条通道在不带通道那一次仍一起存、一起取：只改键盘那一半，请回那一盒也会把手柄那一半一起带回（KI-367 让分家可达，这一条钉的是面板正在用的那一档）', () => {
    const w = makeWorld()
    w.bindings.rebind('dodge', 'KeyQ')
    w.bindings.rebind('attackLight', 'Pad2')
    expect(w.bindings.storeProfile(0)).toBe('new')
    w.bindings.rebind('dodge', 'KeyZ')
    w.bindings.rebind('attackLight', 'Pad3')
    expect(w.bindings.loadProfile(0)).toBe(true)
    expect([w.input.binds.keyboard.KeyQ, w.input.binds.keyboard.KeyZ], '键盘那一半回到存盒那一刻')
      .toEqual(['dodge', undefined])
    /**
     * 手柄那一半跟着一起回来，而 `Pad3` 不是空的——`movePadRow` 是**交换**不是覆盖（KI-343），
     * 存盒之后那一步把 `interact` 换进了 `attackLight` 腾出的 `Pad2`，于是盒子里 `Pad3` 仍写着它当时的主人。
     * 这一格写成 `undefined` 是我把「请回那一盒」读成了「把后来那一步删掉」：盒子记的是当时整张表，
     * 后来那一步从来不在里面。判据不变（两半一起回），改的是取证。
     */
    expect([w.input.binds.padButtons[2], w.input.binds.padButtons[3]], '手柄那一半也一起回来了：没有「只回键盘那一半」这一档')
      .toEqual(['attackLight', 'interact'])
    expect(w.input.binds.padButtons[13], '连交换的另一头也回来了：轻击原本那把（十字下）此刻住着 parry').toBe('parry')
    expect(w.bindings.getProfiles(), '三盒仍是那三盒（格数由 `PROFILE_SLOTS` 说，抄进测试就是第二个主人）').toHaveLength(PROFILE_SLOTS)
  })

  it('两份「无」名单也在盒里：键盘那份与手柄那份各自随盒子回来', () => {
    const w = makeWorld()
    w.bindings.unbind('lockOn')
    expect(w.bindings.unbindPad('dodge'), '手柄那侧的「无」是另一句（KI-346 每表一份）').toBe(true)
    expect(w.bindings.storeProfile(0)).toBe('new')
    w.bindings.rebind('lockOn', 'KeyK')
    w.bindings.rebind('dodge', 'KeyJ')
    expect(w.bindings.loadProfile(0)).toBe(true)
    const g = w.bindings.get().gameplay
    expect(g.unbound, '键盘那份名单回来').toContain('lockOn')
    expect(g.padUnbound, '手柄那份名单回来').toContain('dodge')
    expect(g.keyboard.KeyK, '名单回来之前那一格先被盒子抹掉：磁带里那张才是此刻那张').toBeUndefined()
  })

  it('跟档走：save → 新世界 load ⇒ 盒里那两把线还在，而现表与磁带仍是两块各写各的', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    w.bindings.setTriggerThreshold(0.7)
    w.bindings.setStickThreshold(0.4)
    expect(w.bindings.storeProfile(0)).toBe('new')
    /**
     * 存完之后把现表再拧一次：不拧这一步，「现表那一格读的是档里现表、不是磁带」就量不出来——
     * 两份数一样的时候，「磁带没换现表」与「磁带换了现表」在量具上是同一串。
     */
    w.bindings.setTriggerThreshold(0.25)
    w.bindings.setStickThreshold(0.9)
    await w.saves.save('ki366')
    const w2 = makeWorld(store)
    await w2.saves.load('ki366')
    const tape = w2.bindings.getProfiles()![0]
    expect(tape && boxOf(tape).gameplay, '磁带回来了').toBeTruthy()
    expect((boxOf(tape).gameplay as Record<string, unknown>).triggerThreshold, '盒里那把拐点在档上躺着').toBe(0.7)
    expect((boxOf(tape).ui as Record<string, unknown>).stickThreshold, '盒里那把阈值也在').toBe(0.4)
    expect(w2.bindings.get().gameplay.triggerThreshold, '而**现表**读的是档里现表那一格（0.25），不是磁带那一格：载入磁带只有玩家按那一行')
      .toBe(0.25)
    expect(w2.bindings.get().ui.stickThreshold, '阈值那一路同一条裁决：两块各写各的').toBe(0.9)
    expect(w2.bindings.profileFlags(), '三盒的存在感复原（第一盒满、其余空）').toEqual([true, false, false])
    expect(w2.input.binds.triggerThreshold, '新世界玩家手里那一份就是现表那一格，不是盒里那一格').toBe(0.25)
    expect(w2.bindings.loadProfile(0), '玩家真按下去才算换表').toBe(true)
    expect(w2.input.binds.triggerThreshold, '按了后那一刻，玩家手里才变成盒里的数').toBe(0.7)
  })
})
