import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BATTLE_FIELDS, BATTLE_SILENT_FIELDS, BATTLE_TONAL_FIELDS, MAX_PATTERN_CELL, PATTERN_OCTAVE_TIERS,
  battleFindings, patternCellOk,
} from '../../scripts/battle-rules.mjs'
import { MOTIF_R1, battleOstinatoHz } from '@/audio/music'

/**
 * 战斗档表的两端实测（KI-080：`music.battle` 那 5 个 id 从"指向一张不存在的表"变成有读者的一行）。
 *
 * 形状照 `explore-table.test.ts`（同一族理由）：判据住在 `scripts/battle-rules.mjs`，门禁与这份测试读
 * **同一段代码**；`validate-data.mjs` 一被 import 就去校验真表并 `process.exit`，而本沙箱 spawn 子进程
 * 被宿主拒（KI-075），所以"拒不拒"那一半只有搬出来才量得动。
 *
 * 刻意不在这里判的那两样：
 *  · `bellEveryBars` 的正整数 —— `report.num` 全场那张嘴（下面那条源码门钉着它别搬过来）；
 *  · "那一行走出来是什么音" —— 那是 `audio-music.test.ts` 的耳朵侧，这里只管表的结构。
 *
 * ⚠️ 与探索曲那份**相反**的一件事，要在这里说清并留有证人：`music.explore` 共用一张曲是红
 * （一区一张是 §1.2 的承诺），而 `music.battle` 跨区共用一行是合法的 —— §1.1 写的就是"战斗遭遇
 * 主音不变"。所以下面有一条专门喂"两区指同一行"并断言零条：允许共享是**选择**，不是判据漏了。
 */

type Finding = { level: 'error' | 'warn'; file: string; where: string; msg: string }
type Row = Record<string, unknown>

/**
 * 一行合法有配（4 格循环、每两小节一记钟）与一行合法无配（§6.3 那一格）。
 * 每一臂都是在它们身上**各改一处**得到的，所以红的那一条必然归得到被改的这格。
 */
const TONAL_OK: Row = { id: 'mus_a_battle', pattern: [0, 0, 2, 5], bellEveryBars: 2 }
const SILENT_OK: Row = { id: 'mus_b_battle', noMusic: true }
/** 区域那一侧：`music.battle` 指过来就行（这一份判据不看鼓型，小节数也不看） */
const reg = (battle: string, id = `rg_${battle}`): Row => ({ id, music: { battle } })
const bad = (patch: Row): Row => ({ ...TONAL_OK, ...patch })
const withId = (id: string, patch: Row = {}): Row => ({ ...TONAL_OK, ...patch, id })

const run = (rows: unknown, regions: unknown[] = [reg('mus_a_battle'), reg('mus_b_battle')]): Finding[] =>
  battleFindings(rows, regions)
const errs = (rows: unknown, regions: unknown[] = [reg('mus_a_battle'), reg('mus_b_battle')]): Finding[] =>
  run(rows, regions).filter((f) => f.level === 'error')

/** 真表走磁盘而不是 `@/data`：那份索引已经把 JSON 当模块解析，判据要读的是文件里那几行字节 */
const json = <T>(rel: string): T => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as T
const REAL_ROWS = (): Row[] => json<Row[]>('../../src/data/json/battle.json')
const REAL_REGIONS = (): unknown[] => json<unknown[]>('../../src/data/json/regions.json')

