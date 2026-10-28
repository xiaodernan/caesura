import { bus } from '@/core/EventBus'
import type { PlayerController } from '@/player/ThirdPersonController'
import type { StreamingSystem } from '@/world/Streaming'
import type { SpawnDirector } from '@/world/SpawnDirector'
import type { RhythmClock } from '@/core/RhythmClock'
import type { RpgRuntime, RpgSnapshot } from '@/rpg/Runtime'
import type { Quests, QuestsSnapshot } from '@/quest/Quests'
import type { WorldStates } from '@/quest/WorldStates'
import type { Interactables } from '@/world/Interactables'
import type { GameplaySettings } from '@/settings/GameplaySettings'
import type { Bindings } from '@/core/Input'
import { migrateTo, registerMigration } from './Migration'
import { MAGIC, crc32 } from './Integrity'
import { unwrap, wrap } from './Integrity'

/**
 * 存档对象与读写（technical-architecture §2 save/Serializer.ts）。
 * 只存**世界状态**，不存任何表现层对象：位置/资源/flag/清剿记录 ⇒ 读档后由既有的
 * 流送与出怪系统自己把场景摆回来（Phase 3-C2「出怪来自数据」在这里第二次生效：
 * 存档里没有一个敌人实例，只有一串槽位身份）。
 */

/** v13 起带玩法/辅助设置块（`settings.gameplay`，KI-112），v14 起带键位块（`settings.bindings`，KI-336）。迁移链见文末 */
export const SAVE_VERSION = 14

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

/**
 * v6 → v7（Phase 6-B 叙事层）。老档里**没有**任务状态机、NPC 关系、对话已读节点——
 * 迁移的动作同样是"明确地空着"：没做过的委托就是没做过、没说过话就是没说过，
 * 不替玩家补一份"好像聊过"的进度（§78 要的是如实，不是好看）。
 */
registerMigration(6, (p) => {
  const snap = { ...(p.snapshot as Record<string, unknown>) }
  snap.quest = null
  snap.version = 7
  return { ...p, snapshot: snap }
})

/**
 * v7 → v8（KI-023 可破坏场景物）。碎掉的 prop（音刺等）是**世界状态**：不存它，
 * 读一次档 = 碎刺全部立回来 = 白还一次破势窗口（与 v5→v6 那笔是同一类洞）。
 * 老档里我们不知道碎过什么 ⇒ 迁移写空集：那份档里的刺会再立起来一次——
 * 历史事实缺失的代价，不是补偿（§78）。
 */
registerMigration(7, (p) => {
  const snap = { ...(p.snapshot as Record<string, unknown>) }
  snap.brokenProps = []
  snap.version = 8
  return { ...p, snapshot: snap }
})

/**
 * v8 → v9（KI-036 被动栏）。研读过的被动是成长状态：`rpg.movements.passives`。
 * 老档没学过任何被动 ⇒ 迁移写空表——"没学过的被动就是没学过"（§78 的口径，
 * 与 v1→v2 的 `rpg: null`、v6→v7 的 `quest: null` 同一套纪律）。
 */
registerMigration(8, (p) => {
  const snap = { ...(p.snapshot as Record<string, unknown>) }
  const rpg = snap.rpg as Record<string, unknown> | null | undefined
  if (rpg && typeof rpg === 'object') {
    const mv = rpg.movements as Record<string, unknown> | null | undefined
    if (mv && typeof mv === 'object') (mv as Record<string, unknown>).passives = {}
  }
  snap.version = 9
  return { ...p, snapshot: snap }
})

/**
 * v9 → v10（KI-025① 存档摘要卡）。老档里**没有**"这一份是何时写的"这件事，
 * 所以迁移写 `null` 而不是拿读档那一刻冒充存档时刻——卡上会如实显示"未记录时间"，
 * 而不会让玩家以为"昨天存的档今天还是昨天"（§78：留空是如实，补一个现在的时间是假账）。
 *
 * 命名并导出是为了测试：`slots.test.ts` 要"摘掉这一步再装回去"来证明红的是那一步，
 * 手抄一份函数体就等于给生产逻辑留了个副本——副本改了而原件没改，测试照样绿。
 */
export function migrateV9toV10(p: Record<string, unknown>): Record<string, unknown> {
  const snap = { ...(p.snapshot as Record<string, unknown>) }
  snap.savedAt = null
  snap.version = 10
  return { ...p, snapshot: snap }
}
registerMigration(9, migrateV9toV10)

