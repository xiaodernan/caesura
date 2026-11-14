# CAESURA《止音纪元》 · 怪谈图鉴（BESTIARY · 2026-11-15 · 纯设计记录，不动运行时）

> 本卷是《止音纪元》十册怪物的一次全量盘点（`src/data/json/enemies.json` 逐行核对、为每个敌影写一段停顿）。
> 与 `docs/WORLD-BIBLE.md` 同源纪律：**只记录，不改写**。不替代消毒数据、不改任何字段；HP/POISE/AI/attacks/weakpoint 数字全部来自该数据文件。
> 中文名与 `src/combat/CombatManager.ts#NAME_MAP` 一致；英文名无对应即仅用 nameKey。

---

## 0 · 全谱速览

| id | 名（NAME_MAP） | archetype | HP | POISE | 速度 | 弱点倍率 | 战术核心数 |
|---|---|---|---|---|---|---|---|
| `en_murkshell` | 嘈壳 | basic | 45 | 20 | 3.0 | ×1.8 | 2 |
| `en_driftsinger` | 漂调者 | ranged | 70 | 26 | 3.6 | — | 3 |
| `en_tympanus` | 驼鼓 | heavy | 240 | 90 | 1.8 | ×1.5 | 2 |
| `en_skewer` | 针喉 | ranged | 55 | 22 | 2.4 | ×1.6 | 3 |
| `en_refrein` | 叠唱 | support | 65 | 30 | 2.0 | — | 1 |
| `en_phantome` | 幽灵八 | assassin | 80 | 24 | 4.2 | — | 3 |
| `en_hanged_knight` | 悬钟骑士 | elite | 320 | 80 | 2.6 | ×1.5 | 3 |
| `en_ostlara` | 悬钟骑士·奥斯塔拉 | miniboss | 420 | 120 | 2.4 | ×1.5 | 6 + 钟组 |
| `en_hersil` | 无拍长·恩希尔·万籁 | boss | 620 | 160 | 2.2 | ×1.5 | 8 + 三阶段 |
| `en_myriad` | 万籁 The Myriad | boss | 380 | 140 | 3.2 | ×1.5 | 2 + 听声 hunt |

> 「钟」与「铃」在此图鉴里与主世界的「沉钟」「鸣铃」同源：十种敌影的根音待锣击，大半挂在 ♭ 调上——鼓鼓/悬钟/万籁偏低，嘈壳/针喉偏高。

---

## 1 · 批次（basic）

### 嘈壳 `en_murkshell`（→ `enemy.murkshell`）
- **数值**：HP 45 / POISE 20 / speed 3.0；裂 ×2（`fissureMul=2`），弱点 **×1.8**（全图最高）。
- **AI**：视距 12 / FOV 80° / 听距 15 / 低血 20% 后撤；视野外出 callAlly 广播（14 格，36 tick）。
- **招数**：basicBite（R1, 24f 起手 · cone 60°, dmg 7 + status.fissure 1 层 · parryable）/ Shellburst（R2, 30f, rng 2.2 ring · dmg 10, poise 10 · loudness 4 · parryable）。
- **战术**：先打弱点 2 下即开（×1.8 → 霎那间 POISE 破）；status.fissure 累计两层时它会主动逃逸 → 追杀要快。
- **科考注文**：嘈壳是「停在壳里的钟」的简易版——只是没人烦中原的几十分钟内嗓子就响了。

---

## 2 · 弓手 / 射手（ranged）

### 漂调者 `en_driftsinger`（→ `enemy.driftsinger`）
- **数值**：HP 70 / POISE 26 / speed 3.6；无弱点倍率。
- **AI**：视距 22 / FOV 100° / 视界外 callAlly；retreatHpFrac 0.25。
- **招数**：Claw1/2/3（近战 cone，R1/R1/R2）/ Scream（零伤害 loudness 9 · parryable=false — **扰乱器**）/ **Shrill**（R1, 40f 起手· projectile note speed 13 range 20 · dmg 12 · parryable）· vfx `ring_echo`。
- **战术**：先断沉嚎（Scream）——否则它与队友同声一拍；Shrill 弹道线形，可跳；Parried Shrill 会使它失速并被反打。
- **科考注文**：漂调者的脖子不发声；发声的是它胸腔里那颗早就碎了的小钟，它替你听见你自己——那是你第一个倦意。

### 针喉 `en_skewer`（→ `enemy.skewer`）
- **数值**：HP 55 / POISE 22 / speed 2.4；弱点 **×1.6**。
- **AI**：视距 30 / 听距 20 / kite 18 · chaseBeyond 26；retreatHpFrac 0.3 — **成图最远视距之一**。
- **招数**：Snipe（R1 48f 起手 · projectile shard 18 速· telegraph+vfx ring_echo· 可格挡）/ **Tri-Shot**（R1, 双射 Feint `feint shot:1 punishMs=600`，中段虚星骗招 · vfx spike_chord）/ Stab（R3, cone 110°, 可打断其蓄力）/ Tri-snare（burst at [0,32,42]）。
- **战术**：用段间距拉近（kite 18 是它的灵魂线，近身到 cone 之内=废）；Tri-Shot 的 fx 之前**先闪再 parry**——第三射是真伤，第二射是陷阱。
- **科考注文**：它的嗓门不是它的——拉弦之前它先听见你皮肤被挠的一息，那一息就是命。

