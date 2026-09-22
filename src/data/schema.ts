/** All timing in logic ticks (1 tick = 1/60 s). See docs/technical-architecture.md §3. */

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
  /** explicit 震裂 (fissure) layers applied on hit; overrides the key-based default */
  fissureLayers?: number
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
}

export interface EnemyData {
  id: string
  nameKey: string
  archetype: 'basic' | 'heavy' | 'ranged' | 'assassin' | 'support' | 'elite' | 'miniboss' | 'boss'
  hp: number
  poise: number
  speed: number
  defense?: number
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
     * §14.7 悬钟骑士的钟甲：**正面** `arcDeg` 锥内的玩家伤害乘 `dmgMul`（0.6 = 减伤 40%）。
     * 消费口只有 `CombatManager.strikeEnemy` 这一条（近战与弹体共用），所以「从哪打进来」
     * 必须在那里判——背刺/侧击/背后来的弹体一律全额。被震裂满层打碎后 `Enemy.armorBroken`
     * 置位，本条永久失效（一次性奖励，不给它长回去）。
     */
    armorFront?: { arcDeg: number; dmgMul: number }
    /**
     * §14.7「每 4 小节敲钟自鸣回 15 HP（必须打断的软计时器）」：
     * 每逢 `everyBars` 小节的第 1 拍，若它正打着，就强制插入 `attackId` 那招（长前摇、可打断）。
     * 回血发生在该招的 `startup` 帧：前摇里被打断（硬直/破势都会清空 `attack`）⇒ 一分不回。
     */
    selfToll?: { everyBars: number; attackId: string; heal: number }
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
      /** 护壳：吃这一阶伤害时乘 `dmgMul`，`immuneToPoise` = 打不出架势 */
      shell?: { dmgMul: number; immuneToPoise: boolean }
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
  guard: { startupTicks: number; reduction: number; staPerDmg: number; bleedPoiseFrac: number; /** §5.2 对远程：完美格挡把弹体弹回原主人，带走的比例 */ perfectBlockReflectMul: number }
  perfectBlockWindow: number
  parry: { activeTicks: number; whiffRecovery: number; poiseDamage: number; stunTicks: number; overdriveGain: number; /** §5.3 弹反弹道：反射回原主人的伤害比例（100%） */ projectileReflectMul: number }
  roll: { total: number; iframeStart: number; iframeEnd: number; dist: number; backDist: number; stamina: number; lockOnDist: number; lockOnIframes: [number, number] }
  execution: ExecutionConfig
  attrs: Record<AttrKey, number>
  attrUpCost: number
  rankXpCurve: { base: number; a: number; b: number }
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
}

export interface SecretRef {
  id: string
  unlockFlag: string
  rewardTable: string
  pos: Vec3
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
export interface BossData {
  id: string
  nameKey: string
  baseEnemy: string
  hp: number
  regionId: string
  beatSignature: { bpm: number; num: number; den: number }
  phases: {
    enterHpGte?: number
    enterHpLt?: number
    btOverride?: string
    music?: string
  }[]
  rewards: { skill?: string; items?: string[] }
}
