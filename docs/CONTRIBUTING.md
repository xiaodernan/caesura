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
> npm run test         # 4540 条 / 385 文件 / 0 fail
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
