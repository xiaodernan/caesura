import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { bus } from '@/core/EventBus'
import { shapeHits, type HitTarget } from '@/combat/HitShapes'
import type { EnemyData, Hitbox, HitboxCone, MovementConfig, MovesetData, WeaponData } from '@/data/schema'
import { GameTime, TICK_DT, TICK_HZ } from '@/core/Time'
import { GameLoop } from '@/core/GameLoop'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { Enemy } from '@/ai/Enemy'
import { CombatManager } from '@/combat/CombatManager'
import { RpgRuntime } from '@/rpg/Runtime'
import { ActorVisuals } from '@/world/ActorVisuals'

/**
 * KI-300：combat.md §17「实现说明（Three.js 落地约束）」那五行第一次有**打开文档字节来读**的机器读者。
 *
 * **与 KI-297 的分工**（那批的腿在 `impl-constraints-sec17.test.ts`，文件名与本批只差字序，本批因此改名
 * `sec17-doc-rows`）：KI-297 量的是**运行时的六条真链**，它的文件里一次都没有 `readFileSync`——文档那五格
 * 只作为散文抄在测试标题里，**改文档里的一个数，那批的腿一条都不会红**。本批钉的是**文档字节本身 ⇄ 代码/表
 * 的读数**两侧：文档那一侧由 `sec17Rows()` 现读 docs/combat.md，代码那一侧手钉自本文件落地前的探针趟
 * （平面 checkout 在要提交的那份字节上，读数见 `.scratch/ki300/probe-master.txt`）。任一侧动，那条腿就红
 * ——红了重新裁决并写 KNOWN_ISSUES，而不是把断言瞄到新读数上。
 * 对不上的八面（30Hz／轮转／currentTime／仅插值／60-120°／bosses.json／F9／hitbox 线框）
 * 都写在下面的判决句里，本文件不替文档遮。
 */

const ROOT = new URL('../../', import.meta.url)
const DOC = readFileSync(new URL('docs/combat.md', ROOT), 'utf8')
registerGameData()

const ESCAPED_PIPE = String.fromCharCode(92) + '|'
const SOH = String.fromCharCode(1)

/** §17 那张三列表：系统 → {方案, 备注}。格内竖线按 KI-159 的规矩是转义过的，先藏再切。 */
function sec17Rows(): Map<string, { 方案: string; 备注: string }> {
  const at = DOC.indexOf('## 17. 实现说明')
  if (at < 0) throw new Error('combat.md 里没有「## 17. 实现说明」这一节')
  const next = DOC.indexOf('\n## ', at + 5)
  const body = DOC.slice(at, next < 0 ? DOC.length : next)
  const rows = new Map<string, { 方案: string; 备注: string }>()
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trimEnd()
    if (!line.startsWith('|') || !line.endsWith('|')) continue
    const cells = line
      .slice(1, -1)
      .split(ESCAPED_PIPE)
      .join(SOH)
      .split('|')
      .map((c) => c.trim().split(SOH).join('|'))
    if (cells.length !== 3) continue
    if (cells[0] === '系统' || /^[-: ]+$/.test(cells[0])) continue
    rows.set(cells[0], { 方案: cells[1], 备注: cells[2] })
  }
  return rows
}

/** src（或其子目录）下全部 .ts/.tsx 的文本；目录名不算读者 */
function srcFiles(dir = 'src'): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = []
  for (const ent of readdirSync(new URL(dir + '/', ROOT), { withFileTypes: true })) {
    const p = `${dir}/${ent.name}`
    if (ent.isDirectory()) out.push(...srcFiles(p))
    else if (/\.[jt]sx?$/.test(ent.name)) out.push({ path: p, text: readFileSync(new URL(p, ROOT), 'utf8') })
  }
  return out
}

interface ConeRow {
  carrier: string
  side: 'moveset' | 'enemy' | 'movement'
  angleDeg: number
  radius: number
  height: number
}

