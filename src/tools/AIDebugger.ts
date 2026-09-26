import { attackSlotKey, type Enemy } from '@/ai/Enemy'
import type { Vec3 } from '@/combat/EntityStats'

/**
 * F4 · AI 决策路径面板（需求 §54 那一格）。
 *
 * **这块面板给的不是行为树。** §56 的规划里那格写的是「行为树执行路径高亮（ASCII 树）/blackboard/
 * 感知射线可视化」，而本作的敌人从来不是一个 BT：KI-056 的对账表里，"自研 TS 行为树"登记为
 * "换了载体"——实际形状是一台**状态机 + 排招器**（`Enemy.update` 的 `state` 分支，选招由
 * 距离带 × 冷却 × 拍位插槽三者取交集）。画一棵假的树比不画更糟：那会让下一个读代码的人去树里
 * 找不存在的东西。所以这里给的是那三件事的**输入读数**，它回答的是同一个问题——"它为什么这么做"。
 *
 * 面板只看离玩家最近的那一只（多只同距离时按 id 稳定取第一只），因为"决策"是一次一只的事；
 * 全场概览是 F1 的活。
 *
 * 这里唯一从 AI 模块值导入的东西是 `attackSlotKey`：插槽键是"这一拍被谁占了"的口径本身，
 * 面板自己拼一遍就会出现"读的串从来不是领用的串"这种看着齐全、实际全错的读数。
 */
export interface AiDebugGrid {
  owner: 'region' | 'boss'
  bpm: number
  beatsPerBar: number
  bar: number
  beatInBar: number
  tick: number
}

export interface AiDebugInput {
  target: Enemy | null
  player: Vec3
  grid: AiDebugGrid
  /** 当前这一拍（`bar:beatInBar:招式拍`，见 `attackSlotKey`）上已被领用的插槽名册（`AISystem.slotTaken` 的**只读**镜像：面板绝不去领用槽位，
   *  否则"看一眼"就能把 Boss 的一招吃掉）。 */
  armedSlots: readonly string[]
}

function fmtVec(v: Vec3): string {
  return `${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)}`
}

export function aiPanelText(input: AiDebugInput): string {
  const e = input.target
  if (!e) return 'no enemy on the field'
  const g = input.grid
  const a = e.data.ai
  const dist = Math.hypot(e.pos.x - input.player.x, e.pos.z - input.player.z)
  const band = a.distBands.find((b) => dist >= b.min && dist <= b.max)
  // "这一带会做什么"里的名字有两类：**招式**（能在 `attacks` 里查到）与**走位动词**
  // （'chase'/'backstep'/'hold'，不在招式表里）。用数据本身分辨，不从 AI 模块抄一份名单——
  // 抄来就是第二个主人，而 F4 是一块面板，不该变成选招逻辑的读者。
  const move = (id: string): boolean => !e.data.attacks.some((atk) => atk.id === id)
  // 距离带是**作者写的名单**，阶段白名单再削一次（§15.1「这一阶她会什么」）。两行都给：
  // 只给交集的话，"表里明明有这一招，面板却说没有"会变成每天要回答一次的问题。
  const inBand = band?.actions ?? []
  const allowed = e.phaseActions(inBand)
  const usable = allowed.filter((x) => !move(x))
  const cd = (id: string): string => {
    const left = (e.cooldowns.get(id) ?? 0) - g.tick
    return left > 0 ? `${left}t` : 'ready'
  }
  const spec = usable.length ? e.data.attacks.find((x) => x.id === usable[0]) : undefined
  // 键的格式不自编：`Enemy.attackSlotKey` 是它的主人（领用方与读数方必须是同一个串）
  const wantKey = spec ? attackSlotKey(g.bar, g.beatInBar, spec.beat[0]) : null
  const out: string[] = [
    `target ${e.id} · ${e.data.nameKey} (${e.data.archetype})`,
    `state  ${e.state} +${e.stateTick}t  alert ${e.alertness.toFixed(0)}  dist ${dist.toFixed(2)}m`,
    `memory home ${fmtVec(e.home)}  lastKnown ${fmtVec(e.lastKnown)}  investigateTick ${e.investigateTick}`,
    `senses vision ${a.vision.range}m/${a.vision.fovDeg}deg  hearing ${a.hearing.range}m  vibration ${a.vibration.range}m  deaf ${e.deaf ? `yes(${e.deafTicks}t)` : 'no'}`,
    `grid   ${g.owner} ${g.bpm}bpm ${g.beatsPerBar}/bar  bar ${g.bar} beat ${g.beatInBar}  tick ${g.tick}`,
    `pick   band ${band ? `${band.min}-${band.max}m` : 'none'} -> [${inBand.join(' ')}]`,
    ...(allowed.length === inBand.length ? [] : [`       phase-only [${allowed.join(' ')}]`]),
    `       cooldowns ${usable.length ? usable.map((x) => `${x}:${cd(x)}`).join(' ') : '(none usable)'}`,
    `slot   want ${wantKey ?? '(no attack in band)'}  armed ${input.armedSlots.length ? `[${input.armedSlots.join(' ')}]` : '(none)'}`,
    `       onGrid ${spec ? spec.onGrid !== false : '—'}  beat ${spec ? spec.beat.join('/') : '—'}`,
  ]
  if (e.attack) {
    const f = e.attack.spec.frames
    out.push(`doing  ${e.attack.spec.id} tick ${e.attack.tick}  startup ${f.startup} window ${f.activeStart}-${f.activeEnd} recovery ${f.recovery}  shots ${e.attack.shots}`)
  }
  if (e.isBoss) {
    const bells = e.bellsRung.length ? ` bells ${e.bellsRung.map((b) => (b ? 'RUNG' : 'up')).join(',')}` : ''
    const steal = e.stealBeat
      ? ` stealBeat drift±${(e.stealBeat.bpmDrift * 100).toFixed(0)}%/${e.stealBeat.reDriftEveryTicks}t` +
        ` sta x${e.stealBeat.staRegenMul}${e.stealNeutralTicks > 0 ? ` (neutral ${e.stealNeutralTicks}t)` : ''}`
      : ''
    out.push(`boss   phase ${e.bossPhase + 1}  clock ${e.clockBpm ?? g.bpm}/${e.clockBeatsPerBar}  shell ${e.shellUp ? 'up' : 'down'}${bells}${steal}`)
  }
  if (e.buff) out.push(`tuned  from ${e.buff.fromId}: speed x${e.buff.attackSpeedMul} dmg x${e.buff.dmgMul}`)
  const held: string[] = []
  if (e.stunTicks > 0) held.push(`stun ${e.stunTicks}t`)
  if (e.stunStopTicks > 0) held.push(`hitstop ${e.stunStopTicks}t`)
  if (e.frozenTicks > 0) held.push(`frozen ${e.frozenTicks}t`)
  if (e.intangible) held.push('phase-gap (intangible)')
  if (e.revealTicks > 0) held.push(`revealed ${e.revealTicks}t`)
  if (held.length) out.push(`held   ${held.join('  ')}`)
  return out.join('\n')
}
