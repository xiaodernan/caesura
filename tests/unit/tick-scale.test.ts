import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TICK_HZ, TICK_DT, msToTicks, ticksToMs } from '@/core/Time'

/**
 * **tick⇄秒 那把尺**的门（KI-144；KI-123 登记了这道门，**但它从未被提交**——账本说"门已立"，
 * 仓库里没有那个文件。补上它，并且把那 4 处裸 60 折进尺）。
 *
 * **病**：`TICK_HZ = 60` 与 `TICK_DT = 1 / TICK_HZ` 已经是全仓唯一的 tick⇄秒 尺，
 * 而裸 60 的每一格都是「今天恰好等于」的巧合——等 tick 率一改，那些格子会一起变成谎话，
 * 而且**没有一台门会红**。
 *
 * **判据的形状**（结构腿）：扫 `src/` 下全部 .ts 文件，找「裸 60 站在 `/` 或 `*` 的一侧、另一侧是
 * tick 单位（名字里带 tick/sec/age/ms/frame）」的站点。**在册名单是空的**——今天允许零处。
 *
 * **另外两把尺不许被折进来**（must-not-unify）：`RhythmClock` 的 `bpm / 60` 数的是"一分钟多少秒"，
 * `SaveSlots` 的 `(s % 3600) / 60` 是分钟算术——把它们折进 `TICK_HZ` 恰好是把三把尺折成一把
 * （KI-066／§37 那一族的病）。这一条把它们钉住：**它们不许出现 `TICK_HZ`**。
 *
 * **涂白只吃注释与字符串字面区**，模板字面量的 `${…}` **内部留着**——播报那一族正是这个形状
 * （`\`${Math.round(1.5 * TICK_HZ)}\`` 这种算术写在插值里）。
 */
const root = fileURLToPath(new URL('../..', import.meta.url))

/** 涂白注释与字符串字面区，但保留模板字面量 `${…}` 的内部（那一段是代码） */
function blank(src: string): string {
  const out = src.split('')
  let i = 0
  let state: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl' = 'code'
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; out[i] = ' '; out[i + 1] = ' '; i += 2; continue }
      if (c === '/' && n === '*') { state = 'block'; out[i] = ' '; out[i + 1] = ' '; i += 2; continue }
      if (c === "'" || c === '"') { state = c === "'" ? 'sq' : 'dq'; i++; continue }
      if (c === '`') { state = 'tpl'; i++; continue }
      i++
      continue
    }
    if (state === 'line') {
      if (c !== '\n') out[i] = ' '
      else state = 'code'
      i++
      continue
    }
    if (state === 'block') {
      if (c === '*' && n === '/') { out[i] = ' '; out[i + 1] = ' '; i += 2; state = 'code'; continue }
      if (c !== '\n') out[i] = ' '
      i++
      continue
    }
    if (state === 'sq' || state === 'dq') {
      if (c === '\\') { out[i] = ' '; out[i + 1] = ' '; i += 2; continue }
      if (c === state) { state = 'code'; i++; continue }
      if (c !== '\n') out[i] = ' '
      i++
      continue
    }
    // 模板字面量
    if (c === '\\') { out[i] = ' '; out[i + 1] = ' '; i += 2; continue }
    if (c === '`') { state = 'code'; i++; continue }
    if (c === '$' && n === '{') {
      let depth = 0
      let j = i + 1
      for (; j < src.length; j++) {
        if (src[j] === '{') depth++
        else if (src[j] === '}') { depth--; if (depth === 0) break }
      }
      out[i] = ' '
      out[i + 1] = ' '
      for (let k = i + 2; k < j; k++) out[k] = src[k]
      i = j + 1
      continue
    }
    if (c !== '\n') out[i] = ' '
    i++
  }
  return out.join('')
}

/** tick 单位：名字里带 tick/sec/age/ms/frame 的那些 */
const TICKISH = /^[A-Za-z_$][\w$]*(tick|ticks|sec|secs|seconds|age|ms|frame|frames)[A-Za-z_$]*$/i

const srcFiles = (): string[] => {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = dir + '/' + e.name
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.ts')) out.push(p)
    }
  }
  walk(root + '/src')
  return out
}

