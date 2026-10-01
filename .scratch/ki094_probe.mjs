/**
 * KI-094② 的变异探针。跑在**平面**上（`.scratch/ki094_plane` = `git archive HEAD` + 我的文件），
 * 所以 mutating 的是平面里的副本，共享工作树一个字都不碰——并发会话正在写同一批 tracked 文件。
 *
 * 预测在跑之前写死在这里（改一条预测要改一次 commit，不许跑完再补）。
 * 每臂只改一个形状；红的归属用**案例名里的独特子串**匹配，两种偏差都单独印出来：
 *  · SURVIVOR ＝ 预测要红而没红 ⇒ 我自己的门有洞；
 *  · EXTRA    ＝ 没预测却红了 ⇒ 预测的口径写错了（也可能抓到真缺陷）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const PLANE = '.scratch/ki094_plane'
const TESTS = ['tests/unit/weather-switch.test.ts', 'tests/unit/color-grade.test.ts']
const MUTABLE = [
  'src/world/WeatherSwitch.ts',
  'src/vfx/ColorGrade.ts',
  'src/main.ts',
  'scripts/weather-rules.mjs',
  'scripts/validate-data.mjs',
]

const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 16)
const read = (p) => readFileSync(`${PLANE}/${p}`, 'utf8')
const pristine = new Map(MUTABLE.map((p) => [p, Buffer.from(read(p), 'utf8')]))
const restore = () => {
  for (const [p, bytes] of pristine) {
    writeFileSync(`${PLANE}/${p}`, bytes)
    if (sha(Buffer.from(read(p), 'utf8')) !== sha(bytes)) throw new Error(`还原后字节不符：${p}`)
  }
}

const arms = [
  {
    name: 'A1 读者丢掉"这面旗在任务线名册里"这一维（任何立了旗的钟都算修好）',
    file: 'src/world/WeatherSwitch.ts',
    from: `    if (tracked.has(it.setsFlag) && !flags.includes(it.setsFlag)) flags.push(it.setsFlag)`,
    to: `    if (!flags.includes(it.setsFlag)) flags.push(it.setsFlag)`,
    expect: [
      '都在 quests.json 里真的被某个步骤等着',
      '不改天气：「敲响」不是「修复」',
      '逐区逐字相同',
    ],
  },
  {
    name: 'A2 读者丢掉"区域"这一维（全区共用任务线名册里的旗）',
    file: 'src/world/WeatherSwitch.ts',
    from: `  const flags: string[] = []
  for (const it of region.interactables ?? []) {
    if (it.kind !== 'bell' || typeof it.setsFlag !== 'string') continue
    if (tracked.has(it.setsFlag) && !flags.includes(it.setsFlag)) flags.push(it.setsFlag)
  }
  return flags`,
    to: `  const flags: string[] = [...tracked]
  return flags`,
    expect: [
      '其他区纹丝不动',
      '自己的天不变',
      '逐区逐字相同',
      // 订正（第一轮实测 3/4 后写的，不是跑完再补）：原先还预测「拨到第二格（旗数就是格数」会红，
      // 那条合成区的两面旗 `flag.a`/`flag.b` **恰好就是它传给 readers 的 `tracked` 全体**，所以"丢掉区域
      // 这一维"在它那三格上算出的答案与真码一致 ⇒ 这一臂对它没有说话权。它是 A7/A9 的对象，不是 A2 的。
    ],
  },
  {
    name: 'A3 组合根丢掉旗标广播那一条重算（立了旗也不换天）',
    file: 'src/main.ts',
    from: `bus.on('world.flag', () => applyWeather(streaming.regionAt(player.pos) ?? null))`,
    to: `void 0 // A3：广播那条没了`,
    expect: ['赋值点只剩 ColorGrade 一处'],
  },
  {
    name: 'A4 组合根丢掉换区那一次重算（走进另一区天气不跟上）',
    file: 'src/main.ts',
    from: `      applyWeather(here)`,
    to: `      void 0 // A4：换区那次没了`,
    expect: ['赋值点只剩 ColorGrade 一处'],
  },
  {
    name: 'A5 判据丢掉 S1（声明了第二格而没条件 ⇒ 不喊也不许挂账）',
    file: 'scripts/weather-rules.mjs',
    from: `    if (slots > 0 && bells.length === 0) {`,
    to: `    if (false && slots > 0 && bells.length === 0) {`,
    expect: [
      '也没挂账 ⇒ ERROR 指名那一区',
      '换成 WARN（欠账可以挂',
      'WARN 的位点',
      'regions 读空同理',
    ],
  },
  {
    name: 'A6 判据丢掉 `kind === \'bell\'`（任何立了被追踪旗的交互物都当钟）',
    file: 'scripts/weather-rules.mjs',
    from: `    if (!isObj(it) || it.kind !== 'bell' || !isNonEmptyStr(it.setsFlag)) continue`,
    to: `    if (!isObj(it) || !isNonEmptyStr(it.setsFlag)) continue`,
    expect: ['逐区逐字相同', 'WARN 的位点', 'regions 读空同理'],
  },
  {
    name: 'A7 读者丢掉按旗去重（同区两口同旗钟拨两格）',
    file: 'src/world/WeatherSwitch.ts',
    from: `    if (tracked.has(it.setsFlag) && !flags.includes(it.setsFlag)) flags.push(it.setsFlag)`,
    to: `    if (tracked.has(it.setsFlag)) flags.push(it.setsFlag)`,
    expect: ['按**旗**而不是按钟数'],
  },
  {
    name: 'A8 校验器那条名册推导改吃另一个字段（requiresFlag 今天挑出同一批钟）',
    file: 'scripts/validate-data.mjs',
    from: `    .flatMap((s) => isObj(s.advanceOn) && isArr(s.advanceOn.flags) ? s.advanceOn.flags.filter(isStr) : [])`,
    to: `    .flatMap((s) => isStr(s.requiresFlag) ? [s.requiresFlag] : [])`,
    expect: ['结果要等于运行时的名册'],
  },
  {
    name: 'A9 读者丢掉"旗到底立了没有"这一维（有钟就算拨过，不看玩家做没做）',
    file: 'src/world/WeatherSwitch.ts',
    from: `  const rung = repairBellFlags(region, tracked).filter(hasFlag).length`,
    to: `  const rung = repairBellFlags(region, tracked).length`,
    expect: ['每一区奏驻留那一格', '自己的天不变', '拨到第二格（旗数就是格数'],
  },
  {
    name: 'A10 读者丢掉越界夹取（钟比格多时读出 undefined，undefined 在画面那侧等于"没有天气"）',
    file: 'src/world/WeatherSwitch.ts',
    from: `  return presets[Math.min(rung, presets.length - 1)]`,
    to: `  return presets[rung]`,
    expect: ['停在最后一格而不出界'],
  },
]

const runVitest = () => {
  try {
    execFileSync('npx', ['--no-install', 'vitest', 'run', ...TESTS, '--reporter=json', '--outputFile=.scratch_mut.json'],
      { cwd: PLANE, stdio: 'pipe', shell: true })
  } catch { /* 红臂走这里：数字在 JSON 里 */ }
  const j = JSON.parse(readFileSync(`${PLANE}/.scratch_mut.json`, 'utf8'))
  if (!j.numTotalTests) throw new Error('vitest 一条案例都没跑（崩溃在装载期 = 0 证据）')
  return {
    total: j.numTotalTests,
    failed: j.numFailedTests,
    names: (j.testResults || []).flatMap((f) => (f.assertionResults || []).filter((a) => a.status !== 'passed').map((a) => a.fullName)),
  }
}

