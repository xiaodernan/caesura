import { msToTicks } from '@/core/Time'
import type { FrameData } from '@/data/schema'

/**
 * §9「冻结攻守双方动画时间」的**攻方**那一半（KI-017 第三步）。
 *
 * 挂在「一次出手」上的三格状态：出手的那一方（玩家的 `action` / 敌人的 `attack`）各自带一份。
 * 与守方的 `stunStopTicks` 不是一回事——那一格按的是"挨打的人硬直倒数不走"，这一格按的是
 * "出手的人招式帧停住"。两者共用同一个时长来源（那一记的 `hitStopMs`），但走两条独立的账。
 */
export interface ActionStop {
  /** 这一式自己的帧时标（与 `FrameData.startup/activeEnd/recovery` 同一时标） */
  tick: number
  /** 还要按住几 tick：按住期间 `tick` 不推进 */
  stopTicks: number
  /** 已经欠下几帧：要在收势之前每 tick 多走一帧还掉，否则这一式就真的迟到了 */
  stopDebt: number
}

/** 停顿与还债都只许出现在窗尾之后。窗内的最后一格是 `activeEnd`，所以第一格能停的是它的下一格。 */
const holdFrom = (f: Pick<FrameData, 'activeEnd'>) => f.activeEnd + 1

/**
 * 把这一记接触按到**出手方**的招式帧上，返回真正按住的 tick 数（0 = 这一记没接上）。
 *
 * 四条判据，缺一不可：
 * 1. **只按"正在出手"的那一方**：判定窗外的 `tick` 意味着这一记已经不归它管了（弹体早就飞出去、
 *    收势已经在走），按停它等于改的是下一记而不是这一记。
 * 2. **一帧都不许落在判定窗之内**——包括停顿和还债的双格步。这条不是审美，是量出来的：
 *    第一版允许窗内按停与窗内补帧（其余判据与现在相同），全量测试当场 5 条腿红在 3 个文件，
 *    读数：奥斯塔拉那记落点迟 83.33ms＝5.0 tick、恩希尔迟 89.86ms＝5.4 tick，而 §2.1 的容差是 50ms。
 *    补帧把**收势**那一 tick 找回来了，迟到的却不是收势，是**窗尾**——按停 H 格就等于把可命中段
 *    在世界时间里拉长 H 格，而玩家背的正是"落点在第几拍"，于是这一格停顿直接把招式改慢了一档。
 *    改成窗尾之后按：`applyActionStop` 只记账，`advanceActionFrames` 在 `tick <= activeEnd` 时照常
 *    每 tick 走一帧，停顿整段落在收势起点。
 * 3. **带连发拍位的招式不按**（`frames.projectile`）：`burst.at` 把每一发钉在招式内部的绝对帧上
 *    （§14.4 三叠箭、§15.2 tutti），而补帧是"每 tick 走两帧"——两发会被挤进同一 tick，
 *    于是这一式**中段**脱拍。收势对上拍位没有用，玩家背的是中间那串间隔。
 *    这条今天在市场上打不到：全表 7 式带弹道的招式近战判定盒都是 `null`，弹体命中又不带
 *    `sourceAction`（判据 1），所以没有一次真实接触会归因到它们头上——变异实测印证了这一点，
 *    拆掉这条豁免只有单位腿红（2 条），flow 一条不动。留着的理由是 `Enemy.tri` 那样的盒子哪天补上，
 *    第一响应该红的是这里，不是 §2.1。
 * 4. **还不起债就不按**：从最早能停的那一格到 `recovery` 共 `recovery − holdFrom` 帧，
 *    H 格停顿要 H 个双格步来还（净 tick 数＝H + (R−2H)/…见下），能装下的上限是
 *    `floor((recovery − holdFrom) / 2)`。收势只比窗晚两三帧的招式（例如错拍步：窗 18、收势 20）
 *    因此一格也按不住；这是数据自己决定的"这一式几乎没有出手方停顿"，不是代码某处写死的例外。
 *
 * 同一式里第二次接触（多目标 `f.multi`、起手式追加的那笔）只把总额**抬到**这一格报的时长，
 * 不在已按住的额度上叠加——与守方 `stunStopTicks` 那条"同一件事取最长的一笔"同一个口径。
 * 否则一记扫到三个人就会把出手方按停 3×7 格，那不再是"这一记的手感"，而是把节奏弄坏。
 */
export function applyActionStop(a: ActionStop, f: FrameData, ms: number): number {
  const want = msToTicks(ms)
  if (want <= 0 || f.projectile) return 0
  if (a.tick < f.activeStart || a.tick > f.activeEnd) return 0
  const room = Math.max(0, Math.floor((f.recovery - holdFrom(f)) / 2))
  const add = Math.min(want, room) - (a.stopTicks + a.stopDebt)
  if (add <= 0) return 0
  a.stopTicks += add
  return add
}

/**
 * 走一 tick 的招式帧，返回这一 tick 推进了几帧：0＝被按住，1＝正常，2＝回拍补帧。
 * 将返回值用于位移缩放，"停住"才真的是停住——否则按住的那几 tick 还在往前蹭，
 * 玩家看到的就是"人定在原地滑行"。
 *
 * 两条不变量（`tests/unit/action-frames.test.ts` 用全数据表逐帧扫）：
 * ① 判定窗在世界时间里**一格不多一格不少**：`tick ∈ [activeStart, activeEnd]` 的 tick 数
 *    恒等于 `activeEnd − activeStart + 1`（判据 2）；
 * ② 净时长不变：`recovery` 仍在**与不按停时同一 tick** 到达——停顿每欠一帧，
 *    窗尾之后就用一个双格步还掉，因此 `stopDebt` 必须在收势走完前清零（判据 4 的配额就是为它设的）。
 */
export function advanceActionFrames(a: ActionStop, f: Pick<FrameData, 'activeEnd' | 'recovery'>): number {
  // 窗内照旧一 tick 一帧：停顿先攒着，等这一式的危险段整段走完再兑现
  if (a.tick <= f.activeEnd) return 1
  if (a.stopTicks > 0) { a.stopTicks--; a.stopDebt++; return 0 }
  if (a.stopDebt > 0) { a.stopDebt--; return 2 }
  return 1
}
