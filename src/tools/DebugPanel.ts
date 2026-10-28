/**
 * 运行时调试面板的公共外壳（需求 §54：F1/F3/F4/F5 呼出，仅 DEV 构建接线——见 `main.ts`）。
 *
 * 为什么有一块外壳：F2 的 `CombatDebugger` 已经证明"面板 = 一个 fixed 等宽 div + 一个 F 键 +
 * 只在打开时才生成文本"这三件事每块面板都一样。抄四遍的结局是第四块面板的字号与另外三块不同，
 * 而那种差异没人会去修。
 *
 * 面板**不认识任何逻辑实例**：内容是一条 `text()` 回调，由组合根闭包捕获要读的东西。于是
 * `tools/` 不 import 战斗/AI/任务运行时（依赖闸门守着），而文本装配本身可以在 node 里直接测。
 */
export interface DebugPanelSpec {
  /** 呼出键（F2 归 `CombatDebugger`，它比这块外壳早落地，不动它；F5 是性能面板 ⇒ §5.7 那句
   * 「F 键」在这里落成的具体一把，`KeyF` 是格挡玩法键，不抢） */
  key: 'F1' | 'F3' | 'F4' | 'F5'
  /** 面板标题，会印在第一行 */
  label: string
  /** 停靠位置（CSS 声明）：左上已被 F2 占住，其余面板错开，两块同时开着也不互相盖住 */
  anchor: string
  /** 由组合根提供的只读文本；面板不知道它读的是敌人、任务还是 AI */
  text: () => string
  /**
   * 开/关切换的通知（KI-335：性能面板要的是「关着连计时都不付」，而不只是「关着不生成字」）。
   * 只有 F5 用得上——其余面板的 `text()` 本身就是关着不叫的，没有第二条要联动的开关。
   */
  onToggle?: (enabled: boolean) => void
}

export class DebugPanel {
  private readonly el: HTMLDivElement
  enabled = false

  constructor(private readonly spec: DebugPanelSpec) {
    const d = document.createElement('div')
    d.style.cssText = [
      spec.anchor, 'z-index:9998',
      'display:none', 'pointer-events:none',
      'font:11px/1.45 Consolas, "JetBrains Mono", Menlo, monospace',
      'color:#8fd0c0', 'background:rgba(7,8,12,0.78)',
      'border:1px solid rgba(143,208,192,0.32)', 'padding:8px 10px',
      'white-space:pre', 'max-width:620px',
    ].join(';')
    document.body.appendChild(d)
    this.el = d
    window.addEventListener('keydown', this.onKey)
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey)
    this.el.remove()
  }

  /** 每逻辑帧由组合根叫一次。**关着的时候一个字符串都不生成**——默认全关是这套系统的存在理由。 */
  refresh(): void {
    if (!this.enabled) return
    this.el.textContent = `${this.spec.key} · ${this.spec.label}\n${this.spec.text()}`
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key !== this.spec.key) return
    e.preventDefault()
    this.enabled = !this.enabled
    this.el.style.display = this.enabled ? 'block' : 'none'
    // 先开关、后刷字：性能面板的 `open()` 会清窗口，刷新必须看见"清过之后"的状态
    this.spec.onToggle?.(this.enabled)
    this.refresh()
  }
}
