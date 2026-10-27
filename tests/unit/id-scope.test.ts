import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  GATE_ENTRIES,
  NAMED_HOLES,
  carrierFindings,
  citedIds,
  deliverySurface,
  holeArea,
  holeFindings,
  ledgerSelfFindings,
  populationFindings,
  populationSourceFindings,
  populationSites,
  scopeFindings,
  trackedFiles,
} from '../../scripts/id-scope-rules.mjs'
import { REGISTER_FILE, SELF_EXEMPT, ledgerRows } from '../../scripts/id-rules.mjs'
import { walkTextCorpus } from '../../scripts/text-corpus.mjs'

/**
 * 「按号这一族读的是哪片总体」这一格（KI-329，2026-10-28）。
 *
 * **病**：这个仓里同一件东西「总体」有**三份手抄**，而按号这一族的三道门各抄了一份：
 *   - 门 B（`doc-audit.test.ts`）手抄的是「目录 × 后缀」两张清单（`.ts|.tsx|.mjs|.md|.json`）⇒ **它会漏**：
 *     `scripts/*.d.mts`（28 份）**就在 `scripts/` 里、就在它自己写下的范围内**，却因为后缀不在清单里而一眼没看；
 *     根上的**具名散文件**（`vite.config.ts` 等 6 份）也不在它的四棵树里——而 `vite.config.ts` 带着 2 处按号引用。
 *   - 号段门（`id-table.test.ts`）与门 I2（`registry-table.test.ts`）是**同一份清单的另两抄**
 *     （后缀多了 `.mts`／`.py`，目录还是那四棵）⇒ 读 521 份，比交付总体少 6 份（差的是那 6 份根散文件）。
 *   - 而这个仓早就有一份**第一等的总体口径**：`scripts/text-corpus.mjs` 的 `walkTextCorpus`
 *     （四棵树 ＋ 根的具名散文件；按**内容**认二进制；致命 UTF-8 解码）。
 *
 * **为什么值得单独立行**：一条规则的可信度取决于它的**总体**。判据写着「每一处」，而走查漏了一类后缀，
 * 那句「每一处」就是空话——而**空话不会红**（没看过的引用不会变成红，绿是白送的）。
 *
 * **这一格判五件事**（每件都能被合成夹具喂）：
 *   ① **不许有两份总体**：门实际读到的文件集必须**逐份等于**交付总体（两个方向的差集都空）。
 *   ② **洞不许悄悄长大**：已入库却落在交付总体之外的文件按面积归堆；每一堆都必须有名字、有理由
 *      （今天只有 `.scratch`（证据区）与根点文件两堆）；登记过期也红。
 *   ③ **带号的已入库文件不许落在走查面之外**：它要么在交付总体里，要么在有名有理由的洞里。
 *   ④ **账本自己引的号也要读得到行**：账本不是读者的例外；读不到的那几处必须**逐条登记理由**
 *      （名册过期也红），而登记过的号**不许在账本以外被人当现行号引用**。
 *   ⑤ **总体只有一个出处**：喂给按号判据的文件集只有两种合法来源——交付总体（真库那一腿）
 *      与当场拼出来的合成夹具；自己抄的一份清单 ⇒ 红。
 *
 * **这一格住在哪里**：判据住在 `scripts/id-scope-rules.mjs`（与 `*-rules.mjs` 那一族同一个理由——
 * 判据要能被合成夹具喂，喂一份假的总体／走查面／已入库名册，看它拒不拒）；真库那一腿才量得到
 * 「这是不是真的一道门」而不是「作者试过一次」。
 */

const root = fileURLToPath(new URL('../..', import.meta.url))
const LEDGER_REL = 'docs/KNOWN_ISSUES.md'
const REGISTER_REL = REGISTER_FILE

/** 造号：模板拼出来——这台门扫 `tests/`，字面量落在本文件里会先红在自己身上 */
const ghost = (digits: string): string => `KI-${digits}`

