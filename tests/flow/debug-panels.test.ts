/**
 * §54 的运行时调试面板三格（KI-058）。
 *
 * 分三层，顺序也是这个文件的读法：
 * 1. **外壳**（`DebugPanel`）：DOM 用最小替身（与 `title-screen.test.ts` 同一手法）。要钉住的
 *    不是排版而是那条纪律——**关着的时候一个字符串都不生成**，否则三块面板每逻辑帧都在拼全场文本。
 *    真实视口里的字号、停靠、互相遮挡仍然测不了（KI-010：本机没有可见窗口），那一半记在 KI-058。
 * 2. **文本装配**（`enemyPanelText` / `questPanelText` / `aiPanelText`）：喂**真实例**（真 `Enemy`、
 *    真 `StreamingSystem`/`Interactables`/`WorldState`/`Quests`、真节拍），断言"面板上那行字"就是
 *    引擎里那个数——抄进面板的常量与自行拼的键格式都在这层被打出来。
 * 3. **口径**：插槽键与 `Enemy.tryAttack` 共用同一个主人；阶段白名单走的是 AI 自己那条
 *    `phaseActions`；走位动词的分辨与 `PSEUDO_ACTIONS` 在同一份表上给同一个答案。
 *
 * 一块面板最容易的两种假绿：把"字段存在"当成"读数正确"（所以每条都从实例改一笔再读回），
 * 以及"看一眼"把被看的系统改坏（所以 `armedSlots` 那条既测读到、也测没占坑）。
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { GameTime, TICK_DT } from '@/core/Time'
import type { Input } from '@/core/Input'
import { RhythmClock } from '@/core/RhythmClock'
import { registry } from '@/core/Registry'
import {
  registerGameData, playerBase, regions, worldstate, quests as questTable,
  worldStates as worldStateTable,
} from '@/data'
import type { EnemyData, MovesetData, WeaponData } from '@/data/schema'
import { PlayerController } from '@/player/ThirdPersonController'
import { AISystem } from '@/ai/AISystem'
import { CombatManager } from '@/combat/CombatManager'
import { attackSlotKey, newAttack } from '@/ai/Enemy'
import { StreamingSystem } from '@/world/Streaming'
import { Interactables } from '@/world/Interactables'
import { WorldState } from '@/quest/WorldState'
import { Quests } from '@/quest/Quests'
import { WorldStates } from '@/quest/WorldStates'
import { DebugPanel } from '@/tools/DebugPanel'
import { enemyPanelText, enemyRows } from '@/tools/EnemyDebugger'
import { questPanelText, questRows } from '@/tools/QuestDebugger'
import { aiPanelText, type AiDebugInput } from '@/tools/AIDebugger'

registerGameData()

/* ------------------------------------------------------------------ 外壳 */

class FakeEl {
  style: Record<string, string> = {}
  textContent = ''
  children: FakeEl[] = []
  parent: FakeEl | null = null
  removeCount = 0
  appendChild(c: FakeEl): FakeEl { c.parent = this; this.children.push(c); return c }
  remove(): void {
    this.removeCount++
    if (!this.parent) return
    this.parent.children = this.parent.children.filter((x) => x !== this)
    this.parent = null
  }
}

let body: FakeEl
let win: { handlers: Record<string, ((e: unknown) => void)[]> }

beforeAll(() => {
  body = new FakeEl()
  const g = globalThis as unknown as Record<string, unknown>
  // 只替 DebugPanel 真正碰到的那四件事：造节点、挂 body、读写法式、听按键。
  // 布局/字体/层叠一律不假造——那正是本机测不了的部分（KI-010）。
  g.document = { createElement: () => new FakeEl(), body }
  win = { handlers: {} }
  g.window = {
    addEventListener: (t: string, fn: (e: unknown) => void) => { (win.handlers[t] ??= []).push(fn) },
    removeEventListener: (t: string, fn: (e: unknown) => void) => {
      win.handlers[t] = (win.handlers[t] ?? []).filter((f) => f !== fn)
    },
  }
})

const press = (key: string): void => {
  for (const fn of win.handlers.keydown ?? []) fn({ key, preventDefault: () => {} })
}

/**
 * 挂了就得摘。本文件同时养着真 `bus` 订阅者（WorldState / Interactables / Quests / 面板按键），
 * 而任何一条断言失败都会让腿尾的 dispose 跑不到——实测：那条"谁立的旗"因此在下一格里读到
 * 上一具残留 WorldState 抢先写下的旗标，看着像产品 bug 其实是测试互相投毒。
 * 所以登记交给 `afterEach`，而不是写在每条腿的最后一行。
 */
