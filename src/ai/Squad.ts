import { bus } from '@/core/EventBus'
import type { Enemy } from './Enemy'
import type { SquadConfigData } from '@/data/schema'

/**
 * 小队/仇恨槽位系统（Phase B5 结案落点，tech-arch §1.2 Squad 映射）。
 *
 * 核心职责：
 *   1. 仇恨槽位管理：战斗最多 3 个槽位，避免围殴不可读
 *   2. CallAlly 广播：呼叫盟友加入战斗
 * 3. 编队/aggro：共享 blackboard 的 camp 引用
 * 4. 仇恨分配：越后置入战斗的敌人等待槽位
 *
 * 设计原则：
 *   - 只有一个主人：AISystem 持有唯一 Squad 实例
 *   - 依赖单向：Squad ← AISystem（AISystem 注入 squad 引用到 Enemy）
 *   - 零 three 依赖：纯逻辑，headless 可测
 */

/** 阵营标识：同 camp 的敌人互为盟友 */
export type CampId = string

/** 仇恨条目：谁在恨谁、权重多少、占没占槽位 */
export interface ThreatEntry {
  targetId: string        // 仇恨目标（通常是玩家）
  threat: number          // 仇恨权重（伤害累积、主动挑衅等）
  hasSlot: boolean        // 是否占用了攻击槽位
  enteredAt: number       // 进入仇恨表的 tick（用于队列排序）
}

/** 小队成员信息（Blackboard 的一份投影） */
export interface SquadMember {
  enemy: Enemy
  camp: CampId
  threats: ThreatEntry[]
  /** 当前锁定的攻击目标 */
  currentTarget: string | null
  /** 是否占用了攻击槽位 */
  hasAttackSlot: boolean
  /** 进入战斗的 tick */
  combatSince: number
  /** KI-370：等待队列里的排位（0 = 没在等；1 = 下一个轮到） */
  waitRank: number
}

/** CallAlly 广播载荷 */
export interface CallAllyPayload {
  callerId: string
  camp: CampId
  targetId: string        // 共同目标
  position: { x: number; y: number; z: number }
  urgency: 'low' | 'normal' | 'high'
}

/**
 * 小队/仇恨槽位配置（Phase B5）。**形状的主人是 src/data/schema.ts 的 SquadConfigData，
 * 值的主人是 squad.json（KI-372）**：AISystem 构造时从注册表 squad:config 取缺省，
 * 显式构造参数最后说话。这里只留类型别名与那份代码默认（注册表缺席时的回落）。
 */
export type SquadConfig = SquadConfigData

/** 默认配置（技术架构 §1.2 承诺：上限 3） */
export const DEFAULT_SQUAD_CONFIG: SquadConfig = {
  maxAttackSlots: 3,
  callAllyRadius: 24,
  threatDecayPerTick: 0.02,
  combatEntryThreshold: 10,
}

/** KI-358：槽位排队的只读投影（F4 面板与测试读它；不参与分槽计算） */
export interface SlotReport {
  /** 占着攻击槽位的成员 id，按仇恨降序、进入早优先；`[0]` = 当前轮到的 */
  attacking: string[]
  /** 有仇恨、够阈值、但没槽的成员 id，同一套排序；`[0]` = 下一个轮到的 */
  waiting: string[]
}

/**
 * Squad 管理器：单例，由 AISystem 持有。
 * 所有敌人的 camp、threat、slot 状态集中在这里，Enemy 只保留只读引用。
 */
export class Squad {
  private members = new Map<string, SquadMember>()
  private config: SquadConfig
  private tick = 1 // 从 1 开始，避免 combatSince 为 0 的歧义
  /** KI-374：本拍排好序的候选（eallocateSlots 写），写让位方位时读同一份排序 */
  private rankedThisTick: { member: SquadMember; top: number }[] = []

  constructor(config: SquadConfig = DEFAULT_SQUAD_CONFIG) {
    this.config = { ...DEFAULT_SQUAD_CONFIG, ...config }
  }