/**
 * 三张带 hitbox 的表的名册（moveset 帧／敌人帧／战技 frame）。
 * 敌人注册的是裸 id（`registry.register(e.id, …)`），用 `ids('enemy:')` 去捞只会捞到空数组——
 * 那一趟假读数曾报「enemy 侧 0 格」，所以这里按结构准入：同时有 ai 与 attacks 两个键的条目才算敌人。
 */
function hitboxCensus(): { cone: ConeRow[]; shapes: Record<string, number>; enemies: number } {
  const cone: ConeRow[] = []
  const shapes: Record<string, number> = {}
  const bump = (carrier: string, hb: Hitbox): void => {
    shapes[`${carrier}:${hb.shape}`] = (shapes[`${carrier}:${hb.shape}`] ?? 0) + 1
  }
  const push = (carrier: string, side: ConeRow['side'], hb: Hitbox): void => {
    bump(side === 'moveset' ? `moveset:${carrier}` : `${side}:${carrier}`, hb)
    if (hb.shape === 'cone') {
      const c = hb as HitboxCone
      cone.push({ carrier: `${side}:${carrier}`, side, angleDeg: c.angleDeg, radius: c.radius, height: c.height })
    }
  }
  for (const id of registry.ids('moveset:')) {
    const ms = registry.get<MovesetData>(id)
    for (const [act, f] of Object.entries(ms.actions ?? {})) {
      if (f.hitbox) push(`${ms.id}.${act}`, 'moveset', f.hitbox)
    }
  }
  const enemyRows = registry
    .ids()
    .map((id) => registry.maybeGet<EnemyData>(id))
    .filter((v): v is EnemyData => !!v && typeof v === 'object' && 'ai' in v && 'attacks' in v)
  for (const en of enemyRows) {
    const walk = (node: unknown, atk: string): void => {
      if (!node || typeof node !== 'object') return
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        const rec = v as Hitbox | undefined
        if (k === 'hitbox' && rec?.shape) push(`${en.id}.${atk}`, 'enemy', rec)
        else walk(v, atk)
      }
    }
    for (const [i, spec] of (en.attacks ?? []).entries()) walk(spec, `atk${i}`)
  }
  for (const mv of registry.get<MovementConfig>('movements').movements) {
    if (mv.frame.hitbox) push(mv.id, 'movement', mv.frame.hitbox)
  }
  return { cone, shapes, enemies: enemyRows.length }
}

const origin = { x: 0, y: 0, z: 0 }
const tgt = (pos: { x: number; y: number; z: number }, over: Partial<HitTarget> = {}): HitTarget =>
  ({ pos, facingYaw: 0, radius: 0.55, height: 1.8, ...over })
/** 合成扇形：90°／半径 4／高 2／中心抬 0.4——四条边界各在一侧，改哪一条只红那一条 */
const cone = (over: Partial<HitboxCone> = {}): HitboxCone =>
  ({ shape: 'cone', angleDeg: 90, radius: 4, height: 2, offsetY: 0.4, ...over })

/** 沿正前方逐 0.005m 扫，取 {最后命中, 第一格不命中} */
function sweepDist(box: HitboxCone): { lastHit: number; firstMiss: number } {
  let lastHit = -1
  let firstMiss = -1
  for (let d = 0; d <= 6; d += 0.005) {
    if (shapeHits(box, origin, 0, tgt({ x: 0, y: 0, z: d }))) lastHit = Number(d.toFixed(3))
    else { firstMiss = Number(d.toFixed(3)); break }
  }
  return { lastHit, firstMiss }
}

/** 沿极角逐 0.005° 扫，取最后一个命中的角度 */
function lastHitAngle(box: HitboxCone, dist: number): number {
  let last = -1
  for (let deg = 0; deg <= 100; deg += 0.005) {
    const a = (deg * Math.PI) / 180
    if (shapeHits(box, origin, 0, tgt({ x: Math.sin(a) * dist, y: 0, z: Math.cos(a) * dist }))) last = Number(deg.toFixed(3))
    else break
  }
  return last
}

