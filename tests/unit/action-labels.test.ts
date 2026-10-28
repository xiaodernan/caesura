import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BINDABLE_ACTIONS, type ActionName } from '@/core/Input'
import { ACTION_LABELS, actionLabel } from '@/ui/actionLabels'

/**
 * KI-337：动作中文名的**唯一主人**守卫。
 *
 * HUD 右下角那一列和「操作」页那 22 行说的是同一批东西；前者的文字以前硬写在 HUD 里，
 * 后者要的是全部动作——两处各写一遍就是两个主人，而它们永远不会出现在同一个 diff 里
 * （改了面板的说法，HUD 还是老名字，玩家在同一屏里看见同一件事有两个名字）。
 *
 * 编译期那条（`satisfies Record<ActionName, string>`）挡得住"少一格"，挡不住"再抄一份"，
 * 所以这里几条腿各盯一个方向：名册一致、名字互不重复、别处不许再硬写。
 */

const SRC = fileURLToPath(new URL('../../src', import.meta.url))
const tsFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? tsFiles(join(dir, d.name)) : d.name.endsWith('.ts') ? [join(dir, d.name)] : [])
/** 注释行不参与扫描：解释"为什么只有一个主人"的注释不该把自己扫成第二个主人 */
const live = (abs: string): string => readFileSync(abs, 'utf8')
  .split(/[\r\n]+/)
  .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
  .join('\n')
/** `src/` 之下的正斜杠相对名（Windows 的反斜杠在这里先折掉，断言才有可读的形状） */
const relOf = (abs: string): string => abs.slice(SRC.length).replace(/^[/\\]/, '').replace(/\\/g, '/')

describe('KI-337 动作名字只有一个主人', () => {
  it('名字的格子与可绑动作逐格一致（多一格是没人绑的动词，少一格是抄写漂移）', () => {
    expect(Object.keys(ACTION_LABELS).sort(), '与 BINDABLE_ACTIONS 同一份名册').toEqual([...BINDABLE_ACTIONS].sort())
    for (const a of BINDABLE_ACTIONS) expect(actionLabel(a), `${a} 有名字`).toBeTruthy()
  })

  it('名字互不重复，也不是漏翻的英文原名：两行都叫「攻击」的面板没法点', () => {
    const names = BINDABLE_ACTIONS.map((a) => ACTION_LABELS[a])
    expect(new Set(names).size, '两个动作同一个中文名 ⇒ 那一行点下去，玩家不知道自己在改谁').toBe(names.length)
    for (const n of names) {
      expect(n, `「${n}」里不许有空白或换行`).toBe(n.trim())
      expect(n, `「${n}」是给人看的中文，不是漏翻的英文原名`).toMatch(/[一-鿿]/)
    }
  })

  it('HUD 那一列的文字全部现取自这一份（唯一豁免：移动那一簇四格共用一个说法）', () => {
    const src = live(resolve(SRC, 'ui/Hud.ts'))
    expect(src, 'HUD 不走这条路就会自己去抄一份').toMatch(/from '[^']*actionLabels'/)
    const rows = [...src.matchAll(/\['(\w+)',\s*(actionLabel\('(\w+)'\)|'([^']*)')\]/g)]
    expect(rows.length, '键位列的行要数得到（量具先红，别让玩家替它红）').toBeGreaterThan(4)
    for (const m of rows) {
      const [, action, , labeled, literal] = m
      if (literal === undefined) {
        expect(labeled, `HUD 那一行的 actionLabel('${labeled}') 点的必须是同一行的动作 '${action}'`).toBe(action)
      } else {
        expect(action, `只有移动那一簇可以自带说法（其余行硬写「${literal}」就是第二个主人）`).toBe('moveUp')
        expect(literal, `「${literal}」若等于 actionLabel 会给的字，就该由它给`).not.toBe(actionLabel(action as ActionName))
      }
    }
  })

  it('这块牌子在整个 src 里只挂一次，用它的人只有那两块屏', () => {
    const all = tsFiles(SRC)
    expect(all.length, '空清单会让这条闸门变成空测试').toBeGreaterThanOrEqual(50)
    const definers = all.filter((p) => /ACTION_LABELS\s*[=:]/.test(live(p)) && !p.endsWith('actionLabels.ts'))
    expect(definers.map(relOf), '第二张动作名字表').toEqual([])
    expect(live(resolve(SRC, 'ui/actionLabels.ts')), '主人自己得是那张表').toContain('satisfies Record<ActionName, string>')
    const users = all.filter((p) => /from '[^']*actionLabels'/.test(live(p))).map(relOf)
    expect(users.sort(), '点名：谁在用这份名字（新增用法要在这里点名并写理由）').toEqual(['ui/Hud.ts', 'ui/Stakerite.ts'])
  })
})
