/**
 * 世界停摆的那一个主人（KI-387）。
 *
 * 前面那一节量机制：两格来源、合成、谁也不许写谁。
 * 后面那一节量**形状**：组合根里那一格布尔今天只能有一个写处，而 Shape 尺读的是磁盘上的源码文本——
 * 这一类腿在本仓已有先例（`tests/unit/arch-boundaries.test.ts` 用静态扫描守依赖方向）。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GameTime } from '@/core/Time'
import { PauseControl } from '@/core/PauseControl'

const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url))
/**
 * 形状腿读的是**代码**，不是注释——本批那次就踩到了：新写的那条注释里引了一句老代码
 * `time.paused = overlay !== null`，正则照单全收，于是一格本该绿的形状腿红了。
 * 这一格先把注释剥掉再扫。剥法是行级的（`//` 与 `/* … *\/` 块整段丢），不认字符串里的假注释——
 * 对本仓的源码够用，而它的限度写在这里，不假装是语法级。
 */
const codeOf = (t: string): string => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('//'))
  .join('\n')
const srcFiles = (dir = SRC_DIR, out: string[] = []): string[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) srcFiles(p, out)
    else if (e.name.endsWith('.ts')) out.push(p)
  }
  return out
}
/** 相对 src 的名字（断言里要说得出是哪一份文件，而不是一长串绝对路径） */
const relOf = (abs: string): string => abs.slice(SRC_DIR.length).replace(/^\//, '')

describe('世界停摆的唯一主人 · 两格来源与合成（KI-387）', () => {
  it('两格都空 ⇒ 世界走，dt 不为零', () => {
    const time = new GameTime()
    const pause = new PauseControl(time)
    expect(time.paused).toBe(false)
    expect(pause.worldPaused).toBe(false)
    expect(time.dt).toBeGreaterThan(0)
  })

  it('只有菜单在场 ⇒ 停；菜单关掉 ⇒ 走', () => {
    const time = new GameTime()
    const pause = new PauseControl(time)
    pause.holdByOverlay(true)
    expect(time.paused).toBe(true)
    expect(time.dt).toBe(0)
    pause.holdByOverlay(false)
    expect(time.paused).toBe(false)
  })

  it('只有玩家手动 ⇒ 停；再按一次 ⇒ 走', () => {
    const time = new GameTime()
    const pause = new PauseControl(time)
    pause.toggleByUser()
    expect(time.paused).toBe(true)
    pause.toggleByUser()
    expect(time.paused).toBe(false)
  })

  it('本批的那条病腿：手动暂停之后开一张面板再关掉，玩家那次暂停不许被吃掉', () => {
    const time = new GameTime()
    const pause = new PauseControl(time)
    pause.toggleByUser() // 玩家自己按下暂停
    pause.holdByOverlay(true) // 打开调音桩面板
    pause.holdByOverlay(false) // 关掉——老写法在这一句把 paused 写成 false，玩家的那次暂停从此消失
    expect(time.paused).toBe(true)
    expect(pause.pausedByUser).toBe(true)
    expect(pause.heldByOverlay).toBe(false)
    pause.toggleByUser() // 玩家自己再按一次才算松开
    expect(time.paused).toBe(false)
  })

  it('两格独立：同时按住时先松菜单那一格仍停，再松玩家那一格才走', () => {
    const time = new GameTime()
    const pause = new PauseControl(time)
    pause.toggleByUser()
    pause.holdByOverlay(true)
    pause.holdByOverlay(false)
    expect(time.paused).toBe(true)
    pause.toggleByUser()
    expect(time.paused).toBe(false)
  })

  it('菜单那一路不许改写玩家那一格（反向臂钉得住的形状）', () => {
    const time = new GameTime()
    const pause = new PauseControl(time)
    pause.toggleByUser()
    pause.holdByOverlay(true)
    pause.holdByOverlay(false)
    expect(pause.pausedByUser).toBe(true)
    pause.toggleByUser()
    pause.holdByOverlay(true)
    expect(pause.pausedByUser).toBe(false)
    expect(pause.heldByOverlay).toBe(true)
  })

  it('玩家那一路不许改写菜单那一格（同一件事的另一边）', () => {
    const time = new GameTime()
    const pause = new PauseControl(time)
    pause.holdByOverlay(true)
    pause.toggleByUser()
    pause.toggleByUser()
    expect(pause.heldByOverlay).toBe(true)
    expect(time.paused).toBe(true)
  })

  it('同一路重复按不算第二次（幂等：按住两次仍是一格按住）', () => {
    const time = new GameTime()
    const pause = new PauseControl(time)
    pause.holdByOverlay(true)
    pause.holdByOverlay(true)
    expect(pause.heldByOverlay).toBe(true)
    pause.holdByOverlay(false)
    expect(time.paused).toBe(false)
  })
})

describe('组合根的形状：那一个布尔只有一个写处（KI-387）', () => {
  const all = srcFiles()
  const read = (rel: string): string => readFileSync(`${SRC_DIR}/${rel}`, 'utf8').replace(/\r\n/g, '\n')

  it('src 里凡是给 `*.paused` 赋值的文件，只有 Time 的 reset 与 PauseControl 的合成这两处', () => {
    const writers = all
      .map((abs) => ({ r: relOf(abs), t: codeOf(readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')) }))
      .filter(({ t }) => /(^|[^=])\b[\w.]+\.paused\s*=[^=]/m.test(t))
      .map(({ r }) => r)
      .sort()
    expect(writers).toEqual(['core/PauseControl.ts', 'core/Time.ts'].sort())
  })

  it('main.ts 里一处也不许直接写 time.paused（组合根只提请求，不写那一格）', () => {
    const main = codeOf(read('main.ts'))
    expect(main.split('\n').filter((l) => /time\.paused\s*=[^=]/.test(l))).toEqual([])
  })

  it('main.ts 里 setOverlay 走 holdByOverlay 一处（翻格那一处由 KI-388 的读者接手）', () => {
    const main = codeOf(read('main.ts'))
    expect((main.match(/holdByOverlay\(/g) ?? []).length).toBe(1)
  })

  /*
   * 这里原来还有两条腿：「main.ts 里 `toggleByUser()` 恰一处」与「Escape 那一句仍带 overlay 闸门」。
   * KI-388 把组合根那句 `e.code === 'Escape'` 换成读动作名，两条判据同时失去对象——一个说"翻格只有
   * 组合根那一处"（现在是 `core/PauseControl.ts` 的读者那一处），一个要求那一行里出现 `Escape`。
   * 删掉而不是改写成"永远成立"的形状：新的守法在 `tests/unit/pause-action.test.ts`（读者恰一处、
   * main.ts 不吃 Escape 码、菜单在场时那条通道不给边沿）。改口登记在账本 KI-387 与 KI-388 两行。
   */

  it('第三格主人（Time.reset 把 paused 折回 false）今天没上线：src 里 time.reset() 的调用点是 0', () => {
    const calls = all
      .map((abs) => ({ r: relOf(abs), t: readFileSync(abs, 'utf8').replace(/\r\n/g, '\n') }))
      .filter(({ r, t }) => r !== 'core/Time.ts' && /(^|[^.\w])time\.reset\(\)/m.test(t))
      .map(({ r }) => r)
    expect(calls).toEqual([])
  })
})
