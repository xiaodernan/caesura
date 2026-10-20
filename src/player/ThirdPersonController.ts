import { bus } from '@/core/EventBus'
import type { GameTime } from '@/core/Time'
import type { Input } from '@/core/Input'
import type { RhythmClock } from '@/core/RhythmClock'
import { clamp } from '@/core/Math'
import type { FrameData, IncomingGrade, MovesetData, PlayerBaseData, WeaponData } from '@/data/schema'
import { EntityStats, playerStatsFrom } from '@/combat/EntityStats'
import { advanceActionFrames, applyActionStop, type ActionStop } from '@/combat/ActionFrames'
import { armStats, CorruptionMeter, statusConfig } from '@/combat/Statuses'
import { armCrumple, reactionConfig } from '@/combat/Reactions'
import { msToTicks, TICK_HZ } from '@/core/Time'
import type { Vec3 } from '@/combat/EntityStats'
import type { Occluder } from '@/core/Occlusion'
import type { HitTarget } from '@/combat/HitShapes'
import { defaultMods, type PlayerMods } from '@/rpg/Runtime'
import { movementName } from '@/rpg/Movements'
import type { SkillAction, SkillCast } from '@/rpg/Movements'

/** 蓄力攒满要按满这几 tick；导出是为了量具不再抄第二份常数（§55） */
export const CHARGE_TICKS = 48
/** 台阶容差：与 world/Surface 的 floorAt tolerance 一致，超过就不算「踩上台阶」 */
const STEP_UP = 0.5

export type MoveIntent = { x: number; z: number; sprint: boolean }

export type ActivePlayerHit = {
  box: FrameData['hitbox']; yaw: number; damage: number; poise: number;
  hitStopMs: number; shake: string; flags: string[]; loudness: number
  /** §8 反应分级：这一式打在挨打的人身上算哪一档（缺省＝按出手重量轴取档，见 CombatManager） */
  reaction?: FrameData['reaction']
}

/**
 * 玩家一次出手的运行时状态。§9 攻方那一半要在它身上记两格（`ActionStop`：还要按住几 tick /
 * 欠下几帧没还），所以从 `PlayerController` 的内联类型提成一个具名接口。
 */
export interface PlayerAction extends ActionStop {
  key: string; f: FrameData; hitDone: boolean; shots: number
  /** 这一记已经打到过哪些目标（`f.multi` 是名额上限）。判定窗有好几 tick，同一目标不能被同一记打两遍 */
  hitIds: Set<string>
  /** 非 null ⇒ 这一记是乐章战技（§7）：伤害标尺、真伤、闷音、位移都从它身上取 */
  skill: SkillCast | null
  /** 战技位移（错拍步）的行进方向；null＝不出位移 */
  dir: Vec3 | null
  /**
   * §8 R2 那行括号里的「招式自带 1 次 R2 免役」（KI-052②）：用过了没有。
   * 它记在**这一式**上而不是人身上——"一式一次"说的是这一式，不是"这个角色一直免役"；
   * 下一式是新的对象，那一格自己归零。
   */
  hyperSpent?: boolean
}

/** 没有遮挡名册时的空清单（默认注入：没有墙的地方不该有任何阻挡，KI-154） */
const EMPTY_OCCLUDERS: readonly Occluder[] = []

export class PlayerController {
  pos: Vec3 = { x: 0, y: 0, z: 0 }
  yaw = 0
  stats: EntityStats
  grounded = true
  vy = 0
  /** 当前站立面的高度，由 world/Surface 每 tick 注入（垂直分层世界） */
  floorY = 0
  /**
   * **指令速度**（米/秒）：这一 tick 走/跑命令里的实际水平速度。
   *
   * 为什么是"指令"而不是位置差分：位置差分会把**击退**（`takeDamage` 推的那一下）与
   * **传送**算成"跑得很快"，而相机的"跑起来把镜头往后拉一点"只该对真正的移动生效。
   * 消费者唯一：`player/CameraRig.ts` 的非锁定距离微调。
   */
  moveSpeed = 0
  action: PlayerAction | null = null
  /**
   * §5.5 那一次翻滚的运行时状态。`dist` 是**这一滚自己的**位移（米，整段走完的总长）：
   * 起手时从 `rollDist()` 快照一份，而不是每 tick 再读一次表——朝向在滚的过程中会被
   * `faceTowards` 改动，逐 tick 重算就会让"后向 2.6m"在半途变成 3.2m（与 `punishTicks` 同一口径：
   * 一次翻滚的属性记在翻滚身上，KI-085 已经立过这条规矩）。
   */
  roll: { tick: number; dir: Vec3; dist: number; total: number; iframeStart: number; iframeEnd: number; punishTicks?: number } | null = null
  guardTicks = 0
  guardStartTick = -999
  parryTicksLeft = 0
  /**
   * §15.2 被 Boss「夺拍」之后，玩家的节奏工具改挂到他的拍上：
   * - 体力只在**他的**拍点窗（windowTicks）内回复，窗外为 0 ⇒ 你的呼吸由他的网格决定；
   * - 闪避恢复锁在 ±dodgeJitterTicks 之间交替漂移（§15.2 的 ±60ms）。
   * 由 CombatManager 每 tick 写（那里同时看得见 Boss 阶段与输入），本类只消费。
   */
  beatParasite: { regenMul: number; windowTicks: number } | null = null
  dodgeJitterTicks = 0
  private dodgeCount = 0
  parryWhiffTicks = 0
  /**
   * §5.3「失败」行（KI-054）：弹反窗开着、还没被弹反成功清账。
   * 窗口自然走完或被一记没弹到的攻击吃掉 ⇒ 从此 tick 起挂落空后摇；
   * `CombatManager` 弹反成功那一支调 `onParrySuccess()` 把它撤掉。
   */
  parryWhiffPending = false
  /**
   * §7.2 定音回响（KI-037①）：出手一式往身上存的「加宽弹反窗」充能。
   * 弹反按下的那一 tick 花掉一格：那一扇窗宽 ×`windowMul`，且弹中必挂破势（判据在 CombatManager）。
   * **开窗即花**——弹不弹得中那一记，开窗之前没人知道；赌注口径与 §5.3 的落空同一条账（KI-054）。
   */
  echo: { chargesLeft: number; windowMul: number } | null = null
  /** 此刻开着的这扇窗是不是回响加宽的（弹反成功支据此决定要不要强挂破势） */
  parryEchoLive = false
  /**
   * §7.2 无声协奏：生效期间玩家**全部行动零噪音**（`noise()` 是唯一出口，见它那一行）
   * 且出手吃 `dmgBonus`。它不是成长，是一记出手换来的限时状态——不进存档，死了不清零才奇怪。
   */
  tacet: { ticksLeft: number; dmgBonus: number } | null = null

