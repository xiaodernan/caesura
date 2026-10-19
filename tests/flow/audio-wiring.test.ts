import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { registerGameData, duckingRows } from '@/data'

/**
 * 音频**挂接**对账：`ducking.json` 每条规则的 `trigger` 是一个**事件名**，
 * 而事件名的引用**只在数据里**（`"trigger": "combat.bossTelegraph"`），
 * 发射方在代码里（`bus.emit('combat.bossTelegraph', …)`）。
 *
 * **这两半没有任何东西同时对过** ✗：事件**改名/搬家**之后，数据里的名字仍然"看起来合法"，
 * 只是**永远等不到那一拍**——压限不再发生，而不会有别的东西响（本仓库最忌的形状）。
 * 这不是假想：`combat.bossTelegraph` 这条事件**刚刚被改过一次**（载荷从有到无），
 * 当时调用点没跟上就吃过一条 `TS2554`——那次是类型救的，**名字改了类型可救不了**。
 *
 * 判据只认"**有没有人发这个名字**"；"该不该压、压多少 dB"是听感读数，由人判（不编）。
 */
registerGameData()

/** 全仓 .ts 文本（发射方只可能写在代码里） */
function codeText(): string {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      const full = join(dir, e.name)
      if (e.isDirectory()) { walk(full); continue }
      if (e.name.endsWith('.ts')) out.push(readFileSync(full, 'utf8'))
    }
  }
  walk('src')
  return out.join('\n')
}

const code = codeText()
const emitters = (event: string): number => code.split(`bus.emit('${event}'`).length - 1

describe('音频挂接：每条压限规则的 trigger 都得有人发', () => {
  const rows = duckingRows as unknown as Array<{ id: string; trigger: string; targets: string[] }>

  it('名册不该是空的（否则这道门在空转）', () => {
    expect(rows.length).toBeGreaterThan(0)
  })

  it('每条规则的 `trigger` 在代码里**至少有一个 `bus.emit` 发射点**', () => {
    const silent = rows.filter((r) => emitters(r.trigger) === 0).map((r) => `${r.id}→${r.trigger}`)
    expect(
      silent,
      `这些压限规则等不到那一拍（事件改名/搬家了，或从来没接过）⇒ 压限静默失效：${silent.join(', ')}`,
    ).toEqual([])
  })

  it('每条规则的 `trigger` 都在 `core/EventBus.ts` 里声明过（名字必须在事件表里）', () => {
    const bus = readFileSync(join('src', 'core', 'EventBus.ts'), 'utf8')
    const undeclared = rows.filter((r) => !bus.includes(`'${r.trigger}':`)).map((r) => `${r.id}→${r.trigger}`)
    expect(undeclared, `事件表里没有这些名字：${undeclared.join(', ')}`).toEqual([])
  })
})
