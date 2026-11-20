/**
 * scripts/echo-flow.mjs — KI-717 AI 导演 ·「世界线」编译器
 *
 * 把 AI 导演 StateGraph 产出的 `transitions`（世界状态流转提案）与流转 QA 的 `verdicts`
 * 经**人工闸**（admin/echo-flow-approvals.json）编译成一份运行时可读的数据表：
 *
 *   admin/ai-director-latest.json  ──┐
 *   admin/ai-director-transitions-qa.json ──┼─► load → verify → write ─► src/data/json/echo-flow.json
 *   admin/echo-flow-approvals.json ──┘                              └─► admin/echo-flow.json（镜像）
 *                                                                   └─► docs/ai-director/ECHO-FLOW-<date>.md
 *
 * 纪律：
 *   1. 玩家进程零 LLM —— 产物只有已审文本，不含 endpoint / model 调用 / 任何密钥；
 *   2. 人工闸是唯一放行口 —— 没在 approvals 里 approve 的 flag 一律不进运行时；
 *   3. 可复算 —— `--check` 不写盘，逐字节比对两个镜像与文档；CI/测试里用它防手改。
 *
 * 用法：
 *   node scripts/echo-flow.mjs            # 编译（写三份产物）
 *   node scripts/echo-flow.mjs --check    # 只校验（不写盘；不一致 exit 1）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StateGraph } from './lib/stategraph.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const CHECK = process.argv.includes('--check')
const TODAY = new Date().toISOString().slice(0, 10)

const PATHS = {
  director: resolve(ROOT, 'admin/ai-director-latest.json'),
  qa: resolve(ROOT, 'admin/ai-director-transitions-qa.json'),
  approvals: resolve(ROOT, 'admin/echo-flow-approvals.json'),
  runtime: resolve(ROOT, 'src/data/json/echo-flow.json'),
  mirror: resolve(ROOT, 'admin/echo-flow.json'),
}

const REQUIRED_TEXT = ['fromZh', 'fromEn', 'toZh', 'toEn', 'narrativeZh', 'narrativeEn', 'npcReactionZh', 'npcReactionEn', 'atlasHookZh', 'atlasHookEn']
const SECRET_RE = /(sk-[A-Za-z0-9]{12,}|api[_-]?key\s*[:=]|Authorization\s*:\s*Bearer|https?:\/\/api\.)/i

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

function stableJson(value) {
  return JSON.stringify(value, null, 2) + '\n'
}

/* ═══════════ 节点 ═══════════ */

async function nodeLoad(state) {
  state.directorRaw = readFileSync(PATHS.director, 'utf8')
  state.qaRaw = readFileSync(PATHS.qa, 'utf8')
  state.approvalsRaw = readFileSync(PATHS.approvals, 'utf8')
  const director = JSON.parse(state.directorRaw)
  const qa = JSON.parse(state.qaRaw)
  const approvals = JSON.parse(state.approvalsRaw)
  if (!Array.isArray(director.transitions)) throw new Error('ai-director-latest.json 缺少 transitions[]')
  if (!Array.isArray(qa.verdicts)) throw new Error('ai-director-transitions-qa.json 缺少 verdicts[]')
  if (!Array.isArray(approvals.decisions)) throw new Error('echo-flow-approvals.json 缺少 decisions[]')
  state.director = director
  state.qa = qa
  state.approvals = approvals
  state.sourceDigest = sha256(state.directorRaw).slice(0, 16)
  state.qaDigest = sha256(state.qaRaw).slice(0, 16)
}

