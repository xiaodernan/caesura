import { bus } from '@/core/EventBus'
import { Rng } from '@/core/Math'
import type { GameTime } from '@/core/Time'
import { TICK_DT, TICK_HZ, msToTicks } from '@/core/Time'
import type { RhythmClock } from '@/core/RhythmClock'
import type { Input } from '@/core/Input'
import type { PlayerController, ActivePlayerHit } from '@/player/ThirdPersonController'
import type { AISystem } from '@/ai/AISystem'
import type { Enemy } from '@/ai/Enemy'
import type { AttrKey, EnemyData, FrameData, IncomingGrade, ProjectileSpec, ReactionStunTier } from '@/data/schema'
import { resolveDamage } from './DamagePipeline'
import { reactionTier } from './Reactions'
import { shapeHits, isBackstab } from './HitShapes'
import type { HitTarget } from './HitShapes'
import { ProjectileSystem, sphereHits, type GoneReason, type Projectile } from './Projectiles'
import { OcclusionField, type BlockHit } from '@/core/Occlusion'
import { glossary, statusConfig, tagIs } from './Statuses'
import type { Vec3 } from './EntityStats'
import type { PropSystem } from '@/world/Props'

type ExecuteKind = 'A' | 'B' | 'C'

/** 防御阶梯的结果：弹体分支要靠它决定「消失 / 穿过 / 反射」 */
type DefenseOutcome = 'parry' | 'perfectBlock' | 'immune' | 'block' | 'guardBreak' | 'hit' | 'none'

/** 一条「它要往这里打」的预告线（combat.md §14.4），由 CombatManager 算、ProjectileVisuals 画 */
export interface TelegraphLine {
  ownerId: string
  kind: string
  from: Vec3
  to: Vec3
  ticksLeft: number
  totalTicks: number
}

/** 一次「打在某人身上」的全部决策输入；近战与弹体共用同一条结算通道（combat.md §12） */
interface EnemyStrike {
  base: number
  poise: number
  hitStopMs: number
  kind: 'light' | 'heavy' | 'skill'
  /** 震裂层数（§11） */
  layers: number
  mute: boolean
  backstab: boolean
  onBeat: boolean
  ranged: boolean
  /** 钉住定身 tick（投掷枪） */
  pinTicks: number
  /**
   * §9 攻方那一半的身份凭据：这一记是玩家**哪个出手动作**打出来的（近战＝此刻的 `action`）。
   * 弹体与回声那一类"离手之后才落"的命中故意不填——出手的那一记早就收势了，
   * 按停"此刻正在挥的下一记"等于凭空抢走一次没有发生的接触的时间。
   */
  sourceAction?: object
  /**
   * §11 回响重演：已经算完的伤害直接进来，绕过减伤/钟甲/钟壳/暴击/叠层——
   * 那一音是「上一击的尾巴」，不是新的一击。给它再走一遍完整管线就会自我繁殖。
   */
  rawDamage?: number
  /**
   * §11 闷音的施加时长（tick）。写 0/省略＝这一记不挂闷音。
   * 时长永远来自施加方（敌人招式、弹道、战技等级），状态表只回答"挂着的时候值多少"。
   */
  muteTicks?: number
  /** 追加真伤（全音符斩）：减伤、钟甲、钟壳、暴击都算完之后再加的一笔——它本来就是"绕过这些"的伤 */
  trueDamage?: number
  /**
   * §7 战技出手的伤害标尺。非 null ⇒ 这一笔不是武器打的：
   * 属性缩放换成战技自己那张小表（音色），并且**不吃武器强化倍率与武器架式倍率**——
   * 你的剑淬到 +10 不会让一记瞬步更疼。省略＝武器出手（近战/投掷/回声），走原有全套。
   */
  movement?: { scaling: Partial<Record<AttrKey, number>>; overdriveLayerMul: number }
  /**
   * §8 反应分级的**出手侧声明**（KI-052①）。不写＝按下面的重量轴取档；写＝这一式自己点名要那一档
   * （今天只有强音大剑的跳劈写 R3，那是 §4.2 逐字点名的"附加击倒"）。
   */
  reaction?: ReactionStunTier
  point: Vec3
  dir: Vec3
  shakeKey: string
}

/**
 * §8 的三档反应按**引擎已有的出手重量轴**取档（KI-052① 的裁决）：
 * 设计文本自己就用这套话说事——R1 那行写的是「中断轻击前摇；不打断重击与蓄力」。
 * 所以这里不是发明第二把尺子，而是把"轻/重"这一格早就存在的读数接到表上；
 * 招式帧若要偏离这个默认（跳劈的击倒），在帧上写 `reaction`，那一格优先。
 */
const TIER_BY_KIND: Record<EnemyStrike['kind'], ReactionStunTier> = { light: 'R1', heavy: 'R2', skill: 'R2' }

/**
 * 打在**敌人**身上的那一档只可能是"给得出硬直"的那三档（R0 只发光，R4/R5 各走自己的通道）。
 * 弹体那条通道里 `!hostile` 那一支才会打中人，所以这不是放宽判据，只是把它写成类型。
 */
const stunTier = (g: IncomingGrade | undefined): ReactionStunTier | undefined =>
  g === 'R1' || g === 'R2' || g === 'R3' ? g : undefined

/** 玩家要防御的一击：敌方近战与敌方弹体走同一个阶梯（§5：弹反 > 无敌帧 > 完美格挡 > 格挡 > 硬吃） */
interface Threat {
  attackerId: string
  damage: number
  poise: number
  hitStopMs: number
  kind: 'light' | 'heavy' | 'skill' | 'enemy'
  point: Vec3
  dir: Vec3
  /** 威胁来自哪里（弹反朝向判定用；弹体用弹体自身位置） */
  from: Vec3
  parryable: boolean
  ranged: boolean
  /** §9 攻方那一半：这一记来自出手者此刻的哪个招式对象（弹体不填＝离手了，见 `EnemyStrike.sourceAction`） */
  sourceAction?: object
  statusOnHit?: { tag: string; layers: number; ticks?: number }
  /**
   * §8 来袭档位（KI-052②）：敌人那一招声明自己算哪一档。
   * 它**不改玩家挨打的时长**——§8 末行把那一格钉死成 R1 等效（"操作权不没收"是这类型的底线）；
   * 它改的是**这一记有没有权利没收你正在出的那一式**（R1「不打断重击与蓄力」/ R2「中断一切非霸体」）。
   * 不写＝按 R1 处理（最保守的那一档：只没收轻击）。
   */
  reaction?: IncomingGrade
  /** 攻击方一侧的后果：近战敌人被弹反会硬直+破势，弹体被弹反就凭空消失 */
  react(tick: number, outcome: 'parry' | 'perfectBlock'): void
}

/** hit-resolution orchestrator — docs/combat.md §5/§7/§12 */
export class CombatManager {
  rng = new Rng('combat')
  /** 弹道运行时（投掷枪 / 远程敌人）；表现层每帧读 list()，逻辑层不认识 three */
  readonly projectiles = new ProjectileSystem()
  private killed = new Set<string>()
  private execCount = new Map<string, number>()
  /** 注入：脚下地面高度查询（world/Surface），用于「射进地面就落地」；缺省则只做射程/寿命到期 */
  floorAt: ((pos: Vec3) => number | null) | null = null
  /**
   * 遮挡体名册（KI-014①②）：实体侧每 tick 由 {@link update} 从场上的 Boss 重新点名，
   * 关卡侧（authored 墙）由组合根在跨区时写一次（`syncAuthored`）。
   * 它是 `core/Occlusion` 的一个实例而不是注入项，因为**读它的人全在 combat 层**
   * （弹体扫掠段、打在玩家身上的那一线、telegraph 红线），而注入一份可空的遮挡会让
   * "忘了接线"表现成"场上的柱子忽然挡不住东西"——那种谎在 headless 里是静默的。
   */
  readonly occlusion = new OcclusionField()
  /**
   * 线段查询的两个复用端点：热路径上每 tick 要问几十次，而 `firstBlock` 只在调用期间读它们、
   * 出去时把结果**复制**成新的 `at`，所以复用不会留下别名。
   */
  private readonly segA: Vec3 = { x: 0, y: 0, z: 0 }
  private readonly segB: Vec3 = { x: 0, y: 0, z: 0 }

  constructor(
    private player: PlayerController,
    private ai: AISystem,
    private time: GameTime,
    private rhythm: RhythmClock
  ) {
    bus.on('entity.died', () => this.checkEncounterMusic())
    // 主人被流送回收后，它的弹体不该继续追人（§5.5 出怪回收闭环）
    bus.on('entity.despawned', ({ id }) => {
      for (const p of this.projectiles.withOwner(id)) this.projectiles.kill(p, 'expire')
    })
  }

  /**
   * KI-023 可破坏场景物（组合根注入，null = 场上没有 props；与 `floorAt` 同一套注入纪律，
   * combat 层不 import world 的运行时）。命中参与走同一条 `shapeHits`、同一次数预算
   * （`markActionHit`），所以"一记只结一次账"对场地件同样成立。
   */
  props: PropSystem | null = null

  checkEncounterMusic(): void {
    const anyAggro = this.ai.enemies.some((e) =>
      e.alive && (e.state === 'combat' || e.state === 'chase' || e.state === 'alert' || e.state === 'callAlly'))
    bus.emit('audio.music.encounter', { start: anyAggro })
  }

  update(tick: number, input?: Input, dt = TICK_DT): void {
    // 遮挡名册每 tick 重新点名**实体那一段**：Boss 离场她的柱子就退出判据。
    // authored 墙不在这里动——它住在区域数据里，由组合根跨区时写（`syncAuthored`）。
    this.occlusion.syncFrom(this.ai.enemies)
    this.tryExecute(input, tick)
    this.launchPlayerProjectile(tick)
    this.launchEnemyProjectiles(tick)
    this.playerHitsEnemies(tick)
    this.playerHitsProps()
    this.caesuraFreeze()
    if (!this.player.executing) this.enemiesHitPlayer(tick)
    this.phaseCounter(input)
    this.bossBits()
    this.stealBeat(tick, input)
    this.projectilePass(tick, dt)
    this.tickEchoes(tick)
    this.arbiteMuffle()
    if (tick % 30 === 0) this.checkEncounterMusic()
  }

  /* ======================= 近战：玩家 → 敌人 ======================= */

