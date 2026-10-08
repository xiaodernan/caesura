import { describe, expect, it } from 'vitest'
import { registerGameData, cinematics, regions, dialogues, quests as questTable } from '@/data'
import { readFileSync } from 'node:fs'
import { Cinematics } from '@/world/Cinematics'
import { DialogueEngine } from '@/quest/Dialogue'
import { DialogueSession } from '@/quest/Settlement'
import { Quests } from '@/quest/Quests'

/**
 * `src/world/Cinematics.ts`（§6 过场清单的**播放器**，纯逻辑）的行为守卫。
 *
 * 运行时调用方**已接**（`main.ts`：新局开场 / 三条 Boss 出场 / 对话选择 / 主 Boss 倒下四处触发，
 * 其中镜头轨道与字幕时序仍要真几何与相机 ⇒ KI-008/KI-010），
 * 所以这个文件除了当消费者，还钉住"哪一条在跑、还剩多久、该不该夺输入"这三件事，
 * 接腿的时候不必再猜它怎么工作。
 *
 * ⚠️ 它**不演**也不**决定何时放**——只回答"该不该锁输入"；真去锁 `Input` 的是 `main.ts` 的事。
 */
registerGameData()

const rows = cinematics as unknown as Array<{ id: string; kind: string; durationMs: number; lockInput?: boolean }>

describe('Cinematics 播放器：起 / 走 / 收 / 锁', () => {
  it('用真表建一个播放器，表里有那几条（至少 10 条，含开场与结局）', () => {
    const p = new Cinematics(rows)
    expect(rows.length).toBeGreaterThanOrEqual(10)
    expect(p.has('CINE_OPEN'), '开场').toBe(true)
    expect(p.has('CINE_END_A'), '结局 A').toBe(true)
  })

  it('**id 不在表里 ⇒ start 返回 false 且不起**（不静默开始一个空演出）', () => {
    const p = new Cinematics(rows)
    expect(p.start('CINE_DOES_NOT_EXIST')).toBe(false)
    expect(p.current).toBeNull()
    expect(p.inputLocked).toBe(false)
  })

  it('start 之后 current 交代 id/kind/总时长，elapsed 从 0 起', () => {
    const p = new Cinematics(rows)
    expect(p.start('CINE_OPEN')).toBe(true)
    const cur = p.current!
    expect(cur.id).toBe('CINE_OPEN')
    expect(cur.elapsedMs).toBe(0)
    expect(cur.durationMs).toBeGreaterThan(0)
  })

  it('走满时长 ⇒ 自动收束（current 变 null、输入锁解除），且**不留最后一帧**', () => {
    const p = new Cinematics(rows)
    p.start('CINE_MYRIAD_INTRO')
    const total = p.current!.durationMs
    expect(p.advance(total - 1), '还差 1ms ⇒ 仍在跑').toBe(true)
    expect(p.advance(1), '走满 ⇒ 收束').toBe(false)
    expect(p.current).toBeNull()
    expect(p.inputLocked).toBe(false)
  })

  it('advance 在没演出时返回 false（调用方不必先问 current）', () => {
    const p = new Cinematics(rows)
    expect(p.advance(16)).toBe(false)
  })

  it('skip 手动收束；非正/非有限的 deltaMs 不推进也不收束（脏输入不改状态）', () => {
    const p = new Cinematics(rows)
    p.start('CINE_WIN')
    expect(p.advance(0)).toBe(true)
    expect(p.advance(Number.NaN)).toBe(true)
    expect(p.current!.elapsedMs).toBe(0)
    p.skip()
    expect(p.current).toBeNull()
  })

  it('`inputLocked` 跟着**这一条自己的 `lockInput`** 走；那一格缺省时不锁（欠账≠设计）', () => {
    const locked = new Cinematics([{ id: 'A', kind: 'k', durationMs: 1000, lockInput: true }])
    const unlocked = new Cinematics([{ id: 'B', kind: 'k', durationMs: 1000 }])
    locked.start('A'); expect(locked.inputLocked).toBe(true)
    unlocked.start('B'); expect(unlocked.inputLocked, '缺省不锁').toBe(false)
  })

  it('同时起第二条 ⇒ 取代第一条（过场不排队）', () => {
    const p = new Cinematics(rows)
    p.start('CINE_OPEN')
    p.start('CINE_WIN')
    expect(p.current!.id).toBe('CINE_WIN')
  })
})

