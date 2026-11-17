/**
 * src/ui/world-chronicle.ts — 《本周纪事 · The Chronicle》
 *
 * 这是「止音纪元 · 余响集」进入玩家视野的最小入口:不需要把整个编年史塞进游戏,
 * 也不需要把 LLM 接入运行时。它只把**上一次人工闸放行**的"世界巡礼周报"平静地摊开——
 * 让玩家获知这个世界此刻有人在为它说话。
 *
 * 文本 = W47 真机实跑 v2（2026-11-17 · aizzz `gpt-6.1-terra` · Clash 7897 出网 · statuses=[200] · cached_tokens=4352）
 *       · 人工过了一轮 · 与现实一致(KI 380/557 现读)。玩家不会因为看到它而接触任何 API。
 *
 * 纪律：
 *   - 内容由作者（this file）发声,不直接从 LLM 落出;
 *   - 篇幅 ≤ 600 中字,散文而已;不允许把「LLM / 模型 / AI」写在 prose 里;
 *   - zh/en 双轨平行对仗;不夹杂。
 */

export const WORLD_CHRONICLE_W47 = {
  generatedAt: '2026-11-17T21:00:00.000Z',
  corpusChunks: 1502,
  model: 'gpt-6.1-terra',
  zh: `<p>账目记着五百五十七条，其中三百八十件落成；系统七十三，档案章二百零二。第十七篇《未竟账页》已被认领，末行不再无人对视。第十八篇《第四下》开篇——世界的钟只响三下，第四下不需要钟。</p>

<div class="beat">· · ·</div>

<p class="coda">三声未唱完 · 空页等认领</p>
<p class="coda">—— 未竟厅记</p>`,
  en: `<p>The ledgers record 557 entries, 380 brought to completion; 73 systems and 202 archive seals. The seventeenth tale, “The Unfinished Ledger,” has been claimed. No one faces its blank last line alone now. The eighteenth, “The Fourth Strike,” has begun: the world's clock sounds only three times. The fourth needs no clock.</p>

<div class="beat">· · ·</div>

<p class="coda">Three chimes, one blank line</p>
<p class="coda">— Unfinished Hall</p>`,
} as const