const live: Array<() => void> = []
afterEach(() => { while (live.length) live.pop()!() })

const shell = (label = 'panel'): { p: DebugPanel; el: FakeEl; calls: { n: number } } => {
  const calls = { n: 0 }
  const p = new DebugPanel({
    key: 'F1', label, anchor: 'position:fixed;left:12px;top:300px',
    text: () => { calls.n++; return `payload-${calls.n}` },
  })
  live.push(() => p.dispose())
  return { p, el: (p as unknown as { el: FakeEl }).el, calls }
}

describe('面板外壳 DebugPanel · 默认全关', () => {
  it('没按键之前一个字符串都不生成（三块面板不能每帧各拼一遍全场）', () => {
    const { p, el, calls } = shell()
    expect(p.enabled).toBe(false)
    // 初始的隐藏是整条 cssText 一次写进去的（不是逐属性），所以读数也按那一串查
    expect(el.style.cssText).toContain('display:none')
    p.refresh(); p.refresh(); p.refresh()
    expect(calls.n).toBe(0)
  })

  it('F1 开：标题行是 `键 · 标签`，正文原样是回调的返回；再按关掉', () => {
    const { p, el, calls } = shell('enemies on the field')
    press('F1') // 按键自己就刷一次：开着的那一帧立刻有读数，不等下一 tick
    expect(p.enabled).toBe(true)
    expect(el.style.display).toBe('block')
    expect(el.textContent).toBe('F1 · enemies on the field\npayload-1')
    const before = calls.n
    press('F1')
    expect(p.enabled).toBe(false)
    expect(el.style.display).toBe('none')
    p.refresh()
    expect(calls.n, '关着还去拼文本 = 这条纪律只剩注释').toBe(before)
  })

  it('不归它管的键不拨动它（F2 是 CombatDebugger 的，早就有主人）', () => {
    const { p } = shell()
    press('F9')
    expect(p.enabled).toBe(false)
    press('F2')
    expect(p.enabled).toBe(false)
    press('F1')
    expect(p.enabled).toBe(true)
  })

  it('dispose 摘掉按键监听并把节点从 body 拿下（热重载不留三具面板在屏幕上）', () => {
    const { p, el } = shell()
    const before = body.children.length
    p.dispose()
    expect(el.removeCount).toBe(1)
    expect(el.parent).toBe(null)
    expect(body.children.length, '少掉的就是刚 dispose 的那一块').toBe(before - 1)
    press('F1')
    expect(p.enabled, 'dispose 之后 F1 不该还能拨它').toBe(false)
  })
})

/* ------------------------------------------------------- 真引擎与真读数 */

function makeWorld() {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(108, 4)
  const msOf = (w: WeaponData): MovesetData => registry.get<MovesetData>(`moveset:${w.movesetId}`)
  const sword = registry.get<WeaponData>('wp_tuning_sword')
  const player = new PlayerController(playerBase, sword, msOf(sword))
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = {
    move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>(),
  }
  const input = { frame, enabled: true } as unknown as Input
  player.camYawRef = 0

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
  return { time, rhythm, player, ai, combat, tick }
}
type W = ReturnType<typeof makeWorld>

/** F4 的网格读数从真 `RhythmClock` 取：手填数字等于把面板的拍与引擎的拍分开养 */
function gridOf(w: W): AiDebugInput['grid'] {
  const info = w.rhythm.info()
  return {
    owner: w.rhythm.clockOwner, bpm: w.rhythm.bpm, beatsPerBar: w.rhythm.beatsPerBar,
    bar: info.bar, beatInBar: info.beatInBar, tick: w.time.tick,
  }
}
const at = (x: number): { x: number; y: number; z: number } => ({ x, y: 0, z: 0 })
/** 面板里的数字一律 `padStart(4)`（等宽对齐），所以断言用 \s* 而不是把空格数写死第二遍 */
const num = (v: number): string => String(v).replace(/([.()\[\]])/g, '\\$1')