  /** 超载提示的冷却：连打翻滚键不该把同一句话刷屏，但一次都不说就是「按了没反应」 */
  overloadWarnTicks = 0
  stunTicks = 0
  /**
   * §9「冻结攻守双方动画时间」的**守方**那一半（KI-017 第二步）：被这一记打中的这几 tick 里，
   * 硬直倒数不走。时长不写第二份常数，由 `CombatManager` 从那一格的 `frames.hitStopMs` 派生
   * （`msToTicks`）。出手那一方的招式帧同样会被按住，但走另一格账与另一套判据 —— 见 `freezeAction`。
   */
  stunStopTicks = 0
  crumpleTicks = 0
  chargeTicks = 0
  charging = false
  /** KI-029 之连：连段深度（第几段连续攻击；1 = 起手式，0 = 不在连段里） */
  comboDepth = 0
  /** KI-002 蓄力反馈（§2 排行榜那行）：0..1，ActorVisuals 据此画武器辉光强度 */
  get chargeProgress(): number { return this.charging ? Math.min(1, this.chargeTicks / this.chargeThreshold) : 0 }
  /** 本武器蓄满阈值（tick）：§4.2/4.3/4.5 逐武器 `chargeTicks`；省略 = 全局 `CHARGE_TICKS` 基线（KI-117②） */
  get chargeThreshold(): number { return this.moveset.chargeTicks ?? CHARGE_TICKS }
  executing: { tick: number; total: number; pos: Vec3 } | null = null
  lockedTarget: { getPos(): Vec3; get radius(): number } | null = null
  /**
   * §4.3「投掷枪……按处决键拾回」的那一格手上状态（KI-006 剩余缺口①）：投出去就是 false，
   * 捡回来（或"枪回家了"：死亡/跨区/重开）就是 true。写方只有 `CombatManager` 那三处——
   * 本类只负责在出手门口读它，于是"投不出第二杆"这件事有一个答案而不是两个。
   * 名字跟着文档那句的主语（引针枪）走，判据却跟着帧表的 `flags:['throw']`：今天带这一格的
   * 只有 `ms_spear.charged`，所以两者此刻是同一件事；将来若真有第二件可投的武器，改的是表不是这里。
   */
  spearInHand = true
  /**
   * **authored 墙的名册**（KI-154）：组合根注入**同一本**遮挡名册（箭、视线、敌人绕路用的那一份）。
   *
   * **为什么玩家也要用它**：同一堵塌墙在别处都挡人（挡箭 KI-014②b、挡视线、挡玩家自己的刀 KI-070），
   * 唯独对玩家自己不是墙 ⇒ 玩家会**穿过**看得见的墙（实测：穿过 1.8m 厚的墙走了 13.8m）。
   * 那份名册是**活引用**（换区域就换内容），所以这里存的是"取名册的函数"而不是一份拷贝。
   */
  occluders: () => readonly Occluder[] = () => EMPTY_OCCLUDERS

  exhausted = false
  private footAccum = 0
  private dead = false
  private deadTicks = 0
  /**
   * Phase 5-B：成长系统灌进来的一组扁平乘数（音级派生 + 装备词缀）。
   * 这里只做消费——它不认识 Progression，也不知道词缀从哪来（见 src/rpg/Runtime.ts）。
   */
  rpg: PlayerMods = defaultMods()
  /**
   * §11 失谐（褪色值）。它是**玩家身上的一块计量表**而不是一个 buff：区域数据决定它涨多快，
   * 消耗品与调音桩决定它怎么掉，HUD/画面决定它怎么被看见——三层都不互相认识，只认这个对象。
   */
  readonly corruption: CorruptionMeter
  /**
   * §7 乐章战技：当前装着的两式（键＝输入动作名）。由 main.ts 在每次成长/换装后灌进来，
   * 本类不认识 movements.json——它只认这份已经折算好等级的小表。
   */
  skills: Record<string, SkillAction> = {}
  /** 冷却按**输入槽**记账（不是按式子）：同一式装在两个槽里，两条冷却各自走 */
  private skillCd = new Map<string, number>()
  /**
   * 全音符斩那类「压在下一记重击上」的起手式：层数与真伤由 §11 的震裂通道在命中时结算。
   * 它是**瞬时状态**，不入档——读档后回到没起手，比凭空带着一层蓄力诚实。
   */
  followup: { layers: number; trueDamage: number } | null = null
  /**
   * §7.2 错拍步的落地窗口：脚落地之后这些 tick 内，自己的攻击架式伤害加 `landingPoise` 那点。
   * 它是一个**带时限的加法项**，所以不住在 `PlayerMods` 里（那张表是装备/属性的静态汇总），
   * 而是玩家自己的战斗态——和 `followup`（全音符斩压在下一记上的真伤）同一类。
   */
  landingPoise = 0
  private landingPoiseTicks = 0
  /** §7.3 常拍脚（KI-036）：落地/翻滚结束后的踏音宽限（tick）。0 = 被动没学/不在窗内 */
  beatGraceTicks = 0
  private beatGraceDuration = 0
  /**
   * §7.3 轻身法（KI-036）：处决演出**最后一段**的可取消占比（0.3 = 后 30%；0 = 没学）。
   * 与 `beatGraceDuration` 同一口径：它是被动的配置值，由 `refreshPlayer` 灌进来、不入档。
   */
  private execCancelFrac = 0
  /**
   * §7.2 休止斩那格「每次使用后过载消耗 +2（防连发）」：按**输入槽**记的涨价账（和 `skillCd` 同一口径，
   * 所以同一式装在两个槽里也是各涨各的）。它刻意不住 `movements.json` 的可存档部分，也不入档：
   * 那是"这一段连打的余温"，读档后回到没涨过价，比凭空背着一笔涨价诚实。
   */
  private skillRamp = new Map<string, number>()
  /** 本 tick 的相对移动输入（战技位移的方向源）。刻意缓存而不是把 Input 传进 tryStartAction：出招入口保持一个签名 */
  private moveIntent = { x: 0, y: 0 }
  /**
   * §4.4 泛音弓「移动中散布 +4°」的判据：这一 tick 有没有在推摇杆/方向键。
   * 0.5 与输入层判疾跑的那条线同源（`ThirdPersonController.update` 里 sprinting 的门）。
   */
  get moving(): boolean { return Math.hypot(this.moveIntent.x, this.moveIntent.y) > 0.5 }

  constructor(public base: PlayerBaseData, public weapon: WeaponData, public moveset: MovesetData) {
    this.stats = playerStatsFrom(base)
    armStats(this.stats) // §11 闷音的 -30% 回复与震裂的层数规则都来自 statuses.json
    armCrumple(this.stats, false) // §8 R4：玩家破势 1.8s，时长在 reactions.json，不在这里写第二遍
    this.corruption = new CorruptionMeter()
    this.stats.defense = base.defense
    // 未接成长系统时（单元测试/工具）也要有一组**恒等**乘数：属性取 player.json 的面板值，
    // 于是伤害与 Phase 5-B 之前逐位相同——成长系统是叠加，不是替换。
    this.rpg = { ...defaultMods(), attrs: { ...base.attrs } }
  }

  get dead_(): boolean { return this.dead }
  get iFrame(): boolean {
    if (this.executing) return true // §5.4 execution montage: player invulnerable
    if (this.roll) {
      const t = this.roll.tick
      return t >= this.roll.iframeStart && t <= this.roll.iframeEnd
    }
    return false
  }
  get guarding(): boolean { return this.guardTicks >= this.base.guard.startupTicks }
  get parryActive(): boolean { return this.parryTicksLeft > 0 }
  get busy(): boolean { return this.action !== null || this.roll !== null || this.stunTicks > 0 || this.crumpleTicks > 0 || this.executing !== null || this.dead }
  /**
   * §8 的「霸体」此刻是活的：这一式在帧上带着 `hyper`、还在**前摇+Active** 段内（收势段不算，
   * 那一段的"我已经把拍子交出去了"不该再受保护），且那一次免役没被用掉。
   * 生产者今天有两个：调律剑与强音大剑的蓄力和弦斩（§4.1/§4.2）——此前这两个声明零读取方。
   */
  get hyperLive(): boolean {
    const a = this.action
    if (!a || a.hyperSpent) return false
    if (!(a.f.flags ?? []).includes('hyper')) return false
    return a.tick <= a.f.activeEnd
  }
  /** 用掉这一式的免役（只有真的挡下了一记 R2 才算用掉——见 `takeDamage`） */
  spendHyper(): void { if (this.action) this.action.hyperSpent = true }

  get activeHitbox(): ActivePlayerHit | null {
    if (!this.action) return null
    const f = this.action.f
    if (this.action.tick < f.activeStart || this.action.tick > f.activeEnd || this.action.hitDone) return null
    return {
      box: f.hitbox, yaw: this.yaw,
      // 战技的伤害写在等级表上（cast.damage），武器帧的 damage 对战技恒为 0——见 rpg/Movements.ts
      // 律色词缀（KI-029）：战技伤害的唯一乘点——技能那一支离开 activeHitbox 前吃 (1+skillDmg)。
      // 近战/弹体/回声重演都不经过这里，各走各的账；面板显示的是等级底数，不含本乘数（已登记）。
      // 之连词缀（KI-029 收尾）：连段每多一段，非战技近战多 (comboScaling × (depth-1))——起手式不加。
      damage: this.action.skill
        ? Math.round(this.action.skill.damage * (1 + this.rpg.skillDmg))
        : f.damage * (1 + this.rpg.comboScaling * Math.max(0, this.comboDepth - 1)),
      poise: f.poise, hitStopMs: f.hitStopMs,
      shake: f.shake ?? 'normal', flags: f.flags ?? [], loudness: (f.loudness ?? 3) * (this.weapon.noiseMul ?? 1),
      reaction: f.reaction
    }
  }

