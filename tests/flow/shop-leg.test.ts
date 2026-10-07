import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { registerGameData, regions } from '@/data'

/**
 * KI-055 的 ②（"营地交互物那条腿"）**已经落了**——但此前只有一句文档说明，没有任何东西防它退化。
 * 本守卫把那条链钉成三截，缺哪一截都红：
 *   ① 数据：营地里有一件 `kind === 'shop'` 的陈设，且它有"交易"这个动词；
 *   ② 引擎：`world/Interactables.ts` 把 `'shop'` 列进 `REPEATABLE`（可反复交互，不是一次性）；
 *   ③ 接线：`main.ts` 用它**打开面板**（`r.kind === 'shop'` ⇒ `setPanelOpen(true)`）。
 *
 * 为什么值得钉：这三截分别在三个文件里，**任何一截被删都不会让别的测试红**——
 * 数据还在、kind 还在、面板就是打不开（或反过来：面板代码还在、数据被删）。
 * 与 KI-094 的 A4 那处"门问词不问行为"同一形状：**要钉的是这条链，不是其中一句。**
 */
registerGameData()

const read = (rel: string) => readFileSync(rel, 'utf8')

describe('KI-055 的 ②：营地那件 shop 交互物是**活的**（数据 + 引擎 + 接线三截）', () => {
  it('① 数据：营地里有 kind=shop 的陈设，动词是"交易"', () => {
    const camp = regions.find((r) => r.id === 'rg_brokenbar_camp')
    expect(camp, '营地应当在表里').toBeTruthy()
    const stalls = camp!.interactables.filter((i) => i.kind === 'shop')
    expect(stalls.map((i) => i.id), '营地那件摊位').toEqual(['shop_camp_stall'])
    expect(stalls[0].verb, '它要有一个动词').toBe('交易')
    expect(stalls[0].pos.y, '站在营地的地板上').toBe(camp!.groundY)
  })

  it('② 引擎：`shop` 是可反复交互的（不是一次性箱子）', () => {
    expect(read('src/world/Interactables.ts')).toMatch(/REPEATABLE[\s\S]{0,220}shop/)
  })

  it('③ 接线：`main.ts` 用它打开面板 —— 那一句就是这条腿的落点', () => {
    const main = read('src/main.ts')
    expect(main).toMatch(/r\.kind === 'shop'/)
    expect(main).toMatch(/setPanelOpen\(true\)/)
  })
})
