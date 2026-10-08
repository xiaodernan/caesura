# CAESURA 长期开发计划（2026-10-08 夜起 · 持续演进）

铁律：数据驱动 / 字段必须有真实消费方 / 门禁全绿才提交 / 定向测试优先（AGENTS.md：不跑全量回归）。

## ✅ Batch A（已提交 3694509）—— §1.5 Partial 行：泛音弓 + 律具·音叉杖入表（KI-007① / KI-037）
- weapons.json +2（bow / staff）；movesets.json +2（ms_bow / ms_staff，帧表逐格抄 combat.md §4.4/§4.5）
- items.json +2 武器件；progression.json：origin_choir→音叉杖、origin_scavenger→泛音弓（doc §4 出身表早已这么写）
- 新机制腿：弹道分叉（spreadDeg/branchDamageMul/burst）、主箭自动吸附最近目标（assistConeDeg）、
  距离衰减（falloff）、跳跃射击 0.55g、movement ms_bow_split 的 bowForkBranches grant
- ProjectileSpec.kind +arrow；ProjectileVisuals 箭模；ActorVisuals bow/staff 两组新形态
- 修一处既有缺陷：launchPlayerProjectile 出海时已乘 weaponDamageMul，strikeEnemy 又乘一次（双乘）
- KI-039 定价闸按原型分族重裁（弓/杖的价住在射程/分叉/战技，站桩轻击闸结构上看不见——闸自己的限制①）
- 测试：movesets（帧表对账+新闸）、actor-visuals（5→7 组）、新 flow overtone-bow 16 条
- 文档：combat.md §4.4/§4.5 落地注记、tech-arch archetype 枚举纠正（tuning_rod→staff）、KNOWN_ISSUES、§5.9.44

## ✅ Batch B（代码+测试+文档已完，待提交）—— §5.9.33③ 天气三腿（音频/敌人浓度/失谐累积速率，KI-108）
文档无数值口径 ⇒ 先立 `WEATHER_GAMEPLAY_RULINGS` 裁决账本（记"今天给了而文档没有"），再落机制。

**实际落点（与原计划的差异已记录）**：
- `WeatherRow.gameplay` 三格可选乘数 + `world/WeatherEffects.ts` 读数层（缺省一律 1 中性）
- 判据 **G1–G4**：G1 每颗乘数必须挂 ≥20 字裁决理由（null 也拦）；G2 反向能销；G3 拒 1/≤0/越界/未知子字段；G4 基线禁声明
- **敌人浓度腿的实现方式与原计划不同**：原计划「slot 稳定秩门控 + spawnMul 1.5」**内部矛盾**
  （1.5 门在整数秩上永远空转）⇒ 已否决，改为**组内铺开半径 ÷ 乘数**（`SpawnSlot.center` 向组心收拢）。
  理由：slot 条数由 `regions.json > spawnGroups[].count` 写死，运行时无合法来源多造怪。
- 失谐速率乘在 `CorruptionMeter.add()`（环境暴露 + 精英命中两条路共用一处）；今天可观测路径是精英命中
- 声景增益乘在距离衰减之后（不动 `spatialize`）
- `main.ts > applyWeather` 一推四路；开局那次调用搬到 `spawner` 之后（TDZ）

## ✅ Batch C1（已完，待提交）—— §37 第二腿：三层光第一次有主人（KI-109 / §5.9.46）
原计划写"要真几何"，**实际勘查后发现真光源一直就在**：`PlaceholderArena.ts` 里写着死的
`HemisphereLight(0x35406b, 0x1a1410, 0.7)` + `DirectionalLight(0xd8c37a, 1.5)`——那是雾语林的配色，
而玩家出生在休垒 ⇒ 七区里六区从来看见的不是自己的光。所以这批不是"等几何"，是**把已有的灯接上表**。