  /**
   * 「这一记打到人了」。近战老规矩是一记一名目标（打空了不许横扫全群）；
   * 写了 `f.multi` 的招式（环形战技）打到上限才作罢。
   */
  markActionHit(victimId: string): boolean {
    const a = this.action
    if (!a || a.hitDone || a.hitIds.has(victimId)) return false
    a.hitIds.add(victimId)
    if (a.hitIds.size >= (a.f.multi ?? 1)) a.hitDone = true
    return true
  }

  setSkills(skills: Record<string, SkillAction>): void {
    this.skills = skills // 冷却不跟着清：在调音桩换装不该顺手把刚交的学费退回来
  }

  /** §7.3 常拍脚（KI-036）：被动等级给的宽限时长（秒），null = 没学。窗宽 ±80ms 是 strikeEnemy 的事 */
  setBeatGrace(durationSec: number | null): void {
    this.beatGraceDuration = durationSec ? Math.round(durationSec * TICK_HZ) : 0
  }

  /** §7.3 轻身法（KI-036）：可取消段占演出的比例，null = 没学。取消窗按比例从演出末尾倒着量，不写第二份秒数 */
  setExecCancel(windowFrac: number | null): void {
    this.execCancelFrac = windowFrac ?? 0
  }

  /** 战技冷却还剩几 tick（0＝可出手）。UI/调试器读它，不自己算 */
  skillCooldown(actionKey: string): number { return this.skillCd.get(actionKey) ?? 0 }
  /** 这一槽此刻的连打涨价（§7.2 防连发；0＝还是表上的底价）。给面板与测试读，不是第二个判据 */
  skillRampOf(actionKey: string): number { return this.skillRamp.get(actionKey) ?? 0 }

  /**
   * 取走「压在下一记上的起手式」。只有重击能兑现它（§7.2 全音符斩明写"下一记重击"），
   * 所以轻击/战技调用时传 false：不消费、不清空。
   */
  takeFollowup(onHeavy: boolean): { layers: number; trueDamage: number } | null {
    if (!onHeavy || !this.followup) return null
    const f = this.followup
    this.followup = null
    return f
  }

  /** data-driven weapon swap: reset transient action state, adopt new frames */
  equip(weapon: WeaponData, moveset: MovesetData): void {
    if (weapon.id === this.weapon.id) return
    this.weapon = weapon
    this.moveset = moveset
    this.action = null
    this.comboQueued = null
    this.charging = false
    this.chargeTicks = 0
    this.executing = null
    bus.emit('audio.sfx', { key: 'ui_select', pos: { ...this.pos }, gain: 0.5 })
    this.publishStats()
  }

  /**
   * 成长/装备变化后重新灌一次（升级、换装、强化、洗点都走这里）。
   * 升级带来的上限增长**立刻兑现**（§8.1「数值层反馈：HP 微条实际增长」），
   * 但只补差额——掉的血不会被顺手治好，调音桩才有治疗权。
   */
  applyRpg(m: PlayerMods): void {
    const dHp = m.hpMax - this.stats.hpMax
    this.stats.hpMax = m.hpMax
    this.stats.hp = clamp(this.stats.hp + Math.max(0, dHp), 0, m.hpMax)
    this.stats.staMax = m.staminaMax
    this.stats.stamina = Math.min(this.stats.stamina, m.staminaMax)
    this.stats.poiseMax = m.poiseMax
    this.stats.defense = m.defense
    this.stats.overdriveMax = m.overdriveMax
    this.stats.overdrive = Math.min(this.stats.overdrive, m.overdriveMax)
    this.corruption.resistMul = m.corruptionResistMul
    this.rpg = m
    this.publishStats()
  }

  /**
   * 发声时的噪音乘数（静默词缀 / 无鸣类武器）：所有 sound.source 出口共用它。
   * 无声协奏期间这里就是那条"全部行动零噪音"的**唯一**闸口——每一处脚步/挥击/刀锋相交
   * 都已经从这一个函数出去（含 CombatManager 的弹反冲击），所以那一句不需要任何一处特例。
   */
  private noise(loudness: number): number { return this.tacet ? 0 : loudness * this.rpg.noiseMul }

  /**
   * 刀兵相交的那一记（弹反 / 完美格挡）归**武器**而不是归脚步：和招式一样同时吃
   * 武器噪音系数与词缀系数，所以无鸣类武器防御出来的世界是安静的。
   * 基数在 player.json（`parry.impactLoudness` / `guard.impactLoudness`），这里只做标尺换算。
   */
  weaponImpactNoise(baseLoudness: number): number {
    return this.noise(baseLoudness * (this.weapon.noiseMul ?? 1))
  }

  faceTowards(p: Vec3): void {
    const d = Math.atan2(p.x - this.pos.x, p.z - this.pos.z)
    this.yaw += clampAngleDiff(this.yaw, d) * 0.35
  }

  /** §5.4: snap to face the victim, enter the invulnerable input-lock montage */
  beginExecute(targetPos: Vec3, totalTicks: number): void {
    this.yaw = Math.atan2(targetPos.x - this.pos.x, targetPos.z - this.pos.z)
    this.action = null
    this.roll = null
    this.charging = false
    this.chargeTicks = 0
    this.guardTicks = 0
    // KI-051：把受刑者位置也记进这一格——§5.4 的「越肩推轨」要朝它推，
    // 而时长已经在 `{tick,total}` 里，不再写第二份秒数（EventBus 上 `audio.muffle` 同一口径）。
    this.executing = { tick: 0, total: totalTicks, pos: { ...targetPos } }
  }

