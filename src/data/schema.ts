/** All timing in logic ticks (1 tick = 1/60 s). See docs/technical-architecture.md §3. */

import type { ActionName } from '@/core/Input'

export interface HitboxCone { shape: 'cone'; angleDeg: number; radius: number; height: number; offsetY: number }
export interface HitboxSphere { shape: 'sphere'; radius: number; offsetY: number; offsetFwd: number }
/**
 * §15.1 P3「落点震波外环 20 / 内环 36」：同一记落点，离爆心越近吃得越狠。
 * `outer` 是这一档的外沿（米，从爆心的水平距离量，与 `shapeHits` 的 ring 用同一把尺子）。
 * 伤害档位的主人在 `FrameData.bands`，这里是形状那一半。
 */
export interface DamageBand { outer: number; damage: number }
export interface HitboxRing { shape: 'ring'; inner: number; outer: number; forward: number }
export type Hitbox = HitboxCone | HitboxSphere | HitboxRing

export interface CancelRule { to: string; fromTick: number }

/**
 * 连发（combat.md §14.4 针喉「三叠箭」）：count 发、默认每 everyTicks 一拍序发一发。
 * `at` 给出每发相对 activeStart 的显式帧位（缺省位用 everyTicks 补），用来写「第 2 拍延迟 0.25 拍的假动作」。
 */
export interface ProjectileBurst {
  count: number
  everyTicks: number
  at?: number[]
  /** 这一串里哪一发是诱饵；不写就没有假动作惩罚（§55：没有消费者的格子不预写） */
  feint?: BurstFeint
}

/**
 * §14.4 那句「三叠箭第 2 拍为假动作（延迟 0.25 拍），骗翻滚后硬直 0.6s」的**惩罚腿**（KI-085）。
 *
 * `shot` 是诱饵那发在 `at` 里的下标，`punishMs` 是玩家把无敌帧花在这一发上之后欠下的硬直。
 * 两格之间的关系由 `scripts/burst-rules.mjs` 判（延迟成立 / 后面还有真收尾 / 硬直盖得住下一发），
 * 所以这里不重复那句话——改了数而没人改判据，门会红。
 */
export interface BurstFeint {
  shot: number
  /** 翻滚结束那一刻起算的硬直毫秒数（由 `msToTicks` 折成 tick，代码里不留第二份秒数） */
  punishMs: number
}

/**
 * 弹道规格（combat.md §4.3 引针枪「投掷枪」/ §5 远程威胁）。挂在动作帧上，
 * 玩家武器与敌人招式共用同一份表 ⇒ 同一套弹道运行时（combat/Projectiles.ts）。
 */
export interface ProjectileSpec {
  /** 表现层按 kind 选模；未知 kind 走默认弹头 */
  kind: 'spear' | 'note' | 'shard' | 'arrow'
  /** 初速 m/s */
  speed: number
  /** 飞行多少米后自然消散（无遮挡近似，见 tech-arch §5.9 已知缺口） */
  range: number
  /** 命中球半径（米） */
  radius: number
  /** 出手点高度，从攻击者脚下算；缺省 1.1 */
  offsetY?: number
  /** m/s²，0 = 直线弹道 */
  gravity?: number
  /** 命中一个目标后还能再穿几个；缺省 0 */
  pierce?: number
  /** 钉住定身 tick 数（引针枪的设计意图：把人钉在原地） */
  pinTicks?: number
  /** 命中附带沉默（§9 mute 标签），单位=tick（全表计时统一用 tick，§14.6 闷音 2s=120） */
  muteOnHit?: number
  burst?: ProjectileBurst
  /** 出手前画可见预告线（§14.4「赤线 telegraph，线终点=落点」），长度取招式 startup 帧 */
  telegraph?: boolean
  /** 打点（on-beat）投出的弹体保留架式加成快照 */
  sfxLaunch?: string
  sfxHit?: string
  vfxHit?: string
  shake?: 'graze' | 'normal' | 'heavy' | 'boss'
  /**
   * §4.4 泛音弓「泛音分叉 2 枝 12°」：连发时**相邻两发之间岔开的角**（度）。写了它，
   * 这一串弹体以瞄准方向为中心对称排布（第 i 发偏 `(i - (count-1)/2) * spreadDeg`）。
   * 消费方 `CombatManager.launchPlayerProjectile`：离瞄准方向最近的那一发是「主箭」
   * （吃满伤害，并列时取下标小的一发），其余是「分叉枝」。
   */
  spreadDeg?: number
  /**
   * §4.4「18（主）+ 60%/枝」：分叉枝的伤害倍率（主箭恒为 1）。只在与 `spreadDeg`
   * 连用时有意——单独写它，没有任何一发会被打折。
   */
  branchDamageMul?: number
  /**
   * §4.4 速射「移动中散布 +4°」：出手那一刻玩家在动，就再叠一层随机偏航（±本值/2，
   * CombatManager 的 seeded rng）。站桩射击不受影响——弓的代价写在机动上。
   */
  moveSpreadDeg?: number
  /**
   * §4.4 满弓「主箭优先最近目标」：没有锁定目标时，主箭在这只锥（度，绕玩家朝向）里
   * 自动吸附**最近**的活敌。不写 = 只认锁定目标，否则沿朝向直射。
   */
  assistConeDeg?: number
}

export interface FrameData {
  startup: number
  activeStart: number
  activeEnd: number
  recovery: number
  damage: number
  stamina: number
  poise: number
  hitStopMs: number
  hitbox?: Hitbox
  /**
   * §15.1 P3「拍 1 落点震波外环 20 / 内环 36」：**离爆心多远决定吃多少**。
   * 由近及远逐档查（`outer` 严格递增），取第一档满足 `outer >= 与爆心的水平距离`。
   * 存在时 `damage` 退为「最深那一档」的读数——validator 逼它等于 `max(bands.damage)`，
   * 两处各写一套就是两个主人（这条闸门就是为拦这个而生的）。
   * **只有"以出手者为圆心的形状"吃它**（sphere，或 `forward === 0` 的 ring）：cone 要角、
   * 偏心球要朝向、带 `forward` 的环要爆心偏移，而结算那一格手上只有出手点与目标中心，
   * 写在那些形状上就是一份永远读不到的数据。
   */
  bands?: DamageBand[]
  /** 存在 = 这是一个投掷/射击动作：进入 activeStart 时发射弹体，hitbox 可以缺席 */
  projectile?: ProjectileSpec
  lunge?: number
  shake?: 'graze' | 'normal' | 'heavy' | 'boss'
  /**
   * §10 KI-051：**落帧震场**——这一招越过 activeStart 的那一 tick 震全场景的镜头，**挥空也震**。
   * 与 `shake` 刻意分家：那格是「这一记命中时该震多重」的命中裁决回报（玩家侧招式在用），
   * 这格是招式作为世界事件本身的动静（驼鼓踏地）。消费方 = `Enemy.advanceAttackFrames`
   * 越过 activeStart 那一 tick ⇒ `camera.shake` 总线 ⇒ `CameraRig`（表里有 `stomp` 行才震得出来）。
   */
  worldShake?: 'graze' | 'normal' | 'heavy' | 'boss' | 'stomp'
  sfx?: string[]
  vfx?: string[]
  loudness?: number
  beatQuant?: number[]
  flags?: string[]
  /** 显式 fissureLayers（震裂，§11）；不写则走按键默认（charged=2 / h=1） */
  fissureLayers?: number
  /**
   * §8 反应分级的**出手侧声明**（KI-052①）：这一式打在挨打的人身上算哪一档。
   * 只有玩家架式表写它——不写＝按出手重量轴取档（轻击 R1 / 重击·战技 R2，
   * 见 `CombatManager.TIER_BY_KIND`），写＝这一式点名要那一档。
   * 今天只有一格写它：§4.2 强音大剑「跳跃攻击……附加击倒 R3」是设计文本逐字点名的那次击倒。
   * **敌人的招式不许在这里声明**：那一侧的分级住在 `AttackSpec.reaction`，两处都写就是两个主人
   * （validator 当场报错）。
   */
  reaction?: ReactionStunTier
  /**
   * §11 回响：命中后在同一位置挂一记「回声影」，`statuses.echo.delayTicks` 之后把这一击的
   * `replayMul` 倍伤害对群重演一次。写在哪一招上＝设计口径（combat.md §4.1 L4 尾段、
   * §4.2 重击/蓄力），所以它由招式自己声明，而不是代码按 key 猜。
   */
  echoOnHit?: boolean
  /**
   * 一记命中多少个目标。省略/1 = 近战的老规矩「一击一名目标」（挥空了也不许靠同一记横扫全群）。
   * 战技里的环形技（和弦爆）写它，才有「清群」这条真语义——由 `PlayerController.markActionHit`
   * 与 `CombatManager.playerHitsEnemies` 共同消费。
   */
  multi?: number
  next?: string
  skillTag?: string
}

export interface MovesetData {
  id: string
  actions: Record<string, FrameData>
  /**
   * 逐武器蓄满阈值（tick）——KI-117②。§4.2 重剑 1400ms/84t、§4.3 引针枪 1000ms/60t、
   * §4.5 音叉杖 900ms/54t；**省略 = 走全局 `CHARGE_TICKS`（800ms/48t，§4.1 轻剑与 §4.4 弓的基线）**。
   * 消费方 `PlayerController.chargeThreshold`（chargeProgress 与释放闸门共用它，不是第二个计时器）。
   */
  chargeTicks?: number
}

export interface WeaponData {
  /**
   * 武器拖尾的配置 id（Phase B4，KI-135）：省略 = 这把武器没有拖尾。
   * 值必须落在 `vfx.json > trails` 的 id 段里（那边是唯一真源）。
   */
  trail?: string
  id: string
  nameKey: string
  archetype: 'straight_sword' | 'greatsword' | 'spear' | 'bow' | 'staff' | 'unique' | 'needle'
  /**
   * 武器↔moveset **一对一**（KI-047）：这记招式表就是这把武器的价格本身——
   * 玩家出手的底数只有 `FrameData.damage` 一处（`CombatManager.strikeEnemy` 拿 `hb.damage`），
   * 曾有的 `atkBase` 因无消费方已删。两把武器共用一张架式表 ⇒ 永远同价，
   * validator 当场报。
   */
  movesetId: string
  scaling: Partial<Record<AttrKey, number>>
  swingTag: string[]
  /** 战技 id（sk_*）。无鸣没有战技（V2 内容）⇒ 可省略（KI-023 收尾批） */
  skill?: string
  poiseMul?: number
  noiseMul?: number
  /** KI-023 收尾批（无鸣独有，§4.6）：消费方在 findExecuteTarget —— 无消费方的武器不许写（WEAPON_FIELDS 同门） */
  /** 潜行处决的血线覆盖：无鸣 0.5（普通 0.35；设计的 +15pt 平移到实现的基数上） */
  stealthKillFrac?: number
  /** 重击「抹喉弧线」：对 Alert 侧（未进战斗）的目标，重击视为背刺（吃 ×3.5 那条倍率） */
  heavyAlertBackstab?: boolean
  /**
   * §4.4 泛音弓「距离衰减：>20m ×0.85，>40m ×0.6」：**武器级**（与 `noiseMul` 同族，
   * 对这把武器射出去的一切弹体生效）。按已飞距离逐档查（由近及远，`beyond` 严格递增），
   * 取第一档满足 `traveled > beyond` 的倍率；一档都不越 = 不衰减。消费方
   * `CombatManager.launchPlayerProjectile`（抄上弹体）→ `projectileStrikesEnemy`（命中时查表）。
   */
  falloff?: { beyond: number; mul: number }[]
}

export type AttrKey = 'str' | 'dex' | 'ton' | 'vig' | 'ovr' | 'fis'

export interface AttackSpec {
  id: string
  frames: FrameData
  beat: number[]
  parryable: boolean
  reaction?: IncomingGrade
  /** 命中挂异常：tag 用 Gameplay Tag 串；mute 类必须显式写 ticks（不写就不挂状态，见 support.test 全表扫描） */
  statusOnHit?: { tag: string; layers: number; ticks?: number }
  /**
   * §14.7「弹反钟锤二连第二段 → 钟体共振眩晕 2s」：这一招被弹反时它自己挨的硬直 tick。
   * 缺省走通用 18 tick（`Enemy.onParried`），所以只有写了这行的招式才有「共振」回报。
   */
  parryStunTicks?: number
  /**
   * false = **故意不量化到拍网格**（§15.2 无拍突进：「唯一不守拍的敌人，教玩家放弃节拍依赖、
   * 改读身体 telegraph」）。默认 true ⇒ 命中帧落在 `beat` 上（§2.1）。写下去就是整招的契约：
   * 它不参与拍位插槽仲裁，因为它本来就该出现在拍的缝里。
   */
  onGrid?: boolean
  /**
   * true = 这一招的前摇期是**玩家唯一能把全局网格抢回去**的时刻（§15.2 换气拍）：
   * 前摇里按弹反 ⇒ 夺拍（中立网格恢复 + 玩家过载奖励 + 这一阶的减益清零）。
   * 它同时应当 `damage: 0`——他停气时不打人，那口气本身就是窗口。
   */
  reclaimWindow?: boolean
}

