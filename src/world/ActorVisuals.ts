import * as THREE from 'three'
import { executionPose } from './ExecutionPose'
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

/**
 * 手里那把家伙的灰盒外形（KI-007）。表里的键就是 `weapons.json` 的 `archetype`——**选哪一组是数据说的**；
 * 组内这几个尺寸是灰盒美术（真资产来了整组换掉，选择逻辑不动）。`bow/staff/unique` 现在没有能装备的件，
 * 落进 `unknown` 那一组，见 `showForm` 的回退。
 */
const WEAPON_FORMS: Record<string, { blade: [number, number, number]; metal: number; grip: [number, number, number] }> = {
  straight_sword: { blade: [0.07, 0.95, 0.16], metal: 0xb9c4cc, grip: [0.03, 0.03, 0.22] },
  greatsword: { blade: [0.14, 1.5, 0.3], metal: 0x8f9aa4, grip: [0.045, 0.045, 0.34] },
  spear: { blade: [0.05, 1.9, 0.05], metal: 0xc7bfa8, grip: [0.035, 0.035, 0.5] },
  unknown: { blade: [0.07, 0.95, 0.16], metal: 0xb9c4cc, grip: [0.03, 0.03, 0.22] }
}

/** placeholder-grade actor visuals (docs/technical-architecture.md §1: assets later, interfaces now) */
export class ActorVisuals {
  private vis = new Map<string, EnemyVis>()
  /** 武器容器：每种 archetype 一个子组，只有手里那一把可见。挥击动画挂在容器上，换装不用改动画 */
  sword: THREE.Group
  private readonly forms = new Map<string, THREE.Group>()
  private shownForm = ''
  private shadowBlob: THREE.Mesh

  constructor(private scene: THREE.Scene, private playerMesh: THREE.Group, private player: PlayerController) {
    const sword = new THREE.Group()
    for (const [kind, form] of Object.entries(WEAPON_FORMS)) {
      const g = new THREE.Group()
      g.name = `weapon:${kind}` // 与 actor:* / greybox_* 同一约定：调试器与回归测试按名字找回模
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(...form.blade),
        new THREE.MeshStandardMaterial({ color: form.metal, metalness: 0.9, roughness: 0.25 })
      )
      blade.position.y = form.blade[1] / 2
      const grip = new THREE.Mesh(
        new THREE.CylinderGeometry(...form.grip),
        new THREE.MeshStandardMaterial({ color: 0x2b2620 })
      )
      grip.position.y = -0.05
      g.add(blade, grip)
      g.visible = false
      this.forms.set(kind, g)
      sword.add(g)
    }
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
    this.showForm(p)
    this.animateSword(p, tick)
  }

  /**
   * 只翻 visible，不重建模：换装是常态而几何体要留给渲染器复用。
   * 表里没有的 archetype（例如以后真加进来的弓）回退到 `unknown` 那一组**并保持看得见**——
   * 「手里空了」比「看着还是把剑」更糟：前者会让玩家以为装备没生效。
   */
  private showForm(p: PlayerController): void {
    const kind = p.weapon.archetype in WEAPON_FORMS ? p.weapon.archetype : 'unknown'
    if (kind === this.shownForm) return
    this.shownForm = kind
    for (const [k, g] of this.forms) g.visible = k === kind
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
    else if (e.frozenTicks > 0) glow = 0.08
    // §7.2 休止斩的可见 tell：前摇那点亮不再往上烧，振源核的呼吸也停住。
    // 冻结既不挪步也不出招，若没有这一点可见差别，玩家只能靠"它怎么不动了"反推自己那记时停
    // 到底成没成——一个自己看不出来的机制等于没有机制。挨打的那一闪光仍然压在上面（挨打是真的）。
    mat.emissiveIntensity = glow
    // §14.5 拍隙：半透明=打不着（振源核始终全亮，玩家靠它读「它现在在哪」）
    const want = e.intangible ? 0.18 : 1
    if (mat.opacity !== want) {
      mat.opacity = want
      mat.transparent = want < 1
      mat.needsUpdate = true
    }
    const hb = e.activeHitbox
    core.scale.setScalar(hb ? 1.6 : e.frozenTicks > 0 ? 1 : 1 + Math.sin(tick * 0.08) * 0.08)
    if (v.plate) v.plate.visible = !e.armorBroken // 碎甲是永久状态：板子掉了就是掉了
    // §5.4 处决演出（KI-002）：执行者正对着**这一具**演 → 受刑者按进度坍塌。
    // 受刑者的身份是"位置对得上"（executing.pos 记的就是它）——不需要第二份标记。
    const exec = this.player.executing
    if (exec && Math.hypot(e.pos.x - exec.pos.x, e.pos.z - exec.pos.z) < 0.6) {
      const pose = executionPose(exec.tick / Math.max(1, exec.total))
      group.rotation.x = pose.tilt
      group.position.y = e.pos.y - pose.sink * s
    } else if (e.state === 'recover') {
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
    // §5.4（KI-002）：处决蒙太奇的劈砍走姿态函数——高举、落刀、保持（刀不复位）
    if (p.executing) {
      sw.rotation.x = -0.5 + executionPose(p.executing.tick / Math.max(1, p.executing.total)).chop
      sw.rotation.z = 0
      return
    }
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
