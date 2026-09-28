/**
 * music.ts — 极简音乐层（Phase 1）
 *  · ambience：一张**区域声床**（`data/json/ambience.json` = docs §1.2 主音分配 + §4 的 L1 drone / L4 稀疏事件）
 *    + 跨区 8 小节 crossfade（§1.2 转场规则）
 *  · 探索曲（L3 对位旋律）：`data/json/explore.json` = §1.2 那四种变形里能进数据的那几样，跟着声床换（KI-079）
 *  · 战斗层：进入战斗淡入脉冲鼓 + 低音 ostinato（R-1 派生），脱战 4s 淡出
 * 事件驱动：订阅 bus `'audio.music.encounter'`（本文件 declare module 扩展 GameEvents，勿改 EventBus.ts）。
 * `'audio.music.ambience'` 由 `AudioEngine` 订阅并**解析成行**再递进来（KI-077 的落点，见下面那段）。
 *
 * **拍网不是这里的东西**（KI-066）：这一层曾经自带 `const BPM = 84`，于是全场有了两个主人——
 * `RhythmClock` 吃 `regions.json > grid` 与 Boss 的 `overrideTo`，而战斗曲永远按 84/4 演。
 * 结果 docs/audio.md §2.1「音乐重拍与敌人主攻击对齐」在奥斯塔拉（表里 108BPM、3/4，实机量到同一对数）身上是假的。
 * 现在拍长与小节形状由 `setGrid()` 注入（`AudioEngine` 转发 `audio.music.grid`），这里不再留副本。
 *
 * KI-066 管的是**拍长**（间隔），KI-068 补的是**时刻**（那一拍落在什么时候、是第几拍）：入战不再自己猜 `now + 0.1`，
 * 第一拍与"第几拍"都来自 `RhythmClock.barEntry()`（§2.1「≤2 拍内进战斗曲」），由 `CombatManager` 在遭遇事件里带上。
 * 于是"重拍踩在敌人主攻击那一拍"第一次在**入场那一下**成立，而不只是稳态之后两拍对齐。
 *
 * **音高也不是这里的东西**（KI-077）：同一批数字在这里还留着第二份副本——`CHIME_PITCHES` 与 `startDrone()` 里那四条
 * 振荡，而 docs §4 那一行写的是**雾语林**的参数。玩家开局站在休垒（F Lydian），听到的底噪与铃点却永远是 C2/C Dorian，
 * 且 `regions.json > music.ambience` 那 21 个 id 全场零读者。现在这张表的行键进 `ambience.json`（validator 双向对账），
 * 这里只留 `OSTINATO` 那份**属于玩法调性**的 C（§1.1「主音不变、色彩变暗」），其余一律由 `setAmbience()` 换。
 *
 * KI-079 补的是同一句话里剩下的那一半：§1.2 那张表管的是「ambience **与世界音乐层**」，而世界音乐层
 * （探索时那条慢旋律）在这里根本不存在——`regions.json > music.explore` 那 7 个 id 与 KI-077 之前的
 * `music.ambience` 一样，是**指向一张不存在的表的引用**，校验器只看它"是不是字符串"所以永远不红。
 * 现在它有了行（`data/json/explore.json`）、有了读者（下面那段环境层调度）、也终于有了对账。
 * 而动机 `R-1` 的"四种变形"第一次成为可校验的东西：数据只许写 `prime`/`inversion`/`retrograde` 三个词之一，
 * 度数由 `MOTIF_R1` 现推，节奏变形写成 `beatsPerNote`（1/2/0.5）。
 */
import { bus } from '../core/EventBus'
import type { MusicGrid } from '../core/RhythmClock'
import type { AmbienceBed, AmbienceBell, BattleScore, BattleTonal, ExploreForm, ExploreScore } from '../data/schema'
import { playBell, playNoise, playSweep } from './synth'
import { AmbienceField } from './ambient-field'
import type { ListenerPose } from './spatial'

declare module '../core/EventBus' {
  interface GameEvents {
    // 与 src/combat/CombatManager.ts 的发射契约一致：{ start: boolean }
    // `cut`（§16 胜利序列）：start=false 时**立刻**掐掉战斗层，不走脱战那条 4s 淡出
    // `enter`（KI-068，§2.1）：start=true 时带上 `RhythmClock.barEntry()` 的落点（还要等多久 + 第几拍）。
    //   **可选**不是客套：发射侧无状态、每 30 tick 重发，而 `barEntry()` 要查全场钟——`main.ts` 里
    //   `rhythm` 是模块 const、没挂在 `__caesura` 上，所以外部发射（面板、debt 探针、测试）发不出这条。
    //   缺它时音乐层退回旧的 `now + 0.1` 起拍，并把这件事说出口（一次性 warn），而不是假装锁过了。
    'audio.music.encounter': { start: boolean; cut?: boolean; enter?: { waitSec: number; beatIndex: number } }
    /**
     * KI-077（§1.2 + §4）：换环境声床。载荷只有**一个 id**，因为这张表的行属于数据层，
     * 而"哪一行该响"属于组合根——`main.ts` 只管发脚下那一区的 id，id→行 的解析住在 `AudioEngine`
     * （它是"表 + 图"两头都看得见的那一层），解析好的行再注入本层的 `setAmbience()`。
     * 发射方 = `main.ts` 的区域切换那一处 + 开局那一句（开局必须在建图之前发，`AudioEngine` 缓存它）。
     */
    'audio.music.ambience': { id: string }
    /**
     * KI-079（§1.2 世界音乐层）：换探索曲。载荷形状与上面那条**完全一样**（只有 id，解析住在 `AudioEngine`），
     * 发射点也是同一处——`main.ts` 在换区那一格连着发这两条，所以"和声先换、旋律最后"那句话
     * 才在实现层真的有顺序可依（先 `ambience` 后 `explore`：前者开出 crossfade 窗口，后者看见窗口就把名册押后）。
     */
    'audio.music.explore': { id: string }
    /**
     * KI-080（§1.1 + §2.2 的"遭遇层"）：换战斗档。载荷形状与上面两条**完全一样**（只有 id，
     * id→行 的解析住在 `AudioEngine`），发射点也是同一处（`main.ts` 换区那一格连着发三条 + 开局那三条）。
     * 它与 `explore` 的区别在消费侧：那一条响在环境层、跟着 crossfade 窗口走；这一条只会在
     * **交战时**被奏出来，所以它不吃窗口——换行之后下一拍就按新行走，已经排出去的拍一张不抹（KI-066 那条纪律）。
     */
    'audio.music.battle': { id: string }
  }
}