describe('战斗档判据的 accept 侧：合法形状一条都不报', () => {
  it('有配那一支三格齐、无配那一支只有两格 ⇒ 零条（两支各自的必填由这条站住）', () => {
    expect(errs([TONAL_OK, SILENT_OK])).toEqual([])
  })

  it('八度档的两侧都敲：最大合法格零条，越界一格红一条（那个上界是从判据读的，不是这里挑的）', () => {
    expect(MAX_PATTERN_CELL, '上界要看得见，否则下面两条的说法没有支点').toBe(7)
    expect(errs([bad({ pattern: [MAX_PATTERN_CELL] })], [reg('mus_a_battle')]), `第 ${MAX_PATTERN_CELL} 格是允许的最后一格，却红了`).toEqual([])
    const over = errs([bad({ pattern: [MAX_PATTERN_CELL + 1] })], [reg('mus_a_battle')])
    expect(over.length, '越界一格没红 = 八度上界只是注释').toBe(1)
    expect(over[0].where).toBe('mus_a_battle.pattern[0]')
    expect(patternCellOk(MAX_PATTERN_CELL), '判据函数与它自己的上界对不上').toBe(true)
    expect(patternCellOk(MAX_PATTERN_CELL + 1), '判据函数放行越界格').toBe(false)
  })

  it('两区共用一行是合法的（与探索曲那条相反，这里是 §1.1「主音不变」在选择共用）', () => {
    const shared = errs([TONAL_OK], [reg('mus_a_battle', 'rg_one'), reg('mus_a_battle', 'rg_two')])
    expect(shared, `跨区共用一行战斗档被误判成脏数据了：${shared.map((e) => e.msg).join(' / ')}`).toEqual([])
  })

  it('真表 + 真 regions：零条 ERROR、零条 WARN，而"有没有行"这一头不是碰巧读到了空集', () => {
    const rows = REAL_ROWS()
    const regions = REAL_REGIONS() as Row[]
    const withBattle = regions.filter((r) => typeof (r.music as Row | undefined)?.battle === 'string')
    expect(rows.length, '真表读不到行').toBeGreaterThan(0)
    expect(withBattle.length, '指了战斗档的区域数 ≠ 区域总数：那一格在 `RegionMusic` 里是必填的')
      .toBe(regions.length)
    expect(errs(rows, regions)).toEqual([])
    // KI-079 那句登记的销账：表建了、读者接了，所以整份判据里不该再有 warn 这一级
    expect(run(rows, regions).filter((f) => f.level === 'warn'), '还剩一句"宪法之外"的登记没销账').toEqual([])
  })

  /**
   * 迁移对账：默认那一档（`mus_shared_battle`）逐格解出来的音，必须与 KI-080 之前写死在
   * `music.ts > OSTINATO` 的那八个数**是同一串音**。
   * 这一条的意义不是"数字好看"，而是把"重构成数据"与"顺手改了声音"分开：
   * 旧那串是按十二平均律四舍五入到两位的抄本，所以比的是**音分**而不是等值（实测最大 0.13 音分）。
   */
  it('默认那一行就是原来那条 ostinato：八个格逐格对上旧常数（差 ≤0.2 音分）', () => {
    const OLD = [65.41, 65.41, 98.0, 155.56, 116.54, 65.41, 77.78, 98.0]
    const row = REAL_ROWS().find((r) => r.id === 'mus_shared_battle')
    expect(row, '表里没有 mus_shared_battle 那一行了').toBeTruthy()
    const cells = (row?.pattern as number[]) ?? []
    expect(cells.length, `默认那一行是 ${cells.length} 格，旧常数是 8 个：迁移对不上账`).toBe(OLD.length)
    let worst = 0
    cells.forEach((c, i) => {
      const cents = Math.abs(1200 * Math.log2(battleOstinatoHz(c) / OLD[i]))
      worst = Math.max(worst, cents)
    })
    expect(worst, `默认那一行走出的音与旧常数最大差 ${worst.toFixed(2)} 音分（这一条承诺的是"没改声音"）`)
      .toBeLessThan(0.2)
    expect(row?.bellEveryBars, '钟的周期也不是 2 小节了 = 这条对账只管低音线，那一半要另说')
      .toBe(2)
  })

  /**
   * 编码与动机的耦合要说清并钉住：`pattern` 那一个格子折的是「动机第几音 × 第几档八度」，
   * 上界 = 动机音数 × 档数 - 1。度数的唯一主人是 `music.ts > MOTIF_R1`，所以这条门不许抄那四个数，
   * 而是**用主人自己的长度**去推 —— 动机增减一个音，这里立刻红，逼着重推那个上界。
   */
  it('八度上界由动机音数与档数推出来：`MAX_PATTERN_CELL + 1 == 动机音数 × 档数`', () => {
    expect(MAX_PATTERN_CELL + 1, '这一格折的是「动机第几音 × 第几档八度」，与 MOTIF_R1 的长度乘档数不等 ⇒ 编码换意思了')
      .toBe(MOTIF_R1.length * PATTERN_OCTAVE_TIERS)
    // 而"抬一档八度"在运行时必须恰好是乘 2（否则上界那句"越界就出了低通"是按半音算的假话）
    for (let c = 0; c < MOTIF_R1.length; c++) {
      expect(battleOstinatoHz(c + MOTIF_R1.length) / battleOstinatoHz(c), `第 ${c} 格抬一档不是八度`)
        .toBeCloseTo(2, 9)
    }
  })
})

