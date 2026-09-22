/**
 * 架构边界闸门（需求 §56 模块化 / tech-arch §3 依赖规则 / §6.2 headless 可测）。
 * 逻辑层不得依赖渲染层：违反即无法在 node 里跑玩法流测试，也无法迁 UE（ENV-001）。
 * 这里用静态扫描 import 而不是 eslint 插件：零新增依赖，且随 `npm run test` 一起挡在提交前。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { SFX_KEYS } from '@/audio/synth'
import { registerGameData, regions } from '@/data'
import { Interactables } from '@/world/Interactables'

const SRC = fileURLToPath(new URL('../../src', import.meta.url))

/** 必须保持「不认识 three」的逻辑模块（headless 测试直接实例化它们） */
const LOGIC = [
  'ai', 'audio', 'combat', 'core', 'data', 'input',
  'player/LockOn.ts', 'player/ThirdPersonController.ts',
  'world/Streaming.ts', 'world/Surface.ts', 'world/Interactables.ts', 'world/SpawnDirector.ts',
]
/** 表现层：只有这些文件允许 import three / 被表现层模块引用 */
const PRESENTATION = new Set([
  'main.ts', 'player/CameraRig.ts', 'tools/CombatDebugger.ts', 'ui/Hud.ts',
  'vfx/VfxLayer.ts', 'vfx/materials.ts',
  'world/ActorVisuals.ts', 'world/ChunkGreybox.ts', 'world/InteractableGreybox.ts',
  'world/ProjectileVisuals.ts', 'world/BossArenaVisuals.ts', 'world/PlaceholderArena.ts',
])

const tsFiles = (dir: string): string[] => {
  if (dir.endsWith('.ts')) return [dir] // 清单里允许直接点名单个文件
  const abs = `${SRC}/${dir}`
  let st
  try { st = readdirSync(abs, { withFileTypes: true }) } catch { return [] }
  const out: string[] = []
  for (const e of st) {
    if (e.isDirectory()) out.push(...tsFiles(`${dir}/${e.name}`))
    else if (e.name.endsWith('.ts')) out.push(`${dir}/${e.name}`)
  }
  return out
}

/** 只看运行时 import：`import type` 编译后消失，不构成层依赖 */
const IMPORT_RE = /(^|\n)[ \t]*import[ \t]+(type[ \t]+)?(?:[^'"\n]*from[ \t]+)?['"]([^'"]+)['"]/g
const importsOf = (rel: string): string[] => {
  const src = readFileSync(`${SRC}/${rel}`, 'utf8')
  return [...src.matchAll(IMPORT_RE)].filter((m) => !m[2]).map((m) => m[3])
}
const isRendererDep = (spec: string): boolean =>
  spec.startsWith('three') ||
  /^@\/(render|vfx|ui|tools)\//.test(spec) ||
  ['@/world/ChunkGreybox', '@/world/PlaceholderArena', '@/world/ActorVisuals', '@/player/CameraRig'].includes(spec)

describe('module dependency boundaries (tech-arch §3)', () => {
  it('逻辑层不 import three / 表现层模块', () => {
    const offenders: string[] = []
    for (const group of LOGIC) {
      for (const rel of tsFiles(group)) {
        for (const spec of importsOf(rel)) if (isRendererDep(spec)) offenders.push(`${rel} -> ${spec}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('逻辑层文件确实被扫描到（防止清单漂移把闸门变成空测试）', () => {
    const scanned = LOGIC.flatMap((g) => tsFiles(g))
    for (const must of ['world/Interactables.ts', 'world/Streaming.ts', 'world/Surface.ts', 'combat/CombatManager.ts', 'core/EventBus.ts']) {
      expect(scanned, must).toContain(must)
    }
    expect(scanned.length).toBeGreaterThanOrEqual(20)
  })

  it('three 只在表现层出现，且表现层清单与实际一致', () => {
    const all = tsFiles('.').map((p) => p.replace(/^\.\//, ''))
    const users = new Set<string>()
    for (const rel of all) {
      if (importsOf(rel).some((s) => s.startsWith('three'))) users.add(rel)
    }
    expect(users.size).toBeGreaterThanOrEqual(5)
    for (const u of users) expect(PRESENTATION.has(u), `${u} 用了 three 但不在表现层清单`).toBe(true)
  })

  it('渲染层靠事件解耦：表现层不 import 逻辑运行时（除数据/工具/事件）', () => {
    const banned = ['@/world/Streaming', '@/world/Interactables', '@/combat/CombatManager', '@/ai/AISystem']
    const offenders: string[] = []
    for (const rel of [...PRESENTATION]) {
      if (rel === 'main.ts') continue // 组合根：允许持有全部实例
      for (const spec of importsOf(rel)) if (banned.includes(spec)) offenders.push(`${rel} -> ${spec}`)
    }
    expect(offenders).toEqual([])
  })
})

describe('event payload references resolve (跨模块字符串引用不许悬空)', () => {
  it('交互物能发出的每个 audio.sfx key 都在合成表里（防运行时「未知 SFX key」）', () => {
    registerGameData()
    const interact = new Interactables(regions, () => true)
    const keys = new Set<string>()
    const off = bus.on('audio.sfx', (p) => { keys.add(p.key) })
    for (const it of interact.all) {
      if (it.requiresFlag) interact.setFlag(it.requiresFlag) // 全开：让每个 kind 都能触发
    }
    for (const it of interact.all) interact.use(it.id, { ...it.pos })
    off()
    interact.dispose()
    expect(keys.size).toBeGreaterThanOrEqual(4)
    const valid = new Set<string>(SFX_KEYS)
    expect([...keys].filter((k) => !valid.has(k))).toEqual([])
  })

  it('数据表里写到的每个 sfx key 都在合成表里（§55：JSON 引用的音色不能悬空）', () => {
    const valid = new Set<string>(SFX_KEYS)
    const found = new Set<string>()
    const collect = (v: unknown): void => {
      if (typeof v === 'string') found.add(v)
    }
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) { for (const x of v) walk(x); return }
      if (v === null || typeof v !== 'object') return
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (k === 'sfx' || k === 'sfxLaunch' || k === 'sfxHit') {
          if (Array.isArray(x)) for (const s of x) collect(s)
          else collect(x)
          continue
        }
        walk(x)
      }
    }
    for (const f of ['enemies.json', 'movesets.json', 'player.json', 'weapons.json']) {
      walk(JSON.parse(readFileSync(`${SRC}/data/json/${f}`, 'utf8')))
    }
    expect(found.size).toBeGreaterThanOrEqual(10)
    expect([...found].filter((k) => !valid.has(k))).toEqual([])
  })
})
