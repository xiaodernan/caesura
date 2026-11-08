# 架构补登：KI-402~410 收尾（2026-11-09）

本文件是对 `docs/technical-architecture.md` 的补登，不是声称。以下事实由账本 KI-402~410 行与对应提交现读，数字与门读数以 KNOWN_ISSUES.md 为准。

> 机制本身在 master 上早已落地并由 KI-406~410 覆盖（ai/world 100.00%、
> npm audit source-map-js 1.2.2、head-compiles 复绿、red-rate 8/8 全绿、
> .png 入库为零，KI-002/KI-023 引用改为现场截图描述、artifacts/ 未入库）。

## KI-402 「鼓停了，营里的时间就没了」

新数据 `ai.beatLossOnDeath = { pauseBars, searchAlertness }`，仅驼鼓带；鼓手倒下那一刻，
同营存活漂调者获得 `frozenTicks = pauseBars × beatsPerBar × RhythmClock.beatTicks`；冻结
走完后落 `search`，`searchAnchor` 立在鼓手倒下的位置。

## KI-403 「鼓停后的搜场」

同一数据里追加 `lookBackEveryBars`（§6.5 后半句）；搜场期间每隔 `lookBackEveryBars × beatsPerBar
× beatTicks` 拍，全营同时转身（yaw += π）；回头那一拍落在视锥里的玩家当场被 `sense` 升级成 chase。

## KI-404 「打鼓面 4 记震裂背后鼓崩」

新数据 `ai.drumSurfaceHits = 4`，仅驼鼓带；「打到鼓面」沿用既有背刺判据（`isBackstab` > 0.72π）
叠震裂层计数，满 4 次触发 `drumBroken`，走同一条 `campLoseBeat` 管线。鼓手活着不会记第二次丢拍。

## KI-405 「音色晶调包节拍器」

新数据 `ai.drumMuteRadius = 6`（米），仅驼鼓带；判据不是命中而是落点到鼓的水平距离（晶 `pierce:
99` 穿过所有人）；落点在半径内触发 `drumMuted`，走同一条 `campLoseBeat` 管线。鼓手与鼓都存活；
静音一次性。

## KI-406 「stub 登记夹具真链化」

KI-319 补 parry roll 与 30ms 断言；KI-323 / KI-324 补成表⇄运行时对账；KI-322 删除；
`Enemy lookBack` 拆弹 3 腿与 `PlaceholderArena` arena harness 6 腿把 ai/world 覆盖推至
100.00%（总地板未动未 bless）；head-compiles 复绿。

## KI-407 「覆盖率棘轮常红——空报表坍缩」

`npm run coverage` exit=2，非覆盖回退；三出口（cleaner 重量 / `src/core/Harness.ts` /
门级 emptyReport 标注）待主裁决；出口③已由 `.scratch/ki407_probe.mjs` 六条判据探真；
PlaceholderArena 已真见证。

## KI-408 「npm audit 剩 10 条，全卡 breaking major」

source-map-js 1.2.1→1.2.2 已修；剩余 10 条全是 dev-tooling、不进发布产物；须独立 QA 窗口
联动升级 vitest@5.1.0 / vite@8.3.6 / @vitest/coverage-v8@5.1.0，install 需 `--legacy-peer-deps`，
两轮全量曾 15/14 红，全为 Test timed out in 5000ms（walk-tree 门）。

## KI-409 「in-flight 临界路径 red-rate 复量 8/8 全绿」

idle/loaded 各 4 趟量 ui-intents/cinematic-exit/cinematic-owner/input-playlock 与 gate 三件，0 reds，
负载倍数 2.34×；仅钉 verify-after-lane 预期阈值，不替南道提交。

## KI-410 「账本视口证据断链」

git 全史零 .png、`artifacts/` 从未入库；KI-002/KI-023 三处 `artifacts/*.png` 引用已改为「现场截图，
未入库——git 历史零 .png，证据读数保留于本行」。证据留存政策待裁决。

## 共同管线与边界

三种触发（杀鼓手／震裂鼓崩／晶调包）全部收敛到同一条 `campLoseBeat` 冻结＋`search` 管线；
`frozenTicks` 由 `RhythmClock` 拍长换算；`searchAnchor` 取定点坐标。不声称：① 鼓崩无专属演出或鼓体外观变化；
②「打到鼓面」判据是背刺位，不是真鼓面朝向；③ 静音不是限时（永久调包）；④ 鼓崩／晶静音均不影响驼鼓自身招式；
⑤ 架构 §6.1／§6.5 的触发源是否全部落地待 Stage 6 读数确认；⑥ 本文档不新增任何机制或判据，只做入口摘记。
