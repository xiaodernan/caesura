import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { GroundedSpearField } from '@/combat/GroundedSpears'

/**
 * 投掷枪「落地留存 + 按处决键拾回」（docs/combat.md §4.3 / KI-006 剩余缺口①）。
 *
 * 这一批补的是那句话的后半句：Phase 4-A 让投掷变成真弹体（§4.3 前半句），但弹体的回收口径是
 * "这一发攻击结束了"，于是枪在命中/落地的那一刻被**抹掉**了，而 §4.3 说的是它躺在原地等她来捡。
 * 全 headless：留存名单与拾回判据都在逻辑层，`three` 只在被断言的组合根接线里出现（tech-arch §5.8）。
 */

registerGameData()

/** 枪的射程（表上的数：speed 28 / range 26）——飞行末端就是它躺下的地方 */
const SPEAR_RANGE = registry.get<MovesetData>('moveset:ms_spear').actions['charged'].projectile!.range

function makeWorld(weaponId = 'wp_drawpin_spear') {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>(weaponId)
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  // 地面查询是组合根注入的那一格：接上它，"落地"才贴得出 y=0，而不是停在高高的出手高度上
  combat.floorAt = () => 0
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  const notes: string[] = []
  const offFns = [
    bus.on('ui.notify', (p) => notes.push(p.text))
  ]
  player.camYawRef = 0
  player.yaw = Math.PI // 面向 -Z：枪口与射程都沿 -Z 走，断言只读 z

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input, TICK_DT)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  function off(): void { for (const f of offFns) f(); offFns.length = 0 }
  /** 蓄力 → 松手：一次投掷的出手入口（走合法输入通道，不直接调私有发射函数） */
  function throwOnce(hold = 60): void {
    frame.held.add('attackHeavy')
    tick(hold)
    frame.held.delete('attackHeavy')
    tick()
    // `charged` 的弹体在 activeStart（表上 20）那一拍才离手，而被拒的出手根本不会留下动作：
    // 于是"走到有弹体或没动作了"这一个循环既是等离手，也把拒绝那一支的窗口留给断言。
    for (let i = 0; i < 40 && combat.projectiles.live === 0 && player.action; i++) tick()
  }
  /** 按处决键（interact 沿）——同一个键在 §4.3 里既是处决也是拾回 */
  function pressInteract(): void { frame.edges.add('interact'); tick() }
  /** 飞到射程尽头被回收：返回那一刻地上的枪数（一杆枪 = 1） */
  function letItLand(max = 140): number {
    for (let i = 0; i < max && combat.projectiles.live > 0; i++) tick()
    tick(2) // 回收在同一个 pass 里，多走两拍保证名单已经写好
    return combat.groundedSpears.live
  }
  return { time, rhythm, player, ai, combat, frame, tick, throwOnce, pressInteract, letItLand, notes, off }
}

