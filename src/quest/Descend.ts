import { endlessSectorsOf, type EndlessSector } from '@/quest/EndlessWorld'

/**
 * src/quest/Descend.ts — KI-737「深处」：把 KI-723 的无尽扇区表接成**玩家真能走下去的一层**。
 *
 * ## 病
 * KI-723 造了 12 个扇区（每层 6 处可看、3 条可触旗标），`EndlessWorld` 也写好了 `sector()` /
 * `nextDepth()` / `describe()`——**但全仓没有一处玩家侧调用**：表只被拿去拼 EchoFlow 条目，
 * 于是「世界无穷大」在数据里成立、在游戏里根本摸不到。玩家看到的还是那八个区。
 *
 * ## 这一层怎么修
 * - **已审十二层**（`endless-sectors.json`）：逐字照表，`charted: true`。它们的三条动作各自
 *   对应一条**已在 EchoFlow 里登记**的旗标（`flag.endless.<depth>.<i>`）⇒ 按下去会进纪事页，
 *   是真实后果，不是弹一句话。
 * - **复沓层**（第 13 层起，`charted: false`）：由已审十二层**确定性重组**而成——
 *   六处可看各取自不同扇区、标题标出「复沓第 N 遭」、指路语与人物随深度轮转。
 *   同一深度逐字一致（不取随机数、不读时钟），因此**可复现、可测试、可审计**。
 * - **诚实边界**：复沓层的三条动作**不立旗标**（只在本次下行的手记里留一行）。理由不是偷懒：
 *   旗标必须有人在读（§55 那条数据闸门），而复沓深度无上限，为每一层造三条新旗标 = 无限膨胀的
 *   存档 + 无限个没有读者的名字。所以深处「不计里程」：回到地表，复沓重来——这句话在面板上明写。
 *
 * ## 与既有层的分工
 * 这里**不**读表外的任何东西、**不**写第二份扇区真值：`sectorAt()` 对第 ≤12 层原样返回表里的对象，
 * 只有 >12 层才派生。派生只 recombine 表里已有的文字，不臆造新设定（与 KI-723 同一条 canon 纪律）。
 * 玩家进程零 LLM、零联网。
 */

/** 表里有多少层是逐条审过的（复沓从它的下一层开始） */
export function chartedDepthCount(sectors: readonly EndlessSector[] = endlessSectorsOf()): number {
  return sectors.length
}

/** 一条可做的动作：已审层带真旗标（可能为 null 的只有复沓层） */
export interface DescendAction {
  /** 已审层：进 EchoFlow 的真旗标；复沓层：null（不落盘） */
  flag: string | null
  /** 动作本身（「阿汐决定不把它记下来」） */
  labelZh: string
  labelEn: string
  /** 做了之后世界怎么说 */
  narrativeZh: string
  narrativeEn: string
  /** 已审层才有：这一条在纪事页上的钩子 */
  atlasHookZh: string
  atlasHookEn: string
}

export interface DescendFloor {
  depth: number
  /** true = 已审十二层之一（动作会落旗标） */
  charted: boolean
  /** 0 = 原文；≥1 = 第 N 遭复沓 */
  recurrence: number
  sector: EndlessSector
  actions: DescendAction[]
}

/** 派生一侧的稳定性护栏：重组时不允许同一层出现两条相同文字 */
function uniqueMarks(
  sectors: readonly EndlessSector[],
  depth: number,
  want: number,
): EndlessSector['marks'] {
  const out: EndlessSector['marks'] = []
  const seen = new Set<string>()
  const n = sectors.length
  // 上界 = 表里所有扇区的记号总数；取不到就提前收（宁少不重复）
  const cap = sectors.reduce((a, s) => a + s.marks.length, 0)
  for (let step = 0; step < cap && out.length < want; step++) {
    const sec = sectors[(depth + step) % n]
    const mark = sec.marks[(depth * 2 + step) % sec.marks.length]
    if (!mark) continue
    const key = mark.zh + '\u0000' + mark.en
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ id: `mark:${depth}:${out.length}`, zh: mark.zh, en: mark.en })
  }
  return out
}

/**
 * 第 depth 层（1 起）。**≤ 已审层数 ⇒ 原样返回表里的对象**（同一个引用，测试据此钉「不改写已审内容」）。
 */
