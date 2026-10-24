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
  'ai', 'audio', 'combat', 'core', 'data', 'input', 'rpg', 'save',
  'player/LockOn.ts', 'player/ThirdPersonController.ts',
  'world/Streaming.ts', 'world/Surface.ts', 'world/Interactables.ts', 'world/SpawnDirector.ts', 'world/Props.ts',
  // KI-094②：「哪一格天气生效」是玩法推导，所以它住在逻辑层而不是 `vfx/ColorGrade`（那边只按名字画）。
  'world/WeatherSwitch.ts',
  // §5.9.33③：天气的玩法三腿同样是逻辑层读数——它只回答"这一格天气的三个乘数是多少"，
  // 不碰画面也不碰音频图（那两边各是 `vfx/ColorGrade` 与 `audio/*` 的事）。
  'world/WeatherEffects.ts',
  // §6 过场播放器同样是逻辑层：它只回答"哪一条在跑 / 还剩多久 / 该不该夺输入"，
  // 镜头轨道与字幕时序在表现层（KI-008 / KI-010）。
  'world/Cinematics.ts',
  // §37 光照读数层同样是逻辑层：它只回答「这一区的雾色与 LUT 读数」，画的那一半在 vfx/ColorGrade。
  'world/Lighting.ts',
]
/** 表现层：只有这些文件允许 import three / 被表现层模块引用 */
const PRESENTATION = new Set([
  'main.ts', 'player/CameraRig.ts', 'ui/Hud.ts',
  // `tools/` 是"读数给人看"的那一层：它允许碰 DOM，但也因此和 UI 一样受最后一条闸门管——
  // 面板只许从组合根拿闭包，不许自己去 import 运行时实例（KI-058 的三块新面板就在这条里）。
  'tools/CombatDebugger.ts', 'tools/DebugPanel.ts',
  'tools/EnemyDebugger.ts', 'tools/QuestDebugger.ts', 'tools/AIDebugger.ts',
  'vfx/VfxLayer.ts', 'vfx/materials.ts', 'vfx/ColorGrade.ts',
  'vfx/RainSystem.ts', 'vfx/Trails.ts', 'vfx/Decals.ts', 'vfx/GPUParticles.ts',
  // KI-135：配置转换层（数据是纯 JSON，hex/向量/混合模式 → three 的那一步在表现层）
  'vfx/VfxConfig.ts',
  // KI-136：世界事件 → 表现层的接线归一处（它要 spawn 贴花/粒子 ⇒ 用 three 的向量）
  'vfx/VfxEmitters.ts',
  'world/ActorVisuals.ts', 'world/ChunkGreybox.ts', 'world/InteractableGreybox.ts',
  'world/WallGreybox.ts',
  'world/ProjectileVisuals.ts', 'world/BossArenaVisuals.ts', 'world/PlaceholderArena.ts', 'world/PropVisuals.ts',
  // §37 第二腿：三层光的绘制层。它 import three，但判断全在逻辑层 `world/Lighting.ts`
  'world/SceneLights.ts',
  // KI-315：hitbox 线框（§17 调试器那一格的承载体）。它 import three 建线段，
  // 但「画哪、画多大」的数全从 `@/data/schema` 的 box 与 `@/combat/HitShapes` 的那个余量来——
  // 与 `world/Lighting.ts` 同一分法：判断在逻辑层，这里只是把数变成可见的线。
  'world/HitboxWire.ts',
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
    for (const must of ['world/Interactables.ts', 'world/Streaming.ts', 'world/Surface.ts', 'world/WeatherSwitch.ts', 'world/Cinematics.ts', 'world/Lighting.ts', 'combat/CombatManager.ts', 'core/EventBus.ts', 'rpg/Runtime.ts', 'rpg/Settlement.ts', 'save/Serializer.ts']) {
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
      for (const f of it.requiresFlags ?? []) interact.setFlag(f) // 合取闸门（Phase 6-C）也要全开，否则探针漏掉那一种 kind
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
