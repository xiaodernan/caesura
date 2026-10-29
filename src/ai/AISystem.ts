import { bus } from '@/core/EventBus'
import { Enemy, bindEnemyRegistry } from './Enemy'
import { initSquad, registerSquadBus, type SquadConfig } from './Squad'
import type { PlayerController } from '@/player/ThirdPersonController'
import type { RhythmClock } from '@/core/RhythmClock'
import type { SightGate } from '@/core/Occlusion'
import type { NavGate } from './Navigation'
import type { EnemyData } from '@/data/schema'
import { registry } from '@/core/Registry'
import { PatrolWatch } from '@/quest/PatrolWatch'

/**
 * Manages all enemies: 10Hz perception sweep (all entities each round), attack-slot arbitration
 * (docs/combat.md §2.1: max 1 enemy hit-frame per beat slot), refrein auras.
 */
export class AISystem {
  enemies: Enemy[] = []
  private senseCursor = 0
  private slotArmed = new Set<string>()
  private lastBarBeat = ''
  /** 传给 hear() 的当前逻辑 tick（声源事件不带 tick，用监听方自己的） */
  private tick = 0

  /** Squad 系统（Phase B5：仇恨槽位、CallAlly、编队） */
  private squad: ReturnType<typeof initSquad>
  /**
   * KI-023 噪音汇聚（§15.3「世界噪音汇聚点」）：组合根注入。返回重定向后的声源
   * （听上去发生在音刺上），null = 原样。**必须在这一处拦**——hear() 已经把
   * 玩家真实站位记进 lastKnown 之后再改，她还是会朝人走，汇聚就成了空话。
   */
  noiseSink: ((src: { pos: { x: number; y: number; z: number }; loudness: number }) => { pos: { x: number; y: number; z: number }; loudness: number } | null) | null = null
  /**
   * KI-024 场地阶段入口的喂食口（组合根注入，null = 场上没有 props）：每 tick 把
   * 「某类 prop 还剩几件」的现状交给带 `enterOnProps` 的 Boss 阶段机。
   */
  props: { remainingByKind(kind: string): number } | null = null
  /**
   * KI-014②b 视线闸门（组合根注入，null = 场上没有可挡视线的几何体）：`a → b` 被挡住 ⇒ true。
   * §13.0 的视觉列本来就写着「视锥 **+** 遮挡检查」，此前只有前半句 ⇒ 躲在已 authored 的墙后
   * 仍然会被看见，而同一堵墙却能把那支箭挡下来——掩体成了半真半假的东西。
   * 名册的主人是 `combat`（它每 tick 重点名），所以这里要的只是一个函数，不新增依赖箭头。
   */
  sightBlocked: SightGate = null
  /**
   * KI-009 第一腿 绕路（combat.md §595）：组合根每 tick 写一次，`null` = 没有可挡路的几何体。
   * 与 `sightBlocked` 同一个套路（名册的主人是组合根，`ai` 只要一个函数，不新增依赖箭头），
   * 但落点不同：视线是每一次感知才问一次，而脚步是**每一只每一 tick**都要问——所以它写在
   * {@link Enemy.nav} 上，由下面那个循环统一下发。
   */
  nav: NavGate = null
  /** 缓存本 tick 的玩家位置：巡逻绕回那一拍判"他跟没跟着走"要用（PatrolWatch） */
  private lastPlayerPos: { x: number; y: number; z: number } | null = null
  /**
   * KI-043 断弦线步 1 的判据裁判（构造时默认装配，实机接线不经过组合根）：巡逻敌人绕回
   * 路径第一格、期间玩家没出过手、且玩家此刻在他身边 ⇒ `flag.haltrune_patrol_seen`
   * （走 world.flag 广播）。跟队半径用敌人自己的 `ai.vision.range` 表值——"你跟着走，
   * 就在他的存在圈里"；军阵自己绕圈而玩家在半个地图外不构成"走完了一圈"。
   * 身份谓词现在是 en_murkshell——灰盒阶段营地守军（murkshell 群）就是《巡逻线尽头》
   * 那队兵的化身；等"残响军阵"成为专属敌人入表时在这里收窄，不另起裁判。
   */
  private readonly patrolWatch = new PatrolWatch(
    (e, ppos) => {
      if (e.dataId !== 'en_murkshell') return false
      if (!ppos) return false
      const range = registry.get<EnemyData>(e.dataId).ai?.vision?.range ?? 12
      return Math.hypot(e.pos.x - ppos.x, e.pos.z - ppos.z) <= range
    },
    () => bus.emit('world.flag', { key: 'flag.haltrune_patrol_seen', value: true }),
  )

