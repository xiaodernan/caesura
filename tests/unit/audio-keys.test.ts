import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SFX_KEYS } from '@/audio/synth'

/**
 * 音色名的对账闸门（KI-065）。
 *
 * 为什么要它：`synth.ts` 的 `VOICES` 是一张**按字符串查表**的表，而 `triggerSfx` 对查不到的名字
 * 的处理是**返回 0 并静默不发声**（只在引擎侧留一条 warn 日志）。也就是说"数据里写了个不存在的音色"
 * 和"这个音色的设计就是没有声音"在玩家耳朵里是同一件事——拼错的名字永远不会响，也不会红。
 * `docs/audio.md` §7 那张表说的是"每类事件有一张自己的脸"，名字悬空就是那张脸被悄悄撕掉。
 *
 * 名字的来源恰好三条，一条对一个判据：
 *  ① JSON 里 `sfx` / `sfxLaunch` / `sfxHit` 开头的字段 ⇒ 走"磁盘上有几个 json 就扫几个"（不是手抄清单，
 *     所以新数据文件不会悄悄落在闸门外面）；
 *  ② 代码里 `bus.emit('audio.sfx', { key: '字面量' })` 的字面量；
 *  ③ `key: 表[下标]` 那种查表写法 ⇒ 把那张表的字符串值全部收进来（`SFX`、`BREAK_SFX` 两张都是
 *     `Record<kind, string>`，TS 只看类型不看值，拼错照样编译通过）。
 * 第四条反方向：表里每一条音色都必须被 ①∪②∪③ 引用到——**没有消费者的音色不占位**（需求 §55 的行为版，
 * 与 KI-063 那条"零覆盖名单"同一个口味）。
 */

const root = fileURLToPath(new URL('../..', import.meta.url))
const DATA_DIR = `${root}src/data/json`
const valid = new Set<string>(SFX_KEYS)

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = `${dir}/${name}`
    if (statSync(p).isDirectory()) walkFiles(p, out)
    else out.push(p)
  }
  return out
}

/** 从 `open` 处的 `{` 起做括号配对，返回含首尾花括号的原文；配不上返回 null */
function braceSpan(text: string, open: number): string | null {
  if (text[open] !== '{') return null
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return text.slice(open, i + 1)
  }
  return null
}

/** 对象字面量文本里 `key:` 后面那段表达式（扫到同层的逗号/右括号为止） */
function keyExpr(objLiteral: string): string | null {
  const m = /[{,]\s*key:\s*/.exec(objLiteral)
  if (!m) return null
  let i = m.index + m[0].length
  let depth = 0
  const start = i
  while (i < objLiteral.length) {
    const ch = objLiteral[i]
    if ('([{'.includes(ch)) depth++
    else if (')]}'.includes(ch)) { if (depth === 0) break; depth-- }
    else if (ch === ',' && depth === 0) break
    i++
  }
  return objLiteral.slice(start, i).trim()
}

/* ------------------------------------------------------------------ */
/* 来源①：数据表里的 sfx 字段                                            */
/* ------------------------------------------------------------------ */

function dataSfxNames(): { names: Set<string>; files: number; offenders: string[] } {
  const names = new Set<string>()
  const offenders: string[] = []
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'))
  const walk = (v: unknown, file: string, path: string): void => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, file, `${path}[${i}]`))
      return
    }
    if (v === null || typeof v !== 'object') return
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (/^sfx/i.test(k)) {
        for (const s of (Array.isArray(x) ? x : [x])) {
          if (typeof s !== 'string') { offenders.push(`${file}:${path}.${k} 的值不是字符串`); continue }
          names.add(s)
          if (!valid.has(s)) offenders.push(`${s} ← ${file}:${path}.${k}`)
        }
        continue
      }
      walk(x, file, `${path}.${k}`)
    }
  }
  for (const f of files) walk(JSON.parse(readFileSync(`${DATA_DIR}/${f}`, 'utf8')), f, '$')
  return { names, files: files.length, offenders }
}

/* ------------------------------------------------------------------ */
/* 来源②③：代码里的字面量与查表                                          */
/* ------------------------------------------------------------------ */

interface CodeCensus {
  literals: Set<string>
  mapValues: Set<string>
  maps: string[]
  emitSites: number
  /** 只靠数据取键的发射点（名字运行时才知道，由来源①那条判据负责） */
  dataDrivenSites: number
  offenders: string[]
}

/** `const NAME ... = { ... }` 的对象字面量里所有字符串值（本仓那两张手写音色表） */
function objectLiteralValues(text: string, name: string): string[] | null {
  const decl = new RegExp(`const ${name}\\s*(?::[^=]*)?=\\s*\\{`).exec(text)
  if (!decl) return null
  const span = braceSpan(text, text.indexOf('{', decl.index + decl[0].length - 1))
  if (!span) return null
  return [...span.matchAll(/'([^']+)'/g)].map((m) => m[1])
}