---

## 3 · 重装 / elite / support

### 驼鼓 `en_tympanus`（→ `enemy.tympanus`）
- **数值**：HP 240 / POISE 90 / speed 1.8 / DEF 20；弱点 **×1.5**。
- **AI**：视距 18 / 听距 14 / callAlly(16, 48t)；专属机制 `drumSurfaceHits=4` + `drumMuteRadius=6` —— **敲累4下后它会静默，进入一种"不击鼓的沉默"**。
- **招数**：Mallet（R3 · cone 110° radius 3.4 · dmg 34）/ **Stomp**（= 环形。`ratelimit`；dmg 20 · mute 240t status.mute · worldShake:stomp）。
- **战术**：near 2.5 不 retreat→直攻最快（POISE 90 打不碎 4 次）；mute 落地时躲圈还是直打取决于你有没有 `status.mute` 抵抗。
- **科考注文**：驼鼓是最早不会唱歌的钟——它就是认为唱歌是偷懒的，所以它敲。

### 叠唱 `en_refrein`（→ `enemy.refrein`）
- **数值**：HP 65 / POISE 30 / speed 2.0；无弱点倍率；**support aura**：+15% atkSpeed / +10% dmg（范围 12）。
- **AI**：`buffAura band`；castBearSense 沉寂；死亡触发 `offTuneOnDeath` —— 仇恨全部回归默认静 Lv0 + 90 tick stun。
- **招数**：Noise（R1, 36f→移动wave· muteOnHit 120 tick · projectile note · speed 20）。
- **战术**：**先杀**。叠唱活一秒是全队多打一成半血的团队变量；杀掉它即全团坍塌 1 相。
- **科考注文**：叠唱教你唱歌。它不想伤害你，它只想让你忘了什么……所以我们来了。

### 幽灵八 `en_phantome`（→ `enemy.phantome`）
- **数值**：HP 80 / POISE 24 / speed 4.2；无弱点倍率；**beatGhost**：闪避无敌窗口 12 tick / 揭示 60t / fakeBeat 180t loudness 0.6。
- **AI**：FOV 110° / 听距 18；beatGhost 机制=**真假声交替**——它同时钟魔击两窗（真=现，假=180t 后），极易读错。
- **招数**：BackCut（R2 · ±0.5 beat 格内 · cone 100° dmg 22 · status.mute 240t）/ Synco1（R1 环 · 打断）/ Synco2（R2 环 · parryable=false）· samples [1.5,2.5,3.5,4.5] 半拍外。
- **战术**：屏吸 pulseWatch 首屏 = 它进真格一击；最终 boss 必与它结伴出现【幽灵 8+叠叠唱】三件套——**屏吸 phantomHUD→禁 auto 锁**。
- **科考注文**：幽灵八的名字是一串数字，你数不过第九个。

### 悬钟骑士 `en_hanged_knight`（→ `enemy.hangedKnight`）
- **数值**：HP 320 / POISE 80 / speed 2.6 / DEF 24；前方 `armorFront` 60° ×0.6；**selfToll**：每4 bar 自愈 15（"自我灰烬"）；弱点 **×1.5**。
- **AI**：视距 22 / 听距 16 / callAlly 25。
- **招数**：🔔 bellSwing1（R2 · cone 100° → bellSwing2 连段 R3 parryStun 120t）/ Sway（R3 · ring 外 3 · 不可parry）/ **Toll**（4 小节必响一次：`beatLossOnDeath pauseBars=1`；自愈/铃声）/ 战术目标：**break combo on Toll turn**。
- **科考注文**：悬钟骑士的盔甲每一片都是一口小钟——敲起来，听见的不是死亡，是要砸你。

### 悬钟骑士·奥斯塔拉 `en_ostlara`（→ `enemy.ostlara`）· miniboss  ★
- **数值**：HP 420 / POISE 120 / speed 2.4 / DEF 30；弱点 **×1.5**。
- **三阶段**：`bellshell`（shield: shell dh×0.1 immuneToPoise fissure×2 — **前 shell 壳打不进 POISE 像**，换炮/劈shell点）→ `twinfugue`（<60%：`barCast every 2 bars phrase attackId=phrase` · phrase 零伤但打断）→ `greatbell`（<25%：Pendulum + Bellsmash 36dmg+bands(2.5 dmg36/5 dmg20)）。
- **钟组**：三钟 `{270,-40,90}, {330,-40,90}, {300,-40,140}` · `hitRadius 3.6` · `breaksAt 2`（**破2钟 → 壳层 whole-phase 消失**）。
- **战术**：前期 shell → 后期优先找第二钟破shell；pendulum 环内可 parry；greatbell 阶段听节奏（108bpm 3/4），Bellsmash fulex quick 退 shellcast。
- **科考注文**：他被判「你就是你打出来的这一记」——判决书早就写在盔甲上。