describe('战斗档判据的 refuse 侧：逐条臂各红一条，说得出为什么', () => {
  const ARMS: Array<{ name: string; row: Row; at: string; says?: string }> = [
    { name: '写了主音格（§1.1「战斗 = 主音不变」：主音有主人，不在这里）', row: bad({ rootHz: 98.0 }), at: '.rootHz', says: '主音格或速度格' },
    { name: '写了速度格（KI-066 拆的就是战斗层那份 BPM 副本）', row: bad({ bpm: 100 }), at: '.bpm', says: '主音格或速度格' },
    { name: '写了小节数格（同一句话的第三个主人）', row: bad({ beatsPerBar: 3 }), at: '.beatsPerBar', says: '主音格或速度格' },
    { name: '写了鼓型格 kickBeats（五档真数据那一格全同 = 一列没有信息量的数据）', row: bad({ kickBeats: [0, 2] }), at: '.kickBeats' },
    { name: '写了波形格（战斗层的声音形状由合成器那一侧管，不进这张表）', row: bad({ wave: 'sine' }), at: '.wave' },
    { name: '低音线写成空数组（"什么都不排"该写 noMusic，不是留一条空线）', row: bad({ pattern: [] }), at: '.pattern' },
    { name: '低音线根本不成数组', row: bad({ pattern: 'C2' }), at: '.pattern' },
    { name: '一格写成负数', row: bad({ pattern: [-1] }), at: '.pattern[0]' },
    { name: '一格写成小数（没有"半个格子"这种东西）', row: bad({ pattern: [1.5] }), at: '.pattern[0]' },
    { name: '一格越过八度上界（出了 bassLp 那道低通 = 排得出去而听不见）', row: bad({ pattern: [MAX_PATTERN_CELL + 1] }), at: '.pattern[0]' },
  ]
  for (const [i, arm] of ARMS.entries()) {
    it(`臂 ${i + 1}：'${arm.name}' ⇒ 报恰好一条，挂在 ${arm.at} 那一格`, () => {
      const e = errs([arm.row], [reg('mus_a_battle')])
      expect(e.length, `红的不止一条：${e.map((x) => `${x.where} » ${x.msg}`).join(' / ')}`).toBe(1)
      expect(e[0].where, '红在了别处').toBe(`mus_a_battle${arm.at}`)
      expect(e[0].file).toBe('battle.json')
      if (arm.says) expect(e[0].msg, `话术里少了 '${arm.says}' 那一问`).toContain(arm.says)
    })
  }

  it('对照臂：同一行什么都不改 ⇒ 零条（上面十条的红才真的来自被改的那一格）', () => {
    expect(errs([TONAL_OK], [reg('mus_a_battle')])).toEqual([])
  })

  it('无配那一支：`noMusic` 不是显式 true、或顺手多写一格声部参数，各红一条', () => {
    const notTrue = errs([{ id: 'mus_b_battle', noMusic: false }, TONAL_OK], [reg('mus_a_battle'), reg('mus_b_battle')])
    expect(notTrue.length, `noMusic: false 没红（实测 ${notTrue.length} 条）`).toBe(1)
    expect(notTrue[0].where).toBe('mus_b_battle.noMusic')
    for (const k of ['pattern', 'bellEveryBars']) {
      const extra = errs([{ ...SILENT_OK, [k]: k === 'pattern' ? [0] : 2 }, TONAL_OK],
        [reg('mus_a_battle'), reg('mus_b_battle')])
      expect(extra.length, `无配那一支多了 ${k} 却没红（实测 ${extra.length} 条）`).toBe(1)
      expect(extra[0].where, `红在了别处而不是 ${k} 那一格`).toBe(`mus_b_battle.${k}`)
      expect(extra[0].msg).toContain('给一条不存在的声部配参数')
    }
  })

  it('id 重复 / id 缺失 / 行不是对象 / 顶层不是数组：四种结构性脏数据各说各的', () => {
    const dup = errs([TONAL_OK, { ...TONAL_OK }], [reg('mus_a_battle')])
    expect(dup.filter((e) => e.msg.includes('id 重复')).length, '同一档写了两遍必须恰好说一次').toBe(1)
    const blank = errs([{ ...TONAL_OK, id: '' }], [reg('mus_a_battle')])
    expect(blank.some((e) => e.msg.includes('id 缺失或非字符串')), '空字符串 id 没算缺失').toBe(true)
    const notObj = errs([1], [])
    expect(notObj.some((e) => e.msg === '必须是对象'), '一行数字被读成了"没有行"').toBe(true)
    expect(errs(null, []).map((e) => e.msg), '顶层不是数组时那一句话说岔了').toEqual(['顶层必须是数组'])
  })

  it('逐格相同的两行 = 同一张行抄了两遍（要共用就指同一个 id），而且只说一次', () => {
    const e = errs([TONAL_OK, withId('mus_c_battle')], [reg('mus_a_battle'), reg('mus_c_battle')])
    expect(e.length, `实测 ${e.length} 条：${e.map((x) => x.msg).join(' / ')}`).toBe(1)
    expect(e[0].msg).toContain('逐格相同')
    // 只换一格（钟的周期）就不再是同一张行 —— 否则那条门会把"某一格相同"也一起吞掉
    expect(errs([TONAL_OK, withId('mus_c_battle', { bellEveryBars: 4 })],
      [reg('mus_a_battle'), reg('mus_c_battle')]), '只差一格的相邻两行被判成了抄两遍').toEqual([])
  })

  it('双向对账两个方向都红：区域指一张不存在的行、表里留一行没人指', () => {
    const both = errs([TONAL_OK], [{ id: 'rg_x', music: { battle: 'mus_typo_not_in_table' } }])
    expect(both.length, `实测 ${both.length} 条：${both.map((e) => e.msg).join(' / ')}`).toBe(2)
    expect(both.filter((e) => e.msg.includes('指它当战斗曲')).length, '悬空引用那一条没说').toBe(1)
    expect(both.filter((e) => e.msg.includes('没有任何区域指它')).length, '孤儿行那一条没说').toBe(1)
    const orphan = errs([TONAL_OK], [])
    expect(orphan.length, '没人指的那一行没红 = §55 死数据这一半没门').toBe(1)
    expect(orphan[0].where).toBe('mus_a_battle')
  })
})