  private playerHitsEnemies(tick: number): void {
    const hb = this.player.activeHitbox
    if (!hb?.box) return
    for (const e of this.ai.enemies) {
      if (!e.alive) continue
      if (e.intangible) {
        // §14.5：拍点上的它不存在「被打中」这件事——刃穿过去，不占这一记的目标名额
        if (shapeHits(hb.box, this.player.pos, hb.yaw, e.hitTarget())) this.cuePhaseThrough(e)
        continue
      }
      const hit = shapeHits(hb.box, this.player.pos, hb.yaw, e.hitTarget())
      if (!hit) continue
      const p = this.player
      // 判定窗有好几 tick：同一记对同一个人只结一次账，多目标名额用尽才收
      if (!p.markActionHit(e.id)) continue
      const skill = p.action?.skill ?? null
      const kind: EnemyStrike['kind'] = skill
        ? 'skill'
        : (p.action?.key ?? '').startsWith('l') ? 'light' : 'heavy'
      // 起手式只在**真打到人**的那一记上兑现（挥空不该把全音符斩白白用掉）
      const followup = p.takeFollowup(kind === 'heavy')
      const point = midpoint(p.pos, e.pos)
      const final = this.strikeEnemy(e, {
        base: hb.damage, poise: hb.poise, hitStopMs: hb.hitStopMs,
        kind,
        // 战技自带层数；武器出手走按键默认（§11），两者都还可以被起手式追加一层
        layers: (skill ? skill.fissureLayers : this.fissureLayersOf(p.action?.key ?? '', p.action?.f, hb)) + (followup?.layers ?? 0),
        mute: hb.flags.includes('mute') || (skill ? skill.muteTicks > 0 : false),
        muteTicks: skill?.muteTicks ?? 0,
        trueDamage: followup?.trueDamage ?? 0,
        movement: skill && skill.damage > 0 ? { scaling: skill.scaling, overdriveLayerMul: skill.overdriveLayerMul } : undefined,
        backstab: isBackstab(p.pos, e.hitTarget()),
        onBeat: this.rhythm.onBeat(this.player.beatGraceTicks > 0 ? 80 : 50), // 常拍脚（KI-036）：±80ms 宽限
        ranged: false, pinTicks: 0,
        point, dir: flatDir(p.pos, e.pos),
        reaction: hb.reaction,
        shakeKey: hb.shake,
        sourceAction: p.action ?? undefined
      }, tick)
      // §11 回响：挂不挂影由**这一帧自己声明**（frames.echoOnHit）。不能反过来在结算通道里
      // 判「kind==='heavy'」——投掷弹体也标成 heavy，那样引针枪每发都会凭空生出回声。
      if (p.action?.f?.echoOnHit) this.spawnEcho(point, final, hb.poise, tick)
      // 一击一名目标是老规矩；写了 multi 的环形技打到名额用尽才收（markActionHit 负责数）
      if (this.player.action?.hitDone) break
    }
  }

  /** 显式 fissureLayers 优先，否则沿用重击家族的按键默认（§11） */
  private fissureLayersOf(key: string, f: FrameData | undefined, hb: ActivePlayerHit): number {
    const declared = f?.fissureLayers
    const byKey = key === 'charged' ? 2 : key === 'h' ? 1 : 0
    return (declared ?? byKey) + (hb.flags.includes('fissure') ? 1 : 0)
  }

  /**
   * KI-023：玩家出手对可破坏场景物的那一扫。与敌人扫描共用同一个判定窗、同一次数预算
   * （`markActionHit`）——一记横扫同时罩住敌人与场地件时，敌人先结账（先扫先得），
   * 场地件只在还有名额时吃这一记。计数型（音刺）轻击只响不裂、血量型（振源核）任何
   * 一记都按原始伤害扣池——两条裁决的分支住在 `PropSystem.hitProp`。
   * props 不产 `combat.hit`：它没有伤害数字、没有 hitstop、没有架势——那些语义全是"打到了某个人"的。
   */
  private playerHitsProps(): void {
    const props = this.props
    if (!props) return
    const hb = this.player.activeHitbox
    if (!hb?.box) return
    const p = this.player
    const kind: 'light' | 'heavy' | 'skill' = p.action?.skill
      ? 'skill'
      : (p.action?.key ?? '').startsWith('l') ? 'light' : 'heavy'
    for (const prop of props.all) {
      if (!props.hittable(prop)) continue
      if (!shapeHits(hb.box, p.pos, hb.yaw, props.hitTarget(prop))) continue
      if (!p.markActionHit(prop.id)) continue
      props.hitProp(prop, { heavyFamily: kind !== 'light', rawDamage: hb.damage })
    }
  }

  /**
   * §9「冻结攻守双方动画时间」——两侧都按，但走**两条独立的账**（KI-017 第二、三步）：
   * - 守方（`victim`）：被这一记打中的那 `msToTicks(hitStopMs)` 个 tick 里，硬直倒数不走。
   * - 攻方（`attacker` + `sourceAction`）：正在出手的那一式招式帧被按住同样的格数，随后每 tick
   *   补一帧还回去（回拍补帧）⇒ 这一式的**结束 tick 与净时长都不变**，拍位因此不动。
   *   判据、封顶与"带连发拍位的弹道招式为何整式豁免"都在 `combat/ActionFrames.ts`。
   *
   * 三条口径，各自都有实测支撑（见 KI-017 行）：
   * - **不挂全局停表**：全局停表会连拍网格与场上所有人的招式一起停，而那一行说的只是攻守双方；
   *   KI-017 第一步刚把拍网格从动画时标上摘下来，第二步不该从后门把它装回去。
   * - **身份必须对上**：`sourceAction` 与出手者此刻的招式对象不是同一个 ⇒ 不按。弹体命中时它早
   *   就离手了，按停"此刻正在挥的那一记"等于凭空抢走一次没有发生的接触的时间。
   * - **不复用 §7.2 的 `frozenTicks`**：那是"这只生物的节拍被拿走了几十 tick"（整个 update 短路），
   *   这是"这一记接触的三到五格"（AI 决策、架势衰减照走）。同一件事只有一格账。
   *
   * 时长只有一个来源：那一格的 `frames.hitStopMs` 或 §9 情境表里的一个数，与相机吃的是同一个。
   */
  private freezeContact(ms: number, victim: { stunStopTicks: number } | null, attacker: { freezeAction(ms: number, src: object): number } | null, sourceAction: object | null): void {
    const n = msToTicks(ms)
    if (n <= 0) return
    if (victim) victim.stunStopTicks = Math.max(victim.stunStopTicks, n)
    if (attacker && sourceAction) attacker.freezeAction(ms, sourceAction)
  }

  /** 按 id 找出手者（弹反/格挡/受击那三条情境路径只有 `attackerId` 可依据） */
  private attackerById(id: string): Enemy | null {
    return this.ai.enemies.find((x) => x.id === id) ?? null
  }

  /**
   * §7.2 休止斩：这一式的判定窗里，场上每个还活着的敌人被按住 `freezeTicks`（玩家照常动）。
   *
   * 三条口径要单独说清，否则这条会慢慢长出别人没有的特权：
   * - **它不走 `strikeEnemy`**：那一通道的一切前提都是"打到了某个人"（伤害、架势、震裂、命中音、
   *   hitstop、`combat.hit` 事件）。时停打在**没有人**的地方——一场一个敌人都没打着、或者干脆
   *   没有敌人，停顿照样发生。硬挤进命中通道就会变成"要打中才停"，那不是 §7.2 写的那一式。
   * - **一记只结一次**：判定窗有 7 tick，用出手那一次的动作对象当身份（同 `cuePhaseThrough` 的打法）。
   * - **冻结落在 `Enemy.frozenTicks` 而不是 `stunTicks`**：定身作废读条，时停把读条停在原地
   *   （差别有断言钉住，见 `Enemy` 那条注释）。
   *
   * 敌方弹体一起冻结（`Projectile.frozenTicks`，同一记、同一格时长）：这一式的**全部产品就是
   * 时间**，如果对面是针喉，"全场停下"却有一发音弹照常飞过来把玩家打死在停顿里，那这一式对远程
   * 敌人是个陷阱而不是解法。玩家的弹体不冻结——§7.2 写的是「敌人时间冻结，玩家正常行动」。
   */
  private caesuraAction: object | null = null
  private caesuraFreeze(): void {
    const a = this.player.action
    const cast = a?.skill
    if (!a || !cast || cast.freezeTicks <= 0) return
    const f = a.f
    if (a.tick < f.activeStart || a.tick > f.activeEnd) return
    if (this.caesuraAction === a) return
    this.caesuraAction = a
    // 报数把"人"和"正在飞的音弹"算成一类：那一声是玩家挣到的确认，而"场上没有活着的敌人、
    // 只有她临死那一发还在空中"恰恰是最需要这句确认的场合（否则玩家会以为自己那记打空了）。
    let n = 0
    for (const e of this.ai.enemies) {
      if (!e.alive) continue
      e.frozenTicks = Math.max(e.frozenTicks, cast.freezeTicks)
      n++
    }
    for (const pr of this.projectiles.list()) {
      if (pr.dead || !pr.hostile) continue // 玩家自己的弹体照常：动不了的那一方才是被停住的
      pr.frozenTicks = Math.max(pr.frozenTicks, cast.freezeTicks)
      n++
    }
    // 场上什么都没有时不出字：那一声"休止"是玩家挣到的信息，不是每次都敲一遍的说明书
    if (n > 0) bus.emit('ui.notify', { text: `休止｜${n} 个声音停在拍上`, kind: 'info' })
  }

  /**
   * 「打空」的表现：同一记挥击对同一只穿过目标只提示一次（判定窗有 6 tick，不然刷出一串残影）。
   * 刻意**不播命中音、不吃 hitstop**——那一刀什么也没碰到，安静本身就是 §14.5 的读相。
   */
  private phasedSwing: object | null = null
  private phasedIds = new Set<string>()
  private cuePhaseThrough(e: Enemy): void {
    const a = this.player.action
    if (a && this.phasedSwing !== a) { this.phasedSwing = a; this.phasedIds.clear() }
    if (this.phasedIds.has(e.id)) return
    this.phasedIds.add(e.id)
    bus.emit('vfx.request', { key: 'ring_echo', pos: midpoint(this.player.pos, e.pos), scale: 0.6 })
  }

