import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT, TICK_HZ } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { EnemyData, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { Enemy } from '@/ai/Enemy'

/**
 * §16「Boss 均带：3 拍入场演出 + 胜利序列（IP §6：音乐停=世界屏息 0.5s）」的玩法流。
 * 夹具口径同 boss/mainboss：每 tick `time.reset()`（拍钟不跟 hitStop 走），
 * 需要真实时间推进的那一拍（屏息走完才落的收尾播报）用 `time.step()` 手动给。
 */

registerGameData()

const BEAT_108 = (60 / 108) * TICK_HZ // 奥斯塔拉的一拍 = 33.33 tick；3/4 拍 ⇒ 三拍正好一小节

function makeWorld(id: string, pos: { x: number; y: number; z: number }) {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const msOf = (w: WeaponData): MovesetData => registry.get<MovesetData>(`moveset:${w.movesetId}`)
  const sword = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, sword, msOf(sword))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  player.stats.hp = 9_999_999
  player.stats.hpMax = 9_999_999
  player.stats.poiseMax = 9_999_999
  const boss = ai.spawn(id, pos, 'show')

  const intros: Array<{ ticks: number; dataId: string }> = []
  const defeats: Array<{ holdTicks: number; dataId: string }> = []
  const music: Array<{ start: boolean; cut?: boolean }> = []
  const sfx: string[] = []
  const notifies: string[] = []
  const offs = [
    bus.on('boss.intro', (p) => intros.push({ ticks: p.ticks, dataId: p.dataId })),
    bus.on('boss.defeated', (p) => defeats.push({ holdTicks: p.holdTicks, dataId: p.dataId })),
    bus.on('audio.music.encounter', (p) => music.push(p)),
    bus.on('audio.sfx', (p) => sfx.push(p.key)),
    bus.on('ui.notify', (p) => notifies.push(p.text)),
  ]

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.reset()
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input, TICK_DT)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }

  /** 走真实伤害通道打死她（弹体 → strikeEnemy → onEnemyKilled），测试自己不叫死亡函数 */
  function killThroughRealChannel(target: Enemy): void {
    combat.projectiles.spawn({
      hostile: false, ownerId: 'player', kind: 'spear',
      origin: { x: target.pos.x, y: target.pos.y + 1.1, z: target.pos.z }, dir: { x: 0, y: 0, z: 1 },
      speed: 2, range: 5, radius: 1, damage: 9999, poise: 0, hitStopMs: 0
    }, time.tick)
    for (let t = 0; t < 10 && target.alive; t++) tick()
  }

  const off = (): void => { for (const f of offs) f() }
  return { time, rhythm, player, ai, combat, boss, tick, killThroughRealChannel, intros, defeats, music, sfx, notifies, off }
}

function ostlara() {
  return makeWorld('en_ostlara', { x: 0, y: -40, z: -3 })
}

/** 让她真的"看见"玩家：进战当 tick 之后 AI 就把全场网格换成她的私有拍速 */
function engage(w: ReturnType<typeof makeWorld>): void {
  w.boss.alertness = 100
  w.boss.enter('combat')
  w.tick(1)
}

