/**
 * KI-120（结构那一半）：**播报里那个「X｜…」的 X 从哪来**。
 *
 * **病是什么**：KI-119 把 combat.md §4.8 那张战技帧表对上账，顺出来一条生产缺陷——
 * `ThirdPersonController` 的出手播报把式名抄在代码里。数据侧《终止》（`mv_terminate`）带 `silenceTicks`，
 * 于是弹《终止》时屏上印的是「无声协奏｜2.0s 世界听不见你」：秒数是对的（它读的是数据），名字是别人的。
 * 同族另有「定音｜弹反充能」（数据侧那式叫《定音回响》）与「闷音｜战技被封」（statuses.json 的名字被重抄）。
 * 行为那一半住在 `tests/flow/movements.test.ts` 的 KI-120 那一组（真打出去、读屏）；这一份管**整个 src 的射程**。
 *
 * **为什么行为腿不够，还要这一台机器**：行为腿只测今天会播的那三式（名册从 `movements.json` 筛）。
 * 状态名、敌人侧播报、以及下一式接线时的新播报都在它看不见的地方。手抄名字的形状是"新增一条没人拦"，
 * 所以门要扫全部说话方，而不是点名今天已知的几个。
 *
 * **口径**：
 *  - **名册从数据现推**：`movements.json` 的 `displayName` ∪ `statuses.json` 的 `displayName`，
 *    测试里不写第二份名单（今天 7 + 5 = 12 条）。
 *  - **撞名的判法是双向前缀**：相等（抄整名）或「名以它为前缀」（抄简称，定音 ⊂ 定音回响）都算第二本账。
 *    反方向（话比名长，如「过载不足」）不算——那是玩家话术，不是那一格的标签。
 *  - **只有"作者手写的字"参与判定**：`${…}` 里的东西不进 `lit`，所以 `${movementName(cast.id)}｜…`
 *    的字面半句是「｜…」，名头为空 ⇒ 通过（这正是本批要的写法）。注释里的字符串也不算话。
 *  - **豁免按身份开**（文件 + 那一格必须仍在的字面 + 账本号），不按行号：挪一行不会把豁免叫回来，
 *    改一个字面会把那一格重新叫到台面上裁。
 *  - **今天不收费的一族**（写在这里，别让绿色被读成"全覆盖"）：武器／敌人名走 `nameKey` 词表（`nameOf()` 现推），
 *    不在本门名册里，所以 `手上没有枪｜…引针枪` 与 `拾回引针枪` 那两处手抄武器名不判 —— 记在 KI-120 行里。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { movements, statuses } from '@/data'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** 统一行尾，免得"这份文件今天是 CRLF"变成判据的一部分 */
const read = (p: string): string => readFileSync(`${root}${p}`, 'utf8').replace(/\r\n/g, '\n')