  /** 唯一的「玩家打到敌人」通道：近战、投掷弹体、回声影、以及未来的战技都从这里走。返回这一击的最终伤害（回声要拿它记账） */
  private strikeEnemy(e: Enemy, s: EnemyStrike, tick: number): number {
    const p = this.player
    const cfg = statusConfig()
    const replay = s.rawDamage !== undefined
    const mv = s.movement
    // 战技出手的三重"不吃"：不吃武器强化倍率、不吃武器属性标尺、不吃武器架式倍率（见下面 addPoise）。
    // 它的标尺是 movements.json 那张小表（§2.1 音色），外加 §11 过载列的"每层战技伤害 +4%"。
    const mvMul = mv ? 1 + p.stats.overdrive * mv.overdriveLayerMul : p.rpg.weaponDamageMul
    // 回声重演带着**已经算完的数**进来：resolveDamage 看到 rawDamage 就直接透传，
    // 后面的减伤/钟甲/钟壳/暴击/碎裂加成一段都不再走（见 EnemyStrike.rawDamage 的注释）。
    const dmg = resolveDamage({
      base: s.base * mvMul,
      attrs: p.rpg.attrs,
      scaling: mv ? mv.scaling : p.weapon.scaling,
      defense: e.stats.defense,
      backstab: s.backstab,
      onBeat: s.onBeat,
      ranged: s.ranged,
      rawDamage: s.rawDamage,
      critRate: p.rpg.critRate,
      critMul: p.rpg.critMul
    }, () => this.rng.float())
    let final = dmg.damage
    // 命中**前**的裂纹层数：这一击自己叠的那层留给下一击生效，否则重击一刀叠满就开始自我放大
    const layersBefore = e.stats.fissureLayers
    if (!replay) {
      const crumpled = e.stats.crumpleTicksLeft > 0
      // §5.3 之鸣钟：对钟甲/钟壳目标加伤。判据是**数据**（有钟甲或带壳），不是敌人名字。
      const bellTarget = !!e.data.ai.armorFront || e.shellDmgMul < 1
      if (bellTarget && p.rpg.bellBonus > 0) final = Math.round(final * (1 + p.rpg.bellBonus))
      // §7.2 无声协奏：静默窗内的出手加成。放在这条**唯一**伤害通道里，所以近战、投掷弹体、
      // 战技自己那一记都吃到——「7s 内全部行动」说的就是从她手上出去的一切。
      // 回声重演不吃：那是世界在重播旧账，不是她此刻的行动（`replay` 那一支整段豁免，同一先例）。
      if (p.tacet) final = Math.round(final * (1 + p.tacet.dmgBonus))
      if (crumpled) final = Math.round(final * 1.5)
      // §14.7 钟甲：只有「从它的正面锥里打进来」的这一笔被吃掉。用 s.dir（攻击者→它）反推
      // 来袭方位，所以近战挥砍、玩家投掷枪、以及未来任何走这条通道的伤害都自动受同一规则管。
      const armor = e.data.ai.armorFront
      const glancing = !!armor && !e.armorBroken && !s.backstab && inFrontArc(e, s.dir, armor.arcDeg)
      if (glancing) {
        final = Math.round(final * armor.dmgMul)
        bus.emit('audio.sfx', { key: 'bell_clang', pos: s.point, gain: 0.9 })
        bus.emit('vfx.request', { key: 'block_spark', pos: s.point, scale: 1.1 })
      }
      // §15.1 钟壳：这一阶的减伤是「只有场地机关解得开」的减伤。它仍然只是同一通道里的
      // 一个乘数——不是第二条伤害流程，也不是「免疫所以不显示数字」的假无敌。
      const shell = e.shellDmgMul
      if (shell < 1) {
        final = Math.max(1, Math.round(final * shell))
        bus.emit('audio.sfx', { key: 'bell_clang', pos: s.point, gain: 1 })
        bus.emit('vfx.request', { key: 'block_spark', pos: s.point, scale: 1.5 })
      }
      // §11 震裂：裂纹不挡声音，它让声音更容易穿过。承伤侧按层数放大，
      // 强度侧受「异音」属性（statusPowerMul）与目标自身材质（晶体 ×2、带壳按阶段值）双向放大。
      if (layersBefore > 0) {
        const vuln = 1 + layersBefore * cfg.fissure.dmgMulPerLayer * p.rpg.statusPowerMul * e.fissureEffectMul
        final = Math.round(final * vuln)
      }
      // 追加真伤（全音符斩压在下一记上的那笔）：它站在减伤/钟甲/钟壳**之后**，
      // 因为它的设计语义就是"这些护层挡不住的那一点"。回声重演不再重复加它。
      if (s.trueDamage) final += s.trueDamage
    }

    // §7.2 错拍步的落地窗口：脚落地后那 0.3s 内的攻击多压 +3 架式。它是加法项，所以加在
    // 乘法**之前**（这一击本身的架式值变高），并且只给武器出手——战技不握家伙，见下面那三重"不吃"。
    const poiseBase = s.poise + (mv ? 0 : p.landingPoise)
    const poiseMul = (e.inStartup ? 1.5 : 1) * (s.onBeat ? 2 : 1)
    // 壳在 ⇒ 架势免疫；壳刚被钟声剥掉 ⇒ 架势累积翻倍（同一个奖励的两半）
    // 武器的 poiseMul 是"这把武器的架式手感"，战技不用手上的家伙打人，所以那一乘只对武器出手生效。
    if (!e.poiseImmune) {
      e.stats.addPoise(Math.round(poiseBase * poiseMul * (mv ? 1 : (p.weapon.poiseMul ?? 1)) * p.rpg.poiseDmgMul * e.poiseAccumMul), tick)
    }
    const burst = e.stats.addFissure(s.layers)
    if (s.mute && e.data.ai.buffAura) e.stunTicks = Math.max(e.stunTicks, 60)
    // §11 闷音挂在它身上：走 EntityStats 那条唯一的计时器（和弹道 muteOnHit 同一个字段），
    // 不另开一套"战技版沉默"——那会变成第二条状态通道。
    if (s.muteTicks && s.muteTicks > 0) e.stats.muteTicksLeft = Math.max(e.stats.muteTicksLeft, s.muteTicks)
    if (s.pinTicks > 0) e.stunTicks = Math.max(e.stunTicks, s.pinTicks) // 钉住定身

    e.stats.damage(final)
    e.onDamaged()
    e.interruptBroadcast(tick)

    bus.emit('combat.hit', {
      attackerId: 'player', victimId: e.id, damage: final, poiseDamage: poiseBase,
      kind: s.kind, point: s.point, dir: s.dir, result: 'hit',
      hitStopMs: s.hitStopMs + (s.onBeat ? 30 : 0), shakeKey: s.shakeKey,
      backstab: s.backstab, weakpoint: false,
      // §8.2 rank8 的飘字腿读这一格；下面那条 ui.notify（"泛音暴击"文本）是它现在的双胞胎，
      // 飘字上线后仍然留着——播报走通知队列、飘字在世界坐标，两个承载体各喊各的。
      crit: dmg.crit
    })
    // 回声是"世界又播了一遍"，不该抢玩家手感的时间：不吃 hitstop、不推进连段
    if (!replay) {
      const stopMs = s.hitStopMs + (s.onBeat ? 30 : 0)
      this.time.hitStop(stopMs / 1000)
      this.freezeContact(stopMs, e, this.player, s.sourceAction ?? null)
      this.player.onHitLanded()
    }
    // §13.0「听觉 Sound」收尾（KI-016）：刀落在肉上的那声响发生在**受击者**位置，归因玩家
    // （因果：没有玩家就没有这一声）。同伴听得见同伴挨打，朝这里看一眼。乘武器与词缀系数
    // ⇒ 无鸣/静默一系的角色连打人都是安静的；0.5 < 0.6 ⇒ 打同伴不会震出拍隙里的幽灵八。
    // 回声重演也发：那一声是世界重播的旧账，本来就是可听事件。
    bus.emit('sound.source', { id: 'player', pos: { ...e.pos }, loudness: this.player.weaponImpactNoise(this.player.base.melee.impactLoudness) })
    if (burst) this.fissureBurst(e, s.point)
    this.reportFissure(e, burst)
    if (dmg.crit && !s.backstab) bus.emit('ui.notify', { text: `泛音暴击 · ${final}`, kind: 'reward' })
    if (s.pinTicks > 0) bus.emit('ui.notify', { text: `钉住 −${final}`, kind: 'info' })
    this.checkCrumple(e, tick)
    if (!e.alive) this.onEnemyKilled(e)
    // §8 的分级反应：这一记把人打成了哪一档。放在破势判定**之后**是有意的——
    // R4 若已经成立就是它在管这段时间（1.8s 远长于任何一档硬直），逐式硬直不该去抢它的窗口；
    // 回声重演（`replay`）也不给反应：那一音是世界重播旧账，不是新的一记把人推开。
    else if (!replay) this.applyReactionTier(e, s)
    return final
  }

  /**
   * §8 受击反应分级第一次有行为承载体（KI-052①）：把"挨这一记该硬直多久、被推多远"落到敌人身上。
   *
   * **三档各自兑现哪一半，是按那一行的名字裁的**：
   * - **R1「颤身 Flinch」只发光**：它的原文是「中断轻击前摇；**不打断重击与蓄力**」，而敌人的近战前摇
   *   没有轻/重这一格数据（`AttackSpec.reaction` 说的是他们**打人**算哪一档）——所以"断一切"这种
   *   特权它没有。位置也不迁移：灰盒里没有那一行承诺的"滑行/摩擦"，把每 hit 的米数直接加在 `pos` 上
   *   会累加成一笔距离税（实测：31 记轻击 ×0.2m 把 KI-039 的高甲量具从 1.45 顶到 2.10，越过
   *   "轻武线在高甲前被打成废的"那条判据线）。那一格的 `displaceM` 仍有人读——玩家受击那一边（KI-050）。
   * - **R2「受击顿」与 R3「击退」才接管时间与位置**：`stunTicks > 0` 让 `Enemy.update` 把 `attack` 收掉
   *   ⇒ §7 的「前摇期间被打＝动作中断」从这一刻起对近战成立（此前敌人挨打从不进硬直）。
   *   R3 唯一的生产者是招式帧的点名（§4.2 强音大剑跳劈），kind 轴给不出它。
   * - **读条那条腿属于 R1**：`Enemy.interruptBroadcast` 的硬直格数改读 R1 行——那一格 12 与 200ms
   *   本来就是同一个数的两种单位，写死在这里等于给表造第二个主人。
   *
   * 三条豁免，每条都是裁决而不是兜底：
   * - **Boss 整条通道免疫**。§16/§2.1 的 Boss 设计前提是"招式可背谱"，逐式硬直会把读条与前摇
   *   随时打断 ⇒ 背谱判据失效；她的反制手段是弹反、破势（R4 仍照走）与场地机关（撞钟、断音柱）。
   * - **已经在破势里的人不再叠逐式硬直**：R4（1.8s）比任何一档都长，是这段时间的主人；
   *   再压一格硬直只会把 `recover`（=处决窗口）的入场往后推——那是在没收玩家挣到的奖励。
   * - **回声重演不给反应**（调用点那半边）：那一音是世界重播旧账，不是新的一记把人推开。
   * - **`hyper` 不在这条通道上**：那两式的声明住在**玩家**架式表里（§4.1/§4.2 的蓄力和弦斩），
   *   所以它的消费方是玩家受击那一边，登记在 KI-052②——写在这里会是一支没有生产者的分支。
   *
   * 位移不做遮挡与坠落判定：本作没有"实体撞墙停住"与"坠崖杀"这两条通道，
   * R3 那半句「可坠崖（营地石桥杀点）」因此留账（同上）。
   */
  private applyReactionTier(e: Enemy, s: EnemyStrike): void {
    if (e.stats.crumpleTicksLeft > 0) return
    const tier = s.reaction ?? TIER_BY_KIND[s.kind]
    const row = reactionTier(tier)
    if (e.isBoss) {
      // Boss 的免疫本来是**身份级**的，§15.2 的 Finale 那一阶把它撤回来（「受击即断（R2 可打断全部招）」）：
      // 带着 `interruptOnHit` 的阶段里，R2 与 R3 照常挂硬直并作废那一式，R1 仍然收不掉她
      // （那一档连普通敌人的近战前摇都不打断）。**位移不撤**——她的走位是断音柱/撞钟这类
      // 场地机关的输入，把她推出机关范围不是"DPS 竞速爽段"的意思。
      if (e.bossPhaseData?.interruptOnHit && tier !== 'R1' && row.stunTicks > 0) {
        e.stunTicks = Math.max(e.stunTicks, row.stunTicks)
      }
      return
    }
    if (tier !== 'R1' && row.stunTicks > 0) e.stunTicks = Math.max(e.stunTicks, row.stunTicks)
    // R1 不迁移位置：**颤身（Finch）这一档的名字说的就是原地发抖**，"击退（Knockback）"才是 R3。
    // 灰盒里没有 §8 R3 那格原文要求的"滑行摩擦衰减"，于是每 hit 0.2m 会一路累加成一笔距离税——
    // 实测在 KI-039 的高甲量具上把 力/律 节奏比从 1.45 顶到 2.10（越过"轻武线被打成废的"那条线）。
    // R1 那一格的 displaceM 仍然有读者：玩家受击那一边（`ThirdPersonController.takeDamage`，KI-050）。
    if (tier !== 'R1' && row.displaceM > 0) {
      // `s.dir` 在弹体那条通道里塞的是**速度**（大小=弹速，28m/s），所以位移前必须自己归一化——
      // 否则一发投掷枪会把敌人推出十几米，而"位移 2 米"是表里写好的那个数。
      const dl = Math.hypot(s.dir.x, s.dir.z) || 1
      e.pos.x += (s.dir.x / dl) * row.displaceM
      e.pos.z += (s.dir.z / dl) * row.displaceM
    }
  }

