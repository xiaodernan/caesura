/**
 * KI-117：combat.md §4.1–4.6 六张武器帧数据表 ⇄ `movesets.json` 的第一台机器对账。
 *
 * **病是什么**：§64 的验收一直说「帧数据从表里读，代码里不写死」，而 `tests/unit/movesets.test.ts`
 * 里那些 `expect(gs['l1'].recovery).toBe(60) // 27 + 9 + 24` 的钉子是**人手从文档抄进测试的**——
 * 没有任何东西真的打开过 combat.md。于是 §4.6 无鸣那一列后摇在 2026-10-01（`3aac107`，提交信息自称
 * 「§4.6 逐格」）就和文档分了家，四格各差各的（实装 6/15/28/44 ⇄ 文档 11/12/14/22），12 天没人发现；
 * 而文档每一格是 ms 与 f **成对写**的（`183ms/11f`），这两者本应互相推得出来——以前也没人推过。
 *
 * **口径（先量过才定：`.scratch/ki127/measure2.mjs` 现量 38 行 / 246 格 / 漂移 8 处）**：
 *  - **帧表的主人是文档**。沿用 KI-037① 立在 `movesets.test.ts` 里的那句「文档写几帧，表里就得是几帧」。
 *    本批据此把 `ms_needlesilence` 的 l3/l4/l5 后摇从 15/28/44 改回文档的 12/14/22（数据侧 `recovery`
 *    是**整段结束的绝对帧**，文档那一栏是后摇时长，故写回时取 `activeEnd + 时长`）。
 *  - **唯一的例外是 l1**：文档的 11f 收势让整段变成 27f，`7/27=0.259` 会把 KI-039 的近战四族极差从
 *    1.167× 推到 **1.35×**，越过那条已经裁决过的 1.25× 红线。那是「文档与已裁决的平衡相撞」，裁决反过来：
 *    **实装 6f 为准，文档那一格改数并把算术写进备注**。（这两条分开走是刻意的：同一列里三格归文档、
 *    一格归实装，读者必须逐格看见理由，而不是被一句"以表为准"整列抹平。）
 *  - ms⇄f 的换算走引擎自己的 `msToTicks`/`ticksToMs`，60Hz 走 `TICK_HZ` 的主人，不抄第三份 16.667。
 *  - 蓄力那一格量的是**蓄满阈值**：逐武器读 `movesets.chargeTicks`（KI-117② 已落），省略即全局
 *    `CHARGE_TICKS`（48f/800ms）。它不是招式自己的 startup。所以文档必须写成 `蓄 <ms>ms` 这一族拼写
 *    才读得到——§4.4 满弓以前写 `800ms/48f`，被读成前摇 48f ⇄ 数据 20f，本批统一了拼写。
 *
 * **豁免按身份钉**（节号 + 行标签 + 栏名），不按行号：改一行字会把豁免叫回来重裁，而删一格数据不会。
 * 两张名单各自都带「不许陈旧」那一条——名单里的每一条必须真的命中，没命中就是它该被撤掉。
 *
 * **本门有意不做的三格**（登记，不冒充做了）：
 *  - `charged.startup` 那五格（20f×5，全家族同一个数）文档没有栏，写进名单而不是硬造一格；
 *  - §4.8 乐章战技（`mv_*`）那张表的另一头住在哪、有几格没读者，按 KI-028② 欠的那趟「markdown 数字表」普查接着量；
 *  - 判定窗与命中段（`双刺 6+9` 那一类备注里的数）不在六栏形状里，本门不读备注。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { itemsRaw, movesetsRaw, weaponsRaw } from '@/data'
import type { FrameData, MovesetData } from '@/data/schema'
import { CHARGE_TICKS } from '@/player/ThirdPersonController'
import { msToTicks, ticksToMs } from '@/core/Time'

/** JSON 推出来的是逐文件的字面量形状，`hitbox.shape` 会是 `string` 而顶不过 `MovesetData`——与 `src/data/index.ts:82` 同一只手写法 */
const movesets = movesetsRaw as unknown as MovesetData[]

const root = fileURLToPath(new URL('../../', import.meta.url))
/** 行尾统一成 LF 再解析：这一份文档今天是 LF，但判据不许靠这个假设（混行尾会把整段读空） */
const doc = readFileSync(`${root}docs/combat.md`, 'utf8').replace(/\r\n/g, '\n')
const ledger = readFileSync(`${root}docs/KNOWN_ISSUES.md`, 'utf8').replace(/\r\n/g, '\n')