export interface EnemyData {
  id: string
  nameKey: string
  archetype: 'basic' | 'heavy' | 'ranged' | 'assassin' | 'support' | 'elite' | 'miniboss' | 'boss'
  hp: number
  poise: number
  speed: number
  defense?: number
  /**
   * §11 震裂对「装甲/晶体类」特化：它身上的震裂效果（每层承伤 + 碎裂真伤）乘这个倍率。
   * 嘈壳的壳、漂调者喉咙里的晶是同一条规则的两批受害者。缺省 1（血肉之躯不吃特化）。
   */
  fissureMul?: number
  ai: {
    /**
     * 阵营标识（Phase B5 / `ai/Squad.ts`）：同 camp 的敌人互为盟友，`callAlly` 只叫同阵营的。
     * **省略 = 'default'**（`Squad.register` 那一处的回落），不是"没有阵营"——
     * 全体默认阵营照样能互相呼叫，只是叫的是所有敌人。
     */
    camp?: string
    vision: { range: number; fovDeg: number }
    vibration: { range: number }
    hearing: { range: number }
    distBands: { min: number; max: number; actions: string[] }[]
    /** 距离带里的伪动作 'backstep'（§14.4 针喉「永远背退拉近」）离家最远拉多远，米 */
    kiteRange?: number
    /** 多远放弃阵地回到追击；缺省 12m（射手按射程覆盖，否则永远打不到 14m 外的目标） */
    chaseBeyond?: number
    retreatHpFrac?: number
    callAlly?: { range: number; broadcastTicks: number }
    /**
     * 「定调」光环（combat.md §14.6 叠唱）：存活期间给半径内同伴乘算加成。
     * 只有 attackSpeed/dmg 两项有消费方——敌人没有体力经济（受击用架式而非体力），
     * 所以 §14.6 的「体力消耗 -20%」不在此表内，见 tech-arch §5.9.2 的如实登记。
     */
    buffAura?: { range: number; attackSpeedMul: number; dmgMul: number }
    /** §14.6「击杀它→全场敌人失衡（走调时刻）」：硬直 tick 数 + 是否把警觉清零 */
    offTuneOnDeath?: { stunTicks: number; resetAlertness: boolean }
    /**
     * 选招方式。缺省 'random'＝从当前距离带的候选里随机；'cycle'＝按表的顺序轮转
     * （冷却中的跳过，全在冷却就这一拍不出手）。§15.2 的 Main Boss 第一阶写着
     * 「每 4 小节一个乐句，玩家可背谱」——随机选招背不了谱，这条不是为了 AI 更聪明，
     * 而是为了让「可预测」这件事真的成立。
     */
    pickOrder?: 'random' | 'cycle'
    /**
     * §14.5「节拍空隙」实体切换（幽灵八）。三条全是区间/时长，没有一条写在代码里：
     * - `intangibleWindowTicks`：离拍点多近算「拍点上」（84BPM 下 ±208ms ≈ 12 tick）。在此区间内
     *   它半透明+定身：近战盒与弹体从它身上穿过、不受击、不位移（只在"and"位活动）。
     * - `dodge*`：解法 b「拍点闪避其前摇」→ 相位被抓包，显形 1s 且定身 1s（定身走通用 stunTicks）。
     * - `fakeBeat*`：解法 c「投掷音色晶=伪拍点声源」→ 响度≥阈值的声源把它拽出拍隙，显形 3s。
     *   消费方是既有的 `sound.source` 流，所以未来的音色晶道具只要发一声就能用，不需要新管线。
     */
    beatGhost?: {
      intangibleWindowTicks: number
      dodgeRevealTicks: number
      dodgeStunTicks: number
      fakeBeatRevealTicks: number
      fakeBeatLoudness: number
    }
    deaf?: boolean
    eyes?: boolean
    /**
     * §15.3 声音狩猎（隐藏 Boss 万籁）：玩家任何发声行为（挥砍/翻滚/格挡受击/脚步——
     * 全是既有的 `sound.source`）只要够响，她就瞬移到那个点并咬一口。这一格把
     * 「噪声=危险」从潜行数值升级成一条会被立刻惩罚的**位置**规则；`attackId` 就是那一口
     * （应当 `onGrid:false`：她根本不在拍上）。
     */
    huntsSound?: { attackId: string; minLoudness: number; cooldownTicks: number; maxRange: number }
    /**
     * §15.3「它也会听心跳」：玩家连续静止 `stillTicks` 之后她的警觉按秒回落
     * （屏息站住 = 甩掉她的可行解）；玩家一动就清零。
     */
    hearsHeartbeat?: { stillTicks: number; decayPerSec: number }
    /**
     * §14.7 悬钟骑士的钟甲：**正面** `arcDeg` 锥内的玩家伤害乘 `dmgMul`（0.6 = 减伤 40%）。
     * 消费口只有 `CombatManager.strikeEnemy` 这一条（近战与弹体共用），所以「从哪打进来」
     * 必须在那里判——背刺/侧击/背后来的弹体一律全额。被震裂满层打碎后 `Enemy.armorBroken`
     * 置位，本条永久失效（一次性奖励，不给它长回去）。
     */
    armorFront?: { arcDeg: number; dmgMul: number }
    /**
     * §14.7「每 4 小节敲钟自鸣回 15 HP（必须打断的软计时器）」。Boss 的阶段级同语义字段是
     * `phases[].barCast`（阶段会换，所以挂在阶段上）：
     * 每逢 `everyBars` 小节的第 1 拍，若它正打着，就强制插入 `attackId` 那招（长前摇、可打断）。
     * 回血发生在该招的 `startup` 帧：前摇里被打断（硬直/破势都会清空 `attack`）⇒ 一分不回。
     */
    selfToll?: { everyBars: number; attackId: string; heal: number; label?: string }
  }
  attacks: AttackSpec[]
  /**
   * Boss 运行时（combat.md §15/§16）。写了这一格，这具敌人就不只是一只更厚的怪：
   * - `bpm` / `beatsPerBar`：她的**私有拍速**（§15.1「3/4 拍 @108BPM」）。进战接管全场网格，
   *   离场/死亡归还给区域基准拍——「区域网格由他接管」是需求 §23 的硬设定，不是 flavor。
   * - `phases`：**单调**阶段机（血线只降不升，绝不来回跳）。每阶换的是「招式白名单 + 护壳规则」，
   *   不是数值倍率——§16「阶段必有场地变化而非纯数值」。
   * - `bells`：撞钟机关（§15.1）。P1 的壳靠打是打不动的，只有把她引去撞钟才剥得掉。
   */
  boss?: {
    bpm?: number
    beatsPerBar?: number
    phases: {
      id: string
      /** 血量比例**低于**此值时进入本阶（第一阶省略 = 起始阶） */
      belowHpFrac?: number
      /** 本阶允许出的招式 id（白名单 ⇒ 阶段真的换行为） */
      attacks: string[]
      /** 护壳：吃这一阶伤害时乘 `dmgMul`，`immuneToPoise` = 打不出架势。
       * `fissureMul` = 壳期震裂效果倍率（§11「铸出来的东西最怕同频敲击」）：它让碎裂更疼，
       * 但**剥不掉壳**——剥壳仍然只有撞钟那一条路（§15.1），所以它不构成第二条解法。 */
      shell?: { dmgMul: number; immuneToPoise: boolean; fissureMul?: number }
      /**
       * §15.2 P2「夺拍」：他吞掉全局时钟，玩家的节奏工具改挂到他的拍上。只有阶段带着这一格，
       * CombatManager 才会游走 drift、压玩家体力回复、抖玩家闪避恢复；不带（或被玩家抢回拍）
       * 时网格是中立的。
       */
      stealBeat?: {
        /** BPM 随机游走幅度（0.1 = ±10%，§15.2 明文），每 reDriftEveryTicks 重抽一次 */
        bpmDrift: number
        reDriftEveryTicks: number
        /** 玩家体力回复乘数（0.75 = -25%） */
        staRegenMul: number
        /** 闪避恢复锁漂移 tick（§15.2 的 ±60ms ≈ ±3.6 tick） */
        dodgeJitterTicks: number
        /**
         * 抢拍成功的回报：中立网格恢复 tick 数、过载 +N。窗口长度不在这里写第二遍 ——
         * 它就是那一招（`phases[].barCast.attackId` + `attacks[].reclaimWindow`）自己的前摇。
         * `hitStopMs` 是抢拍那一下的电影停顿（§9 的"情境"腿：这一次没有人挨打，停顿纯粹给
         * "我把拍抢回来了"这一个动作打分）。
         */
        reclaim: { neutralTicks: number; overdrive: number; hitStopMs: number }
      }
      /**
       * 本阶强制排进去的「读条招式」（4-E 的 ai.selfToll 语义提升到阶段级：阶段会变，所以挂在阶段上）。
       * heal 省略 = 不回血，只是「到点必须做的一件事」——§15.1 P2 的「每 2 小节换乐句停顿 0.5s
       * （呼吸拍=处决/喝药窗）」就是这一条。
       */
      barCast?: { everyBars: number; attackId: string; heal?: number; label?: string }
      /**
       * 本阶**接管全场网格的拍速**（§15.2 Finale「网格加速至 120BPM 后崩」）。
       * 省略＝沿用 `boss.bpm` 那一格身份级的私有拍速。它不是 flavor：入场演出的拍长、
       * 每小节的读条排程、玩家自己的拍点判定点都跟着它走（`AISystem.syncClock` 是唯一出口）。
       */
      bpm?: number
      /** 本阶的拍号（省略＝跟着 `boss.beatsPerBar`）。与 `bpm` 同一条腿，只在换拍号的那一阶写。 */
      beatsPerBar?: number
      /**
       * 本阶的**前摇倍率**（§15.2「过载期其攻击前摇 -20%」＝写 0.8）。
       * 只作用在跨过 `activeStart` 之前：判定窗与收势一拍不短，所以"更早落刀"买不到更长的破绽窗，
       * 玩家读到的是同一副招式表、只是它的起手变急。走 §14.6「定调」那台攒帧加速器，
       * 倍率折成整数 tick（帧表全是 `===` 判定，不能把 tick 变成浮点）。
       */
      startupMul?: number
      /**
       * §15.2「受击即断（R2 可打断全部招）」：本阶**撤销 Boss 的逐式硬直免疫**。
       * 免疫本来是身份级的（§16/§2.1 的背谱前提：她的招式不该被逐式打断），这一格把它降级成阶段属性：
       * 只有带着它的阶段里，R2 及以上的来袭档位才照常挂硬直并作废那一式。
       * **位置免疫不撤**——她的走位是断音柱/撞钟这类场地机关的输入，把人推出场地不是"爽段"的意思。
       * R1 仍然收不掉她：那是"轻击不该打断 Boss"的身份规则，阶段撤的是更强的那几档。
       */
      interruptOnHit?: boolean
      /**
       * KI-024：**场地阶段入口**——本阶不按血线、按「场地上还剩几件某类 prop」进入。
       * §16「阶段必有场地变化而非纯数值」的场地变化就是它指向的那些实体本身（音刺碎尽 =
       * 她的巢穴不再汇聚噪音）。单调推进：只允许比当前阶更靠后的阶用它进入。
       */
      enterOnProps?: { kind: string; atMost: number }
      /**
       * 本阶**耳聋**（KI-024 万籁 P2「聋乱期」）：hear/huntSound/sense 的听觉与视觉分支整条短路。
       * 与 `Enemy.deafTicks`（音刺碎裂的 6s 临时窗）同一条出口、两种来源——数据侧声明与本阶的
       * 聋乱窗在消费方看来是同一格「她聋了」。
       */
      deaf?: boolean
      /**
       * 本阶的**震动感知半径**（KI-024：聋了之后她改读地面）。省略＝沿用 `ai.vibration.range`。
       * 玩家在半径内**移动**就会积累她的警觉（`sense()` 既有通道）；站定仍然是安全的
       * （听心跳那条线在 P2 依旧成立，只是从「潜行回血」变成「唯一的隐身方式」）。
       */
      vibrationRange?: number
    }[]
    /**
     * 立钟机关：她的 `flags` 含 `'charge'` 那招收势帧附近若撞进一口还没响的钟，
     * 钟鸣 ⇒ 壳解除 `releaseTicks`（期间架势累积翻倍）、已响钟数达 `breaksAt` ⇒ 壳永久碎。
     * 响过的钟留下残响区：对玩家 0 伤、对喧堕者每拍 `damagePerBeat`（把场地用成 DPS 博弈）。
     */
    bells?: {
      positions: { x: number; y: number; z: number }[]
      hitRadius: number
      releaseTicks: number
      breaksAt: number
      resonanceRadius: number
      damagePerBeat: number
    }
    /**
     * 断音柱（§15.2「躲入场地断音柱后」）：数据点名的**竖直圆柱遮挡体**，
     * 由 `core/Occlusion.ts` 的线段判定读取——弹体的扫掠段、打在玩家身上的那条威胁线、
     * §14.4 的 telegraph 红线共用同一条判据，所以这里写的尺寸就是玩家能撞上的那根柱子：
     * `radius` 是柱子的**底半径**（表现层按它缩放，不再自己拿第二个数），
     * `heightM` 是它的高度（弹体从柱顶上方飞过去不算被挡，这一格因此必须是真数而不是装饰）。
     *
     * KI-014 之前这里是「玩家站进圆内 + 攻击者在圆外 ⇒ 吃掉这一击」的显式近似；
     * 现在它退化成架构文档承诺的那句话：**射线先打到什么**。原来那条"攻击者也贴柱 ⇒ 不挡"
     * 的防作弊细则不再需要手写——线段从柱内出发时根本没有穿过柱面，几何自己就否掉了。
     */
    covers?: { positions: { x: number; y: number; z: number }[]; radius: number; heightM: number }
    /**
     * §15.1/§10「转阶段那一嗓子」的两件时长（第三件震镜在表现层的 §10 表里，见 KI-021 的剩余项）。
     * 它挂在 `boss` 上而不是 `phases[]` 上，是因为这一嗓子由**跳阶这个事件**触发、与跳到哪一阶无关：
     * 按阶段写就是把同一对数字抄 N 遍，而 §55 不允许没有消费者的数据形状。
     *
     * 省略 = 这一具根本不该喊。单阶段 Boss（万籁）永远跳不了阶，所以它没有这一格是对的；
     * 真正的保护在验证器里：**写了两个及以上阶段却没写 `roar` ⇒ ERROR**（那条规则有自己的断言腿）。
     */
    roar?: { hitStopMs: number; muffleMs: number }
    /**
     * §16「Boss 均带 3 拍入场演出」：**第一次**把玩家当成目标起 `beats` 拍里她只转身、不出手、
     * 不贴近。这段是给的读图窗口（剪影 + 她的私有拍速第一次演给玩家看），不是免伤窗口——
     * 她照吃这一段的伤害，「白送一记开场」是这类遭遇的既有惯例，不是漏洞。
     * 拍长取**她接管之后**的网格（`AISystem.syncClock` 见 combat/chase 就改写全场 BPM），
     * 所以同一个 `beats: 3` 在 108BPM 的奥斯塔拉与 60BPM 的万籁身上是两种时长——这才对。
     * 每具实例只演一次（她是"第一次见面"，不是"每次进战"）。
     */
    intro?: { beats: number; label?: string; sfx?: string[] }
    /**
     * §16「胜利序列（IP §6：音乐停=世界屏息 0.5s）」。两条口径都刻意复用既有原语：
     * - 屏息走 `GameTime.hitStop`（本作没有过场时间轴，"世界慢到 5% 走一段" 就是这套引擎里
     *   唯一真实的屏息表达，ENV-001 下的合理替代）；`holdTicks` 是**逻辑 tick**，
     *   在慢放期间照常推进，所以玩家感觉被拉长而不是被切断。
     * - 音乐是**立刻掐掉**战斗层（`audio.music.encounter` 的 `cut`），不是脱战那条 4s 淡出：
     *   淡出说的是"危险过去了"，这一停说的是"有什么东西不在了"。底噪 drone 不停——
     *   世界还在，只是没人再为打鼓。
     */
    victory?: { holdTicks: number; label?: string; sfx?: string[] }
  }
  weakpoint?: { dmgMul: number }
  drops?: { tableId: string; chance: number }[]
  body?: { scale: number; color: number; emissive: number; coreColor: number }
  tint?: string
}

