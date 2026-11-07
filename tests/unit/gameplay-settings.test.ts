import { describe, expect, it } from 'vitest'
import {
  clampGameplaySettings,
  DEFAULT_GAMEPLAY_SETTINGS,
  GAMEPLAY_BOUNDS,
  GameplaySettingsStore,
} from '@/settings/GameplaySettings'

/**
 * `src/settings/GameplaySettings.ts`：玩法/辅助设置的信任边界。
 *
 * 存档里的数谁都能写，`clampGameplaySettings` 是读档路径上唯一被信任的入口：
 * 缺格/错型回默认，越界夹取，NaN 回默认。返回全新对象，不污染调用方 raw。
 *
 * 消费者（Input/CameraRig/Haptics/CombatManager/PlayerController）只认自己字段，
 * `GameplaySettingsStore.applyToTargets` 把已夹取的值灌进去。
 */

describe('DEFAULT_GAMEPLAY_SETTINGS：出厂默认与规格一致', () => {
  it('八格全部有值，boolean 格为布尔，数值格在对应界内', () => {
    expect(DEFAULT_GAMEPLAY_SETTINGS.bufferMs).toBe(200)
    expect(DEFAULT_GAMEPLAY_SETTINGS.bufferMs).toBeGreaterThanOrEqual(GAMEPLAY_BOUNDS.bufferMs.min)
    expect(DEFAULT_GAMEPLAY_SETTINGS.bufferMs).toBeLessThanOrEqual(GAMEPLAY_BOUNDS.bufferMs.max)
    expect(typeof DEFAULT_GAMEPLAY_SETTINGS.frameAssist).toBe('boolean')
    expect(DEFAULT_GAMEPLAY_SETTINGS.shakeScale).toBe(1)
    expect(DEFAULT_GAMEPLAY_SETTINGS.shakeScale).toBeGreaterThanOrEqual(GAMEPLAY_BOUNDS.shakeScale.min)
    expect(DEFAULT_GAMEPLAY_SETTINGS.shakeScale).toBeLessThanOrEqual(GAMEPLAY_BOUNDS.shakeScale.max)
    expect(DEFAULT_GAMEPLAY_SETTINGS.rumbleScale).toBe(1)
    expect(DEFAULT_GAMEPLAY_SETTINGS.rumbleWeakScale).toBe(1)
    expect(DEFAULT_GAMEPLAY_SETTINGS.damageScale).toBe(1)
    expect(DEFAULT_GAMEPLAY_SETTINGS.holdMs).toBe(200)
    expect(typeof DEFAULT_GAMEPLAY_SETTINGS.mashGuard).toBe('boolean')
  })
})

describe('GAMEPLAY_BOUNDS：数值格的界与规格出处一一对应', () => {
  it('bufferMs 80~240，shakeScale 0~1.5，rumble 0~2，damage 0.7~1.3，holdMs 200~800', () => {
    expect(GAMEPLAY_BOUNDS.bufferMs).toEqual({ min: 80, max: 240 })
    expect(GAMEPLAY_BOUNDS.shakeScale).toEqual({ min: 0, max: 1.5 })
    expect(GAMEPLAY_BOUNDS.rumbleScale).toEqual({ min: 0, max: 2 })
    expect(GAMEPLAY_BOUNDS.rumbleWeakScale).toEqual({ min: 0, max: 2 })
    expect(GAMEPLAY_BOUNDS.damageScale).toEqual({ min: 0.7, max: 1.3 })
    expect(GAMEPLAY_BOUNDS.holdMs).toEqual({ min: 200, max: 800 })
  })
})

