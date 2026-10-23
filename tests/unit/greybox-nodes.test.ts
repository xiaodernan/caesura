/**
 * 交互物占位模（Phase 3-C3，修 KI-013）：26 条 interactables 必须在灰盒里看得见，
 * 且可见性跟着流送走、焦点/消耗态变色、往返不泄漏、drawcall 只按 kind 数增长。
 * headless：只断言实例矩阵/颜色，不建 WebGL 上下文。
 *
 * 注意：`world.chunk` 是全局总线，任何 StreamingSystem 的事件都会打到所有表现层实例，
 * 所以每条用例都自带一套 scene/stream/greybox 夹具，不共享、不互相污染。
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { bus } from '@/core/EventBus'
import { registerGameData, regions } from '@/data'
import { StreamingSystem, chunkKeyOf } from '@/world/Streaming'
import { InteractableGreybox } from '@/world/InteractableGreybox'

registerGameData()

type Pos = { x: number; y: number; z: number }
const ALL_FLAGS = [...new Set(regions.map((r) => r.unlockFlag).filter((f): f is string => !!f))]
const allItems = regions.flatMap((r) => r.interactables)
const kinds = [...new Set(allItems.map((i) => i.kind))]
const HOME: Pos = { x: 0, y: 0, z: 0 }
const LIFT_POS: Pos = { x: 110, y: 64, z: -350 }  // 钟坠院管风琴吊机（最高一层）
const WALL_POS: Pos = { x: 330, y: 0, z: 120 }    // 雾语林音壁（setsFlag = choir_entrance_open）

function fixture(
  unlockAll = false,
  flags: Set<string> = new Set(),
  /** 值域谓词（组合根注入的 `requiresState` 读方）；缺省锁死 ⇒ 不成立的变体一个都不画 */
  stateOk: (req: { key: string; value: string }) => boolean = () => false,
) {
  const scene = new THREE.Scene()
  const stream = new StreamingSystem(regions)
  if (unlockAll) for (const f of ALL_FLAGS) stream.setFlag(f)
  const greybox = new InteractableGreybox(scene, regions, (pos) => {
    const c = stream.cellOf(pos); return chunkKeyOf(c.cx, c.cy, c.cz)
  }, (k) => flags.has(k), stateOk)
  let tick = 0
  let at: Pos = { x: 0, y: 0, z: 0 }
  const goTo = (pos: Pos): void => {
    at = pos
    stream.teleport(++tick, pos)
    const from = tick
    while (tick - from < 4000) {
      tick++
      stream.update(tick, pos)
      if (stream.stats().queued === 0 && stream.inFlight === 0) break
    }
  }
  /** 原地待 n tick：让 120 tick 卸载防抖走完 */
  const wait = (n: number): void => { for (let k = 0; k < n; k++) { tick++; stream.update(tick, at) } }
  return { scene, stream, greybox, goTo, wait, dispose: () => { greybox.dispose(); stream.dispose() } }
}

/** 未被压扁（scale>0）的实例：矩阵平移分量 + 实例色 */
function visible(mesh: THREE.InstancedMesh): { x: number; y: number; z: number; rgb: [number, number, number] }[] {
  const m = mesh.instanceMatrix.array as ArrayLike<number>
  const col = mesh.instanceColor?.array as ArrayLike<number>
  const out: { x: number; y: number; z: number; rgb: [number, number, number] }[] = []
  for (let i = 0; i < mesh.count; i++) {
    const o = i * 16
    if (Math.abs(m[o]) < 1e-6) continue
    out.push({ x: m[o + 12], y: m[o + 13], z: m[o + 14], rgb: [col[o], col[o + 1], col[o + 2]] })
  }
  return out
}

const sum = (c: [number, number, number]): number => c[0] + c[1] + c[2]

/** 某条目当前可见实例（按 xz 精确匹配） */
function slotOf(scene: THREE.Scene, id: string) {
  const it = allItems.find((i) => i.id === id)!
  const mesh = scene.getObjectByName(`greybox_node:${it.kind}`) as THREE.InstancedMesh
  return visible(mesh).find((p) => Math.abs(p.x - it.pos.x) < 0.5 && Math.abs(p.z - it.pos.z) < 0.5)
}

let active: (() => void) | null = null
afterEach(() => { active?.(); active = null })

