# CAESURA《止音纪元》 · 区域图册（REGIONS ATLAS · 2026-11-15 · bilingual / 中英双语）

> 本文是**世界圣经的增补附录**：八块区域各立一张——位、闸、商、乐、敌——八个坐标点。
> 它不是 runtime data、不是 canon 终裁、不是 EPIC-V 的新章；它是给「想知道为什么这片世界长成这样」的读者的一块地图。
> 兼做：玩家开局看不懂图时的"为什么"——`docs/PLAYER-GUIDE.md` 会把这一册改写成妖风问答；这里保留世界观口径。
> 双语（zh/en）；EN 段里不出中文（ci caesura 里专名——如 Fellcarillon、Resthold、Windbell Coast——自带双语显示）。

---

## 1 · 总览 / Atlas at a glance

| # | 区（id） | 一句话定位（zh） | One-line purpose (en) |
|---|---|---|---|
| 1 | `rg_resthold` 《休垒 Resthold》 | 庇护所：玩家醒来处，也是每一次"回响"的起点 | The shelter: where the player wakes and where every resonance begins |
| 2 | `rg_whisperwode` 《雾语林 Whisperwode》 | 静默之林：回声被"听"成语的林子 | A forest where echoes are listened to into words |
| 3 | `rg_drowned_choir` 《沉唱堂 Drowned Choir》 | 水下唱诗班：声音沉在水下唱了很久 | A submerged choir where voices have been singing underwater for a long time |
| 4 | `rg_brokenbar_camp` 《破拍营地 Brokenbar Camp》 | 营级小镇：残兵群居，哨响即战 | The garrison town: veterans camp, the patrol horn means battle |
| 5 | `rg_fellcarillon` 《钟坠院 Fellcarillon》 | 塔庭：巨钟的巷子，每一口都写了谱 | The spire-courts: alleys of giant bells, music written on every face |
| 6 | `rg_earless_deeps` 《无耳深窖 Earless Deeps》 | 回声井：最下面是莉安；井底是绝响（万籁的猎场） | The echo-well: at the bottom stands Li'an; at the very bottom is the hunt of the Myriad |
| 7 | `rg_unfinished_hall` 《未竟厅 The Unfinished Hall》 | 终局之殿：恩希尔正在等一笔可能永远没人写的判词 | The finale: at the Unfinished Hall, Hersil waits for the last verdict no one ever brings |
| 8 | `rg_windcoast` 《风钟海岸 Windbell Coast》 | 序章之后的世界：音序之外的那片海 | The world after the prologue: the sea outside the sequence |

---

## 2 · 各区详解 / Region details

### 1. 休垒 Resthold（rg_resthold）—「调音桩的归处」
- **Biome / 生物群落**: mountain-edge fortress
- **Grid / 拍网**: BPM 84 / 4 拍 《休止》
- **Unlock / 开量**: 默认（起手）
- **Landmark / 地标**: "休垒广场（调音桩归处）"、"水缸（孩子画的谱）"
- **本区 quests**: quest.bells / quest.meg（序章指引站在休垒）
- **Loot hint**: 起点区，零压力心法——别在这里学"暴击"，先学"不成音"（蓄力>格挡>听拍）
- **EN**: The map's anchor. Every first-time visitor should walk to the square, tap the peg, and learn that the game sees you listening — not fighting.

### 2. 雾语林 Whisperwode（rg_whisperwode）—「风给世界写的记号」
- **Biome / 生物群落**: dense lowland woods / 林缘悬崖
- **Grid / 拍网**: BPM 78 / 4 拍 《雾语》
- **Unlock / 开量**: `flag.left_resthold`
- **Landmark / 地标**: "回声石堆"、"第二口空钟架"
- **本区 quests**: quest.bells（修第二钟）
- **Loot hint**: 刺兽的弱点是翼眼（spine）；浮尘在林子底；氛围是#0xA0A0A0
- **EN**: Where footsteps sound like they are getting answered. The second bell waits for you there.

### 3. 沉唱堂 Drowned Choir（rg_drowned_choir）—「水没过铃舌的时候」
- **Biome / 生物群落**: submerged ruins / 环形回音室
- **Grid / 拍网**: BPM 58 / 4 拍 《沉默》（仍受干涉伤害，但被动受击不至于死亡——这里是情节重地不是动作掩体）
- **Unlock / 开量**: `flag.choir_entrance_open`（钟声石 / 回廊机关）
- **Landmark / 地标**: "穹顶倒影"、"禁忌水位"、"深井"
- **本区 quests**: quest.meg / quest.bells（修第三钟）
- **Loot hint**: 水鬼弱点=连续命中放干涉；凯歌（Choir）正在奏不该奏的调。
- **EN**: A place with no sky; only the memory of sky. The drowned choir is the first region where the player learns that quiet, not loudness, is the weapon.