/** combat.md §5.4 Execute/Backstab tunables (all timing in ticks) */
export interface ExecutionConfig {
  /** A/B: maxHP*hpFrac + flat (true damage) */
  hpFrac: number
  flat: number
  /** vs Boss: fraction decays per repeat, flat suppressed */
  bossFracs: number[]
  /** B: basic enemy at/below this hpFrac dies silently instead of backstab animation */
  stealthKillFrac: number
  backstabConeDeg: number
  backstabRange: number
  /** A/C: front execute reach on a broken/stalled target */
  crumpleRange: number
  /** C: 休止处决 costs this much overdrive */
  overdriveCost: number
  overdriveFrac: number
  overdriveFlat: number
  /** input-lock + invulnerability montage window */
  durationTicks: number
  firstBladeHitStopMs: number
}

/**
 * 锁定（需求 §34 / gameplay.md「视野内 30° 锥最近目标」/ tech-arch §3 里 `player/LockOn.ts` 那行
 * 「角度优先→距离」）的四个数（KI-084，TD-005 的入表腿）。
 *
 * 它们此前写死在 `player/LockOn.ts`（`range = 35` 与打分式里的 `2.2 / 0.06 / +3`）：行为证人在
 * `tests/unit/lockon.test.ts`，但**改表改不动**。搬进来之后代码里不再留第二份。
 *
 * 打分式：`score = -ang * aimWeight - dist * distWeight + (isBoss ? bossBonus : 0)`。
 * `ang` 的单位是**弧度**（`clampAngleDiff(yaw, atan2(dx, dz))` 的绝对值，取值 [0, π]）——所以
 * `aimWeight` 是"每弧度罚多少"而不是每度：`2.2` 看着比 `0.06` 大 36 倍，30° 其实只折合 1.15 分。
 * 两条设计关系由 validator 钉住（不是新设计，是把上面那两句话折成不等式，见 `validate-data.mjs`）。
 */
export interface LockOnConfig {
  /** 候选筛选与脱锁共用的射程（米）。量的是**水平斜距** `hypot(dx, dz)`：跳起来不勾更远的人。 */
  range: number
  /** 角度项：偏离视线每一弧度罚多少 */
  aimWeight: number
  /** 距离项：每远一米罚多少 */
  distWeight: number
  /** 躯体 Boss 的加分（§34「Boss 独立锁定框」）：她在场时不该被杂兵抢走 */
  bossBonus: number
}

export interface PlayerBaseData {
  hp: number
  stamina: number
  poise: number
  defense: number
  moveSpeed: number
  sprintSpeed: number
  sprintCostPerSec: number
  jumpSpeed: number
  gravity: number
  staminaRegen: { hardDelay: number; slowPerSec: number; slowTicks: number; fastPerSec: number }
  guard: { startupTicks: number; reduction: number; staPerDmg: number; bleedPoiseFrac: number; /** §5.2 对远程：完美格挡把弹体弹回原主人，带走的比例 */ perfectBlockReflectMul: number; /** §13.0「听觉 Sound」的第四路：格挡接准那一记闷响的响度（未乘武器/词缀） */ impactLoudness: number;
    /**
     * §5.1「破防 Guard Break」：格挡中体力被抽干 → 600ms 大踉跄（代码用 `msToTicks` 派生格数）。
     * 这 36 tick 在 §9 停顿表里**没有**自己的一行（KI-017③ 的口径裁决，2026-09-25）：破防的时间
     * 演出住在 §10「破防/被破势」那行的附加格——下面两格就是它，`GameTime.hitStop` 的 scale 参数
     * 是现成的，慢放只吃相机那侧的时标，拍网格照走（§2.1 安全）。
     */
    breakStunMs: number; breakSlowMs: number; breakSlowScale: number }
  perfectBlockWindow: number
  parry: { activeTicks: number; whiffRecovery: number; /** §5.3「失败」行：落空后摇期间被击的伤害倍率（赌注），消费方 `ThirdPersonController.takeDamage` */ whiffDmgMul: number; poiseDamage: number; stunTicks: number; overdriveGain: number; /** §5.3 弹反弹道：反射回原主人的伤害比例（100%） */ projectileReflectMul: number; /** §13.0「听觉 Sound」：弹反那记钟响的响度（未乘武器/词缀），比踏地更响 */ impactLoudness: number }
  /**
   * §5.5「翻滚 Roll 与侧步 Sidestep」表里**玩家能做出来的那两行**（KI-090 把这四格接上读者）。
   *
   * 前/侧/后翻滚 = `total / iframeStart..iframeEnd / dist`，「（后向 2.6m）」那一格是 `backDist`；
   * 锁定侧步整行**替代**第一行而不是叠加 ⇒ `lockOnTotal / lockOnIframes / lockOnDist / lockOnStamina`
   * 各对应表里那一行的四列（300ms/18f、4-16f、1.6m、10 点）。
   *
   * 唯一消费方是 `ThirdPersonController.rollProfile()/rollDist()`：起手门槛、扣体力、时长/免伤窗、
   * 每 tick 位移四条腿都从那里派生，谁也不许再自己数一遍（18 与 14 以前就各数了两遍）。
   * 表里另外两格今天仍然没有载体，不在这里冒充有：「恢复锁」列（后摇）与「空中翻滚」整行，
   * 理由与实测读数见 KNOWN_ISSUES KI-090。
   */
  roll: { total: number; iframeStart: number; iframeEnd: number; dist: number; backDist: number; stamina: number; lockOnTotal: number; lockOnDist: number; lockOnStamina: number; lockOnIframes: [number, number] }
  execution: ExecutionConfig
  /**
   * combat.md §9「Hitstop 时长分级表」中**玩家是守方**的那四行（毫秒）。它们属于**情境**而不属于
   * 招式：同一记 heavy 打在盾上、被打准、被弹掉，停的长度各不相同，所以这一份长度不在
   * `frames.hitStopMs` 里（那一格说的是"这一记打中肉"的长度，走的是另一条腿）。
   *
   * 一个数喂四处，且这四处必须同源（KI-017 第二/三步）：相机 `time.hitStop`、`combat.hit` 事件、
   * 挨打那一方的硬直倒数（`stunStopTicks`）、出手那一方的招式帧账本（`ActionStop`）。
   * §9 那张表的其余两行住在别处不是漏写：「处决首刀」是处决这一式的属性，在 `execution.firstBladeHitStopMs`；
   * 「Boss 转阶段砸地」不是玩家身上的情境，在 `enemies[].boss.roar`。
   */
  hitStop: { hurtMs: number; blockMs: number; perfectBlockMs: number; parryMs: number }
  /**
   * §13.0「听觉 Sound」最后两条缺口的响度（KI-016 收尾）：
   * - `impactLoudness`：玩家的刀**落在肉上**那一声（发生在受击者位置）。0.5 与格挡那一记同档：
   *   肉挨一刀和格挡接准一样响；0.5 < 0.6（幽灵八伪拍点门槛）⇒ 打同伴不会震出拍隙里的她。
   * - `killNoiseLoudness`：击杀那一声（死亡哀鸣）。0.8 = 驼鼓踏地档：一个同伴倒地是场上
   *   最响的动静之一，30m 外的巡逻听得见。两条都归因玩家（因果：没有玩家就没有这两声），
   *   位置在事件点而非玩家脚下；乘武器 `noiseMul` 与词缀 `noiseMul` ⇒ 无鸣连击杀都是安静的。
   */
  melee: { impactLoudness: number; killNoiseLoudness: number }
  attrs: Record<AttrKey, number>
  attrUpCost: number
  rankXpCurve: { base: number; a: number; b: number }
  /** 需求 §34 锁定的四个数（KI-084）：唯一读者是 player/LockOn.ts，构造时注入 */
  lockOn: LockOnConfig
}

/* ============================ RPG（Phase 5-B） ============================ */

/**
 * 装备槽位。武器占 `weapon`（同时只允许一把在手），护甲四件 + 两枚音徽（纯词缀件，重量 0）。
 * 与 progression.md §5.1 对齐：护符就是「音徽 Tone-seal」。
 */
export type SlotKey = 'weapon' | 'helm' | 'cuirass' | 'gloves' | 'greaves' | 'seal' | 'sealA' | 'sealB'

/** 物品大类。装备件（weapon/armor/seal）会带 `gear`，其余是消耗/素材/叙事件。 */
export type ItemKind = 'currency' | 'material' | 'consumable' | 'weapon' | 'armor' | 'seal' | 'lore' | 'key'

/** 六音级属性（progression.md §2.1）：基音/指法/音色/腔体/泛音/失谐。 */
export interface AttrMeta {
  key: AttrKey
  nameKey: string
  displayName: string
  /** 一句话世界观解释，UI tooltip 用（需求 §19：状态与属性都要有世界内解释） */
  desc: string
  /** 软上限：超过后每点收益 ×softcap.mul */
  softcap: number
  /** 硬上限：再超过每点收益 ×softcap.hardMul */
  hardcap: number
}

/** 出身（定弦）。六维合计固定，只改分布与初始装备（progression.md §2.2）。 */
/**
 * 出身被动（§2.2 玩法签名里唯一给了数字的那类）。kind 白名单由 validator 守住——
 * 每加一种 kind，就必须同时有一个消费者，否则它只是句写在表上的谎话。
 */
export interface OriginPassive {
  kind: 'lootStackBonus'
  /** 吃加成的堆叠件 id（validator 双向对账：既要在 items.json 里，也要真有人掉它） */
  itemId: string
  /** 数量乘数，>=1（+10% 就是 1.1） */
  mul: number
  /** 卡面/播报给人看的那一句 */
  label: string
}

export interface OriginData {
  id: string
  nameKey: string
  displayName: string
  attrs: Record<AttrKey, number>
  weaponId: string
  /** 出身自带的一件护甲/音徽（可为空） */
  gearIds?: string[]
  blurb: string
  /** §2.2 签名里可量化的那一半；其余四签名的表达就是六维分布与初始装备本身，不硬造数字 */
  passive?: OriginPassive
}

/** 派生值公式的系数（progression.md §2.4）。全部在数据里，代码只做乘加。 */
export interface DerivedConfig {
  hp: { base: number; per: Partial<Record<AttrKey, number>>; perRank: number }
  stamina: { base: number; per: Partial<Record<AttrKey, number>> }
  poise: { base: number; per: Partial<Record<AttrKey, number>> }
  /** DEF = Σ护甲件 DEF（含强化） + 腔体×defensePerVig + 出身修正 */
  defensePerVig: number
  /** 负重上限 = base + 基音×perStr（kg 制） */
  load: { base: number; perStr: number }
  crit: { base: number; perOvr: number; cap: number; mulBase: number; mulPerOvr: number }
  /** 过载上限 = base + floor(音色/perDiv)，封顶 cap（progression.md §2.4） */
  overdrive: { base: number; perTonDiv: number; cap: number }
  /** 泛音每点给处决/背刺伤害的加成（progression.md §2.1 泛音行） */
  execMulPerOvr: number
  /**
   * §2.1 失谐（fis）的两条收益，Phase 5-C1 起它们真的有消费方（combat/Statuses + CombatManager）：
   * - `perFisPower`：每点给「异常强度」——震裂每层承伤、碎裂真伤、回响重演伤一律乘上去。
   * - `perFisTolerance`：每点给「环境失谐耐受」——Corruption 累积按 (1 − 点数×系数) 衰减。
   * - `toleranceFloor`：耐受的地板。**深窖的压门不能被属性点关掉**（§11 它是区域机制，不是可豁免的惩罚），
   *   所以堆满失谐也只是"褪色慢得多"，不是"可以站在哑带里不动"。
   */
  status: { perFisPower: number; perFisTolerance: number; toleranceFloor: number }
}

/** 强化曲线一格（progression.md §5.4：无失败、无销毁）。 */
export interface UpgradeStep {
  level: number
  timbite: number
  dross: number
  /** 武器基础伤害 +%（累加口径由 Upgrade.ts 计算） */
  weaponMul: number
  /** 护甲 DEF +% */
  armorMul: number
}

/** 稀有度档（progression.md §5.2）。词缀数与强化上限都由它决定。 */
export interface RarityTier {
  id: string
  nameKey: string
  displayName: string
  affixes: number
  maxLevel: number
}

/** 词缀定义：前缀=数值面，后缀=行为面（progression.md §5.3）。数值区间按稀有度取。 */
export interface AffixDef {
  id: string
  nameKey: string
  displayName: string
  /** 数值型给 [min,max]（按稀有度在高区间取值）；行为型给固定效果描述 */
  stat?: 'poiseDmg' | 'defense' | 'staminaRegen' | 'critRate' | 'execDmg' | 'noiseMul' | 'lootLuck' | 'skillDmg' | 'comboScaling'
  range?: [number, number]
  /** 行为型：由具体系统消费（之延=完美格挡窗，之切=轻击前摇…） */
  behavior?: string
  slots?: SlotKey[]
  minRarity?: string
  desc: string
}

export interface ProgressionData {
  maxRank: number
  attrs: AttrMeta[]
  origins: OriginData[]
  /** 升到 `rank` 级所需遗响（index 0 = 升到 2 级） */
  rankCurve: { rank: number; xp: number }[]
  derived: DerivedConfig
  softcap: { mul: number; hardMul: number }
  respec: { base: number; perPoint: number; discountTimes: number; discountMul: number }
  upgrade: UpgradeStep[]
  rarity: RarityTier[]
  /**
   * §9.4 全局装备大保底：每第 `every` 件装备强制抽到 ≥ `floorRarity`。
   * 计数在掉落层跨表累计（LootDirector.gearStreak）——写在代码里的话，改一个数要重新编译，
   * 而"多久保底一次"恰恰是最常被调的那颗旋钮。
   */
  pity: { every: number; floorRarity: string }
  affixes: { prefix: AffixDef[]; suffix: AffixDef[] }
  /** 洗点/强化之外，升级里程碑（progression.md §8.2「你新能做什么」） */
  milestones: { rank: number; id: string; label: string; grant?: MilestoneGrant }[]
  /** §8.2 身份效果表（ms_identity 的机制腿，KI-138）；需求只给了指法那一例 */
  identityEffects?: IdentityEffectRow[]
  /**
   * §44 那一栏「更适合当前 Build」的**建议星标**权重（KI-060，ui-ux.md §3.3）。
   * 键是 `rpg/Equipment.ts > EquipMods` 的数值轴（一张测试脚本↔类型的双向对账钉着，见
   * `tests/unit/gear-advice.test.ts`），值是**建议分 / 该轴一点增量**——所以它可以是负数
   * （负重、噪音这类"越低越好"就是负权重；`lightStartupTicks` 本身就是负帧，正权重自动变成扣分）。
   * 读它的是 `Equipment.adviceDelta`：算的是"把这件装上去之后整套投影相对现在这一格差多少"，
   * 因此乘数轴的基线（`weaponDamageMul: 1` 那一类）在差里自己抵消，不需要为它们发明"减去 1"的规矩。
   * 这是一张**序数**表不是汇率：它的输出决定 ★ 落在哪一行，不决定任何结算数字。
   */
  gearAdvice: { weights: Record<string, number>; note?: string }
}