describe('§4.3 落地留存：投出去的枪留在世界里（KI-006①）', () => {
  it('飞到射程尽头后地上多出一杆，位置在飞行末端、y 贴到地面', () => {
    const w = makeWorld()
    w.throwOnce()
    expect(w.combat.projectiles.live, '蓄力松手要真的投出一发').toBe(1)
    expect(w.letItLand(), '弹体没了，但那一杆枪还在').toBe(1)
    const s = w.combat.groundedSpears.list()[0]
    expect(Math.abs(s.pos.z), '躺下的位置就是它飞完射程的那一点').toBeCloseTo(SPEAR_RANGE, 0)
    expect(s.pos.y, '落地 = 贴到地面高度，不是停在 1.15m 的出手高度').toBe(0)
    expect(s.dir.y, '躺平：朝向只保留水平分量').toBe(0)
    expect(s.dir.z, '枪尖仍指着它飞去的方向').toBeLessThan(-0.9)
    w.off()
  })

  it('打在敌人身上的那一杆同样留在原地（hit 也是"留在世界里"）', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -12 }, 'ki006-hit')
    const hp = e.stats.hp
    w.throwOnce()
    expect(w.letItLand(), '钉住定身之后枪不会跟着伤害一起消失').toBe(1)
    expect(e.stats.hp, '先确认这一发真的打在他身上（否则这条测的是飞行）').toBeLessThan(hp)
    const s = w.combat.groundedSpears.list()[0]
    expect(Math.abs(s.pos.z - -12), '躺下的位置在目标脚下，不是在玩家脚边').toBeLessThan(2)
    w.off()
  })

  it('只有带 flags:["throw"] 的那一式会留东西在地上：泛音弓的箭不落地留存', () => {
    const w = makeWorld('wp_overtone_bow')
    w.throwOnce()
    expect(w.combat.projectiles.live, '弓的蓄力式确实会射出弹体（否则这条测的是空）').toBeGreaterThan(0)
    expect(w.letItLand(), '箭射完就没了：§4.3 那句拾回是那一杆枪的待遇，不是所有远程武器的').toBe(0)
    expect(w.player.spearInHand, '箭不会占用手上那一格').toBe(true)
    w.off()
  })

  it('敌方弹体（哪怕 kind 是 spear）永远不会变成地上的枪：留不留由离手的身份决定', () => {
    const w = makeWorld()
    w.combat.projectiles.spawn({
      hostile: true, ownerId: 'en_test', kind: 'spear',
      origin: { x: 0, y: 1.2, z: 0 }, dir: { x: 0, y: 0, z: -1 },
      speed: 28, range: 20, radius: 0.3, damage: 5, poise: 1, hitStopMs: 0
    }, w.time.tick)
    expect(w.letItLand(), '没有 throw 旗标 ⇒ 它打完了就是打完了').toBe(0)
    w.off()
  })
})

describe('§4.3 按处决键拾回（KI-006①）', () => {
  it('走到枪边按处决键：地上清空、枪回手上、提示一句', () => {
    const w = makeWorld()
    w.throwOnce()
    w.letItLand()
    expect(w.player.spearInHand, '投出去之后手上那一格就该是空的').toBe(false)
    const s = w.combat.groundedSpears.list()[0]
    w.player.pos.x = s.pos.x; w.player.pos.z = s.pos.z
    w.pressInteract()
    expect(w.combat.groundedSpears.live).toBe(0)
    expect(w.player.spearInHand).toBe(true)
    expect(w.notes.join('|'), '拾回要看得见：那一句提示是玩家唯一的读数').toContain('拾回引针枪')
    w.off()
  })

  it('够不着就捡不到：超出 execution.crumpleRange 那一格反例成立', () => {
    const w = makeWorld()
    w.throwOnce()
    w.letItLand()
    // 玩家留在原点，枪在射程尽头——同一个按键此刻什么也不该做
    w.pressInteract()
    expect(w.combat.groundedSpears.live, '距离不够不许隔空拾回').toBe(1)
    expect(w.player.spearInHand).toBe(false)
    w.off()
  })

  it('枪不在手上就投不出第二杆，而且拒绝不烧精力', () => {
    const w = makeWorld()
    w.throwOnce()
    w.letItLand()
    const sta = w.player.stats.stamina
    w.player.pos.x = 0; w.player.pos.z = 0 // 站在原地再蓄一次力
    w.throwOnce()
    expect(w.combat.projectiles.live, '第二次投掷必须被拒').toBe(0)
    expect(w.player.action, '被拒的出手不该留下任何动作状态').toBeNull()
    expect(w.player.stats.stamina, '没发生的事不该收费（KI-027 同一条口径）').toBeGreaterThanOrEqual(sta)
    expect(w.notes.join('|')).toContain('手上没有枪')
    w.off()
  })

  it('拾回之后能再投一杆：那一格是活的开关，不是一次性提示', () => {
    const w = makeWorld()
    w.throwOnce()
    w.letItLand()
    const s = w.combat.groundedSpears.list()[0]
    w.player.pos.x = s.pos.x; w.player.pos.z = s.pos.z
    w.pressInteract()
    w.player.stats.stamina = w.player.stats.staMax
    w.player.pos.x = 0; w.player.pos.z = 0
    w.throwOnce()
    expect(w.combat.projectiles.live, '捡回来的枪要真的能再投出去').toBe(1)
    expect(w.player.spearInHand, '第二次离手同样要把那一格翻空').toBe(false)
    w.off()
  })

  it('附近有人可处决时先杀人：同一个键的优先级是战斗在前', () => {
    const w = makeWorld()
    w.throwOnce()
    w.letItLand()
    const s = w.combat.groundedSpears.list()[0]
    // 把一杆枪与一个可处决的目标摆在同一个位置：破势状态的敌人在 §5.4 里是 A 档处决候选
    const e = w.ai.spawn('en_murkshell', { x: s.pos.x, y: 0, z: s.pos.z }, 'ki006-prio')
    e.stats.crumpleTicksLeft = 60
    w.player.pos.x = s.pos.x; w.player.pos.z = s.pos.z
    w.pressInteract()
    expect(w.player.executing, '先起手处决演出').not.toBeNull()
    expect(w.combat.groundedSpears.live, '枪还在原地等下一次按键').toBe(1)
    w.off()
  })
})