/**
 * v10 → v11（值域型世界状态 `state.*`）。老档里**没有**任何一格被写过 ⇒ 迁移写空表，
 * 于是每一格读到 `states.json` 声明的 `default`（= 那个抉择还没做）。
 * 这是如实的：老档确实没做过《该不该敲响》的抉择，**不能**反推成"已经选了某个结局"——
 * 与 v1→v2 的 `rpg: null`、v6→v7 的 `quest: null` 同一条纪律（§78 留空是如实，补一个是假账）。
 * 空表会让休垒广场那组陈设回到"还没敲响"的那一版，这正是老档该有的样子。
 */
export function migrateV10toV11(p: Record<string, unknown>): Record<string, unknown> {
  const snap = { ...(p.snapshot as Record<string, unknown>) }
  snap.states = {}
  snap.version = 11
  return { ...p, snapshot: snap }
}
registerMigration(10, migrateV10toV11)

/**
 * v11 → v12（KI-026 设置持久化）。音频音量跟着档走：
 * 老档没有设置块 ⇒ 迁移写 `{ audio: {} }`（空 = 全部走默认，不白送）。
 */
registerMigration(11, (p) => {
  const snap = { ...(p.snapshot as Record<string, unknown>) }
  if (!snap.settings) snap.settings = { audio: {} }
  snap.version = 12
  return { ...p, snapshot: snap }
})

/**
 * v12 → v13（KI-112 第一腿）。玩法/辅助设置跟着档走：老档没有 gameplay 块 ⇒
 * 迁移**不写**这格（保持 undefined）——读档侧 `restore(undefined)` 是明确的"不动"，
 * 运行时保持当前值（§78：留空是如实；写一份假默认反而谎称"那份档调过设置"）。
 * 命名导出同 migrateV9toV10 的理由：测试要摘掉这一步再装回去。
 */
export function migrateV12toV13(p: Record<string, unknown>): Record<string, unknown> {
  const snap = { ...(p.snapshot as Record<string, unknown>) }
  snap.version = 13
  return { ...p, snapshot: snap }
}
registerMigration(12, migrateV12toV13)

/**
 * v13 → v14（KI-336）。键位表跟着档走，与 v13 那一笔同一个裁决：**迁移不写这格**。
 * 老档没记过绑定 ⇒ `settings.bindings` 保持 undefined ⇒ 读档侧 `restore(undefined)` 原地不动，
 * 运行时用默认表（§78「留空是如实」——写一份假默认等于谎称那份档改过键，还会把"下一批改了默认键"
 * 的老玩家钉死在他从没选过的那一张表上）。
 */
export function migrateV13toV14(p: Record<string, unknown>): Record<string, unknown> {
  const snap = { ...(p.snapshot as Record<string, unknown>) }
  snap.version = 14
  return { ...p, snapshot: snap }
}
registerMigration(13, migrateV13toV14)

export interface Snapshot {
  version: number
  /** 游玩秒数（HUD/存档摘要卡用） */
  playSec: number
  /**
   * 这一份是**何时**写的（epoch ms，v10 起）。存档里没有自己的时钟 ⇒
   * 由 `SaveWorld.now` 注入（浏览器给 `Date.now`）。拿不到就写 null，
   * 摘要卡显示"未记录"，不拿读档那一刻冒充。
   */
  savedAt: number | null
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
  /** 碎掉的可破坏场景物 id（v8 起，KI-023）：碎刺不可再生，读档不能白还一次破势窗 */
  brokenProps: string[]
  /**
   * 设置（v12 音频 / v13 玩法 / v14 键位，KI-026 + KI-112 + KI-336）。`gameplay` 的形状在
   * `settings/GameplaySettings.ts` 里声明并在读档路径夹取；`bindings` 同理由
   * `settings/Bindings.ts > clampBindings` 把门。老档没这格 ⇒ undefined ⇒ 恢复侧什么都不动。
   */
  settings?: { audio: Record<string, number>; gameplay?: GameplaySettings; bindings?: Bindings }
  /** 成长/背包/装备/掉落状态（v2 起）。v1 老档为 null ⇒ 保留运行时基线 */
  rpg: RpgSnapshot | null
  /** 叙事进度（v7 起）：任务状态 / NPC 关系 / 对话已读节点。老档为 null ⇒ 一切从头 */
  quest: QuestsSnapshot | null
  /**
   * 值域状态（v11 起）：只记**被写过**的格；没记的格读 `states.json` 里的 `default`
   * （= 那个抉择还没做）。老档经 v10→v11 迁移得到空表 ⇒ 不反推结局（§78）。
   */
  states: Record<string, string>
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
  /**
   * IDB 对"这个键没有"是 **success + result === undefined**（不是 error、也不是 null），
   * 而 `KvStore` 把"没有"统一成 null：漏掉这一步，未写过的槽会掉进解析分支，
   * 摘要卡就把"空槽"报成"损坏"——实机 5199 读到过这件事（三个手动槽全红）。
   */
  async get(k: string): Promise<string | null> {
    return (await this.run<string | undefined>('readonly', (os) => os.get(k) as IDBRequest<string | undefined>)) ?? null
  }
  async set(k: string, v: string): Promise<void> {
    await this.run<IDBValidKey>('readwrite', (os) => os.put(v, k))
  }
  async remove(k: string): Promise<void> {
    await this.run<undefined>('readwrite', (os) => os.delete(k))
  }
}

