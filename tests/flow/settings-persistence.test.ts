import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import { bus } from '@/core/EventBus'
import { Input, INPUT_BUFFER_SEC } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { CameraRig } from '@/player/CameraRig'
import { Haptics } from '@/input/Haptics'
import { AISystem } from '@/ai/AISystem'
import { newAttack } from '@/ai/Enemy'
import { CombatManager } from '@/combat/CombatManager'
import { StreamingSystem } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import { RpgRuntime } from '@/rpg/Runtime'
import { SaveGame, MapStore, READABLE_VERSIONS, SAVE_VERSION, migrateV12toV13 } from '@/save/Serializer'
import { wrap } from '@/save/Integrity'
import {
  DEFAULT_GAMEPLAY_SETTINGS,
  GameplaySettingsStore,
  clampGameplaySettings
} from '@/settings/GameplaySettings'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * KI-026 设置持久化：AudioEngine 的音量跟档走。
 * save → load ⇒ 五通道音量逐格复原。改表不经过 AudioEngine 的就是白改。
 * KI-112 第一腿：玩法/辅助设置（settings.gameplay）跟档走——五格各有真实消费者
 * （Input.bufferSec/frameAssist、CameraRig.shakeIntensity、Haptics.scale、CombatManager.damageScale），
 * v12→v13 迁移，老档缺块 ⇒ 消费者原地不动（§78）。
 */
registerGameData()

Object.defineProperty(globalThis, 'innerWidth', { value: 1280, configurable: true })
Object.defineProperty(globalThis, 'innerHeight', { value: 720, configurable: true })
beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  g.window ??= { addEventListener: () => {} }
})

/** Input 构造要挂 el 监听；headless 里给个什么都不做的壳（同 tests/unit/input-device 的口径） */
class FakeEl {
  handlers: Record<string, ((e: unknown) => void)[]> = {}
  addEventListener(t: string, fn: (e: unknown) => void): void { (this.handlers[t] ??= []).push(fn) }
  requestPointerLock(): void { /* 无头，不锁 */ }
}

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

/** 音频桩件：不建图也能记 setVolume/getVolume（AudioEngine 的 pendingVolumes 同一套逻辑） */
function makeFakeAudio() {
  const vols = new Map<string, number>()
  return {
    setVolume: (bus: string, v: number) => { vols.set(bus, Math.max(0, Math.min(1, v))) },
    getVolume: (bus: string) => vols.get(bus) ?? 1,
    vols,
  }
}

function makeWorld(store = new MapStore(), audio = makeFakeAudio()) {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime('origin_tuner')
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const streaming = new StreamingSystem(regions)
  const cellKey = (p: Vec3): string => { const c = streaming.cellOf(p); return `${c.cx},${c.cy},${c.cz}` }
  const spawner = new SpawnDirector(regions, {
    spawn: (id, pos, sd) => ai.spawn(id, pos, sd),
    despawn: (id) => ai.despawn(id),
    hasFlag: (k) => streaming.hasFlag(k)
  }, cellKey)
  // KI-112：设置靶用真消费者（四件的公开字段就是生产形状），store 构造即灌一遍
  const input = new Input(new FakeEl() as unknown as HTMLElement)
  const rig = new CameraRig()
  const haptics = new Haptics(input)
  const settings = new GameplaySettingsStore({ input, rig, haptics, combat })
  const saves = new SaveGame({ player, streaming, spawner, clock: rhythm, time, rpg, audio, gameplay: { get: () => settings.get(), apply: (raw: unknown) => settings.restore(raw) } }, store)
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      rhythm.update(TICK_DT)
    }
  }
  player.camYawRef = 0
  return { time, rhythm, player, rpg, saves, tick, store, audio, settings, input, rig, haptics, combat, ai, streaming, spawner }
}

