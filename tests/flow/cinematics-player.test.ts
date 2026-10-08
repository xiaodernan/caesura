import { describe, expect, it } from 'vitest'
import { registerGameData, cinematics } from '@/data'
import { readFileSync } from 'node:fs'
import { Cinematics } from '@/world/Cinematics'

/**
 * `src/world/Cinematics.ts`（§6 过场清单的**播放器**，纯逻辑）的行为守卫。
 *
 * 它今天**还没有运行时调用方**（`main.ts` 那条腿未接，镜头轨道与字幕时序要真几何与相机 ⇒ KI-008/KI-010），
 * 所以这个文件**就是它的消费者**：先把"哪一条在跑、还剩多久、该不该夺输入"这三件事钉住，
 * 接腿的时候不必再猜它怎么工作。
 *
 * ⚠️ 它**不演**也不**决定何时放**——只回答"该不该锁输入"；真去锁 `Input` 的是 `main.ts` 的事。
 */
registerGameData()

const rows = cinematics as unknown as Array<{ id: string; kind: string; durationMs: number; lockInput?: boolean }>

describe('Cinematics 播放器：起 / 走 / 收 / 锁', () => {
  it('用真表建一个播放器，表里有那几条（至少 10 条，含开场与结局）', () => {
    const p = new Cinematics(rows)
    expect(rows.length).toBeGreaterThanOrEqual(10)
    expect(p.has('CINE_OPEN'), '开场').toBe(true)
    expect(p.has('CINE_END_A'), '结局 A').toBe(true)
  })

  it('**id 不在表里 ⇒ start 返回 false 且不起**（不静默开始一个空演出）', () => {
    const p = new Cinematics(rows)
    expect(p.start('CINE_DOES_NOT_EXIST')).toBe(false)
    expect(p.current).toBeNull()
    expect(p.inputLocked).toBe(false)
  })

  it('start 之后 current 交代 id/kind/总时长，elapsed 从 0 起', () => {
    const p = new Cinematics(rows)
    expect(p.start('CINE_OPEN')).toBe(true)
    const cur = p.current!
    expect(cur.id).toBe('CINE_OPEN')
    expect(cur.elapsedMs).toBe(0)
    expect(cur.durationMs).toBeGreaterThan(0)
  })

  it('走满时长 ⇒ 自动收束（current 变 null、输入锁解除），且**不留最后一帧**', () => {
    const p = new Cinematics(rows)
    p.start('CINE_MYRIAD_INTRO')
    const total = p.current!.durationMs
    expect(p.advance(total - 1), '还差 1ms ⇒ 仍在跑').toBe(true)
    expect(p.advance(1), '走满 ⇒ 收束').toBe(false)
    expect(p.current).toBeNull()
    expect(p.inputLocked).toBe(false)
  })

  it('advance 在没演出时返回 false（调用方不必先问 current）', () => {
    const p = new Cinematics(rows)
    expect(p.advance(16)).toBe(false)
  })

  it('skip 手动收束；非正/非有限的 deltaMs 不推进也不收束（脏输入不改状态）', () => {
    const p = new Cinematics(rows)
    p.start('CINE_WIN')
    expect(p.advance(0)).toBe(true)
    expect(p.advance(Number.NaN)).toBe(true)
    expect(p.current!.elapsedMs).toBe(0)
    p.skip()
    expect(p.current).toBeNull()
  })

  it('`inputLocked` 跟着**这一条自己的 `lockInput`** 走；那一格缺省时不锁（欠账≠设计）', () => {
    const locked = new Cinematics([{ id: 'A', kind: 'k', durationMs: 1000, lockInput: true }])
    const unlocked = new Cinematics([{ id: 'B', kind: 'k', durationMs: 1000 }])
    locked.start('A'); expect(locked.inputLocked).toBe(true)
    unlocked.start('B'); expect(unlocked.inputLocked, '缺省不锁').toBe(false)
  })

  it('同时起第二条 ⇒ 取代第一条（过场不排队）', () => {
    const p = new Cinematics(rows)
    p.start('CINE_OPEN')
    p.start('CINE_WIN')
    expect(p.current!.id).toBe('CINE_WIN')
  })
})

describe('运行时那条腿（`main.ts`）：接了什么、**没接什么**，都钉在源门上', () => {
  const main = readFileSync('src/main.ts', 'utf8')

  it('接了：过场实例 + 每帧走时间 + 输入门 + 新开局放开场', () => {
    expect(main, '实例').toMatch(/new Cinematics\(/)
    expect(main, '每帧走时间').toMatch(/cinematics\.advance\(dt \* 1000\)/)
    expect(main, '输入门').toMatch(/!cinematics\.inputLocked/)
    expect(main, '新开局放开场').toMatch(/if \(!slot\) cinematics\.start\('CINE_OPEN'\)/)
  })

  it('**没接**：其余 9 条的触发点一个都没接（谁接的时候顺手把这条断言改掉，别让它一直骗人）', () => {
    // 除 CINE_OPEN 之外，main.ts 里不该出现任何 CINE_* 字面量 —— 出现了就说明有人接了新触发，
    // 那时这条断言要连同上面那条一起更新（而不是删掉它）
    const others = main.match(/CINE_(?!OPEN)[A-Z_]+/g) ?? []
    expect(others, `main.ts 里出现了未预期的过场触发：${others.join(',')}`).toEqual([])
  })
})
