# CONTRIBUTING —— 《止音纪元》贡献约定

感谢你愿意把时间花在这个项目上。
本文档讲的是**怎么在本项目里落一次合格的贡献**：规矩有哪些、本仓库期望什么样的姿态、
以及「写完什么才算过闸」。它不是法律条文，是你与项目对齐方式的一份备忘。



## 0. 本仓的规矩（同源：docs/technical-architecture.md《§78 五条》、docs/KNOWN_ISSUES.md 与 docs/production-plan.md）

一个 commit 被允许入库，需要同时满足：

- **四腿验证**：架构（架构节号／位置）、测试（断言的证据腿）、validate:data（数据合法性）、lint/tsc（机器读取能过）；
- **每条都是你这次真有意图的动作**；
- **没有任何一条被 skip**（`--no-verify`、改弱断言、或其他方式事先掩盖红条）；
- 改动的**目的必须是你这次真有意图的**——不改别人的话，不附带"顺手"的全库 sweep。



## 1. 账本（docs/KNOWN_ISSUES.md）

- 每一批在账本落一条记录：**病／落点／证据／还欠**，状态字段只允许 `Implemented | Partial | Placeholder | Blocked`（见 §78 表）；
- **不声称**：明确说哪些东西本批没做完、哪些欠账还不到位、哪个裁定该由谁来做；绝不把"AI 说它看起来没问题"当结案；
- **还欠**：列出下一位贡献者能落点的东西；
- 任何人的交易线只增不改：不要在别人的行落自己的名字；如果你重写了某行，请把你新写的新行追加在它之后，而不是塞进旧行里。



## 2. 用户界面／体感

- 菜单字串、控件提示、音效描述
  —— 保持与 `docs/narrative.md` 与 `docs/ui-ux.md` 一致，不引入未经核对的机器术语；
- **第一分钟不被打断**（本作没有 tutorial，请不要自作主张加引导步骤）；
- 灰盒与美术风格
  —— 留给具体关卡与美术的裁决，不要在本段文本里擅自定艺；

## 3. 资源／资产

- 外部资产（音乐、音效、模型、配置外部表）**不入库**（见 `.gitignore` 与 `artifacts/`）；
- 仅供开发的降级拨档住在 `settings/GameplaySettings.ts`，排程体感开关住在 `core/Input.ts#playLive`；
- VFX 区：`vfx/GPUParticles.ts` / `vfx/Trails.ts` / `vfx/Decals.ts` / `vfx/VfxEmitters.ts`，参见 `docs/combat.md` 与 KI-135/136/148 等行；

## 4. Commit discipline

- 报头格式：`<area>: KI-<n> <task> —— <一句话落点>`（如 `player: KI-194 疾跑… — 回复曲线修掉`）；
- **一个 commit 只做一件事**；
- 不允许提交记录里出现"顺便""顺带" "顺便修了" 这类字样；
- 不允许对已入库的行只做重复登记（账本必须有新落地证据，或明确补记"未落地"）；

## 5. 落一次变更的完整流程

```bash
npm run check
npm run build
git status --porcelain
git commit -F <messageFile>
```

`git status --porcelain` 非空且每项都是你认识的条目才过闸——不认识的条目先确认由谁留下的，再决定入库。

验证输出例：

```
> caesura@0.1.0 check
> tsc --noEmit        # 0 错
> npm run validate:data  # 0 ERROR / 2 WARN (既有)
> npm run test         # 4555 条 / 390 文件 / 0 fail
```

## 6. 不允许的事

- 把"测试绿"当成结案；
- 改写别人证据来达致测试全绿；
- 把兄弟车道的在途字节当作自己的证据（每段 commit 必须对应它自己这件事）；
- 不允许留下 `expect(true).toBe(true)` 这种恒真断言；
- 不允许跳过 pre-commit 钩子；
- 不允许把『中间有空行的 commit』伪装成『一次完整修复』。

## 7. 该问你自己的两个问题

- 落地后：谁会来读这一行／这一招？
- 结案后：下一位读这行的人怎样才能确认你没说谎？

只要你能回答这两个，本项目就接受你这次贡献。

## 8. 术语表（本仓内部词汇；每一条都是仓库里真在用的说法）

