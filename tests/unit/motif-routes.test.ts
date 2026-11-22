import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 《余响索引》母题路径（M8-T1298）静态契约：
 *   · 5 条路径（盐 / 门 / 船 / 灰 / 碗），每条 4 站；
 *   · 每站必须对应真实卡片 data-no，且同一路径内不重复；
 *   · 页面内嵌 ROUTES JSON 与按钮 data-route 一一对应；
 *   · 卡片带 step-tag 槽位，路径模式才有内容。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const HTML = readFileSync(resolve(ROOT, 'story/atlas/index.html'), 'utf8')

const ROUTE_IDS = ['salt-line', 'door-line', 'boat-line', 'ash-line', 'bowl-line']

describe('Motif Atlas · 母题路径（五条四站线）', () => {
  it('五条路径按钮都在，各自 data-route 唯一', () => {
    const ids = [...HTML.matchAll(/class="route" data-route="([^"]+)"/g)].map((m) => m[1])
    expect(ids.sort()).toEqual([...ROUTE_IDS].sort())
  })

  it('每条路径 4 站，站号指向真实卡片且不重复', () => {
    const json = HTML.match(/var ROUTES = (\[[\s\S]*?\]);/)
    expect(json, '内嵌 ROUTES JSON 缺失').toBeTruthy()
    const routes = JSON.parse(json![1])
    expect(routes).toHaveLength(5)
    const known = new Set([...HTML.matchAll(/class="card" href="[^"]*" data-no="(\d+)"/g)].map((m) => Number(m[1])))
    expect(known.size).toBe(90)
    for (const route of routes) {
      expect(route.nos, `${route.id} 应为 4 站`).toHaveLength(4)
      expect(new Set(route.nos).size, `${route.id} 站号不得重复`).toBe(4)
      for (const no of route.nos) expect(known.has(no), `${route.id} 指向不存在的篇 ${no}`).toBe(true)
    }
  })

  it('路径互不抢篇（20 个站号全不同），每条路按篇号升序', () => {
    const routes = JSON.parse(HTML.match(/var ROUTES = (\[[\s\S]*?\]);/)![1])
    const all = routes.flatMap((r: any) => r.nos)
    expect(all).toHaveLength(20)
    expect(new Set(all).size).toBe(20)
    for (const route of routes) {
      for (let i = 1; i < route.nos.length; i++) expect(route.nos[i]).toBeGreaterThan(route.nos[i - 1])
    }
  })

  it('每张卡都有 step-tag 槽位与 data-no', () => {
    expect((HTML.match(/data-no="\d+"/g) || []).length).toBe(90)
    expect((HTML.match(/class="tag step-tag"/g) || []).length).toBe(90)
  })

  it('路径与母题筛选互斥清理（同一时刻只有一条线索）', () => {
    expect(HTML).toContain('activeRoute = null')
    expect(HTML).toMatch(/if \(active\) \{\s*activeRoute = null/)
    expect(HTML).toMatch(/if \(activeRoute\) \{\s*active = null/)
  })
})
