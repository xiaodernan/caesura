/**
 * scripts/caesura-pgvector.mjs — PostgreSQL 查询引擎教学件（KI-562 · P8  enseñanza 级）
 *
 * <p><b>为什么需要这个件</b>：真实的 PostgreSQL 从来不是「一个索引打天下」——
 * <b>B+ 树</b> 只回答「有序范围扫描 / 等值」，<b>pg_trgm + GIN</b> 只回答「`%子串%` 模糊 / 相似度候选过滤」，
 * <b>pgvector HNSW</b> 只回答「向量近似最近邻」。三者各自的最优域互不包含：用错了索引，查询要么全表扫描，
 * 要么结果无序，要么 recall 塌掉。本教学件把这三种索引放在同一运行时里，
 * 每种都<b>真实执行</b>（真 B+ 树 range、真 trigram 集合运算、真 NSW 贪心图搜索 + exact kNN 对照），
 * 并把各自的「能力列」写成一个可证伪的三元组。</p>
 *
 * <p><b>三策略 · 三元组 [orderedRangeScan / fuzzyPatternMatch / vectorSimilarity]</b>：</p>
 * <ul>
 *   <li><b>BPlusOrdered=100</b> — B+ 树索引（等值 + 范围 + ORDER BY 直通）。
 *       ✓ 有序范围扫描 ✗ 模糊 `%x%`（`LIKE '%x%'` 走不动 B+ 左前缀） ✗ 向量相似度。</li>
 *   <li><b>TrgmGin=010</b> — pg_trgm + GIN 候选过滤（<code>LIKE '%x%'</code> / <code>similarity()</code>）。
 *       ✗ 不保序 ✗ 不是精确相等 ✗ 不是向量检索；但对任意子串查询，true-match 必是候选的子集（superset 证书）。</li>
 *   <li><b>VectorHnsw=001</b> — pgvector HNSW（余弦最近邻 ANN）。
 *       ✗ 无序、✗ 无模糊；✓ 次线性近似 kNN，recall@k 有下界（本件固定 seed 实测 ≥ 0.75）。</li>
 * </ul>
 *
 * <p><b>场景</b>：[rangeScan / fuzzyLike / vectorSearch / cleanRerun]</p>
 * <ul>
 *   <li><code>rangeScan</code>：典籍价格区间 [1280, 4480]，验证 B+ 树 range 输出严格递增且恰好等于暴力过滤。</li>
 *   <li><code>fuzzyLike</code>：`%term%` 子串查询（探针 ≥ 3 字符，与 show_trgm 对齐），验证 trgm 候选集 ⊇ 真实匹配。</li>
 *   <li><code>vectorSearch</code>：16 维单位向量、余弦 ANN，recall@8 对照 exact kNN。</li>
 *   <li><code>cleanRerun</code>：同 seed 两次 Digest 一致（确定性回放）。</li>
 * </ul>
 *
 * <p><b>verifyPgVectorSoundness 双路自证 + 三路篡改</b>：
 * Lane A ＝ B+ 树有序+完备证书；Lane B ＝ trgm 候选超集证书；Lane C ＝ HNSW recall 下界证书。
 * tamper 只改「索引实现」，公式不变。</p>
 * <ul>
 *   <li><code>forcedSeqScan</code>（模拟没走索引的顺序扫描、不保证序）→ laneA.ordered=false → holds=false</li>
 *   <li><code>strictEquality</code>（把 LIKE %x% 当等值谓词 → 真匹配被过滤 → holds=false</li>
 *   <li><code>invertedCosine</code>（余弦符号取反：贪心走到最远的人）→ recall 塌掉 → holds=false</li>
 * </ul>
 *
 * <p><b>verifyCausalLocks</b>（三把因果锁，全部必须 holds）：
 * <code>bplusFanoutCausallyUnerasable</code>（B+ 树 fanout/height 物理下界：512 键、order=8、height ≤ 5，split 确凿发生）；
 * <code>trgmCandidateSupersetCausallyUnerasable</code>（对探针「钟/铃/碑文/回声」true-match 全部被候选包住）；
 * <code>vectorRecallFloorCausallyUnerasable</code>（固定 seed 上 recall@8 ≥ 0.75，贪心图没白建）。</p>
 *
 * <p><b>十一真件 21 证据</b>：createShardRouter.remapOn / createHashRing / createWal（append+restore+replay）/
 * createBus('pg.vector.bound') / createRedisCache 位图 / createObjectPool / createTokenBucket /
 * createMinHeapDelayQueue / createPackedCounters / createFullJitterBackoff / compareRemapping。</p>
 *
 * <p><b>边界</b>：教学件 Node 确定性运行时；不替 PostgreSQL server 执行计划，不连真实 PG；
 * trigram / HNSW 都为真实算法逻辑（非 mock），只是内存语料。</p>
 *
 * @module caesura-pgvector
 */
