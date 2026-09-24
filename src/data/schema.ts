/** All timing in logic ticks (1 tick = 1/60 s). See docs/technical-architecture.md §3. */

import type { ActionName } from '@/core/Input'

export interface HitboxCone { shape: 'cone'; angleDeg: number; radius: number; height: number; offsetY: number }
export interface HitboxSphere { shape: 'sphere'; radius: number; offsetY: number; offsetFwd: number }
export interface HitboxRing { shape: 'ring'; inner: number; outer: number; forward: number }
export type Hitbox = HitboxCone | HitboxSphere | HitboxRing

export interface CancelRule { to: string; fromTick: number }

/**
 * 弹道规格（combat.md §4.3 引针枪「投掷枪」/ §5 远程威胁）。挂在动作帧上，
 * 玩家武器与敌人招式共用同一份表 ⇒ 同一套弹道运行时（combat/Projectiles.ts）。
 */
export interface ProjectileSpec {
  /** 表现层按 kind 选模；未知 kind 走默认弹头 */
  kind: 'spear' | 'note' | 'shard'
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
  /**
   * 连发（combat.md §14.4 针喉「三叠箭」）：count 发、默认每 everyTicks 一拍序发一发。
   * `at` 给出每发相对 activeStart 的显式帧位（缺省位用 everyTicks 补），用来写「第 2 拍延迟 0.25 拍的假动作」。
   */
  burst?: { count: number; everyTicks: number; at?: number[] }
  /** 出手前画可见预告线（§14.4「赤线 telegraph，线终点=落点」），长度取招式 startup 帧 */
  telegraph?: boolean
  /** 打点（on-beat）投出的弹体保留架式加成快照 */
  sfxLaunch?: string
  sfxHit?: string
  vfxHit?: string
  shake?: 'graze' | 'normal' | 'heavy' | 'boss'
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
  /** 存在 = 这是一个投掷/射击动作：进入 activeStart 时发射弹体，hitbox 可以缺席 */
  projectile?: ProjectileSpec
  lunge?: number
  shake?: 'graze' | 'normal' | 'heavy' | 'boss'
  sfx?: string[]
  vfx?: string[]
  loudness?: number
  beatQuant?: number[]
  flags?: string[]
  /** 显式 fissureLayers（震裂，§11）；不写则走按键默认（charged=2 / h=1） */
  fissureLayers?: number
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
}

export interface WeaponData {
  id: string
  nameKey: string
  archetype: 'straight_sword' | 'greatsword' | 'spear' | 'bow' | 'staff' | 'unique'
  movesetId: string
  atkBase: number
  scaling: Partial<Record<AttrKey, number>>
  swingTag: string[]
  skill: string
  poiseMul?: number
  noiseMul?: number
}

export type AttrKey = 'str' | 'dex' | 'ton' | 'vig' | 'ovr' | 'fis'

