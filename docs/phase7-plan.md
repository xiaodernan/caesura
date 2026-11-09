# Phase 7 基本盘 —— Visual Polish：现在到底还欠着什么，哪些是代码能做的

> 本页不改变 Phase 7 的验收标准（production-plan §Phase 7：① 截图评审六区域×3 机位／② 实机盲测／③ 极光带前后对比／④ 最高粒子密度可读性／⑤ 画质四档可选且生效）。
> 它做三件事：**① 按交付物逐格对账"今天在哪"；② 把哪些工作是代码、哪些是美术／裁决分开；③ 给出可立即开工的 F 系列任务，每条带落点与风险。** 不做：发起 Phase 7、代笔美术、编排裁决——出口评审仍由 Phase 7 自己的 G7（需求 §82 九项清单 + KI-010 可见窗口）签发。

---

## 1. 交付物逐格对账（以 2026-11-09 的主干为准）

| Phase 7 交付物 | 今天在哪 | 出口缺什么 |
|---|---|---|
| 六区域色板终版（休垒暖琥珀／雾语林灰绿金尘／钟坠院青铜落霞／深窖病白／营地灰血红／未竟厅金紫黑） | `regions.json` 每区 `palette.base/accent/glow` 三件存在且已绑 chunk 灰盒（调色板地板／呼吸灯／过渡带 KI-110 读它）；「终版」是**判据上的空**——颜色由谁签发没有第二主人答 | 美术签发；代码侧无空缺 |
| 区域光照参数表 | `lighting.json` 七行 + `lights` 四格（hemi/key/point 色强 + keyDir）+ `world/SceneLights.ts`（KI-109）——参数表已在，且过场景 100% 机器可读 | 数值审美调平（美术），代码无空缺 |
| 材质库（凝固声波纹／干涉条纹 shader 语言统一） | `vfx/materials.ts`：五色 hex 名册＋声纹（aOrigin 声源锚点＋正弦伪波＋双 lobe）＋粒子 uniform（uTime、重力解析积分）＋振核碎片——名册在，`tests/unit/vfx-materials.test.ts`（17 条）钉住了它的形状 | 无「凝固声波语言」**目录门**（每条 uniform／每颗 hex 都要在 art-direction.md §1 有名字且被点名）——代码可落（见 F4） |
| 原创低模资产替换（程序化+手工，接 glTF） | **0**。世界全是 chunk 灰盒 + 交互物陈设；无 mesh 管线；`gltf` 一词全仓无命中 | 资产管线建设 + 美术产出（非代码可做进度） |
| VFX 全量（拖尾／命中火花／声纹／雾尘／环境粒子／Boss 特效／凝声极光带天空） | 拖尾（`vfx/Trails.ts`，段数上限唯一主人 KI-330，**本周新钉了上限的腿** `vfx-trail-weapon.test.ts`）、贴花／发射器／声纹／同事三件套都有真载体；命中火花数据驱动（shake_table 侧）——缺：**凝声极光带天空**（无天空 mesh）、**Boss 特效**（入侵演出仅过场；无专属 VFX 套件） | 极光带要一个天空承载体 + 美术颜色；Boss 特效要设计（低成本起点：恩希尔脱壳那一拍的光柱，art-direction 已埋点 §尾部） |
| 天气系统 Clear/Rain/Fog/Storm（影响可见度+光照+音频+失谐速率） | 已落大半：`Weather.ts`/`WeatherSwitch.ts`（切换推导）/ `ColorGrade.ts` / `RainSystem` / `WeatherEffects.ts`（ambience×2／腐败率／浓度，KI-108）/ `lighting.json`；**Storm 还差「间歇冷光」**——要真材质和几何（KI-008 同因） | 间歇冷光（Phase 7 设计内的剩余两件：冷光时刻一串的时间点 + 冷光那层光源的载体） |
| 后处理链（bloom／色调映射／暗角／区域 color grading） | **0**。唯一载体是 `ColorGrade` 的 `canvas.style.filter` 字符串（失谐 → `saturate(0) brightness(0.7)`，天气切换时写）——它是 CSS 滤镜，不是后处理链 | 后处理设计与落地（F1） |
| UI 视觉终版（振膜面板／振幅条 HP／节拍环体力／乐句线 Boss 血条） | HUD：任务行、键位参考列；无任何血条／体力环／Boss 乐句线——Boss 相位只在 `F1` 调试面板和 `boss.phase` 事件上 | F3 |
| 动画补帧与混合修正 | **0** 动画基建——无骨架人物模型、无 rig、无 tween/帧混合 | 资产基建（阻塞） |
| **验收标准⑤ 画质四档全部可选且生效** | **0**：全仓无 quality tier 概念（grep `quality`/`画质` 零命中） | F2 |

## 2. 类别划分

**纯代码（headless 可验证，本会话系列的主力）**：F1（后处理链的可测侧）、F2（画质四档）、F4（凝固声波目录门 + 抬升那句「语言统一」为对账门）
**代码+可见窗口评审**：F3（UI 乐句线走查）、F1（final look）
**美术／裁决（非代码）**：色板终版、原创低模、动画、凝声极光带、Storm 间歇冷光的最后半格
**入口先行**：任何改动都必须先登记 KI 行（病→裁→读→欠），先量后动

## 3. F 系列（按「能先落地」排）

### F2 —— 画质四档（先做，headless 可证）

**目标**：新增一个 `quality` 格贯通「设置 → 存 → 读 → 执行」闭环，乘法落点选 headless 可量的地方（粒子预算、纹理分辨率影子档）；gl 相关落点只接线不做判据。

