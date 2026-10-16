import { bus } from '@/core/EventBus'
import { Rng, clamp } from '@/core/Math'
import { TICK_HZ } from '@/core/Time'
import type { EnemyData, AttackSpec, FrameData, ProjectileSpec } from '@/data/schema'
import { EntityStats } from '@/combat/EntityStats'
import { armStats } from '@/combat/Statuses'
import { armCrumple, materialFlashSeconds, reactionTier } from '@/combat/Reactions'
import type { Vec3 } from '@/combat/EntityStats'
import type { HitTarget } from '@/combat/HitShapes'
import { bandDamage } from '@/combat/HitShapes'

import type { RhythmClock } from '@/core/RhythmClock'
import type { SightGate } from '@/core/Occlusion'
import type { NavGate } from './Navigation'
import type { PlayerController } from '@/player/ThirdPersonController'
import { advanceActionFrames, applyActionStop, type ActionStop } from '@/combat/ActionFrames'

export type AIState =
  | 'idle' | 'patrol' | 'investigate' | 'alert' | 'chase' | 'combat'
  | 'retreat' | 'search' | 'callAlly' | 'recover' | 'dead'

/**
 * 一次出手的运行时状态。§9 攻方那一半要在它身上记两格（`ActionStop`），所以构造点收成一处
 * （五处字面量各自抄一遍 `stopTicks: 0` 是迟早会漏的那类代码）。
 */
export interface AttackFrame extends ActionStop {
  spec: AttackSpec
  hitDone: boolean
  shots: number
  lungeApplied: number
  /** `noise` = 这一招的 `sound.source` 已经报过了（见 `advanceAttackFrames`） */
  noise?: boolean
  /**
   * §8 R2 那行的「霸体（`frames.flags` 里的 `hyper`）」自带 **1 次**免役：用过就作废，
   * 同一式的后摇与下一式都不再免。它记在招式实例上而不是实体上，因为"哪一式霸体"是数据，
   * 而"这一次已经赖掉一刀"是这一式的账。
   */
  hyperSpent?: boolean
  /**
   * 「读条走完」那一格要做的事（警戒广播、冲刺撞钟）不再用 `tick === startup` 判定：
   * 任何让帧前进变快的来源（§14.6 定调光环、§15.2 Finale 的前摇倍率）都可能**一步跨过那个整数**，
   * 于是同伴不会被叫醒、钟不会被撞响——而这两件都是玩家看得见的机制。
   * 标记记在招式实例上，"一式一次"的语义没变，只是不再要求恰好落在那一帧。
   */
  startupDone?: boolean
  /** 起手音的同一件事的另一半：`tick === 0` 也会被加速步过去（新写的式子从负 tick 起算时更是如此） */
  sfxDone?: boolean
  /** KI-092②：Boss 大招 telegraph 只发一次（起手那一 tick）；记在招式实例上，"一式一账" */
  telegraphDuckDone?: boolean
}

export const newAttack = (spec: AttackSpec, tick: number, noise?: boolean): AttackFrame => ({
  spec, tick, hitDone: false, shots: 0, lungeApplied: 0, noise, stopTicks: 0, stopDebt: 0
})

export interface PerceptionEvent { pos: Vec3; loudness: number; moveNoise: number }

export type ActiveEnemyHit = {
  box: AttackSpec['frames']['hitbox']; yaw: number; damage: number; poise: number;
  hitStopMs: number; reaction: string; loudness: number; flags: string[]
}

let enemySeq = 0

/** 敌人脱离 combat 回到追击的距离（数据可用 `ai.chaseBeyond` 覆盖；射手要在更远距离开火） */
const DEFAULT_CHASE_BEYOND = 12

export class Enemy {
  id = `en_${++enemySeq}`
  stats: EntityStats
  pos: Vec3
  yaw = 0
  state: AIState = 'idle'
  alertness = 0
  stateTick = 0
  home: Vec3
  lastKnown: Vec3
  investigateTick = 0
  attack: AttackFrame | null = null
  cooldowns = new Map<string, number>()
  stunTicks = 0
  /**
   * §9「冻结攻守双方动画时间」的守方那一半（KI-017 第二步）：命中那一下把这一只的硬直倒数按住
   * 几 tick（与相机的停顿同一个 `frames.hitStopMs` 派生，不写第二份时长）。与下面的 `frozenTicks`
   * 分格：那是"这只生物的节拍被拿走了几十 tick"（整个 update 短路），这是"这一记接触的三到五格"。
   *
   * **攻方那一半（她的招式帧）也在，但一格都不落在判定窗之内**（KI-017 第三步）：给 `attack.tick`
   * 在窗内挂过一格同样的账，收势帧仍然对得上拍，被推开的却是**窗尾**——实测恩希尔迟 89.86ms、
   * 奥斯塔拉迟 83.33ms（§2.1 的容差是 50ms），因为按停几格就把可命中段在世界时间里拉长几格。
   * 现行做法是"窗内只记账、窗尾之后兑现、收势之前每 tick 补一帧还债"，判据与配额全在
   * `combat/ActionFrames.ts`；`stunStopTicks` 与它共用同一个时长来源，走两条独立的账。
   */
  stunStopTicks = 0
  /**
   * §7.2 休止斩的「全场敌人时间冻结」。**刻意不是 `stunTicks` 的别名**：
   * 定身是"这一招被打断了"——`update` 里那条会把 `attack` 直接抹掉；
   * 时停是"这一招连人带帧停在原地"——帧数不推进、读条保留，松手后从同一帧继续。
   * 两条语义的差值有 flow 断言钉着（`tests/flow/movements.test.ts` 休止那一节）。
   */
  frozenTicks = 0
  /**
   * KI-023 聋乱窗（§15.3 音刺碎了）：>0 期间「听」这条通道整个关掉——hear/huntSound/sense 的
   * 视觉与听觉分支全部短路。与 `stunTicks`（不能动）、`frozenTicks`（时间停）是三条语义：
   * 聋乱里的她能动、时间在走，只是世界对她静音——这正是设计要的破势窗口。
   * 时长来自 prop 数据的 `onBreakDeaf.deafTicks`（§55：代码不写第二份秒数）。
   */
  deafTicks = 0
  /**
   * 「定调」光环加成（§14.6 叠唱）：由 AISystem 每 tick 从最近的 buffAura 来源写入，
   * null = 未被定调。倍率全部来自那份数据表，不在这里写死（§55）。
   */
  buff: { attackSpeedMul: number; dmgMul: number; fromId: string } | null = null
  /**
   * KI-009 第一腿的绕路口（combat.md §595「路径=简单导航网格（手工 Nav 点或 A* 网格，
   * 禁动态避障物理）」）：由 `AISystem` 每 tick 从组合根写入，`null` = 这一片天没有 authored 墙
   * （野外与全部既有测试的口径）。**读它的地方只有一处**——`stepToward`，于是追击 / 搜索 /
   * 巡逻 / 退却 / 跟队友共用同一条腿，绕路的收益与它的代价都只有一份。
   */
  nav: NavGate = null
  /**
   * §14.5「拍隙」当前状态：true = 此刻正踩在拍点上，半透明+定身，打不着也走不动。
   * 和 buff 一样是**每 tick 从数据重算的派生态**，不是需要维护的事件态。
   */
  intangible = false
  /** 被「拍点闪避」或「伪拍点声源」拽出拍隙的剩余 tick；>0 期间相位不再免伤 */
  revealTicks = 0
  /**
   * §14.7 钟甲是否已被震裂满层打碎。碎了就永久失效（不修甲、不长回来），
   * 所以「攒震裂」是一次性奖励而不是一轮流循环。消费方只有 strikeEnemy 一处。
   */
  armorBroken = false
  /** KI-013：碎甲那一 tick（ActorVisuals 据此播碎裂缩放动画；0 = 没碎过） */
  plateBreakTick = 0
  /** §14.7 敲钟自鸣的下一次准点小节（-1 = 还没参战，进战后才排程） */
  private tollDueBar = -1
  /** §15.2 'cycle' 选招的轮转指针（只在 pickOrder==='cycle' 时有意义） */
  private cycleIdx = 0
  /**
   * Boss 阶段下标（§15/§16）。**单调推进**：血线只降不升，所以绝不会来回跳阶，
   * 一记大伤害直接跨过两条线时也是一次性跳到最靠后的那一阶。
   */
  bossPhase = 0
  /** 每口立钟是否已经响过（下标 = `boss.bells.positions` 的下标） */
  bellsRung: boolean[] = []
  /** 钟壳被机关暂时剥掉的剩余 tick；这期间她的架势累积翻倍 */
  shellLiftTicks = 0
  /** 撞满 `breaksAt` 口钟 ⇒ 壳永久碎（不随 shellLiftTicks 归零而长回来） */
  shellBroken = false
  /** §15.3 瞬移咬合的冷却线 */
  private blinkReadyTick = 0
  /** §15.3「听心跳」：玩家已连续静止的 tick 数 */
  private stillTicks = 0
  /** 刚跳阶：让 CombatManager 演一次「敲钟怒吼」（hitstop + 低音 + 震镜） */
  phaseRoarPending = false
  /**
   * §16「Boss 均带 3 拍入场演出」：正在演这段的剩余 tick（0 = 没在演）。
   * 触发是**每具实例一次**的——她演的是「第一次照面」，不是「每次进战」。
   */
  introTicksLeft = 0
  private introQueued = false
  private introPlayed = false
  /**
   * §15.2 玩家已经「夺回节拍」的剩余 tick：>0 期间这一阶的 stealBeat 全场减益与 BPM 游走都关掉。
   * 由 CombatManager 写（那里有玩家输入与节奏），本类只读。
   */
  stealNeutralTicks = 0
  /** 攻速加成用「攒够一整帧才多走一帧」实现，保持 tick 是整数（帧表里有 === 判定） */
  private speedAcc = 0
  facingLocked = false
  deathTick = -1
  coreFlash = 0
  private rng: Rng
  patrolPoints: Vec3[]
  patrolIdx = 0
  /**
   * 断弦线步 1 判据的周期事件（KI-043）：`patrol` 态里把路径点走回第一格的那一 tick 调一次。
   * 只有巡逻态的绕回才算——被打进战斗再回来，这一圈本来就没走完。读者是 AISystem 装配的
   * `PatrolWatch`；没有装配时这个字段是 null，巡逻行为零开销。
   */
  onPatrolLoop?: () => void
  searchAngle = 0
  callAllySuppressedUntil = 0
  /** 视线段的两个复用端点（`losBlocked` 每次覆写它们，查询方只在调用期间读） */
  private readonly segA: Vec3 = { x: 0, y: 0, z: 0 }
  private readonly segB: Vec3 = { x: 0, y: 0, z: 0 }

