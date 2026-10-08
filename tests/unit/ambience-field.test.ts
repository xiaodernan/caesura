import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { AmbienceField } from '@/audio/ambient-field'
import { AUDIBLE_FLOOR, spatialize } from '@/audio/spatial'
import type { AmbienceBed, AmbienceSource } from '@/data/schema'
import { FakeAudioContext, FakeNode } from '../support/fakeAudio'

/**
 * §4 的 L2／L3 声景层（KI-083）的行为面。
 *
 * 全部走 `tests/support/fakeAudio.ts`（那只替身只保证**图形状与调度可断言**，不保证"好听"——KI-010 同因）。
 * 这里直接喂 `AmbienceField` 合成源，不从 `ambience.json` 抄一行：拿真表验"跟着数据走"等于让实现自证。
 * 真表那一侧由 `ambience-table.test.ts` 与 `audio-engine.test.ts` 各管一半（判据 / id→行 的解析）。
 */

/** 一条合成源。默认 `everySec: [0, 0]` = 每帧都到点，所以"该不该掷"这件事在读数里不掺随机 */
const src = (patch: Partial<AmbienceSource> = {}): AmbienceSource => ({
  layer: 'texture',
  hz: 880,
  pos: { x: 0, y: 0, z: 0 },
  peak: 0.02,
  attackSec: 0.003,
  durSec: 0.3,
  everySec: [0, 0],
  ...patch,
})

const bedOf = (sources: AmbienceSource[], id = 'bed_a'): AmbienceBed => ({ id, layers: [], sources, bell: null })

/** 一只场 + 它的输出把手（那只把手在真机上就是 `MusicLayer` 的 ambGain） */
function rig() {
  const ctx = new FakeAudioContext()
  const out = ctx.createGain()
  const field = new AmbienceField(ctx as unknown as AudioContext, out as unknown as AudioNode)
  return { ctx, out, field }
}

const panners = (ctx: FakeAudioContext): FakeNode[] => ctx.nodes.filter((n) => n.kind === 'panner')
const bands = (ctx: FakeAudioContext): FakeNode[] => ctx.nodes.filter((n) => n.kind === 'biquad')

describe('声景层：一条源到点掷一声（KI-083）', () => {
  it('到点就掷：一条带通噪声 + 一只声像，增益 = 那只源此刻的距离衰减', () => {
    const { ctx, out, field } = rig()
    const before = ctx.nodes.length
    field.setBed(bedOf([src()]))
    field.update()
    expect(ctx.count('bufferSource'), '到点了却一声没响（§4 的 L2/L3 又变回零读者）').toBe(1)
    const band = bands(ctx)[0]
    expect(band.type, '声景不是带通噪声爆 = 与 §4「颗粒声纹／物理动源」不是同一件事').toBe('bandpass')
    expect(band.params.frequency.events[0]?.value, '带通中心不是数据里那一格 hz').toBeCloseTo(880, 6)
    const sp = panners(ctx)[0]
    expect(sp, '声源没有声像：§4 要的"真位置"没了').toBeTruthy()
    // 输出把手上这时挂着两样：这一声的声像，以及给那两只把手收尾的那只哑源（见最后一条用例）
    expect(ctx.live(out), '这一声没接到输出把手上').toBe(2)
    // 源就在听者身上 ⇒ 满衰减、正前方
    expect(sp.params.pan.value).toBeCloseTo(0, 6)
    expect(ctx.nodes.slice(before).length, '这一声建了 6 只节点：噪声源/带通/包络/衰减/声像/收尾哑源').toBe(6)
  })

  it('没到点一声都不掷：间隔大的一格在时间推进之前保持安静，推进之后照掷', () => {
    const { ctx, field } = rig()
    field.setBed(bedOf([src({ everySec: [10, 10] })]))
    field.setListener({ x: 0, y: 0, z: 0, yaw: 0 })
    field.update()
    expect(ctx.count('bufferSource'), '间隔 10 秒的那条源第一帧就响了').toBe(0)
    ctx.advance(9.9)
    field.update()
    expect(ctx.count('bufferSource'), '还差 0.1 秒就响了 = 间隔那一格没被读').toBe(0)
    ctx.advance(0.2)
    field.update()
    expect(ctx.count('bufferSource'), '到点了还是没响').toBe(1)
  })

  it('两条层在同一张床上是两种音色：texture 窄带固定，motion 宽带且一声之内边扫', () => {
    const { ctx, field } = rig()
    field.setBed(bedOf([src({ layer: 'texture', hz: 1500 }), src({ layer: 'motion', hz: 320 })]))
    field.update()
    const [tex, mot] = bands(ctx)
    expect(ctx.count('bufferSource'), '两条源该各掷一声').toBe(2)
    expect(tex.params.frequency.events.length, 'texture 是"一颗脆点"：带通中心一声之内不动').toBe(1)
    expect(mot.params.frequency.events.length, 'motion 是"有东西在动"：一声之内中心要滑一次').toBe(2)
    expect(mot.params.frequency.events[1].kind).toBe('exp')
    expect(mot.params.frequency.events[1].value).toBeLessThan(mot.params.frequency.events[0].value)
    expect(mot.params.Q.value, '两层用同一个 Q 就等于这一层没有形态差别').not.toBe(tex.params.Q.value)
  })
})

