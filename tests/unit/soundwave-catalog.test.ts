import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { VFX_PALETTE } from '@/vfx/materials'

/**
 * KI-419（antigravity 起草于 2026-11-09，Phase 7 F4）：
 * **凝固声波那句「语言统一」第一次有机器读者——而第一版要诚实到「今天三颗颜色不出 doc」这格。**
 *
 * art-direction.md §1（统一视觉母题：凝固的声波）是全游戏材质的唯一主人；本仓没有"shader 语言目录"
 * 之外的第二主人——`vfx/materials.ts` 里的五颗 hex 与干涉条纹 shader 规格写在人眼可读的 doc 上，
 * 却没有机器去比对过它们在不在那张表上。
 *
 * 本文件的四腿：
 *   ① art-direction.md §1 里三形态（Ripple/Interference/Solidified）的三词都在（改了 doc §1 头必须有目击）；
 *   ② materials.ts 的干涉 shader 与 §1.2 那段 GLSL 的关键 token 同源（fringe/uThLo/uThHi/0.42/0.58——doc 里那串字面量与运行时字面量）；
 *   ③ VFX_PALETTE 两颗入 §2/§7.1（ember `#FFB86B`、silver `#DDE6EA`）——本篇证明「§2 存在一颗 #FFB86B 与 art-direction 行」；
 *   ④ 另三颗（warmGold `#C9B458`、parryWhite `#F5F3E6`、discordViolet `#9A4FD0`）**今天仍在 §2/§7.1 之外**，登记在 KI-296「总体边界未立」欠账名册上——谁把其中一颗写进 §2 或 §7.1，本腿先红：那就是「gap 落地」那一刻，它应当带着 KI-296 的账目一同销。
 *
 * 安全的天条：② 两边都只是文本扫描，不重抄公式（§55：公式只有一个主人）；④ 的出口只有两种合法——
 * doc 加上色（然后销 KI-296 那格）或 KI-419 改名重写；「悄悄长出 doc 里的第六颗 hex 而无人目击」不合法。
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const doc = readFileSync(join(ROOT, 'docs/art-direction.md'), 'utf8')
const code = readFileSync(join(ROOT, 'src/vfx/materials.ts'), 'utf8')

// §1 那几个词（行规：注释不算读者——本文件只比对 doc/code 原文；§1 头部含 Frozen Soundwave；三形态含按序三个词）
const SECTION_1 = doc.slice(doc.indexOf('## 1. '), doc.indexOf('## 2. '))
const SECTION_2 = doc.slice(doc.indexOf('## 2. '), doc.indexOf('## 3. '))

const hexOf = (n: number): string => `#${n.toString(16).padStart(6, '0').toUpperCase()}`
const WARM_GOLD = hexOf(VFX_PALETTE.warmGold)
const PARRY_WHITE = hexOf(VFX_PALETTE.parryWhite)
const DISCORD_VIOLET = hexOf(VFX_PALETTE.discordViolet)
const EMBER = hexOf(VFX_PALETTE.ember)
const SILVER = hexOf(VFX_PALETTE.silver)

describe('KI-419｜凝固声波目录门', () => {
  it('① §1 三形态的三词都在（改 doc §1 头部必须有目击）', () => {
    for (const token of ['Ripple', 'Interference', 'Solidified', 'uSource', 'uFreq']) {
      expect(SECTION_1.includes(token), `art-direction.md §1 缺少词 ${token}`).toBe(true)
    }
  })

  it('② materials.ts 的干涉 shader 与 §1.2 同源（fringe/0.42/0.58，以及代码自己写的 §1.2 注释锚点）', () => {
    const section12 = SECTION_1.slice(SECTION_1.indexOf('### 1.2'))
    // 文档那一侧：GLSL 模板的字面量都在 §1.2 里出现
    for (const token of ['fringe', 'uThLo', 'uThHi', '0.42', '0.58']) {
      expect(section12.includes(token), `§1.2 缺少 ${token}`).toBe(true)
    }
    // 代码那一侧：真正落进 shader 的是 fringe/0.42/0.58 与注释里的 §1.2（uThLo/uThHi 不同名，是 doc 的 GLSL 模板专用）
    for (const token of ['fringe', '0.42', '0.58', '§1.2']) {
      expect(code.includes(token), `materials.ts 缺少 ${token}——词表的承载体没了`).toBe(true)
    }
  })

  it('③ VFX_PALETTE 两颗入 art-direction 表（ember／silver 是 doc 能叫的色）', () => {
    for (const hex of [EMBER, SILVER]) {
      expect(doc.includes(hex), `${hex} 不在 art-direction.md——materials.ts 与 doc 漂了`).toBe(true)
    }
  })

  it('④ 另三颗仍在 doc 之外（KI-296 欠账名册）——谁把其中一颗写进 §2/§7.1，本腿先红', () => {
    for (const hex of [WARM_GOLD, PARRY_WHITE, DISCORD_VIOLET]) {
      expect(doc.includes(hex), `${hex} 已写进 art-direction.md：如果这是 KI-296 里第一段补色，先读那一行再合；如果只是顺手抄进去，§55 不认`).toBe(false)
    }
    // 登记口径保持自洽：materials.ts 里暖金与失谐紫今天都在注释里点名 art-direction 的主题格（说明读者知道自己在借什么）
    expect(VFX_PALETTE.warmGold, 'KI-419 登记的暖金是 VFX_PALETTE.warmGold').toBeDefined()
    expect(VFX_PALETTE.discordViolet, 'KI-419 登记的喧堕紫是 VFX_PALETTE.discordViolet').toBeDefined()
  })

  it('反向·§2 的全局禁令仍在：无全域「金白/失谐色=……」被摘掉（与 §2 全局禁令同一高度）', () => {
    // §2 全局禁令说「全游戏通用 "炉火/失谐呼吸"=#FFB86B」——那个 #FFB86B 就是 ember，本条只盯「炉火/失谐呼吸」这句话还被 doc 点名
    expect(SECTION_2.includes(EMBER), '§2 的「炉火/失谐呼吸」=#FFB86B 那句话消失了——ember 与 doc 的锚点漂了').toBe(true)
  })
})
