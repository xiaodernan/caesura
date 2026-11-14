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
import { RpgRuntime } from '@/rpg/Runtime'
import { movementConfig } from '@/rpg/Movements'
import { DEFAULT_GAMEPLAY_SETTINGS, GameplaySettingsStore, clampGameplaySettings, type GameplaySettings } from '@/settings/GameplaySettings'
import { readFileSync } from 'node:fs'

/**
 * KI-384：§6「手柄支持」那一行里剩下的最后一格——**连打关闭**。
 *
 * 这一格的病不是"少一个开关"，是**「连打」这两个字在本仓里今天指着三件事，而只有第一件有机制**：
 * - **读 A（有机制）**：§7.2 的防连发涨价。`mv_caesuracut`／`mv_terminate` 各带 `overdriveRamp: 2`，
 *   住家 `src/player/ThirdPersonController.ts`——出手那一句写涨价、`overdriveCostOf` 那一句读涨价、
 *   过载条重新攒满那一句清账（progression.md §7.2 那两行写的就是它；combat.md §4.8 抄的是同一张表的帧那一半）。这一格关的是它。
 * - **读 B（没有机制）**：「按住不放自动连发」。轻击只吃 `frame.edges`（`Input` 只在 `!prevHeld` 那一句里
 *   记边沿），按住 40 拍出一记。于是那一格**不可能**在说这件事——没有一个机制可以被关。
 * - **读 C（有机制但不是它）**：连段 `l1→l2→l3`，由一次次**边沿**推着走，名字在文档里是「连段」不是「连打」。
 *   本批给它一条「关着照旧」的腿：这一格不许顺手把连段也关了。
 *
 * **裁决的形状**（两处判读，一主一从）：那一格是一只**开关**，不是一台暂停的表——
 * ① 关着 ⇒ 不再写涨价；② 关掉**那一刻**清账 ⇒ 先前涨的那一截从此不再收（若只在出手那一句判，
 * 关掉之后的第一下仍按涨后的价被拒一次，那正是这条腿的证人）；③ 重新打开从**底价**重新起算。
 * 而**验价那一句一个字不认这个开关**：`overdriveCostOf` 只问表里存了多少——「付多少」与「够不够」
 * 仍共用同一个答案（§7.2 那条既有口径），开关管的是那份账**长不长**、**还在不在**。
 *
 * **要如实记下的一处形状**：默认 开 ⇒ 老档缺这一格读成「照旧涨价」，与今天的行为逐字相等，
 * 因此存档版本号不动（KI-359 那条先例）。与 KI-365 那一格不同，这一格**没有默认值变化**，
 * 所以 133–200ms 那种"顺手兑掉一个静默洞"的行为变化在本批不存在。
 */
registerGameData()

const CAESURA = 'mv_caesuracut' // §7.2 那两行里带 `overdriveRamp` 的一式：它不出伤害，只拿走别人的时间

/** 底价与涨幅一律回读表，测试里不抄第二份数（§55） */
function rampTable() {
  const mv = movementConfig().movements.find((m) => m.id === CAESURA)
  if (!mv?.cost.overdriveRamp) throw new Error(`${CAESURA} 没有 overdriveRamp：本用例的前提失效`)
  return { base: mv.cost.overdrive!, step: mv.cost.overdriveRamp }
}

