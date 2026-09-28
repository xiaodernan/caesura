import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LOCKON_FIELDS, RIGHT_ANGLE_RAD, lockOnFindings } from '../../scripts/lockon-rules.mjs'
import { interfaceFields, schemaBlocks } from '../../scripts/schema-vocab.mjs'

/**
 * 锁定四数那一块的两端实测（KI-084，TD-005 的入表腿）。
 *
 * 形状照 `battle-table.test.ts` / `explore-table.test.ts`（同一族理由）：判据住在
 * `scripts/lockon-rules.mjs`，门禁与这份测试读**同一段代码**；`validate-data.mjs` 一被 import 就去校验
 * 真表并 `process.exit`，而本沙箱 spawn 子进程被宿主拒（KI-075），所以"喂一组对不上的数看它拒不拒"
 * 那一半只有搬出来才量得动。
 *
 * **这一批为什么值得存在**：入表之前那两句文档（§34「Boss 独立锁定框」、tech-arch §3「角度优先→距离」）
 * 只是注释；入表之后它们是**数据之间**的关系，而逐字段的 `report.num`/`report.sub` 一次只看一个字段，
 * 表达不了关系。于是"把 `aimWeight` 从 2.2 调到 0.5"这种改动在四格 min 判据下完全合法，却已经把那句
 * 文档推翻了。这份文件量的就是：**关系被推翻的当天必须有人喊**。
 *
 * 刻意不在这里判的那两样（各有各的主人）：
 *  · 四个数各自的缺失 / 非有限 / 越界 —— `report.sub` 全场那张嘴（下面那条源码门钉着它别搬过来）；
 *  · "这一组数打出来锁谁" —— 那是 `tests/unit/lockon.test.ts` 的行为腿，这里只管关系成不成立。
 */

type Finding = { level: 'error' | 'warn'; file: string; where: string; msg: string }
type Block = Record<string, unknown>

/**
 * 底就是**真表那一块**（从磁盘读，不手抄 —— 抄一份进来就是把"表是主人"换成一句注释，
 * 而且改表之后下面每一臂的边界还在按老数算）。两条关系对它是成立的，这由第一条用例站住；
 * 每一臂都是在它身上**各改一处**得到的，所以红的那一条必然归得到被改的这一格。
 */
const REAL: Block = JSON.parse(
  readFileSync(new URL('../../src/data/json/player.json', import.meta.url), 'utf8'),
).lockOn as Block

const errs = (cfg: unknown): Finding[] => lockOnFindings(cfg).filter((f) => f.level === 'error')
const bad = (patch: Block): Block => ({ ...REAL, ...patch })
const without = (k: string): Block => Object.fromEntries(Object.entries(REAL).filter(([key]) => key !== k))

/** 距离项在整条射程上的跨度（两条关系共用的那个量，由真表现算而不是写死 2.1） */
const SPAN = (REAL.range as number) * (REAL.distWeight as number)

describe('accept 侧：真表那一块零条，而它同时是下面每一臂的底', () => {
  it('`player.json > lockOn` 四格齐、两条关系都成立 ⇒ 判据一声不响（不响是量出来的，不是没跑）', () => {
    expect(Object.keys(REAL).sort(), '真表那一块的字段集合换了：这份测试的底要跟着换').toEqual(
      [...LOCKON_FIELDS].sort(),
    )
    expect(errs(REAL)).toEqual([])
    expect(SPAN, '跨度读不出来 = 底是 NaN，下面所有臂都会假绿').toBeGreaterThan(0)
  })

  it('名单与主人现对账：`LOCKON_FIELDS` 就是从 `schema.ts > LockOnConfig` 的声明里读回来的', () => {
    const src = readFileSync(new URL('../../src/data/schema.ts', import.meta.url), 'utf8')
    const declared = interfaceFields(schemaBlocks(src), 'LockOnConfig')
    expect(declared, '抽取器在真文件上读不到 LockOnConfig（门在空转，不是"没有漂移"）').not.toBeNull()
    expect(declared?.sort()).toEqual([...LOCKON_FIELDS].sort())
  })
})

describe('关系①「Boss 独立锁定框」：加分必须严格大过距离项的跨度', () => {
  it('等号那一格必须红：两侧是**同一个表达式**，所以这里敢敲等号（她正好被追平 = 站远一点就被杂兵抢走）', () => {
    const e = errs(bad({ bossBonus: SPAN }))
    expect(e.length, `bossBonus = 跨度(${SPAN}) 时没红 = 这条判据是 < 而不是 ≤`).toBe(1)
    expect(e[0].where).toBe('lockOn')
    expect(e[0].msg).toContain('Boss 加分')
  })

  it('高出跨度一点点 ⇒ 零条（门的职责是"追上那句文档"，不是把合法解挤光）', () => {
    expect(errs(bad({ bossBonus: SPAN * (1 + 1e-9) })), '比跨度大还红 = 这条门没有合法解了').toEqual([])
  })

  it('加分归零 ⇒ 只红这一条（§34 那句"独立锁定框"整格失效，而角度那条不该顺手说话）', () => {
    const e = errs(bad({ bossBonus: 0 }))
    expect(e.length).toBe(1)
    expect(e[0].msg, '红的是角度那条 = 两条门互相串门，改了数也不知道改哪句文档').not.toContain('角度优先')
  })
})

