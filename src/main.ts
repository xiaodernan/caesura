import { bus } from '@/core/EventBus'
import { GameTime } from '@/core/Time'
import { GameLoop } from '@/core/GameLoop'
import { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
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
import { AudioEngine } from '@/audio/AudioEngine'
import { Haptics } from '@/input/Haptics'
import { VfxLayer } from '@/vfx/VfxLayer'
import { Hud } from '@/ui/Hud'
import { CombatDebugger } from '@/tools/CombatDebugger'
import { SaveGame, LocalStore, IdbStore } from '@/save/Serializer'
import { Checkpoints } from '@/save/Checkpoint'
import { RpgRuntime } from '@/rpg/Runtime'
import type { LootGrant } from '@/rpg/Loot'
import type { EnemyData } from '@/data/schema'

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
const originId = new URLSearchParams(location.search).get('origin') ?? 'origin_tuner'
const rpg = new RpgRuntime(originId)
const startWeaponId = rpg.mods().weaponId ?? 'wp_tuning_sword'
const weapon = registry.get<WeaponData>(startWeaponId)
const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
const player = new PlayerController(playerBase, weapon, moveset)

/** 把成长/装备的汇总灌进玩家（升级、换装、强化、洗点、掉落之后都要调一次） */
function refreshRpg(): void {
  const m = rpg.mods()
  player.applyRpg(m)
  if (m.weaponId && m.weaponId !== player.weapon.id && registry.has(m.weaponId)) {
    const w = registry.get<WeaponData>(m.weaponId)
    player.equip(w, registry.get<MovesetData>(`moveset:${w.movesetId}`))
  }
}

/** 背包里拥有的武器件（1/2/3 键按这个顺序切换；没有的武器切不出来） */
function ownedWeaponUids(): string[] {
  return rpg.inv.gears
    .filter((g) => registry.maybeGet<import('@/data/schema').ItemData>(g.itemId)?.kind === 'weapon')
    .map((g) => g.uid)
}
function selectWeaponSlot(slot: number): void {
  const uid = ownedWeaponUids()[slot]
  if (!uid) { bus.emit('ui.notify', { text: `第 ${slot + 1} 把武器：尚未拥有`, kind: 'info' }); return }
  const res = rpg.equip(uid)
  if (!res.ok) return
  refreshRpg()
  bus.emit('ui.notify', { text: `装备 · ${gearLabel(uid)}`, kind: 'info' })
}

function gearLabel(uid: string): string {
  const g = rpg.inv.gearByUid(uid)
  if (!g) return uid
  const item = registry.get<import('@/data/schema').ItemData>(g.itemId)
  return g.level > 0 ? `${item.displayName} +${g.level}` : item.displayName
}

/** 掉落播报：一件一行，保底件单独说一声（"保底"本身就是给玩家的信息） */
function reportGrants(grants: LootGrant[]): void {
  for (const g of grants) {
    if (g.type === 'xp') continue // 遗响单独播（升级时才有意义，见 onEnemyKilled）
    const suffix = g.count > 1 ? ` ×${g.count}` : ''
    bus.emit('ui.notify', { text: `${g.pity ? '保底 · ' : ''}获得 ${g.name}${suffix}`, kind: g.pity ? 'boss' : 'reward' })
  }
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
  if (r.ok && r.lootTable) { reportGrants(rpg.loot.grant(r.lootTable)); refreshRpg() }
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
addEventListener('keydown', (e) => { if (e.code === 'Escape') time.paused = !time.paused })

const core = {
  update(dt: number, t: GameTime, inp: Input) {
    if (inp.frame.edges.has('lockOn')) lock.toggle()
    for (const [i, act] of (['ability1', 'ability2', 'ability3'] as const).entries()) {
      if (inp.frame.edges.has(act)) selectWeaponSlot(i)
    }
    if (inp.frame.edges.has('weaponSkill')) {
      bus.emit('ui.notify', { text: '乐章战技：将在 Phase 5 解锁', kind: 'info' })
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
if (!saveBackup) console.info('[caesura] IndexedDB 不可用 ⇒ 存档只有本地一份')
bus.on('boss.phase', () => checkpoints.request('boss'))

/**
 * 击杀结算（需求 §59 的 Loot 拍）：遗响入成长、掉落入背包，升级则播报 + 存一笔。
 * 掉落的真源是敌人数据里的 `drops`（Phase 5-B 起每个敌人有自己的表），这里只做编排。
 */
bus.on('entity.died', ({ dataId }) => {
  if (!dataId) return
  const enemy = registry.maybeGet<EnemyData>(dataId)
  if (!enemy) return
  const beforeRank = rpg.prog.rank
  const grants = rpg.onEnemyKilled(enemy)
  const xp = grants.filter((g) => g.type === 'xp').reduce((s2, g) => s2 + g.count, 0)
  reportGrants(grants)
  refreshRpg()
  if (xp > 0) bus.emit('ui.notify', { text: `遗响 +${xp}`, kind: 'info' })
  if (rpg.prog.rank > beforeRank) {
    bus.emit('audio.sfx', { key: 'ui_select', pos: { ...player.pos }, gain: 0.9 })
    bus.emit('ui.notify', { text: `音级 ${rpg.prog.rank} · 音级点 +${rpg.prog.rank - beforeRank}`, kind: 'boss' })
    for (let r = beforeRank + 1; r <= rpg.prog.rank; r++) {
      const ms = rpg.prog.milestoneAt(r)
      if (ms) bus.emit('ui.notify', { text: `音级 ${r}：${ms.label}`, kind: 'reward' })
    }
    checkpoints.request('levelup')
  }
})
addEventListener('pagehide', () => checkpoints.request('quit'))

/** 启动即尝试回到最近的自动存档（?fresh=1 强制开新档） */
let booted = false

async function bootWithSave(): Promise<void> {
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

;(window as unknown as Record<string, unknown>).__caesura = { loop, time, input, rhythm, arena, player, ai, combat, lock, rig, bus, streaming, surface, greybox, interact, hud, spawner, nodes, projectileVis, actors: visuals, bossArena, saves, checkpoints, rpg, refreshRpg, saveNow: () => saves.save('autosave') }

document.getElementById('boot')!.style.display = 'none'
;(window as unknown as Record<string, unknown>).__CAESURA_BOOTED__ = true
bus.emit('boot.ready', undefined)
void bootWithSave()
console.info('[caesura] combat prototype online — WASD/Shift/Ctrl-roll/LMB/RMB/F guard/G parry/Q lock/E interact(优先)/execute(处决·背刺)/1·2·3 weapon/Esc pause')
