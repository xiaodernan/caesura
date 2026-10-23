/**
 * importSave 拒收分支守卫（src/save/Serializer.ts）。
 *
 * `importSave` 是 R6 风险缓解的玩家兜底：IndexedDB 被清/坏时，玩家导出一份 JSON 自己备份，
 * 再从这里导回来。它有 **6 条不同的拒收理由**，但 save-export.test.ts 只断言了其中三条
 * （crc-mismatch / parse-error / bad-magic）与 happy path——下面这三条**从来没被机器验过**：
 *   · `not-object`  JSON 合法但不是对象（数字/字符串/null）
 *   · `no-crc`      magic 对、但 crc 这格缺失或不是 number
 *   · `no-snapshot` crc 在、但 payload 缺失或没有 payload.snapshot
 * 覆盖实测确认这三条是 Serializer.ts 的未取分支（v8 text reporter 报 585/587/588）。
 * 一条玩家手改坏了一半的备份，必须被**拒之门外且不碰已存在的好档**——这正是"读档即坏档"要防的。
 *
 * 锁的契约：
 *   1. 三条缺验的拒收理由各给出正确 reason；
 *   2. 每次拒收都发生在 `store.set` **之前**——坏备份绝不覆盖主存位里已有的好档；
 *   3. reason 与「校验不通过」一一对应，不吞错、不串味。
 */
import { describe, expect, it } from 'vitest'
import { MapStore, importSave } from '@/save/Serializer'
import { MAGIC } from '@/save/Integrity'

describe('importSave 三条缺验的拒收分支', () => {
  it('JSON 合法但不是对象 ⇒ not-object，且不写库', async () => {
    const store = new MapStore()
    for (const bad of ['123', 'true', '"a string"', 'null']) {
      const r = await importSave(store, bad, 'slot')
      expect(r, `输入 ${bad}`).toEqual({ ok: false, reason: 'not-object' })
    }
    expect(await store.get('slot')).toBeNull()
  })

  it('magic 对但 crc 缺失/非 number ⇒ no-crc，且不写库', async () => {
    const store = new MapStore()
    // magic 命中、payload 齐全，唯独 crc 不在
    const r = await importSave(store, JSON.stringify({ magic: MAGIC, payload: { snapshot: {} } }), 'slot')
    expect(r).toEqual({ ok: false, reason: 'no-crc' })
    expect(await store.get('slot')).toBeNull()
  })

  it('crc 在但 payload 缺失 ⇒ no-snapshot，且不写库', async () => {
    const store = new MapStore()
    const r = await importSave(store, JSON.stringify({ magic: MAGIC, crc: 0 }), 'slot')
    expect(r).toEqual({ ok: false, reason: 'no-snapshot' })
    expect(await store.get('slot')).toBeNull()
  })

  it('payload 在但没有 snapshot 这层 ⇒ no-snapshot，且不写库', async () => {
    const store = new MapStore()
    const r = await importSave(store, JSON.stringify({ magic: MAGIC, crc: 0, payload: { rpg: {} } }), 'slot')
    expect(r).toEqual({ ok: false, reason: 'no-snapshot' })
    expect(await store.get('slot')).toBeNull()
  })
})
