import { bus } from '@/core/EventBus'
import { Vector3 } from 'three'
import { GameTime, TICK_DT } from '@/core/Time'
import { GameLoop } from '@/core/GameLoop'
import { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions, worldstate, dialogues, quests as questTable } from '@/data'
import type { ItemData, MovesetData, NpcData, WeaponData } from '@/data/schema'
import { createArena } from '@/world/PlaceholderArena'
import { StreamingSystem, chunkKeyOf, type ChunkState } from '@/world/Streaming'
import { Surface } from '@/world/Surface'
import { SpawnDirector } from '@/world/SpawnDirector'
import { Interactables, takeInteractEdge } from '@/world/Interactables'
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
import { CombatManager } from '@/combat/CombatManager'
import { glossary } from '@/combat/Statuses'
import { AudioEngine } from '@/audio/AudioEngine'
import { Haptics } from '@/input/Haptics'
import { VfxLayer } from '@/vfx/VfxLayer'
import { Hud } from '@/ui/Hud'
import { Stakerite } from '@/ui/Stakerite'
import { TitleScreen } from '@/ui/TitleScreen'
import { DialogueBox } from '@/ui/DialogueBox'
import { CombatDebugger } from '@/tools/CombatDebugger'
import { SaveGame, LocalStore, IdbStore } from '@/save/Serializer'
import { SlotRoster } from '@/save/Slots'
import { Checkpoints } from '@/save/Checkpoint'
import { WorldState } from '@/quest/WorldState'
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

const lock = new LockOn(player)
const ai = new AISystem()
const combat = new CombatManager(player, ai, time, rhythm)
const visuals = new ActorVisuals(arena.scene, arena.playerVisual, player)
const projectileVis = new ProjectileVisuals(arena.scene)
const bossArena = new BossArenaVisuals(arena.scene) // §15.1 撞钟机关：机关看不见就等于不存在
const audio = new AudioEngine()
const vfx = new VfxLayer(arena.scene)
const hud = new Hud(document.getElementById('hud') as HTMLCanvasElement)
/** 飘字要钉在世界坐标上：HUD 不认识相机，投影由这里喂进去（§8.2 ms_crit_ring 的腿） */
hud.project = (p) => {
  const v = new Vector3(p.x, p.y, p.z).project(rig.cam)
  if (v.z > 1 || v.z < -1) return null
  return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (1 - (v.y * 0.5 + 0.5)) * innerHeight }
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
  }
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

function setPanelOpen(open: boolean): void {
  if (open) { panel.show(); time.paused = true; input.enabled = false }
  else { panel.close(); time.paused = false; input.enabled = true }
}
new CombatDebugger()
new Haptics(input)

const missingRefs = StreamingSystem.collectMissingRefs(regions, (id) => registry.has(id))
if (missingRefs.length) bus.emit('log', { level: 'warn', msg: `MissingRef: ${missingRefs.join(', ')}` })
const streaming = new StreamingSystem(regions)
streaming.teleport(0, player.pos) // 起始区同步加载（§5.5 传送遮蔽等价物）
let shownRegion = streaming.regionAt(player.pos)?.id ?? null
const surface = new Surface(regions, 0.5, (r) => !streaming.isRegionUnlocked(r))
combat.floorAt = (pos) => surface.floorAt(pos)?.y ?? null // 弹道撞地：射进灰盒地板就落地
const interact = new Interactables(regions, (r) => streaming.isRegionUnlocked(r))
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
const propVis = new PropVisuals(arena.scene, regions, (r) => streaming.isRegionUnlocked(r), (p) => props.isExposed(p))
const greybox = new ChunkGreybox(arena.scene, regions, streaming.chunkSize)
/**
 * authored 墙体（KI-014②）：灰盒与逻辑名册读**同一份** `regions.json > walls`。
 * 两边各算一套尺寸就会出现"看不见的墙挡住了看得见的路"——那比没有墙更糟。
 */
