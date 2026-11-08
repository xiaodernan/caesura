# 分支／工作簿收敛记录 — 2026-11-09

本笔回答「把项目的多个工作分支 各种 worktree 之类的合并起来 汇集到一个主分支」这一条要求的落点实况。
合并原则只有三条：**主干为唯一汇合点**（master）；**在途字节不下车**（南道 KI-391～393 在途改动一字不动，
工作区逐字节保留，另有 `D:/ki348-dev` 备份）；**删掉的前先核对且走归档**（超级无可并入者才删）。

## 已并入 master 的整合

1. **origin/master 四笔并入**（commit `33914e8`，2026-11-09）：原四笔分别是 KI-364／365／384／385，
   全部内容并入主干并挪号入册——因为主干并发批次已占用原号：
   | origin 号 | 并入后号 | 内容 |
   |---|---|---|
   | KI-364 | **KI-412** | 校验器第一次吃得下「换一份表来评」— `--data-root=` 可注入数据根 |
   | KI-365 | **KI-413** | 注入的根要先像数据根 — 缺表不再落成一片「表读不到」 |
   | KI-384 | **KI-414** | 红跑上的覆盖率拒识按文件计数 — union 判据（684 报告普查） |
   | KI-385 | **KI-415** | 豁免名册从散文升级成证据 — `exemptProofFindings` 等；SELF_EXEMPT 指南见 scripts/id-rules.mjs |
   同批平移的还有架构节号与五处同名引用（本次文档内的挪号记录一段逐条列明：§5.9.143→5.9.178／KI-342→KI-411、
   §5.9.144→5.9.179／KI-364→KI-412、§5.9.145→5.9.180／KI-365→KI-413、§5.9.146→5.9.181／KI-384→KI-414、
   §5.9.147→5.9.182／KI-385→KI-415）；账本 KI-390／KI-391／KI-393 三行及其 WORKPLAN 三行对在途节的引用
   同批按预留平移到 5.9.183–187（南道五节届时应认领该号，判据见 门 F 无空洞无重号）。

2. **主干 Nov-3 批次（576bb1c）抹掉的 merge-base 行恢复**：
   §5.9.143「**普查那两支循环的芯交回判据**」整节（原 KI-342，2026-10-29）连带账本那一行不见了，
   但其裁决（`conditionReadsOf`／`mergeConditionReads`）在 `scripts/condition-rules.mjs` 与
   `tests/unit/condition-rules.test.ts` 22 条腿里一直活着。本笔按 merge-base 原文平移为
   **§5.9.178／KI-411** 重新入册，读数不变。

3. 陈旧豁免清账：`SELF_EXEMPT` 里那格 KI-348（4010e9e 在途占号）销账——并入后账本 KI-348 行已现
   （Swap/onto 那条，主干 Nov-3 批次落时继承该号）。名册收成两格：`ledgerRow`（账本 KI-126 那一行记的是
   一次测试输入）与 `gitCommit`（以提交 baf2d80 为载体、那笔里自述「头一稿记作那两个旧号」）各一格在用；
   豁免判据六道自证、id-scope 三条腿全绿。

## 已删除的分支（垃圾回收）

| 分支 | 结论 |
|---|---|
| `ki156-rebase`（72fcf7e，KI-156 挪号批次，2026-10-21） | 内容已被主干演进完全吸收（7 行挪号改动逐字一致或母版超集；主干 211 提交超前） |
| `ki406-backfill`（0d57c10） | 2026-11-09 已并入 master（`ea72d24`，docs 隔离附录，无在途字节） |

两笔均有归档标签留档：`archive/ki156-rebase-72fcf7e`、`archive/ki406-backfill-0d57c10`。

## 待裁／待南道并滩（2026-11-09 记录，不可代办）

- **南道 KI-390～393 的并轨**：其 `.stash` 里那份 technical-architecture.md 在途稿含
  §5.9.178～§5.9.182 五节（KI-390／KI-391／KI-392／KI-393），与并入后由本笔平移填充的同号节冲突。
  账本 KI-391/392/393 及与其同名 WORKPLAN 三行里对在途节的引用已**按本笔挪号先指准为 5.9.183–187**
  — 并发批次落盘时以自己认领的号为准（已登记在账本与提交正文）。
- **南道五节的节号决定**：若南道坚持保留 5.9.178–182，则本笔平移进主干的五节
  （普查/校验器/注入根/红跑/豁免名册 → §5.9.178–182）需要再挪一格（对它们是 5.9.183–187）——
  这由南道并轨那一刻按 门 F（无空洞无重号）现场裁决，本笔不越俎。
- **CinematicExit.ts 的补登**：仅补一行存在性行（提交 `8af9945`，KI-390 实现批），完整设计节等
  并发批次落盘；南道落盘时应以其实际节替换本行。
- **在途字节**：`src/core/Input.ts`、`src/main.ts`、`tests/flow/cinematics-player.test.ts` 及
  `tests/unit/{action-labels,bindings-data,pause-action,schema-vocab,statuses,ui-intents}.test.ts`
  ＋`artifacts/` ＋ 三把新尺文件（`cinematic-exit/owner`／`input-playlock`）仍未入册，
  与 `D:/ki348-dev` 备份逐字节一致——归南道 lane 自己 land 前的状态保持不变。

## 已移除的工作簿（detached，逐个核对，内容为 ancestor 且工作区零改动）

`D:/merge-test-ki156`（自建探针）、`D:/ki153-land`、`.scratch/ki097_wt`、`.scratch/ki099_base`、
`D:/ki335-plane`（KI-338 的 KI-182 还欠① —— 其字节级内容已随 ed4403b 落入主干，
另有 `archive/ki335-plane-2fe6829` 与备份 `.scratch/ki335-plane-audit.json`）。

## 保留的工作簿（各自持有并发车道在途字节，不可能由他人代收）

`D:/ki319-dev`（492）、`D:/ki334-dev`（210）、`D:/ki348-dev`（150，**南道备份**）、
`D:/caesura-lm`（76）、`D:/ki143-plane`（11）、`D:/ki153-plane`（3）、
`D:/ki161-plane`（5）、`D:/法环-m133plane`（5）。括号内为各簿 `git status --short` 的条数
（含在途未入册字节与 `.scratch` 探针产物）。

## 主分支状态（2026-11-09 复核）

`master` 领先 `origin/master` **68 个提交**、落后 **0**（并入后 origin/master 已在祖先集内）；
工作区中南道在途字节未入册、未动；4534 条／384 个测试文件全绿（本次并入树上实测）；
validate:data 0 ERROR／2 WARN（均既有）；门 `doc-audit`、`arch-gap-table`、`id-scope` 全绿。
本笔不推送 origin。

## 并轨结算（2026-11-09 续）

南道 KI-391～393 在途字节并轨落盘：
入册 = src/core/Input.ts、src/main.ts、tests/flow/cinematics-player.test.ts、
tests/unit/{action-labels,bindings-data,pause-action,schema-vocab,statuses,ui-intents}.test.ts
＋ 新三把尺 tests/unit/{cinematic-exit,cinematic-owner,input-playlock}.test.ts。
并入 master 时平移进主干的五节仍住原位 §5.9.178～182（普查／校验器／注入根／红跑／豁免名册）；
南道五节经挪号平移到 **§5.9.183～187**（账本 KI-390／KI-391／KI-393 三行与 WORKPLAN 三行在并入 master 时已按预留指准）。
门 F 现按 1..187 连续无空洞无重号；`artifacts/*.png`（5 张，Stage-5 会话遗留）仍按 KI-410 不入库。
