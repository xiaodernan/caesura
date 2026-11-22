/**
 * admin/adoption.mjs — 功能采纳读数（KI-739）· 纯函数 · 零依赖 · 可单测。
 *
 * 为什么单独一个模块：`admin/app.js` 是"把读数画出来"的那一层，它一变就没人敢断言数字对不对。
 * 这里只吃**事件数组**（`public/tracker.js` 写进本机环形缓冲的那些），吐出**可复算的读数**；
 * 画不画、怎么画不归它管。
 *
 * 三条诚实纪律（这一屏最容易骗人的地方）：
 *   1. **分母为零不许变出 0%**：没人开过深处时 `opensPerView` 是 `null`，不是 `0`——
 *      「没人来过」与「来了但没人点」是两件完全不同的事，混成一个 0 会让下一条建议指错方向。
 *   2. **环形缓冲有上限**：`tracker.js` 只留最近 400 条 ⇒ 这是「最近 400 条里的读数」，
 *      不是全量；`capacity` 与 `windowed` 一并交出去，页面必须写出来。
 *   3. **样本太小只说样本小**：少于 `MIN_SAMPLE` 次浏览时不产出"采纳率"结论，只说计数。
 *
 * 字段白名单与 `public/tracker.js > __caesuraTrack` 一一对应：`type / dep / region / q / path / t`。
 */

/** 环形缓冲容量（与 public/tracker.js 里那个 400 必须一致；测试会钉住） */
export const TELEMETRY_CAPACITY = 400

/** 低于这个浏览数就不谈比率（只报计数） */
export const MIN_SAMPLE = 20

const isObj = (v) => v !== null && typeof v === 'object'

/**
 * @param {unknown} events 事件数组（可以来自 localStorage 的 `events`）
 * @param {object} [opts]
 * @returns {{
 *   sample:number, windowed:boolean, capacity:number, confident:boolean,
 *   opens:number, acts:number, descents:number, deepest:number,
 *   floors:Array<{dep:number,count:number}>, echoes:{total:number, regions:Array<{region:string,count:number}>},
 *   pageviews:number, opensPerView:(number|null),
 *   firstAt:(number|null), lastAt:(number|null)
 * }}
 */
export function adoption(events, opts = {}) {
  const list = Array.isArray(events) ? events : []
  const capacity = Number.isFinite(opts.capacity) ? Number(opts.capacity) : TELEMETRY_CAPACITY
  const minSample = Number.isFinite(opts.minSample) ? Number(opts.minSample) : MIN_SAMPLE

  let opens = 0
  let acts = 0
  let descents = 0
  let pageviews = 0
  let deepest = 0
  let firstAt = null
  let lastAt = null
  const floors = new Map()
  const regions = new Map()

  for (const ev of list) {
    if (!isObj(ev) || typeof ev.type !== 'string') continue
    const t = Number.isFinite(ev.t) ? Number(ev.t) : null
    if (t !== null) {
      if (firstAt === null || t < firstAt) firstAt = t
      if (lastAt === null || t > lastAt) lastAt = t
    }
    const dep = Number.isFinite(ev.dep) ? Math.max(1, Math.floor(Number(ev.dep))) : null
    switch (ev.type) {
      case 'descend-open':
        opens += 1
        if (dep !== null && dep > deepest) deepest = dep
        break
      case 'descend-floor':
        descents += 1
        if (dep !== null) {
          floors.set(dep, (floors.get(dep) ?? 0) + 1)
          if (dep > deepest) deepest = dep
        }
        break
      case 'descend-act':
        acts += 1
        if (dep !== null && dep > deepest) deepest = dep
        break
      case 'echo-shown':
        if (typeof ev.region === 'string' && ev.region) {
          regions.set(ev.region, (regions.get(ev.region) ?? 0) + 1)
        } else {
          regions.set('(unknown)', (regions.get('(unknown)') ?? 0) + 1)
        }
        break
      case 'pageview':
        pageviews += 1
        break
      default:
        break
    }
  }

  const echoTotal = [...regions.values()].reduce((a, b) => a + b, 0)
  const floorList = [...floors.entries()]
    .map(([dep, count]) => ({ dep, count }))
    .sort((a, b) => b.dep - a.dep)
  const regionList = [...regions.entries()]
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => b.count - a.count || a.region.localeCompare(b.region))

  return {
    sample: list.length,
    // 缓冲满 ⇒ 这份读数只覆盖最近 capacity 条，不是全量
    windowed: list.length >= capacity,
    capacity,
    confident: pageviews >= minSample,
    opens,
    acts,
    descents,
    deepest,
    floors: floorList,
    echoes: { total: echoTotal, regions: regionList },
    pageviews,
    // 分母为零 ⇒ null（「没人来过」不等于「来了没人点」）
    opensPerView: pageviews > 0 ? opens / pageviews : null,
    firstAt,
    lastAt,
  }
}

/** 人话：比率 → 「12.5%」；null → 「—」（页面用它，不许自己再写一遍 0） */
export function pctOrDash(rate) {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return '—'
  return (Math.round(rate * 1000) / 10).toFixed(1) + '%'
}
