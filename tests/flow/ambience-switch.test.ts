import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { registerGameData, regions, worldstate, worldStates as stateTable } from '@/data'
import type { RegionMusic } from '@/data/schema'
import { ambienceBedFor } from '@/world/AmbienceSwitch'
import { registry } from '@/core/Registry'
import { StreamingSystem } from '@/world/Streaming'
import { WorldState } from '@/quest/WorldState'
import { WorldStates } from '@/quest/WorldStates'
import { conditionFlagNames, readCondition } from '../../scripts/condition-rules.mjs'

/**
 * 「该装哪一张床」由**陈设**说（KI-341）。
 *
 * 这一族变体床（§2.3 盐歌人声垫片 / §2.4 断弦更鼓）此前是这样长的：`main.ts` 里有一个
 * `ambienceBedOf(regionId, baseId)`，它把**区 id、旗名、后缀**三件事各自抄了一份，而数据里那一格
 * 只有 `ambience`。于是 KI-322③ 那格残账（「旗与声床同账」）一直没平：世界规则立了一面旗，
 * 声床那边靠**代码里的字符串相等**才知道要换床——拼错一个字母不报错，只是那张床永远选不到。
 *
 * 现在：`regions.json > music.ambienceVariants` 是唯一的账（`{ suffix, condition }`，次序即优先级），
 * `src/world/AmbienceSwitch.ts` 是唯一把两格拼成床 id 的地方，组合根只递世界的读数。
 * 下面的腿按这四段分：选床函数自己的语义、真表里每一行变体床的存在性、两个真世界事件走真链、
 * 以及把组合根里的**手抄**钉成缺席。
 */

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

const code = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    .split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

function makeWorld() {
  registerGameData()
  const streaming = new StreamingSystem(regions)
  const states = new WorldStates(stateTable)
  const worldState = new WorldState(worldstate, {
    hasFlag: (k) => streaming.hasFlag(k),
    setFlag: (k) => streaming.setFlag(k, true),
  })
  alive.push(() => { worldState.dispose(); states.dispose(); streaming.dispose() })
  return { streaming, states, worldState }
}

describe('选一床：数据说的四件事', () => {
  const two: RegionMusic = { explore: 'e', battle: 'b', ambience: 'mus_x_amb', ambienceVariants: [
    { suffix: 'first', condition: 'flag.a' },
    { suffix: 'second', condition: 'flag.b' },
  ] }

  it('次序就是优先级：第一条成立的赢（不是"最后一条"，也不是叠两层）', () => {
    expect(ambienceBedFor(two, (k) => k === 'flag.a' || k === 'flag.b')).toBe('mus_x_amb_first')
    expect(ambienceBedFor(two, (k) => k === 'flag.b')).toBe('mus_x_amb_second')
  })

  it('一条都不成立 ⇒ 基床（"没有变体"与"变体都没中"是同一句回答）', () => {
    expect(ambienceBedFor(two, () => false)).toBe('mus_x_amb')
    expect(ambienceBedFor(two, () => true)).toBe('mus_x_amb_first')
  })

  it('不写那一格 = 这一区没有变体，答案直接是基床', () => {
    const plain: RegionMusic = { explore: 'e', battle: 'b', ambience: 'mus_y_amb' }
    expect(ambienceBedFor(plain, () => true)).toBe('mus_y_amb')
  })

  it('`state.K==V` 那一形吃 stateOf：不递读方就等于那一行永远不成立（与刷怪闸门同一条纪律）', () => {
    const m: RegionMusic = { explore: 'e', battle: 'b', ambience: 'mus_z_amb', ambienceVariants: [
      { suffix: 'garrison', condition: 'state.haltrune.camp==GARRISON' },
    ] }
    expect(ambienceBedFor(m, () => false, () => 'GARRISON')).toBe('mus_z_amb_garrison')
    expect(ambienceBedFor(m, () => false, () => 'RUINS'), '定性变了 ⇒ 回到基床').toBe('mus_z_amb')
    expect(ambienceBedFor(m, () => false), '没有状态读方 ⇒ 不成立（宁可安静，不可猜）').toBe('mus_z_amb')
  })
})

