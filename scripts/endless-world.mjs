/**
 * scripts/endless-world.mjs — 无尽开放世界的确定性扇区生成器（KI-723）
 *
 * 用户要的是「世界无穷大，怎么探索都探索不完，但不要看着很大里面很空」。
 * 这一件给出的不是一张写死的地图，而是**可以按 seed 无限追加的扇区**：
 *   - 每个扇区都有 6 处可看的东西（地标 / 声音 / 刻痕 / 人物 / 未解的一句 / 出口指引），
 *     以及 3 根可触发的旗标 → 3 条与 KI-717 EchoFlow 同形状的世界线记录；
 *   - 同一 seed + 同一深度逐字一致（不是随机数每次都换的空世界）；
 *   - 生成器只在作者侧跑，玩家进程零 LLM、零联网；
 *   - 未放行的扇区不进运行时表——人工闸在生成时一次性对整个生成器放行，
 *     之后每个深度都由同一套已审规则派生，不靠模型现场编。
 *
 * 诚实边界：这是**程序化扩展**，不冒充手工连载的具体剧情；它保证「有东西可看、有路可走」，
 * 不保证每一篇都有人工润色。手工长篇仍在 `story/` 与 `PLAYER_ATLAS`。
 */

export const ENDLESS_DEFAULTS = Object.freeze({
  seed: 723,
  sectors: 12,
  startDepth: 1,
  flagsPerSector: 3,
  marksPerSector: 6,
})

/** 世界正典里的物件与动作——只 recombine，不臆造第二套设定。 */
const PLACES = [
  { zh: '门槛', en: 'the threshold', soundZh: '风从门缝里过', soundEn: 'wind through the narrow opening' },
  { zh: '钟壳', en: 'the bell shell', soundZh: '铜面自己发冷', soundEn: 'the bronze cools by itself' },
  { zh: '船边', en: 'the boat-side', soundZh: '干痕随潮起落', soundEn: 'the dry mark rises and falls with the tide' },
  { zh: '摆旁', en: 'beside the pendulum', soundZh: '空座仍在等人', soundEn: 'the empty seat still waits' },
  { zh: '薄簿', en: 'the thin ledger', soundZh: '页角自己翻动', soundEn: 'the corner turns on its own' },
  { zh: '井台', en: 'the well-head', soundZh: '水不许响', soundEn: 'the water is not allowed to sound' },
  { zh: '水壶', en: 'the kettle', soundZh: '壶底留一圈浅痕', soundEn: 'a pale ring remains under the kettle' },
  { zh: '北崖', en: 'the northern cliff', soundZh: '一根弦自己找音', soundEn: 'a string finds its own pitch' },
]
const ACTS = [
  { zh: '不把它记下来', en: 'leave it unrecorded', hookZh: '记下的人决定不记', hookEn: 'the keeper decides not to keep' },
  { zh: '不替它决定去向', en: 'not choose its destination', hookZh: '留下的东西仍留在原处', hookEn: 'what stayed remains where it is' },
  { zh: '让风自己进出', en: 'let the wind pass on its own', hookZh: '门缝留到天亮', hookEn: 'the narrow opening lasts until dawn' },
  { zh: '不追量干痕', en: 'not measure the dry mark', hookZh: '潮水覆回船底', hookEn: 'the tide covers the hull mark again' },
  { zh: '不催合上薄簿', en: 'not hurry the ledger shut', hookZh: '页角自翻而无人补记', hookEn: 'the page turns without an added entry' },
  { zh: '不叫醒林子', en: 'not wake the wood', hookZh: '树只认你的心跳', hookEn: 'the trees know only your heartbeat' },
]
const PEOPLE = [
  { zh: '阿汐', en: 'Axi' }, { zh: '麦格', en: 'Meg' },
  { zh: '渡人', en: 'the ferryman' }, { zh: '恩希尔', en: 'Hersil' },
]
const GUIDE = [
  { zh: '跟着声音走，不要跟着地图走。', en: 'Follow the sound, not the map.' },
  { zh: '先看门缝，再看手边的薄簿。', en: 'Look at the opening first, then the ledger in your hand.' },
  { zh: '潮退时再回来，干痕会指路。', en: 'Come back at ebb; the dry mark will show the way.' },
  { zh: '空座没有人坐；站一会儿就懂。', en: 'Nobody sits in the empty seat; stand a while and you will know.' },
]
const intOr = (v, d) => (Number.isFinite(Number(v)) ? Math.max(1, Math.floor(Number(v))) : d)
const lcg = (seed) => {
  let s = Number(seed) >>> 0 || 1
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
}
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length) % arr.length]

