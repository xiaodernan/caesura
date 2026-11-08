# 架构附录 — 小队队列弧（Squad Queue Arc）+ 测试真实化 + 覆盖率轮

> **本附录的定位**（如实登记）：本批（2026-11-09）把 **KI-370 → KI-401**（小队队列弧）、
> **KI-406**（stub 真链化）与 **KI-407**（空报表棘轮）三簇工作补登进架构。这些批次落盘时
> 并发车道一直占着 §5.9 的连续号段，本批不做 numbered sections（门 F 无空洞 1..182）；
> 但每批的账本大段落本身就是逐字裁决与读数，本附录只做**指引式背书**：每件列出
> 落盘点（代码／测试／账本 KI 号），账本行仍是唯一事实源；本附录不复述每件巨行，不算宣称。
> 并发车道（KI-391～393）落盘后若认领 §5.9.183～187，其节将超集本附录并可同步改口指向它们。
> 每个指引点在本文写入时已逐处核对过源码位置，不代并发车道作承诺。

## 一、小队队列弧（KI-358 → KI-401）

`Squad`（`src/ai/Squad.ts`）是唯一写者；`Enemy` 读排位/槽位/圈；`AISystem` 在 `Squad` 之后、
`Enemy.tryAttack` 之前把仇恨补笔；`ActorVisuals` 读排位画脚下环。表⇄运行时对账：

| 批次 | 落点 | 守卫（测试） |
|---|---|---|
| KI-352／356／357 | `Combat.hit／ai.callAlly→squad` 写仇恨；槽位闸（tryAttack）＋ 3 个旁路裁决的零伤害豁免（条款表 `boss.phases[].barCast` 与 `ai.selfToll` 伤害必须为 0）；urgency 由呼救者血量派生（≤30% high／≥70% low） | `tests/unit/squad-bus.test.ts`／`squad-threat-gate.test.ts`／`slot-exempt-casts.test.ts`／`call-ally-urgency.test.ts` |
| KI-358 | `Squad.getSlotReport()` 只读投影＋`main.ts` F4 一行 | `tests/unit/squad-slot-report.test.ts` |
| KI-370～373／375～381／382～401 | 排序与分槽收成 `rankedCandidates()` 一个主人；等待者：排位 `squadWaitRank`／脚下环（`#E8DFCB` 不扩张，`SquadMember.waitRank`；`ActorVisuals` 新增 RingGeometry 按排位递减＋rank1 呼吸）／切向绕圈（`stepAround` 0.4 rad 前视、弦亏补偿 `r` 原地保圈，KI-377）／先按同伴方位再按排位奇偶（KI-375）／同圈 `4×体格半径` 退让（KI-376）／等待者专属圈 `squadWaitRing`＝own melee reach＋排位×2×body（KI-382）／占槽者与等待者双向身体（`squadNearPeers`／`squadHolderBodies`／`squadSlotPeers`）（KI-382／383）／主攻手接触线截断前冲（`lungeRoomToAllies`）（KI-383）／占槽者攻击线通道（`corridorPush` 1.4 米接管、合成方向一次走完）（KI-394）／冷队列任期轮转 `coldTenure=combatEntryThreshold÷threatDecayPerTick`、`coldRestUntil`（KI-380）／ engages 剔除后上限与轮转跟 `squad.json`（KI-372、KI-381五格守卫）／脱战不挂槽（`OUT_OF_FIGHT_STATES`、`WIN到一半`例外）（KI-397）／撤退装填迟滞 `retreatArmed`（KI-396）／under 0.4s 追上复位为困兽（`cornered`）（KI-398）／复核清零仇恨→清空名册双向边界（KI-401）／乱战长跑 8 只六剧本 6000 拍七条不变量尺（KI-399）／营地圈上限 `chaseBeyond − 4×体格半径`（KI-400）／真实刷点 0.4 米栅格 139 拍、同点 581 拍收敛（KI-395） | `tests/unit/squad-wait-rank.test.ts`／`squad-wait-orbit.test.ts`／`squad-wait-orbit-archer.test.ts`／`squad-wait-radius.test.ts`／`squad-queue-spread.test.ts`／`squad-queue-yield-arc.test.ts`／`squad-crowd-spacing.test.ts`／`squad-attack-lane.test.ts`／`squad-threat-cleanup.test.ts`／`squad-chaos-invariants.test.ts`／`squad-camp-rings.test.ts`／`squad-retreat-slots.test.ts`／`squad-detach-slots.test.ts`／`squad-yield-arc.test.ts`／`squad-retreat-slots`（2.1 米／2 米／1.5 米两把尺都是 `body.scale × 体格半径` 的同一把尺子，不另立常数） |
| `squad.json`／注册表 `squad:config` | `maxAttackSlots`（1–3）／`callAllyRadius`（24）／`threatDecayPerTick`（0.02）／`combatEntryThreshold`（11），`AISystem` 取值 显式 > 表 > `DEFAULT_SQUAD_CONFIG`，上限由数据裁定不再从构造参数走 | `tests/unit/squad-config-data.test.ts`／`validate-data.mjs`（squad 节，0 ERROR） |