function makeWorld(patch?: Partial<GameplaySettings>) {
  const time = new GameTime()
  const rhythm = new RhythmClock()
  rhythm.setBpm(84, 4)
  const rpg = new RpgRuntime()
  const weapon = registry.get<WeaponData>(rpg.mods().weaponId!)
  const moveset = registry.get<MovesetData>(`moveset:${weapon.movesetId}`)
  const player = new PlayerController(playerBase, weapon, moveset)
  player.applyRpg(rpg.mods())
  player.setSkills(rpg.skillLoadout())
  const ai = new AISystem()
  const combat = new CombatManager(player, ai, time, rhythm)
  const frame = { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() }
  const input = { frame, enabled: true, bufferSec: 0.2, frameAssist: false } as unknown as Input
  // 第六把消费者就是玩家自己：构造即灌一遍（`applyToTargets` 是唯一的灌入路径，测试不另写一份）
  const store = new GameplaySettingsStore({ input, rig: { shakeIntensity: 0 }, haptics: { scale: 1, weakScale: 1 }, combat, player }, patch)
  player.camYawRef = 0

  const notes: string[] = []
  const offs = [bus.on('ui.notify', (p: { text: string }) => notes.push(p.text))]
  /** 出手记录：只问「哪一刻真的开始了一式」，判据不碰 */
  const starts: string[] = []
  const origStart = player.tryStartAction.bind(player)
  player.tryStartAction = (key: string, tick: number, r?: RhythmClock): boolean => {
    const ok = origStart(key, tick, r)
    if (ok) starts.push(key)
    return ok
  }

  function tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      time.tick++
      time.reset()
      player.update(TICK_DT, time, input, time.tick, rhythm)
      ai.update(TICK_DT, time.tick, player, rhythm)
      combat.update(time.tick, input)
      player.stats.hp = player.stats.hpMax
      player.stats.stamina = player.stats.staMax
      frame.edges.clear()
      rhythm.update(TICK_DT)
    }
  }

  /**
   * 把休止斩装进主动槽并灌给玩家：走的是谱册那一条真通道（点亮页 → equip → loadout），
   * `equip` 的 rank 实参给足 ⇒ 不必先跑一遍音级曲线（那一段是 movements.test.ts 的尺子）。
   */
  function equipCaesura(): string {
    const book = rpg.moves
    const mv = movementConfig().movements.find((m) => m.id === CAESURA)
    if (!mv) throw new Error(`表里没有 ${CAESURA}：本用例的前提失效`)
    const page = book.page(mv.page)
    if (!page) throw new Error(`谱册里没有页 ${mv.page}`)
    if (!book.isLit(page.id)) {
      if (page.unlock.flag) bus.emit('world.flag', { key: page.unlock.flag, value: true })
      expect(book.unlockPage(page.id, rpg.inv).ok, page.id).toBe(true)
    }
    const slot = book.cfg.slots.findIndex((s) => s.action === 'weaponSkill')
    expect(book.equip(slot, CAESURA, 99).ok, `槽 ${slot} 装不进 ${CAESURA}`).toBe(true)
    player.applyRpg(rpg.mods())
    player.setSkills(rpg.skillLoadout())
    return book.cfg.slots[slot].action
  }

  /** 摆回「能出手」并给足精力与过载里的那一条：本文件测的是价，不是挨打 */
  function ready(): void {
    player.stats.hp = player.stats.hpMax
    player.stunTicks = 0
    player.crumpleTicks = 0
    player.action = null
  }

  /** 出手一次（成功才等冷却自己走完——冷却的真主人是 `cast.cooldownTicks`） */
  function cast(key: string, overdrive: number): boolean {
    ready()
    player.stats.overdrive = overdrive
    const ok = player.tryStartAction(key, time.tick, rhythm)
    if (ok) tick(player.skills[key].cast.cooldownTicks + 2)
    else tick(2)
    return ok
  }

  function off(): void { offs.forEach((f) => f()) }

  return { time, rhythm, player, ai, combat, frame, input, store, rpg, notes, starts, tick, equipCaesura, cast, ready, off }
}

