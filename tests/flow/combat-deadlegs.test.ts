import { describe, expect, it } from 'vitest'
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

/**
 * 批22a：CombatManager 近战判定组的死分支腿点亮（KI 死腿清扫）。
 * 夹具与 tests/flow/combat.test.ts 的 makeWorld 同构；每条用例标注它负责的行号，
 * 门禁由 .scratch/check_b22a.mjs 按「列级位置」逐一验亮（v8 分支 id 跨运行会漂移，不按 tag 匹配）。
 */

function makeWorld() {
  registerGameData()
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const weapon = registry.get<WeaponData>('wp_tuning_sword')
  const moveset = registry.get<MovesetData>('ms_sword')
  const player = new PlayerController(playerBase, weapon, moveset)
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)

  const frame = {
    move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 },
    held: new Set<string>(), edges: new Set<string>()
  }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0

  const notes: string[] = []
  const hits: Array<{ attackerId: string; victimId?: string; result: string; ranged?: boolean }> = []
  bus.on('ui.notify', (p) => notes.push((p as { text: string }).text))
  bus.on('combat.hit', (p) => hits.push(p as never))

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, rhythm, player, ai, combat, frame, tick, notes, hits }
}

/** 一发玩家弹体沿 -z 直飞，命中摆在 z=-2 的敌人（reaction/muteTicks 由用例点名） */
function firePlayerBolt(
  w: ReturnType<typeof makeWorld>,
  extra: { reaction?: 'R1' | 'R2' | 'R3'; muteTicks?: number }
): void {
  w.combat.projectiles.spawn({
    hostile: false, ownerId: 'player', kind: 'bolt',
    origin: { x: 0, y: 1.2, z: 0 }, dir: { x: 0, y: 0, z: -1 },
    speed: 20, range: 12, radius: 0.3, gravity: 0,
    damage: 9, poise: 4, hitStopMs: 0, parryable: false,
    layers: 1, pinTicks: 0, onBeat: false, loudness: 4,
    ...extra
  }, w.time.tick)
}

/** 近战用例必备：把玩家朝向 -z 的目标（默认 yaw=0 朝 +z 会挥空） */
function faceTo(w: ReturnType<typeof makeWorld>, z = -1.4): void {
  const a = Math.atan2(0 - w.player.pos.x, z - w.player.pos.z)
  w.player.yaw = a
  w.player.camYawRef = Math.PI + a
}

