import { bus } from '@/core/EventBus'
import { Vector3 } from 'three'
import { GameTime, TICK_DT, TICK_HZ } from '@/core/Time'
import { GameLoop } from '@/core/GameLoop'
import { Input, pumpMenu, type MenuOwner, type MenuPump } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions, worldstate, dialogues, quests as questTable, worldStates as worldStateDefs, cinematics as cinematicRows } from '@/data'
import { resolveMarker } from '@/quest/Objectives'
import { respawnTarget, type RespawnPost } from '@/world/Respawn'
import type { ItemData, MovesetData, NpcData, RegionData, Vec3, WeaponData } from '@/data/schema'
import { createArena } from '@/world/PlaceholderArena'
import { activeWeather, questTrackedFlags } from '@/world/WeatherSwitch'
import { ambienceGain, concentrationMul, corruptionMul, weatherRowOf } from '@/world/WeatherEffects'
import { blendLightRigs, lightingLights, lightingRow } from '@/world/Lighting'
import { SceneLights } from '@/world/SceneLights'
import { Cinematics } from '@/world/Cinematics'
import { StreamingSystem, chunkKeyOf, type ChunkState } from '@/world/Streaming'
import { Surface } from '@/world/Surface'
import { SpawnDirector } from '@/world/SpawnDirector'
import { Interactables, takeInteractEdge } from '@/world/Interactables'
import { ObserveSystem, OBSERVE_RADIUS, OBSERVE_TRAVEL_TICKS } from '@/world/Observe'
import { PropSystem } from '@/world/Props'
import { PropVisuals } from '@/world/PropVisuals'
import { ChunkGreybox } from '@/world/ChunkGreybox'
import { WallGreybox } from '@/world/WallGreybox'
import { InteractableGreybox } from '@/world/InteractableGreybox'
import { ActorVisuals } from '@/world/ActorVisuals'
import { ProjectileVisuals } from '@/world/ProjectileVisuals'
import { BossArenaVisuals } from '@/world/BossArenaVisuals'
import { PlayerController } from '@/player/ThirdPersonController'
import { CameraRig } from '@/player/CameraRig'
import { LockOn } from '@/player/LockOn'
import { AISystem } from '@/ai/AISystem'
import { Navigator } from '@/ai/Navigation'
import { CombatManager } from '@/combat/CombatManager'
import { glossary } from '@/combat/Statuses'
import { AudioEngine } from '@/audio/AudioEngine'
import { Haptics } from '@/input/Haptics'
import { GameplaySettingsStore } from '@/settings/GameplaySettings'
import { VfxLayer } from '@/vfx/VfxLayer'
import { ColorGrade } from '@/vfx/ColorGrade'
import { Hud } from '@/ui/Hud'
import { Stakerite } from '@/ui/Stakerite'
import { MapUI } from '@/ui/MapUI'
import { TitleScreen } from '@/ui/TitleScreen'
import { DialogueBox } from '@/ui/DialogueBox'
import { CombatDebugger } from '@/tools/CombatDebugger'
import { DebugPanel } from '@/tools/DebugPanel'
import { enemyPanelText } from '@/tools/EnemyDebugger'
import { questPanelText, questRows } from '@/tools/QuestDebugger'
import { aiPanelText } from '@/tools/AIDebugger'
import { SaveGame, LocalStore, IdbStore } from '@/save/Serializer'
import { SlotRoster } from '@/save/Slots'
import { Checkpoints } from '@/save/Checkpoint'
import { WorldState } from '@/quest/WorldState'
import { WorldStates } from '@/quest/WorldStates'
import { Quests } from '@/quest/Quests'
import { DialogueEngine, type DialogueContext } from '@/quest/Dialogue'
import { DialogueSession } from '@/quest/Settlement'
import { RpgRuntime } from '@/rpg/Runtime'
import { KillSettlement, openLootTable, refreshPlayer, gearLabel, type SettlementDeps } from '@/rpg/Settlement'

registerGameData()

const canvas = document.createElement('canvas')
canvas.style.position = 'fixed'
canvas.style.inset = '0'
document.getElementById('app')!.appendChild(canvas)

const time = new GameTime()
const input = new Input(canvas)
const rhythm = new RhythmClock()
rhythm.setBpm(84, 4)

const arena = createArena(canvas, rhythm)
const rig = new CameraRig()
/**
 * §37 第二腿：三层光（极光 hemi / 区域 key / 局部 point）。与 `ColorGrade` 并列的第二个画面读者，
 * 两者都只吃 `world/Lighting.ts` 的读数。建在 `createArena` 之后立刻由 `applyLighting` 喂第一次——
 * 灰盒场地是 `MeshStandardMaterial`，没有灯就是一团黑，而这一帧之前没有别的人会点灯。
 */
const lights = new SceneLights(arena.scene)

/**
 * 成长系统（Phase 5-B）。出身决定初始六维与初始装备，`?origin=origin_drummer` 可换定弦。
 * 玩家手里的武器**来自背包**：不是「按 1/2/3 就能变出三把剑」，而是"你拥有哪几把"。
 */
const params = new URLSearchParams(location.search)
const originId = params.get('origin') ?? 'origin_tuner'
/** `?seed=` 钉住掉落掷骰（§10「随机种子入档 ⇒ 可复现 QA」）；不传则用 RpgRuntime 的那颗默认种子 */
const rpg = new RpgRuntime(originId, params.get('seed') ?? undefined)
const startWeaponId = rpg.mods().weaponId ?? 'wp_tuning_sword'
const weapon = registry.get<WeaponData>(startWeaponId)
const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
const player = new PlayerController(playerBase, weapon, moveset)

/**
 * §6 过场清单的播放器（需求 §31）。**逻辑层**：它只回答"哪一条在跑 / 还剩多久 / 该不该夺输入"，
 * 镜头轨道与字幕时序要真几何与相机（KI-008 / KI-010），那条腿没接。
 * 今天接了五处触发：**新开局**放开场（读档不放——开场是"第一次醒来"，不是"每次回到调音桩"）、
 * 三条 Boss 出场挂在进区域、一条剧情挂在对话选择上（`Settlement` 经 `playCinematic` 走到这里）、
 * 胜利那一条挂在主 Boss 倒下。清单 10 条里还剩 4 条**未接**（剧情 B7 与三条结局向的），
 * 它们的接点是终局分支，如实记在架构文档那张表里。
 */
const cinematics = new Cinematics(cinematicRows)

/**
 * **过场的进出事件在这里发**（`cinematic.start` / `cinematic.end`）。
 *
 * 为什么由组合根发而不是让 `Cinematics` 播放器自己发：播放器是**纯逻辑、零总线**的一条小机
 * （`src/world/Cinematics.ts` 只回答"哪一条在跑、还剩多久、该不该锁输入"），让它去碰总线就多了一份
 * 依赖方向。而"有演出开始了"这件事本来就是**世界里发生的事**——相机要据此切模式、表现层要据此换镜，
 * 所以由**组合根**（唯一知道"演出真的放起来了"的地方）广播出去。
 *
 * **认不出的 id 不发事件**：起都没起，就不该有一条"演出开始了"（不静默开始一个空演出——
 * 那是账上写着有、实际什么都没发生的形状）。
 */
function startCinematic(id: string): boolean {
  const row = cinematicRows.find((r) => r.id === id)
  if (!cinematics.start(id)) return false
  bus.emit('cinematic.start', { id, durationMs: row?.durationMs })
  return true
}

/**
 * 手动收束一条过场（玩家跳过 / 被战斗打断）：收束事件与"起"那一半成对。
 * 排队的那条照常接上（`Cinematics.skip` 自己会接），接上时**也会**发一次 `cinematic.start`。
 */
function skipCinematic(): void {
  const wasId = cinematics.current?.id ?? null
  cinematics.skip()
  const nowId = cinematics.current?.id ?? null
  if (wasId !== null && wasId !== nowId) bus.emit('cinematic.end', { id: wasId })
  if (nowId !== null && nowId !== wasId) {
    bus.emit('cinematic.start', { id: nowId, durationMs: cinematicRows.find((r) => r.id === nowId)?.durationMs })
  }
}

/**
 * §6 三条 **Boss 出场**过场挂在"进区域"上（`CINE_OPEN` 之外的第二类触发）。
 * 为什么是"进区域"而不是"Boss 交手"：§6 写的是**出场**——那一下发生在开打之前，
 * 而"进区域"正是这一刻在数据里最诚实的代理（区域网格表本来就在这一步换拍、换雾、换音乐）。
 * **一条一局只放一次**（`playedCinematics`）：出场是"第一次看见它"，不是"每次路过都演一遍"。
 */