describe('声景层：位置那一格（§4「真位置」）', () => {
  it('声像与衰减与一次性 SFX 走的是同一份数学（同一个位置、同一个听者 ⇒ 同一个读数）', () => {
    const { ctx, field } = rig()
    const pose = { x: 0, y: 0, z: 0, yaw: Math.PI / 2 }
    const at = { x: 12, y: 0, z: -5 }
    field.setListener(pose)
    field.setBed(bedOf([src({ pos: at })]))
    field.update()
    const sp = panners(ctx)[0]
    const g = ctx.edges.find((e) => e.to === sp)?.from as FakeNode
    const want = spatialize(at, pose)
    expect(sp.params.pan.value).toBeCloseTo(want.pan, 6)
    expect(g.params.gain.value, '衰减没写进这只源自己的增益').toBeCloseTo(want.att, 6)
  })

  it('听不见的源不建节点（att < 0.02 就跳过），走近之后照掷——跳过不是丢件', () => {
    const { ctx, field } = rig()
    const far = src({ pos: { x: 0, y: 0, z: -400 } })
    field.setBed(bedOf([far]))
    const n0 = ctx.nodes.length
    field.update()
    expect(ctx.nodes.length, '140 格外的声景照样建图 = 白烧一个声部').toBe(n0)
    expect(spatialize(far.pos, { x: 0, y: 0, z: 0, yaw: 0 }).att, '这一条的前提是它真的听不见').toBeLessThan(AUDIBLE_FLOOR)
    field.setListener({ x: 0, y: 0, z: -390, yaw: 0 })
    field.update()
    expect(ctx.count('bufferSource'), '走近之后那条源没恢复 = 跳过变成了丢件').toBe(1)
  })

  it('高度差算进衰减（头顶与脚下不是同一个距离）——斜距而不是水平距离', () => {
    const { ctx, field } = rig()
    field.setListener({ x: 0, y: 30, z: 0, yaw: 0 })
    field.setBed(bedOf([src({ pos: { x: 0, y: 0, z: 0 } })]))
    field.update()
    const sp = panners(ctx)[0]
    const g = ctx.edges.find((e) => e.to === sp)?.from as FakeNode
    expect(g.params.gain.value, '30m 的高度差被读成了 0m').toBeCloseTo(spatialize({ x: 0, y: 0, z: 0 }, { x: 0, y: 30, z: 0, yaw: 0 }).att, 6)
    expect(g.params.gain.value).toBeLessThan(0.5)
  })
})

describe('声景层：换床与收尾', () => {
  it('换床不抹已经在飞的那一声，下一声就属于新区（不是 crossfade，是"下一颗归谁"）', () => {
    const { ctx, field } = rig()
    field.setBed(bedOf([src({ hz: 1500 })]))
    field.update()
    const inFlight = ctx.live(ctx.nodes[0])
    field.setBed(bedOf([src({ hz: 320 })], 'bed_b'))
    expect(ctx.live(ctx.nodes[0]), '换床把已经在响的那一声一起摘了（KI-066：不许篡改时间线）').toBe(inFlight)
    field.update()
    const second = bands(ctx)[1]
    expect(second.params.frequency.events[0].value, '换床之后的下一声还是旧区的源').toBeCloseTo(320, 6)
  })

  it('同一张床重发：下一次的时刻不重掷（与 `applyBed` 的"重发不动图"同一口径）', () => {
    const { ctx, field } = rig()
    const bed = bedOf([src({ everySec: [10, 10] })])
    field.setBed(bed)
    field.setBed(bed)
    ctx.advance(10.1)
    field.update()
    expect(ctx.count('bufferSource'), '重发把倒计时按回了 10 秒 = 同一张床重发有了可观测的副作用').toBe(1)
  })

  it('响完自己收线：这一声的两只把手断开、输出把手上不留东西（KI-071 那本账）', () => {
    const { ctx, out, field } = rig()
    field.setBed(bedOf([src()]))
    field.update()
    const sp = panners(ctx)[0]
    const g = ctx.edges.find((e) => e.to === sp)?.from as FakeNode
    expect(ctx.live(out), '响之前就没接上').toBe(2) // 声像 + 收尾哑源
    ctx.endAll()
    expect(sp.disconnected, '声像用完没摘').toBe(1)
    expect(g.disconnected, '衰减增益用完没摘').toBe(1)
    expect(ctx.live(out), '响完输出把手上还挂着东西 = 每响一声留一条链').toBe(0)
  })
})

