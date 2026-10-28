import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, ProgressionData, WeaponData } from '@/data/schema'
import { RpgRuntime } from '@/rpg/Runtime'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import type { Projectile } from '@/combat/Projectiles'

/**
 * KI-328：§8.2 那条 rank12 里程碑（`ms_bow_split`「满弓分叉 2→3（若用弓）；处决伤害 +5%」）
 * 的**两条腿第一次在真链上被读数**。
 *
 * **此前量到哪一步了**：①`tests/flow/milestone-grants.test.ts:113` 那条只量到 **derive 级比值**
 * （rank12 的 `execMul` ÷ rank11 ＝ 1.05）——**处决那一记打在敌人身上的伤害，从来没有人量过**；
 * ②`tests/flow/overtone-bow.test.ts:115` 那条是**手写** `w.player.rpg.bowForkBranches = 1`
 * ——它证明的是"那个字段接到弹体上是通的"，**没有证明**「表 → `Progression.derive` → `PlayerMods`
 * → `CombatManager`」这一整条链在 rank12 真的会自己送上来。
 * 换句话说：KI-145 那一行写的「两条承诺都有真腿」，量的是**两截**，不是**一整条**。
 *
 * **本文件的读法**：真链 ＝ 这一整条——`progression.json` 的里程碑行 → `Progression.derive`
 * → `RpgRuntime.mods()` → `player.applyRpg()` → `CombatManager` 出手 → `combat.hit` 事件的
 * `damage`。**不抄表、不抄常数**：那一记的伤害是打出来的。
 *
 * **量具纪律**：① **抖动钉死**（伤害里那项 `rand(0.95,1.05)` ⇒ 把 `CombatManager` 的随机源换成恒 0.5）；
 * ② **每格有对照组**（rank11 与 rank12 同武器、同属性、同目标、同破势路径）；
 * ③ **每次读数换新靶子**（震裂层数是**乘在暴击之后**的 ⇒ 串味会把倍率那一格算歪）；
 * ④ **腿里手钉的是真读数**（读表的话表一改腿也跟着改 ⇒ 那一格就没人守了）；设计那一行与真读数
 * 对不上时，**腿钉住真读数、把差额写进消息** ⇒ 只量不裁（设计没裁，不许在测试里替设计做决定）。
 */

registerGameData()

type Hit = { attackerId: string; victimId: string; damage: number; poiseDamage: number; result: string; kind: string }
type World = ReturnType<typeof makeWorld>

function makeWorld(weaponId: string, rpgRank: number, attrPatch?: Partial<Record<'str' | 'dex' | 'ton' | 'vig' | 'ovr' | 'fis', number>>) {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>(weaponId)
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  player.yaw = 0 // 面向 +Z：弹道方向就是 { sin(0), cos(0) }
  const rpg = new RpgRuntime('origin_tuner')
  rpg.prog.rank = rpgRank
  if (attrPatch) Object.assign(rpg.prog.attrs, attrPatch)
  player.applyRpg(rpg.mods())
  const hits: Hit[] = []
  const off = bus.on('combat.hit', (p) => { hits.push(p as unknown as Hit) })

  /** withAi=false：冻住 AI（敌人不走路不还手），让"打了几记、每记多少"可复现 */
  function tick(n = 1, withAi = false): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.update(TICK_DT, time, input, time.tick, rhythm)
      if (withAi) ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input, TICK_DT)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, rhythm, player, ai, combat, frame, tick, hits, off, rpg }
}

/** 蓄满再松手 ⇒ 走 charged 那一式（逐武器阈值：弓 48f、杖 54f；统一按 60 拍留余量，KI-117②） */
function chargeShot(w: World): void {
  w.frame.held.add('attackHeavy')
  w.tick(60)
  w.frame.held.delete('attackHeavy')
  w.tick(1)
}

/** 快按一下重击（chargeTicks < 8）⇒ 走 h 那一式 */
function tapHeavy(w: World): void {
  w.frame.held.add('attackHeavy')
  w.tick(1)
  w.frame.held.delete('attackHeavy')
  w.tick(1)
}

