import type { ActionName, AnswerSource, UiIntent, Input } from '@/core/Input'
import type { BindChannel, BindingsStore } from '@/settings/Bindings'
import type { GameplaySettingsStore } from '@/settings/GameplaySettings'
import type { OpsPanelDeps } from './Stakerite'

/**
 * 「操作」页把手的唯一装配处（KI-337）。
 *
 * 这一格以前**有两份**：组合根里那份（生产真正用的）和测试假件里那份（走查用的一比一抄本）。
 * 两份字面一样，却永远不会出现在同一个 diff 里——于是面板的端口形状变了，红的只会是抄本，
 * 生产那份照样静默地接错（§55「同一个数不许有两个书写者」在接线层面的形状）。
 * 收成一个主人之后，测试问得出问题，生产用的就是被问的那一个。格子数从六格变七格那一次
 * （KI-342 补「无」那一把手）就是这句话的兑现处：只有一处要改。
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
    unbind: (action: ActionName) => bindings().unbind(action),
    /** 手柄那一列的「无」（KI-346）：与键盘那把并列，各自写各自那份名单——装配处不认识"哪张表"，只转发 */
    unbindPad: (action: ActionName) => bindings().unbindPad(action),
    resetKey: (action: ActionName, via: 'key' | 'pad') => bindings().resetKey(action, via),
    /**
     * 菜单那条通道的把手（KI-344 起三把，KI-345 补齐成与玩法同形，KI-346 起两节各多一把「手柄那一列的『无』」，
     * 于是每一节都是四把：改键 · 手柄改键 · 无 · 手柄的无，外加各自的「回默认」）。与玩法那几格**同一位主人**
     * （`BindingsStore`），也确实只是转发：整组怎么折、`Pad<n>` 落到哪张表、名单写哪一半，全在边界那侧算——
     * 装配处要是这里先分了一次岔（哪怕只是"菜单那一格直接写 `Input.uiBinds`"），
     * 面板写的就不是存档读的那一份了（上面「绕过 store」那两条老 bug 形状在第三条通道上的复发）。
     */
    rebindUi: (intent: UiIntent, code: string) => bindings().rebindUi(intent, code),
    unbindUi: (intent: UiIntent) => bindings().unbindUi(intent),
    /** 菜单那一行在**手柄那一列**上的「无」（KI-346）：拒绝仍由边界回答，面板只把那句话画出来 */
    unbindUiPad: (intent: UiIntent) => bindings().unbindUiPad(intent),
    resetUi: (intent: UiIntent, via: 'key' | 'pad') => bindings().resetUi(intent, via),
    /** 摇杆阈值（KI-345）：交回的是**夹过那一个数**，面板读它说话，自己不数界 */
    setStickThreshold: (v: number) => bindings().setStickThreshold(v),
    /** 扳机那条线（KI-364）：与上面那一把同一条纪律——界与治都在边界，装配处只是转发，夹一次都不做 */
    setTriggerThreshold: (v: number) => bindings().setTriggerThreshold(v),
    resetAll: () => bindings().restoreDefaults(),
    /**
     * 配置文件那三盒（KI-362，KI-363 加了第四把）：与 `capture` 同一个形状——几把把手、一位主人，装配处只是转发。
     * 这一层最容易写歪的那一种写法是「自己养一盒」（`const tapes = []` 住在闭包里）：面板当场看着生效、
     * 下一次读档就没了，正是 KI-337 立的那两条老 bug 形状在第五组把手上的复发。
     * `store` 交回的是边界的三种答案（new／overwritten／null）、`clear` 交回的是边界的那个布尔——
     * 覆盖与清空那两句都必须由主人说，面板手里没有那三格。
     * KI-368：`load`／`store` 各多转发一枚**可选**通道（屏上那枚「存取哪一半」递出来的），这一层仍然只做转发——
     * 落点由边界的 `withChannel` 说，装配处不替面板猜。`clear` 与 `list` 不收这一枚：请回空的始终是那一整格。
     */
    profiles: {
      list: () => bindings().profileFlags(),
      load: (i: number, ch?: BindChannel) => bindings().loadProfile(i, ch),
      store: (i: number, ch?: BindChannel) => bindings().storeProfile(i, ch),
      clear: (i: number) => bindings().clearProfile(i)
    },
    capture: {
      arm: (via: 'key' | 'pad') => input.armKeyCapture(via),
      cancel: () => input.cancelKeyCapture(),
      take: (only?: AnswerSource) => input.takeKeyCapture(only)
    }
  }
}
