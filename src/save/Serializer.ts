import { bus } from '@/core/EventBus'
import type { PlayerController } from '@/player/ThirdPersonController'
import type { StreamingSystem } from '@/world/Streaming'
import type { SpawnDirector } from '@/world/SpawnDirector'
import type { RhythmClock } from '@/core/RhythmClock'
import type { RpgRuntime, RpgSnapshot } from '@/rpg/Runtime'
import type { Interactables } from '@/world/Interactables'
import { migrateTo, registerMigration } from './Migration'
import { unwrap, wrap } from './Integrity'

/**
 * 存档对象与读写（technical-architecture §2 save/Serializer.ts）。
 * 只存**世界状态**，不存任何表现层对象：位置/资源/flag/清剿记录 ⇒ 读档后由既有的
 * 流送与出怪系统自己把场景摆回来（Phase 3-C2「出怪来自数据」在这里第二次生效：
 * 存档里没有一个敌人实例，只有一串槽位身份）。
 */

export const SAVE_VERSION = 6

/**
 * 读档时接受的版本：凡是 ≤ 当前版本、且迁移链能一路升到当前的，都可以读。
 * 之前这里只写 `[SAVE_VERSION]` ⇒ 老档在 `unwrap` 那一步就被当成坏档拒掉，
 * 精心注册的迁移链在真实读档路径上永远跑不到（只有单测直接调 `migrateTo` 才跑到）。
 */
export const READABLE_VERSIONS: number[] = Array.from({ length: SAVE_VERSION }, (_, i) => i + 1)

/**
 * v1 → v2（Phase 5-B 的成长/背包/装备/掉落）。
 * 老档里**没有**这些东西，所以迁移的动作是「明确地空着」而不是编一套假的成长数据：
 * `rpg: null` ⇒ 读档后保留运行时当前值（出身基线）。需求 §78 的要求是如实，不是好看。
 */
registerMigration(1, (p) => {
  const snap = { ...(p.snapshot as Record<string, unknown>) }
  snap.rpg = null
  snap.version = 2
  return { ...p, snapshot: snap }
})

/**
 * v2 → v3（Phase 5-C1 的失谐/褪色值）。老档读进来从「零失谐」开始——
 * 这是如实（那份档确实没有这个概念），不是把 0 当成"当时也没积累"的假账。
 */
registerMigration(2, (p) => {
  const snap = { ...(p.snapshot as Record<string, unknown>) }
  snap.player = { ...(snap.player as Record<string, unknown>), corruption: 0 }
  snap.version = 3
  return { ...p, snapshot: snap }
})

/**
 * v3 → v4（Phase 5-C2 的乐章战技谱册）。老档里确实没有"学过哪几式"这件事，
 * 所以迁移写的是**空谱册**（页全黑、槽全空），而不是替玩家点亮第一页：
 * 振源核与乐谱残页本来就在它那份背包里，回到调音桩照样点得开。
 */
registerMigration(3, (p) => {
  const snap = { ...(p.snapshot as Record<string, unknown>) }
  const rpg = snap.rpg as Record<string, unknown> | null | undefined
  if (rpg) snap.rpg = { ...rpg, movements: { lit: [], levels: {}, slots: [] } }
  snap.version = 4
  return { ...p, snapshot: snap }
})

/**
 * v4 → v5（Phase 5-C3 掉落评审）：`rpg.loot.rollStreaks`（§9.2 逐条保底计数）与 `rpg.inventory.rng`
 * （掷骰抽到第几笔，§10「种子入档 ⇒ 可复现 QA」补齐的那一半）。
 * 老档里这两格确实是空的 ⇒ 迁移只写**空表**：保底从零开始攒（不白送一次），掷骰位置不写
 * （`Inventory.restore` 见不到 `rng` 就沿用运行时那颗，而不是假装"倒回开局种子"——那份档根本没记过）。
 * 需求 §78：留空是如实，补一笔"你其实攒过了"就是假账。
 */
registerMigration(4, (p) => {
  const snap = { ...(p.snapshot as Record<string, unknown>) }
  const rpg = snap.rpg as Record<string, unknown> | null | undefined
  if (rpg) {
    const loot = (rpg.loot ?? null) as Record<string, unknown> | null
    if (loot) snap.rpg = { ...rpg, loot: { ...loot, rollStreaks: {} } }
  }
  snap.version = 5
  return { ...p, snapshot: snap }
})

/**
 * v5 → v6（Phase 6-A 抓到的第一笔漏账）：一次性交互物的"用过了"整格从没入过档。
 * 老档里我们确实不知道哪些箱子被开过 ⇒ 迁移写空集。后果要说清楚：**那份档里的遗箱会再掉一次 loot**
 * ——这不是补偿，是历史事实缺失的代价，任何"帮你补上"的做法都是编数据（§78）。
 */
registerMigration(5, (p) => {
  const snap = { ...(p.snapshot as Record<string, unknown>) }
  snap.usedInteractables = []
  snap.version = 6
  return { ...p, snapshot: snap }
})

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
    /** §11 失谐（褪色值）。不存它就能靠读档白嫖一次清除——那这条区域压力机制是假的 */
    corruption: number
  }
  /** 世界 flag（区域解锁、营地状态、Boss 已死…全部命名空间化的键） */
  flags: string[]
  /** 已永久清剿的出怪槽位身份：读档后这些位置不能再刷怪 */
  clearedSlots: string[]
  /** 已经用过的一次性交互物 id（v6 起）：遗箱/吊桥/音壁读档后不许再响第二次。
   *  存的是 id 数组而不是布尔位——加一个交互物不需要动存档 schema。 */
  usedInteractables: string[]
  /** 成长/背包/装备/掉落状态（v2 起）。v1 老档为 null ⇒ 保留运行时基线 */
  rpg: RpgSnapshot | null
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
  /** Phase 5-B：成长系统（可选 —— 不接成长系统的测试/工具仍可构造 SaveGame） */
  rpg?: RpgRuntime
  /** Phase 6-A：交互物（同上，可选）。它的一次性状态是**世界状态**的一部分，不是 UI 状态 */
  interact?: Interactables
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
        weaponId: p.weapon.id,
        corruption: p.corruption.value
      },
      flags: w.streaming.flagKeys(),
      clearedSlots: w.spawner.clearedKeys(),
      usedInteractables: w.interact ? w.interact.snapshot() : [],
      rpg: w.rpg ? w.rpg.snapshot() : null
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
      const out = unwrap(raw, READABLE_VERSIONS)
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
    // 读档后失谐要连着"它现在几成"的读数一起发布，否则 HUD 的褪色槽还停在上一局
    p.corruption.value = Math.min(p.corruption.cfg.max, s.player.corruption ?? 0)
    p.publishStats()
    if (s.rpg && w.rpg) w.rpg.restore(s.rpg)
    for (const f of s.flags) w.streaming.setFlag(f, true)
    for (const k of s.clearedSlots) w.spawner.markCleared(k)
    // 交互物的一次性状态：v5 及以前的档没记 ⇒ 空集，那一局的箱子会再掉一次（见 v5→v6 迁移注释）
    w.interact?.restore(s.usedInteractables)
    // floorY 不在这里算：调用方 teleport 之后由 world/Surface 给（保持「谁能算出脚下」只有一个答案）
  }
}