const BOSS_INTRO_BY_REGION: Record<string, string> = {
  rg_drowned_choir: 'CINE_OST_INTRO', // 奥斯塔拉（Mini Boss，§6）
  rg_unfinished_hall: 'CINE_HERSIL_INTRO', // 恩希尔（主 Boss，B7）
  rg_earless_deeps: 'CINE_MYRIAD_INTRO', // 万籁（隐藏 Boss，无耳深窖）
}
const playedCinematics = new Set<string>()

/** 把成长/装备的汇总灌进玩家（升级、换装、强化、洗点、掉落之后都要调一次）。本体在 rpg/Settlement.ts，可被 flow 测试直接跑 */
function refreshRpg(): void { refreshPlayer(rpg, player) }

/** 背包里拥有的武器件（1/2/3 键按这个顺序切换；没有的武器切不出来） */
function ownedWeaponUids(): string[] {
  return rpg.inv.gears
    .filter((g) => registry.maybeGet<ItemData>(g.itemId)?.kind === 'weapon')
    .map((g) => g.uid)
}
function selectWeaponSlot(slot: number): void {
  const uid = ownedWeaponUids()[slot]
  if (!uid) { bus.emit('ui.notify', { text: `第 ${slot + 1} 把武器：尚未拥有`, kind: 'info' }); return }
  const res = rpg.equip(uid)
  if (!res.ok) return
  refreshRpg()
  bus.emit('ui.notify', { text: `装备 · ${gearLabel(rpg, uid)}`, kind: 'info' })
}

const lock = new LockOn(player, playerBase.lockOn)
const ai = new AISystem()
const nav = new Navigator() // KI-009 第一腿：敌人的绕路（读者只有 Enemy.stepToward 一处）
const combat = new CombatManager(player, ai, time, rhythm)
const visuals = new ActorVisuals(arena.scene, arena.playerVisual, player)
visuals.camera = rig.cam
const projectileVis = new ProjectileVisuals(arena.scene)
const bossArena = new BossArenaVisuals(arena.scene) // §15.1 撞钟机关：机关看不见就等于不存在
const audio = new AudioEngine()
const vfx = new VfxLayer(arena.scene)
const rain = new (await import('@/vfx/RainSystem')).RainSystem(arena.scene)
const trails = (await import('@/vfx/Trails')).initTrailSystem(arena.scene)
const decals = (await import('@/vfx/Decals')).initDecalSystem(arena.scene)
/**
 * KI-135：粒子系统**第一次被初始化**。此前只注册了总线（`registerGPUParticlesBus`），
 * 而那个注册函数读的是模块级单例 `gpuParticles`——没人调 `initGPUParticles` 时它是 null，
 * 于是 `vfx.burst` 这个频道"有人听、没人说"：命中爆发那条发射方接了也炸不出东西。
 * 这一行就是那个 null 与"有东西可炸"之间的距离。
 */
;(await import('@/vfx/GPUParticles')).initGPUParticles(arena.scene)

// VFX 系统总线注册（Phase B4）
;(await import('@/vfx/GPUParticles')).registerGPUParticlesBus()
;(await import('@/vfx/Trails')).registerTrailSystemBus()
;(await import('@/vfx/Decals')).registerDecalSystemBus()
// KI-136：世界事件 → 表现层的接线归**一处**（`vfx/VfxEmitters.ts`）——
// "敌人倒了会出什么东西"是同一件事，散在三个模块里就成了三个主人。
;(await import('@/vfx/VfxEmitters')).registerVfxWorldEmitters()

// Squad 系统总线注册（Phase B5）
;(await import('@/ai/Squad')).registerSquadBus()

// KI-094①：雾密度与画面滤镜的唯一写方。它按「当前生效的那格天气 + §11 失谐」合成，
// 所以开局那一区也得由它读一次——那句在 `interact` 之后（要读旗标），见下面 `applyWeather(homeRegion …)`。
const grade = new ColorGrade(arena.scene, canvas)
const hud = new Hud(document.getElementById('hud') as HTMLCanvasElement)
/** 飘字要钉在世界坐标上：HUD 不认识相机，投影由这里喂进去（§8.2 ms_crit_ring 的腿） */
hud.project = (p) => {
  const v = new Vector3(p.x, p.y, p.z).project(rig.cam)
  if (v.z > 1 || v.z < -1) return null
  return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (1 - (v.y * 0.5 + 0.5)) * innerHeight }
}
/**
 * 目标指示的**边缘投影**（KI-137）：目标在画面里就给它的位置；在画面外（或在相机背后）
 * 就沿"屏幕中心 → 它"的方向夹到视口边缘内侧，HUD 在那儿画一枚箭头。
 *
 * **背后的目标为什么要翻一下**：`Vector3.project` 对相机背后的点会把 x/y 取反，
 * 直接用会让箭头指向**反方向**（"往回走"却指向前方）。翻回正号才是"它在背后"的正确读法。
 */
hud.projectEdge = (p) => {
  const v = new Vector3(p.x, p.y, p.z).project(rig.cam)
  const behind = v.z > 1
  if (behind) { v.x = -v.x; v.y = -v.y }
  let x = (v.x * 0.5 + 0.5) * innerWidth
  let y = (1 - (v.y * 0.5 + 0.5)) * innerHeight
  const inside = !behind && x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight
  if (!inside) {
    const cx = innerWidth / 2
    const cy = innerHeight / 2
    let dx = x - cx
    let dy = y - cy
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) { dx = 0; dy = -1 } else { dx /= len; dy /= len }
    const margin = 48
    const tx = Math.abs(dx) < 1e-6 ? Infinity : (innerWidth / 2 - margin) / Math.abs(dx)
    const ty = Math.abs(dy) < 1e-6 ? Infinity : (innerHeight / 2 - margin) / Math.abs(dy)
    const t = Math.min(tx, ty)
    x = cx + dx * t
    y = cy + dy * t
  }
  return { x, y, onScreen: inside }
}
/**
 * 调音桩面板（需求 §41/§44）。**只在调音桩前能打开**——分配点数与洗点是"回到基地"的奖励，
 * 不是随时可用的作弊菜单；这条约束同时也是 §8.3「实验成本前置」的设计落点。
 */
const panel = new Stakerite(rpg, {
  onApply: () => refreshRpg(),
  notify: (text, kind) => bus.emit('ui.notify', { text, kind: kind ?? 'info' }),
  onUse: (eff) => {
    if (eff.heal > 0) player.stats.heal(eff.heal)
    // 音色晶刮掉的是失谐（数据里是负数=往下刮）；归零发生在调音桩，这里是"路上应急"
    if (eff.corruption < 0) player.corruption.purge(-eff.corruption)
    if (eff.heal > 0 || eff.corruption < 0) player.publishStats()
  },
  // 面板只"提出"关闭；解冻世界与恢复吃输入是这一处的活（KI-061：以前遮罩点击直接 hide，
  // 结果背景点一下 = 游戏冻在看不见的地冻里，键盘也一起哑）
  onRequestClose: () => setPanelOpen(false),
}, {
  // 存档页（KI-025②）：面板只拿到"读名册/写这一格/删这一格"三个动作，键位与落盘都不归它管
  list: () => saveRoster.list(),
  write: (slot) => saves.save(slot),
  erase: (slot) => saves.erase(slot)
})
/**
 * 对话框（Phase 6-B）。它只回吐玩家的选择，效果由 `showTurn` → `applyDialogueEffects` 统一落盘：
 * UI 不做第二个真值（与调音桩面板同一条纪律）。
 */
const dialogueBox = new DialogueBox({
  onChoose: (choiceId) => talk.choose(choiceId),
  onAdvance: () => talk.advance(),
  onClose: () => talk.close(),
})
dialogueBox.setSpeakerResolver((id) => registry.maybeGet<NpcData>(id)?.displayName ?? id)

/**
 * 区域图（需求 §43，`ui/MapUI.ts`）。**Tab / 手柄 6 号键开的是它** —— TD-002 那条「按着地图的名字在调音」
 * 从这里结案：`map` 这个虚拟按钮的名字与职责终于一致了。
 *
 * 依赖全部注入、面板自己不养第二份事实：区名/坐标/色板/拍网来自 `regions.json`，「踏足」只有一个读数
 * （`streaming.isExplored`），通行设施是 `Interactables` 的现读清单 + 它自己的 `stateOf`。
 * 它**不落任何快旅**（§4.3 那条要等「详图选中调音桩 → 确认」，登记在 KI-087）。
 */
const mapUi = new MapUI(regions, {
  regionAt: (pos) => streaming.regionAt(pos),
  isExplored: (pos) => streaming.isExplored(pos),
  chunkSize: () => streaming.chunkSize,
  playerPos: () => player.pos,
  // 镜头朝向 = 从相机指向玩家（相机在 target + (sin yaw, cos yaw)·dist，见 CameraRig §update）
  viewDir: () => ({ x: -Math.sin(rig.yaw), z: -Math.cos(rig.yaw) }),
  facilities: () => interact.all.map((it) => ({
    id: it.id, kind: it.kind, state: interact.stateOf(it),
    regionId: it.regionId, regionName: it.regionName, pos: it.pos,
  })),
  // 与调音桩面板同一条纪律（KI-061）：面板只"提出"收起来，解冻世界与交还输入是持有者的活
  onRequestClose: () => setMapOpen(false),
})