const COLS = ['startup', 'active', 'recovery', 'damage', 'stamina', 'poise'] as const
type Col = (typeof COLS)[number]
const FRAME_COLS: Col[] = ['startup', 'active', 'recovery']
/** 引擎的帧⇄毫秒主人现算，文档的 `800ms` 与代码的 `48` 才能对上同一把尺 */
const CHARGE_MS = ticksToMs(CHARGE_TICKS)

/** 行标签 → 招式键。推不出来的走说明行/未知行两条路（未知行会红，见 L4） */
function actionKeys(label: string): string[] {
  const range = label.match(/^L(\d+)-L(\d+)/)
  if (range) return Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => `l${Number(range[1]) + i}`)
  const light = label.match(/^L(\d+)/)
  if (light) return [`l${light[1]}`]
  if (/重击\s*H/.test(label)) return ['h']
  if (/蓄力|满弓/.test(label)) return ['charged']
  if (/跑动/.test(label)) return ['run']
  if (/跳跃/.test(label)) return ['jump']
  if (/速射/.test(label)) return ['l1']
  if (/近身轻击/.test(label)) return ['l2']
  return []
}
/** 没有招式键的行只许是这两类说明行；新形状必须显式登记，否则会被当成"没人读的表体"漏掉 */
const PROSE_LABELS = ['独特属性', '战技槽']

type Cell =
  | { kind: 'empty'; raw: string }
  | { kind: 'charge'; ms: number; raw: string }
  | { kind: 'numbers'; frames: number[]; ms: number[]; bare: number[]; raw: string }

/** `200ms/12f` 是一量两标；`220/200/200/283ms` 是一格多数（单位写在尾巴上，摊给每一个数） */
function parseCell(raw: string): Cell {
  const t = (raw ?? '').trim()
  if (!t || t === '—') return { kind: 'empty', raw: t }
  const chg = t.match(/^蓄\s*(\d+(?:\.\d+)?)\s*ms/)
  if (chg) return { kind: 'charge', ms: Number(chg[1]), raw: t }
  const listUnit = t.match(/^(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)+)\s*(ms|f)$/)
  if (listUnit) {
    const nums = listUnit[1]!.split('/').map(Number)
    return { kind: 'numbers', frames: listUnit[2] === 'f' ? nums : [], ms: listUnit[2] === 'ms' ? nums : [], bare: [], raw: t }
  }
  const frames = [...t.matchAll(/(\d+(?:\.\d+)?)\s*f\b/g)].map((m) => Number(m[1]))
  const ms = [...t.matchAll(/(\d+(?:\.\d+)?)\s*ms\b/g)].map((m) => Number(m[1]))
  // 裸数：先把带单位的数整段挖掉。否定查顾在这里会漏——`200ms` 里 `\d+` 回溯交出 "20"，那种假裸数会把伤害读成 20
  const stripped = t.replace(/\d+(?:\.\d+)?\s*(?:ms|f|%|°|m\/s|km|s\b)/g, ' ').replace(/(\d+)\/(?=\d)/g, '$1 ')
  const bare = [...stripped.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]))
  return { kind: 'numbers', frames, ms, bare, raw: t }
}

/** 数据侧的三帧量：`recovery` 是整段结束的绝对帧（KI-039 口径），文档那一栏是后摇时长 */
function realFrames(a: FrameData): Record<Col, number> {
  return {
    startup: a.startup,
    active: a.activeEnd - a.activeStart,
    recovery: a.recovery - a.activeEnd,
    damage: a.damage,
    stamina: a.stamina,
    poise: a.poise,
  }
}

/**
 * 文档没有格子的数据格（身份键 = 节号|行标签|栏名），11 条各有各的理由：
 *  - `startup` 那五条：蓄力行那一格写的是**蓄满阈值**（由 L5 对着所属武器的 chargeTicks 核），不是释放动作的前摇；
 *  - `active` 那六条：弹体招式没有近战判定窗，那一格写的是弹速 / 分叉 / 「单发」/ 「即时」。
 * 加一格数据不等于加一条豁免——真需要豁免时要在这里写明是哪一格，并由 L1 的算术逼着它命中。
 */