  update(dt: number, time: GameTime, input: Input, tick: number, rhythm: RhythmClock): void {
    if (this.dead) {
      this.deadTicks++
      if (this.deadTicks > 240) { this.deadTicks = 0; this.respawn() }
      return
    }
    const canAct = this.stunTicks <= 0 && this.crumpleTicks <= 0
    if (this.landingPoiseTicks > 0 && --this.landingPoiseTicks === 0) this.landingPoise = 0
    if (this.beatGraceTicks > 0) this.beatGraceTicks--
    // 无声协奏的钟点：tick 一到世界重新听得见她，不需要任何人去"解除"它
    if (this.tacet && --this.tacet.ticksLeft <= 0) this.tacet = null
    this.moveIntent = { x: input.frame.move.x, y: input.frame.move.y }
    if (this.executing) {
      this.executing.tick++
      // §7.3 轻身法（KI-036）：走到最后一段时，翻滚键把蒙太奇提前收掉。窗从末尾倒着量
      // （`tick > total*(1-frac)`），所以表里写 0.3 就是 §7.3 原文那句"后 30% 段"，不另写秒数。
      // 取消的判据是**这一下真的能翻滚起来**（与下面 dodge 分支同一条）：判不通时**不清演出**、
      // 而是落回正常输入路径——超载那条拒判要照 §25 报出来，不许因为改了这里就变回静默。
      // 代价是同步的：演出期无敌（`iFrame`）跟着 `executing` 一起走，换回来这一 tick 的操作权。
      const total = this.executing.total
      const inWindow = this.execCancelFrac > 0
        && this.executing.tick > Math.floor(total * (1 - this.execCancelFrac))
      const press = input.frame.edges.has('dodge') && canAct && !this.dead
      const canRollNow = !this.rpg.overloaded && this.stats.stamina >= this.rollProfile(this.lockedTarget !== null).stamina
      if (inWindow && press && canRollNow) {
        this.executing = null // 取消成立：落回本 tick 的正常输入路径，翻滚就在这里起
      } else if (!(inWindow && press)) {
        if (this.executing.tick >= total) this.executing = null
        this.stats.update(dt, tick, false)
        this.publishStats()
        return
      }
      // 落到下面 = 演出还挂着但本 tick 交还输入（消音的边沿在 CombatManager 那一侧自己会收）
    }
    for (const [k, v] of this.skillCd) {
      if (v <= 1) this.skillCd.delete(k)
      else this.skillCd.set(k, v - 1)
    }
    // 夺拍期间：他的拍点窗外不给回气（mods.regenMul 是 EntityStats 已有的乘子通道）。
    // 装备的节律词缀与超载惩罚叠在这个乘子上——三者都只写一次，不各自另开一条回复路径。
    const regenBase = this.rpg.staminaRegenMul * (this.rpg.overloaded ? 0.6 : 1)
    if (this.beatParasite && rhythm) {
      const onHisBeat = rhythm.ticksFromBeatPoint() <= this.beatParasite.windowTicks
      this.stats.mods.regenMul = (onHisBeat ? this.beatParasite.regenMul : 0) * regenBase
    } else this.stats.mods.regenMul = regenBase
    this.stats.update(dt, tick, this.guarding)

    // ---- defense inputs (always live unless rolling/attacking) ----
    if (this.action === null && this.roll === null && canAct) {
      if (input.frame.held.has('guard')) {
        if (this.guardTicks === 0) this.guardStartTick = tick
        this.guardTicks = Math.min(this.guardTicks + 1, 9999)
      } else this.guardTicks = 0
      if (input.frame.edges.has('parry') && this.parryTicksLeft <= 0 && this.parryWhiffTicks <= 0 && this.stats.stamina >= 5) {
        // 定音回响：开窗那一 tick 花掉一格充能，这一扇窗因此加宽（§7.2「下一次弹反窗口 ×2」）
        const echo = this.echo && this.echo.chargesLeft > 0 ? this.echo : null
        this.parryEchoLive = echo !== null
        if (echo) {
          echo.chargesLeft--
          if (echo.chargesLeft <= 0) this.echo = null
        }
        this.parryTicksLeft = this.base.parry.activeTicks * (echo?.windowMul ?? 1)
        this.parryWhiffPending = true
        if (this.guardTicks > 0) this.guardTicks = 0
      }
    } else if (this.action || this.roll) this.guardTicks = canAct ? this.guardTicks : 0
    // 后摇倒数**先于**开窗口的落账：不然 beginParryWhiff 刚把 27 写上就在同一 tick 被自己减成 26，
    // 表里的 whiffRecovery 与实际锁格数差一（KI-054）。
    if (this.parryWhiffTicks > 0) this.parryWhiffTicks--
    if (this.parryTicksLeft > 0) {
      this.parryTicksLeft--
      if (this.parryTicksLeft === 0) {
        // 窗一关，回响那一格就翻篇：充能照旧花掉（开窗即花），但"必挂破势"没赚到
        this.parryEchoLive = false
        // 窗口走完而没人被弹到 ⇒ §5.3 的落空。被一记吃掉（没弹着）的那支在 CombatManager 里走 beginParryWhiff。
        if (this.parryWhiffPending) this.beginParryWhiff()
      }
    }
    if (this.overloadWarnTicks > 0) this.overloadWarnTicks--

    // ---- heavy hold -> charge ----
    if (input.frame.held.has('attackHeavy') && this.action === null && !this.busy) {
      this.charging = true
      this.chargeTicks++
    } else if (this.charging && !input.frame.held.has('attackHeavy')) {
      this.charging = false
      if (this.chargeTicks >= this.chargeThreshold && canAct) this.tryStartAction('charged', tick)
      else if (this.chargeTicks < 8 && canAct && this.action === null) this.tryStartAction('h', tick)
      this.chargeTicks = 0
    }

    // ---- attacks ----
    if (canAct && !this.charging) {
      if (input.frame.edges.has('attackLight') && this.action === null && this.roll === null) {
        const key = !this.grounded && this.moveset.actions['jump'] ? 'jump'
          : (input.frame.held.has('sprint') && Math.hypot(input.frame.move.x, input.frame.move.y) > 0.5 && this.moveset.actions['run']) ? 'run'
          : 'l1'
        this.comboDepth = 1 // 起手式：连段从第一段开始
        this.tryStartAction(key, tick, rhythm)
      } else if (input.frame.edges.has('attackLight') && this.action) {
        const nxt = this.action.f.next
        if (nxt && this.action.tick >= this.action.f.activeStart) this.comboQueued = nxt
      }
    }
    if (input.frame.edges.has('jump') && this.grounded && !this.busy && this.stats.spendStamina(6, tick)) {
      this.vy = this.base.jumpSpeed
      this.grounded = false
      bus.emit('sound.source', { id: 'player', pos: { ...this.pos }, loudness: this.noise(0.2) })
    }
    if (input.frame.edges.has('dodge')) {
      // 按了却什么都不发生，是本作最不该有的体验（需求 §25「每次输入都要有可感知的反馈」）：
      // 超载这条拒判此前彻底静默，玩家只知道"翻滚键坏了"。拒的同时说清是哪一维在拦、现在多重、
      // 上限多少——数字全部来自 mods()，不是第二份常数。
      if (!this.rpg.overloaded && (canAct || this.roll === null) && this.stats.stamina >= this.rollProfile(this.lockedTarget !== null).stamina && !this.dead) this.startRoll(tick)
      else if (this.rpg.overloaded) this.warnOverloaded()
    }

    // ---- action progression ----
    if (this.action) {
      const f = this.action.f
      // §9 攻方那一半（KI-017 第三步）：这一 tick 推进几帧由停顿账本给（0＝按住，2＝回拍补帧）。
      // 位移按同一格数缩放，这一句不是装饰：前冲段按老约定是 `startup .. startup + activeEnd`
      // （比判定窗晚 `startup` 格），而停顿整段排在窗尾之后 ⇒ 两者必然重叠，按住的那几 tick 不许
      // 往前蹭，否则"停住"变成"原地滑行"。还债的双格步同样落在这条带里（判据 4 保证债在收势前还清），
      // 所以带内走过的帧数不变 ⇒ 前冲的**落点**不变，变的只是它被切成了"停—冲—停"。
      const adv = advanceActionFrames(this.action, f)
      this.action.tick += adv
      if (adv > 0 && this.action.tick >= f.startup && this.action.tick <= f.startup + f.activeEnd && f.lunge) {
        const step = (f.lunge / f.activeEnd) * adv
        this.pos.x += Math.sin(this.yaw) * step
        this.pos.z += Math.cos(this.yaw) * step
      }
      /**
       * KI-135：武器拖尾的发射方。**在判定窗内每帧发一次**——拖尾要的是"刃口这一路的轨迹"，
       * 一次性的事件只能给出起点，给不出轨迹。位置是刃口的近似（玩家身前 1.0m、地上 0.2m），
       * 朝向是玩家面朝的方向，up 取世界上方向（不是相机 up：拖尾属于世界，不属于镜头）。
       *
       * 发不发由**武器表**决定（`weapons.json > trail`）：弓与法杖没有这一格 ⇒ 不发
       * （弓的拖尾是弹道那一族，走 `vfx.trail.projectile`）。
       */
      if (this.weapon.trail && this.action.tick >= f.activeStart && this.action.tick <= f.activeEnd) {
        const fx = Math.sin(this.yaw)
        const fz = Math.cos(this.yaw)
        bus.emit('vfx.trail.weapon', {
          id: this.weapon.trail,
          pos: { x: this.pos.x + fx * 1.0, y: this.pos.y + 0.2, z: this.pos.z + fz * 1.0 },
          forward: { x: fx, y: 0, z: fz },
          up: { x: 0, y: 1, z: 0 }
        })
      }
      // 战技位移（错拍步）：走**判定窗**这几 tick，一步的距离由等级表给。
      // 它和 lunge 分开写，是因为两者的时间轴口径本来就不同：lunge 是招式自带的前冲（按
      // startup 起算的老约定），位移是"从出声到落地的这几格"。合并就会改动既有武器的落点。
      const d = this.action.dir
      if (d && this.action.skill && this.action.tick >= f.activeStart && this.action.tick <= f.activeEnd) {
        const span = Math.max(1, f.activeEnd - f.activeStart + 1)
        const step = (this.action.skill.distance / span) * adv
        this.pos.x += d.x * step
        this.pos.z += d.z * step

      }
      if (this.action.tick >= f.recovery) {
        // 「落地」= 这一式结束、手又能动起来的那一刻。为什么不在判定窗末（activeEnd）就开：
        // 错拍步的恢复有 20 tick，而窗口只有 18 tick——按 activeEnd 起算，窗口会在玩家能出手之前
        // 就自己走完，那条 +3 永远吃不到。口径写进数据（landing.withinTicks），起算点写在这里。
        const landed = this.action.skill
        if (landed && landed.landingPoise > 0) {
          this.landingPoise = landed.landingPoise
          this.landingPoiseTicks = landed.landingPoiseTicks
        }
        // §7.3 常拍脚：招式收完落地 = 另一个起算点（KI-036；错拍步的 landing 加成同站不冲突）
        if (this.beatGraceDuration > 0) this.beatGraceTicks = this.beatGraceDuration
        if (this.comboQueued && f.next && this.action.tick >= f.activeEnd) {
          const q = this.comboQueued
          this.comboQueued = null
          this.action = null
          this.comboDepth++ // 连段续接：深度递增（之连词缀的乘数）
          this.tryStartAction(q, tick, rhythm)
        } else this.action = null
      }
    }
    // ---- movement ----
    // 指令速度每 tick 重算：不能动的那几拍（被控/演出/翻滚）必须归零，
    // 否则相机会拿着一拍前的速度把镜头往后拉（"停下来了镜头还在退"）。
    this.moveSpeed = 0
    if (canAct && !this.busyMovementLocked()) {
      const mv = input.frame.move
      const sprinting = input.frame.held.has('sprint') && !this.rpg.overloaded && mv.x * mv.x + mv.y * mv.y > 0.1 && !this.guarding
      const speed = sprinting ? this.base.sprintSpeed : this.base.moveSpeed
      const camYaw = this.camYawRef ?? this.yaw
      const cs = Math.sin(camYaw), cc = Math.cos(camYaw)
      // camera at +yaw offset: screen-forward (mv.y=+1) = -(sin c, cos c)
      const wx = mv.x * cc - mv.y * cs
      const wz = -(mv.x * cs + mv.y * cc)
      const wl = Math.hypot(wx, wz)
      if (wl > 0.05) {
        const nx = wx / wl, nz = wz / wl
        const sp = Math.min(wl, 1) * speed * (this.guarding ? 0.35 : 1) * (this.action ? 0.15 : 1)
        // **撞墙**（KI-154）：与墙求交用的是**同一本遮挡名册**（箭/视线/敌人绕路/相机撞墙那一份）。
        // 解法是**圆 vs 凸体的最小平移量**（见 `moveWithWalls`）：进墙的那一轴被推回，切向那一轴保留 ⇒ 沿墙滑。
        const stepX = nx * sp * dt
        const stepZ = nz * sp * dt
        const moved = this.moveWithWalls(stepX, stepZ)
        this.pos.x += moved.x
        this.pos.z += moved.z
        this.moveSpeed = sp
        if (!this.action && !this.lockedTarget && !this.guarding) this.yaw += clampAngleDiff(this.yaw, Math.atan2(nx, nz)) * 0.25
        if (sprinting) {
          this.stats.stamina = Math.max(0, this.stats.stamina - this.base.sprintCostPerSec * dt)
          if (this.stats.stamina <= 0) this.exhausted = true
        }
        this.footAccum += sp * dt
        const stride = sprinting ? 2.2 : 3.0
        if (this.footAccum > stride) {
          this.footAccum = 0
          bus.emit('sound.source', { id: 'player', pos: { ...this.pos }, loudness: this.noise(sprinting ? 0.45 : 0.18) })
          bus.emit('audio.sfx', { key: 'footstep', pos: { ...this.pos }, gain: 0.25 })
        }
      }
    }
    // gravity — floorY 由 world/Surface 按区域层给出（休垒 0 / 地下 -40 …），不再硬编码 0
    if (!this.grounded || this.vy > 0 || this.pos.y > this.floorY) {
      this.vy -= this.base.gravity * dt
      this.pos.y += this.vy * dt
      if (this.pos.y > this.floorY) this.grounded = false // 走下边缘：脚下已无本层地面
      if (this.pos.y <= this.floorY) {
        const fallSpeed = -this.vy
        this.pos.y = this.floorY; this.vy = 0; this.grounded = true
        if (fallSpeed > 8) {
          bus.emit('vfx.request', { key: 'ring_dust', pos: { ...this.pos }, scale: clamp(fallSpeed / 16, 0.5, 1.4) })
          bus.emit('audio.sfx', { key: 'land_slam', pos: { ...this.pos }, gain: 0.4 })
        }
        if (this.action?.key === 'jump') this.action.tick = Math.max(this.action.tick, this.action.f.activeStart)
      }
    } else if (this.floorY - this.pos.y > 0 && this.floorY - this.pos.y <= STEP_UP) {
      this.pos.y = this.floorY // 踏上更高一层：只在台阶容差内抬升，避免跨层瞬移时被人拎起来
    }
    if (this.roll) {
      this.roll.tick++
      const step = (this.roll.dir.x * this.roll.dist) / this.roll.total
      const stepZ = (this.roll.dir.z * this.roll.dist) / this.roll.total
      this.pos.x += step; this.pos.z += stepZ
      if (this.roll.tick >= this.roll.total) {
        // §14.4 诱饵惩罚在这里兑现（KI-085）：这一滚把无敌帧花在了假动作上，所以站起来那一刻
        // 站不稳。它记在**这一次翻滚**身上 ⇒ 中途被打断/好处被拿走（takeDamage、beginExecute、
        // 重生）就一起作废——那一滚已经不是"被骗空的一滚"了，不该再补一笔。
        if (this.roll.punishTicks) this.stunTicks = Math.max(this.stunTicks, this.roll.punishTicks)
        this.roll = null
        // §7.3 常拍脚：翻滚结束 = 宽限起算点之一（KI-036）
        if (this.beatGraceDuration > 0) this.beatGraceTicks = this.beatGraceDuration
      }
    }
    // §9 的守方那一半（KI-017 第二步）：接触被按住的几 tick 里硬直倒数不走。先采样再扣，是为了
    // 让"按住"正好等于 `msToTicks(hitStopMs)` 格而不是少一格；这一格自己也每 tick 都要走——它计的
    // 是"那几十毫秒"，与"此刻有没有在硬直"无关（挂在硬直分支里会让一次停顿顺延到下一次硬直上）。
    const stopped = this.stunStopTicks > 0
    if (stopped) this.stunStopTicks--
    else if (this.stunTicks > 0) this.stunTicks--
    if (this.crumpleTicks > 0) { this.crumpleTicks--; this.stats.crumpleTicksLeft = this.crumpleTicks }
    if (this.stats.stamina > 15) this.exhausted = false
    this.publishStats()
  }