/**
 * 在场的菜单 = `core/Input.ts` 的那四格所有权（KI-062 第二腿之后，对话框与标题屏也在这一个值域里）。
 * 别名而不是重写一遍字面量：词表只有 `MenuOwner` 一份，这里再抄一次就是第二份账。
 */
type Overlay = MenuOwner | null
/**
 * **overlay 的唯一所有者**（KI-097 收拢 KI-061/KI-062 那两半）：世界停摆、输入所有权、菜单意图的
 * 认领与交还，全在这一处。四块菜单互相排他——同时开着两块 overlay = 两份 uiStep 抢同一条意图通道，
 * 而 `paused`/`enabled` 会由先关的那一块解开（那个 bug 与「点背景冻死游戏」同族）。
 *
 * `input.uiOwner = ` 因此**在 main.ts 里只有一处**：它不是 `panel`/`map` 的字面量，而是这个 `Overlay`
 * 变量本身——所有权的值就是"哪一块 overlay 在场"，第二处赋值等于第二份答案。
 */
let overlay: Overlay = null

function setOverlay(open: Overlay): void {
  overlay = open
  if (open === 'panel') { mapUi.close(); panel.show() }
  else if (open === 'map') { panel.close(); mapUi.show() }
  // 'dialogue' / 'title'：两块面板都收，但世界同样停摆、通道同样有人认领——
  // 走的是同一条腿，不给它们另开一套"只暂停不认领"的旁路（那正是两个主人的形状）。
  else { panel.close(); mapUi.close() }
  // uiOwner：菜单读数的所有权（KI-062）。开着才发意图、关着一格都不发，也不抢浏览器的默认行为。
  // 玩法那条（enabled）与这条是两件事：世界停摆期间正是菜单需要读数的时候。
  time.paused = overlay !== null
  // 过场期也夺输入（`cinematics.inputLocked`）：夺的是**玩法那条**，菜单那条（uiOwner）照旧
  input.enabled = overlay === null && !cinematics.inputLocked
  input.uiOwner = overlay
}

/** 调音桩/商摊面板（既有调用点的名字不变：`__caesura.setPanelOpen`、面板的 onRequestClose） */
function setPanelOpen(open: boolean): void { setOverlay(open ? 'panel' : null) }
/** 地图（`map` 键与面板的 onRequestClose 走它） */
function setMapOpen(open: boolean): void { setOverlay(open ? 'map' : null) }
const overlayOpen = (): boolean => overlay !== null
new CombatDebugger()
const haptics = new Haptics(input)

const missingRefs = StreamingSystem.collectMissingRefs(regions, (id) => registry.has(id))
if (missingRefs.length) bus.emit('log', { level: 'warn', msg: `MissingRef: ${missingRefs.join(', ')}` })
const streaming = new StreamingSystem(regions)
streaming.teleport(0, player.pos) // 起始区同步加载（§5.5 传送遮蔽等价物）
const homeRegion = streaming.regionAt(player.pos)
let shownRegion = homeRegion?.id ?? null
// KI-077（docs §1.2/§4）：开局那一张环境声床。这一句必须在 `audio.start()` 之前发——
// 建图要等首次用户手势，而 `AudioEngine` 缓存事件，所以"玩家出生在哪一区"这件事不会丢。
if (homeRegion) {
  bus.emit('audio.music.ambience', { id: homeRegion.music.ambience })
  bus.emit('audio.music.explore', { id: homeRegion.music.explore }) // KI-079：同一句理由，开局那一区的旋律也要在建图之前缓存住
  bus.emit('audio.music.battle', { id: homeRegion.music.battle }) // KI-080：同上，第一次交战之前就得把那一区的战斗档递到
}
const surface = new Surface(regions, 0.5, (r) => !streaming.isRegionUnlocked(r))
combat.floorAt = (pos) => surface.floorAt(pos)?.y ?? null // 弹道撞地：射进灰盒地板就落地
/**
 * 值域型世界状态（Phase 6-B，narrative §7 的 `STATE.<域>.<对象> = <枚举>`）。
 * 放在交互物**之前**：`requiresState` 的闸门要在这里注入（世界层不认识 quest 层，
 * 组合根是唯一能同时看见两边的地方）。规则表在 `data/json/states.json`。
 */
const worldStates = new WorldStates(worldStateDefs)
const interact = new Interactables(
  regions,
  (r) => streaming.isRegionUnlocked(r),
  6,
  (req) => worldStates.matches(req.key, req.value),
)
/**
 * **重生点**（KI-157）：gameplay.md「重生点｜最近的调音桩（视觉：桩亮=可复活）」那一行今天第一次有载体。
 *
 * 组合根做三件事，**判据本身不在这里**：① 把七根调音桩从 `regions.json` 里挑出来（`kind === 'checkpoint'`）；
 * ② 把"亮没亮"的读法接上（`interact.hasFlag` —— 玩家共鸣过桩，那面 `flag.checkpoint_*` 就立着）；
 * ③ 把算出来的重生目标（注：位置**与地板**一起，叠层世界里桩与死亡点不在一层）注进玩家。
 *
 * **为什么判据住在 `world/Respawn` 而不是这里**：它是"哪几根桩、亮没亮、多远"的**世界数据**推导，
 * 组合根只做接线；规则改一个字，这里不该跟着改。
 */
const respawnPosts: RespawnPost[] = regions.flatMap((r) =>
  (r.interactables ?? [])
    .filter((i) => i.kind === 'checkpoint')
    .map((i) => ({ id: i.id, pos: { x: i.pos.x, y: i.pos.y, z: i.pos.z }, litFlag: i.setsFlag ?? null })),
)
player.respawnTarget = () => {
  const { post, pos } = respawnTarget(respawnPosts, player.pos, (f) => interact.hasFlag(f))
  const floorY = surface.floorAt(pos)?.y ?? 0
  if (post) bus.emit('log', { level: 'info', msg: `respawn -> ${post.id} @${pos.x},${pos.y},${pos.z}` })
  return { pos, floorY }
}
/**
 * KI-105 声纹观察：按住 V 荡开涟漪，波前扫到的敌人/交互物显形（gameplay.md §2.1）。
 * 逻辑住在 `world/Observe`（纯函数、headless 可量），这里只做两件装配：
 * 把 held 状态与玩家位置喂进去、把它报出的点画成 VfxLayer 的环——
 * 大波纹的逻辑波前与视觉波前共用同一份半径算式，圈就是判据本身。
 */
const observe = new ObserveSystem()
/**
 * KI-094②：「修钟之后这一区的天气换掉」那条切换第一次有运行时读者（`world/WeatherSwitch`，
 * 为什么判据是任务线那份旗标名册见那个文件的头注）。旗标的真源在 `world/Interactables`，
 * 这里只借它的读法 ⇒ 画面侧仍然只有一个写方（`vfx/ColorGrade`），而"拨到哪一格"由数据推导，
 * 组合根里没有一处写着区 id 或旗标名的白名单。
 *
 * 这一句排在 `interact` 之后而不是"开局那一区"那一处：旗标读者在 `interact` 立起来之前会踩到
 * 未初始化的 const（TDZ），而开局那次读必须走同一条推导腿——读两次不等于读一次，两处算法才是真的两份账。
 */
const trackedBells = questTrackedFlags(questTable)
/**
 * art-direction §8.1.2 选 A 之后，切换的来源有两种（`world/WeatherSwitch.ts` 的头注）：
 * 本区被追踪的钟（既有）与 `regions.json > weatherSwitch` 的显式声明。后者的值域形要读一格
 * `state.*`，所以这里把 `worldStates.get` 一并递进去——**不递就等于那一形永远不成立**，
 * 而"没接读者"与"值域没动"在画面上是同一片雾，只能在这里分开。
 */
