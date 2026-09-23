/**
 * synth.ts — 程序化 SFX 合成原语 + SFX key 全集（Phase 1 战斗原型）
 * 规格来源：docs/audio.md §3（钟/鼓参数级合成）、§7（SFX 类别表）。
 * 零采样文件、禁 import three；所有节点即用即弃（onended 时断开）。
 */

export type SfxKey =
  | 'swing_1' | 'swing_2' | 'swing_heavy_1' | 'swing_heavy_2' | 'thrust_1'
  | 'chord_slam' | 'land_slam' | 'ring_dust' | 'gnash' | 'burst_shell'
  | 'claw' | 'claw_heavy' | 'wail' | 'drum_sweep' | 'drum_boom'
  | 'execute_rest'
  | 'bell_toll' | 'bell_clang'
  | 'hit_flesh' | 'hit_metal' | 'parry_bell' | 'perfect_block' | 'block_guard'
  | 'player_hurt' | 'death_shatter' | 'lockon_on' | 'lockon_off' | 'footstep'
  | 'ui_move' | 'ui_select' | 'boss_roar'
  | 'loot_chime' | 'gate_creak' | 'bowstring'

/* ------------------------------------------------------------------ */
/* 基础原语                                                             */
/* ------------------------------------------------------------------ */

const NOISE_CACHE = new WeakMap<AudioContext, AudioBuffer>()

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  let buf = NOISE_CACHE.get(ctx)
  if (!buf) {
    buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    NOISE_CACHE.set(ctx, buf)
  }
  return buf
}

/** attack 线性上升 + decay 指数衰减包络（docs §3.1 钟包络通用形态） */
export function applyEnv(p: AudioParam, t: number, peak: number, attack: number, decay: number): void {
  const pk = Math.max(1e-4, peak)
  p.setValueAtTime(1e-4, t)
  p.linearRampToValueAtTime(pk, t + attack)
  p.exponentialRampToValueAtTime(1e-4, t + attack + decay)
}

function disposeOnEnd(endNode: AudioScheduledSourceNode, chain: AudioNode[]): void {
  endNode.onended = () => { for (const n of chain) { try { n.disconnect() } catch { /* already gone */ } } }
}

export interface NoiseOpts {
  type?: BiquadFilterType
  f0: number
  f1?: number
  Q?: number
  attack?: number
  decay: number
  peak: number
}

/** 噪声爆发（带通/低通/高通 + 频率扫移 + 指数衰减） */
export function playNoise(ctx: AudioContext, out: AudioNode, t: number, o: NoiseOpts): number {
  const attack = o.attack ?? 0.003
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx)
  src.loop = true
  const f = ctx.createBiquadFilter()
  f.type = o.type ?? 'bandpass'
  f.Q.value = o.Q ?? 1
  f.frequency.setValueAtTime(Math.max(30, o.f0), t)
  if (o.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f1), t + attack + o.decay)
  const g = ctx.createGain()
  applyEnv(g.gain, t, o.peak, attack, o.decay)
  src.connect(f).connect(g).connect(out)
  const end = t + attack + o.decay
  src.start(t, Math.random() * 1.5)
  src.stop(end + 0.02)
  disposeOnEnd(src, [g, f])
  return end
}

export interface SweepOpts {
  f0: number
  f1?: number
  dur: number
  attack?: number
  peak: number
  type?: OscillatorType
}

/** 指数滑音正弦（鼓皮/次声锤击，docs §3.1 'sine 55Hz→28Hz pitch drop'） */
export function playSweep(ctx: AudioContext, out: AudioNode, t: number, o: SweepOpts): number {
  const attack = o.attack ?? 0.002
  const osc = ctx.createOscillator()
  osc.type = o.type ?? 'sine'
  osc.frequency.setValueAtTime(Math.max(1, o.f0), t)
  if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + attack + o.dur)
  const g = ctx.createGain()
  applyEnv(g.gain, t, o.peak, attack, o.dur)
  osc.connect(g).connect(out)
  osc.start(t)
  osc.stop(t + attack + o.dur + 0.02)
  disposeOnEnd(osc, [g])
  return t + attack + o.dur
}

