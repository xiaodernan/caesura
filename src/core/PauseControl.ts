import type { ActionName } from './Input'
import type { GameTime } from './Time'

/**
 * 世界停摆的**唯一主人**（KI-387）。
 *
 * 病：`main.ts` 里有两个地方写同一个布尔——`setOverlay` 那句 `time.paused = overlay !== null`
 * 与 Escape 那句 `time.paused = !time.paused`。两边都不认识对方，于是"开一张面板再关掉"
 * 这一串动作会把玩家自己按下的那次暂停悄悄解开：读方（`GameLoop` 的闸门、`Time.dt`、
 * `Time.hitStop`）只看得到一个布尔，看不出它是谁写的，也看不出该不该留。
 *
 * 裁决：停摆有**两个来源**，各占一格——菜单在场（overlay 那一路）与玩家手动（那一路）。
 * `time.paused` 只由这一处合成，两条路各自只许改自己那一格。玩家那一格因此不会被 overlay
 * 的周期覆盖，而 overlay 关掉之后世界是否继续停，取决于玩家那一格，不取决于谁最后写了一次。
 *
 * 这一格不认识"哪一块面板在场"（那是 `setOverlay` 与 `input.uiOwner` 的事），也不认识过场
 * （`cinematics.inputLocked` 夺的是玩法那条输入，不是世界停摆）。
 */
export class PauseControl {
  private overlayHeld = false
  private userPaused = false

  constructor(private readonly time: GameTime) {}

  /** 菜单那一路：在场就按住，不在场就松开——它不许动玩家那一格 */
  holdByOverlay(open: boolean): void {
    this.overlayHeld = open
    this.sync()
  }

  /** 玩家那一路：只翻自己那一格 */
  toggleByUser(): void {
    this.userPaused = !this.userPaused
    this.sync()
  }

  get heldByOverlay(): boolean { return this.overlayHeld }

  get pausedByUser(): boolean { return this.userPaused }

  /** 合成读数：任何一路按住都算停（这也是 `time.paused` 唯一的来路） */
  get worldPaused(): boolean { return this.overlayHeld || this.userPaused }

  private sync(): void {
    this.time.paused = this.worldPaused
  }
}

/**
 * 玩法通道那枚 `pause` 的**读者**（KI-388）。
 *
 * 病不在合成公式，在通道：名册里有 `pause`，默认键表把 `Escape` 指给它，手柄两枚按钮（8／17）
 * 也映射到它，而全 src 没有一个地方读这个名字（普查现量：22 枚动作里唯它一枚无读者）。
 * 于是手动暂停绕过这两张表，直接吃浏览器的 `e.code === 'Escape'`——改键面板里那一行「暂停」
 * 按下去什么都不改，手柄上那两枚按下去也不停。
 *
 * 读者为什么住在 core 而不是组合根：`src/main.ts` 没有任何测试直接 import（KI-387 普查 G6），
 * 只在那里裁决的格子永远量不到。这里只要一个「能不能吞下一枚边沿」的端口，真 `Input` 与
 * 替身都接得上。
 *
 * 谁每秒叫它一次是接线的事，而且位置有讲究：必须在 `GameLoop` 的**渲染那一路**调用。
 * `systems.update` 整段被 `if (!this.time.paused)` 挡着，读者若在里面就只能停不能开——
 * 那是 `Input.ts` 里 Tab 那条老死路的同一格。
 */
export function readPauseAction(
  source: { consume(a: ActionName): boolean },
  control: PauseControl,
): boolean {
  if (!source.consume('pause')) return false
  control.toggleByUser()
  return true
}
