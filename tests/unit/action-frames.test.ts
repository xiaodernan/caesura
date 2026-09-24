import { describe, expect, it } from 'vitest'
import { msToTicks } from '@/core/Time'
import { advanceActionFrames, applyActionStop, type ActionStop } from '@/combat/ActionFrames'
import type { FrameData } from '@/data/schema'
import { enemiesRaw, movements, movesetsRaw } from '@/data'

/**
 * §9「冻结攻守双方动画时间」的**攻方**那一半（KI-017 第三步）：出手者自己的招式帧被按住，
 * 之后每 tick 补一帧还回去（回拍补帧）。
 *
 * 这套机制的全部承诺只有一句：**净时长不变**。按住 H 格就要补 H 格，所以 `recovery` 仍然在
 * 与不按停时同一个 tick 到达 ⇒ §2.1 的拍位不动（敌方那一侧由 `tests/flow/boss.test.ts` 那三条
 * 「命中帧落在声明拍」的腿守着：三连的第三击要从上一式的收势那一 tick 起算，收势一旦迟到，
 * 那两格的 50ms 容差立刻红）。这里量的是原语本身，载体是全数据表——不是几条手抄的样例帧表。
 *
 * 每一把尺子都配一条"不按停"的对照腿（`freezeAt: null`），两跑只差那一次 `applyActionStop`，
 * 于是"时长没变"量的是停顿，不是循环本身走了一圈。
 */

type Log = { from: number; adv: number }

/** 从第 0 帧走到 `recovery`；`at` 那些帧各挂一次停顿（null＝对照腿） */
function play(f: FrameData, at: number | number[] | null, ms: number): { ticks: number; log: Log[]; applied: number; debt: number } {
  const a: ActionStop = { tick: 0, stopTicks: 0, stopDebt: 0 }
  const log: Log[] = []
  const points = at === null ? [] : Array.isArray(at) ? [...at] : [at]
  let applied = 0
  let guard = 0
  while (a.tick < f.recovery && guard++ < 5000) {
    while (points.length > 0 && a.tick >= points[0]) { points.shift(); applied += applyActionStop(a, f, ms) }
    const adv = advanceActionFrames(a, f)
    log.push({ from: a.tick, adv })
    a.tick += adv
  }
  expect(guard, '这一式走不到头：帧表本身有问题').toBeLessThan(5000)
  return { ticks: log.length, log, applied, debt: a.stopDebt }
}

/** 全表：武器招式帧 + 敌人招式帧 + 乐章战技帧（§55 里所有会"出手"的东西） */
const CASES: { label: string; f: FrameData }[] = [
  ...movesetsRaw.flatMap((ms) => Object.entries((ms as { actions: Record<string, unknown> }).actions).map(([k, f]) => ({ label: `${ms.id}/${k}`, f: f as FrameData }))),
  ...enemiesRaw.flatMap((e) => (e as { id: string; attacks: { id: string; frames: unknown }[] }).attacks.map((a) => ({ label: `${e.id}/${a.id}`, f: a.frames as FrameData }))),
  ...movements.movements.map((m) => ({ label: `mv/${m.id}`, f: m.frame as unknown as FrameData }))
]

/** 命中可能落在那一式的所有帧上：判定窗内每一帧都试一次 */
const contactFrames = (f: FrameData): number[] => {
  const out: number[] = []
  for (let t = Math.max(0, f.activeStart); t <= f.activeEnd; t++) out.push(t)
  return out
}