describe('那一杆枪回家：死亡 / 跨区 / 重开（KI-006① 的三条出口）', () => {
  it('死亡把地上的枪收回家：下一世不会被一杆捡不到的枪卡死', () => {
    const w = makeWorld()
    w.throwOnce()
    w.letItLand()
    expect(w.combat.groundedSpears.live).toBe(1)
    w.player.stats.damage(9999)
    w.tick(2)
    expect(w.combat.groundedSpears.live, '人死了，地上那杆不该继续占着账').toBe(0)
    expect(w.player.spearInHand, '重新给一杆：否则复活后第一件事是投不出枪').toBe(true)
    w.off()
  })

  it('还在飞的那一杆也跟着回家：它落地时不再种下一杆新枪', () => {
    const w = makeWorld()
    w.throwOnce()
    expect(w.combat.projectiles.live, '先在空中').toBe(1)
    w.player.stats.damage(9999)
    w.tick(2)
    // 当场作废，而不是"等它自己飞完再看名单"：死亡期间 `restockSpear` 每 tick 都会清一次地上，
    // 于是"飞完后种下一杆、下一 tick又被清掉"在这条腿的旧写法里读数同样是 0——掩掉了机制本身。
    expect(w.combat.projectiles.live, '补枪那一刻就作废空中那一发：死人不该拖着一发还在打的攻击').toBe(0)
    expect(w.letItLand(), '那发飞行中的枪被摘掉拾回身份后作废，落地不计数').toBe(0)
    expect(w.combat.projectiles.live).toBe(0)
    w.off()
  })

  it('跨区那一次补货只敲一遍：空中那一发当场作废、落地不种新枪', () => {
    /**
     * 为什么死亡那条不够：`update()` 在人死着的每一 tick 都敲 `restockSpear`，而它开头就是
     * `groundedSpears.clear()`。所以"没摘身份、没作废弹体"这一类错，在死亡那条腿上要等到飞完
     * 才暴露，而暴露出来的那一杆又被下一次 clear 抹掉了——第一版探针正是这样白过一次（变异臂 A8
     * 摘掉整个循环体，15 条全绿）。这里走的是组合根**真的在用**的那条一次性入口（`main.ts` 跨区
     * 与 `startRun` 各敲一次，之后没人再敲），玩家活着，种下的那一杆没人替她清。
     */
    const w = makeWorld()
    w.throwOnce()
    expect(w.combat.projectiles.live, '补货的这一腿要有对象：先确认它在空中').toBe(1)
    w.combat.restockSpear()
    w.tick(1) // 从"标死"到"离开名册"隔着一拍：回收在 projectilePass 末尾的 reap 里
    expect(w.combat.projectiles.live, '那一发属于上一片区域：补货之后不许还在飞').toBe(0)
    expect(w.combat.groundedSpears.live, '作废不等于留下：先抹掉拾回身份，再谈回收').toBe(0)
    expect(w.letItLand(), '空中没有东西在飞，名单也不会自己长出来').toBe(0)
    expect(w.player.spearInHand, '补货的落点是手上').toBe(true)
    w.off()
  })

  it('restockSpear 幂等：连敲两次不多不少，一次都不欠', () => {
    const w = makeWorld()
    w.throwOnce()
    w.letItLand()
    w.combat.restockSpear()
    const first = w.combat.groundedSpears.live
    w.combat.restockSpear()
    expect(first, '第一次就把地上的清了').toBe(0)
    expect(w.combat.groundedSpears.live).toBe(0)
    expect(w.player.spearInHand).toBe(true)
    w.off()
  })

  it('组合根真的接了线：跨区与开新局各调用一次补货，地上的名单交给表现层', () => {
    const src = readFileSync('src/main.ts', 'utf8')
    const sites = src.split('combat.restockSpear()').length - 1
    expect(sites, '两个入口：跨区（world.travel 之后）与 startRun（每局一次）').toBe(2)
    const travel = src.indexOf("bus.emit('world.travel'")
    expect(travel, '读得到跨区那一句').toBeGreaterThan(0)
    expect(src.indexOf('combat.restockSpear()', travel) - travel, '跨区之后紧跟着就是补货').toBeLessThan(400)
    expect(src.includes('projectileVis.syncGrounded(combat.groundedSpears.list())'),
      '地上的枪要画得出来，否则"躺在地上"只在逻辑里成立').toBe(true)
  })
})

