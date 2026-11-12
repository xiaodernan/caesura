# PHASE-STATUS — 项目实时进度与证据面

> 本文的计数只有一个主人：`npm run status`（`node scripts/phase-status.mjs`）现取，落在下面那两根
> `<!-- PHASE-STATUS:BEGIN-KV -->` / `END-KV` 锚之间的机读区里。回填用 `npm run status:embed`
> （只动锚之间那一段，按字节判要不要写盘；KEY 集一变就抛错点名掉谁／多谁）；
> 把关的是 `tests/unit/phase-status.test.ts`：机读区里每个 `KEY=VALUE` 与现读逐字一致，
> 而机读区之外**不许出现第二份计数**——所以 KI-438 起本文没有「快照表」：原先那张手抄表与机器块
> 同时说着两句相反的话，而读它的人一个也没有（那几处差多少，账本 KI-438 那一行是主人）。

## 机读区（`npm run status` 现取；`npm run status:embed -- --check` 自证一致，退出码 3＝不一致）

<!-- PHASE-STATUS:BEGIN-KV -->
```
KI.rows=458
KI.Implemented=281
KI.Partial=167
KI.Placeholder=0
KI.Blocked=10
SYS.rows=92
SYS.Implemented=67
SYS.Partial=25
SYS.Placeholder=0
SYS.Blocked=0
TD.rows=3
TD.Implemented=0
TD.Partial=2
TD.Placeholder=1
TD.Blocked=0
PF.rows=1
PF.Implemented=0
PF.Partial=0
PF.Placeholder=0
PF.Blocked=1
ARCH.sections=202
ARCH.maxSection=202
ARCH.duplicates=0
ARCH.holes=none
PKG.scripts=51
PKG.deps=1
PKG.devDeps=6
```
<!-- PHASE-STATUS:END-KV -->

## §78 系统状态总表（格数只读机器块 `SYS.*`；逐格内容与账本 §1.5 同源）

- Implemented：移动／战斗／法术／装备命中／行为树／骨骼／存档／输入／灰盒渲染…，名册在账本 §1.5 那张表。
- Partial：已正面落地但欠实机烤火或资产到位的——AI 感知 10Hz／Squad 槽位与呼救的进一步实机腿／
  相机补正与突进接口欠 KI-008 的真正轨道／`enemy-cornered` 突进按表对账复对齐等。
- Blocked：这一维度由账本 KI 行的状态格管，本文不另记（机器块里 `SYS.Blocked` 那一枚才是读数）。

## 正册现况（计数只读机器块 `KI.*`；逐行内容以账本为准）

- 已结案且可复现：§4-§17 所有已量过的战斗/Boss/表面纪律（打出去的那三族：奥斯塔拉／恩希尔／万籁）。
- Partial 集中域：玩法手感／裁决细节（每行内含还欠清单与动手指引），无一空转。
- Blocked：全属环境／资产／分支类外因，不属于代码欠账。**哪些格处在 Blocked** 由账本那一列管，
  本文不再抄名册——KI-438 量到本文原先那份手抄名册已经比账本少了几格，而没有任何读者发现过。
- 响亮抄本一族（KI-393）：牌子已落地，它此刻的状态以账本那一行的状态格为准。

## §30 各 Phase 出口门状态

| Phase | 门 | 状态 | 证据
|---|---|---|---|
| 0 预生产 | G0 | ✅ 完成 | vision / IP_SEED / production-plan / world-bible 存在；`npm run dev` 可跑 |
| 1 核心原型 | G1 | ✅ 完成 | 真战斗链 KI-133 起的提交史；tsc 0 错 |
| 2 战斗手感 | G2 | ✅ 完成 | KI-291／293／295／297（三 Boss 表⇄运行时逐格对上） |
| 3 世界原型 | G3 | ✅ 完成 | 灰盒 7 区 + WorldState；行走/对话链守卫全绿 |
| 4 敌人生态 | G4 | ✅ 完成 | 10 怪 + 三方 Boss 骨架；Squad 叠哪与交接全套 |
| 5 RPG 系统 | G5 | 大部分完成 | 装备／身份效果／消费品／等级／货币皆已入库 |
| 6 叙事 | G6 | 大部分完成 | 15 任务／25 步可玩、KI-139/141/145；文字 VoiceOver 待原作者裁决 |
| 7 视口打磨 | G7 | 未启动 | 灰盒标准可玩；美术／动画 Placeholder（Placeholder 可上车） |
| 8 音频 | G8 | 基本完成 | AudioEngine／灭音／ ambience 变体床／节拍网格；零外部素材 |
| 9 优化 | G9 | 未启动 | 60fps 帧预算在无可见窗口环境量不出（§5.4 Placeholder） |
| 10 QA | G10 | 未启动 | 正式 P0/P1 轨道未启用 |
| 11 竖切 | G11 | 未启动 | 依赖 G6-G10 完成后签 |

## 仍欠（如实登记；每项要么在阻赛 KI 里，要么在对应 backing doc）

- TD-010（无动态 GI）：无 Lumen 等价物；Placeholder 状态；迁 UE5 才能解。
- KI-407（覆盖率棘轮 exit=2）：三出口待裁（①cleaner 环境重量 ②Harness 拆装 ③门级 annotation）。
- KI-408（npm audit 10 advisories）：**已结案（2026-11-09，A 路全量升级）**：vitest@5.1.0／vite@8.3.6／coverage-v8@5.1.0 ⇒ `npm audit` **0 vulnerability**、4540 条／385 文件全绿、build 10 份文本 0 findings。
- §5.3／§5.4（GPU／内存预算）：无可见窗口和 KTX2/Draco，预算 Placeholder。
- 阶段 7/8/9/10/11：美术／音频打磨单位与户外走查、QA、竖切发布，均未启动。
- Stage 5 视口走查（KI-010）：可见浏览器窗口出现在近期，完成度评审待契约节奏。
- 5 张 Stage-5 现场截图：**`artifacts/` 不入库（KI-410 裁决）**——典礼里不写「已修复」，只写「读数保留」。

## 读法与再生

- 现取：`npm run status` 打印 `KEY=VALUE`；回填：`npm run status:embed`（只动机读区，键集变了会拒绝）；
  自证一致：`npm run status:embed -- --check`（不一致 ⇒ 退出码 3 并点名 KEY，不写盘）。
- `tests/unit/phase-status.test.ts` 钉住四件事：① 机读区每个 `KEY=VALUE` 与现读逐字一致（**手改数字=红**）；
  ② 机读区之外不许再出现「有名有姓的 KEY 配一个数」（快照表的形状）；
  ③ 机读区之外的计数句要么点名一条账本读得到的 KI/TD 记录，要么不许存在；
  ④ 回填工具本身：幂等（已一致时字节不动）、行尾跟着文档自己走、键集变化当场拒绝。
- 节号上限／无空洞／无重号由 `tests/unit/doc-audit.test.ts` 门 F 钉住；§78 状态标签由
  `tests/unit/registry-table.test.ts` 门 I 钉住。