/** 垂直带的上下沿（在给定水平距离处） */
function sweepY(box: HitboxCone, dist: number): { lo: number; hi: number } {
  let lo = Number.NaN
  let hi = Number.NaN
  for (let y = -6; y <= 6; y += 0.005) if (shapeHits(box, origin, 0, tgt({ x: 0, y, z: dist }))) { lo = Number(y.toFixed(3)); break }
  for (let y = 6; y >= -6; y -= 0.005) if (shapeHits(box, origin, 0, tgt({ x: 0, y, z: dist }))) { hi = Number(y.toFixed(3)); break }
  return { lo, hi }
}

/** 定步长世界：与 main.ts 的 core.update 同一条序列（player→ai→combat→rhythm） */
function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime()
  const weapon = registry.get<WeaponData>(rpg.mods().weaponId!)
  const player = new PlayerController(playerBase, weapon, registry.get<MovesetData>(`moveset:${weapon.movesetId}`))
  player.applyRpg(rpg.mods())
  player.setSkills(rpg.skillLoadout())
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0
  const pins: Array<() => void> = []
  const hits: Array<Record<string, unknown>> = []
  const off = bus.on('combat.hit', (p: Record<string, unknown>) => hits.push({ ...p }))
  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      for (const pin of pins) pin()
      time.tick++
      time.step(TICK_DT)
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }
  return { time, rhythm, rpg, weapon, player, ai, combat, frame, input, tick, pins, hits, off }
}

/** 把 Enemy.prototype 上的一个方法包一层，数每一拍它被调了几次——"轮转"与"齐步"只有这一种分法 */
function perTickVisits(n: number, ticks: number, method: 'sense' | 'update'): number[] {
  const w = makeWorld()
  for (let i = 0; i < n; i++) {
    w.ai.spawn('en_murkshell', { x: (i % 8) * 1.5 - 5.25, y: 0, z: 4 + Math.floor(i / 8) * 1.5 }, 'probe')
  }
  const per: number[] = []
  const proto = Enemy.prototype as unknown as Record<string, (...args: unknown[]) => unknown>
  const orig = proto[method]
  proto[method] = function (this: Enemy, ...args: unknown[]): unknown {
    per[per.length - 1] = (per[per.length - 1] ?? 0) + 1
    return orig.apply(this, args)
  }
  try {
    for (let i = 0; i < ticks; i++) {
      per.push(0)
      w.tick(1)
    }
  } finally {
    proto[method] = orig
    w.off()
  }
  return per
}

const R = sec17Rows()

