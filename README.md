# CAESURA《止音纪元》

> English? Read **[`README.en.md`](README.en.md)**.
> First time? **[`docs/PLAYER-GUIDE.md`](docs/PLAYER-GUIDE.md)**.

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

**线上地址**：<https://xiaodernan.github.io/caesura/?fresh=1>（最新 master 自动构建）  
- 新手教程：<https://xiaodernan.github.io/caesura/tutorial/>（双语 / 9 步 / 鼠标 Y 轴段） ·  
- 系统台：<https://xiaodernan.github.io/caesura/console/>（Wave 56 / 八地域世界图 / 集大成 panels） ·  
- **止音后台 · 用户观察站**：<https://xiaodernan.github.io/caesura/admin/>（口令 **123** · 转化漏斗 · 留存矩阵 · 异常日检测 · 退出点 & Rage-click · 按数据现场推导的 Top-10 优化动作 · 双语 · 静态种子数据 + 本机实况 localStorage · KI-583） ·  
- 角色图鉴：<https://xiaodernan.github.io/caesura/cast/>（Cast Roster · 15 个势力/地域/NPC/Boss，中/EN 双语） ·  
- 世界谱：<https://xiaodernan.github.io/caesura/codex/>（World Codex · 74 条真实项目文本的双语 BM25 检索 · 浏览器内索引 · 零网络 · 零 LLM · updated 2026-11-16） ·  
- 《盐》（短篇原创）：<https://xiaodernan.github.io/caesura/story/>（风钟海岸 · 听雾站 · 《盐》· 双语对照 · 零 LLM · 2026-11-15） ·  
- 《山下无名碑》（短篇原创之二）：<https://xiaodernan.github.io/caesura/story/unnamed-stone/>（休垒 · 山脚 · 石匠的女儿阿汀 · 双语对照 · 零 LLM · 2026-11-15） ·  
- 《空拍子》（短篇原创之三）：<https://xiaodernan.github.io/caesura/story/empty-bar/>（未竟厅 · 七十三年轮值 · 恩希尔的注视 · 双语对照 · 零 LLM · 2026-11-15） ·  
- 《账本》（短篇原创之四）：<https://xiaodernan.github.io/caesura/story/ledger/>（休垒 · Meg 不敢合上的那一页账 · 双语对照 · 零 LLM · 2026-11-15） ·  
- 《回声庭园》（短篇原创之五）：<https://xiaodernan.github.io/caesura/story/garden/>（余响新陆 · 第六境 · 旧钟的主人 · 双语对照 · 零 LLM · 2026-11-15） ·  
- 《雨审判》（短篇原创之六）：<https://xiaodernan.github.io/caesura/story/tribunal/>（余响新陆 · 雨钟谷地 · 雨罪审判者 · 七年一庭 · 双语对照 · 零 LLM · 2026-11-15） ·  
- 《余响集》（全集页 · 整册入口 · 支持一键打印成纸质卷）：<https://xiaodernan.github.io/caesura/story/anthology/>（二十九篇整册 · 史诗般总起预告 · EPIC-VII 实写落地 · 2026-11-18 增篇二十九《盐线之后》） ·  
- 《霜锤》（短篇原创之七）：<https://xiaodernan.github.io/caesura/story/frostbell/>（霜锤崖 · 末任钟匠 · 冻成冰的声音 · 双语对照 · 零 LLM · 2026-11-15） ·  
- 《千门》（短篇原创之八）：<https://xiaodernan.github.io/caesura/story/doors/>（回廊钟 · 一千扇门 · 守门人 · 双语对照 · 零 LLM · 2026-11-15） ·  
- 《石喉》（短篇原创之九）：<https://xiaodernan.github.io/caesura/story/stonethroat/>（低音之城 · 石喉母亲 · 不需要货币的音 · 双语对照 · 零 LLM · 2026-11-15） ·  
- 《第一钟》（短篇原创之十 · 创世）：<https://xiaodernan.github.io/caesura/story/first-bell/>（鸣响之前 · 最后的铸钟人 · 全部世界的声音 · 双语对照 · 零 LLM · 2026-11-15） ·  
- 《暗潮》（短篇原创之十一 · 黑暗森林）：<https://xiaodernan.github.io/caesura/story/dark-tide/>（风钟海岸 · 第九个守夜人 · 宇宙社会学 · 双语对照 · 零 LLM · 2026-11-16） ·  
- 《后记 · 第十二个听者》（短篇原创之十二 · 收束）：<https://xiaodernan.github.io/caesura/story/twelfth-listener/>（写给读到这里的人 · 三拍一停 · 双语对照 · 零 LLM · 2026-11-16） ·  
- 《拾钟人》（短篇原创之十三 · 余响拾遗）：<https://xiaodernan.github.io/caesura/story/bell-picker/>（走过八片走过的钟里，把每一钟剩下的东西都收拾干净——留给第四下敲钟的人 · 双语对照 · 零 LLM · 2026-11-16） ·  
- 《灯匠》（短篇原创之十四 · 破碎的铜）：<https://xiaodernan.github.io/caesura/story/lampwright-bell/>（风钟海岸最东端的灯坊 · 八区旧铜熔进灯身——被打碎的铜依然记得 · 双语对照 · 零 LLM · 2026-11-16） ·  
- 《低音之城》（短篇原创之十五 · 欠账只能用听来抵）：<https://xiaodernan.github.io/caesura/story/lowtone-city/>（低音之城 · 石喉母亲 · 一个欠了海一记 E♭ 的小女孩 · 双语对照 · 零 LLM · 2026-11-16） ·  
- 《钟摆渡人》（短篇原创之十六 · 替时间一摆一摆）：<https://xiaodernan.github.io/caesura/story/pendulum-ferryman/>（未竟厅最深处守摆人 · 替时间走的摆 · 把赫希尔的位置让出来 · 双语对照 · 零 LLM · 2026-11-16） ·  
- 《未竟账页》（短篇原创之十七）：<https://xiaodernan.github.io/caesura/story/unfinished-ledger/>（未竟厅 · 老大师留下的账 · 末行空白等着被认领 · 双语对照 · 零 LLM · 2026-11-17） ·  
- 《第四下》（短篇原创之十八）：<https://xiaodernan.github.io/caesura/story/fourth-strike/>（风钟海岸 · 岬角断桅杆上的钟舌 · 第四下不需要钟，它一直都在你心里 · 双语对照 · 零 LLM · 2026-11-17） ·  
- 《末弦》（短篇原创之十九）：<https://xiaodernan.github.io/caesura/story/last-string/>（北崖 · 世界曾经很吵，一条看不见的弦自己找到了自己的频率 · 双语对照 · 零 LLM · 2026-11-17） ·  
- 《听弦》（短篇原创之二十）：<https://xiaodernan.github.io/caesura/story/string-listener/>（北崖 · 未竟厅 · 弦问谁在听——世界终于有人回答 · 双语对照 · 零 LLM · 2026-11-17） ·  
- 《第三声》（短篇原创之二十一）：<https://xiaodernan.github.io/caesura/story/third-voice/>（风钟海岸 · 灯灭的夜 · 海说：我也听见了 · 双语对照 · 零 LLM · 2026-11-17） ·  
- 《合奏》（短篇原创之二十二）：<https://xiaodernan.github.io/caesura/story/ensemble/>（四地 · 同一秒停住 · 海停了、弦松了、笔停了、桌子颤了 · 双语对照 · 零 LLM · 2026-11-17） ·  
- 《回声谷》（短篇原创之二十三）：<https://xiaodernan.github.io/caesura/story/echo-vale/>（回廊钟深夜 · 所有的门同时自己响了半声 · 阿沉走进那扇从未推开的门 · 双语对照 · 零 LLM · 2026-11-18） ·  
- 《半声之后》（短篇原创之二十四）：<https://xiaodernan.github.io/caesura/story/after-half-a-chime/>（回廊钟 · 门都合上了 · 门槛上的一枚旧铜扣 · 一口从未敲过的钟的按钮 · LLM 草稿 · 人工闸 · 零 LLM · 2026-11-18） ·  
- 《铜扣旁》（短篇原创之二十五）：<https://xiaodernan.github.io/caesura/story/beside-the-button/>（回廊钟第37年 · 粉笔的句号 · 阿汐替父亲按下了那扣 · 粉线还在 · LLM 草稿 · 人工闸 · 零 LLM · 2026-11-18） ·  
- 《线外》（短篇原创之二十六）：<https://xiaodernan.github.io/caesura/story/beyond-the-line/>（回廊钟·线外 · 桌边一枚空钉 · 阿汐收进纸袋 · 海风吹走纸袋 · 袋里多了一行字"听留下" · LLM 草稿 · 人工闸 · 零 LLM · 2026-11-18） ·  
- 《纸袋之后》（短篇原创之二十七）：<https://xiaodernan.github.io/caesura/story/after-the-bag/>（回廊钟·纸袋之后 · 桌边空着 · 她没有添字 · 醒来枕头边到窗台多了一条盐线 · 门自己开了一条缝 · LLM 草稿 · 人工闸 · 零 LLM · 2026-11-18） ·  
- 《窗台盐线》（短篇原创之二十八）：<https://xiaodernan.github.io/caesura/story/salt-on-the-sill/>（回廊钟·窗台盐线 · 盐线每天短一指 · 第五天守夜断在木板接缝处 · 她出门去了一趟海 · LLM 草稿 · 人工闸 · 零 LLM · 2026-11-18） ·  
- 《盐线之后》（短篇原创之二十九）：<https://xiaodernan.github.io/caesura/story/after-the-salt-line/>（回廊钟·盐线之后 · 两半盐线还在窗台 · 纸袋留在门边 · 门没有再开 · 窗台上那两半盐线又悄悄长回去了一点点 · LLM 草稿 · 人工闸 · 零 LLM · 2026-11-18） ·  
- 数据最新：`master` 每推即重嵌 `site-latest.json`（raw.githubusercontent.com/xiaodernan/caesura/master/site-latest.json）  

