# CAESURA《止音纪元》— Technical Architecture（技术架构）

> 状态标注约定（需求 §78）：Implemented / Partial / Placeholder / Blocked。
> 本文档当前为 **Implemented（文档层）**——是 Phase 0 预生产产物，代码尚未开工，所有运行时条目均为 Planned。
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
| Behavior Tree / Blackboard / EQS | 自研 TS 行为树（`ai/bt/`：Selector/Sequence/Decorator/Service 节点 + Blackboard `Map<string,unknown>`）；EQS 由「查询生成器」近似：候选位置打分（距离/视线/掩体） | **等效**（简化版） | 无编辑器可视化（用 `tools/AIDebugger` 面板树形打印替代）；节点类型先实现 8 种够用即止 |
| State Machines | 分层 FSM（HFSM）手写状态类，需求 §20 的 11 态全覆盖 | **等效** | — |
| UMG / Common UI | DOM（HTML/CSS）做菜单栈/背包/对话 + 单个 overlay canvas 做 HUD 实时元素（HP 振幅条、节拍环）；`ui/` 统一 Widget 栈管理焦点/输入捕获 | **降级** | 无矢量缩放 DPI 自动适配（用 rem + canvas scale 手工处理）；材质化 UI（振膜质感）靠 CSS backdrop-filter + canvas shader，效果上限低于 UMG |
| Niagara GPU 粒子 | 自研 GPU 粒子：`InstancedBufferGeometry` + 顶点动画 shader（生命周期/速度/颜色写入实例属性，CPU 仅管理发射器）；CPU 回退路径给 Low 档 | **近似** | 无模块图编辑器（发射器配置全部 JSON 数据驱动，见 §3 SkillData.vfx）；流体/ribbon 拖尾用定制 tube shader 单独实现 |
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
  player/
    ThirdPersonController.ts  胶囊角色控制器：move/sprint(耗体力)/jump/dodge(i-frame 窗口
                       数据驱动)/fall(落地硬直按高度分档)；贴地射线 + 台阶自动上 0.4m
    CameraRig.ts       弹簧臂 + 碰撞回弹（球体射线 5 点采样）；模式：exploration/combat/
                       lockOn/boss(独立行为：更近、略微低角度、target bias 0.7)/cinematic
    LockOn.ts          目标评分锁定（角度优先→距离，8m~35m 锥形）；切换循环、遮挡脱锁、
                       锁定圈 strafe 重映射、boss 强制单锁
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
    Perception.ts      视觉（视锥 120°×视距 + 遮挡 raycast）与**听觉**（EventBus 订阅
                       footstep/attack/dodge 声源事件→声波球半径→噪声吸引 aggro）。
                       听觉是隐藏 Boss 万籁「声音狩猎」的核心机制：声源事件统一带
                       loudness 标量，AI 按 loudness/距离 计算 suspicion——必须作为
                       一等公民设计，不能后补
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
    Checkpoint.ts      autosave 触发器（调音桩休息/Boss 阶段切换/区域首次进入）、槽位×3
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

## 3. 数据驱动规范（需求 §55）

### 3.1 总原则

- **零硬编码**：所有帧数据（startup/active/recovery）、伤害、掉率、对话文本、AI 参数只存在于 `src/data/`，以 `import x from '@/data/weapons/xx.json'` 构建期打包（获得类型检查）；注册进 `Registry.data` 按 id 取。
- 每类 JSON 有对应 TS interface（`src/data/schema.ts`），文件命名 `kebab-case`，`id` 全局唯一且带类别前缀（`wp_`/`en_`/`bs_`/`it_`/`q_`/`sk_`/`dl_`/`rg_`）。
- 时间单位统一为 **tick（1/60s 逻辑帧）**，杜绝毫秒/tick 混用。
- Gameplay Tag 风格字符串（`damage.physical`、`status.fissure`）替代枚举位掩码，与 §57 GAS-lite 效果系统共用。
- 校验：`npm run validate:data`（`scripts/validate-data.mjs`，**零新增依赖**的字段级校验器，见 KI-015；串在 `npm run check` 里，pre-commit 必过）。它管的是"schema 表达不出来"的那一类约束：跨字段区间、引用是否存在、以及**设计要求的必填组合**（例：带 `boss` 的敌人必须同时有 `intro` 与 `victory` 两格 —— §16「Boss 均带」由此变成机器钉住的规则而不是自觉）。Phase 6-A 起再加一组"可达性"规则（KI-041 的机器版判据，双向对账）：`worldstate.json` 每条规则立的旗标
  必须在 `regions.json` 里真有人读；反过来 `regions.json` 里被读的每个旗标必须有人写，写方缺席的**逐个**列在
  `PENDING_FLAG_WRITERS` 白名单里（只能变短，新增孤儿旗标直接 ERROR）；带 `secretId` 的领取点不许再自己抄
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

