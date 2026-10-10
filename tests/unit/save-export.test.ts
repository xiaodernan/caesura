import { describe, expect, it } from 'vitest'
import { MapStore, exportSave, importSave } from '@/save/Serializer'
import { wrap } from '@/save/Integrity'

/**
 * R6 风险缓解：存档导出/导入。IndexedDB 被清或损坏时，导出的 JSON 是最后一道兜底。
 * 导出 = 读主存位的原始 JSON 字符串；导入 = CRC + magic 校验后写入主存位。
 */
describe('存档导出/导入（R6 兜底）', () => {
  it('导出 → 导入 ⇒ 数据完好（CRC 通过）', async () => {
    const store = new MapStore()
    const validSave = wrap(12, { snapshot: { version: 12, playSec: 42 } })
    await store.set('export-test', validSave)

    const json = await exportSave(store, 'export-test')
    expect(json, '导出的 JSON 非空').not.toBeNull()

    const store2 = new MapStore()
    const result = await importSave(store2, json!, 'imported')
    expect(result.ok, 'CRC 通过，导入成功').toBe(true)
    const raw = await store2.get('imported')
    expect(raw).toBe(json)
  })

  it('篡改 CRC ⇒ 拒绝导入', async () => {
    const store = new MapStore()
    const validSave = wrap(12, { snapshot: { version: 12, playSec: 42 } })
    await store.set('export-test', validSave)
    const json = await exportSave(store, 'export-test')
    const tampered = JSON.parse(json!)
    tampered.crc = 99999
    const result = await importSave(store, JSON.stringify(tampered), 'hacked')
    expect(result.ok, 'CRC 不匹配 ⇒ 拒绝').toBe(false)
    expect(result.reason).toBe('crc-mismatch')
  })

  it('非 JSON 输入 ⇒ 拒绝', async () => {
    const store = new MapStore()
    const result = await importSave(store, 'not json at all', 'bad')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('parse-error')
  })

  it('缺 magic ⇒ 拒绝', async () => {
    const store = new MapStore()
    const result = await importSave(store, JSON.stringify({ crc: 0, payload: {} }), 'bad')
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('bad-magic')
  })
})