  private comboQueued: string | null = null
  camYawRef: number | null = null

  hitTarget(): HitTarget {
    return { pos: this.pos, facingYaw: this.yaw, radius: 0.4, height: 1.7 }
  }

  /**
   * §9 攻方那一半（KI-017 第三步）：她刚打中的那一记把**她自己**的招式帧按住几格，随后每 tick
   * 补一帧还回去 ⇒ 这一式仍然在与不按停时同一 tick 结束（节拍工具、连段派生、体力窗都不移位）。
   * 能不能按由 `applyActionStop` 的四条判据给：判定窗内、**一帧都不落在窗内**（窗尾之后才兑现）、
   * 非连发弹体招式、窗尾到收势那几帧还得起这笔债。
   * `src` 必须是"落下来的这一记"所属的那个出手对象（弹体命中时她可能在挥下一记，那不该被按停）。
   */
  freezeAction(ms: number, src: object): number {
    if (!this.action || this.action !== src) return 0
    return applyActionStop(this.action, this.action.f, ms)
  }

  private busyMovementLocked(): boolean {
    return this.roll !== null || (this.action !== null && this.action.tick < this.action.f.recovery * 0.6) || this.charging
  }

  /**
   * 摄像机相对的输入方向 → 世界单位向量；没有输入就朝正前方。
   * 翻滚与战技位移共用它：两处各算一遍，就会出现「翻滚往左、瞬步往屏幕左」这种不一致。
   */
  private moveDir(): Vec3 {
    const mv = this.moveIntent
    if (mv.x !== 0 || mv.y !== 0) {
      const camYaw = this.camYawRef ?? this.yaw
      const s = Math.sin(camYaw), c = Math.cos(camYaw)
      const wx = mv.x * c - mv.y * s, wz = -(mv.x * s + mv.y * c)
      const l = Math.hypot(wx, wz) || 1 // 【恒死·批24】L591 已保证 mv 非零，旋转保范数 ⇒ hypot 恒 > 0，|| 1 不可达
      return { x: wx / l, y: 0, z: wz / l }
    }
    return { x: -Math.sin(this.yaw), y: 0, z: -Math.cos(this.yaw) }
  }