const wallGreybox = new WallGreybox(arena.scene, regions, (pos) => { const c = streaming.cellOf(pos); return chunkKeyOf(c.cx, c.cy, c.cz) })
const loadedStates: ChunkState[] = ['active', 'resident', 'preloading']
wallGreybox.syncLoaded(loadedStates.flatMap((s) => streaming.byState(s).map((c) => c.key))) // 构造前就加载好的格：等不到下一次跨格事件
// 关卡侧遮挡名册跟着脚下这片天走（Boss 的柱子每 tick 重名点，墙只在跨区时动一次）
let wallsRegion = shownRegion
combat.occlusion.syncAuthored(streaming.regionAt(player.pos) ?? null)
// KI-014②b：AI 的视线借**同一份**名册（§13.0 视觉列的后半句）。名字里那个 `blocked` 就是
// 弹道读的那一条线 ⇒ "这堵墙挡住了箭、却挡不住目光"从这一刻起不成立。
ai.sightBlocked = (a, b) => combat.occlusion.blocked(a, b)
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
const quests = new Quests(questTable, (e) => {
  bus.emit('ui.notify', {
    text: e.started ? `新的委托 · ${e.label}` : `委托推进 · ${e.label}`,
    kind: e.started ? 'boss' : 'reward',
  })
})
const dialogueEngine = new DialogueEngine(dialogues, quests)
const dialogueCtx: DialogueContext = {
  hasFlag: (k) => streaming.hasFlag(k),
  relation: (npc) => quests.relation(npc),
  questState: (id) => quests.state(id),
  questIndex: (id) => quests.stepIndex(id),
  hasItem: (id, count = 1) => rpg.inv.count(id) >= count,
  hasSeen: (d, n) => quests.hasSeen(d, n),
}

const nodes = new InteractableGreybox(arena.scene, regions, (pos) => { const c = streaming.cellOf(pos); return chunkKeyOf(c.cx, c.cy, c.cz) }, (k) => streaming.hasFlag(k))
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
  notify: (text, kind) => bus.emit('ui.notify', { text, kind: kind ?? 'info' }),
  refresh: () => refreshRpg(),
  setPaused: (paused) => { time.paused = paused; input.enabled = !paused },
  present: (view) => { if (view) dialogueBox.show(view); else dialogueBox.hide() },
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
  }
}

/** 出怪：完全由 regions.json 的 spawnGroups 决定（开场休垒无敌，敌人属于雾语林之后的世界） */
const spawner = new SpawnDirector(regions, {
  spawn: (id, pos, seed) => ai.spawn(id, pos, seed),
  despawn: (id) => ai.despawn(id),
  hasFlag: (k) => streaming.hasFlag(k),
}, (pos) => { const c = streaming.cellOf(pos); return chunkKeyOf(c.cx, c.cy, c.cz) })
spawner.syncActive(streaming.byState('active').map((c) => c.key))
lock.candidates = ai.enemies

addEventListener('pointerdown', () => audio.start())
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && dialogueBox.isOpen) return // 交给对话框自己处理（先关对话，不解冻世界）
  if (e.code === 'Escape') {
    if (panel.isOpen) setPanelOpen(false) // 面板开着时 Esc 先收面板，不会顺手把游戏解冻
    else time.paused = !time.paused
  }
})

/**
 * §11 失谐的视觉压力：>60 起屏幕一点点失去颜色（combat.md「饱和度渐减」）。
 * WebGL 画面没有后处理管线，CSS filter 是这套环境里唯一真实的去饱和通道（ENV-001 下的合理替代，
 * 升级路径=接一个 post-processing pass 后改这一处）。量化到 5% 一档，避免每帧改样式触发重排。
 */
let veilApplied = -1
function setVeil(v: number): void {
  const q = Math.round(v * 20) / 20
  if (q === veilApplied) return
  veilApplied = q
  canvas.style.filter = q > 0 ? `saturate(${(1 - q).toFixed(2)}) brightness(${(1 - q * 0.3).toFixed(2)})` : ''
}

