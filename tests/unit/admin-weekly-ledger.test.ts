import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * KI-715 · admin「余响编年 · Weekly Ledger」门钉：
 *   ① admin/index.html 含面板与挂载点；② app.js 含 renderLedger + fetch `./ai-weekly-ledger.json`；
 *   ③ 双拷贝存在（src/data/authoring/ + admin/）；④ 冷回路 + 人工闸四要素；
 *   ⑤ portraitZh/portraitEn/oneLineZh/oneLineEn/echoZh/echoEn 必含；
 *   ⑥ 无密钥；⑦ usage 账单 + 已知 script。同时钉住 ai-weekly-ledger 有 *.d.mts 兄弟类型声明（KI-440）。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')
const KEY_SHAPE = /sk-[A-Za-z0-9_\-]{16,}/

describe('admin · 余响编年 Weekly Ledger（KI-715）', () => {
  const html = read('admin/index.html')
  const js = read('admin/app.js')
  const css = read('admin/styles.css')

  it('admin/index.html 含面板与挂载点', () => {
    expect(html).toContain('id="panel-ledger"')
    expect(html).toContain('id="ledger-portrait-zh"')
    expect(html).toContain('id="ledger-portrait-en"')
    expect(html).toContain('id="ledger-oneline-zh"')
    expect(html).toContain('id="ledger-echo-zh"')
    expect(html).toContain('data-i18n="ledger.h2"')
  })

  it('app.js 含 renderLedger + fetch + 调用 renderAll + LANG key', () => {
    expect(js).toContain('renderLedger')
    expect(js).toContain('./ai-weekly-ledger.json')
    expect(js).toContain('renderLedger();')
    expect(js).toContain("'ledger.h2'")
    expect(js).toContain('renderLedger = ')
  })

  it('styles.css 含 panel-priors 样式（无外链）', () => {
    expect(css).toContain('.panel-priors')
    expect(css).not.toContain('@import')
    expect(css).not.toMatch(/url\(\s*https?:/)
  })

  it('双拷贝存在且字节级一致', () => {
    const authoring = resolve(ROOT, 'src/data/authoring/ai-weekly-ledger.json')
    const admin = resolve(ROOT, 'admin/ai-weekly-ledger.json')
    expect(existsSync(authoring)).toBe(true)
    expect(existsSync(admin)).toBe(true)
    expect(readFileSync(admin, 'utf8')).toBe(readFileSync(authoring, 'utf8'))
  })

  it('人工闸四要素 + mode=live + schema=1 + 字段齐全', () => {
    const art = JSON.parse(read('src/data/authoring/ai-weekly-ledger.json')) as Record<string, any>
    expect(art.runtime).toBe(false)
    expect(art.authorOnly).toBe(true)
    expect(art.requiresHumanReview).toBe(true)
    expect(art.containsCredentials).toBe(false)
    expect(art.schema).toBe(1)
    expect(art.mode).toBe('live')
    expect(typeof art.portraitZh).toBe('string')
    expect(typeof art.portraitEn).toBe('string')
    expect(typeof art.oneLineZh).toBe('string')
    expect(typeof art.oneLineEn).toBe('string')
    expect(typeof art.echoZh).toBe('string')
    expect(typeof art.echoEn).toBe('string')
  })

  it('无密钥形状', () => {
    for (const p of ['src/data/authoring/ai-weekly-ledger.json', 'admin/ai-weekly-ledger.json']) {
      expect(KEY_SHAPE.test(readFileSync(resolve(ROOT, p), 'utf8'))).toBe(false)
    }
  })

  it('至少一次调用成功（usage.statuses 200）', () => {
    const art = JSON.parse(read('src/data/authoring/ai-weekly-ledger.json')) as Record<string, any>
    expect(Array.isArray(art.usage?.statuses)).toBe(true)
    for (const s of art.usage.statuses) expect([200, 201]).toContain(Number(s))
  })
})