  /**
   * §5.5 那张翻滚表的**唯一读数处**（KI-090）：一次翻滚的时长 / 免伤窗 / 体力价三格都从这里派生。
   *
   * 表里锁定侧步那一行（300ms/18f、4-16f、10 点）此前在代码里是两处各数一遍的：时长硬编码成
   * `locked ? 18`，体力那两条门槛读的是自由翻滚那一格（14）。于是「侧步只要 10 点」这一格数字
   * 躺在 `player.json` 里没有人读，而"12 点体力时滚不出自由翻滚、却该滚得出侧步"这条边界根本不存在。
   * 现在起手门槛、处决取消那一处的门槛、扣体力、时长与免伤窗四条腿共用这一份读数（位移是另一条腿，见 `rollDist`）。
   */
  rollProfile(locked: boolean): { total: number; iframeStart: number; iframeEnd: number; stamina: number } {
    const r = this.base.roll
    /**
     * 身份效果（§8.2「指法 35：翻滚体力 -2」，KI-138）：**只加在自由翻滚那一格**——
     * 锁定侧步是另一个动作（侧步），需求那句话说的是"翻滚"。
     *
     * **下限 1**：体力价 0 意味着"永远滚不了"（死档，不是设计）；负的体力价会让
     * `spendStamina` 变成加体力——那比"没效果"更坏。
     */
    const flat = this.rpg.rollStaminaFlat
    return locked
      ? { total: r.lockOnTotal, iframeStart: r.lockOnIframes[0], iframeEnd: r.lockOnIframes[1], stamina: r.lockOnStamina }
      : { total: r.total, iframeStart: r.iframeStart, iframeEnd: r.iframeEnd, stamina: Math.max(1, r.stamina + flat) }
  }

  /**
   * 一步移动撞上墙时的解法（KI-154）：**圆 vs 凸体**的最小平移量（MTV）解法。
   *
   * **几何取自同一本名册**（`core/Occlusion` 那一份：箭、视线、敌人绕路、相机撞墙都读它）——
   * 玩家这边不许再写一份墙的尺寸，那才是"两把尺"。
   *
   * **为什么不用 `firstBlock` 那条线段判据**：那条是给"打出去的线"写的；它那一档
   * `strict`（"走不走得过去"的口径）的语义是"**起点贴面即算挡**"——而玩家恰恰是**贴着墙面走**的：
   * 圆心正好落在扩大的墙面上时，那条判据会把"贴着墙往前挪一步"读成"起点贴在墙上 ⇒ 一步都走不了"，
   * 人被冻在墙前。移动要的是**分开**（MTV，把人推出去且保留切向位移），不是**拦停**（射线）。
   *
   * **沿墙滑**是 MTV 的副产品：往墙里走的那一轴被推回，切向那一轴原封不动 ⇒ 人贴着墙走而不是被咬住。
   *
   * **半径**用玩家自己的 `hitTarget().radius`（玩家的体积只有那一处定义），
   * **身高**用 `hitTarget().height`（竖带判定：墙比人矮时人该能从上面过去，不该被空气挡住）。
   */
  private moveWithWalls(dx: number, dz: number): { x: number; z: number } {
    const occ = this.occluders()
    if (occ.length === 0) return { x: dx, z: dz }
    const body = this.hitTarget()
    const r = body.radius
    const bottom = this.pos.y
    const top = this.pos.y + body.height
    let nx = this.pos.x + dx
    let nz = this.pos.z + dz
    // 最多解两轮：墙角处两块墙可能互相把玩家推进去，两轮足够分开（再多只是抖）
    for (let iter = 0; iter < 2; iter++) {
      let separated = false
      for (const o of occ) {
        // 竖带：墙比人矮（矮到人跨得过去）或人站在墙顶之上 ⇒ 不算挡
        if (top <= o.pos.y || bottom >= o.pos.y + o.heightM) continue
        if (o.shape === 'box') {
          const hx = o.halfX + r
          const hz = o.halfZ + r
          const px = nx - o.pos.x
          const pz = nz - o.pos.z
          if (Math.abs(px) >= hx || Math.abs(pz) >= hz) continue
          // 起点（本体）是不是**已经在墙里**？两条路的推法不一样：
          const sx = this.pos.x - o.pos.x
          const sz = this.pos.z - o.pos.z
          if (Math.abs(sx) < hx && Math.abs(sz) < hz) {
            // **体内 ⇒ 往"他进来的那一边"推**（不许推到墙的另一侧——那是穿墙，不是分开）。
            // 实测踩到过：按"新位置穿得最浅的那一轴"推，人在墙正中往南走 ⇒ 被推到南面去了，
            // 一步之间穿过了整堵墙。**推的方向取起点的偏移**（他在中心哪一侧就退回哪一侧），
            // 起点**正好在中心**（偏移为 0）时取**位移的反方向**（原路退回）。
            const penX = hx - Math.abs(sx)
            const penZ = hz - Math.abs(sz)
            if (penX < penZ) {
              nx = o.pos.x + (sx > 0 ? hx : sx < 0 ? -hx : dx > 0 ? -hx : hx)
            } else {
              nz = o.pos.z + (sz > 0 ? hz : sz < 0 ? -hz : dz > 0 ? -hz : hz)
            }
          } else {
            // 走进来的：穿得最浅的那一轴被推回，切向那一轴保留 ⇒ 沿墙滑而不是被钉住
            const penX = hx - Math.abs(px)
            const penZ = hz - Math.abs(pz)
            if (penX < penZ) nx = o.pos.x + (px < 0 ? -hx : hx)
            else nz = o.pos.z + (pz < 0 ? -hz : hz)
          }
        } else {
          const rr = o.radius + r
          const px = nx - o.pos.x
          const pz = nz - o.pos.z
          const d = Math.hypot(px, pz)
          if (d >= rr) continue
          const k = d < 1e-6 ? 1 : rr / d
          nx = o.pos.x + px * k
          nz = o.pos.z + pz * k
        }
        separated = true
      }
      if (!separated) break
    }
    return { x: nx - this.pos.x, z: nz - this.pos.z }
  }