### 4. 破拍营地 Brokenbar Camp（rg_brokenbar_camp）—「把恸哭编进军鼓的地方」
- **Biome / 生物群落**: camp terrain / 封锁阵地
- **Grid / 拍网**: BPM 84 / 4 拍 《军鼓》（切到 GB-FRAG，进入营地节拍即进入 combat mode）
- **Unlock / 开量**: `flag.left_resthold`
- **Landmark / 地标**: "沙盘帐"、"巡逻哨"、"鼓点营地"
- **本区 quests**: quest.haltrune（破拍营号线）
- **Loot hint**: 营地的那支军鼓会跟随玩家行进变向——踩错拍就暴露攻击节奏。
- **EN**: The only battlefield that taught the forest drums how to mourn. Every beat in camp feels like a decision, and the drum is keeping count.

### 5. 钟坠院 Fellcarillon（rg_fellcarillon）—「悬着的塔、坍的钟钟」
- **Biome / 生物群落**: cathedral spire-field / 阶梯钟楼
- **Grid / 拍网**: BPM 92 / 4 拍 《裂响》（该区域攻击性强，攻击帧密集）
- **Unlock / 开量**: `flag.brokenbar_bridge_down`（营地三连修完）
- **Landmark / 地标**: "悬钟断壁"、"回响之井"、"升钟机房"
- **本区 quests**: quest.corvin（学者之乱） / quest.afterglow（归位）
- **Loot hint**: 这里是战力最集中的地方；敌人频率微微裂变，招式带镜像反射。
- **EN**: A cathedral that lost its voice but not its pitch. Every broken bell here taught someone here how to listen.

### 6. 无耳深窖 Earless Deeps（rg_earless_deeps）—「万籁的猎场」
- **Biome / 生物群落**: underground maze / 鳞甲石礁
- **Grid / 拍网**: BPM 60 / 1 拍 《60BPM 古乐门》（唯一只有半拍的感知区域，节奏被撼击干涉）
- **Unlock / 开量**: `flag.deeps_entrance_open`（塔里拿到的要素）
- **Landmark / 地标**: "莉安的盐丘"、"万籁石巢"、"直通骨脊"
- **本区 quests**: quest.meg（捞拾万籁耳坠） / quest.afterglow
- **Loot hint**: 在这里听见的不是鼓，是石头唱它被撬过的记忆——对应角色基于深音石的攻向。
- **EN**: The loudest silence in the world. A cave with the physics of a tympanum; an orchard of sound where one bell was forged inside the bone.

### 7. 未竟厅 The Unfinished Hall（rg_unfinished_hall）—「一切结局的走向」
- **Biome / 生物群落**: ouroboros chamber / 永恒走廊
- **Grid / 拍网**: 待府（Hersil 私人拍：主区域跟他）
- **Unlock / 开量**: `flag.organ_gate_open`（终末 Boss 关卡）
- **Landmark / 地标**: "未竟之殿"、"拍间的铭"、"最后的台阶"
- **本区 quests**: quest.meg（终） / quest.afterglow（end）/ 恩希尔 finisher
- **Loot hint**: 这里是终点也是出口；每次进入后重置，作为 Ending 重跑；重绘概率=0，否则断开。
- **EN**: The room that doesn't exist — shaped by every answer that was ever almost given. Beat follows its hearer here.

### 8. 风钟海岸 Windbell Coast（rg_windcoast）—「序章之后的世界」
- **Biome / 生物群落**: sea-cliff ruin / 海风蚀海峭
- **Grid / 拍网**: BPM 72 / 4 拍 《风鸣》
- **Unlock / 开量**: `flag.organ_gate_open`（终章尾声后只读：不发奖励 Boss、不发 UI 新仪典，属于「续弦」的停顿）
- **Landmark / 地标**: "风岬瞭望台"、"海蚀拱"、"风化冢"、"风鸣礁石柱群"
- **本区 quests**: （后续 EPIC-VI 的展示位；当前无任何 dialogue 与 Boss，仅「初始远阵风暴」的环境演出可供观察）
- **Loot hint**: 第 8 块区域的本义是「没有答案的判决」：只有风声、骨白海蚀、以及一个玩家可以走过却不必落到的彼端。
- **EN**: The world after the world ended musically. No bell rings here; instead, a line of ridgeheads stands where percussion used to live. Nothing in this region is ahead by design — only by patience.

---

## 3 · 数据真值源 / data provenance
- `src/data/json/regions.json` — 八块区域的权威；
- `regions.json` once edited, `scripts/bake-navmesh.mjs` bakes, validator runs, CI re-locks;
- `navmesh/rg_*.navmesh.json` — 8 张三角网格；
- `explore` / `battle` / `ambience` — 本区主题音乐床：用来承载"ethos arc"（休垒低音/悬齿林深/沉唱缠绕/破拍大鼓/裂响尖锐/沉井古乐/未竟之殿）;
- 不改 runtime behavior — 本文不替换 dialogue.json、不硬编码、不强行加 NPC、不强行加 Boss。

---

## 4 · 谁写了这一册？
作者侧人肉标注（GPT 6 Sol · temp 0.55 · stream+include_usage 记录 cached_tokens=2914）· 不入 runtime · 不入 i18n 关键词 · 不编造 Boss/语录。

END OF ATLAS
