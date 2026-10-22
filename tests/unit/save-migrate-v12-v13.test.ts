/**
 * migrateV12toV13 守卫（src/save/Serializer.ts）。
 *
 * v12 → v13（KI-112 第一腿）。玩法/辅助设置跟着档走：老档没有 gameplay 块 ⇒ 迁移**不写**这格
 * （保持 undefined）——读档侧 `restore(undefined)` 是明确的"不动"，运行时保持当前值
 * （§78：留空是如实；写一份假默认反而谎称"那份档调过设置"）。
 *
 * 与 v11→v12（那一步会写 `{ audio: {} }`）恰恰相反：这一步**什么设置都不补**。这正是它最容易
 * 被改错的地方——有人顺着 v11→v12 的"补一个空设置块"思路，会给 v12→v13 也补一个 `gameplay`，
 * 于是老档被谎称"调过玩法设置"。save.test.ts 只断言了 `settings.audio.master`（v11→v12 那一支），
 * 从不断言"v12→v13 绝不补 gameplay"，所以这是真缺口（双条件：零直接读者 + 真链未验其特定契约）。
 *
 * 锁的要点：
 *   1. 输出 `snapshot.version === 13`；
 *   2. 输入带 `settings: { audio: {} }` ⇒ 输出原样保留、**绝不新增 `settings.gameplay`**；
 *   3. 输入没有任何 settings ⇒ 输出的 settings 仍为 undefined（不补空块、不谎称调过设置）；
 *   4. 其它快照字段原样保留，且不修改入参（纯迁移）；
 *   5. 链上真接上：migrateTo(p, 12, 13) 等价于直接调这一步。
 */
import { describe, expect, it } from 'vitest'
import { migrateV12toV13 } from '@/save/Serializer'
import { migrateTo } from '@/save/Migration'

function v12(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    snapshot: {
      version: 12,
      flags: { 'flag.left_resthold': true },
      rpg: { rank: 9 },
      ...extra,
    },
  }
}

describe('migrateV12toV13', () => {
  it('直接调用：version 顶到 13', () => {
    const out = migrateV12toV13(v12()) as { snapshot: Record<string, unknown> }
    expect(out.snapshot.version).toBe(13)
  })

  it('输入带 settings.audio ⇒ 原样保留，且绝不新增 settings.gameplay（防谎称调过玩法设置）', () => {
    const out = migrateV12toV13(v12({ settings: { audio: {} } })) as { snapshot: Record<string, unknown> }
    expect(out.snapshot.settings).toEqual({ audio: {} })
    expect((out.snapshot.settings as Record<string, unknown>).gameplay).toBeUndefined()
  })

  it('输入没有任何 settings ⇒ 输出 settings 仍为 undefined（不补空块、不谎称调过设置）', () => {
    const out = migrateV12toV13(v12()) as { snapshot: Record<string, unknown> }
    expect(out.snapshot.settings).toBeUndefined()
  })

  it('纯迁移：不修改入参、其它字段原样保留', () => {
    const input = v12({ settings: { audio: {} } })
    const before = JSON.stringify(input)
    const out = migrateV12toV13(input) as { snapshot: Record<string, unknown> }
    expect(JSON.stringify(input)).toBe(before)
    expect(out.snapshot.flags).toEqual({ 'flag.left_resthold': true })
    expect(out.snapshot.rpg).toEqual({ rank: 9 })
  })

  it('在迁移链上真的被接上：migrateTo(p, 12, 13) 等价于直接调这一步', () => {
    const out = migrateTo(v12({ settings: { audio: {} } }), 12, 13) as { snapshot: Record<string, unknown> }
    expect(out.snapshot.version).toBe(13)
    expect(out.snapshot.settings).toEqual({ audio: {} })
    expect((out.snapshot.settings as Record<string, unknown>).gameplay).toBeUndefined()
  })
})
