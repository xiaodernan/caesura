import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { registerGameData, regions, worldstate, worldStates as stateTable } from '@/data'
import { StreamingSystem } from '@/world/Streaming'
import { WorldState } from '@/quest/WorldState'
import { WorldStates } from '@/quest/WorldStates'
import { registry } from '@/core/Registry'
import { ambienceBedFor } from '@/world/AmbienceSwitch'

/**
 * §2.3「她在唱歌时，休垒全 BGM 加一层人声垫片——全游戏最温柔的旗帜」的机器形状：
 * 声床表里的变体行（`mus_resthold_amb_meg` = 同一张床 + 220Hz 慢呼吸正弦垫片）与
 * 组合根的三个入口（开局 / 换区 / **她在玩家站着的时候离场**——没有换区事件可借，
 * 渲染循环自己跟旗换床）。垫片层的人声区与「加一层不是换一张」的音量关系也钉在这里。
 *
 * KI-341 起，「哪一区的哪张床在什么条件下换成哪张变体」是**陈设那一份数据**说的
 * （`regions.json` 的 `music.ambienceVariants`）；这里的源码门反过来钉「组合根不许
 * 再抄一遍旗名或后缀」，行为腿一律走 `ambienceBedFor` 真调用，不重抄谓词。
 */

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

const MAIN = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')

describe('盐歌在场的人声垫片：变体床与三个入口', () => {
  it('变体行存在且是「同一张床加一层」：层集为超集、主音相同、垫片在人声区且音量低于主 drone', () => {
    registerGameData()
    const base = registry.get<{ id: string; layers: Array<{ hz: number; peak: number }> }>('mus_resthold_amb')
    const meg = registry.get<{ id: string; layers: Array<{ hz: number; peak: number }> }>('mus_resthold_amb_meg')
    const baseHzs = base.layers.map((l) => l.hz).sort((a, b) => a - b)
    const megHzs = meg.layers.map((l) => l.hz).sort((a, b) => a - b)
    expect(megHzs.slice(0, baseHzs.length), '基床的每一条层都还在（加一层，不是换一张）').toEqual(baseHzs)
    expect(Math.min(...megHzs), '主音（最低层）不变——同一区的调性不因她在不在而换').toBe(Math.min(...baseHzs))
    const pad = meg.layers.filter((l) => !base.layers.some((b) => b.hz === l.hz && b.peak === l.peak))
    expect(pad.length, '变体多出来的就是垫片层').toBeGreaterThanOrEqual(1)
    for (const p of pad) {
      expect(p.hz).toBeGreaterThanOrEqual(180) // 人声低区（A3≈220），不是又一条 bass drone
      expect(p.peak, '垫片音量低于主 drone（加一层不是盖过去）').toBeLessThan(0.05)
    }
  })

  it('选床的账在陈设里（KI-341 起源码门反向钉）：休垒那一行声明后缀与闸门，组合根里不抄旗名/后缀', () => {
    registerGameData()
    const resthold = regions.find((r) => r.id === 'rg_resthold')!
    expect(resthold.music.ambienceVariants, '休垒的变体行').toEqual([{ suffix: 'meg', condition: '!flag.meg_gone' }])
    const code = MAIN.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    expect(code).toContain('ambienceBedFor(')
    expect(code, "组合根里出现 'flag.…' 字面量 ⇒ 旗名又从陈设搬回代码（KI-322③ 那格残账复活）").not.toMatch(/['"`]flag\./)
    expect(code, '后缀 `_meg` 又有人在代码里拼 ⇒ `${ambience}_${suffix}` 长了第二个主人').not.toContain('_meg')
    expect(code, '按区 id 决定听什么 ⇒ 那一区的账分家').not.toMatch(/=== 'rg_[a-z_]+'/)
  })

  it('跟旗块必须在换区 if **之外**（第一版就插在了 if 里：换区块只在跨区那一帧跑，她离场没有那一帧）', () => {
    // 源码门（KI-058 手法）：每帧跟读那行（`const bedNow`）的缩进必须与 `if (here && here.id !== shownRegion)`
    // 同级，而不是它的体内（体内 = 4 空格更深）。这条门钉的是「每帧跟床」这个设计，不是排版洁癖。
    const lines = MAIN.split('\n')
    const iIf = lines.findIndex((l) => l.includes('if (here && here.id !== shownRegion)'))
    const iTrack = lines.findIndex((l) => l.includes('const bedNow'))
    expect(iIf, '换区 if 在源码里').toBeGreaterThan(0)
    expect(iTrack, '每帧跟读块在源码里').toBeGreaterThan(iIf)
    const ifIndent = lines[iIf].length - lines[iIf].trimStart().length
    const trackIndent = lines[iTrack].length - lines[iTrack].trimStart().length
    expect(trackIndent, `跟读块缩进（${trackIndent}）应与换区 if（${ifIndent}）同级——深一级就是插进了 if 体内，只在跨区帧跑`).toBe(ifIndent)
  })

  it('第三入口的行为账：她离场那一拍改变的是选床的答案（换床不换区），走到真链上量', () => {
    registerGameData()
    const streaming = new StreamingSystem(regions)
    const states = new WorldStates(stateTable)
    const worldState = new WorldState(worldstate, {
      hasFlag: (k) => streaming.hasFlag(k),
      setFlag: (k) => streaming.setFlag(k, true)
    })
    alive.push(() => { worldState.dispose(); states.dispose(); streaming.dispose() })
    // 玩家站在休垒（regionAt 为真）——她被夺走声卷的那一拍
    expect(streaming.regionAt({ x: 0, y: 0, z: 0 })?.id).toBe('rg_resthold')
    const resthold = regions.find((r) => r.id === 'rg_resthold')!
    const bed = () => ambienceBedFor(resthold.music, (k) => streaming.hasFlag(k), (k) => states.get(k) ?? null)
    expect(bed(), '她还在 ⇒ 休垒听的是加了一层人声的那张床').toBe('mus_resthold_amb_meg')
    states.set('state.meg.ending', 'SILENCED')
    expect(streaming.hasFlag('flag.meg_gone'), 'stateSet 派生链在跑').toBe(true)
    // 换床的发射由渲染循环的旗跟块做（源码门已钉）——这里量的是「她的离场确实改变了选床的答案」：
    // 答案由陈设那行变体声明推导，不在测试里重抄一遍谓词（重抄 = 第二个主人，KI-341 要灭的就是它）。
    expect(bed(), '她离场那一拍，选床的答案从变体回到基床').toBe('mus_resthold_amb')
  })
})