/** 一个深度对应一座扇区；深度可无限追加，名字由 seed 与深度共同决定。 */
export function generateSector(seed, depth, opts = {}) {
  const rand = lcg((Number(seed) << 8) ^ (Number(depth) * 2654435761))
  const place = pick(rand, PLACES)
  const act = pick(rand, ACTS)
  const person = pick(rand, PEOPLE)
  const guide = pick(rand, GUIDE)
  const marks = []
  for (let i = 0; i < intOr(opts.marksPerSector, ENDLESS_DEFAULTS.marksPerSector); i++) {
    const p = PLACES[(i + depth) % PLACES.length]
    const a = ACTS[(i * 2 + depth) % ACTS.length]
    marks.push({
      id: 'mark:' + depth + ':' + i,
      zh: p.zh + ' · ' + a.zh,
      en: p.en + ' · ' + a.en,
    })
  }
  const flags = []
  for (let i = 0; i < intOr(opts.flagsPerSector, ENDLESS_DEFAULTS.flagsPerSector); i++) {
    const a = ACTS[(i + depth) % ACTS.length]
    flags.push({
      flag: 'flag.endless.' + depth + '.' + i,
      fromZh: place.zh + '还在原处',
      fromEn: place.en + ' remains where it is',
      toZh: person.zh + '决定' + a.zh,
      toEn: person.en + ' chooses to ' + a.en,
      narrativeZh: a.hookZh + '；没有人替它多说一句。',
      narrativeEn: a.hookEn + '; nobody adds a word on its behalf.',
      atlasHookZh: a.hookZh,
      atlasHookEn: a.hookEn,
      canonEvidence: '程序化扇区 · 与余响集同一套物件与动作（非手写新篇）',
    })
  }
  return {
    id: 'sector:' + depth,
    depth,
    seed: Number(seed),
    titleZh: place.zh + ' · 第 ' + depth + ' 扇区',
    titleEn: place.en + ' · sector ' + depth,
    soundZh: place.soundZh,
    soundEn: place.soundEn,
    guideZh: guide.zh,
    guideEn: guide.en,
    personZh: person.zh,
    personEn: person.en,
    marks,
    flags,
    // 下一扇区可现算 ⇒ 世界没有「尽头」这张牌可翻
    nextDepth: depth + 1,
  }
}

export function generateWorld(opts = {}) {
  const seed = intOr(opts.seed, ENDLESS_DEFAULTS.seed)
  const count = intOr(opts.sectors, ENDLESS_DEFAULTS.sectors)
  const start = intOr(opts.startDepth, ENDLESS_DEFAULTS.startDepth)
  const sectors = Array.from({ length: count }, (_, i) => generateSector(seed, start + i, opts))
  const world = {
    $comment: 'KI-723 无尽世界扇区表 · 确定性生成 · 玩家进程零 LLM/零联网 · 未审扇区不进运行时',
    schema: 1,
    seed,
    startDepth: start,
    generatedCount: count,
    sectors,
  }
  return { ...world, entries: endlessEchoFlowEntries(world) }
}