async function nodeVerify(state) {
  const errs = []
  const verdictByFlag = new Map(state.qa.verdicts.map((v) => [v.flag, v]))
  const transitionByFlag = new Map(state.director.transitions.map((t) => [t.flag, t]))
  const seen = new Set()
  const approved = []

  for (const [i, d] of state.approvals.decisions.entries()) {
    const where = `decisions[${i}]`
    if (!d || typeof d !== 'object') { errs.push(`${where} 必须是对象`); continue }
    if (typeof d.flag !== 'string' || !/^flag\.[A-Za-z0-9_]+$/.test(d.flag)) { errs.push(`${where}.flag 非法：${JSON.stringify(d.flag)}`); continue }
    if (seen.has(d.flag)) { errs.push(`${where}.flag 重复：${d.flag}`); continue }
    seen.add(d.flag)
    if (d.decision !== 'approve') continue
    const t = transitionByFlag.get(d.flag)
    if (!t) { errs.push(`${where}.flag 在 ai-director-latest.json 里找不到：${d.flag}`); continue }
    const qa = verdictByFlag.get(d.flag)
    if (!qa) { errs.push(`${where}.flag 没有流转 QA 裁决：${d.flag}`); continue }
    if (qa.canonFit === 'conflict') { errs.push(`${where}.flag 被 QA 判为 conflict，必须驳回：${d.flag}`); continue }
    if (!Number.isInteger(d.chapter) || d.chapter < 1) { errs.push(`${where}.chapter 必须是正整数`); continue }
    if (typeof d.noteZh !== 'string' || typeof d.noteEn !== 'string') { errs.push(`${where} 缺少 noteZh / noteEn`); continue }
    for (const k of REQUIRED_TEXT) {
      if (typeof t[k] !== 'string' || !t[k].trim()) errs.push(`${d.flag}.${k} 缺失或为空`)
    }
    if (!Array.isArray(t.canonEvidence) || t.canonEvidence.length === 0) errs.push(`${d.flag}.canonEvidence 必须是非空数组`)
    if (Array.isArray(t.canonEvidence) && t.canonEvidence.some((c) => typeof c !== 'string')) errs.push(`${d.flag}.canonEvidence 每项必须是字符串`)
    if (SECRET_RE.test(JSON.stringify(t))) errs.push(`${d.flag} 文本疑似包含密钥/端点，拒绝写入运行时`)
    approved.push({
      id: `ef_${d.chapter}_${d.flag.replace(/^flag\./, '')}`,
      flag: d.flag,
      chapter: d.chapter,
      fromZh: t.fromZh,
      fromEn: t.fromEn,
      toZh: t.toZh,
      toEn: t.toEn,
      narrativeZh: t.narrativeZh,
      narrativeEn: t.narrativeEn,
      npcReactionZh: t.npcReactionZh,
      npcReactionEn: t.npcReactionEn,
      atlasHookZh: t.atlasHookZh,
      atlasHookEn: t.atlasHookEn,
      canonEvidence: t.canonEvidence,
      canonFit: qa.canonFit,
      qaNotesZh: qa.notesZh ?? '',
      qaNotesEn: qa.notesEn ?? '',
      approval: {
        by: state.approvals.reviewedBy ?? 'human-gate',
        at: state.approvals.reviewedAt ?? TODAY,
        noteZh: d.noteZh,
        noteEn: d.noteEn,
      },
      source: {
        generatedAt: state.director.generatedAt ?? null,
        model: state.director.model ?? null,
        focus: state.director.focus ?? null,
        digest: state.sourceDigest,
        qaDigest: state.qaDigest,
      },
    })
  }

  // 未审提案不是错误，但必须被看见：报告里列出，运行时表里绝不出现。
  const unreviewed = [...transitionByFlag.keys()].filter((f) => !seen.has(f)).sort()
  state.unreviewed = unreviewed
  state.approved = approved
  state.verdictByFlag = Object.fromEntries(verdictByFlag)
  if (errs.length) throw new Error('echo-flow 校验失败：\n- ' + errs.join('\n- '))
}