  /** 注册敌人（spawn 时调用） */
  register(enemy: Enemy): void {
    const camp = enemy.data.ai.camp ?? 'default'
    const member: SquadMember = {
      enemy,
      camp,
      threats: [],
      currentTarget: null,
      hasAttackSlot: false,
      waitRank: 0,
      combatSince: 0,
    }
    this.members.set(enemy.id, member)

    // 同 camp 成员互相感知
    this.broadcastCampUpdate(enemy.id, camp)
  }

  /** 注销敌人（despawn/死亡时调用） */
  unregister(enemyId: string): void {
    const member = this.members.get(enemyId)
    if (!member) return

    // 释放攻击槽位
    if (member.hasAttackSlot) {
      member.hasAttackSlot = false
    }
    // 从其他人的仇恨表移除
    for (const m of this.members.values()) {
      m.threats = m.threats.filter((t) => t.targetId !== enemyId)
      if (m.currentTarget === enemyId) m.currentTarget = null
    }
    this.members.delete(enemyId)
  }

  /** 每 tick 更新：仇恨衰减、槽位重新分配 */
  update(tick: number): void {
    this.tick = tick

    // 1. 仇恨自然衰减
    for (const member of this.members.values()) {
      for (const t of member.threats) {
        t.threat = Math.max(0, t.threat - this.config.threatDecayPerTick)
      }
      // 清理归零仇恨
      member.threats = member.threats.filter((t) => t.threat > 0.01)
      // 目标丢失时清空 currentTarget
      if (member.currentTarget && !member.threats.some((t) => t.targetId === member.currentTarget)) {
        member.currentTarget = null
      }
    }

    // 2. 重新分配攻击槽位（权重：仇恨高优先、进入早优先）
    this.reallocateSlots()

    // 3. 同步到 Enemy（只读投影）
    for (const member of this.members.values()) {
      member.enemy.squadThreats = [...member.threats].sort((a, b) => b.threat - a.threat)
      member.enemy.squadHasSlot = member.hasAttackSlot
      member.enemy.squadWaitRank = member.waitRank
      member.enemy.squadTarget = member.currentTarget
      member.enemy.squadHolderPos = this.holderPosFor(member)
      const peer = this.peerFor(member)
      member.enemy.squadPeerPos = peer ? { ...peer.enemy.pos } : null
      member.enemy.squadPeerRank = peer ? peer.waitRank : 0
      member.enemy.squadOrbitTie = member.waitRank > 0 && member.waitRank % 2 === 0 ? -1 : 1
    }
  }

  /**
   * KI-370：排队判据与排序的**唯一主人**——
   * `reallocateSlots()` 与 `getSlotReport()` 都读它。
   * 只读：不碰 `hasAttackSlot`／`waitRank`（看一眼不许改变谁在打）。
   */
  private rankedCandidates(): { member: SquadMember; top: number }[] {
    const ranked: { member: SquadMember; top: number }[] = []
    for (const member of this.members.values()) {
      const top = member.threats[0]?.threat ?? 0
      if (!member.enemy.alive || top < this.config.combatEntryThreshold) continue
      ranked.push({ member, top })
    }
    ranked.sort((a, b) => {
      if (Math.abs(a.top - b.top) > 0.01) return b.top - a.top
      return a.member.combatSince - b.member.combatSince
    })
    return ranked
  }

