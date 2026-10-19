import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { registerGameData, regions, dialogues, quests, worldstate, worldStates as stateTable } from '@/data'
import { StreamingSystem } from '@/world/Streaming'
import { Quests } from '@/quest/Quests'
import { WorldStates } from '@/quest/WorldStates'
import { WorldState } from '@/quest/WorldState'
import { DialogueEngine, type DialogueContext } from '@/quest/Dialogue'
import { DialogueSession } from '@/quest/Settlement'
import { Inventory } from '@/rpg/Inventory'
import type { DialogueData } from '@/data/schema'

const root = fileURLToPath(new URL('../..', import.meta.url))

/**
 * KI-129：对话表里**没被声明的字段**就是没人读的散文，而它能骗到下一批写表的人。
 *
 * 起因是账本 KI-127 那一格：`DLG_FACELESS/n4` 的「是孩子。」同时挂着两样东西——`setFlags` 里的
 * `flag.faceless_lied`，和一个**顶层的** `"notify"`（「它在灰上写下「他骗你」，然后擦掉了 —— 它知道」）。
 * 后者不在 `DialogueChoice` 的声明里，`Settlement.ts:132` 只读 `effects.notify`，所以玩家从来没听见
 * 过那一句话；可它在数据里长得跟"这一格的后果"一模一样。下一批（`faceless-lost.test.ts`）照着它写完了
 * 整条失败分支，把「是孩子」当成谎——而 narrative §2.5 的小传第一行写的就是「失声孩童」，那一格是**实话**。
 * 于是撒谎与诚实两条路各自挂反：说实话的人复访永远撞进《同一个音符》（n17），五环线索那三句
 * （n7/n8/n9，也是初句圣所那个五环机关唯一的讲解）他一个字都读不到——这是 `bells.test.ts:305` 那条红
 * 在主干上的原因，也是 KI-128 普查报出的全库唯一一处内容锁死格。
 *
 * 所以这里立三道判据，从"字段有没有读者"到"旗与散文同不同源"：
 *  1. 对话表的每一层（树 / 节点 / 选项 / 条件里的内联对象）都只许有 `schema.ts` 里**声明过**的键。
 *     名单从接口正文现推，不手抄——抄了就和 KI-097 拆掉的那三张名单同病。
 *  2. `flag.faceless_lied` 的写方只有一处，且那一格自己写着「他骗你」；「是孩子。」那一格不许立它。
 *     读方也只有一处（n17 的门）。两句合起来钉住"挪一半"：旗既留在 c1 又加到 c3、或把 n17 的门拆掉，
 *     都会红在这里。
 *  3. 行为腿：跑**真引擎**证明顶层 `notify` 真的不响——判据不能只是"文本里没看见有人读"。
 */

const DECLARED = ['DialogueData', 'DialogueNode', 'DialogueChoice', 'DialogueEffects', 'DialogueCondition'] as const