规则：
1. 每条反馈的强度分 4 档（graze/normal/heavy/boss），由 FrameData/事件载荷驱动，集中在 `HitFeedback.ts` 派发，禁止散点触发。
2. 「克制」原则（需求 §16）：轻击不得触发 screen flash；只有处决/弹反/破防允许全屏效果。
3. HitStop 期间逻辑 tick 照常推进（timeScale 只缩放动画与物理插值，不缩放判定），避免 freeze 时 hitbox 悬停穿模。**这条到 2026-09-24 才真的是事实**：此前 `main.ts` 把被压缩的 `time.dt` 喂给了节拍钟（判定链路），等于反向违反了本条；KI-017 第一步已改掉，见 §「时间口径的分工」那条。

---

## 5. 性能架构（需求 §48/§49/§50）

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
**依赖边界（自动化闸门）**：`tests/unit/arch-boundaries.test.ts` 静态扫描 `src/**/*.ts` 的运行时 import（`import type` 不计，编译后消失），断言 ①逻辑层（`ai/audio/combat/core/data/input` + `player/{LockOn,ThirdPersonController}` + `world/{Streaming,Surface,Interactables,SpawnDirector}`）不得 import `three` 或表现层模块；②用 `three` 的文件必须都在表现层清单（`main/CameraRig/CombatDebugger/Hud/VfxLayer/materials/ActorVisuals/ChunkGreybox/InteractableGreybox/ProjectileVisuals/PlaceholderArena`）；③除组合根 `main.ts` 外，表现层不得 import 逻辑运行时（只订 `EventBus` 事件）。清单漂移会让「闸门变空测试」，所以另有 1 条断言校验扫描文件数与必扫项。
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
- **已知缺口**：弹体**没有世界遮挡**（不与地形/墙体做射线检测，只按射程/寿命/地面高度过期），因此敌人可以隔着岩壁投掷。登记为 KI-014，修复路径是接 `Navigation.ts` 时一并落地的 `LOS raycast`（`Surface.floorAt` 已是第一步）。

### 5.9.1 反射、telegraph 与射手风筝（Phase 4-B）— 已实现

Phase 4-A 把弹道跑通，但远程只被当作「会飞的近战判定」。4-B 补的是它独有的三件事，全部沿用同一条通道，没有新增结算代码：

