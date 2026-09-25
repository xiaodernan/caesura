import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 文档对账闸门（KI-056）。
 *
 * 这一批修的不是代码，是「表里有 = 项目里有」这条系统性失真：架构文档 §2 那张目录表是 Phase 0 的规划
 * （需求 §56「目录已定不得更改」），十余周没和真实 `src/` 核过，于是 `ai/bt/`、`MontagePlayer`、
 * `vfx/GPUParticles` 这些从未存在的路径被下游读成了事实。§2.1 把两边逐条对上了账，
 * 但**一次性的对账必然会再漂**——所以下面这几条判据要能在"改了树、没改文档"的那一刻变红。
 *
 * 判据刻意选得机械（文件名的存在性、状态标签的枚举、过期自述的字面量）：文档的**内容**对不对
 * 只能靠人读（§82），这里守的是**结构**——一个从没被提到过的模块，一定没人核对过它。
 */

const root = fileURLToPath(new URL('../..', import.meta.url))
const archDoc = readFileSync(root + 'docs/technical-architecture.md', 'utf8')
const issues = readFileSync(root + 'docs/KNOWN_ISSUES.md', 'utf8')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = `${dir}/${name}`
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

describe('文档对账闸门（KI-056）', () => {
  it('真实 src/ 树里每一个文件名都必须在架构文档里出现过（新模块必须同时记账）', () => {
    const files = walk(root + 'src')
    const missing = files.filter((f) => !archDoc.includes(f.slice(f.lastIndexOf('/') + 1)))
    expect(
      files.length,
      'src 文件数是 §2.1 那句"事实基线"的出处，变了要同步那一节',
    ).toBeGreaterThan(60)
    expect(missing, `这些模块从没被文档提到过 = 没人对过账：${missing.join(', ')}`).toEqual([])
  })

  it('§2.1 三张对账表必须在，而且带日期（一次性对账不做，就不叫对账）', () => {
    expect(archDoc).toContain('### 2.1 这张表的对账')
    expect(archDoc).toMatch(/A\. 换了载体[\s\S]*B\. 表里的路径不存在，职责也没落[\s\S]*C\. 真树里有/)
    expect(archDoc).toMatch(/### 2\.1 这张表的对账（\d{4}-\d{2}-\d{2}/)
  })

  it('架构文档不许再出现"代码尚未开工"那一类过期自述', () => {
    for (const stale of ['代码尚未开工', '所有运行时条目均为 Planned']) {
      expect(archDoc, `过期声明又回来了：${stale}`).not.toContain(stale)
    }
  })

  it('KNOWN_ISSUES §1.5 的每一行状态标签都必须是 §78 那四个枚举之一', () => {
    const table = issues.split('## 1.5')[1].split('## 2.')[0]
    const rows = table
      .split(/\r?\n/)
      .filter((l) => l.startsWith('| ') && !l.includes('---') && !l.startsWith('| 系统 '))
    expect(rows.length, '状态表行数掉了 = 有人删了整块而不是改一行').toBeGreaterThan(50)
    const legal = ['Implemented', 'Partial', 'Placeholder', 'Blocked']
    const bad = rows
      .map((l) => ({ sys: l.split('|')[1]?.trim(), status: l.split('|')[2]?.trim() }))
      .filter((r) => !legal.includes(r.status ?? ''))
    expect(bad, `非法状态标签（§78 只允许那四个）：${JSON.stringify(bad)}`).toEqual([])
  })

  it('对账里点名的三条死绑定必须仍然被记着（谁修好了代码就该同时删这条，而不是让文档悄悄留着）', () => {
    expect(archDoc, 'F1/F3/F4 那三块调试面板的缺口必须在 §2.1 里读得到').toMatch(/EnemyDebugger[\s\S]{0,400}F1/)
    // 判据锚在 TD 表的 ID 列上：只在正文里提一句 "TD-001" 不算在册（第一版就是这样白送的，被变异探针打出来了）
    const tdTable = issues.split('## 2. Technical Debt')[1].split('## 3.')[0]
    const ids = [...tdTable.matchAll(/^\|\s*(TD-\d+)\s*\|/gm)].map((m) => m[1])
    const input = readFileSync(root + 'src/core/Input.ts', 'utf8')
    const stillDead = ['F1', 'F3', 'F4'].some((k) => input.includes(`'${k}'`))
    if (stillDead) expect(ids, '那三把键还占着却没有面板 ⇒ TD-001 必须在册').toContain('TD-001')
    else expect(ids, '键已摘掉 ⇒ TD-001 必须同时销案，别让文档留着一笔假债').not.toContain('TD-001')
    expect(ids, 'KI-056 抓出的三条流程/命名债都要有 TD 行').toEqual(expect.arrayContaining(['TD-002', 'TD-003']))
  })
})
