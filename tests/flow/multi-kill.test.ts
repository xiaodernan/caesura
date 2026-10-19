import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bus } from '@/core/EventBus'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import { registerGameData, playerBase } from '@/data'
import type { EnemyData, LootTableData, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { KillSettlement } from '@/rpg/Settlement'
import { RpgRuntime } from '@/rpg/Runtime'

/**
 * Phase 10 测试矩阵的「多敌同帧死亡」一格（需求 §72）：
 * 同一 tick 里多个敌人被打死（AOE/范围结算的正常结果），死亡账要**各到各的**——
 * 每个敌人各发一次 entity.died、各走一遍击杀结算；而**同一个**敌人同帧被两笔伤害
 * 致死（近战+弹体是真实战况）只许结算一次（CombatManager.killed 那道门）。
 * 全部 headless：伤害入口用公开的 `strikeEnemy`（base 压成必杀），不借 hitbox 几何。
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
  // strikeEnemy 是组合根内部接线（私有）：矩阵项关心的是死亡账，不重画 hitbox，从私有入口打
  const strike = (combat as unknown as { strikeEnemy: (e: unknown, s: unknown, t: number) => number }).strikeEnemy.bind(combat)
  return { time, rhythm, player, ai, combat, tick, strike }
}

/** 一记必杀的直击（base 拉满，绕开数值表——这里关心的是死亡账，不是伤害数值）。形状对齐 CombatManager 内部的 EnemyStrike */
function lethalStrike(at: { x: number; y: number; z: number }) {
  return {
    base: 999999, poise: 0, hitStopMs: 0, kind: 'light', layers: 0,
    mute: false, backstab: false, onBeat: false, ranged: false, pinTicks: 0,
    point: at, dir: { x: 0, y: 0, z: 1 }, shakeKey: 'shake_light'
  }
}

describe('多敌同帧死亡（Phase 10 矩阵：§72）', () => {
  it('同帧两敌双杀：两份死亡账各到各的（entity.died ×2，id 不同、各一次结算播报）', () => {
    const w = makeWorld()
    const eA = w.ai.spawn('en_murkshell', { x: 2, y: 0, z: -6 }, 'multikill')
    const eB = w.ai.spawn('en_murkshell', { x: -2, y: 0, z: -6 }, 'multikill')
    const died: Array<{ id: string; dataId?: string }> = []
    let shatter = 0
    bus.on('entity.died', (p) => { died.push({ id: p.id, dataId: p.dataId }) })
    bus.on('vfx.request', (p) => { if (p.key === 'death_shatter') shatter++ })
    const notify: string[] = []
    bus.on('ui.notify', (p) => { notify.push(p.text) })

    w.tick()
    const tick0 = w.time.tick
    w.strike(eA, lethalStrike(eA.pos), tick0)
    w.strike(eB, lethalStrike(eB.pos), tick0)

    expect(eA.alive).toBe(false)
    expect(eB.alive).toBe(false)
    expect(died.map((d) => d.id).sort()).toEqual([eA.id, eB.id].sort())
    expect(died.every((d) => d.dataId === 'en_murkshell')).toBe(true)
    expect(shatter, '每个死者各自一次碎裂特效，一个都不许被吞').toBe(2)
    expect(notify.filter((t) => t.includes('崩解')).length, '每个死者各自一条崩解播报').toBe(2)
  })

  it('同一敌同帧被两笔伤害致死：killed 门只结算一次（died ×1）', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', { x: 0, y: 0, z: -6 }, 'multikill')
    let died = 0
    bus.on('entity.died', () => { died++ })
    let shatter = 0
    bus.on('vfx.request', (p) => { if (p.key === 'death_shatter') shatter++ })

    w.tick()
    const tick0 = w.time.tick
    w.strike(e, lethalStrike(e.pos), tick0)
    w.strike(e, lethalStrike(e.pos), tick0) // 近战+弹体同帧：第二笔打在尸体上

    expect(e.alive).toBe(false)
    expect(died, '同一敌人的死亡只许播报一次（重复致死不重播账目）').toBe(1)
    expect(shatter).toBe(1)
  })

  it('结算层同帧两个死亡事件：KillSettlement 各结算一份 XP，不吞不重', () => {
    registerGameData()
    let refresh = 0
    const checkpoints: string[] = []
    const rpgStub = {
      prog: {
        rank: 1,
        milestoneAt: (_r: number) => null,
      },
      onEnemyKilled: () => [{ type: 'xp' as const, count: 10 }],
    }
    const s = new KillSettlement({
      rpg: rpgStub as never,
      refresh: () => { refresh++ },
      checkpoint: (k: string) => { checkpoints.push(k) },
    } as never)
    try {
      bus.emit('entity.died', { id: 'a', kind: 'enemy', dataId: 'en_murkshell', position: { x: 0, y: 0, z: 0 } })
      bus.emit('entity.died', { id: 'b', kind: 'enemy', dataId: 'en_murkshell', position: { x: 2, y: 0, z: 0 } })
      expect(refresh, '两个死者各刷一次面板').toBe(2)
      expect(checkpoints, '没升级就没有 levelup 检查点').toEqual([])
    } finally {
      s.dispose()
    }
  })

  it('同帧双杀触发两档独立升级判定：第一个事件升级后，第二个事件以新 rank 为基准', () => {
    registerGameData()
    const checkpoints: string[] = []
    let rank = 1
    const rpgStub = {
      prog: {
        get rank() { return rank },
        milestoneAt: (r: number) => `里程碑 ${r}`,
      },
      onEnemyKilled: () => { rank++; return [{ type: 'xp' as const, count: 10 }] },
    }
    const s = new KillSettlement({
      rpg: rpgStub as never,
      refresh: () => {},
      checkpoint: (k: string) => { checkpoints.push(k) },
    } as never)
    try {
      bus.emit('entity.died', { id: 'a', kind: 'enemy', dataId: 'en_murkshell', position: { x: 0, y: 0, z: 0 } })
      bus.emit('entity.died', { id: 'b', kind: 'enemy', dataId: 'en_murkshell', position: { x: 2, y: 0, z: 0 } })
      expect(rank).toBe(3)
      expect(checkpoints, '两次升级各落一次 levelup 检查点').toEqual(['levelup', 'levelup'])
    } finally {
      s.dispose()
    }
  })
})