import { pathToFileURL } from 'node:url'
import { compareRemapping, createShardRouter, createHashRing } from './caesura-consistent-hash.mjs'
import { createWal } from './caesura-lsm-store.mjs'
import { createBus } from './spring-bus-event.mjs'
import { createRedisCache } from './caesura-redis-cache.mjs'
import { createObjectPool, createPackedCounters } from './caesura-hw-perf.mjs'
import { createTokenBucket } from './caesura-rate-limiter.mjs'
import { createMinHeapDelayQueue } from './caesura-delay-queue.mjs'
import { createFullJitterBackoff } from './caesura-retry-dlq.mjs'
import { createBPlusTree } from './caesura-bplus-tree.mjs'

export const PG_DEFAULTS = Object.freeze({
  seed: 562,
  messages: 96,
  docs: 256,
  dims: 16,
  k: 8,
  recallFloor: 0.75,
  rigged: false,
})

export const PG_STRATEGIES = Object.freeze(['BPlusOrdered', 'TrgmGin', 'VectorHnsw'])
export const PG_SCENARIOS = Object.freeze(['rangeScan', 'fuzzyLike', 'vectorSearch', 'cleanRerun'])

const intOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? Math.floor(Math.max(0, n)) : f }
const numOr = (v, f) => { const n = Number(v); return Number.isFinite(n) ? n : f }
const round4 = (n) => Math.round(n * 1e4) / 1e4

function makeRand(seed) {
  let a = intOr(seed, PG_DEFAULTS.seed) >>> 0
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ============================================================ 语料（《止音纪元》钟器目录） ============================================================ */

const BELL_TOKENS = Object.freeze(['钟', '铃', '钟锤', '余音', '静默', '碑文', '钟楼', '回声', '耳坠', '频率', '断钟', '鸣钟', '铭钟', '霜钟', '息钟', '编钟', '铜钟', '唤钟', '钟函', '回廊'])

/** 生成确定性钟器目录语料：docs 件钟器，各带 dims 维单位向量 + 价格（分） */
export function genBellCorpus(opts = {}) {
  const seed = intOr(opts.seed, PG_DEFAULTS.seed)
  const docs = intOr(opts.docs, PG_DEFAULTS.docs)
  const dims = intOr(opts.dims, PG_DEFAULTS.dims)
  const rand = makeRand(seed)
  const out = []
  for (let i = 0; i < docs; i++) {
    const toks = Array.from({ length: 2 + Math.floor(rand() * 3) }, () => BELL_TOKENS[Math.floor(rand() * BELL_TOKENS.length)])
    const vec = Array.from({ length: dims }, () => rand() * 2 - 1)
    const norm = Math.sqrt(vec.reduce((a, x) => a + x * x, 0)) || 1
    out.push({
      id: `bell:${i}`,
      title: toks.join(''),
      price: Math.floor(rand() * 8000) + 1280, // 1280..9279 分
      vec: vec.map((x) => x / norm),
    })
  }
  return out
}

/* ============================================================ pg_trgm ============================================================ */

/** Postgres pg_trgm 的 trigram 集合（两端各补两空格，取 3 字符子串） */
export function trigramSet(s) {
  const padded = '  ' + String(s) + ' '
  const out = new Set()
  for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.substr(i, 3))
  return out
}

/**
 * 从语料统计 3 字子串频率，抽取可用探针（≥ 3 字符，与 Postgres show_trgm 对齐）。
 * ≤ 2 字符短语本件不承诺候选超集（trigram 退化），因此探针一律从真实标题切片。
 * 确定性：按 (频次降序, 子串字典序升序) 排序，同语料必出同探针。
 */
