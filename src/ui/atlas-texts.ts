/**
 * 游记 · 十篇全文（2026-11-15 落 · KI-579）。
 * 这十篇都是《止音纪元》世界谱同源的 original short fiction，
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
]