/**
 * 战斗低音**不再抄一份音高**（KI-080）。上面那一串 `OSTINATO` 是这张表里最后一个音高副本：
 * 它把 §1.1「战斗主音不变」写对了一件事（那是全局的 C），却把"低音走哪一条线"写死成了唯一一个答案，
 * 于是 `regions.json > music.battle` 那 5 个 id 从落地那天起就没有读者。现在：
 * **主音留在这里**（`BATTLE_ROOT_HZ`，全局的 C2），**线本身进 `battle.json`**（`pattern` 那一格）。
 */
/** docs §1.2 转场规则：跨区 **8 小节** crossfade。小节长度吃当前网格，所以这里只有格数 */
const XFADE_BARS = 8
/**
 * 没有网格时那 8 小节无从换算。口径**实名**在这里而不是随便猜一个 BPM：1 秒，并且说一次。
 * 这条只在"区域事件比第一次 `audio.music.grid` 还早"那种装配回归里才走得到（实机是反过来的），
 * 所以它存在的意义是让换床这件事**不发生静默**——KI-066 拆掉 `const BPM = 84` 的理由在这格同样成立。
 */
const XFADE_NO_GRID_SEC = 1

/**
 * 动机 `R-1`（docs §1.2 音乐宪法）：遗响四音，主音之上的半音数。**全游戏只有这一处写它**，
 * 三种音高变形都是从它**现推**的（下面的 `motifDegrees`），所以"数据里那条旋律"能指的形状只有三种。
 * 度数为何不进了 `explore.json`：那等于给同一句话两个主人（ KI-074 拆手抄名单拆的正是这种东西）。
 */
export const MOTIF_R1 = [0, 3, 7, 10]

/**
 * 战斗低音的**主音**（docs §1.1「战斗遭遇 = 主音不变、色彩变暗」里那个不变的 C2 = 65.41Hz）。
 *
 * 它与上面那张表的区别正是这一格存在的理由：`rootHz` 属于**区域**（§1.2 一区一个，进 `ambience.json`），
 * 而战斗主音属于**玩法调性系统**（全局主题调），跨区不许变——所以它既不在 `battle.json` 里，
 * 也不跟着喂进来的那张床走（§1.1 那一格写的是"仍在同一个世界，但歌走调了"）。
 * `battle.json` 的每一行只写"这一档走哪几个音级"（见 `schema.ts > BattleTonal.pattern`）。
 */
const BATTLE_ROOT_HZ = 65.41

/** 旋律声部比数据里那个主音高多少个八度：§1.2 给的是**音级**（F/C/G…，与 drone 同音高记录），而 L3 要盖在 L1 之上 */
const MELODY_OCTAVES = 2

/** `R-1` 的一种音高变形 ⇒ 四个半音度数。倒影＝镜像到主音下方，逆行＝原形倒着念 */
export function motifDegrees(form: ExploreForm): number[] {
  if (form === 'inversion') return MOTIF_R1.map((d) => 0 - d)   // 不是 `-d`：那给主音留下 `-0`，而度数是要拿去比对的数
  if (form === 'retrograde') return [...MOTIF_R1].reverse()
  return [...MOTIF_R1]
}

/**
 * `battle.json > pattern` 那一个格子的解码（KI-080）：数据写的是**折起来的一格** ——
 * `动机第几音` 放在低位、`第几档八度` 放在高位，于是"宪法之外的音"在数据里根本没有写法
 * （§1.2 那条音乐宪法在这条腿上的形状版，与 KI-079 那支判别联合同一条纪律）。
 *
 * 步长取 `MOTIF_R1.length` 而不是写死 4：动机的音数是那一格的主人，这里只是用它换算。
 * 代价也要如实说 —— `scripts/battle-rules.mjs > MAX_PATTERN_CELL` 那个上界是按"四音 × 两档"算的，
 * 动机增减一个音就会换意思，所以 `tests/unit/battle-table.test.ts` 有一条把两者对账的用例。
 */
export function battleOstinatoHz(cell: number): number {
  const deg = cell % MOTIF_R1.length
  const oct = Math.floor(cell / MOTIF_R1.length)
  return BATTLE_ROOT_HZ * 2 ** ((MOTIF_R1[deg] + 12 * oct) / 12)
}

