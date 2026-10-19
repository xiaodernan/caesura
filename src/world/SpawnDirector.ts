/**
 * 数据驱动出怪（Phase 3-C2，需求 §55「零硬编码」+ §50 流送预算）。
 * main.ts 里那 4 行 `ai.spawn(...)` 就是本模块要消灭的东西：敌人从 `RegionData.spawnGroups`
 * 来，chunk 进入 active 才落地，离开激活圈（卸载）就回收——UE 里等价于
 * World Partition 的 data-layer 放置 + 运行时 ISM/Subsystem 生成。
 *
 * 本文件禁止 import three，也不直接持有 AISystem：通过 SpawnHost 端口注入，
 * 这样 headless 测试可以用一个假 host 验证整条生命周期。
 * 注：`spawnGroups[].campId`（编队共享仇恨）由 Phase 4 的 Squad 消费，这里暂不透传。
 */
import { bus } from '@/core/EventBus'
import { Rng } from '@/core/Math'
import type { RegionData, SpawnGroup, Vec3 } from '@/data/schema'

/** 出怪端口（AISystem 适配）；seed 传下去让敌人 FSM 的随机仍是可复现的种子流 */
export interface SpawnHost {
  spawn(enemyId: string, pos: Vec3, seed: string): { id: string }
  despawn(id: string): boolean
  hasFlag(key: string): boolean
  /**
   * 世界状态的现读（KI-143）：刷怪闸门要能问"这一格世界是什么样"。
   * **可省**：没有读方时，条件里带 `state.` 的那一组**不刷**（宁可少刷，不可刷错）。
   */
  stateOf?(key: string): string | null
  /**
   * 世界状态的现读（KI-143）：刷怪闸门要能问"这一格世界是什么样"。
   * **可省**：没有读方时，条件里带 `state.` 的那一组**不刷**（宁可少刷，不可刷错）。
   */
  stateOf?(key: string): string | null
  /**
   * 世界状态的现读（KI-143）：刷怪闸门要能问"这一格世界是什么样"。
   * **可省**：没有读方时，条件里带 `state.` 的那一组**不刷**（宁可少刷，不可刷错）。
   */
  stateOf?(key: string): string | null
}

export interface SpawnSlot {
  /** 稳定身份：区域:组序号:成员序号。死亡后记入 cleared，回来不再刷 */
  key: string
  chunkKey: string
  enemyId: string
  /**
   * **基准**落点 = 浓度 1（今天每一格天气的读数）时这一槽铺在哪。
   * 实际落地位置由 `SpawnDirector` 按当前浓度向 `center` 收拢后现算（§5.9.33③ 敌人浓度腿）——
   * 不就地改写这一格，是因为基准必须是可复现的：改写过一次，浓度回到 1 时这一槽就回不了家。
   */
  pos: Vec3
  /** 组的中心：浓度腿的唯一参照点（聚拢与散开都绕着它，不绕着听者或区块） */
  center: Vec3
  condition?: string
  instanceId: string | null
}

export interface SpawnOptions {
  /** §5.5 AI 同时激活上限 60；超出只排队，不外溢（不静默丢弃：发 log warn） */
  maxAlive: number
  /** 布点抖动占半径比例（0 = 严格螺旋等分） */
  jitter: number
}

export const DEFAULT_SPAWN_OPTIONS: SpawnOptions = { maxAlive: 60, jitter: 0.25 }

const GOLDEN_ANGLE = 2.399963229728653

/**
 * 刷怪闸门的**条件语言**（KI-143 扩了一格）。
 *
 * 四形，都用 `&&` 连接（析取留给 Phase 6 的对话条件，需要时再加）：
 *   · `flag.x`     —— 那一面旗立着
 *   · `!flag.x`    —— 那一面旗没立
 *   · `state.K==V` —— 那个世界状态**等于**那个取值（KI-143：破拍营地的营长只在 GARRISON 那条线上）
 *   · `state.K!=V` —— 那个世界状态**不等于**那个取值
 *
 * **没有状态读方 ⇒ 带 `state.` 的那一项为假**（那一组不刷）：宁可少刷，不可刷错
 * ——"刷出一个不该在这里的精英"比"没刷"坏得多。
 */