  constructor(public data: EnemyData, pos: Vec3, seed: string) {
    this.rng = new Rng(seed + this.id)
    this.stats = new EntityStats(data.hp, 100, data.poise)
    armStats(this.stats) // §11：震裂的层数上限与两段衰减节奏来自 statuses.json，不在这里写第二遍
    armCrumple(this.stats, this.isBoss) // §8 R4：破势时长来自 reactions.json（Boss/mini-boss 2.4s，其余 1.8s）
    this.stats.defense = data.defense ?? 0
    this.pos = { ...pos }
    this.home = { ...pos }
    this.lastKnown = { ...pos }
    this.yaw = this.rng.float(0, Math.PI * 2)
    this.patrolPoints = [
      { x: pos.x + 3, y: 0, z: pos.z },
      { x: pos.x, y: 0, z: pos.z + 3 },
      { x: pos.x - 3, y: 0, z: pos.z }
    ]
    bus.on('ai.callAlly', (e) => {
      if (e.fromId === this.id || this.state === 'dead') return
      if (Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z) <= (data.ai.callAlly?.range ?? 14)) {
        this.alertness = Math.max(this.alertness, 100)
        this.lastKnown = { ...e.pos }
        this.enter('alert')
      }
    })
  }

  get alive(): boolean { return !this.stats.dead }
  get nameKey(): string { return this.data.nameKey }
  getPos(): Vec3 { return this.pos }
  get isBoss(): boolean { return this.data.archetype === 'boss' || this.data.archetype === 'miniboss' }
  /** 当前生效的 Boss 阶段（非 Boss 为 undefined） */
  get bossPhaseData(): NonNullable<EnemyData['boss']>['phases'][number] | undefined {
    return this.data.boss?.phases[this.bossPhase]
  }
  /**
   * 钟壳还在 = 这一阶写着 shell、没被撞碎、也没被钟声暂时剥掉。
   * 三态缺一不可：§15.1 的 P1 是「打不动，但场地能解」而不是「数值怪」。
   */
  get shellUp(): boolean {
    const sh = this.bossPhaseData?.shell
    return !!sh && !this.shellBroken && this.shellLiftTicks <= 0
  }
  get shellDmgMul(): number { return this.shellUp ? this.bossPhaseData!.shell!.dmgMul : 1 }
  get poiseImmune(): boolean { return this.shellUp && !!this.bossPhaseData?.shell?.immuneToPoise }
  /**
   * KI-023：此刻聋不聋。三个来源走同一个出口——数据侧的 `ai.deaf`（天生无耳）、
   * 运行时的聋乱窗（音刺碎裂的 6s）、阶段侧的 `phases[].deaf`（KI-024 聋乱期）。
   * 消费方只问这一格，不数来源。
   */
  get deaf(): boolean { return !!this.data.ai.deaf || this.deafTicks > 0 || this.bossPhaseData?.deaf === true }
  /** 音刺碎裂（PropSystem 广播 → AISystem 路由）把窗挂上来；取 max，两根刺同 tick 碎不叠时长 */
  applyDeaf(ticks: number): void { this.deafTicks = Math.max(this.deafTicks, ticks) }
  /**
   * §11「震裂对装甲/晶体类效果 ×2」的载体：**本体材质**倍率（嘈壳的壳、漂调者喉咙里的晶）
   * 叠上**铸壳期**倍率（§15.1 那层壳同样是铸出来的）。它只放大震裂这一条状态的收益——
   * 层数打满仍然剥不掉壳，剥壳只有撞钟一条路，所以这不是给 P1 发明的第二条解法。
   */
  get fissureEffectMul(): number {
    const shellMul = this.shellUp ? this.bossPhaseData?.shell?.fissureMul ?? 1 : 1
    return (this.data.fissureMul ?? 1) * shellMul
  }
  /** 壳被剥掉的那 6s 里架势累积翻倍（§15.1：无敌解除 + 架势累积翻倍是同一个奖励） */
  get poiseAccumMul(): number {
    const sh = this.bossPhaseData?.shell
    return sh && !this.shellBroken && this.shellLiftTicks > 0 ? 2 : 1
  }
  get inStartup(): boolean { return !!this.attack && this.attack.tick < this.attack.spec.frames.startup }
  get activeHitbox(): ActiveEnemyHit | null {
    if (!this.attack) return null
    const f = this.attack.spec.frames
    if (this.attack.tick < f.activeStart || this.attack.tick > f.activeEnd || this.attack.hitDone) return null
    return {
      box: f.hitbox, yaw: this.yaw, damage: f.damage * (this.buff?.dmgMul ?? 1),
      poise: f.poise, hitStopMs: f.hitStopMs, reaction: this.attack.spec.reaction ?? 'R1',
      loudness: f.loudness ?? 3, flags: f.flags ?? []
    }
  }

  /**
   * §15.1 P3「落点震波外环 20 / 内环 36」：这一记打在 `target` 这一点上吃多少伤害。
   *
   * 为什么是**结算时现算**而不是在 `activeHitbox` 里折好：那个 getter 手上只有出手点，
   * 它同时被表现层读（`ActorVisuals` 拿它判断"此刻该不该亮"），把"打在哪"烧进去等于让一个
   * 显示用的读取口去决定玩法数值。距离只有结算那一方知道，所以档位也只在结算那一格查。
   *
   * 返回 null = **这一招没有分环**，调用方走 `activeHitbox.damage` 那条老路。档位只在数据写了
   * 的地方存在；不给没写 bands 的招式凭空补一档（那才是真的两个主人）。
   * 乘 `dmgMul` 与 hitbox 那一支同源：§14.6 定调光环抬的也正是落点伤害。
   */
  bandedDamage(target: Vec3): number | null {
    const f = this.attack?.spec.frames
    if (!f?.bands) return null
    const dist = Math.hypot(target.x - this.pos.x, target.z - this.pos.z)
    return Math.round(bandDamage(f.bands, dist) * (this.buff?.dmgMul ?? 1))
  }

  hitTarget(): HitTarget {
    const s = this.data.body?.scale ?? 1
    return { pos: this.pos, facingYaw: this.yaw, radius: 0.55 * s, height: this.bodyHeight() }
  }
  /**
   * 弹道招式的发射窗口（需求 §59：远程敌人走同一套弹道运行时）。
   * 连发（§14.4 三叠箭）按 burst.everyTicks 逐发排开，同一招式最多发 count 发；
   * 被弹反/被打断 ⇒ attack 清空，余下发数一起作废（这就是「骗动作」的反制）。
   *
   * `feintPunishMs` 是 §14.4 那句「骗翻滚后硬直 0.6s」跟着**这一发**走的那条腿（KI-085）：
   * 只有下标等于 `burst.feint.shot` 的那一发带着它，其余发数为 null。谁吃这个数不在这里判
   * （那是 CombatManager 与玩家翻滚的事），这里只回答"离手的这一发是不是诱饵"。
   */
  get pendingProjectile(): { spec: ProjectileSpec; frames: FrameData; reaction: AttackSpec['reaction']; feintPunishMs: number | null } | null {
    const a = this.attack
    if (!a) return null
    const spec = a.spec.frames.projectile
    if (!spec) return null
    const count = spec.burst?.count ?? 1
    if (a.shots >= count) return null
    const b = spec.burst
    const at = b ? (b.at?.[a.shots] ?? a.shots * b.everyTicks) : 0
    if (a.tick < a.spec.frames.activeStart + at) return null
    // §8 的分级跟着这一发走（KI-052②）：弹体离手之后它仍然是"那一招打出来的一记"，
    // 所以那一招声明的档位要原样带到命中点，而不是在发射处再查一次此刻的招式。
    // 诱饵身份同理跟着这一发走（KI-085）：下标对上才是假动作，别把惩罚发给整串箭。
    const feint = spec.burst?.feint
    return { spec, frames: a.spec.frames, reaction: a.spec.reaction, feintPunishMs: feint && a.shots === feint.shot ? feint.punishMs : null }
  }

  /** §14.4「可见赤线 telegraph，线终点=落点」：前摇期间把落点提前告诉玩家 */
  get telegraphProjectile(): { spec: ProjectileSpec; ticksLeft: number; totalTicks: number } | null {
    const a = this.attack
    if (!a) return null
    const spec = a.spec.frames.projectile
    if (!spec?.telegraph) return null
    if (a.tick < 0 || a.tick >= a.spec.frames.startup) return null
    return { spec, ticksLeft: a.spec.frames.startup - a.tick, totalTicks: a.spec.frames.startup }
  }

  markShotFired(): void { if (this.attack) this.attack.shots++ }

  /**
   * §9 攻方那一半（KI-017 第三步）：把**这一记正在出的招**的招式帧按住几格，之后每 tick 补一帧
   * 还回去——所以收势仍然落在它与不按停时**同一个 tick** 上，§2.1 的拍位不动。
   * `src` 是"落下来的这一记"所属的那个出手对象：身份不符就不按（弹体早就离手了，按它等于抢别人的时间）。
   * 能按几格全在 `applyActionStop` 那四条判据里（含"带连发拍位的弹道招式不按"、"一帧都不落在窗内"）。
   */
  freezeAction(ms: number, src: object): number {
    if (!this.attack || this.attack !== src) return 0
    return applyActionStop(this.attack, this.attack.spec.frames, ms)
  }

  /**
   * §14.6「定调」攻速加成：帧表全是整数 tick 且 telegraph/出手点用 `===` 判定，
   * 所以不能把 tick 变成浮点——累计小数部分，攒满 1 就这一 tick 多走一帧（1.15× ≈ 每 7 帧多 1 帧）。
   *
   * 这里同时是敌人近战**发声**的唯一出口（KI-016）：越过 `activeStart` 的那一 tick 报一声，
   * 响度取招式自己的 `frames.loudness`（与玩家侧 `(loudness ?? 3)/10` 同一条标尺）。
   * 判据写成"跨过"而不是"等于"，因为定调会让 tick 一次跳两帧；tick 在一招之内单调递增，
   * 所以这个条件天然只成立一次，不需要额外的"已发声"标记。
   * 弹道招式不在这里发声——发射那一 tick 由 `CombatManager` 报，两处理齐会双倍响度。
   */
  private advanceAttackFrames(mul: number): number {
    if (!this.attack) return 0
    const f = this.attack.spec.frames
    const prev = this.attack.tick
    // §9 攻方那一半：这一 tick 走几帧由停顿账本给（0＝按住，2＝回拍补帧）。
    // 按住的那一 tick 连「定调」的加速也不走——那几格是时间在停，不是在变慢。
    const base = advanceActionFrames(this.attack, f)
    if (base === 0) return 0
    this.attack.tick += base
    const extra = mul - 1
    if (extra > 0) {
      this.speedAcc += extra
      while (this.speedAcc >= 1) { this.speedAcc -= 1; this.attack.tick++ }
      // 加速不许跨过判定窗的第一格：那一格之后就是"打得到人"的时间，任何倍率都不该从里面扣。
      // 定调光环同样受这条钳制管（它以前就能一步跳过 activeStart，只是没有人量过那条边界）。
      if (this.attack.tick > f.activeStart && prev < f.activeStart) this.attack.tick = f.activeStart
      // `prev` 用的是严格小于：钳过一次之后 prev 就等于 activeStart，写 <= 会把这一式永远钉在窗口第一格上
    }
    if (f.projectile) return base // 发射那一 tick 由 CombatManager 报，两处理齐会双倍响度
    if (prev < f.activeStart && this.attack.tick >= f.activeStart) {
      if (!this.attack.noise) {
        this.attack.noise = true
        bus.emit('sound.source', { id: this.id, pos: { ...this.pos }, loudness: (f.loudness ?? 3) / 10 })
      }
      // KI-051：落帧那一 tick 对**世界**做的两件事，打没打中都做——
      // ① `frames.vfx`：这个字段在 enemies.json 里声明了二十多招却一直没有发射方，
      //    今天起它是 `VfxLayer` 的敌人侧入口（挥剑有轨迹、砸地有尘环）；
      // ② `frames.worldShake`：§10「驼鼓踏地」那类世界事件震镜，走 `camera.shake`
      //    （不复用 `combat.hit.shakeKey`——那条说的是"打在谁身上"，落帧震场与命中无关）。
      if (f.vfx?.[0]) {
        bus.emit('vfx.request', {
          key: f.vfx[0], pos: { ...this.pos },
          dir: { x: Math.sin(this.yaw), y: 0, z: Math.cos(this.yaw) }, scale: 1.6
        })
      }
      if (f.worldShake) bus.emit('camera.shake', { key: f.worldShake, pos: { ...this.pos } })
    }
    return base
  }

  enter(s: AIState): void {
    if (this.state === s) return
    this.state = s
    this.stateTick = 0
    if (s === 'dead') this.deathTick = this.rng.int(0, 1)
    // §16 入场演出的触发点：她**第一次**真正锁定玩家（alert 只是听见了，chase/combat 才是照面）。
    // 这里只登记，不在这里算时长——拍长要等 `AISystem.syncClock` 把网格换成她的拍速才准。
    if (!this.introPlayed && this.data.boss?.intro && (s === 'chase' || s === 'combat')) this.introQueued = true
  }

  /** 跳过 §16 入场演出。演出有 `bossshow.test.ts` 专门盯，其余 Boss 用例测的是战斗时序，不该被这几拍挡下。 */
  skipIntro(): void {
    this.introQueued = false
    this.introPlayed = true
    this.introTicksLeft = 0
  }

  /** perception runs at 10Hz (rotated by AISystem) */
  sense(player: PlayerController, now: number, sight: SightGate = null): void {
    if (!this.alive) return
    const ai = this.data.ai
    const p = player.pos
    const dx = p.x - this.pos.x, dz = p.z - this.pos.z
    const dist = Math.hypot(dx, dz)
    const ang = Math.abs(norm(Math.atan2(dx, dz) - this.yaw))
    // §13.0 视觉列写的是「视锥 **+** 遮挡检查」，此前只落了前半句。墙在两人之间时
    // 这里整条不成立，于是往下走**震动**那一支——躲进掩体不等于消失，敌人还会听见你移动。
    if (!this.deaf && dist <= ai.vision.range && ang < (ai.vision.fovDeg * Math.PI / 180) / 2
      && !this.losBlocked(p, player.hitTarget().height, sight)) {
      this.alertness = Math.min(100, this.alertness + 34 * 0.1)
      this.lastKnown = { ...p }
    } else if (dist <= (this.bossPhaseData?.vibrationRange ?? ai.vibration.range) && (playerIsMoving(player))) {
      // KI-024：聋乱期她改读地面——阶段可以给震动感知换半径。移动才算数：站定仍是安全的，
      // 「听心跳」那条线在 P2 依旧成立（§15.3 的屏息窗口没有因换阶段而消失）
      this.alertness = Math.min(100, this.alertness + 40)
      this.lastKnown = { ...p }
    }
    void now
  }

  /**
   * 这一段视线被挡住没有（KI-014②b）。两端取**身体中心**，与 `CombatManager.coverEatsLine`
   * 同一口径：拿脚底量的话，一块到腰的矮墙在数学上谁也没挡、画面上却明晃晃立着；
   * 而 `sight = null`（场上没有几何体）恒为「看得见」，所以既有全部测试的口径不变。
   * 两端各用一个复用槽：`sense()` 每 0.1s 对全场敌人跑一遍，这里不该成为分配的源头。
   */
  private losBlocked(target: Vec3, targetHeight: number, sight: SightGate): boolean {
    if (!sight) return false
    const a = this.segA, b = this.segB
    a.x = this.pos.x; a.y = this.pos.y + this.bodyHeight() / 2; a.z = this.pos.z
    b.x = target.x; b.y = target.y + targetHeight / 2; b.z = target.z
    return sight(a, b)
  }

  /** 与 `hitTarget()` 同一个数，只是不为它造一个对象 */
  private bodyHeight(): number { return 1.6 * (this.data.body?.scale ?? 1) }

  hear(src: { pos: Vec3; loudness: number }, tick: number): void {
    if (!this.alive || this.deaf) return
    const d = Math.hypot(src.pos.x - this.pos.x, src.pos.z - this.pos.z)
    if (d <= this.data.ai.hearing.range) {
      this.alertness = Math.min(100, this.alertness + src.loudness * 120)
      this.lastKnown = { ...src.pos }
    }
    this.huntSound(src, tick)
  }

  /**
   * §13.0「被弹反/完美格挡目击者 +100（瞬间报警）」。判据刻意是**看见**而不是听见：
   * 视觉锥沿用 `sense()` 同一套数（`ai.vision.range / fovDeg`），而除嘈壳外的敌人
   * `vision.range` 都比 `hearing.range` 长，所以这一条把报警半径从「听得见」推到「看得见」。
   * 无眼的万籁（`vision.range = 0`）不在其列——她本来就靠声音找人。
   * 已经在动手的不需要报警，只把最后已知位置更新到冲击点。
   * KI-014②b：这一条既然写的是「目击」，就必须真的**看见**——墙在中间时两者都不成立。
   */
  sawImpact(at: Vec3, atHeight: number, sight: SightGate = null): void {
    if (!this.alive) return
    const dx = at.x - this.pos.x, dz = at.z - this.pos.z
    const d = Math.hypot(dx, dz)
    const v = this.data.ai.vision
    if (this.state === 'combat' || this.state === 'chase') {
      // 交战中的他不需要"报警"，但**看见**才更新最后已知位置：隔着一堵墙听见那一记，
      // 把人往墙那头引是错的（那一支本来就有 `hear()` 负责，它给的是声音的位置）
      if (d <= v.range && !this.losBlocked(at, atHeight, sight)) this.lastKnown = { ...at }
      return
    }
    const half = (v.fovDeg * Math.PI / 180) / 2
    if (d > v.range || Math.abs(norm(Math.atan2(dx, dz) - this.yaw)) > half) return
    if (this.losBlocked(at, atHeight, sight)) return // 那一记发生在墙后面：他没看见，就不该瞬间进 chase
    this.alertness = 100
    this.lastKnown = { ...at }
    this.enter('chase')
  }

  /**
   * §15.3 声音狩猎：够响的一声 ⇒ 她**瞬移到发声点并咬一口**。冷却由表给（`huntsSound`），
   * 否则一串脚步会让她连环跳；瞬移落点刻意留在发声点上，不往玩家怀里跳——玩家因此
   * 有 300ms 的前摇可读（她唯一的破绽就是这口前摇），而不是被凭空贴脸。
   */
  private huntSound(src: { pos: Vec3; loudness: number }, tick: number): void {
    const h = this.data.ai.huntsSound
    if (!h || !this.alive || this.deaf) return
    if (src.loudness < h.minLoudness) return
    if (tick < this.blinkReadyTick) return
    const d = Math.hypot(src.pos.x - this.pos.x, src.pos.z - this.pos.z)
    if (d > h.maxRange) return
    const spec = this.data.attacks.find((a) => a.id === h.attackId)
    if (!spec) return
    this.blinkReadyTick = tick + h.cooldownTicks
    this.pos.x = src.pos.x
    this.pos.z = src.pos.z
    this.lastKnown = { ...src.pos }
    this.alertness = 100
    // 她不在拍上 ⇒ 不等量化，落点即起手
    this.attack = newAttack(spec, 0)
    this.enter('combat')
    bus.emit('vfx.request', { key: 'spike_chord', pos: { ...src.pos }, scale: 1.5 })
    bus.emit('audio.sfx', { key: 'boss_roar', pos: { ...src.pos }, gain: 0.5 })
    bus.emit('ui.notify', { text: '万籁听见了你', kind: 'boss' })
  }

  /**
   * §14.5 相位重算（每 tick 一次，纯函数）：离拍点足够近 = 隐形定身，除非刚被抓出来（reveal）。
   * 放在敌人自己身上而不是 CombatManager：命中层只问 `e.intangible`，不重复算拍子。
   */
  private syncPhase(rhythm: RhythmClock): void {
    const g = this.data.ai.beatGhost
    if (!g) return
    this.intangible = this.revealTicks <= 0 && rhythm.ticksFromBeatPoint() <= g.intangibleWindowTicks
    if (this.revealTicks > 0) this.revealTicks--
  }

  /**
   * §14.5 解法 c「投掷音色晶=伪拍点声源」：一次足够响的声源就是它听来的一个假拍点，
   * 相位被打乱 ⇒ 显形。响度阈值与时长全部来自 `ai.beatGhost`；自己的动静不算数。
   */
  fakeBeat(src: { id: string; pos: Vec3; loudness: number }): void {
    const g = this.data.ai.beatGhost
    if (!g || src.id === this.id || !this.alive) return
    if (src.loudness < g.fakeBeatLoudness) return
    if (dist3(this.pos, src.pos) > this.data.ai.hearing.range) return
    this.revealTicks = Math.max(this.revealTicks, g.fakeBeatRevealTicks)
  }

  /**
   * §16 入场演出的计时器。开始的那一刻才换算拍长：`AISystem.syncClock` 在她进战的同一 tick
   * 就把全场网格换成了她的私有拍速，所以 `beats × beatTicks` 数的正是**她**的拍——
   * 玩家在这几拍里听到的第一件东西就是这场战斗的 tempo（§15.1 的 3/4@108 与 §15.3 的 60BPM 心跳，
   * 同一个 `beats: 3` 会给出两种秒数，这是设计要的差别，不是四舍五入的误差）。
   */
  private tickIntro(rhythm: RhythmClock): void {
    if (this.introTicksLeft > 0) { this.introTicksLeft--; return }
    if (!this.introQueued) return
    const spec = this.data.boss?.intro
    if (!spec) return
    this.introQueued = false
    this.introPlayed = true
    this.introTicksLeft = Math.max(1, Math.round(spec.beats * rhythm.beatTicks))
    for (const k of spec.sfx ?? []) bus.emit('audio.sfx', { key: k, pos: { ...this.pos }, gain: 1 })
    bus.emit('vfx.request', { key: 'shock_small', pos: { ...this.pos }, scale: 2.2 })
    bus.emit('boss.intro', { id: this.id, dataId: this.data.id, nameKey: this.data.nameKey, ticks: this.introTicksLeft })
    if (spec.label) bus.emit('ui.notify', { text: spec.label, kind: 'boss' })
  }

  update(dt: number, tick: number, player: PlayerController, rhythm: RhythmClock, slotTaken: (bar_beat: string) => boolean): void {
    if (!this.alive) {
      if (this.state !== 'dead') this.enter('dead')
      this.stateTick++
      return
    }
    if (tick < this.callAllySuppressedUntil) { /* noop */ }
    this.syncPhase(rhythm)
    // 读条被外力抹掉（stun、破势进 recover、走调时刻、处决都会直接 `attack = null`）时，
    // 挂在上面的后事必须一起作废——否则它会在**下一招**的起手帧上偷偷生效（白回 15 血、
    // 或把一次并不存在的警戒广播发出去）。实测过：没有这一行时漏回血。
    if (!this.attack && this.pendingBroadcast) this.pendingBroadcast = null
    // §7.2 休止斩：时间被按住的那几十 tick 里，上面两行照跑，下面的一切都不跑。
    // - `syncPhase` 要在冻结之前：§14.5 的拍隙是**世界**的拍网格算出来的派生态，冻结的是它自己的
    //   时间，不是世界的；放在后面会让它带着一个过期的 `intangible` 站 0.8s（打不着或白白挨打）。
    // - 不动 `stats.update`：架势衰减、震裂衰减、闷音计时全停——那才是"时间"冻结而不只是"不许动"。
    // - 不清 `attack`、不 `enter('recover')`：招式停在原地，等松手。
    if (this.frozenTicks > 0) { this.frozenTicks--; return }
    this.syncBoss()
    this.stats.update(dt, tick)
    this.stateTick++
    // KI-023 聋乱窗跟自己的时间走：冻结的那几十 tick 不计（时间没走，聋也没走）。
    // 放在 frozen 短路之后——被休止斩按住的万籁不会把破势窗在静止里白白耗完。
    if (this.deafTicks > 0) this.deafTicks--
    // §16 入场演出：先计时再判硬直——被玩家一记开场打晕不该把演出「省掉」，也不该让它无限延长
    this.tickIntro(rhythm)
    // §9 的守方那一半（KI-017 第二步）：接触被按住的几 tick 里硬直倒数也不走，但这一支仍然
    // 短路 return——否则一次停顿会变成免费的解禁（"不许动"那段反而推进了"多久才许动"的表）。
    // 先采样再扣：这一格在硬直之外也要走（它计的是那几十毫秒，不是"还有多久解禁"）。
    const stunHeld = this.stunStopTicks > 0
    if (stunHeld) this.stunStopTicks--
    if (this.stunTicks > 0) {
      if (!stunHeld) this.stunTicks--
      this.attack = null
      if (this.stunTicks === 0 && this.state === 'recover') this.enter('combat')
      return
    }
    if (this.stats.crumpleTicksLeft > 0 && this.state !== 'recover' && this.state !== 'dead') this.enter('recover')

    const p = player.pos
    const dist = Math.hypot(p.x - this.pos.x, p.z - this.pos.z)

    // 演出生效：这几拍里她只把身子转向玩家。不动脚、不出手、不排读条——
    // 但吃伤害（`strikeEnemy` 不看这里），所以这一段的收益全归玩家，是惯例不是漏洞。
    if (this.introTicksLeft > 0) { faceSlow(this, p); return }

    switch (this.state) {
      case 'idle':
        faceSlow(this, this.home)
        if (this.alertness > 20) this.enter('investigate')
        else if (this.stateTick > 180) { this.enter('patrol'); this.patrolIdx = this.rng.int(0, this.patrolPoints.length - 1) }
        break
      case 'patrol': {
        const pt = this.patrolPoints[this.patrolIdx % this.patrolPoints.length]
        stepToward(this, pt, dt, this.data.speed * 0.4, rhythm)
        if (dist3(this.pos, pt) < 0.6) {
          this.patrolIdx = (this.patrolIdx + 1) % this.patrolPoints.length
          if (this.patrolIdx === 0) this.onPatrolLoop?.()
        }
        if (this.alertness >= 60) this.enter('investigate')
        break
      }
      case 'investigate': {
        stepToward(this, this.lastKnown, dt, this.data.speed * 0.65, rhythm)
        if (this.alertness >= 100) this.enter('chase')
        else if (this.stateTick > 12 * 24) { this.enter(this.data.archetype === 'basic' ? 'idle' : 'patrol'); this.alertness *= 0.4 }
        break
      }
      case 'alert':
        faceSlow(this, p)
        if (this.data.ai.callAlly && this.stateTick % 36 === 0 && dist < 25 && this.alertness >= 60 && this.alertness < 100 && tick > this.callAllySuppressedUntil && this.rng.chance(0.3)) {
          this.beginCallAlly(tick)
        }
        if (this.alertness >= 100) this.enter('chase')
        else if (this.stateTick > 1800) this.enter('patrol')
        break
      case 'chase': {
        faceSlow(this, p, 0.5)
        const band = this.data.ai.distBands.find((b) => dist >= b.min && dist <= b.max)
        const kites = band?.actions.includes('backstep') ?? false
        const wants = band?.actions.includes('chase') ?? dist > 2
        if (band?.actions.includes('hold')) { /* 伪动作 'hold'：不追不逃，站定唱下去（§14.6 叠唱） */ }
        else if (kites) stepKite(this, p, dt, this.data.speed)
        else if (wants) stepToward(this, p, dt, this.data.speed, rhythm)
        else stepAway(this, p, dt, this.data.speed * 0.7)
        if (this.alertness < 40) this.enter('search')
        const can = this.phaseActions(band?.actions ?? [])
        if (band && hasAttackAction(this, can) && !this.attack && this.stateTick > 24) {
          this.tryAttack(can, rhythm, tick, slotTaken)
        }
        break
      }
      case 'combat': {
        faceSlow(this, p, 0.6)
        const band = this.data.ai.distBands.find((b) => dist >= b.min && dist <= b.max)
        if (this.attack) {
          this.progressAttack(dt, tick, player, rhythm)
          // 射手边拉弓边挪（§14.4「永远背退拉近」）：出手窗口不站桩，但只走半速
          if (band?.actions.includes('backstep')) stepKite(this, p, dt, this.data.speed * 0.45)
        } else {
          if (dist > (this.data.ai.chaseBeyond ?? DEFAULT_CHASE_BEYOND)) { this.enter('chase'); break }
          if (this.data.ai.retreatHpFrac && this.stats.hp / this.stats.hpMax <= this.data.ai.retreatHpFrac) { this.enter('retreat'); break }
          // §14.7 软计时器优先于随机招式：到点就必须敲钟，玩家要打断的是这一拍
          if (this.maybeBarCast(rhythm)) break
          if (band) {
            // 伪动作决定脚下一步：'chase' 贴近、'backstep' 拉开（射手风筝），真招式名才出手
            if (band.actions.includes('chase')) stepToward(this, p, dt, this.data.speed * 0.9, rhythm)
            else if (band.actions.includes('backstep')) stepKite(this, p, dt, this.data.speed)
            const can = this.phaseActions(band.actions)
            if (hasAttackAction(this, can)) {
              this.tryAttack(can, rhythm, tick, slotTaken)
            }
          }
          if (this.alertness < 40) this.enter('search')
        }
        break
      }
      case 'retreat': {
        stepAway(this, p, dt, this.data.speed * 1.1)
        const ally = nearestAlly(this)
        if (ally) stepToward(this, ally.pos, dt, this.data.speed, rhythm)
        if (this.stats.hp / this.stats.hpMax > this.data.ai.retreatHpFrac! * 1.8) this.enter('combat')
        else if (dist > 10) this.enter('combat')
        break
      }
      case 'search': {
        this.searchAngle += dt * 0.8
        const r = 4 + Math.sin(this.stateTick / 40) * 2
        stepToward(this, {
          x: this.lastKnown.x + Math.cos(this.searchAngle) * r, y: 0,
          z: this.lastKnown.z + Math.sin(this.searchAngle) * r
        }, dt, this.data.speed * 0.6, rhythm)
        if (this.alertness >= 100) this.enter('chase')
        else if (this.stateTick > 1200) { this.enter('patrol'); this.alertness = 0 }
        break
      }
      case 'callAlly': {
        if (!this.attack) this.enter(this.alertness >= 100 ? 'chase' : 'alert')
        else this.progressAttack(dt, tick, player, rhythm)
        break
      }
      case 'recover':
        this.attack = null
        if (this.stats.crumpleTicksLeft <= 0 && this.stateTick > 72) {
          this.stats.poiseAccum = 0
          this.enter('combat')
        }
        break
    }
    // §15.3「它也会听心跳」：玩家站住不动 ⇒ 她的警觉慢慢回落（屏息是可行解，不是 bug 绕过）
    const hb = this.data.ai.hearsHeartbeat
    if (hb) {
      if (playerIsMoving(player)) this.stillTicks = 0
      else this.stillTicks++
      if (this.stillTicks >= hb.stillTicks) this.alertness = Math.max(0, this.alertness - hb.decayPerSec * dt)
    }
    if (this.alertness > 0 && this.state !== 'combat') this.alertness = Math.max(0, this.alertness - (this.state === 'alert' || this.state === 'investigate' ? 8 : 20) * dt)
    for (const [k, v] of this.cooldowns) if (v > tick) { void v } else this.cooldowns.delete(k)
    if (this.coreFlash > 0) this.coreFlash -= dt
  }

  private beginCallAlly(tick: number): void {
    const c = this.data.ai.callAlly!
    const spec: AttackSpec = {
      id: 'callAlly', parryable: false, beat: [1, 2, 3, 4],
      frames: { startup: c.broadcastTicks, activeStart: c.broadcastTicks, activeEnd: c.broadcastTicks + 6, recovery: c.broadcastTicks + 24, damage: 0, stamina: 0, poise: 0, hitStopMs: 0, loudness: 9 }
    }
    this.attack = newAttack(spec, 0)
    this.cooldowns.set('callAlly', tick + 600)
    this.enterCallAlly()
    const bc = () => {
      bus.emit('ai.callAlly', { fromId: this.id, pos: { ...this.pos }, range: c.range })
      bus.emit('audio.sfx', { key: 'wail', pos: { ...this.pos }, gain: 0.7 })
    }
    this.pendingBroadcast = bc
  }
  private pendingBroadcast: (() => void) | null = null
  private enterCallAlly(): void { this.enter('callAlly') }

  /**
   * §14.7「敲钟自鸣」软计时器：进战后每 `everyBars` 小节强制插入一次那招长前摇读条，
   * 走完才回血。**故意不占用 tryAttack 的 RNG 候选**——它是节拍器，不是随机招式。
   * 打断走的是既有的读条机制（`pendingBroadcast` + 受击时 `interruptBroadcast`），
   * 所以「破势/硬直/任何一刀砍在前摇里」都能把这一笔血掐掉，无需新状态。
   */
  private maybeBarCast(rhythm: RhythmClock): boolean {
    const t = this.barCast
    if (!t) return false
    const bar = rhythm.info().bar
    if (this.tollDueBar < 0) this.tollDueBar = bar + t.everyBars // 进战第一拍不立刻演
    if (bar < this.tollDueBar) return false
    const spec = this.data.attacks.find((a) => a.id === t.attackId)
    if (!spec) return false
    this.tollDueBar = bar + t.everyBars
    // heal 省略（或满血）⇒ 不为了回血而演这一次，但计时器照常推进
    const heal = t.heal ?? 0
    if (heal > 0 && this.stats.hp >= this.stats.hpMax) return false
    const lead = spec.frames.activeStart
    // `noise: true` —— 这一招的动静由下面读条完成那一刻报（它本来就是全场景最响的一声），
    // active 帧那条通用出口不再重复报一次，否则同一 tick 会有两声。
    this.attack = newAttack(spec, lead - rhythm.ticksUntilBeatOn(spec.beat, lead), true)
    const label = t.label
    this.pendingBroadcast = () => {
      const before = this.stats.hp
      this.stats.heal(heal)
      const got = Math.round(this.stats.hp - before)
      bus.emit('audio.sfx', { key: (spec.frames.sfx ?? [])[0] ?? 'bell_toll', pos: { ...this.pos }, gain: 1 })
      bus.emit('vfx.request', { key: 'ring_echo', pos: { ...this.pos }, scale: 1.8 })
      bus.emit('sound.source', { id: this.id, pos: { ...this.pos }, loudness: (spec.frames.loudness ?? 3) / 10 })
      if (label && got > 0) bus.emit('ui.notify', { text: `${label} · 回复 ${got}`, kind: 'info' })
    }
    return true
  }

  /**
   * §15/§16 Boss 阶段机：按血线单调跳阶，跳阶那一刻手上的读条作废（她要去敲钟怒吼）。
   * 阶段换了的是**招式白名单与护壳规则**，不是倍率——§16 明确不许「纯数值阶段」。
   */
  private syncBoss(): void {
    const b = this.data.boss
    if (!b) return
    if (this.shellLiftTicks > 0) this.shellLiftTicks--
    const frac = this.stats.hp / this.stats.hpMax
    let next = this.bossPhase
    for (let i = next + 1; i < b.phases.length; i++) {
      const gate = b.phases[i].belowHpFrac
      if (gate !== undefined && frac < gate) next = i // 允许一次跨过两阶
    }
    if (next !== this.bossPhase) this.advanceTo(next)
  }

  /**
   * KI-024 场地阶段入口：下一阶若声明了 `enterOnProps`，场地上该类 prop 剩余 ≤`atMost`
   * 就进入（与血线入口同一条单调推进、同一套跳阶后事）。AISystem 每 tick 用 PropSystem 的
   * 现状喂一次——她不认识 props，这个数是世界的读数，不是她自己维护的账。
   */
  checkFieldPhase(props: { remainingByKind(kind: string): number }): void {
    const b = this.data.boss
    if (!b || !this.alive) return
    const next = this.bossPhase + 1
    const gate = b.phases[next]?.enterOnProps
    if (!gate) return
    if (props.remainingByKind(gate.kind) > gate.atMost) return
    this.advanceTo(next)
  }

  /** 跳阶的那一套后事只有一份：读条作废、演怒吼、换气排程与抢拍余量清零（§15.2「时钟重置」） */
  private advanceTo(next: number): void {
    this.bossPhase = next
    this.attack = null
    this.phaseRoarPending = true
    this.tollDueBar = -1
    this.stealNeutralTicks = 0
  }

  /** §15.2 夺拍配置（只有带着它的阶段才会触发全场减益） */
  get stealBeat(): NonNullable<NonNullable<EnemyData['boss']>['phases'][number]['stealBeat']> | null {
    return this.bossPhaseData?.stealBeat ?? null
  }
  /**
   * §15.2「（过载期）网格加速至 120BPM」：阶段可以换掉接管时的拍速，省略＝跟着 `boss.bpm`。
   * 全场只有一个出口读它（`AISystem.syncClock`），所以入场演出的拍长、每小节的读条排程、
   * 玩家的拍点判据都跟着同一格走——"管风琴过载"不是她一个人的事。
   */
  get clockBpm(): number | undefined { return this.bossPhaseData?.bpm ?? this.data.boss?.bpm }
  get clockBeatsPerBar(): number { return this.bossPhaseData?.beatsPerBar ?? this.data.boss?.beatsPerBar ?? 4 }
  /**
   * §15.2「过载期其攻击前摇 -20%」：换算成"前摇段每 tick 多走几帧"（0.8 ⇒ 1.25×），
   * 判定窗与收势一拍不短——更早落刀不该换来更长的破绽窗。走 §14.6 定调那台攒帧加速器，
   * 因为帧表全是整数 tick 且 `===` 判定，不能把 tick 变成浮点。
   */
  get startupSpeedMul(): number {
    const m = this.bossPhaseData?.startupMul
    return m !== undefined && m > 0 && m < 1 && this.inStartup ? 1 / m : 1
  }
  /**
   * 「到点必须做的一件事」的两种来源：Boss 挂在阶段上（阶段会换），普通敌人挂在 ai 上。
   * §14.7 的敲钟自鸣与 §15.2 的换气拍因此共用一条排程器，而不是两套 if。
   */
  get barCast(): { everyBars: number; attackId: string; heal?: number; label?: string } | null {
    return this.bossPhaseData?.barCast ?? this.data.ai.selfToll ?? null
  }
  /** 正在读「换气拍」那口气（前摇期）——玩家唯一能把拍抢回来的时刻 */
  get inBreath(): boolean {
    return !!this.attack?.spec.reclaimWindow && this.attack.tick < this.attack.spec.frames.startup
  }
  /**
   * 阶段白名单（非 Boss 原样返回）：改表即改「这一阶她会什么」。
   * 公开是因为 F4 面板要报的是同一个交集：私有的话面板只能自己再抄一遍 `allow.includes`，
   * 那条规则就出现两个主人——而它恰恰是最容易在改表时只对上一半的那种规则。
   */
  phaseActions(actions: string[]): string[] {
    const allow = this.bossPhaseData?.attacks
    return allow ? actions.filter((a) => allow.includes(a)) : actions
  }

  /**
   * §15.1 撞钟机关：她那记 `flags:['charge']` 的落地帧附近若有一口还没响的钟，钟就响了。
   * 判据是**她自己的位置**（冲刺已经把她带到钟边），所以「引她撞钟」是站位问题、
   * 不是反应力问题——玩家要做的是站在钟前面让她冲过来，而不是拼一把弹反。
   */
  private ringBells(): void {
    const g = this.data.boss?.bells
    if (!g) return
    for (let i = 0; i < g.positions.length; i++) {
      if (this.bellsRung[i]) continue
      if (dist3(this.pos, g.positions[i]) > g.hitRadius) continue
      this.bellsRung[i] = true
      this.shellLiftTicks = Math.max(this.shellLiftTicks, g.releaseTicks)
      const rung = this.bellsRung.filter(Boolean).length
      bus.emit('audio.sfx', { key: 'bell_toll', pos: { ...g.positions[i] }, gain: 1 })
      bus.emit('vfx.request', { key: 'shock_small', pos: { ...g.positions[i] }, scale: 2.4 })
      bus.emit('ui.notify', {
        text: `立钟鸣响 · 钟壳共振解除 ${(g.releaseTicks / TICK_HZ).toFixed(1)}s（${rung}/${g.positions.length}）`,
        kind: 'reward'
      })
      if (rung >= g.breaksAt && !this.shellBroken) {
        this.shellBroken = true
        bus.emit('vfx.request', { key: 'death_shatter', pos: { ...this.pos }, scale: 2 })
        bus.emit('ui.notify', { text: '钟壳碎裂！这一阶的减伤彻底没了', kind: 'reward' })
        // §15.1「撞 2 钟 = 壳碎（提前进 P2 条件）」：机关本身就是转阶段的捷径，不必把血磨到线
        if (this.bossPhase === 0 && (this.data.boss?.phases.length ?? 0) > 1) { // 【恒死·批23】本支挂在 bells 配置之下 ⇒ boss 恒在且 phases 必为数组：可选链空腿与 ?? 0 兜底不可达（true 腿由撞双钟点亮）
          this.bossPhase = 1
          this.attack = null
          this.phaseRoarPending = true
        }
      }
      break // 一记冲刺只撞得响一口钟
    }
  }

  private tryAttack(actions: string[], rhythm: RhythmClock, tick: number, slotTaken: (k: string) => boolean): void {    const usable = actions.filter((a) => !PSEUDO_ACTIONS.has(a) && !((this.cooldowns.get(a) ?? 0) > tick))
    if (!usable.length) return
    // 'cycle' = 按表的顺序轮转（§15.2「每 4 小节一个乐句，玩家可背谱」：随机背不了谱）
    let pick: string | undefined
    if (this.data.ai.pickOrder === 'cycle') {
      const start = this.cycleIdx % actions.length
      for (let i = 0; i < actions.length; i++) {
        const cand = actions[(start + i) % actions.length]
        if (usable.includes(cand)) { pick = cand; this.cycleIdx = start + i + 1; break }
      }
    } else pick = this.rng.pick(usable)
    if (!pick) return // 【恒死·批23】usable ⊆ actions 且非空 ⇒ cycle/随机两支必中其一，pick 不会是 undefined
    const spec = this.data.attacks.find((a) => a.id === pick)
    if (!spec) return
    // §2.1：约束的是**命中帧**落在拍点，不是起手帧 ⇒ 起手要提前一整个前摇。
    // （旧写法把 tick 0 当成拍点，结果所有招式的命中都比拍点晚 0.2~0.6s：
    //  蓄力重的敌人「看着像在重拍上，其实在重拍之后」，§2.1 的可预测性直接失效。）
    const offGrid = spec.onGrid === false
    const lead = spec.frames.activeStart
    const beatWait = offGrid ? 0 : rhythm.ticksUntilBeatOn(spec.beat, lead)
    if (!offGrid) {
      const key = attackSlotKey(rhythm.info().bar, rhythm.info().beatInBar, spec.beat[0])
      if (slotTaken(key)) return
    }
    this.attack = newAttack(spec, lead - beatWait)
    this.cooldowns.set(spec.id, tick + 240 + this.rng.int(0, 120))
    this.enter('combat')
    if (spec.id === 'callAlly' || pick === 'scream') {
      const c = this.data.ai.callAlly
      if (c) this.pendingBroadcast = () => bus.emit('ai.callAlly', { fromId: this.id, pos: { ...this.pos }, range: c.range })
    }
  }

  private progressAttack(dt: number, tick: number, player: PlayerController, rhythm: RhythmClock): void {
    if (!this.attack) return
    const advanced = this.advanceAttackFrames((this.buff?.attackSpeedMul ?? 1) * this.startupSpeedMul)
    const f = this.attack.spec.frames
    // 赤线 telegraph 期间持续跟踪目标：线是「它会打哪」的诚实承诺，玩家要能看到被牵着
    if (f.projectile?.telegraph && this.attack.tick >= 0 && this.attack.tick < f.startup) {
      faceSlow(this, player.pos, 0.3)
    }
    // 敌人的前摇音：audio.md §7.2 要求「听见起手」而不是「看见落点」——本作核心反馈通道，
    // 但此前 enemies.json 里那 8 套 sfx 字段根本没有发射方（只有玩家招式与弹道发射在响）。
    // 它排在"读条走完"那一格**之前**是有意的：撞钟会就地跳阶并把招式收掉（下面那句 return 就是为此）。
    if (!this.attack.sfxDone && f.sfx?.[0]) {
      this.attack.sfxDone = true
      bus.emit('audio.sfx', { key: f.sfx[0], pos: { ...this.pos }, gain: 0.55 + Math.min(0.3, (f.loudness ?? 4) / 20) })
    }
    // KI-092②：§8.2「Boss 大招 telegraph」一行的发射口。`tutti` 是数据里的大招标记
    // （combat.md §697 音栓蓄力大招"全奏 Tutti"），带它的招式起手那一次 ⇒ 音频侧压低 AMB
    // 全层 1.5s（危险独占听觉空间）。只发一次（telegraphDuckDone），与起手音同一格。
    if (!this.attack.telegraphDuckDone && f.flags?.includes('tutti')) {
      this.attack.telegraphDuckDone = true
      bus.emit('combat.bossTelegraph', undefined) // 无载荷事件；声明跟着发射方走，见本文件底部的 GameEvents 合并块
    }
    // 「读条走完」那一格的两件事（警戒广播、冲刺撞钟）共用一次守卫：判定从 `=== f.startup`
    // 改成"过了那一格且没做过"，否则任何前摇加速都会一步跨过去 ⇒ 广播与撞钟一起静默。
    if (this.attack.tick >= f.startup && !this.attack.startupDone) {
      this.attack.startupDone = true
      if (this.pendingBroadcast) {
        this.pendingBroadcast()
        this.pendingBroadcast = null
      }
      // §15.1 撞钟机关：冲刺的落地帧（=读条走完那一格）附近有别人才响得动的钟
      if (f.flags?.includes('charge')) this.ringBells()
    }
    // 撞钟可能就地跳阶（§15.1「撞 2 钟 = 提前进 P2」），而跳阶会把这一招收掉 ⇒ 别再用陈旧的帧表
    if (!this.attack) return
    // `advanced > 0`：被 §9 按住的那几 tick 不许往前蹭位移——"人定在原地滑行"是这套机制最容易
    // 长出来的假动作，而本作读的就是"它有没有真的停下来"。
    if (advanced > 0 && this.attack.tick > 0 && this.attack.tick <= f.activeEnd && f.lunge && !this.intangible) {
      faceSlow(this, player.pos, 1)
      // don't lunge through the player: stop at melee contact distance
      const dToP = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z)
      if (dToP > 0.85) {
        const step = Math.min(f.lunge / Math.max(1, f.activeEnd - f.startup), dToP - 0.8)
        this.pos.x += Math.sin(this.yaw) * step
        this.pos.z += Math.cos(this.yaw) * step
      }
    }
    if (this.attack.tick >= f.recovery) {
      // 连段派生（§14.5 切分连踏「2 段半拍」）：下一段不在这一拍上硬顶，而是量化到它自己的
      // 拍位再打——两段之间因此留下真实的呼吸拍，这正是 §13.1 要求的惩罚窗口。
      const next = f.next ? this.data.attacks.find((a) => a.id === f.next) : undefined
      if (next) {
        const nextLead = next.frames.activeStart
        this.attack = newAttack(next, nextLead - rhythm.ticksUntilBeatOn(next.beat, nextLead))
      } else this.attack = null
    }
  }

  interruptBroadcast(tick: number): void {
    if (this.attack && this.attack.tick < this.attack.spec.frames.startup && this.pendingBroadcast) {
      this.pendingBroadcast = null
      this.attack = null
      this.callAllySuppressedUntil = tick + 120
      // §8 R1 那一档的时长：读条被打断的人原地失音 200ms。这个数曾经写死成 12 格，
      // 与 reactions.json 的 R1 行是同一条账的两个主人（KI-052① 把它接回表上）。
      this.stunTicks = reactionTier('R1').stunTicks
    }
  }

  onDamaged(knockDir?: Vec3): void {
    // §8 R0 那一格的语义：材质发光是「这一记穿进了身子、但架势还没破」的确认。
    // 破势之后眼睛该看的是那条更大的演出（recover + 处决窗口），所以这里让位——
    // 时长自 KI-052① 起住在 reactions.json，代码里不再有第二个 0.15。
    if (this.stats.crumpleTicksLeft <= 0) this.coreFlash = materialFlashSeconds()
    if (this.state === 'idle' || this.state === 'patrol' || this.state === 'investigate' || this.state === 'search') {
      this.alertness = 100
      this.enter('chase')
    }
    if (!this.data.ai.deaf) void knockDir
  }

  onParried(tick: number): void {
    // §14.7「弹反钟锤二连第二段 → 钟体共振眩晕 2s」：只有写了 parryStunTicks 的招式给这个回报
    const resonant = this.attack?.spec.parryStunTicks
    this.stunTicks = resonant ?? 18
    this.attack = null
    this.pendingBroadcast = null
    this.cooldowns.set('parryLock', tick + 60)
    if (resonant && resonant > 18) {
      bus.emit('vfx.request', { key: 'shock_small', pos: { ...this.pos }, scale: 1.5 })
      bus.emit('ui.notify', { text: `钟体共振！失衡 ${(resonant / TICK_HZ).toFixed(1)}s`, kind: 'info' })
    }
  }
}

