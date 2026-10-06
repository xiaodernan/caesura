import { afterEach, describe, expect, it } from 'vitest'
import {
  MigrationError,
  migrateTo,
  registerMigration,
  registeredSteps,
  unregisterMigration,
} from '@/save/Migration'

/**
 * 迁移链自身的契约（需求 §45；Migration.ts 文件本体的直接测试）。
 *
 * 真实步骤（v1..v11）由 Serializer.ts 在模块加载时注册，save.test.ts 已覆盖「全链走得通」；
 * 这里只钉链机制本身：注册的查重、注销的清账、升序读数、逐级推进与缺步报错。
 * 假想迁移一律用 from=40+ 避开真实版本区间，afterEach 统一注销
 * （Migration.ts 文件头注释的「测试用完即撤」），不给同链的其他用例留残渣。
 */

const planted: number[] = []
const idStep = (p: Record<string, unknown>) => p

function plant(from: number, migrate = idStep): void {
  registerMigration(from, migrate)
  planted.push(from)
}

afterEach(() => {
  while (planted.length) unregisterMigration(planted.pop() as number)
})

describe('存档迁移链契约', () => {
  it('registerMigration：同 from 重复注册抛错；注销后重新注册不再抛', () => {
    plant(40)
    expect(() => registerMigration(40, idStep)).toThrow('迁移步骤重复注册：v40')
    unregisterMigration(40)
    expect(() => registerMigration(40, idStep)).not.toThrow()
  })

  it('registeredSteps：按升序返回链上起点，新步骤插进正确位置', () => {
    plant(42)
    plant(40)
    const steps = registeredSteps()
    expect([...steps].sort((a, b) => a - b)).toEqual(steps)
    expect(steps.filter((v) => v >= 40)).toEqual([40, 42])
  })

  it('migrateTo：逐级推进，每一步吃上一步的产出（v40→v42 两步）', () => {
    plant(40, (p) => ({ ...p, v: 41, log: [...((p.log as string[]) ?? []), '40→41'] }))
    plant(41, (p) => ({ ...p, v: 42, log: [...(p.log as string[]), '41→42'] }))
    expect(migrateTo({ v: 40 }, 40, 42)).toEqual({ v: 42, log: ['40→41', '41→42'] })
  })

  it('migrateTo：缺步抛 MigrationError 且 from 指向缺失的那一级；原始档不被半迁移污染', () => {
    plant(40, (p) => ({ ...p, v: 41 })) // v41→v42 缺步
    const src = { v: 40 }
    let err: unknown
    try {
      migrateTo(src, 40, 43)
      expect.unreachable('缺步必须抛 MigrationError')
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(MigrationError)
    expect((err as MigrationError).from).toBe(41)
    expect((err as MigrationError).message).toBe('缺少 v41 → v42 的迁移步骤')
    expect(src, '步骤用 spread 产出新对象，原始档不得被就地改掉一半').toEqual({ v: 40 })
  })

  it('migrateTo：from === target 零步推进，原样返回同一引用', () => {
    const payload = { v: 1, hp: 42 }
    expect(migrateTo(payload, 1, 1)).toBe(payload)
  })

  it('MigrationError：from 字段与消息指向同一级', () => {
    const e = new MigrationError(7)
    expect(e.from).toBe(7)
    expect(e.message).toBe('缺少 v7 → v8 的迁移步骤')
  })
})