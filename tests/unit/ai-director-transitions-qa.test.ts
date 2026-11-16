import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * KI-624 · AI 导演第二阶段「流转 QA」门钉：
 *   ① 双拷贝产物字节级一致；runtime/authorOnly/requiresHumanReview/containsCredentials 全关；
 *   ② 真机产物：mode=live · verdicts 4 条 · canonFit ∈ {canon,new-canon,conflict} · statuses 全 200；
 *   ③ 任何产物文件里不得出现密钥形状；
 *   ④ docs/ai-director/TRANSITIONS-QA-*.md 存在且含「裁决」；
 *   ⑤ admin/app.js 真的 fetch 了 ai-director-transitions-qa.json 且渲染了 verdict 徽章。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')
const AUTHORING = resolve(ROOT, 'src/data/authoring/ai-director-transitions-qa.json')
const ADMIN = resolve(ROOT, 'admin/ai-director-transitions-qa.json')
const KEY_SHAPE = /sk-[A-Za-z0-9_\-]{16,}/

describe('KI-624 · AI 导演流转 QA（transitions-qa）', () => {
  it('双拷贝产物存在且字节级一致', () => {
    expect(existsSync(AUTHORING)).toBe(true)
    expect(existsSync(ADMIN)).toBe(true)
    expect(readFileSync(ADMIN, 'utf8')).toBe(readFileSync(AUTHORING, 'utf8'))
  })

  const art = JSON.parse(read('src/data/authoring/ai-director-transitions-qa.json')) as Record<string, any>

  it('人工闸四要素 + schema + mode=live', () => {
    expect(art.runtime).toBe(false)
    expect(art.authorOnly).toBe(true)
    expect(art.requiresHumanReview).toBe(true)
    expect(art.containsCredentials).toBe(false)
    expect(art.schema).toBe(1)
    expect(art.mode).toBe('live')
  })

  it('真机产物：transitionsRead=4 · verdicts=4 · canonFit 合法 · statuses 全 200', () => {
    expect(art.transitionsRead).toBe(4)
    expect(Array.isArray(art.verdicts)).toBe(true)
    expect(art.verdicts.length).toBe(4)
    const allowed = new Set(['canon', 'new-canon', 'conflict'])
    for (const v of art.verdicts) {
      expect(allowed.has(v.canonFit), `非法 canonFit: ${v.canonFit}`).toBe(true)
      expect(v.flag).toMatch(/^flag\./)
      expect(typeof v.notesZh === 'string' && v.notesZh.length > 6).toBe(true)
    }
    expect(Array.isArray(art.usage.statuses)).toBe(true)
    expect(art.usage.calls).toBeGreaterThanOrEqual(1)
    for (const s of art.usage.statuses) expect([200, 201]).toContain(Number(s))
  })

  it('任何产物文件里不得出现密钥形状', () => {
    for (const p of [AUTHORING, ADMIN]) {
      expect(KEY_SHAPE.test(readFileSync(p, 'utf8'))).toBe(false)
    }
  })

  it('docs/ai-director/TRANSITIONS-QA-*.md 存在且含「裁决」', () => {
    const dir = resolve(ROOT, 'docs/ai-director')
    const files = readdirSync(dir).filter((f) => /^TRANSITIONS-QA-\d{4}-\d{2}-\d{2}\.md$/.test(f))
    expect(files.length).toBeGreaterThanOrEqual(1)
    const md = readFileSync(resolve(dir, files.sort().reverse()[0]), 'utf8')
    expect(md).toContain('裁决')
  })

  it('admin/app.js fetch 了 ai-director-transitions-qa.json 且渲染 verdict 徽章', () => {
    const js = read('admin/app.js')
    expect(js).toContain('./ai-director-transitions-qa.json')
    expect(js).toContain('verdictByFlag')
    expect(js).toContain('ai-verdict-badge')
  })

  it('admin CSS 含三种裁决徽章配色', () => {
    const css = read('admin/styles.css')
    expect(css).toContain('.ai-verdict-canon')
    expect(css).toContain('.ai-verdict-new-canon')
    expect(css).toContain('.ai-verdict-conflict')
  })
})