describe('KI-384 取证：「连打」在这套代码里今天指着三件事，而只有一件有机制', () => {
  it('读 A 有机制：同一式连打，过载价从第二下起每下贵 overdriveRamp（§7.2 那两行的数）', () => {
    const { base, step } = rampTable()
    const w = makeWorld()
    const key = w.equipCaesura()
    expect(w.player.mashGuard, '前提：这一格今天默认就是开（＝今天的行为）').toBe(true)
    expect(w.player.skillRampOf(key), '没打过不该涨价').toBe(0)
    expect(w.cast(key, base), '第一下按底价').toBe(true)
    expect(w.player.skillRampOf(key), '用过一次就涨一档').toBe(step)
    expect(w.cast(key, base), '只给底价时第二下必须被拒——这就是今天没有开关的那道防连发').toBe(false)
    expect(w.player.skillRampOf(key), '被拒掉的一下不该再加价').toBe(step)
    w.off()
  })

  it('读 B 没有机制：按住轻击键 40 拍只出一记——没有一个「按住自动连发」可以让这一格去关', () => {
    const w = makeWorld()
    w.frame.held.add('attackLight')
    w.frame.edges.add('attackLight')
    w.tick(40)
    expect(w.starts, '按住不放只该有一记起手：边沿只在按下那一刻记一次').toEqual(['l1'])
    w.frame.edges.add('attackLight')
    w.tick(1)
    expect(w.starts.length, '再给一枚边沿才有第二记：判据吃的是边沿不是电平').toBe(2)
    w.off()
  })

  it('读 C 是连段、不是这一格管的事：开关关掉它照旧一记接一记往下走', () => {
    /**
     * 一记起手 → 在 `activeStart..activeEnd` 那一段里再给一枚边沿（`comboQueued`）→ 走完这一式，
     * 落地那一句把 `next` 推出去。计数只问那只出手记录，不碰判据。
     */
    const chain = (patch?: Partial<GameplaySettings>): string[] => {
      const w = makeWorld(patch)
      w.frame.edges.add('attackLight')
      w.tick(1)
      const first = w.player.action
      if (!first) throw new Error('轻击没起手：本用例的尺子失效')
      const nextKey = first.f.next
      expect(nextKey, '这把武器的 l1 没写 next：连段这条尺子失效').toBeDefined()
      w.tick(14) // 过 activeStart，走进那一格的连段窗口（还远没收势）
      w.frame.edges.add('attackLight')
      w.tick(24) // 走完这一式：接下一记发生在落地那一句里
      const seen = w.starts
      w.off()
      return seen
    }
    expect(chain(), '开着：连段走得到下一记').toEqual(['l1', 'l2'])
    expect(chain({ mashGuard: false }), '关着：连段一个字不变——这一格关的是过载价，不是连段').toEqual(['l1', 'l2'])
  })
})