/**
 * 一个槽位可能落盘的键位，**按尝试顺序**排。这段顺序以前只写在 `SaveGame.load` 的循环里，
 * KI-025① 起它有了第二个读者（存档摘要卡要回答"这一格到底能不能读"），
 * 而两个各写一份的读档顺序一定会飘：卡上说"可读取"、点下去读出来的是另一格，
 * 就是玩家眼前的假账。所以它是导出的**唯一主人**，`load` 与名册都从这里取。
 *
 * 顺序即优先级：主键位 → 在写的 tmp（上次崩在写一半，其实已经完整）→ prev（上一份完整档）
 * → 备份存储。`.prev` 排在备份之前，因为它来自主存储、通常更新。
 */
/** 落在哪一台存储上：备份机上的 `slot1` 与主机上的 `slot1` 是两件事，恢复来源必须能分开说 */
export type SaveStoreWhere = 'primary' | 'backup'

export function slotCandidates(
  primary: KvStore, backup: KvStore | null, slot: string,
): Array<{ key: string; store: KvStore; where: SaveStoreWhere }> {
  const out: Array<{ key: string; store: KvStore; where: SaveStoreWhere }> = [
    { key: slot, store: primary, where: 'primary' },
    { key: `${slot}.tmp`, store: primary, where: 'primary' },
    { key: `${slot}.prev`, store: primary, where: 'primary' }
  ]
  // 备份位排在 prev 之后：它来自主存储，通常更新
  if (backup) out.push({ key: slot, store: backup, where: 'backup' })
  return out
}

/** 一格为什么读不出来。`empty` 不是错误——那一格从来没写过，卡上应该显示"空槽"而不是"损坏" */
export type SlotProblem = 'empty' | 'parse' | 'magic' | 'version' | 'crc' | 'migration'

export interface TriedKey {
  key: string
  where: SaveStoreWhere
  reason: SlotProblem
  /** 迁移抛出的原话（只有 `migration` 带） */
  detail?: string
}

export interface SlotRead {
  slot: string
  /** 一路升到当前版本后的快照；null = 这一格读不出可用档 */
  snapshot: Snapshot | null
  /** 取到了哪个键位：主机上的 `slot` 本身是正常，其余都是**从恢复位捡回来的**（摘要卡的黄标） */
  fromKey: string | null
  fromStore: SaveStoreWhere | null
  /** 落盘那一刻的 schema 版本（< 当前 ⇒ 卡上标"由 v7 升级"，玩家有权知道自己读的是老档） */
  schemaVersion: number | null
  problem: SlotProblem | null
  recovered: boolean
  /** 依次试过却没成的键位，供调用方逐条写日志（`load` 与名册报同一批事实） */
  tried: TriedKey[]
}

/**
 * 读一个槽位：走 {@link slotCandidates} 的顺序，取**第一份过校验和并能升到当前版本**的。
 * 纯读、不发事件、不改世界——所以存档名册可以放心逐格问四遍，而 `SaveGame.load`
 * 仍然只有一次"应用与广播"。
 */
