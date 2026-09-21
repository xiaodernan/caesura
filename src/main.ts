import { bus } from '@/core/EventBus'
import { GameTime } from '@/core/Time'
import { GameLoop } from '@/core/GameLoop'
import { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { createArena } from '@/world/PlaceholderArena'
import { ActorVisuals } from '@/world/ActorVisuals'
import { PlayerController } from '@/player/ThirdPersonController'
import { CameraRig } from '@/player/CameraRig'
import { LockOn } from '@/player/LockOn'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { AudioEngine } from '@/audio/AudioEngine'
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
const lock = new LockOn(player)
const ai = new AISystem()
const combat = new CombatManager(player, ai, time, rhythm)
const visuals = new ActorVisuals(arena.scene, arena.playerVisual, player)
const audio = new AudioEngine()
const vfx = new VfxLayer(arena.scene)
const hud = new Hud(document.getElementById('hud') as HTMLCanvasElement)
new CombatDebugger()

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
    if (inp.frame.edges.has('weaponSkill')) {
      bus.emit('ui.notify', { text: '乐章战技：将在 Phase 2 解锁', kind: 'info' })
    }
    player.update(dt, t, inp, t.tick, rhythm)
    // face locked target while locked & idle-ish
    if (lock.target) player.faceTowards(lock.target.getPos())
    ai.update(dt, t.tick, player, rhythm)
    combat.update(t.tick)
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

;(window as unknown as Record<string, unknown>).__caesura = { loop, time, input, rhythm, arena, player, ai, combat, lock, rig, bus }

document.getElementById('boot')!.style.display = 'none'
;(window as unknown as Record<string, unknown>).__CAESURA_BOOTED__ = true
bus.emit('boot.ready', undefined)
loop.start()
console.info('[caesura] combat prototype online — WASD/Shift/Ctrl-roll/LMB/RMB/F guard/G parry/Q lock/Esc pause')
