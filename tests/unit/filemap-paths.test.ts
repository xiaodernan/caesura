import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **技术架构文件地图里的路径必须真的在仓库里**（KI-147）。
 *
 * **为什么**：那张"未落清单"是读者判断"项目做到哪儿了"的依据，而它会**过期**——
 * 本轮复查抓到三处（导航网格已过界、注册表引用计数的前提变了、音频三主题其实在跑）。
 * **过期条目比没有条目更坏**：读者照着它以为某件事没做。
 *
 * **为什么只查文件地图那一段**：那里的每一行都是一句**结构化断言**（"这个文件在，它是什么"）。
 * 散在正文里的路径引用多半是散文（"那种写法"、"改成 X"），拿字符串判据去猜"这句是在断言存在
 * 还是在举例"必然误报（实测 8 处全是散文）。文件地图的形状是确定的（首格是反引号包着的路径），
 * 判据因此可以又窄又准。
 *
 * **豁免**：明写着"未落／规划／没有"的行（那是**有意的**规划名）与被划掉（~~）的行。
 */
const root = fileURLToPath(new URL('../..', import.meta.url))

const existing = new Set<string>()
const rel = (p: string): string => p.replace(/\\/g, '/').replace(/^.*?(?=(src|scripts|tests|docs)\/)/, '')
const walk = (dir: string): void => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules' || e.name === 'dist') continue
    const p = dir + '/' + e.name
    if (e.isDirectory()) walk(p)
    else existing.add(rel(p))
  }
}
for (const d of ['src', 'scripts', 'tests', 'docs']) walk(root + '/' + d)

const DOC = 'docs/technical-architecture.md'
const rows = readFileSync(root + '/' + DOC, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('|'))

describe('技术架构文件地图（KI-147）', () => {
  it('判据的判据：文件地图里读得到成百上千条路径断言（读空 ⇒ 下面那条恒真）', () => {
    expect(rows.length, '表格行数').toBeGreaterThan(50)
    expect(existing.size, '仓库里的文件数').toBeGreaterThan(100)
  })

  it('文件地图里断言存在的路径，仓库里都得有', () => {
    const missing: string[] = []
    let claimed = 0
    for (const row of rows) {
      const first = row.split('|')[1]?.trim() ?? ''
      const m = /^`?~?~?((?:src|scripts|tests|docs)\/[A-Za-z0-9_./-]+\.(?:ts|mjs|json|md|mts))`?/.exec(first)
      if (!m) continue
      if (/未落|规划|没有|尚未|待建|不存在|~~/.test(first)) continue // 有意的规划名
      claimed++
      if (!existing.has(m[1])) missing.push(`${m[1]}   ←  ${first.slice(0, 90)}`)
    }
    expect(claimed, '文件地图里断言存在的路径数（这条不许是 0 ⇒ 判据在自己失效）').toBeGreaterThanOrEqual(20)
    expect(missing, '文件地图里点了名、而仓库里没有的文件（读者按它去找会扑空）').toEqual([])
  })

  it('反过来：新模块进了仓库 ⇒ 文件地图里也该有它（doc-audit 那一侧的门）', () => {
    // 这一条与上一条互为反方向：上一条抓"文档说有、仓库没有"，这一条抓"仓库有、文档没提"。
    // 后者由 `tests/unit/doc-audit.test.ts` 管（每个 src/ 文件名都要在架构文档里出现过），
    // 这里只钉住"两边都在看同一个地方"，免得两扇门各看各的。
    const doc = readFileSync(root + '/' + DOC, 'utf8')
    const vfxFiles = [...existing].filter((f) => f.startsWith('src/vfx/') && f.endsWith('.ts'))
    expect(vfxFiles.length, 'vfx 层的文件数').toBeGreaterThanOrEqual(6)
    for (const f of vfxFiles) {
      const name = f.split('/').pop()!
      expect(doc.includes(name), `${name} 必须出现在技术架构里（doc-audit 的同一只手）`).toBe(true)
    }
  })
})
