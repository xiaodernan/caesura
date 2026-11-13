import { describe, expect, it } from 'vitest'
import {
  SPRING_VAULT_DEFAULTS,
  SPRING_VAULT_SCENARIOS,
  SPRING_VAULT_STRATEGIES,
  createK8sStatic,
  createAppRoleLease,
  createDynamicRotation,
  springVaultStudy,
  springVaultSnapshot,
  verifyCausalLocks,
  verifySpringVaultSoundness,
  createSpringVaultEvidence,
} from '../../scripts/caesura-spring-vault.mjs'

/** KI-554 Spring Cloud Vault 三策略教学件（P8 第六十一件） */

describe('caesura-spring-vault（KI-554）', () => {
  it('默认值/策略/场景 顺序稳定', () => {
    expect(SPRING_VAULT_STRATEGIES).toEqual(['K8sStatic', 'AppRoleLease', 'DynamicRotation'])
    expect(SPRING_VAULT_SCENARIOS).toEqual(['cleanSteadyState', 'burstOverload', 'leaseExhaustion', 'cleanRerun'])
    expect(SPRING_VAULT_DEFAULTS.seed).toBe(554)
    expect(SPRING_VAULT_DEFAULTS.messages).toBe(96)
  })

  it('K8sStatic：staticLease=true · leaseRefresh=false · rotation=false', () => {
    const k = createK8sStatic({})
    expect(k.staticLease).toBe(true)
    expect(k.leaseRefresh).toBe(false)
    expect(k.rotation).toBe(false)
    expect(k.invoke([{ id: 'a' }, { id: 'b' }]).processed).toBe(2)
  })

  it('AppRoleLease：staticLease=false · leaseRefresh=true · rotation=false（lease+renew，凭证本身不换）', () => {
    const a = createAppRoleLease({})
    expect(a.staticLease).toBe(false)
    expect(a.leaseRefresh).toBe(true)
    expect(a.rotation).toBe(false)
    expect(a.invoke(Array.from({ length: 5 }, (_, i) => ({ id: 'r' + i }))).processed).toBe(5)
  })

  it('DynamicRotation：staticLease=false · leaseRefresh=false · rotation=true（每次新凭证）', () => {
    const d = createDynamicRotation({})
    expect(d.staticLease).toBe(false)
    expect(d.rotation).toBe(true)
    expect(d.invoke(Array.from({ length: 5 }, (_, i) => ({ id: 'd' + i }))).processed).toBe(5)
  })

  it('四个场景 cell 全覆盖 · vectors 与 trilemma 同源', () => {
    const s = springVaultStudy({})
    for (const row of s.rows) expect(row.scenarios.length).toBe(SPRING_VAULT_SCENARIOS.length)
    for (const row of s.rows) {
      expect(s.vectors[row.protocol])
        .toBe(`${Number(row.trilemma.staticLease)}${Number(row.trilemma.leaseRefresh)}${Number(row.trilemma.rotation)}`)
    }
  })

  it('默认向量 100/010/001 · noUniversalWinner · distinguishable · vectorFromTrilemma · noStrategyWinsAll', () => {
    const s = springVaultStudy({ now: () => 554000 })
    expect(s.vectors).toEqual({ K8sStatic: '100', AppRoleLease: '010', DynamicRotation: '001' })
    expect(new Set(Object.values(s.vectors)).size).toBe(3)
    expect(s.verdict.noUniversalWinner).toBe(true)
    expect(s.verdict.trilemmaDistinguishes).toBe(true)
    expect(s.verdict.noStrategyWinsAll).toBe(true)
    expect(s.verdict.vectorFromTrilemma).toBe(true)
    expect(s.builtAt).toBe(554000)
  })

  it('单旗 rigged：freeStaticLease → K8sStatic 100→110', () => {
    const s = springVaultStudy({ freeStaticLease: true, now: () => 554000 })
    expect(s.vectors.K8sStatic).toBe('110')
    expect(s.vectors.AppRoleLease).toBe('010')
    expect(s.vectors.DynamicRotation).toBe('001')
  })

  it('单旗 rigged：freeRotation → DynamicRotation 001→111', () => {
    const s = springVaultStudy({ freeRotation: true, now: () => 554000 })
    expect(s.vectors.DynamicRotation).toBe('111')
    expect(s.vectors.K8sStatic).toBe('100')
    expect(s.vectors.AppRoleLease).toBe('010')
  })

  it('rigged 三路一起开 → 110/010/111 · noUniversalWinner=false · vectorFromTrilemma=true', () => {
    const rig = springVaultStudy({ rigged: true, now: () => 554000 })
    expect(rig.vectors).toEqual({ K8sStatic: '110', AppRoleLease: '010', DynamicRotation: '111' })
    expect(rig.verdict.noUniversalWinner).toBe(false)
    expect(rig.verdict.vectorFromTrilemma).toBe(true)
  })

  it('三因果锁全 hold（causalLocksAllHold=true）', () => {
    const r = verifyCausalLocks({ seed: 554 })
    expect(r.vaultSealCausallyUnerasable).toBe(true)
    expect(r.leaseExpiryCausallyUnerasable).toBe(true)
    expect(r.dynamicSecretCausallyUnerasable).toBe(true)
    expect(r.causalLocksAllHold).toBe(true)
  })

  it('verifySpringVaultSoundness：holds=true / nontrivial=true / falsifiable · 三路篡改真喂回 holds=false', () => {
    const events = Array.from({ length: 96 }, (_, i) => ({ id: 'v:' + i, op: 'secret-get', path: 'secret/app/0', ttl: 3600 }))
    const r = verifySpringVaultSoundness({ events, seed: 554, messages: 96 }, { seed: 554 })
    expect(r.holds).toBe(true)
    expect(r.nontrivial).toBe(true)
    expect(r.laneA.k8sStaticProcessed).toBe(96)
    expect(r.laneB.appRoleLeaseProcessed).toBe(96)
    expect(r.tamper.k8sNoUnseal.holds).toBe(false)
    expect(r.tamper.leaseExpiryCascade.holds).toBe(false)
    expect(r.tamper.dynamicRpsLost.holds).toBe(false)
  })

  it('空 events → holds=false / nontrivial=false', () => {
    const r = verifySpringVaultSoundness({ events: [], seed: 554 })
    expect(r.holds).toBe(false)
    expect(r.nontrivial).toBe(false)
  })

  it('springVaultSnapshot：快照一致性 + null/{} 返回 null', () => {
    const s = springVaultStudy({ now: () => 554000 })
    const snap = springVaultSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.vectors).toEqual(s.vectors)
    expect(springVaultSnapshot(null as never)).toBe(null)
    expect(springVaultSnapshot({} as never)).toBe(null)
  })

  it('createSpringVaultEvidence：21 个证据键 + 关键 API 真跑过', () => {
    const ev = createSpringVaultEvidence({ seed: 554, now: () => 554000 }) as unknown as Record<string, number>
    expect(Object.keys(ev).length).toBeGreaterThanOrEqual(21)
    expect(ev.redisBitmapHits).toBeGreaterThan(0)
    expect(ev.walReplayed).toBeGreaterThan(0)
    expect(ev.notices).toBe(12)
    expect(ev.counterSum).toBeGreaterThan(0)
  })

  it('study.crosscheck.evidence=21 键 + soundness holds + causalLocks allHold', () => {
    const s = springVaultStudy({})
    expect(Object.keys(s.crosscheck.evidence).length).toBe(21)
    expect(s.crosscheck.soundness.holds).toBe(true)
    expect(s.causalLocks.causalLocksAllHold).toBe(true)
  })

  it('leaseExhaustion 场景含 ttl-expiry-cascade 标记（DynamicRotation 全账户瞬间过期可观察）', () => {
    const s = springVaultStudy({})
    const row = s.rows.find((r) => r.protocol === 'DynamicRotation')!
    const le = row.scenarios.find((c) => c.id === 'leaseExhaustion')!
    expect(le.fault).toBe('ttl-expiry-cascade')
    expect(le.processed).toBe(le.messages)
  })

  it('AppRoleLease 向量固定为 010（称为 AppRole renew-mode 的真实表现）', () => {
    const s = springVaultStudy({})
    expect(s.vectors.AppRoleLease).toBe('010')
    expect(s.vectors.K8sStatic).toBe('100')
    expect(s.vectors.DynamicRotation).toBe('001')
  })
})
