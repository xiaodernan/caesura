import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import {
  ORCHESTRATION_OWNERS,
  REPO_ENTRY_COMMANDS,
  ROSTER_KEYS,
  ROSTER_RELPATH,
  SERVICE_NAMES,
  breakerOrderFindings,
  breakerWiredFindings,
  commandTargetFindings,
  containerShapeFindings,
  imageProvidesNode,
  javaHardcodeFindings,
  javaReadsRepoDataFindings,
  orchestrationOwnerFindings,
  parseGateRoster,
  probeNumbersFindings,
  probeRosterFindings,
  rosterScopeFindings,
  rosterShapeFindings,
  serviceTopologyFindings,
  spawnShapeFindings,
} from '../../scripts/spring-family-rules.mjs'
import {
  MARK_SCRIPT_RELPATH,
  SPAWN_LEDGER_ENV,
  attributeMarks,
  halfOpenFindings,
  isMarking,
  ledgerFindings,
  markingIds,
  parseCircuitYml,
  parseLedger,
  rolesFromRoster,
  roundWindows,
  runSpawnLedgerCheck,
  stopwatchTable,
} from '../../services/spring/spawn-ledger-check.mjs'
import {
  composeImageTags,
  parseBaseImages,
  parseGlibcNeeded,
  parseGlibcProvided,
  runContainerImageCheck,
} from '../../services/spring/container-image-check.mjs'

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

/** 仓库里那份真的 Dockerfile（判据腿与核对器的解析器腿共吃这一份字节） */
const repoDockerfile = read(join(SPRING, 'Dockerfile'))

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

/**
 * 合成夹具用的 Dockerfile：**四处都合规**（真有一个 node 阶段并从它抄二进制）。
 * 夹具腿改一处就应当只红那一处。
 */
const FIXTURE_DOCKERFILE = 'FROM node:22 AS node\nCOPY --from=node /usr/local/bin/node /usr/local/bin/node\n'

/**
 * 合成夹具：一份**四处都合规**的 compose 文本（镜像带 node／每格都 build／
 * 客户端用服务名找注册中心／主机名用服务名）⇒ 夹具腿改一处就应当只红那一处。
 */
