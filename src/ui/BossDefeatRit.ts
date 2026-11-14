import { bus } from '@/core/EventBus'
import { nameOf } from '@/combat/CombatManager'
import { t } from '@/i18n/Lang'

/**
 * Boss 终局「烬印」（Phase F-49 · 前端第二十六维；F-48 KI-529 已占第二十五维）：
 * 每次 `boss.defeated` 触发，全屏铺开一幅终印——「{boss 名}」大字上金、
 * 顶部 overline「TERMINUS · 终 · 印」、副标「焚烬将寂 · 沉音归墟」、底部金丝 rule，
 * 右下角「终」字朱砂印章旋转落定，2.8s 后淡出。
 *
 * 设计（纯 DOM/CSS，下列每一条都对应本文件 CSS 里真实存在的选择器/keyframes）：
 * - 主字 `h1` 用 `background-clip:text` 金渐变 + `bdr-glyph-breathe` 呼吸
 * - 底部 `.rule` 由中心向两侧渐进展开（animation `bdr-rule`）
 * - 右下 `.seal`「终」字朱砂印 `rotate(-8deg)` 落定（animation `bdr-seal`）
 * - 四角 `.corner-tl/-tr/-bl/-br` 金丝（非竖排草书，无额外 web font）
 * - `prefers-reduced-motion` 全关动画、显示态 opacity:1
 * - 与 `bus` 扇出互不干扰（唯增监听器、不截断），零输入接管、不关自己
 *
 * 不声称：Boss 击败时序判决、音效触发、实机录像/截屏；纯装饰层。
 */

const CSS = `
.boss-defeat-rit { position: fixed; inset: 0; z-index: 41; display: none; pointer-events: none; }
.boss-defeat-rit.on { display: flex; animation: bdr-enter 2.8s ease forwards; }
.boss-defeat-rit .altar { position: relative; margin: auto; text-align: center; max-width: 860px; padding: 60px 80px 52px;
  background: radial-gradient(ellipse 90% 60% at 50% 48%, rgba(8,6,10,.92), rgba(8,6,10,.52) 58%, transparent 84%); }
.boss-defeat-rit .overline { font-size: 11px; letter-spacing: .78em; text-indent: .78em; color: rgba(201,162,88,.72); margin-bottom: 18px; }
.boss-defeat-rit h1 { position: relative; font-size: 96px; line-height: 1.02; letter-spacing: .16em; text-indent: .16em;
  margin: 0; font-weight: 400; color: #c9a258;
  background: linear-gradient(180deg, #fdf6dd 0%, #e8d08a 22%, #c9a258 46%, #7d6436 78%, #fdf6dd 100%);
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
  text-shadow: none; animation: bdr-glyph-breathe 2.6s ease-in-out infinite alternate; }
@keyframes bdr-glyph-breathe { 0% { opacity: .66; transform: translateY(4px) } 100% { opacity: 1; transform: translateY(0) } }
.boss-defeat-rit .sub { margin-top: 16px; font-size: 13px; letter-spacing: .6em; text-indent: .6em; color: rgba(232,223,203,.78); }
.boss-defeat-rit .rule { width: 140px; height: 1px; margin: 18px auto 0;
  background: linear-gradient(90deg, transparent, rgba(201,162,88,.9) 22%, rgba(253,246,221,.95) 50%, rgba(201,162,88,.9) 78%, transparent);
  animation: bdr-rule 1.7s cubic-bezier(.2,.7,.3,1) .25s both; }
@keyframes bdr-rule { 0% { transform: scaleX(0); opacity: 0 } 60% { opacity: 1 } 100% { transform: scaleX(1); opacity: 1 } }
.boss-defeat-rit .corner-tl, .boss-defeat-rit .corner-tr, .boss-defeat-rit .corner-bl, .boss-defeat-rit .corner-br {
  position: absolute; width: 44px; height: 44px; border: 0 solid rgba(201,162,88,.6); }
.boss-defeat-rit .corner-tl { top: 12px; left: 12px; border-top-width: 1px; border-left-width: 1px; }
.boss-defeat-rit .corner-tr { top: 12px; right: 12px; border-top-width: 1px; border-right-width: 1px; }
.boss-defeat-rit .corner-bl { bottom: 12px; left: 12px; border-bottom-width: 1px; border-left-width: 1px; }
.boss-defeat-rit .corner-br { bottom: 12px; right: 12px; border-bottom-width: 1px; border-right-width: 1px; }
.boss-defeat-rit .seal { position: absolute; bottom: 26px; right: 64px; width: 88px; height: 88px;
  border: 2px solid rgba(165,68,82,.85); border-radius: 6px; background: rgba(165,68,82,.08);
  transform: rotate(-8deg); display: flex; align-items: center; justify-content: center;
  color: rgba(201,74,92,.95); font-size: 52px; font-weight: 400; letter-spacing: .06em; line-height: 1;
  box-shadow: inset 0 0 18px rgba(165,68,82,.28), 0 0 24px rgba(165,68,82,.18);
  animation: bdr-seal 1.1s cubic-bezier(.22,.9,.28,1.15) .45s both; }
@keyframes bdr-seal { 0% { opacity: 0; transform: rotate(-38deg) scale(1.6) } 100% { opacity: 1; transform: rotate(-8deg) scale(1) } }
@keyframes bdr-enter { 0% { opacity: 0 } 10% { opacity: 1 } 74% { opacity: 1 } 100% { opacity: 0 } }
@media (prefers-reduced-motion: reduce) {
  .boss-defeat-rit, .boss-defeat-rit h1, .boss-defeat-rit .rule, .boss-defeat-rit .seal { animation: none !important; opacity: 1; transform: none; }
  .boss-defeat-rit .seal { transform: rotate(-8deg) }
}
`

