import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  ORCHESTRATION_OWNERS,
  ROSTER_KEYS,
  ROSTER_RELPATH,
  SERVICE_NAMES,
  breakerWiredFindings,
  commandTargetFindings,
  containerShapeFindings,
  imageProvidesNode,
  javaHardcodeFindings,
  javaReadsRepoDataFindings,
  orchestrationOwnerFindings,
  parseGateRoster,
  rosterScopeFindings,
  rosterShapeFindings,
  serviceTopologyFindings,
  spawnShapeFindings,
} from '../../scripts/spring-family-rules.mjs'
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
