/**
 * KI-349：一条广播频道要**两端**才算通——登记了 56 条，34 条两端都有，9 条只有接收方。
 *
 * **病是什么**：`GameEvents` 是总线的登记册，`bus.on('x')` 是接收方，`bus.emit('x')` 是发射方。
 * 一条频道只有其中一端时，代码读起来像"接好了"，实际是一次永远不会发生的反应：
 *  - `time.hitStop`：`vfx/VfxLayer` 订着它，按边沿把着色器时间降到 **0.14x**（打击凝滞）；
 *    而全仓**没有一处 emit** —— `GameTime.hitStop()` 只改自己的两个字段。这条设计好的凝滞从没发生过。
 *  - `vfx.burst`：`vfx/GPUParticles` 订着它；世界事件那三条线（倒地/命中/重踏）却直调
 *    `getGPUParticles().burst()` 绕开了总线 —— 于是这条频道**一个发射方都没有**（KI-340 已经量过）。
 *  - 另外七条（`squad.callAlly`/`squad.addThreat`/`vfx.decal.batch`/`vfx.decal.clear`/
 *    `vfx.stream`/`vfx.remove`/`vfx.trail.hide`）在生产代码里**没有发射方**，只有测试在发。
 *
 * **走一遍 `time.hitStop` 的发射方顺手量到的第二件事**：`hitStop(0)` 会把 `scale` 写成 0.05，
 * 却留下 `hitStopRemaining = 0` —— `step()` 的归零分支永远进不去，时钟锁在 **5%** 直到下一次真停顿。
 * 这不是设想：`CombatManager.tickEchoes`（回声重演）与 `parryReflect`（音叉回授）都以
 * `hitStopMs: 0` 走到 `strikeEnemy` 的 `this.time.hitStop(stopMs / 1000)`。
 *
 * **本批落的形状**：
 *  ① `GameTime` 把停顿当状态频道报**边**（进入一次 true、归零一次 false、叠加只是延长），
 *    非正数（含 NaN）不进时钟也不说话——零长度的停顿不是一次停顿；
 *  ② `VfxEmitters` 那三处改走 `bus.emit('vfx.burst')`，世界事件 → 粒子只剩一个口；
 *  ③ 剩下七条进**名册**：每条的判据是机器读的（src/ 里 0 个发射方，tests/ 里有发射方），
 *    不是散文。谁把它们接上或删掉，这条门都要求名册跟着改——两个方向都红。
 *
 * **口径**：
 *  - 扫描用 TypeScript AST，不用正则：`src/vfx/RainSystem.ts` 的注释里就写着
 *    `bus.on('weather.changed', …)`（KI-126 删掉的那条），正则会把散文读成订阅（腿八钉着这件事）。
 *  - 只数**声明过的**频道；`emit` 只认第一个参数是字符串字面量的调用。
 *  - 名册只收"生产方为 0、测试里有发射"的频道；这条判据是腿三逐条重算的。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Scene } from 'three'
import { bus } from '@/core/EventBus'
import { GameTime } from '@/core/Time'
import { registerGameData } from '@/data'
import { getGPUParticles, initGPUParticles, registerGPUParticlesBus } from '@/vfx/GPUParticles'
import { registerVfxWorldEmitters } from '@/vfx/VfxEmitters'

const root = fileURLToPath(new URL('../..', import.meta.url))
const read = (p: string): string => readFileSync(join(root, p), 'utf8')

interface Scan {
  declared: Set<string>
  emits: Map<string, string[]>
  ons: Map<string, string[]>
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue
      walk(p, out)
    } else if (/\.(ts|mts)$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

function scan(dir: string): Scan {
  const declared = new Set<string>()
  const emits = new Map<string, string[]>()
  const ons = new Map<string, string[]>()
  const push = (m: Map<string, string[]>, k: string, f: string): void => {
    const list = m.get(k)
    if (list) list.push(f)
    else m.set(k, [f])
  }
  for (const file of walk(dir)) {
    const sf = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const name = n.expression.name.text
        const arg = n.arguments[0]
        if ((name === 'emit' || name === 'on') && arg && ts.isStringLiteralLike(arg)) {
          push(name === 'emit' ? emits : ons, arg.text, file)
        }
      }
      if (ts.isInterfaceDeclaration(n) && n.name.text === 'GameEvents') {
        for (const m of n.members) {
          const nm = m.name
          if (nm && (ts.isStringLiteral(nm) || ts.isIdentifier(nm))) declared.add(nm.text)
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  return { declared, emits, ons }
}

const SRC = scan('src')
const TESTS = scan('tests')
const hasOn = (c: string): boolean => (SRC.ons.get(c)?.length ?? 0) > 0
const hasEmit = (c: string): boolean => (SRC.emits.get(c)?.length ?? 0) > 0

/**
 * 名册：只有接收方、生产方为 0 的频道。**每条都要有"谁在发"的机器判据**——
 * 腿三会去 `tests/` 里数发射方；数不到，这条就在名册里待不下去。
 *
 * 关闭条件（任选其一）：接上生产方（像本批的 `time.hitStop` / `vfx.burst`），
 * 或把频道、订阅、测试一起删掉（像 KI-126 对 `weather.changed` 做的那样）。
 */