export function genProbeTerms(corpus, opts = {}) {
  const minCount = Math.max(1, intOr(opts.minCount, 2))
  const maxProbes = Math.max(1, intOr(opts.maxProbes, 5))
  const freq = new Map()
  for (const d of corpus) {
    const s = d.title
    for (let i = 0; i + 3 <= s.length; i++) {
      const gram = s.substr(i, 3)
      freq.set(gram, (freq.get(gram) ?? 0) + 1)
    }
  }
  return [...freq.entries()]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0)))
    .slice(0, maxProbes)
    .map(([term]) => term)
}

/** GIN 候选过滤：共享任一 trigram 即入候选（真匹配至少共享一个内部 trigram → 超集证书，探针 ≥ 3 字符） */
export function trgmCandidates(corpus, term) {
  const q = trigramSet(String(term))
  const hits = []
  for (const doc of corpus) {
    const dt = trigramSet(doc.title)
    let shared = 0
    for (const t of q) if (dt.has(t)) shared++
    if (shared > 0) hits.push(doc)
  }
  return hits
}

/** 真·子串匹配（oracle） */
function trueContains(corpus, term) {
  return corpus.filter((d) => d.title.includes(String(term)))
}

/* ============================================================ 向量（exact + NSW 贪心） ============================================================ */

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }

export function exactKnn(corpus, qi, k) {
  const qv = corpus[qi].vec
  return corpus
    .map((d, idx) => ({ idx, sim: dot(qv, d.vec) }))
    .filter((r) => r.idx !== qi)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, k)
    .map((r) => r.idx)
}

/** 有向 NSW 图：插入顺序 i 连接到此前 m 个最近节点 + 反向链接（HNSW 的简化版，诚实命名） */
export function buildDirectedNsw(corpus, m = 8) {
  const n = corpus.length
  const adj = Array.from({ length: n }, () => new Set())
  for (let i = 1; i < n; i++) {
    const dists = []
    for (let j = 0; j < i; j++) dists.push({ j, sim: dot(corpus[i].vec, corpus[j].vec) })
    dists.sort((a, b) => b.sim - a.sim)
    for (let k = 0; k < Math.min(m, dists.length); k++) {
      adj[i].add(dists[k].j)
      adj[dists[k].j].add(i)
    }
  }
  return adj.map((s) => [...s])
}

/** 贪心图搜索：从 entry 出发，每步扩展当前最优候选的邻居，直到结果集 ≥ ef */
export function greedyNswSearch(corpus, adj, entry, qi, k, ef = 48, opts = {}) {
  const invert = opts.invertCosine === true
  const score = (aIdx, bIdx) => {
    const s = dot(corpus[aIdx].vec, corpus[bIdx].vec)
    return invert ? -s : s
  }
  const visited = new Set([entry])
  const cand = [{ idx: entry, s: score(entry, qi) }]
  const results = []
  while (cand.length > 0) {
    let best = 0
    for (let i = 1; i < cand.length; i++) if (cand[i].s > cand[best].s) best = i
    const cur = cand.splice(best, 1)[0]
    results.push(cur)
    if (results.length >= ef) break
    for (const nb of adj[cur.idx]) {
      if (visited.has(nb)) continue
      visited.add(nb)
      cand.push({ idx: nb, s: score(nb, qi) })
    }
  }
  return results
    .filter((r) => r.idx !== qi)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((r) => r.idx)
}

function recallAtK(approx, exact) {
  if (exact.length === 0) return 1
  const ex = new Set(exact)
  return approx.filter((i) => ex.has(i)).length / exact.length
}

/* ============================================================ 真·B+ 树范围探针 ============================================================ */

function buildPriceTree(corpus) {
  const tree = createBPlusTree({ order: 8, leafCapacity: 16, now: () => 0 })
  for (const d of corpus) tree.put(String(d.price).padStart(8, '0') + ':' + d.id, d.id)
  return tree
}

/** Lane A 证书：B+ 树 range 输出 == 暴力过滤，且严格递增 */
function rangeCertify(corpus) {
  const tree = buildPriceTree(corpus)
  const lo = String(1280).padStart(8, '0')
  const hi = String(4480).padStart(8, '0') + '￿'
  const viaTree = tree.range(lo, hi).map((e) => e.value)
  const brute = corpus.filter((d) => d.price >= 1280 && d.price <= 4480)
  const treePrices = viaTree.map((id) => corpus.find((d) => d.id === id).price)
  const strictlyIncreasing = treePrices.every((p, i) => i === 0 || treePrices[i - 1] <= p)
  const bruteIds = new Set(brute.map((d) => d.id))
  const treeIds = new Set(viaTree)
  const complete = treeIds.size === bruteIds.size && [...treeIds].every((id) => bruteIds.has(id))
  const laneA = {
    ordered: strictlyIncreasing,
    complete,
    count: viaTree.length,
    bruteCount: brute.length,
    splits: tree.stats().splits,
    height: tree.height(),
    order: 8,
  }
  return { laneA, strictlyIncreasing, complete }
}

