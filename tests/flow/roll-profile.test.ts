import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GameTime, TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import type { Input } from '@/core/Input'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { stripComments } from '../../scripts/schema-vocab.mjs'

/**
 * combat.md §5.5「翻滚 Roll 与侧步 Sidestep」那张表里，玩家这一侧的四格今天第一次有读者（KI-090）。
 *
 * 开工前的实测读数（`grep -rn "backDist|lockOnDist|lockOnStamina" src/` 只有 schema 那一行与
 * validator 的名单两处）：锁定侧步走的是**自由翻滚**那条腿的全部数字——3.2m、14 点体力，时长则是
 * 硬编码的 `locked ? 18`；后向那一格的 2.6m 没人读。于是表里的 18f / 1.6m / 10 点 / 2.6m 四格是
 * 四个"写着但没人执行"的数。本文件量三层：
 *  ① **表 ⇄ 数据**：`player.json > roll` 的每一格与 §5.5 那两行**从文档现推**（正则抓格，不抄数）；
 *  ② **数据 ⇄ 行为**：一次翻滚真的按自己那一行走——走多远、几拍结束、第几拍到第几拍免伤、扣几点体力；
 *  ③ **只有一个主人**：控制器里不许再出现第二份 18、第二份体力读数（四条腿都走 `rollProfile`/`rollDist`）。
 *
 * 两处口径要先说清，否则读用例的人会以为量具在骗人：
 * - **体力价不能拿两次读数相减**：`stats.update` 在同一拍里就按 `fastPerSec` 回了 0.633 点（38/60），
 *   所以本文件挂在 `spendStamina` 上看"这一滚扣的是哪一格的数"，而不是事后算差值；
 * - 翻滚期间普通移动被 `busyMovementLocked()` 整段锁住 ⇒ 水平位移就是这一滚的位移本身；起手那一拍
 *   就走出第一格（输入段在推进段之前），`runRoll` 因此数到 `roll === null` 为止而不猜格数。
 */

registerGameData()

const root = fileURLToPath(new URL('../..', import.meta.url))

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_drawpin_spear')
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  player.yaw = Math.PI // 朝世界 -Z；与 `f.lunge` 的 `+sin/+cos` 朝向约定一致
  // 扣费的实际读数：这一滚扣的是哪一格的数，在 `spendStamina` 的实参里现采（事后相减会被同拍回复污染，见文件头）
  const costs: number[] = []
  const spend = player.stats.spendStamina.bind(player.stats)
  player.stats.spendStamina = (amount: number, t: number): boolean => {
    costs.push(amount)
    return spend(amount, t)
  }
  return { time, rhythm, player, frame, costs, input }
}

type World = ReturnType<typeof makeWorld>

/** 起步一拍的翻滚推进：`w.tick()` 走一格（起手那拍也算一格） */
function tick(w: World, n = 1): void {
  for (let i = 0; i < n; i++) {
    w.time.tick++
    w.player.update(TICK_DT, w.time, w.input, w.time.tick, w.rhythm)
    w.frame.edges.clear()
    w.rhythm.update(TICK_DT)
  }
}

/** 按下翻滚键的那一拍（方向由 `dir` 给：y=+1 是朝 facing，y=-1 是背对） */
function pressDodge(w: World, dir: { x: number; y: number }): void {
  w.frame.move = dir
  w.frame.edges.add('dodge')
  tick(w)
  w.frame.move = { x: 0, y: 0 }
}

/**
 * 一次翻滚的实测结果。`cost` 从 `spendStamina` 的实参见（不是两次体力读数相减），
 * `total/iframe*` 是这一滚自己身上那一份（起手时快照，之后不重读表）。
 */