> 注意：线上是 `?fresh=1` 的干净状态，页面证据文件总会对账最新 master；页面首屏可能短暂停在 boot 屏。

## 验证

```bash
npm run check          # tsc --noEmit + validate:data + 全部测试（6988 条 / 539 文件，零红）
npm test               # 仅测试（磁盘名册 539，曲线 6988）
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
| `docs/perf-baseline.md` | Phase 9 基本盘（KI-335／KI-418）：测了什么、两趟读数、不背书的边界、下一位接手清单 |
| `docs/spring-family-e2e.md` | 2026-11-10 Spring Cloud 家族本机端到端实证（host 直跑六件 jar 全绿；容器路径 KI-431 Blocked；常见坑 playbook） |
| `docs/spring-lore-service.md` | 2026-11-15 caesura-lore（族第八员）：世界谱只读后端 · Java BM25 双语检索 · memory\|redis 缓存 · `/lore/stats` 命中率 · e2e 四探针 |
| `docs/CHANGELOG.md` | 机器生成的主干变更索引（按 committer 月份升序，共 733 笔提交；commit 即准，不做主张） |
| `docs/phase7-plan.md` | Phase 7 基本盘：交付物逐格对账 + 美术/裁决与代码拆分 + F1-F4 可落任务（先量后动；不代笔美术） |

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