/**
 * 里程碑的机制腿（KI-054）。§8.2 那列「你新能做什么」此前全是播报文本——
 * label 承诺了数字，derive 里却没有这一项，等于 UI 在替不存在的机制发奖。
 * 规矩与 PENDING_FLAG_WRITERS 同族：**每一行要么带 grant（有真实消费方），
 * 要么逐个列进 validator 的 PENDING_MILESTONE_GRANTS 白名单（带原因）**。
 * 消费方：`loadFlat`/`execMulPct`/`overdriveFlat` 走 `Progression.derive`；`parryWhiffMs` 经
 * `PlayerMods.parryWhiffMs` 到 `ThirdPersonController` 的落空后摇（§5.3 失败行）。
 */
/**
 * **身份效果**的一行（§8.2「任一维触及 35 = 该维专属效果」，KI-138）。
 *
 * **门槛两格**：① 那一维的**面板值**要 ≥ `min`（不是软上限折算后的值——这一列是"你投入了多少"，
 * 不是"这一维实际当多少"；② 音级要够 `milestone` 那条里程碑的 rank（ms_identity＝终局那一档）。
 * **效果本身是 `grant`**：与里程碑的机制腿同一套字段（一个主人：`MilestoneGrant`），
 * 所以新增效果不必新造一条消费链。
 *
 * **需求只给了指法那一例**（progression.md §8.2 第 16–18 行），其余各维是设计读数 ⇒ 表里先只写那一行，
 * 不发明需求没给的数（§55）。
 */
export interface IdentityEffectRow {
  /** 哪一维 */
  attr: AttrKey
  /** 面板值门槛 */
  min: number
  /** 播报文本（里程碑/面板用） */
  label: string
  /** 给什么效果（字段与里程碑 grant 同一套） */
  grant: MilestoneGrant
}

/**
 * **身份效果**的一行（§8.2「任一维触及 35 = 该维专属效果」，KI-138）。
 *
 * **门槛两格**：① 那一维的**面板值**要 ≥ `min`（不是软上限折算后的值——这一列是"你投入了多少"，
 * 不是"这一维实际当多少"；② 音级要够 `milestone` 那条里程碑的 rank（ms_identity＝终局那一档）。
 * **效果本身是 `grant`**：与里程碑的机制腿同一套字段（一个主人：`MilestoneGrant`），
 * 所以新增效果不必新造一条消费链。
 *
 * **需求只给了指法那一例**（progression.md §8.2 第 16–18 行），其余各维是设计读数 ⇒ 表里先只写那一行，
 * 不发明需求没给的数（§55）。
 */
export interface IdentityEffectRow {
  /** 哪一维 */
  attr: AttrKey
  /** 面板值门槛 */
  min: number
  /** 播报文本（里程碑/面板用） */
  label: string
  /** 给什么效果（字段与里程碑 grant 同一套） */
  grant: MilestoneGrant
}

/**
 * **身份效果**的一行（§8.2「任一维触及 35 = 该维专属效果」，KI-138）。
 *
 * **门槛两格**：① 那一维的**面板值**要 ≥ `min`（不是软上限折算后的值——这一列是"你投入了多少"，
 * 不是"这一维实际当多少"；② 音级要够 `milestone` 那条里程碑的 rank（ms_identity＝终局那一档）。
 * **效果本身是 `grant`**：与里程碑的机制腿同一套字段（一个主人：`MilestoneGrant`），
 * 所以新增效果不必新造一条消费链。
 *
 * **需求只给了指法那一例**（progression.md §8.2 第 16–18 行），其余各维是设计读数 ⇒ 表里先只写那一行，
 * 不发明需求没给的数（§55）。
 */
export interface IdentityEffectRow {
  /** 哪一维 */
  attr: AttrKey
  /** 面板值门槛 */
  min: number
  /** 播报文本（里程碑/面板用） */
  label: string
  /** 给什么效果（字段与里程碑 grant 同一套） */
  grant: MilestoneGrant
}

export interface MilestoneGrant {
  loadFlat?: number
  parryWhiffMs?: number
  execMulPct?: number
  /** rank14「过载上限 10→12」：加在 10+floor(音色/10) 的**基数**上，仍被 cap（15）封顶（KI-054②） */
  overdriveFlat?: number
  /**
   * rank10「失谐耐受 +1 档：深窖可停留时长 +35%」：**乘在累积速率上的时长项**——
   * `corruptionResistMul = max(floor, (1 − fis×per) / (1 + 本项和/100))`。35 ⇒ 速率 ÷1.35 ⇒
   * 同一口池子多 35% 停留时间，对**任何出身**逐字成立（加法平移会被出身异音稀释成 +38%，
   * 换算记在 KI-054 行）；toleranceFloor 仍在最后封底，grant 推不穿设计的地板。
   */
  corruptionStayPct?: number
  /**
   * rank12「满弓分叉 2→3（若用弓）」的那条腿（KI-037）：`launchPlayerProjectile` 在
   * `burst.count` 之上叠加的**额外分叉枝数**。2 枝底数住在 `ms_bow.charged` 自己的
   * `burst.count`（含主箭），这一格只负责「到了 rank12 多一枝」——两处各写一个总数
   * 就是两个主人（KI-054 同族纪律）。
   */
  bowForkBranches?: number
  /**
   * 「指法 35：翻滚体力 -2」（§8.2 身份效果那一列的第一例，KI-138）：**加在翻滚体力价上的平移项**。
   * 负数 = 更便宜。它是"某一维触及 35"才有的效果，所以它的门槛不在这一格（门槛在
   * `progression.json > identityEffects` 那一行：哪一维、到多少、给什么）。
   */
  rollStaminaFlat?: number
}

/** 装备件的静态定义（挂在 ItemData.gear 上）。 */
export interface GearDef {
  /** 装备件可放的槽位。'seal' = 音徽件，sealA/sealB 两槽都吃（progression.md §5.1） */
  slot: SlotKey
  rarity: string
  /** 武器件指向 weapons.json 的 id；护甲/音徽不写 */
  weaponId?: string
  def?: number
  weight: number
  /** Unique 件的固定词缀（不可洗、不可随机） */
  affixes?: string[]
  unique?: boolean
  /** 分解回残晶/音色石的比例（progression.md §6.3 重复件处理） */
  salvage?: { dross: number; timbite: number }
}

export interface ItemData {
  id: string
  nameKey: string
  displayName: string
  kind: ItemKind
  /** 堆叠上限；装备件一律 1 */
  stack: number
  /** 卖出价（货币本身为 0）。§6.3：卖出系数 ×50% 由经济层处理 */
  value?: number
  desc: string
  gear?: GearDef
  /**
   * 消耗品的用法。`heal` 回血（回响膏）、`corruption` 为负数=刮掉多少失谐（音色晶），
   * 两者都是面板上「研读」那条腿；`throw`（KI-023① 声东击西）是投掷用法：抛物线弹体落地碎裂，
   * 按 `loudness` 发一声伪声源——她朝碎响处扑过去，玩家在别处输出。投掷本身不发声（风声不算数）。
   *
   * 只写有消费方的字段——消耗音效属于 Phase 8 音频系统的工作，届时再回表。
   */
  use?: {
    heal?: number
    corruption?: number
    throw?: { speed: number; range: number; radius: number; gravity: number; loudness: number; offsetY?: number }
    /** KI-046 检视动词：研读不消耗。文本存这里，Inventory.inspect 播报并标记 */
    inspect?: string
  }
}

/* ============================ 营地商店（progression.md §6.2/§6.3，KI-055） ============================ */

/**
 * 音色石经济的**出口表**。两份账各一个主人：卖出系数 `sell.mul` 是 §6.3 的反通胀红线
 * （档价×50%，强化沉没不反还）；`stock` 是 §6.2 消耗侧唯一合法的购买清单——validator 钉住
 * 「只许 consumable」，因为「强化材料不可购、词缀不可购」是设计红线，不是库存巧合。
 */
export interface ShopStockEntry {
  id: string
  item: string
  price: number
  note?: string
}

/**
 * 卖出侧的三个口（KI-055/KI-059）：
 * `mul` 是**唯一**的卖价系数，装备腿与堆叠件腿同乘它（`rpg/Shop.ts` 的 `saleUnit`）；
 * `stackKinds` 是"哪几类**堆叠件**可以按数量卖"（`['material','lore']`）——写成数据而不是
 * 写死在 TS 里，是为了让 validator 能拿它和 `stock` 的 kind 对账：**能买的类别绝不能同时能卖**，
 * 那条 §6.3 的反套利红线才有机器形状（白名单藏在代码里的话，门就摸不到它）。
 *
 * 它原来是 `ShopData.sell` 上的一行内联对象，形状上就没有"主人"可指：validator 里的 `SELL_FIELDS`
 * 只能手抄，抄漏一个键不会红，只会让那个键静默失效（KI-085 的 `burst.feint` 就是这么处理的，同一条规矩）。
 */
export interface ShopSell {
  mul: number
  stackKinds: ItemData['kind'][]
  note?: string
}

export interface ShopData {
  id: 'shop'
  sell: ShopSell
  stock: ShopStockEntry[]
  redlines?: { note?: string }
}

/* ============================ 状态系统（combat.md §11，Phase 5-C1） ============================ */

/**
 * 五个状态的共同头部：`tag` 走 Gameplay Tag 风格（数据里写 `mute` 或 `status.mute` 都认），
 * `displayName`/`desc` 是需求 §19 要求的世界观 tooltip——**desc 必须被 UI 读到**，
 * 所以 Statuses.ts 里有一条「本局第一次见到这个状态就把 tooltip 播一遍」的消费路径。
 */
export interface StatusMeta {
  tag: string
  displayName: string
  desc: string
}

/** 震裂：层数＝承伤标尺，满层碎裂。衰减节奏是「10s 无新增 → 每 2s 掉一层」两段式。 */
export interface FissureStatus extends StatusMeta {
  maxLayers: number
  dmgMulPerLayer: number
  idleTicks: number
  decayEveryTicks: number
  burst: { trueDamage: number; poise: number }
  /**
   * §11「对装甲/晶体类效果 ×2」的倍率**不在这里**：那是目标的材质属性，标在
   * `EnemyData.fissureMul`（嘈壳）与 `BossPhase.shell.fissureMul`（壳期奥斯塔拉）上，
   * 由 `Enemy.fissureEffectMul` 合成。状态表只给「每层多少」这类通用规则，不替敌人认领材质。
   */
}

/** 闷音：时长由施加方（`statusOnHit.ticks`）声明，这里只给「挂着的时候值多少」。 */
export interface MuteStatus extends StatusMeta {
  /** 体力回复乘数（0.7 = -30%）。「战技/律具技封锁 4s」的消费者是乐章战技（5-C2），故此处不预写数字 */
  regenMul: number
}

/** 回响：重击命中挂一记回声影，延迟后在同一位置对群重演。 */
export interface EchoStatus extends StatusMeta {
  delayTicks: number
  replayMul: number
  /** 重演的判定半径（米）。§11 只说「同位置、对群」，这个数是从「一间屋子的宽度」定的 */
  radius: number
  /** 性能锁（§11 明写）：场上同时最多几影，超了直接丢新的 */
  maxShadows: number
}

/** 失谐（褪色值）：玩家侧的环境压力计量表，不是惩罚——见 RegionData.corruption。 */
export interface CorruptionStatus extends StatusMeta {
  max: number
  /** 被喧堕精英（archetype elite/miniboss/boss）命中一次的增量 */
  eliteHit: number
  /** 从这个值起开始抽颜色，到 max 抽完（表现层用 `veil()` 而不是自己读阈值） */
  visualStart: number
  /** 满值后在**非安全区**（有 corruption 格的区域）的每秒掉血 */
  hpPerSec: number
}

/**
 * 共振过载：数值不在这里——上限来自 progression.json 的 `derived.overdrive`，
 * 收支来自 player.json（`parry.overdriveGain` / `execution.overdriveCost`）。
 * 本表只带它的 tooltip，避免同一个数在两张表里各写一遍。
 */
export type OverdriveStatus = StatusMeta

export interface StatusConfig {
  fissure: FissureStatus
  mute: MuteStatus
  echo: EchoStatus
  corruption: CorruptionStatus
  overdrive: OverdriveStatus
}

/* ============================ §8 受击反应表（combat.md §8，KI-050） ============================ */

/**
 * 表里只有**有承载体**的那几行（KI-017③ 的口径：不编造消费方）。
 * - **R0**＝材质发光：§8「架势未破，仅抖动材质发光 150ms」。承载体是 `Enemy.onDamaged`
 *   写的那一格 `coreFlash`（此前 0.15 秒写死在代码里，且不看"架势有没有破"——KI-052① 两个毛病一起修）。
 * - **R1**＝玩家侧那一行 + 敌人侧的轻击档：§8「玩家受击一律 R1 等效 200ms + 位移 0.2m（硬直可翻滚取消——
 *   翻滚入口本来就写在 `stunTicks > 0` 之外，见 `ThirdPersonController` 的 dodge 判据）」。
 *   承载体有两条：`ThirdPersonController.takeDamage`（玩家）与 `CombatManager.applyReaction`（敌人，§8 的分级列）。
 * - **R2 / R3**＝敌人侧的重击档与击退档。承载体同样是 `applyReaction`：重击与战技出手报 R2、
 *   招式帧自己声明 `reaction:"R3"` 的那一格（§4.2 强音大剑跳劈「附加击倒 R3」）报 R3。
 *   **Boss 整条 R0–R3 通道免疫**（§16/§2.1 的背谱前提：她的招式不被逐式打断，反制手段是弹反/破势/场地机关）。
 *   R1 那一档对敌人**什么都不接管**（不硬直、不迁移位置）——"每一记轻击推 0.2m"在没有滑行衰减的灰盒里
 *   会累加成一笔距离税，实测会顶穿 KI-039 的高甲平衡判据；那一格的 `displaceM` 由玩家受击那一边读。
 * - **R4**＝破势：承载体是 `EntityStats.addPoise` 写出的破势时长
 *   （普通 1.8s；Boss/mini-boss 2.4s，由 `combat/Reactions.ts:armCrumple` 按 `isBoss` 上弦）。
 * - **R5 不写**：本作没有"浮空"这个状态（敌人不会离地，也没有空中减伤通道），写进去就是造没有消费方的行。
 */
export interface HitReactionTable {
  R0: { flashMs: number }
  R1: { stunMs: number; displaceM: number }
  R2: { stunMs: number; displaceM: number }
  R3: { stunMs: number; displaceM: number }
  R4: { crumpleMs: number; bossCrumpleMs: number }
}

/**
 * §8 里"挂在挨打那一方的时间"的四档（R4/R5 各有自己的通道，不在这一列里）
 */
