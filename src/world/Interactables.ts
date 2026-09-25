/**
 * 交互物运行时（Phase 3-C1，需求 §65 六要素之「交互」）。
 * 数据全来自 RegionData.interactables；本文件禁止 import three，也不直接持有玩家：
 * use() 只返回「发生了什么」，回血 / 传送 / 掉落由胶水层（main.ts）执行。
 */
import { bus } from '@/core/EventBus'
import { registry } from '@/core/Registry'
import type { InteractableRef, NpcData, RegionData, Vec3 } from '@/data/schema'

export interface Interactable extends InteractableRef {
  regionId: string
  regionName: string
}

export type InteractState = 'ready' | 'locked' | 'used'

export interface InteractResult {
  id: string
  kind: InteractableRef['kind']
  ok: boolean
  state: InteractState
  /** 给 HUD/日志的中文文案（Phase 6 换成本地表 key） */
  text: string
  setsFlag?: string
  to?: Vec3
  /** 调音桩：胶水层据此回满 HP/体力 */
  rest?: boolean
  /** 采集/遗箱：胶水层据此掷掉落表 */
  loot?: boolean
  /** 掉落表 id（来自 RegionData.interactables[].lootTable） */
  lootTable?: string
  /** 交谈对象（Phase 6-B：胶水层据此开对话树，本文件不认识对话引擎） */
  npcId?: string
}

const VERB: Record<InteractableRef['kind'], string> = {
  checkpoint: '调音', elevator: '乘共鸣井', bridge: '放吊桥', soundwall: '共振音壁',
  gather: '采集', chest: '开启', npc: '交谈', teleport: '传送', gate: '开门', bell: '敲钟',
}

/** 反复可用的设施（其余一次性；oneWay 数据标记永远只用一次）。
 *  teleport 天然反复：捷径/传送点是"门开了就一直在"（KI-021① 的音壁回廊捷径是第一个消费者），
 *  oneWay 数据仍可把任何种类强制成单次。 */
const REPEATABLE = new Set<InteractableRef['kind']>(['checkpoint', 'npc', 'teleport'])

