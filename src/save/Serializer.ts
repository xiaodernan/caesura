import { bus } from '@/core/EventBus'
import type { PlayerController } from '@/player/ThirdPersonController'
import type { StreamingSystem } from '@/world/Streaming'
import type { SpawnDirector } from '@/world/SpawnDirector'
import type { RhythmClock } from '@/core/RhythmClock'
import { migrateTo } from './Migration'
import { unwrap, wrap } from './Integrity'

/**
 * 存档对象与读写（technical-architecture §2 save/Serializer.ts）。
 * 只存**世界状态**，不存任何表现层对象：位置/资源/flag/清剿记录 ⇒ 读档后由既有的
 * 流送与出怪系统自己把场景摆回来（Phase 3-C2「出怪来自数据」在这里第二次生效：
 * 存档里没有一个敌人实例，只有一串槽位身份）。
 */

export const SAVE_VERSION = 1

export interface Snapshot {
  version: number
  /** 游玩秒数（HUD/存档摘要卡用） */
  playSec: number
  /** 存档那一刻玩家所在区域（读档提示用，不作为位置真源） */
  regionId: string | null
  player: {
    x: number; y: number; z: number
    hp: number; stamina: number; overdrive: number
    weaponId: string
  }
  /** 世界 flag（区域解锁、营地状态、Boss 已死…全部命名空间化的键） */
  flags: string[]
  /** 已永久清剿的出怪槽位身份：读档后这些位置不能再刷怪 */
  clearedSlots: string[]
}

export interface SavePayload { snapshot: Snapshot }

export interface KvStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

/** 同步 KV（localStorage / 内存假件）包一层异步，便于和 IndexedDB 适配器共用接口 */
export class MapStore implements KvStore {
  constructor(private readonly backing: Map<string, string> = new Map()) {}
  get raw(): Map<string, string> { return this.backing }
  async get(k: string): Promise<string | null> { return this.backing.get(k) ?? null }
  async set(k: string, v: string): Promise<void> { this.backing.set(k, v) }
  async remove(k: string): Promise<void> { this.backing.delete(k) }
}

export class LocalStore implements KvStore {
  constructor(private readonly prefix: string, private readonly back: Storage) {}
  async get(k: string): Promise<string | null> { return this.back.getItem(this.prefix + k) }
  async set(k: string, v: string): Promise<void> { this.back.setItem(this.prefix + k, v) }
  async remove(k: string): Promise<void> { this.back.removeItem(this.prefix + k) }
}

/**
 * IndexedDB 适配器（浏览器主存位）。
 * 刻意不做压缩：架构文档写了 LZString，但那要新增依赖（本仓库策略是零新增依赖优先），
 * 而这份存档 < 2KB ⇒ 收益远小于成本。差异与升级路径登记在 KNOWN_ISSUES。
 */
export class IdbStore implements KvStore {
  constructor(private readonly dbName: string, private readonly storeName = 'saves') {}
  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1)
      req.onupgradeneeded = () => { req.result.createObjectStore(this.storeName) }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  private async run<T>(mode: IDBTransactionMode, act: (os: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.openDb()
    return await new Promise<T>((resolve, reject) => {
      const req = act(db.transaction(this.storeName, mode).objectStore(this.storeName))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => reject(req.error)
    }).finally(() => db.close())
  }
  async get(k: string): Promise<string | null> {
    return await this.run<string | null>('readonly', (os) => os.get(k) as IDBRequest<string | null>)
  }
  async set(k: string, v: string): Promise<void> {
    await this.run<IDBValidKey>('readwrite', (os) => os.put(v, k))
  }
  async remove(k: string): Promise<void> {
    await this.run<undefined>('readwrite', (os) => os.delete(k))
  }
}

export interface SaveWorld {
  player: PlayerController
  streaming: StreamingSystem
  spawner: SpawnDirector
  clock: RhythmClock
  /** 逻辑 tick → 秒（GameTime 的 tick 是唯一时间真源） */
  time: { tick: number }
}