const NO_DOC_CELL = new Map<string, string>([
  ['4.1|蓄力重击|startup', '那一格写蓄满阈值（800ms），释放前摇 20f 文档没有栏'],
  ['4.2|蓄力重击|startup', '同上（文档写 1400ms；ms_greatsword.chargeTicks=84f 已落表）'],
  ['4.3|蓄力重击|startup', '同上（文档写 1000ms；ms_spear.chargeTicks=60f 已落表）'],
  ['4.4|满弓（轻蓄）|startup', '同上（这一格以前写作 800ms/48f，被读成前摇；本批统一成「蓄」族拼写）'],
  ['4.5|蓄力 共振弹|startup', '同上（文档写 900ms；ms_staff.chargeTicks=54f 已落表）'],
  ['4.3|蓄力重击|active', '投掷枪：判定在弹体上，文档那一格写「单发」'],
  ['4.4|速射 L|active', '弹体：那一格写弹速 40m/s'],
  ['4.4|满弓（轻蓄）|active', '弹体：那一格写泛音分叉'],
  ['4.4|重击 H 破鸣箭|active', '弹体：那一格写弹速 30m/s 粗箭'],
  ['4.4|跳跃射击|active', '弹体：那一格写「即时」'],
  ['4.5|蓄力 共振弹|active', '弹体：那一格写弹体 24m/s'],
])

/**
 * KI-117② 已落：逐武器蓄满时长进了 `movesets.json > chargeTicks`，三条「未实装」豁免撤空。
 * L8 的同生同死兑现——名单空了，而 L5 现在逐格对着**所属武器**的 chargeTicks 核（不是全局 48）。
 */
const CHARGE_NOT_IMPLEMENTED = new Map<string, number>()

/**
 * 一趟读完六张表。这里**一次 expect 都不做**：读表发生在 describe 求值时，
 * 在那里抛错只会把整个文件炸成一条 suite 级失败（0 条红用例，归属点名读不到谁）。
 * 所有读数交给下面的用例逐条判。
 */
