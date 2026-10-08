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

  it('对账里点名的死绑定：每把被占住的键必须有读者，没有读者就必须留一笔 TD（同生同死）', () => {
    expect(archDoc, 'F1/F3/F4 那三块调试面板必须在 §2.1 里读得到（落没落都算账）').toMatch(/EnemyDebugger[\s\S]{0,400}F1/)
    // 判据锚在 TD 表的 ID 列上：只在正文里提一句 "TD-001" 不算在册（第一版就是这样白送的，被变异探针打出来了）
    const tdTable = issues.split('## 2. Technical Debt')[1].split('## 3.')[0]
    const ids = [...tdTable.matchAll(/^\|\s*(TD-\d+)\s*\|/gm)].map((m) => m[1])
    // "死"的判据不是"键还写在 Input 里"——那份清单是**预留表**（`preventDefault` 不让浏览器抢走），
    // 键出现在那儿是应该的。死的是"占着名字没人读"。所以这里查的是读者，而且读者必须是面板本身：
    // 谁往预留表里加一把 F 键又不接面板，这条就会把 TD-001 叫回来。
    const input = readFileSync(root + 'src/core/Input.ts', 'utf8')
    const panels = readFileSync(root + 'src/main.ts', 'utf8') + readFileSync(root + 'src/tools/CombatDebugger.ts', 'utf8')
    // 两侧都要**结构**判据，不能只看字符串出现过：
    // 预留侧锚在 `e.code` 那份名单上，读者侧锚在**绑定**上（`key: 'F1'` / `e.key !== 'F2'`）。
    // 否则"面板拆了但注释里还写着 'F1'"就能骗过这条——探针 D 第一次正是这么漏的。
    const reservedList = input.match(/\[([^\]]*)\]\.includes\(e\.code\)/)?.[1] ?? ''
    const reserved = ['F1', 'F2', 'F3', 'F4'].filter((k) => reservedList.includes(`'${k}'`))
    const bound = new Set([...panels.matchAll(/(?:key:\s*|\.key\s*[!=]==\s*)'(F\d)'/g)].map((m) => m[1]))
    const unbound = reserved.filter((k) => !bound.has(k))
    expect(reserved.length, '预留表里的 F 键整批被删了 = 这条判据在空转').toBeGreaterThanOrEqual(4)
    expect([...bound], '这些绑定不在预留表里 = 面板接了一把没预留的键（浏览器会把它抢走）')
      .toEqual(expect.arrayContaining(reserved.filter((k) => bound.has(k))))
    if (unbound.length) expect(ids, `这些键占着预留位却没有面板：${unbound.join(' ')} ⇒ TD-001 必须在册`).toContain('TD-001')
    else expect(ids, '每把预留键都有了读者 ⇒ TD-001 必须同时销案，别让文档留着一笔假债').not.toContain('TD-001')
    // TD-002（「按着地图的名字在调音」）已于 2026-10-08 结案：结案方式是**把地图真的落了**
    // （`ui/MapUI.ts` + `map` 键只开地图），不是改键名。所以它和 TD-001 同一条规矩——
    // 不许留在表里当假债，必须在注记里留号。把下面这句翻回 arrayContaining 就是给假债放行。
    expect(ids, 'TD-002 已结案（§43 地图落地）却还留在 TD 表里 = 一笔假债').not.toContain('TD-002')
  })

  it('销案的 TD 留号不留行：一个编号只能待在 TD 表或那段注记里，两边都在 / 两边都不在都算红', () => {
    // 判据形状与上面那条 F1/F3/F4 的门同一来源（KI-058 立的规矩）：**同生同死**。
    // 只查"表里不许有已销案编号"会漏掉另一半——把注记整段删掉也能白得一条绿。
    const td = issues.split('## 2. Technical Debt')[1].split('## 3.')[0]
    const at = td.indexOf('> **销案的债留号不留行**')
    expect(at, 'TD 表下面那段"留号不留行"注记整块不见了 ⇒ 这条判据在读一个空集合').toBeGreaterThan(-1)
    const table = td.slice(0, at)
    const note = td.slice(at)
    const inTable = [...table.matchAll(/^\|\s*(TD-\d+)\s*\|/gm)].map((m) => m[1])
    const retired = [...new Set([...note.matchAll(/~~(TD-\d+)~~/g)].map((m) => m[1]))]
    // 地板从 2 降到 1：TD-002 结案出表后表里只剩 TD-006 一行。这道判据防的是"分母读空"，
    // 一行也不是空——真正该红的是"一行都没有"（抽取器坏了 / 整块被删）。
    expect(inTable.length, 'TD 表一行都没读到 = 分母是空的').toBeGreaterThanOrEqual(1)
    expect(retired.length, '注记里一个销案编号都没读到 = 分子是空的').toBeGreaterThanOrEqual(4)
    const both = retired.filter((id) => inTable.includes(id))
    expect(both, `这些编号已销案却还留在 TD 表里（假债）：${both.join(' ')}`).toEqual([])
    expect(retired, '已销案的编号必须在那段注记里点名（TD-003 = Milestone tag，2026-10-01 结案；TD-002 = §43 地图落地，2026-10-08 结案）').toEqual(
      expect.arrayContaining(['TD-001', 'TD-002', 'TD-003', 'TD-004', 'TD-005']),
    )
  })
})
