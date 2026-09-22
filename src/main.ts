import { bus } from '@/core/EventBus'
import { GameTime } from '@/core/Time'
import { GameLoop } from '@/core/GameLoop'
import { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { ItemData, MovesetData, WeaponData } from '@/data/schema'
import { createArena } from '@/world/PlaceholderArena'
import { StreamingSystem, chunkKeyOf } from '@/world/Streaming'
import { Surface } from '@/world/Surface'
import { SpawnDirector } from '@/world/SpawnDirector'
import { Interactables, takeInteractEdge } from '@/world/Interactables'
import { ChunkGreybox } from '@/world/ChunkGreybox'
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
import { CombatDebugger } from '@/tools/CombatDebugger'
import { SaveGame, LocalStore, IdbStore } from '@/save/Serializer'
import { Checkpoints } from '@/save/Checkpoint'
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
})
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
const greybox = new ChunkGreybox(arena.scene, regions, streaming.chunkSize)
const nodes = new InteractableGreybox(arena.scene, regions, (pos) => { const c = streaming.cellOf(pos); return chunkKeyOf(c.cx, c.cy, c.cz) }, (k) => streaming.hasFlag(k))
nodes.syncActive(streaming.byState('active').map((c) => c.key)) // 起始格在构造前就已激活，补一次

/** 交互物落地：调音桩休息、机关传送（= UE 的 Level Streaming 遮蔽传送） */
function applyInteract(id: string): void {
  const r = interact.use(id, player.pos)
  if (r.rest && !player.stats.dead) { player.rest(); checkpoints.request('rest') }
  if (r.ok && r.lootTable) openLootTable(settlementDeps, r.lootTable)
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
        else bus.emit('ui.notify', { text: '需在调音桩前调音', kind: 'info' })
      }
    }
    if (panel.isOpen) return // 面板打开时世界停摆：不再吃移动/攻击输入
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
    if (here && here.id !== shownRegion) {
      // §2.1 的区域网格表：进区域就换拍（深窖=只有 60BPM 心跳）。Boss 的私有时钟叠在它之上，
      // 所以这里写的是 home，AISystem.syncClock 决定当前用的是谁的拍。
      rhythm.setBpm(here.grid.bpm, here.grid.beatsPerBar)
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
  },
  postTick(t: GameTime) {
    rhythm.update(t.dt)
    rig.update(t.dt, player, input.frame.look, lock.target ? lock.target.getPos() : null)
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
const saves = new SaveGame({ player, streaming, spawner, clock: rhythm, time, rpg }, savePrimary, saveBackup)
const checkpoints = new Checkpoints(saves)
// 开局就把用的是哪颗种子写在控制台：QA 要复现某一串掉落，第一句问的就是"你那局什么种子"
bus.emit('log', { level: 'info', msg: `rpg.origin ${originId} seed ${rpg.inv.rng.state().seed}` })
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

async function bootWithSave(): Promise<void> {
  // 「本局第一次」的台账按局清一次：读档/新开局都是一次新的解释机会（需求 §19）
  glossary.forgetAll()
  const fresh = new URLSearchParams(location.search).has('fresh')
  const snap = fresh ? null : await saves.load('autosave')
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

;(window as unknown as Record<string, unknown>).__caesura = { loop, time, input, rhythm, arena, player, ai, combat, lock, rig, bus, streaming, surface, greybox, interact, hud, spawner, nodes, projectileVis, actors: visuals, bossArena, saves, checkpoints, rpg, settlement, panel, setPanelOpen, refreshRpg, saveNow: () => saves.save('autosave') }

document.getElementById('boot')!.style.display = 'none'
;(window as unknown as Record<string, unknown>).__CAESURA_BOOTED__ = true
bus.emit('boot.ready', undefined)
void bootWithSave()
console.info('[caesura] online — WASD/Shift/Ctrl-roll/LMB/RMB/F guard/G parry/Q lock/E interact(优先)/execute(处决·背刺)/1·2·3 换装/R·C 乐章战技 I·II/Tab 调音桩面板(需站在调音桩前)/Esc pause')
