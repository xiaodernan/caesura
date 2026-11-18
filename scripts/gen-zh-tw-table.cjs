// Generate a small simplified→traditional converter dictionary covering every CJK
// phrase actually present in our public HTML pages. Wraps opencc-js at build time.
const fs = require('fs');
const path = require('path');

try {
  const OpenCC = require('opencc-js');
  const conv = OpenCC.Converter({ from: 'cn', to: 'tw' });

  const ROOT = path.join(__dirname, '..');
  const PAGES = [
    'index.html',
    'tutorial/index.html',
    'codex/index.html',
    'cast/index.html',
    'console/index.html',
    'admin/index.html',
    'src/i18n/Lang.ts',
    'src/ui/atlas-texts.ts',
    'src/ui/Stakerite.ts',
    'story/index.html',
    'story/anthology/index.html',
    'story/frostbell/index.html',
    'story/unnamed-stone/index.html',
    'story/empty-bar/index.html',
    'story/ledger/index.html',
    'story/garden/index.html',
    'story/tribunal/index.html',
    'story/doors/index.html',
    'story/stonethroat/index.html',
    'story/first-bell/index.html',
    'story/dark-tide/index.html',
    'story/twelfth-listener/index.html',
    'story/bell-picker/index.html',
    'story/lampwright-bell/index.html',
    'story/lowtone-city/index.html',
    'story/pendulum-ferryman/index.html',
    'story/unfinished-ledger/index.html',
    'story/fourth-strike/index.html',
    'story/last-string/index.html',
    'story/string-listener/index.html',
    'story/third-voice/index.html',
    'story/ensemble/index.html',
    'story/echo-vale/index.html',
    'story/after-half-a-chime/index.html',
    'story/beside-the-button/index.html',
    'story/beyond-the-line/index.html',
    'story/after-the-bag/index.html',
    'story/salt-on-the-sill/index.html',
    'story/after-the-salt-line/index.html',
    'story/the-sill-keeps-count/index.html',
    'story/after-the-space/index.html',
    'story/the-unmarked-number/index.html',
    'story/beside-the-scale/index.html',
    'story/the-unentered-page/index.html',
    'story/the-dry-place/index.html',
    'story/unweighed/index.html',
    'story/the-empty-scale/index.html',
    'story/beyond-the-scale/index.html',
    'story/the-scale-shadow/index.html',
    'story/beyond-the-threshold/index.html',
    'story/the-mark-outside/index.html',
    'story/salt-at-the-threshold/index.html',
    'story/the-unopened-page/index.html',
    'story/the-unsent-letter/index.html',
    'story/after-the-empty-scale/index.html',
    'story/the-unmade-swing/index.html',
    'story/the-dry-mark-beneath/index.html',
    'story/the-unasked-boat/index.html',
    'story/the-place-aboard/index.html',
    'story/salt-not-aboard/index.html',
    'story/the-boat-still/index.html',
    'story/beside-the-jar/index.html',
    'story/the-ring/index.html',
    'story/the-mark-beneath-the-jar/index.html',
    'story/the-unmoved-pendulum/index.html',
    'story/no-handover/index.html',
    'story/beside-the-pendulum/index.html',
    'story/salt-beside-the-seat/index.html',
    'story/the-mark-remains/index.html',
    'story/at-ebb-one-stick/index.html',
    'story/the-swing-unreturned/index.html',
    'story/the-ash-beside-the-pendulum/index.html',
    'story/ash-not-fallen/index.html',
    'story/the-mark-not-entered/index.html',
    'story/the-ash-unhurried/index.html',
    'story/the-fire-knows/index.html',
    'story/the-ash-unreturned/index.html',
    'story/the-fading-mark/index.html',
    'story/the-unentered-stroke/index.html',
    'story/the-corner-turns/index.html',
  ];

  const PHRASES = new Set();
  for (const rel of PAGES) {
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    // extract CJK runs (2+ chars contiguous)
    for (const m of html.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
      PHRASES.add(m[0]);
    }
  }

  console.log('distinct CJK phrases of size ≥ 2 found across pages:', PHRASES.size);

  const CONV = new Map();
  let exactCount = 0;
  for (const phrase of PHRASES) {
    const traditional = conv(phrase);
    if (traditional !== phrase) {
      CONV.set(phrase, traditional);
      exactCount += 1;
    }
  }
  console.log('phrases requiring conversion:', exactCount);

  // Also record every character separately so single chars convert
  const CHAR_CONV = new Map();
  const CHARS = new Set();
  for (const rel of PAGES) {
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const ch of html) {
      if (/[\u4e00-\u9fff]/.test(ch)) CHARS.add(ch);
    }
  }
  for (const ch of CHARS) {
    const traditional = conv(ch);
    if (traditional !== ch) {
      CHAR_CONV.set(ch, traditional);
    }
  }
  console.log('distinct CJK chars across all pages:', CHARS.size);
  console.log('single chars requiring conversion:', CHAR_CONV.size);

  // Combine phrase > char Longest-first matching
  // Build combined lookup
  const entries = [];
  for (const [k, v] of CONV) entries.push([k, v, k.length]);
  for (const [k, v] of CHAR_CONV) entries.push([k, v, 1]);

  // Sort by length desc so greedy longest-match works
  entries.sort((a, b) => b[2] - a[2]);

  // Emit compact output — one copy for the static pages (runtime fetch),
  // one copy bundled for the in-game t() (imported by src/i18n/Lang.ts),
  // plus a small TW→CN single-char reverse table (used by the codex search).
  const out = { map: Object.fromEntries(entries.map(([k, v]) => [k, v])) };
  const json = JSON.stringify(out);
  const conv2 = OpenCC.Converter({ from: 'tw', to: 'cn' });
  const REVERSE = {};
  const twChars = new Set();
  for (const v of CONV.values()) {
    for (const ch of String(v)) if (/[\u4e00-\u9fff]/.test(ch)) twChars.add(ch);
  }
  for (const v of CHAR_CONV.values()) {
    if (/[\u4e00-\u9fff]/.test(v)) twChars.add(v);
  }
  for (const ch of twChars) {
    const s = conv2(ch);
    if (s !== ch && s.length === 1) REVERSE[ch] = s;
  }
  const rev = JSON.stringify({ map: REVERSE });
  fs.writeFileSync(path.join(ROOT, 'public', 'zh-tw.compact.json'), json);
  fs.writeFileSync(path.join(ROOT, 'src', 'i18n', 'zh-tw.compact.json'), json);
  fs.writeFileSync(path.join(ROOT, 'public', 'zh-cn.compact.json'), rev);
  console.log('wrote public/zh-tw.compact.json + src/i18n/zh-tw.compact.json, size =', json.length, 'bytes');
  console.log('wrote public/zh-cn.compact.json, reverse single-char map size =', rev.length, 'bytes');
} catch (e) {
  console.error('ERR', e.message || e);
  process.exit(1);
}
