import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * index.html「启封仪典」（Phase F-42 · 禅宗启明）。
 *
 * 游戏首屏是 `CAESURA` 提示，由 main.ts 的一行 `display:none` 藏起来——
 * 它主导着「在任何一帧绘制之前，玩家第一眼看到什么」。本文件钉的是它的**真 HTML 契约**：
 * 不自称像素评审、不自称渲染性能；钉的是可复跑的事实——这套皮肤自己声明它存在、它遵守 reduced-motion、
 * 它不外链、它还挂着真入口（`/src/main.ts`）。
 */

const HTML = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8')

describe('index.html：启封仪典 · 止音启明（Phase F-42）', () => {
  it('含 CAESURA 主 word（.word 载体金色描边字）与「止音纪元」副标（<small>）', () => {
    expect(HTML).toContain('<span class="word">CAESURA</span>')
    expect(HTML).toContain('<small>止音纪元</small>')
  })

  it('背景是三层暗纹径向（墨青→深底），外环双描金丝印 + 顶烬点伪元素', () => {
    expect(HTML).toContain('radial-gradient(ellipse 68% 56% at 50% 46%')
    expect(HTML).toContain('#boot::before')
    expect(HTML).toContain('#boot::after')
    expect(HTML).toContain('border-radius:50%')
  })

  it('烬点呼吸动画真存在（@keyframes boot-ember）且 reduced-motion 下全关', () => {
    expect(HTML).toContain('@keyframes boot-ember')
    expect(HTML).toContain('boot-ember')
    expect(HTML).toContain('prefers-reduced-motion')
  })

  it('主 word 用 background-clip:text 的金色描边字（无滤镜堆叠、零 JS）', () => {
    expect(HTML).toContain('background-clip:text')
    expect(HTML).toContain("-webkit-text-fill-color:transparent")
  })

  it('零外链（不引 CDN/远程 CSS/远程字体）；真入口仍为 /src/main.ts', () => {
    expect(HTML).not.toMatch(/(src|href)="https?:/)
    expect(HTML).toContain('/src/main.ts')
  })

  it('不破坏 main.ts 的接管：boot 节点存在且 id 仍为 boot（main.ts 按 id 藏起来）', () => {
    expect(HTML).toMatch(/<div id="boot">/)
  })
})