describe('§9 攻方那一半：回拍补帧的净时长不变量（全数据表扫描）', () => {
  it('数据表真被扫到了：三类载体都不是空集', () => {
    expect(movesetsRaw.length, '武器招式帧').toBeGreaterThan(0)
    expect(enemiesRaw.reduce((n, e) => n + e.attacks.length, 0), '敌人招式帧').toBeGreaterThan(0)
    expect(movements.movements.length, '乐章战技帧').toBeGreaterThan(0)
    expect(CASES.some((c) => !!c.f.projectile), '表里得有连发弹体招式，否则下面那条豁免是空转').toBe(true)
    expect(CASES.some((c) => !c.f.projectile && c.f.recovery - c.f.activeEnd >= 14), '也得得有收势够长的近战式').toBe(true)
  })

  it('每一式、判定窗内每一帧命中：结束 tick 与对照腿相同，欠的债一定还清', () => {
    let heldTotal = 0
    let capped = 0
    let exempt = 0
    for (const c of CASES) {
      const base = play(c.f, null, 0)
      for (const at of contactFrames(c.f)) {
        const r = play(c.f, at, 120)
        const where = `${c.label} 第 ${at} 帧`
        expect(r.ticks, `${where}：净时长被停顿改写了（收势会离开它声明的拍位）`).toBe(base.ticks)
        const frames = r.log.reduce((n, s) => n + s.adv, 0)
        expect(frames, `${where}：有帧被走过两次或整帧被跳过`).toBe(c.f.recovery)
        expect(r.debt, `${where}：走到收势还有债没还 ⇒ 这一式会迟到`).toBe(0)
        const holds = r.log.filter((s) => s.adv === 0).length
        const repay = r.log.filter((s) => s.adv === 2).length
        expect(holds, `${where}：按住几格就要补几格`).toBe(repay)
        expect(r.applied, `${where}：按住的格数不可能超过表里那格报的格数`).toBeLessThanOrEqual(msToTicks(120))
        if (r.applied > 0) heldTotal++
        if (!c.f.projectile && r.applied > 0 && r.applied < msToTicks(120)) capped++
        if (c.f.projectile) {
          exempt++
          expect(r.applied, `${where}：带连发拍位的弹体招式整式豁免，一次都不该按`).toBe(0)
          expect(r.log, `${where}：豁免那一式必须与对照腿逐 tick 全等`).toEqual(base.log)
        }
      }
    }
    expect(heldTotal, '全表一次都没按停过 ⇒ 上面全是空转').toBeGreaterThan(0)
    expect(capped, '没有任何一式被剩余帧数封顶过 ⇒ 那条判据没被测到').toBeGreaterThan(0)
    expect(exempt, '弹体豁免那条腿没扫到任何一式').toBeGreaterThan(0)
  })

  it('一式之内两次接触（多目标 / 起手式追加）叠不出第二个额度：净时长仍然不变', () => {
    let stacked = 0
    for (const c of CASES) {
      const base = play(c.f, null, 0)
      const r = play(c.f, [c.f.activeStart, c.f.activeEnd], 120)
      const holds = r.log.filter((s) => s.adv === 0).length
      const repay = r.log.filter((s) => s.adv === 2).length
      expect(r.ticks, `${c.label}：两次接触之后收势迟到了`).toBe(base.ticks)
      expect(r.debt, `${c.label}：两次接触之后还有债没还`).toBe(0)
      expect(holds, `${c.label}：按住几格就要补几格`).toBe(repay)
      expect(r.applied, `${c.label}：第二笔把总额叠过了 120ms 那一格`).toBeLessThanOrEqual(msToTicks(120))
      if (holds > 0) stacked++
    }
    expect(stacked, '两次接触的腿一次也没按停过 ⇒ 全在空转').toBeGreaterThan(0)
  })

  it('停顿整段落在判定窗之外：窗在世界时间里一格不多一格不少', () => {
    // 这一条量的是 §2.1 的红线。第一版把停顿按在窗内，收势照样对得上拍（上面那条腿是绿的），
    // 而 boss/mainboss/phantome 的复测全红——因为迟到的是**窗尾**：按住几格，可命中段就长几格。
    // 净时长不变不够，还得"危险段长度不变"，所以窗内既不许补帧也不许按住。
    for (const c of CASES) {
      for (const at of contactFrames(c.f)) {
        const r = play(c.f, at, 120)
        const span = r.log.filter((s) => s.from >= c.f.activeStart && s.from <= c.f.activeEnd)
        expect(span.length, `${c.label} 第 ${at} 帧：判定窗被停顿拉长或压缩`).toBe(c.f.activeEnd - c.f.activeStart + 1)
        for (const s of span) {
          expect(s.adv, `${c.label} 第 ${at} 帧：窗内出现了停顿或补帧`).toBe(1)
        }
        for (const s of r.log) {
          if (s.adv === 0 || s.adv === 2) {
            expect(s.from, `${c.label} 第 ${at} 帧：窗尾之后才准兑现停顿`).toBeGreaterThan(c.f.activeEnd)
          }
        }
      }
    }
  })
})

