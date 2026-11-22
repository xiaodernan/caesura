#!/usr/bin/env node
/**
 * gen-motif-atlas.mjs — 由 read-progress.js 的 ORDER 与 atlas-texts.ts 的双语正文，
 * 生成《余响索引 / Motif Atlas》：全量篇目按母题可检索、可筛选，零网络、零 LLM。
 *
 * 用法：node scripts/gen-motif-atlas.mjs [--check]
 *   --check 只校验生成物是否与源一致（CI / 门禁用），不写盘。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ORDER_FILE = resolve(ROOT, 'public/read-progress.js')
const ATLAS_FILE = resolve(ROOT, 'src/ui/atlas-texts.ts')
const OUT_FILE = resolve(ROOT, 'story/atlas/index.html')

const MOTIFS = [
  { id: 'salt', zh: '盐', en: 'Salt', re: /盐|salt/i },
  { id: 'bowl', zh: '碗', en: 'Bowl', re: /碗|bowl/i },
  { id: 'boat', zh: '船', en: 'Boat', re: /船|boat|hull/i },
  { id: 'ledger', zh: '簿', en: 'Ledger', re: /薄簿|簿|账|ledger/i },
  { id: 'door', zh: '门', en: 'Door', re: /门|door|threshold|门槛/i },
  { id: 'bell', zh: '钟', en: 'Bell', re: /钟|bell/i },
  { id: 'light', zh: '光', en: 'Light', re: /光|lamp|light/i },
  { id: 'line', zh: '线', en: 'Line', re: /线|纹|绳|line|crack|seam/i },
  { id: 'tide', zh: '潮', en: 'Tide', re: /潮|tide|ebb|flood/i },
  { id: 'ash', zh: '灰', en: 'Ash', re: /灰|ash/i },
  { id: 'wind', zh: '风', en: 'Wind', re: /风|wind/i },
  { id: 'empty', zh: '空', en: 'Empty', re: /空|empty|nothing/i },
]

const read = (p) => readFileSync(p, 'utf8')
const strip = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

function readOrder() {
  const src = read(ORDER_FILE)
  const m = src.match(/var ORDER = \[([\s\S]*?)\];/)
  if (!m) throw new Error('read-progress.js: ORDER block not found')
  return [...m[1].matchAll(/slug: '([^']*)', zh: '([^']*)', en: '([^']*)'/g)].map((x) => ({
    slug: x[1],
    zh: x[2].replace(/^《|》$/g, ''),
    en: x[3].replace(/^["“”]|["“”]$/g, ''),
  }))
}

function readAtlas() {
  const src = read(ATLAS_FILE)
  const out = new Map()
  const re = /no: (\d+),\s*zhTitle: "([^"]*)",\s*enTitle: "([^"]*)",\s*zh: `([\s\S]*?)`,\s*en: `([\s\S]*?)`,/g
  for (const m of src.matchAll(re)) {
    out.set(Number(m[1]), { zhTitle: m[2], enTitle: m[3], zh: strip(m[4]), en: strip(m[5]) })
  }
  return out
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function motifTags(entry, lang) {
  const text = (lang === 'zh' ? entry.zh : entry.en) + ' ' + entry.title
  const hits = MOTIFS.filter((m) => m.re.test(text)).slice(0, 4).map((m) => m.id)
  return hits.length ? hits : ['echo']
}

function build() {
  const order = readOrder()
  const atlas = readAtlas()
  if (order.length < 1) throw new Error('ORDER 为空')
  const rows = order.map((o, i) => {
    const no = i + 1
    const a = atlas.get(no) || { zhTitle: o.zh, enTitle: o.en, zh: o.zh, en: o.en }
    const entry = { ...o, no, zhTitle: a.zhTitle, enTitle: a.enTitle, zh: a.zh + ' ' + o.zh, en: a.en + ' ' + o.en, title: o.zh + ' ' + o.en }
    return { ...entry, motifs: motifTags(entry, 'zh'), motifsEn: motifTags(entry, 'en') }
  })
  const used = new Set(rows.flatMap((r) => [...r.motifs, ...r.motifsEn]))
  const chips = MOTIFS.filter((m) => used.has(m.id))

  const cards = rows.map((r) => {
    const href = '/caesura/story/' + (r.slug ? r.slug + '/' : '')
    const tags = [...new Set([...r.motifs, ...r.motifsEn])].map((id) => {
      const m = MOTIFS.find((x) => x.id === id)
      if (!m) return '<span class="tag"><span class="zh-copy">回声</span><span class="en-copy">Echo</span></span>'
      return `<span class="tag" data-motif="${m.id}"><span class="zh-copy">${m.zh}</span><span class="en-copy">${m.en}</span></span>`
    }).join('')
    return `    <a class="card" href="${href}" data-motifs="${[...new Set([...r.motifs, ...r.motifsEn])].join(' ')}" data-index="${esc((r.zhTitle + ' ' + r.enTitle + ' ' + r.zh + ' ' + r.en).toLowerCase())}">
      <span class="no">篇 ${r.no} · No. ${r.no}</span>
      <h2 class="zh-copy">《${esc(r.zhTitle)}》</h2>
      <h2 class="en-copy">“${esc(r.enTitle)}”</h2>
      <div class="tags">${tags}</div>
      <span class="read-flag zh-copy">已读</span><span class="read-flag en-copy">Read</span>
    </a>`
  }).join('\n')

  const chipButtons = chips.map((m) => `      <button type="button" class="chip" data-motif="${m.id}"><span class="zh-copy">${m.zh}</span><span class="en-copy">${m.en}</span> <b data-count="${m.id}">0</b></button>`).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN" data-lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>余响索引 / Motif Atlas — CAESURA · ${order.length} 篇母题检索</title>
<meta name="description" content="《止音纪元 · 余响集》${order.length} 篇的母题索引：盐、碗、船、簿、门、钟、光、线、潮、灰、风、空——搜一个词，找到所有写过它的故事。双语 · 零网络 · 零 LLM。 / A motif atlas for the ${order.length} stories of CAESURA: salt, bowl, boat, ledger, door, bell, light, line, tide, ash, wind, empty. Search one word, find every story that wrote it. Bilingual, offline, zero LLM.">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='88'>🧭</text></svg>">
<style>
  :root { --gold:#d9b46a; --gold-soft:rgba(217,180,106,.3); --ink:#f3ede0; --ink-dim:rgba(243,237,224,.62); --panel:rgba(26,19,10,.78); --serif:"Songti SC","Noto Serif CJK SC","Noto Serif SC",Georgia,serif; }
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { background:#07060a; color:var(--ink); font-family:var(--serif); -webkit-font-smoothing:antialiased; }
  body { min-height:100vh; }
  .bg { position:fixed; inset:0; z-index:-2; pointer-events:none; }
  .bg.radial { background:radial-gradient(1100px 700px at 50% -10%, rgba(217,180,106,.12), transparent 60%), radial-gradient(900px 700px at 50% 118%, rgba(120,80,40,.16), transparent 62%), #07060a; }
  .bg.noise { position:fixed; inset:0; z-index:-1; opacity:.05; pointer-events:none; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E"); }
  .wrap { max-width:1080px; margin:0 auto; padding:26px 26px 90px; }
  .topbar { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .brand { font-size:.8rem; letter-spacing:.3em; color:var(--gold); text-transform:uppercase; opacity:.9; }
  .brand a { color:inherit; text-decoration:none; border-bottom:1px dotted rgba(217,180,106,.5); }
  .toplinks { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .toplinks a { font-size:.72rem; color:var(--ink-dim); text-decoration:none; border:1px solid rgba(243,237,224,.14); padding:6px 12px; border-radius:999px; transition:all .22s ease; }
  .toplinks a:hover { color:var(--gold); border-color:var(--gold-soft); }
  .lang-row button { cursor:pointer; font-family:inherit; font-size:.72rem; color:var(--ink); background:rgba(217,180,106,.12); border:1px solid var(--gold-soft); padding:6px 15px; border-radius:999px; letter-spacing:.1em; }
  .lang-row button:hover { background:rgba(217,180,106,.22); box-shadow:0 0 16px rgba(217,180,106,.25); }
  [data-lang="zh-TW"] .en-copy, [data-lang="zh"] .en-copy { display:none !important; }
  [data-lang="en"] .zh-copy { display:none !important; }
  header.hero { text-align:center; padding:52px 14px 22px; }
  .kicker { font-size:.72rem; letter-spacing:.42em; color:var(--ink-dim); text-transform:uppercase; margin-bottom:18px; }
  .kicker b { color:var(--gold); font-weight:600; }
  h1 { font-size:clamp(2.1rem, 7vw, 3.4rem); font-weight:600; letter-spacing:.14em; background:linear-gradient(180deg,#fff8e4 0%, #d9b46a 28%, #a9854a 58%, #5e4a26 100%); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent; text-shadow:0 0 90px rgba(217,180,106,.3); }
  .subtitle { margin-top:14px; font-size:.8rem; color:var(--ink-dim); letter-spacing:.24em; text-transform:uppercase; }
  .rule { width:170px; height:1px; margin:22px auto 0; background:linear-gradient(90deg, transparent, var(--gold), transparent); }
  .stats { display:flex; justify-content:center; gap:26px; flex-wrap:wrap; margin-top:20px; font-size:.74rem; color:var(--ink-dim); letter-spacing:.1em; }
  .stats b { color:var(--gold); font-weight:600; font-size:1.05rem; margin-left:4px; }
  .quick { display:flex; justify-content:center; gap:10px; flex-wrap:wrap; margin-top:16px; }
  .quick button { cursor:pointer; font-family:inherit; font-size:.76rem; color:var(--ink); background:rgba(217,180,106,.12); border:1px solid var(--gold-soft); border-radius:999px; padding:8px 18px; letter-spacing:.1em; transition:all .2s ease; }
  .quick button:hover { background:rgba(217,180,106,.24); box-shadow:0 0 16px rgba(217,180,106,.25); }
  .controls { margin:26px auto 8px; max-width:860px; }
  .search { width:100%; font-family:inherit; font-size:.95rem; color:var(--ink); background:rgba(26,19,10,.78); border:1px solid rgba(243,237,224,.14); border-radius:999px; padding:12px 20px; outline:none; }
  .search:focus { border-color:var(--gold-soft); box-shadow:0 0 0 3px rgba(217,180,106,.1); }
  .chips { display:flex; flex-wrap:wrap; gap:8px; margin-top:14px; justify-content:center; }
  .chip { cursor:pointer; font-family:inherit; font-size:.74rem; color:var(--ink-dim); background:rgba(243,237,224,.05); border:1px solid rgba(243,237,224,.14); border-radius:999px; padding:6px 13px; transition:all .2s ease; }
  .chip:hover { color:var(--gold); border-color:var(--gold-soft); }
  .chip[aria-pressed="true"] { color:#1a130a; background:var(--gold); border-color:var(--gold); }
  .chip b { font-weight:600; opacity:.72; margin-left:2px; }
  .countline { margin:18px 0 10px; text-align:center; font-size:.76rem; color:var(--ink-dim); letter-spacing:.08em; }
  .grid { display:grid; gap:12px; grid-template-columns:repeat(3, minmax(0, 1fr)); }
  @media (max-width:900px) { .grid { grid-template-columns:repeat(2, minmax(0, 1fr)); } }
  @media (max-width:560px) { .grid { grid-template-columns:1fr; } .wrap { padding:20px 12px 70px; } }
  .card { position:relative; display:block; text-decoration:none; color:inherit; background:var(--panel); border:1px solid rgba(243,237,224,.1); border-radius:14px; padding:16px 16px 14px; transition:all .22s ease; overflow:hidden; }
  .card::before { content:""; position:absolute; top:0; left:0; right:0; height:2px; background:linear-gradient(90deg, transparent, var(--gold), transparent); opacity:.45; }
  .card:hover { border-color:var(--gold-soft); transform:translateY(-2px); box-shadow:0 12px 32px rgba(0,0,0,.38); }
  .card[hidden] { display:none; }
  .card .no { font-size:.64rem; letter-spacing:.22em; color:var(--gold); text-transform:uppercase; }
  .card h2 { font-size:1.08rem; font-weight:600; margin:.45em 0 .6em; letter-spacing:.06em; color:#fff3d6; }
  .tags { display:flex; flex-wrap:wrap; gap:6px; }
  .tag { font-size:.64rem; color:var(--ink-dim); border:1px solid rgba(243,237,224,.14); border-radius:999px; padding:2px 9px; letter-spacing:.08em; }
  .read-flag { position:absolute; top:14px; right:14px; font-size:.6rem; letter-spacing:.16em; color:#1a130a; background:var(--gold); border-radius:999px; padding:2px 8px; display:none; }
  .card.is-read .read-flag { display:inline-block; }
  .empty { display:none; text-align:center; padding:60px 20px; color:var(--ink-dim); font-size:.9rem; letter-spacing:.06em; }
  .empty.show { display:block; }
  footer { margin-top:52px; border-top:1px solid rgba(243,237,224,.09); padding-top:22px; display:flex; flex-wrap:wrap; gap:10px 22px; justify-content:space-between; font-size:.7rem; color:rgba(243,237,224,.4); letter-spacing:.06em; }
  footer a { color:var(--gold); text-decoration:none; }
  @media (prefers-reduced-motion: reduce) { * { animation:none !important; transition:none !important; } }
</style>
</head>
<body>
<div class="bg radial" aria-hidden="true"></div>
<div class="bg noise" aria-hidden="true"></div>
<div class="wrap">
  <div class="topbar">
    <div class="brand"><a href="/caesura/">CAESURA</a> · 《止音纪元》</div>
    <div class="toplinks">
      <a href="/caesura/story/anthology/"><span class="zh-copy">余响集</span><span class="en-copy">The Aftermath</span></a>
      <a href="/caesura/codex/"><span class="zh-copy">世界谱</span><span class="en-copy">Codex</span></a>
      <a href="/caesura/tutorial/"><span class="zh-copy">教程</span><span class="en-copy">Tutorial</span></a>
      <a href="/caesura/cast/"><span class="zh-copy">角色图鉴</span><span class="en-copy">Cast</span></a>
      <a href="/caesura/"><span class="zh-copy">游戏</span><span class="en-copy">Game</span></a>
      <span class="lang-row"><button id="langToggle" type="button" aria-label="切换语言 · switch language">EN / 中文</button></span>
    </div>
  </div>

  <header class="hero">
    <p class="kicker zh-copy">索引 · <b>余响集</b> · ${order.length} 篇母题</p>
    <p class="kicker en-copy">Index · <b>The Aftermath</b> · motifs across ${order.length} stories</p>
    <h1 class="zh-copy">余响索引</h1>
    <h1 class="en-copy">Motif Atlas</h1>
    <p class="subtitle zh-copy">搜一个词，找到所有写过它的故事</p>
    <p class="subtitle en-copy">Search one word, find every story that wrote it</p>
    <div class="rule"></div>
    <div class="stats">
      <span class="zh-copy">收录<b id="statTotal">${order.length}</b>篇</span><span class="en-copy">Stories<b id="statTotalEn">${order.length}</b></span>
      <span class="zh-copy">母题<b id="statMotifs">${chips.length}</b>类</span><span class="en-copy">Motifs<b id="statMotifsEn">${chips.length}</b></span>
      <span class="zh-copy">本机已读<b id="statRead">0</b>/${order.length}</span><span class="en-copy">Read here<b id="statReadEn">0</b>/${order.length}</span>
    </div>
    <div class="quick">
      <button id="continueBtn" type="button"><span class="zh-copy">接着读</span><span class="en-copy">Continue reading</span></button>
      <button id="randomBtn" type="button"><span class="zh-copy">随便读一篇</span><span class="en-copy">Surprise me</span></button>
    </div>
  </header>

  <section class="controls" aria-label="检索与筛选 · search and filters">
    <input id="q" class="search" type="search" autocomplete="off" placeholder="搜标题或正文里的词：盐、船、光…… / Search a title or a word: salt, boat, light…" aria-label="搜索 · search">
    <div class="chips" id="chips" role="group" aria-label="母题筛选 · motif filters">
${chipButtons}
    </div>
    <p class="countline" id="countline" aria-live="polite"></p>
  </section>

  <main class="grid" id="grid">
${cards}
  </main>
  <p class="empty" id="empty"><span class="zh-copy">没有匹配的故事——换一个词，或清掉筛选。</span><span class="en-copy">No story matches — try another word, or clear the filters.</span></p>

  <footer>
    <span class="zh-copy">© CAESURA《止音纪元》· <a href="/caesura/story/anthology/">全集 · 余响集</a> · <a href="/caesura/codex/">世界谱</a> · <a href="/caesura/story/${rows[rows.length - 1].slug}/">最新 · 篇${order.length}</a> · 零网络 · 零 LLM</span>
    <span class="en-copy">© CAESURA · <a href="/caesura/story/anthology/">All stories</a> · <a href="/caesura/codex/">World Codex</a> · <a href="/caesura/story/${rows[rows.length - 1].slug}/">Newest · No. ${order.length}</a> · offline · zero LLM</span>
  </footer>
</div>
<script>
(function () {
  var root = document.documentElement;
  var lang = 'zh';
  try { lang = localStorage.getItem('caesura-lang') || 'zh'; } catch (e) { /* noop */ }
  function apply(l) {
    root.setAttribute('data-lang', l);
    root.setAttribute('lang', l === 'en' ? 'en-US' : (l === 'zh-TW' ? 'zh-TW' : 'zh-CN'));
    try { localStorage.setItem('caesura-lang', l); } catch (e) { /* noop */ }
    var btn = document.getElementById('langToggle');
    if (btn) btn.textContent = l === 'en' ? '中文 / EN' : 'EN / 中文';
    renderCount();
  }
  document.getElementById('langToggle').addEventListener('click', function () {
    var cur = root.getAttribute('data-lang');
    apply(cur === 'en' ? 'zh' : 'en');
  });

  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  var chips = Array.prototype.slice.call(document.querySelectorAll('.chip'));
  var active = null;
  var q = document.getElementById('q');
  var countline = document.getElementById('countline');

  function isEN() { return root.getAttribute('data-lang') === 'en'; }

  var readSet = {};
  try {
    var doc = JSON.parse(localStorage.getItem('caesura.reading.v1') || '{}');
    readSet = (doc && doc.done) || {};
  } catch (e) { readSet = {}; }
  var readCount = 0;
  var firstUnread = null;
  cards.forEach(function (c) {
    var slug = (c.getAttribute('href') || '').replace('/caesura/story/', '').replace(/\\/$/, '') || '(salt)';
    if (readSet[slug]) { c.classList.add('is-read'); readCount++; }
    else if (!firstUnread) { firstUnread = c; }
  });
  document.getElementById('statRead').textContent = readCount;
  document.getElementById('statReadEn').textContent = readCount;
  document.getElementById('continueBtn').addEventListener('click', function () {
    var target = firstUnread || cards[Math.floor(Math.random() * cards.length)];
    if (target) location.href = target.getAttribute('href');
  });
  document.getElementById('randomBtn').addEventListener('click', function () {
    var pool = cards.filter(function (c) { return !c.hidden; });
    var target = pool[Math.floor(Math.random() * pool.length)] || cards[Math.floor(Math.random() * cards.length)];
    if (target) location.href = target.getAttribute('href');
  });

  function motifCount(id) {
    return cards.filter(function (c) { return (' ' + c.getAttribute('data-motifs') + ' ').indexOf(' ' + id + ' ') >= 0 }).length;
  }
  chips.forEach(function (b) {
    var n = motifCount(b.getAttribute('data-motif'));
    var el = b.querySelector('b');
    if (el) el.textContent = n;
    b.addEventListener('click', function () {
      var id = b.getAttribute('data-motif');
      active = active === id ? null : id;
      chips.forEach(function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-motif') === active)); });
      filter();
    });
  });

  function filter() {
    var needle = (q.value || '').trim().toLowerCase();
    var shown = 0;
    cards.forEach(function (c) {
      var okMotif = !active || (' ' + c.getAttribute('data-motifs') + ' ').indexOf(' ' + active + ' ') >= 0;
      var okText = !needle || (c.getAttribute('data-index') || '').indexOf(needle) >= 0;
      var ok = okMotif && okText;
      c.hidden = !ok;
      if (ok) shown++;
    });
    document.getElementById('empty').classList.toggle('show', shown === 0);
    renderCount(shown);
  }
  function renderCount(shown) {
    var n = typeof shown === 'number' ? shown : cards.filter(function (c) { return !c.hidden }).length;
    countline.textContent = isEN()
      ? n + ' of ' + cards.length + ' stories' + (active ? ' · motif: ' + active : '')
      : n + ' / ' + cards.length + ' 篇' + (active ? ' · 母题筛选' : '');
  }
  q.addEventListener('input', filter);
  apply(lang === 'zh-TW' || lang === 'en' ? lang : 'zh');
  filter();
})();
</script>
<script defer src="/caesura/tracker.js"></script>
<script defer src="/caesura/zh-tw-converter.js"></script>
</body>
</html>
`
}

const html = build()
if (process.argv.includes('--check')) {
  if (!existsSync(OUT_FILE)) { console.error('motif-atlas: missing story/atlas/index.html'); process.exit(1) }
  const now = read(OUT_FILE)
  if (now !== html) { console.error('motif-atlas: generated page is stale — run node scripts/gen-motif-atlas.mjs'); process.exit(1) }
  console.log(`motif-atlas: OK — ${(html.match(/class="card" href=/g) || []).length} stories, in sync`)
} else {
  writeFileSync(OUT_FILE, html, 'utf8')
  console.log('motif-atlas: wrote story/atlas/index.html')
}
