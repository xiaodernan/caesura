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
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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
import type { EnemyData, MovesetData, QuestData, WeaponData } from '@/data/schema'
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
import { perfPanelSpec, perfPanelText, type PerfSource } from '@/tools/PerfDebugger'
import { BUDGET_CPU_MS, BUDGET_GPU_MS, FRAME_WINDOW, PerfSampler } from '@/core/PerfSampler'
import { Pool } from '@/core/Pool'
import { CombatDebugger } from '@/tools/CombatDebugger'
import { bus } from '@/core/EventBus'

registerGameData()

/* ------------------------------------------------------------------ 外壳 */

class FakeEl {
  private _style: Record<string, string> = {}
  get style(): Record<string, string> & { cssText: string } {
    return new Proxy(this._style, {
      get(target, prop: string) {
        if (prop === 'cssText') {
          return Object.entries(target).map(([k, v]) => `${k}:${v}`).join(';')
        }
        return target[prop]
      },
      set(target, prop: string, value) {
        if (prop === 'cssText') {
          for (const part of String(value).split(';')) {
            const [k, ...rest] = part.split(':')
            if (k && rest.length) target[k.trim()] = rest.join(':').trim()
          }
          return true
        }
        target[prop] = value
        return true
      }
    }) as Record<string, string> & { cssText: string }
  }
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

