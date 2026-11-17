/**
 * src/ui/world-chronicle.ts — 《本周纪事 · The Chronicle》
 *
 * 这是「止音纪元 · 余响集」进入玩家视野的最小入口:不需要把整个编年史塞进游戏,
 * 也不需要把 LLM 接入运行时。它只把**上一次人工闸放行**的"世界巡礼周报"平静地摊开——
 * 让玩家获知这个世界此刻有人在为它说话。
 *
 * 文本 = W47 真机实跑（2026-11-17 重新跑 · aizzz gpt-6.1-terra · Clash 7897 出网 · statuses=[200]）
 *       · 人工过了一轮 · 与现实一致,每一句均可对得上世界现状快照。玩家不会因为看到它而接触任何 API。
 *
 * 纪律：
 *   - 内容由作者（this file）发声,不直接从 LLM 落出;
 *   - 篇幅 ≤ 600 中字,散文而已;不允许把「LLM / 模型 / AI」写在 prose 里;
 *   - zh/en 双轨平行对仗;不夹杂。
 */

export const WORLD_CHRONICLE_W47 = {
  generatedAt: '2026-11-17T01:06:00.000Z',
  corpusChunks: 1405,
  model: 'gpt-6.1-terra',
  zh: `<p>第十七篇《未竟账页》已有认领,末行不再无人对视。第十八篇《第四下》开篇:世界的钟只响三下,第四下不需要钟,它一直都在你心里。账目记着五百五十五条,其中三百七十八件落成;系统七十三,档案章二百零二。</p>

<div class="beat">· · ·</div>

<p class="coda">末行已认领 · 第四下未响</p>
<p class="coda">—— 未竟厅</p>`,
  en: `<p>The Unfinished Ledger Page, the seventeenth story, has been claimed; its final line no longer faces no one. The eighteenth, The Fourth Beat, has begun: the world's clock rings only three times. The fourth needs no clock; it has always been within you. The ledger records five hundred and fifty-five entries, three hundred and seventy-eight completed; seventy-three systems and two hundred and two archive seals.</p>

<div class="beat">· · ·</div>

<p class="coda">No one to claim the blank line</p>
<p class="coda">— The Unfinished Hall</p>`,
} as const