const ROSTER: Record<string, string> = {
  'squad.callAlly': 'Enemy 直接调 Squad 的方法；只有 tests/unit/squad-bus.test.ts 在发',
  'squad.addThreat': '同上：只有 tests/unit/squad-bus.test.ts 在发',
  'vfx.decal.batch': '贴花池的批量接口没有生产调用方；只有 tests/unit/vfx-branches.test.ts 在发',
  'vfx.decal.clear': '同上：只有 tests/unit/vfx-branches.test.ts 在发',
  'vfx.stream': '持续流接口没有生产调用方；只有 tests/unit/vfx-branches.test.ts 在发',
  'vfx.remove': '同上：只有 tests/unit/vfx-branches.test.ts 在发',
  'vfx.trail.hide': '拖尾的收尾接口没有生产调用方；只有 tests/unit/vfx-branches.test.ts 在发',
}

const stubScene = (): Scene => ({ add: () => {}, remove: () => {} }) as unknown as Scene
const activeParticles = (): number => {
  const sys = getGPUParticles() as unknown as { emitters: Map<string, { particles: { active: boolean }[] }> } | null
  if (!sys) return -1
  let n = 0
  for (const e of sys.emitters.values()) for (const p of e.particles) if (p.active) n++
  return n
}

describe('KI-349 一条广播频道要两端才算通', () => {
  beforeEach(() => {
    registerGameData()
    registerGPUParticlesBus()
    registerVfxWorldEmitters()
    initGPUParticles(stubScene())
  })

  it('普查读到的分母不是手抄的：登记的频道过半两端都有', () => {
    expect(SRC.declared.size, '登记的频道数（GameEvents 的成员）').toBeGreaterThanOrEqual(50)
    const both = [...SRC.declared].filter((c) => hasOn(c) && hasEmit(c)).sort()
    expect(both.length, `两端都有的频道：${both.join(', ')}`).toBeGreaterThanOrEqual(30)
  })

  it('只有接收方的频道恰好是名册里那七条——新长出一条就必须先做决定', () => {
    const listenOnly = [...SRC.declared].filter((c) => hasOn(c) && !hasEmit(c)).sort()
    expect(
      listenOnly,
      '这些频道有人听、没人说。三条路：接上发射方（本批的 time.hitStop / vfx.burst）、' +
        '把频道与订阅一起删掉（KI-126 的 weather.changed）、或进 ROSTER 并写明谁在发',
    ).toEqual(Object.keys(ROSTER).sort())
  })

  it('名册每一条都真的"只有测试在发"：src/ 里 0 个发射方，tests/ 里数得到', () => {
    for (const key of Object.keys(ROSTER)) {
      expect(SRC.emits.get(key) ?? [], `${key} 在 src/ 里的发射方`).toEqual([])
      expect((TESTS.emits.get(key) ?? []).length, `${key} 在 tests/ 里的发射方`).toBeGreaterThan(0)
    }
    expect(Object.keys(ROSTER), '名册条数').toHaveLength(7)
  })

  it('time.hitStop 只在边上说话：进入一次 true、归零一次 false、叠加只是延长', () => {
    const seen: boolean[] = []
    const off = bus.on('time.hitStop', (e) => seen.push(e.active))
    try {
      const t = new GameTime()
      t.hitStop(0.2)
      expect(seen, '进入停顿').toEqual([true])
      t.hitStop(0.05)
      expect(seen, '叠在还没走完的那一次上 = 延长，不是第二次进入').toEqual([true])
      t.step(0.25)
      expect(seen, '归零那一下').toEqual([true, false])
      expect(t.rawScale, '归零之后回到满速').toBe(1)
      t.step(0.1)
      expect(seen, '归零之后不再说').toEqual([true, false])
      t.reset()
      expect(seen, '没在停顿里 reset 不说话').toEqual([true, false])
    } finally {
      off()
    }
  })

  it('零长度的停顿不动时钟，也不说话（回声重演与音叉回授都走到这里）', () => {
    const seen: boolean[] = []
    const off = bus.on('time.hitStop', (e) => seen.push(e.active))
    try {
      const t = new GameTime()
      for (const bad of [0, -5, Number.NaN]) t.hitStop(bad)
      expect(t.rawScale, '零/负/NaN 的停顿不得改时标').toBe(1)
      for (let i = 0; i < 120; i++) t.step(1 / 60)
      expect(t.rawScale, '两秒之后仍在满速').toBe(1)
      expect(t.dt, '逻辑步长是满速的一拍').toBeCloseTo(1 / 60, 12)
      expect(seen, '没发生的事不该有广播').toEqual([])
    } finally {
      off()
    }
  })

  it('世界事件 → 粒子只剩一个口：VfxEmitters 不再直调 getGPUParticles', () => {
    const file = 'src/vfx/VfxEmitters.ts'
    const sf = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const imports: string[] = []
    const calls: string[] = []
    const visit = (n: ts.Node): void => {
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) imports.push(n.moduleSpecifier.text)
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) calls.push(n.expression.text)
      ts.forEachChild(n, visit)
    }
    visit(sf)
    expect(imports, 'VfxEmitters 不再 import 粒子系统（注释里提到这个名字不算）').not.toContain('./GPUParticles')
    expect(calls, '也不再直调 getGPUParticles()').not.toContain('getGPUParticles')
    const sends = (SRC.emits.get('vfx.burst') ?? []).filter((f) => f === file)
    expect(sends.length, '三条世界事件各发一次 vfx.burst（倒地/命中/重踏）').toBe(3)
  })

  it('世界事件经总线真的让粒子动起来（不是只有接线图）', () => {
    const before = activeParticles()
    bus.emit('combat.hit', {
      attackerId: 'p1', victimId: 'en_1', damage: 10, poiseDamage: 5,
      kind: 'light', point: { x: 1, y: 1, z: 1 }, dir: { x: 0, y: 0, z: 1 },
      result: 'hit', hitStopMs: 0, shakeKey: '', backstab: false, weakpoint: false,
    })
    expect(activeParticles(), '命中点要炸出粒子').toBeGreaterThan(before)
  })

  it('注释里的频道名不算接收方：RainSystem 那句 bus.on(\'weather.changed\') 是散文', () => {
    const text = read('src/vfx/RainSystem.ts')
    expect(text, '那句确实还在文件里（注释中）').toContain("bus.on('weather.changed'")
    expect(SRC.ons.has('weather.changed'), '注释不该被读成订阅').toBe(false)
    expect(SRC.declared.has('weather.changed'), 'KI-126 已把这条频道删掉').toBe(false)
  })
})