  /** 层数读数：碎裂归零也要发一次，否则 HUD 的 chip 会挂在满层下不来 */
  private reportFissure(e: Enemy, burst: boolean): void {
    const n = e.stats.fissureLayers
    if (!burst && n === 0) return
    bus.emit('ui.status', { id: 'fissure', value: n, max: statusConfig().fissure.maxLayers, on: n > 0 })
  }

  /* ======================= §11 回响：那一音被世界再播一遍 ======================= */

  /**
   * 回声影的账本放在 CombatManager，因为只有这里是那条唯一的伤害通道（§12）——
   * 在别处「再打一遍」就等于发明第二条结算流程。这里只记账与到期，结算仍走 strikeEnemy。
   */
  private echoes: { pos: Vec3; damage: number; poise: number; dueTick: number }[] = []
  /** 给测试与调试器读数用（表现层不 import 逻辑运行时，tech-arch §3） */
  get echoesLive(): number { return this.echoes.length }

  private spawnEcho(at: Vec3, damage: number, poise: number, tick: number): void {
    const c = statusConfig().echo
    // 性能锁：场上最多 N 个影（§11 数值表里 maxShadows 就是为帧预算写的）
    if (this.echoes.length >= c.maxShadows) return
    this.echoes.push({ pos: { ...at }, damage, poise, dueTick: tick + c.delayTicks })
    glossary.explain('echo')
    bus.emit('vfx.request', { key: 'ring_echo', pos: { ...at }, scale: 1.3 })
    bus.emit('ui.status', { id: 'echo', value: this.echoes.length, max: c.maxShadows, on: true })
  }

  private tickEchoes(tick: number): void {
    const c = statusConfig().echo
    for (let i = this.echoes.length - 1; i >= 0; i--) {
      const sh = this.echoes[i]
      if (tick < sh.dueTick) continue
      this.echoes.splice(i, 1)
      const p = this.player
      for (const e of this.ai.enemies) {
        if (!e.alive || e.intangible) continue // 打不到一个此刻不存在的东西
        if (Math.hypot(e.pos.x - sh.pos.x, e.pos.z - sh.pos.z) > c.radius) continue
        this.strikeEnemy(e, {
          base: 0, poise: Math.round(sh.poise * c.replayMul), hitStopMs: 0, kind: 'skill',
          layers: 0, mute: false, backstab: false, onBeat: false, ranged: false, pinTicks: 0,
          rawDamage: sh.damage * c.replayMul * p.rpg.statusPowerMul,
          point: { x: e.pos.x, y: e.pos.y + 1.1, z: e.pos.z }, dir: flatDir(sh.pos, e.pos),
          shakeKey: 'graze'
        }, tick)
      }
      bus.emit('ui.status', { id: 'echo', value: this.echoes.length, max: c.maxShadows, on: this.echoes.length > 0 })
    }
  }


  /* ======================= 弹道 ======================= */

  /** 玩家投掷枪：进入 activeStart 的那一帧发射；连发按 burst 排开（同一动作最多 count 发） */
  private launchPlayerProjectile(tick: number): void {
    const a = this.player.action
    if (!a) return
    const spec = a.f.projectile
    if (!spec) return
    const count = spec.burst?.count ?? 1
    if (a.shots >= count) return
    if (a.tick < a.f.activeStart + a.shots * (spec.burst?.everyTicks ?? 0)) return
    a.shots++
    const p = this.player
    const origin: Vec3 = { x: p.pos.x, y: p.pos.y + (spec.offsetY ?? 1.1), z: p.pos.z }
    const target = p.lockedTarget ? { x: p.lockedTarget.getPos().x, y: p.lockedTarget.getPos().y + 0.9, z: p.lockedTarget.getPos().z } : null
    const dir = target ? aimAt(origin, target, spec) : aimFlat(origin, p.yaw, spec)
    const onBeat = this.rhythm.onBeat(this.player.beatGraceTicks > 0 ? 80 : 50) // 常拍脚（KI-036）
    this.projectiles.spawn({
      hostile: false, ownerId: 'player', kind: spec.kind, origin, dir,
      speed: spec.speed, range: spec.range, radius: spec.radius, gravity: spec.gravity,
      damage: a.f.damage * p.rpg.weaponDamageMul, poise: a.f.poise, hitStopMs: a.f.hitStopMs,
      layers: a.f.fissureLayers ?? (a.key === 'charged' ? 2 : a.key === 'h' ? 1 : 0),
      pinTicks: spec.pinTicks ?? 0, muteTicks: spec.muteOnHit ?? 0,
      pierce: spec.pierce, onBeat, parryable: true,
      sfxHit: spec.sfxHit, vfxHit: spec.vfxHit, shake: spec.shake ?? a.f.shake ?? 'normal',
      reaction: a.f.reaction,
      loudness: a.f.loudness ?? 5
    }, tick)
    this.afterLaunch(p.pos, spec, a.f, dir)
  }

  /** 敌人射击：同一个 ProjectileSystem，只是 hostile=true */
  private launchEnemyProjectiles(tick: number): void {
    for (const e of this.ai.enemies) {
      const pending = e.pendingProjectile
      if (!pending) continue
      e.markShotFired()
      const { spec, frames, reaction } = pending
      const origin: Vec3 = { x: e.pos.x, y: e.pos.y + (spec.offsetY ?? 1.1), z: e.pos.z }
      const target: Vec3 = { x: this.player.pos.x, y: this.player.pos.y + 0.9, z: this.player.pos.z }
      // 不追求必中：给一点散布，玩家有走位/翻滚的余地（§5 远程威胁可读性）
      const spread = (this.rng.float() - 0.5) * 0.12
      const dir = rotate(aimAt(origin, target, spec), spread)
      this.projectiles.spawn({
        hostile: true, ownerId: e.id, kind: spec.kind, origin, dir,
        speed: spec.speed, range: spec.range, radius: spec.radius, gravity: spec.gravity,
        damage: frames.damage * (e.buff?.dmgMul ?? 1), poise: frames.poise,
        hitStopMs: frames.hitStopMs, muteTicks: spec.muteOnHit ?? 0,
        pinTicks: spec.pinTicks ?? 0, parryable: true,
        sfxHit: spec.sfxHit, vfxHit: spec.vfxHit, shake: spec.shake ?? frames.shake ?? 'normal',
        reaction,
        loudness: frames.loudness ?? 4
      }, tick)
      this.afterLaunch(e.pos, spec, frames, dir)
      bus.emit('sound.source', { id: e.id, pos: { ...e.pos }, loudness: ((frames.loudness ?? 4) / 10) })
    }
  }

  private afterLaunch(from: Vec3, spec: ProjectileSpec, frames: FrameData, dir: Vec3): void {
    const pos: Vec3 = { x: from.x, y: from.y + 0.2, z: from.z }
    bus.emit('audio.sfx', { key: spec.sfxLaunch ?? frames.sfx?.[0] ?? 'thrust_1', pos, gain: 0.7 })
    if (frames.vfx?.[0]) {
      bus.emit('vfx.request', { key: frames.vfx[0], pos, dir: { x: dir.x, y: 0, z: dir.z }, scale: 0.8 })
    }
  }

  /** 弹体推进 + 命中判定 + 回收（每 tick 一次，紧跟在近战判定之后） */
  private projectilePass(tick: number, dt: number): void {
    this.projectiles.update(dt, tick)
    for (const pr of this.projectiles.list()) {
      if (pr.dead || pr.bornTick === tick) continue // 出生帧不参与判定：否则反射体会当帧打到自己
      // KI-014①：遮挡量的是**这一 tick 走过的那一段**（`prev → pos`），不是"此刻在不在墙里"，
      // 而它**对两边一样狠**：玩家投出的枪与敌人射来的弹体共用这一行，所以"长枪穿过掩体"
      // 这一支从这一刻起不成立。弹体自己的半径并进柱子里算（`expand`），否则半根柱子
      // 可以让一枚"球心"贴过去——那是画面上一眼就能看出的假账。
      const wall = this.occlusion.firstBlock(pr.prev, pr.pos, pr.radius)
      if (wall) {
        // 停在柱面上：把弹体的位置写成**撞击点**再杀，于是表现层（vfx/音效都读 `pr.pos`）
        // 拿到的就是玩家眼睛该看的那个地方，而反馈仍然只从 `onProjectileGone` 那一个出口发一次
        pr.pos.x = wall.at.x; pr.pos.y = wall.at.y; pr.pos.z = wall.at.z
        this.projectiles.kill(pr, 'wall')
        continue
      }
      if (pr.hostile) {
        if (!this.player.executing && !pr.hitIds.has('player') && sphereHits(pr, this.player.hitTarget())) {
          this.projectileThreatensPlayer(pr, tick)
        }
      } else {
        for (const e of this.ai.enemies) {
          if (!e.alive || pr.hitIds.has(e.id)) continue
          if (e.intangible) continue // §14.5：弹体从拍隙里的它穿过去，不消耗、不停下
          if (!sphereHits(pr, e.hitTarget())) continue
          this.projectileStrikesEnemy(pr, e, tick)
          if (pr.dead) break
        }
      }
      if (pr.dead) continue
      const fy = this.floorAt?.(pr.pos)
      if (fy !== null && fy !== undefined && pr.pos.y <= fy + 0.06) this.projectiles.kill(pr, 'ground')
    }
    this.projectiles.reap((p, reason) => this.onProjectileGone(p, reason))
  }

  private projectileStrikesEnemy(pr: Projectile, e: Enemy, tick: number): void {
    this.projectiles.consume(pr, e.id)
    this.strikeEnemy(e, {
      base: pr.damage, poise: pr.poise, hitStopMs: pr.hitStopMs, kind: 'heavy',
      reaction: stunTier(pr.reaction),
      layers: pr.layers, mute: pr.muteTicks > 0, backstab: false,
      onBeat: pr.onBeat, ranged: true, pinTicks: pr.pinTicks,
      point: { x: e.pos.x, y: e.pos.y + 1.1, z: e.pos.z }, dir: { ...pr.vel },
      shakeKey: pr.shake
    }, tick)
    if (pr.muteTicks > 0) e.stats.muteTicksLeft = Math.max(e.stats.muteTicksLeft, pr.muteTicks)
    bus.emit('vfx.request', { key: pr.vfxHit, pos: { ...pr.pos }, dir: { x: pr.vel.x, y: 0, z: pr.vel.z } })
    bus.emit('audio.sfx', { key: pr.sfxHit, pos: { ...pr.pos }, gain: 0.8 })
  }