/** 生产码的全部 .ts：tests 不是说话方（游戏不会把测试里那句话播给玩家） */
const SRC = (() => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${d}/${e.name}`) : e.name.endsWith('.ts') ? [`${d}/${e.name}`] : [])
  return walk(`${root}src`)
})()

/**
 * 把注释涂白（长度与新行数都不动）：注释里的 `'ui.notify'` 与 `'休止｜…'` 不该算成一条播报，
 * 而偏移必须原样保住，否则报出来的行号指着别处。
 */
function whitenComments(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length))
}

/** 一条 `ui.notify` 的 text 表达式 */
type Expr = { raw: string; lit: string; line: number; file: string }

/**
 * 从 `text:` 之后读出那一格。收口：深度 0 上后面紧跟 `kind` 的逗号，或对象自身的 `}`。
 * 容器用栈记：模板里的 `${…}` 递归进代码层（那里的逗号不算收口），字符串按引号收。
 * `lit` 只收"手写的字"：模板的字面区 + 普通字符串的整体；`${…}` 里的一切不进 `lit`。
 */
function readExpr(s: string, from: number, file: string): Expr | null {
  let i = from
  while (i < s.length && /\s/.test(s[i])) i++
  if (i >= s.length) return null
  const start = i
  let lit = ''
  type Frame = { k: 'expr' | 'interp' | 'tpl' | 'sq' | 'dq'; d: number }
  const frames: Frame[] = [{ k: 'expr', d: 0 }]
  while (i < s.length) {
    const top = frames[frames.length - 1]
    const c = s[i]
    if (top.k === 'sq' || top.k === 'dq') {
      if (c === '\\') { i += 2; continue }
      if (c === (top.k === 'sq' ? "'" : '"')) { frames.pop(); i++; continue }
      lit += c; i++; continue
    }
    if (top.k === 'tpl') {
      if (c === '\\') { i += 2; continue }
      if (c === '`') { frames.pop(); i++; continue }
      if (c === '$' && s[i + 1] === '{') { frames.push({ k: 'interp', d: 0 }); i += 2; continue }
      lit += c; i++; continue
    }
    if (c === '`') { frames.push({ k: 'tpl', d: 0 }); i++; continue }
    if (c === "'" || c === '"') { frames.push({ k: c === "'" ? 'sq' : 'dq', d: 0 }); i++; continue }
    if (c === '(' || c === '[' || c === '{') { top.d++; i++; continue }
    if (c === ')' || c === ']' || c === '}') {
      if (top.d === 0) {
        if (top.k === 'interp') { frames.pop(); i++; continue }
        break
      }
      top.d--; i++; continue
    }
    if (c === ',' && top.k === 'expr' && top.d === 0) {
      if (s.slice(i + 1).replace(/^\s+/, '').startsWith('kind')) break
      i++; continue
    }
    i++
  }
  return { raw: s.slice(start, i).trim(), lit, line: s.slice(0, start).split('\n').length, file }
}

const SEP = '｜'
/** 「X｜…」里那个 X；字面半句里没有名头返回 null（`${…}｜…` 那种从数据现推的写法） */
const labelOf = (lit: string): string | null => {
  const i = lit.indexOf(SEP)
  if (i < 0) return null
  const label = lit.slice(0, i).trim()
  return label === '' ? null : label
}

const NAMES = [
  ...movements.movements.map((m) => m.displayName),
  ...Object.values(statuses).map((s) => s.displayName)
]

/** 双向前缀：抄整名或抄简称都算第二本账 */
const collide = (label: string): string[] =>
  NAMES.filter((n) => label === n || label.startsWith(n) || (label.length >= 2 && n.startsWith(label)))

type Site = Expr & { label: string | null; labelHits: string[]; nameHits: string[] }