describe('F1 · 敌人面板读数', () => {
  it('场上没有敌人时说的是"没有"，不是空白一块', () => {
    const w = makeWorld()
    expect(enemyPanelText(w.ai.enemies, w.player.pos)).toBe('no enemies on the field')
  })

  it('表头报条数与状态分布；行里报的是**实例**当前值而不是表里的满值', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', at(0), 'f1')
    e.stats.hp -= 30
    e.stats.poiseAccum = 12
    e.alertness = 77
    const text = enemyPanelText(w.ai.enemies, at(0))
    expect(text.split('\n')[0]).toBe('live 1 · idle 1')
    const row = text.split('\n')[2]
    expect(row).toContain(e.id)
    expect(row).toContain('basic')
    expect(row).toMatch(new RegExp(`hp\\s+${num(e.stats.hp)}\\/\\s+${num(e.stats.hpMax)}`))
    expect(e.stats.hp, '这只怪确实掉了 30 血（否则上一条断言在比一个空读数）').toBe(e.stats.hpMax - 30)
    expect(row).toMatch(new RegExp(`poi\\s+12\\/\\s+${num(e.stats.poiseMax)}`))
    expect(row).toMatch(/al\s+77/)
    expect(row).toMatch(/d\s+0\.00/)
    expect(row, '没出手就不该有招式名').toContain('—')
  })

  it('两只在场时状态分布分别计数（面板的表头就是全场概览的唯一入口）', () => {
    const w = makeWorld()
    const a = w.ai.spawn('en_murkshell', at(0), 'f1')
    w.ai.spawn('en_tympanus', at(9), 'f1')
    a.enter('alert')
    expect(enemyPanelText(w.ai.enemies, at(0)).split('\n')[0]).toBe('live 2 · alert 1 · idle 1')
  })

  it('距离尺子读的是水平距离：玩家挪 7.5m，面板就报 7.50', () => {
    const w = makeWorld()
    w.ai.spawn('en_murkshell', at(0), 'f1')
    w.player.pos.x = 7.5
    expect(enemyRows(w.ai.enemies, w.player.pos)[0].dist).toBeCloseTo(7.5, 6)
    expect(enemyPanelText(w.ai.enemies, w.player.pos)).toMatch(/d\s+7\.50/)
  })

  it('出手那一式打印 `当前帧/前摇-窗起-窗止/收势`，四个数全从招式表来', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', at(0), 'f1')
    const spec = e.data.attacks[0]
    const f = spec.frames
    e.attack = newAttack(spec, 7)
    expect(enemyRows(w.ai.enemies, w.player.pos)[0].frame)
      .toBe(`7/${f.startup}-${f.activeStart}-${f.activeEnd}/${f.recovery}`)
    expect(enemyPanelText(w.ai.enemies, w.player.pos)).toContain(`${spec.id} f7/`)
    e.attack = null
    expect(enemyRows(w.ai.enemies, w.player.pos)[0].frame, '收招之后不许留着旧帧号').toBe('')
  })

  it('四条"时间被拿走"的账分开列（硬直/命中停顿/时停/聋），没占就一个都不出现', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', at(0), 'f1')
    expect(enemyRows(w.ai.enemies, w.player.pos)[0].held).toBe('')
    e.stunTicks = 11
    e.stunStopTicks = 3
    e.frozenTicks = 9
    e.applyDeaf(21)
    expect(enemyRows(w.ai.enemies, w.player.pos)[0].held).toBe('stun 11 stop 3 frozen 9 deaf 21')
  })

  it('标签列摊开阶段/钟壳/裂纹/定调，并且钟壳跟着**阶段数据**走而不是跟着面板的猜测', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_ostlara', at(0), 'f1')
    e.stats.fissureLayers = 2
    e.buff = { attackSpeedMul: 1, dmgMul: 1.2, fromId: 'en_refrein' }
    const p1 = enemyRows(w.ai.enemies, w.player.pos)[0].tags
    expect(p1).toContain('P1')
    expect(p1, 'P1 的钟壳是 §15.1 的机关前提，面板看不见就等于白测').toContain('shell')
    expect(p1).toContain('fis2')
    expect(p1).toContain('tune x1.2')
    expect(p1, '没碎甲不许写 armor-break').not.toContain('armor-break')
    e.bossPhase = 1
    e.armorBroken = true
    const p2 = enemyRows(w.ai.enemies, w.player.pos)[0].tags
    expect(p2).toContain('P2')
    expect(p2, 'P2 表里没有 shell ⇒ 面板不许还写着壳').not.toContain('shell')
    expect(p2).toContain('armor-break')
  })
})

