import type { QuestData } from '@/data/schema'

/**
 * F3 · 任务与世界旗标面板（需求 §54 那一格）。
 *
 * 规划里这格还写着「world flags **编辑器**」——**这里只有读，没有写**。手动立旗等于在运行时
 * 伪造世界状态，而本作的世界状态有唯一主人（`quest/WorldState.ts` 的规则表 + 交互物的
 * `setsFlag`），给它开一个旁路写入口正是 §55/§78 一路在躲的那种"看起来方便、实际上造谎"。
 * 需要复现某个进度就用存档，不是用调试器改内存。
 *
 * 面板因此回答的是三个"有没有人对得上"的问题：这条线走到第几步、哪些旗标立着、
 * **这些旗标是谁立的**（`worldstate.json` 的规则 vs 交互物 vs 还没写方的欠账）。
 */
export interface QuestRow {
  id: string
  /** 表里那一步的 state 串（对话条件与 `advanceOn` 都按它匹配，所以面板印的是它，不是中文名） */
  state: string
  step: number
  steps: number
  label: string
  /** 末步的 advanceOn 已命中（停在末步 ≠ 做完了，判据与 `Quests.isComplete` 同源） */
  done: boolean
  /** 下一步等哪些旗标 / 哪一格值域（没写＝这条线的后续步还没落表，面板要能看出这件事） */
  waits: string
}

/** `Quests` 上本面板要读的那几格——按接口取，面板不 import 任务运行时 */
export interface QuestReader {
  stepIndex(id: string): number
  isComplete(id: string): boolean
}

export function questRows(quests: readonly QuestData[], reader: QuestReader): QuestRow[] {
  return quests.map((q) => {
    const step = reader.stepIndex(q.id)
    const cur = step >= 0 ? q.steps[step] : undefined
    const next = cur?.advanceOn
    return {
      id: q.id,
      state: cur?.state ?? '—',
      step,
      steps: q.steps.length,
      label: cur?.label ?? q.displayName,
      done: reader.isComplete(q.id),
      waits: cur ? (waitsText(next) ?? '(no advanceOn)') : '(not started)',
    }
  })
}

/**
 * 把 `advanceOn` 翻成人看得懂的一行。旗标与值域**并排印**而不是二选一：
 * 一步可以同时等"某面旗立起来"与"某一格落进这几个取值"，只印一个会让另一个读数凭空消失。
 */
function waitsText(a: { flags?: string[]; state?: { key: string; in: string[] } } | undefined): string | null {
  if (!a) return null
  const parts: string[] = []
  if (a.flags?.length) parts.push(a.flags.join('|'))
  if (a.state) parts.push(`${a.state.key} in ${a.state.in.join('/')}`)
  return parts.length ? parts.join(' + ') : null
}

export interface WorldFlagRows {
  /** 流送层认账的旗标（交互/战斗/世界状态三条写入路的共同终点） */
  flags: readonly string[]
  /** 其中由 `worldstate.json` 规则立起来的那些 */
  byRules: readonly string[]
  /** 一次性交互物里已"用过了"的那些（与旗标分开：用过不一定立旗，立旗不一定用过） */
  used: readonly string[]
  relations: Readonly<Record<string, number>>
  /** 被写过的值域状态格（`state.*`；空表 = 一个抉择都还没做过） */
  states?: Readonly<Record<string, string>>
}

export function questPanelText(rows: readonly QuestRow[], world: WorldFlagRows): string {
  const out: string[] = []
  out.push('— quests —')
  out.push(rows.length
    ? rows.map((r) => `${r.id.padEnd(14)} ${`${r.step + 1}/${r.steps}`.padStart(5)}  ${r.done ? '[done]' : '      '} ${r.state.padEnd(24)} ${r.label}  next: ${r.waits}`).join('\n')
    : '(no quests in the table)')
  const rel = Object.entries(world.relations).filter(([, v]) => v !== 0)
  out.push(`— world —\nflags ${world.flags.length ? world.flags.join(', ') : '(none)'}`)
  if (world.byRules.length) out.push(`  by worldstate rules: ${world.byRules.join(', ')}`)
  out.push(`used interactables ${world.used.length ? `${world.used.length}: ${world.used.slice(0, 12).join(', ')}${world.used.length > 12 ? ' …' : ''}` : '(none)'}`)
  const st = Object.entries(world.states ?? {})
  out.push(`states ${st.length ? st.map(([k, v]) => `${k}=${v}`).join(', ') : '(all default)'}`)
  if (rel.length) out.push(`relations: ${rel.map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join(' · ')}`)
  return out.join('\n')
}
