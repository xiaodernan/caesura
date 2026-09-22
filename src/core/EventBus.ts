/**
 * 状态槽的 id。刻意不 import data/schema：core 层不认识数据表（依赖方向单向），
 * 与 statuses.json 的键是否一致由 tests/unit/statuses.test.ts 钉住。
 */
export const STATUS_IDS = ['fissure', 'mute', 'echo', 'corruption', 'overdrive'] as const
export type StatusId = typeof STATUS_IDS[number]

/** 一条状态的瞬时示量（HUD chip 用）：value 是层数/数值，on=false 表示撤下 */
export interface StatusPulse { id: StatusId; value: number; max: number; on: boolean }

export interface GameEvents {
  'log': { level: 'info' | 'warn' | 'error'; msg: string }
  'boot.ready': undefined
  'time.hitStop': { active: boolean }
  'input.action': { action: string }
  'player.stats': {
    hp: number; hpMax: number; stamina: number; staminaMax: number
    poise: number; poiseMax: number; overdrive: number; overdriveMax: number
    rank: number
    corruption: number; corruptionMax: number
    /** 0..1 褪色浓度（表现层：屏幕去饱和的程度） */
    corruptionVeil: number
    /** 闷音剩余 tick。放在这里而不是 ui.status：它是会自己到期的量，读数不该靠事件撤下 */
    muteTicksLeft: number
  }
  /** 边沿触发的状态示量：由**造成**状态的一方发出（敌人震裂层数、回声影数） */
  'ui.status': StatusPulse
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