export function evalCondition(
  expr: string | undefined,
  has: (k: string) => boolean,
  stateOf?: (k: string) => string | null,
): boolean {
  if (expr === undefined || expr.trim() === '') return true
  return expr.split('&&').every((raw) => {
    const term = raw.trim()
    if (term === '') return true
    // 状态两形：state.KEY==VALUE / state.KEY!=VALUE
    // **键是整段**（`state.haltrune.camp` 就是那个状态的完整键）——states.json 里的键本身就带
    // `state.` 前缀，剥掉前缀再查 ⇒ 永远查不到（那一组就永远不刷，而门会绿）。
    if (term.startsWith('state.')) {
      const m = /^(state\.[A-Za-z0-9_.]+)(==|!=)(.+)$/.exec(term)
      if (!m) return false // 写坏了的形状 ⇒ 不满足（数据门那边会红）
      const [, key, op, value] = m
      const current = stateOf ? stateOf(key) : null
      if (current === null) return false // 没有读方（或这一格还没写过）⇒ 不满足
      return op === '==' ? current === value : current !== value
    }
    return term.startsWith('!') ? !has(term.slice(1).trim()) : has(term)
  })
}

/** 组内成员用黄金角等距铺开（同一 seed 永远得到同一批点位），再叠一个按槽位键播种的抖动 */
function slotPosition(group: SpawnGroup, i: number, count: number, slotKey: string, jitter: number): Vec3 {
  const a = i * GOLDEN_ANGLE
  const r = group.radius * Math.sqrt((i + 0.5) / Math.max(1, count))
  const rng = new Rng(slotKey)
  const jr = r * (1 + rng.float(-jitter, jitter))
  const ja = a + rng.float(-0.25, 0.25)
  return {
    x: group.center.x + Math.cos(ja) * jr,
    y: group.center.y,
    z: group.center.z + Math.sin(ja) * jr,
  }
}

export class SpawnDirector {
  private readonly slots: SpawnSlot[] = []
  private readonly byChunk = new Map<string, SpawnSlot[]>()
  private readonly cleared = new Set<string>()
  private readonly unsub: Array<() => void> = []
  readonly options: SpawnOptions
  /**
   * §5.9.33③ 敌人浓度腿的当前读数（由组合根从 `world/WeatherEffects > concentrationMul` 推进来）。
   * 1 = 按数据写的半径铺开（= 今天每一格天气的形状）；>1 = 向组心收拢；<1 = 铺得更开。
   */
  private concentration = 1

  constructor(
    regions: readonly RegionData[],
    private readonly host: SpawnHost,
    private readonly cellKey: (pos: Vec3) => string,
    options?: Partial<SpawnOptions>,
  ) {
    this.options = { ...DEFAULT_SPAWN_OPTIONS, ...options }
    for (const r of regions) {
      r.spawnGroups.forEach((g, gi) => {
        const chunkKey = this.cellKey(g.center)
        for (let i = 0; i < g.count; i++) {
          const key = `${r.id}:${gi}:${i}`
          const slot: SpawnSlot = {
            key, chunkKey, enemyId: g.enemyId,
            condition: g.condition, pos: slotPosition(g, i, g.count, key, this.options.jitter),
            center: g.center, instanceId: null,
          }
          this.slots.push(slot)
          const list = this.byChunk.get(chunkKey)
          if (list) list.push(slot); else this.byChunk.set(chunkKey, [slot])
        }
      })
    }
    this.unsub.push(
      bus.on('world.chunk', (c) => {
        if (c.state === 'active') this.spawnChunk(c.key)
        else this.recallChunk(c.key)
      }),
      bus.on('entity.died', (e) => this.onDied(e.id, e.kind)),
    )
  }

  dispose(): void {
    for (const off of this.unsub) off()
    this.unsub.length = 0
  }