describe('判据只有一个主人：位置数学住 `spatial.ts`，音色参数一个都不在代码里', () => {
  const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')

  it('一次性 SFX 与声景层**都**走 `spatialize(`，没有第二份声像/衰减算式', () => {
    const engine = read('../../src/audio/AudioEngine.ts')
    const fieldSrc = read('../../src/audio/ambient-field.ts')
    for (const [name, code] of [['AudioEngine.ts', engine], ['ambient-field.ts', fieldSrc]] as const) {
      expect(code, `${name} 不再走 spatialize = 两条读者各算一份`).toContain('spatialize(')
    }
    for (const [name, code] of [['AudioEngine.ts', engine], ['ambient-field.ts', fieldSrc]] as const) {
      expect(code, `${name} 里出现了第二份衰减算式（12 与 1.8 那两格）`).not.toContain('Math.pow(dist / 16')
    }
    const spatial = read('../../src/audio/spatial.ts')
    expect(spatial, '声像的钳位式不在 spatial.ts 里了：那个"唯一主人"的名字已经名不副实').toContain('Math.max(-1, Math.min(1,')
    // 上界只有一个主人：`PAN_MAX` 被读者用，而不是各处再写一遍 0.85
    expect(fieldSrc.includes('0.85'), '声景层里写死了声像上限 = 第二个主人').toBe(false)
  })

  it('`AmbienceField` 里没有任何一条属于数据的数：hz/peak/attackSec/durSec/everySec 全部现读', () => {
    const code = read('../../src/audio/ambient-field.ts').split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    for (const field of ['src.hz', 'src.peak', 'src.attackSec', 'src.durSec', 'src.everySec', 'src.pos']) {
      expect(code, `\`${field}\` 没被读 = 那一格是死数据`).toContain(field)
    }
  })
})


/**
 * §5.9.33③ 声景增益腿（`weather.json > gameplay.ambienceGain`）。
 *
 * 乘在**距离衰减之后**：`spatialize` 那条数学是全部 SFX 与声景层共用的唯一主人（KI-083），
 * 在这里改它就等于给一次性音效也加上天气脾气。要放大的是"这一格天气的声景"，不是距离模型。
 */
describe('声景层：天气增益（§5.9.33③ 音频腿）', () => {
  it('缺省 1：不调用 setWeatherGain 时增益就是距离衰减本身', () => {
    const { ctx, field } = rig()
    field.setListener({ x: 0, y: 0, z: 0, yaw: 0 })
    field.setBed(bedOf([src({ pos: { x: 0, y: 0, z: -16 } })]))
    field.update()
    const sp = panners(ctx)[0]
    const g = ctx.edges.find((e) => e.to === sp)?.from as FakeNode
    expect(g.params.gain.value).toBeCloseTo(spatialize({ x: 0, y: 0, z: -16 }, { x: 0, y: 0, z: 0, yaw: 0 }).att, 10)
  })

  it('1.5 ⇒ 每一声的增益 = 距离衰减 × 1.5（16m 处 att=0.5 ⇒ 0.75）', () => {
    const { ctx, field } = rig()
    const pose = { x: 0, y: 0, z: 0, yaw: 0 }
    field.setListener(pose)
    field.setBed(bedOf([src({ pos: { x: 0, y: 0, z: -16 } })]))
    field.setWeatherGain(1.5)
    field.update()
    const sp = panners(ctx)[0]
    const g = ctx.edges.find((e) => e.to === sp)?.from as FakeNode
    expect(g.params.gain.value).toBeCloseTo(0.75, 10)
  })

  it('已经在飞的那一声不被新增益改写（只影响下一声：KI-066 不篡改时间线）', () => {
    const { ctx, field } = rig()
    field.setListener({ x: 0, y: 0, z: 0, yaw: 0 })
    field.setBed(bedOf([src({ pos: { x: 0, y: 0, z: -16 } })]))
    field.update()
    const first = ctx.edges.find((e) => e.to === panners(ctx)[0])?.from as FakeNode
    const before = first.params.gain.value
    field.setWeatherGain(2)
    expect(first.params.gain.value, '已经排出去的那一声被回头改了').toBeCloseTo(before, 10)
    ctx.advance(10)
    field.update()
    const second = ctx.edges.find((e) => e.to === panners(ctx)[1])?.from as FakeNode
    expect(second.params.gain.value).toBeCloseTo(before * 2, 10)
  })

  it('≤0 按 1 收（增益 0 是把声景层静音，而"这一腿不生效"的写法是不调用它）', () => {
    const { ctx, field } = rig()
    field.setListener({ x: 0, y: 0, z: 0, yaw: 0 })
    field.setBed(bedOf([src({ pos: { x: 0, y: 0, z: -16 } })]))
    field.setWeatherGain(0)
    field.update()
    const sp = panners(ctx)[0]
    const g = ctx.edges.find((e) => e.to === sp)?.from as FakeNode
    expect(g.params.gain.value).toBeCloseTo(spatialize({ x: 0, y: 0, z: -16 }, { x: 0, y: 0, z: 0, yaw: 0 }).att, 10)
  })
})