/** 全站扫一遍：播报站点、带手抄名头的、整句抄名的、拿字面 60 当秒尺的 */
function census(files: string[]): { sites: Site[] } {
  const sites: Site[] = []
  for (const abs of files) {
    const rel = abs.slice(root.length).replace(/\\/g, '/').replace(/^\//, '')
    const src = whitenComments(readFileSync(abs, 'utf8').replace(/\r\n/g, '\n'))
    const re = /\.emit\(\s*['"]ui\.notify['"]\s*,/g
    let m
    while ((m = re.exec(src))) {
      const t = src.indexOf('text:', m.index)
      if (t < 0 || t - m.index > 400) continue
      const e = readExpr(src, t + 5, rel)
      if (!e) continue
      const label = labelOf(e.lit)
      sites.push({
        ...e, label,
        labelHits: label ? collide(label) : [],
        nameHits: NAMES.filter((n) => e.lit.includes(n))
      })
    }
  }
  return { sites }
}

const R = census(SRC)
const show = (e: Site): string =>
  `${e.file}:${e.line}${e.label ? ` 「${e.label}｜…」` : ''} :: ${e.raw.slice(0, 70)}`

/**
 * 手抄名字的豁免名册（按身份开）。每条点名一笔账（`ki`），而那一行在 KNOWN_ISSUES 里不许已写
 * Implemented —— 同生同死，沿用 KI-117／KI-114 那只手。`shape` 是那一格里**必须仍在**的字面：
 * 谁改了拼写，这条豁免就叫回来重裁，而不是悄悄跟着走。
 */
/**
 * 手抄名字的豁免名册（按身份开）。**今天是空的，而且"空"就是它的目标状态**（KI-148）。
 *
 * 名册里曾有两条（KI-121）：战斗层那两处把名字抄在代码里——「休止｜…」（《休止斩》的简称）与
 * 「震裂碎裂！」（`statuses.json` 的《震裂》）。两处都已交回数据侧现推，名字不再有第二个主人。
 *
 * **同生同死**（KI-117／KI-114 那只手）：名册里每一条都点名一笔账，而那一行在 KNOWN_ISSUES 里
 * 不许写 Implemented；反过来，账上那一行写了"已结案"，名册里就不许还挂着它。
 */
const LEDGER: Array<{ file: string; shape: string; ki: string; why: string }> = []

const ledger = read('docs/KNOWN_ISSUES.md')
const covered = (e: Site): number => LEDGER.filter((x) => x.file === e.file && e.raw.includes(x.shape)).length

describe('§7.2 播报的名字只有一个主人（KI-120 的门）', () => {
  const labelled = R.sites.filter((e) => e.label !== null)
  const copied = R.sites.filter((e) => e.nameHits.length > 0)
  const rulers = R.sites.filter((e) => /\/\s*60\b/.test(e.raw))

  it('地板：量具真的读到了话，而且读到了已知那几位说话方', () => {
    expect(SRC.length, 'src 里一个 .ts 都没走到 ⇒ 下面全是空集假绿').toBeGreaterThan(40)
    expect(NAMES.length, '名册空了 ⇒ "没有一处撞名"是假的').toBeGreaterThan(8)
    expect(R.sites.length, '一条 ui.notify 都没扫到 ⇒ 判据读的是空 population').toBeGreaterThanOrEqual(40)
    const files = new Set(R.sites.map((e) => e.file))
    for (const f of ['src/player/ThirdPersonController.ts', 'src/combat/CombatManager.ts', 'src/combat/Statuses.ts'])
      expect(files.has(f), `${f} 明明在播，却没进总体 ⇒ 扫描漏了它`).toBe(true)
    // **地板从 3 降到 2**（KI-148）：第三格是战斗层那条手抄的「休止｜…」——它交回数据侧之后
    // 名头变成了 `${movementName(cast.id)}｜…`，**不再是手写的「X｜」**，所以量具读不到它了。
    // 这不是"量具变窄了"，是那一格**不再属于这一族**（这一族＝名字被抄在代码里）。
    expect(labelled.length, '带「X｜」名头的播报一条都没读到：这一族是"名字被抄在代码里"').toBeGreaterThanOrEqual(2)
  })

  it('名头判据：每一条手写的「X｜」都不许撞上数据侧的名字（撞了就得上册）', () => {
    const bad = labelled.filter((e) => e.labelHits.length > 0 && covered(e) === 0)
    expect(bad, `这些播报把数据侧的名字抄在了代码里：\n${bad.map(show).join('\n')}`).toEqual([])
  })

  it('整句判据：正文里抄着数据侧名字的站点也全部在册', () => {
    const bad = copied.filter((e) => covered(e) === 0)
    expect(bad, `这些格子里有第二个名字账：\n${bad.map(show).join('\n')}`).toEqual([])
  })

  it('名册的账要活着：每条豁免恰命中一格，引用的账本行不许已结案', () => {
    for (const x of LEDGER) {
      const hits = R.sites.filter((e) => e.file === x.file && e.raw.includes(x.shape))
      expect(hits.length, `豁免「${x.file} :: ${x.shape}」命中 ${hits.length} 条：0 = 账还挂着而那一格没了，>1 = 形状太宽`)
        .toBe(1)
      expect(covered(hits[0]), `豁免没被上面两条判据读到，说明那一格撞的不是名册的形状`).toBeGreaterThan(0)
    }
    for (const id of [...new Set(LEDGER.map((x) => x.ki))]) {
      const row = ledger.split('\n').find((l) => l.startsWith(`| ${id} `))
      expect(row, `KNOWN_ISSUES.md 里找不到 ${id} 那一行 ⇒ 豁免在引用一笔不存在的账`).toBeTruthy()
      if (LEDGER.length > 0)
        expect(row, `${LEDGER.length} 条手抄名字还挂着 ⇒ ${id} 那一行不许写 Implemented`).not.toContain('Implemented')
    }
  })

  it('秒尺：没有任何一条播报把 tick 除以字面 60（tick→秒只认 TICK_HZ）', () => {
    expect(rulers, `这些格子自己写了一把秒尺：\n${rulers.map(show).join('\n')}`).toEqual([])
  })

  it('判据自己先站住：抄整名红、抄简称红、话比名长绿、从数据现推的写法读成没有名头', () => {
    expect(collide('无声协奏'), '抄整名').toContain('无声协奏')
    expect(collide('定音'), '抄简称（数据侧那式叫《定音回响》）').toContain('定音回响')
    expect(collide('闷音'), '状态名也是名册里的').toContain('闷音')
    expect(collide('手上没有枪'), '这句话不是任何一格的标签').toEqual([])
    expect(collide('过载不足'), '话比名长不算抄').toEqual([])
    expect(labelOf('｜弹反充能 ×2'), '`${movementName(…)}｜…` 的字面半句没有名头').toBeNull()
    const probe = census([`${root}src/player/ThirdPersonController.ts`]).sites
    expect(probe.length, '探针单独读一个文件也要读得到（读空=判据坏，不是干净）').toBeGreaterThan(3)
    expect(probe.filter((e) => e.label !== null).length, '本批把那三格改成现推之后，TPC 只剩两句自己的话')
      .toBeGreaterThanOrEqual(2)
  })

  it('扫描器读得出多行写法与三元：两种形状都要点出名头，否则整族漏检', () => {
    const at = (s: string): Expr => {
      const e = readExpr(s, s.indexOf('text:') + 5, 'probe')
      expect(e, '探针没读出表达式').toBeTruthy()
      return e!
    }
    // **这一格现在长什么样**：名头从数据侧现推（`${movementName(cast.id)}｜…`），
    // 所以"手写的名头"已经不存在了——量具读到的名头是**空**（那一格的名字不是抄在代码里的）。
    const multi = at("bus.emit('ui.notify', {\n  text: \`\${movementName(cast.id)}｜\${n} 个声音停在拍上\`,\n  kind: 'info'\n})")
    expect(labelOf(multi.lit), '多行对象里那一格没读到（名头已是数据侧现推，量具读不到"手写名头"）').toBe(null)
    const ternary = at("bus.emit('ui.notify', { text: this.ramp ? `过载不足｜涨到 ${c}` : '过载不足', kind: 'info' })")
    expect(labelOf(ternary.lit), '三元两支拼起来仍要点得出名头').toBe('过载不足')
    expect(collide(labelOf(ternary.lit) ?? ''), '但"过载不足"不是抄的名字').toEqual([])
    const derived = at("bus.emit('ui.notify', { text: `${movementName(id)}｜静默 ${t}s`, kind: 'info' })")
    expect(labelOf(derived.lit), '从数据现推的写法必须读成"没有名头"，否则这扇门会把正确写法钉红').toBeNull()
    expect(whitenComments('// 休止｜假的一条').includes('休止'), '注释里的字符串不该进判据').toBe(false)
  })
})
