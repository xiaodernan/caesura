import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { msToTicks, TICK_HZ } from '@/core/Time'
import { BURST_FIELDS, burstFindings, FEINT_FIELDS } from '../../scripts/burst-rules.mjs'
import { interfaceFields, schemaBlocks } from '../../scripts/schema-vocab.mjs'

/**
 * 连发与诱饵那一块的两端实测（KI-085）。
 *
 * 形状照 `lockon-table.test.ts` / `battle-table.test.ts`（同一族理由）：判据住在
 * `scripts/burst-rules.mjs`，门禁与这份测试读**同一段代码**；`validate-data.mjs` 一被 import 就去校验
 * 真表并 `process.exit`，而本沙箱 spawn 子进程被宿主拒（KI-075），所以"喂一组对不上的数看它拒不拒"
 * 那一半只有搬出来才量得动。
 *
 * **这一批为什么值得存在**：combat.md §14.4 那句「三叠箭第 2 拍为假动作（延迟 0.25 拍），骗翻滚后硬直
 * 0.6s」说的全是**这一组数之间的关系**——哪一发是诱饵、它比均匀网格晚多少、它后面还有没有真收尾、
 * 硬直盖不盖得住到下一发之间的间隔。逐字段的 `report.num` 一次只看一格，这四件事一件都说不出：
 * 把 `at` 从 `[0,32,42]` 改成 `[0,21,42]`（均匀网格 ⇒ 假动作消失）或把 `punishMs` 改成 167
 * （硬直短到玩家还能再滚一次），在旧判据下完全合法。这份文件量的就是：**关系被推翻的当天必须有人喊**。
 *
 * 行为那一半（被骗空的一滚欠 36 格、翻滚结束时才兑现）在 `tests/flow/feint-punish.test.ts`，
 * 这里只管关系成不成立。
 */

type Finding = { level: 'error' | 'warn'; file: string; where: string; msg: string }
type Block = Record<string, unknown>

const FILE = 'enemies.json'
/** 校验器挂这块时用的 `where`（消息里的位置就是这一串，臂的对账也按它写） */
const AT = 'en_skewer.tri.frames.projectile.burst'

/**
 * 底就是**真表那一块**（从磁盘读，不手抄——抄一份进来就是把"表是主人"换成一句注释，而且改表之后
 * 下面每一臂的边界还在按老数算）。四条关系对它是成立的，这由第一条用例站住；每一臂都是在它身上
 * **各改一处**得到的，所以红的那一条必然归得到被改的这一格。
 */
const ENEMIES = JSON.parse(
  readFileSync(new URL('../../src/data/json/enemies.json', import.meta.url), 'utf8'),
) as Array<Record<string, unknown>>
const ATTACKS = ENEMIES.find((e) => e.id === 'en_skewer')!.attacks as Array<Record<string, unknown>>
const REAL_BURST: Block = ((ATTACKS.find((a) => a.id === 'tri')!.frames as Block)
  .projectile as Block).burst as Block
const REAL_FEINT: Block = REAL_BURST.feint as Block
const REAL_AT: number[] = REAL_BURST.at as number[]

const errs = (burst: unknown): Finding[] => burstFindings(FILE, AT, burst).filter((f) => f.level === 'error')
const bad = (patch: Block): Block => ({ ...REAL_BURST, ...patch })
const badFeint = (patch: Block): Block => bad({ feint: { ...REAL_FEINT, ...patch } })

/** 诱饵到下一发之间的那段间隔（tick）——由真表现算，不写死 10 */
const GAP = REAL_AT[Number(REAL_FEINT.shot) + 1] - REAL_AT[Number(REAL_FEINT.shot)]