- `schema.ts > LightingLights`（hemiIntensity/keyIntensity/keyDir/pointIntensity）+ `LightingRow.lights`
- `lighting.json` 七行各一组；`world/Lighting.ts > lightingLights()` → `LightRig`
- 新 `src/world/SceneLights.ts`（表现层）：三盏灯建一次只改参数；`PlaceholderArena` 删掉写死的 hemi/key
- 判据 **L1–L5** + `LIGHT_RULINGS` 裁决账本（`lightingFindings` 第 4 参 `rulings` 可注入）
- **颜色一格都没新开**：§8 已写明 key 色=SKY / point 色=EMIT；SKY 省略 ⇒ 按 SEC（与雾色取 DARK 是两条退路）
- 强度与方向**全部沿用灰盒期实机口径**（不是编的）；深窖 `keyIntensity: 0` = §8 的例外
- point 挂该区第一个 landmark；`setRig(null)` = 三盏全关
- 门禁：tsc 0 错 / validate 0 ERROR 2 WARN / 定向 5 文件 93 条全绿（lighting 15→29 + 新 scene-lights 8）

## ✅ Batch C2（已完，待提交）—— 跨区 70/30 色板过渡带（KI-110 / §5.9.47）
**走了①，且不需要新数据**：`Streaming.paletteBlendAt(pos) → {from,to,t}` 在 `regionAt` 之外多答一个
"站在两区之间"的邻居权重（t = 邻居占比，带子外 null）；邻接由 `bounds` 现推（`borderDistance`），
只认共面接缝（= `boxContacts` 的 face 集）。混合在读数层（`blendLightingSnapshot`/`blendLightRigs`），
经 `ColorGrade.setLightingBlend` + 每帧 `syncLightingBlend` 落地。常量 `TRANSITION_HALF_M=200` /
`TRANSITION_SEAM_W=0.5` ⇒ 70/30↔30/70 相距 160m ≥ 150m。修了 borderDistance 两个真 bug（漏相贴轴 +
重叠区间端点写反）；把 `lights.setRig` 从 applyLighting 并回每帧那条（单一写方）。实测共面接缝 5 对；
文档举例「钟坠院→深窖」今天不相邻，该带今天不存在（已如实记账）。门禁：tsc 0 错 / validate 0E2W /
定向 5 文件 132 条全绿。

## Batch D —— TD-006 ③（听感/音量/视口评审）与 ④（main.ts 装配层覆盖）
③ 本环境无可见窗口 ⇒ 只能把"可断言的数字读数"补齐并登记；④ 用 flow 测试给 main.ts 的装配顺序上读者。

## Batch E —— `lightingPreset` × `regions.palette` 合并裁决（§5.9.42 已登记）
今天两格并存、各有一个读者。要么合并成一个真相源，要么写明"为什么必须是两格"——不许继续含糊。

## Batch F+ —— 按 KNOWN_ISSUES / PENDING_* 账本逐条销账
优先级：PENDING_WEATHER_SWITCHES（四区等叙事裁决）→ KI-094② 的倒钟 WARN → KI-008 真几何族
→ 各 Partial 行里"只差一个读者"的格子。每销一条：数据 + 读者 + 判据 + 测试 + 文档五件套齐全才动状态。

## Batch D —— TD-006 ③（听感/音量/视口评审）与 ④（main.ts 装配层覆盖）
③ 本环境无可见窗口 ⇒ 只能把"可断言的数字读数"补齐并登记；④ 用 flow 测试给 main.ts 的装配顺序上读者。

## Batch E —— `lightingPreset` × `regions.palette` 合并裁决（§5.9.42 已登记）
今天两格并存、各有一个读者。要么合并成一个真相源，要么写明"为什么必须是两格"——不许继续含糊。

## Batch F+ —— 按 KNOWN_ISSUES / PENDING_* 账本逐条销账
优先级：PENDING_WEATHER_SWITCHES（四区等叙事裁决）→ KI-094② 的倒钟 WARN → KI-008 真几何族
→ 各 Partial 行里"只差一个读者"的格子。每销一条：数据 + 读者 + 判据 + 测试 + 文档五件套齐全才动状态。

## Batch G+ —— 长尾
§6 过场（判据已备好，数据与读者未落）/ Boss 主题曲 / §72 测试矩阵剩余格 /
§78 状态总表里每条 Partial 行的下一格读者。