describe('KI-300 §17 那张表本身', () => {
  it('恰是那五行、每行恰三格——行名册是这一节的身份证', () => {
    expect([...R.keys()]).toEqual(['帧数据/敌人表', '命中框', 'BeatClock', 'AI tick', '调试器'])
    for (const [k, v] of R) {
      expect(v.方案, `${k} 的方案格`).not.toBe('')
      expect(v.备注, `${k} 的备注格`).not.toBe('')
    }
  })

  it('「不用物理引擎」这一格：装的就只有 three，src 里没有 Raycaster，近战命中只走 shapeHits 一个门', () => {
    const pkg = JSON.parse(readFileSync(new URL('package.json', ROOT), 'utf8')) as { dependencies: Record<string, string> }
    expect(Object.keys(pkg.dependencies)).toEqual(['three'])
    const files = srcFiles()
    expect(files.filter((f) => f.text.includes('Raycaster')).map((f) => f.path)).toEqual([])
    const callers = files
      .filter((f) => f.path !== 'src/combat/HitShapes.ts')
      .flatMap((f) => (f.text.match(/shapeHits\(/g) ?? []).map(() => f.path))
      .sort()
    expect(callers.length).toBe(4)
    expect([...new Set(callers)]).toEqual(['src/combat/CombatManager.ts'])
  })
})

describe('KI-300 §17 第一行（帧数据/敌人表：点名的文件 ⇄ 磁盘名册）', () => {
  it('那一格点名四个 json，其中 bosses.json 磁盘上没有；帧数据真正住的 movesets.json 没被点名（登记：偏差在文档侧）', () => {
    const cell = `${R.get('帧数据/敌人表')!.方案} ${R.get('帧数据/敌人表')!.备注}`
    const named = [...new Set([...cell.matchAll(/([A-Za-z0-9_-]+\.json)/g)].map((m) => m[1]))].sort()
    expect(named).toEqual(['bosses.json', 'enemies.json', 'movements.json', 'weapons.json'])
    const actual = readdirSync(new URL('src/data/json/', ROOT)).filter((f) => f.endsWith('.json')).sort()
    expect(actual.length).toBe(25)
    expect(named.filter((n) => !actual.includes(n))).toEqual(['bosses.json'])
    expect(actual.filter((n) => n === 'movesets.json')).toEqual(['movesets.json'])
    expect(registry.ids('moveset:').length).toBeGreaterThan(0)
  })
})

describe('KI-300 §17 第二行（命中框＝点-扇形解析式）', () => {
  it('外沿含等号、角度吃目标体积补偿、高度带两侧各差半高、贴身豁免只看高度', () => {
    const box = cone()
    const d = sweepDist(box)
    expect(d.lastHit).toBe(4.55)
    expect(d.firstMiss).toBe(4.555)
    expect(shapeHits(box, origin, 0, tgt({ x: 0, y: 0, z: 4.55 }))).toBe(true)
    const ang = (dist: number): number => 45 + (Math.atan2(0.55, Math.max(0.4, dist)) * 180) / Math.PI
    const at3 = lastHitAngle(box, 3)
    const at1 = lastHitAngle(box, 1)
    const at39 = lastHitAngle(box, 3.9)
    expect(at3).toBe(55.385)
    expect(at1).toBe(73.81)
    expect(at39).toBe(53.025)
    for (const [measured, dist] of [[at3, 3], [at1, 1], [at39, 3.9]] as const) {
      expect(Math.abs(measured - ang(dist)), `d=${dist} 的解析差`).toBeLessThan(0.005)
    }
    const y = sweepY(box, 3)
    expect(y.lo).toBe(-2.395)
    expect(y.hi).toBe(1.395)
    expect(shapeHits(box, origin, 0, tgt({ x: 0, y: -2.4, z: 3 }))).toBe(false)
    expect(shapeHits(box, origin, 0, tgt({ x: 0, y: 1.4, z: 3 }))).toBe(false)
    expect(shapeHits(box, origin, 0, tgt({ x: 0, y: 0, z: -0.3 }))).toBe(true)
    expect(shapeHits(box, origin, 0, tgt({ x: 0, y: 0, z: -0.799 }))).toBe(true)
    expect(shapeHits(box, origin, 0, tgt({ x: 0, y: 0, z: -0.85 }))).toBe(false)
  }, 30_000)

  it('三张表的形状名册 ⇄ 文档那一格的「扇形（角度 60-120°）」：cone 50 格里 13 格在带外，全在玩家侧', () => {
    const c = hitboxCensus()
    const band = R.get('命中框')!.方案.match(/角度 *(\d+)-(\d+)/)
    expect(band, `命中框那一格该写着「角度 N-M°」，读到=${R.get('命中框')!.方案}`).not.toBeNull()
    const lo = Number(band![1])
    const hi = Number(band![2])
    expect([lo, hi]).toEqual([60, 120])
    expect(c.enemies).toBe(10)
    expect(c.cone.length).toBe(50)
    const sideCount = (s: ConeRow['side']): number => c.cone.filter((r) => r.side === s).length
    expect({ moveset: sideCount('moveset'), enemy: sideCount('enemy'), movement: sideCount('movement') }).toEqual({
      moveset: 31,
      enemy: 19,
      movement: 0,
    })
    const out = c.cone.filter((r) => r.angleDeg < lo || r.angleDeg > hi)
    expect(out.length).toBe(13)
    expect(out.map((r) => `${r.carrier}=${r.angleDeg}`).sort()).toEqual([
      'moveset:ms_greatsword.l1=180',
      'moveset:ms_greatsword.l2=180',
      'moveset:ms_greatsword.l3=200',
      'moveset:ms_greatsword.run=160',
      'moveset:ms_needlesilence.l5=55',
      'moveset:ms_spear.h=30',
      'moveset:ms_spear.l1=40',
      'moveset:ms_spear.l2=40',
      'moveset:ms_spear.l3=45',
      'moveset:ms_spear.l4=45',
      'moveset:ms_spear.l5=45',
      'moveset:ms_spear.run=40',
      'moveset:ms_sword.run=45',
    ])
    expect(sideCount('moveset')).toBe(out.length + c.cone.filter((r) => r.side === 'moveset' && r.angleDeg >= lo && r.angleDeg <= hi).length)
    const uniq = (a: number[]): number[] => [...new Set(a)].sort((x, yy) => x - yy)
    expect(uniq(c.cone.map((r) => r.angleDeg))).toEqual([30, 40, 45, 55, 60, 70, 80, 90, 100, 110, 120, 160, 180, 200])
    expect(uniq(c.cone.map((r) => r.radius))).toEqual([1.6, 1.9, 2, 2.1, 2.2, 2.4, 2.6, 2.8, 3, 3.2, 3.3, 3.4, 3.5, 3.6, 4, 6])
    expect(uniq(c.cone.map((r) => r.height))).toEqual([1.2, 1.4, 1.5, 1.6, 1.7, 1.9, 2, 2.1, 2.2, 2.3, 2.4, 2.6])
    const sum = (shape: string): number =>
      Object.entries(c.shapes).filter(([k]) => k.endsWith(`:${shape}`)).reduce((a, [, v]) => a + v, 0)
    expect({ cone: sum('cone'), ring: sum('ring'), sphere: sum('sphere') }).toEqual({ cone: 50, ring: 15, sphere: 0 })
  })

  it('调音剑 L1 的扇形打得到的最远距离＝表那一格的半径加目标半径（读数 2.55 含 lunge 那一拍的一步）', () => {
    const w = makeWorld()
    const hb = registry.get<MovesetData>(`moveset:${w.weapon.movesetId}`).actions.l1!.hitbox as HitboxCone
    expect({ shape: hb.shape, angleDeg: hb.angleDeg, radius: hb.radius, height: hb.height, offsetY: hb.offsetY }).toEqual({
      shape: 'cone',
      angleDeg: 100,
      radius: 2.1,
      height: 1.6,
      offsetY: 0.9,
    })
    /** 在正前方 d 米钉一只怪，出 L1，读有没有命中（玩家位置每拍钉回原点，lunge 只走一步） */
    function hitAt(d: number, lateral = 0): boolean {
      const e = w.ai.spawn('en_murkshell', { x: lateral, y: 0, z: d }, 'probe')
      e.alertness = 0
      e.enter('idle')
      w.pins.push(() => {
        e.pos.x = lateral
        e.pos.z = d
        w.player.pos = { x: 0, y: 0, z: 0 }
        w.player.yaw = 0
        if (e.state !== 'idle') e.enter('idle')
      })
      w.hits.length = 0
      w.frame.edges.add('attackLight')
      w.tick(1)
      w.frame.edges.delete('attackLight')
      for (let i = 0; i < 160; i++) w.tick(1)
      const hit = w.hits.some((h) => h.victimId === e.id)
      w.pins.length = 0
      w.ai.despawn(e.id)
      return hit
    }
    /** 命中对距离单调 ⇒ 二分找边界（0.01m 分辨率） */
    const bisect = (lo: number, hi: number, f: (v: number) => boolean): number => {
      for (let i = 0; i < 11; i++) {
        const mid = Number(((lo + hi) / 2).toFixed(2))
        if (f(mid)) lo = mid
        else hi = mid
      }
      return Number(lo.toFixed(2))
    }
    const probe = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: 1 }, 'probe')
    const geo = probe.hitTarget()
    const scale = probe.data.body?.scale ?? 1
    w.ai.despawn(probe.id)
    expect({ radius: Number(geo.radius.toFixed(2)), height: Number(geo.height.toFixed(2)), scale }).toEqual({
      radius: 0.44,
      height: 1.28,
      scale: 0.8,
    })
    const reach = bisect(0.6, 6, (d) => hitAt(d))
    const lateral = bisect(0, 4, (x) => hitAt(1.6, x))
    expect(reach).toBe(2.55)
    expect(hitAt(2.57)).toBe(false)
    expect(lateral).toBe(1.98)
    expect(Number(Math.hypot(1.6, lateral).toFixed(3))).toBe(2.546)
    expect(hitAt(-0.3)).toBe(true)
    expect(hitAt(-1.0)).toBe(false)
    w.off()
  }, 120_000)
})