/** 扫出「裸 60 站在 / 或 * 的一侧、另一侧是 tick 单位」的站点 */
const tickScaleSites = (): { file: string; line: number; text: string }[] => {
  const hits: { file: string; line: number; text: string }[] = []
  for (const f of srcFiles()) {
    const raw = readFileSync(f, 'utf8')
    const code = blank(raw)
    const rawLines = raw.split('\n')
    code.split('\n').forEach((line, i) => {
      let m: RegExpExecArray | null
      const left = /([A-Za-z_$][\w$.]*)\s*(\/|\*)\s*60\b/g
      while ((m = left.exec(line)) !== null) {
        if (TICKISH.test(m[1])) hits.push({ file: f, line: i + 1, text: rawLines[i].trim() })
      }
      const right = /\b60\s*(\/|\*)\s*([A-Za-z_$][\w$.]*)/g
      while ((m = right.exec(line)) !== null) {
        if (TICKISH.test(m[2])) hits.push({ file: f, line: i + 1, text: rawLines[i].trim() })
      }
    })
  }
  return hits
}

describe('tick⇄秒那把尺（KI-144）', () => {
  it('src 树里没有把裸 60 当尺使的站点（在册名单是空的：今天允许零处）', () => {
    const hits = tickScaleSites()
    expect(
      hits.map((h) => `${h.file.replace(root + '/', '')}:${h.line}  ${h.text.slice(0, 90)}`),
      '这些站点把裸 60 当 tick⇄秒 的尺：等 tick 率一改，它们会一起变成谎话，而没有一台门会红',
    ).toEqual([])
  })

  it('另外两把尺不许被折进来（bpm/60 是"一分钟多少秒"，(s%3600)/60 是分钟算术）', () => {
    const rhythm = readFileSync(root + '/src/core/RhythmClock.ts', 'utf8')
    const slots = readFileSync(root + '/src/ui/SaveSlots.ts', 'utf8')
    expect(rhythm, 'RhythmClock 的 bpm/60 原样留着').toContain('this.bpm / 60')
    expect(rhythm, '不许折成 TICK_HZ').not.toContain('this.bpm / TICK_HZ')
    expect(slots, 'SaveSlots 的分钟算术原样留着').toContain('(s % 3600) / 60')
    expect(slots, '不许折成 TICK_HZ').not.toContain('(s % 3600) / TICK_HZ')
  })

  it('TICK_HZ 全仓只有一个声明处（两把尺合成一把的病就出在这里）', () => {
    const decls: string[] = []
    for (const f of srcFiles()) {
      const raw = readFileSync(f, 'utf8')
      raw.split('\n').forEach((line, i) => {
        if (/export const TICK_HZ\s*=/.test(line)) decls.push(`${f.replace(root + '/', '')}:${i + 1}`)
      })
    }
    expect(decls, 'TICK_HZ 的声明处（必须恰好一个）').toHaveLength(1)
    expect(decls[0]).toContain('src/core/Time.ts')
  })

  it('那把尺的两个导出自洽（TICK_DT 是它的倒数，ms⇄tick 往返不丢）', () => {
    expect(TICK_DT).toBeCloseTo(1 / TICK_HZ, 12)
    expect(msToTicks(1000)).toBe(TICK_HZ)
    expect(ticksToMs(TICK_HZ)).toBeCloseTo(1000, 6)
    expect(msToTicks(ticksToMs(90))).toBe(90)
  })

  it('折过的四处真的在用尺（不是把 60 换成另一个字面量）', () => {
    const main = readFileSync(root + '/src/main.ts', 'utf8')
    const ctrl = readFileSync(root + '/src/player/ThirdPersonController.ts', 'utf8')
    const vfx = readFileSync(root + '/src/vfx/VfxLayer.ts', 'utf8')
    expect(main).toContain('OBSERVE_TRAVEL_TICKS / TICK_HZ')
    expect(ctrl).toContain('durationSec * TICK_HZ')
    expect(vfx).toContain('p.age / TICK_HZ / windowSec')
  })
})