/**
 * 把这一轮真的出了几发弹体按出手顺序收回来。
 * **拍数要够**：弓的重击起手 36 帧（`ms_bow.h.activeStart` ＝ 36）⇒ 收 30 拍会一发都没出手
 * （那是量具不够，不是那一式不发弹）⇒ 60 拍覆盖全部六式。
 */
function collect(w: World, ticks = 60): Projectile[] {
  const seen: Projectile[] = []
  for (let t = 0; t < ticks; t++) {
    w.tick()
    for (const p of w.combat.projectiles.list()) if (!seen.includes(p)) seen.push(p)
  }
  return seen
}

const yawOf = (p: Projectile): number => Math.atan2(p.vel.x, p.vel.z)
const DEG = Math.PI / 180

/** 表上那条里程碑行（改表法要拿它当锚点） */
const msBowSplit = (): NonNullable<ReturnType<ProgressionData['milestones']['find']>> =>
  registry.get<ProgressionData>('progression').milestones.find((m) => m.id === 'ms_bow_split')!

describe('§8.2 rank12 里程碑的两条腿：真链读数（KI-328）', () => {
  it('腿① 处决那一记：rank11 ＝ 37、rank12 ＝ 39（「处决伤害 +5%」兑现到伤害上）', () => {
    // 破势走真链：直剑重击的架势伤害 24 ≥ en_murkshell 的 20 ⇒ 打崩它，不是直接写状态。
    // **取哪一记**：破势用的那一记近战也是 `kind: 'heavy'` ⇒ 只有"按处决键之后"的那一记才是处决。
    // **两个量具上的钉子**（少一个，那一格就会随机地红）：
    // ① 敌人的朝向在**生成时是随机的**（`Enemy.ts:213`：`this.yaw = this.rng.float(0, 2π)`）
    //    ⇒ 破势那一记有 1/3 的概率被算成**背刺**（×2.0）⇒ 30 伤变 61 伤 ⇒ 45 血的靶子当场死
    //    ⇒ 靶子一死就没有处决候选 ⇒ 那一格随机红。显式把朝向摆成**面对玩家**（yaw ＝ π）。
    // ② 抖动钉死（`CombatManager` 的随机源换成恒 0.5）⇒ 不暴击、浮动项恰为 1.0。
    const shoot = (rank: number): { dmg: number; execMul: number } => {
      const w = makeWorld('wp_tuning_sword', rank)
      w.combat.rng.float = () => 0.5
      const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: 1.5 }, 'exec')
      e.yaw = Math.PI // 面对玩家（它在 +z、玩家在原点 ⇒ 朝向 -z）⇒ 破势那一记是正面，不是背刺
      tapHeavy(w)
      for (let i = 0; i < 120 && w.player.busy; i++) w.tick(1)
      expect(e.stats.crumpleTicksLeft, '直剑重击真的把它打崩了（poise 24 ≥ 20）').toBeGreaterThan(0)
      const before = w.hits.length
      w.frame.edges.add('interact')
      w.tick(1)
      const hit = w.hits.slice(before).find((h) => h.victimId === e.id)
      expect(hit, '按处决键之后落地的那一记').toBeDefined()
      expect(hit!.poiseDamage, '处决那一记的架势伤害是 0（近战那一记不是 0）').toBe(0)
      const dmg = hit!.damage
      const execMul = w.player.rpg.execMul
      w.off()
      return { dmg, execMul }
    }
    const before = shoot(11)
    const after = shoot(12)
    // 出身 origin_tuner 自带 5 点泛音 ⇒ 泛音那一项是 1 + 5×0.01 ＝ 1.05（§2.1 泛音行）
    expect(before.execMul, 'rank11：只有泛音那一项（×1.05），里程碑那一格还没到手').toBeCloseTo(1.05, 10)
    expect(after.execMul, 'rank12：泛音那一项 ×1.05 ＝ 1.1025').toBeCloseTo(1.1025, 10)
    expect(after.execMul / before.execMul, '那个 5% 逐字兑现（乘在泛音那一项之上）').toBeCloseTo(1.05, 10)
    // 处决那一记的伤害：(hpMax×0.12 + 30) × execMul ⇒ en_murkshell 的 hpMax ＝ 45
    expect(before.dmg, 'rank11：round((45×0.12+30)×1.05) ＝ round(37.17) ＝ 37').toBe(37)
    expect(after.dmg, 'rank12：round((45×0.12+30)×1.1025) ＝ round(39.03) ＝ 39').toBe(39)
    expect(after.dmg, '取整后落在 +5.4%（37→39）：倍率是逐字的 ×1.05，差在取整那一格 ⇒ 只量不裁').toBeGreaterThan(before.dmg)
  })

  it('腿② 满弓：总发数 3→4，主箭仍是离中心最近的那一发', () => {
    const w11 = makeWorld('wp_overtone_bow', 11)
    chargeShot(w11)
    const s11 = collect(w11)
    expect(s11, 'rank11：满弓三发（burst.count ＝ 3 含主箭）').toHaveLength(3)
    expect(s11[1].damage, '主箭（中间那一发）18').toBe(18)
    expect(s11[0].damage, '枝 ＝ 60%').toBeCloseTo(10.8, 10)
    expect(s11[2].damage, '枝 ＝ 60%').toBeCloseTo(10.8, 10)
    w11.off()

    const w12 = makeWorld('wp_overtone_bow', 12)
    chargeShot(w12)
    const s12 = collect(w12)
    expect(s12, 'rank12：分叉 2→3 ⇒ 总发数 3→4').toHaveLength(4)
    expect(s12[1].damage, '主箭仍是 18（主箭不打折）').toBe(18)
    for (const i of [0, 2, 3]) expect(s12[i].damage, `第 ${i} 枝 ＝ 60%`).toBeCloseTo(10.8, 10)
    expect(yawOf(s12[0]), 'count＝4 ⇒ 中心在 1.5，四发各偏 ±18°/±6°').toBeCloseTo(-18 * DEG, 6)
    expect(yawOf(s12[1]), '并列时取下标小的一发当主箭 ⇒ shot1').toBeCloseTo(-6 * DEG, 6)
    expect(yawOf(s12[2])).toBeCloseTo(6 * DEG, 6)
    expect(yawOf(s12[3])).toBeCloseTo(18 * DEG, 6)
    w12.off()
  })

  it('腿③ 「处决伤害 +5%」只盖住破势处决：潜行处决是"一刀了结"，**不吃那个倍率**', () => {
    // §5.4 的 B 支：目标不知情 ＋ 站在玩家背后 ＋ 血线 35% 以下 ⇒ 秒杀。
    // **那一刀的伤害是它当下的血**（不是满血、也不是"血 × 倍率"）⇒ 那个 ×1.05 完全够不着它。
    const backstab = (rank: number): number => {
      const w = makeWorld('wp_tuning_sword', rank)
      w.combat.rng.float = () => 0.5 // 抖动钉死（同腿①：那一格会随机地红）
      const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.2 }, 'stealth')
      e.yaw = Math.PI // 背对玩家（behindCone 判的是"玩家在它背后"）
      e.stats.hp = 15 // 15/45 ＝ 0.33 ≤ 0.35 的潜行血线
      w.tick(1)
      expect(e.state, '它还不知道有人在背后（不知情 ＝ 潜行处决的前提）').not.toBe('chase')
      w.frame.edges.add('interact')
      w.tick(1)
      const dmg = w.hits.find((h) => h.victimId === e.id)?.damage ?? 0
      w.off()
      return dmg
    }
    const before = backstab(11)
    const after = backstab(12)
    expect(before, 'rank11：潜行处决 ＝ 它当下的血（15）').toBe(15)
    expect(after, 'rank12：还是 15 —— 若那条 ×1.05 也盖住这一支，15 会变成 16（**它够不着**）').toBe(15)
  })
})