### 无拍长·恩希尔·万籁 `en_hersil`（→ `enemy.hersil`）· boss ★★
- **数值**：HP 620 / POISE 160 / speed 2.2 / DEF 40；FOV 360°；弱点 **×1.5**。
- **三阶段**：`registr` → `stealthebeat`（<60%：BPM drift ±10% re-drift 90t · staRegenMul .75 · dodgeJitterTicks 4 · reclaim: neutralTicks 480 → overdrive 2 × hitStop 180）→ `finale`（<25%：×1.25 BPM @120 · startupMul .8 · interruptOnHit）。
- **招数**：Bar Sweep（R3 · cone 90° radius 6）/ Notes3（R1 3联音波 parryable）/ Tutti（R4 · parryStun 180t · mute 2层 360t）/ **No-Beat Lunge**（×3连：无拍位 R2,R2,R3 nonGrid lunge 4.2,4.2,3）/ Voice Chain / Breath（`reclaimWindow` · 8 bars barCast）。
- **掩体**：4个覆盖 Cover（180, 200, 200, 300 系列位置 · radius 3.2 height 7.5）——钟碎即无掩体。
- **战术**：慢速 4/4 92BPM 逼玩家吸拍子；stealthebeat 段 `neutralTicks=480` 后 overdrive——撑过半分钟，bpm 就到 120 并 startup ×0.8。
- **科考注文**："恩希尔"是「无钟主之握」的谐音；"万籁"是万物支撑的沉默本身——他不是钟，他是记得钟的安静。

### 万籁 The Myriad `en_myriad`（→ `enemy.myriad`）· boss ★★★
- **数值**：HP 380 / POISE 140 / speed 3.2 / DEF 30；FOV 0°/视距 0 — **听觉 hunt**。
- **AI**：`huntsSound` attackId=bite minLoudness 0.05 cooldown 150t maxRange 45；`hearsHeartbeat` stillTicks 180 decay 40/s。
- **机制**：**声音即仇恨**。静默 → 它沉睡；发声 loudness ≥0.05 → 它追。deaf_rage phase after sound spine props broken （物体全部打碎 → `props atMost=0 → 它失聪，启用 vibrationRange 10` 半视觉）。
- **招数**：Bite（R3 · nonGrid cone 70 lunge 1 · dmg 36）/ Rend（R2 · ring · dmg 28）。
- **战术**：sound-aware 慢速战斗： weapon-attack volume 必须 < 0.05，或远程引信制造诱骗；**手枪 → 它追声音 → 转身逃 — 但没用，FOV 0 + vibrationRange 10 仅在 phase2**。
- **科考注文**：万籁没有眼睛。它听的是每个人心里那个没响完的地方。

---

## 4 · 对抗速査表

| archetype | 典型 | 首要威胁 | 对策 |
|---|---|---|---|
| basic | 嘈壳 | status.fissure 层积 | 弱点 ×1.8 · 优先打 |
| ranged | 漂调者·针喉 | 远端 POISE 削 | 射程线切断 · parry projectile |
| heavy | 驼鼓 | 220+ dmg 默认（stomp） | 接触 det parry R2 · Mute 躲避 |
| assassin | 幽灵八 | 半拍外 non-grid R2 | synco1 parry → backcut 惩罚窗口 |
| support | 叠唱 | aura +15% speed | 先杀 |
| elite | 悬钟骑士 | armorFront 60°；toll 自愈 | 绕侧 · Toll 响应节奏 |
| miniboss | 奥斯塔拉 | bellshell；phrase interrupt | 打钟组 → 破壳；phase2 听 3/4 108BPM |
| boss | 恩希尔 | stealthebeat drift | 撑 480 neutralTicks · finale parry 3 consecutive |
| boss | 万籁 | huntsSound | 静音走位 + 引信诱骗 |

---

## 5 · 附录 · 名称表（NAME_MAP 对照）

```
enemy.murkshell   : 嘈壳          enemy.refrein    : 叠唱
enemy.driftsinger : 漂调者        enemy.phantome   : 幽灵八
enemy.tympanus    : 驼鼓          enemy.hangedKnight: 悬钟骑士
enemy.skewer      : 针喉          enemy.ostlara    : 悬钟骑士·奥斯塔拉
                                  enemy.hersil      : 无拍长·恩希尔·万籁
                                  enemy.myriad      : 万籁 The Myriad
```

> 本卷内容全部来自 `enemies.json` 与 `CombatManager.NAME_MAP`；没有一段是创作出来的新怪。它只是**把数据按图展开平铺看一眼**——你看得见的，是恐惧被写下来时候的样子。
