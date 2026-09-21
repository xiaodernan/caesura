# KNOWN_ISSUES / 技术债登记（需求 §78/§79）

状态词表：**Implemented** ｜ **Partial** ｜ **Placeholder** ｜ **Blocked**

## 1. Known Issues（已知问题）

| ID | 描述 | 严重度 | 状态 |
|---|---|---|---|
| KI-002 | 处决/背刺（§5.4）逻辑完整（触发 A/B/C、真伤公式、过载消耗、演出期无敌、i-frame、headless 测试覆盖），但**演出为简化蒙太奇**：无独立处决动画、无越肩推轨锁定镜头。 | P2 | Partial |
| KI-003 | 处决期"休止"全频低通听感（§5.4）与专属处决音效未接，暂用 `chord_slam`+`death_shatter` 占位。 | P2 | Placeholder |
| KI-004 | 手柄振动（§64）：`Haptics` 已按 combat.hit 的 shakeKey 分级驱动 `vibrationActuator.playEffect`，无手柄时优雅降级（已验），单元测试覆盖映射与调用。**实体振动主观手感未在接手柄设备复验**（本环境无控制器）。 | P2 | Partial |
| KI-005 | `npm run build` 单 chunk >500kB：`three` 未按 manualChunks 拆出（rollup 对 CJS 依赖分包限制），首包偏大。非阻塞。 | P3 | Partial |
| KI-006 | 引针枪蓄力「投掷枪」（§4.3）**已闭合（Phase 4-A）**：`ms_spear.charged` 去掉 hitbox/lunge，改为 `frames.projectile`（combat.md 口径：28m/s 直线、射程 26m、`pinTicks` 72=1.2s 定身），命中走统一的 `resolveDamage({ranged:true})`（DR×0.6）与防御阶梯。实机复验（真键鼠事件 + tickFrame）：锁定 14.5m 的漂调者 → 33 tick 飞行 → 40 伤害 + `钉住 −40` 提示 + 破势 → 第二枪击杀、槽位永久清剿；弹体与网格数同步归零，控制台 0 error/0 warn。剩余缺口：①投出的枪**不落地留存、无「按处决键拾回」动词**（§4.3 原设，需 Phase 5 物品/装备环一起落）；②无投掷专属动作，暂用蓄力挥势 `flags:["throw"]` 近似（KI-007 同族）。 | P2 | Implemented |
| KI-007 | 换武器时 ActorVisuals 的武器模型不变（仍音调叉巨剑外观）；外观随武器切换为 Phase 7 视觉打磨项。 | P3 | Placeholder |
| KI-008 | 区域流送逻辑完整，**表现层为灰盒**：`world/Streaming.ts`（48m 3D cell、激活环1/预载2/卸载3+2s 防抖、in-flight≤4、优先级、区域解锁门、teleport 同步加载、MissingRef 校验）+ `data/json/regions.json`（7 区域）+ `world/ChunkGreybox.ts`（按 `world.chunk` 事件挂/摘 InstancedMesh 板面与地标，全场常驻 2×7=14 drawcall）。缺的是**内容几何**：chunk 目前只有地面板面（无高度场/墙/植被/遗迹模块），区域间仍靠 `PlaceholderArena` 的平面兜底。 | P1 | Partial |
| KI-009 | RegionData 暂**不含 `navmeshRef` 实体**：`Navigation.ts` 未落地，regions.json 里该字段留空以免产生悬空引用（MissingRef 校验会报警）。 | P2 | Placeholder |
| KI-010 | Phase 3 验收①「实机从休垒走到未竟厅」只能在 headless+浏览器 tickFrame 层面验证（区域切换/预算/无泄漏/落层）；**视口评审（截图）仍被隐藏标签页阻塞**（canvas 0×0、rAF 暂停），需可见浏览器窗口。**Phase 4-D 复发**：原计划补「隐形段 vs 实体段」两张截图对比，实测 `document.hidden=true`、canvas `0×0` ⇒ 未产出，改以逐 tick 状态量核对代替（300 tick 内 `opacity 0.18` 与 `intangible` 300/300 一致）。 | P1 | Blocked |
| KI-011 | ~~`Surface.floorAt` 不受 `unlockFlag` 约束~~ **已闭合（Phase 3-C1）**：`Surface` 现接受 `isClosed(region)` 闸门谓词，main.ts 注入 `!streaming.isRegionUnlocked(r)`；未解锁区域既没有可站面也没有交互物（`traversal.test.ts` 断言①）。剩余缺口只是灰盒表现：闸门「开合」没有动画/门模，仅表现为板面出现与提示文案。 | P1 | Implemented |
| KI-012 | 垂直通路：上行已用**遮蔽传送等价物**近似（`InteractableRef.to` + `world.travel` → `streaming.teleport` 同步激活脚下 chunk，实测共鸣井/吊桥/管风琴吊机把人送到 -144/64/152 层并正常落层）。缺的是**连续运动演出**：井笼升降/吊桥落板的路径动画与物理过程（当前是瞬时落点 + `gate_creak` 占位音），以及可破坏音壁的几何碎裂。 | P1 | Partial |
| KI-013 | **交互物占位模已可见（Phase 3-C3）**：`world/InteractableGreybox.ts` 按 kind 分池挂 26 个占位模，跟流送挂/摘、焦点点亮、setsFlag 已置位则压暗（谓词驱动 ⇒ 读档后首帧即正确）。剩余缺口：**只是形状可辨**，无材质/贴图/动画，`teleport` 类目前无数据条目，正式模在 Phase 7 替换。 | P2 | Partial |
| KI-014 | **弹体无世界遮挡（Phase 4-A 遗留）**：`Projectiles.ts` 只做运动学，消失条件仅射程/寿命/落地三种，不对墙体与地形做射线，所以远程敌人可以隔岩壁投掷、长枪可穿过掩体。**4-B 之后同一缺口覆盖反射弹道与针喉赤线**（线会穿墙指向落点、反射体会穿墙回射）。灰盒期影响可读性但不破坏平衡（当前区域无室内掩体几何）。 | P2 | Partial |
| KI-015 | **架构文档 §3.1/§6.5 里写到的工具链尚未全部接线**：`npm run validate:data`（Ajv）、`test:e2e`（Playwright）、`perf:capture`、`lint`（eslint）与 husky 都不存在于当前 `package.json`——真正的门禁是 pre-commit `tsc --noEmit` + `vitest run`（161 条）。数据完整性目前由**测试内断言**承担（`arch-boundaries` 扫 sfx key 是否都在合成表、`support` 扫 mute 必带时长、各 flow 逐字段对设计文档），够用但不是 schema 级校验。要么补 `scripts/validate-data.ts`，要么改文档口径，不允许继续写「必过」这种不存在的门。 | P2 | Blocked |
| KI-016 | **`sound.source` 的覆盖面不对称 ⇒ §14.5「重音暴露」只在半边场上成立**。现存的发射口有四处：玩家**动作起手**（`ThirdPersonController.tryStartAction`，`(f.loudness ?? 3)/10 × weapon.noiseMul`）、玩家的跳跃/落地/翻滚/脚步、**敌方弹道发射**（`CombatManager`）。缺口：①**敌人近战招式不发声**（`Enemy` 的 active 帧只出 hitbox，没有 emit）⇒ 驼鼓踏地（设计响度 0.8）不会把附近的幽灵八震出来，「噪音越大越容易暴露相位」这条规则对敌人之间完全不生效；②玩家侧的发声时机是**起手那一帧**而不是刀刃接触那一帧，所以蓄力长的招式会提前 0.4s 报信——这一点目前对玩法是有利的（给幽灵八读招留了余量），但它和文档里「砍中拍点才显形」的措辞并不严丝合缝，已在 §5.9.3 按代码事实写明。修复方向：给 `Enemy` 的 active 帧补 `sound.source`（要连同 §11 噪音感知与潜行警戒一起回归，`perception` 会整体变响）。 | P2 | Partial |
| KI-017 | **相位判定的时钟口径分裂**：拍钟由 `main.ts` 用 `time.dt` 推进，而逻辑帧由 `GameLoop.tickFrame` 用固定 `TICK_DT` 推进；命中停顿把 `dt` 压到 5% ⇒ 实机在 hitStop 的这几十毫秒里拍钟会**落后于**帧表，幽灵八的隐形窗与玩家看到的动作会有可感知错位（headless 测试夹具因此显式 `rhythm.update(TICK_DT)` + 每 tick `time.reset()`，见 `phantome.test.ts` 文件头注释）。不在本次伪装修补：正解是把 tick 变成节拍唯一时钟源（Phase 5 时钟统一）。 | P1 | Partial |
| KI-018 | **无耳深窖未布幽灵八（§5.2 列了它）**：故意延后。那关的设计正解是「靠听而不是靠看」，而听感感知（声呐/`deaf` 敌人/耳朵机制）尚未落地；现在塞两只相位刺客进去只会变成「看不见 ⇒ 打不过」的坏题。已在 `regions.json` 只落破拍营地 ×1 + 沉唱堂 ×2（全场槽位 30→33）。 | P2 | Blocked |

