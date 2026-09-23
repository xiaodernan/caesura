import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT, TICK_HZ } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import type { Enemy } from '@/ai/Enemy'
import { isSfxKey, SFX_KEYS, type SfxKey } from '@/audio/synth'
import { muffleRamp } from '@/audio/AudioEngine'

/**
 * §5.4 处决的听感（KI-003）：以前那一刀借的是和弦爆的 `chord_slam` 与通用的 `death_shatter`，
 * 而世界也照常响着——audio.md 写的却是「音叉巨剑消音：一切声音 80ms 内塌向 100Hz 低通」。
 * 这一份钉三件事：①专属音色真的被发出来了（静杀那条走的是另一支）；②消音**成对**——
 * 演出开始有 on:true，演出结束（或中途被换武器打断）必须有 on:false，漏掉后半就是世界被永久闷住；
 * ③塌下去/回来的读数与 spec 一致（这几个数是 spec 的读数，不是引擎的口味）。
 */

registerGameData()

const FOE = 'en_murkshell'

function world() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const sword = registry.get<WeaponData>('wp_tuning_sword')
  const msOf = (w: WeaponData): MovesetData => registry.get<MovesetData>(`moveset:${w.movesetId}`)
  const player = new PlayerController(playerBase, sword, msOf(sword))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  player.stats.hp = 9_999_999
  player.stats.hpMax = 9_999_999
  player.stats.poiseMax = 9_999_999
  player.stats.stamina = 9_999
  player.stats.overdrive = 9_999

  const muffles: boolean[] = []
  const sfx: string[] = []
  const offs = [
    bus.on('audio.muffle', (p) => muffles.push(p.on)),
    bus.on('audio.sfx', (p) => sfx.push(p.key))
  ]
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.reset()
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input, TICK_DT)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  /** 一只被打到可处决的敌人：破势 + 血量到位，站得离玩家一步之内 */
  function victim(hpLeft: number): Enemy {
    const e = ai.spawn(FOE, { x: 0, y: 0, z: -1.5 }, 'exec')
    e.skipIntro()
    e.stats.hpMax = 100
    e.stats.hp = hpLeft
    e.stats.crumpleTicksLeft = 600
    e.enter('recover')
    return e
  }
  const off = (): void => { for (const f of offs) f() }
  return { time, rhythm, player, ai, combat, frame, tick, muffles, sfx, victim, off }
}

describe('§5.4 处决的消音与专属音色（KI-003）', () => {
  it('真处决一次：音色是 execute_rest，消音成对，且关掉的时机就是演出走完那一 tick', () => {
    const w = world()
    const e = w.victim(20)
    w.frame.edges.add('interact')
    w.tick()
    expect(w.player.executing, '处决演出没起来：这条在量空气').not.toBeNull()
    expect(w.sfx).toContain('execute_rest')
    expect(w.sfx, '不该再借和弦爆占位').not.toContain('chord_slam')
    // 边沿判定在 combat.update 末尾（仲裁者）：开与演出点着同 tick，关与演出结束同 tick
    expect(w.muffles, '演出开始：世界塌下去').toEqual([true])
    const onAt = w.time.tick
    const total = w.player.executing ? w.player.executing.total : 0
    for (let i = 0; i < total + 8 && !w.muffles.includes(false); i++) w.tick()
    expect(w.muffles.filter((x) => !x).length, '只关一次（重复关是噪声）').toBe(1)
    // 演出占 `total` 格（含头含尾），所以"开"与"关"两个沿之间隔的是 total-1 个 tick
    expect(w.time.tick - onAt, '消音的长度 = 演出的长度（`execution.durationTicks` 说的）').toBe(total)
    expect(w.player.executing).toBeNull()
    expect(e.alive, '处决真的把这一只带走了').toBe(false)
    w.off()
  })

  it('静杀（潜行秒杀）不喊那一声音叉：它的设计就是没有声音', () => {
    const w = world()
    // 静杀的判据是 kind B：没警觉 + 背后锥内 + 血量到位（`stealthKillFrac`），跟破势那条不是一回事
    const e = w.ai.spawn(FOE, { x: 0, y: 0, z: -1.5 }, 'silent')
    e.enter('idle')
    e.alertness = 0
    e.home = { x: 0, y: 0, z: -4 }
    e.yaw = Math.PI // 背对着站在原点的玩家：B 类处决的判据是没警觉 + 背后锥内 + 血量到位
    e.stats.damage(Math.round(e.stats.hpMax * 0.8))
    w.frame.edges.add('interact')
    w.tick(2)
    expect(w.sfx, '静杀那一刀不该喊音叉').not.toContain('execute_rest')
    expect(w.muffles, '但消音照样要有：静杀也是「让声音死」').toEqual([true])
    const total = playerBase.execution.durationTicks
    w.tick(total + 3)
    expect(w.muffles).toEqual([true, false])
    expect(e.alive, '静杀把这一只带走了').toBe(false)
    w.off()
  })

  it('演出中途换武器：消音必须跟着关掉——漏掉后半，世界就永久闷着', () => {
    const w = world()
    w.victim(20)
    w.frame.edges.add('interact')
    w.tick(2)
    expect(w.muffles).toEqual([true])
    const gs = registry.get<WeaponData>('wp_fortissimo_greatsword')
    w.player.equip(gs, registry.get<MovesetData>(`moveset:${gs.movesetId}`))
    w.tick()
    expect(w.player.executing, '换装把演出清空了').toBeNull()
    expect(w.muffles, '而低通跟着回到全开（这条就是当年最容易漏的那一半）').toEqual([true, false])
    w.off()
  })

  it('消音的读数与 audio.md 一致：塌到 100Hz / 80ms 进，回全开 / 180ms 出', () => {
    expect(muffleRamp(true), '§破处决：一切声音 80ms 内塌向 100Hz 低通').toEqual({ hz: 100, seconds: 0.08 })
    expect(muffleRamp(false), '§5 休止出入：250ms 入 180ms 出，出去用的是同一个 180ms')
      .toEqual({ hz: 20000, seconds: 0.18 })
  })

  it('音色键是注册过的（拼错的 key 会被引擎当未知音色静丢掉）', () => {
    const key: SfxKey = 'execute_rest'
    expect(isSfxKey(key), 'CombatManager 发的是这个名字').toBe(true)
    expect(SFX_KEYS).toContain(key)
    expect(Math.round(TICK_HZ * 0.08), '80ms 塌下去，短于一次挥击——它是"抽走空气"不是"卡住"').toBeLessThan(6)
  })
})