  constructor(config?: Partial<SquadConfig>) {
    bindEnemyRegistry(this.enemies)
    // Squad 系统初始化（Phase B5）
    this.squad = initSquad(config)
    registerSquadBus()

    bus.on('sound.source', (e) => {
      if (e.id === 'player') {
        const src = this.noiseSink?.(e) ?? e
        for (const en of this.enemies) en.hear(src, this.tick)
      }
      // §14.5「伪拍点声源」：够响的一声 = 一个假拍点，把幽灵八从拍隙里拽出来显形。
      // 走既有声源流而不是新事件：玩家重击/驼鼓踏地/未来的音色晶投掷天然是同一路信号。
      // 汇聚重定向只改「谁听见」，不改「相位会不会被震」——那条判的是够不够响，不是在哪。
      for (const en of this.enemies) en.fakeBeat(e)
    })
    // KI-023：音刺碎裂 ⇒ 给猎手挂聋乱窗。按 dataId 找（prop 数据里写的是表 id，
    // 不是实例 id），同场多只取离碎刺最近的那只——「她聋了」是这一只的六拍。
    bus.on('world.propBroken', (p) => {
      if (!p.deafTarget || !p.deafTicks) return
      let best: Enemy | null = null
      let bestD = Infinity
      for (const en of this.enemies) {
        if (en.data.id !== p.deafTarget || !en.alive) continue
        const d = Math.hypot(en.pos.x - p.pos.x, en.pos.z - p.pos.z)
        if (d < bestD) { bestD = d; best = en }
      }
      best?.applyDeaf(p.deafTicks)
    })
    // KI-022②：振源核挨的那一记**原样**记到她头上（外露器官无甲=真伤）。
    // 走 EntityStats.damage 与残响区同一入口：不吃防御阶梯、不触发受击反应——
    // 这是"器官上的血"不是"打在她身上的招"。
    bus.on('world.propDamaged', (p) => {
      if (!p.damageTarget || !p.amount) return
      for (const en of this.enemies) {
        if (en.data.id === p.damageTarget && en.alive) en.stats.damage(p.amount)
      }
    })
    bus.on('rhythm.beat', (b) => {
      const k = `${b.bar}:${b.beatInBar}`
      if (k !== this.lastBarBeat) { this.slotArmed.clear(); this.lastBarBeat = k }
    })
  }

  spawn(enemyId: string, pos: { x: number; y: number; z: number }, seed = 'vs'): Enemy {
    const data = registry.get<EnemyData>(enemyId)
    const e = new Enemy(data, pos, seed)
    e.onPatrolLoop = () => this.patrolWatch.notePatrolLoop({ id: e.id, dataId: data.id, pos: e.pos }, this.lastPlayerPos)
    this.enemies.push(e)
    // Squad 系统注册（Phase B5）
    this.squad.register(e)
    return e
  }

  /**
   * 流送回收：把敌人移出名单（不发死亡事件、不给奖励）。
   * 与死亡退役的区别——despawn 是「玩家走远了，它回到世界里去」，
   * 因此 SpawnDirector 不会把它记成已清剿。
   */
  despawn(id: string): boolean {
    const i = this.enemies.findIndex((e) => e.id === id)
    if (i < 0) return false
    const [e] = this.enemies.splice(i, 1)
    // Squad 系统注销（Phase B5）
    this.squad.unregister(e.id)
    bus.emit('entity.despawned', { id: e.id, kind: 'enemy' })
    return true
  }

  /**
   * §15.2「区域网格由他接管」：正在交战的 Boss 用她的私有拍速改写**全场**网格，
   * 她一死或玩家走开就归还区域基准拍。和 buff/intangible 一样是每 tick 重算的派生态——
   * 没有成对的 enter/exit 事件可以漏，也没有「Boss 死了节拍还停在 108」这种脏状态。
   */
  private syncClock(rhythm: RhythmClock): void {
    let boss: Enemy | null = null
    for (const e of this.enemies) {
      if (!e.alive || e.clockBpm === undefined) continue
      if (e.state !== 'combat' && e.state !== 'chase') continue
      if (!boss || e.id < boss.id) boss = e // 同场多只时取稳定的一只（当前数据不会发生）
    }
    // 阶段可以改拍速（§15.2 Finale「网格加速至 120BPM」），所以读的是 `clockBpm` 而不是身份级的 `boss.bpm`
    if (boss) rhythm.overrideTo(boss.clockBpm!, boss.clockBeatsPerBar)
    else rhythm.restoreHome()
  }

