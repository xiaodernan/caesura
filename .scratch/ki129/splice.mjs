/**
 * KI-129 的手术刀：把「谎旗立在实话那一格」这枚错位挪回它该在的那一格，顺手拆掉那行没人读的散文。
 *
 * 为什么用文本手术而不是 JSON.parse + stringify：后者会把整份 2132 行的表重新格式化，
 * 一个语义改动会显示成"整个文件都动了"，评审与回滚都没法做。
 *
 * 两条通道（工作树 / 索引）读的不是同一件事，所以这个脚本只改**磁盘字节**，落盘由 land 脚本裁决；
 * 每个 needle 都带 `hits === 预期` 的判据，命中数不对就整份不写（宁可报错，不可静默改半）。
 *
 * 用法：node .scratch/ki129/splice.mjs <平面根> [--revert]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.argv[2]
if (!ROOT) throw new Error('用法：node splice.mjs <平面根> [--revert]')
const REVERT = process.argv.includes('--revert')

const eolOf = (text) => {
  const lf = text.split('\n').length - 1
  const crlf = text.split('\r\n').length - 1
  if (lf === crlf) return '\r\n'
  if (crlf === 0) return '\n'
  throw new Error('行尾混合 ⇒ 拒绝手术')
}

/** @param {{file:string, needle:string, fix:string, hits:number}[]} edits */
const apply = (edits) => {
  const perFile = new Map()
  for (const e of edits) {
    if (e.needle === e.fix) throw new Error(`${e.file}：needle 与 fix 相同 = 这一刀什么也没改`)
    const list = perFile.get(e.file) ?? []
    list.push(e)
    perFile.set(e.file, list)
  }
  const report = []
  const backups = new Map()
  for (const [file, list] of perFile) {
    const path = resolve(ROOT, file)
    const raw = readFileSync(path, 'utf8')
    backups.set(path, raw)
    const eol = eolOf(raw)
    let text = raw.replace(/\r\n/g, '\n')
    for (const e of list) {
      const hits = text.split(e.needle).length - 1
      if (hits !== e.hits) throw new Error(`${file}：needle 命中 ${hits} 次（预期 ${e.hits}）⇒ 整份不写\n  needle 首行「${e.needle.split('\n')[0].trim()}」`)
      text = text.split(e.needle).join(e.fix)
    }
    if (text === raw.replace(/\r\n/g, '\n')) throw new Error(`${file}：改前改后一字不差 = 这一刀是空的`)
    writeFileSync(path, text.replace(/\n/g, eol))
    report.push(`${file} EOL=${eol === '\r\n' ? 'CRLF' : 'LF'} 刀数=${list.length}`)
  }
  return { report, backups }
}