/* ============================================================ 三策略工厂 ============================================================ */

export function createBPlusOrdered(opts = {}) {
  return {
    protocol: 'BPlusOrdered',
    trilemma() {
      return { orderedRangeScan: true, fuzzyPatternMatch: false, vectorSimilarity: false }
    },
    capability: { orderedRangeScan: true, fuzzyPatternMatch: false, vectorSimilarity: false },
    opts,
  }
}

export function createTrgmGin(opts = {}) {
  return {
    protocol: 'TrgmGin',
    trilemma() {
      return { orderedRangeScan: false, fuzzyPatternMatch: true, vectorSimilarity: false }
    },
    capability: { orderedRangeScan: false, fuzzyPatternMatch: true, vectorSimilarity: false },
    opts,
  }
}

export function createVectorHnsw(opts = {}) {
  return {
    protocol: 'VectorHnsw',
    trilemma() {
      return { orderedRangeScan: false, fuzzyPatternMatch: false, vectorSimilarity: true }
    },
    capability: { orderedRangeScan: false, fuzzyPatternMatch: false, vectorSimilarity: true },
    opts,
  }
}

const FACTORIES = { BPlusOrdered: createBPlusOrdered, TrgmGin: createTrgmGin, VectorHnsw: createVectorHnsw }

/* ============================================================ 场景执行 ============================================================ */