function runRoll(w: World, dir: { x: number; y: number }): { travel: number; dx: number; dz: number; cost: number; total: number; iframeStart: number; iframeEnd: number } {
  const before = { x: w.player.pos.x, z: w.player.pos.z }
  pressDodge(w, dir)
  const r = w.player.roll
  expect(r, '翻滚没起来：这一腿连载体都没有（体力够不够、是不是超载、能不能动）').not.toBeNull()
  expect(w.costs, '扣费没发生 ⇒ 门槛与扣费不同源').toHaveLength(1)
  const { total, iframeStart, iframeEnd } = r!
  for (let t = 0; t < 90 && w.player.roll; t++) tick(w)
  return {
    travel: Math.hypot(w.player.pos.x - before.x, w.player.pos.z - before.z),
    dx: w.player.pos.x - before.x,
    dz: w.player.pos.z - before.z,
    cost: w.costs[0],
    total,
    iframeStart,
    iframeEnd
  }
}

/** 锁定这一路走的是 shipped 那一个写方写的形状（`LockOn.ts` 给的就是 `{ getPos, radius }`） */
function lock(w: World, at = { x: 0, y: 0, z: -3 }): void {
  w.player.lockedTarget = { getPos: () => at, radius: 0.6 }
}

/** 从表的一格里按正则抓一个数：抓不到就红，不许让"正则哑了"冒充"没有漂移" */
function grab(text: string, re: RegExp, where: string): string {
  const m = re.exec(text)
  expect(m, `${where}：「${text}」用 ${re} 读不出内容 ⇒ 表被改写而这条对账瞎了（先把写法对上，不要改断言迁就它）`).toBeTruthy()
  return m![1]
}

/** §5.5 那一行按竖线拆成六格（去掉首尾的空串） */
function docRow(label: string): string[] {
  const line = readFileSync(root + 'docs/combat.md', 'utf8').split('\n').find((l) => l.startsWith(`| ${label} |`))
  expect(line, `combat.md 里找不到「${label}」那一行：那张表是本批数字的唯一主人，它被改名或删掉时这条红要说清`).toBeTruthy()
  const cells = line!.split('|').slice(1, -1).map((c) => c.trim())
  expect(cells, '§5.5 的表是六列（动作/总时长/无敌帧/位移/体力/恢复锁）；列数变了就说明上面的列号全部失效').toHaveLength(6)
  return cells
}

describe('§5.5 表 ⇄ player.json：文档是主人，数据表是它的抄本', () => {
  it('两行的时长 / 免伤窗 / 位移 / 体力逐格与文档相同（四格各有主人）', () => {
    const free = docRow('前/侧/后翻滚')
    const side = docRow('锁定侧步')
    const r = playerBase.roll
    expect(Number(grab(free[1], /(\d+)f/, '第一行「总时长」')), '500ms/30f ⇒ roll.total').toBe(r.total)
    expect([Number(grab(free[2], /（(\d+)-\d+f/, '第一行「无敌帧」起')), Number(grab(free[2], /（\d+-(\d+)f/, '第一行「无敌帧」止'))],
      'Active 段 150-350ms（9-21f） ⇒ roll.iframeStart..iframeEnd')
      .toEqual([r.iframeStart, r.iframeEnd])
    expect(Number(grab(free[3], /^([\d.]+)m/, '第一行「位移」')), '3.2m ⇒ roll.dist').toBe(r.dist)
    expect(Number(grab(free[3], /后向 ([\d.]+)m/, '第一行「位移」的括注')), '（后向 2.6m） ⇒ roll.backDist').toBe(r.backDist)
    expect(Number(grab(free[4], /^(\d+)$/, '第一行「体力」')), '14 ⇒ roll.stamina').toBe(r.stamina)
    expect(Number(grab(side[1], /(\d+)f/, '第二行「总时长」')), '300ms/18f ⇒ roll.lockOnTotal（KI-090 新入表的那一格）').toBe(r.lockOnTotal)
    expect([Number(grab(side[2], /（(\d+)-\d+f/, '第二行「无敌帧」起')), Number(grab(side[2], /（\d+-(\d+)f/, '第二行「无敌帧」止'))],
      '100-267ms（4-16f） ⇒ roll.lockOnIframes')
      .toEqual([...r.lockOnIframes])
    expect(Number(grab(side[3], /^([\d.]+)m/, '第二行「位移」')), '1.6m ⇒ roll.lockOnDist').toBe(r.lockOnDist)
    expect(Number(grab(side[4], /^(\d+)$/, '第二行「体力」')), '10 ⇒ roll.lockOnStamina（KI-090 新入表的那一格）').toBe(r.lockOnStamina)
  })

  it('「恢复锁」那一列不参与对账：它今天没有载体，而表里第二行的两个数自相矛盾', () => {
    const free = docRow('前/侧/后翻滚')
    const side = docRow('锁定侧步')
    const r = playerBase.roll
    expect(Number(grab(free[5], /(\d+)f/, '第一行「恢复锁」')), '第一行写 150ms/9f，而 30-21 恰好等于 9 ⇒ 那一格是**推得出来**的，不是独立读数')
      .toBe(r.total - r.iframeEnd)
    expect(Number(grab(side[5], /(\d+)f/, '第二行「恢复锁」')), '第二行写 6f，可 18-16=2 ⇒ 同一列两种口径，实现哪一头都会撞车（裁决与登记见 KNOWN_ISSUES KI-090 没做①）')
      .not.toBe(r.lockOnTotal - r.lockOnIframes[1])
    expect(r, '数据表里没有 `lockOnRecovery` 这一格：没有裁决就没有载体（§55）').not.toHaveProperty('lockOnRecovery')
  })
})

