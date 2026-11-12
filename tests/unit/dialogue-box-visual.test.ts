import { describe, expect, it } from 'vitest'

/** DialogueBox「余烬」ambient rite：纯 CSS · 无 JS 行为 · reduced-motion 兜底。 */
describe('dialogue-box ambient rite (KI-? Phase F-58)', () => {
  it('DialogueBox 注入的 <style> 含木盒呼吸辉光 + 说话字慢脉动 + reduced-motion 兜底（Phase F-58）', async () => {
    const { DialogueBox } = await import('@/ui/DialogueBox')
    const head: Array<{ textContent: string } & Record<string, unknown>> = []
    const document: Record<string, unknown> = {
      createElement: (tag: string) => {
        const el: Record<string, unknown> = { tagName: tag, id: '', style: {}, dataset: {}, appendChild: () => {}, remove: () => {}, addEventListener: () => {}, setAttribute: () => {} }
        if (tag === 'style') head.push(el as never)
        return el
      },
      createElementNS: (_ns: string, tag: string) => {
        const el: Record<string, unknown> = { tagName: tag, id: '', style: {}, dataset: {}, setAttribute: () => {} }
        return el
      },
      head: {
        appendChild: (el: { textContent?: string }) => { if (el.textContent) head.push(el as never) },
        children: head,
      },
      body: { appendChild: () => {}, removeChild: () => {} },
      querySelector: () => null,
      createDocumentFragment: () => ({ appendChild: () => {} }),
    }
    ;(globalThis as unknown as { document: unknown }).document = document
    new DialogueBox({ onChoose: () => {}, onAdvance: () => {}, onClose: () => {} } as never)
    const css = (head[0] as unknown as { textContent: string }).textContent
    expect(css).toContain('dlg-warm')
    expect(css).toContain('dlg-who')
    expect(css).toContain('@keyframes dlg-warm')
    expect(css).toContain('@keyframes dlg-who')
    expect(css).toContain('#dialogue .ch:focus-visible')
    expect(css).toContain('prefers-reduced-motion')
    expect(css).toContain('will-change')
  })
})