describe('accept 侧：真表那一块零条，而它同时是下面每一臂的底', () => {
  it('`enemies.json > tri.burst` 四格齐、四条关系都成立 ⇒ 判据一声不响（不响是量出来的，不是没跑）', () => {
    expect(Object.keys(REAL_BURST).sort(), '真表那一块的字段集合换了：这份测试的底要跟着换')
      .toEqual([...BURST_FIELDS].sort())
    expect(Object.keys(REAL_FEINT).sort()).toEqual([...FEINT_FIELDS].sort())
    expect(errs(REAL_BURST)).toEqual([])
    expect(GAP, '间隔读不出来 = 底是 NaN，下面所有边界臂都会假绿').toBeGreaterThan(0)
  })

  it('§14.4 那半句中文在表里是什么形状：诱饵是第 2 发、比均匀网格晚 11 tick（≈0.25 拍），罚 0.6s', () => {
    expect(REAL_FEINT.shot, '假动作指的那一发换了 ⇒ 这句文档要跟着改，不是这里跟着改').toBe(1)
    expect(REAL_BURST.count).toBe(3)
    expect(REAL_BURST.everyTicks).toBe(21)
    const delay = REAL_AT[Number(REAL_FEINT.shot)] - Number(REAL_FEINT.shot) * Number(REAL_BURST.everyTicks)
    // 「延迟 0.25 拍」折成 tick 要看拍长，而拍长是**开局那张网格**给的（main.ts 里那一次 setBpm），
    // 从源码读回来而不是抄 84——抄了就是把一句文档换成第二份数。取整到整 tick 是玩法的形状：
    // 帧位表里只能写整数 tick，所以 0.25 拍(10.71 tick) 落成的就是 11。
    const m = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8').match(/rhythm\.setBpm\((\d+(?:\.\d+)?),\s*\d+\)/)
    expect(m, 'main.ts 里"开局网格"那一行的形状换了：这一臂要跟着换（读不到就不许当"0.25 拍成立"）').not.toBeNull()
    const beatTicks = (60 / Number(m![1])) * TICK_HZ
    expect(delay, `诱饵的延迟 tick 必须就是「0.25 拍」取整（一拍 ${beatTicks} tick ⇒ 0.25 拍 = ${0.25 * beatTicks} tick）`)
      .toBe(Math.round(0.25 * beatTicks))
    expect(REAL_FEINT.punishMs, '0.6s 那一格是表里的，不是代码里的第二份数').toBe(600)
    expect(msToTicks(600), '惩罚折成 tick 必须盖得住到下一发的间隔（关系⑤的那条边界下面各敲一次）')
      .toBeGreaterThan(GAP)
  })

  it('名单与主人现对账：BURST_FIELDS / FEINT_FIELDS 就是从 schema.ts 的声明里读回来的', () => {
    const src = readFileSync(new URL('../../src/data/schema.ts', import.meta.url), 'utf8')
    const blocks = schemaBlocks(src)
    for (const [name, list] of [['ProjectileBurst', BURST_FIELDS], ['BurstFeint', FEINT_FIELDS]] as const) {
      const declared = interfaceFields(blocks, name)
      expect(declared, `抽取器在真文件上读不到 ${name}（门在空转，不是"没有漂移"）`).not.toBeNull()
      expect([...declared!].sort(), `${name} 与名单不一致`).toEqual([...list].sort())
    }
  })
})

describe('关系①「诱饵必须落在真会发出去的那一发」：下标要在 0..count-1，而且不能是最后一发', () => {
  it('下标越界 ⇒ 只红一条，说的就是"这一格永远等不到离手的那一发"（§55 死数据）', () => {
    for (const shot of [3, 9, -1]) {
      const e = errs(badFeint({ shot }))
      expect(e.length, `shot=${shot} 没红 = 判据没看上界`).toBe(1)
      expect(e[0].where).toBe(`${AT}.feint.shot`)
      expect(e[0].msg).toContain('0..2')
    }
  })

  it('诱饵是最后一发 ⇒ 恰好一条，而且是"没有真收尾"那一条（同一处手误报两条会把人往错的那一格带）', () => {
    // at[2]=42 恰好等于均匀网格 2×21=42 ⇒ "不比网格晚"这条也成立；早退守卫必须只留一条说法。
    const e = errs(badFeint({ shot: 2 }))
    expect(e.length, `报了 ${e.length} 条：KI-083 的 opaque 守卫在这一格失守了`).toBe(1)
    expect(e[0].msg, '红话说的不是"最后一发" = 下一个人会去改 at 而文档那句根本不是这么写的')
      .toContain('最后一发')
    expect(e[0].msg).not.toContain('均匀网格')
  })
})

