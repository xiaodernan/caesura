/**
 * src/ui/world-chronicle.ts — 《本周纪事 · The Chronicle》
 *
 * 这是「止音纪元 · 余响集」进入玩家视野的最小入口:不需要把整个编年史塞进游戏,
 * 也不需要把 LLM 接入运行时。它只把**上一次人工闸放行**的"世界巡礼周报"平静地摊开——
 * 让玩家获知这个世界此刻有人在为它说话。
 *
 * 文本 = W47 真机实跑 v4（2026-11-17 · aizzz `gpt-6.1-terra` · Clash 7897 出网 · statuses=[200] · corpus 1679 chunks）
 *       · 人工过了一轮 · 与现实一致(KI 384/561 现读)。玩家不会因为看到它而接触任何 API。
 *
 * 纪律：
 *   - 内容由作者（this file）发声,不直接从 LLM 落出;
 *   - 篇幅 ≤ 600 中字,散文而已;不允许把「LLM / 模型 / AI」写在 prose 里;
 *   - zh/en 双轨平行对仗;不夹杂。
 */

export const WORLD_CHRONICLE_W47 = {
  generatedAt: '2026-11-17T23:59:00.000Z',
  corpusChunks: 1679,
  model: 'gpt-6.1-terra',
  zh: `<p>2026年11月17日，账目停在五百六十一条，其中三百八十四件已落成；系统七十三，档案章二百零二。上周，未竟厅的第十七篇《未竟账页》被认领，末行空白不再无人对视。第十八篇《第四下》开篇——钟只响三下，第四下不需要钟，它一直在心里。</p>

<div class="beat">· · ·</div>

<p class="coda">第四下不需要钟 · 它一直在心里</p>
<p class="coda">—— 世界巡礼史官</p>`,
  en: `<p>On November 17, 2026, the ledgers hold 561 entries, 384 completed. There are 73 systems and 202 archive seals. Last week, the seventeenth piece, The Unfinished Ledger Page, was claimed in the Unfinished Hall; its blank final line no longer faces nobody. The eighteenth, The Fourth Strike, has begun: the world's bell rings three times. The fourth needs no bell. It has always been within you.</p>

<div class="beat">· · ·</div>

<p class="coda">The fourth needs no bell</p>
<p class="coda">— World Chronicler</p>`,
} as const
