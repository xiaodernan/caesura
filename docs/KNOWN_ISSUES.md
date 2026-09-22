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
| KI-008 | 区域流送逻辑完整，**表现层为灰盒**：`world/Streaming.ts`（48m 3D cell、激活环1/预载2/卸载3+2s 防抖、in-flight≤4、优先级、区域解锁门、teleport 同步加载、MissingRef 校验）+ `data/json/regions.json`（7 区域）+ `world/ChunkGreybox.ts`（按 `world.chunk` 事件挂/摘 InstancedMesh 板面与地标，全场常驻 2×7=14 drawcall）。缺的是**内容几何**：chunk 目前只有地面板面（无高度场/墙/植被/遗迹模块），区域间仍靠 `PlaceholderArena` 的平面兜底。4-E 顺带把节点 y 对到了本层地板（见下表「内容节点的 y 契约」），但**一区域一块地板**这个限制仍在：真正的高低台地/多层室内要等 `Surface` 支持多块面 + 内容几何，届时布点 y 才允许偏离 `groundY`。 | P1 | Partial |
| KI-009 | RegionData 暂**不含 `navmeshRef` 实体**：`Navigation.ts` 未落地，regions.json 里该字段留空以免产生悬空引用（MissingRef 校验会报警）。 | P2 | Placeholder |
| KI-010 | Phase 3 验收①「实机从休垒走到未竟厅」只能在 headless+浏览器 tickFrame 层面验证（区域切换/预算/无泄漏/落层）；**视口评审（截图）仍被隐藏标签页阻塞**（canvas 0×0、rAF 暂停），需可见浏览器窗口。**Phase 4-D 复发**：原计划补「隐形段 vs 实体段」两张截图对比，实测 `document.hidden=true`、canvas `0×0` ⇒ 未产出，改以逐 tick 状态量核对代替（300 tick 内 `opacity 0.18` 与 `intangible` 300/300 一致）。 | P1 | Blocked |
| KI-011 | ~~`Surface.floorAt` 不受 `unlockFlag` 约束~~ **已闭合（Phase 3-C1）**：`Surface` 现接受 `isClosed(region)` 闸门谓词，main.ts 注入 `!streaming.isRegionUnlocked(r)`；未解锁区域既没有可站面也没有交互物（`traversal.test.ts` 断言①）。剩余缺口只是灰盒表现：闸门「开合」没有动画/门模，仅表现为板面出现与提示文案。 | P1 | Implemented |
| KI-012 | 垂直通路：上行已用**遮蔽传送等价物**近似（`InteractableRef.to` + `world.travel` → `streaming.teleport` 同步激活脚下 chunk，实测共鸣井/吊桥/管风琴吊机把人送到 -144/64/152 层并正常落层）。缺的是**连续运动演出**：井笼升降/吊桥落板的路径动画与物理过程（当前是瞬时落点 + `gate_creak` 占位音），以及可破坏音壁的几何碎裂。 | P1 | Partial |
| KI-013 | **交互物占位模已可见（Phase 3-C3）**：`world/InteractableGreybox.ts` 按 kind 分池挂 26 个占位模，跟流送挂/摘、焦点点亮、setsFlag 已置位则压暗（谓词驱动 ⇒ 读档后首帧即正确）。剩余缺口：**只是形状可辨**，无材质/贴图/动画，`teleport` 类目前无数据条目，正式模在 Phase 7 替换。 | P2 | Partial |
| KI-014 | **弹体无世界遮挡（Phase 4-A 遗留）**：`Projectiles.ts` 只做运动学，消失条件仅射程/寿命/落地三种，不对墙体与地形做射线，所以远程敌人可以隔岩壁投掷、长枪可穿过掩体。**4-B 之后同一缺口覆盖反射弹道与针喉赤线**（线会穿墙指向落点、反射体会穿墙回射）。灰盒期影响可读性但不破坏平衡（当前区域无室内掩体几何）。 | P2 | Partial |
| KI-015 | **架构文档 §3.1/§6.5 里写到的工具链尚未全部接线**：`npm run validate:data`（Ajv）、`test:e2e`（Playwright）、`perf:capture`、`lint`（eslint）与 husky 都不存在于当前 `package.json`——真正的门禁是 pre-commit `tsc --noEmit` + `vitest run`（249 条）。数据完整性目前由**测试内断言**承担（`arch-boundaries` 扫 sfx key 是否都在合成表、`support` 扫 mute 必带时长、各 flow 逐字段对设计文档），够用但不是 schema 级校验。要么补 `scripts/validate-data.ts`，要么改文档口径，不允许继续写「必过」这种不存在的门。 | P2 | Blocked |
| KI-016 | **`sound.source` 的覆盖面不对称 ⇒ §14.5「重音暴露」只在半边场上成立**。现存的发射口有四处：玩家**动作起手**（`ThirdPersonController.tryStartAction`，`(f.loudness ?? 3)/10 × weapon.noiseMul`）、玩家的跳跃/落地/翻滚/脚步、**敌方弹道发射**（`CombatManager`）。缺口：①**敌人近战招式不发声**（`Enemy` 的 active 帧只出 hitbox，没有 emit）⇒ 驼鼓踏地（设计响度 0.8）不会把附近的幽灵八震出来，「噪音越大越容易暴露相位」这条规则对敌人之间完全不生效；②玩家侧的发声时机是**起手那一帧**而不是刀刃接触那一帧，所以蓄力长的招式会提前 0.4s 报信——这一点目前对玩法是有利的（给幽灵八读招留了余量），但它和文档里「砍中拍点才显形」的措辞并不严丝合缝，已在 §5.9.3 按代码事实写明。修复方向：给 `Enemy` 的 active 帧补 `sound.source`（要连同 §11 噪音感知与潜行警戒一起回归，`perception` 会整体变响）。 | P2 | Partial |
| KI-017 | **相位判定的时钟口径分裂**：拍钟由 `main.ts` 用 `time.dt` 推进，而逻辑帧由 `GameLoop.tickFrame` 用固定 `TICK_DT` 推进；命中停顿把 `dt` 压到 5% ⇒ 实机在 hitStop 的这几十毫秒里拍钟会**落后于**帧表，幽灵八的隐形窗与玩家看到的动作会有可感知错位（headless 测试夹具因此显式 `rhythm.update(TICK_DT)` + 每 tick `time.reset()`，见 `phantome.test.ts` 文件头注释）。不在本次伪装修补：正解是把 tick 变成节拍唯一时钟源（Phase 5 时钟统一）。 | P1 | Partial |
| KI-018 | **无耳深窖未布幽灵八（§5.2 列了它）**：故意延后。那关的设计正解是「靠听而不是靠看」，而听感感知（声呐/`deaf` 敌人/耳朵机制）尚未落地；现在塞两只相位刺客进去只会变成「看不见 ⇒ 打不过」的坏题。已在 `regions.json` 只落破拍营地 ×1 + 沉唱堂 ×2（全场槽位 30→33）。 | P2 | Blocked |