function fixtureCompose(): string {
  const clients = ['caesura-gate', 'caesura-report', 'caesura-gateway']
  const blocks = SERVICE_NAMES.map((name) => {
    const lines = [
      `  ${name}:`,
      '    build:',
      '      context: .',
      '      dockerfile: Dockerfile',
      `    image: caesura/${name.replace('caesura-', '')}:0.1.0`,
    ]
    if (clients.includes(name)) {
      lines.push(
        `    command: ["java", "-jar", "x.jar", "--eureka.client.service-url.defaultZone=http://caesura-registry:8761/eureka/", "--eureka.instance.hostname=${name}"]`,
      )
    }
    return lines.join('\n')
  })
  return ['services:', ...blocks].join('\n')
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

describe('KI-429｜Spring Cloud 族：编排参数各有主人（熔断／并发）', () => {
  it('编排参数在主人那份 YAML 里真的有一格，Java 源码里不许再出现第二遍', () => {
    const ymlTexts = Object.fromEntries(ORCHESTRATION_OWNERS.map((o) => [o.owner, read(join(root, o.owner))]))
    expect(orchestrationOwnerFindings({ owners: ORCHESTRATION_OWNERS, ymlTexts, javaFiles })).toEqual([])
  })

  it('主人那份 YAML 真的被读到了（读空了这条门就是装饰）', () => {
    for (const o of ORCHESTRATION_OWNERS) {
      expect(read(join(root, o.owner)).length, `${o.owner} 读空了`).toBeGreaterThan(0)
    }
  })

  it('名册只装判定：编排参数不许混进名册', () => {
    expect(rosterScopeFindings(rosterText)).toEqual([])
  })

  it('熔断接上了：三态齐 ＋ 起进程之前问一句 ＋ 开闸时如实说没起进程', () => {
    expect(breakerWiredFindings({ javaFiles })).toEqual([])
  })

  it('这一族真的读到了新写的那几份 Java（读空了上面四条就是在读空集合）', () => {
    const names = javaFiles.map((f) => f.rel)
    expect(names.some((n) => n.includes('CircuitBreaker.java'))).toBe(true)
  })

  it('进程形状：Windows 上 npm 那一档经过 cmd /c（否则它一出生就死——实测过）', () => {
    expect(spawnShapeFindings({ javaFiles })).toEqual([])
  })
})

describe('KI-430｜Spring Cloud 族：容器形态（这一族第一次有容器）', () => {
  const dockerfile = read(join(SPRING, 'Dockerfile'))
  const composeText = read(join(SPRING, 'docker-compose.yml'))

  it('容器形态那四件都成立：镜像带 node ／ 每格都 build ／ 找注册中心用服务名 ／ 主机名用服务名', () => {
    expect(containerShapeFindings({ dockerfile, composeText, serviceNames: SERVICE_NAMES })).toEqual([])
  })

  it('那份 Dockerfile 真的被读到了（读空了上面那条就是在读空气）', () => {
    expect(dockerfile.length, 'services/spring/Dockerfile 读空了').toBeGreaterThan(0)
    expect(dockerfile).toContain('FROM')
  })

  it('镜像里同时有 JRE 与 Node（门跑的是仓库既有的 npm／node 入口）', () => {
    expect(dockerfile, '镜像里没有 JRE ⇒ jar 起不来').toMatch(/FROM\s+\S*temurin/i)
    // 用**判据本身**那份判定（不是另一条弱正则）：第一版的裸正则会被注释里的
    // 「apt install nodejs」骗过（实测踩过）⇒ 这里必须读真机制。
    expect(imageProvidesNode(dockerfile), '镜像里没有 node ⇒ 每一道门都会起不来').toBe(true)
  })

  it('compose 里五个名字都在（容器形态那一格是逐格判的）', () => {
    for (const name of SERVICE_NAMES) {
      expect(composeText, `compose 里没有 ${name}`).toContain(`  ${name}:`)
    }
  })
})

/**
 * KI-430（接手那一半）｜**核对器自己**那三台解析器第一次有腿。
 *
 * 为什么这一格值得单独站：`services/spring/container-image-check.mjs` 是本批唯一产出
 * 「glibc 方向」那个读数的机器，而它**上一次被跑起来的那一刻就崩了**——
 * `maxGlibcNeeded` 里写的是 `hits.push(…)`，而 `hits` 是一只 `Set`（`TypeError: hits.push is not a function`）。
 * 崩在**读二进制那一步之前**，所以「静态那半」从来没有过读数：Dockerfile 注释里那两个数
 * （2.28／2.43）当时是**从另一支探针**手抄进来的，不是这台机器说的。
 *
 * 「一跑就崩」这件事判据看不出来——判据读的是 compose／Dockerfile 的**形状**，它不跑这台机器。
 * ⇒ 这一族的病根与 KI-429 那三道「一出生就死」的门同形：**没被跑过的读数不是读数**。
 * 修法不是把注释里的数改掉，而是把这三台解析器**变成有腿的出口**：
 * 腿在合成字节上量，不碰 docker，所以每次门禁都跑得到。
 */
describe('KI-430｜容器镜像核对器：三台解析器有腿（那台机器上辈子一跑就崩）', () => {
  it('模块被 import 的那一刻一个 docker 进程都不起（五个出口都在 ⇒ 顶层那段跑机器的代码在围栏后面）', () => {
    for (const [name, fn] of [
      ['parseBaseImages', parseBaseImages],
      ['composeImageTags', composeImageTags],
      ['parseGlibcNeeded', parseGlibcNeeded],
      ['parseGlibcProvided', parseGlibcProvided],
      ['runContainerImageCheck', runContainerImageCheck],
    ] as Array<[string, unknown]>) {
      expect(typeof fn, `${name} 不是函数 ⇒ 这个出口没了，腿就在读空气`).toBe('function')
    }
    // 真跑它 = 动 docker。这里只证明**它是可取的**，不在门禁里起容器。
    expect(typeof runContainerImageCheck, 'runContainerImageCheck 必须由测试**不调用**地存在').toBe('function')
  })

  /**
   * 本批实测这一格是**红的**：`composeImageTags` 在 `.mjs` 里有腿、在测试里被真调用（该文件全绿），
   * 而那份 `.d.mts` 没声明它 ⇒ `npx tsc --noEmit` 报 TS2305。**运行时看得见、类型面看不见**的出口，
   * 门禁里那条跑 tsc 的门会红着说出来，而跑 vitest 的那条不会——所以这条腿把两面名单钉成**双向相等**。
   * 它不抄 `world-graph`／`event-rules` 那两条按名读的门：那两族的人口是 `scripts/*-rules.mjs`，
   * 这一对住在 `services/spring/` 底下，**不在它们的名册里**（这正是漏掉的成因）。
   * 抽取器认全四种拼法：那两条姊妹门只读 `function|const`，全仓 32 对里有 2 对因此被少数
   * （`export declare const`／`export async function`）——数错的那一侧会把「两边相等」判成不等。
   */
  it('两面名单双向相等：`.d.mts` 声明的每一条 `.mjs` 都得导出，`.mjs` 导出的每一条 `.d.mts` 都得声明（KI-430 本批实测缺过一格）', () => {
    const stripComments = (t: string): string =>
      t
        .split(/\r?\n/)
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join('\n')
    const declared = (text: string): string[] =>
      [
        ...new Set([
          ...stripComments(text).matchAll(/^export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm),
        ]),
      ]
        .map((m) => m[1])
        .sort()
    const mjs = declared(read(join(SPRING, 'container-image-check.mjs')))
    const dts = declared(read(join(SPRING, 'container-image-check.d.mts')))
    expect(mjs.length, '.mjs 一条导出都没读到 ⇒ 这条判据在看空集合，相等是白送的').toBeGreaterThanOrEqual(5)
    expect(dts.length, '.d.mts 一条声明都没读到 ⇒ 同上（那份文件换了形状还是被清空了？）').toBeGreaterThanOrEqual(5)
    // 名册钉死：这五条就是腿的全体（多一条少一条都要人来说话）
    expect(mjs, '.mjs 的导出名册').toEqual(['composeImageTags', 'parseBaseImages', 'parseGlibcNeeded', 'parseGlibcProvided', 'runContainerImageCheck'])
    expect(dts.filter((n) => !mjs.includes(n)), '.d.mts 声明了而 .mjs 没有 ⇒ 那份声明在描述一个不存在的部位').toEqual([])
    expect(mjs.filter((n) => !dts.includes(n)), '.mjs 导出了而 .d.mts 没声明 ⇒ tsc 里用它是 TS2305，而 vitest 全绿看不见').toEqual([])
  })

  it('两个底座是从 Dockerfile 现读的：node 那一格认名字轴（AS node），交付那一格是 temurin（判据不许抄数）', () => {
    const bases = parseBaseImages(repoDockerfile)
    expect(bases.froms.length, `FROM 应该只有两条（node 阶段 ＋ 交付阶段），实读 ${JSON.stringify(bases.froms)}`).toBe(2)
    expect(bases.nodeStage, '读不出 node 那个阶段 ⇒ 核对器连源镜像都不知道').toBeTruthy()
    expect(bases.nodeStage!.alias, 'node 阶段的名字轴就是 `AS node`').toBe('node')
    expect(bases.target, '读不出交付阶段 ⇒ 连往哪儿抄都不知道').toBeTruthy()
    expect(bases.target!.image, '交付阶段不是 temurin ⇒ JRE 那一半换了主人，注释要改口').toContain('temurin')
    expect(bases.target!.image, '源镜像与交付镜像不许是同一个').not.toBe(bases.nodeStage!.image)
  })

  it('现读就是现读：换一份 Dockerfile 就读到另一对底座（把名字写死在这儿当场翻红）', () => {
    const other = parseBaseImages('FROM node:24 AS node\nFROM eclipse-temurin:21-jre\nCOPY x y\n')
    expect([other.nodeStage?.image, other.target?.image], '这两格必须是**从字节里读出来的**，不是核对器里抄的那两个数')
      .toEqual(['node:24', 'eclipse-temurin:21-jre'])
  })

  it('名字轴赢过镜像名前缀：`FROM … AS node` 里的镜像哪怕不叫 node，源镜像也认那一个', () => {
    const b = parseBaseImages('FROM registry.example.com/runtime:1 AS node\nFROM eclipse-temurin:25-jre\n')
    expect(b.nodeStage?.image, '名字轴（AS node）是主判据 ⇒ 认的那个阶段就是它').toBe('registry.example.com/runtime:1')
    expect(b.target?.image, '剩下的那一条才是交付镜像').toBe('eclipse-temurin:25-jre')
    // 上面那份夹具里两个判据**不打架**（没有任何镜像名以 node 开头）⇒ 光靠它，
    // 把优先级调反也照样绿。真打架的夹具在下面：别名那一格不以 node 开头，**另一格**以 node 开头。
    const duel = parseBaseImages('FROM registry.example.com/node:22 AS node\nFROM nodejs.org/dist:9\n')
    expect([duel.nodeStage?.image, duel.target?.image],
      '两个判据打架时认**名字轴**：镜像名前缀只是个兜底，它赢过别名就是把主人换了')
      .toEqual(['registry.example.com/node:22', 'nodejs.org/dist:9'])
  })

  it('glibc 需求表：去重 ＋ **数值**排序 ⇒ 最后一格真的是最高的那个（字典序会把 2.28 排在 2.9 后面）', () => {
    const need = parseGlibcNeeded('GLIBC_2.2.5\0GLIBC_2.28\0GLIBC_2.9\0GLIBC_2.28\0GLIBC_2.3\0')
    expect(need, '重复的那一格必须收起来（Set 不是数组——上一版就是把它当数组用）').toEqual(['2.2', '2.3', '2.9', '2.28'])
    expect(need[need.length - 1], '「最高需要哪一格」取的是**最后一格** ⇒ 排序错了这一格就错').toBe('2.28')
    expect(parseGlibcNeeded(''), '字节里一个 GLIBC_x.y 都没有 ⇒ 空表，不是 null、也不许抛').toEqual([])
    expect(parseGlibcNeeded('GLIBC_2_28'), '下划线分隔的写法（符号版本表的真形）不该被当成 2.28 读进来').toEqual([])
  })

  it('libc 自己提供哪一格：两种拼法都认，都不认就是 null（不许落回默认值把「没读到」说成读到了）', () => {
    expect(parseGlibcProvided('… stable release version 2.43. …'), 'glibc 在二进制里那句自我播报').toBe('2.43')
    expect(parseGlibcProvided('GNU C Library (Ubuntu GLIBC 2.39-0ubuntu1) stable'), '括号里那一种拼法也要认').toBe('2.39')
    expect(parseGlibcProvided('这里什么都没写'), '两种都不认 ⇒ null（这一格没有读数，不是 0）').toBeNull()
  })

  it('两台解析器吃的是**同一份字节**：需求表的最高那一格与提供的那一格比得起来（否则方向判据是空的）', () => {
    const need = parseGlibcNeeded('GLIBC_2.28 GLIBC_2.17')
    const top = need[need.length - 1]
    const provided = parseGlibcProvided('stable release version 2.43')
    expect([top, provided], '判据吃的是这两个数；读空了就等于「方向」那一格没有读数').toEqual(['2.28', '2.43'])
  })

  it('运行那半跑哪一个镜像也是**从 compose 现读**的（写死一个 tag 就是第二个主人；五格都在，逐格可查）', () => {
    const tags = composeImageTags(read(join(SPRING, 'docker-compose.yml')))
    expect(tags.length, `compose 里的 image: 那几格读出来 ${JSON.stringify(tags)}，应与五个服务一一对上`).toBe(SERVICE_NAMES.length)
    for (const name of SERVICE_NAMES) {
      expect(tags.some((t: string) => t.startsWith(`caesura/${name.replace('caesura-', '')}:`)),
        `compose 里没有 ${name} 那一格的镜像名 ⇒ 运行那半不知道该跑谁`).toBe(true)
    }
    // 缩进在别处的 `image:` 不算（build 那一层下面没有 image，服务层才有）
    expect(composeImageTags('services:\n  x:\n    build:\n      context: .\n'), '没有 image: 那一格 ⇒ 空表，不猜').toEqual([])
  })

  it('围栏是真的：`node -e` 只 import 那个模块 ⇒ 一个 docker 都不起、不打印判决、退出码 0', () => {
    const spec = './services/spring/container-image-check.mjs'
    const r = spawnSync(
      process.execPath,
      ['-e', `import(${JSON.stringify(spec)}).then((m) => process.stdout.write(Object.keys(m).sort().join(',')))`],
      { cwd: root, encoding: 'utf8', timeout: 60000, windowsHide: true },
    )
    expect(r.status, `import 那一刻就跑起了量测（stdout 前 200 字：${String(r.stdout).slice(0, 200)}）⇒ 顶层围栏没了`)
      .toBe(0)
    expect(r.stdout.trim(), '被 import 时不许打印判决（那是当命令跑才做的事）')
      .toBe('composeImageTags,parseBaseImages,parseGlibcNeeded,parseGlibcProvided,runContainerImageCheck')
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

  it('Java 里抄了编排参数那个数 ⇒ 报出来（唯一出处被偷走）', () => {
    const owner = ORCHESTRATION_OWNERS[0]!
    const ymlTexts = { [owner.owner]: read(join(root, owner.owner)) }
    const value = /failure-threshold:\s*(\d+)/.exec(ymlTexts[owner.owner]!)![1]!
    const findings = orchestrationOwnerFindings({
      owners: [owner],
      ymlTexts,
      javaFiles: [{ rel: 'X.java', text: `int limit = ${value};` }],
    })
    expect(findings.some((f) => f.key.startsWith('编排参数写死在 Java'))).toBe(true)
  })

  it('主人那份 YAML 少一格 ⇒ 报出来（这个编排参数没有主人）', () => {
    const owner = ORCHESTRATION_OWNERS[0]!
    const findings = orchestrationOwnerFindings({
      owners: [owner],
      ymlTexts: { [owner.owner]: 'caesura:\n  circuit:\n    failure-threshold: 3\n' },
      javaFiles: [],
    })
    expect(findings.some((f) => f.msg.includes('cooldown-sec'))).toBe(true)
  })

  it('编排参数混进名册 ⇒ 报出来（名册只装判定）', () => {
    const findings = rosterScopeFindings(['caesura:', '  concurrency: 3', '  gates:', '    - id: x'].join('\n'))
    expect(findings.length, '名册里塞了编排参数却一条都不报').toBeGreaterThan(0)
    expect(findings[0]!.msg).toContain('concurrency')
  })

  it('熔断没接上（执行器不问了）⇒ 报出来', () => {
    const findings = breakerWiredFindings({
      javaFiles: [
        { rel: 'a/CircuitBreaker.java', text: 'enum State { CLOSED, OPEN, HALF_OPEN }' },
        { rel: 'a/GateRunner.java', text: 'public GateVerdict run(Gate gate) { return null; }' },
      ],
    })
    expect(findings.length, '熔断器在那儿，执行器却不问它，却一条都不报').toBeGreaterThan(0)
    expect(findings.some((f) => f.msg.includes('beforeRun') || f.msg.includes('起进程之前'))).toBe(true)
  })

  it('进程形状那一档被删了 ⇒ 报出来（Windows 上 npm 会一出生就死）', () => {
    const findings = spawnShapeFindings({
      javaFiles: [{ rel: 'a/GateRunner.java', text: 'new ProcessBuilder(command)' }],
    })
    expect(findings.length, '形状那一档没了却一条都不报').toBeGreaterThan(0)
  })

  it('镜像里没有 node ⇒ 报出来（容器里每一道门都会起不来）', () => {
    const findings = containerShapeFindings({
      dockerfile: 'FROM eclipse-temurin:25-jre\nCOPY app.jar /app.jar\n',
      composeText: fixtureCompose(),
      serviceNames: SERVICE_NAMES,
    })
    expect(findings.some((f) => f.key === '容器镜像' && f.msg.includes('node'))).toBe(true)
  })

  it('**注释里**写了 apt install nodejs 不算有 node（注释不是机制——这条是被反向实测逼出来的）', () => {
    const findings = containerShapeFindings({
      // 只有一句注释提到了 node，真机制一行都没有
      dockerfile: [
        '# 另一个做法：在 JRE 镜像里 apt install nodejs npm',
        'FROM eclipse-temurin:25-jre',
        'COPY app.jar /app.jar',
      ].join('\n'),
      composeText: fixtureCompose(),
      serviceNames: SERVICE_NAMES,
    })
    expect(findings.some((f) => f.key === '容器镜像' && f.msg.includes('node'))).toBe(true)
  })

  it('注释里那句 apt install nodejs + 真机制都在 ⇒ 不报（别把正常的也误伤）', () => {
    const findings = containerShapeFindings({
      dockerfile: [
        '# 另一个做法：在 JRE 镜像里 apt install nodejs npm',
        'FROM node:22 AS node',
        'FROM eclipse-temurin:25-jre',
        'COPY --from=node /usr/local/bin/node /usr/local/bin/node',
      ].join('\n'),
      composeText: fixtureCompose(),
      serviceNames: SERVICE_NAMES,
    })
    expect(findings).toEqual([])
  })

  it('compose 里有一格没有 build ⇒ 报出来（那格跑的是别人给的镜像）', () => {
    const compose = fixtureCompose().replace(/ {4}build:\n {6}context: \.\n {6}dockerfile: Dockerfile\n {4}image: caesura\/gate:0\.1\.0/, '    image: caesura/gate:0.1.0')
    const findings = containerShapeFindings({ dockerfile: FIXTURE_DOCKERFILE, composeText: compose, serviceNames: SERVICE_NAMES })
    expect(findings.some((f) => f.msg.includes('没有 build'))).toBe(true)
  })

  it('客户端找注册中心写了 127.0.0.1 ⇒ 报出来（容器里那指的是它自己）', () => {
    const compose = fixtureCompose().replace('http://caesura-registry:8761/eureka/', 'http://127.0.0.1:8761/eureka/')
    const findings = containerShapeFindings({ dockerfile: FIXTURE_DOCKERFILE, composeText: compose, serviceNames: SERVICE_NAMES })
    expect(findings.some((f) => f.key === '容器里的地址' && f.msg.includes('服务名'))).toBe(true)
  })

  it('注册进 Eureka 的主机名不是自己的服务名 ⇒ 报出来（别的容器会回连到它自己身上）', () => {
    const compose = fixtureCompose().replace('--eureka.instance.hostname=caesura-gate', '--eureka.instance.hostname=127.0.0.1')
    const findings = containerShapeFindings({ dockerfile: FIXTURE_DOCKERFILE, composeText: compose, serviceNames: SERVICE_NAMES })
    expect(findings.some((f) => f.msg.includes('主机名'))).toBe(true)
  })

  it('四个都合规 ⇒ 一条都不报（判据不许对正确的形态也乱叫）', () => {
    const findings = containerShapeFindings({
      dockerfile: FIXTURE_DOCKERFILE,
      composeText: fixtureCompose(),
      serviceNames: SERVICE_NAMES,
    })
    expect(findings).toEqual([])
  })
})

/**
 * KI-441｜**进程账本核对器**这台机器第一次有腿。
 *
 * 本批把「开闸那一趟起了几个进程」的证人从**父亲的表**换成**孩子自己的账本**。
 * 换证人之后多出来一台机器（`services/spring/spawn-ledger-check.mjs`）：窗口 → 归属 → 对账 → 状态机对账。
 * KI-430 那一族的教训在这儿同样成立——**没被跑过的读数不是读数**：那台核对器上辈子第一次被跑起来
 * 之前就崩在解析器里（`hits.push is not a function`），而判据读的是形状，看不见「一跑就崩」。
 * ⇒ 这一组全部是**行为腿**：喂进读数、看它报什么；每种红都配一条「同样的形状不带那个谎就不报」。
 *
 * 分工照旧：判据住在 `.mjs`，本文件只喂字节与读数；假服务**不是 Java 的第二份实现**
 *（每一趟的判决与跑完之后的账都是我逐格写死的数据，假服务只做「按脚本回一格 + 那一趟落一笔账」）。
 */

// ---------- KI-441 各腿共用的合成读数 ----------
const T0 = Date.UTC(2026, 10, 10, 12, 0, 0)
/** 相对时刻 → `ranAt` 那一格的拼法（服务发的是 ISO 串） */
const at = (ms: number): string => new Date(T0 + ms).toISOString()
/** 相对时刻 → 账本 `atMs` 那一个数 */
const abs = (ms: number): number => T0 + ms

type Snap = {
  id: string
  state: string
  consecutiveFailures: number
  trialInFlight: boolean
  openedAtMs: number
  cooldownMs: number
  remainingMs: number
}
/** `GET /circuit/{id}` 的那一格账（`cooldownMs: 1000` 只是形状，本批的判据不读它） */
const snap = (state: string, failures: number, extra: Partial<Snap> = {}): Snap => ({
  id: '',
  state,
  consecutiveFailures: failures,
  trialInFlight: false,
  openedAtMs: 0,
  cooldownMs: 1000,
  remainingMs: 0,
  ...extra,
})

type Round = {
  id: string
  verdict: string
  exitCode: number
  durationMs: number
  ranAt: string
  circuitState: string
  group?: string | null
  after?: Snap
}
/** 一趟跑测记录（`circuitState` 默认 CLOSED：问的时候闸是开着的） */
const rd = (id: string, verdict: string, durationMs: number, t: number, extra: Partial<Round> = {}): Round => ({
  id,
  verdict,
  exitCode: verdict === 'green' ? 0 : verdict === 'circuit_open' ? -1 : 1,
  durationMs,
  ranAt: at(t),
  circuitState: 'CLOSED',
  ...extra,
})
/** 孩子账本里的一笔（只需要 `atMs` + `pid` 两格就能归属） */
const mk = (t: number, pid: number) => ({ atMs: abs(t), pid })
const windowsOf = (rounds: Round[], marking: string[] = ['g1']) => roundWindows(rounds, { marking })
/** 一条红的 `key` 有没有出现（本族的红按**被指控的那句话**归因，不按条数；带后缀的那几格按前缀认） */
const hasKey = (findings: { key: string; msg: string }[], key: string, needle?: string) =>
  findings.some((f) => f.key.startsWith(key) && (needle === undefined || f.msg.includes(needle)))

describe('KI-441｜账本核对器（上）：账本文本 → 窗口 → 归属', () => {
  it('读得懂的行出得来，行号能指回账本里的那一行', () => {
    const text = [
      JSON.stringify({ atMs: abs(10), pid: 101, ppid: 7, argv: ['--exit', '1'] }),
      '',
      JSON.stringify({ atMs: abs(20), pid: 102, ppid: null, argv: null }),
    ].join('\n')
    const parsed = parseLedger(text)
    expect(parsed.bad.map((b) => b.text)).toEqual([])
    expect(parsed.rows.map((r) => [r.lineNo, r.pid, r.ppid])).toEqual([
      [1, 101, 7],
      [3, 102, null],
    ])
    expect(parsed.rows[0].argv).toEqual(['--exit', '1'])
  })

  it('读不懂的行**报名**，不静默跳过：三种拼法各报一条，且都不进 rows', () => {
    const cases: [string, string][] = [
      ['这一句不是 JSON', '不是 JSON'],
      ['{"pid":101}', '没有可用的 atMs'],
      ['{"atMs":1,"pid":"101"}', 'pid 不是整数'],
    ]
    for (const [line, why] of cases) {
      const parsed = parseLedger(`${line}\n`)
      expect(parsed.rows, `读不懂的那一行不该变成一笔账：${why}`).toEqual([])
      expect(parsed.bad.length, `「${line}」没有报名`).toBe(1)
      expect(parsed.bad[0].why).toContain(why)
      expect(parsed.bad[0].lineNo).toBe(1)
    }
  })

  it('空行不是坏账（否则整本账会被自己最后一行的换行符判红）', () => {
    expect(parseLedger('\n   \n').bad).toEqual([])
    expect(parseLedger('').rows).toEqual([])
  })

  it('唯一「没有起跑」的判决是 circuit_open；error／timeout 都算起了进程', () => {
    const ws = windowsOf([
      rd('g1', 'circuit_open', 0, 0),
      rd('g1', 'error', 812, 1000),
      rd('g1', 'timeout', 1004, 2000),
      rd('g1', 'green', 90, 3000),
    ])
    expect(ws.map((w) => w.allowed)).toEqual([false, true, true, true])
    // 记账门被放行 ⇒ 应该有一笔；被拒 ⇒ 应该 0 笔（这一格就是「开闸 0 个孩子」那句话的算术）
    expect(ws.map((w) => w.expectedMarks)).toEqual([0, 1, 1, 1])
  })

  it('不记账的门 expectedMarks=0：账本对它**是盲的**，核对器不许拿「没账」当「没起进程」', () => {
    const ws = windowsOf([rd('probe-red', 'red', 120, 0)], ['g1'])
    expect(ws[0].marking).toBe(false)
    expect(ws[0].expectedMarks).toBe(0)
  })

  it('ranAt／durationMs／verdict 缺格 ⇒ 窗口推不出来，原因逐格点名', () => {
    const ws = windowsOf([{ id: 'g1', verdict: '', exitCode: 1, durationMs: Number.NaN, ranAt: '昨天' } as unknown as Round])
    expect(ws[0].fromMs).toBeNull()
    expect(ws[0].unreadable.join('|')).toContain('昨天')
    expect(ws[0].unreadable.join('|')).toContain('durationMs')
    expect(ws[0].unreadable.join('|')).toContain('verdict')
  })

  it('被拒那一趟的窗口补到「下一趟起跑之前」：右界不含下一趟的起跑时刻', () => {
    const ws = windowsOf([rd('g1', 'circuit_open', 0, 1000), rd('g1', 'red', 200, 2000)])
    expect(ws[0].toMs).toBe(abs(1999))
    // 同一毫秒的那一笔只属于前一趟（`<=` 归属会把一笔算进两家 ⇒ 报成归因错位）
    const one = attributeMarks([mk(1999, 11)], ws)
    expect(one.perRound[0].length).toBe(1)
    expect(one.perRound[1].length).toBe(0)
  })

  it('并发那一组的窗口**不补**，最后一趟没有下一趟可参照也不补', () => {
    const ws = windowsOf([
      rd('g1', 'circuit_open', 0, 1000, { group: 'pair' }),
      rd('g1', 'red', 200, 5000),
      rd('g1', 'circuit_open', 0, 9000),
    ])
    expect(ws[0].toMs).toBe(abs(1000))
    expect(ws[2].toMs).toBe(abs(9000))
  })

  it('一笔账落进 1 个窗口归那一趟，落进 ≥2 个是 ambiguous，一个都不落是 outside（不许丢）', () => {
    const ws = windowsOf([rd('g1', 'red', 1000, 0), rd('g2', 'red', 1000, 500)], ['g1', 'g2'])
    const one = attributeMarks([mk(100, 1)], ws)
    expect(one.perRound[0].length).toBe(1)
    expect(one.ambiguous).toEqual([])
    expect(one.outside).toEqual([])
    const both = attributeMarks([mk(600, 2)], ws)
    expect(both.perRound.every((p) => p.length === 0)).toBe(true)
    expect(both.ambiguous.map((m) => m.in)).toEqual([[0, 1]])
    const none = attributeMarks([mk(99999, 3)], ws)
    expect(none.outside.map((m) => m.pid)).toEqual([3])
  })
})

describe('KI-441｜账本核对器（下）：判决说什么 ⇄ 孩子记了什么', () => {
  /** 一份自洽的最小读数：一道记账门坏 → 被拒 → 并发一组里放一道试探 */
  const coherent = () => {
    const rounds = [
      rd('g1', 'red', 200, 1000),
      rd('g1', 'circuit_open', 0, 1300),
      rd('g2', 'timeout', 500, 2000, { group: 'p' }),
      rd('g2', 'circuit_open', 0, 2000, { group: 'p' }),
    ]
    const ws = windowsOf(rounds, ['g1', 'g2'])
    const attributed = attributeMarks([mk(1100, 11), mk(2100, 12)], ws)
    return { windows: ws, attributed, markCount: 2 }
  }

  it('读数自洽 ⇒ 一条都不报（判据不许对正确的形状乱叫）', () => {
    const c = coherent()
    expect(ledgerFindings({ ...c })).toEqual([])
  })

  it('空读数不是干净：0 趟也要红', () => {
    const findings = ledgerFindings({ windows: [], attributed: attributeMarks([], []), markCount: 0 })
    expect(hasKey(findings, '读数读不懂')).toBe(true)
  })

  it('窗口推不出来的那一趟要报名：没有窗口就没有归属，「没这一笔」就没有证人', () => {
    const ws = windowsOf([{ id: 'g1', verdict: 'red', exitCode: 1, durationMs: 10, ranAt: '不是时刻' } as unknown as Round])
    const findings = ledgerFindings({ windows: ws, attributed: attributeMarks([], ws), markCount: 0 })
    expect(hasKey(findings, '读数读不懂', '不是时刻')).toBe(true)
  })

  it('账本里读不懂的那一行也进红：它不能被算进任何一趟的个数', () => {
    const c = coherent()
    c.markCount = 0
    const findings = ledgerFindings({ ...c, badLines: [{ lineNo: 7, why: '这一行不是 JSON', text: 'x' }] })
    expect(hasKey(findings, '账本读不懂', '第 7 行')).toBe(true)
  })

  it('埋「闸没关上」：判决 circuit_open 的那一趟留下了孩子的账 ⇒ 那句话当场是谎', () => {
    const rounds = [rd('g1', 'red', 200, 1000), rd('g1', 'circuit_open', 0, 1300), rd('g1', 'red', 200, 5000)]
    const ws = windowsOf(rounds)
    const attributed = attributeMarks([mk(1100, 11), mk(1305, 12)], ws)
    const findings = ledgerFindings({ windows: ws, attributed, markCount: 2 })
    expect(hasKey(findings, '闸没关上', '第 2 趟')).toBe(true)
  })

  it('埋「判说跑了而孩子没记账」与「一趟起了两个孩子」', () => {
    const none = windowsOf([rd('g1', 'red', 200, 1000)])
    expect(hasKey(ledgerFindings({ windows: none, attributed: attributeMarks([], none), markCount: 0 }), '判说跑了而孩子没记账')).toBe(true)
    const two = windowsOf([rd('g1', 'red', 200, 1000)])
    const attributed = attributeMarks([mk(1050, 11), mk(1080, 12)], two)
    expect(hasKey(ledgerFindings({ windows: two, attributed, markCount: 2 }), '一趟起了两个孩子')).toBe(true)
  })

  it('埋「不记账的门记了一笔」：跑着的名册与现在这份名册不是同一份', () => {
    const ws = windowsOf([rd('probe-red', 'red', 200, 1000)], ['g1'])
    const attributed = attributeMarks([mk(1050, 11)], ws)
    expect(hasKey(ledgerFindings({ windows: ws, attributed, markCount: 1 }), '不记账的门记了一笔', 'probe-red')).toBe(true)
  })

  it('并发那一组：放两道出去 ⇒ 报「半开放了两道试探」＋「试探的孩子数不对」；恰好一道 ⇒ 都不报', () => {
    const both = windowsOf(
      [rd('g1', 'timeout', 500, 0, { group: 'p' }), rd('g1', 'timeout', 500, 10, { group: 'p' })],
      ['g1'],
    )
    const findings = ledgerFindings({ windows: both, attributed: attributeMarks([], both), markCount: 0 })
    expect(hasKey(findings, '半开放了两道试探', '组「p」')).toBe(true)
    expect(hasKey(findings, '试探的孩子数不对', '0 个孩子')).toBe(true)

    const one = windowsOf(
      [rd('g1', 'timeout', 500, 0, { group: 'p' }), rd('g1', 'circuit_open', 0, 10, { group: 'p' })],
      ['g1'],
    )
    const attribOne = attributeMarks([mk(100, 11)], one)
    const clean = ledgerFindings({ windows: one, attributed: attribOne, markCount: 1 })
    expect(hasKey(clean, '半开放了两道试探')).toBe(false)
    expect(hasKey(clean, '试探的孩子数不对')).toBe(false)
  })

  it('一笔账同时落进两趟而这两趟没标同一组 ⇒ 报「走查说自己是 sequential 而窗口重叠了」', () => {
    const ws = windowsOf([rd('g1', 'red', 1000, 0), rd('g2', 'red', 1000, 500)], ['g1', 'g2'])
    const attributed = attributeMarks([mk(600, 11)], ws)
    expect(attributed.ambiguous.length).toBe(1)
    expect(hasKey(ledgerFindings({ windows: ws, attributed, markCount: 1 }), '走查说自己是 sequential 而窗口重叠了')).toBe(true)
  })

  it('同一个 pid 两笔 ⇒ 「一笔＝一个进程」那把尺没了', () => {
    const ws = windowsOf([rd('g1', 'red', 200, 1000), rd('g1', 'red', 200, 5000)])
    const attributed = attributeMarks([mk(1050, 11), mk(5050, 11)], ws)
    expect(hasKey(ledgerFindings({ windows: ws, attributed, markCount: 2 }), '一个进程记了两笔', '11×2')).toBe(true)
  })

  it('总数那一条不看时钟：账丢了也报（expected 2 / got 1）', () => {
    const c = coherent()
    const findings = ledgerFindings({ ...c, attributed: attributeMarks([mk(1100, 11)], c.windows), markCount: 1 })
    expect(hasKey(findings, '总数对不上', '一共 1 笔')).toBe(true)
    expect(hasKey(findings, '试探的孩子数不对', '组「p」')).toBe(true)
  })

  it('对照表只摆关系不判红：表多报／少报／账本发盲三种各有名字', () => {
    const ws = windowsOf(
      [
        rd('g1', 'red', 200, 0),
        rd('g1', 'red', 200, 1000),
        rd('g1', 'circuit_open', 0, 2000, { after: snap('OPEN', 3) }),
        rd('g2', 'error', 812, 5000),
      ],
      ['g1'],
    )
    // 第 1 趟起了孩子；第 2 趟判说跑了而账本里没有 ⇒ 表多报；第 3 趟 0 毫秒而起了孩子 ⇒ 表少报；第 4 趟账本是盲的
    const attributed = attributeMarks([mk(50, 11), mk(2005, 12)], ws)
    const table = stopwatchTable(ws, attributed)
    expect(table.rows.map((r) => r.inference)).toEqual(['agree', 'watch-overclaims', 'watch-underclaims', 'blind'])
    expect(table.summary).toMatchObject({ rounds: 4, markingRounds: 3, blindRounds: 1, agree: 1, watchOverclaims: 1, watchUnderclaims: 1, zeroDurationRounds: 1 })
    expect(table.rows[3]).toMatchObject({ durationMs: 812, marks: 0, ledgerSays: 'blind' })
  })

  it('「0 毫秒」从来不是「没起进程」的测量：同一张表上 0 毫秒可能是起了孩子', () => {
    const ws = windowsOf([rd('g1', 'circuit_open', 0, 0, { after: snap('OPEN', 3) })], ['g1'])
    const table = stopwatchTable(ws, attributeMarks([mk(0, 11)], ws))
    expect(table.rows[0].watchSays).toBe('no-time')
    expect(table.rows[0].inference).toBe('watch-underclaims')
  })
})

describe('KI-441｜状态机那半的对账：半开第一次被**读**，不是被推断', () => {
  /** 一份自洽的半开读数：坏 → 坏 → 坏（第 3 道账里第一次 OPEN）→ 等过钟放出一道红的试探（重新开闸，时刻往前走） */
  const halfRounds = () =>
    windowsOf(
      [
        rd('g1', 'red', 200, 0, { after: snap('CLOSED', 1) }),
        rd('g1', 'red', 200, 1000, { after: snap('CLOSED', 2) }),
        rd('g1', 'red', 200, 2000, { after: snap('OPEN', 3, { openedAtMs: abs(2000) }) }),
        rd('g1', 'red', 200, 5000, { circuitState: 'HALF_OPEN', after: snap('OPEN', 4, { openedAtMs: abs(5000) }) }),
      ],
      ['g1'],
    )

  it('读数自洽 ⇒ 一条都不报，且「等过钟」与「不等钟」两种走查都认', () => {
    expect(halfOpenFindings(halfRounds(), { threshold: 3, trialExpected: true })).toEqual([])
    expect(halfOpenFindings(halfRounds(), { threshold: 3, trialExpected: false })).toEqual([])
  })

  it('没有跑完之后的账 ⇒ 状态机这半没有证人（不拿空集合当干净）', () => {
    const ws = windowsOf([rd('g1', 'red', 200, 0)])
    const findings = halfOpenFindings(ws, { threshold: 3 })
    expect(hasKey(findings, '读数读不懂', '/circuit')).toBe(true)
  })

  it('埋「判决与账不符」两种形状：被拒而账是 CLOSED／放着行而账是 OPEN', () => {
    const refused = windowsOf([rd('g1', 'red', 200, 0, { after: snap('CLOSED', 1) }), rd('g1', 'circuit_open', 0, 1000, { circuitState: 'OPEN', after: snap('CLOSED', 3) })])
    expect(hasKey(halfOpenFindings(refused), '判决与账不符', '账是 CLOSED')).toBe(true)
    const allowed = windowsOf([rd('g1', 'red', 200, 0, { circuitState: 'OPEN', after: snap('OPEN', 3) })])
    expect(hasKey(halfOpenFindings(allowed), '判决与账不符', '放着行')).toBe(true)
  })

  it('埋「半开放不出试探」：HALF_OPEN、没放行、账上也没有试探在跑', () => {
    const ws = windowsOf([rd('g1', 'circuit_open', 0, 0, { circuitState: 'HALF_OPEN', after: snap('HALF_OPEN', 4, { trialInFlight: false }) })])
    expect(hasKey(halfOpenFindings(ws), '半开放不出试探')).toBe(true)
  })

  it('并发那一组的第二道被拒**不是**红：账上写着 trialInFlight=true，正是「只放一道试探」的直接证人', () => {
    const ws = windowsOf(
      [
        rd('g1', 'red', 200, 0, { after: snap('OPEN', 3, { openedAtMs: abs(2000) }) }),
        rd('g1', 'timeout', 1004, 10, { circuitState: 'HALF_OPEN', group: 'pair', after: snap('OPEN', 4, { openedAtMs: abs(4000) }) }),
        rd('g1', 'circuit_open', 0, 10, { circuitState: 'HALF_OPEN', group: 'pair', after: snap('HALF_OPEN', 4, { openedAtMs: abs(4000), trialInFlight: true }) }),
      ],
      ['g1'],
    )
    const findings = halfOpenFindings(ws, { trialExpected: true })
    expect(hasKey(findings, '判决与账不符')).toBe(false)
    expect(hasKey(findings, '半开放不出试探')).toBe(false)
    // 被拒那一趟没起跑 ⇒ 不能当试探来判红绿（上一版在这里报了假红）
    expect(hasKey(findings, '试探败了没重新开闸')).toBe(false)
    expect(ws[1].group).toBe('pair')
  })

  it('「半开没走到」只在该等的走查里判：不等钟那一趟不许被要求读出 HALF_OPEN', () => {
    const ws = windowsOf([rd('g1', 'red', 200, 0, { after: snap('OPEN', 3, { openedAtMs: abs(2000) }) }), rd('g1', 'circuit_open', 0, 1000, { circuitState: 'OPEN', after: snap('OPEN', 3, { openedAtMs: abs(2000), remainingMs: 900 }) })])
    expect(hasKey(halfOpenFindings(ws, { trialExpected: true }), '半开没走到')).toBe(true)
    expect(hasKey(halfOpenFindings(ws, { trialExpected: false }), '半开没走到')).toBe(false)
  })

  it('埋「试探绿了没闭合」与「试探败了没重新开闸」', () => {
    const greenStuck = windowsOf([rd('g1', 'green', 50, 0, { circuitState: 'HALF_OPEN', after: snap('HALF_OPEN', 3) })])
    expect(hasKey(halfOpenFindings(greenStuck), '试探绿了没闭合', '第 1 趟')).toBe(true)
    const redStuck = windowsOf([rd('g1', 'red', 50, 0, { circuitState: 'HALF_OPEN', after: snap('CLOSED', 4) })])
    expect(hasKey(halfOpenFindings(redStuck), '试探败了没重新开闸', '要 OPEN')).toBe(true)
  })

  it('埋「开闸时刻倒退」与「冷却没在走」（各配一条反方向不报）', () => {
    const back = windowsOf([
      rd('g1', 'red', 200, 0, { after: snap('OPEN', 3, { openedAtMs: abs(5000) }) }),
      rd('g1', 'red', 200, 1000, { after: snap('OPEN', 4, { openedAtMs: abs(1000) }) }),
    ])
    expect(hasKey(halfOpenFindings(back), '开闸时刻倒退')).toBe(true)
    expect(hasKey(halfOpenFindings(halfRounds()), '开闸时刻倒退')).toBe(false)

    const stuck = windowsOf([
      rd('g1', 'circuit_open', 0, 0, { circuitState: 'OPEN', after: snap('OPEN', 3, { openedAtMs: abs(1000), remainingMs: 900 }) }),
      rd('g1', 'circuit_open', 0, 1000, { circuitState: 'OPEN', after: snap('OPEN', 3, { openedAtMs: abs(1000), remainingMs: 900 }) }),
    ])
    expect(hasKey(halfOpenFindings(stuck), '冷却没在走')).toBe(true)
    const moving = windowsOf([
      rd('g1', 'circuit_open', 0, 0, { circuitState: 'OPEN', after: snap('OPEN', 3, { openedAtMs: abs(1000), remainingMs: 900 }) }),
      rd('g1', 'circuit_open', 0, 1000, { circuitState: 'OPEN', after: snap('OPEN', 3, { openedAtMs: abs(1000), remainingMs: 800 }) }),
    ])
    expect(hasKey(halfOpenFindings(moving), '冷却没在走')).toBe(false)
  })

  it('埋「闸没开」：坏够了、没被拒过、也没读到半开；一直绿的门与没坏够的门都不许被要求拒人', () => {
    const never = windowsOf(
      [rd('g1', 'red', 200, 0, { after: snap('CLOSED', 3) }), rd('g1', 'red', 200, 1000, { after: snap('CLOSED', 3) }), rd('g1', 'red', 200, 2000, { after: snap('CLOSED', 3) })],
      ['g1'],
    )
    expect(hasKey(halfOpenFindings(never, { threshold: 3 }), '闸没开', '没被拒过')).toBe(true)
    expect(hasKey(halfOpenFindings(never, { threshold: null }), '闸没开')).toBe(false)
    const green = windowsOf([rd('g1', 'green', 200, 0, { after: snap('CLOSED', 0) })], ['g1'])
    expect(hasKey(halfOpenFindings(green, { threshold: 3 }), '闸没开')).toBe(false)
    const onlyOne = windowsOf([rd('g1', 'red', 200, 0, { after: snap('CLOSED', 1) })], ['g1'])
    expect(hasKey(halfOpenFindings(onlyOne, { threshold: 3 }), '闸没开')).toBe(false)
  })

  it('「连着坏几道开闸」数的是账里第一次 OPEN，不是第一道被拒：半开那道试探不许算进开闸之前', () => {
    expect(hasKey(halfOpenFindings(halfRounds(), { threshold: 3 }), '开闸的时机不对')).toBe(false)
    const late = windowsOf(
      [
        rd('g1', 'red', 200, 0, { after: snap('CLOSED', 1) }),
        rd('g1', 'red', 200, 1000, { after: snap('CLOSED', 2) }),
        rd('g1', 'red', 200, 2000, { after: snap('CLOSED', 3) }),
        rd('g1', 'red', 200, 3000, { after: snap('OPEN', 4, { openedAtMs: abs(3000) }) }),
        rd('g1', 'circuit_open', 0, 4000, { circuitState: 'OPEN', after: snap('OPEN', 4, { openedAtMs: abs(3000), remainingMs: 900 }) }),
      ],
      ['g1'],
    )
    expect(hasKey(halfOpenFindings(late, { threshold: 3 }), '开闸的时机不对', '第 4 趟')).toBe(true)
  })
})

/**
 * KI-441｜**夹具**（`caesura-gates-probe.yml`）第一次有机器读者。
 *
 * 真名册有判据①②③④盯着；夹具那份以前没有——它是实测时才供出去的，而实测一趟要几分钟，
 * 没人会在改坏它之后还跑一遍。KI-429 那三道「一出生就死」的门就是这么过去的：
 * 名册写的是仓里没有的脚本，而当时没有任何一台机器把这两件事放在一起看过。
 *
 * 角色**不抄门 id**：判据与核对器都按命令行上的旗标认（`--exit 1` / `--fail-first` / `--sleep-ms`），
 * 而「两边是不是同一套拼法」由下面那组对账腿钉住——判据认不出来的那一格，核对器也不许认出来。
 */
const PROBE_REL = join(SPRING, 'config', 'caesura-gates-probe.yml')
const probeRosterText = read(PROBE_REL)
const gateAppYml = read(join(SPRING, 'caesura-gate', 'src', 'main', 'resources', 'application.yml'))
const gateRowsOf = (text: string) =>
  (parseGateRoster(text).gates ?? []).map((g) => ({
    id: String(g.id),
    family: String(g.family ?? ''),
    command: [String(g.command ?? ''), ...(Array.isArray(g.args) ? g.args.map(String) : [])].join(' '),
    timeoutSec: Number(g['timeout-sec']),
    blocking: g.blocking === true,
  }))
const probeRows = gateRowsOf(probeRosterText)
const probeGates = parseGateRoster(probeRosterText).gates ?? []
const probeRoles = rolesFromRoster(probeRows)
/** 判据⑬吃的那份文件名册：仓里真有的记账脚本要在场（不在场就是要红，见下面那条腿） */
const filesWithMark = existsSync(join(root, MARK_SCRIPT_RELPATH)) ? [...scriptFiles, MARK_SCRIPT_RELPATH] : scriptFiles
const probe13 = (text: string, files: string[] = filesWithMark) =>
  probeRosterFindings({
    rosterText: text,
    scriptFiles: files,
    markingRelpath: MARK_SCRIPT_RELPATH,
    entryCommands: REPO_ENTRY_COMMANDS,
    gateAppYml,
  })

describe('KI-441｜编排参数与角色：主人只有一个，认法两边同一套', () => {
  it('gate 自己那份 YAML 里两个数都只有一格（缺格 null，不回落默认值）', () => {
    const params = parseCircuitYml(gateAppYml)
    expect(params.duplicates).toEqual([])
    expect(params.failureThreshold, 'failure-threshold 读不出 ⇒ 核对器不许自己猜一个').not.toBeNull()
    expect(params.cooldownSec).not.toBeNull()
  })

  it('缺格回 null；同一个键写两遍如实报名（不玩「最后一个赢」）', () => {
    expect(parseCircuitYml('nothing: here\n')).toEqual({ failureThreshold: null, cooldownSec: null, duplicates: [] })
    const twice = parseCircuitYml('failure-threshold: 3\nfailure-threshold: 5\ncooldown-sec: 2\ncooldown-sec: 9\n')
    expect(twice.failureThreshold).toBe(5)
    expect(twice.duplicates.sort()).toEqual(['cooldownSec', 'failureThreshold'])
  })

  it('注释里的那一格不算数（注释掉的阈值不许被当成主人）', () => {
    expect(parseCircuitYml('#  failure-threshold: 9\n')).toEqual({ failureThreshold: null, cooldownSec: null, duplicates: [] })
  })

  it('角色全从跑着的名册现推：四种死法各占一格，且不记账的门里有一格起不来', () => {
    for (const key of ['markRed', 'markGreen', 'flip', 'slow'] as const) {
      expect(probeRoles[key], `夹具里没有 ${key} 那一格 ⇒ 走查的这一段今天没有读数`).not.toBeNull()
    }
    expect(isMarking(probeRoles.markRed?.command)).toBe(true)
    expect(isMarking(probeRoles.plain[0]?.command)).toBe(false)
    expect(probeRoles.unspawnable.length).toBeGreaterThanOrEqual(1)
    expect(probeRoles.unspawnable[0].command).not.toMatch(/^\s*(node|npm)\b/)
    expect(new Set([probeRoles.markRed?.id, probeRoles.markGreen?.id, probeRoles.flip?.id, probeRoles.slow?.id]).size).toBe(4)
  })

  it('markingIds 报的是 id，与 roles.marking 是同一批（一个出处）', () => {
    expect(markingIds(probeRows).sort()).toEqual(probeRoles.marking.map((r) => r.id).sort())
  })

  it('判据⑬对真夹具一条都不报（形状 + 角色齐 + 脚本在 + 两个数一致）', () => {
    expect(probe13(probeRosterText)).toEqual([])
  })

  it('夹具读得到七格（读空了上面那条就是在读空集合）', () => {
    expect(probeGates.length).toBeGreaterThanOrEqual(7)
    expect(filesWithMark.length, 'scripts/*.mjs 读空了 ⇒ 「脚本在不在」这条判据是空的').toBeGreaterThan(0)
  })

  it('埋「夹具指向不存在的脚本」：记账那一格的孩子仓里没有 ⇒ 它一出生就死，而账本上看不出来', () => {
    const findings = probe13(probeRosterText, scriptFiles)
    expect(findings.some((f) => f.key.startsWith('夹具指向不存在的脚本'))).toBe(true)
    expect(findings.some((f) => f.msg.includes('一出生就死'))).toBe(true)
  })

  it('埋缺角色：四种死法各拆一格，判据⑬逐格报名', () => {
    const splice = (text: string, pairs: [string, string][]) => pairs.reduce((t, [from, to]) => t.replace(from, to), text)
    // 退零那一格要**两处一起**拆：`probe-slow` 也写着 `"--exit", "0"`，只改名册第一格那句话还是真的
    const noGreen = splice(probeRosterText, [
      ['"--exit", "0", "--sleep-ms", "8000"]', '"--sleep-ms", "8000"]'],
      ['"--exit", "0"]', '"--exit", "1"]'],
    ])
    const noFlip = splice(probeRosterText, [['"--fail-first", "3"]', '"--exit", "1"]']])
    const noSlow = splice(probeRosterText, [['"--sleep-ms", "8000"]', '"--exit", "1"]']])
    expect(probeRosterText.match(/"--exit", "0"/g)?.length).toBe(2)
    expect(hasKey(probe13(noGreen), '夹具读者', '退零')).toBe(true)
    expect(hasKey(probe13(noFlip), '夹具读者', '转绿')).toBe(true)
    expect(hasKey(probe13(noSlow), '夹具读者', '跑不完')).toBe(true)
  })

  it('埋「没有起不来的门」与「每一格都记账」：那两句话当天就没有读数', () => {
    const spawnable = probeRosterText.replace('command: caesura-no-such-binary', 'command: node')
    expect(hasKey(probe13(spawnable), '夹具读者', '起不来')).toBe(true)
    const allMarking = [
      ['args: ["scripts/no-such-probe-script.mjs"]', 'args: ["services/spring/probe/spawn-mark.mjs", "--exit", "1"]'],
      ['args: ["scripts/phase-status.mjs"]', 'args: ["services/spring/probe/spawn-mark.mjs", "--exit", "0"]'],
      ['command: caesura-no-such-binary', 'command: node'],
      ['args: []', 'args: ["services/spring/probe/spawn-mark.mjs", "--exit", "1"]'],
    ].reduce((t, [from, to]) => t.replace(from, to), probeRosterText)
    expect(hasKey(probe13(allMarking), '夹具读者', '盲区')).toBe(true)
  })

  it('对账腿：判据⑬与核对器**同一套拼法**——拆掉旗标两边同时瞎（不是各自养一份名册）', () => {
    const flipGone = probeRosterText.replace('"--fail-first", "3"]', '"--exit", "1"]')
    expect(rolesFromRoster(gateRowsOf(flipGone)).flip).toBeNull()
    expect(hasKey(probeRosterFindings({ rosterText: flipGone, scriptFiles: filesWithMark, markingRelpath: MARK_SCRIPT_RELPATH, entryCommands: REPO_ENTRY_COMMANDS, gateAppYml }), '夹具读者')).toBe(true)
    const slowGone = probeRosterText.replace('"--sleep-ms", "8000"]', '"--exit", "1"]')
    expect(rolesFromRoster(gateRowsOf(slowGone)).slow).toBeNull()
    expect(hasKey(probeRosterFindings({ rosterText: slowGone, scriptFiles: filesWithMark, markingRelpath: MARK_SCRIPT_RELPATH, entryCommands: REPO_ENTRY_COMMANDS, gateAppYml }), '夹具读者')).toBe(true)
  })

  it('判据⑫：夹具的 --fail-first 与服务读的 failure-threshold 是同一个数（两个出处 = 半开量歪）', () => {
    const threshold = parseCircuitYml(gateAppYml).failureThreshold
    expect(probeNumbersFindings({ gates: probeGates, failureThreshold: threshold })).toEqual([])
    expect(hasKey(probeNumbersFindings({ gates: probeGates, failureThreshold: null }), '夹具数字', '没有证人')).toBe(true)
    const drifted = probeGates.map((g) => (String(g.id) === probeRoles.flip?.id ? { ...g, args: ['x', '--fail-first', '5'] } : g))
    expect(hasKey(probeNumbersFindings({ gates: drifted, failureThreshold: threshold }), '夹具数字', '这两处必须同一个数')).toBe(true)
  })

  it('判据⑫：跑不完那一格的毫秒数必须大于它自己的上限，否则 trialInFlight 从来没被并发读到过', () => {
    const slowId = String(probeRoles.slow?.id)
    const tooShort = probeGates.map((g) => (String(g.id) === slowId ? { ...g, 'timeout-sec': 30 } : g))
    expect(hasKey(probeNumbersFindings({ gates: tooShort, failureThreshold: 3 }), '夹具数字', '会在被杀之前跑完')).toBe(true)
    // 故意把那一格写成字：这一条要的是「读不出正整数」，不是「读成了一个数」
    const noTimeout = probeGates.map((g) => (String(g.id) === slowId ? { ...g, 'timeout-sec': '一' as unknown as number } : g))
    expect(hasKey(probeNumbersFindings({ gates: noTimeout, failureThreshold: 3 }), '夹具数字', '比不了大小')).toBe(true)
  })
})

describe('KI-441｜判据⑭：熔断问在起跑**之前**（⑨ 认的是调用点在不在，读不出顺序）', () => {
  const withRunner = (text: string) => [{ rel: 'services/spring/caesura-gate/src/main/java/caesura/gate/GateRunner.java', text }]
  const OK = [
    'class GateRunner {',
    '  GateVerdict run(Gate g) throws Exception {',
    '    if (!breaker.beforeRun(g.id())) return GateVerdict.of("circuit_open");',
    '    ProcessBuilder builder = new ProcessBuilder();',
    '    Process p = builder.start();',
    '    return read(p);',
    '  }',
    '}',
  ].join('\n')
  const LATE = [
    'class GateRunner {',
    '  GateVerdict run(Gate g) throws Exception {',
    '    ProcessBuilder builder = new ProcessBuilder();',
    '    Process p = builder.start();',
    '    if (!breaker.beforeRun(g.id())) return GateVerdict.of("circuit_open");',
    '    return read(p);',
    '  }',
    '}',
  ].join('\n')

  it('真源码里那一问排在起跑之前（问 → 拒绝的判决 → 才 start）', () => {
    expect(breakerOrderFindings({ javaFiles })).toEqual([])
    expect(javaFiles.some((f) => f.rel.endsWith('GateRunner.java')), '读不到门执行器那份源码 ⇒ 这一条是空的').toBe(true)
  })

  it('合成夹具两侧都有腿：正确的顺序一条不报，挪到起跑之后就报两条', () => {
    expect(breakerOrderFindings({ javaFiles: withRunner(OK) })).toEqual([])
    const findings = breakerOrderFindings({ javaFiles: withRunner(LATE) })
    expect(findings.length).toBe(2)
    expect(findings.every((f) => f.key === '熔断问的时机')).toBe(true)
    expect(findings.some((f) => f.msg.includes('已经起了一个进程'))).toBe(true)
    expect(findings.some((f) => f.msg.includes('跑完再改口'))).toBe(true)
  })

  it('缺参照系也报名：没有 GateRunner.java／没有 builder.start( 时不许当作通过', () => {
    expect(hasKey(breakerOrderFindings({ javaFiles: [] }), '熔断问的时机', '找不到门执行器')).toBe(true)
    const noStart = withRunner('class GateRunner { Verdict run() { return breaker.beforeRun(x) ? null : new Verdict("circuit_open"); } }')
    expect(hasKey(breakerOrderFindings({ javaFiles: noStart }), '熔断问的时机', 'builder.start')).toBe(true)
  })
})

/**
 * KI-441｜**假服务上真走一遍**：核对器自己的接线有腿。
 *
 * 为什么不直接跑真 JVM：真服务那一趟要几分钟，而且它一红分不清是**接线**错还是**机制**错。
 * 这里把接线单独量清楚（虚拟钟、逐格写死的读数、不碰 HTTP），真服务那一趟留给 `--phase` 手跑。
 *
 * 假服务只做三件事：被 POST 时按脚本回一格；那一趟若是「记账门且被放行」就往账本添一笔；
 * 被 `GET /circuit/{id}` 时回**读的那一刻**的账（试探正在跑 ⇒ `trialInFlight=true`）。
 * 三个细节少了任何一条，读到的红都是我自己的接线错（实测踩过）：
 *  ① 每趟跑完虚拟钟再走 `GAP_MS`——真的两次 HTTP 不落在同一毫秒，被拒那一趟的零宽窗口才有界可补；
 *  ② 长跑那一趟在真实时间里也等一小会儿，于是并发一组里**被拒的那道先返回**，读到的才是「试探还在跑」；
 *  ③ `GET /circuit/{id}` 若有趟在跑，回的是那一趟的跑中账，不是上一趟的。
 */
const GAP_MS = 5
const REAL_STEP_MS = 8
const FAKE_COOLDOWN_MS = 1000
const PROBE_THRESHOLD = parseCircuitYml(gateAppYml).failureThreshold ?? 0

type FakeRound = { verdict: string; exitCode: number; durationMs: number; circuitState: string; after: Snap; lie?: boolean; secondTrial?: boolean }
const fr = (verdict: string, durationMs: number, circuitState: string, after: Snap, exitCode = verdict === 'green' ? 0 : verdict === 'circuit_open' ? -1 : 1): FakeRound => ({
  verdict,
  exitCode,
  durationMs,
  circuitState,
  after,
})
type RoleScript = { markRed?: FakeRound[]; slow?: FakeRound[]; flip?: FakeRound[]; plainRed?: FakeRound[]; plainGreen?: FakeRound[]; unspawnable?: FakeRound[] }
/** 命令行点到仓里真存在的脚本 ⇒ 那一格是「跑得成的门」；这一条同时是夹具那句注释的自证 */
const scriptTargetOf = (command: string): string => /((?:scripts|services)\/[\w./-]+\.mjs)/.exec(command)?.[1] ?? ''
const plainGreenRow = probeRoles.plain.find((r) => existsSync(join(root, scriptTargetOf(r.command))))
const plainRedRow = probeRoles.plain.find((r) => r !== plainGreenRow)
const commandById = new Map(probeRows.map((r) => [r.id, r.command]))

function fakeService(
  script: Record<string, FakeRound[]>,
  hooks: {
    markExtra?: (e: { id: string; row: FakeRound; fromMs: number; atMs: number; takePid: () => number; marks: { atMs: number; pid: number }[] }) => void
    dirty?: string
  } = {},
) {
  let vnow = T0
  let pid = 1000
  const marks: { atMs: number; pid: number }[] = []
  const lastAfter = new Map<string, Snap>()
  const inflight: { id: string; row: FakeRound; atMs: number }[] = []
  const consumed: string[] = []
  const queues: Record<string, FakeRound[]> = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, v.slice()]))
  const request = async (method: string, path: string): Promise<{ status: number; body: Record<string, unknown> }> => {
    if (method === 'GET' && path === '/gates') {
      return { status: 200, body: { source: 'fixture:caesura-gates-probe', count: probeRows.length, gates: probeRows } }
    }
    if (method === 'GET' && path === '/circuit') {
      return {
        status: 200,
        body: {
          failureThreshold: PROBE_THRESHOLD,
          cooldownSec: Math.round(FAKE_COOLDOWN_MS / 1000),
          count: probeRows.length,
          gates: probeRows.map((r) => ({ ...snap(r.id === hooks.dirty ? 'OPEN' : 'CLOSED', r.id === hooks.dirty ? 3 : 0), id: r.id, cooldownMs: FAKE_COOLDOWN_MS })),
        },
      }
    }
    const runMatch = /^\/gates\/(.+)\/run$/.exec(path)
    if (runMatch) {
      const id = decodeURIComponent(runMatch[1])
      const queue = queues[id]
      if (!queue) throw new Error(`假服务没有 ${id} 的脚本（名册与脚本对不上）`)
      const row = queue.shift()
      if (!row) throw new Error(`假服务没有 ${id} 的第 ${consumed.filter((c) => c.startsWith(`${id}:`)).length + 1} 趟脚本`)
      consumed.push(`${id}:${row.verdict}`)
      const fromMs = vnow
      const fly = { id, row, atMs: fromMs + Math.max(1, Math.floor(row.durationMs / 2)) }
      inflight.push(fly)
      if (row.durationMs > 0) await new Promise((r) => setTimeout(r, Math.min(row.durationMs, REAL_STEP_MS)))
      inflight.splice(inflight.indexOf(fly), 1)
      vnow = Math.max(vnow, fromMs + row.durationMs) + GAP_MS
      lastAfter.set(id, row.after)
      if (isMarking(commandById.get(id)) && row.verdict !== 'circuit_open') marks.push({ atMs: fly.atMs, pid: pid++ })
      hooks.markExtra?.({ id, row, fromMs, atMs: fly.atMs, takePid: () => pid++, marks })
      return {
        status: 200,
        body: {
          id,
          family: 'probe',
          command: commandById.get(id) ?? id,
          exitCode: row.exitCode,
          durationMs: row.durationMs,
          verdict: row.verdict,
          ranAt: new Date(fromMs).toISOString(),
          stdoutTail: '',
          stderrTail: '',
          circuitState: row.circuitState,
        },
      }
    }
    const one = /^\/circuit\/(.+)$/.exec(path)
    if (one) {
      const id = decodeURIComponent(one[1])
      const fly = inflight.find((f) => f.id === id)
      if (fly) {
        return {
          status: 200,
          body: {
            id,
            state: fly.row.circuitState,
            consecutiveFailures: fly.row.after.consecutiveFailures,
            trialInFlight: fly.row.circuitState === 'HALF_OPEN',
            openedAtMs: fly.row.after.openedAtMs,
            cooldownMs: FAKE_COOLDOWN_MS,
            remainingMs: fly.row.after.remainingMs,
          },
        }
      }
      const a = lastAfter.get(id)
      if (!a) return { status: 500, body: { error: '假服务没有这道门的账' } }
      return { status: 200, body: { ...a, id, cooldownMs: FAKE_COOLDOWN_MS } }
    }
    return { status: 404, body: { error: '假服务没有这条路由', path } }
  }
  return { request, consumed, marks, sleep: async (ms: number) => { vnow += ms } }
}

