import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as path from 'node:path'
import {
  DRL_DEFAULTS,
  DRL_PROTOCOLS,
  DRL_SCENARIOS,
  createLocalBucketCluster,
  createCentralRedisBucket,
  createShardedBucket,
  runDistributedRateLimitScenario,
  compareDistributedRateLimit,
  distributedRateLimitStudy,
  drlSnapshot,
} from '../../scripts/caesura-distributed-ratelimit.mjs'

/** 固定时钟 + 固定 seed：本件是确定性故障场景结构计数、非墙钟/QPS 跑分，注入不影响任何判词。 */
const fixedNow = () => () => 1000
const inj = () => ({ seed: 510, now: fixedNow() })
const keysOf = (n: number) => Array.from({ length: n }, (_, i) => 'k:' + i)
const riggedFaults = () => DRL_SCENARIOS.map(() => ({}))

describe('KI-510 分布式限流的分布式化：本地桶 / Redis 中心桶 / 一致性哈希分片桶三协议诚实权衡', () => {
  /* ---------------- ① 常量 / 导出 / 名册 ---------------- */
  it('① 缺省参数冻结、10 枚值导出齐全、三协议/六场景常量齐（decl-parity 严格同名）', () => {
    expect(Object.isFrozen(DRL_DEFAULTS)).toBe(true)
    expect([...DRL_PROTOCOLS]).toEqual(['Local', 'Central', 'Sharded'])
    expect([...DRL_SCENARIOS]).toEqual([
      'allOk', 'burstSameKey', 'skewKeys', 'centerDown', 'scaleOut', 'multiInstance',
    ])
    for (const fn of [
      createLocalBucketCluster, createCentralRedisBucket, createShardedBucket,
      runDistributedRateLimitScenario, compareDistributedRateLimit,
      distributedRateLimitStudy, drlSnapshot,
    ]) expect(typeof fn).toBe('function')
    expect(DRL_DEFAULTS.instances).toBeGreaterThan(1)
    expect(DRL_DEFAULTS.shards).toBeGreaterThanOrEqual(2)
    expect(DRL_DEFAULTS.capacity).toBeGreaterThan(0)
    expect(DRL_DEFAULTS.rigged).toBe(false)
    expect(DRL_DEFAULTS.seed).toBeGreaterThan(0)
  })

  /* ---------------- ② Local 每实例本地桶 ---------------- */
  it('② Local N 副本各持满额桶 ⇒ 放行 instances×capacity 超发 N 倍、零中心 RTT', () => {
    const c = createLocalBucketCluster({ ...inj(), instances: 4, capacity: 8 })
    const r = c.feed(keysOf(64), { concurrent: true })
    expect(r.protocol).toBe('Local')
    expect(r.perInstance).toEqual([16, 16, 16, 16])   // 多实例并发均匀铺开
    expect(r.allowed).toBe(32)                        // 4 副本 × 8 配额 = 32，名义只应 8
    expect(r.overAllowed).toBe(24)                    // 超发 N×C − C
    expect(r.centerRounds).toBe(0)                    // 本地判定零中心往返
    expect(c.instances).toBe(4)
    expect(c.capacity).toBe(8)
  })
  it('③ Local 实例故障隔离不连坐：命中宕机实例的请求由活实例兜底、记 isolatedFailures', () => {
    const c = createLocalBucketCluster({ ...inj(), instances: 4, capacity: 8 })
    const r = c.feed(keysOf(64), { downNodes: 1 })
    expect(r.isolatedFailures).toBeGreaterThan(0)
    expect(r.allowed).toBeGreaterThan(0)             // 不因一台宕机全瘫
    expect(r.centerRounds).toBe(0)
  })
  it('④ Local reset 归零、单副本（rigged 映射 instances:1）⇒ 超发成因消失', () => {
    const c = createLocalBucketCluster({ ...inj(), instances: 1, capacity: 8 })
    const multi = createLocalBucketCluster({ ...inj(), instances: 4, capacity: 8 })
    multi.feed(keysOf(64), { concurrent: true })
    multi.reset()
    expect(multi.feed(keysOf(64), { concurrent: true }).allowed).toBe(32) // reset 后可复现
    // 单实例：只有一只桶，allowed ≤ capacity，无 N×C 超发
    const single = createLocalBucketCluster({ ...inj(), instances: 1, capacity: 8 })
    const rs = single.feed(keysOf(64), { concurrent: true })
    expect(rs.allowed).toBe(8)
    expect(rs.overAllowed).toBe(0)
    expect(c.instances).toBe(1)
  })

  /* ---------------- ③ Central Redis 中心化原子桶 ---------------- */
  it('⑤ Central 全局配额精确 = C、allowed 永不超 capacity、每请求 1 次中心 RTT、单 key 热点', () => {
    const b = createCentralRedisBucket({ ...inj(), capacity: 8 })
    const r = b.feed(keysOf(64), {})
    expect(r.protocol).toBe('Central')
    expect(r.allowed).toBe(8)
    expect(r.overAllowed).toBe(0)
    expect(r.centerRounds).toBe(64)                  // 每请求都进中心
    expect(r.hotKeyHits).toBe(64)                    // 全部挤同一个全局 key
    expect(r.centerStalled).toBe(0)
  })
  it('⑥ Central 中心宕机 ⇒ 全集群限流失效（允许 0、全 stalled）、reset 后可恢复', () => {
    const b = createCentralRedisBucket({ ...inj(), capacity: 8 })
    const down = b.feed(keysOf(64), { centerDown: true })
    expect(down.allowed).toBe(0)
    expect(down.rejected).toBe(64)
    expect(down.centerStalled).toBe(64)
    expect(down.centerRounds).toBe(0)
    b.reset()
    expect(b.feed(keysOf(64), {}).allowed).toBe(8)    // reset 恢复满桶
  })
  it('⑦ Central centerAvailable rigged ⇒ centerDown 故障失效、照常精确放行', () => {
    const b = createCentralRedisBucket({ ...inj(), capacity: 8, centerAvailable: true })
    const r = b.feed(keysOf(64), { centerDown: true })
    expect(r.allowed).toBe(8)
    expect(r.centerStalled).toBe(0)
  })
  it('⑧ 真件交叉印证：createRedisTokenBucket 原子桶恰好 capacity、非原子并发丢失更新超发', async () => {
    const b = createCentralRedisBucket({ ...inj(), capacity: 8, concurrency: 64 })
    const cx = await b.crosscheck()
    expect(cx.source).toContain('createRedisTokenBucket')
    expect(cx.atomicAllowed).toBe(8)
    expect(cx.atomicExact).toBe(true)
    expect(cx.nonAtomicAllowed).toBe(64)             // N 并发都读同一满桶、各自放行
    expect(cx.nonAtomicOvershoot).toBe(56)
  })

  /* ---------------- ④ Sharded 一致性哈希分片桶 ---------------- */
  it('⑨ Sharded 复用真环分布：均匀环 spread 小、无空片、balanceRatio 有限', () => {
    const b = createShardedBucket({ ...inj(), shards: 4, capacity: 8 })
    const cx = b.crosscheck(keysOf(512))
    expect(cx.source).toContain('createHashRing')
    expect(cx.balanceRatio).not.toBe(null)
    expect(cx.balanceRatio!).toBeGreaterThan(0)
    expect(cx.emptyNodes).toEqual([])
    expect(cx.spread).toBeGreaterThanOrEqual(0)
    expect(b.shards).toBe(4)
    expect(b.perShardCap).toBe(2)                    // floor(8/4)
  })
  it('⑩ Sharded 配额碎片化早拒：同 key / 倾斜下热片先耗尽，冷片有余 ⇒ fragmented>0 且 allowed<名义', () => {
    const b = createShardedBucket({ ...inj(), shards: 4, capacity: 8, skewRatio: 0.8 })
    const r = b.feed(keysOf(64), { skew: true })
    expect(r.protocol).toBe('Sharded')
    expect(r.fragmented).toBeGreaterThan(0)
    expect(r.allowed).toBeLessThan(8)                // 名义 8，热片耗尽后早拒
    expect(r.overAllowed).toBe(0)                    // 但绝不超发
    expect(r.centerRounds).toBe(64)                  // 仍吃中心 RTT
    const leftover = Object.values(r.shardAllowed).reduce((s: number, v: any) => s + (v as number), 0)
    expect(leftover).toBe(r.allowed)                 // 各片放行合计 = 总放行
  })
  it('⑪ Sharded 单片故障只降级该片：degradedShard>0 但其它片照常放行（部分容错）', () => {
    const b = createShardedBucket({ ...inj(), shards: 4, capacity: 8 })
    const r = b.feed(keysOf(64), { downNodes: 1 })
    expect(r.degradedShard).toBeGreaterThan(0)
    expect(r.allowed).toBeGreaterThan(0)             // 不连坐全部分片
    expect(r.centerRounds).toBeLessThan(64)          // 宕机片不再往返
  })
  it('⑫ 真环交叉印证：坏 hashFn 量出配额碎片成因（spread 悬殊 + 空片）+ 扩容最小重映射', () => {
    const b = createShardedBucket({ ...inj(), shards: 4, capacity: 8 })
    const cx = b.crosscheck(keysOf(512), 5)
    expect(cx.skewSpread).toBeGreaterThan(cx.spread) // 偏斜环命中极差远大于均匀环
    expect(cx.skewEmptyNodes).toBeGreaterThan(0)     // 有片零命中 ⇒ 真件除零保护 skewBalanceRatio=null
    expect(cx.skewBalanceRatio).toBe(null)
    expect(cx.remapRate).toBeGreaterThan(0)
    expect(cx.remapRate).toBeLessThan(cx.moduloRate) // 一致性哈希迁移 < 朴素取模
    expect(cx.emptyNodes).toEqual([])
  })
  it('⑬ Sharded reset 归零：重建环与配额后可复现同一读数', () => {
    const b = createShardedBucket({ ...inj(), shards: 4, capacity: 8, skewRatio: 0.8 })
    const a = b.feed(keysOf(64), { skew: true })
    b.reset()
    const c = b.feed(keysOf(64), { skew: true })
    expect(c.allowed).toBe(a.allowed)
    expect(c.fragmented).toBe(a.fragmented)
  })

  /* ---------------- ⑤ 对照矩阵 + 三难向量 + 判词 ---------------- */
  it('⑭ 三协议 × 六场景矩阵形状齐：3 行 × 6 格、totals 五字段全为有限数（无 NaN/null 污染）', async () => {
    const cmp = await compareDistributedRateLimit(inj())
    expect(cmp.rows.length).toBe(3)
    for (const row of cmp.rows) {
      expect(row.scenarios.length).toBe(6)
      expect(row.scenarios.map((s: any) => s.id)).toEqual([...DRL_SCENARIOS])
      for (const k of ['allowed', 'rejected', 'overAllowed', 'centerRounds', 'fragmented'] as const) {
        expect(Number.isFinite((row.totals as any)[k]), `${row.protocol}.totals.${k}`).toBe(true)
      }
      for (const cell of row.scenarios) {
        for (const k of ['isolatedFailures', 'degradedShard', 'fragmented'] as const) {
          expect(Number.isFinite((cell as any)[k]), `${row.protocol}/${cell.id}.${k}`).toBe(true)
        }
      }
    }
  })
  it('⑮ 三难向量 011 / 100 / 010：三者互异、无一 111（Sharded 只占容错一维、不是银弹）', async () => {
    const cmp = await compareDistributedRateLimit(inj())
    expect(cmp.vectors).toEqual({ Local: '011', Central: '100', Sharded: '010' })
    expect(new Set(Object.values(cmp.vectors)).size).toBe(3)
    expect(Object.values(cmp.vectors).every((v) => v !== '111')).toBe(true)
    expect(cmp.rows[2].trilemma.globalExact).toBe(false)
    expect(cmp.rows[2].trilemma.partialFaultTolerance).toBe(true)
    expect(cmp.rows[2].trilemma.noCenterRTT).toBe(false)
  })
  it('⑯ 七条判词逐条真、noUniversalWinner 真', async () => {
    const v = (await compareDistributedRateLimit(inj())).verdict
    const keys: Array<keyof typeof v> = [
      'trilemmaDistinguishes', 'noProtocolWinsAll', 'noUniversalWinner',
      'localOvershoots', 'centralExact', 'shardedFragmented', 'shardedNotPanacea',
    ]
    for (const k of keys) expect(v[k], k).toBe(true)
  })
  it('⑰ 故障映射诚实：三协议软肋各打各的、不打不相关格', async () => {
    const rows = (await compareDistributedRateLimit(inj())).rows
    const [local, central, sharded] = rows
    // Local：六场景全超发、零中心 RTT
    expect(local.scenarios.every((s) => s.overAllowed > 0 && s.centerRounds === 0)).toBe(true)
    // Central：只 centerDown 全瘫，其余五格 allowed=capacity、全局精确
    expect(central.scenarios.find((s) => s.id === 'centerDown')!.allowed).toBe(0)
    expect(central.scenarios.filter((s) => s.id !== 'centerDown').every((s) => s.allowed === 8 && s.globalExact)).toBe(true)
    // Sharded：只同 key / 倾斜 / 宕片三格碎片或降级，干净格全局精确
    const byId = (id: string) => sharded.scenarios.find((s) => s.id === id)!
    expect(byId('burstSameKey').fragmented).toBeGreaterThan(0)
    expect(byId('skewKeys').fragmented).toBeGreaterThan(0)
    expect(byId('centerDown').degradedShard).toBeGreaterThan(0)
    expect(byId('allOk').globalExact).toBe(true)
    expect(byId('scaleOut').globalExact).toBe(true)
  })

  /* ---------------- ⑥ rigged 可证伪 ---------------- */
  it('⑱ rigged 可证伪：抹掉三类软肋 ⇒ 三协议全退化 111、三判词同时翻 false', async () => {
    const cmp = await compareDistributedRateLimit({ ...inj(), rigged: true })
    expect(cmp.vectors).toEqual({ Local: '111', Central: '111', Sharded: '111' })
    expect(cmp.verdict.trilemmaDistinguishes).toBe(false)
    expect(cmp.verdict.noProtocolWinsAll).toBe(false)
    expect(cmp.verdict.noUniversalWinner).toBe(false)
    expect(cmp.verdict.localOvershoots).toBe(false)
    expect(cmp.verdict.shardedFragmented).toBe(false)
    expect(cmp.verdict.shardedNotPanacea).toBe(false)
    expect(cmp.config.rigged).toBe(true)
  })
  it('⑲ rigged 四开关显式组合 + 六场景 fault:{} 全空 ⇒ 与 rigged:true 同一判定分支', async () => {
    const cmp = await compareDistributedRateLimit({
      ...inj(),
      singleInstance: true, centerAvailable: true, perfectBalance: true, balancedKeys: true,
      faults: riggedFaults(),
    })
    expect(cmp.config.rigged).toBe(true)
    expect(cmp.vectors).toEqual({ Local: '111', Central: '111', Sharded: '111' })
    expect(cmp.verdict.noUniversalWinner).toBe(false)
  })
  it('⑳ 关键教训钉死：配额碎片有环偏斜 + key 倾斜两个独立成因，只 perfectBalance 救不了', () => {
    const base = { ...inj(), perfectBalance: true, centerAvailable: true }
    // 完美均匀的环，但同 key 突发 → 仍碎片（同 key 必落同片）
    const skewed = runDistributedRateLimitScenario('Sharded', 'burstSameKey', { ...base, balancedKeys: false })
    expect(skewed.fragmented).toBeGreaterThan(0)
    expect(skewed.globalExact).toBe(false)
    expect(skewed.noCenterRTT).toBe(true)
    // 追加 balancedKeys 抹掉 key 倾斜这一成因后，才全局精确
    const balanced = runDistributedRateLimitScenario('Sharded', 'burstSameKey', { ...base, balancedKeys: true })
    expect(balanced.fragmented).toBe(0)
    expect(balanced.globalExact).toBe(true)
  })

  /* ---------------- ⑦ 单格 / study / snapshot / 降级 / 确定性 ---------------- */
  it('㉑ runDistributedRateLimitScenario 单格形状齐、未知协议/场景抛错', () => {
    const r = runDistributedRateLimitScenario('Central', 'centerDown', inj())
    expect(r.id).toBe('centerDown')
    expect(r.allowed).toBe(0)
    expect(typeof r.globalExact).toBe('boolean')
    expect(typeof r.partialFaultTolerance).toBe('boolean')
    expect(typeof r.noCenterRTT).toBe('boolean')
    expect(() => runDistributedRateLimitScenario('bogus', 'allOk', inj())).toThrow(/未知协议/)
    expect(() => runDistributedRateLimitScenario('Local', 'bogus', inj())).toThrow(/未知场景/)
  })
  it('㉒ distributedRateLimitStudy：七条判词全真 + topology 四字段 + builtAt 走注入时钟', async () => {
    const s = await distributedRateLimitStudy({ ...inj(), now: () => 4242 })
    const verdictBools = Object.entries(s.verdict).filter(([k]) => k !== 'vectors').map(([, v]) => v)
    expect(verdictBools.length).toBeGreaterThan(0)
    expect(verdictBools.every((v) => v === true)).toBe(true)
    expect(s.topology).toEqual({ instances: 4, shards: 4, capacity: 8, perShardCap: 2 })
    expect(s.builtAt).toBe(4242)
  })
  it('㉓ drlSnapshot 纯数据：3 行 × 6 格 + 真依赖交叉印证 + JSON 往返逐字一致', async () => {
    const snap = drlSnapshot(await distributedRateLimitStudy(inj()))
    expect(snap).not.toBe(null)
    expect(snap!.rows.length).toBe(3)
    expect(snap!.config.scenarios.length).toBe(6)
    expect(snap!.rows[0].scenarios.length).toBe(6)
    expect(snap!.crosscheck.central.atomicExact).toBe(true)
    expect(snap!.crosscheck.sharded.skewEmptyNodes).toBeGreaterThan(0)
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap)
  })
  it('㉔ drlSnapshot(null / undefined) 诚实降级为 null（不连坐其它维）', () => {
    expect(drlSnapshot(null)).toBe(null)
    expect(drlSnapshot(undefined)).toBe(null)
  })
  it('㉕ 注入确定性：同注入双跑 study 的 snapshot 逐字一致', async () => {
    const a = drlSnapshot(await distributedRateLimitStudy(inj()))
    const b = drlSnapshot(await distributedRateLimitStudy(inj()))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
  it('㉖ 真依赖交叉印证确定性：原子/非原子读数 + 真环分布双跑一致', async () => {
    const a = (await distributedRateLimitStudy(inj())).crosscheck
    const b = (await distributedRateLimitStudy(inj())).crosscheck
    expect(a).toEqual(b)
  })
  it('㉗ 参数注入变体（实例/分片/配额/请求数变）仍守结构不变量', async () => {
    const cmp = await compareDistributedRateLimit({ ...inj(), instances: 2, shards: 3, capacity: 12, requests: 40 })
    expect(new Set(Object.values(cmp.vectors)).size).toBe(3)
    expect(cmp.verdict.noUniversalWinner).toBe(true)
    expect(cmp.verdict.localOvershoots).toBe(true)
    expect(cmp.verdict.centralExact).toBe(true)
    expect(cmp.verdict.shardedFragmented).toBe(true)
  })
  it('㉘ 边界健壮：极小配额 + 零请求不抛错、snapshot 结构完整可 JSON 往返', async () => {
    const s = await distributedRateLimitStudy({ ...inj(), capacity: 1, shards: 2, requests: 0 })
    const snap = drlSnapshot(s)!
    expect(snap.rows.length).toBe(3)
    expect(snap.rows.every((r) => r.scenarios.length === 6)).toBe(true)
    expect(() => JSON.stringify(snap)).not.toThrow()
  })
  it('㉙ CLI 固定时钟双跑字节一致、可证伪自证行落地（headless 可执行）', () => {
    const script = path.resolve(process.cwd(), 'scripts/caesura-distributed-ratelimit.mjs')
    const a = execFileSync(process.execPath, [script], { encoding: 'utf8' })
    const b = execFileSync(process.execPath, [script], { encoding: 'utf8' })
    expect(a).toBe(b)
    expect(a).toContain('RIGGED_FALSIFIABLE_OK')
    expect(a).toContain('"Local":"011","Central":"100","Sharded":"010"')
  })
})