describe('KI-384 那一格：关的是涨价，而关掉那一刻就清账', () => {
  it('名册与默认：`mashGuard` 在表里、默认开，且消费者手里那一个字段就是它', () => {
    const keys = Object.keys(DEFAULT_GAMEPLAY_SETTINGS)
    expect(keys, '玩法那一块今天有九格（KI-365 的七格 + KI-384 的连打涨价 + invertMouseY）').toContain('mashGuard')
    /* 格数由这一条腿钉住：`profile-contents` 与 `controls-page` 的标题里各抄了一份这个数，
       加格的人该在这里被撞一下，而不是等那两句人读的话自己烂掉。 */
    expect(keys.length, '整块就是九格——多一格少一格本批都算改过形状').toBe(9)
    expect(DEFAULT_GAMEPLAY_SETTINGS.mashGuard, '默认开＝今天的行为逐字不变').toBe(true)
    const w = makeWorld()
    expect(w.player.mashGuard, '第五路消费者长成第六路：不接的话面板照样动、手感一个字不响').toBe(true)
    expect(clampGameplaySettings({}).mashGuard, '老档没有这一格 ⇒ 默认开（不推版本号）').toBe(true)
    w.off()
  })

  it('关着 ⇒ 两下都按底价：开着会被拒的那第二下，现在出得了手', () => {
    const { base } = rampTable()
    const w = makeWorld({ mashGuard: false })
    const key = w.equipCaesura()
    expect(w.player.mashGuard, '前提：那一格真的灌到了消费者手里').toBe(false)
    expect(w.cast(key, base), '第一下按底价').toBe(true)
    expect(w.player.skillRampOf(key), '关着不写涨价：表里那格就该是空的').toBe(0)
    expect(w.cast(key, base), '第二下还是按底价——对照上一条腿的第二次被拒').toBe(true)
    expect(w.player.skillRampOf(key)).toBe(0)
    w.off()
  })

  it('关掉那一刻清账：先前涨的那一截从此不再收，而不是"关掉之后的第一下仍按涨后的价被拒"', () => {
    const { base, step } = rampTable()
    const w = makeWorld()
    const key = w.equipCaesura()
    expect(w.cast(key, base)).toBe(true)
    expect(w.cast(key, base + step)).toBe(true)
    expect(w.player.skillRampOf(key), '前提：连着两下真把价涨上去了').toBe(step * 2)
    w.store.set({ mashGuard: false })
    expect(w.player.skillRampOf(key), '翻开关那一下就把账清了：这一句是本批与"只在出手时判"那把刀的分岔').toBe(0)
    expect(w.cast(key, base), '只给底价也出得了手：涨价不再补收').toBe(true)
    w.off()
  })

  it('重新打开从底价重新起算：它不是一台暂停的表，是一只开关', () => {
    const { base, step } = rampTable()
    const w = makeWorld({ mashGuard: false })
    const key = w.equipCaesura()
    expect(w.cast(key, base)).toBe(true)
    expect(w.cast(key, base)).toBe(true)
    w.store.set({ mashGuard: true })
    expect(w.player.skillRampOf(key), '打开那一下表里仍是空的：关着的两段不该攒成开着的欠账').toBe(0)
    expect(w.cast(key, base), '开着的第一下仍按底价').toBe(true)
    expect(w.player.skillRampOf(key), '从这一格起重新一档一档往上涨').toBe(step)
    w.off()
  })

  it('复位那一条既有通道不认这个开关：开着涨价、过载条攒满归零；同一个值反复灌入不该清账', () => {
    const { base, step } = rampTable()
    const w = makeWorld()
    const key = w.equipCaesura()
    expect(w.cast(key, base)).toBe(true)
    expect(w.player.skillRampOf(key)).toBe(step)
    w.store.set({ mashGuard: true })
    w.store.set({ mashGuard: true })
    expect(w.player.skillRampOf(key), '面板每开一次都灌一遍同一个值：把灌入当沿来清账会悄悄兑掉涨价').toBe(step)
    w.player.addOverdrive(w.player.stats.overdriveMax)
    expect(w.player.stats.overdrive, '前提：它被钳在上限上').toBe(w.player.stats.overdriveMax)
    expect(w.player.skillRampOf(key), '§7.2 的复位那一条照旧：攒满即归零').toBe(0)
    w.off()
  })

  it('播报跟着那一格走：关着被拒只说「过载不足」，不再报一个涨出来的数', () => {
    const { base, step } = rampTable()
    const on = makeWorld()
    const k1 = on.equipCaesura()
    on.cast(k1, base)
    on.notes.length = 0
    expect(on.cast(k1, base), '开着：只给底价 ⇒ 被涨后的价拒掉').toBe(false)
    expect(on.notes, '涨价要看得见（§7.2 那条既有口径）').toContain(`过载不足｜连打已涨到 ${base + step}`)
    on.off()
    const offW = makeWorld({ mashGuard: false })
    const k2 = offW.equipCaesura()
    expect(offW.cast(k2, base), '前提：关着连打两下都出手').toBe(true)
    expect(offW.cast(k2, base)).toBe(true)
    offW.notes.length = 0
    expect(offW.cast(k2, 0), '关着也仍有一条价：底价都够不着 ⇒ 照样拒').toBe(false)
    expect(offW.notes.filter((n) => n.includes('连打已涨到')), '关着的时候没有任何一个涨出来的数可以说').toEqual([])
    expect(offW.notes).toContain('过载不足')
    offW.off()
  })
})