const openRoleScript = (): RoleScript => ({
  // 阈值那道门：坏够 ⇒ 账里第一次 OPEN ⇒ 后面两道被拒（remainingMs 在走，不是常数）
  markRed: [
    fr('red', 50, 'CLOSED', snap('CLOSED', 1)),
    fr('red', 50, 'CLOSED', snap('CLOSED', 2)),
    fr('red', 50, 'CLOSED', snap('OPEN', 3, { openedAtMs: 1 })),
    fr('circuit_open', 0, 'OPEN', snap('OPEN', 3, { openedAtMs: 1, remainingMs: 900 })),
    fr('circuit_open', 0, 'OPEN', snap('OPEN', 3, { openedAtMs: 1, remainingMs: 800 })),
  ],
  slow: [fr('timeout', 1004, 'CLOSED', snap('CLOSED', 1))],
  flip: [fr('green', 50, 'CLOSED', snap('CLOSED', 0))],
  plainRed: [fr('red', 120, 'CLOSED', snap('CLOSED', 1))],
  plainGreen: [fr('green', 900, 'CLOSED', snap('CLOSED', 0))],
  unspawnable: [fr('error', 812, 'CLOSED', snap('CLOSED', 1))],
})
const halfRoleScript = (): RoleScript => ({
  markRed: [
    fr('red', 50, 'CLOSED', snap('CLOSED', 1)),
    fr('red', 50, 'CLOSED', snap('CLOSED', 2)),
    fr('red', 50, 'CLOSED', snap('OPEN', 3, { openedAtMs: 1000 })),
    // 等过钟 ⇒ 放出去的一道试探（红的）：重新开闸，开闸时刻往前走
    fr('red', 50, 'HALF_OPEN', snap('OPEN', 4, { openedAtMs: 2000 })),
  ],
  slow: [
    fr('timeout', 1004, 'CLOSED', snap('CLOSED', 1)),
    fr('timeout', 1004, 'CLOSED', snap('CLOSED', 2)),
    fr('timeout', 1004, 'CLOSED', snap('OPEN', 3, { openedAtMs: 3000 })),
    fr('timeout', 1004, 'HALF_OPEN', snap('OPEN', 4, { openedAtMs: 4000 })),
    fr('circuit_open', 0, 'HALF_OPEN', snap('HALF_OPEN', 4, { openedAtMs: 4000, trialInFlight: true })),
  ],
  flip: [
    fr('red', 50, 'CLOSED', snap('CLOSED', 1)),
    fr('red', 50, 'CLOSED', snap('CLOSED', 2)),
    fr('red', 50, 'CLOSED', snap('OPEN', 3, { openedAtMs: 5000 })),
    fr('green', 50, 'HALF_OPEN', snap('CLOSED', 0)),
    fr('green', 50, 'CLOSED', snap('CLOSED', 0)),
  ],
})
/** 角色 → 跑着的那一名册里的格：门 id 一个都不在这里抄，全由 `rolesFromRoster` 现推 */
const rowOfRole = {
  markRed: probeRoles.markRed,
  markGreen: probeRoles.markGreen,
  slow: probeRoles.slow,
  flip: probeRoles.flip,
  plainRed: plainRedRow,
  plainGreen: plainGreenRow,
  unspawnable: probeRoles.unspawnable[0],
}
const idOfRole = (role: keyof typeof rowOfRole): string => String(rowOfRole[role]?.id ?? `(${role} 那一格在名册里没有)`)
const byRole = (s: RoleScript): Record<string, FakeRound[]> =>
  Object.fromEntries(
    Object.entries(s)
      .filter(([, rows]) => rows !== undefined)
      .map(([role, rows]) => [idOfRole(role as keyof typeof rowOfRole), rows as FakeRound[]]),
  )