describe('KI-026 设置持久化：音频音量跟档走', () => {
  it('改音量 → save → 新世界 load ⇒ 音量逐格复原', async () => {
    const store = new MapStore()
    const audio1 = makeFakeAudio()
    const w = makeWorld(store, audio1)
    // 玩家把音乐调低、SFX 调高
    audio1.setVolume('music', 0.3)
    audio1.setVolume('sfx', 0.9)
    audio1.setVolume('master', 0.7)
    w.tick(2)
    await w.saves.save('settings')
    // 新世界：默认音量
    const audio2 = makeFakeAudio()
    const w2 = makeWorld(store, audio2)
    expect(audio2.getVolume('music'), '新世界默认 1.0').toBe(1)
    await w2.saves.load('settings')
    expect(audio2.getVolume('music'), '音乐音量复原 0.3').toBe(0.3)
    expect(audio2.getVolume('sfx'), 'SFX 音量复原 0.9').toBe(0.9)
    expect(audio2.getVolume('master'), '总音量复原 0.7').toBe(0.7)
    expect(audio2.getVolume('ambience'), '没改过的通道走默认 1.0').toBe(1)
  })

  it('不存档就不复原：两个独立世界的音量互不影响', () => {
    const a1 = makeFakeAudio()
    const a2 = makeFakeAudio()
    a1.setVolume('music', 0.2)
    expect(a2.getVolume('music'), '独立世界的音量是独立的').toBe(1)
  })
})

/* ---------------------------------------------------------------------------
 * KI-112 第一腿：玩法/辅助设置（settings.gameplay）
 * ------------------------------------------------------------------------- */

describe('KI-112 clampGameplaySettings：信任边界', () => {
  it('全缺/垃圾输入 ⇒ 逐格默认', () => {
    expect(clampGameplaySettings(undefined), '老档没这格').toEqual(DEFAULT_GAMEPLAY_SETTINGS)
    expect(clampGameplaySettings(null)).toEqual(DEFAULT_GAMEPLAY_SETTINGS)
    expect(clampGameplaySettings('junk'), '字符串不是对象形状').toEqual(DEFAULT_GAMEPLAY_SETTINGS)
  })

  it('错型 ⇒ 默认（档可以被手改成任何东西）', () => {
    const out = clampGameplaySettings({ bufferMs: '120', frameAssist: 1, shakeScale: null, rumbleScale: '2', damageScale: false })
    expect(out.bufferMs, '字符串不是数').toBe(200)
    expect(out.frameAssist, '1 不是 boolean').toBe(false)
    expect(out.shakeScale).toBe(1)
    expect(out.rumbleScale).toBe(1)
    expect(out.damageScale).toBe(1)
  })

  it('NaN/Infinity ⇒ 默认；界内数不误伤', () => {
    const out = clampGameplaySettings({ bufferMs: Number.NaN, shakeScale: Number.POSITIVE_INFINITY, damageScale: 1.1 })
    expect(out.bufferMs).toBe(200)
    expect(out.shakeScale).toBe(1)
    expect(out.damageScale, '1.1 在 70–130% 界内，原样通过').toBe(1.1)
  })

  it('越界 ⇒ 夹取：四个数值格各量两头（80–240 / 0–1.5 / 0–2 / 0.7–1.3）', () => {
    const lo = clampGameplaySettings({ bufferMs: 30, shakeScale: 2, rumbleScale: 5, damageScale: 0.5 })
    expect(lo.bufferMs, 'ui-ux §5.1 滑条下限 80').toBe(80)
    expect(lo.shakeScale, 'combat.md §10 上限 150%').toBe(1.5)
    expect(lo.rumbleScale, 'ui-ux §6 上限 200%').toBe(2)
    expect(lo.damageScale, 'gameplay.md:312 下限 70%').toBe(0.7)
    const hi = clampGameplaySettings({ bufferMs: 999, shakeScale: -1, rumbleScale: -0.5, damageScale: 9 })
    expect(hi.bufferMs).toBe(240)
    expect(hi.shakeScale).toBe(0)
    expect(hi.rumbleScale).toBe(0)
    expect(hi.damageScale).toBe(1.3)
  })

  it('返回新对象，不吃调用方的引用', () => {
    const raw = { bufferMs: 120 }
    const out = clampGameplaySettings(raw)
    expect(out).not.toBe(raw)
    expect(raw).toEqual({ bufferMs: 120 })
    out.bufferMs = 1
    expect(clampGameplaySettings(raw).bufferMs, '改返回值不影响下一次夹取').toBe(120)
  })
})