  /**
   * 重新分配攻击槽位：按仇恨权重 + 进入时间排序，前 N 个得槽位、其余按序排队（KI-370）。
   *
   * **排位每拍全清，槽位仍只清候选那一批**：第一次实现顺手把所有人的 `hasAttackSlot`
   * 也清了，`tests/flow/elite.test.ts` 那条「读条被硬直抹掉」当场红——它量出的是
   * 「掉到阈值之下的人原先还留着槽位」这一条 KI-133 的既有行为。那一格不是本批的账，
   * 所以这里只清排位（掉出队列的人不留名次），谁在出手的语义一个字不动。
   */
  private reallocateSlots(): void {
    for (const m of this.members.values()) m.waitRank = 0
    const ranked = this.rankedCandidates()
    this.rankedThisTick = ranked
    const slots = this.config.maxAttackSlots
    for (const m of ranked) m.member.hasAttackSlot = false
    for (let i = 0; i < Math.min(slots, ranked.length); i++) {
      ranked[i].member.hasAttackSlot = true
    }
    for (let i = slots; i < ranked.length; i++) {
      ranked[i].member.waitRank = i - slots + 1
    }
  }

  /**
   * KI-374：等的人该朝谁让路——**同一目标**、当前占着槽位的最高仇恨者（ankedThisTick[0] 那一位）。
   * 占槽者自己与没有同目标占槽者的人拿到 null；Enemy.stepAround 拿到 null 就回落 +1（KI-371 原样）。
   */
  private holderPosFor(member: SquadMember): { x: number; y: number; z: number } | null {
    if (member.hasAttackSlot) return null
    const holder = this.rankedThisTick.find(
      (x) => x.member.hasAttackSlot && x.member.currentTarget === member.currentTarget,
    )
    return holder ? { ...holder.member.enemy.pos } : null
  }

  /**
   * KI-375：等的人还该躲开**另一个也在等的人**——最近的、活着的、排位 > 0 的同伴。
   * 自己不在等 / 只有自己一个 ⇒ null；Enemy.stepAround 拿到 null 就只躲占槽者（KI-374 原样）。
   * KI-376 起这一格同时给出那位同伴的排位（拥挤时谁退由它决定），所以返回成员本身。
   */
  private peerFor(member: SquadMember): SquadMember | null {
    if (member.waitRank <= 0) return null
    let best: SquadMember | null = null
    let bestDist = Infinity
    for (const other of this.members.values()) {
      if (other === member || other.waitRank <= 0 || !other.enemy.alive) continue
      const d = Math.hypot(other.enemy.pos.x - member.enemy.pos.x, other.enemy.pos.z - member.enemy.pos.z)
      if (d < bestDist) {
        bestDist = d
        best = other
      }
    }
    return best
  }

  /** 增加仇恨（受伤害、被挑衅、发现目标等） */
  addThreat(enemyId: string, targetId: string, amount: number): void {
    const member = this.members.get(enemyId)
    if (!member) return

    let entry = member.threats.find((t) => t.targetId === targetId)
    if (!entry) {
      entry = { targetId, threat: 0, hasSlot: false, enteredAt: this.tick }
      member.threats.push(entry)
      // 第一次建立仇恨 = 进入战斗状态
      if (member.combatSince === 0) member.combatSince = this.tick
    }
    entry.threat += amount

    // 重新排序
    member.threats.sort((a, b) => b.threat - a.threat)

    // 更新当前目标
    if (member.threats[0]?.targetId !== member.currentTarget) {
      member.currentTarget = member.threats[0]?.targetId ?? null
    }
  }

  /** CallAlly：广播呼叫盟友（由 Enemy 决策触发） */
  callAlly(payload: CallAllyPayload): void {
    // 向同 camp 的其他成员广播
    for (const member of this.members.values()) {
      if (member.enemy.id === payload.callerId) continue
      if (member.camp !== payload.camp) continue
      if (!member.enemy.alive) continue

      const d = Math.hypot(
        member.enemy.pos.x - payload.position.x,
        member.enemy.pos.z - payload.position.z
      )
      if (d > this.config.callAllyRadius) continue

      // 接收到呼叫：建立/增加对目标的仇恨
      const urgencyMul = payload.urgency === 'high' ? 2 : payload.urgency === 'low' ? 0.5 : 1
      this.addThreat(member.enemy.id, payload.targetId, 50 * urgencyMul)
      // 如果还没进入战斗，强制进入
      if (member.combatSince === 0) member.combatSince = this.tick
    }
  }

