import { describe, expect, it } from 'vitest'
import { registerGameData, movesetsRaw } from '@/data'

/**
 * `KI-032`（回响的「场上最多 2 影」性能锁在真实帧数据下打不到）结案时留了一个**触发条件**：
 * 要"三影同时在世"（影 1 在 t=0、影 2 在 t=c、影 3 在 t=2c），就得 **2c < `delayTicks`(90)
 * ⇒ 两记重击的间隔 < 45 tick**。今天最快的重击是 64（无鸣）⇒ 那道丢弃分支**永远为假**。
 *
 * 这条守卫把那个条件**从散文变成判据**：**哪天有人加了一把重击节奏 < 45 tick 的武器/连段，
 * 这里会红**——它红的时候要做的不是把阈值改小，而是去 `KI-032` 把
 * "丢弃分支真的跑到"那条断言补上（**那时那道锁才第一次成为活约束**）。
 *
 * 口径与结案时一致：节奏 = `recovery + (activeEnd - activeStart)`（落地即接的最快循环）。
 */
registerGameData()

/** 三影同时在世所需的重击间隔上限（tick）＝ `delayTicks` / 2 */
const TRIGGER_TICKS = 45

function heavyCadence(): Array<{ moveset: string; action: string; cadence: number }> {
  const out: Array<{ moveset: string; action: string; cadence: number }> = []
  for (const ms of movesetsRaw as unknown as Array<Record<string, unknown>>) {
    const id = String(ms.id ?? '?')
    const actions = (ms.actions ?? {}) as Record<string, Record<string, number>>
    for (const [aid, a] of Object.entries(actions)) {
      if (!aid.startsWith('h')) continue // 重击类（h / h1 / h2…）
      if (typeof a.recovery !== 'number' || typeof a.activeEnd !== 'number' || typeof a.activeStart !== 'number') continue
      out.push({ moveset: id, action: aid, cadence: a.recovery + (a.activeEnd - a.activeStart) })
    }
  }
  return out.sort((x, y) => x.cadence - y.cadence)
}

describe('KI-032 的触发条件（影子上限成为活约束的那一天）', () => {
  it('表里最快的重击节奏仍 ≥ 45 tick ⇒ 那道丢弃分支今天依然为假（与结案时的量测一致）', () => {
    const all = heavyCadence()
    expect(all.length, '至少要能量到一条重击（否则这道门在空转）').toBeGreaterThan(0)
    const fastest = all[0]
    expect(
      fastest.cadence,
      `最快的重击是 ${fastest.moveset}.${fastest.action} = ${fastest.cadence} tick；` +
        `一旦它跌破 ${TRIGGER_TICKS}，KI-032 那道 maxShadows 丢弃分支就成了活约束 —— ` +
        '那时**先去 KI-032 补"丢弃分支真的跑到"的断言**，不要改小这里的阈值',
    ).toBeGreaterThanOrEqual(TRIGGER_TICKS)
  })
})
