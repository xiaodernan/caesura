import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { schemaBlocks, interfaceFields } from '../../scripts/schema-vocab.mjs'

/**
 * **每个里程碑 grant 字段都要有消费方**（KI-145）。
 *
 * **病**：§8.2 那张表的每一行都在对玩家喊"你新能做什么"。校验器今天只问两件事：
 * ① 这一行**有没有** grant（没有 ⇒ 要么在 `PENDING_MILESTONE_GRANTS` 里带理由，要么红）；
 * ② grant 的字段名**在不在白名单**里（不在 ⇒ 红）。
 * ——**两件事都不问"这个字段有没有人真的读它"**。于是往白名单里加一个字段、在某一行 grant 里
 * 用上它、而 `derive` 忘了读它 ⇒ 门全绿，而那一格承诺**永远不会兑现**。
 * KI-054 那一行记的病（"对玩家喊出数字、运行时却一无所知的空承诺"）正是这一族。
 *
 * **判据**：白名单（= `MilestoneGrant` 的字段）里的**每一个**字段，都必须在
 * `src/rpg/Progression.ts` 的派生里被读到（`grantSum('字段')` / `identitySum('字段')` 两种读法）。
 * **消费方的读法只有那两种**（里程碑的平移合计 ＋ 身份效果的合计）——所以判据不必猜别的形状。
 */
const root = fileURLToPath(new URL('../..', import.meta.url))

const schema = readFileSync(root + 'src/data/schema.ts', 'utf8')
const derive = readFileSync(root + 'src/rpg/Progression.ts', 'utf8')
const fields = interfaceFields(schemaBlocks(schema), 'MilestoneGrant') ?? []

describe('里程碑 grant 字段都要有消费方（KI-145）', () => {
  it('判据的判据：白名单读得到东西（读空 ⇒ 下面那条恒真）', () => {
    expect(fields.length, 'MilestoneGrant 的字段数').toBeGreaterThanOrEqual(5)
  })

  it('白名单里的每一个字段都被派生读到（没有"喊了不做"的字段）', () => {
    const orphans = fields.filter((f) => !derive.includes(`grantSum('${f}')`) && !derive.includes(`identitySum('${f}')`))
    expect(
      orphans,
      '这些字段在白名单里、也可能被某一行 grant 用上，但**没有任何地方读它** ⇒ 那一格承诺永远不兑现（KI-054 那一族的病）',
    ).toEqual([])
  })

  it('每一行里程碑的 grant 字段都真的在白名单里（引号与拼写逐字对齐）', () => {
    const p = JSON.parse(readFileSync(root + 'src/data/json/progression.json', 'utf8')) as {
      milestones: { id: string; grant?: Record<string, number> }[]
    }
    const unknown: string[] = []
    for (const m of p.milestones) {
      for (const k of Object.keys(m.grant ?? {})) {
        if (!fields.includes(k)) unknown.push(`${m.id}.${k}`)
      }
    }
    expect(unknown, '表里用到的 grant 字段必须与白名单逐字相等（拼错 ⇒ 门会绿而那一格不动）').toEqual([])
  })

  it('消费方只有两种读法（平移合计 ＋ 身份效果合计）——多一种读法就得改这条门', () => {
    // 这条是"判据不许自己变窄"的反面：把消费方的读法钉住，将来加了第三种要回来改这里。
    const reads = [...derive.matchAll(/(grantSum|identitySum)\('([A-Za-z0-9_]+)'\)/g)].map((m) => m[2])
    expect(new Set(reads).size, '派生里被读到的字段种类').toBe(fields.length)
    for (const f of fields) {
      expect(reads, `${f} 必须至少被读一次`).toContain(f)
    }
  })
})