export class MusicLayer {
  private ambGain: GainNode
  private battleGain: GainNode
  /**
   * §4 的 L2／L3 声景层（KI-083）：一区的真位置声源。它**不是** KI-077 那条 crossfade 的一部分
   * ——drone 是要淡的持续图，而这一层是"一次一声"的事件：换区只是"下一声属于新区"。
   */
  private field: AmbienceField
  private bassLp: BiquadFilterNode
  /** 此刻在响的那张床：drone 的全部节点（含它自己的层增益），换床时这一组整批淡出后回收 */
  private bedNodes: AudioNode[] = []
  /** 上面那一组的音量把手（crossfade 淡的就是它；`layers: []` 的那一区没有它） */
  private bedGain: GainNode | null = null
  /** 已经在淡出、还没到回收时刻的旧床。窗口没走完又来一次换区时，旧的连同前一批一起埋在这里 */
  private dyingBeds: AudioNode[][] = []
  /** 此刻掷铃用的那一张名册。它比 `bed` **慢一个 crossfade 窗口**：§1.2「旋律层最后」 */
  private bellCfg: AmbienceBell | null = null
  /** 此刻在奏的探索曲（同一句「旋律层最后」，与上面那格同一次兑现；`form: null` 的那一区不奏旋律） */
  private song: ExploreScore | null = null
  /** crossfade 窗口里押后待兑现的那一张曲；`null` = 没有待兑现的换（与 `dyingBeds` 同一类"窗口内的事先记着"） */
  private songPending: ExploreScore | null = null
  /** 下一个旋律音该排在什么时刻（秒）。0 = 还没起音，与战斗层 `nextBeat` 用同一个哨兵形状 */
  private nextNote = 0
  /** 当前这句念到动机里的第几个音（不随小节形状走，所以它是曲自己的位置，不是 `beatIdx`） */
  private noteIdx = 0
  /** 探索曲没有拍网时那一句只说一次：它与战斗层那条、换床那条各是一个主人，共用会把彼此静音 */
  private warnedNoGridSong = false
  /** 换床窗口的终点；`Infinity` = 没有窗口在走（不用 0 当哨兵：假 AudioContext 的 `currentTime` 就从 0 开始） */
  private bedSwapAt = Infinity
  /**
   * 此刻的床。**按对象身份比**："同一张床重发"不动图，靠的是 `data/index.ts` 那一次解析出的是同一个对象
   * （区域事件与 KI-068 那条"重发不许重锚"同一口径）。
   */
  private bed: AmbienceBed | null = null
  /** 没网格时那个 1 秒兜底只说一次；不与战斗侧那条 `warnedNoGrid` 共用，否则谁先说话就把另一个静音了 */
  private warnedNoGridX = false
  /** 「建图了却一张床都没有」只说一次（同一层实例里 `start()` 可能被反复点） */
  private warnedNoBed = false
  private nextBeat = 0
  private beatIdx = 0
  private nextChime = 0
  /**
   * 此刻这一区的战斗档（`battle.json` 的一行）。**没有默认值**（KI-080）：
   * 曾经这里写死过一份 `OSTINATO`，于是 `music.battle` 那 5 个 id 谁也没读，而战斗曲永远只有一条线。
   * `null` = 那条腿没接上 ⇒ 不排拍并说一次（与拍网那一格同一口径）。
   */
  private battle: BattleScore | null = null
  /** 没收到战斗档那一句话只说一次；与"没网格""没落点"那两条各是一个主人，共用会互相静音 */
  private warnedNoBattle = false
  private battleOn = false
  private battleStopAt = 0
  private offEncounter: (() => void) | null = null
  /** 0 = 还没收到网格。收到之前不排拍：这里猜一个 BPM 就是 KI-066 要删掉的那份副本 */
  private bpm = 0
  private beatsPerBar = 0
  private warnedNoGrid = false
  /** KI-068：`enter` 缺席时说一次话，别让它静默退回 `now + 0.1` */
  private warnedNoEnter = false

  constructor(
    private ctx: AudioContext,
    musicOut: AudioNode,
    ambOut: AudioNode,
    grid: MusicGrid | null,
    /** KI-077：开局那一张床（`main.ts` 在建图之前发那条事件、`AudioEngine` 缓存并解析后递进来）。 */
    bed: AmbienceBed | null,
    /** KI-079：开局那一区的探索曲。缓存的理由与上面那一条一字不差（建层比建引擎晚），两支事件在建图之前都发完了 */
    song: ExploreScore | null,
    /** KI-080：开局那一区的战斗档。同一条缓存理由，同一条"没有就是没有"的口径（不排拍并说一次） */
    battle: BattleScore | null
  ) {
    this.setGrid(grid)
    this.ambGain = ctx.createGain()
    this.ambGain.gain.value = 0
    this.ambGain.connect(ambOut)
    // KI-083：声景层与 drone 挂在**同一只** ambGain 上（§8 的混音与 §5.4 的消音对它一并成立）
    this.field = new AmbienceField(ctx, this.ambGain)
    this.battleGain = ctx.createGain()
    this.battleGain.gain.value = 0
    this.battleGain.connect(musicOut)
    this.bassLp = ctx.createBiquadFilter()
    this.bassLp.type = 'lowpass'
    this.bassLp.frequency.value = 320
    this.bassLp.Q.value = 0.7
    this.bassLp.connect(this.battleGain)
    if (bed) {
      this.applyBed(bed, 0) // 开局不 crossfade：还没有旧床可淡，直接建
      this.field.setBed(bed) // KI-083：声景层同样开局就位（少了这句，出生区一条 L2/L3 都不会响）
    }
    if (song) this.applyExplore(song) // 同上：开局那条旋律不需要淡入，第一次 `update()` 就起音
    if (battle) this.setBattle(battle) // 同上：开局那一区的战斗档，第一次交战第一拍就按它走
  }

