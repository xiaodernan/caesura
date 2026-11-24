/**
 * tests/unit/sim-real-visitor.test.ts — 真人行为模拟器的纯函数契约（零网络 · 不需要 Pages 部署）：
 *   ① storySlugs 单一真相源来自 read-progress.js（80 项，首项 salt）；
 *   ② publicPageList 去重 + 含 anthology/codex/cast；
 *   ③ extractInnerLinks 只收 /caesura/ 绝对路径并去重；
 *   ④ mulberry32 对固定 seed 给出确定性序列；
 *   ⑤ parseArgs 解析 --k=v。
 */
import { describe, expect, it } from 'vitest'
import {
  publicPageList,
  storySlugs,
  listStoryPages,
  extractInnerLinks,
  mulberry32,
  pick,
  parseArgs,
} from '../../scripts/sim-real-visitor.mjs'

describe('sim-real-visitor 纯函数', () => {
  it('storySlugs = 92 项（ORDER 全量），过滤后 = 91 个真实页面', () => {
    const all = storySlugs()
    expect(all.length).toBe(93)
    expect(all.filter(Boolean).length).toBe(92)
  })

  it('publicPageList：去重且包含 anthology / codex / cast / admin', () => {
    const pages = publicPageList()
    expect(new Set(pages).size).toBe(pages.length)
    expect(pages).toContain('/caesura/')
    expect(pages).toContain('/caesura/story/anthology/')
    expect(pages).toContain('/caesura/codex/')
    expect(pages).toContain('/caesura/cast/')
    expect(pages).toContain('/caesura/admin/')
    expect(pages).toContain('/caesura/story/the-salt-is-there/')
    expect(pages).toContain('/caesura/story/two-lines/')
    expect(listStoryPages().length).toBe(92)
  })

  it('extractInnerLinks：只返回 /caesura/ 唯一内链', () => {
    const html = '<a href="/caesura/story/two-lines/">x</a><a href="/caesura/story/two-lines/">dup</a><a href="https://github.com/outside">o</a><a href="story/relative/">r</a>'
    expect(extractInnerLinks(html)).toEqual(['/caesura/story/two-lines/'])
  })

  it('mulberry32：同 seed 序列确定，pick 也确定', () => {
    const r1 = mulberry32(20261119)
    const r2 = mulberry32(20261119)
    const a = [r1(), r1(), r1(), r1()]
    const b = [r2(), r2(), r2(), r2()]
    expect(a).toEqual(b)
    expect(pick(mulberry32(1), ['a', 'b', 'c', 'd'])).toBe(pick(mulberry32(1), ['a', 'b', 'c', 'd']))
  })

  it('parseArgs：--seed=1 解析成 1（数字）', () => {
    expect(parseArgs(['--seed=1', '--concurrency=4']).seed).toBe('1')
    expect(parseArgs(['--foo=bar', 'bare']).foo).toBe('bar')
    expect(parseArgs(['bare']).foo).toBeUndefined()
  })
})