export function sectorAt(
  depth: number,
  sectors: readonly EndlessSector[] = endlessSectorsOf(),
): DescendFloor | null {
  if (!Number.isFinite(depth) || depth < 1) return null
  const d = Math.floor(depth)
  const charted = sectors.length
  if (!charted) return null
  if (d <= charted) {
    const sector = sectors[d - 1]
    return {
      depth: d,
      charted: true,
      recurrence: 0,
      sector,
      actions: sector.flags.map((f) => ({
        flag: f.flag,
        labelZh: f.toZh, labelEn: f.toEn,
        narrativeZh: f.narrativeZh, narrativeEn: f.narrativeEn,
        atlasHookZh: f.atlasHookZh, atlasHookEn: f.atlasHookEn,
      })),
    }
  }
  const over = d - charted - 1
  const base = sectors[over % charted]
  const recurrence = Math.floor(over / charted) + 1
  const guide = sectors[(over + recurrence) % charted]
  const person = sectors[(over + d) % charted]
  const marks = uniqueMarks(sectors, d, base.marks.length)
  const sector: EndlessSector = {
    id: `sector:${d}`,
    depth: d,
    seed: base.seed,
    titleZh: `${base.titleZh} · 复沓第 ${recurrence} 遭`,
    titleEn: `${base.titleEn} · recurrence ${recurrence}`,
    soundZh: base.soundZh,
    soundEn: base.soundEn,
    guideZh: guide.guideZh,
    guideEn: guide.guideEn,
    personZh: person.personZh,
    personEn: person.personEn,
    marks,
    // 复沓层不造新旗标：flags 留空，动作在下面单独给（不带 flag）
    flags: [],
    nextDepth: d + 1,
  }
  const actions: DescendAction[] = base.flags.map((f, i) => ({
    flag: null,
    labelZh: `${f.toZh}（复沓第 ${recurrence} 遭）`,
    labelEn: `${f.toEn} (recurrence ${recurrence})`,
    narrativeZh: f.narrativeZh,
    narrativeEn: f.narrativeEn,
    atlasHookZh: `${f.atlasHookZh} · 复沓`, atlasHookEn: `${f.atlasHookEn} · recurring`,
  }))
  // 复沓层的三条动作虽然不落盘，仍要彼此可区分（否则玩家三次按下去读到一模一样的一句）
  actions.forEach((a, i) => {
    const src = sectors[(over + i) % charted]
    a.narrativeZh = `${src.soundZh}；${a.narrativeZh}`
    a.narrativeEn = `${src.soundEn}; ${a.narrativeEn}`
  })
  return { depth: d, charted: false, recurrence, sector, actions }
}

/** 手记里的一行（只在本次下行内有效，回地表清空） */
export interface DescendJournalLine {
  depth: number
  zh: string
  en: string
  flag: string | null
}

export interface DescendDeps {
  hasFlag: (key: string) => boolean
  setFlag: (key: string) => void
  /** 说一声（走既有 `ui.notify` 广播，不自己造一条通道） */
  notify: (text: string, kind?: 'info' | 'reward') => void
}

export type DescendRefusal = 'unknown' | 'already' | 'out-of-range'

export interface DescendChoice {
  ok: boolean
  reason?: DescendRefusal
  line?: DescendJournalLine
}

/**
 * 一次「向深处走」的下行。**不算存档里的一条进度**（见文件头「诚实边界」）：
 * 深度与手记都活在这次下行里，回地表即归零。已审层的旗标一旦立了就是永久的（走存档通道）。
 */
export class DescendRun {
  private current = 1
  private readonly chosen = new Map<number, Set<number>>()
  private lines: DescendJournalLine[] = []

  constructor(
    private readonly deps: DescendDeps,
    private readonly sectors: readonly EndlessSector[] = endlessSectorsOf(),
  ) {}

  get depth(): number { return this.current }
  get charted(): number { return this.sectors.length }
  get journal(): readonly DescendJournalLine[] { return this.lines }

  floor(depth = this.current): DescendFloor | null {
    return sectorAt(depth, this.sectors)
  }

  /** 一直有下一层（这就是「无尽」的那一格）：不设上限、不返回 false */
  descend(): number {
    this.current += 1
    return this.current
  }

  /** 回上一层；已经在第 1 层就停在原地（不返回 false：面板读的是 `depth`） */
  ascend(): number {
    if (this.current > 1) this.current -= 1
    return this.current
  }

  /** 回到地表：深度归 1，本次手记清空（已立旗标不回滚——它们已经是世界的一部分） */
  surface(): void {
    this.current = 1
    this.lines = []
    this.chosen.clear()
  }

  /** 这一层的第 i 条动作做过没有（已审层按真旗标读；复沓层按本次手记读） */
  done(depth: number, index: number): boolean {
    const floor = this.floor(depth)
    const action = floor?.actions[index]
    if (!floor || !action) return false
    if (action.flag) return this.deps.hasFlag(action.flag)
    return this.chosen.get(depth)?.has(index) ?? false
  }

  choose(index: number, depth = this.current): DescendChoice {
    const floor = this.floor(depth)
    if (!floor) return { ok: false, reason: 'out-of-range' }
    const action = floor.actions[index]
    if (!action) return { ok: false, reason: 'unknown' }
    if (this.done(depth, index)) return { ok: false, reason: 'already' }
    const line: DescendJournalLine = {
      depth, zh: action.narrativeZh, en: action.narrativeEn, flag: action.flag,
    }
    if (action.flag) this.deps.setFlag(action.flag)
    else {
      const set = this.chosen.get(depth) ?? new Set<number>()
      set.add(index)
      this.chosen.set(depth, set)
    }
    this.lines = [...this.lines, line]
    this.deps.notify(action.narrativeZh, action.flag ? 'reward' : 'info')
    return { ok: true, line }
  }

  snapshot() {
    return {
      depth: this.current,
      charted: this.sectors.length,
      floor: this.floor()?.sector.id ?? null,
      recurrence: this.floor()?.recurrence ?? 0,
      journal: this.lines.length,
      done: this.floor()?.actions.map((_, i) => this.done(this.current, i)) ?? [],
    }
  }
}
