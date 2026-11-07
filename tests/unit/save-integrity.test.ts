import { describe, expect, it } from 'vitest'
import { MAGIC, crc32, wrap, unwrap } from '@/save/Integrity'

/**
 * `src/save/Integrity.ts`：存档防损坏（需求 §45；technical-architecture §2 save/Integrity.ts）。
 *
 * 三件事：magic+版本头、CRC32 校验和、双写交换（rename 语义）。
 * 读档校验失败 ⇒ 调用方回退到上一份并提示，绝不让半截 JSON 变成一次「读档即坏档」。
 */

describe('crc32：标准 CRC32，只用于「这份字节没被截断/改坏」', () => {
  it('同一输入两次调用结果相同；不同输入结果不同', () => {
    expect(crc32('hello')).toBe(crc32('hello'))
    expect(crc32('hello')).not.toBe(crc32('world'))
  })

  it('空串也有值（不崩），且为无符号 32 位', () => {
    const v = crc32('')
    expect(typeof v).toBe('number')
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThanOrEqual(0xffffffff)
  })
})

describe('wrap / unwrap：roundtrip 与信任边界', () => {
  const supported = [10, 11]

  it('wrap 生成含 MAGIC + schemaVersion + crc + payload 的信封', () => {
    const out = JSON.parse(wrap(10, { hp: 100 })) as Record<string, unknown>
    expect(out.magic).toBe(MAGIC)
    expect(out.schemaVersion).toBe(10)
    expect(typeof out.crc).toBe('number')
    expect(out.payload).toEqual({ hp: 100 })
  })

  it('unwrap 成功：回环一致', () => {
    const raw = wrap(10, { hp: 100, name: '测试' })
    const res = unwrap(raw, supported)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.schemaVersion).toBe(10)
      expect(res.payload).toEqual({ hp: 100, name: '测试' })
    }
  })

  it('unwrap 失败：reason=parse（非法 JSON）', () => {
    const res = unwrap('not json', supported)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('parse')
  })

  it('unwrap 失败：reason=magic（错误的 magic）', () => {
    const raw = JSON.stringify({ magic: 'WRONG', schemaVersion: 10, crc: 0, payload: {} })
    const res = unwrap(raw, supported)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('magic')
  })

  it('unwrap 失败：reason=version（schemaVersion 不在支持列表）', () => {
    const raw = wrap(999, { x: 1 })
    const res = unwrap(raw, supported)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('version')
  })

  it('unwrap 失败：reason=crc（crc 被篡改/截断）', () => {
    const raw = JSON.parse(wrap(10, { hp: 100 })) as Record<string, unknown>
    raw.crc = 0 // 篡改校验和
    const tampered = JSON.stringify(raw)
    const res = unwrap(tampered, supported)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('crc')
  })

  it('unwrap：payload 被手改后 magic/version 仍 ok，但 crc 挡住', () => {
    const raw = JSON.parse(wrap(10, { hp: 100 })) as Record<string, unknown>
    const payload = raw.payload as Record<string, unknown>
    payload.hp = 9999 // 手改档
    const tampered = JSON.stringify(raw)
    const res = unwrap(tampered, supported)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('crc')
  })
})
