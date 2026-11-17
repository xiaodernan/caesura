/**
 * src/ui/world-chronicle.ts — 《本周纪事 · The Chronicle》
 *
 * 这是「止音纪元 · 余响集」进入玩家视野的最小入口:不需要把整个编年史塞进游戏,
 * 也不需要把 LLM 接入运行时。它只把**上一次人工闸放行**的"世界巡礼周报"平静地摊开——
 * 让玩家获知这个世界此刻有人在为它说话。
 *
 * 文本 = W47 真机实跑 v3（2026-11-17 · aizzz `gpt-6.1-terra` · Clash 7897 出网 · statuses=[200] · corpus 1592 chunks）
 *       · 人工过了一轮 · 与现实一致(KI 382/559 现读)。玩家不会因为看到它而接触任何 API。
 *
 * 纪律：
 *   - 内容由作者（this file）发声,不直接从 LLM 落出;
 *   - 篇幅 ≤ 600 中字,散文而已;不允许把「LLM / 模型 / AI」写在 prose 里;
 *   - zh/en 双轨平行对仗;不夹杂。
 */

export const WORLD_CHRONICLE_W47 = {
  generatedAt: '2026-11-17T23:30:00.000Z',
  corpusChunks: 1592,
  model: 'gpt-6.1-terra',
  zh: `<p>未竟厅的末行有了认领者。《未竟账页》不再无人对视，账页仍留着空白。风钟海岸的《第四下》已经开篇——钟只响三下，余下的一下不在钟里。</p>

<div class="beat">· · ·</div>

<p class="coda">空页有人认领 · 第四下仍不在钟里</p>
<p class="coda">—— 世界巡礼</p>`,
  en: `<p>The last line in the Unfinished Hall has been claimed. No longer does the page go unseen; its blank space remains. At the Windbell Coast, The Fourth Strike has begun. The clock sounds only three times; the fourth is not in the clock.</p>

<div class="beat">· · ·</div>

<p class="coda">One blank line, claimed</p>
<p class="coda">— World Chronicle</p>`,
} as const
