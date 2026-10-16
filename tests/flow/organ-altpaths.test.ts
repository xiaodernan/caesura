import { afterEach, describe, expect, it } from 'vitest'
import { registerGameData, regions, worldStates as stateTable } from '@/data'
import { StreamingSystem } from '@/world/Streaming'
import { Interactables } from '@/world/Interactables'
import { WorldStates } from '@/quest/WorldStates'

/**
 * 未竟厅大门的三条钥匙（盐歌线结局的世界读者，narrative §2.3 完成后状态）：
 *  · 敲响倒钟（主路径，`el_fellcarillon_organlift` 的 requiresFlag——既有批次落的）；
 *  · 说服盐歌 ⇒ 音栓钥匙在手 ⇒ 沉唱堂的管风琴键子是另一只锁眼（`in_choir_organ_stop`）；
 *  · 放弃 ⇒ 她留在休垒 ⇒ 音栓图改由深窖抄经房的摹本给出（`in_deeps_organ_transcript`，
 *    顺带那句隐藏 Boss 前置线索——「这扇门的另一把钥匙，守在连回声都死了的地方」）。
 * 三条路写**同一条** `flag.organ_gate_open`——门只有一个主人，钥匙可以有三种来历。
 */

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

function makeWorld() {
  registerGameData()
  const streaming = new StreamingSystem(regions)
  // 值域闸门的喂法与组合根一致：states.get 就是读数（缺省全锁的纪律由缺省参数守着）
  const interact = new Interactables(regions, () => true, 6, (req) => states.get(req.key) === req.value)
  const states = new WorldStates(stateTable)
  const use = (id: string): { ok: boolean; state: string } => {
    const it = interact.all.find((x) => x.id === id)!
    const r = interact.use(id, { ...it.pos })
    return { ok: r.ok, state: r.state }
  }
  alive.push(() => { interact.dispose(); states.dispose(); streaming.dispose() })
  return { streaming, states, use }
}

describe('未竟厅大门：一条门旗，三种钥匙', () => {
  it('说服线：钥匙旗立了但门没开；走到键子跟前插进锁眼 ⇒ 门开（与吊机同一扇）', () => {
    const w = makeWorld()
    w.streaming.setFlag('flag.organ_key_held', true) // 说服那一拍写的旗（对话腿在 meg-ending.test.ts）
    expect(w.streaming.hasFlag('flag.organ_gate_open'), '钥匙在手 ≠ 门已开').toBe(false)
    const r = w.use('in_choir_organ_stop')
    expect(r.ok, '钥匙插进键子 ⇒ 开门').toBe(true)
    expect(w.streaming.hasFlag('flag.organ_gate_open'), '与吊机写的是同一条门旗').toBe(true)
  })

  it('没钥匙的人对着键子按不下去（缺省一律视作锁住）', () => {
    const w = makeWorld()
    expect(w.use('in_choir_organ_stop').state, '没说服过 ⇒ 锁').toBe('locked')
    expect(w.streaming.hasFlag('flag.organ_gate_open')).toBe(false)
  })

  it('放弃线：抄本只在 RELINQUISHED 的世界里在场；INTACT（没走到抉择）时它是锁着的', () => {
    const w = makeWorld()
    expect(w.use('in_deeps_organ_transcript').state, 'INTACT ⇒ 摹本不在').toBe('locked')
    expect(w.streaming.hasFlag('flag.organ_gate_open')).toBe(false)
  })

  it('放弃线（正确喂法）：值域落 RELINQUISHED ⇒ 抄本展开即开同一扇门', () => {
    const w = makeWorld()
    w.states.set('state.meg.ending', 'RELINQUISHED')
    const r = w.use('in_deeps_organ_transcript')
    expect(r.ok, '放弃的补偿：抄本展开即开门').toBe(true)
    expect(w.streaming.hasFlag('flag.organ_gate_open'), '还是那扇门').toBe(true)
    // 说服给钥匙、放弃给抄本——两条替代路径互不冒充
    w.states.set('state.meg.ending', 'CONVINCED')
    expect(r.ok, '门开了就是开了：值域改写不收回已开的门（单向世界）').toBe(true)
  })
})
