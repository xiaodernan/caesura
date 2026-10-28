import type { RegionMusic } from '@/data/schema'
import { evalCondition } from '@/world/SpawnDirector'

/**
 * 「这一区此刻该装哪一张环境声床」（§2.3 盐歌人声垫片 / §2.4 断弦更鼓）——KI-341 把这道选择
 * 从组合根的 `if` 交回数据：读的是 `regions.json > music.ambienceVariants`，一行一条变体。
 *
 * **为什么必须是数据**：同一面旗有三个载体——陈设（`requiresFlag`／`absentFlag`）、规则表（`setFlag`）、
 * 耳朵（选床那一路）。前两个住表里，被 `collectFlagUsage` 的双向对账看着；第三个手抄在 `src/main.ts`
 * 的字符串字面量里，而量具读的是数据 ⇒ 表里把旗改了名，代码里那一句就永远读到 false：垫片不响、
 * 更鼓不响，五道门全绿。KI-322 ③ 记的正是这一格。挪进数据之后，旗名只剩一个主人，改名两边一起红。
 *
 * **条件语言不另立一台机器**：`condition` 与刷怪闸门共用 `SpawnDirector > evalCondition`
 * （`flag.x`／`!flag.x`／`state.K==V`／`state.K!=V`，`&&` 连接）。没有状态读方时那一形为假，
 * 与"宁可少刷，不可刷错"同一条取向：宁可不换床，也不换错一张。
 */
export function ambienceBedFor(music: RegionMusic, hasFlag: (key: string) => boolean, stateOf?: (key: string) => string | null): string {
  // 次序就是优先级（schema 里 `ambienceVariants` 那条注释钉的是同一句话）：第一条成立的赢，后面的不再看
  for (const v of music.ambienceVariants ?? []) {
    if (evalCondition(v.condition, hasFlag, stateOf)) return `${music.ambience}_${v.suffix}`
  }
  return music.ambience
}
