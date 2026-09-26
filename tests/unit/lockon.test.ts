import { afterEach, describe, expect, it } from 'vitest'
import { bus } from '@/core/EventBus'
import { LockOn, type LockCandidate } from '@/player/LockOn'
import type { PlayerController } from '@/player/ThirdPersonController'

/**
 * 锁定（LockOn）的声音签名（KI-065）——`audio-keys` 那道静态闸门只证明"有人发射这个 key"，
 * 证明不了"什么时候响"。而 `lockon_off` 恰恰是一个**时机**契约：解除必须有一张自己的脸，
 * 但只能在真的从"有目标"变成"没目标"的那一刻响。
 *
 * 这里不测"锁得手感好不好"（本机没有视口也没有听觉，KI-010 同因），但**打分三项各自有没有读者**是
 * 可观察的：给一对互相竞争的位置，看最终锁的是哪一只。钉住的位置见下面第二个 describe。
 * 上面这个 describe 钉四件可观察的事：发射的 key、`ui.target` 的清空、以及"不响"的那几种场合。
 */

interface Probe {
  id: string
  pos: { x: number; y: number; z: number }
  alive: boolean
  boss?: boolean
}

function candidate(p: Probe): LockCandidate {
  return {
    id: p.id,
    getPos: () => p.pos,
    get alive() { return p.alive },
    get isBoss() { return p.boss ?? false },
    get nameKey() { return p.id }
  }
}

const live: Array<() => void> = []
afterEach(() => { while (live.length) live.pop()!() })

function rig(probes: Probe[]): { lock: LockOn; player: PlayerController; sfx: string[]; targets: string[] } {
  // 只给 LockOn 真正读写的那三个字段——多给一个字段就是替测试造一个生产里不存在的玩家
  const player = { pos: { x: 0, y: 0, z: 0 }, yaw: 0, lockedTarget: null } as unknown as PlayerController
  const lock = new LockOn(player)
  lock.candidates = probes.map(candidate)
  const sfx: string[] = []
  const targets: string[] = []
  const offs = [
    bus.on('audio.sfx', (e) => sfx.push(e.key)),
    bus.on('ui.target', (e) => targets.push(e.name))
  ]
  live.push(() => offs.forEach((off) => off()))
  return { lock, player, sfx, targets }
}

describe('锁定的声音：响与不响同样要钉', () => {
  it('锁上没有目标不放"锁上了"那一声——空锁响一声就是把失败播成成功', () => {
    const { lock, sfx } = rig([{ id: 'far', pos: { x: 90, y: 0, z: 0 }, alive: true }])
    lock.toggle()
    expect(sfx, `空锁发射了 ${sfx.join('/')}`).toEqual(['ui_move'])
    expect(lock.target).toBe(null)
  })

  it('acquire 到目标 = lockon_on；再 toggle 换目标还是 lockon_on（换人不是解除）', () => {
    const a: Probe = { id: 'a', pos: { x: 0, y: 0, z: 6 }, alive: true }  // 正前方，更远
    const b: Probe = { id: 'b', pos: { x: 3, y: 0, z: 0 }, alive: true }  // 右手边，更近
    const { lock, sfx, targets } = rig([a, b])
    lock.toggle()
    expect(sfx).toEqual(['lockon_on'])
    // 故意让"正面"那个更远：两边同距时删掉角度项只会留下平局，而 `score > bestScore` 会把名单里
    // 第一个保住 —— 那条用例照样绿，但它证的已经不是权重了（KI-065 的反向探针就是这么空手的）
    expect(targets[targets.length - 1], '侧面更近就该锁侧面：正面优先这条只能由角度权重说出来').toBe('a')
    lock.toggle()
    expect(sfx, '换目标时把两个声音都放了').toEqual(['lockon_on', 'lockon_on'])
    expect(targets[targets.length - 1], 'toggle 没有在活着的候选之间轮换').toBe('b')
  })

  it('解除有一张自己的脸：最后一个候选被 toggle 掉时放 lockon_off，而且只放一次', () => {
    const a: Probe = { id: 'a', pos: { x: 4, y: 0, z: 0 }, alive: true }
    const { lock, sfx } = rig([a])
    lock.toggle()
    expect(sfx).toEqual(['lockon_on'])
    lock.toggle()
    expect(sfx, '只剩一个候选时 toggle 应当解除并把这声放出来').toEqual(['lockon_on', 'lockon_off'])
    lock.toggle()
    expect(sfx, '本来就没锁定，不该再"解除"一次').toEqual(['lockon_on', 'lockon_off', 'lockon_on'])
  })

  it('目标死亡 / 走出射程 ⇒ update 里解除并响那一声（玩家不看屏幕也要知道锁丢了）', () => {
    const a: Probe = { id: 'a', pos: { x: 4, y: 0, z: 0 }, alive: true }
    const { lock, sfx } = rig([a])
    lock.toggle()
    expect(sfx).toEqual(['lockon_on'])
    a.alive = false
    lock.update()
    expect(sfx, '目标死了锁却无声地掉了').toEqual(['lockon_on', 'lockon_off'])
    lock.update()
    expect(sfx, '已经解除了还在每帧补一响').toEqual(['lockon_on', 'lockon_off'])

    const b: Probe = { id: 'b', pos: { x: 4, y: 0, z: 0 }, alive: true }
    const r2 = rig([b])
    r2.lock.toggle()
    // 40m 而不是 999m：把射程边界挪到"射程外一点点"，`range` 这个数才有读者
    // （999 的话把 range 改成 3500 也照样红不了，见 KI-065 的 L4 探针空手）
    b.pos = { x: 40, y: 0, z: 0 }
    r2.lock.update()
    expect(r2.sfx, '走出射程的解除没响').toEqual(['lockon_on', 'lockon_off'])
    expect(r2.player.lockedTarget, '解除后玩家手里还攥着旧目标').toBe(null)

    const c: Probe = { id: 'c', pos: { x: 4, y: 0, z: 0 }, alive: true }
    const r3 = rig([c])
    r3.lock.toggle()
    c.pos = { x: 34, y: 0, z: 0 }   // 34 < 35：还在射程内，不许自己掉锁
    r3.lock.update()
    expect(r3.sfx, '射程内的目标被解除了（边界读反了方向）').toEqual(['lockon_on'])
    expect(r3.lock.target?.id).toBe('c')
  })

  it('entity.died 走的是同一条出口（订阅而不是轮询才能兜住"死在锁定之前"）', () => {
    const died = (id: string) => bus.emit('entity.died', { id, kind: 'enemy', position: { x: 0, y: 0, z: 0 } })
    const a: Probe = { id: 'doomed', pos: { x: 3, y: 0, z: 0 }, alive: true }
    const { lock, sfx } = rig([a])
    lock.toggle()
    expect(sfx).toEqual(['lockon_on'])
    died('doomed')
    expect(sfx, '目标死了锁却无声地掉了').toEqual(['lockon_on', 'lockon_off'])
    expect(lock.target).toBe(null)
    const other: Probe = { id: 'other', pos: { x: 3, y: 0, z: 0 }, alive: true }
    const r2 = rig([other])
    r2.lock.toggle()
    const n = r2.sfx.length
    died('not-the-target')
    expect(r2.sfx.length, '别人的死亡把这一锁解除了').toBe(n)
    expect(r2.lock.target).not.toBe(null)
  })

  it('生产里锁定的唯一入口是 toggle（main.ts 的 edges 那条），所以声音只挂在这一个入口上', () => {
    const a: Probe = { id: 'a', pos: { x: 4, y: 0, z: 0 }, alive: true }
    const { lock, sfx } = rig([a])
    lock.acquireBest()
    expect(sfx, 'acquireBest 自己不放声：响了的是 toggle，这条区别留着免得以后把两处各接一份音效').toEqual([])
    expect(lock.target?.id).toBe('a')
  })
})

