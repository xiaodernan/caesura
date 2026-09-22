import { bus } from '@/core/EventBus'
import type { SaveGame } from './Serializer'

/**
 * 自动存档触发器（technical-architecture §2 save/Checkpoint.ts；需求 §45/§71）。
 * 三个时机按设计文档来：调音桩休息、Boss 跳阶、区域首次进入。
 * 游戏循环是同步的而存储是异步的 ⇒ 这里只排队（连击合并成一次），不阻塞任何一帧；
 * 失败必须说出来 —— 「以为存档了其实没存」比不能存档更糟。
 */
export class Checkpoints {
  private queued: string[] = []
  private running = false
  /** 观测用：成功落盘的次数与最后一次的原因 */
  writes = 0
  lastReason: string | null = null
  failures = 0

  constructor(private readonly save: SaveGame, private readonly slot = 'autosave') {}

  request(reason: string): void {
    this.queued.push(reason)
    if (!this.running) void this.drain()
  }

  private async drain(): Promise<void> {
    this.running = true
    try {
      while (this.queued.length) {
        const reasons = this.queued.splice(0, this.queued.length)
        const reason = [...new Set(reasons)].join('+')
        try {
          await this.save.save(this.slot)
          this.writes++
          this.lastReason = reason
          bus.emit('ui.notify', { text: `已存档 · ${label(reason)}`, kind: 'info' })
        } catch (e) {
          this.failures++
          bus.emit('log', { level: 'warn', msg: `save.fail ${(e as Error).message}` })
          bus.emit('ui.notify', { text: '存档失败：本机存储不可用', kind: 'info' })
        }
      }
    } finally {
      this.running = false
    }
  }

  /** 等排队写完（切场景/测试/页面卸载前用） */
  async flush(): Promise<void> {
    while (this.running || this.queued.length) await new Promise((r) => setTimeout(r, 0))
  }
}

const LABELS: Record<string, string> = {
  rest: '调音桩', boss: 'Boss 转阶段', region: '进入新区域', manual: '手动', quit: '退出'
}

function label(reason: string): string {
  return reason.split('+').map((r) => LABELS[r] ?? r).join(' · ')
}