function codeSfxNames(): CodeCensus {
  const literals = new Set<string>()
  const mapValues = new Set<string>()
  const maps: string[] = []
  const offenders: string[] = []
  let emitSites = 0
  let dataDrivenSites = 0
  for (const file of walkFiles(`${root}src`)) {
    if (!file.endsWith('.ts')) continue
    const text = readFileSync(file, 'utf8')
    const rel = file.slice(root.length)
    const lines = text.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, ''))
    let seenInFile = 0
    for (const line of lines) {
      const at = line.indexOf("bus.emit('audio.sfx'")
      if (at < 0) continue
      seenInFile++
      const open = line.indexOf('{', at)
      const obj = open < 0 ? null : braceSpan(line, open)
      expect(obj, `发射点形状扫描器读不动了（多行式？换了写法就同时换判据）：${rel}`).not.toBeNull()
      const expr = keyExpr(obj ?? '')
      expect(expr, `这一处 audio.sfx 发射没有 key：${rel}`).not.toBeNull()
      emitSites++
      const lits = [...(expr ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
      for (const k of lits) {
        literals.add(k)
        if (!valid.has(k)) offenders.push(`${k} ← ${rel}`)
      }
      const table = /([A-Z][A-Za-z0-9_]*)\s*\[/.exec(expr ?? '')
      if (table) {
        const vals = objectLiteralValues(text, table[1])
        expect(vals, `key: ${table[1]}[...] 但读不到 ${table[1]} 的对象字面量（换了形状就要换判据）：${rel}`).not.toBeNull()
        maps.push(`${rel}:${table[1]}`)
        for (const v of vals ?? []) {
          mapValues.add(v)
          if (!valid.has(v)) offenders.push(`${v} ← ${rel} 的 ${table[1]}`)
        }
      } else if (lits.length === 0) {
        dataDrivenSites++
      }
    }
    // 一行两个发射点时 indexOf 只看得到第一个：拿"这些行里出现了几次"对账，漏跑就红
    const occurrences = lines.reduce((n, l) => n + (l.match(/bus\.emit\('audio\.sfx'/g) ?? []).length, 0)
    expect(seenInFile, `扫到的发射点数 ≠ 出现次数（多半是一行写了两个）：${rel}`).toBe(occurrences)
  }
  return { literals, mapValues, maps, emitSites, dataDrivenSites, offenders }
}

describe('音色名对账（数据表 ↔ 代码 ↔ 合成表，KI-065）', () => {
  it('来源①：所有数据 JSON 里写到的音色都在合成表里（扫磁盘上的全部文件，不是手抄清单）', () => {
    const c = dataSfxNames()
    // 16 = HEAD 快照上 `git ls-tree src/data/json/` 的份数。这条锚一开始按共享工作树量成 17，
    // 而多出来的那一份（states.json）是并行会话的在途文件——**存在性锚不能由别人的在途状态决定**，
    // 否则干净快照上会红一句"闸门在量空气"，而那句话说的不是事实。
    expect(c.files, 'json 份数对不上 HEAD 的 16 份 = 扫描器少认了文件（这条闸门在量空气）').toBeGreaterThanOrEqual(16)
    expect(c.names.size, '数据里引用的音色名太少了，八成是扫描形状坏了').toBeGreaterThanOrEqual(20)
    expect(c.offenders, '悬空的音色名（运行时不会响，也不会有人发现）').toEqual([])
  })

  it('来源②③：代码里发出的每个音色名（字面量 + 查表的值）都在合成表里', () => {
    const c = codeSfxNames()
    expect(c.emitSites, '一个 audio.sfx 发射点都没扫到').toBeGreaterThanOrEqual(30)
    expect(c.literals.size, '字面量音色太少：多半是 key 的写法变了而扫描器没跟着变').toBeGreaterThanOrEqual(15)
    expect(c.maps.length, '查表式音色表（SFX / BREAK_SFX）没被收进来').toBeGreaterThanOrEqual(2)
    expect(c.dataDrivenSites, '数据取键的发射点应当存在（它们由来源①负责）').toBeGreaterThanOrEqual(4)
    expect(c.offenders, '代码里发出了不存在的音色').toEqual([])
  })

  it('反方向：合成表里每一条音色都有消费者（没有事件来喊的音色不该占位，§55）', () => {
    const d = dataSfxNames()
    const c = codeSfxNames()
    const used = new Set<string>([...d.names, ...c.literals, ...c.mapValues])
    const orphans = SFX_KEYS.filter((k) => !used.has(k))
    expect(orphans, `这些音色在合成表里，但没有任何地方发它：${orphans.join(', ')}`).toEqual([])
  })

  it('UI 直通名单里的名字必须真实存在（拼错不会崩，只会让该走 ui 总线的声音被 3D 化）', () => {
    const text = readFileSync(`${root}src/audio/AudioEngine.ts`, 'utf8')
    const decl = /const UI_KEYS = new Set\(\[([\s\S]*?)\]\)/.exec(text)
    expect(decl, 'UI_KEYS 那张表换了形状：这条判据要跟着换').not.toBeNull()
    const keys = [...(decl?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(keys.length).toBeGreaterThanOrEqual(4)
    expect(keys.filter((k) => !valid.has(k)), '里面写着不存在的音色').toEqual([])
  })
})