export type ReactionTier = 'R0' | 'R1' | 'R2' | 'R3'
/** 其中给得出"硬直 + 位移"的那三档：R0 只发光，所以不在这个子集里 */
export type ReactionStunTier = Exclude<ReactionTier, 'R0'>
/**
 * 一记攻击**打在谁身上都算哪一档**的完整词表（KI-052②）：敌人招式声明的是这一列，
 * 玩家受击那一边读它决定"要不要没收正在出的那一式"。
 * §8 末行把玩家的**时长**钉死成 R1 等效（操作权不没收），所以这一列不改时长，只改打断。
 */
export type IncomingGrade = 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5'

/* ============================ 乐章战技（progression.md §7，Phase 5-C2） ============================ */

/**
 * 一次出手的代价。两条通道都是**已有**的计量表：体力（`EntityStats.stamina`）与
 * 共振过载（§11 的 overdrive 条）。写 0 或不写＝这条不付。
 */
export interface MovementCost {
  stamina?: number
  overdrive?: number
  /**
   * §7.2 休止斩那一格「每次使用后过载消耗 +2（防连发）」：本式的过载价每用一次往上加这么多。
   * 复位判据**不住在这张表里**——「过载条重新攒满」就是这个世界里"你又挣回了一拍"，
   * 把它写成一个 `resetTicks` 会凭空造出第二个计时器（同一件事不能有两条时间）。
   */
  overdriveRamp?: number
}

/**
 * 战技的一帧表。刻意不复用 `FrameData`：武器帧里的 `damage`/`stamina` 是"这一刀本身"的数，
 * 而战技的数值随等级成长、且不吃武器强化倍率（§2.1 音色列），两套口径混在一张表里必然出错。
 * 到运行时由 `rpg/Movements.ts` 合成一份 `FrameData` 交给玩家的动作状态机——**状态机只有一条**。
 */
export interface MovementFrame {
  startup: number
  activeStart: number
  activeEnd: number
  recovery: number
  /** 出手造成的架势。没有 hitbox 的战技（瞬步/起手式）不写这行 */
  poise?: number
  hitStopMs?: number
  hitbox?: Hitbox
  /** 一次出手能打满几个目标（环形技）。没有 hitbox 时写了就是死数据 ⇒ 门禁会拦 */
  multi?: number
  shake?: 'graze' | 'normal' | 'heavy' | 'boss'
  sfx?: string[]
  vfx?: string[]
  loudness?: number
}

/**
 * 战技的一级。`cooldownTicks` 必填：三条战技都有冷却，冷却统一按 tick 计 ⇒
 * 「错拍步不受 BPM 漂移影响」（§7.2 它写着这是深窖/恩希尔 P2 的保命锚）由表示法本身成立，
 * 不需要在代码里为它开特例。其余按战技语义可选，门禁要求"写了就必须有消费方"。
 */
export interface MovementLevel {
  cooldownTicks: number
  /** 战技自身的基础伤害（走同一条结算通道，但标尺换成「音色」） */
  damage?: number
  /** 追加真伤（全音符斩）：减伤/暴击之后再加的一笔，不吃 DR */
  trueDamage?: number
  /** 追加震裂层数（§11）。全音符斩把它压在"下一记重击"上，随那一记一起结算 */
  fissureLayers?: number
  /** 挂给命中者的闷音时长（和弦爆）。施加方给时长，与 `statusOnHit.ticks` 同一口径 */
  muteTicks?: number
  /** 位移距离（米）：错拍步。沿输入方向，无输入时沿面向 */
  distance?: number
  /**
   * 时停（休止斩，§7.2「全场敌人时间冻结，玩家正常」）：判定窗第一记落下的那一 tick，
   * 场上每一个还活着的敌人被按住这么多 tick。写成 tick 不写成 0.8 秒——全项目时序口径同 §55。
   * 它**不是** `stunTicks`：定身作废当前读条，时停把那一招连人带帧停在原地，松手后从同一帧继续。
   */
  freezeTicks?: number
  /**
   * 定音回响（§7.2 乐章 IV）：这一记出手往玩家身上存几扇「加宽弹反窗」的充能。
   * 消费方＝`ThirdPersonController`：按下弹反的那一 tick 花掉一格，那扇窗吃 `echo.windowMul`
   * 且弹中必挂破势。窗口没弹到也照花——花的时点在开窗，赌注口径同 §5.3（KI-054）。
   */
  echoCharges?: number
  /**
   * 无声协奏（§7.2 乐章 IV 顶）：生效后这么多 tick 内玩家**全部行动零噪音**
   * （`ThirdPersonController.noise()` 直接返回 0，所有 `sound.source` 出口共用它）。
   */
  silenceTicks?: number
  /** 无声协奏同时段给玩家出手的伤害加成（0.15 = +15%）。消费方＝`CombatManager.strikeEnemy` 唯一伤害通道 */
  silenceDmgBonus?: number
}

export interface MovementData {
  id: string
  page: string
  nameKey: string
  displayName: string
  /** 需求 §19：系统概念也要有世界内解释 */
  desc: string
  cost: MovementCost
  frame: MovementFrame
  levels: MovementLevel[]
  /**
   * 「落地窗口」（progression.md §7.2 错拍步那一格：位移落地后 0.3s 内，自己的攻击架式伤害 +3）。
   * 没有这一格就是"位移完就没了"——§7.2 承诺的第三条收益此前只存在于文档里（KI-035）。
   * 写成 `withinTicks` 而不是 0.3 秒：全项目的时序口径是 tick（§55），换算不在代码里做。
   */
  landing?: { poise: number; withinTicks: number }
  /**
   * 定音回响（§7.2 乐章 IV：「下一次弹反窗口 ×2（200ms）」）：充能花出去的那几扇窗
   * 按这个乘数加宽（6 tick 的基准窗 ×2 = 12 tick = 200ms，基准住在 player.json `parry.activeTicks`）。
   * 和 `landing` 同一先例：三条等级的表值都一样 ⇒ 它是这一式的**性质**，不是等级成长，
   * 所以住在式子上而不是抄三遍进 levels。「必挂破势」没有数字可写——时长就是 reactions.json 的 R4，
   * 不为这一式另开第二张破势表。
   */
  echo?: { windowMul: number }
}

/** 谱册的一页。点亮页=把它的工具箱打开（§7.1）；来源是数据里点名的物品，不是代码里的 if。 */
export interface MovementPage {
  id: string
  nameKey: string
  displayName: string
  desc: string
  /**
   * 点亮这一页的解锁源（§7.1）。两种形状二选一（validator 钉住）：
   * - `item`：吃掉实物（振源核/乐谱残页——I/II/III 三页）；
   * - `flag`：被世界事件见证（乐章 IV = 恩希尔终段，KI-037 的改判：worldstate 的
   *   bossDefeated 规则写旗，谱册的点亮键读旗——不再把「第四颗核」伪造进经济）。
   */
  unlock: { item?: string; count?: number; flag?: string }
}

/** 主动槽。`milestone` 指向 progression.json 的里程碑 id：几级开槽由那张表说，这里不抄第二遍数 */
export interface MovementSlotDef {
  index: number
  action: ActionName
  milestone: string
}

/** 被动（§7.3「被动栏」，KI-036）。数值住在 values 里（L1-3 各一格），语义由消费方注释：
 *  常拍脚=落地/翻滚后的踏音宽限秒数；厚膜鼓=架势衰减加成（0.30 = +30%）。 */
export interface PassiveDef {
  id: string
  page: string
  nameKey: string
  displayName: string
  desc: string
  /** L1-3 的效果数值；语义见上（同一条被动一个量纲，整条换） */
  values: number[]
}

export interface MovementConfig {
  slots: MovementSlotDef[]
  pages: MovementPage[]
  movements: MovementData[]
  /** 升级花费（index 0 = 升到 2 级）。§6.2：战技乐谱升级 40-200/级 */
  upgradeCost: { level: number; timbite: number; score: number }[]
  /** 被动研读花费（index 0 = L1）。§7.3：L1-3 = 30/60/100 残晶+石 */
  passiveCost?: { timbite: number; score: number }[]
  /** 被动栏（页底常驻，KI-036）；不写 = 没有被动 */
  passives?: PassiveDef[]
  /**
   * 战技伤害的标尺（§2.1 音色列「乐章战技伤害 +1.5%/点」+ §11 过载列「每层战技伤害 +4%」）。
   * 它是**出手侧**的系数，写在谱册总表里而不是每条战技里：一条战技改口径，等于全表重定价。
   */
  damage: { scaling: Partial<Record<AttrKey, number>>; perOverdriveLayer: number }
}

/** 掉落表（progression.md §9.0 schema）。掷骰全部走种子化 RNG ⇒ 可复现 QA。 */
export interface LootRoll {
  id: string
  /** 命中概率（不写 = 必掉）。与 weight 互斥：weight 用于「从多条里挑一条」 */
  chance?: number
  weight?: number
  /** 直接给物品 id */
  item?: string
  count?: [number, number]
  /** 遗响（经验）区间 */
  xp?: [number, number]
  /** 按稀有度档抽一件装备（权重即 §9.4 的同档内权重，写在数据里而不是代码里） */
  gearBand?: { rarity: string; weight: number }[]
  /**
   * 逐条保底（§9.2 容器档那一列）：这条 roll 连续 `pity` 次没掷中，第 `pity+1` 次强制命中。
   * 管的是**本条掉不掉**；稀有度地板由 progression.json 的全局 pity 管（§9.4），两条互不替换。
   */
  pity?: number
}

export interface LootTableData {
  id: string
  rolls: LootRoll[]
  /** 首次击杀专属（§9.1 首杀列 / §9.3 Boss 首杀唯一） */
  firstKill?: LootRoll[]
}

export interface Vec3 { x: number; y: number; z: number }

export interface RegionBounds {
  minX: number; maxX: number
  minY: number; maxY: number
  minZ: number; maxZ: number
}

/**
 * §10 区域**身份色**（hex）。灰盒几何（`ChunkGreybox`/`WallGreybox` 的 fill/edge/emissive）与地图
 * （`MapUI` 的 fill/edge）读这三格——亮、可读，用来"认出这是哪一区"。
 *
 * **与 `RegionData.lightingPreset`（§2 六色 + §8 大气/LUT）是两套色彩，不是一套**（Batch E 裁决，2026-10-09）：
 * 这里的 `base`/`accent` 与 `lighting.json` 的 `base`/`accent` **同名不同义、值也不同**——那边是屏幕调色与
 * 灯源的"大气色"（暗、有情绪），这边是灰盒/地图的"身份色"（亮、可读）。两者各有主人、消费者不相交，
 * **不许合并成一个真相源**：把身份色并进大气色会让地图/灰盒变成暗块，把大气色并进身份色会让屏幕跟着灰盒跑。
 */
export interface RegionPalette {
  base: string
  accent: string
  glow: string
}

export interface SpawnGroup {
  enemyId: string
  count: number
  center: Vec3
  radius: number
  campId?: string
  /** stringExpr over world flags, evaluated by the spawner */
  condition?: string
}

export interface Landmark {
  id: string
  nameKey: string
  pos: Vec3
  /** view distance in metres used by the map/POI layer */
  sightRange: number
}

export interface InteractableRef {
  id: string
  kind: 'checkpoint' | 'elevator' | 'bridge' | 'soundwall' | 'gather' | 'chest' | 'npc' | 'teleport' | 'gate' | 'bell' | 'inspect' | 'shop'
  /** 提示文案里的动词，覆盖按 kind 的默认值（如吊机 ≠ 共鸣井）；Phase 6 换成本地表 key */
  verb?: string
  pos: Vec3
  /** one-way shortcut lock: opens once, then stays open from this side only */
  oneWay?: boolean
  requiresFlag?: string
  /**
   * **多面旗的合取闸门**（AND，Phase 6-C 初句圣所）：与 `requiresFlag`（单面）平级，
   * 回答"这几件事**都**发生了吗"。单面旗能表达的门只到"一件事办完"为止——无耳深窖井底那扇门
   * 要的是**五环线索都读到**（narrative §4.8 环①–④），一条 `requiresFlag` 说不了。
   * 与 `requiresFlag` 同时写 = 同一件事两处真值 ⇒ 校验器 ERROR；与 `requiresState` 可以并存
   * （一个问"走到哪一格"，一个问"哪几件事齐了"）。
   */
  requiresFlags?: string[]
  /**
   * **值域型**闸门（Phase 6-B：`state.*`）。与 `requiresFlag` 的差别只在记法：旗标是"有没有"，
   * 值域状态是"走到哪一格"（narrative §7 的 `STATE.<域>.<对象> = <枚举>`）。
   * 休垒广场的三处陈设就是这么换组的：同一个地点，敲响 / 熔掉 / 封存之后站的东西各不相同。
   * 未写入时读到的是 `states.json` 里声明的 `default`（= 还没走到那个抉择）。
   */
  requiresState?: { key: string; value: string }
  setsFlag?: string
  npcId?: string
  /** 交互后把人送去的落点（共鸣井/吊机/吊桥 = 遮蔽传送等价物）；缺省 = 原地生效 */
  to?: Vec3
  /** 采集/遗箱/敲钟的掉落表 id（Phase 5-B：掉落不再写死在 main.ts 里） */
  lootTable?: string
  /**
   * 指向本区域 `secrets[]` 里的一条（Phase 6-A）：写了它，这个交互物的**解锁旗标与奖励表就从那条 secret 取**，
   * 不在这里再抄一遍 `requiresFlag`/`lootTable`——同一个事实只住一个地方。
   * 语义是"这个封存点属于那个隐藏房"：走近立旗（`secret.discovery`）→ 在这里按 E 领取。
   */
  secretId?: string
}

export interface SecretRef {
  id: string
  /**
   * 解锁这条隐藏房的旗标。它的**读方**是派生出来的封存点（见 `InteractableRef.secretId`），
   * **写方**统一在 `worldstate.json`（谁改了世界状态，一张表能查完，不散在代码里）。
   */
  unlockFlag: string
  rewardTable: string
  pos: Vec3
}

/**
 * 可破坏场景物（KI-023，§15.3）：「可被攻击、有耐久、会发声」的环境实体。
 * `Projectiles` 只管弹道、`EntityStats` 只管生物——props 是两者之外的第三类：
 * 站在世界里、占一个命中靶位、有耐久计数，碎了有后果（钩子写在数据里）。
 */