describe('批22a CombatManager 近战判定死腿（每条用例点名它负责的行）', () => {
  it('L99 stunTier：弹体 reaction=R3 走完三档判别链落到 R3', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -2 }, 'dl99')
    e.enter('idle')
    firePlayerBolt(w, { reaction: 'R3' })
    w.tick(10)
    // combat.hit 的 payload 不带 ranged 位（见 strikeEnemy 的 emit）；命中与否看账本与血量
    const h = w.hits.find((x) => x.attackerId === 'player')
    expect(h, 'R3 弹体必须结出一次命中（stunTier 第三档才被求值）').toBeTruthy()
    expect(e.stats.hp).toBeLessThan(e.stats.hpMax)
  })

  it('L264 fissureLayersOf：引针枪 jump 帧带 fissure 旗 → +1 层的那条腿亮', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.4 }, 'dl264')
    e.enter('idle')
    faceTo(w)
    w.player.equip(
      registry.get<WeaponData>('wp_drawpin_spear'),
      registry.get<MovesetData>('ms_spear')
    )
    expect(w.player.tryStartAction('jump', w.time.tick), 'jump 出手失败：本用例前提失效').toBe(true)
    w.tick(40)
    expect(e.stats.fissureLayers, 'fissure 旗的那一加层必须兑现').toBeGreaterThanOrEqual(1)
  })

  it('L280/L282 weaponBackstabMul：无背刺标签与非法倍率都落回 2.0 兜底', () => {
    const base = registry.get<WeaponData>('wp_tuning_sword')
    const ms = registry.get<MovesetData>('ms_sword')
    const noTag = { ...base, id: 'wp_dl_notag', swingTag: ['damage.physical'] } as unknown as WeaponData
    const badMul = { ...base, id: 'wp_dl_badmul', swingTag: ['crit.backstab0'] } as unknown as WeaponData
    for (const weapon of [noTag, badMul]) {
      const w = makeWorld()
      const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.4 }, 'dl280')
      e.enter('idle')
      faceTo(w)
      w.player.equip(weapon, ms)
      expect(w.player.tryStartAction('l1', w.time.tick), '轻击出手失败：本用例前提失效').toBe(true)
      w.tick(40)
      const h = w.hits.find((x) => x.attackerId === 'player')
      expect(h, '假武器的挥砍必须照常结算（倍率兜底不挡账）').toBeTruthy()
      expect(e.stats.hp).toBeLessThan(e.stats.hpMax)
    }
  })

  it('L314 markActionHit：名额用尽后第二件场地件走 continue，只结一次账', () => {
    const w = makeWorld()
    const billed: string[] = []
    const mkProp = (id: string, z: number) => ({ id, pos: { x: 0, y: 0, z } })
    const fake = {
      all: [mkProp('prop_a', -1.2), mkProp('prop_b', -1.2)],
      hittable: () => true,
      hitTarget: (p: { pos: { x: number; y: number; z: number } }) => ({
        pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z }, radius: 0.5, height: 1.4
      }),
      hitProp: (p: { id: string }) => billed.push(p.id)
    }
    ;(w.combat as unknown as { props: unknown }).props = fake
    faceTo(w)
    expect(w.player.tryStartAction('l1', w.time.tick), '轻击出手失败：本用例前提失效').toBe(true)
    w.tick(30)
    expect(billed, '一记一名：只有第一件场地件结账').toEqual(['prop_a'])
  })

  it('L440 鸣钟：钟甲目标吃 bellBonus 加成的那一腿', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_hanged_knight', { x: 0, y: 0, z: -1.4 }, 'dl440')
    e.enter('idle')
    faceTo(w)
    w.player.rpg.bellBonus = 0.25
    expect(w.player.tryStartAction('l1', w.time.tick), '轻击出手失败：本用例前提失效').toBe(true)
    w.tick(40)
    const h = w.hits.find((x) => x.attackerId === 'player')
    expect(h, '钟甲目标必须吃到这一次命中').toBeTruthy()
    expect(e.stats.hp).toBeLessThan(e.stats.hpMax)
  })

  it('L484 闷音定身：mute 弹体打中带光环的叠唱 → 定身 60', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_refrein', { x: 0, y: 0, z: -2 }, 'dl484')
    e.enter('idle')
    firePlayerBolt(w, { muteTicks: 60 })
    w.tick(10)
    // 定身从 60 起步、每 tick 倒数（EntityStats 的那口钟），命中后跑了几格所以读数 < 60 但必须 > 0
    expect(e.stunTicks, 'buffAura 目标吃闷音的定身必须兑现').toBeGreaterThan(0)
  })

  it('L577 R2 位移归一化：纯竖直弹速 hypot(x,z)=0 → ||1 兜底亮', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: 0 }, 'dl577')
    e.enter('idle')
    e.alertness = 0
    // 弹体从头顶竖直下落：projectileStrikesEnemy 把速度向量塞给 s.dir，其水平分量恰为零——
    // R2 displaceM=0.5 的归一化除零必须被 ||1 按住（重击会前冲破坏"重合"，所以走弹体通道）
    w.combat.projectiles.spawn({
      hostile: false, ownerId: 'player', kind: 'bolt',
      origin: { x: 0, y: 5, z: 0 }, dir: { x: 0, y: -1, z: 0 },
      speed: 20, range: 12, radius: 0.3, gravity: 0,
      damage: 9, poise: 4, hitStopMs: 0, parryable: false,
      layers: 1, pinTicks: 0, onBeat: false, loudness: 4
    }, w.time.tick)
    w.tick(16)
    const h = w.hits.find((x) => x.attackerId === 'player')
    expect(h, '竖直下落的弹体必须砸中目标').toBeTruthy()
    expect(Number.isFinite(e.pos.x) && Number.isFinite(e.pos.z)).toBe(true)
  })

  it('L618 回响：影到期时拍隙里的它不存在（intangible continue 腿）', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -1.4 }, 'dl618')
    e.enter('idle')
    faceTo(w)
    e.stats.hp = e.stats.hpMax // 血量拉满：它必须活着吃到回声扫掠那一刻
    expect(w.player.tryStartAction('h', w.time.tick), '重击出手失败：本用例前提失效').toBe(true)
    // 只推进到命中落账为止：影从这一击挂上（delayTicks=90），若再盲跑几十拍，
    // 影会在 intangible 设上之前到期消费，continue 腿就踩空了
    let landed = false
    for (let t = 0; t < 60 && !landed; t++) {
      w.tick()
      landed = w.hits.some((x) => x.attackerId === 'player')
    }
    expect(landed, '重击必须先结一次账：影由这一击挂上').toBe(true)
    const hpAfterHit = e.stats.hp
    expect(hpAfterHit).toBeLessThan(e.stats.hpMax)
    // 它此刻"缩进拍隙"（普通敌人无人重写 intangible，手造即成立）：
    // 影到期时打不到一个此刻不存在的东西——continue 那一腿由它点亮。
    // 逐 tick 重设是防御性的：命中之后再设，攻击本身才穿不进相、影才挂得出来
    for (let t = 0; t < 300 && w.combat.echoesLive > 0; t++) {
      e.intangible = true
      w.tick()
    }
    expect(w.combat.echoesLive, '回响影到期即清（清账过程踩过 intangible continue）').toBe(0)
    expect(e.stats.hp, '拍隙里的它不吃回声重演的账').toBe(hpAfterHit)
  })

  it('L648 投晶闸门：出手途中按 throwCrystal 被 action 一节拦回（true 腿）', () => {
    const w = makeWorld()
    w.combat.crystalSource = () => ({
      available: 0, consume: () => {},
      spec: { speed: 12, range: 10, radius: 0.3, gravity: 6, loudness: 0.8 }
    })
    expect(w.player.tryStartAction('l1', w.time.tick), '轻击出手失败：本用例前提失效').toBe(true)
    w.frame.edges.add('throwCrystal')
    w.tick()
    expect(w.notes, '忙碌闸门拦回：连"没有晶"的通知都不该出现').not.toContain('没有音色晶可投')
  })

  it('L648 补：空闲玩家按 throwCrystal → 没晶只报通知（false 路径的既有读数）', () => {
    const w = makeWorld()
    w.combat.crystalSource = () => ({
      available: 0, consume: () => {},
      spec: { speed: 12, range: 10, radius: 0.3, gravity: 6, loudness: 0.8 }
    })
    w.frame.edges.add('throwCrystal')
    w.tick()
    expect(w.notes, '没晶的投掷必须只报一句通知').toContain('没有音色晶可投')
  })

  it('L986 夺拍清账：漂移还在但没有夺拍者 → 网格归零的那一腿', () => {
    const w = makeWorld()
    w.rhythm.drift = 0.4
    w.tick()
    expect(w.rhythm.drift, '无人夺拍时漂移必须被清回 0').toBe(0)
  })
})