async function walkFixture(
  phase: 'open' | 'halfopen',
  script: Record<string, FakeRound[]>,
  hooks: {
    markExtra?: (e: { id: string; row: FakeRound; fromMs: number; atMs: number; takePid: () => number; marks: { atMs: number; pid: number }[] }) => void
    dirty?: string
    ledger?: 'present' | 'missing'
  } = {},
) {
  const svc = fakeService(script, hooks)
  const out = await runSpawnLedgerCheck({
    base: 'http://fake.invalid/gate',
    phase,
    ledgerPath: 'in-memory',
    request: svc.request,
    sleep: svc.sleep,
    readLedger: () =>
      hooks.ledger === 'missing'
        ? null
        : svc.marks.map((m) => JSON.stringify({ atMs: m.atMs, pid: m.pid, ppid: null, node: 'fixture', cwd: '.', argv: ['--scripted'] })).join('\n') + '\n',
    truncateLedger: () => {},
    maxWaitMs: 15000,
    circuitYml: gateAppYml,
  })
  return { out, svc }
}

describe('KI-441｜假服务上真走一遍：开闸那一趟 0 个孩子是**数**出来的', () => {
  it('夹具那句「一绿一红各跑成」是真的：plain 里有一格跑仓里真存在的脚本，另一格指向缺失的脚本', () => {
    expect(plainGreenRow, 'plain 里没有「跑仓库真命令」的门 ⇒ 「绿门照跑」那一格没有证人').toBeDefined()
    expect(plainRedRow, 'plain 里没有「起不来的脚本」的门 ⇒ 账本盲区那一格没有证人').toBeDefined()
  })

  it('phase open 走查：verdict OK、findings 空、账本笔数与 expected 相等', async () => {
    const { out } = await walkFixture('open', byRole(openRoleScript()))
    expect(out.findings).toEqual([])
    expect(out.verdict).toBe('OK')
    expect(out.readings.marks).toBe(out.readings.expected)
    expect(out.readings.expected).toBe(4)
    expect(out.readings.blocked).toBeNull()
  })

  it('走查读到的表：9 趟、6 趟记账、3 趟发盲、2 趟 0 毫秒，而 6 趟全都「表与账一致」', async () => {
    const { out } = await walkFixture('open', byRole(openRoleScript()))
    expect(out.table?.summary).toEqual({
      rounds: 9,
      markingRounds: 6,
      blindRounds: 3,
      agree: 6,
      watchOverclaims: 0,
      watchUnderclaims: 0,
      zeroDurationRounds: 2,
    })
    const refused = (out.table?.rows ?? []).filter((r) => r.verdict === 'circuit_open')
    expect(refused.length).toBe(2)
    expect(refused.every((r) => r.marks === 0), '开闸那一趟居然有孩子的账 ⇒ 0 个孩子那句话又有读数了？').toBe(true)
  })

  it('第 ③ 句（error 那一趟 0 个孩子而毫秒数不是 0）在表上是**盲格**：这正是本批换证人的理由', async () => {
    const { out } = await walkFixture('open', byRole(openRoleScript()))
    const id = String(probeRoles.unspawnable[0]?.id)
    const row = (out.table?.rows ?? []).find((r) => r.id === id)
    expect(row).toMatchObject({ marks: 0, marking: false, ledgerSays: 'blind', inference: 'blind', verdict: 'error' })
    expect((row?.durationMs ?? 0) > 0, '那一趟的毫秒数如果是 0，「0 毫秒 = 没起进程」的读法就没有被否证').toBe(true)
  })

  it('phase halfopen 走查：14 趟全绿，半开那一档被真读到了（不是推断）', async () => {
    const { out } = await walkFixture('halfopen', byRole(halfRoleScript()))
    expect(out.findings).toEqual([])
    expect(out.verdict).toBe('OK')
    expect(out.readings.marks).toBe(13)
    expect(out.table?.summary).toMatchObject({ rounds: 14, markingRounds: 14, blindRounds: 0, agree: 14, zeroDurationRounds: 1 })
    const half = (out.rounds ?? []).filter((r) => r.circuitState === 'HALF_OPEN')
    expect(half.length, '整趟没读到 HALF_OPEN ⇒ 冷却那一档没被走过').toBeGreaterThan(0)
    expect((out.readings.skipped as string[])).toEqual([])
  })

  it('第 ② 句（半开只放一道试探）：并发那一组两趟里恰好一趟放行、恰好一个孩子', async () => {
    const { out } = await walkFixture('halfopen', byRole(halfRoleScript()))
    const pair = (out.rounds ?? []).filter((r) => r.group === 'trial-pair')
    expect(pair.length).toBe(2)
    expect(pair.filter((r) => r.verdict !== 'circuit_open').length).toBe(1)
    const refused = (out.table?.rows ?? []).filter((r) => r.verdict === 'circuit_open')
    expect(refused.length, '并发那一组里没有「被拒」那一趟 ⇒ 第二道从来没打过闸').toBeGreaterThan(0)
    expect(refused.every((r) => r.marks === 0), '被拒那一趟起了孩子 ⇒ 「只放一道试探」又只剩推断').toBe(true)
  })

  it('埋第一条谎（被拒那一趟也起了孩子）⇒「闸没关上」＋「总数对不上」两条一起红', async () => {
    const script = byRole(openRoleScript())
    const rows = script[String(probeRoles.markRed?.id)]
    rows[rows.length - 1].lie = true
    const { out } = await walkFixture('open', script, {
      markExtra: (e) => {
        if (e.row.lie) e.marks.push({ atMs: e.fromMs + 3, pid: e.takePid() })
      },
    })
    expect(out.verdict).toBe('RED')
    expect(hasKey(out.findings, '闸没关上', '第 5 趟')).toBe(true)
    expect(hasKey(out.findings, '总数对不上')).toBe(true)
  })

  it('埋第二条谎（半开放两道试探出去）⇒ 组级两条一起红，且那条试探也被状态机抓住', async () => {
    const script = byRole(halfRoleScript())
    const slow = script[String(probeRoles.slow?.id)]
    const second = slow[slow.length - 1]
    second.verdict = 'timeout'
    second.exitCode = -1
    second.durationMs = 1004
    second.after = snap('OPEN', 5, { openedAtMs: 4500 })
    second.secondTrial = true
    const { out } = await walkFixture('halfopen', script, {
      markExtra: (e) => {
        if (e.row.secondTrial) e.marks.push({ atMs: e.atMs, pid: e.takePid() })
      },
    })
    expect(out.verdict).toBe('RED')
    expect(hasKey(out.findings, '半开放了两道试探', 'trial-pair')).toBe(true)
    expect(hasKey(out.findings, '试探的孩子数不对')).toBe(true)
    expect(hasKey(out.findings, '试探败了没重新开闸')).toBe(true)
  })

  it('读不到账本 ⇒ 不绿：「一个进程都没起」这句话当天就没有证人', async () => {
    const { out } = await walkFixture('open', byRole(openRoleScript()), { ledger: 'missing' })
    expect(out.verdict).toBe('RED')
    expect(hasKey(out.findings, '没有账本')).toBe(true)
  })

  it('不是干净的开始 ⇒ 整趟作废：熔断的读数只在刚起来的进程上作数', async () => {
    const { out } = await walkFixture('open', byRole(openRoleScript()), { dirty: String(probeRoles.markRed?.id) })
    expect(out.verdict).toBe('RED')
    expect(hasKey(out.findings, '不是干净的开始')).toBe(true)
  })
})

