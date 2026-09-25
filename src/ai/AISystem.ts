import { bus } from '@/core/EventBus'
import { Enemy, bindEnemyRegistry } from './Enemy'
import type { PlayerController } from '@/player/ThirdPersonController'
import type { RhythmClock } from '@/core/RhythmClock'
import type { EnemyData } from '@/data/schema'
import { registry } from '@/core/Registry'

/**
 * Manages all enemies: 10Hz perception rotation, attack-slot arbitration
 * (docs/combat.md §2.1: max 1 enemy hit-frame per beat slot), refrein auras.
 */
export class AISystem {
  enemies: Enemy[] = []
  private senseCursor = 0
  private slotArmed = new Set<string>()
  private lastBarBeat = ''
  /** 传给 hear() 的当前逻辑 tick（声源事件不带 tick，用监听方自己的） */
  private tick = 0
  /**
   * KI-023 噪音汇聚（§15.3「世界噪音汇聚点」）：组合根注入。返回重定向后的声源
   * （听上去发生在音刺上），null = 原样。**必须在这一处拦**——hear() 已经把
   * 玩家真实站位记进 lastKnown 之后再改，她还是会朝人走，汇聚就成了空话。
   */
  noiseSink: ((src: { pos: { x: number; y: number; z: number }; loudness: number }) => { pos: { x: number; y: number; z: number }; loudness: number } | null) | null = null

  constructor() {
    bindEnemyRegistry(this.enemies)
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
    bus.on('rhythm.beat', (b) => {
      const k = `${b.bar}:${b.beatInBar}`
      if (k !== this.lastBarBeat) { this.slotArmed.clear(); this.lastBarBeat = k }
    })
  }

  spawn(enemyId: string, pos: { x: number; y: number; z: number }, seed = 'vs'): Enemy {
    const data = registry.get<EnemyData>(enemyId)
    const e = new Enemy(data, pos, seed)
    this.enemies.push(e)
    bus.emit('entity.spawned', { id: e.id, kind: 'enemy', entity: e })
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

  update(dt: number, tick: number, player: PlayerController, rhythm: RhythmClock): void {
    this.tick = tick
    this.syncClock(rhythm)
    // 10Hz rotated perception
    this.senseCursor++
    if (this.senseCursor % 6 === 0) {
      for (const e of this.enemies) e.sense(player, tick)
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
      e.update(dt, tick, player, rhythm, (k) => this.slotTaken(k))
      if (!e.alive && e.stateTick > 3000) {
        // retire fully faded corpses
        const i = this.enemies.indexOf(e)
        if (i >= 0) { this.enemies.splice(i, 1); bus.emit('ai.retired', { id: e.id }) }
      }
    }
  }
}

declare module '@/core/EventBus' {
  interface GameEvents {
    'ai.retired': { id: string }
  }
}
