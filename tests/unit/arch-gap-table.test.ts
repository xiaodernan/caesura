/**
 * KI-340：技术架构 §2 那张 **B 表（「表里的路径不存在，职责也没落——这些是真缺口」）** 第一次逐行有探针。
 *
 * **病是什么**：KI-147 结的案是「这张表过期三处」，可它结完又过期了一次——本批逐行量出来的第一件事，
 * B 表第 8 行（`vfx/GPUParticles.ts` / `Trails.ts` / `Decals.ts`）**三句话有两句半不再成立**：
 *  ① 「三个频道都没有发射方」——`vfx.decal.spawn` 由 `combat/CombatManager` 的弹着点发、`vfx.trail.weapon`
 *    由 `player/ThirdPersonController` 的刃口发、`vfx.trail.projectile` 由弹道发，世界事件那条总线由
 *    `vfx/VfxEmitters.ts`（KI-136）唯一接线；连同 `vfx.request`（环/火花/尖刺那条总口）一共**四个**频道有发射方
 *    ⇒ 当时只有 `vfx.burst` 一个频道还是"有人听、没人说"（KI-349 已接上，本文件那条腿随之改为"五个"）；
 *  ② 「配置表全仓没有写方」——`data/index.ts` 按 `vfx:decals`/`vfx:trails`/`vfx:emitters` 三键注册
 *    `vfx.json` 的九行，三个系统各自 `maybeGet` 读（`tests/unit/vfx-table.test.ts` 钉着九个读者）；
 *  ③ 「都没有真几何」——两侧都是 index+uv+color 的池化 `BufferGeometry`（贴花是四边形池、拖尾是每点两顶点的
 *    条带）；差的是「投射四边形」与「tube」这两个**形状本身**，不是"没有几何"。
 * 这张表烂掉的方式与 KI-147 当时一模一样：**每句话在写下那天是真的，之后每一批顺手把缺口填掉，没人回来改它**。
 * ⇒ 本批给它装一台逐行读者：**每行一条树侧探针**（文件在不在、标识符在不在、目录在不在），
 * 谁把那一行填了，腿会红着请他来改表。
 *
 * **口径**：
 *  - **表的形状钉死**：11 行、三列、顺序与登记表逐字对应（加一行/删一行/换顺序都要来登记）。
 *  - **状态格只判"登记的那个标签还在不在"**（§78 的五个词 ＋ 这张表自己的「已落／未落」写法），
 *    散文内容由探针判——不拿子串判据去猜一句话的真假。
 *  - **探针只读今天的树**：哪些是「已落」的证据（文件/标识符在），哪些是「仍未落」的证据（目录/文件不在）。
 *    两者都会红——把 `world/generators/` 建出来，第 5 行会红；把 `audio/Mixer.ts` 删掉，第 9 行也会红。
 *  - **不点号的只有豁免名册里那一行**（`world/generators/`：程序化生成是备选路径，没开不是欠账）；
 *    豁免了却点号、没豁免又没点号，两个方向都红。
 *
 * **还欠**（§78）：① 探针只覆盖「树侧形状」，不判散文里的程度副词（「部分」「仍缺」）；② C 表（真树里有、
 * 规划没写）还没有读者；③ 「规划四句」那一行（第 4 行）的三个数（8m/35m/遮挡）本批只钉「代码里没有」，
 * 不钉设计要不要。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { registerGameData, regions } from '@/data'

registerGameData()

const root = fileURLToPath(new URL('../..', import.meta.url))
const rel = (p: string) => join(root, p)
const read = (p: string) => readFileSync(rel(p), 'utf8')
const ARCH = read('docs/technical-architecture.md')
const LEDGER = read('docs/KNOWN_ISSUES.md')

const cells = (l: string): string[] => l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim())

/** B 表：从「**B. 表里的路径不存在…**」那一行往下，第一段以 `|` 开头的连续行就是它 */
function bTable(src: string): { head: string[]; rows: Array<{ n: number; cells: string[] }> } {
  const lines = src.split(/\r?\n/)
  const at = lines.findIndex((l) => l.startsWith('**B. 表里的路径不存在'))
  if (at < 0) throw new Error('架构里找不到 B 表的小标题')
  const block: Array<{ n: number; l: string }> = []
  for (let i = at + 1; i < lines.length; i++) {
    if (lines[i]!.startsWith('|')) block.push({ n: i + 1, l: lines[i]! })
    else if (block.length) break
  }
  if (block.length < 3) throw new Error('B 表下面没有一张完整的表')
  return { head: cells(block[0]!.l), rows: block.slice(2).map((b) => ({ n: b.n, cells: cells(b.l) })) }
}

