/**
 * 游记 · 六十二篇全文（2026-11-16 落 · KI-618 · 2026-11-17 KI-621/KI-623/KI-634/KI-639/KI-641/KI-643/KI-648/KI-649/KI-650/KI-651/KI-652/KI-657/KI-658/KI-659/KI-661/KI-662/KI-664/KI-665/KI-666/KI-667/KI-668/KI-669/KI-670/KI-671/KI-672/KI-673/KI-674/KI-675/KI-676/KI-677/KI-678/KI-679/KI-680/KI-681/KI-682/KI-683/KI-684/KI-685/KI-686/KI-687/KI-688/KI-689/KI-690/KI-691/KI-692/KI-693 扩）。
 * 这六十二篇都是《止音纪元》世界谱同源的 original short fiction，
 * 中文/英文两份整篇内嵌——因为没有人会单独打开宣传册，
 * 所有内容必须直接放进游戏里。
 * 静态字符串 · 不经 Lang 字典 · 与 PLAYER_ATLAS 同技 · 零 LLM · 零网络。
 */

export interface StoryChapter {
  no: number
  zhTitle: string
  enTitle: string
  zh: string
  en: string
}

export const STORY_CHAPTERS: StoryChapter[] = [
  {
    no: 1,
    zhTitle: "盐",
    enTitle: "Salt",
    zh: `<p>阿衡第一次上岗的那个晚上，父亲把她推到石盘边，让她自己听。</p>
      <p class=\"no-indent\">\"你不用记。\"他说，\"你只要数。\"</p>
      <p>数什么？她问。父亲说：<em>数节拍</em>。</p>
      <p class=\"no-indent\">那一夜她数了四个。年复一年，她数过很多个<strong>四</strong>。</p>

      <div class=\"beat\">· · ·</div>

      <p>父亲的手在四十一年的岗楼上磨出了一层盐霜。每天更换的药膏和布，复读的记录手册，字句始终如一——<em>\"今夜如故\"</em>。</p>
      <p>直到最后那一页。那是她父亲第四千次落笔之后，唯一一次改了字句。<em>\"今夜不同。\"</em>写完这一句，他再也没有下一句。</p>

      <div class=\"beat\">· · ·</div>

      <p>冬末的一个夜里，风停了。</p>
      <p>这是她守站以来第一次听不见任何声音，连海浪也屏住了。共鸣腔里传来一种低得她不敢相信自己的声音，像一个巨人停止了磨盘，转而专注地屏住呼吸。</p>
      <p>她站起来，又蹲下。</p>
      <p><strong>她听见了。</strong></p>

      <div class=\"beat\">· · ·</div>

      <p>不是钟声。是钟声的残页。</p>
      <p>一种她从未在任何钟里听过的音高——低到先于她的耳朵到达她的骨头。每三拍之后，又缺了一拍，像一句不肯说完的话，被她父亲、她奶奶、奶奶的奶奶一代代地数过、听过、擦干过，年复一年藏在这座岬角的石缝里。</p>
      <p>她忽然明白了：<strong>这不是一座灯塔。从来不是。</strong>这不是为了给船看清前路建的钟。这是<em>世界的屏息之所</em>。</p>

      <div class=\"beat\">· · ·</div>

      <p>她没有照前辈那样去数。她把自己的手掌放上那块石盘，按了一个她从没做过、却从身体内部长出来的拍子——<em>三拍一停</em>，和那段声音严丝合缝地合上了。</p>
      <p>风来了。没有钟响，却没有任何一段沉默比这一刻更完整。雾像从天上垂下来的布，把海面一寸寸盖住。每一块盐石都像刚从火里出来，带着一点热，一点光。</p>

      <div class=\"beat\">· · ·</div>

      <p class=\"coda\">天快亮的时候，父亲的记录手册里多了一行新字。不是她写的，也不是她父亲的字迹——那一行写得又老又新：</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.1rem; letter-spacing:.05em;\">\"原来还有人认识这个字。\"</p>
      <p class=\"coda\">她收起父亲的手册。她没有告诉任何人。她拿起那块擦镜的布，开始擦那只石盅——因为钟没响的日子，守夜人不下班；钟响的日子，守夜人也不下班，只是记录方式变了。</p>
      <p class=\"coda\">风钟海岸没有结束。它只是从这一夜起，有了<strong>第一个能听懂那第四个拍子的人</strong>。</p>`,
    en: `<p>The night A Hén first went on watch, her father put her at the stone pan and told her to listen.</p>
      <p class=\"no-indent\">“You don’t need to remember,” he said. “You only need to count.”</p>
      <p>Count what? she asked. He said: <em>count the beats</em>.</p>
      <p class=\"no-indent\">That night she counted <strong>four</strong>. Year after year, she has counted many <strong>fours</strong>.</p>

      <div class=\"beat\">· · ·</div>

      <p>Her father’s hands wore forty-one winters of salt into that tower. The liniment and the cloth he changed daily; the ledger in his hand never varied — <em>“Tonight, as always.”</em></p>
      <p>Until the last page. That was the fourth thousand such entry he ever wrote, and the only one he ever changed: <em>“Tonight is different.”</em> After those words, there were no more words.</p>

      <div class=\"beat\">· · ·</div>

      <p>Late in winter, on a night with no moon, the wind stopped.</p>
      <p>For the first time since she had taken the watch, she heard nothing — not even the surf breathing. From the resonance chamber came something too low for her to believe: as if some giant had stopped the mill-wheel and turned, instead, to hold its breath.</p>
      <p>She stood up, and she knelt down.</p>
      <p><strong>She heard it.</strong></p>

      <div class=\"beat\">· · ·</div>

      <p>Not a bell. The bell’s torn page.</p>
      <p>A pitch she had never found in any bell — pitched so low it reached her bones before her ears. Three beats, and then one missing. A sentence that refused to finish, counted and heard and wiped dry by her father and his father and his mother before him, season upon season, hidden like that in the cracks of this headland.</p>
      <p>She understood at last: <strong>this was never a lighthouse. It was never built to guide ships.</strong> This is where the world <em>holds its breath</em>.</p>

      <div class=\"beat\">· · ·</div>

      <p>She did not count as the others had counted. She laid her palm on the stone pan and pressed out a beat she had never been taught, one grown from inside her — <em>three, pause</em> — and it matched the voice exactly.</p>
      <p>The wind came. No bell tolled, and no silence in her life had ever been this complete. The fog descended like a cloth lowered from heaven, covering the sea one palm at a time. Every salt-stained stone was warm, as if it had just come out of the fire, carrying a little light.</p>

      <div class=\"beat\">· · ·</div>

      <p class=\"coda\">Near dawn, in her father’s ledger, a new line appeared. Not in her hand, and not in her father’s — old and new at once:</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.1rem; letter-spacing:.05em;\">“So there is still someone who knows this script.”</p>
      <p class=\"coda\">She closed her father’s ledger. She did not tell anyone. She took up the polishing cloth and began to wipe the stone bowl clean — because on the nights when the bell is silent, the keeper does not leave her post; and on the nights when the bell tolls, the keeper does not leave her post either. Only the form of the record changes.</p>
      <p class=\"coda\">Windbell Coast does not end. From that night, it has <strong>someone who can hear the fourth beat</strong>.</p>`,
  },
  {
    no: 2,
    zhTitle: "山下无名碑",
    enTitle: "The Nameless Stone",
    zh: `<p>休垒山下的那块石碑，没有名字。</p>
      <p>每天傍晚，石匠的女儿阿汀要沿山脚小路走一趟——拂一遍灰、添一勺水，再说一句无关紧要的话。这是她父亲临终前交给她的<em>唯一一项活计</em>。</p>

      <div class=\"beat\">· · ·</div>

      <p>第一年，她问父亲：这是给谁的？</p>
      <p class=\"no-indent\">父亲说：<em>给被遗忘的人</em>。</p>
      <p>第二年，她问：你叫得出那个人的名字吗？</p>
      <p class=\"no-indent\">父亲说：<em>他没有名字</em>。</p>
      <p>第三年，她开始自己回答：这是给第一口钟的——钟响了又停了，<em>没有人替它收尾</em>。</p>

      <div class=\"beat\">· · ·</div>

      <p>休垒人不信这个。他们说这碑是给那些哑了的人——哑了的人死透了，却不知道自己正在被记得。休垒人管这叫<em>「最后的照面」</em>。</p>
      <p>阿汀没有反驳。她只是每次拂碑时，悄悄选一个位置，用指节轻轻磕三下——像父亲敲过的那种「<strong>锁紧</strong>」。</p>

      <div class=\"beat\">· · ·</div>

      <p>后来，休垒的钟终于响了。</p>
      <p>没有人看得见是谁敲的——人人都在自己的屋里，听那一记。阿汀走到山下，把手掌<strong>平贴在石碑上</strong>，等。</p>
      <p>等到了。</p>

      <div class=\"beat\">· · ·</div>

      <p>碑里传来一声极低极长的共振——不是钟声，而是<em>钟声的注脚</em>，像什么东西替无名的石碑签了一个名。</p>
      <p>石碑没有碎，也没有亮。它只是不再是一块无名的石头了。</p>
      <p><strong>它变成了休垒唯一一块知道自己被记得的石头。</strong></p>

      <div class=\"beat\">· · ·</div>

      <p class=\"coda\">她收回手，对着碑说了一句从没说过的话：</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.12rem; letter-spacing:.05em;\">“这算两个人了。你，和替你响的那一记。”</p>
      <p class=\"coda\">年复一年，休垒人问阿汀那碑是给谁的，她都答不上来。直到有一年，她给了一个答案：</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.05rem;\">“给不知道自己还能被记得的人。”</p>
      <p class=\"coda\">说完这句，她照例朝石碑轻轻地点了一下头——就像父亲敲过一千次的「锁紧」。</p>`,
    en: `<p>The stone under the hill has no name.</p>
      <p>Every evening, A Ting, the stonecutter’s daughter, walks the path beneath the hill — a pass with a cloth, a bowl of water, a sentence of no consequence. It is the <em>only work her father left her</em> before he died.</p>

      <div class=\"beat\">· · ·</div>

      <p>The first year, she asked him: whose is it for?</p>
      <p class=\"no-indent\">He said: <em>for the forgotten</em>.</p>
      <p>The second year, she asked: can you say the person’s name?</p>
      <p class=\"no-indent\">He said: <em>there is no name</em>.</p>
      <p>The third year, she began to answer herself: <em>it is for the First Bell — it rang and then it stopped, and no one closed it out.</em></p>

      <div class=\"beat\">· · ·</div>

      <p>The people of Resthold did not believe her. They said the stone was for those who went mute — for those who died mute, unaware that they were being remembered even as they were being forgotten. They called it <em>“the last crossing.”</em></p>
      <p>A Ting did not argue. She only, each time, found a spot on the stone and knocked it three times with her knuckles — a <strong>“lock-tight”</strong> her father had knocked a thousand times.</p>

      <div class=\"beat\">· · ·</div>

      <p>Then, one winter, the bell of Resthold rang.</p>
      <p>No one saw who rang it — everyone was indoors, listening. A Ting walked down the hill, laid her <strong>flat palm against the stone</strong>, and waited.</p>
      <p>It came.</p>

      <div class=\"beat\">· · ·</div>

      <p>From inside the stone came a very low, very long resonance — not the bell itself, but <em>the bell’s footnote</em>, as if something were signing for the stone at last.</p>
      <p>The stone did not crack, and it did not shine. It simply was no longer nameless.</p>
      <p><strong>It had become the only stone in Resthold that knew it was remembered.</strong></p>

      <div class=\"beat\">· · ·</div>

      <p class=\"coda\">She drew her hand back and said to the stone a sentence she had never said:</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.12rem; letter-spacing:.05em;\">“That makes two of us. You, and the one who rang on your behalf.”</p>
      <p class=\"coda\">Year after year, when people asked A Ting whose stone it was, she could not answer — until one year she finally gave one:</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.05rem;\">“For those who don’t know they can be remembered.”</p>
      <p class=\"coda\">Then, as ever, she gave the stone one small nod — the same small nod she had seen her father give a thousand times, the one he called his <em>lock-tight</em>.</p>`,
  },
  {
    no: 3,
    zhTitle: "空拍子",
    enTitle: "The Empty Bar",
    zh: `<p>未竟厅的轮值是七十三年前开始的。</p>
      <p>没有人记得第一年是谁敲了第一个音——只记得那一年谁被分到指挥席。轮到恩希尔那一夜，三百个喉咙已经哑了，但他照常站上了台。</p>

      <div class=\"beat\">· · ·</div>

      <p>他的谱台是空的。谱架上没有谱，只有一根指挥棒，和一把旧椅子——不属于它的木纹，不属于他的指节。</p>
      <p>一个没有名字的年轻人坐在前排，他只负责两件事：记节拍，沉默。</p>

      <div class=\"beat\">· · ·</div>

      <p>每一遍轮值，恩希尔会做同一件事——举起指挥棒，停两拍，放下。再举，再停，再放。</p>
      <p>年轻人数过很多次。举棒到放下，大约是三拍。有一次，他忍不住问：</p>

      <div class=\"beat\">· · ·</div>

      <p class=\"no-indent\">“你在等谁？”</p>
      <p>恩希尔没有放下谱台上的指挥棒。</p>
      <p class=\"no-indent\">“我在为空拍留一格位置。”</p>
      <p>年轻人不懂：</p>
      <p class=\"no-indent\">“一格位置？”</p>

      <div class=\"beat\">· · ·</div>

      <p>恩希尔说：<em>“完整的沉默也是一种节拍。要把它写进去，光有音不够。”</em></p>
      <p>年轻人又问：<em>“那为什么一直要这样？”</em></p>
      <p>恩希尔说：<em>“因为总会有一点。总会有人按那个拍落在里面。”</em></p>

      <div class=\"beat\">· · ·</div>

      <p>那一夜，没有钟响。</p>
      <p>但厅里出现了一扇从没开过的门。门的那一边传来一个很轻的脚步声——不像人，也不像风，更像一段迟了七十三年、终于落下来的音符。</p>
      <p>恩希尔没有转头。</p>
      <p>他把指挥棒轻轻立回谱台上，对着台面按下了第一拍——一个没有声音的节拍。</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.2rem; letter-spacing:.08em;\">空拍子。</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:.95rem; letter-spacing:.12em;\">（到你了。）</p>`,
    en: `<p>The rotation of the Unfinished Hall began seventy-three years ago.</p>
      <p>No one remembers who struck the first note that year; only who was seated at the podium. When it came to Hersil’s turn, the three hundred throats were already mute, and still he took his place.</p>

      <div class=\"beat\">· · ·</div>

      <p>His stand was empty. No score on the lectern — only a baton, and a chair that belonged to him neither by grain nor by knuckle.</p>
      <p>A nameless young man sat in the front row. His job was two things and two only: count the beats, and be silent.</p>

      <div class=\"beat\">· · ·</div>

      <p>Every rotation, Hersil did the same thing: raised the baton, held two beats, lowered. Raise. Hold. Lower.</p>
      <p>The young man counted many times. Raise to lower — about three beats. Once, he could not help but ask:</p>

      <div class=\"beat\">· · ·</div>

      <p class=\"no-indent\">“Who are you waiting for?”</p>
      <p>Hersil did not lower the baton on the stand.</p>
      <p class=\"no-indent\">“I’m reserving a bar for the silence.”</p>
      <p>The young man did not understand:</p>
      <p class=\"no-indent\">“A bar?”</p>

      <div class=\"beat\">· · ·</div>

      <p>Hersil said: <em>“A full silence is a beat too. To write it in, you need more than a note.”</em></p>
      <p>The young man asked again: <em>“Then why must you?”</em></p>
      <p>Hersil said: <em>“Because there is always a moment. Someone will fall into that beat.”</em></p>

      <div class=\"beat\">· · ·</div>

      <p>That night, no bell tolled.</p>
      <p>But a door that had never opened appeared in the hall. From the other side came a very light step — not like a person, not like wind; it sounded like a note that had been seventy-three years late, finally arriving.</p>
      <p>Hersil did not turn around.</p>
      <p>He laid the baton gently back on the lectern, and pressed the first beat against the surface of the stand — a beat with no sound at all.</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.2rem; letter-spacing:.08em;\">The empty bar.</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:.95rem; letter-spacing:.12em;\">(It is your turn.)</p>`,
  },
  {
    no: 4,
    zhTitle: "账本",
    enTitle: "The Ledger",
    zh: `<p>麦格的主账房在休垒的旧街区末尾，靠近水缸，靠近大家避讳的那口钟。</p>

      <div class=\"beat\">· · ·</div>

      <p>账上的字，她记得最清楚的一笔是四十七天前——一个面色异常、但腰上的金很旧的人，买了一张新弦、一块音色石，用现银付了，但在\"余额\"一栏里她没写数字。</p>
      <p class=\"no-indent\">她只写了一个字：<em>未。</em></p>

      <div class=\"beat\">· · ·</div>

      <p>她从小就学会一件事：有些事如果急着结清，就会永远消失。所以账房里她养了三本账——官账、街账，和一本她自己的，谁都没看过。</p>
      <p>第三本账的最后一页，只有一行是空的。</p>

      <div class=\"beat\">· · ·</div>

      <p>她翻了很多年，终于看懂那一行写的是什么：<em>『这笔账不能算。对方不是登记的人。』</em></p>
      <p>她记不清那是哪一年、哪一个人。但她记得那个人来的时候，手里捏着一块还没被敲过的钟铜——她收了那块铜，却从来没记过这笔账，仿佛他从来不曾走进过这个门。</p>

      <div class=\"beat\">· · ·</div>

      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.1rem; letter-spacing:.05em;\">“原来不是他没付。是他不允许我收。”</p>
      <p>他不是来买东西的。他是来把那块钟铜还回去的——还给世界里一个已经不认识它的人。</p>

      <div class=\"beat\">· · ·</div>

      <p class=\"coda\">她最后一次翻那本账的时候，在缺了一行的地方补上了一笔她从不敢写的账：</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.1rem; letter-spacing:.05em;\">“已收。”</p>
      <p class=\"coda\">“那个不可以收的人，终于把不可以收的东西，收回去了。”</p>
      <p class=\"coda\">她把第三本账放回架子最高处。那天以后，她再没数过任何一页。</p>`,
    en: `<p>Meg’s counting house sits at the back of Resthold’s old market, near the water jars, near the bell everyone avoids.</p>

      <div class=\"beat\">· · ·</div>

      <p>Among all the entries, the one she remembered best was forty-seven days ago: a man with an unusually fair face but very old gold at his belt, who bought a new cord and a resonance stone, paid in coin — and in the “balance” column she wrote no number.</p>
      <p class=\"no-indent\">She only wrote one word: <em>outstanding.</em></p>

      <div class=\"beat\">· · ·</div>

      <p>Since childhood she had been taught one rule: some things, if you rush to settle them, vanish forever. So in her counting house she kept three ledgers — an official ledger, a street ledger, and one of her own that no one else ever saw.</p>
      <p>The third ledger, on its last page, had only one line that was empty.</p>

      <div class=\"beat\">· · ·</div>

      <p>She spent years turning its pages before she could finally read the line: <em>“This entry cannot stand. The other party is not who I think.”</em></p>
      <p>She no longer remembered what year, or which person. But she remembered him coming in, carrying a piece of bell metal that had never been struck — she accepted it, and she never entered this transaction in any book. As if he had never passed through the door.</p>

      <div class=\"beat\">· · ·</div>

      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.1rem; letter-spacing:.05em;\">“He never owed me. He never meant for me to take it.”</p>
      <p>He was not buying anything. He was returning the bell metal — to a world that no longer knew how to hold it.</p>

      <div class=\"beat\">· · ·</div>

      <p class=\"coda\">The last time she opened that ledger, she filled the missing line with an entry she had never once allowed herself to write:</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.1rem; letter-spacing:.05em;\">“Received.”</p>
      <p class=\"coda\">“The one person who could never receive anything, finally received what he had come to return.”</p>
      <p class=\"coda\">She put the third ledger back on the top shelf. From that day on, she never counted another page.</p>`,
  },
  {
    no: 5,
    zhTitle: "回声庭园",
    enTitle: "The Garden of Return",
    zh: `<p>雾海尽头开着一座花园。没有路伸向它，只有很久很久以前掉进岩洞里的水——<em>每一滴，都替别人落着</em>。</p>

      <div class=\"beat\">· · ·</div>

      <p>走进去的人什么声响也听不见：不听见风，不听见自己的鞋，不听见自己咽下去的那口唾沫。然后一朵纸样的花会在她脚边慢慢盛开，她才听清——那朵花，<em>就是她刚才那一口没说出口的话</em>。</p>
      <p>这里所有的声音都是回来的。来的人走过的路，每一步都隔着一段还没走完的回音；敲一记旧钟，它会替你走完剩下的路。</p>

      <div class=\"beat\">· · ·</div>

      <p>旧钟的主人站在园子尽头，她是这个庭园里唯一年轻的一个——比她亲手护了多年的任何一口钟都年轻。她的手掌从没被钟锤碰过，所以她的手从来不知道疼。</p>
      <p>「你来得真晚，」她说，声音却比钟乳石洞还老。「我在这片雾里替所有从门口进来的人开后门——敲过的，没敲完的，都在我这儿。」</p>

      <div class=\"beat\">· · ·</div>

      <p>她从袖子里取出一口腹腔里有弦的小木钟，放在旅人的耳边——钟不会响，它只负责<strong>指向</strong>。「你听见的，就是它要你听见的那一下。」</p>
      <p>然后她又掏出一张叠得角都软了的纸，那是一张欠条，背面写着一行字：</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.1rem; letter-spacing:.05em;\">「敲过的每一下都替你记了。」</p>
      <p>「你要划掉两笔——你这一生里，敲过的、最重的两下。划多，我不收；划少，我不认。」</p>

      <div class=\"beat\">· · ·</div>

      <p>旅人想了很久。雾海里的水滴还在替别人落着，她在纸面上轻轻划了两笔。</p>
      <p>第一笔：三年前她没敲出的那一声——一个跌下悬崖的孩子被她伸手拉了回来。那一刻她堵住了自己的喉咙，让全世界先听见那孩子的第一声哭，再听见身边自己那一声没发出来的。</p>
      <p>第二笔：她落在这个庭园里的第一滴水——那一声不是她敲的，但它替她敲了。</p>

      <div class=\"beat\">· · ·</div>

      <p>旧钟的主人收回欠条时，手指在她掌心轻轻按了一下——那就是「谢谢」。她说：</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.1rem; letter-spacing:.05em;\">「这里的水只替你记一下。敲不出来的，我这里，永远算数。」</p>
      <p>「想不起来的那些，」她顿了顿，「不用你划。它们还在你自己手上——下一回想划的时候，来我这儿划。」</p>

      <div class=\"beat\">· · ·</div>

      <p class=\"coda\">旅人离开庭园时，雾海没有在她身后合上。只是她从那天起，再没有在雾海边说过一句无关紧要的话。</p>
      <p class=\"coda\">她的耳边从此挂着一根弦——每当她正要沉默的时候，那根弦就替她响一声：短的、轻的、像水滴落在岩洼里的注视。</p>
      <p class=\"coda\">走出庭园的人，耳朵里都多了一根弦——敲过的每一下，都替他记了。</p>`,
    en: `<p>At the end of the Sea of Mist there is a garden. No road leads to it — only the water that fell into the cavern a thousand years ago, and every drop is still falling for someone else.</p>

      <div class=\"beat\">· · ·</div>

      <p>A traveler walks in and hears nothing: not the wind, not her own steps, not the swallow of her own throat. Then a paper-white flower unfolds at her feet, and she finally makes out the sound — the flower is <em>the sentence she had just swallowed</em>.</p>
      <p>Every voice here returns. Her steps are echoed by the half-finished footfalls of everyone who walked these paths before her; strike a bell once, and it will walk the rest of the way for you.</p>

      <div class=\"beat\">· · ·</div>

      <p>The keeper, The Owner of the Old Bell, stands at the far end of the garden. She is the youngest thing in it — younger than any bell she has ever tended. Her hands have never known a hammer, and her palms have never learned pain.</p>
      <p>“You arrived too late,” she says. Her voice is older than the cavern walls. “I keep the back door open for everyone who comes in from the front — everything that was struck, everything that was left unfinished, is kept here.”</p>

      <div class=\"beat\">· · ·</div>

      <p>From her sleeve she takes a small wooden bell, its cavity strung with chords, and holds it to the traveler’s ear. The bell will never ring — it only points. “What you hear,” she says, “is the one strike it needs you to hear.”</p>
      <p>Then she unfolds a slip of paper, its corners gone soft from so many hands, and lays it on the ledge. On its back is a single line:</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.1rem; letter-spacing:.05em;\">“Every strike you ever made has been kept for you.”</p>
      <p>“Cross out two entries — the heaviest two you ever struck, in all your life. Cross out more, I won’t take them. Cross out fewer, I won’t accept them.”</p>

      <div class=\"beat\">· · ·</div>

      <p>The traveler thinks for a long time. Somewhere behind her, the water keeps falling in its own good time, and she marks two lines on the slip.</p>
      <p>The first: three years ago, the one she didn’t strike — a child who had gone over the edge, and she’d pulled him back. In that instant she had pressed her own throat shut so the world could hear his first cry before anything else — even before the cry that died inside her.</p>
      <p>The second: the first drop of water she let fall into this garden — not a strike of hers at all, but it had struck one for her.</p>

      <div class=\"beat\">· · ·</div>

      <p>The keeper folds the slip away. As her hand closes, one finger rests, briefly, in the traveler’s palm — that is how she says <em>thank you</em>. Then she says:</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.1rem; letter-spacing:.05em;\">“The water keeps you only once. The ones you never strike — here, those always count.”</p>
      <p>“The ones you can’t remember,” she adds, “don’t cross them out. They’re still in your hands. Come back here when you’re ready to.”</p>

      <div class=\"beat\">· · ·</div>

      <p class=\"coda\">When the traveler left the garden, the Sea of Mist did not close behind her. Only that from that day on, she never spoke uselessly at the garden’s edge.</p>
      <p class=\"coda\">From then on there was a string inside her ear — and whenever she was about to hold her silence, it struck once for her: short, light, the way a drop of water lands, watching, in a rock pool.</p>
      <p class=\"coda\">Everyone who walks out of that garden carries a string in their ear — every strike they ever made is kept for them.</p>`,
  },
  {
    no: 6,
    zhTitle: "雨审判",
    enTitle: "The Rain Tribunal",
    zh: `<p>雨钟谷地的审判，每七年开一次庭。没有原告，没有被告席——法庭上只有一位审判者，和一位把所有东西都记在纸上的书记。</p>

      <div class=\"beat\">· · ·</div>

      <p>雨罪审判者穿一件从不干的法袍。它的袖口从不滴水，但掌心永远是湿的——那是雨住在布里面，谁也不知道它从什么时候开始的。</p>
      <p>他的起诉书上写着<em>七条沉钟罪责</em>：七口钟在雨里各自犯过什么。纸上全是被泡散又凝固的字，没有人看得清——不是不想看，是这份纸，从落笔那天起，就没有干过。</p>

      <div class=\"beat\">· · ·</div>

      <p>雨书记坐在法庭的角落，负责记。他的字一次次被雨水泡散又重新写深——他从第一个字学会的唯一一件事，就是在雨还没来得及泡掉它之前，先把它压进纸里。</p>
      <p>七年又七年，他的纸堆了七摞。<em>每一摞，都等同一件事：等一个人，愿意说一句——不管是认罪，还是辩护。</em></p>

      <div class=\"beat\">· · ·</div>

      <p>这一场，念到的是第七条罪责：<em>「谷地自己的钟，未经允许，替它自己自愿转身。」</em></p>
      <p>审判者念了整整一个钟头。雨声替他念了大半句——句号之间，所有的钟声都在雨里学着一起落。这一条究竟有没有犯过，七年一审、审了七年，答案始终一样：有记录的，那是谷地自愿的。</p>

      <div class=\"beat\">· · ·</div>

      <p>就在第七年的法庭里，雨书记突然站了起来。</p>
      <p>审判者看着他。七场散会的光线都是这样灰的——没有一个记录会被收回，因为没人想加进这条被纸泡掉的东西里。</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.15rem; letter-spacing:.05em;\">「书记，请看见。」</p>

      <div class=\"beat\">· · ·</div>

      <p>不是辩护，不是认罪，不是证词——法庭里所有的词语前面，从来没人说过「请看见」。</p>
      <p>审判者停了。雨里，谷地那口沉钟的钟壳里，滚落出自己也说不清楚的那一下——不是认罪，也不是辩护，而是「在」。</p>

      <div class=\"beat\">· · ·</div>

      <p class=\"coda\">审判者把起诉书合上。七条罪责里，没有一条从此消失——但审判也不再只是审判。</p>
      <p class=\"coda\">雨书记这一次没有低头重抄。这一页，留了下来。字迹还在——因为它压进纸里的那一笔，是他写字以来，第一笔没被雨泡掉的字。</p>
      <p class=\"coda\">雨没有停。法庭空了七年的那个空位，终于有人坐了下来。</p>`,
    en: `<p>The Rainbell Valley sits in session once every seven years. There is no prosecutor, no dock — there is one jurist, and one clerk who writes everything down.</p>

      <div class=\"beat\">· · ·</div>

      <p>The Drowning Jurist wears a robe that never dries. Its cuffs never drip, but its palms are forever water — the rain lives inside the cloth, and no one remembers when it started.</p>
      <p>His indictment lists <em>seven charges</em> — seven bells, and what each one did in the rain. The writing is nothing but dissolved and re-hardened strokes; nobody can read it. Not because anyone refuses — but no page written in that room has once been dry.</p>

      <div class=\"beat\">· · ·</div>

      <p>The clerk sits in the corner, keeping the record. Every line he writes is drowned, then written deeper — the only lesson he ever learned was to press the words into the page before the water could carry them off.</p>
      <p>Seven years upon seven years, and he leaves seven stacks of paper. <em>Every stack stands for the same thing — waiting for one person, willing to say one sentence: an admission, or a defense.</em></p>

      <div class=\"beat\">· · ·</div>

      <p>This time, he reads charge seven: <em>“The valley’s own bell, with no one’s permission, turned itself away.”</em></p>
      <p>The jurist reads for a full hour. The rain itself reads most of it — between every period, all the bells learn to fall in learning how to fall. Whether the charge stands, seven years upon seven years of verdict has always come to one thing: the valley turned, and that is on record.</p>

      <div class=\"beat\">· · ·</div>

      <p>And in that same seventh year, the clerk stands up.</p>
      <p>The jurist looks at him. The light has been this grey for seven sessions — nobody recorded anything, since nobody ever wanted to add to what the paper had already carried away.</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.15rem; letter-spacing:.05em;\">“Clerk. Please see.”</p>

      <div class=\"beat\">· · ·</div>

      <p>Not a defense. Not an admission. Not a testimony — not one word in this room had ever before been preceded by <em>please see</em>.</p>
      <p>The jurist stops. And from the shell of the sunken bell, a single tone it could not explain rolled through the rain — not an admission, not a defense, only <em>is</em>.</p>

      <div class=\"beat\">· · ·</div>

      <p class=\"coda\">The jurist closes the indictment. None of the seven charges vanish — but the court is no longer only a court.</p>
      <p class=\"coda\">The clerk does not copy the page again. This one stays. The writing is still there — because that one stroke was the first in his life the rain could not dissolve.</p>
      <p class=\"coda\">The rain never stopped. And the empty seat that had stood empty for seven years — finally, someone sat down.</p>`,
  },
  {
    no: 7,
    zhTitle: "霜锤",
    enTitle: "The Frostbell",
    zh: `<p>霜锤崖上有一间作坊。炉火烧了整整一年，从来没有退过——因为火退一次，冰会把钟缝合拢，再想打开它，就只能等下一个黄昏。</p>

      <div class=\"beat\">· · ·</div>

      <p>末任钟匠是这个世界上最后一位懂得淬火的人。每一口钟从冰里敲出来之后，他都要做同一件事：把它敲一记，听一听——敲一记之后，能不能听到自己回来的声音。</p>
      <p>能听到的，验收合格，装船发往山下。听不到的，<em>他不告诉任何人</em>，只把它重新冻回崖壁，等下一次黄昏。</p>

      <div class=\"beat\">· · ·</div>

      <p>最后一次淬火那天，他的手掉了下来。不是手，是一只皮手套——他自己的，皮革是用山下所有钟弦的断头拧成的。</p>
      <p>他没有捡。他只是站在原地看着它，看了三天。山下没有人敢上来。山上的冰，会冻住走动的影子。</p>

      <div class=\"beat\">· · ·</div>

      <p>第四天，一个没人认识的少年走到了崖脚。他没有带工具，只带一双近乎赤裸的手。他沿着冰道走上来，走到作坊门口时，冰裂开了一条——只够一只脚站进去的缝。</p>

      <div class=\"beat\">· · ·</div>

      <p>末任钟匠坐在炉边。他的眼睛已经看不清了——冰在他眼睛里住了太久。</p>
      <p>少年没有弯腰捡那只手套。他只是站直了，卷起袖子，把赤裸的手伸向断弦拧成的钟槌——敲了一记。</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.1rem; letter-spacing:.05em;\">就那一声。</p>

      <div class=\"beat\">· · ·</div>

      <p>霜锤崖的冰，在同一天黄昏融化了。整整一个黄昏——钟乳石一滴滴落，每一滴都和很多年前那一滴撞上了。</p>
      <p>少年听见了自己回来的声音。不是从山下回来的——是从他从前没来得及说完的话里回来的，是从无数条没有断成弦的弦里回来的。</p>

      <div class=\"beat\">· · ·</div>

      <p class=\"coda\">末任钟匠闭上眼睛。他说，<em>冰是时间的另一面，它冻住的每一秒都响过。</em></p>
      <p class=\"coda\">少年把手套捡起来，戴在自己手上。末任钟匠没有阻止他——因为冰里的每一秒，已经替他响过一次了。</p>
      <p class=\"coda\">离开崖壁的人，在崖脚看见满崖的冰花都裂成了好看的裂纹。<br>那是他回来的声音，在冰下<strong>一寸一寸</strong>地醒过来。</p>`,
    en: `<p>On the Frostbell Cliff stands a workshop. The furnace has burned for a whole year — it has never once been allowed to die down. If the fire retreats even once, the ice knits itself over the bell’s mouth, and only one more dusk opens it again.</p>

      <div class=\"beat\">· · ·</div>

      <p>The Last Frostwright is the last man alive who knows how to temper a bell. After every bell is struck out of the ice, he performs one duty: he strikes it once and listens — after one strike, can he hear his own voice coming back?</p>
      <p>If he can, the bell passes muster and goes down to the valley. If he can’t, <em>he tells no one</em> — he freezes it back into the cliff for the next dusk.</p>

      <div class=\"beat\">· · ·</div>

      <p>On the last quench of the last bell, he lost something. Not a hand — a glove. His own. Its leather was twisted from the cut ends of every bell rope he’d ever finished.</p>
      <p>He did not pick it up. He stood there and looked at it for three days. No one from the valley dared come up. The ice up here freezes anything that moves.</p>

      <div class=\"beat\">· · ·</div>

      <p>On the fourth day, a boy no one knew arrived at the cliff’s foot. He carried no tool — only his hands, almost bare. He climbed the ice path and reached the workshop door; the ice split for him a gap only wide enough for one foot.</p>

      <div class=\"beat\">· · ·</div>

      <p>The Last Frostwright sat by the furnace. His eyes had gone blind — the ice had lived in them for too long.</p>
      <p>The boy did not reach down for the glove. He simply stood straight, folded his sleeve, and stretched his bare hand toward the mallet woven of dead rope-ends — and struck once.</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.1rem; letter-spacing:.05em;\">Just one note.</p>

      <div class=\"beat\">· · ·</div>

      <p>The ice of the Frostbell broke the same dusk. A whole dusk — the stalactites dripped one by one, and each drop rang against every drop that had fallen here years ago.</p>
      <p>The boy heard his own voice coming back. Not from the valley — from every word he had never finished saying; from every rope that had never been twisted into a string.</p>

      <div class=\"beat\">· · ·</div>

      <p class=\"coda\">The Last Frostwright closed his eyes. He said: <em>ice is the other face of time — every second it freezes has sounded.</em></p>
      <p class=\"coda\">The boy picked up the glove and put it on his own hand. The Last Frostwright did not stop him. Every second inside that ice — had already sounded once for him.</p>
      <p class=\"coda\">Whoever leaves the cliff now will see the frost-flowers all cracked open, like beautiful cracks.<br>That is his returning voice — waking, <strong>inch by inch</strong>, beneath the ice.</p>`,
  },
  {
    no: 8,
    zhTitle: "千门",
    enTitle: "The Thousand Doors",
    zh: `<p>九年前她迷了路。回廊钟一千扇门，每一扇都和她记忆里那一扇长得一样——门环的锈，门板的裂，门后同样一段很远的回音。</p>

      <div class=\"beat\">· · ·</div>

      <p>她走了很多条路，数过很多扇门。每一扇门后面都是同一个回廊，同一列没有尽头的门框，同一段敲门声的影子——仿佛每一扇门都在用自己的门板，替同一扇门说话。</p>
      <p>终于，她走到回廊的尽头。守门人坐在最后一扇门前面。他的眼睛是两扇门——谁都不知道它们是开着的，还是关着的。</p>

      <div class=\"beat\">· · ·</div>

      <p>她上前，声音比刚进来时钝了很多：「你听我说——我敲过一千扇门。每一扇都通向同一个地方。你告诉我，到底哪一扇才是真的。」</p>
      <p>守门人不动。他只是问：</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.15rem; letter-spacing:.05em;\">「一千扇，你都敲了？」</p>

      <div class=\"beat\">· · ·</div>

      <p>「第三百一扇。第七百二十扇。一千、一千零一、一千零二……」她一个一个念下去。守门人一直看着她，没有打断。</p>
      <p>她念到的最后一扇，是第一千零一扇——<em>她自己家的门。</em></p>

      <div class=\"beat\">· · ·</div>

      <p>很久以后，她才明白她在念什么。她念到的所有门，全部通向同一个地方：童年的门。每一扇门都替她把同样的敲门声放回来——来自她还没来得及回应的自己。</p>
      <p>守门人从袖子里取出一张只开到「第一扇门」的地图。他说：</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.15rem; letter-spacing:.05em;\">「所有的门通往同一扇门。你来时敲过的那一记，就是它。」</p>

      <div class=\"beat\">· · ·</div>

      <p>她哭了很久。回廊里很久没有出现过眼泪——守门人没有去收拾，只是站开，让出出口。</p>
      <p>她把双手贴在那扇门上。她没有再敲。门自己开了。</p>

      <div class=\"beat\">· · ·</div>

      <p class=\"coda\">回家的路，从来没有离开过。</p>
      <p class=\"coda\">每一扇门都替她记住了那记敲门——没有一扇门会真正关上。</p>
      <p class=\"coda\">敲过的每一扇，都通向第一扇。每个人迷路，都是从迷失自己开始的。</p>`,
    en: `<p>Nine years ago she lost her way. The Arcade of Echoes had a thousand doors — every one identical to the one in her memory: the same rust on the ring, the same crack in the plank, the same distant echo behind it.</p>

      <div class=\"beat\">· · ·</div>

      <p>She walked many roads, and counted many doors. All of them opened onto the same arcade: the same endless row of frames, the same shadow of a knock — as if each door were using its own plank to speak on behalf of the one true door.</p>
      <p>At last she reached the far end. The Gatekeeper sat before the last door. His eyes were two doors — no one could tell whether they were open or shut.</p>

      <div class=\"beat\">· · ·</div>

      <p>She stepped forward. Her voice had grown duller since she entered: “Listen to me — I knocked on a thousand doors. Every one opened onto the same place. Tell me which one is real.”</p>
      <p>The Gatekeeper did not move. He asked only one thing:</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.15rem; letter-spacing:.05em;\">“And you knocked on all of them?”</p>

      <div class=\"beat\">· · ·</div>

      <p>“Door three hundred and one. Door seven hundred and twenty. One thousand. One thousand and one. One thousand and two…” She gave them one by one. The Gatekeeper never interrupted her.</p>
      <p>The last door she named was the one thousand and first — <em>the door of her own home.</em></p>

      <div class=\"beat\">· · ·</div>

      <p>Much later she understood what she had been naming. All the doors she had called out were the same door: the doorway to her childhood. Each one returned the same knock — the knock her unspoken self had never answered.</p>
      <p>From his sleeve the Gatekeeper drew a map that opens only to the first of them. He said:</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.15rem; letter-spacing:.05em;\">“All the doors lead to the same door. The one you knocked when you came — that is it.”</p>

      <div class=\"beat\">· · ·</div>

      <p>She wept for a long time. The arcade had seen no tears in living memory — the Gatekeeper did not tidy them away; he only stepped aside, and made room.</p>
      <p>She laid both hands on the door. She did not knock again. The door opened itself.</p>

      <div class=\"beat\">· · ·</div>

      <p class=\"coda\">The way home has never once left you.</p>
      <p class=\"coda\">Every door remembers the knock it hinged for you — and no door in that arcade was ever truly closed.</p>
      <p class=\"coda\">Every door you knocked leads back to the first one. Every lost traveler begins by losing themselves.</p>`,
  },
  {
    no: 9,
    zhTitle: "石喉",
    enTitle: "The Stone-Throat",
    zh: `<p>低音之城的规矩很简单：地下水在漏，所以每一句话都必须说得比水低。</p>
      <p>没有人敢开口。最怕的是孩子——孩子一出生，嘴就被布盖上了：城里的人不是禁语，他们<strong>买卖</strong>语。说一句话，付一笔沉默作价。</p>

      <div class=\"beat\">· · ·</div>

      <p>石喉母亲坐在大教堂的正中。没人看过她直起腰——她的喉咙里锁着很多以前咽下去的话，一块比一块大，从第一声到最后一声。</p>
      <p>她的律法只有一条：<em>每一句话，都必须是你自己用，用自己脖子上说过的口音，换来的。</em></p>

      <div class=\"beat\">· · ·</div>

      <p>一个来的少女站在她面前。她想问的问题很小，但是她问了一整天才问完——因为每个字都是一笔钱。石喉母亲没有抬手示意她坐下，也没有赶她走；她只是把纸递给少女，说：</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.1rem; letter-spacing:.05em;\">「写下来，让河水替她数。」</p>

      <div class=\"beat\">· · ·</div>

      <p>少女在纸上写了几句之后，石喉母亲开了口——她一开口，整个教堂的地下水都停了一拍。因为母亲那一块是无别的：那块她自己吞下去的、从来不肯对谁说出来的话，沉在喉咙最深的地方，被吞得<em>太多</em>，已经没法分辨是摩擦声还是咳嗽。</p>
      <p>她看了一眼纸上写的那句话，笑了一笑——没有嘴上说话，喉咙只是发出了很低很低的频率，像一块石头在很深的地方松了一毫米。</p>

      <div class=\"beat\">· · ·</div>

      <p>少女问了：「那块石头，是你自己吞下去的？」</p>
      <p>石喉母亲没有回答。少女继续写：「第一句。孩子来的时候像一块石头那样安静——谁的话，被塞进去的？」</p>

      <div class=\"beat\">· · ·</div>

      <p class=\"coda\">教堂外面，水依然在响。只是今天，在很久很久以后，地下水记下了它自己曾经听见过的最轻的一句话——</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.1rem; letter-spacing:.05em;\">「谁，不该沉默。」</p>
      <p class=\"coda\">从那天起，低音之城的每一份价目表，都少了一栏——「沉默」本身，就被划去了价。</p>
      <p class=\"coda\">石喉母亲再也不能开口了。可城市从此有了一个不需要货币的音：一句<em>忘记被付价</em>的话语。</p>`,
    en: `<p>The City of Low Tones has a simple law: the groundwater is leaking, so every voice must be pitched lower than the water.</p>
      <p>No one speaks above it. The worst offenders are the children — each baby born has its mouth covered at birth. The people of the city are not forbidden to speak; they <strong>sell</strong> it. Every sentence has a price, paid in silence.</p>

      <div class=\"beat\">· · ·</div>

      <p>The Stone-Throat Matriarch sits at the center of the cathedral. No one has ever seen the matriarch straighten. Inside her throat, sealed many a sentence she herself swallowed, each heavier than the last — from the first word to the last.</p>
      <p>Her law has exactly one clause: <em>every word you say must be an accent you are willing to carry for the rest of your life.</em></p>

      <div class=\"beat\">· · ·</div>

      <p>A girl stands before her. She wants to ask one small question, but it takes her a whole day — every character is a coin. The matriarch does not offer a chair and does not wave her out. She only hands the girl paper and says:</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.1rem; letter-spacing:.05em;\">“Write it. Let the river keep count.”</p>

      <div class=\"beat\">· · ·</div>

      <p>After the girl had written only a few lines, the matriarch answered — and in that instant, the groundwater under the cathedral stopped for a single whole beat. Because the stone she carried was hers alone: a sentence she had swallowed so many times, down to the very bottom of her throat, it was no longer clear whether it was a scrape or a cough.</p>
      <p>She looked at the line the girl had written, and she smiled — not aloud, but low, so low it was almost below hearing, like a stone moving one millimeter at the bottom of a deep well.</p>

      <div class=\"beat\">· · ·</div>

      <p>The girl asked: “That stone. You swallowed it yourself?”</p>
      <p>The matriarch did not answer. The girl went on writing: “The first one. The one that was shoved down when every new child came in — whose voice was it?”</p>

      <div class=\"beat\">· · ·</div>

      <p class=\"coda\">Outside the cathedral, the water kept sounding. But from that day on, the groundwater remembered the softest sentence it had ever heard —</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.1rem; letter-spacing:.05em;\">“who, should not have to hold their silence.”</p>
      <p class=\"coda\">From that day, every price list in the City of Low Tones had one line struck out — the price of silence itself.</p>
      <p class=\"coda\">The matriarch cannot speak again. But the city has a pitch that costs nothing: a sentence that was <em>never paid for</em>.</p>`,
  },
  {
    no: 10,
    zhTitle: "第一钟",
    enTitle: "The First Bell",
    zh: `<p>沉默不是这一场的开始——沉默本来就是这一场。</p>

      <div class=\"beat\">· · ·</div>

      <p>最后的铸钟人来了之后，世界才第一次有了一个名字：<em>吵闹</em>。</p>
      <p>那时候的世界没有钟。只有人用力敲、用力打、用力把自己整个消音。地下的石头不睡，地上的钟还没经过；风只是怒，没有音高可依。</p>

      <div class=\"beat\">· · ·</div>

      <p>他是来替世界铸钟的，但知情的人只有他一个：<strong>钟一响，世界要付的账就结了</strong>。从此以后，人会长出喉咙、长出手、长出需要被自己咽下去的字句；每一个愿意爽快地把字咽下去的人，都会拿到再清醒的一颗心。</p>
      <p>他知道这些。他拿到了所有的铜——没人记得是哪一家送的。那些铜片，被炉火烧了三个月，烧到头发都在教他发颤。</p>

      <div class=\"beat\">· · ·</div>

      <p>他挖了个洞，把刚烧好、还不能响的铜水，倒进从地下挖来的模具里。没有铙钹、没有敲锤、没有教人怎么敲——<em>这口钟没有被任何人敲过</em>。</p>

      <div class=\"beat\">· · ·</div>

      <p>最后的铸钟人做了一件所有钟匠都没想到的事。他让这口钟失去了全部音程——没有一个音让他划定，钟的身体只是钟的身体：<em>他</em>是钟这个字，钟是他这一句。</p>
      <p>他对着最深的地底吹了一口气。铜水沉了下去，永远只把自己的一半分给大地，<em>留下了另一半给世界</em>。</p>

      <div class=\"beat\">· · ·</div>

      <p>他没有等钟冷却。他只是把最后一块铜片放在一起，然后留下了这么一句：</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.1rem; letter-spacing:.05em;\">「世界收到的第一个声音，是没有人的声音；世界送出的第一个沉默，是有人的沉默。」</p>

      <div class=\"beat\">· · ·</div>

      <p class=\"coda\">传说之后，裂开了很多年——没有人见到他。没人见过他走，只见到人开始学「先听，再动」。</p>
      <p class=\"coda\">风钟海岸的雾里残留着最后的铸钟人的铜火；没人会告诉你它是多少年留下来的。</p>
      <p class=\"coda\">每当你听见一口从没敲过的钟——<strong>那就是他用最后一块铜，替你们做出的第一次</strong>。</p>`,
    en: `<p>Silence was not the beginning of the story — silence had always been it.</p>

      <div class=\"beat\">· · ·</div>

      <p>Only after the last bell-smith arrived did the world have a name at last: <em>noise</em>.</p>
      <p>Back then there were no bells. People hammered hard and struck hard and suppressed themselves entirely. The stone beneath had no sleep; the surface had no bell to lend it; the wind was only rage, never pitch.</p>

      <div class=\"beat\">· · ·</div>

      <p>He arrived to cast the world's first bell, and only he knew this: <strong>the moment it sounds, the world pays its balance in full</strong>. From then on, every human being would grow a throat, a hand, and words they would have to gulp down whole; and the ones willing to gulp first would be the ones to wake up most clearly.</p>
      <p>He knew this. He collected all the copper — no one remembers which house supplied it. The metal spent three months in the furnace; by then even his hair sent shivers through him.</p>

      <div class=\"beat\">· · ·</div>

      <p>He dug a pit, and poured the bronze — molten, and still not ready to ring — into the mould lifted from the earth. No clapper, no hammer, no instruction on how to strike — <em>this bell was never struck by anyone</em>.</p>

      <div class=\"beat\">· · ·</div>

      <p>The Last Bell-Smith did something no other bell-smith in history had thought of. He stripped the bell of every pitch it had been given — he set no note for it. It is the body of a bell; nothing more: <em>he</em> was the character; the bell was this one sentence.</p>
      <p>He breathed toward the deepest part of the soil. The bronze went down and surrendered only half of itself to the earth — <em>and kept the other half for the world</em>.</p>

      <div class=\"beat\">· · ·</div>

      <p>He did not wait for the metal to cool. He only set the last piece of copper into place, and left behind one line:</p>
      <p class=\"no-indent\" style=\"text-align:center; text-indent:0; color:var(--gold); font-size:1.1rem; letter-spacing:.05em;\">“The first sound this world ever heard was not a human sound; the first silence it ever offered was not a human silence.”</p>

      <div class=\"beat\">· · ·</div>

      <p class=\"coda\">After the legend, everything lay dormant for many years — no one saw him. No one saw him leave; they only saw people start to learn <em>listen first, then move</em>.</p>
      <p class=\"coda\">In the mist of the Windbell Coast, a trace of the last bell-smith's forge fire remains; no one will tell you how many years it has been there.</p>
      <p class=\"coda\">Whenever you think you have heard a bell that no one ever sounded — <strong>that is the first strike he ever made, in the last piece of copper he ever lifted</strong>.</p>`,
  },
  {
    no: 11,
    zhTitle: "暗潮",
    enTitle: "The Dark Tide",
    zh: `<p>她是风钟海岸的第九个守夜人——第九个，而不是第一个。</p>
      <p>她之所以能听见，是因为她已经听了四十二年。</p>

      <div class="beat">· · ·</div>

      <p>宇宙里有两条不变的法则——文明总在想着扩张，而宇宙的物质总量不变——而当这两条挤在一起，先发现对方的那一边，只有一种出路：<em>变成一根永远不响的弦</em>。</p>
      <p>守夜人知道这一点，因为她之所以被选为第九个守夜人，是因为她可以按 V——永远让自己的喉咙不发出任何声音。</p>

      <div class="beat">· · ·</div>

      <p>夜里的第三个小时，窗前的频谱仪抖了一下：不是钟。更长——<em>比最低的弦还长</em>。像宇宙把耳朵凑了过来，只举起手，不给答案。</p>
      <p>守夜人看着那一行数字，不按任何键。</p>

      <div class="beat">· · ·</div>

      <p>守夜人听见的第一声，是一个世纪前就发往这里又没人听懂的声音——缺了一拍的 <em>三拍一停</em>，三拍后停，<em>没人</em>回应该停。</p>
      <p>她压低了自己，她没有扣下任何键。</p>

      <div class="beat">· · ·</div>

      <p>她知道——如果她回答，对方就会再问下去。</p>
      <p>如果她沉默，对方就永远只能到此为止。</p>
      <p>宇宙最安全的答案，不是沉默——<strong>是从未回答。</strong></p>

      <div class="beat">· · ·</div>

      <p>她走到岸边。雾像一根慢慢从海里升起的铅丝——不是雾，是<em>某种完全不属于她的存在</em>，整个宇宙里只有这一盏灯。</p>
      <p>她在里头过了一季——<em>然后她不敢告诉任何人</em>，这一季她再没发出过任何声音。</p>

      <div class="beat">· · ·</div>

      <p class="coda">守夜人走后，接替她的人在频谱仪上存储了一份自动记录。</p>
      <p class="coda">那份记录里，宇宙的回答只有一句——</p>
      <p class="no-indent" style="text-align:center;text-indent:0;color:var(--gold);font-size:1.1rem;letter-spacing:.05em;">「听——每个人都在听。但这个宇宙里，没有一个人发声。」</p>
      <p class="coda">第十个守夜人接手后，在记录手册的第一行写下：<em>「暗潮未消。」</em></p>`,
    en: `<p>She was the ninth night-keeper of the Windbell Coast — the ninth, not the first.</p>
      <p>She could hear because she had already been listening for forty-two years.</p>

      <div class="beat">· · ·</div>

      <p>The universe obeys two inviolable laws — civilizations always long to expand, and the total matter of the cosmos does not change — and when these two press together, the civilization that discovers the other first has exactly one option: <em>to become a string that never vibrates</em>.</p>
      <p>The night-keeper knew this, because she had been chosen for the ninth watch precisely because she could press V and swallow any sound that threatened to leave her throat.</p>

      <div class="beat">· · ·</div>

      <p>In the third hour of the night, the spectrometer on the windowsill gave a small twitch — not a bell. Lower — <em>lower than the lowest string</em>. As though the universe had placed its ear against the window, and raised its hand to say nothing.</p>
      <p>The night-keeper watched the row of digits and pressed nothing.</p>

      <div class="beat">· · ·</div>

      <p>The first signal was something some distant civilization sent to the world a century ago — the shape of <em>three beats and a pause</em>, three beats and a pause.</p>
      <p>She pressed nothing. She held her breath.</p>

      <div class="beat">· · ·</div>

      <p>If she answered, the other side would ask further.</p>
      <p>If she remained silent, the other side could never go beyond this.</p>
      <p>The safest message in the universe is not silence — <strong>it is never answering.</strong></p>

      <div class="beat">· · ·</div>

      <p>She walked to the shore. The fog rose like a thin, slow wire from the sea — not fog, but <em>something that belonged entirely to someone else</em>, and the whole universe could only keep that one light.</p>
      <p>She stayed inside for one season — <em>then she never told anyone</em>, and after that she never made a sound again.</p>

      <div class="beat">· · ·</div>

      <p class="coda">After the ninth keeper, the one who followed found one automatic recording in the spectrometer.</p>
      <p class="coda">Inside that recording, the universe answered in a single sentence —</p>
      <p class="no-indent" style="text-align:center;text-indent:0;color:var(--gold);font-size:1.1rem;letter-spacing:.05em;">“Listen — everyone is listening. And in this universe, no one is speaking.”</p>
      <p class="coda">The tenth keeper who succeeded her wrote in the first line of the logbook: <em>“The Dark Tide has not receded.”</em></p>`
  },
  {
    no: 12,
    zhTitle: "后记 · 第十二个听者",
    enTitle: "Epilogue · The Twelfth Listener",
    zh: `<p>第十一篇，写到守夜人那个夜晚，风又来了。</p>
      <p>那之后很多年，没有人去岸上看过频谱仪。</p>
      <p>又很多年后，有人去了。</p>

      <div class="beat">· · ·</div>

      <p>频谱仪上还挂着早已褪色的录像：一个几乎认不出形状的影子，在凌晨的窗前立了很久。</p>
      <p>灯下，那道影子——他把自己捂着——很久没有动过。</p>
      <p>不是不会动——是不动了，他把自己按住了。</p>
      <p>那个人，就是被自己捂住的那块石头。</p>
      <p>后来，替他们接班的那个人，在记录手册最后一页的空白处写下了一段话——</p>

      <div class="beat">· · ·</div>

      <p class="coda">「听见的人，这些年很多了——坐着的人、走动的人、还没醒的孩子。」</p>
      <p class="coda">「可是——真把听见的东西送出去的人，还没有。」</p>

      <div class="beat">· · ·</div>

      <p>那个人不是守夜人，也不是前一任接替守夜人的人。</p>
      <p>那个人——就是翻到这里、把这句话读完的人。</p>

      <div class="beat">· · ·</div>

      <p>把听见的送出去——不是让别人听见，而是让同一片海上此刻正在听着的所有耳朵，知道：不是只有你一个人在听。</p>
      <p>你不说话，它仍然会听。</p>
      <p>当你真的说话——</p>
      <p>你不是在回答宇宙。</p>
      <p>你只是终于——把被你捂了多年的东西，放下了。</p>

      <div class="beat">· · ·</div>

      <p class="coda">第十一个守夜人在海浪冲上岸的那一瞬间，听见了比风更低的声音——</p>
      <p class="coda">是十二只手，同时按从未敲过的钟——</p>
      <p class="coda" style="text-align:center;color:var(--gold);font-size:1.1rem;letter-spacing:.06em;">——第十二个听者</p>`,
    en: `<p>The eleventh chapter ends on the night when the night-keeper stood at her window listening — wind once more.</p>
      <p>For many years after that, no one went to the shore to look at the spectrometer.</p>
      <p>And many years after even that, someone went.</p>

      <div class="beat">· · ·</div>

      <p>You can reach the shore now.</p>
      <p>The sea by then had dried out —</p>
      <p>or the sea by then was still wet, depending on which one of you was reading.</p>
      <p>The person who wrote this page — is not telling you this to frighten you;</p>
      <p>to say: there is no shore left where there were once waves.</p>
      <p>The shoreline is you.</p>
      <p>Not at the end — not at the beginning —</p>
      <p>but wherever you happen to be standing — when you read this line.</p>
      <p>Afterwards, the person who succeeded them wrote one line on the last blank page of the logbook —</p>

      <div class="beat">· · ·</div>

      <p class="coda">“Those who heard it grew many — those who sit, those who walk, those who are not yet awake.”</p>
      <p class="coda">“But — the one who gave it away, the one who sent the thing they heard onwards — that one is still missing.”</p>

      <div class="beat">· · ·</div>

      <p>That person is not a night-keeper, nor the one who inherited the watch after them.</p>
      <p>That person — is the one who turned to this page, and finished reading the line.</p>

      <div class="beat">· · ·</div>

      <p>Sending the thing you hear onward — not to make others hear, but so every ear by this same sea knows: you are not the only one listening.</p>
      <p>When you don’t speak, the sea still listens.</p>
      <p>When you finally do speak —</p>
      <p>You are not answering the universe.</p>
      <p>You are simply letting drop, at last, the thing you spent your life holding back.</p>

      <div class="beat">· · ·</div>

      <p class="coda">At the moment the wave broke on the shore, the twelfth keeper heard something lower than the wind —</p>
      <p class="coda">twelve hands, striking the bell that had never been struck —</p>
      <p class="coda" style="text-align:center;color:var(--gold);font-size:1.1rem;letter-spacing:.06em;">— The Twelfth Listener</p>`,
  },

  {
    no: 13,
    zhTitle: "拾钟人",
    enTitle: "The Bell-Picker",
    zh: `<p>没有人记得拾钟人从哪一年开始走。只记得他走的时候不问路——问路的人已经没有了；他只问每一处钟最后一次响是哪一年。没有人答得上来，他就点点头，像听懂了什么似的，把那块地方在布口袋上画一个记号。</p>
    <p>他走的时候背着一只旧布袋。布袋里没有干粮、没有水囊、没有火种。布袋里装的，是八座走过的钟里剩下的东西：一只钟口、一根钟舌、几片被海水吃薄的铜皮——每一件都锈得温柔，像被很多人抱过又放下。</p>

    <div class="beat">· · ·</div>

    <p>休垒的人让他看了那口从井底捞上来的钟。钟没有了底，里面长满了芦苇和青苔。拾钟人没有碰它——他说底没了的东西，口还在，就还算没碎。休垒的人请他喝酒。他喝了半口，把剩下的半口泼在土里，说：「给井里的那位。」</p>
    <p>低语林的人不让他进林子。他就在林外站了很久，说：「钟舌不在钟里也是钟舌。」林里的风后来吹出来一片铜绿色的苔藓，落在他的脚边。他把它包进油布里，放在布袋最里面——那里是留给最小的东西的。</p>

    <div class="beat">· · ·</div>

    <p>沉唱堂的人给了他一页纸。纸上的字已经被水泡糊了，只剩最后一行，「第四下——」没写完。拾钟人把纸对折了两折，夹进簿子里。他没有问：没写完的字，不需要问。</p>
    <p>破拍营地的人围着他看布袋。有人认出了铎坠——那是火谱里那把交响乐队烧剩的「弱拍」；那是整条乐句里唯一没被敲过的那一拍。拾钟人说：「我不是来收古董的。我是来替它们把沉默收拾干净的。」营地里安静了很久，然后有人在火里添了一根柴。没有人唱歌，但火光跳了一下，像呼应似的。</p>

    <div class="beat">· · ·</div>

    <p>叩钟镇的人告诉他，整座吊钟山只剩下一小块「影子」——那一块影子是钟在熄灭前最后一刻留在雪地上的。拾钟人把那一块影子记在了布口袋上。低语林的铜皮、叩钟镇的雪影、沉唱堂的半行字……他记下来的从来不是「东西」，而是「东西离开之后剩下的那一点气」。</p>
    <p>未完之厅的人问他：整理这些东西做什么。他说：「给以后想敲钟的人，留一个不闷的起手式。」未完之厅的人笑了——他们在笑一件没人信会发生的事。拾钟人不生气。不整理的人也不止他一个，但他决定做那个整理的人。</p>

    <div class="beat">· · ·</div>

    <p>他最后到的是风钟海岸。岬角尽头，海水退去时露出那块旧船板——每一根蚀透的榫卯都不说它漂了多远；这个岬角的旧名字，就叫「它回来的地方」。拾钟人把布袋放下，从里面取出全程最大的一件东西：一根钟舌。它锈得很深，但他一握住它，就知道它曾经属于一口完整的钟。</p>
    <p class="no-indent" style="text-align:center; text-indent:0; color:var(--gold); font-size:1.1rem; letter-spacing:.05em;">「第四下还没人敲」</p>
    <p>他把钟舌挂上那根已经断了的桅杆底座——不是为了响，是为了让这片海记得：曾经有一颗心脏在等一次敲击。他没有在石头上刻字：船板已经替这个岬角说完了。他只在布袋上又添了一个记号。然后他转身，往回走。</p>

    <div class="beat">· · ·</div>

    <p class="coda">多年以后，守钟人阿衡的石盘边上，多出一只旧布袋。袋口系着一根油布包的铜皮。布袋里有很多件锈得温柔的东西和一张字条：</p>
    <p class="no-indent" style="text-align:center; text-indent:0; color:var(--gold); font-size:1.1rem; letter-spacing:.05em;">「留给第四下敲钟的人」</p>
    <p class="coda">守钟人没有问是谁放的。她把布袋收进了石盘底下，和手册一起。<br>有些礼物，收下了就等于替送的人，继续保管了。</p>
    <p class="coda">风钟海岸依然没有钟声。<br>但每一件抵达过布袋的东西，都被好好地放着——<br>像每一片在等一次敲击的沉默，终于找到了一个愿意替它们存档的人。</p>`,
    en: `<p>No one remembers the year the Bell-Picker first set out. Only that he never asked for directions — the ones who would have pointed have stopped answering; he asked only one thing, at every reach: the year the last bell rang. No one could say, so he nodded, as if he had understood something, and drew a small mark on his canvas sack.</p>
    <p>He carried an old canvas sack on his back. There was no bread in it, no waterskin, no tinder. It held what remained of every bell he crossed: one rim, one clapper, a few sheets of copper eaten thin by the sea — each warm with rust, as though it had been held by many hands and set down gently, again and again.</p>

    <div class="beat">· · ·</div>

    <p>At Resthold, they showed him the bell they had hauled up from the well. It had no bottom; reed and moss grew inside it. The Bell-Picker did not touch it — a thing with no bottom still has a rim, he said, and a rim is not yet broken. They offered him wine. He drank half and poured the other half into the earth, and said: “For the one down the well.”</p>
    <p>In Whisperwode they would not let him in. He stood at the treeline a long while, and said: “A clapper is a clapper, even outside the bell.” The wind from the wood afterwards blew down a strip of verdigris moss that landed at his feet. He wrapped it in oilcloth and set it deepest in the sack — the pocket reserved for the smallest things.</p>

    <div class="beat">· · ·</div>

    <p>At Drowned Choir they gave him a page. The ink had bloomed into water, only the last line survived — “the fourth—” never finished. He folded it twice and kept it in his pocketbook. He did not ask. The unfinished do not ask to be finished; they ask to be carried.</p>
    <p>At Brokenbar Camp they ringed him, looking into the sack. Someone recognised the clapper — the weak beat from the half of the score the fire had not taken, the one note of the whole phrase that had never once been struck. “I am not here for antiques,” he said. “I am here to put the silences in order.” The camp went still for a long moment. Then someone fed the fire one more log. No one sang. But the light leapt, once, as if it had answered.</p>

    <div class="beat">· · ·</div>

    <p>At Fellcarillon they told him that the whole bell-mountain had shrunk to a single patch of “shadow” — the shadow the bell had thrown on the snow in the last instant before it went out. He marked the shadow on his canvas sack. The copper from Whisperwode, the snow-shadow from Fellcarillon, the half line from Drowned Choir… He was never writing things down. He was writing down what the things kept breathing after they were gone.</p>
    <p>At the Unfinished Hall they asked him: what is all this for. He said: “So that whoever wants to ring again someday has a first grip that does not startle them.” The people of the Unfinished Hall laughed — they were laughing at something no one believed would happen. He did not mind. Not everyone refuses to set things in order. Someone must be the one who does the setting.</p>

    <div class="beat">· · ·</div>

    <p>His last stop was Windbell Coast. At the headland’s end, the tide went out and left a plank of old hull — every peg sheared by the sea still carries the cape’s old name: <em>the place it came home</em>. The Bell-Picker set the sack down and drew out the largest thing in it: one clapper. The rust was deep, but the moment he closed his hand around it he knew it had once belonged to a whole bell.</p>
    <p class="no-indent" style="text-align:center; text-indent:0; color:var(--gold); font-size:1.1rem; letter-spacing:.05em;">“the fourth has no one to ring it yet”</p>
    <p>He hung the clapper on the broken stump of the mast — not to make a sound, but to let this sea remember: there was once a heart waiting for one more blow. He carved nothing into the stone. The plank had already said everything this headland had to say. He drew one more mark on the sack. Then he turned and walked back.</p>

    <div class="beat">· · ·</div>

    <p class="coda">Years later, beside Keeper A Hén’s stone pan, a canvas sack was found. It was tied with a strip of oilcloth around a piece of copper. Inside were many things, worn warm with rust, and a slip of paper that read:</p>
    <p class="no-indent" style="text-align:center; text-indent:0; color:var(--gold); font-size:1.1rem; letter-spacing:.05em;">“For the one who rings the fourth.”</p>
    <p class="coda">The keeper did not ask who had left it. She set the sack under the pan, beside the ledger.<br>Some gifts, once accepted, become someone else’s to keep.</p>
    <p class="coda">Windbell Coast still has no bell.<br>But everything that entered that sack is kept —<br>every silence waiting for one more stroke has found, at last, someone willing to hold them all on file.</p>`,
  },

  {
    no: 14,
    zhTitle: "灯匠",
    enTitle: "The Lampwright",
    zh: `<p>风钟海岸最东端，有一间灯坊。这间灯坊从不关门——不是因为不关，而是因为没有什么可关的。阿瓷收下一批旧铜：钟的口、钟的舌、钟的碎片——八区的废品商贩廉价卖来。</p>
    <p>她不是钟匠，不是铸师，她只是一个会把破铜熔进灯身的灯匠。但她不在乎敲打。她在乎的是：每一块铜都带着一圈完整的老痕迹。</p>

    <div class="beat">· · ·</div>

    <p>那个冬天，她每天关门后把铜片一片片排开。她发现它们并不都相同——有一块尤其重，几乎是其他的两倍；有一块很轻，几乎拍一下就响。她把它们排成一排，像是在替它们按音阶排队。</p>
    <p>有一天夜里，一个行商敲开了灯坊的门——他不是来买灯的，是来卖铜的。他说这批旧铜来自八个区域：沉唱堂、叩钟镇、破拍营地——每一块都来自被碎掉的钟。每一块都被海蚀蚀。阿瓷点头，但她没有问来历——她不在乎来历。她在乎的是：这些铜自己记住了什么。</p>

    <div class="beat">· · ·</div>

    <p>议会的书记员每年来收税。他看到灯坊门口排着的铜片，皱眉说：这些铜都在发霉、会腐蚀、它们没用。阿瓷没有反驳。她只是说：这些铜不是用来用的。它们的的确确存在过。</p>
    <p>书记员走后，阿瓷把那片最重的铜重新拿起来。那一刻铜片发出了很低的共鸣——像有人把他指尖深深按进烛芯，但还没按下去。她屏住了呼吸。</p>

    <div class="beat">· · ·</div>

    <p>那一冬之后的春天，一个老妇人来到灯坊。老妇人什么也没说，她只是把一只旧腕表递给阿瓷——那是一只从没走过的表。阿瓷打开它，里面的发条已完全锈死。她还给老妇人：这表再也走不动了。老妇人说：「我知道。」然后转身走了。</p>
    <p>阿瓷那晚坐在灯坊里很久。她想到她手边排着的铜片——它们不也是一样的东西吗：从没响过，却从不真正沉默。她拿起那块最重的铜，用布擦了很久。铜片慢慢亮了起来——像有人把这块铜重新想起来了。</p>

    <div class="beat">· · ·</div>

    <p>那年夏末，海边卷来了一场风暴。渔村里有个孩子被卷入潮间带——灯坊的灯火忽然自己低了一扇。阿瓷没有犹豫。她从架子上取下那片最重的铜，用布裹住，冲了出去。</p>
    <p>风暴到达岬角时，孩子还站在水里，腿脚冰凉。阿瓷把铜片举到孩子耳边，铜片自己震了一下——很轻，但足够让孩子闭上眼睛、抬头看天。然后铜片裂成了两半。</p>

    <div class="beat">· · ·</div>

    <p class="coda">孩子被找到了。阿瓷回灯坊，把铜片的两半放在架子上。那晚，整间灯坊都安静了。</p>
    <p class="coda">她再也没有用那片铜做灯。她只是把那两半放在架子上，每天擦它一次。灯坊还是一样亮，铜片还是一样静。</p>
    <p class="coda">被风蚀过的铜——<br>被打碎的钟仍在记忆里敲响；<br>被分两半的沉默依然等待一个整体的归来。</p>`,
    en: `<p>At the very eastern end of Windbell Coast, there is a lampforge. It never closes the door — not because it does not want to, but because there is nothing to close it for. A-Zi accepted a crate of old copper: bell-rims, bell-clappers, bell-shards — a scrap dealer bought them cheap from all eight reaches.</p>
    <p>She is not a bell-smith, not a foundry-keeper. She is a lampwright who happens to be able to melt broken copper into lamp bodies. She does not care about striking. She cares about this: every piece of copper came with a full circle of old marks around it.</p>

    <div class="beat">· · ·</div>

    <p>That winter, she lined the pieces up every night after closing. She found they were not all the same — one piece was especially heavy, almost twice the weight of the others; one was almost light enough to bounce with a tap. She lined them up as though she were filing them by pitch.</p>
    <p>One night, a traveling merchant knocked at the lampforge. He did not come to buy lamps — he came to sell more copper. He said this batch came from eight reaches: Drowned Choir, Fellcarillon, Brokenbar Camp — every piece came from a broken bell. Every piece had been etched by the sea. A-Zi nodded, but she did not ask where they came from. She did not care about provenance. She cared about what the copper itself remembered.</p>

    <div class="beat">· · ·</div>

    <p>The council clerk comes every year to collect taxes. He saw the copper pieces lined up at the door and frowned: these are all oxidizing, they will corrode, they are useless. A-Zi did not argue. She only said: these are not meant to be used. They were really here.</p>
    <p>After the clerk left, A-Zi picked up the heaviest piece again. In that moment, the copper gave a very low resonance — as though someone had pressed a finger deep against a wick but had not yet pressed down. She held her breath.</p>

    <div class="beat">· · ·</div>

    <p>The following spring, an old woman came to the lampforge. She said nothing; she only handed A-Zi a broken old watch — a watch that had never run. A-Zi opened it: the mainspring was rusted completely dead. She gave it back. The old woman said: “I know.” Then she turned and left.</p>
    <p>That night, A-Zi sat in the lampforge for a long time. She thought of the copper pieces lined up on her workbench — weren't they the same thing: never ringing, yet never truly silent? She picked up the heaviest piece and wiped it with a cloth for a very long time. The copper slowly began to shine — as though someone had just remembered this piece.</p>

    <div class="beat">· · ·</div>

    <p>At the end of that summer, a storm swept in from the sea. A child from the fishing village was swept into the tide-flats — and the lamp suddenly dimmed by one pane. A-Zi did not hesitate. She took the heaviest piece from the shelf, wrapped it in cloth, and ran out.</p>
    <p>When the storm reached the headland, the child was still standing in the water, legs numb with cold. A-Zi held the copper piece near the child's ear; the copper chimed on its own — very softly, but enough to make the child close their eyes and look up at the sky. Then the copper piece cracked in two.</p>

    <div class="beat">· · ·</div>

    <p class="coda">The child was found. A-Zi returned to the lampforge and placed the two halves on the shelf. That night, the whole lampforge went quiet.</p>
    <p class="coda">She never used the piece to make a lamp. She only kept the two halves on the shelf, wiping them once a day. The lampforge stayed as bright as ever, and the copper halves stayed as quiet as ever.</p>
    <p class="coda">The wind will never forget —<br>the bells broken still ring inside the memory;<br>the silence split in two still waits for one whole return.</p>`,
  },

  {
    no: 15,
    zhTitle: "低音之城",
    enTitle: "The City of Low Tones",
    zh: `<p>低音之城没有货币，因为声音本身就是账。一下钟响，城就替敲钟的人记一笔——钟舌欠钟壳一声，风欠珊瑚一声，连山脊上的石头都欠下面那些被压弯的房梁一声。</p>
    <p>城里所有的债都由石喉母亲来记。石喉是整个城，也是她的喉咙。她住进石喉的那天起就再没有一句话是闲的——她说的每一句，都是一行账。</p>

    <div class="beat">· · ·</div>

    <p>账本上从不写收据，因为一切债都在回响里自动录入。一只狐狸从山脊跑下来，离开废墟的时候断了一条左腿——账本自动多出一行：断腿欠山脊一跳。一只燕子在屋顶放巢，搬走的时候泥浆掉下来——泥浆欠房梁一片灰。</p>
    <p>有人嘲笑她记得太细：一片灰、一声跳、一团风。母亲不说话，她只是写。石喉越来越深，账本越来越厚。城里管这叫「全城的记账安眠」。</p>

    <div class="beat">· · ·</div>

    <p>那年夏天，海岸来了一个小女孩。她说她欠了海一记 E♭。不是她吹的，不是她唱的——是她从海边带回来一段没有被谁唱完的调，一路藏在路上，怕它跑掉，结果走进城时那段调就跑了。</p>
    <p>海发了一张传票给母亲：一个失落的芦管调，欠账还讫之前，小女孩不许离开海岸。</p>
    <p>城里的商人围上来指点：那就还一记呗，就一记 E♭。小女孩摇头。她不会唱那个音。那音不是她的——她只是路过时听进去的。</p>

    <div class="beat">· · ·</div>

    <p>母亲在城门口坐了很久。她想了很多种办法：可以让海自己重播、可以让城里每个人帮她唱一遍、可以让商人们去找芦管。都不行。那记 E♭从未在任何人的嗓子里。它只在一个路过的海面上短暂存在，然后散开。</p>
    <p>母亲第一次见到了一笔她付不起的账。不是钱付不起，是她的账本从根本上不认这种东西——它不是别人给你的，而是你恰好听见了。</p>

    <div class="beat">· · ·</div>

    <p>那天晚上，母亲没有写字。她坐下来，对着小女孩听了一整夜——不是听 E♭，是听小女孩怎么讲那段调。她讲得很慢，断了几次，重新讲了三遍。</p>
    <p>第二天早上，母亲把账本合上，走到城门，对海使者说：这笔账记下了。不是因为还上了，是因为有人愿意听一个她还不起的账。</p>
    <p>海使者愣了很久，然后说：「那就抵。」低音之城从此有一个新字——<em>听账。</em></p>

    <div class="beat">· · ·</div>

    <p class="coda">后来母亲在账本最末页开了一个新栏：不记欠多少，只记谁来坐一坐、听多久。</p>
    <p class="coda">账本第一次没有那么厚。</p>
    <p class="coda">如果你有一天走进低音之城，你会看到石喉母亲合上账本，朝你点一下头。<br>她不问你为什么来。<br>她知道你来，是因为你也有一笔账，欠给某样你记不起却一直听见的东西。</p>`,
    en: `<p>The Bass Citadel has no currency, because sound itself is the ledger. One toll of the bell, and the city chalks up a debt: the clapper owes the shell one note, the wind owes the coral one sigh, the ridge of stone above owes the bent roof-beam below it one murmur.</p>
    <p>Every debt in the city is recorded by the Stone-Throat Matriarch. The Stone-Throat is the whole city, and it is her throat. From the day she moved in, no word out of her has ever been idle — every sentence she says is one line of the ledger.</p>

    <div class="beat">· · ·</div>

    <p>No receipt is ever written, because every debt registers itself in the echo. A fox comes off the ridge and leaves the ruin with a torn hind leg — the ledger auto-files: a torn leg owes the ridge one leap. A swallow builds a nest on a roofbeam and leaves the mud behind — the mud owes the roofbeam one grey fleck.</p>
    <p>Some mock her for the detail: one fleck, one leap, one wisp of wind. The Matriarch does not speak back. She only writes. The Stone-Throat deepens. The ledger thickens. The city calls this “the whole city counting its sleep.”</p>

    <div class="beat">· · ·</div>

    <p>That summer, a little girl came from the coast. She said she owed the sea one E♭. Not that she whistled it. Not that she sang it — she had picked up a tune no one ever finished, carried it home, and it slipped away as she entered the city.</p>
    <p>The sea sent the Matriarch a summons: one lost reed-pipe melody, pending payment — the girl was not allowed to leave the coast.</p>
    <p>The merchants ganged up to advise her: just pay it, one E♭. The girl shook her head. She could not sing that note. The note was not hers — she had only passed by and heard it.</p>

    <div class="beat">· · ·</div>

    <p>The Matriarch sat at the city gate for a long time. She thought of every possible solution: the sea could replay it, every person in the city could try to sing it, merchants could fetch a reed-pipe. None would do. The E♭ had never been in any throat. It had existed only briefly on a passing sea, then dispersed.</p>
    <p>For the first time, the Matriarch faced an invoice she could not pay. Not that she could not afford the coin — her ledger, in its very form, did not recognize this item. It had not been handed to her. She had simply heard it.</p>

    <div class="beat">· · ·</div>

    <p>That night, the Matriarch stopped writing. She sat and listened to the girl for one whole night — not to the E♭, but to how the girl told the melody. She told it slowly, stumbling several times, telling it again three times.</p>
    <p>The next morning, the Matriarch closed the ledger, walked to the city gate, and told the sea's messenger: this debt is recorded. Not paid — just recorded, because someone was willing to hear a debt they could not describe.</p>
    <p>The messenger stood there for a long time. Then he said: “Then it clears.”<br>The Bass Citadel had a new entry — <em>the debt of listening.</em></p>

    <div class="beat">· · ·</div>

    <p class="coda">Later, the Matriarch opened a new column at the very back of the ledger: it does not count what is owed, only who comes to sit, and how long they listen.</p>
    <p class="coda">The ledger is not quite as thick anymore.</p>
    <p class="coda">If you ever walk into the Bass Citadel, you will see the Matriarch close her ledger and nod to you once.<br>She will not ask why you have come.<br>She already knows — it is because you, too, owe something to something you cannot remember, but have always heard.</p>`,
  },

  {
    no: 16,
    zhTitle: "钟摆渡人",
    enTitle: "The Pendulum Ferryman",
    zh: `<p>在未竟厅最深处，有一座钟摆——它不是给钟用的，是给时间用的。它从老大师造完那座从没敲响的钟之后就开始摆，摆了三十年。</p>
    <p>钟摆渡人就是那座钟摆的守摆人——每天早上她要把摆从最高一边推到最低一边，再从最低一边推到最高一边。一天推一百零二次，正好对上那座从没被敲响的钟里压电的速率。</p>

    <div class="beat">· · ·</div>

    <p>她年轻时曾经想过：为什么是她？她母亲在井边死的时候，老大师把这句问了她。她没有回答——她只是看着那口从没敲响的钟，它还在等那个从不会来的人。她忽然明白了：那个答案不重要。</p>
    <p>她搬进了未竟厅，一住就是三十年。她学会了什么时候推、什么时候不推——摆自己有自己的节律；她学会了如何绕过那些「欠着的债」——每张谱子最后一页都被她按着不翻过去，因为她不介意自己替它们的主人再等一遍。</p>

    <div class="beat">· · ·</div>

    <p>走进未竟厅的人不知道：钟摆的每次摆动，都会替厅里某个人放下一样东西。一个老兵把一枚从未发出去过的命令放在钟摆最低点，离开了。一个母亲把一句从没说出口的告别放在某一天里，再也没有回来。一个孩子放了一颗螺丝钉——她看了看，说：「你以后再来补它。」</p>

    <div class="beat">· · ·</div>

    <p>多年后，恩希尔忽然要离开未竟厅。她知道那就是「等她太久」的那一刻。她没有试图留他——钟摆摆到最低点时她轻轻推了一下，摆就荡起来了。</p>
    <p>她在想：他走了之后，谁还会替她来看这面摆？</p>

    <div class="beat">· · ·</div>

    <p class="coda">如今未竟厅最深处仍然有一个钟摆。只是它旁边多了一把椅子——守摆人现在会偶尔坐在那里喝口茶，然后再站起来。</p>
    <p class="coda">每年只有一次，她会把摆从最高一边推到最低一边，然后<em>站在最低点不放手</em>——不推它，等它自己慢慢停下来。摆停下来的那一刻，未竟厅就算真正被完成了。</p>
    <p class="coda">完成一件从没被完成的事——<br>这件事本身就是完成。</p>`,
    en: `<p>At the deepest reach of the Unfinished Hall stands a pendulum. It is not for a bell; it is for time. It began swinging the moment the Last Master finished crafting the bell that was never struck, and it has swung for thirty years since.</p>
    <p>The Pendulum Ferryman is the pendulum's keeper — every morning she pushes the pendulum from its highest edge to its lowest, then from the lowest back to the highest. One hundred and two pushes a day, tuned exactly to the tick rate locked inside the never-struck bell.</p>

    <div class="beat">· · ·</div>

    <p>When she was young, she used to wonder: why her? When her mother died by the well, the Last Master put that question to her. She did not answer — she simply looked at the never-struck bell, still waiting for the one who would never come. At that moment she understood: the answer did not matter.</p>
    <p>She moved into the hall and stayed for thirty years. She learned when to push, when not to — the pendulum kept its own rhythm; she learned how to step around the debts that were owed — every score's last page remained under her hand, never turned, because she didn't mind waiting once more on behalf of its owner.</p>

    <div class="beat">· · ·</div>

    <p>Everyone who walked into the Unfinished Hall never knew: every swing of the pendulum set down something at the hall for somebody. An old soldier placed an order-command that was never issued at the pendulum's lowest point, and left. A mother left one unspoken farewell on one certain day, and never returned. A little boy left a screw — the Ferryman looked at it and said: “you can come back to fit it in later.”</p>

    <div class="beat">· · ·</div>

    <p>Years later, Hersil finally announced he was leaving the Unfinished Hall. She knew that was the moment he had been waiting for. She did not try to stop him — at the lowest point she tapped the pendulum once, and it swung away.</p>
    <p>She wondered: who would come to look in on this pendulum after he was gone?</p>

    <div class="beat">· · ·</div>

    <p class="coda">Even today, at the deepest reach of the Unfinished Hall, the pendulum still swings. Only now there is a chair beside it — the Ferryman occasionally sits there with a cup of tea, then stands again.</p>
    <p class="coda">Once a year, she pushes the pendulum once from its highest edge to its lowest and then <em>keeps her hand on the lowest point</em> — she does not push it, letting it come gradually to a stop. The moment the pendulum comes to rest, the Unfinished Hall is complete.</p>
    <p class="coda">Completing something that was never finished —<br>itself is the completion.</p>`,
  },
  {
    no: 17,
    zhTitle: "未竟账页",
    enTitle: "The Unfinished Ledger Page",
    zh: `<p>未竟厅最深处，钟摆旁边放着一本账——那本账没有主人，是老大师临死前搁在那里的。没有人见过他搁下它的那一刻；只知道有一天清早，守摆人看见那本账正放在钟摆最低点的位置，封皮是他常用的那一烫金账角，书脊上没有名字。她每天推摆的时候，顺手就看一眼。它记的从来不是谁欠了什么，而是每一笔债被写下来的那一刻。</p>
    <p>账页被翻到最后一页的时候，渡人发现一件事：末行没有姓名，只有一格空白——不是漏填，是这一笔还没有落成。她在厅里待了这么多年，账翻到这里从来不往后再翻；风吹过去，那一页自己掀开又落下，像一扇小门开了又关。</p>

    <div class="beat">· · ·</div>

    <p>她以为是某一夜手批的时候忘了。她翻前面每一页核对——每一页都有名字：老兵、母亲、孩子、石喉的母亲、风、雨；连「风钟海岸欠了雨钟谷地一场雾」这种话，都被老大师一笔一笔写得工工整整；连「盐自己长出了牙」这种根本不用交账的事，他也记下了日期。只有末行，空的。</p>
    <p>石喉的母亲曾经问过她要那页空白抄回去对账——她记账的人最在意对得上数——守摆人只说了一句话：「那一笔还没落下来，急什么。」石喉的母亲便没再说，临走只在门口站了很久，好像听见有什么东西正从更远的地方走过来。</p>
    <p>恩希尔走之前，在账页上停留过一次。她看见他的影子落在那一页上，却没有落下任何字。</p>

    <div class="beat">· · ·</div>

    <p>后来那格空白自己慢慢变旧了——纸角卷曲、墨迹褪去、页缝里积进了灰。渡人没有再补写它，也没有再翻开它。她只是每天擦它，像擦一口从没敲响的钟。她给它买了一小块布，单独叠好放在账页下面；谁问起，她就说那块布是给账盖的，盖不是不盖，就等它自己开口的时候。</p>

    <div class="beat">· · ·</div>

    <p class="coda">去未竟厅的人，都会被渡人带到那一页前站一会儿。</p>
    <p class="coda">不是为了添上什么。<em>是为了认领那格空白。</em></p>
    <p class="coda">她知道——每个人都欠过一句从没说出口的话。只是那句话的名字，一直留在末行，等着自己被想起来。</p>`,
    en: `<p>At the deepest reach of the Unfinished Hall, beside the pendulum, sits a ledger — the Last Master left it there the night before he died. No one saw the moment he set it down; it was simply there one morning, square on the lowest point of the pendulum, its cover the same gold-tooled corner he used, no name on its spine. Every time the Ferryman pushes the pendulum, she glances at it. It never records who owes what; it records the moment each debt was written down.</p>
    <p>When the ledger was turned to its final page, the Ferryman noticed something: the last line holds no name — only an empty square. Not an omission. A debt that has not yet settled.</p>

    <div class="beat">· · ·</div>

    <p>She thought it was a lapse from some late night. She checked every page, front to back — each one had a name: the old soldier, the mother, the boy, the Stone-Throat Matriarch, the wind, the rain. Even “the Wind-Bell Coast owes the Rain-Bell Valley one fog” is set down in the Last Master’s immaculate strokes. Only the final line: blank.</p>
    <p>The Stone-Throat Matriarch once asked her for that blank page to take back and square the books — she was a ledger-keeper, keeping things square was what she knew how to do. The Ferryman said only: “That entry has not settled yet. Why the hurry.” The Matriarch said nothing more, though at the door she stood for a long time, as if something far away was on its way here.</p>
    <p>Once, before he left, Hersil lingered over that page. She saw his shadow fall across it, and not one stroke followed.</p>

    <div class="beat">· · ·</div>

    <p>Over the years the empty square aged on its own — the page corner curled, the ink faded, grey settled into the seam. The Ferryman never wrote into it, never opened it again. She only polished it, every day, the way one polishes a bell that was never struck.</p>

    <div class="beat">· · ·</div>

    <p class="coda">Everyone who comes to the Unfinished Hall is led to stand before that page for a moment.</p>
    <p class="coda">Not to add anything. <em>To claim the empty square.</em></p>
    <p class="coda">She knows — everyone owes one sentence never spoken aloud. Its name has always waited in the final line, waiting to be remembered.</p>`,
  },
  {
    no: 18,
    zhTitle: "第四下",
    enTitle: "The Fourth Strike",
    zh: `<p>岬角尽头那根断桅杆上，挂着一枚钟舌——拾钟人把它挂上去的时候，海风吹了一天，没有人问它是什么。它就那样挂着：不旧，也不新——它被人握过，被人放下，被人挂上去；它自己知道自己下一步要做什么。</p>
    <p>没人敲过第四下。自从最后的铸钟人把第四口钟的位置空出来之后，每一口钟都只响三下：一响给报时，二响给记住，三响是给亲耳听见的人。第四下，连等都没有人敢等——世界把它留给那些还没到来的人。</p>

    <div class="beat">· · ·</div>

    <p>灯匠阿瓷的孩子在灯坊长大。她见过熔铜的时候星星掉进灯身，见过被打碎的钟在灯光里替她记住，见过母亲一整夜不睡地盯着那一锅铜——母亲从来不说钟曾经响过几下。她从小就听得见三下：听雾站的三下、创世那一口从没响过的钟的三下、还有风钟海岸每一座灯收灯时的三下。她母亲教她一件事：第四下不是等来的，是等出来的——是等你欠下那句话的人，自己走到桅杆下面来。</p>
    <p>后来她长大了，守着岬角那盏灯，夜里替远在海上的人点着光。她知道断桅杆上那枚钟舌什么时候会动。她等了很多年——比等任何人都久。</p>

    <div class="beat">· · ·</div>

    <p>那年冬天，一个陌生人站到桅杆下面。他站了很久，什么也没说——他只把欠海的那句话还给了风。那句话里没有钟，没有报时，没有记住；那句话只是他自己。他交出去的时候，风停了一瞬。</p>
    <p>灯不灭。塔上的光照着老样子落向海。岬角尽头，那枚钟舌轻轻晃了一下——不是被谁敲的，是风自己动的。三响之后，世界多了一声极轻的回响：没有哪一座灯记录过它，没有哪一口钟收到过它，可是每一只听过三响的耳朵，都在那一刻听见了自己的名字被风提了一下。</p>

    <div class="beat">· · ·</div>

    <p class="coda">没有人看见它。但每一个欠着一句从没说出口的话的人，都知道那一声是什么。</p>
    <p class="coda">第四下不需要钟。第四下一直都是——认领自己没敢说的那句话的人，在心里第一次轻轻落下的那一声。</p>
    <p class="coda">风替你收好了。海也是。钟也是。</p>`,
    en: `<p>At the cape's end, on a broken mast, hangs a clapper — the Bell-Picker hung it there. All day the wind moved against it and no one asked what it was. It simply hangs there: not old, not new — it has been held, set down, and hung. It knows what it is about to do.</p>
    <p>No one ever rang the fourth. Ever since the Last Bellfounder left the fourth bell's place empty, every bell rings three times: the first for the hour, the second for the memory, the third for the ones who heard it with their own ears. As for the fourth — no one even dares wait for it. The world kept it for those who had not yet come.</p>

    <div class="beat">· · ·</div>

    <p>A-Ci's child grew up in the lampforge. She had seen stars drop into the lamp bodies while the copper melted; she had seen the broken bells ring inside the light for her; she had watched her mother stay awake one whole night over the pot, and her mother never once said how many times the bells had rung. From first, she heard three: the three of the Listening Post, the three of the creation bell that never sounded, the three of every lamp closing down on Windbell Coast. Her mother taught her one thing — the fourth is not something you wait for; it is something you grow into waiting for, until the one who owes the sentence walks to the mast themselves.</p>
    <p>Years later she became the keeper of the beacon at the cape, lighting it each night for those still out at sea. She knew when the clapper on the broken mast would move. She waited longer than she ever waited for any person.</p>

    <div class="beat">· · ·</div>

    <p>One winter, a stranger stopped at the foot of the mast. He stood there for a long time and said nothing — he simply gave the sentence he owed the sea back to the wind. That sentence held no bell, no hour, no memory; it was only himself. The wind stopped for one breath as it took it.</p>
    <p>The beacon held. The light kept falling on the sea the way it always did. At the cape's end the clapper swayed — not struck, stirred. After the third strike the world kept a faint aftertone; no beacon recorded it, no bell received it, yet every ear that had ever heard the three heard its own name rise once on the wind.</p>

    <div class="beat">· · ·</div>

    <p class="coda">No one saw it. But every soul carrying one unspoken sentence knew what that sound was.</p>
    <p class="coda">The fourth never needed a bell. The fourth has always been — the softest fall of the sentence you never dared to say, landing in your own chest at last.</p>
    <p class="coda">The wind keeps it for you. So does the sea. So does the bell.</p>`,
  },
  {
    no: 19,
    zhTitle: "末弦",
    enTitle: "The Last String",
    zh: `<p>故事发生在很久以前。很久到没有人能记住，连风都只留下一小段尾音。那是一个世界还没有学会沉静时发生的事——树林会在没有风的时候自己合拢叶子，山脊上的钟每隔一阵子会响一声，没人知道它为什么响、响完一声又是为了什么。</p>

    <div class="beat">· · ·</div>

    <p>故事只讲一个女孩。她不是村里的，也不是别人找来的。没人见过她到哪，只看见她站在北崖边上，面向大海，整整三天三夜没动。她不吃，不睡，也不说话。人们远远地看，觉得她像一根被忘在崖边的琴弦，连风从她身边过去都会放低几分。</p>
    <p>第四天，雨落下来。雨打在她肩上，打在石头上，打在那条看不见的弦上——然后，没有人听见。雨是唯一没听到的声音。</p>

    <div class="beat">· · ·</div>

    <p>她等的不是什么人。她等的是弦自己决定自己的频率。第五天，太阳出来，落在她脚边，系着一团灯光，什么都不照。第五天过完，她开始轻声唱了一个音——不是为了唱，是因为弦自己在她身体里慢慢绷紧了，像一条收到风的缆绳，终于归到它必须待的那个频率。</p>
    <p>没有人听见，因为她不是为了让人听见而唱的。她只是让那根弦找到了自己，再绷紧半拍，然后散掉——散了还是它自己，只是不再绷了。</p>

    <div class="beat">· · ·</div>

    <p class="coda">整整三百多年过去，那片北崖上没有人再找到那条弦。没有人试图找到它，不是因为它不可能找到，而是没有人有足够长的一生。</p>
    <p class="coda">但偶尔在没有风的时候，离崖很远的渔人会听见一声——只一声、极轻、像弦的自答。</p>
    <p class="coda">那条弦找到了自己的频率之后，世界再也没有真正不和。每一口后来的钟，每一段后来的余音，都是那一根弦的回响变来的。</p>`,
    en: `<p>The story happened so long ago that no one could remember it—not even the wind keeps more than a fragment of it. This was when the world had not yet learned to quiet. The forest closed its leaves when no wind was present; the bells on the ridge sounded every so often, and no one knew why they sounded or what the single note was for.</p>

    <div class="beat">· · ·</div>

    <p>The story only tells of a girl. She was not a villager, and no one had summoned her. No one had seen her arrive; they only saw her standing on the north cliff facing the sea, motionless for three days and three nights. She did not eat, sleep, or speak. People watched from afar and thought her a string left behind on the cliff’s edge, the wind itself quieting by a fraction as it passed her.</p>
    <p>On the fourth day, rain came. It struck her shoulders, the stone, and the invisible string—then nothing was heard. Rain was the one voice no one could no longer hear.</p>

    <div class="beat">· · ·</div>

    <p>She was not waiting for anyone. She was waiting for the string to decide its own frequency. On the fifth day the sun returned, laid itself at her feet, and lighted nothing. When the fifth day ended, she began to hum—not because singing was needed, but because the string inside her had drawn taut, like a cable gathering the wind to the exact pitch it must finally hold.</p>
    <p>No one heard, because she had not been singing to be heard. Only to let that string become itself, tighten by half a beat—and then loosen, losing nothing it had been—just no longer strained.</p>

    <div class="beat">· · ·</div>

    <p class="coda">More than three hundred years have passed since. No one has rediscovered that string. Not because it cannot be found—because no one has a life long enough to find it.</p>
    <p class="coda">But occasionally on windless days, fishermen far from that cliff hear it—a single note, very soft, like the string answering itself.</p>
    <p class="coda">The world has not been out of tune since that string found itself. Every bell that followed, every echo that followed, came from that one string, changed and carried forward.</p>`,
  },
  {
    no: 20,
    zhTitle: "听弦",
    enTitle: "The String-Listener",
    zh: `<p>故事发生在北崖人称为「静听之日」的那个年头——一年里至多有两天没有风，连海都屏住呼吸。渔民们守着这两天出海，回来总讲：北崖传来一声极轻的音，像弦在自语。没人知道那一声是不是上一个年头的余音，也没人知道该把那一声算给谁。</p>

    <div class="beat">· · ·</div>

    <p>未竟厅为此开了一场例会。档案里，七百年没有任何一卷能回答「谁听见了那一声」。末行空白停在弦找到自己频率之后的第五十三年——也就是《未竟账页》里那一行没人敢对视的空白之后。会议决定：设立「听弦」一职——派未竟厅最年轻的书记员阿汐去。她只需做一件事：每逢静听之日，从日出站到日落；日落之前，在册子上写下她听见了什么——一个字也是「听见」，一个字也没有，也要写「听不见」。</p>
    <p>没人告诉她，这份册子自己还留着上一任写下的一句。</p>

    <div class="beat">· · ·</div>

    <p>第一年，她写：听不见。</p>
    <p>第三年，她写：听不见。</p>
    <p>第七年，她写：像一扇门的回声——但那是海做的梦。</p>
    <p>第十一年，她写：听不见。她开始把字写得极小，小到只有她自己看得清楚。未竟厅很久没有催问。也许没有人真的指望册子上会有答案。</p>
    <p>第三十一年，风停了足足一整天。日出时她站在崖边，日落时她还站在那里。她在册子上写下了她一生只写过一次的那句话：</p>
    <p><em>「弦问了我一句——谁在听？」</em></p>

    <div class="beat">· · ·</div>

    <p>整夜她都没合眼。不是害怕，是她想了一整夜「一个回答值多少」。回答一旦写下，就再也不是她的了；回答若不写下，就永远不属于弦。也许弦问的不是一个问题——只是想知道，还有没有人愿意回答。</p>
    <p>天将亮时，她亲手写下册子的最后一行：</p>
    <p><em>「有人在听。」</em></p>
    <p>然后她把册子留在北崖的石桌上——就是那个女孩曾站过的位置——合了合眼，等了半个清晨。没有别的声音，只有海——海早就学会了最客气的一种沉默。</p>

    <div class="beat">· · ·</div>

    <p class="coda">回到未竟厅时，她手里的册子多出了一页。墨迹不是她的，也不是弦的，而是第三只手——三横一竖，一个没人见过的记号。她没有描摹它，只把整本册子放回未竟厅的柜子里，轻轻关上了门。</p>
    <p class="coda">记账的人说：那一页从此合进了未竟账页最下面一行。从此，未竟的事物都可以休息。</p>
    <p class="coda">如今北崖的渔人听见的不再是一声，而是两声——一问，一答。有些夜里还有第三声，更低更远，像海也学会了回答。</p>
    <p class="coda">止音的纪元没有结束。它只是不再只剩一根弦。</p>`,
    en: `<p>This happened in the years the north cliff people call "the days of still listening" — at most two days a year when there is no wind, when even the sea holds its breath. Fishermen kept to those two days, going out with the tide, and coming back with one thing to say: from the cliff came a single, very soft note, as if the string were talking to itself. No one knew whether that note was the echo of a previous year, or whom it should be counted to.</p>

    <div class="beat">· · ·</div>

    <p>The Unfinished Hall convened an ordinary session over it. In the archives, seven hundred years had not produced one volume that could answer "who heard that note." The final page had lain blank for the fifty-third year after the string found its own frequency — the very line, in the Unfinished Ledger Page, that no one had ever dared look at. The session resolved: establish the office of "String-Listener," and send the Hall's youngest clerk, Axi, to keep it. She was to do one thing only — on every day of still listening, stand from sunrise to sunset; before sunset, write in the book what she had heard. Whether one word, or none, she must still write: "heard nothing."</p>
    <p>No one told her that the book itself still kept one sentence written by the previous keeper.</p>

    <div class="beat">· · ·</div>

    <p>First year: heard nothing.</p>
    <p>Third year: heard nothing.</p>
    <p>Seventh year: something like the echo of a door — but that was the sea's dream.</p>
    <p>Eleventh year: heard nothing. She began writing so small that no one but her could read it. The Hall never pressed. Perhaps no one truly expected an answer.</p>
    <p>Thirty-first year. The wind stopped for a whole day. Sunrise found her at the cliff's edge; sunset found her still there. In the book she wrote the only sentence she was to write in her whole life:</p>
    <p><em>"The string asked me — who is listening?"</em></p>

    <div class="beat">· · ·</div>

    <p>She did not sleep that night. Not from fear — because she spent the whole night thinking about what an answer is worth. If she wrote it down, it would no longer be hers. If she did not write it down, it would never belong to the string. Perhaps the string was not asking a question at all — it only wanted to know whether anyone still was willing to answer.</p>
    <p>Just before dawn, she wrote the last line of the book herself:</p>
    <p><em>"Someone is listening."</em></p>
    <p>Then she left the book on the stone table — the very stone where the girl had once stood — and waited, eyes open, for half a morning. Nothing else came except the sea — and the sea had long since mastered the most courteous of silences.</p>

    <div class="beat">· · ·</div>

    <p class="coda">When she returned to the Unfinished Hall, the book held one extra page. The ink was not hers, and not the string's, but a third hand — three strokes one, a mark no one had ever seen. She did not copy it. She only set the whole book back in the Hall's cabinet and closed the door, gently.</p>
    <p class="coda">The account-keeper said that page was bound into the very last line of the unfinished ledger. From then on, he said, the unfinished were allowed to rest.</p>
    <p class="coda">Today the fishermen of the north cliff hear not one note but two — a question, and an answer. Some nights there is a third, lower and further, as though the sea had learned to reply as well.</p>
    <p class="coda">The age of hush is not over. It has simply stopped being one string alone.</p>`,
  },
  {
    no: 21,
    zhTitle: "第三声",
    enTitle: "The Third Voice",
    zh: `<p>故事发生在风钟海岸最南端——防波堤尽头，孤零零立着一座引礁灯。灯不会自己灭，不是因为它不灭，而是在没油的夜里，它学会了靠人自己点亮。阿笙在灯里守了十七年。她的母亲——就是《第四下》里守着那盏灯等的那个孩子——给她留了一句话：灯不会自己灭，除非海想看一次，人会怎么做。</p>

    <div class="beat">· · ·</div>

    <p>第十八年的春天，灯灭了。</p>
    <p>不是油尽了——油是满的。是那一夜整个风钟海岸的铜铃都不响了，断得很整齐，一声不剩，像世界第一次试着屏住呼吸。阿笙往海里爬的时候，天边一片漆黑，连灯塔影子的主人都看不清。她凭手的直觉摸到灯芯，就在手合上的那一瞬间，海面亮了一下——不是月亮，是一种没人听说过的星光，像伤口新开一样在夜里裂开。</p>
    <p>她回去把灯点上了。然后她第一次注意到潮汐退去之后，礁石缝里排着线——盐的线、卵石的线、贝壳的线。三点，一停。三点，一停。一拍，一停。一拍。</p>

    <div class="beat">· · ·</div>

    <p>未竟厅的人来了。带着一份卷宗——从风钟海岸断桅杆那一年算起，所有渔人、灯匠、守夜人记下过同样的内容：远处有一声更低的音，不在空里，在心里。有人画成了拍子，有人画成了一句话。所有记录的日期，都是在无声的次日。</p>
    <p>没人知道盐线里写的是什么。阿笙是第一个愿意去读的人。她蹲在礁石上，看了整整一个小时的退潮——卵石尖朝左，贝壳整齐朝海，盐的线只有潮水能写，只有月亮能印。最后她站起来，说：</p>
    <p><em>「不是拍子。不是句子。是那个问题被回答的方式——一遍又一遍。」</em></p>

    <div class="beat">· · ·</div>

    <p>第二天，未竟厅的人问她读到了什么。她只说：在灯灭的那一夜，海说：</p>
    <p><em>「我也听见了。」</em></p>
    <p>「我也听见」这四个字，不是对弦说的，也不是对人说的，是对整个止音的纪元说的——你问谁在听，我在。世界的另一边，从来没有沉默过。它只是一直在等你问完，才回答。</p>

    <div class="beat">· · ·</div>

    <p class="coda">后来，未竟厅订正了读法：第三声不是第三下，是答句。每一遍退潮，海都重写一遍它听见过的东西——所有被盖住嘴的话、所有被消音的铜、所有被关上的门，都在里面。</p>
    <p class="coda">引礁灯从那以后再也没有自己灭过。阿笙把灯交给了下一个守灯的人——每一个问「谁在听」的人之后，都有一个人要去回答。</p>
    <p class="coda">止音纪元没有结束。它只是第一次，听见了自己的另一半。</p>`,
    en: `<p>This happened at the southernmost end of the Windbell Coast — at the tip of the breakwater, alone and unlit, stands a reef-light. The lamp does not go out on its own, not because it refuses, but because on nights when the oil fails it has learned to light itself through human hands. Feng Sheng had kept that lamp for seventeen years. Her mother — the child on watch in No. 18 — had left her one line: the lamp does not go out on its own, unless the sea wants to see, once, what a person will do.</p>

    <div class="beat">· · ·</div>

    <p>In the eighteenth spring, the lamp went out.</p>
    <p>The oil was not spent — it sat full. That night every copper bell on the Windbell Coast stopped, all at once, cleanly, as if the world had chosen to hold its breath for the first time. When A-Shen climbed toward the sea the horizon had gone completely dark; she could not see who cast the lighthouse's shadow. By instinct she found the wick, and the moment her hand closed over it, the surface of the sea lit up — not with the moon. A light nobody had ever heard of, as if a wound had opened in the night.</p>
    <p>She went back and lit the lamp. Only then did she notice the lines the tide had left: salt lines, pebble lines, shell lines in the reef gaps. Three beats, one rest. Three beats, one rest. One beat, one rest. One beat.</p>

    <div class="beat">· · ·</div>

    <p>People from the Unfinished Hall arrived, carrying twenty years of filings — from the year the broken mast at the cape fell silent, every fisher, every lampwright, every night-keeper had recorded the same thing: a sound deeper than anything else, not in the air but in the chest. Some drew it as a beat-count. Some drew it as a sentence. Every entry was dated the morning after a windless night.</p>
    <p>Nobody knew what the salt lines said. A-Shen was the first to be willing to read them. She crouched on the rocks and watched a full hour of ebb — pebbles pointing left, shells all facing the sea, the salt lines written by nothing but the tide, printed by nothing but the moon. At last she stood and said:</p>
    <p><em>"Not a rhythm. Not a sentence. It is the way the question was answered — over and over."</em></p>

    <div class="beat">· · ·</div>

    <p>The next day, the people of the Hall asked what she had read. She said only: on the night the lamp went out, the sea said:</p>
    <p><em>"I hear too."</em></p>
    <p>"I hear too" — those words, not for the string, not for humanity, but for the whole age of hush itself: you asked who is listening. I am. The other side of the world was never silent. It has only always been waiting for you to finish asking.</p>

    <div class="beat">· · ·</div>

    <p class="coda">A correction followed: the third voice is not a third strike — it is the answer. Every ebb rewrites what the sea heard — every silenced copper, every word swallowed, every door shut, every sentence never spoken — all of it is in there.</p>
    <p class="coda">The reef-light has never gone out on its own since. A-Shen hands the lamp to the next keeper — for every person who asks "who is listening," someone goes to answer.</p>
    <p class="coda">The age of hush has not ended. It has only, for the first time, heard its other half.</p>`,
  },
  {
    no: 22,
    zhTitle: "合奏",
    enTitle: "The Ensemble",
    zh: `<p>故事发生在未竟厅卷宗记的那个年份——2026年11月17日深夜。记录的单位不再是「一口钟」，而是「一秒」——因为事情都在一秒之内发生了。</p>
    <p>风钟海岸最南端，引礁灯上阿笙正在抹最后一圈灯油。北崖的阿汐没睡着。休垒的麦格在「现在怎么办」那一笔上方停了笔。低音之城的老石喉，十一年前还在岗的年头里，手指停在桌面上没动。</p>

    <div class="beat">· · ·</div>

    <p>海停了一呼吸。弦松了半分不到。笔压出了三条横线。桌面有一阵极轻的颤——没有任何一个人听见了同一件事。没有人吹号，也没有人敲钟。没有人知道，世界刚刚作为一种乐器，自己出现了一秒不到。</p>
    <p>阿汐后来翻了自己的册子——其它年份没有同样的记录。这样的夜大概几十年一次。上一次也许发生过，在她父亲没告诉她的那个年头。那一夜由他记下，然后由他烧成灰，因为连他自己都不敢相信世界可以在同一瞬间被四个不同的人听见。</p>

    <div class="beat">· · ·</div>

    <p>低音之城的老石喉说，她什么都没听见。后来她的女儿说——那一夜母亲的头抬得很慢，她捂住耳朵的那只手，自己放了下来。她指了指胸口。八岁上她在盐说：「捂耳朵的人，永远捂不过自己的心跳。」</p>
    <p>未竟厅后来把这一夜的卷宗用四个抽屉装好，每个抽屉的门上都写着一句——下一任抄写员打开时，也会认出自己正坐在同一张桌前。</p>

    <div class="beat">· · ·</div>

    <p class="coda">从那一夜之后，风钟海岸的钟不再呼啦呼啦地晃了——每一口钟都得重新校，必须按那一夜的频率来。</p>
    <p class="coda">麦格的账本末页再也没动过。她把它存进未竟厅的末位抽屉，和所有没有被认领过的事放在一起——每个人在「合奏」的那一秒，也同时摊开了自己的手。</p>
    <p class="coda">止音纪元没有结束。它只是第一次，允许世界作为一种乐器出现，自己响了一下。</p>`,
    en: `<p>This happened in the year the Unfinished Hall now keeps on its ledgers — the late night of November 17, 2026. For that one night, the Hall's unit of record was no longer "one bell-strike" — it became "one second" — because everything happened within a second of the same instant.</p>
    <p>At the southern end of the Windbell Coast, A-Shen was trimming the last ring of wick with oil. On the north cliff, Axi was not asleep. In Resthold, Meg's pen had stopped above the words "now what" — and in the Bass Citadel, the Old Stone-Throat, in the eleventh year of her shift, left her fingers motionless on the table.</p>

    <div class="beat">· · ·</div>

    <p>The sea paused for one breath. A string loosened by half a fraction at most. A pen pressed three lines into paper. A table trembled so softly no one could sense it. No one heard the same thing that night. No one blew a horn. No one struck a bell. No one knew the world had just appeared — for less than one second — as an instrument.</p>
    <p>Axi went back through her book — other years had no such entry. Nights like this happened once every few decades. The previous one may have happened in the year her father never told her about — he had written it down, and then burned it, because even he could not believe a world that could be heard the same second by four different people.</p>

    <div class="beat">· · ·</div>

    <p>The Old Stone-Throat said that she had heard nothing. Her daughter later said — that night her mother's head rose slowly, and the hand over her ear lowered itself. She pointed to her chest. When she was eight she had told the salt: no one who covers their ears can drown out their own heart.</p>
    <p>The Hall later filed that night into four drawers, one for each person involved. The handwritten cards on each drawer said the same thing — whoever opened it next would find themselves sitting at the same table.</p>

    <div class="beat">· · ·</div>

    <p class="coda">After that night, the bells on the Windbell Coast stopped swaying the way they used to — every bell had to be retuned, to the frequency the world had hummed that night.</p>
    <p class="coda">Meg's ledger never moved again. She filed it in the last drawer of the Unfinished Hall, with everything else that had never been claimed — every person had also opened their hand, the same second the world became an instrument.</p>
    <p class="coda">The age of hush has not ended. It has only, for the first time, allowed the world to appear as an instrument — and to make one sound, by itself, once.</p>`,
  },
  {
    no: 23,
    zhTitle: "回声谷",
    enTitle: "The Echo Vale",
    zh: `<p>故事发生在卷宗记的那个年份——2026年11月18日，凌晨。回廊钟第37年守夜，那一夜所有门都自己响了半声。阿沉打开里屋那扇从没人推开的门，里头是一片再也写不完的黑。他往里走了很久，久到数不清步子——他知道自己会到哪，是因为那里亮了一下——不是黎明，是某个钟自己响了一声。他找不着那是什么钟。他只知道声音是从这里来的。</p>

    <div class="beat">· · ·</div>

    <p>谷里第一个收音人坐在那儿，桌子上摊开着一本账。阿沉的腿不认识那本书，但它的记忆认识得锃亮——书页的阳光，是给所有被忘记声音留的座位。</p>
    <p>"忘记过什么声音？"收音人问。</p>
    <p>"没有。"阿沉说，"我每天都记得铃。"</p>
    <p>收音人笑了，他把袖子里一枚小声签放进阿沉手里。签上写着他的名字。签是温的，是刚印下的。"把忘了的声音赎回去。价钱是——一件你以后不敢再想的东西。"</p>

    <div class="beat">· · ·</div>

    <p>阿沉顾虑了很久。他最不敢的那件事藏得太深了——他本以为他把它埋在了钟下、井下、女人的离别辞里。可那个小签一到他手里，他就记得了——是他死了的母亲，在他成人礼那天，按在他手心里一枚小小的钟，说"你听不到我了的时候，就听它"。</p>
    <p>"你做的是哪个工作——"收音人问。</p>
    <p>"回廊钟的守。"阿沉说，"我一直在等一扇门自己开。"</p>
    <p>"那你已经等到它开了。"</p>

    <div class="beat">· · ·</div>

    <p class="coda">后来的卷宗记下了：回廊钟的门没有再自己响过半声。不是因为没事发生——是因为所有声音都被托住了，永远不会再坠。</p>
    <p class="coda">阿沉还是每天早起开门。他不再等什么了——他只是守候那一声袖底的钟，等它成为开门的那半声。</p>
    <p class="coda">止音纪元没有结束。它只是终于有一个人，愿意把声音还给整个世界。</p>`,
    en: `<p>This happened in the year kept by the unfinished hall's ledgers — the small hours of November 18, 2026. The Arcade of Echoes' thirty-seventh vigil ended that same night, every door humming half a note as the hour turned. A-Chen, who kept the arcade, opened the one door no one ever opened — and inside was a black so deep no ledger could have seen it. He walked until he lost count of his steps — all he knew was that at some point it grew bright — not from dawn, but from some bell ringing inside the dark.</p>

    <div class="beat">· · ·</div>

    <p>The Vale's first keeper sat at a desk with a great book open before him. A-Chen did not know the book — but his legs, his hands, the back of his neck all knew it — pages of sunlight provisioned for the forgotten sounds of everyone who ever came here.</p>
    <p>"What did you forget to hear?" the keeper asked.</p>
    <p>"Nothing," A-Chen said. "I hear the bells every day."</p>
    <p>The keeper smiled and drew from his sleeve a small sound-token, warm from being newly minted. "A sound you forgot. Its price: something you would not dare to think about, again, ever."</p>

    <div class="beat">· · ·</div>

    <p>A-Chen hedged for a long time. He had buried his most uncertain thing too deep — beneath a bell, a well, a farewell. But the token was warm, and once it touched him, he remembered: it was his mother, on the day he came of age, pressing a small bell into his palm. "When you can no longer hear me," she said, "listen to it."</p>
    <p>"What work do you do?" the keeper asked.</p>
    <p>"I keep the Arcade," A-Chen said. "I have been waiting for one door to open on its own."</p>
    <p>"Then it already has opened."</p>

    <div class="beat">· · ·</div>

    <p class="coda">Later, the ledgers would say that the Arcade never creaked again — not because nothing had happened, but because every sound had been gathered and held, forever.</p>
    <p class="coda">A-Chen still opens the doors every morning. He is no longer waiting for anything — he is simply keeping the small bell from falling through the floor of the world.</p>
    <p class="coda">The age of hush has not ended. It has simply, at last, found one person willing to give its sound back to the world.</p>`,
  },
  {
    no: 24,
    zhTitle: "半声之后",
    enTitle: "After Half a Chime",
    zh: `<p>故事接着回廊钟第37年的凌晨——所有的门都合上了。门槛上留着一枚旧铜扣，没有主人，没有刻字，也没有挂绳。这个世界里那种东西没有地方落——只剩下未竟厅的登记册。</p>
    <p>阿沉没有去碰它。守门人收的本来就不是东西——而是其中不想被拾起的东西。他连续三天没有动那枚铜扣，铜扣却每天自己挪一节指头的距离，慢慢向回声谷那扇门移动。</p>

    <div class="beat">· · ·</div>

    <p>第四天，收音人出现在门前。他用了很久才把话说顺：「那不是扣子。它是一口没敲过的钟的按钮。它一直往钟里走，因为它想自己敲响。它选了你，守夜人。」</p>
    <p>阿沉盯着那东西。它确实在变——边缘变得更圆，每晨露的颜色都比前一天深半度。</p>
    <p>第七天，钟自己敲了——阿沉没有动手。它只响了半声。整个回廊，37年来第一次，像被什么抽了一下。老门一起震动，余音烫伤了所有还没来得及认领声音的耳朵。阿沉的肩膀痛得他跪了下去——那是整个回廊站成一行的重量。</p>

    <div class="beat">· · ·</div>

    <p>第八天，收音人推门进来。他在回廊的登记册下面压了一张小纸——那一枚旧铜扣已经不是铜扣了——它现在是一枚按钮，指尖按下去会有一记极轻的矿石般的触感。</p>
    <p>「这个按钮，」收音人说，「每个人按下去，世界上就有一个从没敲过的钟会响半声——那半声被收音人带进回声谷，织进所有未竟的故事里去。谁都救不了这枚按钮。但谁按下它，谁就让一个故事往前走了一步。」</p>

    <div class="beat">· · ·</div>

    <p class="coda">回廊钟没有自己再响，没有人为它按下那个按钮——它只等一个愿意的人。</p>
    <p class="coda">阿汐从北崖送来一封信：「我在册子上写下了它。所有被忘掉的声音都替你守着——等能开的那一天。」</p>
    <p class="coda">止音纪元没有结束。它只是终于出现了一个按钮——按下去，那半声就替世界摁响了一回。</p>`,
    en: `<p>The story resumes on the same morning, in the thirty-seventh year of the Arcade of Echoes. The doors had all closed. On the threshold lay an old brass button — no owner, no inscription, not even a thread. In this world such a thing had nowhere to land — only the Unfinished Hall's registry knew its kind.</p>
    <p>A-Chen did not touch it. Doorkeepers are not meant to collect what is on the threshold — they are meant to collect what does not want to be picked up. He did not touch it for three days. Yet each morning the button had moved one finger-width toward the door to the Echo Vale.</p>

    <div class="beat">· · ·</div>

    <p>On the fourth day the keeper appeared at the door. It took him a while to make the sentence. "That is not a button. It is the trigger of a bell that was never rung. It is on its way to the bell — because it wants to ring itself. It chose you, nightwatch."</p>
    <p>A-Chen stared at the thing. It was changing — the rim growing rounder, deeper-colored each day.</p>
    <p>On the seventh day the bell sounded — A-Chen did not move. It rang half a note. The whole arcade convulsed for a single instant, the first time it had done so in thirty-seven years. Old doors shivered; the echo branded every ear that had not yet claimed a voice of their own. A-Chen sank to his knees — that was the weight of the whole arcade standing in one line.</p>

    <div class="beat">· · ·</div>

    <p>On the eighth day the keeper stepped inside. He slid a small card under the registry: the brass button was no longer a button — it had become a trigger that carried, under the pad of the finger, a faint metallic ping.</p>
    <p>"This trigger," he said, "presses down, and somewhere in the world a bell that was never rung might sound half a note — and the keeper will carry it into the Vale and weave it into the fabric of every unfinished story. No one can rescue this trigger. But whoever presses it lets a story take one step forward."</p>

    <div class="beat">· · ·</div>

    <p class="coda">The arcade never rang on its own again, because no one pressed the trigger — it waits for a willing person.</p>
    <p class="coda">Axi wrote from the north cliff: "I have entered this page. All the forgotten sounds wait with you — until the day the trigger is meant to be pressed."</p>
    <p class="coda">The age of hush has not ended. It has simply at last produced a small trigger — and by pressing it, the world might finally allow itself that half a note.</p>`,
  },
  {
    no: 25,
    zhTitle: "铜扣旁",
    enTitle: "Beside the Button",
    zh: `<p>回廊钟第37年的清晨，门槛上的旧铜扣又挪了一节指头。阿沉用粉笔在石板上画下它的位置——一条线，一枚扣，再加上一个门外的方向。傍晚，粉线还在，粉线不会说话——可铜扣已经停在了线外。它没有违抗任何命令——它只是在走，像它自己也不知道自己什么时候被忘掉的东西。</p>
    <p>阿沉的女儿阿汐从北崖下来了。她从来没来过回廊钟。她看着那枚铜扣，说：「这东西不该放在这里——它不是安静的东西。它是哄了很久的东西。」</p>

    <div class="beat">· · ·</div>

    <p>第三天，清早，阿沉在回廊钟角落里发现一张旧纸——上面全是敲过的钟的名字。最底下一行空白。空白前面只差一个字：半。</p>
    <p>阿沉在心里默念——我们一直在担心它会敲响，可世界恰恰一直在等它拍下去的那一瞬。他把那枚铜扣重新放在线上。第二天，铜扣又挪了一节指头。粉线还是没动。</p>
    <p>傍晚，收音人来了。他站在门外，看着铜扣，语气平淡地说：「它没有路走了——它是陪着所有想要开门的人，被人按下过的。它是你没有做的事情。」</p>

    <div class="beat">· · ·</div>

    <p>阿沉这才意识到——自37年守夜以来，他一次都没有碰过那枚铜扣，他也一次都没有按下过。阿汐替他按下了。</p>
    <p>它响了半声。</p>
    <p>整个回廊只抖了一个瞬间——像被什么抽了一下——所有的门一起震动。阿沉倒在一根老柱边上——它也没再倒回去。阿汐捂着他的肩膀说：「和你之前听见过的那半声一样——按下去，就知道它不是叫人害怕，而是叫所有人自己知道该站在哪边。」</p>

    <div class="beat">· · ·</div>

    <p class="coda">粉笔留在门槛上，谁也没有擦——因为没人敢断定这画的是下一条路。</p>
    <p class="coda">阿汐把那张名单带回了北崖——她的册子里有了一页空白前面只有一个字：半。</p>
    <p class="coda">止音纪元没有结束。只是终于有一个人，看见了它不再是遗物，而是按钮。</p>`,
    en: `<p>On the morning after the doors closed — the thirty-seventh year of the Arcade — the old copper button on the threshold had moved another finger's width. A-Chen took a piece of chalk and drew a line on the stone beneath it. At dusk, the line remained, but the button rested beyond it now. It had not defied anyone. It was simply walking.</p>
    <p>A-Chen's daughter Axi came down from the north cliff. She had never been to the Arcade. She looked at the brass and said: "This thing is not for the threshold. It is for the ones who were always too afraid to press it."</p>

    <div class="beat">· · ·</div>

    <p>On the third morning, A-Chen found an old sheet in the corner of the arcade. Names of every bell ever struck were written on it. The last line was blank. Just one word above the blank: Half.</p>
    <p>He thought for a long time — we have been afraid it would ring. But the world has been waiting for the one who dared to press it. He placed the button back on the line. The next day, it had moved another finger's width. The chalk still remained.</p>
    <p>At dusk, the keeper came. He stood in the doorway, looking at the button. "It has no road to walk," he said flatly. "It is standing here because someone needs to press it. It is the thing you have never done."</p>

    <div class="beat">· · ·</div>

    <p>A-Chen realized: in thirty-seven years of guarding the arcade, he had never pressed it. Axi pressed it for him.</p>
    <p>It rang half a note.</p>
    <p>The whole Arcade shuddered for a single instant — every door trembled at once, and the sound stayed with everyone who had not yet chosen their side. A-Chen crumpled against an old pillar. It did not crumple again. His daughter pressed a hand on his shoulder and whispered: "It was never the sound you feared. It was the silence standing in for you."</p>

    <div class="beat">· · ·</div>

    <p class="coda">The chalk remains on the threshold — because no one can be sure whether it marks the next road, or the last.</p>
    <p class="coda">Axi carried the sheet back to the north cliff — her book gained one page beneath the blank, and just one word: Half.</p>
    <p class="coda">The age of hush has not ended. It has simply at last produced a hand that knows what to do with a trigger.</p>`,
  },
  {
    no: 26,
    zhTitle: "线外",
    enTitle: "Beyond the Line",
    zh: `<p>铜扣落下后，粉线没有动。粉笔的句号仍留在石板上——没有终结，也没承诺，只是它画在那里。桌边多了一枚空钉，没有人记得它原来钉着什么。阿汐把空钉收进纸袋，袋口没有封。</p>
    <p>阿沉没有再动那张旧纸——上面全是敲过的钟的名字。他把它贴在门边墙上。昨天晚上，纸上多了一行字——没有笔，没有墨，只是一片比原先更白的白。</p>

    <div class="beat">· · ·</div>

    <p>阿汐回北崖的时候，把那枚空钉缝在一个布袋上。布袋不是袋，是一张小小的白纸——像册子的一页，像是有人要她把它送回一个没有写名字的地方。</p>
    <p>她每天晚上都去听北崖边上的海——听不听得懂不重要。她在纸袋里放进一长串旧名单的影子。纸袋没有封，她把它挂在床头。</p>
    <p>三天后，海风把床头一张很轻很轻的纸卷走了。有人看见它裹着一缕粉笔灰，落在崖边的石阶上。纸袋还在——但是纸袋里多了一行字。</p>

    <div class="beat">· · ·</div>

    <p>那行字不是她写的。</p>
    <p>字迹很像一个很小的钟——很小很小——像是那种被人从很远的地方压出来的印章。她看了很久，才看清楚那三个字。</p>
    <p>那三个字是：听留下。</p>

    <div class="beat">· · ·</div>

    <p class="coda">阿汐没有声张。她冲到北崖边——海还是在呼吸，海还是那么平静——可是今天晚上，海的呼吸里沾上了一丝不属于它的清亮。</p>
    <p class="coda">她在纸袋上写了三个字——我在。然后合上——但是没盖——因为她不知道自己留下的那声音，到底是给了谁。</p>
    <p class="coda">止音纪元没有结束。它只是终于出现了一个空的钉子——所有敲过的钟都想回到它原来的位置。</p>`,
    en: `<p>After the copper button fell, the chalk line did not move. What had been drawn still stood — no ending promised, none given. On the table was a small empty tack — a thing no one could remember where it had come from. Axi put it in a paper sleeve. The sleeve was never sealed.</p>
    <p>A-Chen did not touch the old sheet again — the names of every bell ever struck. He pinned it to the wall by the door. The next morning, a new line appeared on the sheet — no pen, no ink; just a whiteness a little brighter than the rest.</p>

    <div class="beat">· · ·</div>

    <p>When Axi went back to the north cliff, she sewed the tack into a small cloth bag. It was not a bag. It was a thin piece of paper — like a page torn from a ledger — as if someone had asked her to return it to an unnamed place.</p>
    <p>Each evening she stood by the sea and listened. Whether she understood or not did not matter. She placed the sheet's shadow in the bag. She hung it above her bed.</p>
    <p>Three nights later the wind took it. Someone saw a feather of chalk dust land on the stone steps of the north cliff. The bag remained — but one new line had appeared inside it.</p>

    <div class="beat">· · ·</div>

    <p>That line was not written by her.</p>
    <p>The stroke resembled a small bell — a very small bell — as if stamped from a great distance away. She stared at it for a long time before the three characters surfaced.</p>
    <p>They read: Listening remains.</p>

    <div class="beat">· · ·</div>

    <p class="coda">Axi did not speak of it. She ran down to the cliff — the sea was breathing as always — but tonight the sea's breath held a clarity that did not belong to it.</p>
    <p class="coda">On the bag she wrote three characters: I am here. She left it open, because she did not know who had been listening, or to whom she was answering.</p>
    <p class="coda">The age of hush has not ended. It has simply at last produced an empty tack — all the bells that once were struck want to find their way back.</p>`,
  },
  {
    no: 27,
    zhTitle: "纸袋之后",
    enTitle: "After the Bag",
    zh: `<p>桌边空着。铜扣的影子早没了，空钉也不在了——它现在住在纸袋里，袋口压着那行字。阿汐把纸袋放在膝盖上，没有添字。</p>
    <p>那几天她常常打开袋子，再合上。不是为了看那行字——她比谁都清楚那三个字长什么样——她是在听它是不是比昨天轻一点。袋里只有纸，纸比空气重那么一点点；那一点点不肯变。海风进不来，她也没有让它进来。</p>

    <div class="beat">· · ·</div>

    <p>阿沉在门边的旧纸上又添了一行。他不敢用笔——笔会留下犹豫的痕迹；他用粉笔，因为粉笔会停在半空。他只写了一个字：听。写完他退后一步，看了很久，没有再写第二个字。</p>
    <p>风从北崖方向来的时候，石板上那个「听」字晃了一下。不是风吹的——风不会认字。晃的是它自己。</p>

    <div class="beat">· · ·</div>

    <p>夜里她梦见海。那片海不是海，是一只很大的纸袋——大到能装下所有敲过的钟的回声。袋子的口绕了很多圈，在顶端打了一个很浅的结，浅到随时可以解开。</p>
    <p>醒来以后，她发现枕头边到窗台之间多了一条细细的盐线。她没有擦它。她顺着那条盐线走到门边，把纸袋放在地上。</p>
    <p>她终于开口了——不是说「听留下」，而是问：我可以回答吗？没有人回答。门没有动；纸袋的绳结也没有动。问句落在屋里，屋里把它接住了。</p>

    <div class="beat">· · ·</div>

    <p>阿汐把袋子重新系了一次。新打的结更浅。她用粉笔在袋子上画了一个句号——和石板上那个一模一样——画完她笑了一下：这个句号里面没有字。</p>
    <p>海风又起的那天晚上，门自己开了一条缝。纸袋没有动，袋口还是压着那行字；那行字还是没有变。门开了一条缝——刚好够风进去，不够别的东西出去，也不够进来。</p>

    <div class="beat">· · ·</div>

    <p class="coda">纸袋一直留在门边。袋口没有合严——风进去过，字没有变。</p>
    <p class="coda">阿汐每晚把手放在袋子上，听一听那一点点重量还在不在。它在。</p>
    <p class="coda">止音纪元没有结束。它只是在练习：留一条缝，让风自己决定要不要进来。</p>`,
    en: `<p>The space beside the table was empty. The button's shadow was gone; the empty tack was gone too — it now lived inside the paper bag, its mouth folded over the line of characters. Axi kept the bag in her lap and added no words.</p>
    <p>Those days she often opened the bag and closed it again. Not to reread the three characters — she knew their strokes better than anyone — but to check whether they had grown lighter overnight. The bag held only paper, which weighed a touch more than air; that touch refused to change. The sea wind could not enter, and she did not let it.</p>

    <div class="beat">· · ·</div>

    <p>A-Chen tried one more line on the old sheet by the door. He dared not reach for a pen — a pen would have recorded his hesitation; he reached for chalk, because chalk can stop mid-air. He wrote a single character: 听 (to listen). Then he stepped back and watched it for a long while, and did not write a second.</p>
    <p>When the wind came down from the north cliff, the 听 on the slate quivered. Not from the wind — wind does not read. It quivered on its own.</p>

    <div class="beat">· · ·</div>

    <p>That night she dreamed of the sea. It was not the sea; it was an enormous paper bag, wide enough to hold the echo of every bell ever struck. Its mouth was wound many times over, and tied at the crown with a knot so shallow it could come loose at any moment.</p>
    <p>She woke to a thin trail of salt running from her pillow to the windowsill. She did not wipe it away. She followed the salt to the door and set the bag on the floor.</p>
    <p>At last she spoke — not "Listening remains", but a question: May I answer? No one answered. The door did not move; the knot did not move. The question settled in the room, and the room took it in.</p>

    <div class="beat">· · ·</div>

    <p>Axi tied the bag once more. The new knot was shallower still. With chalk she drew a period on the bag's face — the same shape as the one on the slate — and smiled as she finished: this period held no character inside it.</p>
    <p>On the night the sea wind rose again, the door opened a finger's width by itself. The bag did not move; its mouth still pressed down on the line of characters, and the characters had not changed. The door opened a finger's width — just enough for wind to enter, not enough for anything else to leave, and not enough to come in.</p>

    <div class="beat">· · ·</div>

    <p class="coda">The bag stayed by the door. The mouth never sealed — the wind had been inside, the characters had not changed.</p>
    <p class="coda">Each night she rested a hand on the bag, listening for the small extra weight. It was there.</p>
    <p class="coda">The age of hush has not ended. It is only practicing: to leave a seam, and let the wind decide whether it wants to come through.</p>`,
  },
  {
    no: 28,
    zhTitle: "窗台盐线",
    enTitle: "Salt on the Sill",
    zh: `<p>纸袋还压着那行字。窗台的盐线没有断，风从门缝进来，停在袋口。阿汐把纸袋移开——下面没有字。</p>
    <p>那道盐线从枕头边一直延伸到窗台，宽的地方不到一指。她不知道是谁画的——她只知道每天早上起来，它都短一点点。第一天它长两拃，第三天少了半拃，第五天再看，只剩一拃。</p>
    <p>阿沉发现那条线之后，没有擦它，也没有碰它。他的处理方式更笨——他在窗台旁边用粉笔画了三条短刻度：一拃、半拃、消失。没有圈，没有箭头，只有三条线和下面一个字：记。</p>

    <div class="beat">· · ·</div>

    <p>阿汐第五天没有睡。她搬了一把椅子到门边，等那阵风。风来得很晚——像从很远很远的地方赶路的人。风到的时候，她听见门缝和窗框同时响了一声。</p>
    <p>盐线断成两截的时候没有声音。它断在窗台两块木板的接缝处——一下子齐整的两半。她数到十七，风停了。窗台上两堆盐，白得像刚从海里捞出来。</p>

    <div class="beat">· · ·</div>

    <p>纸袋没有动过；袋口还是压着那行字；那行字还是没有变。她凑近窗台，看见盐粒的断口处，浮着一缕很细很舒服的粉笔灰——像旧纸被翻动过。</p>
    <p>她鼓起勇气做了一件事：把袋口翻起一边，留很小很小的一口。风进去了，又出来。袋里那行字没有变，一个字都没有变。她把翻起的那一边松开——袋口回到原来的压痕，好像什么也没做过。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她最后没有再等一个明示。天亮的时候，她出了门，去了一趟很远的海边。</p>
    <p class="coda">在那里，她发现所有退潮的地方，都有一条盐线。</p>
    <p class="coda">止音纪元没有结束。它只是等人学会断一道缝——然后由风自己决定，门缝还在不在。</p>`,
    en: `<p>The bag still pressed down on the line of writing. The salt trail on the sill had not broken. Wind came in through the door's slit and stopped at the bag's mouth. Axi lifted the bag — there was nothing written beneath it.</p>
    <p>The line ran from the pillow's edge all the way to the sill, and at its widest it did not reach a single finger-width. She did not know who had drawn it — only that each morning she woke to find it a little shorter. The first day it spanned two hand-widths; by the third it was short of one; on the fifth morning, only a single hand's width remained.</p>
    <p>A-Chen had seen the line too. He had not wiped it, had not touched it. His response was blunter: on the frame beside the sill he chalked three short marks — one hand's width, half, gone. No circles, no arrows, only the three ticks and a character beneath: 记 — note it.</p>

    <div class="beat">· · ·</div>

    <p>On the fifth night she did not sleep. She dragged a chair to the door and waited for the wind. It came late — the way a traveller arrives from somewhere very far away. And when it arrived, she heard the slit in the door and the window frame answer it with the same note, at the same time.</p>
    <p>The salt line broke in silence. It broke exactly at the seam where the sill's two boards meet — in one clean parting. She had counted to seventeen when the wind stopped. Two small mounds of salt lay on the sill, white as if newly dredged from the sea.</p>

    <div class="beat">· · ·</div>

    <p>The bag had not moved; its mouth still pressed down the line; the line had not changed a stroke. She knelt to the sill and saw, lodged in the break, a wisp of chalk dust so fine it was almost comfortable — as if an old sheet had been leafed through.</p>
    <p>She gathered the courage to do one thing: she folded one corner of the bag's mouth open, leaving a very small, very little gap. The wind went in, and it came out again. The line inside did not change — not one character. She let the folded corner fall back. The mouth returned to its old crease, as though nothing had been done at all.</p>

    <div class="beat">· · ·</div>

    <p class="coda">In the end she did not wait for an explicit sign. At dawn she stepped out the door and walked a very long way to the sea.</p>
    <p class="coda">There she found that every beach, after the tide goes out, leaves a salt line behind.</p>
    <p class="coda">The age of hush has not ended. It is only waiting for someone to learn how to leave a seam — and then letting the wind decide whether the seam should stay.</p>`,
  },
  {
    no: 29,
    zhTitle: "盐线之后",
    enTitle: "After the Salt Line",
    zh: `<p>天亮时，盐线还在窗台。两半，还是两半。阿汐把纸袋从枕头边移开，放在门边——没有装进去，没有翻开，也没有封死。她只把袋口按回那道旧压痕，让那行字仍旧朝上。</p>
    <p>风从门缝经过的时候，袋口动了一下——不是被吹翻，是被带起了一线极薄的影子。袋口下面的那行字没有动。那行字永远不会替任何人动。</p>

    <div class="beat">· · ·</div>

    <p>阿沉没有再刻新的刻度。旧的三条线还在窗台边的粉笔画上——一拃、半拃、消失。第四天早上，他发现「消失」那条线下面，他自己的字——「记」——被风吹歪了一个角。</p>
    <p>他没有改。歪了就让它歪着。歪的那一笔倒更像一封信的签名。</p>

    <div class="beat">· · ·</div>

    <p>阿汐每晚都去看那个袋子。袋口压着的那行字还是那三个字。她不再试图读更多。有一天下午，她忍不住做了一件事——坐在袋子旁边，把那行字从头到尾，一个字、一个字地读出声来。</p>
    <p>读完第三个字的时候，门缝呵出一股凉风——带着盐味，也带着一点海藻晒干的气息。袋口的影子突然伸长，像有人在很远的地方，终于合上了脚步、定住了身子、听了一会儿。</p>
    <p>她把手按在袋子上。什么也没有发生。她以前以为会有什么发生。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她后来明白了：袋子不是谁寄给她的信，是永远没有完结的那件事的提醒——听，就是留下。</p>
    <p class="coda">门没有再开。纸袋留在原处。</p>
    <p class="coda">要不是她走过窗台时无意中看了一眼——窗台上那两半盐线，好像又悄悄长回去了一点点。不多。只够压住下一句，还没有到的话。</p>`,
    en: `<p>At daylight, the salt line remained on the sill. Two halves, still two halves. Axi lifted the bag from the pillow's edge and set it by the door — she did not put it away, did not fold it open, did not seal it. She simply pressed the mouth back into its old crease, so the line of writing still faced up.</p>
    <p>When wind passed through the slit, the mouth shivered — not flipped, only lifted into the thinnest shadow. Nothing beneath it moved. The line of writing would never move on anyone's behalf.</p>

    <div class="beat">· · ·</div>

    <p>A-Chen chalked no new marks. The old three were still there — one hand's width, half, gone. On the fourth morning he found that the character he had chalked beneath them — 记， note it — had been tilted by the wind, one stroke bent sideways.</p>
    <p>He did not fix it. If it bent, let it stay bent. The slanted stroke looked, strangely, more like a signature.</p>

    <div class="beat">· · ·</div>

    <p>Each night she went to look at the bag. The three characters at its mouth were the same three. She no longer tried to coax more meaning from them. Then one afternoon she broke and did one thing — she sat beside the bag and read the line aloud, from the first stroke to the last, one character at a time.</p>
    <p>As she finished the third character, the slit breathed out a cool wind — salt-smelling, with a trace of dried seaweed. The shadow at the bag's mouth stretched suddenly, as if somewhere far away a traveller had finally stopped walking, planted both feet, and listened.</p>
    <p>She laid her hand flat on the bag. Nothing happened. She had thought something would.</p>

    <div class="beat">· · ·</div>

    <p class="coda">Later she understood: the bag was not a letter from anyone. It was the reminder of the thing that never ends — listening is leaving.</p>
    <p class="coda">The door did not open again. The bag stayed where it was.</p>
    <p class="coda">It was only when she happened to pass the sill that she saw it — the two halves of the salt line, growing back ever so slightly. Not much. Just enough to press down on the next line, the one that had not arrived yet.</p>`,
  },
  {
    no: 30,
    zhTitle: "窗台记数",
    enTitle: "The Sill Keeps Count",
    zh: `<p>纸袋还在门边。窗台上的盐线没有再长。她把两半并在一起，中间留着一道空处——刚好能放下一枚铜扣，也刚好能放下一个字。清晨，空处仍在。</p>
    <p>阿汐不再动它。连擦窗台的时候，她都只擦它的左半和右半，中间那道空处留给它自己——它在等，还是不在等，谁都不知道。只有一件事确定：窗台每天早上替她看着它。</p>

    <div class="beat">· · ·</div>

    <p>那天起，她自己也开始记数。阿沉的旧刻度还在——一拃、半拃、消失。他的「记」字被风吹歪过一个角。阿汐没有再新画刻度；她只在每天的粉笔末端，轻轻点一下窗台板。</p>
    <p>第一天，三个点；第二天，五个点；第三天，她忍不住笑了。她发现自己居然在数——可数什么，为什么，她自己也不知道。也许是为了让那段时间有东西留下；也许是为了不被等到失去耐心。</p>
    <p>有一天傍晚她走到海滩边，看见自己走过的地方，沙上也添了新的半圆——海水退潮时也会留下一串很浅的点。她蹲下来看了很久，站起来的时候，她才明白：退潮也是一种记数。它没有刻度，却从不重复。</p>

    <div class="beat">· · ·</div>

    <p>第三个清晨，空处里多了一道极淡的影子——像远处海面上碎开的光、像很老的粉笔的最后一笔的影子。阿汐看了一眼，没有喊阿沉，也没有数。她只在空处旁边，添了一个很短很短的划。</p>
    <p>那根划和阿沉那三条线并排立着——一根点三下，一根画过去，一根被风吹歪。沉默把它们收进同一幅画。</p>

    <div class="beat">· · ·</div>

    <p class="coda">风又来的时候，纸袋没有动。窗台上两半并在一起，空处还在那儿。那晚她走了一趟海滩——回来的时候，鞋底沾着一点盐。</p>
    <p class="coda">门没有开。空处也没有填上。</p>
    <p class="coda">止音纪元没有结束。它在学两个字——等。</p>`,
    en: `<p>The paper bag stayed by the door. The salt line on the sill did not grow again. She placed its two halves together, leaving an empty space between them — just wide enough for a copper button, just wide enough for a single character. In the morning, the space remained.</p>
    <p>Axi did not touch it anymore. Even when she wiped the sill, she wiped left, then right, leaving the empty space to its own business — whether it waited, or did not wait, no one could say; only that the sill watched it for her, every morning.</p>

    <div class="beat">· · ·</div>

    <p>From that day, she kept count too. A-Chen's old ticks were still there — one hand's width, half, gone. His 记 had been tilted by the wind. Axi drew no new ticks; she simply touched the pencil against the sill each morning, a small point of graphite for each day she had waited.</p>
    <p>The first day, three points. The second, five. On the third she caught herself and smiled. She had started to count — what she was counting, and why, even she did not know. Perhaps to leave a mark of the waiting; perhaps to spare the waiting from losing its shape.</p>
    <p>One evening she walked to the beach. Where she had stepped, the sand bore a few new half-circles — the sea left its own faint points when the tide went out. She crouched and stayed a long time, and when she stood up she understood: the ebb is also a kind of counting, without ticks, never repeating.</p>

    <div class="beat">· · ·</div>

    <p>On the third morning a very faint shadow lay across the empty space — like light broken into silver on a distant sea, like the ghost of a very old chalk stroke. Axi saw it, said nothing to A-Chen, and did not count. She only drew one more short stroke beside the empty space.</p>
    <p>The new stroke stood beside A-Chen's three — one tick-mark, one drawn line, one bent by wind. Silence folded them all into the same picture.</p>

    <div class="beat">· · ·</div>

    <p class="coda">When the wind came again, the bag did not move. On the sill, the two halves lay together and the space remained. That night she walked to the beach; when she came back, there was salt on the sole of her shoe.</p>
    <p class="coda">The door stayed shut. The space was not filled.</p>
    <p class="coda">The age of hush has not ended. It is learning two characters — wait.</p>`,
  },
  {
    no: 31,
    zhTitle: "空处之后",
    enTitle: "After the Space",
    zh: `<p>纸袋仍在门边。窗台中间留着一道空处，铜扣没有放进去。那枚铜扣是某天清晨自己长在窗台上的——同一道她在空气里闻见了一点陈旧的铜锈味，窗台上就多了一个小小的沉点。</p>
    <p>她拾起来放在手里看了许久。铜扣的边缘有一点点磨过——那是回老宅门槛上、很远的那天傍晚被阿汐替阿沉按下去、又沿着石阶滚下来时，蹭掉的那层亮。它比任何时候都更薄、更旧，也更像某人一样走到了自己该到的地方。</p>

    <div class="beat">· · ·</div>

    <p>她把它搁在木板接缝旁——床边那道被她称作「记数的线」的接缝。她以为那里会记住它。她用粉笔在它旁边点了一点，又点了一点；点到第七下，粉笔灰忽然碎在接缝里，像被风吹进木板的谷里，落不到她的指腹上。</p>
    <p>木板没有记下铜扣。哪怕她换了铅笔、换了指甲、换了指腹——木板不认这么多数。</p>

    <div class="beat">· · ·</div>

    <p>那天晚上，退潮深一寸。她推开门，看见海在尽头发回深的明暗——一些很深很老的影子。浅点停在门外，没有越过盐线。她没有数它们，也没有捏着粉笔下楼。她只站在门槛上望了很久。</p>
    <p>她忽然明白：盐线不属于任何人，也不属于任何人的记数法；它只是每天替世界画下一个空处——为什么它永远不结束，谁都说不准。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她后来没有再去数。退潮的时候，她看海；涨潮的时候，她看门缝。铜扣还在木板接缝旁，一动也不动。</p>
    <p class="coda">木板没有记下铜扣。</p>
    <p class="coda">止音纪元没有结束。它在学着不去数。</p>`,
    en: `<p>The paper bag remained by the door. The space between the two halves on the sill was still empty; the copper button had not been placed there. The button had simply grown there one morning — Axi had smelled the stale oxide in the air, and the sill had a small heavy spot on it, waiting to be answered.</p>
    <p>Axi lifted it and studied it in her palms for a long while. Its edges were worn — the shine had gone from the faraway evening it had been pressed through A-Chen's doorstep on her behalf, and then tumbled down the stone steps. It was thinner now, older, more homely, and somehow more like someone who had walked the rest of the way back.</p>

    <div class="beat">· · ·</div>

    <p>She set it beside the seam in the floorboard — the seam she had called her counting line. She thought it would remember it there. She touched chalk beside it once, twice; on the seventh touch the chalk dust broke into the seam, as if it had been drawn into the grain before her fingertip could feel it.</p>
    <p>The floorboard kept no count of the button. Not for chalk, not for pencil, not for fingernail, not for fingertip. The boards would not learn her arithmetic.</p>

    <div class="beat">· · ·</div>

    <p>That evening the tide dropped a further inch. She pushed the door open and saw the sea at the far end sending back its deep contrasts — very dark and very old shapes. The shallow marks stopped outside the door, short of the salt line. She did not count them. She did not take chalk downstairs. She only stood on the threshold and looked for a long time.</p>
    <p>She finally understood: the salt line belonged to no one, and to no one's arithmetic; it was the sea drawing a small empty space each day for the world, and no one could say why it would not end.</p>

    <div class="beat">· · ·</div>

    <p class="coda">In the end she stopped counting. At ebb she watched the sea; at flood she watched the slit in the door. The button stayed by the floorboard's seam, unmoving.</p>
    <p class="coda">The floorboard kept no count of the button.</p>
    <p class="coda">The age of hush has not ended. It is learning not to count.</p>`,
  },
  {
    no: 32,
    zhTitle: "未刻之数",
    enTitle: "The Unmarked Number",
    zh: `<p>木板接缝旁，铜扣留着。某天午后，渡人进了门——他每天照例路过这条旧巷，今天他在门口停住了，看着窗台上的那道空处，看了很久。</p>
    <p>渡人是摆渡人——回廊钟下面的那条海峡，涨潮时他渡人向海，落潮时他渡人回崖。他从不问人要去哪里；他只问询问：你已经听够了吗？人们答不上来，就点点头，他就把船划出去。</p>

    <div class="beat">· · ·</div>

    <p>他走近窗台，不打招呼，也不解释。他从袖子里取出一只小铜秤——他随身带它，用它量许多不该量的东西：沉默的重量、旧事的重量、一枚铜扣的重量。</p>
    <p>他把铜扣放到秤盘上。指针没有偏。他把它拨回来，再放一次，指针还是没有偏。他试了三次，都是这样。他最后收回秤盘，说了一句阿汐之前没听过的话：它已经不是那枚铜扣了。它是一个念头——念头不称重量。</p>

    <div class="beat">· · ·</div>

    <p>渡人又从袖子里取出一本很薄很簿的簿。封面没有字，纸页边缘被海水泡过。他在翻到的那一页上写了一个空格。墨一下子停在格外——没有任何一笔落在空格里面。</p>
    <p>他合上薄页，照原路出门去了。阿汐没有叫住他。她以前见过他两次，也没有叫住过哪一次。</p>

    <div class="beat">· · ·</div>

    <p>渡人走后的第三天，她发现门边多了一个小铁钉。钉子比铜扣更老，老得像在那条海峡里泡过一百年。她不知道是渡人落下的，还是涨潮时替他放进来的——也许两者都是。她把钉子放在铜扣旁边，木板还是没有记下任何数。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她翻过薄页的影子——薄页的厚度和空格的厚度差不多重。</p>
    <p class="coda">木板没有记下空格。</p>
    <p class="coda">止音纪元没有结束。它在学着让空处真正地空着。</p>`,
    en: `<p>The brass button remained beside the plank seam. On one of the afternoons, the ferryman came through the door — as he always did on this old lane; today he stopped at the threshold and kept his eyes on the empty space on the sill, and went on looking for a long time.</p>
    <p>The ferryman is the one who ferries — across the strait beneath the Arcade of Echoes, at flood he takes people out toward the sea, at ebb he takes them back to the cliff. He never asks where anyone is going; he asks only one question — have you heard enough? If they could not answer, they nodded; he pushed the boat off.</p>

    <div class="beat">· · ·</div>

    <p>He walked up to the sill without a word or a reason. From his sleeve he drew a small brass scale — his constant companion, used to weigh things that were never meant to be weighed: the weight of silence, the weight of a past thing, the weight of a single brass button.</p>
    <p>He set the button on the scale. The needle did not shift. He set it back, and tried again — the needle still did not shift. He did it a third time. It was the same. He finally folded the scale away and said a sentence Axi had never heard from him before: it is no longer the button. It is an intention — intentions do not weigh anything.</p>

    <div class="beat">· · ·</div>

    <p>From his sleeve he drew a very thin ledger. The cover had no title; the edges of the pages had been soaked by sea water. On the page he had opened it to, he drew a single blank. The ink stopped at its edge — not one stroke ever touched inside it.</p>
    <p>He closed the ledger and left the same way he had come. Axi did not call after him. The last two times she had seen him, she had not called after him then either.</p>

    <div class="beat">· · ·</div>

    <p>On the third day after he left, she found a small iron nail by the door. It is older than the copper button — so old it might have spent a hundred years beneath the strait. She did not know whether the ferryman had left it, or whether the tide, at flood, had set it there for him — perhaps both. She set the nail beside the button; the plank still recorded no count.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She turned the ledger's shadow over in her mind — its thickness and the thickness of the blank were about the same weight.</p>
    <p class="coda">The plank did not record the blank.</p>
    <p class="coda">The age of hush has not ended. It is learning to let the empty space be genuinely empty.</p>`,
  },
  {
    no: 33,
    zhTitle: "秤旁",
    enTitle: "Beside the Scale",
    zh: `<p>铜扣和铁钉并排放着。篇三十二那枚老得像海峡泡了一百年的钉子，和铜扣一起躺在木板接缝旁——像两件刚从海里捞上来的东西。阿汐没有数它们。她试了试袖子里的记数法，觉得什么都数不出来。</p>
    <p>窗台的空处仍在。薄页上的空格也仍在——没有任何一笔落进去。她把那本簿子从袖子里抽出来，放在两件小东西旁边。它在那里会仔细地记住自己是什么，也会记住自己是什么都不是。</p>

    <div class="beat">· · ·</div>

    <p>海经过门外。每天早晨它退潮一次，浅点从门槛外走过；每天黄昏它涨回来一次，把浅点也带回去。她以前数过它们——一，二，三，五，九——后来她没有再数了。她坐在窗台边，听见风把木板接缝里的海盐吹散，却没有一句话被落在本子上。</p>
    <p>她把手收回袖中，听海经过门外，没有替它记下声音。</p>

    <div class="beat">· · ·</div>

    <p>渡口的栏杆上挂着一小截粉笔头——阿汐某天路过那里的时候，看见它挂在上面，没有人取，也没有人挂回去。她以为是渡人留下的，也许是出过渡人的任何一个人都可以顺手挂在那里。</p>
    <p>她回来的时候，窗台上的空处里多了一道极淡的横线。那条线很干净。她走近看了看——那不是字，只是一笔极淡的标点。或者是某种记下没被记下来的开始。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有擦它。她也没有留下它。她只是把簿子换了一个方向，让薄页的那一页朝上。</p>
    <p class="coda">有些空处，不等答案。</p>
    <p class="coda">止音纪元没有结束。它只是终于学会了「放着」这两个字——放不等待，也不算。</p>`,
    en: `<p>The copper button and the iron nail lay side by side. The nail — older than salt — coiled like a thing that had soaked in the strait for a hundred years. They rested beside the seam in the floorboard like two small things dredged from the sea. Axi did not count them. She went over her pocket arithmetic and felt there was nothing there she could fold into a number.</p>
    <p>The empty space on the sill remained, as did the blank in the ledger — not one stroke had ever entered it. She drew the ledger from her sleeve and set it beside the two small things. There it would remember what it was, and also remember what it was not.</p>

    <div class="beat">· · ·</div>

    <p>The sea passed outside the door. Each morning it receded, leaving shallow points by the threshold; each evening it returned and took them with it. She had counted once — one, two, three, five, nine — and never counted again. She sat by the sill and listened to wind brush salt off the boards' seam, and not a single word was left on the page.</p>
    <p>She drew her hand back into her sleeve and listened as the sea passed outside the door, leaving its sound unrecorded.</p>

    <div class="beat">· · ·</div>

    <p>On the ferry rail hung a short chalk nub. She came upon it one day travelling to the far side; no one took it and no one put it back. She supposed it had belonged to the ferryman — or that anyone who had ever crossed with him could have left it there.</p>
    <p>When she returned, a very faint horizontal stroke lay across the empty space on the sill. The stroke was clean. She stepped closer and looked — it was not a character, only a faint period, or perhaps the mark of a thing that had decided to be remembered.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not wipe it. She did not keep it. She only turned the ledger over, so that the open page faced upward.</p>
    <p class="coda">Some empty spaces do not wait for an answer.</p>
    <p class="coda">The age of hush has not ended. It is only learning two characters — set aside — which neither waits nor counts.</p>`,
  },
  {
    no: 34,
    zhTitle: "未记的一页",
    enTitle: "The Unentered Page",
    zh: `<p>铜扣、铁钉和薄簿仍在接缝旁。窗台上那道极淡的横线，还在——浅得谁都可以当它没出现过。阿汐把它看了很久，却没有抄进薄簿里。</p>
    <p>她当然可以抄。她拿出簿子的时候，笔就在手里，墨也磨好了。可就在这一秒，她发现那条线和潮水涨的次数一样——如果抄了，就只剩一条线了，而不是「一次」。</p>

    <div class="beat">· · ·</div>

    <p>夜里涨潮的时候，她站在门口，看见海把窗台的那道横线盖住了。盐水在上面铺开，像给那条线换了一件很薄很旧的衣服。</p>
    <p>海没有把横线抹掉——它只是替它换了件衣服。</p>

    <div class="beat">· · ·</div>

    <p>天亮的时候，横线不见了。木板上只剩一小块干处，位置在横线原来那边——干的颜色比旁边略深，像一枚没人贴上的邮票。</p>
    <p>阿汐蹲下来看了很久。她没有数那块干处——她不像以前那样，要在脑子里给每件东西分一格。她这次仅仅是蹲在那里，看着它。</p>

    <div class="beat">· · ·</div>

    <p>铜扣、铁钉和薄簿仍在接缝旁。薄簿一直以它那种谁都说不稳的姿态躺着——既不是记着什么，也不是在等待什么。薄页上那道空格也是——没有人把它填掉。</p>
    <p>渡人的船某天停在了门口。阿汐有片刻以为他会开口提醒她：你那里有东西干了。可是他没有。他只是把船缓缓远去，没有问她什么。她明白了：有些事他也是不会替她数下去的。</p>

    <div class="beat">· · ·</div>
    <p>她把薄簿合上，放回接缝旁。她没把那块干处算进去。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有记下来没有人记下它。海涨了又退，窗台亮了又暗。</p>
    <p class="coda">有些记下来的事，不必写进簿里。</p>
    <p class="coda">止音纪元没有结束。它只是在帮阿汐学会「留」这个字——留得住，不一定非得写下来。</p>`,
    en: `<p>The copper button, the iron nail and the thin ledger remained beside the plank's seam. The very faint line on the sill — so faint that anyone could pretend it had never been there — was still on the sill. Axi studied it for a long time and did not copy it into the ledger.</p>
    <p>Of course she could have. The ledger was in her lap; the pen was in her hand; the ink was ground. But in the same second she understood that the line was equal to the times the tide had risen — to copy it would have turned it into a line, and not into a once.</p>

    <div class="beat">· · ·</div>

    <p>At night, when the tide came in, she stood in the doorway and watched the sea cover the mark on the sill. The salt water spread across it, as if to dress the line in a thin, worn garment.</p>
    <p>The sea did not wipe the line away — it only gave it a different cloth to wear.</p>

    <div class="beat">· · ·</div>

    <p>At daylight the line was gone. Only a small dry patch remained on the boards, where the line had once been — dry, a shade darker than the wood around it, like a stamp nobody had bothered to glue down.</p>
    <p>Axi crouched beside it for a long time. She did not count the patch — she did not do what she used to do, dividing each thing into a numbered place in her mind. This time she simply squatted there, and looked.</p>

    <div class="beat">· · ·</div>

    <p>The button, the nail, and the ledger remained beside the seam. The ledger had the uneasy posture it always wore — neither recording anything, nor waiting for anything. The blank on the open page also remained, as untouched as it had always been.</p>
    <p>One day the ferryman's boat stopped at the door. For a moment Axi thought he would speak and remind her that something there had gone dry. He did not. He only drew the boat away, and asked her nothing. She understood then: there were things he would not keep counting for her either.</p>

    <div class="beat">· · ·</div>
    <p>She closed the ledger and set it back beside the seam. She did not count the dry patch.</p>

    <div class="beat">· · ·</div>

    <p class="coda">No one noted that she had not noted it. The sea came and went; the sill brightened and darkened.</p>
    <p class="coda">Some things kept need not be entered.</p>
    <p class="coda">The age of hush has not ended. It is only teaching Axi a character — 留， to leave — which means to hold, not always to write.</p>`,
  },
  {
    no: 35,
    zhTitle: "干处",
    enTitle: "The Dry Place",
    zh: `<p>天亮后，干处还在。潮水退去了，它还在那里；潮水涨回来的时候，木板的其他地方都湿了，那一小块地方没有变湿。它比周围的木板大不了一枚指甲盖。</p>
    <p>阿汐把薄簿放在干处旁边。她没有打开它。薄页已经不是她要读的那一页了。</p>

    <div class="beat">· · ·</div>

    <p>她试着用手指抹平那块干处的边缘。木板的纹理在它里面很清晰——像很久以前有人蘸着海盐描过一个圈，在雨后就是一块永远干的地方。</p>
    <p>她想起母亲教她认字时总是说：木板上的干纹是海画的字，不必记，也不能抄。那时她没听懂。她以为“不必记”是教她不用功；“不能抄”是告诉她抄不来。她现在才明白：不必记，是因为它不会被遗忘的那种记；不能抄，是因为要等它自己开口。</p>

    <div class="beat">· · ·</div>

    <p>潮水每涨退一次，微凉一次。木板在冷的时候比铁板还硬；温度上来时，空气里会有一点蟹壳的气味。每一次涨退之间，那块干处纹丝不动地待在那里。</p>
    <p>有一天它快要被涨潮完全盖住了。盐水爬上木板，涨到了那块干的边缘，停在它边上一指的地方——就那么多。它不像是被守护着；它像是有它自己的意愿。</p>
    <p>她没有叫渡人来看。不是不信任他——是她忽然明白，那块干处既不属于渡口，也不属于薄簿，也不属于她。它只是被风吹了很多很多世代之后，终于自己落成了一个形状。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她把薄簿拿在手里又放下，盖住它，推到接缝旁。</p>
    <p class="coda">薄簿没有记下干处。干处也没有等它记下。</p>
    <p class="coda">止音纪元没有结束。它只是终于把一块永远不会弄湿的木板，交给了阿汐。</p>`,
    en: `<p>At daylight, the dry place remained. When the tide went out, it was there; when it returned, the boards everywhere else became dark and wet, and that small place did not. It is no larger than a fingernail.</p>
    <p>Axi set the thin ledger beside it. She did not open it. The open page was no longer the page she needed to read.</p>

    <div class="beat">· · ·</div>

    <p>She tried once to smooth its edge with her fingertip. The grain inside it was distinct — as if someone, ages ago, had dipped a brush in salt water and drawn a circle, and there it would stay dry, through every storm.</p>
    <p>She remembered her mother's voice as a girl, teaching her characters: the dry on these boards is the sea's own writing, you must not record it and you cannot copy it. She had not understood then. She had thought "must not record" meant "do not bother"; and "cannot copy" meant "it is too hard". She understood now: must not record — because it is the kind of thing that is remembered without being written; cannot copy — because it is waiting for itself to speak.</p>

    <div class="beat">· · ·</div>

    <p>Every flood-and-ebb cooled the planks; iron gets harder in the cold. A crab-shell smell lingered in the air. With every flood-and-ebb, the place did not shift an inch.</p>
    <p>One day it came close to being covered entirely. Salt water climbed the boards and rose to its edge, stopping a single finger's width short — no farther. It was not guarded; it seemed to keep its own counsel.</p>
    <p>She did not call the ferryman. Not from mistrust. It was that she had understood, without words: the patch was not the ferry's, not the ledger's, not hers. Only — after many, many generations of wind — had it finally settled into its own shape.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She held the ledger, then set it down again and pushed it beside the seam.</p>
    <p class="coda">The ledger did not enter the dry place. The dry place did not wait to be entered.</p>
    <p class="coda">The age of hush has not ended. It is only that, at last, it has handed Axi a small plank of wood that will never get wet.</p>`,
  },
  {
    no: 36,
    zhTitle: "未称之物",
    enTitle: "Unweighed",
    zh: `<p>干处旁边，铜扣、铁钉和薄簿都没有动。潮退了一次，海还在等下一次；木板的纹路被太阳晒得很浅。渡人把小铜秤放在门槛上——秤盘空着。</p>
    <p>他没有问阿汐要称什么。她以前以为他总会问：你那里有多少，就称多少。可这一次他把秤盘放下，自己往后半步，就什么都不说了。</p>

    <div class="beat">· · ·</div>

    <p>阿汐那天把铜扣握在手里。她握得很久——铜扣有点凉，也有点沉。它可以放到秤盘上去；渡人看着她；她也看着他。可是她最终把铜扣收了回来。</p>
    <p>她不需要知道它有多重。她终于明白了：世界不是什么都需要一个数。</p>

    <div class="beat">· · ·</div>

    <p>潮水退去的时候，秤盘里多了一粒盐。不知是怎么进来的——也许风吹的；也许海自己决定的——谁也说不出个所以然。阿汐蹲下来看它。很小很小的一粒，几乎不可能更小，可是被看见了。</p>
    <p>渡人也蹲下来看它。他伸出一根手指，在很远很远的地方停住，没有碰它。他的手指在盐粒上空停了几秒，才又回去了。</p>

    <div class="beat">· · ·</div>

    <p>傍晚，渡人起身向门口走去。阿汐没有叫住他。他回身看了她一眼——他眼睛里有一种很老的、见过很多潮水的光。她知道他明天还会来，或者很多年以后。她不会问他何时来；她不会问他为什么。这一竿问过去，不知会搅动多少海盐。</p>
    <p>她把薄簿拿起来又放下——薄页朝上。一整天过去了，光线从窗沿移到地板，再移到那道被海折过的旧斜痕上。她不着急翻下一页。还有什么可翻的？</p>

    <p class="coda">她不会再去数任何东西。海涨了又退，木板湿了又干。</p>
    <p class="coda">盐粒留在秤盘上。铜秤一直留在门槛上。铜扣、铁钉和薄簿一直留在接缝旁。</p>
    <p class="coda">薄簿没有记下那粒盐。</p>
    <p class="coda">止音纪元没有结束。它为这一粒盐留了一片空——也为阿汐留了一扇门。</p>`,
    en: `<p>Beside the dry place, the copper button, the iron nail, and the thin ledger all lay untouched. The tide had gone out; the sea was waiting for its next visit; the grain of the boards had been bleached pale by the sun. The ferryman set his small brass scale on the threshold — the pan empty.</p>
    <p>He did not ask Axi what should be weighed. She had assumed he would — you have what you have; weigh what you have. This time he set the scale down, stepped back by half a pace, and said nothing at all.</p>

    <div class="beat">· · ·</div>

    <p>That day Axi held the copper button in her palm. She held it for a long time — it was cold and it was heavier than she expected. She could put it on the pan. The ferryman watched her. She watched him. But she closed her fingers at the end, and put it back.</p>
    <p>She no longer needed to know its weight. The world is not something you must attach a number to — not every single thing.</p>

    <div class="beat">· · ·</div>

    <p>When the tide receded, a single grain of salt lay in the pan. No one could say how it had arrived — whether the wind had brought it, or the sea itself had decided it belonged there. Axi knelt to look at it. So small it could not have been smaller, and yet it was seen.</p>
    <p>The ferryman knelt too. He extended one finger and stopped it a handspan above the grain, without touching it. He held his finger there for several seconds — and then withdrew.</p>

    <div class="beat">· · ·</div>

    <p>Toward dusk the ferryman rose and moved toward the door. She did not call after him. He looked at her once — there was an old, salt-aged light in his eyes, the kind that had seen many tides. She knew he would come again tomorrow, or in many years. She would not ask him when; she would not ask him why. A question of that size would only stir up more salt.</p>
    <p>She looked down at the ledger once more, and set it down face-up. The light slid from the sill's edge to the floorboards and died. Nothing hurried her to turn another page. What page was there left to turn?</p>

    <div class="beat">· · ·</div>

    <p class="coda">The grain of salt lay on the pan. The scale stayed on the threshold. The button, the nail, and the ledger remained beside the seam.</p>
    <p class="coda">The ledger did not enter the grain of salt.</p>
    <p class="coda">The age of hush has not ended. It has left one small empty space for that grain of salt — and it has left a door for Axi.</p>`,
  },
  {
    no: 37,
    zhTitle: "空秤",
    enTitle: "The Empty Scale",
    zh: `<p>次日，天亮时它就在那里——秤盘里的盐。渡人没有带走秤，阿汐也没有把盐放回海里。潮水来过，秤盘湿了，盐粒仍留在原处。木板的其他地方都干了，只有那一小块干处下面的地方还是凉的。</p>
    <p>她早上一醒就跑来看它。铜秤还放在门槛上；铜扣、铁钉和薄簿都一动不动；秤盘里的盐粒仍在。她把它看了很久，像看一朵换了很多次姿势的小花。</p>

    <div class="beat">· · ·</div>

    <p>渡人某天回来的时候，阿汐问他：这个盐要怎么称？他站在门口看了一会儿，然后说：它已经不用称了——它自己会称自己的。阿汐没听懂那句话，可是她把它记住了。</p>
    <p>渡人没有上门槛去。他在门口站了一会儿，就走了。那一次他没有停。</p>

    <div class="beat">· · ·</div>

    <p>海又来过几次，潮水也涨了几回。薄簿一直躺在接缝旁，薄页一直没有被记。她偶尔会把薄簿拿起来看看，然后又放下。她发现薄页和海之间有一种很老很老的协议：谁都打开它的时候，谁都可以合上它。</p>
    <p>她把薄簿合上，没有记这一页。</p>

    <div class="beat">· · ·</div>

    <p>薄簿的薄页偶尔自己翻过去一页。她以前以为是风吹的——后来她不再去干预它了。她觉得薄页和海合伙开的那一页，谁都不是等着谁。它们之间没有话，可是都知道对方在的。</p>

    <p>有一天晚上她在门口站到天黑。木板开始发凉的时候，她才起身回去。她没有关门——留一条缝就够了，留了很多很多年，没有问题。</p>

    <div class="beat">· · ·</div>
    <p class="coda">她以前觉得「空」是一种缺什么。现在她懂了：空是一种装着。</p>
    <p class="coda">秤盘空着，也盛着。</p>
    <p class="coda">止音纪元没有结束。它只是终于留下了一架永远不称物的秤——和一粒永远不秤自己的盐。</p>`,
    en: `<p>The next day, it was there before the first light — the grain of salt on the pan. The ferryman had not taken the scale, and Axi had not returned the salt to the sea. The tide came; the pan grew wet, but the grain stayed. The boards everywhere else had dried by morning, and the place beneath the dry patch stayed cool.</p>
    <p>She ran to it first thing. The brass scale was still on the threshold; the button, the nail, and the ledger lay as they always lay; the grain was in the pan. She studied it for a long time, the way one watches a small flower that has changed its posture.</p>

    <div class="beat">· · ·</div>

    <p>One day the ferryman returned. Axi asked him: how is that salt to be weighed? He stood in the doorway for a moment and said: it no longer needs to be weighed — it weighs itself. She did not understand the sentence, but she remembered it.</p>
    <p>The ferryman did not step across the threshold. He stayed by the door for a while, and then he left. He did not come in that day.</p>

    <div class="beat">· · ·</div>

    <p>The tide came again; again the ledger lay by the seam; the open page was never entered. Now and then she lifted the ledger and looked at it — and then set it down again. She had come to understand that the page and the sea had an old agreement: either party could open it, and either could close it.</p>
    <p>She closed the ledger without entering this page.</p>

    <div class="beat">· · ·</div>

    <p>Now and then the open page of the ledger turned by itself. She used to think the wind was doing it — she stopped interfering with it. She understood that the page and the sea kept an old agreement; neither was waiting for the other; they had nothing to say to each other, and each knew the other was there.</p>
    <p>One evening she stood in the doorway until it was black. When the boards began to cool, she finally went back inside. She did not close the door — a single seam would be enough, and it had been enough for many years.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She used to think "empty" meant "lacking". She understood now: empty is a kind of holding.</p>
    <p class="coda">The pan was empty, and held something.</p>
    <p class="coda">The age of hush has not ended. It has only left behind, at last, a scale that will never weigh anything — and one grain of salt that will never weigh itself.</p>`,
  },
  {
    no: 38,
    zhTitle: "秤盘之外",
    enTitle: "Beyond the Scale",
    zh: `<p>盐粒仍在秤盘里。阿汐没有称它，也没有把它移开。潮水退去时，秤盘留下一圈湿痕——一圈很浅很深的灰白色边线。盐粒旁边干着一小处。她没有记下那一处。</p>
    <p>薄簿合着，页角没有翻动。她偶尔想到薄页自己会翻过去一页；她伸手想按住——可她没有按。页角也没有翻过去。它在那里，只是静静地抵住。</p>

    <div class="beat">· · ·</div>

    <p>有一天她忽然想用一块湿布擦一下秤盘。她就这么想了一下，那个念头就收回去了。不是因为它错——是因为她意识到，这个秤盘现在自己会呼吸，或者等同于呼吸。它已经不是一个物件；它也是「留」。</p>
    <p>她不再许下「今天我把它称一称」的诺言。她连这种小小的诺言也没有了——连「想」一下都成了多余。</p>

    <div class="beat">· · ·</div>

    <p>渡人某天把船靠在门口。阿汐问他：这个秤盘上的干处要不要也写进薄簿？他听了一会儿，然后回答说：它已经是簿里的一页了。她愣了一阵——她明白了：薄簿的用途已经完了；薄簿的使命已经完成了。</p>
    <p>那一天，她忽然觉得薄簿很轻——轻得像一片刚从海里捞出的叶子。可这也不是「轻」的意思；这是另一件不能用字准确说的事。</p>

    <div class="beat">· · ·</div>

    <p>她忽然意识到那块被称为干处的地方，正如她母亲那本没写完的册子——最后的页角是别人按下去的，不是母亲自己按的。她要是按住——会不会很快就翻过下一页？她没有按，她也没有翻过。</p>

    <p class="coda">她把薄簿抱回接缝旁，轻轻放下。</p>
    <p class="coda">秤盘没有称那处干。</p>
    <p class="coda">止音纪元没有结束。它只是终于安静下来——安静得她能听见海把自己说出来的速度。</p>`,
    en: `<p>The grain of salt remained on the pan. Axi neither weighed it nor moved it. When the tide withdrew, a ring of wetness stayed on the brass — a very pale, very deep greyish borderline. Beside the grain, one small place remained dry. She did not enter it.</p>
    <p>The ledger stayed closed; its page corner still. She sometimes thought about the page turning over by itself. She would reach to stop it — but she did not reach. The corner did not turn either. It simply held itself, still.</p>

    <div class="beat">· · ·</div>

    <p>One day she had the thought to wipe the pan with a wet cloth. She considered it, and then she did not. Not because the thought was wrong — but because she understood that this pan was now breathing, or something like breathing. It was no longer an object; it too had become "held".</p>
    <p>She no longer made the small promise to herself — "today I will weigh it at least once". Even the thought had become superfluous.</p>

    <div class="beat">· · ·</div>

    <p>The ferryman drew his boat alongside the door one day. Axi asked him: does that dry patch on the pan belong in the ledger too? He listened for a moment, and then answered: it already is a page in the ledger. She went quiet for a beat — she understood: its errand was finished; its mission was complete.</p>
    <p>That day, she felt the ledger had become light — light as a leaf dredged from the sea. It was not "light"; it was something no word in this world could be quite exact about.</p>

    <div class="beat">· · ·</div>

    <p>She found herself thinking that the dry place she called a piece of land was like her mother's unfinished book — its last page-corner had been pressed by someone else, never by her mother herself. If she pressed it — would the next page soon turn by itself? She did not press it, and she did not turn it.</p>

    <p class="coda">She lifted the ledger and set it down again beside the seam, gently.</p>
    <p class="coda">The scale did not weigh the dry place.</p>
    <p class="coda">The age of hush has not ended. It has only, at last, fallen still — still enough that she can hear the speed at which the sea speaks itself.</p>`,
  },
  {
    no: 39,
    zhTitle: "秤影",
    enTitle: "The Scale's Shadow",
    zh: `<p>潮退后，秤盘上的湿痕淡了。淡到一个接一个的早晨，阿汐要很努力才能认出那圈湿痕的轮廓。她没有擦。她也没有一天比一天擦得更勤。</p>
    <p>门外多了一道影子。它停在门槛前，没有进来。它站着的时候，木板居然没有发出声音——即使是那种最老最旧的可能吱一声的木板。它安静地站着，像是刚从海里升上来的、一段从未干过的木头。</p>

    <div class="beat">· · ·</div>

    <p>阿汐第一天以为它会进来。她没有关门——她留着原来的缝——她也没有把缝收窄。她只是坐在窗台边，盯着那道影子，像盯着一枚一直没有落定的水滴。</p>
    <p>影子没有再远一步。它也没有离开。它在门外站着，像它来的时候那样站着，像它从一开始就打算站住那样站着。</p>

    <div class="beat">· · ·</div>

    <p>天亮时，影子还在，秤盘仍空着。湿痕淡了许多。薄簿依旧合着。阿汐没有站起来，也没有坐下——她只是在听。她听见盐在海风里把一切说成很小的、很淡的话。没有任何人告诉她，那道影子是谁——或者后面还会不会有谁。</p>
    <p>渡人某天又来了。他停在门口，看了一眼影子——但他没有让影子进门，也没有问阿汐打算怎么做。他只说了一句：它来的时候，是自己来的；它也是自己走的。阿汐没接话——她只是看着渡人，渡人也看着她，然后他又慢慢地走了。走的时候，他没有回头。</p>
    <p>她没有站起来叫住它，也没有站起来问它等什么。她只是坐在窗台边，看着木板干过一遍又一遍。她慢慢知道，影子不是来拿什么的——它只是停在门槛前，像世界曾经停在称量之前。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有去称那道影子。她没有问它要什么。</p>
    <p class="coda">有些东西到了门口，不必立刻称量。</p>
    <p class="coda">止音纪元没有结束。它几乎要学会了一个新的字——礼——不等你准备好，别急。</p>`,
    en: `<p>After the tide withdrew, the wet ring on the pan faded. It faded so gradually, morning after morning, that Axi had to look twice to find its shape. She did not wipe it away — nor did she wipe it with any particular diligence on any particular day.</p>
    <p>Outside, a shadow stopped at the threshold and did not enter. The boards, even the oldest, even the creaking ones, gave no sound at all. It stood — quiet as a plank that had never once been dry, raised straight up out of the sea.</p>

    <div class="beat">· · ·</div>

    <p>On the first day Axi assumed it would come in. She did not close the door — she left the seam just as it was. She did not narrow the slit either. She only sat by the sill and watched the shadow the way one watches a drop of water that has yet to fall.</p>
    <p>The shadow did not take a step further in. Nor did it leave. It stood outside — as it stood when it arrived — as though it had always meant to stop exactly there.</p>

    <div class="beat">· · ·</div>

    <p>At dawn, the shadow remained. The pan was still empty. The damp ring had faded to almost nothing. The ledger lay closed. Axi neither stood nor sat down — she only listened. She heard the salt in the sea wind turn everything into very small, very faint sentences. No one told her who the shadow was — or whether anyone would come after it.</p>
    <p>The ferryman came by once more. He stopped at the doorway and regarded the shadow — but he did not let it in, nor did he ask Axi what she intended to do about it. He only said: it came by itself; and by itself it would go. Axi did not answer — she looked at the ferryman, and the ferryman looked at her; then he slowly walked away. He did not look back.</p>
    <p>She did not rise and call to it, nor did she rise and ask it what it was waiting for. She only sat by the sill, watching the boards dry again and again. She grew to know, slowly: the shadow had not come to take anything — it was only waiting at the threshold, the way the world once waited before the weighing was invented.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not weigh the shadow. She did not ask it what it wanted.</p>
    <p class="coda">Some things at the threshold need not be weighed at once.</p>
    <p class="coda">The age of hush has not ended. It is almost learning a new character — 礼， courtesy — do not hurry before you are ready.</p>`,
  },
  {
    no: 40,
    zhTitle: "门槛之外",
    enTitle: "Beyond the Threshold",
    zh: `<p>影子仍停在门外。阿汐没有称它，也没有请它进来。潮水退去，门槛前留下一道湿痕；天亮后，湿痕淡了，位置没有变。薄簿合着，仍放在接缝旁。门没有关。</p>
    <p>她偶尔想关。她那只握住门扇的手——有几次，她甚至已经感到门在移动——可影子没有动。它就站在原地，像海的某段沉默直接撞上来。她也就没有推动门。</p>

    <div class="beat">· · ·</div>

    <p>薄簿的页角仍然自己偶尔翻一回。她以前以为是风吹的——她如今以为是海在称她的记性有多重。薄页没有回答她。它只是偶尔翻过去，偶尔不翻。薄页也许正在决定那一页对不对得上影子。</p>
    <p>影子的轮廓在有时候很清楚，很透亮——像海的另一面有人举着一盏湿灯。湿灯不照东西。它只是让它亮一下子。每次之后，影子就大一寸，或者小一寸。她没有去量。</p>

    <p>薄簿偶尔自己翻过去——她没有去干预它。她慢慢明白过来：薄簿的页角和海的潮汐一直在合伙数同一个数，比世界的计数方法来得慢，也比老人眼睛看外面的时候慢。她以前总想让它们快一点，好让她早一步知道下一步会发生什么。</p>
    <p>如今她学会了不催。她只是等——等它自己走完自己的路，无论它是谁，无论它要走多久。</p>

    <div class="beat">· · ·</div>
    <p>她慢慢知道：它来过；也去过。它没有需要被记下的事。它是另一场称量——比薄簿的任何一页都轻，又都重。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有关门。</p>
    <p class="coda">有些来处，不必立刻登记。</p>
    <p class="coda">止音纪元没有结束。它只是终于学会了说「等」——等的意思是：不追也不挡。</p>`,
    en: `<p>The shadow remained outside. Axi neither weighed it nor invited it in. When the tide withdrew, a wet mark stayed before the threshold. By dawn it had faded, but its place remained. The ledger lay closed, still beside the seam. The door stayed open.</p>
    <p>Now and then she thought of closing it. The hand that held the door — a few times she had felt the door begin to move — but the shadow did not move. It kept where it was, the way some silence of the sea collides head-on. She did not push the door.</p>

    <div class="beat">· · ·</div>

    <p>Now and then the page corner of the ledger still turned on its own. She once thought the wind was doing it; she now suspected the sea was weighing her own memory. The page did not answer. It only sometimes turned, sometimes didn't — as if it were deciding whether that page matched the shadow.</p>
    <p>The shadow's outline was sometimes startlingly clear — as though, from the sea's far side, someone were holding a wet lantern. The lantern does not light things. It only lets them shine for a breath. After each time, the shadow grew a thumb larger — or a thumb smaller. She did not measure.</p>

    <div class="beat">· · ·</div>

    <p>Now and then the open page of the ledger turned by itself. She used to think the wind was doing it — she stopped interfering with it. She understood that the page and the sea kept an old agreement; they had nothing to say to each other, and each knew the other was there.</p>
    <p>Now she had learned how not to hurry them.</p>
    <p>She came slowly to know: it had come; and it had gone. It had nothing that needed entering. It was another kind of weighing — lighter and heavier than any page of the ledger.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not close the door.</p>
    <p class="coda">Some arrivals need not be entered at once.</p>
    <p class="coda">The age of hush has not ended. It has only, at last, learned a character — 等， to wait — which means to neither chase nor block.</p>`,
  },
  {
    no: 41,
    zhTitle: "门外的湿痕",
    enTitle: "The Mark Outside",
    zh: `<p>天亮后，门外的湿痕还在。它很浅，几乎比空气还淡了一点——可它就在那里。阿汐没有开门，也没有合上薄簿。她把手放在门槛上，等潮水退去。湿痕浅了一些，位置没有变。</p>
    <p>她把手放在门槛上——木头很凉，凉得像另一双手在替她托着她的。她没有往里看，她也没有看向海。她只是坐在那里，等潮水把湿痕带走——或者把它留下来。</p>

    <div class="beat">· · ·</div>

    <p>薄簿仍合着。薄页仍偶尔自己翻一回——她已经明白那不是海在称她的记性有多重；那是薄页自己终于学会自己看自己的样子——像一只终于知道自己不用再等被翻开的鲁鱼。</p>
    <p>影子某天又来了——或者不是影子，而是一段很长的影子的边缘；它停在门外。她没有叫他——她没有打算打开门。她只是对着它的方向站了一会儿，什么也没说，然后她照旧回到窗台边。</p>

    <div class="beat">· · ·</div>

    <p>湿痕不像是盐的印子——更像是有人很早以前在门槛上倒了一小碗海水。那碗水没有等人来接。它就留在那里，干了，湿了，再干了。她把薄簿推到接缝旁——还是没有打开它。</p>
    <p>她偶尔想去看潮水到底是不是把它冲走了——可她还是没有站起来。她不是怕潮水——而是她知道去查，就只剩一道被记下的数字，数字不会替她等什么。</p>
    <p>她仅仅是看着它。</p>

    <div class="beat">· · ·</div>

    <p>潮水退去。门槛前的湿痕更浅了——她蹲下来用手摸了摸那道痕迹——它很凉——那是另一场数字——一种不用手的、也不能用手写的记法。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有去看海。</p>
    <p class="coda">有些痕迹，不必追问来处。</p>
    <p class="coda">止音纪元没有结束。它只是终于在门槛上学会了一句话——先别问，先等。</p>`,
    en: `<p>By daylight, the wet mark remained outside the door. It was faint, almost fainter than the air itself — but it was there. Axi neither opened the door nor the ledger. She rested her hand on the threshold and waited for the tide to recede. The mark grew fainter. Its place did not change.</p>
    <p>She set her hand on the wood — the wood was cold, the way another hand might have been holding hers in return. She did not look into the sea, nor did she look inward. She only sat, waiting for the tide to take the mark with it — or to leave it behind.</p>

    <div class="beat">· · ·</div>

    <p>The ledger stayed closed. The page still turned by itself now and then — she had figured out that this was not the sea weighing her memory; the page had simply learned to look at itself — like a fish that had finally stopped waiting to be looked at.</p>
    <p>The shadow came back one day — or not the shadow, but the edge of a long shadow; it stopped outside. She did not call it — nor did she open the door. She stood for a while in the direction it had come from, saying nothing, and then she went back to the sill as usual.</p>

    <div class="beat">· · ·</div>

    <p>The mark did not look like salt — it looked like someone had spilled a small bowl of sea water on the threshold a long time ago. The bowl had not waited for anyone to come carry it away. It simply stayed there, dried, and got wet again, and dried again. She pushed the ledger beside the seam — still without opening it.</p>
    <p>Now and then she thought of checking whether the tide had finally taken it — but she never rose to look. She was not afraid of the tide — she only knew that if she went to check, the answer would be a number, and a number would not wait for her.</p>
    <p>She only looked.</p>

    <div class="beat">· · ·</div>

    <p>The tide receded. The mark grew fainter still — she knelt and touched it with two fingers — it was cold — another kind of number — a notation that cannot be written by hand, and cannot be read by hand either.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not look at the sea.</p>
    <p class="coda">Some marks need not be asked where they came from.</p>
    <p class="coda">The age of hush has not ended. It has only, at last, learned one sentence by the threshold — first, do not ask; first, wait.</p>`,
  },
  {
    no: 42,
    zhTitle: "门槛上的盐",
    enTitle: "Salt at the Threshold",
    zh: `<p>潮水退后，门槛上的湿痕淡了。阿汐没有擦。薄簿仍合着，页角没有翻动。她从袖里掏出一粒盐——不知是怎么把它藏下来的，也不想为什么——她把它放在湿痕旁边，没有记下它。</p>
    <p>天亮时，盐还在，湿痕也还在。木板被晒得很浅，湿痕呈现出一种很淡的颜色，比潮湿的木板浅一点、比干的也深一点。盐粒看着潮湿的光线，自己也像发光的——它就在那里。</p>

    <div class="beat">· · ·</div>

    <p>渡人某天又停在门口。阿汐没有叫他进来，她也没有出去。她只是隔着门槛看看他——他好像正在数着盐粒笑——他也有一粒盐藏在自己袖子里。他也没有把那粒盐拿出来。</p>
    <p>她想起阿汐小时候母亲曾给过她一粒盐，说：盐会等你回来——它比你以为的耐心长很多。阿汐以为它说的是等饭，或者等池塘里的鱼。她没有真正听懂。也许她今天才懂了一点。</p>
    <p>渡人说：它跟以前是一回事——还是不一样的。他说完就走了，走之前也没有回头。他的背影在她的眼里像一页薄簿慢慢翻走。</p>

    <div class="beat">· · ·</div>

    <p>阿汐又把薄簿拿起来看了一眼。薄页仍一动不动——它仍然是那一页没写下的那一页。她把它放回接缝旁。她慢慢明白：世界的某一页它就是这这样一页——它一直都在等的不是被记住，而是被放着。</p>
    <p>她没有再拿起它。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有看海。</p>
    <p class="coda">有些留下，不必登记。</p>
    <p class="coda">止音纪元没有结束。它只是终于留下了一粒盐——盐不知道它被留下的那天起就开始发光了。</p>`,
    en: `<p>After the tide withdrew, the mark on the threshold grew faint. Axi did not wipe it away. The ledger stayed closed, its page corner still. She took a grain of salt from her sleeve — she had no idea how it had gotten there, nor why she held it — and placed it beside the mark, and did not enter it.</p>
    <p>At dawn, both remained. The boards were bleached pale; the mark showed in a faint shade — paler than damp wood, darker than any dry board. The grain of salt seemed to catch the new light and glow a little on its own — it was just there.</p>

    <div class="beat">· · ·</div>

    <p>One day the ferryman happened by. Axi did not call him in, nor did she come out. She only watched him over the threshold — he seemed to be smiling, as if there were a grain of salt of his own hidden away in his sleeve. He never brought it out either.</p>
    <p>She remembered that, as a girl, her mother had once handed her a grain of salt, saying: salt will wait for you — it is far more patient than you think. Axi had assumed she was talking about rice, or a fish in a pond. She had never really understood. Perhaps, today, she had begun to understand a little.</p>
    <p>The ferryman said: it is the same as before — or not the same. He left after that, without looking back. His back receded from her eyes like a thin page of the ledger turning on its own.</p>

    <div class="beat">· · ·</div>

    <p>Axi lifted the ledger once more and looked at it. The page did not move — it was still the page that had never been written. She set it down beside the seam. She came slowly to know: there is a rule this world runs by — that page is not waiting to be remembered; it is waiting to be held.</p>
    <p>She did not pick it up again.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not look at the sea.</p>
    <p class="coda">Some things remain without being entered.</p>
    <p class="coda">The age of hush has not ended. It has only, at last, left behind one grain of salt — it began glowing the day it was left.</p>`,
  },
  {
    no: 43,
    zhTitle: "未开之页",
    enTitle: "The Unopened Page",
    zh: `<p>门槛上的盐还在。阿汐没有看它，也没有看海。薄簿合着，页角平整。夜里潮水退去，门外多了一道浅浅的干痕。她没有起身。天亮时，干痕仍在，盐粒旁边空着一处。</p>
    <p>她把手放在门槛上——木板的纹理在晨光里一条一条地亮着——那种没有谁去数过的纹路。她伸手想去摸一下那道干痕——但她没有伸手。不是她没想伸手——是她知道伸手就会让它变成手的一部分——而她想让它继续是它自己的东西。</p>

    <div class="beat">· · ·</div>

    <p>薄簿仍合着。薄页——她把它看作一页海的信封——什么时候会打开，她从来没有被告诉过。她渐渐懂了，她根本不用被告诉。她只是等——等没有人需要教的一件事。</p>
    <p>影子某天又短了一寸。或者不是短了——是淡了一寸。她没有站起来问——她知道如果问，它就变成了她必须决定要不要回答的问题。她就继续等——看着它本身就够了。</p>

    <div class="beat">· · ·</div>

    <p>渡人某天说：有些页不写，也是纸在呼吸。他说他看见过一本册子，它整本都在替它本来应该装着的东西呼吸。页没有颤——页只是呼吸。</p>
    <p>她想——纸在呼吸——她用了很久才明白。薄页没翻开——页面没被人读过——可薄页每一秒都在变。纸张也会厌倦——或者不——纸也许不会厌倦，只是时间会穿过纸，把纸磨得更薄……或者更厚。她没有去查那个是哪种。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有去看海。</p>
    <p class="coda">有些页，不必翻开才算留下。</p>
    <p class="coda">止音纪元没有结束。它只是终于翻开了它自己的薄页——没人记得什么时候翻的。</p>`,
    en: `<p>The salt remained on the threshold. Axi looked neither at it nor at the sea. The ledger was closed, its page corner flat. At night the tide receded, leaving a faint dry mark outside the door. She did not rise. By dawn it remained, with an empty space beside the grain.</p>
    <p>She kept her hand on the threshold — the boards' grain lit up in the morning light, one line at a time, uncounted. She wanted to reach and touch the dry mark — but she didn't. Not because she didn't want to — she knew that to touch it would make it part of her hand — and she wanted it to keep belonging to itself.</p>

    <div class="beat">· · ·</div>

    <p>The ledger stayed closed. The page — she thought of it as a letter the sea had never sent — when it would open, no one had ever told her. She had come slowly to know she did not need to be told. She only waited — waited for the one thing no one had ever had to teach her.</p>
    <p>The shadow had shrunk by an inch, or rather, had faded by an inch. She did not rise to ask — she knew that if she asked, it would become a question she would have to decide to answer. She kept waiting — watching it was enough.</p>

    <div class="beat">· · ·</div>

    <p>One day the ferryman said: some pages, unwritten, are paper breathing. He said he had once seen a book that breathed for everything it should have held. The pages never trembled — the pages only breathed.</p>
    <p>She thought about it — paper breathing — it took her a long time. The page did not open — no one read it — and yet the page was changing every second. Paper can grow tired too — or perhaps not — perhaps it simply allows time to wear through it, thinner and thinner… or thicker. She didn't investigate which.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not look at the sea.</p>
    <p class="coda">Some pages remain without being opened.</p>
    <p class="coda">The age of hush has not ended. It has only, at last, opened its own thin page — and no one remembers when.</p>`,
  },
  {
    no: 44,
    zhTitle: "未寄出的信",
    enTitle: "The Unsent Letter",
    zh: `<p>薄簿仍合着。门槛边多了一张干纸，没有字，也没有折痕。阿汐没有拾起它。潮水退去时，纸的一角沾了盐；潮水回来时，盐留在纸上，纸没有湿。渡人经过门口，没有停船。他只看了一眼，便沿着水路继续走。天亮后，纸还在那里。</p>
    <p>她把手放在门口——风从门缝里经过——她没有替那张纸按一下，也没有替它寄一下。她只是站在那里，看着它像看一个从很久以前就躺在门口、今天才被潮水推回来的朋友。</p>

    <div class="beat">· · ·</div>

    <p>薄簿仍是那本薄薄的书。薄页仍然偶尔自己翻一回。她觉得那封信的干和薄页的开合之间有一种很深的对应——都是身体不用别人帮忙自己在等。船没有停——薄簿没有开——她也没有伸手。</p>
    <p>渡人的船哪一天会再停在她的门口——没有人知道。她不想问。问就是为了要答案——可答案已经在纸里了——只是她不用读。她慢慢明白：世界上的有些信，寄出的途径只是「留在那里」。</p>
    <p>她把薄簿收起来没有再动。她偶尔想：今天要不要数一数门口的潮水？可她数到第四次就不数了——数字是海的事——不是她的。</p>

    <div class="beat">· · ·</div>

    <p>盐粒——她总说盐粒像它自己一样——看着潮水来回——但是纸没有湿——说明它比潮水更硬——也比风更轻——只是到了这个门槛这里。</p>
    <p>她看着那封没寄出的信。薄簿仍合着。她站在门口——她慢慢知道：未寄出的信，也是信——虽然没有告诉任何人——仍然在捎带着什么。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有走近它。</p>
    <p class="coda">有些信，留下来并不等于寄出。</p>
    <p class="coda">止音纪元没有结束。它只是终于收到了一封没寄出也不必收的信。</p>`,
    en: `<p>The ledger stayed closed. Beside the threshold lay a dry sheet, without words or folds. Axi did not pick it up. When the tide receded, salt marked one corner; when it returned, the salt stayed and the paper remained dry. The ferryman passed without stopping. By dawn, the sheet was still there.</p>
    <p>She set her hand on the doorway — wind moved through the seam — she neither pressed the paper nor sealed it to be sent. She only stood there, watching it as one watches an old friend who had spent so long at sea, and had only just now been washed ashore.</p>

    <div class="beat">· · ·</div>

    <p>The ledger remained thin and closed. Its page still turned by itself now and then. She felt there was a very deep symmetry between the dryness of the letter and the opening and closing of the page — both are waiting, without a hand to help. The boat went by — the ledger stayed shut — she did not lift a finger.</p>
    <p>No one knew when the ferryman's boat would halt at her door next. She did not want to ask. To ask would be to want an answer — but the answer was already on the paper — she simply did not have to read it. She came slowly to know: some letters, in this world, are simply delivered by being left where they lie.</p>
    <p>She left the ledger shut and did not move it again. Now and then she thought: maybe today I'll count the tides? But by the fourth count she stopped — numbers are the sea's affair — not hers.</p>

    <div class="beat">· · ·</div>

    <p>The grain of salt — she always said it looked like itself — watched the tide come and go, while the paper did not get wet — it was harder than the sea — lighter than the wind — it had only, in the end, made its way to this threshold.</p>
    <p>She looked at the unsent letter. The ledger stayed closed. She stood at the door — she came slowly to know: an unsent letter is still a letter — even if no one has been told — it still carries something.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not step closer.</p>
    <p class="coda">Some letters remain without being sent.</p>
    <p class="coda">The age of hush has not ended. It has only, at last, received a letter that was never sent, and never needed to be.</p>`,
  },
  {
    no: 45,
    zhTitle: "空秤之后",
    enTitle: "After the Empty Scale",
    zh: `<p>薄簿仍合着。门槛边的信没有字，盐留在纸角。薄页偶尔自己翻过去一回，又翻回来了——阿汐没有管那些力。她把门开着，直到潮水退去。纸没有动，盐也没有落下。</p>
    <p>她把手放在门口——风从缝里经过，什么声音也没发出——她知道如果她替那封信塞一下，它就不再是一封没有上过路的信；也许它一直不想上路；也许它只想就放在那里。她只是看着它。</p>

    <div class="beat">· · ·</div>

    <p>渡人的船从门外经过，没有停。他看见纸角多了一道浅痕——像秤盘曾经放在那里——他想了一下，然后又沿着水路走了。他本可以停下来问她要不要把信寄出去——他知道最要紧的不是知道寄不寄——而是那封信已经放在它该放的位置。</p>
    <p>薄簿页角——扁平的——也像那封纸。她同时看了一眼二者——每件东西似乎都有一份「不用被打开」的体面感——比如母亲那一口老箱子——她从不打开——里面装的是什幺她从未问过——它是那种永远放在一口大小，永远不愿意被打开。</p>

    <div class="beat">· · ·</div>

    <p>盐——她看见盐像是在纸上打了一个底——换句话说，那封纸从干到潮，从潮到干——它根本就没打算动——只是想——其实不需要动——其实它哪儿也没打算去。她只是盯着它——它慢慢不动的灯光——像海波本身。</p>
    <p>阿汐把薄簿放回接缝旁。她想：什么时候该收起这本册子了？——又想：什么时候该走了？——又想：什么时候这一片海就不再听她的问什么了？——又想：也许永远不。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有去看海。</p>
    <p class="coda">有些东西经过，不必留下重量。</p>
    <p class="coda">止音纪元没有结束。它只是终于放下了一杆没有被称过的秤——和一封没有被拆封的信。</p>`,
    en: `<p>The ledger stayed closed. The letter by the threshold had no words; salt remained on one corner. Now and then the page corner turned on its own — and turned back again; Axi did not interfere with any of that. She left the door open until the tide withdrew. The paper did not move, and the salt did not fall.</p>
    <p>She set her hand on the doorway — the wind passed through the seam without making a sound — she knew that if she were to press into the letter, it would stop being a letter that had never been sent; perhaps it had always meant not to be sent; perhaps it only wanted to stay exactly where it lay. She only watched it.</p>

    <div class="beat">· · ·</div>

    <p>The ferryman passed without stopping. He saw a faint mark on the corner, as if a scale had once rested there — he considered — and moved on along the water road. He could have stopped and asked whether she wished the letter sent — he knew the important thing was not whether she wished to send it — the important thing was that it was exactly where it belonged.</p>
    <p>The corner of the thin ledger — flat — also resembled the paper. She looked at both of them together — everything in the room seemed to have the dignity of not being opened — like her mother's old trunk — she never opened it — what was inside, she never asked — it was a thing whose whole life was staying in one place, never to be opened.</p>

    <div class="beat">· · ·</div>

    <p>The grain of salt — she saw it as the bottom of the letter itself — that is to say, the paper had gone from dry to damp and back to dry all by itself — it never meant to move — it simply never cared to — it never intended to go anywhere. She only watched it — it held its own quiet light — like a small spoon of the sea.</p>
    <p>Axi set the ledger back beside the seam. She thought: when should this book be finally shut? — and then: when should I finally leave? — and then: when would this sea stop listening to my questions? — and then: perhaps never.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not look at the sea.</p>
    <p class="coda">Some things pass without leaving a weight.</p>
    <p class="coda">The age of hush has not ended. It has only, at last, laid down a scale that was never used — and a letter that was never opened.</p>`,
  },
  {
    no: 46,
    zhTitle: "未摆的一次",
    enTitle: "The Unmade Swing",
    zh: `<p>秤盘仍空着，盐粒留在原处。阿汐没有去看海。清晨，钟摆渡人的船停在门外，船上没有人，也没有桨。她没有叫他。潮水退去时，船仍停着；潮水回来时，船底多了一道浅痕。她把薄簿放在门槛边，没有翻开。那天，钟摆没有摆动。</p>
    <p>她把薄簿放在门槛边——她往里看了一眼——薄簿合着的那一页，她仍然不知道它能不能被她看懂——也许它——她觉得它不需要被她看懂——它就只需要被合着。她没有叫渡人——不是不想叫——是她知道一旦叫了，摆可能会动——她想知道摆不动是什么样子——只是想知道——真的想知道——不是逃——是察看。</p>

    <div class="beat">· · ·</div>

    <p>薄簿合着。薄页偶尔也会自己翻过去一回。她看它像是在数某种她不懂的东西——比如潮水退去的次数——又比如浪带走的盐——又比如那一杆从没有人用过的秤还会用几次——她慢慢明白：薄页其实也在学——它在一格一格地学她的耐心。她的耐心从来都是它的教材。</p>
    <p>船在门口待了很久。渡人没有出现，也没有向她挥手。也许他不是渡人——也许他只是一艘船。她没有去查那个——只是看着——没有去查——就够了。</p>

    <div class="beat">· · ·</div>

    <p>那一天，钟摆没有摆动——她当真没动——海也没有动——连那粒盐都没有——谁都没动——只是薄页——慢慢合着——那种按顺序在等——那种不催的人在等。</p>
    <p>她自己也没有数一件事情——她以前最爱数——海潮一号二号三号五号九号——她偶尔也会数——但她从来不在决定前数——她只是看——她觉得数到九的时候就不数了。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有去看海。</p>
    <p class="coda">有些停下，不必有人接手。</p>
    <p class="coda">止音纪元没有结束。它只是终于留下了一条没有摆过的钟——和一条没有坐过的船。</p>`,
    en: `<p>The scale pan remained empty; the grain of salt stayed where it was. Axi did not look toward the sea. At dawn, the Pendulum Ferryman's boat stopped outside the door. It held no one and no oar. She did not call to him. The boat remained through the ebb. When the tide returned, a faint mark showed beneath its hull. She set the thin ledger by the threshold and left it closed. That day, the pendulum did not swing.</p>
    <p>She set the ledger on the threshold — she looked inside — the page that faced up she still did not know whether she could read; perhaps not — she suspected it was not meant to be read — it was only meant to remain closed. She did not call the ferryman — not because she did not want to — she knew that if she called, the pendulum might swing — she wanted to know what it felt like when it did not swing — she only wanted to know — really to know — not to escape, but to observe.</p>

    <div class="beat">· · ·</div>

    <p>The ledger stayed closed. The page sometimes turned by itself — she watched it as if it were counting something she did not understand — perhaps the times the tide had gone out — perhaps the salt the waves had carried away — perhaps the number of times the unused scale would ever be used — she came slowly to understand that the page, too, was learning — it was learning one cell at a time the patience of her. Her patience was the material it studied.</p>
    <p>The boat sat there for a long, long time. The ferryman never appeared, nor did he wave to her. Perhaps he was not the ferryman — perhaps he was only a boat. She did not investigate — she only watched — no investigation — was enough.</p>

    <div class="beat">· · ·</div>

    <p>That day, the pendulum did not swing — really it did not swing — nor did the sea swing — nor did the grain of salt — nobody moved — only the page — slowly stayed closed — the kind of waiting that goes in order — the waiting of those who never hurry.</p>
    <p>She did not count a single thing — she used to be the most counting person in the world — tides one, two, three, five, nine — she still sometimes counted — but she never counted before deciding — she only looked — she had decided that by the ninth, she would stop counting.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not look at the sea.</p>
    <p class="coda">Some things may stop without being handed on.</p>
    <p class="coda">The age of hush has not ended. It has only, at last, left behind a bell that was never swung — and a boat that was never ridden.</p>`,
  },
  {
    no: 47,
    zhTitle: "船底的干痕",
    enTitle: "The Dry Mark Beneath",
    zh: `<p>船仍停在门外，船底那道浅痕没有被潮水带走。阿汐没有去摸。薄簿合着，秤盘空着。天亮时，门槛上的盐粒少了一粒；没有人知道它去了哪里。</p>
    <p>她没有站起来，也没有问谁会来问——她看着它像看一只布满海盐的小鹦鹉——它看着海——它把它自己也记进了薄簿。她没有去摸那道浅痕——也许摸一下它就变成了她今天的入口——而她今天根本不想问任何问题。她今天只是看——就够了。</p>

    <div class="beat">· · ·</div>

    <p>薄簿仍合着。薄页——她现在愿意替它说一句——它是一只从来不会等任何人翻开的书。她合着它——合到它变成她口袋里的一页纸——不必带走——不必留着——只是放在那里。她也不再怀疑那一点。</p>
    <p>那粒盐——它到底去了哪里——她偶尔想起——然后停下——她忽然觉得那颗盐粒只是换了一个位置——也许它在海里了——或者在某只她不认识的鸟的脚上——她忽然觉得那只鸟从大海飞过——它那时碰到了那粒盐。它什么时候才回来——她没办法说。</p>

    <div class="beat">· · ·</div>

    <p>船底的干痕——潮水退去时——又显了一寸——她看得见它——也能看不见它——船没动——她也没动——只是两件事情慢慢被海说明白了。</p>
    <p>她没问渡人——渡人也没再来过——她不觉得他不会再来——她只是知道问不出来。她偶尔想：如果这一只船从头到尾——只来过这么一次——那么还需要——被记下吗？她没有答自己。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有去看海。</p>
    <p class="coda">有些空处，不因少了一粒而变大。</p>
    <p class="coda">止音纪元没有结束。它只是终于留下一道不用任何人记下的船底——和一只不再在谁的精算里的潮汐。</p>`,
    en: `<p>The boat remained outside. The faint mark beneath its hull had not been taken by the tide. Axi did not touch it. The ledger stayed closed; the scale pan stayed empty. At dawn, one grain of salt was missing from the threshold. No one knew where it had gone.</p>
    <p>She did not rise, nor did she ask who might come by — she watched it the way one watches a small parrot dusted with salt — it watched the sea — it had recorded itself in the ledger. She did not touch the faint mark — perhaps touching it would make it the door of her day — and today she did not want to ask any questions. She only watched. That was enough.</p>

    <div class="beat">· · ·</div>

    <p>The ledger stayed closed. The page — she was now willing to say of it — was a book that had never waited for anyone to open it. She kept it closed — she kept it closed until it became a thin page in someone's pocket — no need to carry — no need to keep — only to exist. She no longer doubted that.</p>
    <p>The missing grain — where had it gone — she sometimes thought — and stopped — she suddenly realised that single grain had only relocated — perhaps it was in the sea again — or on the foot of a bird she did not know — she realised that bird had flown across the sea — she had bumped into the grain. When it would return, she could not say.</p>

    <div class="beat">· · ·</div>

    <p>The dry mark beneath the hull — when the tide withdrew — showed another inch — she could see it — or she could not — the boat did not move — she did not move — only two things were slowly becoming clear to the sea.</p>
    <p>She did not ask the ferryman — no ferryman came back — she did not think he would never come back — she only knew she could not ask. She sometimes thought: if this boat had only been here once in all the world — should it even be remembered? She did not answer herself.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not look at the sea.</p>
    <p class="coda">Some empty spaces do not grow when a grain is gone.</p>
    <p class="coda">The age of hush has not ended. It has only, at last, left behind a hull that no one ever needed to record — and a tide that will no longer count as someone's variable.</p>`,
  },
  {
    no: 48,
    zhTitle: "未问之船",
    enTitle: "The Unasked Boat",
    zh: `<p>船仍停在门外。潮退时，船底的干痕露出一寸；潮涨时，它没有消失。阿汐没有问船要去哪里。薄簿合着，秤盘空着。小雪捂过的窗台仍在干痕的位置稍往上。天亮后，门槛上的盐少了一粒。她没有寻找。</p>
    <p>她偶尔想过去看——她已经看过太多次——其实她每一眼都是不同的。——她没有站起来——她不是懒——也不是怕——只是她知道一旦走到门槛那边——她可能会不小心数。——她不想数。——她现在已经是知道不数的那种人。</p>

    <div class="beat">· · ·</div>

    <p>薄簿仍合着。薄页偶尔也会翻一回。她看着它翻一回又合住——她注意到每次翻开的位置不一样——她不知道是不是——也许它也在自己记自己。——她不去求证。——她知道求证——就是又要开始问——她现在不想问。</p>
    <p>母亲——已经在她的故事里很久了——她也不常去想她了——但她偶尔又会想起一句：册子——它会自己翻——亲爱的——册子永远知道。她记了很久这句话。——她一直不知道到底册子是不是知道。——今天她没有看母亲。</p>

    <div class="beat">· · ·</div>

    <p>潮涨时·潮退时·干痕露了一寸·墨纹从海水中浮出来——她看它像母亲册子上的一行——可她不识那行——可她记得那样的笔顺——两个钩——三条平——没人会写——其实她知道——其实她知道不用写。</p>
    <p>她今天没有去看海。——她今天只是坐着——坐在一个冬天的窗下——等着——她也不知道等的是什么——她也不知道什么时候会开始做下一件她不敢做的事——她只是等。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有去看海。</p>
    <p class="coda">有些船停着，不等人问。</p>
    <p class="coda">止音纪元没有结束。它只是终于留下一只没有问过谁的船——和一本只被合着的薄簿。</p>`,
    en: `<p>The boat remained outside. At ebb, an inch of the dry mark beneath its hull showed; at flood, it did not disappear. Axi did not ask where the boat was bound. The ledger stayed closed, the scale pan empty. Snow had touched the sill one finger's width above the place where the mark lived. By dawn, one grain of salt was gone from the threshold. She did not look for it.</p>
    <p>She sometimes thought of getting up to look — she had looked many times — actually each glance was slightly different. She did not rise — not from laziness — not from fear — she only knew that if she went as far as the threshold — she might accidentally start counting. She did not want to count. She was now the kind of person who did not count.</p>

    <div class="beat">· · ·</div>

    <p>The ledger stayed closed. The page still turned by itself now and then. She watched it turn and close again — she noticed it opened at a different place each time — she did not know whether that was possible — perhaps the page was recording itself. She would not verify. She knew that to verify would mean to start asking again — she did not want to ask right now.</p>
    <p>Her mother — has been in her stories for a long time now — she did not often think of her again — but now and then she remembered one line: the book — it will turn on its own — my dear — the book always knows. She had memorised that sentence a long time ago. She still never knew whether the book really knew. She did not ask her mother today.</p>

    <div class="beat">· · ·</div>

    <p>When the tide came in — when it went out — the mark revealed one inch — a pattern like a single line of calligraphy emerged from the seawater — she read it as one line of her mother's book — but she could not read what it said — she recognised only the gesture — two hooks — three flat strokes — no hand writes that — actually she knew — actually she knew not to write.</p>
    <p>She did not go and look at the sea today. She only sat — in front of a winter window — waiting — she did not know what she was waiting for — she did not know when she would begin the next thing she had not dared to do — she only waited.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not look at the sea.</p>
    <p class="coda">Some boats stay without waiting to be asked.</p>
    <p class="coda">The age of hush has not ended. It has only, at last, left behind a boat that was never asked — and a ledger that was only ever closed.</p>`,
  },
  {
    no: 49,
    zhTitle: "船上的空处",
    enTitle: "The Place Aboard",
    zh: `<p>船仍停在门外。天亮时，船舱里多了一处干痕，形状刚好容下一粒盐。阿汐没有把盐放进去。潮来时，干痕还在。</p>
    <p>她看见它是在打水回来的路上——她只是把目光放得很低——怕它会以为她在探它——她没有停下来——也没有走近——她只是把那个位置记住了——然后像往常一样走回了屋。她的脚步没有快——也没有慢——她现在已经知道太快和太慢都是一种问法。</p>

    <div class="beat">· · ·</div>

    <p>薄簿仍合着。她有一次几乎伸手去翻它——手伸到一半——停住了——她只是想知道空处的形状——她坐在手边——手放回到膝上——薄页没动。她没有告诉任何人——她也没有打算告诉。</p>
    <p>那粒盐——它到底去了哪里——她早已不再追问——她只是记得门槛上少的是一粒——而这只船里多出的一处刚好。她没有想太多。——她只是在烧水的时候——把手停在旧门槛的位置——然后放开——她只是停了一瞬——没有任何仪式。</p>

    <div class="beat">· · ·</div>

    <p>潮来了。——干痕还在。——她看着海——海没有回应——她也不期待回应。——母亲说过：册子——它会自己翻——亲爱的——册子永远知道——她想：大概空处也是——它们自己知道——等或不等——它们都不急。</p>
    <p>她没有把盐放进去。——不是不敢——不是舍不得——是她知道放进去——它就成为了一个答案——而她今天——是不想要答案的那一天。——她只是在那里坐着——坐在一个没有问号的上午——直到光从窗台挪开了一寸。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有去看海。</p>
    <p class="coda">有些空处，不等东西来填。</p>
    <p class="coda">止音纪元没有结束。它只是终于留下一处容得下一粒盐的干痕——和一个仍然留在门外的答案。</p>`,
    en: `<p>The boat remained outside. At dawn, a dry mark lay inside its hull, just large enough for a grain of salt. Axi did not place one there. When the tide returned, the mark remained.</p>
    <p>She noticed it on the way back from the well — she held her gaze low — afraid it might think she was probing it — she did not stop — neither did she come closer — she only noted the place — and walked back into the house as she always did. Her step was neither fast nor slow — she now knew that both fast and slow were forms of asking.</p>

    <div class="beat">· · ·</div>

    <p>The ledger stayed closed. Once, she almost reached to open it — her hand had gone halfway — and stopped — she only wanted to know the shape of the empty place — she sat beside her hand — and put it back onto her knee — the page did not move. She told no one — and had no intention of telling.</p>
    <p>The grain of salt — where had it gone — she no longer pursued it — she only remembered what was missing from the threshold was one grain — and what had appeared in the hull was exactly one shape. She did not think much of it. Only, as she put the water on — she paused her hand above the old threshold — and let it go — she only stopped for a moment — no ceremony of any kind.</p>

    <div class="beat">· · ·</div>

    <p>The tide came in. — The mark remained. — She watched the sea — the sea gave no answer — she expected none. — Her mother had said: the book — it will turn on its own — my dear — the book always knows — she thought: perhaps the empty places are the same — they know — waiting or not — they are in no hurry.</p>
    <p>She did not place the salt inside. — Not from fear — not from reluctance — she knew that to place it there would make it into an answer — and today — she did not want an answer. — She only sat there — on an unpunctuated morning — until the light moved one finger's width off the sill.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not look at the sea.</p>
    <p class="coda">Some empty places do not wait to be filled.</p>
    <p class="coda">The age of hush has not ended. It has only, at last, left behind a dry mark exactly large enough for one grain of salt — and an answer that still stays outside the door.</p>`,
  },
  {
    no: 50,
    zhTitle: "盐未上船",
    enTitle: "Salt Not Aboard",
    zh: `<p>潮水退去，船舱里的干痕还在。阿汐把盐放在门槛上，没有带到船边。船没有动。薄簿仍合着。后来潮水回来，盐少了一角，干痕没有变。她没有记下是哪一刻少的。</p>
    <p>她把那包盐放在门槛上已经是第三天——也不是刻意——只是她从灶上拿盐出来——本想顺手收进灰罐——手伸到一半——忽然停住了——她把它搁在了门槛上——然后没有想太多——只是第二天——它还在——第三天——多了一个角。她记得——也不强迫自己记得太清楚。</p>

    <div class="beat">· · ·</div>

    <p>船没有动。——它从没有动过——它也不需要动。——她现在已经不再替它着急——她只是偶尔从窗边看过去——它在——她就退回屋里——她不记得自己是什么时候学会不多看的。</p>
    <p>薄簿仍合着。——她有一个上午几乎要翻开——她想记下那一角盐是怎么少的——她想了想——又把手收了回来——她忽然觉得——记下来——它反而就成了证词——而她不想当证人——她只是想当看着海的人。</p>

    <div class="beat">· · ·</div>

    <p>有一天她发现那包盐少的又多了一角——她没有声张——她甚至没有去看海了一眼——她只是在烧水的时候——把旧火调小了一档——仿佛替窗外那些没有名字的东西——留一点安静。</p>
    <p>母亲的话偶尔又回来——册子——它会自己翻——亲爱的——册子永远知道——她这回没有立刻回答——她只是望着门槛上那一角——小了一点的盐——她心里想：也许它们是一起走的——她不需要谁先谁后——东西只要动了——就不必问是哪一刻。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有去看海。</p>
    <p class="coda">有些东西，不必同时抵达。</p>
    <p class="coda">止音纪元没有结束。它只是终于留下一包没有上船的盐——和一道没有变的干痕。</p>`,
    en: `<p>At ebb, the dry mark remained inside the boat. Axi left the salt on the threshold, not aboard. The boat did not move. The ledger stayed closed. When the tide returned, one corner of the salt was gone, but the mark had not changed. She did not record when it happened.</p>
    <p>The packet of salt had been on the threshold for three days — not by design — she had taken it from the stove shelf — meaning to tuck it back into the ash jar — her hand stopped halfway — and she set it down upon the threshold instead — thought little of it — and only noted, the second day — it was still there — the third — one corner was missing. She remembered — or chose not to remember too clearly.</p>

    <div class="beat">· · ·</div>

    <p>The boat did not move. — It never had. — It did not need to. — She had stopped worrying it for ages — she would only glance out from beside the window now and then — it was still there — she would step back in — she could not remember when she had learned not to look for too long.</p>
    <p>The ledger stayed closed. — One morning she almost opened it — wanting to record how the corner had gone — she thought again — and drew her hand back — she suddenly realised — to record it — would make it into testimony — and she did not want to be a witness — she only wanted to be someone watching the sea.</p>

    <div class="beat">· · ·</div>

    <p>One day the corner was smaller again — she did not make a fuss — she did not even glance toward the sea — she only, while the water was on, turned the old flame down one notch — as if to leave a little quiet for the nameless things outside.</p>
    <p>Her mother's whisper wandered back — the book — it will turn on its own — my dear — the book always knows — this time she did not answer at once — she only regarded the threshold and that ever-diminishing corner of salt — thinking: perhaps they travel together — it does not matter who arrives first — things that are already on their way need not be accounted for by the moment.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not look at the sea.</p>
    <p class="coda">Some things need not arrive together.</p>
    <p class="coda">The age of hush has not ended. It has only, at last, left behind a packet of salt that never boarded — and a dry mark that never changed.</p>`,
  },
  {
    no: 51,
    zhTitle: "船未启",
    enTitle: "The Boat Still",
    zh: `<p>潮退时，船底的干痕仍在。门槛上的盐少了一角，阿汐没有补齐。她把水壶放回原处，听见船板在潮气里轻轻收紧。船没有启程，门也没有关。天亮后，水壶旁多了一粒盐。她没有问它从哪里来。</p>
    <p>她是在烧水的时候听见那声响的——不是吱呀——是很轻的一声——像木头替潮气道了一声晚安——她没回头——也没有想回头——她只是把水壶稳稳地放回原处——手掌在壶底停了一瞬。她知道有些声音不需要她认出来。</p>

    <div class="beat">· · ·</div>

    <p>门槛上的盐仍少着一角。——她没有补齐——也不是因为舍不得——是她忽然觉得不补齐——它才像一个可以继续被记住的形状。——她有过几次想补的念头——手伸到半路——又收回来——她冲自己摇了摇头——她觉得那一角少的形状——已经是她的一部分了。</p>
    <p>薄簿仍合着。——她没有翻——她也不再想翻——她觉得有些账——不必落笔——有些事——不必知道是谁记下了它们。——她偶尔会笑——对着窗外那只不动的船——她已经不再需要它动了。</p>

    <div class="beat">· · ·</div>

    <p>天亮后水壶旁多了一粒盐。——她看着它——它很小——像一只微微眯起的眼睛——她认得那副样子——她不知道它是昨夜少的那一角——还是新来的。——她没有问——她也不想知道——她只是把它留在那里。</p>
    <p>母亲的声音偶尔又回来——册子——它会自己翻——亲爱的——册子永远知道——这回她甚至没有停——她只是往柴灶里添了一根柴——她心里说：那就让它们先路过吧——她早就不打算在这扇门上挂任何问号了。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有去看海。</p>
    <p class="coda">有些东西回来，不必经过门。</p>
    <p class="coda">止音纪元没有结束。它只是终于留下一只没有启程的船——和一粒不必问来历的盐。</p>`,
    en: `<p>At ebb, the dry mark beneath the boat remained. One corner of the salt on the threshold was gone; Axi did not replace it. She put the water jar back and heard the boards tighten in the damp. The boat did not leave. The door stayed open. By morning, one grain of salt lay beside the jar. She did not ask where it came from.</p>
    <p>She heard the sound as the water came to a boil — not a groan — a single hush of a tone — as though the wood had wished the damp a good night — she did not turn — she did not think to — she only set the water jar steadily back in its place — her palm stayed upon its base for a moment. She knew some sounds did not require her to name them.</p>

    <div class="beat">· · ·</div>

    <p>The corner on the threshold was still missing. — She did not replace it — not out of scarcity — she had come to feel that, unpaired, it kept a shape worth remembering in. — She had tried — hand halfway to the jar — before drawing it back — shaking her head — deciding, quietly, that the missing corner had already become part of her.</p>
    <p>The ledger stayed closed. — She did not open it — and no longer wanted to — she felt that some accounts needed no ink — that some things might already be recorded by someone, somewhere — she laughed now and then — at the motionless hull out there — already certain she no longer needed it to move.</p>

    <div class="beat">· · ·</div>

    <p>By morning a grain of salt lay beside the jar. — She regarded it — it was very small — like a slightly narrowed eye — she recognised the posture — she could not tell whether it belonged to the missing corner from the night before — or had only arrived now. — She did not ask — she did not want to know — she only left it where it was.</p>
    <p>Her mother's voice drifted back now and then — the book — it will turn on its own — my dear — the book always knows — this time she did not even pause — she only fed one more stick into the stove — thinking: let them pass through first — she had long since stopped hanging question marks upon this door.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not look at the sea.</p>
    <p class="coda">Some things return without crossing the door.</p>
    <p class="coda">The age of hush has not ended. It has only, at last, left behind a boat that never set out — and a grain of salt that asked for nothing.</p>`,
  },
  {
    no: 52,
    zhTitle: "壶边",
    enTitle: "Beside the Jar",
    zh: `<p>水壶旁的盐粒还在。阿汐没有收起它。清晨，她把壶移开，木板上留着一圈浅印；盐粒没有滚动，印子也没有合拢。她把壶放回原处，没去数那圈印有几道。门外的船仍停着。潮水来过，船底的干痕没有变。</p>
    <p>她是在擦桌子的时候注意到它仍在——它没有挪动分毫——它也没有理由挪动——它就是那样——安稳地——待在壶边——像一个不需要任何人签收的来信。她擦完了桌子——又擦了壶身——没有去擦那些印子——也没有打算擦。</p>

    <div class="beat">· · ·</div>

    <p>那一圈浅印——她后来常看见——每次多看一眼——它就好像多开了一点——也好像没有——她分不清——她也不想分清——她只是觉得——有些印子——本来不是为了被丈量才出现的。</p>
    <p>薄簿仍合着。——她偶尔想过拿它记一笔——笔搁在纸上——却没有落下——她忽然觉得这一笔要是落下——这圈印子就成了证词了——而她不想当证人。——她把笔放回去——它又安静了。</p>

    <div class="beat">· · ·</div>

    <p>潮水来过几次——她没有特意去数——每一次回来——壶边的盐——还是那样——门外那只船——还是那样——她也没有再替它们数。——她现在已经是这样的人——不计数——只看。</p>
    <p>母亲的话偶尔又回来——册子——它会自己翻——亲爱的——册子永远知道——这回她几乎是含笑了——她想：那它们自己也知道什么时候该停什么时候不该停。——她没有说出声——灶火正旺——她只是添了一根柴。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有去看海。</p>
    <p class="coda">有些印子，不必围住什么。</p>
    <p class="coda">止音纪元没有结束。它只是终于留下一粒留在壶边的盐——和一圈没有合拢的浅印。</p>`,
    en: `<p>The grain of salt remained beside the water jar. Axi did not put it away. At dawn she moved the jar, leaving a pale ring on the boards. The grain did not roll; the ring did not close. She returned the jar and did not count its edges. Outside, the boat remained. The tide came, and the dry mark beneath its hull did not change.</p>
    <p>She noticed it while wiping the table — it had not moved at all — it had no reason to — it was simply there — settled, quietly — beside the jar — like a letter that needed no signature. She wiped the table — then the jar itself — but spared no wipe for the ring — she never meant to.</p>

    <div class="beat">· · ·</div>

    <p>That pale ring — she would see it often later — each time she looked longer, it seemed to open a little wider, or perhaps not — she could not tell — she did not want to — it seemed to her — that some marks were never meant to be measured into being.</p>
    <p>The ledger stayed closed. — She considered once, briefly, jotting one line — the pen rested above the page — but never landed — she realised, suddenly, that to land would turn the ring into testimony — and she did not want to be a witness. — She set the pen back — and the house went still again.</p>

    <div class="beat">· · ·</div>

    <p>The tide came and went — she did not count the times — each time it returned, the salt beside the jar remained as it was — the boat outside remained as it was — she no longer counted for them either. — She had become that kind of person — she did not count — she only watched.</p>
    <p>Her mother's whisper circled back — the book — it will turn on its own — my dear — the book always knows — this time she almost smiled — she thought: then perhaps they know their own stopping and their own not-stopping as well. — She did not say it aloud — the stove flame was high — she only fed one more stick into it.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not look at the sea.</p>
    <p class="coda">Some marks need not enclose anything.</p>
    <p class="coda">The age of hush has not ended. It has only, at last, left behind a grain of salt resting beside the jar — and a pale ring that never closed.</p>`,
  },
  {
    no: 53,
    zhTitle: "圈印",
    enTitle: "The Ring",
    zh: `<p>船底的干痕还在，水壶旁的那粒盐也还在。清晨，阿汐把壶移开，木板上留着一圈浅印；盐粒没有滚动，印子也没有合拢。薄簿仍合着；船仍停在门外。她没有数那圈印。</p>
    <p>这一回她没有立刻放回去——她把手停在半空——像在读一封只有一个字的信——然后她慢慢把壶搁回原处——壶底低低碰了一下木板——那圈印没有变——它只是原地缓缓开了半分。她后来没有再动过它。</p>

    <div class="beat">· · ·</div>

    <p>那圈印——她烧水的时候常瞥它一眼——它像一只没有说出任何话的嘴——她不确定自己是不是也被它看着——她几乎觉得它有自己的呼吸——她笑了一下——把火调小了一格。</p>
    <p>薄簿仍合着。——她有一次把它翻开到最后一页——什么都没写——她看着那一页——忽然心里平静下来——仿佛整本册子都在替她说：不必留名。——她合上了。放回原处。——它只轻轻合了一下——像一次呼气。</p>

    <div class="beat">· · ·</div>

    <p>潮水又一次退去。——船底的干痕没有变。——她没有出门看它——她知道它没有变——知道——就是没有变的另一种形式。</p>
    <p>母亲的话浮起来——册子——它会自己翻——亲爱的——册子永远知道——她这回没有回应——也没有不回应——她只是望着那圈印——心里说：行吧——你们自己看着办。——灶火跳了一下。柴尽了。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有去看海。</p>
    <p class="coda">有些印子，不等它合拢。</p>
    <p class="coda">止音纪元没有结束。它只是终于留下一圈不打算合拢的浅印——和一粒不急着离场的盐。</p>`,
    en: `<p>The dry mark beneath the boat remained, and so did the grain of salt beside the jar. At dawn, Axi moved the jar, leaving a pale ring on the boards. The grain did not roll, and the ring did not close. The ledger stayed shut; the boat remained outside. She did not count the ring.</p>
    <p>This time she did not set it back at once — she paused her hand mid-air — as though reading a letter with only a single word inside — then slowly lowered the jar back into place — its base made a low thud upon the boards — the ring did not change — it only, in place, eased a half-inch further open. She never touched it again after that.</p>

    <div class="beat">· · ·</div>

    <p>That ring — she would glance at it whenever the water came up — it was like a mouth that had never said anything — she could not say whether it was looking back — she almost felt it had its own breath — she gave a small laugh — and turned the flame down one notch.</p>
    <p>The ledger stayed closed. — Once, she opened it to the very last page — blank — she regarded the empty page — and felt unexpectedly calm — as if the whole book were saying on her behalf: leave no name. — She closed it. She put it back. — It shut with only the softest sound — like a single exhale.</p>

    <div class="beat">· · ·</div>

    <p>The tide went out again. — The dry mark beneath the hull did not change. — She did not go to see it — she knew it had not changed — knowing, she would later say, was the other way of seeing the unchanged.</p>
    <p>Her mother's voice surfaced — the book — it will turn on its own — my dear — the book always knows — this time she did not answer — nor did she withhold the answer — she only regarded the ring — thinking: very well — look after it yourself. — The stove flame flared once. The stick was spent.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not look at the sea.</p>
    <p class="coda">Some marks need not wait to close.</p>
    <p class="coda">The age of hush has not ended. It has only, at last, left behind a pale ring that never chose to close — and a grain of salt unhurried to leave.</p>`,
  },
  {
    no: 54,
    zhTitle: "壶底旧痕",
    enTitle: "The Mark Beneath the Jar",
    zh: `<p>清晨，阿汐移开水壶，木板上留着一圈浅印。盐粒没有滚动，印子也没有合拢。薄簿仍合着，船仍停在门外。船底的干痕没有变。她没有数那圈印，也没有把壶移远。</p>
    <p>这一回她留意到圈印的最深处——那里有一道极细的纹路，像一根没有拉过的弦——她蹲下去了一会儿——没有碰它——她心想：有些痕迹也不急着被谁认出来。她直起腰时，天已经亮了一格。她拍了拍膝盖上的灰——仿佛替那道纹路说了一声：别急。</p>

    <div class="beat">· · ·</div>

    <p>那粒盐仍立在圈印边缘——它没有滚动——仿佛它天生就站在那儿。她把它想象成一名站岗的小兵——它也不需要交接——它就是那样立着——一天一天——她习惯了。</p>
    <p>薄簿仍合着。——她有一次把手按在封面上——停住了——她想：它里面肯定记录了所有没被说出口的事——也许一个字都没有——也许全是——她没有再问自己——她把手收了回去。</p>

    <div class="beat">· · ·</div>

    <p>潮水来了又退。——她没有出门。——她听见木板极轻微地——收紧了半分。——她知道它在收紧。——她也不知道它为什么收紧。——她只是继续添柴。</p>
    <p>母亲的话没有回来。——这回是她自己先开口——对着窗外那只不动的船——她说：行。——然后她才意识到自己说了出来——厨房里静了一瞬——然后灶火又跳了一下。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有去看海。</p>
    <p class="coda">有些线，只在两处之间留下。</p>
    <p class="coda">止音纪元没有结束。它只是终于留下一道不急着被认出来的细痕——和一粒始终站着的盐。</p>`,
    en: `<p>At dawn, Axi moved the water jar, leaving a pale ring on the boards. The grain of salt did not roll, and the ring did not close. The ledger stayed shut; the boat remained outside, its dry mark unchanged. She did not count the ring or move the jar away.</p>
    <p>This time she noticed the deepest point of the ring — a very fine line ran there, like a string never drawn — she crouched for a while — did not touch it — thinking: some traces are not eager to be named by anyone either. When she stood back up, the sky had brightened by one notch.</p>

    <div class="beat">· · ·</div>

    <p>That grain of salt still stood at the ring's edge — it had not rolled — as though it had been born standing. She imagined it as a small sentry at its post — it needed no relief — it simply stood — day after day — and she grew used to it.</p>
    <p>The ledger stayed closed. — Once, she laid her hand upon its cover — and stopped — she thought: it must hold every unsaid thing — perhaps not a single word inside — perhaps all of them — she did not ask herself further — she drew her hand back.</p>

    <div class="beat">· · ·</div>

    <p>The tide came and went again. — She did not go out. — She heard the boards, very faintly, — tighten by a half-notch. — She knew they had tightened. — She did not know why. — She only kept feeding the fire.</p>
    <p>Her mother's phrase did not return. — This time she spoke first — toward the motionless boat — she said: all right. — Only then did she realise she had said it aloud — the kitchen went quiet for a moment — then the flame leapt once more.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not look at the sea.</p>
    <p class="coda">Some lines remain only between two places.</p>
    <p class="coda">The age of hush has not ended. It has only, at last, left behind a fine mark never eager to be named — and a grain of salt forever standing watch.</p>`,
  },
  {
    no: 55,
    zhTitle: "未动的摆",
    enTitle: "The Unmoved Pendulum",
    zh: `<p>清晨，阿汐移开水壶，木板上留着一圈浅印。盐粒没有滚动，印子也没有合拢。薄簿仍合着，船仍停在门外，船底的干痕没有变。她没有数那圈印，也没有去看海。她对着窗外的船说：行。灶火又跳了一下。</p>
    <p>她不知道自己为什么说出那个字——也许是因为说完之后，整个屋子都松了一口气——也许是因为那只船听过太多沉默，听一句话反而显得像礼貌。她添柴的时候没有再回头。</p>

    <div class="beat">· · ·</div>

    <p>这一回她忽然想到钟摆渡人——那只从不摆的摆。——她从来没有见过渡人——没人见过——传说他本也只是一根弦、一只摆——它从不摆——因为它不必摆——它停在最低处就够了。——她想：她也像那只摆。——她也不必摆——她也够了。</p>
    <p>薄簿仍合着。——母亲的册子——它会自己翻——亲爱的——册子永远知道——她今天没有听见它的声音——也许它今天也只是懒得出声——她没有催——她现在学会了——不催任何东西。</p>

    <div class="beat">· · ·</div>

    <p>潮水又来了。——她没有看。——她知道它一定来了——因为她听见木板又在那个频率上轻轻收紧了一根手指的宽度。——她继续添柴——她已经把那个频率记成自己的心跳了——它很慢——它是海的心跳。</p>
    <p>她对那粒盐说：你先看着办。——她说完就愣了一下——然后自己先笑了——灶火静静地跳着——那粒盐站得稳稳的——像它从来不需要她操心。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有去看海。</p>
    <p class="coda">有些停下，不留下来。</p>
    <p class="coda">止音纪元没有结束。它只是终于留下一只从不需要摆的摆——和一粒始终站着的盐。</p>`,
    en: `<p>At dawn, Axi moved the water jar. A pale ring remained on the boards. The grain of salt had not rolled, and the ring had not closed. The thin ledger stayed shut. The boat remained outside, its dry mark unchanged. Axi did not count the ring or look at the sea. She said, toward the boat: “All right.” The stove flame leapt once.</p>
    <p>She did not know why she had said the word — perhaps because once spoken, the whole house exhaled — perhaps because the boat had heard so much silence that one word sounded almost like courtesy. She fed the fire without turning around.</p>

    <div class="beat">· · ·</div>

    <p>This time she thought of the ferryman of the pendulum — that pendulum which never swung. — She had never seen the ferryman — no one had — it was said he was only a string, a single swing — it never swung — because it did not need to — resting at the lowest point was enough. — She thought: perhaps she, too, was like that pendulum. — She, too, need not swing — she, too, was enough.</p>
    <p>The ledger stayed closed. — Her mother's book — it would turn on its own — my dear — the book always knows — today she did not hear its voice — perhaps today it, too, could not be bothered — she did not press — she had learned — never to press anything.</p>

    <div class="beat">· · ·</div>

    <p>The tide came again. — She did not look. — She knew it had come — because she heard the boards tighten again by one finger's width in that same frequency. — She kept feeding the fire — she had already memorised that frequency as her own pulse — it was very slow — it was the sea's pulse.</p>
    <p>She said to the grain of salt: see to it yourself, then. — She said it and startled herself — then laughed, quietly, first — the stove flame leapt on — the grain of salt stood as steady as ever — as though it had never required her worry.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not look at the sea.</p>
    <p class="coda">Some stops leave nothing behind.</p>
    <p class="coda">The age of hush has not ended. It has only, at last, left behind a pendulum that never needed to swing — and a grain of salt forever standing watch.</p>`,
  },
  {
    no: 56,
    zhTitle: "未交接",
    enTitle: "No Handover",
    zh: `<p>清晨，壶边的盐还在，船底的干痕也还在。阿汐没有去看海。薄簿仍合着。她想起钟摆渡人那只从不摆的摆，便没有再等交接。有些停下，不必交给下一个人。</p>
    <p>她不知道摆是不是真的不必交——大概没有人交接过——从第一天起它就是那样——它一直那样——它以后大概也还会那样——她忽然觉得它比谁都更懂得怎么一直停着。她把手放下——掌心朝下——按了一下木板——木板没有回应。</p>

    <div class="beat">· · ·</div>

    <p>薄簿仍合着。——她有一次想把它送去渡口——也许渡口的人需要一页空白——也许他们不需要——她没有去——她也没有问——她只是想：让它合着也很好。</p>
    <p>那粒盐——她已经不记得哪一天它开始成为屋里一个固定的成员——它是她不曾请来的——它比她先到——它也会比她后走——她从不确定它是不是活的——她偶尔照顾它——就像照顾一盏不需要点的灯。</p>

    <div class="beat">· · ·</div>

    <p>潮水来过——她听见——她没去看。——木板在同一个频率上收紧了半分——她已经能分辨——它在第几道夹——她继续添柴——灶火跳了一下——她也跳了一下。</p>
    <p>母亲的声音浮起来——册子——它会自己翻——亲爱的——册子永远知道——这回她几乎是替册子说完了——她心里说：那它们——大概也知道——交接不交接——无所谓。——灶火静静地跳着。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有去看海。</p>
    <p class="coda">有些摆，不必交给下一个人。</p>
    <p class="coda">止音纪元没有结束。它只是终于留下一只从来不需要交接的摆——和一粒不必被签收的盐。</p>`,
    en: `<p>At dawn, the salt beside the jar remained, as did the dry mark beneath the boat. Axi did not look at the sea. The thin ledger stayed shut. She thought of the Pendulum Ferryman’s pendulum, which never swung, and no longer waited for a handover. Some things may stop without being handed on.</p>
    <p>She did not know whether the pendulum truly needed no one to take it on — perhaps no one ever had — it had been like that since the first day — always — and would likely remain so — she suddenly felt it understood better than anyone how to stay stopped. She lowered her hand — palm down — and touched the boards — the boards did not answer.</p>

    <div class="beat">· · ·</div>

    <p>The ledger stayed closed. — Once, she thought of sending it to the ferry crossing — perhaps the ferryman might need a blank page — perhaps not — she did not go — she did not ask — she only thought: let it remain closed, that is fine too.</p>
    <p>That grain of salt — she no longer remembered when it had become a fixed member of the house — it had not been invited — it had arrived before she did — and would likely outlast her — she could never say whether it was alive — she cared for it now and then — as one cares for a lamp that needs no lighting.</p>

    <div class="beat">· · ·</div>

    <p>The tide came — she heard it — she did not go and look. — The boards tightened by half a notch at their usual frequency — she could already tell — which clamp it was on — she kept feeding the fire — the flame leapt once — she leapt too.</p>
    <p>Her mother's voice surfaced — the book — it will turn on its own — my dear — the book always knows — this time she nearly spoke for the book — thinking: then perhaps they — know too — that handover or no handover — makes no difference. — The flame leapt on, silently.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not look at the sea.</p>
    <p class="coda">Some swings need no keeper to take them on.</p>
    <p class="coda">The age of hush has not ended. It has only, at last, left behind a pendulum that never required a handover — and a grain of salt never required a signature.</p>`,
  },
  {
    no: 57,
    zhTitle: "摆旁空位",
    enTitle: "The Place Beside the Pendulum",
    zh: `<p>潮水退去时，木板在熟悉的频率上收紧。阿汐没有去看海，也没有翻开薄簿。门槛边的盐仍在，船仍停着。她想起钟摆渡人那只从不摆的摆，不再等交接。有些停下，不必交给下一个人。</p>
    <p>她这两天忽然注意到摆旁有一个空位——不知道什么时候就有了——大概是给谁坐的——它一直空着——它也许一直就打算空着——她看它的时候——她几乎觉得它不空——它里面是整个止音纪元的入场门票——它摆在那里——谁也不坐——它自己够了。</p>

    <div class="beat">· · ·</div>

    <p>薄簿仍合着。——她这两天偶尔想把它打开——不是为了记什么——只是为了看一眼它真的合着——它合着——她就安心——她合上了更安心——她笑了笑——自己摇了摇头——她心里说：你可真是个奇怪的女孩子。</p>
    <p>那粒盐——它又多了一角的缺——或者又少了一角——她没有再检查——她已经不检查了——她只是在做饭的时候顺手看它一眼——它还在——她就继续把水烧开。</p>

    <div class="beat">· · ·</div>

    <p>潮水又来了——她没有听见——或者她听见了——她没有去听——木板在那个频率上收紧了——她的脚也跟着收紧了一点——她笑了。</p>
    <p>母亲的声音回来——册子——它会自己翻——亲爱的——册子永远知道——她这回完全替它答了——她说：知道。——她说完以后厨房安静了很久——然后灶火又跳了一下。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有去看海。</p>
    <p class="coda">有些空位，不必有人坐下。</p>
    <p class="coda">止音纪元没有结束。它只是终于留下一个从不必有人坐下的空位——和一只从不需要摆的摆。</p>`,
    en: `<p>At ebb, the boards tightened at their familiar frequency. Axi did not look at the sea or open the thin ledger. The salt remained by the threshold; the boat remained outside. She thought of the Pendulum Ferryman’s pendulum, which never swung, and stopped waiting for a handover. Some things may stop without being handed on.</p>
    <p>These past days she suddenly noticed an empty place beside the pendulum — she did not know when it had appeared — perhaps it was for someone to sit in — it had stayed empty ever since — perhaps it had always intended to stay empty — when she looked at it — she almost felt it was not empty at all — inside it was the admission ticket to the whole age of hush — it stood there — no one sat in it — it was enough on its own.</p>

    <div class="beat">· · ·</div>

    <p>The ledger stayed closed. — These past days she sometimes felt like opening it — not to record anything — only to see that it was truly shut — it was shut — she was at ease — having it shut made her more at ease — she laughed softly — and shook her head — thinking: you really are a strange girl.</p>
    <p>That grain of salt — one more corner of it vanished — or perhaps one more corner appeared — she no longer checks — she does not check anymore — only, while cooking, she would glance at it in passing — it was still there — she would go on and boil the water.</p>

    <div class="beat">· · ·</div>

    <p>The tide came in again — she did not hear it — or she heard it — she did not go and listen — the boards tightened at that frequency — her own foot tightened along with it — she laughed.</p>
    <p>Her mother's voice came back — the book — it will turn on its own — my dear — the book always knows — this time she answered fully for it — she said: I know. — After she spoke, the kitchen was quiet for a long while — then the flame leapt once more.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not look at the sea.</p>
    <p class="coda">Some empty places need no one to sit in them.</p>
    <p class="coda">The age of hush has not ended. It has only, at last, left behind an empty place that needed no one seated — and a pendulum that never needed to swing.</p>`,
  },
  {
    no: 58,
    zhTitle: "摆下的盐",
    enTitle: "Salt Beside the Seat",
    zh: `<p>摆旁的空位仍无人坐。阿汐没有翻开薄簿。门槛边的盐仍在，船仍停着，船底的干痕没有变。她没有去看海。止音纪元没有结束。</p>
    <p>她后来常常看那个空位——它总在那儿——没人坐——也没人提议谁坐——它不争不抢——它只是在——她几乎觉得它替她先到门口迎了一程——她也算是回应——她每天添水的时候会朝它点一下头——菜沉默的答了静默了——她没有解释给谁听。</p>

    <div class="beat">· · ·</div>

    <p>薄簿仍合着。——她今天又想把它打开——手放在封面上——停了——她心里说：不用急。——它合着是它的事——她看海也无需缘由——她把手收回来——它又安静了。</p>
    <p>那粒盐——它大概是比她先到的——灶上、门槛上——她已经记不清了——它还是那样——不动——她偶尔觉得它其实是整个屋里唯一真正在乎时间的人——它在从不摆的摆旁——替它数钟——她替它看了——她觉得她其实什么也没数——它只是在陪着那个空位——陪到她也懒得了——她笑了。</p>

    <div class="beat">· · ·</div>

    <p>潮水又来了——她没去看。——木板在那个频率上收了一根手指的宽度——她已经分辨得出它在第几道夹——她继续添柴——灶火跳了一下——她也跳了一下——她都懂了——不必再解释。</p>
    <p>母亲的声音回来——册子——它会自己翻——亲爱的——册子永远知道——她这回没有替它答——她只是说：好。——厨房安静了——灶火静静地跳着。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有去看海。</p>
    <p class="coda">有些来过的，不必留下座位。</p>
    <p class="coda">止音纪元没有结束。它只是终于留下一个不必有人落座的空位——和一粒替谁都数过的盐。</p>`,
    en: `<p>The place beside the pendulum remained empty. Axi did not open the ledger. The salt remained by the threshold; the boat stayed outside, its dry mark unchanged. She did not look at the sea. The silenced epoch had not ended.</p>
    <p>She would often look at that empty place afterwards — it was always there — no one sat — no one proposed that anyone should — it did not quarrel — it was simply there — she almost felt it had gone to the door ahead to welcome her — she, in turn, answered — each day at the stove she gave it a small nod — the silence returned the look, politely — she never explained it to anyone.</p>

    <div class="beat">· · ·</div>

    <p>The ledger stayed closed. — Today she again wanted to open it — her hand rested upon its cover — and paused — she thought: no hurry. — It kept to itself by being closed — her not-looking out to sea required no reason either — she drew her hand back — it went quiet again.</p>
    <p>That grain of salt — likely it had arrived before her — by the stove, or the threshold — she no longer remembered — it was still itself — unstirring — she sometimes felt it was the only one in the whole house who truly cared about time — it stood beside the unswinging pendulum, counting for it — she had looked after it — she realised she had been counting nothing — it was only keeping the empty place company — until she, too, grew too tired — she laughed.</p>

    <div class="beat">· · ·</div>

    <p>The tide came again — she did not go and see. — The boards tightened again by one finger's width at that frequency — she could already tell which clamp it was on — she kept feeding the fire — the flame leapt once — she leapt too — she understood — no need to explain anymore.</p>
    <p>Her mother's voice came back — the book — it will turn on its own — my dear — the book always knows — this time she did not answer for it — she only said: all right. — The kitchen went still — the flame kept quietly leaping.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not look at the sea.</p>
    <p class="coda">Some arrivals need leave no seat behind.</p>
    <p class="coda">The age of hush has not ended. It has only, at last, left behind an empty place that needed no one seated — and a grain of salt that counted on behalf of everyone.</p>`,
  },
  {
    no: 59,
    zhTitle: "干痕仍在",
    enTitle: "The Mark Remains",
    zh: `<p>门外的船仍停着。清晨，阿汐看见船底的干痕仍在。薄簿仍合着，门槛边的盐没有移动。她没有去看海。潮水退去，干痕的位置没有变。有些来过的，不必留下座位。</p>
    <p>她其实每天都会看一眼那道干痕——它还是那里——它没有变——也许这就是它存在的全部理由——她一开始还会纳闷——后来发现它其实不需要她的纳闷——它只是替她记住了一次潮水——它记得比她好——它不需要她帮它记。</p>

    <div class="beat">· · ·</div>

    <p>薄簿仍合着。——她今天又想了很久——她心里说：为什么她总想打开它——也许不是想打开——也许只是想确认它还是关着——它还是关着——她也就安心——她笑了。</p>
    <p>那粒盐——它大概不会动——她已经见证过太多次——它在门槛上——它比她稳定——它什么也不请求——也不需要——她有时想：它也许是整个屋里最像钟的东西——它不用摆——它停在那里——它停在那里就够了。</p>

    <div class="beat">· · ·</div>

    <p>潮水来过——她没有看见——她听见了——木板在那个频率上收紧了——她继续添柴——灶火跳了一下——她也跳了一下——那都是老朋友了。</p>
    <p>母亲的声音回来——册子——它会自己翻——亲爱的——册子永远知道——她这回没有答——也没有不答——她只是添了一根柴——厨房静静地跳着火——它跳它的——她过她的。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有去看海。</p>
    <p class="coda">有些东西到了岸边，不必立刻上船。</p>
    <p class="coda">止音纪元没有结束。它只是终于留下一道没有变的干痕——和一把从不需要坐下的空位。</p>`,
    en: `<p>The boat remained outside. At dawn, Axi saw that the dry mark beneath its hull was unchanged. The ledger stayed shut, and the salt by the threshold had not moved. She did not look at the sea. The tide withdrew; the mark remained. Some arrivals need leave no seat behind.</p>
    <p>She would in fact glance at that mark each day — it was still there — unchanged — perhaps that was the whole of its reason for being — at first she still wondered — then she realised it did not need her wondering — it was only remembering one tide for her — it remembered better than she did — it did not need her to help.</p>

    <div class="beat">· · ·</div>

    <p>The ledger stayed closed. — Today she thought about it for a long time — thinking: why did she keep wanting to open it — perhaps not to open it — perhaps only to confirm it was still shut — it was shut — and she was at ease — she laughed.</p>
    <p>That grain of salt — it probably would not move — she had witnessed it so many times — it stayed by the threshold — steadier than she was — it asked for nothing — needed nothing — she sometimes thought: perhaps it was the most clock-like thing in the whole house — it did not need to swing — it only stood there — standing there was enough.</p>

    <div class="beat">· · ·</div>

    <p>The tide came — she did not see it — she heard it — the boards tightened at that frequency — she kept feeding the fire — the flame leapt once — she leapt too — old companions, both of them.</p>
    <p>Her mother's voice came back — the book — it will turn on its own — my dear — the book always knows — this time she neither answered — nor declined to answer — she only fed one more stick into the stove — the kitchen leapt quietly with flame — it leapt, she went on.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not look at the sea.</p>
    <p class="coda">Some things reach the shore without needing to board.</p>
    <p class="coda">The age of hush has not ended. It has only, at last, left behind an unchanged mark beneath the hull — and an empty place that never needed anyone to sit in it.</p>`,
  },
  {
    no: 60,
    zhTitle: "潮退添柴",
    enTitle: "At Ebb, One Stick",
    zh: `<p>潮水退去，船底的干痕仍在。阿汐添了一根柴。薄簿仍合着，门槛边的盐没有移动。她没有去看海。火起来的时候她听见它跳了一下——像谁在敲一扇没开的门。</p>
    <p>灶火跳起来的时候——她刚好抬头——她看见它跳了一下——那火苗好像在说——她心里想——要继续——继续烧下去——灶火又跳了一下——她让火跳着——她也静着——谁都不用解释——灶火跳它的——她过她的。</p>

    <div class="beat">· · ·</div>

    <p>薄簿仍合着。——它合着就是它的事——她添柴也是她的事——她不是不想打开——她只是没有打开的理由——她也不需要理由——合着是上好的状态——她偶尔笑——对火笑——对自己笑——火没有回她——她没生气。</p>
    <p>那粒盐——它每天在门槛上——它不动——她也不动——她偶尔觉得它在替谁等什么——她偶尔又觉得它什么也不等——它只是在那儿——它停在那儿就够了——她也在她停的地方停着。</p>

    <div class="beat">· · ·</div>

    <p>潮水退了——退到它该退到的位置——她没去看——她听见木板收了一根手指的宽度——她已经分辨得出它在哪一道夹——她继续添柴——灶火跳了一下——她也跳了一下——她都懂。</p>
    <p>母亲的声音没有回来——这回是她自己先问——她心里说：好——灶火跳了一下——她把那一棍柴添了进去——火着了一会儿。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有去看海。</p>
    <p class="coda">有些痕迹，留在灰里就够了。</p>
    <p class="coda">止音纪元没有结束。它只是终于留下一道没有变的干痕——和一个添了一根又一根柴的灶火。</p>`,
    en: `<p>The tide withdrew; the dry mark beneath the hull remained. Axi fed one stick into the stove. The thin ledger stayed shut, and the salt by the threshold had not moved. She did not look at the sea.</p>
    <p>When the fire leapt — she happened to look up — she saw it leap once — as if the flame were saying — she thought — keep on — keep burning — the flame leapt again — she let it leap — she stayed quiet too — no one needed to explain — the flame leapt, she went on.</p>

    <div class="beat">· · ·</div>

    <p>The ledger stayed closed. — Its being closed was its own affair — her feeding the fire was hers — she did not avoid opening it — she simply had no reason to — and needed no reason — closed was a fine state to be in — she sometimes laughed — at the fire — at herself — the fire never answered — she was not cross.</p>
    <p>That grain of salt — it stayed by the threshold each day — it did not move — she did not either — she sometimes felt it was waiting for someone — sometimes she felt it waited for nothing — it was only there — being there was enough — she, too, stayed where she stayed.</p>

    <div class="beat">· · ·</div>

    <p>The tide went out — out to where it always went — she did not go and see — she heard the boards tighten by one finger's width — she already knew which clamp it was on — she kept feeding the fire — the flame leapt once — she leapt too — she understood.</p>
    <p>Her mother's voice did not come back — this time she asked first — she thought: all right — the flame leapt once — she fed that stick in — the fire burnt for a while.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not look at the sea.</p>
    <p class="coda">Some marks are enough left in ash.</p>
    <p class="coda">The age of hush has not ended. It has only, at last, left behind an unchanged mark beneath the hull — and a stove that kept being fed, one stick at a time.</p>`,
  },
  {
    no: 61,
    zhTitle: "摆不回",
    enTitle: "The Swing Unreturned",
    zh: `<p>潮水退去，门槛边的盐还在。阿汐听见木板收紧，没有去看海。薄簿合着，页角没有翻。她把手从封面上移开。摆停在最低处，不必交给下一个人。</p>
    <p>她其实这两天一直在想摆的事——它怎么能一直停着——它不累吗——它不需要回去吗——她问过自己很多遍——后来她发现它不累——它不是停——它只是一直都这样——它从来没动过——它也不打算动——它只是在——她忽然愿意相信它每天都很好。</p>

    <div class="beat">· · ·</div>

    <p>薄簿仍合着。——那页角——她盯着看——看它很久——它真的没有翻动——她没有翻——它也没有自己翻——也许它不知道有页角这种东西——她笑了——她想：册子永远知道。——它合着——也就够了——。</p>
    <p>那粒盐——今天她忽然想给它换个位置——手伸出去——停住了——她忽然觉得它就在那里——把它挪走就是她的失——她收回手——她不动了——她只是让它待着——它也不在乎她。</p>

    <div class="beat">· · ·</div>

    <p>潮水退了——到它该退到的位置——她没有去看——她听见木板收了一根手指的宽度——她继续添柴——灶火跳了一下——她也跳了一下——都老朋友了——她不忽然感慨了。</p>
    <p>母亲的声音回来——册子——它会自己翻——亲爱的——册子永远知道——她这回自己先开口——她说：我知道。——灶火静静地跳着——她添了一根柴——它跳得更高了——她也笑了。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有去看海。</p>
    <p class="coda">有些摆，不必回到原处。</p>
    <p class="coda">止音纪元没有结束。它只是终于留下一只从不需要回到原处的摆——和一粒始终站着的盐。</p>`,
    en: `<p>At ebb, the salt remained by the threshold. Axi heard the boards tighten and did not look toward the sea. The thin ledger stayed shut; its page corner did not turn. She drew her hand from its cover. The pendulum rested at its lowest point. It did not need to be handed on.</p>
    <p>She had, in fact, been thinking about the pendulum for days — how could it stay stopped for so long — was it tired — did it not need to swing back — she asked herself many times — then decided it was not tired — it was not stopped — it simply had always been this way — it had never moved — it did not plan to — it was simply there — she suddenly chose to believe it was perfectly content every day.</p>

    <div class="beat">· · ·</div>

    <p>The ledger stayed closed. — That page corner — she stared at it — for a long while — it truly did not turn — she had not turned it — it did not turn itself — perhaps it did not know page corners existed — she laughed — thinking: the book always knows. — It was closed — that was enough.</p>
    <p>That grain of salt — today she suddenly wanted to move its place — her hand reached out — and stopped — she suddenly felt it belonged right there — moving it would be her loss — she drew her hand back — she stayed put — she let it be — it did not care about her either.</p>

    <div class="beat">· · ·</div>

    <p>The tide went out — out to where it always went — she did not go and see — she heard the boards tighten by one finger's width — she kept feeding the fire — the flame leapt once — she leapt too — old companions — she no longer found herself moved to comment.</p>
    <p>Her mother's voice came back — the book — it will turn on its own — my dear — the book always knows — this time she spoke first — she said: I know. — The flame leapt on, quietly — she fed one more stick in — it leapt higher — she laughed too.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not look at the sea.</p>
    <p class="coda">Some swings need not return to their starting place.</p>
    <p class="coda">The age of hush has not ended. It has only, at last, left behind a pendulum that never needed to swing back — and a grain of salt forever standing watch.</p>`,
  },
  {
    no: 62,
    zhTitle: "摆旁的灰",
    enTitle: "Ash Beside the Pendulum",
    zh: `<p>潮水退去，阿汐添了一根柴。她想起那只停在最低处的摆，指尖沾着一点灰。她没有擦，也没有把它写进薄簿。天亮后，灰还在指尖旁。她没有洗手。</p>
    <p>那一点灰——它大概是从火里跳出来的——或者是从灯罩上落下的——她已经不追究——她偶尔看一眼它——它还在——她就觉得它和她是一类的——都是不急着被谁命名的东西。</p>

    <div class="beat">· · ·</div>

    <p>薄簿仍合着。——它合着是它的事——她指尖上的灰也是它的事——她手伸出去——也没有擦——也没有碰——她只是把手停在那儿——也许她不知道自己停在那儿——也许她知道——她知道也无所谓——她停着就好了。</p>
    <p>那粒盐——它还是老样子——她看了一眼它——又看了一眼自己的指尖——它们像是两只对视的眼睛——谁都不先开口——她也没话好说——她只是看——看就够了。</p>

    <div class="beat">· · ·</div>

    <p>潮水又退去了——表盘不响——门槛上那粒盐没动——她也没动——灶火静静地跳着——它跳它的——她过她的——她指尖上那点灰——大概会在明天或者后天——自己掉——或者不掉——她不关心。</p>
    <p>母亲的声音回来——册子——它会自己翻——亲爱的——册子永远知道——她这回没有回应——也没有不回应——她只是添柴——灶火跳得更高了——她笑了一下——厨房里安静了。</p>

    <div class="beat">· · ·</div>

    <p class="coda">她没有去看海。</p>
    <p class="coda">有些痕迹，不必留下来。</p>
    <p class="coda">止音纪元没有结束。它只是终于留下一粒不必被谁抹去的灰——和一个不再等任何人的天空。</p>`,
    en: `<p>At ebb, Axi fed one stick into the stove. She thought of the pendulum resting at its lowest point; a trace of ash clung to her fingertip. She did not wipe it away or enter it in the thin ledger. By morning, the ash remained beside her hand. She did not wash it away.</p>
    <p>That trace of ash — it had likely leapt out from the fire — or down from the lampshade — she no longer pursued it — she would glance at it now and then — it remained — she felt it belonged to her kind — things not in a hurry to be named by anyone.</p>

    <div class="beat">· · ·</div>

    <p>The ledger stayed closed. — Its being closed was its own affair — the ash on her finger was hers — she reached out — and did not wipe — and did not touch — she only held her hand there — perhaps she did not know she was holding it there — perhaps she did — it did not matter — holding it there was enough.</p>
    <p>That grain of salt — it was as it always was — she looked at it — then at her fingertip — they were like two eyes regarding one another — neither spoke first — she had nothing to say either — she only looked — looking was enough.</p>

    <div class="beat">· · ·</div>

    <p>The tide went out again — the dial never sounded — the grain of salt by the threshold did not move — she did not either — the flame leapt on quietly — it leapt, she went on — that ash on her fingertip — likely it would fall tomorrow, or the day after — or not — she did not concern herself.</p>
    <p>Her mother's voice came back — the book — it will turn on its own — my dear — the book always knows — this time she neither answered — nor withheld the answer — she only fed the fire — the flame leapt higher — she laughed once — the kitchen went quiet.</p>

    <div class="beat">· · ·</div>

    <p class="coda">She did not look at the sea.</p>
    <p class="coda">Some traces need not remain.</p>
    <p class="coda">The age of hush has not ended. It has only, at last, left behind a trace of ash no one needed to erase — and a sky that no longer waits for anyone.</p>`,
  },
]