describe('F4 · AI 决策路径读数', () => {
  it('没有目标时报"没有"，不去猜最近的是谁', () => {
    const w = makeWorld()
    expect(aiPanelText({ target: null, player: w.player.pos, grid: gridOf(w), armedSlots: [] }))
      .toBe('no enemy on the field')
  })

  it('选招行给当前距离带的名单；走位动词留在带里但不进冷却清单', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_refrein', at(4), 'f4') // 0-99m: [hold, noise]
    const text = aiPanelText({ target: e, player: w.player.pos, grid: gridOf(w), armedSlots: [] })
    expect(text).toMatch(/pick\s+band 0-99m -> \[hold noise\]/)
    expect(text).toMatch(/cooldowns\s+noise:ready/)
    expect(text, 'hold 是脚步不是招式：列进冷却清单就是给了一个打不出来的承诺').not.toMatch(/cooldowns[^\n]*hold/)
  })

  it('距离带里没有招式时明说 none，而不是空着一行', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_murkshell', at(0), 'f4') // 1.9-99m 只有 chase
    w.player.pos.x = 50
    const text = aiPanelText({ target: e, player: w.player.pos, grid: gridOf(w), armedSlots: [] })
    expect(text).toMatch(/pick\s+band 1\.9-99m -> \[chase\]/)
    expect(text).toMatch(/cooldowns\s+\(none usable\)/)
    w.player.pos.x = 400 // 带表的最大值 99m 之外：连"带"都没有，面板不许挑一个近的去印
    expect(aiPanelText({ target: e, player: w.player.pos, grid: gridOf(w), armedSlots: [] }))
      .toMatch(/pick\s+band none -> \[\]/)
  })

  it('Boss 的阶段白名单单独一行：表里的带与这一阶她会的东西不是一回事', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_hersil', at(5), 'f4') // 带 0-12m 有 6 项，各阶只允许其中一部分
    // 名单顺序跟**带**走（`phaseActions` 是在带的名单上做减法），不是跟阶段的写法走
    e.bossPhase = 0
    expect(aiPanelText({ target: e, player: w.player.pos, grid: gridOf(w), armedSlots: [] }))
      .toMatch(/phase-only \[barsweep tutti notes3\]/)
    e.bossPhase = 2
    const p3 = aiPanelText({ target: e, player: w.player.pos, grid: gridOf(w), armedSlots: [] })
    expect(p3).toMatch(/phase-only \[tutti noBeatLunge voiceChain\]/)
    expect(p3, '换阶之后还印上一阶的名单 = 面板在教玩家背错的谱').not.toMatch(/phase-only \[[^\]]*barsweep/)
    const plain = w.ai.spawn('en_murkshell', at(1), 'f4') // 没有阶段的普通敌人：那一行整个不该出现
    expect(aiPanelText({ target: plain, player: w.player.pos, grid: gridOf(w), armedSlots: [] }))
      .not.toContain('phase-only')
  })

  it('冷却读数吃实例上那份账：压 100 tick 就报剩 100t，过期就报 ready', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_refrein', at(4), 'f4')
    const g = gridOf(w)
    e.cooldowns.set('noise', g.tick + 100)
    expect(aiPanelText({ target: e, player: w.player.pos, grid: g, armedSlots: [] })).toMatch(/noise:100t/)
    e.cooldowns.set('noise', g.tick - 1)
    expect(aiPanelText({ target: e, player: w.player.pos, grid: g, armedSlots: [] })).toMatch(/noise:ready/)
  })

  it('插槽行印的键就是 tryAttack 领用的那个串（格式只有一个主人，两种拼法必红）', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_refrein', at(4), 'f4') // noise 的 beat 是 [1,3]
    const g = gridOf(w)
    const text = aiPanelText({ target: e, player: w.player.pos, grid: g, armedSlots: [] })
    const key = attackSlotKey(g.bar, g.beatInBar, 1)
    expect(text, '插槽行必须原样印出 attackSlotKey 的拼法（面板自己拼一遍就是第二个主人）').toContain(`want ${key}`)
    expect(key.split(':').length, '键是 bar:beatInBar:招式拍，三段').toBe(3)
    w.ai.slotTaken(key)
    const after = aiPanelText({ target: e, player: w.player.pos, grid: g, armedSlots: w.ai.armedSlots })
    expect(after, '领用方写的键，读数方必须原样印出来').toContain(`[${key}]`)
  })

  it('面板只**读**名册：连刷五次不占掉任何一拍（观测不改变被观测的系统）', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_ostlara', at(3), 'f4')
    const g = gridOf(w)
    for (let i = 0; i < 5; i++) {
      aiPanelText({ target: e, player: w.player.pos, grid: g, armedSlots: w.ai.armedSlots })
    }
    expect(w.ai.armedSlots.length, '面板自己往 slotArmed 里塞东西 = 看一眼吃掉 Boss 一招').toBe(0)
    const fresh = attackSlotKey(g.bar, g.beatInBar, 1)
    expect(w.ai.slotTaken(fresh), '看过之后这一拍还必须能被真的领用').toBe(false)
    expect(w.ai.slotTaken(fresh)).toBe(true)
  })

  it('私有拍如实上报：交战 Boss 接管网格，P2 的夺拍减益与玩家抢回拍都读得出来', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_hersil', at(5), 'f4')
    e.alertness = 100
    e.enter('combat')
    w.tick(2)
    const g = gridOf(w)
    expect(g.owner, '这条前提不成立的话下面都在测一个假场景').toBe('boss')
    const text = aiPanelText({ target: e, player: w.player.pos, grid: g, armedSlots: [] })
    expect(text).toMatch(/grid\s+boss \d+bpm/)
    expect(text).toMatch(/boss\s+phase 1/)
    expect(text, 'P1 没有 stealBeat 就不许印夺拍读数').not.toContain('stealBeat')
    e.bossPhase = 1
    e.stealNeutralTicks = 40
    const p2 = aiPanelText({ target: e, player: w.player.pos, grid: g, armedSlots: [] })
    expect(p2).toMatch(/boss\s+phase 2/)
    expect(p2).toContain('stealBeat')
    expect(p2, '玩家抢回拍期间减益是关掉的——面板要能看出这一点').toContain('neutral 40t')
  })

  it('走位动词的分辨与 AI 自己的判据在同一份表上给同一个答案', () => {
    const pseudo = new Set(['chase', 'backstep', 'hold'])
    let bands = 0
    for (const id of registry.ids('en_')) {
      const d = registry.get<EnemyData>(id)
      for (const b of d.ai.distBands ?? []) {
        bands++
        const byName = b.actions.filter((x) => !pseudo.has(x)).sort()
        const byTable = b.actions.filter((x) => d.attacks.some((a) => a.id === x)).sort()
        expect(byTable, `${id} ${b.min}-${b.max}m`).toEqual(byName)
      }
    }
    expect(bands, '一条距离带都没扫到 = 这条判据变成了空测试').toBeGreaterThan(15)
  })
})

