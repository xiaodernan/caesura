import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { registry } from '@/core/Registry'
import { registerGameData } from '@/data'
import type { EnemyData } from '@/data/schema'
import { Enemy } from '@/ai/Enemy'

/**
 * `Enemy.armLookBack(everyTicks, holdTicks, anchor)` 的「disarm」一半——
 * `everyTicks <= 0` 的那四条腿（KI-403 的注释只写了调用方按 `RhythmClock` 换算好再装表、
 * 唯一调用方是 `CombatManager.beatLossMoment` 且只在 `lookBackEvery > 0` 时调）。
 *
 * 这不是死代码：它是「这面鼓之后不再回头」的取消通道，是一个公开方法的半边——
 * 删掉它 = 让「关掉这只怪的回头」没有入口。测试钉住的是这个语义本身，不是硬凑覆盖。
 * 只碰公开字段（`lookBackEveryTicks`／`searchAnchor`／`searchAnchor.z`），不读私有件。
 *
 * 第二段落（KI-437）跑的是**源码文本**：`lookingBack` 那个 getter 落地之前，「回头那一拍还在进行」
 * 这句在 `sense` 与 `search` 各手写一遍，而 getter 自己零读者——所以那一格量的是"这句话有几个主人"，
 * 只能在字节上问，运行时问不出来（两处手写点行为一模一样，谁都看不出重复）。
 */
registerGameData()

const bare = (): EnemyData => JSON.parse(JSON.stringify(registry.get<EnemyData>('en_tympanus')))

describe('Enemy.armLookBack：disarm（everyTicks ≤ 0）', () => {
  it('装表再 disarm：EveryTicks 归零，anchor 换成新的那个', () => {
    const e = new Enemy(bare(), { x: 0, y: 0, z: 0 }, 'e0')
    e.armLookBack(686, 43, { x: 0, y: 0, z: -6 })
    expect(e.lookBackEveryTicks).toBe(686)

    e.armLookBack(0, 43, { x: 0, y: 0, z: 1 }) // 另一个锚点，同一函数的 disarm 半边
    expect(e.lookBackEveryTicks, 'disarm：回头时钟摘掉').toBe(0)
    expect(e.searchAnchor!.z, 'disarm 时 anchor 仍按新锚点落下').toBeCloseTo(1, 6)
  })

  it('everyTicks = 0 精确边界：不会误判成「时钟没装」', () => {
    const e = new Enemy(bare(), { x: 0, y: 0, z: 0 }, 'e1')
    e.armLookBack(0, 43)
    expect(e.lookBackEveryTicks).toBe(0)
    expect(e.searchAnchor, '没 anchor 就不动锚点').toBeNull()
  })

  it('everyTicks 是负数：同一 disarm 分支，不抛不进正半边', () => {
    const e = new Enemy(bare(), { x: 0, y: 0, z: 0 }, 'e2')
    e.armLookBack(10, 2, { x: 0, y: 0, z: 0 })
    e.armLookBack(-5, 2) // 负数同样是「摘掉」：不装时钟也不抛
    expect(e.lookBackEveryTicks).toBe(0)
    expect(e.searchAnchor?.z, '负数 disarm 不带 anchor 时锚点不动').toBe(0)
  })
})

/**
 * 「回头那一拍还在进行」这句话的主人（KI-437 的 #1 格）。
 *
 * 病不是行为：`sense` 与 `search` 两处手写 `lookBackRemainTicks > 0`，行为与 getter 完全一致，
 * 所以任何一条腿都看不出重复——跑得对，只是同一句写了三遍。修法是让那两处叫 getter，
 * 而这一格的门只能在源码上问：**这句比较在全仓库只许出现一次，且那一次住在 getter 里**。
 *
 * 名册口径（三条都有理由）：
 *  ① 总体是整棵 `src/`，不是 `Enemy.ts`——第二抄完全可能搬到别的表现层文件里去（旧注释就是这么说的）；
 *  ② 注释行被摘掉，因为 getter 自己的文档**必须**引用那句旧拼法，否则这条门会惩罚写注释的人；
 *  ③ `lookBackRemainTicks === 0`（`search` 里"这一拍正好走完，把 yaw 钉死"）**不算这一句的主人**，
 *     它问的是另一个问题；把它也收进名册就会逼出 `!this.lookingBack` 那种更含糊的写法。
 */
const REPO = fileURLToPath(new URL('../../', import.meta.url)).replace(/\\/g, '/')
const SRC_ROOT = `${REPO}src`
function srcCodeLines(re: RegExp): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${ent.name}`
      if (ent.isDirectory()) walk(p)
      else if (!ent.name.endsWith('.ts')) continue
      else
        for (const raw of readFileSync(p, 'utf8').replace(/\r\n/g, '\n').split('\n')) {
          const t = raw.trim()
          if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue
          if (re.test(raw)) out.push(`${p.replace(/\\/g, '/').slice(REPO.length)}| ${t}`)
        }
    }
  }
  walk(SRC_ROOT)
  return out
}

describe('「回头那一拍还在进行」只有一个主人（KI-437 #1）', () => {
  it('全 src 里 `lookBackRemainTicks > 0` 只出现一次，而那一次就是 getter 自己', () => {
    const cmp = srcCodeLines(/lookBackRemainTicks\s*>\s*0/)
    expect(cmp, `这句话出现了 ${cmp.length} 次：${cmp.join(' ｜ ')}`).toHaveLength(1)
    expect(cmp[0], `那一次必须住在 getter 里，读到的却是：${cmp[0]}`).toContain('get lookingBack(): boolean')
  })

  it('getter 只说这一件事：不把「没被冻住」折进来（折进来会改掉 search 那一支的语义）', () => {
    const getter = srcCodeLines(/get lookingBack\(\)/)
    expect(getter).toHaveLength(1)
    expect(getter[0], `getter 的本体读到了：${getter[0]}`).toBe(
      'src/ai/Enemy.ts| get lookingBack(): boolean { return this.lookBackRemainTicks > 0 }',
    )
  })

  it('两个读者都改叫 getter：src 里除了 getter 本体，再没有别处把那个私有计数当条件读', () => {
    const viaGetter = srcCodeLines(/this\.lookingBack\b/)
    expect([...new Set(viaGetter.map((r) => r.split('|')[0]))], '叫 getter 的只有玩法自己这一家').toEqual([
      'src/ai/Enemy.ts',
    ])
    expect(viaGetter.length, 'sense 那一眼与 search 那一站定，两处读者都要走 getter（地板，不是精确数）').toBeGreaterThanOrEqual(2)
    const raw = srcCodeLines(/this\.lookBackRemainTicks\b/)
    const isWrite = (r: string): boolean => /this\.lookBackRemainTicks\s*(=[^=]|--)/.test(r)
    const reads = raw.filter((r) => !isWrite(r) && !r.includes('get lookingBack'))
    expect(reads, `私有计数被别处当条件读了：${reads.join(' ｜ ')}`).toEqual([expect.stringContaining('lookBackRemainTicks === 0')])
  })

  it('表现层不读这句话（getter 旧注释的那半句是假的，如实登记）', () => {
    const faces = ['ui', 'world', 'tools', 'player', 'vfx', 'core']
    const found = srcCodeLines(/\.lookingBack\b/).filter((r) => faces.some((f) => r.startsWith(`src/${f}/`)))
    expect(found, `表现层读到了它：${found.join(' ｜ ')}`).toEqual([])
  })
})
