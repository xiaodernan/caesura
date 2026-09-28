import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MOJIBAKE_CHAR, findMojibake, mojibakeFindings } from '../../scripts/text-integrity.mjs'

/**
 * 数据表「文本完整性」的判据（KI-082）。
 *
 * 起因是一族**不与任何既有判据相交**的坏：本机有一条并行的写盘路径，把中文写回 JSON 时会按别的
 * 代码页编/解码一次，产物是 U+FFFD 替换字符。文件仍然是合法 JSON、字段仍然对得上 `schema.ts`、
 * 数值仍然在范围内 —— 校验器、tsc、运行时三方都看不见它，只有那一句文档悄悄少了几个字。
 * 2026-09-28 实测：`states.json` 里 `§2.3` 被压成 `\uFFFD?.3`（那一处至今躺在 `2300ad1` 里）。
 *
 * 分工与 `battle-table.test.ts` 那一族一致：**合成文本**跑这里（拒的一侧要能逐个数判），
 * **真表**由 `npm run validate:data` 跑；但这一条判据多留了一个真表证人（下面最后一条），
 * 因为它的病是"发生了也全绿"，多一双眼睛比省一次 readdir 值。
 */

const root = fileURLToPath(new URL('../..', import.meta.url))

describe('U+FFFD 判据（KI-082）：坏字符是「数据已经写坏了」的证据，不是显示问题', () => {
  it('位置报得准：第几行、第几列都要数出来（一行里两个也不许只报一个）', () => {
    const text = ['第一行干净', '第二行有一个 \uFFFD 在这里', '第三行两个 \uFFFD 和 \uFFFD'].join('\n')
    const hits = findMojibake(text)
    expect(hits.map((h) => [h.line, h.column])).toEqual([[2, 8], [3, 7], [3, 11]])
    expect(hits.map((h) => h.index), 'index 要指回原文，供报告切上下文').toEqual([13, 25, 29])
  })

  it('干净文本一条都不报 —— 判据不是「看着像乱码就抓」', () => {
    // 这些字符各有正当用途（合并音标 / 变体选择符 / emoji 组合），拿它们定罪就是误报机器
    const clean = '钟腔里没有太阳\u0301 声纹\uFE0F 影\u200D像 🜚 ■ …—「」'
    expect(findMojibake(clean)).toEqual([])
    expect(mojibakeFindings([{ file: 'x.json', text: clean }])).toEqual([])
  })

  it('坏字符**不影响 JSON 合法性** ⇒ 只看解析后的对象是看不见它的（这条就是当年漏掉它的原因）', () => {
    const broken = '{\n  "note": "（\uFFFD?.3/§7）"\n}'
    expect(() => JSON.parse(broken), '它仍然是一个能解析的对象：所有既有判据都会放它过去').not.toThrow()
    expect(JSON.parse(broken).note, '解析出来的那一格只是少了两个字').toBe('（\uFFFD?.3/§7）')
    expect(findMojibake(broken).map((h) => h.line)).toEqual([2])
  })

  it('报告：同一行只报一条、点出每一列的列号、带上下文与修法；where 是行号而不是 JSON 路径', () => {
    const [f] = mojibakeFindings([{ file: 'states.json', text: '{\n  "note": "（\uFFFD?.3）"\n}' }])
    expect(f.level).toBe('error')
    expect(f.file).toBe('states.json')
    expect(f.where, '压坏之后连路径自己都可能读不出来，能指路的只有行号').toBe('第 2 行')
    expect(f.msg).toContain('1 个 U+FFFD')
    expect(f.msg).toContain('第 13 列')
    expect(f.msg, '上下文让读报告的人不必先学会 grep').toContain('\uFFFD?.3')
    expect(f.msg, '修法要写在门口，不是留在某个人的脑子里').toContain('按设计原文重新敲回去')
    expect(f.msg).toContain('KI-082')
    const two = mojibakeFindings([{ file: 'x.json', text: '一\uFFFD二\uFFFD三' }])
    expect(two.length, '同一行两处 = 一处手误，报两条反而看不出是同一个地方').toBe(1)
    expect(two[0].msg).toContain('2 个 U+FFFD 替换字符（第 2、4 列）')
  })

  it('上下文按 JSON 转义（原样打印会把「一条一行」的门禁输出撑成一段）', () => {
    const [f] = mojibakeFindings([{ file: 'x.json', text: '{"a":"x\uFFFD\\"y"}' }])
    expect(f.msg).toContain('\\"')
    expect(f.msg, '报告里不许带换行').not.toContain('\n')
  })

  it('入参不成形也不许崩（门禁在最该说话的时候崩，是最糟的一种失败）', () => {
    expect(findMojibake(undefined)).toEqual([])
    expect(findMojibake('')).toEqual([])
    expect(mojibakeFindings(undefined)).toEqual([])
    expect(mojibakeFindings([null, 7, {}])).toEqual([])
    expect(mojibakeFindings([{ text: '\uFFFD' }])[0].file, '没写表名也要给个能读的喊法').toBe('(未命名表)')
  })

  it('判据自己源码里只许留转义写法（真字符要能被 eyeball 成「故意的还是又坏了一处」）', () => {
    expect(MOJIBAKE_CHAR).toBe('\uFFFD')
    const src = readFileSync(root + 'scripts/text-integrity.mjs', 'utf8')
    expect(findMojibake(src), '判据自己的源码带一个真的 U+FFFD，会让后面每一个人都停下来想一秒').toEqual([])
  })

  it('源码门：校验器真的把这条判据接在**每一份表的原文**上（不是只写了个模块放在那儿）', () => {
    const src = readFileSync(root + 'scripts/validate-data.mjs', 'utf8')
    expect(src, '接线要 import 那道判据').toMatch(/import\s*\{[^}]*mojibakeFindings[^}]*\}\s*from\s*'\.\/text-integrity\.mjs'/)
    expect(src, '读到的原文必须留下来（只看 data 是看不见坏字符的）').toMatch(/sourceText\[f\]\s*=\s*text/)
    expect(src, '报告的三个字段一个都不能丢').toMatch(/report\.error\(f\.file,\s*f\.where,\s*f\.msg\)/)
  })

  it('真表：src/data/json 里一个 U+FFFD 都没有（这一条是那个把中文写坏的写盘路径的哨兵）', () => {
    const dir = root + 'src/data/json/'
    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    expect(files.length, '表数掉了 = 有人把它指向了别处').toBeGreaterThan(15)
    const dirty = files
      .map((file) => ({ file, hits: findMojibake(readFileSync(dir + file, 'utf8')) }))
      .filter((x) => x.hits.length > 0)
      .map((x) => `${x.file}:${x.hits.map((h) => h.line).join(',')}`)
    expect(dirty, `这些表里躺着 U+FFFD（中文已经被写坏了，机器一直看得见）：${dirty.join(' ')}`).toEqual([])
  })
})
