import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { endlessSectorsOf } from '../../src/quest/EndlessWorld'
import { DescendRun, chartedDepthCount, sectorAt } from '../../src/quest/Descend'
import { getLang, setLang, t } from '../../src/i18n/Lang'
import { MENU_OWNERS } from '../../src/core/Input'

/**
 * KI-737「深处」的守卫。
 *
 * 这一层最容易骗人的地方有三个，逐条钉住：
 *   ① **已审内容被悄悄改写** —— 复沓派生如果原地动了表里的对象，十二层就不再是人工审过的那十二层；
 *   ② **「无尽」是假的** —— 第 13 层以后如果只是同一段文字贴 N 遍，读一遍就腻；
 *   ③ **深处偷偷写旗标** —— 深度无上限，每层三条新旗标 = 存档无限膨胀 + 无限个没有读者的名字。
 */

const sectors = endlessSectorsOf()
const ZH_RE = /[\u4e00-\u9fff]/

function makeRun(flags = new Set<string>()) {
  const written: string[] = []
  const notes: string[] = []
  const run = new DescendRun({
    hasFlag: (k) => flags.has(k),
    setFlag: (k) => { flags.add(k); written.push(k) },
    notify: (text) => { notes.push(text) },
  }, sectors)
  return { run, written, notes, flags }
}

describe('KI-737 · 已审十二层（逐字照表，不被派生改写）', () => {
  it('表不是空的，且层数就是表长（「已审」这句话有个可数的分母）', () => {
    expect(sectors.length).toBeGreaterThanOrEqual(12)
    expect(chartedDepthCount(sectors)).toBe(sectors.length)
  })

  it('前 N 层的扇区就是表里那个对象本身（同一引用 ⇒ 派生没有原地改写已审内容）', () => {
    for (let d = 1; d <= sectors.length; d++) {
      const floor = sectorAt(d, sectors)
      expect(floor?.charted).toBe(true)
      expect(floor?.recurrence).toBe(0)
      expect(floor?.sector).toBe(sectors[d - 1])
    }
  })

  it('已审层的动作带真旗标，且与表里 flags 逐条对齐（不是另造一套动作）', () => {
    for (let d = 1; d <= sectors.length; d++) {
      const floor = sectorAt(d, sectors)!
      expect(floor.actions.length).toBe(floor.sector.flags.length)
      floor.actions.forEach((a, i) => {
        expect(a.flag).toBe(floor.sector.flags[i].flag)
        expect(a.narrativeZh).toBe(floor.sector.flags[i].narrativeZh)
      })
    }
  })

  it('越界与零/负数层：返回 null，不返回一个「第 0 层」', () => {
    expect(sectorAt(0, sectors)).toBeNull()
    expect(sectorAt(-3, sectors)).toBeNull()
    expect(sectorAt(Number.NaN, sectors)).toBeNull()
  })
})

describe('KI-737 · 复沓层（第 13 层起：确定性重组，不是复制粘贴）', () => {
  it('每层都有六处可看、三条可做——深处也不许是空房间', () => {
    for (const d of [13, 14, 25, 37, 100, 1000]) {
      const floor = sectorAt(d, sectors)!
      expect(floor.charted).toBe(false)
      expect(floor.recurrence).toBeGreaterThanOrEqual(1)
      expect(floor.sector.marks.length).toBe(6)
      expect(floor.actions.length).toBe(3)
      expect(floor.sector.nextDepth).toBe(d + 1)
    }
  })

  it('同一深度两次派生逐字一致（无随机数、不读时钟）', () => {
    for (const d of [13, 31, 200]) {
      expect(JSON.stringify(sectorAt(d, sectors))).toBe(JSON.stringify(sectorAt(d, sectors)))
    }
  })

  it('同一层里六处可看不重样（重组不许把同一句话贴两遍）', () => {
    for (const d of [13, 19, 40, 77]) {
      const marks = sectorAt(d, sectors)!.sector.marks
      expect(new Set(marks.map((m) => m.zh)).size).toBe(marks.length)
      expect(new Set(marks.map((m) => m.en)).size).toBe(marks.length)
    }
  })

  it('深处的一层不等于表里的任何一层（否则「复沓」只是一个说法）', () => {
    const chartedTitles = new Set(sectors.map((s) => s.titleZh))
    for (const d of [13, 24, 25, 60]) {
      const floor = sectorAt(d, sectors)!
      expect(chartedTitles.has(floor.sector.titleZh)).toBe(false)
      expect(floor.sector.marks.map((m) => m.zh).join('|')).not.toBe(sectors[0].marks.map((m) => m.zh).join('|'))
    }
  })

  it('双语不夹杂：英文那一侧没有汉字，中文那一侧有汉字', () => {
    for (const d of [13, 26, 51]) {
      const floor = sectorAt(d, sectors)!
      const en = [floor.sector.titleEn, floor.sector.soundEn, floor.sector.guideEn, floor.sector.personEn,
        ...floor.sector.marks.map((m) => m.en), ...floor.actions.flatMap((a) => [a.labelEn, a.narrativeEn])]
      const zh = [floor.sector.titleZh, floor.sector.soundZh, floor.sector.guideZh, floor.sector.personZh,
        ...floor.sector.marks.map((m) => m.zh), ...floor.actions.flatMap((a) => [a.labelZh, a.narrativeZh])]
      en.forEach((s) => { expect(ZH_RE.test(s)).toBe(false); expect(s.trim().length).toBeGreaterThan(0) })
      zh.forEach((s) => { expect(ZH_RE.test(s)).toBe(true) })
    }
  })

  it('深度没有底：第 10000 层照样派生出完整一层', () => {
    const floor = sectorAt(10000, sectors)
    expect(floor?.sector.marks.length).toBe(6)
    expect(floor?.sector.titleZh).toContain('复沓')
  })
})

