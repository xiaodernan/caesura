# CAESURA《止音纪元》— Technical Architecture（技术架构）

> 状态标注约定（需求 §78）：Implemented / Partial / Placeholder / Blocked。
> 本文档当前为 **Implemented（文档层）**——Phase 0 写的规划，此后每个 Phase 交付时同步更新（最近一次：2026-09-26）。
> **§2 那张目录表是"目录已定不得更改"的规划，不是交付清单**；真实树与它的逐条差异在 **§2.1**，读实现位置先看那一节。
> 关联文档：`docs/IP_SEED.md`（创意基线，唯一合法名词表）、`docs/KNOWN_ISSUES.md`（技术债登记，见 §8）。

---

## 1. 技术基线偏离说明（Tech Baseline Deviation）

### 1.1 环境事实与决策记录

需求 §3 的技术基线为 UE5 + C++。经本机环境核查（需求 §91 Step 1/2，§78「不得伪装」）：

| 检查项 | 事实 |
|---|---|
| UE5 引擎 | **未安装**，且安装需 ~75GB 磁盘 |
| C++ 工具链 | 无 MSVC / Windows SDK |
| 磁盘空间 | 不足以容纳 UE5 + Project WAL |
| 用户决策 | **已批准**以 Three.js 浏览器栈实现 Vertical Slice，UE5 保留为升级路径 |

硬件：i5-12500H（12C/16T）/ RTX 3060 Laptop 6GB / 16GB RAM。目标 **60fps @ 1080p**（需求 §48）。
结论：UE5 路线 **Blocked**，替代方案如下。替代栈选型理由：TypeScript + Three.js r16x + Vite + WebGL2，全部为 npm 依赖，无磁盘/工具链门槛；WebAudio/WebGL2 能力足以支撑本作的程序化美术与节奏化战斗核心玩法。

### 1.2 UE5 → Three.js 映射表（逐项标注等效等级）

| UE5 特性 | Three.js 替代方案 | 等效等级 | 说明与差距 |
|---|---|---|---|
| Nanite（虚拟化几何） | 手工 LOD 组（3 级）+ `InstancedMesh` 植被/岩体 + Draco 压缩 glTF | **近似** | 无逐集群（cluster）LOD 与软件光栅；以「实例化 + 距离分级网格」在 6GB 显存预算内达到同量级 drawcall 控制 |
| Lumen（动态 GI/反射） | 烘焙 AO（lightmap/vertex AO）+ SSAO 后处理 + 屏幕空间反射（仅 High/Ultra 档，平面近似）+ 环境光探针（每区域一组 `PMREMGenerator` env map） | **降级** | 无真实动态 GI；「凝声极光带」天光用 IBL 探针 + 每区域 2~4 个烘焙光变体近似「光照 mood」（需求 §37）；动态光源仅限 ≤8 个 punctual light |
| World Partition / Level Streaming / Data Layers | 区域流送：chunk streaming（§5.5），每区域独立 scene graph 片段，按玩家位置 activate/deactivate；Data Layer 等价物为 `layerMask`（环境层/玩法层/剧情层分开卸载） | **近似** | 无网格级（Nanite cell）流送，粒度为 chunk（48m）；传送需触发强制同步加载 + 黑屏遮蔽 |
| Behavior Tree / Blackboard / EQS | 自研 TS 行为树（`ai/bt/`：Selector/Sequence/Decorator/Service 节点 + Blackboard `Map<string,unknown>`）；EQS 由「查询生成器」近似：候选位置打分（距离/视线/掩体） | **等效**（简化版） | 无编辑器可视化（用 `tools/AIDebugger` 面板树形打印替代）；节点类型先实现 8 种够用即止。**⚠️ 2026-09-26 对账：这一行是当初的选型理由，不是现状**——实际落的是「距离带 → 招式选择表」的数据查表，`ai/bt/`、Blackboard、EQS 全都不存在（§2.1-B）；`tools/AIDebugger.ts` 到 KI-058 才落地，但它打印的是 **FSM 状态与选招过程**，不是"行为树执行路径"（本作没有行为树可打印）。按今天的树读，本行的等效等级应记为**缺失且换了路线** |
| State Machines | 分层 FSM（HFSM）手写状态类，需求 §20 的 11 态全覆盖 | **等效** | — →**对账修正**：11 态确实一个不少（`EnemyState` 联合类型 + `enter()`），但**没有 HFSM 基类也没有分层**，是一份手写 switch（§2.1-A） |
| UMG / Common UI | DOM（HTML/CSS）做菜单栈/背包/对话 + 单个 overlay canvas 做 HUD 实时元素（HP 振幅条、节拍环）；`ui/` 统一 Widget 栈管理焦点/输入捕获 | **降级** | 无矢量缩放 DPI 自动适配（用 rem + canvas scale 手工处理）；材质化 UI（振膜质感）靠 CSS backdrop-filter + canvas shader，效果上限低于 UMG |
| Niagara GPU 粒子 | 自研 GPU 粒子：`InstancedBufferGeometry` + 顶点动画 shader（生命周期/速度/颜色写入实例属性，CPU 仅管理发射器）；CPU 回退路径给 Low 档 | **近似** | 无模块图编辑器（发射器配置全部 JSON 数据驱动，见 §3 SkillData.vfx）；流体/ribbon 拖尾用定制 tube shader 单独实现。**对账**：这套机制**落了，但只有三类**——ring / spark / shard（`vfx/VfxLayer.ts` + `vfx/materials.ts`）；`vfx/GPUParticles.ts`、`Trails.ts`、`Decals.ts` 三个文件名与拖尾/贴花能力均未落（§2.1-B），CPU 回退路径同理未落 |
| MetaSounds 程序化音频 | WebAudio 图程序合成：振荡器/噪声源/卷积混响（生成式 IR）/参数自动化；音乐节奏系统用 `AudioContext.currentTime` 采样级 BPM 网格（需求 §11 音频方向：攻击与 BGM 同网格） | **等效**（对本作反而贴合） | 本作音乐即玩法（节拍可读性、幽灵八的拍隙机制），采样级时钟比 Niagara 式事件更关键；差距：无空间音频 HRTF 内置（自写 PannerNode + 距离模型近似） |
| Montage / Anim Blueprint / Blend Spaces | 动画片段混合器（`player/anim/MontagePlayer`）：glTF animation clips + 分层（上身武器层/全身层）+ 1D/2D BlendSpace（走跑稀疏插值）+ Additive 层（受击抖动）；montage 式帧数据驱动攻击判定（见 §3 帧数据） | **降级** | 无 Control Rig / Motion Warping（用根运动预烘焙 + 命中时手工对齐位移修正替代 IK 步对齐：单骨 look-at IK 自写）；`THREE.AnimationMixer` 需封装事件轨道 |
| Gameplay Ability System (GAS) | 轻量 ECS 风格组件（§57）：`AbilityComponent` + `EffectComponent`（DoT/护盾/状态效果，tag 化：`status.mute`、`status.fissure.3`）+ 属性集（GameplayEffect 等价 = JSON 修饰符栈） | **近似** | 无复制预测（单机不需要，属**缺失且合理**）；预测/回滚：不做（本地单机无网络） |
| VSM 阴影 | 级联阴影贴图 CSM（3 级，1080p 下 2048 图集，Med 以下 1 级/关闭） | **近似** | 远处阴影用 blob shadow 兜底 |
| TSR 超采样 | 无正式等效：提供 `renderer.setPixelRatio` 分辨率缩放（0.7/0.85/1.0）+ FXAA | **降级** | 无时域重建（TAA 有输入延迟问题，动作游戏优先禁用，用 FXAA） |
| Chaos 物理 | 不需要通用物理：自写胶囊-地形角色控制器 + 球体/胶囊/扇形命中测试（见 §2 combat）；散落物用极简刚体（仅翻滚盒） | **等效**（范围裁剪） | 无布料/破坏物理——发袍飘动用顶点 shader 摆动近似 |
| Control Rig / IK / Motion Warping | 单骨 look-at（脚贴地射线 + 上肢指向）；无全身 IK | **降级** | 记录于 KNOWN_ISSUES TD 表 |
| Sequencer 过场 | 数据驱动镜头序列（`world/cinematics`：关键帧相机路径 + 动画 clip 触发，JSON 描述） | **近似** | 需求 §31 的 5 段过场够用 |
| 手柄震动 | `Gamepad.hapticActuators[0].playEffect(duration, strength)`（Chromium 支持；不支持时降级为无震动并在设置页标注） | **近似（有条件）** | Safari/Firefox 桌面不支持——条件特性检测 |
| C++ 热重载 | Vite HMR | 超出基线 | 开发效率优势，如实记录 |

**升级路径保持**（需求 §3「保持未来升级路径」）：所有 gameplay 逻辑（伤害/帧数据/AI/存档 schema）与渲染层解耦——`core/`、`combat/`、`ai/`、`rpg/`、`quest/`、`save/` 不得 import three（ESLint 规则强制，见 §5.8）；迁移 UE5 时这些模块按原语义翻译为 C++/GAS，JSON 数据资产直接映射为 Data Asset。

---

## 2. 模块架构（需求 §56，目录已定不得更改）

依赖规则（单向，禁止反向 import）：`data ← core ← {player, combat, ai, rpg, quest, audio, vfx, save} ← world ← ui ← tools ← main`。`vfx`/`audio` 只消费事件总线上的信号（`combat.hit`、`vfx.spawn`），gameplay 模块**永不**读取 VFX 返回值。

```
src/
  core/
    GameLoop.ts        固定步长逻辑 60Hz（accumulator 模式，1 tick=16.667ms，
                       单帧最多补 5 tick 防 death spiral）+ 可变步渲染（lerp 插值根运动）
    Time.ts            全局时钟/暂停/慢动作（timeScale 0.05~1，HitStop 与休止处决用）、
                       逻辑帧计数（所有帧数据以 tick 为单位，见 §3）
    Input.ts           键鼠 + Gamepad（Polling 每 tick；虚拟按钮：move/attackL/attackH/dodge/
                       block/lock/interact/skill1-3/map/pause；remapping 数据存 settings；
                       死区 0.2，触发阈值按下/抬起分离）
    EventBus.ts        类型化事件总线（EventMap 泛型约束事件名与载荷，禁止字符串裸事件）
    SceneGraph.ts      Three.js 场景管理：区域子场景挂载/卸载、相机切换、layerMask
    Registry.ts        资源 registry：glTF/纹理/音频/JSON 的 load/get/preload 引用计数，
                       全部走异步加载 + 占位资源兜底
    Occlusion.ts       世界遮挡的**一条线段**（KI-014①②）：`firstBlock(occluders, a, b, expand)` 回答
                       「a→b 被哪块竖直遮挡体**先**截断、截在哪一点」。两种截面共用同两条口径：
                       `cylinder`（`boss.covers` 的断音柱/钟）走 xz 二次方程 + y 带，`box`（`regions.json > walls`
                       的 authored 塌墙/岩脊，轴对齐）走三轴 slab 裁剪；"起点在体内不挡""贴脸不挡"两边同解。
                       五个读者共用它：弹体扫掠段、打在玩家身上的那一记、telegraph 红线、**敌人的视线**、**玩家自己挥出去的那一刀**
                       （KI-014②b：`ai.sightBlocked` 由组合根接到 `occlusion.blocked`，两端取身体中心）。
                       玩家的近战是"扇形点头之后、线段再否决"——扇形管谁在这一记里、线段管刃到不到得了，一把尺子不量两件事（KI-070）。
                       `OcclusionField` 是名册，两条输入通道住同一个数组：`syncAuthored(region)` 写关卡墙
                       （跨区才重写一次，固定在前部），`syncFrom(entities)` 每 tick 就地改写实体柱子（尾巴），
                       于是热路径上仍只有一次遍历、零分配。读者清单只列一次（上面那句）——
                       这一格从前在同一个段落里数了两遍（"四个读者"与"三个读者"并存），两句话都对不上代码，KI-070 对账时删掉第二份
  player/
    ThirdPersonController.ts  胶囊角色控制器：move/sprint(耗体力)/jump/dodge(i-frame 窗口
                       数据驱动)/fall(落地硬直按高度分档)；贴地射线 + 台阶自动上 0.4m
    CameraRig.ts       弹簧臂 + 碰撞回弹（球体射线 5 点采样）；模式：exploration/combat/
                       lockOn/boss(独立行为：更近、略微低角度、target bias 0.7)/cinematic
    LockOn.ts          目标评分锁定（在射程内取"角度项 + 距离项 + Boss 加分"的加权和，四个数自 KI-084
                       起住在 `player.json > lockOn`）；切换循环、超距与死亡脱锁；
                       规划那句"8m 内圈 / 锥形角上限 / 遮挡脱锁 / boss 强制单锁"里没有一样成立，见 §2.1 B 表
    Attributes.ts      属性组件：base+modifier 栈（来自装备/buff/等级），脏标记重算
    anim/MontagePlayer.ts    动画片段混合器（§1 Montage 等效）：slots(upper/full/body)、
                       additive hit 层、blend space 1D(走跑)、动画事件轨道 → 发 EventBus 事件
  combat/
    AttackSystem.ts    帧数据驱动攻击（§3 帧数据）：montage 播放→tick 事件推进→
                       激活 hitbox→注册命中。一次 swing 只允许一次命中标记(hitOnce)
    DefenseSystem.ts   格挡（减伤%+体力消耗）/完美格挡(8tick 窗口)/弹反(攻击命中前
                       10tick 窗口→parry 事件→架势大伤+攻方硬直)/i-frame 闪避
    DamagePipeline.ts  伤害管线（纯函数，可单测）：
                       base(weapon)→attr scaling→防御(护甲/格挡)→弱点点位→背刺→状态
                       (Fissure 碎裂)→弹反倍率→随机方差±5%→抗性→最终伤害+架势伤害
    HitStop.ts         命中停顿：全局 timeScale 压到 0.05 持续 60~140ms（按招式表配置），
                       自伤/被弹反更长；与音效首波同帧触发（§4）
    HitReaction.ts     受击反应分档：flinch/light stagger/heavy knockdown/处决特写，
                       按「伤害/当前HP 比 + 攻击强度 tag」选择，播 additive 抖动层
    Poise.ts           架势条：受击积累、脱战衰减、破防→stun 态 2.5s（处决窗口）
    StatusEffects.ts   §13 状态：Fissure 层数 / Mute 禁技能 / Echo 延迟重演 /
                       Corruption 褪色值 / Overdrive 资源条；EffectComponent 承载
    HitShapes.ts       命中判定几何：sphere(即时)、capsule(挥砍扫掠：起止两球体插值)、
                       cone 扇形(AOE/锥形喷吐)；全部 vs 胶囊体(目标)相交测试，无物理引擎
    Projectiles.ts     弹道运动学（纯逻辑，§5.9）：半隐式欧拉 + 重力/射程/寿命过期、
                       pierce 与 hitIds 去重、withOwner 归属查询、reap 一次性回收通知；
                       不含任何碰撞判定（那是 CombatManager 的职责，见 §5.9）
  ai/
    StateMachine.ts    分层 FSM 基类（Idle/Patrol/Investigate/Alert/Chase/Combat/
                       Retreat/Search/CallAlly/Recover/Dead，需求 §20）
    bt/                行为树节点（Selector/Sequence/Parallel/Condition/Inverter/
                       Cooldown/Service + Action）；战斗决策树：距离带→招式选择表
    Perception.ts      **未落为独立文件（换了载体，不是缺失）**：视觉=视锥（`ai.vision.range/fovDeg`）
                       **+ 遮挡线段**（KI-014②b：`sense()`/`sawImpact()` 都问 `ai.sightBlocked`，
                       问的就是挡箭的那同一个名册）与**听觉**（EventBus 订阅
                       footstep/attack/dodge 声源事件→声波球半径→噪声吸引 aggro）。
                       听觉是隐藏 Boss 万籁「声音狩猎」的核心机制：声源事件统一带
                       loudness 标量，AI 按 loudness/距离 计算 suspicion——必须作为
                       一等公民设计，不能后补。**这一句已经成立**：三条通道都在
                       `Enemy.sense()`（视觉 + 震动）与 `Enemy.hear()`（听觉）里，10Hz 轮转在
                       `AISystem.update`；把它拆成独立 `Perception.ts` 只是当年的一种布线选择
    Navigation.ts      简化 navmesh：每 chunk 预烘焙导航网格（离线脚本或首帧烘焙 worker）、
                       A* + string-pulling 平滑；动态绕行=局部转向（velocity obstacle）
    Squad.ts           编队/aggro：共享 blackboard 的 camp 引用，仇恨分配（越后置入战斗
                       的敌人等待槽位，槽位上限 3——避免围殴不可读），CallAlly 广播
  world/
    Region.ts          区域定义（RegionData 驱动，§3）：Resthold/Whisperwode/
                       Fellcarillon/EarlessDeeps/BrokenbarCamp/DrownedChoir/UnfinishedHall
    Streaming.ts       chunk 流送（§5.5）
    Surface.ts         垂直分层落点查询 floorAt（RegionData.groundY + 区域闸门，§5.5）
    Interactables.ts   交互物运行时（§65「交互」）：焦点/半径查询、requiresFlag 判定、
                       setsFlag 解锁、oneWay 消耗；只发事件与结果，落地由胶水层做（§5.5）
    SpawnDirector.ts   数据驱动出怪（§66「敌人布置」/§5.5）：spawnGroups → 稳定槽位（region:group:member），
                       world.chunk 进/出 active 即出怪/回收，entity.died 记永久清剿，
                       flag condition 闸门 + maxAlive 预算；不认识 three，不持有敌人实例
    ChunkGreybox.ts    chunk 灰盒表现层：world.chunk → InstancedMesh 挂/摘（§5.5）
    WallGreybox.ts     authored 墙体灰盒（KI-014②）：`regions.json > walls` 那张表里每一块墙一张
                       InstancedMesh（单位立方体 × 每块墙自己的缩放），全场常驻 1 个 drawcall；
                       跟着 world.chunk 挂/摘、预载格压暗 45%，格键由组合根注入（本层不 import 流送运行时）。
                       它存在的理由是**遮挡必须是看得见的**：判据先落地而几何没出现，玩家会挨一发"被空气挡住的箭"
    InteractableGreybox.ts 交互物占位模：按 kind 分池的 InstancedMesh，跟流送挂/摘、
                       随 ui.prompt 高亮、按 flag 谓词压暗消耗态（§5.5，Phase 7 换正式模）
    ProjectileVisuals.ts 弹体表现层：按 kind 分池的 Mesh（长枪=长条盒、音符=二十面体…），
                       每 tick 只读 combat.projectiles.list() 同步位置/朝向/脉冲（§5.9）；
                       另按 ownerId 池化 telegraph 赤线（§14.4，syncTelegraphs）
    PlaceholderArena.ts 起始占位场（灰盒地形到位前提供可玩平面+节拍信标）
    generators/        程序化生成器（需求 §52，关键区域手工摆放物件覆盖）：
                       TerrainGen(高度场+侵蚀噪声)、FoliageGen(泊松盘+实例化)、
                       RockGen(噪声扰动 icosphere)、RuinGen(模块拼贴：柱/墙/拱+波纹纹样)
    Weather.ts         Clear/Rain/Fog/Storm：粒子+雾参数+光照+ambience 音频交叉淡入，
                       区域天气由 RegionData 与铃姨任务 flag 驱动（IP_SEED §7）
    Lighting.ts        区域光照预设（极光带 IBL 梯度、光探针切换、色板 = IP_SEED §10）
    Interactable.ts    交互物组件（拾取/机关/共振门/调音桩/对话），E 键提示射线
  rpg/
    Inventory.ts       格子背包（堆叠/分类/排序/过滤，需求 §44），纯数据可单测
    Equipment.ts       装备槽（武器 L/R、头/胸/手/腿、护符）+ 属性重算 + 外观换装 hook
    Progression.ts     等级/音级属性点/经验曲线（§3 数值表）、调音桩分配 UI 数据
    Loot.ts            掉落表（加权随机 + 两条保底 pity 计数，seeded RNG 可复现测试）
    Settlement.ts      击杀结算与拾取编排（Phase 5-C3）：entity.died → 掉落 → 播报 → refresh → 检查点；
                       refreshPlayer/openLootTable 是组合根与测试共用的同一份胶水，故 dispose() 必须存在
    Upgrade.ts         音色石强化（武器 +1~+10，无失败无销毁，上限按稀有度封顶，材料不够一分不扣）
    Movements.ts       乐章战技谱册状态（Phase 5-C2）：页点亮/式等级/两槽配装，合成给玩家的 {f, cast}
  quest/
    WorldState.ts      世界状态写入层（Phase 6-A 已落）：`worldstate.json` 的规则表 ⇒ 立旗 + 播报；
                       只走 bus，自己不存旗标
    QuestState.ts      任务状态机：notStarted→active(step k)→completed/failed，
                       目标条件订阅 EventBus 计数
    WorldFlags.ts      全局 flag 仓（位图 + 命名 bool/int/string 三层），存档序列化，
                       条件表达式解析器（"flag.boss_ostlara_dead && npc.meg_present"）
    DialogueRuntime.ts 数据驱动对话树（DialogueData §3）：节点条件（quest+world+choice
                       历史，需求 §30 NPC state 公式）、选项效果原子集（giveItem/setFlag/
                       startQuest/playCinematic）
  ui/
    Hud.ts             HUD canvas：HP 振幅条/Stamina 节拍环/Overdrive 条/目标标记/
                       Boss 乐句进度线（IP_SEED §10）
    MenuStack.ts       菜单栈（push/pop/模态/输入捕获切换/gamepad 焦点导航）：主菜单/
                       背包/装备/地图/任务/技能/设置/存档
    MapUI.ts           地图（需求 §43）：区域手绘 SVG + 已探索遮罩、缩放/平移/标记
    DialogueUI.ts      对话 UI：打字机、声纹装饰、选项呈现
  vfx/
    GPUParticles.ts    GPU 粒子系统（§1 映射）：发射器配置 JSON、实例属性环形缓冲
    Trails.ts          武器拖尾（tube ribbon shader，fade 沿弧长）
    Decals.ts          贴花（弹痕/震纹，投影 quad + 深度防穿插）
    ImpactRings.ts     冲击环（声纹母题核心特效：命中/敲钟/休止的扩散波纹 shader）
  audio/
    AudioGraph.ts      WebAudio 图：master→bus(sfx/music/ambience/ui)→limiter→dest；
                       3D 位置(距离衰减+声像)；总线音量=设置页
    RhythmClock.ts     BPM 网格时钟（§11）：调度器 lookahead 100ms，向 EventBus 发
                       beat.bar/beat.heavy —— 供 AI 动画、幽灵八拍隙、环境伤害乐句读取；
                       休止状态=master 低通扫频
    Synth.ts           程序合成 SFX（武器挥/金属撞击/钟（FM 加性合成，本作的钟是内容主角））
                       + 少量 ogg 采样素材混用（接口统一 SoundAsset）
    Mixer.ts           音乐分层淡入淡出（exploration/combat/boss 主题共享 C 多利亚调性，
                       按 §11 转调规则）
  save/
    Serializer.ts      存档对象 = {version, playSec, region, player, flags, clearedSlots}
                       （inventory/quest/settings 到了对应 Phase 再加字段 = 走 Migration 链）
                       → JSON 明文写 localStorage(主) + IndexedDB(备份)
                       ※ 原设计的 LZString 压缩未引入：那要多一个依赖，而这份存档 <2KB，
                         收益远小于成本（需求「零新增依赖优先」）。差额记在 KI-025
    Checkpoint.ts      autosave 触发器（调音桩休息/Boss 阶段切换/区域首次进入）
    Slots.ts           槽名册：自动槽 + 手动槽×3（需求 §45），每格一张摘要卡（四态 + 坏因原话 + 恢复来源）；
                       只读不改世界，与 load() 共用 Serializer.readSlot 那一条候选顺序
    Integrity.ts       防损坏：双写（slot→slot.tmp 写完后 rename 语义双键位交换）、
                       CRC32 校验和、magic+schemaVersion 头；读档校验失败→自动回退
                       上一份并提示（需求 §45）
    Migration.ts       schema 迁移链 v1→v2→…逐级 migrate 函数表，禁止读旧档直接崩溃
  data/                JSON 数据资产（构建期 import，§3 规范；运行时不 fetch 散文件）
  tools/               运行时调试器（需求 §54，F1~F4 呼出，仅 DEV=import.meta.env.DEV）
    EnemyDebugger.ts   F1：当前状态/目标/aggro/距离/下一步动作（每敌人浮标签+面板列表）
    CombatDebugger.ts  F2：hitbox/hurtbox 线框、伤害/体力/架势实时值、当前招式帧号
    QuestDebugger.ts   F3：任务状态树/NPC 状态/world flags 编辑器
    AIDebugger.ts      F4：行为树执行路径高亮（ASCII 树）/blackboard/感知射线可视化
  main.ts              组装：Registry preload → boot 场景 → GameLoop.start
```

---

### 2.1 这张表的对账（2026-09-26，按真实 `src/` 树逐条核）

> 上面那张表是 **Phase 0 的目录规划**（需求 §56「目录已定不得更改」），不是交付清单。它在过去几周被
> 当成了清单读，于是"表里有 `ai/Navigation.ts`"被理解成"项目里有导航"。这一节把两边对上：
> **A = 文件名没落但职责落了（换了载体）**，**B = 文件名和职责都没落（真缺口）**，
> **C = 真树里有、这张表没写（后来长出来的）**。可复跑的事实来源只有一条命令：`find src -name '*.ts' | sort`
> （本轮 **72 个文件**（KI-058 之后；本节初稿核的是 68）：其中 `src/data/json/` 那些 `.json` 不计，本闸门只核 `.ts`）。分层与依赖箭头没有因为对账而改变，但**有两层是规划外新增的**，见 C 表的 `input/`。

**A. 换了载体：表里的路径不存在，职责确实每天都在跑**

| 规划路径 | 真载体 | 差在哪一句 |
|---|---|---|
| `core/SceneGraph.ts` | `main.ts` 建 `THREE.Scene`，各表现层跟着 `world.chunk` 自行挂/摘（ChunkGreybox / WallGreybox / InteractableGreybox / ActorVisuals / ProjectileVisuals / PropVisuals / BossArenaVisuals / VfxLayer） | **layerMask 与相机切换未做**：场上还没有需要分层的正式美术（KI-008 同因） |
| `player/Attributes.ts` | `combat/EntityStats.ts` | 玩家与敌人共用同一份 base+modifier 栈与按 tick 的衰减，脏标记重算没做（每 tick 重算，量小） |
| `player/anim/MontagePlayer.ts` | `combat/ActionFrames.ts`（纯 tick 帧数据）+ `world/ActorVisuals.ts`（灰盒位姿） | **动画剪辑混合器、BlendSpace、Additive 层、glTF clips 全未落**（KI-008）。KI-017 之后帧数据本来就不依赖动画时标，所以这条缺口不挡玩法 |
| `combat/AttackSystem.ts`、`combat/DefenseSystem.ts`、`combat/HitStop.ts`、`combat/Poise.ts` | 四份合并进 `combat/CombatManager.ts` | hitOnce、三档防御阶梯、§9 情境停顿、架势积累/衰减/破防**都在这一个文件里**。§1.2 映射表按职责读仍成立，按文件名读不成立 |
| `combat/HitReaction.ts` | `combat/Reactions.ts` | §8 四档（KI-050/KI-052） |
| `combat/StatusEffects.ts` | `combat/Statuses.ts` | 震裂/闷音/回响/失谐/超载五键全数据化（Phase 5-C1） |
| `ai/StateMachine.ts` | `src/ai/Enemy.ts` 的 `state` 联合类型 + `enter()`（调度轮转在 `src/ai/AISystem.ts`） | **十一个状态一个不少**（需求 §20），但没有"分层 FSM 基类"这层抽象——它是一份手写 switch |
| `ai/bt/`（8 种节点 + Blackboard + EQS 打分） | **从未存在** | 决策的实际形态是"距离带 → 招式选择表"的**数据查表**（`enemies.json > ai`），改表即改行为。§1.2 那行「自研 TS 行为树 = 等效」按今天的树读**不成立**，已在本节记下（不改 §1.2 的映射表，那是当初的选型理由） |
| `ai/Perception.ts` | `Enemy.sense()`（视觉 + 震动）/ `Enemy.hear()`（听觉） | 表内已注明；KI-014②b 之后视觉那半条吃遮挡 |
| `world/Region.ts` | `data/json/regions.json` + `data/schema.ts` 的 `RegionData`；读取与闸门在 `world/Streaming.ts`，垂直落点在 `world/Surface.ts` | 区域是 **JSON 而不是类**——这本来就更符合 §55，规划时写成了面向对象 |
| `world/Interactable.ts` | `world/Interactables.ts` | 复数是唯一差别 |
| `quest/QuestState.ts` | `quest/Quests.ts`（+ `quest/Settlement.ts` 落选项效果） | 三步机已落（notStarted→active(step k)→completed）。需求 §30 的 NPC state 公式在 `quest/Dialogue.ts` 的条件里，不是独立状态机 |
| `quest/WorldFlags.ts` | `world/Streaming.ts` 的 `flags: Set<string>` | **只有命名 bool 这一层**：位图、int/string 层、条件表达式解析器（`"flag.a && npc.b"`）都没有。今天读旗的口径是 `hasFlag/setFlag/flagKeys`，写旗的口径是 `quest/WorldState.ts` 的规则表 |
| `quest/DialogueRuntime.ts`、`ui/DialogueUI.ts` | `quest/Dialogue.ts`（纯函数树）+ `ui/DialogueBox.ts`（表现） | 逻辑与表现分家比规划更干净：`Dialogue.ts` 不 import DOM |
| `audio/AudioGraph.ts` | `audio/AudioEngine.ts` | 图结构一致（master→bus→limiter→dest），limiter 用的是 DynamicsCompressor |
| `audio/Synth.ts` | `audio/synth.ts` | 只有大小写 |
| `vfx/ImpactRings.ts` | `vfx/VfxLayer.ts` + `vfx/materials.ts` | ring/spark/shard **三类**共用一套"每类一张实例几何 + 一份 GLSL + 一个 Pool"的做法 |
| `core/RhythmClock.ts`（表里写在 `audio/`） | `core/RhythmClock.ts` | **换了层**：它发 `beat.*` 事件、不碰 WebAudio，按依赖规则本就该在 core |

**B. 表里的路径不存在，职责也没落——这些是真缺口，不是改名**

| 规划路径 | 状态标签（§78） | 归属与后果 |
|---|---|---|
| `ai/Navigation.ts` | Placeholder | KI-009：`regions.json > navmeshRef` 故意留空以免悬空引用；敌人的移动现在是"朝目标走 + 距离带停"，不会绕墙 |
| `ai/Squad.ts` 的仇恨槽位（上限 3） | 未落 | `callAlly` 只有广播（`ai.callAlly` 事件 + 半径判定），没有"后置入战斗的敌人等槽位"，围殴可读性这条还没做 |
| `player/CameraRig.ts` 的模式枚举与碰撞回弹 | 未落 | 现在的 CameraRig = 平滑跟随 + §10 震镜表 + FOV 脉冲 + 处决推轨 + 锁定时的 target bias；**没有 exploration/combat/lockOn/boss/cinematic 五个模式，也没有弹簧臂射线回弹**（球体射线 5 点采样那句是规划） |
| `player/LockOn.ts` 的规划四句：`8m~35m 锥形` / `遮挡脱锁` / `boss 强制单锁` | 未落 | **KI-084 把数接进表时逐句核过代码**（不是照抄 §2 那行）：①没有 8m 内圈，也没有任何角度上限——`liveCandidates()` 只筛 `alive` 与水平斜距 `≤ range`，角度只是打分里的一项（所以背后 170° 的目标照样可锁，只要它最近）；②脱锁只有两条：`target.alive == false` 与 `d > range`，**墙不会解开锁定**（`core/Occlusion.ts` 的四个读者里没有 LockOn，KI-014 那条"锁定 AoE"指的是被锁者的 AOE 被遮挡，不是锁定本身被遮挡）；③Boss 没有"强制单锁"，只有 `bossBonus` 让她在同角度上不被贴脸杂兵抢走（那条关系现由 validator 钉住，见 §5.9.22）。**后果**：这三句是设计意图而不是现状，谁要落其中任何一句都得先改这一格，而不是让 §2 那行继续冒充事实 |
| `world/generators/`（Terrain/Foliage/Rock/Ruin，需求 §52） | 未落 | 地形现在全部 authored 在 `regions.json` + 灰盒盒子；关键区域手工摆放本来就是规划的首选路径，程序化那条没开 |
| `world/Weather.ts`、`world/Lighting.ts` | 未落 | 与 KI-008 同因：没有真几何与材质就没有雨雾与光照预设。IP_SEED §7 的"铃姨 flag 驱动天气"目前没有任何载体 |
| `ui/MenuStack.ts`、`ui/MapUI.ts`（需求 §43 地图） | 未落 | UI 现只有 HUD、调音桩面板、对话箱、存档两屏、标题屏。**顺带一条命名失真**：`core/Input.ts` 里那个虚拟按钮仍叫 `map`（Tab / 手柄 6 号键），但它今天的消费者（`main.ts` 的 `edges.has('map')`）开的是**调音桩/商摊面板**，不是地图——§43 的地图 UI 从未落地，于是"按着地图的名字在调音"。本轮不改这个键名（改了会连带动 `settings` 与测试口径），只在此登记 |
| `vfx/GPUParticles.ts`、`vfx/Trails.ts`、`vfx/Decals.ts` | 未落 | 弹痕/震纹贴花与武器拖尾没有，命中反馈目前靠 ring+spark+shard 三件套 |
| `audio/Mixer.ts` 的三主题淡入淡出（§11 转调） | 未落 | `audio/music.ts` 只有一条休垒 drone + 随机泛音；combat/boss 主题与转调规则没有 |
| ~~`tools/EnemyDebugger.ts`(F1)、`QuestDebugger.ts`(F3)、`AIDebugger.ts`(F4)~~ 三块面板已落地（KI-058，2026-09-26） | Partial | **这一行从前是"真缺口"，现在只剩缺口的那半句**：三个文件名与 §2 规划树逐字一致，`core/Input.ts` 里 F1/F3/F4 从此有了读者（TD-001 随本批销案），共用外壳是规划外的 `tools/DebugPanel.ts`（见 C 表）。**没落的那三句都在这张表里点名**：① F1 规划写"每敌人**浮标签**+面板列表"，本批只有面板列表，场景内浮标签没有（它要 `three` 的 sprite/CSS2D，与 KI-010 同因：本机没有可见窗口，画出来也从未被眼睛看过一次，所以不拿"代码写了"冒充"做完了"）；② F4 规划写"**行为树**执行路径高亮（ASCII 树）"，可这一作的 AI 真实形态是 **FSM（chase/range/melee/retreat/regroup）+ 鼓点排招器**，从来没有行为树 ⇒ 面板如实打印状态机与选招过程（选哪一带→阶段放行→冷却→落在哪个槽），**不画一棵假树**，`ai/bt/` 那个从未存在过的目录同理仍在 B 表；③ F3 规划写"world flags **编辑器**"，本批刻意只做只读：编辑旗标要写世界状态，而写旗标的唯一合法通道是 `bus.emit('world.flag')`（`world/Streaming.ts` 与交互层各自缓存在那条事件上），调试器另开一条写路径 = 造第二套真相。读数三条通道都齐了（当前 flags / 由 worldstate 规则推出的 / 交互物 used / NPC 关系），"能改"这一格登记为待裁决 |
| `core/Registry.ts` 的 glTF/纹理/音频引用计数 + 占位兜底 | Partial | JSON 名册与 `load(url, loader)`（loader 由表现层注入，core 不 import three）都在；**preload 与引用计数没有**，因为场上还没有需要计数的外部资源 |

**C. 真树里有、这张表没写（交付过程中长出来的）**

| 文件 | 为什么在规划之外 |
|---|---|
| `core/Math.ts` | `mulberry32` / `clamp` / `Rng`：需求 §59「可复现测试」要求 seeded RNG，规划时只写了"RNG"这个概念 |
| `core/Pool.ts` | 通用对象池。§5.1 讲了池化策略，却没给文件名，于是它落成了 core 的一个 20 行类 |
| `input/Haptics.ts` ＋ **整个 `input/` 层** | §64 振动的**逻辑层**（档位表、纯数据、headless 可测），与 `core/Input.ts` 的"读设备"分家才有测试可写。**这是规划外新增的一层目录**，依赖箭头按 `core ← input` 摆放；§56 那张定表本轮不擅自改（它写着"不得更改"），在此登记待修订 |
| `data/index.ts`、`data/schema.ts` | 表里 `data/` 只有一行。实际是两份：schema.ts 是 §3 全部类型的唯一来源，index.ts 把它们与 9 个 JSON 装进 registry |
| `rpg/Runtime.ts` | 组合根装配（Progression + Equipment + Inventory + 派生属性），表里把这职责分散写了、没给载体 |
| `rpg/Shop.ts` | KI-055① 商店逻辑层（买清单 / 卖装半价 / 反套利闸门） |
| `rpg/Movements.ts`、`world/Props.ts`、`world/PropVisuals.ts` | 乐章战技谱册（Phase 5-C2）与**可破坏场景物**这一类实体（KI-023 音刺 / KI-022② 振源核）——后者是规划里没有的**实体类别**，不是文件 |
| `quest/Settlement.ts` | 与 `rpg/Settlement.ts` **同名不同职**：前者落对话与任务的选项效果，后者是击杀结算。两个同名文件住在同一个仓库里是真实的踩坑点，点名登记 |
| `ui/Stakerite.ts`、`ui/TitleScreen.ts`、`ui/SaveSlots.ts` | 调音桩面板、开场定弦（KI-031②）、存档槽两屏（KI-025②）——都晚于规划 |
| `world/ActorVisuals.ts`、`world/BossArenaVisuals.ts` | 身体与场地的灰盒表现层。规划把它们算进了 `SceneGraph`，实际各自一份才好测 |
| `world/WallGreybox.ts` | KI-014②a：遮挡必须看得见 |
| `tools/DebugPanel.ts` | §2 的 `tools/` 只列了四块面板，没列它们**共用的外壳**。KI-058 补后三块时发现三份"钉在屏幕角落、按 F 键开合、逐 tick 重画文本"的代码会各写一遍且各不相同（第一版的 F1 就是漏了 `pointer-events:none` 的那个）⇒ 抽成一份 `DebugPanelSpec`：面板只交 `{ key, label, anchor, text() }`，DOM 与按键监听归它，读数一律由组合根（`main.ts`，且只在 `import.meta.env.DEV`）以闭包注入。规划外还多了一条分工：`tools/` 里**只有这一个文件碰 DOM**，四块面板各自是纯文本产线（只收读数闭包、只吐字符串），所以 headless 可测（`tests/flow/debug-panels.test.ts` 27 条里只有外壳那 4 条需要一份最小 DOM 替身） |

**这一节往后的读法**（防止又漂回去）：需要"某个能力实现在哪"时，**先读 KNOWN_ISSUES 的状态表与 §2.1，再读这张目录表**；
新模块交付时必须在 A/B/C 三张表之一加一行，改 `src/` 而不动本节 = 本节的日期就该更新。

---

## 3. 数据驱动规范（需求 §55）

### 3.1 总原则

- **零硬编码**：所有帧数据（startup/active/recovery）、伤害、掉率、对话文本、AI 参数只存在于 `src/data/`，以 `import x from '@/data/weapons/xx.json'` 构建期打包（获得类型检查）；注册进 `Registry.data` 按 id 取。
- 每类 JSON 有对应 TS interface（`src/data/schema.ts`），文件命名 `kebab-case`，`id` 全局唯一且带类别前缀（`wp_`/`en_`/`bs_`/`it_`/`q_`/`sk_`/`dl_`/`rg_`）。
- 时间单位统一为 **tick（1/60s 逻辑帧）**，杜绝毫秒/tick 混用。
- Gameplay Tag 风格字符串（`damage.physical`、`status.fissure`）替代枚举位掩码，与 §57 GAS-lite 效果系统共用。
- 校验：`npm run validate:data`（`scripts/validate-data.mjs`，**零新增依赖**的字段级校验器，见 KI-015；串在 `npm run check` 里，pre-commit 必过）。它管的是"schema 表达不出来"的那一类约束：跨字段区间、引用是否存在、以及**设计要求的必填组合**（例：带 `boss` 的敌人必须同时有 `intro` 与 `victory` 两格 —— §16「Boss 均带」由此变成机器钉住的规则而不是自觉）。Phase 6-A 起再加一组"可达性"规则（KI-041 的机器版判据，双向对账）：`worldstate.json` 每条规则立的旗标
  必须在 `regions.json` 里真有人读；反过来 `regions.json` 里被读的每个旗标必须有人写，写方缺席的**逐个**列在
  `PENDING_FLAG_WRITERS` 白名单里（**名单要能销**：条目里的旗标一旦出现写方 ⇒ ERROR，KI-073；新增孤儿旗标也直接 ERROR。从前写的"只能变短"是空话——新记一条账是虚是实机器不知道，那一侧留给 review）；带 `secretId` 的领取点不许再自己抄
  `requiresFlag`/`lootTable`（同一事实只住一处）；`gearBand` 用到的每个稀有度必须在 `items.json` 有至少一件装备件
  （KI-042：这条上线时就抓到 rareplus/epic 两档一件装备都没有、隐藏房掷到它等于什么都不掉）；
  固定词缀必须能落在该件的槽位上。
  Phase 5-C3 起再加三条同族规则：`progression.pity` 的两个数齐全且 `floorRarity` 必须是 `rarity` 表里真实存在的档；`LootRoll.pity` 必须与 `chance` 同时出现（必中条目不存在"没中"，那一格计数就是死数据）；同一张表内 `roll.id` 不得重复（逐条保底的计数键就是 `${表id}:${roll id}`，重名等于让常规档和首杀档共用一格）。

### 3.2 帧数据（FrameData）——攻击类条目的公共子结构

```jsonc
"frames": {                      // 全部以 tick 计
  "startup": 8, "active": [8, 12], "recovery": 14,   // active=起止帧区间
  "cancelWindows": [{"to": "sk_sword_l2", "from": 10}], // 派生取消表
  "hitStopMs": 90, "cameraShake": "shake_light_swing",
  "moveAnim": "mont_sword_l1", "sfx": ["swoosh_1"], "vfx": ["trail_sword_basic"],
  "hitbox": {"shape": "capsule", "from": [0.2,1.4,0.6], "to": [0.9,0.9,1.6], "r": 0.45},
  // 或者（远程/投掷动作，与 hitbox 互斥）：
  // "projectile": {"kind":"spear","speed":28,"range":26,"radius":0.38,"offsetY":1.15,
  //                 "gravity":0,"pierce":0,"pinTicks":72,"sfxLaunch":"thrust_1",
  //                 "sfxHit":"hit_metal","vfxHit":"impact_sparks","shake":"heavy"},
  // 连发/预告（§14.4 针喉）：telegraph=前摇期间画赤线，burst.at=每发的显式帧位
  // "projectile": {"kind":"shard","speed":18,"range":26,"radius":0.28,"telegraph":true,
  //                 "burst":{"count":3,"everyTicks":21,"at":[0,32,42]}},
  "roots": [[0,0],[0.02,0]]      // 根运动 (dx,dz)/tick 关键帧表
}
```

`hitbox` 与 `projectile` 二选一即决定这是近战判定还是弹道发射（§5.9）。投掷动作**故意不写 hitbox**——命中全部由弹体结算，避免「枪既在手里砍又在天上飞」的双判。

**落地新增一格（不在这份立项稿里）**：`"bands": [{"outer":2.5,"damage":36},{"outer":5,"damage":20}]` —— 同一记落点按离爆心的距离分档结算（§15.1 P3「外环 20 内环 36」，KI-057）。原语 `bandDamage` 住在 `combat/HitShapes.ts`（与形状检测共用同一把水平中心距尺），**唯一读者是 `Enemy.bandedDamage`**，所以数据门把它锁在「`enemies.json` 里、以出手者为圆心的 ring/sphere 近战帧」这一小块地上：玩家侧写它、弹体招式写它、最后一档留出可达外沿的缝，都是当场 ERROR。

### 3.3 逐类 schema

> **这些 jsonc 块是 Phase 0 的立项稿，不是当前形状**（KI-038 的账）。真正的类型只有一个地方：
> `src/data/schema.ts`，真正的数据只有那 11 份 `src/data/json/*.json`（全部受 `npm run validate:data` 管）。
> 立项稿与实际落地的主要差异，逐条写在这里而不是假装它们一致：
> ① 目录是扁平的 `src/data/json/`，不是 `data/weapons/*.json` 那种一物一文件——构建期打包要的是
> 一次导入 + 一份注册表，拆文件只会让跨文件对账（同一张表内 id 唯一、稀有度、悬空引用）变复杂；
> ② **Boss 没有独立文件**：她是 `enemies.json` 里带 `boss` 段的条目（私有拍速/阶段/机关/入场与胜利序列
> 全在那一段），所以 `BossData` 这个接口已经从 schema.ts 删掉——留着会让人以为有一套没实现的文件布局；
> ③ `ItemData` 实际字段是 `kind/stack/value/gear/use/desc`（不是 `type/stackMax/sellPrice`），
> `WeaponData` 没有 `staminaCost/poisePerHit/upgradePathId/model`（体力与架式在帧表上，强化住在
> `progression.json.upgrade`，模型是灰盒阶段的程序化几何）；④ `SkillData` 未单独成型，
> 战技落在 `movements.json`（§10），武器战技落在 `weapons.json.skill` + `movesets.json`。
> 需求 §78 要的是如实，不是好看：这一段保留立项稿只为对照"当初打算怎么做"，
> 任何口径冲突以 schema.ts 与门禁为准。

**WeaponData**（`data/weapons/*.json`）：
```jsonc
{
  "id": "wp_tuning_sword",            // string, 前缀 wp_
  "nameKey": "weapon.tuningSword",    // string, i18n 键（中文名不硬编码在代码）
  "archetype": "straight_sword",      // enum: straight_sword|greatsword|spear|bow|tuning_rod|unique
  "movesetId": "ms_sword",            // string → data/movesets/，含 L1-L4/H/charged/run/jump/back 全套 FrameData
  "atkBase": 12, "scaling": {"str": 0.6, "dex": 0.9},  // 立项稿带底数；实现里底数只住在 movesets.json 那一记的 damage（strikeEnemy→resolveDamage），atkBase 从无消费方，已于 KI-047 从 schema/数据表/验证器删除——这一格保留只为对照当初的分层意图
  "staminaCost": {"light": 12, "heavy": 24},           // number/tick 触发一次（现状：体力住在每一记的 FrameData.stamina）
  "poisePerHit": 18,
  "swingTag": ["damage.physical", "crit.backstab1.5"], // string[] gameplay tags
  "skill": "sk_sword_resonant_cut",   // → SkillData（战技，武器专属）
  "upgradePathId": "up_timbite_sword",// → 强化表（+1..+10 数值/消耗/成功率）
  "model": "assets/meshes/wp_sword_lod{0,1,2}.glb", "equipAnimSet": "as_sword"
}
```

**EnemyData**（`data/enemies/*.json`，示例：嘈壳）：
```jsonc
{
  "id": "en_cacoph_shell", "nameKey": "enemy.crabkinShell", "archetype": "basic",
  "hp": 60, "poise": 40, "staminaDrainOnHit": 8, "resistances": {"fissure": 0.2},
  "ai": {
    "btId": "bt_basic_melee",           // → 行为树模板
    "perception": {"visionRange": 18, "fovDeg": 120, "hearingRange": 10,
                    "hearingLoudnessMin": 0.35},   // 听觉一等公民
    "distBands": [{"min":0,"max":2.2,"actions":["en_atk_bite"]},
                   {"min":2.2,"max":8,"actions":["chase"]}],
    "aggroShare": {"camp": true, "callAllyRange": 14}, "retreatPoiseFrac": 0.15,
    "armorFront": {"arcDeg": 60, "dmgMul": 0.6},        // §14.7 钟甲：正面锥内减伤（碎甲后失效）
    "selfToll": {"everyBars": 4, "attackId": "toll", "heal": 15}  // §14.7 软计时器：到点强制读条回血
  },
  "attacks": [{"id":"bite","telegraphTicks":20,"frameRef":"frames_bite",
                "damageSrc":"contact","loudness":0.5}],  // loudness 驱动噪音感知
  // 招式层还有两个 §14 用的字段：frames.next（连段派生量化到下一拍位）与
  // parryStunTicks（被弹反时它自己挨多久的硬直；缺省 18）
  "drops": [{"tableId": "loot_basic", "chance": 0.65}],
  "weakpoints": [{"bone":"core_discord","dmgMul":1.8}],   // 振源核（IP_SEED §5）
  "statusOnHit": [{"tag":"status.fissure","layers":1}]
}
```

**Boss：没有独立 schema**（立项稿曾规划 `data/bosses/*.json`，实际合并进 EnemyData，KI-038）。
落地的形状是 `enemies.json` 里那条带 `boss` 段的条目：`boss.bpm/beatsPerBar`（她的私有拍速，
打完要还给区域网格）、`boss.phases[]`（`belowHpFrac` + 换一批招式 + 壳参数）、
`boss.intro`/`boss.victory`（§16 的入场演出与胜利序列，两格由门禁要求齐全）、以及机关与掉落。
把她的阶段拆到第二个文件里，就会出现"她有几阶"有两处可写这种事。

**ItemData**：`{id:"it_timbite_raw", type:"material|weapon|armor|consumable|key", stackMax:99,
nameKey, descKey(item lore 载体), stats?(装备属性 delta 表), useEffect?(SkillData ref),
rarity:"common|rare|elite|unique", sellPrice:number}`
**QuestData**：`{id:"q_main03_belltongue_bells", steps:[{id, objectives:[{type:"kill|reach|
dialogue|flag", target, count}], conditions:stringExpr, onSuccess, onFailure?}],
rewards, flagsSet:[...], npcRefs, outcomes:[{branch:"ally|purge", flag}]}`
**SkillData**（战技/状态效果/乐章战技共用）：`{id:"sk_rest_execution", type:"active|passive|effect",
cost:{"stamina":0,"overdrive":50}, cooldownTicks:180, targeting:"self|target|directional",
frameRef?(含帧数据的技能直接引 FrameData), effect:{applyTags:[], damageSrc?, durationTicks?,
modifiers:[{attr:"staminaRegen", op:"mul", value:0.7}]}, vfxRefs, sfxRefs, cameraShake}`
**MovementData（已落地 `src/data/json/movements.json`，Phase 5-C2）** —— 需求 §57 的 Ability 架构在本作落成
**静态表版**，与上面立项时的 SkillData 有意不同（那是一份"什么都能表达"的通用图，这一份只表达谱册需要的事）：
```jsonc
{
  "slots": [{"index":1,"action":"weaponSkill","milestone":"ms_movement_slot"},   // action=输入动作名；门槛是 progression.json 的里程碑 id
            {"index":2,"action":"weaponSkillB","milestone":"ms_movement2"}],
  "damage": { "scaling": {"ton":1.5}, "perOverdriveLayer":0.04 },               // 全表共用的口径，两处都有消费方
  "pages":  [{"id":"mvpage_prelude","displayName":"…","desc":"…","unlock":{"item":"it_resonance_core","count":1}}],
  "upgradeCost":[{"level":2,"timbite":40,"score":1},{"level":3,"timbite":120,"score":2}],   // 阶梯：第 n 格升到第 n+1 级
  "movements": [{
    "id":"mv_chordburst","page":"mvpage_storm","displayName":"和弦爆",
    "cost":{"overdrive":3},                       // 体力或过载，二选一由数据决定
    "frame":{ "startup":16,"activeStart":16,"activeEnd":22,"recovery":52,
              "hitbox":{"shape":"ring","inner":0,"outer":4,"forward":0},"multi":8,
              "poise":26,"hitStopMs":90,"shake":"heavy","loudness":8,"sfx":[…],"vfx":[…] },
    "levels":[{ "cooldownTicks":300,"damage":26,"muteTicks":180 }, …]            // 阶梯：等级只改这张小表
  }]
}
```
帧与数值刻意分开：`frame`＝动作的形状（各等级相同），`levels[]`＝这一式的账（冷却/伤害/状态时长随等级变）。
`validate:data` 对它的门禁见 KI-015 的清单（页引用、槽里程碑存在性、`levels` 与升级阶梯对齐、`hitbox` 合法）。
**DialogueData**：`{id:"dl_belltongue_greet", speaker:"npc_belltongue",
graph:{root:"n0", nodes:{"n0":{textKey, cond?:stringExpr, options:[{textKey, next,
req?:"flag.x&&!flag.y", effects:[{kind:"setFlag",flag,op},{kind:"giveItem",id,n},{kind:"startQuest",id}]}]}}}`
**RegionData**（已落地 `src/data/json/regions.json`，7 区域 + `world/Streaming.ts`）：
`{id:"rg_whisperwode", nameKey, displayName(IP_SEED §14 词表), order:int(解锁顺序), biome:"hub|forest|ruins|underground|camp|dungeon|boss_arena",
bounds:{minX,maxX,minY,maxY,minZ,maxZ}(水平边界对齐 chunkSize，y 可半格抬升), chunkSize:48, navmeshRef?(Navigation.ts 未落地故暂留空，见 KI-009),
weatherPresets[], lightingPreset, palette:{base,accent,glow}(对齐 IP_SEED §10), spawnGroups:[{enemyId,count,center,radius,campId?,condition?}],
landmarks:[{id,nameKey,pos,sightRange}], interactables:[{id,kind:"checkpoint|elevator|bridge|soundwall|gather|chest|npc|teleport",pos,oneWay?,requiresFlag?,setsFlag?,npcId?}],
music:{explore,battle,ambience}, streamingPriority:int, preloadWhole?(boss arena 整场预载), unlockFlag?, secrets:[{id,unlockFlag,rewardTable,pos}], storyHooks[]}`

---

## 4. Game Feel 管线（需求 §47）

统一事件时序：**所有反馈通道在同一命中事件上排序，禁止各系统自行择时**。以「轻击命中敌人」为例（时间轴单位 ms，t=0 为命中 tick 当帧）：

```
t=-133(8tick前)  Input 边沿 → AttackSystem 校验(体力/状态/取消窗口) → 播 montage
t=命中帧          ├─ DamagePipeline 结算(纯函数) → 发 combat.hit {dmg, tags, dir, point}
命中帧+0          ├─ HitStop: timeScale=0.05 (60~140ms, FrameData.hitStopMs)
                  ├─ SFX: impact 首波与 HitStop 同帧(FM 合成金属撞击,音高随 dmg 抖)
                  ├─ VFX: ImpactRings 在 hit.point 出生(声纹环) + Decal + 粒子 burst
                  ├─ Anim: 受击者 additive flinch 层(不改攻击者动画)
命中帧+~83(5tick) ├─ Camera: shake 短脉冲(幅度=shake 曲线表) — 延后 5tick 避免与 freeze 抢感知
命中帧+~100       ├─ Gamepad haptic: playEffect(60ms, 0.6)（不支持则静默跳过）
HitStop 结束      └─ timeScale 恢复 → 攻方 recovery 续播 → 数字伤害飘字(ui)
```

弹反时序另加一层：parry 窗口(攻击命中前 10tick) 判定成功 → 攻方硬直 montage + 大音钟「铛」+ 白色大环 + HitStop 140ms + 摄像机 dolly-in 5% + 手柄强震动——弹反是本作世界观「休止」特权的核心表达，反馈等级最高。

> **§4 对账（2026-09-26）**：这张时间轴**按事件读成立、按文件名读不成立**。
> `HitFeedback.ts`（规则 1 指定的那个集中派发者）**不存在**——四档强度的派发实际分散在四处，各自吃总线事件：
> `combat/Reactions.ts`（§8 受击档位 + 豁免）、`player/CameraRig.ts`（§10 震镜表 + FOV 脉冲 + 处决推轨）、
> `vfx/VfxLayer.ts`（ring/spark/shard）、`ui/Hud.ts`（飘字与里程碑腿）。
> 时间轴里那几个名字同时按 §2.1 换过载体：`AttackSystem`→`CombatManager`、`ImpactRings`→`VfxLayer`；
> **`Decal` 与「additive flinch 层」确实没有**（前者 §2.1-B，后者属 KI-008：没有动画层，今天的"受击可见"是
> R0 发光 + R1/R2/R3 位移与硬直 tick）。
> 数字侧要分开读：`hitStopMs`（§9，KI-017 第四步入表）与 `SHAKE_TABLE` 的幅度/频率/时长（§10，KI-051/053 入表）
> **都在数据表里且有测试钉住**；而 `t=-133 / +83 / +100` 这三个"错开几拍"的择时是各表现层自己定的，
> 没有一个中央定时器在发号施令 —— 所以规则 1 那句「禁止散点触发」今天**只能靠 review 守住**。

规则：
1. 每条反馈的强度分 4 档（graze/normal/heavy/boss），由 FrameData/事件载荷驱动，集中在 `HitFeedback.ts` 派发，禁止散点触发。
2. 「克制」原则（需求 §16）：轻击不得触发 screen flash；只有处决/弹反/破防允许全屏效果。
3. HitStop 期间逻辑 tick 照常推进（timeScale 只缩放动画与物理插值，不缩放判定），避免 freeze 时 hitbox 悬停穿模。**这条到 2026-09-24 才真的是事实**：此前 `main.ts` 把被压缩的 `time.dt` 喂给了节拍钟（判定链路），等于反向违反了本条；KI-017 第一步已改掉，见 §「时间口径的分工」那条。

---

## 5. 性能架构（需求 §48/§49/§50）

> **§5 对账（2026-09-26，需求 §78「状态标签必须真实」）**：本节里只有 §5.5 与 §5.9 系列挂着"已实现"并且
> 真的在树里；**§5.1~§5.4、§5.6、§5.7 是预算与规划，不是现状**。逐格：
>
> | 小节 | 标签 | 事实依据（可复跑） |
> |---|---|---|
> | §5.1 对象池 | **Partial** | `core/Pool.ts`（29 行泛型池）在跑，但**消费者只有 `vfx/VfxLayer.ts`**（ring/spark/shard 三类实例池）。敌人不池化（`AISystem.spawn()` 每只 `new Enemy`）、伤害飘字没有 DOM 池、音频节点没有池、"上限=峰值×1.5 + 超限告警"没有 |
> | §5.2 LOD 与实例化 | **Partial** | 实例化落了：每类灰盒一张 `InstancedMesh`（Chunk/Wall/Interactable/BossArena/Prop/Projectile/Vfx）。**LOD 一级都没有**——`grep -rn LOD src` 零命中；植被/岩体/遗迹模块本来也不存在（`world/generators/` 见 §2.1-B） |
> | §5.3 Drawcall 预算 | **Placeholder** | **这张表从未被实测过。**「3060Laptop 实测余量 20%」是立项时的期望值：本环境打不开可见窗口（KI-010），`package.json` 里没有任何 `perf:` 脚本（KI-015 已记）。今天真能数出来的只有"每类 1 call"这一条结构性事实 |
> | §5.4 内存预算 | **Placeholder** | KTX2/Basis、Draco、ogg 流式**都不在树里**（本作至今零外部素材：全程序合成 + 灰盒），所以这份预算没有可核对的对象 |
> | §5.6 画质档位 | **Planned** | Low/Medium/High/Ultra 没有载体，`src/` 里没有 quality 开关；CSM/SSAO/SSR/bloom/FXAA/DOF 全未落 |
> | §5.7 Profiling | **未落** | `PerfPanel` 不存在，F 键没有绑定，`docs/perf-log/` 目录也不存在 ⇒ **"无此表不得合并"这条强制流程今天无法执行**。需求 §49 的"不要猜性能"目前只由一条兜住：逻辑一律走 60Hz 固定 tick，所以玩法判定与机器性能无关；真实帧时间属 KI-010/KI-045 那个不可测面 |
>
> 这一格的正确读法：**预算数字是用来在能做测量那天核对的，不是用来当作已达成的指标引用的。**

### 5.1 对象池
`core/Pool.ts<T>` 泛型池：粒子实例（每发射器一池）、特效环、伤害飘字 DOM 节点、敌人实体（区域重置复用）、音频源节点。禁止热路径 `new`；池上限=峰值观测值×1.5，超限告警（profiling 面板红色条目）。

### 5.2 LOD 与实例化
角色/岩石/遗迹模块：3 级 LOD（15m/40m 切换，LOD2 面数 ≤ 20%）。植被/碎石/钟乳：单一 `InstancedMesh` 按材质合批，风动在顶点 shader 内做（uniform 时间 + 实例相位属性）。同区域同敌人共享几何，装备差异用贴图换（最多 4 变体）。

### 5.3 Drawcall 预算（1080p / 60fps 帧预算 16.6ms；GPU ≤ 12ms，CPU ≤ 6ms 逻辑）

| 分类 | 预算(drawcall) | 手段 |
|---|---|---|
| 地形+chunk 静态 | 25 | 合批 4 材质图集、CSM 阴影 pass 另计 |
| 植被+岩体 | 15 | InstancedMesh 每群 1 call |
| 角色/敌人/boss | 20 | 共享骨架+材质≤6/角色 |
| 道具/交互物 | 10 | — |
| VFX（粒子和池 3 call/发射器） | 25 | 粒子实例化、贴花单纹理图集 |
| UI（canvas 1 + DOM 不计） | 3 | HUD 单 draw |
| 后处理（bloom/FXAA/vignette） | 6 | Low 档只留 FXAA |
| **合计** | **≤104** | 目标 <120，3060Laptop 实测余量 20% |

### 5.4 内存预算（16GB 机器，浏览器 tab 目标 <1.8GB JS heap + GPU 显存 <3.5GB）
纹理总预算 900MB（全部 KTX2/Basis 压缩、mipmap）、音频解码缓冲 120MB（ogg 流式 + 合成 SFX 零采样）、场景几何 300MB（Draco）、粒子上限 8000 实例、AI 实体 ≤60 同时激活（超出仅逻辑降级为休眠）。流送常驻 chunk ≤9、in-flight ≤4。

### 5.5 流送策略（需求 §50）— 已实现 `src/world/Streaming.ts`
- 网格为 **3D cell（48m 立方）**：水平相邻区域与垂直跨层（地表/崖壁/地下/深层）共用同一距离规则；cell 由「cell 中心落在哪个 RegionData.bounds」认领，因此上下叠放的区域不冲突。§5.4 的「常驻 chunk ≤9」是水平口径（3×3），3D 下为 3×3×3=**27**，`in-flight ≤4` 不变。
- 状态机：`unloaded → preloading(loadTicks=3, 配额 4) → resident → active`；激活环半径=1（2 圈预载、3 圈卸载、卸载延迟 2s=120tick 防抖）；跨圈只降级/激活，不重复加载。优先级：区域 `streamingPriority` + 格内加成（剧情触点 +50 > boss 场地 +100 标记 > 营地 +20 > 遭遇 +10 ≈ 秘密 +10），排序键 `(ring, priority, dist)`。
- `preloadWhole` 区域（未竟厅）在 `unloadRing+2` 观察圈内**整场预载**；`unlockFlag` 未满足的区域完全不参与流送（不加载、不 spawn）。
- `teleport()` = 强制同步加载激活环 + 取消防抖（渲染层配黑屏遮蔽）；卸载即从活跃表摘除并记入 `explored`（地图遮罩，需求 §43），20 次往返压力测试断言驻留量不增长。
- 渲染层**只订阅 `world.chunk` 事件**按 state 挂/摘子场景，`Streaming.ts` 禁止 import three（headless 可测、UE 可移植）。
- 测试矩阵（需求 §50 原文）：高速移动（调试器加速作弊）、传送（同步加载+遮蔽 fade）、大区域入口、boss arena（进场锁定加载）、地下（垂直跨层）、室内外切换（interior cell 独立于地形 chunk）——headless 覆盖见 `tests/unit/streaming.test.ts`（17 条）与 `tests/flow/world.test.ts`（休垒→雾语林→沉唱堂→传送回城，断言「流送后 1s 内无 MissingRef 警告」与预算上限）。
- 加载任务每帧预算 8ms（超时让位下帧），卸载当帧同步（dispose 几何/材质引用计数归零）。
- **表现层 `src/world/ChunkGreybox.ts`**：只订阅 `world.chunk`，把 state 变成几何。每区域两张 `InstancedMesh`（地板板面 + 地标棱柱），容量按「该区域认领的 cell 数」预算，因此全场常驻 drawcall = 2×区域数（7 区 = 14），与 chunk 数无关；HIDDEN 实例（零缩放）而非增删对象来实现挂/摘；激活格用区域原色、常驻格压暗 45%，让流送窗口本身可读。卸载防抖期间实例数会短暂高于稳态，压力测试断言往返后 `liveFloors` 回到同一水位（无槽位泄漏）。
- **垂直地面 `src/world/Surface.ts`**（无 three 依赖）：`floorAt(pos)` 取「水平覆盖该 xz 且 groundY ≤ 脚底+0.5m」中**最高**的一块地板——叠层区域共用 xz，所以不能复用 `regionAt` 的首个匹配。控制器改为读 `player.floorY`（每 tick 由 main.ts 注入，层外回落到 0），于是走下边缘会下落、踏上高层会抬升（仅 0.5m 容差内，防止跨层瞬移被拎起）。`RegionData.groundY` 是这一查询的数据源。构造参数 `isClosed(region)` 是**区域闸门**：main.ts 注入 `!streaming.isRegionUnlocked(r)`，未解锁区域连几何上都没有可站面（灰盒表现 = 悬空板面消失），修掉 KI-011。
- **交互物 `src/world/Interactables.ts`**（无 three 依赖，需求 §65 六要素之「交互」）：数据源是 `RegionData.interactables`（`kind/requiresFlag/setsFlag/oneWay/to/verb`，26 个实例）。每 tick `update(pos)` 做半径 6m 的焦点查询，只在焦点变化时发 `ui.prompt`；`use(id, pos)` 校验区域已解锁 + 在半径内，然后消耗（一次性/`oneWay`）、`setFlag`（发 `world.flag`，流送层自己的订阅随即解锁区域）、发 notify/sfx/log，并**只返回结果**（`{rest, loot, to}`）——回血、掉落、传送由 main.ts 的 `applyInteract()` 执行，保持 world 逻辑层不认识玩家实例。`to` + `world.travel` + `streaming.teleport()` 即 UE「遮蔽传送」的等价物：跨层通路不再靠调试器作弊。E 键与处决/背刺共用 `interact` 边，由 `takeInteractEdge()` 仲裁（交互优先，帧内吃掉边即让战斗层落空），headless 覆盖见 `tests/flow/traversal.test.ts`（7 条：闸门拒开、全程只按 E 的 7 段动线、单行道、半径、NPC 不假完成、提示文案、E 键仲裁）。
- **出怪 `src/world/SpawnDirector.ts`**（无 three 依赖，需求 §66 之「敌人布置」）：数据源是 `RegionData.spawnGroups`（`enemyId/count/center/radius/condition/campId`），全场 30 个槽位；槽身份是稳定的 `region:group:member`，落点 = 黄金角环形布点 + 以槽 key 为种子的 `Rng` 抖动（**同一存档同一位置**，重进不掉随机数）。它只订阅 `world.chunk`：格进 active → 按 condition 出怪，格离开 active → `host.despawn()` **回收而不记清剿**（下次进格重新驻扎）；`entity.died` → 槽位永久进 `cleared`（死过的怪不刷新，需求 §66「击杀持久」）。`maxAlive` 直接取 §5.5 的 AI 硬顶（默认 60，可注入覆盖以做压力测试）；超限时该格编队排队并打 warn，而不是无限堆怪。`condition` 是最小布尔式（`flag.x` / `!flag.x` / `&&`），由 `hasFlag` 注入（main.ts 接 `streaming.hasFlag`），因此「破拍营地编队在营地解决后不再驻扎」这类布点是一行 JSON。`campId` 留给 Phase 4 的 Squad（成组增援）。开局休垒是**零敌人**的安全屋（`spawnGroups: []` 忠于世界观设定，原来 main.ts 里 4 行硬编码靶怪已移到雾语林，由数据布点）。覆盖：`tests/unit/spawn.test.ts`（9 条：condition 真值表、确定性、chunk 归属、生命周期、清剿不刷新、上限+warn、dispose）与 `tests/flow/spawn.test.ts`（6 条：真流送走进布点圈出怪、离开回收、返回重刷、死者不归、营地 flag 闸门、编队含远程+支援位）。
- **交互物占位模 `src/world/InteractableGreybox.ts`**（表现层，修 KI-013）：26 条 `interactables` 按 kind 分池，每种一张 `InstancedMesh` ⇒ 常驻 drawcall = 数据里出现过的 kind 数（当前 9），与区域/chunk 无关；形状即读法（调音桩=细柱、闸门=框、吊机=开口筒、音壁=厚板、落钟=锥、NPC=胶囊…），落点用条目自己的 `pos.y + LIFT[kind]`，跨层条目站在自己那一层上。可见性完全跟着 `world.chunk`（未解锁区域根本没有格 ⇒ 自然不放模），`ui.prompt(id)` 点亮焦点（焦点 id 随提示一起发，HUD 只取 text），消耗态压暗由**注入的 flag 谓词**判定而不是只等 `world.flag` 事件——读档后第一次落位就是压暗色。格键与谓词都由组合根注入，本层不 import 流送运行时（arch 闸门覆盖）。覆盖 `tests/unit/greybox-nodes.test.ts`（6 条）；实机验证：走焦门亮金、按 E 后离开转暗石板色、远处 void 区 liveProps 归 0、回家回升，8 站跨 5 层巡回 0 error/0 warn。
- 已知缺口：区域间的**运动演出**（井笼升降路径、吊桥落板、音壁碎裂）未做，见 KI-012；地标（landmarks）沿用 ChunkGreybox 的棱柱池，正式模在 Phase 7 替换；`flag.parry_taught` 一类剧情 flag 需 Phase 6 对话树授予，是动线上唯一仍需模拟的环节。

### 5.6 画质档位

| 项 | Low | Medium | High | Ultra |
|---|---|---|---|---|
| 分辨率缩放 | 0.7 | 0.85 | 1.0 | 1.0+FXAA |
| CSM 阴影 | 关（blob） | 1 级 1024 | 3 级 2048 | 3 级 4096 |
| SSAO | 关 | 关 | 半分辨率 | 全分辨率 |
| SSR/反射 | 环境贴图 | 环境贴图 | SSR 低步数 | SSR 高步数 |
| 粒子实例上限 | 2000 | 4000 | 8000 | 8000 |
| 植被密度 | 0.4 | 0.7 | 1.0 | 1.0+远景草 |
| 后处理 | FXAA | FXAA+bloom | +vignette/DOF(战斗关) | +film grain |
| 音频 | 无卷积混响 | 低 taps IR | 高 taps | 全 3D panner |

### 5.7 Profiling（需求 §49「不要猜性能」）
内建 `PerfPanel`（F 键）：帧时间 P50/P99 直方图、逻辑各 system 耗时分段（tick 内 performance.mark）、drawcall/三角面/纹理内存（renderer.info）、池命中率、流送队列。**记录流程（强制）**：任何标记为 `perf:` 的 PR 必须在 `docs/perf-log/YYYY-MM-DD-<topic>.md` 落表：`场景+档位 | Before(帧时间P99/drawcall/内存) | After | Improvement | Trade-offs`；无此表不得合并。

### 5.8 工程守则
**依赖边界（自动化闸门）**：`tests/unit/arch-boundaries.test.ts` 静态扫描 `src/**/*.ts` 的运行时 import（`import type` 不计，编译后消失），断言 ①逻辑层（`ai/audio/combat/core/data/input` + `player/{LockOn,ThirdPersonController}` + `world/{Streaming,Surface,Interactables,SpawnDirector}`）不得 import `three` 或表现层模块；②用 `three` 的文件必须都在表现层清单（`main/CameraRig/CombatDebugger/Hud/VfxLayer/materials/ActorVisuals/ChunkGreybox/InteractableGreybox/WallGreybox/ProjectileVisuals/PlaceholderArena`）；③除组合根 `main.ts` 外，表现层不得 import 逻辑运行时（只订 `EventBus` 事件）。清单漂移会让「闸门变空测试」，所以另有 1 条断言校验扫描文件数与必扫项。
> 注：需求文档设想的 ESLint `no-restricted-imports` 规则本环境未装（零新增依赖优先），改由上述测试承担同一职责；`npm run lint`(=tsc --noEmit) + `npm run test` 一起构成交付前门禁，pre-commit hook 跑 tsc。所有随机数走 `core/Math.ts` 的 `Rng`（`mulberry32` 种子流，可复现测试）；例外只允许出现在 `audio/*` 的音色抖动（不进玩法判定）。逻辑层不使用 `setTimeout/requestAnimationFrame`（一律过 Time/GameLoop）。

### 5.9 弹道、敌人机制与 Boss 运行时（Phase 4-A…4-F）— 已实现 `src/combat/Projectiles.ts` + `src/world/ProjectileVisuals.ts`

需求 §66「远程敌人」与 §4.3「引针枪投掷」共用同一套弹道，遵循 §5.8 的分层：

- **运动学 `combat/Projectiles.ts`（纯逻辑，零 three）**：`Projectile` = `{pos, vel, radius, rangeLeft, gravity, damage, poise, pinTicks, muteTicks, layers, pierce→hitsLeft, hostile, ownerId, sfxHit, vfxHit, shake, loudness}`。`spawn()` 把 `dir` 归一到 `speed`；`update()` 半隐式欧拉（先积分速度再积分位置），按实际位移扣 `rangeLeft`，射程耗尽=`'range'`、超 600 tick=`'expire'`、落地=`'ground'`、命中=`'hit'`。`hitIds` + `hitsLeft` 实现穿透去重；`reap(onGone)` 保证每条弹体**只通知一次**并同步从 `live` 移除；`withOwner(id)` 供归属回收。**这里不做任何碰撞判定**——运动学与命中解耦，才让 9 条单测能在 node 里纯算术断言（直线 5m/15tick、重力 1s 后 vy=0、抛体上升 4.5~5.05m）。
- **命中与结算全部在 `CombatManager`**：单一伤害通道原则（§57）继续成立——远程只是把 `resolveDamage({ranged:true})`（**DR×0.6**，即远程破甲惩罚）与 `strikeEnemy()` 复用给弹体，玩家侧则把弹体包成一个 `Threat` 喂进同一条防御阶梯 `resolveAgainstPlayer()`：**弹反 > i-frame > 完美格挡 > 格挡 > 硬吃**。因此投掷/受击不需要第二套结算代码，`onBeat`/`fissureLayers`/`poiseMul`/`pinTicks(钉住=stunTicks)` 全部沿用近战语义。弹体各自的 `react(tick, outcome)` 回调负责差异（近战让攻方进入 `onParried` 硬直，远程让弹体自毁）。
- **谁来发射**：`FrameData.projectile` 存在即视为发射动作；玩家动作与敌人攻击各自带 `launched` 闩锁（一次动作只发一发），判定窗口与近战 activeStart 同源。发射点在 `CombatManager`（它持有节奏/属性/RNG），`Enemy.pendingProjectile` 与 `PlayerController.action` 只是数据访问器——**不引入 ai↔combat 反向依赖**，也不用全局总线发射事件（那会让多实例 headless 测试串扰，Phase 3-C2 的教训）。
- **弹道可读性**：锁定目标时用 `aimAt()` 解抛物线（给定射程与速度取命中时刻），未锁定时用 `aimFlat()`——按 `range/2` 的飞行时间反解 `vy`，使弹道在射程中点正好穿过站姿躯干高度带（引针枪按 combat.md §4.3 取 `gravity:0` 直线；同一套求解给未来带重力的落钟碎片/音色晶用），于是「朝天扔长矛」这种新手尴尬被数据本身消掉。
- **敌人侧数据驱动**：`en_driftsinger` 由 `melee` 改 `ranged`，新招式 `shrill`（尖啸）在 2.2~11m 距离带发射 `note` 弹体（speed 13 / range 20 / 无重力 / damage 12 / poise 6），`distBands` 与 `chase` 带一起改表即完成布怪，零代码分支。
- **表现层 `world/ProjectileVisuals.ts`**：`sync(list, tick)` 每 tick 只读弹体快照，按 `kind` 分池 acquire/release（长枪=沿 +Z 的长条盒并按速度四元数取向，音符=脉冲二十面体），`peakLive` 观测峰值；`dispose()` 释放几何/材质。落地/消失的尘埃与闷响由 CombatManager 发 `vfx.spawn`/`audio.sfx`，视觉层不判定语义。
- **回收**：`entity.despawned` → 该 owner 的在飞弹体立即 `expire`（离格回收不留隐形弹幕）；`world.travel`/`teleport` 后弹体随 owner 一起清。
- 覆盖：`tests/unit/projectiles.test.ts`（9 条运动学）、`tests/flow/ranged.test.ts`（16 条完整玩法流：投枪命中+钉住、DR×0.6 上下界、数据表断言、AI 真开火伤到玩家、无敌帧/弹反/格挡三档防御对远程同样成立、despawn 清弹、针喉三发帧位/风筝上限/telegraph 时长）、`tests/unit/projectile-visuals.test.ts`（8 条，含「往返两波不涨网格数」的池泄漏回归——这条抓到了真 bug）。
- **遮挡（KI-014①② 已落地的部分）**：弹体逐 tick 量的是 `prev → pos` 这**一段**，不是"此刻在不在墙里"——采点版本会让一枚一 tick 跨过整个柱截面的弹体白拿穿透。命中就把 `pr.pos` 写成撞击点再 `kill(pr,'wall')`，于是灰尘与那一声撒在玩家眼睛该看的地方，而反馈仍然只有 `onProjectileGone` 一个出口。**对两边一样狠**：玩家投出的长枪与敌人射来的弹体走同一行判据，所以"长枪穿过掩体"从这一刻起不成立。**名册现在有两条输入通道**（KI-014②）：实体侧的 `boss.covers`（竖直圆柱，每 tick 由 `update` 顶部重新点名）与关卡侧的 `regions.json > walls`（轴对齐盒，跨区时由组合根写一次 `syncAuthored`）。两者住**同一个数组**——authored 段固定在前部，于是热路径上仍是一次遍历、零分配，而"墙"与"柱子"在三个读者眼里没有区别。写进表的墙自此真的挡得住：隔着一堵**已 authored** 的塌墙投掷不再成立；而**没写进表**的岩壁依然拦不住弹体——那一格等的是 KI-009 的导航网格与真几何，不是这一层的职责。**第四个读者是眼睛（KI-014②b）**：`Enemy.sense()` 与 `sawImpact()` 现在都先问一句"这一线被截了没有"，而问的是**同一个名册**——组合根把 `ai.sightBlocked` 接成 `combat.occlusion.blocked`（全场仅此一处赋值，`occlusion.test.ts` 里有一条源码门盯住它，因为"注不注入"就是这一格的唯一开关）。于是挡箭与挡眼不可能再分家；被视觉截掉的那一帧会自然落到**震动**那一支（掩体不是消失术，站定才是）。两端口径同样是**身体中心**：`sight=null` 时恒为"看得见"（没有几何体的野外与既有全部测试的口径），而测试用一块下沿 0.6m 的挡板与一块 2.2m 以上才开始的悬空体把这条口径两侧都钉住。**仍然缺的两格**：玩家的挥砍（扇形不是线段）与没写进 `walls` 的天然岩壁（等 KI-009 的真几何）。

### 5.9.1 反射、telegraph 与射手风筝（Phase 4-B）— 已实现

Phase 4-A 把弹道跑通，但远程只被当作「会飞的近战判定」。4-B 补的是它独有的三件事，全部沿用同一条通道，没有新增结算代码：

- **弹体是唯一「防御成功后仍然活着」的攻击**：`resolveAgainstPlayer()` 改为返回 `DefenseOutcome`（`parry/perfectBlock/immune/block/guardBreak/hit/none`），弹体分支据此决定后事——`immune` 只把 `'player'` 写进 `hitIds`（**穿过去**，之后该落地落地、该到期到期，不凭空消失）；`parry`/`perfectBlock` 调 `reflectProjectile()`；其余才 `kill(pr,'hit')`。反射体按数据比例回射原主人：`parry.projectileReflectMul=1`（§5.3 其箭反射回杀）、`guard.perfectBlockReflectMul=0.5`（§5.2 弹开一半）；`ownerId` 改写为 `'player'`、`hostile:false`、**`parryable:false`**（否则两个射手能对着弹一辈子），射程取「到主人的距离+2」以免反射体在自己的领地边缘提前消散。反射体在**出生帧不参与判定**（`pr.bornTick === tick` 直接跳过），否则当帧打到自己。
- **赤线 telegraph（§14.4「线终点=落点」）**：`ProjectileSpec.telegraph:true` 的招式在前摇期间由 `Enemy.telegraphProjectile` 报出剩余拍数，`CombatManager.telegraphs()` 把「射手出手点→按 `aimAt` 解出的落点」编译成一份**只读线段名单**（含 `ticksLeft/totalTicks`），表现层 `ProjectileVisuals.syncTelegraphs(lines)` 按 `ownerId` 复用一池细长盒（`opacity = 0.12 + 0.72·k²`，越接近出手越亮）。逻辑层不认识 three、表现层不认识 CombatManager——`TelegraphLine` 只做 `import type`，依赖闸门（`arch-boundaries`）照旧全绿。前摇期敌人 `faceSlow(...,0.3)` 持续跟头，所以这条线是**诚实的承诺**而不是随机抽奖：玩家可以看得见地被引到掩体后。
- **风筝行为完全数据化**：距离带里的伪动作 `'chase'/'backstep'` 决定脚下一步，`PSEUDO_ACTIONS` 把它们从出招候选里过滤掉（`hasAttackAction` 才允许 `tryAttack`），`ai.kiteRange` 给「离家多远为止」（针喉 18m），`ai.chaseBeyond` 给「多远放弃阵地回头追击」（缺省 12m，针喉按射程覆盖成 26m）。于是 §14.4「14-26m 永远背退拉近、被贴至 <6m 解围」是**改表**而不是改 AI 分支。
- **连发与假动作**：`attack.launched` 布尔闩锁升级为 `shots` 计数，`ProjectileSpec.burst = {count, everyTicks, at?, feint?}`；`at` 给出每发相对 activeStart 的显式帧位，针喉 `tri` 写 `[0,32,42]`——第 2 发比均匀网格（21）晚 11 tick ≈ 0.25 拍，就是 §14.4 的「假动作骗翻滚」。**反制天然成立**：招式被打断即 `attack=null`，余下发数一起作废，不需要额外的取消表。**诱饵惩罚那一半（KI-085 补的，见 §5.9.23）**：`feint = {shot, punishMs}` 说清"哪一发是诱饵、骗空之后罚多久"，发射时只有 `shots === feint.shot` 的那一发带上 `feintPunishMs`，这个数随弹体走（`ProjectileSpec → Projectile → CombatManager → 玩家`），不是"这个敌人的所有箭都罚"。**只有被无敌帧吃掉才算被骗**（站着硬吃那一发只是普通 R1，罚不了两次同一个信息），于是这一滚欠下 `roll.punishTicks`，在翻滚**自然结束**那一拍兑现成 `stunTicks`。承载格挂在 `roll` 上是有意的：任何提前 `roll = null` 的路径（受击、处决、复活）连带作废这笔账——翻滚都没滚完，不存在"白滚"。
- **新增敌人 `en_skewer`（针喉）**：hp55/poise22/speed2.4，`snipe`(14 伤/单发) + `tri`(10 伤/三发) + `pluck`(近身 9 伤 R3 击退)，弹道 `shard` speed18/range26/无重力/`telegraph`，`loudness:8`（配合新合成音色 `bowstring`：窄带拨弦瞬态 + 两根快死弦音 + 共鸣腔低鸣，是场上最强的听觉信号）。布怪按 gameplay.md §破拍营地塔哨：`regions.json` 营地区加一组 `count:2`。
- 覆盖：`tests/flow/ranged.test.ts` 新增 7 条（弹反反射=100%/给过载/原弹消失、完美格挡反射=50%、反射体真的打回射手、i-frame 不产生反射体、数据表逐字段对 §14.4、三叠箭 32+10 拍帧位、赤线恰好亮满 48 tick、风筝不越 `kiteRange`、<6m 解围）、`tests/unit/projectile-visuals.test.ts` 新增 3 条 telegraph 池化/亮度/复用，`arch-boundaries` 新增「JSON 里写到的每个 sfx key 都在合成表里」。
- **未落地（如实登记）**：KI-014① 之后针喉的弹体与它的赤线都会被**数据点名的**遮挡体截住，KI-014②a 已经把 authored 墙体（`regions.json > walls`）接进同一条线段判定并在灰盒里画出来 ⇒ 写了墙的地方"隔墙狙击"不再成立；但**没写墙的岩石/坡地仍然既不挡弹也不挡眼**（那需要 Navigation/几何抠洞，KI-009）；KI-014②b 已经把**敌人的视线**也接到同一条线段上，所以"隔着已 authored 的塌墙狙杀/被发现"这两件事一起失效了。

### 5.9.2 定调光环与走调时刻（Phase 4-C）— 已实现

需求 §14.6 的叠唱 Refrein 是第一个**给同伴加 buff** 的敌人，它逼着把「增益」从布尔位升级成一份可追溯的数据。同时顺手把 §11 的闷音时长也彻底数据化，过程中挖出两个真实缺陷。

- **`ai.buffAura = {range, attackSpeedMul, dmgMul}` 取代 `buffedByRefrein: boolean`**：布尔位丢掉了倍率来源与数值，任何新支援位都得改代码。现在 `AISystem` 每 tick 重算一遍：先全部置 `null`，再对每个存活个体取**范围内最近**的 `buffAura` 来源，写 `e.buff = {attackSpeedMul, dmgMul, fromId}`。**不叠加**（多个支援位同时加成会让伤害乘算爆炸且不可读），但 `fromId` 保留——HUD/调试器能说「谁在给谁定调」。因为是每 tick 纯函数重算，施主一死、或施主被流送回收，光环**下一 tick 自动消失**，不需要任何清理事件（旧布尔位的做法得记得在 death 里手动清，这是 bug 温床）。
- **攻速加成用整数帧累加，不引入浮点 tick**：`Enemy.advanceAttackFrames(mul)` 每 tick 先走 1 帧，再把 `mul-1` 的余数攒进 `speedAcc`，攒满 1 就多走一帧。理由：帧表里 `tick === f.startup`（广播 callAlly）、`tick >= activeStart && <= activeEnd`（判定窗）、弹体按 `=== activeStart + shotFrame` 发射，全都指望整数；如果直接 `tick += mul`，`===` 分支会静默失配。实测 1.15× 让 48 tick 的招式 41 tick 走完（−14.6%，接近 1/1.15 的理论 −13%，误差来自整数取整与提前一帧结束）。
- **两个消费点，都是数据字段驱动**：`Enemy.activeHitbox.damage = f.damage * (this.buff?.dmgMul ?? 1)`（近战）与 `CombatManager.launchEnemyProjectiles` 里的 `frames.damage * (e.buff?.dmgMul ?? 1)`（远程），从此不再有 `? 1.1 : 1` 这类硬编码。§14.6 的第三项「体力消耗 −20%」**故意不实现也不写空字段**：敌人没有体力经济（受击走架式/poise），写进表里就是个永不消费的谎言，登记在 KNOWN_ISSUES。
- **走调时刻 = `ai.offTuneOnDeath = {stunTicks, resetAlertness}`**，由 `CombatManager.onEnemyKilled → offTuneMoment()` 消费：全场存活敌人 `stunTicks = max(当前, 表值)`、`attack = null`（读条中的招式作废）、可选 `alertness = 0`，并广播 `ring_echo` VFX + `burst_shell` 音效 + `ui.notify「走调时刻！N 名敌人失衡」`。这是「最软的靶=最优解的考点」的奖励端：玩家绕过前排先杀阵后支援，买到的是全场 1.5s 的输出窗口。顺带 `strikeEnemy` 里原来那句 `if (s.mute && e.data.ai.buffAura) e.stunTicks = …` 保留为「沉默能打断施法」的通用规则。
- **伪动作 `'hold'`**：`PSEUDO_ACTIONS` 加第三个成员，`chase` 分支遇到它时**既不追也不逃**（§14.6「本身不近身、不逃跑」）。有了它，「站定唱」是距离带里的一个词，而不是给叠唱开的第 5 个 AI 分支。
- **闷音时长归数据（并修两个真 bug）**：`muteOnHit` 与 `statusOnHit` 的单位统一为 tick，玩家侧结算改为「只认数据里写明的 `ticks`，没写就不挂状态」（原来的 `st.layers * 240` 是藏在代码里的换算表）。挖出的缺陷：① 驼鼓踏地的 `statusOnHit` 写在 `frames` 里面而不是招式层，读取方看的是招式层 ⇒ **它的闷音从来没生效过**，已在 `enemies.json` 移到正确层级并补 `"ticks": 240`（§11 的 4s）；② 数据里 tag 写 `status.mute`、代码比 `=== 'mute'` ⇒ 前缀不匹配，现在用 `/(^|\.)mute$/` 兼容 Gameplay Tag 两种写法。弹体的 `muteTicks` 在反射时原样带回去（沉默时长跟着弹体走，不重新计算）。
- **新增敌人 `en_refrein`（叠唱）**：archetype `support`，hp65/poise30/speed2.0，`buffAura{12,1.15,1.1}`、`offTuneOnDeath{90,true}`、距离带 `[{0,99,['hold','noise']}]`，招式 `noise` 发 `note` 弹（speed20/range18/10 伤/`muteOnHit:120`）。布怪按 §14.6「藏于阵后」落破拍营地：`regions.json` 一组 `count:1 @(-80,0,-212) r2`（在 4 只嘈壳阵心的后侧 12m，实测恰好罩住 2 只——光环该是**站位**问题而不是全自动）。
- 覆盖：`tests/flow/support.test.ts` 新增 14 条（数据表逐字段对 §14.6、12m 内外的 buff 有/无、双来源取最近且不叠加、施主死亡当 tick 光环消失、伤害 = base×dmgMul 精确等式、攻速使整招少跑且 `=== startup` 广播帧不丢、走调时刻的硬直/警觉清零/招式作废三效果、普通敌人死亡不触发、噪音弹 120 tick 与体力回复 −30% 消费方、反射把 120 tick 原样带回射手、**全表扫描：凡 mute 类 statusOnHit 必须自带 ticks**），另在 `spawn.test.ts` 补 1 条「营地编队来自数据：远程+支援位都在场」并把 condition 用例改成按 `enemyId` 收口（同格新增兵不再误报）。
- **未落地（如实登记）**：①§14.6「可见五线光栅罩住同伴」——被定调者目前**没有任何可视标记**，玩家只能从挨打更痛反推，需要表现层一个跟 `buff.fromId` 联动的池化特效（Phase 7 视觉）；②「体力消耗 −20%」无消费方（见上）；③「闷音期间战技/律具技封锁」只落了体力回复 −30% 这一半，因为乐章战技系统尚未存在。

### 5.9.3 节拍空隙与相位实体（Phase 4-D 幽灵八）— 已实现

§14.5 是第一个把**时间本身**当成防御层的敌人：它不闪、不格挡，只是「在拍点上的那一小段里不存在」。落地方式是把相位做成**每 tick 从数据重算的派生态**（和 4-C 的 `buff` 同一思路），而不是需要挂/摘的事件态——没有任何地方需要"记得"把它清掉。

- **相位原语 `RhythmClock.ticksFromBeatPoint()`**：返回「离最近的拍点还有多少 tick」（0 = 正踩拍点），V 形、单调两侧、可比。数据表因此直接写窗口半径 `intangibleWindowTicks: 12`（84BPM 下 ±208ms），容差不藏在代码里（§55）。用距离而不是布尔的好处立刻显形：隐形占比、判定窗相位、测试里的「正拍/半拍」都能用同一个量表达。
- **`intangible = revealTicks <= 0 && ticksFromBeatPoint() <= 窗口`** 在 `Enemy.syncPhase()` 每 tick 重算一次，放在敌人自己身上：命中层只问 `e.intangible`，不重复算拍子。`revealTicks > 0`（被抓出拍隙）时相位免伤整段失效，显形窗内踩在拍点上**也**打得到——这是「奖励」而不是「新免疫窗」的关键回归点。
- **四条消费口**（免疫要闭合必须全部走到，缺一口就是假免疫）：近战 `playerHitsEnemies` 里 `continue`（刃穿过去，且不占目标名额）、弹体 `projectilePass` 里 `continue`（**不消耗** `hitsLeft`、不消失）、处决候选 `e.intangible ⇒ 跳过`（抓不住一个不在那里的东西）、`stepToward()` 顶部 `return`（§14.5「仅半拍窗内位移」⇒ 拍点上追击/逃跑/搜索全定住，`lunge` 也同样跳过）。反向证据是表现层：`ActorVisuals` 按 `intangible` 把身体 `opacity` 切到 0.18，而**振源核始终全亮**——玩家永远能读出「它现在在哪」，打不着的是身体不是位置信息。
- **打空要有反馈**：`cuePhaseThrough()` 每记挥击对同一目标只发一次 `ring_echo`（判定窗有 6 tick，不然刷出一串残影），**刻意不播命中音、不吃 hitStop**——那一刀什么也没碰到，安静本身就是读相的教鞭。
- **三条解法全部数据化（`ai.beatGhost`）**：a) **重音出手 = 一个假拍点**：大剑轻击起手那一帧的 `sound.source`（`(5/10)×noiseMul = 0.75 ≥ 0.6`）先把它的相位打乱 ⇒ 紧随其后的判定窗落在实体段，实测 `revealTicks` 峰值 178（表值 180，每 tick 递减）、hp 降、且**没有** `ring_echo`（打空提示一次都没发，正说明这一刀是真打上了）；b) 拍点闪避抓拍（`CombatManager.phaseCounter`）：判据是「dodge 输入 + 它正在前摇 + 此刻 `intangible` + 我在它**这招自己的 hitbox reach** 之内」——用招式自己的半径，所以不需要额外写死一个"抓拍距离"，射程外的负例自然成立。奖励 = `dodgeRevealTicks/dodgeStunTicks` 各 60（1s），定身复用通用 `stunTicks`，因此**读条中的那一刀一起作废**，不需要取消表；c) 伪拍点声源的通用形态（`Enemy.fakeBeat`）：任何 `loudness ≥ fakeBeatLoudness(0.6)` 的他源声（自己的动静不算、要在 `hearing.range` 内）⇒ 显形 180 tick。消费方是既有的 `sound.source` 事件流，所以 Phase 6 的音色晶道具**只要发一声就能用，零新管线**。
- **阈值 0.6 是被实测卡出来的**：玩家响度 = `(frames.loudness ?? 3)/10 × weapon.noiseMul`，实测四值 = 引针枪蓄力 0.54（打不开）、调律剑轻击 0.3（打不开）、调律剑蓄力 0.7（打得开）、强音大剑轻击 0.75（打得开）——阈值正好落在「潜行／重音」这条设计缝中间，改任何一个数都会把某一类武器误分。这条算术有测试钉住（四把武器逐个比较）。
- **命中帧量化改成「严格向前」+ 允许小数拍位**：`ticksUntilBeatOn([1.5,2.5,3.5,4.5])` 现在用 `wrap(t-1-now, beatsPerBar)` 取最近的未来时刻。旧实现允许"本拍已过就打"，会把命中帧漂到拍间——而 §14.5 的整条读感就是「它与全场反相」，漂了就读不出来。拍位支持小数是这次一起加的（1.5 = 第 1 拍的 "and"）。实测真 AI 时序：量化误差 ≤1 tick。
  > **4-F 更正**：本条原先写的是「命中帧 100% 藏在隐形段里」，那是**量化语义错**造成的假象——旧实现把 `tick 0`（起手）当拍点，于是命中帧比拍点晚一整个前摇，恰好又落回她自己的隐形窗。§2.1 约束的是**命中帧**，改对之后她的命中落在 and 位=她实体的窗口（她本来在拍点上就定身得连招都出不去）。尺子换成 `RhythmClock.offsetFromBeatGrid()`，见 §5.9.5。
- **切分连段用 `frames.next`**：`synco1 → synco2` 的派生不是"下一帧立刻接"，而是把下一段 `tick` 设成 `-ticksUntilBeatOn(next.beat)`（负数=前摇提前量），于是两段之间留下真实的呼吸拍——§13.1 要的惩罚窗口由此来自数据。这个字段是给**所有**敌人用的通用能力，首个受益者是近战连段。
- **时间口径的分工（必须写清，否则后人会改错）**：相位判定用**逻辑 tick**（`GameTime.tick` / RhythmClock 由 main.ts 以 `time.dt` 推进），表现层用 `time.dt`。命中停顿（`hitStop`）把 `dt` 压到 5%，而 `GameLoop.tickFrame` 仍按固定 `TICK_DT` 推进逻辑 tick ⇒ 实机在命中停顿的瞬间拍钟与帧表会有可感知漂移。这条已登记（见 KNOWN_ISSUES「相位与 hitStop 的口径」），修法是让 tick 推进成为节拍唯一时钟源，属于 Phase 5 的时钟统一工作，不在本次伪装修补。
  > **本条后半已经作废（2026-09-24，KI-017 第一步）**：上面那句「RhythmClock 由 main.ts 以 `time.dt` 推进」记的是**当时的事实**，不是设计意图——意图一直写在 combat.md §9 末行与本文件 §4 规则 3 里（timeScale 不许碰判定）。现在 `postTick` 喂的是 `TICK_DT`，`time.dt` 这一条被压缩的通道**只剩相机跟摆在用**。保留原文是因为它记录了口径怎么变的。
- **一个被代码推翻、后来又被补回去的假设（两段都留着，因为它们记录了口径怎么变的）**：原本以为「驼鼓踏地（loudness 0.8）会顺手把幽灵八震出来」，Phase 4-D 实测**不成立**——那时 `sound.source` 的发射口只有四处：玩家动作**起手帧**（`tryStartAction`，`(f.loudness ?? 3)/10 × weapon.noiseMul`）、玩家的跳跃/落地/翻滚/脚步、**敌方弹道发射**；敌人的近战 active 帧只出 hitbox，不 emit。附带发现：玩家侧的发声时机是**起手**而不是刀刃接触，蓄力长的招式因此提前约 0.4s 报信——这对玩法是有利的（给了读招余量），但和「砍中拍点才显形」的原始措辞不严格相同。
- **KI-016 缺口① 已补（2026-09-24）**：`Enemy.advanceAttackFrames` 在**跨过 `activeStart`** 的那一 tick 报一声，响度 `(frames.loudness ?? 3)/10`——与玩家同一条标尺、同一个事件、零新通道。三条边界是这条改动的全部风险面，各自有断言钉住：①判据写"跨过"而不是"等于"，因为 §14.6 的定调倍率会让 tick 一 tick 跳两帧；②**弹道招不在这里响**（发射那一声归 `CombatManager`，否则针喉三叠箭变成 3 声变 6 声）；③**读条招式（`selfToll`/`barCast`）只响一次**：那一嗓子本来就是它全部的动静，所以 `maybeBarCast` 建招时打 `noise: true`，active 帧不再重复报。顺带把那条广播里写死的 `0.9` 换成表值——悬钟骑士 `toll` 的 `loudness=9` 仍是 0.9（不变），而奥斯塔拉「phrase」与恩希尔「breath」表里是 3 ⇒ 那两声自鸣从 0.9 变 0.3。**这不是削弱，是代码不再替数据说话**；若评审认为那两嗓子本该更响，要改的是 `enemies.json` 那一格。玩家侧的"起手 vs 接触"这个时机差（缺口②）**保留不动**：它对玩法有利，且已按代码事实写进 §5.9.3 与 combat.md §14.5。**仍未发声的**：敌人受击、死亡、可破坏物碎裂（本仓库还没有可破坏场景物这一类实体，见 KI-023）。实机读数（隐藏标签页、只步进逻辑）：踏地跨过 `activeStart=30` 那一 tick 报 0.8 ⇒ 幽灵八 `revealTicks` 从 0 跳到 180（同 tick 自衰一格，读回 174 = 180−6）；嘈壳 `bite`（0.2）整窗 `revealTicks=0`；把 0.9 的一声分别挂到敌人 id 与 `player` id 上 ⇒ 孤立观测者 alertness **0.0 对 94.8**（§14 潜行侧的"敌人自己的动静不替玩家暴露位置"由 `AISystem` 那条 `id === 'player'` 闸门保证，不是巧合）。
- **KI-048：§13.0 那行「弹反冲击」与「目击者 +100」——从表上落到线上（2026-09-24）**。上一条补齐的是"敌人自己的招式会响"，这一条补齐的是 §13.0 感知表里剩下的两处空头：`sound.source` 第四条通道（弹反/完美格挡的金属相交）此前只有 `audio.sfx`（那是给玩家耳朵听的，世界听不见），而"目击者瞬间报警"整条无人实现（被弹反者只拿到硬直）。落法刻意为**零新通道 + 零新事件**：`CombatManager.impactAlarm()` 发一条既有的 `sound.source`（id 仍是 `player`，基数取 `player.json` 新增的 `parry.impactLoudness` 0.85 / `guard.impactLoudness` 0.5，出口统一走 `ThirdPersonController.weaponImpactNoise()` ⇒ 武器系数与词缀系数一起乘，无鸣角色防御也安静），然后对 `ai.enemies` 逐个调新增的 `Enemy.sawImpact()`。报警挂在**视觉锥**（`ai.vision.range/fovDeg`，与 `sense()` 同一套数）而不是挂在听觉上，理由是**可测性**：除嘈壳外所有敌人的 `vision.range` 都比 `hearing.range` 长（针喉 30 对 20），若它也走耳朵，就无法证明这条规则多给了任何东西；测试因此把目击者摆在 25m（听不见、看得见），正例一个 tick 从 0 到 100 并 `chase`，负例只把朝向转过去 ⇒ `alertness` 恒 0。三个连带后果一并记下：①0.85 与 0.5 分列幽灵八 `fakeBeatLoudness = 0.6` 两侧，所以"弹反把她拽出来、完美格挡不会"是**表值差**而不是代码分支；②该判据在带静默系数的主角身上会翻面（实机 0.85×0.9×0.733 = 0.5607 < 0.6 ⇒ 那一记弹反惊不动她），别把它当恒等式；③无眼的万籁 `vision.range = 0` 天然不吃目击报警。实机（同一降级口径，真 `GameLoop` 手动步进）：弹反那一声 0.5607、格挡那一声 0.3298，两者都等于表值 × 武器 0.9 × 词缀 0.733（逐项对上 ⇒ 接线无误），目击者 **100 / chase** 对背身的 **0 / patrol**，`ghostReveal` 在两声都 0（因为那个角色被词缀压到了门槛以下）。
- **KI-017 第一步：拍网格从动画时标上摘下来（2026-09-24）**。上面那条"口径分裂"登记至今第一次动手。改动只有两处调用，但选哪一处是全部难度：`GameTime` 上有**两条**时标通道——`GameLoop` 逐 tick 交付的 `TICK_DT`（真实逻辑步）与 `time.dt = TICK_DT × scale`（被 hitStop 压到 5% 的动画步），而 `main.ts` 的 `postTick` 把第二条喂给了节拍钟，于是**每一次命中停顿都在把整张拍网格放慢 20 倍**。实机读数（5199 隐藏页、真 `loop.tickFrame(1/60)`、区域 bpm 84）：长停顿内 20 tick 只前进 **0.02333 拍**，应为 **0.46667**——丢掉的 0.44 拍 ≈ 1/4 拍，正好够把一处命中帧从拍点甩到拍间（§2.1 唯一硬约束）。改后同一探针读到 0.46667，与无停顿时的每 tick 步长严格相等。顺手修的是同一行的另一半：§9 末行「粒子/震镜/音效照常」里，粒子与音频本来就吃 `realDelta`（`loop.onRender`），**唯独震镜没照常**——`CameraRig.update` 的 `s.t += dt` 吃的是压缩时标，包络 `e^(-t/τ)`（§10 定义在真实秒上）在停顿那 90ms 里几乎冻住、恢复时又跳回去。落法：`CameraRig.update(…, shakeDt = dt)` 新增第五参，`main.ts` 显式传 `TICK_DT`；相机跟随/锁定阻尼**仍按 `t.dt`**（停顿那一下镜头该"挂"，这是手感不是 bug）。**这一步之后 `hitStop` 的实际效果只剩"镜头挂一下"**——§9 前半句「冻结攻守双方动画时间」在这个引擎里**没有实现对象**：玩家与敌人的招式帧、AI、弹道、判定全部按 tick 计帧（§4 规则 3 要求的正是这个），灰盒也没有真正的动画时间轴可压。所以 KI-017 保持 **Partial**，第二步要立的是 tick 派生的冻结窗口（`hitStopUntilTick`，纯函数于 `time.tick` ⇒ 现有 headless 夹具一条都不用改），由玩家招式帧与 `Enemy.advanceAttackFrames` 消费，另立一个原语给 §16 的"世界屏息"。守卫：`tests/unit/clock-discipline.test.ts` 4 条（源码扫描：`src/**` 里没有任何调用点把压缩时标喂给 `rhythm.update`，`rig.update` 必须显式给震镜时标；真 `GameLoop` 下系统拿到的 `dt` 恒为 `TICK_DT` 而 `time.dt` 已是 5%；同 20 tick 停顿内=停顿外，配"旧口径只剩 5%"的负例钉住它真的在量那件事；震镜包络在 5 秒长停顿里走完 vs 缺省参数挂住）。夹具口径同步收口：`tests/flow/{combat,gate5,impactnoise,movements,ranged,rpg,status,support}.test.ts` 八处 `rhythm.update(time.dt)` → `TICK_DT`（headless 里 scale 恒 1，所以这是一次**零行为变化**的统一，目的是不再有人拿测试当"两种口径等价"的证据）。
- **KI-037 第一步：第三块时间原语「逐实体冻结」（2026-09-24）**。休止斩（§7.2「全场敌人时间冻结，玩家正常」）逼出来的一个分类学问题：本项目此前有**两条**时间通道——`GameLoop` 的固定 `TICK_DT`（逻辑）与 `GameTime.hitStop` 压过的 `time.dt`（动画），两条都**不是**它要的东西：全局时标会把玩家与拍网格一起停掉，而 §7.2 要的恰恰是"只有它的节拍被拿走"。落法是新加一格 `Enemy.frozenTicks`，短路点选在 `Enemy.update` 里 `syncPhase(rhythm)` **之后**：拍隙（§14.5 的 `intangible`）是世界的网格派生出来的，冻结一个敌人不许同时把它的拍隙读数冻成过期值。短路点之后的 everything 全停——`syncBoss`（阶段机）、`stats.update`（架势/震裂/闷音衰减）、`stateTick`、`tickIntro`、`stunTicks`、整个状态机与 `progressAttack`。三条语义边界各有断言，不靠注释维持：`frozenTicks` **不清 `attack`**（读条停在原地，松手从同一帧继续，那 15 血照样回来）而 `stunTicks` 清（读条作废，血永远回不来）——同一世界、同一 tick 序列上的正/反两例；`freezeTicks` 没写的式子一个敌人都不冻；`combat.hit` 在整段窗口里**一条都不产生**（时停刻意不走 `strikeEnemy`：那条通道的预设是伤害/架势/震裂/hitStop/命中事件，而时停打在没有人的地方）。结算侧的入口在 `CombatManager.caesuraFreeze()`，紧跟 `playerHitsEnemies` 之后、**每个动作对象只发一次**（`caesuraAction` 存对象引用而非 id，与 `cuePhaseThrough` 同一惯例：一次出手的判定窗跨多个 tick，按 id 记账会把同一式第二次装上去的冻结也吞掉）。涨价那半（§7.2「每次使用后过载消耗 +2」）刻意**不入 `MovementSnapshot`**：它是运行时账，和冷却同类，复位判据是"过载条重新攒满"而不是第二个计时器（同一件事不能有两条时间）。守卫：`tests/flow/movements.test.ts` 休止那两节 6 条 + 谱册第四页自动出现在 UI 的 1 条（`Stakerite` 零改动——`renderMoves()` map 的是 `book.cfg.pages`，数据加一页 UI 就多一页）。实机 5199（真 `loop.tickFrame(1/60)`、区域 bpm 84、场上两只杂兵 + 奥斯塔拉）：出手 +12 tick（＝`activeStart`）那一刻三只各自 `frozenTicks` 峰值都是 **48**，其后 60 tick 里 `stateTick` 只前进 **12**（Boss 同为 12），`rhythm.info().beatIndex` 期间 +1，`combat.hit{attackerId:'player'}` **0 条**，提示「休止｜3 个声音停在拍上」，`skillRampOf` 从 0 → **2**、过载 10 → 0。**当时没做也不假装做了的三件里的两件**（第三件——弹体——在下一步补掉）：`ActorVisuals` 那两处"停住呼吸"的可见 tell 只有代码事实没有像素评审（本环境视口不可用，KI-010/KI-027）、Boss 私有拍速与冻结的连带影响（她在冻结里 `syncPhase` 仍照跑，但她的 `clockOwner` 拍长会不会因此把下一次出手量化到别的拍位）没做逐项评审。
- **KI-037 第二步：把逐实体冻结镜像到弹体（2026-09-24）**。第一步登记的第二件缺口是"弹体不吃时停"，理由当时写的是"声音已经离开发声体"。这次把它推翻，理由是**玩法**而不是物理：休止斩不出伤害、不产命中，它卖掉过载换的**就是时间**——如果对面是针喉，"全场停下"之后仍有一发音弹照常飞过来把玩家打死在停顿里，这一式对远程敌人就是个陷阱。落法是把同一格账挂到 `Projectile.frozenTicks`：短路点在 `ProjectileSystem.update` 的积分**之前**（时间没过 ⇒ 路程与射程一起没过，所以不是"把 dx/dy/dz 置零"），扣减与跳过同 tick 完成。三条边界各有一条断言：①**冻结只停运动学、不停命中判定**——玩家撞上停在半空的弹体照样挨打（它是障碍物不是幻影，否则柱子那类"吃掉一击"的读法会在这里变成隐形斗篷）；②**不对称是刻意的**——`hostile: false` 的玩家弹体在一模一样的窗口里照常前进（§7.2 那句"玩家正常行动"）；③**播报把正在飞的音弹算进"声音"**——「休止｜N 个声音停在拍上」的 N 现在等于活敌人 + 敌方在飞弹体；这一条改的不是文案而是反馈：场上没有活人、只有她临死那一发还在空中时，恰恰最需要那一声确认（否则玩家以为自己那记打空了）。**逐弹体记账而不是挂一个"世界冻结窗口"**，与第一步同一个理由：冻结之后才射出来的那一发不该跟着冻结，而同一件事不能有第二条时间。表现层顺带补了 tell：弹头的呼吸与自旋本来就吃着全局 tick，冻结时必须整段跳过，否则一颗"停了"的音弹仍在原地自转发光（`tests/unit/projectile-visuals.test.ts` 钉住"冻结期间不换档、松开就换回来"，池化网格不会带着过期的静止状态进入下一发）。**一处读数口径差写清楚，免得下次有人以为是 bug**：`Enemy.update` 跑在 `combat.update` 之前、`projectiles.update` 跑在其后，所以冻结落地的那一 tick 弹体已经自己扣掉一格（读数是 47 而不是 48）；两边**静止的总 tick 数**严格相等，测试因此量"静止了多少 tick"而不是量字段读数。实机 5199（真 `loop.tickFrame(1/60)`、真针喉 AI 出手）：离弦那一发在空中**静止 48 tick**＝表里那一格，随后自己接着飞；同一记里射手峰值 `frozenTicks` 48、另一只敌人 48、弹体峰值 47（口径差如上），播报「休止｜4 个声音停在拍上」＝2 只敌人 + 2 发在飞。**仍然没做**：`ProjectileVisuals` 那"停在半空"的可见差别只有代码事实，没有像素评审（本环境视口不可用，KI-010/KI-027/KI-045 同因）；冻结中的弹体因此也仍然可被弹反且因为静止而更好弹——这是这一式对远程的补偿，不当漏洞处理，若评审认为该收紧，改的是弹反判据而不是这条。
- **KI-021 第二步：首杀奖励的整链对账（2026-09-24）**。这一步不写新功能，它把一句**推断**换成一条测试。此前 §9.3「振源核只掉一次」钉在中间 API 上（`rpg.onEnemyKilled(数据)` 直接调，而且只测了奥斯塔拉一份数据），于是生产路径上「真打死 ⇒ `entity.died` ⇒ `KillSettlement` ⇒ 掉落 ⇒ 背包 ⇒ 谱册点得亮」这一整段**没有测试**——而 Phase 5-C2b 抓到的那个 bug（万籁的首杀奖励挂在一个从不进 `applyHitStatus` 的静默 id 上）恰好死在这段里。现在 `tests/flow/boss-rewards.test.ts` 6 条把三场 Boss 战各跑一遍真通道：出手用 `ProjectileSystem`（不是直接调 `strikeEnemy`），结算用生产那份 `KillSettlement`，测试自己不叫任何死亡或掉落函数。**打满一整场而不是一发秒**：首发 9999 会跳过阶段机，而"阶段机跑到最后一阶之后还认得首杀这件事"正是要量的东西（奥斯塔拉 P1 的钟壳只吃 10% 伤害，因此她要二十几记才过第一档）。实机 5199（真 `main.ts` 组合根、真 `loop.tickFrame(1/60)`）三条路各读一遍：①她带着 §5.3 弹反失音那段硬直挨一记 90ms ⇒ `stunStopTicks` 5→0 的那五 tick 里 `stunTicks` 恒 17、`stateTick` 每 tick 照加、`frozenTicks` 全程 0（所以这不是 §7.2 那种整只停），第七格才降到 16、然后 15、14；②玩家被同一记打着 ⇒ `combat.hit` 报的是 **80**（§9 情境表那一格，不是弹体带进来的 90），`stunTicks` 恒 12 五格后接着 12→11→10→9；③真弹反成功 ⇒ 事件报 **120**，她被 `onParried` 挂上的 18 硬直在原地停 7 格 = `msToTicks(120)`，第九格才降到 17，相机 `rawScale` 0.05 走完回 1。**仍然没做**（都写进 KI-017 行）：出手方那一半（需要"停顿之后回拍重新量化"这件新机制）。**量具已于同日重造**：`gate5.brawl` 的按键改成按玩家状态排（每 300 格起一次蓄力尝试、按住直到真攒满，两腿各 6 次），顺带更正了 KI-039 那条腿的一处旧读数（旧脚本按绝对 tick 排按键，会吞掉"收招被拉长"那一侧的按键：同一份脚本在力身上给 3 次蓄力、在律身上只剩 1 次，律甚至整窗没碎甲——那是相位吞键，不是节奏）。公平量具下力 771/20/393 tick 碎甲、律 533/32/995 tick 碎甲，比值 1.40 → **1.45**，而律其实也碎甲、只是晚 600 格。再用它做攻方那一半的 A/B：比值 1.45 → **1.60**，仍在 [1, 2] 内，无甲那条腿也没越带 ⇒ **数值闸门不反对**。（更正：上一条提交里那个 2.04 是半套补丁测出来的假读数——签名改成三参数时只接通了一处调用点，另两处仍按两参数调用，于是守方的账整个记错了对象。这种数一旦进台账就会误导下一次决策，所以这里留着改口记录。）所以攻方那一半等的是一次**手感裁决**（每一记命中多付 3~7 格换"刀陷进肉里"，而灰盒阶段没有可见收益），不是等数值放行。四个情境时长仍住在代码里（挪进 `player.json` 要动 `schema.ts` 与验证器，这两份文件正被并行会话写）、破防那 36 tick 硬直压根没有停顿格（§9 没给它一行）。守卫：`tests/flow/hitstop.test.ts` 9 条（敌方受击含 `hitStopMs=0` 对照腿 / 玩家受击 / 弹反那 120ms / 只停硬直不停状态 / 打空不产生停顿 / 回声不抢时间 / 与时停分格 / 出手方两条例子）。反向实测：把 `freezeContact` 的写入短路 ⇒ 5 条红在各自该红的断言上；把弹反那一格的写入删掉 ⇒ 弹反那条红；把敌方招式帧的冻结加回去 ⇒ §2.1 那四片红回来（就是上面那些数字）。
- **KI-037 第三步（评审，不改引擎）：Boss 的私有拍速跨过一次时停还成立吗（2026-09-24）**。第二步结案时登记过一句"没做完就不写已验证"：休止斩把她的节拍按住 48/60/72 tick，而她的招式帧**就是**她的拍面（§15.2 的 `clockOwner`：奥斯塔拉 108、恩希尔 92），§2.1 又是全作唯一那条硬约束「命中帧踩拍点」——两件事挂在同一只实体上，不读一遍没人知道会不会撞。读法：同一段 2400~3600 tick 的交战跑两世界（一世界不冻、一世界在她收势帧那一 tick 真打一发休止斩，走 `tryStartAction` 不是手搓 `frozenTicks`），每招收势帧那一 tick 记一次 `rhythm.offsetFromBeatGrid(spec.beat)`。结论是**不撞，而且原因值得写下来**：她的排招不是"收招即出手"，而是去抢一个**拍位槽**（`slotTaken(bar_beat)`），所以被拿走的 48 tick 整个落在她本来就在等的那段空隙里——误差 奥斯塔拉 5.6ms 对 5.6ms、恩希尔 8.0ms 对 8.0ms（容差 50ms），出手次数 22/22 与 10/10，她付出的代价是**错过一个槽**（最长间隔 167→200 tick，正好她的一拍 33.33），不是谱面散架。P2「夺拍」那一段单独读一遍：换气拍的次数不被一次冻结改变。**万籁不在范围内，而且是数据说过的**：她每一招都显式 `onGrid: false`、`boss.bpm` 也不存在（无拍点身份），所以这条问题在她身上没有对象——现在有一行断言钉住这个"没有对象"，不再是一句口头豁免。顺带一条测量教训：探针第一版红在"休止斩没出手"上，原因是玩家被她打到之后进了闷音 ⇒ §11 那条"闷音封战技"把这一式拒了——那是既有规则在正常工作，不是缺陷；评审类探针要把这种无关的失败面挡掉（本文件的夹具每 tick 顶满血、清硬直、清闷音）。守卫：`tests/flow/bossfreeze.test.ts` 5 条（两位有拍速的 Boss 各一条"误差不超过对照且不超 50ms"、万籁的资格断言、恩希尔 P2 换气拍、以及"冻住的那几 tick 她的 `attack.tick` 一格没走 + 间隔集合不许出现新的取值"）。
- **§44 装备对比 Current vs New（KI-027 的第二步，2026-09-24）**。面板此前只能列出"这件有什么"，而 §44 要求的是"换上之后我失去什么"。落点选在**投影而不是加法**：新增 `Equipment.preview(inv, uid)`，把这件装到它自己的槽位（音徽沿用同一条 A→B 规则，规则从 `equipSeal` 里抽成 `sealSlotFor` 让两处共用一份），再走 `totalsFrom(slots, inv)` 重算整套乘数；`totals()` 现在只是 `totalsFrom(this.slots, …)` 的一层薄壳，所以"当前"和"换上"两栏天然同源。为什么不写"把这件的属性加到当前上"：强化倍率是按武器等级、噪音是加总偏移后 clamp 到 0.1、音徽 A/B 谁占哪槽、词缀行为位（之鸣钟/之切/之休止）全在 `totals` 里——抄一份加法就会和装完之后不一致，而玩家把那种不一致当 bug 报。投影**不碰真实槽位**（单测专门钉一条：preview 前后 `eq.slots` 逐位相等）。UI 侧是一张行表（`CMP_ROWS`）：`get` 只读 `EquipMods`，面板不认识任何数值表；「重击底数」是唯一的例外，那一格住在 `movesets.json` 的帧表里（乘数表里没有它），所以单独取 `actions.h.damage × weaponDamageMul`，并在名字里说清它是**底数**不是最终伤害（还要过属性补正与减伤）。差值一律带形状（▲/▼/—）而不只带颜色，这是 ui-ux §7 的双编码口径；"—"后面也写 0。常驻三行（重击底数/防御/负重）即使不变也留着，其余只在变了的时候出现——§243 要求"差值一屏内"。**没做的两件有原因**：星标建议需要一张维度权重表（权重是数值不是排版，§55），而它要动的 `schema.ts` 正被并行会话写；负重与噪音两行"越低越好"，按 §3.3 字面着色会反，本环境看不到颜色对照，留给视口走查。实机 5199 真 DOM 读回两块对比（多出来的一顶头巾、一枚音徽投到空着的音徽 A），画完 `eq.slots` 逐位不变。守卫：`tests/unit/stakerite.test.ts` 12 条（本步 +4：双栏与每一行差值 / 已装备件不再有对比块 / 同件拷贝不得出现任何 ▲▼ / 投影不改真实槽位与音徽规则）。
- **KI-027 第三步：超载这条拒判第一次出声（2026-09-24），顺带读出 KI-049**。§5.1 那三条超载惩罚（翻滚拒 / 疾跑拒 / 体力回复 −40%）一直生效，但拒判是**彻底静默**的：玩家按下翻滚键，什么都不发生，也不知道为什么——这与需求 §25「每次输入都要有可感知的反馈」直接冲突。落点两条，都是"读同一份数"而不是各写一份：`ThirdPersonController.warnOverloaded()` 在拒判那一 tick 播报「负重超载 w / max kg · 翻滚与疾跑禁用、体力回复 −40%」（120 tick 冷却：连打不刷屏，但一次都不说就是键坏了），面板的负重那一行从「DEF / 上限」改成「DEF / 当前重量 · 上限 · 超载与否」。`tests/flow/overload.test.ts` 5 条里最要紧的不是"有没有播"，而是**那句不许撒谎**：报的两个数就是判据用的那两个数（走 `applyRpg` 那扇门注入，见下面那条不可达的事实），回复那一半量的是**实际挂到 `EntityStats.mods.regenMul` 上的乘子**而不是"回了多少体力"——后者会被上限截断，两跑都回满就量不出 0.6，那是量具的假绿不是惩罚的存在证明。对账读出来的那件大事另开一条 KI-049：**当前装备表下没有人能超载**（全穿最重 40 kg，最轻的负身上限 52 kg，音级 4 里程碑再 +8），所以这三条惩罚与刚接上的提示都是"没有真实压力的规则"（同族先例 KI-032）。没有顺手改重量或上限：那会重开 KI-039 那套建卡对账，需要一次带读数的裁决。取而代之立了个闸门——那条不可达的事实由测试钉住，装备表哪天把它激活，测试就会红并且写明要回去复核什么。实机 5199：面板那一行读到「DEF / 负重 21 / 24 · 上限 60 kg 未超载」，而**翻滚被拒那一句没有实机读数**——不是没做，是这个状态在现有数据下进不去（KI-049 就是为这句话存在的）。
- **KI-007：手里的家伙跟着装备走（2026-09-24）**。表现层此前无论装哪把武器都画同一根音调叉大剑——这不是"还没做美术"，是**装备系统看起来没生效**：玩家换了武器，手里没变。落点选在形状表而不是新组件：`ActorVisuals` 构造时按 `weapons.json` 的 `archetype` 一次建好四组（直剑 / 大剑 / 枪 + `unknown` 回退组），每 tick 只翻 `visible`（几何体留给渲染器复用，换装是常态而不是事件），挥击 / 格挡 / 翻滚的姿态依旧挂在容器上，所以换装不需要动动画一行。**表里没有的 archetype 回退成"看得见的一把"而不是空手**——这条是被测试逼出来的判断：`actor-visuals.test.ts` 里那条负例说明"手里空了"会被玩家读成装备没生效，比"看着还是把剑"更糟。选形是数据驱动的（换 `archetype` 就换形状），组内尺寸是灰盒美术，真资产来了整组替换而选择逻辑不动。实机 5199 走真装备路径（`eq.equip` → `refreshRpg` → 一个 tickFrame）：容器里常驻 8 个网格，换大剑之后只有 `weapon:greatsword` 那组 `visible=true`，换枪之后只有 `weapon:spear`。
- **KI-003：处决那一下现在有它自己的声音（2026-09-24）**。此前借的是和弦爆的 `chord_slam` 加通用碎尸声，而 audio.md §破处决 写的是「一切声音 80ms 内塌向 100Hz 低通——处决是让声音死」：占位音色把这一刀的唯一性抹平了。两处补：①`execute_rest` 进音色表（音叉被按停的下滑 + 抽走空气的窄带噪声 + 落进胸腔的那一下），静杀不走它；②低通挂在**总线**上（`master → muffle → comp → destination`）而不是逐个音源——spec 说的是"一切声音"，一类一类去改等于给每类声音各写一遍豁免，漏一类就是一次听感 bug。信号只有 `audio.muffle{on}` 一格，**刻意没有时长字段**：时长就是 `player.executing` 那一格，若在音频侧再写一个秒数，演出改长度时没人记得改它。开与收都在 `ThirdPersonController.update` 的开头按边沿采样——清掉 `executing` 的地方有四处（走完 / 换装 / 死亡 / 重生），逐处 emit 必漏，而漏掉"关"就是世界被永久闷住；换装那条单独有用例。实机 5199 用真 `KeyboardEvent(KeyE)` + 真 `loop.tickFrame` 走了一遍：`execute_rest` 发出来，`audio.muffle` 在 tick 202 开、334 关，132 tick 正等于 `execution.durationTicks`。听不见的部分也照实说：本环境是隐藏标签页（KI-010），能钉的是事件、长度与 spec 读数（100Hz/80ms/180ms 抽成`muffleRamp` 这个纯函数才有断言可写），不是耳朵。守卫 `tests/flow/execute-audio.test.ts` 5 条。
- **KI-021②：跳阶那一声低通接上了，代价是给低通配一个仲裁者（2026-09-24）**。§15.1/§10 的转阶段三件套里，hitstop 250ms 与震镜早就在了，唯独「全频低通 0.8s」要等 KI-003 那条总线节点。接的时候撞到一个真问题：**低通有了两处来源**（处决演出跟着 `player.executing`，跳阶是一段自己数 tick 的计时），各自 emit on/off 一定会互相踩——处决进行中跳了阶，先结束那一方会把另一方还需要的低通提前撤掉，而且这种 bug 只在两个窗口重叠时出现，最难复现。做法是把边沿判定收成一格状态：`CombatManager.arbiteMuffle()` 每 tick 在 update 末尾算一次 `held = 演出中 || 吼声计时 > 0`，只在 `held` 翻转时 emit；玩家侧那套 `syncMuffle` 撤掉（它看不见 Boss 那一侧）。**先判后扣**：起音那一格算第一格，否则 spec 的 48 格会变成 47 格。实机 5199 真跳阶：`boss.phase` 与 `audio.muffle{on}` 同 tick 31、`off` 在 tick 79，跨度 48 tick = 0.8s。重叠那条有用例（跳阶后 60 tick 内再起一次处决 ⇒ 吼声先走完也不许解除，直到演出结束），它才是这次改动的真正目的。还欠的一笔：这一格的三个时长（800/250/900ms）与 §9 那四个情境时长是同一类债——都该在表里，而表要动正被并行会话写的 `schema.ts`。
- **KI-017 第三步：§9 前半句的攻方那一半落地，靠的是"窗内只记账、窗尾之后兑现"（2026-09-25）**。前两步把停顿接到了守方（硬直倒数）与相机，于是「命中被格挡 45」「完美格挡 90」这两行**压根没有守方载体**（格挡中的玩家不进硬直），只喂了相机一个数。新原语在 `src/combat/ActionFrames.ts`：出手方（`player.action` / `enemy.attack`）各自带 `stopTicks`/`stopDebt` 两格，`freezeContact` 从此是四参数（守方一格＋攻方一格，同一个 `msToTicks` 时长派生），身份由 `EnemyStrike.sourceAction` / `Threat.sourceAction` 对上——**"此刻正在挥另一记的人"不被按停**（弹体命中不带载体：射手离手之后那一式已经不是这一记）。中间那一版把停顿按在判定窗**之内**，实测顶红 §2.1 五条腿：奥斯塔拉落点迟 83.33ms（5.0 tick）、恩希尔迟 89.86ms（5.4 tick），容差 50ms——补帧找回的是收势那一 tick，被推开的却是**窗尾**，而玩家背的正是"落点在第几拍"。四条判据与配额写在文件头（`floor((recovery − activeEnd − 1) / 2)`：收势比窗尾晚不到三帧的招式一格也按不住，配额由数据自己报；带连发拍位的弹道招式整式豁免）。**跨系统对账两处**：① 位移——前冲段按老约定是 `startup .. startup + activeEnd`，比判定窗晚 `startup` 格，所以停顿与还债**必然**重叠，`adv > 0` 与"位移按 `adv` 缩放"不是装饰（否则"人定在原地滑行"）；还债的双格步也落在同一条带里 ⇒ 带内走过的帧数不变 ⇒ 实机前冲落点分毫不差（两腿同为 0.369444m）。② 状态机——`Enemy.freezeAction` 只在 `this.attack === src` 时记账，而 `onParried` 会清掉 `attack`，所以弹反那一格只有守方落点，调用点注释里明写"攻方无载体"。**实机（5199 隐藏页、真 `loop.tickFrame(1/60)`）**：她的 `stomp`（窗 30–39、收势 66）被打中之后账本挂到 5 格，而按住的那五格全落在 tick **40 = 窗尾 +1**，`mallet` 那五格全落在 55；玩家 `l1`（窗 12–18、收势 30）命中腿的时标序列是 `…18, 19×5, 21, 23, 25, 27, 28, 29`，挥空腿是 `…18, 19, 20 … 29`——两腿**采样 tick 数同为 29**、窗内同为 7 格。守卫：新增 `tests/unit/action-frames.test.ts` 9 条（载体＝全数据表：武器招式帧＋敌人招式帧＋乐章战技帧逐帧扫，每把尺子配 `freezeAt: null` 对照腿，断言净时长、窗长、弹体豁免逐 tick 全等、配额、"两次接触只抬到额度不叠加"，并用 `heldTotal/capped/exempt` 三个计数保证这些腿都不是空转）、`tests/flow/hitstop.test.ts` 由 9 条改成 10 条（原"停顿不按在出手方"那两条边界按现行口径重写：挥空/命中对照＋弹体离手不按射手＋完美格挡那 90ms 落在敌人身上＋前冲落点对账）。**反向实测三次**：拆掉 `freezeContact` 的攻方那一支 ⇒ flow 红 2 条而 `gate5` 一条不动（它量的正是净时长，这一句就是"停顿没吃逻辑时间"的反证）；拆掉弹体豁免 ⇒ 只有单位腿红 2 条，读出来的事实是**这条豁免今天在市场上打不到**（全表 7 式带弹道的招式近战判定盒全是 `null`，弹体命中又不带 `sourceAction`），留着是守原语的定义域；把停顿挪回窗内 ⇒ §2.1 那 5 条红回来。KI-017 名下仍未做的两件照旧（前一件在同日的第四步收口，见下条）：四个情境时长入表（要动 `schema.ts` 与验证器）、破防那 36 tick 硬直压根没有停顿格。
- **KI-017 第四步（②结案）：§9 的时长列只剩一个来源，代价是验证器当场给我自己抓出一个静默 bug（2026-09-25）**。第三步留下的第一件债收口：四个"情境索引"的停顿时长进了 `player.json > hitStop`（`hurtMs 80 / blockMs 45 / perfectBlockMs 90 / parryMs 120`，schema 键名 `PlayerBaseData.hitStop`），`CombatManager.resolveAgainstPlayer` 从 `p.base.hitStop` 读，于是相机、`combat.hit` 事件、守方硬直倒数、攻方招式帧账本四处吃的是同一个数——第三步那句"一个答案两个数"（相机吃写死值、事件吃帧表值）到此没有写死值的通道了。另外两行不进 `player.json`，进本来就属于它们的格子：「处决首刀」在 `execution.firstBladeHitStopMs`（处决这一式的属性，不是玩家通用情境），「Boss 转阶段砸地」在 `enemies[].boss.roar { hitStopMs, muffleMs }`（挂 boss 而非 `phases[]`：怒吼是这位 Boss 的招式而不是某一阶的开关，单阶的万籁因此不写这一格，§55「没有消费方的数不许进表」由验证器守住），「夺拍」在 `phases[].stealBeat.reclaim.hitStopMs`。`ROAR_MUFFLE_MS = 800` 那个常数删除。**验证器加三组规则**（四键齐全 + 区间不变量、多阶 Boss 必带 roar、reclaim 时长 ≥0），而 roar 那条**插错位置**：我把它塞进 `if (!isArr(b.phases)) report.error` 与它的 `else {` 之间，于是所有声明了 roar 的 Boss 静默跳过了整条 `phases[]` 校验——正向跑不出任何东西，是**反向探针**（把 `reclaim.hitStopMs` 删掉却拿到 0 ERROR）把它揪出来的。改成独立 if/else-if 后重探：重复阶段 id、`belowHpFrac: 5`、缺 `hitStopMs` 各自回红。这条教训值得留着：**新规则放进别人的 if/else 分支里，等于把自己变成那条分支的开关**。**守卫口径换了刀法**：`hitstop.test.ts` 的期望值全部从表读，而"读到的就是表里那个"用**改表法**钉死（把 `hurtMs` 改成 200 ⇒ 双腿被按住的格数之差 == `msToTicks(200) − msToTicks(80)`；「格挡 45」走真持盾路径实测按在出手方身上），boss/stealbeat 各一条改表腿（`roar` 两值改判演出长度、`reclaim.hitStopMs = 420` 改判那一声停顿），本步净增 5 条。**反向实测四次**（把常数写回代码）：`hurtStopMs = 80` 写死 ⇒ 红「改了表却没改行为 ⇒ 代码里还藏着第二个数: expected 80 to be 200」；`freezeContact(blockStopMs, null, null, null)` ⇒ 红「45ms 没按到她正在挥的那一记上: expected +0 to be 3」；roar 两处回写死值 ⇒ 各红在低通格数与 hitstop 读数上（expected 48 to be 21 / expected 250 to be 500）；reclaim 回写 `0.18` ⇒ 红「expected [ 180 ] to include 420」。**实机（5199 隐藏页、真 tick 步进）**：`player.base.hitStop` 读出四个表值；受击腿 `stunStopTicks` 峰值 5（= `msToTicks(80)`），把 `hurtMs` 现场改成 300 ⇒ 峰值 18，改回 80 ⇒ 峰值 5（还原复验）；格挡腿 `combat.hit` 报 45、出手方账本峰值 3，现场改 300 ⇒ 事件 300、账本 18。全量 **50 files / 532 passed**。**剩下一件**：破防那 36 tick 硬直压根没有停顿格（§9 没给它一行）——那是口径裁决不是接线活，仍挂 KI-017（**同日的第五步把它裁了，见下条**）。§10 的震镜表（`CameraRig.SHAKE_TABLE`）是另一张表、另一个消费者，不在本步的账里，也没被假装收掉。
- **KI-017 第五步（③裁决）：破防不进 §9，进 §10——顺手撞出「600ms 大踉跄」从未成立过（2026-09-25）**。§9 从没给破防一行，裁决是**不加**（把表没给过的数补进表里就是伪造设计）；破防的时间演出本来就有名分：§10「破防/被破势」那行的附加格「0.3s 慢放 ×0.75」，承载体是 `GameTime.hitStop` 现成的第二个参数——第一步解耦之后，这条真实时标只拖相机/阻尼，拍网格照 tick 走，§2.1 不受害。三格进 `player.json > guard`（`breakStunMs 600 / breakSlowMs 300 / breakSlowScale 0.75`，验证器卡 `scale ∈ [0.05, 0.99]`：≥1 不叫慢放，那格该删）。**裁决路上撞见的谎**：旧代码先 `p.stunTicks = 36` 再 `p.takeDamage(...)`，而 `takeDamage` 无条件把硬直钉成受击那 12 格 ⇒ 36 从未生效过，破防实际只踉跄 200ms；现在赋值写在 `takeDamage` 之后并由 `msToTicks(breakStunMs)` 派生。守卫 3 条在 `hitstop.test.ts` 新 describe：spy 断言这一路**只有**一次时标请求且恰好是 `(表值秒, 表值比例)`，另两条反证钉住"§9 的账在这条路上全是零"（事件 `hitStopMs == 0`、守方 `stunStopTicks == 0`）——日后谁把一次 hitstop 塞进破防，腿先红。反向实测四次：改回旧顺序 ⇒ 真破防腿红（expected 12 to be 36）；摘掉慢放 ⇒ 两腿红；把 `(0.3, 0.75)` 写死 ⇒ 改表腿红；事件不写 `hitStopMs: 0` ⇒ 反证腿红。验证器反向两探：删 `breakStunMs` ⇒ ERROR「必填但缺失」；`breakSlowScale = 1.2` ⇒ ERROR 超范围。**实机（5199 真 tick 步进、真持盾 8 格后掏空体力、真弹体落地）**：`stunTicks 36 / hitStop 请求 [[0.3, 0.75]] / rawScale 0.75 / 事件 hitStopMs 0 / stunStopTicks 0`；现场改表 200/900/0.4 ⇒ `12 / [[0.9, 0.4]] / 0.4`，还原复验 600/300/0.75。撞出来的两笔新账另立不并进本条：受击那 12 格仍写死在 `takeDamage`（KI-050）、§10 附加格里 FOV 脉冲/踏地尘环/处决推轨没有承载体（KI-051）。KI-017 至此五步跑完，§78 状态转 Implemented（§16「世界屏息另立原语」一句同批裁决为**不做**：借 hitStop 就是设计，再立电影时标反而把拍网格拴回演出）。全量 **50 files / 535 passed**。
- **KI-050：§8 受击反应表第一次有自己的数据行——只有有承载体的那两格（2026-09-25）**。第五步撞下的两笔账一起收：`takeDamage` 写死的受击 12 格 / 0.2m，与 `EntityStats.addPoise` 写死的破势 108（§8 R4 的「Boss 2.4s」半边**从未有实现**，Boss 与小兵一样 108 格）。新表 `data/json/reactions.json` 只有两行：**R1**（200/0.2，消费方 `ThirdPersonController.takeDamage`）与 **R4**（1800/2400，消费方 `EntityStats.addPoise` 经新原语 `combat/Reactions.ts:armCrumple(stats, isBoss)` 在构造方上弦——与 `armStats` 同口径：**EntityStats 不认识 JSON**，谁造 stats 谁上弦；没上弦就破势 = 抛，`addFissure` 同款纪律，"静默免疫破势"会把架势条变成摆设）。**R0/R2/R3/R5 刻意不进表**：敌人侧没有"按等级挂硬直/位移/中断"的消费方（`reaction` 字段至今只是声明＋词表校验），写进去就是 §55 禁的那种数据——这笔分级工程整条另立 **KI-052**。「硬直可翻滚取消」那半句不写新代码：翻滚入口本来就不看 `stunTicks`，`reaction.test.ts` 的反证腿钉住的是**日后不许把它接回去**。守卫：**新增 `tests/flow/reaction.test.ts` 9 条**（在表 ×2 / 真挨一击读数 ×1 / 小兵-Boss-玩家三侧破势同源 ×2 / 改表法两组各带还原复量 ×2 / 翻滚反证 ×1 / 未上弦抛出 ×1）。**反向变异三次**：受击回写死 12/0.2 ⇒ 改表腿红；破势回写死 108 ⇒ Boss 两条腿红；Boss 按小兵那格上弦 ⇒ 同样红两条——每个红点都是一格曾经的写死值。**validator 反向三探**：塞一行没有承载体的 R2 ⇒ ERROR；`bossCrumpleMs < crumpleMs` ⇒ ERROR（Boss 不该比小兵破势短）；删掉 R4 ⇒ ERROR「已有消费方，缺行就是运行时抛错」。**实机（5199 真 tick 步进）**：受击 `{stunTicks:12, Δz:+0.2}`、现场改 `R1.stunMs=500` ⇒ 30、还原 ⇒ 12；小兵/Boss 破势 `{108,144}`（144 是这一格第一次在运行时成立）；未上弦的裸 stats `addPoise` 抛出。顺带把第五步留下的注释债清掉：`CombatManager` 破防那行注释里"钉成 12 格"的口径改成指向 R1 那一格。
- **KI-051：§10 附加格的三笔表现层欠账接上了——FOV 脉冲、踏地尘环（含落帧震场）、处决推轨（2026-09-25）**。三格三条通道，各自只有一个消费者，符合"震镜表是代码表"的既有裁决（KI-017③ 同源）。**① FOV 脉冲**：`CameraRig.SHAKE_TABLE` 加可选 `fov/fovMs` 列（重击 -1°/120ms、新 `stomp` 行带 -2°/150ms），包络 sin（冲下去自己回来），与震镜同窗吃 `shakeDt`——它是"那一记"的一半，不许在停顿里比震镜慢半拍。**② 落帧是世界事件不是命中回报**：`FrameData.worldShake` 与 `shake` 分家登记（那格=打在谁身上震多重，这格=落帧震场、**挥空也执行**），发射点选在 `Enemy.advanceAttackFrames` 越过 `activeStart` 的那一 tick——KI-016 的发声出口，同一"落帧=全场景最响一刻"的口径；新总线事件 `camera.shake{key,pos}` 到 `CameraRig` 按震源水平距离衰减（24m→0.25 底幅，表现层自裁决常数，写进代码注释与本条）。这一接**顺带上线了 enemies.json 里二十多招从无发射方的 `frames.vfx` 声明**（挥剑轨迹/砸地尘环），踏地补 `vfx:["ring_dust"]`；校验器词表加 `stomp` 并对 `worldShake` 卡同一词表。**③ 处决推轨**：`player.executing` 扩成 `{tick,total,pos}`（受刑者位置本来就在 `beginExecute` 的参数里，之前丢了），`CameraRig` 直读这一格：借用锁定式越肩构图钉住受刑者 + 距离压 `EXEC_DOLLY.distMul` + FOV 收 -7°——§5.4「45°→38°」在本作基准 50 上兑现的是**差值**，抄绝对值就是两条标尺各说一遍；`execPull` 缓入缓出，演出结束镜头自己退回去，不写第二份时长（与 `audio.muffle`「只有开关没有时长」同口径）。守卫 `tests/flow/camera-feedback.test.ts` 10 条：表行对账 ×2（§10 数字逐格 + 踏地数据声明的两样）、FOV ×2（消费+自复+graze 无脉冲反证、改表法 -5→45 带还原）、落帧 ×4（三事件同 tick 齐发 / 非落帧反证 / 未声明的招式安静 / 距离衰减）、推轨 ×2（构图+FOV+回退、改表法 -20→30 带还原）。**反向变异三刀**：摘 `shake()` 里的 FOV 挂接 ⇒ 恰红那 2 条；掐敌人落帧 vfx/worldShake 发射 ⇒ 恰红齐发 1 条（KI-016 发声腿照常绿——通道分家被证明）；冻结 `execPull` ⇒ 恰红推轨 2 条；全还原后 10/10。**validator 反向探针**：`worldShake:"quake"` ⇒ ERROR。**实机（5199 真 tick 步进 + 真 rig）**：8m 外真踏地（环外沿 4m ⇒ 构造性挥空）`sound/ring_dust/camera.shake` t=21 同 tick 齐发、`combat.hit` 于玩家 0 条、FOV 最低 49.085（-2° 吃距离衰减）自复 50；改表法 `heavy.fov=-5` ⇒ 45.076、还原 ⇒ 49.015；真 `beginExecute` ⇒ 43.0、90 tick 后 50。**一个差点记错的账**：live 侧改表第一次打给 49.015 没跟表——不是行为假绿，是 `?fresh=1` 页面上 vite 的模块图有 `?t=` 双实例，干净 URL import 到的是第二份 `SHAKE_TABLE`；从 `performance.getEntriesByType('resource')` 取活实例 URL 再打，45.076 才回来。**遗留**：§10「处决」行自身振幅 1.0°/8Hz/300ms 仍借 heavy/boss 列（比设计重），连同 `camera.shake` 无方向语义一起另立 **KI-053**；尘环 scale 1.6、推轨压距 0.4 这类"看起来对不对"照旧无量腿（KI-010 同因）。
- **KI-047：`weapons.json.atkBase` 死数据结案——底数只住帧表，顺手立了两道新门（2026-09-25）**。登记时的裁决就倾向①（删），阻塞只剩"schema.ts/validate-data.mjs 正被并行会话写"——Phase 6-B 落库（da92aa3）后拆栏。落地：`atkBase` 从 `WeaponData`、`weapons.json` 三行、验证器、种子脚本、`gate5` 的纯标尺对照里全部拔掉；`gate5.oneSwing` 的底数改从**生产同一处**取（`moveset:${weapon.movesetId}` 的 `l1.damage`——那条断言比的是同一把剑的加点方向，底数取哪记不改结论，但它从此量的是生产真走的通道）；`DamagePipeline` 顶行那句"weapon atkBase"的谎一并改掉（真话：帧表 damage 是唯一底数）。**删除的代价变成契约**：当初"武器带底数、架式带倍率"的分层里，两件事都落在了架式 ⇒ 同一 moveset 的两把武器永远同价——这在当前 1:1 数据下是巧合，现在写成了门：**① 武器↔moveset 一对一**（验证器 + 测试各一道，重复引用 ⇒ ERROR「新武器要带自己的架式表」）；**② WeaponData 字段白名单**（`WEAPON_FIELDS`，多余键一律 ERROR「无消费方的数据不许入表」——atkBase 这类僵尸字段想复活，进门就得先出示消费方）。守卫 3 条挂在 `tests/unit/movesets.test.ts`（白名单/一对一/l1 真的有底数，故意**不**新建文件：这是武器定价闸门的邻居）。**反向变异两探各自到位**：塞回 `atkBase:12` ⇒ validator ERROR + 测试红；把大剑的 `movesetId` 改成 `ms_sword` ⇒ validator 一对一 ERROR + 测试红；全还原后 8/8 绿。live 侧无新行为可量（纯删除 + 门禁），实机口径按 §6.3 记为"不适用"。全量 **52 files / 557 passed**。
- **KI-054：§8.2 里程碑表「一行承诺一条腿」——grant 入表，§5.3「失败」行第一次整句成立（2026-09-25）**。对账读出来的病：11 行里程碑只有 2 行战技槽真的有消费方，rank4「负重 +8」、rank5「弹反落空 −50ms」、rank12「处决 +5%」这些数字运行时一无所知；更深的同族谎是 §5.3「失败」行整句——`parryWhiffTicks` 是个只初始化、只倒数、从不被赋值的死字段。修法沿用 PENDING_FLAG_WRITERS 的先例：**数据必须自证有腿**——`milestones[].grant`（白名单 `loadFlat/parryWhiffMs/execMulPct`，加字段必须同批在 `Progression.derive` 接线）由 `derive` 按「到达 rank 才累加」吃进：`loadMax` +8、`parryWhiffMs` −50（经 `PlayerMods` 流到 `ThirdPersonController.beginParryWhiff`，27f + `msToTicks(-50)` = 24f）、`execMul` ×1.05；validator 门 = grant / 战技槽引用 / `PENDING_MILESTONE_GRANTS` 三选一（清单五条点名，只许变短）。落空生命周期两条入口：窗口自然走完（倒数到 0，controller）与被没弹着的攻击吃掉（`CombatManager.resolveAgainstPlayer`，赌注口径：落空那一击本身就落在后摇第一格，×`parry.whiffDmgMul`＝新必填格，卡 ≥1）；`onParrySuccess()` 撤账、后摇期间再按弹反被拒（那条门一直写着，从没关过任何人——现在关了）。倒数顺序挪了一次：后摇先于窗口倒数，否则表里的 27 会被自己当 tick 减成 26。**旧契约改账**：`ranged.test.ts` 两发弹反夹具原先在 2.6m 起按、靠「落空立刻重抬手」兜底——后摇把这扇门按设计关掉了，夹具改成一次到位的 1.4m（注释写明理由，不是把断言反过来一删了之）。守卫 12 条挂在 `tests/flow/milestone-grants.test.ts`（derive 三腿 / 改表法 loadFlat 与 parryWhiffMs 与 whiffDmgMul 各一轮 / 真实输入边沿的落空-锁格-解锁全程 / 真挨打与真弹中的分岔各一条）；validator 反向探针四条（无腿行 / 未知 grant 字段 / `whiffDmgMul:0.8` / 删格）全说红；代码变异「pending 不再上弦」红 7 条。KI-049 的裁决 ③ 同日结案（超载在设计自身的 50 kg 对 52 kg 面前就不可达，不造数据；闸门留在 `overload.test.ts` 并写明 grant 只抬高判据分母、不反转判据）。视口评审照旧 ENV 缺（§77/ENV-001）。全量 **53 files / 569 passed**。
- **KI-037①：乐章 IV 另两式入表并整链接通——定音回响（弹反窗 ×2 + 必挂破势）与无声协奏（7s 零噪音 + 伤害 +15%）（2026-09-25）**。§7.2 那一页的另外两格此前"未入表"的原因就是 §55 的规矩：消费方在别的子系统（弹反窗宽度、噪音判定、伤害汇总），没有腿的数据不许先进门。这一步四条腿同时落地。**定音回响 `mv_perfectingecho`**：出手把 `echoCharges: 1/2/2` 存进 `ThirdPersonController.echo`——再次出手是**换一批不是叠罗汉**（"下一次"不该被攒成货币）；弹反按下在**开窗那一格**花掉一格充能、按 `base.parry.activeTicks × echo.windowMul` 加宽（6f→12f=200ms；乘数住在式子上的 `echo` 块，与休止斩 `landing` 同类——各级同值就不抄三份进 levels）。弹中**必挂破势不写第二张破势表**：`EntityStats.addPoise(stats, poiseMax)` 走既有 R4 账（reactions.json，杂兵 1.8s/Boss 2.4s），`poiseImmune`（抬壳）依然挡得住——回响是弹壳的解法之一，不是免死金牌。回响窗落空**照花充能**（赌注在按下那一格已经付过），后摇与 §5.3 同一本账（KI-054 的 `parryWhiffPending` 生命周期一格不改地复用），窗一关 `parryEchoLive` 即翻篇。**无声协奏 `mv_tacetconcerto`**：出手生成限时 `tacet{ticksLeft:420,dmgBonus:0.15}`，零噪音**只有一个闸口**——`noise()` 直接返回 0，全部脚步/挥击/刀锋相交的 `sound.source` 出口本就从这一个函数走（KI-048 的冲击报警同源）；+15% 挂在 `strikeEnemy` 这条玩家→敌人的唯一伤害通道，且只在 `if (!replay)` 里——回声重演的是旧账，不是此刻的行动。**裁决**（§7.2 那两格没写，同休止斩冷却先例）：两式帧表 10/10-14/34 与 14/14-20/40、冷却 300/270/240 与 360/330/300 tick；无声协奏三级的时长与加成**不涨**——表没写成长，升级买的只是 CD，不为好看造 15→20%。 buffs 与 `followup` 同类不入档（respawn 清空）。**门禁三条新规矩**：`echo` 块与 `echoCharges` 互成（写了充能没乘数⇒ERROR，反之亦然）、`windowMul` 必须正整数——**小数窗的 `parryTicksLeft === 0` 永远关不上**，§5.3 与回响两本账会一起静默蒸发、`silenceDmgBonus` 必须有 `silenceTicks` 可挂靠（死数据判据）。守卫 9 条在 `tests/flow/echo-tacet.test.ts`（运行时==表 / 加宽窗全程+下一窗回原价 / 真升级到 L2 后两扇加宽窗 / 必挂破势 A/B（en_tympanus 架势 90，普通弹反的 25 压不垮它——差值恰好就是回响那一笔）/ 落空照花充能 / tacet 时长==表值 / 窗内 `sound.source` 全零前后正常 / 两世界伤害 `round(基准×1.15)` 恰好相等 / 冷却拒再出手）。**反向实测七探全红且全数还原**：门禁三探（删 `echo` 块⇒充能无乘数 ERROR、`windowMul:2.5`⇒整数门 ERROR、删 `silenceTicks`⇒加成无时段 ERROR）；消费方四刀（不存充能 / 摘加伤行 / `noise()` 不吞 / 摘破势支）各自钉红对应用例。视口评审照旧 ENV 缺（§77/ENV-001）。全量 **54 files / 578 passed**。
- **KI-053①：§10「处决」行第一次有自己的振幅——execute 震镜档独立于 heavy/boss，§64 触感同向不造新尺子（2026-09-25）**。KI-051 立起推轨那天起，处决那记命中的 `shakeKey` 还借着 heavy(2.0°)/boss(4.0°) 列，比设计的 1.0° 重一倍到三倍。接线三处：`SHAKE_TABLE.execute`（1.0°/8Hz/300ms，逐格照 §10）、`landExecute` 出口改报 `execute`、`Haptics` 加同名档。**两条裁决**：① **Boss 处决走同一行**——§10 的 4° 那行写的是"阶段转换"这个**情境**，不是"对方血条长"这个**身份**；跳阶/入场两个世界事件出口照旧走 boss 列，与 KI-051 的距离衰减口径分家（登记时那句"和 §64 一起裁"随实现一并裁了）。② 设计表给的是震镜的数，**震动没有自己的表值** ⇒ §64 不发明新尺子：execute 档只在既有档位之间取「轻于 heavy、单发长于 graze」那一格（strong 0.4 落在 normal 0.3 与 hurt 0.5 之间、120ms）。两表同向的一句话：**处决的分量由推轨（KI-051）与消音+专属音色（KI-003）扛，震镜与手柄只标那一刀落下**——同 KI-017③「一记只许一个主人」。附加格没有 FOV 脉冲（表写「推轨另控」），这条也有腿：消费腿在 200ms 窗内**逐 tick** 采样。守卫 6 条：表行对账 + 端到端消费（`camera-feedback` +2）、真杂兵处决与真 Boss 处决的发射方各 1（挂在 `execute-audio`/`boss` 既有用例上）、触感档序 1。**反向实测四刀**：发射方改回借列 ⇒ 恰红 2；删 Haptics execute 行 ⇒ 恰红 1；amp 1.0→2.0 ⇒ 恰红 2；偷挂 `fov:-3/fovMs:200` ⇒ 恰红 2——**最后一刀当场钉出一处漏**：消费腿原先在脉冲走完之后才看 FOV，探针前它是假绿候选；改成窗内逐 tick 才咬住。四刀全数还原复验。**一个操作教训记在这里**：探针还原用了 `git checkout -- 文件`，它把同文件里未提交的正式改动一并抹了（本次靠重写恢复）——**在制品文件内禁用 checkout 还原**，探针一律 Edit 原位反转或 .bak 覆盖。② 的方向语义（背后/面前）与闷音豁免仍留 Phase 7 电影机批次（判据要像素，KI-010 同因）。全量 **54 files / 581 passed**。
- **KI-005：分包真正的根因是分组表挂错了层——vite 5.4 静默吞掉 `build.manualChunks`（2026-09-25）**。这条债登记时把病因写成"rollup 对 CJS 依赖的分包限制"，两句都不成立：three 是 ESM，而 rollup 的 `manualChunks` 一向好用。实测归因走的是**产物字节对账**：往 `build.manualChunks` 打三种分组表，`dist/assets/index-*.js` 的 hash 逐字节不变 ⇒ 那份配置根本没被读；grep vite 的 dist，`manualChunks` 这个字符串在 `build` 段只剩警告文案——vite 5.4 的 `build` 没有这一项，唯一落点是 `build.rollupOptions.output.manualChunks`，且本机连**对象形式**也不吃（照样逐字节不变），只有函数形式工作。现分六片：three 531.50 / index 104.02 / data 69.93 / render 54.70 / ui 47.57 / audio 14.19 kB；核心玩法（combat/ai/player/core）刻意留在入口——它们互引的边最多，切开只加跨块开销不减总量。**诚实账**：总量仍是 821 kB，分包买到的是缓存粒度（vendor/数据/UI 不随玩法代码一起失效）与并行下载，不是"首包变小"。残留的 >500 警告只剩 three 这一片**原子 vendor**（`three.module` 只是 `three.core` 的再导出，切不动），以 `chunkSizeWarningLimit: 550` 放行；应用侧各片 ≤104 kB，自家代码真涨上去警告照样响。**实机**（preview 4173 + 隐藏标签页老配方）：console 0 error、六片全 200、`tickFrame(1/60)` 步进 30 tick 无异常、`__caesura` 钩子全量在线；期间一次 `tickFrame()` 无参调用把 HUD `vign` 永久毒成 NaN（`Math.max(0, NaN)=NaN` 单调不回零，`addColorStop 'rgba(108,26,20,NaN)'` 抛）——探针手法事故、非分包回归，刷新即绿，但它顺手说明了一件事：**步进配方永远要传有限 `realDelta`**。首包观感（多久能玩上）照旧是 ENV 缺腿（KI-010 同因）。测试面不动，全量 **54 files / 581 passed**。
- **KI-030①②③：掉落第一次认识「站在哪、戴着什么」——区域上修与丰谐共用一根权重杠杆，pity 口径当场裁死（2026-09-25）**。§9.4 那句「深窖 ×1.5 高段权」与 §6.2 的「丰谐」幸运护符落了同一根腿：`LootDirector.tiltBand` 对 gearBand 高段档位的权重做乘法（区域的 `atOrAbove` 声明门槛；纯幸运时门槛与 §9.4 同源取 `pity.floorRarity`——「高段」只许有一个数字主人），**歪权重一格随机数都不追加**：`Rng.weighted` 每 roll 恰好消耗一个 draw、与权重取值无关 ⇒ 种子重放的轨道不改线（§10 的可复现 QA 因此天然不破，这也是测试敢写**逐点包含**而不是统计容差的原因）。区域侧新数据形 `RegionData.loot.rarityBoost {atOrAbove, mul}`（rg_earless_deeps 写 rare/1.5），`main.ts` 每次区域切换 `rpg.loot.setRegion(id)`——**区域 id 不入掉落档**（它是世界的读数不是掉落的账，读档后重新走一遍位置判定即可）；装备侧 `EquipMods.lootLuck`（刻意不进 `PlayerMods`：它不是战斗乘数），「丰谐 `af_bountiful`」**定值区间 [0.15,0.15]**（署名造物不掷区间——掷 ±10% 会把"这枚徽记承诺的数"变成每次重铸都不同的数，§6.2），唯一宿主 `seal_bountiful`（`gear.slot:'sealB'` ⇒ B 槽专属由数据路由，Runtime 对非 'seal' 槽直接 `eq.equip`，不新增一行判别代码）；幸运**每次掷骰现查**（闭包读 `eq.totals`，卸下那格起不再加值——快照会做出"脱了护符运气还在"的谎）。`rollAffixes` 的 slots 过滤（`a.slots.includes(item.gear.slot)`）是防泄漏的那道闸：幸运词缀永远掷不到别的件上。validator 四条新门 + 一次连带对账：`atOrAbove` 必须真存在于 rarity 表（拼错档名=静默无修，比崩更难查）、`mul ≥ 1`（上修不是下修）、`lootLuck` 进 `AFFIX_STATS` 白名单、`sealB` 进 `GEAR_SLOTS`（**sealA 刻意不加**：现在没有任何件声明它，§55 无消费方不落数据——它作为槽位存在、作为词缀落点不存在）。反向四探各恰红 1（slot 探针当场红 2：未知槽位 + 「af_bountiful 只能落 sealB」的连带对账，第二条门是它顺手救的场），全数还原 sha 复验。守卫 8 条 `tests/flow/loot-rules.test.ts`（量具 `loot_chest_t2`：必中单 gear roll、band 40/40/20 ⇒ 上修后 A 的高段索引集 ⊆ B 的高段索引集是**确定性命题**：低段归一化占比单调降、每 roll 消耗同数——含**写反方向被抓**的自新：初版把占优方向写成 B⊆A，3 条当场红，这本身就是量具自检）；改表法两腿（mul→3 再涨、atOrAbove→epic 落 band 外逐格回落=门槛真跟着表）＋负对照（无修区域与 null 逐件相等）＋中途卸下后半段逐格相等（现查不快照的铁证）＋泄漏守卫（全注册表逐件 60 次掷词缀）。**③ 的裁决**：`LootRoll.pity=10` 与 §9.2「连续 3 不出精良→第 4 必精良」答的是两个问题——前者是**命中轴**（这条 roll 掉不掉，`loot-pity.test.ts` 钉死"不许动稀有度"），后者是**稀有度阶梯**，其合法承载体一直是 §9.4 全局大保底（每第 10 件 ≥rare、跨表累计）。改 pity=3 只会收紧频率、照样给不出"精良"；做"每容器阶梯"要第二个稀有度计数器，与全局保底重复还把"多开低档箱重置阶梯"的漏洞放回来。**维持 10 不动**，§9.2 措辞差留给需求文档持有者同步（本仓不擅改 progression.md）；出售/商店出口拆出单立 KI-055（`ItemData.value` 那张"写了没人读"的账随之有了名字）。实机（127.0.0.1:5199 隐藏标签页）：800 批同轨 A/B 平原 0.653 对深窖 0.728（理论 0.64/0.72）、600 批对照戴徽 0.623→0.697（理论 +0.047，同轨非等种子的正常抖动）、`equip` 回执 `slot:'sealB'`、`totals().lootLuck` 0.15→卸下归 0、console 0 error；**护符图标长什么样、深窖掉落"变好了"的观感**仍是视口/手感评审缺（KI-010 同因）。全量 **58 files / 609 passed**。
- **KI-054②：`ms_overdrive` 从"重复承诺"裁成"真腿"——rank14 的过载上限 +2 加在基数上、cap 仍是天花板（2026-09-25）**。§8.2 那行「过载上限 10→12」与派生公式 `10+floor(音色/10)` 是两个主人抢同一格：公式按音色发上限，行却把它按 rank 再喊一遍，KI-054 第一批登记时因此挂在 pending 里"待删行或改 label"。这次的裁决是第三条路：**给行一条真腿，但腿加在公式的基数上**——`grant.overdriveFlat = 2`，`derive` 里 `Math.min(cap, base + grantSum + floor(ton/div))`，cap（15）不动，所以过载上限仍然只有 derive 这一个主人，rank14 只是抬天花板两格；调律者学徒（ton=5，整除向下取整）跨过 rank14 时面板恰好读到 12，label 那句第一次机器成立（不是"抄进代码"，是式子在表值下真的算出它）。`GRANT_FIELDS` 加 `overdriveFlat`、`PENDING_MILESTONE_GRANTS` 收缩 5→4（这条清单按规矩只能变短）。守卫 2 条挂在 `milestone-grants.test.ts`：rank13/14 同属性对照 + 音色顶格撞 cap、改表法 2→3 **走真 `applyRpg` 到 `EntityStats.overdriveMax`**（derive 有值≠挂上实体，这条量到管线末端）。**反向三探**：摘 grant 整行 ⇒ validator 恰红 1（`milestones[8] 里程碑无机制腿`——此刻它已不在 pending 豁免里，红得其所）；字段名笔误 `overdriveFlatX` ⇒ 恰红"不认的 grant 字段"（加字段必须同时在 derive 接线的门）；摘 `+ grantSum('overdriveFlat')` ⇒ 恰红那 2 条。三探全数还原复验。全量 **54 files / 583 passed**。
- **KI-031③：出身被动第一次有数据形状——`OriginPassive` + 期望值取整，§2.2 的「+10%」变成能被量出来的 10%（2026-09-25）**。§2.2 五句出身签名里唯一带数字的是「哑带拾晶人：拾取音色石 +10%」，此前它只在设计文档里喊，运行时无人接。**形状**：`OriginData.passive?: { kind:'lootStackBonus', itemId, mul, label }`，kind 白名单只有这一种——**其余四签名（全能教学/架势压制/距离控制/法系开局）的表达就是六维与初始装备本身，不给它们硬造数字**（测试直接断言那四行 `passive === undefined`）。**取整口径是本步的主角**：`Math.round(3×1.1)=3`——小数量掉落里 "+10%" 会被悄悄抹成 "+0%"，所以不吃 `Math.round`，改**期望值取整**：`floor(n×mul)` 是必发的，零头那一点掷给**已入档的种子 RNG**（§10：可复现要求它走同一颗骰子，不另起炉灶）；两条不变量撑着整套测试——**整数乘数不掷数**（`v === whole` 直接返回）与**不吃数的件不掷数**（itemId 不匹配先回），对照腿的 RNG 序列因此同轨，等式敢写死。**消费者** `LootDirector.withOriginPassive`：只挂在 item 分支的掷完数量之后，gear/xp 不沾。**validator 双向对账**：形状门住在 `validateProgression`（kind 白名单/itemId 必填/`mul ≥ 1`/label 必填——「被动是给玩家看的一句话，卡面要显示它」），**延迟对账**排在 `validateLoot` 之后（itemId 既要在 items.json 里，也要真出现在某个掉落 roll——「被动在给不存在的产出加成」是死数据门；直接读 `data['loot.json']`，flag 对账块同款手法）。**卡面**：`titleCards()` 补 `passive: string | null`（label 现读表，无被动是 null 不是编一句），拾晶人卡多一行「被动 · 拾取音色石 +10%」且全屏唯一。守卫 **5 条**（`tests/flow/origin-passive.test.ts`：同种子 80 批 A/B 严格多且比值贴 1.1、改表法 mul=2.0 ⇒ 双倍**精确相等**、铃腔表无音色石 ⇒ 两世界逐枚相等（负控：连 RNG 消耗都不许多）、快照往返后被动跟着人走且 30 批逐枚复现、表字段对账 + 四出身无被动；另给 `restring.test.ts` 的卡面对账用例补一条 passive 断言——用例数不变、断言数变）。**反向四探（实测）**：①摘消费者（首行 `return n`）⇒ 该文件恰红 2——**第一次跑出了 3 红**，追下去发现第三条红不是消费者的账：测试②改表 mutation 断言致死、还原行没执行、污染了测试⑤，这是探针抓到的**测试卫生真缺陷**（当场补 try/finally，与④同款），修后复探恰好 2；②kind 笔误 ⇒ validator 恰红 1（`不认的被动类型`）；③itemId 指向不存在的件 ⇒ 恰红 2（悬空引用 + 没有任何掉落表掉它——两条腿各报各的）；④label 清空 ⇒ 恰红 1。四探全数还原复验（0 ERROR / 5 WARN 回到基线）。**实机（127.0.0.1:5199 隐藏标签页）**：拾晶人卡结构断言 `.ps`=「被动 · 拾取音色石 +10%」、tuner 卡无此行；真 click 选卡开赛后 `restore` 回未调音态、同种子 100 批 `loot_gather_timbite` A/B：拾晶人 592 vs 学徒 535，比值 **1.107**——+10% 在真实运行时里是活的。**视口观感照旧 ENV 缺（KI-010 同因）**。全量 **57 files / 601 passed**。
- **KI-031②：定弦第一次成为开场流程——boot 门控在 TitleScreen 上，换出身走 `restring` 且有「开演之前」守卫（2026-09-25）**。§2.2 把开局选人写成叙事动作「定弦」，但此前五个出身只有 `?origin=` 这条测试后门；这一步把选择端立起来。**门控形状**：`main.ts` 尾部不再直接 `loop.start()`，而是先 `await savePrimary.get('autosave')` 探一次**原始键**（绝不 `saves.load`——那会把存档状态应用到还没开演的页面上，探测和载入必须是两件事），有档无档都构造 `TitleScreen`（新文件 `src/ui/TitleScreen.ts`）；`bootWithSave` 与冷启动合成同一个 `startRun(loadSave: boolean)`，标题的任一出口（新开/续演）先 `dispose()` 自己再走它。**纯函数卡面** `titleCards()`：五张出身卡（名/一句话/六维初始值/**出身武器中文名**）全部从 `progression.json` + registry 现取，零硬编码名单——武器中文名要从**装备件**反查（`allGearItems().find(it => it.gear?.weaponId === o.weaponId)?.displayName`），因为 weapons.json 根本不带 displayName，这是本步顺手记下的一条数据形状；改表法实测（改名哑带拾晶人→标题跟着变→还原）。**换弦原语** `RpgRuntime.restring(originId)`：构造器里出身装备的 uid 记入 `originGearUids`，restring 按 uid 收回、清空装备槽、按新出身重发——进度守卫写在最前面（`rank > 1 || xp > 0` 即抛「定弦只发生在开演之前」），因为中途改弦的合法主人是 §8.3 洗点，这层不抢；未知出身不另写错误文案，让 `new Progression()` 按既有措辞炸。掉落 RNG 种子在换弦中原封（出身决定握什么，不重洗命运）。**headless 通道原样**：`?fresh=1` 跳过标题直接 `startRun(false)`、按 `?origin=` boot——KI-017/021/051 攒下的实机探针配方一条不废。守卫 **6 条**（`tests/flow/restring.test.ts`：调律→鼓手整张脸翻转含武器件与种子、新旧 uid 不相交且槽位可解析、鼓手/唱诗班→调律者往返 `mods()` 深相等（`Rng` 默认种子恒定所以词缀重掷可复现，这条才敢写）、进度守卫+未知出身逐字、`titleCards()` 与表逐行对账、改表法）。**反向两探（本步重放实测）**：摘 `restring` 里 `inv.removeGear` 那腿（出身装不收回）⇒ restring 文件恰红 3——整张脸翻面、uid 不相交、往返同型三条各红，"摘"这条腿是承重墙不是过场；把进度守卫改成恒假 ⇒ 恰红 1（守卫用例的三条 expect 同住一个 `it`，红数不翻倍，判据在错误文案里）；两探全数还原复验。**实机（127.0.0.1:5199 隐藏标签页）四条腿全走真事件**：标题打开且 `time.tick` 停在 0（boot 真被门挡住）→ 真 click 鼓手卡 ⇒ `origin_drummer` + `wp_fortissimo_greatsword` + 148 血、步进 tick 前进 → 刷新后 ←×2+Enter ⇒ `origin_player` + 引针枪 → `saveNow` 后刷新出「续」条目、↓+Enter 读回 tuner 档；`?fresh=1` 无标题直落。**本步还撞出一个环境事实**：`localhost:5199` 现在被另一台应用的 vite（`0.0.0.0`/`[::]`）抢走，本项目的 dev server 只在 `127.0.0.1:5199` 应答——实机配方从此必须写显式 IPv4，`localhost` 会串台到隔壁游戏。**视口观感（卡面好不好看）照旧 ENV 缺（KI-010 同因）**。全量 **56 files / 596 passed**。
- **KI-031①：HUD 第一次成为里程碑的机制腿——拍点涟漪与暴击飘字金环，validator 因此有了第四种验收形式（2026-09-25）**。§8.2 的 `ms_beat_ripple`（rank3「节拍提示增强」）与 `ms_crit_ring`（rank8「暴击反馈加泛音环」）此前挂在 KI-054 的 pending 清单里，理由是"UI 承载待随 KI-031 批"——它们的承诺是**表现**，`Progression.derive` 那条数值层通道天然摸不到，所以腿必须长在 HUD 上。**承载三件**：① `Hud.milestoneRank(id)` 对里程碑表**按 id 现查现用**（不是构造期快照）——改表法与"删行＝拔腿"因此在运行时立即生效，测试两条都钉了；② `ms_beat_ripple`＝每拍 `rhythm.beat` 在 rank≥表值时往体力环心记一圈涟漪（0.9s 寿命自己退场，不留常驻谎言）；③ `ms_crit_ring`＝暴击伤害飘字：`combat.hit` 事件补 `crit?: boolean`，**只有 `strikeEnemy` 发射端写它**（`landExecute` 那两格不写——处决数字的账是另一条管线的事，Hud 按 falsy 天然排除），Hud 只收玩家→敌人的暴击 hit（封顶 8 条、1.1s 寿命），世界坐标锚定靠 `main.ts` 新接的 `hud.project`（`Vector3.project`，NDC 外/相机背后返回 null——不画但账照记，这正是隐藏标签页 0×0 视口下的现实形状），rank≥8 时数字背后扩三圈金色泛音环。**validator 第四验收形式** `UI_BOUND_MILESTONES`（id→承载体说明）：登记的理由写进注释——derive 看不见表现层，这一形式的证人不是字段白名单而是承载测试文件；`PENDING_MILESTONE_GRANTS` 由此 4→2（只剩 ms_deepcellar/ms_identity，清单只许变短，这次变短了）。守卫 **6+1 条**：`tests/unit/hud-milestones.test.ts`（rank 门正反例、改表 99/删行/还原三连、飘字三负例记账、金环 rank7/8 对照、无投影账照记、表行对账）＋ `tests/flow/combat.test.ts` crit 腿（两世界 A/B：critRate 0 ⇒ 每格**明确的 false**、critRate 1 ⇒ rand<1 恒真每格 true——字段真跟着判定走，不是发射端顺手抄常量）。**反向两探**：摘 `crit: dmg.crit` ⇒ flow 恰红 1；`ms_crit_ring` 从 UI 清单摘出 ⇒ validator 恰红 1（`milestones[5]: 里程碑无机制腿`）；全数还原复验。**两条测试学**：其一，**跨帧累计的笔画计数会撒谎**——金环起初按 30 帧的 stroke 总数断言，同一圈每帧重画被数成 ~90，改成**单帧取样**（起环帧只有最内圈够格，恰为 1）；其二，取样器必须被正例钉住非空转——测试里 `GOLD` 前缀把 `rgba(201,180,88` 抄成带空格的 `201, 180`，`startsWith` 永远失配，rank7 那条"零金环"红了半天其实一直是假绿候选，是 rank8=1 的正例把它救回来的。实机（5199 隐藏标签页）：`hud.project` 已接、rank2 涟漪 0 圈/rank3 起 1 圈、暴击飘字进账且非暴击被排除、console 0 error；**"环好不好看"这层视口评审仍是 ENV 缺（KI-010 同因），本条只声称承载体在、不声称像素成立**。全量 **55 files / 590 passed**。
- **KI-073：「先记账后接线」那三份名单从此要能销——挂着理由的假账被机器抓出来（2026-09-27）**。老规则只管"没腿 ⇒ 必须记账"，管不到反面：**腿或写方出现了、账还挂着**。实测活例：`PENDING_MILESTONE_GRANTS.ms_deepcellar` 写着「无腿可接」，而表里那一行早就有 `grant.corruptionStayPct: 35`。判据抽进 `scripts/ledger-rules.mjs`（名单本体也搬进去，校验器与测试读同一份；`tests/unit/ledger-rules.test.ts` 8 条），两侧各一条：pending 里的 id 必须还在表里、且此刻真的没有腿（`hasMilestoneLeg` = 非空 grant 或被战技槽引用）；旗标名单里的条目一旦出现写方即 ERROR。两份名单**不对称是故意的**：pending 承诺"没有腿"（一有腿就被证伪），承载体名单承诺"腿在表现层"（与字段腿并存不为假）。反向实测 9 趟（6 趟校验器 + 2 趟单元测试自己的绿/红证人 + 1 趟对照，预言 9/9；分母取校验器那句「总计：N ERROR」——按行数 "ERROR" 这个词会数出 25 而工具自己报 8）。详见 KNOWN_ISSUES 的 KI-073 行。
- **KI-074：校验器顶上那十几张「与 schema.ts 对齐」的名单不再手抄——读一次声明，逐张对账（2026-09-27）**。今天入表 10 张（每张都先量过它读得到：`AttrKey`/`SlotKey`×2/`ItemKind`/`MilestoneGrant`/`MovementFrame`/`MovementLevel`/`PropRef.kind`/`InteractableRef.kind`/`ProjectileSpec.kind`），判据在 `scripts/schema-vocab.mjs`，测试在 `tests/unit/schema-vocab.test.ts`。三件事值得单独记：①**子集也要有据**——`GEAR_SLOTS` 刻意少抄 `sealA`，所以豁免必须带理由，理由过期当天报「这条豁免该销了」（KI-073 那条纪律在这里同族复用）；②**读不到声明 ⇒ ERROR，不静默跳过**，`REACTIONS` 因此干脆不入表（它的载体不是名字相近的 `ReactionTier`，硬配只会造出一条说谎的门）；③这一批真正的收获是**两枚被抓出来的哑门**：对账第一次上线后四趟植入实测全不咬，根因是报告那段循环只遍历 11 份 JSON，跨文件检查挂在 `schema.ts` 段名下 ⇒ 既不打印也不计数（修的是循环：段 = `FILES ∪ 报过事的名字`，并补一条源码判据钉住它）；另一枚是"注释剥一半"——先按`/**`截块把声明自己的注释也截掉（`MilestoneGrant` 两个字段当场消失、门一开假报五条），改成整片剥之后又漏了行尾注释（`// 注释里有 'y'` 被读成成员，单元测试抓到）。**"读声明"这件事做一半比不做更坏**。详见 KNOWN_ISSUES 的 KI-074 行。
- **KI-076：词表对账扩到 `schema.ts` 之外的载体——五张"主人住在别处"的名单入表，抽取器为形状买单（2026-09-28）**。KI-074 行末「没做①」那一格今天兑现：`VOCAB_PAIRS` 12→17，每张带 `from`（主人是哪个文件），报告的段名跟着改成 `e.from`（C1 实测一条 ERROR 打印并计在 `src/player/CameraRig.ts` 名下——KI-074 修的那段循环第一次为非 JSON 文件派上用场）。新增四种抽取形状各对应一张真名单：`refFieldUnion`（`Hitbox` 那条 `= HitboxCone | HitboxSphere | HitboxRing` 引用链）、`objectKeys`（`SHAKE_TABLE` 住在 `player/CameraRig.ts`）、`arrayLiterals`（`STATUS_IDS` 的主人已搬到 `core/EventBus.ts`）、`callArgLiterals`（`passiveValue('…')` 的字面量调用普查在 `rpg/Settlement.ts`——§55"一条被动 = 一个消费者"第一次有机器的读法，代价是它对变量传参是瞎的，这句写在名单的 `hint` 里）。**豁免从此有两种，承诺不同**：`allowMissing`（少抄某几个、具名）与 `subset`（这张表**本来就是**主人的子集：20 个输入动作里战技槽只占两个 ⇒ 少抄不报、多抄照报），`ActionName` 用后者；两者同时声明 = 自我矛盾，红一条。两枚"抽取不认识形状"的假空是**门先红、我再去追**：`interface` 块按下一条声明截断 ⇒ `EquipMods` 把紧跟的 `EMPTY_MODS` 初始化行吞成字段（`defense/execMul/bellBonus` 读两次），改成按配对 `}` 收口；`fieldUnion` 不认**单行接口** ⇒ `Hitbox` 真跑第一趟报"门在空转"（读不到 ≠ 没有漂移）。同一批把 `STATUS_IDS` 那三张表（名册 / `STATUS_FIELDS` / `STATUS_SPECS`）的对账从校验器的裸循环搬进 `ledger-rules.mjs > statusLedgerErrors`——**三表对不上以前不是"少查一项"，是整个校验器以 TypeError 收场、后面九份 JSON 一并没人看**（C7b 实测连一个段头都没打印；C7c 留 `??` 兜底 ⇒ 恰 5 条可读 ERROR）。反向实测 8 趟，两条预言落空都追到真因而非糊过去（C2 少算一条自家旧门；C7 押错触发条件：崩溃要的是"数据里有这一行而白名单没有"，不是"名册多一态"）。**门禁**：`tsc --noEmit` 0 错、`npm run build` 干净、`validate-data` **0 ERROR / 4 WARN**、全量 **91 个测试文件 / 1133 条用例全绿**（并行会话那 8 条外来红与"16 红"归属同批过期）。第五道门在本平面**红 5 格**（总行覆盖 84.98% < 地板 87.36%，`quest`/`world`/`ui`/`tools` 各低于自己地板）——五格全在 `src/`，而本批 diff 一行 `src/` 都没动，量具与地板文件此刻都在并行会话的写入面上 ⇒ 按 KI-063「红跑不作数」不落账。详见 KNOWN_ISSUES 的 KI-076 行。
- **Phase 6-B3：值域型世界状态 `STATE.*` 第一次有了机器形状——`WorldStates.ts` + `states.json`，铃姨步 4《该不该敲响》与休垒广场组换因此落地（2026-09-27）**。§9 那张 `STATE.BELLS.FOURTH_DUMB` 表从立项起就只是一行设计：旗标是两格（立/没立），而"第四口钟现在是敲响了还是被封了"要的是**一格枚举**，两者不能互相冒充。落法是新表 `src/data/json/states.json`（`key/values/default/note`，校验器 `validateStates()` 卡 key 必须 `state.*`、`values ≥ 2` 不重复、`default ∈ values`）与新模块 `src/quest/WorldStates.ts`——**全仓唯一的写入口是 `set()`**：key 未登记或 value 越域一律拒写并 `log` warn，写成功才广播新总线事件 `world.state {key,value}`；构造时自己也订阅该事件（外部直接 emit 也能进缓存，但那条路不校验，属于测试专用）。四个读方各按自己的记法接：对话条件 `conditionPass` 的 `c.state`（`eq/in/notIn`，与旗标那三种谓词并列成"五种"）、对话效果 `effects.setState`（唯一写方）、任务步 `advanceOn.state {key, in}`（`Quests` 订阅 `world.state`，与旗标顺推共用同一条 `push()` 收束逻辑，只是末步收束条件换了来源）、交互物 `requiresState {key,value}`。**一条语义裁决值得单独记**：`requiresFlag` 说的是"这道门开着吗"，而 `requiresState` 说的是"**这儿现在有没有它**"——所以它是"不成立时该陈设不在场"，落成 `Interactables.nearby()` 过滤 + `stateOf='locked'` + `activate()` 闸门 + `lockText()` state 分支 + `InteractableGreybox` 不画不成立的变体；旗标仍然只管"成色"。闸门由组合根注入（`Interactables` 第 4 参 / `Greybox` 第 5 参），世界层不 import quest 层，**缺省一律视作锁住**——没接读方的数据宁可不开也不放行。存档 `SAVE_VERSION` 11（`migrateV10toV11` 显式写 `states: {}`：老档不反推结局），`Snapshot.states` 必填、`SaveWorld.states?` 可选。校验器这一批加了**值域的双向对账**（与旗标那三条同一族）：读了没人写 = 那一格永远停在 default、写了没人读 = 死数据、登记了整张表没人碰 = 死表，读写名册从三处收集（对话条件/效果、任务步 advanceOn、交互物 requiresState）。**内容侧**：`q_bells` 第 8 步 `BELLS.STEP4_DECIDE`（`advanceOn.state in [RUNG,MELTED,SEALED]`）、`DLG_BELLTONGUE.fallbackNode` 从 `n5` 改指新节点 `n13`（三选一，`quest in [STEP4_DECIDE]` + `state eq INTACT` 双条件），`n13.next → n14/n15/n16` 各按自己那一格 `state eq` 复访，四条都不成立时顺着 `next` 一路退回原通用复访 `n5`——**fallback 链是靠 `enter()` 的条件跳转串起来的，所以 n13 必须带 `next`**（第一版漏了它，`enter` 走到头返回 null，整棵对话树当场开不了口，是 flow 测试抓出来的）。休垒广场三处陈设组换（`rg_resthold` 六条 `requiresState` 变体：钟架四态、跪地人影 RUNG、钟铜残块 MELTED）。**守卫**：`tests/flow/bells.test.ts` 新增 1 条（走完整链到末步 → 复访撞上 n13 三选一 → 选"敲响" ⇒ `state=RUNG`、任务收束、`nearby` 只剩 `st_plaza_bell_rung`、再复访走 `n14`），并把原来两条"旗标一立就收束"的断言按新口径改写（末步由值域收束，旗标只推到末步）；`tests/unit/dialogue.test.ts` 任务状态机那条改成三种推进来源（旗标顺推 → 末步由 `world.state` 广播收束，中途 `advance()` 恒 false）；`tests/flow/debug-panels.test.ts` 的 `1/8`、末步 `advanceOn` 无旗标只有 state、面板 `states` 行；`tests/unit/slots.test.ts` 那条"改坏主键位"的坏位改成挑 `playSec` 的**数位**（改结构符号会先撞 `parse` 而不是 `crc`——存档体积一变，`body.length - 30` 那种按尾部偏移挑坏位的写法就从 crc 探针变成 parse 探针）。**如实记账的三条**：①休垒广场的**NPC 行为**组换今天由对话条件承担（n14/15/16 三句复访 + `state eq`），narrative §9 那句"NPC 行为整体换组"的**场景物件**那一半才是本批落的，行为那一半等值域扩到更多 NPC 才有意义；②覆盖率地板按 KI-063「红跑不作数」**没动**，`WorldStates.ts` 落地后下一趟要 `--bless`；③`state.corvin.schism` 那一格是并行会话同批写进 `states.json` 的，本条只认领读写方与对账规则这一侧。
- **KI-055①：音色石经济第一次有出口——卖装只认件底数、买清单只许消耗品，三条红线全部住 validator（2026-09-25）**。§6 那张"获取 → 消耗 → 沉没"的环此前**只有进没有出**：石与残晶只能被花掉（强化/洗点），囤在包里换不回任何东西，而 `ItemData.value` 是一栏写了没人读的数（`PENDING_FLAG_WRITERS` 同族的账）。这一步落三件：`shop.json`（`sell.mul` + `stock[]`）、`rpg/Shop.ts`（`sellPrice`/`sellGear`/`buy`）、`RpgRuntime.sell(uid)`/`.buy(entryId)`，UI 挂在调音桩第五页。**两条腿刻意不对称**：卖只认装备**实例**（uid 才是卖家，价 = 件底数 × `mul`），**强化等级一律不看**——若 +5 卖得更贵，强化就从沉没成本变成可回收投资，回收率一过 1 就是官方印钞机；买只许 `consumable` 且**不限购**，不限购就没有库存字段、没有补货计时器、也就没有第三份要入档的账，**反通胀靠价差不靠配额**（买回来的消耗品不是装备 ⇒ `sellPrice` 恒给 0，"买→卖"这一圈的回收率与 `mul` 取值无关，这是结构性的不是数出来的）。卖装复用分解那条老防线：**先把身上那件脱下来**，否则槽位指向一个已经不存在的 uid（探针实测：摘掉这一腿恰红 1，说明它有名字不是过场）。§6.3 的三条红线全做成机器形状，五探各恰红 1：清单放素材 / `mul ≥ 1` / 悬空 item id / `price = 0` / 装备件漏写 `value`（最后这条是新门——缺了它就是一件"卖不出钱"的装备，而面板会静默显示 0 石）。消费者五刀：卖价写死 ×1 ⇒ 红 3、摘余额判据 ⇒ 红 1、摘堆叠判据 ⇒ 红 1、卖装不脱 ⇒ 红 1、交易页不渲染 ⇒ 红 2，全部 node .bak + sha 还原复验（**探针脚本自己交了一个学费**：这批文件是 CRLF，锚点里的 `\n` 匹配不上就报"锚点没找到"——那是**假信号**，突变根本没发生，`eol()` 归一化之后才有读数；另一半是 vitest 的汇总行带 ANSI，`\d+ failed` 必须先剥色再匹配）。守卫 11 条 `tests/flow/shop.test.ts` + 面板 2 条：18 件装备**逐件**对账 `sellPrice === round(value×mul)`、卖价与等级无关而分解 +10%/级（同一个 `it_choir_hood` 的两种未来在这里分开写）、钱不够/带满/无此 id 三种失败路径**一分不扣**、改表法双路 try/finally。实机（127.0.0.1:5199 隐藏标签页，真 DOM `button.click()`）：卖出身剑 +30 石、`eq.slots.weapon` g5→null、`mods().weaponId`→null、gears 5→4；买 20/30 两档各自精确扣款；灌满 `stack=20` 后按钮 `disabled` 且点击 0 变化。**两条诚实账**：其一，§6.1 那行「出售战利品（残骸→石）5-40/次」说的是**素材**侧，本步刻意不开（多一条与强化抢材料的通道，且 5-40 与装备档价×50% 不是同一把尺子）；其二，实测 18 件装备**全部**卖价高于分解返还的石（最狠的是 `ar_veilbell_helm` 75 对 26、`seal_bountiful` 105 对 45），所以 §6.3 括号里"鼓励分解"只在**残晶**那一侧成立——而残晶不可购 ⇒ 它在表里没有石的价格 ⇒ 不替它编汇率，压 `mul` 还是接受"卖换钱、拆换料"的分工留给数值裁决。商人一张脸（`Interactables`）与收支 playtest 记在 KI-055②。全量 **59 files / 622 passed**。
- **KI-052①：§8 的分级反应第一次落在敌人身上——三档各管一段，而 R1 那档谁都不管（2026-09-25）**。KI-050 把两个数搬进表时留的那句「R0/R2/R3 没有承载体」今天反过来说完：`CombatManager.applyReactionTier` 是这条通道唯一的主人，`reactions.json` 从两行变成五行（§8 原数 150/200/350/600ms 与 0/0.2/0.5/2m），`Enemy.onDamaged` 的材质发光读 `R0.flashMs` 且**第一次看「架势未破」那一格条件**（0.15 与那句条件原本都是写死的），`Enemy.interruptBroadcast` 的 12 格改读 R1 行——12 与 200ms 是同一个数的两种单位，写死就是给表造第二个主人。**三条裁决**：① **分级来源用引擎已有的出手重量轴**（light→R1、heavy/skill→R2），不替玩家那 24 格招式凭空发明档位：§8 的"中断规则"列自己就在说"轻击/重击"，而 `kind` 就是这句话在运行时里的形状；`FrameData.reaction` 只是覆盖口，今天唯一写它的是 §4.2 逐字点名的强音大剑跳劈 R3——**敌人的招式不许在帧上写**，那一侧的主人是 `AttackSpec.reaction`（validator 新门当场报"两个主人"）。② **Boss 整条 R0–R3 通道免疫**（只吃 R4）：§16/§2.1 的 Boss 前提是招式可背谱，逐式硬直把她拆成"手快就赢"；§15.2 Finale 那行「受击即断（R2 可打断全部招）」要的是**阶段级开关**，不是把整只 Boss 的豁免撕掉 ⇒ 留 ②。③ **R1 不接管时间也不接管位置**：那一档的名字是"颤身 Flinch"，而灰盒里没有 R3 那格原文要求的滑行/摩擦衰减，于是每一记轻击的 0.2m 会累加成一笔距离税——**这条不是讲道理讲出来的，是量出来的**：把 R1 也推 0.2m 之后 KI-039 的高甲量具从 1.45 顶到 **2.10**，越过它自己那句"轻武线在高甲前是废的"的判据线（同一份数据、同一颗种子、只改那一格）。`R1.displaceM` 因此不是死数据：它的读者仍是玩家受击那一边（`takeDamage`，KI-050），而"击退"这个动作归 R3。另外两条同向的让位：**破势中不叠逐式硬直**（R4 是这段时间的主人，再压一格只是把 `recover`＝处决窗口的入场往后推）、**回声重演不给反应**（旧账不推人，与"不吃 hitstop/不推连段"同一口径）。**一条当场修掉的坑**：弹体那条通道传给命中的 `dir` 是**速度**（28m/s），位移必须先归一化——不修的话一发投掷枪把敌人推 14m，而"0.5 米"是表里写好的那个数；这条有专门的腿。**守卫 15 条** `tests/flow/reaction-grade.test.ts`（在表 + "全仓只有一格帧声明" 的对账 ×2、三档各给各的数 + 改表法 ×4、打断语义 ×3（含"读条那格也读 R1 行"：改表 500ms ⇒ 30 格）、Boss/破势/弹体归一化 ×3、R0 发光 ×3（含破势不闪与改表法））；轻击那两条量具把敌人每 tick 按回 `idle`，否则它自己那一步（speed×dt≈0.02m）会混进位移读数——**量具的污染读数第一次露脸是 0.4805 而不是 0.5**。**反向实测 16 刀**：运行时十刀 ⇒ 摘掉调用恰红 5、把重量轴整体改判 4、让 R1 接管时间与位置 3、发光改回写死 2、单独摘 Boss 豁免/破势豁免/位移归一化/帧声明优先/读条那一格各 1（第十刀是撤回裁决③，见下）；数据门六刀 ⇒ 删 R2 行、塞一行 R5、分级不单调（R2=100ms）、R0 混进 `stunMs`、敌帧偷写 `reaction`、玩家帧写 R5，各恰报 1 条 ERROR。**第十刀值得单独记**：它红不在本批测试里，而是红在 **gate5 的高甲量具**上（1.45→2.10）——一条关于平衡的裁决，证人必须是平衡量具而不是它自己的单元测试。全部按字节还原复验（跨行锚点先按文件自己的 CRLF 重写——否则"锚点没找到"是假信号）。**实机（127.0.0.1:5199 隐藏标签页，真 `mousedown` + 逻辑步进）**：轻击 `{kind:light, stun:0, moved:0, flash:0.15}`、重击 `{kind:heavy, stun:21, moved:0.5}`、同一记重击打在奥斯塔拉身上 `{stun:0, moved:0, dmg:5}`（钟壳减伤照旧）、活体把 `ms_sword.l1` 标成 R3 ⇒ `{stun:36, moved:2.00}` 且当场还原。**留下的账**：敌人身上的 35 条 `AttackSpec.reaction` 声明被 §8 玩家侧那一整行（"一律 R1 等效"）吞掉，要么给玩家侧按档取时、要么删声明，这条口径矛盾归 ②；`hyper` 的消费方也在玩家受击那一边（两式声明住在玩家架式表）；R3 的「可坠崖」与 R5 的浮空/空中减伤仍无承载体。**"颤身看起来像不像颤身"照旧是视口评审缺（KI-010 同因）**。全量 **60 files / 637 passed**。
- **KI-052②：玩家受击第一次看来袭档位——分级只决定"没收哪一式"，时长仍是那一句"操作权不没收"（2026-09-25）**。① 把 §8 接到了"敌人挨打"那一边，这一批接另一边：`Threat.reaction` 把 `AttackSpec.reaction` 一路送进 `ThirdPersonController.takeDamage`（近战读敌人当前那一式、敌方弹体在 `launchEnemyProjectiles` 那一刻把发射者的声明带走——"离手之后才落"的那一发仍然带着自己那一档），于是敌人身上的 35 条 `reaction` 声明不再是死数据：§8 末行"玩家受击一律 R1 等效"整句把它们吞掉的那笔账到此为止。**分级的落点全部在打断那一列**：R0 什么都不收，R1 只收轻击段（**「不打断重击与蓄力」这半句到这里才有承载体**），R2 收一切非霸体，R3 起穿得过免役；时长永远取 R1 那一格，因为同一行的末尾写着"无 R3+（操作权不没收）"——这条不是注释：把时长改成按档取表，`reaction-grade` 当场恰红 9。**`hyper` 那两式第一次有人读**：§8 R2 括号里那句「招式自带 1 次 R2 免役」落成 `PlayerAction.hyperSpent` + `hyperLive`，窗＝前摇+Active，**收势段不算**（免役记在招式实例上而不是人身上，因为"一式一次"说的是这一式）。**一条平衡账被重锚，而且做了归因**：免役生效后 KI-039 的高甲量具把 力/律 节奏比从 1.45 推到 **2.16**（力那侧 6 次蓄力斩各硬吃一记钟锤）；A/B 出来只有 hyper 是动因——单独摘掉免役 ⇒ 1.899（回到旧带内）、单独摘掉 R1 那半句 ⇒ 读数一位不动（悬钟骑士根本没有 R1 级招式），所以越界的是设计里写明的豁免而不是新的数值偏袒；那条带的上界从 2 改到 2.3，并把"轻武线要不要一份等价补偿"留给数值裁决登记在两行 KI 里。**守卫 10 条**（时长恒定跨五档、R1 的两半、缺省落保守侧、R3 穿免役、免役恰好一次、没声明 hyper 就没有免役、收势段不再免役、缺式不收蓄力状态、以及一条走"真敌人用表里那一招打到玩家"的端到端腿）；反向实测十刀（摘免役 1 / 摘 R1 半句 3 / 一切皆收 3 / 缺省改 R3 1 / 按档取时长 9 / 近战不带声明 1 / 弹体不传 4 / spawn 不复制 4 / 免役不限一次 1 / 免役延伸到收势 1），**最后一刀原本不红**——"窗只到 Active 段"这半句当时没有证人，补了收势段挨打那条腿才咬住：探针不红的地方要当成判据的洞，不是当成探针便宜。实机 5199（真输入 + 逻辑步进 + 真 `projectiles.spawn`）：`charged`+R2 第一记 `{kept:true, stun:12}`、第二记 `{kept:false}`、`charged`+R3 `{kept:false}`、`h`+R1 `{kept:true}`、`l1`+R1 `{kept:false}`，console 0 error。③ 留下的：§15.2 Finale「受击即断」要阶段级开关、R3 的坠崖杀、R5 浮空与空中减伤。全量 **60 files / 647 passed**。
- **KI-022① + KI-052③：恩希尔的第三阶「Finale 过载期」入表——阶段可以换掉全场拍速、缩短前摇、并撤销 Boss 的打断免疫（2026-09-25）**。§15.2 给她写了三阶，`enemies.json` 里只有两阶："他自乱"那一段从没存在过。这一批补第三阶，三个字段都住在 `boss.phases[]`（不新表、不新增实体）：`bpm` 让**阶段**（而不是身份）决定 `AISystem.syncClock` 接管多少拍——全场网格跟着她过载，入场拍长、每小节读条、玩家的拍点判据一起变急；`startupMul: 0.8` 走 §14.6 定调那台攒帧加速器（前摇段每 tick 多走 1/4 帧），实测 18 帧的起手 15 帧走完而**判定窗仍是 7 帧**——"更早落刀"与"更长破绽窗"是两件事，只买前者；`interruptOnHit` 把 KI-052 那条"Boss 整条通道免疫"从身份级降为阶段级（那一阶里 R2/R3 挂硬直并作废那一式，R1 仍然收不掉她，**位移仍然免疫**：她的走位是断音柱机关的输入）。**这两格从下面拽出一条真 bug**：招式推进里"到点一次"的三件事（起手音、警戒广播、冲刺撞钟）判的都是 `tick === startup`／`=== 0`，而任何前摇加速都可能一步跨过那个整数——也就是说**被定调光环加速过的敌人本来就会偶尔不发声、不叫同伴**，这条洞比本批早得多。现在改成记在招式实例上的一次性标记，并给加速加了"不许跨过判定窗第一格"的钳制；**第一版钳制写成 `prev <= activeStart` 会把整式永远钉在窗口第一格，`support.test` 把它读成 168 > 48 当场抓住**——自己造的坑由自己的门禁抓到，写在这里不是为了表功，是因为这类"钳制边界"下一次还会写错。两条旧账同批改：`mainboss`／`boss-budget` 里"恩希尔两阶（Finale 未落）"按三阶重立，`stealbeat` 那条跳阶重置把血线算回 25%~60% 区间（它要量的是重置，不是掉到哪一阶）。守卫 10 条 `tests/flow/hersil-finale.test.ts`；反向实测 14 刀（运行时 8：拍速退回身份级 3、摘前摇倍率 1、撤钳制 1、摘起手音标记 1、摘 interruptOnHit 2、无视阶段放行 2、整段摘掉 Boss 分支 2、给 Boss 也上位移 1；数据门 6：startupMul 越界两种写法各 1、bpm 超范围 1、interruptOnHit 非布尔 1、删 attacks 1、招式悬空引用 1），全数还原复验。实机 5199 两阶对照：40% 血 `{phase:1, bpm:92}` 挨真重击 `{stun:0, 式还在, moved:0}`、20% 血 `{phase:2, bpm:120}` 挨同一记 `{stun:21, 式作废, moved:0}`。**没做也不假装**：同一行的"场地出 3 个振源核（外露可处决件，每个 18% HP）"要"可破坏场景物"这一类实体（KI-023 已登记本作没有），"60% 外环塌陷 + 声纹伤害带"要场地几何（KI-008 同因）——不拿灰盒方块冒充振源核。**还有一笔操作账记在这里**：本批一次行交换脚本先 `open(..., "wb")` 再算 payload，表达式抛错时文件已被截成 0 字节（`Enemy.ts` 整个空掉），靠 `git show HEAD:` 逐字恢复＋重放本批改动才没丢东西——**写文件必须先把内容算完再打开目标**，在制品文件上没有第二次 HEAD。全量 **61 files / 657 passed**。
- **布怪（`regions.json`，全场槽位 30→33）**：破拍营地 `count:1 @(-160,0,-230)`（§14.5 首次登场要在有掩体有杂音的营地边缘）；沉唱堂 `count:2 @(330,-40,60)`（第二区域也要有拍隙压迫，§5.2）。**无耳深窖故意未加**：那关的设计正解依赖声呐/听感感知（Phase 6 的耳朵机制），现在塞两只相位刺客进去只会变成"看不见=打不过"的坏题，登记为延后而不是缺失。
- 覆盖：`tests/flow/phantome.test.ts` 24 条（数据表逐字段、`intangible ⇔ 距拍点 ≤12` 每 tick 恒等 + 占比 `25/BT`、隐形段零位移、近战穿过 vs 半拍命中、弹体穿过不消耗、阈值数学、三个负例、重音显形、拍点闪避抓拍 A/B + 两负例、处决 A/B、真 AI 时序、`next` 连段派生，**外加 KI-016 那 6 条"敌人自己响"**：踏地震出它 / 太轻的不算 / 一招一声 / 弹道不加戏 / 敌人之间不给玩家拉仇恨 / 读条只一声且响度来自表）、`tests/unit/core.test.ts` 补 2 条（`ticksFromBeatPoint` V 形、`ticksUntilBeatOn` 小数拍位与严格向前）、`tests/flow/spawn.test.ts` 补 2 条布点。全量 `npx vitest run` = **19 files / 161 passed**（KI-016 之后：42 files / 456 passed；KI-048 之后：**43 files / 462 passed**，新增的 6 条在 `tests/flow/impactnoise.test.ts`：弹反一声=表值 / 格挡那一声闷且惊不动幽灵八而弹反惊得动 / 25m 目击者一个 tick 顶满并进 chase / 同一位置背身不报警 / 无眼者不吃目击 / 防御吃武器噪音系数 ×1.5；KI-017 第一步之后：**44 files / 466 passed**，新增的 4 条在 `tests/unit/clock-discipline.test.ts`；KI-037 第一步**本步新增 6 条**在 `tests/flow/movements.test.ts` 的休止两节，另 1 条 UI 断言挂在 `tests/unit/stakerite.test.ts` 已有的谱册用例里（不另开用例），同一工作区此刻的总量 **44 files / 473 passed**——其中含并行会话在飞的对话/任务用例，不都记在这一步头上；KI-037 第二步**本步新增 5 条**在 `tests/flow/movements.test.ts` 新那一节（真针喉离弦那一发静止 48 tick 后自己接着飞 / 撞上停住的弹体照样挨打 / 玩家自己的弹体一格账都不记 / 只有空中一发时也要报那一嗓子 / 无弹体在场时第一步那笔账不变），并把 `tests/unit/projectile-visuals.test.ts` 已有的"脉动/自旋"那条扩成"冻结期间不换档、松开就换回来"（用例数不变、断言数变），此刻全量 **44 files / 478 passed**；KI-021 第二步**本步新增一个文件 6 条**在 `tests/flow/boss-rewards.test.ts`（三场 Boss 各一条：真通道打死⇒核到手＋胜利序列收尾排在屏息之后 / 首杀唯一在真通道上 / 三颗核点亮三张吃核的页 / 反向：只杀两场则第三张 `poor`），此刻全量 **45 files / 484 passed**；KI-017 第二步**本步新增一个文件 9 条**在 `tests/flow/hitstop.test.ts`（挨打那一方被按住几格：敌方受击带 `hitStopMs=0` 对照腿 / 玩家受击 / 弹反那 120ms / 只停硬直不停状态 / 打空不产生停顿 / 回声不抢时间 / 与 §7.2 时停分格 / 出手方两条边界），此刻全量 **46 files / 493 passed**；KI-037 第三步（评审）**本步新增一个文件 5 条**在 `tests/flow/bossfreeze.test.ts`（Boss 私有拍速跨过一次时停：两位的收势帧误差与出手次数对照 / 万籁的资格 / 恩希尔 P2 换气拍 / 冻结期间她的招式帧一格不走的正面证据），此刻全量 **47 files / 498 passed**；§44 装备对比**本步新增 4 条**（挂在已有的 `tests/unit/stakerite.test.ts`，不另开文件），此刻全量 **47 files / 502 passed**；KI-027 第三步（超载出声）**本步新增一个文件 5 条**在 `tests/flow/overload.test.ts`，另给 `tests/unit/stakerite.test.ts` 补 1 条（面板负重那一行的两个分支），此刻全量 **48 files / 508 passed**；KI-007（武器外观跟随装备）**本步新增 3 条**挂在 `tests/unit/actor-visuals.test.ts`（每种 archetype 只亮一组 / 大剑的刃真的更长 / 未知形状回退但不空手），此刻全量 **48 files / 511 passed**；KI-003（处决的消音与专属音色）**本步新增一个文件 5 条**在 `tests/flow/execute-audio.test.ts`，此刻全量 **49 files / 516 passed**；KI-021②（跳阶低通 + 仲裁者）**本步净增 1 条**（`boss.test.ts` 的重叠用例；低通那 48 格的断言挂在已有的跳阶用例上），此刻全量 **49 files / 517 passed**；KI-017 第三步**本步新增一个文件 9 条**在 `tests/unit/action-frames.test.ts`，并把 `tests/flow/hitstop.test.ts` 的 9 条改成 10 条（攻方那一半的两条边界按现行口径重写），此刻全量 **50 files / 527 passed**；KI-017 第四步（②结案）**本步净增 5 条**（`hitstop.test.ts` 新一个 describe 3 条：改表法两腿 + 真持盾的「格挡 45」；`boss.test.ts` / `stealbeat.test.ts` 各 1 条改表腿），此刻全量 **50 files / 532 passed**；KI-017 第五步（③裁决）**本步新增 3 条**挂在 `tests/flow/hitstop.test.ts` 的破防 describe（不另开文件），此刻全量 **50 files / 535 passed**；KI-050（§8 受击反应入表）**本步新增一个文件 9 条**在 `tests/flow/reaction.test.ts`，此刻全量 **51 files / 544 passed**；KI-051（§10 附加格补承载体：FOV 脉冲 / 踏地尘环 / 处决推轨）**本步新增一个文件 10 条**在 `tests/flow/camera-feedback.test.ts`，此刻全量 **52 files / 554 passed**；KI-047（atkBase 死数据结案）**本步净增 3 条**挂在已有的 `tests/unit/movesets.test.ts`（白名单 / 武器↔moveset 一对一 / l1 真的有底数），不另开文件，此刻全量 **52 files / 557 passed**；KI-054（里程碑 grant 入表 + §5.3 落空生命周期）**本步新增一个文件 12 条**在 `tests/flow/milestone-grants.test.ts`，另把 `ranged.test.ts` 的两发弹反夹具从「落空重试」改成一次到位（用例数不变、判据变严），此刻全量 **53 files / 569 passed**；KI-037①（定音回响 + 无声协奏两式入表）**本步新增一个文件 9 条**在 `tests/flow/echo-tacet.test.ts`，此刻全量 **54 files / 578 passed**；KI-053①（处决震镜行入表）**本步净增 3 条**（camera-feedback +2、haptics 档序 +1，execute-audio/boss 的发射腿挂在既有用例上不加数；三条全是扩既有文件、不开新文件），此刻全量 **54 files / 581 passed**；KI-054②（ms_overdrive 落腿）**本步新增 2 条**挂在 `tests/flow/milestone-grants.test.ts`，此刻全量 **54 files / 583 passed**；KI-031①（HUD 里程碑腿：拍点涟漪 + 暴击飘字金环 + crit 发射腿）**本步新增一个文件 6 条**在 `tests/unit/hud-milestones.test.ts`，另在 `tests/flow/combat.test.ts` 补 1 条 crit 发射端腿（两世界 A/B），此刻全量 **55 files / 590 passed**；KI-031②（开场定弦流程：TitleScreen 门控 boot + `RpgRuntime.restring`）**本步新增一个文件 6 条**在 `tests/flow/restring.test.ts`（翻面/uid 不相交/往返同型/守卫逐字/卡面表对账/改表法），此刻全量 **56 files / 596 passed**；KI-031③（出身被动承载字段：`lootStackBonus` 期望值取整 + validator 双向对账门）**本步新增一个文件 5 条**在 `tests/flow/origin-passive.test.ts`，另给 `restring.test.ts` 卡面对账补 1 条断言（用例数不变），此刻全量 **57 files / 601 passed**；KI-030①②③（区域上修 + 丰谐幸运 + pity 口径裁决）**本步新增一个文件 8 条**在 `tests/flow/loot-rules.test.ts`（逐点占优 A/B、负对照、改表法两腿、中途卸下现查腿、泄漏守卫、数据对账、路由腿），此刻全量 **58 files / 609 passed**），`tsc --noEmit` + `npm run validate:data`（0 ERROR / 5 WARN）+ `npm run build` 干净。
- **视口评审（截图对比）未做**：本环境浏览器标签页处于隐藏态（`document.hidden=true`、canvas 0×0、rAF 停摆），渲染器按客户区尺寸建模 ⇒ 拿不到有效像素（KI-010 同一阻塞）。实机验证在 `tickFrame` 手动步进层完成（§6.3 的降级口径），逐 tick 读取的是 `intangible`/`opacity`/`revealTicks` 等状态量而非像素；已核对 300 tick 内 `opacity 0.18` 与 `intangible` **300/300 一致**。（KI-016 那 6 条的实机读数在 2026-09-24 于同一降级口径下重跑：真 `GameLoop` 手动步进、真 `Enemy`/`AISystem`/`CombatManager`，读的是 `revealTicks`/`alertness` 这些状态量。）

---

### 5.9.4 正面钟甲、碎甲与敲钟自鸣（Phase 4-E 悬钟骑士）— 已实现

§14.7 是第一个「**打哪里**比**打几下**重要」的敌人，也是第一个带**软计时器**的敌人。三条机制都要求伤害通道与读条通道各自长出一个新口子，但都不许长成新系统。

- **钟甲 = 单一伤害通道里的一个朝向项**：`ai.armorFront = {arcDeg, dmgMul}`，消费点只有 `strikeEnemy`（近战、玩家投掷枪、未来战技都从这条走）。判据用 `EnemyStrike.dir`（口径=「攻击者→它」）取反后与 `e.yaw` 比角，所以**不需要给 EnemyStrike 加来源坐标**；背刺分支天然不参与（它一定在背面）。反馈是「铛」——`audio.sfx: bell_clang` + `block_spark`，被减伤的那一笔必须听得出不一样。碎甲走 `fissureBurst`（既有满层结算点）：`e.armorBroken = true` 永久失效，不给它长回来，于是「攒震裂」是一次性奖励而不是轮流循环。处决**故意不吃甲**（它按生命比例结算，是读通状态的奖励）。
- **敲钟自鸣 = 把 §14.6 的「读条 + 后事」范式用回敌人自己身上**：`ai.selfToll = {everyBars, attackId, heal}`，进战时排定 `tollDueBar`，每逢 `everyBars` 小节网格到点就强制插入那一招（**不占 tryAttack 的 RNG 候选**——它是节拍器不是随机招式），走完 `startup` 帧才 `heal`。打断不需要新代码：`strikeEnemy` 每次命中都调 `interruptBroadcast`，而 stun/破势会直接清空 `attack` ⇒ 回血与钟声一起作废。满血时它不敲（计时器照常推进），省下一条「它给自己奶满还硬敲」的怪话。
- **`frames.next` 第二次上岗**：钟锤二连（拍 1 → 拍 2）直接复用 4-D 的派生字段，`bellswing1 → bellswing2` 之间因此是真实的「量化到下一拍」而不是帧级硬顶。
- **弹反回报差异 = `AttackSpec.parryStunTicks`**：§14.7「弹反二连第二段→钟体共振眩晕 2s」写成第二段那一格数据（120 tick），第一段没有 ⇒ 通用 18 tick。这是「同一句防御指令，奖励按招式不同」第一次不需要代码分支。
- **本 Phase 挖出并修掉一个真缺陷（读条后事泄漏）**：`pendingBroadcast` 原本只在「成功发射」「被弹反」「被玩家命中」三条路径上清空。而 `attack = null` 还可以来自 stun 分支、`recover` 状态、走调时刻、处决——这些路径留下的气息会在**下一招的起手帧**上偷偷生效（实测：自鸣被打断后仍回 15 血并响一声钟；`elite.test.ts` 去掉守卫就失败，是抓出来的真 bug 而不是装饰断言）。修法是 `Enemy.update` 顶部一条一致性守卫：没有读条就没有读条的后事。
- **顺带闭合一个 P1 进度阻塞（数据缺陷，不是代码缺陷）**：审计 `regions.json` 发现**内容节点的 y 不在可站平面上**——钟坠院的两组敌人写在 48/52（该层地板 64）、无耳深窖写在 -150/-152（地板 -144），而同区的吊桥/落钟/储物点也各差 6~16m。后果是静默的：`shapeHits` 的竖向比对永远不成立 ⇒ 双方互相打不着；`Interactables` 的 range=6 三维距离 ⇒ 存档点「看得见按不到」，而所有「数量对不对」的测试照样绿。已把 spawnGroups/interactables 的 y 全部对到本层地板（`travel` 的落点也一起），并加两条数据契约断言：**布点 y === groundY**、**节点与传送落点必须踩在 `Surface.floorAt` 认账的那块地板上（±4m）**。注意落点归属**不能只看 xz**：息声领是叠层世界，同一个 xz 上压着好几层（下桥进钟坠院=64 与雾语林地表=0 同格），必须带 y 判——`Surface` 的注释早就写了这件事，是我的测试先写错才被数据纠正。
- **布怪（35 槽位）**：`rg_fellcarillon` 落钟点 `count:1 @(206,64,-244) r6`（gameplay.md §229「钟坠院全家族+悬钟骑士」）；`rg_earless_deeps` 入口 `count:1 @(-96,-144,176) r5`（§217「无耳深窖入口精英把守」=软门）。破拍营地的「营长 ×1」（§254）**未落**：那条要求「仅强攻线交战」，即潜行线不该惊动它，而营地分线交战判定属于 Phase 6，现在塞进去只会变成开场必战的假精英。
- 覆盖：`tests/flow/elite.test.ts` 17 条（数据表逐字段回算毫秒、正面=侧面×0.6、20° 在锥内/45° 出锥、碎甲后正面=侧面严格相等、处决不吃甲、弹反第二段 120 vs 第一段 18、自鸣到点回血+钟声+提示、受击打断不回血、stun 打断不漏回血、四小节周期、满血不敲、警戒广播 25m 叫得动范围内的同伴而 31m 外的叫不动、读条中打断则一声传不出）；`tests/unit/actor-visuals.test.ts` 3 条（钟甲板只挂在 `armorFront` 的敌人上、碎甲=隐藏同一对象、出格回收往返不涨网格数）；`tests/flow/spawn.test.ts` 补 4 条（两区布点 + 两条 y 契约）。全量 **21 files / 185 passed**，`tsc --noEmit` + `npm run build` 干净。
- **实机复验（tickFrame 手动步进；截图仍被 KI-010 挡住）**：真渲染循环里从数据派出来的悬钟骑士落在 `rg_fellcarillon` 的 64 层（`floorAt` 同值、21 个 active chunk）；强音大剑实测正面 21 / 侧面 35 = 0.60，偏 20° 仍 20（吃甲）、偏 45° 33（不吃）；一发蓄力（3 层）把预设的 3 层顶满 ⇒ `armorBroken`、「震裂碎裂！」+「钟甲碎裂！正面减伤失效」双提示、钟甲板 `visible=false`，随后正面 33 = 侧面 33；第 4 小节自鸣走完前摇 ⇒ hp 120→135 恰好 +15、`bell_toll` 响一次、「敲钟自鸣 · 回复 15」；弹反第二段 ⇒ 「钟体共振！失衡 2.0s」、招式作废、stun 从 120 起算，玩家零伤；控制台 0 error 0 warn。**没能在实机复现的是「玩家一刀打断自鸣」**：脚本里玩家的挥击被精英自己的攻击反复打断（架势崩溃），该路径只有 headless 两条断言覆盖——记在这里，不写成已复验。
  > **KI-020 已闭合（2026-09-24），且上面那句归因是错的**。同一台实机（5199 隐藏页、`loop.tickFrame(1/60)`、真 `Input` 通道：`canvas.dispatchEvent(new MouseEvent('mousedown',{button:0}))` 由下一次 `input.poll` 变成 `edges.has('attackLight')`）跑出了 A/B 两腿：**A（对照组，同一引脚、只是不按键）**——自鸣走完前摇，hp 280→295 恰好 +15、「敲钟自鸣 · 回复 15」一次；**B（真输入）**——在 `e.attack.tick === -10`（前摇 90 tick 还没走完）那一刻按键，`l1` 起手，**press+7 那一记 `combat.hit{attackerId:'player', result:'hit', dmg:5, poise:6}`** 落在前摇里，press+12 读到 `e.attack === null && e.stunTicks === 12`（`interruptBroadcast` 独有的那 12 硬直），hp 280→**275**、回血提示**一次都没有** ⇒ 掐掉的正是回血那一半。**当初"被精英打断"是误诊**：真凶是探针没把玩家朝向钉住——`player.busy` 一路为 true 是因为 `l1` 正在演它自己，而那 30 tick 里 `combat.hit` 一条都没有＝单纯挥空（近战命中盒在身前锥内）。修法与 `elite.test.ts` 的夹具同源：同 tick 写 `player.yaw = atan2(dx,dz)` 与 `player.camYawRef = π + 那个角`。**一条顺带量到的语义值得留档**：被打断的自鸣**仍然响了一声 `bell_toll`**（在起手第 0 帧那次报信，`Enemy.ts:697`，KI-016 加的），所以"提前一刀"能掐掉治疗，**掐不掉报信**——潜行线别把打断当成静音。

### 5.9.5 Boss 运行时：私有拍速、单调阶段机与撞钟机关（Phase 4-F 奥斯塔拉）— 已实现

§15/§16 逼出来的不是「一只更厚的怪」，而是三件此前根本没有承载体的东西：**归属个人的时钟**、**只会前进的阶段**、**必须被看见的机关**。

- **私有拍速 = 叠在区域基准之上的一次接管（`RhythmClock.setHome/overrideTo/restoreHome`）**：`setBpm` 从此只写**基准**（区域配置），Boss 用 `overrideTo(108, 3)` 借用全场网格，`clockOwner` 暴露现在归谁。归还是**派生**的：`AISystem.syncClock` 每 tick 从「有没有还活着、还在交战的 Boss」重算，所以死亡、脱战、被流送回收三条路都自动归还——不存在「Boss 死了节拍还停在 108」这种成对事件漏掉才有的脏状态（和 `buff`/`intangible` 同一个设计口味）。§15.2「区域网格由他接管」从此是一行数据。
- **阶段机只前进不回跳，且换的是行为而不是倍率**：`boss.phases[i].attacks` 是**白名单**（`phaseActions()` 过滤距离带里的候选），`belowHpFrac` 是进入线。跳阶时把当前读条一起收掉（她要走去怒吼），并允许一记大伤害**一次跨过两条线**（测试钉住：打到 20% 直接落 P3）。血回满也不回跳——阶段是**事件**，不是血量的函数。§15.1「撞 2 钟 = 提前进 P2」因此写成机关的一条后果，而不是另一套 AI。
- **钟壳 = 单一伤害通道里的一个乘数 + 一个免疫位**：`shell.dmgMul` 与 `immuneToPoise` 只在 `strikeEnemy` 消费（近战、投掷枪、未来战技同受管辖）。关键是它**不封死结算**：玩家仍能看到数字、仍听到 `bell_clang`、仍会把她推后摇——只是这一笔被吃掉 90%。而架势免疫顺手消掉了 P1 的处决捷径（崩不出来就抓不住），所以「必须去撞钟」是**机制合力**而不是弹一个「不可伤害」标记。§16 的战长红线用算术钉住：剥壳后 P1 那一段 ≤90s，壳一直挂着则贵 8 倍以上。
- **撞钟机关的判据是「她自己的落地帧落在钟边」**：`flags:['charge']` 那招收势那一 tick 比对 `bells.positions` 距离。这样「引她撞钟」是**站位**问题（玩家站在钟前让她冲过来），不是反应力问题；也正是 §15.1 想要的教学。响过的钟塌成暗桩但**留在原地**：残响区每拍对她掉 4 点、对玩家 0 点——同一块场地同时是解除无敌的钥匙和站桩输出的奖励。
- **本 Phase 修掉一个从 Phase 1 就存在的 §2.1 违规（命中帧量化语义）**：旧写法把 `tick 0` 当成拍点，于是**所有**敌人真正的命中帧都比拍点晚一整个前摇（驼鼓 42 tick ≈ 700ms）——「看着像在重拍上，其实在重拍之后」，§2.1 的可预测性与 ±50ms 容差全部落空。现在 `ticksUntilBeatOn(beat, leadTicks)` 带上「这一招收势帧要走多少 tick」，挑**来得及演完前摇**的那一拍，起手提前、收势落在网格上。这条改动顺带把 §14.5 读对了：幽灵八的命中帧落在 and 位（=她**实体**的窗口），而不是 4-D 曾声称的「藏在隐形段里」——她在拍点上定身到连招都出不去，「打不着」靠的从来不是暗箭。`RhythmClock.offsetFromBeatGrid()` 是新加的尺子，验收②用它量到误差 <1 tick（16.7ms，容差 50ms）。
- **机关看不见就等于不存在**：`world/BossArenaVisuals.ts` 把 `bells.positions` 画成立钟（未响=亮铜全高，已响=暗桩压扁，材质只有两份共享实例），Boss 被流送回收时整体摘掉。它是纯只读表现层（依赖闸门仍绿），`peakLive` 用来钉池子不随往返增长。
- **落地面与实机复验**：奥斯塔拉的布点、三口钟全部落在沉唱堂的 -40 层地板上（4-E 那条 y 契约的第二次上岗）。实机 tickFrame：进战 `clockOwner` 翻到 boss/108/3，死亡归还 region/84/4；壳在时蓄力一记 3 伤、剥壳后同一记 26 伤（比值 0.115）；第一口钟响 → `shellLiftTicks` 360、提示「立钟鸣响 · 钟壳共振解除 6.0s（1/3）」、钟模压扁到 0.32；第二口 → 壳永久碎 + 提前进 P2 + `boss.phase{2/3}` +「悬钟骑士·奥斯塔拉 · 第 2 阶」；第三口仍立着。控制台 0 应用错误。
- **如实登记的缺口**：①P2「每 2 小节一次换乐句呼吸拍」未做（4-E 的 `barCast` 语义可以承载，但这一条要连着 HUD 的乐句线一起做，见 KNOWN_ISSUES）；②~~P3「内环 36 / 外环 20」的双层落点未做（一招收势帧只带一个 hitbox，需要多段判定）~~ **已落（KI-057，2026-09-26）**：不需要"多段判定"——判定还是一环，多的是**伤害档位表**（`frames.bands`，见 §3.2 末段）。当年那句"需要多段判定"是错的诊断，留着是因为它记录了为什么这条拖了这么久：分环问的是"打到了吃多少"，不是"打到了几次"。表现层仍无分环 tell（Phase 7 表现债）；③转阶段的「全频低通 0.8s」是音频侧的事，Phase 8 接；④立钟目前是**逻辑实体 + 灰盒模**，玩家不能自己敲钟（§15.1 只要求她撞，故不算偏离，但场地交互动词还没接）；⑤Boss 入场 3 拍演出与胜利序列、以及奖励（乐章战技 I / 音壁回廊捷径 flag）未落，属 Phase 6/8。

### 5.9.6 可背谱轮转、断音柱与敌人前摇音（Phase 4-G 恩希尔 P1）— 已实现（P2/Finale 未落）

§15.2 的 Main Boss 只落了第一阶，但这一阶逼出了三个**通用**载体，都不是「为 Boss 特判」：

- **`ai.pickOrder:'cycle'`：招式按表的顺序轮转，而不是抽签。**「每 4 小节一个乐句，玩家可背谱」在随机选招下是假话——玩家背不了一个掷骰子的对手。`tryAttack` 里 cycle 分支从 `cycleIdx` 起扫第一个不在冷却里的候选（全在冷却就这一拍不出手），于是谱面**可复现**：同一 seed、不同 seed 跑 2600 tick 出来的招式顺序完全一致（flow 里两条断言）。这不是让 AI 更聪明，是让「可预测」这件事真的成立。
- **断音柱 = 一条线段（`boss.covers` 从"显式近似"升级成遮挡射线的输入，KI-014①）。** §15.2 给全奏的「唯一解之一」是躲进柱子后面。这一格原来是两行手写判据（「玩家站进圆内 + 攻击者在圆外」⇒ 吃掉这一击；「攻击者也贴着同一根柱」⇒ 不挡，否则柱子变无敌房），而架构上一直按"这是近似"记账：接上遮挡射线之后它应退化成「射线先打到什么」。**那一天就是这一批**：`core/Occlusion.firstBlock` 从攻击者的**身体中心**量到玩家的**身体中心**，线段穿过柱面 ⇒ 这一击被吃掉（近战吃帧、弹体撞柱而落 `gone:'wall'` 并停在柱面，不是"穿过但没伤害"——那样柱子就成了隐形斗篷），并甩一片 `ring_dust` 在**撞击点**让玩家知道是谁救了自己。三条口径因此不再需要写死：① 反作弊那条是几何事实——线段从柱内出发时它没有"穿过柱面"这件事；② 判据的量具从发射者位置换成**这一段的两端**，弹体不再需要"用谁的位置判"这种二次近似；③ 玩家**没**踩进地板那个圆、但柱子确实在两人之间 ⇒ 现在挡得住（旧近似会漏，它量的是"躲到柱子旁边"而不是 §15.2 原意的"躲**到柱子后面**"）。`covers.heightM` 从这一批起是承重格：y 带 `[底, 底+heightM]` 不参与判定的话，一根 7.5m 的柱子会在数学上挡得住、在画面上一眼就能看出没挡住，数据门也据此给了区间 `[0.1, 30]`。同两个数被 `BossArenaVisuals` 拿去缩放那根**画出来**的柱子 ⇒ 画多粗就挡多粗，一本账。（网格是 `radiusTop 0.86 / radiusBottom 1` 的装饰锥，所以画出来的柱子在上半身比射线用的那根细约 0.15m（柱高 1/3 处）⇒ 射线取的是**底半径**当外包络：宁可"看着擦过、实际被挡"一寸，也不要反过来。）玩家的**挥砍**刻意不接这条通道：那是扇形/盒形命中框而不是线段，一把尺子不量两件事，登记在 KI-014 剩余格。**KI-014②a 之后这根柱子不再是场上唯一的遮挡体**：`Occluder` 变成了 `cylinder | box` 的可辨识联合，关卡侧 `regions.json > walls` 的塌墙/岩脊以**轴对齐盒截面**走同一个 `firstBlock`（盒用 slab 裁剪，三个轴各取"进入面最大值 / 离出面最小值"，入口参数必须先排序——否则任一负方向的线段都会被整类误判为"没穿过墙"）；画它的是 `world/WallGreybox.ts`，与逻辑名册读同一份数据，所以"能挡"必然"看得见"。
- **敌人前摇音终于有发射方了（一处系统性缺口）。** `enemies.json` 从第一版起就给每招写了 `sfx`，但全场只有**玩家**动作起手与**弹道发射**在 emit `audio.sfx` ⇒ 8 类敌人的招式音字段是死的：一个只用耳朵玩的游戏里，小怪出手无声。现在 `progressAttack` 在 `tick === 0`（前摇第一帧）按招式发一响，音量随 `loudness` 抬。这条不是新特性，是把 §55「数据驱动」里承诺的字段接上消费方。
- **音弹连发用 `burst.at=[0,39,78]` 表达「拍 1/2/3」**（92BPM 下一拍 39.13 tick）：§15.2 的三发点射是一行数据，不是代码里的循环。Tutti 的三小节前摇（469 tick）则是「可视读条」在帧表里的直译，配 `parryStunTicks:180` 把「弹反其起手拍=大师解」的回报写进同一条数据。
- **覆盖与实机**：`tests/flow/mainboss.test.ts` 12 条 + `tests/unit/actor-visuals.test.ts` 断音柱 1 条。实机 tickFrame（未竟厅 152 层）：他从数据里 spawn 出来、`clockOwner→boss/92/4`、前摇音 7 响、四根断音柱按表坐标挂在场景里；玩家贴柱（他在柱外 4m）时同一记管束横扫 **0 伤 + 4 片 dust**，往外迈到 4.6m（出半径 3.2）**27 伤** —— A/B 都成立；正常交战里他真的扫到过玩家 30 伤。
- **未落（如实登记，不当作已完成）**：§15.2 的 P2「夺拍」（BPM 随机游走 ±10%、玩家体力回复挂他的拍、闪避冷却漂移、换气拍弹反=夺回 8s）、60% 的场地塌陷与声纹伤害带、Finale 的三个振源核、以及 P1 的「音栓哪根亮起决定出招方向」全部未实现；`boss.phases` 目前只有一条，所以他是**单阶段 Boss**。另注：实机探针第一次跑「玩家出柱仍被打中」拿到 0 伤，原因是我用手工塞的 `attack` 对象停在 `startup-1`、而敌人不在 combat 态时帧根本不走 ⇒ 收势帧从未到达；那是**测试夹具的错误**，不是掩体的错误，改对后 A/B 如上。

### 5.9.7 夺拍：把玩家的节奏工具改挂到 Boss 的拍上（Phase 4-H 恩希尔 P2）— 已实现

§15.2 的第二阶写着「他吞掉全局时钟」。这不是一串 debuff，而是**归属权**：同一条网格、同一批消费方，从这一刻起由他的拍子发号施令。做完之后 §24「每 Boss 恰 2 或 3 阶段」也第一次真的满足了（奥斯塔拉两阶、恩希尔两阶）。

- **`phases[i].stealBeat` 是唯一开关**：阶段带着它 ⇒ CombatManager 每 tick 游走 `rhythm.drift`、给玩家挂 `beatParasite`、抖 `dodgeJitterTicks`；阶段不带（或被玩家抢回拍）⇒ 三者同时归零。`drift` 是 RhythmClock 从 Phase 1 就有的字段，此前一直没人写它 —— 现在它第一次成为玩法变量（92BPM ±10% ⇒ 实测在 -0.073~+0.056 之间走）。
- **「体力回复改挂他的拍」= 拍点门外一口气都不给**：`player.beatParasite = {regenMul, windowTicks}`，`PlayerController.update` 在 `stats.update` 之前把 `mods.regenMul` 按「离他的拍点多远」写成 `regenMul` 或 `0`。用既有的 `mods` 乘子通道，不新增一套体力系统；`windowTicks` 取四分之一拍（≈160ms），所以回复是「脉冲式」的，玩家能数出来。
- **闪避恢复锁 ±60ms 用整数 tick 落地**：`dodgeJitterTicks=4`（66.7ms）。翻滚的 `total` 在 `base±4` 之间交替（不是抽签：交替保证均值仍是 base，但每一滚的落点都要重读）。表里写 ms、代码只有 tick，这个 0.4 tick 的差**记在测试里**而不是假装刚好 60ms。
- **换气拍是唯一的反制窗，也是唯一写「不」的地方**：`barCast`（4-E 挂在 `ai.selfToll` 上的那条小节排程）升到**阶段级**，指向一招 `breath`（`damage:0`、`startup:21`≈0.35s、`reclaimWindow:true`）。窗口里按弹反 ⇒ 夺拍：`rhythm.drift=0`、玩家两项寄生减益清零、过载 +2、中立网格 480 tick。窗口外按 G 什么都拿不到（flow 里把这条钉死：把他钉在非换气读条里连按 120 tick，`stealNeutralTicks` 仍是 0）。**窗口长度只在招式表里写一次** —— stealBeat 不再重复一遍 `windowTicks`。
- **`onGrid:false` = 网格的例外通道**：§15.2 的「无拍突进」是全作唯一故意不量化到拍位的招式（教玩家放弃节拍依赖、改读身体 telegraph）。做法是给 `AttackSpec` 一个开关，`tryAttack` 见到它就跳过 `ticksUntilBeatOn` 与拍位插槽仲裁 ⇒ 它天然落在缝里（flow 断言命中帧离网格 >1 tick）。三段靠 `frames.next` 串起来，链式段也不回网格。
- **转阶段 ⇒ 时钟重置**（§15.2 表格第二行）：`syncBoss` 跳阶那一路把 `tollDueBar/stealNeutralTicks` 一起清掉，所以换气排程和中立余量都不跨阶段带过去。顺带给奥斯塔拉的 P2 补上了 §15.1 的「每 2 小节一次换乐句停顿 0.5s」（同一个 `barCast`，`heal` 省略 ⇒ 到点站着不咬人，是处决/喝药窗），这条 4-F 登记的缺口现在闭合。
- 覆盖：`tests/flow/stealbeat.test.ts` 10 条（游走、拍点门内外两种窗口各自的回复量、闪避漂移量级、P2 输出不可弹反、无拍三段不守拍且不抢插槽、换气每 8 小节真的来、窗口内弹反=夺拍全套后果、窗口外弹反无效、中立期到期后重新被夺）。全量 **24 files / 228 passed**，`tsc --noEmit` + `npm run build` 干净。
- **实机（真键盘 KeyG）**：未竟厅 152 层把血压到 50% ⇒ `bossPhase=1`、`clockOwner=boss/92`；400 tick 内 `drift` 走出 5 个不同值（-0.073…+0.056）、`beatParasite`/`dodgeJitterTicks` 全程挂上；跑到第 8 小节的停气窗，一次真实 KeyG 按下 ⇒ `stealNeutralTicks=480`、`drift=0`、寄生减益与抖动清零、过载 +2、提示「管风琴停气 —— 换气拍！」+「夺回节拍！中立网格 8s · 过载 +2」、`parry_ring` 可见。**未落**：60% 的外环塌陷与声纹伤害带（要内容几何，KI-008 族）、Finale 的三个外露振源核与 120BPM 崩塌、以及「声部锁链躲回廊柱」所依赖的 authored 墙体（KI-014②a 已落：`regions.json > walls` 的塌墙/回廊墩现在是同一条线段名册里的盒截面，并由 `WallGreybox` 画出来；仍缺的是没写进表的天然几何，KI-009）。登记在 KI-022。

### 5.9.8 区域网格与无网格领域 + 声音狩猎（Phase 4-I 万籁）— 已实现

§2.1 从第一版就写着每个区域有自己的拍、无耳深窖是**无网格领域**。此前这句话只活在文档里：`rhythm.setBpm(84, 4)` 写死在 main.ts，深窖和雾语林同拍。这一格补完它，顺便把隐藏 Boss 的身份立起来。

- **`RegionData.grid` 是必填字段，没有默认值**：7 个区域各自声明 `{bpm, beatsPerBar, label?}`（休垒 84 静默／雾语林 84／营地 84 军鼓／钟坠院 92／沉唱堂 96／深窖 **60 且 beatsPerBar=1**／未竟厅 92 余拍）。「必填」是刻意的：只要允许省略，84 就会以『缺省值』的名义重新变成写死的那个数。`flow/myriad.test.ts` 里一张表逐项对 combat.md §2.1。
- **优先级：Boss 私有拍速 > 区域基准 > 硬编码。** `main.ts` 进区域时把 `grid` 写进 `setBpm`（它只改 home），`AISystem.syncClock` 每 tick 决定当前用谁的拍，所以奥斯塔拉在 96 的沉唱堂里接管成 108/3、下场之后还的是**这个区域**的 96/4 而不是一个全局常量（flow 里用深窖 60/1 测了这条归还路径）。深窖那 60/1 就是设计说的「只有心跳」：一拍正好 60 tick，HUD 的尘环脉冲因此变成心搏节奏。
- **`ai.huntsSound`：把「噪声=危险」从潜行数值升成位置规则（§15.3）。** 玩家任何发声行为**本来就**在发 `sound.source`（4-E 之前只有玩家动作起手、跳跃、翻滚、脚步会发；敌人招式不发，见 KI-016），所以这条没有新事件、没有新通道：够响 ⇒ 她**瞬移到发声点**并当场起口（`bite`，前摇 18 tick=300ms 可读）。三处细节是她的性格：`minLoudness` 把潜行武器的低噪与重击分开（轻手轻脚真的不叫她）；`cooldownTicks=150` 让一串脚步只换来一次瞬移（否则她变成传送门）；`maxRange` 别让她跨全图。落点刻意是**发声点**而不是玩家怀里 ⇒ 玩家有 300ms 可读，且「往远处丢个响的东西」这一类诱导解天然成立。
- **`ai.hearsHeartbeat`：屏息是缓释不是隐身术。** 玩家连续静止 `stillTicks`(180=3s) 之后她的警觉按 `decayPerSec` 回落；一动立即清零。这条与 §11 的静步/潜行线共用同一个「玩家没在发声」的事实，但给的是**撤离窗口**而不是背刺机会。
- **她不吃视觉也不吃震动**：`vision.range = 0` 且 `vibration.range = 0` ⇒ `sense()` 两条唤醒路径的判据天然为假，不需要「万籁特例 if」。这是把「视觉=0，听觉锥 360°/40m」写成数据而不是写成代码分支的样板。
- **`onGrid:false` 的第二位使用者**：4-H 为「无拍突进」开的例外通道，在她身上是**全体招式**（§15.3「无拍点机制：全作唯一不在节拍上的敌人，反差即身份」）。附带两条被断言钉住的性质：她不进拍位插槽仲裁（不抢同场 Boss 的出手权），以及她的命中帧离最近拍点 >1/4 拍 ⇒ 玩家身上所有「按拍点加成/按拍点弹反」的工具对她**部分失效**，而她的每一招 `parryable:false` 才是真正的设计红线：**零强制反应窗**（§15.3 的失败设计验证：难度只来自信息管理与资源博弈）。
- 覆盖：`tests/flow/myriad.test.ts` 10 条（区域表逐项、Boss/区域优先级与归还、身份数据、站着不醒、一响即瞬移咬合、冷却不连环跳、太轻不算数、命中落在缝里、不抢插槽、听心跳回落+一动就回升）。全量 **25 files / 238 passed**，`tsc --noEmit` + `npm run build` 干净。
- **实机（无耳深窖，tickFrame + 真实输入）**：进区域 ⇒ `[bpm, beatsPerBar, clockOwner] = [60, 1, 'region']`；她在 (-247.9, 330.4) 从数据里出来，玩家在 8m 外站 180 tick 不动 ⇒ `alertness 0 / state patrol`（她真的看不见人）；一次真实左键挥砍 ⇒ 0.00m 误差瞬移到发声点、`bite@2` 起手、提示「万籁听见了你」；30 tick 后 `bite@32` 收势帧结算，玩家 5000→4966（36 基伤经 DR/方差后 34）。控制台 0 error 0 warn。
- **未落（如实登记）**：~~①§15.3 的**音刺**……~~ **① 已落（2026-09-25，KI-023①）**：props 层（`RegionData.props[]` + `world/Props.ts` 纯逻辑 + `world/PropVisuals.ts` 灰盒）落地，深窖三根音刺：只有重击家族计次、与敌人共用同一 `markActionHit` 预算、**汇聚噪音**在 `AISystem.noiseSink` 那一站把 gatherRadius 内的玩家声源改写成「发生在刺上」（必须在 hear() 之前拦——她记下真实站位再改就晚了），碎裂 ⇒ `Enemy.deafTicks` 360（窗内听觉视觉分支整条短路＝破势窗口；与 stun/frozenTicks 三条语义分格，冻结不计聋）；碎裂状态入档（存档 v8 `brokenProps`）。守卫 `tests/flow/props.test.ts` 6 条 + 反向实测 6 刀红 9 腿 + 验证器六门反向探针各恰红 1，实现注记见 combat.md §15.3。②「投掷音色晶声东击西」仍属 Phase 5/6 的道具环（伪拍点/伪声源的**消费方已经就绪**：任何 `sound.source` 都能骗过她的判据，道具一落地这条解法立即成立，无需改 AI）；③奖励（独特武器无鸣、初句圣所地图刻痕、战技 IV 乐谱）属 Phase 5/6。登记在 KI-023。

### 5.9.9 拍网走完最后一段：音乐层的 BPM 副本被删掉（KI-066，2026-09-27）— 已实现

§5.9.5／§5.9.8 把「Boss 私有拍速叠在区域基准之上」这条链在**玩法侧**接通了（她的招式踩她的拍），但**耳朵侧**一直没跟上：`src/audio/music.ts` 里躺着第二份主人 `const BPM = 84`，战斗曲永远按 4/4 演，于是 docs/audio.md §2.1「音乐重拍与敌人主攻击对齐」在奥斯塔拉身上是假的——而这句话恰好是她的设计根基（玛祖卡重拍＝弹反窗口）。这一格把那份副本删掉。

- **网格只有一个发布者**：`RhythmClock` 新增 `MusicGrid {bpm, beatsPerBar}` 与事件 `audio.music.grid`，声明写在 `RhythmClock.ts` 的 `declare module` 里而**不在 `EventBus.ts` 开第二份**（那条文件是别人的写入面，而且"谁拥有网格"和"谁发布网格"必须是同一个文件）。刻意**不带** `clockOwner`：听众唯一读的就是那两个数，"此刻是谁的拍"另有 F4 面板直接读 `clockOwner`，塞进事件就是一个没有消费者的字段（§55）。也刻意**不跟 `drift`**：§15.2 恩希尔 P2 的拍寄生是给逻辑拍的亚拍级摆动，`drift` 只进 `beatAccum` 不改 `bpm`，所以每 tick 都在变的拍长不会灌进调度（真要跟，得先解决 lookahead 里已排之拍与下一拍间距不单调的问题＝乱拍，那是另一条待办）。
- **唯一发布点是 `update()`，这一条是实测出来的而不是设计的**：第一版把发布写在 `setBpm/overrideTo/restoreHome` 里，集成测试量到 **0 拍**，探针回读 `{grids: [], logs: ["music: 没收到拍网…"]}`。原因是组合根的构造顺序——`main.ts:61` 建钟、`:62` 就 `setBpm(84,4)`、`:104` 才 `new AudioEngine()`，那次启动期的 `setBpm` 把"第一次发布"消耗在了**还没有耳朵**的时候。所以「发布过」必须重定义成「**被听见**过」：setter 只写字段，`update()` 每 tick 拿当前值与"最后一次被听见的值"比对，不同才发。副作用两条都是要的：`AISystem.syncClock` 每 tick 幂等重算不会刷总线（实测整场接管只发 1 条），暂停中也照发（网格是"现在是多少"，不是"走没走"）。
- **听众侧没有兜底数字**：`MusicLayer` 收不到网格就**一都不排**，并且把这件事说出口（一次性 `bus.emit('log', warn)`，不是静默、也不是"先按 84 演着"）。小节形状从 `beatsPerBar` 现推（第 1、3 拍驼鼓 ⇒ 4/4 是 咚哒咚哒、3/4 是 咚哒咚），钟 accent 的周期跟着变成 `2 × beatsPerBar`。`AudioEngine` 缓存最近一条网格并在 `start()` 时交给音乐层、之后原样转发 ⇒ 首次手势晚于 boot 也不会丢网格。
- **换网格不许抹掉已排的拍**：`setGrid` 只改"下一拍之后"的拍长，`beatIdx` 也不归零（重排小节头会打断正在演的那一拍）。这条有专门的用例：改网格前后对 `startedAt` 与包络事件做整表快照比对。
- **入战的相位仍然没锁**（如实登记）：淡入注释现在写的是事实——入战第一拍是 `now + 0.1`，不是 §2.1 的 `snapToNextBar()`。拍速对了不等于相位对了，这一格仍欠着，见 KI-066 行的「没做」。**（KI-068 已闭合，见 §5.9.11：这一句记录的是当时的状态，代码里那句 `now + 0.1` 已经不是入战的默认落点。）**
- 覆盖：`tests/unit/rhythm-grid.test.ts` 6 条（发布点/去重/暂停中照发/drift 不跟/接管-归还各一条/接管中改基准的延后生效）、`tests/unit/audio-music.test.ts` 15 条（无网格不排+恰一条 warn、快照不被抹、3/4 声部与 accent 周期）、`tests/unit/audio-engine.test.ts` 21 条（缓存交接＋运行中转交）、`tests/flow/grid-audio.test.ts` 1 条整链（真 `RhythmClock` + 真 `AISystem` + 真 `AudioEngine` + 假 WebAudio，判据写成"调度出来的拍距＝钟当前的拍距"，不手填任何 BPM 期望值）。四文件 43 条全绿，`src/audio` 三个文件逐文件 **100%**（AudioEngine 147/147、music 166/166、synth 306/306）。反向探针 10 中 **9 咬**：P9（把隐藏默认值 `bpm = 0` 改回 `84`）在整链上**不咬**，原因是设计本身——第一次发布之前没有任何可观测窗口，能证它的只有 unit 里那条"无网格 ⇒ 0 拍"（登记在 KI-066，不藏）。
- **实机（§77 那条腿，真 Chrome WebAudio + 合成手势建图 + 节流 `tickFrame`）**：`?fresh=1` 冷开 ⇒ 钟在跑之前 `grids: []`（与 headless 同形），第一次 `update()` 的 tick 1 就发出 `{84,4}`；起战斗层之后驼鼓/军鼓以 **0.714s** 交替（＝60/84）；`ai.spawn('en_ostlara') + enter('chase')` ⇒ `clockOwner 'boss'`、网格只多发**一条** `{108,3}`（tick 95），拍距实测 **0.555/0.556** 交替（＝60/108），声部序列变成 `咚哒咚｜咚哒咚`（3/4 的小节形状在真机上看得见）；`ai.despawn` 之后归还 `{84,4}`（tick 198），拍距回到 0.714。全程 `logs: []`＝没有"没收到拍网"那句 warn。
- **这一趟实机顺手撞出一个新缺陷（登记 KI-067，同批已修，见 §5.9.10）**：三次探针之间页面被晾了 ~22 秒（隐藏标签页 rAF 不跑，而 WebAudio 钟照走），下一次 `update()` 把积压的 31 拍**全排在同一时刻** `ctx 53.372`（`scheduleBeat` 里的 `Math.max(nextBeat, now + 0.02)` 阻止了"往过去调度"，却没阻止"把整个欠账砸在现在"）。真机上等于"切回标签页那一瞬间一记机枪"。这不是 KI-066 的回归（旧代码同样会，且节拍副本还在时更乱），但它必须在 KI-066 之后立刻立一条：调度落后超过一拍时应**重新锚定**而不是补排欠账。

### 5.9.10 调度欠账：落后超过一拍就重新锚定，不把历史砸进现在（KI-067，2026-09-27）— 已实现

§5.9.9 最后那条实机撞出来的缺陷在这里闭合。`MusicLayer.update()` 的循环是 `while (nextBeat < now + 0.25) scheduleBeat(Math.max(nextBeat, now + 0.02), …)`：`Math.max` 只挡住"往过去调度"，挡不住"把整段欠账排在同一个现在"。`update()` 一旦长时间没跑（真机＝标签页被切走/后台节流；本机＝隐藏标签页 rAF 不跑而 WebAudio 钟照走），回来那一帧就是一次机枪——实机读到 **31 拍全落在 `ctx 53.372`**，headless 同形状复现是**一帧 28 拍**。

- **修法只动队首，不动历史**：`behind = now - nextBeat`，`behind > 一拍` ⇒ `nextBeat = now + 0.05` 并说出口（一条 `warn`，写明跳过几拍）。这与 KI-066 那条"已排的拍一张不抹"是同一条纪律的两半——重锚发生在**还没排出去**的那一端，WebAudio 时间线上已存在的节点不碰。
- **门限为什么是「一拍」而不是「N 秒」**：落后不到一拍本来就在循环的吸收范围内（它一轮最多排 `ceil(0.25/拍长)+1` 个，一次卡顿该补的拍要补上，掉拍是听得出来的）；超过一拍说明那段时间根本没在演，补排等于把历史砸进现在。**这条边界不是想当然守住的**：见下面 P2 那一刀。
- 覆盖：`tests/unit/audio-music.test.ts` 的「调度积压」describe 3 条——①晾 20 秒那一帧排出去的拍 ≤2、没有一拍被排到过去、其后间距回到 `60/84`；②重锚那一次**恰一条** log，回到实时后 200 帧不再重复吱声；③三世界对照（同一套 3.0 秒预算）：0.05s 小步=5 拍、中间一记 0.3s hitch=5 拍且不吱声、整程 0.5s 一帧（2fps 重度掉帧）=5 拍且不吱声——后两个世界是给门限用的，因为循环每轮都把 `nextBeat` 抬到 `now+0.25` 之外，**轻 hitch 根本走不到门限边上**。四文件 46 条全绿（rhythm-grid 6 / audio-music 18 / audio-engine 21 / grid-audio 1，含本批新增）。
- **反向探针 4 刀 4 咬**（脚本在仓库外，基线 `music.ts` sha1 `f78ae26d…`，跑完按字节还原并复验）：P1 删掉整个重锚块 ⇒ 用例①②红；P2 门限写成 `behind > 0` ⇒ 只有用例③红；P3 保留重锚但删掉那句 log ⇒ 只有②红；P4 锚错时刻（锚回过去两拍前）⇒ 只有①红。**P2 第一次跑是不咬的**——那不是我改错了，是当时的③只有一记 0.3s 的 hitch，够不到门限两侧的分界，等于门限没被钉住；补进"整程 0.5s 一帧"那个世界之后才咬。对照组（未改坏）18 条全绿，四刀各自只红它该红的那一条，没有一刀靠"整体崩掉"蒙对。
- **实机腿（§77）拿到了一半，如实记**：`fetch('/src/audio/music.ts')` 回读确认页面跑的就是带守卫的那份（`hasGuard: true`）；真 `AudioContext` 的钟在 JS 线程停摆时照走（鼓点 `when` 从 `2.334` 跳到 `78.292`，中间是 ~76 秒没有任何 `update()`），而**恢复之后的读数是修复后的形状**：`distinctGaps = [0.7143]`、单帧最多 1 个鼓点头、`scheduledInPast = 0`——同一条时间线上没有再出现"31 拍砸在同一刻"。**没拿到的那一半**：受控的「冻结 8 秒 → 只步进一帧」读数（隐藏页里 `setTimeout` 被节流到 ~1 秒一次、而战斗鼓点此时已随遭遇结束停下，那一帧根本没有鼓点可数），以及"听起来还像不像机枪"——本机无听觉与视口（KI-010 同因），这一格按 §78 属不可承诺项。**并且这一腿把探针自己弄死了**：探针里写了 `while (performance.now() < performance.now() + 1)`，右端每轮重算 ⇒ 条件恒真 ⇒ 渲染主线程被钉死，之后 `() => 1 + 1` 也 15 秒超时，`navigate_page {type:'reload',timeout:2000}` 能返回但 `window.__caesura` 再也读不到。教训写进探针纪律：**空转的终止条件必须是提前算好的常量**（`const end = T() + 3000; while (T() < end)`），写在 `while` 条件里被反复求值的任何东西都不算上界。
- 门禁：`tsc --noEmit` 0 错、`npm run build` 干净且守卫那句在产物里（`dist/assets/audio-*.js` 命中「重新锚定」）。**全量门此刻仍红但不是这一批**：`node scripts/test.mjs` 88 文件 / 1011 passed / 17 failed，六个红文件（`bells` `debug-panels` `dialogue×2` `slots` `doc-audit`）全部是并行会话在飞的 Phase 6-B 输入的下游——`doc-audit` 红在它新建的 `src/quest/WorldStates.ts` 未记账，`slots` 红在坏因读数 `'parse'` ≠ `'crc'`，本批未触碰任何数据表、任务、存档代码；`validate-data` 的 8 ERROR 同理。第五道门按 KI-063"红跑不作数"拒绝落账 ⇒ 覆盖率地板**没动**。
- 缺口顺带对账一条（不在本批做）：`AudioEngine` 没有挂进 `__caesura`（`main.ts:104` 是模块内 const），实机量音频只能靠 `AudioContext.prototype` 那套装具；受控冻结读数需要"能在鼓点停着的时候仍然起口"的入口，那属于 §5.9.9 已登记的 `snapToNextBar()` 那一格一起做更划算。**（那一格已于 §5.9.11 闭合，KI-068。）**

### 5.9.11 入战相位锁：第一拍的时刻与拍号由玩法网格查出来（KI-068，2026-09-27）— 已实现

§5.9.9 删掉了音乐层自己的 BPM 副本，§5.9.10 堵住了调度欠账，两格都点名同一处欠着的缺口：docs/audio.md §2.1 的「战斗开始：`EncounterTrigger → BeatClock.snapToNextBar()（≤2 拍内进战斗曲）`」从没实现过。`MusicLayer.onEncounter` 起战斗层时写的是 `nextBeat = now + 0.1; beatIdx = 0`——拍长对上之后，**第一拍落在哪**仍是猜的：`0.1s` 在 84BPM（一拍 0.714s）里既不是拍点也不是小节头，而 `beatIdx = 0` 让驼鼓与 ostinato 音格从第 0 格硬起。于是"重拍＝弹反窗口"这句设计根基在**入场那一下**是假的（稳态两拍之后才偶然对上）。

- **落成只读查询，不是字面那句"把钟 snap 过去"**：`RhythmClock.barEntry(maxWaitBeats = 2)` 只回答"该落在哪一拍、还要等多久"，`beatAccum` 一格不动。理由与 §5.9.8 那条"敌人的 hit-frame 吃同一个网格"是同一条纪律：挪钟会连带挪走场上所有在飞招式的量化，为了音乐的落点去动玩法的拍，代价方向反了。发射侧 `CombatManager.checkEncounterMusic()` 在报"有人照面"时带 `enter: rhythm.barEntry()`，消费侧 `MusicLayer.onEncounter(start, cut, enter)` 只在**上升沿**取用（`!battleOn` 那一支）：发射侧每 30 tick 重发一次"还在交战"，若每次都重锚，战斗曲会被每隔半秒拽回小节头，那比 `now + 0.1` 更糟。
- **两支，和那个夹子为什么必需**：小节头在预算内 ⇒ `{waitSec: (beatsPerBar - pos) × 拍长, beatIndex: 那个小节头}`；够不着 ⇒ 夹到下一拍点并**报它的真拍号**（不假装是小节头）。「必踩小节头」与「≤2 拍」在 4/4 里不可能同时恒成立（`pos < 2` 的那一半时刻离小节头 >2 拍），夹子是把这句承诺兑现成可执行的一步；3/4 的预算兜得住（小节头每 3 拍一次），60/1 的深窖里处处是头。两支都在整链上走过：夹住那一支从第一个 tick 就被接受，小节头那一支专门补了一条用例，判据是**等待必然超过一拍**（夹住那一支最多等到下一拍点，超过一拍只可能来自"真的在等头"）。
- **`enter` 是可选字段——这个裁决与 KI-066 的 `clockOwner` 反着来，理由也相反**：发射侧不止 `CombatManager`（面板、`bossshow`/`debt` 那类探针、单元测试发的是裸 `{ start }`），而 `barEntry()` 要查全场钟，`main.ts` 里 `rhythm` 是模块 const、没进 `__caesura`，那些发射**发不出**这个字段。所以缺它时退回旧的 `now + 0.1`，并且**说一次** `warn`（「入战事件没带落点 enter，§2.1 的 ≤2 拍对齐没生效」）——不是静默，也不是"就当锁过了"。
- **两个边界是实现的一部分，不是收尾的修补**：①第一拍时刻写成 `Math.max(now + enter.waitSec, now + 0.02)`。假 `AudioContext` 从 0 起（第 0 tick 入战 ⇒ `waitSec = 0` ⇒ `nextBeat` 恰为 0），而 `update()` 里那句 `if (nextBeat === 0) nextBeat = now + 0.05` 是"从没起过拍"的哨兵（KI-066 的），会把这个合法落点当成未初始化吃掉；真机不会遇到，所以这是**测试装置暴露出的边界**，按 KI-065 那条纪律就地承认并写死下限。②`beatIdx = enter.beatIndex` 用的是全场网格的**绝对拍号**，而 `MusicLayer` 只拿到 `{bpm, beatsPerBar}`（`clockOwner` 刻意不进载荷，KI-066），所以它无法自算"距上一个头几拍"——拍号必须由发射侧代劳，这正是 `enter` 存在的理由。
- **旧的裸发射不改行为，只改写法**：KI-065/066/067 那批用例里有 17 处 `bus.emit('audio.music.encounter', { start: true })`，本批统一带上 `ENTRY = { waitSec: 0.1, beatIndex: 0 }`——**等于它们各自的旧行为**，所以那些断言一格没挪（改之前先跑过一次，确认新加的不是它们而是"没落点 ⇒ 恰一条 warn"这一条）。
- 覆盖：`tests/unit/rhythm-grid.test.ts` 12 条（新增 6 条 `barEntry()`：预算内踩头／夹住时报真拍号且不假装是头／3/4 扫 400 tick 等待恒 ≤2 拍且"出现过也非总是头"／60/1 处处是头／刚起步与走半步的相位算术／接管-归还前后在同一连续拍位上靠 `beatsPerBar` 分成两支）；`tests/unit/audio-music.test.ts` 23 条（新增 5 条：落点走到调度器（`now+waitSec`，通过 `toBeCloseTo(…, 4)` ⇒ 误差 ≤5e-5 秒）、没落点 ⇒ 旧 `now+0.1` 且 warn 恰一条不刷屏、拍号定鼓点身份（头 ⇒ 驼鼓，第 2 拍 ⇒ 军鼓）、音格跟拍号（第 12/11/13 拍分别是 Bb 116.54／155.56／65.41，而旧代码三格都是第 0 格）、战斗中段的第二次"还在交战"不许重锚（最大拍间 <1.15 个拍长 ⇒ 落点只在上升沿取，发射侧那种每 30 tick 的重发不改时间线)；`tests/flow/grid-audio.test.ts` 4 条（新增 3 条整链，发射侧换成真 `CombatManager.checkEncounterMusic()`，判据写成**两侧对齐**：事件报的 `beatIndex` 与钟自己走到那一拍时读到的 `info()`——`isBarStart` 必须与 `beatIndex % beatsPerBar === 0` 同真同假，鼓点身份必须与落点在网格里的位置同源）。四文件 60 条全绿（12/23/21/4）。整链第三条（她接管之后才入战）在第一趟探针之后加了一段**入战前的逐相位扫**（在她的 3/4 网格里扫 150 tick，每个相位都要求等待 ≤2 拍、且两支都被走到过），断言变多、条数没变。
- **`barEntry()` 用在测试的接受条件里，这件事单独交代（而且它真的付过一次账）**：整链那三条要挑"落在小节头"与"没落在小节头"两种时刻，用的是同一个查询。这不构成自证，因为被断言的是**两条独立读数的等式**（事件载荷 vs 钟自己走到那一拍时读到的 `info()`；鼓点身份 vs 落点在网格里的位置；等待秒数 vs 「`(落点拍号 − 当前拍) × 当前拍长`」这条从钟现读的算术）。但**判别式会替被测的东西作弊**这件事是探针抓出来的：第一趟 P5（预算 2→9）里，「她接管之后才入战」那条**没红**——它的 `waitSec ≤ 2 拍` 只检查被 `i % 3 === 0` 挑中的那一刻，而 3/4 里"等小节头"那一支按构造就 ≤2 拍，所以预算改成多少它都绿。修法不是删断言，是**换成逐相位量**：入战之前在她的网格里扫满 150 tick，对**每一个相位**要求 `barEntry()` 的等待 ≤2 拍，并要求两支都出现过（用 `beatIndex % beatsPerBar` 是否为 0 分辨）。改完 P5 在**这一条**上红了（「她的第 3 拍离落点 2.97 拍 > 2 拍预算」），预算那句话才第一次在这张网格里被量到。留下 `barEntry()` 只做挑时刻，不再负责证明预算。
- **反向探针（5 刀，预测 5/5 全中；对照组 60 条先跑，确认基线干净）**：P1 丢拍号（`beatIdx = enter.beatIndex`→`0`）⇒ 3 红（整链的鼓点身份、unit 的"拍号定鼓点身份"与"音格跟拍号"）；P2 丢时刻（`Math.max(now + waitSec, now + 0.02)`→`now + 0.1`）⇒ 2 红，读数直接写出两边各是多少秒（`第一拍实际在 t0+0.1000s，事件说的是 0.6976s`）；P3 发射侧退回裸 `{ start }` ⇒ 整链 3 条全红且**红在"没带落点 enter = 整链断在 CombatManager 那一环"这句归因上**，而 unit 全绿——两侧各看各的环，这句才不是套话；P4 落点不只取上升沿（`if (!this.battleOn)`→`if (true)`）⇒ 1 红（战斗中重发那条，最大拍间 1.186s 对拍长 0.714s）；P5 预算没了 ⇒ 6 红（含上面那条新加的逐相位扫，它把"没红"追成了红）。三文件改坏前后 sha1 复核字节级一致（`music 530c65da6011`／`CombatManager 859156425689`／`RhythmClock cf99973e7dea`）。**没有一刀能打红的两格**：`warnedNoEnter` 的"只说一次"、以及 `0.02` 这个下限本身——砍掉它只在假钟从 0 起时才出事，而那正是它被写进来的理由（测试装置边界，见上一条边界①），不另设刀也不假装量过。
- **没做①：Boss 接管之后才入战不重查落点**（**KI-069 已闭合，见 §5.9.12**；下面这段记录的是当时的状态）。她由 `alert`/`callAlly` 唤醒时 `syncClock` 当场接管，而遭遇事件的上升沿通常已经过了（杂兵先把战斗层开着），于是她**这一场**的入战落点仍是区域节拍；战斗中途的拍距/小节形状确实跟着她（KI-066），但入场那一下没查。修法是"网格变了就为下一拍重查落点"，那要先回答"已排进 WebAudio 时间线的那几拍怎么办"——与 KI-066 那条"不抹历史"直接相邻，属第二格，本批不偷做（登记在 KI-068 行的「没做」①）。
- **没做②：实机相位读数**。本会话的 `http://127.0.0.1:5199/?fresh=1` 页面在 §5.9.10 那趟探针里被我自己写死的空转钉住了（`window.__caesura` 读不到、`navigate_page` 换不到可读句柄），而"落点准不准"最终要耳朵＋F4 面板上的拍号对照，本机两者都不可得（KI-010 同因）。这一腿等页面重启后补，不拿 headless 的绿冒充它做过。
- 门禁：`tsc --noEmit` 0 错；全量 1042 条 / **16 红**，四个红文件（`bells` 7、`debug-panels` 2、`dialogue` flow 3 + unit 3、`slots` 1）全是并行会话在飞的 Phase 6-B 输入的下游，音频/时钟/战斗/存档相关一格不红；第五道门按 KI-063"红跑不作数"拒绝落账 ⇒ 覆盖率地板没动。

### 5.9.12 网格中途变化时把小节位置跟过去：入战落点的第二半（KI-069，2026-09-27）— 已实现

§5.9.11 的「没做①」在这一格闭合。KI-068 把**入战那一下**的第一拍交给了玩法网格，但 Boss 的真实入场顺序通常是"杂兵先把战斗层开着 → 她被 `alert`/`callAlly` 唤醒 → `AISystem.syncClock` 当场接管"。这时遭遇事件的上升沿早就过了（`onEncounter` 的 `!battleOn` 那一支不会再走），于是她**这一场**只有拍距与小节形状跟着她（KI-066），**小节位置**仍留在音乐层从入战那一刻自己数下来的那条锚上——§2.1「音乐重拍与敌人主攻击对齐」在整个过渡段（她的前几招，正是玩家读拍的时候）仍是假的。

- **落点这条原语不新写**：`RhythmClock.publishGrid()` 在"网格真的变了"那一次多带一个 `enter = this.barEntry()`（发布那一刻的落点），消费方从"只有 `CombatManager` 会问"扩到"`MusicLayer` 在换网格时也被动收到一份"。`MusicLayer.setGrid()` 于是把**尚未排出**的那一拍跟到新网格的头上去（`nextBeat` 与 `beatIdx` 一起跟，只跟时刻不跟拍号＝时刻对了鼓点还是错的，探针 P5 量的就是这一格）。
- **变化判断只看 `bpm/beatsPerBar`，`enter` 不参与比较**：`barEntry()` 每 tick 都在往前走，把落点算进"变没变"就等于每 tick 发一条——KI-066 ② 那条"逐 tick 幂等重算不许刷总线"的纪律当场作废。生产侧这一眼与消费侧的 `changed` 是**双层**保护，两层各有一条用例（`rhythm-grid`「`enter` 每 tick 都在变，但它不是"网格变了"」／`audio-music`「同一个网格带"新落点"重发 ⇒ 不许重锚」）。
- **三个条件都是这句话的一部分，而且它们的可见效果不是一样的三件事**：①`changed`——真的变了才重锚，同值重发不许把 `nextBeat` 一次次往前推（那听着就是"永远在等下一拍"）；②`battleOn`——只在正在演的时候用；③已排的拍仍然一张不抹（与 §5.9.9 同一条纪律）。探针在这一格抓出一个**关于守卫本身的事实**：把 `battleOn` 砍掉（P3）只咬"淡出那 4 秒"那一条，"战斗层还没起来"那条**不咬**——因为 `update()` 里还有一道 `scheduling = battleOn || 淡出中` 的门，"没开战就不排"在这一层是双层的。所以那句 `battleOn` 的**唯一可见效果**是淡出窗口（退场不许被新落点拽住，§16 那一下安静要听得出来），而"没起来就不排"这条行为由 P6（把调度器那道门抬成恒真）来判。**记在这里而不是把两格都算作那条条件的功劳**。
- **帧内时序是这一格的读数全部**：一次 `run()` tick 的顺序是 `ai.update`（她接管）→ `rhythm.update`（发布 → `AudioEngine` 同步转发 → `MusicLayer.setGrid` 重锚，用的是 `ctx.advance` **之前**的 `now`）→ `ctx.advance(TICK_DT)` → `engine.update()`（`scheduleBeat` 里 `Math.max(nextBeat, now + 0.02)`，这个 `now` 是**之后**的）。所以接管之后**可达的最早落点**是 `发布时刻 + TICK_DT + 0.02`：整链的等式按这个下限写（第一版按 `max(waitSec, 0.02)` 写，实测差 0.0126s 而红——不是生产缺陷，是断言没把自己装置的那一帧算进去）。落点小于这一格时会被垫到 `+36.7ms`，偏差在 §2.1 自己的 ±50ms 容差内，而 `waitSec` 大于一格时等式两边仍是同一个数。同理，接管、发布、重锚、排拍**在同一个 tick 内**，所以整链那条用例把"接管检测"和"第一拍读数"合进同一个循环——晚一帧起扫就把它读丢了（第一版就是这样，读到的是 +0.5796s）。
- **代价如实写**：lookahead 只有 0.25s，重锚只动 `nextBeat`（"下一个要排的"），所以过渡那一拍最多与**已经排出去的最后一记**重叠 ≤0.25s，听感上是一记软撞。这是 KI-066「不抹历史」与 §2.1「重拍对齐」之间必须选的边界：宁可软撞一记，不可抹掉时间线，也不可让重拍留在旧的锚上。
- 覆盖：`tests/unit/rhythm-grid.test.ts` 14 条（新增 2：每一条发布的 `enter` 与发布那一刻的钟自洽——`waitSec = (落点拍号 − 当前连续拍位) × 当前拍长` 从钟现读、`≤2` 拍预算、**等头与夹住两支都被走到**；幂等重算 100 tick 仍是一条）；`tests/unit/audio-music.test.ts` 28 条（新增 5：带落点的新网格 ⇒ 未排出的那一拍跟到新的头（时刻／鼓点身份／之后的拍距三件一起）、**不带落点**的新网格 ⇒ 只换拍距不挪时间线（这条是上一条的对照，证明绿的是那个字段而不是"任何变化"）、战斗层没起来时一声不排、淡出 4 秒里带落点的网格不许拽退场（与不带落点的对照组比最大拍间，`toBeCloseTo(…, 6)`）、同值带新落点重发不许重锚）；`tests/flow/grid-audio.test.ts` 5 条（新增 1 条整链：真 `AISystem` + 真 `RhythmClock` + 真 `AudioEngine` + 假 WebAudio，杂兵开战场、她在交战之中接管，判据是"接管那一 tick 排出去的第一拍"落在帧序下限上、鼓点身份按落点在她的 3/4 里的位置给、钟走到那一拍时 `isBarStart` 与 `beatIndex % 3 === 0` 两侧一致，且**接管之前那一段的每个节点（含时刻）仍在序列开头**）。四文件 68 条全绿（14/28/21/5）。
- **两条第一版的红都不是生产行为，如实记**：①整链的时序（上面那条帧内事实，把 `0.02` 写成从发布时刻起算 ⇒ 差一帧）；②`rhythm-grid` 那"两支都走到"，第一版读作"抽的两个固定 tick 时刻运气不好"，真因是订阅里 `beatsPerBar` 从 `c.info()` 抄——`BeatInfo` 没有这个字段（它只有 `beatInBar`），于是拿到 `undefined`，`beatIndex % undefined = NaN`，两个计数器一条都进不去。**教训写在断言之前**：一条红的读数要先问"这条判据自己成不成立"，再怪被测代码。固定 tick 换网格的写法仍然换成了按位置**构造**时刻（同一类"两支走不全"在 KI-068 的 P5 已经付过一次账，这次只是提前防住）。
- **反向探针（6 刀，预言 6/6 兑现；对照组 68 条先跑干净；基线 sha1 `RhythmClock 1f0e42fe96`／`music 4e0145ff9e`，逐刀还原后复验字节一致）**：P1 发布侧不带 `enter` ⇒ 3 红（整链、unit 的自洽条、unit 的幂等条——三处都红在"没带落点"这句归因上）；P2 消费侧不看 `changed` ⇒ 1 红（同值重发那条，读数 `最大拍间 1.644s 对拍长 0.556s`）；P3 消费侧不看 `battleOn` ⇒ 1 红（淡出那条，`被落点插进一记 1.29s 的空档（对照组 0.71s）`）——**第一趟这一刀的预言是两条，只兑现一条，追出来的事实见上面那个守卫段**，P6 因此补进探针集；P4 消费侧整个不读落点（回到 KI-069 之前）⇒ 2 红（unit 的"跟到新头"、整链的第一拍，读数直接写出两边各是多少）；P5 只跟时刻不跟拍号 ⇒ 2 红（都是鼓点身份那句：该响驼鼓的响了军鼓、反之亦然）；P6 调度器那道 `battleOn` 门抬成恒真 ⇒ 2 红（"没起来就不排"这条，外加 KI-065 那格 `cut` 立刻掐——两道保护因此各有一位判官，不互相顶名）。
- **还欠**：实机腿与 §5.9.11 的「没做②」是同一格欠账（本会话那页仍被我自己写死的空转钉着，`__caesura` 读不到，而"落点准不准"最终要耳朵＋F4 面板拍号对照，本机不可得，KI-010 同因）；`AudioEngine` 没挂进 `__caesura`（`main.ts:104` 是模块内 const），要真机读过渡段的拍号得先补那一格（`main.ts` 在并行会话的写入面上）。
- 门禁：`tsc --noEmit` 0 错；`npm run build` 干净（7 chunk）；`node scripts/validate-data.mjs` 8 ERROR 全在并行会话在飞的 `dialogue.json`(7)／`quests.json`(1)，本批未碰任何数据表；全量 88 文件 / 1050 条用例 / **16 红**，按报告自己数出来的分布是 5 个文件（`bells` 7、`debug-panels` 2、`dialogue` flow 3 + unit 3、`slots` 1），全是 Phase 6-B 那条在飞输入的下游，音频/时钟/战斗/节拍四文件一格不红。顺带对账一条**读数口径**（不是新红了 6 个文件）：`scripts/test.mjs` 失败时印的那句把 `numFailedTests + numFailedTestSuites` 拼成「N 条用例 / M 个文件」，而这个 `M` 在报告里数的不是文件——同一份 JSON 里 88 个文件、含红用例的只有 5 个，且没有一个 `status === 'fail'` 的 file 条目。报数一律按报告自己数出来的那份分布说。第五道门 `npm run coverage` 按 KI-063"红跑不作数"拒绝落账 ⇒ 覆盖率地板没动。（**这一条口径本身已由 KI-072 修掉**：跑测器现在自己数含红文件、逐条点名，并把那份 JSON 报告留在原地——见 KI-072 行与 §6 前言。**上面那句「16 条用例 / 11 个文件」是当时脚本印出来的错读数，留着不改成 5：它是那次实测的记录，不是今天的口径。**）

### 5.9.13 玩家的挥砍吃遮挡：一把尺子不量两件事，但两把尺子可以量同一记（KI-070，2026-09-27）— 已实现

§5.9.6 把断音柱从两行手写判据变成一条线段，KI-014 那一批随后点名了三格未落，其中第二格是"玩家自己的挥砍不接这条通道"。这句话登记时是对的（理由也写在 `Occlusion.ts` 里：近战是扇形/盒形命中框，不是线段，把线段判据套到扇形上等于用一把尺子量两件事），但它留下的实际世界是：**同一堵 authored 墙，玩家投出去的长枪被拦下（§15.2 那句「长枪不再穿过掩体」），朝他打来的那一记被拦下，而他挥出去的那一刀穿墙伤人**——掩体成了一半真的东西，而那"一半"恰好对着玩家自己的进攻。

- **解法不是"给近战一条线段"，是把一件事拆成两件事**：扇形（`HitShapes.shapeHits`）继续独自回答"谁在这记挥砍里"（角度、内径、外径、高度带，一格没动），线段（`coverEatsLine`，与读者一同一个 helper、同一份名册、同一端口径 = 身体中心）只回答"刃到得了吗"，并且只以**否决**的方式参与。原来那句"不许套"因此没有被推翻，它被拆开：不许拿线段**替**扇形——这一格真的有一种实现方式是替（把 `shapeHits` 那两行删掉），而那种实现会让上面所有"挡住了"的断言全绿、同时把背后的人结到，所以**那条反向用例（没有墙、背对着她 ⇒ 打不到）是这一节的承重墙**，探针 P4 就砍在那里。
- **被吃掉的那一线不吃"一击一名"的名额**：否决写在 `markActionHit` 之前。理由是那句已经存在的话——"柱子挡得住这一击，挡不住这一招"——它在防守侧成立，在进攻侧同样成立；否则一记横扫会先被最近的那堵墙吃满整个名额，玩家对着开阔处的人也挥不出第二个人，那是把掩体从"几何"改成"消耗品"。判据写成两条腿：窄墙 + 两个敌人 ⇒ 结账的是**没被挡**的那一个（P1 为证）。
- **场地件吃同一条否决**（`playerHitsProps`）。这不是顺手，是不许出现"打不到墙后的人、却打得碎墙后的刺"——同一记挥砍、同一份名册，两件事不能一把吃一把不吃。P2 砍在这里。
- **顺手抓出一个读数缺陷（它属于 KI-014① 那一批，本批让它现形）**：遮挡那一支不消耗 `hitDone`，而判定窗有好几 tick，于是同一记被挡的招式在窗内**每一 tick 重报一次**"被挡"——实测一记恩希尔的 Tutti 撒 **12 团灰、响 12 遍**，玩家自己的 l1 是 7 团。那句话说的从来是"这一记被几何吃了"，不是"这一记的第 N 个 tick 被几何吃了"。修法是一个 `WeakSet<object>`（键 = 出手方此刻那一式的对象：同时出手的两个人各报各的，招式作废自己从表里掉出去，不需要谁去清）＋ `cueBlockedOnce`。玩家侧与敌人侧共用这条纪律，所以那条"只撒一团灰"的用例打的是**已有的**那条腿（落地时它红，实测 12）。
- **反向探针（5 刀，预言 5/5 兑现；对照组 73 条先跑干净；基线 sha1 `CombatManager b7c8dd0a45`，逐刀还原复验字节一致）**：P1 玩家那一线不否决 ⇒ 2 红；P2 场地件不否决 ⇒ 1 红；P3 去掉去重 ⇒ 2 红（7 团 / 12 团，读数直接写出团数）；P4 线段替掉扇形 ⇒ 3 红（本批 1 条 + props 那两条连带——那正是"一把尺子量两件事"的代价范围）；P5 把那条线的两端对调 ⇒ 2 红（"站进墙肚子里"翻成被自己的墙挡住，灰尘报在墙的背面）。**P5 第一刀切错了，这件事记下来**：原本切的是"端点从脚底量"（`height: 0`），**不咬**——那条线从脚底斜升到对方胸口，在走进 0.3m 矮墙的 z 板之前就已经离开它的 y 带（`lo >= hi` ⇒ 无交点），**脚底反而比胸口更不挡**。追下来这一格真正没被正面断言覆盖的是那条线的**方向**（谁的那一端算起点），所以刀换成端点对调。教训与 KI-068 的 P5 同一类：**一条"看起来显然会咬"的几何刀，要先量它咬不咬，再决定它钉的是哪句话**。
- 覆盖：`tests/flow/occlusion.test.ts` 新开「读者五」7 条（夹具自证 ⇒ 没有墙这一记确实落地／立墙 ⇒ 无伤害、无 `combat.hit`、只有墙**前沿**那一团灰／压到 0.3m ⇒ 照旧结账／玩家站进墙肚子里 ⇒ 不算被挡／没有墙且背对 ⇒ 打不到／窄墙两敌 ⇒ 结的是没被挡那个／被吃掉的一记只撒一团灰），`tests/flow/props.test.ts` +1（墙后的音刺不被击碎，拆掉同一堵墙就碎一格）。三文件 73 条全绿（occlusion 55 / props 7 / combat 11）。
- **没做（§78）**：①**回声影不吃这条否决**——`tickEchoes` 是"以记录下的那个接触点为圆心的环"，不是一条从人身上出发的刃，那一格没有"刃到得了吗"这条线；硬套等于把环形 AoE 改成逐目标线段，那是另一格裁决，不在本批偷做。②**没写进 `walls` 的天然岩壁仍然既挡不住箭也挡不住目光**（KI-014 未落格①，等 KI-009 的真几何/导航网格），所以"刀穿墙"只在**数据点名的**柱与墙上被修掉。③**手感**：被挡那一记现在只有一团灰 + 一声 `block_guard`，"刃被墙吃的重量感"（推刀、顿帧、专属那一声）没有规格，而本机没有可听的输出也没有可看画面的窗口（KI-010 同因）——这一格按 §78 是待评审项，不写"已兑现"。

- 门禁：`tsc --noEmit` 0 错；`npm run build` 干净（7 chunk）；`validate-data` 8 ERROR 全在并行会话在飞的 `dialogue.json`(7)／`quests.json`(1)，本批未碰任何数据表；全量 1058 条用例 / 88 个文件 条 / **16 红全在 Phase 6-B 那条在飞输入的下游**（5 个含红文件：`bells` 7、`debug-panels` 2、`dialogue` flow 3 + unit 3、`slots` 1），遮挡/近战/场地件三个文件一格不红 ⇒ 第五道门 `npm run coverage` 按 KI-063"红跑不作数"拒绝落账，覆盖率地板没动。

### 5.9.14 一次性节点的回收普查：一句从没被量过的声明，和它藏起来的那只失真器（KI-071，2026-09-27）— 已实现

`src/audio/synth.ts` 顶上第 4 行写着「所有节点即用即弃（onended 时断开）」。KI-065 那套假 WebAudio 把这张表 34 条音色全部跑过一遍、把 `audio` 包推到 100% 行覆盖，**却没有量过这句话**——它量的是相反的那一侧：「每个建出来的节点都必须有出边」（少一句 `connect` ⇒ 这条音色从来不响）。两句都是"节点的生命周期"，但一句的失败是静音、另一句的失败是**越长越脏**：接出去了，再也没人摘下来。TD-006 第二腿② 十周前就登记过后者（「`boss_roar` 每响一次留一只 `WaveShaper` 挂在输出上——它不是 source，没有 `onended` 可挂」），这一格把它从一句话变成一条判据。

- **判据写成普查，不写成针对 `boss_roar` 的一条用例**：对 `SFX_KEYS` 里每一条音色，"把它所有源的一生走完，此刻还连在输出总线上的连线必须是 0 根"。跑出来的第一件事就是它值这一趟：**全场只有 `boss_roar` 红**（1 声 1 根、放大腿 20 声 20 根），其余 33 条本来就干净。所以这张名册同时是"哪些音色有未回收的常驻节点"的读数，而不是一条修完就可以忘的回归。
- **修法的形状：给"没有 `onended` 可挂"的下游公共节点配一只寿命盖住这一声的哑源。** 那只失真器被两声 FM 共用，谁都不"拥有"它，所以谁都不该负责摘它——负责的是 `disposeAfter(ctx, out, until, nodes)`：一只 `ConstantSourceNode`，`offset` 恒 0 ⇒ 接在总线上什么也不加，但它是正经的可调度源，会按时报 `onended`；回调里把名单里那些节点**连同它自己**一起 `disconnect()`（不摘自己就是留一只新的垃圾，探针 P2 量的正是这一格）。
- **`until` 不吃第四个常数**：传的是这条音色**自己报出去的时长**（`boss_roar` 的 `life = 1.4`，也就是 `return` 的那个数）。它已经是 `AudioEngine.play` 归还声部配额吃的同一个数，而 KI-065 有一条判据「报出的时长盖不住最后一次 stop ⇒ 配额会提前归还」钉着它不早于任何一条链的收尾。**为什么不用 `setTimeout`**：那条挂的是墙钟，与音频时间轴不是同一条——后台标签页里它被节流到 ~1s 一次，而 §5.9.10（KI-067）撞过的正是"墙钟与音频钟的差"造成的成排补账。
- **量具为这一格补的三件事**（每件都只为了让一句谎可测，不是加功能）：`constantSource` 这一类节点；`disconnect()` 真的把自己的出边摘掉（不跟着摘，`live()` 就永远读不出"还挂着"）；`live(dst)` 与 `endAll()` 两个读数。P6（把 `endAll()` 改成不算 `constantSource`）红 2 条 = 普查的判据确实来自它走完了那条链，量具偷懒会当场暴露。
- **反向探针（6 刀，预言 6/6 兑现；对照组 133 条先跑干净；基线 sha1 `synth 2c4cbf61ca`／`fakeAudio 2bd6091872`，逐刀还原复验字节一致）**：P1 不给失真器收尾 ⇒ 2 红；P2 收尾时不摘哑源自己 ⇒ 3 红（两条普查 + 一条**既有的间歇红**，见下条）；P5 漏一句 `shaper.connect(o)` ⇒ 1 红，且红在 KI-065 那条"没接出去"上而两条普查反而绿 ⇒ **两侧各有一位判官，不互相顶名**；P6 见上；**P3（寿命算错：`until` 传 `t`，一开口就收）与 P4（`offset` 默认 1 = 总线上一段直流）按预言不咬——这是量具的边界，不是断言写松**：假 ctx 不模拟"此刻混音里还剩什么"，`endAll()` 是无条件兑现回调、不看 `stop` 落在哪一刻，也不读加到总线上的值。这两格只能实机，记在"没做"里，不拿普查的绿冒充。
- **P2 顺手抓到一条会自己红的老判据（这比本批的修法更值得记）**：`钟是钟：泛音比里必须有非整数比` 用手填容差 0.02 认 3.04 那个分音，而 `playBell` 每一敲带 ±8 cents 随机失谐，**3.04 × 8/1200 = 0.02027 > 0.02** ⇒ 从写下那天起这条判据就有概率自己红。40 趟实测：1 趟红在它上面（另一趟是本机那条 EPERM 的 Unhandled Error，用例全绿——按 §6 那条口径不计）。修法**不是把 0.02 调大**（那只是换个数字继续谎），是把抖动上限导出成 `BELL_CENTS`，生产侧 `(Math.random()*16-8)/1200` 从它算、测试侧容差也从它算 ⇒ 抖动日后变宽，容差跟着变宽，两边不可能再脱钩。修完再跑 40 趟：**40 趟 **0 红**——但不会再红的依据不是这 40 趟（0/40 只说明概率低于这趟分母看得见的量级），是**容差 ≥ 抖动上界从此是同一个常数的恒等式**：生产侧 widen 抖动，测试侧的容差跟着 widen，两边不可能再脱钩**。
- 覆盖：`tests/unit/audio-synth.test.ts` 84 条（新增 35：34 条逐音色普查 + 1 条 20 次放大腿）。`audio` 四个文件（synth / engine / music / keys）137 条全绿。
- 门禁：`tsc --noEmit` 0 错；`npm run build` 干净；`validate-data` 8 ERROR 全在并行会话在飞的 `dialogue.json`(7)／`quests.json`(1)，本批未碰任何数据表；全量 1093 条用例 / 88 个文件 条 / **16 红全在 Phase 6-B 那条在飞输入的下游**（5 个含红文件：`bells` 7、`debug-panels` 2、`dialogue` flow 3 + unit 3、`slots` 1），音频四文件一格不红 ⇒ 第五道门 `npm run coverage` 按 KI-063"红跑不作数"拒绝落账，覆盖率地板没动。
- **没做（§78）**：①普查读的是"边收回去了没有"，**读不出"什么时候收的"**（P3/P4 为证）；那只哑源在真机上会不会因后台节流晚收，本会话的页面仍被我自己钉着（`__caesura` 读不到），与 KI-068/069 的实机腿是同一格欠账。②`music.ts` 的常驻层（drone 三件 + `ambGain`）是**故意常驻**的，不进这条判据；那部分真正的账属于 TD-006 第二腿①（`AudioEngine.dispose()`），它需要一个有生产消费方的时机（`main.ts` 在并行会话手里），本批不拿"加了没人调的 dispose"充数（§55）。

### 5.9.15 区域环境声第一次有读者：一张床 = 一区，底噪与铃点都跟着脚下的区域换（KI-077，2026-09-28）— 部分实现

audio.md §1.2 那句「一区一张声床 / 跨区 8 小节 crossfade，先淡出旧区节奏层，再淡和声层，旋律层最后」此前是**纯文本**：`regions.json > music.ambience` 那 7 格有人写、**没有任何运行时读者**，而 `music.ts` 里写死了一份 drone 频率与一份石铃名册——写死的那一张是**雾语林**的（主音 65.41Hz），而玩家出生在**休垒**（该区的行是 87.31Hz）。后果不是崩，是"跨区什么都没换"：走到哪里底噪同一张，而表里那 7 个 id 是 §55 的死数据。

- **表住数据侧，不注进代码**：新增 `ambience.json`（7 行，与 `regions.json` 一区一行对齐）+ `schema.ts > AmbienceBed`（`layers[]`/`lpHz`/`breath`/`bell{scale,everySec,peak,hammerP}`）+ `data/index.ts > ambienceBeds`。发射方只发 id：`main.ts` 在**建图之前**发一次 `audio.music.ambience`（出生区），此后每帧比 `streaming.regionAt(player.pos)`，换了区再发一次。
- **id→行 的解析住在 `AudioEngine`，不在 `MusicLayer`**：引擎是"表 + 图"两头都看得见的那一层，`MusicLayer` 只收**行**。这不是洁癖——如果它自己 import 那张表，"跟着床走"就只能拿真表验，而真表写死哪一张都可能碰巧对（实现自证）。所以 `tests/unit/audio-music.test.ts` 喂的是文件里编的合成床（`BED_A`/`BED_B`/`BED_HALL`/`BED_CRYPT`），一条断言都不引用 `ambience.json` 的行。
- **两条时序腿**（都是"事件比图早"造成的，不是可选加固）：①`start()` 之前到的床先缓存进 `this.bed`，`new MusicLayer(...)` 时把它当第五个构造参数兑现；②`start()` 之后到的调用 `musicLayer.setAmbience(bed)`。未知 id ⇒ 解析成 null + **按 id 去重**的一句 warn（真到了那种行，宁响默认床也别全场静音）。
- **drone 拓扑为"能淡"而改**：`osc → 每条层自己的小把手 → 这一床共用的低通 → 这一床自己的层把手 → ambience 总层`。淡的是**每床一只**的那只把手，所以换床时已掷出的铃、战斗层、别的床都不受影响；呼吸 LFO 接在这只把手的 `gain` 参数上（WebAudio 里连到 AudioParam 的信号加在自动化值之上 ⇒ 淡变与呼吸可以在同一格上同时成立，旧代码把它接到全局 ambGain，那是"全场一起呼吸"）。石铃**绕过**把手，直挂总层——旋律不该被和声的淡出抹掉（KI-066「不抹历史」的同一条纪律）。
- **窗口 = 拍网问题**：`XFADE_BARS(8) × beatsPerBar × 拍长`，所以 §1.2 那句"8 小节"跟着当前网格走（区域 84/4 ⇒ 22.9s，悬钟大教堂 92/4 ⇒ 20.9s）。没有网格时按 `XFADE_NO_GRID_SEC = 1` 兜底并**只说一次**，措辞点名「换声床」（那是装配回归的读数，不是听感问题）。`applyBed` 只记下 `bedSwapAt = now + fadeSec`；到点由 `update()` 兑现三件事：回收已淡完的旧床（`teardown` 逐条 stop + 摘线）、把 `bellCfg` 换成新床的名册、**按新床的 `everySec` 重掷下一颗**。
- **数据门（`validateAmbience`）钉的是"这张床能不能被听出来"**：字段白名单对 `schema.ts`（KI-074 那套派生清单，不手抄）、`layers` 与 `lpHz`/`breath` 的存在性绑定（有层却没写 = 读侧只能哑着走）、`bell: null` 必须**显式**写（漏键与"这一区没有旋律事件"是两件事，后者是设计）、主音跨床相距 ≥50 音分（§1.2「一区一主音」，否则跨区听不出换地方）、音高名册去重、`everySec`/`peak` 区间，以及与 `regions.json` 的**双向**对账（有人指它但表里没有 ⇒ 进那一区永远没有底噪；表里有而没人指 ⇒ §55 死数据）。
- **覆盖**：`audio-music.test.ts` 40 条、`audio-engine.test.ts` 24 条，KI-077 这批在音频范围内新增 12 条（声部名单按表的**顺序**整体比、低通与床把手的接线、窗口长度、旋律层最后（名册 + 间隔两半）、到点才回收、同床重发不动图、`bell: null` 安静、`layers: []` 不建底噪、缺 `lpHz` 那行的 warn、开局缓存在图之前、图建好之后再发、未知 id 只说一次）。全量 **91 个文件 / 1148 条全绿**，`audio` 包 **100%（733/733 行）**。
- **变异探针 17 刀，第一趟 16/17**：A1–A6/B1–B4/C1–C6 全咬（预言逐条先写进探针文件，跑完对照；对照组未变异 165 条 + 校验器 0 ERROR/5 WARN 先立基线）。**A7 第一趟不咬**——把窗口兑现处写成 `this.nextChime = now + 5`，165 条里**一条都没红**。根因是测试自己：`BED_A.everySec [4,6]` 的中值恰是 5，而「旋律层最后」那条只点名册不点节奏，等于"间隔"这一格从没被量过。修法不是放宽预言而是**让两张床的间隔不同**（B 换 `[8,10]` ⇒ 中值 9）并补两条断言：窗口之后前三颗的间隔 = 新床中值的 0/1/2 倍、首一颗落在 `换床时刻 + 窗口 + 新床间隔`。改完 A7 红 1 条，读数是 `expected 33 to be close to 37`（33 = 旧床的 5s 节奏，37 = 新床的 9s）⇒ **重跑 17/17**。
- **实机腿（5199 隐藏页，`AudioContext.prototype` 包工厂）**：①出生区 `rg_resthold` ⇒ 手势建图后恰好 5 条振荡，`87.31/87.31/43.65/130.81` + detune `−5/+6/0/+2` + 呼吸 LFO `0.07Hz`，波形 `saw/saw/sine/sine/sine`，**与 `ambience.json` 那一张逐字段相等**（写死的雾语林 65.41 从此不再出现在休垒）；②把玩家放进 `rg_fellcarillon` 的 box 内、按节流步进 ⇒ 总线先出现 `enter rg_fellcarillon`，同一音频时刻建出新床 5 条（`98/98/49/146.83` + LFO `0.05`），而**旧床那 5 条此刻一颗都没停**（窗口还在走）；③窗口走完之后 `update()` 到点兑现：旧 5 条全部 `stop()`、摘线计数 +14，新床一条未动；④铃点跟床：休垒期间实测两敲间隔 **8.27s**（该床 `everySec [5,9]`），换床之后再敲两粒，基频 881.76/1041.61 落在换床那张名册（880.0/1046.5）的 ±8 音分抖动带内，间隔 **9.02s**。**听感本身仍不可评审**（KI-010 同因：这一层"对不对"是音色与响度的主观判断，本机没有能听的窗口）。
- **没做（§78，故本条记 Partial 不记 Implemented）**：①§4 那张 L2/L3 的**分层探索曲/区域 BGM** 没做——`regions.json > music.explore`（7 个 id）与 `music.battle`（5 个 id）此刻**仍然零运行时读者**， KI-077 只兑现了 L1（drone）+ L4（石铃稀疏事件）两格；②5 张床的 `everySec` 上限 9s，低于 §4 文档那一格写的「30–120s 稀疏事件」——挪进文档那一格是听感裁决（30s 起的话实机几分钟内听不到第二颗），故校验器报 **1 条 WARN** 并登记，不做静默改动；③Boss 主题/战斗曲随区换（同上，等 L2/L3）；④`AudioEngine` 没有 `dispose()` ⇒ 未知 id 那句 warn 的去重是"每台引擎一次"，测试文件里靠 `engineCount` 记账（TD-006 第二腿那条老账）。详见 KNOWN_ISSUES 的 KI-077 行。

### 5.9.16 区域探索曲第一次有读者：那条慢旋律只能派生自动机 `R-1`，而这句话从文档变成判据（KI-079，2026-09-28）

KI-077 收口时如实记了「只兑现 L1+L4，`music.explore`(7) 与 `music.battle`(5) 那 12 个 id 仍零读者」。这批拆掉其中的 `explore` 那一半：`regions.json > music.explore` 现在指向 `explore.json` 的一张行，进那一区时那条慢旋律（§2.1 四层里的 **L3 对位旋律**）跟着换。而顺带被机器化的，是 audio.md §1.2 那条**音乐宪法**——「一切旋律只许派生自 `R-1`（C–Eb–G–Bb），音高变形只有倒影/逆行两种，节奏变形只有扩张/压缩两档」：此前它是文档里的一句话，今天它是校验器的一段判据 + 类型层的一支判别联合。

- **度数的唯一主人是代码，不是数据**：`music.ts > MOTIF_R1 = [0,3,7,10]`，三种 `form` 全由它**现推**（`motifDegrees`）。`explore.json` 只写"哪一种变形"，不写度数——把度数抄进数据就是给同一句话配两个主人（KI-074 拆手抄名单拆的正是这种东西）。音高 = 该区 `rootHz` 抬 `MELODY_OCTAVES`(2) 个八度之后叠该度数；`beatsPerNote` 同时管**音距与音长**，而它是相对**当前区域网格**的拍数，所以 84BPM 的营地与 60BPM 的深窖写同一个 `2` 是完全不同的速度（这条是 KI-066「拍网只有一个主人」在旋律腿上的延续）。
- **形状靠类型，不靠校验器**：`ExploreScore = ExploreTonal | ExploreAtonal`，`form: null` 那一支只有 `id`+`form` 两格 ⇒「无调却写着 peak」这种半真半假行**在类型层就写不出来**。未竟厅（§1.2「C→无调」）就是这一支：读侧 `song.form !== null` 那道门让它一个旋律音都不排，而 `ambience.json` 那张名册里的半音铃点照掷。
- **解析仍然住在 `AudioEngine`**（与 KI-077 同一只手）：`id→行`、建图之前到的事件缓存进 `this.song` 并在 `new MusicLayer(...)` 当第六个构造参数兑现、之后到位的走 `setExplore`；未知 id ⇒ 保留上一张曲 + **按 id 去重**的一句 warn。`MusicLayer` 不 import `explore.json`，所以 `tests/unit/audio-music.test.ts` 喂的是文件里编的合成曲，一条断言都不引用真表。
- **两个真缺陷是这批的读数副产物**（都不是先想清楚再写的）：
  ① `bedSwapAt` 用 `Infinity` 当"没有窗口在走"的哨兵（不能用 0：假 AudioContext 的 `currentTime` 就从 0 起），而 `setExplore` 最初写的是 `this.bedSwapAt > this.ctx.currentTime` ⇒ 从第一帧之后**每一次换曲都被当成"窗口内"**，押进 `songPending` 等一次永远不会来的兑现，跨区旋律永远念的是出生那一区。修法是把判据换成 `Number.isFinite(this.bedSwapAt)`，并把这条钉成用例「开局那次窗口兑现之后再换曲 ⇒ 仍然当场换」（变异探针 M1 把那一行改回 `>` 之后**恰好红两条**：音乐层一条、引擎那条「图建好之后再发曲」一条）。
  ② 倒影取负写成 `-d` 会给主音留下 `-0`，而度数是要拿去比对的数 ⇒ 改成 `0 - d`；证人仍是 `motifDegrees` 那条（vitest 的 `toEqual` 分得出 `-0` 与 `+0`，M2 实测红 1 条）。
- **「旋律层最后」的实现只有一条顺序**：换床开出的 crossfade 窗口没走完时，新曲押在 `songPending` 里由 `update()` 到点兑现；没有窗口在走就当场换。这个顺序**在组合根**：`main.ts` 两处发射点都是先 `audio.music.ambience` 后 `audio.music.explore`，反过来写两句都不报错、只是旋律抢跑 ⇒ 由一条源码门钉住（`main.ts` 全场恰好四行、顺序 `ambience,explore,ambience,explore`）。每帧最多排**一个**音（不像战斗层那样 `while` 补排）：调度落后时"把欠的拍补回来"在这里听感上是把过去十秒砸进这一帧，而探索曲没有拍点要对齐，代价换成"一串音被跳过"。
- **判据搬进 `scripts/explore-rules.mjs`（+ `.d.mts`），校验器只当那张嘴**。理由与 `report-reds.mjs`/`test-scope.mjs` 同一个（KI-072/078 先例）：`validate-data.mjs` 一被 import 就去校验真表并 `process.exit`，而"喂一行非法数据、看它拒不拒"这一半在测试里做不了——本沙箱连 spawn 子进程都被宿主拒（KI-075 那条 `skipIf` 就是这件事的读数）。搬出来之后门禁与 `tests/unit/explore-table.test.ts`（21 条）**读的是同一段代码**。`rootHz`/`peak` 的可闻带刻意留下：那三种说法由 `report.num` 全场统一管，搬过来等于配第二个主人（源码门把这一格钉在原地：校验器里不许出现 `EXPLORE_FORMS.has`/`MIN_ROOT_CENTS`，也不许丢掉 `.rootHz`, `row.rootHz`）。
- **数据门钉的六件事**：字段集合落在两支之一（名单由两支**现拼**，`EXPLORE_FIELDS` 的右边不许出现字段名字面量）、`form` 只有那三个词或显式 `null`、`beatsPerNote` 只有 1/2/0.5、`form:null` 的那一行四格音高参数一格都不许多、主音跨区相距 ≥`MIN_ROOT_CENTS`(50) 音分、与 `regions.json` **双向**对账 + 一区一张曲（两区共用一张 = §1.2 的承诺破了，那条红记在 `regions.json` 名下）。
- **那条 `music.battle` 的 WARN 是登记，不是豁免**：5 个战斗曲 id 指向一张**还不存在**的表（战斗音乐今天只有一张全局 ostinato 层），判 ERROR 等于逼下一批偷偷造一张没人奏的表来让门禁闭嘴。它的计数**从 regions 现算**，所以不是手抄名单、不需要"销账"——谁建了 `battle.json` 并接上读者，这条连同话术一起消失。校验器读数因此从 5 WARN 变 **6 WARN**。**（2026-09-28 收口）**：KI-080 建了 `battle.json` 并接上读者，这一条连同话术一起消失（`validate:data` **6 WARN → 5 WARN**）；上面那句“从 5 WARN 变 6 WARN”是当时的读数，保留不改。
- **覆盖**：`explore-table.test.ts` 21 条（accept 侧 4 / refuse 侧 16 / 单一主人源码门 3）、`audio-engine.test.ts` 30 条（KI-079 那 6 条含源码门）、`audio-music.test.ts` 55 条。refuse 侧每条臂都在**合法那一行上只改一处**，并断言"红恰好一条、红在那一格"，另留一条对照臂（什么都不改 ⇒ 零条）；三张词表各挑一个"表外那个词"，并有一条门管着"那个词哪天变成合法值就得换词"，否则那条臂会悄悄空转。
- **变异探针 10 刀**（预言先写进探针文件；未变异对照先立基线：四文件 117 条 0 红；逐刀按字节还原并复验 sha256，全程不碰 git）：**单测抓到 9 刀**——M1 窗口哨兵 2 红、M2 `-0` 1 红、M3 读侧不吃 `beatsPerNote` 3 红、M4 按身份短路失效 1 红、M5 孤儿行 1 红、M6 阈值归零 1 红、M7 共用曲 1 红、M8b 拔掉 `report.num` 1 红（红在那条源码门上）、M9 `main.ts` 那一对发射点倒过来 1 红。**唯一一条单测没抓的是 M8a**（把那条诚实登记的 WARN 报成 ERROR）：它由**校验器那一趟**说话——`总计：1 ERROR / 5 WARN`、exit 1。这条不是漏网，是读者本来就该在那一侧：单测判的是"这一行合不合法"，而"合法但宪法之外"这条登记只对跑起来的门禁有意义。
- **两条预测要如实报**：① M3 预言"引擎腿 0 红"，实测 **2 红**（「开局 explore 不丢」与「未知 id 保留上一张曲」都断言了固定秒数内**排出的音集合**，节奏一变那两个读数就变）⇒ 引擎腿其实是 `beatsPerNote` 的第二位证人，我的预言过严而不是过松，缺陷侧无；② 探针文件里那条 `总计：…` 的正则第一次跑**解析失败**（`.*$` 在没有 `m` 标志时不认尾随换行），于是 M8a 第一趟印的是 `ERROR -1`——**读不到不等于 0**，修成 `/总计：[^\r\n]*/` 之后才量出上面那句 `1 ERROR / 5 WARN`。
- **逐音读数的测量床不许带铃（本批改掉 6 台 rig 的原因，这是测量条件不是洁癖）**：`melodyNotes` 认一个音靠的是"这一批新建节点里只有一条振荡"，而一记石铃在同一帧是 ≥7 条 ⇒ 铃与某个旋律音撞上同一帧，那个音就从读数里**消失**，表现是音距凭空翻倍。KI-079 第一版红过一次（「0.5 拍/音的理想音距 0.400s，实测 0.900s」＝少认一音的双倍间距 0.800s 再加帧格与调度前瞻的零头），但**那次随机红的概率我没量到**：把 `beatsPerNote` 那一条单独换回带铃的 A 床、去掉栅栏连跑 8 遍是 **0 红**，所以"带铃的床必然吞音"这句话不许照着写。机制由一条**确定性的反向对照**钉住（`把铃钉成每帧一颗`）：`everySec:[0.05,0.05]` ⇒ 120 帧里 119 帧有铃，唯一没铃的就是第一帧（`music.ts:417` 在窗口兑现那一拍把 `nextChime` 推后一格，所以第一帧末尾那道 `now >= nextChime` 不成立），而图上有 **8** 条名册音、`melodyNotes` 只认回 **1** 个（首音）⇒ 吞音的是认法，不是调度，该修的是测量床不是 `music.ts`。逐音读数一律走 `BED_CRYPT`（`bell: null`）+ `songOfQuiet` 那道栅栏，栅栏红的红话说的是"床不合格"而不是"生产少排一个音"；铃与旋律共存仍由 `form: null` 与"没收到拍网"那两条量，它们吃的是**铃那一侧**的认法（一敲 ≥6 条振荡，容得下多出来的一条），所以那两条仍用带铃的 A 床。
- **实机复测（§77，真 Chromium + 真 WebAudio，`npx vite --port 5181 --host 127.0.0.1`）**：`__caesura` 不暴露 `audio`（`main.ts` 里那是模块内 const），所以沿用 KI-065 那套装具——把 `AudioContext.prototype.createOscillator` 包一层、记 `frequency.setValueAtTime(值, 时刻)`，真机就与假机同一台量具；步进一律 `tickFrame(1/60)` 配 `setTimeout(40ms)` 节流（不节流会把 GameTime 灌到音频钟前面，KI-065 那条错结论就是这么来的）。三组读数：
  ① 出生区 `rg_resthold` 排出 **349.24 / 415.32 / 523.27 / 622.27 Hz** ＝ `87.31×4` 上叠 `2^{[0,3,7,10]/12}`（`MOTIF_R1` 的 prime），音距 1.43–1.50s ＝ **2 拍 @84BPM**（`beatsPerNote:2`）；
  ② 把 `player.pos` 放进另一区的 box ⇒ 真路径自己发了 `enter rg_brokenbar_camp`（console 里读到的，不是我手工 emit 的）：床与铃点**当场**换（新铃基频 698.45 落进 `mus_brokenbar_amb` 那份名册），旋律仍唱出生那一区的 prime 线，直到音频钟 102.9 → **125.75** 才换成 466.16 / 391.99 / 311.12 / 261.62 ＝ `116.54×4` 上叠倒影 `2^{[0,-3,-7,-10]/12}`，音距 0.38s ＝ 0.5 拍 @84BPM。**那 22.85s 就是 §1.2「跨区 8 小节 crossfade」在 84BPM/4/4 下的 22.857s**（差 0.007s = 帧格），也就是「和声先换、旋律层最后」这句话第一次被时间量出来，而不只是被顺序断言；
  ③ 钉在 `rg_unfinished_hall`（`form: null`）里：押着的旧线在窗口内继续按**新区的拍**走（音距变 0.35s ＝ 0.5 拍 @92BPM——`beatsPerNote` 是相对当前网格的拍数，所以"押着的曲 + 新的拍"是设计的直接推论，真机上看得见），窗口兑现（末记 250.07s）之后连续 10 秒 **零条**带音高的振荡，而该区铃间隔本就是 `[40,50]`s ⇒ 那句安静是数据说的，不是探针坏了。这一段只敢说"同量级"不敢说"相等"：`enter` 那一刻我没同时打 ctx 点，所以窗口长度只有②那一条能报成 0.007s 精度。全程 console **0 error / 0 warn**。
- **门禁（本批最后一次全量实测，2026-09-28）**：`npx tsc --noEmit` 0 error；`node scripts/validate-data.mjs` **0 ERROR / 6 WARN**（那 6 格里 KI-079 新登记的就是 `music.battle` 一条）；`node scripts/test.mjs` **93 个测试文件全部跑到（磁盘名册 93）、1208 条用例全绿**（本批从 1207 增到 1208，多的就是上面那条反向对照；`audio-music.test.ts` 单跑 55 条 0 红）；`npm run build` ✓ 3.25s。`npm run coverage` **本平面红**：总行覆盖 85.09% < 地板 87.36%，按包红的四格是 `quest` 92.46<97.75、`tools` 65.27<67.29、`ui` 70.93<73.32、`world` 83.62<87.10——这四包**一行都不在本次改动面上**（本批只动 `src/audio/*`、`src/data/*`、`src/main.ts`、`scripts/*` 与 tests；本批所在的 `audio` 与 `data` 两包读数是 **100.00%**），那是共享工作区里别人在途的 src 文件把分母拉下去了 ⇒ 按第五门既有口径**不落账、不 `--bless`**，只把读数与归属如实贴在这里。


### 5.9.17 区域战斗档第一次有读者：`regions.json > music.battle` 那 5 个 id 从「指向一张不存在的表」变成有行有读者（KI-080，2026-09-28）

- **一句话**：战斗层从此**只奏数据里那一行**。`music.ts` 里那份写死的 `OSTINATO` 八格是这张表里最后一个音高副本：它把 §1.1「战斗遭遇 = 主音不变」写对了一件事（那个 C 是全局的），却把「低音走哪条线」钉成了唯一答案，于是 `music.battle` 那 5 个 id 从落地那天起就没有读者。
- **两样东西分开住**：主音留代码（`music.ts > BATTLE_ROOT_HZ = 65.41`，全局 C2，跨区不许变），**线本身进数据**（`battle.json > pattern`）。所以这张表里 `rootHz`/`bpm`/`beatsPerBar` **不是还没加，是不许加** —— 校验器把它们点名叫出来。
- **`pattern` 是折起来的一格**：一项 = 「动机第几音 × 第几档八度」，解码 `battleOstinatoHz(cell)`（`deg = cell % MOTIF_R1.length`、`oct = floor(cell / MOTIF_R1.length)`）⇒ §1.2「一切旋律只许派生自 R-1」在**形状上**成立：违宪的音在这张表里没有写法。代价如实说：上界 `MAX_PATTERN_CELL`(7) 是按「四音 × 两档」算的，动机增减一个音它就换意思 ⇒ 有专门一条用例把 `MAX_PATTERN_CELL + 1 == MOTIF_R1.length × PATTERN_OCTAVE_TIERS` 对账。
- **判别联合管「没有音乐」那一档**：`BattleScore = BattleTonal | BattleSilent`，§6.3 万籁那一格是 `noMusic: true` 的**显式声明**（「什么都不排」是数据说的，不是「少写几格」），写了它就不许再写 `pattern`/`bellEveryBars`。
- **钟的周期跟着网格走**：`i % (bellEveryBars × beatsPerBar)`，所以同一份 `2` 在 3/4（奥斯塔拉）与 4/4 下是两种间距 —— 与 KI-066/079 同一条纪律：拍长只有 `RhythmClock` 一个主人。
- **读者与发射点都是同一只手**：`AudioEngine` 认 id→行、建图前缓存、认不出保留上一档并单独说一次（与 `ambience`/`explore` 共用一个解析形状）；`main.ts` 开局与跨区各发一条。**战斗档不吃 crossfade 窗口**（它只在交战时被奏出来，§1.2 那句「旋律层最后」管的是环境总线），所以 `main.ts` 那一格里它排在 `explore` 之后不影响任何语义。
- **判据搬进 `scripts/battle-rules.mjs`（+ `.d.mts`）**：与 KI-072/078/079 同一条理由（`validate-data.mjs` 一被 import 就去校验真表并 `process.exit`，喂非法行这半在测试里做不了），门禁与 `tests/unit/battle-table.test.ts` 读同一段代码。门钉四件事：字段落在两支之一、`pattern` 每一项是 0..7 的整数、逐格相同的两行 = 同一张行抄两遍（§55）、与 `regions.json` **双向**对账。
- **跨区共用一行在这里合法**（与探索曲「一区一张」相反）：§1.1 写的就是主音不变，所以共用是设计而不是脏数据 —— 有一条专门喂「两区指同一行」并断言零条的用例，把「允许共享」钉成**选择**而不是判据漏了。
- **迁移不改声音**：默认那一行 `mus_shared_battle` 的八格逐格对上被删掉的旧常数（实测最大差 < 0.2 音分），那是一条专门的回归断言。
- **门禁（2026-09-28）**：`tsc --noEmit` 0 错；`validate:data` **0 ERROR / 5 WARN**（本条把 KI-079 登记的那条 `music.battle` WARN 销掉）；`node scripts/test.mjs` **96 文件 / 1258 条全绿**。
- **没做**：鼓型与各家峰值留在 `music.ts`（五档真数据那一格全同 ⇒ 一列没有信息量的数据就是 §55 说的死数据）；§2.2「同一区域的探索/战斗两档」的 **BPM 数据形状**仍未做（拍长归 `RhythmClock`）；听感不可评审（KI-010）。

### 5.9.18 乐章 IV 页的点亮源改判：一页要么吃实物、要么被事件见证（KI-037 第四步，2026-09-28）

- **改判的不是数值，是「解锁源有几种形状」**。乐章 IV（`mvpage_rest`）原先的 `unlock` 是 `{ item: it_resonance_core, count: 1 }` —— 它要玩家交出**第三颗**振源核才翻开。问题是：`loot.firstKill` 一共只发三颗核，而 I/III 两页各吃一颗 ⇒ 想让 IV 也吃实物，要么让 I/III 永远点不亮，要么凭空造一个「第四颗核」的假经济（都是把 §55 的账搅浑）。所以改成「**被世界事件见证**」：`{ flag: 'flag.hersil_felled' }`（写方是已存在的 worldstate 规则 —— 本作里只有一个人写旗；读方新登记进 `collectFlagUsage`，于是「读它但没人写」的假 ERROR 不会再咬这一格）。
- **形状进类型与门禁**：`MovementPage.unlock` 变成二形 `{ item, count } | { flag }`，validator 硬钉「至少写一个、至多写一个」（同时写两种 = 错）；`MovementBook` 新增 `hasFlag`（缓存 `world.flag` 广播，与交互物/流送同一条纪律）与 `canUnlock`（**按钮置灰与 `unlockPage` 共用同一个答案** —— 两处各写一遍就是两个主人），旗标页不扣任何实物、拒绝理由新增 `'flag'`；`Stakerite` 按形渲染（实物页 `have/need`、旗标页「已见证/未见证」）。
- **守卫**：`boss-rewards.test.ts` 那条「拿三颗核点不亮这一页」改成了「这一页的解锁源是旗标」（口径变了，断言跟着变而不是删掉）；`movements`/`echo-tacet`/`timbral-affix`/`passives` 四个流测的装配助手各自多一条「旗标页先发一次 `world.flag`」的分支；`worldstate.test.ts` 把谱册页算进旗标读方对账。

---

## 6. 测试策略（需求 §58/§59/§77）

> **跑测走 `scripts/test.mjs`（`npm run test`），它带覆盖核对**。原因：本机环境里 vitest 会因
> `EPERM`（写 SSR 临时缓存被拒）**静默少跑几个测试文件**——报告里照写 "N passed"，少掉的那些不红。
> 一个会漏跑文件的门禁不是门禁（坏测试可以长期被跳过而没人发现）。所以：
> ① 用 `--pool=forks` 降低发生概率；② 用 JSON reporter 拿"这次真正跑了哪些文件"，与磁盘上的
> `tests/**/*.test.ts` 对账，**对不上就重跑（最多 3 次）**，全都不齐才失败并打印差集；
> ③ **退出码非零不等于用例失败**——那条 EPERM 会被记成 Unhandled Error 让 vitest 退 1，而用例全绿，
> 所以判定**只看报告内容**与覆盖差集：红没红由报告里数出来的 `status === "failed"` 决定，不看进程退出码。想看原始输出用 `npm run test:raw`。
> **红的时候它自己点名（KI-072）**：数与点名住在 `scripts/report-reds.mjs`（纯函数 + `.d.mts` 声明，`tests/unit/gate-report.test.ts` 拿合成报告钉着），
> 输出形如「N 条 / M 个含红文件」+ 每个文件哪几条 + 每条的第一行读数，并把那份 JSON 报告留在原地不删。
> ⚠️ 这里从前印的是 `numFailedTestSuites`，而它**不是文件数**（同一份报告实测：88 个文件里含红用例的只有 5 个，它报 11）——
> 「几条用例」当年是对的、「几个文件」从来是错的。两种红也从此分道：断言红逐条点名，"用例全绿但有失败 suite"（import / teardown / 本机 EPERM）另印一句方向。
>
> **带范围的跑法核对的是带范围的期望集（KI-078）**：上面那句"与磁盘上的 `tests/**/*.test.ts` 对账"从前是**无条件**的，
> 于是 `npm run test:flow`（= `node scripts/test.mjs tests/flow`）拿这一趟跑到的 48 个文件去对整份名册（今天 92），**结构性必红**，
> 而它给的建议「改用更小的范围」本身就是同一条会失败的命令。现在期望集 = 名册 ∩ 位置参数，匹配语义**照抄 vitest 的 `filterFiles`**
> （win32 折斜杠 ⇒ 对**仓库相对**路径做**大小写不敏感的子串**匹配 ⇒ 尾斜杠那一格是"那一层下面"），判据住在
> `scripts/test-scope.mjs`（纯函数 + `.d.mts`，理由与 `report-reds.mjs` 同一个：`test.mjs` 一被 import 就跑整套测试，住在里面等于没有证人），
> 测试在 `tests/unit/test-scope.test.ts`（18 条：纯函数 + 真名册对账 + 两条源码门）。
> **一条不许退让的安全性质**：圈空的筛选器（一个文件都没圈到）在**开跑之前** `exit 1` 点名，**不许**洗成"那就按全量判"——
> vitest 遇到圈空的筛选器会一个文件都不跑，而"该跑 0 个、跑到 0 个"读起来就是全绿。复刻语义与 vitest 的**已知差异只有一处**，
> 且是被删掉的那一条：它那边"筛选器是绝对路径 ⇒ 直接比前缀"，我们这里没有（跑测器永远以仓库根为 `dir`，折成相对后同一条判定接得住；
> 变异探针摘掉它零红 ⇒ 那行没有证人）。**已知会误判的那一格**：`--shard`／`--project` 这类真的会收窄 vitest 自己名册的选项
> 只按"吃值"处理，没跟期望集对账 ⇒ `--shard=1/2` 会被判成漏跑（详见 KNOWN_ISSUES 的 KI-078 行「没做①」）。


### 6.1 Vitest 单元测试（纯逻辑层，毫秒级）

> **对账（2026-09-26）**：下面前四条**按文件名读全部不存在**——`combat/damage.test.ts`、`combat/stamina.test.ts`、
> `rpg/inventory.test.ts`、`rpg/progression.test.ts` 从未以这些名字落过盘。它们承诺的断言是真的，只是按"系统"而不是
> 按"模块"落了盘：伤害管线在 `tests/flow/{ranged,gate5,combat}.test.ts`，体力在 `tests/flow/{combat,boss,elite}.test.ts`
> 等一批里，背包/强化在 `tests/unit/rpg.test.ts` 与 `tests/flow/{shop,loot-rules,timbral-affix}.test.ts`。
> **真实清单（2026-09-27 重数）：86 份 `*.test.ts` = `tests/unit/` 39 份 + `tests/flow/` 47 份**（`find tests -name '*.test.ts' | wc -l`），
> **重数（2026-09-28，KI-078 那一批之后）：92 份 = `tests/unit/` 44 + `tests/flow/` 48，同一趟门禁读数 1166 条用例全绿**；
> 上面那句 86 份是 09-27 的记录，留着不改（它是那一次的实测，不是今天的口径）。
> 另有 `tests/support/fakeAudio.ts` 一台**量具**（假 WebAudio，不是用例）。本轮实测 1013 条用例（干净快照 `14796a0` + KI-065 那批 8 个文件全绿）。
> **这句数字每次引用之前要重数**：上一版写的是"74 份 / 811 条"，那是 2026-09-26 的磁盘状态，两天里长了 12 份文件。逐文件清单不在本文档里维护（会漂），跑 `npm run test` 的覆盖核对那一行就是权威。
> 下面只保留**当初的命名与现在的载体对不上、且值得记住语义**的那几条。
- `combat/damage.test.ts`、`combat/stamina.test.ts`、`rpg/inventory.test.ts`、`rpg/progression.test.ts` → **未以此名落地**，语义见上
- `tests/unit/movements.test.ts`（Phase 5-C2，16 条）：谱册状态层——点亮吃什么/先验后扣、升级阶梯到表尾报 `max`、
  两槽门禁（页要先亮、槽要先开、槽号越界）、`loadout()` 按等级合成、脏档（假页/越界等级/未开槽）一律丢弃
- `tests/flow/movements.test.ts`（Phase 5-C2，17 条）：真帧数据出手——同种子把"不吃武器强化""差值恰为表里真伤""过载每层 +4%"
  钉成精确等式；错拍步位移=BPM 无关；`multi: 8` 只结 8 个不同受害者；起手式只兑一记；冷却按槽；闷音与过载封锁；v4 往返与 v3 迁移
- `tests/unit/save.test.ts`（原计划名 save/migration.test.ts，按仓库既有命名落在 unit/）：
  往返 deep-equal、清剿记录跨会话生效、CRC/magic/version 三道闸、主档损坏→回退 .prev、
  写到一半被 kill⇒主键位仍是完整旧档、迁移链 v1→v2 与「缺步骤必须抛错」、触发器同帧合并与失败发声
- `tests/flow/gate5.test.ts`（Phase 5-C3 G5 出口验收，5 条）：**只从输入帧与 `entity.died` 事件两个入口进出**的一条不断链——真轻击打死 → 掉落入包 → 升音级 → 遗箱拾取 → 换装 → 强化 +1 → 存档 → 另一份世界读档 ⇒ 成长快照逐字段相等 + `mods()` 数值串相等 + 手里还是那把剑；再加"掷骰位置跟档走"（读档后续掉的一串 == 不断档那一串）、"杀进程重开只亏上一个检查点之后那一截"、力/律两条建卡线的同种子遭遇对照与一条纯 `scaling` 标尺断言
- `tests/unit/loot-pity.test.ts`（Phase 5-C3，12 条）：两条 pity 规则各自的语义（容器保底「第 N+1 次必中」、大保底「每第 every 件顶到地板档」）、它们**互不替换**（容器那条不许动稀有度）、计数入档/老档留空、同种子同轨迹，以及掉落表数据的自检（roll id 表内唯一、`pity` 必带 `chance`、隐藏房给得出装备/乐谱/铭文档）
- `tests/unit/worldstate.test.ts`（Phase 6-A，9 条）：规则语义（第一次真弹反才立、别人被弹不算、按 `dataId`/`interactId` 精确匹配、`ok=false` 不立、立过就不再播一次报、`dispose` 之后不再监听、`writerOf` 反查）+ 真表形状 + 一条"每条规则立的旗标都有读方"的数据对账
- `tests/flow/hidden-rooms.test.ts`（Phase 6-A，5 条）：三条**从生产入口进**的可达链——真弹反 ⇒ 音壁裂开并连带立起通往沉唱堂的旗 / 敲响落钟 ⇒ 钟腔封存点可撬并掉出晶声档以上装备 / 杀死奥斯塔拉 ⇒ 沉唱堂那只 T2 箱不再锁着；外加"后果跟着存档走"（读档后端开过的不能撬第二次）与区域解锁吃同一套广播
- `tests/unit/arch-boundaries.test.ts`：逻辑层不得 import 表现层（Phase 5-C3 起把 `rpg/`、`save/` 也补进了扫描清单——之前这两个目录不在闸门范围内）
- `ai/perception.test.ts`：loudness/距离→suspicion 计算、拍隙可见性（幽灵八）**——已落地但换了载体**：拍隙那半写在 `tests/flow/phantome.test.ts`（相位是跨系统的读感，flow 层才测得动），感知计算仍散在各 flow 的距离/响度断言里；独立 perception 单测等到 Phase 6 的声呐/耳朵机制再合。
- `tests/flow/bossshow.test.ts`（Phase 5-C2b，6 条）：§16 入场演出与胜利序列的玩法流——拍长按**她自己的**拍速换算的精确等式、整窗零出手零位移（且中段一记弹体照样掉血、演出不被挨打断掉）、只演第一次照面、`boss.defeated.holdTicks`、`cut` 恰一条 + `rawScale<1`、屏息未完不落收尾字
- ~~`data/validate.test.ts`：全部 JSON 通过 Ajv schema~~ **实际落地的是 `npm run validate:data`**（`scripts/validate-data.mjs`，零新增依赖，见 KI-015）：id 唯一、交叉引用存在、区间与帧表单调、以及设计要求的必填组合；vitest 里没有这条（跑法不同）。它已被证明能抓出真 bug（KI-015 首跑），本次新增的"Boss 两格齐全"也是同一类约束
覆盖率门槛：逻辑核心包（combat/rpg/save/quest）行覆盖 ≥80%。

> **对账 v1（2026-09-26）**：这条门槛**当时从未被测量过**。仓库里没有 `@vitest/coverage-*`，也没有 coverage 脚本
> （零新增依赖优先）。今天真正在执行的替代度量是另一件事：`scripts/test.mjs` 拿 JSON reporter 的"这次真跑了哪些文件"
> 与磁盘上的 `tests/**/*.test.ts` 对账，对不上就重跑、最多三次后失败并打印差集——它保证**每个测试文件都被跑到**，
> 不保证**每行代码都被执行**。两者不能互相冒充，所以"行覆盖 ≥80%"按 §78 应读作**未执行的门槛**。
>
> **对账 v2（KI-063，2026-09-27）：这条门槛第一次被真量了一次。** `npm run coverage`
> （`scripts/coverage.mjs` + devDependency `@vitest/coverage-v8`，与 vitest 同版）跑 v8 provider，
> 口径是 `--coverage.include=src/**/*.ts` 加 `all`——**没被任何测试 import 的文件也算进分母**，
> 否则"零覆盖"那一格会被 istanbul 静默丢掉，而那正是这条门要抓的东西。
> **HEAD 快照 `af45535` 上的实测：行覆盖 81.84%（8301/10142 行，72 个 src 文件，80 个测试文件全绿）。**
> 三条限制要跟着这个数字一起读，否则它又是一句"表里有 = 项目里有"：
> ① 量的是**整个 src/ 的总行数**，不是上面那句按包切的 80%——`combat/rpg/save/quest` **各自的**数字仍未逐包执行；
>    承担"每个模块至少被碰到一次"这一半的是**零覆盖名单**（见下），不是那条按包门槛。
> ② 行覆盖是**被执行的行数**，不是"被断言的行为数"——一行 `x = x + 1` 被跑过一百次也不产生任何保证。
> ③ 数字先于阈值，所以**地板由实测倒着钉**：`scripts/coverage-floor.json` 写死 `linesPct: 81.84` 与六格零覆盖名单；
>    低于地板 = 红、名单变长 = 红、覆盖涨了 = 只提示（门不惩罚进步，但要 `--bless` 才把新地板落盘）。
>    这条**不挂进 `npm run check`**：共享工作区里别人写一半的模块会把 check 变成我的红；
>    它的定位是**第五道门**，每批收尾自测跑一次，且**红跑一律不作数**（v8 provider 默认 `reportOnFailure: false`，
>    脚本先看测试报告再看读数，顺序反了就会把"这次跑红了"误报成"量具坏了"——本批第一次探针就是这么撞上的）。
> 那六格零覆盖今天是谁：`src/main.ts`（装配层，只在浏览器里活）、`src/tools/CombatDebugger.ts`（DEV 面板）、
> `src/ui/DialogueBox.ts` 与 `src/world/PropVisuals.ts` / `src/world/PlaceholderArena.ts`（DOM / three 表现层，headless 没有对象可断言），
> 以及**一个真缺口**：`src/player/LockOn.ts`——它是纯逻辑（目标筛选与打分），却既没有测试、又写着死 `range = 35` 与 `2.2 / 0.06 / +3` 三个权重（§55 双重不符合），登记为 TD-005。
>
> **对账 v3（KI-064，2026-09-27）：上面限制①那句"按包的数字仍未逐包执行"今天销账。** `scripts/coverage.mjs` 的 `measure()`
> 现在按 `src/<目录>/` 归组（散在根上的记 `(root)`），判据从三条长成七条，新增的四条是：
> **④任一包 < 该包地板 ⇒ 红**（总覆盖会把一个小包的回退藏进另一个包的增长里）；
> **⑤核心包 < `CORE_MIN` ⇒ 红，且与地板无关**——地板是"只许涨"的棘轮，而 `≥80%` 是本文档对玩家的承诺，两者不是一个东西：
> 只钉棘轮的话"某核心包一开始只有 60%、于是地板也钉 60%"照样绿，而那正是上面这句话说的不合规；
> **⑥量到没进地板的新包 ⇒ 只提示**（新建目录不会自动获得下限，这句"要落账"必须说出口）；
> **⑦地板里列着的包今天没有可计行的文件 ⇒ 红**（目录改名/删除不许让一条门槛悄悄失去对象）。
> 名单与阈值住在**脚本常量**（`CORE_PACKAGES` / `CORE_MIN`）而**不进地板文件**：地板由 `--bless` 重写，承诺不该跟着量具一起漂；
> 有一条用例把两边钉成双向对账（改脚本或改本节这句话，任一侧都红）。包的 pct 由**加总后的 covered/total 现算**再向下取整，
> 不是把 istanbul 每个文件各自四舍五入过的 pct 再平均一次——那会读出一个统计上不存在的数（用例里 `ui` 放 2/3 与 1/6，必须读 33.33%）。
>
> **HEAD 快照 `dac9d68` 的逐包实测**（81 个测试文件 / 907 条全绿；总行覆盖仍是 81.84%；★ = 上面那句话点名的四个包）：
>
> | 包 | 行覆盖 | 已执行/总行 | 文件 |
> |---|---|---|---|
> | ★ `combat` | 99.35% | 1238/1246 | 8 |
> | ★ `quest` | 97.75% | 349/357 | 4 |
> | ★ `rpg` | 96.89% | 1030/1063 | 9 |
> | ★ `save` | 96.50% | 386/400 | 5 |
> | `ai` | 98.59% | 771/782 | 2 |
> | `input` | 97.14% | 34/35 | 1 |
> | `data` | 100.00% | 37/37 | 2 |
> | `vfx` | 95.00% | 533/561 | 2 |
> | `core` | 90.39% | 546/604 | 9 |
> | `world` | 87.10% | 1385/1590 | 13 |
> | `player` | 86.40% | 610/706 | 3 |
> | `ui` | 73.32% | 1108/1511 | 5 |
> | `tools` | 67.29% | 179/266 | 5 |
> | `audio` | **15.93%** | 95/596 | 3 |
> | `(root)` | **0.00%** | 0/388 | 1（`src/main.ts`） |
>
> **这个数字要配的三句实话**：①**上面那句 80% 的承诺今天本来就成立**（最低的 ★ 格是 `save` 96.50%，还有 16.5 个百分点余量），
> 所以这一批没有为了达标改动一行生产代码——产出是"门从此逐包看得见"，不是"数字被推上线"；
> ②真正的盲区是 `audio`（596 行只跑过 95 行）与 `(root)` 那 388 行，而它们**不在上面那句话的名单里，所以门不会替它们红** ⇒ 单开 TD-006，
> 并且这里把口径写死：**§6.1 的 80% 只管那四个包**，表现层与音频层今天没有被这条承诺覆盖，别把"门绿了"读成"覆盖率都达标了"；
> ③地板文件从两格长成三格（`linesPct` + `byPackage` 15 格 + `zeroFiles` 6 格），而它的第一版 `byPackage` **只能由真跑写**（`--bless` 拒绝红跑，
> 主工作树当时正被并行会话红着）⇒ 先在 `dac9d68` 的干净 worktree 快照上真跑一次 bless，再把产物搬回主仓并 `diff` 证明
> "按读数手工倒出的那份"与"真跑写出的那份"**逐字节一致**；没有"先写一个数再让门去迁就它"。
> **仍然没被执行的是那句老话的另一半**：行覆盖是**被执行的行数**，不是**被断言的行为数**——这一批没有让它变得更"真"，只是让它变得更"细"。
>
> **对账 v4（KI-065，2026-09-27）：`audio` 那一格第一次从"看不见"变成"全看见"。** 上一版点名的那块最大盲区（15.93%，596 行只跑过 95 行）
> 靠一台手写的假 WebAudio（`tests/support/fakeAudio.ts`：假 `AudioContext` 记录每个节点与每条 `connect` 边、假 `AudioParam` 记录每次
> `set/linearRamp/exponentialRamp/cancel` 的**值与时刻**、假 `window` 换掉整只全局对象）第一次可断言，四份新测试文件 + `lockon.test.ts` 补的打分腿：
> **HEAD 快照 `14796a0` + 本批 8 个文件的实测：总行覆盖 81.84% → 87.36%（8859/10140 行，72 个 src 文件，86 个测试文件 / 1013 条用例全绿）；
> `audio` 15.93% → 100.00%（592/592 行）；`player` 86.40% → 94.77%；零覆盖名单 6 格 → 5 格（`src/player/LockOn.ts` 出列）。**
> 五条限制要跟着这个数字一起读：
> ①**这一批改的是可测性，不是玩法**——新增的几乎全是测试资产，生产侧只有两处：`lockon_off` 接上它唯一的消费者（`VOICES` 里躺着没人喊的那个），
>    以及删掉 `music.ts` 里四行**永远跑不到**的"淡出到点归零"（覆盖率读数本身就是证据：`scheduling` 要求 `now < battleStopAt`，那段的前提是 `now ≥ battleStopAt`）；
> ②`audio` 到 100% **不等于音色是对的**：这台量具保证图形状与参数调度可断言，"好听"仍然属于 §78 里 Blocked 那一栏（KI-010 同因）；
> ③`audio` 不在 §6.1 点名的四个核心包里，**所以门今天仍然不会替它红**——它的地板被 bless 到 100 之后含义是"这一格不许再回到看不见"，
>    不是"这一格达到了对玩家的承诺"；口径那句（80% 只管四个包）写在上面，不重复；
> ④`(root)` 那 388 行（`src/main.ts`）仍是 0%：装配层只在浏览器里活，headless 没有可断言的对象，这一格不在任何承诺里也不在任何名单的债上；
> ⑤**反向探针 56 刀、54 刀咬到行为红**（5 个被改文件跑完按 sha 逐字节还原复验）。两刀不咬，各自是一句实话而不是一个洞：
>    `pan` 那道 `Math.max(-1, Math.min(1, side / Math.max(2, dist)))` **数学上到不了**（`|side| ≤ dist`，`dist ≥ 2` 时分式 ≤ 1、`dist < 2` 时分母是 2 而分子 < 2），
>    摘掉钳位行为不变 ⇒ 它是死码的一半（同一行的乘子 0.85 有读者）；`scheduling` 里那半句 `now < battleStopAt` 是**等价突变**
>    （淡出的账由 `while` 那道同名守卫负责——拆它红；`scheduling` 整道门的职责是"不该响的时候不响"——写成恒真也红），
>    两道守卫各有证人，本批没有为了制造可测性去动生产代码。另有一刀是**刀自己的 bug**：`NOISE_CACHE.delete(ctx)` 第一版写在 `set` 之前
>    （删的是一个还没写进去的键）⇒"不咬"的是探针不是判据，挪到 `set` 之后立刻红一条。
> **地板只能在干净快照上写**：主工作树今天被并行会话红着（17 条：对话/任务/唤四钟/F3 面板/文档对账/存档恢复位），`--bless` 拒绝红跑，
> 所以本批走的是"`git worktree` 拉 `14796a0` → 只把我这 8 个文件同步进去 → 控制组先全绿 → 再 bless → `cmp` 证明搬回主仓那份逐字节一致"。
>
> **实机腿（同批，`http://127.0.0.1:5199/?fresh=1`，Chrome 真 `AudioContext` 48kHz `running`）**：把 `AudioContext.prototype` 的七个工厂包一层，
> 真机就变成同一台量具。① 首次手势建图 = 真图（12 gain / 3 biquad / 1 comp / 5 osc）；② **34 个 key 逐个喊，全部建出真节点、零抛错**，
> 而连喊 34 声时最后 10 个 key **零节点** —— `MAX_VOICES = 24` 在真机上真的咬人，隔 2.5s 再喊十个全部出声（含此前是空号的 `lockon_off`）；
> ③ UI 四个 key 带 pos 不生 `createStereoPanner`、世界 key 生一个 ⇒ 假机那套直通/空间化断言没有和 Chrome 语义打架；
> ④ 锁定四拍全对上：空手→`lockon_on`、**换一个目标只响 `lockon_on` 不响 `lockon_off`**（本批 `if (!t && had)` 的实机证人）、有→null→`lockon_off`、抢空→`ui_move`；
> 打分选了正前 6m 而非侧向 5m；⑤ 音乐：拍距实测 **0.714s** 逐拍不漂移、kick 150/snare 200 落在 1·3 与 2·4、ostinato 根音与表同序、反拍八度 **+0.357s**、
> 第 1 拍的钟带着 `BELL_RATIOS`（260.12 的 2.01/2.43/3.07/4.53/5.77 倍，±8 音分）；第二场 `start:true` 后 **+0.1s** 落第 1 拍且第 1 拍又是 kick+65.41+钟 ⇒ `beatIdx` 真归零；
> `start:false` 后拍点排到 stop+3.86s，`battleStopAt`(+4s) 之后一拍不排；⑥ 未知 key 喊 6 次 ⇒ 0 振荡器 + 每键一条 warn，且 warn 走 `bus.emit('log')` 而非 `console.warn`，
> **所以浏览器控制台里看不见它**（以前没人记过这句）；⑦ `audio.muffle` on/off 不抛，真 bundle 里 `muffleRamp` 读出 100Hz/0.08s 与 20000Hz/0.18s。
> 两处坑写给下一次：**`press_key` 在这个隐藏页送不进去**（`userActivation.hasBeenActive` 恒 false），真图靠 `window.dispatchEvent(new PointerEvent('pointerdown'))` 建；
> **同步空转把 `tickFrame` 灌到 265fps 会量错** —— GameTime 跑到音频钟前面 3.5 倍，淡出尾部两拍被吞（我第一版据此得到"淡出提前 1.5s 结束"这句假结论），
> 改成 40ms 节流步进后尾巴塞满。**量节拍的东西必须与音频钟同速跑，不许比它快。**
> 仍然拿不到的：那条 `exponentialRamp` 落在哪个滤波器节点上（`AudioEngine`/`MusicLayer` 没挂进 `__caesura`，`main.ts:104` 的 `audio` 是模块内 const，读不到 `frequency.value`）；
> 以及一切听感与像素（页面 0×0、`document.hidden`）—— 实机腿量到的是"Chrome 同意这套调度"，不是"它好听"。

### 6.2 Headless 功能测试（自动化 gameplay flow，需求 §59）
无渲染模式：GameLoop 以 `tickSync()` 手动步进（注入假时钟），装配 stub 渲染层。脚本化协议：
```
startNewGame() → 移动 3 tick 假输入 → 位置变化断言
→ spawn en_cacoph_shell → 注入攻击输入序列 → 感知触发 aggro 断言
→ 战斗循环(模拟弹反×N) → 敌人死亡+掉落生成断言 → 拾取入包断言
→ equip 断言属性变化 → saveGame(slot1) → reset + loadGame(slot1)
→ 全状态 deep-equal 断言（位置/HP/背包/任务/flags）
```
每阶段一条用例、seed 固定、可 `npm run test:flow`。回归红线：任何 P0/P1 系统改动必须绿此流程。

### 6.3 浏览器实机验证协议（需求 §77，P0 验收门槛）

> **对账（2026-09-26）**：下面第一条**整条未落**——本机没有 Playwright，`npm run test:e2e` 这个脚本不存在
> （KI-015 已把这条从"必过门"口径里摘掉），`docs/qa/shots/` 目录也不存在，像素 diff 无从谈起。
> 今天真正在跑的只有第二条（browser-use 交互式探针），而它受一个环境事实约束：本环境打开的是隐藏标签页
> （`innerWidth/innerHeight = 0`、`document.hidden = true`），一帧真实渲染约 0.6~1.5s ⇒
> **"关键场景截图与基线对比"与"30s 录像目检 game feel"这两格做不了，登记在 KI-010**。
> 仍然守得住的两条：① 控制台错误数 = 0（每轮探针都在读，非零就当场记 KI）；② 逻辑层用 `loop.tickFrame(1/60)`
> 真步进 + 真键盘/真鼠标事件复验（KI-020/KI-003/KI-048 都是这样读回来的）。
> 第三条"性能冒烟 P99 > 20ms 即 fail"同样未落：隐藏页测出来的帧时间是那个标签页被节流后的假数，不是性能数。
> **凡涉及"看起来对不对"的结论，本文档一律不写"已验证"**（§78）。

- ~~Playwright（chromium）：`npm run test:e2e`~~ **未落**：启动 dev server，加载首页，等待 boot 完成信号（`window.__CAESURA_BOOTED__`），**控制台错误数必须 = 0**（warning 白名单制），WebGL context 存活断言，关键场景截图存 `docs/qa/shots/` 与基线图对比（像素 diff 阈值，视觉评审用需求 §82 清单人工复核）。—— boot 信号与控制台错误两条已由 browser-use 探针承担；其余等 Playwright 或可见窗口。
- browser-use（交互式 QA 补充）：真实输入走一遍 §6.2 流程（鼠标键盘事件注入），录制 30s 片段验证 game feel（HitStop 手感/摄像机行为无法纯 headless 断言，须截图+录像目检）。**录像与目检未做（KI-010）**；HitStop 与镜头行为改用**逻辑读数**验证（`hitStopUntilTick`、`CameraRig.rawScale`、`SHAKE_TABLE` 档位），这能证明量对了，不能证明手感对了。
- ~~性能冒烟：e2e 中采样 10s 帧时间，P99 > 20ms 即 fail（Medium 档 1080p 虚拟分辨率）~~ **未落**（同上，属 KI-010/KI-045 那个不可测面）。

---

## 7. 构建与版本

### 7.1 npm scripts

> **对账（2026-09-26，KI-063 于 2026-09-27 更新）**：这张表是立项时的期望清单，**其中四行不存在**。`package.json` 里真实存在的十个是：
> `dev` / `build`(= `tsc --noEmit && vite build`) / `preview` / `lint`(= **只有 `tsc --noEmit`，没有 eslint**) /
> `test`(= `node scripts/test.mjs`，带覆盖核对的跑测器，见 §6 前言) / `test:flow` / `validate:data` /
> `check`(= lint + validate:data + test) / `test:raw`（绕过覆盖核对直接跑 vitest） /
> `coverage`(= `node scripts/coverage.mjs`，**第五道门**：量整个 `src/` 的行覆盖并对账地板文件，KI-064 起**还按包对账**（每包一条只许涨的地板 + 核心包 ≥80% 独立于地板），刻意**不在 `check` 里**，理由见 §6.1 对账 v2/v3)。
> **不存在的**：`test:e2e`（无 Playwright）、`perf:capture`（无 `scripts/perf-capture.mjs`）、`lint` 里的
> `eslint --max-warnings 0`（零新增依赖优先，边界检查由 `tests/unit/arch-boundaries.test.ts` 承担）；
> `validate:data` 也不是 `tsx scripts/validate-data.ts`，而是**零依赖的 `.mjs`**。
> 这套脚本清单每次改动都真跑，所以它没有"表里绿、实际不存在"的余地——上面那四行原本是假的。

```
dev            vite（HMR，默认 DEV 调试器开启）
build          vite build（生产，去 tools/、Drop console、esbuild minify）
preview        vite preview + 性能档位查询参数
test           vitest run            test:flow  vitest run --dir tests/flow
test:e2e       playwright test       lint       eslint --max-warnings 0 + tsc --noEmit
validate:data  tsx scripts/validate-data.ts
perf:capture   node scripts/perf-capture.mjs（跑 e2e 采样帧时间写 docs/perf-log/）
```

### 7.2 Vite 分包

manualChunks：`three`（vendor，独立长缓存）、`game-logic`（core/combat/ai/rpg/quest/save）、`game-render`（world/vfx/player 视觉部分）、`ui`、`audio`、`data`（JSON 资产独立 chunk 可预加载）。资产（gltf/纹理）走 public + import.meta.url。目标：首屏 JS ≤450KB gzip（不含 three）。

> **对账（2026-09-26）**：分包**落了**（KI-005 结案：`manualChunks` 曾挂在错误的配置层级被 vite 静默忽略，现在真产物的六块是
> `three` / `index` / `data` / `ui` / `render` / `audio`，名字与上面规划的 `game-logic`/`game-render` 不同但分层一致）。
> **那条"首屏 ≤450KB gzip（不含 three）"这次可以真回答**：本轮 `npm run build` 的实际 gzip 是
> index 35.70 + data 27.76 + ui 27.22 + render 21.26 + audio 4.77 = **116.71 KB**，不含 three 的 133.25 KB ⇒ 达标且余量很大。
> `public` 里至今没有 gltf/纹理（零外部素材），所以"资产走 public + import.meta.url"这一句**没有对象**，不是未落。

### 7.3 Git 工作流

主干 `main`（始终可玩）+ 短分支 `feat/<system>-<topic>`；commit 前缀约定 `combat:|ai:|world:|perf:|data:|fix:`；PR 合并门槛 = `lint + test + validate:data` 绿，P1 以上另需 `test:flow`；squash merge。大文件：模型/纹理走 git-lfs（或首版全程序化生成=无二进制）。每 Milestone 打 tag `ms-0.x`。

> **对账（2026-09-26）**：本仓库**没有远端、只有 `master` 一条分支**（文档写的是 `main`），因此 PR / squash merge /
> 分支名约定这三件事**都不成立**——实际流程是"每个 KI/Phase 一条直提交，提交信息里写清门禁与实机状态"。
> commit 前缀确实在用，形态是 `area+area: KI-xxx — 中文摘要`（例：`ai+core: KI-014②b — …`）。
> **`git tag` 一个都没有**：需求 §62 的 Milestone 打 tag 从未执行，这是本轮对账抓出来的第二条"写了没做"。
> git-lfs 未启用，且走的是括号里那一支（全程序化生成 = 无二进制），符合事实。

### 7.4 CI 思路（本地先行）

无外部 CI 依赖：git pre-commit hook（husky）跑 `lint + tsc`；pre-push 跑 `test + validate:data`；`scripts/release-check.mjs`（每次发版候选）串跑 build+test:flow+test:e2e 全绿才允许打 tag。未来若上 GitHub Actions：linux runner 即可（无需 GPU 机，e2e 用 headless swiftshader 标记为性能豁免）。

> **对账（2026-09-26）**：`husky` 没装（零新增依赖优先），仓库里 `.git/hooks/` 只有 `.sample`；
> 实际拦住提交的是**机器级** `core.hooksPath = C:/Users/18414/.codex/git-hooks`（不属于本项目、不可修改，
> 它会跑 `tsc --noEmit` 并拦截看起来像密钥的 diff）。**pre-push 与 `scripts/release-check.mjs` 都不存在**
> （`scripts/` 里只有 `validate-data.mjs`、`test.mjs`、`gen_initial_data.py`）。
> 于是"提交前必过"的真实清单只有：tsc（钩子）+ 我自己在每次交付前手跑的 `validate:data` / `test` / `build` 三道——
> 这条口径 KI-015 已经改过一次，本节是文档里最后一处还写着不存在门禁的地方。

---

## 8. 已知限制与技术债登记规范（需求 §79/§78）

### 8.1 登记位置与状态枚举
统一登记在 `docs/KNOWN_ISSUES.md`，四张表：Known Issues / Tech Debt / Performance Issues / Missing Assets。状态只允许：`Implemented | Partial | Placeholder | Blocked`（需求 §78）。每个阶段（§62 Phase）结束必须清理至少 1 条 TD 项——「不允许技术债无限积累」。

### 8.2 条目格式约定（四表共用列）
```
| ID | 标题 | P0~P4(需求§76) | 状态 | 症状/影响 | 根因或差距 | 缓解方案 | 修复路径/触发条件 | Owner |
ID 规则：KI-/TD-/PF-/MA- 前缀 + 4 位序号（例 TD-0007）。
```

### 8.3 首批已知的种子条目（本架构文档立项时即登记，防止「伪装已实现」）
| ID | 标题 | P | 状态 | 影响 | 缓解 | 修复路径 |
|---|---|---|---|---|---|---|
| TD-0001 | 无动态 GI（Lumen 缺失） | P2 | Placeholder | 洞穴/室内外光照过渡靠烘焙探针近似 | 每区域双 IBL 探针交叉淡入 | 若迁 UE5 自然消除；本片内不做实时 GI 追平 |
| TD-0002 | 无全身 IK / Motion Warping | P2 | Partial | 踏步落差、吸附对齐靠手工位移 | 单骨 look-at + 台阶射线 | 自写 two-bone IK（列为 Phase 7 可选） |
| KI-0001 | Chromium 外手柄震动失效 | P3 | Blocked | Firefox/Safari 无 haptics | 特性检测+设置页灰显说明 | 不可修（浏览器 API 限制），文档如实标注 |
| MA-0001 | 全部美术为程序化/低模占位 | P1 | Placeholder | 视觉上限低于 AAA 目标 | 统一「凝固声波」母题 shader 拉升风格一致性 | 资产接口(§1.2 升级路径)就绪后可整体替换 glTF |
| PF-0001 | 尚未实测 60fps | P1 | Blocked | 性能预算(§5.3)未经真机验证 | 首可玩构建即跑 perf:capture 基线 | Phase 1 结束时必须有 Before/After 首表 |

---

## 9. 存档管线（需求 §45/§71）— Phase 5-A 已实现

`src/save/`：`Serializer` / `Integrity` / `Migration` / `Checkpoint` 四个文件按 §2 的分工各管一件事，
游戏侧**没有任何一处**直接碰 localStorage/IndexedDB。

- **只存世界状态，不存实例**：快照 = `{version, playSec, regionId, player(位置/hp/体力/过载/武器), flags[], clearedSlots[], usedInteractables[], rpg}`。
  关键取舍是 `clearedSlots`：它存的是出怪槽位的**稳定身份**（`区域:组序号:成员序号`）而不是敌人实例，
  所以读档后场景由既有的流送 + SpawnDirector 自己摆回来（Phase 3-C2「出怪来自数据」第二次生效：
  存档里一个敌人数组都没有，也就不可能出现「存档里的怪和表里的怪对不上」）。区域解锁同样只存 flag——
  解锁判定本来就是 `region.unlockFlag ∈ flags`，不需要第二套「已解锁区域」状态。
  `usedInteractables`（v6 起）是同一条取舍的第二次应用：**存的是交互物的 id，不是"哪些模该消失"**，
  所以加一个交互物永远不需要动存档 schema，也不会出现"存档里那只箱子和表里那只不是同一只"。
- **校验和 + 双写 + 回退（Integrity）**：`magic + schemaVersion + crc32(JSON(payload))` 封在信封里；
  写序是 `tmp → prev(上一份) → 主键位 → 删 tmp`，所以任何一步之间被 kill，主键位要么是旧的完整档、
  要么新档已经写完；读序是 主 → tmp → prev → 备份，逐个过校验，取第一份合格的并在日志里说清是哪一份。
  CRC32 只保证「没被截断/改坏」，不是密码学校验（本地单用户存档不需要后者，写在这免得被当成安全边界）。
- **迁移链禁止「读旧档直接崩」**（Migration）：`registerMigration(from, fn)` 逐级升到当前版本，缺步骤抛
  `MigrationError` 并由调用方回退到上一份。当前 **v1→…→v10 九步都是真历史**（v2=成长/背包，v3=失谐归零，
  v4=谱册空谱，v5=逐条保底计数 + 掷骰位置，v6=`usedInteractables`，v7=`quest` 块，v8=`brokenProps`，
  v9=`rpg.movements.passives` 被动栏，v10=`savedAt` 存档时刻），没有为了展示机制而虚构一步；每一步都按 §78 的口径写**空**
  （没发生过的事写空表/空集/null，不替老档补一份"好像做过"的进度）。**读侧白名单 `READABLE_VERSIONS = [1..SAVE_VERSION]`（Phase 5-C1 修的真 bug）**：
  这里曾只写 `[SAVE_VERSION]`，于是 v1/v2 老档在 `unwrap` 那一步就被当坏档拒掉——迁移链写得再对也永远进不去，
  玩家表现为「有档却说没有」。现在 `save.test.ts` 有一条**从磁盘放一份 v1 档**、走 `load()` 全路径的可达性断言。
  v4 那一步的口径与前三步一致：**给老档补的是空谱（页全黑、槽全空），不是替玩家点亮第一页**——
  那份档确实没有"学过哪几式"这件事，振源核本来就在它的背包里，回调音桩照样点得开（§78 要的是如实，不是好看）。
  v5 同一条口径：**保底计数写空表、掷骰位置不写**（老档没攒过就是没攒过，不白送一次保底；不记位置就不假装记得位置，
  读档后从当前这颗 RNG 接着抽）。
- **触发器与游戏循环解耦（Checkpoint）**：调音桩休息 / Boss 跳阶 / 首次进区域三个时机都只 `request(reason)`
  排队，异步写在后台跑（连请求会合并原因、合并成一笔），失败既发日志也发 HUD 提示——
  「以为存了其实没存」比不能存档更糟。`pagehide` 也挂了一次（关标签页前补一笔）。
- **环境差异如实处理**：`typeof indexedDB === 'undefined'` ⇒ 备份位为 null 并在控制台说明「只剩本地一份」，
  不静默假装双份；存储写失败（隐私模式配额）走同一条「说出来」的路径。
- 覆盖与实机：`tests/unit/save.test.ts` 9 条（含 Phase 5-C1 补的**读档可达性**一条）+ `tests/flow/movements.test.ts`
  里的 v4 往返与 v3→v4 迁移两条 + `tests/flow/gate5.test.ts` 的 v5 往返与"掷骰位置/保底计数退回"两条；
  全量 **37 files / 398 passed**，tsc/validate:data/build 干净。
  实机：`?fresh=1` 开局 → 走到钟坠院存档点、设 flag、把 hp/过载调成非默认值 → `saveNow()` →
  localStorage 出现 `caesura.save.autosave` + `.prev`、IndexedDB 里同键可读 → **刷新页面** →
  日志 `load.ok autosave v1`（v2 起为 `v2`），玩家回到 (130, 64, -120)、hp 41、过载 7、三条 flag 全在、
  脚下层 64、区域判定 rg_fellcarillon、周围敌人由数据重新刷出。控制台 0 error 0 warn。
  **Phase 5-C2 复验（2026-09-23）**：真浏览器里点亮三页 + 升到 L2 + 装两槽 → `saveNow()` → 读磁盘确认
  `snapshot.rpg.movements = {lit[3], levels{全音符斩:2}, slots[2]}` 且信封 `magic/CAESURA-SAVE + schemaVersion 4 + crc(number)`
  → **不带 `?fresh` 重新导航** ⇒ 日志 `load.ok autosave v4`、音级/点亮/等级/槽位全部回来、
  `player.skills` 重新绑上 R（冷却**不**入档，读档不白送一次冷却），按 R 真的出手。0 error 0 warn。
### 9.5 KI-025①②：存档槽名册与两屏存档 UI（2026-09-26）

§9 那套读写编排此前只有一个入口（开局自动读 `autosave`、三个时机自动写），玩家侧没有"哪一格"这个概念。
KI-025 把它补齐成**名册 + 两屏**，架构上留下四条值得钉住的取舍：

- **一条候选顺序，一个主人**：`slotCandidates(primary, backup, slot)` = 主键位 → `.tmp` → `.prev` → 备份位，
  是全仓库唯一的读档顺序；`readSlot` 是它上面唯一的纯读通道（不发事件、不改世界），
  `SaveGame.load`（应用+播报）与 `SlotRoster`（只查四格）都是它的调用方。
  动机不是审美：摘要卡要回答"这一格到底能不能读"，而**两条各写一份的候选顺序一定会飘**，
  飘出来的表现是"卡上写可读取、点下去读到别的格子"——那是玩家眼前的假账，不是内部不一致。
- **名册不许有副作用**：`SlotRoster.card()` 逐格问四遍，问的是存储不是内存；写/删之后面板**重新取名册**再画，
  卡上的数字来自磁盘而不是"我应该写过了"。因此 v10 的 `savedAt` 必须由注入时钟给（`SaveWorld.now?`），
  逻辑层不许自己读 `Date`——否则每次跑测都得到不同的档，摘要卡"时间来自表而不是代码"这条也没有证人。
- **空 ≠ 坏，缺格留空**：`SlotCard.state` 四态 `empty/ok/restored/blocked`，只有 `blocked` 带 `problem` 原话
  （四种坏因各一条：parse/magic/version/crc）；`restored` 必带来源键位并区分主机与备份机（`slot1.prev` vs `slot1@backup`）。
  v1 老档的 rank/出身、v9 老档的时刻一律显示"未知/未记录"，不拿运行时基线或读档那一刻冒充。
- **能做什么由站在哪儿决定**：读档只住在标题屏，写入/删除只住在调音桩面板第六页；面板拿到的是
  三个闭包（`list/write/erase`），既不认识存储键位也不认识 `SlotRoster` 类——位置口径要能分开，
  靠的是把"动作"而不是"存储"注入 UI。破坏性动作两步落盘，第一下只记待确认并写明后果。

**一条只可能由实机抓到的 bug（§77 这一腿存在的理由）**：`IdbStore.get` 对**缺失键**是真 IDB 的
success + `result === undefined`，而 `KvStore` 合同与 `readSlot` 判的是 `=== null`，
于是三个从没写过的槽在浏览器里全报 `blocked / parse`（`unwrap(undefined)` 把空槽当坏 JSON）。
`MapStore` 替身恰好返回 `null`，所以整条 headless 门禁（当时 72 文件 / 768 用例）对此完全无感——
**假件照抄了我们希望真库有的脾气，而不是真库实际的脾气**。修法分两层：适配器把 `undefined` 归一成 `null`
（合同由适配器守住），读侧再兜一层（一台不守合同的存储也不许让空格子背"损坏"的指控）；
并给 `IdbStore` 补了一台**按真 IDB 语义说话**的假库（缺失键 `undefined`、对象仓库未建则同步抛 NotFoundError）。
反向实测三探：只撤适配器 ⇒ 恰红 1；只撤读侧 ⇒ 恰红 1；两刀同撤 ⇒ 红 3 且其中一条原样复现实机症状
（`['blocked','blocked',…]` 对上 `['empty',…]`）——两层的必要性由此不是说法而是读数。

覆盖：`tests/unit/slots.test.ts` 21 条（格子形状 / 时刻只在注入时才有 / 恢复位带名字 / "一条候选顺序两处对账" /
删除连恢复位一起删 / 写满三格内容互不串 / IDB 形状 4 条）+ `tests/unit/save-ui.test.ts` 13 条
（**真 `SaveGame` 写进真 `MapStore`、再由真 `SlotRoster` 读回**，卡面不许有编出来的字）+
`tests/unit/title-screen.test.ts` 12 条 + `tests/unit/stakerite.test.ts` 存档页 10 条。
实机（127.0.0.1:5199，真 `MouseEvent`/`KeyboardEvent`）：修复前四格 `[ok, blocked/parse ×3]`、修复后如实；
面板点第一下时 localStorage 里 `slot1` 一个键都没有、点确认后主机与 IDB 备份位同时出现；
删除后两处都清干净、`ui.notify` 收到「已写入 槽 I」「已删除 槽 I」；标题屏塞一封 crc 不对的信 ⇒
那张卡"读不出来 · 存档文件已损坏"且读取按钮置灰、焦点轮不到它，只有可读的自动档拿焦点；
点"读取" ⇒ hp 120→124（档里的数）、`#title` DOM 移除、日志 `load.ok autosave v10`、0 error。
视口观感（卡面好不好看、排版/热区手感）照旧 ENV 缺（KI-010/027 同因）。

- **收尾时删掉的一条自己造的债**：`SlotRoster.firstFreeManual()` 与 `isManualSlot()` 落完 UI 之后**没有生产消费者**
  （"存到哪一格"是玩家按下去的决定，不该由逻辑层猜；"自动槽不可写"的真主人是 `ui/SaveSlots.ts` 里那句 `v.kind === 'manual'`）。
  按 §55「不留没有消费者的入口」删除，挂在这两个 API 上的断言改钉到真主人（候选名单不含自动槽 + 面板的置灰标记）。
- **未落**：quest/NPC/settings 字段等各自 Phase 落地时继续往迁移链上加步（成长/背包/谱册/世界/任务/被动/时刻均已入档，**设置还没有**，见 KI-026）；
  LZString 压缩仍未引入（实测信封 1.2KB，零新增依赖优先）。
## 10. RPG 成长系统（需求 §18/§25/§26/§55/§57）— Phase 5-B 已实现

模块边界（`src/rpg/`，**文件之间互不越界**，全部零 three、零 DOM）：

| 文件 | 职责 | 明确不做 |
|---|---|---|
| `Progression.ts` | 遗响→音级→音级点→六音级属性；软上限折算；洗点；派生值公式 | 不认识"装备"，护甲 DEF 由调用方传进来 |
| `Inventory.ts` | 堆叠件 vs **装备实例**（uid/强化等级/词缀数值）；分类清单；快照 | 不知道谁穿在身上 |
| `Equipment.ts` | 七槽装配；把一身装备汇总成一组乘数（`EquipMods`） | 不写玩家状态 |
| `Loot.ts` | 掉落掷骰（种子化）+ **两条各自独立**的保底 + 首杀 | 不播报、不落 UI |
| `Settlement.ts` | **组合根那串胶水的本体**（Phase 5-C3）：`KillSettlement`（`entity.died` → 结算 → 播报 → refresh → 检查点）、`refreshPlayer`（mods 灌回面板 + 按装备栏换手里那把武器）、`openLootTable`（交互物拾取） | 不认识 `PlayerController` 实例（只吃结构性接口 `ModsSink`）、不认识存档类（refresh 与 checkpoint 由外面注入） |
| `Upgrade.ts` | 强化曲线消费与上限校验 | 不碰背包以外的系统 |
| `Movements.ts` | **谱册状态**（Phase 5-C2）：哪几页亮了、每式几级、两槽装着什么；把"槽位号:音级"合成给玩家的 `{f, cast}` 小表 | 不出手、不认识 `PlayerController`，扣款只通过 `Inventory` |
| `Runtime.ts` | 总装：`mods()` 一组扁平乘数 + `onEnemyKilled()` 一串所得 + `skillLoadout()` 交给玩家的招式 | 不认识 `PlayerController` |

**唯一接口是 `PlayerMods`**（`src/rpg/Runtime.ts`）：`rank / attrs（软上限折算后）/ hpMax / staminaMax /
poiseMax / defense / loadMax / overdriveMax / critRate / critMul / execMul / noiseMul / poiseDmgMul /
staminaRegenMul / perfectBlockBonusTicks / lightStartupTicks / bellBonus / restOverdrive /
weaponDamageMul / weaponId / weight / overloaded`。
`main.ts` 在「升级 / 换装 / 强化 / 洗点 / 掉落 / 读档」之后调一次 `refreshRpg()`（本体是
`Settlement.refreshPlayer(rpg, player)`，Phase 5-C3 起与 flow 测试共用同一份），把这一组乘数灌进
`PlayerController.applyRpg()`，玩家与战斗管线只消费它——**成长系统不写第二份状态到玩家身上**。

### 10.1 消费点清单（每条乘数都有唯一去处，没有"挂在那儿好看"的字段）

| 乘数 | 消费点 | 语义 |
|---|---|---|
| `attrs`（折算后） | `CombatManager.strikeEnemy` → `resolveDamage({attrs, scaling})` | 武器伤害标尺吃**折算值**，所以面板 60 点基音不会说谎 |
| `weaponDamageMul` | 近战 `strikeEnemy` 的 `base`、玩家投掷弹体的 `damage` | 强化跟着**那把武器件**走，不跟着槽走 |
| `critRate` / `critMul` | `DamagePipeline.resolveDamage`（新增 `critRate` 字段） | 只对玩家出手生效；敌人没有暴击属性（Boss 的难度来自机制，不是随机倍率） |
| `poiseDmgMul` | `strikeEnemy` 的 `addPoise` | 共鸣词缀 |
| `bellBonus` | `strikeEnemy`，判据 = 目标有钟甲或带壳（数据驱动，不看名字） | 之鸣钟 |
| `execMul` | `landExecute` 的真伤公式 | 泛音属性 + 泛音弦词缀 |
| `perfectBlockBonusTicks` | `resolveAgainstPlayer` 的完美格挡窗 | 之延 |
| `restOverdrive` | 弹反成功 `addOverdrive(1 + restOverdrive)` | 之休止 |
| `lightStartupTicks` | `tryStartAction`：动作 tick 从 `min(bonus, activeStart-1)` 起跑 | 之切（永不越过 activeStart） |
| `noiseMul` | 玩家所有 `sound.source` 出口（起手/跳跃/翻滚/脚步） | 静默词缀；深窖与万籁的正解靠它 |
| `loadMax` / `overloaded` | 翻滚禁用、疾跑禁用、体力回复 ×0.6 | §5.1 的明确惩罚 |
| `staminaRegenMul` | `stats.mods.regenMul`（与夺拍乘子相乘，不另开一条回复路径） | 节律 |

### 10.2 数值纪律

- 每一格数值都在 `data/json/progression.json` / `items.json` / `loot.json`；代码里只有乘加。
- **词缀必须有消费方**：没有消费方的（之连「连段递变」、战技伤害、异常施加效率）**不写进数据表**——
  一个没人读的 +5% 和没做没有区别，只会让面板看起来更满。将来 5-C 的战技系统落地时再补进去。
- 音级曲线按 progression.md §2.3 的**前十个锚点**逐字落表（60/75/94/118/148/185/231/289/361…），
  之后按文档自述的 r≈1.25 几何延展；文档 15/18/20 三行与"r≈1.25"这句自述本身对不上（其累计栏也算不回表内），
  取连续曲线并在 KNOWN_ISSUES 登记这条口径差。
- 强化倍率：文档 §5.4 合计栏写「≈+79%」，逐格相加是 0.80 ⇒ 实装 1.80，按表不按约数。

### 10.3 存档 v2 / v3 / v4（与 §9 的衔接）

`Snapshot.rpg` 存 `{progression, inventory, equipment, loot, movements}` 五块，全部是**纯数据**：
装备存的是 `uid/itemId/level/affixes`，谱册存的是 `lit[] / levels{} / slots[]`，不存任何 three 对象。v1→v2 的迁移是**真的一步**
（`registerMigration(1, …)`）：老档把 `rpg` **显式写成 null**，读档时保留运行时基线（出身），
既不编造等级、也不静默丢字段——测试 `save.test.ts` 钉住「v1 的每个字段都还在 + rpg === null」。
**v3（Phase 5-C1）** 只补一格：`player.corruption = 0`——失谐是这一版才有的量，老档不补就会被
`CorruptionMeter` 当成 `undefined` 参与算术。**读侧白名单 `READABLE_VERSIONS` 是这一步真正的教训**：
`unwrap` 先前只认当前版本 ⇒ 老档在进入迁移链之前就被判成坏档（详见 §9 第三条）。
**v4（Phase 5-C2）** 补的是 `rpg.movements = {lit: [], levels: {}, slots: []}`（见 §9 迁移段：空谱，不是替老玩家点亮第一页）。

### 10.4 数据门禁（KI-015 部分闭合）

`scripts/validate-data.mjs`（零新增依赖）+ `npm run validate:data`，并串进 `npm run check`（lint → validate:data → test）。
校验范围见 KNOWN_ISSUES KI-015；**规则以 `src/data/schema.ts` 与设计文档的事实为准**，改 schema 时同步脚本里的词表常量
（文件头已注明）。它上线当天抓出的第一个真 bug 是"音徽永远掷不到词缀"，已在 `rpg.test.ts` 留下回归。

### 10.5 UI 分工

HUD（canvas）只多了一个**音级数字**（§42：不在战斗视野里堆数字，遗响条属于面板）。
调音桩面板（`src/ui/Stakerite.ts`，DOM overlay）承载六页：调音 / 装备 / 行囊 / **谱册**（Phase 5-C2）/
**交易**（KI-055）/ **存档**（KI-025②），
**只在调音桩前可开**（`interact.focus().kind === 'checkpoint'`），打开即 `time.paused = true` + `input.enabled = false`。
面板只调 `RpgRuntime` 的公开方法，生效后回调 `onApply()` 由 main.ts 统一重算——
面板自己不写第二份"应用变更"的逻辑。方向键在六页间**环状**切换（最后一页再往右回第一页）。
**存档那一页是这一段的例外**：它一个 `RpgRuntime` 方法都不调（写入/删除走构造时注入的三个闭包，
面板既不认识存储键位也不认识 `SlotRoster`），而且存档动作**不叫 `onApply`**——那一页不重算任何派生值，
这条边界有断言钉着（`hooks.onApply` 在"点写入 → 点确认"前后长度相等）。

### 10.6 覆盖与实机

- `tests/unit/rpg.test.ts` 28 条 + `tests/flow/rpg.test.ts` 8 条 + `tests/unit/stakerite.test.ts` 8 条；
  全量 **34 files / 374 passed**（Phase 5-C2 口径），tsc / vite build 干净。
- 玩法流覆盖需求 §59 的完整链条：击杀 → 遗响入账 → 掉落入背包 → 装备 → 强化（且 +3 封顶后
  第 4 次明确报 `maxed`）→ 升音级 → 存档 → 读档 → 数值一致。
- **实机视口评审仍受 KI-010 限制**（本环境无法打开可见浏览器窗口）：面板用最小 DOM 替身验了
  状态机/渲染内容/动作派发，但排版与手感的视口走查未做，登记在 KI-027。

### 10.7 乐章战技（谱册）— Phase 5-C2 已实现：三层各管一件事

需求 §57 的"Ability 架构"在本作落成一个**静态表 + 状态层 + 结算层**的三层结构，谁都不越界：

| 层 | 位置 | 回答的问题 | 拿不到的东西 |
|---|---|---|---|
| 静态表 | `src/data/json/movements.json`（第 10 份受门禁 JSON） | 有哪些页/式/槽、点亮吃什么、L1→L3 数值、帧形状、`damage.scaling`/`perOverdriveLayer` | 不认识任何运行时状态 |
| 状态层 | `src/rpg/Movements.ts`（`MovementBook`） | 哪几页亮了、这一式几级、两槽装着什么；`loadout()` 合成 `{f, cast}` | 不出手、无 three、无 DOM、不直接改背包（扣款走传入的 `Inventory`） |
| 结算层 | `player/ThirdPersonController.ts` + `combat/CombatManager.ts` | 按键→起手→命中→扣过载/体力→起冷却 | 不写死任何数值，全部读 `loadout()` 给的那份小表 |

接线口径（都是测试钉住的，不是描述性承诺）：

- **槽位＝输入动作名**：`slots[].action` 写 `weaponSkill`/`weaponSkillB`，`DEFAULT_BINDS` 把它们绑到 **R / C**
  （手柄 A 面按钮同键）。开槽门槛写 `milestone`（`ms_movement_slot` / `ms_movement2`），由 `progression.json` 解析成音级，
  代码里没有第二个常数。
- **点亮页＝吃掉数据点名的那件东西**（`it_resonance_core` / `it_score_fragment`），先验后扣：钱不够一件都不扣。
- **出手走同一条 `strikeEnemy`/`resolveDamage`**，只多带一个 `movement` 标记：于是战技继承既有的 i-frame、
  格挡/弹反、震裂、处决窗口等一切，而不是平行发明第二套战斗。`mvMul = 1 + 剩余过载层 × 0.04`，
  不吃 `weaponDamageMul`/武器 `scaling`/`poiseMul`（combat.md §4.8）。
- **冷却按槽不按式**：同一式装两槽各自计时；被拒的按键（冷却中、闷音、过载不足）不起冷却、不扣资源。
- **`setSkills()` 不清冷却**：换装不该把刚交的学费退回来，这条在 flow 里钉了一条负例。
- **读档后 `refreshRpg()` 负责重新 `setSkills`**：`SaveGame.apply()` 只回数据，不伸手碰玩家实例（§9 的组合根纪律）。
- 覆盖：`tests/unit/movements.test.ts` 16 条（状态层，headless）+ `tests/flow/movements.test.ts` 17 条
  （真帧数据下的出手/封锁/存档往返，同种子把三条设计承诺钉成精确等式）+ `tests/unit/stakerite.test.ts` 谱册动作派发 1 条。

## 11. 状态系统（combat.md §11 五态）— Phase 5-C1 已实现

**一张表 + 一个模块**：数值全在 `src/data/json/statuses.json`（新增第 9 份受门禁的 JSON），
行为全在 `src/combat/Statuses.ts`（零 three、零 DOM）。此前这四个状态是散在代码里的常量，
§11 文档说的数和实际跑的数没有对账通道 —— 现在两边都有断言钉住。

| 态 | 数据行 | 唯一消费方 | 读数出口 |
|---|---|---|---|
| 震裂 | `fissure`（maxLayers/dmgMulPerLayer/idleTicks/decayEveryTicks/burst） | 计层与两段式衰减在 `EntityStats.addFissure`；每层的倍率与碎裂结算在 `CombatManager`（攻方与受方两条通道同用一个乘子） | `ui.status`（边沿量：层数变了才播） |
| 闷音 | `mute.regenMul` | `Statuses.armStats` → `EntityStats.mods.regenMul` 通道 | `player.stats.muteTicksLeft`（会自然到期的量走状态对象） |
| 回响 | `echo`（delayTicks/replayMul/radius/maxShadows） | `CombatManager.spawnEcho` → 影子队列按拍重演 | `ui.status` |
| 失谐 | `corruption`（max/eliteHit/visualStart/hpPerSec） | `CorruptionMeter`（`player.corruption`）+ 区域 `corruption.perSec` | `player.stats` 三件套 + HUD `filter: saturate()` |
| 共振过载 | 只有 tooltip（`overdrive`） | 数值归属 `progression.derived.overdrive` 与 `player.json`，**不在这里重复写一遍** | HUD 内圈辉光 |

三条口径是这次收口真正的产出：

1. **材质倍率不写在状态表**。§11 的「对装甲/晶体 ×2」是**目标的属性**，所以它落在
   `EnemyData.fissureMul`（嘈壳）与 `BossPhase.shell.fissureMul`（壳期奥斯塔拉），由
   `Enemy.fissureEffectMul = (data.fissureMul ?? 1) * shellMul` 合成。原先 `statuses.fissure.crystalMul`
   是一个没人读的字段（§55 违例），门禁现在会把这类字段判成 ERROR。
2. **谁触发回响由招式自己说**：`frames.echoOnHit`。结算通道不再按"这是重击"猜——
   三把近战武器的 `h` 挂了它，敌人重击没挂，所以敌人打人不会产生回声影。
3. **施加时长归施加方**：`statusOnHit.ticks` / `projectile.muteOnHit`，状态表只给"挂着的时候值多少"。

表现层不自己读阈值：去饱和用 `CorruptionMeter.veil()`（`visualStart → max` 的线性 0→1），
用 CSS `filter: saturate()` 近似后期 shader（ENV-001 的降级映射，不是"已经做了后处理"）。
"本局第一次见到某状态就把 §19 的 tooltip 播一遍"由 `StatusGlossary` 记账，`main.ts:bootWithSave()`
每次启动 `forgetAll()` —— 读档与新开局都是一次新的解释机会。

覆盖：`tests/unit/statuses.test.ts` 27 条（表本身 + 计量表 + 台账文案）与
`tests/flow/status.test.ts` 19 条（真帧数据下把四态在战斗流里跑出来）。
flow 侧的关键技巧是 `CombatManager` 的 `rng` 每实例固定种子 ⇒ 两个同构造世界消耗同一条随机序列，
于是"基线 vs 加成"可以精确对差，不必为了可测性放宽生产代码。

## 12. Boss 入场演出 · 胜利序列 · 首杀奖励（Phase 5-C2b）— 已实现

§16 那行「Boss 均带：3 拍入场演出 + 胜利序列（音乐停=世界屏息 0.5s）」此前只有半句是真的（振源核确实掉，但没有任何演出承载体）。这一节的产出是**两件此前不存在的原语**，而且都没有为 Boss 特判。

- **`boss.intro` / `boss.victory` 是数据格，不是脚本**：`intro.beats` 写"几拍"，`victory.holdTicks` 写"屏息多久"，`sfx[]` 与 `label` 是可选的音与字。`scripts/validate-data.mjs` 现在要求**每个带 `boss` 的敌人两格齐全**（缺格 = ERROR），所以"Boss 均带"由门禁保证，新增 Boss 忘了写就进不了库。万籁为此补了一整个 `boss` 块（`intro` 故意不带 `sfx` ⇒ 她的登场是"没有声音"，§15.3）；核对过：`syncClock` 要 `bpm`（她没有 ⇒ 不接管网格）、`syncBoss` 单阶 no-op、阶段白名单等于她自己的全招表，所以加这一格**不改变她的身份**。
- **拍长换算发生在"开始演的那一刻"**：`Enemy.enter()` 只登记 `introQueued`，`tickIntro()` 才用 `rhythm.beatTicks`（`RhythmClock` 新增的只读量）把 `beats` 换成 tick。顺序是必须的 —— `AISystem.syncClock` 在进战的**同一个 tick** 才把全场网格换成她的私有拍速，早算就按区域的 84BPM 算了，等于用别人的心跳演她的登场。派生而非成对事件：没有 enter/exit 两半要配平。
- **硬直窗口是一条 `return`，不是一串禁用位**：`if (this.introTicksLeft > 0) { faceSlow(this, p); return }` 放在状态 `switch` 之前 ⇒ 不出手、不挪步、不排读条，但 `strikeEnemy` 完全不看这里，**这几拍照吃伤害**（设计要的白送开局，flow 里钉着：演出中段一记 25 伤弹体 ⇒ 血掉了、`introTicksLeft` 一格没少）。`introPlayed` 让它只演"第一次照面"，脱战再回来不重演，否则这个窗口可以刷。
- **"世界屏息"在 ENV-001 下的替换件 = `hitStop` + 瞬时静音**：`GameTime` 是全作唯一能把逻辑时间压慢的东西（`hitStop(sec, 0.05)`），所以 0.5s 屏息就写 30 tick 的 hitStop；音乐侧新增 `audio.music.encounter { start:false, cut:true }` —— `cut` 与脱战那条 4s 淡出是**两种语义**（淡出听不出"停"），只掐战斗层，氛围 drone 不断（IP §6 要的是屏息不是关机）。如实记账：剪影特写/镜头轨道/逐帧演出属 Phase 7 表现层，转阶段的全频低通属 Phase 8 混音。
- **需要真实时间的播报按 `realSeconds` 排队**：`cadenzaPending = { atSec, text }`。原因是这套引擎的 hitStop 只压 `time.dt`，定步长循环照旧 60 tick/s —— 若按 tick 排队，"安静里不落字"会变成"落字和死亡同帧"。`CombatManager.bossBits()` 是它的唯一出口（该函数现在承担三件事：钟、阶段、屏息收尾）。
- **首杀唯一从"设计说法"变成数据事实**：`it_resonance_core` 从 `loot.rolls` 移到 `loot.firstKill`（奥斯塔拉/恩希尔/万籁三张表），`SpawnDirector.cleared` 让死亡永久 —— 否则将来一旦允许 Boss 重生，振源核就成了可刷货币，而 §9.3 的"首杀唯一"是空话。flow 里两条断言把这句话钉住（第二次打死同一份数据：核不再掉，常规 rolls 照旧）。
- 覆盖：`tests/flow/bossshow.test.ts` 6 条（拍长精确等式、整窗零出手零位移且演完归零、只演一次、`boss.defeated.holdTicks`、`cut` 恰一条且 `rawScale<1`、屏息未完不落字）+ `tests/flow/rpg.test.ts` 首杀 1 条。实机（5199，逻辑步进 + 真渲染各跑过一遍）：进战当 tick `introTicksLeft=100`（她自己的 108BPM×3 拍，`rhythm.beatTicks=33.33`）、窗口内 0 招 0 步、**第 100 tick 出第一招 `swordchain1`**；击杀帧 `rawScale=0.05`、30 tick 后回 1、`{start:false,cut:true}` 恰一条、提示顺序是「获得 振源核」→ 屏息 →「奥斯塔拉止息 · 振源核落在钟影里」；控制台 0 error。
- **一次真实的测试副作用（记在这里，不当作已清理）**：`boss.defeated` 现在会触发检查点存档，所以实机探针打死区域 Boss 后 autosave v4 被写了两次（控制台可见两条 `save.ok`）—— 那是本地 playtest 存档里的"奥斯塔拉已死"，不是产品缺陷。

## 13. G5 出口验收：整链闭环、两条保底与掷骰位置（Phase 5-C3）— 已实现

需求 §59 那条「Start → 战斗 → 掉落 → 拾取 → 装备 → 强化 → 升级 → 存档 → 重载」的闭环，此前**只在中间 API 上测过**：
flow 测试直接调 `rpg.onEnemyKilled(...)`，于是组合根里那串胶水（谁进背包、谁灌回面板、什么时候该存档）一行都没被测到
——漏掉 `refresh()` 或漏掉检查点，测试照样绿。这一阶段先修结构再谈验收，五件事：

- **胶水下沉到逻辑层**（`src/rpg/Settlement.ts`）：`KillSettlement`（订阅 `entity.died` → 结算 → 播报 → `refresh()` → 升级才 `checkpoint('levelup')`）、`refreshPlayer`（mods 灌回面板 + 按装备栏真的换手里那把武器）、`openLootTable`（交互物返回值里的 `lootTable` 落到背包）。三者都不 import `PlayerController`/存档类——玩家以结构性接口 `ModsSink` 进来，落盘时机由外面注入。`main.ts` 只剩接线，`dispose()` 让测试能一次拆掉监听（不拆的话同一进程里两份世界会互相把对方的击杀结算进自己的背包）。
- **整链在真机上也走了一遍**：8 只嘈壳（真输入帧驱动的轻击连段）⇒ rank 1→2、音色石 0→21、掉落播报 11 条、`checkpoints.writes=1 / lastReason=levelup`、`gearStreak 0→1`、`rollStreaks{loot_murkshell:gear:7}`、耗时 5.5s。**视口/录屏评审依旧做不了**（本环境打不开可见窗口，KI-010），所以 G5② 那条"录屏对照"只交付了 headless 等式 + 实机逻辑读数两层，缺的那一层写在 KNOWN_ISSUES 的 G5②③ 行里。
- **架构闸门补漏**：`tests/unit/arch-boundaries.test.ts` 的 LOGIC 清单此前**不含 `rpg/` 与 `save/`**——这两个目录里任何一个文件 import 了 three，闸门也不会红。补进去并把 `rpg/Runtime.ts`/`rpg/Settlement.ts`/`save/Serializer.ts` 列入"必须被扫到"的点名清单（防清单再次漂移成空测试）。
- **两条 pity 是一条都没实现过的那一条**：`LootRoll.pity` 在 8 张表里写着、schema 里注释着，运行时**没有任何地方读它**（需求 §55 的违例）；反过来 §9.4 全局大保底的 `10` 与 `'rare'` 两个数硬编码在 `Loot.ts` 里。现在前者由 `LootDirector.attempts()` 逐条消费（键 = `${表id}:${roll id}`，计数入档 ⇒ 读档继续攒而不是清零白送），后者搬进 `progression.json.pity = { every: 10, floorRarity: "rare" }`。两条语义**互相排除**并各有断言：容器保底只保证"掉"，不许抬稀有度；大保底只抬稀有度，不许改掉落频率。数据侧同时补了门禁（`pity` 必带 `chance`、同表 `roll.id` 不得重名，否则两条 roll 会共用一格计数）。
- **掷骰位置入档（存档 v5）**：`Rng` 现在自己记 `{seed, calls}`，`Inventory` 快照带着它走。此前 §10 那句"掉落随机种子入档"只做了一半——种子的**起点**在构造参数里，抽到第几笔不在，所以同一份档每重载一次就把掷骰序列倒回开局（表现是"档没问题、掉落却对不上"）。真机实测（5199，只跑逻辑不渲染）：读到档那一刻 `calls=44`、`rollStreaks{loot_murkshell:gear:7}`，之后继续打的 3 只把它推到 59/10，再读一次同一档 ⇒ 五项状态逐字退回（`reverted: true`），一次崩溃的亏损被钉在"上一个检查点之后"那一截（30 点遗响 < 升一级要的 75）。
- **力 / 律对照给出了一个不好听但真实的数**：同一只驼鼓、同一颗种子、同一份输入脚本 ⇒ 力 613 tick / 9 发 / 单发 28.7，律 1221 tick / 29 发 / 单发 8.3。差出两倍这件事登记为 KI-039 等数值裁决（脚本是站桩对砍，不吃枪的射程优势，所以它是上限而非体验值）；测试里的容忍带按实测放宽，不为了变绿而声称两边一样快。另有一条纯标尺断言走生产公式 `resolveDamage`：同一把轻剑上指法占优、同一把重剑上基音占优——"哪一维值钱"是 `weapons.json.scaling` 说了算。

## 14. Phase 6-A 第一步：世界状态的持久化与同步（存档 v6）

Phase 6 的对话与任务全部要读写"世界状态"，所以动手写内容之前先把这层的账对齐——一对齐就抓出两个真 bug：

- **一次性交互物从不入档**：`Interactables.used`（开过的遗箱、放下的吊桥、裂开的音壁、单程共鸣井）是纯内存态。
  区域 flag 和出怪清剿记录都入档了，唯独它没有 ⇒ **读一次档 = 全世界的箱子重新能开一次**，这是玩家可利用的掉落复制，
  也是 §45「只存世界状态」的一句漏账。修法是把它做成 `Snapshot.usedInteractables: string[]`（v5→v6 正式迁移步），
  存 id 数组而不是布尔位——加一个交互物不需要动存档 schema。老档只能写空集：那份档确实没记过谁被开过，
  于是它的箱子会再掉一次 loot，这是历史缺失的代价而不是补偿（§78：补一笔"其实你开过了"就是编数据）。
- **写 flag 有两条路，存档走了不通的那条**：`StreamingSystem.setFlag` 的注释写着"测试与调试器用；正式路径走 bus"，
  而存档 `apply()` 恰恰在调这个只登记不广播的口 ⇒ 读档后流送层认为旗标立了、交互层还认为没立
  （表现：音壁早已裂开，箱子仍回答"上着锁"）。现在 `setFlag` 与 bus 广播是同一条路，两套缓存由同一个事件源同步；
  这也让 `apply()` 不必再关心"还有谁在听"。
- **两条都做了反向实测**：把 `interact` 从 SaveWorld 摘掉 ⇒ 3 条断言红；把广播摘掉 ⇒ 同步那条红。
  覆盖在 `tests/flow/interact-save.test.ts`（5 条：遗箱复原、采集点/吊桥同样复原且不误伤调音桩、
  老档空集不崩、快照排序可比对、flag 读档后两路一致）。

**下一步（同一 Phase 6-A 的正题）**：`regions.json` 里被读的 8 个世界 flag 目前**没有任何运行时写入方**，
四张隐藏房奖励表因此玩家永远领不到（KI-041）。这一步要做的就是把"发生了什么 → 立哪个旗标"变成数据规则，
而不是散在代码里的布尔——也正是 narrative §7 那句"禁止代码内散落硬编码布尔"的执行位。

## 15. 世界状态写入层与隐藏房可达性（Phase 6-A 第二步）— 已实现（8/8 旗标都有写方，KI-091 销空最后一条）

narrative §7 那张旗标表写的是"什么时候该立哪个旗"，`regions.json` 写的是"哪个旗开了哪道锁"——
**中间那一环（谁去立旗）从来没有人写**。于是 8 个旗标只有读方，四张隐藏房奖励与一只 T2 箱玩家永远拿不到；
逐文件校验全绿，因为读半截和写半截各自都"合法"（KI-041）。这一步补的就是中间那一环：

- **`data/json/worldstate.json`＝规则表**：一条规则＝`{on, 匹配位, setFlag, notify?}`。三种触发器都有真实来源：
  `firstParry`（玩家第一次成功弹反 ⇒ `flag.parry_taught`，音壁捷径的设计前提就是"先学会还拍子"）、
  `bossDefeated`（杀掉奥斯塔拉 ⇒ `flag.ostlara_defeated`，那只 T2 箱从此有钥匙）、
  `interactUsed`（敲响落钟 ⇒ `flag.bell_interior_open`，钟腔封存点从"上着锁"变成撬得开）。
- **`quest/WorldState.ts`＝引擎**：只读表、只广播。它**自己不存旗标**——写旗的唯一路径是 `bus.emit('world.flag')`，
  流送层与交互层各自缓存同一个事件源（Phase 6-A 第一步刚把这条统一掉）。幂等：旗已立就不再动、不再重播播报，
  所以它可以被每 tick 调用。`dispose()` 存在是因为总线是进程级单例。
- **`world.interact` 是一条新事件**（成功失败都发）。有了它，"某件事被做过了"不再需要 main.ts 逐个转达；
  第一消费者就是 `interactUsed` 规则。
- **隐藏房的奖励入口挂在 secret 自己身上**：`InteractableRef.secretId` 指向同区域的 `secrets[]` 条目，
  交互物构造时从那条记录取 `unlockFlag` 与 `rewardTable`。于是 `SecretRef.unlockFlag`/`rewardTable`
  第一次有了真消费者，也不会出现"箱子上再抄一份旗标"的第二真值（闸门禁止）。钟腔那只箱子就是这么变成
  隐藏房领取点的：`loot_secret_bellinterior`（晶声/史诗档）从此可达。
- **顺手补掉 KI-042：`rareplus` / `epic` 两档此前一件装备都没有**。`gearBand` 掷到它们时
  `pickGearItem` 返回 null ⇒ 函数安静地返回空数组，玩家打开隐藏房"什么都没有"而不报任何错。
  补了四件（蒙钟盔 / 音徽·起拍 / 钟皮胸甲 / 音徽·留鼓，全部沿用既有词缀表），并把这条判据变成闸门：
  **`gearBand` 用到的每个稀有度必须在 `items.json` 有至少一件装备件**。
- **这一步的账已经销空（2026-09-29 追记）**：KI-041 那份「被读但没人写」的 8 条清单由 KI-081
  （`brokenbar_resolved`）、KI-087（`side_nave_found` / `brokenbar_allied`）、KI-091
  （`found_first_phrase`：无耳深窖井底那扇门，四环线索齐才认你）销完 —— `PENDING_FLAG_WRITERS`
  现在是**空**的（空就是它的目标状态），五条 secret 的坐标也都落回各自的本层地板（`floorAt` 不再为 null）。
  隐藏房这边新长出来的那一格是**合取闸门** `InteractableRef.requiresFlags`（AND）：单面旗说不了
  「四件事都发生了吗」，井底那扇门就是它的第一个消费者（锁文本会说清还差哪几件），细节见 §5.9.28。
- **仍然欠着的**：①§4.8 环⑤ 的第二个条件（`STATE.BELLS.FIRST..FOURTH` 已修）今天**无处表达**，
  而且它与 `narrative.md §8` 验收那句「存在不依赖任何 NPC 对话的纯环境推理通关路径」打架 ——
  裁决留给需求文档持有者；②任务步骤机（QuestState）与对话效果原子集未做：这张表目前只表达
  「发生过 X」，还不能表达「任务第 k 步完成」。
## 16. 错拍步的落地窗口（KI-035）— 已实现

§7.2 给瞬步写了两件事：一步 2.5m，以及**落地 0.3s 内自己的攻击架式伤害 +3**。位移早就在了，
后半句一直没做，因为全项目的成长乘数走的是 `PlayerMods` 那张**静态汇总表**，而这一笔是
"下一记之内有效"的**带时限加法项**——硬塞进去会让 mods() 变成每 tick 都要重算的可变状态。

- 数据：`movements.json` 的 `mv_syncopace` 多一格 `landing: { poise: 3, withinTicks: 18 }`（§55：0.3 秒
  不写在代码里换算，tick 数就是数据的口径）。闸门新增：`landing` 的字段与区间、以及
  **写了落地窗口但这一式没有 `distance` ⇒ ERROR**（没有位移就没有"落地"，那一格永远不会触发）
- 合成：`rpg/Movements.actionFor` 把它放进 `SkillCast.landingPoise / landingPoiseTicks`，与 damage/distance 同一条路
- 状态：`PlayerController.landingPoise`（+ 私有 tick 计数）与 `followup`（全音符斩压在下一记上的真伤）同类，
  都是"下一段窗口内的加法项"，所以住在玩家战斗态而不在 mods 表里
- 结算：`CombatManager.strikeEnemy` 把它加在**乘法之前**（`poiseBase = s.poise + landingPoise`，
  语义是"这一击本身的架式值变高"），并且**只给武器出手**——战技不吃武器架式倍率那条口径同样适用于它；
  `combat.hit.poiseDamage` 一并报真实压出去的基数（遥测不撒谎）
- 起算点：**这一式结束、手又能动起来**的那一刻。为什么不从判定窗末（`activeEnd`）起算：错拍步的
  `recovery` 是 20 tick 而窗口只有 18 tick，从 activeEnd 起算加成会在玩家能出手之前自己走完——
  这是 flow 测试实测出来的（用重击量时窗口永远赶不上落点，换成轻击才对得上），不是拍脑袋定的口径
- 覆盖：`tests/flow/movements.test.ts` 新增 4 条（窗口打开的时刻与数值全来自数据 / 窗口内外那一记差值
  **恰好等于表里的 poise** / 改数据差值跟着改 / 没有 `landing` 的式子不吃这笔）
- 实机（5199，只跑逻辑不渲染）与 headless 给出**同一对数字**：踏出这一步后 `player.landingPoise=3`，
  落地即砍轻击 `combat.hit.poiseDamage=9`；空等 26 tick 再砍同一记轻击则是基础值 `6`。+3、窗口的打开与关闭
  都在真循环里复现到个位数，两侧不是各说一套
  顺带一条**不是 bug 的观察**：第一遍探实时 `tryStartAction('weaponSkill')` 返回 false，原因是这只钉桩的驼鼓
  命中会挂 999 tick 闷音（`enemies.json` 的数据），而闷音封战技正是 §11/Phase 5-C2 定的规则——
  清掉 `muteTicksLeft` 之后一切照常。探针读数前先确认没有把自己闷住，这类"被自己的机制挡下"不要记成缺陷

### 5.9.19 营地归属是一次真的三选一：值域承载抉择，「末步」不等于「收束」（KI-081，2026-09-28）— 已实现

- **补的是断弦线的空档**：`DLG_HALTRUNE` 的初见把玩家按在"跟着尸体军阵走完一圈、别出手"上（步 1），
  但"走完之后呢"在数据里是断的——`q_haltrune` 的 `HALTRUNE.STEP2_ROSTER` 没有 `advanceOn`，
  "名册"那半句台词挂在一枚没人读的旗标上，树里也没有承接它的节点。
- **谁说了算：值域表，不是旗标**。营地归属是**一个**枚举，不是三个互斥布尔——`states.json` 新增
  `state.haltrune.camp = INTACT / OUTPOST / RUINS / GARRISON`（缺省 `INTACT` ＝ 还没替他填名册）。
  第一版在对话效果里**同时**写了 `flag.haltrune_camp_decided`，被 `validate:data` 的两条反向对账当场拦下：
  ①值域**没有读方**（三个后果节点当时靠 `once` 而不是靠读数）、②那枚旗标**没有读方**。两条指向同一件事：
  值域与旗标各说一遍就是两个真值 ⇒ 旗标删掉，营地的读数只剩一格。
- **读方是任务步**：`HALTRUNE.STEP2_ROSTER.advanceOn.state` 认 `OUTPOST/RUINS/GARRISON` 三值——
  与铃姨《该不该敲响》（`BELLS.STEP4_DECIDE`）同一套"由值域收束"的形状。区别在这条线**没走完**：
  新增 `HALTRUNE.STEP3_LASTWATCH`（**故意没有** `advanceOn`）承接收编冲锋 / 逐个劝停 / 留给恩希尔
  三种收尾，那是 Phase 6-C 的演出。`Quests.isComplete` 的判据是"末步的 `advanceOn` 命中"，
  所以营地既定之后 `isComplete` 仍是 false——停在末步意味着任务**正在进行**，任务簿不撒谎。
- **复访靠探针链，不靠 `once`**：`fallbackNode = n5`（决策提示）→ `n5.next = n7` → `n8` → `n9` → `n10`。
  条件不成立就沿 `next` 试下一个，于是"决定之后复访"直接落在那一句后果上（`n7/n8/n9` 各认一个读数），
  "只是见过面、还没走完巡逻"落在中立的 `n10`——两种情形都不需要多存一份状态。形状是从铃姨那棵树搬来的。
- **守卫**：`tests/flow/haltrune.test.ts` 5 条（见过面不算走完巡逻 / 三选一写读数并把线推到《最后一班岗》
  且 `isComplete=false` / 三种写法各写各的值且决定不可回退 / 不再另立与值域重复的旗标）。
  数据门 `validate:data` **0 ERROR**。
- **派生的世界后果（同批第二步）**：三个形态里今天真正改世界的是**派生旗标**——收编与清算各写
  `flag.brokenbar_resolved`（出怪表的 `!flag.brokenbar_resolved` 与营地仓库箱 `ch_brokenbar_chief` 的
  `requiresFlag` 是它早就写好的两个读方），驻防地刻意**不写**（营地仍有人守）。值域仍是唯一的**抉择记录**；
  旗标是给「只认旗标字符串」的既有通道用的**后果**——与上一步删掉的 `flag.haltrune_camp_decided` 不是一回事：
  那枚是抉择的 1:1 副本且没有任何消费方，这两枚各有真读方。
- **出怪腿的现场量法**：`tests/flow/haltrune.test.ts` 那一条把地图上的 `en_murkshell` 数出来——没抉择 ≥4 只、
  收编之后**离开再回来** 0 只。量的是「不再刷新」而不是「当场消失」：condition 只在落地时求值，
  离开激活圈由 `world.chunk` 事件把活着的收回去（与 `main.ts` 同一条路）。顺带销掉 `PENDING_FLAG_WRITERS`
  里挂了两周的 `flag.brokenbar_resolved`（账本判据自己会报「该销」）。
- **没做（§78）**：①营地既定之后**场上还没有任何东西改变**——友军哨站 / 废墟 / 恩希尔驻防地三种形态的
  陈设组换、换防口令、通往 Boss 区的敌群配置都没接（`STATE.CAMP` 那一列的"改变的世界"今天只有对话可见）；
  ②步 3 的三种收尾演出（列队冲锋 / 与"活鼓"副官的精英战 / 潜入）未做；③步 4《义体尽头的拍子》与
  `STATE.HALTRUNE`（ALIVE_AT_POST / PASSING_STILL / DRUM_LEGEND / HOSTILE）、"叛哨"敌对分支未做；
  ④"纯闪避走完巡逻周期"的**未出手统计**仍只是数据里的一句话：需求 §28 禁止计数器型任务，
  这条要用事件型判据表达，留给该线批次；⑤视口评审未做（KI-010 同因）。

### 5.9.20 数据表的文本完整性：一个不与任何判据相交的坏，和给它的一句机器判据（KI-082，2026-09-28）— 已实现

- **病**：本机有一条**并行的写盘路径**，把中文写回 JSON 时会按别的代码页编/解码一次，产物是
  **U+FFFD 替换字符**。它的形状很特殊——**不与任何既有判据相交**：文件仍是合法 JSON（`JSON.parse` 过）、
  字段仍对得上 `schema.ts`（白名单过）、数值仍在范围内（`report.num` 过），tsc 与运行时也都读不出它。
  只有那一段中文悄悄少了几个字，而且**丢掉的是哪几个字没人知道**。实测样本：`states.json` 的
  `§2.3` 被压成 `\uFFFD?.3`（随 `2300ad1` 进主干，直到本批才有人看见）；当日 20:05 更重的一次是
  `states.json` 13 个 U+FFFD、整个文件不是合法 JSON，`quests.json` 也不是合法 JSON。
- **判据住哪**：`scripts/text-integrity.mjs`（+ `.d.mts`）。与 `ledger-rules.mjs` / `explore-rules.mjs` /
  `battle-rules.mjs` **同一条理由**：`validate-data.mjs` 一被 import 就去校验真表并 `process.exit`，
  本沙箱连 spawn 子进程都被拒（KI-075）⇒ 判据留在那里，测试就没法"喂一段坏文本看它拒不拒"。
  只认 **U+FFFD** 一个字符：合并音标（U+0301）、变体选择符（U+FE0F）、零宽连接符（U+200D）、emoji 组合
  各有正当用途，拿它们定罪就是一台误报机器；`U+FFFE`/`U+FFFF` 那一族（UTF-16 字节序错位）本机没有
  实测证据，**不预先编判据**（§55 那条"没有消费方不写进表"的纪律，对判据同样成立）。
- **接线**：`validate-data.mjs` 的数据加载循环把每份表的**原文**留在 `sourceText`（只看 `JSON.parse`
  之后的 `data` 是看不见坏字符的），随后对 20 份表逐份报 ERROR。报告的形状：一行一条（同一行坏几个
  在同一条里把列号都点出来——一处手误报成两条，反而看不出是同一个地方）、带上下文（`JSON.stringify`
  转义，避免把"一条一行"的门禁输出撑成一段）、带修法（"按设计原文重新敲回去"，并说明改编码设置
  救不回已经丢掉的字节）。
- **为什么 `where` 是行号而不是 JSON 路径**：坏字符是在**文本**层面出现的，压坏之后那条路径自己都可能
  读不出来（比如坏在一个 key 的中文里），能指路的只有行号 + 上下文。
- **守卫**：`tests/unit/text-integrity.test.ts` 9 条，其中三条各自守一个容易做错的方向——① 位置逐个数；
  ② 干净文本零误报（那一串正当的 Unicode 字符一个都不许被抓）；③ **「坏字符不破坏 JSON 合法性」
  单独钉住**：`JSON.parse` 不抛 + `findMojibake` 命中，这条用例就是当年漏掉它的原因本身。
  另外还有一条**真表哨兵**（`src/data/json` 逐份扫，一个 U+FFFD 都不许有）与一条**源码门**（校验器
  真的把判据接在每一份表的原文上，不是只写了个模块放在那儿）。
- **反向实测**：往 `items.json` 第一处字符串值里塞 1 个 U+FFFD ⇒ `validate:data` 恰报 1 条
  （第 3 行第 10 列，上下文与修法都对）+ 真表哨兵恰红 1 条；随后按 sha256 核对内容仍是自己写的那份
  再原样还原（还原后 `0 ERROR / 4 WARN`）。顺带把 `states.json` 里 `2300ad1` 留下的那一处修回 `§2.3`。
- **没做（§78）**：① 文档与源码里的文本不在本门范围内（坏字符同样可能落在 `docs/**`，但那要先把
  口径定成不误报的，再谈覆盖）；② **写坏中文的那条写盘路径本身不在本仓库里**（它是并行会话的写盘
  方式）⇒ 这道门是「发现」而不是「防止」：下一次压坏会在门禁上响亮地出现、但不会自动消失；
  ③ 被压成 `?` 而不是 U+FFFD 的那种坏法抓不到（没有样本的那种）。

### 5.9.21 §4 的 L2／L3 声景层第一次有读者：一张床多了几条会响的真位置声源（KI-083，2026-09-28）— 已实现

docs/audio.md §4 那张表里，**L2 颗粒声纹**与 **L3 物理动源**是最后两格零读者（KI-077 落地时只兑现 L1 drone + L4 铃点，并把这两格登记为未做）。这一批把它们接上，同时做了两件同源的事：把"声源 → 听者"那一步抽成**唯一主人**，把整张 `ambience.json` 的判据从校验器搬进独立的规则模块。

- **数据形状**：`schema.ts > AmbienceSource = { layer: 'texture'|'motion'; hz; pos{x,y,z}; peak; attackSec; durSec; everySec: [number, number] }`，`AmbienceBed` 增**必填** `sources: AmbienceSource[]`。`durSec` 的注释写成「起音**之后**的衰减时长」——它此前是含糊的"时长"，而它与 `attackSec` 是两件事：一记 0.001s 起音、0.05s 衰减的水滴，和 1.6s 起音、4.2s 衰减的金属应力呻吟不是同一种声音。
- **数据**：7 张床各 2–3 条，共 **19 条**真位置源，每条落在**它自己那一区的 bounds 内**（门禁量，不是注释承诺）。`mus_brokenbar_amb` 的巡逻脚步刻意 `everySec: [1.2, 1.2]` —— §4 那格「死军阵：永远整齐得不对」在数据里就是**间隔没有抖动**：零方差是一句设计，不是忘了填区间。
- **`src/audio/spatial.ts > spatialize()` 是"声源→听者"的唯一主人**：那段数学（按世界坐标算斜距、算出增益与 `StereoPanner` 的声像）原本**只长在 `AudioEngine.onSfx()` 里**，本批把它抽出来，一次性 SFX 与声景层共用同一份（常数一字未改）——否则"走两步就换边"这件事会在两支读者里各有一把尺子，迟早一边改了另一边没改。`ListenerPose`（世界坐标 + yaw 弧度）现在是一个对象而不是四个散字段；`AudioEngine.setListener()` 收下它、转交音乐层，并在 `start()` 里补送一次（首次手势之前 `main.ts` 的每一帧只落在缓存里，少了这一句出生区的第一条源就没有位姿可算）。
- **`src/audio/ambient-field.ts > AmbienceField`**：每源一根自己的计时器，到点用 `synth.playNoise` 掷一声带通噪声 + `StereoPanner`，收尾走 KI-071 记的那条哑源/`onended` 账。两层的音色只用 Q 分开：`texture` Q 固定 2.5（颗粒），`motion` Q 0.8 且中心频率取 `hz × 0.62` 边扫（风/链的长音形）。**没有一样音色参数写在这个文件里**——全从数据那四格现推。
- **声景层不等 crossfade 窗口**（与 KI-077 那条 8 小节刻意不同）：它们是"一次一声"的事件而不是要淡的持续图，跨区只意味着"下一声属于新区"，已经掷出去的那一声**不抹**（KI-066「不篡改时间线」同源）。所以 `MusicLayer.setAmbience()` 在换床之外**即时** `field.setBed()`，构造函数开局也喂一次；`field.update()` 排在战斗层那道 `scheduling` 门**之外**——声景不是战斗音乐，没在交战也该听得见。
- **判据本体搬进 `scripts/ambience-rules.mjs`（+ `.d.mts`）**：与 ledger/explore/battle 同一条理由（`validate-data.mjs` 一被 import 就去校验真表并 `process.exit`，喂非法行这半在测试里做不了）。导出字段表、两层名、四波形与 `MIN_ROOT_CENTS`，以及 `ambienceFindings()`；`validate-data.mjs` 里那 8 行手抄名单删掉改成 import，`validateAmbience()` 缩成"两张嘴"（findings → ERROR/WARN 加 `report.num` 管的数值可闻带）。**这一搬顺手补上了 KI-077 内联时从没量过的 refuse 侧**：drone／铃点那两支此前只有 accept 侧有人量过。
- **守卫**：`tests/unit/ambience-table.test.ts` 38 条（accept 侧含真表实测、声源 12 条 refuse 臂、drone／铃点 10 条 refuse 臂、结构性脏数据与双向对账、四道"唯一主人"源码门）、`tests/unit/ambience-field.test.ts` 11 条（到点/没到点、两层音色、位置与 `spatialize` 同源、听不见就不建节点、高度差进衰减、换床不抹在飞的那一声、同床重发不重掷、响完自己收线），`audio-engine.test.ts` 新增 3 条端到端（真表床 + 真位姿、听不见的那一区、与一次性 SFX 同源）。判据里有一条 `opaque` 守卫：有源的 `layer` 读不出来时**不判"少了哪一层"**，否则一处的错会报成两条，反而看不出是同一个地方。
- **门禁（2026-09-28）**：`tsc --noEmit` 0 错；`validate:data` **0 ERROR / 4 WARN**（`ambience.json` 只剩 KI-077 那条刻意保留的 `bell.everySec` 登记）；定向跑测 4 文件 / 150 条全绿。
- **没做（§78）**：① §4 原文写的 `PannerNode + HRTF` 没有做，本作走 `StereoPanner`（§4 之前一次性 SFX 已经是这条路；HRTF 要真做，两支读者必须**一起换**，只换一支等于把"同一条尺子"拆成两把）；② `motion` 那格「越深声音间隔越长（-1s/100m）」（无耳深窖）仍是文档里的一句话，本批的 `everySec` 是固定区间、没有深度递减规则；③ L4 的「30–120s 稀疏事件」与本表 5–9s 铃点仍是两条口径（那条 WARN 登记着，挪它是听感裁决）；④ 听感不可评审（KI-010）。

### 5.9.22 §34 锁定那四个数进了表，顺带把两句设计文档折成不等式（KI-084，2026-09-29）— 已实现

TD-005 欠的是**数据形状**那一半：KI-065 给 `player/LockOn.ts` 补了行为证人（9 条），但 `range = 35` 与 `2.2 / 0.06 / +3` 仍写死在码里，改表改不动锁定手感。这一批把四个数搬进 `player.json > lockOn`，并且**没有只搬数**——搬的过程中发现那两句话（§34「Boss 独立锁定框」、本文档 §3「角度优先→距离」）是可以折成不等式的，于是它们成了 validator 的两条 ERROR，而不是注释。

- **数据**：`player.json > lockOn = { range: 35, aimWeight: 2.2, distWeight: 0.06, bossBonus: 3 }`（`schema.ts > LockOnConfig`，`PlayerBaseData` 增**必填** `lockOn`）。**四个值一个都没改**——这批换的是来源不是手感，任何"入表之后顺手调调数"的念头都属于数值裁决，不在这笔账里。
- **单位口径是这次最容易记错的一格**：打分式里的 `ang` 是**弧度**（`|clampAngleDiff(yaw, atan2(dx, dz))| ∈ [0, π]`），所以 `aimWeight` 是"每弧度罚多少"。`2.2` 看着比 `0.06` 大 36 倍，实际 30° 只折合 1.15 分、而 30m 的距离罚是 1.8 分——**"角度优先"在 30° 这个尺度上其实并不优先**，它是"正前方压倒性地优先，侧后方只靠距离差说话"。这句写进 `LockOnConfig` 的注释，因为只看数会得出相反的结论。
- **两条折成不等式的关系**（`scripts/lockon-rules.mjs`，ERROR 级）：① `bossBonus > range × distWeight` —— Boss 站在射程**最远处**也不该被贴脸杂兵用距离优势抢走锁定，否则 §34 那格「独立锁定框」是假的（实测 3 > 35×0.06 = 2.1）；② `distWeight × range < aimWeight × π/2` —— 从贴脸走到射程尽头，距离拉开的差距必须还比不上一个 90° 的偏离惩罚，否则本文档那句「角度优先→距离」不再成立，该改的是文档而不是让判据追着数跑（实测 2.1 < 3.456）。**这两条是本文档里第一处把"设计句话"写成"表内不等式"的门**，与 `hitStop` 那组（弹反不得短于完美格挡）同族，但那是排序、这是两条**跨字段的乘积**。
- **接线**：`LockOn` 删掉公开字段 `range`，构造函数改成 `constructor(player, cfg: LockOnConfig)`；读者恰好四个（`range` 两处——筛选与脱锁共用；`aimWeight`/`distWeight`/`bossBonus` 各一处，都在那一行打分式里），组合根 `main.ts` 交的是 `playerBase.lockOn` 这一块，不是手抄的四格。**判据本体照 KI-079/080/083 那条路搬进规则模块**（+ `.d.mts`），`validate-data.mjs` 只留两张嘴（findings → ERROR、数值可闻带仍由 `report.num` 管），`VOCAB_PAIRS` 加一对 `LockOnConfig ↔ LOCKON_FIELDS`。
- **守卫**：`tests/unit/lockon.test.ts` 从 9 条长成 13 条（新增的「真表那一侧」四条：射程 ±1%、距离项 + 那句「角度优先→距离」、Boss 加分、以及"这四个数在 `LockOn.ts` 里不再留第二份"的源码门），`tests/unit/lockon-table.test.ts` 16 条（accept 侧含真表实测与 schema 名单对账；关系①的**等号那一格必须红**、关系②用 ±0.1% 卡边界；非对象/字符串/空数组各说一次且只说在 `lockOn` 上；缺格交给 `report.sub`；未知字段点到自己那一格；四道唯一主人源码门）。**两端实测 15 臂 + 控制组**（控制组 29/29 绿；五个被改文件跑完按内容逐字节还原复验）：**15 臂全咬**，其中 13 臂红的案名与事前预测逐条对上，两臂比预测**多红一条**——L2（把射程筛选写成恒真） additionally 咬到「空锁不该响 `lockon_on`」那一条，R5（摘掉 `every(isNum)` 守卫）咬到「NaN/Infinity 不参与关系判断」那一条。**R5 我原本预测它是等价突变，预测错了**：`range = +Infinity` 时 `bossBonus <= range × distWeight` 真的成立，那句守卫不是装饰。两条都记在这里，因为"证人比我数的多"是这次唯一的不符，而把它写成"15/15 全中"就是谎。
- **边界那一格怎么敲（这批新踩的口径）**：关系①可以在**恰好相等**上敲，因为比较的两边是**同一个表达式**（`SPAN = range × distWeight`）；关系②不行，它的两边是两个不同的表达式，浮点回差 1 ulp 就能让"恰好相等"变成掷硬币，所以用 ±0.1% 夹逼。凡是"在边界上敲一条不等式"，先问两边是不是同一个式子。
- **门禁（2026-09-29）**：`tsc --noEmit` 0 错；`validate:data` **0 ERROR / 4 WARN**（本批没动任何数值，四条 WARN 全是既有的）；全量 `node scripts/test.mjs` **101 个文件 / 1344 条**，唯一那条红在 `tests/flow/debug-panels.test.ts`（`q_haltrune 2/3` vs 期望 `2/2`，**归并行任务的 `224dbb0`**，单跑复现、与本批无关，按归属如实上报不顺手替它改）；`npm run build` 2.41s。第五道门 `npm run coverage` 本批未重跑（量具与地板文件仍在并行会话的写入面上，KI-063 口径）。
- **实机腿（5199 隐藏页、真组合根、真 `__caesura.lock`）**：① `lock.cfg` 与 `fetch('/src/data/json/player.json')` 读回的 `lockOn` **逐格相等**（两个独立读者）；② 正面 30m 对正右方 8m ⇒ 赢的是 `farFront`，而我用那四个数在页面里独立复算的分是 −1.80 对 −3.94（角度项在这一格里说了话）；③ 同一角度线上贴脸杂兵（−0.06）对射程尽头 34.9m 的 Boss（+0.91）⇒ Boss 赢，这就是关系①那条不等式在运行时的那张脸；④ 34.9m 可锁、35.1m 不可锁（边界在表里那个数上）；⑤ 把已锁目标推到 36m 再调 `update()` ⇒ 脱锁并放 `lockon_off`；空锁只放 `ui_move`；⑥ **现场把 `cfg.range` 从 35 改成 5**，20m 的目标立刻锁不上，改回 35 又锁上（还原复验）——这一条证的是"表里的数真的是行为的输入"，不是"表里写了个数"。控制台 0 error / 0 warn。像素与听感照旧 Blocked（KI-010）。
- **没做（§78）**：① §2 那行的三句规划（8m 内圈、锥形角上限、遮挡脱锁、boss 强制单锁）**依旧未落**，本批只是把它们从"看起来已实现"改成 §2.1 B 表里的一格真缺口；② 四个数值的手感裁决没做（入表不等于调数）；③ `bossBonus` 只在**同一个角度**上保证 Boss 不被抢——若玩家正对着一个贴脸杂兵而 Boss 在身后 170°，她照样会被抢走，那是设计里没写的一格，要不要补"锁定优先给 Boss"需要一次裁决。

### 5.9.23 §14.4 那句「假动作骗翻滚后硬直 0.6s」第一次有载体：诱饵身份跟着弹体走，欠账挂在翻滚上（KI-085，2026-09-29）— 已实现（§77 实机腿本轮探针不可用，见末条）

Phase 4-B 落三叠箭时只做了**延迟**那一半（`at=[0,32,42]` 让第 2 发比均匀网格晚 11 tick），§14.4 后半句「骗翻滚后硬直 0.6s」一直登记为"没载体"。它难的不是那 0.6 秒，是**"被骗"这件事在数据与代码里都没有形状**：延迟是谁都能算的数，而"这一发是诱饵""玩家为它白滚了一次""欠的账什么时候收"三件事各自都要一个承载格，而旧代码里一个都没有——把 `punishMs` 写死在命中分支上只会造出一个新的谎言（所有箭都罚，或者最远的假动作永远不罚）。

- **数据**：`ProjectileSpec.burst` 加第四格 `feint = { shot, punishMs }`（`schema.ts > BurstFeint`，`ProjectileBurst` 加 `feint?`）；`en_skewer > tri > frames.projectile.burst = { count:3, everyTicks:21, at:[0,32,42], feint:{ shot:1, punishMs:600 } }`。**这一格必须是声明而不是常量**：诱饵是"第几发"与"罚多久"都是设计可改的数，写死在代码里就等于把 §14.4 那句话降级成注释。
- **谁挨罚（这批要先裁决的一格）**：§14.4 那句没写主语。查表定夺——`tri` 自己的 `frames.recovery = 104` tick（≈1.73s），敌人收招硬直**早就在表里、而且远长于 0.6s**，所以那半句说的不可能是针喉自己 ⇒ 它是**玩家白滚之后**的那 0.6s。这一格裁决记在这里而不是只写在代码注释里，因为下一个读 §14.4 的人同样会问"谁的硬直"。
- **五个环节各有承载格**（一条链，没有一环走捷径）：① `Enemy` 发射时按 `a.shots === feint.shot` 决定**这一发**带不带 `feintPunishMs`（诱饵身份从数据表一路带到离手的那一发）；② `ProjectileSpec → Projectile` 把它**跟着弹体走**（不是跟着射手走——反射、跨区回收、射手死亡都不该让一发已经在飞的诱饵变成普通箭）；③ `CombatManager` 在玩家侧结算处读出它，**只在"被无敌帧吃掉"那一支**调 `player.beginFeintPunish(ms)`；④ `ThirdPersonController.beginFeintPunish` 先问"这一滚还在飞吗"——不在飞就返回 false（站着硬吃那一发只是普通 R1，罚第二次读同一个信息没有意义，而且这条判据归玩法层，校验器不许复制它）；⑤ 在飞就把账写进 `roll.punishTicks`，翻滚**自然结束**那一拍（`roll.tick >= roll.total`）兑现成 `stunTicks`。
- **承载格挂在 `roll` 上是刻意的**：任何提前 `roll = null` 的路径（受击打断、进入处决、复活）连带作废这笔账。理由不是省事，是语义——翻滚没滚完就不存在"为它白滚"，此时补一记硬直会打出一个玩家没做出的选择。这条不是空谈：变异臂 A10 把兑现点搬到取消处，立刻红了"翻滚中途被打断"那条 flow 用例与那条"承载格恰好三处"的 census（见下）。
- **判据（`scripts/burst-rules.mjs`，与 `lockon/battle/explore/ambience-rules` 同一只手）**：搬出校验器才量得动（`validate-data.mjs` 一被 import 就去校验真表并 `process.exit`，本沙箱连 spawn 子进程都被拒——KI-075），校验器只当把 findings 报成 ERROR/WARN 的那张嘴。五条关系，全是**格与格之间**的，逐字段 `report.num` 一条都说不出：① `shot` 必须落在真会发出去的那一发（`0 ≤ shot < count`）；② 声明了诱饵就必须有可读的显式帧位 `at[shot]`（缺省时每一发都在均匀网格上，"延迟的那一发"在数据里不存在）；③ 诱饵后面必须有真收尾（`shot < count-1`，否则骗空一次翻滚之后场上什么都不会发生）；④ `at[shot]` 必须**晚于** `shot × everyTicks`（不早于网格的那一发不叫假动作）；⑤ `punishMs` 折成 tick 必须**严格大于**诱饵到下一发的间隔（否则玩家被骗空还来得及再滚一次）。**顺序与"同一处手误只说一次"**：③ 报完就走，因为 `shot` 指到最后一发时"不比网格晚"往往也成立，连报两条会把人往错的那一格带（KI-083 的 opaque 守卫同因）。**单位尺子**：`TICK_HZ` 在 `.mjs` 里抄了一份（node 不能直接 import TS），所以有一条门去读 `src/core/Time.ts` 的源码行做对账——抄了就要有对账，否则改帧率只会让判据悄悄换尺子。
- **覆盖**：`tests/unit/burst-table.test.ts` 25 条（判据两端：真表那一块零条 + 每一臂各改一格看它红在对的那句话上；含"边界敢不敢敲等号"的两种口径——①③④ 敢，⑤ 的两侧是不同表达式所以用 167/183 tick 各敲一次），`tests/flow/feint-punish.test.ts` 6 条（诱饵被吃掉→`roll.punishTicks = 36` 而 `stunTicks` 仍为 0→翻滚结束那拍起算锁住 35 拍；站着挨诱饵只掉血不欠账；真箭被滚掉零欠账；中途被打断作废；`beginFeintPunish` 三种拒绝形状各配一句"当场没被冻住"；三叠箭端到端——从真表读 `tri`，强制出招，量三发离手时各自带没带 `punishMs`，结果是 `[undefined, 600, undefined]`）。
- **量这条链的几何（不写下来下一个人只会重新踩）**：弹体 13/60 ≈ 0.217 m/tick，翻滚 3.2/30 ≈ 0.107 m/tick ⇒ **背对诱饵滚**永远只能在无敌窗外接触（它追上你太慢），侧滚则整条走廊都躲开了（命中容差只有 0.81 m）。所以探针必须**朝诱饵滚**（`frame.move={x:0,y:1}`、`camYawRef=0`、弹体起于 z=−5），实测接触落在 `roll.tick = 14` ∈ 无敌窗 `[9,21]`——这一条是被量出来的，不是假设的。**还有一个 off-by-one**：兑现那一拍紧接着同一次 `update()` 就减 1，所以可观测的锁是 `msToTicks(600) − 1 = 35` 而不是 36；用例里写的是 35 并把机制写在断言消息里，免得下一个人把它"修"成 36。
- **变异见证（10 臂，`10/10 按预测红、0 臂偏/作废；对照 0/31；恢复后 4/4 文件字节一致`）**。其中两笔值得记：**A8**（硬直提前上身）我预测红"骗空之后站不住"那条，实际**没红**——根因是 `takeDamage` 对 `stunTicks` 是**赋值**而不是取大，提前那一笔被后到的 R1 直接冲掉。**预测错的是我，不是测试**：那条 flow 用例本来就在说"作废"，于是把这臂改判到它真正指向的地方（A10 在取消点兑现 ⇒ 红了 F4 与 census）。另一笔是 **A7**（诱饵身份判断被抹平）第一趟多红了一条，因为我那次替换顺手删掉了 `feint.shot`；改成 `(a.shots === feint.shot || true)` 之后恰好 1 红。**跨平面覆盖是这次最有用的一格**：把生产代码改坏会同时红掉 flow 的行为用例与 unit 的读者 census——只有后者红才是"我的测试在测我的方法"，两条一起红才说明这条链真的连着。
- **门禁（2026-09-29）**：`tsc --noEmit` 0 错；`validate:data` **0 ERROR / 4 WARN**（四条全是既有的，本批没新增 WARN 也没放宽任何一条）；全量 `node scripts/test.mjs` **103 个文件 / 1375 条**，唯一那条红在 `tests/flow/debug-panels.test.ts:474`（期望 `2/2` 而读数 `q_haltrune 2/3`，属并行会话的 `224dbb0`；`git diff --stat HEAD` 对它与 `quests.json`/`states.json`/`src/quest` 全空 ⇒ 不是我改出来的，按归属如实上报、不顺手替它改）；`npm run build` exit 0。第五道门 `npm run coverage` 本批未重跑（量具与地板文件在并行会话的写入面上，KI-063 口径）。
- **§77 实机腿（本轮如实登记：in-page 探针不可用）**：5199 在应答（`curl` 200 / 14ms），`navigate_page` 两次都成功返回（`?ki085=1`、`?ki085=live`），但页面主线程整轮钉死——`evaluate_script` 四种形状全超时（含 `() => 1+1`、`() => 2+2`、读 `window.__caesura` 的守卫式探针、读 `document.readyState`），`list_console_messages` / `take_snapshot` / `list_network_requests` 同样超时，只有 `list_pages`（控制面）还能返回。症状与 `caesura-live-verify-recipe` 记的那次一致（上一轮的步进把主线程钉住，等待自然结束后才恢复），本轮等待约 6 分钟未解 ⇒ **停手，不拿离线读数冒充实机读数**。可用的替代证据两条：① **dev server 现发的模块**已带这条链（按浏览器真正请求的 URL 抓：`enemies.json?import` 有 `punishMs`/`feint` 各 1、`ThirdPersonController.ts` 有 `beginFeintPunish` 1、`CombatManager.ts` 有 `feintPunishMs` 5 + `beginFeintPunish` 1、`Enemy.ts` 有 2、`Projectiles.ts` 有 2）；② **构建产物**里那一格是原文：`dist/assets/data-*.js` 内 `burst:{count:3,everyTicks:21,at:[0,32,42],feint:{shot:1,punishMs:600}}`。这两条证的是"表→产物"没断，**不**证"浏览器里那一滚真的站不住"——后者要在探针恢复后补跑：读活 `en_skewer.tri` 的 `feint`、朝诱饵前滚、读 `roll.punishTicks` 再数 35 拍锁、并现场把已加载实例的 `punishMs` 改成 300 看锁变成 18 拍。**像素与听感照旧 Blocked（KI-010）**。
- **没做（§78）**：① 被骗那一记**没有任何可见/可听的提示**——玩家看到的是"翻滚结束后动不了 0.6s"，不知道为什么；§14.4 要的是可读的陷阱，那一格属于表现层，等 KI-010 那一类评审能做得动再说；② 场上**只有针喉 `tri` 有诱饵**，`snipe`/`pluck` 与其余敌人的连发没声明 `feint`（判据对此保持沉默，因为"没有诱饵"是合法状态而不是缺口）；③ 上面那条实机腿要补跑。

### 5.9.24 词表对账的覆盖面第一次由机器回答，并把两种认不出来的形状补上（KI-086，2026-09-29）— 已实现

**这一格治的不是错数，是一句没有人回答的话。** `scripts/validate-data.mjs` 顶上那批 `const X = new Set([...])` 全是"与某处对齐"的手抄名单：KI-074 立了"读一次主人、逐张比"的判据（`vocabDriftErrors`），KI-076 把**载体**泛化到 schema 之外（`from` 说这张名单的主人住哪个文件），KI-077 之后每批新表都把判据本体搬进 `scripts/<域>-rules.mjs`。可"**没接的那几张**"一直只活在注释里——一批人接了十二张，下一批人不知道该接哪八张，于是名单既不会被接完，也不会被解释完。KI-086 把这句话换成读数。

**抽取器补两种形状**（判据认不了一个形状就是判据的缺口，KI-076 口径）：

| 形状 | 新 API | 真载体 |
|---|---|---|
| 嵌套对象里的内联联合（缩进四格） | `fieldUnion` 的缩进下限由"恰好两格"放宽到**两格及以上**，`match` 取第一处（与 TS 可见性一致） | `EnemyData.ai.pickOrder` ⇒ `PICK_ORDERS` |
| 模块级 `const X = new Set([...])`（既不必 `export`，也不必是数组） | `setLiterals(text, name)` | `src/ai/Enemy.ts > PSEUDO_ACTIONS` |

**两条边界是刻意写死的**：`setLiterals` 只认**字面量实参**（`new Set(STATUS_IDS)` 那种派生集合读成 null，让调用方报"门在空转"）——把一个派生集合当成空词表，比没有门更糟，它会把所有成员判成非法；`handCopiedLists` 只普查**模块顶层**的名字（零到两格缩进），函数体里更深一层（四格）的临时集合算一条语句的局部，不算一张词表。

**覆盖面对账**（`vocabCoverageErrors`）：同一份文件里每张被普查到的手抄名单，必须由两条路之一交代——

1. **有主人**：登记进 `VOCAB_PAIRS`（`where` 写名单常量名，`at`/`from` 说主人是谁）；
2. **没有主人**：登记进 `VOCAB_UNPAIRED`，并且 `why` 要说凭什么、`master` 要说真主人其实在哪。

两条反向判据同生同死：**既入表又豁免** ⇒ 红（"两种交代同时挂"是 KI-076 `subset`/`allowMissing` 那一族）；**豁免还挂着而名单已经从文件里消失** ⇒ 红（KI-073：先记账的名单要能销）。另有一条**抽取器自曝器**：`VOCAB_PAIRS` 里每张 `where` 都必须在普查读数或 `importedNames` 里真出现，普查一旦读空，所有**住在本文件**的已入表名单会各自红一次——"判据坏了"不会变成静默绿。

**一个模块求值顺序的约束（本批第一趟实测撞到的，写下来免得下次再撞）**：`VOCAB_PAIRS` 是一张在模块求值时就要读这些名单的数组，所以**一张名单想有主人，它必须和主人登记在同一个可求值的起点之前**——把那七张名单留在各自那张表的校验段落里，就是 `ReferenceError: Cannot access 'WEAPON_FIELDS' before initialization`。它们因此搬进了文件顶部的词表区。

**两笔假账纠正在同一批里**：`SELL_FIELDS` 的主人原来是一行**内联对象**（`sell: { mul; stackKinds; note }`），形状上没有可指的名，于是只能手抄——按 KI-085 对 `burst.feint` 的同一处理，把内联类型提成具名接口 `ShopSell`，抽取器不必长新形状；`QUEST_TAGS` 那四个字母（§28 的 D/C/H/M）原来只写在文档与注释里，代码侧是 `tags?: string[]`（什么都能塞），今天提成 `QuestTag` 类型并由 validator 现读。

**守卫**：`tests/unit/schema-vocab.test.ts` **32 条**（本批 +14）。合成段钉新形状与两条边界（派生集合、更深缩进）；覆盖面每一臂各一条（没交代 / 没写理由 / 该销 / 两种交代同时挂 / 普查读空自曝 / import 进来的名字算交代）；真载体四条（`PSEUDO_ACTIONS` 逐成员、`pickOrder` 四格缩进、校验器那份文件里两种读数都非空且条数够、门本体源码门——删掉 `vocabCoverageErrors(...)` 的调用而留着函数，一切照绿没人会发现，所以那条调用本身也被钉住）。

**反向实测四刀**（每一刀互不重叠、跑完按 sha256 核对还原成字节一致；对照组先跑未改动的门，总计 0 ERROR ⇒ 红才可归因）：①在 `validate-data.mjs` 里塞一张没人交代的 `const KI086_PROBE = new Set(['x'])` ⇒ 门恰红 1 条（`coverage:KI086_PROBE`），总计 `1 ERROR`；②把 `PSEUDO_ACTIONS` 的 `'hold'` 删掉 ⇒ 恰红 1 条（`vocab:PSEUDO_ACTIONS`：主人那一侧不认识 hold）；③把那句字面量换成派生集合 `new Set(ACTIONS_LIST)` ⇒ 恰红 1 条（`carrier:PSEUDO_ACTIONS … 这张门在空转`）——第三刀是那条边界的现场见证：**派生集合读不到就喊空转，不拿空集冒充词表**；④把 `EnemyData.ai.pickOrder` 那一格的内联联合换成一个引用（`pickOrder?: PickOrderKind`，而那个别名并不存在）⇒ 恰红 1 条（`carrier:EnemyData.ai.pickOrder`）——第四刀管的是新放宽的那条缩进分支：它今天读得到，改天读不到时必须自己喊出来，而不是"没有漂移"。

**门禁（2026-09-29）**：`tsc --noEmit` 0 错；`validate:data` **0 ERROR**（WARN 的条数随并行会话的在途数据改动浮动，落档时读到 2 条：`flag.found_first_phrase` 仍无写方 + `bell.everySec` 听感待裁决；KI-086 没新增也没放宽任何一条）；`npm run build` 通过；全量 `node scripts/test.mjs` **1391 条 / 103 个文件**，唯一一条红在 `tests/flow/debug-panels.test.ts` 的 F3——那条断言还写着 `2/2`，而 `q_haltrune` 在 HEAD 上已经是三步（`git show HEAD:src/data/json/quests.json` 量得 3 步），归任务线那一批的账，本批没碰那张文件，也没顺手把它改绿。

**没做（§78）**：①`FILES` 这张"校验器读哪几份 JSON"的工作清单，真主人是 `src/data/json/` **目录**而不是任何一条声明，而 `corpusFor(from)` 收的是"一份文件"——**那个形状今天没有**，所以新增一份表而忘了加进 `FILES` 仍只会安静地不被校验（已如实登记在 `VOCAB_UNPAIRED` 里，不假装覆盖了）；②`docs/**` 与 `src/**` 的文本不在 KI-082 那道门内，源码侧"反斜杠被吃"没有 U+FFFD 那样的唯一记号，在没有那种判据之前不假装覆盖；③`handCopiedLists` 的普查按**缩进**读数（零到两格算，四格以深算局部）而不是按花括号配对，所以一张故意写在三层嵌套里的抄本可以躲过覆盖面——今天校验器自己要交代的名单都在这条线以内（`ADVICE_AXES` 是函数顶上两格那张，已登记），但这条线本身是个可以被越过的形状。

### 5.9.25 隐藏房剩下那两间通了：写方与领取点是**一对**，缺哪一半都不算（KI-087，2026-09-29）— 已实现

**这一格治的是"半截账"。** 隐藏房（`regions.json > secrets[]`）在数据上由两个字段绑成一条链：`unlockFlag` 是锁，`X.secretId = <secret id>` 的交互物是钥匙孔（`world/Interactables.ts` 由它现推 `requiresFlag` 与 `lootTable`，交互物自己不许再写一份）。校验器 `validateWorldstate()` 对此有两条对称判据：

| 形状 | 判据的说法 |
|---|---|
| 有领取点、没有写方 | `领取点 … 依赖 <flag>，但没有任何写方 ⇒ 这是一只永久焊死的箱子` |
| 有写方、没有领取点 | `<flag> 有写方，但这条 secret 没有带 secretId 的领取点 ⇒ 旗立了也没人发奖` |

**两条判据在"写方与领取点都缺"时都不响**——而 `PENDING_FLAG_WRITERS` 只登记旗标那一侧，于是 KI-041 当时把两条写成了"只缺领取点几何"。本批动手时逐条量出来的实情是**两半都缺**（这正是 §5.9.24 那门"覆盖面要由机器回答"的同一族问题：账目里的措辞也需要一个能被推翻的机会）。

**本批落地的两条链**：

- **沉唱堂侧廊**（`rg_drowned_choir`，groundY −40）：写方是新动词面 `in_drownedchoir_side_nave`（`inspect`、「推开侧廊门」，(250,−40,118)）立 `flag.side_nave_found`；领取点 `ch_drownedchoir_side_nave_cache`（(258,−40,126)，墙 `dc_nave_arcade` 的另一侧）带 `secretId` ⇒ `loot_secret_nave`。secret 自身坐标从 y=−60（`Surface.floorAt` 为 null 的一层）搬回 −40：**隐藏房的坐标从此与它的领取点同层**。
- **破拍营地盟军补给**（`rg_brokenbar_camp`，groundY 0）：写方不是新交互物，是**抉择派生**——`DLG_HALTRUNE` 的 n6-c1（归还给休垒 ⇒ OUTPOST）那条 `setFlags` 在 KI-081 的 `flag.brokenbar_resolved` 旁边多写一面 `flag.brokenbar_allied`；领取点 `ch_brokenbar_ally_store`（(−130,0,−330)）带 `secretId` ⇒ `loot_camp_store`。

**`allied` 与"抉择记两遍"的界线（这条界线写在这里，免得下一个人拿 KI-081 的断言来质疑本批）**：KI-081 的原则是**值域与旗标不许 1:1 平行**（`flag.haltrune_camp_decided` 那种重复旗标没有任何读方，那条断言今天原样留着）。`allied` 落在界线以内有两处硬理由：①它的读方只有**一个**（盟军补给封存点），而那个读方要的条件比 `resolved` **窄**——`resolved` 管"营地定了"（OUTPOST 与 RUINS 都写），`allied` 只管"营地里的是友军"；②秘密房的锁只认旗标通道（`UnlockFlag` 是字符串）。反过来，若哪天有人想让 `allied` 去表达"营地定了"，那就撞上了 KI-081 那条原则——**判据（`haltrune.test.ts` 的九格表）会把三分支 × 两枚旗标逐格量出来**，多写一格当场红。

**几何纪律**：两处领取点都放在本层地板（`groundY`）上，并与既有 authored 墙体保持了 `size/2` 之外的间距——校验器那条"把 X 埋进了墙肚子里"的判据（§5.9.9 那一族）在本批全程开着；`hidden-rooms.test.ts` 另用 `Surface.floorAt` 现场量一次 y（**不是**再抄一遍数）。

**守卫**：`tests/flow/hidden-rooms.test.ts` 8 → 10 条（两条链各一条，含"锁 → 打开 → 真掉落 → 一次性 → 踩在地板上"）；`tests/flow/haltrune.test.ts` 的九格表扩成"三分支 × 两枚派生旗"（`resolved` / `allied` 各自的真假矩阵）。**反向实测两刀**（逐刀跑完按 sha256 核对还原成字节一致）：摘掉 `ch_drownedchoir_side_nave_cache` 的 `secretId` ⇒ 恰红 1 条（"旗立了也没人发奖"）；摘掉 `in_drownedchoir_side_nave` 的 `setsFlag` ⇒ 恰红 **2** 条（"`flag.side_nave_found` 没有任何写方" 与 "领取点依赖它 ⇒ 永久焊死的箱子"——同一件事被两条对称判据各说一次；这也正是**两半都缺**时它们为什么都不响）。**销账**：`PENDING_FLAG_WRITERS` 从 3 条降到 1 条（KI-073 的销账判据先把"写了还挂着账"报成 2 条 ERROR，本批同一趟清掉）。

**门禁（2026-09-29）**：`tsc --noEmit` 0 错；`validate:data` **0 ERROR / 2 WARN**（全仓 WARN 由 4 降到 2：只剩 `flag.found_first_phrase` 的待办与一条铃点间隔的听感口径）。

**没做（§78）**：①初句圣所（`flag.found_first_phrase`）仍挂在白名单上——narrative §4.8 要的是**五环线索链**（不靠走近解），那是 Phase 6-C 的内容批，不是几何；②两间新房的陈设与演出仍按 KI-013（无模）与 KI-010（视口评审做不了）记 Partial——本批能承诺的是"锁与钥匙对上了、东西真的进背包"。

### 5.9.26 词表对账的第六种主人：一个目录，并把"两个方向说同一句话"换成各说自己的后果（KI-088，2026-09-29）— 已实现

**这一格结案的是 KI-086 自己记下的没做①。** `scripts/validate-data.mjs > FILES`（校验器要读哪几份 JSON 的工作清单）在 KI-086 的覆盖面判据下只能走"没有主人"那条路，理由写在 `VOCAB_UNPAIRED` 里：它的主人不是任何一条声明，而是 `src/data/json/` **目录本身**——而 `corpusFor(from)` 这个通道只收"一份文件"。形状没有，于是"新增一份表而忘了加进 `FILES`"这一格在 KI-086 之后仍然只靠人眼。

**一个分支而不是新层。** `corpusFor` 现在认 `from` 的**尾斜杠**：以 `/` 结尾 ⇒ 语料 = `readdirSync(resolve(ROOT, from)).join('\n')`，即"这里面躺着哪些文件"逐行拼成的一份文本。判据本体（`vocabDriftErrors`）不动，抽取器只多一种形状：`dirListing(text, ext)` 按后缀挑名字、去重，**一项不剩时返回 `null` 而不是空数组**——拿空集合冒充"这个目录没有表"会让这张门把所有成员判成非法，与 `setLiterals` 只认字面量实参（KI-086）是同一条理由。

**红消息必须陈述它自己那条判据。** 通用措辞在这张载体上说的是假话：

| 方向 | 原来那句（字段白名单那一族） | 目录主人真正意味着 |
|---|---|---|
| 名册少一份 | "改表的人会被一个不存在的问题挡住" | 那份 JSON 躺在表目录里而校验器不读它 ⇒ 它**永远不过门禁**（§55 的死数据，比写错一格更糟：没人会看见它错） |
| 名册多一个名字 | "那一侧看不见这一项，要么该进声明、要么就是死词" | 校验器在读一份**不存在**的表，那条判据从此在空转 |

于是 `VocabPair` 多两个可选字段 `missHint`/`extraHint`：给了就说这句，没给还照旧。**`FILES` 随之从 `VOCAB_UNPAIRED` 搬进 `VOCAB_PAIRS`**（那一行同步删掉——两种交代同时挂是 KI-086 那条判据，留着它当场红）。

**一处为了让测试能"推导"而做的放宽**：`arrayLiterals` 原来只认 `export const X = [...]`，而 `FILES` 正是一张**没导出**的数组。测试若自己再抄一份 20 个名字，就成了第三个来源（等值不是推导）；所以 `export` 从判据里去掉，测试改由 `arrayLiterals(read('scripts/validate-data.mjs'), 'FILES')` 现推。这与 `setLiterals`（KI-086：主人不必是 export）同一条理由。

**守卫**：`tests/unit/schema-vocab.test.ts` **38 条**（本批 +6）。合成三臂钉 `dirListing`（换后缀、去重、读空 ⇒ null）；两臂钉提示（给了 ⇒ 那句通用措辞必须**不**出现；没给 ⇒ 通用措辞照旧，**默认路径不许被新参数悄悄吞掉，两边都要有读数**）；一条钉 `arrayLiterals` 不再要求 `export`；真载体那条把两侧都从源码现推（名册 ⇒ 抽取自 `validate-data.mjs`，目录 ⇒ `readdirSync`），比 `toEqual` 之后另加 `>=20` 的非空守卫——否则"两侧都读空"也能通过相等判断；接线源码门钉 `from.endsWith('/')`、`readdirSync(resolve(ROOT, from))`、`at:`/`from:` 那两行登记本身，**含那个尾斜杠**（抄漏 ⇒ `readFileSync` 读到目录 ⇒ EISDIR ⇒ 门在空转）。

**反向实测七刀**（事前写明每刀"必须红在哪把钥匙／哪条用例"，跑完按 sha256 核对还原成字节一致）：①`FILES` 删一份表 ⇒ 门禁 `2 ERROR`（目标那条措辞是 missHint）+ 用例「真载体」红；②名册多一个不存在的文件名 ⇒ 同形，措辞是 extraHint；③登记的目录路径少一个斜杠 ⇒ `1 ERROR` `carrier:… 这张门在空转` + 用例「接线」红；④把 `p.missHint ??`/`p.extraHint ??` 摘掉让通用措辞顶上来 ⇒ **门禁照绿而用例红**——那正是"提示是死参数"的形状；⑤`dirListing` 不去重 ⇒ 「按后缀挑名字」红；⑥`arrayLiterals` 收回放宽 ⇒ 两条用例红（合成那条 + 真载体那条）；⑦**目录里放一份没人读的表**（不在 `FILES`）⇒ `1 ERROR` 且**没有任何其它红**。

**⑦ 才是这一批的目的，而①②顺带量出一件值得记下的事**：那两刀各自多出的第二条红来自下游——各 `validateX()` 直接 `data['battle.json']` 取值，报的是"顶层必须是数组"；装载循环直接开文件，报的是 ENOENT。也就是说这一格**原来也有症状，但那句红说的是结果不是原因**（没人会因为"顶层必须是数组"去查那张工作清单）。而一份**没有专属校验函数**的新表，除了 KI-088 这道门今天没有第二个人知道它存在。

**门禁（2026-09-29）**：`tsc --noEmit` 0 错；`validate:data` **0 ERROR / 2 WARN**（WARN 随并行会话浮动）；`npm run build` 通过；全量 **1397 条 / 103 个文件**，唯一一条红仍是 `tests/flow/debug-panels.test.ts` F3（`expected 'q_haltrune 2/3 …' to contain '2/2'`，归任务线那一批，本批没碰那张文件）。

**没做（§78）**：①名册⇄**判据**那条缝仍在——KI-088 量的是 `FILES` ⇄ 目录，而"每张表该由哪个 `validateX()` 管"没有目录可当主人，一张进了名册却没有专属校验函数的表只被"顶层是不是数组"读到（这一格与 ⑦ 是同一件事的两半：⑦ 抓"表存在而名册没有"，本格说的是"名册有而判据没有"）；②③承 KI-086（`docs/**`、`src/**` 的文本完整性没有 U+FFFD 那样的唯一记号；覆盖面普查按缩进而非按花括号配对读数）。

### 5.9.27 对话树里 19 句台词没有任何玩家读得到：复访入口是一条台阶，不是一个句号（KI-089，2026-09-29）— 已实现

**这一格量的是"写下来的句子"与"读得到的句子"之间的缝。** narrative §3.1 把 NPC 可见节点定义成 `Filter(树, f(quest.state, relation, flags))`：**条件**决定"这一刻演哪一段"，**边**（`next` 与 `choices[].next`）决定"这段还在不在场上"。原校验器只从 root/fallback 顺**第一条**路走到"落点"（那是"玩家会不会卡在一段不结束的对话里"），走不到 root/fallback 的节点它一句话都不说 —— 实测 5 棵树 56 个节点里 **19 个**没有任何一条边指向：

| 树 | 够不着的节点 | 那些是什么 |
|---|---|---|
| DLG_CORVIN | n7–n13（7 个） | §2.2 步 3–5：去把那具头颅带回来 / 铭牌摊在灯下 / 档案室开门 + 三选一 / 三份后果 |
| DLG_FACELESS | n7–n14（8 个） | 五环线索链（narrative §4.8）与身份三选一的四个收尾 |
| DLG_MEG | n5–n8（4 个） | 第三段（未竟厅深处那句耳语）与声卷交付后的收尾 |

**`narrative.md` §425 那格"缺 §2.2 步 3/4"因此长期读起来像"还没写"** —— 数据里那几步一句不缺，只是没人读得到。这与"账目要能被推翻"是同一族问题（§5.9.24 那门的动机）：账上写"缺"，和表里真的缺，是两件事。

**第二个形状：没有出口的环。** 无面童树里 `n3 --next--> n6 --next--> n3`，两者都没有选项。引擎 `enter()` 遇条件不成立就 `id = node.next ?? null` 继续退，退到环上就是同一个节点被反复展示；走到 64 次保护时返回空视图，于是 `DialogueSession.open()` 返回 false —— **对话框根本不弹**。判据只报**结构上必然**转不出来的那一种（环里有选项 = 玩家自己的抉择，即使还困着也是他选的），而 `once` **不算出口**：

> 这一条是写门时先写错、被自己的测试当场抓回来的。第一版判据把"环上没有选项**且没有 `once`**"当条件，`tests/unit/dialogue-reach.test.ts` 里 `once` 那一格立刻红了 —— 读过一次的节点被跳过之后走的是 `node.next`，落点还在环里，`once` 只是"少演一次"。

**第三个形状：拒绝没有回头路。** 科温的 n0-c2（「我不替人打猎」）与断弦的 n0-c2（「死人该躺下」）都只立"见过面"这面旗、不开任务；原数据的复访入口因此落到一句结束语上，此后每一次搭话都是同一句，线永远拿不到。

**修法：复访入口折成一条台阶。** 形状照 DLG_BELLTONGUE 既有那条（`fallbackNode = n13`（最靠后那道闸）→ `n14` → `n5`（通吃节点））—— fallback 指向**最靠后**的一道闸，每道闸条件不成立就往 `next` 退，末端是一个条件最松的通用节点。四条线各自接上，并给拒绝那两条各补一个"再谈一次"：

| 树 | 台阶（从左到右 = 从最靠后到最通吃） |
|---|---|
| DLG_CORVIN | `n7(STEP3_REMAINS)→n8(STEP4_CONFRONT)→n10(STEP5_SCHISM ∧ schism=INTACT)→n11/n12/n13(三份后果按 state 选)→n5(STEP2_DELIVER)→n14(新：那一节还空着)` |
| DLG_MEG | `n7(耳语已剥 ∧ 声卷未交)→n10(新：声卷交出后)→n5(第二段已换)→n3(STEP2_EXCHANGE)→n9(新：第一段再听一遍)` |
| DLG_FACELESS | `n4(答铃姨)→n6(撒谎的后果)→n7(五环线索)→n10(身份三选一)→n3(schism 那句)→n15(新：通用)` |
| DLG_HALTRUNE | `n10(有任务)→n11(新：拒绝过的人再问一次)` |

**顺带改正两处本来就对不上的闸门。** 科温 n7 的闸门原写成 `STEP2_DELIVER`（与 n5 撞在同一格，而它的文案是"去把它带给我"）、n8 的闸门原写成 `STEP3_REMAINS`（而它的文案是接过铭牌之后那句）。两处都是"文案说的事"与"闸门说的步"错开一格 —— 按文案改，不按闸门改。

**为什么 n6 的 `next` 从 n3 改成 n7**：撒谎的后果（"它只写同一个音符"）该在复访第一句上，但不许把往后的内容吃掉 —— 否则对无面童撒过谎的玩家永远读不到五环线索（那是一条主线的软锁死）。改完之后 liar 读到"同一个音符"、再按一次继续，就落到五环线索上。

**判据落在哪。** 新 `scripts/dialogue-rules.mjs`（`unreachableNodes` / `stuckCycles` / `dialogueReachErrors`，含 `.d.mts`，与 battle/explore/ambience/lockon 同一族理由），`validate-data.mjs` 只当那张嘴。两条判据都只看**边**、不看条件成不成立：够不着的节点是"任何状态下都读不到"，比"某个状态下读不到"强一档 —— 正因如此它可以当 ERROR 而不是 WARN。

**守卫**：`tests/unit/dialogue-reach.test.ts` 新增 **16 条**（正反各一轮：孤儿 / 入边来自孤儿 / root 与 fallback 自己豁免 / 选项也是边 / 条件读不出来也当走得下去；环：裸环报、有选项不报、`once` 照报、够不着的环不重复报、"同一只环只报一次"；真表当底：挂一个孤儿恰红一条；校验器源码门）。`tests/flow/dialogue.test.ts` 12 → **18 条**。`tests/flow/bells.test.ts` 与 `tests/flow/haltrune.test.ts` 三条旧期望随之改成更强的断言。**反向实测两刀**：真表上挂一个孤儿 ⇒ 恰红 1 条；把两个节点接成环 ⇒ 红 2 条（环 + 被截断的台阶），sha256 核对还原成字节一致。

**顺带量出的两条假绿**（值得单独记一笔）：`bells.test.ts` 无面童步 2 那两条断言的是 `w.last()`，而老数据里 fallback 的环让 `open()` 返回 **false**，`last()` 读的是**上一段对话留下的陈旧视图**（正好是 n2 / n5）—— 于是"落在 n2""形如 n4/n5"永远成立，而那条对话其实一句话都没弹出来。这一族假绿的通用形状是：**断言的取数口（`last()`）与这件事的成立口（`open()`）不是同一个**。两条都补了 `expect(open()).toBe(true)`。

**门禁（2026-09-29）**：`tsc --noEmit` 0 错；`validate:data` **0 ERROR / 2 WARN**；相邻 8 个文件 **105 条全绿**（没有跑全量回归）。

**没做（§78）**：①条件层面的"永远读不到"（条件恒假）不做 —— 那是可满足性一级的活，本批只钉**结构上**够不着的那一半；②"收束后能不能重开一条线"除科温/断弦外没有逐条裁；③五环线索链的**内容**（点亮顺序、初句圣所几何）仍按 KI-087 的没做②留给 Phase 6-C —— 本批只保证 n7/n8/n9 这三句有人读得到，不是那三步已经有地方走。

### 5.9.28 初句圣所的五环线索链第一次闭合成链：四个读点分散在四个区域，井底那扇门要四环齐才认你（KI-091，2026-09-29）— 已实现

**症状不是崩，是"最后一面旗没有写方，而它的四句线索也不在世界里"**。KI-041 立账时 `regions.json` 里被读到的
8 个世界旗标一个写方都没有；KI-081 落 `brokenbar_resolved`、KI-087 落 `side_nave_found` 与
`brokenbar_allied` 之后，白名单上只剩 `flag.found_first_phrase` —— 它是无耳深窖那条隐藏房
`sec_first_phrase` 的解锁旗，按 narrative §4.8 该由**五环线索链**来立。动手时量到三件事：

- 那条 secret 的坐标 `(−260,−180,360)` 实测 `Surface.floorAt` 为 **null**：无耳深窖的可行走层是
  `groundY=−144`，`−180` 是悬空的（KI-041 那句"几何欠账"在坐标上仍然成立）。
- §4.8 的环①–④（钟舌反向谱线 / 穹顶积水倒影 / 石龛三连划痕 D5 / 遗骸朝一点倾斜）在游戏里
  **一个读点都没有**：四句话只活在文档里，`docs/narrative.md §8` 的"环境叙事"因此一直记 Placeholder。
- 那扇门要的是**四件事都发生了吗**，而交互物闸门只有 `requiresFlag`（单面）与 `requiresState`
  （值域取等）两种记法 —— 没有一种能说"这四面旗都要在"。

**修法一：新字段 `requiresFlags`（合取闸门，AND）**。`InteractableRef.requiresFlag` 之外多一格
`requiresFlags?: string[]`：单面旗能表达的门只到"一件事办完"为止，合取闸门回答的是"这几件事都发生了吗"。
它与单面那面**共用一处求值**：`Interactables.missingFlags(it)` 把两者拼成"还差哪几面"，`stateOf` /
`activate` / 锁文本都从那一处读——于是"锁着"与"为什么锁着"不会各自算一遍（旧代码在 `stateOf` 与
`activate` 里把那句判断写了两遍）。锁文本：只缺一面沿旧口径「需要 X」，缺多面则说清
「还差 N 件事：a、b、c」（`requiresState` 那条分支不动）。校验器三条形状：非空字符串数组、
不许与 `requiresFlag` 同时写（同一件事两处真值）、不许重复列同一面旗；并且
**`collectFlagUsage` 把列进去的每一面都登记成读方** —— 少了这一条，规则表刚写的旗会被
"写了没人读"那条判据判成死数据。

**修法二：五环的四环落成读点，句子走规则表的 `notify`**。

| 环 | 读点（`inspect`） | 位置 | 由哪条规则立旗 |
|---|---|---|---|
| ① 钟坠院 | `in_fellcarillon_reverse_score`「辨读钟舌上的反向谱线」 | (214, 64, −236) | `ws_firstphrase_ring1` → `flag.clue_reverse_score` |
| ② 休垒 | `in_resthold_dome_reflection`「看积水里的倒影」 | (−62, 0, −62) | `ws_firstphrase_ring2` → `flag.clue_dome_reflection` |
| ③ 沉唱堂 | `in_drownedchoir_d5_scratch`「读石龛的三连划痕」 | (348, −40, 16) | `ws_firstphrase_ring3` → `flag.clue_d5_scratch` |
| ④ 无耳深窖 | `in_deeps_lean_corpses`「辨认遗骸倾斜的朝向」 | (−262, −144, 318) | `ws_firstphrase_ring4` → `flag.clue_lean_corpses` |

读点自己**不挂 `setsFlag`**：写方统一在 `worldstate.json`（`SecretRef` 头注释那句承诺），
而 §4.8 那四句话作为规则的 `notify` 播出来 —— 于是"读了什么"第一次在游戏里说出口，
而不是只留一句通用的「刻痕读进了心里」。

**修法三：井底的门 + 石刻前的领取点**。`ga_deeps_firstphrase_door`（`gate`，( −258, −144, 344)）
的 `requiresFlags` 恰好是那四面旗；它被用掉时 `ws_firstphrase_door` 立 `flag.found_first_phrase`。
门后 `ch_first_phrase`（( −264, −144, 364)，`secretId: sec_first_phrase`）按引用取解锁旗与奖励表
（`loot_secret_firstphrase`：音徽·暗谱 + 音色石 + 残晶）。**门、领取点、secret 自己的坐标三处实测
`floorAt = −144`**，secret 的 y 从悬空的 −180 落回本层地板。四环可以**任意顺序**读（四句话是平行的观察，
不是一条强制的走路次序），门只问"四环齐没齐"。

**判据与守卫**：`validate-data.mjs` 的 `requiresFlags` 三条形状 + 读方登记；
`tests/flow/hidden-rooms.test.ts` **+1 条**（11 条）：逐环读一次、门逐环仍锁（阶梯），
四环齐门才开，领取点拓到 `seal_darkscore`，最后三处 `floorAt` 都是 −144；
`tests/unit/worldstate.test.ts` **+2 条**：合成一块区域量"三面旗立两面仍锁 / 锁文本说清缺哪几件"，
以及"单面与合取同一处求值"（不会被对方顶掉）。顺带记一条量错的地方：那条 flow 用例第一版把音徽写成
`inv.count('seal_darkscore')`，而音徽是**装备实例**（`Inventory.add` 对 `kind:'seal'` 走 `addGear`）——
`count()` 永远读 0，那条断言会绿着说谎；改成数 `inv.gears` 里那一件才对。

**`PENDING_FLAG_WRITERS` 因此销空**（`scripts/ledger-rules.mjs`）。空**就是**它的目标状态：
那本账记的是"被读的旗没有写方"这种欠账，销完就该空着；而 `PENDING_MILESTONE_GRANTS` /
`UI_BOUND_MILESTONES` 记的是"需求要的效果还没有腿"，做下去还会一直有 —— 所以
`tests/unit/ledger-rules.test.ts` 里那条"三份名单都不是空的"拆成了两半：前两份不设空集豁免，
旗标那一份允许为空，判据本身照旧由**合成账本**的用例钉住（集合空 ≠ 判据在空转）。

**反向实测四刀**（每刀事前写明"必须红在哪"，跑完按 sha256 核对还原成字节一致）：
①把 `flag.clue_d5_scratch` 从门的 `requiresFlags` 里摘掉 ⇒ validator **1 ERROR**
（`ws_firstphrase_ring3.setFlag: 写了 'flag.clue_d5_scratch' 但 regions.json 里没有任何读方`）——
这一刀顺带证明**"门的合取列表恰好是那四环"是机器钉住的**：那一面旗若从列表里消失，它就没有第二个读方；
②把校验器里那行读方登记摘掉 ⇒ **4 ERROR**（四条规则各一条）；③门上同时写 `requiresFlag` 与
`requiresFlags` ⇒ **1 ERROR**（两处真值）；④列表里重复列同一面旗 ⇒ **1 ERROR**（重复不会更严，只会让锁文本重复）。

**没做（§78）**：①§4.8 环⑤ 的第二个条件是「`STATE.BELLS.FIRST..FOURTH` 已修」，今天**没接**。
设计表 §7 把它的读法写成 `STATE.TRUTH_KEYMOD_FOUND`（"圣所 ⑤ 门语义"），可那口钟的整条链
（`flag.bells_repair_open` 起）每一环都要过铃姨的对话，接上它就把 `narrative.md §8` 验收里那句
"**存在不依赖任何 NPC 对话的纯环境推理通关路径**"堵死；两句话打架，本批按**纯环境**那一侧落
（门只认四环），裁决留给需求文档持有者。②§4.8 ①②⑤ 把入口说在**休垒铁铺井底**，
而 `IP_SEED.md` 的垂直结构（雾语林→钟坠院→沉唱堂→无耳深窖→**隐藏房初句圣所**）、
`world-bible §5.8`（"深窖最深层之下"）与这条 secret 的实际归属都说圣所在深窖之下 ——
本批按数据与 §5.8 落（门在深窖最深的井底），**不擅自把 secret 搬到休垒**，这句话同样留给需求文档持有者。
③陈设与贴花（尸体摆位 / 遗物文案 / 符号贴花）仍按 KI-013 记 Partial，实机视口走查按 KI-010 记 Missing。

## 附录 A：模块规模与里程碑对照

Phase 1（核心战斗原型）＝ `core + player + combat + tools/CombatDebugger + 占位场景`；Phase 3 ＝ `world/Streaming + generators`；Phase 5 ＝ `rpg + save`；Phase 6 ＝ `quest + audio(对话)`。每模块交付即配 §6 测试，不做「先全写完再测」。