- **弹体是唯一「防御成功后仍然活着」的攻击**：`resolveAgainstPlayer()` 改为返回 `DefenseOutcome`（`parry/perfectBlock/immune/block/guardBreak/hit/none`），弹体分支据此决定后事——`immune` 只把 `'player'` 写进 `hitIds`（**穿过去**，之后该落地落地、该到期到期，不凭空消失）；`parry`/`perfectBlock` 调 `reflectProjectile()`；其余才 `kill(pr,'hit')`。反射体按数据比例回射原主人：`parry.projectileReflectMul=1`（§5.3 其箭反射回杀）、`guard.perfectBlockReflectMul=0.5`（§5.2 弹开一半）；`ownerId` 改写为 `'player'`、`hostile:false`、**`parryable:false`**（否则两个射手能对着弹一辈子），射程取「到主人的距离+2」以免反射体在自己的领地边缘提前消散。反射体在**出生帧不参与判定**（`pr.bornTick === tick` 直接跳过），否则当帧打到自己。
- **赤线 telegraph（§14.4「线终点=落点」）**：`ProjectileSpec.telegraph:true` 的招式在前摇期间由 `Enemy.telegraphProjectile` 报出剩余拍数，`CombatManager.telegraphs()` 把「射手出手点→按 `aimAt` 解出的落点」编译成一份**只读线段名单**（含 `ticksLeft/totalTicks`），表现层 `ProjectileVisuals.syncTelegraphs(lines)` 按 `ownerId` 复用一池细长盒（`opacity = 0.12 + 0.72·k²`，越接近出手越亮）。逻辑层不认识 three、表现层不认识 CombatManager——`TelegraphLine` 只做 `import type`，依赖闸门（`arch-boundaries`）照旧全绿。前摇期敌人 `faceSlow(...,0.3)` 持续跟头，所以这条线是**诚实的承诺**而不是随机抽奖：玩家可以看得见地被引到掩体后。
- **风筝行为完全数据化**：距离带里的伪动作 `'chase'/'backstep'` 决定脚下一步，`PSEUDO_ACTIONS` 把它们从出招候选里过滤掉（`hasAttackAction` 才允许 `tryAttack`），`ai.kiteRange` 给「离家多远为止」（针喉 18m），`ai.chaseBeyond` 给「多远放弃阵地回头追击」（缺省 12m，针喉按射程覆盖成 26m）。于是 §14.4「14-26m 永远背退拉近、被贴至 <6m 解围」是**改表**而不是改 AI 分支。
- **连发与假动作**：`attack.launched` 布尔闩锁升级为 `shots` 计数，`ProjectileSpec.burst = {count, everyTicks, at?}`；`at` 给出每发相对 activeStart 的显式帧位，针喉 `tri` 写 `[0,32,42]`——第 2 发比均匀网格（21）晚 11 tick ≈ 0.25 拍，就是 §14.4 的「假动作骗翻滚」。**反制天然成立**：招式被打断即 `attack=null`，余下发数一起作废，不需要额外的取消表。
- **新增敌人 `en_skewer`（针喉）**：hp55/poise22/speed2.4，`snipe`(14 伤/单发) + `tri`(10 伤/三发) + `pluck`(近身 9 伤 R3 击退)，弹道 `shard` speed18/range26/无重力/`telegraph`，`loudness:8`（配合新合成音色 `bowstring`：窄带拨弦瞬态 + 两根快死弦音 + 共鸣腔低鸣，是场上最强的听觉信号）。布怪按 gameplay.md §破拍营地塔哨：`regions.json` 营地区加一组 `count:2`。
- 覆盖：`tests/flow/ranged.test.ts` 新增 7 条（弹反反射=100%/给过载/原弹消失、完美格挡反射=50%、反射体真的打回射手、i-frame 不产生反射体、数据表逐字段对 §14.4、三叠箭 32+10 拍帧位、赤线恰好亮满 48 tick、风筝不越 `kiteRange`、<6m 解围）、`tests/unit/projectile-visuals.test.ts` 新增 3 条 telegraph 池化/亮度/复用，`arch-boundaries` 新增「JSON 里写到的每个 sfx key 都在合成表里」。
- **未落地（如实登记）**：§14.4「三叠箭假动作骗到翻滚后硬直 0.6s」需要「玩家被假动作骗」的判定，当前只做延迟不做诱饵惩罚；KI-014 的遮挡缺口对针喉同样成立（它可隔墙狙击）。

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
- **如实登记的缺口**：①P2「每 2 小节一次换乐句呼吸拍」未做（4-E 的 `barCast` 语义可以承载，但这一条要连着 HUD 的乐句线一起做，见 KNOWN_ISSUES）；②P3「内环 36 / 外环 20」的双层落点未做（一招收势帧只带一个 hitbox，需要多段判定）；③转阶段的「全频低通 0.8s」是音频侧的事，Phase 8 接；④立钟目前是**逻辑实体 + 灰盒模**，玩家不能自己敲钟（§15.1 只要求她撞，故不算偏离，但场地交互动词还没接）；⑤Boss 入场 3 拍演出与胜利序列、以及奖励（乐章战技 I / 音壁回廊捷径 flag）未落，属 Phase 6/8。

