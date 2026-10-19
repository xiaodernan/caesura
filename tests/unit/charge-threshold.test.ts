/**
 * KI-117② 的**单元级**契约锁：逐武器蓄满阈值（`MovesetData.chargeTicks`）。
 *
 * 为什么需要这一份（而不是只有 flow + 文档对账）：
 *  - `charge-feedback.test.ts` 只测**默认轻剑**（省略 `chargeTicks` ⇒ 48f/800ms 基线）的
 *    `chargeProgress` 生命周期；逐武器那条路（枪 60f / 杖 54f / 重剑 84f）此前只有 flow 测试
 *    顺带覆盖（它们量的是投掷/共振弹有没有出手），没有一条**直接**钉「阈值就是表里那个数、
 *    且 `chargeProgress` 与释放闸门共用它」。
 *  - 这条契约最容易被偷改坏：把释放闸门改回全局 `CHARGE_TICKS`，flow 测试里凡按 60 拍按住
 *    的用例可能仍绿（60≥48），但杖（54）与重剑（84）就会在错误的一拍松手——本文件逐武器钉死。
 *
 * 全 headless：`PlayerController` + `GameTime` + `RhythmClock`，不碰 `CombatManager`、不读渲染。
 */
import { describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import { CHARGE_TICKS } from '@/player/ThirdPersonController'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'

registerGameData()

function makePlayer(weaponId: string) {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>(weaponId)
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  player.stats.stamina = player.stats.staMax // 蓄满那一记要花体力；canAct 不因体力空而挡
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.update(TICK_DT, time, input, time.tick, rhythm)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { player, tick, frame }
}

/** 每一把武器的蓄满阈值：省略 `chargeTicks` 的走全局基线 */
const CASES = [
  { weapon: 'wp_tuning_sword', ms: 'ms_sword', threshold: CHARGE_TICKS, note: '§4.1 轻剑：省略 ⇒ 基线 48f' },
  { weapon: 'wp_overtone_bow', ms: 'ms_bow', threshold: CHARGE_TICKS, note: '§4.4 弓：省略 ⇒ 基线 48f' },
  { weapon: 'wp_drawpin_spear', ms: 'ms_spear', threshold: 60, note: '§4.3 引针枪：1000ms/60f' },
  { weapon: 'wp_tuningfork_staff', ms: 'ms_staff', threshold: 54, note: '§4.5 音叉杖：900ms/54f' },
  { weapon: 'wp_fortissimo_greatsword', ms: 'ms_greatsword', threshold: 84, note: '§4.2 重剑：1400ms/84f' },
] as const

describe('KI-117②：chargeThreshold 逐武器读 movesets.chargeTicks（省略 = 全局 CHARGE_TICKS）', () => {
  it('表里的 chargeTicks 与文档值逐把对上；省略的两把是 undefined（不是写死 48）', () => {
    const got = (id: string): number | undefined => registry.get<MovesetData>(`moveset:${id}`).chargeTicks
    expect(got('ms_sword'), '轻剑省略 ⇒ 基线，不该有字段').toBeUndefined()
    expect(got('ms_bow'), '弓省略 ⇒ 基线，不该有字段').toBeUndefined()
    expect(got('ms_spear')).toBe(60)
    expect(got('ms_staff')).toBe(54)
    expect(got('ms_greatsword')).toBe(84)
  })

  for (const c of CASES) {
    it(`${c.weapon}：chargeThreshold = ${c.threshold}f（${c.note}）`, () => {
      const w = makePlayer(c.weapon)
      expect(w.player.chargeThreshold).toBe(c.threshold)
    })
  }
})

describe('KI-117②：chargeProgress 与释放闸门共用同一个 chargeThreshold', () => {
  for (const c of CASES) {
    it(`${c.weapon}：蓄到 threshold−1 未满、到 threshold 满，且只有到 threshold 才放 charged`, () => {
      const w = makePlayer(c.weapon)
      const t = c.threshold
      w.frame.held.add('attackHeavy')
      // 蓄 t−1 拍：进度 = (t−1)/t < 1（归一化分母是本武器的阈值，不是全局 48）
      w.tick(t - 1)
      expect(w.player.chargeProgress, `${c.weapon} 在 ${t - 1} 拍的进度`).toBeCloseTo((t - 1) / t, 10)
      // 再蓄 1 拍：进度 = 1
      w.tick(1)
      expect(w.player.chargeProgress, `${c.weapon} 在 ${t} 拍的进度`).toBe(1)
      // 松手：只有 chargeTicks >= 本武器阈值才走 charged
      w.frame.held.delete('attackHeavy')
      w.tick(1)
      expect(w.player.action?.key, `${c.weapon} 蓄满后松手应走 charged`).toBe('charged')
    })

    it(`${c.weapon}：差一拍松手 = fizzle（既不是 charged，也不是轻击 h）`, () => {
      const w = makePlayer(c.weapon)
      const t = c.threshold
      // t−1 >= 8 恒成立（最小 47）⇒ 落进"够久但没满"那条：既不 charged 也不 h
      w.frame.held.add('attackHeavy')
      w.tick(t - 1)
      w.frame.held.delete('attackHeavy')
      w.tick(1)
      expect(w.player.action, `${c.weapon} 差一拍松手不该留下任何动作（fizzle）`).toBeNull()
    })
  }
})

describe('KI-117②：换武器后阈值跟着换（equip 更新 moveset ⇒ 阈值不是构造时的一次性快照）', () => {
  it('轻剑(48) → 重剑(84)：阈值变 84，60 拍松手按旧阈值不再算蓄满', () => {
    const w = makePlayer('wp_tuning_sword')
    expect(w.player.chargeThreshold).toBe(CHARGE_TICKS)
    w.player.equip(
      registry.get<WeaponData>('wp_fortissimo_greatsword'),
      registry.get<MovesetData>('moveset:ms_greatsword'),
    )
    expect(w.player.chargeThreshold, '换武器后阈值必须跟到重剑的 84f').toBe(84)
    // 60 拍：旧阈值 48 会误判蓄满；新阈值 84 下应是 fizzle
    w.frame.held.add('attackHeavy')
    w.tick(60)
    w.frame.held.delete('attackHeavy')
    w.tick(1)
    expect(w.player.action, '60 < 84 ⇒ 若这里放 charged，就是按旧阈值判了').toBeNull()
  })

  it('反向：重剑(84) → 轻剑(48)，阈值收回基线 48', () => {
    const w = makePlayer('wp_fortissimo_greatsword')
    expect(w.player.chargeThreshold).toBe(84)
    w.player.equip(
      registry.get<WeaponData>('wp_tuning_sword'),
      registry.get<MovesetData>('moveset:ms_sword'),
    )
    expect(w.player.chargeThreshold).toBe(CHARGE_TICKS)
  })
})