function readTables() {
  const binding: string[] = []
  const drift: string[] = []
  const internal: string[] = []
  const unlisted: string[] = []
  const misaligned: string[] = []
  const unknownRows: string[] = []
  const missingRows: string[] = []
  const duplicateRows: string[] = []
  const chargeOff: string[] = []
  const chargeHits = new Set<string>()
  const noDocHits = new Map<string, number>()
  let claims = 0
  let dataCells = 0

  const sections: { secId: string; weaponId: string; msId: string }[] = []
  for (const w of weaponsRaw) {
    const item = itemsRaw.find((i) => i.nameKey === w.nameKey)
    if (!item?.displayName) { binding.push(`${w.id} 的 ${w.nameKey} 在 items.json 里没有 displayName ⇒ 节号⇄武器的绑定没有主人`); continue }
    const m = doc.match(new RegExp(`^### (4\\.\\d+)[^\\n]*${item.displayName}`, 'm'))
    if (!m) { binding.push(`combat.md §4 里没有点名「${item.displayName}」（${w.id}）那张帧数据表 ⇒ 新武器必须同时有表`); continue }
    sections.push({ secId: m[1]!, weaponId: w.id, msId: w.movesetId })
  }
  const ids = sections.map((s) => s.secId)
  if (new Set(ids).size !== ids.length) binding.push(`两节点了同一把武器：${ids.join(' ')}`)

  for (const { secId, msId } of sections) {
    const set = movesets.find((x) => x.id === msId)
    if (!set) { binding.push(`${msId} 在 movesets.json 里没有）`); continue }
    const head = doc.match(new RegExp(`^### ${secId.replace('.', '\\.')}[^\\n]*`, 'm'))
    const rest = doc.slice(head!.index! + head![0]!.length)
    const stop = rest.search(/\n### |\n## |\n---\n#/)
    const body = stop < 0 ? rest : rest.slice(0, stop)
    const rows = body.split('\n').filter((l) => /^\|\s*[^-|: ]/.test(l) && !/^\|\s*(段|动作)\s*\|/.test(l))
    const named = new Map<string, string>()
    for (const line of rows) {
      const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
      const label = cells[0]!
      const keys = actionKeys(label)
      if (!keys.length) {
        if (!PROSE_LABELS.some((p) => label.includes(p))) unknownRows.push(`${secId} 「${label}」既推不出招式键，也不在说明行名册（${PROSE_LABELS.join('/')}）里`)
        continue
      }
      for (const k of keys) {
        const prev = named.get(k)
        if (prev) duplicateRows.push(`${secId} ${k} 被两行点名：「${prev}」与「${label}」`)
        named.set(k, label)
      }
      keys.forEach((k, ki) => {
        const a = set.actions[k] as FrameData | undefined
        if (!a) { missingRows.push(`${secId} 「${label}」→ ${k} 在 ${msId} 里不存在`); return }
        const real = realFrames(a)
        COLS.forEach((col, c) => {
          const id = `${secId}|${label}|${col}`
          const cell = parseCell(cells[c + 1] ?? '')
          const at = (list: number[]) => (list.length > 1 ? list[ki] : list[0])
          if (cell.kind === 'charge') {
            if (col !== 'startup') unlisted.push(`${id}：「蓄」族拼写只许出现在 startup 栏（这一格写着 ${cell.raw}）`)
            // KI-117② 已落：蓄满阈值逐武器从 movesets.chargeTicks 读（省略 = 全局 CHARGE_TICKS=48f/800ms）
            const wantTicks = set.chargeTicks ?? CHARGE_TICKS
            if (msToTicks(cell.ms) !== wantTicks) {
              const cid = `${secId}|${label}`
              chargeOff.push(`${cid} 声明蓄 ${cell.ms}ms(${msToTicks(cell.ms)}f) ⇄ ${msId}.chargeTicks=${wantTicks}f（省略即 ${CHARGE_TICKS}f/${CHARGE_MS}ms）`)
            }
          }
          if (cell.kind !== 'numbers') {
            if (NO_DOC_CELL.has(id)) noDocHits.set(id, (noDocHits.get(id) ?? 0) + 1)
            else unlisted.push(`${id}：文档那一格没有可推的数（「${cell.raw}」），而数据侧这一格是 ${real[col]} ⇒ 静默少读一格`)
            return
          }
          // 一格多数必须与它摊开的行数等长（KI-028 那枚「564/705」把两级塞进一格的同形病）
          for (const [listName, list] of [['f', cell.frames], ['ms', cell.ms], ['裸数', cell.bare]] as const) {
            if (keys.length > 1 && list.length > 1 && list.length !== keys.length) {
              misaligned.push(`${secId} 「${label}」的 ${listName} 有 ${list.length} 个数，而这一行点名 ${keys.length} 式`)
            }
          }
          // §4.6 双刺（hitPhases）：damage 格是一列段伤（文档「6+9」⇄ 数据 [6,9]）——
          // 整列对账，不走单数那条（单数会拿第一段去比，+9 那半就没人对了）
          if (col === 'damage' && Array.isArray((a as { hitPhases?: number[] }).hitPhases)) {
            const ph = (a as { hitPhases: number[] }).hitPhases
            if (cell.kind !== 'numbers' || cell.bare.length !== ph.length || cell.bare.some((n, i2) => n !== ph[i2])) {
              drift.push(`${secId} 「${label}」${k}.damage(hitPhases)：文档 ${cell.raw} ⇄ 数据 [${ph}]`)
            } else claims++
            return
          }
          const vf = at(cell.frames)
          const vm = at(cell.ms)
          const vn = at(cell.bare)
          if (vf !== undefined && vm !== undefined && msToTicks(vm) !== vf) {
            internal.push(`${secId} 「${label}」${col}：${vm}ms/${vf}f 互推不合（${vm}ms 按 msToTicks 应为 ${msToTicks(vm)}f）`)
          }
          const claim = FRAME_COLS.includes(col) ? (vf ?? (vm !== undefined ? msToTicks(vm) : undefined)) : (vf ?? vn)
          if (claim === undefined) {
            if (NO_DOC_CELL.has(id)) noDocHits.set(id, (noDocHits.get(id) ?? 0) + 1)
            else unlisted.push(`${id}：格子里没有可推的数（${cell.raw}），而这一条不在豁免名册里`)
            return
          }
          claims++
          if (claim !== real[col]) drift.push(`${secId} 「${label}」${k}.${col}：文档 ${claim} ⇄ 数据 ${real[col]}`)
        })
      })
    }
    for (const k of Object.keys(set.actions)) if (!named.has(k)) missingRows.push(`${secId} ${msId}.${k} 在表里没有点它的行`)
    dataCells += Object.keys(set.actions).length * COLS.length
  }
  const exemptUsed = [...noDocHits.values()].reduce((a, b) => a + b, 0)
  const staleNoDoc = [...NO_DOC_CELL.keys()].filter((k) => !noDocHits.has(k))
  const staleCharge = [...CHARGE_NOT_IMPLEMENTED.keys()].filter((k) => !chargeHits.has(k))
  return { binding, drift, internal, unlisted, misaligned, unknownRows, missingRows, duplicateRows, chargeOff, staleNoDoc, staleCharge, claims, exemptUsed, dataCells, sections, rowsCompared: undefined }
}

describe('KI-117：combat.md §4.1–4.6 的武器帧数据表逐格对着 movesets.json', () => {
  const r = readTables()

  it('绑定读得出（地板）：每把武器恰有一节，且 246 个数据格每一格都有归宿', () => {
    expect(r.binding, `武器 ⇄ 小节绑不上：\n${r.binding.join('\n')}`).toEqual([])
    expect(r.sections.length, '一张帧数据表都没读到 ⇒ 下面的算术在自证空集').toBe(weaponsRaw.length)
    expect(r.dataCells, `数据侧格子数 ${r.dataCells} 不足以铺满六栏 ⇒ movesets 读窄了（分母从数据现推，不是手钉）`).toBeGreaterThan(200)
    expect(r.claims + r.exemptUsed, `文档有数的格 ${r.claims} + 命中豁免的格 ${r.exemptUsed} ≠ 数据侧的 ${r.dataCells} 格 ⇒ 要么表被读窄，要么豁免名单与实格数不是一一对应`).toBe(r.dataCells)
    expect(r.exemptUsed, `豁免名册 ${NO_DOC_CELL.size} 条实际命中 ${r.exemptUsed} 格 ⇒ 有陈旧豁免（那一格现在其实有数了）：${r.staleNoDoc.join(' ，')}`).toBe(NO_DOC_CELL.size)
  })

  it('每一格的数字都等于数据侧派生的那一格（主人是文档；§4.6 L1 那一格反过来，理由写在备注里）', () => {
    expect(r.drift, `文档 ⇄ 数据漂移 ${r.drift.length} 格：\n${r.drift.join('\n')}`).toEqual([])
  })

  it('文档自己那一格里的 ms 与 f 必须互推得出来（换算走引擎的 msToTicks，不抄第三份 16.667）', () => {
    expect(r.internal, `ms ⇄ f 自相矛盾 ${r.internal.length} 格：\n${r.internal.join('\n')}`).toEqual([])
  })

  it('招式与行双向对齐：每一式恰有一行点名，每一行点名的招式都在那张表里，未知形状不许溜过去', () => {
    expect(r.missingRows, `表里有招式没被点名 / 行点了不存在的招式：\n${r.missingRows.join('\n')}`).toEqual([])
    expect(r.duplicateRows, `同一式被两行点名（哪一格是主人？）：\n${r.duplicateRows.join('\n')}`).toEqual([])
    expect(r.unknownRows, `推不出招式键又不算说明行的行：\n${r.unknownRows.join('\n')}`).toEqual([])
  })

  it('蓄满阈值逐武器从 movesets.chargeTicks 读（省略 = 全局 CHARGE_TICKS 基线），对不上就红', () => {
    expect(r.chargeOff, `这些蓄力格与所属武器的 chargeTicks 不符（省略即 ${CHARGE_TICKS}f/${CHARGE_MS}ms）：\n${r.chargeOff.join('\n')}`).toEqual([])
    expect(r.staleCharge, `KI-117② 已落，豁免名单必须为空：${r.staleCharge.join(' ，')}`).toEqual([])
    expect(r.internal.length + r.drift.length, '前置守卫：上面两条判据读的是同一趟读数').toBeGreaterThanOrEqual(0)
  })

  it('一格多数组必须与它摊开的行数等长（不许把两式塞进一格——KI-028 的同形病）', () => {
    expect(r.misaligned, `格子内个数与点名的招式数不匹配：\n${r.misaligned.join('\n')}`).toEqual([])
  })

  it('没有数的格子必须在豁免名册里（少一格就少一格读者，静默不算通过）', () => {
    expect(r.unlisted, `这些格子没有数又不在名册里：\n${r.unlisted.join('\n')}`).toEqual([])
  })

  it('名单还在，账本那一行就不许写 Implemented（同生同死）', () => {
    const row = ledger.split('\n').find((l) => l.startsWith('| KI-117 '))
    expect(row, 'KNOWN_ISSUES.md 里找不到 KI-117 那一行 ⇒ 豁免在引用一笔不存在的账').toBeTruthy()
    if (CHARGE_NOT_IMPLEMENTED.size > 0) {
      expect(row, `${CHARGE_NOT_IMPLEMENTED.size} 条蓄力豁免还挂着 ⇒ KI-117 那一行不许写 Implemented`).not.toContain('Implemented')
    } else {
      expect(row, '豁免已撤空（chargeTicks 落了表）⇒ KI-117 那一行必须同时翻成 Implemented，别留一笔假债').toContain('Implemented')
    }
  })
})