describe('关系②「角度优先→距离」：距离跨度必须小过 90° 的角度惩罚', () => {
  /**
   * 这一条**不敲等号**：等号两侧是两个不同的表达式（`dist × range` 与 `aim × π/2`），
   * 反解出来的那个 aim 乘回去会差一个 ulp —— 那一臂就变成掷硬币。所以边界用 ±0.1% 夹住，
   * 并且这里把"为什么不敲等号"写在明处（关系①敢敲是因为两侧同一表达式）。
   */
  const ANGLE_EQU = SPAN / RIGHT_ANGLE_RAD

  it('角度惩罚被削到跨价的 0.999 ⇒ 红，而且说的是"文档那句不再成立"', () => {
    const e = errs(bad({ aimWeight: ANGLE_EQU * 0.999 }))
    expect(e.length).toBe(1)
    expect(e[0].msg, '红话只报了个数而不指文档 = 下一个人不知道该改哪一格').toContain('角度优先')
  })

  it('角度惩罚是跨价的 1.001 ⇒ 零条（界限两侧各敲一次，中间没有第三种说法）', () => {
    expect(errs(bad({ aimWeight: ANGLE_EQU * 1.001 }))).toEqual([])
  })

  it('射程被拉长也能推翻这一条：同一条关系有两个入口，谁都别想靠"我只动权重"绕过去', () => {
    // range 加倍 ⇒ 跨度加倍 ⇒ 原本 1.6 倍于跨度的角度惩罚变成 0.8 倍。
    // 顺带把关系①也推翻（Boss 加分不再盖得住那条更长的射程）——两条各说各的，所以这里是**两条**。
    const e = errs(bad({ range: (REAL.range as number) * 2 }))
    expect(e.map((x) => x.where).sort()).toEqual(['lockOn', 'lockOn'])
    expect(e.some((x) => x.msg.includes('角度优先')), '射程变了而角度那条不作声 = 它只盯着权重那一格').toBe(true)
    expect(e.some((x) => x.msg.includes('Boss 加分')), '两条门红成一条 = 报告里看不出被推翻的是哪句文档').toBe(true)
  })
})

describe('判据的边界：什么时候该说话、什么时候闭嘴', () => {
  it('缺块与非对象各说一次，而且只说一次（不说就等于玩法失灵：`d <= undefined` 恒假）', () => {
    for (const v of [undefined, null, 35, '35', [], [{ range: 35 }]]) {
      const e = errs(v)
      expect(e.length, `输入 ${JSON.stringify(v)} 没有说法 = 那四个数会被读成 undefined 而全场静默`).toBe(1)
      expect(e[0].where).toBe('lockOn')
    }
  })

  it('四个数里缺任何一个 ⇒ 判据这一份不作声（缺失/越界的说法归 `report.sub`，两个主人就红了）', () => {
    for (const k of LOCKON_FIELDS) {
      expect(errs(without(k)), `'${k}' 缺失时判据跟着报了一条 = 抢了 report.sub 的活`).toEqual([])
    }
  })

  it('非有限数（NaN / Infinity）不参与关系判断，也不冒充"合法"：说法归 report.sub，这里只保证不炸', () => {
    expect(errs(bad({ distWeight: Number.NaN }))).toEqual([])
    expect(errs(bad({ range: Number.POSITIVE_INFINITY }))).toEqual([])
  })

  it('未知字段点名到那一格，并说清"加字段要连消费方一起加"', () => {
    const e = errs(bad({ lockWhileLocked: 1 }))
    expect(e.length).toBe(1)
    expect(e[0].where, '未知字段没挂到自己的格上 = 报告里看不出是谁').toBe('lockOn.lockWhileLocked')
    expect(e[0].msg).toContain('LockOnConfig')
  })
})

describe('判据只有一个主人：校验器是嘴，四个字段各有读者', () => {
  const code = (rel: string): string =>
    readFileSync(new URL(rel, import.meta.url), 'utf8')
      .split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

  it('校验器走这份判据，而两条不等式的形状不在它里面重写第二份', () => {
    const v = code('../../scripts/validate-data.mjs')
    expect(v, 'validatePlayer 不再走这份判据 = 有一条平行实现悄悄长了出来').toContain('lockOnFindings(')
    for (const gone of ['bossBonus <=', 'distWeight * range', 'RIGHT_ANGLE_RAD']) {
      expect(v, `判据 '${gone}' 又被人抄回校验器里了（判据的主人只有一个）`).not.toContain(gone)
    }
    expect(v, '四个数各自的可闻带不再走 report.sub = 那三种说法出现了第二个主人').toContain("'lockOn', p.lockOn")
  })

  it('词表对账仍然管着这张名单（schema 加了字段而名单没人看 = 合法数据被自己的门挡在门外）', () => {
    expect(code('../../scripts/validate-data.mjs'), "VOCAB_PAIRS 里少了 'LOCKON_FIELDS' 这一对")
      .toContain("where: 'LOCKON_FIELDS'")
  })

  it('四格各有读者：射程读两次（筛选与脱锁共用），其余三格各一次，且都从注入的配置里取', () => {
    const src = code('../../src/player/LockOn.ts')
    expect(LOCKON_FIELDS.length).toBe(4)
    for (const [k, n] of [['range', 2], ['aimWeight', 1], ['distWeight', 1], ['bossBonus', 1]] as const) {
      const hits = src.match(new RegExp(`this\\.cfg\\.${k}\\b`, 'g')) ?? []
      expect(hits.length, `player.json > lockOn.${k} 的读者数不是 ${n}（实测 ${hits.length}）：少一条就是那一格成了死数据（§55），多一条就是又长了个主人`)
        .toBe(n)
    }
  })

  it('组合根把表里那一块交进去（不交就是"表写了、码里读的是构造默认值"那种谎）', () => {
    expect(code('../../src/main.ts'), 'main.ts 里注入 LockOn 的那一行换了形状：这条判据要跟着换')
      .toContain('new LockOn(player, playerBase.lockOn)')
  })
})