export interface FMOpts {
  f0: number
  f1?: number
  modRatio?: number
  index: number
  dur: number
  attack?: number
  peak: number
  type?: OscillatorType
}

/** FM 振荡器（载波正弦 + 调制正弦→载波频率），金属/嘶吼通用 */
export function playFM(ctx: AudioContext, out: AudioNode, t: number, o: FMOpts): number {
  const attack = o.attack ?? 0.002
  const modRatio = o.modRatio ?? 2.4
  const car = ctx.createOscillator()
  car.type = o.type ?? 'sine'
  car.frequency.setValueAtTime(Math.max(1, o.f0), t)
  if (o.f1 !== undefined) car.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + attack + o.dur)
  const mod = ctx.createOscillator()
  mod.frequency.value = Math.max(1, o.f0 * modRatio)
  const modGain = ctx.createGain()
  modGain.gain.value = o.f0 * o.index
  const g = ctx.createGain()
  applyEnv(g.gain, t, o.peak, attack, o.dur)
  mod.connect(modGain).connect(car.frequency)
  car.connect(g).connect(out)
  car.start(t); mod.start(t)
  const end = t + attack + o.dur
  car.stop(end + 0.02); mod.stop(end + 0.02)
  disposeOnEnd(car, [g, modGain])
  return end
}

/** 钟非谐泛音比（docs §3.1：拒绝弦乐整数比=一听即钟） */
const BELL_RATIOS = [1, 2.0, 2.4, 3.04, 4.5, 5.73]

export interface BellOpts {
  dur?: number
  peak?: number
  hammer?: boolean
}

/**
 * FM 加性钟 SYN_BELL：6 条非谐正弦泛音，decay 按序号 6s/i^1.3（高泛音先死=金属感），
 * 每次随机 detune ±8 cents + 部分激发随机（禁止两敲完全相同），敲击瞬态=带通噪声 2.2k/30ms + 次声锤 55→28Hz。
 */
export function playBell(ctx: AudioContext, out: AudioNode, t: number, base: number, o: BellOpts = {}): number {
  const dur = o.dur ?? 3
  const peak = o.peak ?? 0.25
  let maxEnd = t
  for (let i = 0; i < BELL_RATIOS.length; i++) {
    const d = Math.max(0.05, dur / Math.pow(i + 1, 1.3))
    const cents = (Math.random() * 16 - 8) / 1200
    const f = base * BELL_RATIOS[i] * (1 + cents)
    const excite = i === 0 ? 1 : (0.35 + Math.random() * 0.65) / (1 + i * 0.8)
    const end = playSweep(ctx, out, t, { f0: f, dur: d, attack: 0.002, peak: peak * excite })
    if (end > maxEnd) maxEnd = end
  }
  // FM 加性混合的一条亮边（docs §3.1 '6 op FM 载波' 的低成本近似）
  maxEnd = Math.max(maxEnd, playFM(ctx, out, t, { f0: base * 2, modRatio: 3.04, index: 2.5, dur: dur * 0.4, peak: peak * 0.18 }))
  if (o.hammer !== false) {
    playNoise(ctx, out, t, { f0: 2200, Q: 1.4, decay: 0.03, peak: peak * 0.5 })          // 敲击瞬态
    playSweep(ctx, out, t, { f0: 55, f1: 28, dur: 0.04, peak: peak * 0.7 })              // 次声锤击
  }
  return maxEnd - t + 0.05
}

/** 波形折叠失真（waveshaper，boss_roar/嘶吼用） */
function makeDistortionCurve(k: number): Float32Array<ArrayBuffer> {
  const n = 512
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(x * k) / Math.tanh(k)
  }
  return curve
}

/* ------------------------------------------------------------------ */
/* SFX key 全集（与 movesets.json / enemies.json 的 sfx 字段一致）        */
/* ------------------------------------------------------------------ */

type VoiceFn = (ctx: AudioContext, out: AudioNode, t: number, g: number) => number

const rnd = (a: number, b: number): number => a + Math.random() * (b - a)