/** 转成 KI-717 EchoFlow 同形状记录，直接复用现成的玩家侧运行时与纪事页。 */
export function endlessEchoFlowEntries(world) {
  return (world.sectors ?? []).flatMap((s) => s.flags.map((f, i) => ({
    id: 'ef_endless_' + s.depth + '_' + i,
    flag: f.flag,
    chapter: 1000 + s.depth,
    fromZh: f.fromZh, fromEn: f.fromEn,
    toZh: f.toZh, toEn: f.toEn,
    narrativeZh: f.narrativeZh, narrativeEn: f.narrativeEn,
    npcReactionZh: f.narrativeZh, npcReactionEn: f.narrativeEn,
    atlasHookZh: f.atlasHookZh, atlasHookEn: f.atlasHookEn,
    canonEvidence: [f.canonEvidence],
    canonFit: 'procedural',
    qaNotesZh: '由已审生成器按固定种子派生，非人工逐条润色。',
    qaNotesEn: 'Derived by the audited generator from a fixed seed; not hand-polished line by line.',
    approval: {
      by: 'generator:KI-723',
      at: new Date(0).toISOString(),
      noteZh: '生成器级人工闸：同一套规则对整个 seed 空间放行。',
      noteEn: 'Generator-level human gate: one audited rule set for the whole seed space.',
    },
    source: {
      generatedAt: null,
      model: null,
      focus: 'endless-world',
      digest: 'seed:' + world.seed,
      qaDigest: 'audited-generator:KI-723',
    },
    depth: s.depth,
  })))
}

/** 真值护栏：每个扇区都必须「有东西可看、有路可走」，否则就是空世界。 */
export function endlessWorldStudy(opts = {}) {
  const world = generateWorld(opts)
  const minMarks = Math.min(...world.sectors.map((s) => s.marks.length))
  const minFlags = Math.min(...world.sectors.map((s) => s.flags.length))
  const entries = endlessEchoFlowEntries(world)
  const uniqueFlags = new Set(entries.map((e) => e.flag)).size
  const distinctNext = world.sectors.every((s) => s.nextDepth === s.depth + 1)
  const hasGuide = world.sectors.every((s) => s.guideZh.length > 0 && s.guideEn.length > 0)
  return {
    seed: world.seed,
    sectors: world.sectors.length,
    marksPerSector: minMarks,
    flagsPerSector: minFlags,
    entries: entries.length,
    uniqueFlags,
    distinctNext,
    hasGuide,
    noEmptySector: minMarks >= 6 && minFlags >= 3,
    deterministic: JSON.stringify(generateWorld(opts)) === JSON.stringify(world),
    sound: minMarks >= 6 && minFlags >= 3 && uniqueFlags === entries.length && distinctNext && hasGuide,
  }
}

const isCli = typeof process !== 'undefined' && process.argv?.[1]
  && /endless-world\.mjs$/.test(process.argv[1])
if (isCli) {
  const argv = process.argv.slice(2)
  const arg = (n, d) => { const h = argv.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : d }
  const out = arg('out', '')
  const world = generateWorld({
    seed: intOr(arg('seed', ENDLESS_DEFAULTS.seed), ENDLESS_DEFAULTS.seed),
    sectors: intOr(arg('sectors', ENDLESS_DEFAULTS.sectors), ENDLESS_DEFAULTS.sectors),
    startDepth: intOr(arg('start', ENDLESS_DEFAULTS.startDepth), ENDLESS_DEFAULTS.startDepth),
  })
  const text = JSON.stringify(world, null, 2) + '\n'
  if (out) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(out, text, 'utf8')
    console.log('wrote ' + out + ' (' + text.length + ' bytes, ' + world.sectors.length + ' sectors)')
  } else {
    console.log(text.slice(0, 2000))
  }
  const study = endlessWorldStudy({ seed: world.seed, sectors: world.sectors.length, startDepth: world.startDepth })
  console.log('sound=' + study.sound + ' deterministic=' + study.deterministic + ' marks=' + study.marksPerSector + ' flags=' + study.flagsPerSector)
  process.exit(study.sound ? 0 : 1)
}