/**
 * 打分三项（`-ang*2.2 - d*0.06 + (isBoss?3:0)`）各要有一个**能推翻另一项**的位置。
 *
 * 只证明"这一项存在"是不够的：同距的正面/侧面平局会被名单顺序替权重领功，`999m` 的射程外会把
 * 任何有限 range 都判对。所以下面每一格都是"两项对着干、结果只可能由其中一个决定"的形状，
 * 并把权重比值本身也钉住（20° vs 35° 那一对：把 2.2 写成 0.06 就翻）。
 * 这三个数仍住在代码里、不在表里 —— TD-005 的**入表腿**还欠着（`schema.ts` 此刻被并行会话占着）。
 */
describe('选目标打分：三项权重各有对手，不是各自空转', () => {
  it('距离项有读者：更近的那个排在名单后面也必须被选中（权重写成 0 就是平局，平局由顺序判）', () => {
    const far: Probe = { id: 'far', pos: { x: 0, y: 0, z: 12 }, alive: true }
    const near: Probe = { id: 'near', pos: { x: 0, y: 0, z: 3 }, alive: true }
    const { lock } = rig([far, near])   // 两者都正对，ang=0 ⇒ 唯一区别是距离
    lock.acquireBest()
    expect(lock.target?.id, '两个正对的目标锁了后面那个远的').toBe('near')
  })

  it('角度权重的比值有读者：20° 偏 3m 赢过正对 20m，35° 偏 3m 就该让位（把 2.2 当成 0.06 就两格一起翻）', () => {
    const ahead: Probe = { id: 'ahead', pos: { x: 0, y: 0, z: 20 }, alive: true }
    const off20: Probe = { id: 'off20', pos: { x: 3 * Math.sin(20 * Math.PI / 180), y: 0, z: 3 * Math.cos(20 * Math.PI / 180) }, alive: true }
    const off35: Probe = { id: 'off35', pos: { x: 3 * Math.sin(35 * Math.PI / 180), y: 0, z: 3 * Math.cos(35 * Math.PI / 180) }, alive: true }

    const a = rig([ahead, off20]); a.lock.acquireBest()
    expect(a.lock.target?.id, '20° 外的近目标赢不了正对 20m —— 角度项被距离项压死了').toBe('off20')
    const b = rig([ahead, off35]); b.lock.acquireBest()
    expect(b.lock.target?.id, '35° 外的近目标还赢 —— 角度惩罚小得不像"面向"这个概念').toBe('ahead')
  })

  it('Boss 权重 +3 单独决定胜负：30° 外 8m 的她赢过正对 3m 的杂兵（这一项归零或削到 1.4 以下就翻）', () => {
    const mook: Probe = { id: 'mook', pos: { x: 0, y: 0, z: 3 }, alive: true }
    const boss: Probe = {
      id: 'boss', pos: { x: 8 * Math.sin(30 * Math.PI / 180), y: 0, z: 8 * Math.cos(30 * Math.PI / 180) },
      alive: true, boss: true
    }
    const { lock, targets } = rig([mook, boss])
    lock.acquireBest()
    expect(lock.target?.id, '她站在侧面就锁不上：Boss 优先这一项没有落地').toBe('boss')
    expect(targets[targets.length - 1], 'HUD 收到的 isBoss 与实际锁定的目标不是同一只').toBe('boss')
  })
})
