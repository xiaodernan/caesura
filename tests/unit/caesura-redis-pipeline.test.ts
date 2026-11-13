import { describe, expect, it } from 'vitest'
import {
  REDIS_PIPELINE_DEFAULTS,
  REDIS_PIPELINE_SCENARIOS,
  REDIS_PIPELINE_STRATEGIES,
  createPipelineBatch,
  createLuaScripting,
  createWatchCas,
  redisPipelineStudy,
  redisPipelineSnapshot,
  verifyCausalLocks,
  verifyRedisPipelineSoundness,
  createRedisPipelineEvidence,
} from '../../scripts/caesura-redis-pipeline.mjs'

/** KI-549 Redis Pipeline/Lua/WATCH-CAS 三策略教学件（P8 第五十六件） */

describe('caesura-redis-pipeline（KI-549）', () => {
  it('默认值/策略/场景 顺序稳定', () => {
    expect(REDIS_PIPELINE_STRATEGIES).toEqual(['PipelineBatch', 'LuaScripting', 'WatchCas'])
    expect(REDIS_PIPELINE_SCENARIOS).toEqual(['cleanSteadyState', 'burstOverload', 'hotContention', 'cleanRerun'])
    expect(REDIS_PIPELINE_DEFAULTS.seed).toBe(549)
    expect(REDIS_PIPELINE_DEFAULTS.messages).toBe(96)
  })

  it('PipelineBatch：atomicPerPipe=false · roundTripCount=true · contendedLockFree=true（背板批量传输不是事务）', () => {
    const p = createPipelineBatch({})
    expect(p.atomicPerPipe).toBe(false)
    expect(p.roundTripCount).toBe(true)
    expect(p.contendedLockFree).toBe(true)
    expect(p.invoke([{ id: 'a', delta: 1 }, { id: 'b', delta: 1 }]).processed).toBe(2)
  })

  it('LuaScripting：atomicPerPipe=true · roundTripCount=true · contendedLockFree=false（EVAL 原子但单线程阻塞全局）', () => {
    const lua = createLuaScripting({})
    expect(lua.atomicPerPipe).toBe(true)
    expect(lua.roundTripCount).toBe(true)
    expect(lua.contendedLockFree).toBe(false)
    expect(lua.invoke(Array.from({ length: 7 }, (_, i) => ({ id: `l:${i}` }))).processed).toBe(7)
  })

  it('WatchCas：atomicPerPipe=true · roundTripCount=false · contendedLockFree=true（乐观 CAS 无 starvation-proof）', () => {
    const cas = createWatchCas({})
    expect(cas.atomicPerPipe).toBe(true)
    expect(cas.roundTripCount).toBe(false)
    expect(cas.contendedLockFree).toBe(true)
    const out = cas.invoke(Array.from({ length: 8 }, (_, i) => ({ id: `c:${i}`, version: i % 2 })))
    expect(out.execSucceeded + out.execAborted).toBe(8)
  })

  it('四个场景 cell 全覆盖 · vectors 与 trilemma 同源', () => {
    const s = redisPipelineStudy({})
    for (const row of s.rows) expect(row.scenarios.length).toBe(REDIS_PIPELINE_SCENARIOS.length)
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.atomicPerPipe)}${Number(row.trilemma.roundTripCount)}${Number(row.trilemma.contendedLockFree)}`)
    }
  })

  it('默认向量 011/110/101 · noUniversalWinner · distinguishable · vectorFromTrilemma · noStrategyWinsAll', () => {
    const s = redisPipelineStudy({ now: () => 549000 })
    expect(s.vectors).toEqual({ PipelineBatch: '011', LuaScripting: '110', WatchCas: '101' })
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.builtAt).toBe(549000)
  })

  it('单旗 rigged：freeAtomicity 只坍缩 PipelineBatch（011→111）', () => {
    const s = redisPipelineStudy({ freeAtomicity: true, now: () => 549000 })
    expect(s.vectors.PipelineBatch).toBe('111')
    expect(s.vectors.LuaScripting).toBe('110')
    expect(s.vectors.WatchCas).toBe('101')
  })

  it('单旗 rigged：freeLua 只坍缩 LuaScripting（110→111）', () => {
    const s = redisPipelineStudy({ freeLua: true, now: () => 549000 })
    expect(s.vectors.LuaScripting).toBe('111')
    expect(s.vectors.PipelineBatch).toBe('011')
    expect(s.vectors.WatchCas).toBe('101')
  })

  it('单旗 rigged：freeCas 只坍缩 WatchCas（101→111）', () => {
    const s = redisPipelineStudy({ freeCas: true, now: () => 549000 })
    expect(s.vectors.WatchCas).toBe('111')
    expect(s.vectors.PipelineBatch).toBe('011')
    expect(s.vectors.LuaScripting).toBe('110')
  })

  it('rigged 三路一起开 → 全员 111 · noUniversalWinner=false', () => {
    const rig = redisPipelineStudy({ rigged: true, now: () => 549000 })
    expect(rig.vectors).toEqual({ PipelineBatch: '111', LuaScripting: '111', WatchCas: '111' })
    expect(rig.verdict.noUniversalWinner).toBe(false)
    expect(rig.verdict.vectorFromTrilemma).toBe(true)
  })

  it('三因果锁全 hold（causalLocksAllHold=true）', () => {
    const r = verifyCausalLocks({ seed: 549 })
    expect(r.pipelineNotAtomicCausallyUnerasable).toBe(true)
    expect(r.luaSingleThreadCausallyUnerasable).toBe(true)
    expect(r.watchLiveLockCausallyUnerasable).toBe(true)
    expect(r.causalLocksAllHold).toBe(true)
  })

  it('verifyRedisPipelineSoundness：holds=true / nontrivial=true / falsifiable · 三路篡改真喂回 holds=false', () => {
    const events = Array.from({ length: 96 }, (_, i) => ({ id: 'r:' + i, op: i % 4 === 0 ? 'incr-by' : 'read-pair', key: 'app:seq:deal', delta: 1, version: 1 }))
    const r = verifyRedisPipelineSoundness({ events, seed: 549, messages: 96 }, { seed: 549 })
    expect(r.holds).toBe(true)
    expect(r.nontrivial).toBe(true)
    expect(r.laneA.pipelineAccepted).toBe(96)
    expect(r.laneB.luaExecuted).toBe(96)
    expect(r.tamper.pipelineNotAtomic.holds).toBe(false)
    expect(r.tamper.luaLongBlock.holds).toBe(false)
    expect(r.tamper.watchLiveLock.holds).toBe(false)
  })

  it('空 events → holds=false / nontrivial=false', () => {
    const r = verifyRedisPipelineSoundness({ events: [], seed: 549 })
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
  })

  it('redisPipelineSnapshot：快照一致性 + null/{} 返回 null', () => {
    const s = redisPipelineStudy({ now: () => 549000 })
    const snap = redisPipelineSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.vectors).toEqual(s.vectors)
    expect(redisPipelineSnapshot(null as never)).toBe(null)
    expect(redisPipelineSnapshot({} as never)).toBe(null)
  })

  it('createRedisPipelineEvidence：21 个证据键 + 关键 API 真跑过', () => {
    const ev = createRedisPipelineEvidence({ seed: 549, now: () => 549000 }) as unknown as Record<string, number>
    expect(Object.keys(ev).length).toBeGreaterThanOrEqual(21)
    expect(ev.redisBitmapHits).toBeGreaterThan(0)
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.counterSum).toBeGreaterThan(0)
    expect(ev.notices).toBe(12)
  })

  it('study.crosscheck.evidence=21 键 + soundness holds + causalLocks allHold', () => {
    const s = redisPipelineStudy({})
    expect(Object.keys(s.crosscheck.evidence).length).toBe(21)
    expect(s.crosscheck.soundness.holds).toBe(true)
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })

  it('hotContention 场景含 hotkey-cascade 标记（app:seq:deal 单热 key）', () => {
    const s = redisPipelineStudy({})
    const row = s.rows.find((r) => r.protocol === 'WatchCas')!
    const hot = row.scenarios.find((c) => c.id === 'hotContention')!
    expect(hot.fault).toBe('hotkey-cascade')
    expect(hot.processed).toBe(hot.messages)
  })
})