| 词 | 意思 |
|---|---|
| 账本 | `docs/KNOWN_ISSUES.md`，每一行一条 KI 记录：病／裁决／读数／还欠。一切变更从账本落起。 |
| 正册 | 账本里带 `\| KI-nnn \|` 的那张主表；`npm run status` 现取其中 `Implemented / Partial / Placeholder / Blocked` 四档计数。 |
| KI / TD / PF | 正册号 / 技术债号（§2 表）/ 生产失败号（§3 表）。`KI-408` 读「KI 第 408 号」。 |
| KI-nxx | 账本编号；正册唯一性由门 B/F 钉住，重号是红条。 |
| §N | `docs/technical-architecture.md` 的节号（如 `§5.9.187`）。门 F 钉住 §5.9 的连续与无重号。 |
| 落点 | 变更真正住在哪（文件／函数／数据行）——账本行必须写出落点，不能只写「已处理」。 |
| 落库 | 已提交进 git 库（commit 里真有那几行），不是「我改过了」。 |
| 读数 | 量出来的数字（测试计数、覆盖率、拍数、距离、字节数）。账本上的「读数」要能复算。 |
| 还欠 | 本批明确没做完、留给下一位的东西。每行 KI 都有「还欠」格。 |
| 不声称 | 本批明确不宣称什么（环境差异、未量部分、未裁决项）。写给未来读者的减震层。 |
| 腿 | 验证的一格。一条变更通常要同时过多「腿」：架构／测试／validate:data／lint。 |
| 证据 | 能让下一位无歧义复核的东西：命令、输出、commit 号、行号。 |
| 反向臂 | 摘掉/破坏机制后重跑，红条按预测回来的那一臂——证明测试真的钉住了它声称钉的东西。 |
| 臂 | 一个实验面（CONTROL 或某一刀）。「六臂全红」= 六种破坏各自对上的红条数。 |
| 裁决 / 待裁 | 需要人拍板的事（Boss 数值、美术、玩家人数、升级 major……）。待裁项不在 AI 手里定。 |
| 主干 | `master`——唯一合并目标；其余车道/worktree 的内容都并入它。 |
| 车道 | 并发开发流中的一条线（另一台机器/另一个会话/另一个 worktree）。 |
| 平面 | 一个检出出来跑读数的目录（常指与 `master` 对齐的 worktree 或 `git archive` 解包后的冻结快照）。 |
| 并入 / 并轨 | 把某条车道的提交合进 `master`；并轨后由主裁决者保持单一主干。 |
| 工作簿 | 本地仓库工作目录（`D:/法环游戏`）。 |
| 门 | 机器读取的红线检查（如门 F 节号名册、门 B 账本唯一性、门 I 状态标签）。 |
| 名册 | 机器扫描出来的清单。`磁盘名册`＝`tests/` 下全部测试文件名单（`scripts/test.mjs` 与测试计数对账用）。 |
| 机读区 / BEGIN-KV…END-KV | `docs/PHASE-STATUS.md` 里 `<!-- PHASE-STATUS:BEGIN-KV --> … <!-- PHASE-STATUS:END-KV -->` 那个代码块——只允许由 `npm run status` 现取回填，手改即红。 |
| 地板 | 覆盖率棘轮的下限（`scripts/coverage-floor.json`）。只许涨不许跌；「--bless」= 抬地板。 |
| 棘轮 | 「只许增不许减」的门——覆盖率／测试计数一类。 |
| 空报表（empty-report） | 从未被任何测试 import 的文件在 coverage 里走 `(empty-report)` 分支，行数分母退化为文件行数；不是覆盖率掉了。 |
| 零覆盖 | 有可执行行、但没有任何测试执行过的文件（`zeroCoverageFiles`）。 |
| 红率 | `scripts/red-rate.mjs` 记录的「某 commit 上有多少条红」。 |
| worktree | `git worktree` 的目录约定（本仓抛弃式升级/预演用，完工即移除；`.worktrees/` 已 ignore）。 |
| 夹具 / 假件 | 测试里用来喂判据的替身（假 world／假消费者）。 |
| 刀口 | 精确的破坏点（一臂对应一刀）。「刀口在第 N 格」＝红要落在那一格。 |
| Partial / Implemented / Placeholder / Blocked | 账本状态四档；`Placeholder`=占位待设计，`Blocked`=等裁决/等外因。见 §0 与 §78 表。 |
| 登记 / 记账 | 把一件事写进账本（哪怕不解决它，也写清楚它是什么）。 |
| 量具 | 量东西的脚本本身（`scripts/coverage.mjs` 等）——量具坏了 ≠ 覆盖率掉了。 |
| 纯类型文件 | istanbul 记 0 可执行行的文件（如 `src/data/schema.ts`），不进覆盖率分母。 |
| 全量 | `npm run check`／全套测试（当前：4555 条 / 390 文件——以 `npm test` 现读为准）。 |
