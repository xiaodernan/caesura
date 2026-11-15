import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 滚轮 → 视角纵向（KI-593）：
 *   ① Input 持有 wheelLook 累加器并落到 frame.look.dy；② 与 mouseLook 同一消费点归零；
 *   ③ 仅游玩态（uiOwner===null）计入，地图/菜单/演出不抢；④ 系数为小幅度（≈ 每格 ~0.12 rad）。
 */

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FILE = resolve(ROOT, 'src/core/Input.ts')
const SRC = existsSync(FILE) ? readFileSync(FILE, 'utf8') : ''

describe('KI-593 滚轮 → 视角纵向（src/core/Input.ts）', () => {
  it('Input.ts 存在', () => {
    expect(SRC.length, 'src/core/Input.ts 不可读').toBeGreaterThan(1000)
  })

  it('持有 wheelLook 累加器并以 uiOwner 门控（游玩态才计入）', () => {
    expect(SRC).toContain('private wheelLook = 0')
    expect(SRC).toContain("window.addEventListener('wheel'")
    expect(SRC).toContain('if (this.uiOwner !== null) return')
  })

  it('wheelLook 并入 frame.look.dy（与 mouseLook 同一消费点）且系数为小幅度', () => {
    expect(SRC).toContain('this.wheelLook * 0.0012')
  })

  it('frame 消费后 wheelLook 归零（与 mouseLook 同一处清零）', () => {
    expect(SRC).toContain('this.wheelLook = 0')
  })
})