describe('分叉的**范围**：枝数只加在弓的满弓上（KI-334：实现追上设计，裁决 KI-328 还欠①）', () => {
  it('腿④ 没有 burst 的招式在 rank12 下**不多发**（分叉是弓的独有腿）', () => {
    // **设计四处引文，说的是同一件事**：
    // ① `src/data/schema.ts` 里 `bowForkBranches` 那格**自己**写着「在 `burst.count` **之上**叠加」
    //    「底数住在 `ms_bow.charged` 自己的 `burst.count`」；
    // ② `docs/combat.md` §4.5：「**杖不分享叉**（分叉是**弓**的独有腿）」；
    // ③ `docs/combat.md` §4.4：分叉只写在**满弓**那一行（速射/重击/跳跃/近身轻击四行都没有）；
    // ④ `docs/combat.md` §4.3：枪的蓄力重击写的是「**单发**」。
    // ⇒ rank12 的那一枝只加在**声明了 burst 的式子**上；今天全仓只有弓的满弓声明了它。
    const cases: Array<{ weapon: string; key: string; damage: number; kind: string }> = [
      { weapon: 'wp_overtone_bow', key: 'l1', damage: 10, kind: 'arrow' },
      { weapon: 'wp_overtone_bow', key: 'h', damage: 26, kind: 'arrow' },
      { weapon: 'wp_overtone_bow', key: 'jump', damage: 12, kind: 'arrow' },
      { weapon: 'wp_tuningfork_staff', key: 'charged', damage: 32, kind: 'note' },
      { weapon: 'wp_drawpin_spear', key: 'charged', damage: 34, kind: 'spear' },
    ]
    for (const c of cases) {
      const fire = (rank: number): Projectile[] => {
        const w = makeWorld(c.weapon, rank)
        if (c.key === 'jump') {
          w.player.grounded = false
          w.frame.edges.add('attackLight')
          w.tick(1)
          expect(w.player.action?.key, '跳跃那一式').toBe('jump')
        } else if (c.key === 'charged') {
          chargeShot(w)
          expect(w.player.action?.key, '蓄满那一式').toBe('charged')
        } else if (c.key === 'h') {
          tapHeavy(w)
          expect(w.player.action?.key, '重击那一式').toBe('h')
        } else {
          w.frame.edges.add('attackLight')
          w.tick(1)
          expect(w.player.action?.key, '速射那一式').toBe('l1')
        }
        const shots = collect(w)
        w.off()
        return shots
      }
      const before = fire(11)
      const after = fire(12)
      expect(before, `${c.weapon}/${c.key}：rank11 只有一发`).toHaveLength(1)
      expect(before[0].damage, `${c.weapon}/${c.key}：rank11 的底数`).toBe(c.damage)
      expect(after, `${c.weapon}/${c.key}：rank12 **不多发**（没有 burst 就没有分叉可加 ⇒ 杖不分享叉、枪是单发）`).toHaveLength(1)
      expect(after[0].damage, `${c.weapon}/${c.key}：还是帧表底数`).toBe(c.damage)
      expect(after[0].kind, '弹体种类不变').toBe(c.kind)
    }
  })

  it('腿⑤ 弓的重击回到一记 29（分叉不在重击上：同一个目标不再吃两记）', () => {
    // **靶子给足血**（`stats.hpMax` 55 → 200）：不改变任何一记的伤害数字（伤害式子里没有目标血量），
    // 只为了让"若还有第二发"这件事在读数上看得见（修之前那一发是 48：吃上了破势 ×1.5 与震裂两层）。
    const shoot = (rank: number): number[] => {
      const w = makeWorld('wp_overtone_bow', rank)
      w.combat.rng.float = () => 0.5 // 抖动钉死（rand(0.95,1.05) ⇒ 恰为 1.0）
      const e = w.ai.spawn('en_skewer', { x: 0, y: 0, z: 8 }, 'spill')
      e.stats.hpMax = 200
      e.stats.hp = 200
      tapHeavy(w)
      expect(w.player.action?.key, '弓的重击那一式').toBe('h')
      for (let t = 0; t < 90; t++) w.tick(1)
      const dmgs = w.hits.filter((h) => h.victimId === e.id).map((h) => h.damage)
      w.off()
      return dmgs
    }
    const before = shoot(11)
    const after = shoot(12)
    expect(before, 'rank11：重击一记 ＝ 29（26 底数 × 属性标尺 1.115）').toEqual([29])
    expect(after, 'rank12：还是一记 29 —— 那一枝只加在满弓上，重击不吃它（**修之前**这里是两记 29＋48 ＝ 77）').toEqual([29])
    expect(after.reduce((s, d) => s + d, 0), '总伤害 29 ＝ 与 rank11 逐字相同（分叉不在重击上）').toBe(29)
  })

  it('腿⑥ 「需指法≥30」不是门：指法归零，满弓分叉照样在（设计 vs 实况 ⇒ 只量不裁）', () => {
    // docs/progression.md §2 那张武器表里，泛音弓那一行写着「满弓分叉枝数 2→3 **需 指法≥30**」，
    // 而 §8.2 的 rank12 那一行写着「满弓分叉 2→3（若用弓）」⇒ 同一句承诺有两个主人。
    // 运行时唯一的门是 **rank 12**：把指法归零，枝数照样是 3。
    const fire = (dex: number): number => {
      const w = makeWorld('wp_overtone_bow', 12, { dex })
      chargeShot(w)
      const shots = collect(w)
      w.off()
      return shots.length
    }
    expect(fire(0), '指法 0：满弓照样 4 发（⇒ 没有「指法≥30」这道门）').toBe(4)
    expect(fire(99), '指法 99：也是 4 发（⇒ 不是"指法越高分叉越多"）').toBe(4)
  })
})

