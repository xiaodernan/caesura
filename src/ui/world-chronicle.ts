/**
 * src/ui/world-chronicle.ts — 《本周纪事 · The Chronicle》
 *
 * 这是「止音纪元 · 余响集」进入玩家视野的最小入口：不需要把整个编年史塞进游戏，
 * 也不需要把 LLM 接入运行时。它只把**上一次人工闸放行**的"世界巡礼周报"平静地摊开——
 * 让玩家获知这个世界此刻有人在为它说话。
 *
 * 文本 = W47 真机实跑（aizzz `gpt-6.1-terra` · 2026-11-16 · Clash 7897 出网 · status 200）
 *       · 人工过了一轮 · 与每一条油污一一对得上现有 canon。玩家不会因为看到它而接触任何 API。
 *
 * 纪律：
 *   - 内容由作者（this file）发声，不直接从 LLM 落出；
 *   - 篇幅 ≤ 600 中字，散文而已；不允许把「LLM / 模型 / AI」写在 prose 里；
 *   - zh/en 双轨平行对仗；不夹杂。
 */

export const WORLD_CHRONICLE_W47 = {
  generatedAt: '2026-11-16T21:12:54.247Z',
  corpusChunks: 1327,
  model: 'gpt-6.1-terra',
  zh: `<p>2026年11月16日——账目记下五百四十五条，其中三百六十八件已经落成；系统七十三，档案章两百零二枚。上周，未竟厅的第十七篇《未竟账页》被认领，末行空白不再无人对视。第十八篇《第四下》已经开篇——世界的钟只响三下，第四下不需要钟，它一直在你心里。</p>

<div class="beat">· · ·</div>

<p class="coda">末弦未响 · 余响未歇</p>
<p class="coda">—— 未竟厅史官</p>`,
  en: `<p>November 16, 2026 — the ledger holds 545 entries, with 368 of them completed; 73 systems remain; the archive bears 202 seals. Last week, the seventeenth piece, The Unfinished Ledger Page, was claimed in the Unfinished Hall. Its blank final line no longer faces nobody. The eighteenth piece, The Fourth Beat, had opened: the world's bell rings three times, the fourth needs no bell — it has always been within you.</p>

<div class="beat">· · ·</div>

<p class="coda">The last string unstruck — the aftersound unsilenced</p>
<p class="coda">— Hall Chronicler</p>`,
} as const