describe('clampGameplaySettings：信任边界，缺格/错型/越界/NaN 皆回默认或夹取', () => {
  it('undefined/null/raw 不是对象 ⇒ 全默认', () => {
    expect(clampGameplaySettings(undefined)).toEqual(DEFAULT_GAMEPLAY_SETTINGS)
    expect(clampGameplaySettings(null)).toEqual(DEFAULT_GAMEPLAY_SETTINGS)
    expect(clampGameplaySettings('nope')).toEqual(DEFAULT_GAMEPLAY_SETTINGS)
    expect(clampGameplaySettings(42)).toEqual(DEFAULT_GAMEPLAY_SETTINGS)
  })

  it('缺格 ⇒ 该格默认，其余格原样', () => {
    const out = clampGameplaySettings({ bufferMs: 150 })
    expect(out.bufferMs).toBe(150)
    expect(out.frameAssist).toBe(DEFAULT_GAMEPLAY_SETTINGS.frameAssist)
    expect(out.shakeScale).toBe(DEFAULT_GAMEPLAY_SETTINGS.shakeScale)
    expect(out.rumbleScale).toBe(DEFAULT_GAMEPLAY_SETTINGS.rumbleScale)
    expect(out.rumbleWeakScale).toBe(DEFAULT_GAMEPLAY_SETTINGS.rumbleWeakScale)
    expect(out.damageScale).toBe(DEFAULT_GAMEPLAY_SETTINGS.damageScale)
    expect(out.holdMs).toBe(DEFAULT_GAMEPLAY_SETTINGS.holdMs)
    expect(out.mashGuard).toBe(DEFAULT_GAMEPLAY_SETTINGS.mashGuard)
  })

  it('错型（非 number）⇒ 该格默认，boolean 格非布尔 ⇒ 默认', () => {
    const out = clampGameplaySettings({
      bufferMs: '200',
      shakeScale: true,
      rumbleScale: null,
      holdMs: '200',
      frameAssist: 'yes',
      mashGuard: 1,
    })
    expect(out.bufferMs).toBe(DEFAULT_GAMEPLAY_SETTINGS.bufferMs)
    expect(out.shakeScale).toBe(DEFAULT_GAMEPLAY_SETTINGS.shakeScale)
    expect(out.rumbleScale).toBe(DEFAULT_GAMEPLAY_SETTINGS.rumbleScale)
    expect(out.holdMs).toBe(DEFAULT_GAMEPLAY_SETTINGS.holdMs)
    expect(out.frameAssist).toBe(DEFAULT_GAMEPLAY_SETTINGS.frameAssist)
    expect(out.mashGuard).toBe(DEFAULT_GAMEPLAY_SETTINGS.mashGuard)
  })

  it('越界 ⇒ 夹到界内；NaN ⇒ 默认', () => {
    const low = clampGameplaySettings({ bufferMs: 10, shakeScale: -5, damageScale: 0.1, holdMs: 50 })
    expect(low.bufferMs).toBe(80)
    expect(low.shakeScale).toBe(0)
    expect(low.damageScale).toBe(0.7)
    expect(low.holdMs).toBe(200)

    const high = clampGameplaySettings({ bufferMs: 999, shakeScale: 999, damageScale: 999, holdMs: 9999 })
    expect(high.bufferMs).toBe(240)
    expect(high.shakeScale).toBe(1.5)
    expect(high.damageScale).toBe(1.3)
    expect(high.holdMs).toBe(800)

    const nan = clampGameplaySettings({ bufferMs: NaN, shakeScale: NaN, damageScale: NaN, holdMs: NaN })
    expect(nan.bufferMs).toBe(DEFAULT_GAMEPLAY_SETTINGS.bufferMs)
    expect(nan.shakeScale).toBe(DEFAULT_GAMEPLAY_SETTINGS.shakeScale)
    expect(nan.damageScale).toBe(DEFAULT_GAMEPLAY_SETTINGS.damageScale)
    expect(nan.holdMs).toBe(DEFAULT_GAMEPLAY_SETTINGS.holdMs)
  })

  it('返回全新对象，不污染 raw', () => {
    const raw = { bufferMs: 150, shakeScale: 1.2 }
    const out = clampGameplaySettings(raw)
    expect(out).not.toBe(raw)
    expect(raw.bufferMs).toBe(150)
    expect(raw.shakeScale).toBe(1.2)
    expect(out.bufferMs).toBe(150)
    expect(out.shakeScale).toBe(1.2)
  })
})

