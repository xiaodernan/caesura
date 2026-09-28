import { describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { registry } from '@/core/Registry'
import { registerGameData, regions, worldstate } from '@/data'
import type { RegionData, WorldStateRule } from '@/data/schema'
import { WorldState } from '@/quest/WorldState'
import { Interactables } from '@/world/Interactables'

/**
 * 世界状态写入层（Phase 6-A）。这里测的是**规则语义**：什么事件立什么旗、立过就不再重复，
 * 以及最要紧的一条——**旗标必须有人写才谈得上有人读**（KI-041 那批"只有读方的锁"）。
 * 真内容链（敲钟→钟腔、弹反→音壁、杀 Boss→T2 箱）在 `tests/flow/hidden-rooms.test.ts`。
 */

function lab(rules: WorldStateRule[]) {
  registerGameData()
  const flags = new Set<string>()
  const notices: string[] = []
  const offs = [
    bus.on('world.flag', (f) => { if (f.value !== false) flags.add(f.key); else flags.delete(f.key) }),
    bus.on('ui.notify', (p) => notices.push(p.text))
  ]
  const ws = new WorldState(rules, { hasFlag: (k) => flags.has(k), setFlag: (k) => bus.emit('world.flag', { key: k, value: true }) })
  const dispose = () => { ws.dispose(); for (const o of offs) o() }
  return { flags, notices, ws, dispose }
}

const R = (over: Partial<WorldStateRule> & { id: string }): WorldStateRule => ({ on: 'firstParry', setFlag: 'flag.lab', ...over })

describe('WorldState 规则语义', () => {
  it('第一次成功弹反立旗，之后每次弹反都不再重播播报', () => {
    const lab1 = lab([R({ id: 'lab_parry', setFlag: 'flag.parry_taught', notify: '第一次把拍子还回去' })])
    bus.emit('combat.parried', { attackerId: 'en_x', defenderId: 'player' })
    expect(lab1.flags.has('flag.parry_taught')).toBe(true)
    expect(lab1.notices).toHaveLength(1)
    bus.emit('combat.parried', { attackerId: 'en_x', defenderId: 'player' })
    expect(lab1.notices, '幂等：旗已经立着就不再吵一次').toHaveLength(1)
    lab1.dispose()
  })

  it('别人被弹不算玩家的功课；别的敌人死亡也不该动这条旗', () => {
    const lab1 = lab([
      R({ id: 'lab_parry', on: 'firstParry', setFlag: 'flag.parry_taught' }),
      R({ id: 'lab_ost', on: 'bossDefeated', dataId: 'en_ostlara', setFlag: 'flag.ostlara_defeated' })
    ])
    bus.emit('combat.parried', { attackerId: 'player', defenderId: 'en_ostlara' })
    expect(lab1.flags.has('flag.parry_taught'), '玩家是被打的那个，不该立"学会了"的旗').toBe(false)
    bus.emit('boss.defeated', { id: 'e1', dataId: 'en_hersil', nameKey: 'boss.hersil', holdTicks: 30 })
    expect(lab1.flags.has('flag.ostlara_defeated'), '按 dataId 匹配：换个人死不算').toBe(false)
    bus.emit('boss.defeated', { id: 'e2', dataId: 'en_ostlara', nameKey: 'boss.ostlara', holdTicks: 30 })
    expect(lab1.flags.has('flag.ostlara_defeated')).toBe(true)
    lab1.dispose()
  })

  it('交互物要真的用成功（ok=false 的失败不立旗）', () => {
    const lab1 = lab([R({ id: 'lab_bell', on: 'interactUsed', interactId: 'bl_fellcarillon_fallenbell', setFlag: 'flag.bell_interior_open' })])
    bus.emit('world.interact', { id: 'bl_fellcarillon_fallenbell', kind: 'bell', ok: false, state: 'locked' })
    expect(lab1.flags.size, "敲不动的钟不该被记成'敲过了'").toBe(0)
    bus.emit('world.interact', { id: 'ch_something', kind: 'chest', ok: true, state: 'used' })
    expect(lab1.flags.size, '别的交互物成功也不该触发这条').toBe(0)
    bus.emit('world.interact', { id: 'bl_fellcarillon_fallenbell', kind: 'bell', ok: true, state: 'used' })
    expect(lab1.flags.has('flag.bell_interior_open')).toBe(true)
    lab1.dispose()
  })

  it('dispose 之后不再监听（总线是单例，漏一次就会互相污染）', () => {
    const lab1 = lab([R({ id: 'lab_dispose', setFlag: 'flag.gone' })])
    lab1.dispose()
    bus.emit('combat.parried', { attackerId: 'en_x', defenderId: 'player' })
    expect(lab1.flags.has('flag.gone'), '拆完之后这条规则应该已经不在总线上').toBe(false)
  })

  it('反向可查：这个旗标是被哪条规则立的（Quest Debugger 的读法）', () => {
    const lab1 = lab([R({ id: 'lab_query', on: 'bossDefeated', dataId: 'en_ostlara', setFlag: 'flag.q.a' })])
    expect(lab1.ws.writerOf('flag.q.a')?.id).toBe('lab_query')
    expect(lab1.ws.writerOf('flag.nobody.writes.me')).toBeNull()
    bus.emit('boss.defeated', { id: 'e', dataId: 'en_ostlara', nameKey: 'boss.ostlara', holdTicks: 30 })
    expect(lab1.ws.flagsWritten).toEqual(['flag.q.a'])
    lab1.dispose()
  })

  it('真表形状：每条规则的 on 合法、id 唯一、写出去的旗标不是随手起的名字', () => {
    registerGameData()
    expect(worldstate.length).toBeGreaterThanOrEqual(3)
    const ids = new Set(worldstate.map((r) => r.id))
    expect(ids.size).toBe(worldstate.length)
    const ON = new Set(['firstParry', 'bossDefeated', 'interactUsed'])
    for (const r of worldstate) {
      expect(ON.has(r.on), `${r.id} 的 on=${r.on}`).toBe(true)
      expect(/^(flag|STATE)\./.test(r.setFlag), `${r.id}.setFlag 命名`).toBe(true)
      if (r.on === 'bossDefeated') expect(registry.has(r.dataId!), `${r.id} 指向的敌人数据`).toBe(true)
    }
  })

  it('每条规则立的旗标，regions.json 里真的有人在读它（写了没人读就是死数据）', () => {
    registerGameData()
    const read = new Set<string>()
    for (const rg of regions) {
      if (rg.unlockFlag) read.add(rg.unlockFlag)
      for (const it of rg.interactables ?? []) {
        if (it.requiresFlag) read.add(it.requiresFlag)
        // 合取闸门列进去的每一面也是读方（Phase 6-C）：漏登记一面，这条判据就会把
        // 规则表刚写下的旗判成"没人读"，而它明明锁着一扇门
        for (const f of it.requiresFlags ?? []) read.add(f)
      }
      for (const s of rg.secrets ?? []) read.add(s.unlockFlag)
    }
    // 谱册页的旗标解锁源也是读方（KI-037 乐章 IV：恩希尔终段那条规则写的就是它）
    for (const pg of (registry.get('movements') as { pages: Array<{ unlock?: { flag?: string } }> }).pages ?? []) if (pg.unlock?.flag) read.add(pg.unlock.flag)
    for (const r of worldstate) expect(read.has(r.setFlag), `${r.id} 写了 ${r.setFlag}，但没有任何闸门读它`).toBe(true)
  })
})

describe('requiresFlags：多面旗的合取闸门（Phase 6-C 初句圣所）', () => {
  /** 合成一块区域：一个 gate 挂在几面旗上，用来单独量"合取"这条语义 */
  const gate = (opts: { flags?: string[]; one?: string }): RegionData[] => {
    const rg = structuredClone(regions[0])
    rg.interactables = [{
      id: 'ga_lab', kind: 'gate', pos: { x: 0, y: 0, z: 0 },
      ...(opts.one ? { requiresFlag: opts.one } : {}),
      ...(opts.flags ? { requiresFlags: opts.flags } : {}),
    }]
    return [rg]
  }
  const at = { x: 0, y: 0, z: 0 }

  it('列进去的每一面都要在：少一面就不开，锁文本说清还差几件', () => {
    registerGameData()
    const it = new Interactables(gate({ flags: ['flag.lab.a', 'flag.lab.b', 'flag.lab.c'] }), () => true)
    expect(it.stateOf(it.get('ga_lab')!), '一面都没立').toBe('locked')
    it.setFlag('flag.lab.a'); it.setFlag('flag.lab.b')
    expect(it.stateOf(it.get('ga_lab')!), '三面里立了两面还是锁着').toBe('locked')
    const denied = it.use('ga_lab', at)
    expect(denied.ok).toBe(false)
    expect(denied.text, '缺一面就点名那一面').toContain('flag.lab.c')
    // 缺多面时要说清"还差几件、哪几件"（另起一个实例，免得把上面那三面搅在一起）
    const it2 = new Interactables(gate({ flags: ['flag.lab.a', 'flag.lab.b', 'flag.lab.c'] }), () => true)
    it2.setFlag('flag.lab.a')
    expect(it2.use('ga_lab', at).text, '缺两面时说清是哪两件').toMatch(/还差 2 件事.*flag\.lab\.b.*flag\.lab\.c/)
    it2.dispose()
    it.setFlag('flag.lab.c')
    expect(it.stateOf(it.get('ga_lab')!), '三面齐了才是 ready').toBe('ready')
    expect(it.use('ga_lab', at).ok).toBe(true)
    it.dispose()
  })

  it('单面旗（requiresFlag）与合取（requiresFlags）走的是同一处求值，不会互相顶掉', () => {
    registerGameData()
    const it = new Interactables(gate({ flags: ['flag.lab.b'], one: 'flag.lab.a' }), () => true)
    it.setFlag('flag.lab.b')
    expect(it.stateOf(it.get('ga_lab')!), '合取那一半齐了，单面那面还缺').toBe('locked')
    expect(it.use('ga_lab', at).text, '缺的那面旗要点名').toContain('flag.lab.a')
    it.setFlag('flag.lab.a')
    expect(it.stateOf(it.get('ga_lab')!)).toBe('ready')
    it.dispose()
  })
})

describe('secretId：封存点的旗标与奖励只住在 secret 那一条记录里', () => {
  it('交互物从指向的 secret 取 requiresFlag / lootTable，不在箱子上抄第二份', () => {
    registerGameData()
    const it = new Interactables(regions, () => true)
    const vault = it.all.find((x) => x.secretId)!
    const secret = regions.flatMap((r) => r.secrets ?? []).find((s) => s.id === vault.secretId)!
    expect(vault.id, '数据里要有一个挂着 secretId 的领取点').toBeTruthy()
    expect(it.get(vault.id)!.requiresFlag).toBe(secret.unlockFlag)
    expect(it.get(vault.id)!.lootTable).toBe(secret.rewardTable)
    it.dispose()
  })

  it('指向不存在的 secret ⇒ 构造时就炸，而不是留一只永远打不开的箱子', () => {
    registerGameData()
    const bad = structuredClone(regions[0])
    bad.interactables = [...(bad.interactables ?? []), { id: 'sv_bogus', kind: 'chest', pos: { x: 0, y: 0, z: 0 }, secretId: 'sec.not_here' }]
    expect(() => new Interactables([bad], () => true)).toThrow(/sec\.not_here/)
  })
})