const runGate = () => {
  let out = ''
  let rc = 0
  try { out = execFileSync('node', ['scripts/validate-data.mjs'], { cwd: PLANE, stdio: 'pipe', encoding: 'utf8' }) }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); rc = e.status ?? -1 }
  const m = out.match(/总计：(\d+) ERROR \/ (\d+) WARN/)
  if (!m) throw new Error(`校验器没有印出汇总行（rc=${rc}）：这一臂的读数不可归因`)
  return { rc, err: Number(m[1]), warn: Number(m[2]) }
}

const lines = []
restore()
const ctrl = runVitest()
const ctrlGate = runGate()
lines.push(`CONTROL 未变异：${ctrl.total} 案例 / ${ctrl.failed} 红，gate ${ctrlGate.err} ERROR / ${ctrlGate.warn} WARN (rc=${ctrlGate.rc})`)
if (ctrl.failed !== 0) throw new Error('对照就是红的：先修底，再谈臂')

for (const arm of arms) {
  restore()
  const text = read(arm.file)
  const hits = text.split(arm.from).length - 1
  if (hits !== 1) { restore(); throw new Error(`${arm.name}：锚点命中 ${hits} 次（要 1 次）—— 臂没打上，读数无意义`) }
  writeFileSync(`${PLANE}/${arm.file}`, text.replace(arm.from, arm.to))
  const r = runVitest()
  const gate = runGate()
  const caught = arm.expect.filter((k) => r.names.some((n) => n.includes(k)))
  const missed = arm.expect.filter((k) => !r.names.some((n) => n.includes(k)))
  const extra = r.names.filter((n) => !arm.expect.some((k) => n.includes(k)))
  const verdict = missed.length === 0 && extra.length === 0 ? 'MATCHED' : missed.length > 0 ? 'SURVIVOR' : 'EXTRA-RED'
  lines.push(`${verdict} ${arm.name}`)
  lines.push(`   红 ${r.failed}/${r.total} 案例；gate ${gate.err} ERROR / ${gate.warn} WARN (rc=${gate.rc})`)
  lines.push(`   预测命中 ${caught.length}/${arm.expect.length}${missed.length ? ' | 存活: ' + missed.join(' ; ') : ''}${extra.length ? ' | 额外红: ' + extra.join(' ; ') : ''}`)
  restore()
}
restore()
const after = runVitest()
lines.push(`还原后复跑：${after.total} 案例 / ${after.failed} 红；字节与平面原状一致（sha 校验通过 ${MUTABLE.length} 份文件）`)
for (const p of MUTABLE) lines.push(`   ${sha(Buffer.from(read(p), 'utf8'))}  ${p}`)

console.log(lines.join('\n'))