describe('运行时那条腿（`main.ts`）：接了什么、**没接什么**，都钉在源门上', () => {
  const main = readFileSync('src/main.ts', 'utf8')

  it('接了：过场实例 + 每帧走时间 + 输入门 + 新开局放开场', () => {
    expect(main, '实例').toMatch(/new Cinematics\(/)
    expect(main, '每帧走时间').toMatch(/cinematics\.advance\(dt \* 1000\)/)
    expect(main, '输入门').toMatch(/!cinematics\.inputLocked/)
    expect(main, '新开局放开场').toMatch(/if \(!slot\) cinematics\.start\('CINE_OPEN'\)/)
  })

  it('**没接**的那 4 条必须一个都不出现（谁接了就顺手把这条改准，别让它一直骗人）', () => {
    // 触发点今天接了四处：① 新局开场 ② 进 Boss 区（三条出场）③ 对话选择（剧情 B5）④ 主 Boss 倒下（胜利）。
    // **没接**的是剧情 B7 与三条结局向的——它们的接点是终局分支。
    // 这条断言的作用不是"证明没接"，而是**让"没接"这件事会响**：谁接了新的，这里红，逼他改这条。
    const UNWIRED = [
      'CINE_STORY_B7',
      'CINE_END_A',
      'CINE_END_B',
      'CINE_END_MONTAGE',
    ]
    for (const id of UNWIRED) {
      expect(main.includes(id), `${id} 在 main.ts 里出现了 ⇒ 有人接了新触发，请把这条与上面那条一起改准`).toBe(false)
    }
  })

  it('对话那条腿：选择挂了 `cinematic` 就真的放，而且**先放再推进**（§6 第三类触发）', () => {
    // 过场是"这一下之后世界安静了"的那一段：`turn` 会立刻换到下一个节点，所以顺序反过来
    // 就成了"先说话再黑场"。这条用例连顺序一起钉住。
    const played: string[] = []
    const quests = new Quests(questTable)
    const session = new DialogueSession({
      quests,
      engine: new DialogueEngine(dialogues, quests),
      ctx: { hasFlag: (k) => k !== 'flag.meg_soundscroll_complete', relation: () => 0, questState: () => 'not_started', questIndex: () => 0, hasItem: () => false, hasSeen: () => false, state: () => '' },
      inv: { add: () => 0, remove: () => false, count: () => 0 },
      setFlag: () => {}, setState: () => {}, notify: () => {}, refresh: () => {}, setPaused: () => {}, present: () => {},
      playCinematic: (id) => played.push(id),
    })
    // 旗标全开（除了"声卷已交"）⇒ 开场落到 n7：那一格的 c1 就挂着 CINE_STORY_B5
    expect(session.open('npc_meg')).toBe(true)
    session.choose('c1')
    expect(played).toEqual(['CINE_STORY_B5'])
    expect(rows.some((r) => r.id === played[0]), '放出来的 id 真是清单里的一行').toBe(true)
  })

  it('接了的 4 条按名字点出来（新开局 1 + Boss 出场 3 + 胜利 1），且各自挂在**对的**挂点上', () => {
    // 胜利那一条必须认人：§6 的镜头语言是"管风琴过载熄灭"，那是主 Boss 恩希尔（未竟厅）那一战，
    // 不是"任何 Boss 倒下都放"。挂错人不会有别的东西响——所以在这里钉住 `dataId`。
    expect(main, '胜利认的是主 Boss').toMatch(/p\.dataId === 'en_hersil'[\s\S]{0,80}CINE_WIN/)
    expect(main, '新开局').toMatch(/start\('CINE_OPEN'\)/)
    for (const id of ['CINE_OST_INTRO', 'CINE_HERSIL_INTRO', 'CINE_MYRIAD_INTRO']) {
      expect(main.includes(id), `Boss 出场 ${id}`).toBe(true)
    }
    // 挂点必须是**真区域 id**（写错一个字母就等于那条出场永远不放，而不会有别的东西响）
    const wired = [...main.matchAll(/(rg_[a-z_]+): '(CINE_[A-Z_]+)'/g)].map((m) => [m[1], m[2]])
    expect(wired.map(([, c]) => c).sort()).toEqual(['CINE_HERSIL_INTRO', 'CINE_MYRIAD_INTRO', 'CINE_OST_INTRO'])
    for (const [rg] of wired) {
      expect(regions.some((r) => r.id === rg), `${rg} 是真区域吗`).toBe(true)
    }
  })
})
