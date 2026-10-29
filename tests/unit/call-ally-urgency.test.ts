import { describe, expect, it, beforeAll } from 'vitest'
import { bus, type GameEvents } from '@/core/EventBus'
import { registry } from '@/core/Registry'
import { registerGameData } from '@/data'
import { Enemy } from '@/ai/Enemy'
import type { EnemyData } from '@/data/schema'

/**
 * KI-357：`ai.callAlly` 的 `urgency` 从「永远 normal」变成**从呼救者血量派生**。
 *
 * 病：KI-352 把呼救接到真频道时载荷里写死了 `urgency: 'normal'`，而 `Squad.callAlly`
 * 一直有一条乘数（high ×2／normal ×1／low ×0.5）——乘数有读者，分子却只有一个值。
 * 于是"快死的敌人喊得更急"这件事在运行时从来没有发生过。
 *
 * 裁决（口径写在 `Enemy.callUrgency()`）：**血量 ≤30% ⇒ high；≥70% ⇒ low；其余 normal**。
 * 两端都含等号，边界由本文件钉住；`Squad` 侧只负责把载荷里的值变成乘数（`squad-bus` 那条腿）。
 */

beforeAll(() => { registerGameData() })

const withCall = (): EnemyData => {
  const base = registry.get<EnemyData>('en_driftsinger')
  return { ...base, ai: { ...base.ai, callAlly: { range: 14, broadcastTicks: 6 } } }
}

/** 把血量摆到 `hpFrac`，走一次真实的 `beginCallAlly` + 读条完成那一刻的广播，取回载荷。 */
const emittedAt = (hpFrac: number): GameEvents['ai.callAlly'] | undefined => {
  const e = new Enemy(withCall(), { x: 0, y: 0, z: 0 }, `ki357-${Math.round(hpFrac * 100)}`)
  e.stats.hp = Math.max(1, Math.round(e.stats.hpMax * hpFrac))
  let got: GameEvents['ai.callAlly'] | undefined
  const off = bus.on('ai.callAlly', (ev) => { got = ev })
  try {
    const priv = e as unknown as { beginCallAlly(tick: number): void; pendingBroadcast?: () => void }
    priv.beginCallAlly(1)
    priv.pendingBroadcast?.()
  } finally {
    off()
  }
  return got
}

describe('KI-357 呼救的 urgency 从血量派生', () => {
  it('≤30% ⇒ high（0.2 与边界 0.3 都算）', () => {
    for (const frac of [0.2, 0.3]) {
      const ev = emittedAt(frac)
      expect(ev, `hp=${frac} 时确实广播了`).toBeDefined()
      expect(ev?.urgency, `hp=${frac}`).toBe('high')
    }
  })

  it('中间段 ⇒ normal（0.5）', () => {
    expect(emittedAt(0.5)?.urgency).toBe('normal')
  })

  it('≥70% ⇒ low（边界 0.7 与 0.9 都算）', () => {
    for (const frac of [0.7, 0.9]) {
      expect(emittedAt(frac)?.urgency, `hp=${frac}`).toBe('low')
    }
  })

  it('载荷里 urgency 一定有值：不是 undefined 再让下游兜底', () => {
    for (const frac of [0.1, 0.5, 0.99]) {
      const ev = emittedAt(frac)
      expect(ev?.fromId, '广播带着呼救者的 id').toMatch(/^en_\d+$/)
      expect(ev?.urgency, '三档里必有一档').toMatch(/^(low|normal|high)$/)
    }
  })
})
