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
}

export interface SpawnSlot {
  /** 稳定身份：区域:组序号:成员序号。死亡后记入 cleared，回来不再刷 */
  key: string
  chunkKey: string
  enemyId: string
  pos: Vec3
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

/** 最小 flag 表达式：`flag.a && !flag.b`（析取留给 Phase 6 的对话条件，需要时再加） */
export function evalCondition(expr: string | undefined, has: (k: string) => boolean): boolean {
  if (expr === undefined || expr.trim() === '') return true
  return expr.split('&&').every((raw) => {
    const term = raw.trim()
    if (term === '') return true
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
            instanceId: null,
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
  private spawnChunk(chunkKey: string): void {    for (const s of this.byChunk.get(chunkKey) ?? []) {
      if (s.instanceId || this.cleared.has(s.key)) continue
      if (!evalCondition(s.condition, (k) => this.host.hasFlag(k))) continue
      if (this.aliveCount >= this.options.maxAlive) {
        bus.emit('log', { level: 'warn', msg: `SpawnDirector: 达到 AI 上限 ${this.options.maxAlive}，${s.key} 排队等待` })
        return
      }
      s.instanceId = this.host.spawn(s.enemyId, s.pos, s.key).id
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