describe('判据只有一个主人：名单由两支现拼，校验器只是那张嘴', () => {
  /** 源码切片而不是再抄一份：`BATTLE_FIELDS` 的"派生"只能由它自己的声明行说话（比相等证明不了拼法） */
  it('`BATTLE_FIELDS` 的右边引用两支字段表、不含任何字段名字面量', () => {
    const src = readFileSync(new URL('../../scripts/battle-rules.mjs', import.meta.url), 'utf8')
    const decl = /export const BATTLE_FIELDS = (.*)/.exec(src)
    expect(decl, '那一行换了形状：这条判据要跟着换').not.toBeNull()
    const rhs = decl?.[1] ?? ''
    expect(rhs).toContain('BATTLE_TONAL_FIELDS')
    expect(rhs).toContain('BATTLE_SILENT_FIELDS')
    expect(/'id'/.test(rhs), `右边出现了字段名字面量（${rhs}）= 第三份手抄名单又长回来了`).toBe(false)
    expect(BATTLE_FIELDS.length, '拼出来的白名单比两支的并集大/小 = 去重那一步没生效')
      .toBe(new Set([...BATTLE_TONAL_FIELDS, ...BATTLE_SILENT_FIELDS]).size)
    // 两支的差集要说得清：无配那一支只少了这两格，多出来的那一格是它自己的声明
    expect(BATTLE_TONAL_FIELDS.filter((k) => !BATTLE_SILENT_FIELDS.includes(k)).sort(),
      '有配那一支比无配那一支多的格变了：上面那条"多写一格就红"的臂要跟着改').toEqual(['bellEveryBars', 'pattern'])
  })

  it('校验器里既没有第二份判据，也没有把 `bellEveryBars` 的可闻带搬过来', () => {
    const code = readFileSync(new URL('../../scripts/validate-data.mjs', import.meta.url), 'utf8')
      .split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    expect(code, 'validateBattle 不再走这份判据 = 有一条平行实现悄悄长了出来').toContain('battleFindings(')
    for (const gone of ['patternCellOk', 'BATTLE_FIELDS.includes', 'MAX_PATTERN_CELL']) {
      expect(code, `判据 '${gone}' 又被人抄回校验器里了（判据的主人只有一个）`).not.toContain(gone)
    }
    expect(code, 'bellEveryBars 的可闻带不再走 report.num = 那三种说法出现了第二个主人')
      .toContain('.bellEveryBars`, row.bellEveryBars')
  })

  it('词表对账仍然管着这两张字段表（搬走判据不等于搬走门）', () => {
    const code = readFileSync(new URL('../../scripts/validate-data.mjs', import.meta.url), 'utf8')
    for (const where of ['BATTLE_TONAL_FIELDS', 'BATTLE_SILENT_FIELDS']) {
      expect(code, `VOCAB_PAIRS 里少了 '${where}' 这一对：schema 改了字段而名单没人看`).toContain(`where: '${where}'`)
    }
    expect(code, 'battle.json 没进那份 FILES 名单 = 真表根本不过这道门').toContain("'battle.json'")
  })

  /**
   * 这一族是 KI-080 的**本体**：那份八个数的手抄必须从 `music.ts` 里消失，而解析只能住在 `AudioEngine`。
   * 少了这三条，"数据有读者"可以靠悄悄留一份代码里的副本长期假绿（探针不会红，因为副本也在奏）。
   */
  it('音乐层不再自带那份 ostinato 抄本，也不 import 那张表（id→行 的解析只住 AudioEngine）', () => {
    const layer = readFileSync(new URL('../../src/audio/music.ts', import.meta.url), 'utf8')
    const alive = layer.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    expect(alive, '`OSTINATO` 那份常数还在 = 战斗音高又有两个主人').not.toContain('OSTINATO')
    expect(alive, '那串八个数的旧抄本还在（65.41, 65.41, …）').not.toMatch(/65\.41,\s*65\.41/)
    expect(alive, '音乐层 import 了那张表 = 它可以自证（测试喂合成行的意义就没了）').not.toContain('battleScores')
    expect(alive.match(/(?<!function )battleOstinatoHz\(/g) ?? [], '解码点不止一处：主音与步长的主人要被抄进别处')
      .toHaveLength(1)
    const engine = readFileSync(new URL('../../src/audio/AudioEngine.ts', import.meta.url), 'utf8')
    expect(engine, 'AudioEngine 不再读那张表 = 解析这一侧断了，音乐层会永远读不到行').toContain('battleScores')
  })

  it('组合根发的确实是 `music.battle` 那一格，而不是把床或曲的 id 复制粘贴过来', () => {
    const src = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
      .split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    const battle = src.filter((l) => /bus\.emit\('audio\.music\.battle'/.test(l))
    expect(battle.length, `battle 的发射点应有两行（开局 + 换区），实测 ${battle.length}`).toBe(2)
    for (const l of battle) {
      expect(l, '事件名与取的那一格不对齐（复制粘贴漏改就是这个形状）').toContain('music.battle')
    }
  })
})