declare module '@/core/EventBus' {
  interface GameEvents {
    'ai.callAlly': { fromId: string; pos: Vec3; range: number }
    /**
     * KI-092②：§8.2 ducking 表里「Boss 大招 telegraph」那一行的触发源，**无载荷**——音频侧只要
     * 「这一下是大招」的信号，不需要位置。发射方是本文件 :932（带 `tutti` 标记的招式起手那一 tick），
     * 所以声明跟着发射方走，与上面 `ai.callAlly` 同一只手；`EventBus.ts` 里若另有同型声明，
     * 接口合并同名同型不报错（谁先落地都不用等对方，也不会把主干切成「提交面过不了自己的 lint」）。
     */
    'combat.bossTelegraph': undefined
  }
}

function norm(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

function dist3(a: Vec3, b: Vec3): number { return Math.hypot(a.x - b.x, a.z - b.z) }

function faceSlow(e: Enemy, t: Vec3, rate = 0.15): void {
  const want = Math.atan2(t.x - e.pos.x, t.z - e.pos.z)
  e.yaw += norm(want - e.yaw) * rate
}

function stepToward(e: Enemy, t: Vec3, dt: number, speed: number, _rhythm: RhythmClock): void {
  if (e.intangible) return // §14.5「仅半拍窗内位移」：拍点上定身，包括追击/逃跑/搜索
  // KI-009 第一腿（combat.md §595）：注入过导航器时先问一句「直着走过去会撞墙吗」——会，就把这一步
  // 的目标换成绕路的第一个拐点。没注入、绕不过去、或这一片天本来没有 authored 墙 ⇒ 目标原样，
  // 脚步与导航落地之前**逐字节相同**（这就是"老行为是新行为的回落分支"那句话的实现）。
  const goal = e.nav ? e.nav(e.pos, t, agentRadius(e)) : t
  const dx = goal.x - e.pos.x, dz = goal.z - e.pos.z
  const l = Math.hypot(dx, dz)
  if (l < 0.05) return
  e.pos.x += (dx / l) * speed * dt
  e.pos.z += (dz / l) * speed * dt
}

/**
 * 这一只的体格（导航半径，KI-009 第一腿）。和 `bodyHeight()` 同一支笔：灰盒身体是**圆柱**，
 * 身高 1.6 × scale、半径 0.5 × scale——两个尺寸都从 `body.scale` 乘出来，不在代码里另立一格
 * （§55：视觉体与"走路的那个体"不许各写一个尺寸，否则玩家看到的是穿模、量到的是另一回事）。
 * 要求文档哪天给出正式体格表（`ai.agentRadius` 这种），这里就改成读那一格，形状与
 * `ai.kiteRange` 同族。
 */
function agentRadius(e: Enemy): number {
  return 0.5 * (e.data.body?.scale ?? 1)
}

function stepAway(e: Enemy, t: Vec3, dt: number, speed: number): void {
  stepToward(e, { x: 2 * e.pos.x - t.x, y: 0, z: 2 * e.pos.z - t.z }, dt, speed, null as never)
}

/**
 * 射手的「背退拉近」（combat.md §14.4）：永远朝远离目标的方向走，但只在
 * `ai.kiteRange` 的家里半径内拉——否则它会一路退到地图边缘，玩家追不上也打不到。
 */
function stepKite(e: Enemy, t: Vec3, dt: number, speed: number): void {
  const limit = e.data.ai.kiteRange ?? 0
  if (limit > 0 && dist3(e.pos, e.home) >= limit) return
  stepAway(e, t, dt, speed)
}

/** 距离带里的伪动作：只决定脚步，不能当成招式出手 */
const PSEUDO_ACTIONS = new Set(['chase', 'backstep', 'hold'])

/**
 * 拍位插槽的键（§2.1 命中帧落拍）。领用方与读数方共用这一条：F4 面板打印的键必须就是
 * `slotTaken` 听到的那个串，否则面板上"这一拍有没有人"读的是自己编的格式，看着对、其实从未对上。
 */
export function attackSlotKey(bar: number, beatInBar: number, specBeat: number): string {
  return `${bar}:${beatInBar}:${specBeat}`
}

function hasAttackAction(e: Enemy, actions: string[]): boolean {
  return actions.some((a) => !PSEUDO_ACTIONS.has(a) && e.data.attacks.some((atk) => atk.id === a))
}

function playerIsMoving(p: PlayerController): boolean {
  return p.stats.stamina < p.stats.staMax && p.grounded === true && (p.camYawRef !== null) && moving(p)
}
function moving(p: PlayerController): boolean { return p.action === null ? true : false }

let registryRef: Enemy[] | null = null
export function bindEnemyRegistry(list: Enemy[]): void { registryRef = list }
function nearestAlly(e: Enemy): Enemy | null {
  if (!registryRef) return null
  let best: Enemy | null = null
  let bd = 1e9
  for (const o of registryRef) {
    if (o === e || !o.alive) continue
    const d = dist3(e.pos, o.pos)
    if (d < bd) { bd = d; best = o }
  }
  return best
}

export { clamp }