  get slotCount(): number { return this.slots.length }
  get aliveCount(): number { return this.slots.reduce((n, s) => n + (s.instanceId ? 1 : 0), 0) }
  get clearedCount(): number { return this.cleared.size }
  /** 存档：已永久清剿的槽位身份（`region:组序号:成员序号`） */
  clearedKeys(): string[] { return [...this.cleared].sort() }
  /** 读档：把清剿记录灌回来。槽位身份是稳定字符串，所以跨会话仍然指同一颗怪 */
  markCleared(key: string): void {
    if (!this.slots.some((s) => s.key === key)) return // 数据改过槽位身份 ⇒ 忽略陈旧记录而不是崩
    this.cleared.add(key)
  }
  alive(): SpawnSlot[] { return this.slots.filter((s) => s.instanceId !== null) }
  slotsInChunk(chunkKey: string): SpawnSlot[] { return this.byChunk.get(chunkKey) ?? [] }

  /**
   * 组合根在 `streaming.teleport()` 之后补一次：构造晚于首批 world.chunk 事件的订阅者
   * 会错过开场那一批激活，这里按当前 active 名单补账（幂等，已落地的槽位跳过）。
   */
  syncActive(chunkKeys: Iterable<string>): void {
    for (const k of chunkKeys) this.spawnChunk(k)
  }

  /** 进入激活圈：condition 通过、未被击杀过的槽位落地 */
  /**
   * 换敌人浓度（§5.9.33③）。**只影响"下一次进格时这一组铺在哪"**：已经活着的敌人一个都不动——
   * 天气没有权收回玩家正在打的东西，把活着的怪收回去是另一件事（KI-066 那条"不篡改时间线"的同族）。
   *
   * ≤0 一律按 1 收：浓度是半径的除数，0 会算出 Infinity 的落点。校验器（判据 G3）本来就不许表里
   * 出现 0，这里守的是"万一有人从控制台直接调"。
   */
  setConcentration(mul: number): void {
    this.concentration = mul > 0 ? mul : 1
  }

  /**
   * 这一槽此刻的落点：基准位置按当前浓度向组心收拢（`÷ concentration`）。
   * 不写回 `s.pos`（见那个字段的注释）：基准保持可复现，浓度怎么变都不漂移。
   */
  private slotPos(s: SpawnSlot): Vec3 {
    if (this.concentration === 1) return s.pos
    return {
      x: s.center.x + (s.pos.x - s.center.x) / this.concentration,
      y: s.pos.y,
      z: s.center.z + (s.pos.z - s.center.z) / this.concentration,
    }
  }

  /** 进入激活圈：condition 通过、未被击杀过的槽位落地 */
  private spawnChunk(chunkKey: string): void {
    for (const s of this.byChunk.get(chunkKey) ?? []) {
      if (s.instanceId || this.cleared.has(s.key)) continue
      if (!evalCondition(s.condition, (k) => this.host.hasFlag(k), (k) => this.host.stateOf?.(k) ?? null)) continue
      if (this.aliveCount >= this.options.maxAlive) {
        bus.emit('log', { level: 'warn', msg: `SpawnDirector: 达到 AI 上限 ${this.options.maxAlive}，${s.key} 排队等待` })
        return
      }
      s.instanceId = this.host.spawn(s.enemyId, this.slotPos(s), s.key).id
    }
  }

  /** 离开激活圈：还活着的收回去（下次进格会重新刷，除非已被击杀） */
  private recallChunk(chunkKey: string): void {
    for (const s of this.byChunk.get(chunkKey) ?? []) {
      if (!s.instanceId) continue
      if (this.host.despawn(s.instanceId)) {
        bus.emit('log', { level: 'info', msg: `SpawnDirector: recall ${s.enemyId} ${s.key}` })
        s.instanceId = null
      }
    }
  }

  private onDied(instanceId: string, kind: string): void {
    if (kind !== 'enemy') return
    const s = this.slots.find((x) => x.instanceId === instanceId)
    if (!s) return
    s.instanceId = null
    this.cleared.add(s.key)
  }
}