describe('§5.5 表 ⇄ 玩家真的怎么走', () => {
  it('自由翻滚：走满第一行那 3.2m、30 拍结束、窗是第 9..21 拍、扣 14 点', () => {
    const w = makeWorld()
    const m = runRoll(w, { x: 0, y: 1 }) // 朝世界 -Z = 朝她的 facing = 前向
    expect(m.travel, '位移 = §5.5 第一行的 3.2m').toBeCloseTo(playerBase.roll.dist, 4)
    expect(m.total, '时长 = 30 拍').toBe(playerBase.roll.total)
    expect([m.iframeStart, m.iframeEnd], '免伤窗 = 第一行那两格').toEqual([playerBase.roll.iframeStart, playerBase.roll.iframeEnd])
    expect(m.cost, '体力价 = 第一行那 14 点').toBe(playerBase.roll.stamina)
    expect(w.player.roll, '这一滚自然结束（不是被打断）').toBeNull()
  })

  it('后向翻滚走括注里那 2.6m：`backDist` 从死字段变成读数', () => {
    const w = makeWorld()
    const m = runRoll(w, { x: 0, y: -1 }) // 与 facing 相反
    expect(m.travel, '后向 = 第一行括注的 2.6m，不是 3.2m').toBeCloseTo(playerBase.roll.backDist, 4)
    expect(m.travel, '而且真的**短于**前向那一格（把 backDist 抄成 dist 就是这里红）').toBeLessThan(playerBase.roll.dist)
    expect(m.cost, '表里没有"后向单独个体力价"这一格 ⇒ 价钱照旧 14，只有位移变短').toBe(playerBase.roll.stamina)
    expect(m.total, '时长同理：那一行只给位移加了一个括注').toBe(playerBase.roll.total)
  })

  /**
   * 斜向那一滚是变异探针逼出来的：把推进段的 **x 项**从 `this.roll.dist` 改成表里的 `dist`，
   * 前面几条用例一条都不红——因为它们全沿 z 打（`dir.x === 0`，乘什么都是 0）。
   * 所以这里必须逐分量量，而且量的是**后向斜滚**（那一格 2.6m 与表里的 3.2m 不同，混读才会露出来）。
   */
  it('斜向翻滚：位移按 dir 的两个分量各自走，短的那一格不只长在 z 轴上', () => {
    const d = Math.SQRT1_2
    const w = makeWorld()
    const fwd = runRoll(w, { x: 1, y: 1 }) // camYawRef=0 ⇒ dir = (+d, 0, -d)：与 facing 同侧，走 3.2m
    expect(Math.abs(fwd.dx), '前斜：x 分量真的走出了一格（把 x 项写成 0 就是这里红）').toBeCloseTo(playerBase.roll.dist * d, 4)
    expect(Math.abs(fwd.dz), '前斜：z 分量与它等长').toBeCloseTo(playerBase.roll.dist * d, 4)
    expect(fwd.travel, '合起来还是那一行的 3.2m ⇒ 斜向不比正向多走路').toBeCloseTo(playerBase.roll.dist, 4)

    const w2 = makeWorld()
    const back = runRoll(w2, { x: 1, y: -1 }) // dir = (+d, 0, +d)：背对 facing ⇒ 两个分量都按 2.6m 分
    expect(Math.abs(back.dx), '后斜：x 分量读的是**这一滚身上**那 2.6m 的一份（x 项偷读表里的 3.2m 就红在这里）')
      .toBeCloseTo(playerBase.roll.backDist * d, 4)
    expect(Math.abs(back.dz), '后斜：z 分量同理').toBeCloseTo(playerBase.roll.backDist * d, 4)
    expect(back.travel, '后斜合起来 2.6m：短的是整格，不是只短在某个轴上').toBeCloseTo(playerBase.roll.backDist, 4)
  })

  it('锁定侧步：第二行整行替代第一行——1.6m、18 拍、窗 4..16、扣 10 点', () => {
    const w = makeWorld()
    lock(w)
    const m = runRoll(w, { x: 0, y: 1 })
    expect(m.total, '300ms/18f ⇒ 硬编码那个 18 现在读的是 roll.lockOnTotal').toBe(playerBase.roll.lockOnTotal)
    expect([m.iframeStart, m.iframeEnd], '免伤窗 = roll.lockOnIframes').toEqual([...playerBase.roll.lockOnIframes])
    expect(m.travel, '1.6m 切线 ⇒ roll.lockOnDist 的读者（此前这一格走的是 3.2m）').toBeCloseTo(playerBase.roll.lockOnDist, 4)
    expect(m.cost, '10 点 ⇒ roll.lockOnStamina 的读者（此前这一滚扣的是 14）').toBe(playerBase.roll.lockOnStamina)
    expect(m.iframeEnd, '窗必须住在自己那一行的时长里（validator 的序关系现在也按 lockOnTotal 比）').toBeLessThanOrEqual(m.total)
  })

  it('锁定时的位移一律是那一行的 1.6m：表里没有「锁定 + 后向」第五格，就不发明', () => {
    const w = makeWorld()
    lock(w)
    const fwd = runRoll(w, { x: 0, y: 1 })
    const w2 = makeWorld()
    lock(w2)
    const back = runRoll(w2, { x: 0, y: -1 })
    expect(back.travel, '后向输入在锁定下不换成 2.6m（那一格属于第一行）').toBeCloseTo(playerBase.roll.lockOnDist, 4)
    expect(back.travel, '也与前向那一滚同长：锁定这一行不看输入方向').toBe(fwd.travel)
    expect(back.total, '时长同理：第二行整行替代').toBe(fwd.total)
  })

  /**
   * 门槛的两端：13 点时"侧步起得来 / 自由翻滚起不来"，15 点时两边都起得来。
   * 判据只看"这一滚起没起"（`roll` 在不在），不看体力读数——同拍回复会污染差值。
   */
  it('两条门槛各读自己那一格：13 点滚得出侧步、滚不出自由翻滚', () => {
    const cheap = playerBase.roll.lockOnStamina
    const dear = playerBase.roll.stamina
    expect(cheap, '前提：这一行的价确实低于那一行（否则下面的对照测的是别的东西）').toBeLessThan(dear)
    const between = dear - 1 // 13：够侧步、不够自由翻滚
    for (const locked of [true, false]) {
      const w = makeWorld()
      w.player.stats.stamina = between
      if (locked) lock(w)
      pressDodge(w, { x: 0, y: 1 })
      expect(w.player.roll !== null, `${between} 点 + ${locked ? '锁定侧步（要 ' + cheap + '）' : '自由翻滚（要 ' + dear + '）'}`)
        .toBe(locked)
      if (!locked) expect(w.costs, '被拒的一滚一分也不扣').toHaveLength(0)
    }
  })

  it('门槛恰好在自己那一格的价上：10 点起得来侧步、9 点起不来；14 点起得来自由翻滚、13 点起不来', () => {
    const table: Array<{ stamina: number; locked: boolean; starts: boolean }> = [
      { stamina: playerBase.roll.lockOnStamina, locked: true, starts: true },
      { stamina: playerBase.roll.lockOnStamina - 1, locked: true, starts: false },
      { stamina: playerBase.roll.stamina, locked: false, starts: true },
      { stamina: playerBase.roll.stamina - 1, locked: false, starts: false }
    ]
    for (const c of table) {
      const w = makeWorld()
      w.player.stats.stamina = c.stamina
      if (c.locked) lock(w)
      pressDodge(w, { x: 0, y: 1 })
      expect(w.player.roll !== null, `${c.locked ? '侧步' : '自由翻滚'} 在 ${c.stamina} 点时${c.starts ? '该起得来' : '该起不来'}`)
        .toBe(c.starts)
      expect(w.costs.length, '起不来就不许扣费（拒判与扣费读的是同一个数）')
        .toBe(c.starts ? 1 : 0)
    }
  })
})

