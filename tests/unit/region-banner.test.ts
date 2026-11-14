import { beforeAll, afterEach, describe, expect, it } from 'vitest'
import { setLang } from '@/i18n/Lang'
import { RegionBanner } from '@/ui/RegionBanner'
import { bus } from '@/core/EventBus'

/**
 * RegionBanner — 区域进场仪典（region.enter）：
 * ui.region.enter(...) ⇒ 上屏该区域名；同一局内每个 regionId 只上屏一次；不同 region 过滤器相互独立。
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
    createElement: () => new FakeEl(),
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

const mk = (regionId: string, displayName: string) => ({ regionId, displayName })
const emit = (p: { regionId: string; displayName: string }) => bus.emit('ui.region.enter', p)

describe('RegionBanner：踏入新区域的初印象（region.enter）', () => {
  it('展示：ui.region.enter(rg_windcoast,风钟海岸) ⇒ banner 挂出名称 + on class', () => {
    const b = new RegionBanner()
    emit(mk('rg_windcoast', '风钟海岸 Windbell Coast'))
    const root = body.children.find((c) => c.id === 'region-banner')!
    expect(root, 'banner 节点挂到 body 上').toBeDefined()
    expect(root!.classList.contains('on')).toBe(true)
    expect(root!.innerHTML).toContain('风钟海岸')
    b.dispose()
  })

  it('同一局：已见过的 regionId 再次出现 → banner 不重播（内层 innerHTML 不变，classList 不重置）', () => {
    const b = new RegionBanner()
    emit(mk('rg_resthold', '休垒 Resthold'))
    const root = body.children.find((c) => c.id === 'region-banner')!
    const before = root!.innerHTML
    emit(mk('rg_resthold', '休垒 Resthold'))
    emit(mk('rg_resthold', '休垒 Resthold'))
    expect(root!.innerHTML).toBe(before)
    b.dispose()
  })

  it('两个不同 region 各触发一次：后面那个覆盖前一个显示内容', () => {
    const b = new RegionBanner()
    emit(mk('rg_whisperwode', '雾语林 Whisperwode'))
    const r1 = body.children.find((c) => c.id === 'region-banner')!.innerHTML
    emit(mk('rg_windcoast', '风钟海岸 Windbell Coast'))
    const r2 = body.children.find((c) => c.id === 'region-banner')!.innerHTML
    expect(r1).toContain('雾语林')
    expect(r2).toContain('风钟海岸')
    b.dispose()
  })
})