describe('InteractableGreybox（交互物在灰盒里可见）', () => {
  it('只建数据里出现过的 kind 池，容量 = 该 kind 条目数，与 chunk 数无关', () => {
    const f = fixture()
    active = f.dispose
    expect(f.scene.children.length).toBe(kinds.length)
    expect(f.greybox.poolCount).toBe(kinds.length)
    for (const k of kinds) {
      expect((f.scene.getObjectByName(`greybox_node:${k}`) as THREE.InstancedMesh).count, k)
        .toBe(allItems.filter((i) => i.kind === k).length)
    }
    f.goTo(HOME); f.goTo(WALL_POS); f.goTo(HOME)
    expect(f.scene.children.length, '走过三个片区后 drawcall 对象数不变').toBe(kinds.length)
  })

  it('跟着流送走：未解锁区域不放模，解锁并走到高层才出现该格交互物', () => {
    const f = fixture()
    active = f.dispose
    f.goTo(HOME)
    expect(f.greybox.liveProps).toBeGreaterThan(0) // 休垒无 unlockFlag，起始格就摆得出
    expect(slotOf(f.scene, 'el_fellcarillon_organlift'), '未解锁时钟坠院无模').toBeUndefined()
    f.dispose(); active = null
    const g = fixture(true)
    active = g.dispose
    g.goTo(LIFT_POS)
    const lift = slotOf(g.scene, 'el_fellcarillon_organlift')
    expect(lift, '管风琴吊机占位模').toBeDefined()
    expect(lift!.y).toBeGreaterThan(64) // 站在数据给的层上，不陷进地里
  })

  it('焦点变色：ui.prompt(id) 点亮该实例，清空后回到原色', () => {
    const f = fixture()
    active = f.dispose
    f.goTo(HOME)
    const base = slotOf(f.scene, 'gt_resthold_gate')
    expect(base).toBeDefined()
    bus.emit('ui.prompt', { text: '开门 · 休垒', id: 'gt_resthold_gate' })
    expect(sum(slotOf(f.scene, 'gt_resthold_gate')!.rgb)).toBeGreaterThan(sum(base!.rgb))
    bus.emit('ui.prompt', { text: null, id: null })
    expect(slotOf(f.scene, 'gt_resthold_gate')!.rgb).toEqual(base!.rgb)
  })

  it('消耗态由 flag 谓词决定：事件驱动压暗，读档后首帧落位即压暗', () => {
    const flags = new Set<string>()
    const f = fixture(true, flags)
    active = f.dispose
    f.goTo(WALL_POS)
    const bright = slotOf(f.scene, 'sw_whisperwode_soundwall')
    expect(bright, '音壁在激活格里').toBeDefined()
    bus.emit('world.flag', { key: 'flag.bell_toll_rung', value: true })
    expect(sum(slotOf(f.scene, 'sw_whisperwode_soundwall')!.rgb), '无关 flag 不变色').toBe(sum(bright!.rgb))
    flags.add('flag.choir_entrance_open')
    bus.emit('world.flag', { key: 'flag.choir_entrance_open', value: true })
    expect(sum(slotOf(f.scene, 'sw_whisperwode_soundwall')!.rgb), '消耗后压暗').toBeLessThan(sum(bright!.rgb))
    f.dispose(); active = null
    // 新实例（= 读档）：谓词里已有 flag，第一次落位就是消耗态。
    // **比较必须同种**（KI-157）：调音桩的旗标语义与其它 kind **相反**（共鸣过=亮着=可复活），
    // 拿"闸门（旗立着⇒暗）"跟"调音桩（没共鸣⇒也暗）"比，两边一样暗 ⇒ 什么也没证明。
    const g = fixture(true, new Set(['flag.left_resthold']))
    active = g.dispose
    g.goTo(HOME)
    const spentGate = sum(slotOf(g.scene, 'gt_resthold_gate')!.rgb)
    g.dispose(); active = null
    const h = fixture(true, new Set())
    active = h.dispose
    h.goTo(HOME)
    const freshGate = sum(slotOf(h.scene, 'gt_resthold_gate')!.rgb)
    expect(spentGate, '读档后首帧落位即压暗（同一件东西比：旗立着 vs 旗没立）').toBeLessThan(freshGate)
  })

  it('值域组换：world.state 事件重过一遍 requiresState —— 该出现的补上、该退场的摘掉', () => {
    // 休垒广场同一处陈设有四个变体（state.bells.fourth_dumb 的四格），**同一点上只许站着一个**。
    // 变体共用坐标 ⇒ slotOf（按位置找）分不出是谁，所以这里数"那一点上有几个实例"：
    // 换组时退场的没摘掉就会短暂/永久叠成 2 个，正好是这条判据要钉的那件事。
    // 组换往往就发生在玩家脚下那一格（敲完钟回头陈设就换了），所以不等下一次跨格事件。
    const atPoint = (scene: THREE.Scene, id: string): number => {
      const it = allItems.find((i) => i.id === id)!
      const mesh = scene.getObjectByName(`greybox_node:${it.kind}`) as THREE.InstancedMesh
      return visible(mesh).filter((p) => Math.abs(p.x - it.pos.x) < 0.5 && Math.abs(p.z - it.pos.z) < 0.5).length
    }
    let want = 'INTACT'
    const f = fixture(true, new Set(), (req) => req.value === want)
    active = f.dispose
    f.goTo(HOME)
    expect(atPoint(f.scene, 'st_plaza_bell'), '值域对得上 ⇒ 那一点上站着它').toBe(1)
    expect(atPoint(f.scene, 'st_plaza_mourners'), '值域不成立 ⇒ 不在场').toBe(0)
    expect(atPoint(f.scene, 'st_plaza_copper')).toBe(0)
    const n0 = f.greybox.liveProps
    want = 'RUNG'
    bus.emit('world.state', { key: 'state.bells.fourth_dumb', value: 'RUNG' })
    expect(atPoint(f.scene, 'st_plaza_bell_rung'), '换上来的补上：点上还是恰好一个（不是叠上去）').toBe(1)
    expect(atPoint(f.scene, 'st_plaza_mourners'), '同格另一处 RUNG 变体也出现').toBe(1)
    expect(atPoint(f.scene, 'st_plaza_copper'), 'MELTED 变体依旧不在场').toBe(0)
    expect(f.greybox.liveProps, '退一进二（rung 取代 bell + mourners 出现）').toBe(n0 + 1)
    want = 'MELTED'
    bus.emit('world.state', { key: 'state.bells.fourth_dumb', value: 'MELTED' })
    expect(atPoint(f.scene, 'st_plaza_bell_melted'), '点上还是恰好一个').toBe(1)
    expect(atPoint(f.scene, 'st_plaza_mourners'), 'RUNG 的两处都退场').toBe(0)
    expect(atPoint(f.scene, 'st_plaza_copper'), '铜的那处变体出现').toBe(1)
    expect(f.greybox.liveProps, '退二进二，水位回到 n0+1').toBe(n0 + 1)
  })

  it('走远卸载归还实例；反复横跳每次都落回同一稳态水位（无槽位泄漏）', () => {
    const f = fixture(true)
    active = f.dispose
    f.goTo(HOME); f.wait(400)
    const first = f.greybox.liveProps
    expect(first).toBeGreaterThan(0)
    for (const far of [{ x: 160, y: 0, z: -100 }, { x: 250, y: -40, z: 20 }, LIFT_POS] as Pos[]) {
      f.goTo(far)
      expect(f.greybox.liveProps, `at ${far.x},${far.y},${far.z}`).toBeGreaterThan(0)
      f.goTo(HOME)
      // 刚回家时远端格还在 120 tick 卸载防抖里 ⇒ 只增不减
      expect(f.greybox.liveProps, 'back home').toBeGreaterThanOrEqual(first)
      f.wait(400)
      expect(f.greybox.liveProps, 'settled home').toBe(first)
    }
    expect(f.greybox.peak).toBeGreaterThanOrEqual(first)
    for (const kind of kinds) {
      const mesh = f.scene.getObjectByName(`greybox_node:${kind}`) as THREE.InstancedMesh
      expect(visible(mesh).length, kind).toBeLessThanOrEqual(mesh.count)
    }
  })

  it('dispose：对象全部离场，之后事件不再改变状态', () => {
    const f = fixture(true)
    f.stream.teleport(0, HOME)
    f.greybox.syncActive(f.stream.byState('active').map((c) => c.key))
    expect(f.greybox.liveProps).toBeGreaterThan(0)
    expect(f.scene.children.length).toBe(kinds.length)
    f.greybox.dispose()
    expect(f.scene.children.length).toBe(0)
    const before = f.greybox.liveProps
    f.stream.teleport(50, { x: 40, y: 0, z: -40 })
    expect(f.greybox.liveProps).toBe(before)
    f.stream.dispose()
  })
})