const applyWeather = (rg: RegionData | null): void => {
  const name = activeWeather(rg, (k) => interact.hasFlag(k), trackedBells, (k) => worldStates.get(k))
  grade.setWeather(name)
  /*
   * KI-130：雨第一次有读者。`RainSystem.setWeather` 从 e7313f4 起就存在，但没有任何一处调用它——
   * 两格 `docWeather: "rain"` 的天气因此从来不下雨。与 `grade` 同一条推导出口，不另算一遍名字。
   */
  rain.setWeather(name)
  /*
   * §5.9.33③：同一条名字推出另外三条腿——声景增益（audio）、失谐累积速率（corruption）、
   * 敌人浓度（spawner）。四路都从这里推，因为"这一区此刻奏哪一格天气"只许有一个推导入口；
   * 在四个读者各自现推一遍，就是给同一句话配四个主人（KI-066 那一族）。
   * 三个读数全部缺省中性（`world/WeatherEffects`），所以没有 gameplay 的天气走这条路与从前逐字相同。
   */
  const row = weatherRowOf(name)
  audio.setWeatherGain(ambienceGain(row))
  player.corruption.weatherMul = corruptionMul(row)
  spawner.setConcentration(concentrationMul(row))
}
/**
 * §37 第一腿：这一区的**光**跟着区域换（雾色 + LUT 两格）。与天气分开两路，因为它们本来就是两格
 * （§5.9.33 欠账②那句「别把它们合成一个假的仲裁者」）：天气会随旗标/值域在一区之内切换，
 * 光照只随区域走，所以它不听 `world.flag`／`world.state`——听了也是同一份读数，白算。
 */
const applyLighting = (rg: RegionData | null): void => {
  grade.setLighting(lightingRow(rg?.lightingPreset ?? null))
}

/**
 * §2 跨区过渡带（art-direction §2：「色板按 70/30→30/70 线性混合，过渡长度 ≥ 150m，禁止硬切」）。
 *
 * 与 `applyLighting` 分开两路，因为**两者的节拍不同**：那一只在换区那一刻读一次，这一只每帧读——
 * 过渡带是"走过去的"，不是"跨过去的那一帧"。读数是 `streaming.paletteBlendAt(pos)`：
 * 站在边界上 50/50，往自己区里走 150m 退到 100% 自己（带子半宽的裁决见 `TRANSITION_HALF_M`）。
 *
 * 每帧算但不每帧写：`ColorGrade.apply()` 对 filter 字符串与雾色各有一条短路，
 * `SceneLights` 改的是灯的参数而不是 DOM。所以这条路在带子外几乎是免费的。
 */
const syncLightingBlend = (pos: Vec3): void => {
  const blend = streaming.paletteBlendAt(pos)
  const rowA = lightingRow(streaming.regionAt(pos)?.lightingPreset ?? null)
  const rowB = blend ? lightingRow(blend.to.lightingPreset) : null
  const w = blend ? blend.t : 0
  grade.setLightingBlend(rowA, rowB, w)
  // 三层光那一侧：一侧读不出就用另一侧（与 `blendLightingSnapshot` 同一条口径，不猜中间色）
  const rigA = lightingLights(rowA)
  const rigB = lightingLights(rowB)
  // point 挂在该区**第一个 landmark** 上（§8 那句「局部 point（火/钟/矿）」的落点：骨腔／石冢／断祭坛／
  // 石桥／第一口钟／矿缝／管风琴）。三层光 Rig 全库只此一个写方，每帧读一次（带子外几乎免费）；
  // 文档没说 point 挂哪，这是实施期裁决，理由记在 `scripts/lighting-rules.mjs > LIGHT_RULINGS`。
  const anchor = streaming.regionAt(pos)?.landmarks[0]?.pos ?? null
  lights.setRig(rigA && rigB ? blendLightRigs(rigA, rigB, w) : rigA ?? rigB, anchor)
}
applyLighting(homeRegion ?? null)
// 修钟那一刻人往往就站在那口钟旁边：旗标一广播就重算，否则天气要等下一次跨区才跟得上（IP_SEED §7 说的那件回报）。
// 值域那一形同理——《该不该敲响》的抉择一落地，休垒的天就要跟着换，而下一次跨区可能是几分钟后。
bus.on('world.flag', () => applyWeather(streaming.regionAt(player.pos) ?? null))
bus.on('world.state', () => applyWeather(streaming.regionAt(player.pos) ?? null))
/**
 * 可破坏场景物（KI-023，§15.3 音刺）。三根汇音刺与万籁同区：她的「听」在 sink 这一站被
 * 重定向到刺上，碎刺的聋乱窗经 `world.propBroken` 由 AISystem 落账，碎裂状态跟着存档走（v8）。
 */
const props = new PropSystem(regions, (r) => streaming.isRegionUnlocked(r))
ai.noiseSink = (src) => props.sinkNoise(src)
ai.props = props // KI-024：万籁的场地阶段入口吃这个现状
combat.props = props
// KI-022②：振源核的外露判定与血量池物化都从「当前那只 Boss」读——
// world 层不认识 AI，这条注入是它们之间唯一的一根线
props.bossQuery = (dataId) => {
  const b = ai.enemies.find((e) => e.data.id === dataId && e.alive)
  return b ? { hpMax: b.stats.hpMax, phase: b.bossPhase, alive: true } : null
}
// KI-023① 声东击西的弹药源：背包里的音色晶 + 它的投掷参数（数据在 items.json 的 use.throw）
combat.crystalSource = () => {
  const def = registry.maybeGet<ItemData>('it_timbre_crystal')
  const n = rpg.inv.count('it_timbre_crystal')
  if (!def?.use?.throw) return null
  return {
    available: n,
    consume: () => { rpg.inv.remove('it_timbre_crystal', 1) },
    spec: def.use.throw
  }
}
const propVis = new PropVisuals(arena.scene, regions, (r) => streaming.isRegionUnlocked(r), (p) => props.isExposed(p))
const greybox = new ChunkGreybox(arena.scene, regions, streaming.chunkSize)
/**
 * authored 墙体（KI-014②）：灰盒与逻辑名册读**同一份** `regions.json > walls`。
 * 两边各算一套尺寸就会出现"看不见的墙挡住了看得见的路"——那比没有墙更糟。
 */
const wallGreybox = new WallGreybox(arena.scene, regions, (pos) => { const c = streaming.cellOf(pos); return chunkKeyOf(c.cx, c.cy, c.cz) })
const loadedStates: ChunkState[] = ['active', 'resident', 'preloading']
wallGreybox.syncLoaded(loadedStates.flatMap((s) => streaming.byState(s).map((c) => c.key))) // 构造前就加载好的格：等不到下一次跨格事件
/**
 * **地板灰盒也来一次**（KI-183）：`streaming.teleport(0, player.pos)` 在第 339 行就把开局那批
 * chunk 事件发出去了，而 `new ChunkGreybox(...)` 在这之后 ⇒ 那些格子的地板**永远不会被铺上**。
 * 后果不是"少一块地板"，是**玩家开局站在 PlaceholderArena 那张深色大地面上**：
 * 整幅画面下半屏是黑的（实机像素读数：下半 1.18/255；传送一次重新触发事件后 94.41/255），
 * 而这正是用户报的「场景太黑了，啥都看不清」。墙灰盒早就有了这个补丁（上面那行），
 * 地板灰盒当时漏了——**同一族病，两个表现层只修了一个**。
 */
greybox.syncLoaded(loadedStates.flatMap((s) => streaming.byState(s).map((c) => ({
  key: c.key,
  regionId: c.regionId,
  cx: c.cx, cy: c.cy, cz: c.cz,
  center: c.center,
  state: c.state,
  priority: c.priority,
  tick: 0,
}))))
// 关卡侧遮挡名册跟着脚下这片天走（Boss 的柱子每 tick 重名点，墙只在跨区时动一次）
let wallsRegion = shownRegion
combat.occlusion.syncAuthored(streaming.regionAt(player.pos) ?? null)
/**
 * **玩家与 authored 墙的碰撞**（KI-154）：注入的是**同一本**遮挡名册（箭、视线、敌人绕路、
 * 相机撞墙用的都是它）——玩家这边不许再写一份墙的尺寸，那才是"两把尺"。
 *
 * 传**活引用**（取名册的函数）而不是拷贝：那份名册是就地改写的（换区域就换内容），
 * 拷一份会在跨区时变成"玩家撞的是上一片天的墙"。
 */
player.occluders = () => combat.occlusion.list()
// 相机碰撞读**同一份**遮挡名册（与挡箭、挡视线同一批盒子）：相机撞墙与箭被墙挡住不许各写一份几何，
// 否则"看着穿过去了"与"箭飞过去了"会各说各话。传**活引用**即可——那份名册是就地改写的
// （换区域重写墙、每 tick 重名点 Boss 的柱子），相机跟着它走，不必每帧重建。
rig.setOccluders(combat.occlusion.list())
// KI-009 第一腿：绕路读**同一份**墙（`regions.json > walls`），换区域时和遮挡名册一起换。
// 两份名册各自持有一条同源同构的墙表，这不是"两个真源"——它们是同一份数据在同一处的两次投影，
// 而且判据共用同一个 `firstBlock`（口径差在 `strict` 那一档，见 core/Occlusion）。
nav.syncAuthored(streaming.regionAt(player.pos) ?? null)
// KI-014②b：AI 的视线借**同一份**名册（§13.0 视觉列的后半句）。名字里那个 `blocked` 就是
// 弹道读的那一条线 ⇒ "这堵墙挡住了箭、却挡不住目光"从这一刻起不成立。
ai.sightBlocked = (a, b) => combat.occlusion.blocked(a, b)
// KI-009 第一腿：脚步的绕路口（同上的那个函数、那一档 strict）。空名册与没有注入是同一种效果：
// `next` 返回目标本身 ⇒ 直线追击，与这一腿之前逐字节相同。
ai.nav = (from, to, radius) => nav.next(from, to, radius)
/**
 * 世界状态写入层（Phase 6-A）：`regions.json` 里那些被读的旗标需要一个**写方**，否则藏在门后的
 * 内容根本不可达（KI-041）。规则住在 `data/json/worldstate.json`，这一层只管"触发了就广播"。
 */
