import { bus } from '@/core/EventBus'
import { t, getLang } from '@/i18n/Lang'

/**
 * 区域进场仪典（Phase F-XX）：当玩家第一次踏入某个 `regions.json` 登记的区域时，屏幕上方
 * 浮出一块足金牌位字（大号衬线体 + 金边细线 + 极低频呼吸），约 3.2 秒后退场。
 *
 * 触发：`world.chunk` 带了 regionId——玩家每滚一格就会打这块石头，这里只判一次
 *        「这个 regionId 这一局见过了没」：见过了什么也不做；没见过 ⇒ 记录 + 展示。
 *        同一局里从大厅重入大厅不重播。读档回上一区也不补打（存档没记"进过哪些区"——
 *        这是 §78「留空是如实」：省一处台账也省一处谎话）。
 * 不接收：键盘 / 鼠标 / 存档（显示层，不是权限层）。
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

    this.unsub.push(bus.on('world.chunk', (p) => this.maybe(p)))
  }

  static injectCss(): void {
    if (document.getElementById('region-banner-css')) return
    const style = document.createElement('style')
    style.id = 'region-banner-css'
    style.textContent = CSS
    document.head.appendChild(style)
  }

  private maybe(p: { regionId: string; center: { x: number; y: number; z: number } }): void {
    if (this.shown.has(p.regionId)) return
    this.shown.add(p.regionId)
    const r = this.root as unknown as HTMLDivElement
    r.innerHTML = `<div class="glow"></div><div class="name">${escapeHtml(displayOf(p.regionId))}<small>${escapeHtml(t('ui.region.enter.sub'))}</small></div><div class="rule"></div>`
    r.classList.add('on')
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

/** regions.json 的 id → 玩家友好名（按当前语言取；汉中模式里给出全名「无耳深窖 Earless Deeps」） */
const NAMES: Record<string, { zh: string; en: string }> = {
  rg_resthold: { zh: '休垒 Resthold', en: 'Resthold' },
  rg_whisperwode: { zh: '雾语林 Whisperwode', en: 'Whisperwode' },
  rg_drowned_choir: { zh: '沉唱堂 Drowned Choir', en: 'Drowned Choir' },
  rg_brokenbar_camp: { zh: '破拍营地 Brokenbar Camp', en: 'Brokenbar Camp' },
  rg_fellcarillon: { zh: '钟坠院 Fellcarillon', en: 'Fellcarillon' },
  rg_earless_deeps: { zh: '无耳深窖 Earless Deeps', en: 'Earless Deeps' },
  rg_unfinished_hall: { zh: '未竟厅 The Unfinished Hall', en: 'The Unfinished Hall' },
  rg_windcoast: { zh: '风钟海岸 Windbell Coast', en: 'Windbell Coast' },
}
const displayOf = (id: string): string => {
  const n = NAMES[id]
  if (!n) return id
  return getLang() === 'en' ? n.en : n.zh
}
const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