describe('留存名单本身（GroundedSpearField）', () => {
  it('nearestWithin 只认水平距离并取最近的一杆；remove/clear 说实话', () => {
    const field = new GroundedSpearField()
    field.plant({ x: 0, y: 3, z: -2 }, { x: 0, y: 1, z: -1 }, 10) // y=3：高挂着也照样够得着——距离只看 x/z
    field.plant({ x: 4, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 11)
    expect(field.live).toBe(2)
    expect(field.nearestWithin({ x: 0, y: 0, z: 0 }, 2.2)?.id, '半径内只有 A，而它的 y=3 不算距离').toBe(1)
    expect(field.nearestWithin({ x: 2.5, y: 0, z: 0 }, 4)?.id, '两杆都在半径内（A 3.2m / B 1.5m）时取最近的那杆').toBe(2)
    expect(field.nearestWithin({ x: 2.5, y: 0, z: 0 }, 2)?.id, '收窄半径就只剩 B 够得着').toBe(2)
    expect(field.nearestWithin({ x: -30, y: 0, z: 0 }, 2.2), '一杆都不在半径内时不许凭空选中').toBeNull()
    expect(field.remove(1)).toBe(true)
    expect(field.remove(1), '同一个 id 不许销两次').toBe(false)
    expect(field.live).toBe(1)
    field.clear()
    expect(field.live).toBe(0)
    expect(field.list()).toEqual([])
  })

  it('plant 归一化朝向并留下面向：躺着的姿态由这一格记住，表现层照抄', () => {
    const field = new GroundedSpearField()
    const s = field.plant({ x: 1, y: 0, z: 2 }, { x: 0, y: 5, z: -5 }, 40)
    expect(s.dir.y, 'y 分量被抹掉：斜插在半空的姿态不是"落地"').toBe(0)
    expect(Math.hypot(s.dir.x, s.dir.z), '水平朝向是单位向量').toBeCloseTo(1, 6)
    expect(s.dir.z, '方向跟着飞行方向走').toBeLessThan(0)
    expect(s.plantedTick).toBe(40)
    expect(s.pos, '位置是复制而不是别名：弹体对象回收后名单仍要读得出坐标').not.toBe({ x: 1, y: 0, z: 2 })
  })
})