describe('KI-300 §17 第三行（BeatClock：谁在走这一拍）', () => {
  const snap = (x: ReturnType<RhythmClock['info']>) => ({ ...x, phase: Number(x.phase.toFixed(3)) })

  it('拍钟不自走：唯一的喂口喂的是逻辑定步长，RhythmClock 里既无 currentTime 也不碰音频上下文——文档那一格说 WebAudio 驱动（登记：偏差在文档侧）', () => {
    const r = new RhythmClock()
    r.setBpm(84, 4)
    expect(snap(r.info())).toEqual({ beatIndex: 0, beatInBar: 1, bar: 0, isBarStart: true, phase: 0 })
    for (let i = 0; i < 60; i++) r.update(TICK_DT)
    expect(snap(r.info())).toEqual({ beatIndex: 1, beatInBar: 2, bar: 0, isBarStart: false, phase: 0.4 })
    const idleRead = JSON.stringify(snap(r.info()))
    expect(idleRead).toBe(JSON.stringify({ beatIndex: 1, beatInBar: 2, bar: 0, isBarStart: false, phase: 0.4 }))
    r.update(1.0)
    expect(snap(r.info())).toEqual({ beatIndex: 2, beatInBar: 3, bar: 0, isBarStart: false, phase: 0.8 })
    const clockSrc = readFileSync(new URL('src/core/RhythmClock.ts', ROOT), 'utf8')
    expect([
      clockSrc.includes('currentTime'),
      clockSrc.includes('performance.now'),
      clockSrc.includes('AudioContext'),
      clockSrc.includes('audioCtx'),
    ]).toEqual([false, false, false, false])
    const sites = srcFiles()
      .flatMap((f) => [...f.text.matchAll(/rhythm\.update\(([^)]*)\)/g)].map((m) => `${f.path}(${m[1]})`))
      .sort()
    expect(sites).toEqual(['src/main.ts(TICK_DT)'])
    expect(R.get('BeatClock')!.方案).toContain('currentTime')
    expect(R.get('BeatClock')!.备注).toContain('权威时钟')
  })

  it('「渲染层仅插值」只对一半：alpha 算得出来，但 ActorVisuals 没有 render 口，逻辑态不动时位置逐字节相同', () => {
    const time = new GameTime()
    const input = { poll() {}, endTick() {}, frame: { edges: new Set<string>() } } as unknown as Input
    const alphas: number[] = []
    const loop = new GameLoop(time, input, (alpha) => alphas.push(Number(alpha.toFixed(6))))
    loop.tickFrame(TICK_DT * 2.5)
    loop.tickFrame(TICK_DT)
    expect({ alphas, tick: time.tick }).toEqual({ alphas: [0.5, 0.5], tick: 3 })
    const w = makeWorld()
    const scene = new THREE.Scene()
    const playerMesh = new THREE.Group()
    const vis = new ActorVisuals(scene, playerMesh, w.player)
    w.ai.spawn('en_murkshell', { x: 1.25, y: 0, z: -3.5 }, 'probe')
    vis.sync(w.ai.enemies, w.time.tick)
    const groups = scene.children.filter((c) => c !== playerMesh)
    const p0 = JSON.stringify(groups.map((g) => ({ ...g.position })))
    w.time.step(TICK_DT * 17)
    vis.sync(w.ai.enemies, w.time.tick)
    const p1 = JSON.stringify(groups.map((g) => ({ ...g.position })))
    expect(p1).toBe(p0)
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(vis)).sort()
    expect(surface).toEqual(['animateSword', 'constructor', 'showForm', 'sync', 'updateEnemy'])
    expect(srcFiles().filter((f) => /\brender\s*\(alpha/.test(f.text)).map((f) => f.path)).toEqual(['src/main.ts'])
    expect(R.get('BeatClock')!.方案).toContain('仅插值')
    w.off()
  })
})

