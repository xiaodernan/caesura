import { describe, expect, it } from 'vitest'
import { registry } from '@/core/Registry'
import { TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'

/**
 * KI-335／Phase 9 的只读探头：「§5.7「不要猜性能」那一格第一次有读数面」（KI-335）。
 *
 * 本文件做两件事，且**只做这两件**：
 *  ① 用真数据装配一个 12 只混编的营地（嘈壳×4／漂调者×3／驼击手×2／幽灵／叠唱／悬吊骑士），
 *     全员进 combat、警觉满，开局即最大负载，跑 3600 拍（= 1 分钟 @60Hz）；
 *  ② 逐拍量 `ai.update` 这一格的耗时，把报告印成一行 `[perf-probe] {…}`（机器可抓）。
 *
 * **这一格不进断言**：帧预算 <2ms 是设计目标（KI-336 系读数），同一份码换一趟就换一个数；
 * 探头的存在理由是「有读数」，不是「判据绿」。
 * `expect` 只钉两样**与时机无关**的事：样本数恰为 TICKS，且全是有限数。
 *
 * 读数落点：`node scripts/measure-probe.mjs` 把那一行 JSON 追加进 `artifacts/perf-probe-<date>.log`
 *（KI-410：artifacts/ 不入库——跟截图证据一个规矩）。
 */

registerGameData()

const TICKS = 3600 // 1 分钟 @60Hz

/** 12 只混编，与 KI-400 的真实营地同一口径 */
const CAMP: Array<[string, number]> = [
  ['en_murkshell', 4],
  ['en_driftsinger', 3],
  ['en_tympanus', 2],
  ['en_myriad', 1],
  ['en_refrein', 1],
  ['en_hanged_knight', 1],
]

const makePlayer = (): PlayerController => {
  const weapon = registry.get<WeaponData>('wp_fortissimo_greatsword')
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
  player.camYawRef = 0
  player.stats.hp = 9_999_999
  player.stats.hpMax = 9_999_999
  player.stats.poiseMax = 9_999_999
  player.stats.stamina = player.stats.staMax
  return player
}

describe('KI-335｜perf probe：ai.update 时间分布', () => {
  it('12 只混编全场 3600 拍：样本数与有限性入断言；分布只印读数', () => {
    const ai = new AISystem()
    const rhythm = new RhythmClock()
    rhythm.setBpm(84, 4)
    const player = makePlayer()

    let idx = 0
    const total = CAMP.reduce((acc, [, n]) => acc + n, 0)
    expect(total, '混编就是这十二只——人数不许变').toBe(12)
    for (const [species] of CAMP) {
      const def = registry.get(species)
      expect(def, `${species} 要在敌人表里（真数据装配）`).toBeTruthy()
    }
    for (const [species, n] of CAMP) {
      for (let k = 0; k < n; k++) {
        const ang = (idx / total) * Math.PI * 2
        const e = ai.spawn(species, { x: Math.cos(ang) * 5.5, y: 0, z: Math.sin(ang) * 5.5 }, `perf-${species}-${k}`)
        e.alertness = 100
        e.enter('combat')
        idx++
      }
    }

    const samples: number[] = []
    for (let tick = 1; tick <= TICKS; tick++) {
      const t0 = performance.now()
      ai.update(TICK_DT, tick, player, rhythm)
      rhythm.update(TICK_DT)
      samples.push(performance.now() - t0)
    }

    samples.sort((a, b) => a - b)
    const nearestRank = (p: number): number => samples[Math.min(samples.length - 1, Math.ceil(p * samples.length) - 1)]
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length
    const over2ms = samples.filter((s) => s > 2).length
    const report = {
      probe: 'ai.update',
      camp: CAMP.map(([id, n]) => `${id}x${n}`).join('+'),
      enemies: total,
      ticks: TICKS,
      simulatingMs: TICKS * (TICK_DT * 1000),
      meanMs: Number(mean.toFixed(4)),
      p50Ms: Number(nearestRank(0.5).toFixed(4)),
      p95Ms: Number(nearestRank(0.95).toFixed(4)),
      p99Ms: Number(nearestRank(0.99).toFixed(4)),
      maxMs: Number(samples[samples.length - 1].toFixed(4)),
      over2ms,
      over2msPct: Number(((100 * over2ms) / samples.length).toFixed(2)),
    }
    console.log('[perf-probe] ' + JSON.stringify(report))

    // 与时机无关的两条断言（探头的存在理由是「有读数」，不是「判据绿」）
    expect(samples.length, '全场每一拍都量了——中途不许少样本').toBe(TICKS)
    expect(samples.every((s) => Number.isFinite(s) && s >= 0), '每个样本都是有限非负数').toBe(true)
  }, 60_000)
})