### 5.9.6 可背谱轮转、断音柱与敌人前摇音（Phase 4-G 恩希尔 P1）— 已实现（P2/Finale 未落）

§15.2 的 Main Boss 只落了第一阶，但这一阶逼出了三个**通用**载体，都不是「为 Boss 特判」：

- **`ai.pickOrder:'cycle'`：招式按表的顺序轮转，而不是抽签。**「每 4 小节一个乐句，玩家可背谱」在随机选招下是假话——玩家背不了一个掷骰子的对手。`tryAttack` 里 cycle 分支从 `cycleIdx` 起扫第一个不在冷却里的候选（全在冷却就这一拍不出手），于是谱面**可复现**：同一 seed、不同 seed 跑 2600 tick 出来的招式顺序完全一致（flow 里两条断言）。这不是让 AI 更聪明，是让「可预测」这件事真的成立。
- **断音柱 = 真 LOS 之前的显式近似（`boss.covers`）。** §15.2 给全奏的「唯一解之一」是躲进柱子后面，而灰盒期的弹体/AoE 完全没有遮挡（KI-014）。做法是把掩体**写进数据**：玩家在某根柱的圆内、攻击者在圆外 ⇒ 这一击被吃掉（近战吃帧、弹体撞柱而落 `kill(pr,'ground')`，不是「穿过但没伤害」——那样柱子就成了隐形斗篷），并甩一片 `ring_dust` 让玩家知道是谁救了自己。两条防作弊：攻击者也贴着同一根柱 ⇒ 不挡（否则近身缠斗时双方都无敌）；判定用**发射者**位置而不是弹体自身位置（弹体命中时已经贴着玩家，拿它判等于永远判不出遮挡）。**这是近似，架构上就按近似记账**：接上 `Navigation` 的遮挡射线之后，本字段应退化成「射线先打到了什么」，而不是再留一套并行规则。
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
- **实机（真键盘 KeyG）**：未竟厅 152 层把血压到 50% ⇒ `bossPhase=1`、`clockOwner=boss/92`；400 tick 内 `drift` 走出 5 个不同值（-0.073…+0.056）、`beatParasite`/`dodgeJitterTicks` 全程挂上；跑到第 8 小节的停气窗，一次真实 KeyG 按下 ⇒ `stealNeutralTicks=480`、`drift=0`、寄生减益与抖动清零、过载 +2、提示「管风琴停气 —— 换气拍！」+「夺回节拍！中立网格 8s · 过载 +2」、`parry_ring` 可见。**未落**：60% 的外环塌陷与声纹伤害带（要内容几何，KI-008 族）、Finale 的三个外露振源核与 120BPM 崩塌、以及「声部锁链躲回廊柱」所依赖的真 LOS（KI-014：现在由显式断音柱近似承担，见 §5.9.6）。登记在 KI-022。

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

---

## 6. 测试策略（需求 §58/§59/§77）

> **跑测必须用 `--pool=forks`**（`package.json` 的 `test` / `test:flow` 已固定）：默认的线程池在本机
> 环境里会因 `EPERM`（写 SSR 临时缓存被拒）**静默少跑几个测试文件**——报告里只写 "N passed"，
> 少掉的那些不会红。这类"门禁悄悄漏检"比测试失败更危险，所以把池子固定成进程隔离：
> 代价是慢一点，换来的是**跑到的文件数每次都等于磁盘上的文件数**（用 `npx vitest list | wc -l` 对数）。


### 6.1 Vitest 单元测试（纯逻辑层，毫秒级）
- `combat/damage.test.ts`：伤害管线各阶段（scaling/弱点×背刺/抗性下限 0/方差区间断言用固定 seed）
- `combat/stamina.test.ts`：攻击/闪避/格挡消耗、耗尽硬直、回复（含 Mute -30%）
- `rpg/inventory.test.ts`：堆叠/拆分/排序稳定性/容量边界
- `rpg/progression.test.ts`：经验曲线公式、音级分配后属性重算一致性
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
- Playwright（chromium）：`npm run test:e2e`——启动 dev server，加载首页，等待 boot 完成信号（`window.__CAESURA_BOOTED__`），**控制台错误数必须 = 0**（warning 白名单制），WebGL context 存活断言，关键场景截图存 `docs/qa/shots/` 与基线图对比（像素 diff 阈值，视觉评审用需求 §82 清单人工复核）。
- browser-use（交互式 QA 补充）：真实输入走一遍 §6.2 流程（鼠标键盘事件注入），录制 30s 片段验证 game feel（HitStop 手感/摄像机行为无法纯 headless 断言，须截图+录像目检）。
- 性能冒烟：e2e 中采样 10s 帧时间，P99 > 20ms 即 fail（Medium 档 1080p 虚拟分辨率）。