/** 从 `schema.ts` 的接口正文里现推成员名；带内联对象字面量的成员同时推出它的子键名 */
function declaredMembers(src: string, iface: string): Map<string, string[]> {
  const at = src.indexOf(`export interface ${iface} {`)
  if (at < 0) throw new Error(`schema.ts 里读不到 \`export interface ${iface}\` ⇒ 这道门失去依据`)
  const end = src.indexOf('\n}', at)
  if (end < 0) throw new Error(`\`${iface}\` 的接口正文找不到行首的 \`}\` ⇒ 切不出正文`)
  const body = src.slice(at, end).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const out = new Map<string, string[]>()
  for (const line of body.split('\n').slice(1)) {
    const m = /^ {2}([A-Za-z][A-Za-z0-9_]*)(\?)?:\s*(.*)$/.exec(line)
    if (!m) continue
    const inline = /\{([^{}]*)\}/.exec(m[3])
    const subs = inline ? [...inline[1].matchAll(/([A-Za-z][A-Za-z0-9_]*)(?:\?)?:/g)].map((x) => x[1]) : []
    out.set(m[1], subs)
  }
  if (out.size === 0) throw new Error(`\`${iface}\` 正文切出了 0 个成员 ⇒ 解析式跟不上声明式，这条门是空的`)
  return out
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

describe('对话表的字段名册 ⇄ schema 声明（KI-129）', () => {
  // 行尾先归一化再切：`.` 不吃 `\r`，`$` 就永远落在 `\r` 之前 —— 在 CRLF 检出的平面上，
  // 不归一化的解析式对每一行都失配，于是这道门会安静地切出 0 个成员（下面那句 throw 就是它自己报的）
  const src = readFileSync(root + 'src/data/schema.ts', 'utf8').replace(/\r\n/g, '\n')
  const table = new Map<string, Map<string, string[]>>(DECLARED.map((n) => [n, declaredMembers(src, n)]))
  const choiceKeys = table.get('DialogueChoice')!
  const nodeKeys = table.get('DialogueNode')!
  const treeKeys = table.get('DialogueData')!
  const effKeys = table.get('DialogueEffects')!
  const condKeys = table.get('DialogueCondition')!

  it('名册本身不是空的：五个接口都切出成员，而 `notify` 只住在 effects 里', () => {
    // 判据的判据：名单为空时下面那条 every() 恒真（KI-117 那一族的空扫描）
    expect(choiceKeys.size, 'DialogueChoice 一个成员都没切出来 = 解析式脱节').toBeGreaterThan(3)
    expect(nodeKeys.size).toBeGreaterThan(3)
    expect(treeKeys.size).toBeGreaterThan(3)
    expect(effKeys.size).toBeGreaterThan(3)
    expect(condKeys.size).toBeGreaterThan(3)
    expect([...effKeys.keys()], 'notify 不住在 effects 里，第二、三道判据就全失去依据').toContain('notify')
    expect([...choiceKeys.keys()], '顶层 notify 一旦成了声明成员，"没人读的散文"这句话就得重写').not.toContain('notify')
  })

  it('每一层的每一个键都是声明过的；实测越界的整库只有一处，就在 n4·c1 那一格', () => {
    const stray: string[] = []
    const nested: string[] = []
    let seenTrees = 0, seenChoices = 0
    const checkCond = (c: unknown, at: string) => {
      if (!isObj(c)) return
      for (const [k, v] of Object.entries(c)) {
        if (!condKeys.has(k)) continue
        if (isObj(v)) for (const kk of Object.keys(v)) if (!condKeys.get(k)!.includes(kk)) nested.push(`${at} 条件 .${k}.${kk}`)
      }
    }
    for (const t of dialogues as unknown as Obj[]) {
      seenTrees++
      for (const k of Object.keys(t)) if (!treeKeys.has(k)) stray.push(`${String(t.id)} 树层 .${k}`)
      checkCond(t.entry, `${String(t.id)} 树层`)
      for (const n of (t.nodes as Obj[] | undefined) ?? []) {
        const where = `${String(t.id)}/${String(n.id)}`
        for (const k of Object.keys(n)) if (!nodeKeys.has(k)) stray.push(`${where} 节点层 .${k}`)
        checkCond(n.conditions, where)
        const eff = n.effects as Obj | undefined
        if (eff) for (const k of Object.keys(eff)) if (!effKeys.has(k)) stray.push(`${where} effects .${k}`)
        for (const c of (n.choices as Obj[] | undefined) ?? []) {
          seenChoices++
          const at = `${where}·${String(c.id)}`
          for (const k of Object.keys(c)) if (!choiceKeys.has(k)) stray.push(`${at} 选项层 .${k}`)
          checkCond(c.conditions, at)
          const ce = c.effects as Obj | undefined
          if (ce) for (const k of Object.keys(ce)) if (!effKeys.has(k)) stray.push(`${at} effects .${k}`)
        }
      }
    }
    expect(seenTrees, '一棵树都没走到 = 名册在空扫').toBeGreaterThan(5)
    expect(seenChoices, '走到 0 个选项 = 越界判据在这一趟里根本跑不到（HEAD 实测 81 个，下限只往下留余量）')
      .toBeGreaterThan(60)
    expect(stray, `这些键不在 schema 声明里，也就没有读者：${stray.join('；')}`).toEqual([])
    expect(nested, `这些条件子键不在内联声明里：${nested.join('；')}`).toEqual([])
  })

  it('谎旗与拆穿句同源：立 `faceless_lied` 的那一格自己写着「他骗你」，「是孩子。」那一格不许立它', () => {
    const n4 = dialogues.find((t) => t.id === 'DLG_FACELESS')?.nodes.find((n) => n.id === 'n4')
    if (!n4) throw new Error('读不到 DLG_FACELESS/n4 ⇒ 这条判据在空转')
    const writers = (n4.choices ?? []).filter((c) => (c.effects?.setFlags ?? []).includes('flag.faceless_lied'))
    expect(writers.map((c) => c.id), '谎旗只许有一枚写方——两处都立就是"挪一半"').toHaveLength(1)
    const liar = writers[0]
    expect(liar.text, '立谎旗的那一格必须是「是耳朵。」（把孩童说成一只耳朵）').toBe('是耳朵。')
    expect(liar.effects?.notify ?? '', '立谎旗的那一格的播报必须写着「他骗你」——旗与散文不许各说一套')
      .toContain('他骗你')
    const honest = (n4.choices ?? []).find((c) => c.text === '是孩子。')
    if (!honest) throw new Error('三选一里没有「是孩子。」这一格')
    expect(honest.effects?.setFlags ?? [], '「是孩子。」是 narrative §2.5 的实话，不许立谎旗')
      .not.toContain('flag.faceless_lied')
    expect(honest.effects?.notify ?? '', '实话那一格的播报是道谢，不是拆穿').not.toContain('他骗你')
  })

  it('`flag.faceless_lied` 全库一个写方、一个读方，读方就是《同一个音符》那道门', () => {
    const FLAG = 'flag.faceless_lied'
    const writers: string[] = []
    const readers: string[] = []
    for (const t of dialogues as unknown as Obj[]) {
      for (const n of (t.nodes as Obj[] | undefined) ?? []) {
        const where = `${String(t.id)}/${String(n.id)}`
        for (const c of (n.choices as Obj[] | undefined) ?? []) {
          const eff = c.effects as Obj | undefined
          if (((eff?.setFlags as string[] | undefined) ?? []).includes(FLAG)) writers.push(`${where}·${String(c.id)} 写`)
        }
        const flags = (n.conditions as Obj | undefined)?.flags as Obj | undefined
        for (const slot of ['all', 'any', 'not']) {
          if (((flags?.[slot] as string[] | undefined) ?? []).includes(FLAG)) readers.push(`${where} 读 .flags.${slot}`)
        }
      }
    }
    expect(writers, `谎旗的写方必须恰好一处：${writers.join('；')}`).toEqual(['DLG_FACELESS/n4·c3 写'])
    expect(readers, `谎旗的读方必须恰好一处（n17 那道门）：${readers.join('；')}`).toEqual(['DLG_FACELESS/n17 读 .flags.all'])
  })

  it('行为腿：选项顶层的 `notify` 真的一句也不响，玩家听见的那句来自 `effects.notify`', () => {
    registerGameData()
    const streaming = new StreamingSystem(regions)
    const qs = new Quests(quests, () => {}, (k) => streaming.hasFlag(k))
    const states = new WorldStates(stateTable)
    const worldState = new WorldState(worldstate, { hasFlag: (k) => streaming.hasFlag(k), setFlag: (k) => streaming.setFlag(k, true) })
    const heard: string[] = []
    const ctx: DialogueContext = {
      hasFlag: (k) => streaming.hasFlag(k),
      relation: (npc) => qs.relation(npc),
      questState: (id) => qs.state(id),
      questIndex: (id) => qs.stepIndex(id),
      hasItem: () => true,
      hasSeen: () => false,
      state: (k) => states.get(k),
    }
    /** 一棵只用来问"这字段有没有读者"的树：顶层 notify 与 effects.notify 各写一句不同的话 */
    const probe = [{
      id: 'DLG_PROBE_KI129', npc: 'npc_probe_ki129', rootNode: 'n0',
      nodes: [{
        id: 'n0', speaker: 'npc_probe_ki129', text: '（探针节点）',
        choices: [{
          id: 'c1', text: '（按下去）', style: 'silent', next: null,
          effects: { notify: '这句来自 effects —— 声明过的通道' },
          notify: '这句住在顶层 —— schema 没声明，也不该有人读',
        }],
      }],
    }] as unknown as DialogueData[]
    const session = new DialogueSession({
      quests: qs, engine: new DialogueEngine(probe, qs), ctx, inv: new Inventory('ki129'),
      setFlag: (k, v) => streaming.setFlag(k, v), setState: (k, v) => states.set(k, v),
      notify: (text) => { heard.push(text) }, refresh: () => {}, setPaused: () => {}, present: () => {},
    })
    alive.push(() => { session.close(); worldState.dispose(); states.dispose(); qs.dispose(); streaming.dispose() })
    expect(session.open('npc_probe_ki129'), '探针树没开口 = 这一趟什么都没结算').toBe(true)
    session.choose('c1')
    expect(heard, '结算只许播出台阶上声明过的那一句').toEqual(['这句来自 effects —— 声明过的通道'])
    expect(heard.join(''), '顶层 notify 一旦被引擎读起来，第一道判据就得跟着重写').not.toContain('这句住在顶层')
    session.close()
  })
})
