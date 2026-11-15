/**
 * admin/analytics.mjs — 止音后台 · 分析引擎（纯函数 · 零依赖 · 浏览器与 vitest 双入口）
 *
 * 纪律：
 *  - 不碰 DOM、不碰网络、不碰 localStorage；只接收数据、返回数据。
 *  - 模拟队列（admin/data.js）与本机实况（localStorage）共用同一套派生逻辑。
 *  - 线性外推只是朴素基线（naïve linear baseline），UI 必须标注「仅供方向参考」。
 */

/** mulberry32：固定种子 ⇒ 可复现的 PRNG（生成器与测试都用它） */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function mean(xs) {
  if (!xs.length) return 0
  let s = 0
  for (const x of xs) s += x
  return s / xs.length
}

export function std(xs) {
  if (xs.length < 2) return 0
  const m = mean(xs)
  let s = 0
  for (const x of xs) s += (x - m) * (x - m)
  return Math.sqrt(s / xs.length)
}

/** 简单移动平均；窗口不足时用已有样本（偏置不发生在头部） */
export function movingAverage(xs, window) {
  const out = []
  for (let i = 0; i < xs.length; i++) {
    const from = Math.max(0, i - window + 1)
    out.push(mean(xs.slice(from, i + 1)))
  }
  return out
}

/** 最小二乘；xs 为 0..n-1 下标时可直接当趋势线 */
export function linearRegression(xs, ys) {
  const n = xs.length
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r2: 0 }
  const mx = mean(xs), my = mean(ys)
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy
  }
  const slope = sxx === 0 ? 0 : sxy / sxx
  const intercept = my - slope * mx
  const r2 = syy === 0 ? 1 : Math.max(0, Math.min(1, (sxy * sxy) / (sxx * syy)))
  return { slope, intercept, r2 }
}

/** 对最后 lookback 天做回归，外推 horizon 天；返回含残差 R² 的预测 */
export function forecast(series, { lookback = 14, horizon = 7 } = {}) {
  const ys = series.slice(-Math.min(lookback, series.length))
  const xs = ys.map((_, i) => i)
  const { slope, intercept, r2 } = linearRegression(xs, ys)
  const out = []
  for (let h = 1; h <= horizon; h++) {
    const x = xs.length - 1 + h
    out.push(Math.max(0, Math.round(intercept + slope * x)))
  }
  return { points: out, slope, r2 }
}

/** z 分数异常点：|z| >= threshold 视为 anomalies（含负向崩塌） */
export function anomalies(series, threshold = 1.8) {
  const m = mean(series)
  const s = std(series)
  if (s === 0) return []
  const out = []
  for (let i = 0; i < series.length; i++) {
    const z = (series[i] - m) / s
    if (Math.abs(z) >= threshold) {
      out.push({ index: i, value: series[i], z: Number(z.toFixed(2)), direction: z > 0 ? 'up' : 'down' })
    }
  }
  return out
}

/** 漏斗：每步相对上一步的转化率 + 总转化率 */
export function funnelRates(steps) {
  const rates = []
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1].count
    rates.push(prev > 0 ? steps[i].count / prev : 0)
  }
  const overall = steps.length > 1 && steps[0].count > 0 ? steps[steps.length - 1].count / steps[0].count : 0
  return { stepRates: rates, overall }
}

/** 金额/百分比/秒数的统一格式化（zh / en 一致，避免本地化夹杂） */
export function pct(x, digits = 1) {
  return (x * 100).toFixed(digits) + '%'
}

export function num(x) {
  return Math.round(x).toLocaleString('en-US')
}

export function dur(seconds) {
  const s = Math.round(seconds)
  if (s < 60) return s + 's'
  const m = Math.floor(s / 60)
  return m + 'm' + String(s % 60).padStart(2, '0') + 's'
}

/* ------------------------------------------------------------------ */
/* 诊断引擎：每条规则都直接消费 data.js 的字段，触发才出具               */
/* ------------------------------------------------------------------ */

/**
 * deriveRecommendations(data) → Array<{ id, priority, metric, current, threshold,
 *                                        titleZh, titleEn, actionZh, actionEn }>
 * 排序：P0 → P1 → P2；空数组表示「全部指标处在阈值之上」。
 */