  /**
   * 换网格只改**下一拍之后**的拍长：已经排进 WebAudio 时间线的拍一张都不抹
   * （抹 = 听觉上的 glitch，而 docs §2.1 要的是"进出只在乐句边界"那种可预期的变化）。
   * 没有落点时 `beatIdx` 也不归零——小节形状变了就让它在新的模上继续走，重排小节头会打断正在演的那一拍。
   *
   * KI-069：带落点的变化（Boss 接管/归还就是这一类）把**尚未排出**的那一拍跟到新网格的头上去，
   * 于是 §2.1「音乐重拍与敌人主攻击对齐」在过渡段也成立，而不只是稳态两拍之后偶然对上。
   * 三个条件是这句话的一部分：①**真的变了**才重锚（同一个网格重发不是变化）；②只在 `battleOn` 时用——
   * 淡出那 4 秒是退场（§16 的胜利序列要听得出来那一下安静），不许被一段新的等待替掉；"战斗层还没起来"
   * 那一半其实由 `update()` 里那道 `scheduling` 门兜着（探针 P3 在这一格不咬、P6 才咬到，见 KI-069 行），
   * 所以这一眼**看得见的效果只有淡出窗口**，别把它写成两条功劳；③已排的拍仍然一张不抹，重锚只动
   * `nextBeat` 这个"下一个要排的"。
   * 代价如实说：lookahead 只有 0.25s，所以过渡那一拍最多与已排出去的最后一记重叠 0.25s 内（一记软撞），
   * 换来的是重拍落在她的拍点上——这是 KI-066"不抹历史"与 §2.1"重拍对齐"之间必须选的一个边界。
   */
  setGrid(grid: MusicGrid | null): void {
    if (!grid) return
    const changed = grid.bpm !== this.bpm || grid.beatsPerBar !== this.beatsPerBar
    this.bpm = grid.bpm
    this.beatsPerBar = grid.beatsPerBar
    if (changed && grid.enter && this.battleOn) {
      const now = this.ctx.currentTime
      this.nextBeat = Math.max(now + grid.enter.waitSec, now + 0.02)
      this.beatIdx = grid.enter.beatIndex
    }
  }

  /**
   * KI-077：换环境声床。§1.2 的转场口径是「跨区 8 小节 crossfade，先淡出旧区节奏层，再淡和声层，旋律层最后」——
   * 本作的环境层没有节奏层（那是战斗曲），所以这里兑现的是后两半：
   * **drone（和声）当场开始交叉淡变，铃点（旋律）等窗口走完再换名册**。
   * 淡变只动"这一床自己的层增益"，已经掷出去的铃一颗不抹（KI-066 同一条纪律：不篡改时间线）。
   *
   * 传进来的是**行**而不是 id（与 `setGrid` 同一个形状：id→行 的解析住在 `AudioEngine`，
   * 因为那里才是"表 + 图"两头都看得见的那一层）。这样这一层可以被喂合成床来验"跟着床走"这件事——
   * 用真表验就等于让实现自证：写死哪一张都可能碰巧对。
   */
  setAmbience(bed: AmbienceBed | null): void {
    if (!bed) return
    /**
     * §4 的 L2／L3（KI-083）**不等窗口**：它们是"一次一声"的事件，不是要淡的图——换区之后下一声
     * 就属于新区。§1.2 那句「旋律层最后」管的是 ambGain 上那些**持续**图（drone 与旋律），
     * 声景层不在那条排序里，所以这里不进 `songPending` 那一族等待。
     */
    this.field.setBed(bed)
    this.applyBed(bed, this.xfadeSec())
  }

  /**
   * 听者位姿（KI-083）：§4 的 L2／L3 要算真位置才谈得上声像，而位姿的唯一主人是
   * `AudioEngine.setListener`（每一帧从 `main.ts` 来）。这里只**转交**、不自己存一份——
   * 存一份就是给同一个数配第二个主人（KI-066 拆掉的正是这一类副本）。
   */
  setListener(pose: ListenerPose): void {
    this.field.setListener(pose)
  }

  /**
   * KI-079：换探索曲。它与 `setAmbience()` 之间**只有一个顺序**要守：§1.2 那句「旋律层最后」。
   * 所以换床开出的那个 crossfade 窗口还没走完时，新的曲**押在 `songPending` 里**，由 `update()` 到点兑现；
   * 没有窗口在走（开局那一张、或者只换曲不换床的装配形状）就当场换——这一格刻意不做"没有旧曲可淡"的判断，
   * 因为押着不动的唯一理由就是"旧区还在淡"，那个理由不在场时押着等于让新区永远等一次不会来的兑现。
   */
  setExplore(song: ExploreScore | null): void {
    if (!song) return
    // "窗口在走"= `bedSwapAt` 是个**有限数**，不是"它比此刻晚"：`Infinity` 是上面那格声明的"没有窗口"哨兵，
    // 拿 `>` 比就会把第一帧之后的每一次换曲都当成窗口内，押进 `songPending` 等一次永远不会来的兑现。
    if (Number.isFinite(this.bedSwapAt)) this.songPending = song
    else this.applyExplore(song)
  }

  private applyExplore(song: ExploreScore): void {
    // **按对象身份比**：同一张曲重发（区域 tick 的噪声、调试面板重复点）一格都不动——
    // 少了这一眼，每次重发都把 `noteIdx` 拽回 0，听感上是乐句永远念不完第一个音。
    // 与 `applyBed()` 里那句"同一张床重发：一次都不动图"是同一口径（KI-077 的读数钉过那一侧）。
    if (song === this.song) return
    this.song = song
    // 换曲 = 从动机第一个音重新开始念（旧曲那一句已经排出去的音一张不抹，与 KI-066 同一条纪律）
    this.noteIdx = 0
    this.nextNote = 0
  }

