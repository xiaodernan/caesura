import * as THREE from 'three'
import type { Enemy } from '@/ai/Enemy'
import type { PlayerController } from '@/player/ThirdPersonController'

interface EnemyVis {
  group: THREE.Group
  body: THREE.Mesh<THREE.CapsuleGeometry, THREE.MeshStandardMaterial>
  core: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>
  /** §14.7 钟甲板：只在 `ai.armorFront` 的敌人身上存在，碎甲后隐藏（灰盒级可读性） */
  plate: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> | null
  e: Enemy
}

/** placeholder-grade actor visuals (docs/technical-architecture.md §1: assets later, interfaces now) */
export class ActorVisuals {
  private vis = new Map<string, EnemyVis>()
  sword: THREE.Group
  private shadowBlob: THREE.Mesh

  constructor(private scene: THREE.Scene, private playerMesh: THREE.Group, private player: PlayerController) {
    const sword = new THREE.Group()
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.95, 0.16),
      new THREE.MeshStandardMaterial({ color: 0xb9c4cc, metalness: 0.9, roughness: 0.25 })
    )
    blade.position.y = 0.55
    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x2b2620 })
    )
    grip.position.y = -0.05
    sword.add(blade, grip)
    sword.position.set(0.38, 1.15, 0.18)
    sword.rotation.x = -0.5
    this.sword = sword
    playerMesh.add(sword)
    this.shadowBlob = new THREE.Mesh(
      new THREE.CircleGeometry(0.5, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })
    )
    this.shadowBlob.rotation.x = -Math.PI / 2
    this.shadowBlob.position.y = 0.02
    playerMesh.add(this.shadowBlob)
  }

  sync(enemies: Enemy[], tick: number): void {
    // spawn visuals for new enemies
    for (const e of enemies) {
      if (this.vis.has(e.id)) continue
      const s = e.data.body?.scale ?? 1
      const group = new THREE.Group()
      group.name = `actor:${e.id}` // 调试器/回归测试按这个名字找回一具模（和 greybox_* 同一约定）
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.45 * s, 0.7 * s, 6, 12),
        new THREE.MeshStandardMaterial({
          color: e.data.body?.color ?? 0x555555,
          emissive: e.data.body?.emissive ?? 0x222222,
          emissiveIntensity: 0.5, roughness: 0.75
        })
      )
      body.position.y = 0.85 * s
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.11 * s, 12, 12),
        new THREE.MeshStandardMaterial({
          color: e.data.body?.coreColor ?? 0xff4422,
          emissive: e.data.body?.coreColor ?? 0xff4422, emissiveIntensity: 2.2
        })
      )
      core.position.set(0, 1.15 * s, 0.36 * s)
      group.add(body, core)
      // §14.7 钟甲：一块立在正面的板。它必须在视觉上「挡住那 60°」，否则减伤规则读不出来
      let plate: EnemyVis['plate'] = null
      if (e.data.ai.armorFront) {
        plate = new THREE.Mesh(
          new THREE.BoxGeometry(1.15 * s, 1.5 * s, 0.1 * s),
          new THREE.MeshStandardMaterial({ color: 0x8c7a55, metalness: 0.85, roughness: 0.35 })
        )
        plate.position.set(0, 0.95 * s, 0.52 * s)
        group.add(plate)
      }
      this.scene.add(group)
      this.vis.set(e.id, { group, body, core, plate, e })
    }
    // retire visuals of enemies removed from the roster
    for (const [id, v] of this.vis) {
      if (!enemies.includes(v.e)) {
        this.scene.remove(v.group)
        // 流送会反复增删敌人（SpawnDirector），不 dispose 就是每跑一圈漏一批 GPU 资源
        v.body.geometry.dispose()
        v.body.material.dispose()
        v.core.geometry.dispose()
        v.core.material.dispose()
        if (v.plate) {
          v.plate.geometry.dispose()
          v.plate.material.dispose()
        }
        this.vis.delete(id)
      }
    }
    for (const v of this.vis.values()) this.updateEnemy(v, tick)

    // ---- player ----
    const p = this.player
    this.playerMesh.position.set(p.pos.x, p.pos.y, p.pos.z)
    this.playerMesh.rotation.y = p.yaw
    this.animateSword(p, tick)
  }

  private updateEnemy(v: EnemyVis, tick: number): void {
    const { group, body, core, e } = v
    const s = e.data.body?.scale ?? 1
    group.position.set(e.pos.x, e.pos.y, e.pos.z)
    group.rotation.y = e.yaw
    const mat = body.material
    let glow = 0.5
    if (e.attack && e.attack.tick >= 0 && e.attack.tick < e.attack.spec.frames.startup) {
      // telegraph: pulse brighter as the hit frame approaches (docs/combat.md readability rule)
      const prog = e.attack.tick / Math.max(1, e.attack.spec.frames.startup)
      glow = 0.5 + prog * prog * 2.4
      if (e.attack.spec.frames.lunge) group.position.addScaledVector(
        new THREE.Vector3(Math.sin(e.yaw), 0, Math.cos(e.yaw)), -0.2 * (1 - prog))
    }
    if (e.coreFlash > 0) glow = 3.2
    mat.emissiveIntensity = glow
    // §14.5 拍隙：半透明=打不着（振源核始终全亮，玩家靠它读「它现在在哪」）
    const want = e.intangible ? 0.18 : 1
    if (mat.opacity !== want) {
      mat.opacity = want
      mat.transparent = want < 1
      mat.needsUpdate = true
    }
    const hb = e.activeHitbox
    core.scale.setScalar(hb ? 1.6 : 1 + Math.sin(tick * 0.08) * 0.08)
    if (v.plate) v.plate.visible = !e.armorBroken // 碎甲是永久状态：板子掉了就是掉了
    if (e.state === 'recover') {
      group.position.y = -0.25 * s
      group.rotation.x = 0.35
    } else group.rotation.x = 0
    if (!e.alive) {
      const k = Math.min(1, e.stateTick / 90)
      group.position.y = -k * 0.9 * s
      group.scale.setScalar(Math.max(0.001, 1 - k))
      if (k >= 1) { this.scene.remove(group); this.vis.delete(e.id) }
    }
  }

  private animateSword(p: PlayerController, tick: number): void {
    const sw = this.sword
    if (p.action) {
      const f = p.action.f
      const t = p.action.tick
      let swing = 0
      if (t < f.startup) swing = -1.7 * (t / Math.max(1, f.startup)) // wind-up back
      else if (t <= f.activeEnd) {
        const k = (t - f.startup) / Math.max(1, f.activeEnd - f.startup)
        swing = -1.7 + k * 3.1 // slash through
      } else {
        const k = Math.min(1, (t - f.activeEnd) / Math.max(1, f.recovery - f.activeEnd))
        swing = 1.4 * (1 - k)
      }
      sw.rotation.x = -0.5 + swing
      sw.rotation.z = swing * 0.35
    } else if (p.parryActive) {
      sw.rotation.x = 0.6
      sw.rotation.z = 1.2
    } else if (p.guarding) {
      sw.rotation.x = -1.4
      sw.rotation.z = 0.4
    } else if (p.roll) {
      sw.rotation.x = -2.2
    } else {
      const idle = Math.sin(tick * 0.04) * 0.05
      sw.rotation.x = -0.5 + idle
      sw.rotation.z = 0
    }
  }
}