describe('改表法：这两格读的是表，不是常数（反向实测）', () => {
  it('腿⑦ `execMulPct` 5→0 ⇒ rank12 的处决伤害回到 rank11 的 37', () => {
    const row = msBowSplit()
    const backup = JSON.parse(JSON.stringify(row.grant))
    const read = (rank: number): number => {
      const w = makeWorld('wp_tuning_sword', rank)
      w.combat.rng.float = () => 0.5 // 抖动钉死（同腿①）
      const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: 1.5 }, 'exec')
      e.yaw = Math.PI // 面对玩家（同腿①：朝向随机 ⇒ 那一格会随机地红）
      tapHeavy(w)
      for (let i = 0; i < 120 && w.player.busy; i++) w.tick(1)
      const before = w.hits.length
      w.frame.edges.add('interact')
      w.tick(1)
      const dmg = w.hits.slice(before).find((h) => h.victimId === e.id)?.damage ?? 0
      w.off()
      return dmg
    }
    expect(read(12), '改表前：rank12 ＝ 39').toBe(39)
    row.grant = { ...backup, execMulPct: 0 }
    expect(read(12), '把 grant 的 5% 抹掉 ⇒ rank12 回到 rank11 的 37').toBe(37)
    row.grant = backup
    expect(read(12), '还原后又是 39').toBe(39)
  })

  it('腿⑧ `bowForkBranches` 1→0 ⇒ 满弓回到 3 发', () => {
    const row = msBowSplit()
    const backup = JSON.parse(JSON.stringify(row.grant))
    const read = (rank: number): number => {
      const w = makeWorld('wp_overtone_bow', rank)
      chargeShot(w)
      const n = collect(w).length
      w.off()
      return n
    }
    expect(read(12), '改表前：rank12 满弓 4 发').toBe(4)
    row.grant = { ...backup, bowForkBranches: 0 }
    expect(read(12), '把 grant 的那一枝抹掉 ⇒ 满弓回到 3 发').toBe(3)
    row.grant = backup
    expect(read(12), '还原后又是 4 发').toBe(4)
  })
})
