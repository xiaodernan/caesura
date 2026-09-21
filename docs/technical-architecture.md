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
    Serializer.ts      存档对象 = {version, playTime, region, player, inventory, quest,
                       flags, settings}；JSON + LZString 压缩 → localStorage(主) +
                       IndexedDB(备份)
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
  "roots": [[0,0],[0.02,0]]      // 根运动 (dx,dz)/tick 关键帧表
}
```

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
    "aggroShare": {"camp": true, "callAllyRange": 14}, "retreatPoiseFrac": 0.15
  },
  "attacks": [{"id":"bite","telegraphTicks":20,"frameRef":"frames_bite",
                "damageSrc":"contact","loudness":0.5}],  // loudness 驱动噪音感知
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
- **出怪 `src/world/SpawnDirector.ts`**（无 three 依赖，需求 §66 之「敌人布置」）：数据源是 `RegionData.spawnGroups`（`enemyId/count/center/radius/condition/campId`），全场 27 个槽位；槽身份是稳定的 `region:group:member`，落点 = 黄金角环形布点 + 以槽 key 为种子的 `Rng` 抖动（**同一存档同一位置**，重进不掉随机数）。它只订阅 `world.chunk`：格进 active → 按 condition 出怪，格离开 active → `host.despawn()` **回收而不记清剿**（下次进格重新驻扎）；`entity.died` → 槽位永久进 `cleared`（死过的怪不刷新，需求 §66「击杀持久」）。`maxAlive` 直接取 §5.5 的 AI 硬顶（默认 60，可注入覆盖以做压力测试）；超限时该格编队排队并打 warn，而不是无限堆怪。`condition` 是最小布尔式（`flag.x` / `!flag.x` / `&&`），由 `hasFlag` 注入（main.ts 接 `streaming.hasFlag`），因此「破拍营地编队在营地解决后不再驻扎」这类布点是一行 JSON。`campId` 留给 Phase 4 的 Squad（成组增援）。开局休垒是**零敌人**的安全屋（`spawnGroups: []` 忠于世界观设定，原来 main.ts 里 4 行硬编码靶怪已移到雾语林，由数据布点）。覆盖：`tests/unit/spawn.test.ts`（9 条：condition 真值表、确定性、chunk 归属、生命周期、清剿不刷新、上限+warn、dispose）与 `tests/flow/spawn.test.ts`（5 条：真流送走进布点圈出怪、离开回收、返回重刷、死者不归、营地 flag 闸门）。
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
**依赖边界（自动化闸门）**：`tests/unit/arch-boundaries.test.ts` 静态扫描 `src/**/*.ts` 的运行时 import（`import type` 不计，编译后消失），断言 ①逻辑层（`ai/audio/combat/core/data/input` + `player/{LockOn,ThirdPersonController}` + `world/{Streaming,Surface,Interactables,SpawnDirector}`）不得 import `three` 或表现层模块；②用 `three` 的文件必须都在表现层清单（`main/CameraRig/CombatDebugger/Hud/VfxLayer/materials/ActorVisuals/ChunkGreybox/PlaceholderArena`）；③除组合根 `main.ts` 外，表现层不得 import 逻辑运行时（只订 `EventBus` 事件）。清单漂移会让「闸门变空测试」，所以另有 1 条断言校验扫描文件数与必扫项。
> 注：需求文档设想的 ESLint `no-restricted-imports` 规则本环境未装（零新增依赖优先），改由上述测试承担同一职责；`npm run lint`(=tsc --noEmit) + `npm run test` 一起构成交付前门禁，pre-commit hook 跑 tsc。所有随机数走 `core/Math.ts` 的 `Rng`（`mulberry32` 种子流，可复现测试）；例外只允许出现在 `audio/*` 的音色抖动（不进玩法判定）。逻辑层不使用 `setTimeout/requestAnimationFrame`（一律过 Time/GameLoop）。

---

## 6. 测试策略（需求 §58/§59/§77）

### 6.1 Vitest 单元测试（纯逻辑层，毫秒级）
- `combat/damage.test.ts`：伤害管线各阶段（scaling/弱点×背刺/抗性下限 0/方差区间断言用固定 seed）
- `combat/stamina.test.ts`：攻击/闪避/格挡消耗、耗尽硬直、回复（含 Mute -30%）
- `rpg/inventory.test.ts`：堆叠/拆分/排序稳定性/容量边界
- `rpg/progression.test.ts`：经验曲线公式、音级分配后属性重算一致性
- `save/migration.test.ts`：v1→vN 迁移链、校验和失败回退、双写崩溃模拟（写 tmp 中途 kill=旧档完整）
- `ai/perception.test.ts`：loudness/距离→suspicion 计算、拍隙可见性（幽灵八）
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

## 附录 A：模块规模与里程碑对照
Phase 1（核心战斗原型）＝ `core + player + combat + tools/CombatDebugger + 占位场景`；Phase 3 ＝ `world/Streaming + generators`；Phase 5 ＝ `rpg + save`；Phase 6 ＝ `quest + audio(对话)`。每模块交付即配 §6 测试，不做「先全写完再测」。