  /**
   * §5.5「位移」那一列（KI-090）：`lockOnDist`(1.6m) 与 `backDist`(2.6m) 两格今天才第一次有读者。
   *
   * 锁定侧步走 `lockOnDist`：表里第二行**替代**第一行而不是叠加，所以锁定状态下不论输入朝哪都走那一格
   * 短步（"锁定 + 后向"表里没有第五格，不发明）。自由翻滚按"这一滚是否与朝向相反"取 `backDist`，
   * 反向判据用 `+sin/+cos` 那个朝向约定（与招式前冲 `f.lunge` 同一个）。注意 `moveDir()` 在**没有输入**
   * 时回落的是 `-sin/-cos`，正好与朝向相反 ⇒ 空输入的一滚会被算成后向，那条既有不一致登记在 KI-090 没做③。
   */
  rollDist(dir: Vec3, locked: boolean): number {
    if (locked) return this.base.roll.lockOnDist
    const backward = dir.x * Math.sin(this.yaw) + dir.z * Math.cos(this.yaw) < 0
    return backward ? this.base.roll.backDist : this.base.roll.dist
  }

  private startRoll(tick: number): void {
    const dir = this.moveDir()
    const locked = this.lockedTarget !== null
    const p = this.rollProfile(locked)
    this.stats.spendStamina(p.stamina, tick)
    this.action = null
    this.charging = false
    this.chargeTicks = 0
    // 恢复锁漂移：±jitter 交替（不是抽签——均值守恒，但每一滚的落点都要重新读）
    const jit = this.dodgeJitterTicks
    const drift = jit > 0 ? (this.dodgeCount++ % 2 === 0 ? jit : -jit) : 0
    this.roll = {
      tick: 0, dir, dist: this.rollDist(dir, locked),
      total: Math.max(6, p.total + drift),
      iframeStart: p.iframeStart,
      iframeEnd: p.iframeEnd
    }
    this.grounded = true
    bus.emit('sound.source', { id: 'player', pos: { ...this.pos }, loudness: this.noise(0.3) })
  }

  /**
   * §14.4「三叠箭第 2 拍为假动作（延迟 0.25 拍），骗翻滚后硬直 0.6s」的惩罚腿（KI-085）。
   *
   * 判据只有一条：**这一滚还在飞**。诱饵从身上穿过去（无敌帧吃掉它）就是"把这一滚花在了假动作上"，
   * 于是把毫秒折成 tick 记在**这一次翻滚**身上，自然结束那一拍转成 `stunTicks`。换算走全项目那把
   * 唯一的尺子 `msToTicks`，这里不留第二个秒数；时长本身在 `enemies.json > burst.feint.punishMs`。
   *
   * 返回"有没有记上"：不在翻滚里（站着挨了、或在处决演出里穿过去）就什么也不欠——那一句文档说的是
   * **骗翻滚**，不是"任何形式的无敌"。
   */
  beginFeintPunish(ms: number): boolean {
    if (!this.roll) return false
    const ticks = msToTicks(ms)
    if (ticks <= 0) return false
    this.roll.punishTicks = Math.max(this.roll.punishTicks ?? 0, ticks)
    return true
  }

  tryStartAction(key: string, tick: number, rhythm?: RhythmClock): boolean {
    // 武器招式与乐章战技**共用这一个入口**：查帧的顺序就是「先手上的武器，再谱册里的式子」。
    // 分两个函数就会长-out 两套出手状态机——那正是实机复验里翻过车的地方（见 combat 注释 §11）。
    const skill = this.skills[key] ?? null
    const f = skill ? skill.f : this.moveset.actions[key]
    if (!f || this.action || this.roll || this.stunTicks > 0 || this.crumpleTicks > 0) return false
    if (skill && !this.skillGate(key, skill)) return false
    // §4.3「按处决键拾回」的另一半：投出去的那一件没捡回来，就投不出第二件。判据取帧表的
    // `flags:["throw"]`（投掷的声明，与 CombatManager 写 `retrievable` 时读同一格），于是"哪些招式
    // 受这一格管"由表回答，不是代码里的一把武器名。拒绝发生在**扣精力之前**——与 KI-027
    // 「翻滚被拒那一行」同一条口径：没发生的事不该收费。这句话只在松手那一拍出一次
    // （`charged` 的入口是蓄力释放沿），所以连打断不会把它刷成噪声。
    if ((f.flags ?? []).includes('throw') && !this.spearInHand) {
      bus.emit('ui.notify', { text: '手上没有枪｜按处决键拾回投出的引针枪', kind: 'info' })
      return false
    }
    if (this.exhausted || !this.stats.spendStamina(f.stamina, tick)) {
      bus.emit('ui.notify', { text: '精力不足', kind: 'info' })
      return false
    }
    if (skill) {
      // 过载在门里已经验过，这里只负责扣：先验后扣，不会出现"钱付了式子没出手"
      const cost = this.overdriveCostOf(key, skill)
      this.stats.overdrive = clamp(this.stats.overdrive - cost, 0, this.stats.overdriveMax)
      this.skillCd.set(key, skill.cast.cooldownTicks)
      // 涨了价才走：连打的第一下按底价付，从第二下起每下贵 `overdriveRamp`（§7.2 防连发）
      if (skill.cast.overdriveRamp > 0) this.skillRamp.set(key, cost - skill.cast.overdriveCost + skill.cast.overdriveRamp)
      if (skill.cast.fissureLayers > 0 || skill.cast.trueDamage > 0) {
        this.followup = { layers: skill.cast.fissureLayers, trueDamage: skill.cast.trueDamage }
      }
      // §7.2 定音回响：存充能。再出一式是**换一批**而不是叠罗汉——"下一次"不该被攒成货币
      if (skill.cast.echoCharges > 0) {
        this.echo = { chargesLeft: skill.cast.echoCharges, windowMul: skill.cast.parryWindowMul }
        bus.emit('ui.notify', { text: `${movementName(skill.cast.id)}｜弹反充能 ×${skill.cast.echoCharges}`, kind: 'info' })
      }
      // §7.2 无声协奏：七秒的静默从这一记出手就开始计（时长与加成都是 movements.json 的数）。
      // 带这一栏的不止它一式（终止也静默，只是短得多），所以报名从 cast.id 现推。
      if (skill.cast.silenceTicks > 0) {
        this.tacet = { ticksLeft: skill.cast.silenceTicks, dmgBonus: skill.cast.silenceDmgBonus }
        bus.emit('ui.notify', { text: `${movementName(skill.cast.id)}｜${(skill.cast.silenceTicks / TICK_HZ).toFixed(1)}s 世界听不见你`, kind: 'info' })
      }
    }
    const cut = key.startsWith('l') ? Math.min(this.rpg.lightStartupTicks, Math.max(0, f.activeStart - 1)) : 0
    this.action = {
      key, f, tick: cut, hitDone: false, shots: 0, hitIds: new Set<string>(),
      stopTicks: 0, stopDebt: 0,
      skill: skill?.cast ?? null,
      dir: skill && skill.cast.distance > 0 ? this.moveDir() : null
    }
    this.comboQueued = null
    // `input.action` 此前是声明了没有发射方的死事件；它的读者（PatrolWatch，断弦线步 1
    // 「走完巡逻且未出手」的判据）要的是**出手那一拍**，不是命中——所以从这条唯一入口发，
    // 而不挂在 sound.source 上（音色晶落地、命中冲击、击杀噪声都在那条流里，「声东击西」
    // 恰恰是不动手的玩法）。闪避/交互不走这里：不动手的事不该弄脏判据。
    bus.emit('input.action', { action: key })
    bus.emit('audio.sfx', { key: f.sfx?.[0] ?? 'swing_1', pos: { ...this.pos }, gain: 0.7 })
    if (f.vfx?.[0]) bus.emit('vfx.request', { key: f.vfx[0], pos: { ...this.pos }, dir: { x: Math.sin(this.yaw), y: 0, z: Math.cos(this.yaw) } })
    bus.emit('sound.source', { id: 'player', pos: { ...this.pos }, loudness: this.noise(((f.loudness ?? 3) / 10) * (this.weapon.noiseMul ?? 1)) })
    void rhythm
    return true
  }

  /**
   * 这一式此刻要多少过载：表上的底价 + 连打涨出来的那截（§7.2 休止斩「每次使用后过载消耗 +2」）。
   * 判据与扣费都从这里走，否则"付多少"和"够不够"会变成两个答案。
   */
  private overdriveCostOf(key: string, s: SkillAction): number {
    return s.cast.overdriveCost + (this.skillRamp.get(key) ?? 0)
  }