/**
 * 造一道按号门「怎么取它的文件集」的调用文本：入口名与实参都在**运行时**拼。
 *
 * **为什么不在本文件里写字面**：判据⑤（总体出处普查）要认的正是「入口名紧跟 `({`」那种形状，
 * 而本文件里那些形状是**夹具的源码**、不是真的调用⇒ 它不该被当成一道门。
 * 拼出来之后，判据读到的是同一段文本、同一套形状，而本文件的字节里没有那个记号。
 */
const gateCall = (entry: string, arg: string): string => `${entry}({ ${arg}, registerFile: REGISTER_FILE })`

/** 豁免理由的地板：短于这个长度就说不出「它为什么读不到行」 */
const LONG_WHY = '它指着一笔已经换过号的旧债，正册里读不到它是实情，不是漏登；理由与证据写在别的号那一行里。'

describe('按号这一族读的是哪片总体（KI-329）：判据的合成夹具腿', () => {
  describe('判据①：门读到的文件集必须逐份等于交付总体（两个方向都要）', () => {
    const surface = ['a.ts', 'b.ts', 'c.ts']

    it('两边一致 ⇒ 两个差集都空', () => {
      expect(populationFindings({ scanned: surface, surface })).toEqual([])
    })

    it('少读一份 ⇒ 红（那句「每一处」在这一份上是空话：没看过的引用不会变红）', () => {
      const findings = populationFindings({ scanned: ['a.ts', 'b.ts'], surface })
      expect(findings.length).toBe(1)
      expect(findings[0].msg).toContain('没读')
    })

    it('多读一份（总体之外的东西）⇒ 红（两份口径迟早分家）', () => {
      const findings = populationFindings({ scanned: [...surface, 'd.ts'], surface })
      expect(findings.length).toBe(1)
      expect(findings[0].msg).toContain('之外')
    })
  })

  describe('判据②：洞不许悄悄长大（洞长大与登记过期都红）', () => {
    const holes = [{ area: '.scratch', why: '证据区：各车道的量具与变异臂落地处。' }]

    it('多出一个没登记的面积 ⇒ 红（那个面积里的按号引用没人读）', () => {
      const findings = holeFindings({ tracked: ['.scratch/a.mjs', 'tools/b.ts'], surface: [], holes })
      expect(findings.length).toBe(1)
      expect(findings[0].msg).toContain('tools')
    })

    it('名册登记的洞今天一份文件都没有 ⇒ 红（登记过期：那个面积被搬走了或被接进总体了）', () => {
      const findings = holeFindings({ tracked: [], surface: [], holes })
      expect(findings.length).toBe(1)
      expect(findings[0].msg).toContain('过期')
    })

    it('名册与实况一致 ⇒ 空', () => {
      expect(holeFindings({ tracked: ['.scratch/a.mjs'], surface: [], holes })).toEqual([])
    })
  })

  describe('判据③：带按号引用的已入库文件不许落在走查面之外', () => {
    const holes = [{ area: '.scratch', why: '证据区：各车道的量具与变异臂落地处。' }]
    const cited = { rel: 'docs/某.md', text: `这里按号引用了 ${ghost('111')}。` }

    it('载体逃出走查面 ⇒ 红（读者按号去找账，这条引用既没人检查也没人看见）', () => {
      const findings = carrierFindings({ tracked: [cited], scanned: [], holes })
      expect(findings.length).toBe(1)
      expect(findings[0].msg).toContain(ghost('111'))
    })

    it('落在有名字有理由的洞里 ⇒ 绿', () => {
      const findings = carrierFindings({ tracked: [{ rel: '.scratch/a.mjs', text: cited.text }], scanned: [], holes })
      expect(findings).toEqual([])
    })

    it('不带按号引用的文件不在走查面 ⇒ 绿（它不需要被按号规则读）', () => {
      expect(carrierFindings({ tracked: [{ rel: 'docs/某.md', text: '这份文件不带按号引用。' }], scanned: [], holes })).toEqual([])
    })
  })

  describe('判据④：账本自己引的号也要读得到行（账本不是读者的例外）', () => {
    const live = ghost('010')
    const dangling = ghost('900')
    const ledgerText = `账本自己引着 ${live} 与 ${dangling}。`
    const base = {
      ledgerText,
      rowIds: [live],
      ledgerRel: LEDGER_REL,
      registerRel: REGISTER_REL,
      surfaceFiles: [] as { rel: string; text: string }[],
    }

    it('账本引着一个读不到行的号而没登记 ⇒ 红', () => {
      const findings = ledgerSelfFindings({ ...base, exempt: [] })
      expect(findings.length).toBe(1)
      expect(findings[0].msg).toContain(dangling)
    })

    it('登记了且理由说得清 ⇒ 绿', () => {
      expect(ledgerSelfFindings({ ...base, exempt: [{ token: dangling, why: LONG_WHY }] })).toEqual([])
    })

    it('理由短到说不出它为什么读不到行 ⇒ 红（这一格在给一笔没人认领的悬空引用发通行证）', () => {
      const findings = ledgerSelfFindings({ ...base, exempt: [{ token: dangling, why: '短' }] })
      expect(findings.length).toBe(1)
      expect(findings[0].msg).toContain('理由')
    })

    it('登记过期（账本今天根本没引它）⇒ 红', () => {
      const findings = ledgerSelfFindings({ ...base, exempt: [{ token: ghost('901'), why: LONG_WHY }] })
      expect(findings.map((f) => f.msg).join('\n')).toContain('过期')
    })

    it('号复活了（正册里现在读得到那一行）⇒ 登记过期 ⇒ 红', () => {
      const findings = ledgerSelfFindings({ ...base, exempt: [{ token: live, why: LONG_WHY }] })
      expect(findings.map((f) => f.msg).join('\n')).toContain('过期')
    })

    it('登记过的号在账本以外被人当现行号引用 ⇒ 红（有人按一个空号去找账）', () => {
      const findings = ledgerSelfFindings({
        ...base,
        exempt: [{ token: dangling, why: LONG_WHY }],
        surfaceFiles: [{ rel: 'docs/某.md', text: `这里引了 ${dangling}` }],
      })
      expect(findings.map((f) => f.msg).join('\n')).toContain('现行号')
    })
  })

  describe('判据⑤：喂给按号判据的文件集只有两个合法出处', () => {
    // **地板与分类分开判**：这一组腿只判「来源分类对不对」，「吃交付总体的门至少有几处」是另一格
    // （真库那一腿 + 「门少了」那一腿）。合成夹具是单份文件，天然凑不出默认的地板 3 ⇒
    // 在夹具腿上用默认地板等于**尺子不对**（那不是病），所以这里显式给地板。
    for (const entry of GATE_ENTRIES) {
      it(`真库那一腿吃交付总体 ⇒ 绿（${entry}）`, () => {
        const src = [
          'const surface = deliverySurface(root)',
          'const files = surface.files',
          gateCall(entry, 'files'),
        ].join('\n')
        // 地板 1：这一处若被判成「合成夹具」，owners 就是 0 ⇒ 地板那一条会红 ⇒ 这一腿就绿得没有意义。
        const findings = populationSourceFindings({ files: [{ rel: 'tests/unit/某.test.ts', text: src }], minGates: 1 })
        expect(findings).toEqual([])
      })

      it(`就地拼出来的合成夹具 ⇒ 绿：不是第三样东西（${entry}）`, () => {
        const src = [
          "const files = [{ rel: 'docs/某.md', text: '某' }]",
          gateCall(entry, 'files'),
        ].join('\n')
        const findings = populationSourceFindings({ files: [{ rel: 'tests/unit/某.test.ts', text: src }], minGates: 0 })
        expect(findings).toEqual([])
      })

      it(`合成夹具不算一份交付总体（真库那三处才是）（${entry}）`, () => {
        const src = [
          "const files = [{ rel: 'docs/某.md', text: '某' }]",
          gateCall(entry, 'files'),
        ].join('\n')
        // 地板 1：合成夹具若被当成交付总体，owners 就是 1 ⇒ 真库那一腿「三个入口一个都不少」就成了夹具凑出来的。
        const findings = populationSourceFindings({ files: [{ rel: 'tests/unit/某.test.ts', text: src }], minGates: 1 })
        expect(findings.length, '合成夹具被当成了交付总体 ⇒ 真库那三处的地板会被夹具凑出来').toBe(1)
        expect(findings[0].msg).toContain('一处都没有')
      })

      it(`自己抄了一份清单 ⇒ 红：那是第三样东西（${entry}）`, () => {
        const src = [
          'const scanFiles = handCopiedList()',
          'const files = scanFiles',
          gateCall(entry, 'files'),
        ].join('\n')
        const findings = populationSourceFindings({ files: [{ rel: 'tests/unit/某.test.ts', text: src }], minGates: 0 })
        expect(findings.length).toBe(1)
        expect(findings[0].msg).toContain('第三样东西')
      })
    }

    it('门少了 ⇒ 红（某一扇门把自己的总体丢了，或者某道门整个没了）', () => {
      const src = [
        'const surface = deliverySurface(root)',
        'const files = surface.files',
        gateCall(GATE_ENTRIES[0], 'files'),
      ].join('\n')
      const findings = populationSourceFindings({ files: [{ rel: 'tests/unit/某.test.ts', text: src }], minGates: 3 })
      expect(findings.length).toBe(1)
      expect(findings[0].msg).toContain('地板 3')
    })
  })

  describe('面积归堆：一份文件落在总体之外时属于哪一堆', () => {
    it('根上的点文件 ⇒ (根点文件)（走查对点前缀是瞎的，那是有理由的洞）', () => {
      expect(holeArea('.gitignore')).toBe('(根点文件)')
    })

    it('根上的具名散文件 ⇒ (根散文件)（它掉出总体就红，不许被点文件那一格顺带放行）', () => {
      expect(holeArea('vite.config.ts')).toBe('(根散文件)')
    })

    it('其余按第一段路径归堆', () => {
      expect(holeArea('.scratch/ki329_x.mjs')).toBe('.scratch')
      expect(holeArea('docs/某.md')).toBe('docs')
    })
  })

  describe('按号引用的形状：一份文件里带着哪些号', () => {
    it('同一个号出现多次只算一个，且按字典序排', () => {
      expect(citedIds(`引了 ${ghost('222')} 又引了 ${ghost('111')}，再说一次 ${ghost('222')}`)).toEqual([
        ghost('111'),
        ghost('222'),
      ])
    })

    it('不带号的那份文件读出空集（不是「读不到」）', () => {
      expect(citedIds('这份文件不带按号引用。')).toEqual([])
    })
  })
})