describe('§16 入场演出：照面的那三拍', () => {
  it('时长是她自己的一小节（beats × 她的拍长），而且第一次锁定玩家就演', () => {
    const w = ostlara()
    engage(w)
    expect(w.intros.length, 'boss.intro 发出来了').toBe(1)
    const beats = registry.get<EnemyData>('en_ostlara').boss!.intro!.beats
    expect(w.boss.introTicksLeft, '= 3 拍 @108BPM = 100 tick').toBe(Math.round(beats * BEAT_108))
    expect(w.intros[0].ticks).toBe(Math.round(beats * BEAT_108))
    expect(w.sfx).toContain('bell_toll')
    expect(w.notifies.some((t) => t.includes('钟坠院的主人'))).toBe(true)
    w.off()
  })

  it('这几拍里她不出手、不挪步，只把身子转过来（但照吃伤害）', () => {
    const w = ostlara()
    engage(w)
    const hold = w.boss.introTicksLeft
    const at = { ...w.boss.pos }
    let attacks = 0
    let moved = 0
    const hp0 = w.boss.stats.hp
    // engage 那一 tick 就是第一拍（左手的 `hold` 已含它），所以再走 hold-1 拍
    for (let i = 1; i < hold; i++) {
      if (i === hold >> 1) {
        // 演到一半给她一记：白送的开局必须是**能收的**，否则这一格是禁用位而不是演出
        w.combat.projectiles.spawn({
          hostile: false, ownerId: 'player', kind: 'spear',
          origin: { x: w.boss.pos.x, y: w.boss.pos.y + 1.1, z: w.boss.pos.z }, dir: { x: 0, y: 0, z: 1 },
          speed: 2, range: 5, radius: 1.5, damage: 25, poise: 0, hitStopMs: 0
        }, w.time.tick)
      }
      w.tick()
      if (w.boss.attack) attacks++
      moved = Math.max(moved, Math.hypot(w.boss.pos.x - at.x, w.boss.pos.z - at.z))
    }
    expect(attacks, '一次手都没出').toBe(0)
    expect(moved, '一步没挪').toBeLessThan(0.01)
    expect(w.boss.stats.hp, '硬直窗口不封伤害').toBeLessThan(hp0)
    expect(w.boss.introTicksLeft, '挨打也不把演出省掉').toBe(1)
    w.tick()
    expect(w.boss.introTicksLeft, '演完归零').toBe(0)
    w.tick(600)
    expect(w.boss.attack, '演完她就打：这不是永久站桩').not.toBeNull()
    w.off()
  })

  it('演的是「第一次照面」：脱战再回来不再演第二场（否则白送的窗口可以刷）', () => {
    const w = ostlara()
    engage(w)
    w.tick(w.boss.introTicksLeft + 5)
    w.boss.alertness = 0
    w.boss.enter('patrol')
    w.tick(2)
    w.boss.alertness = 100
    w.boss.enter('combat')
    w.tick(5)
    expect(w.intros.length, '第二场不再演').toBe(1)
    expect(w.boss.introTicksLeft).toBe(0)
    w.off()
  })
})

describe('§16 胜利序列：音乐停 = 世界屏息', () => {
  it('她倒下那一刻：战斗层音乐立刻掐掉（不是脱战那条 4s 淡出），世界压到慢速', () => {
    const w = ostlara()
    engage(w)
    w.tick(w.boss.introTicksLeft + 5)
    w.killThroughRealChannel(w.boss)
    expect(w.boss.alive, '走的是真伤害通道').toBe(false)
    expect(w.defeats.length).toBe(1)
    expect(w.defeats[0].holdTicks, '§16 写的 0.5s').toBe(30)
    expect(w.music.filter((m) => !m.start && m.cut).length, '立刻停，且带 cut 标记').toBe(1)
    expect(w.music.some((m) => !m.start && !m.cut), '脱战那条普通通知也照发（两条语义并存）').toBe(true)
    expect(w.time.rawScale, '此刻世界正在屏息（hitStop 把逻辑时间压到 5%）').toBeLessThan(1)
    w.off()
  })

  it('收尾那行字排在屏息之后：安静里不落字', () => {
    const w = ostlara()
    const label = registry.get<EnemyData>('en_ostlara').boss!.victory!.label!
    engage(w)
    w.tick(w.boss.introTicksLeft + 5)
    w.killThroughRealChannel(w.boss)
    expect(w.notifies.includes(label), '0.5s 之内它不该出现').toBe(false)
    w.time.step(30 / TICK_HZ + 0.05) // 真实时间走完那一段屏息
    w.tick(1)
    expect(w.notifies.includes(label), '屏息走完，字才落').toBe(true)
    w.off()
  })
})

describe('§16「Boss 均带」在数据里：三具 Boss 两格齐全，且不改变各自的身份', () => {
  it('奥斯塔拉与恩希尔带音色的入场；万籁的入场是"没有声音"（§15.3 的读相）', () => {
    const o = registry.get<EnemyData>('en_ostlara').boss!
    const h = registry.get<EnemyData>('en_hersil').boss!
    const m = registry.get<EnemyData>('en_myriad').boss!
    for (const [id, b] of [['ostlara', o], ['hersil', h], ['myriad', m]] as const) {
      expect(b.intro?.beats, `${id} 入场拍数`).toBeGreaterThan(0)
      expect(b.victory?.holdTicks, `${id} 屏息时长`).toBeGreaterThan(0)
    }
    expect(o.intro!.sfx?.length, '她的照面是一口钟').toBeGreaterThan(0)
    expect(m.intro!.sfx, '万籁登场没有声音：那三拍是静').toBeUndefined()
    expect(m.bpm, '无网格领域不因她接管成别的拍速').toBeUndefined()
    expect(m.phases.length, '她被登记为单阶（KI-024）').toBe(1)
    const own = registry.get<EnemyData>('en_myriad').attacks.map((a) => a.id).sort()
    expect([...m.phases[0].attacks].sort(), '阶段白名单=她全部招式 ⇒ 加这一格没有收窄她的招式池').toEqual(own)
  })
})