describe('接线：这些数字只许有一处主人', () => {
  // 注释里会写"此前是 `locked ? 18`"这类**历史**措辞；形状判据必须剥掉注释再读，否则我自己的说明会把它坐实
  const src = stripComments(readFileSync(root + 'src/player/ThirdPersonController.ts', 'utf8'))
  const schema = stripComments(readFileSync(root + 'src/data/schema.ts', 'utf8'))
  const validator = stripComments(readFileSync(root + 'scripts/validate-data.mjs', 'utf8'))

  it('表里的五格各自都要有读者：谁再躺平就红哪一格', () => {
    for (const f of ['lockOnTotal', 'lockOnStamina', 'lockOnIframes', 'lockOnDist', 'backDist']) {
      expect(src, `player.json > roll.${f} 在控制器里没有任何读者 ⇒ §5.5 那一格又是"写着没人执行"（KI-047 那一族）`)
        .toContain(f)
    }
  })

  it('时长与体力价不再由控制器自己数：硬编码的 18 与第二份读数都没了', () => {
    expect(src, '侧步的时长此前硬编码在 startRoll ⇒ 表里改这一格没人会察觉。这里禁的是**任何**数字而不是当年那一个 18：探针臂③先写 `locked ? 18` 被抓到，换成 `locked ? 20` 就从字面判据底下滑走了（臂③的那一笔因此改成收紧这条判据）')
      .not.toMatch(/locked\s*\?\s*\d/)
    expect(src, '两处门槛此前直接读自由翻滚那一格（14），侧步因此被按 14 收费')
      .not.toMatch(/this\.stats\.stamina >= this\.base\.roll\.stamina/)
    expect(src, '时长只许 rollProfile 自己读一次（别处再出现 `this.base.roll.total` 就是第二份读数）')
      .not.toMatch(/this\.base\.roll\.total/)
    expect(src.match(/this\.rollProfile\([^)]*\)\.stamina/g) ?? [], '处决取消窗那条 + dodge 那条 = 两处门槛，都走同一个读法')
      .toHaveLength(2)
    expect(src, '扣费走起手那份 profile（与门槛同一个数）').toMatch(/const p = this\.rollProfile\(locked\)[\s\S]{0,240}this\.stats\.spendStamina\(p\.stamina, tick\)/)
  })

  it('位移走这一滚自己快照的那一格：每 tick 不再重读表', () => {
    expect(src, '推进段读 `this.roll.dist` ⇒ 朝向中途被 faceTowards 改动也不会把 2.6m 滚成 3.2m').toMatch(/this\.roll\.dir\.x \* this\.roll\.dist/)
    expect(src, '起手时快照一次').toMatch(/dist: this\.rollDist\(dir, locked\)/)
    expect(src.match(/this\.base\.roll\.dist\b/g) ?? [], '表里那一格只许 rollDist 自己读一次').toHaveLength(1)
  })

  it('roll 的字段名单：schema 声明的每一格，validator 都要读到（缺一格 = 那一格可以缺失或写错类型而门禁照绿）', () => {
    const declared = topLevelKeys(schema, /\n {2}roll: \{[^{}]*\}/, 'schema.ts > PlayerBaseData.roll').sort()
    // validator 读 roll 有两处：shape 名单（逐格的类型与区间）与下面的序关系块（解构出来的那几格）
    const shape = topLevelKeys(validator, /report\.sub\(file, 'roll', p\.roll, \{(?:[^{}]|\{[^{}]*\})*\}/, 'validate-data.mjs 的 roll shape 名单').sort()
    const m = /if \(isObj\(p\.roll\)\) \{\s*const \{([^}]*)\} = p\.roll/.exec(validator)
    expect(m, 'validate-data.mjs 的 roll 序关系块读不到 ⇒ 那一块的判据（窗要住在自己那一行的时长里）没人在对账').toBeTruthy()
    const ordering = m![1].split(',').map((s) => s.trim()).filter(Boolean).sort()
    const covered = [...new Set([...shape, ...ordering])].sort()
    expect(declared, 'roll 的声明名单要包含 KI-090 接上的那四格（否则下面比的是两份残缺集合）')
      .toEqual(expect.arrayContaining(['lockOnTotal', 'lockOnStamina', 'lockOnDist', 'backDist']))
    expect(covered, 'schema 长了一格而 validator 两处都不读它 = 那一格没有门禁；validator 读了一格而 schema 没声明 = 名单在管一个不存在的字段')
      .toEqual(declared)
  })

  it('锁定这一路的形状是 shipped 写方写的那个：`LockOn` 给的是 { getPos, radius }', () => {
    const lockSrc = stripComments(readFileSync(root + 'src/player/LockOn.ts', 'utf8'))
    expect(lockSrc, '用例喂的 stub 必须与真实写方同形，否则"锁定"这条腿测的是我的假对象')
      .toMatch(/lockedTarget = t \? \{ getPos:[^}]*radius: [\d.]+ \}/)
    expect(src, '控制器只问"锁没锁"，锁定与自由的分别全在 rollProfile/rollDist 里').toMatch(/const locked = this\.lockedTarget !== null/)
  })
})

/**
 * 抓出一段对象字面量里的**顶层**键名（只按花括号的深度算，括号与方括号不参与）。
 * 深度过滤不是洁癖：`{ total: { min: 0, int: true } }` 里 `min/int` 也是 `xxx:` 形状，
 * 不过滤就会把校验器自己的区间参数当成字段名单，两条对账各比各的空集。
 */
function topLevelKeys(text: string, re: RegExp, where: string): string[] {
  const m = re.exec(text)
  expect(m, `${where} 读不到 ⇒ 这一腿的两侧有一侧改了写法，对账本身瞎了（先把写法对上，别改名单）`).toBeTruthy()
  const body = m![0]
  const out: string[] = []
  let depth = 0
  const id = /([A-Za-z][A-Za-z0-9]*)\s*:/y
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '{') depth++
    else if (ch === '}') depth--
    else if (depth === 1 && /[A-Za-z]/.test(ch)) {
      id.lastIndex = i
      const hit = id.exec(body)
      if (hit && hit.index === i) {
        out.push(hit[1])
        i += hit[0].length - 1
      }
    }
  }
  return [...new Set(out)]
}