describe('§9 攻方那一半：能不能按，由三条判据给', () => {
  /** 一把合成尺子：窗 10..14、收势 40 ⇒ 120ms（7 tick）吃得下 */
  const F = (over: Partial<FrameData> = {}): FrameData => ({
    startup: 8, activeStart: 10, activeEnd: 14, recovery: 40,
    damage: 0, stamina: 0, poise: 0, hitStopMs: 0, ...over
  })
  const fresh = (tick: number): ActionStop => ({ tick, stopTicks: 0, stopDebt: 0 })

  it('判定窗外不按：那一记已经不是"正在出手"的了', () => {
    for (const tick of [0, 8, 9, 15, 24, 39]) {
      const a = fresh(tick)
      expect(applyActionStop(a, F(), 120), `第 ${tick} 帧还在窗外`).toBe(0)
      expect(a.stopTicks, '窗外也不许留下半个计数器').toBe(0)
    }
    expect(applyActionStop(fresh(10), F(), 120), '窗内第一帧就该按得住').toBeGreaterThan(0)
  })

  it('弹体招式整式不按：burst.at 住在窗内，补帧会把两发挤进同一 tick', () => {
    const a = fresh(10)
    expect(applyActionStop(a, F({ projectile: { kind: 'note', speed: 8, range: 10, radius: 0.6 } }), 120)).toBe(0)
  })

  it('表里没写停顿（0ms）就不按：停顿不自己发明时长', () => {
    expect(applyActionStop(fresh(10), F(), 0)).toBe(0)
    expect(applyActionStop(fresh(10), F(), 8)).toBe(0) // msToTicks(8)=0，不到半格
  })

  it('还不起债就不按：窗尾之后剩几帧，就只按得住几帧的一半', () => {
    // 最早能停的那一格是 activeEnd 的下一格，所以配额按 `recovery − (activeEnd + 1)` 算，
    // 不按接触那一帧算——窗内的剩余帧数装不下停顿（那正是上面那条"窗长不变"腿要挡的事）。
    expect(applyActionStop(fresh(12), F({ activeStart: 12, activeEnd: 18, recovery: 21 }), 120), '窗尾后剩 2 帧 ⇒ 只按得住 1 格').toBe(1)
    expect(applyActionStop(fresh(12), F({ activeStart: 12, activeEnd: 18, recovery: 20 }), 120), '窗尾后只剩 1 帧 ⇒ 补不回来 ⇒ 整格不按').toBe(0)
    expect(applyActionStop(fresh(14), F({ activeStart: 12, activeEnd: 14, recovery: 15 }), 120), '错拍步那一类：收势比窗只晚 1 帧 ⇒ 一帧都不按').toBe(0)
  })

  it('同一式里第二次接触只抬到这一格的额度：不叠加', () => {
    const a = fresh(10)
    expect(applyActionStop(a, F(), 120), '120ms = 7 tick，而窗尾到收势还有 25 帧 ⇒ 吃得满').toBe(7)
    expect(applyActionStop(a, F(), 120), '同一格停顿不叠加').toBe(0)
    const near = F({ activeStart: 30, activeEnd: 34, recovery: 40 })
    const late = fresh(34)
    expect(applyActionStop(late, near, 120), '收势前才接触：只剩 floor((40-35)/2)=2 格').toBe(2)
    expect(applyActionStop(late, near, 45), '第二笔要 3 格，而总额已是 2 ⇒ 不再抬').toBe(0)
  })
})
