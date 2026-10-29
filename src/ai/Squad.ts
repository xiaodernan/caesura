import { bus } from '@/core/EventBus'
import type { Enemy } from './Enemy'

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
}

/** CallAlly 广播载荷 */
export interface CallAllyPayload {
  callerId: string
  camp: CampId
  targetId: string        // 共同目标
  position: { x: number; y: number; z: number }
  urgency: 'low' | 'normal' | 'high'
}

/** Squad 系统配置 */
export interface SquadConfig {
  /** 最大攻击槽位（技术架构 §1.2：上限 3） */
  maxAttackSlots: number
  /** CallAlly 响应半径 */
  callAllyRadius: number
  /** 仇恨衰减/ tick（脱战自然降低） */
  threatDecayPerTick: number
  /** 进入战斗最小仇恨阈值 */
  combatEntryThreshold: number
}

/** 默认配置（技术架构 §1.2 承诺：上限 3） */
export const DEFAULT_SQUAD_CONFIG: SquadConfig = {
  maxAttackSlots: 3,
  callAllyRadius: 24,
  threatDecayPerTick: 0.02,
  combatEntryThreshold: 10,
}

/**
 * Squad 管理器：单例，由 AISystem 持有。
 * 所有敌人的 camp、threat、slot 状态集中在这里，Enemy 只保留只读引用。
 */
export class Squad {
  private members = new Map<string, SquadMember>()
  private config: SquadConfig
  private tick = 1 // 从 1 开始，避免 combatSince 为 0 的歧义

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
      member.enemy.squadTarget = member.currentTarget
    }
  }

  /** 重新分配攻击槽位：按仇恨权重 + 进入时间排序，前 N 个得槽位 */
  private reallocateSlots(): void {
    // 收集所有想要槽位的成员
    const candidates: SquadMember[] = []
    for (const member of this.members.values()) {
      if (!member.enemy.alive) continue
      // 有仇恨目标且目标存活
      const topThreat = member.threats[0]
      if (!topThreat || topThreat.threat < this.config.combatEntryThreshold) continue
      candidates.push(member)
    }

    // 排序：仇恨降序、进入时间升序（先来后到）
    candidates.sort((a, b) => {
      const ta = a.threats[0]?.threat ?? 0
      const tb = b.threats[0]?.threat ?? 0
      if (Math.abs(ta - tb) > 0.01) return tb - ta
      return a.combatSince - b.combatSince
    })

    // 先把所有人的槽位清空
    for (const m of candidates) m.hasAttackSlot = false

    // 分配前 N 个
    const slots = this.config.maxAttackSlots
    for (let i = 0; i < Math.min(slots, candidates.length); i++) {
      candidates[i].hasAttackSlot = true
    }
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
      urgency: 'normal',
    })
  })
}