export async function readSlot(
  primary: KvStore, backup: KvStore | null, slot: string,
): Promise<SlotRead> {
  const tried: TriedKey[] = []
  for (const c of slotCandidates(primary, backup, slot)) {
    let raw: string | null | undefined = null
    try { raw = await c.store.get(c.key) } catch (e) {
      tried.push({ key: c.key, where: c.where, reason: 'parse', detail: (e as Error).message })
      continue
    }
    // 读侧也兜一层：一台没把"没有这个键"说成 null 的存储，不许因此把空格子指控成坏档。
    if (raw === null || raw === undefined) { tried.push({ key: c.key, where: c.where, reason: 'empty' }); continue }
    const out = unwrap(raw, READABLE_VERSIONS)
    if (!out.ok) { tried.push({ key: c.key, where: c.where, reason: out.reason }); continue }
    let payload: SavePayload
    try {
      payload = migrateTo(out.payload, out.schemaVersion, SAVE_VERSION) as unknown as SavePayload
    } catch (e) {
      tried.push({ key: c.key, where: c.where, reason: 'migration', detail: (e as Error).message })
      continue
    }
    return {
      slot, snapshot: payload.snapshot, fromKey: c.key, fromStore: c.where,
      schemaVersion: out.schemaVersion,
      problem: null, recovered: !(c.key === slot && c.where === 'primary'), tried
    }
  }
  // 全是 empty ⇒ 「这一格从来没写过」；掺了真损坏 ⇒ 报第一个非 empty 的原因
  const bad = tried.find((t) => t.reason !== 'empty')
  return {
    slot, snapshot: null, fromKey: null, fromStore: null, schemaVersion: null,
    problem: bad ? bad.reason : 'empty', recovered: false, tried
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
  /** KI-023：可破坏场景物（可选）。碎裂状态同属世界状态：不存，读档就把破势窗白还一次 */
  props?: { snapshot(): string[]; restore(ids: string[] | null | undefined): void }
  /** KI-026：音频设置持久化的消费端（可选）。读档后把存档里的音量灌回 AudioEngine */
  audio?: {
    setVolume(bus: string, level: number): void
    getVolume(bus: string): number
    /**
     * TD-006 第二腿⑤：`AudioEngine` 实例本身（可选，结构式声明）。音量那两格管的是**设置**，
     * 实例管的是**引擎的生命周期与实时读数**——实机腿要量的两样东西只有拿得到实例才量得着：
     * `dispose()`（装配层收尾口，测试与实机从此共用同一个）与 `muffleHz`（消音低通的实时频率）。
     * 存档本身不碰它：引擎不是世界状态，进档的只有音量那几个数。
     */
    engine?: { dispose(): void; readonly muffleHz: number | null }
  }
  /**
   * KI-112：玩法/辅助设置的消费端（可选，结构式声明）。`get` 供 capture 抄进档，
   * `apply` 供恢复灌回——设置块不是世界状态，不接它只意味着这一局不存设置。
   * raw 进 apply 前不被信任：夹取在 GameplaySettingsStore.restore（信任边界）里做。
   */
  gameplay?: { get(): GameplaySettings; apply(raw: unknown): void }
  /**
   * KI-336：键位表的消费端（可选，结构式声明），与 `gameplay` 同一位子——`get` 供 capture 抄进档，
   * `apply` 供读档灌回 `Input`。raw 进 apply 前同样不被信任：校验在 `BindingsStore.restore` 里做。
   */
  bindings?: { get(): Bindings; apply(raw: unknown): void }
  /** Phase 6-B：叙事进度（任务状态 / 关系 / 已读节点），同上可选 */
  quests?: Quests
  /** Phase 6-B：值域状态（`state.*`）。同样是世界状态的一部分：不存，读档就回到缺省那一格 */
  states?: WorldStates
  /**
   * 存档时刻的墙钟（epoch ms）。**逻辑层不许自己读 `Date`**：那样每次跑测都会得到不同的档，
   * 而"摘要卡上的时间来自表而不是代码"这条也没有证人。不注入 ⇒ `savedAt` 为 null，
   * 卡上显示"未记录时间"（KI-025①）。
   */
  now?: () => number
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
      savedAt: w.now ? w.now() : null,
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
      brokenProps: w.props ? w.props.snapshot() : [],
      settings: (() => {
        // 音频（KI-026）、玩法（KI-112）、键位（KI-336）三块各自独立：只接了其中一边的世界也不该丢其余的档
        if (!w.audio && !w.gameplay && !w.bindings) return undefined
        const audio: Record<string, number> = {}
        if (w.audio) {
          const buses = ['master', 'music', 'sfx', 'ambience', 'ui']
          for (const b of buses) audio[b] = w.audio.getVolume(b)
        }
        return { audio, gameplay: w.gameplay ? w.gameplay.get() : undefined, bindings: w.bindings ? w.bindings.get() : undefined }
      })(),
      rpg: w.rpg ? w.rpg.snapshot() : null,
      quest: w.quests ? w.quests.snapshot() : null,
      states: w.states ? w.states.snapshot() : {}
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
    const r = await readSlot(this.primary, this.backup, slot)
    for (const t of r.tried) {
      if (t.reason === 'empty') continue // 没写过不是故障，不值得报
      const at = `${t.key}${t.where === 'backup' ? '@backup' : ''}`
      if (t.reason === 'migration') bus.emit('log', { level: 'warn', msg: `save.migrate ${at} ${t.detail ?? ''}` })
      else bus.emit('log', { level: 'warn', msg: `save.bad ${at} ${t.reason}` })
    }
    if (!r.snapshot || r.fromKey === null) {
      bus.emit('log', { level: 'warn', msg: `load.none ${slot}` })
      return null
    }
    this.apply(r.snapshot)
    bus.emit('log', {
      level: 'info',
      msg: `load.ok ${r.fromKey}${r.fromStore === 'backup' ? '@backup' : ''} v${r.schemaVersion}`
    })
    return r.snapshot
  }

  /**
   * 抹掉一个槽位：主键位与它在写的 tmp / prev 一起删，备份位也删。
   * 只删一处就是留一份"删不干净的档"——下一格候选会把它捡回来，玩家看到刚删的档又出现了。
   * 返回是否真删掉了东西（`false` = 那一格本来就是空的，UI 用它决定要不要说"已删除"）。
   */
  async erase(slot: string): Promise<boolean> {
    let any = false
    for (const c of slotCandidates(this.primary, this.backup, slot)) {
      if (await c.store.get(c.key) !== null) any = true
      await c.store.remove(c.key)
    }
    bus.emit('log', { level: 'info', msg: `erase.${any ? 'ok' : 'noop'} ${slot}` })
    return any
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
    if (s.quest && w.quests) w.quests.restore(s.quest)
    // 值域状态：档里没有的格退回缺省（WorldStates.restore 自己会广播，交互物那侧的闸门跟着更新）
    w.states?.restore(s.states)
    for (const f of s.flags) w.streaming.setFlag(f, true)
    for (const k of s.clearedSlots) w.spawner.markCleared(k)
    // 交互物的一次性状态：v5 及以前的档没记 ⇒ 空集，那一局的箱子会再掉一次（见 v5→v6 迁移注释）
    w.interact?.restore(s.usedInteractables)
    // 碎裂的可破坏场景物：v7 及以前的档没记 ⇒ 空集，那份档里的刺会再立一次（见 v7→v8 迁移注释）
    w.props?.restore(s.brokenProps)
    // KI-026：读档后把存档里的音量灌回 AudioEngine（setVolume 即时生效）
    if (s.settings?.audio && w.audio) {
      for (const [bus, vol] of Object.entries(s.settings.audio)) {
        if (typeof vol === 'number') w.audio.setVolume(bus, vol)
      }
    }
    // KI-112：玩法设置灌回消费者。老档没这格 ⇒ undefined ⇒ restore 自己的"不动"语义，
    // 运行时保持当前值（不假装重置成默认——那份档根本没记过设置）
    w.gameplay?.apply(s.settings?.gameplay)
    // KI-336：键位表整张换回。同一句 §78：老档没记过绑定 ⇒ 不动，运行时保持当前那一张
    w.bindings?.apply(s.settings?.bindings)
    // floorY 不在这里算：调用方 teleport 之后由 world/Surface 给（保持「谁能算出脚下」只有一个答案）
  }
}


