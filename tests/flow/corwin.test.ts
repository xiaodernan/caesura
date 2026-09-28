import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { registerGameData, regions, worldStates } from '@/data'
import { StreamingSystem } from '@/world/Streaming'
import { SpawnDirector } from '@/world/SpawnDirector'
import { Interactables } from '@/world/Interactables'
import { AISystem } from '@/ai/AISystem'
import { WorldStates } from '@/quest/WorldStates'
import { Inventory } from '@/rpg/Inventory'
import { Equipment } from '@/rpg/Equipment'

import type { Vec3 } from '@/combat/EntityStats'
import type { WorldStateDef } from '@/data/schema'

/**
 * 科温线收束（narrative §2.2 步 3/4 的三份后果，KI-043）：
 * - **揭露**（`state.corvin.schism = EXPOSED`）⇒ 破拍营地强攻难度上调：旗标一立，营地里
 *   多出一组增援嘈壳（`spawnGroup.condition` 是既有通道，改表即改行为）；
 * - **包庇**（COMPLICIT）⇒ 沉唱堂的捕获笼**出现在祭坛后**（D3 的陈设组换：requiresState 是
 *   "这儿现在有没有它"——没缔约的世界里那只笼子不存在，不是"存在但锁着"）；
 * - **共谋**（COLLUDED）⇒ 对话把「振源核嵌甲」这件真实装备灌进背包（giveItem 走的是
 *   既有效果词表；嵌甲可装备、词缀可路由，不是一句播报）。
 */

const alive: Array<() => void> = []
afterEach(() => { for (const off of alive.splice(0)) off() })

registerGameData()

function makeInteractWorld(state: string | null) {
  const streaming = new StreamingSystem(regions)
  const corwin = (worldStates as unknown as WorldStateDef[]).find((d) => d.key === 'state.corvin.schism')
  const ws = new WorldStates(corwin ? [corwin] : [])
  // 广播是唯一写路径（与生产 setState 同一条通道）
  if (state) bus.emit('world.state', { key: 'state.corvin.schism', value: state })
  const interact = new Interactables(regions, () => true, 6, (req) => ws.matches(req.key, req.value))
  alive.push(() => { interact.dispose(); streaming.dispose(); ws.dispose() })
  return { interact, ws, streaming }
}

describe('科温线三份后果（KI-043：学者之乱的世界要能被摸到）', () => {
  it('包庇的世界：捕获笼在沉唱堂祭坛后出现；没缔约的世界里它不存在', () => {
    const w1 = makeInteractWorld(null)
    const cage = w1.interact.all.find((i) => i.id === 'dc_corvin_cage')!
    expect(cage, '笼子的数据在').toBeTruthy()
    expect(w1.interact.stateOf(cage as never), 'INTACT（没抉择）：笼子不在场').toBe('locked')

    const w2 = makeInteractWorld('COMPLICIT')
    const cage2 = w2.interact.all.find((i) => i.id === 'dc_corvin_cage')!
    expect(w2.interact.stateOf(cage2 as never), '缔约之后：笼子可用（走到祭坛后按 E 能看壁痕）').toBe('ready')
    const r = w2.interact.use('dc_corvin_cage', { x: 372, y: -40, z: 36 } as Vec3)
    expect(r.ok, '按 E 成立').toBe(true)
    // 文案归 kind 通用表（inspect='刻痕读进了心里'）；专属文本等对话层接入，此处只钉可达性
  })

  it('揭露的世界：破拍营地多出一组增援（condition 走既有通道）', () => {
    const ai = new AISystem()
    const stream = new StreamingSystem(regions)
    const flags = new Set<string>()
    const cellKey = (p: Vec3): string => { const c = stream.cellOf(p); return `${c.cx},${c.cy},${c.cz}` }
    const dir = new SpawnDirector(regions, {
      spawn: (id, pos, sd) => ai.spawn(id, pos, sd),
      despawn: (id) => ai.despawn(id),
      hasFlag: (k) => flags.has(k)
    }, cellKey)
    alive.push(() => { dir.dispose(); stream.dispose() })
    const CAMP = { x: -140, y: 0, z: -330 }
    flags.add('flag.left_resthold')
    stream.setFlag('flag.left_resthold')
    const sync = (): void => { stream.teleport(0, CAMP); dir.syncActive(stream.byState('active').map((c) => c.key)) }
    sync()
    const base = ai.enemies.length
    expect(ai.enemies.filter((e) => e.pos.z < -250).length, '没揭露的世界：营地按原编制').toBeLessThan(4)
    // 立旗（与对话 setState 同批的 setFlags 旗标）⇒ 增援组落地
    flags.add('flag.schism_exposed')
    sync()
    const reinforce = ai.enemies.filter((e) => Math.hypot(e.pos.x - CAMP.x, e.pos.z - CAMP.z) < 14)
    expect(reinforce.length, `揭露后营地增援到场（实测 ${reinforce.length} 只）`).toBeGreaterThanOrEqual(2)
    expect(ai.enemies.length, '总数比揭露前多').toBeGreaterThan(base)
  })

  it('共谋的世界：嵌甲是件真装备——对话 giveItem 灌进背包，可装备、词缀可路由', () => {
    const inv = new Inventory('corwin')
    // Settlement.applyEffects 的 giveItem 分支就是 inv.add —— 这里从装备侧验"灌进来的能穿"
    const gear = inv.add('ar_coreinlay_cuirass')
    expect(gear, '嵌甲作为装备实例入包').toBeTruthy()
    const eq = new Equipment()
    const slot = eq.equip(inv, (inv.gears[inv.gears.length - 1] as { uid: string }).uid)
    expect(slot, '落到胸甲槽').toBe('cuirass')
    const t = eq.totals(inv)
    expect(t.defense, '嵌甲的 DEF 进汇总').toBeGreaterThan(0)
    expect(t.staminaRegenMul, '节律词缀可路由（>1）').toBeGreaterThan(1)
  })
})