describe('关系②「假动作靠显式帧位」：没有可读的 at[shot]，那句话就没有载体', () => {
  it('at 整个缺掉 / 不是数组 / 短到读不到那一发 ⇒ 各说一次，只说一次', () => {
    for (const at of [undefined, null, '0,32,42', 0, [0]]) {
      const e = errs(bad({ at }))
      expect(e.length, `at=${JSON.stringify(at)} 没有说法 = "延迟的那一发"在数据里不存在而全场静默`).toBe(1)
      expect(e[0].where).toBe(`${AT}.feint`)
      expect(e[0].msg).toContain('显式帧位')
    }
  })

  it('帧位只写到诱饵那一发也谈得上关系：下一发的间隔由 count × everyTicks 推出来（不是"读不到就闭嘴"）', () => {
    // at=[0,32] ⇒ thisFrame=32、nextFrame=grid+everyTicks=42 ⇒ 间隔仍是 10 ⇒ 600ms(36 tick) 盖得住
    expect(errs(bad({ at: [0, 32] })), '帧位短于 count 时判据该用网格推出下一发，而不是把⑤整条跳过')
      .toEqual([])
  })

  it('发数多于帧位时那条 WARN 归校验器，这里不抄第二遍（判据的主人只有一个）', () => {
    expect(errs(bad({ at: [0, 32, 42, 50] })), '帧位多于 count 在这里也报 = 同一件事两个主人')
      .toEqual([])
  })
})

describe('关系④「延迟」：诱饵那一发必须严格比均匀网格晚', () => {
  it('等号那一格必须红：at[shot] 正好落在网格上 ⇒ 玩家按网格翻滚照样躲得掉，那不叫假动作', () => {
    const e = errs(bad({ at: [0, 21, 42] })) // 21 = shot(1) × everyTicks(21)
    expect(e.length).toBe(1)
    expect(e[0].where).toBe(`${AT}.feint.shot`)
    expect(e[0].msg).toContain('均匀网格')
  })

  it('比网格早也红（同一句话的两侧），而且只有一条', () => {
    const e = errs(bad({ at: [0, 15, 42] }))
    expect(e.length).toBe(1)
    expect(e[0].msg).toContain('不比均匀网格')
  })

  it('晚一格就够：这条门的职责是"追上那句文档"，不是把合法解挤光', () => {
    expect(errs(bad({ at: [0, 22, 42] })), '比网格晚还红 = 这条门没有合法解了').toEqual([])
  })
})

describe('关系⑤「硬直盖得住间隔」：边界两侧各敲一次', () => {
  /** 间隔是 ${GAP} tick ⇒ 折成 ${GAP} 格正好追平（红），${GAP + 1} 格才叫盖得住（绿） */
  const justGap = (ticks: number): number => Math.round(ticks * (1000 / TICK_HZ))

  it('刚好追平间隔 ⇒ 红（"被骗空之后还来得及再滚一次"，这一格惩罚形同虚设）', () => {
    const ms = justGap(GAP)
    const e = errs(badFeint({ punishMs: ms }))
    expect(msToTicks(ms), `底稿换算不成立：${ms}ms 折出来不是 ${GAP} 格`).toBe(GAP)
    expect(e.length).toBe(1)
    expect(e[0].where).toBe(`${AT}.feint.punishMs`)
    expect(e[0].msg).toContain('盖不住')
  })

  it('比间隔多一格 ⇒ 零条（等号那一侧才是这条门要拦的）', () => {
    const ms = justGap(GAP + 1)
    expect(msToTicks(ms)).toBe(GAP + 1)
    expect(errs(badFeint({ punishMs: ms }))).toEqual([])
  })

  it('真表那个 600 与边界之间没有第三种说法：把它削到追平间隔就红', () => {
    expect(errs(badFeint({ punishMs: justGap(GAP) })).length).toBe(1)
  })

  it('非有限数不参与这条判断（缺失/NaN 的说法归 report.sub，两个主人就红了）', () => {
    for (const punishMs of [Number.NaN, Number.POSITIVE_INFINITY, undefined, '600']) {
      expect(errs(badFeint({ punishMs })), `punishMs=${String(punishMs)} 时这里跟着报了 = 抢了 report.sub 的活`)
        .toEqual([])
    }
  })
})

