import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { EchoFlow, echoFlowEntriesOf } from '@/quest/EchoFlow'

/**
 * KI-717 · 世界线（Echo Flow）门钉：
 *   ① 运行时表与 admin 镜像字节级一致，且可由上游产物复算（digest 对得上）；
 *   ② 每一条都经人工闸放行、有 QA 裁决、有 canon 证据、双语气质完整；
 *   ③ 每个 flag 都能在 regions.json 里找到玩家可触发的写方 ⇒ 不是纸上状态；
 *   ④ 运行时引擎只认表内 flag、幂等、可从旗标现读，玩家进程零 LLM；
 *   ⑤ 产物里没有密钥 / 端点形状。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')
const readJson = (p: string) => JSON.parse(read(p)) as any

const RUNTIME = 'src/data/json/echo-flow.json'
const MIRROR = 'admin/echo-flow.json'
const SOURCE = 'admin/ai-director-latest.json'
const QA = 'admin/ai-director-transitions-qa.json'
const APPROVALS = 'admin/echo-flow-approvals.json'

const runtimeRaw = readJson(RUNTIME)
const entries = echoFlowEntriesOf(runtimeRaw)
const source = readJson(SOURCE)
const qa = readJson(QA)
const approvals = readJson(APPROVALS)

const sha16 = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)

describe('KI-717 · 世界线 Echo Flow · 数据闸门', () => {
  it('运行时表与 admin 镜像字节级一致', () => {
    expect(read(MIRROR)).toBe(read(RUNTIME))
    expect(runtimeRaw.schema).toBe(1)
    expect(Array.isArray(runtimeRaw.entries)).toBe(true)
    expect(runtimeRaw.entries.length).toBeGreaterThanOrEqual(1)
  })

  it('可由上游产物复算：sourceDigest / qaDigest 逐字节对得上', () => {
    expect(runtimeRaw.sourceDigest).toBe(sha16(read(SOURCE)))
    expect(runtimeRaw.qaDigest).toBe(sha16(read(QA)))
  })

  it('每条都有唯一 flag/id、双语字段、canon 证据与 QA 裁决', () => {
    expect(entries.length).toBeGreaterThanOrEqual(1)
    expect(entries.length).toBeLessThanOrEqual(source.transitions.length)
    const flags = new Set<string>()
    const ids = new Set<string>()
    const verdictByFlag = new Map(qa.verdicts.map((v: any) => [v.flag, v]))
    const approveByFlag = new Map(approvals.decisions.filter((d: any) => d.decision === 'approve').map((d: any) => [d.flag, d]))
    for (const e of entries) {
      expect(e.flag).toMatch(/^flag\./)
      expect(flags.has(e.flag), `flag 重复：${e.flag}`).toBe(false)
      flags.add(e.flag)
      expect(ids.has(e.id), `id 重复：${e.id}`).toBe(false)
      ids.add(e.id)
      expect(Number.isInteger(e.chapter) && e.chapter > 0).toBe(true)
      for (const k of ['fromZh', 'fromEn', 'toZh', 'toEn', 'narrativeZh', 'narrativeEn', 'npcReactionZh', 'npcReactionEn', 'atlasHookZh', 'atlasHookEn'] as const) {
        expect(typeof e[k] === 'string' && e[k].trim().length > 0, `${e.flag}.${k}`).toBe(true)
      }
      expect(Array.isArray(e.canonEvidence) && e.canonEvidence.length > 0).toBe(true)
      expect(['canon', 'new-canon']).toContain(e.canonFit)
      expect(verdictByFlag.has(e.flag), `缺 QA 裁决：${e.flag}`).toBe(true)
      expect(approveByFlag.has(e.flag), `缺人工放行：${e.flag}`).toBe(true)
      expect(e.approval.by).toBe(approvals.reviewedBy)
      expect(e.approval.at).toBe(approvals.reviewedAt)
      expect(typeof e.approval.noteZh === 'string' && e.approval.noteZh.length > 6).toBe(true)
      expect(typeof e.approval.noteEn === 'string' && e.approval.noteEn.length > 6).toBe(true)
    }
  })

  it('每个 flag 在 regions.json 里都有玩家可触发的写方（不是纸上状态）', () => {
    const regions = readJson('src/data/json/regions.json') as any[]
    const settable = new Set<string>()
    for (const rg of regions) {
      for (const it of rg.interactables ?? []) if (typeof it.setsFlag === 'string') settable.add(it.setsFlag)
    }
    for (const e of entries) {
      expect(settable.has(e.flag), `${e.flag} 没有任何交互物 setsFlag`).toBe(true)
    }
  })

  it('产物不含密钥 / 端点形状', () => {
    for (const p of [RUNTIME, MIRROR, APPROVALS]) {
      const body = read(p)
      expect(/sk-[A-Za-z0-9_\-]{16,}/.test(body)).toBe(false)
      expect(body).not.toContain('api.aizzz.xyz')
      expect(body).not.toContain('Authorization')
    }
  })
})

describe('KI-717 · 世界线 Echo Flow · 运行时引擎', () => {
  const allFlags = entries.map((e) => e.flag)

  it('未触发时全部 pending；record 只认表内 flag 且幂等', () => {
    const flags = new Set<string>()
    const flow = new EchoFlow(entries, (k) => flags.has(k))
    expect(flow.reached()).toEqual([])
    expect(flow.pending()).toHaveLength(entries.length)
    expect(flow.record('flag.not_in_table')).toBe(null)
    const first = flow.record(allFlags[0])
    expect(first?.flag).toBe(allFlags[0])
    expect(flow.record(allFlags[0])).toBe(null) // 第二次不再播报
    expect(flow.reached().map((e) => e.flag)).toEqual([allFlags[0]])
  })

  it('sync 从旗标现读：外部置位 / 回退都跟着走', () => {
    const flags = new Set<string>([allFlags[1]])
    const flow = new EchoFlow(entries, (k) => flags.has(k))
    expect(flow.snapshot().filter((e) => e.reached).map((e) => e.flag)).toEqual([allFlags[1]])
    flags.add(allFlags[0])
    expect(flow.reached().map((e) => e.flag).sort()).toEqual([allFlags[0], allFlags[1]].sort())
    flags.delete(allFlags[1])
    expect(flow.reached().map((e) => e.flag)).toEqual([allFlags[0]])
  })

  it('byChapter 按章升序分组；每章条目数之和等于全表', () => {
    const flow = new EchoFlow(entries, () => false)
    const groups = flow.byChapter()
    expect(groups.map((g) => g.chapter)).toEqual([...groups.map((g) => g.chapter)].sort((a, b) => a - b))
    expect(groups.reduce((n, g) => n + g.entries.length, 0)).toBe(entries.length)
  })

  it('onWorldFlag(false) 不会把状态改回「已抵达」', () => {
    const flow = new EchoFlow(entries, () => false)
    expect(flow.onWorldFlag(allFlags[0], false)).toBe(null)
    expect(flow.onWorldFlag(allFlags[0], true)?.flag).toBe(allFlags[0])
  })
})