interface BossDefeatedPayload {
  id: string
  dataId: string
  nameKey: string
  holdTicks: number
}

export class BossDefeatRit {
  private readonly root: HTMLDivElement
  private readonly unsub: Array<() => void> = []

  constructor() {
    BossDefeatRit.injectCss()
    this.root = document.createElement('div')
    this.root.id = 'boss-defeat-rit'
    this.root.className = 'boss-defeat-rit'
    this.root.setAttribute('aria-hidden', 'true')
    document.body.appendChild(this.root)
    this.unsub.push(
      bus.on('boss.defeated', (p) => {
        this.render(p)
      }),
    )
  }

  static injectCss(): void {
    if (document.getElementById('boss-defeat-rit-css')) return
    const style = document.createElement('style')
    style.id = 'boss-defeat-rit-css'
    style.textContent = CSS
    document.head.appendChild(style)
  }

  private render(p: BossDefeatedPayload): void {
    const name = nameOf(p.nameKey) || p.nameKey
    this.root.innerHTML = this.renderMarkup(name)
    // 标准重播：先摘 on → 强制回流 → 再加 on（同 F-47 做法）
    this.root.classList.remove('on')
    void (this.root as HTMLElement & { offsetWidth: number }).offsetWidth
    this.root.classList.add('on')
  }

  private renderMarkup(name: string): string {
    return `<div class="altar">
      <span class="corner-tl" aria-hidden="true"></span><span class="corner-tr" aria-hidden="true"></span>
      <span class="corner-bl" aria-hidden="true"></span><span class="corner-br" aria-hidden="true"></span>
      <div class="overline">${t('ui.boss.defeatRit.overline')}</div>
      <h1>${name}</h1>
      <div class="sub">${t('ui.boss.defeatRit.sub')}</div>
      <div class="rule"></div>
      <div class="seal" aria-hidden="true">${t('ui.boss.defeatRit.seal')}</div>
    </div>`
  }

  /** 解订 + 摘 DOM（HMR／重构建友好） */
  dispose(): void {
    for (const u of this.unsub) u()
    this.unsub.length = 0
    this.root.remove()
  }

  static construct(): BossDefeatRit {
    return new BossDefeatRit()
  }
}