describe('判据的边界：什么时候该说话、什么时候闭嘴', () => {
  it('缺块与非对象各说一次，而且只说一次（不说就等于连发直接不发）', () => {
    for (const v of [undefined, null, 3, '3', [], [{ count: 3 }]]) {
      const e = errs(v)
      expect(e.length, `输入 ${JSON.stringify(v)} 没有说法 = count/at 会被读成 undefined 而全场静默`).toBe(1)
      expect(e[0].where).toBe(AT)
    }
  })

  it('没有 feint 声明就连发关系都谈不上：真表去掉 feint ⇒ 零条（逐字段的 min 判据仍在校验器里管着）', () => {
    const { feint, ...rest }: Block = REAL_BURST
    expect(feint, '底里已经没有 feint 了，这一臂在测空集').toBeDefined()
    expect(errs(rest)).toEqual([])
  })

  it('feint 不是对象 ⇒ 一条（"诱饵"这块读不出来时不能顺着把后面三条都跑一遍）', () => {
    for (const feint of [3, '3', [], null]) {
      const e = errs(bad({ feint }))
      expect(e.length, `feint=${JSON.stringify(feint)} 说法数不是 1`).toBe(1)
      expect(e[0].where).toBe(`${AT}.feint`)
    }
  })

  it('未知字段点名到那一格，并说清"加字段要连消费方一起加"', () => {
    const e1 = errs(bad({ everyFrames: 21 }))
    expect(e1.length).toBe(1)
    expect(e1[0].where).toBe(`${AT}.everyFrames`)
    expect(e1[0].msg).toContain('ProjectileBurst')
    const e2 = errs(badFeint({ delayBeats: 0.25 }))
    expect(e2.length, `诱饵块里的未知字段报了 ${e2.length} 条`).toBe(1)
    expect(e2[0].where).toBe(`${AT}.feint.delayBeats`)
    expect(e2[0].msg).toContain('BurstFeint')
  })
})