export function deriveRecommendations(data) {
  const recs = []
  const d = data
  const home = (d.pages ?? []).find((p) => p.path === '/')
  const consolePage = (d.pages ?? []).find((p) => p.path === '/console/')
  const ledger = (d.pages ?? []).find((p) => p.path === '/story/ledger/')
  const { stepRates, overall } = funnelRates(d.funnel?.steps ?? [])
  const stepAt = (i) => stepRates[i] ?? 0 // 从 0 开始：stepRates[0] = step2/step1
  const cohorts = d.cohorts ?? []
  const d1 = cohorts.length ? mean(cohorts.map((c) => c.d1)) : 0
  const devices = d.devices ?? []
  const mobile = devices.find((x) => x.id === 'mobile')
  const desktop = devices.find((x) => x.id === 'desktop')
  const hours = d.hourly ?? []
  // 20:00–00:00 集中度（20,21,22,23,0 五个桶）——CN 玩家「深夜钟鸣」窗口
  const peakShare = hours.slice(20, 24).reduce((s, h) => s + h.share, 0) + (hours[0]?.share ?? 0)
  const fc = forecast((d.daily ?? []).map((x) => x.sessions))
  const endingRate = overall

  if (home && home.bounce > 0.55) {
    recs.push({
      id: 'land-bounce', priority: 'P0',
      metric: 'bounce(/)', current: home.bounce, threshold: 0.55,
      titleZh: '首页跳出率 ' + pct(home.bounce, 0) + '，超过 55% 的流失警戒线',
      titleEn: 'Landing bounce ' + pct(home.bounce, 0) + ', past the 55% loss line',
      actionZh: '首屏主 CTA 上方加一条「30 秒 · 四步上手」角标，直链 /tutorial/；CTA 文案改为「入界（新手教程）」',
      actionEn: 'Add a “30 seconds · four moves” badge above the hero CTA, linking to /tutorial/; rename the CTA to “Enter (guide)”',
    })
  }
  if (stepAt(0) < 0.62) {
    recs.push({
      id: 'press-start', priority: 'P0',
      metric: 'funnel[1→2]', current: stepAt(0), threshold: 0.62,
      titleZh: '抵达 → 按下开始 转化仅 ' + pct(stepAt(0)) + '，首屏没有回答「点了会得到什么」',
      titleEn: 'Land → press-start conversion only ' + pct(stepAt(0)) + ' — the first screen never answers “what happens if I press it”',
      actionZh: '在 hero 区下方加一行无感承诺：「开局 4 步学会 · 3 钟头通关一周目 · 不联网 / 零 LLM 调用」',
      actionEn: 'Add a zero-friction promise under the hero: “Four moves to play · one run ≈ 3h · no network / no LLM in player process”',
    })
  }
  if (stepAt(2) < 0.45) {
    recs.push({
      id: 'open-atlas', priority: 'P1',
      metric: 'funnel[3→4]', current: stepAt(2), threshold: 0.45,
      titleZh: '进入世界后只有 ' + pct(stepAt(2)) + ' 的人会打开游记/谱册——内容存在，导航不存在',
      titleEn: 'Only ' + pct(stepAt(2)) + ' open the Atlas/Codex after entering — the content exists, the wayfinding doesn’t',
      actionZh: 'HUD 右上角「谱册」按钮加一角金点 + 两秒一次的呼吸动画，前 10 分钟内 E 键触发时提示「这是你的私人导览」',
      actionEn: 'Give the codex button a gold pip with a slow breath pulse for the first 10 minutes, and hint “your personal tour” on first E',
    })
  }
  if (stepAt(3) < 0.66) {
    recs.push({
      id: 'finish-chapter', priority: 'P1',
      metric: 'funnel[4→5]', current: stepAt(3), threshold: 0.66,
      titleZh: '打开正文后完读率 ' + pct(stepAt(3)) + '——篇十一平均 52%，中途离开的读者没看到门',
      titleEn: 'Finish rate after opening a chapter is ' + pct(stepAt(3)) + ' — Ch.11 averages 52%; readers leave before the door',
      actionZh: '游记页顶部增「入口章节」卡（篇一《盐》+ 篇十一《暗潮》并置），篇十一右上角标「守夜人停在第三拍之后」',
      actionEn: 'Pin an “entry chapters” card at the top of the Atlas (Ch.1 Salt + Ch.11 The Dark Tide), tag Ch.11 “the watcher pauses after the third beat”',
    })
  }
  if (stepAt(4) < 0.45) {
    recs.push({
      id: 'reach-ending', priority: 'P1',
      metric: 'funnel[5→6]', current: stepAt(4), threshold: 0.45,
      titleZh: '完读 → 抵达结局 只有 ' + pct(stepAt(4)) + '；整体完读率 ' + pct(endingRate) + '，大量玩家没见到第三段话',
      titleEn: 'Finished → ending is only ' + pct(stepAt(4)) + '; overall clear rate ' + pct(endingRate) + ' — most never see the third line',
      actionZh: '结局前一场雨后，在未竟厅放置「还有三拍」的环境提示碑；章节末尾的暗示提升到 UI 徽章（不改 dialogue.json）',
      actionEn: 'After the rain before the finale, park an environmental slab in the Unfinished Hall: “three beats remain”; surface the hint as a UI badge (no dialogue.json change)',
    })
  }
  if (d1 < 0.22) {
    recs.push({
      id: 'd1-retention', priority: 'P1',
      metric: 'cohort.d1', current: d1, threshold: 0.22,
      titleZh: '次日留存均值 ' + pct(d1, 0) + '，低于 22% ——「回来还有什么」没有被回答',
      titleEn: 'Mean D1 retention ' + pct(d1, 0) + ', under 22% — “what waits tomorrow?” goes unanswered',
      actionZh: '结局画面加存档槽提示「你还见过 2/5 种结局」+「未竟厅还有三拍」；hub 与 / 首页同步挂「她又多记了一拍」',
      actionEn: 'Add an ending-screen save note “you’ve seen 2/5 endings” + “three beats remain”; mirror the teaser on the hub and landing',
    })
  }
  if (mobile && desktop && mobile.share > 0.55 && mobile.endingRate < desktop.endingRate * 0.65) {
    recs.push({
      id: 'mobile-gap', priority: 'P1',
      metric: 'mobile.endingRate', current: mobile.endingRate, threshold: desktop.endingRate * 0.65,
      titleZh: '移动端占 ' + pct(mobile.share, 0) + '，但完读率只有桌面的 ' + pct(mobile.endingRate / desktop.endingRate, 0) + '——触屏没有引导',
      titleEn: 'Mobile is ' + pct(mobile.share, 0) + ' of sessions but converts at only ' + pct(mobile.endingRate / desktop.endingRate, 0) + ' of desktop — touch gets no guidance',
      actionZh: '小屏 HUD 增加长按=重击提示、左下角虚拟移动盘；首页 CTA 在 <720px 宽度时改为整行大按钮',
      actionEn: 'Show a long-press = heavy-attack hint in the compact HUD, a virtual stick bottom-left; full-width CTA below 720px',
    })
  }
  if (ledger && (ledger.rageClicks ?? 0) > 150) {
    recs.push({
      id: 'rage-ledger', priority: 'P2',
      metric: 'pages[/story/ledger/].rage', current: ledger.rageClicks, threshold: 150,
      titleZh: '篇四《账本》rage-click ' + ledger.rageClicks + ' 次——玩家在点一个不存在的地图',
      titleEn: 'Ch.4 “The Ledger” logged ' + ledger.rageClicks + ' rage-clicks — players tap a map that isn’t there',
      actionZh: '篇四打开 2 秒后浮出一行字：「这是一本没有地图的账——先读第一页」',
      actionEn: 'Two seconds after opening Ch.4, surface one line: “This ledger has no map — read the first page first”',
    })
  }
  if (consolePage && consolePage.bounce > 0.65) {
    recs.push({
      id: 'console-bounce', priority: 'P2',
      metric: 'bounce(/console/)', current: consolePage.bounce, threshold: 0.65,
      titleZh: 'console 跳出率 ' + pct(consolePage.bounce, 0) + '——非运维访客进来只看到一墙读数',
      titleEn: 'Console bounce ' + pct(consolePage.bounce, 0) + ' — non-ops visitors get a wall of readouts',
      actionZh: 'console 顶栏加一行说明「此页为运维可观测面板，玩家请返回 /」，右上角放返回链接',
      actionEn: 'Add a console topbar line “ops-only observatory — players: back to /” with a return link',
    })
  }
  if (peakShare > 0.30) {
    recs.push({
      id: 'peak-window', priority: 'P2',
      metric: 'hourly.20-00', current: peakShare, threshold: 0.30,
      titleZh: '20:00–00:00 集中了 ' + pct(peakShare, 0) + ' 的会话——「深夜钟鸣」没有被接住',
      titleEn: '20:00–00:00 concentrates ' + pct(peakShare, 0) + ' of sessions — “the night bell” goes unclaimed',
      actionZh: 'hub 与游戏启动屏在 21:00 后挂「今夜第三拍，只对还醒着的人响」限时文案（不改结局、不改数值）',
      actionEn: 'After 21:00, hub and boot screen carry “tonight’s third beat sounds only for those still awake” (no ending/stat changes)',
    })
  }
  if (fc.slope < 0 && fc.r2 > 0.3) {
    recs.push({
      id: 'forecast-watch', priority: 'P2',
      metric: 'forecast.slope', current: fc.slope, threshold: 0,
      titleZh: '14 日线性外推为负斜率（R²=' + fc.r2.toFixed(2) + '）——流量在回落，新章该出了',
      titleEn: '14-day linear extrapolation slopes down (R²=' + fc.r2.toFixed(2) + ') — traffic is ebbing; the next chapter is due',
      actionZh: '把 KI「裂开的潮纹」立为下一条章节；发布即日 smoke 重嵌 site-latest.json，hub 自动反映',
      actionEn: 'Promote the “cracked tide-line” chapter; on release day, re-embed site-latest.json so the hub reflects it automatically',
    })
  }
  const order = { P0: 0, P1: 1, P2: 2 }
  recs.sort((a, b) => order[a.priority] - order[b.priority])
  return recs
}
