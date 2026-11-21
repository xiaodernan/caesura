import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * KI-725 · AI 导演提案避让闸门（LLM 从 QA 反馈中自我改进的闭环）：
 *   ① 脚本含 canonFlagRoster()：从 regions setsFlag / echo-flow entries / dialogue flags 收集既有旗标，
 *      并从 QA 读 canonFit=conflict 的历史旗标；
 *   ② proposeTransitions 的 task 注入避让名册 + conflict 警示（LLM 起草时就知道不能重复）；
 *   ③ 产物含 proposalGuard 字段（existingCount / conflictFlags / warnings），可审计；
 *   ④ RUN 文档有"提案避让闸门"一节；
 *   ⑤ 当前真跑产物里：历史 conflict 旗标确实在名册里被识别（earless 重复案例）。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')
const SCRIPT = read('scripts/ai-director.mjs')

describe('KI-725 · AI 导演提案避让闸门（StateGraph 自我改进）', () => {
  it('脚本含 canonFlagRoster 三来源 + conflict 读取', () => {
    expect(SCRIPT).toContain('function canonFlagRoster()')
    expect(SCRIPT).toContain('interactables')
    expect(SCRIPT).toContain('echo-flow.json')
    expect(SCRIPT).toContain('dialogue.json')
    expect(SCRIPT).toContain("canonFit === 'conflict'")
  })

  it('proposeTransitions 注入避让名册 + 撞 conflict 机械自检', () => {
    expect(SCRIPT).toContain('const roster = canonFlagRoster()')
    expect(SCRIPT).toContain('避让名册')
    expect(SCRIPT).toContain('state.transitionWarnings')
    expect(SCRIPT).toContain('roster.conflicts.includes(t.flag)')
  })

  it('产物构建逻辑写入 proposalGuard 字段，RUN 文档有避让闸门节', () => {
    expect(SCRIPT).toContain('proposalGuard:')
    expect(SCRIPT).toContain('提案避让闸门')
    expect(SCRIPT).toContain('existingCount: state.canonFlagRoster.count')
    // 真跑 proof 在 docs/ai-director/PROPOSAL-GUARD-*.md（见下条）
  })

  it('真跑 proof：历史 conflict 旗标被避让名册识别，且新提案撞 conflict=0', () => {
    const files = readdirSync(resolve(ROOT, 'docs/ai-director')).filter((f) => /^PROPOSAL-GUARD-\d{4}-\d{2}-\d{2}\.md$/.test(f))
    expect(files.length, '应有真跑 proof 文档').toBeGreaterThanOrEqual(1)
    const proof = read('docs/ai-director/' + files[files.length - 1])
    expect(proof).toContain('避让名册')
    expect(proof).toContain('conflict=0')
    expect(proof).toContain('flag.earless_deeps_five_ring_clues_archived')
  })

  it('双拷贝产物字节级一致（含新增 proposalGuard）', () => {
    expect(read('src/data/authoring/ai-director-latest.json')).toBe(read('admin/ai-director-latest.json'))
  })
})