  /**
   * 战技能不能出手。三条闸门按"玩家下一步该做什么"排序：闷音 > 冷却 > 过载。
   *
   * 闷音这条是 §11「战技/律具技封锁」的落地。它**没有**自己的秒数：封锁时长就是这次闷音
   * 被施加方写下的时长（`statusOnHit.ticks` / 弹道 `muteOnHit`）——在 statuses.json 里再写一个
   * `skillLockTicks` 就是让同一件事有两个答案（KI-033 撤账）。
   */
  private skillGate(key: string, s: SkillAction): boolean {
    if (this.stats.muteTicksLeft > 0) {
      bus.emit('ui.notify', { text: `${statusConfig().mute.displayName}｜战技被封`, kind: 'info' })
      return false
    }
    if (this.skillCd.get(key)) return false // 冷却中不出声：按键连打是常态，刷屏才是噪声
    const cost = this.overdriveCostOf(key, s)
    if (this.stats.overdrive < cost) {
      // 涨价要看得见：这一句里"要多少"是涨完之后的数，玩家才知道自己刚才是被连打锁住的
      bus.emit('ui.notify', { text: this.skillRamp.get(key) ? `过载不足｜连打已涨到 ${cost}` : '过载不足', kind: 'info' })
      return false
    }
    return true
  }

  /** 超载那句话要说全：拦了什么、罚了什么、现在多重。漏掉任何一项玩家都得自己去试 */
  private warnOverloaded(): void {
    if (this.overloadWarnTicks > 0) return
    this.overloadWarnTicks = 120 // 2s：够读到，又不至于每按一次刷一条
    const w = Math.round(this.rpg.weight * 10) / 10
    bus.emit('ui.notify', {
      text: `负重超载 ${w} / ${this.rpg.loadMax} kg · 翻滚与疾跑禁用、体力回复 −40%`, kind: 'info'
    })
  }

  onHitLanded(): void {
    // weapon unique: on-beat bonus handled by CombatManager reading rhythm
  }

  /** §5.3「失败」行 + §8.2 rank5：落空后摇 = player.json 的 27 格 + 里程碑 grant（未到 rank5 为 0）。 */
  beginParryWhiff(): void {
    if (!this.parryWhiffPending) return
    this.parryWhiffPending = false
    this.parryWhiffTicks = this.base.parry.whiffRecovery + msToTicks(this.rpg.parryWhiffMs)
  }

  /** 弹反成功 ⇒ 这一扇窗是赚的不是落空，后摇不欠（ CombatManager 成功支调用） */
  onParrySuccess(): void {
    this.parryWhiffPending = false
  }

  takeDamage(amount: number, knockDir?: Vec3, incoming?: IncomingGrade): boolean {
    if (this.iFrame || this.dead) return false
    if (this.parryTicksLeft > 0) return false // handled as parry upstream
    // §5.3「失败」行的赌注（KI-054）：落空后摇期间被击按 whiffDmgMul 加重。
    const dealt = this.parryWhiffTicks > 0 ? Math.round(amount * this.base.parry.whiffDmgMul) : amount
    this.stats.damage(dealt)
    // §8 玩家侧那一行：受击一律 **R1 等效**，时长与位移都读 reactions.json 的 R1 行
    // （KI-050；此前是写死的 12 格 / 0.2m）。翻滚入口刻意不看 stunTicks（见 dodge 判据），
    // 「硬直可翻滚取消」这半句早就成立，不需要为它写新代码。
    const r1 = reactionConfig().R1
    this.stunTicks = msToTicks(r1.stunMs)
    // **档位不改时长，只改"这一记有没有权利没收你正在出的那一式"**（KI-052②）：
    // 那一行末尾写着"无 R3+（操作权不没收）"，所以再重的招式打在身上也只有 R1 的 200ms；
    // 分级的落点全在打断那一列——R0 什么都不收，R1 只收轻击（「不打断重击与蓄力」），
    // R2 收一切非霸体（撞上 hyper 窗就消耗掉那一次免役），R3 起穿得过免役。
    const grade = incoming ?? 'R1'
    const light = this.action !== null && this.action.skill === null && this.action.key.startsWith('l')
    let breaks = grade === 'R0' ? false : grade === 'R1' ? light : true
    if (breaks && grade === 'R2' && this.hyperLive) { this.spendHyper(); breaks = false }
    this.roll = null
    if (breaks) { this.action = null; this.charging = false }
    if (knockDir) {
      this.pos.x += clamp(knockDir.x, -1, 1) * r1.displaceM
      this.pos.z += clamp(knockDir.z, -1, 1) * r1.displaceM
    }
    bus.emit('player.damaged', { amount: dealt })
    bus.emit('audio.sfx', { key: 'player_hurt', gain: 0.6 })
    if (this.stats.hp <= 0) {
      this.dead = true
      this.deadTicks = 0
      bus.emit('player.died', undefined)
    }
    this.publishStats()
    return true
  }

  respawn(): void {
    this.dead = false
    this.followup = null // 死了就是断了：压在下一记上的起手式不跟着人一起回来
    this.echo = null; this.parryEchoLive = false; this.tacet = null // 限时的身外之物同理：不跟着人一起回来
    this.stats.hp = this.stats.hpMax
    this.stats.stamina = this.stats.staMax
    this.pos = { x: 0, y: 0, z: 0 }
    bus.emit('ui.notify', { text: '休止被世界重新听见', kind: 'info' })
    this.publishStats()
  }

  /** 调音桩休息：回 HP/体力 + 归零失谐（§11「调音桩归零」）。不动架势与过载，调音桩不是免费复活 */
  rest(): void {
    this.stats.hp = this.stats.hpMax
    this.stats.stamina = this.stats.staMax
    this.exhausted = false
    this.corruption.reset()
    this.publishStats()
  }

  addOverdrive(n: number): void {
    this.stats.overdrive = clamp(this.stats.overdrive + n, 0, this.stats.overdriveMax)
    // §7.2「每次使用后过载消耗 +2（防连发）」的复位那一半：涨价不归一个计时器管，
    // 归"这条又攒满了"管——过载条只有弹反/完美格挡/换气弹反三条入账（§11），
    // 所以清零这件事本身就是玩家把拍子又挣回来了，不需要再发明第二个冷却。
    if (this.stats.overdrive >= this.stats.overdriveMax) this.skillRamp.clear()
  }

  /**
   * §11 失谐满值后的"褪色"掉血。它刻意**不是** takeDamage 的一条分支：
   * 这是世界在拿走你的声音，不是谁打你一下——所以翻滚的无敌帧救不了它，也不该有硬直和击退。
   * 单开一个入口，是为了让"环境伤害不吃防御阶梯"这件事在代码里看得见，而不是藏在布尔参数里。
   */
  fadeDamage(amount: number): void {
    if (this.dead || amount <= 0) return
    this.stats.damage(amount)
    bus.emit('player.damaged', { amount })
    if (this.stats.hp <= 0) {
      this.dead = true
      this.deadTicks = 0
      bus.emit('player.died', undefined)
    }
    this.publishStats()
  }

  publishStats(): void {
    bus.emit('player.stats', {
      hp: this.stats.hp, hpMax: this.stats.hpMax,
      stamina: this.stats.stamina, staminaMax: this.stats.staMax,
      poise: this.stats.poiseAccum, poiseMax: this.stats.poiseMax,
      overdrive: this.stats.overdrive, overdriveMax: this.stats.overdriveMax,
      rank: this.rpg.rank,
      // §11 失谐：HUD 要的是"多少/上限/褪色几成"三样，自己不去读玩家的 meter
      corruption: this.corruption.value, corruptionMax: this.corruption.cfg.max, corruptionVeil: this.corruption.veil(),
      muteTicksLeft: this.stats.muteTicksLeft
    })
  }
}

function clampAngleDiff(from: number, to: number): number {
  let d = to - from
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

export { clampAngleDiff }
