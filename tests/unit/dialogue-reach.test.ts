import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  dialogueEdges, dialogueReachErrors, reachableNodes, stuckCycles, unreachableNodes,
} from '../../scripts/dialogue-rules.mjs'

/**
 * 对话树"读得到的台词"那一对判据的两端实测（KI-089）。
 *
 * 形状照 `lockon-table.test.ts` / `battle-table.test.ts`（同一族理由）：判据住在
 * `scripts/dialogue-rules.mjs`，门禁与这份测试读**同一段代码**。`validate-data.mjs` 一被 import 就去
 * 校验真表并 `process.exit`，所以"喂一棵合成树看它拒不拒"那一半只有搬出来才量得动。
 *
 * **这一批为什么值得存在**：开工时在真表上量到 **56 个节点里 19 个**没有任何一条边指向
 * （科温 7 / 无面童 8 / 盐歌 4）—— 写它的人以为它在场上。原来的校验器只从 root/fallback 顺
 * **第一条**路走到"落点"，走不到的节点它不作声；`narrative.md` §425 那格"缺 §2.2 步 3/4"于是长期
 * 读起来像"还没写"，而数据里那四步一句不缺、只是没人读得到。
 *
 * 底下每一条臂都是**合成树**上的最小形状：一条判据只许被它自己那件事打动。真表那一格当底，
 * 在它身上加一个孤儿节点，量的就是"门读的确实是这张表"。
 */

type Choice = { id: string; next?: string | null }
type Node = { id: string; next?: string | null; once?: boolean; choices?: Choice[] }
type Tree = { id: string; rootNode: string; fallbackNode?: string; nodes: Node[] }

/** 一棵合成树：只写这次要量到的形状，别的字段一律不写（判据不该读别的） */
const tree = (nodes: Node[], root = 'n0', fallback?: string): Tree => ({
  id: 'T', rootNode: root, ...(fallback === undefined ? {} : { fallbackNode: fallback }), nodes,
})

const real = (): Tree[] => JSON.parse(
  readFileSync(new URL('../../src/data/json/dialogue.json', import.meta.url), 'utf8'),
) as Tree[]

describe('accept 侧：真表全绿，而"绿"是在这张表上量出来的', () => {
  it('5 棵树里没有孤儿、也没有转不出来的环 ⇒ 判据一声不响', () => {
    const trees = real()
    expect(trees.map((t) => t.id).sort()).toEqual(
      ['DLG_BELLTONGUE', 'DLG_CORVIN', 'DLG_FACELESS', 'DLG_HALTRUNE', 'DLG_MEG'],
    )
    expect(dialogueReachErrors(trees)).toEqual([])
  })

  it('门读的确实是这张表：在真表上挂一个孤儿节点，它当场红一条，且只红那一条', () => {
    const trees = real()
    const victim = trees.find((t) => t.id === 'DLG_MEG')!
    const patched = trees.map((t) => (t === victim
      ? { ...t, nodes: [...t.nodes, { id: 'n99', next: null }] }
      : t))
    const e = dialogueReachErrors(patched)
    expect(e.length, '真表上挂个孤儿都不红 = 这条门在空转').toBe(1)
    expect(e[0].at).toBe('DLG_MEG')
    expect(e[0].msg).toContain('n99')
    expect(e[0].msg, '红话里没有"为什么读不到"= 下一个人只看见一个 id').toContain('没有任何一条边指向它')
  })

  it('落点那一句仍然在：每棵树都走得到一个结束节点（这条判据不吃掉原来那条）', () => {
    for (const t of real()) {
      const ends = t.nodes.filter((n) => (n.choices ?? []).length === 0 && !n.next)
      expect(ends.length, `${t.id} 一个落点都没有`).toBeGreaterThan(0)
    }
  })
})

