/**
 * 存档 schema 迁移链（需求 §45；technical-architecture §2 save/Migration.ts）。
 * 规则：读旧档**禁止**直接崩、也禁止「字段变了就静默丢掉」——每一级都要有一个显式 migrate。
 * 当前只有 v1。等 Phase 5-B（背包/装备）、5-C（任务/NPC 状态）真的加字段时，在这里注册
 * v1→v2 那一步，而不是去改 v1 的读取路径（那等于让老档悄悄坏掉）。
 */

export type Migrator = (payload: Record<string, unknown>) => Record<string, unknown>

const chain = new Map<number, Migrator>()

/** 注册「从 from 升到 from+1」的那一步（未来的真迁移与测试里的假想迁移都走这里） */
export function registerMigration(from: number, migrate: Migrator): void {
  if (chain.has(from)) throw new Error(`迁移步骤重复注册：v${from}`)
  chain.set(from, migrate)
}

/** 测试用完即撤，避免全局表被污染 */
export function unregisterMigration(from: number): void {
  chain.delete(from)
}

export function registeredSteps(): number[] {
  return [...chain.keys()].sort((a, b) => a - b)
}

export class MigrationError extends Error {
  constructor(public readonly from: number) {
    super(`缺少 v${from} → v${from + 1} 的迁移步骤`)
  }
}

/** 逐级升到 target；缺一步就抛（调用方按「回退到上一份」处理，绝不把半迁移的结果写回磁盘） */
export function migrateTo(payload: unknown, from: number, target: number): Record<string, unknown> {
  let cur = payload as Record<string, unknown>
  let v = from
  while (v < target) {
    const step = chain.get(v)
    if (!step) throw new MigrationError(v)
    cur = step(cur)
    v++
  }
  return cur
}