describe('F3 · 任务与世界读数（只读）', () => {
  function makeQuestWorld() {
    const streaming = new StreamingSystem(regions)
    const interact = new Interactables(regions, () => true)
    const worldState = new WorldState(worldstate, {
      hasFlag: (k) => streaming.hasFlag(k),
      setFlag: (k) => streaming.setFlag(k),
    })
    const quests = new Quests(questTable)
    const worldStates = new WorldStates(worldStateTable)
    const render = (): string => questPanelText(questRows(questTable, quests), {
      flags: streaming.flagKeys(),
      byRules: worldState.flagsWritten,
      used: interact.snapshot(),
      relations: quests.snapshot().relations,
      states: worldStates.snapshot(),
    })
    const rowOf = (id: string): string => {
      const line = render().split('\n').find((l) => l.startsWith(id))
      expect(line, `任务行 ${id} 不见了`).toBeTruthy()
      return line as string
    }
    /** 按表里 `advanceOn` 的顺序立旗走到第 index 步：走的是**引擎那条路**，不是直接调 advance */
    const walkTo = (id: string, index: number): void => {
      const q = questTable.find((x) => x.id === id)!
      quests.start(id)
      for (let i = 0; i < index; i++) {
        const flag = q.steps[i].advanceOn?.flags?.[0]
        if (!flag) return
        streaming.setFlag(flag)
      }
    }
    const dispose = (): void => { quests.dispose(); worldState.dispose(); interact.dispose(); streaming.dispose(); worldStates.dispose() }
    live.push(dispose)
    return { streaming, interact, worldState, worldStates, quests, render, rowOf, walkTo, dispose }
  }

  it('一条线都没开时五行都在，每行写着"没开始"而不是"第 0 步"', () => {
    const w = makeQuestWorld()
    const text = w.render()
    for (const q of questTable) expect(text).toContain(q.id)
    expect(text.match(/\(not started\)/g)?.length).toBe(questTable.length)
    expect(text).toContain('— quests —')
    expect(text).toContain('flags (none)')
    expect(text).toContain('used interactables (none)')
    expect(text).not.toMatch(/relations:/)
    w.dispose()
  })

  it('开线之后行里是**表里那一步的 state 串**和它在等的旗标', () => {
    const w = makeQuestWorld()
    w.quests.start('q_bells')
    const row = w.rowOf('q_bells')
    expect(row).toContain('1/8')
    expect(row).toContain('BELLS.STEP1_OPEN')
    expect(row).toContain('next: flag.bell_tongue_examined')
    expect(row, '没到末步不许打 [done]').not.toContain('[done]')
    w.dispose()
  })

  it('旗标一路顺推，面板跟着走；末步的旗一立才打勾（停在末步 ≠ 收束）', () => {
    const w = makeQuestWorld()
    const q = questTable.find((x) => x.id === 'q_bells')!
    w.walkTo('q_bells', 7)
    const row = w.rowOf('q_bells')
    expect(row).toContain('8/8')
    expect(row).toContain('BELLS.STEP4_DECIDE')
    expect(row, '末步正在进行 ≠ 已收束').not.toContain('[done]')
    // 末步上一步那面旗已经立着，却命不中的就是这一步：末步的 advanceOn 里只有**值域**，没有旗标
    expect(q.steps[7].advanceOn?.flags, '末步不该再挂旗标').toBeUndefined()
    expect(q.steps[7].advanceOn?.state?.key).toBe('state.bells.fourth_dumb')
    w.worldStates.set('state.bells.fourth_dumb', 'RUNG')
    expect(w.rowOf('q_bells')).toContain('[done]')
    w.dispose()
  })

  it('末步没有 advanceOn 的那几条线永远不打勾（后续步还没写，不是做完了）', () => {
    const w = makeQuestWorld()
    w.walkTo('q_haltrune', 1)
    const row = w.rowOf('q_haltrune')
    expect(row).toContain('2/2')
    expect(row).toContain('HALTRUNE.STEP2_ROSTER')
    expect(row).toContain('(no advanceOn)')
    expect(row).not.toContain('[done]')
    w.dispose()
  })

  it('世界段分得清"谁立的旗"：交互物自己写的与 worldstate 规则写的', () => {
    const w = makeQuestWorld()
    const bell = w.interact.get('bl_fellcarillon_fallenbell')!
    w.interact.use(bell.id, bell.pos)
    const text = w.render()
    expect(text).toContain('flag.bell_toll_rung') // 交互物 setsFlag 那条
    expect(text).toContain('flag.bell_interior_open') // 规则表 respond 那条
    expect(text).toMatch(/by worldstate rules: flag\.bell_interior_open\b/)
    expect(text, 'setsFlag 直写的不算规则写的').not.toMatch(/by worldstate rules:[^\n]*bell_toll_rung/)
    expect(text).toContain(`used interactables 1: ${bell.id}`)
    w.dispose()
  })

  it('关系值只报非零那几格，正负号跟着（零不是关系）', () => {
    const w = makeQuestWorld()
    w.quests.addRelation('npc_corvin', 2)
    w.quests.addRelation('npc_belltongue', -1)
    w.quests.addRelation('npc_faceless', 0)
    const line = w.render().split('\n').find((l) => l.startsWith('relations:'))!
    expect(line).toContain('npc_corvin +2')
    expect(line).toContain('npc_belltongue -1')
    expect(line).not.toContain('npc_faceless')
    w.dispose()
  })

  it('面板上没有任何写入口：规划里那格「flags 编辑器」被明确拒绝（世界状态只有一个主人）', () => {
    const src = readFileSync(fileURLToPath(new URL('../../src/tools/QuestDebugger.ts', import.meta.url)), 'utf8')
    const code = src.split('\n').filter((l) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//')).join('\n')
    for (const writer of ['setFlag', '.advance(', '.start(', 'addRelation', 'restore(']) {
      expect(code, `调试器长出了写入口 ${writer} ⇒ 世界状态出现第二个主人`).not.toContain(writer)
    }
    expect(code).toContain('QuestReader') // 反过来钉住：它确实只经由"读"接口拿数据
  })
})