describe('GameplaySettingsStore：运行时宿主，set 走信任边界，restore 读档入口', () => {
  const targets = {
    input: { bufferSec: 0, frameAssist: false },
    rig: { shakeIntensity: 0 },
    haptics: { scale: 0, weakScale: 0 },
    combat: { damageScale: 0 },
    player: { holdMs: 0, mashGuard: false },
  }

  it('构造：initial 走 clamp，targets 为 null 时不灌', () => {
    const s = new GameplaySettingsStore(null, { bufferMs: 999 })
    expect(s.get().bufferMs).toBe(240) // 越界夹取
    expect(s.get().frameAssist).toBe(false)
  })

  it('get：返回副本，修改不影响内部', () => {
    const s = new GameplaySettingsStore(targets)
    const g = s.get()
    g.bufferMs = 999
    expect(s.get().bufferMs).toBe(DEFAULT_GAMEPLAY_SETTINGS.bufferMs)
  })

  it('set：走 clamp，灌进 targets', () => {
    const s = new GameplaySettingsStore(targets)
    s.set({ bufferMs: 150, damageScale: 1.3, shakeScale: 2 })
    expect(s.get().bufferMs).toBe(150)
    expect(s.get().damageScale).toBe(1.3) // 越界夹取到 1.3
    expect(s.get().shakeScale).toBe(1.5) // 越界夹取到 1.5
    expect(targets.input.bufferSec).toBe(150 / 1000)
    expect(targets.combat.damageScale).toBe(1.3)
    expect(targets.rig.shakeIntensity).toBe(1.5)
  })

  it('set：错误型 ⇒ 该格回默认，其余格保持当前值', () => {
    const s = new GameplaySettingsStore(targets, { bufferMs: 150 })
    s.set({ bufferMs: 'nope' as unknown as number }) // 错型 ⇒ 该格回默认
    expect(s.get().bufferMs).toBe(DEFAULT_GAMEPLAY_SETTINGS.bufferMs)
    // 其他格不受影响（set 是合并语义：先展开当前，再覆盖 patch，patch 里错型的格会被 clamp 成默认）
    expect(s.get().shakeScale).toBe(DEFAULT_GAMEPLAY_SETTINGS.shakeScale)
  })

  it('restore：undefined/null ⇒ 不动；有块 ⇒ 夹取后生效', () => {
    const s = new GameplaySettingsStore(targets, { bufferMs: 150 })
    s.restore(undefined)
    expect(s.get().bufferMs).toBe(150) // 不动
    s.restore(null)
    expect(s.get().bufferMs).toBe(150) // 不动
    s.restore({ bufferMs: 100 })
    expect(s.get().bufferMs).toBe(100)
    s.restore({ bufferMs: NaN })
    expect(s.get().bufferMs).toBe(DEFAULT_GAMEPLAY_SETTINGS.bufferMs) // NaN ⇒ 默认
  })

  it('applyToTargets：bufferMs→秒，振动两把尺各灌各，holdMs→毫秒原样，mashGuard→布尔', () => {
    new GameplaySettingsStore(targets, {
      bufferMs: 200,
      rumbleScale: 0.5,
      rumbleWeakScale: 0.25,
      damageScale: 1.1,
      holdMs: 400,
      mashGuard: false,
    })
    expect(targets.input.bufferSec).toBe(0.2)
    expect(targets.haptics.scale).toBe(0.5)
    expect(targets.haptics.weakScale).toBe(0.25)
    expect(targets.combat.damageScale).toBe(1.1)
    expect(targets.player.holdMs).toBe(400)
    expect(targets.player.mashGuard).toBe(false)
  })
})