/**
 * KI-441｜**真起孩子**：上面那一整趟吃的是假服务写的账。这一组把见证人本身搬到台前——
 * 账本里那一笔必须是**一个真进程**留下的，而且它「不肯沉默」的那几条得真的不肯。
 *
 * 三条规矩各自有腿：①环境变量没设 ⇒ **退非零**（沉默的见证人比没有见证人更坏：那时
 * 「账本里没这一笔」再也不能证明「没起进程」）；②一笔＝一个进程（写两行会被核对器报成
 * 「一趟起了两个孩子」）；③睡在记账**之后**（超时那一档要的是「孩子真起了、真被杀了」）。
 */
describe('KI-441｜真起孩子：一笔账 = 一个真进程', () => {
  const markScript = join(root, MARK_SCRIPT_RELPATH)
  const dirs: string[] = []
  const freshLedger = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'ki441-mark-'))
    dirs.push(dir)
    return join(dir, 'ledger.jsonl')
  }
  const runMark = (args: string[], mode: { ledger?: string; noEnv?: boolean } = {}) => {
    const ledger = mode.ledger ?? freshLedger()
    const env = { ...process.env }
    if (mode.noEnv) delete env[SPAWN_LEDGER_ENV]
    else env[SPAWN_LEDGER_ENV] = ledger
    const r = spawnSync(process.execPath, [markScript, ...args], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000,
      windowsHide: true,
      env,
    })
    return { r, ledger, endMs: Date.now() }
  }
  const ledgerLines = (p: string): string[] =>
    existsSync(p) ? read(p).split(/\r?\n/).filter((l: string) => l.trim() !== '') : []

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('记账那个孩子真的在仓里（判据⑬ 与这一组吃同一份字节）', () => {
    expect(existsSync(markScript), `仓里没有 ${MARK_SCRIPT_RELPATH}`).toBe(true)
    expect(isMarking(`node ${MARK_SCRIPT_RELPATH} --exit 1`), '孩子自己的命令行都不算「会记账」⇒ isMarking 拼法漂了').toBe(true)
  })

  it('被真起起来 ⇒ 账本里恰好一笔，而那一笔的 pid 就是 stdout 上说的那一个', () => {
    const { r, ledger, endMs } = runMark(['--exit', '1'])
    expect(r.status, `退码不是 1（stderr：${String(r.stderr).slice(0, 200)}）`).toBe(1)
    const lines = ledgerLines(ledger)
    expect(lines.length, '一个进程应当恰好留一笔；两笔 ⇒ 核对器会读成「一趟起了两个孩子」').toBe(1)
    const parsed = parseLedger(read(ledger))
    expect(parsed.bad, `孩子写的字节核对器读不懂：${JSON.stringify(parsed.bad)}`).toEqual([])
    const row = parsed.rows[0]
    expect(row.argv, 'argv 必须原样躺在账里——半开那一档的「次数」就数这个').toEqual(['--exit', '1'])
    expect(row.pid, `账里的 pid ${row.pid} 与 stdout 上的不是一个 ⇒ 那一笔不是这个进程留下的`).toBe(
      Number(/pid=(\d+)/.exec(r.stdout)?.[1]),
    )
    expect(typeof row.ppid, 'ppid 那一格要能读出父进程（Windows 中间那层壳不记账）').toBe('number')
    expect(Math.abs(endMs - row.atMs), 'atMs 不是「现在」⇒ 它量的不是这一趟起进程的时刻').toBeLessThan(60000)
  })

  it('环境变量没设 ⇒ 退 3 而**不退 0**，账本一个字不写，并把那个名字说出来', () => {
    const { r, ledger } = runMark(['--exit', '0'], { noEnv: true })
    expect(r.status, '没有账本可记却退了 0 ⇒ 「账本里没这一笔」再也不是「没起进程」的证据').toBe(3)
    expect(existsSync(ledger), '没账可记还建了个空文件 ⇒ 核对器读到的「空」变成了「文件在而没笔」').toBe(false)
    expect(r.stdout).not.toContain('pid=')
    expect(String(r.stderr)).toContain(SPAWN_LEDGER_ENV)
  })

  it('旗标值不对 ⇒ 退 2，且一笔都不落（退 0 会把一道坏门读成绿的）', () => {
    for (const args of [['--exit', 'abc'], ['--exit', '999'], ['--sleep-ms', '-5'], ['--fail-first', 'abc']]) {
      const { r, ledger } = runMark(args)
      expect(r.status, `${args.join(' ')} 不该被接受（stderr：${String(r.stderr).slice(0, 160)}）`).toBe(2)
      expect(ledgerLines(ledger).length, `${args.join(' ')} 用错了还记了账 ⇒ 数目里多出一个从没判过的孩子`).toBe(0)
    }
  })

  it('--fail-first 2 ⇒ 头两次退 1、第三次退 0，而那个「次数」住在账本里', () => {
    const ledger = freshLedger()
    const seen = [0, 1, 2].map(() => runMark(['--fail-first', '2'], { ledger }).r.status)
    expect(seen, `三趟的退码读成 ${JSON.stringify(seen)}（要 [1,1,0]）`).toEqual([1, 1, 0])
    expect(ledgerLines(ledger).length).toBe(3)
    rmSync(ledger)
    expect(runMark(['--fail-first', '2'], { ledger }).r.status, '删了账本就又从头数 ⇒ 次数确实是从账里数的').toBe(1)
  })

  it('换一个 argv 就是另一道门：次数各数各的（半开那一档要的「正好第三次绿」不能被别的门顶掉）', () => {
    const ledger = freshLedger()
    const a = ['--fail-first', '1']
    const b = ['--fail-first', '1', '--exit', '7']
    expect([runMark(a, { ledger }).r.status, runMark(a, { ledger }).r.status], '同一串 argv 的头两次要 [1,0]').toEqual([1, 0])
    expect(runMark(b, { ledger }).r.status, '另一串 argv 的第一次也跟着转绿了 ⇒ previousCount 没按 argv 分开数').toBe(1)
    expect(ledgerLines(ledger).length).toBe(3)
  })

  it('--sleep-ms 睡在记账**之后**：之后被门杀掉，那一笔也动不了', () => {
    const { r, ledger, endMs } = runMark(['--exit', '0', '--sleep-ms', '300'])
    expect(r.status, `睡一觉不该改变退码（stderr：${String(r.stderr).slice(0, 160)}）`).toBe(0)
    const lines = ledgerLines(ledger)
    expect(lines.length).toBe(1)
    const atMs = Number(JSON.parse(lines[0]).atMs)
    expect(endMs - atMs, '那一笔是在睡完之后写的 ⇒ 超时被杀的那一趟会丢账，「起了进程」变成没读数').toBeGreaterThanOrEqual(200)
  })
})

