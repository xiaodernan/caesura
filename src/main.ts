import * as THREE from 'three'
import { bus } from '@/core/EventBus'
import { GameTime } from '@/core/Time'
import { GameLoop } from '@/core/GameLoop'
import { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registerGameData } from '@/data'
import { createArena } from '@/world/PlaceholderArena'

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

const camState = { yaw: 0.7, pitch: 0.28, dist: 5.4 }
const vel = new THREE.Vector3()

const scaffold = {
  update(_dt: number, _t: GameTime, inp: Input) {
    if (inp.frame.edges.has('pause')) time.paused = !time.paused
    camState.yaw -= inp.frame.look.dx
    camState.pitch = THREE.MathUtils.clamp(camState.pitch + inp.frame.look.dy * 0.6, -0.15, 1.15)
    const mv = inp.frame.move
    const sin = Math.sin(camState.yaw), cos = Math.cos(camState.yaw)
    const wish = new THREE.Vector3(mv.x * cos - mv.y * sin, 0, mv.x * sin + mv.y * cos)
    if (wish.lengthSq() > 1) wish.normalize()
    const speed = inp.frame.held.has('sprint') ? 7.2 : 4.6
    vel.lerp(wish.multiplyScalar(speed), 0.22)
    arena.playerVisual.position.addScaledVector(vel, _dt)
    if (vel.lengthSq() > 0.01) {
      const target = Math.atan2(vel.x, vel.z)
      const cur = arena.playerVisual.rotation.y
      arena.playerVisual.rotation.y += Math.atan2(Math.sin(target - cur), Math.cos(target - cur)) * 0.25
    }
    const p = arena.playerVisual.position
    const cp = new THREE.Vector3(
      p.x + Math.sin(camState.yaw) * Math.cos(camState.pitch) * camState.dist,
      p.y + 1.4 + Math.sin(camState.pitch) * camState.dist,
      p.z + Math.cos(camState.yaw) * Math.cos(camState.pitch) * camState.dist
    )
    arena.camera.position.lerp(cp, 0.18)
    arena.camera.lookAt(p.x, p.y + 1.15, p.z)
  },
  postTick(t: GameTime) { rhythm.update(t.dt) }
}

const loop = new GameLoop(time, input, (alpha, realDelta) => {
  arena.update(alpha, realDelta)
  arena.renderer.render(arena.scene, arena.camera)
})
loop.add(scaffold)

addEventListener('resize', () => arena.resize())
bus.on('log', (l) => console.info(`[caesura:${l.level}] ${l.msg}`))

;(window as unknown as Record<string, unknown>).__caesura = { loop, time, input, rhythm, arena, bus }

document.getElementById('boot')!.style.display = 'none'
;(window as unknown as Record<string, unknown>).__CAESURA_BOOTED__ = true
bus.emit('boot.ready', undefined)
loop.start()
console.info('[caesura] boot ok — tick/sprint/look, Esc pause')