const dist2 = (a: Vec3, b: Vec3): number => {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

export class Interactables {
  readonly range: number
  private readonly items: Interactable[] = []
  private readonly flags = new Set<string>()
  private used = new Set<string>()
  private readonly unsub: () => void
  private focused: string | null = null

  constructor(
    private readonly regions: readonly RegionData[],
    private readonly isRegionOpen: (r: RegionData) => boolean = () => true,
    range = 6,
  ) {
    this.range = range
    for (const r of regions) {
      for (const it of r.interactables) {
        const base = { ...it, regionId: r.id, regionName: r.displayName }
        if (!it.secretId) { this.items.push(base); continue }
        // 封存点的"解锁旗标"与"奖励表"只住在 secrets[] 那一条记录里：这里按引用取，
        // 不在交互物行上再抄一遍——抄了就会出现"改了 secret 忘了改箱子"的第二真值。
        const secret = r.secrets.find((x) => x.id === it.secretId)
        if (!secret) throw new Error(`Interactables: ${it.id} 的 secretId "${it.secretId}" 不在 ${r.id}.secrets 里`)
        this.items.push({ ...base, requiresFlag: secret.unlockFlag, lootTable: secret.rewardTable })
      }
    }
    this.unsub = bus.on('world.flag', (f) => {
      const truthy = f.value !== false && f.value !== 0 && f.value !== ''
      if (truthy) this.flags.add(f.key); else this.flags.delete(f.key)
    })
  }

  dispose(): void { this.unsub() }

  get all(): readonly Interactable[] { return this.items }
  get usedCount(): number { return this.used.size }
  hasFlag(key: string): boolean { return this.flags.has(key) }

  /**
   * 一次性交互物的"用过了"必须跟着存档走：区域 flag 存了，但 `used` 没存过，
   * 于是读档 = 全世界的遗箱重新能开一次、放下的吊桥又能过一遍（掉落复制 + 单向锁回退）。
   * 排序是为了让快照可比对（存档 diff 与测试都靠它）。
   */
  snapshot(): string[] { return [...this.used].sort() }

  restore(ids: string[] | null | undefined): void {
    this.used = new Set(ids ?? [])
    this.focused = null
  }

  /** 写 flag 的唯一路径同样是广播（自己的缓存由上面那个监听器更新，与 StreamingSystem 对称） */
  setFlag(key: string, on = true): void {
    bus.emit('world.flag', { key, value: on })
  }

  regionOpen(it: Interactable): boolean {
    const r = this.regions.find((x) => x.id === it.regionId)
    return r ? this.isRegionOpen(r) : false
  }

  get(id: string): Interactable | undefined { return this.items.find((i) => i.id === id) }

  stateOf(it: Interactable): InteractState {
    if (this.used.has(it.id)) return 'used'
    if (it.requiresFlag && !this.flags.has(it.requiresFlag)) return 'locked'
    return 'ready'
  }

  /** 半径内、所属区域已解锁、且还没被消耗掉的交互物，按距离升序 */
  nearby(pos: Vec3): Interactable[] {
    const r2 = this.range * this.range
    return this.items
      .filter((i) => dist2(i.pos, pos) <= r2 && this.regionOpen(i) && !this.used.has(i.id))
      .sort((a, b) => dist2(a.pos, pos) - dist2(b.pos, pos))
  }

  focus(pos: Vec3): Interactable | null { return this.nearby(pos)[0] ?? null }

  /** 每 tick 调用：焦点变化时才发 UI 提示事件 */
  update(pos: Vec3): void {
    const f = this.focus(pos)
    const id = f ? f.id : null
    if (id === this.focused) return
    this.focused = id
    bus.emit('ui.prompt', { text: f ? `${f.verb ?? VERB[f.kind]} · ${f.regionName}` : null, id })
  }

  use(id: string, pos: Vec3): InteractResult {
    const it = this.get(id)
    if (!it) return { id, kind: 'chest', ok: false, state: 'locked', text: '没有可交互对象' }
    if (!this.regionOpen(it)) return { id, kind: it.kind, ok: false, state: 'locked', text: '那里还没有通路' }
    if (dist2(it.pos, pos) > this.range * this.range) {
      return { id, kind: it.kind, ok: false, state: 'ready', text: '离得太远' }
    }
    return this.activate(it)
  }

  /** 焦点物（E 键正式入口） */
  useNearest(pos: Vec3): InteractResult | null {
    const f = this.focus(pos)
    return f ? this.activate(f) : null
  }

  private activate(it: Interactable): InteractResult {
    const base = { id: it.id, kind: it.kind, to: it.to }
    const out = (r: InteractResult): InteractResult => {
      // 世界状态层（quest/WorldState）与调试器都读这条；失败的"为什么不行"同样是它们要的信息
      bus.emit('world.interact', { id: r.id, kind: r.kind, ok: r.ok, state: r.state })
      return r
    }
    if (this.used.has(it.id)) return out({ ...base, ok: false, state: 'used', text: `${it.regionName}：此路已尽` })
    if (it.requiresFlag && !this.flags.has(it.requiresFlag)) {
      return out({ ...base, ok: false, state: 'locked', text: lockText(it) })
    }
    if (!REPEATABLE.has(it.kind) || it.oneWay) this.used.add(it.id)
    if (it.setsFlag) this.setFlag(it.setsFlag)
    const text = resultText(it)
    bus.emit('ui.notify', { text, kind: it.kind === 'chest' || it.kind === 'gather' ? 'reward' : 'info' })
    bus.emit('audio.sfx', { key: SFX[it.kind], pos: it.pos, gain: 0.5 })
    if (it.setsFlag) bus.emit('log', { level: 'info', msg: `interact ${it.id} -> ${it.setsFlag ?? '-'} used=${this.used.has(it.id)}` })
    return out({
      ...base, ok: true, state: this.stateOf(it), text,
      ...(it.setsFlag ? { setsFlag: it.setsFlag } : {}),
      ...(it.kind === 'checkpoint' ? { rest: true } : {}),
      ...(it.kind === 'gather' || it.kind === 'chest' ? { loot: true } : {}),
      ...(it.lootTable ? { lootTable: it.lootTable } : {}),
      ...(it.npcId ? { npcId: it.npcId } : {}),
    })
  }
}

function lockText(it: Interactable): string {
  if (it.kind === 'soundwall') return '音壁纹丝不动 —— 需要先学会弹反'
  if (it.kind === 'elevator') return '井笼不动 —— 机构未接通'
  if (it.kind === 'chest') return '箱子上着锁'
  return `需要 ${it.requiresFlag ?? '前置条件'}`
}

function resultText(it: Interactable): string {
  switch (it.kind) {
    case 'checkpoint': return `调音桩已共鸣 · ${it.regionName}`
    case 'gather': return '采集 · 音色石碎料'
    case 'chest': return '遗箱已开'
    case 'npc': return `与${registry.maybeGet<NpcData>(it.npcId ?? '')?.displayName ?? '某人'}交谈`
    case 'soundwall': return '音壁裂开 —— 通路已现'
    case 'bridge': return '吊桥落下'
    case 'bell': return '落钟鸣响，回音落在高处'
    case 'gate': return '闸门开启'
    case 'elevator': return it.verb ? '吊机咬合，回音把人托往高处' : '共鸣井启动 —— 井笼开始升降'
    case 'teleport': return '位移回响'
    default: return '机关启动'
  }
}

/** kind → 合成 SFX key（必须都在 audio/synth.ts 的 SFX_KEYS 里，由 arch 测试闸门校验） */
const SFX: Record<InteractableRef['kind'], string> = {
  checkpoint: 'chord_slam', elevator: 'gate_creak', bridge: 'gate_creak', soundwall: 'gnash',
  gather: 'loot_chime', chest: 'loot_chime', npc: 'ui_select', teleport: 'chord_slam',
  gate: 'gate_creak', bell: 'chord_slam',
}

/**
 * E 键仲裁：同一帧里交互优先于处决/背刺（两者都读 'interact' 边）。
 * 有焦点物时吃掉这条边并返回其 id；否则原样留给战斗层。
 */
export function takeInteractEdge(edges: Set<string>, focus: Interactable | null): string | null {
  if (!focus || !edges.has('interact')) return null
  edges.delete('interact')
  return focus.id
}
