# 《止音纪元》玩家指南 / CAESURA Player Guide
See also: [`README.md`](../README.md) · [`README.en.md`](../README.en.md) · [`ENCYCLOPEDIA.md`](./ENCYCLOPEDIA.md) · [`BESTIARY.en.md`](./BESTIARY.en.md) · **Tutor 页面**：`tutorial/index.html`（终端：["/caesura/tutorial/"](https://xiaodernan.github.io/caesura/tutorial/)）
（中英·English below）

> 这是一款动作GLYPH探索游戏的《止音纪元》（Althara / Epic of the Silenced）：玩家的目标是**在世界不再被安静压倒之前，为这把沉重的钟找到它该有的音**。
> 新玩家手册。构筑思路基于源码 src/ 与数据 src/data/json/。所有 `advanceOn`/`displayName`/`id` 引用都来自可验证的真值。

---

## 中文手册

### 1 · 启动 & 新玩家
```bash
npm install
npm run dev        # 浏览器 → http://localhost:5173/?fresh=1
```
`?fresh=1` 在启动时清掉存档目录 —— 给每一个新来的玩家一个真正诚实的「一次只一线」。

### 2 · 键位一览（默认）
| 键 | 动作 | 中文名 |
|---|---|---|
| `W` `A` `S` `D` | 四方移动 | 四方 |
| `Space` | 跳 | 跃 |
| `Left Shift` | 冲刺 | 裂 |
| `Left Ctrl` | 闪躲 | 偏 |
| 鼠标左键 | 轻击（parryable） | 鸣 |
| 鼠标右键 | 重击（重） | 坠 |
| `F` | 格挡 | 守 |
| `G` | 弹反 | 返 |
| `Q` | 锁定 / 轮锁 | 锁 |
| `E` | 交互 | 手 |
| `R` / `C` | 战技一 / 战技二 | 鸣一 / 鸣二 |
| `V` | 声纹观察（执性、观察两镜） | 拾音 |
| `T` | 投掷音子 | 掷晶 |
| `1` `2` `3` | 武器槽一 / 二 / 三 | 舟一 / 舟二 / 舟三 |
| `Tab` | 地图 | 图 |
| `Esc` | 暂停 | 暂 |

改键：`src/settings/Bindings.ts` ，`ClampBindings()` 做合法性过滤。手柄默认 Xbox 布局：十字键 12–15 / A=0 / B=1 / LT=6 / RT=7。

### 2.1 · 镜头与「鼠标 Y 轴反转」

- 默认（FPS 标准）：**鼠标上滑 = 抬眼向上看**，**鼠标下滑 = 俯视**。
- 想要 Unity 口径（上滑 = 俯视）？游戏内按 `Esc` →「操作」页 → **「鼠标 Y 轴反转」**行切换。
- 这一格是**会话级**偏好：不入存档、不入自动存档——每次启动都回落到 FPS 标准，可再随时翻回。
- 跟档走的八格：缓冲 / 抖动 / 两把振动 / 受击倍率 / 帧辅助 / 长按时长 / 连打涨价（在「操作」页同一节，跟着存档走、不跟着「配置盒」走）。

### 3 · 核心机制：声 / silence
- **你是声源**。每一步、每一击、每一次停蹄都会被敌人听见。
- **屏气**不是给玩家的天赋技，是给每件武器的「自身噪音乘数 noiseMul」——武器越响越容易远远地被盯上。`weapons.json` 把乘数固化在数据里。「沉默武器」在长深渊区才是正解。
- **敌人依赖视觉与听觉**：万籁（`enemy.myriad`，名见 `src/combat/CombatManager.ts` 的 `NAME_MAP`）的视距 0，全图靠声音找人；硬喊 / 挥剑 / 受击都会暴露你。**不响 ≠ 平安，但在万籁的图前，安静是唯一活路**。
- **音色晶**（`weapon.tuningSword` 一类——`weapons.json`里的Id）有 DDS / 终结 / 呼应收声，每件的 Weapon Buffet 都在游戏内永久记忆。不追求极限百分比；按你打得准的节奏来。

### 4 · 推进主线的正确姿势
线索：主线做 `quests.json` 的七个任务：

1. **停息之钟**（`quest.bells`）—— 找钟。敲几次之后它就会自己停。
2. **铃语学录**（`quest.corvin`）—— 档案官；钟声与档案之间。
3. **蚀余止色录**（`quest.meg`）—— 去未完之殿
4. **塔中人已死**（`quest.haltrune`）—— 断栏营
5. **无可名之器**（`quest.faceless`）
6. **三句话**（`quest.threewords`）—— 横向 pilgrimage
7. **余响归位**（`quest.afterglow`）—— 把收尾的四笔账依次交清：档案里的火 / 营地的答复 / 音栓钥匙 / 灰里的归属

### 4.5 · 三场 Boss 提要：步步为营，不贪刀

- **奥斯塔拉**（钟坠院 · 序幕 Boss）三阶段。**P1** 钟壳：只受 10% 伤害。**不磨**：把姿势留给破壳窗；**P2**「金铃」群体加速期：铃鸣到谁，谁就得退；**P3** 钟心裸露 4 秒：她只剩一半肉身，倾泻所有精力——能弹能磨的手段全砸进去，把她打到见红。
- **万籁**（无耳深窖 · 隐藏 Boss）：你看见她，就已经输了一半。她把你写在她自己手里。绕路：V（屏气/观察）把噪音压到最低；贴她边缘蹭，她被击中后几秒内是聋的——重手。
- **恩希尔**（未竟厅 · 终章 Boss）：**第三阶段是全场全响**。先敲坏「指挥棒」（scope+看盘面），再用三拍周期配她——她的拍是 3/4；每个 cycle 的边缘她全亮着眼睛→全身躲闪。打到见红，把夜交给那片余响。

什么都不会在没把的时候被推到你脸上——按你节奏点字起、找档、遇敌、回城；三件套（轻/重/石子）的搭配比一把顶级武器更重要。

### 5 · 副任务 / 探索心得
- **去深渊边缘**：无耳深窖（总名 `rg_earless_deeps`，data 真源），那是万籁的猎场——地面有游玩空间与多件套装备
- **不要播种**：程序性的「房间制」不要手贱乱敲
- **Beat bar**：每拍都不占住 — 每一击都是判定窗口；贪一拳常常砸掉你自己的舞台
- **Pause 键**：存档在任一调音桩前都能下存；esc Pause = 世界暂停；proj 不推进即可

### 6 · 控制台（开发人员）
<https://xiaodernan.github.io/caesura/> —— 止音纪元 mesh console（开发仪表）：51 维度 / 104 面板 / 4 主题 / 沉浸模式（F11）。每件教学件自带：双路自证 + 三路篡改 + 因果锁 + 十一真件 21 键证据。

### 7 · 调试快捷入口
```bash
npm run console:data    # 重建快照（虚拟真源）
npm run dev             # 开发
npm run build           # 校验并打包 dist/（0 findings）
npm run llm:warmup      # 真机缓存复位（需 wkapi.pro/v1 的 gpt-6-sol key）
npm run gate:smoke      # 云侧路由烟测（需 spring-cloud 本地容器）
```

---

## English companion

### 1 · Getting started
```
npm install
npm run dev        # browser → http://localhost:5173/?fresh=1
```
`?fresh=1` wipes any save state before you boot — a fair deal for every player
who opts into the still-unwritten ending.

### 2 · Default controls
| Key | Action |
|---|---|
| `W` `A` `S` `D` | Move |
| `Space` | Jump |
| `Left Shift` | Dash |
| `Left Ctrl` | Dodge |
| Mouse L | Light attack (parryable) |
| Mouse R | Heavy attack |
| `F` | Guard |
| `G` | Parry |
| `Q` | Lock / cycle-lock |
| `E` | Interact |
| `R` / `C` | Weapon skill I / II |
| `V` | Listen (hold breath; observes weapon buffer) |
| `T` | Throw crystal |
| `1` `2` `3` | Weapon Ark I / II / III |
| `Tab` | Map |
| `Esc` | Pause |

Rebind: `src/settings/Bindings.ts`; `ClampBindings()` filters illegal keys. Default controller: Xbox layout, d-pad 12–15, A/B = 0/1, LT/RT = 6/7.

### 2.1 · Camera & mouse Y-invert

- Default (FPS norm): **mouse up = look up**, **mouse down = look down**.
- Prefer the Unity convention (mouse up = look down)? In-game: `Esc` → Operations page → **"Mouse Y-axis invert"** row.
- This slot is a **session-scoped** preference: it is NOT persisted and never auto-saves — every launch falls back to the FPS norm; flip it again any time.
- The eight persisted cells (buffer / shake / both rumbles / damage / frame assist / hold ms / mash inflation) live in the same section of the Operations page and follow the save — not the profile box.

### 3 · The core mechanic: sound & silence
- **You are the source of sound.** Every step, strike, and flinch is hearable.
- **Quiet is the skill ceiling.** Weapons carry a `noiseMul` field in `weapons.json`; louder weapons draw aggro. The silent ones exist for a reason.
- **The Myriad (`enemy.myriad`)** is intentionally unbeatable by force; she is audio-driven (vision=0). The still chord must be held, not bludgeoned.
- **Resonance stones (`weapon.tuningSword` et al. from weapons.json)** record how you swing, not just how hard. The game tracks your *habit* and grades the resonance you carry — not your DPS total.

### 4 · Quests (from quests.json)
1. **Stopping of the Bell** (`quest.bells`) — where it stops, eventually
2. **Study of Bell Chants** (`quest.corvin`) — the archivist
3. **The Silenced Palette** (`quest.meg`) — the unfinished hall redeem them
4. **The Man in-turn** (`quest.haltrune`) — Brokenbar
5. **The Vessel** (`quest.faceless`) — the unnamed vessel
6. **The Three Words** (`quest.threewords`) — the pilgrimage backbone
7. **The Settling of Echoes** (`quest.afterglow`) — the closing tour: the archive fire, the camp's answer, the stop-key, the belonging written in ash

### 4.5 · Boss field notes: step by step, never greedy

- **Ostlara** (Fellcarillon · opener). Three phases. **P1** Shell takes 10% damage — don't grind her, save heavy/specials for the shell-break; **P2** Golden Bell aura — when it sounds, step out; **P3** Core is bare for 4 seconds — commit everything, raw and finishing, until she falls.
- **The Myriad** (Earless Deeps · hidden). If you see her, you've already lost half. She's got you in her hand. Routing past: hold **V** (Tune) to crush your noise down, graze the edge, unload everything in the window while she's deaf after first hit.
- **Hersil** (Unfinished Hall · finale). **Phase 3 is the whole hall singing.** Take out the baton first (watch the desk), then match her 3/4 rhythm — every cycle she wakes for you. Flash-step always in the barlines.

Nothing is pushed; each step is granted on screen after the relevant dialogue beat. Three weapons and two tanky-arc hits are a better first build than a max-tier polearm.

### 5 · Area & cheese notes
- Deep Earless Pit (`rg_earless_deeps`) is where The Myriad waits — bring earplugs and the weapon that
  refuses to sing.
- Beat bar: every attack is a windowed cadence — overreach once and the bell is quieter forever.
- Pause freezes the swing you were executing — no "replay".

### 6 · The console (developers)
<https://xiaodernan.github.io/caesura/> — 51 dimensions / 104 panels / 4 skins / immersive mode (F11). Every teaching kit ships with its own dual-proof + three-way tamper + causal locks + eleven real-evidence 21-key bundles.

### 7 · Quick commands
```bash
npm run console:data    # regenerate the live probe snapshot
npm run dev             # hot reload
npm run build           # tsc + vite build + dist scan (0 findings)
npm run llm:warmup      # prompt-cache warmup with real API
npm run gate:smoke      # spring-cloud route smoke
```

---

### Invariants (both languages)
- **Zero LLM at runtime.** All story content is baked; the LLM plays only in dev tooling (`scripts/llm-*`, `npm run llm:*`).
- `dialogue.json` is authoritative; no tool rewrites it.
- `npm run check` = `tsc --noEmit` + `validate:data` + `vitest run` — always green.
- UI and docs in Chinese mode are Chinese-clean; in English mode, English-clean. No mixed-language fallbacks.

> 序 · 序 · 序言 | EN: Prologue.
