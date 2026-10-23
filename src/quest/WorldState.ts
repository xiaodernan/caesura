import { bus } from '@/core/EventBus'

import type { WorldStateRule } from '@/data/schema'

/**
 * 世界状态的**写入方**（narrative §7 的执行位，Phase 6-A）。
 *
 * 之前 `regions.json` 里被读到的世界旗标（`flag.ostlara_defeated` / `parry_taught` /
 * `echo_cairn_read` / …）**一个写方都没有**：区域与箱子的闸门条件写在了表里，却没有任何代码去立它们，
 * 于是那些藏在门后的内容是不可达的（KI-041）。这一层把"发生了什么 ⇒ 立哪个旗标"从散落布尔
 * 变成一张可审计的规则表（`worldstate.json`）——§7 那句"禁止代码内散落硬编码布尔"要的就是这个。
 *
 * 三条纪律：
 * 1. **只走 `world.flag` 广播**，不自己存旗标。流送层与交互层各自缓存同一个事件源（Phase 6-A 第一步），
 *    所以这里 emit 一次，全世界的读方都看见；这里再存一份就是第三套真值。
 * 2. **幂等**：旗已立就不再动它（`approach` 每 tick 都会被调用，不幂等就会每 tick 播一次报）。
 * 3. **规则表里没有"以后会用到"的旗标**。写进表的每一条都必须已经有读方，
 *    这条由 §55 的数据闸门钉住（`validate:data` 检查 setFlag 是否真被 regions.json 读到）。
 */
export interface WorldStateDeps {
  hasFlag: (key: string) => boolean
  setFlag: (key: string) => void
}

export class WorldState {
  private readonly offs: Array<() => void> = []
  /** 观测用：这一局被这条层立起来的旗标（Quest Debugger / 测试都读它，不作为真值） */
  private readonly written = new Set<string>()

  constructor(
    private readonly rules: readonly WorldStateRule[],
    private readonly deps: WorldStateDeps,
  ) {
    this.offs.push(
      // 第一次成功弹反：音壁的设计前提就是"先学会还拍子"，所以这条不等待对话（§2 的教学即证明）
      bus.on('combat.parried', (p) => {
        if (p.defenderId === 'player') this.apply('firstParry')
      }),
      bus.on('boss.defeated', (p) => {
        this.rules.forEach((r) => {
          if (r.on === 'bossDefeated' && r.dataId === p.dataId) this.fire(r)
        })
      }),
      bus.on('world.interact', (p) => {
        if (!p.ok) return
        this.rules.forEach((r) => {
          if (r.on === 'interactUsed' && r.interactId === p.id) this.fire(r)
        })
      }),
      // 值域落格 ⇒ 派生旗（salt-meg SILENCED ⇒ 收摊旗是第一个读者）。写入口仍是
      // `WorldStates.set` 那一处（它把住 key/value 都在登记表里），这里只听广播——
      // 与旗标那三条同一个纪律：不自己存值域，真值只有一份。
      bus.on('world.state', (p) => {
        this.rules.forEach((r) => {
          if (r.on === 'stateSet' && r.stateKey === p.key && r.stateIn?.includes(p.value)) this.fire(r)
        })
      })
    )
  }

  private apply(on: WorldStateRule['on']): void {
    for (const r of this.rules) if (r.on === on) this.fire(r)
  }

  private fire(r: WorldStateRule): void {
    if (this.deps.hasFlag(r.setFlag)) return // 幂等：立过就不再播一次报
    this.deps.setFlag(r.setFlag)
    this.written.add(r.setFlag)
    if (r.notify) bus.emit('ui.notify', { text: r.notify, kind: 'info' })
    bus.emit('log', { level: 'info', msg: `worldstate ${r.id} -> ${r.setFlag}` })
  }

  /** 反向查询：这个旗标是被哪条规则写的（Quest Debugger 用；没有写方就报出来） */
  writerOf(flag: string): WorldStateRule | null {
    return this.rules.find((r) => r.setFlag === flag) ?? null
  }

  get flagsWritten(): string[] { return [...this.written].sort() }

  dispose(): void { for (const off of this.offs.splice(0)) off() }
}