describe('账在数据里：能选出的床 = 基床 ∪ 陈设派生的变体，且每一张都真在声床表里', () => {
  it('逐区把变体行现算成床 id，registry 必须读得到（读不到 = 条件成立那一拍装一张不存在的床）', () => {
    registerGameData()
    let declared = 0
    for (const rg of regions) {
      const variants = rg.music.ambienceVariants ?? []
      declared += variants.length
      for (const v of variants) {
        const id = `${rg.music.ambience}_${v.suffix}`
        expect(registry.get(id), `${rg.id} 的陈设声明了变体床 ${id}，但 ambience.json 里没有这一行`).toBeTruthy()
      }
    }
    expect(declared, '名册空了 = 上面那个循环在空转（§2.3/§2.4 两行都被删了？）').toBeGreaterThanOrEqual(2)
  })

  it('选床函数问过的旗与状态，恰好是陈设里那些条件点名的那些（组合根不再自备第二份名单）', () => {
    const namedFlags: string[] = []
    const namedStates: string[] = []
    for (const rg of regions) {
      const variants = rg.music.ambienceVariants ?? []
      if (variants.length === 0) continue
      // 构造一个「每一行都成立」的世界读数：`.every()` 只在项为假时短路，全真才会把**每一项**都问出口
      // ——这正是要量的普查性质（有一项从没被问过 = 它在旗/状态对账里隐形）。
      // 名单从数据现推（同一份判据），不在测试里重抄旗名：重抄就是 KI-341 要灭的那个第二主人。
      const flagTrue = new Map<string, boolean>()
      const stateValue = new Map<string, string>()
      for (const t of variants.flatMap((v) => readCondition(v.condition).flags)) {
        const want = !t.negated
        if (flagTrue.has(t.name)) {
          expect(flagTrue.get(t.name), `${rg.id}：旗 ${t.name} 同时被正向与取反点名 ⇒ 这条腿构造不出"全成立"的读数`).toBe(want)
        }
        flagTrue.set(t.name, want)
      }
      for (const s of variants.flatMap((v) => readCondition(v.condition).states)) {
        const want = s.op === '==' ? s.value : `${s.value}__不是它`
        if (stateValue.has(s.key)) {
          expect(stateValue.get(s.key), `${rg.id}：状态 ${s.key} 被两行同时要真与同时不要真 ⇒ 这条腿构造不出"全成立"的读数`).toBe(want)
        }
        stateValue.set(s.key, want)
      }
      const askedFlags: string[] = []
      const askedStates: string[] = []
      const bed = ambienceBedFor(
        rg.music,
        (k) => { askedFlags.push(k); return flagTrue.get(k) ?? false },
        (k) => { askedStates.push(k); return stateValue.get(k) ?? null }
      )
      expect(bed, `${rg.id}：第一行成立 ⇒ 按次序赢的那张`).toBe(`${rg.music.ambience}_${variants[0].suffix}`)
      expect([...new Set(askedFlags)].sort(), `${rg.id} 问的旗名与条件里点名的不一致`).toEqual(
        [...new Set(variants.flatMap((v) => conditionFlagNames(v.condition)))].sort()
      )
      expect([...new Set(askedStates)].sort(), `${rg.id} 问的状态键与条件里点名的不一致`).toEqual(
        [...new Set(variants.flatMap((v) => readCondition(v.condition).states.map((s) => s.key)))].sort()
      )
      namedFlags.push(...askedFlags)
      namedStates.push(...askedStates)
    }
    expect(new Set(namedFlags).size, '条件里一面旗都没点名 ⇒ 上面那些相等没有内容').toBeGreaterThanOrEqual(2)
    // 真表里两行变体点名的都是旗，**没有一行写状态** ⇒ 上面那句状态相等今天必然是 `[] == []`。
    // 它不是被这条地板兜住的：状态那一半边的问法由下面那条合成腿量（真数据里长出来那天，这条循环自动有内容）。
    expect(new Set(namedStates).size, '陈设的变体行里出现了状态点名 ⇒ 这条普查真的有内容了，把地板抬起来').toBe(0)
  })

  it('混合行的问法：旗与状态各问各的，两份名单都由条件现推（不许有一行从没被问过）', () => {
    // 排布是量出来的：第一行**不成立**（`!flag.meg_gone` 在旗立着时为假），选床才会走到第二行；
    // 第二行的旗项为真，`.every()` 才会继续问出那一项状态。反过来排 ⇒ 短路把后一半藏起来。
    const m: RegionMusic = { explore: 'e', battle: 'b', ambience: 'mus_w_amb', ambienceVariants: [
      { suffix: 'meg', condition: '!flag.meg_gone' },
      { suffix: 'drum', condition: 'flag.haltrune_drum && state.haltrune.fate==DRUM_LEGEND' },
    ] }
    const askedFlags: string[] = []
    const askedStates: string[] = []
    const bed = ambienceBedFor(
      m,
      (k) => { askedFlags.push(k); return true },
      (k) => { askedStates.push(k); return k === 'state.haltrune.fate' ? 'DRUM_LEGEND' : null }
    )
    expect(bed, '第一行不成立 ⇒ 按次序轮到第二行').toBe('mus_w_amb_drum')
    expect([...new Set(askedFlags)].sort(), '第一行的旗与第二行的旗都要问到').toEqual(['flag.haltrune_drum', 'flag.meg_gone'])
    expect([...new Set(askedStates)].sort(), '状态那一项问的是整段键（含 state. 前缀）').toEqual(['state.haltrune.fate'])
  })
})

