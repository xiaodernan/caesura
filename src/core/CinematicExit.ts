import type { UiIntent } from './Input'

/**
 * 过场期间的**出口读者**（KI-390 乙案）。与 `readPauseAction`（KI-388）同族：一个只认动作名、
 * 一个只认菜单意图，两个都把"读哪一格"收在自己手里，把"怎么做"交给调用方递进来的回调。
 *
 * 病（账本 KI-390 行）：`lockInput`＝true 的过场期间，玩法那条被 KI-392 那道每帧现问的闸夺走，
 * 菜单那条又因为 `uiOwner` 为假而一个边沿都不发（`Input.ts` 的 `if (this.uiOwner)` 那一句）⇒
 * 手柄玩家既停不下（暂停在过场里不存在是 KI-389 已钉的裁决）也跳不出，只能等它自己走完。
 *
 * 它**做**什么：这一帧的菜单边沿里有 `confirm` 或 `back` ⇒ 叫一次 `skip()`，并答"我吃了出口"。
 * 它**不做**什么（三条都是刻意的）：
 * - **不碰玩法那条**：`enabled`／`playLive` 各有自己的主人，这一格只走菜单通道；
 * - **不吞边沿**：`uiEdges` 每帧新建（`Input.ts` 里那句 `this.uiEdges = uiEdges`），下一帧自然为空，
 *   所以这里看一眼就够，不必去改一个不属于它的集合——改它等于第二个主人；
 * - **同帧两枚也只叫一次**：`Cinematics.skip()` 会把排队的那条接上来（§6 的终局蒙太奇正是排在
 *   结局后面的那一段），一帧连跳两次等于把共享的那一段也吞掉。
 *
 * `skip` 由调用方递进来而不是 import 播放器：这个读者不需要知道"跳过"具体怎么做（发总线事件、
 * 接排队的那条），知道了就多一处真相。组合根那一句是 `() => skipCinematic()`。
 */
export function readCinematicExit(edges: ReadonlySet<UiIntent>, skip: () => void): boolean {
  if (!edges.has('confirm') && !edges.has('back')) return false
  skip()
  return true
}