const VOICES: Record<SfxKey, VoiceFn> = {
  // —— §5.4 破处决：音叉巨剑消音。全混音最响的席位（-6dB），也是唯一一条「让声音死」的声音 ——
  execute_rest: (c, o, t, g) => {
    playSweep(c, o, t, { f0: 2100, f1: 120, dur: 0.12, peak: 0.5 * g }) // 音叉被按停：音高一路塌下去
    playNoise(c, o, t, { type: 'lowpass', f0: 1800, f1: 90, decay: 0.16, peak: 0.3 * g }) // 空气被抽走
    playSweep(c, o, t + 0.09, { f0: 68, f1: 42, dur: 0.5, peak: 0.42 * g }) // 落到胸腔里的那一下
    return 0.62
  },
  // —— 玩家武器 telegraph（调律剑：纯净"咻"，docs §7.2）——
  swing_1: (c, o, t, g) => {
    playNoise(c, o, t, { f0: 800, f1: 2400, Q: 0.8, decay: 0.12, peak: 0.22 * g })
    playSweep(c, o, t + 0.05, { f0: 2800, dur: 0.28, peak: 0.025 * g }) // 音叉尾振
    return 0.4
  },
  swing_2: (c, o, t, g) => {
    playNoise(c, o, t, { f0: 1100, f1: 2600, Q: 0.9, decay: 0.14, peak: 0.24 * g })
    playSweep(c, o, t + 0.06, { f0: 3100, dur: 0.24, peak: 0.02 * g })
    return 0.42
  },
  // —— 强音大剑：低频撕裂 200→600Hz 250ms + 和弦蓄力鸣响 ——
  swing_heavy_1: (c, o, t, g) => {
    playNoise(c, o, t, { type: 'lowpass', f0: 600, f1: 200, Q: 1.2, decay: 0.25, peak: 0.4 * g })
    playSweep(c, o, t, { f0: 110, f1: 60, dur: 0.22, peak: 0.18 * g })
    return 0.45
  },
  swing_heavy_2: (c, o, t, g) => {
    playNoise(c, o, t, { type: 'lowpass', f0: 700, f1: 180, Q: 1.4, decay: 0.28, peak: 0.42 * g })
    playFM(c, o, t + 0.02, { f0: 140, f1: 70, modRatio: 1.5, index: 4, dur: 0.24, peak: 0.14 * g })
    return 0.5
  },
  thrust_1: (c, o, t, g) => {
    playNoise(c, o, t, { f0: 1400, f1: 3200, Q: 2, decay: 0.07, peak: 0.2 * g })
    return 0.15
  },
  chord_slam: (c, o, t, g) => {
    // 三音鸣响（C-Eb-G）钟式齐击
    const notes = [392, 466.16, 622.25]
    for (const f of notes) playBell(c, o, t + rnd(0, 0.015), f, { dur: 1.1, peak: 0.11 * g })
    playSweep(c, o, t, { f0: 130, f1: 50, dur: 0.15, peak: 0.25 * g })
    return 1.25
  },
  land_slam: (c, o, t, g) => {
    playSweep(c, o, t, { f0: 160, f1: 45, dur: 0.18, peak: 0.55 * g }) // 大鼓体感（§3.3）
    playNoise(c, o, t, { type: 'lowpass', f0: 300, decay: 0.08, peak: 0.35 * g })
    return 0.35
  },
  ring_dust: (c, o, t, g) => {
    playNoise(c, o, t, { type: 'lowpass', f0: 250, f1: 110, Q: 0.7, decay: 0.6, peak: 0.22 * g })
    playSweep(c, o, t, { f0: 70, f1: 48, dur: 0.5, peak: 0.16 * g })
    playBell(c, o, t + 0.05, 2093, { dur: 0.8, peak: 0.015 * g, hammer: false })
    return 0.95
  },
  // —— 喧堕者：gnash 磨牙、burst_shell 壳爆、claw 爪、wail 哀鸣 ——
  gnash: (c, o, t, g) => {
    playNoise(c, o, t, { f0: 2400, f1: 1500, Q: 8, decay: 0.16, peak: 0.22 * g })
    playFM(c, o, t, { f0: 190, f1: 150, modRatio: 2.7, index: 6, dur: 0.14, type: 'sawtooth', peak: 0.1 * g })
    playNoise(c, o, t + 0.07, { f0: 1800, f1: 2600, Q: 6, decay: 0.09, peak: 0.14 * g })
    return 0.25
  },
  burst_shell: (c, o, t, g) => {
    playNoise(c, o, t, { type: 'highpass', f0: 1200, decay: 0.22, peak: 0.3 * g })
    playSweep(c, o, t, { f0: 200, f1: 60, dur: 0.14, peak: 0.3 * g })
    for (let i = 0; i < 4; i++) playSweep(c, o, t + rnd(0.02, 0.2), { f0: rnd(1200, 4200), dur: 0.1, peak: 0.05 * g })
    return 0.55
  },
  claw: (c, o, t, g) => {
    playNoise(c, o, t, { f0: 2000, f1: 5000, Q: 1.2, decay: 0.09, peak: 0.28 * g })
    return 0.18
  },
  claw_heavy: (c, o, t, g) => {
    playNoise(c, o, t, { f0: 1600, f1: 4200, Q: 1.4, decay: 0.13, peak: 0.3 * g })
    playSweep(c, o, t, { f0: 120, f1: 48, dur: 0.16, peak: 0.3 * g })
    return 0.32
  },
  wail: (c, o, t, g) => {
    // 单声部 gliss：上行 2 半音再落回（docs §3.4 哀鸣点缀）
    playFM(c, o, t, { f0: 523, f1: 700, modRatio: 1.5, index: 3.5, dur: 0.3, peak: 0.12 * g })
    playFM(c, o, t + 0.28, { f0: 700, f1: 300, modRatio: 1.6, index: 5, dur: 0.55, peak: 0.14 * g })
    playNoise(c, o, t + 0.1, { f0: 900, f1: 500, Q: 3, decay: 0.6, peak: 0.03 * g })
    return 1.0
  },
  /** 针喉拉弦/拨弦（§14.4：场上最强听觉信号）=窄带瞬态 + 两根快死弦音 + 琴身低鸣 */
  bowstring: (c, o, t, g) => {
    playNoise(c, o, t, { f0: 2600, f1: 1500, Q: 9, decay: 0.05, peak: 0.3 * g })       // 指尖离弦
    playSweep(c, o, t, { f0: 494 * rnd(0.99, 1.01), f1: 440, dur: 0.22, peak: 0.16 * g })
    playSweep(c, o, t + 0.004, { f0: 740 * rnd(0.99, 1.01), dur: 0.13, peak: 0.09 * g })
    playFM(c, o, t, { f0: 165, f1: 110, modRatio: 2.02, index: 2.4, dur: 0.3, peak: 0.12 * g }) // 共鸣腔
    return 0.5
  },
  // —— 奥斯塔拉鼓组（§3.3）：drum_boom 驼鼓低频要有体感 ——
  drum_sweep: (c, o, t, g) => {
    playSweep(c, o, t, { f0: 90, f1: 230, dur: 0.32, peak: 0.4 * g })   // 上行军鼓扫
    playNoise(c, o, t, { type: 'highpass', f0: 800, decay: 0.3, peak: 0.12 * g })
    return 0.5
  },
  drum_boom: (c, o, t, g) => {
    playSweep(c, o, t, { f0: 160, f1: 44, dur: 0.42, peak: 0.7 * g })   // sine 160→48 指数滑
    playSweep(c, o, t, { f0: 75, f1: 40, dur: 0.5, peak: 0.35 * g })    // 体感次声垫
    playNoise(c, o, t, { type: 'lowpass', f0: 300, decay: 0.015, peak: 0.3 * g }) // 拍面瞬态
    return 0.7
  },
  /** §14.7 悬钟骑士「敲钟自鸣」：背驮礼钟的低频长鸣（audio.md §3.1 钟参数：非谐泛音 + 次声锤） */
  bell_toll: (c, o, t, g) => {
    const end = playBell(c, o, t, 174.6, { dur: 4.2, peak: 0.3 * g })   // 低 F 大钟，4.2s 长尾
    playSweep(c, o, t, { f0: 62, f1: 41, dur: 0.6, peak: 0.24 * g })    // 钟体腔模：能进胸腔的那一层
    return Math.max(end, 0.7)
  },
  /** §14.7 钟甲挡下刃：比 hit_metal 长而亮的金属反鸣——一听就知道这一刀被甲吃了 */
  bell_clang: (c, o, t, g) => {
    const end = playBell(c, o, t, 784, { dur: 0.8, peak: 0.2 * g })
    playNoise(c, o, t, { f0: 3200, Q: 2.2, decay: 0.05, peak: 0.22 * g })
    return Math.max(end, 0.12)
  },
  // —— Impact（§7.3）——
  hit_flesh: (c, o, t, g) => {
    playSweep(c, o, t, { f0: 140, f1: 60, dur: 0.06, peak: 0.45 * g })  // 闷拍 140Hz 30ms
    playNoise(c, o, t, { type: 'lowpass', f0: 420, decay: 0.05, peak: 0.3 * g })
    return 0.2
  },
  hit_metal: (c, o, t, g) => {
    playSweep(c, o, t, { f0: 140, f1: 65, dur: 0.05, peak: 0.35 * g })
    playNoise(c, o, t, { f0: 2200, Q: 1.4, decay: 0.04, peak: 0.28 * g })
    for (let i = 0; i < 3; i++) playSweep(c, o, t, { f0: 1800 * (1 + i * 0.65) * rnd(0.97, 1.03), dur: 0.16 - i * 0.04, peak: 0.06 * g })
    return 0.35
  },
  /** 本作曲角色：全混音最亮席位（§8.1 优先级 0）——FM 加性钟，明亮长尾 */
  parry_bell: (c, o, t, g) => {
    playBell(c, o, t, 1046.5, { dur: 3.2, peak: 0.3 * g })
    playFM(c, o, t, { f0: 2093, modRatio: 4.5, index: 3, dur: 1.2, peak: 0.06 * g }) // 4.5 分音加亮
    return 3.4
  },
  perfect_block: (c, o, t, g) => {
    // 短促单环铃声：基 + 2.4 分音，快死
    playSweep(c, o, t, { f0: 2093 * rnd(0.995, 1.005), dur: 0.26, peak: 0.16 * g })
    playSweep(c, o, t, { f0: 2093 * 2.4, dur: 0.14, peak: 0.07 * g })
    playSweep(c, o, t, { f0: 110, f1: 60, dur: 0.08, peak: 0.2 * g })   // 低频"铛"
    return 0.35
  },
  block_guard: (c, o, t, g) => {
    playNoise(c, o, t, { type: 'lowpass', f0: 240, decay: 0.09, peak: 0.4 * g }) // 闷挡
    playSweep(c, o, t, { f0: 100, f1: 55, dur: 0.07, peak: 0.28 * g })
    return 0.2
  },
  player_hurt: (c, o, t, g) => {
    playSweep(c, o, t, { f0: 210, f1: 90, dur: 0.16, peak: 0.5 * g })   // 中低频钝响
    playNoise(c, o, t, { type: 'lowpass', f0: 500, f1: 200, decay: 0.12, peak: 0.3 * g })
    return 0.35
  },
  death_shatter: (c, o, t, g) => {
    playSweep(c, o, t, { f0: 160, f1: 42, dur: 0.45, peak: 0.6 * g })
    playNoise(c, o, t, { f0: 3000, f1: 300, Q: 0.7, decay: 0.7, peak: 0.25 * g })
    for (let i = 0; i < 3; i++) playFM(c, o, t + i * 0.06, { f0: 330 - i * 70, f1: 140 - i * 40, modRatio: 2.4, index: 4, dur: 0.5 - i * 0.1, peak: 0.08 * g })
    return 1.2
  },
  lockon_on: (c, o, t, g) => {
    playNoise(c, o, t, { f0: 2400, Q: 6, decay: 0.02, peak: 0.12 * g })
    playSweep(c, o, t + 0.01, { f0: 1568, dur: 0.2, peak: 0.06 * g })
    return 0.28
  },
  lockon_off: (c, o, t, g) => {
    playNoise(c, o, t, { type: 'lowpass', f0: 900, decay: 0.03, peak: 0.1 * g })
    playSweep(c, o, t, { f0: 784, f1: 600, dur: 0.12, peak: 0.05 * g })
    return 0.18
  },
  footstep: (c, o, t, g) => {
    // 低频软石质（§7.1 stone：180Hz Q2 宽带噪声短爆）
    playNoise(c, o, t, { type: 'lowpass', f0: 400, f1: 160, Q: 2, decay: 0.05, peak: 0.11 * g })
    playSweep(c, o, t, { f0: 180, f1: 120, dur: 0.04, peak: 0.05 * g })
    return 0.12
  },
  ui_move: (c, o, t, g) => {
    playNoise(c, o, t, { f0: 2400, Q: 6, decay: 0.014, peak: 0.09 * g }) // 2.4kHz 短点击 -18dB
    return 0.05
  },
  ui_select: (c, o, t, g) => {
    // R-1 上行琶音 C-Eb-G-Bb 各 55ms（§7.4：正向=R-1）
    const r1 = [523.25, 622.25, 783.99, 932.33]
    for (let i = 0; i < r1.length; i++) playSweep(c, o, t + i * 0.055, { f0: r1[i], dur: 0.12, peak: 0.07 * g })
    return 0.42
  },
  loot_chime: (c, o, t, g) => {
    // 拾取/开启：R-1 上行四音（C-Eb-G-Bb）用钟色，比 ui_select 更柔更短（§7.4 正向=R-1）
    const r1 = [523.25, 622.25, 783.99, 932.33]
    for (let i = 0; i < r1.length; i++) playBell(c, o, t + i * 0.06, r1[i], { dur: 0.9 - i * 0.12, peak: 0.055 * g, hammer: false })
    return 1.1
  },
  gate_creak: (c, o, t, g) => {
    // 机关/闸门/井笼：低频石-金属摩擦 + 一次咬合闷响，收尾留一点共鸣
    playNoise(c, o, t, { type: 'bandpass', f0: 180, f1: 90, Q: 3.5, attack: 0.06, decay: 0.55, peak: 0.2 * g })
    playSweep(c, o, t + 0.34, { f0: 96, f1: 52, dur: 0.22, peak: 0.3 * g })
    playFM(c, o, t + 0.36, { f0: 132, modRatio: 1.02, index: 3, dur: 0.7, peak: 0.07 * g })
    return 1.1
  },
  boss_roar: (c, o, t, g) => {
    const shaper = c.createWaveShaper()
    shaper.curve = makeDistortionCurve(6)
    shaper.connect(o)
    playFM(c, shaper, t, { f0: 120, f1: 65, modRatio: 0.5, index: 9, dur: 1.0, type: 'sawtooth', peak: 0.3 * g })
    playFM(c, shaper, t + 0.05, { f0: 180, f1: 95, modRatio: 1.51, index: 7, dur: 0.9, type: 'sawtooth', peak: 0.14 * g })
    playNoise(c, o, t, { type: 'lowpass', f0: 500, f1: 150, decay: 1.0, peak: 0.12 * g })
    playSweep(c, o, t, { f0: 60, f1: 38, dur: 1.1, peak: 0.25 * g })
    return 1.4
  }
}

export const SFX_KEYS = Object.keys(VOICES) as SfxKey[]

export function isSfxKey(key: string): key is SfxKey {
  return key in VOICES
}

/**
 * 触发一个 SFX，返回发声时长（秒）。节点全部自清理。
 * @param when AudioContext 时间轴上的起始时刻（默认当前）
 * @param gain 额外响度乘子（距离/优先级衰减由调用方算好）
 */
export function triggerSfx(
  ctx: AudioContext,
  out: AudioNode,
  key: string,
  when?: number,
  gain = 1
): number {
  if (!isSfxKey(key)) return 0
  const t = Math.max(when ?? ctx.currentTime, ctx.currentTime)
  return VOICES[key](ctx, out, t, Math.max(0, Math.min(gain, 2)))
}