describe('孤儿：走不到的节点，而不是"没有入边的节点"', () => {
  it('没有任何一条边指向它 ⇒ 报', () => {
    expect(unreachableNodes(tree([{ id: 'n0', next: 'n1' }, { id: 'n1' }, { id: 'n2' }]))).toEqual(['n2'])
  })

  it('入边来自一个**自己也走不到**的节点 ⇒ 照样报（量的是可达，不是入度）', () => {
    const t = tree([{ id: 'n0', next: 'n1' }, { id: 'n1' }, { id: 'n2', next: 'n3' }, { id: 'n3' }])
    expect(unreachableNodes(t), '只看入度的话 n3 会被放过：它的入边来自孤儿 n2').toEqual(['n2', 'n3'])
  })

  it('root 与 fallback 自己不需要入边（它们就是两条入口）', () => {
    expect(unreachableNodes(tree([{ id: 'n0', next: 'n1' }, { id: 'n1' }, { id: 'n2' }], 'n0', 'n2'))).toEqual([])
  })

  it('选项的 next 也是边：玩家选得过去的节点不算孤儿', () => {
    const t = tree([{ id: 'n0', choices: [{ id: 'c1', next: 'n7' }] }, { id: 'n7' }])
    expect(unreachableNodes(t)).toEqual([])
  })

  it('条件读不出来也当"走得下去"（上近似：宁可放过一个读不到的，也不误报一个读得到的）', () => {
    const t = tree([
      { id: 'n0', next: 'n1' },
      { id: 'n1', next: 'n2', ...({ conditions: { flags: { all: ['flag.never'] } } } as object) },
      { id: 'n2' },
    ] as Node[])
    expect([...reachableNodes(t)].sort()).toEqual(['n0', 'n1', 'n2'])
    expect(unreachableNodes(t)).toEqual([])
  })

  it('边读的是节点的出边：next 与选项都在里面，读不到的就是空集', () => {
    expect(dialogueEdges({ id: 'n0', next: 'n1', choices: [{ id: 'c1', next: 'n2' }, { id: 'c2' }] }))
      .toEqual(['n2', 'n1'])
    expect(dialogueEdges({ id: 'n0' })).toEqual([])
  })
})

describe('环：环里有选项就是玩家自己的抉择，`once` 不是出口', () => {
  it('两个都没有选项的节点首尾相接 ⇒ 报一只环', () => {
    expect(stuckCycles(tree([{ id: 'n0', next: 'n1' }, { id: 'n1', next: 'n0' }]))).toEqual([['n0', 'n1']])
  })

  it('环里有一个节点带选项 ⇒ 不报（玩家能走出去，困住是他选的）', () => {
    const t = tree([
      { id: 'n0', next: 'n1' },
      { id: 'n1', next: 'n0', choices: [{ id: 'c1', next: 'n2' }] },
      { id: 'n2' },
    ])
    expect(stuckCycles(t)).toEqual([])
  })

  it('环里有一个 `once` 节点 ⇒ **照样报**：读过一次之后引擎跳过它、接着还是落回环里', () => {
    // 这一格是写这道门时先写错、被它当场抓住的：`once` 看着像出口，其实只是"少演一次"。
    // 引擎那条跳过走的是 `node.next ?? null`（`Dialogue.ts > enter`），落点仍在环上。
    expect(stuckCycles(tree([{ id: 'n0', next: 'n1', once: true }, { id: 'n1', next: 'n0' }])))
      .toEqual([['n0', 'n1']])
  })

  it('环在一堆够不着的节点里 ⇒ 不报环（它们已经各报过一次孤儿，同一件事不报两遍）', () => {
    const t = tree([
      { id: 'n0' }, { id: 'z0', next: 'z1' }, { id: 'z1', next: 'z0' },
    ])
    expect(stuckCycles(t)).toEqual([])
    expect(unreachableNodes(t)).toEqual(['z0', 'z1'])
  })

  it('同一只环只报一次：环上每个节点各起一次链，归一化之后是同一份', () => {
    const t = tree([
      { id: 'n0', next: 'n1' }, { id: 'n1', next: 'n2' }, { id: 'n2', next: 'n1' },
    ])
    expect(stuckCycles(t)).toEqual([['n1', 'n2']])
  })
})

describe('判据只有一个主人：校验器是嘴，另一条腿在流程测试里', () => {
  const code = (rel: string): string =>
    readFileSync(new URL(rel, import.meta.url), 'utf8')
      .split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

  it('校验器走这份判据，而两条判据的形状与红话都不在它里面重写第二份', () => {
    const v = code('../../scripts/validate-data.mjs')
    expect(v, 'validateDialogue 不再走这份判据 = 有一条平行实现悄悄长了出来')
      .toContain('dialogueReachErrors(')
    expect(v, 'import 换了路 = 门读的不再是判据本体').toContain("from './dialogue-rules.mjs'")
    for (const copied of ['没有任何一条边指向它', '首尾相接成环', 'reachableNodes(']) {
      expect(v, `'${copied}' 又被人抄回校验器里了（判据的主人只有一个）`).not.toContain(copied)
    }
  })

  it('`.d.mts` 与 `.mjs` 的名单对得上（少一条就是 TS 那边看不见它）', () => {
    const d = code('../../scripts/dialogue-rules.d.mts')
    for (const fn of ['dialogueEdges', 'reachableNodes', 'unreachableNodes', 'stuckCycles', 'dialogueReachErrors']) {
      expect(d, `声明里少了 ${fn}`).toContain(`export function ${fn}(`)
    }
  })
})