**仍欠**（如实，各行账本为准）：全局相位分配；实时站位美术口径；手感复看拍节；射手的多段连招读数；困兽时限（设计没写则不造）。

## 二、测试真实化（KI-406，零生产码）

KI-319／322／323／324 四份 flow 文件由「登记夹具」改写为**表⇄运行时对账**：
`tests/flow/KI-323-stagger.test.ts`、`KI-324-reaction.test.ts`（R4 `armCrumple` 108/144 tick）、
`tests/flow/KI-319-shake-envelope.test.ts`（30ms 不在 SHAKE_TABLE；§10 震镜最小 60ms = parry）、
`tests/flow/shake-table.test.ts`／`tests/flow/shake-table-rows.test.ts`（表⇄运行时对账两夹具）。
行为与读数保留在原账本行 KI-319／322／323／324；本条只记载「登记 → 对账」这件事。

## 三、覆盖率棘轮与空报表（KI-407，未裁）

`scripts/coverage.mjs` 在 `aadb32e` 上 exit=2：空报表（empty-report）致 `src/main.ts` 分母退化为文件行数。
三出口均已备好（① cleaner 环境重量 ② `src/core/Harness.ts` 合并装配 ③ 门级 `measurementSuspendedFiles` 标注），
**未裁**。预演探针 `tests/unit/coverage-gate.test.ts` 在本批合并后照常绿（exit 语义改动不在本批）。
出口先要 KI-391～393 落地后重量一次；仍 exit=2 则三出口选一落地（脚本跑动见 `scripts/coverage.mjs --help`）。

## 四、豁免与门 F 的本轮变动（合并时）

`scripts/id-rules.mjs` 的 `SELF_EXEMPT` 由 3 格收至 **2 格**：旧的「在途占号 KI-348」销账（并入后账本已有 KI-348 行，
Swap/onto 那条）；两格分别为 `ledgerRow:KI-126`（测试输入示例）与 `gitCommit:baf2d80`（换号笔自述）。
两种载体各在用一格，名册判据六道自证 + `id-scope` 三条腿全绿。
`tests/unit/id-scope.test.ts` 用例里的快照期望同批相应收窄。
`docs/technical-architecture.md` 本轮 门 F 仍按 1..182 **连续无空洞无重号**。

## 五、§5.9 节号的当前实际（门 F 通过态）

§5.9.145–177 = 改键～停摆批次；§5.9.178–182 = 本轮并入复原的节（普查／校验器／注入根／红跑／豁免名册）；
§5.9.183–187 留给并发车道 KI-390～393 落盘时认领（本轮账本对在途节的引用已按预留指准）。本附录不占号。