const worldState = new WorldState(worldstate, {
  hasFlag: (k) => streaming.hasFlag(k),
  setFlag: (k) => streaming.setFlag(k)
})
/**
 * 叙事层（Phase 6-B）：任务状态机 + NPC 关系 + 对话引擎。
 * 三者共用**一个**上下文（旗标 / 关系 / 任务步 / 背包 / 已读），所以"对话看得见什么"
 * 与"任务推进到哪"永远是同一份事实——不存在 UI 与逻辑各记一套的情况。
 */
const quests = new Quests(
  questTable,
  (e) => {
    bus.emit('ui.notify', {
      text: e.started ? `新的委托 · ${e.label}` : `委托推进 · ${e.label}`,
      kind: e.started ? 'boss' : 'reward',
    })
  },
  // 顺序补判要读世界旗标：玩家可能先捡到东西再接到委托（生产路径的唯一注入点）
  (k) => streaming.hasFlag(k),
)
/**
 * **目标指示**（KI-137）：任务步变了 ⇒ HUD 上的箭头要跟着指到新地方。
 *
 * 三件事各归一家：① 任务机只说"这一步有一个 marker"（原样透传，不认识世界坐标）；
 * ② `quest/Objectives.ts` 把 marker 解析成世界坐标（它认识 regions.json 的结构，HUD 不该认识）；
 * ③ 这里（组合根）把坐标喂给 HUD，投影与夹取也在这一侧（相机在这儿）。
 */
bus.on('quest.changed', (p) => {
  if (p.completed) { hud.objective = null; return }
  hud.objective = resolveMarker(p.marker, regions)
})
/**
 * **序章目标**（KI-141）：铃姨线要**跟她说话才开始**（`DLG_BELLTONGUE` 的 n0 两个选项都带
 * `startQuest: q_bells`）⇒ 在那之前 HUD 上没有任何指向，玩家只能自己乱转找那个白色人形。
 * 区域行上那一格 `prologueMarker` 说的就是"开任务之前先找谁"（形状与任务步的 marker 同一套）。
 *
 * **谁在什么时候喂它**：开跑时（`startRun`）喂一次——那时还没有任何任务步，序章指向是唯一的方向；
 * 一旦有任务开始，`quest.changed` 那一格把目标换成任务步自己的（**HUD 只有一个 objective 字段**，
 * 两个主人会打架）。
 */
const applyPrologueObjective = (): void => {
  const region = streaming.regionAt(player.pos)
  hud.objective = resolveMarker(region?.prologueMarker, regions)
}
const dialogueEngine = new DialogueEngine(dialogues, quests)
const dialogueCtx: DialogueContext = {
  hasFlag: (k) => streaming.hasFlag(k),
  relation: (npc) => quests.relation(npc),
  questState: (id) => quests.state(id),
  questIndex: (id) => quests.stepIndex(id),
  hasItem: (id, count = 1) => rpg.inv.count(id) >= count,
  hasSeen: (d, n) => quests.hasSeen(d, n),
  state: (k) => worldStates.get(k),
}

const nodes = new InteractableGreybox(
  arena.scene, regions,
  (pos) => { const c = streaming.cellOf(pos); return chunkKeyOf(c.cx, c.cy, c.cz) },
  (k) => streaming.hasFlag(k),
  (req) => worldStates.matches(req.key, req.value),
)
nodes.syncActive(streaming.byState('active').map((c) => c.key)) // 起始格在构造前就已激活，补一次

/**
 * 对话会话（Phase 6-B）：编排住在 `quest/Settlement.ts`（那里才有 §59 的闭环测试），
 * 这里只把它接到组合根的五样东西上——叙事进度、背包、旗标广播、播报、世界停摆开关。
 */
const talk = new DialogueSession({
  quests,
  engine: dialogueEngine,
  ctx: dialogueCtx,
  inv: rpg.inv,
  setFlag: (k, v) => streaming.setFlag(k, v),
  setState: (k, v) => worldStates.set(k, v),
  notify: (text, kind) => bus.emit('ui.notify', { text, kind: kind ?? 'info' }),
  refresh: () => refreshRpg(),
  /**
   * 对话的"暂停世界"就是**认领 overlay**（KI-062 第二腿）：以前这一句自己写 `time.paused` 与
   * `input.enabled`，是 overlay 那处之外的第二个写方，而对话框因此只能自己挂一条 DOM `keydown`
   * 才读得到键。现在它和面板一样只从 `uiStep` 读数，暂停/所有权/交还回到 `setOverlay` 那一处。
   */
  setPaused: (paused) => setOverlay(paused ? 'dialogue' : null),
  present: (view) => { if (view) dialogueBox.show(view); else dialogueBox.hide() },
  // §6 过场（Phase 6-C）：选择挂了 `cinematic` 就放它。认不出的 id **不静默吞**——
  // 数据门禁（`cinematic-rules.mjs`）已经保证表里的 id 都在清单里，认不出就是有人写错了字。
  playCinematic: (id) => {
    if (!startCinematic(id)) bus.emit('log', { level: 'warn', msg: `未知过场 id：${id}（清单里没有）` })
  },
})

/** 与 NPC 交谈：没有可说的话就说明一句，不弹空框 */
function openDialogue(npcId: string): void {
  if (talk.open(npcId)) return
  const name = registry.maybeGet<NpcData>(npcId)?.displayName ?? '对方'
  bus.emit('ui.notify', { text: `${name}没有说话（这条线还没写到这里）`, kind: 'info' })
}

/** 交互物落地：调音桩休息、机关传送（= UE 的 Level Streaming 遮蔽传送） */
function applyInteract(id: string): void {
  const r = interact.use(id, player.pos)
  /* 面板的入口**走的是"你对着什么按 E"**，不再是 Tab（KI-097）：`map` 键归位成地图之后，
     调音桩面板就只有交互这一条路——动词是数据里那个「调音」，玩家按的是眼前那根柱子。
     `rest` 那一路（回血 + 检查点存档）照旧，面板是它旁边那件顺手的事，不替代它。 */
  if (r.ok && r.kind === 'checkpoint' && !player.stats.dead && !panel.isOpen) setPanelOpen(true)
  if (r.ok && r.kind === 'shop' && !panel.isOpen) setPanelOpen(true)
  if (r.rest && !player.stats.dead) { player.rest(); checkpoints.request('rest') }
  if (r.ok && r.lootTable) openLootTable(settlementDeps, r.lootTable)
  if (r.ok && r.npcId) openDialogue(r.npcId)
  if (r.ok && r.to) {
    player.pos.x = r.to.x; player.pos.y = r.to.y; player.pos.z = r.to.z
    player.vy = 0
    player.floorY = surface.floorAt(r.to)?.y ?? 0
    streaming.teleport(time.tick, player.pos)
    bus.emit('world.travel', { id: r.id, from: { ...player.pos }, to: r.to })
    // §4.3 跨区时那一杆枪跟她一起回家：地上的、还在飞的都收回来，否则她到了新区域投不出枪，
    // 而"投不出枪"在这里不是一个惩罚，是一处没有出口的机制（新区域里那杆旧枪她永远走不回去捡）。
    combat.restockSpear()
  }
}

/** 出怪：完全由 regions.json 的 spawnGroups 决定（开场休垒无敌，敌人属于雾语林之后的世界） */
const spawner = new SpawnDirector(regions, {
  spawn: (id, pos, seed) => ai.spawn(id, pos, seed),
  despawn: (id) => ai.despawn(id),
  hasFlag: (k) => streaming.hasFlag(k),
  // KI-143：刷怪闸门要能问"这一格世界是什么样"（破拍营地的营长只在 GARRISON 那条线上）
  stateOf: (k) => worldStates.get(k) ?? null,
}, (pos) => { const c = streaming.cellOf(pos); return chunkKeyOf(c.cx, c.cy, c.cz) })
spawner.syncActive(streaming.byState('active').map((c) => c.key))
lock.candidates = ai.enemies

/*
 * §5.9.33③：开局那一格天气的四条腿。**排在 spawner 之后**——`applyWeather` 现在要把敌人浓度
 * 推给 `SpawnDirector`，而它建得比这一段晚；把调用点搬到读者之后，比在 `applyWeather` 里给
 * spawner 开一条"可能还没建好"的旁路干净。仍在帧循环之前，所以画面与第一批怪的落位都吃得到这一格。
 */
