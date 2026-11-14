import { bus } from '@/core/EventBus'
import { t } from '@/i18n/Lang'

/**
 * 区域进场仪典：当玩家第一次踏入某个 `regions.json` 登记的区域时，屏幕上方
 * 浮出一块足金牌位字（大号衬线体 + 金边细线 + 极低频呼吸），约 3.4s 后退场。
 *
 * 触发：`ui.region.enter` 事件（由 composition root 在跨区判定里发射）。
 * 声源只有一处：`main.ts > streaming.regionAt` ⇒ `here.id !== shownRegion` 这一句。
 * 一局之内每个 region 只显现一次（shown 去重，不记忆到档——「读档回上一区不重播」是 §78「留空是如实」）。
 * 当前区/旧档/无法进入的区域，一律不打。
 */
const CSS = `
.region-banner { position:fixed; left:0; right:0; top:22vh; z-index:39; pointer-events:none;
  display:flex; flex-direction:column; align-items:center; gap:8px;
  opacity:0; transform:translateY(12px); transition: opacity .45s ease, transform .45s ease;
  font-family:Georgia,"Songti SC","STSong","SimSun",serif; color:#e8dfcb; text-align:center; }
.region-banner.on { opacity:1; transform:translateY(0) }
.region-banner .name { position:relative; font-size:56px; line-height:1.1; letter-spacing:.22em;
  color:#ffe4a4; text-shadow:0 0 26px rgba(255,184,107,.22), 0 2px 0 rgba(0,0,0,.6);
  padding:0 .5em; }
.region-banner .name small { display:block; font-size:13px; letter-spacing:.46em; color:rgba(201,180,88,.78); text-indent:.46em; margin-top:10px }
.region-banner .rule { width:232px; height:1px; background:linear-gradient(90deg, transparent, rgba(201,180,88,.85), transparent) }
.region-banner .glow { width:520px; height:34px; background:radial-gradient(ellipse at center, rgba(255,184,107,.2), transparent 72%); filter:blur(6px); margin-top:-8px }
@media (prefers-reduced-motion: reduce) { .region-banner { transition:none } }
@media (max-width: 720px) { .region-banner .name { font-size:34px } .region-banner .glow { width:320px } }
`

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export class RegionBanner {
  private readonly root: HTMLDivElement
  private readonly unsub: Array<() => void> = []
  private shown = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor() {
    RegionBanner.injectCss()
    this.root = document.createElement('div')
    this.root.id = 'region-banner'
    this.root.className = 'region-banner'
    this.root.setAttribute('aria-hidden', 'true')
    document.body.appendChild(this.root)

    this.unsub.push(bus.on('ui.region.enter', (p) => this.maybe(p)))
  }

  static injectCss(): void {
    if (document.getElementById('region-banner-css')) return
    const style = document.createElement('style')
    style.id = 'region-banner-css'
    style.textContent = CSS
    document.head.appendChild(style)
  }

  private maybe(p: { regionId: string; displayName: string }): void {
    if (this.shown.has(p.regionId)) return
    this.shown.add(p.regionId)
    this.root.innerHTML = `<div class="glow"></div><div class="name">${escapeHtml(p.displayName)}<small>${escapeHtml(t('ui.region.enter.sub'))}</small></div><div class="rule"></div>`
    this.root.classList.add('on')
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.root.classList.remove('on'), 3400)
  }

  dispose(): void {
    for (const u of this.unsub) u()
    this.unsub.length = 0
    if (this.timer) clearTimeout(this.timer)
    this.root.remove()
  }
}
