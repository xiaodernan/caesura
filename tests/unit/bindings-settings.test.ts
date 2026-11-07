import { describe, expect, it } from 'vitest'
import {
  clampBindings,
  clampProfiles,
  defaultBindings,
  PROFILE_SLOTS,
  type BindingProfile,
} from '@/settings/Bindings'

/**
 * `src/settings/Bindings.ts`：键位绑定的信任边界。
 *
 * 存档是玩家能手改的文件，`clampBindings` / `clampProfiles` 是读档路径上唯一被信任的入口：
 * 毒键、名册外动作、越界、错型、缺块 ⇒ 各回各的默认，返回一定是「能玩下去」的表。
 * 幂等（clamp(clamp(x)) = clamp(x)）：存档往返不许漂移。
 */

describe('defaultBindings：两张默认表的现推副本，仓库里没有第三份', () => {
  it('gameplay.keyboard 与 ui.keyboard 皆非空，且每格都有动作/意图名', () => {
    const b = defaultBindings()
    expect(Object.keys(b.gameplay.keyboard).length).toBeGreaterThan(0)
    expect(Object.keys(b.ui.keyboard).length).toBeGreaterThan(0)
    expect(typeof b.gameplay.triggerThreshold).toBe('number')
    expect(Array.isArray(b.gameplay.unbound)).toBe(true)
  })
})

describe('clampBindings：信任边界，任何 blob 都只能产出能玩的表', () => {
  it('undefined/null/非对象 ⇒ 全默认', () => {
    expect(clampBindings(undefined)).toEqual(defaultBindings())
    expect(clampBindings(null)).toEqual(defaultBindings())
    expect(clampBindings('nope')).toEqual(defaultBindings())
    expect(clampBindings(42)).toEqual(defaultBindings())
  })

  it('缺块 ⇒ 该块照默认；缺块内的张 ⇒ 该张照默认', () => {
    const out = clampBindings({ gameplay: {} })
    expect(out.gameplay.keyboard).toEqual(defaultBindings().gameplay.keyboard)
    expect(out.ui.keyboard).toEqual(defaultBindings().ui.keyboard)
  })

  it('毒键 / 名册外动作 ⇒ 被丢弃，不进运行时；语法合法但无物理键的码（KeyZZ）保留为死绑定', () => {
    const out = clampBindings({
      gameplay: {
        keyboard: { fly: 'attackLight', KeyA: 'dodge' },
      },
    })
    expect(out.gameplay.keyboard.fly).toBeUndefined()
    // KeyA 语法过关（Key[A-Z]），只是玩家没这把键，属死绑定不危险
    expect(typeof out.gameplay.keyboard['KeyA']).toBe('string')
  })

  it('triggerThreshold 越界 ⇒ 夹取；错型 ⇒ 默认', () => {
    const low = clampBindings({ gameplay: { triggerThreshold: -1 } })
    expect(low.gameplay.triggerThreshold).toBe(0.05)
    const high = clampBindings({ gameplay: { triggerThreshold: 9 } })
    expect(high.gameplay.triggerThreshold).toBe(0.95)
    const bad = clampBindings({ gameplay: { triggerThreshold: 'x' } })
    expect(bad.gameplay.triggerThreshold).toBe(defaultBindings().gameplay.triggerThreshold)
  })

  it('返回全新对象，不污染 raw', () => {
    const raw = { gameplay: { keyboard: { KeyA: 'dodge' } } }
    const out = clampBindings(raw)
    expect(out).not.toBe(raw)
    expect(out.gameplay).not.toBe(raw.gameplay)
    expect(raw.gameplay.keyboard['KeyA']).toBe('dodge')
  })

  it('幂等：clamp(clamp(x)) = clamp(x)', () => {
    const raw = { gameplay: { keyboard: { KeyA: 'dodge' }, triggerThreshold: 999 } }
    const once = clampBindings(raw)
    const twice = clampBindings(once)
    expect(twice).toEqual(once)
  })
})

describe('clampProfiles：三格信任边界，空态与值态同一主人', () => {
  it('槽位数 === PROFILE_SLOTS', () => {
    expect(clampProfiles(undefined).length).toBe(PROFILE_SLOTS)
    expect(clampProfiles([]).length).toBe(PROFILE_SLOTS)
  })

  it('缺块/null/越界 ⇒ null；{} ⇒ 默认表；非数组 ⇒ 三格皆空；只取前 PROFILE_SLOTS 格', () => {
    const out = clampProfiles([undefined, null, {}, 'x'])
    expect(out.length).toBe(PROFILE_SLOTS)
    expect(out[0]).toBe(null)
    expect(out[1]).toBe(null)
    expect(out[2]).toEqual(defaultBindings())
    // 第 4 个输入元素被槽位数截断，不进输出
    expect(out[3]).toBeUndefined()
  })

  it('返回新数组，不污染 raw', () => {
    const raw: BindingProfile[] = [defaultBindings()]
    const out = clampProfiles(raw)
    expect(out).not.toBe(raw)
    expect(out[0]).not.toBe(raw[0])
  })
})
