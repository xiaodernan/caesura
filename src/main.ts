import { bus } from '@/core/EventBus'
import { GameTime } from '@/core/Time'
import { GameLoop } from '@/core/GameLoop'
import { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase, regions } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { createArena } from '@/world/PlaceholderArena'
import { StreamingSystem } from '@/world/Streaming'
import { Surface } from '@/world/Surface'
import { ChunkGreybox } from '@/world/ChunkGreybox'
import { ActorVisuals } from '@/world/ActorVisuals'
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
const surface = new Surface(regions)
const greybox = new ChunkGreybox(arena.scene, regions, streaming.chunkSize)

ai.spawn('en_murkshell', { x: 4, y: 0, z: -6 })
ai.spawn('en_murkshell', { x: -5, y: 0, z: -9 })
ai.spawn('en_driftsinger', { x: 1.5, y: 0, z: -12 })
ai.spawn('en_tympanus', { x: 8.5, y: 0, z: -15 })
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
    const here = streaming.regionAt(player.pos)
    if (here && here.id !== shownRegion) {
      shownRegion = here.id
      bus.emit('ui.notify', { text: here.displayName, kind: 'info' })
      bus.emit('log', { level: 'info', msg: `enter ${here.id} · chunks ${JSON.stringify(streaming.stats())}` })
    }
    // face locked target while locked & idle-ish
    if (lock.target) player.faceTowards(lock.target.getPos())
    ai.update(dt, t.tick, player, rhythm)
    combat.update(t.tick, inp)
    lock.update()
    visuals.sync(ai.enemies, t.tick)
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

;(window as unknown as Record<string, unknown>).__caesura = { loop, time, input, rhythm, arena, player, ai, combat, lock, rig, bus, streaming, surface, greybox }

document.getElementById('boot')!.style.display = 'none'
;(window as unknown as Record<string, unknown>).__CAESURA_BOOTED__ = true
bus.emit('boot.ready', undefined)
loop.start()
console.info('[caesura] combat prototype online — WASD/Shift/Ctrl-roll/LMB/RMB/F guard/G parry/Q lock/E execute(处决/背刺)/1·2·3 weapon/Esc pause')