const A = {
  file: 'src/data/json/dialogue.json',
  needle: `              "setFlags": [
                "flag.faceless_answered",
                "flag.faceless_lied"
              ],
              "notify": "它在灰上写了一个字，又立刻擦掉 —— 你瞥见那是「谢」"
            },
            "next": "n5",
            "notify": "它在灰上写下「他骗你」，然后擦掉了 —— 它知道"
          },`,
  fix: `              "setFlags": [
                "flag.faceless_answered"
              ],
              "notify": "它在灰上写了一个字，又立刻擦掉 —— 你瞥见那是「谢」"
            },
            "next": "n5"
          },`,
  hits: 1,
}
const B = {
  file: 'src/data/json/dialogue.json',
  needle: `              "setFlags": [
                "flag.faceless_answered",
                "flag.faceless_told_it_is_an_ear"
              ],
              "notify": "它当场在灰上写下两个字：他骗你。然后它自己擦了"`,
  fix: `              "setFlags": [
                "flag.faceless_answered",
                "flag.faceless_lied",
                "flag.faceless_told_it_is_an_ear"
              ],
              "notify": "它当场在灰上写下两个字：他骗你。然后它自己擦了"`,
  hits: 1,
}
const C = {
  file: 'tests/flow/faceless-lost.test.ts',
  needle: ` *  · **谎是一次事件**——n4 质询的「是孩子」就是那枚谎（它当场写「他骗你」，设计原句）；
 *    本批之前这一条只加好感不加旗，它被骗了还被哄开心。`,
  fix: ` *  · **谎是一次事件**——n4 质询的「是耳朵」就是那枚谎（它当场在灰上写「他骗你」，设计原句）；
 *    这枚谎旗曾立在「是孩子」那一格 —— 而 §2.5 的小传写的就是「失声孩童」，那一格是实话。
 *    KI-129 把它挪回撒谎那一格；挪之前，说实话的人复访只会撞进《同一个音符》，五环线索永远读不到。`,
  hits: 1,
}
const D = {
  file: 'tests/flow/faceless-lost.test.ts',
  needle: `  it('「是孩子」是谎：它当场写「他骗你」，旗立、任务照常推进到步 2 完成', () => {
    const w = makeWorld()
    w.toQuestion()
    w.session.open('npc_faceless')
    expect(w.last().nodeId).toBe('n4')
    w.session.choose('c1') // 是孩子。（谎）
    expect(w.streaming.hasFlag('flag.faceless_lied'), '谎事件立旗（此前这一条只加好感）').toBe(true)`,
  fix: `  it('「是耳朵」是谎：它当场写「他骗你」，旗立、任务照常推进到步 2 完成', () => {
    const w = makeWorld()
    w.toQuestion()
    w.session.open('npc_faceless')
    expect(w.last().nodeId).toBe('n4')
    w.session.choose('c3') // 是耳朵。（把孩童说成一只耳朵 —— 那才是谎）
    expect(w.streaming.hasFlag('flag.faceless_lied'), '谎事件立旗（KI-129 之前这枚旗立在实话那一格）').toBe(true)
    expect(w.streaming.hasFlag('flag.faceless_told_it_is_an_ear'), '同一格也立起"是耳朵"那枚旗（n6 的门）').toBe(true)`,
  hits: 1,
}
const E = {
  file: 'tests/flow/faceless-lost.test.ts',
  needle: `  it('说实话（是耳朵）不立谎旗——失败分支不误伤诚实的人', () => {
    const w = makeWorld()
    w.toQuestion()
    w.session.open('npc_faceless')
    w.session.choose('c3') // 是耳朵。（实话）
    expect(w.streaming.hasFlag('flag.faceless_lied')).toBe(false)
    expect(w.streaming.hasFlag('flag.faceless_told_it_is_an_ear')).toBe(true)
    w.session.close()
  })`,
  fix: `  it('说实话（是孩子）不立谎旗——失败分支不误伤诚实的人', () => {
    const w = makeWorld()
    w.toQuestion()
    w.session.open('npc_faceless')
    w.session.choose('c1') // 是孩子。（实话：小传第一行写的就是「失声孩童」）
    expect(w.streaming.hasFlag('flag.faceless_lied')).toBe(false)
    expect(w.streaming.hasFlag('flag.faceless_told_it_is_an_ear'), '实话也不立"是耳朵"那枚旗').toBe(false)
    w.session.close()
  })`,
  hits: 1,
}
const F = {
  file: 'tests/flow/faceless-lost.test.ts',
  needle: `    w.session.choose('c1') // 谎`,
  fix: `    w.session.choose('c3') // 谎`,
  hits: 2,
}
// n6「擦掉又写同一个」没有选项，是一次"按一下"的过场；谎旗挪到 c3 之后，撒谎的人复访先撞见它，
// 再按一下才落进 n17 那句问句。老的期望（开腔就是 n17）读的是"实话格立了谎旗"那套错位，现在得把这一按写进去。
const H = {
  file: 'tests/flow/faceless-lost.test.ts',
  needle: `    w.session.open('npc_faceless')
    expect(w.last().nodeId, '谎后复访：它只写同一个音符').toBe('n17')`,
  fix: `    w.session.open('npc_faceless')
    expect(w.last().nodeId, '谎后复访第一格：它擦掉又写同一个音符').toBe('n6')
    w.session.advance() // n6 没有选项，按一下才走到问句那格
    expect(w.last().nodeId, '再按一下才落进《同一个音符》').toBe('n17')`,
  hits: 1,
}
const I = {
  file: 'tests/flow/faceless-lost.test.ts',
  needle: `    w.session.open('npc_faceless')
    expect(w.last().nodeId).toBe('n17')
    expect(w.last().choices.map((c) => c.id), '共谋 ⇒ 嵌甲的口开了').toEqual(['c1', 'c2'])`,
  fix: `    w.session.open('npc_faceless')
    w.session.advance() // 同上一条：n6 是过场，按一下才到 n17
    expect(w.last().nodeId).toBe('n17')
    expect(w.last().choices.map((c) => c.id), '共谋 ⇒ 嵌甲的口开了').toEqual(['c1', 'c2'])`,
  hits: 1,
}
const G = {
  file: 'tests/flow/faceless-lost.test.ts',
  needle: `    w.session.choose('c2') // ……我不知道。（不算谎——设计给的三选一里它是诚实的中立）
    w.session.open('npc_faceless')
    expect(w.last().nodeId).not.toBe('n17')`,
  fix: `    w.session.open('npc_faceless')
    w.session.choose('c2') // ……我不知道。（不算谎——设计给的三选一里它是诚实的中立）
    w.session.close()
    w.session.open('npc_faceless')
    expect(w.last().nodeId).not.toBe('n17')
    expect(w.last().nodeId, '没撒谎的人复访读到的是五环线索那一句')
      .toBe('n7')`,
  hits: 1,
}

const ALL = [A, B, C, D, E, F, H, I, G]
const swap = (e) => ({ ...e, needle: e.fix, fix: e.needle, hits: e.hits })
const plan = REVERT ? ALL.map(swap) : ALL

// 反向时把整刀序倒过来：G 补的那一句在 D/E/F 之后才存在，倒着走每一步的 needle 都能在当前字节里读到。
if (REVERT) plan.reverse()

const { report } = apply(plan)
console.log(`${REVERT ? 'REVERT' : 'SPLICE'} DONE ${report.join(' ｜ ')}`)