export interface PropRef {
  id: string
  /** 品类决定形状/声音/被击中的反馈；白名单由 validator 钉，新种类随消费方一起落 */
  kind: 'soundspine' | 'resonance_core'
  pos: Vec3
  /** 击碎所需的重击次数（§15.3「重击 4 次击碎」；轻击只敲响不计数——裁决记在 Props.ts 头注释）。
   *  与 `hpFracOfBoss` 二选一：计数型（音刺）vs 血量型（振源核）。 */
  hitsToBreak?: number
  /**
   * 血量型 prop 的池子（KI-022②「每个 18% HP」= Boss 最大生命的这个比例）。
   * 打在核上的每一分**原样变成对 `damageTarget` 的真伤**（外露的器官没有甲），池子打空 = 核碎。
   */
  hpFracOfBoss?: number
  /** 血量型必填：核上掉的血记到谁头上 */
  damageTarget?: string
  /**
   * KI-022②：何时**外露**（可被打、可见）。没外露的核不参与命中、不渲染——
   * 「Finale 场地出 3 个振源核」的意思是它之前不存在，而不是一直蹲在那儿无敌。
   */
  exposedWhen?: { bossId: string; minPhase: number }
  /**
   * 汇聚噪音半径（§15.3「世界噪音汇聚点」）：范围内的玩家声源**听上去发生在刺的位置**——
   * 她会去刺那儿找你，而不是你的真实站位。这是「音刺在场=环境干扰器」的机制读法。
   */
  gatherRadius?: number
  /** 击碎钩子：给谁聋多久（§15.3「碎了让她短暂聋乱 6s（破势窗口）」；360 tick = 6s @60Hz） */
  onBreakDeaf?: { target: string; deafTicks: number }
  /** 击碎那一句 HUD 播报（没有就不播）；文字归数据，运行时只负责念 */
  breakLabel?: string
  /**
   * §13.0「听觉 Sound」的「破坏」那一声（KI-016 收尾）：碎裂是**响的**——归因玩家
   * （因果：没有玩家就没有这一声）、位置在碎片落地处。没写这一格的 prop 碎了等于静音消失，
   * 验证器因此要求必填。音刺 0.9：一根汇聚全场噪音的巨刺碎裂，比弹反更响。
   */
  breakLoudness?: number
}

/**
 * authored 遮挡体（KI-014②）：关卡自己写的、**挡视线与弹道**的一块几何——塌墙、岩脊、回廊墩。
 * 与 `boss.covers`（§15.2 断音柱）的区别只在截面：柱子是圆的、墙是轴对齐的盒子；
 * 两者进同一张名册（`core/Occlusion.OcclusionField`），被同一批读者读（弹体扫掠段 /
 * 打在玩家身上的那一记 / telegraph 红线 / 敌人视觉锥）。
 *
 * **口径与 covers 一致**：`pos` 是**底面中心**（`pos.y` = 墙底所在高度，不是重心），
 * `size` 是全尺寸而不是半宽（"一堵 14×3.4 的墙"比"半宽 7"少一次心算），`heightM` 是高。
 *
 * 这一格回答两件事，而它们读的是**同一个函数的两档**（KI-009 第一腿，2026-09-29）：
 * 「看得见/打得到吗」走 `firstBlock` 的默认口径（起点在体内、贴面都不算挡——站在柱子旁也该能开枪），
 * 「走不走得过」走它的 `strict` 档（体内、贴面都算挡）。数据侧没有第二份几何：把两者各写一份
 * 就会出现"看得见的墙挡住看不见的路"或者反过来——那是"空气墙"这一族里最难查的一种。
 * 两件事仍然**分开问**（`ai.sightBlocked` 与 `ai.nav` 是两个口），因为"挡箭"与"挡路"要的答案
 * 本来就不是同一个（擦着柱面过去的一寸该让箭过，不该让人过）。
 */
export interface WallRef {
  id: string
  pos: Vec3
  size: { x: number; z: number }
  heightM: number
}

/**
 * 世界状态规则（narrative §7 的执行位，Phase 6-A）。
 * 一条规则＝「发生了 X ⇒ 立一个旗标（顺带说一声）」。旗标的读方早就在 `regions.json` 里等着
 * （区域解锁 / 交互物 requiresFlag / 隐藏房封存点），这里只补写方——之前它们一个写方都没有。
 * `on` 的三种取值各自对应一个真实触发器：`firstParry`（玩家第一次成功弹反）、
 * `bossDefeated`（按敌人数据 id）、`interactUsed`（按交互物 id）。规则是幂等的：旗已立就不再动它，
 * 也不再重播一次播报。
 * **刻意没有 `approach`（走近某个坐标就立旗）**——那条要等它对应的隐藏房有了能踩在地板上的领取点
 * 之后再写，否则就是"规则能立旗、旗开了锁、锁后面却没有能按 E 的东西"，等于把 §55 换个方向违反。
 */
export interface WorldStateRule {
  id: string
  on: 'firstParry' | 'bossDefeated' | 'interactUsed'
  /** on=bossDefeated：哪一份敌人数据 */
  dataId?: string
  /** on=interactUsed：哪个交互物被真正用掉（ok=true） */
  interactId?: string
  setFlag: string
  /** 立旗那一句 HUD 播报（没有就不播） */
  notify?: string
}

export interface RegionMusic {
  explore: string
  battle: string
  ambience: string
}

/**
 * docs/audio.md §4 的 L1 一层：一条持续振荡 = 一个声部。
 * **`hz` 是绝对频率而不是相对根音的音程**——"写出来的就是响出来的"，所以这张表不需要第二份
 * 「主音 + 音程 → 频率」的换算住在代码里（那正是 KI-066 拆掉的那种副本：数字有两个主人）。
 */
export interface AmbienceLayer {
  hz: number
  wave: 'sine' | 'square' | 'sawtooth' | 'triangle'
  peak: number
  /** 音分，±50 以内：两条同音层的微失谐就是"暖"的全部来源（§4「大提琴式锯齿」那句） */
  detune: number
}

/** §4 的 L4 稀疏事件，本作实现为音色石铃（`synth.playBell`）；`bell: null` 的那一区见 KNOWN_ISSUES KI-077 */
export interface AmbienceBell {
  /** 铃点候选音（Hz）：这一串就是这一区的"音阶色彩"（§1.2 主音列的听感侧） */
  scale: number[]
  /** [最短, 最长] 间隔秒：每颗铃到点后在这一格现掷 */
  everySec: [number, number]
  /** [最轻, 最响] 峰值：同样每颗现掷 */
  peak: [number, number]
  /** 敲出 FM 亮边的概率（0–1，§4「金属嗡鸣」那一格把它推高） */
  hammerP: number
}

/**
 * docs/audio.md §4 的 L2／L3 两层：一个**有真位置**的声源（KI-083）。
 *
 * 它与 L1 的长处正好相反：L1 是 2D 铺底（听不出在哪），L2/L3 是"走两步就换边"的那一层。
 * 所以 `pos` 是世界坐标（与 `regions.json > landmarks[].pos` 同一帧），validator 拿它与该区
 * `bounds` 对账——落在区外的声源永远听不见，那就等于 §55 说的死数据。
 *
 * `layer` 决定这条源被奏成什么（`src/audio/ambient-field.ts > AmbienceField`）：
 * `'texture'` = §4 的 L2 颗粒声纹（窄带带通里的一颗，是这个场所的**质地**）；
 * `'motion'` = §4 的 L3 物理动源（宽带、一声之内边扫，是"有什么在**动**"）。
 * 这一格同时是数据门的一条判据：§4 那张表每一区都写了 L2 与 L3，空一格就是声景少了一半。
 */
export interface AmbienceSource {
  layer: 'texture' | 'motion'
  /** 带通中心频率（Hz）：写出来就是响出来的，与 `AmbienceLayer.hz` 同一口径 */
  hz: number
  /** 世界坐标：§4「真位置」——声源不跟着玩家走 */
  pos: { x: number; y: number; z: number }
  peak: number
  /** 起音时长（秒）：颗粒是毫秒级、动源是秒级 */
  attackSec: number
  /** 起音之后的衰减时长（秒）：一声一共响 `attackSec + durSec`（`applyEnv` 那条包络的两段） */
  durSec: number
  /** [最短, 最长] 间隔秒：每次响完现掷下一次。`[1.2, 1.2]` 是刻意的零方差（破拍营地那句"整齐得不对"） */
  everySec: [number, number]
}

/**
 * 一张环境声床 = 一个区域的 L1 drone + L2／L3 真位置声源 + L4 铃点（docs/audio.md §4 表里的那一行、§1.2 的主音分配）。
 * `id` 与 `regions.json > music.ambience` 双向对账（少一行 = 那一区永远没有底噪，多一行 = §55 死数据）。
 * `layers` 为空 = 这一区**没有 drone**（未竟厅 §4「无 drone——风箱底噪」），此时 `lpHz`/`breath` 必须缺席：
 * 那两个字段只在 drone 子图上有消费者，留着就是给一张不存在的图配参数。
 * `sources` 必须两层都有：§4 那张表每一区都写了 L2 与 L3，空一格就是那一区的声景少了一半。
 */
export interface AmbienceBed {
  id: string
  layers: AmbienceLayer[]
  /** drone 的暖度低通：§4「大提琴式」「只透低频」的落点。有层就必须有它（没有默认值） */
  lpHz?: number
  /** 风箱呼吸 LFO（调这一层自身的增益，不是全局）：有层就必须有它 */
  breath?: { hz: number; depth: number }
  /** §4 的 L2（颗粒声纹）／L3（物理动源）：真位置声源（KI-083） */
  sources: AmbienceSource[]
  bell: AmbienceBell | null
}

/**
 * §1.2 音乐宪法允许的一种**音高变形**：`R-1`（C–Eb–G–Bb = 半音 [0,3,7,10]）的原形、倒影、逆行。
 * 度数不在数据里——它们由 `src/audio/music.ts > MOTIF_R1` 现推，那张表抄一遍度数就是给同一句话两个主人。
 * 节奏变形（扩张/压缩）不是一种"形"，而是 `beatsPerNote` 那一格：1 = 原样、2 = 扩张（augment）、0.5 = 压缩（diminut）。
 */
export type ExploreForm = 'prime' | 'inversion' | 'retrograde'

/**
 * 一区的探索曲（docs/audio.md §1.2「ambience 与世界音乐层」里"世界音乐层"那一半，KI-079）。
 * 分成两支而不是"五个可选字段"：§1.2 那一格写的是**要么有调、要么无调**，
 * 「无调却写着 peak」这种半真半假的行在类型层就不该写得出来（与 `AmbienceBed` 那对
 * 「有层才有 lpHz/breath」是同一条纪律，只是那里靠 validator、这里靠类型）。
 * `id` 与 `regions.json > music.explore` 双向对账。
 */
export interface ExploreTonal {
  id: string
  form: ExploreForm
  /** 这一区的主音（§1.2 那张表的第一列，绝对 Hz 而不是音名）。validator 钉的是"一区一个"：共用主音 = 跨那两区什么色彩都没换 */
  rootHz: number
  /** 一个音占几拍（相对**当前区域的网格**，所以 84BPM 的营地与 60BPM 的深窖写同一个 2 是完全不同的速度） */
  beatsPerNote: number
  /** 旋律声部波形：与 `AmbienceLayer.wave` 同一份枚举 */
  wave: 'sine' | 'square' | 'sawtooth' | 'triangle'
  /** 声部峰值：与 `AmbienceLayer.peak` 同一量纲，validator 按可听范围判死 */
  peak: number
}

/** 未竟厅那一格：§1.2「C→无调」——这一区**没有调性旋律**，只有 `ambience.json` 那张名册里的半音铃点在奏 */
export interface ExploreAtonal {
  id: string
  form: null
}

export type ExploreScore = ExploreTonal | ExploreAtonal

/**
 * 一区的战斗档（docs/audio.md §1.1 那一行「战斗遭遇」+ §2.2 那张表的"遭遇层"，KI-080）。
 *
 * **这一支里没有任何主音格、也没有任何速度格**，而且是刻意的：
 *  · §1.1 写的是"战斗 = 主音不变、色彩变暗"——主音属于玩法调性系统（全局那个 C），
 *    一旦这张表能写 `rootHz`，"主音不变"就成了可被数据逐区推翻的话；
 *  · 拍长的唯一主人是 `RhythmClock`（KI-066 拆掉 `music.ts > const BPM = 84` 拆的就是这个），
 *    这里写 `bpm` 就是把它请回来当第二个主人。
 * 所以数据能指的只有**这一档的低音走哪一条线、钟隔几小节一次，或者整档什么都不排**。
 * 鼓型（哪几拍驼鼓、哪几拍军鼓）与各家峰值刻意留在 `music.ts`：五档真数据在那一格全同，
 * 一列谁都不同的值都没有的信息量就是 §55 说的死数据 —— 哪天要给某一档换鼓型，再把它加进来。
 */
export interface BattleTonal {
  id: string
  /**
   * 低音 ostinato：每一项是**一个折起来的格子** —— `动机第几音 + 第几档八度`，
   * 解码 `deg = e % 4`、`oct = floor(e / 4)`（`music.ts > battleOstinatoHz`，步长取 `MOTIF_R1.length`）。
   * 为什么不直接写半音数或 Hz：这张表连一个音名都不写，于是 §1.2「一切旋律只许派生自 R-1」
   * 在**形状上**就成立（违宪的音没有写法），而 Hz 的主人照旧是 `music.ts > BATTLE_ROOT_HZ` 那一格
   * ——§1.1「战斗 = 主音不变」说的就是它不许跟着区域走。合法范围由校验器管（`scripts/battle-rules.mjs`）。
   */
  pattern: number[]
  /** 每隔几小节一次钟 accent（§6.1 奥斯塔拉那一格的"每 4 小节一次钟敲"就落在这上面）。≥1：`i % 0` 是 NaN */
  bellEveryBars: number
}

/** 万籁那一格：§6.3「本 Boss 无配乐」——这一档**什么都不排**，是数据说的，不是"表里少写了几格" */
export interface BattleSilent {
  id: string
  noMusic: true
}

export type BattleScore = BattleTonal | BattleSilent

/**
 * docs/audio.md §8.2「Ducking 规则表」的一行（KI-092）。行 = 表里那一**行**，不是那一格：
 * `label` 与文档第一列同字，`targets` 与第二列（MUSIC／AMB 那几个词）同集合，
 * `db`/`holdSec` 与第三列那两个数同值——这一层对账由 `tests/unit/ducking.test.ts` 从文档现推。
 *
 * `trigger` 是**引擎听得懂的那个口**：它的合法值不是词表，而是 `AudioEngine` 里真把触发送进侧链
 * 的那几处调用（`onDuckTrigger('…')` 的字面量实参，由校验器从源码现推）。写一个没人接的口子
 * 就是死数据，与 §55 同源；判据两端都有证人。
 */
export interface DuckRow {
  /** 行键：侧链表里唯一 */
  id: string
  /** §8.2 第一列的原字，用来跟文档对账 */
  label: string
  /** 总线事件名：主人是 `AudioEngine` 的侧链订阅 */
  trigger: string
  /** 被压的总线，名字的主人见 `audio/ducking.ts > DuckBusName` */
  targets: string[]
  /** 压下去的量（dB，必须为负）：换算成增益是 `ducking.ts > duckFactor` 那一步 */
  db: number
  /** 压住多久（秒）后弹回基准电平 */
  holdSec: number
  /** KI-092①（休止状态行）：压下去的斜率（秒）。缺省走 DUCK_TC_SEC；设计给的是 250ms 入 180ms 出 */
  attackSec?: number
  releaseSec?: number
}