describe('KI-112 GameplaySettingsStore：设置→四路消费者', () => {
  it('set 灌四路：bufferMs→秒、frameAssist、shakeIntensity、scale、damageScale', () => {
    const w = makeWorld()
    w.settings.set({ bufferMs: 120, frameAssist: true, shakeScale: 0.4, rumbleScale: 1.8, damageScale: 0.7 })
    expect(w.input.bufferSec, '毫秒→秒（Input 的尺是秒）').toBeCloseTo(0.12, 10)
    expect(w.input.frameAssist).toBe(true)
    expect(w.rig.shakeIntensity, 'shakeScale 直达 CameraRig 既有字段').toBe(0.4)
    expect(w.haptics.scale).toBe(1.8)
    expect(w.combat.damageScale).toBe(0.7)
  })

  it('set 越界被夹取后才灌——消费者见不到界外的数', () => {
    const w = makeWorld()
    w.settings.set({ bufferMs: 30, shakeScale: 9, rumbleScale: -3, damageScale: 42 })
    expect(w.input.bufferSec).toBeCloseTo(0.08, 10)
    expect(w.rig.shakeIntensity).toBe(1.5)
    expect(w.haptics.scale).toBe(0)
    expect(w.combat.damageScale).toBe(1.3)
  })

  it('restore(undefined/null)（老档无 gameplay 块）⇒ 消费者原地不动', () => {
    const w = makeWorld()
    w.settings.set({ bufferMs: 150, shakeScale: 0.2 })
    w.settings.restore(undefined)
    w.settings.restore(null)
    expect(w.settings.get().bufferMs, '§78：留空是如实，不是"重置成默认"').toBe(150)
    expect(w.input.bufferSec).toBeCloseTo(0.15, 10)
    expect(w.rig.shakeIntensity).toBe(0.2)
  })

  it('restore(手改档) ⇒ 夹取后生效，不炸', () => {
    const w = makeWorld()
    w.settings.restore({ bufferMs: 999, frameAssist: 'yes', shakeScale: 0.6 })
    expect(w.settings.get().bufferMs).toBe(240)
    expect(w.settings.get().frameAssist).toBe(false)
    expect(w.rig.shakeIntensity).toBe(0.6)
  })
})

describe('KI-112 Input：缓冲窗口吃设置', () => {
  it('默认窗口 = INPUT_BUFFER_SEC（0.2s）、frameAssist 默认关——不碰设置手感不变', () => {
    const w = makeWorld()
    expect(w.input.bufferSec).toBe(INPUT_BUFFER_SEC)
    expect(w.input.bufferSec).toBe(0.2)
    expect(w.input.frameAssist).toBe(false)
  })

  it('bufferSec=0.08：3 tick（50ms）活着、12 tick（200ms）早已死', () => {
    const w = makeWorld()
    w.input.bufferSec = 0.08
    w.input.buffer('dodge')
    for (let i = 0; i < 3; i++) w.input.poll(TICK_DT)
    expect(w.input.frame.edges.has('dodge'), '80ms 窗在 50ms 处活着').toBe(true)
    for (let i = 0; i < 9; i++) w.input.poll(TICK_DT)
    expect(w.input.frame.edges.has('dodge'), '200ms ≫ 80ms，早该死了').toBe(false)
  })

  it('frameAssist=+1 tick：5 tick（83.3ms）处无辅助已死、有辅助还活着', () => {
    // 两条腿都在离边界一个 tick 以上的地方断言，不吃浮点毛边
    const w = makeWorld()
    w.input.bufferSec = 0.08
    w.input.buffer('dodge')
    for (let i = 0; i < 5; i++) w.input.poll(TICK_DT)
    expect(w.input.frame.edges.has('dodge'), '83.3ms > 80ms：无辅助必死').toBe(false)

    const w2 = makeWorld()
    w2.settings.set({ bufferMs: 80, frameAssist: true })
    expect(w2.input.bufferSec).toBeCloseTo(0.08, 10)
    w2.input.buffer('dodge')
    for (let i = 0; i < 5; i++) w2.input.poll(TICK_DT)
    expect(w2.input.frame.edges.has('dodge'), '辅助窗 96.7ms：83.3ms 处还活着').toBe(true)
    for (let i = 0; i < 12; i++) w2.input.poll(TICK_DT)
    expect(w2.input.frame.edges.has('dodge'), '200ms ≫ 96.7ms，辅助也不是永生').toBe(false)
  })
})

