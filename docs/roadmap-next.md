# 路线图 —— 从「止音纪元 · 竖切片」到「止音纪元 · 可玩本文版」

> 本文档不是宣言、不是承诺，也不替任何 KI 行背书。
> 它是给下一位真正坐下来继续开发这件事的人的一次性讲解。
> 每条"下一步"后面都指向 `KNOWN_ISSUES.md`、`PHASE-STATUS.md`、
> `production-plan.md` 或 `technical-architecture.md` 中的一格账本。

---

## §1. 三条要先认下来的认识

1. **当前主干是绿的。** `npm run check` ⇒ 4542 条 / 386 文件 / 0 fail。`tsc --noEmit` 0 错。
2. **竖切片不是完整游戏。** Phase 0–4 全绿、Phase 5（成长）完成、Phase 6（叙事）各自大部分落位；
   Phase 7 及其后的**任何**一帧代码都还没动。
3. **账本是一切的起点。** 每一笔变更都把它落在 `KNOWN_ISSUES.md` 的某一行。

---

## §2. 项目状态（如实）

`PHASE-STATUS.md` 里逐项列出了每个 Phase 的出口状态与证据。
这里不重抄：**请打开那一份去读**。摘要：

- **Phase 0** §Adapted· 完成（G0）。
- **Phase 1** 核心原型（G1）。G1 归档完成（2026-10-22）。
- **Phase 2** 战斗手感（G2）。G2 归档完成（KI-291／293／295／297）。
- **Phase 3** 世界原型（G3）。G3 归档完成（KI-133–182）。
- **Phase 4** 敌人生态（G4）。G4 归档完成（10 怪 + 3 Boss）。
- **Phase 5** RPG 系统（G5）。落位但清单未完（§Future G5）。
- **Phase 6** 叙事（G6）。叙事篇落位；Visual 补丁欠。
- **Phase 7+** 视觉 / 声音 / 优化 / QA / 竖切 —— **零帧代码**。
- **最近一笔主干动作**：2026-11-09，master 重构成单一主干、清理 worktree、落工具链（README／LICENSE／engines／CI／CONTRIBUTING／新 rollup tool）。

---

## §3. 可以做的事（无需裁决）

依「来不来得及落」排序。

### 3.1 立刻可做（1 天以内）

- ~~**增加一条 IDE 独立的 Boss flow 测试**：`tests/flow/boss-slot-bodies.test.ts`，钉住「占槽者前冲落点按同伴接触线截断」~~ **已落（2026-11-09）**：`tests/flow/boss-slot-bodies.test.ts`，真数据奥斯塔拉 + 两名漂调者、全场 1800 拍：两名主攻手最近距 **1.020 米**（0 样本 <1.0）、反向臂（摘 `Squad.prototype.update` 里 `squadSlotPeers` 写入）最近距 **0.145 米**／under1 **1163** 样本。兄弟口径仍在 `tests/unit/squad-slot-bodies.test.ts`（`tests/unit/` 不是 `tests/flow/`——路线图原文这里的路径是写岔的）。
- **Phase 7 的一个最小可落点**：在 `vfx/Trails.ts` 中，给 `trail.weapon` 加一条定向测试（武器挥击时拖尾粒子的长度 ≤ 某常量，超过即 push）；
  若当前实现没有上限，加一条边界测试进去；若已经有上限，补验 `tests/unit/vfx-trail-weapon.test.ts` 使之覆盖这个失败面。
- **加一条 `tests/unit/squad-slot-bodies.test.ts`**（或 extend）：钉住 `lungeRoomToAllies` 在对向两人同一帧各走一半的行为。

### 3.2 中期（1–3 周）

- **Phase 9 量值盘**：写一个 `scripts/measure-probe.mjs`，跑 1 分钟模拟（不需要 GPU），对 `ai.update` 那一格报告，
  把结果写入 `./artifacts/perf-probe-<date>.log`（不入库——跟 `artifacts/` 的其它文件一样按 `KI-410` 不入库）。
- **Phase 7 的 CSS 滤镜清退**：当前 `palette-fisrt` 直接靠 CSS `filter: saturate() / brightness()`（KI-173）；
  下一阶段是挂真 `material.opacity` / `blending` 或径向叠加 Shader 来替掉它。

### 3.3 保养型（任何阶段都可做）

- 检查 `PHASE-STATUS.md` 的嵌入数字有没有过时（每次合入后跑 `npm run status` 校一次）；
- 给 `CONTRIBUTING.md` 加一段"术语表"（本仓内部词汇众多）；
- 或者做一轮 `Interactables` 引用审计：找 `data/json/` 中所有真值——`weapons.json / enemies.json / items.json / regions.json` 等，
  核对没有悬空物，给它们 unaware-read/空物 配验收测试。

---

## §4. 不能未经裁决做的事（先别碰）

| KI | 为什么必须先问 |
|----|--------------|
| KI-407 | coverage exit=2，棘轮没过线 |
| KI-001 | 外接手柄的振动不可用（§64） | 见 `PHASE-STATUS.md` 表格 |
| KI-010 | Phase 10 实机视口走查（headless tickFrame 已经够，像素截图才需要）|
| KI-019 | 仅强攻线交战 Boss 判定 |
| KI-027 | 调音桩面板视口评审 |
| KI-045 | 对话框视口评审 |
| KI-158 | 46 行 Missing Assets |

以上的每一行都已在 `PHASE-STATUS.md` 登记表里写明「等谁裁决」。

---

## §5. 开始的方式

1. 打开 `README.md` 和 `docs/PHASE-STATUS.md`；
2. 读 `docs/CONTRIBUTING.md` 的行规；
3. 读 `docs/KNOWN_ISSUES.md` 找一条 `Implemented=` 的行（或直接选一个 `Partial`）；用相同的方法落一行；
4. 必须跑 `npm run check`；必须 `git status --porcelain` 确认
   只有自己动过的；
5. 提交时一个 commit 只做一件事。

---

## §6. 工具速查

| 命令 | 作用 |
|-----|------|
| `npm run check` | tsc/lint + validate:data + test（除非加了额外工具，否则这就是 CI 的本地对等物）|
| `npm run release` | `scripts/release.mjs`：tsc → validate:data → test → build → check-dist，全部绿才输出 RELEASE CHECK OK |
| `npm run status` | 正册 / 系统表 / TD / PF / §5.9 节号名册现取 rollup；嵌入的 PHASE-STATUS.md 钉住一致 |
| `npm run check-links` | `.md` 文件交叉引用审计（跳过 node_modules 等；当前 21 份 .md，4 链全部可达）|
| `npm run build` | 产物 dist/ |
| `npm run validate:data` | 数据门 |
| `npm run coverage` | 覆盖率棘轮（已 blocked） |
| `node scripts/red-rate.mjs` | 红率哨兵 |

---

如果你读到这里决定不继续了——没关系。
账本会一直告诉你什么是下一步：`grep -E '^\|' docs/WORKPLAN.md | head`。