/**
 * 需求 §38 / art-direction §8 认的那四档天气。名字的主人**在这里**：`regions.json` 里那些
 * 区域自己的叫法（emberfall／still／drip／hush／stone-wind）不在这张联合里，它们要通过
 * `WeatherRow.docWeather` 挂到某一档上才拿得到读数。校验器把这张联合从源码现推成合法值集合，
 * 所以加一档必须同时给它一个读数载体，否则那一档在数据里永远没人奏（WARN 会说）。
 */
export type WeatherDocId = 'clear' | 'rain' | 'fog' | 'storm'

/**
 * `weather.json` 的一行（KI-094）：一个**数据侧的天气名** ⇄ 它在需求 §38 里那一档 ⇄ 那一档的读数。
 *
 * 三个读数格全部**可选**，因为文档只给了它有话说的格：art-direction §8 的雾密度四档逐名给数，
 * §2 的乘数那句只给 Rain 明度、Fog 与 Storm 对比。没给的格不填——填了就是我编的。
 * `brightnessMul` 因此今天没有任何一行声明它，那是对的（Rain 那一档在 `regions.json` 里没人用）。
 *
 * 唯一读者是 `src/vfx/ColorGrade.ts`：它把雾密度写进 `scene.fog`，把乘数与失谐的褪色合成成
 * 一条 `canvas.style.filter`。没有这一行 ⇒ 区域按基线（`clear`）奏，而那个事实挂在
 * `PENDING_WEATHER_READINGS` 上，不靠注释。
 *
 * **`gameplay` 那一格是另一条腿**（§5.9.33③）：音频／敌人浓度／失谐累积速率。它不在上面那段
 * "文档只给了它有话说的格"的管辖之内——文档对这三腿**一个数都没给**，所以每一颗敢写下来的乘数
 * 都必须挂在 `scripts/weather-rules.mjs > WEATHER_GAMEPLAY_RULINGS` 上写明裁决理由（判据 G1）。
 */
export interface WeatherRow {
  /** 行键 = `regions.json > weatherPresets` 里出现的那个名字 */
  id: string
  /** 它对应需求 §38 的哪一档：读数就是从那一档的文档行来的 */
  docWeather: WeatherDocId
  /** 指数雾密度（art-direction §8「Clear 0.008 / Fog 0.030 / Rain 0.018 / Storm 0.022」） */
  fogDensity?: number
  /** CSS brightness() 的乘子（§2「Rain ×0.8」）；不写 = 1.0 中性 */
  brightnessMul?: number
  /** CSS contrast() 的乘子（§2「Fog 对比 ×0.6、Storm 对比 ×1.15」）；不写 = 1.0 中性 */
  contrastMul?: number
  /** §5.9.33③ 的三条玩法腿（音频／敌人浓度／失谐累积速率）。全可选，缺省即三腿全中性 */
  gameplay?: WeatherGameplay
}

/**
 * `WeatherRow.gameplay` 的三格（§5.9.33③，2026-10-08 落地）。三个乘数共用一套语义：
 * **1 = 这一腿不生效**，>1 = 更响／更聚／更快，<1 = 反过来。
 *
 * 没有"0"这个取值：0 会把一条腿**静默关掉**，而"这一腿不生效"的正确写法是不写这一格
 * （缺省就是 1）。这与 `brightnessMul`/`contrastMul` 那边"写 1 是没有后果的读数"是同一条纪律的
 * 两个方向——那边禁的是"写了等于没写"，这边禁的是"写了等于关掉"。
 */
export interface WeatherGameplay {
  /**
   * 敌人浓度：进格落位时组内铺开半径 **÷ 它**（>1 = 这一组怪聚得更拢）。
   * 为什么是半径而不是条数：slot 条数由 `regions.json > spawnGroups[].count` 写死，运行时没有
   * "多刷几个"的合法来源（裁决全文见 `scripts/weather-rules.mjs > WEATHER_GAMEPLAY_RULINGS`）。
   */
  concentrationMul?: number
  /** 失谐累积速率：`CorruptionMeter` 的环境暴露与精英命中两条路都乘它（`combat/Statuses.ts`） */
  corruptionMul?: number
  /** 声景层增益：`audio.md` §4 的 L2／L3 每一声的距离衰减再乘它（`audio/ambient-field.ts`） */
  ambienceGain?: number
}

/**
 * §6 Cinematics 清单（需求 §31）的一行。
 *
 * **只收"文档写死了"的字段**：`kind`（清单的「类型」列）、`durationMs`（「时长」列）、
 * `lockInput`（"全程无 UI"／出场过场夺权这类**已写明的**行为）、`note`（清单的镜头语言简述）。
 *
 * ⚠️ **`interruptPolicy` 故意不在这里**：`narrative.md` §6 提过"余量给玩家跳过损耗与
 * `interruptPolicy` 降级"，但**从没定义过它的取值**——编一套 `'skippable' | 'locked'` 出来
 * 就是拿猜测冒充设计（KI-049 那族的纪律）。它落之前，这张表只交代上面四格。
 * 判据（单条 ≤25s、全清单 ≤180s）住 `scripts/cinematic-rules.mjs`，与校验器读同一份实现。
 */
/**
 * `lighting.json` 的一行（§37 第一腿）：一个**区域光照预设**（`lp_*`）的取色表。
 *
 * 六色是 art-direction §2 那张「唯一合法颜色表」逐格抄过来的（BASE/SEC/ACCENT/EMIT/SKY/DARK），
 * 一份 hex 一格，没有 ±10% 变体的展开——变体是**取色时**的规则，不是表里该多出来的行。
 * `sky` 可选且三行故意省略：文档自己在那三格写的是「无天光（纯黑）」／「无（地下）」／
 * 「落日渐层 #C56A3E→#6B3F66 两停」——单色格装不下两停，装其中一停就是替作者裁决。
 *
 * `grade` 同理只收文档给了数的两格：art-direction §8 那句「每区 LUT 参数（饱和度/对比/冷暖）」。
 * 文档只对三区给了数（休垒 +0.5 饱和 / 深窖 −35% 饱和 / 未竟厅 +25% 对比），其余四区不填——
 * 填了就是我编的。**「冷暖」那一格整个没建**：文档只给了定性描述（休垒 +暖），没有数值口径，
 * 按 §55 不许拿猜测冒充裁决。文档写的落点 `curves/grading_<区>.json` 是本仓库外的资产目录，
 * 所以同一份读数收在这里——唯一读者（`vfx/ColorGrade.ts`）在仓库里。
 *
 * `lights`（§37 第二腿）只收**文档没给、因而必须显式裁决**的那四格：三层光的强度与 key 的方向。
 * 三层光的**颜色一格都不新开**——art-direction §8 已经把映射写死了（key 色 = SKY 列、point 色 = EMIT 列），
 * hemi 的天色同样随 SKY 列（§5.1「区域色板的 SKY 列决定各区看到的带占比」）。再开六个颜色格就是
 * 给同一件事配第二个主人（KI-066 那一族）。强度与方向文档一个数都没有 ⇒ 落在
 * `scripts/lighting-rules.mjs > LIGHT_RULINGS` 的裁决账本上（判据 L1 盯着"有数必须有理由"）。
 */
export interface LightingRow {
  /** 行键 = `regions.json > lightingPreset` 里出现的那个名字 */
  id: string
  /** 基底（§2 BASE 列） */
  base: string
  /** 次要（§2 SEC 列） */
  sec: string
  /** 点缀（§2 ACCENT 列） */
  accent: string
  /** 发光（§2 EMIT 列） */
  emit: string
  /** 天光（§2 SKY 列）。省略 = 这一区没有天光 ⇒ 雾色只取 DARK */
  sky?: string
  /** 暗部（§2 DARK 列） */
  dark: string
  /** §8 的 LUT 参数（只收给了数的两格）；省略的格按 1.0 中性 */
  grade?: { saturateMul?: number; contrastMul?: number }
  /** 这一行与文档的差之所在（只写"为什么少一格"，不写设计愿景） */
  note?: string
  /**
   * §37 第二腿：三层光里**文档没给数**的那几格（强度 ×3 + key 方向）。
   * 颜色不在这里——§8 已把映射写死（见上面的文件头注），由 `world/Lighting.ts` 现推。
   * 每颗数都必须在 `scripts/lighting-rules.mjs > LIGHT_RULINGS` 上挂着裁决理由（判据 L1）。
   */
  lights?: LightingLights
}

/**
 * 表现层三件套的配置表（Phase B4，KI-135）：`vfx.json` 的三段行形状。
 *
 * **这些是数据形状（纯 JSON，没有 three）**：颜色写 hex 字符串、向量写 `{x,y,z}`、
 * 混合模式写名字（`normal` / `additive` / `multiply`）。
 * 转成 three 的那一步住在 `vfx/VfxConfig.ts`——**表现层自己转**，
 * 依赖方向单向（数据层不认识 three，战斗层也不认识）。
 *
 * 判据（值域、hex 合法、id 跨段不重名）住 `scripts/vfx-rules.mjs`。
 */

/** 一张贴花的配置行（弹痕 / 血迹 / 焦痕 / 裂痕） */
export interface VfxDecalRow {
  id: string
  /** 贴花类型 */
  type: 'bullet' | 'impact' | 'footstep' | 'blood' | 'scorch' | 'crack' | 'custom'
  /** 生命周期（秒），-1 = 永久 */
  lifetime: number
  /** 淡入 / 淡出时长（秒） */
  fadeIn: number
  fadeOut: number
  /** 尺寸区间（米） */
  size: { min: number; max: number }
  /** 颜色（hex）与不透明度 */
  color: { base: string; opacity: number }
  /** 法线强度（贴花投影的凹凸） */
  normalStrength: number
  /** 粗糙度 / 金属度偏移 */
  roughnessOffset: number
  metalnessOffset: number
  /** 是否随机旋转 / 随机缩放 */
  randomRotation: boolean
  randomScale: boolean
  /** 同时存在的上限（池子大小） */
  maxInstances: number
  /**
   * 贴图（可选）：按 id 从注册表取。**本仓今天没有真资产**（KI-008：没有可见窗口也没有
   * 贴图文件），所以表里暂时没有哪一行写它——但字段留着，因为表现层那一格已经接好了
   * （`vfx/Decals.ts` 的 `getOrCreateMaterial`），资产到位时不必改引擎。
   */
  textures?: { albedo?: string; normal?: string; roughness?: string; metalness?: string }
}

/** 一条拖尾的配置行（武器拖尾 / 弹道拖尾） */
export interface VfxTrailRow {
  id: string
  /** 顶点数（历史帧数） */
  segments: number
  /** 宽度曲线 [根部, 尖端] */
  width: [number, number]
  /** 颜色渐变 [根部, 尖端] */
  color: [string, string]
  /** 生命周期（秒） */
  lifetime: number
  /** 贴图（可选，按 id 从注册表取；本仓今天没有真资产，见 `VfxDecalRow.textures`） */
  texture?: string
  /** 混合模式 */
  blending: 'normal' | 'additive' | 'multiply'
  /** 是否随武器旋转 */
  followRotation: boolean
  /** 最小发射间距（米） */
  minEmitDist: number
}

/** 一个粒子发射器的配置行 */
export interface VfxEmitterRow {
  id: string
  type: 'burst' | 'stream' | 'trail' | 'ribbon'
  /** 粒子上限 */
  maxParticles: number
  /** 生成率：stream 是每秒个数，burst 是一次性个数 */
  spawnRate: number
  /** 生成形状 */
  spawnShape: 'point' | 'sphere' | 'box' | 'cone' | 'disc'
  /** 生成范围（米） */
  spawnSize: { x: number; y: number; z: number }
  /** 寿命区间（秒） */
  lifetime: { min: number; max: number }
  /** 尺寸两端（米） */
  size: { start: number; end: number }
  /** 颜色两端 */
  color: { start: string; end: string }
  /** 初始速度区间（米/秒） */
  velocity: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }
  /** 加速度（米/秒²） */
  acceleration: { x: number; y: number; z: number }
  /** 重力（米/秒²，负数向下） */
  gravity: number
  /** 阻尼（每秒） */
  drag: number
  /** 混合模式 */
  blending: 'normal' | 'additive' | 'multiply'
  /** 是否写深度 */
  depthWrite: boolean
  /** 是否随距离缩小 */
  sizeAttenuation: boolean
  /** 轨迹型专用：轨迹长度（帧） */
  trailLength?: number
  /** 缎带型专用：缎带宽度 */
  ribbonWidth?: number
}

/** `vfx.json` 整张表：三段（与 `movements.json` 同一族"一张表几段"的形状） */
export interface VfxTable {
  decals: VfxDecalRow[]
  trails: VfxTrailRow[]
  emitters: VfxEmitterRow[]
}

/**
 * §8「每区三层光：极光 hemi（§5）+ 区域 key（方向光，色=SKY 列）+ 局部 point（火/钟/矿，色=EMIT）」。
 *
 * 这里只放**文档没给、必须显式裁决**的四格；`keyIntensity: 0` 是文档自己开的那道口子
 * （「深窖除外——其唯一光源是矿缝」），所以 0 在这个字段上是合法值而不是坏读数。
 */
export interface LightingLights {
  /** 极光 hemi 强度（无太阳世界的主光源，§5） */
  hemiIntensity: number
  /** 区域 key 方向光强度；0 = 这一区没有方向光（§8 的深窖例外） */
  keyIntensity: number
  /** key 方向光的方向（世界坐标，从被照物指向光源；§5.1「主方向光方向始终指向 BAND-A 脊线法线」） */
  keyDir: [number, number, number]
  /** 局部 point 强度（火/钟/矿；色恒为该行 EMIT 列） */
  pointIntensity: number
}

export interface CinematicRow {
  /** `CINE_*`：清单的 ID 列，也是对话节点/选项上 `cinematic` 字段引用的那个名字 */
  id: string
  /** §6 清单「类型」列（开场／出场／剧情／胜利／结局／蒙太奇）——**自由文本**：
   *  不在 schema 里编一套枚举，因为清单是设计侧的写法，且并行会话已按自己的拼法落了表 */
  kind: string
  /** 毫秒。判据：单条 ≤ 25s、全清单 ≤ 180s（§6） */
  durationMs: number
  /** 演出期是否夺走玩家输入。**可选**：读方缺省按 false（不夺），
   *  这样"表里还没交代这一格"与"明确不夺"不会在运行时被混为一谈——前者是数据欠账，后者是设计 */
  lockInput?: boolean
  /** 清单里那句镜头语言简述（**不是**新写的内容，是文档原文的缩写） */
  note?: string
}