applyWeather(homeRegion ?? null)

addEventListener('pointerdown', () => {
  audio.start()
  // 任意点击跳过正在播放的过场（开场 25s 黑场等）：避免玩家被困在锁输入的黑屏里
  if (cinematics.current && !overlayOpen()) { skipCinematic(); setOverlay(null) }
})
addEventListener('keydown', (e) => {
  /* Esc 的**菜单**那半义（收面板 / 关对话 / 标题屏退回上一层）走 UI 意图通道的 `back`，
     由在场的那块 overlay 自己在 `feedMenu()` 里读——这里不再替它们关（那是第二个主人，
     一次 Esc 会被关两遍）。这一句只留"没有菜单在场时"的那半义：开合暂停。
     时序上也不冲突：keydown 这一刻 owner 还在，`overlayOpen()` 为真 ⇒ 这里不动，
     下一帧的 poll 才把 `back` 交给面板。 */
  // 任意键跳过正在播放的过场（开场 25s 黑场等）：仅在无菜单 overlay 在场时跳过，
  // 对话/面板里的过场由各自的 UI 意图通道接管，不该被这一句抢走。
  if (cinematics.current && !overlayOpen()) { skipCinematic(); setOverlay(null); return }
  if (e.code === 'Escape' && !overlayOpen()) time.paused = !time.paused
})

/* §11 失谐的视觉压力（>60 起屏幕一点点失去颜色）今天住在 `vfx/ColorGrade.ts`（KI-094①）。
   搬走而不是在这里包一层：那一格的读数与需求 §38 的天气乘数**共用同一条 `canvas.style.filter`**，
   两个写方在浏览器里是后盖前的，谁都不认识谁——把合成收成唯一仲裁者之后，这里只剩下"报失谐读数"。 */

/* ---------------------------------------------------------------------------
 * 运行时调试面板（需求 §54 的 F1/F3/F4，§56 目录表里规划的三个 Debugger）。
 * 只在 DEV 构建里接线：这三块面板读的是引擎内部状态，发布版本里没有它们，
 * 而 `core.postTick` 的循环里连一次函数调用都不会留下（`debugPanels` 恒空）。
 * F2 比这套外壳早落地（`CombatDebugger` 走纯事件流，不需要读实例），不动它。
 * ------------------------------------------------------------------------- */
const debugPanels: DebugPanel[] = []
if (import.meta.env.DEV) {
  const nearestEnemy = (): (typeof ai.enemies)[number] | null => {
    let t: (typeof ai.enemies)[number] | null = null
    let best = Number.POSITIVE_INFINITY
    for (const e of ai.enemies) {
      const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z)
      if (d < best) { best = d; t = e } // 出场顺序做平手裁决：面板不许制造不稳定
    }
    return t
  }
  debugPanels.push(
    new DebugPanel({
      key: 'F1', label: 'enemies on the field', anchor: 'position:fixed;left:12px;top:300px',
      text: () => enemyPanelText(ai.enemies, player.pos),
    }),
    new DebugPanel({
      key: 'F3', label: 'quests & world state (read-only)', anchor: 'position:fixed;left:46%;top:12px',
      text: () => questPanelText(questRows(questTable, quests), {
        flags: streaming.flagKeys(),
        byRules: worldState.flagsWritten,
        used: interact.snapshot(),
        relations: quests.snapshot().relations,
        states: worldStates.snapshot(),
      }),
    }),
    new DebugPanel({
      key: 'F4', label: 'AI decision path (FSM + 排招器，不是行为树)', anchor: 'position:fixed;left:12px;top:46%',
      text: () => {
        const info = rhythm.info()
        return aiPanelText({
          target: nearestEnemy(), player: player.pos,
          grid: {
            owner: rhythm.clockOwner, bpm: rhythm.bpm, beatsPerBar: rhythm.beatsPerBar,
            bar: info.bar, beatInBar: info.beatInBar, tick: time.tick,
          },
          armedSlots: ai.armedSlots,
        })
      },
    }),
  )
}