describe('真世界上的两条线（读的是陈设的闸门，不是代码里再抄的一句）', () => {
  it('§2.4 更鼓：fate=DRUM_LEGEND ⇒ 营地选到更鼓变体，别的 fate 选基床', () => {
    const w = makeWorld()
    const camp = regions.find((r) => r.id === 'rg_brokenbar_camp')!
    const bed = () => ambienceBedFor(camp.music, (k) => w.streaming.hasFlag(k), (k) => w.states.get(k) ?? null)
    expect(bed()).toBe('mus_brokenbar_amb')
    w.states.set('state.haltrune.fate', 'PASSING_STILL')
    expect(bed(), '传说没成真 ⇒ 鼓不响').toBe('mus_brokenbar_amb')
    w.states.set('state.haltrune.fate', 'DRUM_LEGEND')
    expect(bed(), 'stateSet 规则派生旗 ⇒ 选床的答案换到变体').toBe('mus_brokenbar_amb_drum')
  })

  it('§2.3 盐歌：她在 ⇒ 人声垫片，她离场那一拍回到基床', () => {
    const w = makeWorld()
    const resthold = regions.find((r) => r.id === 'rg_resthold')!
    const bed = () => ambienceBedFor(resthold.music, (k) => w.streaming.hasFlag(k), (k) => w.states.get(k) ?? null)
    expect(bed()).toBe('mus_resthold_amb_meg')
    w.states.set('state.meg.ending', 'SILENCED')
    expect(bed(), '她被夺走声卷 ⇒ 垫片那层跟着没').toBe('mus_resthold_amb')
  })
})

describe('组合根不抄（KI-322③ 的那格残账结案）', () => {
  const MAIN = code('../../src/main.ts')

  it('main.ts 里一个旗名字面量都没有', () => {
    expect(MAIN, "组合根里出现了 'flag.…' 字面量 ⇒ 旗名又从陈设搬回代码了").not.toMatch(/['"`]flag\./)
  })

  it('床 id 的拼接只有一处主人（AmbienceSwitch），组合根不许再拼后缀', () => {
    expect(MAIN).toContain('ambienceBedFor(')
    expect(MAIN, '`ambienceBedOf` 又回来了 = 手抄那三个入口的第二版').not.toContain('ambienceBedOf')
    for (const suffix of ['_drum', '_meg']) {
      expect(MAIN, `组合根里出现了后缀 '${suffix}' ⇒ 变体床的账又从数据搬回代码`).not.toContain(suffix)
    }
    expect(MAIN, '按区 id 决定听什么 = 那一区的账分家了').not.toMatch(/=== 'rg_[a-z_]+'/)
  })

  it('换床的跟读块在换区 if **之外**（插进体内 = 只在跨区那一帧跑，她在场时离场就没有那一帧）', () => {
    const raw = readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)), 'utf8').split(/\r?\n/)
    const iIf = raw.findIndex((l) => l.includes('if (here && here.id !== shownRegion)'))
    const iTrack = raw.findIndex((l) => l.includes('const bedNow'))
    expect(iIf, '换区 if 在源码里').toBeGreaterThan(0)
    expect(iTrack, '每帧跟读块在源码里').toBeGreaterThan(iIf)
    const indent = (l: string): number => l.length - l.trimStart().length
    expect(indent(raw[iTrack]), `跟读块缩进（${indent(raw[iTrack])}）应与换区 if（${indent(raw[iIf])}）同级——深一级就是插进了 if 体内`)
      .toBe(indent(raw[iIf]))
  })

  it('比较的是"选出来的床"而不是"旗的值"：旗没变而床变了，也得换（两区共用一面旗的形状）', () => {
    const a: RegionMusic = { explore: 'e', battle: 'b', ambience: 'mus_a', ambienceVariants: [{ suffix: 'x', condition: 'flag.shared' }] }
    const b: RegionMusic = { explore: 'e', battle: 'b', ambience: 'mus_b', ambienceVariants: [{ suffix: 'x', condition: 'flag.shared' }] }
    const on = ambienceBedFor(a, () => true)
    const off = ambienceBedFor(b, () => false)
    expect(on, '两条腿分别给出各区的变体床').toBe('mus_a_x')
    expect(off).toBe('mus_b')
    expect(on === off, '床 id 各不相同 ⇒ 拿床比较比拿旗比较宽得对（旗相同不代表床相同）').toBe(false)
  })
})