describe('不在场旗（KI 盐歌收摊）：旗立 ⇒ 摘格（事件态与读档态同一判）', () => {
  const atMeg = { x: -30, y: 0, z: -28 }

  function sceneHasMegBox(scene: THREE.Scene): boolean {
    // npc_meg 的摊位画在 (-30, LIFT, -28)；找任意一个落在该 xz 的实例
    for (const o of scene.children) {
      if (!(o instanceof THREE.InstancedMesh)) continue
      const m = o.instanceMatrix.array as ArrayLike<number>
      for (let i = 0; i < o.count; i++) {
        const x = m[i * 16 + 12], z = m[i * 16 + 14]
        if (Math.abs(x - atMeg.x) < 0.6 && Math.abs(z - atMeg.z) < 0.6) return true
      }
    }
    return false
  }

  it('读档态：旗先在世界里（不 emit），初次的 show 走 hasFlag 读数门 ⇒ 不画她的摊位', () => {
    const flags = new Set<string>(['flag.meg_gone']) // 读档路径：没有事件可听，只有读数
    const w = fixture(true, flags)
    w.goTo(atMeg) // 首次入场 ⇒ show() 走缺席门
    expect(sceneHasMegBox(w.scene), '她已收摊的世界：初画就没有那个摊位').toBe(false)
    w.dispose()
  })

  it('事件态：活着的世界里立旗 ⇒ 已画的摊位当场摘掉', () => {
    const flags = new Set<string>()
    const w = fixture(true, flags)
    w.goTo(atMeg)
    expect(sceneHasMegBox(w.scene), '她在的市集：摊位画着').toBe(true)
    flags.add('flag.meg_gone')
    bus.emit('world.flag', { key: 'flag.meg_gone', value: true })
    expect(sceneHasMegBox(w.scene), '旗立那一拍：摊位当场消失').toBe(false)
    w.dispose()
  })

  it('她还在的世界（旗没立）摊位照常画着', () => {
    const w = fixture(true)
    w.goTo(atMeg)
    expect(sceneHasMegBox(w.scene)).toBe(true)
    w.dispose()
  })
})
