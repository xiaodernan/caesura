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
    Loot.ts            掉落表（加权随机 + 保底 pity 计数，seeded RNG 可复现测试）
    Upgrade.ts         音色石强化（武器 +1~+10，成功率表，失败不降级）
  quest/
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
- 校验：`npm run validate:data`（Ajv 校验全部 JSON schema，CI/pre-commit 必过）。

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

**WeaponData**（`data/weapons/*.json`）：
```jsonc
{
  "id": "wp_tuning_sword",            // string, 前缀 wp_
  "nameKey": "weapon.tuningSword",    // string, i18n 键（中文名不硬编码在代码）
  "archetype": "straight_sword",      // enum: straight_sword|greatsword|spear|bow|tuning_rod|unique
  "movesetId": "ms_sword",            // string → data/movesets/，含 L1-L4/H/charged/run/jump/back 全套 FrameData
  "atkBase": 12, "scaling": {"str": 0.6, "dex": 0.9},  // number; 伤害=atkBase+Σ(stat*coef)
  "staminaCost": {"light": 12, "heavy": 24},           // number/tick 触发一次
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

**BossData**（`data/bosses/*.json`，扩展 EnemyData）：
```jsonc
{
  "id": "bs_ostlara", "baseEnemy": "en_boss_hanged_knight", "regionId": "rg_drowned_choir",
  "phases": [
    {"enter": {"hpFracGte": 0.6}, "btOverride": "bt_ostlara_p1",
     "music": "mus_bell_knight", "camera": "cam_boss_arena_a"},
    {"enter": {"hpFracLt": 0.6}, "triggers": ["cin_ostlara_bell_pull"], ...}
  ],
  "beatSignature": {"num": 3, "den": 4},          // 节拍可读性（IP_SEED §6：3/4 拍，弹反在重拍）
  "mechanics": [{"id":"bell_shield","type":"gimmick","counter":"lure_bell_impact"}],
  "victory": {"sequence": "cin_ostlara_death", "rewards": [{"item":"sk_mv_tempest_peal"}]},
  "gates": {"regionExit": "flag.bs_ostlara_dead"}
}
```

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
3. HitStop 期间逻辑 tick 照常推进（timeScale 只缩放动画与物理插值，不缩放判定），避免 freeze 时 hitbox 悬停穿模。

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
- **一个被代码推翻的假设（记录以免文档重复传播）**：原本以为「驼鼓踏地（loudness 0.8）会顺手把幽灵八震出来」，实测不成立。`sound.source` 的发射口一共四处：玩家动作**起手帧**（`tryStartAction`，`(f.loudness ?? 3)/10 × weapon.noiseMul`）、玩家的跳跃/落地/翻滚/脚步、**敌方弹道发射**。敌人的**近战 active 帧根本不 emit**（`Enemy` 只出 hitbox），所以踏地无感、敌人之间的噪音也扰动不了它的相位。附带发现：玩家侧的发声时机是**起手**而不是刀刃接触，蓄力长的招式因此提前约 0.4s 报信——这对玩法是有利的（给了读招余量），但和「砍中拍点才显形」的原始措辞不严格相同，故按代码事实登记为 KI-016，不写成已成立的设计。
- **布怪（`regions.json`，全场槽位 30→33）**：破拍营地 `count:1 @(-160,0,-230)`（§14.5 首次登场要在有掩体有杂音的营地边缘）；沉唱堂 `count:2 @(330,-40,60)`（第二区域也要有拍隙压迫，§5.2）。**无耳深窖故意未加**：那关的设计正解依赖声呐/听感感知（Phase 6 的耳朵机制），现在塞两只相位刺客进去只会变成"看不见=打不过"的坏题，登记为延后而不是缺失。
- 覆盖：`tests/flow/phantome.test.ts` 18 条（数据表逐字段、`intangible ⇔ 距拍点 ≤12` 每 tick 恒等 + 占比 `25/BT`、隐形段零位移、近战穿过 vs 半拍命中、弹体穿过不消耗、阈值数学、三个负例、重音显形、拍点闪避抓拍 A/B + 两负例、处决 A/B、真 AI 时序、`next` 连段派生）、`tests/unit/core.test.ts` 补 2 条（`ticksFromBeatPoint` V 形、`ticksUntilBeatOn` 小数拍位与严格向前）、`tests/flow/spawn.test.ts` 补 2 条布点。全量 `npx vitest run` = **19 files / 161 passed**，`tsc --noEmit` + `npm run build` 干净。
- **视口评审（截图对比）未做**：本环境浏览器标签页处于隐藏态（`document.hidden=true`、canvas 0×0、rAF 停摆），渲染器按客户区尺寸建模 ⇒ 拿不到有效像素（KI-010 同一阻塞）。实机验证在 `tickFrame` 手动步进层完成（§6.3 的降级口径），逐 tick 读取的是 `intangible`/`opacity`/`revealTicks` 等状态量而非像素；已核对 300 tick 内 `opacity 0.18` 与 `intangible` **300/300 一致**。

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
- **未落（如实登记）**：①§15.3 的**音刺**（场中噪音汇聚点，重击 4 次击碎 ⇒ 她短暂聋乱 6s 的破势窗）与正解装备「无鸣」（零噪音武器）未实现——音刺要的是「可被攻击、有耐久、会发声的环境实体」，本仓库现在没有这一类实体（`Projectiles`/`EntityStats` 都不承担「可破坏场景物」），它需要 Phase 5 的物品/装备环或一个轻量 props 层；②「投掷音色晶声东击西」同样依赖 Phase 6 的道具实体（伪拍点/伪声源的**消费方已经就绪**：任何 `sound.source` 都能骗过她的判据，所以道具一落地这条解法立即成立，无需改 AI）；③奖励（独特武器无鸣、初句圣所地图刻痕、战技 IV 乐谱）属 Phase 5/6。登记在 KI-023。

---

## 6. 测试策略（需求 §58/§59/§77）

### 6.1 Vitest 单元测试（纯逻辑层，毫秒级）
- `combat/damage.test.ts`：伤害管线各阶段（scaling/弱点×背刺/抗性下限 0/方差区间断言用固定 seed）
- `combat/stamina.test.ts`：攻击/闪避/格挡消耗、耗尽硬直、回复（含 Mute -30%）
- `rpg/inventory.test.ts`：堆叠/拆分/排序稳定性/容量边界
- `rpg/progression.test.ts`：经验曲线公式、音级分配后属性重算一致性
- `tests/unit/save.test.ts`（原计划名 save/migration.test.ts，按仓库既有命名落在 unit/）：
  往返 deep-equal、清剿记录跨会话生效、CRC/magic/version 三道闸、主档损坏→回退 .prev、
  写到一半被 kill⇒主键位仍是完整旧档、迁移链 v1→v2 与「缺步骤必须抛错」、触发器同帧合并与失败发声
- `ai/perception.test.ts`：loudness/距离→suspicion 计算、拍隙可见性（幽灵八）**——已落地但换了载体**：拍隙那半写在 `tests/flow/phantome.test.ts`（相位是跨系统的读感，flow 层才测得动），感知计算仍散在各 flow 的距离/响度断言里；独立 perception 单测等到 Phase 6 的声呐/耳朵机制再合。
- `data/validate.test.ts`：全部 JSON 通过 Ajv schema + id 唯一 + 交叉引用存在（moveset/skill 等）
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

- **只存世界状态，不存实例**：快照 = `{version, playSec, regionId, player(位置/hp/体力/过载/武器), flags[], clearedSlots[]}`。
  关键取舍是 `clearedSlots`：它存的是出怪槽位的**稳定身份**（`区域:组序号:成员序号`）而不是敌人实例，
  所以读档后场景由既有的流送 + SpawnDirector 自己摆回来（Phase 3-C2「出怪来自数据」第二次生效：
  存档里一个敌人数组都没有，也就不可能出现「存档里的怪和表里的怪对不上」）。区域解锁同样只存 flag——
  解锁判定本来就是 `region.unlockFlag ∈ flags`，不需要第二套「已解锁区域」状态。
- **校验和 + 双写 + 回退（Integrity）**：`magic + schemaVersion + crc32(JSON(payload))` 封在信封里；
  写序是 `tmp → prev(上一份) → 主键位 → 删 tmp`，所以任何一步之间被 kill，主键位要么是旧的完整档、
  要么新档已经写完；读序是 主 → tmp → prev → 备份，逐个过校验，取第一份合格的并在日志里说清是哪一份。
  CRC32 只保证「没被截断/改坏」，不是密码学校验（本地单用户存档不需要后者，写在这免得被当成安全边界）。
- **迁移链禁止「读旧档直接崩」**（Migration）：`registerMigration(from, fn)` 逐级升到当前版本，缺步骤抛
  `MigrationError` 并由调用方回退到上一份。当前只有 v1：**没有**为了展示机制而虚构一段历史——
  测试里注册的 v1→v2 用完即撤，等 Phase 5-B 真加背包字段时把那一步写成正式迁移。
- **触发器与游戏循环解耦（Checkpoint）**：调音桩休息 / Boss 跳阶 / 首次进区域三个时机都只 `request(reason)`
  排队，异步写在后台跑（连请求会合并原因、合并成一笔），失败既发日志也发 HUD 提示——
  「以为存了其实没存」比不能存档更糟。`pagehide` 也挂了一次（关标签页前补一笔）。
- **环境差异如实处理**：`typeof indexedDB === 'undefined'` ⇒ 备份位为 null 并在控制台说明「只剩本地一份」，
  不静默假装双份；存储写失败（隐私模式配额）走同一条「说出来」的路径。
- 覆盖与实机：`tests/unit/save.test.ts` 7 条；全量 **27 files / 249 passed**，tsc/build 干净。
  实机：`?fresh=1` 开局 → 走到钟坠院存档点、设 flag、把 hp/过载调成非默认值 → `saveNow()` →
  localStorage 出现 `caesura.save.autosave` + `.prev`、IndexedDB 里同键可读 → **刷新页面** →
  日志 `load.ok autosave v1`，玩家回到 (130, 64, -120)、hp 41、过载 7、三条 flag 全在、
  脚下层 64、区域判定 rg_fellcarillon、周围敌人由数据重新刷出。控制台 0 error 0 warn。
- **未落（登记 KI-025）**：三槽位与「继续冒险/新游戏/存档摘要卡」的存档 UI（ui-ux §8）还没有界面层，
  现在是单 autosave 槽 + `?fresh=1`；inventory/quest/settings 字段等各自 Phase 落地时补迁移。
## 附录 A：模块规模与里程碑对照
Phase 1（核心战斗原型）＝ `core + player + combat + tools/CombatDebugger + 占位场景`；Phase 3 ＝ `world/Streaming + generators`；Phase 5 ＝ `rpg + save`；Phase 6 ＝ `quest + audio(对话)`。每模块交付即配 §6 测试，不做「先全写完再测」。
