import type { QuestData, RegionData } from '@/data/schema'

/**
 * 「修钟之后这一区的天气换掉」（IP_SEED §7 / narrative §9 `STATE.BELLS.*`）这条腿的第二半（KI-094②）。
 * 第一半（KI-094①）已经把画面收到唯一仲裁者并让 `weatherPresets[0]` 有读者；这里补的是**谁把指针拨到 `[1]`**。
 *
 * 判给谁不能靠手写一张"哪个旗标改哪个区的天"的对照表——那种表一落地就开始腐烂。名字册**从既有数据推导**：
 * - **哪些旗标算"世界真的发生了这件事"**：`quests.json > steps[].advanceOn.flags`。任务线本来就靠这些旗标
 *   推进步骤，它们已经是"被登记过的世界事件"的名册，再编一份就是第二份账。
 * - **哪口钟修好算这件事**：`kind === 'bell'` 的交互物里，`setsFlag` 落在这份名册上的那些。
 *   于是"钟 ⇒ 它所在的那一区"由数据自己说（钟站在谁的地上是 `regions.json` 里的位置关系），
 *   不需要任何新字段。
 *
 * 两条今天都成立而**不该被当成判据**的巧合，记在这里免得后人误用：三口被任务线追踪的钟恰好都写着
 * `requiresFlag: 'flag.bells_repair_open'`、`lootTable: 'loot_bell_repair'`。前者是"修得动的闸门"，
 * 后者是掉落表 id——都能在这一批挑出同一组钟，但一个问的是"能不能修"，一个问的是"修完给什么"，
 * 都不是"修好了没有"。真正的判据是**任务线在等这面旗**（`flag.bell_*_repaired` 出现在 `advanceOn.flags` 里）。
 * 反过来那口没被追踪的钟（`bl_fellcarillon_fallenbell` 立的是 `flag.bell_toll_rung`，一次敲响而非修复）
 * 因此**不改天气**——这件事由校验器的 WARN 喊出来，不靠这里的沉默。
 */

/** 任务线用来推进步骤的旗标名册（"世界发生过这件事"的登记处） */
export function questTrackedFlags(quests: readonly QuestData[]): Set<string> {
  const out = new Set<string>()
  for (const q of quests) for (const s of q.steps ?? []) for (const f of s.advanceOn?.flags ?? []) out.add(f)
  return out
}

/**
 * 这一区里"修好之后会拨动天气"的钟所立的旗标。
 * 顺序是 `regions.json` 里交互物的顺序（多口钟时按这个顺序一格一格往上拨）。
 */
export function repairBellFlags(region: RegionData, tracked: ReadonlySet<string>): string[] {
  const flags: string[] = []
  for (const it of region.interactables ?? []) {
    if (it.kind !== 'bell' || typeof it.setsFlag !== 'string') continue
    if (tracked.has(it.setsFlag) && !flags.includes(it.setsFlag)) flags.push(it.setsFlag)
  }
  return flags
}

/**
 * 脚下这一区**当前生效**的天气名；null = 没有区（或那一区没声明天气），仲裁者走基线。
 *
 * `weatherPresets` 是一口钟拨一格：立了 k 面旗就奏第 k 格（超过格数停在最后一格）。
 * 今天每区只有两格，所以实际读数只有 `[0]`（驻留）与 `[1]`（修钟后）；第三格要等谁
 * 给它写读者，不由这里偷偷预留。
 */
export function activeWeather(
  region: RegionData | null,
  hasFlag: (key: string) => boolean,
  tracked: ReadonlySet<string>,
): string | null {
  if (!region) return null
  const presets = region.weatherPresets
  if (!presets.length) return null
  const rung = repairBellFlags(region, tracked).filter(hasFlag).length
  return presets[Math.min(rung, presets.length - 1)]
}