  it('出手那一式在 F4 也报（doing 行：帧表四个数 + shots）', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_refrein', at(4), 'f4')
    const spec = e.data.attacks[0]
    e.attack = newAttack(spec, 7)
    const text = aiPanelText({ target: e, player: w.player.pos, grid: gridOf(w), armedSlots: [] })
    expect(text).toMatch(new RegExp(`doing\\s+${spec.id} tick 7`))
    expect(text).toContain(`startup ${spec.frames.startup}`)
    expect(text).toContain(`window ${spec.frames.activeStart}-${spec.frames.activeEnd}`)
    expect(text).toContain(`recovery ${spec.frames.recovery}`)
    expect(text).toContain(`shots ${e.attack.shots}`)
    e.attack = null
    expect(aiPanelText({ target: e, player: w.player.pos, grid: gridOf(w), armedSlots: [] }), '收招之后 doing 行消失').not.toContain('doing')
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

  it('末步的闸门没命中就不打勾；而"末步干脆没有闸门"这种线在表里已经不存在', () => {
    const w = makeQuestWorld()
    /**
     * 这条用例原来叫「末步没有 advanceOn 的那几条线永远不打勾（后续步还没写，不是做完了）」——
     * 那时 `q_haltrune` 的末步是《最后一班岗》，没有闸门（＝一条永远收不了的线）。
     * 五条 NPC 线各自收束之后，那个形状在表里**一条都不剩**了，所以判据反过来钉：
     * ① **表级**：谁再往表里加一条没有闸门的末步（＝造一条永远打不了勾的线）当场红；
     * ② **面板级**：末步的闸门要原样印出来，没命中之前不打勾，命中那一刻才打勾。
     */
    const openEnded = questTable.filter((q) => !q.steps[q.steps.length - 1].advanceOn).map((q) => q.id)
    expect(openEnded, '末步没有闸门的线（＝后续步还没落表的老形状）').toEqual([])

    // `walkTo` 只立旗，所以值域那两步得由状态机自己广播过来（引擎那条路，不是直接调 advance）
    w.walkTo('q_haltrune', 1)
    w.worldStates.set('state.haltrune.camp', 'OUTPOST') // 步 2《点名册》的闸门
    w.streaming.setFlag('flag.haltrune_farewell_open') // 步 3《最后一班岗》的闸门
    const row = w.rowOf('q_haltrune')
    expect(row).toContain('4/4')
    expect(row).toContain('HALTRUNE.STEP4_PASSING')
    expect(row, '末步等的是**值域**，面板要印出那一格与它的取值').toContain('next: state.haltrune.fate in PASSING_STILL/DRUM_LEGEND')
    expect(row, '停在末步 ≠ 收束').not.toContain('[done]')
    w.worldStates.set('state.haltrune.fate', 'PASSING_STILL')
    expect(w.rowOf('q_haltrune'), '闸门命中才打勾').toContain('[done]')
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

describe('F2 · 战斗读数面板', () => {
  let beforeKeydownCount: number

  beforeEach(() => {
    beforeKeydownCount = win.handlers.keydown?.length ?? 0
  })

  afterEach(() => {
    const after = win.handlers.keydown?.length ?? 0
    expect(after, 'CombatDebugger dispose 必须把 keydown 监听摘走').toBe(beforeKeydownCount)
  })

  const anyDbg = (dbg: CombatDebugger) => dbg as any

  it('F2 开关：首按开、再按关，关着时不拼文本', () => {
    const dbg = new CombatDebugger()
    expect(anyDbg(dbg).enabled).toBe(false)
    expect(anyDbg(dbg).panel.style.display).toBe('none')

    press('F2')
    expect(anyDbg(dbg).enabled).toBe(true)
    expect(anyDbg(dbg).panel.style.display).toBe('block')
    const textOpen = anyDbg(dbg).panel.textContent

    press('F1') // 无关键不拨动
    expect(anyDbg(dbg).enabled).toBe(true)
    expect(anyDbg(dbg).panel.textContent).toBe(textOpen)

    press('F2')
    expect(anyDbg(dbg).enabled).toBe(false)
    expect(anyDbg(dbg).panel.style.display).toBe('none')
    const textClosed = anyDbg(dbg).panel.textContent
    expect(textClosed).toBe(textOpen) // 关着不刷

    dbg.dispose()
  })

  it('combat.hit 追加 newest-first 并封顶 12 条；BS/WP 旗标随事件印', () => {
    const dbg = new CombatDebugger()
    press('F2')
    // 13 条 ⇒ 只保留最新 12
    for (let i = 0; i < 13; i++) {
      bus.emit('combat.hit', {
        attackerId: `atk${i}`, victimId: 'v', damage: 10, poiseDamage: 5,
        kind: 'enemy', result: 'hit', point: { x: 0, y: 0, z: 0 }, dir: { x: 1, y: 0, z: 0 },
        hitStopMs: 80, shakeKey: 'small', backstab: i === 12, weakpoint: i === 11
      })
    }
    const txt = anyDbg(dbg).panel.textContent
    expect(txt).toContain('combat.debug')
    expect(txt).toContain('BS')  // 最后一条
    expect(txt).toContain('WP')  // 倒数第二条
    // 只有 12 行 hit（去掉表头 5 行 ⇒ 17 行总共）
    expect(txt.split('\n').filter((l: string) => l.includes('dmg')).length).toBe(12)
    dbg.dispose()
  })

  it('player.stats：整数不加小数点，非整数保留一位', () => {
    const dbg = new CombatDebugger()
    press('F2')
    bus.emit('player.stats', { hp: 60, hpMax: 100, stamina: 75, staminaMax: 100,
      poise: 30, poiseMax: 50, overdrive: 42.5, overdriveMax: 100, rank: 2,
      corruption: 0, corruptionMax: 100, corruptionVeil: 0, muteTicksLeft: 0 })
    expect(anyDbg(dbg).panel.textContent).toContain('HP 60/100')
    expect(anyDbg(dbg).panel.textContent).toContain('STA 75/100')
    expect(anyDbg(dbg).panel.textContent).toContain('POI 30/50')
    expect(anyDbg(dbg).panel.textContent).toContain('OD 42.5/100')
    dbg.dispose()
  })

  it('rhythm.beat：isBarStart=│ 否则=·，最多保留 96 字符', () => {
    const dbg = new CombatDebugger()
    press('F2')
    bus.emit('rhythm.beat', { beatIndex: 0, beatInBar: 1, bar: 0, isBarStart: true, phase: 0 })
    bus.emit('rhythm.beat', { beatIndex: 1, beatInBar: 2, bar: 0, isBarStart: false, phase: 0.25 })
    const beatsLine = anyDbg(dbg).panel.textContent.split('\n').find((l: string) => l.startsWith('beats:'))!
    expect(beatsLine).toContain('│1')
    expect(beatsLine).toContain('·2')
    dbg.dispose()
  })

  it('world.chunk：unloaded 删除 key，其余三态计数 + 末行回显', () => {
    const dbg = new CombatDebugger()
    press('F2')
    bus.emit('world.chunk', { key: 'a', regionId: 'r1', cx: 0, cy: 0, cz: 0, center: { x: 0, y: 0, z: 0 },
      state: 'active', priority: 1, tick: 0 })
    bus.emit('world.chunk', { key: 'b', regionId: 'r1', cx: 1, cy: 0, cz: 0, center: { x: 0, y: 0, z: 0 },
      state: 'resident', priority: 1, tick: 0 })
    bus.emit('world.chunk', { key: 'c', regionId: 'r1', cx: 0, cy: 1, cz: 0, center: { x: 0, y: 0, z: 0 },
      state: 'preloading', priority: 1, tick: 0 })
    let stream = anyDbg(dbg).panel.textContent.split('\n').find((l: string) => l.startsWith('stream'))!
    expect(stream).toContain('act 1')
    expect(stream).toContain('res 1')
    expect(stream).toContain('load 1')

    bus.emit('world.chunk', { key: 'b', regionId: 'r1', cx: 1, cy: 0, cz: 0, center: { x: 0, y: 0, z: 0 },
      state: 'unloaded', priority: 1, tick: 0 })
    stream = anyDbg(dbg).panel.textContent.split('\n').find((l: string) => l.startsWith('stream'))!
    expect(stream).toContain('res 0')
    expect(stream).toContain('unloaded')
    dbg.dispose()
  })

  it('dispose 摘掉按键、解订 bus、把节点从 body 拿下', () => {
    const dbg = new CombatDebugger()
    press('F2')
    const panel = anyDbg(dbg).panel as FakeEl
    const bodyChildrenBefore = body.children.length
    dbg.dispose()
    expect(panel.removeCount).toBe(1)
    expect(panel.parent).toBe(null)
    expect(body.children.length).toBe(bodyChildrenBefore - 1)
    // 解订后再发事件不报错、也不更新文本
    expect(() => bus.emit('combat.hit', {
      attackerId: 'x', victimId: 'y', damage: 1, poiseDamage: 1,
      kind: 'enemy', result: 'hit', point: { x: 0, y: 0, z: 0 }, dir: { x: 1, y: 0, z: 0 },
      hitStopMs: 0, shakeKey: 'x', backstab: false, weakpoint: false
    })).not.toThrow()
    const txtAfter = panel.textContent
    // 面板已移除但对象还在；dispose 后不应再因事件而变文本（handler 已摘）
    expect(panel.textContent).toBe(txtAfter)
  })
})

/* ---------------------------------------- 批 16：两块面板的分支死角补测 */

describe('F4 分支死角（批 16）：deaf / held / tuned / boss 行的读数腿', () => {
  it('deaf 两腿：素敌印 no，聋乱窗里印 yes(剩余拍数)', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_refrein', at(4), 'f4d')
    const g = gridOf(w)
    expect(aiPanelText({ target: e, player: w.player.pos, grid: g, armedSlots: [] })).toMatch(/deaf no\b/)
    // deaf 是只读 getter（数据 ai.deaf || deafTicks>0 || 阶段聋）：真腿走 deafTicks 这条运行时来源
    e.deafTicks = 30
    expect(aiPanelText({ target: e, player: w.player.pos, grid: g, armedSlots: [] })).toContain('deaf yes(30t)')
  })

  it('held 行五态全亮；一项都不占时整行消失（不是印一个空行）', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_refrein', at(4), 'f4d')
    const g = gridOf(w)
    expect(aiPanelText({ target: e, player: w.player.pos, grid: g, armedSlots: [] })).not.toMatch(/\nheld/)
    e.stunTicks = 12
    e.stunStopTicks = 3
    e.frozenTicks = 5
    e.intangible = true
    e.revealTicks = 8
    expect(aiPanelText({ target: e, player: w.player.pos, grid: g, armedSlots: [] }))
      .toContain('held   stun 12t  hitstop 3t  frozen 5t  phase-gap (intangible)  revealed 8t')
  })

  it('tuned 行只在有减益时出现，读数就是实例上那份 buff', () => {
    const w = makeWorld()
    const e = w.ai.spawn('en_refrein', at(4), 'f4d')
    const g = gridOf(w)
    expect(aiPanelText({ target: e, player: w.player.pos, grid: g, armedSlots: [] })).not.toContain('tuned')
    e.buff = { fromId: 'en_ostlara', attackSpeedMul: 1.2, dmgMul: 1.5 }
    expect(aiPanelText({ target: e, player: w.player.pos, grid: g, armedSlots: [] }))
      .toContain('tuned  from en_ostlara: speed x1.2 dmg x1.5')
  })

  it('boss 行：en_myriad 不定义钟速 ⇒ 回落到网格 bpm；铃铛 RUNG/up 分明；P2 夺拍在 neutral=0 时不印抢回段', () => {
    const w = makeWorld()
    const g = gridOf(w)
    const myriad = w.ai.spawn('en_myriad', at(5), 'f4d')
    // en_myriad 的 boss 数据没有 bpm/beatsPerBar：钟速走 clockBpm ?? g.bpm 与 beatsPerBar ?? 4 两条回落腿
    expect(aiPanelText({ target: myriad, player: w.player.pos, grid: g, armedSlots: [] }))
      .toMatch(/boss\s+phase 1  clock 108\/4/)
    myriad.bellsRung = [true, false]
    expect(aiPanelText({ target: myriad, player: w.player.pos, grid: g, armedSlots: [] })).toContain('bells RUNG,up')

    const hersil = w.ai.spawn('en_hersil', at(5), 'f4d')
    hersil.bossPhase = 1 // P2 的 stealBeat 来自阶段数据（既有用例已盖过 neutral 真腿）
    const p2 = aiPanelText({ target: hersil, player: w.player.pos, grid: g, armedSlots: [] })
    expect(p2).toContain('stealBeat')
    expect(p2, '玩家没抢回拍（neutral=0）时没有"neutral"段可印').not.toContain('neutral')
  })
})

describe('F3 分支死角（批 16）：空表、截断、值域缺格与 waits 的"等无可等"', () => {
  /** 手造任务表（表级判据见既有用例；这里只喂面板装配层，不碰 registry） */
  const qdef = (
    id: string,
    steps: Array<{ state: string; advanceOn?: { flags?: string[]; state?: { key: string; in: string[] } } }>,
  ): QuestData => ({
    id, nameKey: `quest.${id}`, displayName: id, npc: 'npc_test', outcome: '',
    steps: steps.map((s) => ({
      state: s.state, label: `${id}·${s.state}`,
      ...(s.advanceOn ? { advanceOn: s.advanceOn } : {}),
    })),
  })
  const readerOf = (step: number, done = false) => ({
    stepIndex: (_id: string) => step,
    isComplete: (_id: string) => done,
  })

  it('表里一条线都没有时明说，而不是印一个空标题', () => {
    expect(questPanelText([], { flags: [], byRules: [], used: [], relations: {} }))
      .toContain('(no quests in the table)')
  })

  it('值域格一个都没写过 ⇒ (all default)；used 超过 12 个截断成省略号', () => {
    const q = qdef('q_probe_trunc', [{ state: 'S1' }])
    const world = {
      flags: ['flag.one'], byRules: ['flag.one'],
      used: Array.from({ length: 13 }, (_, i) => `ix_probe_${i}`),
      relations: {},
      // 不带 states 字段：world.states ?? {} 的右腿 + 空表的 (all default)
    }
    const text = questPanelText(questRows([q], readerOf(0)), world)
    expect(text).toContain('(all default)')
    expect(text).toContain('used interactables 13: ')
    expect(text).toContain('…')
    expect(text, '第 13 个之后的交互物不该出现在面板上').not.toContain('ix_probe_12')
  })

  it('waits 的"等无可等"：没写闸门与闸门是空对象都如实印 (no advanceOn)；没开线是另一句话', () => {
    const noGate = qdef('q_probe_nogate', [{ state: 'S1' }, { state: 'S2' }])
    expect(questRows([noGate], readerOf(1))[0].waits, 'cur 存在但 advanceOn 没写').toBe('(no advanceOn)')
    const emptyGate = qdef('q_probe_emptygate', [{ state: 'S1', advanceOn: {} }, { state: 'S2' }])
    expect(questRows([emptyGate], readerOf(0))[0].waits, '闸门写了但什么都不等').toBe('(no advanceOn)')
    expect(questRows([noGate], readerOf(-1))[0].waits, 'stepIndex=-1 = 没开线，不是没闸门').toBe('(not started)')
  })

  it('旗标与值域并排印：一步同时等两样时一行里都要看得见', () => {
    const q = qdef('q_probe_dual', [
      { state: 'S1', advanceOn: { flags: ['flag.a', 'flag.b'], state: { key: 'state.probe.x', in: ['ON', 'OFF'] } } },
      { state: 'S2' },
    ])
    expect(questRows([q], readerOf(0))[0].waits).toBe('flag.a|flag.b + state.probe.x in ON/OFF')
  })
})

/* ------------------------------------------------------------- F5 · 性能 */

describe('F5 · 性能面板（§5.7 那一格的落地，KI-335）', () => {
  /** 带 `onToggle` 的外壳：这一块面板与其它三块的唯一结构差别就是这条联动（其余三块没有第二条开关） */
  const f5shell = (onToggle?: (on: boolean) => void) => {
    const calls = { n: 0 }
    const p = new DebugPanel({
      key: 'F5', label: 'perf', anchor: 'position:fixed;right:12px;bottom:12px',
      text: () => { calls.n++; return `payload-${calls.n}` },
      ...(onToggle ? { onToggle } : {}),
    })
    live.push(() => p.dispose())
    return { p, el: (p as unknown as { el: FakeEl }).el, calls }
  }

  it('开关通知的是**顺序对的那一种**：armed 先起来，再刷第一帧字；关掉时反过来先停采再刷', () => {
    const seq: string[] = []
    const { p } = f5shell((on) => seq.push(`toggle:${on}`))
    p.refresh()
    expect(seq, '关着时一次都不该通知').toEqual([])
    press('F5')
    expect(seq).toEqual(['toggle:true'])
    expect(p.enabled).toBe(true)
    press('F5')
    expect(seq, '通知在 refresh 之前：面板打开那一次刷的是清过窗口的读数，不是上一现场的').toEqual(['toggle:true', 'toggle:false'])
  })

  it('没有 `onToggle` 的三块老面板照旧工作（这一格是可选的，不是新的构造义务）', () => {
    const { el, calls } = f5shell()
    press('F5')
    expect(el.textContent).toBe('F5 · perf\npayload-1')
    expect(calls.n).toBe(1)
  })

  /**
   * 面板读的四件东西各给一份**结构替身**：`perfPanelSpec` 只认那几格，所以夹具也只长那几格——
   * 多长的一格面板读不到，而"读不到"正是这几条腿要问的事（组合根里那份真接线没有机器读者）。
   */
  function fakeEngines() {
    // 池走一段真借还：2 发生成 + 2 次复用 ⇒ reuse 2/4，在途 2、空闲 0、峰值 2
    const pool = new Pool<{ id: number }>(() => ({ id: 1 }), () => {}, 4)
    const a = pool.obtain()
    const b = pool.obtain()
    pool.release(a)
    pool.release(b)
    pool.obtain()
    pool.obtain()
    return {
      engines: {
        vfx: { get emitterPoolStats() { return pool.stats } },
        streaming: {
          stats: () => ({ active: 4, resident: 5, preloading: 2, unloaded: 40, queued: 3, inFlight: 2 }),
          options: { maxInFlight: 4 },
        },
        renderer: {
          info: { render: { calls: 37, triangles: 128000 }, memory: { geometries: 21, textures: 8 } },
        },
        loop: { maxTicksPerFrame: 5 },
      },
      pool,
    }
  }
  const f5spec = () => {
    const sampler = new PerfSampler()
    const { engines, pool } = fakeEngines()
    const spec = perfPanelSpec(sampler, engines, { frameWindow: FRAME_WINDOW, budget: { cpuMs: BUDGET_CPU_MS, gpuMs: BUDGET_GPU_MS } })
    return { sampler, spec, engines, pool }
  }

  it('那一格的三件外壳事（键／标题／停靠位）住在面板自己那里：组合根不再抄第二份', () => {
    const { spec } = f5spec()
    expect(spec.key, '§5.7 那句「F 键」落成的那把').toBe('F5')
    expect(spec.anchor).toBe('position:fixed;right:12px;bottom:12px')
    expect(spec.label, '标题要说清这五段读的是什么').toContain('分位')
  })

  it('`onToggle` 联动的是真采样器：开 ⇒ 真的在采，关 ⇒ 连窗口一起清（不是只把字藏起来）', () => {
    const { spec, sampler } = f5spec()
    spec.onToggle!(true)
    expect(sampler.armed, '开这一格 ⇒ 第二道闸门起来').toBe(true)
    sampler.frame({ deltaMs: 16.7, logicMs: 1, renderMs: 2, ticks: 1, truncated: false })
    expect(sampler.snapshot().samples).toBe(1)
    spec.onToggle!(false)
    expect(sampler.armed).toBe(false)
    expect(sampler.snapshot().samples, '关 ⇒ 上一现场的账不留').toBe(0)
  })

  it('池那一行的六个数逐个对着 `emitterPoolStats`：面板不认识 Emitter，也不自己填一个数', () => {
    const { spec, pool } = f5spec()
    const st = pool.stats
    const line = spec.text().split('\n').find((l) => l.includes('vfx.emitter'))!
    expect(line, '命中率那三格就是 `Pool.stats` 那两格算出来的').toContain(`reuse ${st.hits}/${st.hits + st.misses} (50.0%)`)
    expect(line).toContain(`live ${String(st.live).padStart(4)}/${st.cap}`)
    expect(line).toContain(`free ${String(st.free).padStart(4)}`)
    expect(line).toContain(`peak ${String(st.peak).padStart(4)}`)
  })

  it('那一行每次刷都重新读池：面板上不许有"接线那一刻"抄下来的旧数', () => {
    const { spec, pool } = f5spec()
    const before = spec.text().split('\n').find((l) => l.includes('vfx.emitter'))!
    pool.obtain() // 空闲栈此时是空的 ⇒ 第三次现造：misses 2→3，在途 2→3
    const after = spec.text().split('\n').find((l) => l.includes('vfx.emitter'))!
    expect(after, '借还之后那一行跟着变：读数是现取的，不是 spec 建好时钉死的').toContain('reuse 2/5 (40.0%)')
    expect(after).toContain('live    3/4')
    expect(after).not.toBe(before)
  })

  it('流送那一行有两个主人：六格读数出自 `stats()`，`maxInFlight` 出自 `options`（配额那一格的主人）', () => {
    const { spec } = f5spec()
    const line = spec.text().split('\n').find((l) => l.startsWith('—— streaming'))!
    expect(line).toContain('active 4')
    expect(line, '分母那个 4 是 `options.maxInFlight`，不是 stats 里的某一格').toContain('in-flight 2/4')
  })

  it('renderer.info 那四格分两本账：calls/tris 走 render，geom/tex 走 memory', () => {
    const { spec } = f5spec()
    expect(spec.text()).toMatch(/calls\s+37\s+tris\s+128,000\s+geom\s+21\s+tex\s+8/)
  })

  it('catch-up 那一行的上限读的是 `loop.maxTicksPerFrame`：那条环还是那一格的主人', () => {
    const { spec, sampler } = f5spec()
    sampler.open()
    sampler.frame({ deltaMs: 50, logicMs: 1, renderMs: 2, ticks: 3, truncated: true })
    expect(spec.text().split('\n')[4]).toBe('ticks/frame avg 3.00 max 3 (cap 5) · 丢整拍 1')
  })

  /** 真采样器 ＋ 真池：面板上那几个数必须能从**引擎的账**里读出来，不是夹具手抄的一份 */
  function perfWorld() {
    const sampler = new PerfSampler()
    sampler.open()
    for (const d of [10, 20, 30]) sampler.frame({ deltaMs: d, logicMs: 100, renderMs: 2, ticks: 1, truncated: false })
    sampler.span('logic.ai', () => {})
    // 池走一段真借还：2 发生成 + 2 次复用 ⇒ reuse 2/4，在途 2、空闲 0、峰值 2
    const pool = new Pool<{ id: number }>(() => ({ id: 1 }), () => {}, 4)
    const a = pool.obtain()
    const b = pool.obtain()
    pool.release(a)
    pool.release(b)
    pool.obtain()
    pool.obtain()
    return {
      sampler,
      src: {
        perf: sampler.snapshot(),
        pools: [{ name: 'vfx.emitter', ...pool.stats }],
        streaming: { active: 4, resident: 5, preloading: 2, unloaded: 40, queued: 3, inFlight: 2, maxInFlight: 4 },
        gpu: { calls: 37, triangles: 128000, geometries: 21, textures: 8 },
        maxTicksPerFrame: 5,
        frameWindow: FRAME_WINDOW,
        budget: { cpuMs: BUDGET_CPU_MS, gpuMs: BUDGET_GPU_MS },
      } satisfies PerfSource,
      pool,
    }
  }

  it('头部那三格来自快照：帧数、窗口占用与「窗口未满」那句一起写出来', () => {
    const { src } = perfWorld()
    const head = perfPanelText(src).split('\n')[0]
    expect(head).toContain('frames 3')
    expect(head).toContain(`窗口 3/${FRAME_WINDOW}`)
    expect(head, 'n=3 时下面那些分位数没有意义，面板要自己说这句').toContain('窗口未满')
    expect(head).toMatch(/fps\s+50\.0/) // 1000/mean(10,20,30) ＝ 50
  })

  it('三行分位数各读各的口径：frame 那条没有预算判定，logic/render 各按 §5.3 的那两格判超没超', () => {
    const { src } = perfWorld()
    const lines = perfPanelText(src).split('\n')
    // 10/20/30 三个样本的最近秩：P50 第 2 个、P90 与 P99 都落在第 3 个
    expect(lines[1]).toMatch(/frame ms\s+P50\s+20\.00\s+P90\s+30\.00\s+P99\s+30\.00\s+max\s+30\.00/)
    expect(lines[1]).not.toMatch(/OVER|≤/)
    expect(lines[2], 'logic 每帧 100ms，预算 6ms ⇒ 该说超').toMatch(/logic ms.*P99\s+100\.00.*OVER\s+6\.00/)
    expect(lines[3], 'render 每帧 2ms，预算 12ms ⇒ 该说没超').toMatch(/render ms.*≤\s+12\.00/)
    expect(lines[3]).not.toMatch(/P90/)
  })

  it('catch-up 那一行把「上限」与「真的丢了几拍」分开写（老口径里这两件事没人读得到）', () => {
    const { src } = perfWorld()
    expect(perfPanelText(src).split('\n')[4]).toBe('ticks/frame avg 1.00 max 1 (cap 5) · 丢整拍 0')
  })

  it('分段行一格一名：名字就是 `main.ts` 里那个 span 名，而 calls 是 EMA（一记只走 1/60 步）', () => {
    const { src, sampler } = perfWorld()
    sampler.span('render.submit', () => {})
    const text = perfPanelText({ ...src, perf: sampler.snapshot() })
    const aiRow = text.split('\n').find((l) => l.includes('logic.ai'))
    const submitRow = text.split('\n').find((l) => l.includes('render.submit'))
    expect(aiRow, '走过一段却没有行 = 面板在读另一份名册').toBeTruthy()
    expect(submitRow, '两段各一行，不许并成一格').toBeTruthy()
    // 两段各只被叫过一次：EMA(0→1) 走一步 ＝ 1/60 ＝ 0.0167 ⇒ 面板上都是 `x 0.02`，不是 `x 1.00`
    expect(aiRow).toMatch(/x\s*0\.02/)
    expect(submitRow).toMatch(/x\s*0\.02/)
  })

  it('池那一行是命中率本体：reuse 的分子/总数在括号里，一次都没领过就写 —，不写 NaN%', () => {
    const { src, pool } = perfWorld()
    const line = perfPanelText(src).split('\n').find((l) => l.includes('vfx.emitter'))!
    // 三个数都对着**池自己**的账，而不是把字面量抄第二遍
    expect(pool.stats.hits).toBe(2)
    expect(pool.stats.misses).toBe(2)
    expect(line).toContain(`live ${String(pool.stats.live).padStart(4)}/${pool.stats.cap}`)
    expect(line).toContain(`free ${String(pool.stats.free).padStart(4)}`)
    expect(line).toContain(`peak ${String(pool.stats.peak).padStart(4)}`)
    expect(line).toMatch(/reuse 2\/4 \(50\.0%\)/)
    const empty = { ...src, pools: [{ name: 'fresh', live: 0, free: 0, peak: 0, cap: 8, hits: 0, misses: 0 }] }
    expect(perfPanelText(empty).split('\n').find((l) => l.includes('fresh'))).toContain('reuse 0/0 (—)')
  })

  it('流送那一行分得清 queued 与 in-flight：配额管的是后者，把两个数写成一格就是给 §5.5 报错账', () => {
    const { src } = perfWorld()
    const line = perfPanelText(src).split('\n').find((l) => l.startsWith('—— streaming'))!
    expect(line).toContain('active 4')
    expect(line).toContain('preload 2')
    expect(line).toContain('queued 3')
    expect(line).toContain('in-flight 2/4')
    expect(line).toContain('unloaded 40')
  })

  it('renderer.info 那四格是 drawcall/三角/几何/纹理（§5.3 那张预算表第一次有实测的读者）', () => {
    const { src } = perfWorld()
    expect(perfPanelText(src)).toMatch(/calls\s+37\s+tris\s+128,000\s+geom\s+21\s+tex\s+8/)
  })

  it('那三格常数（窗口／两格预算）真的由调用方说了算：换个数就换个判法，面板里没有自己的那一份', () => {
    const { src } = perfWorld()
    // 预算收到 0.001ms ⇒ logic 那行从「OVER 6.00」变成「OVER 0.00」；放到 999ms ⇒ render 那行改口说 ≤
    const tight = perfPanelText({ ...src, budget: { cpuMs: 0.001, gpuMs: 999 } }).split('\n')
    expect(tight[2]).toMatch(/OVER\s+0\.00/)
    expect(tight[3], '预算放宽之后还写着 OVER 就是面板在替玩家做判断').not.toMatch(/OVER/)
    expect(tight[3]).toMatch(/≤\s*999\.00/)
    // 窗口那格同理：写成 2 就成了"3/2"，而"窗口未满"那句跟着消失（它判的是 samples < frameWindow）
    const narrow = perfPanelText({ ...src, frameWindow: 2 }).split('\n')[0]
    expect(narrow).toContain('窗口 3/2')
    expect(narrow).not.toContain('窗口未满')
  })

  it('一个样本都没有时不崩也不吹：整块面板说的是"至少要跑一帧"', () => {
    const { src } = perfWorld()
    const empty = { ...src, perf: new PerfSampler().snapshot() }
    const text = perfPanelText(empty)
    expect(text).toContain('窗口 0/300')
    expect(text).toContain('(还没有样本：面板开着至少要跑一帧)')
    expect(text).toMatch(/P50\s+0\.00/)
  })
})
