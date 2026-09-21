/**
 * 弹道子系统（Phase 4-A）：纯逻辑单元测试——不需要 DOM，也不需要任何渲染对象。
 * 覆盖：初速归一、直线/抛物线积分、射程与寿命到期、穿透计数、reap 通知、命中球。
 */
import { describe, expect, it } from 'vitest'
import { TICK_DT } from '@/core/Time'
import { ProjectileSystem, sphereHits, type LaunchParams } from '@/combat/Projectiles'

const ORIGIN = { x: 0, y: 1.1, z: 0 }

function launch(over: Partial<LaunchParams> = {}): LaunchParams {
  return {
    hostile: false, ownerId: 'player', kind: 'spear', origin: { ...ORIGIN },
    dir: { x: 0, y: 0, z: 1 }, speed: 20, range: 20, radius: 0.4,
    damage: 30, poise: 20, hitStopMs: 100, ...over
  }
}

function run(s: ProjectileSystem, ticks: number, from = 0): void {
  for (let i = 0; i < ticks; i++) s.update(TICK_DT, from + i + 1)
}

describe('ProjectileSystem 运动学', () => {
  it('出手方向被归一到 speed：斜着投也不会更快', () => {
    const s = new ProjectileSystem()
    const p = s.spawn(launch({ dir: { x: 0, y: 1, z: 1 } }), 1)
    expect(Math.hypot(p.vel.x, p.vel.y, p.vel.z)).toBeCloseTo(20, 6)
    expect(p.vel.y).toBeCloseTo(20 / Math.SQRT2, 6)
  })

  it('直线弹道：每 tick 走 speed/60 米，走满射程就到期（range）', () => {
    const s = new ProjectileSystem()
    const p = s.spawn(launch({ range: 10 }), 1)
    run(s, 15) // 15 tick = 0.25s × 20m/s = 5m
    expect(p.pos.z).toBeCloseTo(5, 3)
    expect(p.dead).toBe(false)
    run(s, 16)
    expect(p.dead).toBe(true)
    expect(p.gone).toBe('range')
    expect(p.rangeLeft).toBeLessThanOrEqual(0)
  })

  it('重力弹道：竖直分量按 g 递减，1 秒后的上升量 ≈ v₀t−½gt²', () => {
    const s = new ProjectileSystem()
    const p = s.spawn(launch({ gravity: 10, dir: { x: 0, y: 1, z: 0 }, speed: 10 }), 1)
    const y0 = p.pos.y
    run(s, 60)
    expect(p.vel.y).toBeCloseTo(0, 6) // 10 − 10×1s
    const risen = p.pos.y - y0
    expect(risen).toBeGreaterThan(4.5) // ½gt² 的显式积分误差不该超过一个可感知的高度
    expect(risen).toBeLessThan(5.05)
  })

  it('射程无限也留不住：超过寿命上限按 expire 回收（防弹体常驻）', () => {
    const s = new ProjectileSystem()
    const p = s.spawn(launch({ range: 1e6 }), 1)
    run(s, 601, 1)
    expect(p.dead).toBe(true)
    expect(p.gone).toBe('expire')
  })

  it('穿透计数：默认一击即碎，pierce=2 能吃三个目标且同一目标只结算一次', () => {
    const s = new ProjectileSystem()
    const one = s.spawn(launch(), 1)
    s.consume(one, 'en_a')
    expect(one.dead).toBe(true)

    const pierce = s.spawn(launch({ pierce: 2 }), 1)
    s.consume(pierce, 'en_a')
    s.consume(pierce, 'en_a') // 重复命中同一目标：不再扣名额
    expect(pierce.dead).toBe(false)
    s.consume(pierce, 'en_b')
    s.consume(pierce, 'en_c')
    expect(pierce.dead).toBe(true)
    expect(pierce.gone).toBe('hit')
    expect([...pierce.hitIds].sort()).toEqual(['en_a', 'en_b', 'en_c'])
  })

  it('reap：只通知一次、名单清空、活着的留下', () => {
    const s = new ProjectileSystem()
    const a = s.spawn(launch(), 1)
    s.spawn(launch({ range: 1e6 }), 1)
    const gone: string[] = []
    run(s, 61) // a 走满 20m 射程
    expect(a.dead).toBe(true)
    s.reap((p, why) => gone.push(`${p.id}:${why}`))
    s.reap((p, why) => gone.push(`${p.id}:${why}`)) // 第二次不该再收到
    expect(gone.length).toBe(1)
    expect(gone[0]).toBe(`${a.id}:range`)
    expect(s.live).toBe(1)
    s.clear()
    expect(s.live).toBe(0)
  })

  it('withOwner：主人被流送回收时能捞出它的弹体', () => {
    const s = new ProjectileSystem()
    s.spawn(launch({ hostile: true, ownerId: 'en_7' }), 1)
    s.spawn(launch({ hostile: true, ownerId: 'en_8' }), 1)
    expect(s.withOwner('en_7').length).toBe(1)
  })
})

describe('sphereHits 命中球', () => {
  const target = { pos: { x: 3, y: 0, z: 0 }, facingYaw: 0, radius: 0.5, height: 1.6 } // 靶心 (3, 0.8, 0)

  it('打胸口算命中（靶心在 height/2）', () => {
    const s = new ProjectileSystem()
    const p = s.spawn(launch({ origin: { x: 0, y: 0.8, z: 0 }, dir: { x: 1, y: 0, z: 0 } }), 1)
    expect(sphereHits(p, target)).toBe(false) // 还在出手点
    run(s, 9) // 9 tick ≈ 3m
    expect(p.pos.x).toBeCloseTo(3, 3)
    expect(sphereHits(p, target)).toBe(true)
  })

  it('从头顶飞过 / 从身侧偏出都不算命中', () => {
    const s = new ProjectileSystem()
    const high = s.spawn(launch({ origin: { x: 0, y: 3.2, z: 0 }, dir: { x: 1, y: 0, z: 0 } }), 1)
    const wide = s.spawn(launch({ origin: { x: 0, y: 0.8, z: 3 }, dir: { x: 1, y: 0, z: 0 } }), 1)
    run(s, 9)
    expect(sphereHits(high, target)).toBe(false)
    expect(sphereHits(wide, target)).toBe(false)
  })
})