const core = {
  update(dt: number, t: GameTime, inp: Input) {
    if (inp.frame.edges.has('map')) {
      if (panel.isOpen) setPanelOpen(false)
      else {
        const f = interact.focus(player.pos)
        if (f?.kind === 'checkpoint') setPanelOpen(true)
        else if (f?.kind === 'shop') setPanelOpen(true) // KI-055②：交易要人在商摊前，不再是"面板开了在哪都能买"
        else bus.emit('ui.notify', { text: '需在调音桩前调音', kind: 'info' })
      }
    }
    if (panel.isOpen || dialogueBox.isOpen) return // 面板/对话打开时世界停摆：不再吃移动/攻击输入
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
    const act = takeInteractEdge(inp.frame.edges, interact.focus(player.pos)) // 交互优先于处决/背刺
    if (act) applyInteract(act)
    const here = streaming.regionAt(player.pos)
    // authored 遮挡（KI-014②）：跨区就换名册，人不在任何区域里就清空——
    // 留着上一片天的墙会出现"新区域里凭空有空气挡箭"，而那空气在这儿根本没画出来
    if ((here?.id ?? null) !== wallsRegion) {
      wallsRegion = here?.id ?? null
      combat.occlusion.syncAuthored(here ?? null)
    }
    if (here && here.id !== shownRegion) {
      // §2.1 的区域网格表：进区域就换拍（深窖=只有 60BPM 心跳）。Boss 的私有时钟叠在它之上，
      // 所以这里写的是 home，AISystem.syncClock 决定当前用的是谁的拍。
      rhythm.setBpm(here.grid.bpm, here.grid.beatsPerBar)
      rpg.loot.setRegion(here.id) // §9.4 区域上修（KI-030①）：掉落层第一次认识「玩家此刻在谁的地上」
      if (booted) checkpoints.request('region') // 读档后第一次「进区域」是恢复现场，不该顺手覆盖存档
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
    setVeil(player.corruption.veil())
    lock.update()
    visuals.sync(ai.enemies, t.tick)
    projectileVis.sync(combat.projectiles.list(), t.tick)
    projectileVis.syncTelegraphs(combat.telegraphs())
    bossArena.sync(ai.enemies.filter((e) => !!e.data.boss)) // 立钟与断音柱都在 Boss 场地类里，少一个过滤条件就会漏画后者
    propVis.sync(props.all) // KI-023：音刺的歪斜/残桩跟着耐久走
  },
  postTick(t: GameTime) {
    // 节拍钟走「逻辑 tick」而不是 time.dt：combat.md §9 末行规定 hitStop 只冻结攻守双方的动画时间，
    // 节拍/粒子/震镜/音效照常。喂 t.dt 会让命中停顿把整张拍网格拖慢（实机：20 tick 内只前进 0.0233 拍，
    // 应为 0.4667 拍 —— KI-017 的量化读数）。
    rhythm.update(TICK_DT)
    // 相机跟随仍按 `t.dt`（停顿那一下镜头该"挂"住），但震镜走 tick——见 CameraRig 与 §9。
    rig.update(t.dt, player, input.frame.look, lock.target ? lock.target.getPos() : null, TICK_DT)
  }
}

const loop = new GameLoop(time, input, (alpha, realDelta) => {
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
 * 存档时刻的墙钟只在这里给（KI-025①）：逻辑层不许自己读 `Date`，否则每次跑测都会写出不同的档，
 * 而"摘要卡上的时间是从外面带进来的"这条也就没有证人。
 */
const saves = new SaveGame(
  { player, streaming, spawner, clock: rhythm, time, rpg, interact, props, quests, now: () => Date.now() },
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
bus.on('boss.defeated', () => checkpoints.request('boss'))

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
  const snap = slot ? await saves.load(slot) : null
  if (snap) {
    streaming.teleport(time.tick, player.pos)
    player.floorY = surface.floorAt(player.pos)?.y ?? 0
    spawner.syncActive(streaming.byState('active').map((c) => c.key))
    bus.emit('ui.notify', { text: `回到上次调音桩 · ${snap.regionId ?? '未知区域'}`, kind: 'info' })
  }
  // 读档可能恢复了音级/装备/背包 ⇒ 派生值与手里的武器都要跟着回来（顺序：先 restore 再 refresh）
  refreshRpg()
  bus.emit('ui.notify', { text: `音级 ${rpg.prog.rank} · 遗响 ${rpg.prog.xp}${rpg.prog.unspent > 0 ? ` · 未分配点 ${rpg.prog.unspent}` : ''}`, kind: 'info' })
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
const freshBoot = params.has('fresh')
if (freshBoot) {
  logRunOrigin()
  void startRun(null)
} else {
  title = new TitleScreen({
    onNew: (id) => {
      const t = title as TitleScreen
      t.dispose()
      if (id !== rpg.prog.originId) rpg.restring(id)
      logRunOrigin()
      void startRun(null)
    },
    onContinue: (slot) => {
      const t = title as TitleScreen
      t.dispose()
      logRunOrigin()
      void startRun(slot)
    },
    listSlots: () => saveRoster.list()
  }, originId)
}

;(window as unknown as Record<string, unknown>).__caesura = { loop, time, input, rhythm, arena, player, ai, combat, lock, rig, bus, streaming, surface, greybox, wallGreybox, interact, props, hud, spawner, nodes, worldState, projectileVis, actors: visuals, bossArena, saves, saveRoster, checkpoints, rpg, settlement, panel, setPanelOpen, quests, dialogueEngine, dialogueBox, openDialogue, refreshRpg, saveNow: () => saves.save('autosave'), get title() { return title } }

document.getElementById('boot')!.style.display = 'none'
;(window as unknown as Record<string, unknown>).__CAESURA_BOOTED__ = true
bus.emit('boot.ready', undefined)
console.info('[caesura] online — WASD/Shift/Ctrl-roll/LMB/RMB/F guard/G parry/Q lock/E interact(优先)/execute(处决·背刺)/1·2·3 换装/R·C 乐章战技 I·II/Tab 调音桩面板(需站在调音桩前)/E 与 NPC 交谈/1-9 选对话选项/Esc pause')