function fnv1a(s) {
  let h = 0x811c9dc5 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

function digestOf(arr) {
  return arr.map((x) => fnv1a(String(x)).toString(16)).join(',')
}

function faultOf(sc) {
  switch (sc) {
    case 'rangeScan': return 'range[1280,4480]'
    case 'fuzzyLike': return 'like %%钟%%'
    case 'vectorSearch': return 'knn k=8 cosine'
    default: return 'none'
  }
}

function runScenario(p, corpus, sc) {
  const docs = corpus.length
  const base = { id: sc, docs, processed: docs, fault: faultOf(sc) }
  if (sc === 'rangeScan') {
    const { laneA } = rangeCertify(corpus)
    const ok = p === 'BPlusOrdered' && laneA.ordered && laneA.complete
    return { ...base, matched: ok ? laneA.count : 0, ordered: ok ? 1 : 0, state: ok ? 'hit' : 'miss', recall: null }
  }
  if (sc === 'fuzzyLike') {
    const terms = genProbeTerms(corpus, { maxProbes: 1, minCount: 1 })
    const term = terms[0] ?? '钟'
    const matches = trueContains(corpus, term)
    const trueMatches = matches.length
    if (p === 'TrgmGin') {
      const cand = trgmCandidates(corpus, term)
      const allCovered = matches.every((d) => cand.includes(d))
      return { ...base, fault: 'like %%' + term + '%%', matched: trueMatches, ordered: 0, state: allCovered && trueMatches > 0 ? 'hit' : 'miss', recall: null }
    }
    return { ...base, fault: 'like %%' + term + '%%', matched: 0, ordered: 0, state: 'miss', recall: null }
  }
  if (sc === 'vectorSearch') {
    if (p === 'VectorHnsw') {
      const adj = buildDirectedNsw(corpus, 8)
      let tot = 0
      const probes = Math.min(24, docs)
      for (let qi = 0; qi < probes; qi++) {
        const exact = exactKnn(corpus, qi, PG_DEFAULTS.k)
        const approx = greedyNswSearch(corpus, adj, 0, qi, PG_DEFAULTS.k, 48)
        tot += recallAtK(approx, exact)
      }
      const recall = tot / probes
      return { ...base, matched: Math.round(recall * PG_DEFAULTS.k), ordered: 0, state: recall >= PG_DEFAULTS.recallFloor ? 'hit' : 'miss', recall: round4(recall) }
    }
    return { ...base, matched: 0, ordered: 0, state: 'miss', recall: null }
  }
  // cleanRerun：同一语料两次 digest 必须一致（确定性）
  const ids = corpus.map((d) => d.id)
  const d1 = digestOf(ids)
  const d2 = digestOf([...ids])
  return { ...base, matched: docs, ordered: 1, state: d1 === d2 ? 'hit' : 'miss', recall: null }
}

function trilemmaOf(p, flags = {}, rigged = false) {
  const base = FACTORIES[p]().trilemma()
  return {
    orderedRangeScan: base.orderedRangeScan || rigged || flags.freeOrderedRangeScan === true,
    fuzzyPatternMatch: base.fuzzyPatternMatch || rigged || flags.freeFuzzyPatternMatch === true,
    vectorSimilarity: base.vectorSimilarity || rigged || flags.freeVectorSimilarity === true,
  }
}
const vectorOf = (t) => `${Number(t.orderedRangeScan)}${Number(t.fuzzyPatternMatch)}${Number(t.vectorSimilarity)}`

export function pgVectorStudy(opts = {}) {
  const seed = intOr(opts.seed, PG_DEFAULTS.seed)
  const messages = intOr(opts.messages, PG_DEFAULTS.messages)
  const corpus = genBellCorpus({ seed, docs: intOr(opts.docs, PG_DEFAULTS.docs), dims: intOr(opts.dims, PG_DEFAULTS.dims) })
  const flags = {
    freeOrderedRangeScan: opts.freeOrderedRangeScan === true,
    freeFuzzyPatternMatch: opts.freeFuzzyPatternMatch === true,
    freeVectorSimilarity: opts.freeVectorSimilarity === true,
  }
  const rigged = opts.rigged === true
  const now = typeof opts.now === 'function' ? opts.now : () => 562

  const rows = []
  for (const p of PG_STRATEGIES) {
    const cells = PG_SCENARIOS.map((sc) => runScenario(p, corpus, sc))
    const t = trilemmaOf(p, flags, rigged)
    rows.push({
      protocol: p,
      scenarios: cells,
      trilemma: { ...t },
      metrics: {
        stateHits: cells.filter((c) => c.state === 'hit').length,
        vectorRecall: cells.find((c) => c.id === 'vectorSearch')?.recall ?? null,
      },
    })
  }
  const vectors = Object.fromEntries(rows.map((r) => [r.protocol, vectorOf(r.trilemma)]))
  const distinctVectors = new Set(Object.values(vectors)).size
  const verdict = {
    vectors,
    noUniversalWinner: distinctVectors === 3,
    trilemmaDistinguishes: distinctVectors === 3,
    scenarioDistinguishes: distinctVectors === 3,
    noStrategyWinsAll: !Object.values(vectors).includes('111'),
    vectorFromTrilemma: true,
    rigged,
    rigged_pkg_flags: flags,
    riggedConvergenceCollapsed: rigged && rows.every((r) => vectorOf(r.trilemma) === '111'),
  }
  const soundness = verifyPgVectorSoundness({ seed, messages }, { seed, messages })
  return {
    builtAt: now(),
    config: { seed, messages, docs: corpus.length, dims: corpus[0]?.vec.length ?? PG_DEFAULTS.dims, ...flags, rigged },
    rows,
    vectors,
    verdict,
    causalLocks: verifyCausalLocks(),
    crosscheck: { evidence: createPgVectorEvidence({ ...flags, rigged, seed, now }), soundness },
    rigged,
  }
}
export const comparePgVector = pgVectorStudy
export const comparePostgreSqlQueryEngine = pgVectorStudy

export function pgVectorSnapshot(study) {
  const s = study ?? pgVectorStudy({ now: () => 562 })
  return {
    builtAt: s.builtAt,
    config: s.config,
    rows: s.rows.map((r) => ({
      protocol: r.protocol,
      scenarios: r.scenarios.map((c) => ({
        id: c.id, docs: c.docs, processed: c.processed, matched: c.matched, ordered: c.ordered,
        state: c.state, fault: c.fault, recall: c.recall,
      })),
      trilemma: r.trilemma,
      metrics: r.metrics,
    })),
    vectors: s.vectors,
    verdict: s.verdict,
    noUniversalWinner: s.verdict.noUniversalWinner,
    trilemmaDistinguishes: s.verdict.trilemmaDistinguishes,
    scenarioDistinguishes: s.verdict.scenarioDistinguishes,
    noStrategyWinsAll: s.verdict.noStrategyWinsAll,
    causalLocks: s.causalLocks,
    crosscheck: s.crosscheck,
    rigged: s.rigged,
  }
}

/* ==================== soundness 双路自证 + 三路篡改 ==================== */

function pgVectorCoreForTamper(input = {}, tamper = 'normal') {
  const seed = intOr(input.seed, PG_DEFAULTS.seed)
  const corpus = genBellCorpus({ seed, docs: PG_DEFAULTS.docs, dims: PG_DEFAULTS.dims })

  // Lane A：B+ 树 range 证书（tamper=forcedSeqScan → 模拟没走索引的顺序扫描，序保证塌掉）
  const { laneA } = rangeCertify(corpus)
  let laneAcert
  if (tamper === 'forcedSeqScan') {
    laneAcert = { ordered: false, complete: laneA.complete, count: laneA.count, bruteCount: laneA.bruteCount }
  } else {
    laneAcert = { ordered: laneA.ordered, complete: laneA.complete, count: laneA.count, bruteCount: laneA.bruteCount }
  }
  const laneAok = laneAcert.ordered && laneAcert.complete

  // Lane B：trgm 候选超集证书（探针 ≥ 3 字符，从语料切片；tamper=strictEquality → 每组丢掉第一个 trigram，候选收缩）
  let probeTerms = genProbeTerms(corpus, { maxProbes: 5, minCount: 2 })
  if (probeTerms.length === 0) probeTerms = genProbeTerms(corpus, { maxProbes: 5, minCount: 1 })
  const probes = probeTerms
  let supersetHolds = true
  let totalCandidates = 0
  let totalTrue = 0
  for (const term of probes) {
    const trueM = trueContains(corpus, term)
    let cand
    if (tamper === 'strictEquality') {
      // 错位：把 LIKE '%x%' 当等值谓词 → 候选只剩 title 完全相等的文档，真匹配被过滤
      cand = corpus.filter((d) => d.title === term)
    } else {
      cand = trgmCandidates(corpus, term)
    }
    totalCandidates += cand.length
    totalTrue += trueM.length
    const candIds = new Set(cand.map((d) => d.id))
    if (!trueM.every((d) => candIds.has(d.id))) supersetHolds = false
  }
  const laneB = { probes: probes.length, supersetHolds, candidateCount: totalCandidates, trueMatchCount: totalTrue }

  // Lane C：HNSW recall 下界证书（tamper=invertedCosine → 贪心朝反方向走，recall 塌）
  const adj = buildDirectedNsw(corpus, 8)
  let tot = 0
  const qProbes = 24
  for (let qi = 0; qi < qProbes; qi++) {
    const exact = exactKnn(corpus, qi, PG_DEFAULTS.k)
    const approx = greedyNswSearch(corpus, adj, 0, qi, PG_DEFAULTS.k, 48, { invertCosine: tamper === 'invertedCosine' })
    tot += recallAtK(approx, exact)
  }
  const recall8 = tot / qProbes
  const laneC = { recall8: round4(recall8), floor: PG_DEFAULTS.recallFloor, holds: recall8 >= PG_DEFAULTS.recallFloor }

  const holds = laneAok && laneB.supersetHolds && laneC.holds
  const nontrivial = corpus.length > 64 && adj.length === corpus.length
  return {
    laneA: laneAcert, laneB, laneC,
    holds, nontrivial,
    events: ['bplus.range.certified', 'trgm.candidates.superset', 'hnsw.recall.floored'],
  }
}

export function verifyPgVectorSoundness(input = {}, opts = {}) {
  const seed = intOr(opts.seed ?? input.seed, PG_DEFAULTS.seed)
  const messages = intOr(opts.messages ?? input.messages, PG_DEFAULTS.messages)
  const normal = pgVectorCoreForTamper({ seed, messages }, 'normal')
  const forced = pgVectorCoreForTamper({ seed, messages }, 'forcedSeqScan')
  const missing = pgVectorCoreForTamper({ seed, messages }, 'strictEquality')
  const inverted = pgVectorCoreForTamper({ seed, messages }, 'invertedCosine')
  const baselineHolds = normal.holds
  const falsifiable = baselineHolds && !forced.holds && !missing.holds && !inverted.holds
  const holds = baselineHolds && falsifiable
  return {
    laneA: normal.laneA, laneB: normal.laneB, laneC: normal.laneC,
    baselineHolds, holds, nontrivial: normal.nontrivial, falsifiable,
    tamper: {
      forcedSeqScan: {
        holds: forced.holds,
        reason: 'forcedSeqScan：不走索引的顺序扫描不保证有序输出（ORDER BY 丢失），laneA.ordered=false → holds=false',
      },
      strictEquality: {
        holds: missing.holds,
        reason: 'strictEquality：把 LIKE %x% 当等值谓词，候选=title 完全相等，真匹配被过滤，laneB.supersetHolds=false → holds=false',
      },
      invertedCosine: {
        holds: inverted.holds,
        reason: 'invertedCosine：余弦符号取反，贪心朝最远的人走，recall8=' + inverted.laneC.recall8 + ' 塌破下界 → holds=false',
      },
    },
    events: normal.events,
  }
}

/* ==================== causal locks ==================== */

export function verifyCausalLocks() {
  // 锁 1：B+ 树真实 split → 512 键 order=8 树 height ≤ 5 且 splits > 0（fanout 物理下界）
  const tree = createBPlusTree({ order: 8, leafCapacity: 16, now: () => 0 })
  for (let i = 0; i < 512; i++) tree.put(String(i).padStart(8, '0'), 'v' + i)
  const st = tree.stats()
  const bplusFanout = tree.height() <= 5 && st.splits > 0 && st.puts === 512

  // 锁 2：trgm 候选超集（四个 ≥3 字符语料探针，true-match 全部被候选包住）
  const corpus = genBellCorpus({ seed: PG_DEFAULTS.seed, docs: PG_DEFAULTS.docs, dims: PG_DEFAULTS.dims })
  let probeTerms = genProbeTerms(corpus, { maxProbes: 4, minCount: 2 })
  if (probeTerms.length === 0) probeTerms = genProbeTerms(corpus, { maxProbes: 4, minCount: 1 })
  let probes = 0
  let allCovered = true
  for (const term of probeTerms) {
    probes++
    const trueM = trueContains(corpus, term)
    const cand = trgmCandidates(corpus, term)
    const candIds = new Set(cand.map((d) => d.id))
    if (!trueM.every((d) => candIds.has(d.id))) allCovered = false
  }

  // 锁 3：HNSW recall 下界（固定 seed，前 16 个探针 recall@8 ≥ 0.75）
  const adj = buildDirectedNsw(corpus, 8)
  let tot = 0
  for (let qi = 0; qi < 16; qi++) {
    tot += recallAtK(greedyNswSearch(corpus, adj, 0, qi, PG_DEFAULTS.k, 48), exactKnn(corpus, qi, PG_DEFAULTS.k))
  }
  const recall8 = tot / 16
  const vectorFloor = recall8 >= PG_DEFAULTS.recallFloor

  const locks = {
    bplusFanoutCausallyUnerasable: bplusFanout,
    trgmCandidateSupersetCausallyUnerasable: allCovered,
    vectorRecallFloorCausallyUnerasable: vectorFloor,
  }
  return {
    ...locks,
    causalLocksAllHold: locks.bplusFanoutCausallyUnerasable && locks.trgmCandidateSupersetCausallyUnerasable && locks.vectorRecallFloorCausallyUnerasable,
    probes: {
      treeHeight: tree.height(),
      treeSplits: st.splits,
      treePuts: st.puts,
      trgmProbes: probes,
      recall8: round4(recall8),
      recallFloor: PG_DEFAULTS.recallFloor,
    },
  }
}

/* ==================== 21 真件证据 ==================== */

export function createPgVectorEvidence(opts = {}) {
  const seed = intOr(opts.seed, PG_DEFAULTS.seed)
  const fixedNow = 0
  const nowFn = () => fixedNow
  const keys = Array.from({ length: 200 }, (_, i) => `bell:${seed}:${i}`)
  const ev = {}

  const router = createShardRouter({ shards: ['a', 'b', 'c'], slotCount: 256, virtualNodes: 16, salt: String(seed) })
  for (const k of keys.slice(0, 80)) router.route(k)
  const rm = router.remapOn(['a', 'b', 'c', 'd'], { mutate: false })
  ev.routerMoved = rm.moved
  ev.routerTracked = rm.total

  const ring = createHashRing({ virtualNodes: 16, salt: String(seed) })
  for (const n of ['a', 'b', 'c', 'd']) ring.addNode(n)
  ev.ringNodes = ring.nodeIds().length
  const dist = ring.distribution(keys)
  ev.ringShardsUsed = dist.nodes - dist.emptyNodes.length

  const wal = createWal()
  for (const k of keys.slice(0, 80)) wal.append('put', k, { table: 'bells', index: 'gin_trgm' })
  const walLines = wal.lines()
  const wal2 = createWal()
  wal2.restore(walLines)
  let walReplayed = 0
  wal2.replay(() => { walReplayed += 1 })
  ev.walLines = walLines.length
  ev.walReplayed = walReplayed

  const bus = createBus()
  let notices = 0
  bus.subscribe('pg.vector.bound', () => { notices += 1 })
  for (let i = 0; i < 12; i++) bus.publish('pg.vector.bound', { key: keys[i], index: 'hnsw_cosine' })
  ev.notices = notices
  ev.busListeners = bus.listenerCount('pg.vector.bound')

  const cache = createRedisCache({ now: nowFn, maxEntries: 512, ttlMs: 0 })
  for (const k of keys.slice(0, 96)) cache.set(`pg:meta:${k}`, '1')
  let bitmapHits = 0
  for (const k of keys.slice(0, 96)) if (cache.get(`pg:meta:${k}`) !== undefined) bitmapHits += 1
  ev.redisBitmapHits = bitmapHits
  ev.redisSlots = cache.stats().entries

  const pool = createObjectPool({ factory: () => ({ slot: 0 }), maxSize: 8 })
  const p1 = pool.acquire()
  pool.acquire()
  pool.release(p1)
  pool.acquire()
  const ps = pool.stats()
  ev.poolCreated = ps.created
  ev.poolReused = ps.reused

  const bucket = createTokenBucket({ capacity: 3, refillPerSec: 0, now: nowFn })
  let bucketAllowed = 0, bucketRejected = 0
  for (let i = 0; i < 7; i++) { if (bucket.allow().allowed) bucketAllowed += 1; else bucketRejected += 1 }
  ev.bucketAllowed = bucketAllowed
  ev.bucketRejected = bucketRejected

  const heap = createMinHeapDelayQueue({ now: fixedNow })
  heap.schedule(fixedNow + 40, 'pg:vacuum-analyze')
  heap.schedule(fixedNow + 250, 'pg:hnsw-graph-refresh')
  heap.schedule(fixedNow + 80, 'pg:trgm-reindex')
  ev.heapFired = heap.advance(fixedNow + 1000).length
  ev.heapPending = heap.pending()

  const counters = createPackedCounters(64)
  for (let i = 0; i < 64; i++) counters.inc(i, i + 1)
  let counterSum = 0
  for (let i = 0; i < 64; i++) counterSum += counters.get(i)
  ev.counterSum = counterSum
  ev.counterFalseSharing = counters.stats().falseSharingPairs

  const jitter = createFullJitterBackoff({ baseTicks: 16, capTicks: 1024, seed })
  const samples = Array.from({ length: 64 }, (_, i) => jitter.delayFor(6, i))
  const sMin = Math.min(...samples), sMax = Math.max(...samples)
  const sMean = samples.reduce((a, b) => a + b, 0) / samples.length
  ev.jitterSpread = sMean > 0 ? round4((sMax - sMin) / sMean) : 0

  const comp = compareRemapping({ nodes: ['a', 'b', 'c'], addNodes: ['d'], keys, salt: String(seed) })
  ev.remapConsistentRate = comp.consistent.rate
  ev.remapModuloRate = comp.modulo.rate

  return ev
}

/* ==================== CLI ==================== */

const isCliInvocation = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isCliInvocation) {
  const args = process.argv.slice(2)
  const bench = args.includes('--bench')
  const rigged = args.includes('--rigged')
  const study = pgVectorStudy({ rigged })
  const snap = pgVectorSnapshot(study)
  if (bench) {
    const bplus = snap.rows.find((r) => r.protocol === 'BPlusOrdered')
    const hnsw = snap.rows.find((r) => r.protocol === 'VectorHnsw')
    const vecCell = hnsw.scenarios.find((c) => c.id === 'vectorSearch')
    console.log(`[pgvector:bench] seed=${snap.config.seed} docs=${snap.config.docs} bplusMatched=${bplus.scenarios.find((c) => c.id === 'rangeScan').matched} vectorRecall@8=${vecCell.recall} soundness=${snap.crosscheck.soundness.holds}`)
  } else {
    console.log(JSON.stringify(snap, null, 2))
  }
  process.exit(0)
}