  /**
   * KI-080：换战斗档。它与上面两条的区别只有一件：**没有窗口可等**。
   * §1.2 那句「旋律层最后」管的是环境总线（`ambGain`）上的东西，而这一行只在交战时被奏出来，
   * 换它不需要淡变——已经在排的那几拍一张不抹（KI-066 的纪律），从下一拍起走新行那条线。
   * 所以 `main.ts` 那一格里它排在 `explore` 之后不影响任何语义：三条事件里只有后两条之间有序可依。
   */
  /**
   * 这里刻意**不写** `applyBed`/`applyExplore` 那句"同一行重发：一次都不动"的挡板。
   * 那两处要挡板是因为换行会建图／归零读数，重发的代价看得见；而这一行只是被存下来、
   * 由下一拍去读——重发与不重发在图上、在 `beatIdx` 上都没有任何差别。
   * 写一道没有可观测差别的守卫就是 §55 说的没人消费的东西，也是 KI-061 登记过的那一类
   * "今天没有证人的保险"（这一句是本批摘掉旧比较、跑全套读数一位不动之后写的，见 §5.9.17 的变异账）。
   */
  setBattle(battle: BattleScore | null): void {
    // `null` = 那条事件压根没到，或者 id 认不出（后一种 `AudioEngine` 已经说过一次）：
    // 保留上一档，别把正在演的战斗层掐掉——与 `setExplore(null)` 同一条"换区失败不许变哑"的口径。
    if (!battle) return
    this.battle = battle
    // ⚠️ 这里**不清** `warnedNoBattle`。今天它其实没有证人：接上行之后 `battle` 再也回不到 `null`
    // （上面那句 `if (!battle) return` 的语义就是"保留上一档"），所以清与不清读不出差别 ——
    // 按 KI-061 的口径这是一处"今天没有证人的保险"，如实登记在这里，而不是补一条把它喂活的断言。
  }

  /** §1.2 那 8 小节有多长：吃当前网格。没有网格时走实名的 1 秒兜底，并且说一次 */
  private xfadeSec(): number {
    if (this.bpm > 0 && this.beatsPerBar > 0) return XFADE_BARS * this.beatsPerBar * this.beatSec
    if (!this.warnedNoGridX) {
      this.warnedNoGridX = true
      bus.emit('log', { level: 'warn', msg: `music: 换声床时还没有拍网，8 小节按 ${XFADE_NO_GRID_SEC}s 兜底（跨区淡变时长不再跟区域走，是装配回归的读数）` })
    }
    return XFADE_NO_GRID_SEC
  }

  private applyBed(bed: AmbienceBed, fadeSec: number): void {
    if (bed === this.bed) return // 同一张床重发：一次都不动图（与 KI-068 的"重发不许重锚"同一口径）
    const now = this.ctx.currentTime
    this.bed = bed
    if (this.bedGain) {
      const g = this.bedGain.gain
      g.cancelScheduledValues(now)
      g.setValueAtTime(g.value, now)
      g.linearRampToValueAtTime(0, now + Math.max(fadeSec, 0.02))
    }
    if (this.bedNodes.length) this.dyingBeds.push(this.bedNodes)
    this.bedNodes = []
    this.bedGain = null
    if (bed.layers.length > 0) this.buildDrone(bed, now, fadeSec)
    // 「旋律层最后」：铃点名册不在这里换，只记下窗口终点，由 `update()` 到点兑现。
    this.bedSwapAt = now + fadeSec
  }

  /**
   * L1 drone：`layers` 里一条振荡 = 一个声部，全部过同一只低通（§4「大提琴式」「只透低频」的落点），
   * 再一起挂进**这一床自己的**层增益——crossfade 淡的就是那只把手，所以换床时已排的铃与别的层都不受影响。
   * 呼吸 LFO 也接在这只把手的 gain 参数上：WebAudio 里"连到 AudioParam 的信号"是加在自动化值之上的，
   * 于是淡入淡出与呼吸可以同时在同一格上成立（旧代码把它接到全局 ambGain，那是"全场一起呼吸"，不是风箱）。
   */
  private buildDrone(bed: AmbienceBed, now: number, fadeSec: number): void {
    const ctx = this.ctx
    const { lpHz, breath } = bed
    if (lpHz === undefined || breath === undefined) {
      // validator 把"有层却没写这两格"判死，所以这里理论上到不了；真到了也不能装没听见
      bus.emit('log', { level: 'warn', msg: `music: 声床 '${bed.id}' 有 drone 层却没写 lpHz/breath，这一区的底噪不起` })
      return
    }
    const gain = ctx.createGain()
    gain.connect(this.ambGain)
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(1, now + Math.max(fadeSec, 0.02))
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = lpHz
    lp.connect(gain)
    const nodes: AudioNode[] = [gain, lp]
    for (const l of bed.layers) {
      const osc = ctx.createOscillator()
      osc.type = l.wave
      osc.frequency.value = l.hz
      osc.detune.value = l.detune
      const g = ctx.createGain()
      g.gain.value = l.peak
      osc.connect(g).connect(lp)
      osc.start(now)
      nodes.push(osc, g)
    }
    const lfo = ctx.createOscillator()
    lfo.frequency.value = breath.hz
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = breath.depth
    lfo.connect(lfoGain).connect(gain.gain)
    lfo.start(now)
    nodes.push(lfo, lfoGain)
    this.bedNodes = nodes
    this.bedGain = gain
  }