describe('按号这一族读的是哪片总体（KI-329）：真库腿', () => {
  const surface = deliverySurface(root)
  const tracked = trackedFiles(root)
  const ledgerText = readFileSync(`${root}/${LEDGER_REL}`, 'utf8')
  const rowIds = ledgerRows(ledgerText).map((r) => r.id)
  const surfaceRels = surface.files.map((f) => f.rel)
  const trackedRels = tracked.files.map((f) => f.rel)
  const surfaceSet = new Set(surfaceRels)

  it('交付总体非退化：四棵树 ＋ 根的具名散文件都在，没有哪一片塌掉', () => {
    expect(surface.files.length, `交付总体只读到 ${surface.files.length} 份文件 = 扫描面塌了`).toBeGreaterThanOrEqual(500)
    expect(surface.missing, '交付总体少了目录（那一片的文本没人扫）').toEqual([])
    expect(surface.binaries, '总体里混进了二进制（它没有文本可扫）').toEqual([])
    expect(surface.unreadable.length, `总体里有 ${surface.unreadable.length} 份文件不是合法 UTF-8（读不出来的引用不会变红，绿是白送的）`).toBe(0)
    const perTree = new Map<string, number>()
    for (const f of surface.files) {
      const tree = f.rel.includes('/') ? f.rel.split('/')[0] : '(根散文件)'
      perTree.set(tree, (perTree.get(tree) ?? 0) + 1)
    }
    for (const tree of ['docs', 'src', 'tests', 'scripts', '(根散文件)']) {
      expect(perTree.get(tree) ?? 0, `${tree} 一份文件都没读到 = 那一片整个没进总体，未登记的号可以藏在里面`).toBeGreaterThanOrEqual(1)
    }
  })

  it('已入库名册与工作树同底：没有「提交过但这棵树里没有」的文件（否则它会变成一个假的洞）', () => {
    expect(tracked.files.length, `已入库名册只读到 ${tracked.files.length} 份 = 名册读空了`).toBeGreaterThanOrEqual(500)
    expect(tracked.absent, '这些文件提交过但此刻不在工作树里 ⇒ 它们会变成一个假的「洞」，把判据②红成噪声').toEqual([])
    expect(tracked.binaries, '已入库名册里混进了二进制').toEqual([])
    expect(tracked.unreadable.length, `已入库名册里有 ${tracked.unreadable.length} 份文件读不出来`).toBe(0)
  })

  it('判据①：交付总体与**另一个模块**的总体口径逐份相等（两个方向的差集都空）', () => {
    // **尺子必须是另一个模块的口径**：拿 `deliverySurface` 跟**它自己**比差集永远是空的（同义反复）——
    // 差集要量得出来，两边得是**各自独立的**两份清单。
    // 对面拿 `scripts/text-corpus.mjs` 的 `walkTextCorpus`：那是 `text-integrity` 那道门骑着的总体口径，
    // 与 `deliverySurface` 是**两个模块、两份契约**（这一份给 `rel`+`text` 并把读不出来的单列，
    // 那一份给 `file`+`bytes` 并把它们留在正文里）⇒ 对不齐就是有一边改了而另一边没跟上。
    // **不能**在测试里再手抄一份走查：总体清单手抄正是 KI-329 那条病（后缀漏掉 ⇒ 没人看见 ⇒ 绿是白送的）。
    const walked = walkTextCorpus(root)
    const walkedRels = walked.files.map((f) => f.file).sort()
    const findings = populationFindings({ scanned: walkedRels, surface: [...surfaceRels].sort() })
    expect(findings.map((f) => `【${f.key}】${f.msg}`).join('\n')).toBe('')
    expect([...walked.binaries].sort(), '两边的二进制口径不一致（一份说二进制、另一份说文本）').toEqual(
      [...surface.binaries].sort(),
    )
    expect(walked.missing, 'text-corpus 的名册里有目录不在仓库里（那一片的文本没人扫）').toEqual([])
  })

  it('判据①的载体：以前三类「没人看」的文件今天都在总体里，而根上的点文件仍然是有名字的洞', () => {
    // 这三行是 KI-329 那条病**具体**的样子：手抄的后缀清单（`.ts|.tsx|.mjs|.md|.json`）看不见
    // `scripts/*.d.mts`、看不见根上的具名散文件、看不见 `scripts/` 里的 `.py`——
    // 看不见的引用不会变红，绿是白送的。今天它们必须**逐份点名**在总体里。
    expect(surfaceSet.has('scripts/id-scope-rules.d.mts'), '.d.mts 这一类不在总体里（旧的后缀清单里没有它）').toBe(true)
    expect(surfaceSet.has('vite.config.ts'), '根上的具名散文件不在总体里（而 vite.config.ts 带着 2 处按号引用）').toBe(true)
    expect(surfaceSet.has('scripts/gen_initial_data.py'), 'scripts/ 里的 .py 不在总体里（旧的后缀清单里没有它）').toBe(true)
    expect(surfaceSet.has('.gitignore'), '根上的点文件进了总体 —— 它是一处有名字的洞（走查对点前缀是瞎的）').toBe(false)
  })

  it('判据②：洞的名册两个方向都空（没有新面积，也没有过期登记）', () => {
    const findings = holeFindings({ tracked: trackedRels, surface: surfaceRels, holes: NAMED_HOLES })
    expect(findings.map((f) => `【${f.key}】${f.msg}`).join('\n')).toBe('')
    expect(NAMED_HOLES.length, '洞的名册空了 = 那两个洞的来历没人记了').toBeGreaterThanOrEqual(2)
    for (const h of NAMED_HOLES) {
      expect(h.why.length, `洞「${h.area}」的理由短到说不出谁经过它`).toBeGreaterThanOrEqual(40)
    }
  })

  it('判据③：带按号引用的已入库文件没有逃出走查面', () => {
    const findings = carrierFindings({ tracked: tracked.files, scanned: surfaceRels, holes: NAMED_HOLES })
    expect(findings.map((f) => `【${f.key}】${f.msg}`).join('\n')).toBe('')
  })

  it('判据④：账本自己引的号都读得到行（豁免名册逐条自证）', () => {
    const findings = ledgerSelfFindings({
      ledgerText,
      rowIds,
      exempt: SELF_EXEMPT,
      ledgerRel: LEDGER_REL,
      registerRel: REGISTER_REL,
      surfaceFiles: tracked.files,
    })
    expect(findings.map((f) => `【${f.key}】${f.msg}`).join('\n')).toBe('')
  })

  it('判据④的读数：账本自己读不到行的号，恰好是豁免名册登记的那些（两个方向都对得上）', () => {
    const dangling = citedIds(ledgerText).filter((id) => !rowIds.includes(id)).sort()
    const booked = SELF_EXEMPT.map((e) => e.token).sort()
    expect(dangling, '账本自己引着这些号而正册里读不到行，而豁免名册没登记它们').toEqual(booked)
  })

  it('判据⑤：按号判据吃的文件集只有两个合法出处，且三个入口一个都不少', () => {
    const findings = populationSourceFindings({ files: surface.files })
    expect(findings.map((f) => `【${f.key}】${f.msg}`).join('\n')).toBe('')
    const owners = new Set<string>()
    for (const f of surface.files) {
      if (!f.rel.startsWith('tests/')) continue
      for (const s of populationSites(f.text)) owners.add(`${f.rel} :: ${s.kind}`)
    }
    expect(owners.size, '按号这一族的入口少了一个 = 某道门把自己的总体丢了').toBeGreaterThanOrEqual(3)
    expect([...owners].sort(), '按号这一族的入口少了一个 = 某道门把自己的总体丢了').toEqual(
      expect.arrayContaining([
        'tests/unit/doc-audit.test.ts :: 自扫引用的循环',
        'tests/unit/id-table.test.ts :: retiredSpellingFindings',
        'tests/unit/registry-table.test.ts :: idReferenceFindings',
      ]),
    )
  })

  it('四条判据合流：今天的仓库上零读数', () => {
    const findings = scopeFindings({
      scanned: surfaceRels,
      surface: surfaceRels,
      tracked: tracked.files,
      holes: NAMED_HOLES,
      ledgerText,
      rowIds,
      exempt: SELF_EXEMPT,
      ledgerRel: LEDGER_REL,
      registerRel: REGISTER_REL,
    })
    expect(findings.map((f) => `【${f.key}】${f.msg}`).join('\n')).toBe('')
  })
})
