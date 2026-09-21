# KNOWN_ISSUES / 技术债登记（需求 §78/§79）

状态词表：**Implemented** ｜ **Partial** ｜ **Placeholder** ｜ **Blocked**

## 1. Known Issues（已知问题）

| ID | 描述 | 严重度 | 状态 |
|---|---|---|---|
| KI-002 | 处决/背刺（§5.4）逻辑完整（触发 A/B/C、真伤公式、过载消耗、演出期无敌、i-frame、headless 测试覆盖），但**演出为简化蒙太奇**：无独立处决动画、无越肩推轨锁定镜头。 | P2 | Partial |
| KI-003 | 处决期"休止"全频低通听感（§5.4）与专属处决音效未接，暂用 `chord_slam`+`death_shatter` 占位。 | P2 | Placeholder |
| KI-004 | 手柄振动（§64）：`Haptics` 已按 combat.hit 的 shakeKey 分级驱动 `vibrationActuator.playEffect`，无手柄时优雅降级（已验），单元测试覆盖映射与调用。**实体振动主观手感未在接手柄设备复验**（本环境无控制器）。 | P2 | Partial |
| KI-005 | `npm run build` 单 chunk >500kB：`three` 未按 manualChunks 拆出（rollup 对 CJS 依赖分包限制），首包偏大。非阻塞。 | P3 | Partial |
| KI-006 | 引针枪蓄力「投掷枪」（§4.3）暂以强力突刺近似（flags `throw`），真实投掷弹体+钉住定身需远程弹道子系统（Phase 4/5）。 | P2 | Partial |
| KI-007 | 换武器时 ActorVisuals 的武器模型不变（仍音调叉巨剑外观）；外观随武器切换为 Phase 7 视觉打磨项。 | P3 | Placeholder |
| KI-008 | 区域流送逻辑完整，**表现层为灰盒**：`world/Streaming.ts`（48m 3D cell、激活环1/预载2/卸载3+2s 防抖、in-flight≤4、优先级、区域解锁门、teleport 同步加载、MissingRef 校验）+ `data/json/regions.json`（7 区域）+ `world/ChunkGreybox.ts`（按 `world.chunk` 事件挂/摘 InstancedMesh 板面与地标，全场常驻 2×7=14 drawcall）。缺的是**内容几何**：chunk 目前只有地面板面（无高度场/墙/植被/遗迹模块），区域间仍靠 `PlaceholderArena` 的平面兜底。 | P1 | Partial |
| KI-009 | RegionData 暂**不含 `navmeshRef` 实体**：`Navigation.ts` 未落地，regions.json 里该字段留空以免产生悬空引用（MissingRef 校验会报警）。 | P2 | Placeholder |
| KI-010 | Phase 3 验收①「实机从休垒走到未竟厅」只能在 headless+浏览器 tickFrame 层面验证（区域切换/预算/无泄漏/落层）；**视口评审（截图）仍被隐藏标签页阻塞**（canvas 0×0、rAF 暂停），需可见浏览器窗口。 | P1 | Blocked |
| KI-011 | ~~`Surface.floorAt` 不受 `unlockFlag` 约束~~ **已闭合（Phase 3-C1）**：`Surface` 现接受 `isClosed(region)` 闸门谓词，main.ts 注入 `!streaming.isRegionUnlocked(r)`；未解锁区域既没有可站面也没有交互物（`traversal.test.ts` 断言①）。剩余缺口只是灰盒表现：闸门「开合」没有动画/门模，仅表现为板面出现与提示文案。 | P1 | Implemented |
| KI-012 | 垂直通路：上行已用**遮蔽传送等价物**近似（`InteractableRef.to` + `world.travel` → `streaming.teleport` 同步激活脚下 chunk，实测共鸣井/吊桥/管风琴吊机把人送到 -144/64/152 层并正常落层）。缺的是**连续运动演出**：井笼升降/吊桥落板的路径动画与物理过程（当前是瞬时落点 + `gate_creak` 占位音），以及可破坏音壁的几何碎裂。 | P1 | Partial |
| KI-013 | **交互物在灰盒里不可见**：`Interactables` 只给焦点提示（`[E] …`）与结果文案，调音桩/闸门/井笼/落钟都没有占位模与范围指示——灰盒阶段「凭提示走路」。Phase 3-C2 起在 `ChunkGreybox` 里按 kind 挂占位棱柱（与地标同池），Phase 7 换成正式模。 | P2 | Placeholder |

## 1.5 系统状态总表（需求 §78，每 Phase 出口更新）

