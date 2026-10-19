import * as THREE from 'three'
import { bus } from '@/core/EventBus'
import { getDecalSystem } from './Decals'
import { getGPUParticles } from './GPUParticles'

/**
 * **世界事件 → 表现层**的唯一接线处（Phase B4，KI-136）。
 *
 * **为什么集中在一个文件**：三条表现层频道各有自己的发射方，若每个模块各自去订阅世界事件，
 * "敌人倒了会出什么东西"这件事就散在三个文件里——而它**是同一件事**（一次倒地的表现 =
 * 一张血贴花 ＋ 一团死亡粒子），散开就成了三个主人（KI-066 那一族）。这里给出唯一一处接线，
 * 每条都写清"哪个世界事件 ⇒ 哪条配置 id ⇒ 什么位置/朝向"。
 *
 * **发射方住在表现层**：战斗层与 AI 层只管"谁死了""打中了""换阶段了"（那些事件本来就有），
 * 要它们再为"地上要留一块血"发一条事件，就是给表现层的事找了个战斗层的地址。
 *
 * **表与读的对应**（`vfx.json` 的九行配置，九个读者，`tests/unit/vfx-table.test.ts` 有门钉着）：
 *   · `decal_blood`  ← `entity.died`（敌人）——地上那块血
 *   · `fx_death_burst` ← `entity.died`（敌人）——散开的那团
 *   · `fx_hit_spark`  ← `combat.hit`（打中/擦到）——命中点那簇火花
 *   · `fx_dust`       ← `camera.shake`（key=`stomp`）——重踏扬起的尘
 *   · `decal_crack`   ← `camera.shake`（key=`stomp`）——重踏压裂的地
 *   · `decal_scorch`  ← `boss.phase`——换阶段烧焦的那块地
 *   （`decal_impact` / `trail_blade` / `trail_arrow` 的发射方在战斗层与玩家控制器那一侧：
 *   弹着点要知道弹体落在哪、拖尾要知道刃口在哪——那些坐标只有那一侧有。）
 */

/** 地面法线（贴花贴在地上，法线朝上） */
const UP = new THREE.Vector3(0, 1, 0)

/** 世界事件 → 表现层的接线。**只注册一次**：`bus` 是进程级单例，注册两遍就会双份。 */
export function registerVfxWorldEmitters(): void {
  // 敌人倒地：地上留一块血 ＋ 散开一团粒子
  bus.on('entity.died', (e) => {
    if (e.kind !== 'enemy') return
    const at = new THREE.Vector3(e.position.x, e.position.y, e.position.z)
    getDecalSystem()?.spawn('decal_blood', at, UP)
    getGPUParticles()?.burst('fx_death_burst', at)
  })

  // 命中：火花在命中点炸开（无敌帧不算一次世界事件，挡与弹反各有自己的形状）
  bus.on('combat.hit', (h) => {
    if (h.result !== 'hit' && h.result !== 'graze') return
    getGPUParticles()?.burst('fx_hit_spark', new THREE.Vector3(h.point.x, h.point.y, h.point.z))
  })

  // 重踏（§10「驼鼓踏地」那一行）：地上压出一道裂痕 ＋ 扬起一片尘
  bus.on('camera.shake', (p) => {
    if (p.key !== 'stomp' || !p.pos) return
    const at = new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z)
    getDecalSystem()?.spawn('decal_crack', at, UP)
    getGPUParticles()?.burst('fx_dust', at)
  })

  // Boss 换阶段：脚下的地烧焦一块（位置随事件带，KI-136 给 `boss.phase` 补了 `pos`）
  bus.on('boss.phase', (p) => {
    if (!p.pos) return
    getDecalSystem()?.spawn('decal_scorch', new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z), UP)
  })
}
