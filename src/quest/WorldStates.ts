import { bus } from '@/core/EventBus'

import type { WorldStateDef } from '@/data/schema'

/**
 * **值域型**世界状态（Phase 6-B，narrative §7 的 `STATE.<域>.<对象> = <枚举>`）。
 *
 * 为什么旗标不够用：旗标只有"立 / 没立"两格，而《该不该敲响》有三个结局，
 * §7 那张表因此写的是 `STATE.BELLS.FOURTH_DUMB = SEALED / RUNG / MELTED / INTACT`。
 * 用三个互斥布尔代替一个枚举，会得到一个没人裁决的局面——两条同时立起来时世界是哪一种？
 * 值域表存在的意义就是把"一共几格、缺省哪格、谁说了算"钉死在数据里。
 *
 * 三条纪律（与 `flag` 通道一一对应，但刻意不共用）：
 * 1. **唯一写入口是 `set()`**：key 与 value 都必须在登记表里，认不出的一律不写（并说一声）。
 *    写入即广播 `world.state`，读方（对话条件 / 任务步 / 交互物闸门 / 存档）各自缓存同一个事件源。
 * 2. **缺省是数据说的**：没写过的格子读到 `states.json` 声明的 `default`（= 抉择还没做）。
 *    所以"还没决定"也能被写成一个普通条件，不必发明第五种"未设置"谓词。
 * 3. **快照只记写过的格**：`snapshot()` 里没有的 key = 这一局从没动过它；
 *    `restore()` 只认登记表里、且取值合法的条目（手改档塞进来的一律丢弃，与成长状态同一条纪律）。
 */
export class WorldStates {
  private readonly defs = new Map<string, WorldStateDef>()
  /** 有效读数：写过的值，或该格的缺省 */
  private readonly values = new Map<string, string>()
  /** 真被写过的格（快照只记这些） */
  private readonly written = new Set<string>()
  private readonly off: () => void

  constructor(defs: readonly WorldStateDef[]) {
    for (const d of defs) {
      this.defs.set(d.key, d)
      this.values.set(d.key, d.default)
    }
    // 广播是唯一写路径 ⇒ 自己也听它：外部（读档、测试、未来的规则表）emit 时这边照样跟上
    this.off = bus.on('world.state', (p) => {
      if (this.defs.has(p.key)) this.values.set(p.key, p.value)
    })
  }

  dispose(): void { this.off() }

  def(key: string): WorldStateDef | null { return this.defs.get(key) ?? null }
  all(): WorldStateDef[] { return [...this.defs.values()] }

  /** 读一格（没写过 ⇒ 缺省）。对话条件、调试面板、存档都从这里取 */
  get(key: string): string {
    return this.values.get(key) ?? this.defs.get(key)?.default ?? ''
  }

  /** 这一格被**写过**没有（缺省值也可能被显式写过，所以不能用 get 比对） */
  isSet(key: string): boolean { return this.written.has(key) }

  /**
   * 写一格。key/value 不在登记表里 ⇒ 拒绝并说一声（不静默写进去：
   * 一个拼错的值会变成永远读不到的死状态，而逐文件校验看不见它）。
   */
  set(key: string, value: string): boolean {
    const d = this.defs.get(key)
    if (!d) {
      bus.emit('log', { level: 'warn', msg: `worldstate.unknown ${key}（不在 states.json 登记表里，拒绝写入）` })
      return false
    }
    if (!d.values.includes(value)) {
      bus.emit('log', { level: 'warn', msg: `worldstate.badValue ${key}=${value}（合法取值：${d.values.join('/')}）` })
      return false
    }
    this.written.add(key)
    bus.emit('world.state', { key, value }) // 自己的缓存由上面那个监听器更新：不开第二条写路
    return true
  }

  /** 交互物闸门用：这一格**现在**是不是那个值（缺省也参与比较） */
  matches(key: string, value: string): boolean { return this.get(key) === value }

  snapshot(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const k of [...this.written].sort()) out[k] = this.get(k)
    return out
  }

  /**
   * 回读。只认**登记表里 + 取值合法**的条目，其余丢弃（手改档把 `state.x = NOPE` 塞进来时，
   * 它不会变成一个全项目没人认识的读数）；再把当前写着、档里却没有的格子**退回缺省**——
   * 不退就会出现"上一局敲响了钟，读一份没敲过的档，广场上还跪着人"。
   */
  restore(s: Record<string, string> | null | undefined): void {
    const incoming = new Map<string, string>()
    for (const [k, v] of Object.entries(s ?? {})) {
      const d = this.defs.get(k)
      if (!d || !d.values.includes(v)) continue
      incoming.set(k, v)
    }
    const stale = [...this.written].filter((k) => !incoming.has(k))
    this.written.clear()
    for (const k of incoming.keys()) this.written.add(k)
    // 先广播写过的格，再把"档里没有、这局却写着"的退回缺省：晚一步广播就会让交互物那一侧
    // 在同一帧里看到两套读数。值已经过上面的白名单，直接广播即可（不绕 set 再校验一遍）。
    for (const [k, v] of incoming) bus.emit('world.state', { key: k, value: v })
    for (const k of stale) {
      const d = this.defs.get(k)
      if (d) bus.emit('world.state', { key: k, value: d.default })
    }
  }
}