| KI-019 | **悬钟骑士的「营长」布点未落（gameplay.md §254 破拍营地 ×1）**：那条要求「仅强攻线交战」——潜行线不该惊动它，而营地的强攻/潜行分线交战判定属于 Phase 6。现在塞进去只会变成开场必战的假精英，故登记为延后。已落的是钟坠院 ×1（守落钟）与无耳深窖入口 ×1（§217 软门），全场槽位 33→35。 | P2 | Blocked |
| KI-020 | **「玩家一刀打断自鸣」只在 headless 复验，实机未复现**：实机 tickFrame 里玩家的挥击被精英自己的攻击反复打断（架势崩溃 ⇒ `player.busy` 吃掉了出招帧），所以那条路径只有 `elite.test.ts` 的两条断言（`interruptBroadcast` 通道 + stun 通道）撑着，没能在真输入下看它响/不响一次。机制本身共用既有读条打断通道（4-C 已在实机验过），风险低，但不写成已复验。 | P2 | Partial |
| KI-021 | **Boss 演出与奖励未接**：§16 要求的「3 拍入场演出」与「胜利序列（音乐停=世界屏息 0.5s）」、转阶段的「全频低通 0.8s」（§10）、以及 §15.1 的奖励（乐章战技 I + 升级 1 点 + 打开音壁回廊捷径 flag）都还没有承载体——乐章战技系统与音壁捷径属于 Phase 5/6，混音低通属于 Phase 8。现在跳阶只落了 hitstop + `boss_roar` + 震镜 + Boss 级提示四件里能落的部分。 | P1 | Partial |
| KI-022 | **恩希尔缺后半张谱面**：P2「夺拍」已完整落地（BPM 游走 / 体力挂他的拍 / 闪避恢复漂移 / 换气拍唯一反制窗，见 §5.9.7），但 §15.2 的 60% **外环塌陷 + 声纹伤害带**（要内容几何，KI-008 族）与 Finale「120BPM 加速 + 三个外露振源核（各 18% HP）」仍未实现；「声部锁链躲回廊柱」现在由显式断音柱近似承担（真 LOS 见 KI-014）。他现在是**两阶段** Boss，满足 §24 的最低要求。 | P1 | Partial |
| KI-023 | **隐藏 Boss 万籁缺场地与正解装备**：§15.3 的「音刺」（会汇聚噪音、可被重击 4 次击碎、碎了让她短暂聋乱 6s 的环境实体）未实现——本仓库目前没有「可破坏场景物」这一类实体（`Projectiles` 只管弹道、`EntityStats` 只管生物），需要一个轻量 props 层；正解装备「无鸣」（零噪音武器）与投掷音色晶的声东击西属 Phase 5/6 物品环。**她的核心行为（声音狩猎 / 听心跳 / 不守拍 / 零强制反应窗）与无网格领域已落地**，且伪声源的消费方已经就绪：任何 `sound.source` 都能骗过她的判据，道具一落地「声东击西」这条解法不需要改 AI。 | P2 | Partial |
| KI-024 | **设计规则互相冲突（需裁决，不是实现缺口）**：§16 写「每 Boss 恰 2 或 3 阶段；阶段必有场地变化而非纯数值」，而 §15.3 给隐藏 Boss 万籁的规格**完全没有阶段**（她的身份是「无拍点机制」+ 音刺场地博弈）。当前实现按 §15.3 做（她一阶到底），没有为了过 §16 的检查表而发明一个设计里不存在的 P2。需要产品裁决：要么给 §16 补一句「隐藏 Boss 例外」，要么为万籁补一条真正的场地阶段（最自然的是「音刺被击碎后」进入聋乱期，见 KI-023）。两位主 Boss（奥斯塔拉 3 阶 / 恩希尔 2 阶）已按 §16 通过断言。 | P2 | Blocked |
| KI-025 | **存档只有 1 个自动槽、没有存档 UI**：ui-ux §8 的「继续冒险 / 新游戏防误删确认 / 存档摘要卡 / 槽位×3」需要菜单界面层（Phase 7/8），当前实现是单个 `autosave` 槽 + `?fresh=1` 开新档 + `window.__caesura.saveNow()`（调试用）。**底层已按多槽设计**（slot 只是键名前缀），补 UI 时不动存档层。另：架构原写的 LZString 压缩按「零新增依赖优先」没引入（实测快照 <2KB），若未来加了背包/图鉴导致体积上涨，再评估压缩或改 IDB 分键存。 | P2 | Partial |
| KI-026 | **快照还不包含成长与任务**：inventory / 音级点 / 乐章战技 / 任务与 NPC 状态 / 设置 都还没有各自的系统（Phase 5-B/5-C/6），所以 v1 快照里没有它们可存的东西。字段加入时必须走 `Migration` 链（v1→v2…），不许改 v1 的读取路径——`save.test.ts` 已经钉住「缺迁移步骤 ⇒ 抛错并回退，而不是静默丢字段」。 | P1 | Blocked |
## 1.5 系统状态总表（需求 §78，每 Phase 出口更新）

