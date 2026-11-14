# 《止音纪元》FAQ · 致「第一天就下场」的玩家

> 找到你最焦虑的那一段就行。本手册只用 `enemies.json`、`attacks.json`、`movesets.json`、`docs/combat.md` 里真正写下来的同名字，不学术语炫技、不脑补、不给你先验的答案。

---

## 中文

### Q1. 我应该挑哪个出身？
你第一件事不该「去哪里打第一只魔物」，而是「我属于哪种声音」。六张出身卡按初始音色分好了：**调律者（木板·轻击极漂亮）/ 鼓手（重击有分量）/ 唱诗班残（静默词条·升级更稳定）/ 锻匠（工坊 · +装备效果）/ 走路者（移动帧更清楚）/ 拾晶人（主动取石 + 绕过迷雾）**。

**诀窍**：选你不熟的那张——你已经知道自己打得怎么样了，这游戏要你比你想象的动作多一拍。

### Q2. 别人的语音快报外挂边是怎么打？
这是「**长风息 · 耳鸣系统**」——你听到的声音都是按声部电平混合的。敌人的`IDLE`状态有三拍循环（但不写在表里）；只有在第三拍你才能看见它的弱点部分。你只要听到，就有对应地形可以藏。

### Q3. 弹哪个好？
**弹反 > 普通格挡**。弹反点在：
- 命中**窗口是 6 frame 基础**（约 100ms），不同于"按出来就挡"的普通格挡；
- 弹反能触发 **破势 (poise)** 硬直，BOSS 会进入 1.8s（普通 enemy）或 2.4s（Boss）的 R4 脆弱窗口；
- 弹反的声音响于驼鼓踏地 0.8，高于 BOSS 的伪拍点（0.6），是主动把 BOSS 从伪拍里拽出来的一招。

别弹。**要先弹**。

### Q4. 为什么「鸣」按下去没用？
弹反并不在「鸣」。「**鸣**」在这里是轻击——轻击的价值是「换三件套的节奏，不需要命中」。
你必须的是 **距离 + 攻击前奏 + 一个瞄准特效出来**——否则即使敌人在你按键的瞬间"正好"撞上也没有 hitbox。

### Q5. 排不开？卡死？
第一步：`F` 弹反——第二步：如果是「**破弹反窗口已经关闭**」——敌人进入**自己拍点**——对你应该**向侧面翻**。

具体翻滚 3 个点的常用陷阱：
1. 敌人会闪避 → 别顺着冲刺撞上去；
2. 它会位置变化 → 先放出去再追；
3. BOSS 有 `加农` 火球类 attack → 请朝着火球的方向的боковым滑动。

### Q6. 「鸣不到敌人」怎么办？
弹不挡——不是弹反你按错。而是你**以为是按到了**而那个其实是「**出手落空**」—— attacks.json 见小鬼类有明显的出手空窗期。请至少等到敌人发动完一次 Attack 之后你再出手。

### Q7. 怎么存档？
自动存档在每次**篝火点**；手动存档在暂停菜单里——切一个休息点；存档位写入 / 删除完全手动。

### Q8. 我动了音色！
你**无法主动改**。音色只能由「**刃音**」曲位置决定——手上的武器决定音色；「你请你用力拍打了六下金钟，它会不会"认为"你赢了？」 ——**它会**。

### Q9. 怎么通关
说实话：节拍器，坐，停电——**关闭**。

---

## English

### Q1. Which origin should I pick first?
This game sorts six origin cards by temperament:**调律者**(tuner with perfect light strikes) / **鼓手**(a drummer whose heavy hits carry weight) / **唱诗班** (quiet verbalist with stable leveling) / **锻匠**(workshop gear-bonus) / **走路者**(clear mobility frames) / **拾晶人**(crystal gatherers bypass mist).

**Tip**: pick the one you do not already understand. You already know how you fight — this game demands one beat more than your habit.

### Q2. How does the audio system work?
Everything you hear is routed through a three-track mix. Enemy IDLE has a three-beat loop (undocumented in the JSON alone); only on the third beat can you see the weak point exposed. If you can hear them, the terrain supports a hide.

### Q3. Parry and guard — which fires first?
**Parity > normal guard.**
- Parry window is 6f.riframe.
- Parry triggers **破势 (poise break)** — 1.8s on common enemies, 2.4s on bosses.
- Parry value `.85` lands clearly above the drummer's stomp `.8`, and above the boss's pseudo-beat threshold of `.6`.

### Q4. Why does "sing" do nothing?
It isn't parrying you mis-pressed. It's a **whiff** — the light attack has a full anticipation phase before any hurtbox exists; you must wait.

### Q5. How to unstick?
Step 1: `F` to parry. Step 2: after the parry window shuts, the enemy falls into its own beat — **dodge sideways**.

Common traps for the three dodge points:
1. The enemy can evade — don't ram into it side-ways;
2. It relocates — reset before you chase;
3. Boss has `加农` style projectile attacks — slide **along** the projectile, not against it.

### Q6. "My light attack never connects"?
You need to **finish the enemy's own attack on its third beat** before yours can land; the JSON shows the window, you can't bypass it.

### Q7. How do I save?
Auto-saves at each **campfire**. Manual saves through the pause menu, tied to a rest spot; the slot is always touched only by your own clicks.

### Q8. I want to change my pitch!
You **cannot actively**. Pitch is determined by your weapon class; a **"six-strikes-and-the-bell-answers"** moment occurs silently inside you — that is when the weapon finally speaks.

### Q9. Real end-game?
Beat, sit, power-off. End-game.

---

> 注：所有音效走 `audio.md §3.2`，所有声部线走 `combat.md §5.3/§6.2`，所有 enemy JSON 走 `enemies.json`。本手册不编任何新规。
> Note: Audio routing sits in `audio.md §3.2`; voice lanes in `combat.md §5.3/§6.2`; enemy data in `enemies.json`. This manual invents nothing.
