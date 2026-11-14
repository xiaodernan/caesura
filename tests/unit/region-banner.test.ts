import { beforeAll, afterEach, describe, expect, it } from 'vitest'
import { setLang } from '@/i18n/Lang'
import { RegionBanner } from '@/ui/RegionBanner'
import { bus } from '@/core/EventBus'

/**
 * RegionBanner — 区域进场仪典（Phase F? — 本批首落）：
 * world.chunk 带 regionId ⇒ 首次看到 ⇒ 挂出名字牌，同一局内不重复触发。
 */
class FakeEl {
  id = ''
  className = ''
  classList = {
    _set: new Set<string>(),
    add: (c: string) => { this.classList._set.add(c) },
    remove: (c: string) => { this.classList._set.delete(c) },
    contains: (c: string) => this.classList._set.has(c),
  }
  innerHTML = ''
  textContent = ''
  children: FakeEl[] = []
  setAttribute(_name: string, _value: string) {}
  appendChild(c: FakeEl): FakeEl { this.children.push(c); return c }
  remove(): void {}
}

let head: FakeEl
let body: FakeEl

beforeAll(() => {
  head = new FakeEl()
  body = new FakeEl()
  ;(globalThis as unknown as Record<string, unknown>).document = {
    createElement: (tag: string) => {
      const el = new FakeEl()
      if (tag === 'style') {
        const s = { textContent: '', id: '' }
        return s as unknown as FakeEl
      }
      return el
    },
    head,
    body,
    getElementById: () => null,
  }
})

afterEach(() => {
  head.children = []
  body.children = []
  setLang('zh')
})

describe('RegionBanner：踏入新区域的初印象（Phase F）', () => {
  it('展示：world.chunk(rg_windcoast) ⇒ banner 挂出名称 + on class', () => {
    const b = new RegionBanner()
    bus.emit('world.chunk', { key: '0,0,0', regionId: 'rg_windcoast', cx: 0, cy: 0, cz: 0, center: { x: 0, y: 0, z: 0 }, state: 'active', priority: 0, tick: 1 })
    const root = body.children.find((c) => c.id === 'region-banner')!
    expect(root, 'banner 节点挂到 body 上').toBeDefined()
    expect(root!.classList.contains('on')).toBe(true)
    expect(root!.innerHTML).toContain('风钟海岸')
    b.dispose()
  })

  it('同一局：已见过的 region 再次出现 → 触发次数不增加、banner 保持原文本', () => {
    const b = new RegionBanner()
    bus.emit('world.chunk', { key: '0,0,0', regionId: 'rg_resthold', cx: 0, cy: 0, cz: 0, center: { x: 0, y: 0, z: 0 }, state: 'active', priority: 0, tick: 1 })
    const root = body.children.find((c) => c.id === 'region-banner')!
    const before = root!.innerHTML
    bus.emit('world.chunk', { key: '1,0,0', regionId: 'rg_resthold', cx: 1, cy: 0, cz: 0, center: { x: 48, y: 0, z: 0 }, state: 'active', priority: 0, tick: 2 })
    bus.emit('world.chunk', { key: '0,0,0', regionId: 'rg_resthold', cx: 0, cy: 0, cz: 0, center: { x: 0, y: 0, z: 0 }, state: 'active', priority: 0, tick: 3 })
    expect(root!.innerHTML).toBe(before)
    b.dispose()
  })

  it('两个不同的 region 各触发一次：后面的那个覆盖前一个显示内容', () => {
    const b = new RegionBanner()
    bus.emit('world.chunk', { key: '0,0,0', regionId: 'rg_whisperwode', cx: 0, cy: 0, cz: 0, center: { x: 100, y: 0, z: 0 }, state: 'active', priority: 0, tick: 1 })
    const r1 = body.children.find((c) => c.id === 'region-banner')!.innerHTML
    bus.emit('world.chunk', { key: '0,2,0', regionId: 'rg_windcoast', cx: 0, cy: 2, cz: 0, center: { x: 500, y: 0, z: 0 }, state: 'active', priority: 0, tick: 2 })
    const r2 = body.children.find((c) => c.id === 'region-banner')!.innerHTML
    expect(r1).toContain('雾语林')
    expect(r2).toContain('风钟海岸')
    b.dispose()
  })
})