/**
 * KI-441｜**名字与入口**：账本环境变量只有一个主人，核对器当命令跑时先把用法问清楚。
 */
describe('KI-441｜账本环境变量的名册 + 核对器的命令行围栏', () => {
  const mjsFiles = [
    ...walk(SPRING).filter((rel: string) => rel.endsWith('.mjs')),
    ...readdirSync(join(root, 'scripts'))
      .filter((f: string) => f.endsWith('.mjs'))
      .map((f: string) => `scripts/${f}`),
  ]

  it('总体不是空的：孩子与核对器两份都在这一族里', () => {
    expect(mjsFiles).toContain(MARK_SCRIPT_RELPATH)
    expect(mjsFiles.some((rel: string) => rel.includes('spawn-ledger-check'))).toBe(true)
  })

  it('那个名字只被赋值一次，读取全走 SPAWN_LEDGER_ENV，裸拼法一处都没有', () => {
    const assignRe = new RegExp(`SPAWN_LEDGER_ENV\\s*=\\s*['"]${SPAWN_LEDGER_ENV}['"]`)
    const owners = mjsFiles.filter((rel: string) => assignRe.test(read(join(root, rel))))
    expect(owners.length, `赋值点读出来 ${JSON.stringify(owners)}：两个孩子 = 两份不同的账本`).toBe(1)
    const literals = mjsFiles.filter(
      (rel: string) => read(join(root, rel)).includes(SPAWN_LEDGER_ENV) && rel !== owners[0],
    )
    expect(literals, `除了主人，还有这些 .mjs 把那个名字抄成了字面量：${JSON.stringify(literals)}`).toEqual([])
    const bare = mjsFiles.filter((rel: string) => /process\.env\.CAESURA/i.test(read(join(root, rel))))
    expect(bare, `裸的 process.env.CAESURA_* 绕开了那个唯一名字：${JSON.stringify(bare)}`).toEqual([])
    for (const rel of mjsFiles.filter((f: string) => f.includes('spawn-mark.mjs') || f.includes('spawn-ledger-check.mjs'))) {
      expect(read(join(root, rel)), `${rel} 引用了这个名字却没走 process.env[SPAWN_LEDGER_ENV]`).toContain('process.env[SPAWN_LEDGER_ENV]')
    }
  })

  it('当命令跑而没有账本路径 ⇒ 退 2 并说出那个环境变量（不猜路径、不静默跑一趟）', () => {
    const env = { ...process.env }
    delete env[SPAWN_LEDGER_ENV]
    const r = spawnSync(process.execPath, [join(SPRING, 'spawn-ledger-check.mjs')], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000,
      windowsHide: true,
      env,
    })
    expect(r.status, `没给账本路径居然跑起来了（stdout 前 200 字：${String(r.stdout).slice(0, 200)}）`).toBe(2)
    expect(String(r.stderr)).toContain(SPAWN_LEDGER_ENV)
  })

  it('--phase 只认 open / halfopen：拼错就退 2，绝不默认走一趟', () => {
    const r = spawnSync(process.execPath, [join(SPRING, 'spawn-ledger-check.mjs'), '--ledger', 'x.jsonl', '--phase', 'nope'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000,
      windowsHide: true,
    })
    expect(r.status).toBe(2)
    expect(String(r.stderr), '报的不是 phase 那一格 ⇒ 拒绝得不 attributable').toContain('--phase')
  })

  it('被 import 时一个进程都不起、一个字都不打印（顶层围栏是真的）', () => {
    const r = spawnSync(
      process.execPath,
      ['-e', 'import("./services/spring/spawn-ledger-check.mjs").then(() => process.stdout.write("|"))'],
      { cwd: root, encoding: 'utf8', timeout: 60000, windowsHide: true },
    )
    expect(r.status, `import 就跑起了量测（stderr 前 200 字：${String(r.stderr).slice(0, 200)}）`).toBe(0)
    expect(r.stdout.trim(), '被 import 时不许打印判决（那是当命令跑才做的事）').toBe('|')
  })
})