  /** 广播阵营更新（新成员加入/阵营变更） */
  private broadcastCampUpdate(enemyId: string, camp: CampId): void {
    // 当前实现：camp 固定写在 EnemyData 里，运行时不变
    // 预留给未来动态阵营转换
  }

  /** 获取成员信息（调试/调试面板用） */
  getMember(enemyId: string): SquadMember | undefined {
    return this.members.get(enemyId)
  }

  /** 获取所有成员（调试面板用） */
  getAllMembers(): SquadMember[] {
    return [...this.members.values()]
  }

  /**
   * KI-358：槽位排队的只读投影——**谁在打、谁在等、下一个轮到谁**。
   *
   * 判据与 `reallocateSlots()` 是同一套：活着、有仇恨、top ≥ `combatEntryThreshold`；
   * 排序也同一套（仇恨降序、进入早优先）。`attacking[0]` 是当前仇恨最高的占槽者，
   * `waiting[0]` 是下一个轮到的。只读：调用前后 `hasAttackSlot` 一格不动。
   *
   * 这一格给 F4 面板与门一个机器读得到的形状；玩家-facing 的那半边由 KI-370 的 `squadWaitRank`
   * 与 `ActorVisuals` 脚下的排队环兑现（同一套排位，不另排一份）。
   */
  getSlotReport(): SlotReport {
    const ranked = this.rankedCandidates()
    return {
      attacking: ranked.filter((x) => x.member.hasAttackSlot).map((x) => x.member.enemy.id),
      waiting: ranked.filter((x) => !x.member.hasAttackSlot).map((x) => x.member.enemy.id),
    }
  }

  /** 获取某阵营的存活成员数 */
  getCampCount(camp: CampId): number {
    let count = 0
    for (const m of this.members.values()) {
      if (m.camp === camp && m.enemy.alive) count++
    }
    return count
  }

  /** 获取配置（测试/调试用） */
  getConfig(): SquadConfig {
    return { ...this.config }
  }
}

// 全局单例（AISystem 持有）
let squad: Squad | null = null

export function initSquad(config?: Partial<SquadConfig>): Squad {
  squad = new Squad({ ...DEFAULT_SQUAD_CONFIG, ...config })
  return squad
}

export function getSquad(): Squad | null {
  return squad
}

/**
 * 便捷函数：注册到 bus 供系统调用。
 *
 * **幂等**（KI-352）：生产里 main 与 AISystem 各调过一次的历史形状会把每一条都记三笔账；
 * 这里只接一次线，重复调用是空操作。
 *
 * **两条写入口都是真频道**（KI-352）：不再另起 `squad.callAlly`／`squad.addThreat`
 * 两个名字——那会让"敌人挨了打"与"敌人叫盟友"各有两个主人。
 *  - `combat.hit`：受害者是小队成员 ⇒ 谁打她、这一记多重就是仇恨权重；
 *  - `ai.callAlly`：Enemy 真正的广播口；camp 从小队名册现查，不从载荷抄第二份。
 *    载荷的 `urgency` 也照原样进乘数（KI-357）：high ×2／normal ×1／low ×0.5。
 */
let wired = false
export function registerSquadBus(): void {
  if (wired) return
  wired = true
  bus.on('combat.hit', (h) => {
    const s = squad
    if (!s) return
    if (h.attackerId === h.victimId) return
    if (!(h.damage > 0)) return
    if (!s.getMember(h.victimId)) return
    s.addThreat(h.victimId, h.attackerId, Math.max(1, Math.round(h.damage)))
  })
  bus.on('ai.callAlly', (e) => {
    const s = squad
    const caller = s?.getMember(e.fromId)
    if (!s || !caller) return
    s.callAlly({
      callerId: e.fromId,
      camp: caller.camp,
      targetId: 'player',
      position: { ...e.pos },
      urgency: e.urgency ?? 'normal',
    })
  })
}
