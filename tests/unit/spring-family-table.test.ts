import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  ROSTER_KEYS,
  ROSTER_RELPATH,
  SERVICE_NAMES,
  commandTargetFindings,
  javaHardcodeFindings,
  javaReadsRepoDataFindings,
  parseGateRoster,
  rosterShapeFindings,
  serviceTopologyFindings,
} from '../../scripts/spring-family-rules.mjs'

/**
 * KI-422｜Spring Cloud 微服务族（主干守门人）的合约。
 *
 * 这一族**不判定**，它只做编排/重试/熔断/报告；判定与阈值的唯一主人仍然是 Node 那边。
 * 本门量的是**那件事有没有被偷走**：
 *
 *  ① 名册的形状（每格六个键、id 唯一、timeout-sec 是正整数）
 *  ② 门 id 不许在 Java 里出现第二遍（不许按名硬编码分派）
 *  ③ 阈值（名册里 timeout-sec 那个数）不许在 Java 里出现第二遍
 *  ④ 名册指向的命令真的存在（npm script / scripts/*.mjs 都得在）
 *  ⑤ 拓扑：compose ⇄ 模块 ⇄ 期望名单，三方一致
 *  ⑥ Java 侧不许去读仓库的数据表（判定只有一个主人）
 *
 * 形状照 `*-table.test.ts` 那一族：判据住在 `scripts/spring-family-rules.mjs`，
 * 门禁与这份测试读**同一段代码**；合成夹具那一臂证明「拒不拒」是真的。
 */

const root = process.cwd()
const SPRING = join(root, 'services', 'spring')

const read = (p: string): string => readFileSync(p, 'utf8')

/** 递归列一份目录下的文件（相对仓库根） */
function walk(dir: string, out: string[] = []): string[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of names) {
    if (name === 'target' || name === 'node_modules') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(relative(root, full).replace(/\\/g, '/'))
  }
  return out
}

/** 这一族的 Java 源文件 */
const javaFiles = walk(join(SPRING, 'caesura-gate', 'src', 'main', 'java'))
  .concat(walk(join(SPRING, 'caesura-report', 'src', 'main', 'java')))
  .concat(walk(join(SPRING, 'caesura-gateway', 'src', 'main', 'java')))
  .concat(walk(join(SPRING, 'caesura-config', 'src', 'main', 'java')))
  .concat(walk(join(SPRING, 'caesura-registry', 'src', 'main', 'java')))
  .filter((f) => f.endsWith('.java'))
  .map((rel) => ({ rel, text: read(join(root, rel)) }))

/** 模块目录（每个含一份 pom.xml） */
const moduleNames = readdirSync(SPRING)
  .filter((n) => {
    try {
      return statSync(join(SPRING, n, 'pom.xml')).isFile()
    } catch {
      return false
    }
  })
  .sort()

/** compose 里的服务名（`services:` 下面那一层，缩进恰两格） */
function composeServices(): string[] {
  const text = read(join(SPRING, 'docker-compose.yml'))
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((l) => l === 'services:')
  if (start < 0) return []
  const out: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    if (/^\S/.test(l)) break
    const m = /^ {2}([a-z][\w-]*):\s*$/.exec(l)
    if (m) out.push(m[1])
  }
  return out
}

const rosterText = read(join(root, ROSTER_RELPATH))
const roster = parseGateRoster(rosterText)
const pkg = JSON.parse(read(join(root, 'package.json'))) as { scripts: Record<string, string> }
const scriptFiles = readdirSync(join(root, 'scripts')).filter((f) => f.endsWith('.mjs')).map((f) => `scripts/${f}`)

describe('KI-422｜Spring Cloud 族：名册的形状', () => {
  it('读得懂、形状对：errors 0 条，findings 0 条', () => {
    expect(roster.errors, '名册读不懂就是没有读数 ⇒ 门必须红').toEqual([])
    expect(rosterShapeFindings(roster)).toEqual([])
  })

  it('名册里有门：五道（types／data／head-selfcheck／suite／ship），id 唯一', () => {
    expect(roster.gates.length).toBeGreaterThanOrEqual(5)
    const ids = roster.gates.map((g) => g.id)
    expect(new Set(ids).size, '门 id 必须唯一（两个主人 = 两份不同的真相）').toBe(ids.length)
    for (const g of roster.gates) {
      for (const key of ROSTER_KEYS) {
        expect(key in g, `门 ${g.id} 少了 ${key}`).toBe(true)
      }
    }
  })

  it('名册指着的是仓库既有的入口：命令真在（npm script / scripts/*.mjs）', () => {
    expect(commandTargetFindings({ roster, packageScripts: pkg.scripts, scriptFiles })).toEqual([])
  })
})

