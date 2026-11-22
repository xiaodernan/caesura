import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { WanderingEchoes } from '@/quest/WanderingEchoes'
import type { WanderingEcho } from '@/quest/WanderingEchoes'

/**
 * KI-736 ·「拾遗」世界细节遭遇门钉：
 *   ① 运行时表：双区齐（八区各 ≥2 条）、双语非空、中文不夹英文、id 唯一；
 *   ② 运行时：确定性权重选取、会话内不重复、闸门（requiresFlag/requiresState）真拦；
 *   ③ 零 LLM / 零随机：实现里不许出现 Math.random / callLlm；
 *   ④ 接线：main.ts 真订阅 ui.region.enter、boot 补首区、validate:data 真报这张表。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')
const TABLE = 'src/data/json/wandering-echoes.json'

function loadEntries(): WanderingEcho[] {
  const raw = JSON.parse(read(TABLE)) as { entries: WanderingEcho[] }
  return raw.entries
}

describe('KI-736 · 拾遗运行时表（数据契约）', () => {
  const entries = loadEntries()
  const regions = JSON.parse(read('src/data/json/regions.json')) as Array<{ id: string }>

  it('八区每区至少两条（密度层不许形同虚设）', () => {
    for (const r of regions) {
      const n = entries.filter((e) => e.regionId === r.id).length
      expect(n, `${r.id} 只有 ${n} 条`).toBeGreaterThanOrEqual(2)
    }
  })

  it('id 唯一 + 形状合法 + 区域都存在', () => {
    const ids = new Set<string>()
    const regionIds = new Set(regions.map((r) => r.id))
    for (const e of entries) {
      expect(e.id).toMatch(/^we_[a-z0-9_]+$/)
      expect(ids.has(e.id), `重复 id ${e.id}`).toBe(false)
      ids.add(e.id)
      expect(regionIds.has(e.regionId), `未知区域 ${e.regionId}`).toBe(true)
    }
  })

  it('双语非空、中文不夹英文、长度克制', () => {
    for (const e of entries) {
      for (const k of ['titleZh', 'titleEn', 'textZh', 'textEn'] as const) {
        expect(String(e[k] ?? '').trim().length, `${e.id}.${k}`).toBeGreaterThan(0)
      }
      expect(/[A-Za-z]{2,}/.test(e.textZh), `${e.id} 中文夹英文`).toBe(false)
      expect(e.titleZh.length, `${e.id} 标题过长`).toBeLessThanOrEqual(6)
      expect(e.textZh.length, `${e.id} 正文过长`).toBeLessThanOrEqual(60)
    }
  })
})

describe('KI-736 · WanderingEchoes 运行时（确定性 + 闸门 + 不重复）', () => {
  const entries = loadEntries()

  const mk = (opts: { flags?: string[]; state?: Record<string, string>; seen?: string[] } = {}) => {
    const shown: WanderingEcho[] = []
    const flags = new Set(opts.flags ?? [])
    const echoes = new WanderingEchoes(entries, {
      hasFlag: (k) => flags.has(k),
      stateOf: (k) => opts.state?.[k] ?? null,
      onEcho: (e) => shown.push(e),
    })
    return { echoes, shown, flags }
  }

  it('确定性：同区同次序 ⇒ 同一条（两次新实例给出同一答案）', () => {
    const a = mk()
    const b = mk()
    const first = a.echoes.onRegionEnter('rg_resthold')
    const second = b.echoes.onRegionEnter('rg_resthold')
    expect(first?.id).toBe(second?.id)
    expect(first).not.toBeNull()
  })

  it('会话内不重复：连续进场把该区候选看尽后归于安静', () => {
    const { echoes, shown } = mk()
    const pool = echoes.eligible('rg_resthold')
    expect(pool.length).toBeGreaterThanOrEqual(2)
    const picked: string[] = []
    for (let i = 0; i < pool.length; i += 1) {
      const e = echoes.onRegionEnter('rg_resthold')
      expect(e).not.toBeNull()
      picked.push(e!.id)
    }
    expect(new Set(picked).size).toBe(pool.length)
    expect(echoes.onRegionEnter('rg_resthold')).toBeNull()
    expect(shown.length).toBe(pool.length)
    expect(echoes.seenIds.length).toBe(pool.length)
  })

  it('闸门：requiresFlag 未立时该条不出现', () => {
    const withGate: WanderingEcho[] = [
      { id: 'we_a_gated', regionId: 'rg_resthold', titleZh: '甲', titleEn: 'A', textZh: '甲事。', textEn: 'A thing.', requiresFlag: 'flag.never_set' },
    ]
    const { echoes } = mk()
    const gated = new WanderingEchoes(withGate, {
      hasFlag: () => false,
      stateOf: () => null,
      onEcho: () => {},
    })
    expect(gated.eligible('rg_resthold').length).toBe(0)
    expect(gated.onRegionEnter('rg_resthold')).toBeNull()
    expect(echoes.eligible('rg_resthold').length).toBeGreaterThan(0)
  })

  it('闸门：requiresState 值不符时该条不出现', () => {
    const tbl: WanderingEcho[] = [
      { id: 'we_b_state', regionId: 'rg_resthold', titleZh: '乙', titleEn: 'B', textZh: '乙事。', textEn: 'B thing.', requiresState: { key: 'state.bells.fourth_dumb', value: 'RUNG' } },
    ]
    const mkS = (val: string) => new WanderingEchoes(tbl, { hasFlag: () => false, stateOf: () => val, onEcho: () => {} })
    expect(mkS('SEALED').eligible('rg_resthold').length).toBe(0)
    expect(mkS('RUNG').eligible('rg_resthold').length).toBe(1)
  })

  it('权重：更重的条目在固定种子上更常被选中（不是概率百分比，是确定性桶）', () => {
    const tbl: WanderingEcho[] = [
      { id: 'we_light', regionId: 'rg_x', titleZh: '轻', titleEn: 'L', textZh: '轻。', textEn: 'L.', weight: 1 },
      { id: 'we_heavy', regionId: 'rg_x', titleZh: '重', titleEn: 'H', textZh: '重。', textEn: 'H.', weight: 5 },
    ]
    let heavy = 0
    for (let i = 0; i < 60; i += 1) if (WanderingEchoes.pickWeighted(tbl, `seed#${i}`)?.id === 'we_heavy') heavy += 1
    expect(heavy).toBeGreaterThan(30)
  })

  it('resetSession 清空会话记忆（读档不恢复拾遗）', () => {
    const { echoes } = mk()
    echoes.onRegionEnter('rg_resthold')
    expect(echoes.seenIds.length).toBe(1)
    echoes.resetSession()
    expect(echoes.seenIds.length).toBe(0)
  })
})

describe('KI-736 · 零 LLM 与接线', () => {
  it('运行时实现零 LLM / 零随机', () => {
    const src = read('src/quest/WanderingEchoes.ts')
    expect(src).not.toContain('Math.random')
    expect(src).not.toContain('callLlm')
    expect(src).not.toContain('fetch(')
  })

  it('main.ts 真订阅区域事件 + boot 补首区 + 递入真实读数', () => {
    const src = read('src/main.ts')
    expect(src).toContain("bus.on('ui.region.enter'")
    expect(src).toContain('echoes.onRegionEnter(p.regionId)')
    expect(src).toContain('if (homeRegion) echoes.onRegionEnter(homeRegion.id)')
    expect(src).toContain('new WanderingEchoes(wanderingEchoesTable.entries')
  })

  it('validate:data 真报这张表（名册 + 校验函数 + 调用点）', () => {
    const src = read('scripts/validate-data.mjs')
    expect(src).toContain("'wandering-echoes.json'")
    expect(src).toContain('function validateWanderingEchoes()')
    expect(src).toContain('validateWanderingEchoes()')
  })

  it('作者侧脚本存在且产物人工闸四要素齐', () => {
    expect(existsSync(resolve(ROOT, 'scripts/ai-wandering-echoes.mjs'))).toBe(true)
    const art = JSON.parse(read('src/data/authoring/wandering-echoes-candidates.json')) as Record<string, unknown>
    expect(art.runtime).toBe(false)
    expect(art.authorOnly).toBe(true)
    expect(art.requiresHumanReview).toBe(true)
    expect(art.containsCredentials).toBe(false)
    expect(art.model).toBe('gpt-6.2-sol')
  })
})
