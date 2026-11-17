/* 止音纪元 · 阅读进度 + 下一篇入口（KI-654 · KI-645 行动 #4）
 * The Epoch of Hush — reading progress + next-story entry (KI-645 action #4: read-through ≥ 70%).
 *
 * - 顶部 3px 金色进度条（transform: scaleX · 零布局抖动 · rAF 节流 · 跟随滚动）
 * - 读到 96% 时浮出「下一篇 · Next」卡片（真 <a>，键盘可达）；正文读完自动
 *   记账：localStorage 'caesura.reading.v1'（仅本机 · 不出境）
 * - 串联 KI-653 的本机埋点通道 window.__caesuraTrack（story-finished / story-next · 零网络）
 * - 双语：html[data-lang="en"] → English；其余 → 中文（zh / zh-TW 同字形简体行或由 converter 转）
 * - prefers-reduced-motion：无过渡动画；aria-hidden 进度条本身不可聚焦
 * - 零网络 · 零 LLM · 不改动页面本体（只读 DOM + 附加两节点）
 */
(function () {
  'use strict';

  /* canon 顺序（篇一《盐》.. 篇三十七《空秤》），与 src/ui/atlas-texts.ts 的 no 一一对应 */
  var ORDER = [
    { slug: '', zh: '《盐》', en: '"Salt"' },
    { slug: 'unnamed-stone', zh: '《山下无名碑》', en: '"The Nameless Stone"' },
    { slug: 'empty-bar', zh: '《空拍》', en: '"The Empty Bar"' },
    { slug: 'ledger', zh: '《账本》', en: '"The Ledger"' },
    { slug: 'garden', zh: '《回声庭园》', en: '"The Garden of Return"' },
    { slug: 'tribunal', zh: '《雨审》', en: '"The Rain Tribunal"' },
    { slug: 'frostbell', zh: '《霜锤》', en: '"The Frostbell"' },
    { slug: 'doors', zh: '《千门》', en: '"The Thousand Doors"' },
    { slug: 'stonethroat', zh: '《石喉》', en: '"The Stone-Throat"' },
    { slug: 'first-bell', zh: '《第一钟》', en: '"The First Bell"' },
    { slug: 'dark-tide', zh: '《暗潮》', en: '"The Dark Tide"' },
    { slug: 'twelfth-listener', zh: '《第十二个听者》', en: '"The Twelfth Listener"' },
    { slug: 'bell-picker', zh: '《拾钟人》', en: '"The Bell-Picker"' },
    { slug: 'lampwright-bell', zh: '《灯匠》', en: '"The Lampwright"' },
    { slug: 'lowtone-city', zh: '《低音之城》', en: '"The City of Low Tones"' },
    { slug: 'pendulum-ferryman', zh: '《钟摆渡人》', en: '"The Pendulum Ferryman"' },
    { slug: 'unfinished-ledger', zh: '《未竟账页》', en: '"The Unfinished Ledger Page"' },
    { slug: 'fourth-strike', zh: '《第四击》', en: '"The Fourth Strike"' },
    { slug: 'last-string', zh: '《末弦》', en: '"The Last String"' },
    { slug: 'string-listener', zh: '《听弦》', en: '"The String-Listener"' },
    { slug: 'third-voice', zh: '《第三声》', en: '"The Third Voice"' },
    { slug: 'ensemble', zh: '《合奏》', en: '"The Ensemble"' },
    { slug: 'echo-vale', zh: '《回声谷》', en: '"The Echo Vale"' },
    { slug: 'after-half-a-chime', zh: '《半声之后》', en: '"After Half a Chime"' },
    { slug: 'beside-the-button', zh: '《铜扣旁》', en: '"Beside the Button"' },
    { slug: 'beyond-the-line', zh: '《线外》', en: '"Beyond the Line"' },
    { slug: 'after-the-bag', zh: '《纸袋之后》', en: '"After the Bag"' },
    { slug: 'salt-on-the-sill', zh: '《窗台盐线》', en: '"Salt on the Sill"' },
    { slug: 'after-the-salt-line', zh: '《盐线之后》', en: '"After the Salt Line"' },
    { slug: 'the-sill-keeps-count', zh: '《窗台记数》', en: '"The Sill Keeps Count"' },
    { slug: 'after-the-space', zh: '《空处之后》', en: '"After the Space"' },
    { slug: 'the-unmarked-number', zh: '《未刻之数》', en: '"The Unmarked Number"' },
    { slug: 'beside-the-scale', zh: '《秤旁》', en: '"Beside the Scale"' },
    { slug: 'the-unentered-page', zh: '《未记的一页》', en: '"The Unentered Page"' },
    { slug: 'the-dry-place', zh: '《干处》', en: '"The Dry Place"' },
    { slug: 'unweighed', zh: '《未称之物》', en: '"Unweighed"' },
    { slug: 'the-empty-scale', zh: '《空秤》', en: '"The Empty Scale"' }
  ];

  var PREFIX = '/caesura/story/';
  var READ_KEY = 'caesura.reading.v1';
  var DONE_AT = 0.96; // 视口滚到 96% 视为读完

  function currentSlug() {
    var p = (location.pathname || '/');
    var i = p.indexOf(PREFIX);
    if (i < 0) return '';
    var rest = p.slice(i + PREFIX.length).replace(/\/+$/, '');
    return rest.split('/')[0] || '';
  }

  function currentLang() {
    var d = document.documentElement;
    var l = (d && (d.dataset && d.dataset.lang)) || d.getAttribute('lang') || 'zh';
    return String(l).toLowerCase() === 'en' ? 'en' : 'zh';
  }

  function entryOf(slug) {
    for (var i = 0; i < ORDER.length; i++) {
      if (ORDER[i].slug === slug) return { index: i, entry: ORDER[i] };
    }
    return null;
  }

  function readingDoc() {
    try {
      var raw = localStorage.getItem(READ_KEY);
      var d = raw ? JSON.parse(raw) : null;
      if (d && typeof d === 'object' && d.done && typeof d.done === 'object') return d;
      return { done: {} };
    } catch (e) { return { done: {} }; }
  }

  function markFinished(slug) {
    try {
      var doc = readingDoc();
      if (doc.done[slug || '(salt)']) return; // 同一篇重复读不重复记账
      doc.done[slug || '(salt)'] = Date.now();
      localStorage.setItem(READ_KEY, JSON.stringify(doc));
    } catch (e) { /* 记账永远不许弄坏阅读 */ }
    try { if (typeof window.__caesuraTrack === 'function') window.__caesuraTrack('story-finished'); } catch (e) { /* noop */ }
  }

  function pct() {
    var se = document.scrollingElement || document.documentElement;
    /* 整页不足一屏（短页）⇒ 无需滚动即视为读完 */
    if (se.scrollHeight <= se.clientHeight + 8) return 1;
    var max = Math.max(1, se.scrollHeight - se.clientHeight);
    return Math.min(1, Math.max(0, (se.scrollTop || window.pageYOffset || 0) / max));
  }

  function mount() {
    var isEN = currentLang() === 'en';

    /* 顶部进度条 */
    var bar = document.createElement('div');
    bar.id = 'readbar';
    bar.setAttribute('aria-hidden', 'true');
    bar.innerHTML = '<i></i>';
    document.body.appendChild(bar);
    var fill = bar.firstChild;

    /* 下一篇卡片 */
    var me = entryOf(currentSlug());
    var next = me && me.index < ORDER.length - 1 ? ORDER[me.index + 1] : null;
    var nextCard = null;
    if (next || me) {
      var href = next ? PREFIX + (next.slug ? next.slug + '/' : '')
                      : '/caesura/story/anthology/';
      var label = next
        ? (isEN ? 'Next · ' + next.en : '下一篇 · ' + next.zh)
        : (isEN ? 'The Aftermath · all thirty-seven' : '余响集 · 三十七篇全集');
      var tag = isEN ? (next ? 'Keep reading' : 'Read the whole volume') : (next ? '继续读下一页' : '读完全册');
      nextCard = document.createElement('a');
      nextCard.className = 'read-next';
      nextCard.href = href;
      nextCard.setAttribute('aria-label', label);
      nextCard.innerHTML =
        '<span class="rn-tag">' + tag + '</span>' +
        '<span class="rn-name">' + label + '</span>';
      document.body.appendChild(nextCard);
      nextCard.addEventListener('click', function () {
        try { if (typeof window.__caesuraTrack === 'function') window.__caesuraTrack('story-next'); } catch (e) { /* noop */ }
      }, { passive: true });
    }

    /* 内嵌样式（不碰页面自己的 CSS；reduced-motion 直接落定态） */
    var css =
      '#readbar{position:fixed;top:0;left:0;right:0;height:3px;z-index:80;pointer-events:none;background:rgba(255,184,107,.08)}' +
      '#readbar i{display:block;height:100%;transform-origin:0 50%;transform:scaleX(0);background:linear-gradient(90deg,#ffb86b,#c9b458);box-shadow:0 0 6px rgba(255,184,107,.55);will-change:transform}' +
      '.read-next{position:fixed;right:16px;bottom:22px;z-index:80;display:flex;flex-direction:column;gap:.24rem;max-width:min(320px,72vw);text-decoration:none;' +
        'padding:.62rem .82rem .6rem .92rem;border:1px solid rgba(255,184,107,.5);border-radius:12px;' +
        'background:rgba(14,12,10,.92);box-shadow:0 .8rem 2.4rem rgba(0,0,0,.5),0 0 1.6rem rgba(255,184,107,.14);' +
        'opacity:0;transform:translateY(10px);pointer-events:none;transition:opacity .35s ease,transform .35s ease}' +
      '.read-next.done{opacity:1;transform:none;pointer-events:auto}' +
      '.read-next:hover,.read-next:focus-visible{border-color:#ffb86b;box-shadow:0 .8rem 2.4rem rgba(0,0,0,.55),0 0 2rem rgba(255,184,107,.3)}' +
      '.read-next:focus-visible{outline:2px solid #ffd98a;outline-offset:2px}' +
      '.read-next .rn-tag{font-size:.62rem;letter-spacing:.34em;text-transform:uppercase;color:rgba(255,217,138,.62)}' +
      '.read-next .rn-name{font-size:.92rem;line-height:1.45;color:#ffe9b8}' +
      '@media (prefers-reduced-motion:reduce){.read-next,#readbar i{transition:none !important}}';
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    var ticking = false;
    var finished = false;
    var onScroll = function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        var p = pct();
        fill.style.transform = 'scaleX(' + p.toFixed(4) + ')';
        if (!finished && p >= DONE_AT) {
          finished = true;
          if (nextCard) nextCard.classList.add('done');
          markFinished(currentSlug());
        } else if (nextCard && finished) {
          nextCard.classList.add('done');
        }
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onScroll();
  }

  try {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', mount, { once: true });
    } else {
      mount();
    }
  } catch (e) {
    /* 阅读进度永远不许弄坏正文 */
  }
})();
