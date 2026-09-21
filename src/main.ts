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

const weapon = registry.get<WeaponData>('wp_tuning_sword')
const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
const player = new PlayerController(playerBase, weapon, moveset)

const WEAPON_SLOTS: Record<string, string> = {
  ability1: 'wp_tuning_sword', ability2: 'wp_fortissimo_greatsword', ability3: 'wp_drawpin_spear'
}
const WEAPON_NAMES: Record<string, string> = {
  'weapon.tuningSword': '调律剑', 'weapon.fortissimoGreatsword': '强音大剑', 'weapon.drawpinSpear': '引针枪'
}
function selectWeapon(id: string): void {
  const w = registry.get<WeaponData>(id)
  const ms = registry.get<MovesetData>(`moveset:${w.movesetId}`)
  if (w.id === player.weapon.id) return
  player.equip(w, ms)
  bus.emit('ui.notify', { text: `装备 · ${WEAPON_NAMES[w.nameKey] ?? w.nameKey}`, kind: 'info' })
}
const lock = new LockOn(player)
const ai = new AISystem()
const combat = new CombatManager(player, ai, time, rhythm)
const visuals = new ActorVisuals(arena.scene, arena.playerVisual, player)
const projectileVis = new ProjectileVisuals(arena.scene)
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
  if (r.rest && !player.stats.dead) player.rest()
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
    for (const act of ['ability1', 'ability2', 'ability3'] as const) {
      if (inp.frame.edges.has(act)) selectWeapon(WEAPON_SLOTS[act])
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

;(window as unknown as Record<string, unknown>).__caesura = { loop, time, input, rhythm, arena, player, ai, combat, lock, rig, bus, streaming, surface, greybox, interact, hud, spawner, nodes, projectileVis }

document.getElementById('boot')!.style.display = 'none'
;(window as unknown as Record<string, unknown>).__CAESURA_BOOTED__ = true
bus.emit('boot.ready', undefined)
loop.start()
console.info('[caesura] combat prototype online — WASD/Shift/Ctrl-roll/LMB/RMB/F guard/G parry/Q lock/E interact(优先)/execute(处决·背刺)/1·2·3 weapon/Esc pause')