/**
 * R6 风险缓解：存档导出/导入（JSON 兜底）。
 * IndexedDB 可能被浏览器清理或损坏（R6），导出一份 JSON 让玩家自己备份是最低成本的兜底。
 * 导出 = 读主存位的原始 JSON 字符串；导入 = 校验 CRC + magic 后写入主存位。
 */
export async function exportSave(store: KvStore, slot = 'autosave'): Promise<string | null> {
  const raw = await store.get(slot)
  return raw // 已经是 JSON 字符串（含 magic/CRC/payload）
}

export async function importSave(
  store: KvStore, json: string, slot = 'autosave'
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const parsed = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'not-object' }
    if (!parsed.magic || parsed.magic !== MAGIC) return { ok: false, reason: 'bad-magic' }
    if (typeof parsed.crc !== 'number') return { ok: false, reason: 'no-crc' }
    if (!parsed.payload || !parsed.payload.snapshot) return { ok: false, reason: 'no-snapshot' }
    // CRC 校验用 Integrity.ts 的 crc32（与 wrap 同一条算法，不是第二份）
    const body = JSON.stringify(parsed.payload)
    if (crc32(body) !== parsed.crc) return { ok: false, reason: 'crc-mismatch' }
    await store.set(slot, json)
    return { ok: true }
  } catch {
    return { ok: false, reason: 'parse-error' }
  }
}