describe('KI-737 · 下行语义（旗标只在前十二层落盘）', () => {
  it('已审层做一次：立真旗标并留手记；第二次答 already，不重复写', () => {
    const { run, written, notes, flags } = makeRun()
    const flag = sectors[0].flags[0].flag
    const first = run.choose(0, 1)
    expect(first.ok).toBe(true)
    expect(written).toEqual([flag])
    expect(flags.has(flag)).toBe(true)
    expect(first.line?.flag).toBe(flag)
    expect(notes.length).toBe(1)
    const second = run.choose(0, 1)
    expect(second.ok).toBe(false)
    expect(second.reason).toBe('already')
    expect(written.length).toBe(1)
    expect(run.journal.length).toBe(1)
  })

  it('复沓层做三次：一条旗标都不写，但手记有三行且彼此可区分', () => {
    const { run, written, notes } = makeRun()
    for (let i = 0; i < 3; i++) expect(run.choose(i, 13).ok).toBe(true)
    expect(written).toEqual([])
    expect(run.journal.length).toBe(3)
    expect(new Set(run.journal.map((l) => l.zh)).size).toBe(3)
    expect(notes.length).toBe(3)
    expect(run.done(13, 0)).toBe(true)
    expect(run.choose(0, 13).reason).toBe('already')
  })

  it('done() 读的是真旗标（外部立了旗，面板立刻显示已做过）', () => {
    const flags = new Set<string>([sectors[2].flags[1].flag])
    const { run } = makeRun(flags)
    expect(run.done(3, 1)).toBe(true)
    expect(run.done(3, 0)).toBe(false)
  })

  it('descend 不设上限、ascend 卡在第 1 层、surface 回地表并清空手记', () => {
    const { run } = makeRun()
    expect(run.depth).toBe(1)
    for (let i = 0; i < 40; i++) run.descend()
    expect(run.depth).toBe(41)
    expect(run.floor()?.depth).toBe(41)
    run.ascend()
    expect(run.depth).toBe(40)
    run.choose(0, 13)
    expect(run.journal.length).toBe(1)
    run.surface()
    expect(run.depth).toBe(1)
    expect(run.journal.length).toBe(0)
    for (let i = 0; i < 5; i++) run.ascend()
    expect(run.depth).toBe(1)
    // 回地表不回滚已经立下的旗标：它们是世界的一部分
    expect(run.done(1, 0)).toBe(false)
  })

  it('snapshot 是现读（depth / recurrence / 三条动作的做完状态）', () => {
    const { run } = makeRun()
    run.descend(); run.descend()
    run.choose(0, 13)
    const snap = run.snapshot()
    expect(snap.depth).toBe(3)
    expect(snap.charted).toBe(sectors.length)
    expect(snap.recurrence).toBe(0)
    expect(snap.journal).toBe(1)
    expect(snap.done.length).toBe(3)
  })
})