  /** 一组节点退役：源停下来、线摘掉（`dispose()` 与换床回收走的是同一只手） */
  private teardown(nodes: AudioNode[]): void {
    for (const n of nodes) {
      if ('stop' in n && typeof (n as OscillatorNode).stop === 'function') {
        try { (n as OscillatorNode).stop() } catch { /* ok */ }
      }
      n.disconnect()
    }
  }

  /** 一拍有多长（秒）；没有网格 = 0，`update` 用它当"能不能排"的门 */
  private get beatSec(): number {
    return this.bpm > 0 ? 60 / this.bpm : 0
  }

  /** 下一颗铃隔多久：在这张床自己那一格 `[最短, 最长]` 里现掷（§4 的 L4 稀疏事件） */
  private chimeGap(): number {
    const e = this.bellCfg?.everySec
    return e ? rnd(e[0], e[1]) : 0
  }

  /**
   * 启动 ambience + 订阅遭遇事件（AudioEngine 建图后调用一次）。
   * KI-077 之后这里**不再建 drone**：底噪是"当前那张声床"的图形，由构造函数（开局那条缓存事件解析出的行）
   * 或 `setAmbience()`（换区）建。这一处只剩下总音量。
   */
  start(): void {
    const now = this.ctx.currentTime
    this.ambGain.gain.setValueAtTime(0, now)
    this.ambGain.gain.linearRampToValueAtTime(0.6, now + 3)
    if (!this.offEncounter) {
      this.offEncounter = bus.on('audio.music.encounter', (p) => this.onEncounter(p.start, p.cut ?? false, p.enter))
    }
    if (!this.bed && !this.warnedNoBed) {
      // 建图时一张床都没收到 = 装配腿断了（开局那句事件在 `main.ts`，缓存这条路也在同一提交里落地）。
      // 静默的没有底噪会被读成"音频坏了"，而真实原因是那条事件没人发或没人解析。
      this.warnedNoBed = true
      bus.emit('log', { level: 'warn', msg: 'music: 没有收到任何环境声床（audio.music.ambience），底噪不起' })
    }
  }

  dispose(): void {
    this.offEncounter?.()
    this.offEncounter = null
    this.teardown(this.bedNodes)
    this.bedNodes = []
    this.bedGain = null
    for (const dead of this.dyingBeds) this.teardown(dead)
    this.dyingBeds = []
    this.bedSwapAt = Infinity
  }

  /** 遭遇事件入口：start=true 淡入战斗层；false 淡出（`cut` ⇒ 立刻切，§16 胜利序列的"音乐停"） */
  onEncounter(start: boolean, cut = false, enter?: { waitSec: number; beatIndex: number }): void {
    const now = this.ctx.currentTime
    const g = this.battleGain.gain
    if (start) {
      if (!this.battleOn) {
        // **上升沿**才取落点（KI-068）。发射侧每 30 tick 就重发一次"还在交战"，若每次都重锚，
        // 战斗曲会每隔半秒跳回小节头——那比 `now + 0.1` 更糟。淡入的 1.2 秒本来就盖住第一小节，
        // 所以等待只推迟起音，不会把入场的声音推到最后。
        if (enter) {
          // 真网格 `waitSec` 不会是 0（`barEntry()` 只在正踩小节头时给 0，而 `now` 也 > 0）；
          // 这一句防的是假网格下"第 0 秒入战"把 `nextBeat` 留成 0 = "还没起拍"那个哨兵（KI-067）。
          this.nextBeat = Math.max(now + enter.waitSec, now + 0.02)
          this.beatIdx = enter.beatIndex
        } else {
          this.nextBeat = now + 0.1
          this.beatIdx = 0
          if (!this.warnedNoEnter) {
            this.warnedNoEnter = true
            bus.emit('log', { level: 'warn', msg: 'music: 入战事件没带落点 enter，第一拍回到旧的 now+0.1（§2.1 的 ≤2 拍对齐没生效）' })
          }
        }
      }
      this.battleOn = true
      this.battleStopAt = 0
      g.cancelScheduledValues(now)
      g.setValueAtTime(g.value, now)
      g.linearRampToValueAtTime(0.9, now + 1.2) // 淡入。拍长跟网格（KI-066），第一拍的时刻与拍号吃 `barEntry()`（KI-068）
    } else if (cut) {
      // §16「音乐停=世界屏息」：0.5s 的安静要被听得出来，所以这里没有渐变的余地。
      this.battleOn = false
      this.battleStopAt = 0
      this.nextBeat = 0
      g.cancelScheduledValues(now)
      g.setValueAtTime(0, now)
    } else if (this.battleOn) {
      this.battleOn = false
      this.battleStopAt = now + 4
      g.cancelScheduledValues(now)
      g.setValueAtTime(g.value, now)
      g.linearRampToValueAtTime(0, now + 4)     // 脱战 4s 淡出
    }
  }