describe('KI-112 Haptics：rumbleScale', () => {
  it('幅值乘倍率、Gamepad API 顶格 1 截断、时长不缩放', () => {
    const calls2: Record<string, number>[] = []
    const callsHalf: Record<string, number>[] = []
    const pad = (sink: Record<string, number>[]) => ({
      vibrationActuator: { playEffect: (_t: string, p: Record<string, number>) => { sink.push(p) } }
    })
    const h2 = new Haptics({ gamepad: pad(calls2) } as unknown as Input)
    const hHalf = new Haptics({ gamepad: pad(callsHalf) } as unknown as Input)
    h2.scale = 2
    hHalf.scale = 0.5
    // 一发 boss（表值 strong 1.0 / weak 0.8 / 320ms）同时喂两个实例：一发双读。
    // 载荷形状照 EventBus 的 combat.hit 配齐（订阅方只读 shakeKey，但形状不该撒谎）
    bus.emit('combat.hit', {
      attackerId: 'en_test', victimId: 'player', damage: 10, poiseDamage: 0,
      kind: 'enemy', point: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: 1 },
      result: 'hit', hitStopMs: 0, shakeKey: 'boss', backstab: false, weakpoint: false
    })
    expect(calls2[0].strongMagnitude, '2× 的 1.0 在 API 顶格 1 截断').toBe(1)
    expect(calls2[0].weakMagnitude, '0.8×2=1.6 → 1').toBe(1)
    expect(calls2[0].duration, '时长不乘倍率：200% 是更用力，不是振更久').toBe(320)
    expect(callsHalf[0].strongMagnitude).toBeCloseTo(0.5)
    expect(callsHalf[0].weakMagnitude).toBeCloseTo(0.4)
    expect(callsHalf[0].duration).toBe(320)
  })
})

describe('KI-112 CombatManager.damageScale：玩家收到的那一份', () => {
  /**
   * 同一颗种子、同一条管线，只有倍率不同：量「敌人第一下打掉多少血」。
   * 攻击是**手动钉**的（shellburst，环形判定不吃朝向，出生距离 1.5m 在 [0.3, 2.2] 环内）：
   * AI 自选攻击吃的是敌人侧 rng（每次 spawn 种子都不同——探针里三个世界的第一下分别在
   * tick 86/171/86，那次比较不成立）。钉死之后三个世界唯一不同的是倍率本身，命中的
   * 方差抽签是 Rng('combat') 同一颗种子上的同一次抽签 ⇒ 三档严格可比。
   */
  function firstHitDamage(damageScale: number): number {
    const w = makeWorld()
    w.combat.damageScale = damageScale
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.5 }, 'ki112')
    e.alertness = 100
    const spec = e.data.attacks.find((a) => a.id === 'shellburst')!
    e.attack = newAttack(spec, spec.frames.activeStart - 1)
    e.enter('combat')
    for (let t = 0; t < 900; t++) {
      w.tick()
      const missing = w.player.stats.hpMax - w.player.stats.hp
      if (missing > 0) return missing
    }
    throw new Error('900 tick 内敌人没打到玩家一下——量具失效，不是生产代码的错')
  }

  it('1.3 档第一下比默认痛、0.7 档比默认轻（倍率真的到达 1292 那条管线）', () => {
    const base = firstHitDamage(1)
    const up = firstHitDamage(1.3)
    const down = firstHitDamage(0.7)
    expect(up, '130% 档更痛').toBeGreaterThan(base)
    expect(down, '70% 档更轻').toBeLessThan(base)
  }, 20000)
})

