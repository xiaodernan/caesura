import { bus } from '@/core/EventBus'
import { registry } from '@/core/Registry'
import type { EnemyData, ItemData, MovesetData, WeaponData } from '@/data/schema'
import type { LootGrant } from './Loot'
import type { PlayerMods, RpgRuntime } from './Runtime'
import type { SkillAction } from './Movements'

/**
 * 击杀结算（需求 §59 的 Loot 拍 + §45 的检查点触发）。
 *
 * 这一段编排此前只写在 `main.ts` 里，于是 §59 那条「击杀 → 掉落 → 升级 → 存档」的自动化闭环
 * 只能绕过它、直接调 `rpg.onEnemyKilled(...)`——**胶水本身没有测试**：漏掉 `refresh()` 或漏掉
 * 检查点，测试照样绿。搬到逻辑层就是为了让它能被真通道跑一遍（G5 验收①）。
 *
 * 它不认识玩家实例也不认识存档类：派生值怎么灌回面板、什么时候落盘，都由组合根以两个函数注入。
 */
export interface SettlementDeps {
  rpg: RpgRuntime
  /** 组合根：`rpg.mods()` → 玩家面板 / 谱册 / HUD（只有它认识表现层） */
  refresh: () => void
  /** 存档时机：`'levelup'` 是 §71 的检查点之一 */
  checkpoint: (reason: string) => void
}

/** `refreshPlayer` 需要的最小玩家接口：结构性地由 PlayerController 满足，这里不 import 它（§56 分层） */
export interface ModsSink {
  readonly weapon: WeaponData
  applyRpg(m: PlayerMods): void
  setSkills(skills: Record<string, SkillAction>): void
  equip(weapon: WeaponData, moveset: MovesetData): void
}

/**
 * 组合根的 refresh 本体（从 main.ts 搬进来）。
 *
 * 之前"把 mods() 灌回玩家 + 按装备栏换手里那把武器"只存在于 main.ts，于是 flow 测试里换完装备
 * 都得手写一遍 `player.applyRpg(rpg.mods())`——**测试自己复刻了一遍生产胶水**，那就测不到胶水写错。
 * 现在生产与测试调的是同一个函数：装备栏换成枪，手里就必须是枪。
 */
export function refreshPlayer(rpg: RpgRuntime, player: ModsSink): void {
  const m = rpg.mods()
  player.applyRpg(m)
  player.setSkills(rpg.skillLoadout()) // §7 谱册换了（点亮/升级/换装/读档）⇒ 手里的两式要跟着换
  if (m.weaponId && m.weaponId !== player.weapon.id && registry.has(m.weaponId)) {
    const w = registry.get<WeaponData>(m.weaponId)
    player.equip(w, registry.get<MovesetData>(`moveset:${w.movesetId}`))
  }
}

/**
 * 开一张掉落表（遗箱 / 采集点 / 隐藏房奖励）：给完就播报 + 灌回面板。
 * 交互物的返回值里只有 `lootTable` 这个字符串，落到背包这一步是这里做的——G5① 要求
 * 「拾取」这一拍也走逻辑层的真通道，而不是 main.ts 里的一行匿名代码。
 */
export function openLootTable(deps: SettlementDeps, tableId: string): LootGrant[] {
  const grants = deps.rpg.loot.grant(tableId)
  reportGrants(grants)
  deps.refresh()
  return grants
}

/** 掉落播报：一件一行，保底件单独说一声（"保底"本身就是给玩家的信息） */
export function reportGrants(grants: LootGrant[]): void {
  for (const g of grants) {
    if (g.type === 'xp') continue // 遗响单独播（升级时才有意义）
    const suffix = g.count > 1 ? ` ×${g.count}` : ''
    bus.emit('ui.notify', { text: `${g.pity ? '保底 · ' : ''}获得 ${g.name}${suffix}`, kind: g.pity ? 'boss' : 'reward' })
  }
}

/**
 * 组合根用的「一次给一笔掉落」：播报 + 灌回面板。
 * 刻意做成同步返回——调用方（交互物落地）需要知道"这一笔给了什么"才能决定要不要再播报别的。
 */

export class KillSettlement {
  private readonly off: () => void

  constructor(private deps: SettlementDeps) {
    this.off = bus.on('entity.died', (p) => this.onDied(p.dataId, p.position))
  }

  dispose(): void { this.off() }

  private onDied(dataId: string | undefined, pos: { x: number; y: number; z: number }): void {
    if (!dataId) return
    const enemy = registry.maybeGet<EnemyData>(dataId)
    if (!enemy) return // 不是敌人（交互物/机关也会发 entity.died）
    const { rpg, refresh, checkpoint } = this.deps
    const beforeRank = rpg.prog.rank
    const grants = rpg.onEnemyKilled(enemy)
    const xp = grants.filter((g) => g.type === 'xp').reduce((s, g) => s + g.count, 0)
    reportGrants(grants)
    refresh()
    if (xp > 0) bus.emit('ui.notify', { text: `遗响 +${xp}`, kind: 'info' })
    if (rpg.prog.rank > beforeRank) {
      bus.emit('audio.sfx', { key: 'ui_select', pos: { ...pos }, gain: 0.9 }) // UI 音不空间化（AudioEngine 直入 ui 总线）
      bus.emit('ui.notify', { text: `音级 ${rpg.prog.rank} · 音级点 +${rpg.prog.rank - beforeRank}`, kind: 'boss' })
      for (let r = beforeRank + 1; r <= rpg.prog.rank; r++) {
        const ms = rpg.prog.milestoneAt(r)
        if (ms) bus.emit('ui.notify', { text: `音级 ${r}：${ms.label}`, kind: 'reward' })
      }
      checkpoint('levelup')
    }
  }
}

/** 装备/换装的播报名（带强化等级）：组合根与面板共用一份，避免两处各拼一次 */
export function gearLabel(rpg: RpgRuntime, uid: string): string {
  const g = rpg.inv.gearByUid(uid)
  if (!g) return uid
  const item = registry.get<ItemData>(g.itemId)
  return g.level > 0 ? `${item.displayName} +${g.level}` : item.displayName
}
