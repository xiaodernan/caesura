export interface GameEvents {
  'log': { level: 'info' | 'warn' | 'error'; msg: string }
  'boot.ready': undefined
  'time.hitStop': { active: boolean }
  'input.action': { action: string }
  'player.stats': {
    hp: number; hpMax: number; stamina: number; staminaMax: number
    poise: number; poiseMax: number; overdrive: number; overdriveMax: number
    rank: number
  }
  'player.damaged': { amount: number; killerId?: string }
  'player.died': undefined
  'entity.spawned': { id: string; kind: 'enemy' | 'npc' | 'prop'; entity: unknown }
  'entity.despawned': { id: string; kind: 'enemy' | 'npc' | 'prop' }
  /** `dataId` = 敌人/实体的数据 id（掉落与首杀判定要用；实例 id 每次都不同） */
  'entity.died': { id: string; kind: string; dataId?: string; position: { x: number; y: number; z: number } }
  'combat.hit': {
    attackerId: string; victimId: string; damage: number; poiseDamage: number
    kind: 'light' | 'heavy' | 'skill' | 'enemy'
    point: { x: number; y: number; z: number }
    dir: { x: number; y: number; z: number }
    result: 'hit' | 'block' | 'perfectBlock' | 'parry' | 'graze' | 'immune'
    hitStopMs: number; shakeKey: string
    backstab: boolean; weakpoint: boolean
  }
  'combat.parried': { attackerId: string; defenderId: string }
  /** Boss 跳阶（§15.1 转阶段演出）：表现层据此震镜/压低频，main.ts 据此吃 hitstop */
  'boss.phase': { id: string; phase: number; phases: number; nameKey: string }
  'audio.sfx': { key: string; pos?: { x: number; y: number; z: number }; gain?: number }
  'vfx.request': { key: string; pos: { x: number; y: number; z: number }; dir?: { x: number; y: number; z: number }; scale?: number }
  'sound.source': { id: string; pos: { x: number; y: number; z: number }; loudness: number }
  'ui.notify': { text: string; kind?: 'info' | 'reward' | 'boss' }
  'ui.prompt': { text: string | null; id: string | null }
  'world.flag': { key: string; value: boolean | number | string }
  'world.travel': { id: string; from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } }
  'world.chunk': {
    key: string; regionId: string
    cx: number; cy: number; cz: number
    center: { x: number; y: number; z: number }
    state: 'unloaded' | 'preloading' | 'resident' | 'active'
    priority: number; tick: number
  }
}

type Handler<T> = (payload: T) => void

export class EventBus<E extends Record<string, any> = GameEvents> {
  private handlers = new Map<keyof E, Set<Handler<never>>>()

  on<K extends keyof E>(key: K, fn: Handler<E[K]>): () => void {
    let set = this.handlers.get(key)
    if (!set) { set = new Set(); this.handlers.set(key, set) }
    set.add(fn as Handler<never>)
    return () => this.off(key, fn)
  }

  once<K extends keyof E>(key: K, fn: Handler<E[K]>): () => void {
    const wrap: Handler<E[K]> = (p) => { this.off(key, wrap); fn(p) }
    return this.on(key, wrap)
  }

  off<K extends keyof E>(key: K, fn: Handler<E[K]>): void {
    this.handlers.get(key)?.delete(fn as Handler<never>)
  }

  emit<K extends keyof E>(key: K, payload: E[K]): void {
    const set = this.handlers.get(key)
    if (!set) return
    for (const fn of [...set]) (fn as Handler<E[K]>)(payload)
  }
}

export const bus = new EventBus()