  private projectileThreatensPlayer(pr: Projectile, tick: number): void {
    const point: Vec3 = { x: this.player.pos.x, y: this.player.pos.y + 1.0, z: this.player.pos.z }
    const out = this.resolveAgainstPlayer({
      attackerId: pr.ownerId, damage: pr.damage, poise: pr.poise, hitStopMs: pr.hitStopMs,
      kind: 'enemy', point, dir: { x: -pr.vel.x, y: 0, z: -pr.vel.z }, from: { ...pr.pos },
      parryable: pr.parryable, ranged: true,
      statusOnHit: pr.muteTicks > 0 ? { tag: 'mute', layers: 1, ticks: pr.muteTicks } : undefined,
      reaction: pr.reaction,
      // §5.2/§5.3：弹体是唯一「防御成功后还活着」的攻击——被弹开就原路回去找主人
      react: (t, outcome) => this.reflectProjectile(pr, outcome, t)
    }, tick)
    if (out === 'immune') pr.hitIds.add('player') // 无敌帧：从身上穿过去，之后该落地落地
    else if (out !== 'parry' && out !== 'perfectBlock') this.projectiles.kill(pr, 'hit')
    const e = this.ai.enemies.find((x) => x.id === pr.ownerId)
    if (e) this.checkCrumple(e, tick)
  }

  /** 弹反/完美格挡把弹体反射回发射者：伤害按数据表比例（§5.3=100%，§5.2=50%） */
  private reflectProjectile(pr: Projectile, outcome: 'parry' | 'perfectBlock', tick: number): void {
    const b = this.player.base
    const mul = outcome === 'parry' ? b.parry.projectileReflectMul : b.guard.perfectBlockReflectMul
    const shooter = this.ai.enemies.find((e) => e.id === pr.ownerId && e.alive)
    const origin: Vec3 = { x: this.player.pos.x, y: this.player.pos.y + 1.0, z: this.player.pos.z }
    const speed = Math.hypot(pr.vel.x, pr.vel.y, pr.vel.z) || 1
    const target = shooter
      ? { x: shooter.pos.x, y: shooter.pos.y + 0.9, z: shooter.pos.z }
      : { x: origin.x - pr.vel.x / speed * 10, y: origin.y, z: origin.z - pr.vel.z / speed * 10 }
    const dir = aimAt(origin, target, { speed, gravity: pr.gravity })
    const dist = Math.hypot(target.x - origin.x, target.y - origin.y, target.z - origin.z)
    this.projectiles.spawn({
      hostile: false, ownerId: 'player', kind: pr.kind, origin, dir,
      speed, range: Math.max(6, dist + 2), radius: pr.radius, gravity: pr.gravity,
      damage: Math.round(pr.damage * mul), poise: pr.poise, hitStopMs: pr.hitStopMs,
      layers: pr.layers, pinTicks: pr.pinTicks, muteTicks: pr.muteTicks,
      onBeat: this.rhythm.onBeat(this.player.beatGraceTicks > 0 ? 80 : 50), // 常拍脚（KI-036）：反射弹也是玩家的踏音
      parryable: false, // 反射体不可再弹：否则两个人能对着弹一辈子
      sfxHit: pr.sfxHit, vfxHit: pr.vfxHit, shake: pr.shake, loudness: pr.loudness
    }, tick)
    this.projectiles.kill(pr, 'hit')
    bus.emit('vfx.request', { key: 'spike_chord', pos: { ...pr.pos }, scale: 0.8 })
  }

  /**
   * §14.4「可见赤线 telegraph，线终点=落点」：前摇期间把落点亮给玩家看。
   * 只读逻辑，画线是 ProjectileVisuals 的事（tech-arch §5.8 依赖边界）。
   */
  telegraphs(): TelegraphLine[] {
    const out: TelegraphLine[] = []
    for (const e of this.ai.enemies) {
      const t = e.telegraphProjectile
      if (!t) continue
      const from: Vec3 = { x: e.pos.x, y: e.pos.y + (t.spec.offsetY ?? 1.1), z: e.pos.z }
      const target: Vec3 = { x: this.player.pos.x, y: this.player.pos.y + 0.9, z: this.player.pos.z }
      const dir = aimAt(from, target, t.spec)
      const dl = Math.hypot(dir.x, dir.y, dir.z) || 1
      const len = Math.min(t.spec.range, Math.hypot(target.x - from.x, target.y - from.y, target.z - from.z))
      const aim: Vec3 = { x: from.x + (dir.x / dl) * len, y: from.y + (dir.y / dl) * len, z: from.z + (dir.z / dl) * len }
      // KI-014①：那条线是"它会打哪"的**诚实承诺**（§14.4），所以它不能画到柱子后面去。
      // 被挡住时剪在撞击点——玩家读到的是"这一发会撞在那儿"，于是他知道这一下不用翻滚、
      // 但也知道**再往旁边一步**线就会重新拉长。画一条到不了的红线是骗人，不画更是。
      const wall = this.occlusion.firstBlock(from, aim)
      out.push({
        ownerId: e.id, kind: t.spec.kind, from,
        to: wall ? wall.at : aim,
        ticksLeft: t.ticksLeft, totalTicks: t.totalTicks
      })
    }
    return out
  }

  /**
   * 弹体的离场原因里，只有两种是"撞上了什么"：地面与几何（KI-014① 的 `wall`）。
   * 两者的反馈是同一对（灰尘 + 那一声），差别只在**灰尘撒在哪**与撒多大：
   * `kill(pr,'wall')` 之前调用点已经把 `pr.pos` 挪到柱面上，所以这里读到的就是撞击点，
   * 不需要第二份坐标（一份事实只准有一个落点）。柱子那一团给得比落地大，因为那是
   * "有人替这一下挡了"的读数，而落地只是"这一发结束了"。
   */
  private onProjectileGone(pr: Projectile, reason: GoneReason): void {
    if (reason !== 'ground' && reason !== 'wall') return
    bus.emit('vfx.request', { key: 'ring_dust', pos: { ...pr.pos }, scale: reason === 'wall' ? 1.4 : 0.4 })
    bus.emit('audio.sfx', { key: pr.hostile ? 'block_guard' : 'hit_metal', pos: { ...pr.pos }, gain: 0.35 })
  }

  /* ======================= 防御阶梯（玩家受击） ======================= */

  private enemiesHitPlayer(tick: number): void {
    for (const e of this.ai.enemies) {
      const hb = e.activeHitbox
      if (!hb?.box) continue
      const hit = shapeHits(hb.box, e.pos, e.yaw, this.player.hitTarget())
      if (!hit) continue
      const cover = this.coverEatsLine(e.hitTarget(), this.player.hitTarget())
      if (cover) {
        // 柱子挡得住「这一击」，挡不住「这一招」：收势帧不消耗 hitDone，冲出柱子还能再吃
        this.cueBlocked(cover.at)
        continue
      }
      if (e.attack) e.attack.hitDone = true
      const st = e.attack?.spec.statusOnHit
      this.resolveAgainstPlayer({
        attackerId: e.id, damage: hb.damage, poise: hb.poise, hitStopMs: hb.hitStopMs,
        kind: 'enemy', point: midpoint(e.pos, this.player.pos), dir: flatDir(e.pos, this.player.pos),
        from: { ...e.pos }, parryable: e.attack?.spec.parryable ?? true, ranged: false,
        sourceAction: e.attack ?? undefined,
        statusOnHit: st,
        reaction: e.attack?.spec.reaction,
        react: (t, outcome) => {
          if (outcome === 'parry') {
            e.onParried(t)
            e.stats.addPoise(this.player.base.parry.poiseDamage, t)
            this.checkCrumple(e, t)
            if (!e.alive) this.onEnemyKilled(e)
          } else {
            e.stats.addPoise(8, t)
            this.checkCrumple(e, t)
          }
        }
      }, tick)
    }
  }

  /**
   * 全频低通的仲裁者。它有**两处来源**：§5.4 的处决演出（长度 = `player.executing` 那一格）与
   * §15.1 的跳阶怒吼（长度 = `boss.roar.muffleMs`）。两处各自 emit 一定会互相踩——处决进行中跳了阶，
   * 先结束的那一方会把另一方还需要的低通提前撤掉。所以只有一格状态、一个边沿：两边都空了才解除。
   * 放在 update 末尾 ⇒ 这一 tick 内不管是谁先起来，事件都在同一 tick 发出去（不留采样延迟）。
   */
  private muffleHeld = false
  private roarMuffleTicks = 0
  private arbiteMuffle(): void {
    // 先判后扣：起音那一格也算数，否则 48 格的 spec 会变成 47 格
    const held = this.player.executing !== null || this.roarMuffleTicks > 0
    if (this.roarMuffleTicks > 0) this.roarMuffleTicks--
    if (held === this.muffleHeld) return
    this.muffleHeld = held
    bus.emit('audio.muffle', { on: held })
  }