## 1.5 系统状态总表（需求 §78，每 Phase 出口更新）

| 系统 | 状态 | 缺口 | 优先级 |
|---|---|---|---|
| 移动/相机/锁定/闪避 | Implemented | — | P1 |
| 命中判定/伤害管线（DR/背刺/弱点/破势） | Implemented | — | P1 |
| 防御阶梯（弹反>无敌>完美格挡>格挡>硬吃） | Implemented | — | P1 |
| 节拍时钟 BeatClock（攻防共用） | Implemented | 敌人 hit-frame 量化到拍槽 | P1 |
| 敌人 FSM（嘈壳/漂调者/驼鼓/针喉/叠唱/幽灵八） | Partial | 漂调者 **ranged**（2.2~11m 尖啸投掷）、针喉 **ranged 狙击**（14-26m 背退风筝 + 三叠箭 + 赤线 telegraph）、叠唱 **support**（`hold` 站定 + 定调光环 + 走调时刻）、幽灵八 **assassin**（`archetype:'assassin'` + 拍隙相位，见下面三行），全在 `enemies.json`；悬钟骑士等精英与三类 Boss 未做（Phase 4 续 / Phase 5） | P1 |
| 弹道子系统（`combat/Projectiles.ts`，Phase 4-A） | Implemented | 纯逻辑零 three：半隐式欧拉 + 重力/射程/寿命/落地四类过期、pierce+hitIds 去重、`withOwner` 归属回收、`reap` 单次通知；9 条单测 + 16 条玩法流（含 AI 真开火、三档防御对远程同样成立）；遮挡缺口见 KI-014 | P1 |
| 远程命中结算（复用单一伤害通道） | Implemented | 玩家投掷走 `strikeEnemy+ranged`（**DR×0.6**），敌方弹体走同一条 `resolveAgainstPlayer` 防御阶梯（弹反>无敌>完美格挡>格挡>硬吃）；钉住=stunTicks、裂音层、onBeat 架势×2 全部沿用近战语义 | P1 |
| 弹道反射（§5.2/§5.3 弹反/完美格挡把弹体打回主人） | Implemented | `resolveAgainstPlayer` 返回 `DefenseOutcome` 驱动后事：反射比例走数据（parry 100% / perfectBlock 50%）、`ownerId` 改 player 且 `parryable:false` 防无限对弹、出生帧不判定防自伤、i-frame 只标 `hitIds` 不杀弹体；实机 tickFrame 复验：`parry→反射 14 伤打回射手 −16HP`、`perfectBlock→7 伤`（真 KeyG/KeyF 输入） | P1 |
| 远程 telegraph 赤线（§14.4 线终点=落点） | Implemented | 逻辑层 `combat.telegraphs()` 只读线段名单 + 表现层按 `ownerId` 池化细长线盒（`opacity∝k²`）；依赖闸门仍全绿（`import type`）；玩法流断言「恰好亮满 48 tick」 | P1 |
| 射手风筝行为（`kiteRange`/`chaseBeyond`/伪动作 `backstep`） | Implemented | 距离带伪动作决定脚步、`PSEUDO_ACTIONS` 过滤出招候选，改表即改行为；离家上限与放弃距离全数据（针喉 18m/26m） | P1 |
| 针喉 Skewer `en_skewer`（第 4 种敌人） | Partial | 三叠箭用 `burst.at=[0,32,42]` 表达 §14.4「第 2 拍延迟 0.25 拍的假动作」，但**「骗到翻滚后硬直 0.6s」的诱饵惩罚未做**；布怪只落破拍营地塔哨 ×2 | P1 |
| 定调光环（§14.6 `ai.buffAura`，敌人给敌人加 buff） | Implemented | `AISystem` 每 tick 纯函数式重算：范围内**最近**的存活来源、不叠加、`buff.fromId` 可溯源；伤害乘 `dmgMul` 走 `activeHitbox`/弹体两条出口，攻速乘 `attackSpeedMul` 用**整数帧累加**（`speedAcc`）以保持帧表 `=== startup` 广播点。施主一死下 tick 自动失效，无需清理事件。实机（破拍营地）：`en_refrein` 给阵内 2 只嘈壳定调（6.0m/10.1m），其余 3 只（16.6/22.5/29m）不在罩内 | P1 |
| 走调时刻（§14.6 击杀支援 → 全营失衡） | Implemented | `ai.offTuneOnDeath={stunTicks,resetAlertness}` 由 `CombatManager.offTuneMoment()` 消费：存活敌人硬直 + `attack=null`（读条中的招式一起作废）+ 按表清警觉，广播 `ring_echo`/`burst_shell`/「走调时刻！N 名敌人失衡」。实机：击杀叠唱 → 7 名敌人 stun 83（90 已过 7 tick）、alertness 归零；普通敌人死亡不触发（回归已断言） | P1 |
| 叠唱 Refrein `en_refrein`（第 5 种敌人·支援位） | Partial | 行为全数据化（`hold` 伪动作=不追不逃、`noise` 噪音弹 18m/10 伤/闷音 2s）；缺口：**「其吟唱=可见五线光栅罩住同伴」的专属表现未做**（灰盒里只区别于配色，被定调者零可视标记 → Phase 7）、§14.6「体力消耗 −20%」**无消费方**（敌人无体力经济，故不写空字段）、布怪只落破拍营地 ×1 | P1 |
| 节拍空隙 / 相位实体（§14.5 `ai.beatGhost`） | Implemented | `RhythmClock.ticksFromBeatPoint()`（离拍点多少 tick，V 形可比）+ `Enemy.intangible/revealTicks` 每 tick 纯函数重算，零事件清理。免疫四条消费口全闭：近战盒穿过且不占目标名额、弹体穿过且**不消耗** `hitsLeft`、处决候选跳过、`stepToward`/`lunge` 定身；显形（`revealTicks>0`）即四口同时失效（回归已钉）。打空只发一次 `ring_echo`、**不吃 hitStop 不出命中音**；表现层 `opacity 0.18/1` 两档而振源核始终全亮。三条解法：重音出手震形（阈值 0.6 卡在潜行/重音武器之间，四把武器逐个算术断言）、拍点闪避抓拍（reach 用招式自己的 hitbox 半径 ⇒ 射程外负例自然成立；奖励 `reveal/stun` 各 60 tick 且读条作废）、伪拍点声源（消费既有 `sound.source` ⇒ Phase 6 音色晶零新管线）。实机 tickFrame：300 tick 隐形占比 0.563、`opacity` 与 `intangible` 300/300 一致、抓拍 `reveal 57/stun 57/attack null` + 提示到位 | P1 |
| 命中帧量化到拍位（§2.1/§14.5 反相读感） | Implemented | `ticksUntilBeatOn()` 重写为**严格向前**量化且**允许小数拍位**（1.5 = 第 1 拍的 "and"）。旧实现在本拍拍位已过时返回 0 ⇒ 命中帧漂到拍间，正好毁掉「幽灵八与全场反相」的读感。实测真 AI：起手量化误差 ≤1 tick、**命中帧 100% 落在隐形段**（`hitWhileVisible === 0`）；单测 2 条覆盖 V 形与向前语义。口径分裂见 KI-017 | P1 |
| 连段派生 `frames.next`（§13.1 呼吸拍） | Implemented | 一段收招时把下一段的 `tick` 设成 `-ticksUntilBeatOn(next.beat)`（负值=前摇提前量），于是两段之间留下真实拍隙而不是帧级硬接——§14.5「切分连踏 2 段半拍」由此成为一条数据。字段是**所有敌人通用**的（首个受益者是近战连段），`synco1→synco2` 实测 `order=['synco1','synco2']`、间隔 ≥10 tick、两段量化误差各 ≤1 tick。玩家侧的 `next` 连段输入队列早已存在，两侧现在共用同一语义 | P1 |
| 幽灵八 Phantome `en_phantome`（第 6 种敌人·刺客） | Partial | 相位机制完整（见上三行），hp80/poise24/speed4.2、三招 `backcut/synco1/synco2` 拍位全 `[1.5,2.5,3.5,4.5]`、`backcut` 带 240 tick 闷音、帧数逐条对 combat.md §14.5 的毫秒规格。缺口：①**解法 a 的道具本体（投掷音色晶）不存在**，Phase 6 才落——现在能震出它的只有玩家重音出手与敌方弹道；②§14.5「它改写全场拍感」无音频/音乐层表达（BPM 与乐句不因它在场而变化，Phase 8 区域 BGM 一起做）；③外观只有 `opacity` 二档跳变，无淡入淡出补间与专属受击音（Phase 7）；④布点不含无耳深窖（KI-018） | P1 |
| 状态异常·闷音 Mute（§11 时长归数据） | Partial | 时长全部改为显式 `ticks`（`statusOnHit.ticks` / `projectile.muteOnHit`，单位 tick），并修掉驼鼓 `stomp` 曾把 `statusOnHit` 写进 `frames` + tag 前缀不匹配 ⇒ **闷音从未生效**的真 bug；已落地消费方只有「体力回复 −30%」（`EntityStats`），**「战技/律具技封锁 4s」待 Phase 6 乐章战技**；单测扫全表强制 mute 类 statusOnHit 必须声明时长 | P1 |
| 弹体表现层（`world/ProjectileVisuals.ts`，按 kind 分池） | Implemented | 每 tick 只读弹体快照同步位置/朝向/脉冲；长枪按速度取向、音符脉冲自旋；`peakLive`/`peakTelegraphs` 峰值观测；8 条断言含「两波往返网格数不涨」的池泄漏回归（该条抓到真 bug） | P2 |
| 处决 / 背刺（§5.4 A/B/C） | Partial | 见 KI-002/003 | P1 |
| 近战武器（调律剑 / 强音大剑 / 引针枪）帧数据+切换 | Partial | 弓/杖/隐藏刺剑未做（Phase 5 全解锁）；引针枪投掷枪已实现（KI-006 闭合）；外观见 KI-007 | P1 |
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
| 数据驱动出怪（`world/SpawnDirector.ts`，§66「敌人布置」） | Implemented | **33** 槽位全部来自 `regions.json.spawnGroups`（零硬编码 `ai.spawn`，含针喉 ×2、叠唱 ×1、幽灵八营地 ×1 + 沉唱堂 ×2）；稳定槽身份 + 种子化布点 + flag condition + maxAlive 预算；9 条单测 + 7 条出怪/流送流（`spawn.test.ts` 现已覆盖「营地有刺客」「沉唱堂编入 2 只幽灵八并落在 -40 层」）；开局休垒按安全屋设定**零敌人**，原 main.ts 里 4 行硬编码靶怪改为雾语林数据布点 | P1 |
| 实体回收与 GPU 释放（`AISystem.despawn` / `entity.despawned` / `ActorVisuals` dispose） | Implemented | 离开激活格=回收（不记清剿）、击杀=永久清剿不再刷；实机 4 轮出/入往返：`scene.children` 稳定在 38、控制台 0 error 0 warn | P1 |
| 交互物占位模（`world/InteractableGreybox.ts`，按 kind 分池 InstancedMesh） | Implemented | 26 条全部可见、跟流送挂/摘、`ui.prompt(id)` 点亮焦点、flag 谓词压暗消耗态（读档后首帧即正确）；9 张池 = 9 drawcall 恒定；6 条 headless 断言 + 实机巡回 0 error/0 warn；正式模见 KI-013 | P2 |
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