describe('KI-737 · 接线与守卫（面板读真值、菜单有主、源码不许作弊）', () => {
  const read = (p: string) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8')

  it('运行时零随机零时钟：Descend.ts 里没有 Math.random / Date.now', () => {
    const src = read('src/quest/Descend.ts')
    expect(/Math\.random/.test(src)).toBe(false)
    expect(/Date\.now|new Date\(/.test(src)).toBe(false)
  })

  it('深处是菜单名册里的一格（不然它抢不到 uiStep，键盘就是死的）', () => {
    expect((MENU_OWNERS as readonly string[]).includes('descend')).toBe(true)
    const main = read('src/main.ts')
    expect(/owner === 'descend'\) descendPanel\.uiStep/.test(main)).toBe(true)
    // 三块面板互斥：开一块必须收另外两块（否则两份 uiStep 抢同一条意图通道）
    expect(/open === 'descend'\) \{ panel\.close\(\); mapUi\.close\(\); descendPanel\.show\(\)/.test(main)).toBe(true)
    expect(/else \{ panel\.close\(\); mapUi\.close\(\); descendPanel\.close\(\) \}/.test(main)).toBe(true)
  })

  it('地图里有真入口（宿主接了就印，没接就不印假把手）', () => {
    const map = read('src/ui/MapUI.ts')
    expect(map.includes('data-act="descend"')).toBe(true)
    expect(/typeof this\.deps\.onDescend === 'function'/.test(map)).toBe(true)
    const main = read('src/main.ts')
    expect(/onDescend: \(\) => setDescendOpen\(true\)/.test(main)).toBe(true)
  })

  it('面板整屏只有 t() 出来的字：ui.descend.* 在中英两表里都真的有', () => {
    const prev = getLang()
    const keys = ['title', 'floor', 'charted', 'recurrence', 'here', 'sound', 'guide', 'person',
      'marks', 'actions', 'nav', 'descend', 'ascend', 'surface', 'close', 'done', 'tip', 'honest', 'journal']
    try {
      for (const lang of ['zh', 'en'] as const) {
        setLang(lang)
        for (const k of keys) {
          const out = t('ui.descend.' + k, { n: 1, charted: 12 })
          expect(out).not.toBe('ui.descend.' + k)
          expect(out.trim().length).toBeGreaterThan(0)
          if (lang === 'en') expect(ZH_RE.test(out)).toBe(false)
        }
      }
    } finally { setLang(prev) }
  })

  it('三列不挤压：grid 有 minmax(0,…) 且窄屏落成单列（字体变形/实体块挤压的守卫）', () => {
    const panel = read('src/ui/DescendPanel.ts')
    expect(/grid-template-columns: minmax\(0,1\.05fr\) minmax\(0,1\.25fr\) minmax\(0,1fr\)/.test(panel)).toBe(true)
    expect(/@media \(max-width: 980px\)/.test(panel)).toBe(true)
    expect(panel.includes('min-width: 0')).toBe(true)
    expect(panel.includes('overflow: auto')).toBe(true)
  })

  it('面板不自己收自己（KI-061 的教训：遮罩点击直接 hide = 游戏冻在看不见的地冻里）', () => {
    const panel = read('src/ui/DescendPanel.ts')
    expect(/this\.deps\.onRequestClose\(\)/.test(panel)).toBe(true)
    // 面板自己 close() 只有「宿主调 setOverlay 时收」这一条外来路径，不许在点击处理里直接 close
    expect(/data-row\]'\)[\s\S]{0,200}this\.close\(\)/.test(panel)).toBe(false)
  })
})

describe('KI-741 · 深处的可见性（新系统不许只有翻文档的人找得到）', () => {
  const read = (p: string) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8')

  it('手记不只报条数：最近三条正文摊在屏上（做了什么都看得见）', () => {
    const panel = read('src/ui/DescendPanel.ts')
    expect(panel).toContain('run.journal.slice(-3)')
    expect(panel).toContain('ui.descend.journal.recent')
    expect(panel).toContain('j-l')
  })

  it('第一次开地图说一次「深处在哪」，且只一次（会话级，不进存档）', () => {
    const main = read('src/main.ts')
    expect(/if \(open && !deepHintShown\)/.test(main)).toBe(true)
    expect(main).toContain("t('ui.notify.deepHint')")
    // 阈值：不许写成每次开地图都喊一遍
    expect(/if \(open\) \{\s*bus\.emit\('ui\.notify', \{ text: t\('ui\.notify\.deepHint'\)/.test(main)).toBe(false)
  })

  it('新增的每条字在中英两表里都真的有（含「最近做的事 / 还没动过手」）', () => {
    const prev = getLang()
    try {
      for (const lang of ['zh', 'en'] as const) {
        setLang(lang)
        for (const k of ['ui.notify.deepHint', 'ui.descend.journal.recent', 'ui.descend.journal.empty']) {
          const out = t(k)
          expect(out).not.toBe(k)
          expect(out.trim().length).toBeGreaterThan(0)
          if (lang === 'en') expect(ZH_RE.test(out)).toBe(false)
        }
      }
    } finally { setLang(prev) }
  })
})
