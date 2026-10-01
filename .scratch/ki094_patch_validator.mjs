// 把 KI-094② 对 validate-data.mjs 的两处改动打到「HEAD 版」上（并发会话的武器字段不属于本批，
// 它跟着我的工作副本一起 cp 进平面会让 HEAD 的 schema.ts 报一条不属于我的 ERROR）。
import { readFileSync, writeFileSync } from 'node:fs'

const P = '.scratch/ki094_plane/scripts/validate-data.mjs'
const text = readFileSync(P, 'utf8')
const CR = text.includes('\r\n') ? '\r\n' : '\n'

const reps = [
  {
    from: "import { PENDING_WEATHER_READINGS, WEATHER_FIELDS, weatherFindings } from './weather-rules.mjs'",
    to: "import { PENDING_WEATHER_READINGS, PENDING_WEATHER_SWITCHES, WEATHER_FIELDS, weatherFindings, weatherSwitchFindings } from './weather-rules.mjs'",
  },
  // 锚 = HEAD 里那句 `data[file]`（`rows` 是 `weather-rules.mjs` 自己的参数名，不是这里的形状）
  {
    from: `  for (const f of weatherFindings(file, data[file], docIds, referenced, PENDING_WEATHER_READINGS)) {
    if (f.level === 'warn') report.warn(f.file, f.where, f.msg)
    else report.error(f.file, f.where, f.msg)
  }`,
    to: `  for (const f of weatherFindings(file, data[file], docIds, referenced, PENDING_WEATHER_READINGS)) {
    if (f.level === 'warn') report.warn(f.file, f.where, f.msg)
    else report.error(f.file, f.where, f.msg)
  }
  /*
   * KI-094②：那条切换（\`weatherPresets[1]\`）的条件名册从 \`quests.json\` 现推——**主人是 \`steps[].advanceOn.flags\`**，
   * 手抄一份就等于给这条判据编第二个真源。runtime 那一侧的同名推导在 \`src/world/WeatherSwitch.ts\`，
   * 两边读的是同一份 \`quests.json\`，而"它们今天是不是同一批旗"由 \`tests/unit/weather-switch.test.ts\` 对账。
   */
  const questFlags = (isArr(data['quests.json']) ? data['quests.json'] : []).filter(isObj)
    .flatMap((q) => isArr(q.steps) ? q.steps : []).filter(isObj)
    .flatMap((s) => isObj(s.advanceOn) && isArr(s.advanceOn.flags) ? s.advanceOn.flags.filter(isStr) : [])
  for (const f of weatherSwitchFindings(file, data['regions.json'], questFlags, PENDING_WEATHER_SWITCHES)) {
    if (f.level === 'warn') report.warn(f.file, f.where, f.msg)
    else report.error(f.file, f.where, f.msg)
  }`,
  },
]

// 目标文件自己的行尾才是真的：HEAD 平面里它是 LF，而工作副本被 autocrlf 换成 CRLF
const nl = (s) => s.split('\n').join(CR)
let out = text
for (const [i, r] of reps.entries()) {
  const from = nl(r.from)
  const to = nl(r.to)
  const hits = out.split(from).length - 1
  if (hits !== 1) throw new Error(`rep[${i}]: 期望命中 1 次，实测 ${hits}`)
  if (out.includes(to)) throw new Error(`rep[${i}]: 已经打过，拒绝重复`)
  out = out.replace(from, to)
}
writeFileSync(P, out)
console.log(`OK: 2 hunks applied to HEAD copy, eol=${CR === '\r\n' ? 'CRLF' : 'LF'}, bytes=${out.length}`)
