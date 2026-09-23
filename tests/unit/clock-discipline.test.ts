/**
 * 时钟纪律闸门（KI-017 第一步，2026-09-24）。
 *
 * 要守的东西只有一句话：`GameTime` 上有**两条**时标通道——循环逐 tick 交付的 `TICK_DT`（真实逻辑步）
 * 和 `time.dt`（被 hitStop 压到 5% 的动画步）。combat.md §9 末行规定了谁该走哪一条：
 * 「`global.timeScale=0` 仅冻结攻守双方动画时间；粒子/震镜/音效照常」。
 *
 * 这一步修的是"冻错了对象"：节拍钟此前喂 `t.dt`，于是每一次命中停顿都在把**整张拍网格**放慢 20 倍。
 * 量化读数见 technical-architecture.md 的 KI-017 条与 KNOWN_ISSUES 同一条目。
 * §9 前半句（真正冻住攻守双方动画）仍**未实现**——那是第二步，KI-017 保持 Partial。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { GameLoop } from '@/core/GameLoop'
import { GameTime, TICK_DT } from '@/core/Time'
import { RhythmClock } from '@/core/RhythmClock'
import { CameraRig } from '@/player/CameraRig'
import type { PlayerController } from '@/player/ThirdPersonController'
import type { Input } from '@/core/Input'

const SRC = fileURLToPath(new URL('../../src', import.meta.url))

const tsFiles = (dir: string): string[] => {
  if (dir.endsWith('.ts')) return [dir]
  const abs = `${SRC}/${dir}`
  let st
  try { st = readdirSync(abs, { withFileTypes: true }) } catch { return [] }
  const out: string[] = []
  for (const e of st) {
    if (e.isDirectory()) out.push(...tsFiles(`${dir}/${e.name}`))
    else if (e.name.endsWith('.ts')) out.push(`${dir}/${e.name}`)
  }
  return out
}

/** 假 Input：GameLoop 只用到 poll/endTick/frame 三个成员（与 flow 夹具同一口径） */
function fakeInput(): Input {
  return {
    frame: { move: { x: 0, y: 0 }, look: { dx: 0, dy: 0 }, held: new Set<string>(), edges: new Set<string>() },
    enabled: true,
    poll: () => {},
    endTick: () => {},
  } as unknown as Input
}

/** 走真 GameLoop 的步进：每帧喂一个真实 tick 的时长，返回这一帧走过的 tick 数 */
function stepLoop(loop: GameLoop, time: GameTime, ticks: number): number {
  let done = 0
  for (let i = 0; i < ticks; i++) {
    const t0 = time.tick
    loop.tickFrame(TICK_DT)
    if (time.tick > t0) done++
  }
  return done
}

describe('hitStop 只该压住动画时标，不该碰拍网格（§9 末行 / KI-017）', () => {
  it('源码闸门：全仓没有任何一处把被压缩的时标喂给节拍钟或震镜', () => {
    const offenders: string[] = []
    let seen = 0
    for (const rel of tsFiles('.')) {
      const lines = readFileSync(`${SRC}/${rel}`, 'utf8').replace(/\r\n/g, '\n').split('\n')
      lines.forEach((raw, i) => {
        const line = raw.trim()
        if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) return
        if (/rhythm\.update\(/.test(line)) {
          seen++
          if (/\bt\.dt\b|time\.dt\b|animSeconds|rawScale/.test(line)) offenders.push(`${rel}:${i + 1} ${line}`)
        }
        // 震镜那一路必须是显式第二个时标：缺省参数会让 shakeDt 退回 dt（=压缩时标），等于没修
        if (/rig\.update\(/.test(line)) {
          seen++
          if (!/, *TICK_DT *\)/.test(line.slice(line.indexOf('rig.update(')))) offenders.push(`${rel}:${i + 1} ${line}`)
        }
      })
    }
    expect(seen, '闸门必须真的扫到调用点，否则会退化成空测试').toBeGreaterThanOrEqual(2)
    expect(offenders).toEqual([])
  })

  it('真 GameLoop：停顿期间交付给系统的 dt 与 time.dt 已经分叉（20 倍）', () => {
    const time = new GameTime()
    const handed: number[] = []
    const loop = new GameLoop(time, fakeInput(), () => {})
    loop.add({ update: (dt) => { handed.push(dt) } })
    time.hitStop(5) // 5 秒长停顿，覆盖下面整段步进
    const ticks = stepLoop(loop, time, 20)
    expect(ticks, 'tick 计数照常走（停顿不冻结逻辑）').toBe(20)
    expect(handed.every((d) => d === TICK_DT), '系统拿到的每一步都是未压缩的 TICK_DT').toBe(true)
    expect(time.dt).toBeCloseTo(TICK_DT * 0.05, 10)
    expect(time.rawScale).toBe(0.05)
  })

  it('同样 20 tick：停顿内与停顿外前进的拍数相同（对照：旧口径只剩 5%）', () => {
    const bpm = 84
    const perTick = TICK_DT * (bpm / 60) // 一拍 = 60/84 秒 ⇒ 0.023333… 拍/tick
    const beatsOver = (useScaledDt: boolean, withHitStop: boolean): number => {
      const time = new GameTime()
      const rhythm = new RhythmClock()
      rhythm.setBpm(bpm, 4)
      const loop = new GameLoop(time, fakeInput(), () => {})
      if (withHitStop) time.hitStop(5)
      const t0 = rhythm.beat
      loop.add({
        update: () => { rhythm.update(useScaledDt ? time.dt : TICK_DT) },
      })
      stepLoop(loop, time, 20)
      return rhythm.beat - t0
    }
    const plain = beatsOver(false, false)
    const stopped = beatsOver(false, true)
    expect(stopped, '修好之后：停顿长短不该改变网格').toBeCloseTo(plain, 10)
    expect(plain).toBeCloseTo(20 * perTick, 10)
    // 负例——钉住"这条断言真的在量那件事"：旧口径（喂 time.dt）会掉到 5%
    const wrong = beatsOver(true, true)
    expect(wrong).toBeCloseTo(plain * 0.05, 6)
    expect(plain - wrong, '20 tick 内旧代码要丢 0.44 拍（≈1/4 拍，够把命中帧从拍点甩到拍间）').toBeGreaterThan(0.4)
  })

  it('震镜走 tick：停顿期间包络照常衰减，缺省参数（旧行为）会把波形挂住', () => {
    // node 里没有 window；CameraRig 构造只读视口比例，不建 WebGL 上下文
    Object.defineProperty(globalThis, 'innerWidth', { value: 1280, configurable: true })
    Object.defineProperty(globalThis, 'innerHeight', { value: 720, configurable: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const player = { pos: { x: 0, y: 0, z: 0 }, camYawRef: 0 } as any as PlayerController
    const shakeTicks = (passShakeDt: boolean): number => {
      const rig = new CameraRig()
      rig.shake('heavy') // decay = 0.4/3 s：走 tick 的话 60 tick（1s）后必然淘汰
      const dt = TICK_DT * 0.05 // 模拟一次长时间 hitStop 期间的每 tick 调用
      for (let i = 0; i < 60; i++) rig.update(dt, player, { dx: 0, dy: 0 }, null, passShakeDt ? TICK_DT : dt)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (rig as any).shakes.length
    }
    expect(shakeTicks(true), '震镜按真实秒衰减（§10 的包络定义在秒上）').toBe(0)
    expect(shakeTicks(false), '负例：喂压缩时标时波形几乎不走（这就是 §9 说的"不该照常"里唯独它没照常）').toBe(1)
  })
})