  /**
   * §14.5 解法 b「拍点闪避其前摇→其显形 1s 定身破绽」：它站在拍点上定身蓄力，那一刀的弧
   * 已经亮给玩家看了；玩家就在这一刻按闪避=把手伸进它的拍隙里抓个正着。
   * 判据是「闪避输入 + 它正在前摇 + 此刻它处于拍点相位 + 我在它的招式够得着的范围内」——
   * 用的是这招自己的 hitbox 半径（前摇期本来没有判定），所以不需要额外写死一个「抓拍距离」。
   * 定身复用通用 stunTicks（顺带把这条前摇作废），显形用 revealTicks（相位免伤失效）。
   */
  private phaseCounter(input?: Input): void {
    const p = this.player
    if (!input?.frame.edges.has('dodge') || !p.roll) return
    for (const e of this.ai.enemies) {
      const g = e.data.ai.beatGhost
      if (!g || !e.alive || !e.intangible || !e.inStartup || !e.attack) continue
      const box = e.attack.spec.frames.hitbox
      if (!box) continue
      const reach = box.shape === 'ring' ? box.outer : box.shape === 'cone' ? box.radius : box.offsetFwd + box.radius
      if (Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) > reach + p.hitTarget().radius) continue
      e.revealTicks = Math.max(e.revealTicks, g.dodgeRevealTicks)
      e.stunTicks = Math.max(e.stunTicks, g.dodgeStunTicks)
      bus.emit('vfx.request', { key: 'parry_ring', pos: { ...e.pos }, scale: 0.9 })
      bus.emit('audio.sfx', { key: 'perfect_block', pos: { ...e.pos }, gain: 0.7 })
      bus.emit('ui.notify', { text: '拍点闪避！幽灵八显形定身', kind: 'info' })
    }
  }

  /**
   * §15.2「夺拍」：带着 stealBeat 的阶段一旦交战，全局网格就归他 —— BPM 随机游走、
   * 玩家体力改挂他的拍点、闪避恢复锁漂移。玩家在换气拍前摇里按下弹反 ⇒ 夺回节拍：
   * 中立网格若干秒、三项减益清零、过载 +N（这是需求 §24「二阶段必须可被反制」的落点）。
   */
  private stealBeat(tick: number, input?: Input): void {
    let boss: Enemy | null = null
    for (const e of this.ai.enemies) {
      if (e.alive && e.stealBeat && (e.state === 'combat' || e.state === 'chase')) { boss = e; break }
    }
    const s = boss?.stealBeat
    if (!boss || !s) {
      // 没人夺拍 ⇒ 网格与玩家身上的寄生减益一起归零（留在 stats 上是脏状态）
      if (this.rhythm.drift !== 0) this.rhythm.drift = 0
      this.player.beatParasite = null
      this.player.dodgeJitterTicks = 0
      return
    }
    if (boss.stealNeutralTicks > 0) {
      boss.stealNeutralTicks--
      this.rhythm.drift = 0
      this.player.beatParasite = null
      this.player.dodgeJitterTicks = 0
      return
    }
    if (tick % s.reDriftEveryTicks === 0) this.rhythm.drift = this.rng.float(-s.bpmDrift, s.bpmDrift)
    const beatTicks = (60 / this.rhythm.bpm) * TICK_HZ
    this.player.beatParasite = { regenMul: s.staRegenMul, windowTicks: Math.max(4, Math.round(beatTicks * 0.25)) }
    this.player.dodgeJitterTicks = s.dodgeJitterTicks
    const a = boss.attack
    // 换气窗开场的可读提示（§15.2：HUD 以他胸口熄灭音色石的一次「暗-亮」脉冲）。
    // 用招式对象的身份做边沿，避免 21 tick 的窗口里每 tick 响一次。
    if (a?.spec.reclaimWindow && boss.inBreath && this.breathCue !== a) {
      this.breathCue = a
      bus.emit('vfx.request', { key: 'parry_ring', pos: { ...boss.pos }, scale: 0.8 })
      bus.emit('audio.sfx', { key: 'lockon_on', pos: { ...boss.pos }, gain: 0.6 })
      bus.emit('ui.notify', { text: '管风琴停气 —— 换气拍！', kind: 'boss' })
    }
    if (a?.spec.reclaimWindow && boss.inBreath && input?.frame.edges.has('parry')) {
      boss.stealNeutralTicks = s.reclaim.neutralTicks
      boss.attack = null
      this.rhythm.drift = 0
      this.player.beatParasite = null
      this.player.dodgeJitterTicks = 0
      this.player.addOverdrive(s.reclaim.overdrive)
      this.time.hitStop(s.reclaim.hitStopMs / 1000)
      bus.emit('vfx.request', { key: 'parry_ring', pos: { ...boss.pos }, scale: 1.6 })
      bus.emit('audio.sfx', { key: 'parry_bell', pos: { ...boss.pos }, gain: 1 })
      bus.emit('ui.notify', {
        text: `夺回节拍！中立网格 ${(s.reclaim.neutralTicks / TICK_HZ).toFixed(0)}s · 过载 +${s.reclaim.overdrive}`,
        kind: 'reward'
      })
    }
  }

  /** 已经提示过的换气窗（按招式对象身份判边沿） */
  private breathCue: object | null = null
  /** 上一个记过残响伤害的拍号（机关是「每拍」结算，不能每 tick 结算） */
  private lastResonanceBeat = -1

  /**
   * Boss 的三件「要结算并记账」的事，都留在这条唯一的伤害通道里：
   * ①跳阶演出（hitstop + 低音 + 震镜由 boss.phase 事件交给表现层）；
   * ②响过的立钟留下残响区——对玩家 0 伤、对敲钟的喧堕者每拍掉血（§15.1 把场地用成 DPS 博弈）；
   * ③§16 胜利序列的收尾播报，等屏息走完才落字。
   * 死在残响里也必须走 onEnemyKilled，否则掉落/清剿/BGM/胜利序列全部漏记账。
   */
  private bossBits(): void {
    const beat = this.rhythm.info().beatIndex
    const isNewBeat = beat !== this.lastResonanceBeat
    if (isNewBeat) this.lastResonanceBeat = beat
    if (this.cadenzaPending && this.time.realSeconds >= this.cadenzaPending.atSec) {
      const c = this.cadenzaPending
      this.cadenzaPending = null
      bus.emit('ui.notify', { text: c.text, kind: 'boss' })
    }
    for (const e of this.ai.enemies) {
      if (e.phaseRoarPending) {
        e.phaseRoarPending = false
        // §15.1/§10 那一嗓子是三件套：hitstop + 震镜 + 全频低通。前两件早就在了，低通在 KI-021②
        // 接上 KI-003 的总线节点。**两个时长的来源现在是 `boss.roar`**（KI-017 第四步：§9 最后一行
        // 还住在代码里的那一笔）；第三件震镜仍走表现层的 §10 表（`CameraRig` 的 `shake('boss')`），
        // 那是另一张表、另一个消费者。
        const roar = e.data.boss?.roar
        if (roar) {
          this.roarMuffleTicks = msToTicks(roar.muffleMs)
          this.time.hitStop(roar.hitStopMs / 1000)
        }
        bus.emit('boss.phase', { id: e.id, phase: e.bossPhase + 1, phases: e.data.boss?.phases.length ?? 1, nameKey: e.data.nameKey })
        bus.emit('audio.sfx', { key: 'boss_roar', pos: { ...e.pos }, gain: 1 })
        bus.emit('vfx.request', { key: 'shock_small', pos: { ...e.pos }, scale: 2.6 })
        bus.emit('ui.notify', { text: `${nameOf(e.data.nameKey)} · 第 ${e.bossPhase + 1} 阶`, kind: 'boss' })
      }
      const g = e.data.boss?.bells
      if (!g || !e.alive || !isNewBeat) continue
      for (let i = 0; i < g.positions.length; i++) {
        if (!e.bellsRung[i]) continue
        if (Math.hypot(e.pos.x - g.positions[i].x, e.pos.z - g.positions[i].z) > g.resonanceRadius) continue
        e.stats.damage(g.damagePerBeat)
        bus.emit('vfx.request', { key: 'ring_echo', pos: { ...g.positions[i] }, scale: 0.8 })
        if (!e.alive) this.onEnemyKilled(e)
        break
      }
    }
  }

  /**
   * 断音柱（§15.2「躲入场地断音柱后」）——KI-014① 之后它就是**一条线段**：
   * 从攻击者的身体中心量到玩家的身体中心，中间穿过任一根柱子的圆柱面 ⇒ 这一击被柱子吃掉。
   *
   * 这一手替换掉的是原来那两格手写判据（「玩家站进圆内 + 攻击者在圆外」+
   * 「攻击者也贴柱 ⇒ 不挡，否则柱子变无敌房」）。**后者不再需要写**：线段从柱内出发时
   * 根本没有"穿过柱面"这件事，几何自己就把它否掉了（`core/Occlusion` 的第一条口径）。
   * 前者则从"站在柱子附近"收紧成"柱子真的在两人之间"——这正是 §15.2 那句"躲**到柱子后面**"
   * 的原意，而近似版本给的是"躲到柱子旁边"。
   *
   * 端点用身体中心而不是脚底：柱子的 y 带（`covers.heightM`）量的是"这一段高度里有没有实体"，
   * 拿脚底量会让一根 7.5m 的柱子在数学上挡得住、在画面上一眼就能看出没挡住。
   */
  private coverEatsLine(from: HitTarget, to: HitTarget): BlockHit | null {
    this.segA.x = from.pos.x; this.segA.y = from.pos.y + from.height / 2; this.segA.z = from.pos.z
    this.segB.x = to.pos.x; this.segB.y = to.pos.y + to.height / 2; this.segB.z = to.pos.z
    return this.occlusion.firstBlock(this.segA, this.segB)
  }

  /** 被柱子吃掉的那一击：安静、无伤、不吃 hitstop，但要有灰尘——玩家得知道是哪根柱子救了自己 */
  private cueBlocked(pos: Vec3): void {
    bus.emit('vfx.request', { key: 'ring_dust', pos: { ...pos }, scale: 1.4 })
    bus.emit('audio.sfx', { key: 'block_guard', pos: { ...pos }, gain: 0.35 })
  }

  /**
   * §13.0「听觉 Sound」列的第四路（攻击/弓弦/破坏/**弹反冲击**）与同节 Alertness 行写的
   * 「被弹反/完美格挡目击者 +100（瞬间报警）」——这两条以前都只活在文档里。
   * 冲击走**既有** `sound.source` 流（id 仍是 'player'，响度仍走玩家那条标尺），因此它一次性
   * 喂给三条既有规则：同伴 `hear()`、幽灵八 `fakeBeat()`（弹反 0.85 过 0.6 门槛，完美格挡 0.5 不过）、
   * 万籁 `huntsSound()`。最后一项是新后果：在她的领域里**防御同样报信**，无鸣武器才是正解。
   * 目击报警则单独走 `sawImpact()`，因为它判的是「看见」，半径比听觉长。而"看见"从 KI-014②b
   * 起包含**这条线没有被挡住**：用的就是 AI 那一份视线闸门（同一个名册，不另起一套判据）。
   */
  private impactAlarm(baseLoudness: number): void {
    const p = this.player
    bus.emit('sound.source', { id: 'player', pos: { ...p.pos }, loudness: p.weaponImpactNoise(baseLoudness) })
    for (const x of this.ai.enemies) x.sawImpact(p.pos, p.hitTarget().height, this.ai.sightBlocked)
  }

  /** §5 优先级：弹反 > 无敌帧 > 完美格挡 > 格挡（含破防）> 硬吃。近战与弹体共用 */
  private resolveAgainstPlayer(h: Threat, tick: number): DefenseOutcome {
    const p = this.player
    const cfg = statusConfig()
    // §9「Hitstop 时长分级表」里玩家是守方的那四行，整段来自 `player.json.hitStop`（KI-017 第四步）。
    // 这里取一次、四个出口共用：一个情境值只准有一个落点，改表就是改行为（`tests/flow/hitstop.test.ts`
    // 末尾那个「改表法」describe 逐行去验）。
    const hs = p.base.hitStop
    const base = {
      attackerId: h.attackerId, victimId: 'player', poiseDamage: h.poise, kind: h.kind,
      point: h.point, dir: h.dir, hitStopMs: h.hitStopMs, backstab: false, weakpoint: false
    }
    const facing = Math.abs(norm(Math.atan2(h.from.x - p.pos.x, h.from.z - p.pos.z) - p.yaw)) < Math.PI * 0.55
    if (p.parryActive && facing && h.parryable) {
      h.react(tick, 'parry')
      p.addOverdrive(p.base.parry.overdriveGain)
      p.onParrySuccess() // §5.3：窗口被弹中 ⇒ 不落空，后面的落空锁与赌注倍率都不该发生（KI-054）
      // §9「弹反成功」那一行（`hitStop.parryMs`）：这一格的情境时长同时喂相机、事件与守方硬直——
      // 被弹反的人此刻正是挨打的那一方（`onParried` 刚给他挂上失音硬直），所以这一格停顿有地方落。
      // 攻方这一侧没有载体：`onParried` 已经把他那一招收掉（`attack = null`），没有"正在出的招"可按。
      const parryStopMs = hs.parryMs
      this.time.hitStop(parryStopMs / 1000)
      const parried = this.attackerById(h.attackerId)
      this.freezeContact(parryStopMs, parried, parried, h.sourceAction ?? null)
      // §7.2 定音回响的「必挂破势」：这一扇窗是回响加宽的 ⇒ 弹中即破势。
      // 走 `EntityStats.addPoise` 那条**唯一**的破势通道：时长仍是 reactions.json 的 R4
      // （Boss 2.4s / 杂兵 1.8s，armCrumple 上弦），不为这一式写第二张破势表。
      // `poiseImmune`（Boss 抬壳，§15.1）依然挡得住：回响是弹壳的**解法之一**（壳免疫架势，
      // 但这一式本就不该把「必挂」写成「必破」），不是免死金牌——留白由 `combat.md` 的那一句管。
      if (p.parryEchoLive) {
        if (parried && parried.alive && !parried.poiseImmune) {
          parried.stats.addPoise(parried.stats.poiseMax, tick)
          this.checkCrumple(parried, tick)
        }
      }
      p.parryEchoLive = false // 无论挂没挂上，这一扇窗的回响都结过账了
      bus.emit('combat.hit', { ...base, damage: 0, result: 'parry', shakeKey: 'parry', hitStopMs: parryStopMs })
      bus.emit('combat.parried', { attackerId: h.attackerId, defenderId: 'player' })
      bus.emit('vfx.request', { key: 'parry_ring', pos: h.point })
      bus.emit('audio.sfx', { key: 'parry_bell', pos: h.point, gain: 1 })
      this.impactAlarm(p.base.parry.impactLoudness)
      return 'parry'
    }
    // 窗口没弹中这一记就是落空（不可弹的攻击也算吃掉窗口）：§5.3 的落空后摇从这里开始。
    // beginParryWhiff 自己有 pending 守卫，没在弹反窗口里被击时它是无操作（KI-054）。
    // 回响窗同理翻篇：充能开窗时已花掉（ThirdPersonController），但「必挂破势」没赚到。
    p.beginParryWhiff()
    p.parryTicksLeft = 0
    p.parryEchoLive = false
    if (p.iFrame) {
      bus.emit('combat.hit', { ...base, damage: 0, result: 'immune', shakeKey: 'graze' })
      return 'immune'
    }
    if (p.guardTicks >= 1 && p.guardTicks <= p.base.perfectBlockWindow + p.rpg.perfectBlockBonusTicks) {
      h.react(tick, 'perfectBlock')
      p.addOverdrive(1 + p.rpg.restOverdrive)
      // §9「完美格挡」那一行（`hitStop.perfectBlockMs`）：这一格谁都没进硬直，所以守方没有载体——
      // KI-017 第三步之后它有落点了：
      // **出手那一方的招式帧**被按住（盾面把那一记卡住），仍然只有相机吃是不完整的实现。
      const perfectStopMs = hs.perfectBlockMs
      this.time.hitStop(perfectStopMs / 1000)
      this.freezeContact(perfectStopMs, null, this.attackerById(h.attackerId), h.sourceAction ?? null)
      bus.emit('combat.hit', { ...base, damage: 0, result: 'perfectBlock', shakeKey: 'graze', hitStopMs: perfectStopMs })
      bus.emit('vfx.request', { key: 'parry_ring', pos: h.point, scale: 0.7 })
      bus.emit('audio.sfx', { key: 'perfect_block', pos: h.point, gain: 0.9 })
      this.impactAlarm(p.base.guard.impactLoudness)
      return 'perfectBlock'
    }
    if (p.guarding) {
      const through = Math.round(h.damage * (1 - p.base.guard.reduction))
      const staCost = through * p.base.guard.staPerDmg
      if (p.stats.stamina > staCost) {
        p.stats.spendStamina(staCost, tick)
        p.stats.addPoise(h.damage * p.base.guard.bleedPoiseFrac, tick)
        // §9「命中被格挡」那一行（`hitStop.blockMs`）：盾上那一下比身上那一下短，这是**情境**表说的，
        // 不是招式表说的。
        // 格挡中的玩家没有硬直可按 ⇒ 守方无载体，但攻方有：那一记卡在盾上，出手方的招式帧按住 45ms。
        const blockStopMs = hs.blockMs
        this.time.hitStop(blockStopMs / 1000)
        this.freezeContact(blockStopMs, null, this.attackerById(h.attackerId), h.sourceAction ?? null)
        bus.emit('combat.hit', { ...base, damage: through, result: 'block', shakeKey: 'graze', hitStopMs: blockStopMs })
        bus.emit('vfx.request', { key: 'block_spark', pos: h.point })
        bus.emit('audio.sfx', { key: 'block_guard', pos: h.point, gain: 0.7 })
        this.checkPlayerCrumple(tick)
        return 'block'
      }
      p.stats.stamina = 0
      p.exhausted = true
      // §5.1「破防」的 600ms 大踉跄 + §10「破防/被破势」那行的附加格「0.3s 慢放 ×0.75」。
      // KI-017③ 的口径裁决（2026-09-25）：§9 没给破防一行，**不补**——它的"时间被拿走"由这次
      // 慢放承担（`hitStop` 的 scale 参数是现成的，只吃相机/阻尼那一侧的时标；拍网格按 tick 走，
      // §2.1 不受害）。事件里的 `hitStopMs` 报 0 是有意的：那一格说的就是 §9 停顿，这里没有。
      const g = p.base.guard
      this.time.hitStop(g.breakSlowMs / 1000, g.breakSlowScale)
      p.takeDamage(Math.round(through * 1.3), h.dir, h.reaction)
      // 写在 `takeDamage` **之后**是有意的：那一手按 §8 玩家侧口径把硬直钉成 R1 等效（reactions.json 的
      // 200ms=12 格），旧代码先写 36 再叫它 ⇒ 「破防 600ms 大踉跄」从未成立过，玩家实际只踉跄了受击那一格。
      // 这次裁决顺手纠的这个谎，由 `hitstop.test.ts` 的破防腿钉住（读数 == msToTicks(breakStunMs)，不是 R1）。
      p.stunTicks = msToTicks(g.breakStunMs)
      bus.emit('combat.hit', { ...base, damage: through, result: 'hit', shakeKey: 'heavy', hitStopMs: 0 })
      bus.emit('ui.notify', { text: '破防！', kind: 'info' })
      this.checkPlayerCrumple(tick)
      return 'guardBreak'
    }
    const dmg = resolveDamage({ base: h.damage, defense: p.stats.defense, ranged: h.ranged }, () => this.rng.float())
    if (!p.takeDamage(dmg.damage, h.dir, h.reaction)) return 'none'
    p.stats.addPoise(h.poise, tick)
    // §9「玩家受击」那一行（`hitStop.hurtMs`）：情境时长，一个数喂四处（相机、事件、被按住的硬直
    // 倒数、**出手方那一式的帧**）。
    // 攻方这一侧由 `h.sourceAction` 决定成不成：近战那一记正在出 ⇒ 按得住；弹体早就离手 ⇒ 不按。
    const hurtStopMs = hs.hurtMs
    this.time.hitStop(hurtStopMs / 1000)
    this.freezeContact(hurtStopMs, p, this.attackerById(h.attackerId), h.sourceAction ?? null)
    bus.emit('combat.hit', { ...base, damage: dmg.damage, result: 'hit', shakeKey: 'hurt', hitStopMs: hurtStopMs })
    bus.emit('vfx.request', { key: 'hit_ring', pos: h.point })
    bus.emit('audio.sfx', { key: 'hit_flesh', pos: h.point, gain: 0.8 })
    const st = h.statusOnHit
    // tag 走 Gameplay Tag 风格：'mute' 与 'status.mute' 都认；时长一律由数据里的 ticks 声明
    // （驼鼓原先只写 tag 不写时长，且前缀不匹配 ⇒ 闷音从未生效）
    if (st && st.ticks && tagIs(st.tag, 'mute')) {
      p.stats.muteTicksLeft = Math.max(p.stats.muteTicksLeft, st.ticks)
      glossary.explain('mute')
    }
    // §11 失谐：只有「精英及以上」的一击会在身上写下不属于这首歌的音。杂兵的脏活是环境的事。
    if (this.corruptorOf(h.attackerId)) {
      if (p.corruption.add(cfg.corruption.eliteHit) > 0) glossary.explain('corruption')
    }
    this.checkPlayerCrumple(tick)
    return 'hit'
  }

  /** 精英判据取**数据**（archetype），不取名字：新怪只要标对原型就自动受同一条规则管 */
  private corruptorOf(attackerId: string): boolean {
    const src = this.ai.enemies.find((e) => e.id === attackerId)
    return !!src && (src.isBoss || src.data.archetype === 'elite')
  }

  /* ======================= 破势 / 死亡 / 处决 ======================= */

  /** §11 震裂满层碎裂：真伤 + 架势冲击，两个数都吃「异音」强度与目标材质（晶体 ×2） */
  private fissureBurst(e: Enemy, point: Vec3): void {
    const c = statusConfig().fissure
    const mul = e.fissureEffectMul * this.player.rpg.statusPowerMul
    const raw = resolveDamage({ base: 0, defense: 0, rawDamage: Math.round(c.burst.trueDamage * mul) }, () => this.rng.float())
    e.stats.damage(raw.damage)
    e.stats.addPoise(Math.round(c.burst.poise * mul), this.time.tick)
    bus.emit('vfx.request', { key: 'hit_ring', pos: point, scale: 1.6 })
    bus.emit('audio.sfx', { key: 'hit_metal', pos: point, gain: 0.8 })
    bus.emit('ui.notify', { text: '震裂碎裂！', kind: 'info' })
    // §14.7「震裂满层碎裂其甲（清一次减伤）」：甲是这层减伤的载体，碎了就永久没了
    if (e.data.ai.armorFront && !e.armorBroken) {
      e.armorBroken = true
      bus.emit('audio.sfx', { key: 'burst_shell', pos: { ...e.pos }, gain: 1 })
      bus.emit('vfx.request', { key: 'death_shatter', pos: { ...e.pos }, scale: 1.2 })
      bus.emit('ui.notify', { text: '钟甲碎裂！正面减伤失效', kind: 'reward' })
    }
    if (!e.alive) this.onEnemyKilled(e)
  }

  private checkCrumple(e: Enemy, tick: number): void {
    if (e.stats.crumpleTicksLeft > 0 && e.state !== 'recover') {
      e.attack = null
      e.enter('recover')
      bus.emit('vfx.request', { key: 'shock_small', pos: { ...e.pos }, scale: 1.3 })
      bus.emit('ui.notify', { text: '破势！', kind: 'info' })
      void tick
    }
  }

  private onEnemyKilled(e: Enemy): void {
    if (this.killed.has(e.id)) return
    this.killed.add(e.id)
    e.enter('dead')
    bus.emit('entity.died', { id: e.id, kind: 'enemy', dataId: e.data.id, position: { ...e.pos } })
    // §13.0（KI-016）：死亡哀鸣——一个同伴倒地是场上最响的动静之一（0.8 = 驼鼓踏地档），
    // 30m 外的巡逻听得见。归因玩家、位置在尸体脚下；无鸣角色的击杀也是安静的。
    bus.emit('sound.source', { id: 'player', pos: { ...e.pos }, loudness: this.player.weaponImpactNoise(this.player.base.melee.killNoiseLoudness) })
    bus.emit('vfx.request', { key: 'death_shatter', pos: { ...e.pos }, scale: e.data.body?.scale ?? 1 })
    bus.emit('audio.sfx', { key: 'death_shatter', pos: { ...e.pos }, gain: 0.8 })
    bus.emit('ui.notify', { text: `${nameOf(e.data.nameKey)} 崩解 · 遗响 +${Math.round(e.stats.hpMax * 0.3)}`, kind: 'reward' })
    const v = e.data.boss?.victory
    if (v) this.cadenza(e, v)
    this.offTuneMoment(e)
  }

  /** §16 胜利序列的收尾播报：屏息走完之前它一直等着（安静不能被一行字盖掉） */
  private cadenzaPending: { atSec: number; text: string } | null = null

  /**
   * §16「胜利序列（IP_SEED §6：音乐停=世界屏息 0.5s）」。三件事一起才成立，缺一件就只是"怪死了"：
   * ①战斗层音乐**立刻**掐掉——不是脱战那条 4s 淡出：淡出说的是"危险过去了"，这一停说的是
   *   "有什么东西不在了"（底噪 drone 不停，世界还在呼吸，只是没人再为打鼓）；
   * ②`hitStop(hold)` 把世界压到 5% 走一段——本作没有过场时间轴，这是这套引擎里唯一真实的屏息
   *   表达（ENV-001 下的合理替代，接上真过场系统时换实现不换数据）；
   * ③收尾播报排在屏息**之后**，见 `cadenzaPending`。
   */
  private cadenza(e: Enemy, v: NonNullable<NonNullable<EnemyData['boss']>['victory']>): void {
    this.time.hitStop(v.holdTicks / TICK_HZ)
    bus.emit('audio.music.encounter', { start: false, cut: true })
    bus.emit('boss.defeated', { id: e.id, dataId: e.data.id, nameKey: e.data.nameKey, holdTicks: v.holdTicks })
    for (const k of v.sfx ?? []) bus.emit('audio.sfx', { key: k, pos: { ...e.pos }, gain: 1 })
    if (v.label) this.cadenzaPending = { atSec: this.time.realSeconds + v.holdTicks / TICK_HZ, text: v.label }
  }

  /**
   * §14.6「击杀它→全场敌人失衡（走调时刻）」：定调母一死，所有还在节奏位上的同伴一起走调——
   * 硬直 + 警觉清零。这是「优先集火最软的靶」这条正确解法的奖励，也是对玩家读场的回报。
   */
  private offTuneMoment(e: Enemy): void {
    const ot = e.data.ai.offTuneOnDeath
    if (!ot) return
    let hit = 0
    for (const x of this.ai.enemies) {
      if (x === e || !x.alive) continue
      x.stunTicks = Math.max(x.stunTicks, ot.stunTicks)
      x.attack = null
      if (ot.resetAlertness) x.alertness = 0
      hit++
    }
    bus.emit('vfx.request', { key: 'ring_echo', pos: { ...e.pos }, scale: 3 })
    bus.emit('audio.sfx', { key: 'burst_shell', pos: { ...e.pos }, gain: 1 })
    bus.emit('ui.notify', { text: `走调时刻！${hit} 名敌人失衡`, kind: 'boss' })
  }

  /** §5.4 Execute/Backstab — trigger detection (interact edge + valid candidate) */
  private tryExecute(input: Input | undefined, tick: number): void {
    if (!input?.frame.edges.has('interact')) return
    const p = this.player
    if (p.busy || p.executing) return
    const cand = this.findExecuteTarget()
    if (cand) this.landExecute(cand.e, cand.kind, tick)
  }

  private findExecuteTarget(): { e: Enemy; kind: ExecuteKind } | null {
    const ex = this.player.base.execution
    const p = this.player
    const oc = p.stats.overdrive
    let best: { e: Enemy; kind: ExecuteKind } | null = null
    let bestD = Infinity
    for (const e of this.ai.enemies) {
      if (!e.alive || e.intangible) continue // 抓不住一个不在那里的东西（§14.5）
      const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z)
      const crumpled = e.stats.crumpleTicksLeft > 0 || e.state === 'recover'
      const stalled = crumpled || e.stunTicks > 0 || e.inStartup
      const unaware = e.state === 'idle' || e.state === 'patrol' || e.state === 'investigate' || e.state === 'alert' || e.state === 'search'
      let kind: ExecuteKind | null = null
      if (crumpled && d <= ex.crumpleRange) kind = 'A'
      else if (unaware && d <= ex.backstabRange && behindCone(p.pos, e, ex.backstabConeDeg)) kind = 'B'
      else if (oc >= ex.overdriveCost && stalled && d <= ex.crumpleRange) kind = 'C'
      if (kind && d < bestD) { bestD = d; best = { e, kind } }
    }
    return best
  }

  /** apply the true-damage strike + start the invulnerable montage */
  private landExecute(e: Enemy, kind: ExecuteKind, tick: number): void {
    const ex = this.player.base.execution
    const p = this.player
    const isBoss = e.isBoss
    let dmg: number
    let silent = false
    if (kind === 'B' && !isBoss && e.stats.hp / e.stats.hpMax <= ex.stealthKillFrac) {
      silent = true
      dmg = e.stats.hp
    } else {
      let frac = ex.hpFrac
      let flat = isBoss ? 0 : ex.flat
      if (kind === 'C') {
        frac = ex.overdriveFrac
        flat = isBoss ? 0 : ex.overdriveFlat
        p.stats.overdrive = Math.max(0, p.stats.overdrive - ex.overdriveCost)
      }
      if (isBoss) {
        const c = this.execCount.get(e.id) ?? 0
        frac = ex.bossFracs[Math.min(c, ex.bossFracs.length - 1)]
        this.execCount.set(e.id, c + 1)
      }
      dmg = Math.round((e.stats.hpMax * frac + flat) * p.rpg.execMul)
    }
    const point: Vec3 = { x: (p.pos.x + e.pos.x) / 2, y: 1.1, z: (p.pos.z + e.pos.z) / 2 }
    const dir: Vec3 = { x: e.pos.x - p.pos.x, y: 0, z: e.pos.z - p.pos.z }
    p.beginExecute({ ...e.pos }, ex.durationTicks)
    e.attack = null
    e.stunTicks = Math.max(e.stunTicks, ex.durationTicks)
    this.time.hitStop(ex.firstBladeHitStopMs / 1000)
    e.stats.damage(dmg)
    e.onDamaged(dir)
    bus.emit('combat.hit', {
      attackerId: 'player', victimId: e.id, damage: dmg, poiseDamage: 0, kind: 'heavy',
      point, dir, result: 'hit', hitStopMs: ex.firstBladeHitStopMs,
      // §10「处决」行有自己的震镜档（KI-053）：不再借 heavy/boss 列——那一记的分量
      // 由推轨（KI-051）与消音+专属音色（KI-003）扛，震镜只标那一刀落
      shakeKey: 'execute', backstab: kind === 'B', weakpoint: false
    })
    bus.emit('vfx.request', { key: 'hit_ring', pos: point, scale: 2 })
    bus.emit('vfx.request', { key: 'shock_small', pos: { ...e.pos }, scale: 1.6 })
    // 专属处决音色（audio.md §破处决）。此前借 chord_slam 占位，那是和弦爆的音色，不是「让声音死」；
    // 静杀反过来：那一刀没有音叉鸣响，只有尸体落地的碎声
    bus.emit('audio.sfx', { key: silent ? 'death_shatter' : 'execute_rest', pos: point, gain: 1 })
    const label = silent ? '静杀' : kind === 'A' ? '处决' : kind === 'B' ? '背刺处决' : '休止处决'
    bus.emit('ui.notify', { text: `${label} −${dmg}`, kind: isBoss ? 'boss' : 'info' })
    if (!e.alive) this.onEnemyKilled(e)
    else this.checkCrumple(e, tick)
  }

  private checkPlayerCrumple(tick: number): void {
    const p = this.player
    if (p.stats.crumpleTicksLeft > 0 && p.crumpleTicks === 0) {
      p.crumpleTicks = p.stats.crumpleTicksLeft
      bus.emit('ui.notify', { text: '架势崩溃', kind: 'info' })
      void tick
    }
  }
}

