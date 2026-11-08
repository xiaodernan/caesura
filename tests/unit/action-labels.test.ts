import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BINDABLE_ACTIONS, DEFAULT_BINDS, PICK_INTENTS, UI_INTENTS, UI_NAV_INTENTS, type ActionName, type UiIntent } from '@/core/Input'
import { ACTION_LABELS, UI_INTENT_LABELS, actionLabel, intentLabel, padLabel } from '@/ui/actionLabels'

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

/**
 * KI-343：手柄按钮的显示名也只有一个主人。
 *
 * 这一张与上面那张同一条理由，但多一个方向要盯：**名册之外不许猜**。默认手柄表用到了 16/17/18
 * 这三把（标准 `mapping` 只定义 0–15），画成 `Pad16` 是如实，画成「C」是编的——一把非标准手柄上
 * 谁也不知道那个下标是什么键，猜错了比画粗更糟（玩家照着名字按，按下的是别人的键）。
 * 名册本身从主人那里现推（读源文件），这里不另抄一份下标清单——抄了就是第二个主人。
 */
describe('KI-343 手柄按钮的名字：名册内给汉字，名册外如实画下标', () => {
  const self = live(resolve(SRC, 'ui/actionLabels.ts'))
  /** 主人那张表里的下标（从源文件现推，不在这里再抄一遍 0..15） */
  const rosterOf = (): number[] => {
    const from = self.indexOf('const PAD_BUTTON_LABELS')
    expect(from, '名册自己得还在它住的地方（改名/挪家要连着这里）').toBeGreaterThanOrEqual(0)
    const body = self.slice(self.indexOf('{', from), self.indexOf('\n}', from))
    return [...body.matchAll(/(?:[,{])\s*(\d+)\s*:/g)].map((m) => Number(m[1]))
  }

  it('标准映射那十六格各有一个给人看的名字，一格不多一格不少', () => {
    const roster = rosterOf()
    expect(roster, 'W3C `standard` 布局就是 0–15 这十六格（多出来的下标没有公认的名字，不许猜）')
      .toEqual(Array.from({ length: 16 }, (_, i) => i))
    for (const i of roster) {
      const s = padLabel(i)
      expect(s, `第 ${i} 把没有名字`).toBeTruthy()
      expect(s, `第 ${i} 把落回了原始下标 ⇒ 名册与 padLabel 两边不同步`).not.toBe(`Pad${i}`)
      expect(s, `「${s}」里不许有空白`).toBe(s.trim())
    }
  })

  it('界内但超出标准布局的下标（16–19）与非整数一律画原始下标：不猜，就不可能有第二个名字', () => {
    for (const i of [16, 17, 18, 19, 20, 99, -1]) expect(padLabel(i), `第 ${i} 把要说的是下标本身`).toBe(`Pad${i}`)
    for (const i of [1.5, NaN, Infinity]) expect(padLabel(i), '非整数不是"叫不出来就当成 0"').toBe(`Pad${i}`)
    expect(padLabel(0), '而标准布局里的 0 不许被同一条回退顺手吞掉').not.toBe('Pad0')
  })

  it('整张默认手柄表用到的每一把都点得出名：画不出名字的格子就是量具先红', () => {
    const used = Object.keys(DEFAULT_BINDS.padButtons).map(Number).sort((a, b) => a - b)
    expect(used.length, '名册外的下标这一趟要有样本（16/17/18 真在默认表里）').toBeGreaterThanOrEqual(19)
    for (const i of used) {
      const s = padLabel(i)
      expect(s, `第 ${i} 把在默认表上，却没有读数`).toBeTruthy()
      if (i <= 15) expect(s, `标准布局里的那一把不该落回原始下标`).not.toBe(`Pad${i}`)
    }
  })

  it('这张名字表在整个 src 里也只挂一次，画手柄键名的只有那一屏', () => {
    const definers = tsFiles(SRC).filter((p) => /PAD_BUTTON_LABELS\s*[=:]/.test(live(p)) && !p.endsWith('actionLabels.ts'))
    expect(definers.map(relOf), '第二张手柄按钮名字表').toEqual([])
    const readers = tsFiles(SRC).filter((p) => /\bpadLabel\b/.test(live(p)) && !p.endsWith('actionLabels.ts')).map(relOf)
    expect(readers.sort(), '谁在画手柄键名（新增读者要点名并写理由）').toEqual(['ui/Stakerite.ts'])
  })
})

/**
 * KI-344：菜单意图的中文名也只有一个主人。
 *
 * 这一张与上面那两张同一条理由，但多两个方向要盯：
 *  ① **次序也是判据**——面板按这份名单画行，名字与行号各有一位主人就会「第 3 行写着第 4 行的名字」，
 *     而编译期那条 `satisfies` 只保证格子齐：格子齐、字填错了序，它照样绿。
 *  ② **跨节同名要数得清**。玩法与菜单是同一屏上的两节，而 left/right/back 三格在玩法里也叫
 *     「左移」「右移」「后退」：同名本身不是 bug，页脚那句「等的是哪一节的哪一行」把它分开了
 *     （那条腿在 tests/flow/controls-page.test.ts）。这里钉的是「恰好这三对」——第四对一旦悄悄
 *     冒出来，玩家在同一块屏上就会看见两个同名的行，而页脚那句消歧是硬写在 moveDown/back 这一对
 *     上的，它不会替新的一对说话。
 */
describe('KI-344 菜单意图的名字：格子齐、次序对、同名只有那三对', () => {
  it('名册十七格一字不差，且次序就是画行的次序', () => {
    expect(Object.keys(UI_INTENT_LABELS), '多一格是没人走的意图，少一格是那一行没名字').toEqual([...UI_INTENTS])
    expect(UI_INTENTS.length, '这一屏要画的行数＝导航那一族＋直选那一族两位主人相加（量具先数得住，别让玩家替它数）').toBe(UI_NAV_INTENTS.length + PICK_INTENTS.length)
    const pickRows = PICK_INTENTS.map((p) => UI_INTENTS.indexOf(p))
    expect(pickRows, '直接选 1–9 是末尾九格 ⇒ 面板才写得出「导航八格 ＋ 直选九格」')
      .toEqual(UI_INTENTS.slice(-9).map((_, k) => UI_INTENTS.length - 9 + k))
  })

  it('本节内部不重名，也不是漏翻的英文原名：17 行点下去要知道改的是谁', () => {
    const names = UI_INTENTS.map((i) => intentLabel(i))
    expect(new Set(names).size, '两行都叫「上移」⇒ 那一行点下去，玩家不知道自己在改谁').toBe(names.length)
    for (const i of UI_INTENTS) {
      const s = intentLabel(i)
      expect(s, `「${i}」里不许有首尾空白`).toBe(s.trim())
      expect(s, `「${i}」漏翻成了英文原名`).not.toBe(i)
      expect(s, `「${s}」是给人看的中文，不是意图名`).toMatch(/[一-鿿]/)
    }
  })

  it('方向四格的名字写的就是那个方向：互换两个名字照样"格子齐、互不重复"，只有语义对得上才量得到', () => {
    const DIR: Array<[UiIntent, string]> = [['up', '上'], ['down', '下'], ['left', '左'], ['right', '右']]
    for (const [i, ch] of DIR) {
      expect(intentLabel(i), `「${intentLabel(i)}」里要含「${ch}」：那一行的方向由这一格说`).toContain(ch)
      for (const [, other] of DIR) if (other !== ch) {
        expect(intentLabel(i), `「${intentLabel(i)}」不许同时说另一个方向（把「上移」与「左移」互换，"互不重复"那条仍是绿的）`).not.toContain(other)
      }
    }
  })

  it('「直接选 n」那一组：名字里的数字就是它在该组里的行号，其余数字不许出现', () => {
    for (let n = 1; n <= 9; n++) {
      const row = `pick${n}` as UiIntent
      expect(PICK_INTENTS.indexOf(row) + 1, `pick${n} 在直选那一组里的第几行，界面上的数字就得写几（名册顺序⇄行号的换算只有一处）`).toBe(n)
      const digits = intentLabel(row).match(/\d/g)
      expect(digits, `「${intentLabel(row)}」没写行号数字`).toEqual([`${n}`])
    }
  })

  it('跨节同名恰好那三对：多一对就要连着页脚那条腿一起改，别让它悄悄发生', () => {
    const gameNames = BINDABLE_ACTIONS.map((a) => ACTION_LABELS[a])
    const pairs = UI_INTENTS
      .map((i) => [i, intentLabel(i)] as const)
      .filter(([, s]) => gameNames.includes(s))
      .map(([i, s]) => `${i}（菜单）＝${BINDABLE_ACTIONS[gameNames.indexOf(s)]}（玩法）＝「${s}」`)
    expect(pairs, '同名对子按名册书写序列出：这一份变了，页脚那句消歧的腿要跟着改').toEqual([
      'left（菜单）＝moveLeft（玩法）＝「左移」',
      'right（菜单）＝moveRight（玩法）＝「右移」',
      'back（菜单）＝moveDown（玩法）＝「后退」'
    ])
    for (const i of UI_INTENTS) {
      if (pairs.some((p) => p.startsWith(`${i}（`))) continue
      expect(gameNames, `${i} 的名字「${intentLabel(i)}」不该撞进玩法那一节`).not.toContain(intentLabel(i))
    }
  })

  it('这张表在整个 src 里只挂一次，画菜单名字的只有那一屏', () => {
    const definers = tsFiles(SRC).filter((p) => /UI_INTENT_LABELS\s*[=:]/.test(live(p)) && !p.endsWith('actionLabels.ts'))
    expect(definers.map(relOf), '第二张菜单意图名字表').toEqual([])
    expect(live(resolve(SRC, 'ui/actionLabels.ts')), '主人自己得是那张表').toContain('satisfies Record<UiIntent, string>')
    const readers = tsFiles(SRC).filter((p) => /\bintentLabel\b/.test(live(p)) && !p.endsWith('actionLabels.ts')).map(relOf)
    expect(readers.sort(), '谁在画菜单意图的名字（新增读者要点名并写理由）').toEqual(['ui/Stakerite.ts'])
  })
})