async function nodeWrite(state) {
  const sourceDate = String(state.director.generatedAt ?? '').slice(0, 10) || TODAY
  const body = {
    $comment: 'KI-717 AI 导演 ·「世界线」运行时表 · 由 scripts/echo-flow.mjs 生成 · 人工闸放行 · 玩家进程零 LLM',
    schema: 1,
    generatedAt: state.director.generatedAt ?? null,
    sourceDigest: state.sourceDigest,
    qaDigest: state.qaDigest,
    entries: state.approved,
  }
  const json = stableJson(body)
  state.runtimeBytes = json
  state.mirrorBytes = json
  state.docPath = resolve(ROOT, `docs/ai-director/ECHO-FLOW-${sourceDate}.md`)

  const mdLines = [
    `# AI 导演 · 世界线 ECHO-FLOW ${TODAY}`,
    '',
    `- 源：\`admin/ai-director-latest.json\` @ ${state.director.generatedAt ?? '—'} · model ${state.director.model ?? '—'}`,
    `- QA：\`admin/ai-director-transitions-qa.json\` @ ${state.qa.generatedAt ?? '—'} · verdicts ${state.qa.verdicts.length}`,
    `- 人工闸：${state.approvals.reviewedBy ?? 'human-gate'} · ${state.approvals.reviewedAt ?? TODAY}`,
    `- 放行：**${state.approved.length}** 条 ｜ 未审：${state.unreviewed.length} 条（不进入运行时）`,
    `- 运行时表：\`src/data/json/echo-flow.json\` ｜ 镜像：\`admin/echo-flow.json\``,
    '',
    '> 玩家进程零 LLM。这里每一行都来自一次真实 StateGraph 运行 + canon QA + 人工放行。',
    '',
    '| 章 | flag | from → to | canonFit |',
    '| --- | --- | --- | --- |',
    ...state.approved.map((e) => `| ${e.chapter} | \`${e.flag}\` | ${e.fromZh} → ${e.toZh} | ${e.canonFit} |`),
    '',
    '## 放行详情',
    '',
    ...state.approved.flatMap((e) => [
      `### ${e.flag}`,
      '',
      `- from：${e.fromZh} / ${e.fromEn}`,
      `- to：${e.toZh} / ${e.toEn}`,
      `- NPC：${e.npcReactionZh} / ${e.npcReactionEn}`,
      `- atlas hook：${e.atlasHookZh} / ${e.atlasHookEn}`,
      `- canon evidence：${e.canonEvidence.join('；')}`,
      `- QA：${e.canonFit} — ${e.qaNotesZh}`,
      `- 人工备注：${e.approval.noteZh}`,
      '',
    ]),
    '## 未审提案（不入运行时）',
    '',
    ...(state.unreviewed.length ? state.unreviewed.map((f) => `- \`${f}\``) : ['- （无）']),
    '',
  ]
  state.docBytes = mdLines.join('\n')
}

async function nodeCommit(state) {
  if (CHECK) {
    const problems = []
    for (const [label, path, expected] of [
      ['runtime', PATHS.runtime, state.runtimeBytes],
      ['mirror', PATHS.mirror, state.mirrorBytes],
      ['doc', state.docPath, state.docBytes],
    ]) {
      if (!existsSync(path)) { problems.push(`${label} 缺失：${path}`); continue }
      const actual = readFileSync(path, 'utf8')
      if (actual !== expected) problems.push(`${label} 与可复算结果不一致（手改过？）：${path}`)
    }
    if (problems.length) throw new Error('echo-flow --check 失败：\n- ' + problems.join('\n- '))
    return
  }
  mkdirSync(dirname(PATHS.runtime), { recursive: true })
  mkdirSync(dirname(PATHS.mirror), { recursive: true })
  mkdirSync(dirname(state.docPath), { recursive: true })
  writeFileSync(PATHS.runtime, state.runtimeBytes, 'utf8')
  writeFileSync(PATHS.mirror, state.mirrorBytes, 'utf8')
  writeFileSync(state.docPath, state.docBytes, 'utf8')
}

/* ═══════════ 组图 ═══════════ */
async function main() {
  const graph = new StateGraph()
  graph
    .addNode('load', nodeLoad)
    .addNode('verify', nodeVerify)
    .addNode('write', nodeWrite)
    .addNode('commit', nodeCommit)
    .addEdge('load', 'verify')
    .addEdge('verify', 'write')
    .addEdge('write', 'commit')
  const state = { mode: CHECK ? 'check' : 'compile', errors: [] }
  try {
    await graph.run('load', state)
  } catch (e) {
    console.error('[echo-flow] FATAL', e.message)
    process.exit(1)
  }
  const failed = graph.checkpoints.filter((c) => !c.ok)
  if (failed.length) {
    console.error('[echo-flow] FATAL 节点失败：', failed.map((c) => c.node).join(', '))
    process.exit(1)
  }
  if (CHECK) {
    console.log(`[echo-flow] check ok · approved=${state.approved.length} · unreviewed=${state.unreviewed.length} · digest=${state.sourceDigest}`)
  } else {
    console.log(`[echo-flow] wrote src/data/json/echo-flow.json · entries=${state.approved.length} · unreviewed=${state.unreviewed.length} · digest=${state.sourceDigest}`)
  }
}

main()
