import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, extname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/**
 * KI-417：items.json 里「引用方为零」的行——装备获取通道未接的缺桩，第一次被机器数出来。
 *
 * §55／KI-047 那族（「无消费方的数据不许入表」）的姊妹判据，作用在**料表**而不是配置表：
 * 真数据扫描（src/ + tests/，排除 items.json 自己）发现恰好五行没有任何文件点名它们——
 * 三把武器的随身物品行（wp_fortissimo_greatsword_item／wp_overtone_bow_item／wp_tuningfork_staff_item）、
 * 钟皮胸甲 ar_ostlaraweave_cuirass（epic）、音徽·留鼓 seal_drumlegend（epic）。
 *
 * 本文件**不**删行、不接线——那是装备获取通道（loot/shop 目前不出任何装备件）的设计问题，
 * 由产品方向裁决（KI-417），不在这里代裁。本文件做的是同 KI-136 一个动作：把这五行
 * 钉在一张名册上，让机器红在「又多了第六行」，而不是让缺口悄悄长。
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const TABLE = 'src/data/json/items.json'
/** 本文件自己点名那五行（名册就住在这里）——它当然不是消费方；其它测试点名某行 ⇒ 算一种消费（打了脸要更新名册） */
const GATE = 'tests/unit/unaware-rows.test.ts'

/** 2026-11-09 实扫出的零引用名册——谁接线了某一行（或从 items.json 删掉某行），这里先红，逼名册跟上。 */
const KNOWN_ORPHANS = [
  'wp_fortissimo_greatsword_item',
  'wp_overtone_bow_item',
  'wp_tuningfork_staff_item',
  'ar_ostlaraweave_cuirass',
  'seal_drumlegend',
]

/** 语料：src/ + tests/ 下的文本文件（路径一律转成 posix 分隔，别把自己按 win\ 漏掉） */
const buildCorpus = (): { rel: string; text: string }[] => {
  const out: { rel: string; text: string }[] = []
  const EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md'])
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (EXTS.has(extname(e.name))) {
        try {
          const text = readFileSync(p, 'utf8')
          out.push({ rel: relative(ROOT, p).split(sep).join('/'), text })
        } catch { /* 二进制/读不动的跳过 */ }
      }
    }
  }
  walk(join(ROOT, 'src'))
  walk(join(ROOT, 'tests'))
  return out
}

const corpus = buildCorpus()
const items = JSON.parse(readFileSync(join(ROOT, 'src/data/json/items.json'), 'utf8')) as { id: string }[]

const zeroRef = items.filter((row) => !corpus.some((f) => f.rel !== TABLE && f.rel !== GATE && f.text.includes(row.id)))

describe('KI-417｜items.json 引用方为零的行名册', () => {
  it('引用方为零的 items 行恰好是 KNOWN_ORPHANS（多一行⇒红；少一行同样红）', () => {
    expect(zeroRef.map((r) => r.id).sort(), '新的零引用行出现了/旧的被接线了——名册要跟着真相走').toEqual([...KNOWN_ORPHANS].sort())
  })

  it('名册里的每一行都还在 items.json 里（接线后漏更新名册＝这条红）', () => {
    const ids = new Set(items.map((r) => r.id))
    for (const id of KNOWN_ORPHANS) expect(ids.has(id), id).toBe(true)
  })

  it('反向：语料里只剩 items.json 自己 ⇒ 全表都被标成零引用（判据没把输入表当引用者）', () => {
    const ownOnly = corpus.filter((f) => f.rel === TABLE)
    expect(ownOnly.length, 'items.json 自己必须在语料里（否则第一条腿是自己给自己放行）').toBe(1)
    const flagged = items.filter((r) => !ownOnly.some((f) => f.rel !== TABLE && f.rel !== GATE && f.text.includes(r.id)))
    expect(flagged.length).toBe(items.length)
  })
})