export interface AttackSpec {
  id: string
  frames: FrameData
  beat: number[]
  parryable: boolean
  reaction?: 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5'
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
         */
        reclaim: { neutralTicks: number; overdrive: number }
      }
      /**
       * 本阶强制排进去的「读条招式」（4-E 的 ai.selfToll 语义提升到阶段级：阶段会变，所以挂在阶段上）。
       * heal 省略 = 不回血，只是「到点必须做的一件事」——§15.1 P2 的「每 2 小节换乐句停顿 0.5s
       * （呼吸拍=处决/喝药窗）」就是这一条。
       */
      barCast?: { everyBars: number; attackId: string; heal?: number; label?: string }
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
     * 断音柱（§15.2「躲入场地断音柱后」）：玩家站在柱内而攻击者在柱外 ⇒ 这一击被柱子吃掉。
     * 这是 KI-014 那条真 LOS（墙体射线）在灰盒期的**显式近似**：掩体必须由数据点名，
     * 而不是从几何推出来。将来接上遮挡射线时，本字段应退化成「射线打到了什么」。
     */
    covers?: { positions: { x: number; y: number; z: number }[]; radius: number }
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
  guard: { startupTicks: number; reduction: number; staPerDmg: number; bleedPoiseFrac: number; /** §5.2 对远程：完美格挡把弹体弹回原主人，带走的比例 */ perfectBlockReflectMul: number; /** §13.0「听觉 Sound」的第四路：格挡接准那一记闷响的响度（未乘武器/词缀） */ impactLoudness: number }
  perfectBlockWindow: number
  parry: { activeTicks: number; whiffRecovery: number; poiseDamage: number; stunTicks: number; overdriveGain: number; /** §5.3 弹反弹道：反射回原主人的伤害比例（100%） */ projectileReflectMul: number; /** §13.0「听觉 Sound」：弹反那记钟响的响度（未乘武器/词缀），比踏地更响 */ impactLoudness: number }
  roll: { total: number; iframeStart: number; iframeEnd: number; dist: number; backDist: number; stamina: number; lockOnDist: number; lockOnIframes: [number, number] }
  execution: ExecutionConfig
  attrs: Record<AttrKey, number>
  attrUpCost: number
  rankXpCurve: { base: number; a: number; b: number }
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
export interface OriginData {
  id: string
  nameKey: string
  displayName: string
  attrs: Record<AttrKey, number>
  weaponId: string
  /** 出身自带的一件护甲/音徽（可为空） */
  gearIds?: string[]
  blurb: string
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
  stat?: 'poiseDmg' | 'defense' | 'staminaRegen' | 'critRate' | 'execDmg' | 'noiseMul'
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
  milestones: { rank: number; id: string; label: string }[]
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
   * 消耗品：使用效果。`heal` 回血（回响膏）；`corruption` 为负数=刮掉多少失谐（音色晶）。
   * 只写有消费方的字段——消耗音效属于 Phase 8 音频系统的工作，届时再回表。
   */
  use?: { heal?: number; corruption?: number }
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
}

/** 谱册的一页。点亮页=把它的工具箱打开（§7.1）；来源是数据里点名的物品，不是代码里的 if。 */
export interface MovementPage {
  id: string
  nameKey: string
  displayName: string
  desc: string
  /** 点亮这一页要吃掉的东西（振源核/乐谱残页——§7.1 的两条解锁源） */
  unlock: { item: string; count: number }
}

/** 主动槽。`milestone` 指向 progression.json 的里程碑 id：几级开槽由那张表说，这里不抄第二遍数 */
export interface MovementSlotDef {
  index: number
  action: ActionName
  milestone: string
}

export interface MovementConfig {
  slots: MovementSlotDef[]
  pages: MovementPage[]
  movements: MovementData[]
  /** 升级花费（index 0 = 升到 2 级）。§6.2：战技乐谱升级 40-200/级 */
  upgradeCost: { level: number; timbite: number; score: number }[]
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

/** hex strings; must match IP_SEED §10 区域色板 */
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
  kind: 'checkpoint' | 'elevator' | 'bridge' | 'soundwall' | 'gather' | 'chest' | 'npc' | 'teleport' | 'gate' | 'bell'
  /** 提示文案里的动词，覆盖按 kind 的默认值（如吊机 ≠ 共鸣井）；Phase 6 换成本地表 key */
  verb?: string
  pos: Vec3
  /** one-way shortcut lock: opens once, then stays open from this side only */
  oneWay?: boolean
  requiresFlag?: string
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

export interface RegionData {
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
  chunkSize: number
  navmeshRef?: string
  weatherPresets: string[]
  lightingPreset: string
  palette: RegionPalette
  spawnGroups: SpawnGroup[]
  landmarks: Landmark[]
  interactables: InteractableRef[]
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
 * 四种谓词对应四种"玩家做过什么"的记法，全部只读、不求值副作用——所以同一棵树能被
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
  /** 挂接 §7 过场清单（Phase 6-C 接；现在只透传，不假装演过） */
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
 * 不是"去那里杀 10 只回来"）。所以一步的推进条件只有两种：某个旗标被立起，
 * 或者对话里的一次选择直接推进（`DialogueEffects.advanceQuest`）。
 */
export interface QuestStep {
  state: string
  label: string
  /** 任一旗标被立 ⇒ 顺推一步。**这里就是那些旗标的读方**（§55 的双向对账靠它闭合） */
  advanceOn?: { flags: string[] }
  /** §28 标注：D=发现 C=抉择 H=隐藏信息 M=多结果 */
  tags?: string[]
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