  /** 每帧调用（AudioEngine.update 驱动）：lookahead 调度，节点即用即弃 */
  update(): void {
    const now = this.ctx.currentTime
    /**
     * KI-077：换床窗口的**兑现处**。放在最前面、且在战斗层那道 `scheduling` 门之外，
     * 因为这一件事与"有没有在打仗"无关——§1.2 的转场是环境层自己的规则。
     * 到点做两件：回收已经淡完的旧床（不回收就是每跨一次区漏一组振荡器，KI-071 那本账），
     * 然后把铃点名册换成新床的——这就是「旋律层最后」那半句。
     */
    if (now >= this.bedSwapAt) {
      for (const dead of this.dyingBeds) this.teardown(dead)
      this.dyingBeds = []
      this.bedSwapAt = Infinity
      this.bellCfg = this.bed?.bell ?? null
      // 窗口一关就按新床的间隔重掷下一颗：旧床那颗在飞的铃不抹，但"下一颗隔多久"从此属于新区域
      this.nextChime = this.bellCfg ? now + this.chimeGap() : Infinity
      /**
       * KI-079：同一句「旋律层最后」的第二半——探索曲与铃点**在同一次兑现里**换名册（它们是同一层，
       * 分两次换就是"旋律"有了两个时刻）。押着的那张不存在时一句都不做：换床不等于换曲。
       */
      if (this.songPending) {
        this.applyExplore(this.songPending)
        this.songPending = null
      }
    }
    /**
     * KI-083：§4 的 L2／L3 声景层。它排在战斗层那道 `scheduling` 门**之外**——声景不是战斗音乐，
     * 打不打都一样响（与换床窗口同一条理由：那两件事都与"有没有在打仗"无关）。
     */
    this.field.update()
    // 音色石铃：docs §4 的 L4 稀疏事件。间隔/音高/亮度/锤感全部来自当前那张床（KI-077）；
    // `bell: null` 的那一区（无耳深窖）这里一道门就安静下来——那是设计，不是漏配。
    if (this.bellCfg && now >= this.nextChime) {
      const cfg = this.bellCfg
      const f = cfg.scale[Math.floor(Math.random() * cfg.scale.length)]
      playBell(this.ctx, this.ambGain, now + 0.02, f, {
        dur: rnd(3.5, 6),
        peak: rnd(cfg.peak[0], cfg.peak[1]),
        hammer: Math.random() < cfg.hammerP
      })
      this.nextChime = now + this.chimeGap()
    }
    /**
     * KI-079：L3 对位旋律（§1.2「世界音乐层」那一半）。一个音 = `beatsPerNote` 拍，
     * 音高 = 这一区主音抬 `MELODY_OCTAVES` 个八度之后、按 `form` 现推出的 `R-1` 度数（§1.2 音乐宪法）。
     * 挂在 `ambGain` 上与铃点同一只总线，所以 §5.4 的消音与 §8 的混音规则对它一律成立。
     *
     * 每帧最多排**一个**音，而不是像战斗层那样 `while` 补排：调度一落后（KI-067 量过的那种标签页节流，
     * 真实读数是一帧 28 拍），"把欠的拍补回来"在这里听感上是把过去十秒的旋律砸进现在这一帧。
     * 探索曲不是机制（没有拍点要对齐），所以代价是"一串音被跳过"，这是这一层付得起的。
     */
    const song = this.song
    if (song && song.form !== null) {
      if (this.beatSec === 0) {
        // 与战斗层那条同一口径：没有拍网就一个音都不排，并且说一次。铃点不吃网格（它按秒掷），
        // 所以"底噪在响、铃在响、却没有旋律"这一格要单独讲出来，才读得懂是装配断了而不是设计如此。
        if (!this.warnedNoGridSong) {
          this.warnedNoGridSong = true
          bus.emit('log', { level: 'warn', msg: 'music: 没收到拍网（audio.music.grid），探索曲不起音（铃点不受影响，它按秒掷）' })
        }
      } else if (now >= this.nextNote) {
        const step = song.beatsPerNote * this.beatSec
        const degrees = motifDegrees(song.form)
        const semi = degrees[this.noteIdx % degrees.length]
        const t = Math.max(this.nextNote, now + 0.02)
        playSweep(this.ctx, this.ambGain, t, {
          f0: song.rootHz * 2 ** ((MELODY_OCTAVES * 12 + semi) / 12),
          dur: step,
          peak: song.peak,
          type: song.wave,
        })
        // 从**这次真正排出去的时刻**往前走，不是从 `nextNote` 加：后者在被跳过之后会一直欠着（见上面那段代价）
        this.nextNote = t + step
        this.noteIdx++
      }
    }
    // 战斗层调度
    const scheduling = this.battleOn || (this.battleStopAt > 0 && now < this.battleStopAt)
    if (!scheduling) return
    if (this.beatSec === 0) {
      // 没有网格就一声都不排，并且**说出来**：静悄悄地没有战斗音乐会被读成"引擎坏了"，
      // 而真实原因是 RhythmClock 的 `audio.music.grid` 没接到这一层（装配腿回归时第一时间要看得见）。
      if (!this.warnedNoGrid) {
        this.warnedNoGrid = true
        bus.emit('log', { level: 'warn', msg: 'music: 没收到拍网（audio.music.grid），战斗层不排拍' })
      }
      return
    }
    /**
     * KI-080：这一档的两个"没有声音"必须分得开，所以这里是两道门而不是一个判断：
     *  · `battle === null` ⇒ **装配缺了一条腿**（区域 id 打错 / 表少一行 / `AudioEngine` 那条订阅断了）。
     *    一声都不排，并且说一句——静悄悄地没有战斗音乐会被读成"引擎坏了"，而它正是这个意思。
     *  · `noMusic: true` ⇒ **数据说的安静**（§6.3 万籁「本 Boss 无配乐」）。一声都不排，也**不说**：
     *    那不是故障。增益仍然淡入淡出，所以 §16 那句"音乐停"在这一区本来就无话可说。
     * 两道门都排在 `while` 之前：`beatIdx` 是不走的，于是接上行之后的第一拍就是那条线的第一个音，
     * 而不是"断掉那一段被跳过的拍"欠下来的位置。
     */
    const row = this.battle
    if (row === null) {
      if (!this.warnedNoBattle) {
        this.warnedNoBattle = true
        bus.emit('log', { level: 'warn', msg: 'music: 没收到战斗档（audio.music.battle → battle.json 那一行），战斗层不排拍' })
      }
      return
    }
    if ('noMusic' in row) return
    if (this.nextBeat === 0) this.nextBeat = now + 0.05
    /**
     * KI-067：落后超过**一拍**时重新锚定，不补排欠账。下面那道 `while` 的循环条件是
     * `nextBeat < now + 0.25`，而每次排出去的时刻都被 `Math.max(nextBeat, now + 0.02)` 抬到"现在"——
     * 于是 `update()` 一旦长时间没跑（标签页被切走、后台节流：rAF 停了而 WebAudio 钟照走），
     * 回来那一帧会把整段欠账砸在同一个时刻。这不是推演：实机晾 22 秒之后读到 **31 拍全落在
     * `ctx.currentTime = 53.372`**，听感等价于一记机枪（headless 同一形状的复现是一帧 28 拍）。
     *
     * 门限为什么是「一拍」而不是「N 秒」：落后不到一拍本来就在这道循环的**吸收范围**里
     * （它一轮最多排 `ceil(0.25/拍长)+1` 个，一次卡顿该补的拍要补上，不然掉拍是听得出来的）；
     * 超过一拍就说明这段时间根本没在演，补排等于把历史砸进现在。
     * 这条边界有对照用例钉着，而**能**钉住它的只有"整程按 0.5s 一帧"那个世界：一记 0.3s 的轻 hitch
     * 够不到门限边上（循环每轮都把 `nextBeat` 抬到 `now+0.25` 之外），所以把门限写成 `> 0`
     * 在轻 hitch 里读数完全一样 —— 这是变异探针 P2 第一次不咬时量出来的（见 §5.9.10）。
     */
    const behind = now - this.nextBeat
    if (behind > this.beatSec) {
      this.nextBeat = now + 0.05
      bus.emit('log', { level: 'warn', msg: `music: 调度落后 ${behind.toFixed(2)}s，跳过 ${Math.round(behind / this.beatSec)} 拍重新锚定（不补排欠账）` })
    }
    while (this.nextBeat < now + 0.25 && (!this.battleStopAt || this.nextBeat < this.battleStopAt)) {
      this.scheduleBeat(Math.max(this.nextBeat, now + 0.02), this.beatIdx, row)
      this.nextBeat += this.beatSec
      this.beatIdx++
    }
    // 这里原有四行"淡出到点把 battleStopAt/nextBeat 归零"，被 KI-065 的覆盖率读数证明永远跑不到：
    // 上面那句 `scheduling` 要求 `now < battleStopAt` 才会往下走，而那段的前提是 `now >= battleStopAt`。
  }