describe('KI-422｜Spring Cloud 族：Java 侧不许有第二个主人', () => {
  it('门 id 一个都不许出现在 Java 源码里', () => {
    // **按 key 过滤**，不断言整个 findings 数组为空：否则「阈值被抄了第二遍」这一条
    // 会让**这一条**也红起来 ⇒ 归因错位（实测踩过：两条腿同时红，说不清是谁的病）。
    expect(javaHardcodeFindings({ roster, javaFiles }).filter((f) => f.key.startsWith('门 id 写死在 Java'))).toEqual([])
  })

  it('阈值（名册里 timeout-sec 那个数）一个都不许出现在 Java 源码里', () => {
    const findings = javaHardcodeFindings({ roster, javaFiles })
    expect(findings.filter((f) => f.key.startsWith('阈值写死在 Java'))).toEqual([])
  })

  it('Java 源码里不许去读仓库的数据表（判定只有一个主人）', () => {
    expect(javaReadsRepoDataFindings({ javaFiles })).toEqual([])
  })

  it('这一族的 Java 源码真的被读到了（读空了这条门就成了一条永远绿的装饰）', () => {
    expect(javaFiles.length, '一份 Java 都没读到 ⇒ 上面那三条在读空集合').toBeGreaterThanOrEqual(5)
    const names = javaFiles.map((f) => f.rel)
    expect(names.some((n) => n.includes('caesura-gate'))).toBe(true)
    expect(names.some((n) => n.includes('caesura-report'))).toBe(true)
    expect(names.some((n) => n.includes('caesura-gateway'))).toBe(true)
  })
})

describe('KI-422｜Spring Cloud 族：拓扑三方一致', () => {
  it('compose ⇄ 模块 ⇄ 期望名单：差集两个方向都空', () => {
    expect(serviceTopologyFindings({ composeServices: composeServices(), moduleNames, expected: SERVICE_NAMES })).toEqual([])
  })

  it('模块目录真的被读到了（读空了这条门也是装饰）', () => {
    expect(moduleNames.length).toBe(SERVICE_NAMES.length)
  })
})

describe('KI-422｜Spring Cloud 族：判据的合成夹具腿（证明它拒不拒）', () => {
  it('名册少一格键 ⇒ 报出来（不是"缺了也认"）', () => {
    const bad = parseGateRoster(['caesura:', '  gates:', '    - id: x', '      family: f', '      command: npm'].join('\n'))
    expect(bad.errors).toEqual([])
    const findings = rosterShapeFindings(bad)
    expect(findings.length, '缺了 args／timeout-sec／blocking 三格却一条都不报').toBeGreaterThanOrEqual(3)
    expect(findings.some((f) => f.msg.includes('timeout-sec'))).toBe(true)
  })

  it('名册形状不对 ⇒ 逐条点名读不懂的地方', () => {
    const bad = parseGateRoster('registry:\n  a: 1\n'.replace(/\n/g, '\n'))
    expect(bad.errors.length, '顶层不是 caesura: 却一声不吭').toBeGreaterThan(0)
    expect(bad.errors[0]).toContain('caesura:')
  })

  it('Java 里出现门 id ⇒ 报出来', () => {
    const id = roster.gates[0]?.id
    expect(typeof id).toBe('string')
    const findings = javaHardcodeFindings({ roster, javaFiles: [{ rel: 'X.java', text: `if (id.equals("${id}")) {}` }] })
    expect(findings.some((f) => f.key.startsWith('门 id 写死在 Java'))).toBe(true)
  })

  it('Java 里出现阈值那个数 ⇒ 报出来（同一个数出现两遍 = 两个出处）', () => {
    const t = roster.gates[0]?.['timeout-sec']
    expect(typeof t).toBe('number')
    const findings = javaHardcodeFindings({ roster, javaFiles: [{ rel: 'Y.java', text: `int limit = ${t};` }] })
    expect(findings.some((f) => f.key.startsWith('阈值写死在 Java'))).toBe(true)
  })

  it('Java 里出现一个**别的**数 ⇒ 不报（这道门量的是"阈值被抄了第二遍"，不是"Java 里不许有数字"）', () => {
    const findings = javaHardcodeFindings({ roster, javaFiles: [{ rel: 'Z.java', text: 'int chunk = 8192;' }] })
    expect(findings.filter((f) => f.key.startsWith('阈值写死在 Java'))).toEqual([])
  })

  it('名册指向一道不存在的 npm 脚本 ⇒ 报出来（空头承诺）', () => {
    const bad = parseGateRoster(['caesura:', '  gates:', '    - id: ghost', '      family: f', '      command: npm', '      args: ["run", "nope-not-here"]', '      timeout-sec: 10', '      blocking: true'].join('\n'))
    const findings = commandTargetFindings({ roster: bad, packageScripts: pkg.scripts, scriptFiles })
    expect(findings.some((f) => f.msg.includes('nope-not-here'))).toBe(true)
  })

  it('compose 少一个服务 ⇒ 报出来', () => {
    const findings = serviceTopologyFindings({ composeServices: ['caesura-registry'], moduleNames, expected: SERVICE_NAMES })
    expect(findings.length, 'compose 少服务却一条都不报').toBeGreaterThan(0)
  })

  it('Java 去读仓库的数据表 ⇒ 报出来', () => {
    const findings = javaReadsRepoDataFindings({ javaFiles: [{ rel: 'W.java', text: 'read("src/data/json/weapons.json")' }] })
    expect(findings.length).toBeGreaterThan(0)
  })
})
