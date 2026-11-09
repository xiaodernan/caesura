# CAESURA《止音纪元》

原始 IP 的第三人称动作 RPG（垂直切片），TypeScript + Three.js 实现。
世界设定：**止静带**（Hushbelt）—— 所有声音在时间中"停顿"的一整片区域；
玩家是唯一能让停顿被"回响"的人。详见 [docs/IP_SEED.md](docs/IP_SEED.md)
与 [docs/vision.md](docs/vision.md)。

当前状态：**垂直切片进行中**（灰盒已跑通，主干持续纵深）；目标是**端到端可玩**
一款可独立游玩的正式作品（见 [docs/production-plan.md](docs/production-plan.md) 与
[docs/WORKPLAN.md](docs/WORKPLAN.md)）。

## 快速开始

需要 Node.js `>=22.12.0`（`package.json` 的 `engines` 钉住；vite 8／vitest 5 的最低要求）。

```bash
npm install
npm run dev            # Vite dev server；浏览器打开 http://localhost:5173/?fresh=1
```

`?fresh=1` 直进世界（标题屏仅在无存档时出现）。

## 验证

```bash
npm run check          # tsc --noEmit + validate:data + 全部测试（当前：0 错 / 4550 条 / 389 个文件）
npm test               # 仅测试（磁盘名册 389，4493→4534→4540→4542→4548→4550 随批次递增）
npm run validate:data  # 数据门（当前：0 ERROR / 2 WARN，均为既有项）
npm run coverage       # 覆盖率棘轮门（空报表退化按 exit 2 记账，不判 guilty）
npm run build          # tsc + vite build + check-dist（产物：dist/）
```

## 文档地图

| 文档 | 内容 |
|---|---|
| `docs/production-plan.md` · `docs/WORKPLAN.md` | 生产计划、KI 分批落地计划 |
| `docs/KNOWN_ISSUES.md` | 账本：全部 KI 行（病灶／裁决／读数／还欠，行内带证据） |
| `docs/technical-architecture.md` | 技术架构（§5.9.N 节 + 门 F 编号名册：1..max 连续，无空洞无重号） |
| `docs/combat.md` · `docs/gameplay.md` · `docs/progression.md` · `docs/ui-ux.md` · `docs/narrative.md` | 战斗／玩法／成长／UIUX／叙事规格 |
| `docs/art-direction.md` · `docs/audio.md` · `docs/world/world-bible.md` | 美术／音频／世界设定 |
| `docs/vision.md` · `docs/IP_SEED.md` | 产品定位与原设定 |
| `docs/branch-consolidation-20261109.md` | 2026-11-09 分支／worktree 收敛记录（并入 origin/master、复原 KI-411、worktree 清单） |
| `docs/architecture-20261109-backfill.md` · `docs/architecture-20261109-squad-arc.md` | 背书式架构附录（非节号；squad 队列弧等） |

## 工程约定（本仓库注重的事）

1. **账本优先**：每批先有 KI 行（病灶→裁决→读数→还欠），行内带量具与反向变异臂证据。
2. **四腿落地**：声明／框架／数据消费／测试覆盖，四腿齐才许结案；腿都可复跑。
3. **诚实度 > 进度**：读数由真链量（`tests/*` + 门 + 实机截图），「不声称」写明不覆盖的。
4. **分支卫生**：主干 `master` 唯一汇合点；并发变更不入此树，在途字节不代收不代改。
5. **中文提交**：`area+test: KI-NNN … — …`（feat／fix／test／docs 按实）。

## 说明

部分面板／debug 能力仅开发期可用（`npm run dev` 下可见）。
当前没有对玩家的**正式发行构建**；产物为垂直切片演示级。
> 入库规则／账本流程见 `docs/CONTRIBUTING.md`；门状态快照见 `docs/PHASE-STATUS.md`。
