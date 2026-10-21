/**
 * scripts/red-rate-scan.mjs — 跑测器的**机器可读判决行**：印它和读它的两份住在同一个模块里。
 *
 * 为什么要有这一行（KI-152 的第一条腿，2026-10-22）：量「负载重的那一趟会红」需要把同一文件跑 N 趟、
 * 逐趟数红了几条。第一版做法是去读 `scripts/test.mjs` 打印的那个 `完整报告留在 <tmp>\report.json`，
 * 实测八趟**全部 ENOENT**（`.scratch/ki152/red-rate.log`：`reds/0 = 0`，`SUMMARY []`）。原因在跑测器自己身上：
 * 只有红的那两条出口留着报告（`test.mjs` 注释写着"红的那一趟不删报告"），**绿的那条出口把整个临时目录
 * `rmSync` 掉**——于是"报告读不到"在成功的那一趟是常态，而读不到就被当成"这趟 0 红"，分母静默变成 0。
 * 零分母读出来的"0 红"不是没病，是没量。
 *
 * 试过把报告改到我指定的路径吗？试过，当场否证：`--outputFile` 在 vitest 那边是**单值**选项，
 * 追加第二个直接抛 `Expected a single value for option "--outputFile <filename/-s>"`，
 * 连原本那趟都跑不起来（2026-10-22 实测，见 KI-152 行）。所以父进程唯一的合法读数来源是子进程的**输出**。
 *
 * 而人类那句「16 条用例全绿」不是接口：它改了，读它的脚本就悄悄读出垃圾。所以把判决写成一行 JSON，
 * 印（`resultLine`）与读（`parseResultLine`）放在同一份模块里——与 `report-reds.mjs`（`summarizeReds` 与
 * `formatReds` 同一把手）同一个理由：**门禁的读数自己必须可测**，而 `test.mjs` 一被 import 就去跑整套测试，
 * 没法被任何测试引用。
 *
 * 判据的形状：**读不懂就是没有读数**，不是 0。`parseResultLine` 对缺失行、坏 JSON、缺字段一律返回 null，
 * 由调用方归成"这一趟不可归因"。`rateOf` 把"没有一趟可归因"标成 `unusable`，因为那正是上面那个 bug 的签名：
 * `reds/0` 长得和 `reds/8` 一样整齐。
 */

export const RESULT_PREFIX = '[test] RESULT '

/** 判决行的种类，与 `test.mjs` 的七条终出口一一对应（少一条就有那条出口的读者读不到东西）。 */
export const KINDS = Object.freeze(['green', 'red', 'suite-red', 'extras', 'coverage-void', 'scope-unmatched', 'no-report'])

/**
 * 印那一行。字段一律现算自调用方手里的报告，不在这里补默认值——
 * 一个 `?? 0` 就会把"没数出来"洗成"数出来是 0"，那正是本模块存在的理由要防的那一类谎。
 * @param r {{kind:string, reds:number, total:number, ranFiles:number, expectedFiles:number, redTitles?:string[], reportKept:boolean}}
 */
export function resultLine(r) {
  const payload = {
    kind: String(r.kind),
    reds: r.reds,
    total: r.total,
    ranFiles: r.ranFiles,
    expectedFiles: r.expectedFiles,
    redTitles: r.redTitles ?? [],
    reportKept: r.reportKept,
  }
  return RESULT_PREFIX + JSON.stringify(payload)
}

/**
 * 从一段（stdout+stderr 合起来的）输出里读判决行。
 * 多条时取**最后一条**：重跑循环里先印的那些属于已经被推翻的那几趟。
 * @returns {object|null} 读不到／解析不动／字段缺或类型不对 ⇒ null（调用方必须把它算成"不可归因"，不是"0 红"）
 */
export function parseResultLine(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  let last = null
  for (const l of lines) {
    const i = l.indexOf(RESULT_PREFIX)
    if (i < 0) continue
    last = l.slice(i + RESULT_PREFIX.length).trim()
  }
  if (last === null) return null
  let obj
  try {
    obj = JSON.parse(last)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  if (!KINDS.includes(obj.kind)) return null
  for (const k of ['reds', 'total', 'ranFiles', 'expectedFiles']) {
    if (typeof obj[k] !== 'number' || !Number.isFinite(obj[k]) || obj[k] < 0) return null
  }
  if (!Array.isArray(obj.redTitles)) return null
  if (typeof obj.reportKept !== 'boolean') return null
  return obj
}

/** 一组数取中位数（空集返回 null，不返回 0：0 会被读成"负载没生效"）。 */
export function median(xs) {
  const v = (xs ?? []).filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 100) / 100
}

/**
 * 把 N 趟读数折成一个红率。
 * @param rows 每趟 `{parsed, secs}`，`parsed` 是 `parseResultLine` 的产物（可为 null）
 * @param pin  `{expectTotal?, expectFiles?}`——分母的地板由**调用方从盘上现推**，不是从某一趟的输出里捡：
 *             从跑次里取分母，等于让一次被截断的跑把之后每一趟的问题数量一起缩小。
 * @returns {{runs:number, counted:number, reds:number, voids:Array<{i:number, why:string}>,
 *            byTitle:Record<string,number>, secsMedian:number|null, unusable:string|null}}
 */
export function rateOf(rows, pin = {}) {
  const out = []
  const byTitle = {}
  const countedSecs = []
  let reds = 0
  for (const [i, row] of (rows ?? []).entries()) {
    const p = row?.parsed
    if (!p) {
      out.push({ i, why: '这一趟的输出里没有可解析的判决行 = 跑测器没走到终出口，不能算 0 红' })
      continue
    }
    if (p.kind !== 'green' && p.kind !== 'red') {
      out.push({ i, why: `判决是 ${p.kind}（用例红与全绿之外的出口），这一趟不进红率` })
      continue
    }
    if (pin.expectTotal != null && p.total !== pin.expectTotal) {
      out.push({ i, why: `收集到 ${p.total} 条 ≠ 钉住的 ${pin.expectTotal} 条 = 这一趟的分母对不上，红率不许用缩放过的分母` })
      continue
    }
    if (p.total <= 0) {
      out.push({ i, why: `判决写着 ${p.kind} 而收集数是 ${p.total} 条：零分母的"绿"没有内容` })
      continue
    }
    if (pin.expectFiles != null && (p.expectedFiles !== pin.expectFiles || p.ranFiles !== pin.expectFiles)) {
      out.push({ i, why: `文件数对不上（期望 ${pin.expectFiles}，该跑到 ${p.expectedFiles}，真跑到 ${p.ranFiles}）` })
      continue
    }
    if (p.kind === 'red') {
      reds++
      for (const t of p.redTitles) byTitle[t] = (byTitle[t] ?? 0) + 1
    }
    countedSecs.push(row.secs)
    out.push({ i, kind: p.kind })
  }
  const counted = countedSecs.length
  return {
    runs: (rows ?? []).length,
    counted,
    reds,
    voids: out.filter((o) => !o.kind),
    byTitle,
    secsMedian: median(countedSecs),
    unusable:
      counted === 0
        ? `${(rows ?? []).length} 趟没有一趟可归因 ⇒ reds/0 不是「0 红」，这一批读数作废`
        : counted < (rows ?? []).length
          ? `${counted}/${(rows ?? []).length} 趟可归因：红率的分母只有 ${counted}，报数时必须带着这一格`
          : null,
  }
}
