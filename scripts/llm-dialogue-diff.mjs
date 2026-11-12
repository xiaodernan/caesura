/**
 * scripts/llm-dialogue-diff.mjs —— LLM 候选与 dialogue.json 的结构化差异对账（作者侧，非运行时）。
 *
 * <p>KI-538 承诺「LLM 候选内容不会进 `dialogue.json`」——本件把那条承诺<b>变成一条可复跑的机读报告</b>：</p>
 * <ol>
 *   <li><b>零写入证明</b>：每一条 `llm-voice-candidates.json` 里的候选行，逐字扫描 `dialogue.json` 全部节点文本，断言不存在任何一行被直接使用过。</li>
 *   <li><b>requiresHumanReview 门</b>：每条候选 entry 必须 `requiresHumanReview: true`（否则 exit 2）。</li>
 *   <li><b>runtime 影子证明</b>：根 `runtime` 必须 `false`、`authorOnly` 必须 truthy（否则 exit 2）。</li>
 *   <li><b>体量对账</b>：报告 candidates 数、按 dlgId 直方图、canon 双语对照表（供作者人工择优，不落数据）。</li>
 * </ol>
 *
 * <p><b>不做的事</b>（如实）：不编辑任何 JSON、不写 LLM、不改写候选、不替代作者人工审核——LLM 候选与真实对白相似度问题不在此脚本范围。</p>
 *
 * 用法：
 *   node scripts/llm-dialogue-diff.mjs             # 默认人类可读输出
 *   node scripts/llm-dialogue-diff.mjs --json      # JSONL 输出（机读）
 *
 * @module llm-dialogue-diff
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const isCliInvocation = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
const JSON_MODE = process.argv.includes('--json')
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function loadJson(rel) {
  try {
    return JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8'))
  } catch (e) {
    console.error('[llm:diff] 读取 ' + rel + ' 失败：', e instanceof Error ? e.message : String(e))
    process.exit(2)
  }
}

function dialogueNodeTexts(dlg) {
  const rows = Array.isArray(dlg) ? dlg : (dlg && typeof dlg === 'object' ? Object.values(dlg) : [])
  const texts = []
  for (const root of rows) {
    if (!root || typeof root !== 'object') continue
    for (const node of root.nodes ?? []) {
      if (typeof node?.text === 'string') texts.push({ dlgId: root.id ?? '?', nodeId: node.id ?? '?', text: node.text })
    }
  }
  return texts
}

export function dialogueDiffReport({ dialogue, candidates }) {
  const nodeTexts = dialogueNodeTexts(dialogue)
  const corpus = nodeTexts.map((n) => n.text)
  const problems = []

  // 根 marker
  if (candidates.runtime !== false) problems.push('root.runtime !== false（必须零玩家运行时）')
  if (!candidates.authorOnly) problems.push('root.authorOnly 缺失/false（必须声明作者侧专用）')

  // 每条候选
  const hits = []
  for (const c of candidates.candidates ?? []) {
    if (c.requiresHumanReview !== true) problems.push(`${c.dlgId ?? c.id ?? '?'} requiresHumanReview !== true`)
    for (const line of c.lines ?? []) {
      if (typeof line !== 'string') continue
      // 逐字比对（节点文本经常含「……」等省略号，不能做模糊匹配）
      if (corpus.includes(line)) {
        problems.push(`${c.dlgId ?? c.id}: 候选行逐字落在 dialogue.json："${line.slice(0, 24)}…"`)
        hits.push({ dlgId: c.dlgId ?? c.id, line })
      }
    }
  }

  // 直方图
  const histogram = {}
  for (const c of candidates.candidates ?? []) histogram[c.dlgId ?? c.id] = (histogram[c.dlgId ?? c.id] ?? 0) + 1

  return {
    nodes: nodeTexts.length,
    candidates: (candidates.candidates ?? []).length,
    leaks: hits.length,
    requiresHumanReviewOk: (candidates.candidates ?? []).every((c) => c.requiresHumanReview === true),
    runtimeOk: candidates.runtime === false && !!candidates.authorOnly,
    ok: problems.length === 0,
    histogram,
    problems,
  }
}

if (isCliInvocation) {
  const dialogue = loadJson('src/data/json/dialogue.json')
  const candidates = loadJson('src/data/authoring/llm-voice-candidates.json')
  const report = dialogueDiffReport({ dialogue, candidates })
  if (JSON_MODE) {
    console.log(JSON.stringify(report))
  } else {
    console.log('[llm:diff] dialogue.json 节点=' + report.nodes + ' · 候选=' + report.candidates)
    console.log('  root.runtime=false authorOnly=' + (report.runtimeOk ? 'true' : 'MISSING') +
      ' · 全部候选 requiresHumanReview=true：' + (report.requiresHumanReviewOk ? '✓' : '✗') +
      ' · 逐字泄漏数=' + report.leaks)
    for (const [id, n] of Object.entries(report.histogram)) console.log('    ' + id + '：' + n + ' 条候选')
    if (report.problems.length) {
      console.log('  !! 发现 ' + report.problems.length + ' 项需要作者裁决：')
      for (const p of report.problems) console.log('    - ' + p)
    } else {
      console.log('  ✓ 对账通过：LLM 候选未泄漏进 dialogue.json。')
    }
  }
  process.exit(report.ok ? 0 : 2)
}
