import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LANG_KEY, LANG_NAME_KEY, shouldCycleLang } from '@/i18n/LangKey'

/**
 * KI-742 · 世界里的语言键（`L`）判据守卫：
 *   `src/i18n/LangKey.ts` 的 `shouldCycleLang` 是唯一判据——这一文件量着它的真值表，
 *   防止「改键时误切语言」「面板开着时半屏旧字半屏新字」「输入框里 L 被当热键」回归。
 */
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

describe('KI-742 · shouldCycleLang 真值表', () => {
  const ok = { code: 'KeyL' }
  const ctx = { overlayOpen: false, capturing: false, inField: false }

  it('KeyL 是唯一物理键（code 非 key，中文输入法下不误判）', () => {
    expect(LANG_KEY).toBe('KeyL')
    expect(shouldCycleLang(ok, ctx)).toBe(true)
    expect(shouldCycleLang({ code: 'KeyK' }, ctx)).toBe(false)
    expect(shouldCycleLang({ code: 'l' }, ctx)).toBe(false) // key 不是 code
  })

  it('长按重复不切（repeat=true）', () => {
    expect(shouldCycleLang({ code: 'KeyL', repeat: true }, ctx)).toBe(false)
  })

  it('带 Ctrl/Meta/Alt 不切（浏览器/系统快捷键优先）', () => {
    expect(shouldCycleLang({ code: 'KeyL', ctrlKey: true }, ctx)).toBe(false)
    expect(shouldCycleLang({ code: 'KeyL', metaKey: true }, ctx)).toBe(false)
    expect(shouldCycleLang({ code: 'KeyL', altKey: true }, ctx)).toBe(false)
    // Shift 不算修饰：游戏里 Shift+L 与 l 同键，按下就该切
    expect(shouldCycleLang({ code: 'KeyL', shiftKey: true } as never, ctx)).toBe(true)
  })

  it('三个现场条件任一为真都不切（overlay / capturing / inField）', () => {
    expect(shouldCycleLang(ok, { ...ctx, overlayOpen: true })).toBe(false)
    expect(shouldCycleLang(ok, { ...ctx, capturing: true })).toBe(false)
    expect(shouldCycleLang(ok, { ...ctx, inField: true })).toBe(false)
  })

  it('三条件全假才切（唯一肯定路径）', () => {
    expect(shouldCycleLang(ok, ctx)).toBe(true)
  })

  it('LANG_NAME_KEY 三个专名两词典原样显示，不翻译', () => {
    expect(LANG_NAME_KEY).toEqual({
      zh: 'ui.lang.name.zh',
      'zh-TW': 'ui.lang.name.zhTW',
      en: 'ui.lang.name.en',
    })
    const lang = read('src/i18n/Lang.ts')
    expect(lang).toContain("'ui.lang.name.zh': '中文'")
    expect(lang).toContain("'ui.lang.name.zhTW': '繁體'")
    expect(lang).toContain("'ui.lang.name.en': 'English'")
  })

  it('接线不散在回调里：main.ts 用 shouldCycleLang 纯函数 + isCapturing getter', () => {
    const main = read('src/main.ts')
    expect(main).toContain('shouldCycleLang')
    expect(main).toContain('input.isCapturing')
    expect(main).toContain('setLang(nextLang(getLang()))')
    const input = read('src/core/Input.ts')
    expect(input).toContain('get isCapturing()')
  })
})
