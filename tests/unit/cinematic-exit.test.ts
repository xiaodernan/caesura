import { describe, expect, it, vi } from 'vitest'
import { readCinematicExit } from '@/core/CinematicExit'
import type { UiIntent } from '@/core/Input'

/**
 * KI-390 乙案的**出口读者**（`src/core/CinematicExit.ts`）——五条行为腿。
 *
 * **这一档的 red 形状要在跑之前说清楚**：它 import 一个还不存在的模块，
 * 所以失败方式是**整档加载错误**（vitest 报 "Cannot find module"、0 条腿被登记），
 * 不是腿级红。落档时按"文件级红 1 个文件"记账，**不把它折算成 5 条红腿**——
 * 把加载失败说成"五条预测全中"正是 KI-392 先红臂点出来的那类谎。
 * 因此本批的先红预测分两格写：`cinematic-owner.test.ts` 5 红／2 绿（条级），
 * 本档 1 个文件级红；`ui-intents.test.ts` 因两把尺改口再红 2 条 ⇒ 合计 7 条级红 + 1 个文件级红。
 * 数以两趟实测为准，与预测不符的逐条写在结案里。
 *
 * **读者的形状**（裁决在账本 KI-390 行，这里是它的腿）：
 * - 只读**菜单那条**的边沿（`confirm`／`back`），不碰玩法那条 ⇒ KI-392 那道闸一字不拆，
 *   暂停在过场里仍然不存在（KI-389 的裁决不翻案）。
 * - 它自己去**吞**边沿吗？不。`uiEdges` 是每帧新建的只读集合（`src/core/Input.ts:589-592`），
 *   下一帧自然为空；所以这里只"看一眼"，返回值告诉调用方这一帧有没有发生出口。
 * - 同帧两枚都按下只跳**一次**：`Cinematics.skip()` 会把排队的那条接上来，连跳两次等于
 *   把终局蒙太奇也吞掉（§6 那条队列是共享的一段，不是可以随便跳过的第二条广告）。
 */

const exit = (...ints: UiIntent[]): Set<UiIntent> => new Set<UiIntent>(ints)

describe('KI-390 出口读者：readCinematicExit(边沿, 收束)', () => {
  it('`confirm` 边沿 ⇒ 收束一次，并答"这一帧我吃了出口"', () => {
    const skip = vi.fn()
    expect(readCinematicExit(exit('confirm'), skip), '`confirm` 在过场里应当就是"跳过"').toBe(true)
    expect(skip.mock.calls.length, '收束只该被叫一次').toBe(1)
  })

  it('`back` 边沿 ⇒ 同样收束一次（手柄 B／键盘 Esc 走的是这一格）', () => {
    const skip = vi.fn()
    expect(readCinematicExit(exit('back'), skip)).toBe(true)
    expect(skip).toHaveBeenCalledTimes(1)
  })

  it('没有边沿 ⇒ 一次都不叫，答 false（不能让每帧都以为自己跳过了什么）', () => {
    const skip = vi.fn()
    expect(readCinematicExit(exit(), skip), '空集合不该触发收束').toBe(false)
    expect(skip.mock.calls.length, '没人按就不许动播放器').toBe(0)
  })

  it('别的菜单意图不算出口：`up`／`down`／`pageNext` 都不收束', () => {
    for (const i of ['up', 'down', 'left', 'right', 'pagePrev', 'pageNext', 'pick1'] as UiIntent[]) {
      const skip = vi.fn()
      expect(readCinematicExit(exit(i), skip), `${i} 不是出口动词，不该把过场收掉`).toBe(false)
      expect(skip.mock.calls.length, `${i} 不该叫收束`).toBe(0)
    }
  })

  it('同帧两枚出口边沿只跳一次（连跳会把排队的那条也吞掉）', () => {
    const skip = vi.fn()
    expect(readCinematicExit(exit('confirm', 'back'), skip)).toBe(true)
    expect(skip.mock.calls.length, '§6 的终局蒙太奇是排在后面的那一条：一帧跳两次会连它一起吞').toBe(1)
  })
})