const core = {
  update(dt: number, t: GameTime, inp: Input) {
    // 过场先走时间：本帧的 `inputLocked` 才是本帧状态（走满那一刻锁自己解除）
    // 走完/接上队列的那一拍要把"开始了"与"结束了"成对发出去——相机据此切模式（§6 演出期间
    // 相机交给演出）。这一格只认**换人**：走完一条接上排队的另一条 ⇒ 一收一开两件事。
    {
      const wasId = cinematics.current?.id ?? null
      cinematics.advance(dt * 1000)
      const nowId = cinematics.current?.id ?? null
      if (wasId !== null && wasId !== nowId) bus.emit('cinematic.end', { id: wasId })
      if (nowId !== null && nowId !== wasId) {
        bus.emit('cinematic.start', { id: nowId, durationMs: cinematicRows.find((r) => r.id === nowId)?.durationMs })
      }
    }
    if (inp.frame.edges.has('map')) {
      /* `map` 键现在**只开地图**（KI-097 / TD-002：「按着地图的名字在调音」到此结案）。
         **收起**不走这里：有 overlay 在场时 `time.paused` 与 `enabled=false` 让这一段根本跑不到，
         关闭走的是 UI 意图通道的 `back`（Tab 在菜单里 = 收起一层，见 `core/Input.ts > UI_BINDS`）。
         所以这一句只可能在"没有 overlay"时触发；`!overlayOpen()` 是那句意图的显式说法，
         而不是多一个分支——两块面板叠着开会让两份 uiStep 抢同一条意图通道。 */
      if (!overlayOpen()) setMapOpen(true)
    }
    if (overlayOpen()) return // overlay/对话在场时世界停摆：不再吃移动/攻击输入（对话从 KI-062 第二腿起也是 overlay 的一格）
    if (inp.frame.edges.has('lockOn')) lock.toggle()
    for (const [i, act] of (['ability1', 'ability2', 'ability3'] as const).entries()) {
      if (inp.frame.edges.has(act)) selectWeaponSlot(i)
    }
    // §7 乐章战技：两个主动槽各自的键。出手与否由玩家动作系统判（冷却/闷音封锁/资源），
    // 所以这里不看返回值——"按了没出声"本身就是它的反馈（闷音与过载不足会各自报一句话）。
    for (const act of ['weaponSkill', 'weaponSkillB'] as const) {
      if (inp.frame.edges.has(act)) player.tryStartAction(act, t.tick, rhythm)
    }
    player.update(dt, t, inp, t.tick, rhythm)
    streaming.update(t.tick, player.pos)
    player.floorY = surface.floorAt(player.pos)?.y ?? 0 // 层外回落到基准地面
    interact.update(player.pos)
    nodes.animate(t.tick) // KI-013：调音桩呼吸灯
    const act = takeInteractEdge(inp.frame.edges, interact.focus(player.pos)) // 交互优先于处决/背刺
    if (act) applyInteract(act)
    const here = streaming.regionAt(player.pos)
    // authored 遮挡（KI-014②）：跨区就换名册，人不在任何区域里就清空——
    // 留着上一片天的墙会出现"新区域里凭空有空气挡箭"，而那空气在这儿根本没画出来
    if ((here?.id ?? null) !== wallsRegion) {
      wallsRegion = here?.id ?? null
      combat.occlusion.syncAuthored(here ?? null)
      nav.syncAuthored(here ?? null)
    }
    // §2 跨区过渡带：每帧算一次（带子外几乎免费，见 syncLightingBlend 的注）
    syncLightingBlend(player.pos)
    if (here && here.id !== shownRegion) {
      // §2.1 的区域网格表：进区域就换拍（深窖=只有 60BPM 心跳）。Boss 的私有时钟叠在它之上，
      // 所以这里写的是 home，AISystem.syncClock 决定当前用的是谁的拍。
      rhythm.setBpm(here.grid.bpm, here.grid.beatsPerBar)
      rpg.loot.setRegion(here.id) // §9.4 区域上修（KI-030①）：掉落层第一次认识「玩家此刻在谁的地上」
      // KI-077（§1.2）：底噪与铃点跟着脚下的区域换，音乐层自己按 8 小节做 crossfade。
      // KI-079：探索曲跟着换，而**顺序是这句话的一部分**——先发的这条开出淡变窗口，后发的那条看见窗口
      // 就把旋律押到窗口走完再换（§1.2「和声先换、旋律层最后」）。反过来写就是旋律先跳、底噪后淡。
      // KI-080：战斗档也跟着换，它排在最后而**不参与那个顺序**：它只在交战时被奏出来，
      // 不吃 crossfade 窗口，所以它对调出去也不会改变任何听感——三条里只有头两条之间有序可依。
      bus.emit('audio.music.ambience', { id: here.music.ambience })
      bus.emit('audio.music.explore', { id: here.music.explore })
      bus.emit('audio.music.battle', { id: here.music.battle })
      // KI-094①：雾跟着区域换。它排在三条音乐之后而没有顺序可依——滤镜与雾都是**立即生效**的画面量，
      // 不存在"先换底噪再换雾"那种淡变窗口，写在前写在后同一帧里看不出区别。
      // KI-094②：换区读的是"那一区当前生效的那一格"，不是永远的第一格——区里的钟修过了就是修过后的天气。
      applyWeather(here)
      applyLighting(here)
      if (booted) checkpoints.request('region') // 读档后第一次「进区域」是恢复现场，不该顺手覆盖存档
      // §6 Boss 出场：进 Boss 区放一次（读档后第一次进区是恢复现场，`booted` 已把它挡在外面）
      const intro = BOSS_INTRO_BY_REGION[here.id]
      if (booted && intro && !playedCinematics.has(intro)) {
        playedCinematics.add(intro)
        startCinematic(intro)
      }
      shownRegion = here.id
      bus.emit('ui.notify', { text: here.displayName, kind: 'info' })
      bus.emit('log', { level: 'info', msg: `enter ${here.id} · chunks ${JSON.stringify(streaming.stats())}` })
    }
    // face locked target while locked & idle-ish
    if (lock.target) player.faceTowards(lock.target.getPos())
    ai.update(dt, t.tick, player, rhythm)
    combat.update(t.tick, inp, dt)
    // §11 失谐：脏音是**区域**往你身上写的（深窖=2/s），不是打得不好的惩罚；
    // 满值后的"褪色"走 fadeDamage——不吃防御阶梯、不硬直、不击退，它是环境而不是攻击。
    // 累积与掉血共用区域那一格做闸门（tickEnvironment），安全区两条都关。
    const faded = player.corruption.tickEnvironment(dt, here?.corruption)
    if (faded > 0) player.fadeDamage(faded)
    grade.setVeil(player.corruption.veil())
    lock.update()
    visuals.sync(ai.enemies, t.tick)
    projectileVis.sync(combat.projectiles.list(), t.tick)
    projectileVis.syncGrounded(combat.groundedSpears.list()) // §4.3 躺在地上等拾回的那杆枪也得看得见
    projectileVis.syncTelegraphs(combat.telegraphs())
    bossArena.sync(ai.enemies.filter((e) => !!e.data.boss)) // 立钟与断音柱都在 Boss 场地类里，少一个过滤条件就会漏画后者
    propVis.sync(props.all) // KI-023：音刺的歪斜/残桩跟着耐久走
    // VFX 系统更新（Phase B4）
    rain.update(dt, rig.cam.position)
    trails.update(dt)
    decals.update(dt)
    // GPU 粒子是异步模块：渲染回调不是 async（await 会把整条循环编译炸掉），用 then 接——
    // 模块缓存之后每次调用近乎零开销，没就绪的那几帧跳过（粒子晚半秒出现不构成账）。
    void import('@/vfx/GPUParticles').then((m) => m.getGPUParticles()?.update(dt))
    // KI-105 声纹观察：按住 V 荡开涟漪——波前扫到的敌人/交互物画显形环。
    // 包络闸门关着（没按/淡出完）时这一切空转：takeMarks 交还空账，一个环都不发。
    observe.hold(inp.frame.held.has('observe'))
    // KI-105②：巡逻来路一直在记（不论观察开否）——不然按下 V 的瞬间敌人只有「此刻」没有「来路」，
    // §2.1 的 3 秒回放就得从第二次 ping 才开始有东西可放。
    const liveEnemies = ai.enemies.filter((e) => e.alive)
    for (const e of liveEnemies) observe.track(e.id, e.pos.x, e.pos.z, t.tick)
    for (const p of observe.update(t.tick, player.pos.x, player.pos.z)) {
      // 大波纹从脉冲的出生点荡开（不是玩家此刻的位置——按住时走两步，两圈波纹就该错开）
      vfx.observeWave(p.x, player.pos.y, p.z, OBSERVE_RADIUS, OBSERVE_TRAVEL_TICKS / TICK_HZ)
    }
    if (observe.active) {
      const marks = observe.takeMarks(
        liveEnemies.map((e) => ({ id: e.id, x: e.pos.x, y: e.pos.y, z: e.pos.z })),
        interact.within(player.pos, OBSERVE_RADIUS).map((i) => ({ id: i.id, x: i.pos.x, y: i.pos.y, z: i.pos.z })),
        t.tick,
      )
      for (const m of marks) {
        vfx.observeMark(m.x, m.y, m.z, m.kind === 'enemy')
        // 敌人标记带来的来路快照画成地面波纹链（窗长秒数 = 行程 tick / 60，同一把尺）
        if (m.trail?.length) vfx.observeTrail(m.trail, m.y, OBSERVE_TRAVEL_TICKS / TICK_HZ)
      }
    }
  },
  postTick(t: GameTime) {
    // 节拍钟走「逻辑 tick」而不是 time.dt：combat.md §9 末行规定 hitStop 只冻结攻守双方的动画时间，
    // 节拍/粒子/震镜/音效照常。喂 t.dt 会让命中停顿把整张拍网格拖慢（实机：20 tick 内只前进 0.0233 拍，
    // 应为 0.4667 拍 —— KI-017 的量化读数）。
    rhythm.update(TICK_DT)
    // 相机跟随仍按 `t.dt`（停顿那一下镜头该"挂"住），但震镜走 tick——见 CameraRig 与 §9。
    rig.update(t.dt, player, input.frame.look, lock.target ? lock.target.getPos() : null, TICK_DT)
    // 调试面板每逻辑帧重画一次（关着的面板内部直接 return，一个字符串都不生成）
    for (const p of debugPanels) p.refresh()
  }
}

/**
 * 每帧把 UI 意图念给**在场的那一块菜单**听（KI-062）。世界停摆时 `core.update` 那一段整个跳过，
 * 所以读数只能在渲染回调里给；`uiEdges` 是 edge 语义——一直按着不会连发。
 *
 * 四块互斥（`setOverlay` 保证），所以这里是 if/else 而不是全都喂——两份 uiStep 抢同一条通道，
 * 一次 ↑↓ 会被数两遍。这一处也是标题屏唯一的读数入口：环还没开时由 `pumpMenu` 来敲它（见 boot 段）。
 */
function feedMenu(): void {
  if (overlay === 'panel') panel.uiStep(input.uiEdges)
  else if (overlay === 'map') mapUi.uiStep(input.uiEdges)
  else if (overlay === 'dialogue') dialogueBox.uiStep(input.uiEdges)
  else if (overlay === 'title') title?.uiStep(input.uiEdges)
}

const loop = new GameLoop(time, input, (alpha, realDelta) => {
  feedMenu()
  arena.update(alpha, realDelta)
  vfx.update(realDelta) // particles run on real time — hitstop must not freeze VFX (tech-arch §4 rule 3)
  audio.update(realDelta)
  audio.setListener(player.pos.x, player.pos.y + 1, player.pos.z, rig.yaw)
  hud.render(alpha, realDelta)
  rig.cam.aspect = innerWidth / innerHeight
  arena.renderer.render(arena.scene, rig.cam)
})
loop.add(core)

addEventListener('resize', () => { arena.resize(); rig.resize() })
bus.on('log', (l) => console.info(`[caesura:${l.level}] ${l.msg}`))

/**
 * 存档后端：localStorage 主存位 + IndexedDB 备份位（需求 §45 的双份）。
 * IndexedDB 不可用（隐私模式/被禁用）时降级为单份并说一声 —— 不静默假装还有备份。
 */
const savePrimary = new LocalStore('caesura.save.', localStorage)
const saveBackup = typeof indexedDB === 'undefined' ? null : new IdbStore('caesura-save')
/**
 * KI-112：玩法/辅助设置的宿主。组合根把四个消费者的实例装进来（bufferMs→Input、
 * shakeScale→CameraRig、rumbleScale→Haptics、damageScale→CombatManager），
 * 构造即灌一遍当前值；读档经 `SaveGame.apply` 落到 `restore`（信任边界在 store 里）。
 */
const gameplayStore = new GameplaySettingsStore({ input, rig, haptics, combat })
/**
 * 存档时刻的墙钟只在这里给（KI-025①）：逻辑层不许自己读 `Date`，否则每次跑测都会写出不同的档，
 * 而"摘要卡上的时间是从外面带进来的"这条也就没有证人。
 */