---

## 7. 构建与版本

### 7.1 npm scripts
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

### 7.3 Git 工作流
主干 `main`（始终可玩）+ 短分支 `feat/<system>-<topic>`；commit 前缀约定 `combat:|ai:|world:|perf:|data:|fix:`；PR 合并门槛 = `lint + test + validate:data` 绿，P1 以上另需 `test:flow`；squash merge。大文件：模型/纹理走 git-lfs（或首版全程序化生成=无二进制）。每 Milestone 打 tag `ms-0.x`。

### 7.4 CI 思路（本地先行）
无外部 CI 依赖：git pre-commit hook（husky）跑 `lint + tsc`；pre-push 跑 `test + validate:data`；`scripts/release-check.mjs`（每次发版候选）串跑 build+test:flow+test:e2e 全绿才允许打 tag。未来若上 GitHub Actions：linux runner 即可（无需 GPU 机，e2e 用 headless swiftshader 标记为性能豁免）。

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
  `MigrationError` 并由调用方回退到上一份。当前 **v1→…→v9 八步都是真历史**（v2=成长/背包，v3=失谐归零，
  v4=谱册空谱，v5=逐条保底计数 + 掷骰位置，v6=`usedInteractables`，v7=`quest` 块，v8=`brokenProps`，
  v9=`rpg.movements.passives` 被动栏），没有为了展示机制而虚构一步；每一步都按 §78 的口径写**空**
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
- **未落（登记 KI-025）**：三槽位与「继续冒险/新游戏/存档摘要卡」的存档 UI（ui-ux §8）还没有界面层，
  现在是单 autosave 槽 + `?fresh=1`；quest/NPC/settings 字段等各自 Phase 落地时补迁移（成长与背包已入 v2）。
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
调音桩面板（`src/ui/Stakerite.ts`，DOM overlay）承载四页：调音 / 装备 / 行囊 / **谱册**（Phase 5-C2），
**只在调音桩前可开**（`interact.focus().kind === 'checkpoint'`），打开即 `time.paused = true` + `input.enabled = false`。
面板只调 `RpgRuntime` 的公开方法，生效后回调 `onApply()` 由 main.ts 统一重算——
面板自己不写第二份"应用变更"的逻辑。方向键在四页间**环状**切换（第四页再往右回第一页）。

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

## 15. 世界状态写入层与隐藏房可达性（Phase 6-A 第二步）— 部分实现（3/8 旗标已有写方）

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
- **还欠的部分（如实登记，不假装做完）**：8 个旗标里 3 个有了写方，另外 5 个（`echo_cairn_read` /
  `side_nave_found` / `found_first_phrase` / `brokenbar_resolved` / `brokenbar_allied`）要等 Phase 6-B/C 的
  对话与营地抉择线——它们逐个挂在 `PENDING_FLAG_WRITERS` 白名单里（带原因），所以"新增一个没人写的旗标"
  会立刻红，而欠账本身不会淹没在通用 WARN 里。`sec_drownedchoir_side_nave` 与 `sec_first_phrase`
  还多一层几何欠账：它们的坐标落在可行走层之外（实测 `floorAt` 为 null），要先有能站住的领取点几何。

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

## 附录 A：模块规模与里程碑对照
Phase 1（核心战斗原型）＝ `core + player + combat + tools/CombatDebugger + 占位场景`；Phase 3 ＝ `world/Streaming + generators`；Phase 5 ＝ `rpg + save`；Phase 6 ＝ `quest + audio(对话)`。每模块交付即配 §6 测试，不做「先全写完再测」。