describe('KI-112 v12→v13 迁移', () => {
  type Raw = { snapshot: { version: number; settings: { audio: Record<string, number>; gameplay?: Record<string, unknown> } } }

  it('migrateV12toV13：版本到 13；没有 gameplay 块就不写（§78 留空是如实）；已有的原样保留', () => {
    const noBlock = migrateV12toV13({ snapshot: { version: 12, settings: { audio: { music: 0.5 } } } }) as unknown as Raw
    expect(noBlock.snapshot.version).toBe(13)
    expect(noBlock.snapshot.settings.gameplay, '不白送一份假默认').toBeUndefined()
    expect(noBlock.snapshot.settings.audio).toEqual({ music: 0.5 })
    const withBlock = migrateV12toV13({ snapshot: { version: 12, settings: { audio: {}, gameplay: { bufferMs: 100 } } } }) as unknown as Raw
    expect(withBlock.snapshot.version).toBe(13)
    expect(withBlock.snapshot.settings.gameplay).toEqual({ bufferMs: 100 })
  })

  it('迁移链在册：READABLE_VERSIONS 覆盖 12 ⇒ 真读档路径跑得到这条迁移', () => {
    expect(READABLE_VERSIONS).toContain(12)
    expect(READABLE_VERSIONS).toContain(13)
  })

  it('真 v12 形状的档经读档路径读入：gameplay 缺格 ⇒ 消费者不动；audio 半边照常复原', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    w.settings.set({ bufferMs: 120, frameAssist: true })
    const v12 = wrap(12, {
      snapshot: {
        version: 12, playSec: 1, savedAt: null, regionId: null,
        player: { x: 0, y: 0, z: 0, hp: 90, stamina: 80, overdrive: 0, weaponId: 'wp_tuning_sword', corruption: 0 },
        flags: [], clearedSlots: [], usedInteractables: [], brokenProps: [],
        settings: { audio: { music: 0.4 } },
        rpg: null, quest: null, states: {}
      }
    })
    await store.set('settings', v12)
    await w.saves.load('settings')
    expect(w.settings.get().bufferMs, 'v12 档没有 gameplay 块 ⇒ 保持当前值').toBe(120)
    expect(w.input.frameAssist, '同一条 §78：不重置成默认（默认是 false，当前值是 true）').toBe(true)
    expect(w.audio.getVolume('music'), 'KI-026 的 audio 半边照常').toBe(0.4)
  })
})

describe('KI-112 设置持久化：gameplay 跟档走', () => {
  it('改五格 → save → 档里真的有这块 → 新世界 load ⇒ 五路消费者逐格复原', async () => {
    const store = new MapStore()
    const w = makeWorld(store)
    w.settings.set({ bufferMs: 240, frameAssist: true, shakeScale: 1.5, rumbleScale: 2, damageScale: 0.7 })
    w.tick(2)
    await w.saves.save('settings')
    // wrap 的信封是 { magic, schemaVersion, crc, payload }，快照住在 payload 里
    const stored = JSON.parse((await store.get('settings'))!) as { payload: { snapshot: { version: number; settings: { gameplay: Record<string, unknown> } } } }
    // KI-112 那一批写这条腿时它是 13；键位数据化（KI-336）把档升到 14，那条字面量当场红——
    // 这条腿问的是"今天存出去的档带今天的号"，所以号从唯一主人那里读，不再抄第二份。
    expect(stored.payload.snapshot.version, '写档走的版本 = SAVE_VERSION').toBe(SAVE_VERSION)
    expect(stored.payload.snapshot.settings.gameplay).toEqual({ bufferMs: 240, frameAssist: true, shakeScale: 1.5, rumbleScale: 2, damageScale: 0.7 })

    const w2 = makeWorld(store)
    expect(w2.input.bufferSec, '新世界从默认起手').toBe(0.2)
    expect(w2.rig.shakeIntensity).toBe(1)
    await w2.saves.load('settings')
    expect(w2.settings.get()).toEqual({ bufferMs: 240, frameAssist: true, shakeScale: 1.5, rumbleScale: 2, damageScale: 0.7 })
    expect(w2.input.bufferSec, '240ms→秒').toBeCloseTo(0.24, 10)
    expect(w2.input.frameAssist).toBe(true)
    expect(w2.rig.shakeIntensity).toBe(1.5)
    expect(w2.haptics.scale).toBe(2)
    expect(w2.combat.damageScale).toBe(0.7)
  })

  it('老档（无 gameplay 块）load ⇒ 消费者保持当前值，不被重置成默认', async () => {
    const store = new MapStore()
    const w1 = makeWorld(store)
    // 不接 gameplay 把手的世界写出的档（等价 v12 时代的存档内容形状）
    const legacy = new SaveGame({ player: w1.player, streaming: w1.streaming, spawner: w1.spawner, clock: w1.rhythm, time: w1.time, rpg: w1.rpg, audio: w1.audio }, store)
    await legacy.save('settings')

    const w2 = makeWorld(store)
    w2.settings.set({ bufferMs: 150, shakeScale: 0.3, damageScale: 1.2 })
    await w2.saves.load('settings')
    expect(w2.settings.get().bufferMs, '老档没记过 gameplay ⇒ 不许动').toBe(150)
    expect(w2.input.bufferSec).toBeCloseTo(0.15, 10)
    expect(w2.rig.shakeIntensity).toBe(0.3)
    expect(w2.combat.damageScale).toBe(1.2)
  })
})