/**
 * KI-116：一次击杀在屏上留下的**数字**。
 *
 * `CombatManager.onEnemyKilled` 从 Phase 1-B 起就自带一句 `遗响 +round(hpMax*0.3)`，那时遗响还没有
 * 主人；Phase 5-B 之后真数额由 `loot.json` 的 xp 掷骰决定、由 `KillSettlement` 播报（`2026-10-13` 实测：
 * 嘈壳报 14 实给 9，奥斯塔拉报 126 实给 400——10 种敌人里 9 种不符）。玩家每杀一发两行，其中一行是假的。
 * 修法不是把那个式子算得更准，而是**让数字只有一个主人**：崩解那一行只说谁倒了。
 */
describe('KI-116：遗响的数额只有一个主人，播报的数字必须是真的', () => {
  /** 真链路的世界：战斗层 + 成长层 + 结算层都接上（上面那几个用例故意不带 rpg，这里要带） */
  function realWorld() {
    registerGameData()
    const time = new GameTime()
    const rhythm = new RhythmClock()
    rhythm.setBpm(84, 4)
    const rpg = new RpgRuntime('origin_tuner')
    const weapon = registry.get<WeaponData>(rpg.mods().weaponId!)
    const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
    const player = new PlayerController(playerBase, weapon, moveset)
    player.applyRpg(rpg.mods())
    const ai = new AISystem()
    const combat = new CombatManager(player, ai, time, rhythm)
    const settle = new KillSettlement({ rpg, refresh: () => {}, checkpoint: () => {} } as never)
    const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
    const input = { frame, enabled: true } as unknown as Input
    player.camYawRef = 0
    const tick = (n = 1): void => {
      for (let i = 0; i < n; i++) {
        time.tick++
        player.update(TICK_DT, time, input, time.tick, rhythm)
        ai.update(TICK_DT, time.tick, player, rhythm)
        combat.update(time.tick, input)
        frame.edges.clear()
        rhythm.update(TICK_DT)
      }
    }
    const strike = (combat as unknown as { strikeEnemy: (e: unknown, s: unknown, t: number) => number }).strikeEnemy.bind(combat)
    return { time, rpg, ai, tick, strike, dispose: () => settle.dispose() }
  }

  /** 打死一只敌人，把它在屏上留下的每一行都带回来（`kind` 按事件的形状留着：改文案时别顺手改掉它的频道） */
  function killAndCapture(dataId: string): { notes: { kind: string | undefined; text: string }[]; xpDelta: number; rankBefore: number; rankAfter: number } {
    const w = realWorld()
    const notes: { kind: string | undefined; text: string }[] = []
    const off = bus.on('ui.notify', (p) => notes.push({ kind: p.kind, text: p.text }))
    const e = w.ai.spawn(dataId, { x: 0, y: 0, z: -6 }, 'ki116')
    w.tick()
    const xpBefore = w.rpg.prog.xp
    const rankBefore = w.rpg.prog.rank
    w.strike(e, lethalStrike(e.pos), w.time.tick)
    const out = { notes, xpDelta: w.rpg.prog.xp - xpBefore, rankBefore, rankAfter: w.rpg.prog.rank }
    off()
    w.dispose()
    return out
  }

  /** 该敌人掉落表里的遗响范围——范围从表现推，不抄 progression.md §9.1 那张表 */
  function xpRangeOf(dataId: string): [number, number] {
    const enemy = registry.get<EnemyData>(dataId)
    let lo = 0
    let hi = 0
    let found = 0
    for (const d of enemy.drops ?? []) {
      const table = registry.get<LootTableData>(d.tableId)
      for (const r of table.rolls) {
        if (!r.xp) continue
        found++
        lo += r.xp[0]
        hi += r.xp[1]
      }
    }
    expect(found, `${dataId} 的掉落表里一条遗响掷骰都没有 ⇒ 名册读空，不是没有数字可给`).toBeGreaterThan(0)
    return [lo, hi]
  }

  it('嘈壳一杀：只有一条遗响播报，且它报的就是成长系统真收下的那个数', () => {
    const { notes, xpDelta, rankBefore, rankAfter } = killAndCapture('en_murkshell')
    expect(rankAfter, `这一杀不该升级（升级会把额度吞进下一级，xp 差就不等于实发额了）`).toBe(rankBefore)
    const lines = notes.filter((n) => n.text.includes('遗响'))
    expect(lines.map((n) => n.text), '一场击杀只许一条遗响播报').toHaveLength(1)
    const announced = Number(/遗响 \+(\d+)/.exec(lines[0].text)![1])
    const [lo, hi] = xpRangeOf('en_murkshell')
    expect(announced, `播报 ${announced} 与真收下 ${xpDelta} 不符`).toBe(xpDelta)
    expect(announced).toBeGreaterThanOrEqual(lo)
    expect(announced).toBeLessThanOrEqual(hi)
  })

  it('崩解那一行不自带数字：它只说谁倒了（旧写法把 hpMax*0.3 冒充遗响）', () => {
    const { notes } = killAndCapture('en_murkshell')
    const shatter = notes.filter((n) => n.text.includes('崩解'))
    expect(shatter, '死亡那一行还是要有的——多杀计数靠它').toHaveLength(1)
    expect(shatter[0].text, `崩解行不许带数字：[${shatter[0].text}]`).not.toMatch(/\d/)
    expect(shatter[0].kind, '删掉数字不该顺手改掉这一行的频道（它还是结算那一支◆）').toBe('reward')
  })

  it('Boss 一杀：400 真数额只报一次，126 那笔凭空造的数从此不再上屏', () => {
    const { notes } = killAndCapture('en_ostlara')
    const [lo, hi] = xpRangeOf('en_ostlara')
    const lines = notes.filter((n) => /遗响 \+(\d+)/.test(n.text))
    expect(lines.map((n) => n.text), '一场击杀只许一条遗响播报').toHaveLength(1)
    const announced = Number(/遗响 \+(\d+)/.exec(lines[0].text)![1])
    expect(announced, 'Boss 的遗响走的是表定数额').toBeGreaterThanOrEqual(lo)
    expect(announced).toBeLessThanOrEqual(hi)
    expect(announced, '旧写法会报 round(hpMax*0.3)，它不等于任何一张表的数额').not.toBe(Math.round(420 * 0.3))
  })

  it('全 `src` 里发「遗响 +数字」的发射点恰好一处，且它住在结算层', () => {
    const SRC = fileURLToPath(new URL('../../src', import.meta.url))
    const files: string[] = []
    const walk = (dir: string, rel: string): void => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = `${dir}/${ent.name}`
        const r = rel ? `${rel}/${ent.name}` : ent.name
        if (ent.isDirectory()) walk(p, r)
        else if (ent.name.endsWith('.ts')) files.push(r)
      }
    }
    walk(SRC, '')
    expect(files.length, 'src 名册读空 ⇒ 这一条什么都没看').toBeGreaterThan(50)
    const hits: string[] = []
    const emitters = new Set<string>()
    for (const f of files) {
      const src = readFileSync(`${SRC}/${f}`, 'utf8')
      src.split(/\r?\n/).forEach((l, i) => {
        const t = l.trim()
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
        if (/遗响 \+\$\{/.test(t)) {
          hits.push(`src/${f}:${i + 1}`)
          emitters.add(`src/${f}`)
        }
      })
    }
    const where = hits.join(' | ') || '(没有)'
    // 钉身份不钉行号：行号会随 Settlement.ts 上下增删漂移，而这一条的断言是「谁在发这个数」
    expect([...emitters], `发遗响数额的手应当恰好一只，且它住在结算层，实得 ${where}`).toEqual(['src/rpg/Settlement.ts'])
    expect(hits.length, `一处发射点对应一行，多出来的行就是第二只写数字的手，实得 ${where}`).toBe(1)
  })
})