  slotTaken(key: string): boolean {
    if (this.slotArmed.has(key)) return true
    this.slotArmed.add(key)
    return false
  }

  /**
   * 拍位插槽的**只读**镜像（F4 调试面板用）。分成两个口而不是让面板去调 `slotTaken`：
   * 那个函数领用槽位，"看一眼这一拍有没有人排上"就会真的把这一拍占掉——观测改变被观测的系统。
   */
  get armedSlots(): readonly string[] { return [...this.slotArmed] }

  update(dt: number, tick: number, player: PlayerController, rhythm: RhythmClock): void {
    this.tick = tick
    this.lastPlayerPos = { ...player.pos }
    this.syncClock(rhythm)

    // KI-024：场地阶段入口每 tick 对账一次（音刺碎尽的那一 tick 她就该换阶，不等下一次血线结算）
    if (this.props) for (const e of this.enemies) e.checkFieldPhase(this.props)

    // §1.2「同屏最多 3 人同时出手」：进入战斗的第一笔仇恨由这里记（KI-352）。
    // 没人写这一笔，槽位表就永远是空的——上限 3 只活在注释里。只在"表还是空的"时候
    // 补一笔：衰减到 0 之后仍在战斗态的会重新记；离开这四态就让它自然掉光。
    for (const e of this.enemies) {
      if (!e.alive) continue
      const engaged = e.state === 'combat' || e.state === 'chase' || e.state === 'alert' || e.state === 'callAlly'
      if (!engaged) continue
      const m = this.squad.getMember(e.id)
      // 阈值 + 1：Squad.update 每拍**先衰减再分槽**，恰好等于阈值的一笔会在分槽前
      // 掉到线下（10 → 9.98）⇒ 永远拿不到第一格。多这一点是为了让"刚进入战斗"
      // 这件事本身够格。
      if (m && m.threats.length === 0) this.squad.addThreat(e.id, 'player', this.squad.getConfig().combatEntryThreshold + 1)
    }

    // Squad 系统更新（Phase B5：仇恨槽位、CallAlly、编队）
    this.squad.update(this.tick)

    // 10Hz perception sweep: every 6th tick, and that round visits every enemy
    this.senseCursor++
    if (this.senseCursor % 6 === 0) {
      for (const e of this.enemies) e.sense(player, tick, this.sightBlocked)
    }
    // 「定调」光环（§14.6）：每 tick 重算一次，取范围内最近的 buffAura 来源，不叠加
    for (const e of this.enemies) e.buff = null
    for (const e of this.enemies) {
      if (!e.alive) continue
      let best: Enemy | null = null
      let bestD = Infinity
      for (const s of this.enemies) {
        if (s === e || !s.alive || !s.data.ai.buffAura) continue
        const d = Math.hypot(e.pos.x - s.pos.x, e.pos.z - s.pos.z)
        if (d > s.data.ai.buffAura.range || d >= bestD) continue
        bestD = d; best = s
      }
      if (best) {
        const a = best.data.ai.buffAura!
        e.buff = { attackSpeedMul: a.attackSpeedMul, dmgMul: a.dmgMul, fromId: best.id }
      }
    }
    for (const e of this.enemies) {
      e.nav = this.nav // 组合根改一次注入，全场当帧生效（不必等下一次 spawn）
      e.update(dt, tick, player, rhythm, (k) => this.slotTaken(k))
      if (!e.alive && e.stateTick > 3000) {
        // retire fully faded corpses
        const i = this.enemies.indexOf(e)
        if (i >= 0) {
          const [gone] = this.enemies.splice(i, 1)
          // KI-354：退役也是"这个人不在了"——Squad 名册要跟名单一起收。只 splice 不 unregister
          // 的话，尸体从数组里走了、名册里还留着一份引用，逐 tick 衰减永不出队。
          this.squad.unregister(gone.id)
        }
      }
    }
  }

  /** Squad 系统访问器（F4 调试面板、测试用） */
  get squadSystem() { return this.squad }
}