| 系统 | 状态 | 缺口 | 优先级 |
|---|---|---|---|
| 移动/相机/锁定/闪避 | Implemented | — | P1 |
| 命中判定/伤害管线（DR/背刺/弱点/破势） | Implemented | — | P1 |
| 防御阶梯（弹反>无敌>完美格挡>格挡>硬吃） | Implemented | — | P1 |
| 节拍时钟 BeatClock（攻防共用） | Implemented | 敌人 hit-frame 量化到拍槽 | P1 |
| 敌人 FSM（嘈壳/漂调者/驼鼓 基础 3 种） | Partial | 远程/幽灵/支援/精英/Boss 未做（Phase 4） | P1 |
| 处决 / 背刺（§5.4 A/B/C） | Partial | 见 KI-002/003 | P1 |
| 近战武器（调律剑 / 强音大剑 / 引针枪）帧数据+切换 | Partial | 弓/杖/隐藏刺剑未做（Phase 5 全解锁）；投掷枪见 KI-006；外观见 KI-007 | P1 |
| VFX 层 | Implemented | 4 池 InstancedBufferGeometry 渲染正常（修 aParam 属性溢出），灰盒 shader | P3 |
| 音频引擎 | Partial | 见 KI-003；Boss 主题/区域 ambience 未做（Phase 8） | P2 |
| HUD | Partial | 声纹 UI 基础；目标框/乐句线打磨待 Phase 7 | P2 |
| Combat/Enemy Debugger | Partial | F2 事件面板已含 chunk 流送行（active/resident/loading）；行为树可视化待补 | P2 |
| 区域数据（RegionData 7 区，IP_SEED §3/§10/§14） | Implemented | `src/data/json/regions.json`；六要素/色板/垂直层级/解锁 flag 全部数据驱动 | P1 |
| chunk 流送逻辑（§5.5：激活环1/预载2/卸载3+2s 防抖/in-flight≤4/优先级/整场预载/teleport/MissingRef） | Implemented | headless 17 条断言 + 浏览器 tickFrame 实测（maxActive 27、maxInFlight 4、区域序列正确、返回休垒后 loaded 回落无泄漏） | P1 |
| chunk 表现层（world.chunk → InstancedMesh 挂/摘） | Implemented | 灰盒：地面板面+地标棱柱，2×区域数 drawcall 恒定；7 条 headless 断言（容量按认领 cell 预算、往返不泄漏、实例版本增量≤事件量）；见 KI-008 缺内容几何 | P1 |
| 垂直分层地面（Surface.floorAt / player.floorY） | Implemented | 5 层 groundY 数据 + 7 条 Surface 单测 + 5 条落层流（掉落/台阶容差/陈旧 floorY 不回抬） | P1 |
| 导航网格 Navigation.ts | Placeholder | 见 KI-009：RegionData.navmeshRef 暂留空以免悬空引用 | P2 |
| 交互物系统（`world/Interactables.ts`，10 kind / requiresFlag / oneWay） | Implemented | 数据全在 `regions.json.interactables`（26 个），零 import three；`use()` 只返回结果，回血/传送/掉落由 main.ts 执行；7 条动线流断言（含提示文案与 E 键仲裁） | P1 |
| 区域闸门与垂直通路（音壁/吊桥/共鸣井/落钟 → flag → 解锁） | Partial | 全程只按 E 即可从休垒走到未竟厅（`traversal.test.ts` 实测 7 段链，实机 tickFrame 复验）；`flag.parry_taught` 仍需 Phase 6 剧情授予；运动演出见 KI-012，交互物无模见 KI-013 | P1 |
| HUD 交互提示（`ui.prompt` → `[E] 动词 · 区域`） | Implemented | 底部居中，焦点变化才发事件（不刷屏），淡入淡出；实机验证 prompt/promptA 与 fillText 落笔（隐藏标签页无法截图，KI-010） | P2 |
| 息声领灰盒穿行（Phase 3 验收①） | Partial | 逻辑+落层已实机可走（tickFrame 实测 0→64→-40→0），视口截图评审仍受隐藏标签页限制（KI-010） | P1 |

## 2. Technical Debt（技术债）

| ID | 描述 | 计划清理点 |
|---|---|---|
| TD-000 | 暂无 | — |

## 3. Performance Issues（性能问题）

| ID | 描述 | Before/After 记录 |
|---|---|---|
| — | 暂无（首次基准测试后登记） | — |

## 4. Missing Assets / Environment Limitations（缺失资产与环境限制，需求 §3）

| ID | 限制 | 替代方案 | 升级路径 |
|---|---|---|---|
| ENV-001 | **Unreal Engine 5 不可用**：本机无 UE5、无 C++ 工具链（Visual Studio/MSVC）、D 盘剩余空间不足（UE5 需 60GB+） | 经用户批准，Vertical Slice 以 Vite+TypeScript+**Three.js(WebGL2)** 实现；Nanite/Lumen/World Partition/GAS 等的等效/近似/降级映射见 docs/technical-architecture.md §1 | 保持 UE5 兼容的数据 schema（JSON DataAssets）与模块边界，未来可整体迁移；C++ 骨架列为远期交付 |
| ENV-002 | 无外部美术资产来源（禁商业资产，需求 §51/§85） | 全部程序化几何+原创 shader+低模占位，接口分层预留替换 | 高质量资产管线路径见 art-direction.md §资产管线 |
| ENV-003 | 无版权音乐/音效库 | WebAudio 程序合成（audio.md 规格） | 未来可换采样库，总线结构不变 |
| ENV-004 | 硬件：i5-12500H / RTX 3060 Laptop 6GB / 16GB RAM | 60fps@1080p 目标 + Low/Med/High/Ultra 档位 | — |
