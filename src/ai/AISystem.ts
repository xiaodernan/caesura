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

  constructor() {
    bindEnemyRegistry(this.enemies)
    bus.on('sound.source', (e) => {
      if (e.id === 'player') for (const en of this.enemies) en.hear(e)
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

  slotTaken(key: string): boolean {
    if (this.slotArmed.has(key)) return true
    this.slotArmed.add(key)
    return false
  }

  update(dt: number, tick: number, player: PlayerController, rhythm: RhythmClock): void {
    // 10Hz rotated perception
    this.senseCursor++
    if (this.senseCursor % 6 === 0) {
      for (const e of this.enemies) e.sense(player, tick)
    }
    // refrein aura pass
    for (const e of this.enemies) e.buffedByRefrein = false
    for (const s of this.enemies) {
      if (!s.alive || !s.data.ai.buffAura) continue
      for (const e of this.enemies) {
        if (e === s || !e.alive) continue
        if (Math.hypot(e.pos.x - s.pos.x, e.pos.z - s.pos.z) <= s.data.ai.buffAura.range) e.buffedByRefrein = true
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