describe('KI-300 §17 第四行（AI tick）', () => {
  it('感知每 6 拍一次＝10Hz，但那不是「轮转」——同一拍里 32 只一起被感知，没有一只在别拍被单独感知', () => {
    const per = perTickVisits(32, 13, 'sense')
    expect(per).toEqual([0, 0, 0, 0, 0, 32, 0, 0, 0, 0, 0, 32, 0])
    expect(TICK_HZ / 6).toBe(10)
    expect(per.filter((v) => v !== 0 && v !== 32)).toEqual([])
    expect(R.get('AI tick')!.方案).toContain('10Hz')
    expect(R.get('AI tick')!.方案).toContain('轮转')
  })

  it('状态机每拍推进一格＝60Hz，而文档那一格写的是 30Hz（登记：偏差在文档侧）', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: 8 }, 'probe')
    e.enter('combat')
    e.alertness = 40
    w.pins.push(() => {
      e.pos.x = 0
      e.pos.z = 8
      e.yaw = Math.PI
      w.player.pos = { x: 0, y: 0, z: 14 }
      e.alertness = 40
    })
    const deltas: number[] = []
    const states: string[] = []
    for (let i = 0; i < 14; i++) {
      const s0 = e.stateTick
      w.tick(1)
      deltas.push(e.stateTick - s0)
      states.push(e.state)
    }
    expect([...new Set(states)]).toEqual(['combat'])
    expect(deltas).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])
    expect(TICK_HZ).toBe(60)
    expect(R.get('AI tick')!.方案).toContain('30Hz')
    w.off()
  })

  it('一拍里 32 只全部被推进（备注那半句「与渲染解耦定步长」成立）；「<2ms/帧」那一格只能报读数，不能进断言', () => {
    const per = perTickVisits(32, 6, 'update')
    expect(per).toEqual([32, 32, 32, 32, 32, 32])
    const w = makeWorld()
    for (let i = 0; i < 32; i++) {
      w.ai.spawn('en_murkshell', { x: (i % 8) * 1.5 - 5.25, y: 0, z: 4 + Math.floor(i / 8) * 1.5 }, 'probe')
    }
    const ms: number[] = []
    for (let i = 0; i < 120; i++) {
      const t0 = performance.now()
      w.ai.update(TICK_DT, w.time.tick + i, w.player, w.rhythm)
      ms.push(performance.now() - t0)
    }
    const sorted = [...ms].sort((a, b) => a - b)
    const mean = ms.reduce((a, b) => a + b, 0) / ms.length
    const median = (sorted[59] + sorted[60]) / 2
    console.log(
      `（诊断，非断言）ai.update 本机本次 32 只／120 拍：平均 ${mean.toFixed(4)}ms／中位 ${median.toFixed(4)}／最大 ${sorted[119].toFixed(4)}——` +
        `文档那一格「AI 预算 <2ms/帧」没有机器无关的承载体：同一份码换一趟就换一个数，写进断言只会变成旋转红`,
    )
    expect(R.get('AI tick')!.备注).toContain('定步长')
    expect(R.get('AI tick')!.方案).toContain('32 实体')
    w.off()
  })
})