describe('KI-384 判据的形状与信任边界', () => {
  it('验价那一句一个字不认这个开关：`overdriveCostOf` 仍只问表里存了多少', () => {
    const src = readFileSync(new URL('../../src/player/ThirdPersonController.ts', import.meta.url), 'utf8').split(/\r?\n/)
    const at = src.findIndex((l) => /  private overdriveCostOf\(/.test(l))
    expect(at, '找不到 `overdriveCostOf`：这一格的判据主人搬过家，本条预测要跟着改').toBeGreaterThan(-1)
    const body = src.slice(at, at + 4).join('\n')
    expect(body, '「付多少」与「够不够」不许有两个答案').toContain('return s.cast.overdriveCost + (this.skillRamp.get(key) ?? 0)')
    expect(body, '开关不该长在验价那一句里').not.toContain('ashGuard')
    /* 字段本身叫 `mashGuardOn`（属性名 `mashGuard` 是面板那条线接的地方）。源码里 `this.mashGuardOn`
       的落点只有两类：界（getter/setter，三处）与出手那一句（一处）。多出一处就说明开关又长到了别的地方。 */
    const onField = src.findIndex((l) => /  private mashGuardOn = true/.test(l))
    expect(onField, '找不到开关字段：本条预测要跟着改').toBeGreaterThan(-1)
    const sites = src.map((l, i) => ({ l, i })).filter((x) => /this\.mashGuardOn\b/.test(x.l))
    expect(sites.length, '开关在玩家这一侧一共只有四个落点：界三个 + 出手那一句一个').toBe(4)
    const writes = sites.filter((x) => /overdriveRamp > 0/.test(x.l))
    expect(writes.length, '写涨价那一句是唯一的判断点').toBe(1)
    expect(sites.filter((x) => !/overdriveRamp > 0/.test(x.l)).every((x) => x.i < onField + 12),
      '其余三处都住在界那一小块里（ getter 读、setter 比对、setter 落值）').toBe(true)
  })

  it('信任边界：错型与 null 都不算开关，回默认开；这一格不进界表（boolean 没有界）', () => {
    expect(clampGameplaySettings({ mashGuard: 'no' }).mashGuard).toBe(true)
    expect(clampGameplaySettings({ mashGuard: 1 }).mashGuard).toBe(true)
    expect(clampGameplaySettings({ mashGuard: null }).mashGuard).toBe(true)
    expect(clampGameplaySettings({ mashGuard: false }).mashGuard, '只有真布尔改得动它').toBe(false)
    const seven = { ...DEFAULT_GAMEPLAY_SETTINGS } as Record<string, unknown>
    delete seven.mashGuard
    expect(clampGameplaySettings(seven).mashGuard, '档里那七格的形状原样读回来 ⇒ 第八格补默认，其余一格不动').toBe(true)
    expect(clampGameplaySettings({ ...seven, holdMs: 600 }).holdMs, '同一句实话的反面：缺格不许顺手把别的格重置成默认').toBe(600)
  })

  it('跟档：那一格走的是同一条灌入路径，restore 一张写关了的档 ⇒ 玩家手里跟着翻', () => {
    const w = makeWorld()
    expect(w.player.mashGuard).toBe(true)
    w.store.restore({ ...DEFAULT_GAMEPLAY_SETTINGS, mashGuard: false })
    expect(w.store.get().mashGuard).toBe(false)
    expect(w.player.mashGuard, '不接这一路的话档里写的是关、玩家手里仍是开').toBe(false)
    w.store.restore(undefined)
    expect(w.player.mashGuard, '老档没有这个块 ⇒ 什么都不动（§78 的留空是如实）').toBe(false)
    w.off()
  })
})
