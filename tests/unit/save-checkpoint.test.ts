import { describe, expect, it, vi } from 'vitest'
import { Checkpoints } from '@/save/Checkpoint'
import type { SaveGame } from '@/save/Serializer'

/**
 * `src/save/Checkpoint.ts`：自动存档触发器（technical-architecture §2 save/Checkpoint.ts；需求 §45/§71）。
 *
 * 三个时机：调音桩休息、Boss 跳阶、区域首次进入。
 * 游戏循环同步而存储异步 ⇒ 只排队（连击合并成一次），不阻塞任何一帧；
 * 失败必须说出来。
 */

const okSlotSave = (calls: string[]): SaveGame => {
  const fake = {
    save: vi.fn(async (slot = 'autosave') => { calls.push(slot); return undefined as never }),
  }
  return fake as unknown as SaveGame
}

describe('Checkpoints：request / drain 成功路径', () => {
  it('单次 request ⇒ writes=1, lastReason=rest, failures=0, 写到 autosave 槽', async () => {
    const calls: string[] = []
    const cp = new Checkpoints(okSlotSave(calls))
    cp.request('rest')
    await cp.flush()
    expect(cp.writes).toBe(1)
    expect(cp.lastReason).toBe('rest')
    expect(cp.failures).toBe(0)
    expect(calls).toEqual(['autosave'])
  })

  it('in-flight 连击合并：第一次写在途时，后到的 reason 合并成一笔', async () => {
    let resolveFirst: (() => void) | null = null
    const fake = {
      save: vi.fn()
        .mockImplementationOnce(() => new Promise((r) => { resolveFirst = () => r(undefined as never) }))
        .mockImplementation(async () => undefined as never),
    } as unknown as SaveGame
    const cp = new Checkpoints(fake)
    cp.request('rest')  // 立刻开始 drain，splice 走 'rest'，save 阻塞在途
    cp.request('boss')  // queued → ['boss']
    cp.request('region') // queued → ['boss','region']
    resolveFirst!()     // 第一笔落盘，继续循环
    await cp.flush()
    expect(cp.writes).toBe(2) // rest 一笔 + boss+region 合并一笔
    expect(cp.lastReason).toBe('boss+region')
  })

  it('去重只发生在同一笔写的合并里（同一个 reason 连续入队也会各写一次）', async () => {
    const cp = new Checkpoints(okSlotSave([]))
    cp.request('rest')
    await cp.flush()
    cp.request('rest')
    await cp.flush()
    expect(cp.writes).toBe(2)
    expect(cp.lastReason).toBe('rest')
  })
})

describe('Checkpoints：失败路径必须说出来', () => {
  it('save 抛错 ⇒ failures+1，writes 不加', async () => {
    const fake = {
      save: vi.fn(async () => { throw new Error('disk full') }),
    } as unknown as SaveGame
    const cp = new Checkpoints(fake)
    cp.request('rest')
    await cp.flush()
    expect(cp.failures).toBe(1)
    expect(cp.writes).toBe(0)
  })
})

describe('Checkpoints：flush', () => {
  it('flush 返回时排队已空', async () => {
    const cp = new Checkpoints(okSlotSave([]))
    cp.request('manual')
    await cp.flush()
    expect(cp.writes).toBe(1)
  })
})
