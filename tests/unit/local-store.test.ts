/**
 * LocalStore 守卫（src/save/Serializer.ts）。
 *
 * 真实的浏览器存档落盘适配器：`main.ts` 用 `new LocalStore('caesura.save.', localStorage)` 把它接到
 * 玩家的 localStorage。它是 KvStore 接口在「真机磁盘」那一端的唯一实现，但全库零测试引用——
 * 存档的读写正确性一直只靠 `MapStore`（内存替身）在 save.test.ts 里验，落盘这一跳从没被机器验过。
 *
 * 锁的是 LocalStore **相对 MapStore 唯一多出来的契约**（不是重复验证 KvStore 接口本身）：
 *   1. 每个键都带前缀——set('a') 落盘为 `<prefix>a`，绝不能裸写 'a'（否则和别的 localStorage 用户撞键、丢档）；
 *   2. 前缀一致：get/set/remove 必须用同一把前缀，不偏不漏；
 *   3. 缺键返回 null（不是 throw、不是 undefined 误当字符串）——`KvStore` 把"没有"统一成 null，
 *      漏这一步，未写过的槽会被摘要卡当成"损坏"（实机 5199 读到的同类事故在 IdbStore 注释里记着）；
 *   4. 不同前缀的实例互不串台（隔离性）。
 */
import { describe, expect, it } from 'vitest'
import { LocalStore } from '@/save/Serializer'

function fakeStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, v) },
  } as Storage
}

describe('LocalStore', () => {
  it('set 落盘带前缀，绝不裸写键（防和别的 localStorage 用户撞键丢档）', async () => {
    const back = fakeStorage()
    const store = new LocalStore('caesura.save.', back)
    await store.set('slot1', 'payload')
    expect(back.getItem('caesura.save.slot1')).toBe('payload')
    expect(back.getItem('slot1')).toBeNull() // 裸键绝不能出现
  })

  it('get/set/remove 用同一把前缀，不偏不漏', async () => {
    const back = fakeStorage()
    const store = new LocalStore('caesura.save.', back)
    await store.set('k', 'v')
    expect(await store.get('k')).toBe('v')
    // 同一前缀下删掉的就是落盘的那个键
    await store.remove('k')
    expect(back.getItem('caesura.save.k')).toBeNull()
    expect(await store.get('k')).toBeNull()
  })

  it('缺键返回 null，不抛、不当成字符串', async () => {
    const back = fakeStorage()
    const store = new LocalStore('caesura.save.', back)
    expect(await store.get('never-written')).toBeNull()
  })

  it('不同前缀的实例互不串台（隔离性）', async () => {
    const back = fakeStorage()
    const a = new LocalStore('pre.a.', back)
    const b = new LocalStore('pre.b.', back)
    await a.set('x', 'fromA')
    expect(await b.get('x')).toBeNull() // b 读不到 a 的键
    expect(back.getItem('pre.a.x')).toBe('fromA')
    expect(back.getItem('pre.b.x')).toBeNull()
  })
})
