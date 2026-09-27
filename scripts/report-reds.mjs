/**
 * scripts/report-reds.mjs — 从 vitest 的 JSON 报告里数出"红在谁身上"（纯函数，零依赖）。
 *
 * 为什么要单独一个文件：这段判断是**门禁的读数**，它自己必须可测。留在 `test.mjs` 里它就没法被
 * 任何测试 import——那个脚本一被 import 就会去跑整套测试（顶层就是主流程），等于给跑测器写跑测器。
 * 抽出来之后，判据可以是合成的报告对象（毫秒级），而"真跑一趟"退成一条实测证人。
 *
 * 口径只有一条：`numFailedTestSuites` **不是**文件数（KI-072 撞的就是把它当文件数印出去，
 * 于是"16 条 / 11 个文件"这种读数进了文档，而同一份报告里含红用例的文件其实只有 5 个）。
 */

const norm = (p) => String(p ?? '').replace(/\\/g, '/')

/**
 * @param json vitest `--reporter=json` 写出来的那份对象
 * @param root 仓库根的绝对路径（用来把报告里的绝对路径折成仓库相对路径；正/反斜杠都吃）
 * @returns {{ total: number, nRed: number, ranFiles: number, files: Array<{ file: string, reds: Array<{ name: string, first: string }> }> }}
 */
export function summarizeReds(json, root = '') {
  const results = Array.isArray(json?.testResults) ? json.testResults : []
  const strip = norm(root).replace(/\/$/, '')
  let total = 0
  const files = []
  for (const r of results) {
    const all = Array.isArray(r?.assertionResults) ? r.assertionResults : []
    total += all.length
    const reds = all.filter((a) => a?.status === 'failed')
    if (!reds.length) continue
    const full = norm(r?.name)
    files.push({
      file: strip && full.startsWith(strip + '/') ? full.slice(strip.length + 1) : full,
      reds: reds.map((a) => ({
        name: String(a.fullName || a.title || '(无名用例)'),
        // 只取第一条 message 的第一行非空文本：那是断言自己的那句话（读数与归因都在里面），
        // 堆栈留给留在原地的那份报告。
        first: String((a.failureMessages ?? [])[0] ?? '').split(/\r?\n/).find((l) => l.trim())?.slice(0, 200) ?? '',
      })),
    })
  }
  return { total, nRed: files.reduce((s, f) => s + f.reds.length, 0), ranFiles: results.length, files }
}

/** 把上面那份摘要印成门禁输出（单独一个函数：格式也要能被断言钉住） */
export function formatReds(sum) {
  const out = [`有失败用例：${sum.nRed} 条 / ${sum.files.length} 个含红文件（这一趟跑了 ${sum.total} 条 / ${sum.ranFiles} 个文件）`]
  for (const f of sum.files) {
    out.push(`  ${f.file} — ${f.reds.length} 条`)
    for (const a of f.reds) {
      out.push(`      × ${a.name}`)
      if (a.first) out.push(`        ${a.first}`)
    }
  }
  return out.join('\n')
}
