/**
 * src/renderer/QualityRenderer.ts —— 画质档→渲染器分档消费者（Phase 7 F2/P2）。
 *
 * headless 可证：不依赖 WebGL/Canvas，只消费 QualityStore 的 profile() 读数，
 * 把 shadowMapSize / resolutionScale 灌入渲染器目标对象。Phase 9/10 才轮到真
 * GPU 侧（WebGLRenderer.setShadowMapSize / setPixelRatio）；本模块只留契约面，
 * 供组合根在主线里把 QualityStore 装进来，渲染帧每帧读一次当前值。
 *
 * 与 `QualityStore` 的关系：QualityStore 只管"当前档是多少"，本模块只管"档对应的
 * 渲染参数是什么"。两者分离，避免 renderer 直接依赖 settings 层。
 */

import { QualityStore, QUALITY_PROFILES, type QualityTier } from '@/settings/Quality'

/** 渲染器分档目标：headless 下只记不应用，消费者（Phase 9/10）再接真 GL 上下文。 */
export interface RendererQualityTargets {
  /** 阴影贴图边长（像素）。headless：只记，不应用。 */
  shadowMapSize: number
  /** 渲染分辨率比例（1 = 原生）。headless：只记，不应用。 */
  resolutionScale: number
}

/**
 * 把 QualityProfile 的 renderer 字段原样灌入 targets。
 * 每次调用都从当前 profile 读（不是缓存），配合 QualityStore.set/restore 的即时灌入。
 */
export function applyRendererQuality(
  targets: RendererQualityTargets,
  tier: QualityTier,
): void {
  const profile = QUALITY_PROFILES[tier]
  targets.shadowMapSize = profile.shadowMapSize
  targets.resolutionScale = profile.resolutionScale
}

/**
 * 画质档渲染器适配器：持有 QualityStore 的引用，每帧（或每次设置后）把当前档的
 * renderer 参数同步到 targets。组合根持有此实例，render 循环里每帧调用 sync()。
 */
export class RendererQuality {
  private targets: RendererQualityTargets
  private store: QualityStore

  constructor(store: QualityStore, targets: RendererQualityTargets) {
    this.store = store
    this.targets = targets
    this.sync()
  }

  /** 从当前 QualityStore profile 重新读取 renderer 参数，写入 targets。 */
  sync(): void {
    applyRendererQuality(this.targets, this.store.get())
  }

  /** 当前阴影贴图边长（像素）。 */
  get shadowMapSize(): number {
    return this.targets.shadowMapSize
  }

  /** 当前渲染分辨率比例（1 = 原生）。 */
  get resolutionScale(): number {
    return this.targets.resolutionScale
  }

  /** 当前画质档。 */
  get tier(): QualityTier {
    return this.store.get()
  }
}