describe('KI-300 §17 第五行（调试器）', () => {
  it('开发期按键名册：src 里按得出的是 F1／F2／F3／F4／F6，F9 一次也没有（登记：偏差在文档侧）', () => {
    const files = srcFiles()
    const roster = [...new Set(files.flatMap((f) => [...f.text.matchAll(/\bF([0-9])\b/g)].map((m) => `F${m[1]}`)))].sort()
    /* KI-315 之前这一格钉的是四把键。F6（hitbox 线框的呼出键）落地后名册伸长一格是**预期内的红**：
       这条腿读的是"src 里真按得出的键"，它不许变成第二把键的主人——所以名字由扫描现推，改码就改名册。 */
    expect(roster).toEqual(['F1', 'F2', 'F3', 'F4', 'F6'])
    expect(files.reduce((a, f) => a + (f.text.match(/F9/g) ?? []).length, 0)).toBe(0)
    expect(files.filter((f) => f.text.includes("e.key !== 'F2'")).map((f) => f.path)).toEqual(['src/tools/CombatDebugger.ts'])
    expect(files.filter((f) => /key: 'F1' \| 'F3' \| 'F4'/.test(f.text)).map((f) => f.path)).toEqual(['src/tools/DebugPanel.ts'])
    expect(R.get('调试器')!.备注).toContain('F9')
  })

  it('那一格列的四格展示：S/A/R 帧、体力/架势、拍点刻度尺都在 src/tools 里有承载体，hitbox 线框由 KI-315 补上第三个家的承载体', () => {
    const tools = srcFiles('src/tools')
    expect(tools.map((f) => f.path).sort()).toEqual([
      'src/tools/AIDebugger.ts',
      'src/tools/CombatDebugger.ts',
      'src/tools/DebugPanel.ts',
      'src/tools/EnemyDebugger.ts',
      'src/tools/QuestDebugger.ts',
    ])
    const carrier = (re: RegExp): string[] => tools.filter((f) => re.test(f.text)).map((f) => f.path).sort()
    expect({ startup: carrier(/startup/), recovery: carrier(/recovery/) }).toEqual({
      startup: ['src/tools/AIDebugger.ts', 'src/tools/EnemyDebugger.ts'],
      recovery: ['src/tools/AIDebugger.ts', 'src/tools/EnemyDebugger.ts'],
    })
    expect(carrier(/stamina/)).toEqual(['src/tools/CombatDebugger.ts'])
    expect(carrier(/poise/)).toEqual(['src/tools/CombatDebugger.ts', 'src/tools/EnemyDebugger.ts'])
    expect(carrier(/beatInBar/)).toEqual(['src/tools/AIDebugger.ts', 'src/tools/CombatDebugger.ts'])
    expect(carrier(/│/)).toEqual(['src/tools/CombatDebugger.ts'])
    /* 六种拼法的读数（KI-300 落笔时全是 0）里只有 `LineSegments` 变成 1——那一个是**画线框的那个类自己**：
       线框是三维的，不住在 `src/tools`（那五格是文本面板）而住在 `src/world`。其余五格仍是 0，
       它们那五种拼法本来就不该出现（Three.js 里画线段没有 `wireframe` 材质开关、也没有 `BoxHelper` 那条捷径）。 */
    const spellings = ['wireframe', 'BoxHelper', 'LineSegments', 'debugDraw', 'drawHitbox', 'hitboxWire']
    const read = (s: string): string[] => srcFiles().filter((f) => f.text.includes(s)).map((f) => f.path).sort()
    const readRe = (re: RegExp): string[] => srcFiles().filter((f) => re.test(f.text)).map((f) => f.path).sort()
    expect(
      spellings.map((s) => `${s}:${read(s).length}`),
    ).toEqual(['wireframe:0', 'BoxHelper:0', 'LineSegments:1', 'debugDraw:0', 'drawHitbox:0', 'hitboxWire:0'])
    expect(read('LineSegments'), '那一格读数必须落在承载体上，不是落在散文里').toEqual(['src/world/HitboxWire.ts'])
    expect(readRe(/new THREE\.LineSegments\(/), '承载体必须真的构造线段对象，光提名字不算').toEqual(['src/world/HitboxWire.ts'])
    const cell = R.get('调试器')!.方案
    for (const claim of ['S/A/R', 'hitbox 线框', '体力/架势', '拍点刻度尺']) expect(cell, `那一格该列「${claim}」`).toContain(claim)
  })
})
