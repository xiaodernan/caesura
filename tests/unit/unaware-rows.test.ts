import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, extname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

/**
 * KI-417：items.json 里**按名引用为零**的行——本来的判断错了形状，按重新量到的真相改口。
 *
 * 第一版登记（2026-11-09 晨）把这五行叫「装备获取通道尚未接线的缺桩」。复核（同日）：
 * `Loot.pickGearItem` 按 `gear.rarity` 从 items.json **泛化**选装备——Loot 表（loot_chest_t1/t2/t3、
 * camp_store、camp、secret_nave/bellinterior、敌人表 gearBand 各行）今天就在滚 uncommon/rare/rareplus/
 * epic 四档，而 `scripts/validate-data.mjs` 的 KI-042 腿兜底「gearBand 指到的稀有度没有任何装备件 ⇒ ERROR」。
 * 也就是说这五行（uncommon×2、rare×1、epic×2）**通过泛化抽取是可获取的**；它们「按名零引用」只是
 * 「没有 milestone/firstKill/测试点名它们」——这正是泛化掉落的自然形态，不是坏。
 *
 * 那这个门钉的是什么，以及它防什么：它钉的是**按名引用为零的行名册**——哪些行今天只靠泛化抽中。
 * 防的是：以后新加一件只想「挂在随身表不接线就别特步走」的装备行，让它的存在无人对账；
 * 名册会在它出现时红，逼它要么被泛化掉落成为真的可获取（稀有度被某个 gearBand 真在滚）、
 * 要么被删（§55 无消费方的数据不许入表——那是产品方向裁决）、要么被点名接线。
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

  it('名册里的每一行，其稀有度今天仍被 loot.json 的某个 gearBand 滚到（gearBand 改表后仍能掷中它们——本名册跟着真相走）', () => {
    const loot = JSON.parse(readFileSync(join(ROOT, 'src/data/json/loot.json'), 'utf8')) as Array<{ rolls?: { gearBand?: { rarity: string }[] }[] }>
    const rolled = new Set(loot.flatMap((t) => (t.rolls ?? []).flatMap((r) => (r.gearBand ?? []).map((b) => b.rarity))))
    for (const id of KNOWN_ORPHANS) {
      const item = items.find((r) => r.id === id)!
      const rarity = (item as unknown as { gear?: { rarity?: string } }).gear?.rarity
      if (!rarity) throw new Error(`${id} 要有 gear.rarity`)
      expect(rolled.has(rarity), `${id}（${rarity}）今天必须至少有一张 gearBand 真在滚这个档——滚不到就是名册里的行悄悄死了`).toBe(true)
    }
  })

  it('反向：语料里只剩 items.json 自己 ⇒ 全表都被标成零引用（判据没把输入表当引用者）', () => {
    const ownOnly = corpus.filter((f) => f.rel === TABLE)
    expect(ownOnly.length, 'items.json 自己必须在语料里（否则第一条腿是自己给自己放行）').toBe(1)
    const flagged = items.filter((r) => !ownOnly.some((f) => f.rel !== TABLE && f.rel !== GATE && f.text.includes(r.id)))
    expect(flagged.length).toBe(items.length)
  })
})