describe('判据只有一个主人，而这条链每一格都有读者', () => {
  const code = (rel: string): string =>
    readFileSync(new URL(rel, import.meta.url), 'utf8')
      .split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  /** 按**行**数站点（同一行里读写两次算一处：改那一行的动机是一件事） */
  const sites = (rel: string, re: RegExp): string[] => code(rel).split(/\r?\n/).filter((l) => re.test(l))

  it('校验器走这份判据，而四条关系的形状不在它里面重写第二份', () => {
    const v = code('../../scripts/validate-data.mjs')
    expect(v, 'validate 不再走这份判据 = 有一条平行实现悄悄长了出来').toContain('burstFindings(')
    for (const gone of ['shot < count', 'shot * everyTicks', '盖不住', '均匀网格']) {
      expect(v, `判据 '${gone}' 又被人抄回校验器里了（判据的主人只有一个）`).not.toContain(gone)
    }
    expect(v, 'feint 两格各自的可闻带不再走 report.sub = 那三种说法出现了第二个主人')
      .toContain('${where}.burst.feint')
  })

  it('词表对账仍然管着这两张名单', () => {
    const v = code('../../scripts/validate-data.mjs')
    for (const where of ['BURST_FIELDS', 'FEINT_FIELDS']) {
      expect(v, `VOCAB_PAIRS 里少了 '${where}' 这一对`).toContain(`where: '${where}'`)
    }
  })

  it('抄来的尺子对得上主人：burst-rules 的 TICK_HZ 与 src/core/Time.ts 是同一个数、同一个算式', () => {
    // 这一条存在的理由：`.mjs` 牵不进 TS 模块（KI-075），所以 TICK_HZ 与那把尺子都是**抄的**——
    // 抄了就要有对账。边界两侧各敲一次的⑤那两臂（上面）才是这条对账的行为证据：尺子脱钩时先红的是它。
    expect(TICK_HZ, '逻辑 tick 的频率换了主人？src/core/Time.ts 是那唯一的一个').toBe(60)
    const rules = readFileSync(new URL('../../scripts/burst-rules.mjs', import.meta.url), 'utf8')
    expect(rules, 'burst-rules 里出现第二个 TICK_HZ 声明（对账就失效了）')
      .toMatch(new RegExp(`export const TICK_HZ = ${TICK_HZ}\\b`))
    expect(rules, '换算不再是"那把唯一的尺子"的算式：与 src/core/Time.ts > msToTicks 对不上')
      .toContain('Math.round(ms / (1000 / TICK_HZ))')
  })

  it('表里那两个数各只有一个读者：`feint.punishMs` / `feint.shot` 在 src 里恰好各读一次，别处一份也没有', () => {
    const files = ['../../src/ai/Enemy.ts', '../../src/combat/CombatManager.ts', '../../src/player/ThirdPersonController.ts', '../../src/combat/Projectiles.ts']
    for (const re of [/feint\.punishMs/, /feint\.shot/]) {
      const readers = files.filter((f) => sites(f, re).length > 0)
      expect(readers, `${re.source} 的读者不是恰好 Enemy.ts 一处（实测 ${readers.join(', ') || '无'}）：多一处就有第二个主人判"哪一发/罚多久"`)
        .toEqual(['../../src/ai/Enemy.ts'])
    }
  })

  it('诱饵身份跟着弹体走的那几格各有其位：Enemy 说两次、CombatManager 递三次、弹体带三次、玩法层兑现一次', () => {
    // 行数（不是匹配次数）就是"这一格在这一文件里说过几次话"：同一行里读写两次算一处，
    // 因为改这一行的动机是一件事（ KI-083 的口径）。
    expect(sites('../../src/ai/Enemy.ts', /feintPunishMs/), 'Enemy 侧的说法数换了：这条链的形状要跟着看').toHaveLength(2)
    expect(sites('../../src/ai/Enemy.ts', /a\.shots === feint\.shot/), '只有 burst.feint.shot 那一发带数——这句判据被人搬走了')
      .toHaveLength(1)
    const cm = '../../src/combat/CombatManager.ts'
    expect(sites(cm, /feintPunishMs/), 'CombatManager 的递法形状换了（取出/交进弹体/吃掉那一拍兑现）').toHaveLength(3)
    expect(sites(cm, /beginFeintPunish\(/), '兑现点不是恰好一处（两处就有两个主人判"该不该罚"）').toHaveLength(1)
    expect(sites('../../src/combat/Projectiles.ts', /feintPunishMs/), '弹体侧的说法数换了（类型两处 + spawn 抄一次）').toHaveLength(3)
    const tpc = '../../src/player/ThirdPersonController.ts'
    expect(sites(tpc, /beginFeintPunish/), 'beginFeintPunish 的定义处不是 ThirdPersonController 一处').toHaveLength(1)
    expect(sites(tpc, /punishTicks/), '承载格(声明/写入/兑现)的处数不是 3：这一滚的欠账长出了第二个载体').toHaveLength(3)
  })

  it('欠账在翻滚自然结束那一拍兑现，而"必须在滚"这条判据住在玩法层而不是校验器', () => {
    const tpc = code('../../src/player/ThirdPersonController.ts')
    expect(tpc, 'beginFeintPunish 不再判"这一滚还在飞" = 站着挨诱饵也会欠账').toContain('if (!this.roll) return false')
    expect(tpc, '兑现点不在翻滚结束那一段 = 硬直会插在翻滚中间（那一段的锁本来就是翻滚自己的）')
      .toContain('this.roll.tick >= this.roll.total')
  })
})