  /**
   * 脉冲鼓 + ostinato：鼓点按**当前网格的小节形状**走（区域 4/4、奥斯塔拉 3/4）。
   * 第 1、3 拍驼鼓，其余拍军鼓边击 —— 4/4 下就是原来的 1/3 驼鼓、2/4 军鼓；
   * 3/4 下成为"咚-哒-咚"的玛祖卡低音（§6.1 的弹反重拍落在第 1 拍）。
   *
   * KI-080：低音那条线与钟的周期由调用方把**那一行**递进来（`update()` 里那两道门已经判过"没有行"
   * 与 `noMusic`，这里再问一次就是到不了的一行 —— KI-065 用覆盖率读数拆过的那类"到不了的守卫"）。
   * 鼓型（哪几拍驼鼓）与各家峰值仍留在代码里：五档真数据在那一格全同，写成字段就是一列没有信息量的数据。
   */
  private scheduleBeat(t: number, i: number, row: BattleTonal): void {
    const ctx = this.ctx
    const pos = i % this.beatsPerBar
    const kick = pos === 0 || pos === 2
    if (kick) {
      playSweep(ctx, this.battleGain, t, { f0: 150, f1: 46, dur: 0.28, peak: 0.42 }) // 驼鼓
      playNoise(ctx, this.battleGain, t, { type: 'lowpass', f0: 300, decay: 0.02, peak: 0.2 })
    } else {
      playNoise(ctx, this.battleGain, t, { type: 'highpass', f0: 1400, decay: 0.08, peak: 0.09 }) // 军鼓/边击
      playSweep(ctx, this.battleGain, t, { f0: 200, f1: 170, dur: 0.05, peak: 0.12 })
    }
    // 低音 ostinato（八分推进感：每拍 + 反拍短音）：这一行走到哪一音 = `拍号 % 行长`
    const root = battleOstinatoHz(row.pattern[i % row.pattern.length])
    playSweep(ctx, this.bassLp, t, { f0: root, dur: 0.22, peak: 0.24, type: 'sawtooth' })
    playSweep(ctx, this.bassLp, t + this.beatSec * 0.5, { f0: root * 2, dur: 0.1, peak: 0.08, type: 'sawtooth' })
    // 钟的 accent：周期 = 那一档写的"每隔几小节"× 当前网格的小节长度（所以 3/4 下它跟着变，不是固定 8 拍）
    if (i % (row.bellEveryBars * this.beatsPerBar) === 0) playBell(ctx, this.battleGain, t, BATTLE_ROOT_HZ * 4, { dur: 2.4, peak: 0.06, hammer: false })
  }
}

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a)
}