function norm(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
  return { x: (a.x + b.x) / 2, y: 1.1, z: (a.z + b.z) / 2 }
}

/** 从 a 指向 b 的水平单位向量（伤害方向/击退都用水平分量） */
function flatDir(from: Vec3, to: Vec3): Vec3 {
  const x = to.x - from.x, z = to.z - from.z
  const l = Math.hypot(x, z) || 1
  return { x: x / l, y: 0, z: z / l }
}

/**
 * 未锁定时的默认瞄准：把弹道在「半射程」处正好抬到站立躯干中心（1.0m）。
 * 带重力弹道若纯水平出手，近距离会从头顶飞过——这条补偿让投掷枪在 3~22m 都能命中。
 */
function aimFlat(origin: Vec3, yaw: number, spec: ProjectileSpec): Vec3 {
  const g = spec.gravity ?? 0
  const tMid = spec.range / 2 / Math.max(1, spec.speed)
  const vy = (1.0 - origin.y + 0.5 * g * tMid * tMid) / tMid
  return { x: Math.sin(yaw), y: vy / Math.max(1, spec.speed), z: Math.cos(yaw) }
}

/** 指向目标的方向；带重力弹道用抛物线解出提前量（引针枪锁定投掷） */
function aimAt(from: Vec3, target: Vec3, spec: Pick<ProjectileSpec, 'speed' | 'gravity'>): Vec3 {
  const dx = target.x - from.x, dz = target.z - from.z
  const flat = Math.hypot(dx, dz) || 0.001
  const g = spec.gravity ?? 0
  const t = flat / Math.max(1, spec.speed)
  const dy = target.y - from.y + 0.5 * g * t * t
  return { x: dx / flat, y: dy / flat, z: dz / flat }
}

