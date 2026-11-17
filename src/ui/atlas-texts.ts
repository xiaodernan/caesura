/**
 * 游记 · 二十三篇全文（2026-11-16 落 · KI-618 · 2026-11-17 KI-621/KI-623/KI-634/KI-639/KI-641/KI-643/KI-648 扩）。
 * 这二十三篇都是《止音纪元》世界谱同源的 original short fiction，
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
]

