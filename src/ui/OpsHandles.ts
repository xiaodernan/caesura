import type { ActionName, Input } from '@/core/Input'
import type { BindingsStore } from '@/settings/Bindings'
import type { GameplaySettingsStore } from '@/settings/GameplaySettings'
import type { OpsPanelDeps } from './Stakerite'

/**
 * 「操作」页把手的唯一装配处（KI-337）。
 *
 * 这一格以前**有两份**：组合根里那份（生产真正用的）和测试假件里那份（走查用的一比一抄本）。
 * 两份字面一样，却永远不会出现在同一个 diff 里——于是面板的端口形状变了，红的只会是抄本，
 * 生产那份照样静默地接错（§55「同一个数不许有两个书写者」在接线层面的形状）。
 * 收成一个主人之后，测试问得出问题，生产用的就是被问的那一个。
 *
 * 后两个参数是**函数**而不是 store 本体：组合根里那两个 store 声明在这块面板之后
 * （`gameplayStore` 要 `rig`/`haptics`/`combat`，它们都比面板晚就位），而把手要到玩家点开
 * 那一页才被调用。把这件事写成类型上的"到时候再取"，比在这里靠一句注释解释为什么不炸更好。
 * 面板那侧仍然只拿到函数：它不认识 `BindingsStore`，也不认识默认键位表（见 `OpsPanelDeps`）。
 */
export function makeOpsHandles(
  input: Input,
  bindings: () => BindingsStore,
  gameplay: () => GameplaySettingsStore
): OpsPanelDeps {
  return {
    gameplay: () => gameplay().get(),
    setGameplay: (patch) => gameplay().set(patch),
    rebind: (action: ActionName, code: string) => bindings().rebind(action, code),
    resetKey: (action: ActionName) => bindings().resetKey(action),
    resetAll: () => bindings().restoreDefaults(),
    capture: {
      arm: () => input.armKeyCapture(),
      cancel: () => input.cancelKeyCapture(),
      take: () => input.takeKeyCapture()
    }
  }
}