- **数据落点**：`src/settings/GameplaySettings.ts` 加一格 `quality`——不是第六格（§46 的五格表是一张被读过的表）；改写为**独立块** `qualitySettings` 或 schema v14→v15 加字段（先量后做的三角：`clampGameplaySettings` 对未知格的行为 → 存档 v14→v15 的迁移 → 五格表全文必须随迁移同步）
- **读者（最小集合）**：① `vfx/GPUParticles` 预算乘数（守卫：`tests/unit/quality-tier.test.ts`——每档粒子数上限×相应缩放）；② `Renderer` 的 `setPixelRatio` 档（单位腿：接受三档缩放 1.0/0.75/0.5 只在构造点注入，不进真实 window）；③ shadow map size（placeholder 分档，headless 跳过断言）
- **界面**：`ui/Stakerite.ts` 加第七页之外不——检查 `TABS` 会节省到第六页还是新加第六页之后（「环境」页？）—— **本系列第一件先做的事就是这条裁决：面板结构改动必须先小范围批起来（≤3 行面板改动），不能一翻天在此页拍板**
- **风险（写在实现前）**：save schema 迁移漏腿会写坏老档（`clampGameplaySettings` 的 no-migration 路径 vs `migrateV13toV14` 型号是成对久经）；x 档最差目标机过热（本机不一定跑得了），只量乘数不看实机=不闭环
- **完成判据**：persistence（testable）tick + settings page row + multiplier math + `npm run check` 绿；**不**声称极高档在任何真机上「可玩」——只声称旗帜与数学

### F1 —— 后处理链的「第一格」（不换一次性换完）

**目标**：把 `canvas.style.filter` 的最后一处生产读者（ColorGrade 失谐档）迁进一个真 Material pass，留给 Phase 7 出口门比对「迁前/迁后」。

- **落点**：`src/vfx/ColorGrade.ts` 下一格 `colorGradePass()`：读同一个 weather/失谐推导（`weatherSwitchFindings`，§解法入口只读仲裁者仍只它一个）；输出 `1 - 失谐归一化值` 作乘数；落点在 `main.ts` 的 `applyWeather(` 与 `grade.setWeather` 之间——迁移即一次同语义改造：`canvas.style.filter` 当场归零或删除
- **测试**：headless 走假画布（同现有 `color-grade.test.ts` 的口径）；新腿 `tests/unit/color-grade-pass.test.ts` —— 失谐 0/.5/1 三值，canvas filter 为 `''`；dissonance 增量不动霧密度
- **风险**：真 ShaderPass 编译失败未验证（无 WebGL）⇒ 本批只能做到「迁后是同义画布操作」，升级真 pass 挂在 G7 的可见窗口门后代签发；**不在这一批里提早声称 visual ready**

### F3 —— Boss 乐句线 HUD：先画再辩

**目标**：`hud.bossPhrase(bar_beat, phraseIdx, total)` 的显示层（不是规则）。

- **落点**：HUD 右侧中条（与调试面板不同），订阅 `ui.notify`/`boss.phase`/`beats` 现有事件族；实际渲染（表现层）单独拆成 `ui/BossPhraseBar.ts`（零 game 依赖，只读渲染器）
- **headless 验证**：`tests/flow/boss-phrase-hud.test.ts` —— 真 AISystem+真 RhythmClock+`tickFrame`-发 tick 一轮，量渲染输入（tick in beat/bar position into DOM text）；不比截图
- **风险**：出场时空载条/过场时第三段没人切入（HUD 直播节奏不跟 CameraRig）；`boss.phase` 事件被花掉在别处（无独占）

### F4 —— 凝固声波目录门

**目标**：让 art-direction.md §1（语言统一）自己变成机器可读的目录，再让 `vfx/materials.ts` 的五色与声纹波都必须住在它上面，缺了就红——与 KI-296/vfx-hue-table 同族门。

- **落点**：`art-direction.md` §NEW 目录条（首个「凝固声波纹／干涉条纹／振核」三组）；门住 `scripts/id-scope-rules.mjs` 家族或 `tests/unit/vfx-soundwave-catalog.test.ts`——后者简单：读 §1 slice，对 `VFX_PALETTE` 五颗 hex 与声纹函数名做集合对账
- **风险**：文档改动与 §55 冲突——「语言统一」给了词没有给主人，本门补主人；美术语句措辞打开要 AR（§1 是 art-direction 的受保护区，按行规 copy 再谈判）

## 4. 阻塞出口登记（不动的原因对系数来说）

| 格 | 阻塞在 | 何时能动 |
|---|---|---|
| 极光带天空 mesh | 美术要先签发 §8「无太阳 + 极光」的具体色带（KI-008 同原因：没有真几何就没有天） | 关卡资产批 |
| 原创低模 | glTF 管线零基建；art-direction 明确「低模+程序化，接口=glTF」（方向边界） | Phase 10 前的资产批 |
| 动画 | 零骨骼人物模型；混合修正只对 rig 有意义 | 同上；不是一行代码能开头的 |
| G7 评审（截图/盲测） | KI-010：headless 无窗口；测 tools/force_quit 之外不可见 | 该车道单独开机 |
| Storm 间歇冷光 | 几何 + 真材质；§8 的位置自己说「间歇冷光」没说间隙参数——艺术数 | 裁决后 |

## 5. 已落与本计划的关系（不要重复今天的口径）

色板绑了 `paletteBlendAt`（KI-110）、三层光落了 `SceneLights`（KI-109）、雨／雾／失谐落了 KI-094+108、
`vfx-trail-weapon.test.ts` 新钉了段数上限的腿，12 只混编基本盘入 `perf-baseline.md`（KI-418/335）、
item 幽灵在 `unaware-rows.test.ts`（KI-417）按名册监控。**Phase 7 的出口哲学不变：可见窗口的签发不能机器替代。这页只是把"能做的"装进巷子。** 任何新腿开工前必须先有 KI 行。
