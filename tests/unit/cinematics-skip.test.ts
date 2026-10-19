import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Cinematics } from '@/world/Cinematics'
import type { CinematicRow } from '@/data/schema'

/**
 * 回归守卫：开场 25 秒黑场（`CINE_OPEN`，`lockInput:true`）必须**可被跳过**。
 *
 * 这是 2026-10-15 修掉的真缺陷——`Cinematics.skip()` 此前在 `src/` 里**零调用者**，
 * 于是 `?fresh=1` 每次都把玩家钉在 25 秒黑场里、没有任何键/点击能逃出来
 * （「太黑了 / 啥都看不清 / 不知道怎么玩」的根因之一）。
 *
 * 两条腿：
 * ① 行为腿——`skip()` 必须把 `inputLocked` 解除（玩家能重新动）；
 * ② 源码门——`cinematics.skip(` 在 `src/` 里必须**至少有一个真调用点**
 *   （不在 `Cinematics.ts` 自身的定义里，也不在本测试里），否则它又会变成死代码、
 *   黑场重新变得不可跳过。这条门就是为「skip 永不许再零调用」下的。
 */

const rows = [
  { id: 'CINE_OPEN', kind: 'open', durationMs: 25000, lockInput: true },
  { id: 'CINE_AFTER', kind: 'montage', durationMs: 4000, lockInput: false },
] as unknown as CinematicRow[]

describe('Cinematics.skip()：开场黑场必须可跳过（回归 KI-黑屏）', () => {
  it('start(lockInput) 之后 inputLocked 为 true（玩家被钉住的前提）', () => {
    const p = new Cinematics(rows)
    expect(p.start('CINE_OPEN')).toBe(true)
    expect(p.inputLocked).toBe(true)
    expect(p.current?.id).toBe('CINE_OPEN')
  })

  it('skip() 之后 current 清空且 inputLocked 解除——玩家能重新行动', () => {
    const p = new Cinematics(rows)
    p.start('CINE_OPEN')
    expect(p.inputLocked).toBe(true) // 先确认锁住了
    p.skip()
    expect(p.current).toBeNull()
    expect(p.inputLocked).toBe(false) // 关键：跳过之后必须能动
  })

  it('没有演出在跑时 skip() 也不抛、current 保持 null', () => {
    const p = new Cinematics(rows)
    expect(() => p.skip()).not.toThrow()
    expect(p.current).toBeNull()
    expect(p.inputLocked).toBe(false)
  })

  it('排了队的演出，skip() 会接上排队的那一条（跳过≠整条取消）', () => {
    const p = new Cinematics(rows)
    p.start('CINE_OPEN')
    expect(p.queue('CINE_AFTER')).toBe(true)
    p.skip()
    // 接上来的是排队的那条，而不是空场
    expect(p.current?.id).toBe('CINE_AFTER')
  })

  it('源码门：cinematics.skip( 在 src/ 里至少有一个真调用点（不许再变死代码）', () => {
    const callers = findSkipCallers()
    expect(callers.length, `cinematics.skip( 在 src/ 里没有任何真调用点——黑场又会变得不可跳过`).toBeGreaterThan(0)
    // 调用点必须落在非注释行上（注释里的不算）
    expect(callers.some((c) => !c.isComment), '所有命中都只是在注释里').toBe(true)
  })
})

/** 找出 src/ 里所有 `cinematics.skip(` 的真调用点（排除定义文件与本测试自身）。 */
function findSkipCallers(): Array<{ file: string; line: number; isComment: boolean }> {
  const srcRoot = join(process.cwd(), 'src')
  const hits: Array<{ file: string; line: number; isComment: boolean }> = []
  const skip = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) {
        skip(full)
        continue
      }
      if (!name.endsWith('.ts')) continue
      if (full.replace(/\\/g, '/').endsWith('world/Cinematics.ts')) continue // 定义文件
      if (full.replace(/\\/g, '/').endsWith('tests/unit/cinematics-skip.test.ts')) continue // 本测试
      const text = readFileSync(full, 'utf-8')
      text.split('\n').forEach((raw, i) => {
        const lineNo = i + 1
        // 去掉行内注释再找调用（避免注释里的假命中）
        const code = raw.replace(/\/\/.*$/, '')
        if (/\bcinematics\.skip\s*\(/.test(code)) {
          hits.push({ file: full, line: lineNo, isComment: !/\bcinematics\.skip\s*\(/.test(code) })
        }
      })
    }
  }
  skip(srcRoot)
  return hits
}
