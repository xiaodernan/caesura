import { bus } from '@/core/EventBus'
import { nameOf } from '@/combat/CombatManager'
import { t } from '@/i18n/Lang'

/**
 * Boss「换段誓约」（Phase F-47 · 前端第二十四维；F-46 PauseOverlay 已占第二十三维）：
 * 每次 `boss.phase` 触发，全屏中央短暂亮起一个签押式徽章——「boss 名」+「第 N 阶」
 * 双语副标，1.4s 后淡出。
 * 完全独立的轻 DOM 覆盖：不接输入、不关自己、不替换现有 bossPhraseBar / hud canvas 层，
 * 「boss.phase」自身的事件扇出不会被本模块截断（signal）。
 *
 * 不声称：音效触发 / 不劫持 `boss.phase` 的订阅链 / 不改 Hud.ts / 不测试真 canvas 像素。
 */

const CSS = `
.boss-phase-banner { position: fixed; inset: 0; z-index: 39; display: none; pointer-events: none; }
.boss-phase-banner.on { display: flex; animation: bpb-enter 1.4s ease forwards; }
.boss-phase-banner .wrap { position: relative; margin: auto; text-align: center; max-width: 720px; padding: 28px 64px 22px;
  background: radial-gradient(ellipse 95% 55% at 50% 50%, rgba(9,10,15,.78), rgba(9,10,15,.28) 62%, transparent 82%); }
.boss-phase-banner h2 { font-size: 54px; letter-spacing: .1em; margin: 0; color: #c9b458; font-weight: 400;
  text-shadow: 0 0 28px rgba(201,180,88,.35); }
.boss-phase-banner .sub { margin-top: 6px; font-size: 12px; letter-spacing: .52em; color: rgba(201,180,88,.66); text-indent: .52em; }
.boss-phase-banner .rule { position: relative; width: 76px; height: 1px; margin: 16px auto;
  background: linear-gradient(90deg, transparent, rgba(201,180,88,.85), transparent);
  animation: bpb-rule 1.1s cubic-bezier(.2,.7,.3,1) .12s both; }
@keyframes bpb-rule { 0% { transform: scaleX(0); opacity: 0; } 100% { transform: scaleX(1); opacity: 1; } }
.boss-phase-banner .corner-left { position: absolute; top: 14px; left: 14px; width: 28px; height: 28px;
  border-left: 1px solid rgba(201,180,88,.55); border-top: 1px solid rgba(201,180,88,.55); }
.boss-phase-banner .corner-right { position: absolute; top: 14px; right: 14px; width: 28px; height: 28px;
  border-right: 1px solid rgba(201,180,88,.55); border-top: 1px solid rgba(201,180,88,.55); }
.boss-phase-banner .corner-foot-left { position: absolute; bottom: 14px; left: 14px; width: 18px; height: 18px;
  border-left: 1px solid rgba(165,68,82,.32); border-bottom: 1px solid rgba(165,68,82,.32); }
.boss-phase-banner .corner-foot-right { position: absolute; bottom: 14px; right: 14px; width: 18px; height: 18px;
  border-right: 1px solid rgba(165,68,82,.32); border-bottom: 1px solid rgba(165,68,82,.32); }
.boss-phase-banner .wrap::after { content: ""; position: absolute; left: 50%; bottom: 6px; transform: translateX(-50%);
  width: min(62%, 440px); height: 1px; background: linear-gradient(90deg, transparent, rgba(201,180,88,.4), transparent); opacity: .7; }
@keyframes bpb-enter {
  0%   { opacity: 0; }
  12%  { opacity: 1; }
  80%  { opacity: 1; }
  100% { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .boss-phase-banner { animation: none; }
}
`

interface BossPhasePayload {
  id: string
  phase: number
  phases: number
  nameKey: string
  pos?: { x: number; y: number; z: number }
}

export class BossPhaseBanner {
  private readonly root: HTMLDivElement
  private readonly unsub: Array<() => void> = []

  constructor() {
    BossPhaseBanner.injectCss()
    this.root = document.createElement('div')
    this.root.id = 'boss-phase-banner'
    this.root.className = 'boss-phase-banner'
    this.root.setAttribute('aria-hidden', 'true')
    document.body.appendChild(this.root)
    this.unsub.push(
      bus.on('boss.phase', (p) => {
        this.render(p)
      }),
    )
  }

  static injectCss(): void {
    if (document.getElementById('boss-phase-banner-css')) return
    const style = document.createElement('style')
    style.id = 'boss-phase-banner-css'
    style.textContent = CSS
    document.head.appendChild(style)
  }

  private render(p: BossPhasePayload): void {
    // Boss 出场（phase=1）通常不触发，phase ≥ 2 才是换段——但这里不给默认过滤——让调用方（bus payload）说了算
    this.root.innerHTML = this.renderMarkup(p)
    // 重播真重启 CSS animation：连续两次 boss.phase 时 .on 已在，若只 add('on') 是 no-op、
    // bpb-enter 不会从头跑 ⇒ 第二次换段只换字、不再有淡入淡出。标准手法：摘 .on → 读一次
    // offsetWidth 强制回流（让浏览器结算"动画已移除"）→ 重新挂 .on。零定时器、DOM 节点不闪烁，
    // 保持自身无状态。prefers-reduced-motion 下没有动画可重启，三步退化成幂等的显隐。
    this.root.classList.remove('on')
    void this.root.offsetWidth
    this.root.classList.add('on')
  }

  private renderMarkup(p: BossPhasePayload): string {
    const name = nameOf(p.nameKey)
    return `<div class="wrap">
      <span class="corner-left" aria-hidden="true"></span>
      <span class="corner-right" aria-hidden="true"></span>
      <span class="corner-foot-left" aria-hidden="true"></span>
      <span class="corner-foot-right" aria-hidden="true"></span>
      <h2>${name}</h2>
      <div class="sub">${t('ui.boss.phase.sub', { phase: p.phase, phases: p.phases })}</div>
      <div class="rule"></div>
    </div>`
  }

  /** 收起显式隐藏（HMR／shutdown 用） */
  dispose(): void {
    for (const u of this.unsub) u()
    this.unsub.length = 0
    this.root.remove()
  }

  /** 重构建（HMR 友好：dispose + 重 new） */
  static construct(): BossPhaseBanner {
    return new BossPhaseBanner()
  }
}