/** 绕竖直轴偏航（敌方命中的散布） */
function rotate(dir: Vec3, by: number): Vec3 {
  const s = Math.sin(by), c = Math.cos(by)
  return { x: dir.x * c + dir.z * s, y: dir.y, z: -dir.x * s + dir.z * c }
}

/** is the player inside a tight cone directly behind the enemy? (§5.4 backstab) */
function behindCone(playerPos: Vec3, e: Enemy, coneDeg: number): boolean {
  const ang = Math.atan2(playerPos.x - e.pos.x, playerPos.z - e.pos.z)
  return Math.abs(norm(ang - (e.yaw + Math.PI))) <= (coneDeg * Math.PI / 180) / 2
}

/**
 * §14.7 钟甲：来袭者是否站在它正面 `arcDeg` 锥里。
 * 传进来的 `incoming` 沿用 EnemyStrike.dir 的口径=「攻击者→它」，取反才是「它→攻击者」。
 */
function inFrontArc(e: Enemy, incoming: Vec3, arcDeg: number): boolean {
  const toAttacker = Math.atan2(-incoming.x, -incoming.z)
  return Math.abs(norm(toAttacker - e.yaw)) <= (arcDeg * Math.PI / 180) / 2
}

const NAME_MAP: Record<string, string> = {
  'enemy.murkshell': '嘈壳', 'enemy.driftsinger': '漂调者', 'enemy.tympanus': '驼鼓',
  'enemy.skewer': '针喉', 'enemy.phantome': '幽灵八', 'enemy.refrein': '叠唱',
  'enemy.hangedKnight': '悬钟骑士',
  'enemy.ostlara': '悬钟骑士·奥斯塔拉',
  'enemy.hersil': '无拍长·恩希尔·万籁',
  'enemy.myriad': '万籁 The Myriad'
}

export function nameOf(key: string): string {
  return NAME_MAP[key] ?? key
}