export interface RegionData {
  /**
   * **序章目标**（KI-141）：这一区在**任何任务开始之前**该先找的人/地方。
   *
   * 形状与任务步的 `marker` 同一套（同一个 `QuestMarker` 联合）——**一个主人**：
   * HUD 只有一个 `objective` 字段，序章指向与任务步指向走同一条解析与画法。
   * 省略 = 这一区没有序章（那就在任务开始前没有指向）。
   */
  prologueMarker?: QuestMarker
  id: string
  /** IP_SEED §14 registered vocabulary */
  nameKey: string
  displayName: string
  /** unlock order along the 12-beat slice loop (IP_SEED §15) */
  order: number
  biome: 'hub' | 'forest' | 'ruins' | 'underground' | 'camp' | 'dungeon' | 'boss_arena'
  bounds: RegionBounds
  /** walkable surface height of this layer; used by world/Surface.ts floor queries */
  groundY: number
  /**
   * §2.1 的区域网格表（雾语林 84 / 营地 84（军鼓）/ 钟坠院 92 / 沉唱堂 96 /
   * 无耳深窖=无网格领域（只有 60BPM 心跳）/ 未竟厅=恩希尔私有时钟接管前的余拍）。
   * **必填，没有默认值**：只有每个区域自己声明，才不会出现「全作一张 84 的拍表」这种
   * 悄悄写死在 main.ts 里的东西；Boss 的 `boss.bpm` 是叠在它之上的临时接管，要还得回去。
   */
  grid: { bpm: number; beatsPerBar: number; label?: string }
  /**
   * §11 失谐 Corruption（褪色值）的区域侧：写这一格＝**非安全区**，站着就按 `perSec` 累积。
   * 全作只有无耳深窖（哑带渗漏最重的地方）声明它 ⇒ 「能进，但要在计时器内决策」这条
   * 压门（gameplay.md §7）由数据成立，而不是由代码里的一句 `if (region.id === 'rg_earless_deeps')`。
   * 满值后的掉血也在同一格里判：没有这一格的区域天然安全。
   */
  corruption?: { perSec: number }
  /**
   * §9.4 区域上修（KI-030①）：这一方天地里掉的装备，`atOrAbove` 及以上的档位权重 ×`mul`。
   * 深窖是"门票"而不是"惩罚"——文档给的补偿形状就是这一格。不写的区域权重原样不动；
   * **上修只歪权重，不保证任何一件**（保证 ≥ 地板是全局大保底的活，两条不许合并）。
   */
  loot?: { rarityBoost?: { atOrAbove: string; mul: number } }
  chunkSize: number
  navmeshRef?: string
  /**
   * 这一区**可能**处于的那几个天气（KI-094）。读法有两条，各有一半今天成立：
   * ① `[0]` 是这区无人打扰时的驻留天气（今天唯一的读者 `vfx/ColorGrade.ts` 就按这一格奏）；
   * ② 后面的格子是"铃姨修钟之后这一区换成的样子"（IP_SEED §7 / narrative §9 `STATE.BELLS.*`），
   *    那条**切换今天没有人写**——它要的是任务线给的世界状态，没接线这件事记在
   *    `scripts/validate-data.mjs` 的 `PENDING_WEATHER_READINGS` 账上，不靠这句注释。
   * 每个名字都要在 `weather.json` 里有行或挂在 pending 名单上，拼错就是一片区域静默走基线。
   */
  weatherPresets: string[]
  /**
   * 「这一区的第二格天气由谁拨」（art-direction §8.1.2 选 A，KI-094② 的最后两格）。
   *
   * 为什么需要它：`weatherPresets[1]` 的条件此前提炼自"本区那口被任务线追踪的钟"——它能覆盖
   * 低语林／沉唱堂／钟坠院，却说不出口另外两种世界变化：营地那份走的是**对话抉择立的旗**
   * （`flag.brokenbar_resolved`，写方不在本区任何交互物上），休垒那份走的是**值域**
   * （`state.bells.fourth_dumb` 的四格，而值域没有区属）。这一格把"区属"显式声明出来：
   * 区属由 regions.json 说，不由值域自己携带。
   *
   * 两种形与既有两套读数对齐，不新造语法（`in` 与 `QuestStep.advanceOn.state` 同一形状）：
   *  - 旗形 `{ flag }`：那面旗立着 ⇒ 换格；
   *  - 值域形 `{ state: { key, in } }`：那一格的值落进 `in` ⇒ 换格（休垒只把 RUNG/MELTED/SEALED
   *    算"她做了决定"，`INTACT` 不算——还没抉择不构成换天的理由）。
   * 不写这一格时退回既有推导（数本区被追踪的钟），两种来源**不叠加**：一个第二格只能有一个
   * 主人，同时在场由 `weather-rules.mjs` 的 S1 记 ERROR。
   */
  weatherSwitch?: { flag: string } | { state: { key: string; in: string[] } }
  /**
   * §37 区域光照预设 ⇒ `lighting.json` 的行键（KI-094 同族）。这个名字**必须有真读者**：
   * `vfx/ColorGrade.ts` 按它写雾色与 LUT 乘数（`world/Lighting.ts` 出读数）。
   * 三层光那一半（hemi/key/point）要真几何与真光源，属 KI-008，不在这一列里。
   * **这不是下面的 `palette`**：那是 §10 身份色（灰盒/地图），这是 §2/§8 大气色（雾/LUT/灯源）；
   * 两套同名不同义，见 `RegionPalette` 的注释，不许互相推导。
   */
  lightingPreset: string
  /** §10 身份色（灰盒/地图）——与 `lightingPreset` 的 §2/§8 大气色是两套，见 `RegionPalette`，不许互相推导 */
  palette: RegionPalette
  spawnGroups: SpawnGroup[]
  landmarks: Landmark[]
  interactables: InteractableRef[]
  /** 可破坏场景物（KI-023）；不写 = 这个区域没有场地实体（多数区域如此） */
  props?: PropRef[]
  /**
   * authored 遮挡体（KI-014②）：塌墙/岩脊这类**挡视线与弹道**的关卡几何。
   * 不写 = 这片地方是开阔地，远程与 telegraph 谁也不被什么挡住。
   */
  walls?: WallRef[]
  music: RegionMusic
  /** higher loads first inside the same ring (technical-architecture §5.5) */
  streamingPriority: number
  /** boss arenas preload their whole field, not just the near rings */
  preloadWhole?: boolean
  unlockFlag?: string
  secrets: SecretRef[]
  storyHooks: string[]
}
/**
 * 立项目录里写过的 `data/bosses/*.json` 与 `BossData` 接口**已合并落地**（KI-038）：
 * Boss 不是「另一种敌人」，她就是 `enemies.json` 里那条带 `boss` 段的数据（私有拍速、阶段、
 * 机关、入场与胜利序列全在那一段）。拆成两个文件只会让「她有几阶」这件事有两处可写，
 * 而两处可写就有一处会撒谎。本文件的这些 interface + `src/data/json/*.json` 才是真源。
 */

/* ============================ Narrative：NPC / 对话 / 任务（Phase 6-B） ============================ */

/**
 * 条件谓词（narrative.md §3.1）：**NPC 可见对话节点集 = Filter(树, f(quest.state, relation, flags))**。
 * 五种谓词对应五种"玩家做过什么"的记法，全部只读、不求值副作用——所以同一棵树能被
 * 预览、能被测试穷举，也不会出现"打开对话就改了世界"这种事。
 */
export interface DialogueCondition {
  /** 旗标组合：all 全立 / any 任一 / not 全不立（§3.2 的 world.flags） */
  flags?: { all?: string[]; any?: string[]; not?: string[] }
  /** 关系阈值（§3.1 的 npc.relation，-5..+5） */
  relation?: { npc?: string; op: 'gte' | 'lte' | 'eq'; value: number }
  /** 任务状态：in = 正处在这些 state 之一；gte = 已推进到该 state 或更后 */
  quest?: { id: string; in?: string[]; gte?: string }
  /** 持有物品（「自行检视断面」这类动作靠它表达：背包里真有那截舌头才算知情） */
  hasItem?: { id: string; count?: number }
  /**
   * 值域状态（narrative §7 `STATE.*`）：`eq` 单值、`in` 任一、`notIn` 都不是。
   * 与 `flags` 的分工——旗标记"发生过没有"，值域记"落在哪一格"，两者都不许互相冒充
   * （用三个互斥布尔冒充一个枚举，就会出现"两个都立了"这种没人裁决的局面）。
   * 未写入时读到 `states.json` 声明的 `default`。
   */
  state?: { key: string; eq?: string; in?: string[]; notIn?: string[] }
}

/**
 * 对话效果（§3.2 的 effects）。**引擎只产出这张清单，不自己写世界**——
 * 真正落盘由调用方走既有通道（旗标走 `world.flag` 广播、物品走背包、任务走 Quests），
 * 于是"对话改了世界"这件事在日志里与"战斗改了世界"是同一条路径。
 */
export interface DialogueEffects {
  /** 关系增量；npc 缺省 = 本棵树的 npc */
  setRelation?: { npc?: string; delta: number }
  setFlags?: string[]
  clearFlags?: string[]
  /** 开始一条任务线（把它从"未开始"推到第一步） */
  startQuest?: string
  /** 推进任务；to 缺省 = 顺推一步 */
  advanceQuest?: { id: string; to?: string }
  giveItem?: { id: string; count?: number }
  takeItem?: { id: string; count?: number }
  /** 结算时的一句播报（走 HUD 通知队列） */
  notify?: string
  /**
   * **写一格值域状态**（`state.*`）。与 `setFlags` 的分工同上：旗标记事件，值域记结局；
   * 一次三选一的抉择落下去，世界从此只认一个取值，不会与别的"旗标"打架。
   * key/value 必须在 `states.json` 里登记过——引擎侧（WorldStates.set）认不出就拒写并广播告警。
   */
  setState?: { key: string; value: string }
}

export interface DialogueChoice {
  id: string
  text: string
  /** §3.2：blunt/poetic/silent/provoke —— 引擎只透传给 UI 与关系增量符号，不做玩法分支 */
  style: 'blunt' | 'poetic' | 'silent' | 'provoke'
  conditions?: DialogueCondition
  effects?: DialogueEffects
  /** 下一个节点；null/缺省 = 对话结束 */
  next?: string | null
  /** 挂接 §6 过场清单；**已接**（`Settlement.ts` 读它 → `DialogueDeps.playCinematic` → `main.ts` 的 `Cinematics.start`） */
  cinematic?: string
}

export interface DialogueNode {
  id: string
  speaker: string
  text: string
  emotion?: string
  conditions?: DialogueCondition
  /** 进入即结算（§3.2 的 onEnter） */
  effects?: DialogueEffects
  choices?: DialogueChoice[]
  next?: string | null
  /** 一次性节点：看过就不再进（"看过"进档，读档后不会重复演） */
  once?: boolean
}

export interface DialogueData {
  id: string
  npc: string
  /** 同一个 NPC 挂多棵树时，priority 大的先选（后段剧情压前段） */
  priority?: number
  /** 进门条件：不满足就换下一棵树（"可见对话节点集 = Filter(树, 条件)"的第一层） */
  entry?: DialogueCondition
  rootNode: string
  /** rootNode 的条件不满足时退到哪个节点（初见 / 复访两种开场） */
  fallbackNode?: string
  nodes: DialogueNode[]
}

export interface NpcData {
  id: string
  nameKey: string
  displayName: string
  /** 一句话人设（面板与调试用） */
  blurb: string
  homeRegion: string
  /** 初始关系（-5..+5，§3.1） */
  relation?: number
}

/**
 * 任务步骤（需求 §28：完成条件是「改变世界的状态」或「玩家做出的知情决定」，
 * 不是"去那里杀 10 只回来"）。所以一步的推进条件只有三种来源：某个旗标被立起、
 * 某一格值域状态落进一组取值（`advanceOn.state`），或者对话里的一次选择直接推进
 * （`DialogueEffects.advanceQuest`）。三者都只是"世界读数变了"，谁也不许偷偷改任务面板。
 */
/**
 * §28 的任务标注图例（narrative.md）：D=发现 C=抉择 H=隐藏信息 M=多结果。
 * validator 的 `QUEST_TAGS` 自 KI-086 起从这条声明现读，不再手抄——那四字母原来只写在文档里，
 * 代码侧是 `tags?: string[]`（什么都能塞），于是"标注"这件事没有任何一个地方能回答"合法取值到底是哪些"。
 * 今天没有 UI 读它（消费方是 validator 的名册判据本身）；要加第五种标注，先给它一个读者。
 */
export type QuestTag = 'D' | 'C' | 'H' | 'M'

/**
 * **目标指示**（KI-137）：这一步指向世界里的哪一个点。
 *
 * **只有四种形态**，因为世界上只有这四种"能指的东西"：一个人、一个可交互物、一片区域、一个坐标。
 * 坐标不写在任务表里（那是**世界的位置**，住在 regions.json）——任务表只说"去找铃姨"，
 * 位置由那一区的交互位给出（见 `src/quest/Objectives.ts` 的解析）。
 */
export type QuestMarker =
  | { kind: 'npc'; id: string }
  | { kind: 'interact'; id: string }
  | { kind: 'region'; id: string }
  | { kind: 'pos'; pos: { x: number; y: number; z: number } }

export interface QuestStep {
  state: string
  label: string
  /**
   * 这一步的**目标指示**：HUD 据此在屏幕边缘画一枚指向它的箭头（KI-137）。
   * 省略 = 这一步没有世界指向（纯对话抉择一类的步骤）⇒ HUD 不画。
   */
  marker?: QuestMarker
  /**
   * 任一旗标被立 ⇒ 顺推一步。**这里就是那些旗标的读方**（§55 的双向对账靠它闭合）。
   * `flags` 与 `state` 至少给一个（校验脚本负责把关）。
   */
  advanceOn?: { flags?: string[]; state?: { key: string; in: string[] } }
  /** §28 标注：见 `QuestTag`（词表对账把 validator 的名册钉在这条声明上） */
  tags?: QuestTag[]
}

export interface QuestData {
  id: string
  nameKey: string
  displayName: string
  /** 发布者（必须是 npcs.json 里的 id） */
  npc: string
  /** 完成后的世界状态摘要（叙事评审用；不是玩法数值） */
  outcome: string
  steps: QuestStep[]
}

/**
 * **值域型世界状态**的登记项（`states.json`，narrative §7 的 `STATE.<域>.<对象> = <枚举>`）。
 * 表存在的意义是把三件事钉死在数据里：一共几格、缺省哪格、谁说了算。
 * `default` 就是"这一格从来没被写过"时读到的值——它必须是 `values` 里的一员，
 * 因为"抉择还没做"本身就是这个状态机的一格（第四种结局，而不是第五种谓词）。
 */
export interface WorldStateDef {
  /** 全局唯一，形如 `state.bells.fourth_dumb` */
  key: string
  /** 面板与调试器里显示的名字 */
  displayName: string
  /** 全部合法取值，顺序即面板里显示的顺序 */
  values: string[]
  /** 从未写入时的读数 */
  default: string
  /** 这一格要回答的叙事问题与取值裁决（叙事评审读这里，引擎不读） */
  note?: string
}
