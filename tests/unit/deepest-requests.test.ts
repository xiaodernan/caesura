import { describe, it, expect } from 'vitest'
import { deepestRequests, deepestFactor, type DuckRequest } from '@/audio/ducking'

/**
 * `deepestRequests`：把在场请求折成「每条总线一个**主人**」（KI-092①）。
 *
 * 与已被测的 `deepestFactor`（ducking.test.ts 237-257，只读 `.factor`）是两层：
 * `deepestFactor` 由它派生（`out[bus] = deepestRequests(reqs)[bus].factor`）。
 * 因而 `deepestFactor` 的覆盖**表达不了**这一层独有的契约——**交出整行而不只是系数**。
 *
 * 为什么非要整行：斜坡是两条。压下去用**赢家那一行**的 `attackSec`，弹回来要用
 * **当初把这条总线压下去的那一行**的 `releaseSec`。只拿系数的话，引擎就只能给所有行
 * 用同一个缺省斜率——那正是「表里写了读数而没人读」的形状（§55）。
 * 所以核心不变式是：**深度与斜率同源**，一条总线只有一个主人，
 * 绝不会出现「深度归甲、斜率归乙」。
 *
 * 零直接读者：全库没有任何一处引用 `deepestRequests`。
 */
const req = (bus: string, factor: number, extra: Partial<DuckRequest> = {}): DuckRequest =>
  ({ bus, factor, until: 10, ...extra })

describe('deepestRequests：每条总线一个主人（深度与斜率同源，KI-092①）', () => {
  it('空表 ⇒ 空对象（缺席的总线不出现，调用方按「缺席=1=基准」处理）', () => {
    expect(deepestRequests([])).toEqual({})
  })

  it('单条 ⇒ 原样交出那一行（连斜率一起，不是只给系数）', () => {
    const r = req('music', 0.5, { attackSec: 0.25, releaseSec: 0.18 })
    expect(deepestRequests([r])).toEqual({ music: r })
  })

  it('同总线多条 ⇒ 取 factor 最小的那一行', () => {
    const folded = deepestRequests([
      req('music', 0.7, { attackSec: 0.1 }),
      req('music', 0.3, { attackSec: 0.25 }),
      req('music', 0.5, { attackSec: 0.2 }),
    ])
    expect(folded.music.factor).toBe(0.3)
  })

  it('核心：深度与斜率同源 —— 系数最小的那一行，它的斜率也跟着走', () => {
    // 故意让「压得更深」和「斜率更长」落在不同行上：若实现先取最深系数、再另找斜率，
    // 就会拿出 ambience 的 0.9/0.05，那正是「深度归甲、斜率归乙」。
    const folded = deepestRequests([
      req('music', 0.2, { attackSec: 0.25, releaseSec: 0.18 }), // 压得最深，斜率也长
      req('music', 0.8, { attackSec: 0.9, releaseSec: 0.05 }), // 压得浅，斜率短
    ])
    expect(folded.music.factor).toBe(0.2)
    expect(folded.music.attackSec).toBe(0.25)
    expect(folded.music.releaseSec).toBe(0.18)
  })

  it('多总线 ⇒ 每条各一个主人，键集恰为出现过的总线', () => {
    const folded = deepestRequests([
      req('music', 0.4),
      req('ambience', 0.6),
      req('sfx', 0.9),
      req('music', 0.2),
    ])
    expect(Object.keys(folded).sort()).toEqual(['ambience', 'music', 'sfx'])
    expect(folded.music.factor).toBe(0.2)
    expect(folded.ambience.factor).toBe(0.6)
    expect(folded.sfx.factor).toBe(0.9)
  })

  it('并列 factor ⇒ 先到者胜（严格 <，不换主人）', () => {
    const first = req('music', 0.5, { attackSec: 0.11 })
    const second = req('music', 0.5, { attackSec: 0.22 })
    const folded = deepestRequests([first, second])
    expect(folded.music).toBe(first)
  })

  it('不修改入参（纯函数，调用方那串请求还要留给弹回用）', () => {
    const input = [req('music', 0.5), req('music', 0.2)]
    const before = JSON.stringify(input)
    deepestRequests(input)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('与 deepestFactor 对账：派生关系不漂（逐键等于主人的 factor）', () => {
    const reqs = [
      req('music', 0.4, { attackSec: 0.25 }),
      req('music', 0.2, { attackSec: 0.9 }),
      req('ambience', 0.7),
    ]
    const owners = deepestRequests(reqs)
    const factors = deepestFactor(reqs)
    expect(Object.keys(factors).sort()).toEqual(Object.keys(owners).sort())
    for (const bus of Object.keys(owners)) expect(factors[bus]).toBe(owners[bus].factor)
  })
})