/**
 * 读写编排。双写规则：先落 `key.tmp`，成功后才覆盖 `key`，并把上一份挪到 `key.prev`。
 * 任何一步之间被 kill ⇒ 主键位要么是旧的完整档、要么新档已经完整，不会出现半截 JSON；
 * 读档时按 主 → tmp → prev → 备份 的顺序取**第一份过校验和**的（需求 §45 的回退语义）。
 */
export class SaveGame {
  constructor(
    private readonly world: SaveWorld,
    private readonly primary: KvStore,
    private readonly backup: KvStore | null = null,
  ) {}

  capture(): Snapshot {
    const w = this.world
    const p = w.player
    return {
      version: SAVE_VERSION,
      playSec: Math.round(w.time.tick / 60),
      regionId: w.streaming.regionAt(p.pos)?.id ?? null,
      player: {
        x: p.pos.x, y: p.pos.y, z: p.pos.z,
        hp: p.stats.hp, stamina: p.stats.stamina, overdrive: p.stats.overdrive,
        weaponId: p.weapon.id
      },
      flags: w.streaming.flagKeys(),
      clearedSlots: w.spawner.clearedKeys()
    }
  }

  async save(slot = 'autosave'): Promise<Snapshot> {
    const snap = this.capture()
    const body = wrap(SAVE_VERSION, { snapshot: snap } satisfies SavePayload)
    const prev = await this.primary.get(slot)
    await this.primary.set(`${slot}.tmp`, body)
    if (prev) await this.primary.set(`${slot}.prev`, prev)
    await this.primary.set(slot, body)
    await this.primary.remove(`${slot}.tmp`)
    if (this.backup) {
      try { await this.backup.set(slot, body) } catch { /* 备份位失败不影响主档 */ }
    }
    bus.emit('log', { level: 'info', msg: `save.ok ${slot} v${SAVE_VERSION}` })
    return snap
  }

  async load(slot = 'autosave'): Promise<Snapshot | null> {
    const candidates: Array<[string, KvStore]> = [
      [slot, this.primary],
      [`${slot}.tmp`, this.primary],
      [`${slot}.prev`, this.primary]
    ]
    if (this.backup) candidates.push([slot, this.backup])
    for (const [key, store] of candidates) {
      let raw: string | null = null
      try { raw = await store.get(key) } catch { continue }
      if (!raw) continue
      const out = unwrap(raw, [SAVE_VERSION])
      if (!out.ok) {
        bus.emit('log', { level: 'warn', msg: `save.bad ${key} ${out.reason}` })
        continue
      }
      let payload: SavePayload
      try {
        payload = migrateTo(out.payload, out.schemaVersion, SAVE_VERSION) as unknown as SavePayload
      } catch (e) {
        bus.emit('log', { level: 'warn', msg: `save.migrate ${key} ${(e as Error).message}` })
        continue
      }
      this.apply(payload.snapshot)
      bus.emit('log', { level: 'info', msg: `load.ok ${key} v${out.schemaVersion}` })
      return payload.snapshot
    }
    bus.emit('log', { level: 'warn', msg: `load.none ${slot}` })
    return null
  }

  /** 只灌状态；chunk/敌人在下一次 streaming.update / syncActive 时自己回来 */
  apply(s: Snapshot): void {
    const w = this.world
    const p = w.player
    p.pos.x = s.player.x
    p.pos.y = s.player.y
    p.pos.z = s.player.z
    p.vy = 0
    p.stats.hp = Math.min(p.stats.hpMax, s.player.hp)
    p.stats.stamina = s.player.stamina
    p.stats.overdrive = s.player.overdrive
    for (const f of s.flags) w.streaming.setFlag(f, true)
    for (const k of s.clearedSlots) w.spawner.markCleared(k)
    // floorY 不在这里算：调用方 teleport 之后由 world/Surface 给（保持「谁能算出脚下」只有一个答案）
  }
}