const B = bTable(ARCH)

/**
 * 11 行的登记表：`mark` 是那一行第一格里一定能读到的字（顺序即表序），`label` 是状态格里登记的那个词，
 * `probe` 是「今天这棵树上，这一行的说法成立吗」的树侧读数。**加一行/改一行先来这里登记。**
 */
const ROWS: Array<{ mark: string; label: string; probe: () => void }> = [
  {
    mark: 'ai/Navigation.ts',
    label: 'Partial',
    probe: () => {
      expect(existsSync(rel('src/ai/Navigation.ts')), 'Navigation.ts').toBe(true)
      expect(read('src/ai/Navigation.ts'), 'syncAuthored 的方法定义').toMatch(/^\s*syncAuthored\(/m)
      expect(readdirSync(rel('src/data/json/navmesh')).filter((f) => f.endsWith('.navmesh.json'))).toHaveLength(7)
      expect(regions.filter((r) => !r.navmeshRef), '每一区都该有 navmeshRef').toEqual([])
    },
  },
  {
    mark: 'ai/Squad.ts',
    label: '已落',
    probe: () => {
      const s = read('src/ai/Squad.ts')
      // 三个符号都按「定义形状」判：注释里提一句不算承载体（A1 那臂教出来的）
      expect(s, 'maxAttackSlots 的默认值').toMatch(/maxAttackSlots:\s*\d/)
      expect(s, 'addThreat 的方法定义').toMatch(/addThreat\(/)
      expect(s, 'callAlly 的方法定义').toMatch(/callAlly\(payload/)
      expect(existsSync(rel('tests/unit/squad.test.ts'))).toBe(true)
    },
  },
  {
    mark: 'player/CameraRig.ts',
    label: '已落',
    probe: () => {
      const s = read('src/player/CameraRig.ts')
      for (const sym of ['CameraMode', 'MODE_CONFIG', 'firstBlock']) expect(s, `CameraRig.${sym}`).toContain(sym)
    },
  },
  {
    mark: 'player/LockOn.ts',
    label: '未落',
    probe: () => {
      const s = read('src/player/LockOn.ts')
      expect(s).toContain('liveCandidates')
      expect(s, '墙不会解开锁定（LockOn 不读遮挡）').not.toMatch(/Occlusion/)
      expect(s, '没有内圈／角度上限这两个数').not.toMatch(/minRange|innerRange|maxAngle|coneDeg/i)
    },
  },
  {
    mark: 'world/generators/',
    label: '未落',
    probe: () => {
      expect(existsSync(rel('src/world/generators')), '程序化生成那条没开').toBe(false)
    },
  },
  {
    mark: 'world/Weather.ts',
    label: '未落',
    probe: () => {
      expect(existsSync(rel('src/world/Weather.ts')), '天气不叫这个名字').toBe(false)
      expect(existsSync(rel('src/vfx/ColorGrade.ts')), '天气落在 ColorGrade').toBe(true)
      expect(existsSync(rel('src/world/Lighting.ts')), '光照预设已落（§5.9.42）').toBe(true)
      expect(JSON.parse(read('src/data/json/lighting.json')) as unknown[]).toHaveLength(7)
    },
  },
  {
    mark: 'ui/MapUI.ts',
    label: '已落',
    probe: () => {
      expect(existsSync(rel('src/ui/MapUI.ts'))).toBe(true)
      expect(existsSync(rel('src/ui/MenuStack.ts')), 'MenuStack 仍未落').toBe(false)
    },
  },
  {
    mark: 'vfx/GPUParticles.ts',
    label: '已过界',
    probe: () => {
      for (const f of ['src/vfx/GPUParticles.ts', 'src/vfx/Trails.ts', 'src/vfx/Decals.ts']) expect(existsSync(rel(f)), f).toBe(true)
      // 三张配置表都有写方（data/index.ts 的三格），三个系统各自按前缀键读
      for (const k of ['vfx:decals', 'vfx:trails', 'vfx:emitters']) {
        expect(read('src/data/index.ts'), `data/index 注册 ${k}`).toContain(`registry.register('${k}'`)
        expect(['src/vfx/Decals.ts', 'src/vfx/Trails.ts', 'src/vfx/GPUParticles.ts'].some((f) => read(f).includes(`'${k}'`)), `${k} 的读者`).toBe(true)
      }
      // 几何是池化的 BufferGeometry（不是"没有几何"）
      for (const f of ['src/vfx/Decals.ts', 'src/vfx/Trails.ts']) expect(read(f), `${f} 的池化几何`).toMatch(/new THREE\.BufferGeometry\(\)/)
    },
  },
  {
    mark: 'audio/Mixer.ts',
    label: '部分已落',
    probe: () => {
      expect(existsSync(rel('src/audio/Mixer.ts')), '独立的 Mixer 仍未落').toBe(false)
      expect(read('src/audio/music.ts')).toMatch(/crossfade/i)
      expect(read('src/core/RhythmClock.ts')).toContain('overrideTo')
    },
  },
  {
    mark: 'tools/EnemyDebugger.ts',
    label: 'Partial',
    probe: () => {
      for (const f of ['src/tools/EnemyDebugger.ts', 'src/tools/QuestDebugger.ts', 'src/tools/AIDebugger.ts', 'src/tools/DebugPanel.ts'])
        expect(existsSync(rel(f)), f).toBe(true)
      const keys = read('src/core/Input.ts')
      for (const k of ['F1', 'F3', 'F4']) expect(keys, `Input 里 ${k} 有读者`).toContain(k)
    },
  },
  {
    mark: 'core/Registry.ts',
    label: 'Partial',
    probe: () => {
      const s = read('src/core/Registry.ts')
      expect(s).toContain('load(')
      expect(s, 'preload/引用计数仍然没有').not.toMatch(/preload|refcount|releas/i)
    },
  },
]

/**
 * 没有账本锚的那几行：**有意不编一个号**（它们是有意的非目标，不是欠账）。
 * 两个方向都判——豁免了却点了号、或者没豁免又没点号，都会红。
 */
const NO_LEDGER: Record<string, string> = {
  'world/generators/': '程序化生成那条是规划里的备选路径，关键区域手工摆放才是首选；没开不是欠账',
}

/**
 * 销案的号“留号不留行”（账本 §2 那段注记）：`~~TD-002~~` 这种**划掉的号**仍然算读得到——
 * 它们被刻意保留在注记里（编号不复用），只是不在表里。
 */
const struckIds = new Set([...LEDGER.matchAll(/~~(KI|TD|PF|ENV)-(\d{3})~~/g)].map((m) => m[1] + '-' + m[2]))
const known = (id: string): boolean => ledgerIds.has(id) || struckIds.has(id)

/** 账本里真有的号（门 B 同一把尺子：表里点名的号必须读得到行） */
const ledgerIds = new Set([...LEDGER.matchAll(/^\|\s*(KI|TD|PF|ENV)-(\d{3})\s*\|/gm)].map((m) => `${m[1]}-${m[2]}`))

/** `src/` 下每个频道今天有几个发射方（`bus.emit('vfx.…')`）——第 8 行更正的那一格现推，不手抄 */
function vfxEmitters(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.ts')) {
        const src = readFileSync(p, 'utf8')
        for (const m of src.matchAll(/bus\.emit\(\s*'(vfx\.[\w.]+)'/g)) {
          const k = m[1]!
          out.set(k, [...(out.get(k) ?? []), p.slice(root.length).replace(/\\/g, '/')])
        }
      }
    }
  }
  walk(rel('src'))
  return out
}

describe('KI-340：技术架构 B 表（真缺口那张）的逐行探针', () => {
  it('表仍是 3 列 11 行，顺序与登记表逐字一致', () => {
    expect(B.head).toEqual(['规划路径', '状态标签（§78）', '归属与后果'])
    expect(B.rows).toHaveLength(ROWS.length)
    for (const [i, row] of B.rows.entries()) {
      expect(row.cells, `第 ${row.n} 行的格数`).toHaveLength(3)
      expect(row.cells[0], `第 ${i + 1} 行应是 ${ROWS[i]!.mark}`).toContain(ROWS[i]!.mark)
    }
  })

  it('每行的状态格都还带着登记的那个标签（改判要回来改登记表）', () => {
    for (const [i, row] of B.rows.entries()) expect(row.cells[1], `第 ${i + 1} 行`).toContain(ROWS[i]!.label)
  })

  it('每行要么点一个账本里读得到行的号，要么在豁免名册里写清为什么（两边都红）', () => {
    const seen: string[] = []
    for (const [i, row] of B.rows.entries()) {
      const cited = [...row.cells.slice(1).join(' ').matchAll(/\b(KI|TD|PF|ENV)-(\d{3})\b/g)].map((m) => `${m[1]}-${m[2]}`)
      for (const id of cited) expect(known(id), `第 ${row.n} 行点的 ${id} 在账本里读不到`).toBe(true)
      const mark = ROWS[i]!.mark
      if (mark in NO_LEDGER) {
        expect(cited.length, `第 ${i + 1} 行已豁免却在点号（豁免过期了）`).toBe(0)
        seen.push(mark)
      } else expect(cited.length, `第 ${i + 1} 行一个号都没点`).toBeGreaterThan(0)
    }
    expect(seen).toEqual(Object.keys(NO_LEDGER))
  })

  // 11 条树侧探针：一条一行，红的时候一眼看出是哪一行过期了
  it('第 1 行 ai/Navigation.ts：网格过界、syncAuthored 在、七区都有 navmeshRef', ROWS[0]!.probe)
  it('第 2 行 ai/Squad.ts：仇恨槽位三件在、守卫在', ROWS[1]!.probe)
  it('第 3 行 player/CameraRig.ts：五模式表在、碰撞回读 firstBlock', ROWS[2]!.probe)
  it('第 4 行 player/LockOn.ts：内圈/角度上限/遮挡解锁都还没有', ROWS[3]!.probe)
  it('第 5 行 world/generators/：这个目录仍然不存在', ROWS[4]!.probe)
  it('第 6 行 world/Weather.ts：天气在 ColorGrade、光照预设已落', ROWS[5]!.probe)
  it('第 7 行 ui/MapUI.ts：地图在、MenuStack 仍不在', ROWS[6]!.probe)
  it('第 8 行 vfx 三件：配置表有写方、几何是池化 BufferGeometry', ROWS[7]!.probe)
  it('第 9 行 audio/Mixer.ts：独立 Mixer 仍不在、crossfade 在 MusicLayer', ROWS[8]!.probe)
  it('第 10 行三块调试面板：文件与 F1/F3/F4 读者都在', ROWS[9]!.probe)
  it('第 11 行 core/Registry.ts：load 在、preload 与引用计数仍没有', ROWS[10]!.probe)

  it('第 8 行的更正：五个频道都有发射方，`vfx.burst` 不再"有人听、没人说"（KI-349 接上）', () => {
    const emitters = vfxEmitters()
    // vfx.request 是环/火花/尖刺那条总口；另外四条是贴花、两种拖尾与爆发
    expect([...emitters.keys()].sort()).toEqual(['vfx.burst', 'vfx.decal.spawn', 'vfx.request', 'vfx.trail.projectile', 'vfx.trail.weapon'])
    expect(emitters.has('vfx.burst'), 'vfx.burst 的发射方').toBe(true)
    expect(read('src/vfx/VfxEmitters.ts'), '世界事件接线仍只有一处').toContain('registerVfxWorldEmitters')
    expect(read('src/vfx/VfxEmitters.ts')).toMatch(/bus\.on\('entity\.died'/)
  })
})