| 系统 | 状态 | 缺口 | 优先级 |
|---|---|---|---|
| 移动/相机/锁定/闪避 | Implemented | — | P1 |
| 命中判定/伤害管线（DR/背刺/弱点/破势） | Implemented | — | P1 |
| 防御阶梯（弹反>无敌>完美格挡>格挡>硬吃） | Implemented | — | P1 |
| 节拍时钟 BeatClock（攻防共用） | Implemented | 敌人 hit-frame 量化到拍槽 | P1 |
| 敌人生态（enemies.json 10 条：7 类敌人 + 野外精英 + 三位 Boss） | Partial | 漂调者 **ranged**（2.2~11m 尖啸投掷）、针喉 **ranged 狙击**（14-26m 背退风筝 + 三叠箭 + 赤线 telegraph）、叠唱 **support**（`hold` 站定 + 定调光环 + 走调时刻）、幽灵八 **assassin**（`archetype:'assassin'` + 拍隙相位，见下面三行），全在 `enemies.json`；悬钟骑士等悬钟骑士**野外精英已落**（第 7 种，见下六行）；**§14 七类敌人 + §14.7 野外精英 + §15.1/§15.2/§15.3 三位 Boss 全部落地**（奥斯塔拉 3 阶、恩希尔 2 阶、万籁单阶见 KI-024）；每个 Boss 的残余阶段/场地件按 KI-021～KI-023 登记。缺口只剩 §15.2 Finale「抢核」与万籁的音刺（都要 Phase 5/6 的实体类型） | P1 |
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
| 命中帧量化语义修正（§2.1 的「命中帧落在拍点」） | Implemented | **Phase 1 就存在的违规已闭合**：旧实现把 `tick 0`（起手）当拍点 ⇒ 每个敌人的真正命中帧都比拍点晚一整个前摇（驼鼓 42 tick≈700ms），§2.1 的「±50ms 容差由调度器吸收」与「视觉脉冲与命中同步可预测」全部落空。现在 `ticksUntilBeatOn(beat, leadTicks=activeStart)` 挑「来得及演完前摇」的那一拍，起手提前、收势落在网格上；`offsetFromBeatGrid()` 是把尺子，验收断言误差 <1 tick=16.7ms。副作用：§14.5 幽灵八的命中从「藏在隐形段」修正为「落在 and 位=她实体的窗口」（这才与 combat.md 原文一致），4-D 的错误结论已在架构文档就地更正 | P0 |
| Boss 私有拍速接管（§15.2「区域网格由他接管」） | Implemented | `RhythmClock` 拆成「基准 home + 当前值」两层：`setBpm` 只写基准，`overrideTo(bpm, beatsPerBar)`/`restoreHome()` 借用与归还，`clockOwner` 暴露归属。归还是**派生**的——`AISystem.syncClock` 每 tick 重算「有没有活着且正在交战的 Boss」，所以死亡/脱战/流送回收三条路都自动归还，不需要成对事件。实机：进战翻到 boss/108/3，死亡回 region/84/4 | P1 |
| Boss 单调阶段机 + 招式白名单（§16「阶段必有场地变化而非纯数值」） | Implemented | `boss.phases[i].attacks` 过滤距离带候选（`phaseActions`），`belowHpFrac` 是进入线；跳阶收掉当前读条并演一次怒吼，允许一记大伤害一次跨两阶，血回满**不回跳**。验收②实测：三阶各自 1600~2600 tick 的真 AI 采样里，出现的招式全落在本阶闭包（白名单 + `frames.next` 派生段）内，且每一记命中帧离自己声明的拍网格 <1 tick；三连第三击永远在拍 3（故意破「只在重拍」的规矩） | P1 |
| 钟壳与架势免疫（§15.1 P1） | Implemented | `phases[i].shell={dmgMul, immuneToPoise}` 只在 `strikeEnemy` 消费：伤害乘 0.1、架势不堆（⇒ P1 抓不住处决，机关是唯一解），但**不封死结算**（数字照给、`bell_clang` 照响、后摇照推）。§16 战长红线用算术钉住：剥壳后 P1 段 ≤90s，壳挂着贵 8 倍以上。实机：壳上 3 伤 / 剥壳 26 伤（比值 0.115） | P1 |
| 撞钟机关 + 残响区（§15.1 场地机制） | Implemented | 判据=`flags:['charge']` 那招的**落地帧**她自己的位置离钟 ≤hitRadius ⇒「引她撞钟」是站位而不是反应力。响一口：壳解除 360 tick + 期间架势累积翻倍；响满 2 口：壳永久碎 + 提前进 P2。响过的钟塌成暗桩但留下残响区：每拍对她 4 伤、对玩家 0（同一块场地既是钥匙又是奖励）。`world/BossArenaVisuals.ts` 负责让它可见（未响=亮铜全高/已响=暗桩压扁，两份共享材质，回收即摘）。实机：第一口→lift 360+提示+模压扁 0.32；第二口→`shellBroken`+P2+`boss.phase{2/3}`；第三口仍立 | P1 |
| 可背谱轮转选招（`ai.pickOrder:'cycle'`） | Implemented | 按表顺序轮转（冷却中跳过，全冷却就这一拍不出手）。「每 4 小节一个乐句，玩家可背谱」在随机选招下是假话；flow 里两条断言钉住顺序与 seed 无关性。非 Boss 敌人保持 'random'（嘈壳集群就该看不准） | P1 |
| 断音柱掩体（`boss.covers`，真 LOS 的显式近似） | Partial | 玩家柱内 + 攻击者柱外 ⇒ 近战吃帧、弹体**撞柱而落**（不是穿透无伤），`ring_dust` 作反馈；攻击者同贴一柱则不挡（防双方无敌房），弹体用**发射者**位置判定。它是 KI-014 的占位实现而不是替代品：接上遮挡射线后本字段应退化成「射线先打到什么」。实机 A/B：贴柱 0 伤 + 4 片 dust，迈出半径外 27 伤 | P1 |
| 敌人前摇音（系统性缺口已闭合） | Implemented | `enemies.json` 从第一版就给每招收 `sfx`，但全场只有玩家动作起手与弹道发射在 emit ⇒ 8 类敌人的招式音字段是死的，而本作是**靠耳朵玩**的游戏。现在 `progressAttack` 在 `tick===0`（前摇第一帧）按 `loudness` 抬音量发一响。实机：恩希尔 900 tick 交战 7~8 响前摇音；`mainboss.test.ts` 另钉「同一招不会一 tick 响两遍」 | P1 |
| Main Boss 恩希尔 `en_hersil`（§15.2，第 9 个对手） | Partial | 两阶段：P1 可背谱轮转（音弹三连/管束横扫/全奏）+ 四根断音柱；P2 夺拍三件套 + 换气拍反夺（§5.9.7）。缺口见 KI-022；外观=加大胶囊 + 灰盒柱，管风琴本体待 Phase 7 | P1 |
| Mini Boss 奥斯塔拉 `en_ostlara`（§15.1，第 8 个对手） | Partial | hp420/poise120/私有 3/4 拍@108BPM、三阶七招（挥剑二连/撞钟冲/三连/钟摆斩/拔钟抡砸）、三口立钟、重拍剑击可弹反失音 1.2s（`parryStunTicks`），处决递减走既有 `bossFracs`。缺口：①P2「每 2 小节换乐句呼吸拍」未做（要连着 HUD 乐句线一起做）；②P3「内环 36/外环 20」双层落点未做（一招收势帧只带一个 hitbox）；③入场/胜利演出与奖励见 KI-021；④立钟玩家侧不可交互（只能被她撞）；⑤外观=加大胶囊+振源核，礼钟与双剑剪影待 Phase 7 | P1 |
| 幽灵八 Phantome `en_phantome`（第 6 种敌人·刺客） | Partial | 相位机制完整（见上三行），hp80/poise24/speed4.2、三招 `backcut/synco1/synco2` 拍位全 `[1.5,2.5,3.5,4.5]`、`backcut` 带 240 tick 闷音、帧数逐条对 combat.md §14.5 的毫秒规格。缺口：①**解法 a 的道具本体（投掷音色晶）不存在**，Phase 6 才落——现在能震出它的只有玩家重音出手与敌方弹道；②§14.5「它改写全场拍感」无音频/音乐层表达（BPM 与乐句不因它在场而变化，Phase 8 区域 BGM 一起做）；③外观只有 `opacity` 二档跳变，无淡入淡出补间与专属受击音（Phase 7）；④布点不含无耳深窖（KI-018） | P1 |
| 正面区域减伤（§14.7 钟甲 `ai.armorFront`） | Implemented | 消费点只有 `strikeEnemy` 这一条 ⇒ 近战/投掷枪/未来战技同受管辖；判据用 `EnemyStrike.dir`（攻击者→它）反推来袭方位，不新增来源坐标字段。碎甲走既有 `fissureBurst`（`e.armorBroken` 永久失效，不修甲不长回来）；处决按生命比例结算故**不吃甲**。反馈 `bell_clang` + `block_spark`（被吃掉的那一笔必须听得出来）。实机：正面 21 / 侧面 35 = 0.60；偏 20° 仍吃甲、偏 45° 不吃；一发蓄力顶满 5 层 ⇒ 双提示 + 板子隐藏 + 之后正面 33 = 侧面 33 | P1 |
| 软计时器读条（§14.7 敲钟自鸣 `ai.selfToll`） | Implemented | 进战时排定 `tollDueBar`，每逢 `everyBars` 小节网格到点**强制**插入那一招（不进 `tryAttack` 的 RNG 候选 ⇒ 它是节拍器不是随机招式），走完 `startup` 帧才 `stats.heal`。打断不需要新代码：`strikeEnemy` 每次都调 `interruptBroadcast`，而 stun/破势会清空 `attack`；满血时不敲但计时器照常推进。实机：第 4 小节开唱 ⇒ hp 120→135 恰好 +15、`bell_toll` 响一声、「敲钟自鸣 · 回复 15」 | P1 |
| 读条后事的作废（本 Phase 修掉的真缺陷） | Implemented | `pendingBroadcast` 原本只在「成功发射/被弹反/被玩家命中」三条路径上清空，而 `attack = null` 还可能来自 stun、`recover`、走调时刻、处决 ⇒ 留下的气息会在**下一招的起手帧**上偷偷生效（实测：自鸣被打断后仍回 15 血并响一声钟）。修法=`Enemy.update` 顶部一条一致性守卫（没有读条就没有读条的后事）。回归：`elite.test.ts` 去掉守卫即失败，是抓出来的 bug 不是装饰断言 | P1 |
| 弹反回报差异（`AttackSpec.parryStunTicks`） | Implemented | §14.7「弹反二连第二段→钟体共振眩晕 2s」= 第二段那一格数据（120 tick），第一段没有 ⇒ 通用 18 tick。「同一句防御指令、奖励按招式不同」第一次不需要代码分支。实机 KeyG 弹反第二段：「钟体共振！失衡 2.0s」+ 招式作废 + 玩家零伤 | P1 |
| 内容节点的 y 契约（本 Phase 修掉的数据缺陷） | Implemented | 审计发现 `regions.json` 里钟坠院布点写在 48/52、无耳深窖在 -150/-152，而该层地板分别是 64/-144 ⇒ `shapeHits` 竖向永远错开（双方互相打不着）、`Interactables` range=6 的三维距离「看得见按不到」，而所有数数量的测试照样绿。已把 spawnGroups/interactables/travel 落点对到本层地板，并加两条契约断言：布点 `center.y === groundY`、节点与落点必须踩在 `Surface.floorAt` 认账的地板上（±4m）。**归属不能只看 xz**：叠层世界同一个 xz 压着好几层（下桥进钟坠院 64 与雾语林地表 0 同格），必须带 y 判 | P1 |
| 夺拍（§15.2 P2 的减益三件套 + 反夺） | Implemented | `phases[i].stealBeat` 是唯一开关：带上它 ⇒ CombatManager 游走 `rhythm.drift`（±10%，实测 -0.073~+0.056）、给玩家挂 `beatParasite`（拍点门外 stamina 一律不回，窗内 ×0.75）、抖 `dodgeJitterTicks`（±4 tick=66.7ms，表里写 ms、代码只有 tick，差 0.4 tick 记在测试里不假装凑满 60ms）。反夺=换气拍（`barCast` 到点强制一次 21 tick 的 0 伤读条，`reclaimWindow`）里按弹反 ⇒ 中立 480 tick + 过载 +2 + 三项归零；窗口外按 G 什么也拿不到。实机真 KeyG 复验通过 | P1 |
| 网格例外通道（`AttackSpec.onGrid:false`） | Implemented | §15.2「无拍突进」是全作唯一故意不守拍的招式：`tryAttack` 见它跳过量化与拍位插槽仲裁 ⇒ 命中帧天然落在缝里（flow 断言 >1 tick）。三段用 `frames.next` 串，链式段也不回网格。这条不是「随机延迟」的别名：它让玩家必须从读拍改读前摇身体 | P1 |
| 呼吸拍 / 换乐句（§15.1 P2「每 2 小节停 0.5s」） | Implemented | 4-F 登记的缺口现已闭合：`ai.selfToll` 的排程器升为阶段级 `phases[i].barCast`（`heal` 省略 ⇒ 到点只是站着），奥斯塔拉 P2 每 2 小节给一次 42 tick 的停顿窗，恩希尔 P2 用它承载换气拍 ⇒ 一个原语两个消费者 | P1 |
| 区域网格表（§2.1「每区一拍」+ 深窖无网格） | Implemented | `RegionData.grid` 是**必填**字段（允许省略 = 84 会以缺省值的名义重新变成硬编码）。main.ts 进区域写 home，`AISystem.syncClock` 每 tick 决定当前归谁 ⇒ Boss 私有时钟叠在区域基准之上，下场后还的是**这个区域**那一拍（flow 用深窖 60/1 钉住归还路径）。深窖 60/1 ⇒ 一拍正好 60 tick，就是设计说的「只有心跳」 | P1 |
| 声音狩猎（§15.3 万籁 `ai.huntsSound`） | Implemented | 把「噪声=危险」从潜行数值升成**位置规则**：够响 ⇒ 瞬移到发声点并当场起口（前摇 18 tick 可读）。零新通道——玩家所有发声行为本来就在发 `sound.source`（4-E/4-G 的既有流），所以将来的音色晶道具一落地就自动能骗她。三个数据阀门：`minLoudness`（潜行武器的低噪真的不叫她）、`cooldownTicks=150`（一串脚步只换一次瞬移）、`maxRange`（不跨全图）。实机：站 180 tick 不发声她睡得很香；一次左键挥砍 ⇒ 0.00m 落到发声点 + `bite@2` + 30 tick 后 34 伤 | P1 |
| 听心跳（`ai.hearsHeartbeat`） | Implemented | 玩家连续静止 180 tick 后她的警觉按秒回落；一动清零 ⇒「屏息」是撤离窗口而不是隐身术，与 §11 静步线共用事实但给不同奖励 | P2 |
| 零强制反应窗（§15.3 失败设计验证） | Implemented | 她全招 `parryable:false` + `onGrid:false`：不给弹反窗、不落在拍点上（实测命中帧离最近拍点 >1/4 拍），也不进拍位插槽仲裁（不抢同场 Boss 的出手权）。难度全部来自信息管理与资源博弈，没有一处「按反应力硬吃」的窗口 | P1 |
| 隐藏 Boss 万籁 `en_myriad`（§15.3，第 10 个对手） | Partial | hp380/poise140、视觉与震动都是 0（`sense()` 两条唤醒路径天然为假，不需要「万籁特例 if」）、听觉锥 40m、瞬移咬合 36 伤。场地与正解装备见 KI-023；外观=暗色胶囊，山丘兽剪影待 Phase 7 | P2 |
| 存档管线（§45/§71：校验和 + 双写 + 回退） | Implemented | `src/save/` 四文件按 §2 分工；游戏侧没有任何一处直接碰 localStorage/IndexedDB。快照只存**世界状态**：位置/资源/flag/出怪槽位身份（`区域:组:成员`，不是敌人实例）⇒ 读档后场景由既有流送+SpawnDirector 自己摆回来，不存在「存档里的怪和表里的怪对不上」这一类错误。写序 tmp→prev→主→删 tmp ⇒ 任何一步被 kill 主键位都是完整档；读序 主→tmp→prev→备份 逐个过 CRC/magic/version 闸。实机：设非默认状态 → saveNow → 刷新 ⇒ 位置/hp 41/过载 7/三条 flag/脚下层/区域全部复原，控制台 0 error | P1 |
| 自动存档触发器（调音桩 / Boss 跳阶 / 首次进区域） | Implemented | 同步循环里只排队，异步写在后台；同一帧的多次请求合并成一笔（原因也合并），失败既写日志又发 HUD 提示——「以为存了其实没存」比不能存档更糟。`pagehide` 补一笔。IndexedDB 不可用时备份位为 null 并在控制台说明「只剩本地一份」，不静默假装双份 | P1 |
| 存档 schema 迁移链（§78：旧档不许读崩） | Implemented | `registerMigration(from, fn)` 逐级升版，缺步骤抛 `MigrationError` 并由调用方回退上一份。当前只有 v1：**没有为了演示机制而虚构历史版本**；测试里注册的 v1→v2 用完即撤，真字段（背包/任务）到手时再写成正式一步（KI-026） | P1 |
| 悬钟骑士 `en_hanged_knight`（第 7 种敌人·野外精英） | Partial | hp320/poise80/speed2.6/defense24，四招（钟锤二连 22→24 用 `frames.next` 接、荡钟横扫 30 伤 R3 不可弹反、自鸣 0 伤读条），`callAlly{25,72}` 复用既有警戒广播通道。缺口：①§14.7「横扫后摇 + **背身 1 小节空门**→背刺触发器」只自然成立在「它 lunge 冲过头」这一层，没有显式的空门窗口（要做成可读的教学节拍得配 Phase 7 的动画）；②营地「营长」布点延后（KI-019）；③实机打断未复现（KI-020）；④外观=胶囊+一块钟甲板，礼钟本体待 Phase 7 | P1 |
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
| 数据驱动出怪（`world/SpawnDirector.ts`，§66「敌人布置」） | Implemented | **37** 槽位全部来自 `regions.json.spawnGroups`（零硬编码 `ai.spawn`，含针喉 ×2、叠唱 ×1、幽灵八 ×3、悬钟骑士 ×2、Mini Boss 奥斯塔拉 ×1、Main Boss 恩希尔 ×1）；稳定槽身份 + 种子化布点 + flag condition + maxAlive 预算；9 条单测 + 11 条出怪/流送流（`spawn.test.ts` 现覆盖营地编队、沉唱堂幽灵八、两区精英布点，外加两条 y 契约）；开局休垒按安全屋设定**零敌人**，原 main.ts 里 4 行硬编码靶怪改为雾语林数据布点 | P1 |
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