const saves = new SaveGame(
  { player, streaming, spawner, clock: rhythm, time, rpg, interact, props, quests, states: worldStates, audio: { engine: audio, setVolume: (b: string, v: number) => audio.setVolume(b as never, v), getVolume: (b: string) => audio.getVolume(b) }, gameplay: { get: () => gameplayStore.get(), apply: (raw: unknown) => gameplayStore.restore(raw) }, now: () => Date.now() },
  savePrimary, saveBackup
)
/** 摘要卡的名册（KI-025）：标题屏与调音桩面板都从它读"这几格是什么、能不能读" */
const saveRoster = new SlotRoster(savePrimary, saveBackup)
const checkpoints = new Checkpoints(saves)
// 用的是哪颗种子/哪根弦写在控制台：QA 要复现某一串掉落，第一句问的就是"你那局什么种子"。
// 播报挪到 startRun 之前由 logRunOrigin() 发——标题屏定弦之后才有"哪根弦"可言。
if (!saveBackup) console.info('[caesura] IndexedDB 不可用 ⇒ 存档只有本地一份')
bus.on('boss.phase', () => checkpoints.request('boss'))
// Boss 倒下是这一局里最不该丢进度的一刻：胜利序列同样按 Boss 检查点存一笔
bus.on('boss.defeated', (p) => {
  checkpoints.request('boss')
  // §6 **胜利**：主 Boss（恩希尔）倒下那一刻——镜头语言写的是"管风琴过载熄灭、振源核冰解"，
  // 那是未竟厅那一战，所以按 `dataId` 认人而不是"任何 Boss 倒下都放"。
  // 一局只会死一次 ⇒ 不需要额外的"放过没"台账；`playedCinematics` 清在 `startRun` 里。
  if (p.dataId === 'en_hersil') startCinematic('CINE_WIN')
})

/**
 * 结算与拾取的依赖束（需求 §59 的 Loot 拍）：编排本身在 `rpg/Settlement.ts`（那里才有 §59 的闭环
 * 测试），这里只把它接到组合根的三样东西上——成长、面板刷新、检查点。
 */
const settlementDeps: SettlementDeps = { rpg, refresh: refreshRpg, checkpoint: (reason) => checkpoints.request(reason) }
const settlement = new KillSettlement(settlementDeps)
addEventListener('pagehide', () => checkpoints.request('quit'))

/** 启动即尝试回到最近的自动存档（?fresh=1 强制开新档） */
let booted = false

async function startRun(slot: string | null): Promise<void> {
  // 「本局第一次」的台账按局清一次：读档/新开局都是一次新的解释机会（需求 §19）
  glossary.forgetAll()
  playedCinematics.clear() // 过场也是"每局一次"：读档/新开局都重新给一次出场
  combat.restockSpear() // §4.3 每一局都是一杆新枪：上一局死在哪儿的那一杆不该跟着存档回来（存档里也没有它）
  const snap = slot ? await saves.load(slot) : null
  if (snap) {
    streaming.teleport(time.tick, player.pos)
    player.floorY = surface.floorAt(player.pos)?.y ?? 0
    spawner.syncActive(streaming.byState('active').map((c) => c.key))
    bus.emit('ui.notify', { text: `回到上次调音桩 · ${snap.regionId ?? '未知区域'}`, kind: 'info' })
  }
  // 读档可能恢复了音级/装备/背包 ⇒ 派生值与手里的武器都要跟着回来（顺序：先 restore 再 refresh）
  refreshRpg()
  // 新开局（不是读档）放 §6 的开场：黑场、声先死、无 UI 无旁白那一条
  if (!slot) startCinematic('CINE_OPEN')
  // 开场引导（KI-111 后续）：新鲜开局给一句操作/目标提示，避免玩家陷在黑场里不知道干什么
  bus.emit('ui.notify', { text: 'WASD 移动 · 鼠标视角 · E 交互 · Tab 地图', kind: 'info' })
  // KI-138：开场两拍要说清"第一件该干什么"。**只说操作是半句**（实测反馈「不知道要干什么」）：
  // 拍 1 是醒来，拍 2 是"休垒建立基地"（production-plan §6.1）——那两拍里玩家真正要做的是
  // ① 找钟声守铃姨领第一件委托（她就在休垒，8/0/26），② 顺路在发光的调音桩上加点。
  // **不给坐标**：坐标由目标指示那枚箭头给（KI-137），这里只说"找谁"。
  bus.emit('ui.notify', { text: '休垒的钟声守在等你 —— 找她领第一件委托（发光的调音桩可以先加点）', kind: 'info' })
  bus.emit('ui.notify', { text: `音级 ${rpg.prog.rank} · 遗响 ${rpg.prog.xp}${rpg.prog.unspent > 0 ? ` · 未分配点 ${rpg.prog.unspent}` : ''}`, kind: 'info' })
  // KI-141：序章目标（还没接任何委托时，箭头指着该先找的人）
  applyPrologueObjective()
  booted = true
  loop.start()
}

/** 开局日志用的出身以**决策后**的为准：标题屏选完再说，否则报的是默认弦 */
function logRunOrigin(): void {
  bus.emit('log', { level: 'info', msg: `rpg.origin ${rpg.prog.originId} seed ${rpg.inv.rng.state().seed}` })
}

/**
 * 开场「定弦」（KI-031② / §2.2）+ 存档摘要屏（KI-025②）。正常启动在 `loop.start()` 之前把世界按住：
 * 标题屏决定用哪根弦、以及**读哪一格**（如果有可读的）。"有没有档可续"这一问交给 `SlotRoster`，
 * 不再自己探主存位的裸 key——那种探法看不见 `.prev` 与备份位，会把"其实读得出来"报成"没有档"。
 * `?fresh=1` 是给无头探索与 live 探针铺好的通道：不立标题屏，直接按 `?origin=` 那根弦开跑——
 * 既有探针配方一条不改。
 */
let title: TitleScreen | null = null
let menuPump: MenuPump | null = null
const freshBoot = params.has('fresh')
if (freshBoot) {
  logRunOrigin()
  void startRun(null)
} else {
  /* 标题屏也是 overlay 的一格（KI-062 第二腿）：认领读数、按住世界走的是 `setOverlay` 那一条腿，
     不再让它自己挂 DOM 监听器——自己听键的屏与面板共用一条通道时，一次 ↑ 会被数两遍。 */
  setOverlay('title')
  /**
   * 交还：决策一旦出口，先停泵再交还所有权。两处都在 poll 就是两个读数主人（KI-061 的同形状），
   * 而 `setOverlay(null)` 之后 `enabled=true`，那一记还按着的键因此也不会补发成玩法边沿。
   */
  const leaveTitle = (): void => {
    menuPump?.stop()
    menuPump = null
    setOverlay(null)
  }
  title = new TitleScreen({
    onNew: (id) => {
      const t = title as TitleScreen
      t.dispose()
      leaveTitle()
      if (id !== rpg.prog.originId) rpg.restring(id)
      logRunOrigin()
      void startRun(null)
    },
    onContinue: (slot) => {
      const t = title as TitleScreen
      t.dispose()
      leaveTitle()
      logRunOrigin()
      void startRun(slot)
    },
    listSlots: () => saveRoster.list()
  }, originId)
  /* 环这时候还**不能**开：`GameLoop.tickFrame` 的 `time.tick++` 写在 `paused` 判断之外，开着环站在
     标题屏会把「boot 真被门挡住（`time.tick` 停在 0）」那条 KI-031② 的实测读数假报成已放行。
     所以这一段用 `pumpMenu`（只 poll 输入 + 只喂菜单），开环时它已经停了。 */
  menuPump = pumpMenu(input, feedMenu)
}

/**
 * 调试/实机量测面（TD-006 第二腿⑤）。`audio.engine` 是 `AudioEngine` 实例本身：实机腿要读的两样东西
 * 只有拿得到实例才读得着——`muffleHz`（消音那条低通的实时频率，斜坡走到哪一格）与 `dispose()`
 * （装配层的收尾口；测试与实机从此共用同一个，`AudioEngine` 因此不是一只没有生产消费方的 API）。
 */
;(window as unknown as Record<string, unknown>).__caesura = { loop, time, input, rhythm, arena, lights, player, ai, combat, lock, rig, bus, streaming, surface, greybox, wallGreybox, interact, props, hud, spawner, nodes, worldState, projectileVis, actors: visuals, bossArena, saves, saveRoster, checkpoints, rpg, settlement, panel, setPanelOpen, mapUi, setMapOpen, quests, dialogueEngine, dialogueBox, openDialogue, debugPanels, refreshRpg, observe, saveNow: () => saves.save('autosave'), get title() { return title } }

document.getElementById('boot')!.style.display = 'none'
;(window as unknown as Record<string, unknown>).__CAESURA_BOOTED__ = true
bus.emit('boot.ready', undefined)
console.info('[caesura] online — WASD/Shift/Ctrl-roll/LMB/RMB/F guard/G parry/Q lock/E interact(优先)/execute(处决·背刺)/1·2·3 换装/R·C 乐章战技 I·II/Tab 调音桩面板(需站在调音桩前)/E 与 NPC 交谈/1-9 选对话选项/Esc pause')
